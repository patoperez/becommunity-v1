/**
 * The semantic registry — the allowlist a composed experience is allowed to
 * point at.
 *
 * THE SEPARATION THIS FILE EXISTS TO ENFORCE.
 *
 *   TRUTH        imported respondents, imported answers, the canonical
 *                calculations in `src/lib/calc/**`, tenant access. Not
 *                editable from the composer, not reachable from a definition.
 *
 *   MEANING      which results a study genuinely has, what they are called in
 *                a person's own words, which characteristics may segment them,
 *                which of them a journey may carry. Edited only through the
 *                governed workflows that already exist — the import mapper, the
 *                category review, the qualitative review, the recorrido editor.
 *                THIS FILE is the read-only contract over that layer.
 *
 *   PRESENTATION pages, blocks, layout, charts, filters, copy. Fully editable
 *                in the composer, and it references meaning only by ID.
 *
 * A block therefore never carries a metric key, a column name, a table name or
 * anything else a database would recognize. It carries a `metricId` that must
 * be PRESENT IN THE REGISTRY the server built for that study; an id that is not
 * in the registry is rejected, whatever it looks like. Validation is membership,
 * never pattern-matching, so no clever string gets through by resembling a
 * legitimate one.
 *
 * GENERIC CODE STAYS GENERIC. There is not one client-specific key in this
 * file, and there must never be one. Everything a particular client measures
 * arrives as registry DATA, built per study. `src/lib/experience/fixtures.ts`
 * shows that the concepts a real membership organisation cares about can be
 * expressed this way; it is a demonstration fixture and no production path
 * imports it.
 */

import type { SamplePolicyOverride } from "./sample-policy";

/**
 * Families group results by what they are ABOUT, so a composer can offer "the
 * satisfaction results" without knowing any client's column names, and so a
 * journey can declare that it carries one family and nothing else.
 */
export const METRIC_FAMILIES = [
  "satisfaction",
  "recommendation",
  "retention",
  "roi",
  "culture",
  "participation",
  "composition",
  "awareness",
  "other",
] as const;
export type MetricFamily = (typeof METRIC_FAMILIES)[number];

/**
 * The scale a number lives on. It decides formatting and which comparisons are
 * honest; it never decides how the number is computed.
 */
export const METRIC_UNITS = [
  "score",
  "percent",
  "nps",
  "count",
  "currency",
  "ratio",
  "index",
  "band",
] as const;
export type MetricUnit = (typeof METRIC_UNITS)[number];

/**
 * What a block may ask the engine to do with a result.
 *
 * `net_score` and `top_box` are CANONICAL COMPOSITE results, not arithmetic a
 * composer invents: they exist here so a registry entry can declare that a
 * particular result is computed that way, and a block may select one only when
 * the registry says so. Nothing in this list lets an operator author a formula.
 */
export const AGGREGATIONS = [
  "value",
  "average",
  "sum",
  "count",
  "share",
  "min",
  "max",
  "net_score",
  "top_box",
] as const;
export type Aggregation = (typeof AGGREGATIONS)[number];

/** How a number is written down. Declared per result, overridable per block. */
export type NumberFormat = {
  /** Decimals. The canonical `roundTo` still owns the rounding itself. */
  decimals: number;
  /** A unit written after the number, from a closed set. Never free CSS. */
  suffix: "none" | "percent" | "points" | "currency_mxn" | "people";
  /** Whether thousands are grouped. */
  grouped: boolean;
};

export const DEFAULT_NUMBER_FORMAT: NumberFormat = {
  decimals: 1,
  suffix: "none",
  grouped: true,
};

/**
 * How a result behaves with respect to disclosure, independent of any study
 * policy. `aggregate_only` is the floor for everything: no registry entry may
 * ever expose a respondent row, and there is no value of this field that lets
 * one.
 */
export const METRIC_PRIVACY = ["aggregate_only"] as const;
export type MetricPrivacy = (typeof METRIC_PRIVACY)[number];

