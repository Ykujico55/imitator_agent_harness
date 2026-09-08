import ts from "typescript";
import type { SourceAnalysis, SourceImport, SourceSymbol } from "../src/source-analysis.ts";
import { isTestPath } from "../src/evidence-path.ts";

const SUPPORTED = /\.[cm]?[jt]sx?$/i;
const MAX_CHARACTERS = 120_000;
const MAX_SYMBOLS = 200;
const MAX_IMPORTS = 200;

function scriptKind(path: string): ts.ScriptKind {
  if (/\.[cm]?tsx$/i.test(path) || /\.jsx$/i.test(path)) return ts.ScriptKind.TSX;
  if (/\.[cm]?ts$/i.test(path)) return ts.ScriptKind.TS;
  return ts.ScriptKind.JS;
}

function lineRange(source: ts.SourceFile, node: ts.Node): { startLine: number; endLine: number } {
  return {
    startLine: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1,
    endLine: source.getLineAndCharacterOfPosition(node.end).line + 1,
  };
}

function compact(value: string, maximum = 800): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length <= maximum ? normalized : `${normalized.slice(0, maximum - 1)}…`;
}

function declarationName(node: ts.Node, source: ts.SourceFile, owner = ""): string | undefined {
  if (ts.isVariableStatement(node)) return node.declarationList.declarations.map((item) => item.name.getText(source)).join(", ");
  if ("name" in node) {
    const name = (node as ts.NamedDeclaration).name?.getText(source);
    return name ? `${owner}${owner ? "." : ""}${name}` : undefined;
  }
  return undefined;
}

function modifiers(node: ts.Node): readonly ts.Modifier[] {
  return ts.canHaveModifiers(node) ? ts.getModifiers(node) ?? [] : [];
}

function visibility(node: ts.Node): string {
  const values = modifiers(node).map((modifier) => ts.tokenToString(modifier.kind)).filter((item): item is string => Boolean(item));
  return values.join(" ") || "package";
}

function decorators(node: ts.Node, source: ts.SourceFile): string[] {
  if (!ts.canHaveDecorators(node)) return [];
  return (ts.getDecorators(node) ?? []).map((decorator) => compact(decorator.expression.getText(source), 160));
}

function bases(node: ts.ClassLikeDeclarationBase | ts.InterfaceDeclaration, source: ts.SourceFile): { bases: string[]; traits: string[] } {
  const extended: string[] = [];
  const implemented: string[] = [];
  for (const clause of node.heritageClauses ?? []) {
    const target = clause.token === ts.SyntaxKind.ImplementsKeyword ? implemented : extended;
    target.push(...clause.types.map((type) => compact(type.expression.getText(source), 160)));
  }
  return { bases: extended, traits: implemented };
}

function fields(node: ts.ClassLikeDeclarationBase | ts.InterfaceDeclaration | ts.TypeLiteralNode, source: ts.SourceFile): SourceSymbol["fields"] {
  return node.members.flatMap((member) => {
    if (!ts.isPropertyDeclaration(member) && !ts.isPropertySignature(member)) return [];
    const name = member.name?.getText(source);
    if (!name) return [];
    return [{
      name: compact(name, 160),
      annotation: member.type ? compact(member.type.getText(source), 240) : "",
      defaultValue: ts.isPropertyDeclaration(member) && member.initializer ? compact(member.initializer.getText(source), 240) : "",
      line: source.getLineAndCharacterOfPosition(member.getStart(source)).line + 1,
      kind: "class" as const,
    }];
  });
}

function bodySignals(node: ts.Node, source: ts.SourceFile): Pick<SourceSymbol, "raises" | "catches" | "assertionCount" | "errorSignals"> {
  const raises: string[] = [];
  const catches: string[] = [];
  const errorSignals: string[] = [];
  let assertionCount = 0;
  const visit = (child: ts.Node): void => {
    if (ts.isThrowStatement(child)) {
      raises.push(child.expression ? compact(child.expression.getText(source), 160) : "throw");
      errorSignals.push("throw");
    }
    if (ts.isCatchClause(child)) catches.push(child.variableDeclaration?.name.getText(source) ?? "catch");
    if (ts.isCallExpression(child)) {
      const callee = compact(child.expression.getText(source), 160);
      if (/^(?:assert(?:\.|$)|expect(?:\.|$))/.test(callee)) assertionCount += 1;
      if (/^(?:Promise\.)?reject(?:s|ed)?(?:\.|$)/i.test(callee) || /\.reject(?:s|ed)?$/i.test(callee)) errorSignals.push(callee);
    }
    ts.forEachChild(child, visit);
  };
  ts.forEachChild(node, visit);
  return {
    raises: [...new Set(raises)].slice(0, 20),
    catches: [...new Set(catches)].slice(0, 20),
    assertionCount,
    errorSignals: [...new Set(errorSignals)].slice(0, 20),
  };
}

function callName(node: ts.CallExpression, source: ts.SourceFile): string {
  return compact(node.expression.getText(source), 160);
}

function testCall(node: ts.Node, source: ts.SourceFile): ts.CallExpression | undefined {
  if (!ts.isExpressionStatement(node) || !ts.isCallExpression(node.expression)) return undefined;
  return /^(?:describe|suite|it|test)(?:\.|$)/.test(callName(node.expression, source)) ? node.expression : undefined;
}

