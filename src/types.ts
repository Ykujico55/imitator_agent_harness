import type { SourceAnalysis } from "./source-analysis.ts";
import type { AtlasSourceRoute, SliceSourceRoute } from "./source-routing.ts";

export type TaskSpec = {
  task: string;
  domain?: TaskDomainSpec;
  queries?: string[];
  language?: string;
  ecosystem?: string;
  mustHave?: string[];
  avoid?: string[];
  referenceRepositories?: SpecifiedRepository[];
};

/** Task-specific vocabulary, supplied before repository discovery, not a global taxonomy. */
export type DomainConcept = {
  name: string;
  aliases: string[];
  taskEvidence: string;
};

export type TaskDomainSpec = {
  purpose: DomainConcept;
  capabilities: DomainConcept[];
};

export type SpecifiedRepository = {
  repository: string;
  revision?: string;
};

export type SpecifiedRepositoryResult = SpecifiedRepository & {
  status: "accepted" | "rejected" | "unavailable";
  resolvedRevision?: string;
  reasons: string[];
};

export type ReferenceSelection = {
  schemaVersion: 1;
  maximumLearningRepositories: 2;
  automaticSearchUsed: boolean;
  specified: SpecifiedRepositoryResult[];
  selectedRepositories: string[];
};

export type TaskIdentity = {
  schemaVersion: 1;
  fingerprint: string;
  workspace: string;
  baseRevision: string;
  task: TaskSpec;
};

export type TreeEntry = {
  path: string;
  type: "blob" | "tree";
  sha: string;
  size?: number;
};

export type RepositoryProfile = {
  fullName: string;
  htmlUrl: string;
  description: string;
  stars: number;
  forks: number;
  openIssues: number;
  sizeKb: number;
  archived: boolean;
  fork: boolean;
  defaultBranch: string;
  resolvedRevision: string;
  pushedAt: string;
  createdAt: string;
  license: string | null;
  language: string | null;
  topics: string[];
  tree: TreeEntry[];
};

export type ScoreDimension = {
  score: number;
  reasons: string[];
};

export type AtlasEvidenceCategory = "overview" | "design" | "manifest" | "source" | "test" | "automation" | "relationships";

export type AtlasSourceRef = {
  path: string;
  sourceUrl: string;
};

export type EvidenceStrength = "missing" | "textual" | "syntactic" | "resolved" | "corroborated";

export type EvidenceStrengthRecord = {
  level: EvidenceStrength;
  signals: string[];
  limitations: string[];
};

export type AnalysisQualityReport = {
  schemaVersion: 1;
  /** Observability of the bounded evidence, never a score for design merit. */
  score: number;
  calibrationStatus: "observational-only";
  highestStrength: EvidenceStrength;
  counts: Record<EvidenceStrength, number>;
  signals: Array<{
    name: string;
    points: number;
    sources: AtlasSourceRef[];
  }>;
  files: Array<AtlasSourceRef & EvidenceStrengthRecord & {
    modalities: EvidenceKind[];
    selectedAnalyzer?: string;
    analysisStatus?: SourceAnalysis["status"] | "not-applicable" | "not-produced";
  }>;
  limitations: string[];
};

export type AtlasCoverage = {
  score: number;
  sufficient: boolean;
  requiredCategories: AtlasEvidenceCategory[];
  presentCategories: AtlasEvidenceCategory[];
  missingRequiredCategories: AtlasEvidenceCategory[];
  signals: Array<{
    name: string;
    points: number;
    sources: AtlasSourceRef[];
  }>;
};

