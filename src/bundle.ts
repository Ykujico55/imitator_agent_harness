import { createHash } from "node:crypto";
import type { EvidenceBundle, EvidenceKind, EvidenceSlice, HarnessConfig, RepositoryDesignAtlas } from "./types.ts";
import { isTestPath, isTestSupportPath } from "./evidence-path.ts";
import { summarizeBundleStrength } from "./analysis-quality.ts";

const DOCUMENTATION = /(^|\/)(README|docs?|architecture|design|adr|rfcs?)(\/|\.|$)|(^|\/)(ADR|RFC)-?\d+/i;
const DESIGN_DECISION = /(^|\/)(architecture|design|adr|rfcs?)(\/|\.|$)|(^|\/)(ADR|RFC)-?\d+/i;
const MANIFEST = /(^|\/)(package\.json|pyproject\.toml|setup\.cfg|Cargo\.toml|go\.mod|pom\.xml|build\.gradle(?:\.kts)?)$/i;
const FAILURE = /\b(error|errors|failure|failures|exception|exceptions|retry|timeout|abort|reject|invalid|panic|catch|throw)\b/i;

export function supportsExplicitIntent(slice: Pick<EvidenceSlice, "path">): boolean {
  return DESIGN_DECISION.test(slice.path);
}

export function evidenceKind(slice: EvidenceSlice): EvidenceKind {
  if (MANIFEST.test(slice.path)) return "manifest";
  if (isTestSupportPath(slice.path)) return "test-support";
  if (slice.evidenceRoles?.includes("test") && !slice.evidenceRoles.includes("implementation")) return "test";
  if (isTestPath(slice.path)) return "test";
  if (DOCUMENTATION.test(slice.path)) return "documentation";
  return "implementation";
}

