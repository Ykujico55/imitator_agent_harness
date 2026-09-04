import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, access, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createPythonAnalysis } from "../integrations/python-ast.ts";
import { buildRepositoryDesignAtlas, renderDesignAtlases } from "../src/atlas.ts";
import { defaultConfig } from "../src/config.ts";
import { collectSlices, rankPaths } from "../src/slice.ts";
import { pythonImportTargets, pythonImportRoots, resolvePythonModule, resolvePythonImport } from "../src/python-relations.ts";
import { linkPythonFixtures } from "../src/python-fixtures.ts";
import { hasTestEvidence } from "../src/coverage-evidence.ts";
import { isImplementationPath, isTestPath, isTestSupportPath } from "../src/evidence-path.ts";
import { buildEvidenceBundles } from "../src/bundle.ts";
import { assessRepository } from "../src/score.ts";
import type { GitHubClient } from "../src/github.ts";
import { matureRepository } from "./helpers.ts";
import { cacheTask } from "./domain-fixtures.ts";

const python = createPythonAnalysis();
const available = python.analyze({ path: "probe.py", content: "def probe():\n    pass\n" })?.status === "parsed";
const needsPython = { skip: available ? false : "Set IMITATOR_PYTHON to a working Python 3.11+ executable to run real parser tests" };

test("Python parser retains qualified declarations, decorators, annotations and exception observations", needsPython, () => {
  const content = [
    '"""from fake import invented; def pretend(): pass"""',
    "from .storage import Store as Backend",
    "class Cache(Backend):",
    "    @decorator(",
    "        enabled=True,",
    "    )",
    "    async def evict(self, key: str) -> bool:",
    "        try:",
    "            assert key",
    "            raise ValueError(key)",
    "        except ValueError:",
    "            raise",
    "",
    "@pytest.fixture",
    "def cache():",
    "    return Cache()",
    "",
    "def test_evict(cache):",
    "    assert cache is not None",
  ].join("\n");
  const analysis = python.analyze({ path: "cache/core.py", content })!;
  assert.equal(analysis.status, "parsed");
  assert.deepEqual(analysis.imports, [{ module: "storage", names: ["Store"], level: 1, line: 2,
    aliases: [{ name: "Store", asName: "Backend" }], scope: "module", context: [] }]);
  const method = analysis.symbols.find((symbol) => symbol.name === "Cache.evict")!;
  assert.equal(method.kind, "async-function");
  assert.equal(method.startLine, 4);
  assert.equal(method.endLine, 12);
  assert.match(method.signature, /key: str.*bool/);
  assert.deepEqual(method.raises, ["ValueError(key)", "re-raise"]);
  assert.deepEqual(method.catches, ["ValueError"]);
  assert.equal(method.assertionCount, 1);
  assert.deepEqual(analysis.symbols[0]!.bases, ["Backend"]);
  assert.deepEqual(analysis.symbols[0]!.raises, [], "method failures must not be falsely assigned to class body");
  assert.equal(analysis.symbols.find((symbol) => symbol.name === "cache")!.role, "fixture");
  assert.equal(analysis.symbols.find((symbol) => symbol.name === "test_evict")!.role, "test");
  const slice = python.selectWindow({ path: "core.py", content, terms: ["evict"], maxLines: 9 })!;
  assert.equal(slice.strategy, "python-ast");
  assert.equal(slice.start, 4);
  assert.equal(slice.end, 12);
  assert.match(slice.content, /^    @decorator/);
  assert.equal(slice.relevance, 13, "named-symbol 8 + content 5; no license/language quality bonus");
});

test("Python parsing never imports or executes top-level code or decorators", needsPython, async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "imitator-python-safety-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const marker = join(directory, "must-not-exist");
  const content = `from pathlib import Path\nPath(${JSON.stringify(marker)}).write_text('executed')\nraise RuntimeError('must not execute')\n@dangerous()\ndef safe_to_parse():\n    return 1\n`;
  assert.equal(python.analyze({ path: "malicious.py", content })!.status, "parsed");
  await assert.rejects(access(marker));
});

