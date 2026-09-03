import assert from "node:assert/strict";
import test from "node:test";
import { selectTypeScriptAstWindow } from "../integrations/typescript-ast.ts";
import { defaultConfig } from "../src/config.ts";
import { rankPaths, collectSlices, type SliceReadFailure } from "../src/slice.ts";
import { assessRepository } from "../src/score.ts";
import type { GitHubClient } from "../src/github.ts";
import { matureRepository } from "./helpers.ts";

test("ranks architecture evidence above generic implementation", () => {
  const repo = matureRepository();
  repo.tree.push(
    { path: "src/scrapers/rfc.ts", type: "blob", sha: "10", size: 1000 },
    { path: "AGENTS.md", type: "blob", sha: "11", size: 1000 },
    { path: ".agents/architecture.md", type: "blob", sha: "12", size: 1000 },
    { path: ".pre-commit-config.yaml", type: "blob", sha: "13", size: 1000 },
  );
  const ranked = rankPaths(repo.tree, ["extensions"]);
  assert.equal(ranked[0]!.entry.path, "docs/architecture.md");
  assert.ok(ranked.every((item) => item.entry.path !== ".github/workflows/check.yml" || item.score < ranked[0]!.score));
  assert.ok(ranked.every((item) => item.entry.path !== "AGENTS.md" && !item.entry.path.startsWith(".agents/")));
  assert.ok(ranked.every((item) => item.entry.path !== ".pre-commit-config.yaml"));
  assert.ok(!ranked.find((item) => item.entry.path === "src/scrapers/rfc.ts")!.reason.includes("design documentation"));
});

