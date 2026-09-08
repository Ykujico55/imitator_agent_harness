import type { SemanticSliceSelector } from "./slice.ts";
import type { SourceAnalysis, SourceAnalyzer } from "./source-analysis.ts";

export type SourceRouteCapability = "syntax-analysis" | "semantic-slicing";

/** Deterministic, path-based selection. It does not claim that parsing succeeded. */
export type SourceRouteDecision = {
  selectedAnalyzer: string;
  routeReason: string;
  selectionStatus: "enhanced" | "structural-fallback" | "ambiguous";
  capabilities: SourceRouteCapability[];
  fallback: "line-window" | "line-window-on-no-semantic-window";
  analysisLanguage?: SourceAnalysis["language"];
};

export type SourceRouteResolver = (input: { path: string }) => SourceRouteDecision;

/** Extension slot for a language-specific, non-executing static analyzer. */
export type SourceLanguageAdapter = {
  id: string;
  analysisLanguage?: SourceAnalysis["language"];
  /** Return a stable named reason when this adapter owns the path. */
  match(path: string): string | undefined;
  analyze?: SourceAnalyzer;
  selectWindow?: SemanticSliceSelector;
};

export type SourceRouter = {
  analyze: SourceAnalyzer;
  selectWindow: SemanticSliceSelector;
  resolve: SourceRouteResolver;
};

export type AtlasSourceRoute = SourceRouteDecision & {
  analysisStatus: SourceAnalysis["status"] | "not-applicable" | "not-produced";
};

export type SliceSourceRoute = SourceRouteDecision & {
  outcome: "semantic-window" | "line-window-fallback";
};