test("Python AST windows honor CRLF, multiline strings, syntax errors and complete-unit budgets", needsPython, () => {
  const content = 'def evict():\r\n    """class Fake:\r\n    def not_real(): pass\r\n    """\r\n    return True\r\n';
  const analysis = python.analyze({ path: "core.py", content })!;
  assert.deepEqual(analysis.symbols.map((item) => item.name), ["evict"]);
  assert.equal(python.selectWindow({ path: "core.py", content, terms: ["evict"], maxLines: 4 }), undefined);
  const slice = python.selectWindow({ path: "core.py", content, terms: ["evict"], maxLines: 5 })!;
  assert.equal(slice.content, content.replace(/\r\n/g, "\n").trimEnd());
  assert.equal(python.analyze({ path: "bad.py", content: "def broken(" })!.status, "invalid");
  assert.equal(python.selectWindow({ path: "bad.py", content: "def broken(", terms: [], maxLines: 5 }), undefined);
  assert.equal(python.analyze({ path: "too-big.py", content: " ".repeat(120001) })!.status, "budget-exceeded");
  assert.equal(python.analyze({ path: "main.ts", content: "export {}" }), undefined);
});

test("missing Python is an explicit fallback, never a claimed AST", () => {
  const missing = createPythonAnalysis({ executable: join(tmpdir(), "nonexistent-imitator-python-executable") });
  assert.equal(missing.analyze({ path: "test.py", content: "def test_ok(): pass" })!.status, "unavailable");
  assert.equal(missing.selectWindow({ path: "test.py", content: "def test_ok(): pass", terms: [], maxLines: 5 }), undefined);
});

test("pyproject parsing extracts static requirements and scripts without executing build configuration", needsPython, () => {
  const content = `[project]\nname = "cache-kit"\ndependencies = ["typing-extensions>=4"]\n[project.optional-dependencies]\nspeed = ["fast-cache; python_version > '3.10'"]\n[project.scripts]\ncache = "cache.cli:main"\n[dependency-groups]\ntest = ["pytest>=8", {include-group = "lint"}]\n[build-system]\nrequires = ["dangerous-build-backend"]\nbuild-backend = "do_not_execute"\n`;
  const analysis = python.analyze({ path: "pyproject.toml", content })!;
  assert.equal(analysis.manifest!.packageName, "cache-kit");
  assert.deepEqual(analysis.manifest!.entryTargets, ["cache.cli:main"]);
  assert.deepEqual(analysis.manifest!.developmentDependencies, ["pytest>=8"]);
  assert.equal(analysis.manifest!.dependencies.length, 2);
  assert.match(analysis.limitations.join(" "), /group includes are not evaluated/);
  assert.equal(python.analyze({ path: "pyproject.toml", content: "[project" })!.status, "invalid");
});

test("Python imports resolve conventional flat/src packages, relative levels and unambiguous tests", () => {
  const files = new Set(["pyproject.toml", "src/cache/__init__.py", "src/cache/core.py", "src/cache/sub/view.py", "src/cache/store.py", "tests/test_cache.py"]);
  const roots = pythonImportRoots(files);
  const spec = { module: "cache.core", names: ["Cache"], level: 0, line: 1 };
  assert.deepEqual(pythonImportTargets("tests/test_cache.py", spec, files, roots), ["src/cache/core.py"]);
  assert.deepEqual(pythonImportTargets("src/cache/sub/view.py", { ...spec, module: "store", names: [], level: 2 }, files, roots), ["src/cache/store.py"]);
  assert.deepEqual(pythonImportTargets("src/cache/core.py", { ...spec, module: "", names: ["store"], level: 1 }, files, roots), ["src/cache/__init__.py", "src/cache/store.py"]);
  assert.deepEqual(pythonImportTargets("src/cache/core.py", { ...spec, level: 3 }, files, roots), []);
  assert.deepEqual(pythonImportTargets("tests/test_cache.py", { ...spec, module: "external.library" }, files, roots), []);
  files.add("cache/core.py");
  assert.equal(resolvePythonModule("cache.core", roots, files), undefined, "ambiguous search paths are not guessed");
  assert.deepEqual(pythonImportTargets("tests/test_cache.py", spec, files, roots), []);
  assert.equal(isImplementationPath("cache/core.py"), true);
  assert.equal(isImplementationPath("docs/tutorial.py"), false);
  assert.equal(isTestPath("conftest.py"), false);
  assert.equal(isTestSupportPath("conftest.py"), true);
});

