import { createHash } from "node:crypto";
import type { EvidenceSlice, HarnessConfig, RepositoryAssessment, RepositoryDesignAtlas, SliceStrategy, TaskSpec, TreeEntry } from "./types.ts";
import type { GitHubClient } from "./github.ts";
import { taskTerms } from "./query.ts";
import { learningRepositoryLimit } from "./reference.ts";
import { repositoryContentKey } from "./atlas.ts";
import { isCodeFile, isImplementationPath, isTestPath, isTestSupportPath, isPythonPackageMarker, isRustBuildSupportPath } from "./evidence-path.ts";
import { hasSourceEvidence, hasTestEvidence } from "./coverage-evidence.ts";
import type { SourceRouteDecision, SourceRouteResolver } from "./source-routing.ts";

export type SliceWindow = {
  start: number;
  end: number;
  content: string;
  relevance: number;
  strategy: SliceStrategy;
  symbols?: string[];
};

export type SemanticSliceSelector = (input: {
  path: string;
  content: string;
  terms: string[];
  maxLines: number;
}) => SliceWindow | undefined;

export type SliceReadFailure = {
  repository: string;
  path: string;
  reason: string;
};

const EXCLUDED = /(^|\/)(node_modules|vendor|dist|build|coverage|fixtures?|snapshots?|generated|\.vscode|\.idea|\.agents)(\/|$)|(^|\/)(AGENTS|CLAUDE)\.md$|^\.github\/(copilot-instructions|instructions)(\/|\.|$)|\.(lock|min\.(js|css)|map|png|jpe?g|gif|pdf|zip|wasm)$|\.i18n\.ya?ml$/i;
const TEXT_FILE = /(^|\/)(README|ARCHITECTURE|DESIGN|CONTRIBUTING|SECURITY)(\.[^/]*)?$|\.(md|mdx|ts|tsx|js|jsx|py|rs|go|java|kt|rb|toml|cfg|ya?ml|json)$/i;
const DESIGN_PATH = /(^|\/)(architecture|design|adr)(\/|\.|$)|(^|\/)(rfcs?)(\/|$)|(^|\/)(RFC-\d+|ADR-\d+)[^/]*\.md$/i;
const README_PATH = /(^|\/)README(?:\.[^/]*)?$/i;
const MANIFEST_PATH = /(^|\/)(package\.json|pyproject\.toml|setup\.cfg|Cargo\.toml|go\.mod|pom\.xml|build\.gradle(?:\.kts)?)$/i;

export function rankPaths(tree: TreeEntry[], terms: string[], preferredPaths = new Set<string>()): Array<{ entry: TreeEntry; score: number; reason: string }> {
  return tree
    .filter((entry) => entry.type === "blob" && (TEXT_FILE.test(entry.path) || isCodeFile(entry.path)) && !EXCLUDED.test(entry.path) && !isRustBuildSupportPath(entry.path) && (entry.size ?? 0) < 120_000)
    .map((entry) => {
      const path = entry.path.toLowerCase();
      const matches = terms.filter((term) => path.includes(term.toLowerCase()));
      let score = matches.length * 20;
      const reasons: string[] = [];
      if (preferredPaths.has(entry.path)) { score += 16; reasons.push("design-atlas structural evidence"); }
      if (matches.length) reasons.push(`path matches ${matches.join(", ")}`);
      if (DESIGN_PATH.test(path)) { score += 35; reasons.push("design documentation"); }
      if (README_PATH.test(path)) { score += 28; reasons.push("project overview"); }
      if (/(^|\/)(examples?|samples?)(\/|$)/i.test(path)) { score += 18; reasons.push("usage example"); }
      if (isTestPath(path)) { score += 12; reasons.push("behavioral evidence"); }
      if (isTestSupportPath(path)) { score += 6; reasons.push("test-support evidence, not a test case"); }
      if (isImplementationPath(path)) { score += 8; reasons.push("implementation source"); }
      score -= path.split("/").length * 0.5;
      return { entry, score, reason: reasons.join("; ") || "representative source" };
    })
    .filter((candidate) => candidate.score >= 5)
    .sort((a, b) => b.score - a.score || a.entry.path.localeCompare(b.entry.path));
}

function evidenceBucket(path: string): string {
  if (DESIGN_PATH.test(path)) return "design";
  if (isTestPath(path)) return "test";
  if (/(^|\/)(examples?|samples?)(\/|$)/i.test(path)) return "example";
  if (README_PATH.test(path)) return "readme";
  if (isImplementationPath(path)) return "source";
  return "other";
}

function pathFamily(path: string): string {
  return path.toLowerCase()
    .replace(/([._-])(zh(?:-cn)?|en|i18n)(?=\.)/g, "")
    .replace(/([_-])zh(?=\.)/g, "")
    .replace(/\.(mdx?|ya?ml|json)$/, "");
}

function evidenceModality(path: string): "documentation" | "manifest" | "implementation" | "test" | "test-support" {
  if (isTestSupportPath(path)) return "test-support";
  if (isTestPath(path)) return "test";
  if (MANIFEST_PATH.test(path)) return "manifest";
  if (DESIGN_PATH.test(path) || README_PATH.test(path)) return "documentation";
  return "implementation";
}

