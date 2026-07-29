import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { runnerRoot } from "./loadSkill.js";
import type { CodebaseFile } from "./types.js";

export interface FileFindingPayload {
  bugs?: string[];
  gaps?: string[];
  features?: string[];
  notes?: string;
}

export interface CachedFileFinding {
  content_hash: string;
  findings: FileFindingPayload;
  updated_at: string;
}

export interface FindingsCacheDoc {
  repo: string;
  model_id: string;
  skill_hash: string;
  last_head_sha?: string;
  last_plan_at?: string;
  files: Record<string, CachedFileFinding>;
}

export function skillHash(skillText: string): string {
  return createHash("sha256").update(skillText, "utf8").digest("hex").slice(0, 16);
}

export function cacheDirForRepo(repoFullName: string): string {
  const safe = repoFullName.replace(/[^a-zA-Z0-9._-]+/g, "__");
  return join(runnerRoot(), "results", "cache", safe);
}

export function cachePathForRepo(repoFullName: string): string {
  return join(cacheDirForRepo(repoFullName), "findings.json");
}

export function loadFindingsCache(
  repoFullName: string,
  modelId: string,
  skill: string,
): FindingsCacheDoc | null {
  const path = cachePathForRepo(repoFullName);
  if (!existsSync(path)) return null;
  try {
    const doc = JSON.parse(readFileSync(path, "utf8")) as FindingsCacheDoc;
    if (doc.model_id !== modelId) return null;
    if (doc.skill_hash !== skillHash(skill)) return null;
    if (doc.repo !== repoFullName) return null;
    return doc;
  } catch {
    return null;
  }
}

export function saveFindingsCache(doc: FindingsCacheDoc): void {
  const path = cachePathForRepo(doc.repo);
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(doc, null, 2));
  renameSync(tmp, path);
}

export interface CacheDiff {
  reuse: Array<{ path: string; content_hash: string; findings: FileFindingPayload }>;
  reanalyze: CodebaseFile[];
  deleted: string[];
  cache_hits: number;
  cache_misses: number;
}

export function diffAgainstCache(
  files: CodebaseFile[],
  cache: FindingsCacheDoc | null,
): CacheDiff {
  const reuse: CacheDiff["reuse"] = [];
  const reanalyze: CodebaseFile[] = [];
  const currentPaths = new Set(files.map((f) => f.path));

  for (const f of files) {
    const hash = f.content_hash;
    if (!hash) {
      reanalyze.push(f);
      continue;
    }
    const hit = cache?.files[f.path];
    if (hit && hit.content_hash === hash) {
      reuse.push({ path: f.path, content_hash: hash, findings: hit.findings });
    } else {
      reanalyze.push(f);
    }
  }

  const deleted: string[] = [];
  if (cache) {
    for (const path of Object.keys(cache.files)) {
      if (!currentPaths.has(path)) deleted.push(path);
    }
  }

  return {
    reuse,
    reanalyze,
    deleted,
    cache_hits: reuse.length,
    cache_misses: reanalyze.length,
  };
}

export function mergeFindingsIntoCache(
  prev: FindingsCacheDoc | null,
  opts: {
    repo: string;
    model_id: string;
    skill_hash: string;
    head_sha?: string;
    reuse: CacheDiff["reuse"];
    fresh: Array<{ path: string; content_hash: string; findings: FileFindingPayload }>;
  },
): FindingsCacheDoc {
  const files: Record<string, CachedFileFinding> = {};
  const now = new Date().toISOString();

  for (const r of opts.reuse) {
    files[r.path] = {
      content_hash: r.content_hash,
      findings: r.findings,
      updated_at: prev?.files[r.path]?.updated_at ?? now,
    };
  }
  for (const f of opts.fresh) {
    files[f.path] = {
      content_hash: f.content_hash,
      findings: f.findings,
      updated_at: now,
    };
  }

  return {
    repo: opts.repo,
    model_id: opts.model_id,
    skill_hash: opts.skill_hash,
    last_head_sha: opts.head_sha,
    last_plan_at: now,
    files,
  };
}