test("Python Atlas to evidence bundles retains source attribution and earns named relation evidence", needsPython, async () => {
  const contents: Record<string, string> = {
    "README.md": "cache architecture",
    "pyproject.toml": '[project]\nname = "cache-kit"\n[project.scripts]\ncache = "cache.core:main"\n',
    "cache/__init__.py": "from .core import Cache\n",
    "cache/core.py": "from .store import Store\nclass Cache(Store):\n    def evict(self, key: str):\n        if not key:\n            raise ValueError(key)\n        return key\n",
    "cache/store.py": "class Store:\n    pass\n",
    "tests/test_cache.py": "from cache.core import Cache\ndef test_evict():\n    assert Cache().evict('k') == 'k'\n",
  };
  const repo = matureRepository({ description: "LRU cache with eviction", topics: ["cache"], tree: Object.entries(contents).map(([path, content]) => ({ path, type: "blob", sha: path, size: content.length })) });
  const client = { async readTextFile(_repo: string, path: string) { return contents[path]!; } } as unknown as GitHubClient;
  const cache = new Map<string, string>();
  const atlas = await buildRepositoryDesignAtlas(client, repo, cacheTask, defaultConfig, cache, python.analyze);
  assert.equal(atlas.manifests[0]!.parseStatus, "parsed");
  assert.ok(atlas.entryPoints.some((entry) => entry.path === "cache/core.py"));
  assert.ok(atlas.modules.some((module) => module.rootPath === "cache"));
  assert.ok(atlas.relations.some((edge) => edge.from === "tests/test_cache.py" && edge.to === "cache/core.py" && edge.kind === "tests"));
  assert.equal(atlas.coverage.signals.find((signal) => signal.name === "relationships-evidence")!.points, 10);
  assert.ok(atlas.relations.every((edge) => edge.evidence.sourceUrl.includes(repo.resolvedRevision)));
  assert.match(renderDesignAtlases([atlas]), /Cache.evict/);
  const assessment = assessRepository(repo, cacheTask, defaultConfig, new Date("2026-09-01"));
  const slices = await collectSlices(client, [assessment], cacheTask, defaultConfig, python.selectWindow, [atlas], cache);
  assert.ok(slices.some((slice) => slice.strategy === "python-ast" && slice.path === "cache/core.py"));
  assert.ok(slices.every((slice) => slice.license === repo.license && slice.commitish === repo.resolvedRevision));
  const bundles = buildEvidenceBundles([atlas], slices, defaultConfig);
  assert.ok(bundles.some((bundle) => bundle.evidenceKinds.includes("relationship")));
  assert.ok(atlas.relations.every((edge) => edge.resolution === "static-candidate"));
  assert.ok(bundles.some((bundle) => bundle.limitations.some((item) => item.includes("not verified runtime imports"))));
});

test("Atlas refuses partial Python parses and records adapter failures", async () => {
  const repo = matureRepository({ tree: [{ path: "core.py", type: "blob", sha: "x", size: 200 }] });
  const client = { async readTextFile() { return "def evict():\n    return True\n"; } } as unknown as GitHubClient;
  const config = structuredClone(defaultConfig);
  config.atlas.maxTotalCharacters = 10;
  let calls = 0;
  const atlas = await buildRepositoryDesignAtlas(client, repo, cacheTask, config, new Map(), () => { calls++; throw new Error("not called"); });
  assert.equal(calls, 0);
  assert.equal(atlas.sourceAnalyses![0]!.status, "budget-exceeded");
  assert.equal(atlas.coverage.score, 0);
  assert.equal(atlas.readFailures![0]!.reason, "content-truncated");
  const failed = await buildRepositoryDesignAtlas(client, repo, cacheTask, defaultConfig, new Map(), () => { throw new Error("parser failure"); });
  assert.equal(failed.sourceAnalyses![0]!.status, "unavailable");
});

