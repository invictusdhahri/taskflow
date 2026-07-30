import {
  FINDINGS_JSON_INSTRUCTIONS,
  MERGE_JSON_INSTRUCTIONS,
  PLAN_JSON_INSTRUCTIONS,
  buildGithubEvidenceText,
  buildPlanEvidence,
  partitionCodebaseFiles,
  planChunkMaxChars,
} from "./evidence.js";
import {
  type FileFindingPayload,
  type FindingsCacheDoc,
  diffAgainstCache,
  loadFindingsCache,
  mergeFindingsIntoCache,
  saveFindingsCache,
  skillHash,
} from "./findingsCache.js";
import { extractJsonObject } from "./score.js";
import { completePlan, estimateTokensFromChars, estimateUsd } from "./openrouter.js";
import { parsePlan } from "./parsePlan.js";
import type { RosterEntry } from "./roster.js";
import type { BenchPlan, CodebaseFile, FixturePack, ModelConfig } from "./types.js";

export interface PlanRunMeta {
  mode: "single" | "chunked" | "incremental";
  files_total: number;
  files_sent: number;
  chunks: number;
  omitted: number;
  cache_hits: number;
  cache_misses: number;
  truncated_files: number;
  usd: number;
  input_tokens: number;
  output_tokens: number;
  latency_ms: number;
  model_used: string;
}

export interface PlanRunResult {
  plan: BenchPlan;
  meta: PlanRunMeta;
  raw_texts: string[];
}

function parseFindingsJson(
  raw: string,
  expectedPaths: Set<string>,
): Array<{ path: string; findings: FileFindingPayload }> {
  const json = extractJsonObject(raw) as {
    findings?: Array<{
      path?: string;
      bugs?: string[];
      gaps?: string[];
      features?: string[];
      notes?: string;
    }>;
  };
  const out: Array<{ path: string; findings: FileFindingPayload }> = [];
  for (const row of json.findings ?? []) {
    if (!row.path || !expectedPaths.has(row.path)) continue;
    out.push({
      path: row.path,
      findings: {
        ...(row.bugs?.length ? { bugs: row.bugs } : {}),
        ...(row.gaps?.length ? { gaps: row.gaps } : {}),
        ...(row.features?.length ? { features: row.features } : {}),
        ...(row.notes ? { notes: row.notes } : {}),
      },
    });
  }
  return out;
}

/** Ensure every analyzed file has a cache entry (empty findings ok). */
function fillMissingFindings(
  files: CodebaseFile[],
  parsed: Array<{ path: string; findings: FileFindingPayload }>,
): Array<{ path: string; content_hash: string; findings: FileFindingPayload }> {
  const byPath = new Map(parsed.map((p) => [p.path, p.findings]));
  return files.map((f) => ({
    path: f.path,
    content_hash: f.content_hash ?? "",
    findings: byPath.get(f.path) ?? { notes: "no notable findings" },
  }));
}

export async function analyzeFileChunks(opts: {
  model: ModelConfig;
  fallbackModel?: ModelConfig;
  system: string;
  pack: FixturePack;
  files: CodebaseFile[];
  maxUsd: number;
}): Promise<{
  fresh: Array<{ path: string; content_hash: string; findings: FileFindingPayload }>;
  chunks: number;
  usd: number;
  input_tokens: number;
  output_tokens: number;
  latency_ms: number;
  model_used: string;
  raw_texts: string[];
}> {
  const { model, fallbackModel, system, pack, files, maxUsd } = opts;
  if (!files.length) {
    return {
      fresh: [],
      chunks: 0,
      usd: 0,
      input_tokens: 0,
      output_tokens: 0,
      latency_ms: 0,
      model_used: model.slug,
      raw_texts: [],
    };
  }

  const chunks = partitionCodebaseFiles(files, planChunkMaxChars());
  const github = buildGithubEvidenceText(pack);
  const allFresh: Array<{ path: string; content_hash: string; findings: FileFindingPayload }> =
    [];
  const raw_texts: string[] = [];
  let usd = 0;
  let input_tokens = 0;
  let output_tokens = 0;
  let latency_ms = 0;
  let model_used = model.slug;

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i]!;
    const paths = new Set(chunk.map((f) => f.path));
    const payload = {
      chunk: i + 1,
      chunks_total: chunks.length,
      github_context: JSON.parse(github) as unknown,
      files: chunk.map((f) => ({
        path: f.path,
        size: f.size,
        content_hash: f.content_hash,
        content: f.content,
      })),
    };
    const user = `${FINDINGS_JSON_INSTRUCTIONS}\n\n## Payload\n\`\`\`json\n${JSON.stringify(payload, null, 2)}\n\`\`\``;
    console.log(
      `  [findings] chunk ${i + 1}/${chunks.length} files=${chunk.length} chars≈${user.length}`,
    );
    const usage = await completePlan({ model, fallbackModel, system, user, maxUsdPerRun: maxUsd });
    raw_texts.push(usage.raw_text);
    usd += usage.usd;
    input_tokens += usage.input_tokens;
    output_tokens += usage.output_tokens;
    latency_ms += usage.latency_ms;
    model_used = usage.model_used;
    const parsed = parseFindingsJson(usage.raw_text, paths);
    allFresh.push(...fillMissingFindings(chunk, parsed));
  }

  return {
    fresh: allFresh,
    chunks: chunks.length,
    usd,
    input_tokens,
    output_tokens,
    latency_ms,
    model_used,
    raw_texts,
  };
}

