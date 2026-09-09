import { createHash } from "node:crypto";
import type { TaskIdentity, TaskSpec } from "./types.ts";
import { normalizeSpecifiedRepositories } from "./reference.ts";
import { normalizeDomainSpec } from "./domain.ts";

function normalizeText(value: string | undefined, label: string, maximum: number): string | undefined {
  if (value !== undefined && typeof value !== "string") throw new Error(`${label} must be a string`);
  const normalized = value?.trim().replace(/\s+/g, " ");
  if (normalized && normalized.length > maximum) throw new Error(`${label} exceeds ${maximum} characters`);
  return normalized || undefined;
}

function normalizeList(values: string[] | undefined, label: string, maximumItems: number, maximumCharacters: number): string[] | undefined {
  if (!values) return undefined;
  if (!Array.isArray(values) || values.length > maximumItems) throw new Error(`${label} must contain at most ${maximumItems} strings`);
  const normalized = [...new Set(values.map((value) => normalizeText(value, label, maximumCharacters)).filter((value): value is string => Boolean(value)))].sort();
  return normalized.length ? normalized : undefined;
}

export function normalizeTaskSpec(task: TaskSpec): TaskSpec {
  if (!task || typeof task !== "object" || Array.isArray(task)) throw new Error("task specification must be an object");
  const taskText = normalizeText(task.task, "task", 20_000);
  if (!taskText) throw new Error("task must not be empty");
  return {
    task: taskText,
    ...(task.domain === undefined ? {} : { domain: normalizeDomainSpec(task.domain, task) }),
    queries: normalizeList(task.queries, "queries", 5, 500),
    language: normalizeText(task.language, "language", 100)?.toLowerCase(),
    ecosystem: normalizeText(task.ecosystem, "ecosystem", 100)?.toLowerCase(),
    mustHave: normalizeList(task.mustHave, "mustHave", 20, 2_000),
    avoid: normalizeList(task.avoid, "avoid", 20, 2_000),
    referenceRepositories: normalizeSpecifiedRepositories(task.referenceRepositories),
  };
}

export function fingerprintTask(task: TaskSpec, workspace: string, baseRevision: string): string {
  const slashPath = workspace.replace(/\\/g, "/").replace(/\/$/, "");
  const canonicalWorkspace = /^[a-z]:\//i.test(slashPath) ? slashPath.toLowerCase() : slashPath;
  const identity = {
    schemaVersion: 1,
    workspace: canonicalWorkspace,
    baseRevision: baseRevision.trim() || "unversioned",
    task: normalizeTaskSpec(task),
  };
  return createHash("sha256").update(JSON.stringify(identity)).digest("hex");
}

export function createTaskIdentity(task: TaskSpec, workspace: string, baseRevision: string): TaskIdentity {
  const normalized = normalizeTaskSpec(task);
  return {
    schemaVersion: 1,
    fingerprint: fingerprintTask(normalized, workspace, baseRevision),
    workspace,
    baseRevision: baseRevision.trim() || "unversioned",
    task: normalized,
  };
}
