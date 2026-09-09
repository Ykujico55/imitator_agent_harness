import assert from "node:assert/strict";
import test from "node:test";
import { refineEvidenceSlices } from "../src/evidence-refinement.ts";
import type { EvidenceSlice } from "../src/types.ts";

const base: EvidenceSlice = {
  id: "one", repository: "example/repo", repositoryUrl: "https://github.com/example/repo", license: "MIT",
  commitish: "abc", path: "src/api.ts", startLine: 1, endLine: 2,
  sourceUrl: "https://github.com/example/repo/blob/abc/src/api.ts#L1-L2", relevance: 20,
  reason: "parsed public surface", content: "export interface Api {}", strategy: "typescript-ast",
  symbols: ["Api"], evidenceRoles: ["implementation"], architectureRoles: ["contract"],
};

test("refinement keeps marginal evidence and audits duplicates and missing roles", () => {
  const duplicate = { ...base, id: "two", path: "src/copy.ts", sourceUrl: "https://github.com/example/repo/blob/abc/src/copy.ts#L1-L2" };
  const testSlice: EvidenceSlice = { ...base, id: "test", path: "test/api.test.ts", content: "test('api', () => expect(true).toBe(true))",
    sourceUrl: "https://github.com/example/repo/blob/abc/test/api.test.ts#L1-L2", evidenceRoles: ["test"], architectureRoles: ["invariant", "test"] };
  const result = refineEvidenceSlices([base, duplicate, testSlice], undefined, ["api"], { maxSlices: 10, maxCharacters: 10_000 });
  assert.deepEqual(result.slices.map((slice) => slice.id).sort(), ["one", "test"]);
  assert.ok(result.report.discarded.some((item) => item.path === "src/copy.ts" && item.reason === "duplicate"));
  assert.deepEqual(result.report.coveredRoles, ["contract", "invariant", "test"]);
  assert.deepEqual(result.report.missingRoles, ["failure", "relationship"]);
  assert.match(result.report.limitations.join(" "), /keep reference claims unknown/);
  assert.ok(result.slices.every((slice) => slice.reason.includes("evidence-gain:")));
});
