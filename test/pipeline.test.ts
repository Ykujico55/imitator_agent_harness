import assert from "node:assert/strict";
import test from "node:test";
import { defaultConfig } from "../src/config.ts";
import { GitHubClient } from "../src/github.ts";
import { prepareReferencePack } from "../src/pipeline.ts";
import { cacheTask, calendarTask, parserTask, queueTask } from "./domain-fixtures.ts";
import { applyReviewGate, fingerprintReferencePack } from "../src/review.ts";

test("domain validation occurs before all GitHub I/O, including explicit references", async () => {
  const task = structuredClone(cacheTask);
  task.domain!.purpose.taskEvidence = "invented domain grounding";
  task.referenceRepositories = [{ repository: "example/specified" }];
  let calls = 0;
  const client = new GitHubClient({ fetchImpl: async () => { calls++; throw new Error("Unexpected network"); } });
  await assert.rejects(() => prepareReferencePack(client, task, defaultConfig), /not grounded/);
  assert.equal(calls, 0);
});

test("offline discovery-to-review matrix selects product peers instead of engineering-only repositories", async (t) => {
  for (const task of [cacheTask, queueTask, parserTask, calendarTask]) for (const license of ["MIT", "GPL-3.0", null]) await t.test(`${task.domain!.purpose.name} / ${license ?? "unknown-license"}`, async () => {
    const good = { ...repository, license: license ? { spdx_id: license } : null, full_name: "example/product-peer", description: `${task.domain!.purpose.name} ${task.domain!.capabilities.map((item) => item.name).join(" ")}`, topics: [], language: "Python" };
    const noise = { ...repository, full_name: "example/popular-utilities", description: "Zero-dependency TypeScript ESM utilities with tests", topics: ["typescript", "zero-dependency"], stargazers_count: 1_000_000 };
    const behaviorName = task.domain!.capabilities[0]!.name.replace(/ /g, "_");
    const files: Record<string, string> = {
      "README.md": good.description,
      "package.json": '{"name":"product-peer","type":"module"}',
      "src/index.py": `def ${behaviorName}(state):\n    return state\n`,
      "test/test_index.py": `def test_${behaviorName}():\n    assert ${behaviorName}(1) == 1\n`,
      ".github/workflows/check.yml": "name: test\n",
    };
    const fetchImpl: typeof fetch = async (input) => {
      const url = new URL(String(input));
      if (url.pathname === "/search/repositories") return Response.json({ items: [noise, good] });
      if (url.pathname.includes("/commits/")) return Response.json({ sha: "feedface1234" });
      if (url.pathname.includes("/git/trees/")) return Response.json({ tree: Object.entries(files).map(([path, content], index) => ({ path, type: "blob", sha: `blob-${index}`, size: content.length })) });
      const path = decodeURIComponent(url.pathname.split("/contents/")[1] ?? "");
      if (path in files) return Response.json({ encoding: "base64", content: Buffer.from(files[path]!).toString("base64") });
      throw new Error(`Unexpected mock request: ${url.pathname}`);
    };
    const config = structuredClone(defaultConfig);
    config.slicing.maxRepositories = 1;
    const pack = await prepareReferencePack(new GitHubClient({ fetchImpl, apiBase: "https://mock.github" }), task, config);
    assert.deepEqual(pack.selection!.selectedRepositories, [good.full_name], JSON.stringify(pack.assessments.map((item) => ({ repository: item.repository.fullName, reasons: item.rejectionReasons }))));
    assert.ok(pack.slices.every((slice) => slice.commitish === "feedface1234" && slice.license === license));
    assert.match(pack.assessments.find((item) => item.repository.fullName === good.full_name)!.licenseWarnings!.join(" "), /learning-only/);
    const slice = pack.slices.find((item) => item.path === "src/index.py")!;
    assert.ok(slice);
    const bundle = pack.bundles.find((item) => item.evidenceSliceIds.includes(slice.id))!;
    assert.ok(bundle);
    const gate = applyReviewGate(pack, {
      schemaVersion: 1, referencePackFingerprint: fingerprintReferencePack(pack), reviewer: "offline-test",
      decisions: [{
        repository: good.full_name, verdict: "adapt", confidence: 0.9, riskLevel: "low",
        summary: "The peer provides source-backed product behavior, not only shared packaging.",
        transferablePatterns: ["Preserve the product responsibility behind a narrow local API."],
        mismatches: ["Use local language and API conventions."], risks: [],
        evidenceBundleIds: [bundle.id], evidenceSliceIds: [slice.id],
        domainFit: { relation: "same-domain", rationale: `Both implement ${task.domain!.purpose.name}; the cited source exposes ${behaviorName}.`, evidenceSliceIds: [slice.id] },
      }],
    }, config);
    assert.equal(gate.results[0]!.approved, true, JSON.stringify(gate.results));
  });
});

