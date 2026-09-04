import type { EvidenceBundle, RepositoryDesignAtlas, RepositoryProfile, TaskSpec } from "../src/types.ts";

export function codingAgentTask(task = "coding agent hook registry"): TaskSpec {
  return { task, domain: {
    purpose: { name: "coding agent", aliases: ["agent harness"], taskEvidence: "coding agent" },
    capabilities: [{ name: "registry", aliases: ["extension registry", "hook registry"], taskEvidence: task.includes("registry") ? "registry" : "extensions" }],
  } };
}

export function matureRepository(overrides: Partial<RepositoryProfile> = {}): RepositoryProfile {
  return {
    fullName: "example/coding-agent",
    htmlUrl: "https://github.com/example/coding-agent",
    description: "Extensible TypeScript coding agent harness with tool plugins",
    stars: 12_000,
    forks: 900,
    openIssues: 30,
    sizeKb: 22_000,
    archived: false,
    fork: false,
    defaultBranch: "main",
    resolvedRevision: "abc123def456",
    pushedAt: "2026-08-20T00:00:00Z",
    createdAt: "2022-01-01T00:00:00Z",
    license: "MIT",
    language: "TypeScript",
    topics: ["coding-agent", "agent-harness", "typescript"],
    tree: [
      { path: "README.md", type: "blob", sha: "1", size: 2000 },
      { path: "docs/architecture.md", type: "blob", sha: "2", size: 3000 },
      { path: "src/extensions/tool-registry.ts", type: "blob", sha: "3", size: 4000 },
      { path: "examples/basic.ts", type: "blob", sha: "4", size: 1000 },
      { path: "test/extensions.test.ts", type: "blob", sha: "5", size: 2000 },
      { path: ".github/workflows/check.yml", type: "blob", sha: "6", size: 500 },
      { path: "CONTRIBUTING.md", type: "blob", sha: "7", size: 800 },
      { path: "package.json", type: "blob", sha: "8", size: 800 },
      { path: "tsconfig.json", type: "blob", sha: "9", size: 800 },
    ],
    ...overrides,
  };
}

export function matureAtlas(repository = matureRepository()): RepositoryDesignAtlas {
  const ref = (path: string) => ({ path, sourceUrl: `${repository.htmlUrl}/blob/${repository.resolvedRevision}/${path}` });
  return {
    schemaVersion: 1,
    repository: repository.fullName,
    repositoryUrl: repository.htmlUrl,
    revision: repository.resolvedRevision,
    license: repository.license,
    generatedFrom: "github-tree-and-bounded-content",
    manifests: [{
      ...ref("package.json"), ecosystem: "node", parseStatus: "parsed", packageName: "coding-agent",
      dependencies: [], developmentDependencies: ["typescript"], scripts: ["test"], workspacePatterns: [],
    }],
    architectureDocuments: [
      { ...ref("README.md"), kind: "overview" },
      { ...ref("docs/architecture.md"), kind: "architecture" },
    ],
    entryPoints: [{ ...ref("src/extensions/tool-registry.ts"), reason: "task-relevant public module" }],
    modules: [{ rootPath: "src/extensions", kind: "library", fileCount: 1, entryPoints: ["src/extensions/tool-registry.ts"] }],
    relations: [],
    testFiles: [ref("test/extensions.test.ts")],
    automationFiles: [ref(".github/workflows/check.yml")],
    inspectedFiles: [ref("package.json"), ref("src/extensions/tool-registry.ts"), ref("test/extensions.test.ts")],
    coverage: {
      score: 90,
      sufficient: true,
      requiredCategories: ["source", "test"],
      presentCategories: ["overview", "design", "manifest", "source", "test", "automation"],
      missingRequiredCategories: [],
      signals: [
        { name: "overview-evidence", points: 10, sources: [ref("README.md")] },
        { name: "design-evidence", points: 20, sources: [ref("docs/architecture.md")] },
        { name: "manifest-evidence", points: 10, sources: [ref("package.json")] },
        { name: "source-evidence", points: 20, sources: [ref("src/extensions/tool-registry.ts")] },
        { name: "test-evidence", points: 20, sources: [ref("test/extensions.test.ts")] },
        { name: "automation-evidence", points: 10, sources: [ref(".github/workflows/check.yml")] },
      ],
    },
  };
}

export function matureBundle(repository = matureRepository(), evidenceSliceIds = ["slice-a", "slice-b"], id = "bundle-architecture"): EvidenceBundle {
  return {
    schemaVersion: 1,
    id,
    repository: repository.fullName,
    concern: "system-architecture",
    question: "How are extension registration, execution, and verification boundaries separated?",
    epistemicCeiling: "explicit",
    evidenceKinds: ["documentation", "implementation"],
    evidenceSliceIds,
    relatedPaths: ["docs/architecture.md", "src/extensions/tool-registry.ts"],
    relations: [],
    limitations: ["The bounded evidence does not establish behavior outside the extension subsystem."],
  };
}
