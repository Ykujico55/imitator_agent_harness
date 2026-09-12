import { auditVisualInventory } from "./visual-analysis.ts";
import { getVisualStyleProfile } from "./visual-styles.ts";
import type {
  VisualAuditReport,
  VisualSpec,
  VisualStaticInventory,
  VisualTaskRoute,
} from "./visual-types.ts";

export { analyzeVisualSources, auditVisualInventory } from "./visual-analysis.ts";
export { routeVisualTask, VISUAL_ROUTE_THRESHOLD } from "./visual-router.ts";
export { getVisualStyleProfile, listVisualStyleProfiles } from "./visual-styles.ts";
export type * from "./visual-types.ts";

export const VISUAL_SPEC_MAX_CHARACTERS = 6_000;

function compact(values: string[], maximum: number): string[] {
  return values.map((value) => value.trim().replace(/\s+/g, " ")).filter(Boolean).slice(0, maximum);
}

export function buildVisualSpec(route: VisualTaskRoute, inventory: VisualStaticInventory): VisualSpec {
  if (route.route !== "visual-style" || !route.archetypeId) throw new Error("A visual-style route with an archetype is required");
  const profile = getVisualStyleProfile(route.archetypeId);
  const hasExistingTokens = inventory.customPropertyDefinitions.length > 0;
  return {
    schemaVersion: 1,
    route,
    profile,
    localEvidence: {
      inspectedFiles: inventory.inspectedFiles,
      existingCustomProperties: inventory.customPropertyDefinitions.length,
      existingColors: inventory.colors.slice(0, 8).map((item) => item.value),
      existingTypeScale: inventory.fontSizes.slice(0, 8).map((item) => item.value),
      existingRadii: inventory.radii.slice(0, 6).map((item) => item.value),
      responsiveEvidence: inventory.responsiveSignals.length > 0,
    },
    implementationContract: compact([
      hasExistingTokens
        ? "Preserve compatible local semantic tokens; change them only when they conflict with the selected visual direction."
        : "Define a small semantic token layer for canvas, surface, text, muted text, accent, focus, success, warning, and danger before styling components.",
      profile.layout.direction,
      `Use typography direction: ${profile.typography.direction}; establish visibly distinct page, section, body, label, and metadata roles.`,
      profile.shape.borderDirection,
      ...profile.principles,
      "Implement explicit hover, focus-visible, disabled, loading, empty, error, and selected states where those states exist.",
      "Check narrow, medium, and wide layouts; preserve reading order and avoid horizontal overflow.",
      "After implementation call imitator_visual_audit. Make at most one focused repair pass and one re-audit; do not chase heuristics indefinitely.",
    ], 12),
    limitations: [
      "The bundled profile is an auditable seed style prior, not a human-validated verdict or a claim that an automatically discovered repository is visually excellent.",
      "Static source analysis cannot see rendered composition, selector precedence, imagery quality, or brand appropriateness.",
      "Local requirements and an actual human view of the rendered page override this profile.",
    ],
  };
}

export function renderVisualSpec(spec: VisualSpec): string {
  const profile = spec.profile;
  const lines = [
    "# Imitator visual direction",
    "",
    `Route: visual-style (${spec.route.score}/${spec.route.threshold}); archetype: ${profile.label} [${profile.id}].`,
    `Selection basis: ${spec.route.archetypeReason}. Provenance: ${profile.provenance}; no remote project was executed or treated as visual authority.`,
    "",
    "## Art direction",
    `- Palette roles: canvas ${profile.palette.canvas}; surface ${profile.palette.surface}; text ${profile.palette.text}; muted ${profile.palette.mutedText}; accent ${profile.palette.accent}; secondary ${profile.palette.supportingAccent}; danger ${profile.palette.danger}.`,
    `- Typography: ${profile.typography.direction}; suggested scale ${profile.typography.scale.join("/")}px; body line-height ${profile.typography.bodyLineHeight}.`,
    `- Layout: ${profile.layout.direction}; max width about ${profile.layout.contentMaxWidth}px; ${profile.layout.density} density; ${profile.layout.sectionRhythm}.`,
    `- Shape: radius roles ${profile.shape.radiusScale.join("/")}px; at most ${profile.shape.elevationLevels} elevation levels; ${profile.shape.borderDirection}.`,
    `- Motion: ${profile.motion.direction}; ${profile.motion.durationMs.join("/")}ms; always respect reduced motion.`,
    "",
    "## Implementation contract",
    ...spec.implementationContract.map((item) => `- ${item}`),
    "",
    "## Explicit anti-patterns",
    ...profile.avoid.map((item) => `- Avoid: ${item}.`),
    "",
    "## Existing local style evidence",
    `- Inspected files: ${spec.localEvidence.inspectedFiles.length ? spec.localEvidence.inspectedFiles.slice(0, 12).join(", ") : "none yet"}.`,
    `- Semantic custom properties: ${spec.localEvidence.existingCustomProperties}; colors: ${spec.localEvidence.existingColors.join(", ") || "none detected"}; type steps: ${spec.localEvidence.existingTypeScale.join(", ") || "none detected"}; radii: ${spec.localEvidence.existingRadii.join(", ") || "none detected"}.`,
    "",
    "## Limits",
    ...spec.limitations.map((item) => `- ${item}`),
  ];
  const rendered = lines.join("\n");
  return rendered.length <= VISUAL_SPEC_MAX_CHARACTERS
    ? rendered
    : `${rendered.slice(0, VISUAL_SPEC_MAX_CHARACTERS - 1).trimEnd()}…`;
}

export function renderVisualAudit(report: VisualAuditReport): string {
  const lines = [
    "# Imitator visual static audit",
    "",
    `Profile: ${report.profileId}; status: ${report.status}.`,
    "",
    ...(report.findings.length ? report.findings.flatMap((item) => [
      `## [${item.severity}] ${item.signal}`,
      "",
      item.message,
      `Evidence paths: ${item.evidence.join(", ") || "none"}.`,
      `Action: ${item.remediation}`,
      "",
    ]) : ["No configured static anti-pattern signal fired.", ""]),
    "## Limits",
    "",
    ...report.limitations.map((item) => `- ${item}`),
  ];
  return lines.join("\n");
}

export function createVisualLearningArtifacts(route: VisualTaskRoute, inventory: VisualStaticInventory): {
  spec: VisualSpec;
  audit: VisualAuditReport;
  brief: string;
} {
  const spec = buildVisualSpec(route, inventory);
  const audit = auditVisualInventory(inventory, spec.profile);
  return { spec, audit, brief: renderVisualSpec(spec) };
}
