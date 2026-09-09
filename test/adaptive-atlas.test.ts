import assert from "node:assert/strict";
import test from "node:test";
import { buildRepositoryDesignAtlas, repositoryContentKey } from "../src/atlas.ts";
import { defaultConfig } from "../src/config.ts";
import type { GitHubClient } from "../src/github.ts";
import type { SourceAnalysis, SourceSymbol } from "../src/source-analysis.ts";
import { analyzeTypeScriptSource } from "../integrations/typescript-analysis.ts";
import { createRustAnalysis } from "../integrations/rust-syntax.ts";
import { matureRepository } from "./helpers.ts";

function fixture(contents: Record<string, string>) {
  const repository = matureRepository({ tree: Object.entries(contents).map(([path, content]) => ({ path, type: "blob", sha: path, size: content.length })) });
  const reads: string[] = [];
  const client = { async readTextFile(name: string, path: string, revision: string) {
    assert.equal(name, repository.fullName);
    assert.equal(revision, repository.resolvedRevision);
    reads.push(path);
    assert.ok(Object.hasOwn(contents, path));
    return contents[path]!;
  } } as unknown as GitHubClient;
  return { repository, reads, client };
}

function symbol(name: string, patch: Partial<SourceSymbol> = {}): SourceSymbol {
  return { name, kind: "function", startLine: 1, endLine: 2, signature: `def ${name}():`, decorators: [], bases: [], raises: [], catches: [], assertionCount: 0,
    role: "implementation", hasBody: true, ...patch };
}

function python(symbols: SourceSymbol[] = [], patch: Partial<SourceAnalysis> = {}): SourceAnalysis {
  return { language: "python", status: "parsed", parser: "injected-static-observations", limitations: ["Injected syntax fixture; no remote execution."], symbols, imports: [], ...patch };
}

test("semantic acquisition follows nested manifest targets and TypeScript import chains, then stops before unrelated files", async () => {
  const contents = {
    "src/index.ts": 'export { execute } from "./worker.js";\n',
    "test/worker.test.ts": 'import { execute } from "../src/worker.js";\ntest("works", () => { assert.equal(execute(1), 1); });\n',
    "package.json": JSON.stringify({ exports: { ".": { types: "./api/opaque.ts", default: "./src/index.ts" } } }),
    "api/opaque.ts": 'export interface Request { value: number }\n',
    "src/worker.ts": 'import { validate } from "./deep/opaque.js";\nexport function execute(value: number) { return validate(value); }\n',
    "src/deep/opaque.ts": 'export function validate(value: number) { if (value < 0) throw new Error("negative"); return value; }\n',
    "src/unrelated.ts": 'export const unrelated = 1;\n',
  };
  const { repository, reads, client } = fixture(contents);
  const cache = new Map([[repositoryContentKey(repository.fullName, repository.resolvedRevision, "src/index.ts"), contents["src/index.ts"]],
    [repositoryContentKey(repository.fullName, "stale-revision", "src/worker.ts"), "untrusted stale data"]]);
  const atlas = await buildRepositoryDesignAtlas(client, repository, { task: "worker behavior" }, defaultConfig, cache, analyzeTypeScriptSource);
  const acquisition = atlas.evidenceAcquisition!;
  assert.equal(acquisition.stopReason, "satisfied");
  assert.deepEqual(acquisition.missingRoles, []);
  assert.ok(!reads.includes("src/index.ts"), "same revision content is reused");
  assert.ok(reads.includes("src/worker.ts"), "a stale revision cannot supply a read");
  assert.ok(!reads.includes("src/unrelated.ts"), "remaining file budget is not a quota");
  assert.ok(acquisition.reads.find((read) => read.path === "api/opaque.ts")!.reasons.includes("manifest-target:package.json"));
  assert.ok(acquisition.reads.find((read) => read.path === "src/deep/opaque.ts")!.reasons.some((reason) => reason.startsWith("import-target:src/worker.ts:")));
  assert.ok(atlas.relations.some((relation) => relation.from === "src/worker.ts" && relation.to === "src/deep/opaque.ts"));
  assert.ok(atlas.entryPoints.some((entry) => entry.path === "api/opaque.ts"));
  assert.ok(atlas.inspectedFiles.every((file) => file.sourceUrl.includes(`/blob/${repository.resolvedRevision}/`)));
  assert.equal(acquisition.reads.length, 6);
});

