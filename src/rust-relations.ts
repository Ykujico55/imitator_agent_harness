import { posix } from "node:path";
import type { SourceAnalysis, SourceImport } from "./source-analysis.ts";

type Resolution = { targets: string[]; reason?: string };

function crateRoot(from: string): string | undefined {
  const parts = from.split("/");
  const index = parts.lastIndexOf("src");
  return index >= 0 ? parts.slice(0, index + 1).join("/") : undefined;
}

function ownerDirectory(from: string): string {
  const directory = posix.dirname(from), base = posix.basename(from, ".rs");
  return ["lib", "main", "mod"].includes(base) ? directory : posix.join(directory, base);
}

function candidates(base: string, files: Set<string>): string[] {
  return [`${base}.rs`, `${base}/mod.rs`].filter((path) => files.has(path));
}

function uniqueTarget(base: string, files: Set<string>): string | undefined {
  const matches = candidates(base, files);
  return matches.length === 1 ? matches[0] : undefined;
}

function moduleSegments(item: SourceImport): string[] {
  return item.module.split("::").map((item) => item.trim()).filter(Boolean).filter((item) => item !== "self" && item !== "*");
}

/** Resolve only filesystem-backed Rust modules; macro expansion and extern crates stay unresolved. */
export function resolveRustImport(from: string, item: SourceImport, files: Set<string>): Resolution {
  if (item.kind === "module") {
    if (item.context?.some((value) => /^path\b/.test(value))) return { targets: [], reason: "explicit-path-module-unsupported" };
    const inlineScope = item.scope && item.scope !== "module" ? item.scope.split("::").filter(Boolean) : [];
    const target = uniqueTarget(posix.join(ownerDirectory(from), ...inlineScope, item.module), files);
    return target ? { targets: [target] } : { targets: [], reason: "inline-generated-or-missing-module" };
  }
  const root = crateRoot(from); if (!root) return { targets: [], reason: "source-outside-conventional-crate-root" };
  const segments = moduleSegments(item); if (!segments.length) return { targets: [], reason: "empty-or-unsupported-use-tree" };
  let base: string;
  if (segments[0] === "crate") { segments.shift(); base = root; }
  else if (segments[0] === "super") {
    base = ownerDirectory(from);
    const inlineScopes = item.scope && item.scope !== "module" ? item.scope.split("::").filter(Boolean) : [];
    while (segments[0] === "super") {
      segments.shift();
      if (inlineScopes.length) inlineScopes.pop(); else base = posix.dirname(base);
      if (base !== root && !base.startsWith(`${root}/`)) return { targets: [], reason: "use-escapes-crate-root" };
    }
    if (inlineScopes.length) base = posix.join(base, ...inlineScopes);
  } else if (item.module.startsWith("self::")) base = ownerDirectory(from);
  else return { targets: [], reason: "extern-prelude-or-ambiguous-bare-use" };
  if (!segments.length) {
    const entry = [posix.join(root, "lib.rs"), posix.join(root, "main.rs")].filter((path) => files.has(path));
    return entry.length === 1 ? { targets: entry } : { targets: [], reason: "ambiguous-or-missing-crate-entry" };
  }
  for (let length = segments.length; length > 0; length--) {
    const target = uniqueTarget(posix.join(base, ...segments.slice(0, length)), files);
    if (target) return { targets: [target] };
  }
  return { targets: [], reason: "external-missing-generated-or-inline-module" };
}

export function rustAnalyses(items: Map<string, SourceAnalysis>): Array<[string, SourceAnalysis]> {
  return [...items].filter(([, analysis]) => analysis.language === "rust" && analysis.status === "parsed");
}
