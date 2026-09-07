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
 * So the terms are laid out as ordinary inline text in a wrapping flex row. The
 * browser measures them, which means no overlap and no clipping are POSSIBLE
 * rather than merely tested for — at 320px, at 200% zoom, in any font that
 * loads or fails to load. The visual result is the oracle's block variant: a
 * centred field of words whose size says how often each was said.
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

const MIN_REM = 0.95;
const MAX_REM = 2.6;

/**
 * Font size from count. Monotone by construction, and deterministic.
 *
 * `largest` is the largest count in this set, so the biggest term always sits at
 * `MAX_REM` and the picture uses its whole range whatever the absolute numbers
 * are. A single-term cloud takes the maximum, which is the honest answer: there
 * is nothing to be relatively larger than.
 */
function sizeFor(count: number, largest: number): number {
  if (largest <= 0) return MIN_REM;
  const ratio = count / largest;
  return MIN_REM + (MAX_REM - MIN_REM) * Math.sqrt(ratio < 0 ? 0 : ratio > 1 ? 1 : ratio);
}

function largestOf(terms: readonly RenderTerm[]): number {
  let largest = 0;
  for (const term of terms) if (term.count > largest) largest = term.count;
  return largest;
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
  // The single term chosen to stand on its side: the shortest label among the
  // quieter half, so the turned word is never the one a reader looks for first
  // and is never long enough to make a tall column on a phone.
  const turnable = terms
    .filter((term) => term.count < largest && term.label.length <= 14)
    .sort((a, b) => a.label.length - b.label.length || a.label.localeCompare(b.label, "es"));
  const turned = terms.length >= 5 ? (turnable[0] ?? null) : null;
  const reading = shown ?? terms[0];

  return (
    <div>
      <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2 rounded-xl border border-line bg-surface-sunken px-4 py-6">
        {terms.map((term, index) => {
          const isTurned = turned !== null && term.label === turned.label;
          const active = shown?.label === term.label;
          return (
            <button
              key={term.label}
              type="button"
              aria-describedby={readoutId}
              aria-pressed={active}
              onMouseEnter={() => setShown(term)}
              onMouseLeave={() => setShown(null)}
              onFocus={() => setShown(term)}
              onBlur={() => setShown(null)}
              onClick={() => setShown(active ? null : term)}
              className="rounded-sm font-display font-bold leading-tight transition-colors duration-[var(--motion-state)] ease-brand motion-reduce:transition-none"
              style={{
                fontSize: `${sizeFor(term.count, largest)}rem`,
                color: active ? "var(--color-ink)" : categoryMark(index),
                writingMode: isTurned ? "vertical-rl" : undefined,
                // `vertical-rl` alone reads top-to-bottom rotated +90°; the extra
                // half turn makes it exactly −90°, which is the only rotation
                // other than none that this drawing is allowed to use.
                transform: isTurned ? "rotate(180deg)" : undefined,
              }}
            >
              {term.label}
            </button>
          );
        })}
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
