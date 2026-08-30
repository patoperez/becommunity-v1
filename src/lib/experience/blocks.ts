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
 *   exploration filter_panel, pivot_explorer         — what the READER may ask
 *
 * The fifth group is not a tidier way of writing the first four. A block a
 * reader OPERATES is a different kind of thing from a block a reader READS: it
 * changes what the rest of the page says, it belongs at the top of what it
 * governs rather than wherever a chart would sit, and offering it in the same
 * list as a KPI is how a page ends up with three filter boxes nobody meant to
 * add.
 */

import type { ChartVariant } from "./charts";
import type { DimensionKind } from "./registry";

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
  "pivot_explorer",
  "filter_panel",
] as const;

export type BlockType = (typeof BLOCK_TYPES)[number];

export const BLOCK_GROUPS = [
  "structure",
  "evidence",
  "narrative",
  "action",
  "exploration",
] as const;
export type BlockGroup = (typeof BLOCK_GROUPS)[number];

/**
 * WHAT A KIND OF BLOCK CAN DO WITH A FILTER — DECLARED, NEVER INFERRED.
 *
 * There used to be ONE boolean, `allowsFilters`, and it answered two unrelated
 * questions at once: "may this block host a reader's controls?" and "does a
 * reader's choice change what this block says?". Hosting and responding have
 * never been the same thing in this model, and collapsing them had two visible
 * consequences.
 *
 *   The selected-block card offered "Qué filtros lo mueven" — the WHOLE
 *   characteristic registry, as a checklist — on a paragraph, a heading, the
 *   approved team reading and the download-report button, none of which
 *   compute anything. Ticking a box there did nothing at all.
 *
 *   The one type that genuinely hosts controls, `filter_panel`, had to be
 *   excluded from being a target by a hardcoded `block.type !== "filter_panel"`
 *   written into the resolver — an inference, in code, about a fact the
 *   catalogue was the right place to state.
 *
 * A viewer filter may move a block only when that block genuinely has
 * filterable data AND can recompute under the characteristic chosen. That is a
 * property of the block type and of where its numbers come from, so it is
 * stated here, once, as data — and a block type added later becomes eligible
 * by declaring itself rather than by being remembered somewhere else.
 */
export type BlockCapabilities = {
  /**
   * It reads AGGREGATE STUDY DATA and recomputes when the row set narrows.
   * A registry inventory is not study data: it lists what exists, and it says
   * the same thing whoever is reading.
   */
  consumesStudyData: boolean;
  /**
   * A READER'S filter — a panel, or an explicit connection — changes what it
   * shows. False for everything that draws no recomputable aggregate; those
   * get no filter-connection section in their card at all.
   */
  supportsViewerFilters: boolean;
  /**
   * The AUTHOR may narrow it permanently through `query.fixedFilters`. Only a
   * block that carries a query can: a fixed filter lives inside one.
   */
  supportsFixedFilters: boolean;
  /** Its evidence is the CONFIRMED QUALITATIVE review rather than an answer scale. */
  supportsQualitativeFilters: boolean;
  /** Its shape is a JOURNEY: ordered moments, one number each. */
  supportsJourneyFilters: boolean;
  /** Words, rules, spacing, images, identity. It measures nothing. */
  presentational: boolean;
  /** It does something when operated, and shows no aggregate of its own. */
  actionableNonData: boolean;
  /**
   * It HOSTS a reader's controls, the way a page does — `block.filterRefs`.
   *
   * DELIBERATELY UNCHANGED FROM WHAT `allowsFilters` PERMITTED. Hosting is not
   * what was wrong; conflating it with responding was. Every block type that
   * could offer a control before can offer one still, so no stored document
   * becomes invalid because the model learned to tell the two apart.
   */
  hostsFilterControls: boolean;
  /**
   * The characteristic kinds it can honestly recompute under, or `null` when
   * every filterable characteristic applies.
   *
   * A RESTRICTION IS DECLARED ONLY WHERE ONE GENUINELY EXISTS. A permanencia
   * series, a recorrido and the qualitative evidence are not
   * one-answer-per-respondent-per-period shapes: a `period` characteristic
   * either IS their own axis or has no bearing on them, so a control over one
   * would move nothing while appearing to. Everything else takes every kind.
   */
  filterableDimensionKinds: readonly DimensionKind[] | null;
};

/** Everything a person reads, and nothing a number is computed from. */
const STATIC: BlockCapabilities = {
  consumesStudyData: false,
  supportsViewerFilters: false,
  supportsFixedFilters: false,
  supportsQualitativeFilters: false,
  supportsJourneyFilters: false,
  presentational: true,
  actionableNonData: false,
  hostsFilterControls: false,
  filterableDimensionKinds: null,
};

/**
 * A control or an action. It shows no aggregate, so no filter MOVES it — and
 * it may still HOST one, which is the whole distinction this type exists to
 * keep. The deployed dashboard puts its controls beside its download button.
 */