const repository = {
  full_name: "example/coding-agent-harness",
  html_url: "https://github.com/example/coding-agent-harness",
  description: "A coding agent harness with extension architecture",
  stargazers_count: 5000,
  forks_count: 400,
  open_issues_count: 12,
  size: 10000,
  archived: false,
  fork: false,
  default_branch: "main",
  pushed_at: "2026-08-20T00:00:00Z",
  created_at: "2023-01-01T00:00:00Z",
  license: { spdx_id: "MIT" },
  language: "TypeScript",
  topics: ["coding-agent", "agent-harness"],
};

test("runs search, assessment and commit-pinned slicing through a mocked GitHub API", async () => {
  const calls: string[] = [];
  const fetchImpl = async (input: string | URL | Request): Promise<Response> => {
    const url = String(input);
    calls.push(url);
    if (url.includes("/search/repositories")) return Response.json({ items: [repository] });
    if (url.includes("/commits/main")) return Response.json({ sha: "deadbeef1234" });
    if (url.includes("/git/trees/deadbeef1234")) return Response.json({
      sha: "tree1234",
      tree: [
        { path: "README.md", type: "blob", sha: "1", size: 1200 },
        { path: "docs/architecture.md", type: "blob", sha: "2", size: 1200 },
        { path: "src/extension-registry.ts", type: "blob", sha: "3", size: 1200 },
        { path: "test/extension.test.ts", type: "blob", sha: "4", size: 1200 },
        { path: ".github/workflows/check.yml", type: "blob", sha: "5", size: 1200 },
        { path: "CONTRIBUTING.md", type: "blob", sha: "6", size: 1200 },
        { path: "package.json", type: "blob", sha: "7", size: 1200 },
        { path: "tsconfig.json", type: "blob", sha: "8", size: 1200 },
      ],
    });
    if (url.includes("/contents/")) return Response.json({
      encoding: "base64",
      content: Buffer.from("export interface ExtensionRegistry { register(name: string): void }\n").toString("base64"),
    });
    return new Response("not found", { status: 404 });
  };
  const client = new GitHubClient({ fetchImpl: fetchImpl as typeof fetch, apiBase: "https://mock.github" });
  const config = structuredClone(defaultConfig);
  config.github.inspectLimit = 1;
  config.slicing.maxFilesPerRepository = 4;
  const pack = await prepareReferencePack(client, {
    task: "coding agent harness extension architecture",
    queries: ["coding agent harness"],
    language: "TypeScript",
  }, config);
  assert.equal(pack.assessments.length, 1);
  assert.equal(pack.assessments[0]!.accepted, true);
  assert.equal(pack.schemaVersion, 4);
  assert.equal(pack.atlases.length, 1);
  assert.equal(pack.atlases[0]!.coverage.sufficient, true);
  assert.ok(pack.atlases[0]!.coverage.signals.some((signal) => signal.name === "design-evidence"));
  assert.ok(pack.bundles.length >= 1);
  assert.equal(pack.slices.length, 4);
  assert.ok(pack.slices.every((slice) => slice.commitish === "deadbeef1234"));
  assert.ok(calls.some((url) => url.includes("ref=deadbeef1234")));
  const contentCalls = calls.filter((url) => url.includes("/contents/"));
  assert.equal(contentCalls.length, new Set(contentCalls).size, "Atlas and slicer should share remote file reads");
});

