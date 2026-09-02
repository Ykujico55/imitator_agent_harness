import assert from "node:assert/strict";
import test from "node:test";
import { buildEvidenceBundles, evidenceKind, renderEvidenceBundles } from "../src/bundle.ts";
import { defaultConfig } from "../src/config.ts";
import type { EvidenceSlice } from "../src/types.ts";
import { matureAtlas, matureRepository } from "./helpers.ts";

test("compiles deterministic multi-modal evidence bundles from Atlas relationships and slices", () => {
  const repository = matureRepository();
  const atlas = matureAtlas(repository);
  atlas.entryPoints = [{ path: "src/extensions/tool-registry.ts", sourceUrl: "https://example/entry", reason: "entry" }];
  atlas.relations = [{
    from: "test/extensions.test.ts", to: "src/extensions/tool-registry.ts", kind: "tests",
    evidence: { path: "test/extensions.test.ts", sourceUrl: "https://example/test" },
  }];
  const slice = (id: string, path: string, content: string, relevance: number): EvidenceSlice => ({
    id, path, content, relevance, repository: repository.fullName, repositoryUrl: repository.htmlUrl,
    license: repository.license, commitish: repository.resolvedRevision, startLine: 1, endLine: 3,
    sourceUrl: `${repository.htmlUrl}/blob/${repository.resolvedRevision}/${path}#L1-L3`, reason: "fixture",
  });
  const slices = [
    slice("doc", "docs/architecture.md", "The registry boundary separates execution.", 90),
    slice("manifest", "package.json", "{\"dependencies\":{}}", 70),
    slice("source", "src/extensions/tool-registry.ts", "export class Registry { fail() { throw new Error('invalid hook'); } }", 80),
    slice("test", "test/extensions.test.ts", "test('rejects duplicate registry names', () => {})", 75),
  ];
  const first = buildEvidenceBundles([atlas], slices, defaultConfig);
  const second = buildEvidenceBundles([atlas], slices, defaultConfig);
  assert.deepEqual(first, second);
  assert.ok(first.some((bundle) => bundle.concern === "system-architecture" && bundle.epistemicCeiling === "explicit"));
  assert.ok(first.some((bundle) => bundle.concern === "testing-strategy" && bundle.evidenceKinds.includes("relationship")));
  assert.ok(first.every((bundle) => bundle.evidenceKinds.length >= defaultConfig.bundles.minimumEvidenceKinds));
  assert.match(renderEvidenceBundles(first, slices), /Evidence bundles/);
  assert.equal(evidenceKind(slices[1]!), "manifest");

  const capped = buildEvidenceBundles([atlas], slices, {
    ...defaultConfig,
    bundles: { ...defaultConfig.bundles, maxBundlesPerRepository: 4 },
  });
  assert.deepEqual(capped.map((bundle) => bundle.concern).sort(), [
    "failure-semantics", "system-architecture", "technology-selection", "testing-strategy",
  ]);
});

test("does not manufacture a bundle from a single evidence modality", () => {
  const repository = matureRepository();
  const atlas = matureAtlas(repository);
  const slices: EvidenceSlice[] = [{
    id: "only-doc", path: "docs/architecture.md", content: "Architecture", relevance: 80,
    repository: repository.fullName, repositoryUrl: repository.htmlUrl, license: repository.license,
    commitish: repository.resolvedRevision, startLine: 1, endLine: 1, sourceUrl: "https://example/doc", reason: "fixture",
  }];
  assert.deepEqual(buildEvidenceBundles([atlas], slices, defaultConfig), []);
});
