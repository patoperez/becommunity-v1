/**
 * WHAT THE RENDERER CAN ACTUALLY DRAW — an implementation fact, kept apart from
 * the authority rule it is constantly mistaken for.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * TWO TABLES, TWO DIFFERENT KINDS OF TRUTH.
 *
 * `COMPATIBLE_CHART_VARIANTS` in `src/lib/presentation/capabilities.ts` says
 * which variants MAY HONESTLY DRAW a semantic. It is a statement about meaning:
 * a recommendation distribution may be a stacked bar because the parts sum to
 * the whole, and may not be a gauge because a gauge draws one number. That
 * table does not know or care whether a component exists.
 *
 * This table says which of them A COMPONENT ACTUALLY DRAWS. It is a statement
 * about this build, and it changes when somebody writes a file.
 *
 * The editor offers the INTERSECTION, and a variant outside it is refused with
 * a sentence naming which of the two tables refused it — because "this cannot
 * be drawn honestly" and "nobody has written this yet" are different problems
 * with different remedies.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY IT IS KEYED BY SEMANTIC AND NOT BY VARIANT.
 *
 * The first version was a flat list of thirteen variant names, and it was
 * wrong in a way that took an adversarial pass to see: DRAWABILITY IS NOT A
 * PROPERTY OF A VARIANT. It is a property of the PAIR (variant, payload shape),
 * and the payload shape follows from the semantic.
 *
 * `bar_vertical` genuinely draws a `categories` payload and genuinely draws
 * nothing at all for a `series` one — and `retention_series` offered exactly
 * that pairing. `table` is compatible with a touchpoint, a journey group and a
 * lone value, and the component handled none of the three. In each case the
 * editor offered the variant, the resolver accepted it, the client-visibility
 * gate saw a non-empty payload and let the block through, and the reader got a
 * titled card over nothing. A capability table that cannot express "this
 * variant, for THIS quantity" cannot prevent that.
 *
 * So each semantic lists the variants this build draws FOR IT. Two rules keep
 * the table honest, both asserted by `scripts/canonical-composer-test.mjs`:
 *
 *   1. every variant listed here is compatible with its semantic — this table
 *      may narrow the authority's list and may never widen it;
 *   2. every (semantic, variant) pair listed here, rendered against the gate's
 *      fixture, produces visible output — an entry that draws nothing is a
 *      claim the build does not honour.
 *
 * A semantic mapped to an EMPTY list is a deliberate statement that this build
 * draws nothing for it yet. The editor then refuses to add such a block at all,
 * with a sentence saying so, rather than adding one that renders as a gap.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { COMPATIBLE_CHART_VARIANTS, type ChartVariant, type PresentationSemantic } from "../presentation";

/**
 * For each semantic, the variants this build genuinely draws.
 *
 * Deliberately ABSENT everywhere, and absent is not "coming soon": `donut` and
 * `pie` (a ring is a worse bar, and the approved dashboard rejected both),
 * `line` and `area` (the only series in the contract is retention, which the
 * approved dashboard draws as period cards and this build draws as a table),
 * and `touchpoint_matrix` (a grid of 55 touchpoints is the thing the journey
 * route map replaced). Each stays semantically compatible; none is offered.
 *
 * `journey_group` is empty because its payload is a label and a count, and the
 * two variants the authority allows for it — a route map and a touchpoint
 * matrix — both need the touchpoints themselves, which that payload does not
 * carry. A journey is drawn by a `journey_routes` BLOCK, not by binding a
 * result block to a group.
 */