const ACTION: BlockCapabilities = {
  ...STATIC,
  presentational: false,
  actionableNonData: true,
  hostsFilterControls: true,
};

/** An aggregate the author fixed and the reader may narrow. */
const MEASURED: BlockCapabilities = {
  consumesStudyData: true,
  supportsViewerFilters: true,
  supportsFixedFilters: true,
  supportsQualitativeFilters: false,
  supportsJourneyFilters: false,
  presentational: false,
  actionableNonData: false,
  hostsFilterControls: true,
  filterableDimensionKinds: null,
};

/** The kinds a block reads through respondents rather than along a period axis. */
const RESPONDENT_KINDS: readonly DimensionKind[] = ["segment", "category", "status"];

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
  /**
   * WHAT THIS KIND OF BLOCK CAN ACTUALLY DO WITH A FILTER.
   *
   * Declared, never inferred. See `BlockCapabilities`.
   */
  capabilities: BlockCapabilities;
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
    capabilities: STATIC,
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
    capabilities: STATIC,
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
    capabilities: STATIC,
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
    capabilities: MEASURED,
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
    capabilities: MEASURED,
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
    capabilities: MEASURED,
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
    capabilities: MEASURED,
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
    capabilities: {
      ...MEASURED,
      // A permanencia series ALREADY has period on its own axis. A control
      // over a period characteristic would either be the axis restated or a
      // narrowing with no bearing on it; either way it moves nothing.
      filterableDimensionKinds: RESPONDENT_KINDS,
    },
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
    capabilities: {
      consumesStudyData: true,
      supportsViewerFilters: true,
      // A recorrido carries no `query` — its numbers come from the journey's
      // own moments — so there is no `query.fixedFilters` for an author to
      // narrow it with.
      supportsFixedFilters: false,
      supportsQualitativeFilters: false,
      supportsJourneyFilters: true,
      presentational: false,
      actionableNonData: false,
      hostsFilterControls: true,
      filterableDimensionKinds: RESPONDENT_KINDS,
    },
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
    capabilities: {
      consumesStudyData: true,
      supportsViewerFilters: true,
      supportsFixedFilters: false,
      // Its evidence is the CONFIRMED qualitative review, joined to the people
      // who said it — so a characteristic of those people narrows it, and
      // nothing else does.
      supportsQualitativeFilters: true,
      supportsJourneyFilters: false,
      presentational: false,
      actionableNonData: false,
      hostsFilterControls: true,
      filterableDimensionKinds: RESPONDENT_KINDS,
    },
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
    capabilities: {
      consumesStudyData: true,
      supportsViewerFilters: true,
      supportsFixedFilters: false,
      supportsQualitativeFilters: true,
      supportsJourneyFilters: false,
      presentational: false,
      actionableNonData: false,
      hostsFilterControls: true,
      filterableDimensionKinds: RESPONDENT_KINDS,
    },
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
    capabilities: STATIC,
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
    capabilities: STATIC,
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
    capabilities: STATIC,
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
    capabilities: STATIC,
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
    capabilities: STATIC,
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
    // IT DOES SOMETHING; IT SHOWS NOTHING THAT RECOMPUTES.
    // The PDF it fetches is generated with whatever the reader has chosen at
    // that moment, which is a property of the REQUEST rather than of this
    // block: connecting a filter to the button changed no pixel of it, and
    // offering the whole characteristic registry next to a download link was
    // pure noise.
    capabilities: ACTION,
    allowsSamplePolicyOverride: false,
    copy: "short",
    requiresJourney: false,
    span: { min: 4, max: 12, default: 6 },
    clientFacing: true,
  },
  {
    id: "pivot_explorer",
    label: "Explorador de cruces",
    description:
      "El lector elige un resultado y hasta dos características, y el servidor calcula ese cruce.",
    // Exploration, beside the filter panel: both are blocks the READER
    // operates. It sat under evidence when it was the only one of its kind.
    group: "exploration",
    /*
     * THE ONE BLOCK WHOSE QUERY THE READER WRITES.
     *
     * Every other evidence block carries a `BlockQuerySpec` the AUTHOR fixed.
     * This one carries none, on purpose: the deployed comparison explorer is a
     * control the client drives, and the thing being composed is its presence,
     * its wording, its width and which filters narrow it — not the cross
     * itself. Storing an author's cross here would describe a different
     * product from the one that ships.
     *
     * That does not make it unbounded. The reader's choice is still validated
     * against `buildAllowlist`'s server-side allowlist on every request
     * (`src/lib/calc/pivot.ts`), which is the boundary P4E established and
     * which nothing here relaxes.
     *
     * It exists because the compatibility adapter used to report the explorer
     * as "not representable" and drop it. A model that silently loses a
     * section the product ships is not a compatible model.
     */
    requiresQuery: false,
    allowsQuery: false,
    allowsVisualization: true,
    variants: ["table"],
    defaultVariant: "table",
    capabilities: {
      consumesStudyData: true,
      supportsViewerFilters: true,
      // The READER writes this block's query, so there is no author query to
      // carry a fixed narrowing.
      supportsFixedFilters: false,
      supportsQualitativeFilters: false,
      supportsJourneyFilters: false,
      presentational: false,
      actionableNonData: false,
      hostsFilterControls: true,
      filterableDimensionKinds: null,
    },
    allowsSamplePolicyOverride: true,
    copy: "short",
    requiresJourney: false,
    span: { min: 8, max: 12, default: 12 },
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
    // AN INVENTORY IS NOT AN AGGREGATE.
    // It lists which results the study produces, folded away for whoever wants
    // to check. That list is the same list whatever the reader has chosen, so
    // no filter moves it.
    capabilities: ACTION,
    allowsSamplePolicyOverride: true,
    copy: "title_only",
    requiresJourney: false,
    span: { min: 8, max: 12, default: 12 },
    clientFacing: true,
  },
  {
    id: "filter_panel",
    label: "Panel de filtros",
    description:
      "Una caja visible con la que el cliente explora los resultados: elige características y los bloques conectados se recalculan.",
    group: "exploration",
    /*
     * THE READER'S CONTROLS, PLACED LIKE ANY OTHER BLOCK.
     *
     * It carries NO query. A panel does not represent a number; it changes
     * which respondents the numbers in the blocks it is connected to are
     * computed over. What is composed here is where the panel sits, how wide
     * it is, what it is called, which characteristics it offers, in what
     * order, and — the part that matters most — WHICH BLOCKS IT MOVES.
     *
     * It hosts filter controls through `filterRefs`, exactly as a page does,
     * and it states what it affects in `filterPanel.target`. Those are two
     * different questions and they stay two different fields: hosting a
     * control and being moved by one have never been the same thing in this
     * model, and a panel does not become an exception to that.
     *
     * `capabilities.hostsFilterControls` is true because hosting is the whole
     * point, and `capabilities.supportsViewerFilters` is false because a panel
     * draws nothing that could be recomputed.
     * `allowsSamplePolicyOverride` is false because a panel draws no
     * aggregate, so there is no disclosure decision to make about it.
     */
    requiresQuery: false,
    allowsQuery: false,
    allowsVisualization: false,
    variants: [],
    defaultVariant: null,
    // IT HOSTS, AND IT IS NOT MOVED.
    // `hostsFilterControls` is the whole point of the type. `supportsViewerFilters`
    // is false because a panel draws no aggregate — and because it is declared
    // here, the resolver no longer needs the hardcoded "and it is not a
    // filter_panel" that used to sit inside it.
    capabilities: {
      consumesStudyData: false,
      supportsViewerFilters: false,
      supportsFixedFilters: false,
      supportsQualitativeFilters: false,
      supportsJourneyFilters: false,
      presentational: false,
      actionableNonData: true,
      hostsFilterControls: true,
      filterableDimensionKinds: null,
    },
    allowsSamplePolicyOverride: false,
    copy: "short",
    requiresJourney: false,
    span: { min: 4, max: 12, default: 12 },
    clientFacing: true,
  },
];

