import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { loadFindingsCache } from "./findingsCache.js";
import { ghJson, ghText } from "./gh.js";
import { runnerRoot } from "./loadSkill.js";

/**
 * Current HEAD sha of a repo's default branch, without cloning — cheap enough to
 * call before deciding whether a scheduled run should do any real work at all.
 */
export function resolveRemoteHeadSha(repo: string): string {
  const info = ghJson<{ defaultBranchRef?: { name: string } }>([
    "repo",
    "view",
    repo,
    "--json",
    "defaultBranchRef",
  ]);
  const branch = info.defaultBranchRef?.name ?? "main";
  const sha = ghText(["api", `repos/${repo}/commits/${branch}`, "--jq", ".sha"]).trim();
  if (!sha) {
    throw new Error(`Could not resolve remote HEAD sha for ${repo} (branch ${branch})`);
  }
  return sha;
}

/**
 * Single-repo guard — reuses the findings cache's already-stored `last_head_sha`
 * (findingsCache.ts) rather than a new cache file. Trades off not noticing
 * issue-only changes (no new commit) for skipping unattended runs that have
 * nothing new to analyze.
 */
export function singleRepoUnchanged(repo: string, modelId: string, skill: string): boolean {
  const cache = loadFindingsCache(repo, modelId, skill);
  if (!cache?.last_head_sha) return false;
  return cache.last_head_sha === resolveRemoteHeadSha(repo);
}

export interface GroupState {
  repos: Record<string, string>;
  updated_at: string;
}

function groupStateDir(groupId: string): string {
  const safe = groupId.replace(/[^a-zA-Z0-9._-]+/g, "__");
  return join(runnerRoot(), "results", "cache", "groups", safe);
}

function groupStatePath(groupId: string): string {
  return join(groupStateDir(groupId), "state.json");
}

export function loadGroupState(groupId: string): GroupState | null {
  const path = groupStatePath(groupId);
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as GroupState;
  } catch {
    return null;
  }
}

export function saveGroupState(groupId: string, repos: Record<string, string>): void {
  const path = groupStatePath(groupId);
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify({ repos, updated_at: new Date().toISOString() }, null, 2));
  renameSync(tmp, path);
}

/**
 * Group guard — skip only when EVERY member's fresh remote sha matches the
 * stored one; a change in any single member still triggers the joint pass,
 * since that's exactly the case it exists to catch.
 */
export function groupUnchanged(groupId: string, repos: string[]): boolean {
  const state = loadGroupState(groupId);
  if (!state) return false;
  return repos.every((repo) => {
    const stored = state.repos[repo];
    return Boolean(stored) && resolveRemoteHeadSha(repo) === stored;
  });
}
