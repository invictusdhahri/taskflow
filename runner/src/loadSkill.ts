import { readFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Repo root (taskflow/) — runner lives at runner/ */
export function repoRoot(): string {
  return resolve(__dirname, "../..");
}

export function runnerRoot(): string {
  return resolve(__dirname, "..");
}

export function skillDir(): string {
  return join(repoRoot(), "skills", "taskflow");
}

const DEFAULT_MAX_CHARS = Number(process.env.TASKFLOW_SKILL_MAX_CHARS ?? 48_000);

/**
 * Load TaskFlow skill markdown with a hard char budget (skill first, then templates excerpt).
 */
export function loadSkillContext(maxChars = DEFAULT_MAX_CHARS): string {
  const dir = skillDir();
  const parts: Array<{ name: string; text: string }> = [];

  for (const name of ["SKILL.md", "templates.md", "github-operations.md"] as const) {
    const path = join(dir, name);
    if (!existsSync(path)) {
      throw new Error(`Missing skill file: ${path}`);
    }
    parts.push({ name, text: readFileSync(path, "utf8") });
  }

  let out = "";
  for (const part of parts) {
    const header = `\n\n===== ${part.name} =====\n\n`;
    const remaining = maxChars - out.length - header.length;
    if (remaining <= 0) break;
    const chunk =
      part.text.length <= remaining
        ? part.text
        : `${part.text.slice(0, remaining)}\n\n[...truncated ${part.name}; budget ${maxChars} chars...]`;
    out += header + chunk;
  }

  return out.trim();
}