test("Python complete declarations are not cut to satisfy the remaining character budget", needsPython, async () => {
  const content = `def evict():\n    return '${"x".repeat(250)}'\n`;
  const repo = matureRepository({ tree: [{ path: "cache.py", type: "blob", sha: "x", size: content.length }] });
  const config = structuredClone(defaultConfig);
  config.slicing.maxTotalCharacters = 220;
  const client = { async readTextFile() { return content; } } as unknown as GitHubClient;
  const assessment = assessRepository(repo, cacheTask, defaultConfig, new Date("2026-09-01"));
  assessment.accepted = true;
  assert.deepEqual(await collectSlices(client, [assessment], cacheTask, config, python.selectWindow), []);
});

function sourceFixture(contents: Record<string, string>) {
  const repository = matureRepository({ tree: Object.entries(contents).map(([path, content]) => ({ path, type: "blob", sha: path, size: content.length })) });
  const reads: string[] = [];
  const client = { async readTextFile(_repo: string, path: string) { reads.push(path); return contents[path]!; } } as unknown as GitHubClient;
  return { repository, client, reads };
}

test("read-backed coverage and slices protect actual source/tests from many Python package markers", needsPython, async () => {
  const contents = {
    ...Object.fromEntries(Array.from({ length: 30 }, (_, i) => [`pkg/p${i}/__init__.py`, '"""package marker"""\n'])),
    "pyproject.toml": '[project]\nname = "sample"\n',
    "pkg/core.py": "def execute():\n    return 1\n",
    "tests/test_core.py": "def test_execute():\n    check_result()\n",
  };
  const { repository, client, reads } = sourceFixture(contents);
  const cache = new Map<string, string>();
  const atlas = await buildRepositoryDesignAtlas(client, repository, cacheTask, defaultConfig, cache, python.analyze);
  assert.equal(atlas.coverageBasis, "read-content-v2");
  assert.equal(atlas.coverage.sufficient, true);
  assert.equal(atlas.coverage.score, 50);
  assert.deepEqual(reads.slice(0, 2), ["pkg/core.py", "tests/test_core.py"]);
  assert.ok(reads.filter((path) => path.endsWith("__init__.py")).length <= 2);
  assert.ok(reads.length <= defaultConfig.atlas.maxFiles);
  const assessment = assessRepository(repository, cacheTask, defaultConfig, new Date("2026-09-01"));
  assessment.accepted = true;
  const config = structuredClone(defaultConfig);
  config.slicing.maxFilesPerRepository = 4;
  const slices = await collectSlices(client, [assessment], cacheTask, config, python.selectWindow, [atlas], cache);
  assert.ok(slices.some((item) => item.path === "pkg/core.py"));
  assert.ok(slices.some((item) => item.path === "tests/test_core.py" && item.strategy === "python-ast"), "custom test oracle must not require a literal assert");
});

test("conftest, empty tests and pass-only tests cannot satisfy the actual test floor", needsPython, async () => {
  for (const testContent of ["", "def test_placeholder():\n    pass\n", 'def test_placeholder():\n    """todo"""\n    ...\n']) {
    const { repository, client } = sourceFixture({
      "core.py": "def execute():\n    return 1\n",
      "pyproject.toml": '[project]\nname = "sample"\n',
      "tests/conftest.py": "import pytest\n@pytest.fixture\ndef resource():\n    return 1\n",
      "tests/test_core.py": testContent,
    });
    const atlas = await buildRepositoryDesignAtlas(client, repository, cacheTask, defaultConfig, new Map(), python.analyze);
    assert.equal(atlas.coverage.sufficient, false);
    assert.deepEqual(atlas.coverage.missingRequiredCategories, ["test"]);
    assert.ok(!atlas.coverage.signals.some((signal) => signal.name === "test-evidence"));
  }
  assert.equal(hasTestEvidence("tests/conftest.py", "def test_fake():\n    assert True"), false);
});

test("fixture support has its own named ranking signal, not implementation or behavioral evidence", () => {
  const rank = rankPaths([{ path: "conftest.py", type: "blob", sha: "x" }], [])[0]!;
  assert.equal(rank.score, 5.5, "test-support evidence 6 minus path depth 0.5");
  assert.equal(rank.reason, "test-support evidence, not a test case");
  assert.equal(isImplementationPath("tests/conftest.py"), false);
});

