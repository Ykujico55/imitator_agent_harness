import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";
import { buildDesignConfirmation, buildDesignDossierRequest, buildDesignDossierTemplate, confirmDesignDossier, evaluateDesignDossier, fingerprintDesignDossier, parseDesignDossier } from "../src/design.ts";
import { renderAdaptationBrief, renderDesignAgentContext, renderDesignDossier } from "../src/design-render.ts";
import { defaultConfig } from "../src/config.ts";
import { applyReviewGate, fingerprintReferencePack } from "../src/review.ts";
import { assessRepository } from "../src/score.ts";
import { createTaskIdentity } from "../src/task.ts";
import { writeDesignProposal, writeDesignRequest, writeDesignResult, writeGateResult } from "../src/pipeline.ts";
import type { DesignDossier, EvidenceSlice, GateResult, ReferencePack, ReviewSubmission } from "../src/types.ts";
import { codingAgentTask, matureAtlas, matureBundle, matureRepository } from "./helpers.ts";

function referenceFixture(): { pack: ReferencePack; gate: GateResult; submission: ReviewSubmission; taskFingerprint: string } {
  const repository = matureRepository();
  const assessment = assessRepository(repository, { task: "coding agent hook registry" }, defaultConfig, new Date("2026-09-01T00:00:00Z"));
  const slice: EvidenceSlice = {
    id: "design-evidence", repository: repository.fullName, repositoryUrl: repository.htmlUrl, license: repository.license,
    commitish: repository.resolvedRevision, path: "src/registry.ts", startLine: 1, endLine: 8,
    sourceUrl: `${repository.htmlUrl}/blob/${repository.resolvedRevision}/src/registry.ts#L1-L8`, relevance: 80,
    reason: "registry contract", content: "export interface HookRegistry { register(name: string): void }",
  };
  const pack: ReferencePack = {
    schemaVersion: 4, generatedAt: "2026-09-01T00:00:00.000Z", task: codingAgentTask(),
    queries: ["coding agent hook registry"], assessments: [assessment], atlases: [matureAtlas(repository)], slices: [slice],
    bundles: [matureBundle(repository, [slice.id])], practices: [],
  };
  const submission: ReviewSubmission = {
    schemaVersion: 1, referencePackFingerprint: fingerprintReferencePack(pack), reviewer: "selection-agent",
    decisions: [{
      repository: repository.fullName, verdict: "adapt", confidence: 0.9, riskLevel: "medium",
      summary: "The registry boundary transfers after adapting lifecycle naming.",
      transferablePatterns: ["Separate hook registration from execution."], mismatches: ["Lifecycle names differ."],
      risks: ["Provider types must not enter the core."], evidenceBundleIds: ["bundle-architecture"], evidenceSliceIds: [slice.id],
      domainFit: { relation: "same-domain", rationale: "Both coding-agent systems register lifecycle hooks through a registry.", evidenceSliceIds: [slice.id] },
    }],
  };
  const gate = applyReviewGate(pack, submission, defaultConfig);
  const taskFingerprint = createTaskIdentity(pack.task, "C:/workspace", "abc").fingerprint;
  return { pack, gate, submission, taskFingerprint };
}

