import { createHash } from "node:crypto";
import { containsDomainTerm } from "../src/domain.ts";
import type { SemanticSliceSelector } from "../src/slice.ts";
import type { SourceAnalysis, SourceAnalyzer, SourceImport, SourceSymbol } from "../src/source-analysis.ts";

type Token = { value: string; start: number; end: number; line: number };
const RUST = /\.rs$/i;
const CARGO = /(^|\/)Cargo\.toml$/;
const LIMIT = 120_000;
const MAX_ITEMS = 200;
const RAW_STRING = /(?:b?r)(#+)?"/y;
const IDENTIFIER = /[A-Za-z_][A-Za-z0-9_]*/y;
const RAW_IDENTIFIER = /r#([A-Za-z_][A-Za-z0-9_]*)/y;
const NUMBER = /\d[\w.]*/y;

function matchAt(expression: RegExp, source: string, index: number): RegExpExecArray | null {
  expression.lastIndex = index;
  return expression.exec(source);
}

function tokenize(source: string): { tokens: Token[]; valid: boolean } {
  const tokens: Token[] = [];
  let index = 0, line = 1, valid = true;
  const advance = (end: number) => { while (index < end) { if (source[index] === "\n") line++; index++; } };
  while (index < source.length) {
    const start = index, startLine = line, char = source[index]!;
    if (/\s/.test(char)) { advance(index + 1); continue; }
    if (source.startsWith("//", index)) { const end = source.indexOf("\n", index); advance(end < 0 ? source.length : end); continue; }
    if (source.startsWith("/*", index)) {
      let depth = 1; advance(index + 2);
      while (index < source.length && depth) {
        if (source.startsWith("/*", index)) { depth++; advance(index + 2); }
        else if (source.startsWith("*/", index)) { depth--; advance(index + 2); }
        else advance(index + 1);
      }
      if (depth) valid = false;
      continue;
    }
    const raw = matchAt(RAW_STRING, source, index);
    if (raw) {
      const hashes = raw[1] ?? "", close = `"${hashes}`;
      advance(index + raw[0].length);
      const end = source.indexOf(close, index);
      if (end < 0) { valid = false; advance(source.length); } else advance(end + close.length);
      tokens.push({ value: "<string>", start, end: index, line: startLine }); continue;
    }
    const prefix = source.startsWith('b"', index) || source.startsWith('c"', index) ? 1 : 0;
    if (source[index + prefix] === '"') {
      advance(index + prefix + 1); let closed = false;
      while (index < source.length) {
        if (source[index] === "\\") advance(Math.min(source.length, index + 2));
        else if (source[index] === '"') { advance(index + 1); closed = true; break; }
        else advance(index + 1);
      }
      if (!closed) valid = false;
      tokens.push({ value: "<string>", start, end: index, line: startLine }); continue;
    }
    if (char === "'") {
      const close = source.indexOf("'", index + 1);
      if (close > index + 1 && close - index <= 6) { advance(close + 1); tokens.push({ value: "<char>", start, end: index, line: startLine }); continue; }
    }
    const rawIdentifier = matchAt(RAW_IDENTIFIER, source, index);
    if (rawIdentifier) { advance(index + rawIdentifier[0].length); tokens.push({ value: rawIdentifier[1]!, start, end: index, line: startLine }); continue; }
    const identifier = matchAt(IDENTIFIER, source, index)?.[0];
    if (identifier) { advance(index + identifier.length); tokens.push({ value: identifier, start, end: index, line: startLine }); continue; }
    const number = matchAt(NUMBER, source, index)?.[0];
    if (number) { advance(index + number.length); tokens.push({ value: number, start, end: index, line: startLine }); continue; }
    const operator = ["::", "->", "=>", "..=", "...", "..", "&&", "||", "==", "!=", "<=", ">=", "+=", "-=", "*=", "/="].find((item) => source.startsWith(item, index)) ?? char;
    advance(index + operator.length); tokens.push({ value: operator, start, end: index, line: startLine });
  }
  const stack: string[] = [];
  const pairs: Record<string, string> = { ")": "(", "]": "[", "}": "{" };
  for (const token of tokens) {
    if (["(", "[", "{"].includes(token.value)) stack.push(token.value);
    else if (token.value in pairs && stack.pop() !== pairs[token.value]) valid = false;
  }
  return { tokens, valid: valid && stack.length === 0 };
}

function matchPairs(tokens: Token[]): Map<number, number> {
  const result = new Map<number, number>(), stack: number[] = [];
  for (let i = 0; i < tokens.length; i++) {
    if (["(", "[", "{"].includes(tokens[i]!.value)) stack.push(i);
    else if ([")", "]", "}"].includes(tokens[i]!.value)) { const start = stack.pop(); if (start !== undefined) { result.set(start, i); result.set(i, start); } }
  }
  return result;
}

function compact(source: string, tokens: Token[], start: number, end: number): string {
  if (start >= end) return "";
  return source.slice(tokens[start]!.start, tokens[end - 1]!.end).replace(/\s+/g, " ").trim().slice(0, 800);
}

function splitTop(tokens: Token[], start: number, end: number, separator = ","): Array<[number, number]> {
  const parts: Array<[number, number]> = []; let depth = 0, cursor = start;
  for (let i = start; i < end; i++) {
    if (["(", "[", "{", "<"].includes(tokens[i]!.value)) depth++;
    else if ([")", "]", "}", ">"].includes(tokens[i]!.value)) depth--;
    else if (tokens[i]!.value === separator && depth === 0) { parts.push([cursor, i]); cursor = i + 1; }
  }
  if (cursor < end) parts.push([cursor, end]);
  return parts;
}

function fields(source: string, tokens: Token[], start: number, end: number, kind: "struct" | "variant") {
  return splitTop(tokens, start, end).flatMap(([from, to], index) => {
    while (from < to && (tokens[from]!.value === "pub" || tokens[from]!.value === "(" || tokens[from]!.value === ")" || tokens[from]!.value === "crate" || tokens[from]!.value === "super")) from++;
    const colon = tokens.slice(from, to).findIndex((token) => token.value === ":");
    if (colon >= 0) {
      const at = from + colon, name = tokens[at - 1]?.value;
      if (name && /^[A-Za-z_]\w*$/.test(name)) return [{ name, annotation: compact(source, tokens, at + 1, to), defaultValue: "", line: tokens[at - 1]!.line, kind }];
    }
    const annotation = compact(source, tokens, from, to);
    return annotation ? [{ name: String(index), annotation, defaultValue: "", line: tokens[from]!.line, kind }] : [];
  }).slice(0, 100);
}

function parseUse(source: string, tokens: Token[], start: number, end: number, line: number, scope: string, context: string[]): SourceImport {
  const raw = compact(source, tokens, start, end).replace(/^use\s+/, "").replace(/;$/, "");
  const brace = raw.indexOf("{");
  if (brace >= 0) {
    const module = raw.slice(0, brace).replace(/::$/, "").trim();
    const names = raw.slice(brace + 1, raw.lastIndexOf("}")).split(",").map((item) => item.trim()).filter(Boolean);
    return { module, names: names.map((name) => name.split(/\s+as\s+/)[0]!), aliases: names.map((name) => { const [original, alias] = name.split(/\s+as\s+/); return { name: original!, asName: alias ?? null }; }), level: 0, line, scope, context, kind: "use" };
  }
  const [original, alias] = raw.split(/\s+as\s+/); const parts = original!.split("::");
  return { module: original!, names: [parts.at(-1)!], aliases: [{ name: parts.at(-1)!, asName: alias ?? null }], level: 0, line, scope, context, kind: "use" };
}

function analyzeRust(path: string, source: string): SourceAnalysis {
  const lexed = tokenize(source);
  if (!lexed.valid) return { language: "rust", status: "invalid", parser: "imitator-rust-static-v1", limitations: ["Unbalanced or unterminated Rust lexical structure; no partial syntax claimed."], symbols: [], imports: [] };
  const tokens = lexed.tokens, pairs = matchPairs(tokens), symbols: SourceSymbol[] = [], imports: SourceImport[] = [], exports = new Set<string>();
  const limitations = ["Static Rust syntax only; no macro expansion, name/type/borrow checking, feature evaluation, build scripts or procedural macros."];
  const parseRange = (begin: number, end: number, parent: string[] = [], inheritedContext: string[] = []): void => {
    let i = begin, pending: string[] = [], pendingLine: number | undefined;
    while (i < end && symbols.length < MAX_ITEMS) {
      if (tokens[i]!.value === "#" && tokens[i + 1]?.value === "[") {
        const close = pairs.get(i + 1); if (close === undefined || close >= end) { i++; continue; }
        pendingLine ??= tokens[i]!.line; pending.push(compact(source, tokens, i + 2, close)); i = close + 1; continue;
      }
      const itemStart = i; let visibility = "private";
      if (tokens[i]!.value === "pub") {
        visibility = "pub"; i++;
        if (tokens[i]?.value === "(") { const close = pairs.get(i) ?? i; visibility = `pub(${compact(source, tokens, i + 1, close)})`; i = close + 1; }
      }
      const modifiers: string[] = [];
      while (["unsafe", "async", "default", "extern", "auto"].includes(tokens[i]?.value ?? "") || tokens[i]?.value === "const" && tokens[i + 1]?.value === "fn") {
        modifiers.push(tokens[i++]!.value);
        if (modifiers.at(-1) === "extern" && tokens[i]?.value === "<string>") i++;
      }
      const keyword = tokens[i]?.value;
      if (keyword === "use") {
        let stop = i; while (stop < end && tokens[stop]!.value !== ";") stop++;
        const context = [...inheritedContext, ...pending.filter((item) => /^(?:cfg(?:_attr)?|path)\b/.test(item))];
        const item = parseUse(source, tokens, i, Math.min(end, stop + 1), tokens[i]!.line, parent.join("::") || "module", context);
        imports.push(item); if (visibility === "pub" && parent.length === 0) item.aliases?.forEach((alias) => exports.add(alias.asName ?? alias.name));
        pending = []; pendingLine = undefined; i = stop + 1; continue;
      }
      if (keyword === "mod" && /^[A-Za-z_]\w*$/.test(tokens[i + 1]?.value ?? "")) {
        const name = tokens[i + 1]!.value, open = tokens.slice(i + 2, end).findIndex((token) => token.value === "{"), semi = tokens.slice(i + 2, end).findIndex((token) => token.value === ";");
        const openAt = open < 0 ? Infinity : i + 2 + open, semiAt = semi < 0 ? Infinity : i + 2 + semi, close = openAt < semiAt ? pairs.get(openAt)! : semiAt;
        const context = [...inheritedContext, ...pending.filter((item) => /^(?:cfg(?:_attr)?|path)\b/.test(item))];
        symbols.push({ name: [...parent, name].join("::"), kind: "module", startLine: pendingLine ?? tokens[itemStart]!.line, endLine: tokens[close]!.line, signature: compact(source, tokens, itemStart, Math.min(close + 1, end)), decorators: pending, attributes: pending, bases: [], raises: [], catches: [], assertionCount: 0, role: "implementation", traits: [openAt < semiAt ? "inline-module" : "file-module"], visibility, hasBody: openAt < semiAt });
        if (visibility === "pub" && parent.length === 0) exports.add(name);
        if (openAt < semiAt) parseRange(openAt + 1, close, [...parent, name], context);
        else imports.push({ module: name, names: [], level: 0, line: tokens[i]!.line, scope: parent.join("::") || "module", context, kind: "module" });
        pending = []; pendingLine = undefined; i = close + 1; continue;
      }
      const supported = ["struct", "union", "enum", "trait", "impl", "fn", "type", "const", "static", "macro_rules"].includes(keyword ?? "");
      if (!supported) { pending = []; pendingLine = undefined; i = itemStart + 1; continue; }
      let cursor = i + 1;
      if (keyword === "macro_rules" && tokens[cursor]?.value === "!") cursor++;
      if (keyword === "static" && tokens[cursor]?.value === "mut") { modifiers.push("mut"); cursor++; }
      let openAt = -1, semiAt = -1, depth = 0;
      for (let at = cursor; at < end; at++) {
        const value = tokens[at]!.value;
        if (["(", "[", "<"].includes(value)) depth++;
        else if ([")", "]", ">"].includes(value)) depth--;
        else if (depth === 0 && value === "{") { openAt = at; break; }
        else if (depth === 0 && value === ";") { semiAt = at; break; }
      }
      const finish = openAt >= 0 ? pairs.get(openAt) : semiAt;
      if (finish === undefined || finish < 0 || finish >= end) { pending = []; pendingLine = undefined; i = itemStart + 1; continue; }
      let name = tokens[cursor]?.value ?? keyword!; let bases: string[] = [], implementedFor: string | undefined;
      if (keyword === "impl") {
        const header = compact(source, tokens, cursor, openAt);
        const match = header.match(/^(.*?)\s+for\s+(.+?)(?:\s+where\s+.*)?$/);
        implementedFor = (match?.[2] ?? header).trim(); bases = match ? [match[1]!.trim()] : [];
        name = `impl ${match ? `${match[1]!.trim()} for ` : ""}${implementedFor}`;
      }
      const qualified = [...parent, name].join("::"), attributes = [...pending], context = [...inheritedContext, ...attributes.filter((item) => /^(?:cfg(?:_attr)?|path)\b/.test(item))];
      const kind = keyword === "fn" ? (modifiers.includes("async") ? "async-function" : "function") : keyword === "macro_rules" ? "macro" : keyword as SourceSymbol["kind"];
      const bodyText = openAt >= 0 ? compact(source, tokens, openAt + 1, finish) : "";
      const bodySyntax = openAt >= 0 ? tokens.slice(openAt + 1, finish).map((token) => token.value).join(" ") : "";
      const role = (kind === "function" || kind === "async-function") && attributes.some((item) => /^(?:[\w:]+::)?test(?:\s|$|\()/.test(item)) ? "test" : "implementation";
      const traits = keyword === "trait" ? ["trait-contract", ...(modifiers.includes("unsafe") ? ["unsafe-trait"] : []), ...(modifiers.includes("auto") ? ["auto-trait"] : [])] : keyword === "impl" ? [bases.length ? "trait-implementation" : "inherent-implementation"] : keyword === "static" && modifiers.includes("mut") ? ["mutable-static"] : [];
      let itemFields: SourceSymbol["fields"] = [], variants: string[] = [];
      if ((keyword === "struct" || keyword === "union") && openAt >= 0) itemFields = fields(source, tokens, openAt + 1, finish, "struct");
      if (keyword === "struct" && openAt < 0) {
        const tuple = tokens.slice(cursor + 1, finish).findIndex((token) => token.value === "(");
        if (tuple >= 0) { const tupleStart = cursor + 1 + tuple, tupleEnd = pairs.get(tupleStart); if (tupleEnd !== undefined) itemFields = fields(source, tokens, tupleStart + 1, tupleEnd, "struct"); }
      }
      if (keyword === "enum" && openAt >= 0) {
        const parts = splitTop(tokens, openAt + 1, finish); variants = parts.map(([from]) => tokens[from]?.value).filter((value): value is string => Boolean(value && /^[A-Za-z_]\w*$/.test(value))).slice(0, 100);
        itemFields = variants.map((variant) => ({ name: variant, annotation: "enum variant", defaultValue: "", line: tokens.find((token, at) => at >= openAt && token.value === variant)?.line ?? tokens[openAt]!.line, kind: "variant" }));
      }
      const errorSignals = kind === "function" || kind === "async-function" ? [bodySyntax.includes("?") ? "question-mark-propagation" : "", /\bResult\s*</.test(compact(source, tokens, i, openAt >= 0 ? openAt : finish)) ? "result-return" : "", /\b(?:panic|todo|unimplemented)\s*!/.test(bodySyntax) ? "panic-like-macro" : ""].filter(Boolean) : [];
      symbols.push({ name: qualified, kind, startLine: pendingLine ?? tokens[itemStart]!.line, endLine: tokens[finish]!.line, signature: compact(source, tokens, itemStart, openAt >= 0 ? openAt : finish + 1), decorators: attributes, attributes, bases, raises: [], catches: [], assertionCount: kind === "function" || kind === "async-function" ? (bodySyntax.match(/\b(?:assert|assert_eq|assert_ne|debug_assert)\s*!/g) ?? []).length : 0, role, traits, fields: itemFields, variants, parameters: kind === "function" || kind === "async-function" ? compact(source, tokens, cursor + 1, openAt >= 0 ? openAt : finish).match(/\((.*?)\)/)?.[1]?.split(",").map((value) => value.trim()).filter(Boolean) ?? [] : [], hasBody: openAt >= 0 && bodySyntax.length > 0, visibility, errorSignals, unsafeCount: (bodySyntax.match(/\bunsafe\b/g) ?? []).length + Number(modifiers.includes("unsafe")), implementedFor });
      if (visibility === "pub" && parent.length === 0 && keyword !== "impl") exports.add(name);
      if (openAt >= 0 && ["trait", "impl"].includes(keyword!)) parseRange(openAt + 1, finish, [...parent, name], context);
      pending = []; pendingLine = undefined; i = finish + 1;
    }
  };
  parseRange(0, tokens.length);
  if (symbols.length >= MAX_ITEMS || imports.length >= MAX_ITEMS) limitations.push("Observations truncated to 200 symbols and 200 imports.");
  limitations.push("Nested use trees are retained at their common prefix; glob expansion and item-vs-module identity are not resolved.");
  return { language: "rust", status: "parsed", parser: "imitator-rust-static-v1", limitations, symbols: symbols.slice(0, MAX_ITEMS), imports: imports.slice(0, MAX_ITEMS), exports: { names: [...exports].sort(), status: "static" } };
}

function stripTomlComment(line: string): string {
  let quote = "", escaped = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i]!;
    if (escaped) { escaped = false; continue; }
    if (char === "\\" && quote === '"') { escaped = true; continue; }
    if ((char === '"' || char === "'") && (!quote || quote === char)) { quote = quote ? "" : char; continue; }
    if (char === "#" && !quote) return line.slice(0, i);
  }
  return line;
}

