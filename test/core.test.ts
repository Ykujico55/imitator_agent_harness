import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, relative, resolve, sep } from "node:path";
import test from "node:test";
import ts from "typescript";

const SRC_DIR = resolve("src");
const INTEGRATIONS_DIR = resolve("integrations");
const PROVIDER_PACKAGES = ["@earendil-works/", "typebox"] as const;

type CoreModule = { path: string; source: string };

function scriptKind(path: string): ts.ScriptKind {
  if (/\.tsx$/i.test(path)) return ts.ScriptKind.TSX;
  if (/\.[cm]?ts$/i.test(path)) return ts.ScriptKind.TS;
  if (/\.jsx$/i.test(path)) return ts.ScriptKind.JSX;
  return ts.ScriptKind.JS;
}

function stringArgument(node: ts.Node | undefined): string | undefined {
  return node && (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) ? node.text : undefined;
}

function importSpecifiers(source: string, path = "module.ts"): string[] {
  const parsed = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, scriptKind(path));
  const specifiers: string[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      const specifier = stringArgument(node.moduleSpecifier);
      if (specifier) specifiers.push(specifier);
    } else if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) {
      const specifier = stringArgument(node.moduleReference.expression);
      if (specifier) specifiers.push(specifier);
    } else if (ts.isCallExpression(node)) {
      const loadsModule = node.expression.kind === ts.SyntaxKind.ImportKeyword
        || (ts.isIdentifier(node.expression) && node.expression.text === "require");
      const specifier = loadsModule ? stringArgument(node.arguments[0]) : undefined;
      if (specifier) specifiers.push(specifier);
    }
    ts.forEachChild(node, visit);
  };
  visit(parsed);
  return specifiers;
}

function isBareSpecifier(specifier: string): boolean {
  return !specifier.startsWith("node:") && !specifier.startsWith("./") && !specifier.startsWith("../");
}

function resolvesInside(path: string, specifier: string, directory: string): boolean {
  if (isBareSpecifier(specifier)) return false;
  const target = resolve(dirname(path), specifier);
  return target === directory || target.startsWith(`${directory}${sep}`);
}

async function coreModules(directory = SRC_DIR): Promise<CoreModule[]> {
  const modules: CoreModule[] = [];
  const visit = async (current: string): Promise<void> => {
    const entries = await readdir(current, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const path = resolve(current, entry.name);
      if (entry.isDirectory()) await visit(path);
      else if (entry.isFile() && /\.[cm]?[jt]sx?$/i.test(entry.name)) {
        modules.push({ path, source: await readFile(path, "utf8") });
      }
    }
  };
  await visit(directory);
  assert.ok(modules.length > 0, `expected core modules to exist under ${directory}`);
  return modules;
}

test("core modules import no external dependency", async () => {
  const modules = await coreModules();
  const violations: string[] = [];
  for (const module of modules) {
    for (const specifier of importSpecifiers(module.source, module.path)) {
      if (isBareSpecifier(specifier)) violations.push(`external_module_import:${relative(SRC_DIR, module.path)}:${specifier}`);
    }
  }
  assert.deepEqual(violations, [], "core modules must depend only on node: builtins and sibling modules");
});

test("core modules never import provider packages or integration adapters", async () => {
  const modules = await coreModules();
  const violations: string[] = [];
  for (const module of modules) {
    for (const specifier of importSpecifiers(module.source, module.path)) {
      const providerPackage = PROVIDER_PACKAGES.some((name) => specifier === name || specifier.startsWith(name));
      if (providerPackage || resolvesInside(module.path, specifier, INTEGRATIONS_DIR)) {
        violations.push(`provider_boundary_import:${relative(SRC_DIR, module.path)}:${specifier}`);
      }
    }
  }
  assert.deepEqual(violations, [], "provider packages and integration adapters must remain outside src/");
});

test("dependency analysis detects all supported module-loading forms", () => {
  const source = [
    'import value from "static-package";',
    'import "side-effect-package";',
    'export { value } from "export-package";',
    'import legacy = require("equals-package");',
    'const dynamic = import("dynamic-package");',
    'const commonjs = require("require-package");',
    'import type { Local } from "./local.ts";',
    'import { readFile } from "node:fs/promises";',
  ].join("\n");
  assert.deepEqual(importSpecifiers(source).filter(isBareSpecifier), [
    "static-package",
    "side-effect-package",
    "export-package",
    "equals-package",
    "dynamic-package",
    "require-package",
  ]);
});

test("core boundary traversal includes nested source modules", async (t) => {
  const root = await mkdtemp(resolve(tmpdir(), "imitator-core-boundary-"));
  t.after(async () => rm(root, { recursive: true, force: true }));
  await mkdir(resolve(root, "nested"));
  await writeFile(resolve(root, "root.ts"), 'import "node:path";\n', "utf8");
  await writeFile(resolve(root, "nested", "provider.ts"), 'import "typebox";\n', "utf8");
  const modules = await coreModules(root);
  assert.deepEqual(modules.map((module) => relative(root, module.path).replaceAll("\\", "/")), ["nested/provider.ts", "root.ts"]);
  assert.deepEqual(modules.flatMap((module) => importSpecifiers(module.source, module.path)).filter(isBareSpecifier), ["typebox"]);
});
