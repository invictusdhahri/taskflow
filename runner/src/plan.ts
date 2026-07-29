#!/usr/bin/env node
/**
 * Propose-only TaskFlow plan for a real GitHub repo (Gemini Flash).
 *
 *   pnpm plan -- --repo OWNER/REPO
 *   pnpm plan -- --snapshot R01-my-snapshot
 *   pnpm plan -- --repo OWNER/REPO --dry-run
 *   pnpm plan -- --repo OWNER/REPO --refresh-code
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getFixtureById, loadFixtureDir } from "./fixtures.js";
import { loadSkillContext, runnerRoot } from "./loadSkill.js";
import { DEFAULT_MODEL, getModelById } from "./models.js";
import { defaultPlanMaxUsd } from "./openrouter.js";
import { runFullCodebasePlan } from "./planCodebase.js";
import { runGroupPlan } from "./planGroup.js";
import { groupUnchanged, saveGroupState, singleRepoUnchanged } from "./remoteState.js";
import { buildRoster, type RosterEntry } from "./roster.js";
import { createSnapshot } from "./snapshot.js";
import type { FixturePack, ModelConfig } from "./types.js";

function argValue(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  if (i < 0) return undefined;
  return args[i + 1];
}

function hasFlag(args: string[], name: string): boolean {
  return args.includes(name);
}

function usage(): never {
  console.log(`TaskFlow plan (propose-only, full codebase, Gemini Flash)

Usage:
  pnpm plan -- --repo OWNER/REPO [--id SNAPSHOT_ID]
  pnpm plan -- --snapshot SNAPSHOT_ID
  pnpm plan -- --repos OWNER/REPO1,OWNER/REPO2 --id GROUP_ID

Options:
  --repo OWNER/REPO   Snapshot this repo (read-only), then plan.
  --repos A,B[,C...]  Joint plan across related repos (see runner/README.md).
  --id ID             Snapshot/group folder id (required for --repos; default
                       derived from repo name for --repo).
  --snapshot ID       Reuse an existing fixtures/snapshots/<id> pack (--repo mode only).
  --model ID          Override model (default: gemini-flash).
  --max-usd N         Soft cost cap (default TASKFLOW_PLAN_MAX_USD or 2.0).
  --out PATH          Write plan JSON here (default results/plans/<id>.json).
  --no-clone          Forbidden for plan (codebase required).
  --no-cache          Do not read/write findings cache.
  --refresh-code      Ignore cache; re-analyze every file (still writes cache).
  --dry-run           Print size/cache/cost estimate; no OpenRouter call.
  --roster PATH       Local roster JSON override (--repo mode only; skip live fetch).
  --skip-if-unchanged Skip entirely (no clone, no OpenRouter call) if the repo(s)
                       haven't moved since the last successful run. Opt-in — for
                       scheduled/CI use; plain manual runs always run. Trades off
                       not noticing issue-only changes (no new commit) for cost.

Full text source is required. Cold runs analyze the whole repo (single-shot or
chunked). Later runs reuse per-file findings by content hash (incremental).

No GitHub writes. Review the plan, then apply via the TaskFlow skill / gh.
`);
  process.exit(1);
}

function defaultSnapshotId(repo: string): string {
  const name = repo.split("/")[1] ?? "repo";
  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  return `P-${name}-${stamp}`;
}

function sanitizeForPath(repo: string): string {
  return repo.replace(/[^a-zA-Z0-9._-]+/g, "__");
}

async function runGroup(args: string[], reposArg: string): Promise<void> {
  const repos = reposArg
    .split(",")
    .map((r) => r.trim())
    .filter(Boolean);
  if (repos.length < 2) {
    throw new Error("--repos requires at least two comma-separated OWNER/REPO values");
  }

  const groupId = argValue(args, "--id");
  if (!groupId) {
    throw new Error("--id GROUP_ID is required for --repos (used as the group's output/cache id)");
  }

  const dryRun = hasFlag(args, "--dry-run");
  const noCache = hasFlag(args, "--no-cache");
  const refreshCode = hasFlag(args, "--refresh-code");
  const skipIfUnchanged = hasFlag(args, "--skip-if-unchanged");
  const modelArg = argValue(args, "--model");
  const maxUsd = Number(argValue(args, "--max-usd") ?? defaultPlanMaxUsd());
  const outArg = argValue(args, "--out");

  if (!process.env.OPENROUTER_TIMEOUT_MS) {
    process.env.OPENROUTER_TIMEOUT_MS = "300000";
  }

  const model: ModelConfig = modelArg
    ? (getModelById(modelArg) ??
      (() => {
        throw new Error(`Unknown model: ${modelArg}`);
      })())
    : DEFAULT_MODEL;

  if (skipIfUnchanged && groupUnchanged(groupId, repos)) {
    console.log(`\n[skip] group ${groupId}: no member repo has moved since the last successful joint run.`);
    console.log("SKIPPED=true");
    return;
  }

  const packs: FixturePack[] = [];
  const rosterByRepo: Record<string, RosterEntry[]> = {};
  for (const repo of repos) {
    const packId = `${groupId}__${sanitizeForPath(repo)}`;
    const packDir = createSnapshot({ repo, id: packId, skipClone: false });
    const pack = loadFixtureDir(packDir);
    if (!pack.codebase?.files.length) {
      throw new Error(`Snapshot for ${repo} has no codebase_index.json. Re-snapshot without --no-clone.`);
    }
    packs.push(pack);
    try {
      rosterByRepo[repo] = buildRoster(repo);
      console.log(`  [roster] ${repo}: ${rosterByRepo[repo]!.length} collaborator(s)`);
    } catch (e) {
      console.warn(`  [roster] ${repo} skipped: ${(e as Error).message}`);
      rosterByRepo[repo] = [];
    }
  }

  const skill = loadSkillContext();
  const readCache = !noCache && !refreshCode;
  const writeCache = !noCache;

  console.log(
    `\nGroup plan: ${groupId} × ${model.id} (${model.slug}) · repos=${repos.join(", ")}` +
      ` · cache=${readCache ? "read+write" : writeCache ? "write-only" : "off"}`,
  );

  const result = await runGroupPlan({
    packs,
    repos,
    model,
    skill,
    maxUsd,
    rosterByRepo,
    readCache,
    writeCache,
    dryRun,
  });

  if ("dryRun" in result && result.dryRun) {
    console.log("[dry-run] skipping OpenRouter call");
    console.log(JSON.stringify(result.preview, null, 2));
    return;
  }

  if (!("plan" in result)) {
    throw new Error("Unexpected group plan result");
  }

  const { plan, meta, raw_texts } = result;
  const plansDir = join(runnerRoot(), "results", "plans");
  if (!existsSync(plansDir)) mkdirSync(plansDir, { recursive: true });
  const outPath = outArg ?? join(plansDir, `${groupId}.json`);

  const payload = {
    meta: {
      snapshot_id: groupId,
      repos,
      model: model.id,
      model_slug: meta.model_used,
      usd: meta.usd,
      input_tokens: meta.input_tokens,
      output_tokens: meta.output_tokens,
      latency_ms: meta.latency_ms,
      generated_at: new Date().toISOString(),
      propose_only: true,
      per_repo: meta.per_repo,
    },
    plan,
  };

  writeFileSync(outPath, JSON.stringify(payload, null, 2));

  const headShas: Record<string, string> = {};
  for (let i = 0; i < repos.length; i++) {
    const sha = packs[i]?.codebase?.head_sha;
    if (sha) headShas[repos[i]!] = sha;
  }
  saveGroupState(groupId, headShas);

  const rawDir = join(runnerRoot(), "results", "raw");
  if (!existsSync(rawDir)) mkdirSync(rawDir, { recursive: true });
  writeFileSync(join(rawDir, `plan_${groupId}_${model.id}.txt`), raw_texts.join("\n\n===== NEXT =====\n\n"));

  console.log(`\n✓ Group plan (${plan.operations.length} ops) → ${outPath}`);
  console.log(`  $${meta.usd.toFixed(4)} · ${meta.latency_ms}ms · ${meta.model_used}`);
  console.log(`  summary: ${plan.summary}`);
  for (const op of plan.operations.slice(0, 12)) {
    const label = op.title ?? op.target ?? op.issue_number ?? "";
    console.log(`  - ${op.id} [${op.repo ?? "?"}] ${op.type}${label ? `: ${label}` : ""}`);
  }
  if (plan.operations.length > 12) {
    console.log(`  … +${plan.operations.length - 12} more`);
  }
  console.log("\nPropose-only — no GitHub writes. Review JSON, then apply via TaskFlow skill.");
}

async function runSingle(args: string[]): Promise<void> {
  const dryRun = hasFlag(args, "--dry-run");
  const skipClone = hasFlag(args, "--no-clone");
  const noCache = hasFlag(args, "--no-cache");
  const refreshCode = hasFlag(args, "--refresh-code");
  const skipIfUnchanged = hasFlag(args, "--skip-if-unchanged");
  const repo = argValue(args, "--repo");
  const snapshotOnly = argValue(args, "--snapshot");
  const idArg = argValue(args, "--id");
  const modelArg = argValue(args, "--model");
  const maxUsd = Number(argValue(args, "--max-usd") ?? defaultPlanMaxUsd());
  const outArg = argValue(args, "--out");
  const rosterArg = argValue(args, "--roster");

  if (skipClone) {
    throw new Error(
      "--no-clone is not allowed for pnpm plan (full codebase is required). Omit --no-clone.",
    );
  }

  // Ensure large-plan timeout unless user already set one.
  if (!process.env.OPENROUTER_TIMEOUT_MS) {
    process.env.OPENROUTER_TIMEOUT_MS = "300000";
  }

  const model: ModelConfig = modelArg
    ? (getModelById(modelArg) ??
      (() => {
        throw new Error(`Unknown model: ${modelArg}`);
      })())
    : DEFAULT_MODEL;

  const skill = loadSkillContext();

  if (skipIfUnchanged && repo) {
    if (singleRepoUnchanged(repo, model.id, skill)) {
      console.log(`\n[skip] ${repo}: HEAD unchanged since last analyzed run — skipping (--skip-if-unchanged).`);
      console.log("SKIPPED=true");
      return;
    }
  }

  let packDir: string;
  let packId: string;

  if (snapshotOnly) {
    const pack = getFixtureById(snapshotOnly);
    packDir = pack.dir;
    packId = pack.meta.id;
  } else if (repo) {
    packId = idArg ?? defaultSnapshotId(repo);
    packDir = createSnapshot({
      repo,
      id: packId,
      skipClone: false,
    });
  } else {
    usage();
  }

  const pack = loadFixtureDir(packDir);
  if (!pack.codebase?.files.length) {
    throw new Error(
      `Snapshot ${packId} has no codebase_index.json. Re-snapshot without --no-clone.`,
    );
  }

  const rosterRepo = repo ?? pack.meta.repo?.full_name;
  let roster: RosterEntry[] = [];
  if (rosterRepo) {
    try {
      roster = buildRoster(rosterRepo, rosterArg ? { rosterPath: rosterArg } : {});
      console.log(
        `  [roster] ${roster.length} collaborator(s), ${roster.filter((r) => r.skills.length).length} tagged`,
      );
    } catch (e) {
      console.warn(`  [roster] skipped: ${(e as Error).message}`);
    }
  } else if (rosterArg) {
    console.warn("  [roster] --roster given but no repo to resolve collaborators against; skipping");
  }

  const readCache = !noCache && !refreshCode;
  const writeCache = !noCache;

  console.log(
    `\nPlan: ${pack.meta.id} × ${model.id} (${model.slug})` +
      ` · issues=${pack.issues.length}` +
      ` · code_files=${pack.codebase.total_files}` +
      ` · bytes=${pack.codebase.total_bytes}` +
      ` · cache=${readCache ? "read+write" : writeCache ? "write-only" : "off"}`,
  );

  const result = await runFullCodebasePlan({
    pack,
    model,
    skill,
    maxUsd,
    readCache,
    writeCache,
    dryRun,
    roster,
  });

  if ("dryRun" in result && result.dryRun) {
    console.log("[dry-run] skipping OpenRouter call");
    console.log(JSON.stringify(result.preview, null, 2));
    return;
  }

  if (!("plan" in result)) {
    throw new Error("Unexpected plan result");
  }

  const { plan, meta, raw_texts } = result;
  const plansDir = join(runnerRoot(), "results", "plans");
  if (!existsSync(plansDir)) mkdirSync(plansDir, { recursive: true });
  const outPath = outArg ?? join(plansDir, `${packId}.json`);

  const payload = {
    meta: {
      snapshot_id: packId,
      repo: pack.meta.repo?.full_name,
      model: model.id,
      model_slug: meta.model_used,
      usd: meta.usd,
      input_tokens: meta.input_tokens,
      output_tokens: meta.output_tokens,
      latency_ms: meta.latency_ms,
      generated_at: new Date().toISOString(),
      propose_only: true,
      plan_mode: meta.mode,
      files_total: meta.files_total,
      files_sent: meta.files_sent,
      chunks: meta.chunks,
      omitted: meta.omitted,
      cache_hits: meta.cache_hits,
      cache_misses: meta.cache_misses,
      truncated_files: meta.truncated_files,
    },
    plan,
  };

  writeFileSync(outPath, JSON.stringify(payload, null, 2));

  const rawDir = join(runnerRoot(), "results", "raw");
  if (!existsSync(rawDir)) mkdirSync(rawDir, { recursive: true });
  writeFileSync(
    join(rawDir, `plan_${packId}_${model.id}.txt`),
    raw_texts.join("\n\n===== NEXT =====\n\n"),
  );

  console.log(`\n✓ Plan (${plan.operations.length} ops) → ${outPath}`);
  console.log(
    `  mode=${meta.mode} omitted=${meta.omitted} sent=${meta.files_sent}/${meta.files_total}` +
      ` cache_hits=${meta.cache_hits} misses=${meta.cache_misses} chunks=${meta.chunks}`,
  );
  console.log(`  $${meta.usd.toFixed(4)} · ${meta.latency_ms}ms · ${meta.model_used}`);
  console.log(`  summary: ${plan.summary}`);
  for (const op of plan.operations.slice(0, 12)) {
    const label = op.title ?? op.target ?? op.issue_number ?? "";
    console.log(`  - ${op.id} ${op.type}${label ? `: ${label}` : ""}`);
  }
  if (plan.operations.length > 12) {
    console.log(`  … +${plan.operations.length - 12} more`);
  }
  console.log("\nPropose-only — no GitHub writes. Review JSON, then apply via TaskFlow skill.");
}

async function main(): Promise<void> {
  const args = process.argv.slice(2).filter((a) => a !== "--");
  if (!args.length || hasFlag(args, "-h") || hasFlag(args, "--help")) usage();

  const reposArg = argValue(args, "--repos");
  if (reposArg) {
    await runGroup(args, reposArg);
    return;
  }
  await runSingle(args);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