test("fails closed when indexed source and test files cannot become readable evidence", async () => {
  const fetchImpl = async (input: string | URL | Request): Promise<Response> => {
    const url = String(input);
    if (url.includes("/search/repositories")) return Response.json({ items: [repository] });
    if (url.includes("/commits/main")) return Response.json({ sha: "limited-commit" });
    if (url.includes("/git/trees/limited-commit")) return Response.json({ tree: [
      { path: "README.md", type: "blob", sha: "1", size: 200 },
      { path: "package.json", type: "blob", sha: "2", size: 200 },
      { path: "src/index.ts", type: "blob", sha: "3", size: 200 },
      { path: "test/index.test.ts", type: "blob", sha: "4", size: 200 },
      { path: ".github/workflows/check.yml", type: "blob", sha: "5", size: 200 },
    ] });
    if (url.includes("/contents/src/") || url.includes("/contents/test/")) {
      return new Response("rate limited", { status: 403, headers: { "x-ratelimit-remaining": "0" } });
    }
    if (url.includes("/contents/")) return Response.json({
      encoding: "base64", content: Buffer.from("reference documentation\n").toString("base64"),
    });
    return new Response("not found", { status: 404 });
  };
  const config = structuredClone(defaultConfig);
  config.github.inspectLimit = 1;
  config.slicing.maxRepositories = 1;
  config.slicing.maxFilesPerRepository = 4;
  await assert.rejects(
    prepareReferencePack(new GitHubClient({ fetchImpl: fetchImpl as typeof fetch, apiBase: "https://mock.github" }), {
      task: "coding agent harness extension architecture", queries: ["coding agent harness"], language: "TypeScript",
    }, config),
    /missing required implementation, test evidence slices.*rate limit exhausted/,
  );
});

test("does not report an empty learning set when every discovered profile request failed", async () => {
  const fetchImpl = async (input: string | URL | Request): Promise<Response> => {
    const url = String(input);
    if (url.includes("/search/repositories")) return Response.json({ items: [repository] });
    if (url.includes("/commits/main")) return new Response("rate limited", {
      status: 403, headers: { "x-ratelimit-remaining": "0" },
    });
    return new Response("not found", { status: 404 });
  };
  const config = structuredClone(defaultConfig);
  config.github.inspectLimit = 1;
  config.slicing.maxRepositories = 1;
  await assert.rejects(
    prepareReferencePack(new GitHubClient({ fetchImpl: fetchImpl as typeof fetch, apiBase: "https://mock.github" }), {
      task: "coding agent harness extension architecture", queries: ["coding agent harness"], language: "TypeScript",
    }, config),
    /Automatic discovery could not complete candidate profiling.*rate limit exhausted/,
  );
});

test("stops profiling and atlas construction after the bounded learning set is full", async () => {
  const second = { ...repository, full_name: "example/second-agent", html_url: "https://github.com/example/second-agent", stargazers_count: 4000 };
  const calls: string[] = [];
  const fetchImpl = async (input: string | URL | Request): Promise<Response> => {
    const url = String(input);
    calls.push(url);
    if (url.includes("/search/repositories")) return Response.json({ items: [repository, second] });
    if (url.includes("/repos/example/second-agent/")) throw new Error("second candidate must not be profiled");
    if (url.includes("/commits/main")) return Response.json({ sha: "bounded-commit" });
    if (url.includes("/git/trees/bounded-commit")) return Response.json({ tree: [
      { path: "README.md", type: "blob", sha: "1", size: 200 },
      { path: "docs/architecture.md", type: "blob", sha: "2", size: 200 },
      { path: "package.json", type: "blob", sha: "3", size: 200 },
      { path: "src/index.ts", type: "blob", sha: "4", size: 200 },
      { path: "test/index.test.ts", type: "blob", sha: "5", size: 200 },
      { path: ".github/workflows/check.yml", type: "blob", sha: "6", size: 200 },
    ] });
    if (url.includes("/contents/")) return Response.json({ encoding: "base64", content: Buffer.from("export const agent = true;\n").toString("base64") });
    return new Response("not found", { status: 404 });
  };
  const config = structuredClone(defaultConfig);
  config.slicing.maxRepositories = 1;
  config.slicing.maxFilesPerRepository = 4;
  config.atlas.maxFiles = 2;
  const pack = await prepareReferencePack(new GitHubClient({ fetchImpl: fetchImpl as typeof fetch, apiBase: "https://mock.github" }), {
    task: "coding agent harness extension architecture", queries: ["coding agent harness"], language: "TypeScript",
  }, config);
  assert.deepEqual(pack.selection?.selectedRepositories, ["example/coding-agent-harness"]);
  assert.equal(pack.atlases.length, 1);
  assert.ok(!calls.some((url) => url.includes("/repos/example/second-agent/")));
});

