/**
 * The visualizations a block may become, and what each one can honestly carry.
 *
 * The compatibility rules are data, not `if` statements scattered through the
 * UI, so the same table answers "may this block become a pie?" in the composer,
 * in the server validation and in a gate.
 *
 * WHAT CHANGED WHEN THE RENDERERS ARRIVED, AND WHY IT MATTERS MORE THAN THE
 * PICTURES.
 *
 * The foundation slice declared a `fallback` and drew it INSTEAD of the variant
 * that had no renderer. A traffic light appeared as horizontal bars, which is
 * not a traffic light: green, amber and red against an agreed range is a
 * different statement from "this bar is longer than that one", and quietly
 * swapping one for the other is how a consultant publishes a page they did not
 * choose. Fifteen of the eighteen variants now have their own renderer. The
 * three that do not — heat map, bubbles, proportional rectangles — say so, by
 * name, in the catalogue and on the canvas, and offer the reference
 * representation BESIDE that statement rather than in place of it.
 *
 * `alternative` is therefore not a substitution. It is the representation a
 * person can read while the real one does not exist, always shown under a
 * sentence that says which drawing is missing.
 */

import type { Aggregation } from "./registry";

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

/**
 * THE PALETTES A SCALED DRAWING MAY READ, as roles rather than hex.
 *
 * A heat map, a treemap and a bubble field all need a colour SCALE rather than
 * a colour, and the moment an operator can type one the product acquires a
 * contrast failure nobody will find until it is on a client's screen. So the
 * choice is a closed set the brand resolves, `auto` lets the block type pick
 * the one that suits it, and `mono` exists because a single-hue ramp is the
 * honest choice for a quantity — a rainbow implies categories where there are
 * degrees.
 */
