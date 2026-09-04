/** Syntax observations only: never proof of runtime behavior or design intent. */
export type SourceSymbol = {
  name: string;
  kind: "class" | "function" | "async-function";
  startLine: number;
  endLine: number;
  signature: string;
  decorators: string[];
  bases: string[];
  raises: string[];
  catches: string[];
  assertionCount: number;
  role: "implementation" | "test" | "fixture";
  traits?: string[];
  fields?: Array<{ name: string; annotation: string; defaultValue: string; line: number; kind: "class" | "instance" }>;
  parameters?: string[];
  fixtureName?: string;
  fixtureRequests?: string[];
  hasBody?: boolean;
};

export type PythonImport = {
  module: string; names: string[]; level: number; line: number;
  aliases?: Array<{ name: string; asName: string | null }>;
  scope?: string;
  context?: string[];
};

export type SourceAnalysis = {
  language: "python";
  status: "parsed" | "invalid" | "unavailable" | "budget-exceeded";
  parser: string;
  limitations: string[];
  symbols: SourceSymbol[];
  imports: PythonImport[];
  exports?: { names: string[]; status: "static" | "dynamic" | "implicit" };
  manifest?: {
    packageName?: string;
    dependencies: string[];
    developmentDependencies: string[];
    scripts: string[];
    workspacePatterns: string[];
    entryTargets: string[];
    format?: string;
    completeness?: "complete" | "partial" | "unsupported";
    importRoots?: string[];
  };
};

export type SourceAnalyzer = (input: { path: string; content: string }) => SourceAnalysis | undefined;
