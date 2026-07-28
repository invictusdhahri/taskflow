import type { ComplexityBand, FixturePack } from "./types.js";

/**
 * Heuristic L/M/H from fixture evidence (no LLM).
 */
export function classifyFixture(pack: FixturePack): ComplexityBand {
  if (pack.meta.band) return pack.meta.band;

  const openIssues = pack.issues.filter((i) => i.state === "open").length;
  const hasProject = Boolean(pack.project?.title || pack.project?.items?.length);
  const vague = pack.issues.filter(
    (i) => !i.body || i.body.length < 80 || !/caveman|done when|acceptance/i.test(i.body),
  ).length;

  if (pack.meta.mode === 1 || openIssues < 8) return "L";
  if (openIssues > 60 || vague > 20 || (hasProject && vague > 10)) return "H";
  return "M";
}

export function scoreBandFromCounts(openIssues: number, vagueRate: number): ComplexityBand {
  if (openIssues < 15 && vagueRate < 0.3) return "L";
  if (openIssues > 80 || vagueRate > 0.5) return "H";
  return "M";
}
