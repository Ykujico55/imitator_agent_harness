import { readFile } from "node:fs/promises";
import type { AtlasEvidenceCategory, HarnessConfig } from "./types.ts";
import { learningRepositoryLimit, MAX_LEARNING_REPOSITORIES } from "./reference.ts";

export const defaultConfig: HarnessConfig = {
  github: {
    minimumStars: 100,
    candidateLimit: 12,
    inspectLimit: 6,
  },
  acceptance: {
    minimumOverall: 60,
    minimumDomainMatch: 50,
    maximumRisk: 45,
    allowedLicenses: ["MIT", "Apache-2.0", "BSD-2-Clause", "BSD-3-Clause", "ISC"],
  },
  slicing: {
    maxRepositories: MAX_LEARNING_REPOSITORIES,
    maxFilesPerRepository: 12,
    maxLinesPerSlice: 60,
    maxSlices: 48,
    maxTotalCharacters: 120_000,
  },
  atlas: {
    maxFiles: 12,
    maxTotalCharacters: 120_000,
    minimumCoverage: 50,
    requiredCategories: ["source", "test"],
  },
  bundles: {
    maxBundlesPerRepository: 8,
    maxSlicesPerBundle: 6,
    minimumEvidenceKinds: 2,
  },
  review: {
    minimumConfidence: 0.7,
    minimumEvidenceSlices: 1,
    maximumRisk: "medium",
  },
};

function boundedInteger(value: unknown, fallback: number, minimum: number, maximum: number): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(minimum, Math.min(maximum, Math.floor(value)))
    : fallback;
}

export async function loadConfig(path?: string): Promise<HarnessConfig> {
  if (!path) return structuredClone(defaultConfig);
  const input = JSON.parse(await readFile(path, "utf8")) as Partial<HarnessConfig>;
  const slicing = { ...defaultConfig.slicing, ...input.slicing };
  slicing.maxRepositories = learningRepositoryLimit(slicing.maxRepositories);
  const atlas = { ...defaultConfig.atlas, ...input.atlas };
  const allowedCategories = new Set<AtlasEvidenceCategory>(["overview", "design", "manifest", "source", "test", "automation", "relationships"]);
  atlas.maxFiles = boundedInteger(atlas.maxFiles, defaultConfig.atlas.maxFiles, 1, 64);
  atlas.maxTotalCharacters = boundedInteger(atlas.maxTotalCharacters, defaultConfig.atlas.maxTotalCharacters, 10_000, 1_000_000);
  atlas.minimumCoverage = boundedInteger(atlas.minimumCoverage, defaultConfig.atlas.minimumCoverage, 0, 100);
  const requestedCategories = Array.isArray(atlas.requiredCategories) ? atlas.requiredCategories : [];
  atlas.requiredCategories = [...new Set(requestedCategories.filter((category) => allowedCategories.has(category)))];
  if (atlas.requiredCategories.length === 0) atlas.requiredCategories = [...defaultConfig.atlas.requiredCategories];
  const bundles = { ...defaultConfig.bundles, ...input.bundles };
  bundles.maxBundlesPerRepository = boundedInteger(bundles.maxBundlesPerRepository, defaultConfig.bundles.maxBundlesPerRepository, 1, 20);
  bundles.maxSlicesPerBundle = boundedInteger(bundles.maxSlicesPerBundle, defaultConfig.bundles.maxSlicesPerBundle, 2, 12);
  bundles.minimumEvidenceKinds = boundedInteger(bundles.minimumEvidenceKinds, defaultConfig.bundles.minimumEvidenceKinds, 1, 5);
  return {
    github: { ...defaultConfig.github, ...input.github },
    acceptance: { ...defaultConfig.acceptance, ...input.acceptance },
    slicing,
    atlas,
    bundles,
    review: { ...defaultConfig.review, ...input.review },
  };
}
