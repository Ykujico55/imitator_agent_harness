import type { SourceLanguageAdapter, SourceRouteDecision, SourceRouter } from "../src/source-routing.ts";
import { createPythonAnalysis } from "./python-ast.ts";
import { createRustAnalysis } from "./rust-syntax.ts";
import { selectTypeScriptAstWindow } from "./typescript-ast.ts";

const PYTHON_SOURCE = /\.py$/i;
const PYTHON_MANIFEST = /(^|\/)(pyproject\.toml|setup\.cfg)$/i;
const RUST_SOURCE = /\.rs$/i;
const RUST_MANIFEST = /(^|\/)Cargo\.toml$/i;
const TYPESCRIPT_SOURCE = /\.[cm]?[jt]sx?$/i;

function normalizePath(path: string): string {
  return path.replace(/\\/g, "/");
}

function fallbackDecision(reason = "no-matching-language-adapter"): SourceRouteDecision {
  return {
    selectedAnalyzer: "structural-fallback",
    routeReason: reason,
    selectionStatus: reason.startsWith("ambiguous-language-adapters:") ? "ambiguous" : "structural-fallback",
    capabilities: [],
    fallback: "line-window",
  };
}

/**
 * Builds a fail-closed file router. Exactly one adapter must claim a path.
 * Unsupported and ambiguous paths use the core's deterministic structural/line fallback.
 */
export function createSourceRouter(adapters: readonly SourceLanguageAdapter[]): SourceRouter {
  const ids = new Set<string>();
  for (const adapter of adapters) {
    if (!adapter.id.trim()) throw new Error("Source adapter IDs must be non-empty");
    if (ids.has(adapter.id)) throw new Error(`Duplicate source adapter ID: ${adapter.id}`);
    ids.add(adapter.id);
    if (!adapter.analyze && !adapter.selectWindow) throw new Error(`Source adapter ${adapter.id} has no capability`);
  }

  const matched = (rawPath: string): Array<{ adapter: SourceLanguageAdapter; reason: string }> => {
    const path = normalizePath(rawPath);
    return adapters.flatMap((adapter) => {
      const reason = adapter.match(path);
      return reason ? [{ adapter, reason }] : [];
    });
  };

  const resolve = ({ path }: { path: string }): SourceRouteDecision => {
    const matches = matched(path);
    if (matches.length === 0) return fallbackDecision();
    if (matches.length > 1) return fallbackDecision(`ambiguous-language-adapters:${matches.map((item) => item.adapter.id).sort().join(",")}`);
    const { adapter, reason } = matches[0]!;
    const capabilities = [
      ...(adapter.analyze ? ["syntax-analysis" as const] : []),
      ...(adapter.selectWindow ? ["semantic-slicing" as const] : []),
    ];
    return {
      selectedAnalyzer: adapter.id,
      routeReason: reason,
      selectionStatus: "enhanced",
      capabilities,
      fallback: adapter.selectWindow ? "line-window-on-no-semantic-window" : "line-window",
      ...(adapter.analysisLanguage ? { analysisLanguage: adapter.analysisLanguage } : {}),
    };
  };

  return {
    resolve,
    analyze(input) {
      const matches = matched(input.path);
      if (matches.length !== 1) return undefined;
      return matches[0]!.adapter.analyze?.(input);
    },
    selectWindow(input) {
      const matches = matched(input.path);
      if (matches.length !== 1) return undefined;
      return matches[0]!.adapter.selectWindow?.(input);
    },
  };
}

export function createDefaultSourceRouter(options: {
  python?: ReturnType<typeof createPythonAnalysis>;
  rust?: ReturnType<typeof createRustAnalysis>;
  typescriptSelector?: typeof selectTypeScriptAstWindow;
  additionalAdapters?: readonly SourceLanguageAdapter[];
} = {}): SourceRouter {
  const python = options.python ?? createPythonAnalysis();
  const rust = options.rust ?? createRustAnalysis();
  return createSourceRouter([
    {
      id: "python-stdlib-ast",
      analysisLanguage: "python",
      match: (path) => PYTHON_SOURCE.test(path) ? "extension:.py" : PYTHON_MANIFEST.test(path) ? "python-manifest" : undefined,
      analyze: python.analyze,
      selectWindow: python.selectWindow,
    },
    {
      id: "rust-static-syntax",
      analysisLanguage: "rust",
      match: (path) => RUST_SOURCE.test(path) ? "extension:.rs" : RUST_MANIFEST.test(path) ? "rust-manifest" : undefined,
      analyze: rust.analyze,
      selectWindow: rust.selectWindow,
    },
    {
      id: "typescript-compiler-ast",
      match: (path) => TYPESCRIPT_SOURCE.test(path) ? "extension:typescript-javascript-family" : undefined,
      selectWindow: options.typescriptSelector ?? selectTypeScriptAstWindow,
    },
    ...(options.additionalAdapters ?? []),
  ]);
}
