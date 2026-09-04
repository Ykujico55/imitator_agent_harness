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