test("missing roles nominate task and role paths without claiming fields prove invariants", async () => {
  const { repository, reads, client } = fixture({
    "src/index.ts": 'export interface Request { value: number }\n',
    "test/basic.test.ts": 'test("placeholder", () => { run(); });\n',
    "src/recovery.ts": 'export function recover() { throw new Error("failed"); }\n',
    "src/cache.ts": 'import { Request } from "./index";\nexport function check(value: Request) { assert(value.value >= 0); }\n',
    "src/unrelated.ts": 'export const other = 0;\n',
  });
  const atlas = await buildRepositoryDesignAtlas(client, repository, { task: "cache" }, defaultConfig, new Map(), analyzeTypeScriptSource);
  assert.ok(reads.includes("src/recovery.ts"));
  assert.ok(atlas.evidenceAcquisition!.reads.find((read) => read.path === "src/recovery.ts")!.reasons.includes("missing-role-path-candidate:failure"));
  assert.ok(atlas.evidenceAcquisition!.reads.find((read) => read.path === "src/cache.ts")!.reasons.includes("task-relevant-path-candidate"));
  assert.equal(atlas.evidenceAcquisition!.stopReason, "satisfied");
  assert.ok(!reads.includes("src/unrelated.ts"));

  const plain = fixture({ "src/index.ts": 'export interface Request { value: number }\n' });
  const fieldsOnly = await buildRepositoryDesignAtlas(plain.client, plain.repository, { task: "request" }, defaultConfig, new Map(), analyzeTypeScriptSource);
  assert.ok(fieldsOnly.evidenceAcquisition!.missingRoles.includes("invariant"));
  assert.match(fieldsOnly.evidenceAcquisition!.limitations.join(" "), /fields and variants alone do not establish invariants/);
});

test("Rust acquisition follows Cargo entry targets and parsed module declarations within a shared budget", async () => {
  const { repository, reads, client } = fixture({
    "src/lib.rs": 'mod opaque;\npub fn run() {}\n#[cfg(test)] mod tests { #[test] fn works() { assert!(true); } }\n',
    "Cargo.toml": '[package]\nname = "sample"\n[lib]\npath = "engine/entry.rs"\n',
    "engine/entry.rs": 'pub fn fail() -> Result<(), Error> { Err(Error) }\npub struct Error;\n',
    "src/opaque.rs": 'pub struct Store;\n',
    "src/unrelated.rs": 'pub struct Unrelated;\n',
  });
  const config = structuredClone(defaultConfig);
  config.atlas.maxFiles = 4;
  const atlas = await buildRepositoryDesignAtlas(client, repository, { task: "storage" }, config, new Map(), createRustAnalysis().analyze);
  assert.equal(atlas.evidenceAcquisition!.stopReason, "satisfied", "meeting requirements on the final permitted read is success");
  assert.ok(reads.includes("engine/entry.rs"));
  assert.ok(reads.includes("src/opaque.rs"));
  assert.ok(!reads.includes("src/unrelated.rs"));
  assert.ok(atlas.evidenceAcquisition!.reads.find((read) => read.path === "engine/entry.rs")!.reasons.includes("manifest-target:Cargo.toml"));
  assert.ok(atlas.evidenceAcquisition!.reads.find((read) => read.path === "src/opaque.rs")!.reasons.some((reason) => reason.startsWith("import-target:src/lib.rs:")));
});

test("Python acquisition follows visible fixture scopes and leaves shadowing ambiguous", async () => {
  const { repository, reads, client } = fixture({
    "src/main.py": "def run():\n    return 1\n",
    "tests/test_main.py": "def test_run(resource):\n    assert resource\n",
    "conftest.py": "def resource():\n    return 1\n",
    "tests/conftest.py": "def resource():\n    return 2\n",
    "src/opaque.py": "def guard():\n    raise ValueError()\n",
    "unrelated/conftest.py": "def resource():\n    return 3\n",
  });
  const observations: Record<string, SourceAnalysis> = {
    "src/main.py": python([symbol("run")], { imports: [{ module: "opaque", names: ["guard"], level: 0, line: 1 }] }),
    "tests/test_main.py": python([symbol("test_run", { role: "test", assertionCount: 1, fixtureRequests: ["resource"] })]),
    "conftest.py": python([symbol("resource", { role: "fixture", fixtureName: "resource" })]),
    "tests/conftest.py": python([symbol("resource", { role: "fixture", fixtureName: "resource" })]),
    "src/opaque.py": python([symbol("guard", { raises: ["ValueError"] })]),
  };
  const atlas = await buildRepositoryDesignAtlas(client, repository, { task: "generic" }, defaultConfig, new Map(), ({ path }) => observations[path]);
  assert.ok(reads.includes("conftest.py") && reads.includes("tests/conftest.py"));
  assert.ok(!reads.includes("unrelated/conftest.py"));
  assert.equal(atlas.fixtureRelations![0]!.status, "unresolved");
  assert.equal(atlas.fixtureRelations![0]!.reason, "ambiguous-fixture-shadowing");
  assert.ok(atlas.evidenceAcquisition!.reads.find((read) => read.path === "tests/conftest.py")!.reasons.includes("fixture-scope:tests/test_main.py:test_run"));
});

