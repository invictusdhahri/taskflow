import { completePlan } from "./openrouter.js";
import type { RosterEntry } from "./roster.js";
import type { ModelConfig, PlanOperation } from "./types.js";

const RENDER_INSTRUCTIONS = `You are TaskFlow rendering ONE GitHub issue body for a proposed change.

Follow Template A from the skill's templates.md exactly — same section headings, in the same order, fully filled in. Do not leave literal placeholders behind (no "...", no "path/to/file", no unresolved "X / Y / Z" style choices) — either write real content or an explicit "N/A — <reason>".

Return ONLY the raw markdown body (no JSON, no code fences, no commentary before or after it). The very first line must be the idempotency marker given below, verbatim.`;

/**
 * The idempotency marker is an HTML comment, which GitHub renders as invisible —
 * a body that is just the marker (empty/refused/truncated completion) looks like
 * "No description provided." on the issue page even though `body` is non-empty.
 * Strip comments before judging whether there's anything a human would actually see.
 */
function visibleContentLength(raw: string): number {
  return raw.replace(/<!--[\s\S]*?-->/g, "").trim().length;
}

/** Renders the actual Template A markdown body for one CREATE_ISSUE op, via one OpenRouter call. */
export async function renderIssueBody(opts: {
  model: ModelConfig;
  fallbackModel?: ModelConfig;
  skill: string;
  op: PlanOperation;
  /** JSON-stringified github/codebase context relevant to this op. */
  evidence: string;
  roster: RosterEntry[];
  marker: string;
  maxUsd: number;
}): Promise<string> {
  const { model, fallbackModel, skill, op, evidence, roster, marker, maxUsd } = opts;
  const system = `You follow TaskFlow skill rules.\n\n${skill}`;
  const user = `${RENDER_INSTRUCTIONS}

Idempotency marker (must be the first line, verbatim): ${marker}

## Proposed operation
\`\`\`json
${JSON.stringify(op, null, 2)}
\`\`\`

## Roster (assignable collaborators + skill tags)
\`\`\`json
${JSON.stringify(roster, null, 2)}
\`\`\`

## Evidence
${evidence}`;

  const usage = await completePlan({ model, fallbackModel, system, user, maxUsdPerRun: maxUsd });
  const raw = usage.raw_text.trim();
  if (visibleContentLength(raw) < 20) {
    throw new Error(
      `${model.slug} (routed ${usage.model_used}) returned a blank/near-blank issue body for ${op.id} — refusing to create an issue with no visible description`,
    );
  }
  const body = raw.startsWith(marker) ? raw : `${marker}\n\n${raw}`;
  return body;
}
