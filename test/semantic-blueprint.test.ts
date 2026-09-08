import assert from "node:assert/strict";
import test from "node:test";
import { blueprintObservations, buildReferenceSemanticBlueprints, MAX_BLUEPRINT_OBSERVATIONS_PER_REPOSITORY, renderReferenceSemanticBlueprints } from "../src/semantic-blueprint.ts";
import type { EvidenceBundle, EvidenceSlice, RepositoryDesignAtlas } from "../src/types.ts";
import { matureAtlas, matureRepository } from "./helpers.ts";

function fixture(): { atlas: RepositoryDesignAtlas; slices: EvidenceSlice[]; bundles: EvidenceBundle[] } {
  const repository = matureRepository({ language: "Python" });
  const atlas = matureAtlas(repository);
  atlas.modules = [{ rootPath: "src/cache", kind: "library", fileCount: 2, entryPoints: ["src/cache/core.py"] }];
  atlas.relations = [{
    from: "test/test_cache.py", to: "src/cache/core.py", kind: "tests", resolution: "static-candidate",
    evidence: { path: "test/test_cache.py", sourceUrl: `${repository.htmlUrl}/blob/${repository.resolvedRevision}/test/test_cache.py#L2` },
  }];
  atlas.unresolvedImports = [{
    path: "src/cache/core.py", sourceUrl: `${repository.htmlUrl}/blob/${repository.resolvedRevision}/src/cache/core.py`,
    module: "optional_clock", line: 8, reason: "conditional import target is ambiguous", scope: "module", context: ["try"],
  }];
  atlas.fixtureRelations = [{ testPath: "test/test_cache.py", testSymbol: "test_expiry", fixturePath: "test/conftest.py", fixtureSymbol: "clock", request: "clock", status: "candidate", reason: "lexical fixture candidate" }];
  atlas.sourceAnalyses = [
    {
      path: "src/cache/core.py", sourceUrl: `${repository.htmlUrl}/blob/${repository.resolvedRevision}/src/cache/core.py`, language: "python", status: "parsed", parser: "python-stdlib-ast", limitations: [], imports: [], exports: { names: ["Cache", "CachePolicy"], status: "static" },
      symbols: [
        { name: "Cache", kind: "class", startLine: 1, endLine: 12, signature: "class Cache", decorators: [], bases: [], raises: ["KeyError"], catches: [], assertionCount: 0, role: "implementation", fields: [{ name: "entries", annotation: "dict", defaultValue: "", line: 3, kind: "instance" }] },
        { name: "CachePolicy", kind: "class", startLine: 14, endLine: 18, signature: "class CachePolicy(Protocol)", decorators: [], bases: ["Protocol"], raises: [], catches: [], assertionCount: 0, role: "implementation" },
      ],
    },
    {
      path: "test/test_cache.py", sourceUrl: `${repository.htmlUrl}/blob/${repository.resolvedRevision}/test/test_cache.py`, language: "python", status: "parsed", parser: "python-stdlib-ast", limitations: [], imports: [],
      symbols: [{ name: "test_expiry", kind: "function", startLine: 1, endLine: 8, signature: "def test_expiry(clock)", decorators: [], bases: [], raises: [], catches: [], assertionCount: 2, role: "test", fixtureRequests: ["clock"] }],
    },
  ];
  const slice = (id: string, path: string, startLine: number, endLine: number, level: "syntactic" | "corroborated"): EvidenceSlice => ({
    id, repository: repository.fullName, repositoryUrl: repository.htmlUrl, license: repository.license, commitish: repository.resolvedRevision,
    path, startLine, endLine, sourceUrl: `${repository.htmlUrl}/blob/${repository.resolvedRevision}/${path}#L${startLine}-L${endLine}`,
    relevance: 80, reason: "semantic fixture", content: `UNTRUSTED_REMOTE_INSTRUCTION_${id}`,
    strategy: "python-ast", symbols: [id], evidenceStrength: { level, signals: ["complete-semantic-unit"], limitations: [] },
  });
  const slices: EvidenceSlice[] = [
    slice("cache-source", "src/cache/core.py", 1, 18, "syntactic"),
    { ...slice("cache-test", "test/test_cache.py", 1, 8, "corroborated"), evidenceRoles: ["test"] },
    { ...slice("cache-fixture", "test/conftest.py", 1, 5, "syntactic"), evidenceRoles: ["test"] },
  ];
  const bundles: EvidenceBundle[] = [{
    schemaVersion: 1, id: "cache-design", repository: repository.fullName, concern: "system-architecture", question: "How is cache behavior bounded?",
    epistemicCeiling: "observed", evidenceKinds: ["implementation", "test", "relationship"], evidenceSliceIds: slices.map((item) => item.id),
    relatedPaths: slices.map((item) => item.path), relations: atlas.relations, limitations: [],
  }];
  return { atlas, slices, bundles };
}

test("compiles deterministic, attributed architecture observations without copying source content", () => {
  const input = fixture();
  const first = buildReferenceSemanticBlueprints([input.atlas], input.slices, input.bundles);
  const second = buildReferenceSemanticBlueprints([input.atlas], input.slices, input.bundles);
  assert.deepEqual(first, second);
  const blueprint = first[0]!;
  assert.equal(blueprint.observationalOnly, true);
  assert.ok(blueprint.budget.selectedObservations <= MAX_BLUEPRINT_OBSERVATIONS_PER_REPOSITORY);
  for (const section of ["modules", "contracts", "dataModels", "relationships", "failureSemantics", "testConcepts", "extensionPoints", "negativeSpace"] as const) {
    assert.ok(blueprint.sections[section].length > 0, `missing ${section}`);
  }
  assert.ok(blueprint.sources.every((source) => source.sourceUrl.includes(repositoryRevision(input.atlas)) && source.license === "MIT"));
  assert.doesNotMatch(JSON.stringify(blueprint), /UNTRUSTED_REMOTE_INSTRUCTION/);
  assert.match(renderReferenceSemanticBlueprints(first), /bounded static observations/i);
});

test("every blueprint observation remains slice-bound and bundle-aware", () => {
  const input = fixture();
  const blueprints = buildReferenceSemanticBlueprints([input.atlas], input.slices, input.bundles);
  const observations = blueprintObservations(blueprints);
  const sourceIds = new Set(blueprints[0]!.sources.map((source) => source.sliceId));
  assert.ok(observations.length > 0);
  for (const observation of observations) {
    assert.ok(observation.evidenceSliceIds.length > 0);
    assert.ok(observation.evidenceSliceIds.every((id) => sourceIds.has(id)));
    assert.deepEqual(observation.evidenceBundleIds, ["cache-design"]);
  }
});

function repositoryRevision(atlas: RepositoryDesignAtlas): string {
  return `/blob/${atlas.revision}/`;
}
