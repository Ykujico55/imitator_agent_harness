import type { DomainConcept, TaskDomainSpec, TaskSpec } from "./types.ts";

// Only cross-domain engineering preferences and common instruction words belong here.
// Product names, business domains and their mechanisms must not be enumerated in core.
const GENERIC = new Set(`a an and or the this that with without for from into of to in on at as is be are it its
implement implementation build create develop make add support supports supporting provide use using used
small tiny simple lightweight basic new existing project software system library libraries application app
package module core runtime dependency dependencies deps zero free provider neutral
typescript javascript type script node nodejs python rust golang go java cpp csharp ruby swift kotlin
esm commonjs exports sideeffects side effect effects readme documentation docs test tests testing tested
fully all full deterministic built builtin framework frameworks external no any only
function functions functional pure async asynchronous synchronous modern fast performant performance scalable
robust production ready high quality well clean maintainable reusable design architecture
api interface interfaces method methods generic
must should need want please first then also return returns value values key keys boolean string number
implementing development engineering unit integration end
零依赖 无依赖 无运行时依赖 类型安全 跨语言 高质量 确定性测试 测试 文档 工程规范`.split(/\s+/));

function normalized(value: string): string {
  return value.replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2").replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/g, " ").trim().replace(/\s+/g, " ");
}

/** Match words/phrases, not arbitrary substrings or concatenated file paths. */
export function containsDomainTerm(text: string, term: string): boolean {
  const haystack = normalized(text);
  const needle = normalized(term);
  if (!needle) return false;
  return /[\u4e00-\u9fff]/.test(needle) ? haystack.includes(needle) : ` ${haystack} `.includes(` ${needle} `);
}

function meaningfulTerms(value: string, preferences: string[] = []): string[] {
  const excluded = new Set([...GENERIC, ...preferences.flatMap((term) => normalized(term).split(" "))]);
  return normalized(value).split(" ").filter((term) => term.length >= (/[\u4e00-\u9fff]/.test(term) ? 2 : 3) && !excluded.has(term));
}

export function normalizeDomainSpec(value: unknown, task: Pick<TaskSpec, "task" | "mustHave" | "language" | "ecosystem">): TaskDomainSpec | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("domain must be an object");
  const input = value as Record<string, unknown>;
  const positiveTask = [task.task, ...(task.mustHave ?? [])].join(" ").replace(/\s+/g, " ").toLowerCase();
  const preferences = [task.language, task.ecosystem].filter((item): item is string => Boolean(item));
  const concept = (raw: unknown, label: string): DomainConcept => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error(`${label} must be an object`);
    const item = raw as Record<string, unknown>;
    const term = (rawTerm: unknown): string => {
      if (typeof rawTerm !== "string" || rawTerm.trim().length < 2 || rawTerm.length > 100 || !/^[\p{L}\p{N} +_-]+$/u.test(rawTerm)) {
        throw new Error(`${label} names/aliases must be bounded plain search terms`);
      }
      const result = normalized(rawTerm);
      if (!meaningfulTerms(result, preferences).length) throw new Error(`${label}: engineering preferences cannot establish a product domain`);
      return result;
    };
    const name = term(item.name);
    if (!Array.isArray(item.aliases) || item.aliases.length > 6) throw new Error(`${label}.aliases must contain at most 6 terms`);
    const aliases = [...new Set(item.aliases.map(term))].filter((alias) => alias !== name).sort();
    if (typeof item.taskEvidence !== "string" || item.taskEvidence.trim().length < 3 || item.taskEvidence.length > 600) {
      throw new Error(`${label}.taskEvidence must quote a bounded local task excerpt`);
    }
    const taskEvidence = item.taskEvidence.trim().replace(/\s+/g, " ");
    if (!positiveTask.includes(taskEvidence.toLowerCase())) throw new Error(`${label}.taskEvidence is not grounded in the local task or mustHave`);
    return { name, aliases, taskEvidence };
  };
  if (!Array.isArray(input.capabilities) || input.capabilities.length < 1 || input.capabilities.length > 8) {
    throw new Error("domain.capabilities requires 1-8 product behaviors, not engineering preferences");
  }
  const purpose = concept(input.purpose, "domain.purpose");
  const capabilities = input.capabilities.map((item, index) => concept(item, `domain.capabilities[${index}]`))
    .sort((a, b) => a.name.localeCompare(b.name));
  if (new Set(capabilities.map((item) => item.name)).size !== capabilities.length) throw new Error("domain.capabilities names must be unique");
  return { purpose, capabilities };
}

