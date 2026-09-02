export type TaskSpec = {
  task: string;
  queries?: string[];
  language?: string;
  ecosystem?: string;
  mustHave?: string[];
  avoid?: string[];
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

export type RepositoryAssessment = {
  repository: RepositoryProfile;
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
  strategy?: "line-window" | "typescript-ast";
  symbols?: string[];
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
  };
  slicing: {
    maxRepositories: number;
    maxFilesPerRepository: number;
    maxLinesPerSlice: number;
    maxSlices: number;
    maxTotalCharacters: number;
  };
  review: {
    minimumConfidence: number;
    minimumEvidenceSlices: number;
    maximumRisk: "low" | "medium" | "high";
  };
};

export type ReferencePack = {
  schemaVersion: 2;
  generatedAt: string;
  task: TaskSpec;
  queries: string[];
  assessments: RepositoryAssessment[];
  slices: EvidenceSlice[];
  practices: string[];
};

export type ReviewVerdict = "adopt" | "adapt" | "reject" | "pending";
export type ReviewRisk = "low" | "medium" | "high";

export type RepositoryReviewDecision = {
  repository: string;
  verdict: ReviewVerdict;
  confidence: number;
  riskLevel: ReviewRisk;
  summary: string;
  transferablePatterns: string[];
  mismatches: string[];
  risks: string[];
  evidenceSliceIds: string[];
};

export type ReviewRequest = {
  schemaVersion: 1;
  referencePackFingerprint: string;
  task: TaskSpec;
  instructions: string[];
  candidates: Array<{
    repository: string;
    repositoryUrl: string;
    license: string | null;
    phaseOneOverall: number;
    dimensions: RepositoryAssessment["dimensions"];
    slices: Array<Pick<EvidenceSlice, "id" | "path" | "startLine" | "endLine" | "sourceUrl" | "reason" | "content">>;
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
  evidenceIndex: Array<{
    id: string;
    repository: string;
    path: string;
    lines: string;
    reason: string;
    sourceUrl: string;
    license: string | null;
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
