import assert from "node:assert/strict";
import test from "node:test";
import { annotateEvidenceStrength, buildAnalysisQualityReport } from "../src/analysis-quality.ts";
import { buildRepositoryDesignAtlas } from "../src/atlas.ts";
import { buildEvidenceBundles } from "../src/bundle.ts";
import { defaultConfig } from "../src/config.ts";
import { hasSourceEvidence, hasTestEvidence } from "../src/coverage-evidence.ts";
import type { GitHubClient } from "../src/github.ts";
import { assessRepository } from "../src/score.ts";
import { collectSlices } from "../src/slice.ts";
import type { EvidenceSlice, RepositoryDesignAtlas } from "../src/types.ts";
import { codingAgentTask, matureAtlas, matureRepository } from "./helpers.ts";

function slice(path: string, strategy: string, role?: "implementation" | "test"): EvidenceSlice {
  const repository = matureRepository();
  return {
    id: path.replace(/\W/g, "-"), repository: repository.fullName, repositoryUrl: repository.htmlUrl,
    license: repository.license, commitish: repository.resolvedRevision, path, startLine: 1, endLine: 4,
    sourceUrl: `${repository.htmlUrl}/blob/${repository.resolvedRevision}/${path}#L1-L4`, relevance: 50,
    reason: "quality fixture", content: role === "test" ? "test('registers', () => assert.ok(true));" : "export interface Registry { register(): void }",
    strategy, ...(role ? { evidenceRoles: [role] } : {}),
  };
}

function semanticAtlas(): RepositoryDesignAtlas {
  const repository = matureRepository();
  const atlas = matureAtlas(repository);
  atlas.relations = [{
    from: "test/extensions.test.ts", to: "src/extensions/tool-registry.ts", kind: "tests",
    evidence: { path: "test/extensions.test.ts", sourceUrl: `${repository.htmlUrl}/blob/${repository.resolvedRevision}/test/extensions.test.ts#L1` },
    resolution: "static-candidate",
  }];
  atlas.sourceAnalyses = [{
    path: "src/extensions/tool-registry.ts", sourceUrl: `${repository.htmlUrl}/blob/${repository.resolvedRevision}/src/extensions/tool-registry.ts`,
    language: "typescript", status: "parsed", parser: "fixture-static", limitations: [], imports: [], symbols: [{
      name: "Registry", kind: "interface", startLine: 1, endLine: 3, signature: "interface Registry", decorators: [], bases: [], raises: [], catches: [], assertionCount: 0, role: "implementation",
    }],
  }];
  return atlas;
}

test("semantic evidence quality uses seven named signals without changing design scoring", () => {
  const atlas = semanticAtlas();
  const annotated = annotateEvidenceStrength([atlas], [
    slice("src/extensions/tool-registry.ts", "typescript-ast", "implementation"),
    slice("test/extensions.test.ts", "typescript-ast", "test"),
    slice("docs/architecture.md", "line-window"),
  ]);
  const report = buildAnalysisQualityReport(atlas, annotated);
  assert.equal(report.score, 100);
  assert.equal(report.calibrationStatus, "observational-only");
  assert.deepEqual(report.signals.map((signal) => [signal.name, signal.points]), [
    ["readable-implementation-evidence", 15],
    ["readable-test-evidence", 15],
    ["syntactic-implementation-evidence", 15],
    ["syntactic-test-evidence", 15],
    ["parsed-declaration-structure", 15],
    ["resolved-static-relationship-evidence", 10],
    ["cross-modal-corroboration-evidence", 15],
  ]);
  assert.equal(annotated.find((item) => item.path.startsWith("src/"))!.evidenceStrength!.level, "corroborated");
  assert.match(report.limitations[0]!, /not repository design merit/);
});

test("text-only languages receive modality observability but no syntax or relation bonus", () => {
  const atlas = matureAtlas();
  const annotated = annotateEvidenceStrength([atlas], [
    slice("src/extensions/tool-registry.ts", "line-window", "implementation"),
    slice("test/extensions.test.ts", "line-window", "test"),
  ]);
  const report = buildAnalysisQualityReport(atlas, annotated);
  assert.equal(report.score, 30);
  assert.deepEqual(report.signals.map((signal) => signal.name), ["readable-implementation-evidence", "readable-test-evidence"]);
  assert.ok(annotated.every((item) => item.evidenceStrength?.level === "textual"));
  assert.equal(report.highestStrength, "textual");
});

