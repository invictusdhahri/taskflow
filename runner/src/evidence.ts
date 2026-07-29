import type { FixturePack } from "./types.js";
import { prioritizeCodebaseFiles, type CodebaseFile } from "./codebase.js";
import type { RosterEntry } from "./roster.js";

const DEFAULT_MAX_EVIDENCE_CHARS = Number(process.env.TASKFLOW_MAX_EVIDENCE_CHARS ?? 28_000);
/** Bench/holdout soft budget — plan path uses buildPlanEvidence (full code). */
const SNAPSHOT_MAX_EVIDENCE_CHARS = Number(
  process.env.TASKFLOW_SNAPSHOT_MAX_EVIDENCE_CHARS ?? 120_000,
);

/** Max JSON chars of source per findings LLM call (plan chunking). */
export function planChunkMaxChars(): number {
  return Number(process.env.TASKFLOW_PLAN_CHUNK_CHARS ?? 350_000);
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return `${s.slice(0, max)}\n...[truncated]`;
}

function buildCodebaseEvidenceBounded(
  files: CodebaseFile[],
  maxChars: number,
): { files: Array<{ path: string; size: number; content: string }>; omitted: number } {
  const ordered = prioritizeCodebaseFiles(files);
  const included: Array<{ path: string; size: number; content: string }> = [];
  let used = 0;
  for (const f of ordered) {
    const entry = { path: f.path, size: f.size, content: f.content };
    const chunk = JSON.stringify(entry);
    if (used + chunk.length > maxChars && included.length > 0) break;
    included.push(entry);
    used += chunk.length;
  }
  return { files: included, omitted: files.length - included.length };
}

function githubMetaPayload(pack: FixturePack, roster?: RosterEntry[]): Record<string, unknown> {
  const issues = pack.issues.map((i) => ({
    number: i.number,
    title: i.title,
    state: i.state,
    labels: i.labels ?? [],
    assignees: i.assignees ?? [],
    project_status: i.project_status ?? null,
    body: truncate(i.body ?? "", 600),
    updated_at: i.updated_at,
  }));

  return {
    meta: pack.meta,
    issues,
    project: pack.project,
    pulls: pack.pulls.map((p) => ({
      number: p.number,
      title: p.title,
      state: p.state,
      linked_issues: p.linked_issues ?? [],
      body: truncate(p.body ?? "", 400),
    })),
    readme_excerpt: pack.readme_excerpt
      ? truncate(pack.readme_excerpt, 2000)
      : undefined,
    file_tree: pack.file_tree?.slice(0, 200),
    ...(roster?.length ? { roster } : {}),
  };
}

/**
 * Bounded evidence for synthetic/bench (may omit code for cost).
 */
export function buildEvidenceText(pack: FixturePack, maxChars?: number): string {
  const isSnapshot = pack.meta.kind === "snapshot";
  const budget =
    maxChars ??
    (isSnapshot && pack.codebase?.files.length
      ? SNAPSHOT_MAX_EVIDENCE_CHARS
      : DEFAULT_MAX_EVIDENCE_CHARS);

  const payload: Record<string, unknown> = githubMetaPayload(pack);

  if (isSnapshot && pack.codebase?.files.length) {
    const codebaseBudget = Math.floor(budget * 0.55);
    const codebaseEvidence = buildCodebaseEvidenceBounded(
      pack.codebase.files,
      codebaseBudget,
    );
    payload.codebase = {
      branch: pack.codebase.branch,
      head_sha: pack.codebase.head_sha,
      total_files_stored: pack.codebase.total_files,
      files_in_prompt: codebaseEvidence.files.length,
      files_omitted_from_prompt: codebaseEvidence.omitted,
      note:
        "Bench budget may omit files. Use `pnpm plan` for full-codebase propose-only runs.",
      files: codebaseEvidence.files,
    };
  }

  let text = JSON.stringify(payload, null, 2);
  if (text.length > budget) {
    const issues = pack.issues.map((i) => ({
      number: i.number,
      title: i.title,
      state: i.state,
      labels: i.labels ?? [],
      assignees: i.assignees ?? [],
      project_status: i.project_status ?? null,
      body: "(omitted for budget)",
      updated_at: i.updated_at,
    }));
    const slim = {
      ...payload,
      issues,
      readme_excerpt: payload.readme_excerpt
        ? truncate(String(payload.readme_excerpt), 500)
        : undefined,
    };
    text = JSON.stringify(slim, null, 2);
  }
  if (text.length > budget) {
    text = truncate(text, budget);
  }
  return text;
}

