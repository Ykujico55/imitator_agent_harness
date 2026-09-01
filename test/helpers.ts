import type { RepositoryProfile } from "../src/types.ts";

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
