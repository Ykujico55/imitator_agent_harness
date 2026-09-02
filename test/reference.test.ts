import assert from "node:assert/strict";
import test from "node:test";
import { learningRepositoryLimit, normalizeSpecifiedRepositories, parseRepositorySpecifier } from "../src/reference.ts";
import { fingerprintTask, normalizeTaskSpec } from "../src/task.ts";

test("parses explicit GitHub repository URLs and optional revisions deterministically", () => {
  assert.deepEqual(parseRepositorySpecifier("https://github.com/Example/Blueprint.git@release/v2"), {
    repository: "example/blueprint",
    revision: "release/v2",
  });
  assert.deepEqual(parseRepositorySpecifier("Example/Blueprint"), { repository: "example/blueprint", revision: undefined });
  assert.throws(() => parseRepositorySpecifier("https://example.com/owner/repo"), /github.com/);
});

test("limits, deduplicates, and task-binds explicitly selected learning repositories", () => {
  assert.equal(learningRepositoryLimit(0), 1);
  assert.equal(learningRepositoryLimit(99), 2);
  assert.throws(() => normalizeSpecifiedRepositories([
    { repository: "a/one" }, { repository: "b/two" }, { repository: "c/three" },
  ]), /At most 2/);
  assert.throws(() => normalizeSpecifiedRepositories([
    { repository: "A/One" }, { repository: "a/one", revision: "main" },
  ]), /Duplicate/);
  const automatic = { task: "add retries" };
  const explicit = { task: "add retries", referenceRepositories: [{ repository: "Example/Queue", revision: "v2" }] };
  assert.deepEqual(normalizeTaskSpec(explicit).referenceRepositories, [{ repository: "example/queue", revision: "v2" }]);
  assert.notEqual(fingerprintTask(automatic, "C:/work", "abc"), fingerprintTask(explicit, "C:/work", "abc"));
});
