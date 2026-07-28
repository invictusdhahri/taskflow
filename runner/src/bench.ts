#!/usr/bin/env node
/**
 * TaskFlow $20 bench CLI
 *
 *   pnpm bench smoke
 *   pnpm bench matrix --models gemini-flash,deepseek-chat,gpt41-mini
 *   pnpm bench holdout --models gemini-flash
 *   pnpm bench report
 */
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  readdirSync,
} from "node:fs";
import { join } from "node:path";
import { classifyFixture } from "./classify.js";
import { buildEvidenceText, PLAN_JSON_INSTRUCTIONS } from "./evidence.js";
import {
  getFixtureById,
  listSnapshotFixtures,
  listSyntheticFixtures,
} from "./fixtures.js";
import { loadSkillContext, runnerRoot } from "./loadSkill.js";
import { DEFAULT_MODEL, SMOKE_MODELS, resolveModels } from "./models.js";
import { completePlan, defaultMaxUsdPerRun } from "./openrouter.js";
import { parsePlan } from "./parsePlan.js";
import { scorePlan } from "./score.js";
import type { FixturePack, ModelConfig, RunResult } from "./types.js";

const RESULTS_DIR = join(runnerRoot(), "results");
const CSV_PATH = join(RESULTS_DIR, "runs.csv");
const SMOKE_PASS_PATH = join(RESULTS_DIR, "smoke-pass.json");

const CSV_HEADER =
  "fixture,model,model_slug,repeat,phase,usd,input_tokens,output_tokens,latency_ms,quality_score,band,plan_ok,notes,timestamp\n";

function ensureResults(): void {
  if (!existsSync(RESULTS_DIR)) mkdirSync(RESULTS_DIR, { recursive: true });
  if (!existsSync(CSV_PATH)) writeFileSync(CSV_PATH, CSV_HEADER);
}

