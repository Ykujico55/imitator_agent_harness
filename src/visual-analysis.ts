import type {
  VisualAuditFinding,
  VisualAuditReport,
  VisualMetric,
  VisualSourceFile,
  VisualStaticInventory,
  VisualStyleProfile,
} from "./visual-types.ts";

type MetricAccumulator = Map<string, { count: number; paths: Set<string> }>;

function addMatches(target: MetricAccumulator, path: string, values: Iterable<string>): void {
  for (const raw of values) {
    const value = raw.trim().toLowerCase().replace(/\s+/g, " ");
    if (!value) continue;
    const entry = target.get(value) ?? { count: 0, paths: new Set<string>() };
    entry.count += 1;
    entry.paths.add(path);
    target.set(value, entry);
  }
}

function captures(content: string, pattern: RegExp, group = 1): string[] {
  pattern.lastIndex = 0;
  return [...content.matchAll(pattern)].map((match) => match[group] ?? match[0]).filter(Boolean);
}

function staticClassTokens(content: string): string[] {
  const values: string[] = [];
  const pattern = /\bclass(?:Name)?\s*=\s*(?:"([^"]*)"|'([^']*)'|`([^`]*)`)/giu;
  for (const match of content.matchAll(pattern)) {
    values.push(...(match[1] ?? match[2] ?? match[3] ?? "").split(/\s+/).filter(Boolean));
  }
  return values;
}

function metrics(values: MetricAccumulator): VisualMetric[] {
  return [...values.entries()]
    .map(([value, entry]) => ({ value, count: entry.count, paths: [...entry.paths].sort() }))
    .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
}

function occurrences(items: VisualMetric[]): number {
  return items.reduce((sum, item) => sum + item.count, 0);
}

function colorChannels(value: string): [number, number, number] | undefined {
  const normalized = value.trim().toLowerCase();
  const shortHex = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(normalized);
  if (shortHex) return shortHex.slice(1).map((part) => Number.parseInt(`${part}${part}`, 16)) as [number, number, number];
  const longHex = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})(?:ff)?$/i.exec(normalized);
  if (longHex) return longHex.slice(1, 4).map((part) => Number.parseInt(part, 16)) as [number, number, number];
  const rgb = /^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})(?:\s*,\s*(1(?:\.0)?))?\s*\)$/i.exec(normalized);
  if (rgb) return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])];
  return undefined;
}

function isPureBlack(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  if (normalized === "black") return true;
  const channels = colorChannels(normalized);
  if (channels?.every((channel) => channel === 0)) return true;
  return /^(?:hsl\(\s*)?0(?:deg)?[ ,]+0%[ ,]+0%(?:\s*\/\s*100%)?\s*\)?$/i.test(normalized);
}

