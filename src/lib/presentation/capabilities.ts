/**
 * THE CLOSED PRESENTATION VOCABULARY — what a surface may ask for, and nothing else.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THIS FILE IS FOR.
 *
 * `src/lib/results/contract.ts` says what the server DECIDED. This file says
 * what a presentation may ASK FOR. Both are closed sets, and the gap between
 * them is deliberate: a dashboard that could name an arbitrary quantity would,
 * sooner or later, name one nobody calculated — and then compute it itself.
 *
 * Every type here is a UNION OF LITERALS. Not a string, not a record keyed by
 * an open string, not a numeric enum. A semantic that is not on the list cannot
 * be written down, so a block asking for one fails at validation rather than at
 * render time in front of a client.
 *
 * NOTHING HERE IS A FORMULA. There is no expression, no operator, no
 * denominator and no threshold. A `PresentationSemantic` NAMES a quantity the
 * canonical layer already produced; it does not describe how to produce one.
 * That is the whole reason this layer is allowed to exist.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import type { ResultUnit } from "../results/contract";

/**
 * The SHAPE version of the presentation vocabulary and of the registry built
 * from it. Bump when a member is added, removed or re-typed.
 *
 * Separate from `CANONICAL_RESULTS_CONTRACT_VERSION` because they answer
 * different questions: that one moves when the RESULTS change shape, this one
 * moves when what a surface may ASK FOR changes. A registry records both, so a
 * stored presentation can always be told which pair it was authored against.
 */
export const CANONICAL_PRESENTATION_REGISTRY_VERSION = "1.0.0";

/**
 * A quantity a presentation may name.
 *
 * Each member corresponds to something the canonical results document already
 * carries as a finished value, distribution, series or aggregate. Adding a
 * member is a deliberate act that must be matched by a binding in `registry.ts`;
 * the gate fails on a semantic with no binding and on a binding with no
 * semantic, so the two cannot drift apart.
 */
export type PresentationSemantic =
  /** Recommendation score for one declared scope. */
  | "recommendation_score"
  /** Promoters / passives / detractors for one declared scope. */
  | "recommendation_distribution"
  /** The renewal (churn-risk) composite index. */
  | "renewal_index"
  /** The documented renewal response rungs and their counts. */
  | "renewal_distribution"
  /** Retention for one declared period. */
  | "retention_rate"
  /** Attrition for one declared period. */
  | "attrition_rate"
  /** Retention and attrition across every declared period, in the source's order. */
  | "retention_series"
  /** The study population headline. */
  | "population_total"
  /** People with at least one measured datum. Different from the total, on purpose. */
  | "population_measured"
  /** Per-cohort participation accounting. */
  | "population_cohorts"
  /** Per-instrument base accounting. */
  | "instrument_base"
  /** One touchpoint's own satisfaction result. */
  | "touchpoint_satisfaction"
  /** TDP — unawareness over the valid base. A ratio, and it may exceed 100. */
  | "touchpoint_process_unawareness"
  /** The auxiliary unawareness proportion over every classified response. */
  | "touchpoint_unawareness_share"
  /** One SOURCE journey group, with the touchpoints the source placed in it. */
  | "journey_group"
  /** One measured touchpoint as a structural thing a route may list. */
  | "journey_touchpoint"
  /** Curated qualitative categories and their counts for one group. */
  | "qualitative_terms"
  /** One performance dimension across its declared periods. */
  | "performance_series"
  /** A dimension a surface may offer as a filter control. */
  | "filter_dimension"
  /** Content the contract says a human or a configuration supplies. */
  | "editorial_slot";

/**
 * How a block may DRAW a semantic.
 *
 * A variant is a drawing instruction, never a data transformation: `donut` says
 * "render these already-final shares as a ring", not "compute shares".
 */
export type ChartVariant =
  | "kpi_value"
  | "kpi_with_base"
  | "gauge"
  | "donut"
  | "pie"
  | "stacked_bar"
  | "bar_vertical"
  | "bar_horizontal"
  | "line"
  | "area"
  | "table"
  | "word_cloud"
  | "term_ranking"
  | "callout"
  | "narrative"
  | "journey_route_map"
  | "touchpoint_matrix"
  | "filter_control";

/**
 * Whether a value is there, and if not, in which of the contract's senses.
 *
 * The first three mirror `ResultStatus` exactly and are NOT collapsed: an
 * unavailable result and an unresolved one are different facts and a client
 * surface must be able to say which. `configuration_required` is the fourth
 * state the contract carries separately — a settled answer ("this is not
 * calculated, and here is who supplies it"), never a defect.
 */
export type PresentationAvailability =
  | "available"
  | "unavailable"
  | "unresolved"
  | "configuration_required";

/**
 * WHERE a number came from, at the coarseness a client may be told.
 *
 * Deliberately coarser than `ResultInternalProvenance`: that type carries the
 * canonical metric key, the source families and the authority statements, and
 * none of those may cross this boundary. This says only enough for an honest
 * caption.
 */
export type ProvenanceCategory =
  /** Calculated by a canonical function over measured answers. */
  | "measured_aggregate"
  /** A count the source itself stated, carried through unchanged. */
  | "source_reported"
  /** A share of a stated base, rounded once by the canonical layer. */
  | "derived_share"
  /** Counts of curated categories a reviewer assigned. */
  | "curated_category"
  /** Supplied by a human as editorial content. */
  | "editorial"
  /** Supplied by study or template configuration. */
  | "study_configuration";

