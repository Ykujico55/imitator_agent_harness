import type { EvidenceSlice, RepositoryDesignAtlas, SemanticEvidenceRole } from "./types.ts";
import type { SourceAnalysis, SourceSymbol } from "./source-analysis.ts";
import { evidenceKindsForSlice } from "./bundle.ts";
import { relationSupport } from "./evidence-support.ts";

export const REQUIRED_SEMANTIC_ROLES: SemanticEvidenceRole[] = ["contract", "invariant", "failure", "relationship", "test"];

/** These are navigation surfaces, not asserted behavioral guarantees. */
export function semanticRoles(symbol: SourceSymbol, analysis: SourceAnalysis): SemanticEvidenceRole[] {
  const roles: SemanticEvidenceRole[] = [];
  const publicSurface = analysis.exports?.names.includes(symbol.name) || !symbol.name.startsWith("_")
    && (analysis.language !== "rust" || (symbol.visibility ?? "").startsWith("pub"));
  if (symbol.role === "implementation" && symbol.kind !== "module" && publicSurface) roles.push("contract");
  if (symbol.assertionCount > 0) roles.push("invariant");
  if (symbol.raises.length || symbol.catches.length || symbol.errorSignals?.length || symbol.unsafeCount) roles.push("failure");
  if (symbol.role === "test" && symbol.hasBody !== false) roles.push("test");
  return roles;
}

/** Select by marginal evidence gain. A budget is a ceiling, never a target. */
export function refineEvidenceSlices(
  candidates: EvidenceSlice[], atlas: RepositoryDesignAtlas | undefined, terms: string[],
  budget: { maxSlices: number; maxCharacters: number },
): { slices: EvidenceSlice[]; report: NonNullable<RepositoryDesignAtlas["evidenceRefinement"]> } {
  const discarded: NonNullable<RepositoryDesignAtlas["evidenceRefinement"]>["discarded"] = [];
  const record = (slice: EvidenceSlice, reason: typeof discarded[number]["reason"]): void => {
    discarded.push({ path: slice.path, startLine: slice.startLine, endLine: slice.endLine, reason });
  };
  const sorted = [...candidates].sort((a, b) => b.relevance - a.relevance || a.path.localeCompare(b.path) || a.startLine - b.startLine || a.id.localeCompare(b.id));
  const seen = new Set<string>();
  const pool = sorted.filter((slice) => {
    if (!slice.content.trim()) { record(slice, "low-value"); return false; }
    // Identical bytes at a different dependency endpoint can still be necessary
    // relationship evidence. Do not silently move attribution between paths.
    const endpoint = atlas?.relations.some((edge) => edge.from === slice.path || edge.to === slice.path) ? slice.path : "";
    const key = `${evidenceKindsForSlice(slice).sort().join(",")}\0${endpoint}\0${slice.content.replace(/\r\n/g, "\n").trim()}`;
    if (seen.has(key)) { record(slice, "duplicate"); return false; }
    seen.add(key);
    return true;
  });
  const selected: EvidenceSlice[] = [];
  const covered = new Set<string>();
  let characters = 0;
  const features = (slice: EvidenceSlice): Array<{ name: string; weight: number }> => {
    const result = evidenceKindsForSlice(slice).map((kind) => ({ name: `modality:${kind}`, weight: 1000 }));
    result.push(...(slice.architectureRoles ?? []).filter((role) => role !== "relationship").map((role) => ({ name: `role:${role}`, weight: 200 })));
    const text = `${slice.path}\n${slice.content}`.toLowerCase();
    result.push(...terms.filter((term) => text.includes(term.toLowerCase())).map((term) => ({ name: `task:${term.toLowerCase()}`, weight: 20 })));
    for (const edge of atlas?.relations ?? []) {
      if (slice.path !== edge.from && slice.path !== edge.to) continue;
      // Reward completing an actual evidence pair, and retain the import anchor
      // even when the primary semantic declaration starts below that import.
      const support = relationSupport(atlas!, edge, [...selected, slice]);
      if (support.supported) result.push({ name: "role:relationship", weight: 200 });
      else if (slice.path === edge.from && slice.architectureRoles?.includes("relationship")) {
        result.push({ name: "relationship:anchor", weight: 80 });
      } else if (slice.path === edge.to && !covered.has("role:relationship")) {
        result.push({ name: "relationship:target", weight: 40 });
      }
    }
    return [...new Map(result.map((feature) => [feature.name, feature])).values()];
  };
  while (pool.length && selected.length < budget.maxSlices) {
    const ranked = pool.map((slice) => {
      const gains = features(slice).filter((feature) => !covered.has(feature.name));
      return { slice, gains, gain: gains.reduce((sum, item) => sum + item.weight, 0) };
    }).filter((item) => item.slice.content.length <= budget.maxCharacters - characters)
      .sort((a, b) => b.gain - a.gain || b.slice.relevance - a.slice.relevance || a.slice.content.length - b.slice.content.length || a.slice.id.localeCompare(b.slice.id));
    const next = ranked[0];
    if (!next || next.gain === 0) break;
    pool.splice(pool.indexOf(next.slice), 1);
    selected.push({ ...next.slice, reason: `${next.slice.reason}; evidence-gain: ${next.gains.map((item) => item.name).join(", ")}` });
    next.gains.forEach((item) => covered.add(item.name));
    characters += next.slice.content.length;
  }
  for (const slice of pool) record(slice, slice.content.length > budget.maxCharacters - characters || selected.length >= budget.maxSlices ? "budget" : "redundant");
  const relationship = Boolean(atlas?.relations.some((edge) => relationSupport(atlas, edge, selected).supported));
  const coveredRoles = REQUIRED_SEMANTIC_ROLES.filter((role) => role === "relationship" ? relationship
    : selected.some((slice) => slice.architectureRoles?.includes(role)));
  const missingRoles = REQUIRED_SEMANTIC_ROLES.filter((role) => !coveredRoles.includes(role));
  return {
    slices: selected.map((slice) => ({ ...slice, architectureRoles: slice.architectureRoles?.filter((role) => role !== "relationship"
      || Boolean(atlas?.relations.some((edge) => relationSupport(atlas, edge, selected).supported && (edge.from === slice.path || edge.to === slice.path)))) })),
    report: {
      strategy: "semantic-role-cover-v1", status: missingRoles.length ? "degraded" : "covered",
      requiredRoles: [...REQUIRED_SEMANTIC_ROLES], coveredRoles, missingRoles,
      selectedSliceIds: selected.map((slice) => slice.id), discarded: discarded.slice(0, 200),
      limitations: [
        "Role coverage denotes retained static evidence only. Assertions are invariant candidates, not proof of runtime invariants or passing tests.",
        ...missingRoles.map((role) => `Missing retained ${role} evidence: keep reference claims unknown, seek evidence, or reject the unsupported transfer; local adaptations must be explicitly inferred.`),
        ...(discarded.some((item) => item.reason === "budget") ? ["Evidence candidates exceeded the slice or character budget; no complete declaration was cut to fit."] : []),
        ...(discarded.length > 200 ? [`Discard audit truncated: ${discarded.length - 200} additional candidates omitted.`] : []),
      ],
    },
  };
}
