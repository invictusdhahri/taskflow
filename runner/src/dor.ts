/**
 * Authoritative Definition of Ready check (templates.md:105-121), run against the
 * actual rendered issue body — not the model's self-reported has_* booleans, which
 * are cheap ranking hints only. This is the write gate: CREATE_ISSUE only promotes
 * to Status=Ready when this passes. The 11th DoR item (assignee is a real login)
 * is verified separately, live, against freshly-fetched collaborators (see apply.ts).
 */

export interface DorResult {
  passed: boolean;
  failed_items: string[];
}

const OPEN_DECISION_MARKERS = /\b(TBD|TODO|FIXME|open question|needs? a decision|undecided)\b/i;

function extractSection(body: string, heading: string): string {
  const re = new RegExp(`^##\\s+${heading}\\s*$`, "im");
  const match = re.exec(body);
  if (!match) return "";
  const start = match.index + match[0].length;
  const rest = body.slice(start);
  const next = /^##\s+/m.exec(rest);
  return (next ? rest.slice(0, next.index) : rest).trim();
}

/** True if text is empty, whitespace, or just template placeholder ellipses. */
function isBlankOrPlaceholder(text: string): boolean {
  const stripped = text.replace(/<!--.*?-->/gs, "").trim();
  if (!stripped) return true;
  const withoutBullets = stripped.replace(/^[-*]\s*/gm, "").trim();
  return /^\.{2,}$/.test(withoutBullets) || withoutBullets === "";
}

function tableRows(section: string): string[] {
  return section
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.startsWith("|") && !/^\|[\s:-]+\|/.test(l) && !/^\|\s*Path\s*\|/i.test(l));
}

function checkCaveman(body: string): boolean {
  const section = extractSection(body, "Caveman");
  if (!section) return false;
  const problem = /\*\*Problem:\*\*\s*(.+)/i.exec(section)?.[1]?.trim();
  const doThis = /\*\*Do this:\*\*\s*(.+)/i.exec(section)?.[1]?.trim();
  const doneWhen = /\*\*Done when:\*\*\s*(.+)/i.exec(section)?.[1]?.trim();
  return [problem, doThis, doneWhen].every((v) => v && !isBlankOrPlaceholder(v) && v !== "...");
}

function checkFiles(body: string): boolean {
  const section = extractSection(body, "Files to change");
  if (!section) return false;
  if (/\bN\/A\b/i.test(section) && tableRows(section).length === 0) return true;
  const rows = tableRows(section).filter((r) => !/path\/to\/file/i.test(r));
  return rows.length > 0;
}

function checkOutcome(body: string): boolean {
  const section = extractSection(body, "Outcome");
  return !isBlankOrPlaceholder(section) && section.length >= 10;
}

function checkScope(body: string): boolean {
  const scope = extractSection(body, "Scope");
  const outOfScope = extractSection(body, "Out of scope");
  return !isBlankOrPlaceholder(scope) && !isBlankOrPlaceholder(outOfScope);
}

function checkAcceptanceCriteria(body: string): boolean {
  const section = extractSection(body, "Acceptance criteria");
  if (!section) return false;
  const lines = section
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => /^-\s*\[[ x]\]/i.test(l));
  const real = lines.filter((l) => !/Given \.\.\.,? when \.\.\.,? then \.\.\./i.test(l));
  return real.length > 0;
}

function checkTestPlan(body: string): boolean {
  const section = extractSection(body, "Test plan");
  return !isBlankOrPlaceholder(section) && section.length >= 15;
}

function checkDependencies(body: string): boolean {
  const section = extractSection(body, "Dependencies");
  if (!section) return false;
  const blockedBy = /Blocked by:\s*(.+)/i.exec(section)?.[1]?.trim();
  if (!blockedBy) return false;
  if (/None \/ #…? \/ URL…?/i.test(blockedBy)) return false;
  return true;
}

function checkNfrDocsRollout(body: string): boolean {
  const nfr = extractSection(body, "Non-functional requirements");
  const docs = extractSection(body, "Documentation");
  const rollout = extractSection(body, "Release / rollout");
  if (!nfr || !docs || !rollout) return false;
  const nfrFilled =
    tableRows(nfr).some((r) => {
      const cells = r.split("|").map((c) => c.trim());
      return cells[2] && !isBlankOrPlaceholder(cells[2]);
    }) || /N\/A\s*—/i.test(nfr);
  const docsFilled = /-\s*\[x\]/i.test(docs) || /N\/A\s*:\s*\S+/i.test(docs);
  const rolloutFilled = /Done means:\s*(Implemented|Released|Validated)\s*$/im.test(rollout);
  return Boolean(nfrFilled && docsFilled && rolloutFilled);
}

function checkNoOpenDecision(body: string): boolean {
  return !OPEN_DECISION_MARKERS.test(body);
}

function checkFitsTwoWeeks(body: string): boolean {
  const planning = extractSection(body, "Planning");
  return /Size:\s*(S|M|L)\b/i.test(planning);
}

const CHECKS: Array<{ item: string; fn: (body: string) => boolean }> = [
  { item: "has_caveman", fn: checkCaveman },
  { item: "has_files", fn: checkFiles },
  { item: "has_outcome", fn: checkOutcome },
  { item: "has_scope", fn: checkScope },
  { item: "has_ac", fn: checkAcceptanceCriteria },
  { item: "has_test_plan", fn: checkTestPlan },
  { item: "has_dependencies", fn: checkDependencies },
  { item: "has_nfr_docs_rollout", fn: checkNfrDocsRollout },
  { item: "no_open_decision", fn: checkNoOpenDecision },
  { item: "fits_two_weeks", fn: checkFitsTwoWeeks },
];

/** Checks the 10 internally-verifiable Definition of Ready items against a rendered issue body. */
export function checkDefinitionOfReady(body: string): DorResult {
  const failed_items = CHECKS.filter((c) => !c.fn(body)).map((c) => c.item);
  return { passed: failed_items.length === 0, failed_items };
}
