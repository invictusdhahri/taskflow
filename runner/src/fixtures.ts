import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import { loadCodebaseIndex } from "./codebase.js";
import { runnerRoot } from "./loadSkill.js";
import type {
  ExpectSpec,
  FixtureIssue,
  FixtureMeta,
  FixturePack,
  FixtureProject,
  FixturePull,
} from "./types.js";

function readJson<T>(path: string, fallback: T): T {
  if (!existsSync(path)) return fallback;
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

export function loadFixtureDir(dir: string): FixturePack {
  const dirName = dir.split(/[/\\]/).pop() || "unknown";
  const meta = readJson<FixtureMeta>(join(dir, "meta.json"), {
    id: dirName,
    kind: "synthetic",
    mode: 3,
    band: "M",
    title: "unknown",
    description: "",
  });
  const issues = readJson<FixtureIssue[]>(join(dir, "issues.json"), []);
  const project = readJson<FixtureProject | null>(join(dir, "project.json"), null);
  const pulls = readJson<FixturePull[]>(join(dir, "pulls.json"), []);
  const expect = readJson<ExpectSpec>(join(dir, "expect.json"), {});
  const readmePath = join(dir, "readme_excerpt.md");
  const readme_excerpt = existsSync(readmePath)
    ? readFileSync(readmePath, "utf8")
    : undefined;
  const file_tree = readJson<string[]>(join(dir, "file_tree.json"), []);
  const codebase = loadCodebaseIndex(dir);

  if (!expect.known_issue_numbers) {
    expect.known_issue_numbers = issues.map((i) => i.number);
  }

  return {
    dir,
    meta: { ...meta, id: meta.id && meta.id !== "unknown" ? meta.id : dirName },
    issues,
    project,
    pulls,
    expect,
    readme_excerpt,
    file_tree: file_tree.length ? file_tree : undefined,
    codebase,
  };
}

export function fixturesRoot(): string {
  return join(runnerRoot(), "fixtures");
}

export function listSyntheticFixtures(): FixturePack[] {
  const base = join(fixturesRoot(), "synthetic");
  if (!existsSync(base)) return [];
  return readdirSync(base, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => loadFixtureDir(join(base, d.name)))
    .sort((a, b) => a.meta.id.localeCompare(b.meta.id));
}

export function listSnapshotFixtures(): FixturePack[] {
  const base = join(fixturesRoot(), "snapshots");
  if (!existsSync(base)) return [];
  return readdirSync(base, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => loadFixtureDir(join(base, d.name)))
    .sort((a, b) => a.meta.id.localeCompare(b.meta.id));
}

export function getFixtureById(id: string): FixturePack {
  const all = [...listSyntheticFixtures(), ...listSnapshotFixtures()];
  const found = all.find((f) => f.meta.id === id || f.dir.endsWith(id));
  if (!found) {
    throw new Error(
      `Fixture not found: ${id}. Available: ${all.map((f) => f.meta.id).join(", ") || "(none)"}`,
    );
  }
  return found;
}

export interface CatalogEntry {
  id: string;
  path: string;
  kind: string;
  mode: number;
  band: string;
  role: string;
}

export function loadCatalog(): CatalogEntry[] {
  const path = join(fixturesRoot(), "catalog.yaml");
  if (!existsSync(path)) return [];
  const doc = parseYaml(readFileSync(path, "utf8")) as { fixtures?: CatalogEntry[] };
  return doc.fixtures ?? [];
}
