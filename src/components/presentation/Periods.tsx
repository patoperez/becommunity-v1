/**
 * THE PERIOD CARDS — the approved reading of a series.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY A SERIES IS NOT A BAR CHART.
 *
 * The approved dashboard draws retention and attrition as a GRID OF PERIOD
 * CARDS: one card per period, the period's name, then each of its measures as
 * its own figure above its own meter. It is not a column chart and it is not a
 * line, and the difference is not decoration.
 *
 * A `series` point carries SEVERAL measures — retention and attrition are two
 * results of the same period, resolved together so they cannot drift out of
 * step. Every drawing that puts one value on one mark has to choose one of them
 * and drop the rest. `bar_vertical` was bound to the approved retention block
 * and drew nothing at all: its row extractor knows `categories`, `terms`,
 * `cohorts` and `instrument_bases`, returns `[]` for a series, and the block
 * rendered as a heading, a description, and a blank.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * NO VERDICT, AND NO THRESHOLD.
 *
 * The approved section carries no judgement colour, because there is no
 * universal "good" retention and a card that coloured itself would be inventing
 * one. The tones here separate the MEASURES from each other — the first measure
 * reads in one hue throughout the section, the second in another — and mean
 * nothing else. A card is marked as the latest only when the payload's own
 * order says it is last.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THE METER IS ALLOWED TO BE.
 *
 * A length. `RenderValue.formatted` is the only thing printed; the meter takes
 * its width from `value.value` when the unit is already a 0-100 scale, and from
 * the ratio to the longest value in the same measure otherwise — the identical
 * geometry `BarVertical` uses for a count. A ratio past 100 pins the meter at
 * full and the exact figure is still printed above it, unclamped, exactly as the
 * gauge does: clamping is for the drawing, never for the number.
 */

import type { RenderBlock, RenderMeasure, RenderSeriesPoint } from "@/lib/presentation";
import { AbsenceNotice, type PresentationAudience } from "./absence";
import { BaseLine, Figure } from "./primitives";
import { categoryMark, unitIsHundredScale } from "./vocabulary";

type LeafProps = { block: RenderBlock; audience: PresentationAudience };

/**
 * Is there anything in this period a client may be shown?
 *
 * The same rule the table uses, and it is contract C11: a period with no value
 * and no stated absence would render as a labelled empty card — the reader told
 * a measurement happened and shown nothing. Studio keeps every period, because
 * seeing which ones were withheld is the whole point of an internal preview.
 */
function pointHasClientContent(point: RenderSeriesPoint): boolean {
  return point.measures.some(
    (measure) =>
      measure.value !== null ||
      measure.absence?.state === "unavailable" ||
      measure.absence?.state === "unresolved",
  );
}

/** The longest value across one measure, so a meter has a track to be a share of. */
function longestOf(points: readonly RenderSeriesPoint[], index: number): number {
  let longest = 0;
  for (const point of points) {
    const value = point.measures[index]?.value;
    if (value && value.value > longest) longest = value.value;
  }
  return longest;
}

/**
 * The meter's width, as a percentage of its track.
 *
 * Percent-scaled units are already the length: a retention of 82.4 is 82.4% of
 * the track, which is what the approved dashboard draws. Anything else is a
 * share of the longest value in the same measure, so six counts of different
 * magnitudes still compare against one ruler.
 */
function meterWidth(measure: RenderMeasure, longest: number): number {
  const value = measure.value;
  if (!value) return 0;
  const raw = unitIsHundredScale(value.unit) ? value.value : longest <= 0 ? 0 : (value.value / longest) * 100;
  return raw < 0 ? 0 : raw > 100 ? 100 : raw;
}

export function PeriodCards({ block, audience }: LeafProps) {
  const payload = block.payload;
  if (payload.shape !== "series") return null;

  const visible = audience === "client" ? payload.points.filter(pointHasClientContent) : payload.points;
  if (visible.length === 0) return null;

  // The latest period is the one the payload's own order puts last. It is read
  // from the VISIBLE set, so a withheld final period does not leave the emphasis
  // on a card that is no longer the most recent one on screen.
  const latest = visible.reduce((max, point) => (point.order > max ? point.order : max), visible[0].order);
  const measureCount = Math.max(...visible.map((point) => point.measures.length));
  const longest = Array.from({ length: measureCount }, (_, index) => longestOf(visible, index));

  return (
    <ul className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(9.5rem,1fr))]">
      {visible.map((point) => {
        const isLatest = point.order === latest;
        return (
          <li
            key={`${point.order}-${point.label}`}
            className={`min-w-0 rounded-xl border p-3.5 ${
              isLatest ? "border-evidence-line bg-surface shadow-sm" : "border-line bg-surface-sunken"
            }`}
          >
            <p className="min-h-[2.2em] text-[0.72rem] font-semibold leading-snug text-muted [overflow-wrap:anywhere]">
              {point.label}
            </p>
            {point.measures.map((measure, index) => {
              const tone = categoryMark(index);
              return (
                <div key={measure.label} className={index === 0 ? "mt-1.5" : "mt-3"}>
                  <p
                    className={`font-display font-bold leading-none ${index === 0 ? "text-[1.5rem]" : "text-[1.1rem]"}`}
                    style={{ color: tone }}
                  >
                    {measure.value ? (
                      <Figure value={measure.value} />
                    ) : measure.absence ? (
                      <AbsenceNotice absence={measure.absence} audience={audience} />
                    ) : null}
                  </p>
                  {measure.value ? (
                    <div
                      className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-line"
                      aria-hidden="true"
                    >
                      <i
                        className="block h-full rounded-full transition-[width] duration-[var(--motion-content)] ease-brand motion-reduce:transition-none"
                        style={{ width: `${meterWidth(measure, longest[index] ?? 0)}%`, backgroundColor: tone }}
                      />
                    </div>
                  ) : null}
                  <p className="mt-1 text-[0.7rem] lowercase text-muted [overflow-wrap:anywhere]">
                    {measure.label}
                  </p>
                </div>
              );
            })}
            {point.base ? <BaseLine base={point.base} className="mt-2.5" /> : null}
          </li>
        );
      })}
    </ul>
  );
}