test("collects bounded, attributed windows and ignores unreadable files", async () => {
  const repo = matureRepository();
  const assessment = assessRepository(repo, { task: "coding agent extensions" }, defaultConfig, new Date("2026-09-01T00:00:00Z"));
  const fakeClient = {
    async readTextFile(_repo: string, path: string): Promise<string> {
      if (path === "docs/architecture.md") throw new Error("moved");
      return Array.from({ length: 120 }, (_, index) => index === 70 ? "export interface ExtensionRegistry {}" : `line ${index + 1}`).join("\n");
    },
  } as unknown as GitHubClient;
  const config = structuredClone(defaultConfig);
  config.slicing.maxFilesPerRepository = 2;
  config.slicing.maxLinesPerSlice = 20;
  const slices = await collectSlices(fakeClient, [assessment], { task: "coding agent extensions" }, config);
  assert.equal(slices.length, 1);
  assert.ok(slices[0]!.endLine - slices[0]!.startLine + 1 <= 20);
  assert.match(slices[0]!.sourceUrl, /github\.com\/example\/coding-agent\/blob\/abc123def456\//);
  assert.equal(slices[0]!.commitish, "abc123def456");
  assert.equal(slices[0]!.license, "MIT");
});

test("reports bounded slice read failures instead of silently losing all evidence", async () => {
  const repo = matureRepository();
  const assessment = assessRepository(repo, { task: "coding agent extensions" }, defaultConfig, new Date("2026-09-01T00:00:00Z"));
  const fakeClient = { async readTextFile(): Promise<string> { throw new Error("GitHub rate limit exhausted"); } } as unknown as GitHubClient;
  const config = structuredClone(defaultConfig);
  config.slicing.maxFilesPerRepository = 2;
  const failures: SliceReadFailure[] = [];
  const slices = await collectSlices(fakeClient, [assessment], { task: "coding agent extensions" }, config, undefined, [], new Map(), failures);
  assert.deepEqual(slices, []);
  assert.equal(failures.length, 2);
  assert.ok(failures.every((failure) => failure.reason === "GitHub rate limit exhausted"));
});

test("scales category quotas to use a larger per-repository evidence budget", async () => {
  const repo = matureRepository();
  repo.tree = [
    { path: "README.md", type: "blob", sha: "readme", size: 1000 },
    ...Array.from({ length: 4 }, (_, index) => ({ path: `docs/architecture/decision-${index}.md`, type: "blob" as const, sha: `d${index}`, size: 1000 })),
    ...Array.from({ length: 5 }, (_, index) => ({ path: `test/feature-${index}.test.ts`, type: "blob" as const, sha: `t${index}`, size: 1000 })),
    ...Array.from({ length: 3 }, (_, index) => ({ path: `examples/feature-${index}.ts`, type: "blob" as const, sha: `e${index}`, size: 1000 })),
    ...Array.from({ length: 12 }, (_, index) => ({ path: `src/features/feature-${index}.ts`, type: "blob" as const, sha: `s${index}`, size: 1000 })),
    { path: ".github/workflows/check.yml", type: "blob", sha: "ci", size: 1000 },
    { path: "CONTRIBUTING.md", type: "blob", sha: "contrib", size: 1000 },
  ];
  const assessment = assessRepository(repo, { task: "coding agent extensions" }, defaultConfig, new Date("2026-09-01T00:00:00Z"));
  assert.equal(assessment.accepted, true);
  const fakeClient = {
    async readTextFile(): Promise<string> { return "export function feature(): void {}\n"; },
  } as unknown as GitHubClient;
  const config = structuredClone(defaultConfig);
  config.slicing.maxRepositories = 1;
  config.slicing.maxFilesPerRepository = 12;
  const slices = await collectSlices(fakeClient, [assessment], { task: "coding agent extensions" }, config);
  assert.equal(slices.length, 12);
  assert.ok(new Set(slices.map((slice) => slice.path)).size === 12);
  assert.ok(slices.some((slice) => slice.path.startsWith("src/features/")));
  assert.ok(slices.some((slice) => slice.path.startsWith("test/")));
});

test("preserves nested documentation, manifest, test, and implementation modalities under a tight monorepo budget", async () => {
  const repo = matureRepository();
  repo.tree = [
    { path: "packages/agent/README.md", type: "blob", sha: "readme", size: 1000 },
    { path: "packages/agent/package.json", type: "blob", sha: "manifest", size: 1000 },
    { path: "packages/agent/test/extension.test.ts", type: "blob", sha: "test", size: 1000 },
    ...Array.from({ length: 10 }, (_, index) => ({
      path: `packages/agent/src/extension-registry-${index}.ts`, type: "blob" as const, sha: `source-${index}`, size: 1000,
    })),
  ];
  const assessment = assessRepository(repo, { task: "coding agent extension registry" }, defaultConfig, new Date("2026-09-01T00:00:00Z"));
  const fakeClient = { async readTextFile(): Promise<string> { return "export function extensionRegistry(): void {}\n"; } } as unknown as GitHubClient;
  const config = structuredClone(defaultConfig);
  config.slicing.maxRepositories = 1;
  config.slicing.maxFilesPerRepository = 4;
  const slices = await collectSlices(fakeClient, [assessment], { task: "coding agent extension registry" }, config);
  assert.equal(slices.length, 4);
  assert.ok(slices.some((slice) => slice.path === "packages/agent/README.md"));
  assert.ok(slices.some((slice) => slice.path === "packages/agent/package.json"));
  assert.ok(slices.some((slice) => slice.path.includes("/test/")));
  assert.ok(slices.some((slice) => slice.path.includes("/src/")));
});

test("TypeScript AST slicing returns a complete task-relevant declaration", () => {
  const content = [
    "const unrelated = 1;",
    "",
    "export interface ExtensionRegistry {",
    "  register(name: string): void;",
    "  resolve(name: string): unknown;",
    "}",
    "",
    "export function createExtensionRegistry(): ExtensionRegistry {",
    "  return { register() {}, resolve() { return undefined; } };",
    "}",
    "",
    "export function unrelatedUtility(): number {",
    "  return 42;",
    "}",
  ].join("\n");
  const selected = selectTypeScriptAstWindow({
    path: "src/extensions.ts",
    content,
    terms: ["extension", "registry"],
    maxLines: 8,
  });
  assert.equal(selected?.strategy, "typescript-ast");
  assert.deepEqual(selected?.symbols, ["ExtensionRegistry"]);
  assert.equal(selected?.start, 3);
  assert.equal(selected?.end, 6);
  assert.match(selected?.content ?? "", /^export interface ExtensionRegistry/);
  assert.doesNotMatch(selected?.content ?? "", /unrelatedUtility/);
});

test("TypeScript AST slicing declines unsupported languages for deterministic fallback", () => {
  assert.equal(selectTypeScriptAstWindow({ path: "main.py", content: "def run():\n  pass", terms: ["run"], maxLines: 20 }), undefined);
});
