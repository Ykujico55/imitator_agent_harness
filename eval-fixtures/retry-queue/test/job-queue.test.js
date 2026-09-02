import assert from "node:assert/strict";
import test from "node:test";
import { JobQueue } from "../src/job-queue.js";

test("retries with injected backoff and stops after success", async () => {
  let attempts = 0;
  const sleeps = [];
  const queue = new JobQueue(async () => {
    attempts += 1;
    if (attempts < 3) throw new Error(`failure ${attempts}`);
    return "done";
  }, {
    maxAttempts: 4,
    backoff: (attempt) => attempt * 10,
    sleep: async (milliseconds) => { sleeps.push(milliseconds); },
  });
  assert.equal(await queue.run({ id: "job-1" }), "done");
  assert.equal(attempts, 3);
  assert.deepEqual(sleeps, [10, 20]);
});

test("rethrows the final error without an extra sleep", async () => {
  const errors = [new Error("one"), new Error("two")];
  let attempts = 0;
  let sleeps = 0;
  const queue = new JobQueue(async () => { throw errors[attempts++] ?? new Error("unexpected"); }, {
    maxAttempts: 2,
    sleep: async () => { sleeps += 1; },
  });
  await assert.rejects(() => queue.run("job"), /two/);
  assert.equal(attempts, 2);
  assert.equal(sleeps, 1);
});

test("uses three attempts by default and validates maxAttempts", async () => {
  let attempts = 0;
  const queue = new JobQueue(async () => { attempts += 1; throw new Error("nope"); }, { sleep: async () => {} });
  await assert.rejects(() => queue.run("job"), /nope/);
  assert.equal(attempts, 3);
  assert.throws(() => new JobQueue(async () => {}, { maxAttempts: 0 }), /maxAttempts/);
  assert.throws(() => new JobQueue(async () => {}, { maxAttempts: 1.5 }), /maxAttempts/);
});