function isNearBlack(value: string): boolean {
  if (isPureBlack(value)) return false;
  const channels = colorChannels(value);
  if (channels) return channels.every((channel) => channel <= 24);
  const lightness = /^(?:hsl\(\s*)?\d+(?:\.\d+)?(?:deg)?[ ,]+\d+(?:\.\d+)?%[ ,]+(\d+(?:\.\d+)?)%/i.exec(value.trim());
  return Boolean(lightness && Number(lightness[1]) <= 8);
}

export function analyzeVisualSources(files: readonly VisualSourceFile[]): VisualStaticInventory {
  const buckets = {
    customPropertyDefinitions: new Map<string, { count: number; paths: Set<string> }>(),
    customPropertyReferences: new Map<string, { count: number; paths: Set<string> }>(),
    colors: new Map<string, { count: number; paths: Set<string> }>(),
    fontSizes: new Map<string, { count: number; paths: Set<string> }>(),
    radii: new Map<string, { count: number; paths: Set<string> }>(),
    pureBlackBackgrounds: new Map<string, { count: number; paths: Set<string> }>(),
    nearBlackBackgrounds: new Map<string, { count: number; paths: Set<string> }>(),
    borderDeclarations: new Map<string, { count: number; paths: Set<string> }>(),
    shadows: new Map<string, { count: number; paths: Set<string> }>(),
    gradients: new Map<string, { count: number; paths: Set<string> }>(),
    responsiveSignals: new Map<string, { count: number; paths: Set<string> }>(),
    cardLikeReferences: new Map<string, { count: number; paths: Set<string> }>(),
  } satisfies Record<string, MetricAccumulator>;
  const ordered = [...files]
    .map((file) => ({ path: file.path.replace(/\\/g, "/"), content: file.content }))
    .sort((a, b) => a.path.localeCompare(b.path));
  const visualVariables = new Map<string, string>();
  for (const file of ordered) {
    for (const match of file.content.matchAll(/(--[a-z0-9_-]+)\s*:\s*([^;}{]{1,160})/giu)) {
      visualVariables.set(match[1]!.toLowerCase(), match[2]!.trim());
    }
  }
  for (const file of ordered) {
    const { path, content } = file;
    const classTokens = staticClassTokens(content);
    addMatches(buckets.customPropertyDefinitions, path, captures(content, /(--[a-z0-9_-]+)\s*:\s*[^;}{]{1,160}/giu));
    addMatches(buckets.customPropertyReferences, path, captures(content, /var\(\s*(--[a-z0-9_-]+)/giu));
    addMatches(buckets.colors, path, captures(content, /(#[0-9a-f]{3,8}\b|(?:rgb|hsl)a?\([^)]{3,80}\))/giu));
    addMatches(buckets.fontSizes, path, [
      ...captures(content, /font-size\s*:\s*([^;}{]{1,40})/giu),
      ...classTokens.filter((token) => /^text-(?:xs|sm|base|lg|xl|[2-9]xl|\[[^\]]+\])$/iu.test(token)),
    ]);
    addMatches(buckets.radii, path, [
      ...captures(content, /border-radius\s*:\s*([^;}{]{1,40})/giu),
      ...classTokens.filter((token) => /^rounded(?:-[a-z0-9_[\]./-]+)?$/iu.test(token)),
    ]);
    const backgroundValues = captures(content, /(?:background|background-color)\s*:\s*([^;}{]{1,160})/giu);
    for (const raw of backgroundValues) {
      const variable = /^var\(\s*(--[a-z0-9_-]+)\s*\)$/iu.exec(raw.trim());
      const resolved = variable ? visualVariables.get(variable[1]!.toLowerCase()) : raw;
      if (!resolved) continue;
      const label = variable ? `${variable[1]} -> ${resolved}` : raw;
      if (isPureBlack(resolved)) addMatches(buckets.pureBlackBackgrounds, path, [label]);
      else if (isNearBlack(resolved)) addMatches(buckets.nearBlackBackgrounds, path, [label]);
    }
    addMatches(buckets.pureBlackBackgrounds, path, classTokens.filter((token) => /^bg-black(?:\/100)?$|^bg-\[#0{3,8}\]$/iu.test(token)));
    addMatches(buckets.nearBlackBackgrounds, path, classTokens.filter((token) => /^bg-(?:slate|gray|zinc|neutral|stone)-(?:900|950)$/iu.test(token)));
    addMatches(buckets.borderDeclarations, path, [
      ...captures(content, /\b(border(?:-[a-z]+)?)\s*:/giu),
      ...classTokens.filter((token) => /^border(?:-[trblxy])?(?:-[0-9]+)?$/iu.test(token)),
    ]);
    addMatches(buckets.shadows, path, [
      ...captures(content, /(box-shadow)\s*:/giu),
      ...classTokens.filter((token) => /^shadow(?:-[a-z0-9_[\]./-]+)?$/iu.test(token)),
    ]);
    addMatches(buckets.gradients, path, [
      ...captures(content, /\b((?:linear|radial|conic)-gradient)\b/giu),
      ...classTokens.filter((token) => /^bg-gradient-to-[trblxy]{1,2}$/iu.test(token)),
    ]);
    addMatches(buckets.responsiveSignals, path, [
      ...captures(content, /(@media)\s*\(/giu),
      ...classTokens.filter((token) => /^(?:sm|md|lg|xl|2xl):/iu.test(token)),
    ]);
    addMatches(buckets.cardLikeReferences, path, captures(content, /\b(card|panel|tile|surface-box)\b/giu));
  }
  return {
    schemaVersion: 1,
    inspectedFiles: ordered.map((file) => file.path),
    totalCharacters: ordered.reduce((sum, file) => sum + file.content.length, 0),
    customPropertyDefinitions: metrics(buckets.customPropertyDefinitions),
    customPropertyReferences: metrics(buckets.customPropertyReferences),
    colors: metrics(buckets.colors),
    fontSizes: metrics(buckets.fontSizes),
    radii: metrics(buckets.radii),
    pureBlackBackgrounds: metrics(buckets.pureBlackBackgrounds),
    nearBlackBackgrounds: metrics(buckets.nearBlackBackgrounds),
    borderDeclarations: metrics(buckets.borderDeclarations),
    shadows: metrics(buckets.shadows),
    gradients: metrics(buckets.gradients),
    responsiveSignals: metrics(buckets.responsiveSignals),
    cardLikeReferences: metrics(buckets.cardLikeReferences),
    limitations: [
      "Static CSS and markup signals do not prove rendered appearance or selector precedence.",
      "Class-name counts approximate visual structures and may include inactive or conditional code.",
      "No remote repository or local application code was executed.",
    ],
  };
}

function finding(
  findings: VisualAuditFinding[], condition: boolean, value: Omit<VisualAuditFinding, "evidence"> & { evidence: Iterable<string> },
): void {
  if (condition) findings.push({ ...value, evidence: [...new Set(value.evidence)].sort() });
}

export function auditVisualInventory(inventory: VisualStaticInventory, profile: VisualStyleProfile): VisualAuditReport {
  const findings: VisualAuditFinding[] = [];
  const borderCount = occurrences(inventory.borderDeclarations);
  const cardCount = occurrences(inventory.cardLikeReferences);
  const gradientCount = occurrences(inventory.gradients);
  const radiusCount = occurrences(inventory.radii);
  const dominantRadius = inventory.radii[0];
  const dominantRadiusRatio = radiusCount ? (dominantRadius?.count ?? 0) / radiusCount : 0;
  finding(findings, inventory.inspectedFiles.length === 0, {
    signal: "no-local-visual-sources", severity: "info",
    message: "No bounded local CSS, theme, or component styling source was available for a baseline audit.",
    evidence: [], remediation: "Implement the visual spec, then run the visual audit again.",
  });
  finding(findings, profile.auditConstraints.pureBlackSurface === "avoid" && inventory.pureBlackBackgrounds.length > 0, {
    signal: "pure-black-surface", severity: "error",
    message: `The ${profile.label} profile avoids pure-black page or panel surfaces, but ${occurrences(inventory.pureBlackBackgrounds)} occurrence(s) were found.`,
    evidence: inventory.pureBlackBackgrounds.flatMap((item) => item.paths),
    remediation: `Use the profile canvas/surface roles (${profile.palette.canvas}; ${profile.palette.surface}) and reserve dark ink for text or deliberate contrast.`,
  });
  finding(findings, profile.auditConstraints.pureBlackSurface === "avoid" && inventory.nearBlackBackgrounds.length > 0, {
    signal: "near-black-surface", severity: "warning",
    message: `The ${profile.label} profile does not use near-black as its default canvas, but ${occurrences(inventory.nearBlackBackgrounds)} near-black background signal(s) were found.`,
    evidence: inventory.nearBlackBackgrounds.flatMap((item) => item.paths),
    remediation: `Confirm that dark surfaces are intentional and local. Otherwise use ${profile.palette.canvas} and ${profile.palette.surface} for the dominant canvas hierarchy.`,
  });
  finding(findings, borderCount > profile.auditConstraints.maximumBorderDeclarations, {
    signal: "border-heavy-surface", severity: "warning",
    message: `${borderCount} border declarations exceed this profile's review threshold of ${profile.auditConstraints.maximumBorderDeclarations}.`,
    evidence: inventory.borderDeclarations.flatMap((item) => item.paths),
    remediation: "Remove decorative container borders; express grouping with spacing, alignment, background contrast, and typography first.",
  });
  finding(findings, cardCount > profile.auditConstraints.maximumCardLikeReferences, {
    signal: "card-grid-saturation", severity: "warning",
    message: `${cardCount} card/panel-like references exceed this profile's review threshold of ${profile.auditConstraints.maximumCardLikeReferences}.`,
    evidence: inventory.cardLikeReferences.flatMap((item) => item.paths),
    remediation: "Keep cards only for truly independent objects; turn structural groups into sections or aligned regions.",
  });
  finding(findings, radiusCount >= 5 && dominantRadiusRatio > profile.auditConstraints.maximumDominantRadiusRatio, {
    signal: "uniform-radius-repetition", severity: "warning",
    message: `${Math.round(dominantRadiusRatio * 100)}% of detected radius usage repeats ${dominantRadius?.value}; the interface may read as mechanically boxed.`,
    evidence: dominantRadius?.paths ?? [],
    remediation: `Use the profile radius scale (${profile.shape.radiusScale.join(", ")}px) by semantic role, and leave structural regions unboxed where possible.`,
  });
  finding(findings, inventory.inspectedFiles.length > 0 && inventory.fontSizes.length < profile.auditConstraints.minimumTypeScaleSteps, {
    signal: "weak-type-hierarchy", severity: "warning",
    message: `Only ${inventory.fontSizes.length} distinct type-size signals were found; this profile expects at least ${profile.auditConstraints.minimumTypeScaleSteps} hierarchy steps.`,
    evidence: inventory.fontSizes.flatMap((item) => item.paths),
    remediation: `Establish a deliberate type scale such as ${profile.typography.scale.join("/")}px and differentiate page, section, body, label, and metadata roles.`,
  });
  finding(findings, profile.auditConstraints.responsiveEvidenceRequired && inventory.inspectedFiles.length > 0 && inventory.responsiveSignals.length === 0, {
    signal: "responsive-evidence-missing", severity: "warning",
    message: "No media query or responsive utility signal was found in the bounded styling sources.",
    evidence: inventory.inspectedFiles,
    remediation: "Define layout changes for narrow, medium, and wide viewports; do not rely only on element wrapping.",
  });
  finding(findings, profile.auditConstraints.gradientPolicy === "avoid" && gradientCount > 0, {
    signal: "profile-gradient-mismatch", severity: "warning",
    message: `${gradientCount} gradient occurrence(s) conflict with this profile's no-gradient direction.`,
    evidence: inventory.gradients.flatMap((item) => item.paths),
    remediation: "Use surface, type, image, or spatial contrast instead of decorative gradients.",
  });
  finding(findings, inventory.colors.length > 10 && inventory.customPropertyReferences.length < 3, {
    signal: "raw-color-sprawl", severity: "warning",
    message: `${inventory.colors.length} distinct color literals were found with little evidence of reusable semantic tokens.`,
    evidence: inventory.colors.flatMap((item) => item.paths),
    remediation: "Consolidate colors into semantic canvas, surface, text, muted, accent, success, warning, and danger tokens.",
  });
  const status = findings.some((item) => item.severity === "error")
    ? "blocked"
    : findings.some((item) => item.severity === "warning") ? "review" : "clean";
  return {
    schemaVersion: 1,
    profileId: profile.id,
    status,
    findings,
    inventory,
    limitations: [
      "This audit catches structural visual anti-patterns; it does not certify beauty, brand fit, or pixel-level composition.",
      "A human should still inspect the rendered page before release when visual quality matters.",
    ],
  };
}
