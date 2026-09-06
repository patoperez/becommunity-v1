/**
 * RECOMMENDATION — Net Promoter Score, per scope.
 *
 * The FORMULA is `beCommunityNps` and is defined once, in
 * `src/lib/calc/business-metrics.ts`. Nothing here recomputes it. What this
 * module decides is the BASE: which cohorts a scope pools, which item carries
 * the recommendation answer, and which answers the scale admits.
 *
 * A scope that pools two instruments is a wider base, not a different formula.
 * The projection declares one metric definition per instrument, so a pooled
 * scope carries no canonical metric key — and says so, rather than borrowing
 * one of the two it pooled.
 */

import { beCommunityNps } from "../calc/business-metrics";
import type { NpsScopeResult } from "./contract";
import { buildLookup, type ResultLookup, type ResultScope } from "./lookup";
import {
  availableMetric,
  countStatus,
  makeAccounting,
  makeBase,
  makeProvenance,
  makeValue,
  reasonForEmptyBase,
  resolveBand,
  share,
  unavailableMetric,
} from "./measure";
import { scopeParticipants } from "./lookup";
import type { CanonicalResultSource } from "./source";
import type { StudyResultsSpec } from "./spec";

const EXPLANATION =
  "Qué tan probable es que las personas recomienden el capítulo. Se reporta como un saldo entre " +
  "quienes lo recomiendan con más entusiasmo y quienes no lo harían, sobre las personas que " +
  "contestaron esa pregunta.";

export function buildRecommendation(
  source: CanonicalResultSource,
  spec: StudyResultsSpec,
  scope: ResultScope,
  lookup: ResultLookup = buildLookup(source),
): NpsScopeResult[] {
  const { min, max } = spec.recommendation.scale;

  return spec.recommendation.scopes.map((scopeSpec) => {
    const sessionIds = new Set<string>();
    for (const instrumentKey of scopeSpec.instrumentKeys) {
      for (const session of lookup.sessionsByInstrument.get(instrumentKey) ?? []) {
        if (scope.participantIds.has(session.participantId)) sessionIds.add(session.sessionId);
      }
    }

    const accounting = makeAccounting();
    const scores: number[] = [];
    let records = 0;
    for (const itemKey of scopeSpec.itemKeys) {
      for (const answer of lookup.answersByItem.get(itemKey) ?? []) {
        if (!sessionIds.has(answer.sessionId)) continue;
        records += 1;
        countStatus(accounting, answer.status, answer.numeric);
        if (answer.status !== "answered") continue;
        const value = answer.numeric;
        if (value === null || !Number.isSafeInteger(value) || value < min || value > max) {
          accounting.outOfScale += 1;
          continue;
        }
        scores.push(value);
      }
    }

    const eligible = scopeParticipants(lookup, scope, scopeSpec.cohortKeys).length;
    const result = beCommunityNps(scores);
    const base = makeBase(eligible, records, result?.total ?? 0, accounting);

    const provenance = makeProvenance({
      calculationVersion: spec.calculationVersion,
      explanation: EXPLANATION,
      metricKey: scopeSpec.metricKey,
      sources: ["survey_session", "survey_response", "response_option"],
      authorityIds: scopeSpec.authorityIds,
      notes:
        scopeSpec.instrumentKeys.length > 1
          ? [
              "Alcance combinado: agrupa las respuestas de " +
                scopeSpec.instrumentKeys.join(" y ") +
                ". La fórmula es la misma; sólo la base es más ancha, y la base va declarada en el resultado.",
            ]
          : [],
    });

    const envelope = { key: `nps_${scopeSpec.key}`, label: scopeSpec.label, base, provenance };

    // No valid base is no distribution. Three zero counts beside an
    // `unavailable` headline would read as a chapter with no promoters and no
    // detractors, which is a measurement nobody made.
    const distribution =
      result === null
        ? { promoters: null, passives: null, detractors: null }
        : { promoters: result.promoters, passives: result.passives, detractors: result.detractors };

    return {
      key: scopeSpec.key,
      label: scopeSpec.label,
      cohortKeys: scopeSpec.cohortKeys,
      score:
        result === null
          ? unavailableMetric(
              envelope,
              reasonForEmptyBase(base, scope.filtered),
              "No hay respuestas válidas de recomendación en esta selección.",
            )
          : availableMetric(
              envelope,
              makeValue(result.nps, "nps", resolveBand(source, spec.bandSchemeKeys.nps, "nps", result.nps)),
            ),
      distribution,
      distributionShare: {
        promoters: share(distribution.promoters ?? 0, result?.total ?? 0),
        passives: share(distribution.passives ?? 0, result?.total ?? 0),
        detractors: share(distribution.detractors ?? 0, result?.total ?? 0),
      },
      scale: { min, max },
    };
  });
}
