import { z } from "zod";
import { extractJsonObject } from "./score.js";
import type { BenchPlan, OpType } from "./types.js";

const OP_TYPES = [
  "CREATE_REPOSITORY",
  "CREATE_PROJECT",
  "CREATE_VIEW",
  "CREATE_ISSUE",
  "UPDATE_ISSUE",
  "DEDUPLICATE",
  "KEEP",
  "CLOSE_ISSUE",
  "REOPEN_ISSUE",
  "ADD_PROJECT_ITEM",
  "ARCHIVE_PROJECT_ITEM",
  "SET_PROJECT_FIELD",
  "ASSIGN",
  "ADD_LABEL",
  "OTHER",
] as const satisfies readonly OpType[];

/** Treat null/empty as missing; coerce numeric strings for real-model JSON. */
function optionalNumber(value: unknown): number | undefined {
  if (value == null || value === "") return undefined;
  if (typeof value === "number" && !Number.isNaN(value)) return value;
  if (typeof value === "string") {
    const n = Number(value.trim());
    return Number.isNaN(n) ? undefined : n;
  }
  return undefined;
}

/** Models often emit issue refs as bare numbers in target. */
function optionalString(value: unknown): string | undefined {
  if (value == null || value === "") return undefined;
  return String(value);
}

function optionalBool(value: unknown): boolean | undefined {
  if (value == null) return undefined;
  if (typeof value === "boolean") return value;
  if (value === "true") return true;
  if (value === "false") return false;
  return undefined;
}

/** Unrecognized values become undefined rather than failing the whole plan — this is a soft hint field. */
function optionalConfidence(value: unknown): "confident" | "uncertain" | undefined {
  return value === "confident" || value === "uncertain" ? value : undefined;
}

const OpSchema = z.object({
  id: z.string(),
  type: z.enum(OP_TYPES),
  repo: z.preprocess(optionalString, z.string().optional()),
  target: z.preprocess(optionalString, z.string().optional()),
  title: z.preprocess(optionalString, z.string().optional()),
  reason: z.preprocess(optionalString, z.string().optional()),
  issue_number: z.preprocess(optionalNumber, z.number().optional()),
  duplicate_of: z.preprocess(optionalNumber, z.number().optional()),
  has_caveman: z.preprocess(optionalBool, z.boolean().optional()),
  has_files: z.preprocess(optionalBool, z.boolean().optional()),
  has_ac: z.preprocess(optionalBool, z.boolean().optional()),
  has_outcome: z.preprocess(optionalBool, z.boolean().optional()),
  has_scope: z.preprocess(optionalBool, z.boolean().optional()),
  has_test_plan: z.preprocess(optionalBool, z.boolean().optional()),
  has_dependencies: z.preprocess(optionalBool, z.boolean().optional()),
  has_nfr_docs_rollout: z.preprocess(optionalBool, z.boolean().optional()),
  no_open_decision: z.preprocess(optionalBool, z.boolean().optional()),
  fits_two_weeks: z.preprocess(optionalBool, z.boolean().optional()),
  suggested_assignee: z.preprocess(optionalString, z.string().optional()),
  assignee_confidence: z.preprocess(
    optionalConfidence,
    z.enum(["confident", "uncertain"]).optional(),
  ),
  assignee_reason: z.preprocess(optionalString, z.string().optional()),
});

const PlanSchema = z.object({
  plan_version: z.preprocess(optionalString, z.string().default("v1")),
  mode: z.preprocess(
    optionalNumber,
    z.union([z.literal(1), z.literal(2), z.literal(3)]).default(3),
  ),
  summary: z.preprocess(optionalString, z.string().default("")),
  operations: z.array(OpSchema).default([]),
});

export function parsePlan(raw: string): BenchPlan {
  const json = extractJsonObject(raw);
  const parsed = PlanSchema.safeParse(json);
  if (!parsed.success) {
    throw new Error(`Plan schema invalid: ${parsed.error.message}`);
  }
  return parsed.data;
}
