import assert from "node:assert/strict";
import test from "node:test";
import { createRustAnalysis } from "../integrations/rust-syntax.ts";
import { createDefaultSourceRouter } from "../integrations/source-router.ts";
import { buildRepositoryDesignAtlas, renderDesignAtlases } from "../src/atlas.ts";
import { buildEvidenceBundles } from "../src/bundle.ts";
import { defaultConfig } from "../src/config.ts";
import type { GitHubClient } from "../src/github.ts";
import { prepareReferencePack } from "../src/pipeline.ts";
import { buildReviewRequest } from "../src/review.ts";
import { resolveRustImport } from "../src/rust-relations.ts";
import { assessRepository } from "../src/score.ts";
import { collectSlices } from "../src/slice.ts";
import { matureRepository } from "./helpers.ts";
import { cacheTask } from "./domain-fixtures.ts";

const rust = createRustAnalysis();

function fixture(contents: Record<string, string>) {
  const repository = matureRepository({ description: "LRU cache with eviction and bounded capacity", topics: ["cache", "rust"], language: "Rust", tree: Object.entries(contents).map(([path, content]) => ({ path, type: "blob", sha: path, size: content.length })) });
  const client = { async readTextFile(_repo: string, path: string) { return contents[path]!; } } as unknown as GitHubClient;
  return { repository, client };
}

const library = [
  "use crate::storage::{Store, Error as StoreError};",
  "#[cfg(feature = \"serde\")]",
  "use crate::serde_support as wire;",
  "mod storage;",
  "#[derive(Debug, Clone)]",
  "pub struct Cache<K, V> {",
  "    capacity: usize,",
  "    store: Store<K, V>,",
  "}",
  "pub enum CacheError { Full, Backend(StoreError) }",
  "pub trait Eviction<K> {",
  "    type Error;",
  "    fn evict(&mut self, key: &K) -> Result<(), Self::Error>;",
  "}",
  "impl<K, V> Eviction<K> for Cache<K, V> {",
  "    type Error = CacheError;",
  "    fn evict(&mut self, key: &K) -> Result<(), Self::Error> {",
  "        self.store.remove(key)?;",
  "        Ok(())",
  "    }",
  "}",
  "#[cfg(test)]",
  "mod tests {",
  "    use super::*;",
  "    #[test]",
  "    fn evicts_oldest() {",
  "        let text = r#\"panic!(\"not code\")\"#;",
  "        assert_eq!(text.len() > 0, true);",
  "    }",
  "    #[tokio::test]",
  "    async fn expires_entries() { assert!(true); }",
  "}",
].join("\n");

test("Rust static parser extracts contracts, fields, variants, impls, failures, visibility and tests", () => {
  const analysis = rust.analyze({ path: "src/lib.rs", content: library })!;
  assert.equal(analysis.status, "parsed");
  assert.equal(analysis.language, "rust");
  assert.deepEqual(analysis.exports, { names: ["Cache", "CacheError", "Eviction"], status: "static" });
  const cache = analysis.symbols.find((item) => item.name === "Cache")!;
  assert.equal(cache.kind, "struct");
  assert.equal(cache.visibility, "pub");
  assert.deepEqual(cache.attributes, ["derive(Debug, Clone)"]);
  assert.deepEqual(cache.fields!.map((field) => [field.name, field.annotation]), [["capacity", "usize"], ["store", "Store<K, V>"]]);
  const error = analysis.symbols.find((item) => item.name === "CacheError")!;
  assert.deepEqual(error.variants, ["Full", "Backend"]);
  assert.deepEqual(analysis.symbols.find((item) => item.name === "Eviction")!.traits, ["trait-contract"]);
  const implementation = analysis.symbols.find((item) => item.kind === "impl")!;
  assert.deepEqual(implementation.bases, ["<K, V> Eviction<K>"]);
  assert.equal(implementation.implementedFor, "Cache<K, V>");
  const method = analysis.symbols.find((item) => item.name.endsWith("::evict") && item.name.startsWith("impl"))!;
  assert.deepEqual(method.errorSignals, ["question-mark-propagation", "result-return"]);
  assert.equal(method.assertionCount, 0);
  assert.equal(analysis.symbols.find((item) => item.name.endsWith("evicts_oldest"))!.assertionCount, 1);
  assert.equal(analysis.symbols.find((item) => item.name.endsWith("expires_entries"))!.role, "test");
  assert.equal(analysis.symbols.find((item) => item.name.endsWith("expires_entries"))!.startLine, 30, "complete test span includes its attribute");
  assert.ok(!analysis.symbols.some((item) => item.errorSignals?.includes("panic-like-macro")), "raw string contents must not become failure syntax");
  const shapes = rust.analyze({ path: "src/shapes.rs", content: "pub struct Pair(pub usize, String);\npub(crate) struct Internal;\npub struct r#type;\npub union Bits { int: u32, float: f32 }\npub auto trait Marker {}\npub static mut COUNT: usize = 0;\npub extern \"C\" fn entry() {}\n" })!;
  assert.deepEqual(shapes.symbols.find((item) => item.name === "Pair")!.fields!.map((item) => item.annotation), ["usize", "String"]);
  assert.deepEqual(shapes.symbols.find((item) => item.name === "Bits")!.fields!.map((item) => item.name), ["int", "float"]);
  assert.deepEqual(shapes.symbols.find((item) => item.name === "Marker")!.traits, ["trait-contract", "auto-trait"]);
  assert.deepEqual(shapes.symbols.find((item) => item.name === "COUNT")!.traits, ["mutable-static"]);
  assert.equal(shapes.symbols.find((item) => item.name === "entry")!.kind, "function");
  assert.equal(shapes.symbols.find((item) => item.name === "Internal")!.visibility, "pub(crate)");
  assert.ok(!shapes.exports!.names.includes("Internal"));
  assert.ok(shapes.symbols.some((item) => item.name === "type"));
});