function importObservation(node: ts.Node, source: ts.SourceFile): SourceImport | undefined {
  if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
    const aliases: NonNullable<SourceImport["aliases"]> = [];
    const clause = node.importClause;
    if (clause?.name) aliases.push({ name: "default", asName: clause.name.text });
    if (clause?.namedBindings && ts.isNamespaceImport(clause.namedBindings)) aliases.push({ name: "*", asName: clause.namedBindings.name.text });
    if (clause?.namedBindings && ts.isNamedImports(clause.namedBindings)) for (const element of clause.namedBindings.elements) {
      aliases.push({ name: element.propertyName?.text ?? element.name.text, asName: element.propertyName ? element.name.text : null });
    }
    return {
      module: node.moduleSpecifier.text, names: aliases.map((item) => item.name), level: 0,
      line: lineRange(source, node).startLine, aliases, scope: "module",
      context: clause?.isTypeOnly ? ["type-only"] : [], kind: "import",
    };
  }
  if (ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
    const names = node.exportClause && ts.isNamedExports(node.exportClause) ? node.exportClause.elements.map((item) => item.propertyName?.text ?? item.name.text) : ["*"];
    return { module: node.moduleSpecifier.text, names, level: 0, line: lineRange(source, node).startLine, scope: "module", context: node.isTypeOnly ? ["type-only"] : [], kind: "import" };
  }
  return undefined;
}

export function analyzeTypeScriptSource(input: { path: string; content: string }): SourceAnalysis | undefined {
  const { path, content } = input;
  if (!SUPPORTED.test(path)) return undefined;
  const failure = (status: SourceAnalysis["status"], limitation: string): SourceAnalysis => ({
    language: "typescript", status, parser: "typescript-compiler-ast", limitations: [limitation], symbols: [], imports: [],
  });
  if (content.length > MAX_CHARACTERS) return failure("budget-exceeded", `Source exceeds ${MAX_CHARACTERS}-character parser budget.`);
  const source = ts.createSourceFile(path, content, ts.ScriptTarget.Latest, true, scriptKind(path));
  const diagnostics = (source as ts.SourceFile & { parseDiagnostics?: readonly ts.Diagnostic[] }).parseDiagnostics ?? [];
  if (diagnostics.length) return failure("invalid", `TypeScript parser reported ${diagnostics.length} syntax diagnostics; no partial AST observations were accepted.`);
  const symbols: SourceSymbol[] = [];
  const imports: SourceImport[] = [];
  const exported = new Set<string>();
  const addSymbol = (node: ts.Node, kind: SourceSymbol["kind"], owner = "", role?: SourceSymbol["role"]): void => {
    if (symbols.length >= MAX_SYMBOLS) return;
    const name = declarationName(node, source, owner);
    if (!name) return;
    const range = lineRange(source, node);
    const heritage = ts.isClassLike(node) || ts.isInterfaceDeclaration(node) ? bases(node, source) : { bases: [], traits: [] };
    const symbolFields = ts.isClassLike(node) || ts.isInterfaceDeclaration(node) ? fields(node, source) : undefined;
    const signals = bodySignals(node, source);
    const nodeModifiers = modifiers(node);
    if (nodeModifiers.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)) exported.add(name.split(".")[0]!);
    const inferredRole: SourceSymbol["role"] = role ?? (isTestPath(path) && /(^|\.)(?:test|spec)[_.A-Z]/i.test(name) ? "test" : "implementation");
    symbols.push({
      name, kind, ...range, signature: compact(node.getText(source).split("{")[0] ?? node.getText(source)),
      decorators: decorators(node, source), bases: heritage.bases, traits: heritage.traits,
      ...signals, role: inferredRole, fields: symbolFields, hasBody: true, visibility: visibility(node),
      attributes: nodeModifiers.map((modifier) => ts.tokenToString(modifier.kind)).filter((item): item is string => Boolean(item)),
    });
  };
  const visit = (node: ts.Node, owner = ""): void => {
    const imported = importObservation(node, source);
    if (imported && imports.length < MAX_IMPORTS) imports.push(imported);
    if (ts.isInterfaceDeclaration(node)) addSymbol(node, "class", owner);
    else if (ts.isClassDeclaration(node)) addSymbol(node, "class", owner);
    else if (ts.isTypeAliasDeclaration(node)) {
      addSymbol(node, "type", owner);
      if (ts.isTypeLiteralNode(node.type) && symbols.at(-1)?.name === declarationName(node, source, owner)) symbols.at(-1)!.fields = fields(node.type, source);
    }
    else if (ts.isEnumDeclaration(node)) {
      addSymbol(node, "enum", owner);
      if (symbols.at(-1)?.name === declarationName(node, source, owner)) symbols.at(-1)!.variants = node.members.map((member) => compact(member.name.getText(source), 160));
    }
    else if (ts.isFunctionDeclaration(node)) addSymbol(node, "function", owner);
    else if (ts.isMethodDeclaration(node)) addSymbol(node, "method", owner);
    const test = testCall(node, source);
    if (test && symbols.length < MAX_SYMBOLS) {
      const range = lineRange(source, node);
      const signals = bodySignals(node, source);
      symbols.push({
        name: `${callName(test, source)}@${range.startLine}`, kind: "function", ...range,
        signature: compact(node.getText(source).split("=>")[0] ?? node.getText(source)), decorators: [], bases: [],
        ...signals, role: "test", hasBody: true, visibility: "test-local",
      });
    }
    const childOwner = ts.isClassDeclaration(node) || ts.isInterfaceDeclaration(node) ? declarationName(node, source, owner) ?? owner : owner;
    ts.forEachChild(node, (child) => visit(child, childOwner));
  };
  visit(source);
  return {
    language: "typescript",
    status: "parsed",
    parser: "typescript-compiler-ast",
    limitations: ["Compiler AST observations are syntax-only; type resolution, overload binding, control flow, runtime dispatch, and test execution are not verified."],
    symbols,
    imports,
    exports: { names: [...exported].sort(), status: "static" },
  };
}