function csvEscape(s: string): string {
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function appendResult(r: RunResult): void {
  ensureResults();
  const line = [
    r.fixture,
    r.model,
    r.model_slug,
    r.repeat,
    r.phase,
    r.usd.toFixed(6),
    r.input_tokens,
    r.output_tokens,
    r.latency_ms,
    r.quality_score,
    r.band,
    r.plan_ok,
    csvEscape(r.notes),
    r.timestamp,
  ].join(",");
  appendFileSync(CSV_PATH, `${line}\n`);

  const runDir = join(RESULTS_DIR, "runs");
  if (!existsSync(runDir)) mkdirSync(runDir, { recursive: true });
  const safe = `${r.phase}_${r.fixture}_${r.model}_r${r.repeat}_${Date.now()}.json`;
  writeFileSync(join(runDir, safe), JSON.stringify(r, null, 2));
}

function argValue(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  if (i < 0) return undefined;
  return args[i + 1];
}

function hasFlag(args: string[], name: string): boolean {
  return args.includes(name);
}

async function runOne(opts: {
  pack: FixturePack;
  model: ModelConfig;
  repeat: number;
  phase: RunResult["phase"];
  skill: string;
  maxUsd: number;
  dryRun: boolean;
}): Promise<RunResult> {
  const { pack, model, repeat, phase, skill, maxUsd, dryRun } = opts;
  const band = classifyFixture(pack);
  const evidence = buildEvidenceText(pack);
  const user = `${PLAN_JSON_INSTRUCTIONS}\n\n## Frozen evidence\n\`\`\`json\n${evidence}\n\`\`\``;
  const system = `You follow TaskFlow skill rules.\n\n${skill}`;

  const timestamp = new Date().toISOString();
  if (dryRun) {
    const r: RunResult = {
      fixture: pack.meta.id,
      model: model.id,
      model_slug: model.slug,
      repeat,
      phase,
      usd: 0,
      input_tokens: 0,
      output_tokens: 0,
      latency_ms: 0,
      quality_score: 0,
      band,
      plan_ok: false,
      notes: "dry-run",
      timestamp,
    };
    console.log(`[dry-run] ${phase} ${pack.meta.id} ${model.id}`);
    return r;
  }

  console.log(`→ ${phase} ${pack.meta.id} × ${model.id} (r${repeat})`);
  try {
    const usage = await completePlan({ model, system, user, maxUsdPerRun: maxUsd });
    let plan_ok = false;
    let quality_score = 0;
    let notes = "";
    try {
      const plan = parsePlan(usage.raw_text);
      const scored = scorePlan(plan, pack);
      plan_ok = scored.plan_ok;
      quality_score = scored.quality_score;
      notes = `${scored.notes}; routed=${usage.model_used}`;
    } catch (e) {
      notes = `parse-fail: ${(e as Error).message.slice(0, 120)}; routed=${usage.model_used}`;
      plan_ok = false;
      quality_score = 0;
    }

    // Persist raw response for debugging
    const rawDir = join(RESULTS_DIR, "raw");
    if (!existsSync(rawDir)) mkdirSync(rawDir, { recursive: true });
    writeFileSync(
      join(rawDir, `${phase}_${pack.meta.id}_${model.id}_r${repeat}.txt`),
      usage.raw_text,
    );

    const r: RunResult = {
      fixture: pack.meta.id,
      model: model.id,
      model_slug: usage.model_used,
      repeat,
      phase,
      usd: usage.usd,
      input_tokens: usage.input_tokens,
      output_tokens: usage.output_tokens,
      latency_ms: usage.latency_ms,
      quality_score,
      band,
      plan_ok,
      notes,
      timestamp,
    };
    appendResult(r);
    console.log(
      `  $${r.usd.toFixed(4)} score=${r.quality_score} ok=${r.plan_ok} ` +
        `tokens=${r.input_tokens}+${r.output_tokens} ${r.latency_ms}ms`,
    );
    return r;
  } catch (e) {
    const r: RunResult = {
      fixture: pack.meta.id,
      model: model.id,
      model_slug: model.slug,
      repeat,
      phase,
      usd: 0,
      input_tokens: 0,
      output_tokens: 0,
      latency_ms: 0,
      quality_score: 0,
      band,
      plan_ok: false,
      notes: `error: ${(e as Error).message.slice(0, 200)}`,
      timestamp,
    };
    appendResult(r);
    console.error(`  FAIL ${model.id}: ${(e as Error).message}`);
    return r;
  }
}

async function cmdSmoke(args: string[]): Promise<void> {
  const dryRun = hasFlag(args, "--dry-run");
  const maxUsd = Number(argValue(args, "--max-usd") ?? defaultMaxUsdPerRun());
  const pack = getFixtureById("F04-messy-duplicates");
  const skill = loadSkillContext();
  console.log(`Smoke: ${SMOKE_MODELS.length} models × ${pack.meta.id} (default prod: ${DEFAULT_MODEL.id})`);
  console.log(`max-usd/run=$${maxUsd}`);

  const results: RunResult[] = [];
  for (const model of SMOKE_MODELS) {
    results.push(
      await runOne({ pack, model, repeat: 1, phase: "smoke", skill, maxUsd, dryRun }),
    );
  }

  const passed = results.filter((r) => r.plan_ok && r.quality_score >= 35);
  const passIds = passed.map((r) => r.model);
  if (!dryRun) {
    writeFileSync(
      SMOKE_PASS_PATH,
      JSON.stringify(
        {
          passed: passIds,
          default_model: DEFAULT_MODEL.id,
          results: results.map((r) => ({
            model: r.model,
            plan_ok: r.plan_ok,
            quality_score: r.quality_score,
            usd: r.usd,
            notes: r.notes,
          })),
        },
        null,
        2,
      ),
    );
  }
  console.log(`\nSmoke pass (${passIds.length}): ${passIds.join(", ") || "(none)"}`);
  console.log(`Total smoke USD ≈ $${results.reduce((s, r) => s + r.usd, 0).toFixed(4)}`);
  if (passIds.length < 3) {
    console.warn(
      "Fewer than 3 models passed. Re-run smoke or loosen fixtures before matrix.",
    );
  }
}

function loadSmokePassIds(): string[] {
  if (!existsSync(SMOKE_PASS_PATH)) {
    throw new Error(
      `Missing ${SMOKE_PASS_PATH}. Run: pnpm bench smoke`,
    );
  }
  const doc = JSON.parse(readFileSync(SMOKE_PASS_PATH, "utf8")) as {
    passed: string[];
  };
  return doc.passed;
}

async function cmdMatrix(args: string[]): Promise<void> {
  const dryRun = hasFlag(args, "--dry-run");
  const maxUsd = Number(argValue(args, "--max-usd") ?? defaultMaxUsdPerRun());
  const repeats = Number(argValue(args, "--repeats") ?? 2);
  const modelsArg = argValue(args, "--models");

  let models: ModelConfig[];
  if (modelsArg) {
    models = resolveModels(modelsArg.split(",").map((s) => s.trim()).filter(Boolean));
  } else {
    const passed = loadSmokePassIds();
    const top = passed.slice(0, 3);
    if (top.length === 0) {
      throw new Error("No smoke-pass models. Pass --models id1,id2,id3 explicitly.");
    }
    models = resolveModels(top);
  }

  const fixtures = listSyntheticFixtures().filter((f) =>
    f.meta.id.startsWith("F0"),
  );
  if (fixtures.length < 4) {
    console.warn(`Expected 4 synthetic fixtures, found ${fixtures.length}`);
  }

  const skill = loadSkillContext();
  console.log(
    `Matrix: ${models.map((m) => m.id).join(", ")} × ${fixtures.map((f) => f.meta.id).join(", ")} × ${repeats}`,
  );

  let totalUsd = 0;
  for (const model of models) {
    for (const pack of fixtures) {
      for (let r = 1; r <= repeats; r++) {
        const result = await runOne({
          pack,
          model,
          repeat: r,
          phase: "matrix",
          skill,
          maxUsd,
          dryRun,
        });
        totalUsd += result.usd;
      }
    }
  }
  console.log(`\nMatrix total USD ≈ $${totalUsd.toFixed(4)}`);
}

async function cmdHoldout(args: string[]): Promise<void> {
  const dryRun = hasFlag(args, "--dry-run");
  const maxUsd = Number(argValue(args, "--max-usd") ?? defaultMaxUsdPerRun());
  const modelsArg = argValue(args, "--models");
  const snapshotsArg = argValue(args, "--snapshots");

  let models: ModelConfig[];
  if (modelsArg) {
    models = resolveModels(modelsArg.split(",").map((s) => s.trim()).filter(Boolean));
  } else {
    const passed = loadSmokePassIds().slice(0, 2);
    if (!passed.length) {
      throw new Error("No smoke-pass models. Pass --models explicitly.");
    }
    models = resolveModels(passed);
  }

  let packs = listSnapshotFixtures();
  if (snapshotsArg) {
    const ids = snapshotsArg.split(",").map((s) => s.trim());
    packs = ids.map((id) => getFixtureById(id));
  }
  if (packs.length === 0) {
    throw new Error(
      "No snapshots under fixtures/snapshots/. Run: pnpm snapshot -- --repo OWNER/REPO --id R01-name",
    );
  }
  // Default list only: cap at 2 snapshots to stay within ~$20 budget.
  if (!snapshotsArg) {
    packs = packs.slice(0, 2);
  }

  const skill = loadSkillContext();
  console.log(
    `Holdout: ${models.map((m) => m.id).join(", ")} × ${packs.map((p) => p.meta.id).join(", ")}`,
  );

  let totalUsd = 0;
  for (const model of models) {
    for (const pack of packs) {
      const result = await runOne({
        pack,
        model,
        repeat: 1,
        phase: "holdout",
        skill,
        maxUsd,
        dryRun,
      });
      totalUsd += result.usd;
    }
  }
  console.log(`\nHoldout total USD ≈ $${totalUsd.toFixed(4)}`);
}

function cmdReport(): void {
  ensureResults();
  if (!existsSync(CSV_PATH)) {
    console.log("No results yet.");
    return;
  }
  const lines = readFileSync(CSV_PATH, "utf8").trim().split("\n").slice(1);
  if (!lines.length) {
    console.log("CSV empty.");
    return;
  }

  type Agg = {
    model: string;
    n: number;
    usd: number;
    scoreSum: number;
    ok: number;
  };
  const byModel = new Map<string, Agg>();

  for (const line of lines) {
    const cols = line.split(",");
    if (cols.length < 12) continue;
    const model = cols[1];
    const usd = Number(cols[5]);
    const score = Number(cols[9]);
    const ok = cols[11] === "true";
    const agg = byModel.get(model) ?? {
      model,
      n: 0,
      usd: 0,
      scoreSum: 0,
      ok: 0,
    };
    agg.n += 1;
    agg.usd += usd;
    agg.scoreSum += score;
    if (ok) agg.ok += 1;
    byModel.set(model, agg);
  }

  console.log("\n## Bench report (by model)\n");
  console.log("| model | runs | avg_score | pass_rate | total_usd |");
  console.log("|-------|------|-----------|-----------|-----------|");
  const rows = [...byModel.values()].sort(
    (a, b) => b.scoreSum / b.n - a.scoreSum / a.n,
  );
  for (const r of rows) {
    console.log(
      `| ${r.model} | ${r.n} | ${(r.scoreSum / r.n).toFixed(1)} | ${((r.ok / r.n) * 100).toFixed(0)}% | $${r.usd.toFixed(4)} |`,
    );
  }

  const totalUsd = rows.reduce((s, r) => s + r.usd, 0);
  console.log(`\nTotal recorded USD ≈ $${totalUsd.toFixed(4)} (budget target $20)`);
  console.log(`CSV: ${CSV_PATH}`);

  const mdPath = join(RESULTS_DIR, "report.md");
  const md = [
    "# TaskFlow bench report",
    "",
    `| model | runs | avg_score | pass_rate | total_usd |`,
    `|-------|------|-----------|-----------|-----------|`,
    ...rows.map(
      (r) =>
        `| ${r.model} | ${r.n} | ${(r.scoreSum / r.n).toFixed(1)} | ${((r.ok / r.n) * 100).toFixed(0)}% | $${r.usd.toFixed(4)} |`,
    ),
    "",
    `Total USD ≈ $${totalUsd.toFixed(4)}`,
    "",
  ].join("\n");
  writeFileSync(mdPath, md);
  console.log(`Wrote ${mdPath}`);

  // scatter-friendly CSV already exists; mention raw count
  const rawCount = existsSync(join(RESULTS_DIR, "raw"))
    ? readdirSync(join(RESULTS_DIR, "raw")).length
    : 0;
  console.log(`Raw responses: ${rawCount}`);
}

function usage(): never {
  console.log(`TaskFlow runner bench

Commands:
  smoke [--dry-run] [--max-usd 0.40]
  matrix [--models id1,id2,id3] [--repeats 2] [--dry-run]
  holdout [--models id1,id2] [--snapshots R01,R02] [--dry-run]
  report

Production default model: ${DEFAULT_MODEL.id} (${DEFAULT_MODEL.slug})
Use \`pnpm plan\` for real-repo propose-only plans.
`);
  process.exit(1);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const cmd = args[0];
  if (!cmd || cmd === "-h" || cmd === "--help") usage();

  ensureResults();

  if (cmd === "smoke") await cmdSmoke(args.slice(1));
  else if (cmd === "matrix") await cmdMatrix(args.slice(1));
  else if (cmd === "holdout") await cmdHoldout(args.slice(1));
  else if (cmd === "report") cmdReport();
  else usage();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
