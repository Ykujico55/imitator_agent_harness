import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";
import { scanVisualWorkspace } from "../integrations/visual-workspace.ts";
import {
  analyzeVisualSources,
  auditVisualInventory,
  buildVisualSpec,
  getVisualStyleProfile,
  listVisualStyleProfiles,
  renderVisualSpec,
  routeVisualTask,
} from "../src/visual.ts";

test("visual task routing uses named signals and leaves backend or logic-only work alone", () => {
  const dashboard = routeVisualTask({
    task: "Build a responsive React analytics dashboard",
    purpose: "analytics dashboard",
    capabilities: ["metric exploration"],
    language: "TypeScript",
  });
  assert.equal(dashboard.route, "visual-style");
  assert.equal(dashboard.score, 100);
  assert.equal(dashboard.archetypeId, "data-console");
  assert.deepEqual(dashboard.signals.map((signal) => signal.name), [
    "explicit-visual-language", "user-facing-surface", "frontend-stack",
  ]);

  const logicOnly = routeVisualTask({
    task: "Fix a React state synchronization race without changing rendering",
    purpose: "state synchronization",
    capabilities: ["race prevention"],
  });
  assert.equal(logicOnly.route, "software-precedent");
  assert.equal(logicOnly.score, 20);

  const backend = routeVisualTask({
    task: "Implement bounded retries for a durable job queue",
    purpose: "job queue",
    capabilities: ["retry failed jobs"],
  });
  assert.equal(backend.route, "software-precedent");
  assert.equal(backend.score, 0);

  const marketing = routeVisualTask({
    task: "Create a polished landing page for a developer product",
    purpose: "developer product landing page",
    capabilities: ["explain value"],
  });
  assert.equal(marketing.route, "visual-style");
  assert.equal(marketing.score, 50);
  assert.equal(marketing.signals.find((signal) => signal.name === "visual-quality-requirement")?.points, 20);

  const excludedOnly = routeVisualTask({
    task: "Implement bounded retries for a durable job queue",
    purpose: "job queue",
    capabilities: ["retry failed jobs"],
    avoid: ["do not build a dashboard"],
  });
  assert.equal(excludedOnly.route, "software-precedent");
  assert.equal(excludedOnly.score, 0);
});

test("bundled visual profiles are deterministic independent copies", () => {
  const profiles = listVisualStyleProfiles();
  assert.equal(profiles.length, 6);
  assert.deepEqual(profiles.map((profile) => profile.id), [
    "calm-product", "commerce-catalog", "data-console", "editorial-docs", "expressive-marketing", "productivity-editor",
  ]);
  const first = getVisualStyleProfile("calm-product");
  first.avoid.push("test mutation");
  assert.ok(!getVisualStyleProfile("calm-product").avoid.includes("test mutation"));
});

