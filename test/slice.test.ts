import assert from "node:assert/strict";
import test from "node:test";
import { defaultConfig } from "../src/config.ts";
import { rankPaths, collectSlices } from "../src/slice.ts";
import { assessRepository } from "../src/score.ts";
import type { GitHubClient } from "../src/github.ts";
import { matureRepository } from "./helpers.ts";

test("ranks architecture evidence above generic implementation", () => {
  const repo = matureRepository();
  const ranked = rankPaths(repo.tree, ["extensions"]);
  assert.equal(ranked[0]!.entry.path, "docs/architecture.md");
  assert.ok(ranked.every((item) => item.entry.path !== ".github/workflows/check.yml" || item.score < ranked[0]!.score));
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
