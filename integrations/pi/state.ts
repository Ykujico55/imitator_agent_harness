import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import type {
  DesignConfirmation,
  DesignDossier,
  DesignGateResult,
  GateResult,
  HarnessConfig,
  ReferencePack,
  ReviewConfirmation,
  ReviewSubmission,
  TaskIdentity,
} from "../../src/types.ts";
import type { AdvisoryLearningResult, PiWorkflowMode } from "../../src/advisory.ts";
import { createTaskIdentity } from "../../src/task.ts";

const execFileAsync = promisify(execFile);

export type PersistedPiPhase = "advisory_ready" | "bypassed" | "reviewing" | "awaiting_confirmation" | "distilling" | "awaiting_design_confirmation" | "approved" | "blocked";

export type PersistedPiPayload = {
  schemaVersion: 3;
  phase: PersistedPiPhase;
  run: {
    pack: ReferencePack;
    directory: string;
    config: HarnessConfig;
    taskIdentity: TaskIdentity;
  };
  readEvidenceIds: string[];
  readBundleIds: string[];
  readBlueprintObservationIds?: string[];
  submission?: ReviewSubmission;
  provisionalGate?: GateResult;
  confirmation?: ReviewConfirmation;
  referenceGate?: GateResult;
  designDossier?: DesignDossier;
  provisionalDesignGate?: DesignGateResult;
  designConfirmation?: DesignConfirmation;
  finalDesignGate?: DesignGateResult;
  workflowMode?: PiWorkflowMode;
  advisory?: AdvisoryLearningResult;
  savedAt: string;
};

type PersistedPiEnvelope = { schemaVersion: 3; checksum: string; payload: PersistedPiPayload };

function checksum(payload: PersistedPiPayload): string {
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

export async function inspectWorkspace(task: TaskIdentity["task"], cwd: string): Promise<TaskIdentity> {
  let workspace = resolve(cwd);
  let baseRevision = "unversioned";
  try {
    const root = await execFileAsync("git", ["-C", cwd, "rev-parse", "--show-toplevel"], { windowsHide: true });
    const revision = await execFileAsync("git", ["-C", cwd, "rev-parse", "HEAD"], { windowsHide: true });
    workspace = resolve(root.stdout.trim());
    baseRevision = revision.stdout.trim();
  } catch {
    // Non-git workspaces still receive a stable path-bound identity.
  }
  return createTaskIdentity(task, workspace, baseRevision);
}

export interface PiStateStore {
  load(cwd: string): Promise<PersistedPiPayload | undefined>;
  save(cwd: string, payload: PersistedPiPayload): Promise<void>;
  clear(cwd: string): Promise<void>;
}

export class FilePiStateStore implements PiStateStore {
  readonly relativePath: string;

  constructor(relativePath = join(".imitator", "pi-state.json")) {
    this.relativePath = relativePath;
  }

  path(cwd: string): string {
    return resolve(cwd, this.relativePath);
  }

  async load(cwd: string): Promise<PersistedPiPayload | undefined> {
    try {
      const envelope = JSON.parse(await readFile(this.path(cwd), "utf8")) as PersistedPiEnvelope;
      if (envelope.schemaVersion !== 3 || envelope.payload?.schemaVersion !== 3 || envelope.checksum !== checksum(envelope.payload)) {
        throw new Error("Persisted Pi state failed its integrity check");
      }
      return envelope.payload;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw error;
    }
  }

  async save(cwd: string, payload: PersistedPiPayload): Promise<void> {
    const path = this.path(cwd);
    await mkdir(dirname(path), { recursive: true });
    const envelope: PersistedPiEnvelope = { schemaVersion: 3, checksum: checksum(payload), payload };
    await writeFile(path, `${JSON.stringify(envelope, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  }

  async clear(cwd: string): Promise<void> {
    await rm(this.path(cwd), { force: true });
  }
}