/**
 * How much of the method a block may disclose.
 *
 * There is deliberately NO level that discloses a formula. The highest level
 * renders the contract's own client-safe `explanation` prose beside the base the
 * result rests on — which is what makes a number honest — and stops there.
 * `ResultInternalProvenance` has no level at all: no disclosure setting reaches
 * it, which is why "reveal the method" and "reveal the formula" stay different
 * requests.
 */
export type MethodologyDisclosureLevel =
  /** Draw the value alone. */
  | "none"
  /** Draw the value and the base it rests on. */
  | "base_only"
  /** Draw the value and the contract's client-safe explanation. */
  | "plain_language"
  /** Both the explanation and the base. The most a client may ever be shown. */
  | "plain_language_with_base";

/** Every disclosure level, in a fixed order, so a gate can pin the set. */
export const METHODOLOGY_DISCLOSURE_LEVELS: readonly MethodologyDisclosureLevel[] = [
  "none",
  "base_only",
  "plain_language",
  "plain_language_with_base",
] as const;

/**
 * WHICH VARIANTS MAY DRAW WHICH SEMANTIC.
 *
 * The table is exhaustive over `PresentationSemantic` — TypeScript enforces
 * that, and a gate re-checks it at runtime so a semantic added without a row
 * cannot ship. A filter dimension is a CONTROL rather than a chart, so its only
 * compatible variant is `filter_control`, and the resolver refuses any other.
 */
export const COMPATIBLE_CHART_VARIANTS: Readonly<Record<PresentationSemantic, readonly ChartVariant[]>> = {
  recommendation_score: ["kpi_value", "kpi_with_base", "gauge", "callout"],
  recommendation_distribution: ["donut", "pie", "stacked_bar", "bar_vertical", "bar_horizontal", "table"],
  renewal_index: ["kpi_value", "kpi_with_base", "gauge", "callout"],
  renewal_distribution: ["stacked_bar", "bar_horizontal", "bar_vertical", "donut", "table"],
  retention_rate: ["kpi_value", "kpi_with_base", "callout"],
  attrition_rate: ["kpi_value", "kpi_with_base", "callout"],
  retention_series: ["line", "area", "bar_vertical", "table"],
  population_total: ["kpi_value", "callout"],
  population_measured: ["kpi_value", "callout"],
  population_cohorts: ["bar_horizontal", "donut", "table"],
  instrument_base: ["table", "bar_horizontal"],
  touchpoint_satisfaction: ["kpi_value", "kpi_with_base", "bar_horizontal", "table", "touchpoint_matrix"],
  touchpoint_process_unawareness: ["kpi_value", "kpi_with_base", "bar_horizontal", "table", "touchpoint_matrix"],
  touchpoint_unawareness_share: ["kpi_value", "bar_horizontal", "table"],
  journey_group: ["journey_route_map", "touchpoint_matrix", "table"],
  journey_touchpoint: ["touchpoint_matrix", "table", "callout"],
  qualitative_terms: ["word_cloud", "term_ranking", "table"],
  performance_series: ["line", "area", "bar_vertical", "table"],
  filter_dimension: ["filter_control"],
  editorial_slot: ["narrative", "callout"],
} as const;

/**
 * THE UNIT EACH SEMANTIC IS ALREADY EXPRESSED IN.
 *
 * Declared here so the registry can state a block's display format WITHOUT
 * reading a value — an unavailable result still has the unit its presentation
 * would use. When a value IS present the registry cross-checks the two, and the
 * gate fails on a mismatch: a table that drifts from the contract is how a ratio
 * that may exceed 100 ends up drawn on a 0..100 axis.
 *
 * `touchpoint_process_unawareness` is `ratio` and NOT `percent`. That is the
 * entire point of the distinction: TDP is a ratio over the valid base, it may
 * exceed 100, and nothing in this layer clamps it.
 */
export const SEMANTIC_UNITS: Readonly<Record<PresentationSemantic, readonly ResultUnit[]>> = {
  recommendation_score: ["nps"],
  recommendation_distribution: ["count", "percent"],
  renewal_index: ["index"],
  renewal_distribution: ["count", "percent"],
  retention_rate: ["percent"],
  attrition_rate: ["percent"],
  retention_series: ["percent", "count"],
  population_total: ["count"],
  population_measured: ["count"],
  population_cohorts: ["count"],
  instrument_base: ["count"],
  touchpoint_satisfaction: ["percent"],
  touchpoint_process_unawareness: ["ratio"],
  touchpoint_unawareness_share: ["percent"],
  journey_group: ["count"],
  journey_touchpoint: ["count"],
  qualitative_terms: ["count", "percent"],
  performance_series: ["score"],
  filter_dimension: ["count"],
  editorial_slot: [],
} as const;

/**
 * Every semantic, in codepoint order, so a gate can walk the set exhaustively
 * and two runs enumerate it identically.
 */
export const PRESENTATION_SEMANTICS: readonly PresentationSemantic[] = (
  Object.keys(COMPATIBLE_CHART_VARIANTS) as PresentationSemantic[]
)
  .slice()
  .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

/** True when `variant` may draw `semantic`. The resolver's only compatibility test. */
export function chartVariantIsCompatible(semantic: PresentationSemantic, variant: ChartVariant): boolean {
  return COMPATIBLE_CHART_VARIANTS[semantic].includes(variant);
}
