import type { VisualArchetypeId, VisualStyleProfile } from "./visual-types.ts";

const profiles: Record<VisualArchetypeId, VisualStyleProfile> = {
  "calm-product": {
    schemaVersion: 1,
    id: "calm-product",
    label: "Calm product interface",
    provenance: "bundled-curated-seed",
    suitableFor: ["general web application", "account area", "small SaaS product"],
    palette: {
      canvas: "warm off-white (#f6f5f1)", surface: "paper white (#fffefa)", text: "soft ink (#20231f)",
      mutedText: "olive gray (#687069)", accent: "restrained indigo (#4f5d95)", supportingAccent: "muted coral (#c96f55)", danger: "earth red (#b34d45)",
    },
    typography: { direction: "quiet sans-serif with an expressive but restrained display face", display: "humanist or editorial display", body: "neutral humanist sans", scale: [13, 15, 18, 24, 34, 48], bodyLineHeight: 1.6 },
    layout: { direction: "one dominant canvas; hierarchy through width and whitespace before containers", contentMaxWidth: 1180, density: "comfortable", sectionRhythm: "24/40/64px progression" },
    shape: { radiusScale: [4, 10, 18], elevationLevels: 2, borderDirection: "hairlines only for real boundaries; avoid a border around every group" },
    motion: { durationMs: [120, 180, 260], direction: "small opacity and transform changes; no decorative looping motion" },
    auditConstraints: { pureBlackSurface: "avoid", maximumBorderDeclarations: 10, maximumCardLikeReferences: 12, minimumTypeScaleSteps: 4, maximumDominantRadiusRatio: 0.75, responsiveEvidenceRequired: true, gradientPolicy: "restrained" },
    principles: ["Create hierarchy with type, spacing and alignment before adding boxes.", "Keep one dominant surface and no more than two elevation levels.", "Use accent color for decisions and state, not decoration."],
    avoid: ["pure-black dashboard canvas", "uniform rounded rectangles", "nested card grids", "cyan-purple default gradient", "muted gray text everywhere"],
  },
  "data-console": {
    schemaVersion: 1,
    id: "data-console",
    label: "Readable data console",
    provenance: "bundled-curated-seed",
    suitableFor: ["dashboard", "admin console", "analytics", "operations UI"],
    palette: {
      canvas: "cool mist (#f3f6f7)", surface: "white (#ffffff)", text: "blue ink (#17232e)",
      mutedText: "slate (#66737f)", accent: "deep teal (#167d78)", supportingAccent: "amber (#c88725)", danger: "clear red (#bd3d45)",
    },
    typography: { direction: "tabular clarity with a visibly stronger page and section hierarchy", display: "compact grotesk", body: "high-legibility sans with tabular numerals", scale: [12, 14, 16, 20, 28, 38], bodyLineHeight: 1.5 },
    layout: { direction: "persistent navigation plus one primary work surface; group by alignment before cards", contentMaxWidth: 1440, density: "compact", sectionRhythm: "16/24/40px progression" },
    shape: { radiusScale: [3, 7, 12], elevationLevels: 2, borderDirection: "borders may separate dense rows; panels still need breathing room" },
    motion: { durationMs: [100, 160, 220], direction: "fast state acknowledgement; avoid moving data while it is being read" },
    auditConstraints: { pureBlackSurface: "avoid", maximumBorderDeclarations: 18, maximumCardLikeReferences: 18, minimumTypeScaleSteps: 4, maximumDominantRadiusRatio: 0.8, responsiveEvidenceRequired: true, gradientPolicy: "avoid" },
    principles: ["Make the primary question answerable before exposing secondary metrics.", "Use density inside tables, not across the entire page.", "Reserve color for semantic state and selection."],
    avoid: ["a separate card for every metric", "all-black operations dashboard", "decorative glow", "low-contrast tiny labels", "identical prominence for primary and secondary data"],
  },
  "editorial-docs": {
    schemaVersion: 1,
    id: "editorial-docs",
    label: "Editorial documentation",
    provenance: "bundled-curated-seed",
    suitableFor: ["documentation", "knowledge base", "long-form reading", "reference portal"],
    palette: {
      canvas: "paper (#faf8f2)", surface: "warm white (#fffdf8)", text: "charcoal (#24221f)",
      mutedText: "warm gray (#746f67)", accent: "book blue (#315f86)", supportingAccent: "ochre (#b97931)", danger: "brick (#a84d42)",
    },
    typography: { direction: "editorial hierarchy and comfortable long-form measure", display: "serif or distinctive display face", body: "high-legibility serif or humanist sans", scale: [13, 16, 20, 27, 38, 54], bodyLineHeight: 1.72 },
    layout: { direction: "stable navigation with a narrow reading column and generous margins", contentMaxWidth: 1120, density: "spacious", sectionRhythm: "28/48/80px progression" },
    shape: { radiusScale: [2, 6, 10], elevationLevels: 1, borderDirection: "rules mark document structure; cards are exceptional" },
    motion: { durationMs: [120, 200], direction: "nearly static; motion only confirms navigation or disclosure" },
    auditConstraints: { pureBlackSurface: "avoid", maximumBorderDeclarations: 8, maximumCardLikeReferences: 8, minimumTypeScaleSteps: 5, maximumDominantRadiusRatio: 0.7, responsiveEvidenceRequired: true, gradientPolicy: "avoid" },
    principles: ["Optimize line length and rhythm before decoration.", "Let headings, rules and whitespace express document structure.", "Keep navigation quieter than the reading surface."],
    avoid: ["documentation made entirely of cards", "tiny low-contrast body copy", "black code-block styling applied to the whole page", "oversized sticky chrome", "decorative gradients"],
  },
  "expressive-marketing": {
    schemaVersion: 1,
    id: "expressive-marketing",
    label: "Expressive marketing page",
    provenance: "bundled-curated-seed",
    suitableFor: ["landing page", "homepage", "launch page", "product marketing"],
    palette: {
      canvas: "soft cream (#f8f3e8)", surface: "light paper (#fffaf0)", text: "near-black brown (#241d18)",
      mutedText: "taupe (#756b62)", accent: "cobalt (#3156d3)", supportingAccent: "tangerine (#e7773d)", danger: "vermilion (#c7493f)",
    },
    typography: { direction: "distinctive display voice paired with quiet readable body text", display: "characterful display face", body: "plain modern sans", scale: [14, 17, 22, 32, 52, 76], bodyLineHeight: 1.55 },
    layout: { direction: "strong opening composition, alternating rhythm and one clear action per section", contentMaxWidth: 1240, density: "spacious", sectionRhythm: "32/64/104px progression" },
    shape: { radiusScale: [2, 12, 28], elevationLevels: 2, borderDirection: "use silhouette, crop and contrast before adding card borders" },
    motion: { durationMs: [160, 260, 420], direction: "one purposeful entrance language; respect reduced motion" },
    auditConstraints: { pureBlackSurface: "avoid", maximumBorderDeclarations: 8, maximumCardLikeReferences: 10, minimumTypeScaleSteps: 5, maximumDominantRadiusRatio: 0.7, responsiveEvidenceRequired: true, gradientPolicy: "restrained" },
    principles: ["Give the page one memorable visual idea rather than many effects.", "Alternate scale and whitespace to create narrative rhythm.", "Keep calls to action visually decisive and scarce."],
    avoid: ["generic centered hero plus three cards", "cyan-purple gradient as the only visual idea", "feature grids with identical weight", "black glassmorphism boxes", "motion without narrative purpose"],
  },
  "productivity-editor": {
    schemaVersion: 1,
    id: "productivity-editor",
    label: "Focused productivity workspace",
    provenance: "bundled-curated-seed",
    suitableFor: ["editor", "workspace", "notebook", "developer tool", "productivity app"],
    palette: {
      canvas: "soft stone (#f1f0ec)", surface: "focused white (#fbfbf8)", text: "graphite (#232626)",
      mutedText: "neutral gray (#6a706f)", accent: "forest (#39705f)", supportingAccent: "muted violet (#716591)", danger: "brick red (#ad4d47)",
    },
    typography: { direction: "quiet UI chrome around a highly legible work surface", display: "restrained sans", body: "neutral sans; monospace only for code or data", scale: [12, 14, 16, 21, 29, 40], bodyLineHeight: 1.55 },
    layout: { direction: "clear navigation/work/inspector regions; the work surface owns visual priority", contentMaxWidth: 1600, density: "comfortable", sectionRhythm: "12/20/32px progression" },
    shape: { radiusScale: [3, 7, 14], elevationLevels: 2, borderDirection: "region dividers are quieter than interactive controls" },
    motion: { durationMs: [90, 150, 220], direction: "fast and local; never animate the user's primary content unexpectedly" },
    auditConstraints: { pureBlackSurface: "avoid", maximumBorderDeclarations: 14, maximumCardLikeReferences: 12, minimumTypeScaleSteps: 4, maximumDominantRadiusRatio: 0.78, responsiveEvidenceRequired: true, gradientPolicy: "avoid" },
    principles: ["The work surface must dominate the surrounding chrome.", "Use regions and alignment rather than a grid of cards.", "Keep repeated controls compact and states unmistakable."],
    avoid: ["dashboard card grid for an editor", "pure-black canvas with bright outlines", "floating panels without hierarchy", "excessive pills", "monospace used as a decorative default"],
  },
  "commerce-catalog": {
    schemaVersion: 1,
    id: "commerce-catalog",
    label: "Confident commerce catalog",
    provenance: "bundled-curated-seed",
    suitableFor: ["catalog", "storefront", "product detail", "checkout"],
    palette: {
      canvas: "warm white (#f7f6f2)", surface: "clean white (#ffffff)", text: "deep charcoal (#211f1d)",
      mutedText: "stone (#716d67)", accent: "confident green (#28735a)", supportingAccent: "clay (#c46f45)", danger: "clear red (#b94343)",
    },
    typography: { direction: "product-first hierarchy with clear price and action typography", display: "editorial product display", body: "neutral commerce sans", scale: [12, 15, 18, 25, 36, 52], bodyLineHeight: 1.55 },
    layout: { direction: "imagery and product information share a grid; buying actions remain stable", contentMaxWidth: 1320, density: "comfortable", sectionRhythm: "20/36/64px progression" },
    shape: { radiusScale: [2, 8, 16], elevationLevels: 2, borderDirection: "use borders for selectable variants and checkout boundaries, not every product" },
    motion: { durationMs: [120, 190, 300], direction: "confirm selection and cart changes without delaying purchase" },
    auditConstraints: { pureBlackSurface: "avoid", maximumBorderDeclarations: 12, maximumCardLikeReferences: 14, minimumTypeScaleSteps: 4, maximumDominantRadiusRatio: 0.75, responsiveEvidenceRequired: true, gradientPolicy: "avoid" },
    principles: ["Product, price and action form the primary hierarchy.", "Use consistent image ratios without turning every item into a heavy card.", "Make selection, stock and validation states explicit."],
    avoid: ["dark generic SaaS styling", "card borders around every product", "hidden purchase state", "decorative gradients behind product imagery", "secondary metadata competing with price and action"],
  },
};

export function getVisualStyleProfile(id: VisualArchetypeId): VisualStyleProfile {
  return structuredClone(profiles[id]);
}

export function listVisualStyleProfiles(): VisualStyleProfile[] {
  return (Object.keys(profiles) as VisualArchetypeId[]).sort().map(getVisualStyleProfile);
}
