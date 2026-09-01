import assert from "node:assert/strict";
import test from "node:test";
import { defaultConfig } from "../src/config.ts";
import { assessRepository } from "../src/score.ts";
import { matureRepository } from "./helpers.ts";

const task = { task: "TypeScript coding agent harness with extensions", ecosystem: "typescript" };
const now = new Date("2026-09-01T00:00:00Z");

test("accepts a relevant, mature, permissively licensed repository", () => {
  const result = assessRepository(matureRepository(), task, defaultConfig, now);
  assert.equal(result.accepted, true);
  assert.ok(result.overall >= defaultConfig.acceptance.minimumOverall);
  assert.ok(result.dimensions.domainMatch.score >= defaultConfig.acceptance.minimumDomainMatch);
  assert.ok(result.dimensions.risk.score <= defaultConfig.acceptance.maximumRisk);
});

test("license is a hard gate even when popularity is high", () => {
  const result = assessRepository(matureRepository({ license: null, stars: 500_000 }), task, defaultConfig, now);
  assert.equal(result.accepted, false);
  assert.ok(result.rejectionReasons.includes("License is not allowlisted"));
  assert.ok(result.dimensions.risk.score > defaultConfig.acceptance.maximumRisk);
});

test("irrelevant repositories cannot pass on stars alone", () => {
  const result = assessRepository(matureRepository({
    fullName: "example/photo-editor",
    description: "popular photo filters",
    topics: ["photography"],
    tree: [{ path: "README.md", type: "blob", sha: "x", size: 1000 }],
    stars: 1_000_000,
  }), task, defaultConfig, now);
  assert.equal(result.accepted, false);
  assert.ok(result.dimensions.domainMatch.score < defaultConfig.acceptance.minimumDomainMatch);
});
