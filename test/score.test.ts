import assert from "node:assert/strict";
import test from "node:test";
import { defaultConfig } from "../src/config.ts";
import { assessRepository } from "../src/score.ts";
import { matureRepository } from "./helpers.ts";
import { cacheTask } from "./domain-fixtures.ts";

const task = { task: "TypeScript coding agent harness with extensions", ecosystem: "typescript" };
const now = new Date("2026-09-01T00:00:00Z");

test("accepts a relevant, mature, permissively licensed repository", () => {
  const result = assessRepository(matureRepository(), task, defaultConfig, now);
  assert.equal(result.accepted, true);
  assert.ok(result.overall >= defaultConfig.acceptance.minimumOverall);
  assert.ok(result.dimensions.domainMatch.score >= defaultConfig.acceptance.minimumDomainMatch);
  assert.ok(result.dimensions.risk.score <= defaultConfig.acceptance.maximumRisk);
});

test("default license warnings do not alter technical scores or acceptance", () => {
  const baseline = assessRepository(matureRepository(), task, defaultConfig, now);
  for (const license of [null, "GPL-3.0", "Custom-License", "NOASSERTION"]) {
    const result = assessRepository(matureRepository({ license }), task, defaultConfig, now);
    assert.equal(result.accepted, true, String(license));
    assert.deepEqual(result.dimensions, baseline.dimensions);
    assert.equal(result.overall, baseline.overall);
    assert.match(result.licenseWarnings!.join(" "), license ? /license-not-allowlisted/ : /license-unknown/);
    assert.match(result.licenseWarnings!.join(" "), /does not authorize copying/);
  }
  assert.match(baseline.dimensions.transferability.reasons.join(" "), /license-independent-transfer-baseline/);
  assert.equal(assessRepository(matureRepository({ tree: [], sizeKb: 200_000 }), task, defaultConfig, now).dimensions.transferability.score, 65);
});

test("optional allowlist mode rejects licenses independently without changing technical scores", () => {
  const config = structuredClone(defaultConfig);
  config.acceptance.licensePolicy = "allowlist";
  for (const license of [null, "GPL-3.0", "Custom-License"]) {
    const repo = matureRepository({ license });
    const result = assessRepository(repo, task, config, now);
    assert.equal(result.accepted, false);
    assert.deepEqual(result.rejectionReasons, ["license-policy: license is not allowlisted"]);
    assert.deepEqual(result.dimensions, assessRepository(repo, task, defaultConfig, now).dimensions);
  }
  config.acceptance.allowedLicenses.push("Custom-License");
  assert.equal(assessRepository(matureRepository({ license: "Custom-License" }), task, config, now).accepted, true);
  assert.equal(assessRepository(matureRepository(), task, config, now).accepted, true);
});

test("warning policy does not bypass non-license risk gates", () => {
  const result = assessRepository(matureRepository({ license: null, archived: true, pushedAt: "2020-01-01T00:00:00Z" }), task, defaultConfig, now);
  assert.equal(result.accepted, false);
  assert.equal(result.dimensions.risk.score, 53);
  assert.ok(result.rejectionReasons.some((reason) => reason.startsWith("Risk ")));
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

test("live LRU false positives cannot turn engineering preferences into domain points", () => {
  for (const [fullName, description] of [
    ["davidjerleke/embla-carousel", "A lightweight carousel library with fluid motion"],
    ["radashi-org/radashi", "Functional utility library"],
    ["tsndr/cloudflare-worker-jwt", "JWT implementation for Cloudflare Workers"],
    ["privy-io/shamir-secret-sharing", "Shamir secret sharing"],
  ]) {
    const repo = matureRepository({ fullName, description: `${description} zero-dependency TypeScript`, topics: ["typescript", "zero-dependency"], stars: 1_000_000 });
    const result = assessRepository(repo, cacheTask, defaultConfig, now);
    assert.equal(result.dimensions.domainMatch.score, 0, fullName);
    assert.equal(result.accepted, false, fullName);
    assert.match(result.dimensions.domainMatch.reasons.join(" "), /engineering-preferences-excluded/);
    assert.match(result.rejectionReasons.join(" "), /domain-metadata-missing/);
  }
});

test("real cache metadata matches across languages while license warnings stay independent", () => {
  for (const [fullName, description] of [
    ["isaacs/node-lru-cache", "A cache object that deletes the least-recently-used items"],
    ["sindresorhus/quick-lru", "Simple Least Recently Used (LRU) cache"],
    ["example/python-cache", "Least recently used cache"],
  ]) {
    const repo = matureRepository({ fullName, description, topics: [], language: "JavaScript" });
    assert.equal(assessRepository(repo, cacheTask, defaultConfig, now).accepted, true);
    const warned = assessRepository({ ...repo, license: "not-allowlisted" }, cacheTask, defaultConfig, now);
    assert.equal(warned.dimensions.domainMatch.score, 60);
    assert.equal(warned.accepted, true);
    assert.match(warned.licenseWarnings!.join(" "), /license-not-allowlisted/);
  }
});