test("Rust uses preserve aliases, lexical scopes and cfg context without resolving extern prelude", () => {
  const analysis = rust.analyze({ path: "src/lib.rs", content: library })!;
  const grouped = analysis.imports[0]!;
  assert.equal(grouped.module, "crate::storage");
  assert.deepEqual(grouped.aliases, [{ name: "Store", asName: null }, { name: "Error", asName: "StoreError" }]);
  const conditional = analysis.imports.find((item) => item.module === "crate::serde_support")!;
  assert.deepEqual(conditional.context, ['cfg(feature = "serde")']);
  const inTest = analysis.imports.find((item) => item.module === "super::*")!;
  assert.equal(inTest.scope, "tests");
  assert.deepEqual(inTest.context, ["cfg(test)"]);
  assert.equal(analysis.imports.find((item) => item.kind === "module")!.module, "storage");
  const files = new Set(["src/lib.rs", "src/storage.rs", "src/serde_support/mod.rs"]);
  assert.deepEqual(resolveRustImport("src/lib.rs", grouped, files), { targets: ["src/storage.rs"] });
  assert.deepEqual(resolveRustImport("src/lib.rs", inTest, files), { targets: ["src/lib.rs"] });
  assert.deepEqual(resolveRustImport("src/lib.rs", { module: "serde::Serialize", names: ["Serialize"], level: 0, line: 1, kind: "use" }, files), { targets: [], reason: "extern-prelude-or-ambiguous-bare-use" });
});

test("Rust parser rejects incomplete lexical structures and ignores code in comments and strings", () => {
  assert.equal(rust.analyze({ path: "src/lib.rs", content: "pub struct Broken {" })!.status, "invalid");
  const analysis = rust.analyze({ path: "src/lib.rs", content: "// pub struct Fake {}\nconst TEXT: &str = \"#[test] fn fake() {}\";\npub fn real() {}\n" })!;
  assert.deepEqual(analysis.symbols.map((item) => item.name), ["TEXT", "real"]);
  assert.ok(!analysis.symbols.some((item) => item.role === "test"));
  assert.equal(rust.analyze({ path: "src/lib.rs", content: " ".repeat(120001) })!.status, "budget-exceeded");
  const nested = rust.analyze({ path: "src/lib.rs", content: "mod a {".repeat(4000) + "}".repeat(4000) })!;
  assert.equal(nested.status, "parsed");
  assert.ok(nested.symbols.length > 0 && nested.symbols.length <= 200);
  assert.match(nested.limitations.join(" "), /truncated/);
  assert.equal(rust.analyze({ path: "Cargo.toml", content: `[dependencies]\n${"a".repeat(100_000)} = "1"\n` })!.status, "budget-exceeded");
  assert.equal(rust.analyze({ path: "src/main.py", content: "def main(): pass" }), undefined);
});

