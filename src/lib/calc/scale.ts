/**
 * THE SCALE A RESULT IS ANSWERED ON, AND THE TOP-2-BOX THRESHOLD THAT FOLLOWS
 * FROM IT — read from the study's own answers, in one place, for everybody.
 *
 * `docs/CALCULATION_POLICY.md` §5 is explicit that `satisfiedMin` is an
 * EXPLICIT INPUT to `csatTopBox`, precisely so one canonical function serves a
 * 1–5 scale and a 0–10 scale, and that *"the scale is never guessed —
 * configuration over code"*. `docs/CALCULATION_CATALOG.md` §4 fixes the 1–5
 * rule as authoritative: four and five are satisfied, one to three are not,
 * and both are in the denominator.
 *
 * WHAT WENT WRONG WITHOUT THIS FILE. `DEFAULT_CSAT_MIN` is 9 — the threshold
 * for a 0–10 scale. Every `csat_*` / `sat_*` result in the real study is
 * answered 1–5, so nothing ever cleared 9 and every one of them was reported
 * as a confident, wrong **0 %**. The composer was fixed by deriving the scale
 * in its own adapter; the client dashboard, the PDF and the longitudinal view
 * still called `computeStudyMetrics` with no `csatMin` at all and kept the
 * 0–10 default. Two derivations of the same fact, one of them missing, is how
 * a builder preview and the client's screen come to disagree about a number.
 *
 * So the derivation lives here, once, and every one of those paths reads it:
 * the composer's registry, the client dashboard, the server PDF and the
 * longitudinal series.
 *
 * THREE RULES THIS FILE KEEPS.
 *
 *   1. The scale is READ, never assumed. It is the observed span of the
 *      study's own answers for that metric key.
 *   2. The threshold is DOCUMENTED, never invented. Two scales have an
 *      authoritative Top-2-Box rule; anything else yields `null`.
 *   3. `null` means DO NOT COMPUTE IT. A result whose scale the catalogue does
 *      not document has no honest Top-2-Box, and every caller omits it rather
 *      than printing a number nobody agreed to. A missing result and a zero
 *      are different statements, and only one of them is true.
 *
 * DERIVE FROM THE WHOLE STUDY, NOT FROM A NARROWED SELECTION. A filter that
 * leaves only the answers 3, 4 and 5 of a 0–10 result would make that result
 * look like a 1–5 one and move its threshold from 9 to 4. Every caller here
 * therefore derives the thresholds from the study's UNFILTERED rows and passes
 * them down; the functions that accept a narrowed row set take the map rather
 * than re-deriving from what they were handed.
 */

import type { LongRow } from "./engine";

export type MetricScale = { minimum: number; maximum: number };

/** Per metric key: the satisfied-from score, or `null` for "do not compute". */
export type TopBoxMinimums = ReadonlyMap<string, number | null>;

/** Rows this module can read: anything carrying a metric key and a value. */
type ScorableRow = { metric_key?: unknown; value?: unknown };

/**
 * The observed span of every metric key's answers.
 *
 * Non-numeric values are skipped rather than coerced: a blank cell is not a
 * zero, and treating it as one would widen a 1–5 result to 0–5 and change
 * which documented rule applies to it.
 */
export function observedScales(rows: readonly ScorableRow[]): Map<string, MetricScale> {
  const spans = new Map<string, MetricScale>();
  for (const row of rows) {
    const value = Number(row.value);
    if (!Number.isFinite(value)) continue;
    const key = String(row.metric_key ?? "");
    if (key === "") continue;
    const span = spans.get(key);
    if (!span) {
      spans.set(key, { minimum: value, maximum: value });
      continue;
    }
    if (value < span.minimum) span.minimum = value;
    if (value > span.maximum) span.maximum = value;
  }
  return spans;
}

/**
 * The satisfied-from score for a Top-2-Box, from the two scales the calculation
 * catalogue documents and from nowhere else.
 *
 * `docs/CALCULATION_CATALOG.md` §4: on a 1–5 scale, four and five are
 * satisfied. `docs/CALCULATION_POLICY.md` §5: on a 0–10 scale it is nine.
 * Anything else returns `null`. Widening this to "whatever the top two values
 * happen to be" would be inventing a formula, which is exactly what the
 * project forbids — and it would produce a different number for the same
 * answers depending on who happened to reply.
 */
export function documentedTopBoxMinimum(scale: MetricScale | null | undefined): number | null {
  if (!scale) return null;
  const { minimum, maximum } = scale;
  if (!Number.isFinite(minimum) || !Number.isFinite(maximum)) return null;
  if (minimum >= 1 && maximum <= 5) return 4;
  if (maximum > 5 && maximum <= 10) return 9;
  return null;
}

/**
 * The documented threshold for every metric key a study carries.
 *
 * Derive this from the study's WHOLE row set once, and hand it to whatever
 * computes over a narrowed one.
 */
export function topBoxMinimums(rows: readonly ScorableRow[]): TopBoxMinimums {
  const thresholds = new Map<string, number | null>();
  for (const [key, scale] of observedScales(rows)) {
    thresholds.set(key, documentedTopBoxMinimum(scale));
  }
  return thresholds;
}

/**
 * The threshold one caller should use for one metric key.
 *
 * `explicit` wins when a caller states one — the calculation gate does, and a
 * study whose scale is configured elsewhere one day will. Otherwise the
 * declared map answers, and a key the map does not mention has no documented
 * threshold rather than a default one.
 */
export function resolveTopBoxMinimum(
  metricKey: string,
  options: { explicit?: number; declared?: TopBoxMinimums } = {},
): number | null {
  if (options.explicit !== undefined) return options.explicit;
  if (!options.declared) return null;
  return options.declared.get(metricKey) ?? null;
}

/** Convenience for a caller that holds the study's whole row set already. */
export function topBoxMinimumsFor(rows: readonly LongRow[]): TopBoxMinimums {
  return topBoxMinimums(rows as readonly ScorableRow[]);
}
