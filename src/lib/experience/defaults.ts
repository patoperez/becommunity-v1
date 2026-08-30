/**
 * What a new thing starts as.
 *
 * Every factory here is PURE and DETERMINISTIC: given the same seed and the
 * same registry it returns the same object, with the same identifier. That is
 * what lets the compatibility adapter be reproducible and lets a gate assert an
 * exact document.
 *
 * A default is a product decision, not a placeholder. A block that arrives
 * already pointing at a real result, already drawn a sensible way, already full
 * width on a phone, is a block somebody can look at and judge. A block that
 * arrives empty is a form.
 */

import { blockSpec, type BlockType } from "./blocks";
import type { ChartVariant } from "./charts";
import { CHART_SPECS } from "./charts";
import {
  EXPERIENCE_SCHEMA_VERSION,
  type BlockQuerySpec,
  type ExperienceBlock,
  type ExperienceDefinitionV1,
  type ExperiencePage,
  type ExperienceTheme,
} from "./definition";
import { mintId } from "./ids";
import { defaultLayout } from "./layout";
import { EXPERIENCE_LIMITS } from "./limits";
import type { SemanticDimension, SemanticMetric, SemanticRegistry } from "./registry";
import { NEW_REVIEW, UNPUBLISHED } from "./review";
import { DEFAULT_SAMPLE_POLICY, INHERIT_SAMPLE_POLICY, type SampleVisibilityPolicy } from "./sample-policy";

export const DEFAULT_THEME: ExperienceTheme = {
  palette: "client_brand",
  accent: { source: "client_brand" },
  density: "comfortable",
  showClientMark: true,
};

/** The number format a result's own unit implies. */
export function formatForMetric(metric: SemanticMetric) {
  return { ...metric.format };
}

export function defaultQuery(
  metric: SemanticMetric,
  dimension: SemanticDimension | null,
): BlockQuerySpec {
  return {
    metricId: metric.id,
    aggregation: metric.defaultAggregation,
    primaryDimensionId: dimension?.id ?? null,
    secondaryDimensionId: null,
    filterRefs: [],
    sort: { by: dimension ? "value" : "label", direction: "desc" },
    topN: null,
    period: { kind: "latest", periodId: null },
    comparison: { kind: "none", target: null, targetMaximum: null, targetLabel: null },
    numberFormat: formatForMetric(metric),
    samplePolicy: INHERIT_SAMPLE_POLICY,
  };
}

function firstMetric(registry: SemanticRegistry, variant: ChartVariant | null): SemanticMetric | null {
  const usable = registry.metrics.filter(
    (metric) => variant === null || (metric.charts as readonly string[]).includes(variant),
  );
  return usable.find((metric) => metric.publicationReady) ?? usable[0] ?? null;
}

/**
 * A characteristic a new block may break its result down by, or null.
 *
 * THE FALLBACK MAY NEVER REACH PAST THE LEGIBILITY CEILING. An earlier version
 * ended `?? registry.dimensions[0]`, which handed back whatever the registry
 * happened to list first — including a characteristic with seventy-two values.
 * The block was created, `canAddBlock` reported the type as offerable, and the
 * document it produced failed `cardinality_ceiling` the moment it was
 * validated: the menu and the factory disagreed about what was possible, which
 * is the one thing the probe exists to prevent.
 *
 * So the search widens in steps and stops at the ceiling. Comfortable first
 * (twelve values or fewer, which is what a chart reads well), then anything the
 * composer will actually draw, then nothing.
 */
function firstDimension(
  registry: SemanticRegistry,
  prefer: SemanticDimension["kind"] | null,
): SemanticDimension | null {
  const drawable = registry.dimensions.filter(
    (dimension) =>
      dimension.values.length > 0
      && dimension.values.length <= EXPERIENCE_LIMITS.dimensionCardinality,
  );
  const comfortable = drawable.filter((dimension) => dimension.values.length <= 12);
  for (const pool of [comfortable, drawable]) {
    if (prefer) {
      const preferred = pool.find((dimension) => dimension.kind === prefer);
      if (preferred) return preferred;
    }
    if (pool.length > 0) return pool[0];
  }
  return null;
}

export type NewBlockRequest = {
  type: BlockType;
  /** The caller's stable identity for this block. Hashed into its id. */
  seed: string;
  order: number;
  registry?: SemanticRegistry | null;
  metricId?: string | null;
  dimensionId?: string | null;
  journeyId?: string | null;
  title?: string | null;
  /**
   * An asset the client already has, plus what it shows. Both are required for
   * an image block: an image with no picture is not a block anybody can judge,
   * and an image with no alternative text is one a client cannot read.
   */
  image?: { assetId: string; alt: string } | null;
};

/**
 * A new block of one type, or null when the study cannot support one.
 *
 * Returning null rather than an invalid block is deliberate: a composer that
 * offers "add a comparison" to a study with no characteristics to compare is
 * offering a dead end, and the catalogue asks this function before it offers
 * the choice.
 */
