import type { SpecifiedRepository } from "./types.ts";

export const MAX_LEARNING_REPOSITORIES = 2 as const;

export function learningRepositoryLimit(configured: number): number {
  if (!Number.isFinite(configured)) return MAX_LEARNING_REPOSITORIES;
  return Math.max(1, Math.min(MAX_LEARNING_REPOSITORIES, Math.floor(configured)));
}

function normalizeName(value: string): string {
  const name = value.trim().replace(/\.git$/i, "");
  if (!/^[a-z0-9_.-]+\/[a-z0-9_.-]+$/i.test(name)) {
    throw new Error(`Invalid GitHub repository; expected owner/name: ${value}`);
  }
  return name.toLowerCase();
}

export function parseRepositorySpecifier(value: string): SpecifiedRepository {
  let input = value.trim();
  if (!input) throw new Error("Reference repository must not be empty");
  let revision: string | undefined;
  if (/^https?:\/\//i.test(input)) {
    const match = /^(https?:\/\/github\.com\/[^/]+\/[^@/?#]+)(?:@(.+))?$/i.exec(input);
    if (!match) throw new Error(`Reference URL must identify one github.com repository: ${value}`);
    input = match[1]!;
    revision = match[2]?.trim() || undefined;
    const url = new URL(input);
    if (url.hostname.toLowerCase() !== "github.com") throw new Error(`Reference URL must use github.com: ${value}`);
    if (url.username || url.password || url.search || url.hash) throw new Error(`Reference URL must not contain credentials, query, or fragment: ${value}`);
    const parts = url.pathname.split("/").filter(Boolean);
    if (parts.length !== 2) throw new Error(`Reference URL must identify one repository: ${value}`);
    input = `${parts[0]}/${parts[1]}`;
  } else {
    const at = input.indexOf("@");
    if (at >= 0) {
      revision = input.slice(at + 1).trim() || undefined;
      input = input.slice(0, at);
    }
  }
  if (revision && (revision.length > 200 || /[\0\r\n]/.test(revision))) throw new Error("Reference revision is invalid");
  return { repository: normalizeName(input), revision };
}

export function normalizeSpecifiedRepositories(values: SpecifiedRepository[] | undefined): SpecifiedRepository[] | undefined {
  if (!values?.length) return undefined;
  if (values.length > MAX_LEARNING_REPOSITORIES) {
    throw new Error(`At most ${MAX_LEARNING_REPOSITORIES} learning repositories may be specified`);
  }
  const result: SpecifiedRepository[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const parsed = parseRepositorySpecifier(`${value.repository}${value.revision ? `@${value.revision}` : ""}`);
    if (seen.has(parsed.repository)) throw new Error(`Duplicate specified repository: ${parsed.repository}`);
    seen.add(parsed.repository);
    result.push(parsed);
  }
  return result;
}
