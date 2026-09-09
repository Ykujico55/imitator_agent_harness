import { isImplementationPath, isTestPath, isTestSupportPath } from "./evidence-path.ts";
import { coveringSlices, fixtureSupport, hasSemanticWindow, relationSupport, repositoryEvidence } from "./evidence-support.ts";
import type {
  AnalysisQualityReport,
  AtlasSourceRef,
  EvidenceKind,
  EvidenceSlice,
  EvidenceStrength,
  EvidenceStrengthRecord,
  RepositoryDesignAtlas,
} from "./types.ts";

const MANIFEST = /(^|\/)(package\.json|pyproject\.toml|setup\.cfg|Cargo\.toml|go\.mod|pom\.xml|build\.gradle(?:\.kts)?)$/i;
const DOCUMENTATION = /(^|\/)(README|docs?|architecture|design|adr|rfcs?)(\/|\.|$)|(^|\/)(ADR|RFC)-?\d+/i;
const STRENGTH: Record<EvidenceStrength, number> = { missing: 0, textual: 1, syntactic: 2, resolved: 3, corroborated: 4 };

export function compareEvidenceStrength(a: EvidenceStrength, b: EvidenceStrength): number {
  return STRENGTH[a] - STRENGTH[b];
}

function unique(values: string[]): string[] {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b));
}

function modalitiesForPath(path: string, slice?: EvidenceSlice): EvidenceKind[] {
  if (slice?.evidenceRoles?.length === 0 && slice.architectureRoles?.includes("relationship")) return ["relationship"];
  const semantic = slice?.evidenceRoles ?? [];
  const result: EvidenceKind[] = [];
  if (semantic.includes("implementation")) result.push("implementation");
  if (semantic.includes("test")) result.push("test");
  if (result.length) return result;
  if (MANIFEST.test(path)) return ["manifest"];
  if (isTestSupportPath(path)) return ["test-support"];
  if (isTestPath(path)) return ["test"];
  if (DOCUMENTATION.test(path)) return ["documentation"];
  if (isImplementationPath(path)) return ["implementation"];
  return [];
}

function sourceRef(atlas: RepositoryDesignAtlas, path: string): AtlasSourceRef {
  const encoded = path.split("/").map(encodeURIComponent).join("/");
  return { path, sourceUrl: `${atlas.repositoryUrl}/blob/${encodeURIComponent(atlas.revision)}/${encoded}` };
}

function maxStrength(values: EvidenceStrength[]): EvidenceStrength {
  return values.reduce((best, value) => compareEvidenceStrength(value, best) > 0 ? value : best, "missing");
}

function minStrength(values: EvidenceStrength[]): EvidenceStrength {
  return values.reduce((worst, value) => compareEvidenceStrength(value, worst) < 0 ? value : worst, values[0] ?? "missing");
}

export function annotateEvidenceStrength(atlases: RepositoryDesignAtlas[], slices: EvidenceSlice[]): EvidenceSlice[] {
  const atlasByRepository = new Map(atlases.map((atlas) => [atlas.repository, atlas]));
  const supports = new Map(atlases.map((atlas) => [atlas.repository, {
    relations: atlas.relations.map((relation) => ({ relation, ...relationSupport(atlas, relation, slices) })),
    fixtures: (atlas.fixtureRelations ?? []).map((fixture) => fixtureSupport(atlas, fixture, slices)),
  }]));
  return slices.map((slice) => {
    const atlas = atlasByRepository.get(slice.repository);
    const signals = ["bounded-text-window"];
    const limitations: string[] = [];
    let level: EvidenceStrength = "textual";
    const analysis = atlas?.sourceAnalyses?.find((item) => item.path === slice.path);
    const completeSemantic = hasSemanticWindow(slice) && (!atlas || slice.commitish === atlas.revision)
      && (!analysis || analysis.status === "parsed" && analysis.symbols.some((symbol) => symbol.startLine >= slice.startLine && symbol.endLine <= slice.endLine));
    if (completeSemantic) {
      level = "syntactic";
      signals.push("complete-semantic-unit");
    }
    const relations = supports.get(slice.repository)?.relations.filter((support) => support.supported && support.slices.some((item) => item.id === slice.id)) ?? [];
    if (relations.length) {
      if (completeSemantic) level = "resolved";
      signals.push("static-relation-candidate");
    }
    const samePathModalities = new Set(slices.filter((item) => item.repository === slice.repository && item.commitish === slice.commitish && item.path === slice.path && hasSemanticWindow(item))
      .flatMap((item) => modalitiesForPath(item.path, item)));
    const corroborated = relations.some((support) => support.relation.kind === "tests")
      || samePathModalities.has("implementation") && samePathModalities.has("test")
      || Boolean(supports.get(slice.repository)?.fixtures.some((support) => support.supported && support.slices.some((item) => item.id === slice.id)));
    if (corroborated && completeSemantic) {
      level = "corroborated";
      signals.push("cross-modal-corroboration");
    }
    if (hasSemanticWindow(slice) && !completeSemantic) limitations.push("The selected window does not contain a complete parsed declaration at the approved revision; syntax strength is withheld.");
    if (atlas?.relations.some((edge) => edge.from === slice.path || edge.to === slice.path) && !relations.length) limitations.push("An indexed relation does not support this window without its cited source lines and selected target evidence.");
    if (slice.sourceRoute?.selectionStatus === "structural-fallback") limitations.push("No language-specific semantic adapter owned this path; interpretation is text-bounded.");
    if (slice.sourceRoute?.selectionStatus === "ambiguous") limitations.push("Multiple semantic adapters claimed this path; routing failed closed to text.");
    if (slice.sourceRoute?.outcome === "line-window-fallback" && slice.sourceRoute.selectionStatus === "enhanced") limitations.push(`The selected ${slice.sourceRoute.selectedAnalyzer} adapter produced no complete semantic window.`);
    return { ...slice, evidenceStrength: { level, signals: unique(signals), limitations: unique(limitations) } };
  });
}

