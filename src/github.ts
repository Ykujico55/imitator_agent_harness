import type { RepositoryProfile, TreeEntry } from "./types.ts";

export type GitHubRepository = {
  full_name: string;
  html_url: string;
  description: string | null;
  stargazers_count: number;
  forks_count: number;
  open_issues_count: number;
  size: number;
  archived: boolean;
  fork: boolean;
  default_branch: string;
  pushed_at: string;
  created_at: string;
  license: { spdx_id?: string } | null;
  language: string | null;
  topics?: string[];
};

export class GitHubError extends Error {
  readonly status?: number;

  constructor(message: string, status?: number) {
    super(message);
    this.name = "GitHubError";
    this.status = status;
  }
}

function repositoryParts(fullName: string): [string, string] {
  if (!/^[a-z0-9_.-]+\/[a-z0-9_.-]+$/i.test(fullName)) throw new GitHubError(`Invalid repository name: ${fullName}`);
  return fullName.split("/") as [string, string];
}

function validRepository(value: unknown): value is GitHubRepository {
  if (typeof value !== "object" || value === null) return false;
  const item = value as Record<string, unknown>;
  const strings = ["full_name", "html_url", "default_branch", "pushed_at", "created_at"];
  const numbers = ["stargazers_count", "forks_count", "open_issues_count", "size"];
  let validUrl = false;
  try {
    const url = new URL(String(item.html_url));
    validUrl = (url.protocol === "https:" || url.protocol === "http:") && !url.username && !url.password;
  } catch { /* invalid URL */ }
  return strings.every((key) => typeof item[key] === "string" && String(item[key]).length > 0)
    && /^[a-z0-9_.-]+\/[a-z0-9_.-]+$/i.test(String(item.full_name))
    && validUrl && !Number.isNaN(Date.parse(String(item.pushed_at))) && !Number.isNaN(Date.parse(String(item.created_at)))
    && numbers.every((key) => typeof item[key] === "number" && Number.isFinite(item[key]) && Number(item[key]) >= 0)
    && typeof item.archived === "boolean" && typeof item.fork === "boolean"
    && (item.description === null || typeof item.description === "string")
    && (item.language === null || typeof item.language === "string")
    && (item.topics === undefined || (Array.isArray(item.topics) && item.topics.every((topic) => typeof topic === "string")))
    && (item.license === null || (typeof item.license === "object" && !Array.isArray(item.license)
      && ((item.license as Record<string, unknown>).spdx_id === undefined || typeof (item.license as Record<string, unknown>).spdx_id === "string")));
}

export class GitHubClient {
  readonly #fetch: typeof fetch;
  readonly #token?: string;
  readonly #apiBase: string;

  constructor(options: { token?: string; fetchImpl?: typeof fetch; apiBase?: string } = {}) {
    this.#fetch = options.fetchImpl ?? fetch;
    this.#token = options.token;
    this.#apiBase = options.apiBase ?? "https://api.github.com";
  }

