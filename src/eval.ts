export type EvalVariant = "baseline" | "imitator";

export type EvalTask = {
  id: string;
  fixture: string;
  prompt: string;
  verify: { command: string; args?: string[] };
  timeoutMs?: number;
};

export type EvalSuite = {
  schemaVersion: 1;
  name: string;
  repetitions: number;
  tasks: EvalTask[];
};

export type EvalRunSpec = {
  id: string;
  task: EvalTask;
  variant: EvalVariant;
  repetition: number;
};

export type EvalRunResult = {
  schemaVersion: 1;
  run: EvalRunSpec;
  provider: string;
  model: string;
  judgeProvider?: string;
  judgeModel?: string;
  startedAt: string;
  finishedAt: string;
  agentExitCode: number;
  verificationExitCode: number | null;
  durationMs: number;
  changedFiles: number;
  agentOutput: string;
  verificationOutput: string;
  error?: string;
};

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object`);
  return value as Record<string, unknown>;
}

export function extractLastJsonObject(output: string): Record<string, unknown> {
  let start = -1;
  let depth = 0;
  let quoted = false;
  let escaped = false;
  let last: Record<string, unknown> | undefined;
  for (let index = 0; index < output.length; index += 1) {
    const character = output[index]!;
    if (quoted) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') quoted = false;
      continue;
    }
    if (character === '"' && depth > 0) { quoted = true; continue; }
    if (character === "{") {
      if (depth === 0) start = index;
      depth += 1;
    } else if (character === "}" && depth > 0) {
      depth -= 1;
      if (depth === 0 && start >= 0) {
        try { last = record(JSON.parse(output.slice(start, index + 1)), "judge output"); } catch { /* keep scanning */ }
        start = -1;
      }
    }
  }
  if (!last) throw new Error("Independent judge did not return a valid JSON object");
  return last;
}

export function parseReferenceJudgeDecision(output: string, allowed: string[]): { approvedRepositories: string[]; rationale: string } {
  const value = extractLastJsonObject(output);
  if (!Array.isArray(value.approvedRepositories) || value.approvedRepositories.some((name) => typeof name !== "string")) {
    throw new Error("Independent judge returned invalid approvedRepositories");
  }
  if (typeof value.rationale !== "string" || value.rationale.trim().length < 12) throw new Error("Independent judge rationale is missing or too vague");
  const approvedRepositories = [...new Set(value.approvedRepositories as string[])];
  const allowedSet = new Set(allowed);
  if (approvedRepositories.some((repository) => !allowedSet.has(repository))) {
    throw new Error("Independent judge approved a repository outside the provisional set");
  }
  return { approvedRepositories, rationale: value.rationale.trim() };
}

export function parseDesignJudgeDecision(output: string): { approve: boolean; rationale: string } {
  const value = extractLastJsonObject(output);
  if (typeof value.approve !== "boolean") throw new Error("Independent design judge returned an invalid approve decision");
  if (typeof value.rationale !== "string" || value.rationale.trim().length < 12) throw new Error("Independent design judge rationale is missing or too vague");
  return { approve: value.approve, rationale: value.rationale.trim() };
}

export function parseEvalSuite(value: unknown): EvalSuite {
  const root = record(value, "eval suite");
  if (root.schemaVersion !== 1) throw new Error("eval suite schemaVersion must be 1");
  if (typeof root.name !== "string" || !/^[a-z0-9][a-z0-9_-]{0,63}$/i.test(root.name)) throw new Error("eval suite name must be a path-safe identifier");
  if (!Number.isInteger(root.repetitions) || (root.repetitions as number) < 1 || (root.repetitions as number) > 20) {
    throw new Error("eval suite repetitions must be an integer from 1 to 20");
  }
  if (!Array.isArray(root.tasks) || root.tasks.length === 0 || root.tasks.length > 50) throw new Error("eval suite requires 1-50 tasks");
  const ids = new Set<string>();
  const tasks = root.tasks.map((raw, index): EvalTask => {
    const task = record(raw, `tasks[${index}]`);
    const verify = record(task.verify, `tasks[${index}].verify`);
    if (typeof task.id !== "string" || !/^[a-z0-9][a-z0-9_-]*$/i.test(task.id)) throw new Error(`tasks[${index}].id is invalid`);
    if (ids.has(task.id)) throw new Error(`duplicate eval task id: ${task.id}`);
    ids.add(task.id);
    if (typeof task.fixture !== "string" || !task.fixture.trim()) throw new Error(`tasks[${index}].fixture is required`);
    const fixture = task.fixture.trim().replace(/\\/g, "/").replace(/^\.\/+/, "");
    if (fixture.length > 500 || fixture.startsWith("/") || /^[a-z]:\//i.test(fixture)
      || fixture.split("/").some((part) => !part || part === "." || part === "..")) {
      throw new Error(`tasks[${index}].fixture must stay within the suite directory`);
    }
    if (typeof task.prompt !== "string" || !task.prompt.trim() || task.prompt.length > 20_000) throw new Error(`tasks[${index}].prompt must contain 1-20000 characters`);
    if (typeof verify.command !== "string" || !verify.command.trim() || verify.command.length > 500) throw new Error(`tasks[${index}].verify.command is required and bounded`);
    if (verify.args !== undefined && (!Array.isArray(verify.args) || verify.args.length > 100
      || verify.args.some((arg) => typeof arg !== "string" || arg.length > 2_000))) {
      throw new Error(`tasks[${index}].verify.args must contain at most 100 bounded strings`);
    }
    if (task.timeoutMs !== undefined && (!Number.isInteger(task.timeoutMs) || (task.timeoutMs as number) < 1_000 || (task.timeoutMs as number) > 3_600_000)) {
      throw new Error(`tasks[${index}].timeoutMs must be from 1000 to 3600000`);
    }
    return {
      id: task.id,
      fixture,
      prompt: task.prompt,
      verify: { command: verify.command, args: verify.args as string[] | undefined },
      timeoutMs: task.timeoutMs as number | undefined,
    };
  });
  return { schemaVersion: 1, name: root.name, repetitions: root.repetitions as number, tasks };
}

export function buildEvalPlan(suite: EvalSuite, variants: EvalVariant[] = ["baseline", "imitator"]): EvalRunSpec[] {
  const uniqueVariants = [...new Set(variants)];
  if (!uniqueVariants.length) throw new Error("At least one eval variant is required");
  if (uniqueVariants.some((variant) => variant !== "baseline" && variant !== "imitator")) throw new Error("Eval variants must be baseline or imitator");
  return suite.tasks.flatMap((task) => Array.from({ length: suite.repetitions }, (_, index) => index + 1)
    .flatMap((repetition) => uniqueVariants.map((variant) => ({
      id: `${task.id}-${variant}-r${repetition}`,
      task,
      variant,
      repetition,
    }))));
}

export function summarizeEvalResults(results: EvalRunResult[]): {
  runs: number;
  byVariant: Record<EvalVariant, { runs: number; verified: number; verificationRate: number; averageDurationMs: number; averageChangedFiles: number }>;
} {
  const summarize = (variant: EvalVariant) => {
    const selected = results.filter((result) => result.run.variant === variant);
    const verified = selected.filter((result) => result.verificationExitCode === 0).length;
    const total = selected.length || 1;
    return {
      runs: selected.length,
      verified,
      verificationRate: selected.length ? verified / selected.length : 0,
      averageDurationMs: selected.reduce((sum, result) => sum + result.durationMs, 0) / total,
      averageChangedFiles: selected.reduce((sum, result) => sum + result.changedFiles, 0) / total,
    };
  };
  return { runs: results.length, byVariant: { baseline: summarize("baseline"), imitator: summarize("imitator") } };
}
