#!/usr/bin/env node
/**
 * Apply a propose-only plan: executes CREATE_ISSUE operations as real GitHub
 * issues, gated onto Status=Ready (assigned) vs Status=Backlog (unassigned +
 * note) by a live duplicate check plus the Definition of Ready check. Every
 * other op type in the plan stays propose-only in this v1 — logged as
 * skipped, still requiring the human/chat skill flow.
 *
 *   pnpm apply -- --plan results/plans/<id>.json
 *   pnpm apply -- --plan results/plans/<id>.json --dry-run
 */
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkDefinitionOfReady, type DorResult } from "./dor.js";
import { checkDuplicates, type DupCheckResult, type OpenIssueForDupCheck } from "./dupCheck.js";
import { ghJson, ghRun } from "./gh.js";
import { loadSkillContext, runnerRoot } from "./loadSkill.js";
import { DEFAULT_MODEL, getFallbackModel, getModelById } from "./models.js";
import { defaultMaxUsdPerRun } from "./openrouter.js";
import { renderIssueBody } from "./renderBody.js";
import { buildRoster, type RosterEntry } from "./roster.js";
import type { BenchPlan, ModelConfig, PlanOperation } from "./types.js";

function argValue(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  if (i < 0) return undefined;
  return args[i + 1];
}

function hasFlag(args: string[], name: string): boolean {
  return args.includes(name);
}

function usage(): never {
  console.log(`TaskFlow apply — executes CREATE_ISSUE ops from a plan, gated onto Ready/Backlog.

Usage:
  pnpm apply -- --plan results/plans/<id>.json [options]

Options:
  --plan PATH           Required. Plan JSON produced by \`pnpm plan\`.
  --dry-run             Render + duplicate-check as normal; skip gh writes.
  --roster PATH         Local roster JSON override (skip live collaborator/roster fetch).
  --max-creates N        Cap issues created in one run (default 5).
  --project-owner OWNER  Project owner, when ambiguous or not the repo owner.
  --project-number N     Project number, when the repo has more than one.
  --model ID             Override model (default: gemini-flash).
  --max-usd N            Soft per-call cost cap (default TASKFLOW_MAX_USD_PER_RUN or 0.4).
  --out PATH             Write apply-report JSON here (default results/runs/apply_<id>_<ts>.json).

Requires a Projects v2 board with a Status field (Backlog/Ready options) already set up
on the target repo — bootstrap it once via the interactive TaskFlow skill first. apply.ts
fails fast rather than auto-provisioning a board.
`);
  process.exit(1);
}

interface PlanFile {
  meta: Record<string, unknown> & { repo?: string; repos?: string[]; snapshot_id?: string };
  plan: BenchPlan;
}

interface ProjectRef {
  owner: string;
  number: number;
  id: string;
}

interface StatusField {
  fieldId: string;
  readyOptionId: string;
  backlogOptionId: string;
}

/** Projects explicitly linked to this repo (GitHub's own repo-project link), not just guessed from the owner's full list. */
function findLinkedProjects(repo: string): Array<{ number: number; title: string }> {
  const [owner, name] = repo.split("/");
  const res = ghJson<{
    data?: { repository?: { projectsV2?: { nodes?: Array<{ number: number; title: string }> } } };
  }>([
    "api",
    "graphql",
    "-f",
    `query=query{repository(owner:"${owner}",name:"${name}"){projectsV2(first:10){nodes{number title}}}}`,
  ]);
  return res.data?.repository?.projectsV2?.nodes ?? [];
}

function resolveProject(
  repo: string,
  opts: { projectOwner?: string; projectNumber?: number },
): ProjectRef {
  const repoOwner = repo.split("/")[0]!;
  const owner = opts.projectOwner ?? repoOwner;
  let number = opts.projectNumber;

  // Prefer a Project explicitly linked to this repo — reliable regardless of
  // its title (e.g. "@user's untitled project" still counts), and avoids
  // needing --project-owner/--project-number just because the account has
  // other, unrelated Projects.
  if (number == null) {
    const linked = findLinkedProjects(repo);
    if (linked.length === 1) {
      number = linked[0]!.number;
    }
  }

  if (number == null) {
    const list = ghJson<{ projects?: Array<{ number: number; title: string }> }>([
      "project",
      "list",
      "--owner",
      owner,
      "--limit",
      "100",
      "--format",
      "json",
    ]);
    const projects = list.projects ?? [];
    if (projects.length !== 1) {
      throw new Error(
        projects.length === 0
          ? `No Projects found for owner ${owner}. Bootstrap a Board with a Status field via the TaskFlow skill first, or pass --project-owner/--project-number.`
          : `${projects.length} Projects found for owner ${owner} (${projects
              .map((p) => `#${p.number} ${p.title}`)
              .join(", ")}), and none is uniquely linked to ${repo}. Pass --project-owner/--project-number to disambiguate.`,
      );
    }
    number = projects[0]!.number;
  }

  const view = ghJson<{ id?: string }>([
    "project",
    "view",
    String(number),
    "--owner",
    owner,
    "--format",
    "json",
  ]);
  if (!view.id) {
    throw new Error(`gh project view returned no id for ${owner}/#${number}`);
  }
  return { owner, number, id: view.id };
}

