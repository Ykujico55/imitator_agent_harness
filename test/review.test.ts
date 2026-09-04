import assert from "node:assert/strict";
import test from "node:test";
import { defaultConfig } from "../src/config.ts";
import {
  applyReviewGate,
  buildReviewRequest,
  buildReviewTemplate,
  fingerprintReferencePack,
  parseReviewSubmission,
} from "../src/review.ts";
import { assessRepository } from "../src/score.ts";
import type { EvidenceSlice, ReferencePack, ReviewSubmission } from "../src/types.ts";
import { codingAgentTask, matureAtlas, matureBundle, matureRepository } from "./helpers.ts";
import { cacheTask, calendarTask, parserTask, queueTask } from "./domain-fixtures.ts";
import { renderReference, renderAgentContext } from "../src/render.ts";

function packFixture(): ReferencePack {
  const repository = matureRepository();
  const assessment = assessRepository(repository, { task: "coding agent harness extensions" }, defaultConfig, new Date("2026-09-01T00:00:00Z"));
  const slice = (id: string, path: string): EvidenceSlice => ({
    id,
    repository: repository.fullName,
    repositoryUrl: repository.htmlUrl,
    license: repository.license,
    commitish: repository.resolvedRevision,
    path,
    startLine: 1,
    endLine: 2,
    sourceUrl: `${repository.htmlUrl}/blob/${repository.resolvedRevision}/${path}#L1-L2`,
    relevance: 50,
    reason: "test evidence",
    content: "export interface ExtensionRegistry { registerTool(name: string): void }",
  });
  return {
    schemaVersion: 4,
    generatedAt: "2026-09-01T00:00:00.000Z",
    task: codingAgentTask("coding agent harness extensions"),
    queries: ["coding agent harness"],
    assessments: [assessment],
    atlases: [matureAtlas(repository)],
    slices: [slice("slice-a", "docs/architecture.md"), slice("slice-b", "src/extensions.ts")],
    bundles: [matureBundle(repository)],
    practices: ["unreviewed practice"],
  };
}

function approvedSubmission(pack: ReferencePack): ReviewSubmission {
  return {
    schemaVersion: 1,
    referencePackFingerprint: fingerprintReferencePack(pack),
    reviewer: "test-reviewer",
    decisions: [{
      repository: "example/coding-agent",
      verdict: "adapt",
      confidence: 0.9,
      riskLevel: "medium",
      summary: "The registry boundary fits after adapting the lifecycle model.",
      transferablePatterns: ["Separate extension registration from execution."],
      mismatches: ["Upstream lifecycle names differ."],
      risks: ["Avoid copying provider-specific types."],
      evidenceBundleIds: ["bundle-architecture"],
      evidenceSliceIds: ["slice-b"],
      domainFit: { relation: "same-domain", rationale: "Both systems register and dispatch coding-agent tools behind a registry boundary.", evidenceSliceIds: ["slice-b"] },
    }],
  };
}

test("license warnings survive review and reports; strict policy is rechecked against earlier acceptance", () => {
  for (const license of [null, "GPL-3.0"]) {
    const pack = packFixture();
    const repo = { ...pack.assessments[0]!.repository, license };
    pack.assessments[0] = assessRepository(repo, pack.task, defaultConfig, new Date("2026-09-01"));
    pack.slices.forEach((slice) => { slice.license = license; });
    assert.ok(buildReviewRequest(pack).candidates[0]!.licenseWarnings.length);
    const submission = approvedSubmission(pack);
    const result = applyReviewGate(pack, submission, defaultConfig);
    assert.equal(result.results[0]!.approved, true);
    assert.ok(result.approvedPack.slices.every((slice) => slice.license === license));
    assert.match(renderReference(result.approvedPack), /License and use restrictions/);
    assert.match(renderReference(result.approvedPack), license ? /license-not-allowlisted/ : /license-unknown/);
    assert.match(renderAgentContext(result.approvedPack), /does not authorize copying/);
    const strict = structuredClone(defaultConfig);
    strict.acceptance.licensePolicy = "allowlist";
    const rechecked = applyReviewGate(pack, submission, strict);
    assert.equal(rechecked.results[0]!.approved, false);
    assert.deepEqual(rechecked.results[0]!.reasons, ["license-policy: license is not allowlisted"]);
    submission.decisions[0]!.riskLevel = "high";
    assert.equal(applyReviewGate(pack, submission, defaultConfig).results[0]!.approved, false, "concrete review risks still block");
  }
});