export type TaskDomain = {
  anchors: string[];
  aliases: string[];
  queryTerms: string[];
  capabilities: Array<{ name: string; aliases: string[] }>;
  source: "task-profile" | "lexical-fallback" | "unknown";
};

export function extractTaskDomain(task: TaskSpec): TaskDomain {
  const profile = normalizeDomainSpec(task.domain, task);
  if (profile) return {
    anchors: [profile.purpose.name],
    aliases: [profile.purpose.name, ...profile.purpose.aliases],
    queryTerms: [profile.purpose.name, ...profile.purpose.aliases].slice(0, 3),
    capabilities: profile.capabilities.map((item) => ({ name: item.name, aliases: [item.name, ...item.aliases] })),
    source: "task-profile",
  };
  // Conservative legacy fallback, not a claim to understand arbitrary natural language.
  // No prefix truncation before filtering. Pure Chinese/ambiguous tasks need a profile.
  const preferences = [task.language, task.ecosystem].filter((item): item is string => Boolean(item));
  const terms = meaningfulTerms([task.task, ...(task.mustHave ?? [])].join(" "), preferences).filter((term) => /^[a-z0-9]+$/.test(term));
  const counts = new Map<string, number>();
  for (const term of terms) counts.set(term, (counts.get(term) ?? 0) + 1);
  const anchors = [...counts.keys()].sort((a, b) => counts.get(b)! - counts.get(a)!).slice(0, 12);
  const queryTerms = [anchors.slice(0, 2).join(" "), anchors.slice(0, 3).join(" ")].filter(Boolean);
  return { anchors, aliases: anchors, queryTerms: [...new Set(queryTerms)], capabilities: [], source: anchors.length ? "lexical-fallback" : "unknown" };
}

export function domainMatches(text: string, domain: TaskDomain): string[] {
  return domain.aliases.filter((alias) => containsDomainTerm(text, alias));
}

export function domainMetadataSignal(text: string, task: TaskSpec): { score: number; matched: string[]; reasons: string[] } {
  const domain = extractTaskDomain(task);
  const matched = domainMatches(text, domain);
  const capabilities = domain.capabilities.filter((item) => item.aliases.some((alias) => containsDomainTerm(text, alias)));
  // One purpose earns 60 points; capability coverage adds at most 25. Synonyms never stack.
  // Legacy word overlap is capped at 75 and needs >=50% coverage to reach the default gate.
  const score = !matched.length ? 0 : domain.source === "task-profile"
    ? Math.round(60 + 25 * capabilities.length / domain.capabilities.length)
    : Math.round(25 + 50 * matched.length / domain.aliases.length);
  return { score, matched, reasons: [
    `domain-extraction: ${domain.source}; anchors: ${domain.anchors.join(", ") || "none"}`,
    matched.length ? `domain-purpose-match: ${matched.join(", ")}` : "domain-metadata-missing: no product-purpose anchor in repository metadata",
    `domain-capability-coverage: ${capabilities.length}/${domain.capabilities.length}; ${capabilities.map((item) => item.name).join(", ") || "none"}`,
    "engineering-preferences-excluded: language, dependencies, packaging and popularity do not establish domain fit",
    ...(domain.source !== "task-profile" ? ["domain-profile-missing: lexical overlap is uncertain; supply task-grounded purpose and capabilities before review"] : []),
  ] };
}
