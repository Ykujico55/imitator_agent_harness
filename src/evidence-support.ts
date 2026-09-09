import type { EvidenceSlice, RepositoryDesignAtlas } from "./types.ts";

type EvidenceSupport = { supported: boolean; slices: EvidenceSlice[]; limitations: string[] };

export function repositoryEvidence(atlas: RepositoryDesignAtlas, slices: EvidenceSlice[]): EvidenceSlice[] {
  return slices.filter((slice) => slice.repository === atlas.repository && slice.commitish === atlas.revision);
}

/** Minimal deterministic witnesses for the entire inclusive interval, never mere overlap. */
export function coveringSlices(slices: EvidenceSlice[], path: string, startLine: number, endLine: number): EvidenceSlice[] {
  if (!Number.isSafeInteger(startLine) || !Number.isSafeInteger(endLine) || startLine < 1 || endLine < startLine) return [];
  const windows = slices.filter((slice) => slice.path === path && slice.startLine <= endLine && slice.endLine >= startLine)
    .sort((a, b) => b.endLine - a.endLine || a.startLine - b.startLine || a.id.localeCompare(b.id));
  const selected: EvidenceSlice[] = [];
  let next = startLine;
  while (next <= endLine) {
    const window = windows.find((slice) => slice.startLine <= next && slice.endLine >= next);
    if (!window) return [];
    selected.push(window);
    next = window.endLine + 1;
  }
  return selected;
}

function uniqueSlices(slices: EvidenceSlice[]): EvidenceSlice[] {
  return [...new Map(slices.map((slice) => [slice.id, slice])).values()].sort((a, b) => a.id.localeCompare(b.id));
}

export function relationSupport(
  atlas: RepositoryDesignAtlas,
  relation: RepositoryDesignAtlas["relations"][number],
  allSlices: EvidenceSlice[],
): EvidenceSupport {
  const slices = repositoryEvidence(atlas, allSlices);
  const location = /#L(\d+)(?:-L?(\d+))?$/.exec(relation.evidence.sourceUrl);
  const source = relation.evidence.path === relation.from && location
    ? coveringSlices(slices, relation.from, Number(location[1]), Number(location[2] ?? location[1])) : [];
  const target = slices.filter((slice) => slice.path === relation.to)
    .sort((a, b) => Number(b.strategy !== undefined && b.strategy !== "line-window") - Number(a.strategy !== undefined && a.strategy !== "line-window")
      || b.relevance - a.relevance || a.startLine - b.startLine || a.id.localeCompare(b.id)).slice(0, 1);
  const limitations: string[] = [];
  if (!location || relation.evidence.path !== relation.from) limitations.push(`Relationship ${relation.from} -> ${relation.to} has no trustworthy source-line location; static resolution is withheld.`);
  else if (!source.length) limitations.push(`Relationship ${relation.from} -> ${relation.to} lacks the cited source lines ${location[1]}-${location[2] ?? location[1]}; static resolution is withheld.`);
  if (!target.length) limitations.push(`Relationship ${relation.from} -> ${relation.to} lacks target-file evidence; static resolution is withheld.`);
  return { supported: limitations.length === 0, slices: uniqueSlices([...source, ...target]), limitations };
}

export function fixtureSupport(
  atlas: RepositoryDesignAtlas,
  fixture: NonNullable<RepositoryDesignAtlas["fixtureRelations"]>[number],
  allSlices: EvidenceSlice[],
): EvidenceSupport {
  const slices = repositoryEvidence(atlas, allSlices);
  const requester = atlas.sourceAnalyses?.find((analysis) => analysis.path === fixture.testPath && analysis.status === "parsed")
    ?.symbols.find((symbol) => symbol.name === fixture.testSymbol && (symbol.role === "test" || symbol.role === "fixture")
      && symbol.fixtureRequests?.includes(fixture.request));
  const provider = atlas.sourceAnalyses?.find((analysis) => analysis.path === fixture.fixturePath && analysis.status === "parsed")
    ?.symbols.find((symbol) => symbol.name === fixture.fixtureSymbol && symbol.role === "fixture"
      && (symbol.fixtureName || symbol.name.split(".").at(-1)) === fixture.request);
  const requestSlices = requester ? coveringSlices(slices, fixture.testPath, requester.startLine, requester.endLine) : [];
  const providerSlices = provider && fixture.fixturePath ? coveringSlices(slices, fixture.fixturePath, provider.startLine, provider.endLine) : [];
  const limitations: string[] = [];
  if (fixture.status !== "candidate") limitations.push(`Fixture ${fixture.testPath}:${fixture.testSymbol} -> ${fixture.request} remains unresolved: ${fixture.reason}`);
  if (!requestSlices.length) limitations.push(`Fixture request ${fixture.testPath}:${fixture.testSymbol} -> ${fixture.request} lacks a fully covered parsed requester; corroboration is withheld.`);
  if (!providerSlices.length) limitations.push(`Fixture request ${fixture.testPath}:${fixture.testSymbol} -> ${fixture.request} lacks a fully covered parsed fixture declaration; corroboration is withheld.`);
  return { supported: limitations.length === 0, slices: uniqueSlices([...requestSlices, ...providerSlices]), limitations };
}

/** A routing fallback never inherits the semantic status of a different file/window. */
export function hasSemanticWindow(slice: EvidenceSlice): boolean {
  return Boolean(slice.strategy && slice.strategy !== "line-window"
    && (!slice.sourceRoute || slice.sourceRoute.outcome === "semantic-window" && slice.sourceRoute.selectionStatus === "enhanced"));
}