test("keeps rejected candidate scores for audit but removes their atlases from the learning space", async () => {
  const weak = {
    ...repository,
    full_name: "example/no-source-agent",
    html_url: "https://github.com/example/no-source-agent",
    stargazers_count: 9000,
  };
  const strongTree = [
    { path: "README.md", type: "blob", sha: "1", size: 200 },
    { path: "package.json", type: "blob", sha: "2", size: 200 },
    { path: "src/index.ts", type: "blob", sha: "3", size: 200 },
    { path: "test/index.test.ts", type: "blob", sha: "4", size: 200 },
    { path: ".github/workflows/check.yml", type: "blob", sha: "5", size: 200 },
  ];
  const fetchImpl = async (input: string | URL | Request): Promise<Response> => {
    const url = String(input);
    if (url.includes("/search/repositories")) return Response.json({ items: [weak, repository] });
    if (url.includes("/repos/example/no-source-agent/commits/main")) return Response.json({ sha: "weak-commit" });
    if (url.includes("/repos/example/coding-agent-harness/commits/main")) return Response.json({ sha: "strong-commit" });
    if (url.includes("/git/trees/weak-commit")) return Response.json({ tree: strongTree.filter((entry) => !entry.path.startsWith("src/")) });
    if (url.includes("/git/trees/strong-commit")) return Response.json({ tree: strongTree });
    if (url.includes("/contents/")) return Response.json({
      encoding: "base64", content: Buffer.from("export const extensionAgent = true;\n").toString("base64"),
    });
    return new Response("not found", { status: 404 });
  };
  const config = structuredClone(defaultConfig);
  config.github.inspectLimit = 2;
  config.slicing.maxRepositories = 1;
  config.slicing.maxFilesPerRepository = 4;
  const pack = await prepareReferencePack(new GitHubClient({ fetchImpl: fetchImpl as typeof fetch, apiBase: "https://mock.github" }), {
    task: "coding agent harness extension architecture", queries: ["coding agent harness"], language: "TypeScript",
  }, config);
  assert.equal(pack.assessments.find((item) => item.repository.fullName === weak.full_name)?.accepted, false);
  assert.deepEqual(pack.atlases.map((atlas) => atlas.repository), [repository.full_name]);
  assert.deepEqual(pack.selection?.selectedRepositories, [repository.full_name]);
});

