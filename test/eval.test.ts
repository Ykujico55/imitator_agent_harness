import assert from "node:assert/strict";
import test from "node:test";
import { buildEvalPlan, extractLastJsonObject, parseDesignJudgeDecision, parseEvalSuite, parseReferenceJudgeDecision, summarizeEvalResults, type EvalRunResult } from "../src/eval.ts";

test("builds a deterministic paired A/B plan", () => {
  const suite = parseEvalSuite({
    schemaVersion: 1,
    name: "paired",
    repetitions: 2,
    tasks: [{ id: "queue", fixture: "./queue", prompt: "Add retries", verify: { command: "npm", args: ["test"] } }],
  });
  assert.deepEqual(buildEvalPlan(suite).map((run) => run.id), [
    "queue-baseline-r1", "queue-imitator-r1", "queue-baseline-r2", "queue-imitator-r2",
  ]);
});

test("summarizes verification rate without claiming semantic quality", () => {
  const base = {
    schemaVersion: 1 as const,
    provider: "test",
    model: "model",
    startedAt: "2026-09-02T00:00:00.000Z",
    finishedAt: "2026-09-02T00:00:01.000Z",
    agentExitCode: 0,
    durationMs: 1000,
    changedFiles: 2,
    agentOutput: "",
    verificationOutput: "",
  };
  const results: EvalRunResult[] = [
    { ...base, run: { id: "a", task: { id: "x", fixture: "x", prompt: "x", verify: { command: "x" } }, variant: "baseline", repetition: 1 }, verificationExitCode: 1 },
    { ...base, run: { id: "b", task: { id: "x", fixture: "x", prompt: "x", verify: { command: "x" } }, variant: "imitator", repetition: 1 }, verificationExitCode: 0, changedFiles: 4 },
  ];
  const summary = summarizeEvalResults(results);
  assert.equal(summary.byVariant.baseline.verificationRate, 0);
  assert.equal(summary.byVariant.imitator.verificationRate, 1);
  assert.equal(summary.byVariant.imitator.averageChangedFiles, 4);
});

test("rejects executable suites with malformed verification commands", () => {
  assert.throws(() => parseEvalSuite({ schemaVersion: 1, name: "bad", repetitions: 1, tasks: [{ id: "x", fixture: "x", prompt: "x", verify: { command: "", args: "npm test" } }] }), /verify.command/);
});

test("keeps eval suite names, fixtures and run variants within declared bounds", () => {
  const task = { id: "x", fixture: "fixture", prompt: "implement behavior", verify: { command: "node", args: ["--test"] } };
  assert.throws(() => parseEvalSuite({ schemaVersion: 1, name: "../outside", repetitions: 1, tasks: [task] }), /path-safe identifier/);
  assert.throws(() => parseEvalSuite({ schemaVersion: 1, name: "safe", repetitions: 1, tasks: [{ ...task, fixture: "../outside" }] }), /stay within the suite directory/);
  assert.throws(() => parseEvalSuite({ schemaVersion: 1, name: "safe", repetitions: 1, tasks: [{ ...task, fixture: "C:\\outside" }] }), /stay within the suite directory/);
  const suite = parseEvalSuite({ schemaVersion: 1, name: "safe", repetitions: 1, tasks: [{ ...task, fixture: "./nested/fixture" }] });
  assert.equal(suite.tasks[0]!.fixture, "nested/fixture");
  assert.throws(() => buildEvalPlan(suite, ["unsafe" as never]), /only baseline and imitator|invalid|At least|variant/i);
});

test("extracts and validates the last structured independent-judge decision", () => {
  const output = 'log {not json}\nfinal {"approvedRepositories":["example/repo"],"rationale":"Evidence and license support adaptation."}\n';
  assert.deepEqual(extractLastJsonObject(output).approvedRepositories, ["example/repo"]);
  assert.deepEqual(parseReferenceJudgeDecision(output, ["example/repo"]).approvedRepositories, ["example/repo"]);
  assert.throws(() => parseReferenceJudgeDecision(output, ["other/repo"]), /outside the provisional set/);
  assert.deepEqual(parseDesignJudgeDecision('{"approve":true,"rationale":"The mappings are evidence-bound and testable."}'), {
    approve: true,
    rationale: "The mappings are evidence-bound and testable.",
  });
});