test("budget exhaustion preserves missing roles and refuses partially inspected fixture resolution", async () => {
  const { repository, client } = fixture({
    "src/main.py": "def run():\n    return 1\n",
    "tests/test_main.py": "def test_run(resource):\n    assert resource\n",
    "conftest.py": "def resource():\n    return 1\n",
    "tests/conftest.py": "def resource():\n    return 2\n",
  });
  const analyzer = ({ path }: { path: string }): SourceAnalysis => path.includes("conftest") ? python([symbol("resource", { role: "fixture" })])
    : path.includes("test_main") ? python([symbol("test_run", { role: "test", assertionCount: 1, fixtureRequests: ["resource"] })]) : python([symbol("run")]);
  const config = structuredClone(defaultConfig); config.atlas.maxFiles = 3;
  const atlas = await buildRepositoryDesignAtlas(client, repository, { task: "generic" }, config, new Map(), analyzer);
  assert.equal(atlas.evidenceAcquisition!.stopReason, "budget-exhausted");
  assert.ok(atlas.evidenceAcquisition!.missingRoles.includes("failure"));
  assert.ok(atlas.evidenceAcquisition!.missingRoles.includes("relationship"));
  assert.equal(atlas.fixtureRelations![0]!.status, "unresolved");
  assert.equal(atlas.fixtureRelations![0]!.reason, "fixture-scope-not-completely-inspected");
  assert.equal(atlas.fixtureRelations![0]!.fixturePath, undefined);
});

test("ambiguous TypeScript targets and failed parsing never create semantic relationship evidence", async () => {
  const { repository, reads, client } = fixture({
    "src/index.ts": 'import { run } from "./opaque";\nexport const result = run;\n',
    "src/opaque.ts": "export const run = 1;\n",
    "src/opaque.tsx": "export const run = 2;\n",
  });
  const atlas = await buildRepositoryDesignAtlas(client, repository, { task: "generic" }, defaultConfig, new Map(), analyzeTypeScriptSource);
  assert.deepEqual(reads, ["src/index.ts"]);
  assert.equal(atlas.relations.length, 0);
  assert.ok(atlas.evidenceAcquisition!.missingRoles.includes("relationship"));
  assert.equal(atlas.evidenceAcquisition!.stopReason, "no-supported-candidates");
  const bad = fixture({ "src/index.ts": 'export function broken(\n' });
  const failed = await buildRepositoryDesignAtlas(bad.client, bad.repository, { task: "generic" }, defaultConfig, new Map(), analyzeTypeScriptSource);
  assert.deepEqual(failed.evidenceAcquisition!.coveredRoles, []);
  assert.deepEqual(failed.evidenceAcquisition!.missingRoles, ["contract", "invariant", "failure", "relationship", "test"]);
});

test("failed and truncated reads consume budgets without establishing semantic roles", async () => {
  const { repository } = fixture({ "src/index.ts": 'export function main() { throw new Error("failed"); }\n', "test/main.test.ts": "test();\n" });
  const config = structuredClone(defaultConfig); config.atlas.maxFiles = 2; config.atlas.maxTotalCharacters = 10;
  let calls = 0;
  const client = { async readTextFile(_name: string, path: string) { calls += 1; if (path.includes("index")) throw new Error("read denied"); return "test(\"works\", () => assert(true));\n"; } } as unknown as GitHubClient;
  const atlas = await buildRepositoryDesignAtlas(client, repository, { task: "generic" }, config, new Map(), analyzeTypeScriptSource);
  assert.equal(calls, 2);
  assert.deepEqual(atlas.evidenceAcquisition!.reads.map((read) => read.status), ["failed", "truncated"]);
  assert.deepEqual(atlas.evidenceAcquisition!.coveredRoles, []);
  assert.equal(atlas.evidenceAcquisition!.stopReason, "budget-exhausted");
  assert.equal(atlas.coverage.sufficient, false);
});