function resolveStatusField(project: ProjectRef): StatusField {
  const fields = ghJson<{
    fields: Array<{ id: string; name: string; options?: Array<{ id: string; name: string }> }>;
  }>(["project", "field-list", String(project.number), "--owner", project.owner, "--format", "json"]);

  const status = fields.fields.find((f) => f.name.toLowerCase() === "status");
  if (!status?.options) {
    throw new Error(
      `Project ${project.owner}/#${project.number} has no Status single-select field. Bootstrap the board via the TaskFlow skill first.`,
    );
  }
  const ready = status.options.find((o) => o.name.toLowerCase() === "ready");
  const backlog = status.options.find((o) => o.name.toLowerCase() === "backlog");
  if (!ready || !backlog) {
    throw new Error(
      `Project ${project.owner}/#${project.number} Status field is missing Ready/Backlog options ` +
        `(has: ${status.options.map((o) => o.name).join(", ")}). Bootstrap the board via the TaskFlow skill first.`,
    );
  }
  return { fieldId: status.id, readyOptionId: ready.id, backlogOptionId: backlog.id };
}

function createIssue(repo: string, title: string, body: string): { number: number; url: string } {
  const tmpPath = join(tmpdir(), `taskflow-issue-${randomUUID()}.md`);
  writeFileSync(tmpPath, body);
  try {
    const out = ghRun(["issue", "create", "--repo", repo, "--title", title, "--body-file", tmpPath]);
    const url = out.trim().split("\n").pop() ?? "";
    const m = /\/issues\/(\d+)/.exec(url);
    if (!m) {
      throw new Error(`Could not parse issue number from gh issue create output: ${out}`);
    }
    return { number: Number(m[1]), url };
  } finally {
    unlinkSync(tmpPath);
  }
}

function addToProject(project: ProjectRef, issueUrl: string): string {
  const res = ghJson<{ id?: string }>([
    "project",
    "item-add",
    String(project.number),
    "--owner",
    project.owner,
    "--url",
    issueUrl,
    "--format",
    "json",
  ]);
  if (!res.id) {
    throw new Error(`gh project item-add returned no item id for ${issueUrl}: ${JSON.stringify(res)}`);
  }
  return res.id;
}

function setStatus(project: ProjectRef, statusField: StatusField, itemId: string, ready: boolean): void {
  ghRun([
    "project",
    "item-edit",
    "--id",
    itemId,
    "--project-id",
    project.id,
    "--field-id",
    statusField.fieldId,
    "--single-select-option-id",
    ready ? statusField.readyOptionId : statusField.backlogOptionId,
  ]);
}

function assignIssue(repo: string, issueNumber: number, login: string): void {
  ghRun(["issue", "edit", String(issueNumber), "--repo", repo, "--add-assignee", login]);
}

/** Resolves which repo an op targets. Single-repo plans (one member) ignore op.repo entirely. */
function resolveOpRepo(op: PlanOperation, repoList: string[]): string {
  if (repoList.length === 1) return repoList[0]!;
  if (!op.repo || !repoList.includes(op.repo)) {
    throw new Error(
      `Op ${op.id} has a missing/unknown repo "${op.repo}" — expected one of: ${repoList.join(", ")}`,
    );
  }
  return op.repo;
}

interface RepoContext {
  openIssues: OpenIssueForDupCheck[];
  roster: RosterEntry[];
  collabSet: Set<string>;
}

