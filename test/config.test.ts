import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";
import { loadConfig } from "../src/config.ts";

test("license policy defaults to warning, supports strict opt-in and rejects typos", async (t) => {
  const directory = await mkdtemp(resolve(tmpdir(), "imitator-license-config-"));
  t.after(async () => rm(directory, { recursive: true, force: true }));
  const path = resolve(directory, "config.json");
  assert.equal((await loadConfig()).acceptance.licensePolicy, "warn");
  await writeFile(path, JSON.stringify({ acceptance: { allowedLicenses: ["MIT"] } }));
  assert.equal((await loadConfig(path)).acceptance.licensePolicy, "warn");
  await writeFile(path, JSON.stringify({ acceptance: { licensePolicy: "allowlist" } }));
  assert.equal((await loadConfig(path)).acceptance.licensePolicy, "allowlist");
  await writeFile(path, JSON.stringify({ acceptance: { licensePolicy: "alowlist" } }));
  await assert.rejects(loadConfig(path), /licensePolicy must be warn or allowlist/);
});

test("bounds Design Atlas budgets and rejects unknown evidence categories", async (t) => {
  const directory = await mkdtemp(resolve(tmpdir(), "imitator-config-"));
  t.after(async () => rm(directory, { recursive: true, force: true }));
  const path = resolve(directory, "imitator.config.json");
  await writeFile(path, JSON.stringify({
    atlas: {
      maxFiles: 999,
      maxTotalCharacters: 1,
      minimumCoverage: -10,
      requiredCategories: ["source", "unknown-remote-claim"],
    },
  }));
  const config = await loadConfig(path);
  assert.equal(config.atlas.maxFiles, 64);
  assert.equal(config.atlas.maxTotalCharacters, 10_000);
  assert.equal(config.atlas.minimumCoverage, 0);
  assert.deepEqual(config.atlas.requiredCategories, ["source"]);
});

test("bounds discovery, slicing, scoring, bundle and review controls", async (t) => {
  const directory = await mkdtemp(resolve(tmpdir(), "imitator-all-config-"));
  t.after(async () => rm(directory, { recursive: true, force: true }));
  const path = resolve(directory, "imitator.config.json");
  await writeFile(path, JSON.stringify({
    github: { minimumStars: -1, candidateLimit: 500, inspectLimit: 0 },
    acceptance: { minimumOverall: 120, minimumDomainMatch: -5, maximumRisk: 250, allowedLicenses: ["MIT", " MIT "] },
    slicing: { maxRepositories: 20, maxFilesPerRepository: 100, maxLinesPerSlice: 1000, maxSlices: 1000, maxTotalCharacters: 9_000_000 },
    bundles: { maxSlicesPerBundle: 2, minimumEvidenceKinds: 5 },
    review: { minimumConfidence: 2, minimumEvidenceSlices: 500, maximumRisk: "medium" },
  }));
  const config = await loadConfig(path);
  assert.deepEqual(config.github, { minimumStars: 0, candidateLimit: 100, inspectLimit: 1 });
  assert.deepEqual(config.acceptance, { minimumOverall: 100, minimumDomainMatch: 0, maximumRisk: 100, allowedLicenses: ["MIT"], licensePolicy: "warn" });
  assert.deepEqual(config.slicing, { maxRepositories: 2, maxFilesPerRepository: 12, maxLinesPerSlice: 500, maxSlices: 48, maxTotalCharacters: 120_000 });
  assert.equal(config.bundles.minimumEvidenceKinds, 2);
  assert.equal(config.review.minimumConfidence, 1);
  assert.equal(config.review.minimumEvidenceSlices, 48);
});

test("rejects config shapes that could disable policy checks", async (t) => {
  const directory = await mkdtemp(resolve(tmpdir(), "imitator-invalid-config-"));
  t.after(async () => rm(directory, { recursive: true, force: true }));
  const path = resolve(directory, "imitator.config.json");
  await writeFile(path, JSON.stringify({ review: { maximumRisk: "critical" } }));
  await assert.rejects(loadConfig(path), /review.maximumRisk must be low, medium or high/);
  await writeFile(path, JSON.stringify({ acceptance: { allowedLicenses: "MIT" } }));
  await assert.rejects(loadConfig(path), /allowedLicenses must be an array/);
  await writeFile(path, JSON.stringify([]));
  await assert.rejects(loadConfig(path), /config must be an object/);
});