test("same review rule accepts task-specific behavioral evidence across domains and languages", () => {
  for (const [task, content, path] of [
    [cacheTask, "def evict(self): return self.entries.popitem(last=False)", "src/cache.py"],
    [queueTask, "pub fn acknowledge(job: Job) { job.complete(); }", "src/queue.rs"],
    [parserTask, "export function parse(text) { return tree(text); }", "src/parser.js"],
    [calendarTask, "func TestRecurrence(t *testing.T) { checkOccurrences(t) }", "tests/calendar_test.go"],
  ] as const) {
    const pack = packFixture();
    pack.task = structuredClone(task);
    const repo = pack.assessments[0]!.repository;
    repo.description = `${task.domain!.purpose.name} implementation`;
    repo.topics = [];
    pack.assessments[0] = assessRepository(repo, task, defaultConfig, new Date("2026-09-01"));
    pack.slices[1]!.path = path;
    pack.slices[1]!.content = content;
    const submission = approvedSubmission(pack);
    submission.decisions[0]!.domainFit!.rationale = `The ${task.domain!.purpose.name} shares product responsibilities and the cited code implements a required behavior.`;
    assert.equal(applyReviewGate(pack, submission, defaultConfig).results[0]!.approved, true, task.task);
  }
});

test("legacy accepted flags and maximum confidence cannot authorize unrelated references", () => {
  for (const fullName of ["radashi-org/radashi", "davidjerleke/embla-carousel", "tsndr/cloudflare-worker-jwt", "privy-io/shamir-secret-sharing"]) {
    const pack = packFixture();
    pack.task = structuredClone(cacheTask);
    pack.assessments[0]!.repository.fullName = fullName;
    pack.assessments[0]!.repository.description = "zero-dependency TypeScript ESM library";
    pack.assessments[0]!.repository.topics = ["typescript", "zero-dependency"];
    pack.slices.forEach((slice) => { slice.repository = fullName; slice.content = "export function evict() {}"; });
    pack.bundles.forEach((bundle) => { bundle.repository = fullName; });
    for (const confidence of [0.4, 0.7, 1]) {
      const submission = approvedSubmission(pack);
      submission.decisions[0]!.repository = fullName;
      submission.decisions[0]!.confidence = confidence;
      const result = applyReviewGate(pack, submission, defaultConfig);
      assert.equal(result.results[0]!.approved, false, fullName);
      assert.match(result.results[0]!.reasons.join(" "), /review-domain-mismatch/);
    }
  }
});

test("generic code, README claims, manifests and product-name-only code cannot prove behavior", () => {
  for (const [path, content] of [
    ["src/index.ts", "export const sideEffects = false"],
    ["README.md", "This coding agent implements a registry"],
    ["package.json", '{"name":"coding-agent-registry","dependencies":{}}'],
    ["src/index.ts", "export class CodingAgent {}"],
  ]) {
    const pack = packFixture();
    pack.slices[1]!.path = path!;
    pack.slices[1]!.content = content!;
    const submission = approvedSubmission(pack);
    submission.decisions[0]!.confidence = 1;
    const result = applyReviewGate(pack, submission, defaultConfig);
    assert.equal(result.results[0]!.approved, false, path);
    assert.match(result.results[0]!.reasons.join(" "), /review-domain-behavior-missing/);
  }
});