export interface PlanEvidenceStats {
  chars: number;
  files_total: number;
  files_in_prompt: number;
  files_omitted: number;
  truncated_files: number;
  total_bytes: number;
}

/**
 * Full-codebase evidence for `pnpm plan` — every stored text file, no omit.
 */
export function buildPlanEvidence(
  pack: FixturePack,
  files?: CodebaseFile[],
  roster?: RosterEntry[],
): { text: string; stats: PlanEvidenceStats } {
  const codeFiles = files ?? pack.codebase?.files ?? [];
  if (!pack.codebase && !files?.length) {
    throw new Error(
      "Plan requires codebase_index.json. Re-run without --no-clone, or pass a snapshot that includes code.",
    );
  }

  const payload: Record<string, unknown> = {
    ...githubMetaPayload(pack, roster),
    codebase: {
      branch: pack.codebase?.branch,
      head_sha: pack.codebase?.head_sha,
      total_files_stored: pack.codebase?.total_files ?? codeFiles.length,
      files_in_prompt: codeFiles.length,
      files_omitted_from_prompt: 0,
      note:
        "Full repo text. Infer bugs, gaps, and features from code + issues. Cite real paths (has_files).",
      files: codeFiles.map((f) => ({
        path: f.path,
        size: f.size,
        content_hash: f.content_hash,
        truncated: f.truncated ?? false,
        content: f.content,
      })),
    },
  };

  const text = JSON.stringify(payload, null, 2);
  const truncated_files = codeFiles.filter((f) => f.truncated).length;
  return {
    text,
    stats: {
      chars: text.length,
      files_total: pack.codebase?.total_files ?? codeFiles.length,
      files_in_prompt: codeFiles.length,
      files_omitted: 0,
      truncated_files,
      total_bytes: pack.codebase?.total_bytes ?? codeFiles.reduce((s, f) => s + f.content.length, 0),
    },
  };
}

/** GitHub meta only (no source) — used in merge / findings-only prompts. */
export function buildGithubEvidenceText(pack: FixturePack, roster?: RosterEntry[]): string {
  return JSON.stringify(githubMetaPayload(pack, roster), null, 2);
}

/**
 * Partition files into ordered chunks that fit under maxChars (JSON size of files array).
 * Every file appears in exactly one chunk; never drops files.
 */
export function partitionCodebaseFiles(
  files: CodebaseFile[],
  maxChars = planChunkMaxChars(),
): CodebaseFile[][] {
  if (!files.length) return [];
  const ordered = prioritizeCodebaseFiles(files);
  const chunks: CodebaseFile[][] = [];
  let current: CodebaseFile[] = [];
  let used = 2; // []

  for (const f of ordered) {
    const entry = JSON.stringify({
      path: f.path,
      size: f.size,
      content_hash: f.content_hash,
      content: f.content,
    });
    const add = entry.length + (current.length ? 1 : 0);
    if (current.length > 0 && used + add > maxChars) {
      chunks.push(current);
      current = [];
      used = 2;
    }
    // Single file larger than maxChars: still its own chunk (must not omit).
    if (current.length === 0 && entry.length + 2 > maxChars) {
      chunks.push([f]);
      continue;
    }
    current.push(f);
    used += add;
  }
  if (current.length) chunks.push(current);
  return chunks;
}

const DEPTH_OVER_COVERAGE = `DEPTH OVER COVERAGE — the most important instruction here:
- Do not produce a finding just because a file exists. A single well-reasoned bug that traces an actual broken behavior is worth more than ten generic hygiene notes. It is normal, expected, and preferred for most files to have nothing worth reporting.
- Prioritize what a real user or the business would actually notice: incorrect logic, broken edge cases, data-integrity risk, security gaps, race conditions, silent failures, misleading error handling, a feature that's half-implemented or doesn't do what its name/docs claim.
- Deprioritize — only include if genuinely severe, and say why it's severe: outdated dependencies, missing pagination, code style, "make X configurable," documentation gaps, generic refactoring suggestions. These are almost never worth a CREATE_ISSUE on their own. Do not manufacture one just to have something to report.
- For every finding, name the actual mechanism: the specific input, sequence, or state that triggers the problem, and what a user or the system would observe as a result. "This function is complex" is not a finding. "When X happens while Y is already true, this silently drops the update because Z" is.
- Fewer, sharper findings beat more, shallow ones. Never pad output to fill space.`;