function dossier(taskFingerprint: string, referencePackFingerprint: string): DesignDossier {
  return {
    schemaVersion: 1,
    taskFingerprint,
    referencePackFingerprint,
    author: "design-agent",
    repositories: ["example/coding-agent"],
    systemIntent: "Provide a provider-neutral hook registry with explicit lifecycle and failure contracts.",
    localContext: {
      constraints: ["The core must remain provider-neutral and dependency-free."],
      existingConventions: ["The local project uses narrow injected interfaces and deterministic errors."],
      qualityAttributes: ["Evolvability without weakening deterministic safety checks."],
    },
    claims: [{
      id: "claim_registry_boundary",
      statement: "The reference separates registration metadata from provider-specific execution behavior.",
      status: "observed",
      confidence: 0.9,
      evidenceBundleIds: ["bundle-architecture"],
      evidenceSliceIds: ["design-evidence"],
      counterEvidenceSliceIds: [],
      limitations: [],
    }],
    principles: [{
      id: "principle_registry_boundary", title: "Registry and execution remain separate",
      problem: "Registration-time concerns otherwise leak into runtime execution paths.",
      constraints: ["Providers expose different hook payload types."],
      decision: "Keep registration metadata independent from the executor implementation.",
      mechanisms: ["Store provider-neutral descriptors behind a narrow registry interface."],
      tradeoffs: ["An adapter layer adds code but prevents provider coupling."],
      nonGoals: ["Do not reproduce the upstream directory layout."],
      fitsWhen: ["Multiple providers share the same lifecycle concepts."],
      failsWhen: ["A single fixed provider owns the complete process lifetime."],
      evidenceSliceIds: ["design-evidence"],
    }],
    architecture: [{
      id: "architecture_registry", name: "Hook registry",
      responsibility: "Own hook descriptors without invoking provider-specific behavior.",
      collaborators: ["Hook executor", "Provider adapter"], invariants: ["Registration never executes a hook."],
      failureModes: ["Duplicate names are rejected before execution."], extensionPoints: ["Descriptor validation policy"],
      evidenceSliceIds: ["design-evidence"],
    }],
    specifications: [{
      id: "spec_registration", subject: "Hook registration contract",
      preconditions: ["The hook name is non-empty."], postconditions: ["A valid descriptor is retrievable by name."],
      invariants: ["Stored descriptors remain provider-neutral."], errorSemantics: ["Duplicate hook names fail deterministically."],
      evidenceSliceIds: ["design-evidence"],
    }],
    testConcepts: [{
      id: "test_registry_contract", behavior: "Registration and execution remain observably separate.", layer: "contract",
      oracle: "A registration call changes lookup state without invoking the hook.", setup: ["Use a hook spy that records invocations."],
      failureCases: ["Duplicate registration returns the documented failure."], evidenceSliceIds: ["design-evidence"],
    }],
    negativeSpace: [{
      choice: "Avoid a universal provider abstraction with every upstream option.",
      rationale: "Only lifecycle invariants transfer; provider-specific options would create accidental coupling.",
      evidenceSliceIds: ["design-evidence"],
    }],
    localMappings: [{
      localConcern: "Introduce a local hook registry without coupling the provider-neutral core.",
      referenceConceptIds: ["principle_registry_boundary", "architecture_registry", "spec_registration", "test_registry_contract"],
      decision: "adapt", rationale: "The boundary transfers, while local lifecycle names and errors differ.",
      adaptations: ["Translate upstream hook names into local lifecycle events."], targetPaths: ["src/hooks/registry.ts"],
      acceptanceTests: ["Registering a hook never invokes it and duplicate names fail deterministically."],
    }],
    globalRisks: ["A superficially generic registry could still leak provider payload types."],
  };
}

test("approves a complete evidence-bound cross-language design dossier", () => {
  const fixture = referenceFixture();
  const parsed = parseDesignDossier(dossier(fixture.taskFingerprint, fixture.gate.referencePackFingerprint));
  const result = evaluateDesignDossier(parsed, fixture.gate, fixture.taskFingerprint);
  assert.equal(result.approved, true, result.reasons.join("\n"));
  assert.equal(result.dossierFingerprint, fingerprintDesignDossier(parsed));
  assert.deepEqual(result.evidenceSliceIds, ["design-evidence"]);
  const request = buildDesignDossierRequest(fixture.gate, fixture.taskFingerprint);
  assert.equal(request.evidenceIndex[0]!.license, "MIT");
  assert.equal(request.atlases[0]!.repository, "example/coding-agent");
  assert.equal(buildDesignDossierTemplate(request).principles.length, 0);
  const confirmation = buildDesignConfirmation(result, "human-designer", "human", "2026-09-02T00:00:00.000Z");
  assert.equal(confirmDesignDossier(result, confirmation).generatedAt, confirmation.confirmedAt);
});

test("rejects unsupported claims, incomplete applicability, unmapped concepts, and self-confirmation", () => {
  const fixture = referenceFixture();
  const input = dossier(fixture.taskFingerprint, fixture.gate.referencePackFingerprint);
  input.principles[0]!.evidenceSliceIds = ["forged"];
  input.principles[0]!.failsWhen = [];
  input.localMappings[0]!.referenceConceptIds = ["architecture_registry", "spec_registration", "test_registry_contract"];
  const result = evaluateDesignDossier(input, fixture.gate, fixture.taskFingerprint);
  assert.equal(result.approved, false);
  assert.ok(result.reasons.some((reason) => /unknown or unapproved evidence/.test(reason)));
  assert.ok(result.reasons.some((reason) => /applicability/.test(reason)));
  assert.ok(result.reasons.some((reason) => /no local decision/.test(reason)));

  const valid = evaluateDesignDossier(dossier(fixture.taskFingerprint, fixture.gate.referencePackFingerprint), fixture.gate, fixture.taskFingerprint);
  assert.throws(() => confirmDesignDossier(valid, buildDesignConfirmation(valid, "design-agent", "human")), /different human or agent identity/);
});

