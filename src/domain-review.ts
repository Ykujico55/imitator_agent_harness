import { containsDomainTerm, domainMetadataSignal, extractTaskDomain } from "./domain.ts";
import type { EvidenceSlice, HarnessConfig, RepositoryProfile, RepositoryReviewDecision, TaskSpec } from "./types.ts";
import { isBehaviorCodeFile } from "./evidence-path.ts";

// Only code/test content can satisfy the behavioral-evidence floor. A README,
// package manifest, filename, or reviewer-written rationale cannot satisfy it.

export function domainReviewReasons(
  repo: RepositoryProfile, task: TaskSpec, decision: RepositoryReviewDecision,
  slices: EvidenceSlice[], config: HarnessConfig,
): string[] {
  const reasons: string[] = [];
  const metadata = domainMetadataSignal(`${repo.fullName} ${repo.description} ${repo.topics.join(" ")}`, task);
  if (!metadata.matched.length || metadata.score < config.acceptance.minimumDomainMatch) {
    reasons.push("review-domain-mismatch: current domain assessment fails; generic engineering patterns cannot qualify a reference");
  }
  const fit = decision.domainFit;
  if (!fit) return [...reasons, "review-domain-fit-missing: explicit same-domain assessment and behavioral evidence are required"];
  if (fit.relation !== "same-domain") reasons.push(`review-domain-relation: ${fit.relation} cannot enter the same-domain learning set`);
  if (fit.rationale.trim().length < 20) reasons.push("review-domain-rationale: explain the shared product responsibility and behavior, not just packaging");
  if (!fit.evidenceSliceIds.length) reasons.push("review-domain-evidence-missing: cite inspected implementation or test slices");
  const cited = new Set(decision.evidenceSliceIds);
  const byId = new Map(slices.map((slice) => [slice.id, slice]));
  const domain = extractTaskDomain(task);
  if (domain.source !== "task-profile") reasons.push("review-domain-profile-required: prepare a task-grounded purpose and capabilities before approving references");
  let supported = false;
  for (const id of new Set(fit.evidenceSliceIds)) {
    const slice = byId.get(id);
    if (!cited.has(id) || !slice || slice.repository !== decision.repository) {
      reasons.push(`review-domain-evidence-unbound: ${id} must also be cited in this repository's inspected evidence`);
      continue;
    }
    if (!isBehaviorCodeFile(slice.path)) continue;
    const capabilities = domain.capabilities.filter((item) => item.aliases.some((term) => containsDomainTerm(slice.content, term)));
    if (capabilities.length > 0) supported = true;
  }
  if (!supported) reasons.push("review-domain-behavior-missing: cited code/tests must expose at least one task-profile capability, not just the product name; confidence cannot replace evidence");
  return reasons;
}
