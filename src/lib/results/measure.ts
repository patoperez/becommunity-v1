/**
 * Shared machinery for turning a canonical record set into a `MetricResult`.
 *
 * Everything numeric here DELEGATES. `roundTo`, `percentage`, `formatNumber`
 * and the band functions live in `src/lib/calc/` and are the single definition
 * of what those words mean; this module only assembles the envelope around
 * them — the base, the accounting, the provenance and the three states.
 *
 * Nothing here decides a business rule. If a line in this file starts to look
 * like a formula, it belongs in `src/lib/calc/business-metrics.ts` instead.
 */

import { csatBand, criBand, npsBand } from "../calc/business-metrics";
import { formatNumber } from "../calc/format";
import { DECIMALS, percentage } from "../calc/metrics";
import type { SourceValueStatus } from "../ingestion/canonical-package/values";
import { authorities } from "./authorities";
import {
  emptyAccounting,
  emptyBase,
  type AnswerAccounting,
  type MetricResult,
  type ResultBand,
  type ResultBase,
  type ResultProvenance,
  type ResultUnit,
  type ResultValue,
  type SemanticColor,
  type UnavailableReason,
} from "./contract";
import type { CanonicalResultSource, ResultBandScheme } from "./source";

/**
 * Decimals per unit, taken from the declared precision — never chosen locally.
 *
 * Every entry points at `DECIMALS` (`docs/CALCULATION_POLICY.md` §4) so this
 * table can never drift from the precision the canonical functions round at.
 */
export const RESULT_DECIMALS: Record<ResultUnit, number> = {
  nps: DECIMALS.nps,
  index: DECIMALS.percent,
  percent: DECIMALS.percent,
  ratio: DECIMALS.percent,
  score: DECIMALS.score,
  count: 0,
};

/**
 * Record one source status against an accounting.
 *
 * `answered` is the only state that may carry a number, so a caller that has a
 * numeric value passes it and a caller that does not passes null. A numeric
 * zero increments `zeroValued`, which is what keeps "measured nought" separate
 * from "nothing there" one level above the base.
 */
export function countStatus(
  accounting: AnswerAccounting,
  status: SourceValueStatus,
  numeric: number | null = null,
): void {
  switch (status) {
    case "answered":
      accounting.answered += 1;
      if (numeric === 0) accounting.zeroValued += 1;
      return;
    case "missing":
      accounting.missing += 1;
      return;
    case "unknown":
      accounting.unknown += 1;
      return;
    case "not_applicable":
      accounting.notApplicable += 1;
      return;
    case "source_unavailable":
      accounting.sourceUnavailable += 1;
      return;
    case "not_participated":
      accounting.notParticipated += 1;
      return;
    default: {
      const exhaustive: never = status;
      throw new RangeError(`unhandled source value status: ${String(exhaustive)}`);
    }
  }
}

export function makeAccounting(): AnswerAccounting {
  return emptyAccounting();
}

export function makeBase(eligible: number, responded: number, valid: number, accounting: AnswerAccounting): ResultBase {
  return { eligible, responded, valid, accounting };
}

export { emptyBase };

/** The band scheme rule whose semantic colour matches, so labels stay configuration. */
export function bandLabel(scheme: ResultBandScheme | undefined, semanticColor: SemanticColor): string | null {
  if (!scheme) return null;
  const rule = scheme.rules.find((candidate) => candidate.semanticColor === semanticColor);
  return rule ? rule.label : null;
}

export function findScheme(source: CanonicalResultSource, key: string): ResultBandScheme | undefined {
  return source.bandSchemes.find((scheme) => scheme.key === key);
}

/**
 * Resolve a band.
 *
 * The RANGE comes from the canonical band function — one definition, shared
 * with every other consumer in the product. The LABEL comes from the study's
 * own band scheme. A study with no scheme still gets the colour; it just has
 * no words for it, which is honest and is not an error.
 */
