import { DECIMALS, roundTo } from "./metrics";

/**
 * THE presentation boundary (docs/CALCULATION_POLICY.md §4).
 *
 * This is where a value is rounded for display, using the canonical `roundTo`.
 * Internal aggregation results (pivot cells) are kept at RAW precision so no
 * derived calculation ever inherits rounding error; they are rounded here, once,
 * at the very end.
 *
 * `toFixed` must NOT be used to round — it does not implement the canonical
 * policy and is subject to binary representation: `(1.005).toFixed(2) === "1.00"`
 * and `(2.675).toFixed(2) === "2.67"`, where the canonical helper gives 1.01 and
 * 2.68. It is used here only to PAD an already-canonically-rounded value, which
 * cannot alter it.
 *
 * Replaces the ad-hoc `toFixed(2)` / `toFixed(1)` that previously lived in three
 * separate components with three different implicit policies.
 */
export function formatNumber(value: number | null, decimals: number): string {
  if (value == null || !Number.isFinite(value)) return "—";
  const rounded = roundTo(value, decimals);
  // Integers render bare ("5", not "5.00") — matches the existing dashboard look.
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(decimals);
}

/** A score (mean, cross average, pivot cell). */
export function formatScore(value: number | null): string {
  return formatNumber(value, DECIMALS.score);
}

/** A percentage value (CSAT and friends); the caller appends the % sign. */
export function formatPercent(value: number | null): string {
  return formatNumber(value, DECIMALS.percent);
}