  async #json<T>(path: string): Promise<T> {
    const response = await this.#fetch(`${this.#apiBase}${path}`, {
      headers: {
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "imitator-agent-harness/0.8",
        ...(this.#token ? { Authorization: `Bearer ${this.#token}` } : {}),
      },
    });
    if (!response.ok) {
      const hint = response.headers.get("x-ratelimit-remaining") === "0"
        ? " GitHub rate limit exhausted; set GITHUB_TOKEN."
        : "";
      throw new GitHubError(`GitHub API ${response.status} for ${path}.${hint}`, response.status);
    }
    return response.json() as Promise<T>;
  }

  async searchRepositories(query: string, limit: number): Promise<GitHubRepository[]> {
    if (typeof query !== "string" || !query.trim() || query.length > 2_000 || /[\0\r\n]/.test(query)) throw new GitHubError("Invalid GitHub repository query");
    const boundedLimit = typeof limit === "number" && Number.isFinite(limit) ? Math.max(1, Math.min(Math.floor(limit), 100)) : 1;
    const result = await this.#json<{ items?: unknown }>(
      `/search/repositories?q=${encodeURIComponent(query)}&sort=stars&order=desc&per_page=${boundedLimit}`,
    );
    if (!Array.isArray(result.items) || !result.items.every(validRepository)) throw new GitHubError("Malformed GitHub repository search response");
    return result.items;
  }

  async getRepository(fullName: string): Promise<GitHubRepository> {
    const [owner, name] = repositoryParts(fullName);
    const result: unknown = await this.#json(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`);
    if (!validRepository(result)) throw new GitHubError(`Malformed GitHub repository response for ${fullName}`);
    return result;
  }

  async profile(repository: GitHubRepository, requestedRevision?: string): Promise<RepositoryProfile> {
    if (!validRepository(repository)) throw new GitHubError("Malformed GitHub repository metadata");
    const [owner, name] = repositoryParts(repository.full_name);
    const revision = requestedRevision ?? repository.default_branch;
    if (!revision || revision.length > 200 || /[\0\r\n]/.test(revision)) throw new GitHubError(`Invalid repository revision: ${revision}`);
    const commit = await this.#json<{ sha: string }>(
      `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/commits/${encodeURIComponent(revision)}`,
    );
    if (typeof commit.sha !== "string" || !commit.sha || commit.sha.length > 200 || /[\0\r\n]/.test(commit.sha)) {
      throw new GitHubError(`Malformed GitHub commit response for ${repository.full_name}`);
    }
    const result = await this.#json<{
      sha: string;
      tree: Array<{ path: string; type: string; sha: string; size?: number }>;
      truncated?: boolean;
    }>(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/git/trees/${encodeURIComponent(commit.sha)}?recursive=1`);
    if (result.truncated) throw new GitHubError(`GitHub tree for ${repository.full_name}@${commit.sha} is truncated; repository coverage cannot be established`);
    if (!Array.isArray(result.tree) || !result.tree.every((entry) => entry && typeof entry === "object"
      && typeof entry.path === "string" && typeof entry.type === "string" && typeof entry.sha === "string"
      && (entry.size === undefined || typeof entry.size === "number" && Number.isFinite(entry.size) && entry.size >= 0))) {
      throw new GitHubError(`Malformed GitHub tree response for ${repository.full_name}`);
    }
    const tree: TreeEntry[] = result.tree
      .filter((entry): entry is typeof entry & { type: "blob" | "tree" } => (entry.type === "blob" || entry.type === "tree")
        && typeof entry.path === "string" && typeof entry.sha === "string")
      .map((entry) => ({ path: entry.path, type: entry.type, sha: entry.sha, size: entry.size }));
    return {
      fullName: repository.full_name,
      htmlUrl: repository.html_url,
      description: repository.description ?? "",
      stars: repository.stargazers_count,
      forks: repository.forks_count,
      openIssues: repository.open_issues_count,
      sizeKb: repository.size,
      archived: repository.archived,
      fork: repository.fork,
      defaultBranch: repository.default_branch,
      resolvedRevision: commit.sha,
      pushedAt: repository.pushed_at,
      createdAt: repository.created_at,
      license: repository.license?.spdx_id && repository.license.spdx_id !== "NOASSERTION" ? repository.license.spdx_id : null,
      language: repository.language,
      topics: repository.topics ?? [],
      tree,
    };
  }

  async readTextFile(fullName: string, path: string, ref: string): Promise<string> {
    const [owner, name] = repositoryParts(fullName);
    if (!path || path.startsWith("/") || path.includes("\\") || path.split("/").some((part) => !part || part === "." || part === "..") || /[\0\r\n]/.test(path)) {
      throw new GitHubError(`Invalid repository path: ${path}`);
    }
    if (!ref || ref.length > 200 || /[\0\r\n]/.test(ref)) throw new GitHubError(`Invalid repository revision: ${ref}`);
    const encodedPath = path.split("/").map(encodeURIComponent).join("/");
    const result = await this.#json<{ content?: string; encoding?: string }>(
      `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/contents/${encodedPath}?ref=${encodeURIComponent(ref)}`,
    );
    if (result.encoding !== "base64" || !result.content) throw new GitHubError(`No text content for ${fullName}/${path}`);
    const encoded = result.content.replace(/\s/g, "");
    if (encoded.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)) throw new GitHubError(`Invalid base64 content for ${fullName}/${path}`);
    return Buffer.from(encoded, "base64").toString("utf8");
  }
}