export function resolveBand(
  source: CanonicalResultSource,
  schemeKey: string,
  family: "nps" | "csat" | "cri",
  value: number,
): ResultBand {
  const semanticColor: SemanticColor =
    family === "nps" ? npsBand(value) : family === "csat" ? csatBand(value) : criBand(value);
  return { schemeKey, semanticColor, label: bandLabel(findScheme(source, schemeKey), semanticColor) };
}

/** Resolve a band from a scheme's own ranges, for a scheme with no canonical function. */
export function resolveSchemeBand(scheme: ResultBandScheme | undefined, value: number): ResultBand | null {
  if (!scheme) return null;
  for (const rule of scheme.rules) {
    const aboveLower =
      rule.lowerBound === null || (rule.lowerInclusive ? value >= rule.lowerBound : value > rule.lowerBound);
    const belowUpper =
      rule.upperBound === null || (rule.upperInclusive ? value <= rule.upperBound : value < rule.upperBound);
    if (aboveLower && belowUpper) {
      return { schemeKey: scheme.key, semanticColor: rule.semanticColor, label: rule.label };
    }
  }
  return null;
}

/**
 * Wrap an already-rounded number as a final, display-ready value.
 *
 * `value` must arrive rounded by the canonical function that defines the
 * metric. `formatNumber` re-applies the same helper at the same precision,
 * which cannot move an already-rounded number — so the value is rounded once
 * and the browser is never asked to round at all.
 */
export function makeValue(value: number, unit: ResultUnit, band: ResultBand | null = null): ResultValue {
  const decimals = RESULT_DECIMALS[unit];
  return { value, unit, decimals, formatted: formatNumber(value, decimals), band };
}

/**
 * A share of a base — or NULL when there is no base.
 *
 * Delegates to the canonical `percentage`: a rounded percentage is defined once,
 * in the calc layer, and this module does not get to hold a second copy of it.
 *
 * The null is the whole point. `percentage(n, 0)` returns 0 as a division
 * guard, and a share of a base nobody is in is exactly the "0 that is not a
 * measured zero" the contract exists to keep apart — so it is refused here
 * rather than published as three tidy zero percentages beside an `unavailable`
 * headline.
 */
export function share(count: number, total: number): number | null {
  if (total === 0) return null;
  return percentage(count, total, DECIMALS.percent);
}

export type ProvenanceInput = {
  calculationVersion: string;
  explanation: string;
  metricKey?: string | null;
  sources: string[];
  authorityIds: string[];
  notes?: string[];
};

export function makeProvenance(input: ProvenanceInput): ResultProvenance {
  return {
    calculationVersion: input.calculationVersion,
    explanation: input.explanation,
    internal: {
      metricKey: input.metricKey ?? null,
      sources: input.sources,
      authorities: authorities(...input.authorityIds),
      notes: input.notes ?? [],
    },
  };
}

export type MetricEnvelope = {
  key: string;
  label: string;
  base: ResultBase;
  provenance: ResultProvenance;
};

export function availableMetric(envelope: MetricEnvelope, value: ResultValue): MetricResult {
  return { ...envelope, status: "available", value };
}

export function unavailableMetric(
  envelope: MetricEnvelope,
  reason: UnavailableReason,
  detail: string,
): MetricResult {
  return { ...envelope, status: "unavailable", reason, detail };
}

/**
 * Why there was nothing to calculate, decided from the base rather than guessed.
 *
 * The order matters: "nobody was eligible" and "nobody answered" are different
 * facts about the same zero, and collapsing them is exactly how a study with a
 * missing instrument comes to look like a study with unhappy respondents.
 */
export function reasonForEmptyBase(base: ResultBase, filtered: boolean): UnavailableReason {
  if (filtered && base.eligible === 0) return "empty_filtered_population";
  if (base.eligible === 0) return "no_eligible_population";
  if (base.responded === 0) return "no_responses";
  return "no_valid_answers";
}
