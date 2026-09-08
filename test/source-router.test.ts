import assert from "node:assert/strict";
import test from "node:test";
import { createDefaultSourceRouter, createSourceRouter } from "../integrations/source-router.ts";
import { buildRepositoryDesignAtlas, renderDesignAtlases } from "../src/atlas.ts";
import { defaultConfig } from "../src/config.ts";
import type { GitHubClient } from "../src/github.ts";
import { prepareReferencePack } from "../src/pipeline.ts";
import { assessRepository } from "../src/score.ts";
import { collectSlices } from "../src/slice.ts";
import type { SourceLanguageAdapter } from "../src/source-routing.ts";
import { codingAgentTask, matureRepository } from "./helpers.ts";

test("default source router selects one enhanced parser per file in a polyglot tree", () => {
  const router = createDefaultSourceRouter();
  assert.deepEqual(router.resolve({ path: "src/cache.py" }), {
    selectedAnalyzer: "python-stdlib-ast", routeReason: "extension:.py", selectionStatus: "enhanced",
    capabilities: ["syntax-analysis", "semantic-slicing"], fallback: "line-window-on-no-semantic-window", analysisLanguage: "python",
  });
  assert.equal(router.resolve({ path: "crates/core/src/lib.rs" }).selectedAnalyzer, "rust-static-syntax");
  assert.equal(router.resolve({ path: "crates/core/Cargo.toml" }).routeReason, "rust-manifest");
  assert.equal(router.resolve({ path: "packages/ui/src/view.tsx" }).selectedAnalyzer, "typescript-compiler-ast");
  assert.equal(router.resolve({ path: "tools\\worker.mjs" }).selectedAnalyzer, "typescript-compiler-ast");
  assert.equal(router.resolve({ path: "service/main.go" }).selectedAnalyzer, "structural-fallback");
  assert.equal(router.resolve({ path: "README.md" }).selectionStatus, "structural-fallback");
});

test("a selected parser failure never falls through to another language adapter", () => {
  let unrelatedAnalyzeCalls = 0;
  let unrelatedSliceCalls = 0;
  const router = createSourceRouter([
    {
      id: "python-test-adapter", analysisLanguage: "python", match: (path) => path.endsWith(".py") ? "extension:.py" : undefined,
      analyze: () => ({ language: "python", status: "invalid", parser: "test", limitations: ["invalid syntax"], symbols: [], imports: [] }),
      selectWindow: () => undefined,
    },
    {
      id: "rust-test-adapter", analysisLanguage: "rust", match: (path) => path.endsWith(".rs") ? "extension:.rs" : undefined,
      analyze: () => { unrelatedAnalyzeCalls++; return undefined; },
      selectWindow: () => { unrelatedSliceCalls++; return undefined; },
    },
  ]);
  assert.equal(router.analyze({ path: "broken.py", content: "def broken(" })?.status, "invalid");
  assert.equal(router.selectWindow({ path: "broken.py", content: "def broken(", terms: [], maxLines: 20 }), undefined);
  assert.equal(unrelatedAnalyzeCalls, 0);
  assert.equal(unrelatedSliceCalls, 0);
  assert.equal(router.resolve({ path: "broken.py" }).selectedAnalyzer, "python-test-adapter");
});

test("language slots are additive and ambiguous ownership fails closed", () => {
  const go: SourceLanguageAdapter = {
    id: "go-static-v1", analysisLanguage: "go",
    match: (path) => path.endsWith(".go") ? "extension:.go" : undefined,
    analyze: () => ({ language: "go", status: "parsed", parser: "go-test", limitations: [], symbols: [{
      name: "Store", kind: "interface", startLine: 1, endLine: 1, signature: "type Store interface", decorators: [], bases: [], raises: [], catches: [], assertionCount: 0, role: "implementation",
    }], imports: [] }),
    selectWindow: ({ content }) => ({ start: 1, end: 1, content, relevance: 2, strategy: "go-static" }),
  };
  const extended = createDefaultSourceRouter({ additionalAdapters: [go] });
  assert.equal(extended.resolve({ path: "cmd/server/main.go" }).selectedAnalyzer, "go-static-v1");
  assert.deepEqual(extended.resolve({ path: "cmd/server/main.go" }).capabilities, ["syntax-analysis", "semantic-slicing"]);
  assert.equal(extended.analyze({ path: "cmd/server/main.go", content: "package main" })?.language, "go");

  let called = 0;
  const ambiguous = createSourceRouter([
    { id: "one", match: (path) => path.endsWith(".x") ? "extension:.x" : undefined, selectWindow: () => { called++; return undefined; } },
    { id: "two", match: (path) => path.endsWith(".x") ? "also-extension:.x" : undefined, selectWindow: () => { called++; return undefined; } },
  ]);
  const decision = ambiguous.resolve({ path: "source.x" });
  assert.equal(decision.selectionStatus, "ambiguous");
  assert.equal(decision.selectedAnalyzer, "structural-fallback");
  assert.match(decision.routeReason, /^ambiguous-language-adapters:one,two$/);
  assert.equal(ambiguous.selectWindow({ path: "source.x", content: "x", terms: [], maxLines: 10 }), undefined);
  assert.equal(called, 0);
  assert.throws(() => createSourceRouter([go, go]), /Duplicate source adapter ID/);
});

