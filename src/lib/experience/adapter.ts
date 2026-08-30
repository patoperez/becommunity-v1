/**
 * The bridge: one existing study, read as a composed experience.
 *
 * WHY THIS EXISTS AT ALL. A composer that cannot express what the product
 * already ships is a second product, not an evolution of this one. Before any
 * of it becomes editable and persistent, the claim "the current client
 * experience is a special case of the new model" has to be either demonstrated
 * or abandoned. This module is the demonstration, and the golden fixtures in
 * `scripts/experience-composer-test.mjs` are the evidence.
 *
 * WHAT IT PROMISES.
 *
 *  - IT WRITES NOTHING. No database call, no Server Action, no mutation of the
 *    snapshot it is handed. It is a pure function from a plain object to a
 *    definition, which is why an offline gate can run it against a fixture with
 *    no credentials and no real study anywhere near it.
 *
 *  - IT IS DETERMINISTIC. Identical input, identical output, byte for byte.
 *    Every identifier is hashed from stable legacy identity, never generated;
 *    every list is ordered explicitly.
 *
 *  - IT PRESERVES THE DISCLOSURE RULE. Every adapted definition carries
 *    `LEGACY_SAMPLE_POLICY` — hide below five — because that is what the study
 *    behaves like today and adaptation is not the moment to change it. The new
 *    `show_all` default applies to experiences composed from scratch. Changing
 *    an existing study's rule stays a deliberate act by a person.
 *
 *  - IT SAYS WHAT IT COULD NOT CARRY. Anything the current product does that
 *    V1 of the model cannot yet express comes back as a warning. Warnings are
 *    internal: they are for the team building the composer, never for a client.
 *
 * WHAT THE FIRST ROUND OF WARNINGS TURNED OUT TO BE. Every one of the four is
 * now a defect that has been fixed rather than a limitation that is announced:
 *
 *    the pivot explorer          was a MODEL gap, and the model closed it. The
 *                                deployed comparison explorer is a
 *                                `pivot_explorer` block placed on the panorama
 *                                page, connected to the study's filters like
 *                                every other piece of evidence. Adapting no
 *                                longer loses a section the product ships.
 *    a configured ideal range    was a MODELLING gap: `comparison` carried one
 *                                number and the product ships a labelled range.
 *                                The model now carries the range, and this
 *                                adapter places it on the block that shows the
 *                                result. It warns only when no block does.
 *    a 72-value characteristic   was an ADAPTER defect: a chart's legibility
 *                                ceiling was applied to a filter control, and
 *                                the adapter dropped a filter the deployed
 *                                dashboard offers. Controls have their own,
 *                                much larger ceiling now.
 *    a moment with no result     invalid legacy configuration, not a model
 *                                limitation. The moment is kept, visible and
 *                                without a number, and the warning names it.
 *                                The study's own data is never repaired here.
 */

import { parseDashboardConfig, type DashboardSections } from "@/lib/dashboard/config";
import { parseJourneyDefinition } from "@/lib/calc/journey";
import { documentedTopBoxMinimum } from "@/lib/calc/scale";

import { newBlock, newIdentity, newPage, DEFAULT_THEME } from "./defaults";
import {
  FINDINGS_FILTER_SUGGESTIONS,
  JOURNEY_FILTER_SUGGESTIONS,
} from "./template-suggestions";
import {
  EXPERIENCE_SCHEMA_VERSION,
  type ExperienceBlock,
  type ExperienceDefinitionV1,
  type ExperiencePage,
  type FilterConnection,
  type FilterDefinition,
  type FilterTarget,
  type JourneyReference,
} from "./definition";
import { mintId } from "./ids";
import { NEW_REVIEW, UNPUBLISHED } from "./review";
import { LEGACY_SAMPLE_POLICY, INHERIT_SAMPLE_POLICY } from "./sample-policy";
import {
  DEFAULT_NUMBER_FORMAT,
  type MetricFamily,
  type SemanticDimension,
  type SemanticMetric,
  type SemanticRegistry,
} from "./registry";
import { registrySignature } from "./registry";
import { EXPERIENCE_LIMITS } from "./limits";
import { isSafeAuthoredText } from "./text";

// ---------------------------------------------------------------------------
// What the adapter is given
// ---------------------------------------------------------------------------

