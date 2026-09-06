/**
 * RETENTION AND ATTRITION — per period, over the membership roster.
 *
 * These are the only two indicators whose base is the MEMBERSHIP BODY rather
 * than the survey respondents, and even then the base is "members at the start
 * of the period" — a count from the client's own records, not a population and
 * not a response rate. Mixing that base with a respondent base is how a study
 * of sixty people ends up dividing by sixty.
 *
 * The source stores its own two rates. They are NOT read. Both are recomputed
 * from the four counts through `retentionRate` and `churnRate`, so the numbers
 * a client sees are the product's, at the product's precision, and a stored
 * rate that disagrees becomes visible instead of authoritative.
 *
 * A period whose counts are incomplete is `unavailable`, never zero, and
 * `identityVerified` records separately whether the four counts actually
 * satisfied `final = inicial − perdidos + nuevos` rather than assuming they did.
 *
 * There is no band. §7.4 says the colour range is not fixed and must be captured
 * per client, so this contract carries no retention target — a "good" retention
 * threshold is client-authored context, not a calculation rule.
 */

import { churnRate, retentionRate } from "../calc/business-metrics";
import type { PeriodCount, RetentionPeriodResult } from "./contract";
import type { ResultScope } from "./lookup";
import {
  availableMetric,
  countStatus,
  makeAccounting,
  makeBase,
  makeProvenance,
  makeValue,
  unavailableMetric,
} from "./measure";
import type { CanonicalResultSource, ResultRetentionPeriod } from "./source";
import type { StudyResultsSpec } from "./spec";

const RETENTION_EXPLANATION =
  "Qué proporción de las personas que formaban parte al inicio del periodo seguía formando parte " +
  "al final, sin contar a quienes se incorporaron durante el periodo.";
const ATTRITION_EXPLANATION =
  "Qué proporción de las personas que formaban parte al inicio del periodo dejó de formar parte " +
  "durante el periodo.";

function toCount(value: ResultRetentionPeriod["starting"]): PeriodCount {
  return { count: value.count, status: value.status };
}

/**
 * Retention and attrition are roster measurements. A participant filter selects
 * SURVEY respondents, which is a different population entirely, so a filtered
 * request does not silently reshape a roster count — it says the period is not
 * available under that selection instead.
 */