function diversifyPaths(
  ranked: ReturnType<typeof rankPaths>,
  limit: number,
): ReturnType<typeof rankPaths> {
  const caps: Record<string, number> = {
    design: Math.max(2, Math.ceil(limit * 0.2)),
    test: Math.max(2, Math.ceil(limit * 0.25)),
    example: Math.max(1, Math.ceil(limit * 0.15)),
    readme: 1,
    source: Math.max(2, Math.ceil(limit * 0.45)),
    other: Math.max(1, Math.ceil(limit * 0.1)),
  };
  const counts: Record<string, number> = {};
  const families = new Set<string>();
  const selected: ReturnType<typeof rankPaths> = [];
  const add = (candidate: ReturnType<typeof rankPaths>[number]): boolean => {
    const bucket = evidenceBucket(candidate.entry.path);
    const family = pathFamily(candidate.entry.path);
    if (families.has(family) || (counts[bucket] ?? 0) >= (caps[bucket] ?? 1)) return false;
    families.add(family);
    counts[bucket] = (counts[bucket] ?? 0) + 1;
    selected.push(candidate);
    return true;
  };
  if (ranked[0]) add(ranked[0]);
  for (const modality of ["documentation", "manifest", "test", "implementation"] as const) {
    if (selected.length >= limit) break;
    if (selected.some((candidate) => evidenceModality(candidate.entry.path) === modality)) continue;
    const diverse = ranked.find((candidate) => evidenceModality(candidate.entry.path) === modality && !families.has(pathFamily(candidate.entry.path)));
    if (diverse) add(diverse);
  }
  for (const candidate of ranked) {
    add(candidate);
    if (selected.length >= limit) break;
  }
  return selected;
}

export function selectLineWindow(content: string, terms: string[], maxLines: number): SliceWindow {
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  if (lines.length <= maxLines) return { start: 1, end: lines.length, content: lines.join("\n"), relevance: 1, strategy: "line-window" };
  let bestStart = 0;
  let bestScore = -1;
  for (let start = 0; start < lines.length; start += Math.max(10, Math.floor(maxLines / 2))) {
    const window = lines.slice(start, start + maxLines).join("\n").toLowerCase();
    const termScore = terms.reduce((sum, term) => sum + (window.includes(term.toLowerCase()) ? 4 : 0), 0);
    const structureScore = (window.match(/\b(interface|class|type|function|def|trait|struct|test|describe|example|architecture)\b/g) ?? []).length;
    const score = termScore + Math.min(12, structureScore);
    if (score > bestScore) { bestScore = score; bestStart = start; }
  }
  const selected = lines.slice(bestStart, bestStart + maxLines);
  return { start: bestStart + 1, end: bestStart + selected.length, content: selected.join("\n"), relevance: bestScore, strategy: "line-window" };
}

