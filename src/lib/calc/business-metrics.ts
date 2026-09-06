import {
  csatTopBox,
  DECIMALS,
  npsFromScores,
  roundTo,
  type CsatResult,
  type NpsResult,
} from "./metrics";

/** Confirmed Be Community response scale for renewal / return intention. */
export const CRI_RISK_POINTS = {
  nada: 100,
  poco: 75,
  algo: 50,
  muy: 25,
  extremadamente: 0,
} as const;

export type CriResponse = keyof typeof CRI_RISK_POINTS;
export type IndicatorBand = "red" | "yellow" | "green";
export type CriBand = "safe" | "alert" | "danger";

/**
 * The confirmed CRI vocabulary, defined once.
 *
 * The five responses as `docs/CALCULATION_CATALOG.md` §6 spells them, in the
 * presentation order the process documentation's histogram declares (§7.1:
 * «Ningún riesgo; Bajo riesgo; Riesgo moderado; Riesgo alto; Riesgo crítico»),
 * with the alert level each carries (§3.2 and §4.1). Least risk first.
 *
 * A source label is recognised through `criResponseFromLabel`, which compares
 * on a whitespace-, case- and accent-insensitive form. It never REPLACES the
 * source value — the raw answer keeps its own spelling wherever it is stored.
 */
export const CRI_ORDER: readonly CriResponse[] = [
  "extremadamente",
  "muy",
  "algo",
  "poco",
  "nada",
] as const;

export const CRI_RESPONSE_LABELS: Record<CriResponse, string> = {
  extremadamente: "Extremadamente probable",
  muy: "Muy probable",
  algo: "Algo probable",
  poco: "Poco probable",
  nada: "Nada probable",
};

export const CRI_ALERT_LEVELS: Record<CriResponse, string> = {
  extremadamente: "Ningún riesgo",
  muy: "Bajo riesgo",
  algo: "Riesgo moderado",
  poco: "Riesgo alto",
  nada: "Riesgo crítico",
};

function criComparisonForm(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLocaleLowerCase("es-MX");
}

const CRI_BY_COMPARISON_FORM: ReadonlyMap<string, CriResponse> = new Map(
  (Object.keys(CRI_RESPONSE_LABELS) as CriResponse[]).map((key) => [
    criComparisonForm(CRI_RESPONSE_LABELS[key]),
    key,
  ]),
);

/** The documented response a source label denotes, or null when it denotes none. */
export function criResponseFromLabel(label: string): CriResponse | null {
  return CRI_BY_COMPARISON_FORM.get(criComparisonForm(label)) ?? null;
}

export type RateResult = {
  /** Null means there was no denominator, not a measured zero. */
  value: number | null;
  numerator: number;
  denominator: number;
};