export type RepositoryDesignAtlas = {
  schemaVersion: 1;
  repository: string;
  repositoryUrl: string;
  revision: string;
  license: string | null;
  generatedFrom: "github-tree-and-bounded-content";
  manifests: Array<{
    path: string;
    sourceUrl: string;
    ecosystem: string;
    parseStatus: "parsed" | "partial" | "indexed" | "invalid" | "unreadable" | "not-inspected";
    packageName?: string;
    dependencies: string[];
    developmentDependencies: string[];
    scripts: string[];
    workspacePatterns: string[];
    edition?: string;
    features?: string[];
    targets?: Array<{ name: string; kind: string; path?: string }>;
  }>;
  architectureDocuments: Array<AtlasSourceRef & {
    kind: "overview" | "architecture" | "decision" | "security";
  }>;
  entryPoints: Array<AtlasSourceRef & { reason: string }>;
  modules: Array<{
    rootPath: string;
    kind: "application" | "library" | "package" | "test" | "example";
    fileCount: number;
    entryPoints: string[];
  }>;
  relations: Array<{
    from: string;
    to: string;
    kind: "imports" | "tests";
    evidence: AtlasSourceRef;
    scope?: string;
    context?: string[];
    aliases?: Array<{ name: string; asName: string | null }>;
    resolution?: "static-candidate" | "rust-module-candidate";
  }>;
  unresolvedImports?: Array<AtlasSourceRef & { module: string; line: number; reason: string; scope: string; context: string[] }>;
  fixtureRelations?: Array<{ testPath: string; testSymbol: string; fixturePath?: string; fixtureSymbol?: string; request: string; status: "candidate" | "unresolved"; reason: string }>;
  readFailures?: Array<{ path: string; reason: string }>;
  coverageBasis?: "read-content-v2";
  testFiles: AtlasSourceRef[];
  automationFiles: AtlasSourceRef[];
  inspectedFiles: AtlasSourceRef[];
  sourceAnalyses?: Array<AtlasSourceRef & SourceAnalysis>;
  sourceRoutes?: Array<AtlasSourceRef & AtlasSourceRoute>;
  analysisQuality?: AnalysisQualityReport;
  coverage: AtlasCoverage;
};

export type RepositoryAssessment = {
  repository: RepositoryProfile;
  /** Independent use restrictions; absent only in legacy packs. */
  licenseWarnings?: string[];
  selectionOrigin?: "user-specified" | "automatic";
  atlasCoverage?: AtlasCoverage;
  dimensions: {
    domainMatch: ScoreDimension;
    engineeringMaturity: ScoreDimension;
    transferability: ScoreDimension;
    patternClarity: ScoreDimension;
    designQuality: ScoreDimension;
    risk: ScoreDimension;
  };
  overall: number;
  accepted: boolean;
  rejectionReasons: string[];
};

export type SliceStrategy = "line-window" | "typescript-ast" | "python-ast" | "rust-syntax" | (string & {});

export type EvidenceSlice = {
  id: string;
  repository: string;
  repositoryUrl: string;
  license: string | null;
  commitish: string;
  path: string;
  startLine: number;
  endLine: number;
  sourceUrl: string;
  relevance: number;
  reason: string;
  content: string;
  strategy?: SliceStrategy;
  symbols?: string[];
  /** Semantic roles demonstrated inside this exact slice window. */
  evidenceRoles?: Array<"implementation" | "test">;
  /** Auditable path-based analyzer selection and the actual slicing outcome. */
  sourceRoute?: SliceSourceRoute;
  /** Strength of this exact evidence window, separate from repository design quality. */
  evidenceStrength?: EvidenceStrengthRecord;
};

export type EpistemicStatus = "explicit" | "observed" | "inferred" | "unknown";

export type EvidenceKind = "documentation" | "implementation" | "test" | "test-support" | "manifest" | "relationship";

export type EvidenceBundle = {
  schemaVersion: 1;
  id: string;
  repository: string;
  concern: "system-architecture" | "module-boundary" | "technology-selection" | "testing-strategy" | "failure-semantics";
  question: string;
  epistemicCeiling: "explicit" | "observed";
  evidenceKinds: EvidenceKind[];
  evidenceSliceIds: string[];
  relatedPaths: string[];
  relations: RepositoryDesignAtlas["relations"];
  evidenceStrength?: {
    strongest: EvidenceStrength;
    weakest: EvidenceStrength;
    signals: string[];
  };
  limitations: string[];
};

export type SemanticBlueprintSection =
  | "modules"
  | "contracts"
  | "dataModels"
  | "relationships"
  | "failureSemantics"
  | "testConcepts"
  | "extensionPoints"
  | "negativeSpace";

