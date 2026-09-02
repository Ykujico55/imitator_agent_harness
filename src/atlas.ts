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

const MANIFEST = /(^|\/)(package\.json|pyproject\.toml|Cargo\.toml|go\.mod|pom\.xml|build\.gradle(?:\.kts)?)$/i;
const SOURCE = /(^|\/)(src|lib)(\/|$)|^(packages|apps)\/[^/]+\/(src|lib)(\/|$)/i;
const TEST = /(^|\/)(test|tests|spec|__tests__)(\/|$)|\.(test|spec)\.[cm]?[jt]sx?$/i;
const AUTOMATION = /^\.github\/workflows\/.*\.ya?ml$/i;
const OVERVIEW = /(^|\/)README(?:\.[^/]*)?$/i;
const DESIGN = /(^|\/)(architecture|design|adr|rfcs?)(\/|\.|$)|(^|\/)(ADR|RFC)-?\d+[^/]*\.md$/i;
const SECURITY = /(^|\/)(SECURITY|THREAT_MODEL)(\.[^/]*)?$/i;
const SCRIPT_SOURCE = /\.[cm]?[jt]sx?$/i;
const ENTRY = /(^|\/)(index|main|cli|server|app)\.[cm]?[jt]sx?$/i;
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
  if (/pyproject\.toml$/i.test(path)) return "python";
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
  const entryTargets = [root.main, root.module, root.types, ...strings(root.bin), ...strings(root.exports)]
    .flatMap((value) => strings(value))
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
  if ((parts[0] === "packages" || parts[0] === "apps") && parts[1]) {
    return { rootPath: `${parts[0]}/${parts[1]}`, kind: parts[0] === "apps" ? "application" : "package" };
  }
  if (parts[0] === "src" || parts[0] === "lib") {
    return { rootPath: parts.length > 2 ? `${parts[0]}/${parts[1]}` : parts[0], kind: "library" };
  }
  if (TEST.test(path)) return { rootPath: parts.length > 1 ? parts[0]! : ".", kind: "test" };
  if (/(^|\/)(examples?|samples?)(\/|$)/i.test(path)) return { rootPath: parts.length > 1 ? parts[0]! : ".", kind: "example" };
  return undefined;
}

function resolveRelativeImport(from: string, specifier: string, files: Set<string>): string | undefined {
  if (!specifier.startsWith(".")) return undefined;
  const base = posix.normalize(posix.join(posix.dirname(from), specifier));
  const candidates = [
    base,
    ...[".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"].map((extension) => `${base}${extension}`),
    ...[".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"].map((extension) => `${base}/index${extension}`),
  ];
  return candidates.find((candidate) => files.has(candidate));
}