export const PLAN_JSON_INSTRUCTIONS = `You are TaskFlow in propose-only mode.
Using the skill rules and the frozen GitHub evidence JSON, produce a versioned GITHUB CHANGE PLAN.

${DEPTH_OVER_COVERAGE}

When \`codebase.files\` is present, read the actual source — infer bugs, gaps, and features from code + issues together, applying the depth standard above. Reference real file paths from the codebase in UPDATE/CREATE operations (set has_files true when the plan cites concrete paths).

When \`roster\` is present (array of \`{login, skills, source}\`), it lists real assignable collaborators and any known skill tags. For CREATE_ISSUE only: propose \`suggested_assignee\` with \`assignee_confidence: "confident"\` ONLY when exactly one roster login has a clear, unambiguous skill-tag overlap with the issue's subject matter. If multiple logins plausibly match, no login has a matching tag, or roster is absent/empty, omit \`suggested_assignee\` entirely (do not guess). Use \`assignee_reason\` for a short one-line justification when you do suggest someone.

Return ONLY valid JSON (no markdown fences, no prose) matching this schema:
{
  "plan_version": "v1",
  "mode": 1 | 2 | 3,
  "summary": "one sentence critical path / intent",
  "operations": [
    {
      "id": "OP-01",
      "type": "CREATE_REPOSITORY|CREATE_PROJECT|CREATE_VIEW|CREATE_ISSUE|UPDATE_ISSUE|DEDUPLICATE|KEEP|CLOSE_ISSUE|REOPEN_ISSUE|ADD_PROJECT_ITEM|ARCHIVE_PROJECT_ITEM|SET_PROJECT_FIELD|ASSIGN|ADD_LABEL|OTHER",
      "target": "optional #N or project ref (string)",
      "title": "for CREATE_ISSUE / descriptive label",
      "reason": "short why",
      "issue_number": 12,
      "duplicate_of": 10,
      "has_caveman": true,
      "has_files": true,
      "has_ac": true,
      "has_outcome": true,
      "has_scope": true,
      "has_test_plan": true,
      "has_dependencies": true,
      "has_nfr_docs_rollout": true,
      "no_open_decision": true,
      "fits_two_weeks": true,
      "suggested_assignee": "roster-login",
      "assignee_confidence": "confident",
      "assignee_reason": "short why"
    }
  ]
}

Rules:
- Prefer UPDATE / DEDUPLICATE / KEEP over redundant CREATE.
- Do not invent issue numbers that are not in evidence (except new CREATE_ISSUE which has no number yet).
- Omit optional fields instead of using null.
- For CREATE_ISSUE and UPDATE_ISSUE, set the has_* / no_open_decision / fits_two_weeks booleans to true only if your planned body would actually satisfy that Definition of Ready item (has_caveman, has_files, has_ac, has_outcome, has_scope, has_test_plan, has_dependencies, has_nfr_docs_rollout, no_open_decision, fits_two_weeks). These are your own self-assessment hints — they are not the final word on readiness.
- suggested_assignee / assignee_confidence apply to CREATE_ISSUE only, and only per the roster rule above.
- Keep the plan MVP-sized. No GitHub writes will be executed — propose only.`;

export const FINDINGS_JSON_INSTRUCTIONS = `You are TaskFlow analyzing source files for a propose-only GitHub plan.

${DEPTH_OVER_COVERAGE}

Given the skill rules and a JSON payload of source files (and optional GitHub context), return ONLY valid JSON:

{
  "findings": [
    {
      "path": "relative/file.ts",
      "bugs": ["specific mechanism + observable effect, not a vague label"],
      "gaps": ["missing feature or coverage — only if it actually matters"],
      "features": ["suggested work — only if it's a real, well-scoped opportunity"],
      "notes": "optional one-liner"
    }
  ]
}

Rules:
- Most files should NOT appear in this list at all — only include a file when you found something that meets the depth standard above. An empty or near-empty \`findings\` array for a batch of clean files is a correct, good result, not a failure.
- Be concrete; cite symbols, function names, and the actual behavior you saw in the content — not just "this could be improved."
- Do not invent paths that are not in the payload.
- No markdown fences, no prose outside JSON.`;

