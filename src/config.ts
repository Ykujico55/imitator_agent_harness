import { readFile } from "node:fs/promises";
import type { HarnessConfig } from "./types.ts";

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
    maxRepositories: 3,
    maxFilesPerRepository: 6,
    maxLinesPerSlice: 60,
    maxSlices: 18,
    maxTotalCharacters: 50_000,
  },
};

export async function loadConfig(path?: string): Promise<HarnessConfig> {
  if (!path) return structuredClone(defaultConfig);
  const input = JSON.parse(await readFile(path, "utf8")) as Partial<HarnessConfig>;
  return {
    github: { ...defaultConfig.github, ...input.github },
    acceptance: { ...defaultConfig.acceptance, ...input.acceptance },
    slicing: { ...defaultConfig.slicing, ...input.slicing },
  };
}
