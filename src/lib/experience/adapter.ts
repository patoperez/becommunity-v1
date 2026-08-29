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
 */

import { parseDashboardConfig, type DashboardSections } from "@/lib/dashboard/config";
import { parseJourneyDefinition } from "@/lib/calc/journey";

import { newBlock, newPage, DEFAULT_THEME } from "./defaults";
import {
  EXPERIENCE_SCHEMA_VERSION,
  type ExperienceBlock,
  type ExperienceDefinitionV1,
  type ExperiencePage,
  type FilterConnection,
  type FilterDefinition,
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
    aggregations:
      metric.unit === "nps"
        ? (["net_score", "value"] as const)
        : metric.unit === "percent"
          ? (["top_box", "value", "average"] as const)
          : (["average", "value", "min", "max", "count"] as const),
    defaultAggregation:
      metric.unit === "nps" ? "net_score" : metric.unit === "percent" ? "top_box" : "average",
    charts: [
      "kpi",
      "bar_horizontal",
      "bar_vertical",
      "table",
      "line",
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
  };
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
      if (dimension.values.length > EXPERIENCE_LIMITS.dimensionCardinality) {
        warnings.push({
          code: "dimension_too_wide",
          detail: `“${dimension.label}” tiene ${dimension.values.length} valores y no se ofrece como filtro.`,
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
        // Legacy studies do not record this measure separately. The contract
        // exists; the value is null until somebody configures one.
        unawareMetricId: null,
        unawareLabel: null,
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
  const panorama = newPage(pageSeed(snapshot, "panorama"), "Panorama", 0);
  const panoramaBlocks: ExperienceBlock[] = [];
  panoramaBlocks.push(
    ...record(
      newBlock({
        type: "cover",
        seed: blockSeed(snapshot, "panorama", "cover"),
        order: panoramaBlocks.length,
        registry,
        title: snapshot.studyName,
      }),
      "la portada",
    ),
  );

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
    blocks.push(
      ...record(
        newBlock({
          type: "qualitative_themes",
          seed: blockSeed(snapshot, "cualitativo", "themes"),
          order: 0,
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
          order: 1,
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
      .filter((block) => block.query !== null || block.type === "journey" || block.type === "qualitative_themes" || block.type === "theme_cloud")
      .map((block) => block.id),
  }));

  // --- What could not be carried -----------------------------------------
  if (sections.pivot) {
    warnings.push({
      code: "section_not_representable",
      detail:
        "El explorador cruzado del panel actual no tiene todavía un bloque equivalente en el modelo.",
    });
  }
  if (presentation.threshold) {
    warnings.push({
      code: "threshold_not_representable",
      detail:
        "La alerta por umbral configurada en el estudio no se representa aún como propiedad de un bloque.",
    });
  }

  const definition: ExperienceDefinitionV1 = {
    schemaVersion: EXPERIENCE_SCHEMA_VERSION,
    id: mintId("experience", `${snapshot.studyId}/experience/legacy`),
    title: snapshot.studyName,
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
    pages,
    filterDefinitions,
    filterConnections,
    journeyReferences,
    review: { ...NEW_REVIEW },
    publication: { ...UNPUBLISHED },
  };

  return { definition, registry, warnings };
}

/** Re-exported for callers that need the section vocabulary alongside. */
export type { DashboardSections };
export { INHERIT_SAMPLE_POLICY };