export function buildRetention(
  source: CanonicalResultSource,
  spec: StudyResultsSpec,
  scope: ResultScope,
): RetentionPeriodResult[] {
  const periods = source.retentionPeriods
    .filter((period) => period.seriesKey === spec.retention.seriesKey)
    .slice()
    .sort((a, b) => a.order - b.order);

  return periods.map((period) => {
    const accounting = makeAccounting();
    for (const cell of [period.starting, period.joined, period.ending, period.lost]) {
      countStatus(accounting, cell.status, cell.count);
    }
    const complete =
      period.starting.count !== null &&
      period.joined.count !== null &&
      period.ending.count !== null &&
      period.lost.count !== null;

    // The base of a retention period is its four SOURCE CELLS, not a count of
    // people. Putting a roster head-count in `eligible` beside a cell count in
    // `responded` would break the nesting the contract declares — a chapter of
    // three with four answered cells would read as 133% — and would turn an
    // unread `starting` cell into "nobody was eligible". The roster figure
    // lives on `starting`, where its null survives.
    // All four cells always EXIST as records — each carries a state, even when
    // that state is "the source gave no number" — so `responded` is four and
    // the six states partition them. Only `valid` moves: a period the formula
    // cannot use has no valid base at all, because the identity needs all four.
    const CELLS_PER_PERIOD = 4;
    const base = makeBase(
      CELLS_PER_PERIOD,
      CELLS_PER_PERIOD,
      complete ? CELLS_PER_PERIOD : 0,
      accounting,
    );

    const retentionProvenance = makeProvenance({
      calculationVersion: spec.calculationVersion,
      explanation: RETENTION_EXPLANATION,
      metricKey: spec.retention.retentionMetricKey,
      sources: ["retention_period"],
      authorityIds: ["methodology-4-1-retencion", "catalog-7-retencion", "workbook-retencion"],
      notes: [
        "La base es el padrón al inicio del periodo, no la población del estudio ni las personas " +
          "que respondieron una encuesta.",
        "Las tasas almacenadas en la fuente no se leen: ambas se recalculan desde los cuatro conteos.",
        "Sin banda: §7.4 dice que el rango de color no es fijo y debe capturarse por cliente.",
      ],
    });
    const attritionProvenance = makeProvenance({
      calculationVersion: spec.calculationVersion,
      explanation: ATTRITION_EXPLANATION,
      metricKey: spec.retention.churnMetricKey,
      sources: ["retention_period"],
      authorityIds: ["methodology-4-1-retencion", "catalog-7-retencion", "workbook-retencion"],
      notes: ["La base es el padrón al inicio del periodo."],
    });

    const retentionEnvelope = {
      key: `retention_${period.order}`,
      label: period.label,
      base,
      provenance: retentionProvenance,
    };
    const attritionEnvelope = {
      key: `attrition_${period.order}`,
      label: period.label,
      base,
      provenance: attritionProvenance,
    };

    if (scope.filtered) {
      const detail =
        "La retención y la deserción se miden sobre el padrón del periodo, no sobre las personas " +
        "que respondieron. Un filtro de participantes no puede reducir un conteo de padrón, así " +
        "que el periodo no se recalcula bajo esta selección.";
      return {
        seriesKey: period.seriesKey,
        order: period.order,
        label: period.label,
        startsOn: period.startsOn,
        endsOn: period.endsOn,
        starting: toCount(period.starting),
        joined: toCount(period.joined),
        ending: toCount(period.ending),
        lost: toCount(period.lost),
        identityVerified: period.identityVerified,
        retention: unavailableMetric(retentionEnvelope, "cross_not_permitted", detail),
        attrition: unavailableMetric(attritionEnvelope, "cross_not_permitted", detail),
      };
    }

    let retention;
    let attrition;
    if (!complete) {
      const detail = "La fuente no entrega los cuatro conteos del periodo, así que no hay tasa que calcular.";
      retention = unavailableMetric(retentionEnvelope, "no_valid_answers", detail);
      attrition = unavailableMetric(attritionEnvelope, "no_valid_answers", detail);
    } else {
      const starting = period.starting.count as number;
      const joined = period.joined.count as number;
      const ending = period.ending.count as number;
      const lost = period.lost.count as number;
      try {
        const crr = retentionRate(starting, ending, joined);
        retention =
          crr.value === null
            ? unavailableMetric(
                retentionEnvelope,
                "no_eligible_population",
                "El padrón al inicio del periodo es cero, así que no hay base sobre la que medir retención.",
              )
            : availableMetric(retentionEnvelope, makeValue(crr.value, "percent"));
      } catch {
        retention = unavailableMetric(
          retentionEnvelope,
          "no_valid_answers",
          "Los conteos del periodo son internamente imposibles, así que no se publica una tasa engañosa.",
        );
      }
      try {
        const cr = churnRate(starting, lost);
        attrition =
          cr.value === null
            ? unavailableMetric(
                attritionEnvelope,
                "no_eligible_population",
                "El padrón al inicio del periodo es cero, así que no hay base sobre la que medir deserción.",
              )
            : availableMetric(attritionEnvelope, makeValue(cr.value, "percent"));
      } catch {
        attrition = unavailableMetric(
          attritionEnvelope,
          "no_valid_answers",
          "Los conteos del periodo son internamente imposibles, así que no se publica una tasa engañosa.",
        );
      }
    }

    return {
      seriesKey: period.seriesKey,
      order: period.order,
      label: period.label,
      startsOn: period.startsOn,
      endsOn: period.endsOn,
      starting: toCount(period.starting),
      joined: toCount(period.joined),
      ending: toCount(period.ending),
      lost: toCount(period.lost),
      identityVerified: period.identityVerified,
      retention,
      attrition,
    };
  });
}