export async function collectSlices(
  client: GitHubClient,
  assessments: RepositoryAssessment[],
  task: TaskSpec,
  config: HarnessConfig,
  semanticSelector?: SemanticSliceSelector,
  atlases: RepositoryDesignAtlas[] = [],
  contentCache = new Map<string, string>(),
  failures: SliceReadFailure[] = [],
  sourceRouteResolver?: SourceRouteResolver,
): Promise<EvidenceSlice[]> {
  const terms = taskTerms(task);
  const slices: EvidenceSlice[] = [];
  let characters = 0;
  for (const assessment of assessments.filter((item) => item.accepted).slice(0, learningRepositoryLimit(config.slicing.maxRepositories))) {
    const repo = assessment.repository;
    const atlas = atlases.find((item) => item.repository === repo.fullName);
    const preferredPaths = new Set([
      ...(atlas?.entryPoints.map((item) => item.path) ?? []),
      ...(atlas?.manifests.map((item) => item.path) ?? []),
      ...(atlas?.architectureDocuments.map((item) => item.path) ?? []),
      ...(atlas?.coverage.signals.filter((signal) => signal.name === "source-evidence" || signal.name === "test-evidence").flatMap((signal) => signal.sources.map((item) => item.path)) ?? []),
    ]);
    const inspectedAnalyses = new Map(atlas?.sourceAnalyses?.map((item) => [item.path, item]) ?? []);
    const candidates = rankPaths(repo.tree, terms, preferredPaths).filter((candidate) => {
      if (!isPythonPackageMarker(candidate.entry.path)) return true;
      const analysis = inspectedAnalyses.get(candidate.entry.path);
      return !analysis || hasSourceEvidence(candidate.entry.path, "inspected", analysis);
    }).sort((a, b) => Number(isPythonPackageMarker(a.entry.path)) - Number(isPythonPackageMarker(b.entry.path)) || b.score - a.score || a.entry.path.localeCompare(b.entry.path));
    const ranked = diversifyPaths(candidates, config.slicing.maxFilesPerRepository);
    for (const candidate of ranked) {
      if (slices.length >= config.slicing.maxSlices || characters >= config.slicing.maxTotalCharacters) return slices;
      try {
        const cacheKey = repositoryContentKey(repo.fullName, repo.resolvedRevision, candidate.entry.path);
        const text = contentCache.get(cacheKey) ?? await client.readTextFile(repo.fullName, candidate.entry.path, repo.resolvedRevision);
        contentCache.set(cacheKey, text);
        if (text.includes("\0")) continue;
        let sourceRouteDecision: SourceRouteDecision | undefined;
        if (sourceRouteResolver) {
          try { sourceRouteDecision = sourceRouteResolver({ path: candidate.entry.path }); }
          catch {
            sourceRouteDecision = {
              selectedAnalyzer: "structural-fallback",
              routeReason: "source-route-resolver-failed",
              selectionStatus: "structural-fallback",
              capabilities: [],
              fallback: "line-window",
            };
          }
        }
        let semanticWindow: SliceWindow | undefined;
        try {
          semanticWindow = semanticSelector?.({
            path: candidate.entry.path,
            content: text,
            terms,
            maxLines: config.slicing.maxLinesPerSlice,
          });
        } catch {
          // Parser errors must degrade to the deterministic dependency-free window.
        }
        const primary = semanticWindow ?? selectLineWindow(text, terms, config.slicing.maxLinesPerSlice);
        const analysis = inspectedAnalyses.get(candidate.entry.path);
        const windows: SliceWindow[] = [primary];
        if (/\.rs$/i.test(candidate.entry.path) && analysis?.language === "rust" && analysis.status === "parsed") {
          const covered = new Set(analysis.symbols.filter((symbol) => symbol.startLine >= primary.start && symbol.endLine <= primary.end).map((symbol) => symbol.role === "test" ? "test" : symbol.kind === "module" ? "other" : "implementation"));
          for (const role of ["implementation", "test"] as const) {
            if (covered.has(role)) continue;
            const symbol = analysis.symbols.find((item) => (role === "test" ? item.role === "test" : item.role === "implementation" && item.kind !== "module") && item.hasBody !== false && item.endLine - item.startLine + 1 <= config.slicing.maxLinesPerSlice);
            if (symbol) windows.push({ start: symbol.startLine, end: symbol.endLine, content: text.replace(/\r\n/g, "\n").split("\n").slice(symbol.startLine - 1, symbol.endLine).join("\n"), relevance: 0, strategy: "rust-syntax", symbols: [symbol.name] });
          }
        }
        for (const window of windows) {
          if (slices.length >= config.slicing.maxSlices) return slices;
          const remaining = config.slicing.maxTotalCharacters - characters;
          if (remaining < 200) return slices;
          if (window.strategy !== "line-window" && window.content.length > remaining) continue;
          const content = window.content.slice(0, remaining);
          const windowSymbols = analysis?.symbols.filter((symbol) => symbol.startLine >= window.start && symbol.endLine <= window.end) ?? [];
          if (/\.py$/i.test(candidate.entry.path) && isTestPath(candidate.entry.path)) {
            const windowAnalysis = analysis ? { ...analysis, symbols: windowSymbols } : undefined;
            if (window.strategy !== "python-ast" && !hasTestEvidence(candidate.entry.path, content, windowAnalysis)) continue;
          }
          if (/\.rs$/i.test(candidate.entry.path) && analysis?.symbols.some((symbol) => symbol.role === "test") && window.strategy !== "rust-syntax") continue;
          const evidenceRoles = /\.rs$/i.test(candidate.entry.path) ? [...new Set(windowSymbols.flatMap((symbol) => symbol.role === "test" ? ["test" as const] : symbol.kind !== "module" ? ["implementation" as const] : []))] : undefined;
          characters += content.length;
        const id = createHash("sha256")
          .update(`${repo.fullName}\0${repo.resolvedRevision}\0${candidate.entry.path}\0${window.start}\0${window.end}`)
          .digest("hex")
          .slice(0, 16);
          slices.push({
          id,
          repository: repo.fullName,
          repositoryUrl: repo.htmlUrl,
          license: repo.license,
          commitish: repo.resolvedRevision,
          path: candidate.entry.path,
          startLine: window.start,
          endLine: window.end,
          sourceUrl: `${repo.htmlUrl}/blob/${encodeURIComponent(repo.resolvedRevision)}/${candidate.entry.path.split("/").map(encodeURIComponent).join("/")}#L${window.start}-L${window.end}`,
          relevance: Math.round(candidate.score + window.relevance),
          reason: window.symbols?.length ? `${candidate.reason}; ${window.strategy} complete declaration; semantic symbols ${window.symbols.join(", ")}` : candidate.reason,
          content,
          strategy: window.strategy,
          symbols: window.symbols,
          evidenceRoles,
          ...(sourceRouteDecision ? { sourceRoute: {
            ...sourceRouteDecision,
            outcome: window.strategy === "line-window" ? "line-window-fallback" as const : "semantic-window" as const,
          } } : {}),
          });
        }
      } catch (error) {
        // A single unreadable, moved, or oversized file must not fail the reference run.
        failures.push({
          repository: repo.fullName,
          path: candidate.entry.path,
          reason: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }
  return slices;
}
