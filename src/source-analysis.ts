/** Syntax observations only: never proof of runtime behavior or design intent. */
export type SourceLanguage = "python" | "rust" | (string & {});
export type SourceSymbolKind = "class" | "function" | "async-function" | "module" | "struct" | "union" | "enum" | "trait" | "impl" | "type" | "const" | "static" | "macro" | (string & {});

export type SourceSymbol = {
  name: string;
  kind: SourceSymbolKind;
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
  fields?: Array<{ name: string; annotation: string; defaultValue: string; line: number; kind: "class" | "instance" | "struct" | "variant" }>;
  parameters?: string[];
  fixtureName?: string;
  fixtureRequests?: string[];
  hasBody?: boolean;
  visibility?: string;
  attributes?: string[];
  errorSignals?: string[];
  unsafeCount?: number;
  variants?: string[];
  implementedFor?: string;
};

export type SourceImport = {
  module: string; names: string[]; level: number; line: number;
  aliases?: Array<{ name: string; asName: string | null }>;
  scope?: string;
  context?: string[];
  kind?: "import" | "use" | "module";
};

export type SourceAnalysis = {
  language: SourceLanguage;
  status: "parsed" | "invalid" | "unavailable" | "budget-exceeded";
  parser: string;
  limitations: string[];
  symbols: SourceSymbol[];
  imports: SourceImport[];
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
    edition?: string;
    features?: string[];
    targets?: Array<{ name: string; kind: string; path?: string }>;
  };
};

export type SourceAnalyzer = (input: { path: string; content: string }) => SourceAnalysis | undefined;
