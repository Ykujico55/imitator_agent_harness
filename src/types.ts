export type TaskSpec = {
  task: string;
  queries?: string[];
  language?: string;
  ecosystem?: string;
  mustHave?: string[];
  avoid?: string[];
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