export function newBlock(request: NewBlockRequest): ExperienceBlock | null {
  const spec = blockSpec(request.type);
  const registry = request.registry ?? null;

  let variant: ChartVariant | null = spec.allowsVisualization ? spec.defaultVariant : null;
  let query: BlockQuerySpec | null = null;

  if (spec.allowsQuery && (spec.requiresQuery || request.metricId)) {
    if (!registry) return null;
    const chosenMetric = request.metricId
      ? registry.metrics.find((metric) => metric.id === request.metricId) ?? null
      : firstMetric(registry, variant);
    if (!chosenMetric) return null;

    // The characteristic is resolved FIRST, because how many of them exist is
    // what decides which drawings are possible. Choosing the drawing first and
    // then discovering the study has nothing to break the result down by is how
    // a block ends up asking a grouped bar chart for two characteristics it
    // was never given.
    const dimension: SemanticDimension | null = request.dimensionId
      ? registry.dimensions.find((entry) => entry.id === request.dimensionId) ?? null
      : firstDimension(registry, request.type === "retention" ? "period" : "segment");
    const available: 0 | 1 = dimension ? 1 : 0;

    if (variant !== null) {
      // The first drawing this block type allows that the RESULT supports and
      // that the query can actually satisfy. All three conditions, or none.
      const usable = (spec.variants as readonly ChartVariant[]).find((candidate) => {
        if (!(chosenMetric.charts as readonly string[]).includes(candidate)) return false;
        const chart = CHART_SPECS[candidate];
        return available >= chart.dimensions.min && available <= chart.dimensions.max;
      });
      if (!usable) return null;
      variant = usable;
    }

    query = defaultQuery(
      chosenMetric,
      variant && CHART_SPECS[variant].dimensions.min >= 1 ? dimension : null,
    );
  }

  if (spec.requiresJourney && !request.journeyId) return null;
  // An image block without a picture cannot be built. This slice has no asset
  // picker, so the catalogue simply does not offer one rather than creating a
  // block the schema would then refuse.
  if (request.type === "image" && !request.image) return null;

  return {
    id: mintId("block", request.seed),
    type: request.type,
    title: request.title ?? (spec.copy === "none" ? null : spec.label),
    copy: { eyebrow: null, body: null, caption: null, items: [] },
    query,
    visualization: variant
      ? { variant, legend: "auto", showValueLabels: true, axisLabel: null }
      : null,
    journeyRef: spec.requiresJourney ? (request.journeyId ?? null) : null,
    image: request.type === "image" ? (request.image ?? null) : null,
    filterRefs: [],
    samplePolicy: INHERIT_SAMPLE_POLICY,
    presentation: {
      emphasis: "normal",
      tone: spec.group === "narrative" ? "voice" : "neutral",
      colorRole: "default",
      showSampleNote: spec.group === "evidence",
      showMethodology: spec.group === "evidence",
    },
    visible: true,
    layout: defaultLayout(request.type, request.order),
  };
}

/**
 * Whether the catalogue may offer this block type for this study.
 *
 * The probe builds a throwaway block with a fixed seed and asks whether it
 * came out valid, so the menu and the factory can never disagree about what is
 * possible — there is no second list of rules to keep in step.
 */
export function canAddBlock(
  type: BlockType,
  registry: SemanticRegistry | null,
  hasJourney = false,
): boolean {
  return (
    newBlock({
      type,
      seed: "catalogue-probe",
      order: 0,
      registry,
      journeyId: hasJourney ? mintId("journey", "catalogue-probe") : null,
    }) !== null
  );
}

export function newPage(seed: string, title: string, order: number): ExperiencePage {
  return {
    id: mintId("page", seed),
    title,
    description: null,
    order,
    visible: true,
    filterRefs: [],
    blocks: [],
  };
}

export function newExperience(options: {
  seed: string;
  title: string;
  studyId: string;
  tenantId: string;
  subtitle?: string | null;
  samplePolicy?: SampleVisibilityPolicy;
  theme?: ExperienceTheme;
}): ExperienceDefinitionV1 {
  return {
    schemaVersion: EXPERIENCE_SCHEMA_VERSION,
    id: mintId("experience", options.seed),
    title: options.title,
    metadata: {
      studyId: options.studyId,
      tenantId: options.tenantId,
      subtitle: options.subtitle ?? null,
      locale: "es-MX",
    },
    // A NEW experience shows everything from one answer. The owner's decision,
    // applied where it belongs: to work that has not been composed yet.
    sampleVisibilityPolicy: options.samplePolicy ?? { ...DEFAULT_SAMPLE_POLICY },
    theme: options.theme ?? { ...DEFAULT_THEME },
    pages: [],
    filterDefinitions: [],
    filterConnections: [],
    journeyReferences: [],
    review: { ...NEW_REVIEW },
    publication: { ...UNPUBLISHED },
  };
}
