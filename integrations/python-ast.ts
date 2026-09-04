import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import type { SourceAnalysis, SourceAnalyzer } from "../src/source-analysis.ts";
import type { SemanticSliceSelector } from "../src/slice.ts";
import { containsDomainTerm } from "../src/domain.ts";
import { isTestPath } from "../src/evidence-path.ts";

const HELPER = fileURLToPath(new URL("./python-parser.py", import.meta.url));
const SUPPORTED = /\.py$|(^|\/)(pyproject\.toml|setup\.cfg)$/i;

export function createPythonAnalysis(options: { executable?: string; timeoutMs?: number } = {}): {
  analyze: SourceAnalyzer; selectWindow: SemanticSliceSelector;
} {
  const executable = options.executable ?? process.env.IMITATOR_PYTHON ?? (process.platform === "win32" ? "python" : "python3");
  const cache = new Map<string, SourceAnalysis>();
  const analyze: SourceAnalyzer = ({ path, content }) => {
    if (!SUPPORTED.test(path)) return undefined;
    const failure = (status: SourceAnalysis["status"], message: string): SourceAnalysis => ({
      language: "python", status, parser: "python-stdlib-ast/tomllib", limitations: [message], symbols: [], imports: [],
    });
    if (content.length > 120_000) return failure("budget-exceeded", "Source exceeds 120000-character parser budget.");
    const key = createHash("sha256").update(`${path}\0${content}`).digest("hex");
    if (cache.has(key)) return cache.get(key)!;
    // The interpreter and helper are trusted local tools. Remote bytes only go
    // to stdin as JSON. -I/-S suppress cwd/PYTHONPATH/site hooks; no shell/code eval.
    const result = spawnSync(executable, ["-I", "-S", "-B", HELPER], {
      input: JSON.stringify({ path, content }), encoding: "utf8", windowsHide: true,
      timeout: Math.max(100, Math.min(5000, options.timeoutMs ?? 2000)), maxBuffer: 2_000_000,
      cwd: fileURLToPath(new URL(".", import.meta.url)),
    });
    let analysis: SourceAnalysis;
    try {
      if (result.error || result.status !== 0) throw new Error("Parser failed");
      analysis = JSON.parse(result.stdout) as SourceAnalysis;
      if (!analysis || !Array.isArray(analysis.symbols) || !Array.isArray(analysis.imports)) throw new Error("Invalid parser response");
    } catch {
      analysis = failure("unavailable", "Python 3.11+ parser unavailable, timed out, or exceeded output budget; using structural/window fallback.");
    }
    if (cache.size >= 128) cache.delete(cache.keys().next().value!);
    cache.set(key, analysis);
    return analysis;
  };
  const selectWindow: SemanticSliceSelector = ({ path, content, terms, maxLines }) => {
    if (!/\.py$/i.test(path)) return undefined;
    const analysis = analyze({ path, content });
    if (analysis?.status !== "parsed") return undefined;
    const lines = content.replace(/\r\n/g, "\n").split("\n");
    const candidates = analysis.symbols.filter((symbol) => symbol.endLine - symbol.startLine + 1 <= maxLines
      && (!isTestPath(path) || (symbol.role === "test" && symbol.kind !== "class" && symbol.hasBody !== false))).map((symbol) => {
      const selected = lines.slice(symbol.startLine - 1, symbol.endLine).join("\n");
      const nameHits = terms.filter((term) => containsDomainTerm(symbol.name, term)).length;
      const bodyHits = terms.filter((term) => containsDomainTerm(selected, term)).length;
      return { symbol, selected, score: nameHits * 8 + bodyHits * 5 };
    }).sort((a, b) => b.score - a.score || a.symbol.startLine - b.symbol.startLine || a.symbol.name.localeCompare(b.symbol.name));
    const best = candidates[0];
    if (!best) return undefined;
    return { start: best.symbol.startLine, end: best.symbol.endLine, content: best.selected,
      relevance: best.score, strategy: "python-ast", symbols: [best.symbol.name] };
  };
  return { analyze, selectWindow };
}