function tomlBracketDelta(line: string): number {
  let quote = "", escaped = false, delta = 0;
  for (const char of line) {
    if (escaped) { escaped = false; continue; }
    if (char === "\\" && quote === '"') { escaped = true; continue; }
    if ((char === '"' || char === "'") && (!quote || quote === char)) { quote = quote ? "" : char; continue; }
    if (!quote && char === "[") delta++;
    if (!quote && char === "]") delta--;
  }
  return delta;
}

function tomlStrings(value: string): string[] {
  return [...value.matchAll(/["']([^"']+)["']/g)].map((match) => match[1]!);
}

function parseCargo(content: string): SourceAnalysis {
  const dependencies = new Set<string>(), development = new Set<string>(), workspacePatterns = new Set<string>(), features = new Set<string>();
  const targets: Array<{ name: string; kind: string; path?: string }> = []; let section = "", packageName: string | undefined, edition: string | undefined, currentTarget: typeof targets[number] | undefined;
  const logical: string[] = []; let buffer = "", brackets = 0;
  for (const physical of content.replace(/\r\n/g, "\n").split("\n")) {
    const line = stripTomlComment(physical).trim(); if (!line) continue;
    buffer += (buffer ? " " : "") + line; brackets += tomlBracketDelta(line);
    if (brackets <= 0) { logical.push(buffer); buffer = ""; brackets = 0; }
  }
  if (buffer) return { language: "rust", status: "invalid", parser: "imitator-cargo-static-v1", limitations: ["Unterminated Cargo TOML array; no partial metadata claimed."], symbols: [], imports: [] };
  for (const line of logical) {
    const arrayTable = line.match(/^\[\[\s*([^\]]+)\s*\]\]$/);
    if (arrayTable) { section = arrayTable[1]!; currentTarget = ["bin", "example", "test", "bench"].includes(section) ? { name: "", kind: section } : undefined; if (currentTarget) targets.push(currentTarget); continue; }
    const table = line.match(/^\[\s*([^\]]+)\s*\]$/); if (table) {
      section = table[1]!; currentTarget = section === "lib" ? { name: "", kind: "lib" } : undefined; if (currentTarget) targets.push(currentTarget);
      const dependencyTable = section.match(/(?:^|\.)(dependencies|dev-dependencies|build-dependencies)\.([A-Za-z0-9_-]+)$/);
      if (dependencyTable) (dependencyTable[1] === "dependencies" ? dependencies : development).add(dependencyTable[2]!);
      continue;
    }
    const pair = line.match(/^([A-Za-z0-9_.-]+)\s*=\s*(.*)$/); if (!pair) continue;
    const key = pair[1]!, value = pair[2]!, scalar = value.match(/^["'](.*)["']$/)?.[1];
    if (section === "package" && key === "name" && scalar !== undefined) packageName = scalar;
    if (section === "package" && key === "edition" && scalar !== undefined) edition = scalar;
    if (/^(?:target\..+\.)?(?:workspace\.)?dependencies$/.test(section) || /\.dependencies$/.test(section) && !/dev-dependencies$|build-dependencies$/.test(section)) dependencies.add(key);
    if (/dev-dependencies$|build-dependencies$/.test(section)) development.add(key);
    if (section === "workspace" && key === "members") tomlStrings(value).forEach((item) => workspacePatterns.add(item));
    if (section === "features") features.add(key);
    if (currentTarget && scalar !== undefined && key === "name") currentTarget.name = scalar;
    if (currentTarget && scalar !== undefined && key === "path") currentTarget.path = scalar;
  }
  for (const target of targets) if (!target.name) target.name = target.kind === "lib" ? packageName ?? "library" : packageName ?? target.kind;
  const entries = targets.filter((target) => target.path).map((target) => target.path!);
  const truncated = [dependencies, development, workspacePatterns, features].some((set) => set.size > MAX_ITEMS) || targets.length > MAX_ITEMS;
  return { language: "rust", status: "parsed", parser: "imitator-cargo-static-v1", limitations: ["Static Cargo subset only; workspace inheritance, target cfg evaluation, build scripts, patches and dependency feature unification are not evaluated.", ...(truncated ? ["Cargo observations truncated to 200 items per category."] : [])], symbols: [], imports: [], manifest: { packageName, dependencies: [...dependencies].sort().slice(0, MAX_ITEMS), developmentDependencies: [...development].sort().slice(0, MAX_ITEMS), scripts: [], workspacePatterns: [...workspacePatterns].sort().slice(0, MAX_ITEMS), entryTargets: [...new Set(entries)].sort().slice(0, MAX_ITEMS), format: "cargo", completeness: "partial", edition, features: [...features].sort().slice(0, MAX_ITEMS), targets: targets.slice(0, MAX_ITEMS) } };
}

