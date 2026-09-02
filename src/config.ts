import { readFile } from "node:fs/promises";
import type { HarnessConfig } from "./types.ts";
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
  review: {
    minimumConfidence: 0.7,
    minimumEvidenceSlices: 1,
    maximumRisk: "medium",
  },
};

export async function loadConfig(path?: string): Promise<HarnessConfig> {
  if (!path) return structuredClone(defaultConfig);
  const input = JSON.parse(await readFile(path, "utf8")) as Partial<HarnessConfig>;
  const slicing = { ...defaultConfig.slicing, ...input.slicing };
  slicing.maxRepositories = learningRepositoryLimit(slicing.maxRepositories);
  return {
    github: { ...defaultConfig.github, ...input.github },
    acceptance: { ...defaultConfig.acceptance, ...input.acceptance },
    slicing,
    review: { ...defaultConfig.review, ...input.review },
  };
}
