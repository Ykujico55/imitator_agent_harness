import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";
import { DefaultResourceLoader } from "@earendil-works/pi-coding-agent";
import { applyReviewConfirmation } from "../src/confirmation.ts";
import { defaultConfig } from "../src/config.ts";
import { confirmDesignDossier, evaluateDesignDossier } from "../src/design.ts";
import { applyReviewGate, fingerprintReferencePack } from "../src/review.ts";
import { assessRepository } from "../src/score.ts";
import { createTaskIdentity } from "../src/task.ts";
import type { DesignDossier, EvidenceSlice, ReferencePack, RepositoryReviewDecision } from "../src/types.ts";
import { PiHarnessController, type PiHarnessRuntime, type PreparedRun } from "../integrations/pi/controller.ts";
import { FilePiStateStore, inspectWorkspace, type PersistedPiPayload, type PiStateStore } from "../integrations/pi/state.ts";
import { matureRepository } from "./helpers.ts";

function preparedRun(): PreparedRun {
  const repository = matureRepository();
  const assessment = assessRepository(repository, { task: "coding agent hook registry" }, defaultConfig, new Date("2026-09-01T00:00:00Z"));
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
    reason: "extension boundary",
    content: "export interface HookRegistry {}",
  });
  const pack: ReferencePack = {
    schemaVersion: 2,
    generatedAt: "2026-09-01T00:00:00.000Z",
    task: { task: "coding agent hook registry" },
    queries: ["coding agent hook registry"],
    assessments: [assessment],
    slices: [slice("approved-slice", "src/hooks.ts"), slice("uncited-slice", "test/hooks.test.ts")],
    practices: [],
  };
  return {
    pack,
    directory: "C:/tmp/reference-pack",
    config: structuredClone(defaultConfig),
    taskIdentity: createTaskIdentity(pack.task, "C:/workspace", "test-revision"),
  };
}

function runtime(run: PreparedRun): PiHarnessRuntime {
  return {
    async prepare() { return run; },
    async review(current, submission) { return applyReviewGate(current.pack, submission, current.config); },
    async confirm(current, submission, provisional, confirmation) {
      return applyReviewConfirmation(current.pack, current.taskIdentity.fingerprint, submission, provisional, confirmation);
    },
    async evaluateDesign(current, referenceGate, dossier) {
      return evaluateDesignDossier(dossier, referenceGate, current.taskIdentity.fingerprint);
    },
    async confirmDesign(_current, _submission, _referenceConfirmation, _referenceGate, result, confirmation) {
      return confirmDesignDossier(result, confirmation);
    },
  };
}

class MemoryStateStore implements PiStateStore {
  state?: PersistedPiPayload;
  async load(): Promise<PersistedPiPayload | undefined> { return this.state ? structuredClone(this.state) : undefined; }
  async save(_cwd: string, state: PersistedPiPayload): Promise<void> { this.state = structuredClone(state); }
  async clear(): Promise<void> { this.state = undefined; }
}

function approvedDecision(): RepositoryReviewDecision {
  return {
    repository: "example/coding-agent",
    verdict: "adapt",
    confidence: 0.9,
    riskLevel: "medium",
    summary: "The hook registry boundary transfers after adapting lifecycle names.",
    transferablePatterns: ["Separate hook registration from hook execution."],
    mismatches: ["Lifecycle names differ from the local project."],
    risks: ["Do not reuse provider-specific types."],
    evidenceSliceIds: ["approved-slice"],
  };
}

