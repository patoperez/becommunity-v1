/**
 * PERFORMANCE — the monthly observations, and the semaphore the source supports.
 *
 * The band ranges are DOCUMENTED CONFIGURATION carried on the study's own band
 * scheme (gray 0–29, red 30–49, yellow 50–69, green 70–100 for this source).
 * They are never read off the workbook's colours: a colour is uninterpreted
 * evidence until a human rules on it, and the same fill means different things
 * on different sheets.
 *
 * EVERY MONTH HAS ITS OWN DENOMINATOR. A member who had not joined yet has no
 * score for that month, and that absence is `source_unavailable`, not a zero.
 * The mean of a month is therefore over the members the month actually
 * measured — which is why each period reports its own base rather than sharing
 * the cohort's.
 */

import { mean } from "../calc/metrics";
import type { PerformanceDimensionResult, PerformancePeriodResult, SemanticColor } from "./contract";
import { buildLookup, scopeParticipants, type ResultLookup, type ResultScope } from "./lookup";
import {
  availableMetric,
  countStatus,
  findScheme,
  makeAccounting,
  makeBase,
  makeProvenance,
  makeValue,
  reasonForEmptyBase,
  resolveSchemeBand,
  unavailableMetric,
} from "./measure";
import type { CanonicalResultSource } from "./source";
import type { StudyResultsSpec } from "./spec";

const EXPLANATION =
  "El nivel de desempeño observado en el periodo, promediado sobre las personas de las que el " +
  "periodo tiene registro.";

/**
 * Put the observed bands into the SCHEME's declared display order.
 *
 * Two rules may legitimately share a semantic colour, so a colour takes the
 * position of the FIRST rule that uses it and is emitted once. A colour no rule
 * declares — `neutral`, the bucket an unbanded value falls into — is emitted
 * after every declared one, ordered by codepoint so the tail is deterministic
 * too. Only colours that actually occurred appear: an empty band is an absence,
 * not a zero.
 */
function orderBands(
  scheme: { rules: { semanticColor: SemanticColor; displayOrder: number }[] } | null | undefined,
  counted: Map<SemanticColor, { label: string | null; count: number }>,
): { semanticColor: SemanticColor; label: string | null; count: number }[] {
  const declared: SemanticColor[] = [];
  for (const rule of [...(scheme?.rules ?? [])].sort((a, b) => a.displayOrder - b.displayOrder)) {
    if (!declared.includes(rule.semanticColor)) declared.push(rule.semanticColor);
  }
  const rest = [...counted.keys()]
    .filter((color) => !declared.includes(color))
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return [...declared, ...rest]
    .filter((color) => counted.has(color))
    .map((semanticColor) => {
      const entry = counted.get(semanticColor)!;
      return { semanticColor, label: entry.label, count: entry.count };
    });
}

export function buildPerformance(
  source: CanonicalResultSource,
  spec: StudyResultsSpec,
  scope: ResultScope,
  lookup: ResultLookup = buildLookup(source),
): PerformanceDimensionResult[] {
  return source.performanceDimensions
    .slice()
    .sort((a, b) => a.displayOrder - b.displayOrder)
    .map((dimension) => {
      const allObservations = source.performanceObservations.filter(
        (observation) => observation.dimensionKey === dimension.key,
      );
      // The cohorts this dimension can measure are the cohorts it HAS measured,
      // taken before the filter. Counting every cohort in the study would put
      // people the dimension cannot reach into its eligible base — for
      // Cuicuilco the monthly block exists on the active roster only, so a
      // month covering all 28 active members would have read as 28 of 60.
      const cohortKeys = [
        ...new Set(
          allObservations
            .map((observation) => lookup.participantById.get(observation.participantId)?.cohortKey)
            .filter((key): key is string => typeof key === "string"),
        ),
      ];
      const observations = allObservations.filter((observation) =>
        scope.participantIds.has(observation.participantId),
      );

      const byPeriod = new Map<string, typeof observations>();
      for (const observation of observations) {
        const list = byPeriod.get(observation.periodStart);
        if (list) list.push(observation);
        else byPeriod.set(observation.periodStart, [observation]);
      }

      const schemeKey = dimension.bandSchemeKey ?? spec.bandSchemeKeys.performance;
      const scheme = findScheme(source, schemeKey);

      const periods: PerformancePeriodResult[] = [...byPeriod.entries()]
        .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
        .map(([periodStart, rows]) => {
          const accounting = makeAccounting();
          const values: number[] = [];
          for (const row of rows) {
            countStatus(accounting, row.status, row.value);
            if (row.status === "answered" && row.value !== null) values.push(row.value);
          }
          const eligible = scopeParticipants(lookup, scope, cohortKeys).length;
          const base = makeBase(eligible, rows.length, values.length, accounting);
          const average = mean(values);

          const bandCounts = new Map<SemanticColor, { label: string | null; count: number }>();
          for (const value of values) {
            const band = resolveSchemeBand(scheme, value);
            const key: SemanticColor = band?.semanticColor ?? "neutral";
            const entry = bandCounts.get(key);
            if (entry) entry.count += 1;
            else bandCounts.set(key, { label: band?.label ?? null, count: 1 });
          }

          const envelope = {
            key: `performance_${dimension.key}_${periodStart}`,
            label: rows[0]?.periodLabel ?? periodStart,
            base,
            provenance: makeProvenance({
              calculationVersion: spec.calculationVersion,
              explanation: EXPLANATION,
              sources: ["performance_observation", "band_scheme"],
              authorityIds: ["catalog-2-ausencia", "canonical-model-projection"],
              notes: [
                "Los rangos del semáforo son configuración documentada del esquema de bandas del " +
                  "estudio; no se derivan del color del libro, que se conserva aparte como evidencia " +
                  "sin interpretar.",
                "Cada mes tiene su propio denominador: una persona que aún no se había incorporado no " +
                  "tiene registro ese mes, y esa ausencia no es un cero.",
              ],
            }),
          };

          return {
            dimensionKey: dimension.key,
            periodStart,
            label: rows[0]?.periodLabel ?? periodStart,
            mean:
              average === null
                ? unavailableMetric(
                    envelope,
                    reasonForEmptyBase(base, scope.filtered),
                    "Este periodo no tiene ninguna observación con valor en esta selección.",
                  )
                : availableMetric(envelope, makeValue(average, "score", resolveSchemeBand(scheme, average))),
            // In the SCHEME's own display order, never in the order the values
            // happened to arrive. A `Map` iterates by insertion, so emitting it
            // directly made the semaphore's order depend on which respondent's
            // score was read first — the same data in a different row order
            // produced a different (equivalent) array. The counts never moved,
            // but a document that is only deterministic for one input ordering
            // is not deterministic, and the two adapters' outputs could not be
            // compared. A colour with no rule — `neutral`, which is what an
            // unbanded value falls into — has no place in that order and goes
            // last, by codepoint.
            bandCounts: orderBands(scheme, bandCounts),
          };
        });

      return {
        key: dimension.key,
        label: dimension.label,
        order: dimension.displayOrder,
        periods,
      };
    });
}
