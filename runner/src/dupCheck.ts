import { completePlan } from "./openrouter.js";
import { extractJsonObject } from "./score.js";
import type { ModelConfig } from "./types.js";

export interface OpenIssueForDupCheck {
  number: number;
  title: string;
  body_excerpt: string;
}

export interface DupCandidate {
  op_id: string;
  title: string;
  rendered_body: string;
}

export interface DupCheckResult {
  op_id: string;
  /** False when the model returned no verdict for this op — treated as unresolved, not as "clean". */
  checked: boolean;
  duplicate: boolean;
  duplicate_of?: number;
  reasoning: string;
}

const DUP_CHECK_INSTRUCTIONS = `You are TaskFlow checking proposed new issues against currently OPEN issues for duplicates.

Per the skill: "compare intent, affected surface, acceptance criteria, and delivery state — not title keywords alone." A near-identical title is not sufficient evidence of a duplicate, and a different title is not sufficient evidence of a non-duplicate — compare the actual substance.

Return ONLY valid JSON:
{ "results": [ { "op_id": "OP-01", "duplicate": true, "duplicate_of": 42, "reasoning": "short why" } ] }

One entry per candidate op_id. Omit duplicate_of when duplicate is false. No markdown fences, no prose outside JSON.`;

/** One batched OpenRouter call: proposed candidates vs. freshly-fetched open issues. */
export async function checkDuplicates(opts: {
  model: ModelConfig;
  openIssues: OpenIssueForDupCheck[];
  candidates: DupCandidate[];
  maxUsd: number;
}): Promise<DupCheckResult[]> {
  const { model, openIssues, candidates, maxUsd } = opts;
  if (!candidates.length) return [];

  const unresolved = (reason: string): DupCheckResult[] =>
    candidates.map((c) => ({ op_id: c.op_id, checked: false, duplicate: false, reasoning: reason }));

  if (!openIssues.length) {
    return candidates.map((c) => ({
      op_id: c.op_id,
      checked: true,
      duplicate: false,
      reasoning: "no open issues to compare against",
    }));
  }

  const system = "You follow TaskFlow skill rules for duplicate detection.";
  const payload = {
    open_issues: openIssues,
    candidates: candidates.map((c) => ({
      op_id: c.op_id,
      title: c.title,
      body_excerpt: c.rendered_body.slice(0, 3000),
    })),
  };
  const user = `${DUP_CHECK_INSTRUCTIONS}\n\n## Payload\n\`\`\`json\n${JSON.stringify(payload, null, 2)}\n\`\`\``;

  let raw: string;
  try {
    const usage = await completePlan({ model, system, user, maxUsdPerRun: maxUsd });
    raw = usage.raw_text;
  } catch (e) {
    return unresolved(`duplicate check call failed: ${(e as Error).message}`);
  }

  let json: { results?: Array<Partial<DupCheckResult>> };
  try {
    json = extractJsonObject(raw) as typeof json;
  } catch (e) {
    return unresolved(`duplicate check response unparseable: ${(e as Error).message}`);
  }

  const byId = new Map((json.results ?? []).map((r) => [r.op_id, r]));
  return candidates.map((c) => {
    const r = byId.get(c.op_id);
    if (!r) {
      return {
        op_id: c.op_id,
        checked: false,
        duplicate: false,
        reasoning: "no verdict returned by model for this op",
      };
    }
    return {
      op_id: c.op_id,
      checked: true,
      duplicate: Boolean(r.duplicate),
      duplicate_of: typeof r.duplicate_of === "number" ? r.duplicate_of : undefined,
      reasoning: r.reasoning ?? "",
    };
  });
}
