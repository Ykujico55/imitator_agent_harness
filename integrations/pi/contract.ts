export type PiControllerPhase =
  | "idle"
  | "preparing"
  | "advisory_ready"
  | "bypassed"
  | "reviewing"
  | "awaiting_confirmation"
  | "distilling"
  | "awaiting_design_confirmation"
  | "approved"
  | "blocked";

export const IMITATOR_TOOL_NAMES = {
  learn: "imitator_learn",
  visualAudit: "imitator_visual_audit",
  prepare: "imitator_prepare",
  getSemanticBlueprint: "imitator_get_semantic_blueprint",
  getEvidenceBundle: "imitator_get_evidence_bundle",
  getEvidence: "imitator_get_evidence",
  submitReview: "imitator_submit_review",
  submitDesignDossier: "imitator_submit_design_dossier",
} as const;

export const ADVISORY_TOOL_NAMES = [IMITATOR_TOOL_NAMES.learn, IMITATOR_TOOL_NAMES.visualAudit] as const;
export const STRICT_TOOL_NAMES = [
  IMITATOR_TOOL_NAMES.prepare,
  IMITATOR_TOOL_NAMES.getSemanticBlueprint,
  IMITATOR_TOOL_NAMES.getEvidenceBundle,
  IMITATOR_TOOL_NAMES.getEvidence,
  IMITATOR_TOOL_NAMES.submitReview,
  IMITATOR_TOOL_NAMES.submitDesignDossier,
] as const;

export const IMITATOR_COMMAND_NAMES = {
  prepare: "imitator-prepare",
  status: "imitator-status",
  doctor: "imitator-doctor",
  confirm: "imitator-confirm",
  reset: "imitator-reset",
} as const;

export const PI_REQUIRED_HOOKS = ["session_start", "before_agent_start", "tool_call"] as const;
export const MUTATION_TOOL_DENY_LIST = ["edit", "write", "bash", "powershell", "apply_patch"] as const;

const mutationTools: ReadonlySet<string> = new Set(MUTATION_TOOL_DENY_LIST);

export type MutationGateSignal = {
  code: string;
  reason: string;
};

export const MUTATION_GATE_SIGNALS = {
  idle: {
    code: "prepare_required",
    reason: "Imitator gate [prepare_required]: call imitator_prepare before using mutation-capable tools.",
  },
  preparing: {
    code: "discovery_in_progress",
    reason: "Imitator gate [discovery_in_progress]: precedent discovery is still running.",
  },
  reviewing: {
    code: "evidence_review_required",
    reason: "Imitator gate [evidence_review_required]: inspect evidence and call imitator_submit_review before coding.",
  },
  awaiting_confirmation: {
    code: "reference_confirmation_required",
    reason: "Imitator gate [reference_confirmation_required]: the reference proposal requires independent human or judge confirmation.",
  },
  distilling: {
    code: "design_dossier_required",
    reason: "Imitator gate [design_dossier_required]: distill the confirmed references into an evidence-bound design dossier before coding.",
  },
  awaiting_design_confirmation: {
    code: "design_confirmation_required",
    reason: "Imitator gate [design_confirmation_required]: the design dossier requires independent human or judge confirmation before coding.",
  },
  blocked: {
    code: "no_approved_precedent",
    reason: "Imitator gate [no_approved_precedent]: no precedent passed the confirmed review; revise the search or obtain an approved decision.",
  },
} as const satisfies Record<Exclude<PiControllerPhase, "approved" | "advisory_ready" | "bypassed">, MutationGateSignal>;

export const ADVISORY_GATE_SIGNALS = {
  idle: {
    code: "advisory_learning_required",
    reason: "Imitator adviser [advisory_learning_required]: call imitator_learn once before mutation; it will automatically learn or skip without human confirmation.",
  },
  preparing: {
    code: "advisory_learning_in_progress",
    reason: "Imitator adviser [advisory_learning_in_progress]: the single bounded learning pass is still running.",
  },
} as const;

export function mutationGateSignal(toolName: string, phase: PiControllerPhase): MutationGateSignal | undefined {
  if (!mutationTools.has(toolName) || phase === "approved" || phase === "advisory_ready" || phase === "bypassed") return undefined;
  return MUTATION_GATE_SIGNALS[phase];
}

export function advisoryMutationGateSignal(toolName: string, phase: PiControllerPhase): MutationGateSignal | undefined {
  if (!mutationTools.has(toolName)) return undefined;
  if (phase === "idle" || phase === "preparing") return ADVISORY_GATE_SIGNALS[phase];
  return undefined;
}

export type PiHealthCheck = {
  name: "registry" | "hooks" | "store";
  ok: boolean;
  detail: string;
};

export type PiHealthReport = {
  healthy: boolean;
  checks: PiHealthCheck[];
};

function missing(expected: readonly string[], observed: readonly string[]): string[] {
  const available = new Set(observed);
  return expected.filter((name) => !available.has(name));
}

export function inspectPiHealth(input: {
  tools: readonly string[];
  commands: readonly string[];
  hooks: readonly string[];
  store: { ok: boolean; detail: string };
  mode?: "advisory" | "strict";
}): PiHealthReport {
  const expectedTools = input.mode === "advisory" ? ADVISORY_TOOL_NAMES : STRICT_TOOL_NAMES;
  const missingTools = missing(expectedTools, input.tools);
  const missingCommands = missing(Object.values(IMITATOR_COMMAND_NAMES), input.commands);
  const missingHooks = missing(PI_REQUIRED_HOOKS, input.hooks);
  const checks: PiHealthCheck[] = [
    {
      name: "registry",
      ok: missingTools.length === 0 && missingCommands.length === 0,
      detail: missingTools.length || missingCommands.length
        ? `missing tools=[${missingTools.join(", ") || "none"}] commands=[${missingCommands.join(", ") || "none"}]`
        : `${expectedTools.length} ${input.mode ?? "strict"} tools and ${Object.values(IMITATOR_COMMAND_NAMES).length} commands registered`,
    },
    {
      name: "hooks",
      ok: missingHooks.length === 0,
      detail: missingHooks.length ? `missing hooks=[${missingHooks.join(", ")}]` : `${PI_REQUIRED_HOOKS.length} lifecycle hooks registered`,
    },
    { name: "store", ok: input.store.ok, detail: input.store.detail },
  ];
  return { healthy: checks.every((check) => check.ok), checks };
}

export function renderPiHealth(report: PiHealthReport): string {
  return report.checks.map((check) => `${check.name}: ${check.ok ? "ok" : "failed"} — ${check.detail}`).join("\n");
}
