export type ComplexityBand = "L" | "M" | "H";

export type OpType =
  | "CREATE_REPOSITORY"
  | "CREATE_PROJECT"
  | "CREATE_VIEW"
  | "CREATE_ISSUE"
  | "UPDATE_ISSUE"
  | "DEDUPLICATE"
  | "KEEP"
  | "CLOSE_ISSUE"
  | "REOPEN_ISSUE"
  | "ADD_PROJECT_ITEM"
  | "ARCHIVE_PROJECT_ITEM"
  | "SET_PROJECT_FIELD"
  | "ASSIGN"
  | "ADD_LABEL"
  | "OTHER";

export interface FixtureMeta {
  id: string;
  kind: "synthetic" | "snapshot";
  mode: 1 | 2 | 3;
  band: ComplexityBand;
  title: string;
  description: string;
  repo?: {
    owner?: string;
    name?: string;
    full_name?: string;
    default_branch?: string;
    description?: string;
    exists?: boolean;
  };
  snapshot_at?: string;
}

export interface FixtureIssue {
  number: number;
  title: string;
  body?: string | null;
  state: "open" | "closed";
  labels?: string[];
  assignees?: string[];
  milestone?: string | null;
  updated_at?: string;
  project_status?: string | null;
}

export interface FixturePull {
  number: number;
  title: string;
  state: "open" | "closed" | "merged";
  body?: string | null;
  linked_issues?: number[];
  updated_at?: string;
}

export interface FixtureProject {
  title?: string;
  number?: number;
  url?: string;
  fields?: Record<string, string[] | string>;
  items?: Array<{
    issue_number?: number;
    title?: string;
    status?: string;
    priority?: string;
    size?: string;
  }>;
}

export interface ExpectSpec {
  /** Op types that should appear at least once (soft). */
  must_include_types?: OpType[];
  /** Op types that must not appear. */
  forbid_types?: OpType[];
  /** Minimum CREATE_ISSUE count (inclusive). */
  min_create_issues?: number;
  /** Maximum CREATE_ISSUE count (inclusive). */
  max_create_issues?: number;
  /** Issue numbers that exist in evidence — inventing others is penalized. */
  known_issue_numbers?: number[];
  /** Surfaces that must not get duplicate CREATE titles (substring match). */
  no_duplicate_create_for?: string[];
  /** Require Caveman/Files/AC flags on CREATE/UPDATE ops. */
  require_issue_quality_flags?: boolean;
  /** Holdout: score plan shape only. */
  holdout?: boolean;
}

export interface CodebaseFile {
  path: string;
  size: number;
  content: string;
  truncated?: boolean;
}

export interface CodebaseIndex {
  collected_at: string;
  branch: string;
  total_files: number;
  total_bytes: number;
  skipped: Array<{ path: string; reason: string }>;
  files: CodebaseFile[];
}

export interface FixturePack {
  dir: string;
  meta: FixtureMeta;
  issues: FixtureIssue[];
  project: FixtureProject | null;
  pulls: FixturePull[];
  expect: ExpectSpec;
  readme_excerpt?: string;
  file_tree?: string[];
  /** Full text codebase captured at snapshot time (real repos). */
  codebase?: CodebaseIndex;
}

export interface PlanOperation {
  id: string;
  type: OpType;
  target?: string;
  title?: string;
  reason?: string;
  issue_number?: number;
  duplicate_of?: number;
  has_caveman?: boolean;
  has_files?: boolean;
  has_ac?: boolean;
}

export interface BenchPlan {
  plan_version: string;
  mode: 1 | 2 | 3;
  summary: string;
  operations: PlanOperation[];
}

export interface ModelConfig {
  id: string;
  slug: string;
  tier: "cheap" | "mid" | "strong" | "router";
  /** Rough $/M input for pre-flight estimate when usage missing. */
  estInputPerMillion: number;
  estOutputPerMillion: number;
  /** For openrouter/auto-beta */
  costQualityTradeoff?: number;
  allowModels?: string[];
}

export interface RunResult {
  fixture: string;
  model: string;
  model_slug: string;
  repeat: number;
  phase: "smoke" | "matrix" | "holdout";
  usd: number;
  input_tokens: number;
  output_tokens: number;
  latency_ms: number;
  quality_score: number;
  band: ComplexityBand;
  plan_ok: boolean;
  notes: string;
  timestamp: string;
}
