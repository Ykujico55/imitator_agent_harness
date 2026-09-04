import type { HarnessConfig } from "./types.ts";

// This is a learning-context policy, not a legal determination or reuse grant.
export function assessLicense(license: string | null, config: HarnessConfig): { warnings: string[]; rejectionReasons: string[] } {
  const allowlisted = Boolean(license && config.acceptance.allowedLicenses.includes(license));
  const warnings = [
    license ? `license-metadata: ${license}` : "license-unknown: no reliable license metadata; terms require inspection",
    ...(license && !allowlisted ? ["license-not-allowlisted: inspect the applicable terms before reuse"] : []),
    "learning-only: reference selection does not authorize copying, redistribution, or dependency installation; preserve attribution and verify applicable terms before reuse",
  ];
  return {
    warnings,
    rejectionReasons: config.acceptance.licensePolicy === "allowlist" && !allowlisted
      ? ["license-policy: license is not allowlisted"] : [],
  };
}
