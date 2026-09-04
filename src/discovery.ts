import type { GitHubRepository } from "./github.ts";
import { domainMetadataSignal } from "./domain.ts";
import type { TaskSpec } from "./types.ts";

export type RankedCandidate = {
  repository: GitHubRepository;
  score: number;
  reasons: string[];
};

export function rankSearchCandidates(
  batches: GitHubRepository[][],
  task: TaskSpec,
  limit: number,
): RankedCandidate[] {
  const accumulated = new Map<string, { repository: GitHubRepository; hits: number; reciprocalRank: number }>();
  for (const batch of batches) {
    const seen = new Set<string>();
    batch.forEach((repository, index) => {
      if (seen.has(repository.full_name)) return;
      seen.add(repository.full_name);
      const current = accumulated.get(repository.full_name) ?? { repository, hits: 0, reciprocalRank: 0 };
      current.hits += 1;
      current.reciprocalRank += 1 / (10 + index + 1);
      if (repository.stargazers_count > current.repository.stargazers_count) current.repository = repository;
      accumulated.set(repository.full_name, current);
    });
  }
  return [...accumulated.values()]
    .map(({ repository, hits, reciprocalRank }): RankedCandidate => {
      const domain = domainMetadataSignal(`${repository.full_name} ${repository.description ?? ""} ${(repository.topics ?? []).join(" ")}`, task);
      const score = domain.score * 10 + hits * 12 + reciprocalRank * 40 + Math.log10(repository.stargazers_count + 1);
      const reasons = [
        ...domain.reasons,
        ...(domain.matched.length ? [`core anchors: ${domain.matched.join(", ")}`] : []),
        `matched ${hits} search ${hits === 1 ? "query" : "queries"}`,
        `stars used as weak signal: ${repository.stargazers_count}`,
      ];
      return { repository, score: Math.round(score * 100) / 100, reasons };
    })
    .sort((a, b) => b.score - a.score || b.repository.stargazers_count - a.repository.stargazers_count || a.repository.full_name.localeCompare(b.repository.full_name))
    .slice(0, limit);
}
