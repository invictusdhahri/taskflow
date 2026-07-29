import { GROUP_MERGE_JSON_INSTRUCTIONS, buildGithubEvidenceText } from "./evidence.js";
import {
  type FileFindingPayload,
  diffAgainstCache,
  loadFindingsCache,
  mergeFindingsIntoCache,
  saveFindingsCache,
  skillHash,
} from "./findingsCache.js";
import { completePlan, estimateTokensFromChars, estimateUsd } from "./openrouter.js";
import { analyzeFileChunks } from "./planCodebase.js";
import { parsePlan } from "./parsePlan.js";
import type { RosterEntry } from "./roster.js";
import { loadSurfaceConfig, selectSurfaceFiles } from "./surface.js";
import type { BenchPlan, FixturePack, ModelConfig } from "./types.js";

export interface GroupPlanPerRepoMeta {
  repo: string;
  files_total: number;
  files_sent: number;
  cache_hits: number;
  cache_misses: number;
  chunks: number;
}

export interface GroupPlanRunMeta {
  repos: string[];
  per_repo: GroupPlanPerRepoMeta[];
  usd: number;
  input_tokens: number;
  output_tokens: number;
  latency_ms: number;
  model_used: string;
}

export interface GroupPlanRunResult {
  plan: BenchPlan;
  meta: GroupPlanRunMeta;
  raw_texts: string[];
}

/**
 * Joint plan across related repos: reuses the existing per-repo findings pipeline
 * (chunked analysis + content-hash cache, unchanged, exactly as cheap as running
 * each repo separately) and adds ONE additional joint merge call across condensed
 * findings + each repo's declared surface files (.taskflow/surface.json) — not raw
 * codebases — to keep the new cost small. See runner/README.md for the design.
 */