export type SemanticMetric = {
  /** Stable identifier inside this registry. Never typed by an operator. */
  id: string;
  /** What it is called on screen. */
  label: string;
  /** The question it answers, in the words a consultant would say. */
  question: string;
  /** What it measures and any caveat worth carrying with it. */
  description: string;
  /** Where the number comes from, said in words, for the methodology note. */
  source: string;
  family: MetricFamily;
  unit: MetricUnit;
  format: NumberFormat;
  /** Everything a block may ask for. Anything else is a hard error. */
  aggregations: readonly Aggregation[];
  defaultAggregation: Aggregation;
  /** Visualizations this result can honestly appear in. */
  charts: readonly string[];
  /** Whether it may be offered as a filter. */
  filterEligible: boolean;
  /** Whether a journey moment may point at it. */
  journeyEligible: boolean;
  privacy: MetricPrivacy;
  /** A stricter disclosure behaviour this result carries wherever it appears. */
  samplePolicy: SamplePolicyOverride | null;
  /** Whether it is finished enough to cross into a client-facing page. */
  publicationReady: boolean;
  /** How many answers the study currently holds for it. */
  responses: number;
  /**
   * THE SCALE THE RESULT IS ACTUALLY ANSWERED ON, read from the study's own
   * imported answers. Null when the study holds none.
   */
  scale: { minimum: number; maximum: number } | null;
  /**
   * The score from which an answer counts as satisfied, for Top-2-Box.
   *
   * IT IS CONFIGURATION, AND IT IS NEVER GUESSED. `docs/CALCULATION_POLICY.md`
   * §5 is explicit that `satisfiedMin` is an explicit input precisely so one
   * canonical function serves a 1–5 scale (min 4) and a 0–10 scale (min 9),
   * and `docs/CALCULATION_CATALOG.md` §4 fixes the 1–5 rule as authoritative:
   * four and five are satisfied, one to three are not, and both are in the
   * denominator.
   *
   * NULL MEANS "DO NOT COMPUTE IT". A result whose scale is neither of the two
   * the catalogue documents has no authoritative Top-2-Box, and the engine
   * refuses to produce one rather than applying a threshold nobody agreed to.
   * That refusal is the whole point of this field: passing the 0–10 default at
   * a study answered 1–5 made every satisfaction result read 0 %, which is a
   * confident wrong number rather than a missing one.
   */
  topBoxMinimum: number | null;
};

/** What a dimension IS, so a chart can decide whether an order is meaningful. */
export const DIMENSION_KINDS = ["segment", "period", "category", "status"] as const;
export type DimensionKind = (typeof DIMENSION_KINDS)[number];

export type SemanticDimension = {
  id: string;
  label: string;
  description: string;
  source: string;
  kind: DimensionKind;
  /** The values the study actually carries, in a stable order. */
  values: readonly { value: string; label: string }[];
  filterEligible: boolean;
  journeyEligible: boolean;
  publicationReady: boolean;
};

/**
 * A registry is always SCOPED. Every id in a definition must resolve inside the
 * registry built for that exact study of that exact tenant, so a reference that
 * would reach across a tenant boundary fails to resolve rather than being
 * caught by a check somebody could forget to write.
 */
export type RegistryScope = { tenantId: string; studyId: string };

export type SemanticRegistry = {
  scope: RegistryScope;
  /**
   * A content stamp over everything below. Approval is invalidated when this
   * changes, because "approved" means somebody approved a page built on THESE
   * results with THESE names.
   */
  registryVersion: string;
  metrics: readonly SemanticMetric[];
  dimensions: readonly SemanticDimension[];
};

export function findMetric(registry: SemanticRegistry, id: string): SemanticMetric | null {
  return registry.metrics.find((metric) => metric.id === id) ?? null;
}

export function findDimension(registry: SemanticRegistry, id: string): SemanticDimension | null {
  return registry.dimensions.find((dimension) => dimension.id === id) ?? null;
}

/** Every result of one family, in registry order. */
export function metricsOfFamily(
  registry: SemanticRegistry,
  family: MetricFamily,
): SemanticMetric[] {
  return registry.metrics.filter((metric) => metric.family === family);
}

/** How many distinct values a dimension carries. */
export function dimensionCardinality(dimension: SemanticDimension): number {
  return dimension.values.length;
}

/**
 * A deterministic stamp over the registry's meaning.
 *
 * Only the fields a composed page DEPENDS ON are folded in: an id, a label, a
 * family, a unit, the allowed aggregations, the eligibility flags, and a
 * dimension's values. Response counts are deliberately excluded — a new answer
 * arriving must not invalidate an approval on its own; that is what the data
 * revision is for.
 */
export function registrySignature(registry: SemanticRegistry): string {
  const metrics = registry.metrics
    .map((metric) =>
      [
        metric.id,
        metric.label,
        metric.family,
        metric.unit,
        [...metric.aggregations].sort().join("+"),
        [...metric.charts].sort().join("+"),
        metric.filterEligible ? "f" : "-",
        metric.journeyEligible ? "j" : "-",
        metric.publicationReady ? "p" : "-",
      ].join("|"),
    )
    .sort();
  const dimensions = registry.dimensions
    .map((dimension) =>
      [
        dimension.id,
        dimension.label,
        dimension.kind,
        dimension.values.map((entry) => `${entry.value}=${entry.label}`).join(","),
        dimension.filterEligible ? "f" : "-",
        dimension.journeyEligible ? "j" : "-",
        dimension.publicationReady ? "p" : "-",
      ].join("|"),
    )
    .sort();
  return [
    `scope:${registry.scope.tenantId}/${registry.scope.studyId}`,
    `metrics:${metrics.join(";")}`,
    `dimensions:${dimensions.join(";")}`,
  ].join("\n");
}