/**
 * One result the study genuinely produces.
 *
 * `key` is the canonical metric key. It is used ONLY as a hash seed for the
 * registry handle and never travels into the definition, which is the whole
 * point: the composed document carries no database key.
 */
export type LegacyMetricInput = {
  key: string;
  name: string;
  question: string;
  unit: "nps" | "percent" | "score";
  responses: number;
  /** False when the study's current data no longer produces this result. */
  available: boolean;
  /** The range the study's own answers to this result actually span. */
  scale: { minimum: number; maximum: number } | null;
};

export type LegacyDimensionInput = {
  key: string;
  /** The distinct values, already canonicalized by the category review. */
  values: string[];
};

export type LegacyThemeInput = { label: string; confirmed: number };

export type LegacyStudySnapshot = {
  studyId: string;
  tenantId: string;
  studyName: string;
  clientName: string;
  period: string | null;
  status: string;
  /** The study's `dashboard_config` jsonb, exactly as stored. */
  dashboardConfig: unknown;
  /** The study's `journey_definition` jsonb, exactly as stored. */
  journeyDefinition: unknown;
  metrics: LegacyMetricInput[];
  dimensions: LegacyDimensionInput[];
  themes: LegacyThemeInput[];
  /** Every period the study has data for, oldest first. */
  periods: string[];
};

export type AdapterWarning = {
  code:
    /**
     * Retained in the vocabulary although nothing raises it today: the pivot
     * explorer — the one section that ever produced it — is a block now. Kept
     * so a future section that genuinely cannot be carried has a code to use
     * rather than inventing one.
     */
    | "section_not_representable"
    | "threshold_not_representable"
    | "metric_not_available"
    | "dimension_too_wide"
    | "no_results"
    | "no_journey"
    | "block_not_created";
  /** Internal wording. Never rendered to a client. */
  detail: string;
};

export type AdapterResult = {
  definition: ExperienceDefinitionV1;
  registry: SemanticRegistry;
  warnings: AdapterWarning[];
};

// ---------------------------------------------------------------------------
// Registry handles — opaque, stable, derived from legacy identity
// ---------------------------------------------------------------------------

function handle(prefix: "r" | "c", studyId: string, key: string): string {
  // `mintId` gives a prefixed opaque token; the registry handle reuses the same
  // hash so that a handle is as label-independent as an identifier is.
  const minted = mintId("block", `${prefix}/${studyId}/${key}`);
  return `${prefix}_${minted.slice(minted.indexOf("_") + 1)}`;
}

/**
 * Which family a legacy result belongs to.
 *
 * Derived from the SAME branching the engine already uses to decide how to
 * compute a stage (`src/lib/studio/journey-picker.ts`), so the family never
 * describes a number differently from the way it is calculated. It is a
 * heuristic over the study's own naming, and it deliberately falls back to
 * `other` rather than guessing.
 */
export function familyForMetric(key: string): MetricFamily {
  if (key.startsWith("nps")) return "recommendation";
  if (key.startsWith("sat") || key.startsWith("csat")) return "satisfaction";
  return "other";
}

