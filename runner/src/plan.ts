#!/usr/bin/env node
/**
 * Propose-only TaskFlow plan for a real GitHub repo (Gemini Flash).
 *
 *   pnpm plan -- --repo OWNER/REPO
 *   pnpm plan -- --snapshot R01-easyCollect-messy
 *   pnpm plan -- --repo OWNER/REPO --id R05-myapp --dry-run
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { buildEvidenceText, PLAN_JSON_INSTRUCTIONS } from "./evidence.js";
import { getFixtureById, loadFixtureDir } from "./fixtures.js";
import { loadSkillContext, runnerRoot } from "./loadSkill.js";
import { DEFAULT_MODEL, getModelById } from "./models.js";
import { completePlan, defaultMaxUsdPerRun } from "./openrouter.js";
import { parsePlan } from "./parsePlan.js";
import { createSnapshot } from "./snapshot.js";
import type { BenchPlan, ModelConfig } from "./types.js";

function argValue(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  if (i < 0) return undefined;
  return args[i + 1];
}

function hasFlag(args: string[], name: string): boolean {
  return args.includes(name);
}

function usage(): never {
  console.log(`TaskFlow plan (propose-only, Gemini Flash)

Usage:
  pnpm plan -- --repo OWNER/REPO [--id SNAPSHOT_ID]
  pnpm plan -- --snapshot SNAPSHOT_ID

Options:
  --repo OWNER/REPO   Snapshot this repo (read-only), then plan.
  --id ID             Snapshot folder id (default: derived from repo name).
  --snapshot ID       Reuse an existing fixtures/snapshots/<id> pack.
  --model ID          Override model (default: gemini-flash). Bench only.
  --max-usd N         Soft cost cap (default TASKFLOW_MAX_USD_PER_RUN or 0.40).
  --out PATH          Write plan JSON here (default results/plans/<id>.json).
  --no-clone          Skip codebase clone when snapshotting.
  --dry-run           Build evidence + print sizes; no OpenRouter call.

No GitHub writes. Review the plan, then apply via the TaskFlow skill / gh.
`);
  process.exit(1);
}

function defaultSnapshotId(repo: string): string {
  const name = repo.split("/")[1] ?? "repo";
  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  return `P-${name}-${stamp}`;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2).filter((a) => a !== "--");
  if (!args.length || hasFlag(args, "-h") || hasFlag(args, "--help")) usage();

  const dryRun = hasFlag(args, "--dry-run");
  const skipClone = hasFlag(args, "--no-clone");
  const repo = argValue(args, "--repo");
  const snapshotOnly = argValue(args, "--snapshot");
  const idArg = argValue(args, "--id");
  const modelArg = argValue(args, "--model");
  const maxUsd = Number(argValue(args, "--max-usd") ?? defaultMaxUsdPerRun());
  const outArg = argValue(args, "--out");

  const model: ModelConfig = modelArg
    ? (getModelById(modelArg) ??
      (() => {
        throw new Error(`Unknown model: ${modelArg}`);
      })())
    : DEFAULT_MODEL;

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
      skipClone,
    });
  } else {
    usage();
  }

  const pack = loadFixtureDir(packDir);
  const skill = loadSkillContext();
  const evidence = buildEvidenceText(pack);
  const user = `${PLAN_JSON_INSTRUCTIONS}\n\n## Frozen evidence\n\`\`\`json\n${evidence}\n\`\`\``;
  const system = `You follow TaskFlow skill rules.\n\n${skill}`;

  console.log(
    `\nPlan: ${pack.meta.id} × ${model.id} (${model.slug})` +
      ` · issues=${pack.issues.length}` +
      ` · code_files=${pack.codebase?.total_files ?? 0}` +
      ` · evidence_chars=${evidence.length}`,
  );

  if (dryRun) {
    console.log("[dry-run] skipping OpenRouter call");
    console.log(`  system_chars=${system.length} user_chars=${user.length}`);
    return;
  }

  const usageResult = await completePlan({
    model,
    system,
    user,
    maxUsdPerRun: maxUsd,
  });

  let plan: BenchPlan;
  try {
    plan = parsePlan(usageResult.raw_text);
  } catch (e) {
    const rawDir = join(runnerRoot(), "results", "raw");
    if (!existsSync(rawDir)) mkdirSync(rawDir, { recursive: true });
    const rawPath = join(rawDir, `plan_${packId}_${model.id}.txt`);
    writeFileSync(rawPath, usageResult.raw_text);
    console.error(`Parse failed: ${(e as Error).message}`);
    console.error(`Raw response saved: ${rawPath}`);
    process.exit(1);
  }

  const plansDir = join(runnerRoot(), "results", "plans");
  if (!existsSync(plansDir)) mkdirSync(plansDir, { recursive: true });
  const outPath = outArg ?? join(plansDir, `${packId}.json`);

  const payload = {
    meta: {
      snapshot_id: packId,
      repo: pack.meta.repo?.full_name,
      model: model.id,
      model_slug: usageResult.model_used,
      usd: usageResult.usd,
      input_tokens: usageResult.input_tokens,
      output_tokens: usageResult.output_tokens,
      latency_ms: usageResult.latency_ms,
      generated_at: new Date().toISOString(),
      propose_only: true,
    },
    plan,
  };

  writeFileSync(outPath, JSON.stringify(payload, null, 2));

  const rawDir = join(runnerRoot(), "results", "raw");
  if (!existsSync(rawDir)) mkdirSync(rawDir, { recursive: true });
  writeFileSync(join(rawDir, `plan_${packId}_${model.id}.txt`), usageResult.raw_text);

  console.log(`\n✓ Plan (${plan.operations.length} ops) → ${outPath}`);
  console.log(`  $${usageResult.usd.toFixed(4)} · ${usageResult.latency_ms}ms · ${usageResult.model_used}`);
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

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
