import { existsSync, readFileSync } from "node:fs";
import { ghJson, ghText } from "./gh.js";

/** `.taskflow/roster.json` shape: github login → free-form skill tags. */
export type RosterFile = Record<string, string[]>;

export interface RosterEntry {
  login: string;
  skills: string[];
  source: "collaborator+roster" | "collaborator-only";
}

function parseOwner(repo: string): { owner: string; name: string } {
  const [owner, name] = repo.split("/");
  if (!owner || !name) {
    throw new Error(`Invalid repo ${repo}; expected OWNER/REPO`);
  }
  return { owner, name };
}

/** Live assignable collaborators for a repo. Empty on failure — caller falls back to org members. */
function fetchCollaborators(repo: string): string[] {
  const rows = ghJson<Array<{ login: string }>>([
    "api",
    `repos/${repo}/collaborators`,
    "--paginate",
  ]);
  return rows.map((r) => r.login);
}

/** Org members, used as a fallback when collaborators can't be listed (e.g. missing scope). */
function fetchOrgMembers(org: string): string[] {
  const rows = ghJson<Array<{ login: string }>>([
    "api",
    `orgs/${org}/members`,
    "--paginate",
  ]);
  return rows.map((r) => r.login);
}

/** Reads `.taskflow/roster.json` from the target repo's default branch. Missing file → {} (not an error). */
function loadRosterFile(repo: string): RosterFile {
  const b64 = ghText([
    "api",
    `repos/${repo}/contents/.taskflow/roster.json`,
    "--jq",
    ".content",
  ]);
  if (!b64) return {};
  try {
    const decoded = Buffer.from(b64.replace(/\n/g, ""), "base64").toString("utf8");
    return JSON.parse(decoded) as RosterFile;
  } catch {
    console.warn("  [roster] .taskflow/roster.json is not valid JSON — ignoring");
    return {};
  }
}

/** Local-file override for dev/testing, e.g. `--roster ./my-roster.json`. */
function loadRosterFromPath(path: string): RosterFile {
  if (!existsSync(path)) {
    throw new Error(`--roster ${path} does not exist`);
  }
  return JSON.parse(readFileSync(path, "utf8")) as RosterFile;
}

/**
 * Merge live GitHub collaborators/org-members with the skill-tag file into a roster
 * the planner/applier can use to suggest assignees. Untagged collaborators are kept
 * as valid-but-unlabeled; stale roster logins that are no longer collaborators are
 * dropped (with a warning) rather than silently trusted.
 */
export function buildRoster(repo: string, opts: { rosterPath?: string } = {}): RosterEntry[] {
  const { owner } = parseOwner(repo);

  let collaborators: string[] = [];
  try {
    collaborators = fetchCollaborators(repo);
  } catch (e) {
    try {
      collaborators = fetchOrgMembers(owner);
    } catch {
      console.warn(
        `  [roster] could not list collaborators or org members for ${repo}: ${(e as Error).message}`,
      );
      collaborators = [];
    }
  }

  const tags = opts.rosterPath ? loadRosterFromPath(opts.rosterPath) : loadRosterFile(repo);

  const collabSet = new Set(collaborators);
  const stale = Object.keys(tags).filter((login) => !collabSet.has(login));
  if (stale.length) {
    console.warn(
      `  [roster] .taskflow/roster.json has ${stale.length} login(s) no longer a collaborator: ${stale.join(", ")}`,
    );
  }

  return collaborators.map((login) => ({
    login,
    skills: tags[login] ?? [],
    source: tags[login] ? "collaborator+roster" : "collaborator-only",
  }));
}
