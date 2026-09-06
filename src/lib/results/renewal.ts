/**
 * RENEWAL INTENTION — the churn-risk index and its distribution.
 *
 * A LOWER intention to continue is a HIGHER risk, and the weights invert
 * accordingly. `churnRiskIndex` in `src/lib/calc/business-metrics.ts` is the
 * definition; this module supplies its base and reports the five categories
 * beside the index, because the index alone hides which rung people chose.
 *
 * A category nobody chose is reported with a count of ZERO — a measured zero,
 * not an absence. The distribution has five rungs whether or not the source
 * happens to exercise all five, so a reader can see the shape of the answer.
 *
 * `Esfera` may not be crossed with this indicator. That refusal is an authority
 * decision (`§5.2`), it is declared in the study's results specification, and a
 * caller that constrains it gets `cross_not_permitted` rather than a number.
 */

import { CRI_ALERT_LEVELS, CRI_ORDER, CRI_RESPONSE_LABELS, CRI_RISK_POINTS, churnRiskIndex, criResponseFromLabel, type CriResponse } from "../calc/business-metrics";
import type { RenewalCategoryResult, RenewalResult } from "./contract";
import { crossIsForbidden } from "./filters";
import { buildLookup, scopeParticipants, type ResultLookup, type ResultScope } from "./lookup";
import {
  availableMetric,
  countStatus,
  emptyBase,
  makeAccounting,
  makeBase,
  makeProvenance,
  makeValue,
  reasonForEmptyBase,
  resolveBand,
  share,
  unavailableMetric,
} from "./measure";
import type { CanonicalResultSource } from "./source";
import type { StudyResultsSpec } from "./spec";

const EXPLANATION =
  "Cuánto riesgo de no continuar concentra el grupo, a partir de qué tan probable declara cada " +
  "persona que renovará su membresía. Cuanto más alto el resultado, mayor el riesgo.";

export function buildRenewal(
  source: CanonicalResultSource,
  spec: StudyResultsSpec,
  scope: ResultScope,
  constrainedDimensionKeys: string[],
  lookup: ResultLookup = buildLookup(source),
): RenewalResult {
  const sessionIds = new Set(
    (lookup.sessionsByInstrument.get(spec.renewal.instrumentKey) ?? [])
      .filter((session) => scope.participantIds.has(session.participantId))
      .map((session) => session.sessionId),
  );
  const cohortKeys = [
    ...new Set(
      (lookup.sessionsByInstrument.get(spec.renewal.instrumentKey) ?? [])
        .map((session) => lookup.participantById.get(session.participantId)?.cohortKey)
        .filter((key): key is string => typeof key === "string"),
    ),
  ];
  const eligible = scopeParticipants(lookup, scope, cohortKeys).length;

  const accounting = makeAccounting();
  const counts = new Map<CriResponse, number>(CRI_ORDER.map((key) => [key, 0]));
  const responses: CriResponse[] = [];
  let records = 0;

  for (const answer of lookup.answersByItem.get(spec.renewal.itemKey) ?? []) {
    if (!sessionIds.has(answer.sessionId)) continue;
    records += 1;
    countStatus(accounting, answer.status, answer.numeric);
    if (answer.status !== "answered") continue;
    const label = answer.text ?? answer.optionRawValue;
    const response = label === null ? null : criResponseFromLabel(label);
    if (response === null) {
      accounting.outOfScale += 1;
      continue;
    }
    counts.set(response, (counts.get(response) ?? 0) + 1);
    responses.push(response);
  }

  const index = churnRiskIndex(responses);
  const base = makeBase(eligible, records, responses.length, accounting);

  const provenance = makeProvenance({
    calculationVersion: spec.calculationVersion,
    explanation: EXPLANATION,
    metricKey: spec.renewal.metricKey,
    sources: ["survey_session", "survey_response"],
    authorityIds: spec.renewal.authorityIds,
    notes: [
      "La documentación integral fija el puntaje de cada respuesta pero NO enuncia cómo se agrega " +
        "el índice; la agregación como media ponderada proviene de docs/CALCULATION_CATALOG.md §6.",
    ],
  });

  const envelope = { key: "cri", label: "Intención de renovación", base, provenance };

  const forbidden = crossIsForbidden(spec, "renewal", constrainedDimensionKeys);
  const distribution: RenewalCategoryResult[] = CRI_ORDER.map((key) => ({
    response: CRI_RESPONSE_LABELS[key],
    level: CRI_ALERT_LEVELS[key],
    riskPoints: CRI_RISK_POINTS[key],
    // A rung nobody chose over a real base IS a measured zero. Only an absent
    // base makes it null, and `share` decides that from the base itself.
    count: responses.length === 0 ? null : counts.get(key) ?? 0,
    share: share(counts.get(key) ?? 0, responses.length),
  }));

  if (forbidden.forbidden) {
    // The refusal is of the INDICATOR, not just its headline. The distribution
    // is withheld whole and the base is emptied, so nothing computed over a
    // cross an authority forbids is published anywhere on this result.
    return {
      index: unavailableMetric(
        {
          ...envelope,
          base: emptyBase(),
          provenance: makeProvenance({
            calculationVersion: spec.calculationVersion,
            explanation: EXPLANATION,
            metricKey: spec.renewal.metricKey,
            sources: ["survey_session", "survey_response"],
            authorityIds: [...spec.renewal.authorityIds, forbidden.authorityId, "catalog-9-cruces"],
            notes: [
              `Cruce rechazado: la dimensión '${forbidden.dimensionKey}' no puede cruzarse con este ` +
                "indicador. El rechazo es explícito; no se devuelve un número calculado sobre un " +
                "cruce que una autoridad prohíbe.",
            ],
          }),
        },
        "cross_not_permitted",
        "Una autoridad metodológica prohíbe cruzar este indicador con la dimensión seleccionada.",
      ),
      distribution: null,
      base: emptyBase(),
    };
  }

  return {
    index:
      index.value === null
        ? unavailableMetric(
            envelope,
            reasonForEmptyBase(base, scope.filtered),
            "No hay respuestas válidas de intención de renovación en esta selección.",
          )
        : availableMetric(
            envelope,
            makeValue(index.value, "index", resolveBand(source, spec.bandSchemeKeys.cri, "cri", index.value)),
          ),
    distribution,
    base,
  };
}
