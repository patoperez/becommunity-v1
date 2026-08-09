/**
 * Canonical metric definitions (§5.2 golden rule).
 *
 * Composite indicators (NPS, CSAT, Top-N-Box) are defined ONCE here and reused
 * everywhere. They are NEVER recomputed ad-hoc in a component or an Arquero
 * rollup. If a formula must change, it changes in exactly one place.
 *
 * Relational aggregation (filter/group/average/count) lives in engine.ts on top
 * of Arquero; this file only holds the metric *definitions*.
 */

export type NpsResult = {
  /** Net Promoter Score, range -100..100. */
  nps: number;
  promoters: number;
  passives: number;
  detractors: number;
  total: number;
};

export type CsatResult = {
  /** Percentage 0..100 of responses at/above the satisfied threshold (Top-N-Box). */
  csat: number;
  satisfied: number;
  total: number;
  /** The threshold used, for transparency in the UI. */
  satisfiedMin: number;
};

/**
 * Declared precision per unit (docs/CALCULATION_POLICY.md §4). Every value is
 * rounded EXACTLY ONCE, in the calculation layer, at the precision of its unit.
 * Display code formats at the same precision and must never re-round to a
 * coarser one (that is double-rounding, and it changes numbers).
 */
export const DECIMALS = {
  /** NPS, range -100..100. */
  nps: 1,
  /** CSAT / any percentage, range 0..100. */
  percent: 1,
  /** Means, cross averages, pivot cells — a rating-scale "score". */
  score: 2,
  /** Journey-map headline score (a compact KPI read-out). */
  journeyHeadline: 1,
} as const;

/**
 * THE canonical rounding helper (docs/CALCULATION_POLICY.md §2-§3).
 *
 * Mode: **half away from zero**, matching Excel's ROUND() — so +0.125 -> 0.13
 * and -0.125 -> -0.13 (symmetric). JavaScript's bare Math.round rounds halves
 * toward +Infinity, which is asymmetric for negative values; NPS spans
 * -100..100, so that asymmetry was client-facing and diverged from the Excel
 * workbooks this platform must reproduce.
 *
 * The `Number.EPSILON` nudge is load-bearing and is applied to the ABSOLUTE
 * value BEFORE scaling, so the binary-representation correction survives the
 * mode change: round(1.005, 2) === 1.01 (without it, 1.005 * 100 evaluates to
 * 100.49999999999999 and would round DOWN to 1).
 *
 * No metric may round ad-hoc. If the policy changes, it changes here, once.
 */
export function roundTo(value: number, decimals: number): number {
  const f = 10 ** decimals;
  const sign = value < 0 ? -1 : 1;
  return (sign * Math.round((Math.abs(value) + Number.EPSILON) * f)) / f;
}

/** Internal alias kept so the definitions below read unchanged. */
const round = roundTo;

/** Arithmetic mean. Returns null for an empty set (no silent 0). */
export function mean(values: number[], decimals: number = DECIMALS.score): number | null {
  if (values.length === 0) return null;
  const sum = values.reduce((a, b) => a + b, 0);
  return round(sum / values.length, decimals);
}

/** Percentage of `count` over `total`, 0..100. */
export function percentage(count: number, total: number, decimals: number = DECIMALS.percent): number {
  if (total === 0) return 0;
  return round((count / total) * 100, decimals);
}

/**
 * NET PROMOTER SCORE — the one and only implementation (§5.2 golden rule).
 *
 * Standard 0–10 likelihood-to-recommend question:
 *   promoters  = score >= 9
 *   passives   = score 7–8
 *   detractors = score <= 6
 *   NPS = (%promoters − %detractors), expressed on a -100..100 scale.
 *
 * Values outside 0–10 are ignored (defensive; a bad scale should not silently
 * skew the score).
 */
export function npsFromScores(scores: number[], decimals: number = DECIMALS.nps): NpsResult {
  const valid = scores.filter((s) => Number.isFinite(s) && s >= 0 && s <= 10);
  const total = valid.length;
  const promoters = valid.filter((s) => s >= 9).length;
  const detractors = valid.filter((s) => s <= 6).length;
  const passives = total - promoters - detractors;
  const nps = total === 0 ? 0 : round(((promoters - detractors) / total) * 100, decimals);
  return { nps, promoters, passives, detractors, total };
}

/**
 * CSAT as a Top-N-Box percentage — the one and only implementation.
 *
 * `satisfiedMin` is the threshold a response must reach to count as "satisfied"
 * (e.g. 9 for Top-2-Box on a 0–10 scale, 4 for Top-2-Box on a 1–5 scale). It is
 * an explicit input so the scale is never guessed — configuration over code.
 */
export function csatTopBox(scores: number[], satisfiedMin: number, decimals: number = DECIMALS.percent): CsatResult {
  const valid = scores.filter((s) => Number.isFinite(s));
  const total = valid.length;
  const satisfied = valid.filter((s) => s >= satisfiedMin).length;
  return { csat: percentage(satisfied, total, decimals), satisfied, total, satisfiedMin };
}
