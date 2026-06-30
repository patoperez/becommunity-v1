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

function round(value: number, decimals: number): number {
  const f = 10 ** decimals;
  return Math.round((value + Number.EPSILON) * f) / f;
}

/** Arithmetic mean. Returns null for an empty set (no silent 0). */
export function mean(values: number[], decimals = 2): number | null {
  if (values.length === 0) return null;
  const sum = values.reduce((a, b) => a + b, 0);
  return round(sum / values.length, decimals);
}

/** Percentage of `count` over `total`, 0..100. */
export function percentage(count: number, total: number, decimals = 1): number {
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
export function npsFromScores(scores: number[], decimals = 1): NpsResult {
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
export function csatTopBox(scores: number[], satisfiedMin: number, decimals = 1): CsatResult {
  const valid = scores.filter((s) => Number.isFinite(s));
  const total = valid.length;
  const satisfied = valid.filter((s) => s >= satisfiedMin).length;
  return { csat: percentage(satisfied, total, decimals), satisfied, total, satisfiedMin };
}
