import type { GitHubRepository } from "./github.ts";
import { taskTerms } from "./query.ts";
import type { TaskSpec } from "./types.ts";

export type RankedCandidate = {
  repository: GitHubRepository;
  score: number;
  reasons: string[];
};

const normalize = (value: string): string => value.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/g, "");

export function rankSearchCandidates(
  batches: GitHubRepository[][],
  task: TaskSpec,
  limit: number,
): RankedCandidate[] {
  const terms = taskTerms(task);
  const anchors = terms.filter((term) => term.includes("-") || term.includes("+"));
  const accumulated = new Map<string, { repository: GitHubRepository; hits: number; reciprocalRank: number }>();
  for (const batch of batches) {
    batch.forEach((repository, index) => {
      const current = accumulated.get(repository.full_name) ?? { repository, hits: 0, reciprocalRank: 0 };
      current.hits += 1;
      current.reciprocalRank += 1 / (10 + index + 1);
      if (repository.stargazers_count > current.repository.stargazers_count) current.repository = repository;
      accumulated.set(repository.full_name, current);
    });
  }
  return [...accumulated.values()]
    .map(({ repository, hits, reciprocalRank }): RankedCandidate => {
      const metadata = normalize(`${repository.full_name} ${repository.description ?? ""} ${(repository.topics ?? []).join(" ")}`);
      const matchedTerms = terms.filter((term) => metadata.includes(normalize(term)));
      const matchedAnchors = anchors.filter((term) => metadata.includes(normalize(term)));
      const score = matchedAnchors.length * 100 + matchedTerms.length * 15 + hits * 12 + reciprocalRank * 40 + Math.log10(repository.stargazers_count + 1);
      const reasons = [
        ...(matchedAnchors.length ? [`core anchors: ${matchedAnchors.join(", ")}`] : []),
        ...(matchedTerms.length ? [`metadata terms: ${matchedTerms.join(", ")}`] : []),
        `matched ${hits} search ${hits === 1 ? "query" : "queries"}`,
        `stars used as weak signal: ${repository.stargazers_count}`,
      ];
      return { repository, score: Math.round(score * 100) / 100, reasons };
    })
    .sort((a, b) => b.score - a.score || b.repository.stargazers_count - a.repository.stargazers_count || a.repository.full_name.localeCompare(b.repository.full_name))
    .slice(0, limit);
}