test("Atlas repairs failed source/test reads within the attempt budget and never counts unread documents", needsPython, async () => {
  const { repository, reads } = sourceFixture({
    "README.md": "unreadable", "docs/architecture.md": "unreadable",
    "pyproject.toml": '[project]\nname = "sample"\n',
    "a.py": "unreadable", "z.py": "def execute():\n    return 1\n",
    "test_a.py": "unreadable", "test_z.py": "def test_execute():\n    assert True\n",
  });
  const content: Record<string, string> = { "pyproject.toml": '[project]\nname = "sample"\n', "z.py": "def execute():\n    return 1\n", "test_z.py": "def test_execute():\n    assert True\n" };
  const client = { async readTextFile(_repo: string, path: string) { reads.push(path); if (!(path in content)) throw new Error("read denied"); return content[path]!; } } as unknown as GitHubClient;
  const config = structuredClone(defaultConfig);
  config.atlas.maxFiles = 7;
  const atlas = await buildRepositoryDesignAtlas(client, repository, { task: "generic task" }, config, new Map(), python.analyze);
  assert.equal(reads.length, 7);
  assert.equal(atlas.readFailures!.length, 4);
  assert.equal(atlas.coverage.score, 50);
  assert.equal(atlas.coverage.sufficient, true);
  assert.ok(!atlas.coverage.presentCategories.includes("overview"));
  assert.ok(!atlas.coverage.presentCategories.includes("design"));
  const short = structuredClone(config);
  short.atlas.maxFiles = 2;
  const blocked = await buildRepositoryDesignAtlas(client, repository, { task: "generic task" }, short, new Map(), python.analyze);
  assert.equal(blocked.coverage.sufficient, false);
  assert.equal(blocked.coverage.score, 0);
});

test("ambiguous package prefixes cannot resolve a uniquely named child module", () => {
  const files = new Set(["pkg/__init__.py", "src/pkg/__init__.py", "src/pkg/sub.py", "test_sub.py"]);
  const item = { module: "pkg.sub", names: ["Thing"], level: 0, line: 1 };
  const roots = pythonImportRoots(files);
  assert.deepEqual(resolvePythonImport("test_sub.py", item, files, roots), { targets: [], reason: "ambiguous-package-prefix" });
  assert.equal(resolvePythonModule("pkg.sub", roots, files), undefined);
  assert.deepEqual(pythonImportTargets("test_sub.py", { ...item, module: "pkg", names: ["sub"] }, files, roots), []);
  const shadowed = new Set(["pkg.py", "pkg/sub.py"]);
  assert.equal(resolvePythonModule("pkg.sub", ["."], shadowed), undefined);
  assert.deepEqual(pythonImportTargets("test_sub.py", { ...item, module: "pkg", names: ["sub"] }, shadowed, ["."]), ["pkg.py"]);
});

test("package-only repositories stop reading redundant markers and remain below the source floor", needsPython, async () => {
  const { repository, client, reads } = sourceFixture(Object.fromEntries(Array.from({ length: 25 }, (_, i) => [`pkg/p${i}/__init__.py`, '"""empty marker"""\n'])));
  const atlas = await buildRepositoryDesignAtlas(client, repository, cacheTask, defaultConfig, new Map(), python.analyze);
  assert.equal(reads.length, 2);
  assert.equal(atlas.coverage.score, 0);
  assert.equal(atlas.coverage.sufficient, false);
});

