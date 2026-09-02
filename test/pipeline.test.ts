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
    if (url.includes("/commits/main")) return Response.json({ sha: "deadbeef1234" });
    if (url.includes("/git/trees/deadbeef1234")) return Response.json({
      sha: "tree1234",
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

test("prioritizes an accepted user-specified repository and skips automatic search when the learning set is full", async () => {
  const calls: string[] = [];
  const fetchImpl = async (input: string | URL | Request): Promise<Response> => {
    const url = String(input);
    calls.push(url);
    if (url.includes("/commits/release-v1")) return Response.json({ sha: "pinned-commit" });
    if (url.includes("/git/trees/pinned-commit")) return Response.json({ sha: "tree", tree: [
      { path: "README.md", type: "blob", sha: "1", size: 1200 },
      { path: "docs/architecture.md", type: "blob", sha: "2", size: 1200 },
      { path: "src/extension-registry.ts", type: "blob", sha: "3", size: 1200 },
      { path: "test/extension.test.ts", type: "blob", sha: "4", size: 1200 },
      { path: ".github/workflows/check.yml", type: "blob", sha: "5", size: 1200 },
      { path: "CONTRIBUTING.md", type: "blob", sha: "6", size: 1200 },
      { path: "package.json", type: "blob", sha: "7", size: 1200 },
      { path: "tsconfig.json", type: "blob", sha: "8", size: 1200 },
    ] });
    if (url.endsWith("/repos/example/coding-agent-harness")) return Response.json(repository);
    if (url.includes("/contents/")) return Response.json({ encoding: "base64", content: Buffer.from("export interface ExtensionRegistry {}\n").toString("base64") });
    if (url.includes("/search/repositories")) throw new Error("automatic search should not run");
    return new Response("not found", { status: 404 });
  };
  const client = new GitHubClient({ fetchImpl: fetchImpl as typeof fetch, apiBase: "https://mock.github" });
  const config = structuredClone(defaultConfig);
  config.slicing.maxRepositories = 1;
  config.slicing.maxFilesPerRepository = 2;
  const pack = await prepareReferencePack(client, {
    task: "coding agent harness extension architecture",
    language: "TypeScript",
    referenceRepositories: [{ repository: "https://github.com/example/coding-agent-harness", revision: "release-v1" }],
  }, config);
  assert.equal(pack.selection?.automaticSearchUsed, false);
  assert.equal(pack.selection?.specified[0]!.status, "accepted");
  assert.deepEqual(pack.selection?.selectedRepositories, ["example/coding-agent-harness"]);
  assert.equal(pack.assessments[0]!.selectionOrigin, "user-specified");
  assert.ok(pack.slices.every((slice) => slice.commitish === "pinned-commit"));
  assert.ok(!calls.some((url) => url.includes("/search/repositories")));
});

test("reports a rejected specified repository and falls back to automatic discovery", async () => {
  const unsuitable = {
    ...repository,
    full_name: "example/photo-gallery",
    html_url: "https://github.com/example/photo-gallery",
    description: "A browser photo gallery and image viewer",
    topics: ["photos", "gallery"],
  };
  const tree = [
    { path: "README.md", type: "blob", sha: "1", size: 1200 },
    { path: "docs/architecture.md", type: "blob", sha: "2", size: 1200 },
    { path: "src/extension-registry.ts", type: "blob", sha: "3", size: 1200 },
    { path: "test/extension.test.ts", type: "blob", sha: "4", size: 1200 },
    { path: ".github/workflows/check.yml", type: "blob", sha: "5", size: 1200 },
    { path: "CONTRIBUTING.md", type: "blob", sha: "6", size: 1200 },
    { path: "package.json", type: "blob", sha: "7", size: 1200 },
    { path: "tsconfig.json", type: "blob", sha: "8", size: 1200 },
  ];
  const fetchImpl = async (input: string | URL | Request): Promise<Response> => {
    const url = String(input);
    if (url.includes("/search/repositories")) return Response.json({ items: [repository] });
    if (url.includes("/repos/example/photo-gallery/commits/main")) return Response.json({ sha: "photo-commit" });
    if (url.includes("/repos/example/coding-agent-harness/commits/main")) return Response.json({ sha: "agent-commit" });
    if (url.includes("/git/trees/photo-commit") || url.includes("/git/trees/agent-commit")) return Response.json({ sha: "tree", tree });
    if (url.endsWith("/repos/example/photo-gallery")) return Response.json(unsuitable);
    if (url.includes("/contents/")) return Response.json({ encoding: "base64", content: Buffer.from("export interface ExtensionRegistry {}\n").toString("base64") });
    return new Response("not found", { status: 404 });
  };
  const client = new GitHubClient({ fetchImpl: fetchImpl as typeof fetch, apiBase: "https://mock.github" });
  const config = structuredClone(defaultConfig);
  config.slicing.maxRepositories = 1;
  config.slicing.maxFilesPerRepository = 2;
  const pack = await prepareReferencePack(client, {
    task: "coding agent harness extension architecture",
    queries: ["coding agent harness"],
    language: "TypeScript",
    referenceRepositories: [{ repository: "example/photo-gallery" }],
  }, config);
  assert.equal(pack.selection?.specified[0]!.status, "rejected");
  assert.equal(pack.selection?.automaticSearchUsed, true);
  assert.deepEqual(pack.selection?.selectedRepositories, ["example/coding-agent-harness"]);
  assert.equal(pack.assessments.find((item) => item.repository.fullName === "example/coding-agent-harness")?.selectionOrigin, "automatic");
});