test("domain relationship, task profile, rationale and inspected evidence are independent requirements", () => {
  const pack = packFixture();
  for (const relation of ["adjacent-domain", "unrelated", "unknown"] as const) {
    const submission = approvedSubmission(pack);
    submission.decisions[0]!.domainFit!.relation = relation;
    assert.match(applyReviewGate(pack, submission, defaultConfig).results[0]!.reasons.join(" "), /review-domain-relation/);
  }
  const missing = approvedSubmission(pack);
  delete missing.decisions[0]!.domainFit;
  assert.match(applyReviewGate(pack, missing, defaultConfig).results[0]!.reasons.join(" "), /review-domain-fit-missing/);
  const unbound = approvedSubmission(pack);
  unbound.decisions[0]!.domainFit!.evidenceSliceIds = ["slice-a", "forged"];
  unbound.decisions[0]!.domainFit!.rationale = "fits";
  const reasons = applyReviewGate(pack, unbound, defaultConfig).results[0]!.reasons.join(" ");
  assert.match(reasons, /review-domain-evidence-unbound/);
  assert.match(reasons, /review-domain-rationale/);
  const malformed = approvedSubmission(pack);
  const raw = JSON.parse(JSON.stringify(malformed));
  raw.decisions[0].domainFit.relation = "";
  assert.throws(() => parseReviewSubmission(raw), /relation is invalid/);
  delete pack.task.domain;
  assert.match(applyReviewGate(pack, approvedSubmission(pack), defaultConfig).results[0]!.reasons.join(" "), /review-domain-profile-required/);
});

test("builds a pack-bound request and fail-closed pending template", () => {
  const pack = packFixture();
  const request = buildReviewRequest(pack);
  const template = buildReviewTemplate(request);
  assert.equal(request.referencePackFingerprint, fingerprintReferencePack(pack));
  assert.equal(request.candidates.length, 1);
  assert.equal(request.candidates[0]!.atlas.coverage.score, 90);
  assert.equal(request.candidates[0]!.bundles[0]!.id, "bundle-architecture");
  assert.deepEqual(request.candidates[0]!.slices.map((slice) => slice.id), ["slice-a", "slice-b"]);
  assert.equal(template.decisions[0]!.verdict, "pending");
  const result = applyReviewGate(pack, template, defaultConfig);
  assert.equal(result.results[0]!.approved, false);
  assert.deepEqual(result.approvedPack.slices, []);
});

test("approves explicitly cited bundles and reviewed patterns", () => {
  const pack = packFixture();
  const submission = approvedSubmission(pack);
  const result = applyReviewGate(pack, submission, defaultConfig);
  assert.equal(result.results[0]!.approved, true);
  assert.deepEqual(result.approvedPack.slices.map((slice) => slice.id), ["slice-a", "slice-b"]);
  assert.deepEqual(result.approvedPack.practices, ["Separate extension registration from execution."]);
  assert.ok(!result.approvedPack.practices.includes("unreviewed practice"));
});

test("rejects low-confidence or high-risk reviews without trusting prose", () => {
  const pack = packFixture();
  const submission = approvedSubmission(pack);
  submission.decisions[0]!.confidence = 0.4;
  submission.decisions[0]!.riskLevel = "high";
  const result = applyReviewGate(pack, submission, defaultConfig);
  assert.equal(result.results[0]!.approved, false);
  assert.match(result.results[0]!.reasons.join(" "), /Confidence/);
  assert.match(result.results[0]!.reasons.join(" "), /risk high/);
});

test("adapt decisions must explain summary, mismatch, risk, pattern, and evidence", () => {
  const pack = packFixture();
  const submission = approvedSubmission(pack);
  const decision = submission.decisions[0]!;
  decision.summary = "";
  decision.mismatches = [];
  decision.risks = [];
  decision.transferablePatterns = [];
  decision.evidenceSliceIds = [];
  decision.evidenceBundleIds = [];
  const result = applyReviewGate(pack, submission, defaultConfig);
  assert.equal(result.results[0]!.approved, false);
  const reasons = result.results[0]!.reasons.join(" ");
  assert.match(reasons, /summary/);
  assert.match(reasons, /mismatch/);
  assert.match(reasons, /stated risk/);
  assert.match(reasons, /transferable pattern/);
  assert.match(reasons, /Evidence slices/);
  assert.match(reasons, /evidence bundle/);
});

