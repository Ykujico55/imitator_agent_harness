import assert from "node:assert/strict";
import test from "node:test";
import { applyReviewConfirmation, buildReviewConfirmation, fingerprintReviewSubmission } from "../src/confirmation.ts";
import { defaultConfig } from "../src/config.ts";
import { applyReviewGate, fingerprintReferencePack } from "../src/review.ts";
import { assessRepository } from "../src/score.ts";
import { createTaskIdentity, fingerprintTask, normalizeTaskSpec } from "../src/task.ts";
import type { EvidenceSlice, ReferencePack, ReviewSubmission } from "../src/types.ts";
import { codingAgentTask, matureAtlas, matureBundle, matureRepository } from "./helpers.ts";

function fixture(): { pack: ReferencePack; submission: ReviewSubmission } {
  const repository = matureRepository();
  const assessment = assessRepository(repository, { task: "coding agent hook registry" }, defaultConfig, new Date("2026-09-01T00:00:00Z"));
  const slice: EvidenceSlice = {
    id: "registry-evidence",
    repository: repository.fullName,
    repositoryUrl: repository.htmlUrl,
    license: repository.license,
    commitish: repository.resolvedRevision,
    path: "src/registry.ts",
    startLine: 1,
    endLine: 5,
    sourceUrl: `${repository.htmlUrl}/blob/${repository.resolvedRevision}/src/registry.ts#L1-L5`,
    relevance: 80,
    reason: "registry boundary",
    content: "export interface HookRegistry {}",
  };
  const related: EvidenceSlice = {
    ...slice, id: "registry-test-evidence", path: "test/registry.test.ts", startLine: 1, endLine: 4,
    sourceUrl: `${repository.htmlUrl}/blob/${repository.resolvedRevision}/test/registry.test.ts#L1-L4`,
    reason: "registry contract test", content: "test('registration', () => assert.ok(registry));", evidenceRoles: ["test"],
  };
  const pack: ReferencePack = {
    schemaVersion: 4,
    generatedAt: "2026-09-01T00:00:00.000Z",
    task: codingAgentTask(),
    queries: ["coding agent hook registry"],
    assessments: [assessment],
    atlases: [matureAtlas(repository)],
    slices: [slice, related],
    bundles: [matureBundle(repository, [slice.id, related.id])],
    practices: [],
  };
  const submission: ReviewSubmission = {
    schemaVersion: 1,
    referencePackFingerprint: fingerprintReferencePack(pack),
    reviewer: "coding-agent",
    decisions: [{
      repository: repository.fullName,
      verdict: "adapt",
      confidence: 0.9,
      riskLevel: "medium",
      summary: "The boundary transfers after adapting lifecycle names.",
      transferablePatterns: ["Separate registration from execution."],
      mismatches: ["Lifecycle names differ."],
      risks: ["Do not copy provider types."],
      evidenceBundleIds: ["bundle-architecture"],
      evidenceSliceIds: [slice.id],
      domainFit: { relation: "same-domain", rationale: "The coding-agent hook registry matches our extension lifecycle boundary.", evidenceSliceIds: [slice.id] },
    }],
  };
  return { pack, submission };
}

test("task fingerprints normalize equivalent specifications and bind workspace revision", () => {
  const a = { task: "  Add   registry ", queries: ["hooks", "registry"], language: "TypeScript" };
  const b = { task: "Add registry", queries: ["registry", "hooks"], language: "typescript" };
  assert.deepEqual(normalizeTaskSpec(a), normalizeTaskSpec(b));
  assert.equal(fingerprintTask(a, "C:\\Work\\Repo", "abc"), fingerprintTask(b, "c:/work/repo/", "abc"));
  assert.notEqual(fingerprintTask(a, "C:\\Work\\Repo", "abc"), fingerprintTask(a, "C:\\Work\\Repo", "def"));
});

test("independent confirmation binds task, pack, review, identity, and repositories", () => {
  const { pack, submission } = fixture();
  const task = createTaskIdentity(pack.task, "C:/work/repo", "abc");
  const provisional = applyReviewGate(pack, submission, defaultConfig);
  const repository = submission.decisions[0]!.repository;
  const confirmation = buildReviewConfirmation(pack, task.fingerprint, submission, "human-reviewer", "human", [repository], "2026-09-02T00:00:00.000Z");
  assert.equal(confirmation.reviewFingerprint, fingerprintReviewSubmission(submission));
  const final = applyReviewConfirmation(pack, task.fingerprint, submission, provisional, confirmation, defaultConfig);
  assert.equal(final.approvedPack.assessments.length, 1);
  assert.deepEqual(final.approvedPack.slices.map((slice) => slice.id), ["registry-evidence", "registry-test-evidence"]);
  assert.deepEqual(final.approvedPack.bundles[0]!.evidenceSliceIds, ["registry-evidence", "registry-test-evidence"]);
  assert.equal(final.approvedPack.atlases.length, 1);
  assert.throws(
    () => applyReviewConfirmation(pack, task.fingerprint, submission, { ...provisional, results: provisional.results.map((result) => ({ ...result, approved: false })) }, confirmation, defaultConfig),
    /modified or stale provisional gate/,
  );
  const modifiedEvidence = structuredClone(provisional);
  modifiedEvidence.approvedPack.slices[0]!.content = "content modified after deterministic review";
  assert.throws(
    () => applyReviewConfirmation(pack, task.fingerprint, submission, modifiedEvidence, confirmation, defaultConfig),
    /modified or stale provisional gate/,
  );
  assert.throws(
    () => applyReviewConfirmation(pack, task.fingerprint, submission, provisional, { ...confirmation, confirmer: submission.reviewer }, defaultConfig),
    /different human or agent identity/,
  );
  assert.throws(
    () => applyReviewConfirmation(pack, "other-task", submission, provisional, confirmation, defaultConfig),
    /different task/,
  );
  assert.throws(
    () => applyReviewConfirmation(pack, task.fingerprint, { ...submission, reviewer: "modified" }, provisional, confirmation, defaultConfig),
    /different review submission/,
  );
});
