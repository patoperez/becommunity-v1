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
 * This table says which variants A COMPONENT EXISTS FOR. It is a statement
 * about this build, and it changes when somebody writes a file.
 *
 * Collapsing the two is the defect this file exists to prevent. If the editor
 * offered `COMPATIBLE_CHART_VARIANTS` alone, an author could pick `donut` for a
 * distribution — semantically impeccable — and the block would resolve cleanly,
 * cross the boundary intact, and render as a blank card in front of a client.
 * If instead the renderer quietly substituted a bar for the donut, the author's
 * choice would have been overruled by software, silently, and the page would
 * disagree with the document that describes it.
 *
 * So the editor offers the INTERSECTION, and nothing else is offered anywhere:
 *
 *     offered(semantic) = COMPATIBLE_CHART_VARIANTS[semantic] ∩ IMPLEMENTED
 *
 * and a variant outside the intersection is refused with a sentence naming
 * which of the two tables refused it — because "this cannot be drawn honestly"
 * and "nobody has written this yet" are different problems with different
 * remedies, and an author who cannot tell them apart will file the wrong one.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THE LIST IS WRITTEN DOWN RATHER THAN DERIVED.
 *
 * It would be tidier to export `Object.keys(RENDERERS)` from the component
 * registry and call that the table. It would also make this file follow the
 * components wherever they go: delete a renderer by accident and the table
 * silently agrees that the variant was never implemented, the editor stops
 * offering it, and every existing block bound to it becomes unofferable without
 * one gate going red.
 *
 * The list is therefore DECLARED here, and `scripts/canonical-composer-test.mjs`
 * asserts that the component registry's keys are exactly this set. Drift in
 * either direction is a gate failure rather than a quiet capability change.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { COMPATIBLE_CHART_VARIANTS, type ChartVariant, type PresentationSemantic } from "../presentation";

/**
 * The thirteen variants Unit 6B.1 ships a renderer for.
 *
 * Ten of them are what the approved blueprint uses; `narrative`, `callout` and
 * `filter_control` are the three the blueprint implies rather than names —
 * editorial prose, an editorial aside, and the controls a filter panel offers.
 *
 * Deliberately ABSENT, and absent is not "coming soon": `donut` and `pie`
 * (a ring is a worse bar and the approved dashboard rejected both), `line` and
 * `area` (the only series in the contract is retention, which the approved
 * dashboard draws as period cards), and `touchpoint_matrix` (a grid of 55
 * touchpoints is the thing the journey route map replaced). Each remains
 * semantically compatible; none is offered.
 */
export const IMPLEMENTED_CHART_VARIANTS: readonly ChartVariant[] = Object.freeze([
  "bar_horizontal",
  "bar_vertical",
  "callout",
  "filter_control",
  "gauge",
  "journey_route_map",
  "kpi_value",
  "kpi_with_base",
  "narrative",
  "stacked_bar",
  "table",
  "term_ranking",
  "word_cloud",
]);

const IMPLEMENTED = new Set<string>(IMPLEMENTED_CHART_VARIANTS);

/** Is there a component for this variant in this build? */
export function chartVariantIsImplemented(variant: string): variant is ChartVariant {
  return IMPLEMENTED.has(variant);
}

/**
 * The only list an editor may offer: compatible AND implemented.
 *
 * Order follows `COMPATIBLE_CHART_VARIANTS`, which is the authority's order, so
 * the first offered variant is the authority's first choice rather than an
 * alphabetical accident. The shared frozen array is never sorted in place —
 * every entry of a semantic holds the same reference.
 */
export function offeredChartVariants(semantic: PresentationSemantic): readonly ChartVariant[] {
  const compatible = COMPATIBLE_CHART_VARIANTS[semantic] ?? [];
  return compatible.filter((variant) => IMPLEMENTED.has(variant));
}

/** Why a variant was not offered. Two different problems, never merged. */
export type VariantRefusal =
  /** The authority says this drawing would misrepresent this quantity. */
  | { reason: "incompatible_with_semantic" }
  /** The drawing is honest; this build has no component for it. */
  | { reason: "not_implemented" };

/**
 * Judge a variant for a semantic. `null` means it may be offered.
 *
 * Compatibility is tested FIRST, so a variant that is both dishonest and
 * unimplemented is reported as dishonest — that is the finding that matters,
 * and implementing it would not make it offerable.
 */
export function judgeChartVariant(
  semantic: PresentationSemantic,
  variant: string,
): VariantRefusal | null {
  const compatible = COMPATIBLE_CHART_VARIANTS[semantic] ?? [];
  if (!compatible.includes(variant as ChartVariant)) return { reason: "incompatible_with_semantic" };
  if (!IMPLEMENTED.has(variant)) return { reason: "not_implemented" };
  return null;
}