export const CHART_PALETTES = ["auto", "mono", "cool", "warm", "diverging", "categorical"] as const;
export type ChartPalette = (typeof CHART_PALETTES)[number];

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
   * Whether a renderer for this exact drawing exists. False means the composer
   * still offers the choice — the model can express it and a later slice will
   * draw it — but every surface says the drawing is missing, by name, and
   * nothing pretends the `alternative` below is the same picture.
   */
  rendererImplemented: boolean;
  /**
   * The readable representation offered ALONGSIDE the "not drawn yet" notice.
   * Never a silent replacement. Null when the variant is drawn for real.
   */
  alternative: ChartVariant | null;
  /**
   * THE AGGREGATIONS THIS DRAWING CAN TELL THE TRUTH ABOUT, or null for any.
   *
   * A drawing that divides a whole — a pie, a treemap — asserts that its parts
   * sum to the total. A promedio, an NPS and a Top-2-Box do not sum to
   * anything, so a treemap of averages is a picture of a claim nobody made.
   * The validator reads this rather than carrying its own list, which is what
   * stops the two from drifting.
   */
  aggregations: readonly Aggregation[] | null;
  /**
   * Whether the drawing needs a COLOUR SCALE rather than a colour. It is what
   * makes the palette control appear on exactly the blocks it means something
   * for, instead of on all of them.
   */
  usesPalette: boolean;
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
    aggregations: null,
    usesPalette: false,
    alternative: null,
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
    aggregations: null,
    usesPalette: false,
    alternative: null,
  },
  {
    id: "bar_vertical",
    label: "Barras verticales",
    description: "Comparar pocas categorías con nombres cortos.",
    dimensions: { min: 1, max: 1 },
    comfortableCategories: 8,
    maximumCategories: 40,
    mobile: "acceptable",
    rendererImplemented: true,
    aggregations: null,
    usesPalette: false,
    alternative: null,
  },
  {
    id: "bar_grouped",
    label: "Barras agrupadas",
    description: "Comparar dos características a la vez, lado a lado.",
    dimensions: { min: 2, max: 2 },
    comfortableCategories: 6,
    maximumCategories: 24,
    mobile: "poor",
    rendererImplemented: true,
    aggregations: null,
    usesPalette: false,
    alternative: null,
  },
  {
    id: "bar_stacked",
    label: "Barras apiladas",
    description: "Composición y total en la misma barra.",
    dimensions: { min: 2, max: 2 },
    comfortableCategories: 6,
    maximumCategories: 24,
    mobile: "acceptable",
    rendererImplemented: true,
    aggregations: null,
    usesPalette: false,
    alternative: null,
  },
  {
    id: "bar_stacked_100",
    label: "Barras apiladas al 100 %",
    description: "Reparto interno de cada categoría, sin el total.",
    dimensions: { min: 2, max: 2 },
    comfortableCategories: 6,
    maximumCategories: 24,
    mobile: "acceptable",
    rendererImplemented: true,
    aggregations: null,
    usesPalette: false,
    alternative: null,
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
    aggregations: null,
    usesPalette: false,
    alternative: null,
  },
  {
    id: "area",
    label: "Área",
    description: "Igual que la línea, cuando importa el volumen acumulado.",
    dimensions: { min: 1, max: 2 },
    comfortableCategories: 24,
    maximumCategories: 60,
    mobile: "acceptable",
    rendererImplemented: true,
    aggregations: null,
    usesPalette: false,
    alternative: null,
  },
  {
    id: "pie",
    label: "Pastel",
    description: "Reparto de un total entre muy pocas partes.",
    dimensions: { min: 1, max: 1 },
    comfortableCategories: 5,
    maximumCategories: 12,
    mobile: "acceptable",
    rendererImplemented: true,
    // ITS SLICES ASSERT THEY SUM TO THE TOTAL. A promedio, an NPS and a
    // Top-2-Box by characteristic sum to nothing, so three slices reading
    // 8.4, 7.9 and 9.1 make a picture whose angles mean nothing at all.
    aggregations: ["count", "sum", "share"],
    usesPalette: false,
    alternative: null,
  },
  {
    id: "donut",
    label: "Dona",
    description: "Reparto de un total, con espacio para el número al centro.",
    dimensions: { min: 1, max: 1 },
    comfortableCategories: 5,
    maximumCategories: 12,
    mobile: "acceptable",
    rendererImplemented: true,
    // ITS SLICES ASSERT THEY SUM TO THE TOTAL. A promedio, an NPS and a
    // Top-2-Box by characteristic sum to nothing, so three slices reading
    // 8.4, 7.9 and 9.1 make a picture whose angles mean nothing at all.
    aggregations: ["count", "sum", "share"],
    usesPalette: false,
    alternative: null,
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
    aggregations: null,
    usesPalette: false,
    alternative: null,
  },
  {
    id: "heatmap",
    label: "Mapa de calor",
    description: "Dos características cruzadas, con la intensidad como valor.",
    // TWO characteristics, exactly. A heat map with one axis is a bar chart
    // drawn badly, and with none there is no grid at all.
    dimensions: { min: 2, max: 2 },
    comfortableCategories: 12,
    maximumCategories: 40,
    mobile: "poor",
    rendererImplemented: true,
    // Any aggregation: a cell is one number about one crossing and makes no
    // claim about summing to anything.
    aggregations: null,
    usesPalette: true,
    alternative: null,
  },
  {
    id: "bubble",
    label: "Burbujas",
    description: "Dos características cruzadas, con el tamaño como valor.",
    dimensions: { min: 2, max: 2 },
    comfortableCategories: 24,
    maximumCategories: 60,
    mobile: "poor",
    rendererImplemented: true,
    // A RADIUS CANNOT BE NEGATIVE, and an area of zero is a value that
    // vanishes. So it draws magnitudes: counts, sums, shares, a Top-2-Box. An
    // NPS runs from -100 and a promedio has no zero point, and neither of
    // those has an area.
    aggregations: ["count", "sum", "share", "top_box"],
    usesPalette: true,
    alternative: null,
  },
  {
    id: "treemap",
    label: "Rectángulos proporcionales",
    description: "Muchas partes de un total, por tamaño.",
    dimensions: { min: 1, max: 1 },
    comfortableCategories: 20,
    maximumCategories: 60,
    mobile: "poor",
    rendererImplemented: true,
    // A RECTANGLE'S AREA IS ITS SHARE OF THE WHOLE. That is the entire claim
    // the drawing makes, so it accepts only the aggregations whose parts
    // genuinely add up — the same rule the pastel and the dona live under.
    aggregations: ["count", "sum", "share"],
    usesPalette: true,
    alternative: null,
  },
  {
    id: "traffic_light",
    label: "Semáforo",
    description: "Verde, amarillo y rojo sobre un rango acordado.",
    dimensions: { min: 0, max: 1 },
    comfortableCategories: 12,
    maximumCategories: 40,
    mobile: "good",
    rendererImplemented: true,
    aggregations: null,
    usesPalette: false,
    alternative: null,
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
    aggregations: null,
    usesPalette: false,
    alternative: null,
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
    aggregations: null,
    usesPalette: false,
    alternative: null,
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
    aggregations: null,
    usesPalette: false,
    alternative: null,
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

/** Whether this exact drawing exists. The one question every renderer asks. */
export function isRendererImplemented(variant: ChartVariant): boolean {
  return CHART_SPECS[variant].rendererImplemented;
}

/**
 * The representation shown beside the "not drawn yet" notice, following the
 * declared chain until it reaches something that is genuinely drawn. Bounded so
 * a mis-declared pair cannot loop. Null when the variant itself is drawn.
 */
export function alternativeVariant(variant: ChartVariant): ChartVariant | null {
  if (CHART_SPECS[variant].rendererImplemented) return null;
  let current = CHART_SPECS[variant].alternative;
  for (let step = 0; step < CHART_VARIANTS.length && current; step += 1) {
    const spec = CHART_SPECS[current];
    if (spec.rendererImplemented) return current;
    current = spec.alternative;
  }
  return "table";
}

/** Every variant this build can actually draw. */
export function implementedVariants(): ChartVariant[] {
  return CHART_VARIANTS.filter((variant) => CHART_SPECS[variant].rendererImplemented);
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
