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
    licensePolicy: "warn",
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

function boundedNumber(value: unknown, fallback: number, minimum: number, maximum: number): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(minimum, Math.min(maximum, value))
    : fallback;
}

function objectSection(value: unknown, label: string): Record<string, unknown> {
  if (value === undefined) return {};
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error(`${label} config must be an object`);
  return value as Record<string, unknown>;
}

export async function loadConfig(path?: string): Promise<HarnessConfig> {
  if (!path) return structuredClone(defaultConfig);
  const parsed: unknown = JSON.parse(await readFile(path, "utf8"));
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw new Error("imitator config must be an object");
  const input = parsed as Record<string, unknown>;
  const githubInput = objectSection(input.github, "github");
  const acceptanceInput = objectSection(input.acceptance, "acceptance");
  const slicingInput = objectSection(input.slicing, "slicing");
  const atlasInput = objectSection(input.atlas, "atlas");
  const bundlesInput = objectSection(input.bundles, "bundles");
  const reviewInput = objectSection(input.review, "review");
  const acceptance = { ...defaultConfig.acceptance, ...acceptanceInput } as HarnessConfig["acceptance"];
  if (acceptance.licensePolicy !== "warn" && acceptance.licensePolicy !== "allowlist") {
    throw new Error("acceptance.licensePolicy must be warn or allowlist");
  }
  if ("allowedLicenses" in acceptanceInput && (!Array.isArray(acceptanceInput.allowedLicenses)
    || acceptanceInput.allowedLicenses.some((item) => typeof item !== "string" || !item.trim()))) {
    throw new Error("acceptance.allowedLicenses must be an array of non-empty strings");
  }
  acceptance.minimumOverall = boundedNumber(acceptance.minimumOverall, defaultConfig.acceptance.minimumOverall, 0, 100);
  acceptance.minimumDomainMatch = boundedNumber(acceptance.minimumDomainMatch, defaultConfig.acceptance.minimumDomainMatch, 0, 100);
  acceptance.maximumRisk = boundedNumber(acceptance.maximumRisk, defaultConfig.acceptance.maximumRisk, 0, 100);
  acceptance.allowedLicenses = [...new Set(acceptance.allowedLicenses.map((item) => item.trim()))];

  const github = { ...defaultConfig.github, ...githubInput } as HarnessConfig["github"];
  github.minimumStars = boundedInteger(github.minimumStars, defaultConfig.github.minimumStars, 0, 1_000_000);
  github.candidateLimit = boundedInteger(github.candidateLimit, defaultConfig.github.candidateLimit, 1, 100);
  github.inspectLimit = boundedInteger(github.inspectLimit, defaultConfig.github.inspectLimit, 1, 100);

  const slicing = { ...defaultConfig.slicing, ...slicingInput } as HarnessConfig["slicing"];
  slicing.maxRepositories = learningRepositoryLimit(slicing.maxRepositories);
  slicing.maxFilesPerRepository = boundedInteger(slicing.maxFilesPerRepository, defaultConfig.slicing.maxFilesPerRepository, 1, 12);
  slicing.maxLinesPerSlice = boundedInteger(slicing.maxLinesPerSlice, defaultConfig.slicing.maxLinesPerSlice, 1, 500);
  slicing.maxSlices = boundedInteger(slicing.maxSlices, defaultConfig.slicing.maxSlices, 1, 48);
  slicing.maxTotalCharacters = boundedInteger(slicing.maxTotalCharacters, defaultConfig.slicing.maxTotalCharacters, 1, 120_000);

  const atlas = { ...defaultConfig.atlas, ...atlasInput } as HarnessConfig["atlas"];
  const allowedCategories = new Set<AtlasEvidenceCategory>(["overview", "design", "manifest", "source", "test", "automation", "relationships"]);
  atlas.maxFiles = boundedInteger(atlas.maxFiles, defaultConfig.atlas.maxFiles, 1, 64);
  atlas.maxTotalCharacters = boundedInteger(atlas.maxTotalCharacters, defaultConfig.atlas.maxTotalCharacters, 10_000, 1_000_000);
  atlas.minimumCoverage = boundedInteger(atlas.minimumCoverage, defaultConfig.atlas.minimumCoverage, 0, 100);
  const requestedCategories = Array.isArray(atlas.requiredCategories) ? atlas.requiredCategories : [];
  atlas.requiredCategories = [...new Set(requestedCategories.filter((category) => allowedCategories.has(category)))];
  if (atlas.requiredCategories.length === 0) atlas.requiredCategories = [...defaultConfig.atlas.requiredCategories];
  const bundles = { ...defaultConfig.bundles, ...bundlesInput } as HarnessConfig["bundles"];
  bundles.maxBundlesPerRepository = boundedInteger(bundles.maxBundlesPerRepository, defaultConfig.bundles.maxBundlesPerRepository, 1, 20);
  bundles.maxSlicesPerBundle = boundedInteger(bundles.maxSlicesPerBundle, defaultConfig.bundles.maxSlicesPerBundle, 2, 12);
  bundles.minimumEvidenceKinds = boundedInteger(bundles.minimumEvidenceKinds, defaultConfig.bundles.minimumEvidenceKinds, 1, 5);
  bundles.minimumEvidenceKinds = Math.min(bundles.minimumEvidenceKinds, bundles.maxSlicesPerBundle);

  const review = { ...defaultConfig.review, ...reviewInput } as HarnessConfig["review"];
  if (review.maximumRisk !== "low" && review.maximumRisk !== "medium" && review.maximumRisk !== "high") {
    throw new Error("review.maximumRisk must be low, medium or high");
  }
  review.minimumConfidence = boundedNumber(review.minimumConfidence, defaultConfig.review.minimumConfidence, 0, 1);
  review.minimumEvidenceSlices = boundedInteger(review.minimumEvidenceSlices, defaultConfig.review.minimumEvidenceSlices, 1, 48);
  return {
    github,
    acceptance,
    slicing,
    atlas,
    bundles,
    review,
  };
}
