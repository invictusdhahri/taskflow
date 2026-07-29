import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join, relative } from "node:path";
import { runnerRoot } from "./loadSkill.js";
import type { CodebaseFile, CodebaseIndex } from "./types.js";

export type { CodebaseFile, CodebaseIndex };

/** Directory names skipped when walking a repo clone. */
const SKIP_DIRS = new Set([
  ".git",
  "node_modules",
  "dist",
  "build",
  ".next",
  ".turbo",
  "coverage",
  "vendor",
  "target",
  "__pycache__",
  ".venv",
  "venv",
  ".cache",
  "out",
  ".pnpm-store",
  "Pods",
  ".gradle",
  ".idea",
  ".vscode",
]);

const TEXT_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".json",
  ".md",
  ".yaml",
  ".yml",
  ".toml",
  ".sql",
  ".graphql",
  ".gql",
  ".prisma",
  ".css",
  ".scss",
  ".html",
  ".vue",
  ".svelte",
  ".go",
  ".rs",
  ".py",
  ".java",
  ".kt",
  ".swift",
  ".rb",
  ".php",
  ".sh",
  ".bash",
  ".zsh",
  ".env.example",
  ".dockerfile",
]);

const ALWAYS_INCLUDE = new Set([
  "package.json",
  "pnpm-workspace.yaml",
  "turbo.json",
  "nest-cli.json",
  "next.config.js",
  "next.config.mjs",
  "next.config.ts",
  "tsconfig.json",
  "docker-compose.yml",
  "Dockerfile",
  "README.md",
]);

export interface CodebaseSkip {
  path: string;
  reason: string;
}

/** Default 2MB per file — whole-file reads for planning. */
export function snapshotMaxCodeFileBytes(): number {
  return Number(process.env.SNAPSHOT_MAX_CODE_FILE_BYTES ?? 2_000_000);
}

/** Default 50MB total text — fail loud if exceeded rather than silent omit. */
export function snapshotMaxCodeTotalBytes(): number {
  return Number(process.env.SNAPSHOT_MAX_CODE_TOTAL_BYTES ?? 50_000_000);
}

