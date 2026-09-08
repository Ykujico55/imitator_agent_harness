import assert from "node:assert/strict";
import test from "node:test";
import { isBehaviorCodeFile, isCodeFile, isImplementationPath, isTestPath } from "../src/evidence-path.ts";
import { assessRepository } from "../src/score.ts";
import { defaultConfig } from "../src/config.ts";
import { matureRepository } from "./helpers.ts";

test("recognizes root, nested, Python and Go tests without requiring one project layout", () => {
  for (const path of ["test.js", "test.mjs", "test/test_index.py", "test_cache.py", "src/cache_test.go", "src/cache.spec.ts", "tests/cache.rs"]) {
    assert.equal(isTestPath(path), true, path);
    assert.equal(isCodeFile(path), true, path);
    assert.equal(isImplementationPath(path), false, path);
  }
  for (const path of ["index.js", "cache.py", "src/lib.rs", "lib/cache.go", "src/main.java"]) assert.equal(isImplementationPath(path), true, path);
  for (const path of ["package.json", "README.md", "vite.config.ts", "src/index.d.ts"]) assert.equal(isBehaviorCodeFile(path), false, path);
  assert.equal(isImplementationPath("build.rs"), false, "Cargo build support must not satisfy application source coverage");
});

test("root behavioral tests earn named maturity/design signals but a test-plan document does not", () => {
  const base = matureRepository({ stars: 0, forks: 0, tree: [] });
  const assess = (path: string) => assessRepository({ ...base, tree: [{ path, type: "blob", sha: "test", size: 30 }] }, { task: "coding agent" }, defaultConfig, new Date("2026-09-01"));
  const absent = assess("tests/plan.md");
  const present = assess("test.js");
  assert.equal(present.dimensions.engineeringMaturity.score - absent.dimensions.engineeringMaturity.score, 18);
  assert.equal(present.dimensions.designQuality.score - absent.dimensions.designQuality.score, 20);
  assert.ok(present.dimensions.engineeringMaturity.reasons.includes("Behavioral test files"));
  assert.ok(present.dimensions.designQuality.reasons.includes("Design is exercised by tests"));
  const support = assess("tests/conftest.py");
  assert.equal(support.dimensions.engineeringMaturity.score, absent.dimensions.engineeringMaturity.score);
  assert.equal(support.dimensions.designQuality.score, absent.dimensions.designQuality.score);
  assert.ok(!support.dimensions.engineeringMaturity.reasons.includes("Behavioral test files"));
  assert.ok(!support.dimensions.designQuality.reasons.includes("Design is exercised by tests"));
});