test("rejects forged bundles and slices outside cited relationship bundles", () => {
  const pack = packFixture();
  const forged = approvedSubmission(pack);
  forged.decisions[0]!.evidenceBundleIds = ["forged-bundle"];
  assert.throws(() => applyReviewGate(pack, forged, defaultConfig), /Unknown evidence bundle ID/);

  pack.bundles[0]!.evidenceSliceIds = ["slice-a"];
  const outside = approvedSubmission(pack);
  assert.throws(() => applyReviewGate(pack, outside, defaultConfig), /outside the cited bundles/);
});

test("rejects modified packs, forged evidence IDs, and malformed structured output", () => {
  const pack = packFixture();
  const wrongPack = structuredClone(pack);
  wrongPack.generatedAt = "2026-09-02T00:00:00.000Z";
  assert.throws(() => applyReviewGate(wrongPack, approvedSubmission(pack), defaultConfig), /different or modified/);
  const changedSelection = structuredClone(pack);
  changedSelection.selection = {
    schemaVersion: 1,
    maximumLearningRepositories: 2,
    automaticSearchUsed: false,
    specified: [{ repository: "example/coding-agent", status: "accepted", resolvedRevision: "abc123def456", reasons: ["passed"] }],
    selectedRepositories: ["example/coding-agent"],
  };
  assert.notEqual(fingerprintReferencePack(changedSelection), fingerprintReferencePack(pack));
  const forged = approvedSubmission(pack);
  forged.decisions[0]!.evidenceSliceIds = ["does-not-exist"];
  assert.throws(() => applyReviewGate(pack, forged, defaultConfig), /Unknown evidence slice ID/);
  assert.throws(() => parseReviewSubmission({ schemaVersion: 1, referencePackFingerprint: "x", reviewer: "x", decisions: [{ confidence: 2 }] }), /verdict must be a string/);
});

test("exposes and approves no more than two coherent learning repositories", () => {
  const pack = packFixture();
  const baseAssessment = pack.assessments[0]!;
  const baseAtlas = pack.atlases[0]!;
  const baseSlice = pack.slices[0]!;
  const baseBundle = pack.bundles[0]!;
  pack.assessments = ["example/one", "example/two", "example/three"].map((fullName) => ({
    ...structuredClone(baseAssessment),
    repository: { ...structuredClone(baseAssessment.repository), fullName, htmlUrl: `https://github.com/${fullName}` },
  }));
  pack.slices = pack.assessments.map((assessment, index) => ({
    ...structuredClone(baseSlice),
    id: `slice-${index + 1}`,
    repository: assessment.repository.fullName,
    repositoryUrl: assessment.repository.htmlUrl,
  }));
  pack.atlases = pack.assessments.map((assessment) => ({
    ...structuredClone(baseAtlas),
    repository: assessment.repository.fullName,
    repositoryUrl: assessment.repository.htmlUrl,
  }));
  pack.bundles = pack.assessments.map((assessment, index) => ({
    ...structuredClone(baseBundle),
    id: `bundle-${index + 1}`,
    repository: assessment.repository.fullName,
    evidenceSliceIds: [`slice-${index + 1}`],
  }));
  assert.equal(buildReviewRequest(pack).candidates.length, 2);
  const decisions = pack.assessments.map((assessment, index) => ({
    ...approvedSubmission(pack).decisions[0]!,
    repository: assessment.repository.fullName,
    evidenceBundleIds: [`bundle-${index + 1}`],
    evidenceSliceIds: [`slice-${index + 1}`],
  }));
  assert.throws(() => applyReviewGate(pack, {
    schemaVersion: 1,
    referencePackFingerprint: fingerprintReferencePack(pack),
    reviewer: "reviewer",
    decisions,
  }, defaultConfig), /unaccepted or unknown repository: example\/three/);
});