test("Cargo subset extracts package, dependency classes, features, workspace and explicit targets", () => {
  const cargo = `[package]\nname = "cache-kit"\nedition = "2024"\ndescription = "supports [bounded] caches"\n[dependencies]\nserde = { version = "1", optional = true }\n[dependencies.hashbrown]\nversion = "0.15"\n[target.'cfg(unix)'.dependencies]\nlibc = "0.2"\n[dev-dependencies]\nproptest = "1"\n[build-dependencies]\ncc = "1"\n[features]\ndefault = ["serde"]\n[workspace]\nmembers = [\n  "crates/core",\n  "crates/cli",\n]\n[[bin]]\nname = "cachectl"\npath = "src/bin/cachectl.rs"\n`;
  const analysis = rust.analyze({ path: "Cargo.toml", content: cargo })!;
  assert.equal(analysis.status, "parsed");
  assert.deepEqual(analysis.manifest, {
    packageName: "cache-kit", dependencies: ["hashbrown", "libc", "serde"], developmentDependencies: ["cc", "proptest"], scripts: [], workspacePatterns: ["crates/cli", "crates/core"], entryTargets: ["src/bin/cachectl.rs"], format: "cargo", completeness: "partial", edition: "2024", features: ["default"], targets: [{ name: "cachectl", kind: "bin", path: "src/bin/cachectl.rs" }],
  });
  assert.match(analysis.limitations.join(" "), /build scripts/);
  assert.equal(rust.analyze({ path: "Cargo.toml", content: "[workspace]\nmembers = [\n" })!.status, "invalid");
});

test("Rust module resolution respects inline module scope and rejects explicit path guesses", () => {
  const files = new Set(["src/lib.rs", "src/outer/child.rs", "src/wired.rs"]);
  assert.deepEqual(resolveRustImport("src/lib.rs", { module: "child", names: [], level: 0, line: 3, kind: "module", scope: "outer", context: [] }, files), { targets: ["src/outer/child.rs"] });
  assert.deepEqual(resolveRustImport("src/lib.rs", { module: "wired", names: [], level: 0, line: 3, kind: "module", scope: "module", context: ['path = "wired.rs"'] }, files), { targets: [], reason: "explicit-path-module-unsupported" });
});

test("Rust declaration slicing is complete, deterministic and budget-bound", () => {
  const selected = rust.selectWindow({ path: "src/lib.rs", content: library, terms: ["evict"], maxLines: 12 })!;
  assert.equal(selected.strategy, "rust-syntax");
  assert.match(selected.symbols![0]!, /evict|Eviction/);
  assert.doesNotMatch(selected.content, /expires_entries/);
  assert.equal(rust.selectWindow({ path: "src/lib.rs", content: library, terms: ["evict"], maxLines: 0 }), undefined);
});

