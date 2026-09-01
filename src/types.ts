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
};

export type ReferencePack = {
  schemaVersion: 1;
  generatedAt: string;
  task: TaskSpec;
  queries: string[];
  assessments: RepositoryAssessment[];
  slices: EvidenceSlice[];
  practices: string[];
};
