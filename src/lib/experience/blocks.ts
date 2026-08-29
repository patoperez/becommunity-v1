/**
 * The block catalogue — every kind of thing that can sit on a composed page,
 * and what each kind is allowed to carry.
 *
 * This is a REGISTRY, not a switch statement. The composer builds its "add a
 * block" menu from it, the schema enforces the per-type requirements from it,
 * the validator reads its ceilings from it, and a gate asserts against it. One
 * table, four consumers, no chance of them disagreeing about whether a divider
 * may carry a query.
 *
 * The types split into four jobs, and the split is what keeps a composed page
 * from becoming a wall of charts:
 *
 *   structure  cover, section, divider, spacer      — where the reader is
 *   evidence   metric, chart, comparison, retention,
 *              journey, qualitative_themes,
 *              theme_cloud, all_results_disclosure  — what the data says
 *   narrative  rich_text, finding, interpretation   — what it means
 *   action     recommendation, report_download      — what to do about it
 */

import type { ChartVariant } from "./charts";

export const BLOCK_TYPES = [
  "cover",
  "section",
  "rich_text",
  "finding",
  "metric",
  "chart",
  "comparison",
  "retention",
  "journey",
  "qualitative_themes",
  "theme_cloud",
  "interpretation",
  "recommendation",
  "image",
  "divider",
  "spacer",
  "report_download",
  "all_results_disclosure",
] as const;

export type BlockType = (typeof BLOCK_TYPES)[number];

export const BLOCK_GROUPS = ["structure", "evidence", "narrative", "action"] as const;
export type BlockGroup = (typeof BLOCK_GROUPS)[number];

export type BlockSpec = {
  id: BlockType;
  label: string;
  description: string;
  group: BlockGroup;
  /** A block that must carry a query is one that draws a number. */
  requiresQuery: boolean;
  /** Whether a query is permitted at all. */
  allowsQuery: boolean;
  /** Whether it chooses a visualization. */
  allowsVisualization: boolean;
  /** The visualizations it may choose, when it may choose at all. */
  variants: readonly ChartVariant[];
  /** The one it starts as. */
  defaultVariant: ChartVariant | null;
  /** Whether a filter may be connected to it. */
  allowsFilters: boolean;
  /** Whether it may state its own disclosure behaviour. */
  allowsSamplePolicyOverride: boolean;
  /** Whether it carries authored prose, and how much. */
  copy: "none" | "title_only" | "short" | "long";
  /** Whether it points at a journey. */
  requiresJourney: boolean;
  /**
   * Narrowest, widest, and what it starts as on the twelve-column grid.
   * The default is a reading decision per block type, not an average of the
   * bounds: a result tile wants a third of a row, a comparison wants all of it.
   */
  span: { min: number; max: number; default: number };
  /**
   * Whether it may appear in a client-facing page at all. Everything here can;
   * the field exists so an internal-only block type can be added later without
   * a second mechanism.
   */
  clientFacing: boolean;
};

const CHART_ALL: readonly ChartVariant[] = [
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
];

