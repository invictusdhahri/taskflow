import { spawnSync } from "node:child_process";

/** Run `gh` and parse JSON stdout. Throws with stderr context on nonzero exit. */
export function ghJson<T>(args: string[]): T {
  const r = spawnSync("gh", args, { encoding: "utf8", maxBuffer: 20 * 1024 * 1024 });
  if (r.status !== 0) {
    throw new Error(`gh ${args.join(" ")} failed: ${r.stderr || r.stdout}`);
  }
  return JSON.parse(r.stdout) as T;
}

/** Run `gh` and return stdout, or "" on nonzero exit — for tolerant/best-effort reads. */
export function ghText(args: string[]): string {
  const r = spawnSync("gh", args, { encoding: "utf8", maxBuffer: 5 * 1024 * 1024 });
  if (r.status !== 0) return "";
  return r.stdout;
}

/** Run `gh` for a write/command call. Throws with stderr context on nonzero exit (unlike ghText). */
export function ghRun(args: string[]): string {
  const r = spawnSync("gh", args, { encoding: "utf8", maxBuffer: 5 * 1024 * 1024 });
  if (r.status !== 0) {
    throw new Error(`gh ${args.join(" ")} failed: ${r.stderr || r.stdout}`);
  }
  return r.stdout.trim();
}
