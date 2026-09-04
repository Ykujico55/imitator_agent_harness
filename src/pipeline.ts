import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { GitHubClient } from "./github.ts";
import { applyAtlasCoverageGate, buildRepositoryDesignAtlas, renderDesignAtlases } from "./atlas.ts";
import { buildEvidenceBundles, evidenceKind, renderEvidenceBundles } from "./bundle.ts";
import { rankSearchCandidates } from "./discovery.ts";
import type { DesignConfirmation, DesignGateResult, GateResult, HarnessConfig, ReferencePack, RepositoryProfile, ReviewSubmission, TaskSpec } from "./types.ts";
import { renderAdaptationBrief, renderDesignAgentContext, renderDesignDossier } from "./design-render.ts";
import { buildDesignDossierRequest, buildDesignDossierTemplate } from "./design.ts";
import { planQueries } from "./query.ts";
import { learningRepositoryLimit, MAX_LEARNING_REPOSITORIES, normalizeSpecifiedRepositories } from "./reference.ts";
import { assessRepository } from "./score.ts";
import { collectSlices, type SemanticSliceSelector, type SliceReadFailure } from "./slice.ts";
import { inferPractices, renderAgentContext, renderReference } from "./render.ts";
import { buildReviewRequest, buildReviewTemplate, renderGateReport } from "./review.ts";
import { normalizeTaskSpec } from "./task.ts";

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
  // Validate and bind the task vocabulary before any remote data can influence it.
  task = normalizeTaskSpec(task);
  const specified = normalizeSpecifiedRepositories(task.referenceRepositories) ?? [];
  const learningLimit = learningRepositoryLimit(config.slicing.maxRepositories);
  const contentCache = new Map<string, string>();
  const specifiedOutcomes = await mapLimited(specified, 2, async (requested) => {
    try {
      const repository = await client.getRepository(requested.repository);
      const profile = await client.profile(repository, requested.revision);
      const initial = { ...assessRepository(profile, task, config), selectionOrigin: "user-specified" as const };
      const atlas = initial.accepted ? await buildRepositoryDesignAtlas(client, profile, task, config, contentCache) : undefined;
      const assessment = atlas ? applyAtlasCoverageGate(initial, atlas, config) : initial;
      return {
        assessment,
        atlas,
        result: {
          ...requested,
          repository: profile.fullName,
          resolvedRevision: profile.resolvedRevision,
          status: assessment.accepted ? "accepted" as const : "rejected" as const,
          reasons: assessment.accepted ? ["Passed deterministic repository assessment"] : assessment.rejectionReasons,
        },
      };
    } catch (error) {
      return {
        result: {
          ...requested,
          status: "unavailable" as const,
          reasons: [error instanceof Error ? error.message : String(error)],
        },
      };
    }
  });
  const specifiedAssessments = specifiedOutcomes.flatMap((outcome) => outcome.assessment ? [outcome.assessment] : []);
  const specifiedAtlases = specifiedOutcomes.flatMap((outcome) => outcome.atlas ? [outcome.atlas] : []);
  const acceptedSpecified = specifiedAssessments.filter((assessment) => assessment.accepted);
  let queries: string[] = [];
  let automaticAssessments: ReturnType<typeof assessRepository>[] = [];
  let automaticAtlases: ReferencePack["atlases"] = [];
  const automaticProfileFailures: string[] = [];
  if (acceptedSpecified.length < learningLimit) {
    queries = planQueries(task, config);
    if (!queries.length && acceptedSpecified.length === 0) throw new Error("Could not derive a product-domain query; provide a task-grounded domain purpose and capabilities (CLI: --domain-file), or --query for exploratory discovery only.");
    try {
      const batches = await mapLimited(queries, 3, (query) => client.searchRepositories(query, config.github.candidateLimit));
      const requestedNames = new Set([
        ...specified.map((item) => item.repository.toLowerCase()),
        ...specifiedAssessments.map((item) => item.repository.fullName.toLowerCase()),
      ]);
      const candidates = rankSearchCandidates(batches, task, config.github.inspectLimit)
        .map((candidate) => candidate.repository)
        .filter((repository) => !requestedNames.has(repository.full_name.toLowerCase()));
      const automaticOutcomes: Array<{ assessment: ReferencePack["assessments"][number]; atlas?: ReferencePack["atlases"][number] }> = [];
      const needed = learningLimit - acceptedSpecified.length;
      let acceptedAutomatic = 0;
      for (const candidate of candidates) {
        let profile: RepositoryProfile;
        try { profile = await client.profile(candidate); } catch (error) {
          automaticProfileFailures.push(`${candidate.full_name}: ${error instanceof Error ? error.message : String(error)}`);
          continue;
        }
        const initial = { ...assessRepository(profile, task, config), selectionOrigin: "automatic" as const };
        const atlas = initial.accepted ? await buildRepositoryDesignAtlas(client, profile, task, config, contentCache) : undefined;
        const assessment = atlas ? applyAtlasCoverageGate(initial, atlas, config) : initial;
        automaticOutcomes.push({ assessment, atlas });
        if (assessment.accepted) acceptedAutomatic += 1;
        if (acceptedAutomatic >= needed) break;
      }
      automaticAssessments = automaticOutcomes.map((outcome) => outcome.assessment)
        .sort((a, b) => Number(b.accepted) - Number(a.accepted) || b.overall - a.overall || a.repository.fullName.localeCompare(b.repository.fullName));
      automaticAtlases = automaticOutcomes.flatMap((outcome) => outcome.atlas ? [outcome.atlas] : []);
      if (acceptedSpecified.length === 0 && acceptedAutomatic === 0 && automaticProfileFailures.length > 0) {
        throw new Error(`Automatic discovery could not complete candidate profiling: ${automaticProfileFailures.slice(0, 3).join("; ")}`);
      }
    } catch (error) {
      if (acceptedSpecified.length === 0) throw error;
      queries = [];
    }
  }
  const assessments = [...specifiedAssessments, ...automaticAssessments];
  const atlases = [...specifiedAtlases, ...automaticAtlases];
  const selectedRepositories = assessments.filter((assessment) => assessment.accepted)
    .slice(0, learningLimit)
    .map((assessment) => assessment.repository.fullName);
  const selectedRepositorySet = new Set(selectedRepositories);
  const selectedAtlases = atlases.filter((atlas) => selectedRepositorySet.has(atlas.repository));
  const sliceFailures: SliceReadFailure[] = [];
  const slices = await collectSlices(client, assessments, task, config, options.semanticSelector, selectedAtlases, contentCache, sliceFailures);
  if (selectedRepositories.length > 0 && slices.length === 0) {
    const reasons = [...new Set(sliceFailures.map((failure) => failure.reason))].slice(0, 3);
    throw new Error(`Accepted repositories produced no readable evidence slices${reasons.length ? `: ${reasons.join("; ")}` : ""}`);
  }
  const requiredKinds = [...new Set(config.atlas.requiredCategories.flatMap((category) => {
    if (category === "source") return ["implementation" as const];
    if (category === "test") return ["test" as const];
    if (category === "design" || category === "overview") return ["documentation" as const];
    if (category === "manifest") return ["manifest" as const];
    return [];
  }))];
  for (const repository of selectedRepositories) {
    const presentKinds = new Set(slices.filter((slice) => slice.repository === repository).map(evidenceKind));
    const missingKinds = requiredKinds.filter((kind) => !presentKinds.has(kind));
    if (missingKinds.length > 0) {
      const reasons = [...new Set(sliceFailures.filter((failure) => failure.repository === repository).map((failure) => failure.reason))].slice(0, 3);
      throw new Error(`Repository ${repository} is missing required ${missingKinds.join(", ")} evidence slices after bounded reads${reasons.length ? `: ${reasons.join("; ")}` : ""}`);
    }
  }
  const bundles = buildEvidenceBundles(selectedAtlases, slices, config);
  for (const repository of selectedRepositories) {
    if (!bundles.some((bundle) => bundle.repository === repository)) {
      throw new Error(`Repository ${repository} produced slices but no evidence bundle with ${config.bundles.minimumEvidenceKinds} distinct evidence kinds`);
    }
  }
  return {
    schemaVersion: 4,
    generatedAt: new Date().toISOString(),
    task, queries, assessments, atlases: selectedAtlases, slices, bundles,
    practices: inferPractices({ assessments, slices }),
    selection: {
      schemaVersion: 1,
      maximumLearningRepositories: MAX_LEARNING_REPOSITORIES,
      automaticSearchUsed: queries.length > 0,
      specified: specifiedOutcomes.map((outcome) => outcome.result),
      selectedRepositories,
    },
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
    writeFile(resolve(directory, "DESIGN_ATLAS.json"), `${JSON.stringify(pack.atlases, null, 2)}\n`, "utf8"),
    writeFile(resolve(directory, "DESIGN_ATLAS.md"), renderDesignAtlases(pack.atlases), "utf8"),
    writeFile(resolve(directory, "EVIDENCE_BUNDLES.json"), `${JSON.stringify(pack.bundles, null, 2)}\n`, "utf8"),
    writeFile(resolve(directory, "EVIDENCE_BUNDLES.md"), renderEvidenceBundles(pack.bundles, pack.slices), "utf8"),
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
    writeFile(resolve(directory, "APPROVED_DESIGN_ATLAS.json"), `${JSON.stringify(result.approvedPack.atlases, null, 2)}\n`, "utf8"),
    writeFile(resolve(directory, "APPROVED_DESIGN_ATLAS.md"), renderDesignAtlases(result.approvedPack.atlases), "utf8"),
    writeFile(resolve(directory, "APPROVED_EVIDENCE_BUNDLES.json"), `${JSON.stringify(result.approvedPack.bundles, null, 2)}\n`, "utf8"),
    writeFile(resolve(directory, "APPROVED_EVIDENCE_BUNDLES.md"), renderEvidenceBundles(result.approvedPack.bundles, result.approvedPack.slices), "utf8"),
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
