import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { GitHubClient, GitHubRepository } from "./github.ts";
import type { HarnessConfig, ReferencePack, RepositoryProfile, TaskSpec } from "./types.ts";
import { planQueries } from "./query.ts";
import { assessRepository } from "./score.ts";
import { collectSlices } from "./slice.ts";
import { inferPractices, renderAgentContext, renderReference } from "./render.ts";

async function mapLimited<T, R>(items: T[], concurrency: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await fn(items[index]!);
    }
  });
  await Promise.all(workers);
  return results;
}

export async function prepareReferencePack(client: GitHubClient, task: TaskSpec, config: HarnessConfig): Promise<ReferencePack> {
  const queries = planQueries(task, config);
  if (!queries.length) throw new Error("Could not derive a GitHub query; pass --query explicitly.");
  const batches = await mapLimited(queries, 3, (query) => client.searchRepositories(query, config.github.candidateLimit));
  const unique = new Map<string, GitHubRepository>();
  for (const repository of batches.flat()) unique.set(repository.full_name, repository);
  const candidates = [...unique.values()].sort((a, b) => b.stargazers_count - a.stargazers_count).slice(0, config.github.inspectLimit);
  const profileResults = await mapLimited(candidates, 3, async (candidate): Promise<RepositoryProfile | null> => {
    try { return await client.profile(candidate); } catch { return null; }
  });
  const assessments = profileResults.filter((profile): profile is RepositoryProfile => profile !== null)
    .map((profile) => assessRepository(profile, task, config))
    .sort((a, b) => Number(b.accepted) - Number(a.accepted) || b.overall - a.overall || a.repository.fullName.localeCompare(b.repository.fullName));
  const slices = await collectSlices(client, assessments, task, config);
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    task, queries, assessments, slices,
    practices: inferPractices({ assessments, slices }),
  };
}

export async function writeReferencePack(pack: ReferencePack, outputRoot: string): Promise<string> {
  const stamp = pack.generatedAt.replace(/[:.]/g, "-");
  const directory = resolve(outputRoot, stamp);
  await mkdir(directory, { recursive: true });
  await Promise.all([
    writeFile(resolve(directory, "manifest.json"), `${JSON.stringify(pack, null, 2)}\n`, "utf8"),
    writeFile(resolve(directory, "REFERENCE.md"), renderReference(pack), "utf8"),
    writeFile(resolve(directory, "AGENT_CONTEXT.md"), renderAgentContext(pack), "utf8"),
  ]);
  return directory;
}