function approvedDesign(run: PreparedRun): DesignDossier {
  return {
    schemaVersion: 1,
    taskFingerprint: run.taskIdentity.fingerprint,
    referencePackFingerprint: fingerprintReferencePack(run.pack),
    author: "pi-design-agent",
    repositories: ["example/coding-agent"],
    systemIntent: "Keep hook registration provider-neutral and behaviorally specified before execution.",
    localContext: {
      constraints: ["The core must remain provider-neutral and dependency-free."],
      existingConventions: ["The project uses injected interfaces and deterministic output."],
      qualityAttributes: ["Extensibility must preserve fail-closed behavior."],
    },
    principles: [{
      id: "principle_registry", title: "Separate registration from execution",
      problem: "Registration concerns otherwise leak into provider-specific runtime execution.", constraints: ["Providers expose different payload types."],
      decision: "Keep descriptors provider-neutral behind a narrow registry contract.", mechanisms: ["Store descriptors separately from executors."],
      tradeoffs: ["An adapter layer adds code while containing provider coupling."], nonGoals: ["Do not copy upstream provider types."],
      fitsWhen: ["Several providers share lifecycle concepts."], failsWhen: ["One fixed provider owns the complete runtime."],
      evidenceSliceIds: ["approved-slice"],
    }],
    architecture: [{
      id: "architecture_registry", name: "Hook registry", responsibility: "Own descriptors without invoking provider behavior.",
      collaborators: ["Executor"], invariants: ["Registration never invokes hooks."], failureModes: ["Duplicate names fail before execution."],
      extensionPoints: ["Descriptor validation"], evidenceSliceIds: ["approved-slice"],
    }],
    specifications: [{
      id: "spec_registry", subject: "Registration and lookup behavior contract.", preconditions: ["Name is non-empty."],
      postconditions: ["Registered descriptors are retrievable."], invariants: ["Descriptors remain provider-neutral."],
      errorSemantics: ["Duplicate names fail deterministically."], evidenceSliceIds: ["approved-slice"],
    }],
    testConcepts: [{
      id: "test_registry", behavior: "Registration changes lookup without invoking hooks.", layer: "contract",
      oracle: "A hook spy remains untouched after registration.", setup: ["Use a provider-neutral hook spy."],
      failureCases: ["Duplicate registration reports the documented error."], evidenceSliceIds: ["approved-slice"],
    }],
    negativeSpace: [{
      choice: "Avoid a universal provider configuration abstraction.",
      rationale: "Provider-specific options would erase the intended core boundary.", evidenceSliceIds: ["approved-slice"],
    }],
    localMappings: [{
      localConcern: "Add a local hook registry without provider coupling.",
      referenceConceptIds: ["principle_registry", "architecture_registry", "spec_registry", "test_registry"], decision: "adapt",
      rationale: "The boundary transfers while local lifecycle names differ.", adaptations: ["Translate names to local lifecycle events."],
      targetPaths: ["src/hooks/registry.ts"], acceptanceTests: ["Registration never invokes hooks and duplicates fail."],
    }],
    globalRisks: ["Provider payload types could still leak through descriptors."],
  };
}

test("Pi controller enforces prepare-review-approve before mutation", async () => {
  const run = preparedRun();
  const controller = new PiHarnessController(runtime(run), 6, new MemoryStateStore());
  assert.match(controller.mutationBlockReason("edit")!, /imitator_prepare/);
  assert.equal(controller.mutationBlockReason("read"), undefined);
  const prepared = await controller.prepare({ task: "coding agent hook registry" }, "C:/workspace");
  assert.equal(controller.status().phase, "reviewing");
  assert.equal(prepared.referencePackFingerprint, fingerprintReferencePack(run.pack));
  assert.equal(prepared.taskFingerprint, run.taskIdentity.fingerprint);
  assert.equal(prepared.candidates[0]!.slices.length, 2);
  assert.match(controller.mutationBlockReason("bash")!, /submit_review/);
  assert.equal((await controller.getEvidence(["approved-slice"]))[0]!.content, "export interface HookRegistry {}");
  const result = await controller.submitReview("pi-test", [approvedDecision()]);
  assert.equal(result.approvedPack.slices.length, 1);
  assert.equal(controller.status().phase, "awaiting_confirmation");
  assert.match(controller.mutationBlockReason("write")!, /confirmation/);
  await controller.confirmReview("human-test", "human");
  assert.equal(controller.status().phase, "distilling");
  assert.match(controller.mutationBlockReason("write")!, /design dossier/i);
  await assert.rejects(() => controller.getEvidence(["uncited-slice"]), /not approved/);
  const design = await controller.submitDesignDossier(approvedDesign(run));
  assert.equal(design.approved, true, design.reasons.join("\n"));
  assert.equal(controller.status().phase, "awaiting_design_confirmation");
  await controller.confirmDesign("human-designer", "human");
  assert.equal(controller.status().phase, "approved");
  assert.equal(controller.mutationBlockReason("write"), undefined);
  assert.match(controller.systemContext(), /Separate registration from execution/);
  assert.doesNotMatch(controller.systemContext(), /approved-slice/);
  await assert.rejects(() => controller.getEvidence(["approved-slice"]), /closed after design approval/);
  await controller.reset();
  assert.match(controller.mutationBlockReason("apply_patch")!, /imitator_prepare/);
});

test("Pi controller bounds progressive evidence reads", async () => {
  const run = preparedRun();
  const controller = new PiHarnessController(runtime(run), 1, new MemoryStateStore());
  await controller.prepare({ task: "coding agent hook registry" }, "C:/workspace");
  await assert.rejects(() => controller.getEvidence(["approved-slice", "uncited-slice"]), /At most 1/);
  await assert.rejects(() => controller.getEvidence(["forged"]), /unknown or not approved/);
});

