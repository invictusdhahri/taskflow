#!/usr/bin/env node
/**
 * Read-only gh snapshot → fixtures/snapshots/<id>/
 *
 * Usage:
 *   pnpm snapshot -- --repo OWNER/REPO --id R01-sparse
 *   pnpm snapshot -- --repo OWNER/REPO --id R02-messy --max-issues 40
 *
 * Switch GitHub accounts with `gh auth switch` before running if needed.
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { fixturesRoot } from "./fixtures.js";
import { scoreBandFromCounts } from "./classify.js";
import {
  cleanupClone,
  cloneRepoForSnapshot,
  collectCodebaseFromDir,
  writeCodebaseIndex,
} from "./codebase.js";
import type { FixtureIssue, FixtureMeta, FixtureProject, FixturePull } from "./types.js";

function usage(): never {
  console.log(`Usage: pnpm snapshot -- --repo OWNER/REPO --id R01-name [options]

Options:
  --repo OWNER/REPO   Required. Repository to snapshot (read-only).
  --id ID             Required. Snapshot folder id under fixtures/snapshots/.
  --max-issues N      Max open issues to fetch (default 40).
  --max-pulls N       Max open pulls (default 15).
  --body-chars N      Truncate issue/PR bodies (default 800).
  --mode 1|2|3        Override detected TaskFlow mode.
  --no-clone          Skip git clone + full codebase capture (issues only).
`);
  process.exit(1);
}

function argValue(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  if (i < 0) return undefined;
  return args[i + 1];
}

function ghJson<T>(args: string[]): T {
  const r = spawnSync("gh", args, { encoding: "utf8", maxBuffer: 20 * 1024 * 1024 });
  if (r.status !== 0) {
    throw new Error(`gh ${args.join(" ")} failed: ${r.stderr || r.stdout}`);
  }
  return JSON.parse(r.stdout) as T;
}

function ghText(args: string[]): string {
  const r = spawnSync("gh", args, { encoding: "utf8", maxBuffer: 5 * 1024 * 1024 });
  if (r.status !== 0) return "";
  return r.stdout;
}

function truncate(s: string | null | undefined, n: number): string {
  if (!s) return "";
  return s.length <= n ? s : `${s.slice(0, n)}\n...[truncated]`;
}

export interface SnapshotOptions {
  repo: string;
  id: string;
  maxIssues?: number;
  maxPulls?: number;
  bodyChars?: number;
  modeOverride?: string;
  skipClone?: boolean;
}

/** Read-only snapshot of OWNER/REPO into fixtures/snapshots/<id>. Returns pack dir. */
export function createSnapshot(opts: SnapshotOptions): string {
  const {
    repo,
    id,
    maxIssues = 40,
    maxPulls = 15,
    bodyChars = 800,
    modeOverride,
    skipClone = false,
  } = opts;

  const [owner, name] = repo.split("/");
  if (!owner || !name) {
    throw new Error(`Invalid --repo ${repo}; expected OWNER/REPO`);
  }

  console.log(`Snapshotting ${repo} → fixtures/snapshots/${id} (read-only)...`);

  const repoInfo = ghJson<{
    name: string;
    owner: { login: string };
    defaultBranchRef?: { name: string };
    description?: string;
    url: string;
  }>([
    "repo",
    "view",
    repo,
    "--json",
    "name,owner,defaultBranchRef,description,url",
  ]);

  type GhIssue = {
    number: number;
    title: string;
    body: string;
    state: string;
    labels: Array<{ name: string }>;
    assignees: Array<{ login: string }>;
    milestone?: { title: string } | null;
    updatedAt: string;
  };

  const openIssues = ghJson<GhIssue[]>([
    "issue",
    "list",
    "--repo",
    repo,
    "--state",
    "open",
    "--limit",
    String(maxIssues),
    "--json",
    "number,title,body,state,labels,assignees,milestone,updatedAt",
  ]);

  const closedSample = ghJson<GhIssue[]>([
    "issue",
    "list",
    "--repo",
    repo,
    "--state",
    "closed",
    "--limit",
    "10",
    "--json",
    "number,title,body,state,labels,assignees,milestone,updatedAt",
  ]);

  const issues: FixtureIssue[] = [...openIssues, ...closedSample].map((i) => ({
    number: i.number,
    title: i.title,
    body: truncate(i.body, bodyChars),
    state: i.state.toLowerCase() === "open" ? "open" : "closed",
    labels: (i.labels ?? []).map((l) => l.name),
    assignees: (i.assignees ?? []).map((a) => a.login),
    milestone: i.milestone?.title ?? null,
    updated_at: i.updatedAt,
    project_status: null,
  }));

  type GhPr = {
    number: number;
    title: string;
    body: string;
    state: string;
    mergedAt?: string | null;
    updatedAt: string;
    closingIssuesReferences?: Array<{ number: number }>;
  };

  const prs = ghJson<GhPr[]>([
    "pr",
    "list",
    "--repo",
    repo,
    "--state",
    "open",
    "--limit",
    String(maxPulls),
    "--json",
    "number,title,body,state,mergedAt,updatedAt,closingIssuesReferences",
  ]);

  const pulls: FixturePull[] = prs.map((p) => ({
    number: p.number,
    title: p.title,
    body: truncate(p.body, bodyChars),
    state: p.mergedAt ? "merged" : p.state.toLowerCase() === "open" ? "open" : "closed",
    linked_issues: (p.closingIssuesReferences ?? []).map((x) => x.number),
    updated_at: p.updatedAt,
  }));

  // Best-effort project listing (may fail without project scope)
  let project: FixtureProject | null = null;
  try {
    const projects = ghJson<Array<{ title: string; number: number; url: string }>>([
      "project",
      "list",
      "--owner",
      owner,
      "--limit",
      "20",
      "--format",
      "json",
    ]);
    // gh project list format varies; tolerate shapes
    const list = Array.isArray(projects)
      ? projects
      : ((projects as { projects?: unknown }).projects as typeof projects) ?? [];
    if (Array.isArray(list) && list.length) {
      const first = list[0] as { title?: string; number?: number; url?: string };
      project = {
        title: first.title,
        number: first.number,
        url: first.url,
        items: [],
        fields: {},
      };
    }
  } catch (e) {
    console.warn(`Project list skipped: ${(e as Error).message}`);
  }

  const readme = ghText(["api", `repos/${repo}/readme`, "--jq", ".content"]);
  let readme_excerpt = "";
  if (readme) {
    try {
      readme_excerpt = truncate(Buffer.from(readme.replace(/\n/g, ""), "base64").toString("utf8"), 2000);
    } catch {
      readme_excerpt = "";
    }
  }

  const treeRaw = ghText([
    "api",
    `repos/${repo}/git/trees/${repoInfo.defaultBranchRef?.name ?? "main"}?recursive=1`,
    "--jq",
    "[.tree[] | select(.type==\"blob\") | .path] | .[0:80]",
  ]);
  let file_tree: string[] = [];
  try {
    file_tree = treeRaw ? (JSON.parse(treeRaw) as string[]) : [];
  } catch {
    file_tree = [];
  }

  const vague = openIssues.filter(
    (i) => !i.body || i.body.length < 80 || !/done when|acceptance|caveman/i.test(i.body),
  ).length;
  const vagueRate = openIssues.length ? vague / openIssues.length : 0;
  const band = scoreBandFromCounts(openIssues.length, vagueRate);

  let mode: 1 | 2 | 3 = 3;
  if (modeOverride) {
    mode = Number(modeOverride) as 1 | 2 | 3;
  } else if (openIssues.length === 0 && !project) {
    mode = 1;
  } else if (!project) {
    mode = 2;
  }

  const meta: FixtureMeta = {
    id,
    kind: "snapshot",
    mode,
    band,
    title: `${repo} snapshot`,
    description: `Frozen read-only snapshot of ${repo}`,
    repo: {
      owner: repoInfo.owner.login,
      name: repoInfo.name,
      full_name: repo,
      default_branch: repoInfo.defaultBranchRef?.name,
      description: repoInfo.description,
      exists: true,
    },
    snapshot_at: new Date().toISOString(),
  };

  const outDir = join(fixturesRoot(), "snapshots", id);
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });

  writeFileSync(join(outDir, "meta.json"), JSON.stringify(meta, null, 2));
  writeFileSync(join(outDir, "issues.json"), JSON.stringify(issues, null, 2));
  writeFileSync(join(outDir, "project.json"), JSON.stringify(project, null, 2));
  writeFileSync(join(outDir, "pulls.json"), JSON.stringify(pulls, null, 2));
  writeFileSync(
    join(outDir, "expect.json"),
    JSON.stringify(
      {
        holdout: true,
        known_issue_numbers: issues.map((i) => i.number),
        max_create_issues: 12,
        require_issue_quality_flags: false,
      },
      null,
      2,
    ),
  );
  if (readme_excerpt) {
    writeFileSync(join(outDir, "readme_excerpt.md"), readme_excerpt);
  }
  writeFileSync(join(outDir, "file_tree.json"), JSON.stringify(file_tree, null, 2));

  if (!skipClone) {
    const branch = repoInfo.defaultBranchRef?.name ?? "main";
    console.log(`  Cloning ${repo} (depth 1) for full codebase capture...`);
    let cloneDir = "";
    try {
      cloneDir = cloneRepoForSnapshot(repo, id);
      const codebase = collectCodebaseFromDir(cloneDir, branch);
      writeCodebaseIndex(outDir, codebase);
      console.log(
        `  codebase: ${codebase.total_files} files, ${(codebase.total_bytes / 1024).toFixed(0)} KB text (skipped ${codebase.skipped.length})`,
      );
    } catch (e) {
      console.warn(`  Codebase capture failed: ${(e as Error).message}`);
      console.warn("  Snapshot saved without codebase_index.json — re-run without --no-clone.");
    } finally {
      if (cloneDir) cleanupClone(cloneDir);
    }
  } else {
    console.log("  Skipped codebase clone (--no-clone).");
  }

  console.log(`Wrote ${outDir}`);
  console.log(
    `  open_issues=${openIssues.length} pulls=${pulls.length} mode=${mode} band=${band}`,
  );
  console.log("  Snapshots are gitignored by default (privacy). Do not commit private data.");
  return outDir;
}

function main(): void {
  const args = process.argv.slice(2);
  if (args.includes("-h") || args.includes("--help")) usage();

  const repo = argValue(args, "--repo");
  const id = argValue(args, "--id");
  if (!repo || !id) usage();

  createSnapshot({
    repo,
    id,
    maxIssues: Number(argValue(args, "--max-issues") ?? 40),
    maxPulls: Number(argValue(args, "--max-pulls") ?? 15),
    bodyChars: Number(argValue(args, "--body-chars") ?? 800),
    modeOverride: argValue(args, "--mode"),
    skipClone: args.includes("--no-clone"),
  });
}

const isDirectRun =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirectRun) {
  main();
}
