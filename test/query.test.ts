import assert from "node:assert/strict";
import test from "node:test";
import { defaultConfig } from "../src/config.ts";
import { planQueries, taskTerms } from "../src/query.ts";

test("derives bilingual domain terms and bounded GitHub queries", () => {
  const task = { task: "开发一个 coding agent，先搜索相关代码库并提取架构范式", language: "TypeScript" };
  const terms = taskTerms(task);
  assert.ok(terms.includes("coding-agent"));
  assert.ok(terms.includes("repository-search"));
  assert.ok(terms.includes("architecture"));
  const queries = planQueries(task, defaultConfig);
  assert.ok(queries.length > 0 && queries.length <= 5);
  assert.ok(queries.every((query) => query.includes("stars:>=100") && query.includes("language:TypeScript")));
  assert.ok(queries.every((query) => /coding-agent|agent-harness|code-search|repository-search|software-patterns/.test(query)));
});

test("does not emit broad supporting-term queries when domain anchors exist", () => {
  const queries = planQueries({ task: "TypeScript coding agent lifecycle hooks" }, defaultConfig);
  assert.ok(queries.every((query) => query.includes("coding-agent") || query.includes("agent-harness")));
  assert.ok(!queries.some((query) => query.startsWith("typescript hooks ")));
});

test("keeps explicit queries but still applies safety qualifiers", () => {
  const [query] = planQueries({ task: "x", queries: ["durable task queue"] }, defaultConfig);
  assert.match(query!, /^durable task queue /);
  assert.match(query!, /archived:false/);
  assert.match(query!, /fork:false/);
});
