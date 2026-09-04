import type { SourceAnalysis } from "./source-analysis.ts";
import { isPythonPackageMarker, isTestSupportPath } from "./evidence-path.ts";

// This floor detects inspected declarations, not correctness or test adequacy.
export function hasSourceEvidence(path: string, content: string, analysis?: SourceAnalysis): boolean {
  if (!content.trim()) return false;
  if (!/\.py$/i.test(path)) return true;
  if (analysis && analysis.status !== "parsed") return false;
  if (analysis) return analysis.symbols.some((symbol) => symbol.role === "implementation");
  return !isPythonPackageMarker(path) && /^(?:async\s+)?(?:def|class)\s+\w+/m.test(content);
}

export function hasTestEvidence(path: string, content: string, analysis?: SourceAnalysis): boolean {
  if (!content.trim() || isTestSupportPath(path)) return false;
  if (!/\.py$/i.test(path)) return true;
  if (analysis && analysis.status !== "parsed") return false;
  if (analysis) return analysis.symbols.some((symbol) => symbol.role === "test" && symbol.kind !== "class" && symbol.hasBody !== false);
  // Without Python this is an explicitly conservative textual fallback.
  return /^\s*(?:async\s+)?def\s+test_\w+\s*\(/m.test(content) && /\bassert\b|\bself\.assert\w+\s*\(/.test(content);
}
