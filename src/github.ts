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
        "User-Agent": "imitator-agent-harness/0.1",
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
    const result = await this.#json<{ items: GitHubRepository[] }>(
      `/search/repositories?q=${encodeURIComponent(query)}&sort=stars&order=desc&per_page=${Math.min(limit, 100)}`,
    );
    return result.items;
  }

  async profile(repository: GitHubRepository): Promise<RepositoryProfile> {
    const [owner, name] = repository.full_name.split("/");
    if (!owner || !name) throw new GitHubError(`Invalid repository name: ${repository.full_name}`);
    const result = await this.#json<{
      sha: string;
      tree: Array<{ path: string; type: string; sha: string; size?: number }>;
      truncated?: boolean;
    }>(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/git/trees/${encodeURIComponent(repository.default_branch)}?recursive=1`);
    const tree: TreeEntry[] = result.tree
      .filter((entry): entry is typeof entry & { type: "blob" | "tree" } => entry.type === "blob" || entry.type === "tree")
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
      resolvedRevision: result.sha,
      pushedAt: repository.pushed_at,
      createdAt: repository.created_at,
      license: repository.license?.spdx_id && repository.license.spdx_id !== "NOASSERTION" ? repository.license.spdx_id : null,
      language: repository.language,
      topics: repository.topics ?? [],
      tree,
    };
  }

  async readTextFile(fullName: string, path: string, ref: string): Promise<string> {
    const [owner, name] = fullName.split("/");
    if (!owner || !name) throw new GitHubError(`Invalid repository name: ${fullName}`);
    const encodedPath = path.split("/").map(encodeURIComponent).join("/");
    const result = await this.#json<{ content?: string; encoding?: string }>(
      `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/contents/${encodedPath}?ref=${encodeURIComponent(ref)}`,
    );
    if (result.encoding !== "base64" || !result.content) throw new GitHubError(`No text content for ${fullName}/${path}`);
    return Buffer.from(result.content.replace(/\n/g, ""), "base64").toString("utf8");
  }
}
