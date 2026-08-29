/**
 * The visualizations a block may become, and what each one can honestly carry.
 *
 * This slice implements the CONTRACT, not eighteen renderers. Every variant is
 * declared here with the shape of query it needs, the reading it starts to fail
 * at, and — stated plainly, because pretending otherwise would be the easiest
 * way to ship a broken page — whether a renderer exists for it yet.
 *
 * The compatibility rules are data, not `if` statements scattered through the
 * UI, so the same table answers "may this block become a pie?" in the composer,
 * in the server validation and in a gate.
 */

export const CHART_VARIANTS = [
  "kpi",
  "bar_horizontal",
  "bar_vertical",
  "bar_grouped",
  "bar_stacked",
  "bar_stacked_100",
  "line",
  "area",
  "pie",
  "donut",
  "table",
  "heatmap",
  "bubble",
  "treemap",
  "traffic_light",
  "retention_series",
  "journey",
  "theme_cloud",
] as const;

export type ChartVariant = (typeof CHART_VARIANTS)[number];

export type ChartVariantSpec = {
  id: ChartVariant;
  /** What it is called in the composer. Never the token. */
  label: string;
  /** What it is FOR, so the choice is a reading decision, not a taste one. */
  description: string;
  /** How many dimensions the query must supply. */
  dimensions: { min: 0 | 1 | 2; max: 0 | 1 | 2 };
  /**
   * Categories beyond which the reading degrades. Crossing it is a SOFT
   * warning: the CEO is told the pie will be hard to read, and is not stopped.
   */
  comfortableCategories: number | null;
  /**
   * Categories beyond which the chart cannot be drawn honestly at all.
   * Crossing it is a HARD error, because the alternative is a graphic that
   * misrepresents the data rather than one that is merely ugly.
   */
  maximumCategories: number | null;
  /** How it survives a 360 px phone. */
  mobile: "good" | "acceptable" | "poor";
  /**
   * Whether this slice can draw it. False means the contract exists, the
   * composer offers it, and the prototype falls back to the reusable
   * representation named in `fallback`.
   */
  rendererImplemented: boolean;
  /** What the prototype shows instead, while a renderer does not exist. */
  fallback: ChartVariant | null;
};

