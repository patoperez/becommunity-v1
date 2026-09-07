/**
 * THE PRIMITIVES — and the one rule the whole library rests on.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * A NUMBER IS DRAWN AS `formatted`, AND AS NOTHING ELSE.
 *
 * `RenderValue` carries `value`, `unit`, `decimals` and `formatted`. Only the
 * last one is ever printed. The other three exist so a renderer can choose a
 * GEOMETRY — how long a bar is, whether a track runs to 100 — and choosing a
 * geometry is not computing a result.
 *
 * The line between the two is easy to state and easy to cross by accident, so
 * it is written down: mapping an already-final number onto pixels, angles, bar
 * lengths or font sizes is drawing. Producing a number a reader reads is
 * calculating, and this layer never does it. `value.toFixed(1)` looks like
 * formatting and is calculating: it can round, and the canonical policy already
 * rounded exactly once, at a precision it declared.
 *
 * That is why the approved dashboard's `CountUp` is deliberately NOT carried
 * across. It animates from zero to the value, calling `roundTo(value * eased,
 * decimals)` on every frame, and every one of those frames is a number a reader
 * can read that the study never produced. What IS carried across is its
 * accessibility split — an `aria-hidden` visual and an `sr-only` truth — which
 * becomes unnecessary the moment the two are the same string, and so collapses
 * into one plain text node.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import type { ResponseContext, RenderValue } from "@/lib/presentation";
import { bandPalette, unitSuffix } from "./vocabulary";

/**
 * The one component allowed to print a measured quantity.
 *
 * Every other renderer goes through it, so there is exactly one place in the
 * library where a `RenderValue` becomes text — and a gate can read that place.
 */
export function Figure({
  value,
  className = "",
  withSuffix = true,
}: {
  value: RenderValue;
  className?: string;
  withSuffix?: boolean;
}) {
  const suffix = withSuffix ? unitSuffix(value.unit) : null;
  return (
    <span className={`tabular ${className}`}>
      {value.formatted}
      {suffix ? <span className="ml-0.5 text-[0.42em] font-semibold text-muted">{suffix}</span> : null}
    </span>
  );
}

/**
 * A base, spelled the way the language rules require.
 *
 * `docs`' plain-Spanish rule forbids `n=` in an always-visible string; the
 * precision belongs in a methodology disclosure. So the base reads as a
 * sentence, and the three counts are printed as they arrived — never combined
 * into a response rate, which would be arithmetic.
 */
export function BaseLine({ base, className = "" }: { base: ResponseContext; className?: string }) {
  return (
    <p className={`text-xs text-muted ${className}`}>
      <span className="tabular">{base.valid}</span> respuestas utilizables de{" "}
      <span className="tabular">{base.responded}</span> recibidas, sobre{" "}
      <span className="tabular">{base.eligible}</span> personas.
    </p>
  );
}

/** A band, as a chip. The scheme that named it never crossed the boundary. */
export function BandChip({ value }: { value: RenderValue }) {
  if (!value.band?.label) return null;
  const palette = bandPalette(value.band.semanticColor);
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold ${palette.surface} ${palette.text}`}
    >
      {value.band.label}
    </span>
  );
}

/**
 * A whole number that is NOT a `RenderValue`.
 *
 * Category counts, term counts, cohort sizes and filter-option participants
 * arrive as plain integers with no `formatted` string of their own — the one
 * place a client surface is unavoidably choosing a spelling. It is kept to the
 * dullest possible one: the number as JavaScript already writes it, with no
 * locale, no separator and no rounding. A `share` arrives already rounded once
 * at percent precision, so printing it verbatim is the only honest option;
 * `null` means an empty base and is never drawn as a zero.
 */
/**
 * `of` is NULLABLE, and that is the whole point of this signature.
 *
 * A first version took `number` and every nullable call site wrote `count ?? 0`.
 * That prints the digit 0 for a category with NO BASE — and a measured zero and
 * an absent measurement are different facts the contract deliberately keeps
 * apart (`render-model.ts`: "Null when there was no base at all. Never a
 * filled-in zero."). A reader shown "Promotores 0" over an empty base has been
 * told a finding the study never made.
 *
 * The type is the fix. `?? 0` is no longer reachable through this component,
 * because there is nothing to default.
 */
export function Count({ of, className = "" }: { of: number | null; className?: string }) {
  if (of === null) return null;
  return <span className={`tabular ${className}`}>{of}</span>;
}

/** What a reader is told where a count has no base. A caveat, not a number. */
export function NoBase({ className = "" }: { className?: string }) {
  return <span className={`text-muted ${className}`}>sin base</span>;
}

export function Share({ of, className = "" }: { of: number | null; className?: string }) {
  if (of === null) return null;
  return (
    <span className={`tabular ${className}`}>
      {of}
      <span className="text-[0.85em] text-muted">%</span>
    </span>
  );
}

/**
 * A measurement track.
 *
 * THE GEOMETRY IS ON THE LIST, NOT ON THE ROW. Every row is `display: contents`
 * so its three cells land in the SAME three container-resolved tracks, the
 * label column is a `clamp()` against the container rather than `auto`, and the
 * value column is a fixed width. That is what makes a long category name
 * unable to shorten its own ruler — the defect the approved dashboard records
 * having shipped and fixed, where one label's bar was ~130px shorter than
 * another's and the two were being compared by eye.
 */
export function MeasureList({ children }: { children: React.ReactNode }) {
  return (
    <dl className="grid w-full items-center gap-x-3 gap-y-2 [grid-template-columns:clamp(7rem,30%,14rem)_minmax(0,1fr)_4.75rem] max-[640px]:block">
      {children}
    </dl>
  );
}

export function MeasureRow({
  label,
  fraction,
  mark,
  children,
}: {
  label: string;
  /** 0..1 of the track. Already-final values mapped to a length — drawing. */
  fraction: number;
  mark: string;
  children: React.ReactNode;
}) {
  const width = fraction <= 0 ? 0 : fraction >= 1 ? 100 : fraction * 100;
  return (
    <div className="contents max-[640px]:mb-3 max-[640px]:block">
      <dt className="min-w-0 text-sm text-body [overflow-wrap:anywhere]">{label}</dt>
      <dd className="min-w-0 max-[640px]:mt-1">
        <div className="h-2.5 w-full overflow-hidden rounded-full bg-line" aria-hidden="true">
          <i
            className="block h-full rounded-full transition-[width] duration-[var(--motion-content)] ease-brand motion-reduce:transition-none"
            style={{ width: `${width}%`, backgroundColor: mark }}
          />
        </div>
      </dd>
      <dd className="whitespace-nowrap text-right text-sm text-body max-[640px]:mt-1 max-[640px]:text-left">
        {children}
      </dd>
    </div>
  );
}