export async function runGroupPlan(opts: {
  /** One pack per repo, same order as `repos`. */
  packs: FixturePack[];
  repos: string[];
  model: ModelConfig;
  skill: string;
  maxUsd: number;
  rosterByRepo?: Record<string, RosterEntry[]>;
  readCache: boolean;
  writeCache: boolean;
  dryRun?: boolean;
}): Promise<GroupPlanRunResult | { dryRun: true; preview: Record<string, unknown> }> {
  const { packs, repos, model, skill, maxUsd, rosterByRepo, readCache, writeCache, dryRun } = opts;
  if (packs.length !== repos.length) {
    throw new Error("runGroupPlan: packs and repos must have matching length/order");
  }

  const system = `You follow TaskFlow skill rules.\n\n${skill}`;

  // Phase 1: cheap, local, no network/OpenRouter — cache diff + size estimate only.
  const diffs: Array<{ repo: string; pack: FixturePack; diff: ReturnType<typeof diffAgainstCache> }> = [];
  for (let i = 0; i < repos.length; i++) {
    const repo = repos[i]!;
    const pack = packs[i]!;
    const files = pack.codebase?.files;
    if (!files?.length) {
      throw new Error(`Group plan requires a full codebase capture for ${repo}. Re-snapshot without --no-clone.`);
    }
    const cache = readCache ? loadFindingsCache(repo, model.id, skill) : null;
    const diff = readCache
      ? diffAgainstCache(files, cache)
      : {
          reuse: [] as ReturnType<typeof diffAgainstCache>["reuse"],
          reanalyze: files,
          deleted: [] as string[],
          cache_hits: 0,
          cache_misses: files.length,
        };
    diffs.push({ repo, pack, diff });
  }

  if (dryRun) {
    const perRepoPreview = diffs.map(({ repo, pack, diff }) => ({
      repo,
      files_total: pack.codebase?.total_files ?? 0,
      would_reuse: diff.cache_hits,
      would_reanalyze: diff.cache_misses,
      reanalyze_chars: diff.reanalyze.reduce((s, f) => s + f.content.length, 0),
    }));
    const estChars =
      system.length +
      perRepoPreview.reduce((s, r) => s + r.reanalyze_chars, 0) +
      50_000 * repos.length; // rough findings+merge overhead per repo, mirrors single-repo estimate
    const estTokens = estimateTokensFromChars(estChars);
    return {
      dryRun: true,
      preview: {
        repos,
        per_repo: perRepoPreview,
        estimated_usd: Number(estimateUsd(model, estTokens, 4000).toFixed(4)),
        max_usd: maxUsd,
      },
    };
  }

  // Phase 2: real analysis — only reached when not a dry run.
  let usd = 0;
  let input_tokens = 0;
  let output_tokens = 0;
  let latency_ms = 0;
  let model_used = model.slug;
  const raw_texts: string[] = [];
  const per_repo: GroupPlanPerRepoMeta[] = [];
  const repoEntries: Array<{
    repo: string;
    github: unknown;
    findings: Array<{ path: string; findings: FileFindingPayload }>;
    surface_files: Array<{ path: string; content: string }>;
  }> = [];

  for (const { repo, pack, diff } of diffs) {
    const files = pack.codebase!.files;
    const cache = readCache ? loadFindingsCache(repo, model.id, skill) : null;

    console.log(`  [group-plan] ${repo}: reanalyze=${diff.reanalyze.length} reuse=${diff.cache_hits}`);
    const analyzed = await analyzeFileChunks({ model, system, pack, files: diff.reanalyze, maxUsd });
    usd += analyzed.usd;
    input_tokens += analyzed.input_tokens;
    output_tokens += analyzed.output_tokens;
    latency_ms += analyzed.latency_ms;
    model_used = analyzed.model_used;
    raw_texts.push(...analyzed.raw_texts);

    const allFindings = [
      ...diff.reuse.map((r) => ({ path: r.path, findings: r.findings })),
      ...analyzed.fresh.map((f) => ({ path: f.path, findings: f.findings })),
    ];

    const doc = mergeFindingsIntoCache(cache, {
      repo,
      model_id: model.id,
      skill_hash: skillHash(skill),
      head_sha: pack.codebase?.head_sha,
      reuse: diff.reuse,
      fresh: analyzed.fresh,
    });
    if (writeCache) saveFindingsCache(doc);

    const roster = rosterByRepo?.[repo] ?? [];
    const github = JSON.parse(buildGithubEvidenceText(pack, roster)) as unknown;

    const surfaceConfig = loadSurfaceConfig(repo);
    const surfaceFiles = selectSurfaceFiles(files, surfaceConfig).map((f) => ({
      path: f.path,
      content: f.content,
    }));

    repoEntries.push({ repo, github, findings: allFindings, surface_files: surfaceFiles });
    per_repo.push({
      repo,
      files_total: files.length,
      files_sent: diff.reanalyze.length,
      cache_hits: diff.cache_hits,
      cache_misses: diff.cache_misses,
      chunks: analyzed.chunks,
    });
  }

  const payload = { repos: repoEntries };
  const user = `${GROUP_MERGE_JSON_INSTRUCTIONS}\n\n## Payload\n\`\`\`json\n${JSON.stringify(payload, null, 2)}\n\`\`\``;

  console.log(`  [group-plan] joint merge repos=${repos.join(",")} chars≈${user.length}`);
  const usage = await completePlan({ model, system, user, maxUsdPerRun: maxUsd });
  raw_texts.push(usage.raw_text);
  usd += usage.usd;
  input_tokens += usage.input_tokens;
  output_tokens += usage.output_tokens;
  latency_ms += usage.latency_ms;
  model_used = usage.model_used;

  const plan = parsePlan(usage.raw_text);

  const repoSet = new Set(repos);
  const bad = plan.operations.filter(
    (op) => op.type === "CREATE_ISSUE" && (!op.repo || !repoSet.has(op.repo)),
  );
  if (bad.length) {
    throw new Error(
      `Group plan produced ${bad.length} CREATE_ISSUE op(s) with missing/unknown repo: ${bad
        .map((o) => o.id)
        .join(", ")}`,
    );
  }

  return {
    plan,
    raw_texts,
    meta: { repos, per_repo, usd, input_tokens, output_tokens, latency_ms, model_used },
  };
}
