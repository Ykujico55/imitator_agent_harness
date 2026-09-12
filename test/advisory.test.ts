import assert from "node:assert/strict";
import test from "node:test";
import { assessAdvisoryBenefit, buildAdvisoryTaskSpec, compileAdvisoryBrief } from "../src/advisory.ts";
import type { EvidenceSlice, ReferencePack } from "../src/types.ts";
import { matureAtlas, matureBundle, matureRepository } from "./helpers.ts";

function pack(options: { useful: boolean }): ReferencePack {
  const repository = matureRepository();
  const atlas = matureAtlas(repository);
  atlas.relations = options.useful ? [{
    from: "src/registry.ts", to: "src/executor.ts", kind: "imports",
    evidence: { path: "src/registry.ts", sourceUrl: "https://example.test/registry" },
    resolution: "static-candidate",
  }] : [];
  const slice = (id: string, path: string, evidenceRoles: EvidenceSlice["evidenceRoles"], architectureRoles: EvidenceSlice["architectureRoles"]): EvidenceSlice => ({
    id, repository: repository.fullName, repositoryUrl: repository.htmlUrl, license: repository.license,
    commitish: repository.resolvedRevision, path, startLine: 1, endLine: 3,
    sourceUrl: `${repository.htmlUrl}/blob/${repository.resolvedRevision}/${path}#L1-L3`, relevance: 80,
    reason: "bounded test fixture", content: path.startsWith("src/") ? "export interface Registry { executeHook(): void }" : "test('registry executes hook')", strategy: "typescript-ast",
    symbols: ["Registry"], evidenceRoles, architectureRoles,
    evidenceStrength: { level: options.useful ? "resolved" : "textual", signals: [], limitations: [] },
  });
  const slices = options.useful
    ? [slice("source", "src/registry.ts", ["implementation"], ["contract", "relationship"]), slice("test", "test/registry.test.ts", ["test"], ["test", "failure"])]
    : [slice("readme", "README.md", undefined, undefined)];
  const assessment = {
    repository, accepted: true, rejectionReasons: [], overall: 80,
    dimensions: {
      domainMatch: { score: 80, reasons: ["same core product purpose", "domain-capability-coverage: 2/2; registry, execution"] },
      engineeringMaturity: { score: 80, reasons: [] }, transferability: { score: 80, reasons: [] },
      patternClarity: { score: 80, reasons: [] }, designQuality: { score: 80, reasons: [] }, risk: { score: 10, reasons: [] },
    },
  };
  return {
    schemaVersion: 4, generatedAt: "2026-09-12T00:00:00.000Z", task: {
      task: "Build a coding agent hook registry",
      domain: {
        purpose: { name: "coding agent", aliases: ["agent harness"], taskEvidence: "coding agent" },
        capabilities: [
          { name: "registry", aliases: ["hook registry"], taskEvidence: "registry" },
          { name: "hook execution", aliases: ["execute hook"], taskEvidence: "hook" },
        ],
      },
    },
    queries: ["coding agent hook registry"], assessments: [assessment], atlases: [atlas], slices,
    bundles: [matureBundle(repository, slices.map((item) => item.id))], practices: [],
  };
}

test("advisory task input removes brittle verbatim-evidence authoring", () => {
  const spec = buildAdvisoryTaskSpec({
    task: "请开发本地 Whisper 桌面转写工具。", purpose: "local speech to text desktop app",
    capabilities: ["audio transcription queue", "microphone capture"], queries: ["whisper desktop app"],
  });
  assert.equal(spec.domain?.purpose.taskEvidence, "请开发本地 Whisper 桌面转写工具。");
  assert.deepEqual(spec.domain?.capabilities.map((item) => item.name), ["audio transcription queue", "microphone capture"]);
});

test("advisory benefit requires domain, implementation, test, and mechanism evidence", () => {
  const useful = assessAdvisoryBenefit(pack({ useful: true }));
  assert.equal(useful.decision, "learn");
  assert.deepEqual(useful.selectedRepositories, ["example/coding-agent"]);
  assert.ok(useful.repositories[0]!.signals.some((signal) => signal.name === "resolved-architecture-relationship"));
  assert.equal(useful.repositories[0]!.blockers.length, 0);

  const weak = assessAdvisoryBenefit(pack({ useful: false }));
  assert.equal(weak.decision, "skip");
  assert.ok(weak.repositories[0]!.blockers.some((reason) => /implementation\/test pair/.test(reason)));
  assert.ok(weak.repositories[0]!.blockers.some((reason) => /contract, invariant, failure/.test(reason)));
});

test("advisory benefit rejects a high-scoring reference that covers too little of the task", () => {
  const partial = pack({ useful: true });
  partial.assessments[0]!.dimensions.domainMatch.reasons = [
    "same core product purpose",
    "domain-capability-coverage: 1/4; transcription only",
  ];
  const assessment = assessAdvisoryBenefit(partial);
  assert.equal(assessment.decision, "skip");
  assert.equal(assessment.repositories[0]!.score, 75);
  assert.ok(assessment.repositories[0]!.blockers.some((reason) => /core capability coverage 1\/4 < 50%/.test(reason)));
  assert.ok(!assessment.repositories[0]!.signals.some((signal) => signal.name === "same-core-problem-evidence"));
});

test("advisory benefit requires task capabilities in implementation or test evidence", () => {
  const unrelated = pack({ useful: true });
  for (const slice of unrelated.slices) slice.content = "export interface UnrelatedTransport {}";
  const assessment = assessAdvisoryBenefit(unrelated);
  assert.equal(assessment.decision, "skip");
  assert.ok(assessment.repositories[0]!.blockers.some((reason) => /behavioral capability evidence 0\/2 < 50%/.test(reason)));
  assert.ok(!assessment.repositories[0]!.signals.some((signal) => signal.name === "same-core-problem-evidence"));
});

test("compact advisory brief is bounded, attributed, and excludes remote source bytes", () => {
  const fixture = pack({ useful: true });
  const assessment = assessAdvisoryBenefit(fixture);
  const brief = compileAdvisoryBrief(fixture, assessment);
  assert.match(brief, /compact advisory brief/);
  assert.match(brief, /example\/coding-agent@abc123def456/);
  assert.match(brief, /license: MIT/);
  assert.match(brief, /Builder contract/);
  assert.doesNotMatch(brief, /export interface Registry/);
  assert.ok(brief.length <= 6_000);
});
