import type { HarnessConfig, TaskSpec } from "./types.ts";

const STOP_WORDS = new Set([
  "about", "after", "agent", "before", "build", "code", "coding", "create", "from",
  "into", "make", "need", "related", "system", "that", "the", "this", "using", "with",
]);

const DOMAIN_GLOSSARY: Array<[RegExp, string[]]> = [
  [/编码代理|coding[ -]?agent|agent harness/i, ["coding-agent", "agent-harness"]],
  [/工作流|workflow/i, ["workflow", "orchestration"]],
  [/搜索|检索|search|retrieval/i, ["code-search", "repository-search"]],
  [/参考|范式|pattern|precedent/i, ["software-patterns", "architecture"]],
  [/任务队列|job queue/i, ["job-queue", "task-queue"]],
  [/认证|登录|auth/i, ["authentication", "authorization"]],
  [/支付|payment/i, ["payment", "billing"]],
  [/实时|realtime/i, ["realtime", "websocket"]],
  [/向量|embedding|vector/i, ["vector-search", "embeddings"]],
];

export function taskTerms(spec: TaskSpec): string[] {
  const terms = new Set<string>();
  for (const token of spec.task.match(/[a-zA-Z][a-zA-Z0-9_.+-]{2,}/g) ?? []) {
    const normalized = token.toLowerCase();
    if (!STOP_WORDS.has(normalized)) terms.add(normalized);
  }
  for (const [pattern, additions] of DOMAIN_GLOSSARY) {
    if (pattern.test(spec.task)) additions.forEach((term) => terms.add(term));
  }
  spec.mustHave?.forEach((term) => terms.add(term.toLowerCase()));
  if (spec.ecosystem) terms.add(spec.ecosystem.toLowerCase());
  return [...terms].slice(0, 10);
}

export function planQueries(spec: TaskSpec, config: HarnessConfig): string[] {
  const explicit = spec.queries?.map((query) => query.trim()).filter(Boolean) ?? [];
  const terms = taskTerms(spec);
  const anchors = terms.filter((term) => term.includes("-") || term.includes("+"));
  const supporting = terms.filter((term) => !anchors.includes(term));
  const generated: string[] = [];
  if (anchors.length) {
    generated.push([...anchors.slice(0, 2), ...supporting.slice(0, 2)].join(" "));
    generated.push(anchors.slice(0, 3).join(" "));
    for (const anchor of anchors.slice(0, 2)) {
      if (supporting[0]) generated.push(`${anchor} ${supporting[0]}`);
    }
  } else {
    if (terms.length) generated.push(terms.slice(0, 4).join(" "));
    for (let i = 0; i < Math.min(terms.length, 4); i += 2) generated.push(terms.slice(i, i + 2).join(" "));
  }
  const qualifiers = [`stars:>=${config.github.minimumStars}`, "archived:false", "fork:false"];
  if (spec.language) qualifiers.push(`language:${spec.language}`);
  return [...new Set([...explicit, ...generated])]
    .filter(Boolean)
    .slice(0, 5)
    .map((query) => `${query} ${qualifiers.join(" ")}`);
}