test("rejects overconfident inference and evidence used without a non-unknown claim", () => {
  const fixture = referenceFixture();
  const inferred = dossier(fixture.taskFingerprint, fixture.gate.referencePackFingerprint);
  inferred.claims[0]!.status = "inferred";
  inferred.claims[0]!.confidence = 0.95;
  inferred.claims[0]!.limitations = [];
  const inferredResult = evaluateDesignDossier(inferred, fixture.gate, fixture.taskFingerprint);
  assert.equal(inferredResult.approved, false);
  assert.ok(inferredResult.reasons.some((reason) => /inferred claim has no limitations/.test(reason)));
  assert.ok(inferredResult.reasons.some((reason) => /inferred confidence 0.95 exceeds 0.8/.test(reason)));

  const unknown = dossier(fixture.taskFingerprint, fixture.gate.referencePackFingerprint);
  unknown.claims[0]!.status = "unknown";
  unknown.claims[0]!.confidence = 0.1;
  unknown.claims[0]!.limitations = ["The bounded evidence does not establish the author's intended lifecycle semantics."];
  const unknownResult = evaluateDesignDossier(unknown, fixture.gate, fixture.taskFingerprint);
  assert.equal(unknownResult.approved, false);
  assert.ok(unknownResult.reasons.some((reason) => /without a non-unknown epistemic claim/.test(reason)));

  const explicitFromImplementation = dossier(fixture.taskFingerprint, fixture.gate.referencePackFingerprint);
  explicitFromImplementation.claims[0]!.status = "explicit";
  explicitFromImplementation.claims[0]!.confidence = 0.95;
  const explicitResult = evaluateDesignDossier(explicitFromImplementation, fixture.gate, fixture.taskFingerprint);
  assert.equal(explicitResult.approved, false);
  assert.ok(explicitResult.reasons.some((reason) => /does not directly cite an ADR, RFC, architecture, or design document/.test(reason)));
});

test("renders design intent and local contracts without embedding remote source content", () => {
  const fixture = referenceFixture();
  const input = dossier(fixture.taskFingerprint, fixture.gate.referencePackFingerprint);
  const result = evaluateDesignDossier(input, fixture.gate, fixture.taskFingerprint);
  const markdown = renderDesignDossier(input, fixture.gate);
  assert.match(markdown, /Registry and execution remain separate/);
  assert.match(markdown, /Epistemic claims/);
  assert.match(markdown, /design-evidence/);
  assert.doesNotMatch(markdown, /export interface HookRegistry/);
  assert.match(renderAdaptationBrief(input), /Acceptance tests/);
  assert.match(renderDesignAgentContext(result), /Approved design-taste context/);
  assert.match(renderDesignAgentContext(result), /Fails when/);
  assert.match(renderDesignAgentContext(result), /Oracle/);
});

test("fails closed when the design context exceeds its bounded budget", () => {
  const fixture = referenceFixture();
  const input = dossier(fixture.taskFingerprint, fixture.gate.referencePackFingerprint);
  input.globalRisks = Array.from({ length: 50 }, (_, index) => `Risk ${index}: ${"x".repeat(1900)}`);
  const result = evaluateDesignDossier(input, fixture.gate, fixture.taskFingerprint);
  assert.equal(result.approved, false);
  assert.ok(result.reasons.some((reason) => /context budget/.test(reason)));
});

test("writes auditable request, proposal, and final design artifacts", async (t) => {
  const output = await mkdtemp(resolve(tmpdir(), "imitator-design-"));
  t.after(async () => rm(output, { recursive: true, force: true }));
  const fixture = referenceFixture();
  const input = dossier(fixture.taskFingerprint, fixture.gate.referencePackFingerprint);
  const result = evaluateDesignDossier(input, fixture.gate, fixture.taskFingerprint);
  const confirmation = buildDesignConfirmation(result, "independent-designer", "independent-agent", "2026-09-02T00:00:00.000Z");
  await writeGateResult(fixture.gate, fixture.submission, resolve(output, "review-proposal"));
  await writeDesignRequest(fixture.gate, fixture.taskFingerprint, resolve(output, "reference-approved"));
  await writeDesignProposal(result, fixture.gate, resolve(output, "design-proposal"));
  await writeDesignResult(confirmDesignDossier(result, confirmation), confirmation, fixture.gate, resolve(output, "approved"));
  const request = JSON.parse(await readFile(resolve(output, "reference-approved", "DESIGN_DOSSIER_REQUEST.json"), "utf8"));
  assert.equal(request.evidenceIndex[0].license, "MIT");
  assert.equal(request.evidenceIndex[0].id, "design-evidence");
  assert.equal(request.atlases[0].coverage.score, 90);
  const reviewSubmission = JSON.parse(await readFile(resolve(output, "review-proposal", "REVIEW_SUBMISSION.json"), "utf8"));
  assert.equal(reviewSubmission.reviewer, "selection-agent");
  const approvedAtlas = await readFile(resolve(output, "review-proposal", "APPROVED_DESIGN_ATLAS.md"), "utf8");
  assert.match(approvedAtlas, /Coverage: 90\/100/);
  const proposal = await readFile(resolve(output, "design-proposal", "DESIGN_DOSSIER.md"), "utf8");
  assert.match(proposal, /license: MIT/);
  assert.doesNotMatch(proposal, /export interface HookRegistry/);
  const context = await readFile(resolve(output, "approved", "APPROVED_AGENT_CONTEXT.md"), "utf8");
  assert.match(context, /Local requirements that outrank references/);
  assert.doesNotMatch(context, /design-evidence/);
});