test("Pi state survives restart and rejects an integrity-modified state file", async (t) => {
  const cwd = await mkdtemp(resolve(tmpdir(), "imitator-pi-state-"));
  t.after(async () => rm(cwd, { recursive: true, force: true }));
  const run = preparedRun();
  run.directory = resolve(cwd, ".imitator", "reference", "fixture");
  run.taskIdentity = await inspectWorkspace(run.pack.task, cwd);
  const store = new FilePiStateStore();
  const first = new PiHarnessController(runtime(run), 6, store);
  await first.prepare(run.pack.task, cwd);
  await first.getEvidence(["approved-slice"]);
  await first.submitReview("pi-test", [approvedDecision()]);
  assert.equal(first.status().phase, "awaiting_confirmation");

  const restored = new PiHarnessController(runtime(run), 6, store);
  assert.equal(await restored.restore(cwd), true);
  assert.equal(restored.status().phase, "awaiting_confirmation");
  await restored.confirmReview("human-test", "human");

  const distilling = new PiHarnessController(runtime(run), 6, store);
  assert.equal(await distilling.restore(cwd), true);
  assert.equal(distilling.status().phase, "distilling");
  await distilling.submitDesignDossier(approvedDesign(run));

  const designWaiting = new PiHarnessController(runtime(run), 6, store);
  assert.equal(await designWaiting.restore(cwd), true);
  assert.equal(designWaiting.status().phase, "awaiting_design_confirmation");
  await designWaiting.confirmDesign("human-designer", "human");

  const approved = new PiHarnessController(runtime(run), 6, store);
  assert.equal(await approved.restore(cwd), true);
  assert.equal(approved.mutationBlockReason("edit"), undefined);

  const statePath = store.path(cwd);
  const state = await readFile(statePath, "utf8");
  await writeFile(statePath, state.replace('"phase": "approved"', '"phase": "reviewing"'), "utf8");
  const rejected = new PiHarnessController(runtime(run), 6, store);
  await assert.rejects(() => rejected.restore(cwd), /integrity check/);
});

test("starting a replacement prepare clears stale persisted approval before remote work", async () => {
  const run = preparedRun();
  const store = new MemoryStateStore();
  const first = new PiHarnessController(runtime(run), 6, store);
  await first.prepare(run.pack.task, "C:/workspace");
  assert.equal(store.state?.phase, "reviewing");
  const failingRuntime: PiHarnessRuntime = {
    ...runtime(run),
    async prepare() { throw new Error("network unavailable"); },
  };
  const replacement = new PiHarnessController(failingRuntime, 6, store);
  await assert.rejects(() => replacement.prepare({ task: "replacement task" }, "C:/workspace"), /network unavailable/);
  assert.equal(store.state, undefined);
  assert.equal(replacement.status().phase, "idle");
});

test("prepare fails closed when stale state cannot be cleared", async () => {
  const run = preparedRun();
  const brokenStore: PiStateStore = {
    async load() { return undefined; },
    async save() {},
    async clear() { throw new Error("state is read-only"); },
  };
  const controller = new PiHarnessController(runtime(run), 6, brokenStore);
  await assert.rejects(() => controller.prepare(run.pack.task, "C:/workspace"), /state is read-only/);
  assert.equal(controller.status().phase, "idle");
  assert.match(controller.mutationBlockReason("write")!, /imitator_prepare/);
});

test("current Pi loader discovers the declared extension tools, commands, and gates", async (t) => {
  const agentDir = await mkdtemp(resolve(tmpdir(), "imitator-pi-agent-"));
  t.after(async () => rm(agentDir, { recursive: true, force: true }));
  const loader = new DefaultResourceLoader({
    cwd: process.cwd(),
    agentDir,
    additionalExtensionPaths: [resolve("integrations/pi/index.ts")],
    noSkills: true,
    noPromptTemplates: true,
    noThemes: true,
    noContextFiles: true,
  });
  await loader.reload();
  const loaded = loader.getExtensions();
  assert.deepEqual(loaded.errors, []);
  assert.equal(loaded.extensions.length, 1);
  const extension = loaded.extensions[0]!;
  assert.deepEqual([...extension.tools.keys()].sort(), ["imitator_get_evidence", "imitator_prepare", "imitator_submit_design_dossier", "imitator_submit_review"]);
  assert.deepEqual([...extension.commands.keys()].sort(), ["imitator-confirm", "imitator-prepare", "imitator-reset", "imitator-status"]);
  assert.ok(extension.handlers.has("before_agent_start"));
  assert.ok(extension.handlers.has("tool_call"));
});
