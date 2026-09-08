import assert from "node:assert/strict";
import test from "node:test";
import { analyzeTypeScriptSource } from "../integrations/typescript-analysis.ts";
import { selectSupplementalSemanticWindows } from "../src/slice.ts";

test("TypeScript analysis extracts contracts, data, aliases, failures and tests without executing source", () => {
  delete (globalThis as { __imitatorExecuted?: boolean }).__imitatorExecuted;
  const content = [
    "import type { Clock as TimeSource } from './clock.js';",
    "import { fail } from './errors.js';",
    "export interface CachePolicy {",
    "  maxEntries: number;",
    "  evict(key: string): void;",
    "}",
    "export class Cache implements CachePolicy {",
    "  maxEntries: number = 10;",
    "  evict(key: string): void {",
    "    if (!key) throw new Error('missing');",
    "  }",
    "}",
    "export function guarded(): void { try { fail(); } catch (error) { throw error; } }",
    "test('evicts', () => { expect(new Cache().maxEntries).toBe(10); });",
    "(() => { (globalThis as any).__imitatorExecuted = true; })();",
  ].join("\n");
  const analysis = analyzeTypeScriptSource({ path: "test/cache.test.ts", content })!;
  assert.equal(analysis.status, "parsed");
  assert.equal(analysis.language, "typescript");
  assert.equal((globalThis as { __imitatorExecuted?: boolean }).__imitatorExecuted, undefined);
  assert.deepEqual(analysis.imports[0]!.aliases, [{ name: "Clock", asName: "TimeSource" }]);
  assert.deepEqual(analysis.imports[0]!.context, ["type-only"]);
  assert.ok(analysis.exports?.names.includes("CachePolicy"));
  assert.ok(analysis.exports?.names.includes("Cache"));
  const policy = analysis.symbols.find((symbol) => symbol.name === "CachePolicy")!;
  assert.equal(policy.fields?.[0]?.name, "maxEntries");
  const cache = analysis.symbols.find((symbol) => symbol.name === "Cache")!;
  assert.deepEqual(cache.traits, ["CachePolicy"]);
  assert.ok(analysis.symbols.some((symbol) => symbol.name === "Cache.evict" && symbol.raises.length === 1));
  assert.ok(analysis.symbols.some((symbol) => symbol.role === "test" && symbol.assertionCount === 1));

  const primary = { start: 13, end: 13, content: content.split("\n")[12]!, relevance: 20, strategy: "typescript-ast" as const, symbols: ["guarded"] };
  const supplemental = selectSupplementalSemanticWindows(analysis, content, primary, 20);
  assert.ok(supplemental.some((window) => window.symbols?.includes("CachePolicy")));
  assert.ok(supplemental.some((window) => window.symbols?.some((symbol) => symbol.startsWith("test@"))));
});

test("TypeScript analysis fails closed on syntax diagnostics and parser budgets", () => {
  const invalid = analyzeTypeScriptSource({ path: "broken.ts", content: "export interface Broken {" })!;
  assert.equal(invalid.status, "invalid");
  assert.deepEqual(invalid.symbols, []);
  const oversized = analyzeTypeScriptSource({ path: "large.ts", content: "x".repeat(120_001) })!;
  assert.equal(oversized.status, "budget-exceeded");
  assert.equal(analyzeTypeScriptSource({ path: "main.py", content: "pass" }), undefined);
});