test("static visual analysis detects black boxes, repeated rounding, weak type, and missing responsive evidence", () => {
  const repeated = Array.from({ length: 7 }, (_, index) => `.card-${index} { border: 1px solid #333; border-radius: 12px; }`).join("\n");
  const inventory = analyzeVisualSources([{ path: "src/app.css", content: `
    :root { --bg: #000000; }
    body { background: var(--bg); color: #eee; font-size: 14px; }
    ${repeated}
  ` }]);
  assert.match(inventory.pureBlackBackgrounds[0]?.value ?? "", /--bg.*#000000/);
  assert.equal(inventory.radii[0]?.count, 7);
  const audit = auditVisualInventory(inventory, getVisualStyleProfile("calm-product"));
  assert.equal(audit.status, "blocked");
  assert.ok(audit.findings.some((item) => item.signal === "pure-black-surface" && item.severity === "error"));
  assert.ok(audit.findings.some((item) => item.signal === "uniform-radius-repetition"));
  assert.ok(audit.findings.some((item) => item.signal === "weak-type-hierarchy"));
  assert.ok(audit.findings.some((item) => item.signal === "responsive-evidence-missing"));
});

test("near-black Tailwind surfaces are reported separately from exact black", () => {
  const inventory = analyzeVisualSources([{ path: "src/Page.tsx", content: `<main className="bg-zinc-950 text-sm">content</main>` }]);
  assert.equal(inventory.pureBlackBackgrounds.length, 0);
  assert.equal(inventory.nearBlackBackgrounds[0]?.value, "bg-zinc-950");
  const audit = auditVisualInventory(inventory, getVisualStyleProfile("calm-product"));
  assert.ok(audit.findings.some((item) => item.signal === "near-black-surface" && item.severity === "warning"));
});

test("a restrained tokenized responsive stylesheet avoids configured anti-pattern findings", () => {
  const inventory = analyzeVisualSources([{ path: "src/theme.css", content: `
    :root { --canvas: #f6f5f1; --surface: #fffefa; --ink: #20231f; --accent: #4f5d95; }
    body { background: var(--canvas); color: var(--ink); font-size: 15px; }
    h1 { font-size: 48px; }
    h2 { font-size: 34px; }
    small { font-size: 13px; }
    button { background: var(--accent); border-radius: 10px; }
    section { background: var(--surface); border-radius: 4px; }
    @media (max-width: 700px) { h1 { font-size: 34px; } }
  ` }]);
  const audit = auditVisualInventory(inventory, getVisualStyleProfile("calm-product"));
  assert.equal(audit.status, "clean");
  assert.deepEqual(audit.findings, []);
});

test("visual spec is compact, explicit about provenance, and requires a post-implementation audit", () => {
  const route = routeVisualTask({
    task: "Create a polished landing page for a developer product",
    purpose: "developer product landing page",
    capabilities: ["explain value", "convert visitors"],
  });
  const spec = buildVisualSpec(route, analyzeVisualSources([]));
  const rendered = renderVisualSpec(spec);
  assert.equal(spec.profile.id, "expressive-marketing");
  assert.match(rendered, /bundled-curated-seed/);
  assert.match(rendered, /imitator_visual_audit/);
  assert.match(rendered, /generic centered hero plus three cards/);
  assert.ok(rendered.length <= 6_000);
});

test("workspace visual scanning is bounded and excludes dependencies and unrelated backend code", async (t) => {
  const cwd = await mkdtemp(resolve(tmpdir(), "imitator-visual-scan-"));
  t.after(async () => rm(cwd, { recursive: true, force: true }));
  await mkdir(resolve(cwd, "src"), { recursive: true });
  await mkdir(resolve(cwd, "node_modules", "dependency"), { recursive: true });
  await writeFile(resolve(cwd, "src", "app.css"), "body { color: #222; }", "utf8");
  await writeFile(resolve(cwd, "src", "Page.tsx"), "export const Page = () => <main className=\"page\" />;", "utf8");
  await writeFile(resolve(cwd, "src", "server.ts"), "export const port = 3000;", "utf8");
  await writeFile(resolve(cwd, "node_modules", "dependency", "bad.css"), "body { background: #000; }", "utf8");
  const scan = await scanVisualWorkspace(cwd);
  assert.deepEqual(scan.files.map((file) => file.path), ["src/Page.tsx", "src/app.css"]);
});

test("workspace visual scanning bounds traversal before reading an unbounded candidate set", async (t) => {
  const cwd = await mkdtemp(resolve(tmpdir(), "imitator-visual-budget-"));
  t.after(async () => rm(cwd, { recursive: true, force: true }));
  await mkdir(resolve(cwd, "src"), { recursive: true });
  await writeFile(resolve(cwd, "src", "a.css"), "body { color: #111; }", "utf8");
  await writeFile(resolve(cwd, "src", "b.css"), "body { color: #222; }", "utf8");
  const scan = await scanVisualWorkspace(cwd, {
    maximumFiles: 48,
    maximumCharacters: 160_000,
    maximumCharactersPerFile: 40_000,
    maximumVisitedEntries: 20,
    maximumCandidates: 1,
  });
  assert.deepEqual(scan.files.map((file) => file.path), ["src/a.css"]);
  assert.ok(scan.skipped.some((item) => item.path === "src/b.css" && item.reason === "maximum-candidates-reached"));
});
