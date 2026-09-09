import assert from "node:assert/strict";
import test from "node:test";
import { containsDomainTerm, domainMetadataSignal, extractTaskDomain, normalizeDomainSpec } from "../src/domain.ts";
import { defaultConfig } from "../src/config.ts";
import { planQueries } from "../src/query.ts";
import { fingerprintTask, normalizeTaskSpec } from "../src/task.ts";
import { cacheTask, calendarTask, parserTask, queueTask } from "./domain-fixtures.ts";

test("task-defined vocabularies work for unrelated domains without a core glossary", () => {
  for (const task of [cacheTask, calendarTask, parserTask, queueTask]) {
    const domain = extractTaskDomain(task);
    assert.equal(domain.source, "task-profile");
    assert.equal(domain.anchors[0], task.domain!.purpose.name);
    const queries = planQueries(task, defaultConfig);
    assert.ok(queries.length > 0 && queries.length <= 5);
    assert.ok(queries.every((query) => domain.aliases.some((alias) => query.startsWith(alias))));
    assert.ok(queries.some((query) => !query.includes("language:")));
    assert.ok(!queries.some((query) => /zero-dependency|implement|readme|exports/.test(query)));
  }
});

test("engineering prefixes cannot truncate task-grounded purpose or capabilities", () => {
  const task = { ...cacheTask, task: `${"Implement a small zero-dependency TypeScript library with deterministic tests and README. ".repeat(8)}${cacheTask.task}` };
  assert.deepEqual(extractTaskDomain(task), extractTaskDomain(cacheTask));
  const viaMustHave = { ...cacheTask, task: "Implement a small library", mustHave: [cacheTask.task] };
  assert.deepEqual(extractTaskDomain(viaMustHave), extractTaskDomain(cacheTask));
});

test("engineering-only and untranslated ambiguous requests do not invent a domain", () => {
  for (const task of [
    "Build a zero-dependency provider-neutral high-quality TypeScript library with ESM exports and deterministic tests",
    "开发一个零依赖的高质量系统",
  ]) {
    const spec = { task, avoid: ["LRU cache"], queries: [] };
    assert.equal(extractTaskDomain(spec).source, "unknown");
    assert.deepEqual(planQueries(spec, defaultConfig), []);
  }
  assert.deepEqual(extractTaskDomain({ task: "Build a markdown parser library" }).anchors, ["markdown", "parser"]);
  assert.equal(domainMetadataSignal("markdown parser", { task: "markdown parser" }).score, 75);
});

test("profiles reject engineering-only concepts, forged grounding, duplicates and query syntax", () => {
  for (const name of ["zero-dependency", "TypeScript", "ESM exports", "零依赖"]) {
    const domain = structuredClone(cacheTask.domain!);
    domain.purpose.name = name;
    assert.throws(() => normalizeDomainSpec(domain, cacheTask), /engineering preferences/);
  }
  const domain = structuredClone(cacheTask.domain!);
  domain.purpose.taskEvidence = "not present in the local task";
  assert.throws(() => normalizeDomainSpec(domain, cacheTask), /not grounded/);
  domain.purpose.taskEvidence = "LRU cache";
  domain.purpose.aliases = ["lru language:rust"];
  assert.throws(() => normalizeDomainSpec(domain, cacheTask), /plain search terms/);
  domain.purpose.aliases = [];
  domain.capabilities.push(domain.capabilities[0]!);
  assert.throws(() => normalizeDomainSpec(domain, cacheTask), /unique/);
  assert.throws(() => normalizeDomainSpec({ ...domain, capabilities: [] }, cacheTask), /1-8/);
  assert.throws(() => normalizeDomainSpec("bad", cacheTask), /object/);
});

test("purpose is required; capability overlap alone cannot promote an adjacent domain", () => {
  assert.equal(domainMetadataSignal("JWT TTL expiration", cacheTask).score, 0);
  assert.equal(domainMetadataSignal("LRU", cacheTask).score, 60);
  assert.equal(domainMetadataSignal("LRU eviction", cacheTask).score, 73);
  assert.equal(domainMetadataSignal("LRU eviction TTL", cacheTask).score, 85);
  assert.equal(domainMetadataSignal("lru cache least recently used eviction evict recency TTL expiry", cacheTask).score, 85);
  assert.equal(domainMetadataSignal("zero-dependency TypeScript README ESM", cacheTask).score, 0);
});

test("matching respects word boundaries and code identifiers, not arbitrary substrings", () => {
  assert.equal(containsDomainTerm("author", "auth"), false);
  assert.equal(containsDomainTerm("cachet", "cache"), false);
  assert.equal(containsDomainTerm("HookRegistry", "hook registry"), true);
  assert.equal(containsDomainTerm("LRUCache", "lru"), true);
  assert.equal(containsDomainTerm("expires_at", "expires at"), true);
});

test("profile vocabulary is canonicalized and task-bound before discovery", () => {
  const a = structuredClone(cacheTask);
  const b = structuredClone(cacheTask);
  b.domain!.purpose.aliases.reverse();
  b.domain!.capabilities.reverse();
  assert.deepEqual(normalizeTaskSpec(a), normalizeTaskSpec(b));
  assert.equal(fingerprintTask(a, "C:/workspace", "abc"), fingerprintTask(b, "C:/workspace", "abc"));
  b.domain!.purpose.aliases.push("bounded cache");
  assert.notEqual(fingerprintTask(a, "C:/workspace", "abc"), fingerprintTask(b, "C:/workspace", "abc"));
});

test("task normalization bounds every discovery input", () => {
  assert.throws(() => normalizeTaskSpec({ task: "" }), /task must not be empty/);
  assert.throws(() => normalizeTaskSpec({ task: "bounded", queries: Array.from({ length: 6 }, (_, index) => `query-${index}`) }), /queries must contain at most 5 strings/);
  assert.throws(() => normalizeTaskSpec({ task: "bounded", language: "x".repeat(101) }), /language exceeds 100 characters/);
  assert.throws(() => normalizeTaskSpec({ task: "bounded", mustHave: ["x".repeat(2_001)] }), /mustHave exceeds 2000 characters/);
});