test("prioritizes an accepted user-specified repository and skips automatic search when the learning set is full", async () => {
  const calls: string[] = [];
  const fetchImpl = async (input: string | URL | Request): Promise<Response> => {
    const url = String(input);
    calls.push(url);
    if (url.includes("/commits/release-v1")) return Response.json({ sha: "pinned-commit" });
    if (url.includes("/git/trees/pinned-commit")) return Response.json({ sha: "tree", tree: [
      { path: "README.md", type: "blob", sha: "1", size: 1200 },
      { path: "docs/architecture.md", type: "blob", sha: "2", size: 1200 },
      { path: "src/extension-registry.ts", type: "blob", sha: "3", size: 1200 },
      { path: "test/extension.test.ts", type: "blob", sha: "4", size: 1200 },
      { path: ".github/workflows/check.yml", type: "blob", sha: "5", size: 1200 },
      { path: "CONTRIBUTING.md", type: "blob", sha: "6", size: 1200 },
      { path: "package.json", type: "blob", sha: "7", size: 1200 },
      { path: "tsconfig.json", type: "blob", sha: "8", size: 1200 },
    ] });
    if (url.endsWith("/repos/example/coding-agent-harness")) return Response.json(repository);
    if (url.includes("/contents/")) return Response.json({ encoding: "base64", content: Buffer.from("export interface ExtensionRegistry {}\n").toString("base64") });
    if (url.includes("/search/repositories")) throw new Error("automatic search should not run");
    return new Response("not found", { status: 404 });
  };
  const client = new GitHubClient({ fetchImpl: fetchImpl as typeof fetch, apiBase: "https://mock.github" });
  const config = structuredClone(defaultConfig);
  config.slicing.maxRepositories = 1;
  config.slicing.maxFilesPerRepository = 4;
  const pack = await prepareReferencePack(client, {
    task: "coding agent harness extension architecture",
    language: "TypeScript",
    referenceRepositories: [{ repository: "https://github.com/example/coding-agent-harness", revision: "release-v1" }],
  }, config);
  assert.equal(pack.selection?.automaticSearchUsed, false);
  assert.equal(pack.selection?.specified[0]!.status, "accepted");
  assert.equal(pack.atlases[0]!.repository, "example/coding-agent-harness");
  assert.deepEqual(pack.selection?.selectedRepositories, ["example/coding-agent-harness"]);
  assert.equal(pack.assessments[0]!.selectionOrigin, "user-specified");
  assert.ok(pack.slices.every((slice) => slice.commitish === "pinned-commit"));
  assert.ok(!calls.some((url) => url.includes("/search/repositories")));
});

test("reports a rejected specified repository and falls back to automatic discovery", async () => {
  const unsuitable = {
    ...repository,
    full_name: "example/photo-gallery",
    html_url: "https://github.com/example/photo-gallery",
    description: "A browser photo gallery and image viewer",
    topics: ["photos", "gallery"],
  };
  const tree = [
    { path: "README.md", type: "blob", sha: "1", size: 1200 },
    { path: "docs/architecture.md", type: "blob", sha: "2", size: 1200 },
    { path: "src/extension-registry.ts", type: "blob", sha: "3", size: 1200 },
    { path: "test/extension.test.ts", type: "blob", sha: "4", size: 1200 },
    { path: ".github/workflows/check.yml", type: "blob", sha: "5", size: 1200 },
    { path: "CONTRIBUTING.md", type: "blob", sha: "6", size: 1200 },
    { path: "package.json", type: "blob", sha: "7", size: 1200 },
    { path: "tsconfig.json", type: "blob", sha: "8", size: 1200 },
  ];
  const fetchImpl = async (input: string | URL | Request): Promise<Response> => {
    const url = String(input);
    if (url.includes("/search/repositories")) return Response.json({ items: [repository] });
    if (url.includes("/repos/example/photo-gallery/commits/main")) return Response.json({ sha: "photo-commit" });
    if (url.includes("/repos/example/coding-agent-harness/commits/main")) return Response.json({ sha: "agent-commit" });
    if (url.includes("/git/trees/photo-commit") || url.includes("/git/trees/agent-commit")) return Response.json({ sha: "tree", tree });
    if (url.endsWith("/repos/example/photo-gallery")) return Response.json(unsuitable);
    if (url.includes("/contents/")) return Response.json({ encoding: "base64", content: Buffer.from("export interface ExtensionRegistry {}\n").toString("base64") });
    return new Response("not found", { status: 404 });
  };
  const client = new GitHubClient({ fetchImpl: fetchImpl as typeof fetch, apiBase: "https://mock.github" });
  const config = structuredClone(defaultConfig);
  config.slicing.maxRepositories = 1;
  config.slicing.maxFilesPerRepository = 4;
  const pack = await prepareReferencePack(client, {
    task: "coding agent harness extension architecture",
    queries: ["coding agent harness"],
    language: "TypeScript",
    referenceRepositories: [{ repository: "example/photo-gallery" }],
  }, config);
  assert.equal(pack.selection?.specified[0]!.status, "rejected");
  assert.equal(pack.selection?.automaticSearchUsed, true);
  assert.deepEqual(pack.selection?.selectedRepositories, ["example/coding-agent-harness"]);
  assert.equal(pack.assessments.find((item) => item.repository.fullName === "example/coding-agent-harness")?.selectionOrigin, "automatic");
});