function metricEntry(studyId: string, metric: LegacyMetricInput): SemanticMetric {
  const family = familyForMetric(metric.key);
  const format =
    metric.unit === "percent"
      ? { decimals: 1, suffix: "percent" as const, grouped: false }
      : metric.unit === "nps"
        ? { decimals: 0, suffix: "points" as const, grouped: false }
        : { ...DEFAULT_NUMBER_FORMAT };
  return {
    id: handle("r", studyId, metric.key),
    label: metric.name,
    question: metric.question,
    description: metric.question,
    source: "Respuestas importadas de este estudio.",
    family,
    unit: metric.unit === "nps" ? "nps" : metric.unit === "percent" ? "percent" : "score",
    format,
    // What the deployed product already computes for a result of this shape.
    // Nothing new is offered: a composer cannot ask for an aggregation the
    // canonical engine does not implement.
    //
    // `count` and `share` are added to every result because counting the
    // answers behind one is always available and always honest, and because a
    // drawing that divides a whole — a pastel, a dona, unos rectángulos — needs
    // an aggregation whose parts actually add up to the total. Without them the
    // composer could offer those three drawings and the validator would refuse
    // every one, which is a menu that lies about what is possible.
    // A result whose scale has no documented Top-2-Box does not OFFER one.
    // The menu and the engine agree: an aggregation that cannot be computed
    // honestly is not something the composer lets somebody choose.
    aggregations:
      metric.unit === "nps"
        ? (["net_score", "value", "count", "share"] as const)
        : metric.unit === "percent"
          ? topBoxMinimumFor(metric) === null
            ? (["average", "value", "count", "share"] as const)
            : (["top_box", "value", "average", "count", "share"] as const)
          : (["average", "value", "min", "max", "count", "share"] as const),
    defaultAggregation:
      metric.unit === "nps"
        ? "net_score"
        : metric.unit === "percent" && topBoxMinimumFor(metric) !== null
          ? "top_box"
          : "average",
    // Every drawing the model can express. Which of them is HONEST for a given
    // block is decided by `validateExperienceDefinition` against the query that
    // block actually carries — how many characteristics it supplies, how many
    // values those carry, and whether the aggregation divides a whole. Encoding
    // that here instead would put the same rule in two places.
    charts: [
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
    ],
    filterEligible: false,
    // The legacy recorrido could point at any numeric result, and adapting must
    // not narrow what an existing study already does.
    journeyEligible: true,
    privacy: "aggregate_only",
    samplePolicy: null,
    publicationReady: metric.available && metric.responses > 0,
    responses: metric.responses,
    scale: metric.scale,
    topBoxMinimum: topBoxMinimumFor(metric),
  };
}

/**
 * The satisfied-from score for a Top-2-Box, taken from the two scales the
 * calculation catalogue documents and from nowhere else.
 *
 * `docs/CALCULATION_CATALOG.md` §4: on a 1–5 scale, four and five are
 * satisfied. `docs/CALCULATION_POLICY.md` §5: on a 0–10 scale it is nine.
 * Anything else returns null, and a null threshold makes the engine refuse the
 * aggregation instead of producing a number. Widening this to "whatever the
 * top two values happen to be" would be inventing a formula, which is exactly
 * what the project forbids.
 */
function topBoxMinimumFor(metric: LegacyMetricInput): number | null {
  // ONE RULE, IN ONE PLACE. `src/lib/calc/scale.ts` owns it, and the client
  // dashboard, the server PDF and the longitudinal series now read the same
  // function. That is the point: the composer derived the scale correctly
  // while those three still applied the 0–10 default, and two derivations of
  // one fact is how a builder preview and a client's screen come to disagree
  // about a number.
  return documentedTopBoxMinimum(metric.scale);
}

function dimensionEntry(studyId: string, dimension: LegacyDimensionInput): SemanticDimension {
  const label = dimension.key.replace(/^seg_/, "").replace(/[_-]+/g, " ").trim();
  return {
    id: handle("c", studyId, dimension.key),
    label: label.charAt(0).toUpperCase() + label.slice(1),
    description: "Característica declarada en la importación de este estudio.",
    source: "Columnas seg_ del archivo importado.",
    kind: "segment",
    values: [...dimension.values]
      .sort((a, b) => a.localeCompare(b, "es-MX"))
      .map((value) => ({ value, label: value })),
    filterEligible: true,
    journeyEligible: false,
    publicationReady: dimension.values.length > 0,
  };
}

/**
 * The server's private map from opaque handle back to the canonical key.
 *
 * It is built from the SAME `handle()` the registry is built with, so the two
 * can never drift, and it is deliberately a separate value rather than a field
 * on the registry: the registry crosses to the browser and this must not. A
 * definition carries handles; only this index turns one into a metric key, and
 * only on the server, in the one module that reads the study's rows.
 */
export function registryKeyIndex(snapshot: LegacyStudySnapshot): {
  metrics: Record<string, string>;
  dimensions: Record<string, string>;
} {
  const metrics: Record<string, string> = {};
  for (const metric of snapshot.metrics) {
    metrics[handle("r", snapshot.studyId, metric.key)] = metric.key;
  }
  const dimensions: Record<string, string> = {};
  for (const dimension of snapshot.dimensions) {
    dimensions[handle("c", snapshot.studyId, dimension.key)] = dimension.key;
  }
  return { metrics, dimensions };
}

