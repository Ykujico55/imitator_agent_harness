import assert from "node:assert/strict";
import test from "node:test";
import { rankSearchCandidates } from "../src/discovery.ts";
import type { GitHubRepository } from "../src/github.ts";
import { cacheTask } from "./domain-fixtures.ts";

function repository(fullName: string, description: string, stars: number, topics: string[] = []): GitHubRepository {
  return {
    full_name: fullName,
    html_url: `https://github.com/${fullName}`,
    description,
    stargazers_count: stars,
    forks_count: 10,
    open_issues_count: 1,
    size: 1000,
    archived: false,
    fork: false,
    default_branch: "main",
    pushed_at: "2026-08-01T00:00:00Z",
    created_at: "2024-01-01T00:00:00Z",
    license: { spdx_id: "MIT" },
    language: "TypeScript",
    topics,
  };
}

test("core domain anchors outrank unrelated repositories with far more stars", () => {
  const popular = repository("popular/react-hooks", "React hooks library", 100_000, ["typescript", "hooks"]);
  const relevant = repository("small/agent-kit", "Extensible coding agent harness", 250, ["coding-agent", "agent-harness"]);
  const ranked = rankSearchCandidates([[popular, relevant]], { task: "TypeScript coding agent harness with lifecycle hooks" }, 2);
  assert.equal(ranked[0]!.repository.full_name, relevant.full_name);
  assert.match(ranked[0]!.reasons.join(" "), /core anchors/);
  assert.match(ranked[1]!.reasons.join(" "), /weak signal/);
});

test("cross-query agreement improves discovery rank deterministically", () => {
  const once = repository("example/once", "coding agent harness", 5000, ["coding-agent"]);
  const repeated = repository("example/repeated", "coding agent harness", 200, ["coding-agent"]);
  const ranked = rankSearchCandidates([[once, repeated], [repeated]], { task: "coding agent harness" }, 2);
  assert.equal(ranked[0]!.repository.full_name, repeated.full_name);
  assert.match(ranked[0]!.reasons.join(" "), /matched 2 search queries/);
});

test("LRU discovery ranks real cache metadata ahead of engineering-only matches", () => {
  const unrelated = repository("radashi-org/radashi", "zero-dependency TypeScript utility library", 1_000_000, ["typescript", "zero-dependency"]);
  const cache = repository("sindresorhus/quick-lru", "Simple Least Recently Used cache", 767);
  const ranked = rankSearchCandidates([[unrelated, cache], [unrelated]], cacheTask, 2);
  assert.equal(ranked[0]!.repository.full_name, cache.full_name);
  assert.match(ranked[0]!.reasons.join(" "), /domain-purpose-match/);
  assert.match(ranked[1]!.reasons.join(" "), /domain-metadata-missing/);
});

test("duplicate search rows cannot inflate cross-query agreement", () => {
  const item = repository("example/one", "coding agent", 100);
  const single = rankSearchCandidates([[item]], { task: "coding agent" }, 1);
  const repeated = rankSearchCandidates([[item, item, item]], { task: "coding agent" }, 1);
  assert.deepEqual(repeated, single);
});
