import type { HarnessConfig, TaskSpec } from "./types.ts";
import { extractTaskDomain } from "./domain.ts";

export function taskTerms(spec: TaskSpec): string[] {
  const domain = extractTaskDomain(spec);
  return [...new Set([...domain.aliases, ...domain.capabilities.flatMap((item) => item.aliases)])];
}

export function planQueries(spec: TaskSpec, config: HarnessConfig): string[] {
  const explicit = spec.queries?.map((query) => query.trim()).filter(Boolean) ?? [];
  const domain = extractTaskDomain(spec);
  const qualifiers = [`stars:>=${config.github.minimumStars}`, "archived:false", "fork:false"];
  const qualify = (query: string, language = false) => `${query} ${qualifiers.join(" ")}${language && spec.language ? ` language:${spec.language}` : ""}`;
  // Keep language a preference, not a barrier to learning cross-language designs.
  return [...new Set([
    ...explicit.map((query) => qualify(query)),
    ...(spec.language && domain.queryTerms[0] ? [qualify(domain.queryTerms[0], true)] : []),
    ...domain.queryTerms.map((query) => qualify(query)),
  ])].slice(0, 5);
}