export type SemanticBlueprintObservation = {
  id: string;
  section: SemanticBlueprintSection;
  /** A bounded static observation, never a recovered design intention. */
  summary: string;
  paths: string[];
  symbols: string[];
  evidenceStrength: EvidenceStrength;
  evidenceSliceIds: string[];
  evidenceBundleIds: string[];
  limitations: string[];
};

export type ReferenceSemanticBlueprint = {
  schemaVersion: 1;
  repository: string;
  repositoryUrl: string;
  revision: string;
  license: string | null;
  generatedFrom: "approved-atlas-bundles-and-slices";
  observationalOnly: true;
  budget: {
    maximumObservations: number;
    selectedObservations: number;
    omittedObservations: number;
  };
  sections: Record<SemanticBlueprintSection, SemanticBlueprintObservation[]>;
  sources: Array<{
    sliceId: string;
    path: string;
    lines: string;
    sourceUrl: string;
    license: string | null;
    evidenceStrength: EvidenceStrength;
    bundleIds: string[];
  }>;
  limitations: string[];
};

export type HarnessConfig = {
  github: {
    minimumStars: number;
    candidateLimit: number;
    inspectLimit: number;
  };
  acceptance: {
    minimumOverall: number;
    minimumDomainMatch: number;
    maximumRisk: number;
    allowedLicenses: string[];
    licensePolicy: "warn" | "allowlist";
  };
  slicing: {
    maxRepositories: number;
    maxFilesPerRepository: number;
    maxLinesPerSlice: number;
    maxSlices: number;
    maxTotalCharacters: number;
  };
  atlas: {
    maxFiles: number;
    maxTotalCharacters: number;
    minimumCoverage: number;
    requiredCategories: AtlasEvidenceCategory[];
  };
  bundles: {
    maxBundlesPerRepository: number;
    maxSlicesPerBundle: number;
    minimumEvidenceKinds: number;
  };
  review: {
    minimumConfidence: number;
    minimumEvidenceSlices: number;
    maximumRisk: "low" | "medium" | "high";
  };
};

export type ReferencePack = {
  schemaVersion: 4;
  generatedAt: string;
  task: TaskSpec;
  queries: string[];
  assessments: RepositoryAssessment[];
  atlases: RepositoryDesignAtlas[];
  slices: EvidenceSlice[];
  bundles: EvidenceBundle[];
  practices: string[];
  selection?: ReferenceSelection;
};

export type ReviewVerdict = "adopt" | "adapt" | "reject" | "pending";
export type ReviewRisk = "low" | "medium" | "high";

export type DomainFitReview = {
  relation: "same-domain" | "adjacent-domain" | "unrelated" | "unknown";
  rationale: string;
  evidenceSliceIds: string[];
};

export type RepositoryReviewDecision = {
  repository: string;
  verdict: ReviewVerdict;
  confidence: number;
  riskLevel: ReviewRisk;
  summary: string;
  transferablePatterns: string[];
  mismatches: string[];
  risks: string[];
  evidenceBundleIds: string[];
  evidenceSliceIds: string[];
  /** Legacy proposals may omit this, but cannot pass the current review gate. */
  domainFit?: DomainFitReview;
};

export type ReviewRequest = {
  schemaVersion: 1;
  referencePackFingerprint: string;
  task: TaskSpec;
  domain: { anchors: string[]; queryTerms: string[]; source: string };
  instructions: string[];
  candidates: Array<{
    repository: string;
    repositoryUrl: string;
    selectionOrigin: "user-specified" | "automatic";
    license: string | null;
    phaseOneOverall: number;
    licenseWarnings: string[];
    dimensions: RepositoryAssessment["dimensions"];
    atlas: RepositoryDesignAtlas;
    bundles: EvidenceBundle[];
    slices: Array<Pick<EvidenceSlice, "id" | "path" | "startLine" | "endLine" | "sourceUrl" | "reason" | "content" | "strategy" | "symbols" | "evidenceRoles" | "sourceRoute" | "evidenceStrength">>;
  }>;
};

export type ReviewSubmission = {
  schemaVersion: 1;
  referencePackFingerprint: string;
  reviewer: string;
  decisions: RepositoryReviewDecision[];
};

export type GateResult = {
  schemaVersion: 1;
  referencePackFingerprint: string;
  generatedAt: string;
  results: Array<{
    repository: string;
    approved: boolean;
    reasons: string[];
    decision?: RepositoryReviewDecision;
  }>;
  approvedPack: ReferencePack;
};