export const BLOCK_SPECS: Readonly<Record<BlockType, BlockSpec>> = Object.freeze(
  Object.fromEntries(SPECS.map((spec) => [spec.id, spec])) as Record<BlockType, BlockSpec>,
);

export function blockSpec(type: BlockType): BlockSpec {
  return BLOCK_SPECS[type];
}

export function blockCapabilities(type: BlockType): BlockCapabilities {
  return BLOCK_SPECS[type].capabilities;
}

/**
 * WHY a kind of block cannot be moved by a reader's filter, in the words the
 * card and the panel's target list both print.
 *
 * `null` means it can. There is one sentence per reason rather than one
 * generic one, because "this is a paragraph" and "this is a button" are
 * different facts and a person deciding what to connect is helped by which.
 */
export function viewerFilterRefusal(type: BlockType): string | null {
  const spec = BLOCK_SPECS[type];
  if (spec.capabilities.supportsViewerFilters) return null;
  if (spec.capabilities.hostsFilterControls) {
    return "es el panel de filtros: ofrece los controles, no se mueve con ellos";
  }
  if (spec.capabilities.actionableNonData) {
    return "es una acción, no un resultado que se recalcule";
  }
  return "es contenido fijo: no muestra ningún número que cambie con un filtro";
}

/**
 * Whether one kind of block can honestly recompute under one kind of
 * characteristic. Unrestricted types take every kind.
 */
export function acceptsDimensionKind(type: BlockType, kind: DimensionKind): boolean {
  const allowed = BLOCK_SPECS[type].capabilities.filterableDimensionKinds;
  return allowed === null || allowed.includes(kind);
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
    exploration: "Exploración",
  };
  return BLOCK_GROUPS.map((group) => ({
    group,
    label: GROUP_LABEL[group],
    blocks: SPECS.filter((spec) => spec.group === group),
  }));
}