export const MERGE_JSON_INSTRUCTIONS = `You are TaskFlow in propose-only mode.

You receive:
1) Frozen GitHub evidence (issues, PRs, project, readme, and optionally roster)
2) Codebase findings aggregated from a full-repo (or incremental) analysis

${DEPTH_OVER_COVERAGE}

Not every finding deserves its own CREATE_ISSUE — apply the same depth standard here. A short list of well-reasoned issues beats one CREATE_ISSUE per finding.

Produce a versioned GITHUB CHANGE PLAN. Prefer UPDATE / DEDUPLICATE / KEEP over redundant CREATE.
Use findings + issues together. Cite real file paths when proposing CREATE/UPDATE (has_files).

When \`roster\` is present (array of \`{login, skills, source}\`), for CREATE_ISSUE only: propose \`suggested_assignee\` with \`assignee_confidence: "confident"\` ONLY when exactly one roster login has a clear, unambiguous skill-tag overlap with the issue's subject matter; otherwise omit it.

Return ONLY valid JSON matching:
{
  "plan_version": "v1",
  "mode": 1 | 2 | 3,
  "summary": "one sentence",
  "operations": [ { "id": "OP-01", "type": "...", "title": "...", "reason": "...", "issue_number": 1, "has_caveman": true, "has_files": true, "has_ac": true, "has_outcome": true, "has_scope": true, "has_test_plan": true, "has_dependencies": true, "has_nfr_docs_rollout": true, "no_open_decision": true, "fits_two_weeks": true, "suggested_assignee": "roster-login", "assignee_confidence": "confident", "assignee_reason": "short why" } ]
}

Omit optional fields instead of null. No GitHub writes — propose only. No markdown fences.`;

export const GROUP_MERGE_JSON_INSTRUCTIONS = `You are TaskFlow in propose-only mode, planning a GROUP of related repos together (e.g. a backend and its frontend).

You receive one entry per repo:
{
  "repo": "owner/name",
  "github": { ...frozen GitHub evidence, same shape as single-repo runs, optionally including roster... },
  "findings": [ { "path": "...", "bugs": [...], "gaps": [...], "features": [...], "notes": "..." } ],
  "surface_files": [ { "path": "...", "content": "..." } ]
}

\`findings\` are condensed per-file notes from each repo's own analysis — use them for general awareness. \`surface_files\` are each repo's own declared public-interface files (routes, schemas, exported types) in full text — use these specifically to catch things that only become visible when comparing repos, such as a frontend calling an endpoint/field the backend doesn't define, or a backend response shape a frontend doesn't expect. Do not invent cross-repo issues that aren't actually supported by the surface files or findings.

${DEPTH_OVER_COVERAGE}

Produce ONE versioned GITHUB CHANGE PLAN covering all repos. Every operation MUST set \`"repo"\` to the exact repo string it targets (from the \`repo\` field of one of the input entries) — never omit it, never invent a repo not in the payload. Prefer UPDATE / DEDUPLICATE / KEEP over redundant CREATE, per repo's own issues.

When \`github.roster\` is present for a repo, apply the same suggested_assignee rule as single-repo plans: only propose it for CREATE_ISSUE, only with assignee_confidence "confident" on an unambiguous skill-tag match, scoped to that repo's own roster.

Return ONLY valid JSON matching:
{
  "plan_version": "v1",
  "mode": 1 | 2 | 3,
  "summary": "one sentence",
  "operations": [ { "id": "OP-01", "repo": "owner/name", "type": "...", "title": "...", "reason": "...", "issue_number": 1, "has_caveman": true, "has_files": true, "has_ac": true, "has_outcome": true, "has_scope": true, "has_test_plan": true, "has_dependencies": true, "has_nfr_docs_rollout": true, "no_open_decision": true, "fits_two_weeks": true, "suggested_assignee": "roster-login", "assignee_confidence": "confident", "assignee_reason": "short why" } ]
}

Omit optional fields instead of null. No GitHub writes — propose only. No markdown fences.`;
