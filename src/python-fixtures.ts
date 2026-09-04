import { posix } from "node:path";
import type { RepositoryDesignAtlas } from "./types.ts";
import type { SourceAnalysis } from "./source-analysis.ts";

/** Static lexical fixture candidates, never pytest runtime resolution. */
export function linkPythonFixtures(analyses: Map<string, SourceAnalysis>): NonNullable<RepositoryDesignAtlas["fixtureRelations"]> {
  const fixtures = [...analyses].flatMap(([path, analysis]) => analysis.symbols.filter((symbol) => symbol.role === "fixture").map((symbol) => ({ path, symbol })));
  const links: NonNullable<RepositoryDesignAtlas["fixtureRelations"]> = [];
  for (const [path, analysis] of analyses) for (const symbol of analysis.symbols.filter((item) => item.role === "test" || item.role === "fixture")) {
    for (const request of symbol.fixtureRequests ?? []) {
      if (links.length >= 200) return links;
      const visible = fixtures.filter((item) => {
        if ((item.symbol.fixtureName || item.symbol.name.split(".").at(-1)) !== request) return false;
        const fixtureScope = item.symbol.name.split(".").slice(0, -1).join(".");
        const testScope = symbol.name.split(".").slice(0, -1).join(".");
        if (item.path === path) return !fixtureScope || fixtureScope === testScope;
        const directory = posix.dirname(item.path);
        return posix.basename(item.path) === "conftest.py" && !fixtureScope && (directory === "." || path.startsWith(`${directory}/`));
      });
      // Do not guess fixture shadowing or plugin loading order.
      const match = visible.length === 1 ? visible[0] : undefined;
      links.push({ testPath: path, testSymbol: symbol.name, request,
        status: match ? "candidate" : "unresolved", fixturePath: match?.path, fixtureSymbol: match?.symbol.name,
        reason: match ? "lexically-visible-fixture; runtime injection not verified" : visible.length ? "ambiguous-fixture-shadowing" : "fixture-not-inspected-or-external-plugin" });
    }
  }
  return links;
}
