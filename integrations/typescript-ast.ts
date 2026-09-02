import ts from "typescript";
import type { SemanticSliceSelector, SliceWindow } from "../src/slice.ts";

const SUPPORTED = /\.[cm]?[jt]sx?$/i;

function nodeName(node: ts.Node, source: ts.SourceFile): string | undefined {
  if ("name" in node) {
    const name = (node as ts.NamedDeclaration).name;
    if (name) return name.getText(source);
  }
  if (ts.isVariableStatement(node)) {
    return node.declarationList.declarations.map((declaration) => declaration.name.getText(source)).join(", ");
  }
  if (ts.isExpressionStatement(node) && ts.isCallExpression(node.expression)) {
    return node.expression.expression.getText(source);
  }
  return undefined;
}

function isSemanticUnit(node: ts.Node): boolean {
  if (ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node) || ts.isEnumDeclaration(node)) return true;
  if (ts.isClassDeclaration(node) || ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node)) return true;
  if (ts.isVariableStatement(node)) return true;
  if (ts.isExpressionStatement(node) && ts.isCallExpression(node.expression)) {
    const callee = node.expression.expression.getText();
    return /^(describe|it|test|suite)(\.|$)/.test(callee);
  }
  return false;
}

function termHits(text: string, terms: string[]): number {
  const lower = text.toLowerCase();
  return terms.reduce((score, term) => score + (lower.includes(term.toLowerCase()) ? 1 : 0), 0);
}

export const selectTypeScriptAstWindow: SemanticSliceSelector = ({ path, content, terms, maxLines }): SliceWindow | undefined => {
  if (!SUPPORTED.test(path) || !content.trim()) return undefined;
  const kind = path.endsWith("x") ? ts.ScriptKind.TSX : path.match(/\.[cm]?ts$/i) ? ts.ScriptKind.TS : ts.ScriptKind.JS;
  const source = ts.createSourceFile(path, content, ts.ScriptTarget.Latest, true, kind);
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  const candidates: Array<SliceWindow & { score: number }> = [];

  const visit = (node: ts.Node): void => {
    if (isSemanticUnit(node)) {
      const start = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
      const end = source.getLineAndCharacterOfPosition(node.end).line + 1;
      const lineCount = end - start + 1;
      if (lineCount >= 2 && lineCount <= maxLines) {
        const selected = lines.slice(start - 1, end).join("\n");
        const name = nodeName(node, source);
        const hits = termHits(selected, terms);
        const nameHits = name ? termHits(name, terms) : 0;
        const exported = ts.canHaveModifiers(node)
          && ts.getModifiers(node)?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword) ? 3 : 0;
        const contract = ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node) ? 4 : 0;
        const behavioral = ts.isExpressionStatement(node) ? 3 : 0;
        candidates.push({
          start,
          end,
          content: selected,
          relevance: hits * 5 + nameHits * 8 + exported + contract + behavioral + 2,
          strategy: "typescript-ast",
          symbols: name ? [name] : undefined,
          score: hits * 5 + nameHits * 8 + exported + contract + behavioral - lineCount * 0.01,
        });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  candidates.sort((a, b) => b.score - a.score || a.start - b.start);
  const best = candidates[0];
  if (!best) return undefined;
  const { score: _score, ...window } = best;
  return window;
};
