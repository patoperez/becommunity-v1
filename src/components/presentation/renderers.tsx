/**
 * THE RENDERER REGISTRY — one component per implemented variant, and no default.
 *
 * The keys of this map ARE the capability claim. `src/lib/composer/renderer-
 * capabilities.ts` declares which variants this build draws; the composer gate
 * asserts that this map's keys are exactly that declared set, in both
 * directions. Adding a component without declaring it, or declaring one without
 * writing it, is a gate failure rather than a silent capability change.
 *
 * THERE IS NO FALLBACK ENTRY, and that is the point. A `default:` branch that
 * drew a table for an unknown variant would mean the editor could offer
 * something, the resolver could accept it, and a client could be shown a
 * different drawing than the document describes — which is the substitution the
 * brief forbids. An unmapped variant renders nothing on a client surface and an
 * honest internal placeholder in Studio.
 */

import type { ChartVariant } from "@/lib/presentation";
import type { RenderBlock } from "@/lib/presentation";
import type { PresentationAudience } from "./absence";
import { BarHorizontal, BarVertical, StackedBar, TableBlock } from "./Distribution";
import { FilterControl } from "./FilterControls";
import { JourneyRouteMap } from "./Journey";
import { PeriodCards } from "./Periods";
import { Callout, Gauge, KpiValue, Narrative } from "./Simple";
import { TermRanking, WordCloud } from "./Terms";

export type LeafRenderer = (props: {
  block: RenderBlock;
  audience: PresentationAudience;
}) => React.ReactNode;

export const RENDERERS: Record<ChartVariant, LeafRenderer> | Partial<Record<ChartVariant, LeafRenderer>> = {
  bar_horizontal: BarHorizontal,
  bar_vertical: BarVertical,
  callout: Callout,
  filter_control: FilterControl,
  gauge: Gauge,
  journey_route_map: JourneyRouteMap,
  kpi_value: (props) => KpiValue(props),
  kpi_with_base: (props) => KpiValue({ ...props, withBase: true }),
  narrative: Narrative,
  period_cards: PeriodCards,
  stacked_bar: StackedBar,
  table: TableBlock,
  term_ranking: TermRanking,
  word_cloud: WordCloud,
};

/** The keys, as data a gate can compare against the declared table. */
export const RENDERED_VARIANTS: readonly string[] = Object.freeze(Object.keys(RENDERERS).sort());
