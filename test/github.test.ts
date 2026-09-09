import assert from "node:assert/strict";
import test from "node:test";
import { GitHubClient } from "../src/github.ts";

const repository = {
  full_name: "example/reference",
  html_url: "https://github.com/example/reference",
  description: "Reference implementation",
  stargazers_count: 10,
  forks_count: 1,
  open_issues_count: 0,
  size: 100,
  archived: false,
  fork: false,
  default_branch: "main",
  pushed_at: "2026-09-01T00:00:00Z",
  created_at: "2025-01-01T00:00:00Z",
  license: { spdx_id: "MIT" },
  language: "TypeScript",
  topics: ["reference"],
};

test("GitHub profile rejects a truncated recursive tree", async () => {
  const fetchImpl: typeof fetch = async (input) => {
    const url = String(input);
    if (url.includes("/commits/")) return Response.json({ sha: "deadbeef" });
    if (url.includes("/git/trees/")) return Response.json({ truncated: true, tree: [{ path: "src/index.ts", type: "blob", sha: "1" }] });
    throw new Error(`Unexpected request: ${url}`);
  };
  const client = new GitHubClient({ fetchImpl, apiBase: "https://mock.github" });
  await assert.rejects(client.profile(repository), /tree.*truncated.*coverage cannot be established/);
});

test("GitHub client rejects malformed repository names and content encodings before use", async () => {
  const client = new GitHubClient({ fetchImpl: async () => Response.json({ encoding: "base64", content: "%%%=" }), apiBase: "https://mock.github" });
  await assert.rejects(client.getRepository("owner/name/extra"), /Invalid repository name/);
  await assert.rejects(client.readTextFile("owner/name", "../secret", "main"), /Invalid repository path/);
  await assert.rejects(client.readTextFile("owner/name", "src/index.ts", "main"), /Invalid base64 content/);
});

test("GitHub client validates repository metadata and bounds direct search calls", async () => {
  let requested = "";
  const client = new GitHubClient({
    fetchImpl: async (input) => { requested = String(input); return Response.json({ items: [repository] }); },
    apiBase: "https://mock.github",
  });
  assert.equal((await client.searchRepositories("reference", -20)).length, 1);
  assert.match(requested, /per_page=1/);
  const malformed = new GitHubClient({
    fetchImpl: async () => Response.json({ items: [{ ...repository, pushed_at: "not-a-date" }] }),
    apiBase: "https://mock.github",
  });
  await assert.rejects(malformed.searchRepositories("reference", 1), /Malformed GitHub repository search response/);
});