const SPECS: BlockSpec[] = [
  {
    id: "cover",
    label: "Portada",
    description: "Cómo abre el estudio: nombre, periodo y una frase.",
    group: "structure",
    requiresQuery: false,
    allowsQuery: false,
    allowsVisualization: false,
    variants: [],
    defaultVariant: null,
    allowsFilters: false,
    allowsSamplePolicyOverride: false,
    copy: "short",
    requiresJourney: false,
    span: { min: 12, max: 12, default: 12 },
    clientFacing: true,
  },
  {
    id: "section",
    label: "Sección",
    description: "Un encabezado que separa una parte de la lectura de la siguiente.",
    group: "structure",
    requiresQuery: false,
    allowsQuery: false,
    allowsVisualization: false,
    variants: [],
    defaultVariant: null,
    allowsFilters: false,
    allowsSamplePolicyOverride: false,
    copy: "short",
    requiresJourney: false,
    span: { min: 6, max: 12, default: 12 },
    clientFacing: true,
  },
  {
    id: "rich_text",
    label: "Texto",
    description: "Párrafos escritos por el equipo. Sin formato oculto ni código.",
    group: "narrative",
    requiresQuery: false,
    allowsQuery: false,
    allowsVisualization: false,
    variants: [],
    defaultVariant: null,
    allowsFilters: false,
    allowsSamplePolicyOverride: false,
    copy: "long",
    requiresJourney: false,
    span: { min: 4, max: 12, default: 8 },
    clientFacing: true,
  },
  {
    id: "finding",
    label: "Hallazgo",
    description: "Una afirmación breve, con el resultado que la sostiene al lado.",
    group: "narrative",
    requiresQuery: false,
    allowsQuery: true,
    allowsVisualization: false,
    variants: [],
    defaultVariant: null,
    allowsFilters: true,
    allowsSamplePolicyOverride: true,
    copy: "short",
    requiresJourney: false,
    span: { min: 4, max: 12, default: 6 },
    clientFacing: true,
  },
  {
    id: "metric",
    label: "Resultado",
    description: "Un número, con su nombre y su base.",
    group: "evidence",
    requiresQuery: true,
    allowsQuery: true,
    allowsVisualization: true,
    variants: ["kpi", "traffic_light"],
    defaultVariant: "kpi",
    allowsFilters: true,
    allowsSamplePolicyOverride: true,
    copy: "title_only",
    requiresJourney: false,
    span: { min: 3, max: 12, default: 3 },
    clientFacing: true,
  },
  {
    id: "chart",
    label: "Gráfica",
    description: "Un resultado desglosado por una o dos características.",
    group: "evidence",
    requiresQuery: true,
    allowsQuery: true,
    allowsVisualization: true,
    variants: CHART_ALL,
    defaultVariant: "bar_horizontal",
    allowsFilters: true,
    allowsSamplePolicyOverride: true,
    copy: "title_only",
    requiresJourney: false,
    span: { min: 4, max: 12, default: 6 },
    clientFacing: true,
  },
  {
    id: "comparison",
    label: "Comparación",
    description: "El mismo resultado en dos grupos, uno junto al otro.",
    group: "evidence",
    requiresQuery: true,
    allowsQuery: true,
    allowsVisualization: true,
    variants: ["bar_horizontal", "bar_grouped", "table", "heatmap"],
    defaultVariant: "bar_horizontal",
    allowsFilters: true,
    allowsSamplePolicyOverride: true,
    copy: "title_only",
    requiresJourney: false,
    span: { min: 6, max: 12, default: 12 },
    clientFacing: true,
  },
  {
    id: "retention",
    label: "Permanencia",
    description: "Cuánta gente sigue, periodo tras periodo.",
    group: "evidence",
    requiresQuery: true,
    allowsQuery: true,
    allowsVisualization: true,
    variants: ["retention_series", "line", "table"],
    defaultVariant: "retention_series",
    allowsFilters: true,
    allowsSamplePolicyOverride: true,
    copy: "title_only",
    requiresJourney: false,
    span: { min: 6, max: 12, default: 12 },
    clientFacing: true,
  },
  {
    id: "journey",
    label: "Recorrido",
    description: "Los momentos de una experiencia, en orden, con su resultado.",
    group: "evidence",
    requiresQuery: false,
    allowsQuery: false,
    allowsVisualization: true,
    variants: ["journey"],
    defaultVariant: "journey",
    allowsFilters: true,
    allowsSamplePolicyOverride: true,
    copy: "title_only",
    requiresJourney: true,
    span: { min: 8, max: 12, default: 12 },
    clientFacing: true,
  },
  {
    id: "qualitative_themes",
    label: "Lo que dijeron",
    description: "Temas confirmados y las frases aprobadas que los sostienen.",
    group: "evidence",
    requiresQuery: false,
    allowsQuery: false,
    allowsVisualization: true,
    variants: ["bar_horizontal", "table"],
    defaultVariant: "bar_horizontal",
    allowsFilters: true,
    allowsSamplePolicyOverride: true,
    copy: "title_only",
    requiresJourney: false,
    span: { min: 6, max: 12, default: 8 },
    clientFacing: true,
  },
  {
    id: "theme_cloud",
    label: "Nube de temas",
    description: "Los mismos temas confirmados, vistos de un golpe.",
    group: "evidence",
    requiresQuery: false,
    allowsQuery: false,
    allowsVisualization: true,
    variants: ["theme_cloud", "bubble", "bar_horizontal", "table"],
    defaultVariant: "theme_cloud",
    allowsFilters: true,
    allowsSamplePolicyOverride: true,
    copy: "title_only",
    requiresJourney: false,
    span: { min: 6, max: 12, default: 6 },
    clientFacing: true,
  },
  {
    id: "interpretation",
    label: "Lectura del equipo",
    description: "La interpretación aprobada. Nunca se redacta desde aquí.",
    group: "narrative",
    requiresQuery: false,
    allowsQuery: false,
    allowsVisualization: false,
    variants: [],
    defaultVariant: null,
    allowsFilters: false,
    allowsSamplePolicyOverride: false,
    copy: "title_only",
    requiresJourney: false,
    span: { min: 6, max: 12, default: 8 },
    clientFacing: true,
  },
  {
    id: "recommendation",
    label: "Recomendación",
    description: "Qué hacer con lo anterior, en una frase accionable.",
    group: "action",
    requiresQuery: false,
    allowsQuery: false,
    allowsVisualization: false,
    variants: [],
    defaultVariant: null,
    allowsFilters: false,
    allowsSamplePolicyOverride: false,
    copy: "long",
    requiresJourney: false,
    span: { min: 4, max: 12, default: 6 },
    clientFacing: true,
  },
  {
    id: "image",
    label: "Imagen",
    description: "Una imagen ya cargada para este cliente, con su texto alternativo.",
    group: "structure",
    requiresQuery: false,
    allowsQuery: false,
    allowsVisualization: false,
    variants: [],
    defaultVariant: null,
    allowsFilters: false,
    allowsSamplePolicyOverride: false,
    copy: "short",
    requiresJourney: false,
    span: { min: 3, max: 12, default: 6 },
    clientFacing: true,
  },
  {
    id: "divider",
    label: "Separador",
    description: "Una línea. Nada más.",
    group: "structure",
    requiresQuery: false,
    allowsQuery: false,
    allowsVisualization: false,
    variants: [],
    defaultVariant: null,
    allowsFilters: false,
    allowsSamplePolicyOverride: false,
    copy: "none",
    requiresJourney: false,
    span: { min: 12, max: 12, default: 12 },
    clientFacing: true,
  },
  {
    id: "spacer",
    label: "Espacio",
    description: "Aire entre dos cosas que no deben leerse juntas.",
    group: "structure",
    requiresQuery: false,
    allowsQuery: false,
    allowsVisualization: false,
    variants: [],
    defaultVariant: null,
    allowsFilters: false,
    allowsSamplePolicyOverride: false,
    copy: "none",
    requiresJourney: false,
    span: { min: 1, max: 12, default: 12 },
    clientFacing: true,
  },
  {
    id: "report_download",
    label: "Descargar el informe",
    description: "El PDF del estudio, con los filtros que el lector tenga puestos.",
    group: "action",
    requiresQuery: false,
    allowsQuery: false,
    allowsVisualization: false,
    variants: [],
    defaultVariant: null,
    allowsFilters: true,
    allowsSamplePolicyOverride: false,
    copy: "short",
    requiresJourney: false,
    span: { min: 4, max: 12, default: 6 },
    clientFacing: true,
  },
  {
    id: "all_results_disclosure",
    label: "Todos los resultados",
    description: "El inventario completo, plegado, para quien quiera revisarlo.",
    group: "evidence",
    requiresQuery: false,
    allowsQuery: false,
    allowsVisualization: true,
    variants: ["table"],
    defaultVariant: "table",
    allowsFilters: true,
    allowsSamplePolicyOverride: true,
    copy: "title_only",
    requiresJourney: false,
    span: { min: 8, max: 12, default: 12 },
    clientFacing: true,
  },
];

export const BLOCK_SPECS: Readonly<Record<BlockType, BlockSpec>> = Object.freeze(
  Object.fromEntries(SPECS.map((spec) => [spec.id, spec])) as Record<BlockType, BlockSpec>,
);

export function blockSpec(type: BlockType): BlockSpec {
  return BLOCK_SPECS[type];
}

export function isBlockType(value: unknown): value is BlockType {
  return typeof value === "string" && (BLOCK_TYPES as readonly string[]).includes(value);
}

/** The catalogue as the composer's "add a block" menu wants it: grouped. */
export function blockCatalogue(): { group: BlockGroup; label: string; blocks: BlockSpec[] }[] {
  const GROUP_LABEL: Record<BlockGroup, string> = {
    structure: "Estructura",
    evidence: "Evidencia",
    narrative: "Narrativa",
    action: "Acción",
  };
  return BLOCK_GROUPS.map((group) => ({
    group,
    label: GROUP_LABEL[group],
    blocks: SPECS.filter((spec) => spec.group === group),
  }));
}
