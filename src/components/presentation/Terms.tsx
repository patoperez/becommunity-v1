"use client";

/**
 * CURATED TERMS — a ranking, and a cloud that cannot overlap itself.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS CLOUD IS LAID OUT BY THE BROWSER AND NOT BY A SPIRAL.
 *
 * The approved dashboard packs its cloud into an SVG along an ellipse, and it
 * can only do that safely because it first renders every term into a hidden SVG
 * and reads `getBBox()` for a true advance width. A spiral packed against
 * ESTIMATED widths — characters times a factor — is a cloud that overlaps on
 * some font, some language, some zoom level, and the QA sweep that catches it is
 * the one nobody ran.
 *
 * So the terms are laid out in ORDINARY FLOW: three grid tracks, with a flex
 * stack in the middle and a turned word on either side. The browser measures
 * everything, which means no overlap and no clipping are POSSIBLE rather than
 * merely tested for — at 320px, at 200% zoom, in any font that loads or fails
 * to load.
 *
 * The shape it makes is the oracle's BLOCK variant, and that composition is a
 * decision the oracle documents rather than a default it fell into. Four terms
 * on a spiral came out as four words adrift in a wide empty box; the fix that
 * was tried first threaded them with dotted connectors, floated them on halos
 * and tilted them at arbitrary angles, which asserted relationships between
 * categories that do not exist. What replaced it — and what is drawn here — is
 * a centred column of the longer words with the shortest one or two standing on
 * their side beside it, closing into one compact silhouette. Type is the only
 * encoding.
 *
 * An earlier version of THIS file turned a word only when there were five or
 * more, so the two clouds that honestly have four categories each rendered
 * entirely horizontal: a list, not a composition.
 *
 * WHAT COUNT IS ALLOWED TO DO. Exactly two things, both named in the brief:
 * pick a font size that rises monotonically with it, and order the terms. Size
 * is `min + (max−min)·√(count/largest)`, so AREA rises in proportion to count
 * rather than height doing so — a term said twice as often should look twice as
 * big, not four times. Nothing here regroups a term, merges two, drops one or
 * changes a count or a share.
 *
 * NO CONNECTOR, NO HALO, NO TILT. A line between two words would assert a
 * relationship the data does not contain. Rotation is exactly 0° or exactly
 * −90°; there is no third angle, and the −90° is done with `writing-mode`
 * rather than a transform so the browser still measures the box it occupies.
 *
 * THE READOUT NEVER MOVES ANYTHING. Hovering, focusing or tapping a term
 * changes a colour and fills a readout panel that is ALWAYS rendered at a fixed
 * minimum size. A layout that reflows under the pointer is a layout you cannot
 * point at.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { useId, useState } from "react";

import type { RenderBlock, RenderTerm } from "@/lib/presentation";
import { AbsenceNotice, type PresentationAudience } from "./absence";
import { Count, Share } from "./primitives";
import { categoryMark } from "./vocabulary";

type LeafProps = { block: RenderBlock; audience: PresentationAudience };

/**
 * THE TYPE SCALE, and the two ranges it has.
 *
 * `RATIO_*` are multipliers of the composition's own base size, not absolute
 * lengths, so one responsive `clamp()` on the container controls the whole
 * picture and a 320px phone gets phone lettering without a second code path.
 *
 * A SMALL SET GETS THE WIDER RANGE, and that is the approved reading. With four
 * categories there is nothing to protect and everything to say, so the floor
 * drops and the contrast between the dominant term and the quietest one becomes
 * unmissable. With many terms the floor rises, because a picture whose rarest
 * word is illegible has stopped encoding it.
 */
const COMPOSITION_MAX_TERMS = 8;
const RATIO_MIN_SMALL = 0.75;
const RATIO_MAX_SMALL = 3.1;
const RATIO_MIN_MANY = 0.95;
const RATIO_MAX_MANY = 2.4;

/**
 * Font size from count. Monotone by construction, and deterministic.
 *
 * Size is `min + (max−min)·√(count/largest)`, so a term's AREA rises in
 * proportion to its count rather than its height doing so — a word said twice
 * as often should carry twice the ink, not four times it. The square root is
 * the whole of the arithmetic and it is GEOMETRY: it chooses how big to draw a
 * number that the canonical layer already computed, rounded once and formatted.
 * It never changes a count, a share or an order.
 */