function extractRelations(contents: Map<string, string>, files: Set<string>, repository: RepositoryProfile): RepositoryDesignAtlas["relations"] {
  const relations: RepositoryDesignAtlas["relations"] = [];
  const seen = new Set<string>();
  for (const [from, content] of [...contents].sort(([a], [b]) => a.localeCompare(b))) {
    if (!SCRIPT_SOURCE.test(from)) continue;
    for (const pattern of IMPORT_PATTERNS) {
      pattern.lastIndex = 0;
      for (let match = pattern.exec(content); match; match = pattern.exec(content)) {
        const target = resolveRelativeImport(from, match[1]!, files);
        if (!target) continue;
        const kind = TEST.test(from) ? "tests" as const : "imports" as const;
        const key = `${from}\0${target}\0${kind}`;
        if (seen.has(key)) continue;
        seen.add(key);
        relations.push({ from, to: target, kind, evidence: sourceRef(repository, from) });
      }
    }
  }
  return relations.slice(0, 500);
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
): Promise<RepositoryDesignAtlas> {
  const files = blobPaths(repository.tree);
  const fileSet = new Set(files);
  const manifestPaths = files.filter((path) => MANIFEST.test(path));
  const sourcePaths = files.filter((path) => SOURCE.test(path) && SCRIPT_SOURCE.test(path) && !TEST.test(path));
  const testPaths = files.filter((path) => TEST.test(path) && SCRIPT_SOURCE.test(path));
  const overviewPaths = files.filter((path) => OVERVIEW.test(path));
  const designPaths = files.filter((path) => DESIGN.test(path) || SECURITY.test(path));
  const automationPaths = files.filter((path) => AUTOMATION.test(path));
  const terms = taskTerms(task).map((term) => term.toLowerCase());

  const rankedStructuralFiles = unique([...manifestPaths, ...sourcePaths, ...testPaths]).sort((a, b) => {
    const score = (path: string): number =>
      (MANIFEST.test(path) ? 100 : 0) + (ENTRY.test(path) ? 60 : 0) +
      (terms.some((term) => path.toLowerCase().includes(term)) ? 30 : 0) + (TEST.test(path) ? 10 : 0) - path.split("/").length;
    return score(b) - score(a) || a.localeCompare(b);
  });
  const contents = new Map<string, string>();
  const attemptedPaths = new Set<string>();
  let characters = 0;
  for (const path of rankedStructuralFiles.slice(0, Math.max(0, config.atlas.maxFiles))) {
    if (characters >= config.atlas.maxTotalCharacters) break;
    const entry = repository.tree.find((item) => item.type === "blob" && item.path === path);
    if ((entry?.size ?? 0) > 120_000) continue;
    attemptedPaths.add(path);
    try {
      const content = await client.readTextFile(repository.fullName, path, repository.resolvedRevision);
      if (content.includes("\0")) continue;
      contentCache.set(repositoryContentKey(repository.fullName, repository.resolvedRevision, path), content);
      const remaining = config.atlas.maxTotalCharacters - characters;
      const bounded = content.slice(0, remaining);
      contents.set(path, bounded);
      characters += bounded.length;
    } catch {
      // Structural evidence is best-effort; coverage records what was actually available.
    }
  }

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
  for (const path of manifestPaths.filter((value) => /package\.json$/i.test(value))) {
    const content = contents.get(path);
    if (!content) continue;
    try {
      const parsed = parsePackageManifest(content);
      for (const target of parsed.entryTargets) {
        const resolved = posix.normalize(posix.join(posix.dirname(path), target));
        if (fileSet.has(resolved)) entryPaths.add(resolved);
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

  const relations = extractRelations(contents, fileSet, repository);
  const categories = {
    overview: overviewPaths,
    design: designPaths,
    manifest: manifestPaths,
    source: sourcePaths,
    test: testPaths,
    automation: automationPaths,
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
    testFiles: testPaths.slice(0, 120).map((path) => sourceRef(repository, path)),
    automationFiles: automationPaths.slice(0, 40).map((path) => sourceRef(repository, path)),
    inspectedFiles: [...contents.keys()].sort().map((path) => sourceRef(repository, path)),
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
      `Missing required evidence: ${atlas.coverage.missingRequiredCategories.join(", ") || "none"}`,
      "",
      `Modules: ${atlas.modules.map((module) => `${module.rootPath} (${module.kind}, ${module.fileCount} files)`).join("; ") || "none"}`,
      `Entry points: ${atlas.entryPoints.map((entry) => entry.path).join(", ") || "none"}`,
      `Architecture documents: ${atlas.architectureDocuments.map((document) => document.path).join(", ") || "none"}`,
      `Manifests: ${atlas.manifests.map((manifest) => `${manifest.path} [${manifest.ecosystem}/${manifest.parseStatus}]`).join(", ") || "none"}`,
      `Tests indexed: ${atlas.testFiles.length}; automation files: ${atlas.automationFiles.length}; resolved relations: ${atlas.relations.length}`,
      "",
    );
  }
  return `${lines.join("\n")}\n`;
}
