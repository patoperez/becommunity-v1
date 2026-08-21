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

/** Be Community CSAT: Top-2-Box on 1–5, calculated per touchpoint. */
export function touchpointCsat(scores: number[], decimals = DECIMALS.percent): CsatResult | null {
  const valid = scores.filter((score) => Number.isSafeInteger(score) && score >= 1 && score <= 5);
  if (valid.length === 0) return null;
  return csatTopBox(valid, 4, decimals);
}

/** TDP: unknown / all responses for one CSAT touchpoint. */
export function processUnawarenessRate(
  unknownResponses: number,
  totalResponses: number,
  decimals = DECIMALS.percent,
): RateResult {
  return rate(unknownResponses, totalResponses, decimals);
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