export function hashContent(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

function isTextCandidate(relPath: string): boolean {
  const base = relPath.split("/").pop() ?? relPath;
  if (ALWAYS_INCLUDE.has(base)) return true;
  if (
    /\.(lock|lockb|png|jpe?g|gif|webp|ico|svg|woff2?|ttf|eot|mp4|zip|tar|gz|pdf|exe|dll|so|dylib|bin|wasm|map)$/i.test(
      base,
    )
  ) {
    return false;
  }
  if (base.startsWith(".env") && base !== ".env.example") return false;
  const dot = base.lastIndexOf(".");
  if (dot < 0) return base === "Dockerfile" || base === "Makefile";
  return TEXT_EXTENSIONS.has(base.slice(dot).toLowerCase());
}

function readFileCapped(
  absPath: string,
  maxBytes: number,
): { content: string; truncated: boolean; size: number } {
  const size = statSync(absPath).size;
  if (size <= maxBytes) {
    return { content: readFileSync(absPath, "utf8"), truncated: false, size };
  }
  const buf = readFileSync(absPath).subarray(0, maxBytes);
  return {
    content: `${buf.toString("utf8")}\n\n...[truncated at ${maxBytes} bytes; full size ${size}]`,
    truncated: true,
    size,
  };
}

export function resolveGitHeadSha(repoDir: string): string | undefined {
  const r = spawnSync("git", ["-C", repoDir, "rev-parse", "HEAD"], {
    encoding: "utf8",
  });
  if (r.status !== 0) return undefined;
  return (r.stdout || "").trim() || undefined;
}

/**
 * Throw if any text file was skipped due to total budget — planning must not
 * silently omit source.
 */
export function assertNoTotalBudgetSkips(index: CodebaseIndex): void {
  const budgetSkips = index.skipped.filter((s) => s.reason === "total_budget");
  if (budgetSkips.length === 0) return;
  const sample = budgetSkips
    .slice(0, 8)
    .map((s) => s.path)
    .join(", ");
  throw new Error(
    `Codebase capture hit SNAPSHOT_MAX_CODE_TOTAL_BYTES (${snapshotMaxCodeTotalBytes()}): ` +
      `${budgetSkips.length} text file(s) omitted (e.g. ${sample}). ` +
      `Raise SNAPSHOT_MAX_CODE_TOTAL_BYTES — TaskFlow plan refuses partial codebases.`,
  );
}

/**
 * Walk a local repo directory and collect text source files (whole-file when under cap).
 */
export function collectCodebaseFromDir(
  rootDir: string,
  branch: string,
  opts?: { maxFileBytes?: number; maxTotalBytes?: number; headSha?: string },
): CodebaseIndex {
  const maxFileBytes = opts?.maxFileBytes ?? snapshotMaxCodeFileBytes();
  const maxTotalBytes = opts?.maxTotalBytes ?? snapshotMaxCodeTotalBytes();
  const files: CodebaseFile[] = [];
  const skipped: CodebaseSkip[] = [];
  let totalBytes = 0;

  function walk(dir: string): void {
    for (const ent of readdirSync(dir, { withFileTypes: true })) {
      const abs = join(dir, ent.name);
      const rel = relative(rootDir, abs).replace(/\\/g, "/");
      if (ent.isDirectory()) {
        if (SKIP_DIRS.has(ent.name)) {
          skipped.push({ path: rel, reason: "ignored_dir" });
          continue;
        }
        walk(abs);
        continue;
      }
      if (!ent.isFile()) continue;
      if (!isTextCandidate(rel)) {
        skipped.push({ path: rel, reason: "not_text" });
        continue;
      }
      try {
        const { content, truncated, size } = readFileCapped(abs, maxFileBytes);
        if (totalBytes + content.length > maxTotalBytes) {
          skipped.push({ path: rel, reason: "total_budget" });
          continue;
        }
        files.push({
          path: rel,
          size,
          content,
          content_hash: hashContent(content),
          ...(truncated ? { truncated: true } : {}),
        });
        totalBytes += content.length;
      } catch {
        skipped.push({ path: rel, reason: "read_error" });
      }
    }
  }

  walk(rootDir);
  files.sort((a, b) => a.path.localeCompare(b.path));

  const head_sha = opts?.headSha ?? resolveGitHeadSha(rootDir);

  return {
    collected_at: new Date().toISOString(),
    branch,
    ...(head_sha ? { head_sha } : {}),
    total_files: files.length,
    total_bytes: totalBytes,
    skipped,
    files,
  };
}

/**
 * Shallow clone via gh (respects auth for private repos) into a temp dir.
 */
export function cloneRepoForSnapshot(repo: string, snapshotId: string): string {
  const cacheRoot = join(runnerRoot(), ".cache", "snapshot-clones");
  mkdirSync(cacheRoot, { recursive: true });
  const dest = join(cacheRoot, `${snapshotId}-${Date.now()}`);
  mkdirSync(dest, { recursive: true });

  const r = spawnSync("gh", ["repo", "clone", repo, dest, "--", "--depth", "1"], {
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024,
  });
  if (r.status !== 0) {
    rmSync(dest, { recursive: true, force: true });
    throw new Error(`gh repo clone ${repo} failed: ${r.stderr || r.stdout}`);
  }
  return dest;
}

export function cleanupClone(cloneDir: string): void {
  try {
    rmSync(cloneDir, { recursive: true, force: true });
  } catch {
    // best effort
  }
}

/** Order files for chunk boundaries (configs / src first). Does not drop files. */
export function prioritizeCodebaseFiles(files: CodebaseFile[]): CodebaseFile[] {
  const score = (p: string): number => {
    const base = p.split("/").pop() ?? p;
    if (ALWAYS_INCLUDE.has(base)) return 0;
    if (/^(src|app|lib|packages|backend|frontend|services|api)\//.test(p)) return 1;
    if (/\.(tsx?|jsx?|py|go|rs)$/.test(p)) return 2;
    if (/\.(md|json|ya?ml)$/.test(p)) return 3;
    return 4;
  };
  return [...files].sort((a, b) => {
    const sa = score(a.path);
    const sb = score(b.path);
    if (sa !== sb) return sa - sb;
    return a.path.localeCompare(b.path);
  });
}

export function writeCodebaseIndex(outDir: string, index: CodebaseIndex): void {
  writeFileSync(join(outDir, "codebase_index.json"), JSON.stringify(index, null, 2));
}

export function loadCodebaseIndex(dir: string): CodebaseIndex | undefined {
  const path = join(dir, "codebase_index.json");
  if (!existsSync(path)) return undefined;
  return JSON.parse(readFileSync(path, "utf8")) as CodebaseIndex;
}