test("pipeline accepts a cohesive router and rejects mixed routing injection before I/O", async () => {
  const sourceRouter = createDefaultSourceRouter();
  await assert.rejects(
    prepareReferencePack({} as unknown as GitHubClient, codingAgentTask(), defaultConfig, { sourceRouter, sourceAnalyzer: sourceRouter.analyze }),
    /Provide sourceRouter as one unit/,
  );
});

test("Atlas, slices and rendered context preserve route and fallback outcomes", async () => {
  const repository = matureRepository();
  const contents: Record<string, string> = {
    "README.md": "# Coding agent\nArchitecture and registry design.",
    "docs/architecture.md": "# Architecture\nRegistry owns extension lookup; tools own behavior.",
    "src/extensions/tool-registry.ts": "export interface Tool {\n  name: string;\n}\nexport function register(tool: Tool) {\n  return tool.name;\n}\n",
    "examples/basic.ts": "import { register } from '../src/extensions/tool-registry.js';\nregister({ name: 'read' });\n",
    "test/extensions.test.ts": "import test from 'node:test';\ntest('registers', () => {\n  register({ name: 'read' });\n});\n",
    ".github/workflows/check.yml": "name: check\njobs: {}",
    "CONTRIBUTING.md": "Run tests before changes.",
    "package.json": "{\"name\":\"coding-agent\",\"scripts\":{\"test\":\"node --test\"}}",
    "tsconfig.json": "{\"compilerOptions\":{\"strict\":true}}",
  };
  const client = { readTextFile: async (_repo: string, path: string) => contents[path] ?? "" } as unknown as GitHubClient;
  const router = createDefaultSourceRouter();
  const task = codingAgentTask();
  const atlas = await buildRepositoryDesignAtlas(client, repository, task, defaultConfig, new Map(), router.analyze, router.resolve);
  const tsRoute = atlas.sourceRoutes?.find((item) => item.path === "src/extensions/tool-registry.ts");
  assert.equal(tsRoute?.selectedAnalyzer, "typescript-compiler-ast");
  assert.equal(tsRoute?.analysisStatus, "not-applicable");
  assert.equal(atlas.sourceRoutes?.find((item) => item.path === "README.md")?.selectionStatus, "structural-fallback");
  assert.match(renderDesignAtlases([atlas]), /Source route src\/extensions\/tool-registry\.ts: typescript-compiler-ast/);

  const assessment = assessRepository(repository, task, defaultConfig, new Date("2026-09-08"));
  assessment.accepted = true;
  const slices = await collectSlices(client, [assessment], task, defaultConfig, router.selectWindow, [atlas], new Map(), [], router.resolve);
  const semantic = slices.find((item) => item.path === "src/extensions/tool-registry.ts");
  assert.equal(semantic?.strategy, "typescript-ast");
  assert.equal(semantic?.sourceRoute?.outcome, "semantic-window");
  assert.equal(semantic?.sourceRoute?.selectedAnalyzer, "typescript-compiler-ast");
  const documentation = slices.find((item) => item.path === "README.md");
  assert.equal(documentation?.strategy, "line-window");
  assert.equal(documentation?.sourceRoute?.outcome, "line-window-fallback");
  assert.equal(documentation?.sourceRoute?.routeReason, "no-matching-language-adapter");
});
