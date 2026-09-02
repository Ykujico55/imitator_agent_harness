import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { GitHubClient } from "./github.ts";
import { rankSearchCandidates } from "./discovery.ts";
import type { DesignConfirmation, DesignGateResult, GateResult, HarnessConfig, ReferencePack, RepositoryProfile, ReviewSubmission, TaskSpec } from "./types.ts";
import { renderAdaptationBrief, renderDesignAgentContext, renderDesignDossier } from "./design-render.ts";
import { buildDesignDossierRequest, buildDesignDossierTemplate } from "./design.ts";
import { planQueries } from "./query.ts";
import { assessRepository } from "./score.ts";
import { collectSlices, type SemanticSliceSelector } from "./slice.ts";
import { inferPractices, renderAgentContext, renderReference } from "./render.ts";
import { buildReviewRequest, buildReviewTemplate, renderGateReport } from "./review.ts";

async function mapLimited<T, R>(items: T[], concurrency: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await fn(items[index]!);
    }
  });
  await Promise.all(workers);
  return results;
}

export async function prepareReferencePack(
  client: GitHubClient,
  task: TaskSpec,
  config: HarnessConfig,
  options: { semanticSelector?: SemanticSliceSelector } = {},
): Promise<ReferencePack> {
  const queries = planQueries(task, config);
  if (!queries.length) throw new Error("Could not derive a GitHub query; pass --query explicitly.");
  const batches = await mapLimited(queries, 3, (query) => client.searchRepositories(query, config.github.candidateLimit));
  const candidates = rankSearchCandidates(batches, task, config.github.inspectLimit).map((candidate) => candidate.repository);
  const profileResults = await mapLimited(candidates, 3, async (candidate): Promise<RepositoryProfile | null> => {
    try { return await client.profile(candidate); } catch { return null; }
  });
  const assessments = profileResults.filter((profile): profile is RepositoryProfile => profile !== null)
    .map((profile) => assessRepository(profile, task, config))
    .sort((a, b) => Number(b.accepted) - Number(a.accepted) || b.overall - a.overall || a.repository.fullName.localeCompare(b.repository.fullName));
  const slices = await collectSlices(client, assessments, task, config, options.semanticSelector);
  return {
    schemaVersion: 2,
    generatedAt: new Date().toISOString(),
    task, queries, assessments, slices,
    practices: inferPractices({ assessments, slices }),
  };
}

export async function writeReferencePack(pack: ReferencePack, outputRoot: string): Promise<string> {
  const stamp = pack.generatedAt.replace(/[:.]/g, "-");
  const directory = resolve(outputRoot, stamp);
  await mkdir(directory, { recursive: true });
  const reviewRequest = buildReviewRequest(pack);
  const reviewTemplate = buildReviewTemplate(reviewRequest);
  await Promise.all([
    writeFile(resolve(directory, "manifest.json"), `${JSON.stringify(pack, null, 2)}\n`, "utf8"),
    writeFile(resolve(directory, "REFERENCE.md"), renderReference(pack), "utf8"),
    writeFile(resolve(directory, "AGENT_CONTEXT.md"), renderAgentContext(pack), "utf8"),
    writeFile(resolve(directory, "REVIEW_REQUEST.json"), `${JSON.stringify(reviewRequest, null, 2)}\n`, "utf8"),
    writeFile(resolve(directory, "REVIEW_TEMPLATE.json"), `${JSON.stringify(reviewTemplate, null, 2)}\n`, "utf8"),
  ]);
  return directory;
}

export async function writeGateResult(result: GateResult, submission: ReviewSubmission, outputDirectory: string): Promise<string> {
  const directory = resolve(outputDirectory);
  await mkdir(directory, { recursive: true });
  await Promise.all([
    writeFile(resolve(directory, "gate-result.json"), `${JSON.stringify(result, null, 2)}\n`, "utf8"),
    writeFile(resolve(directory, "REVIEW_SUBMISSION.json"), `${JSON.stringify(submission, null, 2)}\n`, "utf8"),
    writeFile(resolve(directory, "GATE_REPORT.md"), renderGateReport(result, submission.reviewer), "utf8"),
    writeFile(resolve(directory, "APPROVED_REFERENCE.md"), renderReference(result.approvedPack), "utf8"),
    writeFile(resolve(directory, "APPROVED_AGENT_CONTEXT.md"), renderAgentContext(result.approvedPack), "utf8"),
  ]);
  return directory;
}

export async function writeDesignRequest(referenceGate: GateResult, taskFingerprint: string, outputDirectory: string): Promise<string> {
  const directory = resolve(outputDirectory);
  await mkdir(directory, { recursive: true });
  const request = buildDesignDossierRequest(referenceGate, taskFingerprint);
  const template = buildDesignDossierTemplate(request);
  await Promise.all([
    writeFile(resolve(directory, "DESIGN_DOSSIER_REQUEST.json"), `${JSON.stringify(request, null, 2)}\n`, "utf8"),
    writeFile(resolve(directory, "DESIGN_DOSSIER_TEMPLATE.json"), `${JSON.stringify(template, null, 2)}\n`, "utf8"),
  ]);
  return directory;
}

export async function writeDesignProposal(result: DesignGateResult, referenceGate: GateResult, outputDirectory: string): Promise<string> {
  const directory = resolve(outputDirectory);
  await mkdir(directory, { recursive: true });
  await Promise.all([
    writeFile(resolve(directory, "design-gate-result.json"), `${JSON.stringify(result, null, 2)}\n`, "utf8"),
    writeFile(resolve(directory, "DESIGN_DOSSIER.json"), `${JSON.stringify(result.dossier, null, 2)}\n`, "utf8"),
    writeFile(resolve(directory, "DESIGN_DOSSIER.md"), renderDesignDossier(result.dossier, referenceGate), "utf8"),
    writeFile(resolve(directory, "ADAPTATION_BRIEF.md"), renderAdaptationBrief(result.dossier), "utf8"),
  ]);
  return directory;
}

export async function writeDesignResult(
  result: DesignGateResult,
  confirmation: DesignConfirmation,
  referenceGate: GateResult,
  outputDirectory: string,
): Promise<string> {
  const directory = resolve(outputDirectory);
  await writeDesignProposal(result, referenceGate, directory);
  await Promise.all([
    writeFile(resolve(directory, "DESIGN_CONFIRMATION.json"), `${JSON.stringify(confirmation, null, 2)}\n`, "utf8"),
    writeFile(resolve(directory, "APPROVED_AGENT_CONTEXT.md"), renderDesignAgentContext(result), "utf8"),
  ]);
  return directory;
}