function ratioFor(count: number, largest: number, small: boolean): number {
  const min = small ? RATIO_MIN_SMALL : RATIO_MIN_MANY;
  const max = small ? RATIO_MAX_SMALL : RATIO_MAX_MANY;
  if (largest <= 0) return min;
  const ratio = count / largest;
  return min + (max - min) * Math.sqrt(ratio < 0 ? 0 : ratio > 1 ? 1 : ratio);
}

function largestOf(terms: readonly RenderTerm[]): number {
  let largest = 0;
  for (const term of terms) if (term.count > largest) largest = term.count;
  return largest;
}

/**
 * WHICH TERMS STAND ON THEIR SIDE — the approved rule, and its reasons.
 *
 * The SHORTEST label turns, and a second joins it only when it is also clearly
 * short and at least two words would still read horizontally. Both halves
 * matter. A long phrase turned on its side is a column nobody reads, so length
 * decides rather than count — and turning the most-said term would hide the one
 * a reader looks for first. And there is ALWAYS at least one of each from two
 * terms upward: an all-horizontal set is a list, not a composition, which is
 * exactly what the four-term clouds had become.
 *
 * Ties break on the label so the same terms always compose the same picture.
 */
function turnedLabels(terms: readonly RenderTerm[]): ReadonlySet<string> {
  if (terms.length < 2) return new Set();
  const longest = terms.reduce((max, term) => (term.label.length > max ? term.label.length : max), 0);
  const shortestFirst = [...terms].sort(
    (a, b) => a.label.length - b.label.length || a.label.localeCompare(b.label, "es"),
  );
  const turned = new Set<string>([shortestFirst[0].label]);
  const second = shortestFirst[1];
  if (second && second.label.length <= longest * 0.6 && terms.length - turned.size > 1) {
    turned.add(second.label);
  }
  return turned;
}

export function WordCloud({ block, audience }: LeafProps) {
  const readoutId = useId();
  const [shown, setShown] = useState<RenderTerm | null>(null);
  if (block.payload.shape !== "terms") return null;
  const { terms } = block.payload;
  if (terms.length === 0) {
    return (
      <AbsenceNotice
        absence={
          block.sampleDisplay.state === "withheld_by_policy"
            ? { state: "withheld_by_policy" }
            : { state: "configuration_required" }
        }
        audience={audience}
      />
    );
  }

  const largest = largestOf(terms);
  const small = terms.length <= COMPOSITION_MAX_TERMS;
  const turned = turnedLabels(terms);
  const reading = shown ?? terms[0];

  /*
   * THE COMPOSITION: a centred stack of horizontal words, flanked by the turned
   * ones. It is the approved block rather than a scatter, and it is built out of
   * ordinary flow layout — a grid of three tracks with a flex stack in the
   * middle — so overlap and clipping are IMPOSSIBLE rather than merely tested
   * for. Nothing is absolutely positioned and nothing is measured, so there is
   * no font, no language, no zoom level and no missing webfont that can make two
   * words collide.
   */
  const horizontals = terms.filter((term) => !turned.has(term.label));
  const verticals = terms.filter((term) => turned.has(term.label));

  /*
   * The dominant term sits in the MIDDLE of the stack when there is a middle to
   * sit in. Reading order gives it the top, where it competes with the block's
   * own heading; one place down it anchors the composition instead.
   */
  const stack = [...horizontals];
  if (stack.length >= 3) [stack[0], stack[1]] = [stack[1], stack[0]];

  const order = new Map(terms.map((term, index) => [term.label, index]));
  const word = (term: RenderTerm, isTurned: boolean) => {
    const active = shown?.label === term.label;
    const index = order.get(term.label) ?? 0;
    return (
      <button
        key={term.label}
        type="button"
        aria-describedby={readoutId}
        aria-pressed={active}
        aria-label={
          term.share === null
            ? `${term.label}: ${term.count} ${term.count === 1 ? "mención" : "menciones"}.`
            : `${term.label}: ${term.count} ${term.count === 1 ? "mención" : "menciones"}, ${term.share} por ciento.`
        }
        onMouseEnter={() => setShown(term)}
        onMouseLeave={() => setShown(null)}
        onFocus={() => setShown(term)}
        onBlur={() => setShown(null)}
        onClick={() => setShown(active ? null : term)}
        className="max-w-full rounded-sm font-display font-bold leading-[1.05] [overflow-wrap:anywhere] transition-colors duration-[var(--motion-state)] ease-brand motion-reduce:transition-none"
        style={{
          fontSize: `${ratioFor(term.count, largest, small)}em`,
          color: active ? "var(--color-ink)" : categoryMark(index),
          // `vertical-rl` alone reads top-to-bottom, which is +90°; the extra
          // half turn makes it exactly −90°. It is done with `writing-mode`
          // rather than a transform so the browser still lays out the box the
          // word occupies — a rotated box that the layout does not know about is
          // how a cloud starts overlapping.
          writingMode: isTurned ? "vertical-rl" : undefined,
          transform: isTurned ? "rotate(180deg)" : undefined,
        }}
      >
        {term.label}
      </button>
    );
  };

  return (
    <div>
      <div
        className="grid min-w-0 items-center justify-center gap-x-3 rounded-xl border border-line bg-surface-sunken px-3 py-6 [grid-template-columns:auto_minmax(0,1fr)_auto]"
        style={{
          // ONE responsive knob for the whole composition. Every term is sized
          // in `em`, so this single clamp is what makes a 320px phone get phone
          // lettering — with no second layout, no measurement pass and no
          // breakpoint that could disagree with the one the QA sweep checked.
          fontSize: "clamp(0.6rem, 0.42rem + 0.95vw, 1rem)",
        }}
      >
        <div className="flex flex-col items-center justify-center">
          {verticals[0] ? word(verticals[0], true) : null}
        </div>
        <div
          className={
            small
              ? "flex min-w-0 flex-col items-center justify-center gap-y-1 text-center"
              : "flex min-w-0 flex-wrap items-center justify-center gap-x-4 gap-y-1 text-center"
          }
        >
          {stack.map((term) => word(term, false))}
        </div>
        <div className="flex flex-col items-center justify-center">
          {verticals[1] ? word(verticals[1], true) : null}
        </div>
      </div>
      <p
        id={readoutId}
        aria-live="polite"
        className="mt-3 min-h-[2.75rem] rounded-md border border-evidence-line bg-evidence-surface px-3 py-2 text-sm text-body"
      >
        <span className="font-semibold text-strong">{reading.label}</span>
        {" — "}
        <Count of={reading.count} /> {reading.count === 1 ? "mención" : "menciones"}
        {reading.share === null ? null : (
          <>
            {" · "}
            <Share of={reading.share} />
          </>
        )}
      </p>
    </div>
  );
}

