import { createHash } from "node:crypto";
import type { EvidenceSlice, HarnessConfig, RepositoryAssessment, TaskSpec, TreeEntry } from "./types.ts";
import type { GitHubClient } from "./github.ts";
import { taskTerms } from "./query.ts";

const EXCLUDED = /(^|\/)(node_modules|vendor|dist|build|coverage|fixtures?|snapshots?|generated|\.vscode|\.idea|\.agents)(\/|$)|(^|\/)(AGENTS|CLAUDE)\.md$|^\.github\/(copilot-instructions|instructions)(\/|\.|$)|\.(lock|min\.(js|css)|map|png|jpe?g|gif|pdf|zip|wasm)$|\.i18n\.ya?ml$/i;
const TEXT_FILE = /(^|\/)(README|ARCHITECTURE|DESIGN|CONTRIBUTING|SECURITY)(\.[^/]*)?$|\.(md|mdx|ts|tsx|js|jsx|py|rs|go|java|kt|rb|toml|ya?ml|json)$/i;
const DESIGN_PATH = /(^|\/)(architecture|design|adr)(\/|\.|$)|(^|\/)(rfcs?)(\/|$)|(^|\/)(RFC-\d+|ADR-\d+)[^/]*\.md$/i;

export function rankPaths(tree: TreeEntry[], terms: string[]): Array<{ entry: TreeEntry; score: number; reason: string }> {
  return tree
    .filter((entry) => entry.type === "blob" && TEXT_FILE.test(entry.path) && !EXCLUDED.test(entry.path) && (entry.size ?? 0) < 120_000)
    .map((entry) => {
      const path = entry.path.toLowerCase();
      const matches = terms.filter((term) => path.includes(term.toLowerCase()));
      let score = matches.length * 20;
      const reasons: string[] = [];
      if (matches.length) reasons.push(`path matches ${matches.join(", ")}`);
      if (DESIGN_PATH.test(path)) { score += 35; reasons.push("design documentation"); }
      if (/^readme/i.test(path)) { score += 28; reasons.push("project overview"); }
      if (/(^|\/)(examples?|samples?)(\/|$)/i.test(path)) { score += 18; reasons.push("usage example"); }
      if (/(^|\/)(test|tests|spec|__tests__)(\/|$)/i.test(path)) { score += 12; reasons.push("behavioral evidence"); }
      if (/(^|\/)(src|lib|packages)(\/|$)/i.test(path)) { score += 8; reasons.push("implementation source"); }
      score -= path.split("/").length * 0.5;
      return { entry, score, reason: reasons.join("; ") || "representative source" };
    })
    .filter((candidate) => candidate.score >= 5)
    .sort((a, b) => b.score - a.score || a.entry.path.localeCompare(b.entry.path));
}

function evidenceBucket(path: string): string {
  if (DESIGN_PATH.test(path)) return "design";
  if (/(^|\/)(test|tests|spec|__tests__)(\/|$)/i.test(path)) return "test";
  if (/(^|\/)(examples?|samples?)(\/|$)/i.test(path)) return "example";
  if (/^readme/i.test(path)) return "readme";
  if (/(^|\/)(src|lib|packages)(\/|$)/i.test(path)) return "source";
  return "other";
}

function pathFamily(path: string): string {
  return path.toLowerCase()
    .replace(/([._-])(zh(?:-cn)?|en|i18n)(?=\.)/g, "")
    .replace(/([_-])zh(?=\.)/g, "")
    .replace(/\.(mdx?|ya?ml|json)$/, "");
}

