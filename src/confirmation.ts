import { createHash } from "node:crypto";
import type { GateResult, HarnessConfig, ReferencePack, ReviewConfirmation, ReviewSubmission } from "./types.ts";
import { applyReviewGate, fingerprintReferencePack } from "./review.ts";

function canonicalSubmission(submission: ReviewSubmission): object {
  return {
    schemaVersion: submission.schemaVersion,
    referencePackFingerprint: submission.referencePackFingerprint,
    reviewer: submission.reviewer.trim(),
    decisions: [...submission.decisions]
      .sort((a, b) => a.repository.localeCompare(b.repository))
      .map((decision) => ({
        ...decision,
        evidenceSliceIds: [...decision.evidenceSliceIds].sort(),
      })),
  };
}

export function fingerprintReviewSubmission(submission: ReviewSubmission): string {
  return createHash("sha256").update(JSON.stringify(canonicalSubmission(submission))).digest("hex");
}

export function buildReviewConfirmation(
  pack: ReferencePack,
  taskFingerprint: string,
  submission: ReviewSubmission,
  confirmer: string,
  kind: ReviewConfirmation["kind"],
  approvedRepositories: string[],
  confirmedAt = new Date().toISOString(),
  rationale = kind === "human"
    ? "Human approved the rendered reference proposal after inspection."
    : "Independent agent approved the evidence-bound reference proposal.",
): ReviewConfirmation {
  return {
    schemaVersion: 1,
    referencePackFingerprint: fingerprintReferencePack(pack),
    taskFingerprint,
    reviewFingerprint: fingerprintReviewSubmission(submission),
    confirmer: confirmer.trim(),
    kind,
    approvedRepositories: [...new Set(approvedRepositories)].sort(),
    rationale: rationale.trim(),
    confirmedAt,
  };
}

export function applyReviewConfirmation(
  pack: ReferencePack,
  taskFingerprint: string,
  submission: ReviewSubmission,
  provisional: GateResult,
  confirmation: ReviewConfirmation,
  config: HarnessConfig,
): GateResult {
  const packFingerprint = fingerprintReferencePack(pack);
  if (confirmation.schemaVersion !== 1) throw new Error("review confirmation schemaVersion must be 1");
  if (confirmation.referencePackFingerprint !== packFingerprint || provisional.referencePackFingerprint !== packFingerprint) {
    throw new Error("Review confirmation belongs to a different or modified reference pack");
  }
  if (confirmation.taskFingerprint !== taskFingerprint) throw new Error("Review confirmation belongs to a different task");
  if (confirmation.reviewFingerprint !== fingerprintReviewSubmission(submission)) throw new Error("Review confirmation belongs to a different review submission");
  const recomputed = applyReviewGate(pack, submission, config);
  const binding = (gate: GateResult): string => {
    const { generatedAt: _gateTime, approvedPack, ...gateFields } = gate;
    const { generatedAt: _packTime, ...packFields } = approvedPack;
    return JSON.stringify({ ...gateFields, approvedPack: packFields });
  };
  if (binding(recomputed) !== binding(provisional)) throw new Error("Review confirmation targets a modified or stale provisional gate");
  if (!confirmation.confirmer.trim()) throw new Error("Review confirmation requires a confirmer identity");
  if (confirmation.rationale.trim().length < 12) throw new Error("Review confirmation requires a meaningful rationale");
  if (confirmation.confirmer.trim().toLowerCase() === submission.reviewer.trim().toLowerCase()) {
    throw new Error("Review confirmation must come from a different human or agent identity");
  }
  if (confirmation.kind !== "human" && confirmation.kind !== "independent-agent") throw new Error("Review confirmation kind is invalid");
  if (Number.isNaN(Date.parse(confirmation.confirmedAt))) throw new Error("Review confirmation timestamp is invalid");
  const provisionallyApproved = new Set(provisional.results.filter((result) => result.approved).map((result) => result.repository));
  const confirmed = new Set(confirmation.approvedRepositories);
  if (confirmed.size === 0) throw new Error("Review confirmation must approve at least one repository");
  for (const repository of confirmed) {
    if (!provisionallyApproved.has(repository)) throw new Error(`Cannot confirm a repository that did not pass review: ${repository}`);
  }
  const results = provisional.results.map((result) => result.approved && !confirmed.has(result.repository)
    ? { ...result, approved: false, reasons: [...result.reasons, "Not approved by the independent confirmer"] }
    : result);
  const approvedBundleIds = new Set(results.filter((result) => result.approved).flatMap((result) => result.decision?.evidenceBundleIds ?? []));
  const approvedIds = new Set([
    ...results.filter((result) => result.approved).flatMap((result) => result.decision?.evidenceSliceIds ?? []),
    ...provisional.approvedPack.bundles.filter((bundle) => approvedBundleIds.has(bundle.id)).flatMap((bundle) => bundle.evidenceSliceIds),
  ]);
  const approvedPatterns = results.filter((result) => result.approved).flatMap((result) => result.decision?.transferablePatterns ?? []);
  return {
    ...provisional,
    generatedAt: confirmation.confirmedAt,
    results,
    approvedPack: {
      ...provisional.approvedPack,
      generatedAt: confirmation.confirmedAt,
      assessments: provisional.approvedPack.assessments.filter((assessment) => confirmed.has(assessment.repository.fullName)),
      atlases: provisional.approvedPack.atlases.filter((atlas) => confirmed.has(atlas.repository)),
      slices: provisional.approvedPack.slices.filter((slice) => approvedIds.has(slice.id)),
      bundles: provisional.approvedPack.bundles.filter((bundle) => approvedBundleIds.has(bundle.id) && confirmed.has(bundle.repository)),
      practices: [...new Set(approvedPatterns)],
    },
  };
}
