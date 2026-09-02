import { createHash } from "node:crypto";
import type { TaskIdentity, TaskSpec } from "./types.ts";

function normalizeText(value: string | undefined): string | undefined {
  const normalized = value?.trim().replace(/\s+/g, " ");
  return normalized || undefined;
}

function normalizeList(values: string[] | undefined): string[] | undefined {
  if (!values) return undefined;
  const normalized = [...new Set(values.map(normalizeText).filter((value): value is string => Boolean(value)))].sort();
  return normalized.length ? normalized : undefined;
}

export function normalizeTaskSpec(task: TaskSpec): TaskSpec {
  return {
    task: normalizeText(task.task) ?? "",
    queries: normalizeList(task.queries),
    language: normalizeText(task.language)?.toLowerCase(),
    ecosystem: normalizeText(task.ecosystem)?.toLowerCase(),
    mustHave: normalizeList(task.mustHave),
    avoid: normalizeList(task.avoid),
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
