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
import { matureRepository } from "./helpers.ts";

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
    content: "export interface Extension {}",
  });
  return {
    schemaVersion: 2,
    generatedAt: "2026-09-01T00:00:00.000Z",
    task: { task: "coding agent harness extensions" },
    queries: ["coding agent harness"],
    assessments: [assessment],
    slices: [slice("slice-a", "docs/architecture.md"), slice("slice-b", "src/extensions.ts")],
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
      evidenceSliceIds: ["slice-b"],
    }],
  };
}

test("builds a pack-bound request and fail-closed pending template", () => {
  const pack = packFixture();
  const request = buildReviewRequest(pack);
  const template = buildReviewTemplate(request);
  assert.equal(request.referencePackFingerprint, fingerprintReferencePack(pack));
  assert.equal(request.candidates.length, 1);
  assert.deepEqual(request.candidates[0]!.slices.map((slice) => slice.id), ["slice-a", "slice-b"]);
  assert.equal(template.decisions[0]!.verdict, "pending");
  const result = applyReviewGate(pack, template, defaultConfig);
  assert.equal(result.results[0]!.approved, false);
  assert.deepEqual(result.approvedPack.slices, []);
});

test("approves only explicitly cited evidence and reviewed patterns", () => {
  const pack = packFixture();
  const submission = approvedSubmission(pack);
  const result = applyReviewGate(pack, submission, defaultConfig);
  assert.equal(result.results[0]!.approved, true);
  assert.deepEqual(result.approvedPack.slices.map((slice) => slice.id), ["slice-b"]);
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
  const result = applyReviewGate(pack, submission, defaultConfig);
  assert.equal(result.results[0]!.approved, false);
  const reasons = result.results[0]!.reasons.join(" ");
  assert.match(reasons, /summary/);
  assert.match(reasons, /mismatch/);
  assert.match(reasons, /stated risk/);
  assert.match(reasons, /transferable pattern/);
  assert.match(reasons, /Evidence slices/);
});

test("rejects modified packs, forged evidence IDs, and malformed structured output", () => {
  const pack = packFixture();
  const wrongPack = structuredClone(pack);
  wrongPack.generatedAt = "2026-09-02T00:00:00.000Z";
  assert.throws(() => applyReviewGate(wrongPack, approvedSubmission(pack), defaultConfig), /different or modified/);
  const forged = approvedSubmission(pack);
  forged.decisions[0]!.evidenceSliceIds = ["does-not-exist"];
  assert.throws(() => applyReviewGate(pack, forged, defaultConfig), /Unknown evidence slice ID/);
  assert.throws(() => parseReviewSubmission({ schemaVersion: 1, referencePackFingerprint: "x", reviewer: "x", decisions: [{ confidence: 2 }] }), /verdict must be a string/);
});
