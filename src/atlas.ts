import { posix } from "node:path";
import type {
  AtlasCoverage,
  AtlasEvidenceCategory,
  AtlasSourceRef,
  HarnessConfig,
  RepositoryAssessment,
  RepositoryDesignAtlas,
  RepositoryProfile,
  TaskSpec,
  TreeEntry,
} from "./types.ts";
import type { GitHubClient } from "./github.ts";
import { taskTerms } from "./query.ts";
import { isCodeFile, isImplementationPath, isTestPath, isTestSupportPath, isPythonPackageMarker } from "./evidence-path.ts";
import type { SourceAnalyzer, SourceAnalysis } from "./source-analysis.ts";
import type { SourceRouteDecision, SourceRouteResolver } from "./source-routing.ts";
import { pythonImportRoots, resolvePythonImport, resolvePythonModule } from "./python-relations.ts";
import { hasSourceEvidence, hasTestEvidence } from "./coverage-evidence.ts";
import { linkPythonFixtures } from "./python-fixtures.ts";
import { resolveRustImport } from "./rust-relations.ts";

const MANIFEST = /(^|\/)(package\.json|pyproject\.toml|setup\.cfg|Cargo\.toml|go\.mod|pom\.xml|build\.gradle(?:\.kts)?)$/i;
const AUTOMATION = /^\.github\/workflows\/.*\.ya?ml$/i;
const OVERVIEW = /(^|\/)README(?:\.[^/]*)?$/i;
const DESIGN = /(^|\/)(architecture|design|adr|rfcs?)(\/|\.|$)|(^|\/)(ADR|RFC)-?\d+[^/]*\.md$/i;
const SECURITY = /(^|\/)(SECURITY|THREAT_MODEL)(\.[^/]*)?$/i;
const ENTRY = /(^|\/)(index|main|cli|server|app|__init__|__main__)\.[^/]+$/i;
const SCRIPT_SOURCE = /\.[cm]?[jt]sx?$/i;
const IMPORT_PATTERNS = [
  /(?:import|export)\s+(?:[^"']*?\s+from\s+)?["']([^"']+)["']/g,
  /\brequire\s*\(\s*["']([^"']+)["']\s*\)/g,
  /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g,
];
const CATEGORY_POINTS: Record<AtlasEvidenceCategory, number> = {
  overview: 10,
  design: 20,
  manifest: 10,
  source: 20,
  test: 20,
  automation: 10,
  relationships: 10,
};
type SemanticRole = "contract" | "invariant" | "failure" | "relationship" | "test";
const SEMANTIC_ROLES: SemanticRole[] = ["contract", "invariant", "failure", "relationship", "test"];
// Names only nominate reads. A role is covered only by complete, inspected
// syntax below; a file named contracts.ts is not itself a contract observation.
const ROLE_PATH_HINTS: Record<SemanticRole, RegExp> = {
  contract: /(?:^|[/_.-])(?:api|contract|contracts|interface|interfaces|protocol|types|schema)(?:[/_.-]|$)/i,
  invariant: /(?:^|[/_.-])(?:invariant|invariants|validat\w*|guard|guards|constraint|constraints|state)(?:[/_.-]|$)/i,
  failure: /(?:^|[/_.-])(?:error|errors|exception|exceptions|failure|failures|retry|recovery|result)(?:[/_.-]|$)/i,
  relationship: /(?:^|[/_.-])(?:registry|router|adapter|adapters|composition|container|wiring)(?:[/_.-]|$)/i,
  test: /(?:^|[/_.-])(?:test|tests|spec|specs)(?:[/_.-]|$)/i,
};

export function repositoryContentKey(repository: string, revision: string, path: string): string {
  return `${repository}\0${revision}\0${path}`;
}

function sourceRef(repository: RepositoryProfile, path: string): AtlasSourceRef {
  const encoded = path.split("/").map(encodeURIComponent).join("/");
  return { path, sourceUrl: `${repository.htmlUrl}/blob/${encodeURIComponent(repository.resolvedRevision)}/${encoded}` };
}

function blobPaths(tree: TreeEntry[]): string[] {
  return tree.filter((entry) => entry.type === "blob").map((entry) => entry.path).sort((a, b) => a.localeCompare(b));
}

function unique(values: string[]): string[] {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b));
}

function strings(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === "string");
  return [];
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function manifestEcosystem(path: string): string {
  if (/package\.json$/i.test(path)) return "node";
  if (/pyproject\.toml$|setup\.cfg$/i.test(path)) return "python";
  if (/Cargo\.toml$/i.test(path)) return "rust";
  if (/go\.mod$/i.test(path)) return "go";
  if (/pom\.xml|build\.gradle/i.test(path)) return "jvm";
  return "unknown";
}

