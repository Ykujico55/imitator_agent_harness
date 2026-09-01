import type { HarnessConfig, RepositoryAssessment, RepositoryProfile, ScoreDimension, TaskSpec } from "./types.ts";
import { taskTerms } from "./query.ts";

const clamp = (value: number): number => Math.max(0, Math.min(100, Math.round(value)));
const dimension = (score: number, reasons: string[]): ScoreDimension => ({ score: clamp(score), reasons });
const hasPath = (paths: string[], pattern: RegExp): boolean => paths.some((path) => pattern.test(path));

export function assessRepository(repo: RepositoryProfile, task: TaskSpec, config: HarnessConfig, now = new Date()): RepositoryAssessment {
  const files = repo.tree.filter((entry) => entry.type === "blob").map((entry) => entry.path);
  const terms = taskTerms(task);
  const normalize = (value: string): string => value.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/g, "");
  const metadata = normalize(`${repo.fullName} ${repo.description} ${repo.topics.join(" ")}`);
  const paths = normalize(files.slice(0, 250).join(" "));
  const metadataMatches = terms.filter((term) => metadata.includes(normalize(term)));
  const pathMatches = terms.filter((term) => paths.includes(normalize(term)));
  const anchorTerms = terms.filter((term) => term.includes("-") || term.includes("+"));
  const anchorMatches = anchorTerms.filter((term) => metadata.includes(normalize(term)));
  const metadataCoverage = terms.length ? metadataMatches.length / terms.length : 0;
  const pathCoverage = terms.length ? pathMatches.length / terms.length : 0;
  const hasDomainAnchor = anchorTerms.length > 0 && anchorMatches.length > 0;
  const domainScore = terms.length
    ? (hasDomainAnchor ? 40 + metadataCoverage * 40 + pathCoverage * 15 : 10 + metadataCoverage * 50 + pathCoverage * 10)
    : 35;
  const domainReasons = metadataMatches.length
    ? [`Metadata signals: ${metadataMatches.join(", ")}`, ...(anchorMatches.length ? [`Core domain anchors: ${anchorMatches.join(", ")}`] : ["No core domain anchor in repository metadata"])]
    : ["No task-specific signal in repository metadata"];

  const maturityReasons: string[] = [];
  let maturity = Math.min(38, Math.log10(repo.stars + 1) * 11) + Math.min(12, Math.log10(repo.forks + 1) * 5);
  if (hasPath(files, /(^|\/)(test|tests|spec|__tests__)(\/|$)/i)) { maturity += 18; maturityReasons.push("Dedicated test tree"); }
  if (hasPath(files, /^\.github\/workflows\/.+\.ya?ml$/i)) { maturity += 12; maturityReasons.push("Automated CI workflow"); }
  if (hasPath(files, /(^|\/)(CONTRIBUTING|SECURITY|CODE_OF_CONDUCT)(\.md)?$/i)) { maturity += 8; maturityReasons.push("Project governance documentation"); }
  const daysSincePush = Math.max(0, (now.getTime() - new Date(repo.pushedAt).getTime()) / 86_400_000);
  if (daysSincePush < 180) { maturity += 8; maturityReasons.push("Recently maintained"); }
  else if (daysSincePush > 730) maturityReasons.push("Maintenance appears stale");

  const transferReasons: string[] = [];
  let transfer = 20;
  if (repo.license && config.acceptance.allowedLicenses.includes(repo.license)) { transfer += 45; transferReasons.push(`Permissive license: ${repo.license}`); }
  else transferReasons.push(repo.license ? `License not allowlisted: ${repo.license}` : "License is missing or unclear");
  if (hasPath(files, /(^|\/)(examples?|samples?)(\/|$)/i)) { transfer += 15; transferReasons.push("Contains examples"); }
  if (hasPath(files, /(^|\/)(packages?|src|lib)(\/|$)/i)) { transfer += 10; transferReasons.push("Implementation boundaries are visible"); }
  if (repo.sizeKb < 150_000) { transfer += 10; transferReasons.push("Repository size is inspectable"); }

  const clarityReasons: string[] = [];
  let clarity = 20;
  if (hasPath(files, /^README(\.[^.]+)?$/i)) { clarity += 18; clarityReasons.push("Root README"); }
  if (hasPath(files, /(^|\/)(docs|architecture|adr)(\/|$)/i)) { clarity += 22; clarityReasons.push("Architecture or documentation tree"); }
  if (hasPath(files, /(^|\/)(examples?|samples?)(\/|$)/i)) { clarity += 18; clarityReasons.push("Executable usage examples"); }
  if (hasPath(files, /(^|\/)(package\.json|pyproject\.toml|Cargo\.toml|go\.mod)$/i)) { clarity += 12; clarityReasons.push("Machine-readable project manifest"); }
  if (files.length > 30_000) { clarity -= 15; clarityReasons.push("Very large tree may obscure patterns"); }

  const designReasons: string[] = [];
  let design = 25;
  if (hasPath(files, /(^|\/)(src|lib|packages)(\/|$)/i)) { design += 15; designReasons.push("Separated implementation tree"); }
  if (hasPath(files, /(^|\/)(test|tests|spec|__tests__)(\/|$)/i)) { design += 20; designReasons.push("Design is exercised by tests"); }
  if (hasPath(files, /(^|\/)(architecture|adr|rfcs?)(\/|$)/i)) { design += 15; designReasons.push("Design decisions are documented"); }
  if (hasPath(files, /(^|\/)(eslint|biome|ruff|clippy|golangci|tsconfig|mypy)/i)) { design += 10; designReasons.push("Static engineering checks are configured"); }
  if (hasPath(files, /^\.github\/workflows\//i)) { design += 10; designReasons.push("Continuous verification exists"); }

  const riskReasons: string[] = [];
  let risk = 5;
  if (!repo.license) { risk += 55; riskReasons.push("No machine-detectable license"); }
  else if (!config.acceptance.allowedLicenses.includes(repo.license)) { risk += 35; riskReasons.push(`License requires review: ${repo.license}`); }
  if (repo.archived) { risk += 30; riskReasons.push("Repository is archived"); }
  if (repo.fork) { risk += 10; riskReasons.push("Repository is a fork"); }
  if (daysSincePush > 730) { risk += 18; riskReasons.push("No recent maintenance signal"); }
  if (repo.sizeKb > 300_000) { risk += 8; riskReasons.push("Large attack and review surface"); }
  if (!riskReasons.length) riskReasons.push("No elevated metadata risk detected");

  const dimensions = {
    domainMatch: dimension(domainScore, domainReasons),
    engineeringMaturity: dimension(maturity, maturityReasons),
    transferability: dimension(transfer, transferReasons),
    patternClarity: dimension(clarity, clarityReasons),
    designQuality: dimension(design, designReasons),
    risk: dimension(risk, riskReasons),
  };
  const overall = clamp(
    dimensions.domainMatch.score * 0.30 + dimensions.engineeringMaturity.score * 0.18 +
    dimensions.transferability.score * 0.17 + dimensions.patternClarity.score * 0.14 +
    dimensions.designQuality.score * 0.16 + (100 - dimensions.risk.score) * 0.05,
  );
  const rejectionReasons: string[] = [];
  if (overall < config.acceptance.minimumOverall) rejectionReasons.push(`Overall ${overall} < ${config.acceptance.minimumOverall}`);
  if (dimensions.domainMatch.score < config.acceptance.minimumDomainMatch) rejectionReasons.push(`Domain match ${dimensions.domainMatch.score} < ${config.acceptance.minimumDomainMatch}`);
  if (dimensions.risk.score > config.acceptance.maximumRisk) rejectionReasons.push(`Risk ${dimensions.risk.score} > ${config.acceptance.maximumRisk}`);
  if (!repo.license || !config.acceptance.allowedLicenses.includes(repo.license)) rejectionReasons.push("License is not allowlisted");
  return { repository: repo, dimensions, overall, accepted: rejectionReasons.length === 0, rejectionReasons };
}