test("parser failure preserves conservative textual modality coverage without claiming syntax", () => {
  const unavailablePython = { language: "python" as const, status: "unavailable" as const, parser: "missing", limitations: ["missing"], symbols: [], imports: [] };
  const invalidRust = { language: "rust" as const, status: "invalid" as const, parser: "invalid", limitations: ["invalid"], symbols: [], imports: [] };
  assert.equal(hasSourceEvidence("core.py", "def execute():\n    return 1\n", unavailablePython), true);
  assert.equal(hasTestEvidence("tests/test_core.py", "def test_execute():\n    assert True\n", unavailablePython), true);
  assert.equal(hasTestEvidence("tests/test_core.py", "def test_execute():\n    pass\n", unavailablePython), false);
  assert.equal(hasSourceEvidence("src/lib.rs", "pub struct Cache;\n", invalidRust), true);
  assert.equal(hasTestEvidence("src/lib.rs", "#[test]\nfn evicts() { assert!(true); }\n", invalidRust), true);
  assert.equal(hasTestEvidence("src/lib.rs", "#[test]\nfn placeholder() {}\n", invalidRust), false);
});

test("an unavailable enhanced parser keeps read-backed Atlas coverage but remains textual end to end", async () => {
  const contents: Record<string, string> = {
    "README.md": "coding agent registry",
    "core.py": "def register(tool):\n    return tool\n",
    "tests/test_core.py": "def test_register():\n    assert register('read')\n",
  };
  const repository = matureRepository({ tree: Object.entries(contents).map(([path, content]) => ({ path, type: "blob", sha: path, size: content.length })) });
  const client = { readTextFile: async (_repository: string, path: string) => contents[path]! } as unknown as GitHubClient;
  const unavailable = ({ path }: { path: string; content: string }) => path.endsWith(".py")
    ? { language: "python" as const, status: "unavailable" as const, parser: "missing", limitations: ["trusted parser unavailable"], symbols: [], imports: [] }
    : undefined;
  const task = codingAgentTask();
  const atlas = await buildRepositoryDesignAtlas(client, repository, task, defaultConfig, new Map(), unavailable);
  assert.equal(atlas.coverage.score, 50);
  assert.equal(atlas.coverage.sufficient, true);
  assert.ok(atlas.sourceAnalyses?.every((analysis) => analysis.status === "unavailable"));
  const assessment = assessRepository(repository, task, defaultConfig, new Date("2026-09-08"));
  assessment.accepted = true;
  const collected = await collectSlices(client, [assessment], task, defaultConfig, undefined, [atlas]);
  const annotated = annotateEvidenceStrength([atlas], collected);
  const report = buildAnalysisQualityReport(atlas, annotated);
  assert.equal(report.score, 30);
  assert.ok(annotated.filter((item) => /\.py$/.test(item.path)).every((item) => item.evidenceStrength?.level === "textual"));
  assert.ok(report.files.filter((item) => /\.py$/.test(item.path)).every((item) => item.limitations.some((limit) => /textual/.test(limit))));
});

test("bundle summaries carry strongest, weakest and named slice observations", () => {
  const atlas = semanticAtlas();
  const annotated = annotateEvidenceStrength([atlas], [
    slice("src/extensions/tool-registry.ts", "typescript-ast", "implementation"),
    slice("test/extensions.test.ts", "typescript-ast", "test"),
    slice("docs/architecture.md", "line-window"),
    slice("package.json", "line-window"),
  ]);
  atlas.analysisQuality = buildAnalysisQualityReport(atlas, annotated);
  const bundles = buildEvidenceBundles([atlas], annotated, defaultConfig);
  assert.ok(bundles.length > 0);
  assert.ok(bundles.some((bundle) => bundle.evidenceStrength?.strongest === "corroborated"));
  assert.ok(bundles.some((bundle) => bundle.evidenceStrength?.signals.includes("cross-modal-corroboration")));
});