export type ReviewConfirmation = {
  schemaVersion: 1;
  referencePackFingerprint: string;
  taskFingerprint: string;
  reviewFingerprint: string;
  confirmer: string;
  kind: "human" | "independent-agent";
  approvedRepositories: string[];
  rationale: string;
  confirmedAt: string;
};

export type DesignDecision = "adopt" | "adapt" | "reject";
export type TestLayer = "unit" | "integration" | "contract" | "property" | "end-to-end";

export type DesignClaim = {
  id: string;
  statement: string;
  status: EpistemicStatus;
  confidence: number;
  evidenceBundleIds: string[];
  evidenceSliceIds: string[];
  counterEvidenceSliceIds: string[];
  /** Navigation observations used to interpret the cited source evidence. */
  blueprintObservationIds: string[];
  limitations: string[];
};

export type DesignPrinciple = {
  id: string;
  title: string;
  problem: string;
  constraints: string[];
  decision: string;
  mechanisms: string[];
  tradeoffs: string[];
  nonGoals: string[];
  fitsWhen: string[];
  failsWhen: string[];
  evidenceSliceIds: string[];
};

export type ArchitectureConcept = {
  id: string;
  name: string;
  responsibility: string;
  collaborators: string[];
  invariants: string[];
  failureModes: string[];
  extensionPoints: string[];
  evidenceSliceIds: string[];
};

export type SpecificationConcept = {
  id: string;
  subject: string;
  preconditions: string[];
  postconditions: string[];
  invariants: string[];
  errorSemantics: string[];
  evidenceSliceIds: string[];
};

export type TestConcept = {
  id: string;
  behavior: string;
  layer: TestLayer;
  oracle: string;
  setup: string[];
  failureCases: string[];
  evidenceSliceIds: string[];
};

export type LocalDesignMapping = {
  localConcern: string;
  referenceConceptIds: string[];
  decision: DesignDecision;
  rationale: string;
  adaptations: string[];
  targetPaths: string[];
  acceptanceTests: string[];
};

export type DesignDossier = {
  schemaVersion: 1;
  taskFingerprint: string;
  referencePackFingerprint: string;
  author: string;
  repositories: string[];
  systemIntent: string;
  localContext: {
    constraints: string[];
    existingConventions: string[];
    qualityAttributes: string[];
  };
  claims: DesignClaim[];
  principles: DesignPrinciple[];
  architecture: ArchitectureConcept[];
  specifications: SpecificationConcept[];
  testConcepts: TestConcept[];
  negativeSpace: Array<{
    choice: string;
    rationale: string;
    evidenceSliceIds: string[];
  }>;
  localMappings: LocalDesignMapping[];
  globalRisks: string[];
};

export type DesignDossierRequest = {
  schemaVersion: 1;
  taskFingerprint: string;
  referencePackFingerprint: string;
  task: TaskSpec;
  repositories: Array<{
    name: string;
    license: string | null;
    revision: string;
  }>;
  atlases: RepositoryDesignAtlas[];
  bundles: EvidenceBundle[];
  semanticBlueprints: ReferenceSemanticBlueprint[];
  evidenceIndex: Array<{
    id: string;
    repository: string;
    path: string;
    lines: string;
    reason: string;
    sourceUrl: string;
    license: string | null;
    strategy?: SliceStrategy;
    symbols?: string[];
    evidenceRoles?: EvidenceSlice["evidenceRoles"];
    sourceRoute?: SliceSourceRoute;
    evidenceStrength?: EvidenceStrengthRecord;
  }>;
  requirements: string[];
};

export type DesignGateResult = {
  schemaVersion: 1;
  dossierFingerprint: string;
  generatedAt: string;
  approved: boolean;
  reasons: string[];
  evidenceSliceIds: string[];
  dossier: DesignDossier;
};

export type DesignConfirmation = {
  schemaVersion: 1;
  dossierFingerprint: string;
  taskFingerprint: string;
  referencePackFingerprint: string;
  confirmer: string;
  kind: "human" | "independent-agent";
  rationale: string;
  confirmedAt: string;
};