/** The registry one legacy study produces. Pure, ordered, reproducible. */
export function buildLegacyRegistry(snapshot: LegacyStudySnapshot): SemanticRegistry {
  const metrics = [...snapshot.metrics]
    .sort((a, b) => a.key.localeCompare(b.key, "es-MX"))
    .map((metric) => metricEntry(snapshot.studyId, metric));
  const dimensions = [...snapshot.dimensions]
    .sort((a, b) => a.key.localeCompare(b.key, "es-MX"))
    .map((dimension) => dimensionEntry(snapshot.studyId, dimension));
  const registry: SemanticRegistry = {
    scope: { tenantId: snapshot.tenantId, studyId: snapshot.studyId },
    registryVersion: "",
    metrics,
    dimensions,
  };
  return { ...registry, registryVersion: registrySignature(registry) };
}

// ---------------------------------------------------------------------------
// The adaptation
// ---------------------------------------------------------------------------
// Suggested filters — a template's recommendation, never the engine's rule
// ---------------------------------------------------------------------------

/**
 * WHICH CHARACTERISTICS A FRESHLY ADAPTED PANEL OPENS WITH.
 *
 * The recommendations themselves are DATA and live in
 * `template-suggestions.ts`, which is where a client's configuration is
 * allowed to be specific. This module stays a generic mechanism: it applies
 * whatever ordered list of label fragments it is given, to whatever
 * characteristics the study actually has, and restricts nothing. Every
 * filter-eligible characteristic is still declared as a filter and still
 * offerable in the builder whether or not a suggestion named it.
 */
/** Accent- and case-insensitive, so "Generacion" matches "generación". */
function fold(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
}

/**
 * The suggested filters this study actually has, in the suggested order,
 * followed by nothing. A suggestion that matches no characteristic is simply
 * not offered — it is never invented.
 */
function suggestFilters(
  available: readonly FilterDefinition[],
  suggestions: readonly string[],
): string[] {
  const chosen: string[] = [];
  const taken = new Set<string>();
  for (const suggestion of suggestions) {
    const folded = fold(suggestion);
    for (const filter of available) {
      if (taken.has(filter.id)) continue;
      if (!fold(filter.label).includes(folded)) continue;
      taken.add(filter.id);
      chosen.push(filter.id);
      break;
    }
  }
  // A study that matches none of the suggestions is not a study without
  // filters. It opens on the characteristics it does have, which is better
  // than an empty panel that looks broken.
  if (chosen.length === 0) {
    for (const filter of available.slice(0, 6)) chosen.push(filter.id);
  }
  return chosen.slice(0, EXPERIENCE_LIMITS.filtersPerPanel);
}

/** A visible panel, built the same way every other adapted block is. */
function panelBlock(request: {
  seed: string;
  order: number;
  registry: SemanticRegistry;
  title: string;
  intro: string | null;
  filterIds: string[];
  target: FilterTarget;
}): ExperienceBlock | null {
  const block = newBlock({
    type: "filter_panel",
    seed: request.seed,
    order: request.order,
    registry: request.registry,
    title: request.title,
  });
  if (!block || !block.filterPanel) return null;
  return {
    ...block,
    filterRefs: request.filterIds,
    filterPanel: { ...block.filterPanel, intro: request.intro, target: request.target },
  };
}

// ---------------------------------------------------------------------------

function pageSeed(snapshot: LegacyStudySnapshot, name: string): string {
  return `${snapshot.studyId}/page/${name}`;
}

function blockSeed(snapshot: LegacyStudySnapshot, page: string, name: string): string {
  return `${snapshot.studyId}/block/${page}/${name}`;
}

/**
 * The results the adapted panorama leads with.
 *
 * The same rule the deployed page already applies: the study's own
 * configuration decides. A recorrido moment names a result, so those come
 * first, in recorrido order; the recommendation result follows when the study
 * has one. Nothing is invented and nothing is promoted for being interesting.
 */
function featuredMetricIds(
  snapshot: LegacyStudySnapshot,
  registry: SemanticRegistry,
  stageMetricKeys: string[],
): string[] {
  const ordered: string[] = [];
  const push = (id: string | null) => {
    if (id && !ordered.includes(id)) ordered.push(id);
  };
  const recommendation = registry.metrics.find((metric) => metric.family === "recommendation");
  push(recommendation?.id ?? null);
  for (const key of stageMetricKeys) push(handle("r", snapshot.studyId, key));
  return ordered.filter((id) => registry.metrics.some((metric) => metric.id === id)).slice(0, 6);
}

