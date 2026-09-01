import assert from "node:assert/strict";
import test from "node:test";
import { defaultConfig } from "../src/config.ts";
import { GitHubClient } from "../src/github.ts";
import { prepareReferencePack } from "../src/pipeline.ts";

const repository = {
  full_name: "example/coding-agent-harness",
  html_url: "https://github.com/example/coding-agent-harness",
  description: "A coding agent harness with extension architecture",
  stargazers_count: 5000,
  forks_count: 400,
  open_issues_count: 12,
  size: 10000,
  archived: false,
  fork: false,
  default_branch: "main",
  pushed_at: "2026-08-20T00:00:00Z",
  created_at: "2023-01-01T00:00:00Z",
  license: { spdx_id: "MIT" },
  language: "TypeScript",
  topics: ["coding-agent", "agent-harness"],
};

test("runs search, assessment and commit-pinned slicing through a mocked GitHub API", async () => {
  const calls: string[] = [];
  const fetchImpl = async (input: string | URL | Request): Promise<Response> => {
    const url = String(input);
    calls.push(url);
    if (url.includes("/search/repositories")) return Response.json({ items: [repository] });
    if (url.includes("/git/trees/main")) return Response.json({
      sha: "deadbeef1234",
      tree: [
        { path: "README.md", type: "blob", sha: "1", size: 1200 },
        { path: "docs/architecture.md", type: "blob", sha: "2", size: 1200 },
        { path: "src/extension-registry.ts", type: "blob", sha: "3", size: 1200 },
        { path: "test/extension.test.ts", type: "blob", sha: "4", size: 1200 },
        { path: ".github/workflows/check.yml", type: "blob", sha: "5", size: 1200 },
        { path: "CONTRIBUTING.md", type: "blob", sha: "6", size: 1200 },
        { path: "package.json", type: "blob", sha: "7", size: 1200 },
        { path: "tsconfig.json", type: "blob", sha: "8", size: 1200 },
      ],
    });
    if (url.includes("/contents/")) return Response.json({
      encoding: "base64",
      content: Buffer.from("export interface ExtensionRegistry { register(name: string): void }\n").toString("base64"),
    });
    return new Response("not found", { status: 404 });
  };
  const client = new GitHubClient({ fetchImpl: fetchImpl as typeof fetch, apiBase: "https://mock.github" });
  const config = structuredClone(defaultConfig);
  config.github.inspectLimit = 1;
  config.slicing.maxFilesPerRepository = 2;
  const pack = await prepareReferencePack(client, {
    task: "coding agent harness extension architecture",
    queries: ["coding agent harness"],
    language: "TypeScript",
  }, config);
  assert.equal(pack.assessments.length, 1);
  assert.equal(pack.assessments[0]!.accepted, true);
  assert.equal(pack.slices.length, 2);
  assert.ok(pack.slices.every((slice) => slice.commitish === "deadbeef1234"));
  assert.ok(calls.some((url) => url.includes("ref=deadbeef1234")));
});
