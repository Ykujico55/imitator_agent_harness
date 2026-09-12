import type { VisualArchetypeId, VisualTaskInput, VisualTaskRoute, VisualTaskSignal } from "./visual-types.ts";

export const VISUAL_ROUTE_THRESHOLD = 50;

const signalPatterns: Array<{
  name: VisualTaskSignal["name"];
  points: number;
  pattern: RegExp;
}> = [
  {
    name: "explicit-visual-language",
    points: 50,
    pattern: /\b(ui|ux|visual|aesthetic|styling|style|layout|responsive|design system|visual hierarchy)\b|界面|视觉|审美|美观|样式|布局|响应式|设计系统|视觉层级/giu,
  },
  {
    name: "user-facing-surface",
    points: 30,
    pattern: /\b(page|website|landing|homepage|dashboard|admin console|portal|storefront|catalog|checkout|documentation site|app shell)\b|页面|网站|落地页|首页|看板|仪表盘|后台|控制台|门户|商城|商店|结账页|文档站/giu,
  },
  {
    name: "frontend-stack",
    points: 20,
    pattern: /\b(front[ -]?end|react|next\.?js|vue|nuxt|svelte|solid|astro|html|css|scss|tailwind|shadcn)\b|前端/giu,
  },
  {
    name: "visual-quality-requirement",
    points: 20,
    pattern: /\b(polished|beautiful|premium|distinctive|elegant|refined|brand|not ai|production[- ]ready ui)\b|精致|好看|漂亮|高级感|品牌感|不要.*ai味|去.*ai味/giu,
  },
];

const archetypePatterns: Array<{ id: VisualArchetypeId; reason: string; pattern: RegExp }> = [
  { id: "expressive-marketing", reason: "marketing or launch surface", pattern: /\b(landing|homepage|marketing|launch|hero|pricing)\b|官网|落地页|营销|发布页|首页/iu },
  { id: "data-console", reason: "data-dense operational surface", pattern: /\b(dashboard|admin|analytics|metrics|operations|data table|console)\b|看板|仪表盘|后台|数据台|运营台|控制台/iu },
  { id: "editorial-docs", reason: "long-form documentation or knowledge surface", pattern: /\b(documentation|docs site|knowledge base|reference portal|long[- ]form)\b|文档站|知识库|参考手册|长文/iu },
  { id: "productivity-editor", reason: "focused editor or productivity workspace", pattern: /\b(editor|workspace|notebook|ide|productivity|developer tool)\b|编辑器|工作台|笔记|生产力工具|开发者工具/iu },
  { id: "commerce-catalog", reason: "commerce, catalog, or purchase surface", pattern: /\b(e-?commerce|storefront|catalog|product detail|checkout|shopping)\b|电商|商城|商品|目录|结账|购物/iu },
];

function matches(pattern: RegExp, text: string): string[] {
  pattern.lastIndex = 0;
  return [...new Set([...text.matchAll(pattern)].map((match) => match[0].trim().toLowerCase()).filter(Boolean))].sort();
}

export function routeVisualTask(input: VisualTaskInput): VisualTaskRoute {
  const text = [input.task, input.purpose, ...input.capabilities, input.language, input.ecosystem, ...(input.mustHave ?? [])]
    .filter((item): item is string => Boolean(item))
    .join(" ");
  const signals = signalPatterns.flatMap((signal): VisualTaskSignal[] => {
    const found = matches(signal.pattern, text);
    return found.length ? [{ name: signal.name, points: signal.points, matches: found }] : [];
  });
  const score = Math.min(100, signals.reduce((sum, signal) => sum + signal.points, 0));
  const hasVisualIntent = signals.some((signal) => signal.name === "explicit-visual-language")
    || (signals.some((signal) => signal.name === "user-facing-surface")
      && signals.some((signal) => signal.name === "frontend-stack" || signal.name === "visual-quality-requirement"));
  if (!hasVisualIntent || score < VISUAL_ROUTE_THRESHOLD) {
    return {
      route: "software-precedent",
      score,
      threshold: VISUAL_ROUTE_THRESHOLD,
      signals,
      reason: hasVisualIntent
        ? `visual route score ${score} < ${VISUAL_ROUTE_THRESHOLD}`
        : "no explicit visual intent or frontend-backed user-facing surface",
    };
  }
  const selected = archetypePatterns.find((item) => item.pattern.test(text));
  return {
    route: "visual-style",
    score,
    threshold: VISUAL_ROUTE_THRESHOLD,
    signals,
    reason: `visual route score ${score} >= ${VISUAL_ROUTE_THRESHOLD}`,
    archetypeId: selected?.id ?? "calm-product",
    archetypeReason: selected?.reason ?? "general user-facing product surface",
  };
}
