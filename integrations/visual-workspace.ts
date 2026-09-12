import { lstat, readFile, readdir } from "node:fs/promises";
import { relative, resolve } from "node:path";
import type { VisualSourceFile } from "../src/visual-types.ts";

export type VisualWorkspaceScan = {
  files: VisualSourceFile[];
  skipped: Array<{ path: string; reason: string }>;
  limits: VisualWorkspaceLimits;
};

export type VisualWorkspaceLimits = {
  maximumFiles: number;
  maximumCharacters: number;
  maximumCharactersPerFile: number;
  maximumVisitedEntries: number;
  maximumCandidates: number;
};

const ignoredDirectories = new Set([".git", ".imitator", ".next", ".nuxt", "node_modules", "dist", "build", "coverage", "target", "vendor"]);
const directVisualFile = /\.(?:css|scss|sass|less|html|htm|tsx|jsx|vue|svelte)$/i;
const namedVisualConfig = /(^|\/)(?:tailwind\.config|theme|themes|tokens|design-tokens|styles?|palette)(?:\.[a-z0-9_-]+)?\.(?:ts|js|mjs|cjs|json)$/i;

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function slashPath(path: string): string {
  return path.replace(/\\/g, "/");
}

function isVisualSource(path: string): boolean {
  return directVisualFile.test(path) || namedVisualConfig.test(path);
}

export async function scanVisualWorkspace(
  cwd: string,
  limits: VisualWorkspaceLimits = {
    maximumFiles: 48,
    maximumCharacters: 160_000,
    maximumCharactersPerFile: 40_000,
    maximumVisitedEntries: 5_000,
    maximumCandidates: 256,
  },
): Promise<VisualWorkspaceScan> {
  const root = resolve(cwd);
  const candidates: string[] = [];
  const skipped: VisualWorkspaceScan["skipped"] = [];
  let visitedEntries = 0;
  let traversalStopped = false;
  const visit = async (directory: string): Promise<void> => {
    if (traversalStopped) return;
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch (error) {
      skipped.push({ path: slashPath(relative(root, directory)) || ".", reason: error instanceof Error ? error.message : String(error) });
      return;
    }
    for (const entry of entries.sort((a, b) => compareText(a.name, b.name))) {
      if (visitedEntries >= limits.maximumVisitedEntries) {
        skipped.push({ path: slashPath(relative(root, directory)) || ".", reason: "maximum-visited-entries-reached" });
        traversalStopped = true;
        return;
      }
      visitedEntries += 1;
      if (entry.isSymbolicLink()) {
        skipped.push({ path: slashPath(relative(root, resolve(directory, entry.name))), reason: "symbolic-link-not-followed" });
        continue;
      }
      const absolute = resolve(directory, entry.name);
      if (entry.isDirectory()) {
        if (!ignoredDirectories.has(entry.name)) await visit(absolute);
      } else if (entry.isFile()) {
        const path = slashPath(relative(root, absolute));
        if (isVisualSource(path)) {
          if (candidates.length >= limits.maximumCandidates) {
            skipped.push({ path, reason: "maximum-candidates-reached" });
            traversalStopped = true;
            return;
          }
          candidates.push(path);
        }
      }
    }
  };
  await visit(root);
  const files: VisualSourceFile[] = [];
  let totalCharacters = 0;
  for (const path of [...new Set(candidates)].sort(compareText)) {
    if (files.length >= limits.maximumFiles) {
      skipped.push({ path, reason: "maximum-files-reached" });
      continue;
    }
    const absolute = resolve(root, path);
    try {
      const stats = await lstat(absolute);
      if (!stats.isFile() || stats.isSymbolicLink()) {
        skipped.push({ path, reason: "not-a-regular-file" });
        continue;
      }
      const remaining = limits.maximumCharacters - totalCharacters;
      if (remaining <= 0) {
        skipped.push({ path, reason: "maximum-characters-reached" });
        continue;
      }
      const content = await readFile(absolute, "utf8");
      if (content.length > limits.maximumCharactersPerFile || content.length > remaining) {
        skipped.push({ path, reason: "file-exceeds-remaining-character-budget" });
        continue;
      }
      files.push({ path, content });
      totalCharacters += content.length;
    } catch (error) {
      skipped.push({ path, reason: error instanceof Error ? error.message : String(error) });
    }
  }
  return { files, skipped, limits };
}