export function evidenceKindsForSlice(slice: EvidenceSlice): EvidenceKind[] {
  const semantic = slice.evidenceRoles ?? [];
  const kinds: EvidenceKind[] = [];
  if (semantic.includes("implementation")) kinds.push("implementation");
  if (semantic.includes("test")) kinds.push("test");
  return kinds.length ? kinds : [evidenceKind(slice)];
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

function selectDiverse(slices: EvidenceSlice[], limit: number): EvidenceSlice[] {
  const sorted = [...slices].sort((a, b) => b.relevance - a.relevance || a.path.localeCompare(b.path));
  const selected: EvidenceSlice[] = [];
  const seen = new Set<string>();
  for (const kind of ["documentation", "manifest", "implementation", "test"] as EvidenceKind[]) {
    const candidate = sorted.find((slice) => evidenceKind(slice) === kind && !seen.has(slice.id));
    if (candidate) { selected.push(candidate); seen.add(candidate.id); }
  }
  for (const slice of sorted) {
    if (selected.length >= limit) break;
    if (!seen.has(slice.id)) { selected.push(slice); seen.add(slice.id); }
  }
  return selected.slice(0, limit);
}

function bundleId(repository: string, revision: string, concern: EvidenceBundle["concern"], discriminator: string): string {
  return createHash("sha256").update(`${repository}\0${revision}\0${concern}\0${discriminator}`).digest("hex").slice(0, 16);
}

function createBundle(input: {
  atlas: RepositoryDesignAtlas;
  concern: EvidenceBundle["concern"];
  discriminator: string;
  question: string;
  slices: EvidenceSlice[];
  config: HarnessConfig;
}): EvidenceBundle | undefined {
  const selected = selectDiverse(input.slices, input.config.bundles.maxSlicesPerBundle);
  if (!selected.length) return undefined;
  const selectedPaths = new Set(selected.map((slice) => slice.path));
  const relations = input.atlas.relations.filter((relation) => selectedPaths.has(relation.from) || selectedPaths.has(relation.to)).slice(0, 24);
  const evidenceKinds = unique([
    ...selected.flatMap(evidenceKindsForSlice),
    ...(relations.length ? ["relationship" as const] : []),
  ]).sort();
  if (evidenceKinds.length < input.config.bundles.minimumEvidenceKinds) return undefined;
  const explicit = selected.some(supportsExplicitIntent);
  const limitations: string[] = [];
  if (!explicit) limitations.push("No ADR, RFC, architecture, or design document supports an explicit rationale; treat intent as observed unless separately evidenced.");
  if (!relations.length) limitations.push("No resolved dependency relation connects the selected evidence within the bounded Atlas inspection.");
  if (!evidenceKinds.includes("test")) limitations.push("This bundle has no direct test evidence.");
  if (relations.some((edge) => edge.resolution === "static-candidate")) limitations.push("Python relations identify static file candidates, not verified runtime imports; package exports can shadow from-import child modules.");
  if (relations.some((edge) => edge.resolution === "rust-module-candidate")) limitations.push("Rust relations are filesystem-backed module candidates; cfg evaluation, macro expansion, generated modules and extern-prelude resolution are not verified.");
  if (relations.some((edge) => edge.context?.length || edge.scope && edge.scope !== "module")) limitations.push("Some dependency observations are conditional, optional, type-only or local-scope; they are not unconditional runtime dependencies.");
  limitations.push(...unique(selected.flatMap((slice) => slice.evidenceStrength?.limitations ?? [])).slice(0, 6));
  return {
    schemaVersion: 1,
    id: bundleId(input.atlas.repository, input.atlas.revision, input.concern, input.discriminator),
    repository: input.atlas.repository,
    concern: input.concern,
    question: input.question,
    epistemicCeiling: explicit ? "explicit" : "observed",
    evidenceKinds,
    evidenceSliceIds: selected.map((slice) => slice.id),
    relatedPaths: unique([...selected.map((slice) => slice.path), ...relations.flatMap((relation) => [relation.from, relation.to])]).sort(),
    relations,
    evidenceStrength: summarizeBundleStrength(selected),
    limitations,
  };
}

export function buildEvidenceBundles(
  atlases: RepositoryDesignAtlas[],
  slices: EvidenceSlice[],
  config: HarnessConfig,
): EvidenceBundle[] {
  const bundles: EvidenceBundle[] = [];
  for (const atlas of atlases) {
    const repositoryBundles: EvidenceBundle[] = [];
    const add = (bundle: EvidenceBundle | undefined): void => {
      if (bundle && repositoryBundles.length < config.bundles.maxBundlesPerRepository) repositoryBundles.push(bundle);
    };
    const repositorySlices = slices.filter((slice) => slice.repository === atlas.repository);
    if (!repositorySlices.length) continue;
    const architecturePaths = new Set(atlas.architectureDocuments.map((item) => item.path));
    const entryPaths = new Set(atlas.entryPoints.map((item) => item.path));
    const manifestPaths = new Set(atlas.manifests.map((item) => item.path));
    const testPaths = new Set(atlas.testFiles.map((item) => item.path));

    const system = createBundle({
      atlas,
      concern: "system-architecture",
      discriminator: "system",
      question: "What responsibilities, boundaries, and verification mechanisms define the repository's overall architecture?",
      slices: repositorySlices.filter((slice) => architecturePaths.has(slice.path) || entryPaths.has(slice.path) || manifestPaths.has(slice.path) || testPaths.has(slice.path)),
      config,
    });
    add(system);

    const technology = createBundle({
      atlas,
      concern: "technology-selection",
      discriminator: "technology",
      question: "Which technologies and dependency boundaries are observable, and is any selection rationale explicit?",
      slices: repositorySlices.filter((slice) => manifestPaths.has(slice.path) || DESIGN_DECISION.test(slice.path)),
      config,
    });
    add(technology);

    const testedTargets = new Set(atlas.relations.filter((relation) => relation.kind === "tests").flatMap((relation) => [relation.from, relation.to]));
    const testing = createBundle({
      atlas,
      concern: "testing-strategy",
      discriminator: "testing",
      question: "What behavior is verified at which boundary, and what acts as the observable test oracle?",
      slices: repositorySlices.filter((slice) => testPaths.has(slice.path) || isTestSupportPath(slice.path) || testedTargets.has(slice.path) || architecturePaths.has(slice.path)),
      config,
    });
    add(testing);

    const failure = createBundle({
      atlas,
      concern: "failure-semantics",
      discriminator: "failure",
      question: "How are invalid states, operational failures, retries, and error outcomes represented and tested?",
      slices: repositorySlices.filter((slice) => FAILURE.test(slice.content)),
      config,
    });
    add(failure);

    for (const module of atlas.modules.filter((item) => item.kind === "application" || item.kind === "library" || item.kind === "package")) {
      if (repositoryBundles.length >= config.bundles.maxBundlesPerRepository) break;
      const modulePaths = new Set(atlas.relations
        .filter((relation) => relation.from.startsWith(`${module.rootPath}/`) || relation.to.startsWith(`${module.rootPath}/`))
        .flatMap((relation) => [relation.from, relation.to]));
      const moduleSlices = repositorySlices.filter((slice) => slice.path === module.rootPath || slice.path.startsWith(`${module.rootPath}/`) || modulePaths.has(slice.path));
      add(createBundle({
        atlas,
        concern: "module-boundary",
        discriminator: module.rootPath,
        question: `How does ${module.rootPath} define its responsibility, collaborators, and test boundary?`,
        slices: moduleSlices,
        config,
      }));
    }
    bundles.push(...repositoryBundles);
  }
  return bundles.sort((a, b) => a.repository.localeCompare(b.repository) || a.concern.localeCompare(b.concern) || a.id.localeCompare(b.id));
}

export function renderEvidenceBundles(bundles: EvidenceBundle[], slices: EvidenceSlice[]): string {
  const sliceById = new Map(slices.map((slice) => [slice.id, slice]));
  const lines = ["# Evidence bundles", "", "Bundles preserve relationships between bounded evidence slices. They are evidence packets, not design conclusions.", ""];
  for (const bundle of bundles) {
    lines.push(
      `## ${bundle.repository} — ${bundle.concern} (${bundle.id})`,
      "",
      `Question: ${bundle.question}`,
      `Epistemic ceiling: ${bundle.epistemicCeiling}`,
      `Evidence kinds: ${bundle.evidenceKinds.join(", ")}`,
      `Evidence strength: ${bundle.evidenceStrength ? `${bundle.evidenceStrength.weakest}..${bundle.evidenceStrength.strongest}` : "legacy/unknown"}`,
      `Slices: ${bundle.evidenceSliceIds.map((id) => `${id}:${sliceById.get(id)?.path ?? "unknown"}`).join(", ")}`,
      `Relations: ${bundle.relations.map((relation) => `${relation.from} -> ${relation.to} [${relation.kind}]`).join("; ") || "none"}`,
      "",
      "Limitations:",
      ...(bundle.limitations.length ? bundle.limitations.map((item) => `- ${item}`) : ["- No deterministic limitation recorded; semantic review is still required."]),
      "",
    );
  }
  return `${lines.join("\n")}\n`;
}