export function buildAnalysisQualityReport(atlas: RepositoryDesignAtlas, slices: EvidenceSlice[]): AnalysisQualityReport {
  // Recompute annotations here so imported/stale strength labels cannot award signals.
  const repositorySlices = annotateEvidenceStrength([atlas], repositoryEvidence(atlas, slices));
  const supportedRelations = atlas.relations.map((relation) => ({ relation, ...relationSupport(atlas, relation, repositorySlices) })).filter((support) => support.supported);
  const supportedFixtures = (atlas.fixtureRelations ?? []).map((fixture) => fixtureSupport(atlas, fixture, repositorySlices)).filter((support) => support.supported);
  const routes = new Map((atlas.sourceRoutes ?? []).map((route) => [route.path, route]));
  const analyses = new Map((atlas.sourceAnalyses ?? []).map((analysis) => [analysis.path, analysis]));
  const failedPaths = new Set((atlas.readFailures ?? []).map((failure) => failure.path));
  const paths = unique([...atlas.inspectedFiles.map((item) => item.path), ...failedPaths]);
  const files: AnalysisQualityReport["files"] = paths.map((path) => {
    const pathSlices = repositorySlices.filter((slice) => slice.path === path);
    const route = routes.get(path);
    const analysis = analyses.get(path);
    const relations = supportedRelations.filter((support) => support.relation.from === path || support.relation.to === path);
    const records = pathSlices.map((slice) => slice.evidenceStrength).filter((item): item is EvidenceStrengthRecord => Boolean(item));
    let level = records.length ? maxStrength(records.map((item) => item.level)) : failedPaths.has(path) ? "missing" as const : "textual" as const;
    const signals = records.flatMap((item) => item.signals);
    const limitations = records.flatMap((item) => item.limitations);
    if (analysis?.status === "parsed" && (analysis.symbols.length || analysis.manifest)) {
      if (compareEvidenceStrength(level, "syntactic") < 0) level = "syntactic";
      signals.push("parsed-static-structure");
    }
    if (relations.length && compareEvidenceStrength(level, "resolved") < 0) {
      level = "resolved";
      signals.push("static-relation-candidate");
    }
    if (analysis && analysis.status !== "parsed") limitations.push(...analysis.limitations);
    const pathModalities = unique(pathSlices.flatMap((slice) => modalitiesForPath(path, slice)).concat(modalitiesForPath(path))) as EvidenceKind[];
    if (compareEvidenceStrength(level, "syntactic") < 0 && pathModalities.some((kind) => kind === "implementation" || kind === "test")) limitations.push("Only textual source/test observability is available for this file.");
    return {
      ...sourceRef(atlas, path),
      level,
      signals: unique(signals),
      limitations: unique(limitations).slice(0, 12),
      modalities: pathModalities,
      ...(route ? { selectedAnalyzer: route.selectedAnalyzer, analysisStatus: route.analysisStatus } : {}),
    };
  });

  const implementation = repositorySlices.filter((slice) => modalitiesForPath(slice.path, slice).includes("implementation"));
  const tests = repositorySlices.filter((slice) => modalitiesForPath(slice.path, slice).includes("test"));
  const semanticImplementation = implementation.filter((slice) => slice.evidenceStrength?.signals.includes("complete-semantic-unit"));
  const semanticTests = tests.filter((slice) => slice.evidenceStrength?.signals.includes("complete-semantic-unit"));
  const parsedDeclarations = (atlas.sourceAnalyses ?? []).filter((analysis) => analysis.status === "parsed" && analysis.symbols.some((symbol) => symbol.role === "implementation"
    && coveringSlices(repositorySlices, analysis.path, symbol.startLine, symbol.endLine).length));
  const crossModalPaths = new Set(semanticImplementation.map((slice) => slice.path));
  const crossModalSlices = [
    ...supportedRelations.filter((support) => support.relation.kind === "tests").flatMap((support) => support.slices),
    ...supportedFixtures.flatMap((support) => support.slices),
    ...semanticTests.filter((slice) => crossModalPaths.has(slice.path)),
  ];

  const definitions: Array<{ name: string; points: number; sources: AtlasSourceRef[] }> = [
    { name: "readable-implementation-evidence", points: 15, sources: implementation.map((slice) => ({ path: slice.path, sourceUrl: slice.sourceUrl })) },
    { name: "readable-test-evidence", points: 15, sources: tests.map((slice) => ({ path: slice.path, sourceUrl: slice.sourceUrl })) },
    { name: "syntactic-implementation-evidence", points: 15, sources: semanticImplementation.map((slice) => ({ path: slice.path, sourceUrl: slice.sourceUrl })) },
    { name: "syntactic-test-evidence", points: 15, sources: semanticTests.map((slice) => ({ path: slice.path, sourceUrl: slice.sourceUrl })) },
    { name: "parsed-declaration-structure", points: 15, sources: parsedDeclarations.map((analysis) => ({ path: analysis.path, sourceUrl: analysis.sourceUrl })) },
    { name: "resolved-static-relationship-evidence", points: 10, sources: supportedRelations.map((support) => support.relation.evidence) },
    { name: "cross-modal-corroboration-evidence", points: 15, sources: crossModalSlices.map((slice) => ({ path: slice.path, sourceUrl: slice.sourceUrl })) },
  ];
  const signals = definitions.filter((signal) => signal.sources.length).map((signal) => ({ ...signal, sources: [...new Map(signal.sources.map((source) => [source.path, source])).values()].slice(0, 8) }));
  const counts: AnalysisQualityReport["counts"] = { missing: 0, textual: 0, syntactic: 0, resolved: 0, corroborated: 0 };
  files.forEach((file) => { counts[file.level]++; });
  const limitations = [
    "Semantic evidence quality measures bounded observability, not repository design merit or runtime correctness.",
    ...(files.some((file) => file.limitations.length) ? ["Some inspected files have parser, routing, or static-resolution limitations; inspect file-level records before raising review confidence."] : []),
    ...((atlas.unresolvedImports?.length ?? 0) > 0 ? [`${atlas.unresolvedImports!.length} static imports remain unresolved or ambiguous.`] : []),
    ...((atlas.readFailures?.length ?? 0) > 0 ? [`${atlas.readFailures!.length} bounded repository reads were incomplete.`] : []),
    ...(supportedRelations.length < atlas.relations.length ? ["Some indexed relationships lack both selected endpoints or source-line evidence; no relationship quality signal is awarded for those links."] : []),
    ...(supportedFixtures.length < (atlas.fixtureRelations?.length ?? 0) ? ["Some fixture candidates lack fully covered requester and fixture declarations; those links do not corroborate the evidence."] : []),
  ];
  return {
    schemaVersion: 1,
    score: signals.reduce((sum, signal) => sum + signal.points, 0),
    calibrationStatus: "observational-only",
    highestStrength: maxStrength(files.map((file) => file.level)),
    counts,
    signals,
    files,
    limitations,
  };
}

export function summarizeBundleStrength(slices: EvidenceSlice[]): NonNullable<import("./types.ts").EvidenceBundle["evidenceStrength"]> {
  const records = slices.map((slice) => slice.evidenceStrength ?? { level: "textual" as const, signals: ["bounded-text-window"], limitations: [] });
  return {
    strongest: maxStrength(records.map((record) => record.level)),
    weakest: minStrength(records.map((record) => record.level)),
    signals: unique(records.flatMap((record) => record.signals)).slice(0, 20),
  };
}