test("Rust Atlas recognizes inline unit tests, Cargo entries and attributed static module candidates", async () => {
  const contents = { "README.md": "LRU cache architecture", "docs/architecture.md": "Cache owns eviction policy; Store owns persistence.", "Cargo.toml": '[package]\nname="cache-kit"\nedition="2024"\n[dependencies]\nhashbrown="0.15"\n', "src/lib.rs": library, "src/storage.rs": "pub struct Store<K, V> { entries: Vec<(K, V)> }\nimpl<K, V> Store<K, V> { pub fn remove(&mut self, _key: &K) -> Result<(), Error> { Ok(()) } }\npub struct Error;\n", ".github/workflows/check.yml": "name: check\njobs: {}\n" };
  const { repository, client } = fixture(contents);
  const cache = new Map<string, string>();
  const atlas = await buildRepositoryDesignAtlas(client, repository, cacheTask, defaultConfig, cache, rust.analyze);
  assert.equal(atlas.coverage.sufficient, true);
  assert.ok(atlas.coverage.presentCategories.includes("test"));
  assert.ok(atlas.testFiles.some((item) => item.path === "src/lib.rs"));
  assert.equal(atlas.manifests[0]!.parseStatus, "partial");
  assert.equal(atlas.manifests[0]!.edition, "2024");
  assert.ok(atlas.entryPoints.some((item) => item.path === "src/lib.rs"));
  const moduleEdge = atlas.relations.find((edge) => edge.from === "src/lib.rs" && edge.to === "src/storage.rs")!;
  assert.equal(moduleEdge.resolution, "rust-module-candidate");
  assert.match(moduleEdge.evidence.sourceUrl, /#L/);
  assert.ok(atlas.unresolvedImports!.some((item) => item.module === "crate::serde_support"));
  assert.match(renderDesignAtlases([atlas]), /Rust syntax:/);
  assert.match(renderDesignAtlases([atlas]), /trait-contract/);
});

test("Rust inline unit tests and implementation become distinct exact-window slice roles and bundles", async () => {
  const contents = { "README.md": "cache architecture", "docs/architecture.md": "eviction design", "Cargo.toml": '[package]\nname="cache-kit"\n', "src/lib.rs": library, "src/storage.rs": "pub struct Store<K,V>{ value: Option<(K,V)> }\npub struct Error;\nimpl<K,V> Store<K,V>{ pub fn remove(&mut self,_:&K)->Result<(),Error>{Ok(())}}\n" };
  const { repository, client } = fixture(contents); const cache = new Map<string, string>();
  const atlas = await buildRepositoryDesignAtlas(client, repository, cacheTask, defaultConfig, cache, rust.analyze);
  const assessment = assessRepository(repository, cacheTask, defaultConfig, new Date("2026-09-08")); assessment.accepted = true;
  const slices = await collectSlices(client, [assessment], cacheTask, defaultConfig, rust.selectWindow, [atlas], cache);
  assert.ok(slices.some((item) => item.strategy === "rust-syntax" && item.evidenceRoles?.includes("implementation")));
  assert.ok(slices.some((item) => item.strategy === "rust-syntax" && item.evidenceRoles?.includes("test")));
  const bundles = buildEvidenceBundles([atlas], slices, defaultConfig);
  assert.ok(bundles.some((item) => item.evidenceKinds.includes("test") && item.evidenceKinds.includes("implementation")));
  assert.ok(bundles.some((item) => item.limitations.some((limit) => limit.includes("macro expansion"))));
});

test("Pi-compatible full pipeline accepts a Rust reference using injected static analysis", async () => {
  const contents = { "README.md": "LRU cache architecture and eviction behavior", "docs/architecture.md": "The cache separates eviction policy and storage.", "Cargo.toml": '[package]\nname="cache-kit"\n', "src/lib.rs": library, "src/storage.rs": "pub struct Store<K,V>{value:Option<(K,V)>}\npub struct Error;\nimpl<K,V> Store<K,V>{pub fn remove(&mut self,_:&K)->Result<(),Error>{Ok(())}}\n" };
  const { repository, client } = fixture(contents);
  const config = structuredClone(defaultConfig); config.github.inspectLimit = 1; config.slicing.maxRepositories = 1;
  const api = client as GitHubClient & { searchRepositories: GitHubClient["searchRepositories"]; profile: GitHubClient["profile"] };
  api.searchRepositories = async () => [{ full_name: repository.fullName, html_url: repository.htmlUrl, description: repository.description,
    stargazers_count: repository.stars, forks_count: repository.forks, open_issues_count: repository.openIssues,
    size: repository.sizeKb, archived: false, fork: false, default_branch: "main", pushed_at: repository.pushedAt,
    created_at: repository.createdAt, license: { spdx_id: "MIT" }, language: "Rust", topics: repository.topics }];
  api.profile = async () => repository;
  const sourceRouter = createDefaultSourceRouter({ rust });
  const pack = await prepareReferencePack(api, cacheTask, config, { sourceRouter });
  assert.deepEqual(pack.selection?.selectedRepositories, [repository.fullName]);
  assert.ok(pack.slices.some((item) => item.evidenceRoles?.includes("test")));
  assert.ok(pack.atlases[0]!.sourceAnalyses?.some((item) => item.language === "rust"));
  assert.ok(pack.atlases[0]!.sourceRoutes?.some((item) => item.selectedAnalyzer === "rust-static-syntax"));
  assert.equal(pack.atlases[0]!.analysisQuality?.calibrationStatus, "observational-only");
  assert.ok((pack.atlases[0]!.analysisQuality?.score ?? 0) > 30);
  assert.ok(pack.slices.every((item) => item.evidenceStrength));
  assert.ok(pack.bundles.every((item) => item.evidenceStrength));
  const request = buildReviewRequest(pack);
  assert.ok(request.candidates[0]!.slices.some((item) => item.strategy === "rust-syntax" && item.evidenceRoles?.includes("test") && item.symbols?.length));
});