/**
 * Put the study's configured ideal range on every block that shows that result.
 *
 * The deployed product stores one threshold per study — a metric key, a
 * minimum, a maximum and a label — and renders it as the single alert on the
 * client's first screen. The model expresses the same thing as a `target`
 * comparison on the query, which is strictly more precise: the range belongs to
 * the result it is about, not to the study.
 *
 * The label is authored prose from a person and is held to the same standard as
 * any other authored string. A label that is too long is trimmed to the
 * declared ceiling; one that carries markup or query syntax is dropped and the
 * range is kept, because the range is the number and the label is the wording.
 */
function applyConfiguredThreshold(
  pages: ExperiencePage[],
  metricId: string,
  threshold: { minimum: number | null; maximum: number | null; label: string },
): { pages: ExperiencePage[]; applied: number } {
  if (threshold.minimum === null && threshold.maximum === null) return { pages, applied: 0 };
  const trimmed = threshold.label.trim().slice(0, EXPERIENCE_LIMITS.titleLength);
  const label = trimmed !== "" && isSafeAuthoredText(trimmed) ? trimmed : null;
  let applied = 0;
  const next = pages.map((page) => ({
    ...page,
    blocks: page.blocks.map((block) => {
      if (!block.query || block.query.metricId !== metricId) return block;
      applied += 1;
      return {
        ...block,
        query: {
          ...block.query,
          comparison: {
            kind: "target" as const,
            target: threshold.minimum,
            targetMaximum: threshold.maximum,
            targetLabel: label,
          },
        },
      };
    }),
  }));
  return applied > 0 ? { pages: next, applied } : { pages, applied: 0 };
}

