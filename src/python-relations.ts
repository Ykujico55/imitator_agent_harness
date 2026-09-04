import { posix } from "node:path";
import type { SourceAnalysis } from "./source-analysis.ts";

const modulePath = (name: string): string | undefined => /^[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*$/.test(name) ? name.replace(/\./g, "/") : undefined;

/** Resolve only unambiguous, conventional root/src layouts; never guess sys.path. */
export function pythonImportRoots(files: Set<string>, manifests: Array<{ path: string; roots: string[] }> = []): string[] {
  const roots = new Set([".", "src"]);
  for (const file of files) if (/(^|\/)(pyproject\.toml|setup\.cfg)$/.test(file)) {
    const root = posix.dirname(file);
    roots.add(root); roots.add(posix.join(root, "src"));
  }
  for (const manifest of manifests) for (const value of manifest.roots) {
    // Repository metadata never authorizes traversal, glob expansion or sys.path execution.
    if (!value || posix.isAbsolute(value) || value.includes("\\") || value.split("/").includes("..") || !/^[\w./-]+$/.test(value)) continue;
    roots.add(posix.normalize(posix.join(posix.dirname(manifest.path), value)));
  }
  return [...roots].sort();
}

function moduleCandidates(base: string, files: Set<string>): string[] {
  return [`${base}.py`, `${base}/__init__.py`].filter((path) => files.has(path));
}

export function resolvePythonModule(name: string, roots: string[], files: Set<string>): string | undefined {
  const path = modulePath(name);
  if (!path) return undefined;
  if (ambiguousPrefix(path, roots, files)) return undefined;
  const candidates = [...new Set(roots.flatMap((root) => moduleCandidates(posix.join(root, path), files)))];
  return candidates.length === 1 ? candidates[0] : undefined;
}

function ambiguousPrefix(path: string, roots: string[], files: Set<string>): boolean {
  const parts = path.split("/");
  for (let index = 1; index <= parts.length; index++) {
    const prefix = parts.slice(0, index).join("/");
    const locations = new Set(roots.filter((root) => {
      const base = posix.join(root, prefix);
      return files.has(`${base}.py`) || [...files].some((file) => file.startsWith(`${base}/`));
    }).map((root) => posix.join(root, prefix)));
    if (locations.size > 1) return true;
    for (const base of locations) if (files.has(`${base}.py`) && (index < parts.length || files.has(`${base}/__init__.py`))) return true;
  }
  return false;
}

export function resolvePythonImport(from: string, item: SourceAnalysis["imports"][number], files: Set<string>, roots: string[]): { targets: string[]; reason?: string } {
  if (item.level === 0 && modulePath(item.module) && ambiguousPrefix(modulePath(item.module)!, roots, files)) {
    return { targets: [], reason: "ambiguous-package-prefix" };
  }
  const targets = pythonImportTargets(from, item, files, roots);
  return { targets, ...(targets.length ? {} : { reason: "external-missing-or-unsupported-target" }) };
}

export function pythonImportTargets(from: string, item: SourceAnalysis["imports"][number], files: Set<string>, roots: string[]): string[] {
  let bases: string[];
  if (item.level > 0) {
    const owner = roots.filter((root) => root === "." || from.startsWith(`${root}/`)).sort((a, b) => b.length - a.length)[0] ?? ".";
    const directory = posix.dirname(from);
    const packagePath = posix.relative(owner, directory);
    const depth = packagePath === "" ? 0 : packagePath.split("/").length;
    if (item.level > depth) return [];
    let base = directory;
    for (let index = 1; index < item.level; index++) base = posix.dirname(base);
    const suffix = item.module ? modulePath(item.module) : "";
    if (suffix === undefined) return [];
    bases = [posix.join(base, suffix)];
  } else {
    const path = modulePath(item.module);
    if (!path) return [];
    if (ambiguousPrefix(path, roots, files)) return [];
    bases = roots.map((root) => posix.join(root, path));
  }
  const resolveUnique = (candidates: string[]): string | undefined => {
    const matches = [...new Set(candidates.flatMap((base) => moduleCandidates(base, files)))];
    return matches.length === 1 ? matches[0] : undefined;
  };
  const targets = new Set<string>();
  if (bases.flatMap((base) => moduleCandidates(base, files)).length > 1) return [];
  const module = resolveUnique(bases);
  if (module) targets.add(module);
  // A plain module is not a package; sibling directories do not establish its
  // __path__. Imported attributes may exist, but no child-module edge is proven.
  if (module && !module.endsWith("/__init__.py")) return [module];
  // from pkg import submodule: a present submodule is a candidate, not proof
  // that pkg.__init__ did not shadow that name. All edges remain static hints.
  for (const name of item.names) if (name !== "*" && modulePath(name)) {
    const child = resolveUnique(bases.map((base) => posix.join(base, name)));
    if (child) targets.add(child);
  }
  return [...targets].sort();
}