async function mergeToPlan(opts: {
  model: ModelConfig;
  fallbackModel?: ModelConfig;
  system: string;
  pack: FixturePack;
  findings: Array<{ path: string; findings: FileFindingPayload }>;
  maxUsd: number;
  roster?: RosterEntry[];
}): Promise<{ plan: BenchPlan; usage: Awaited<ReturnType<typeof completePlan>> }> {
  const github = buildGithubEvidenceText(opts.pack, opts.roster);
  const payload = {
    github: JSON.parse(github) as unknown,
    codebase_findings: opts.findings,
  };
  const user = `${MERGE_JSON_INSTRUCTIONS}\n\n## Payload\n\`\`\`json\n${JSON.stringify(payload, null, 2)}\n\`\`\``;
  console.log(`  [merge] findings=${opts.findings.length} chars≈${user.length}`);
  const usage = await completePlan({
    model: opts.model,
    fallbackModel: opts.fallbackModel,
    system: opts.system,
    user,
    maxUsdPerRun: opts.maxUsd,
  });
  const plan = parsePlan(usage.raw_text);
  return { plan, usage };
}

/**
 * Full-codebase plan: single-shot when everything fits; else findings chunks + merge.
 * Uses findings cache for incremental re-analyze.
 */
export async function runFullCodebasePlan(opts: {
  pack: FixturePack;
  model: ModelConfig;
  fallbackModel?: ModelConfig;
  skill: string;
  maxUsd: number;
  /** Load findings cache for incremental reuse. */
  readCache: boolean;
  /** Persist findings after the run. */
  writeCache: boolean;
  dryRun?: boolean;
  /** Live collaborators + skill tags, used to suggest assignees on CREATE_ISSUE. */
  roster?: RosterEntry[];
}): Promise<PlanRunResult | { dryRun: true; preview: Record<string, unknown> }> {
  const { pack, model, fallbackModel, skill, maxUsd, readCache, writeCache, dryRun, roster } = opts;
  const files = pack.codebase?.files;
  if (!files?.length) {
    throw new Error(
      "Plan requires a full codebase capture. Re-run without --no-clone.",
    );
  }

  const truncated_files = files.filter((f) => f.truncated).length;
  if (truncated_files) {
    console.warn(
      `  [warn] ${truncated_files} file(s) were truncated at SNAPSHOT_MAX_CODE_FILE_BYTES — raise the limit for full reads.`,
    );
  }

  const repo =
    pack.meta.repo?.full_name ??
    `${pack.meta.repo?.owner ?? "unknown"}/${pack.meta.repo?.name ?? pack.meta.id}`;

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

  const fullEvidence = buildPlanEvidence(pack, files, roster);
  if (fullEvidence.stats.files_omitted !== 0) {
    throw new Error("Internal error: plan evidence omitted files");
  }

  const system = `You follow TaskFlow skill rules.\n\n${skill}`;
  const singleShotFits =
    diff.reanalyze.length === files.length &&
    diff.cache_hits === 0 &&
    fullEvidence.stats.chars + system.length < planChunkMaxChars() * 1.2;

  const estTokens = estimateTokensFromChars(
    singleShotFits
      ? system.length + fullEvidence.stats.chars + PLAN_JSON_INSTRUCTIONS.length
      : system.length +
          diff.reanalyze.reduce((s, f) => s + f.content.length, 0) +
          50_000,
  );
  const estUsd = estimateUsd(model, estTokens, 4000);

  if (dryRun) {
    const chunks = partitionCodebaseFiles(diff.reanalyze, planChunkMaxChars());
    return {
      dryRun: true,
      preview: {
        repo,
        mode: singleShotFits
          ? "single"
          : diff.cache_hits > 0
            ? "incremental"
            : "chunked",
        files_total: files.length,
        would_reuse: diff.cache_hits,
        would_reanalyze: diff.cache_misses,
        chunks: singleShotFits ? 1 : Math.max(chunks.length, diff.reanalyze.length ? 1 : 0),
        omitted: 0,
        truncated_files,
        evidence_chars: fullEvidence.stats.chars,
        estimated_usd: Number(estUsd.toFixed(4)),
        max_usd: maxUsd,
        cache_loaded: Boolean(cache),
        read_cache: readCache,
        write_cache: writeCache,
      },
    };
  }

  // True single-shot: one plan call with full codebase (cold, fits).
  if (singleShotFits) {
    console.log(
      `  [plan] mode=single files=${files.length} chars=${fullEvidence.stats.chars} omitted=0`,
    );
    const user = `${PLAN_JSON_INSTRUCTIONS}\n\n## Frozen evidence\n\`\`\`json\n${fullEvidence.text}\n\`\`\``;
    const usage = await completePlan({ model, fallbackModel, system, user, maxUsdPerRun: maxUsd });
    const plan = parsePlan(usage.raw_text);

    // Seed cache so next run can be incremental.
    const fresh = files.map((f) => ({
      path: f.path,
      content_hash: f.content_hash ?? "",
      findings: {
        notes: "Covered by full-repo single-shot plan analysis",
      } satisfies FileFindingPayload,
    }));
    const doc = mergeFindingsIntoCache(cache, {
      repo,
      model_id: model.id,
      skill_hash: skillHash(skill),
      head_sha: pack.codebase?.head_sha,
      reuse: [],
      fresh,
    });
    if (writeCache) saveFindingsCache(doc);

    return {
      plan,
      raw_texts: [usage.raw_text],
      meta: {
        mode: "single",
        files_total: files.length,
        files_sent: files.length,
        chunks: 1,
        omitted: 0,
        cache_hits: 0,
        cache_misses: files.length,
        truncated_files,
        usd: usage.usd,
        input_tokens: usage.input_tokens,
        output_tokens: usage.output_tokens,
        latency_ms: usage.latency_ms,
        model_used: usage.model_used,
      },
    };
  }

  // Chunked and/or incremental: findings on reanalyze, then merge.
  const mode: PlanRunMeta["mode"] = diff.cache_hits > 0 ? "incremental" : "chunked";
  console.log(
    `  [plan] mode=${mode} files_total=${files.length} reanalyze=${diff.reanalyze.length}` +
      ` reuse=${diff.cache_hits} omitted=0`,
  );

  const analyzed = await analyzeFileChunks({
    model,
    fallbackModel,
    system,
    pack,
    files: diff.reanalyze,
    maxUsd,
  });

  // Coverage: every file must be reuse or fresh.
  const covered = new Set([
    ...diff.reuse.map((r) => r.path),
    ...analyzed.fresh.map((f) => f.path),
  ]);
  const missing = files.filter((f) => !covered.has(f.path));
  if (missing.length) {
    throw new Error(
      `Plan coverage failed: ${missing.length} file(s) neither cached nor analyzed (e.g. ${missing[0]?.path})`,
    );
  }

  const allFindings = [
    ...diff.reuse.map((r) => ({ path: r.path, findings: r.findings })),
    ...analyzed.fresh.map((f) => ({ path: f.path, findings: f.findings })),
  ];

  const merged = await mergeToPlan({
    model,
    fallbackModel,
    system,
    pack,
    findings: allFindings,
    maxUsd,
    roster,
  });

  const doc: FindingsCacheDoc = mergeFindingsIntoCache(cache, {
    repo,
    model_id: model.id,
    skill_hash: skillHash(skill),
    head_sha: pack.codebase?.head_sha,
    reuse: diff.reuse,
    fresh: analyzed.fresh,
  });
  if (writeCache) saveFindingsCache(doc);

  return {
    plan: merged.plan,
    raw_texts: [...analyzed.raw_texts, merged.usage.raw_text],
    meta: {
      mode,
      files_total: files.length,
      files_sent: diff.reanalyze.length,
      chunks: analyzed.chunks,
      omitted: 0,
      cache_hits: diff.cache_hits,
      cache_misses: diff.cache_misses,
      truncated_files,
      usd: analyzed.usd + merged.usage.usd,
      input_tokens: analyzed.input_tokens + merged.usage.input_tokens,
      output_tokens: analyzed.output_tokens + merged.usage.output_tokens,
      latency_ms: analyzed.latency_ms + merged.usage.latency_ms,
      model_used: merged.usage.model_used,
    },
  };
}
