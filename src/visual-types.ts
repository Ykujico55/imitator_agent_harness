export type VisualArchetypeId =
  | "calm-product"
  | "data-console"
  | "editorial-docs"
  | "expressive-marketing"
  | "productivity-editor"
  | "commerce-catalog";

export type VisualTaskInput = {
  task: string;
  purpose: string;
  capabilities: string[];
  language?: string;
  ecosystem?: string;
  mustHave?: string[];
  avoid?: string[];
};

export type VisualTaskSignal = {
  name: "explicit-visual-language" | "user-facing-surface" | "frontend-stack" | "visual-quality-requirement";
  points: number;
  matches: string[];
};

export type VisualTaskRoute = {
  route: "visual-style" | "software-precedent";
  score: number;
  threshold: number;
  signals: VisualTaskSignal[];
  reason: string;
  archetypeId?: VisualArchetypeId;
  archetypeReason?: string;
};

export type VisualStyleProfile = {
  schemaVersion: 1;
  id: VisualArchetypeId;
  label: string;
  provenance: "bundled-curated-seed";
  suitableFor: string[];
  palette: {
    canvas: string;
    surface: string;
    text: string;
    mutedText: string;
    accent: string;
    supportingAccent: string;
    danger: string;
  };
  typography: {
    direction: string;
    display: string;
    body: string;
    scale: number[];
    bodyLineHeight: number;
  };
  layout: {
    direction: string;
    contentMaxWidth: number;
    density: "compact" | "comfortable" | "spacious";
    sectionRhythm: string;
  };
  shape: {
    radiusScale: number[];
    elevationLevels: number;
    borderDirection: string;
  };
  motion: {
    durationMs: number[];
    direction: string;
  };
  auditConstraints: {
    pureBlackSurface: "avoid" | "allow";
    maximumBorderDeclarations: number;
    maximumCardLikeReferences: number;
    minimumTypeScaleSteps: number;
    maximumDominantRadiusRatio: number;
    responsiveEvidenceRequired: boolean;
    gradientPolicy: "avoid" | "restrained" | "allow";
  };
  principles: string[];
  avoid: string[];
};

export type VisualSourceFile = {
  path: string;
  content: string;
};

export type VisualMetric = {
  value: string;
  count: number;
  paths: string[];
};

export type VisualStaticInventory = {
  schemaVersion: 1;
  inspectedFiles: string[];
  totalCharacters: number;
  customPropertyDefinitions: VisualMetric[];
  customPropertyReferences: VisualMetric[];
  colors: VisualMetric[];
  fontSizes: VisualMetric[];
  radii: VisualMetric[];
  pureBlackBackgrounds: VisualMetric[];
  nearBlackBackgrounds: VisualMetric[];
  borderDeclarations: VisualMetric[];
  shadows: VisualMetric[];
  gradients: VisualMetric[];
  responsiveSignals: VisualMetric[];
  cardLikeReferences: VisualMetric[];
  limitations: string[];
};

export type VisualSpec = {
  schemaVersion: 1;
  route: VisualTaskRoute;
  profile: VisualStyleProfile;
  localEvidence: {
    inspectedFiles: string[];
    existingCustomProperties: number;
    existingColors: string[];
    existingTypeScale: string[];
    existingRadii: string[];
    responsiveEvidence: boolean;
  };
  implementationContract: string[];
  limitations: string[];
};

export type VisualAuditFinding = {
  signal: string;
  severity: "error" | "warning" | "info";
  message: string;
  evidence: string[];
  remediation: string;
};

export type VisualAuditReport = {
  schemaVersion: 1;
  profileId: VisualArchetypeId;
  status: "clean" | "review" | "blocked";
  findings: VisualAuditFinding[];
  inventory: VisualStaticInventory;
  limitations: string[];
};