interface OpResult {
  op_id: string;
  repo?: string;
  title?: string;
  action: string;
  issue_number?: number;
  issue_url?: string;
  status?: "Ready" | "Backlog";
  assignee?: string;
  dor?: DorResult;
  duplicate?: { checked: boolean; flagged: boolean; duplicate_of?: number; reasoning?: string };
  note?: string;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2).filter((a) => a !== "--");
  if (!args.length || hasFlag(args, "-h") || hasFlag(args, "--help")) usage();

  const planPath = argValue(args, "--plan");
  if (!planPath) usage();

  const dryRun = hasFlag(args, "--dry-run");
  const rosterArg = argValue(args, "--roster");
  const maxCreates = Number(argValue(args, "--max-creates") ?? 5);
  const projectOwnerArg = argValue(args, "--project-owner");
  const projectNumberArg = argValue(args, "--project-number");
  const maxUsd = Number(argValue(args, "--max-usd") ?? defaultMaxUsdPerRun());
  const modelArg = argValue(args, "--model");
  const outArg = argValue(args, "--out");

  const model: ModelConfig = modelArg
    ? (getModelById(modelArg) ??
      (() => {
        throw new Error(`Unknown model: ${modelArg}`);
      })())
    : DEFAULT_MODEL;
  const fallbackModel = getFallbackModel(model);

  const planFile = JSON.parse(readFileSync(planPath, "utf8")) as PlanFile;
  const repoList: string[] = planFile.meta.repos?.length
    ? planFile.meta.repos
    : planFile.meta.repo
      ? [planFile.meta.repo]
      : [];
  if (!repoList.length) throw new Error(`Plan ${planPath} has no meta.repo or meta.repos`);
  const snapshotId = planFile.meta.snapshot_id ?? "unknown";

  const createOps = planFile.plan.operations.filter((op) => op.type === "CREATE_ISSUE");
  const otherOps = planFile.plan.operations.filter((op) => op.type !== "CREATE_ISSUE");
  const capped = createOps.slice(0, maxCreates);
  const overflow = createOps.slice(maxCreates);

  console.log(
    `Apply: ${repoList.join(", ")} · create_ops=${createOps.length}` +
      (overflow.length ? ` (capped to ${capped.length}, ${overflow.length} over --max-creates)` : "") +
      ` · other_ops=${otherOps.length} (not executed by apply.ts v1)`,
  );

  // Fail fast if there's nowhere to write Status — per the decided precondition,
  // this never auto-provisions a board. One shared Project across repos is already
  // how Projects v2 works, so this stays a single resolution even for group plans.
  const project = resolveProject(repoList[0]!, {
    projectOwner: projectOwnerArg,
    projectNumber: projectNumberArg ? Number(projectNumberArg) : undefined,
  });
  const statusField = resolveStatusField(project);
  console.log(`  project=${project.owner}/#${project.number} status_field=${statusField.fieldId}`);

  const skill = loadSkillContext();

  // Duplicate-checking and assignee-matching are inherently repo-scoped — fetch
  // open issues + roster once per member repo, lazily, and reuse across its ops.
  const repoContextCache = new Map<string, RepoContext>();
  function getRepoContext(targetRepo: string): RepoContext {
    const cached = repoContextCache.get(targetRepo);
    if (cached) return cached;
    const openIssuesRaw = ghJson<Array<{ number: number; title: string; body: string; url: string }>>([
      "issue",
      "list",
      "--repo",
      targetRepo,
      "--state",
      "open",
      "--json",
      "number,title,body,url",
      "--limit",
      "1000",
    ]);
    const openIssues: OpenIssueForDupCheck[] = openIssuesRaw.map((i) => ({
      number: i.number,
      title: i.title,
      body_excerpt: (i.body ?? "").slice(0, 500),
    }));
    const roster = buildRoster(targetRepo, rosterArg ? { rosterPath: rosterArg } : {});
    const ctx: RepoContext = { openIssues, roster, collabSet: new Set(roster.map((r) => r.login)) };
    repoContextCache.set(targetRepo, ctx);
    return ctx;
  }

  const results: OpResult[] = otherOps.map((op) => ({
    op_id: op.id,
    title: op.title,
    action: "skipped (not executed by apply.ts v1)",
  }));

  if (capped.length) {
    // Resolve + validate target repo for every op up front — fail fast on a
    // bad/unknown repo tag before rendering or writing anything.
    const targetRepoByOp = new Map<string, string>(
      capped.map((op) => [op.id, resolveOpRepo(op, repoList)]),
    );

    const rendered = new Map<string, string>();
    for (const op of capped) {
      const ctx = getRepoContext(targetRepoByOp.get(op.id)!);
      const marker = `<!-- taskflow:${snapshotId}:${op.id} -->`;
      const evidence = JSON.stringify({ title: op.title, reason: op.reason }, null, 2);
      const body = await renderIssueBody({
        model,
        fallbackModel,
        skill,
        op,
        evidence,
        roster: ctx.roster,
        marker,
        maxUsd,
      });
      rendered.set(op.id, body);
    }

    // Duplicate-check is batched per target repo (one call per repo, not per op),
    // since it needs to compare against that repo's own open issues.
    const opsByRepo = new Map<string, PlanOperation[]>();
    for (const op of capped) {
      const targetRepo = targetRepoByOp.get(op.id)!;
      const list = opsByRepo.get(targetRepo) ?? [];
      list.push(op);
      opsByRepo.set(targetRepo, list);
    }
    const dupById = new Map<string, DupCheckResult>();
    for (const [targetRepo, ops] of opsByRepo) {
      const ctx = getRepoContext(targetRepo);
      const dupResults = await checkDuplicates({
        model,
        fallbackModel,
        openIssues: ctx.openIssues,
        candidates: ops.map((op) => ({
          op_id: op.id,
          title: op.title ?? op.id,
          rendered_body: rendered.get(op.id) ?? "",
        })),
        maxUsd,
      });
      for (const d of dupResults) dupById.set(d.op_id, d);
    }

    for (const op of capped) {
      const targetRepo = targetRepoByOp.get(op.id)!;
      const ctx = getRepoContext(targetRepo);
      const body = rendered.get(op.id) ?? "";
      const dor = checkDefinitionOfReady(body);
      const dup = dupById.get(op.id);
      const duplicateClean = Boolean(dup?.checked && !dup.duplicate);
      const assigneeOk = Boolean(
        op.suggested_assignee &&
          op.assignee_confidence === "confident" &&
          ctx.collabSet.has(op.suggested_assignee),
      );

      let note: string | undefined;
      let ready = false;
      if (!duplicateClean) {
        note =
          dup?.duplicate && dup.duplicate_of
            ? `possible duplicate of #${dup.duplicate_of}`
            : dup?.checked === false
              ? `duplicate check unresolved for this op (${dup.reasoning})`
              : "possible duplicate";
      } else if (!dor.passed) {
        note = `Definition of Ready failed: ${dor.failed_items.join(", ")}`;
      } else if (!assigneeOk) {
        note = op.suggested_assignee
          ? `assignee suggestion "${op.suggested_assignee}" not confident or not a current collaborator`
          : "no confident roster match for an assignee";
      } else {
        ready = true;
      }

      const duplicateSummary = {
        checked: Boolean(dup?.checked),
        flagged: Boolean(dup?.duplicate),
        duplicate_of: dup?.duplicate_of,
        reasoning: dup?.reasoning,
      };

      if (dryRun) {
        results.push({
          op_id: op.id,
          repo: targetRepo,
          title: op.title,
          action: "would_create",
          status: ready ? "Ready" : "Backlog",
          assignee: ready ? op.suggested_assignee : undefined,
          dor,
          duplicate: duplicateSummary,
          note,
        });
        console.log(
          `  [dry-run] ${op.id} [${targetRepo}] → would create (${ready ? "Ready" : "Backlog"}${note ? `: ${note}` : ""})`,
        );
        continue;
      }

      const created = createIssue(targetRepo, op.title ?? op.id, body);
      const itemId = addToProject(project, created.url);
      setStatus(project, statusField, itemId, ready);
      if (ready && op.suggested_assignee) {
        assignIssue(targetRepo, created.number, op.suggested_assignee);
      }

      results.push({
        op_id: op.id,
        repo: targetRepo,
        title: op.title,
        action: "created",
        issue_number: created.number,
        issue_url: created.url,
        status: ready ? "Ready" : "Backlog",
        assignee: ready ? op.suggested_assignee : undefined,
        dor,
        duplicate: duplicateSummary,
        note,
      });
      console.log(
        `  ${op.id} [${targetRepo}] → ${created.url} (${ready ? "Ready" : "Backlog"}${ready && op.suggested_assignee ? `, @${op.suggested_assignee}` : ""})`,
      );
    }
  }

  for (const op of overflow) {
    results.push({
      op_id: op.id,
      title: op.title,
      action: `skipped (over --max-creates=${maxCreates})`,
    });
  }

  const summary = {
    created: results.filter((r) => r.action === "created").length,
    would_create: results.filter((r) => r.action === "would_create").length,
    ready: results.filter((r) => r.status === "Ready").length,
    backlog: results.filter((r) => r.status === "Backlog").length,
    skipped: results.filter((r) => r.action.startsWith("skipped")).length,
  };

  const runsDir = join(runnerRoot(), "results", "runs");
  if (!existsSync(runsDir)) mkdirSync(runsDir, { recursive: true });
  const outPath = outArg ?? join(runsDir, `apply_${snapshotId}_${Date.now()}.json`);
  writeFileSync(
    outPath,
    JSON.stringify(
      {
        meta: {
          ...(repoList.length === 1 ? { repo: repoList[0] } : { repos: repoList }),
          snapshot_id: snapshotId,
          dry_run: dryRun,
          project: `${project.owner}/#${project.number}`,
          generated_at: new Date().toISOString(),
        },
        results,
        summary,
      },
      null,
      2,
    ),
  );

  console.log(`\n${dryRun ? "[dry-run] " : ""}✓ apply report → ${outPath}`);
  console.log(
    `  created=${summary.created} would_create=${summary.would_create} ready=${summary.ready} backlog=${summary.backlog} skipped=${summary.skipped}`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