function diversifyPaths(
  ranked: ReturnType<typeof rankPaths>,
  limit: number,
): ReturnType<typeof rankPaths> {
  const caps: Record<string, number> = {
    design: Math.max(2, Math.ceil(limit * 0.2)),
    test: Math.max(2, Math.ceil(limit * 0.25)),
    example: Math.max(1, Math.ceil(limit * 0.15)),
    readme: 1,
    source: Math.max(2, Math.ceil(limit * 0.45)),
    other: Math.max(1, Math.ceil(limit * 0.1)),
  };
  const counts: Record<string, number> = {};
  const families = new Set<string>();
  const selected: ReturnType<typeof rankPaths> = [];
  for (const candidate of ranked) {
    const bucket = evidenceBucket(candidate.entry.path);
    const family = pathFamily(candidate.entry.path);
    if (families.has(family) || (counts[bucket] ?? 0) >= (caps[bucket] ?? 1)) continue;
    families.add(family);
    counts[bucket] = (counts[bucket] ?? 0) + 1;
    selected.push(candidate);
    if (selected.length >= limit) break;
  }
  return selected;
}

function bestWindow(content: string, terms: string[], maxLines: number): { start: number; end: number; content: string; relevance: number } {
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  if (lines.length <= maxLines) return { start: 1, end: lines.length, content: lines.join("\n"), relevance: 1 };
  let bestStart = 0;
  let bestScore = -1;
  for (let start = 0; start < lines.length; start += Math.max(10, Math.floor(maxLines / 2))) {
    const window = lines.slice(start, start + maxLines).join("\n").toLowerCase();
    const termScore = terms.reduce((sum, term) => sum + (window.includes(term.toLowerCase()) ? 4 : 0), 0);
    const structureScore = (window.match(/\b(interface|class|type|function|def|trait|struct|test|describe|example|architecture)\b/g) ?? []).length;
    const score = termScore + Math.min(12, structureScore);
    if (score > bestScore) { bestScore = score; bestStart = start; }
  }
  const selected = lines.slice(bestStart, bestStart + maxLines);
  return { start: bestStart + 1, end: bestStart + selected.length, content: selected.join("\n"), relevance: bestScore };
}

export async function collectSlices(client: GitHubClient, assessments: RepositoryAssessment[], task: TaskSpec, config: HarnessConfig): Promise<EvidenceSlice[]> {
  const terms = taskTerms(task);
  const slices: EvidenceSlice[] = [];
  let characters = 0;
  for (const assessment of assessments.filter((item) => item.accepted).slice(0, config.slicing.maxRepositories)) {
    const repo = assessment.repository;
    const ranked = diversifyPaths(rankPaths(repo.tree, terms), config.slicing.maxFilesPerRepository);
    for (const candidate of ranked) {
      if (slices.length >= config.slicing.maxSlices || characters >= config.slicing.maxTotalCharacters) return slices;
      try {
        const text = await client.readTextFile(repo.fullName, candidate.entry.path, repo.resolvedRevision);
        if (text.includes("\0")) continue;
        const window = bestWindow(text, terms, config.slicing.maxLinesPerSlice);
        const remaining = config.slicing.maxTotalCharacters - characters;
        if (remaining < 200) return slices;
        const content = window.content.slice(0, remaining);
        characters += content.length;
        const id = createHash("sha256")
          .update(`${repo.fullName}\0${repo.resolvedRevision}\0${candidate.entry.path}\0${window.start}\0${window.end}`)
          .digest("hex")
          .slice(0, 16);
        slices.push({
          id,
          repository: repo.fullName,
          repositoryUrl: repo.htmlUrl,
          license: repo.license,
          commitish: repo.resolvedRevision,
          path: candidate.entry.path,
          startLine: window.start,
          endLine: window.end,
          sourceUrl: `${repo.htmlUrl}/blob/${encodeURIComponent(repo.resolvedRevision)}/${candidate.entry.path.split("/").map(encodeURIComponent).join("/")}#L${window.start}-L${window.end}`,
          relevance: Math.round(candidate.score + window.relevance),
          reason: candidate.reason,
          content,
        });
      } catch {
        // A single unreadable, moved, or oversized file must not fail the reference run.
      }
    }
  }
  return slices;
}