export function createRustAnalysis(): { analyze: SourceAnalyzer; selectWindow: SemanticSliceSelector } {
  const cache = new Map<string, SourceAnalysis>();
  const analyze: SourceAnalyzer = ({ path, content }) => {
    if (!RUST.test(path) && !CARGO.test(path)) return undefined;
    if (content.length > LIMIT) return { language: "rust", status: "budget-exceeded", parser: "imitator-rust-static-v1", limitations: ["Source exceeds 120000-character parser budget."], symbols: [], imports: [] };
    const key = createHash("sha256").update(`${path}\0${content}`).digest("hex"); const cached = cache.get(key); if (cached) return cached;
    let result: SourceAnalysis;
    try { result = CARGO.test(path) ? parseCargo(content) : analyzeRust(path, content); }
    catch { result = { language: "rust", status: "invalid", parser: "imitator-rust-static-v1", limitations: ["Rust structure exceeded parser limits or is unsupported; no partial syntax claimed."], symbols: [], imports: [] }; }
    if (JSON.stringify(result).length > 32_000) {
      result.limitations.push("Rust syntax metadata truncated to a 32000-character JSON budget.");
      while (JSON.stringify(result).length > 32_000 && result.symbols.length) result.symbols.pop();
      while (JSON.stringify(result).length > 32_000 && result.imports.length) result.imports.pop();
      if (JSON.stringify(result).length > 32_000) result = { language: "rust", status: "budget-exceeded", parser: result.parser, limitations: ["Rust syntax or Cargo metadata exceeds the 32000-character output budget; no partial metadata claimed."], symbols: [], imports: [] };
    }
    if (cache.size >= 128) cache.delete(cache.keys().next().value!); cache.set(key, result); return result;
  };
  const selectWindow: SemanticSliceSelector = ({ path, content, terms, maxLines }) => {
    if (!RUST.test(path)) return undefined; const analysis = analyze({ path, content }); if (analysis?.status !== "parsed") return undefined;
    const lines = content.replace(/\r\n/g, "\n").split("\n");
    const candidates = analysis.symbols.filter((symbol) => symbol.kind !== "module" && symbol.endLine - symbol.startLine + 1 <= maxLines && (symbol.role !== "test" || symbol.hasBody !== false)).map((symbol) => {
      const selected = lines.slice(symbol.startLine - 1, symbol.endLine).join("\n"), nameHits = terms.filter((term) => containsDomainTerm(symbol.name, term)).length, bodyHits = terms.filter((term) => containsDomainTerm(selected, term)).length;
      const architecture = ["trait", "struct", "enum", "impl"].includes(symbol.kind) ? 4 : 0, publicSignal = symbol.visibility === "pub" ? 3 : 0;
      return { symbol, selected, score: nameHits * 8 + bodyHits * 5 + architecture + publicSignal };
    }).sort((a, b) => b.score - a.score || a.symbol.startLine - b.symbol.startLine || a.symbol.name.localeCompare(b.symbol.name));
    const best = candidates[0]; if (!best) return undefined;
    return { start: best.symbol.startLine, end: best.symbol.endLine, content: best.selected, relevance: best.score, strategy: "rust-syntax", symbols: [best.symbol.name] };
  };
  return { analyze, selectWindow };
}