const SPECS: ChartVariantSpec[] = [
  {
    id: "kpi",
    label: "Número destacado",
    description: "Un solo resultado, en grande, sin desglose.",
    dimensions: { min: 0, max: 0 },
    comfortableCategories: null,
    maximumCategories: null,
    mobile: "good",
    rendererImplemented: true,
    fallback: null,
  },
  {
    id: "bar_horizontal",
    label: "Barras horizontales",
    description: "Comparar categorías con nombres largos.",
    dimensions: { min: 1, max: 1 },
    comfortableCategories: 12,
    maximumCategories: 60,
    mobile: "good",
    rendererImplemented: true,
    fallback: null,
  },
  {
    id: "bar_vertical",
    label: "Barras verticales",
    description: "Comparar pocas categorías con nombres cortos.",
    dimensions: { min: 1, max: 1 },
    comfortableCategories: 8,
    maximumCategories: 40,
    mobile: "acceptable",
    rendererImplemented: false,
    fallback: "bar_horizontal",
  },
  {
    id: "bar_grouped",
    label: "Barras agrupadas",
    description: "Comparar dos características a la vez, lado a lado.",
    dimensions: { min: 2, max: 2 },
    comfortableCategories: 6,
    maximumCategories: 24,
    mobile: "poor",
    rendererImplemented: false,
    fallback: "table",
  },
  {
    id: "bar_stacked",
    label: "Barras apiladas",
    description: "Composición y total en la misma barra.",
    dimensions: { min: 2, max: 2 },
    comfortableCategories: 6,
    maximumCategories: 24,
    mobile: "acceptable",
    rendererImplemented: false,
    fallback: "table",
  },
  {
    id: "bar_stacked_100",
    label: "Barras apiladas al 100 %",
    description: "Reparto interno de cada categoría, sin el total.",
    dimensions: { min: 2, max: 2 },
    comfortableCategories: 6,
    maximumCategories: 24,
    mobile: "acceptable",
    rendererImplemented: false,
    fallback: "table",
  },
  {
    id: "line",
    label: "Línea",
    description: "Cómo cambia un resultado a lo largo del tiempo.",
    dimensions: { min: 1, max: 2 },
    comfortableCategories: 24,
    maximumCategories: 60,
    mobile: "acceptable",
    rendererImplemented: true,
    fallback: null,
  },
  {
    id: "area",
    label: "Área",
    description: "Igual que la línea, cuando importa el volumen acumulado.",
    dimensions: { min: 1, max: 2 },
    comfortableCategories: 24,
    maximumCategories: 60,
    mobile: "acceptable",
    rendererImplemented: false,
    fallback: "line",
  },
  {
    id: "pie",
    label: "Pastel",
    description: "Reparto de un total entre muy pocas partes.",
    dimensions: { min: 1, max: 1 },
    comfortableCategories: 5,
    maximumCategories: 12,
    mobile: "acceptable",
    rendererImplemented: false,
    fallback: "bar_horizontal",
  },
  {
    id: "donut",
    label: "Dona",
    description: "Reparto de un total, con espacio para el número al centro.",
    dimensions: { min: 1, max: 1 },
    comfortableCategories: 5,
    maximumCategories: 12,
    mobile: "acceptable",
    rendererImplemented: false,
    fallback: "bar_horizontal",
  },
  {
    id: "table",
    label: "Tabla",
    description: "Los valores exactos, legibles y ordenables.",
    dimensions: { min: 1, max: 2 },
    comfortableCategories: 60,
    maximumCategories: 60,
    mobile: "acceptable",
    rendererImplemented: true,
    fallback: null,
  },
  {
    id: "heatmap",
    label: "Mapa de calor",
    description: "Dos características cruzadas, con la intensidad como valor.",
    dimensions: { min: 2, max: 2 },
    comfortableCategories: 12,
    maximumCategories: 40,
    mobile: "poor",
    rendererImplemented: false,
    fallback: "table",
  },
  {
    id: "bubble",
    label: "Burbujas",
    description: "Tres cosas a la vez: posición, posición y tamaño.",
    dimensions: { min: 2, max: 2 },
    comfortableCategories: 24,
    maximumCategories: 60,
    mobile: "poor",
    rendererImplemented: false,
    fallback: "table",
  },
  {
    id: "treemap",
    label: "Rectángulos proporcionales",
    description: "Muchas partes de un total, por tamaño.",
    dimensions: { min: 1, max: 1 },
    comfortableCategories: 20,
    maximumCategories: 60,
    mobile: "poor",
    rendererImplemented: false,
    fallback: "bar_horizontal",
  },
  {
    id: "traffic_light",
    label: "Semáforo",
    description: "Verde, amarillo y rojo sobre un umbral acordado.",
    dimensions: { min: 0, max: 1 },
    comfortableCategories: 12,
    maximumCategories: 40,
    mobile: "good",
    rendererImplemented: false,
    fallback: "bar_horizontal",
  },
  {
    id: "retention_series",
    label: "Serie de permanencia",
    description: "Cuánta gente sigue, periodo tras periodo.",
    dimensions: { min: 1, max: 1 },
    comfortableCategories: 24,
    maximumCategories: 60,
    mobile: "acceptable",
    rendererImplemented: true,
    fallback: null,
  },
  {
    id: "journey",
    label: "Recorrido",
    description: "Los momentos en orden, con su resultado en cada uno.",
    dimensions: { min: 0, max: 1 },
    comfortableCategories: 12,
    maximumCategories: 24,
    mobile: "good",
    rendererImplemented: true,
    fallback: null,
  },
  {
    id: "theme_cloud",
    label: "Nube de temas",
    description: "Los temas confirmados, con el tamaño según cuántas veces se dijeron.",
    dimensions: { min: 1, max: 1 },
    comfortableCategories: 30,
    maximumCategories: 60,
    mobile: "acceptable",
    rendererImplemented: true,
    fallback: null,
  },
];

export const CHART_SPECS: Readonly<Record<ChartVariant, ChartVariantSpec>> = Object.freeze(
  Object.fromEntries(SPECS.map((spec) => [spec.id, spec])) as Record<ChartVariant, ChartVariantSpec>,
);

export function chartSpec(variant: ChartVariant): ChartVariantSpec {
  return CHART_SPECS[variant];
}

export function isChartVariant(value: unknown): value is ChartVariant {
  return typeof value === "string" && (CHART_VARIANTS as readonly string[]).includes(value);
}

/**
 * What the prototype actually draws for a variant, following the fallback chain
 * until it reaches something with a renderer. Bounded so a mis-declared table
 * cannot loop.
 */
export function renderableVariant(variant: ChartVariant): ChartVariant {
  let current = variant;
  for (let step = 0; step < CHART_VARIANTS.length; step += 1) {
    const spec = CHART_SPECS[current];
    if (spec.rendererImplemented || !spec.fallback) return current;
    current = spec.fallback;
  }
  return "table";
}

/**
 * The variants a result may become, given what the registry says about it and
 * how many dimensions the block's query supplies.
 *
 * Intersection of three things, all of them data: what the metric declares,
 * what the variant needs, and what the query has.
 */
export function compatibleVariants(
  metricCharts: readonly string[],
  dimensionCount: 0 | 1 | 2,
): ChartVariant[] {
  return CHART_VARIANTS.filter((variant) => {
    if (!metricCharts.includes(variant)) return false;
    const spec = CHART_SPECS[variant];
    return dimensionCount >= spec.dimensions.min && dimensionCount <= spec.dimensions.max;
  });
}
