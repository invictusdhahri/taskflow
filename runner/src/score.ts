import type { BenchPlan, ExpectSpec, FixturePack, OpType, PlanOperation } from "./types.js";

const ISSUE_TOUCHING: OpType[] = [
  "CREATE_ISSUE",
  "UPDATE_ISSUE",
  "DEDUPLICATE",
  "KEEP",
  "CLOSE_ISSUE",
  "REOPEN_ISSUE",
];

function countType(ops: PlanOperation[], type: OpType): number {
  return ops.filter((o) => o.type === type).length;
}

function inventedIssuePenalty(ops: PlanOperation[], known: number[]): number {
  if (!known.length) return 0;
  const knownSet = new Set(known);
  let bad = 0;
  for (const op of ops) {
    if (op.issue_number != null && !knownSet.has(op.issue_number) && op.type !== "CREATE_ISSUE") {
      bad += 1;
    }
    if (op.duplicate_of != null && !knownSet.has(op.duplicate_of)) {
      bad += 1;
    }
    // Targets like #12 or bare issue numbers (common on DEDUPLICATE ops).
    const m = op.target?.match(/#(\d+)/);
    const bare = op.target?.match(/^\d+$/);
    const targetIssue = m ? Number(m[1]) : bare ? Number(op.target) : null;
    if (targetIssue != null && op.type !== "CREATE_ISSUE" && !knownSet.has(targetIssue)) {
      bad += 1;
    }
  }
  return Math.min(30, bad * 10);
}

function duplicateCreatePenalty(ops: PlanOperation[], surfaces: string[]): number {
  if (!surfaces.length) return 0;
  const creates = ops.filter((o) => o.type === "CREATE_ISSUE");
  let hits = 0;
  for (const surface of surfaces) {
    const re = new RegExp(surface, "i");
    const matching = creates.filter((c) => re.test(c.title ?? "") || re.test(c.reason ?? ""));
    if (matching.length > 1) hits += matching.length - 1;
  }
  return Math.min(25, hits * 12);
}

function qualityFlagsScore(ops: PlanOperation[], require: boolean): number {
  if (!require) return 15;
  const relevant = ops.filter((o) => o.type === "CREATE_ISSUE" || o.type === "UPDATE_ISSUE");
  if (!relevant.length) return 15;
  let ok = 0;
  for (const op of relevant) {
    if (op.has_caveman && op.has_files && op.has_ac) ok += 1;
    else if (op.has_caveman && (op.has_files || op.has_ac)) ok += 0.5;
  }
  return Math.round((ok / relevant.length) * 25);
}

function typeOverlapScore(ops: PlanOperation[], expect: ExpectSpec): number {
  let score = 40;
  const types = new Set(ops.map((o) => o.type));

  for (const t of expect.must_include_types ?? []) {
    if (!types.has(t)) score -= 8;
  }
  for (const t of expect.forbid_types ?? []) {
    if (types.has(t)) score -= 12;
  }

  const creates = countType(ops, "CREATE_ISSUE");
  if (expect.min_create_issues != null && creates < expect.min_create_issues) {
    score -= 10;
  }
  if (expect.max_create_issues != null && creates > expect.max_create_issues) {
    score -= Math.min(20, (creates - expect.max_create_issues) * 5);
  }

  return Math.max(0, score);
}

function shapeScore(plan: BenchPlan): { ok: boolean; points: number; notes: string[] } {
  const notes: string[] = [];
  let points = 20;
  if (!plan.operations?.length) {
    notes.push("no operations");
    return { ok: false, points: 0, notes };
  }
  if (plan.operations.length > 40) {
    notes.push("too many ops");
    points -= 5;
  }
  for (const op of plan.operations) {
    if (!op.id || !op.type) {
      notes.push("malformed op");
      points -= 5;
    }
  }
  if (!plan.summary) {
    notes.push("missing summary");
    points -= 3;
  }
  return { ok: points >= 10, points: Math.max(0, points), notes };
}

export interface ScoreResult {
  quality_score: number;
  plan_ok: boolean;
  notes: string;
}

/**
 * Deterministic scorer vs expect.json (synthetic) or holdout shape rubric (snapshots).
 */
export function scorePlan(plan: BenchPlan, pack: FixturePack): ScoreResult {
  const expect = pack.expect;
  const shape = shapeScore(plan);
  const notes = [...shape.notes];

  if (expect.holdout) {
    // Holdout: shape + no invented numbers + soft anti-spam
    const invent = inventedIssuePenalty(plan.operations, expect.known_issue_numbers ?? []);
    const creates = countType(plan.operations, "CREATE_ISSUE");
    let spam = 0;
    if (creates > 12) {
      spam = Math.min(20, (creates - 12) * 2);
      notes.push(`create-spam ${creates}`);
    }
    if (invent) notes.push(`invented-issues -${invent}`);
    const quality = Math.max(0, Math.min(100, shape.points + 50 - invent - spam + (shape.ok ? 10 : 0)));
    return {
      quality_score: quality,
      plan_ok: shape.ok,
      notes: notes.join("; ") || "holdout-ok",
    };
  }

  const overlap = typeOverlapScore(plan.operations, expect);
  const flags = qualityFlagsScore(
    plan.operations,
    expect.require_issue_quality_flags !== false,
  );
  const invent = inventedIssuePenalty(plan.operations, expect.known_issue_numbers ?? []);
  const dups = duplicateCreatePenalty(plan.operations, expect.no_duplicate_create_for ?? []);

  if (invent) notes.push(`invented-issues -${invent}`);
  if (dups) notes.push(`dup-create -${dups}`);

  // Bonus: has at least one issue-touching or project op for modes 2/3
  let bonus = 0;
  if (pack.meta.mode >= 2) {
    const touches = plan.operations.some((o) => ISSUE_TOUCHING.includes(o.type));
    if (!touches) {
      notes.push("no issue ops");
      bonus -= 10;
    }
  }
  if (pack.meta.mode === 1) {
    const hasProject = plan.operations.some(
      (o) => o.type === "CREATE_PROJECT" || o.type === "CREATE_ISSUE",
    );
    if (!hasProject) {
      notes.push("mode1 missing project/issues");
      bonus -= 10;
    }
  }

  const raw = shape.points + overlap + flags - invent - dups + bonus;
  const quality_score = Math.max(0, Math.min(100, Math.round(raw)));

  return {
    quality_score,
    plan_ok: shape.ok && quality_score >= 35,
    notes: notes.join("; ") || "ok",
  };
}

/** Soft parse helper if model returns markdown-wrapped JSON. */
export function extractJsonObject(text: string): unknown {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    /* continue */
  }
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence?.[1]) {
    return JSON.parse(fence[1].trim());
  }
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start >= 0 && end > start) {
    return JSON.parse(trimmed.slice(start, end + 1));
  }
  throw new Error("Could not parse JSON plan from model output");
}