export function adaptLegacyStudy(snapshot: LegacyStudySnapshot): AdapterResult {
  const warnings: AdapterWarning[] = [];
  const registry = buildLegacyRegistry(snapshot);
  const { sections, presentation } = parseDashboardConfig(snapshot.dashboardConfig);
  const stages = parseJourneyDefinition(snapshot.journeyDefinition);

  if (registry.metrics.length === 0) {
    warnings.push({
      code: "no_results",
      detail: "El estudio no produce ningún resultado numérico todavía.",
    });
  }

  // --- Filters ------------------------------------------------------------
  const filterDefinitions: FilterDefinition[] = [];
  if (sections.filters) {
    for (const dimension of registry.dimensions) {
      if (dimension.values.length === 0) continue;
      // A CONTROL IS NOT A CHART. Sixty is the number of bars a person can
      // compare; it is not the number of options a select can hold, and the
      // deployed dashboard already offers one over every imported `seg_`
      // column however many distinct values it found. Applying the chart's
      // ceiling here dropped a filter the product ships, which is precisely
      // what a compatibility adapter exists not to do.
      if (dimension.values.length > EXPERIENCE_LIMITS.filterOptions) {
        warnings.push({
          code: "dimension_too_wide",
          detail: `“${dimension.label}” tiene ${dimension.values.length} valores, más de los ${EXPERIENCE_LIMITS.filterOptions} que admite un control, y no se ofrece como filtro.`,
        });
        continue;
      }
      if (filterDefinitions.length >= EXPERIENCE_LIMITS.filterDefinitions) break;
      filterDefinitions.push({
        id: mintId("filter", `${snapshot.studyId}/filter/${dimension.id}`),
        dimensionId: dimension.id,
        label: dimension.label,
        control: "single_select",
        defaultValues: [],
        clientVisible: true,
        scope: "global",
        pageId: null,
        dependsOn: null,
      });
    }
  }

  // --- Journeys -----------------------------------------------------------
  const journeyReferences: JourneyReference[] = [];
  if (stages.length > 0) {
    const moments = stages.map((stage) => {
      const metricId = handle("r", snapshot.studyId, stage.metric);
      const known = registry.metrics.some((metric) => metric.id === metricId);
      if (!known) {
        warnings.push({
          code: "metric_not_available",
          detail: `El momento “${stage.label}” apunta a un resultado que los datos actuales ya no producen.`,
        });
      }
      return {
        id: mintId("moment", `${snapshot.studyId}/moment/${stage.id}`),
        title: stage.label,
        description: stage.description ?? null,
        metricId: known ? metricId : null,
        /*
         * ADAPTING NEVER INVENTS AN AWARENESS MAPPING.
         *
         * A study may well record "no sabía que existía este momento"
         * somewhere — the real one has a whole family of results that look
         * like it. But WHICH result carries it, and WHICH of its recorded
         * values mean "did not know", are two decisions, and guessing either
         * puts a percentage on a client's screen that nobody configured. The
         * contract exists; the value stays null until a person fills it in,
         * and the builder shows them where.
         */
        awareness: null,
        body: null,
        variant: null,
        bandSchemeId: null,
        visible: true,
      };
    });
    const families = [
      ...new Set(
        moments
          .map((moment) => registry.metrics.find((metric) => metric.id === moment.metricId))
          .filter((metric): metric is SemanticMetric => Boolean(metric))
          .map((metric) => metric.family),
      ),
    ].sort();
    journeyReferences.push({
      id: mintId("journey", `${snapshot.studyId}/journey/legacy`),
      title: "Recorrido",
      description: null,
      // Exactly the families the study's own moments already use, so adapting
      // never invents a constraint the study fails.
      eligibleFamilies: families.length > 0 ? families : ["other"],
      moments,
      filterRefs: [],
      variant: "stepped",
      bandSchemeId: null,
      visible: true,
      origin: "legacy_journey_definition",
      revision: 1,
    });
  } else if (sections.journey) {
    warnings.push({
      code: "no_journey",
      detail: "La sección del recorrido está activa pero el estudio no tiene momentos definidos.",
    });
  }


  // --- Pages --------------------------------------------------------------
  const pages: ExperiencePage[] = [];
  const record = (block: ExperienceBlock | null, what: string): ExperienceBlock[] => {
    if (block) return [block];
    warnings.push({ code: "block_not_created", detail: `No se pudo representar ${what}.` });
    return [];
  };

  // 1. Panorama — what the client sees first today.
  //
  // NO COVER BLOCK. The study's own name, its client, its period and its
  // introductory sentence are the IDENTITY of the report, not a section of
  // Panorama, and they live in the global identity layer built below. Putting
  // them in a block made them reorderable underneath a chart, countable as
  // Panorama content, and duplicated whenever the page was.
  const panorama = newPage(pageSeed(snapshot, "panorama"), "Panorama", 0);
  const panoramaBlocks: ExperienceBlock[] = [];

  // The visible controls the reader explores with. The deployed dashboard
  // narrows the whole screen from one global filter bar, so the panel this
  // adapts to governs the whole experience and offers the same
  // characteristics — now as a block somebody can move, rename, narrow or
  // remove instead of a fixed bar nobody could touch.
  if (filterDefinitions.length > 0) {
    panoramaBlocks.push(
      ...record(
        panelBlock({
          seed: blockSeed(snapshot, "panorama", "filter-panel"),
          order: panoramaBlocks.length,
          registry,
          title: "Explora los resultados",
          intro:
            "Elige una o varias características para ver los resultados de ese grupo. Puedes limpiar los filtros en cualquier momento.",
          filterIds: suggestFilters(filterDefinitions, JOURNEY_FILTER_SUGGESTIONS),
          target: { kind: "experience" },
        }),
        "el panel de filtros",
      ),
    );
  }

  const stageMetricKeys = stages.map((stage) => stage.metric);
  const featured = featuredMetricIds(snapshot, registry, stageMetricKeys);
  if (sections.metrics) {
    for (const metricId of featured) {
      const metric = registry.metrics.find((entry) => entry.id === metricId);
      panoramaBlocks.push(
        ...record(
          newBlock({
            type: "metric",
            seed: blockSeed(snapshot, "panorama", `metric/${metricId}`),
            order: panoramaBlocks.length,
            registry,
            metricId,
            title: metric?.label ?? null,
          }),
          `el resultado destacado ${metric?.label ?? metricId}`,
        ),
      );
    }
  }

  if (sections.narrative) {
    panoramaBlocks.push(
      ...record(
        newBlock({
          type: "finding",
          seed: blockSeed(snapshot, "panorama", "finding"),
          order: panoramaBlocks.length,
          registry,
          title: "Lo que más destaca",
        }),
        "el hallazgo principal",
      ),
    );
  }

  if (sections.segments) {
    panoramaBlocks.push(
      ...record(
        newBlock({
          type: "comparison",
          seed: blockSeed(snapshot, "panorama", "comparison"),
          order: panoramaBlocks.length,
          registry,
          title: "Comparar grupos",
        }),
        "la comparación entre grupos",
      ),
    );
  }

  if (sections.metrics) {
    panoramaBlocks.push(
      ...record(
        newBlock({
          type: "all_results_disclosure",
          seed: blockSeed(snapshot, "panorama", "all-results"),
          order: panoramaBlocks.length,
          registry,
          title: "Todos los resultados",
        }),
        "el inventario completo de resultados",
      ),
    );
  }

  // The comparison explorer the deployed dashboard ships. It is a block now
  // rather than a warning: see the note on `pivot_explorer` in blocks.ts.
  if (sections.pivot) {
    panoramaBlocks.push(
      ...record(
        newBlock({
          type: "pivot_explorer",
          seed: blockSeed(snapshot, "panorama", "pivot"),
          order: panoramaBlocks.length,
          registry,
          title: "Explorar los cruces",
        }),
        "el explorador de cruces",
      ),
    );
  }

  if (sections.report) {
    panoramaBlocks.push(
      ...record(
        newBlock({
          type: "report_download",
          seed: blockSeed(snapshot, "panorama", "report"),
          order: panoramaBlocks.length,
          registry,
          title: "Descargar el informe",
        }),
        "la descarga del informe",
      ),
    );
  }
  pages.push({ ...panorama, blocks: panoramaBlocks });

  // 2. Recorrido.
  if (sections.journey && journeyReferences.length > 0) {
    const journey = newPage(pageSeed(snapshot, "recorrido"), "Recorrido", pages.length);
    const blocks = record(
      newBlock({
        type: "journey",
        seed: blockSeed(snapshot, "recorrido", "journey"),
        order: 0,
        registry,
        journeyId: journeyReferences[0].id,
        title: journeyReferences[0].title,
      }),
      "el recorrido",
    );
    pages.push({ ...journey, blocks });
  }

  // 3. Permanencia y tendencia.
  if (sections.trends) {
    const trends = newPage(pageSeed(snapshot, "tendencias"), "Permanencia", pages.length);
    const blocks = record(
      newBlock({
        type: "retention",
        seed: blockSeed(snapshot, "tendencias", "retention"),
        order: 0,
        registry,
        title: "Permanencia",
      }),
      "la serie de permanencia",
    );
    pages.push({ ...trends, blocks });
  }

  // 4. Lo que dijeron.
  if (sections.qualitative) {
    const voices = newPage(pageSeed(snapshot, "cualitativo"), "Lo que dijeron", pages.length);
    const blocks: ExperienceBlock[] = [];
    // A SECOND PANEL, SCOPED TO THIS PAGE, with the characteristics a reading
    // of findings usually turns on. It moves what is on this page and nothing
    // else — which is the difference between "page" and "experience" made
    // visible on the study the team actually looks at.
    if (filterDefinitions.length > 0) {
      blocks.push(
        ...record(
          panelBlock({
            seed: blockSeed(snapshot, "cualitativo", "filter-panel"),
            order: blocks.length,
            registry,
            title: "Filtra lo que dijeron",
            intro:
              "Estos filtros solo cambian lo de esta página. Los resultados de las otras páginas se quedan como están.",
            filterIds: suggestFilters(filterDefinitions, FINDINGS_FILTER_SUGGESTIONS),
            target: { kind: "page" },
          }),
          "el panel de filtros de la página",
        ),
      );
    }
    blocks.push(
      ...record(
        newBlock({
          type: "qualitative_themes",
          seed: blockSeed(snapshot, "cualitativo", "themes"),
          order: blocks.length,
          registry,
          title: "Temas confirmados",
        }),
        "los temas confirmados",
      ),
    );
    blocks.push(
      ...record(
        newBlock({
          type: "theme_cloud",
          seed: blockSeed(snapshot, "cualitativo", "cloud"),
          order: blocks.length,
          registry,
          title: "Nube de temas",
        }),
        "la nube de temas",
      ),
    );
    pages.push({ ...voices, blocks });
  }

  // 5. Lectura del equipo — the approved interpretation, never drafted here.
  const reading = newPage(pageSeed(snapshot, "lectura"), "Lectura del equipo", pages.length);
  pages.push({
    ...reading,
    blocks: record(
      newBlock({
        type: "interpretation",
        seed: blockSeed(snapshot, "lectura", "interpretation"),
        order: 0,
        registry,
        title: "Lectura del equipo",
      }),
      "la lectura del equipo",
    ),
  });

  // --- Connections --------------------------------------------------------
  // Every filter reaches every block that reads a result. This is written down
  // block by block rather than implied by a shared characteristic, which is the
  // whole point of the connection model.
  const filterConnections: FilterConnection[] = filterDefinitions.map((filter) => ({
    id: mintId("connection", `${snapshot.studyId}/connection/${filter.id}`),
    filterId: filter.id,
    blockIds: pages
      .flatMap((page) => page.blocks)
      .filter(
        (block) =>
          block.query !== null
          || block.type === "journey"
          || block.type === "qualitative_themes"
          || block.type === "theme_cloud"
          || block.type === "pivot_explorer",
      )
      .map((block) => block.id),
  }));

  // --- The study's configured ideal range ---------------------------------
  // The deployed product carries exactly one of these: a result, a minimum, a
  // maximum and the words to use when the value falls outside them. It is a
  // statement ABOUT ONE RESULT, so it becomes the comparison on the block that
  // shows that result rather than a property of the study as a whole.
  const thresholdPages = presentation.threshold
    ? applyConfiguredThreshold(pages, handle("r", snapshot.studyId, presentation.threshold.metric), {
        minimum: presentation.threshold.minimum,
        maximum: presentation.threshold.maximum,
        label: presentation.threshold.label,
      })
    : { pages, applied: 0 };
  if (presentation.threshold && thresholdPages.applied === 0) {
    warnings.push({
      code: "threshold_not_representable",
      detail:
        "El estudio tiene un rango ideal configurado sobre un resultado que esta experiencia no muestra en ningún bloque, así que la alerta no se pudo colocar.",
    });
  }

  const definition: ExperienceDefinitionV1 = {
    schemaVersion: EXPERIENCE_SCHEMA_VERSION,
    id: mintId("experience", `${snapshot.studyId}/experience/legacy`),
    title: snapshot.studyName,
    /*
     * THE IDENTITY LAYER, carrying what the cover block used to carry.
     *
     * Read from the study itself — its name, the client it belongs to and the
     * period it covers — so adapting an existing study loses none of the
     * information the cover showed. `description` is left null rather than
     * filled with a sentence nobody wrote: an introduction is authored work,
     * and inventing one would be the composer putting words in the
     * consultant's mouth. The part is hidden until there is something to show,
     * so nothing renders as an empty line.
     */
    identity: newIdentity({
      title: snapshot.studyName,
      organization: snapshot.clientName,
      period: snapshot.period,
      description: null,
      showMark: DEFAULT_THEME.showClientMark,
      showReportDownload: sections.report,
    }),
    metadata: {
      studyId: snapshot.studyId,
      tenantId: snapshot.tenantId,
      subtitle: snapshot.period,
      locale: "es-MX",
    },
    // THE PRESERVATION THAT MATTERS. An adapted study keeps the rule it runs
    // under today, whatever the new default is for work composed from scratch.
    sampleVisibilityPolicy: { ...LEGACY_SAMPLE_POLICY },
    theme: {
      ...DEFAULT_THEME,
      accent: presentation.primaryColor
        ? { source: "custom", hex: presentation.primaryColor }
        : { source: "client_brand" },
    },
    pages: thresholdPages.pages,
    filterDefinitions,
    filterConnections,
    // ADAPTING DECLARES NO SEMÁFORO. A study's existing configuration says
    // nothing about what verde means, and the composer does not decide it.
    bandSchemes: [],
    journeyReferences,
    review: { ...NEW_REVIEW },
    publication: { ...UNPUBLISHED },
  };

  return { definition, registry, warnings };
}

/** Re-exported for callers that need the section vocabulary alongside. */
export type { DashboardSections };
export { INHERIT_SAMPLE_POLICY };
