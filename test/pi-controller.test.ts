import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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
import {
  IMITATOR_COMMAND_NAMES,
  IMITATOR_TOOL_NAMES,
  MUTATION_GATE_SIGNALS,
  MUTATION_TOOL_DENY_LIST,
  PI_REQUIRED_HOOKS,
  inspectPiHealth,
  mutationGateSignal,
  renderPiHealth,
  type PiControllerPhase,
} from "../integrations/pi/contract.ts";
import { FilePiStateStore, inspectWorkspace, type PersistedPiPayload, type PiStateStore } from "../integrations/pi/state.ts";
import { matureAtlas, matureBundle, matureRepository } from "./helpers.ts";

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
    schemaVersion: 4,
    generatedAt: "2026-09-01T00:00:00.000Z",
    task: { task: "coding agent hook registry" },
    queries: ["coding agent hook registry"],
    assessments: [assessment],
    atlases: [matureAtlas(repository)],
    slices: [slice("approved-slice", "src/hooks.ts"), slice("uncited-slice", "test/hooks.test.ts")],
    bundles: [matureBundle(repository, ["approved-slice"])],
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
    evidenceBundleIds: ["bundle-architecture"],
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
    claims: [{
      id: "claim_registry_boundary", statement: "The reference separates hook registration from provider-specific execution.",
      status: "observed", confidence: 0.9, evidenceBundleIds: ["bundle-architecture"],
      evidenceSliceIds: ["approved-slice"], counterEvidenceSliceIds: [], limitations: [],
    }],
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

test("declared mutation tools and phase decisions are deterministic named signals", () => {
  assert.deepEqual([...MUTATION_TOOL_DENY_LIST], ["edit", "write", "bash", "powershell", "apply_patch"]);
  assert.equal(new Set(Object.values(IMITATOR_TOOL_NAMES)).size, Object.values(IMITATOR_TOOL_NAMES).length);
  assert.equal(new Set(Object.values(IMITATOR_COMMAND_NAMES)).size, Object.values(IMITATOR_COMMAND_NAMES).length);
  const guardedPhases = Object.keys(MUTATION_GATE_SIGNALS) as Array<Exclude<PiControllerPhase, "approved">>;
  assert.equal(new Set(guardedPhases.map((phase) => MUTATION_GATE_SIGNALS[phase].code)).size, guardedPhases.length);
  for (const phase of guardedPhases) {
    assert.deepEqual(mutationGateSignal("write", phase), MUTATION_GATE_SIGNALS[phase]);
    assert.match(MUTATION_GATE_SIGNALS[phase].reason, new RegExp(`\\[${MUTATION_GATE_SIGNALS[phase].code}\\]`));
  }
  assert.equal(mutationGateSignal("write", "approved"), undefined);
  assert.equal(mutationGateSignal("read", "idle"), undefined);
});

test("Pi health report uses registry, hooks, and store behavior oracles", () => {
  const report = inspectPiHealth({
    tools: Object.values(IMITATOR_TOOL_NAMES),
    commands: Object.values(IMITATOR_COMMAND_NAMES),
    hooks: PI_REQUIRED_HOOKS,
    store: { ok: true, detail: "checksum-valid persisted state (reviewing)" },
  });
  assert.equal(report.healthy, true);
  assert.deepEqual(report.checks.map((check) => check.name), ["registry", "hooks", "store"]);
  const output = renderPiHealth(report);
  assert.match(output, /^registry: ok/m);
  assert.match(output, /^hooks: ok/m);
  assert.match(output, /^store: ok/m);
  assert.doesNotMatch(output, /wiring/i);

  const unhealthy = inspectPiHealth({ tools: [], commands: [], hooks: [], store: { ok: false, detail: "checksum mismatch" } });
  assert.equal(unhealthy.healthy, false);
  assert.ok(unhealthy.checks.every((check) => !check.ok));
});

