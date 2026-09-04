import assert from "node:assert/strict";
import test from "node:test";
import { applyAtlasCoverageGate, buildRepositoryDesignAtlas, renderDesignAtlases } from "../src/atlas.ts";
import { defaultConfig } from "../src/config.ts";
import type { GitHubClient } from "../src/github.ts";
import { assessRepository } from "../src/score.ts";
import { matureRepository } from "./helpers.ts";

test("builds a commit-pinned design atlas with manifests, modules, entries, and resolved relations", async () => {
  const repository = matureRepository({
    tree: [
      { path: "README.md", type: "blob", sha: "1", size: 200 },
      { path: "docs/architecture.md", type: "blob", sha: "2", size: 200 },
      { path: "package.json", type: "blob", sha: "3", size: 300 },
      { path: "src/index.ts", type: "blob", sha: "4", size: 200 },
      { path: "src/registry.ts", type: "blob", sha: "5", size: 200 },
      { path: "test/registry.test.ts", type: "blob", sha: "6", size: 200 },
      { path: ".github/workflows/check.yml", type: "blob", sha: "7", size: 200 },
    ],
  });
  const contents: Record<string, string> = {
    "README.md": "Agent registry overview",
    "docs/architecture.md": "Registry owns extension registration and lookup.",
    ".github/workflows/check.yml": "name: check\njobs: {}\n",
    "package.json": JSON.stringify({ name: "agent", main: "src/index.ts", dependencies: { typebox: "1" }, devDependencies: { typescript: "5" }, scripts: { test: "node --test" } }),
    "src/index.ts": "export { Registry } from './registry';\n",
    "src/registry.ts": "export class Registry {}\n",
    "test/registry.test.ts": "import { Registry } from '../src/registry';\nvoid Registry;\n",
  };
  const client = {
    async readTextFile(_repository: string, path: string, revision: string): Promise<string> {
      assert.equal(revision, "abc123def456");
      if (!(path in contents)) throw new Error("unreadable");
      return contents[path]!;
    },
  } as unknown as GitHubClient;
  const atlas = await buildRepositoryDesignAtlas(client, repository, { task: "coding agent registry architecture" }, defaultConfig);
  assert.equal(atlas.coverage.score, 100);
  assert.equal(atlas.coverage.sufficient, true);
  assert.equal(atlas.manifests[0]!.parseStatus, "parsed");
  assert.deepEqual(atlas.manifests[0]!.dependencies, ["typebox"]);
  assert.ok(atlas.entryPoints.some((entry) => entry.path === "src/index.ts"));
  assert.ok(atlas.modules.some((module) => module.rootPath === "src"));
  assert.deepEqual(atlas.relations.map((relation) => [relation.from, relation.to, relation.kind]), [
    ["src/index.ts", "src/registry.ts", "imports"],
    ["test/registry.test.ts", "src/registry.ts", "tests"],
  ]);
  assert.match(renderDesignAtlases([atlas]), /resolved relations: 2/);
});

test("fails the architecture coverage gate with named, explainable missing evidence", async () => {
  const repository = matureRepository({
    tree: [
      { path: "README.md", type: "blob", sha: "1", size: 200 },
      { path: "package.json", type: "blob", sha: "2", size: 200 },
      { path: "src/index.ts", type: "blob", sha: "3", size: 200 },
    ],
  });
  const client = { async readTextFile(): Promise<string> { return "{}"; } } as unknown as GitHubClient;
  const config = structuredClone(defaultConfig);
  const assessment = assessRepository(repository, { task: "coding agent registry architecture" }, config, new Date("2026-09-01T00:00:00Z"));
  const atlas = await buildRepositoryDesignAtlas(client, repository, { task: "coding agent registry architecture" }, config);
  const gated = applyAtlasCoverageGate(assessment, atlas, config);
  assert.equal(atlas.coverage.score, 40);
  assert.deepEqual(atlas.coverage.missingRequiredCategories, ["test"]);
  assert.equal(gated.accepted, false);
  assert.match(gated.rejectionReasons.join(" "), /Architecture evidence coverage 40 < 50/);
  assert.match(gated.rejectionReasons.join(" "), /Missing required architecture evidence: test/);
  assert.ok(atlas.coverage.signals.every((signal) => signal.name.endsWith("-evidence") && signal.sources.length > 0));
});