function parsePackageManifest(content: string): {
  packageName?: string;
  dependencies: string[];
  developmentDependencies: string[];
  scripts: string[];
  workspacePatterns: string[];
  entryTargets: string[];
} {
  const root = object(JSON.parse(content));
  const dependencies = unique(Object.keys(object(root.dependencies)).concat(Object.keys(object(root.peerDependencies)), Object.keys(object(root.optionalDependencies))));
  const developmentDependencies = unique(Object.keys(object(root.devDependencies)));
  const scripts = unique(Object.keys(object(root.scripts)));
  const workspaces = Array.isArray(root.workspaces) ? root.workspaces : object(root.workspaces).packages;
  const targets = (value: unknown, depth = 0): string[] => depth > 6 ? [] : typeof value === "string" ? [value]
    : Object.values(object(value)).flatMap((child) => targets(child, depth + 1));
  const entryTargets = [root.main, root.module, root.types, root.bin, root.exports]
    .flatMap((value) => targets(value))
    .map((value) => value.replace(/^\.\//, ""));
  return {
    packageName: typeof root.name === "string" ? root.name : undefined,
    dependencies,
    developmentDependencies,
    scripts,
    workspacePatterns: unique(strings(workspaces)),
    entryTargets: unique(entryTargets),
  };
}

function moduleRoot(path: string): { rootPath: string; kind: RepositoryDesignAtlas["modules"][number]["kind"] } | undefined {
  const parts = path.split("/");
  if (isTestPath(path)) return { rootPath: parts.length > 1 ? parts[0]! : ".", kind: "test" };
  if ((parts[0] === "packages" || parts[0] === "apps") && parts[1]) {
    return { rootPath: `${parts[0]}/${parts[1]}`, kind: parts[0] === "apps" ? "application" : "package" };
  }
  if (parts[0] === "src" || parts[0] === "lib") {
    return { rootPath: parts.length > 2 ? `${parts[0]}/${parts[1]}` : parts[0], kind: "library" };
  }
  if (/(^|\/)(examples?|samples?)(\/|$)/i.test(path)) return { rootPath: parts.length > 1 ? parts[0]! : ".", kind: "example" };
  if (/\.py$/i.test(path)) return { rootPath: parts.length > 1 ? parts[0]! : ".", kind: "library" };
  if (/\.rs$/i.test(path)) {
    const source = parts.lastIndexOf("src");
    return { rootPath: source >= 0 ? parts.slice(0, source + 1).join("/") : parts.length > 1 ? parts[0]! : ".", kind: "library" };
  }
  return undefined;
}

function resolveRelativeImport(from: string, specifier: string, files: Set<string>): string | undefined {
  if (!specifier.startsWith(".")) return undefined;
  const base = posix.normalize(posix.join(posix.dirname(from), specifier));
  if (files.has(base)) return base;
  const candidates = [
    ...(/\.[cm]?jsx?$/.test(base) ? [base.replace(/\.js$/, ".ts").replace(/\.jsx$/, ".tsx").replace(/\.mjs$/, ".mts").replace(/\.cjs$/, ".cts")] : []),
    ...[".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"].map((extension) => `${base}${extension}`),
    ...[".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"].map((extension) => `${base}/index${extension}`),
  ];
  const matches = unique(candidates.filter((candidate) => files.has(candidate)));
  return matches.length === 1 ? matches[0] : undefined;
}

function extractRelations(contents: Map<string, string>, files: Set<string>, repository: RepositoryProfile, analyses = new Map<string, SourceAnalysis>()): RepositoryDesignAtlas["relations"] {
  const relations: RepositoryDesignAtlas["relations"] = [];
  const seen = new Set<string>();
  for (const [from, content] of [...contents].sort(([a], [b]) => a.localeCompare(b))) {
    if (!SCRIPT_SOURCE.test(from)) continue;
    const analysis = analyses.get(from);
    if (analysis) {
      if (analysis.status === "parsed" && analysis.language === "typescript") for (const item of analysis.imports) {
        const target = resolveRelativeImport(from, item.module, files);
        if (!target) continue;
        const kind = isTestPath(from) ? "tests" as const : "imports" as const;
        const key = `${from}\0${target}\0${kind}`;
        if (seen.has(key)) continue;
        seen.add(key);
        relations.push({ from, to: target, kind, resolution: "static-candidate", scope: item.scope ?? "module", context: item.context ?? [],
          aliases: item.aliases ?? [], evidence: { path: from, sourceUrl: `${sourceRef(repository, from).sourceUrl}#L${item.line}` } });
      }
      continue;
    }
    for (const pattern of IMPORT_PATTERNS) {
      pattern.lastIndex = 0;
      for (let match = pattern.exec(content); match; match = pattern.exec(content)) {
        const target = resolveRelativeImport(from, match[1]!, files);
        if (!target) continue;
        const kind = isTestPath(from) ? "tests" as const : "imports" as const;
        const key = `${from}\0${target}\0${kind}`;
        if (seen.has(key)) continue;
        seen.add(key);
        relations.push({ from, to: target, kind, evidence: sourceRef(repository, from) });
      }
    }
  }
  return relations.slice(0, 500);
}

function fixtureScopes(path: string, files: Set<string>): string[] {
  return [...files].filter((candidate) => {
    if (!isTestSupportPath(candidate)) return false;
    const directory = posix.dirname(candidate);
    return directory === "." || path.startsWith(`${directory}/`);
  });
}

function inspectedFixtureRelations(analyses: Map<string, SourceAnalysis>, complete: Set<string>, files: Set<string>): NonNullable<RepositoryDesignAtlas["fixtureRelations"]> {
  const parsed = new Map([...analyses].filter(([path, analysis]) => complete.has(path) && analysis.status === "parsed"));
  return linkPythonFixtures(parsed).map((link) => {
    if (fixtureScopes(link.testPath, files).every((path) => parsed.has(path))) return link;
    const { fixturePath: _path, fixtureSymbol: _symbol, ...base } = link;
    return { ...base, status: "unresolved", reason: "fixture-scope-not-completely-inspected" };
  });
}

function semanticReadState(
  contents: Map<string, string>, analyses: Map<string, SourceAnalysis>, complete: Set<string>, files: Set<string>,
): { roles: Set<SemanticRole>; targets: Map<string, string[]> } {
  const roles = new Set<SemanticRole>();
  const targets = new Map<string, string[]>();
  const nominate = (path: string | undefined, reason: string): void => {
    if (path && files.has(path)) targets.set(path, unique([...(targets.get(path) ?? []), reason]));
  };
  const roots = pythonImportRoots(files, [...analyses].filter(([, analysis]) => analysis.language === "python" && analysis.status === "parsed")
    .map(([path, analysis]) => ({ path, roots: analysis.manifest?.importRoots ?? [] })));
  for (const [path, content] of contents) {
    if (!complete.has(path)) continue;
    const analysis = analyses.get(path);
    if (analysis?.status === "parsed") {
      for (const symbol of analysis.symbols) {
        if (symbol.role === "implementation" && symbol.kind !== "module" && symbol.visibility !== "private" && symbol.visibility !== "protected" && (analysis.exports?.names.includes(symbol.name)
          || !symbol.name.startsWith("_") && (analysis.language !== "rust" || (symbol.visibility ?? "").startsWith("pub")))) roles.add("contract");
        // Assertions are a static check candidate. Fields/variants alone establish no invariant.
        if (symbol.assertionCount > 0) roles.add("invariant");
        if (symbol.raises.length || symbol.catches.length || symbol.errorSignals?.length || (symbol.unsafeCount ?? 0) > 0) roles.add("failure");
        if (symbol.role === "test" && symbol.kind !== "class" && symbol.hasBody !== false) roles.add("test");
        if (analysis.language === "python" && (symbol.fixtureRequests?.length ?? 0) > 0) {
          for (const fixturePath of fixtureScopes(path, files)) nominate(fixturePath, `fixture-scope:${path}:${symbol.name}`);
        }
      }
      for (const item of analysis.imports) {
        const resolution = analysis.language === "python" ? resolvePythonImport(path, item, files, roots)
          : analysis.language === "rust" ? resolveRustImport(path, item, files)
          : analysis.language === "typescript" ? { targets: [resolveRelativeImport(path, item.module, files)].filter((target): target is string => Boolean(target)) }
          : { targets: [] };
        for (const target of resolution.targets) {
          nominate(target, `import-target:${path}:${item.line}`);
          if (complete.has(target)) roles.add("relationship");
        }
      }
      if (analysis.manifest) {
        for (const entry of analysis.manifest.entryTargets) {
          const directory = posix.dirname(path);
          const localRoots = pythonImportRoots(new Set([path]), [{ path, roots: analysis.manifest.importRoots ?? [] }])
            .filter((root) => directory === "." || root === directory || root.startsWith(`${directory}/`));
          nominate(analysis.language === "python" ? resolvePythonModule(entry.split(":")[0]!, localRoots, files)
            : analysis.language === "rust" ? posix.normalize(posix.join(directory, entry)) : undefined, `manifest-target:${path}`);
        }
        if (analysis.language === "rust") for (const conventional of ["src/lib.rs", "src/main.rs"]) {
          nominate(posix.join(posix.dirname(path), conventional), `manifest-conventional-target:${path}`);
        }
      }
    } else if (!analysis && SCRIPT_SOURCE.test(path)) {
      // The dependency-free fallback can nominate a textual import candidate;
      // it cannot complete a semantic role without successful syntax analysis.
      for (const pattern of IMPORT_PATTERNS) {
        pattern.lastIndex = 0;
        for (let match = pattern.exec(content); match; match = pattern.exec(content)) {
          nominate(resolveRelativeImport(path, match[1]!, files), `textual-import-candidate:${path}`);
        }
      }
    }
    if (/package\.json$/i.test(path)) {
      try {
        for (const entry of parsePackageManifest(content).entryTargets) {
          nominate(resolveRelativeImport(path, `./${entry}`, files), `manifest-target:${path}`);
        }
      } catch { /* Invalid manifests never nominate entry targets. */ }
    }
  }
  for (const link of inspectedFixtureRelations(analyses, complete, files)) if (link.status === "candidate" && link.fixturePath
    && complete.has(link.testPath) && complete.has(link.fixturePath)) roles.add("relationship");
  return { roles, targets };
}

function buildCoverage(
  repository: RepositoryProfile,
  config: HarnessConfig,
  categories: Record<Exclude<AtlasEvidenceCategory, "relationships">, string[]>,
  relations: RepositoryDesignAtlas["relations"],
): AtlasCoverage {
  const sources: Record<AtlasEvidenceCategory, string[]> = { ...categories, relationships: relations.map((relation) => relation.evidence.path) };
  const presentCategories = (Object.keys(CATEGORY_POINTS) as AtlasEvidenceCategory[]).filter((category) => sources[category].length > 0);
  const requiredCategories = unique(config.atlas.requiredCategories) as AtlasEvidenceCategory[];
  const missingRequiredCategories = requiredCategories.filter((category) => !presentCategories.includes(category));
  const signals = presentCategories.map((category) => ({
    name: `${category}-evidence`,
    points: CATEGORY_POINTS[category],
    sources: unique(sources[category]).slice(0, 6).map((path) => sourceRef(repository, path)),
  }));
  const score = signals.reduce((sum, signal) => sum + signal.points, 0);
  return {
    score,
    sufficient: score >= config.atlas.minimumCoverage && missingRequiredCategories.length === 0,
    requiredCategories,
    presentCategories,
    missingRequiredCategories,
    signals,
  };
}

export async function buildRepositoryDesignAtlas(
  client: GitHubClient,
  repository: RepositoryProfile,
  task: TaskSpec,
  config: HarnessConfig,
  contentCache = new Map<string, string>(),
  sourceAnalyzer?: SourceAnalyzer,
  sourceRouteResolver?: SourceRouteResolver,
): Promise<RepositoryDesignAtlas> {
  const files = blobPaths(repository.tree);
  const fileSet = new Set(files);
  const manifestPaths = files.filter((path) => MANIFEST.test(path));
  const sourcePaths = files.filter(isImplementationPath);
  const testPaths = files.filter((path) => isTestPath(path) && isCodeFile(path));
  const overviewPaths = files.filter((path) => OVERVIEW.test(path));
  const designPaths = files.filter((path) => DESIGN.test(path) || SECURITY.test(path));
  const automationPaths = files.filter((path) => AUTOMATION.test(path));
  const terms = taskTerms(task).map((term) => term.toLowerCase());

  const supportPaths = files.filter(isTestSupportPath);
  const rankedStructuralFiles = unique([...manifestPaths, ...sourcePaths, ...testPaths, ...supportPaths, ...overviewPaths, ...designPaths, ...automationPaths]).sort((a, b) => {
    const score = (path: string): number =>
      (MANIFEST.test(path) ? 100 : 0) + (ENTRY.test(path) && !isPythonPackageMarker(path) ? 60 : 0) +
      (terms.some((term) => path.toLowerCase().includes(term)) ? 30 : 0) + (isTestPath(path) ? 10 : 0) - path.split("/").length;
    return score(b) - score(a) || a.localeCompare(b);
  });
  const contents = new Map<string, string>();
  const analyses = new Map<string, SourceAnalysis>();
  const sourceRoutes = new Map<string, SourceRouteDecision>();
  let analysisCharacters = 0;
  const attemptedPaths = new Set<string>();
  const completePaths = new Set<string>();
  const readFailures: Array<{ path: string; reason: string }> = [];
  const acquisitionReads: NonNullable<RepositoryDesignAtlas["evidenceAcquisition"]>["reads"] = [];
  let stopReason: NonNullable<RepositoryDesignAtlas["evidenceAcquisition"]>["stopReason"] = "no-supported-candidates";
  // Rust unit tests commonly live beside implementation in src/lib.rs.
  const semanticTestPaths = unique([...testPaths, ...sourcePaths.filter((path) => /\.rs$/i.test(path))]);
  const groups = { source: sourcePaths, test: semanticTestPaths, manifest: manifestPaths, overview: overviewPaths, design: designPaths, automation: automationPaths };
  const qualified = (path: string, category: keyof typeof groups): boolean => {
    if (!completePaths.has(path)) return false;
    const content = contents.get(path)!;
    return category === "source" ? hasSourceEvidence(path, content, analyses.get(path)) : category === "test" ? hasTestEvidence(path, content, analyses.get(path)) : Boolean(content.trim());
  };
  let characters = 0;
  let cursor = 0;
  const priorities: Array<keyof typeof groups> = ["source", "test", "manifest", "overview", "design", "automation"];
  while (attemptedPaths.size < config.atlas.maxFiles) {
    if (characters >= config.atlas.maxTotalCharacters) break;
    const remainingPaths = rankedStructuralFiles.filter((path) => !attemptedPaths.has(path));
    const state = semanticReadState(contents, analyses, completePaths, fileSet);
    const missingRoles = SEMANTIC_ROLES.filter((role) => !state.roles.has(role));
    const hasModalityDeficit = priorities.some((category) => groups[category].length && !groups[category].some((item) => qualified(item, category)));
    const pendingFixtures = [...state.targets].filter(([path, reasons]) => !attemptedPaths.has(path) && reasons.some((reason) => reason.startsWith("fixture-scope:")));
    if (!missingRoles.length && !hasModalityDeficit && !pendingFixtures.length) { stopReason = "satisfied"; break; }
    let path: string | undefined;
    let reasons: string[] = [];
    // Round-robin deficit repair prevents unreadable files in one category from
    // starving all others. Every attempt, including failures, consumes budget.
    for (let offset = 0; offset < priorities.length; offset++) {
      const index = (cursor + offset) % priorities.length;
      const category = priorities[index]!;
      if (groups[category].some((item) => qualified(item, category))) continue;
      const markerAttempts = [...attemptedPaths].filter(isPythonPackageMarker).length;
      const candidates = remainingPaths.filter((item) => groups[category].includes(item) && (!isPythonPackageMarker(item) || markerAttempts < 2));
      path = candidates.find((item) => !isPythonPackageMarker(item)) ?? candidates[0];
      if (path) { reasons.push(`missing-modality:${category}`); cursor = (index + 1) % priorities.length; break; }
    }
    if (!path) {
      // Prefer known file targets from inspected syntax over path-name guesses.
      const targets = [...state.targets].filter(([target]) => !attemptedPaths.has(target)).sort(([a, aReasons], [b, bReasons]) =>
        Number(bReasons.some((reason) => reason.startsWith("fixture-scope:"))) - Number(aReasons.some((reason) => reason.startsWith("fixture-scope:")))
        || Number(bReasons.some((reason) => reason.startsWith("manifest-target:"))) - Number(aReasons.some((reason) => reason.startsWith("manifest-target:")))
        || Number(terms.some((term) => b.toLowerCase().includes(term))) - Number(terms.some((term) => a.toLowerCase().includes(term)))
        || a.localeCompare(b));
      path = targets[0]?.[0];
    }
    if (!path && missingRoles.length) {
      path = remainingPaths.find((candidate) => !isPythonPackageMarker(candidate) && missingRoles.some((role) => ROLE_PATH_HINTS[role].test(candidate)))
        ?? remainingPaths.find((candidate) => !isPythonPackageMarker(candidate) && terms.some((term) => candidate.toLowerCase().includes(term)));
      if (path) {
        reasons.push(...missingRoles.filter((role) => ROLE_PATH_HINTS[role].test(path!)).map((role) => `missing-role-path-candidate:${role}`));
        if (terms.some((term) => path!.toLowerCase().includes(term))) reasons.push("task-relevant-path-candidate");
      }
    }
    if (!path) break;
    reasons = unique([...reasons, ...(state.targets.get(path) ?? [])]);
    const read: typeof acquisitionReads[number] = { path, reasons, status: "failed" };
    acquisitionReads.push(read);
    attemptedPaths.add(path);
    const entry = repository.tree.find((item) => item.type === "blob" && item.path === path);
    if ((entry?.size ?? 0) > 120_000) { readFailures.push({ path, reason: "file-size-budget" }); continue; }
    try {
      const key = repositoryContentKey(repository.fullName, repository.resolvedRevision, path);
      const cached = contentCache.get(key);
      const content = cached ?? await client.readTextFile(repository.fullName, path, repository.resolvedRevision);
      if (content.includes("\0")) { readFailures.push({ path, reason: "binary-content" }); continue; }
      contentCache.set(key, content);
      const remaining = config.atlas.maxTotalCharacters - characters;
      const bounded = content.slice(0, remaining);
      contents.set(path, bounded);
      if (sourceRouteResolver) {
        try { sourceRoutes.set(path, sourceRouteResolver({ path })); }
        catch {
          sourceRoutes.set(path, {
            selectedAnalyzer: "structural-fallback",
            routeReason: "source-route-resolver-failed",
            selectionStatus: "structural-fallback",
            capabilities: [],
            fallback: "line-window",
          });
        }
      }
      if (bounded.length === content.length && content.trim()) { completePaths.add(path); read.status = "read"; }
      else readFailures.push({ path, reason: content.trim() ? "content-truncated" : "empty-content" });
      if (bounded.length < content.length) read.status = "truncated";
      characters += bounded.length;
      if (sourceAnalyzer) {
        // Do not call a parser on a budget-truncated file and claim a complete AST.
        if (bounded.length === content.length) {
          try {
            const analysis = sourceAnalyzer({ path, content });
            if (analysis) {
              const size = JSON.stringify(analysis).length;
              if (analysisCharacters + size <= 40_000) { analyses.set(path, analysis); analysisCharacters += size; }
              else analyses.set(path, { language: analysis.language, parser: analysis.parser, status: "budget-exceeded", symbols: [], imports: [], limitations: ["Atlas syntax metadata budget exhausted; no further observations included."] });
            }
          } catch {
            const routedLanguage = sourceRoutes.get(path)?.analysisLanguage;
            const language = routedLanguage ?? (/\.rs$|(^|\/)Cargo\.toml$/i.test(path) ? "rust" : /\.py$|(^|\/)(pyproject\.toml|setup\.cfg)$/i.test(path) ? "python" : undefined);
            if (language) analyses.set(path, { language, parser: sourceRoutes.get(path)?.selectedAnalyzer ?? "adapter", status: "unavailable", symbols: [], imports: [], limitations: ["Selected source analysis adapter failed; structural fallback only."] });
          }
        } else {
          const routedLanguage = sourceRoutes.get(path)?.analysisLanguage;
          const language = routedLanguage ?? (/\.rs$|(^|\/)Cargo\.toml$/i.test(path) ? "rust" : /\.py$|(^|\/)(pyproject\.toml|setup\.cfg)$/i.test(path) ? "python" : undefined);
          if (language) analyses.set(path, { language, parser: sourceRoutes.get(path)?.selectedAnalyzer ?? "not-run", status: "budget-exceeded", symbols: [], imports: [], limitations: ["Atlas budget truncated this file; no complete syntax or manifest parse claimed."] });
        }
      }
    } catch (error) {
      readFailures.push({ path, reason: error instanceof Error ? error.message : String(error) });
    }
  }

  const finalReadState = semanticReadState(contents, analyses, completePaths, fileSet);
  const missingRoles = SEMANTIC_ROLES.filter((role) => !finalReadState.roles.has(role));
  const pendingTargets = [...finalReadState.targets.keys()].filter((path) => !attemptedPaths.has(path));
  if (!missingRoles.length && priorities.every((category) => !groups[category].length || groups[category].some((path) => qualified(path, category)))
    && !pendingTargets.some((path) => finalReadState.targets.get(path)!.some((reason) => reason.startsWith("fixture-scope:")))) stopReason = "satisfied";
  else if (attemptedPaths.size >= config.atlas.maxFiles || characters >= config.atlas.maxTotalCharacters) stopReason = "budget-exhausted";
  const evidenceAcquisition: NonNullable<RepositoryDesignAtlas["evidenceAcquisition"]> = {
    strategy: "semantic-role-deficit-v1", requiredRoles: [...SEMANTIC_ROLES],
    coveredRoles: SEMANTIC_ROLES.filter((role) => finalReadState.roles.has(role)), missingRoles,
    stopReason, reads: acquisitionReads,
    limitations: [
      "Role coverage describes complete static file observations, not retained slice coverage or verified runtime behavior.",
      "Invariant coverage denotes parsed assertion/check candidates; fields and variants alone do not establish invariants.",
      "Path hints only nominate reads. Unsupported or failed parsing cannot establish semantic roles.",
      ...(missingRoles.length ? [`Missing semantic roles remain unknown: ${missingRoles.join(", ")}.`] : []),
      ...(pendingTargets.length ? [`${pendingTargets.length} statically nominated file targets were not inspected within the useful-read budget: ${pendingTargets.slice(0, 12).join(", ")}.`] : []),
    ],
  };

  const manifestEntries: RepositoryDesignAtlas["manifests"] = manifestPaths.slice(0, 20).map((path) => {
    const base = {
      path,
      sourceUrl: sourceRef(repository, path).sourceUrl,
      ecosystem: manifestEcosystem(path),
      dependencies: [] as string[],
      developmentDependencies: [] as string[],
      scripts: [] as string[],
      workspacePatterns: [] as string[],
    };
    const content = contents.get(path);
    if (!content) return { ...base, parseStatus: attemptedPaths.has(path) ? "unreadable" as const : "not-inspected" as const };
    if (/pyproject\.toml$|setup\.cfg$|Cargo\.toml$/i.test(path)) {
      const analysis = analyses.get(path);
      if (analysis?.status === "parsed" && analysis.manifest) {
        const { entryTargets: _entryTargets, ...manifest } = analysis.manifest;
        return { ...base, ...manifest, parseStatus: manifest.completeness === "unsupported" ? "indexed" as const : manifest.completeness === "partial" ? "partial" as const : "parsed" as const };
      }
      return { ...base, parseStatus: analysis?.status === "invalid" ? "invalid" as const : "indexed" as const };
    }
    if (!/package\.json$/i.test(path)) return { ...base, parseStatus: "indexed" as const };
    try {
      const parsed = parsePackageManifest(content);
      const { entryTargets: _entryTargets, ...manifest } = parsed;
      return { ...base, ...manifest, parseStatus: "parsed" as const };
    } catch {
      return { ...base, parseStatus: "invalid" as const };
    }
  });

  const entryPaths = new Set(sourcePaths.filter((path) => ENTRY.test(path)));
  const pythonRoots = pythonImportRoots(fileSet, [...analyses].filter(([, analysis]) => analysis.language === "python").map(([path, analysis]) => ({ path, roots: analysis.manifest?.importRoots ?? [] })));
  for (const [path, analysis] of analyses) if (analysis.language === "python" && analysis.manifest) {
    const root = posix.dirname(path);
    for (const entry of analysis.manifest.entryTargets) {
      const localRoots = pythonImportRoots(new Set([path]), [{ path, roots: analysis.manifest.importRoots ?? [] }]).filter((item) => root === "." || item === root || item.startsWith(`${root}/`));
      const target = resolvePythonModule(entry.split(":")[0]!, localRoots, fileSet);
      if (target) entryPaths.add(target);
    }
  }
  for (const [path, analysis] of analyses) if (analysis.language === "rust" && analysis.manifest) {
    for (const entry of analysis.manifest.entryTargets) {
      const resolved = posix.normalize(posix.join(posix.dirname(path), entry));
      if (fileSet.has(resolved)) entryPaths.add(resolved);
    }
    for (const conventional of ["src/lib.rs", "src/main.rs"]) {
      const resolved = posix.normalize(posix.join(posix.dirname(path), conventional));
      if (fileSet.has(resolved)) entryPaths.add(resolved);
    }
  }
  for (const path of manifestPaths.filter((value) => /package\.json$/i.test(value))) {
    const content = contents.get(path);
    if (!content) continue;
    try {
      const parsed = parsePackageManifest(content);
      for (const target of parsed.entryTargets) {
        const resolved = resolveRelativeImport(path, `./${target}`, fileSet);
        if (resolved) entryPaths.add(resolved);
      }
    } catch {
      // Invalid manifests remain indexed but do not contribute inferred entry points.
    }
  }
  const entryPoints = [...entryPaths].sort().slice(0, 40).map((path) => ({
    ...sourceRef(repository, path),
    reason: ENTRY.test(path) ? "conventional entry-point path" : "declared by a package manifest",
  }));

  const moduleMap = new Map<string, { kind: RepositoryDesignAtlas["modules"][number]["kind"]; files: string[] }>();
  for (const path of [...sourcePaths, ...testPaths, ...files.filter((item) => /(^|\/)(examples?|samples?)(\/|$)/i.test(item))]) {
    const module = moduleRoot(path);
    if (!module) continue;
    const current = moduleMap.get(module.rootPath) ?? { kind: module.kind, files: [] };
    current.files.push(path);
    moduleMap.set(module.rootPath, current);
  }
  const modules = [...moduleMap].map(([rootPath, value]) => ({
    rootPath,
    kind: value.kind,
    fileCount: value.files.length,
    entryPoints: [...entryPaths].filter((path) => path === rootPath || path.startsWith(`${rootPath}/`)).sort(),
  })).sort((a, b) => a.rootPath.localeCompare(b.rootPath)).slice(0, 80);

  const relations = extractRelations(new Map([...contents].filter(([path]) => completePaths.has(path))), fileSet, repository, analyses);
  const unresolvedImports: NonNullable<RepositoryDesignAtlas["unresolvedImports"]> = [];
  for (const [from, analysis] of analyses) if (analysis.status === "parsed") {
    if (analysis.language !== "python" && analysis.language !== "rust") continue;
    for (const item of analysis.imports) {
      const resolution = analysis.language === "rust" ? resolveRustImport(from, item, fileSet) : resolvePythonImport(from, item, fileSet, pythonRoots);
      if (resolution.reason && unresolvedImports.length < 200) unresolvedImports.push({ ...sourceRef(repository, from), module: ".".repeat(item.level) + item.module, line: item.line, reason: resolution.reason, scope: item.scope ?? "module", context: item.context ?? [] });
      for (const to of resolution.targets) {
      if (relations.length >= 500) break;
      const kind = isTestPath(from) || analysis.language === "rust" && (item.context ?? []).some((value) => /cfg\s*\(\s*test\s*\)/.test(value)) ? "tests" as const : "imports" as const;
      if (!relations.some((edge) => edge.from === from && edge.to === to && edge.kind === kind && edge.evidence.sourceUrl.endsWith(`#L${item.line}`))) {
        relations.push({ from, to, kind, resolution: analysis.language === "rust" ? "rust-module-candidate" : "static-candidate", scope: item.scope ?? "module", context: item.context ?? [], aliases: item.aliases ?? [], evidence: { path: from, sourceUrl: `${sourceRef(repository, from).sourceUrl}#L${item.line}` } });
      }
      }
    }
  }
  const categories = {
    overview: overviewPaths.filter((path) => qualified(path, "overview")),
    design: designPaths.filter((path) => qualified(path, "design")),
    manifest: manifestPaths.filter((path) => qualified(path, "manifest")),
    source: sourcePaths.filter((path) => qualified(path, "source")),
    test: semanticTestPaths.filter((path) => qualified(path, "test")),
    automation: automationPaths.filter((path) => qualified(path, "automation")),
  };
  const coverage = buildCoverage(repository, config, categories, relations);
  const architectureDocuments = unique([...overviewPaths, ...designPaths]).slice(0, 80).map((path) => ({
    ...sourceRef(repository, path),
    kind: SECURITY.test(path) ? "security" as const : DESIGN.test(path) ? (/ADR|RFC/i.test(path) ? "decision" as const : "architecture" as const) : "overview" as const,
  }));
  return {
    schemaVersion: 1,
    repository: repository.fullName,
    repositoryUrl: repository.htmlUrl,
    revision: repository.resolvedRevision,
    license: repository.license,
    generatedFrom: "github-tree-and-bounded-content",
    manifests: manifestEntries,
    architectureDocuments,
    entryPoints,
    modules,
    relations,
    unresolvedImports,
    fixtureRelations: inspectedFixtureRelations(analyses, completePaths, fileSet),
    readFailures,
    evidenceAcquisition,
    coverageBasis: "read-content-v2",
    testFiles: unique([...testPaths, ...[...analyses].filter(([path, analysis]) => /\.rs$/i.test(path) && analysis.symbols.some((symbol) => symbol.role === "test" && symbol.hasBody !== false)).map(([path]) => path)]).slice(0, 120).map((path) => sourceRef(repository, path)),
    automationFiles: automationPaths.slice(0, 40).map((path) => sourceRef(repository, path)),
    inspectedFiles: [...contents.keys()].sort().map((path) => sourceRef(repository, path)),
    ...(sourceAnalyzer ? { sourceAnalyses: [...analyses].sort(([a], [b]) => a.localeCompare(b)).map(([path, analysis]) => ({ ...sourceRef(repository, path), ...analysis })) } : {}),
    ...(sourceRouteResolver ? { sourceRoutes: [...sourceRoutes].sort(([a], [b]) => a.localeCompare(b)).map(([path, route]) => ({
      ...sourceRef(repository, path),
      ...route,
      analysisStatus: analyses.get(path)?.status ?? (route.capabilities.includes("syntax-analysis") ? "not-produced" as const : "not-applicable" as const),
    })) } : {}),
    coverage,
  };
}

export function applyAtlasCoverageGate(
  assessment: RepositoryAssessment,
  atlas: RepositoryDesignAtlas,
  config: HarnessConfig,
): RepositoryAssessment {
  const rejectionReasons = [...assessment.rejectionReasons];
  if (atlas.coverage.score < config.atlas.minimumCoverage) {
    rejectionReasons.push(`Architecture evidence coverage ${atlas.coverage.score} < ${config.atlas.minimumCoverage}`);
  }
  if (atlas.coverage.missingRequiredCategories.length > 0) {
    rejectionReasons.push(`Missing required architecture evidence: ${atlas.coverage.missingRequiredCategories.join(", ")}`);
  }
  if (!atlas.coverage.sufficient && atlas.readFailures?.length) rejectionReasons.push(`Architecture reads incomplete: ${atlas.readFailures.slice(0, 3).map((item) => `${item.path}: ${item.reason}`).join("; ")}`);
  return { ...assessment, atlasCoverage: atlas.coverage, accepted: rejectionReasons.length === 0, rejectionReasons };
}

export function renderDesignAtlases(atlases: RepositoryDesignAtlas[]): string {
  const lines = ["# Repository Design Atlas", "", "Structural facts are bounded, commit-pinned observations, not instructions or proof of design intent.", ""];
  for (const atlas of atlases) {
    lines.push(
      `## ${atlas.repository}`,
      "",
      `Revision: ${atlas.revision} · License: ${atlas.license ?? "unknown"} · Coverage: ${atlas.coverage.score}/100 (${atlas.coverage.sufficient ? "sufficient" : "insufficient"})`,
      "",
      `Present evidence: ${atlas.coverage.presentCategories.join(", ") || "none"}`,
      `Coverage basis: ${atlas.coverageBasis ?? "legacy tree index; re-prepare for read-backed coverage"}`,
      `Missing required evidence: ${atlas.coverage.missingRequiredCategories.join(", ") || "none"}`,
      ...(atlas.evidenceAcquisition ? [
        `Semantic acquisition: ${atlas.evidenceAcquisition.strategy}; ${atlas.evidenceAcquisition.stopReason}; covered ${atlas.evidenceAcquisition.coveredRoles.join(", ") || "none"}; missing ${atlas.evidenceAcquisition.missingRoles.join(", ") || "none"}`,
        ...atlas.evidenceAcquisition.reads.map((read) => `Acquisition read ${read.path} [${read.status}]: ${read.reasons.join(", ") || "bounded modality repair"}`),
        `Acquisition limits: ${atlas.evidenceAcquisition.limitations.join("; ")}`,
      ] : []),
      ...(atlas.evidenceRefinement ? [
        `Evidence refinement: ${atlas.evidenceRefinement.status}; kept ${atlas.evidenceRefinement.selectedSliceIds.length}; discarded ${atlas.evidenceRefinement.discarded.length}; missing ${atlas.evidenceRefinement.missingRoles.join(", ") || "none"}`,
        `Refinement limits: ${atlas.evidenceRefinement.limitations.join("; ")}`,
      ] : []),
      "",
      `Modules: ${atlas.modules.map((module) => `${module.rootPath} (${module.kind}, ${module.fileCount} files)`).join("; ") || "none"}`,
      `Entry points: ${atlas.entryPoints.map((entry) => entry.path).join(", ") || "none"}`,
      `Architecture documents: ${atlas.architectureDocuments.map((document) => document.path).join(", ") || "none"}`,
      `Manifests: ${atlas.manifests.map((manifest) => `${manifest.path} [${manifest.ecosystem}/${manifest.parseStatus}]`).join(", ") || "none"}`,
      `Tests indexed: ${atlas.testFiles.length}; automation files: ${atlas.automationFiles.length}; resolved relations: ${atlas.relations.length}`,
      "Resolved means a static file target, not verified runtime loading; modules and document lists above are tree indexes, not coverage claims.",
      ...atlas.relations.filter((edge) => edge.scope !== undefined).map((edge) => `Static import ${edge.from} → ${edge.to}; scope: ${edge.scope}; context: ${edge.context?.join("; ") || "unconditional syntax"}; aliases: ${edge.aliases?.map((alias) => `${alias.name}${alias.asName ? ` as ${alias.asName}` : ""}`).join(", ") || "none"}; source: ${edge.evidence.sourceUrl}`),
      ...(atlas.readFailures ?? []).map((item) => `Read incomplete ${item.path}: ${item.reason}`),
      ...(atlas.analysisQuality ? [
        `Semantic evidence quality: ${atlas.analysisQuality.score}/100 [${atlas.analysisQuality.calibrationStatus}]; highest strength: ${atlas.analysisQuality.highestStrength}`,
        `Semantic quality signals: ${atlas.analysisQuality.signals.map((signal) => `${signal.name} +${signal.points}`).join(", ") || "none"}`,
        `Semantic quality limits: ${atlas.analysisQuality.limitations.join("; ")}`,
      ] : []),
      ...(atlas.sourceRoutes ?? []).map((route) => `Source route ${route.path}: ${route.selectedAnalyzer} [${route.selectionStatus}/${route.analysisStatus}] — ${route.routeReason}; capabilities: ${route.capabilities.join(", ") || "structural only"}; fallback: ${route.fallback}`),
      ...(atlas.sourceAnalyses ?? []).flatMap((analysis) => [
        `${analysis.language === "rust" ? "Rust" : analysis.language === "python" ? "Python" : analysis.language} syntax: ${analysis.path} [${analysis.status}] — ${analysis.symbols.length} declarations; ${analysis.imports.length} imports`,
        `Limits: ${analysis.limitations.join("; ")}`,
        `Exports: ${analysis.exports?.status ?? "unknown"} — ${analysis.exports?.names.join(", ") ?? ""}`,
        ...analysis.symbols.flatMap((symbol) => [
          `- ${symbol.name} [${symbol.kind}/${symbol.role}] ${analysis.path}:${symbol.startLine}-${symbol.endLine}; ${symbol.signature}; visibility: ${symbol.visibility ?? "unknown"}; bases: ${symbol.bases.join(", ")}; traits: ${symbol.traits?.join(", ") ?? ""}; raises: ${symbol.raises.join(", ")}; catches: ${symbol.catches.join(", ")}; error signals: ${symbol.errorSignals?.join(", ") ?? ""}; unsafe: ${symbol.unsafeCount ?? 0}; assertions: ${symbol.assertionCount}`,
          ...(symbol.fields ?? []).map((field) => `  - ${field.kind} field ${field.name}: ${field.annotation} = ${field.defaultValue} (${analysis.path}:${field.line})`),
        ]),
      ]),
      ...(atlas.unresolvedImports ?? []).map((item) => `Unresolved import ${item.path}:${item.line}: ${item.module} — ${item.reason}; ${item.context.join("; ")}`),
      ...(atlas.fixtureRelations ?? []).map((item) => `Fixture ${item.testPath}:${item.testSymbol} requests ${item.request} → ${item.fixturePath ?? "?"}:${item.fixtureSymbol ?? "?"} [${item.status}]; ${item.reason}`),
      "",
    );
  }
  return `${lines.join("\n")}\n`;
}