/** The same terms as a ranked list. The picture is never the only carrier. */
export function TermRanking({ block, audience }: LeafProps) {
  if (block.payload.shape !== "terms") return null;
  const { terms, total, excluded } = block.payload;
  if (terms.length === 0) {
    return (
      <AbsenceNotice
        absence={
          block.sampleDisplay.state === "withheld_by_policy"
            ? { state: "withheld_by_policy" }
            : { state: "configuration_required" }
        }
        audience={audience}
      />
    );
  }
  const largest = largestOf(terms);
  return (
    <div>
      <ol className="space-y-2">
        {terms.map((term, index) => (
          <li key={term.label} className="grid items-center gap-x-3 [grid-template-columns:minmax(0,1fr)_4.75rem]">
            <div className="min-w-0">
              <p className="text-sm text-body [overflow-wrap:anywhere]">{term.label}</p>
              <div className="mt-1 h-2 w-full overflow-hidden rounded-full bg-line" aria-hidden="true">
                <i
                  className="block h-full rounded-full"
                  style={{
                    width: `${largest === 0 ? 0 : (term.count / largest) * 100}%`,
                    backgroundColor: categoryMark(index),
                  }}
                />
              </div>
            </div>
            <p className="whitespace-nowrap text-right text-sm text-body">
              <Count of={term.count} />
              {term.share === null ? null : (
                <>
                  {" · "}
                  <Share of={term.share} className="text-xs text-muted" />
                </>
              )}
            </p>
          </li>
        ))}
      </ol>
      <p className="mt-3 text-xs text-muted">
        <Count of={total} /> menciones en total.
        {excluded.length > 0 ? (
          <>
            {" "}
            Fuera del recuento:{" "}
            {excluded.map((entry, index) => (
              <span key={entry.label}>
                {index > 0 ? ", " : ""}
                {entry.label} (<Count of={entry.count} />)
              </span>
            ))}
            .
          </>
        ) : null}
      </p>
    </div>
  );
}
