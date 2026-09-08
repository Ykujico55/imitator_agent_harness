import type { SourceAnalysis } from "./source-analysis.ts";
import { isPythonPackageMarker, isTestSupportPath } from "./evidence-path.ts";

// Modality coverage and semantic strength are deliberately separate. A parser
// failure lowers analysis quality but does not erase completely read textual
// evidence. These conservative fallbacks still reject empty package markers,
// support-only files, and placeholder tests.
export function hasSourceEvidence(path: string, content: string, analysis?: SourceAnalysis): boolean {
  if (!content.trim()) return false;
  if (/\.rs$/i.test(path)) {
    if (analysis?.status === "parsed" && analysis.language === "rust") return analysis.symbols.some((symbol) => symbol.role === "implementation" && symbol.kind !== "module");
    return /^(?:\s*pub(?:\([^)]*\))?\s+)?(?:struct|enum|trait|impl|fn|type|const|static)\b/m.test(content);
  }
  if (!/\.py$/i.test(path)) return true;
  if (analysis?.status === "parsed" && analysis.language === "python") return analysis.symbols.some((symbol) => symbol.role === "implementation");
  return !isPythonPackageMarker(path) && /^(?:async\s+)?(?:def|class)\s+\w+/m.test(content);
}

export function hasTestEvidence(path: string, content: string, analysis?: SourceAnalysis): boolean {
  if (!content.trim() || isTestSupportPath(path)) return false;
  if (/\.rs$/i.test(path)) {
    if (analysis?.status === "parsed" && analysis.language === "rust") return analysis.symbols.some((symbol) => symbol.role === "test" && symbol.hasBody !== false);
    return /#\s*\[\s*(?:\w+::)*test\s*\][\s\S]{0,500}?\bfn\s+\w+/.test(content) && /\b(?:assert|assert_eq|assert_ne|debug_assert)\s*!/.test(content);
  }
  if (!/\.py$/i.test(path)) return true;
  if (analysis?.status === "parsed" && analysis.language === "python") return analysis.symbols.some((symbol) => symbol.role === "test" && symbol.kind !== "class" && symbol.hasBody !== false);
  // Without a successful Python parse this is an explicitly conservative textual fallback.
  return /^\s*(?:async\s+)?def\s+test_\w+\s*\(/m.test(content) && /\bassert\b|\bself\.assert\w+\s*\(/.test(content);
}