test("Pi controller enforces prepare-review-approve before mutation", async () => {
  const run = preparedRun();
  const controller = new PiHarnessController(runtime(run), 6, new MemoryStateStore());
  assert.match(controller.mutationBlockReason("edit")!, /imitator_prepare/);
  assert.equal(controller.mutationBlockReason("read"), undefined);
  const prepared = await controller.prepare({ task: "coding agent hook registry" }, "C:/workspace");
  assert.equal(controller.status().phase, "reviewing");
  assert.equal(prepared.referencePackFingerprint, fingerprintReferencePack(run.pack));
  assert.equal(prepared.taskFingerprint, run.taskIdentity.fingerprint);
  assert.equal(prepared.candidates[0]!.atlas.coverage.score, 90);
  assert.equal(prepared.candidates[0]!.bundles[0]!.id, "bundle-architecture");
  assert.equal(prepared.candidates[0]!.slices.length, 2);
  assert.match(controller.mutationBlockReason("bash")!, /submit_review/);
  const bundles = await controller.getEvidenceBundles(["bundle-architecture"]);
  assert.equal(bundles[0]!.slices[0]!.path, "src/hooks.ts");
  assert.equal(controller.status().readSlices, 0);
  await controller.getEvidence(["approved-slice"]);
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
  assert.equal(controller.mutationBlockReason("write"), MUTATION_GATE_SIGNALS.awaiting_design_confirmation.reason);
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
  await first.getEvidenceBundles(["bundle-architecture"]);
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
  assert.equal((await approved.stateStoreHealth(cwd)).ok, true);
  const state = await readFile(statePath, "utf8");
  await writeFile(statePath, state.replace('"phase": "approved"', '"phase": "reviewing"'), "utf8");
  const rejected = new PiHarnessController(runtime(run), 6, store);
  assert.equal((await rejected.stateStoreHealth(cwd)).ok, false);
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
  assert.deepEqual([...extension.tools.keys()].sort(), Object.values(IMITATOR_TOOL_NAMES).sort());
  assert.deepEqual([...extension.commands.keys()].sort(), Object.values(IMITATOR_COMMAND_NAMES).sort());
  assert.ok(extension.handlers.has("before_agent_start"));
  assert.ok(extension.handlers.has("tool_call"));
  assert.deepEqual([...extension.handlers.keys()].filter((name) => PI_REQUIRED_HOOKS.includes(name as typeof PI_REQUIRED_HOOKS[number])).sort(), [...PI_REQUIRED_HOOKS].sort());
  const toolCallHandler = extension.handlers.get("tool_call")?.[0];
  assert.ok(toolCallHandler);
  assert.deepEqual(await toolCallHandler({ toolName: "write" }), { block: true, reason: MUTATION_GATE_SIGNALS.idle.reason });
  assert.equal(await toolCallHandler({ toolName: "read" }), undefined);

  loaded.runtime.getAllTools = () => [...extension.tools.values()].map(({ definition, sourceInfo }) => ({ ...definition, sourceInfo }));
  loaded.runtime.getCommands = () => [...extension.commands.values()].map((command) => ({ ...command, source: "extension" as const }));
  const notifications: Array<{ message: string; type?: string }> = [];
  const doctor = extension.commands.get(IMITATOR_COMMAND_NAMES.doctor);
  assert.ok(doctor);
  await doctor.handler("", {
    cwd: agentDir,
    ui: { notify(message: string, type?: string) { notifications.push({ message, type }); } },
  } as never);
  assert.equal(notifications.length, 1);
  assert.equal(notifications[0]!.type, "info");
  assert.match(notifications[0]!.message, /^registry: ok/m);
  assert.match(notifications[0]!.message, /^hooks: ok/m);
  assert.match(notifications[0]!.message, /^store: ok/m);

  await mkdir(resolve(agentDir, ".imitator"));
  await writeFile(resolve(agentDir, ".imitator", "pi-state.json"), "{}\n", "utf8");
  await doctor.handler("", {
    cwd: agentDir,
    ui: { notify(message: string, type?: string) { notifications.push({ message, type }); } },
  } as never);
  assert.equal(notifications[1]!.type, "error");
  assert.match(notifications[1]!.message, /^store: failed/m);
});
