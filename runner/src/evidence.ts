import type { FixturePack } from "./types.js";
import { prioritizeCodebaseFiles, type CodebaseFile } from "./codebase.js";

const DEFAULT_MAX_EVIDENCE_CHARS = Number(process.env.TASKFLOW_MAX_EVIDENCE_CHARS ?? 28_000);
/** Real-repo snapshots with codebase need a larger prompt budget. */
const SNAPSHOT_MAX_EVIDENCE_CHARS = Number(
  process.env.TASKFLOW_SNAPSHOT_MAX_EVIDENCE_CHARS ?? 120_000,
);

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return `${s.slice(0, max)}\n...[truncated]`;
}

function buildCodebaseEvidence(
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

/**
 * Build bounded evidence JSON text for the user prompt.
 */
export function buildEvidenceText(
  pack: FixturePack,
  maxChars?: number,
): string {
  const isSnapshot = pack.meta.kind === "snapshot";
  const budget =
    maxChars ??
    (isSnapshot && pack.codebase?.files.length
      ? SNAPSHOT_MAX_EVIDENCE_CHARS
      : DEFAULT_MAX_EVIDENCE_CHARS);

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

  // Reserve ~55% of budget for codebase on snapshots when present.
  const codebaseBudget =
    isSnapshot && pack.codebase?.files.length
      ? Math.floor(budget * 0.55)
      : 0;

  const codebaseEvidence = pack.codebase?.files.length
    ? buildCodebaseEvidence(pack.codebase.files, codebaseBudget)
    : undefined;

  const payload: Record<string, unknown> = {
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
  };

  if (codebaseEvidence) {
    payload.codebase = {
      branch: pack.codebase!.branch,
      total_files_stored: pack.codebase!.total_files,
      files_in_prompt: codebaseEvidence.files.length,
      files_omitted_from_prompt: codebaseEvidence.omitted,
      note:
        "Full repo text was captured at snapshot time. Use codebase files to infer bugs, missing features, and realistic Files-to-change paths — not issues alone.",
      files: codebaseEvidence.files,
    };
  }

  let text = JSON.stringify(payload, null, 2);
  if (text.length > budget) {
    // Drop issue bodies first
    const slim = {
      ...payload,
      issues: issues.map(({ body: _b, ...rest }) => ({
        ...rest,
        body: "(omitted for budget)",
      })),
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

export const PLAN_JSON_INSTRUCTIONS = `You are TaskFlow in propose-only mode.
Using the skill rules and the frozen GitHub evidence JSON, produce a versioned GITHUB CHANGE PLAN.

When \`codebase.files\` is present, read the actual source — infer bugs, gaps, and features from code + issues together. Reference real file paths from the codebase in UPDATE/CREATE operations (set has_files true when the plan cites concrete paths).

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
      "has_ac": true
    }
  ]
}

Rules:
- Prefer UPDATE / DEDUPLICATE / KEEP over redundant CREATE.
- Do not invent issue numbers that are not in evidence (except new CREATE_ISSUE which has no number yet).
- Omit optional fields instead of using null.
- For CREATE_ISSUE and UPDATE_ISSUE set has_caveman, has_files, has_ac to true only if your planned body would include Caveman, Files to change, and Acceptance criteria.
- Keep the plan MVP-sized. No GitHub writes will be executed — propose only.`;
