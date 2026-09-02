import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";
import { DefaultResourceLoader } from "@earendil-works/pi-coding-agent";
import { defaultConfig } from "../src/config.ts";
import { applyReviewGate, fingerprintReferencePack } from "../src/review.ts";
import { assessRepository } from "../src/score.ts";
import type { EvidenceSlice, ReferencePack, RepositoryReviewDecision } from "../src/types.ts";
import { PiHarnessController, type PiHarnessRuntime, type PreparedRun } from "../integrations/pi/controller.ts";
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
  return { pack, directory: "C:/tmp/reference-pack", config: structuredClone(defaultConfig) };
}

function runtime(run: PreparedRun): PiHarnessRuntime {
  return {
    async prepare() { return run; },
    async gate(current, submission) { return applyReviewGate(current.pack, submission, current.config); },
  };
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

test("Pi controller enforces prepare-review-approve before mutation", async () => {
  const run = preparedRun();
  const controller = new PiHarnessController(runtime(run));
  assert.match(controller.mutationBlockReason("edit")!, /imitator_prepare/);
  assert.equal(controller.mutationBlockReason("read"), undefined);
  const prepared = await controller.prepare({ task: "coding agent hook registry" }, "C:/workspace");
  assert.equal(controller.status().phase, "reviewing");
  assert.equal(prepared.fingerprint, fingerprintReferencePack(run.pack));
  assert.equal(prepared.candidates[0]!.slices.length, 2);
  assert.match(controller.mutationBlockReason("bash")!, /submit_review/);
  assert.equal(controller.getEvidence(["approved-slice"])[0]!.content, "export interface HookRegistry {}");
  const result = await controller.submitReview("pi-test", [approvedDecision()]);
  assert.equal(result.approvedPack.slices.length, 1);
  assert.equal(controller.status().phase, "approved");
  assert.equal(controller.mutationBlockReason("write"), undefined);
  assert.match(controller.systemContext(), /Separate hook registration/);
  assert.match(controller.systemContext(), /approved-slice/);
  assert.throws(() => controller.getEvidence(["uncited-slice"]), /not approved/);
  controller.reset();
  assert.match(controller.mutationBlockReason("apply_patch")!, /imitator_prepare/);
});

test("Pi controller bounds progressive evidence reads", async () => {
  const run = preparedRun();
  const controller = new PiHarnessController(runtime(run), 1);
  await controller.prepare({ task: "coding agent hook registry" }, "C:/workspace");
  assert.throws(() => controller.getEvidence(["approved-slice", "uncited-slice"]), /At most 1/);
  assert.throws(() => controller.getEvidence(["forged"]), /unknown or not approved/);
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
  assert.deepEqual([...extension.tools.keys()].sort(), ["imitator_get_evidence", "imitator_prepare", "imitator_submit_review"]);
  assert.deepEqual([...extension.commands.keys()].sort(), ["imitator-prepare", "imitator-reset", "imitator-status"]);
  assert.ok(extension.handlers.has("before_agent_start"));
  assert.ok(extension.handlers.has("tool_call"));
});