export const IMPLEMENTED_BY_SEMANTIC: Readonly<Record<PresentationSemantic, readonly ChartVariant[]>> = Object.freeze({
  recommendation_score: Object.freeze(["kpi_value", "kpi_with_base", "gauge", "callout"] as const),
  recommendation_distribution: Object.freeze(["stacked_bar", "bar_vertical", "bar_horizontal", "table"] as const),
  renewal_index: Object.freeze(["kpi_value", "kpi_with_base", "gauge", "callout"] as const),
  renewal_distribution: Object.freeze(["stacked_bar", "bar_horizontal", "bar_vertical", "table"] as const),
  retention_rate: Object.freeze(["kpi_value", "kpi_with_base", "callout"] as const),
  attrition_rate: Object.freeze(["kpi_value", "kpi_with_base", "callout"] as const),
  // `bar_vertical` is compatible and is NOT offered: it draws a categories
  // payload, and a series is periods of measures, which it has no row for.
  // `period_cards` reads a period as a unit: several measures, each with its
  // own figure and meter. It leads because a series point carries retention AND
  // attrition, and every drawing that puts one value on one mark must drop one
  // of them. `bar_vertical` and `line` stay compatible-but-undrawn: honest
  // about the gap rather than substituting a picture nobody chose.
  retention_series: Object.freeze(["period_cards", "table"] as const),
  performance_series: Object.freeze(["period_cards", "table"] as const),
  population_total: Object.freeze(["kpi_value", "callout"] as const),
  population_measured: Object.freeze(["kpi_value", "callout"] as const),
  population_cohorts: Object.freeze(["bar_horizontal", "table"] as const),
  instrument_base: Object.freeze(["table", "bar_horizontal"] as const),
  // A touchpoint figure is one value: the bars have no row shape for it.
  touchpoint_satisfaction: Object.freeze(["kpi_value", "kpi_with_base", "table"] as const),
  touchpoint_process_unawareness: Object.freeze(["kpi_value", "kpi_with_base", "table"] as const),
  touchpoint_unawareness_share: Object.freeze(["kpi_value", "table"] as const),
  journey_group: Object.freeze([] as const),
  journey_touchpoint: Object.freeze(["table", "callout"] as const),
  qualitative_terms: Object.freeze(["word_cloud", "term_ranking", "table"] as const),
  filter_dimension: Object.freeze(["filter_control"] as const),
  editorial_slot: Object.freeze(["narrative", "callout"] as const),
});

/**
 * What a `journey_routes` BLOCK may be drawn as.
 *
 * Its capability does not come from a semantic, because it is not bound to one.
 * A routes payload is a presentation decision — which touchpoints each route
 * carries — and one component draws it. A RESULT block bound to the same group
 * resolves to `journey_group`, a label and a count, which the route map cannot
 * draw at all; that is why `journey_group` above is empty and this is separate.
 */
export const JOURNEY_ROUTES_VARIANTS: readonly ChartVariant[] = Object.freeze(["journey_route_map"]);

/**
 * Every variant this build has a component for, from either source.
 *
 * Derived, never written twice: the component registry is asserted against
 * exactly this set, so a component nothing offers, and something offered with
 * no component, are both gate failures.
 */
export const IMPLEMENTED_CHART_VARIANTS: readonly ChartVariant[] = Object.freeze(
  [...new Set([...Object.values(IMPLEMENTED_BY_SEMANTIC).flat(), ...JOURNEY_ROUTES_VARIANTS])].sort(),
);

const IMPLEMENTED = new Set<string>(IMPLEMENTED_CHART_VARIANTS);

/** Is there a component for this variant anywhere in this build? */
export function chartVariantIsImplemented(variant: string): variant is ChartVariant {
  return IMPLEMENTED.has(variant);
}

/**
 * The only list an editor may offer: compatible AND drawn FOR THIS SEMANTIC.
 *
 * Order follows `COMPATIBLE_CHART_VARIANTS`, which is the authority's order, so
 * the first offered variant is the authority's first choice rather than an
 * alphabetical accident. The shared frozen arrays are never sorted in place.
 */
export function offeredChartVariants(semantic: PresentationSemantic): readonly ChartVariant[] {
  const compatible = COMPATIBLE_CHART_VARIANTS[semantic] ?? [];
  const drawn = IMPLEMENTED_BY_SEMANTIC[semantic] ?? [];
  return compatible.filter((variant) => drawn.includes(variant));
}

/** Why a variant was not offered. Three different problems, never merged. */
export type VariantRefusal =
  /** The authority says this drawing would misrepresent this quantity. */
  | { reason: "incompatible_with_semantic" }
  /** The drawing is honest; this build draws nothing for this quantity with it. */
  | { reason: "not_implemented" };

/**
 * Judge a variant for a semantic. `null` means it may be offered.
 *
 * Compatibility is tested FIRST, so a variant that is both dishonest and
 * undrawn is reported as dishonest — that is the finding that matters, and
 * implementing it would not make it offerable.
 */
export function judgeChartVariant(
  semantic: PresentationSemantic,
  variant: string,
): VariantRefusal | null {
  const compatible = COMPATIBLE_CHART_VARIANTS[semantic] ?? [];
  if (!compatible.includes(variant as ChartVariant)) return { reason: "incompatible_with_semantic" };
  const drawn = IMPLEMENTED_BY_SEMANTIC[semantic] ?? [];
  if (!drawn.includes(variant as ChartVariant)) return { reason: "not_implemented" };
  return null;
}