function assertCount(label: string, value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${label} must be a non-negative safe integer`);
  }
}

function rate(numerator: number, denominator: number, decimals = DECIMALS.percent): RateResult {
  assertCount("numerator", numerator);
  assertCount("denominator", denominator);
  if (numerator > denominator) {
    throw new RangeError("numerator cannot exceed denominator");
  }
  return {
    value: denominator === 0 ? null : roundTo((numerator / denominator) * 100, decimals),
    numerator,
    denominator,
  };
}

/** Be Community NPS: valid survey values are 1–10; passives stay in total. */
export function beCommunityNps(scores: number[], decimals = DECIMALS.nps): NpsResult | null {
  const valid = scores.filter((score) => Number.isSafeInteger(score) && score >= 1 && score <= 10);
  if (valid.length === 0) return null;
  return npsFromScores(valid, decimals);
}

/** A satisfaction scale, stated rather than guessed. */
export type SatisfactionScale = {
  min: number;
  max: number;
  /** The lowest response that counts as satisfied. */
  satisfiedMin: number;
};

/** The confirmed Be Community satisfaction scale: 1–5, satisfied from 4. */
export const BE_COMMUNITY_SATISFACTION_SCALE: SatisfactionScale = { min: 1, max: 5, satisfiedMin: 4 };

function assertScale(scale: SatisfactionScale): void {
  if (!Number.isFinite(scale.min) || !Number.isFinite(scale.max) || !Number.isFinite(scale.satisfiedMin)) {
    throw new RangeError("satisfaction scale bounds must be finite");
  }
  if (!(scale.min <= scale.satisfiedMin && scale.satisfiedMin <= scale.max)) {
    throw new RangeError("satisfaction scale must satisfy min <= satisfiedMin <= max");
  }
}

/**
 * CSAT for one touchpoint, on an EXPLICIT scale.
 *
 * The scale is an input for the same reason `csatTopBox` takes its threshold as
 * one: a study that evaluates satisfaction on a different range is
 * configuration, not a second code path, and a scale held in two places is a
 * scale that will eventually disagree with itself. Callers that want the
 * confirmed Be Community scale use `touchpointCsat` below.
 */
export function touchpointCsatOnScale(
  scores: number[],
  scale: SatisfactionScale,
  decimals = DECIMALS.percent,
): CsatResult | null {
  assertScale(scale);
  const valid = scores.filter(
    (score) => Number.isSafeInteger(score) && score >= scale.min && score <= scale.max,
  );
  if (valid.length === 0) return null;
  return csatTopBox(valid, scale.satisfiedMin, decimals);
}

/** Be Community CSAT: Top-2-Box on 1–5, calculated per touchpoint. */
export function touchpointCsat(scores: number[], decimals = DECIMALS.percent): CsatResult | null {
  return touchpointCsatOnScale(scores, BE_COMMUNITY_SATISFACTION_SCALE, decimals);
}

/**
 * TDP — Tasa de Desconocimiento de Proceso. THE Be Community metric of that name.
 *
 * `Documentacion_Integral_Proceso_Be_Community` §4.1, verbatim:
 *
 *   «TDP = (Número de eventos reportados por desconocimiento / Número total de
 *    respuestas con categoría de Satisfecho y Insatisfecho) × 100»
 *
 * The denominator is the touchpoint's VALID base — satisfied plus dissatisfied —
 * and therefore EXCLUDES the unaware responses that form the numerator. Two
 * consequences are deliberate and must not be "fixed":
 *
 *   - **The result may exceed 100.** A process four people could judge and
 *     twenty had never met scores 500%. That is the honest reading of a process
 *     almost nobody has met, and it is why this function does not go through
 *     `rate()`, whose contract forbids a numerator larger than its denominator.
 *     Clamping it would erase the cases the measure exists to surface.
 *   - **No valid base is no rate**, not a measured zero. `numerator` still
 *     carries the unawareness count, so a caller can say "nobody could judge it,
 *     and N people said they did not know it".
 *
 * ⓘ **RESOLVED, 2026-09-06.** `docs/CALCULATION_CATALOG.md` §5 previously
 * defined TDP with the OTHER denominator — over every response the touchpoint
 * received. The methodology owner has settled it: the name TDP belongs to the
 * §4.1 ratio implemented here, which is also what the CEO-approved dashboard
 * computes. The catalogue has been corrected. The other quantity remains
 * available as an auxiliary proportion under an explicit name
 * (`unawarenessShareOfResponses`) and is NOT called TDP anywhere.
 */
export function processUnawarenessTdp(
  unknownResponses: number,
  validBase: number,
  decimals = DECIMALS.percent,
): RateResult {
  assertCount("unknownResponses", unknownResponses);
  assertCount("validBase", validBase);
  return {
    value: validBase === 0 ? null : roundTo((unknownResponses / validBase) * 100, decimals),
    numerator: unknownResponses,
    denominator: validBase,
  };
}

/**
 * AUXILIARY — the share of a touchpoint's responses that reported not knowing it.
 *
 * Denominator: every classified response the touchpoint received — satisfied,
 * dissatisfied and unaware alike. Bounded 0..100 by construction, which is why
 * it goes through `rate()`. The name says the denominator out loud precisely so
 * this can never be mistaken for the metric above.
 *
 * ⓘ **This is NOT TDP.** It is the complement of the "% que conoce" bar in the
 * stacked chart of process documentation §7.1, and it is useful for exactly
 * that: a pair that closes at a hundred. It never replaces TDP, is never
 * labelled TDP, and is never published without its denominator stated beside
 * it. See `processUnawarenessTdp` above.
 */
export function unawarenessShareOfResponses(
  unknownResponses: number,
  totalClassifiedResponses: number,
  decimals = DECIMALS.percent,
): RateResult {
  return rate(unknownResponses, totalClassifiedResponses, decimals);
}

/** CRI: arithmetic mean of the confirmed per-response risk weights. */
export function churnRiskIndex(
  responses: CriResponse[],
  decimals = DECIMALS.percent,
): RateResult {
  if (responses.length === 0) {
    return { value: null, numerator: 0, denominator: 0 };
  }

  const weightedPoints = responses.reduce<number>((sum, response) => {
    const points = CRI_RISK_POINTS[response];
    if (points === undefined) throw new RangeError(`unknown CRI response: ${response}`);
    return sum + points;
  }, 0);

  return {
    value: roundTo(weightedPoints / responses.length, decimals),
    numerator: weightedPoints,
    denominator: responses.length,
  };
}

/** CRR: (ending members - new members) / starting members. */
export function retentionRate(
  startingMembers: number,
  endingMembers: number,
  newMembers: number,
  decimals = DECIMALS.percent,
): RateResult {
  assertCount("startingMembers", startingMembers);
  assertCount("endingMembers", endingMembers);
  assertCount("newMembers", newMembers);
  if (newMembers > endingMembers) {
    throw new RangeError("newMembers cannot exceed endingMembers");
  }
  return rate(endingMembers - newMembers, startingMembers, decimals);
}

/** CR: members lost during the period / members at the start. */
export function churnRate(
  startingMembers: number,
  lostMembers: number,
  decimals = DECIMALS.percent,
): RateResult {
  assertCount("startingMembers", startingMembers);
  assertCount("lostMembers", lostMembers);
  return rate(lostMembers, startingMembers, decimals);
}

export function npsBand(value: number): IndicatorBand {
  if (value >= 80) return "green";
  if (value >= 60) return "yellow";
  return "red";
}

export function csatBand(value: number): IndicatorBand {
  if (value >= 75) return "green";
  if (value >= 60) return "yellow";
  return "red";
}

export function criBand(value: number): CriBand {
  if (value <= 30) return "safe";
  if (value <= 60) return "alert";
  return "danger";
}