test("import observations retain aliases, lexical scopes, type checking and fallback conditions", needsPython, async () => {
  const content = ["from typing import TYPE_CHECKING as TC", "if TC:", "    from pkg.core import Engine as E", "try:", "    import native as backend", "except ImportError:", "    import fallback as backend", "def run():", "    from pkg.core import Engine as Local", "    match mode:", "        case 'fast':", "            import native"].join("\n");
  const analysis = python.analyze({ path: "app.py", content })!;
  const conditional = analysis.imports.find((item) => item.module === "pkg.core")!;
  assert.deepEqual(conditional.aliases, [{ name: "Engine", asName: "E" }]);
  assert.deepEqual(conditional.context, ["type-checking:TC"]);
  assert.equal(conditional.scope, "module");
  assert.deepEqual(analysis.imports.find((item) => item.module === "fallback")!.context, ["except:ImportError"]);
  assert.equal(analysis.imports.find((item) => item.aliases?.[0]?.asName === "Local")!.scope, "run");
  assert.match(analysis.imports.at(-1)!.context![0]!, /^match:mode:/);
  const { repository, client } = sourceFixture({ "app.py": content, "pkg/core.py": "class Engine:\n    pass\n" });
  const atlas = await buildRepositoryDesignAtlas(client, repository, cacheTask, defaultConfig, new Map(), python.analyze);
  const edge = atlas.relations.find((item) => item.from === "app.py")!;
  assert.deepEqual(edge.context, ["type-checking:TC"]);
  assert.deepEqual(edge.aliases, conditional.aliases);
  assert.match(edge.evidence.sourceUrl, /#L3$/);
  assert.ok(atlas.unresolvedImports!.some((item) => item.module === "fallback" && item.context[0] === "except:ImportError"));
});

test("Python structural contracts include aliased protocols, abstract classes and data fields", needsPython, () => {
  const content = ["from typing import Protocol as P, TypedDict", "from dataclasses import dataclass as data", "from abc import ABC, ABCMeta, abstractmethod as abstract", "__all__ = ['Record', 'Contract']", "__all__ += ['Base']", "@data(frozen=True)", "class Record:", "    key: str", "    limit: int = 10", "    def __init__(self):", "        self.ready: bool = False", "class Contract(P[T]):", "    def write(self, value: str) -> None: ...", "class Base(ABC):", "    @abstract", "    def run(self): ...", "class MetaBase(metaclass=ABCMeta): pass", "class Shape(TypedDict):", "    name: str"].join("\n");
  const analysis = python.analyze({ path: "contracts.py", content })!;
  assert.deepEqual(analysis.exports, { names: ["Record", "Contract", "Base"], status: "static" });
  const record = analysis.symbols.find((item) => item.name === "Record")!;
  assert.deepEqual(record.traits, ["dataclass"]);
  assert.deepEqual(record.fields!.map((item) => [item.name, item.annotation, item.defaultValue, item.kind]), [["key", "str", "", "class"], ["limit", "int", "10", "class"], ["ready", "bool", "False", "instance"]]);
  assert.deepEqual(analysis.symbols.find((item) => item.name === "Contract")!.traits, ["protocol"]);
  assert.deepEqual(analysis.symbols.find((item) => item.name === "Base")!.traits, ["abstract-class"]);
  assert.deepEqual(analysis.symbols.find((item) => item.name === "Base.run")!.traits, ["abstract-method"]);
  assert.deepEqual(analysis.symbols.find((item) => item.name === "MetaBase")!.traits, ["abstract-class"]);
  assert.deepEqual(analysis.symbols.find((item) => item.name === "Shape")!.traits, ["typed-dict"]);
  for (const change of ["__all__.append('Other')", "if enabled:\n    __all__ = ['Other']", "__all__ = dynamic_exports()"])
    assert.equal(python.analyze({ path: "exports.py", content: content + "\n" + change })!.exports!.status, "dynamic");
  const shadow = python.analyze({ path: "shadow.py", content: "from typing import Protocol as P\nP = custom_base\nclass C(P): pass\n" })!;
  assert.deepEqual(shadow.symbols[0]!.traits, []);
  const late = python.analyze({ path: "late.py", content: "class C(P): pass\nfrom typing import Protocol as P\n" })!;
  assert.deepEqual(late.symbols[0]!.traits, []);
  const localExport = python.analyze({ path: "local.py", content: "__all__ = ['api']\ndef helper():\n    __all__ = ['local']\n" })!;
  assert.deepEqual(localExport.exports, { names: ["api"], status: "static" });
  const implicit = python.analyze({ path: "implicit.py", content: "from .core import Engine as API\nLIMIT = 10\n_private = 1\n" })!;
  assert.deepEqual(implicit.exports, { names: ["API", "LIMIT"], status: "implicit" });
});

test("fixtures link only lexical candidates and distinguish parametrization from injection", needsPython, () => {
  const analyses = new Map([
    ["tests/conftest.py", python.analyze({ path: "tests/conftest.py", content: "from pytest import fixture as fx\n@fx(name='store')\ndef backend():\n    return object()\n" })!],
    ["tests/test_store.py", python.analyze({ path: "tests/test_store.py", content: "import pytest as pt\n@pt.mark.parametrize('key', ['a'])\n@pt.mark.usefixtures('store')\ndef test_store(store, key, tmp_path):\n    assert store\n@pt.mark.parametrize(['store'], [1], indirect=True)\ndef test_indirect(store):\n    assert store\n" })!],
    ["other/test_store.py", python.analyze({ path: "other/test_store.py", content: "def test_store(store):\n    assert store\n" })!],
  ]);
  const links = linkPythonFixtures(analyses);
  assert.ok(!links.some((item) => item.request === "key"));
  assert.ok(links.some((item) => item.testSymbol === "test_indirect" && item.request === "store" && item.status === "candidate"));
  const local = links.find((item) => item.testPath === "tests/test_store.py" && item.request === "store")!;
  assert.equal(local.fixtureSymbol, "backend");
  assert.equal(local.fixturePath, "tests/conftest.py");
  assert.equal(links.find((item) => item.request === "tmp_path")!.status, "unresolved");
  assert.equal(links.find((item) => item.testPath.startsWith("other/"))!.status, "unresolved");
  analyses.set("conftest.py", analyses.get("tests/conftest.py")!);
  assert.ok(linkPythonFixtures(analyses).some((item) => item.reason === "ambiguous-fixture-shadowing"));
});

test("Poetry, setup.cfg and literal source roots expose partial metadata rather than false completeness", needsPython, async () => {
  const poetry = '[tool.poetry]\nname = "sample"\npackages = [{include="pkg", from="python"}]\n[tool.poetry.dependencies]\npython = ">=3.11"\nhttpx = "^0.27"\n[tool.poetry.group.test.dependencies]\npytest = "^8"\n[tool.poetry.scripts]\nsample = "pkg.core:main"\n';
  const cfg = '[metadata]\nname = legacy\n[options]\npackage_dir =\n    = python\ninstall_requires =\n    httpx>=0.27\n[options.entry_points]\nconsole_scripts =\n    legacy = pkg.core:main\n';
  for (const [path, content, format] of [["pyproject.toml", poetry, "poetry"], ["setup.cfg", cfg, "setup.cfg"]]) {
    const analysis = python.analyze({ path: path!, content: content! })!;
    assert.equal(analysis.manifest!.format, format);
    assert.equal(analysis.manifest!.completeness, "partial");
    assert.deepEqual(analysis.manifest!.importRoots, ["python"]);
    assert.deepEqual(analysis.manifest!.entryTargets, ["pkg.core:main"]);
    assert.match(analysis.manifest!.dependencies[0]!, /^httpx/);
    const { repository, client } = sourceFixture({ [path!]: content!, "python/pkg/core.py": "def main():\n    return 0\n", "tests/test_core.py": "from pkg.core import main\ndef test_main():\n    assert main() == 0\n" });
    const atlas = await buildRepositoryDesignAtlas(client, repository, cacheTask, defaultConfig, new Map(), python.analyze);
    assert.equal(atlas.manifests[0]!.parseStatus, "partial");
    assert.ok(atlas.entryPoints.some((item) => item.path === "python/pkg/core.py"));
    assert.ok(atlas.relations.some((item) => item.to === "python/pkg/core.py"));
  }
  const unknown = python.analyze({ path: "pyproject.toml", content: '[tool.unknown]\nconfig = true\n' })!;
  assert.equal(unknown.manifest!.completeness, "unsupported");
  const roots = pythonImportRoots(new Set(), [{ path: "pyproject.toml", roots: ["../outside", "/tmp", "C:\\outside", "python", "src/*"] }]);
  assert.deepEqual(roots, [".", "python", "src"]);
});
