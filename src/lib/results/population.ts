/**
 * POPULATION — and the reason it is not a denominator.
 *
 * A chapter of sixty people is a population. Twenty-eight of them were asked
 * the satisfaction instrument; thirty-nine answered the recommendation question
 * across two cohorts; eleven of the thirty-two who left filled in an exit
 * survey. Four different numbers, all true, and only the last three are ever a
 * denominator. This module reports every one of them separately and never
 * collapses them, because collapsing them is precisely how a study of sixty
 * comes to be published as if sixty people had answered everything.
 */

import type { CohortResult, InstrumentBaseResult, PopulationResult } from "./contract";
import { countStatus, makeAccounting, makeBase, makeProvenance } from "./measure";
import { buildLookup, scopeParticipants, type ResultLookup, type ResultScope } from "./lookup";
import type { CanonicalResultSource } from "./source";
import type { StudyResultsSpec } from "./spec";

/**
 * A participant counts as MEASURED when the study holds at least one datum
 * about them: a session they answered, a typed attribute they filled in, or a
 * performance observation. Non-participation is not a datum about a person's
 * experience — it is a datum about the study — so it does not count here.
 */
function measuredParticipantIds(
  source: CanonicalResultSource,
  spec: StudyResultsSpec,
  lookup: ResultLookup,
): Set<string> {
  const measured = new Set<string>();
  for (const session of source.sessions) {
    if (session.status === "answered") measured.add(session.participantId);
  }
  for (const observation of source.performanceObservations) {
    if (observation.status === "answered") measured.add(observation.participantId);
  }
  // Roster attributes are NOT evidence of participation and are deliberately
  // not counted; only the declared measurement columns are.
  const measurementKeys = new Set(spec.measuredDatumAttributeKeys);
  for (const value of source.attributeValues) {
    if (value.status === "answered" && measurementKeys.has(value.attributeKey)) {
      measured.add(value.participantId);
    }
  }
  // Only participants the source actually carries; an id from a stale index
  // would inflate the count.
  for (const id of [...measured]) {
    if (!lookup.participantById.has(id)) measured.delete(id);
  }
  return measured;
}

export function buildPopulation(
  source: CanonicalResultSource,
  spec: StudyResultsSpec,
  scope: ResultScope,
  lookup: ResultLookup = buildLookup(source),
): PopulationResult {
  const measured = measuredParticipantIds(source, spec, lookup);

  const declaredCohortKeys = spec.cohorts.map((cohort) => cohort.key);
  const extraCohortKeys = [...lookup.participantsByCohort.keys()]
    .filter((key) => !declaredCohortKeys.includes(key))
    .sort();

  const cohorts: CohortResult[] = [];
  for (const cohortKey of [...declaredCohortKeys, ...extraCohortKeys]) {
    const declared = spec.cohorts.find((cohort) => cohort.key === cohortKey);
    const participants = scopeParticipants(lookup, scope, [cohortKey]);
    if (participants.length === 0 && !declared) continue;

    let responded = 0;
    let notParticipated = 0;
    let unknown = 0;
    for (const participant of participants) {
      if (participant.surveyParticipationStatus === "responded") responded += 1;
      else if (participant.surveyParticipationStatus === "not_participated") notParticipated += 1;
      else unknown += 1;
    }

    // A cohort whose source carries no participation column reports `unknown`
    // for every member. That is not "nobody answered": the answer lives in the
    // cohort's own instrument, so it is read from there instead of invented.
    if (declared?.instrumentKey && unknown === participants.length && participants.length > 0) {
      const answeredSessions = new Set(
        (lookup.sessionsByInstrument.get(declared.instrumentKey) ?? [])
          .filter((session) => session.status === "answered" && scope.participantIds.has(session.participantId))
          .map((session) => session.participantId),
      );
      responded = participants.filter((participant) => answeredSessions.has(participant.participantId)).length;
      unknown = participants.length - responded;
      notParticipated = 0;
    }

    cohorts.push({
      key: cohortKey,
      label: declared?.label ?? cohortKey,
      total: participants.length,
      measured: participants.filter((participant) => measured.has(participant.participantId)).length,
      responded,
      notParticipated,
      participationUnknown: unknown,
    });
  }

  const instruments: InstrumentBaseResult[] = [];
  for (const instrument of source.instruments) {
    const allSessions = lookup.sessionsByInstrument.get(instrument.key) ?? [];
    // WHICH cohorts an instrument was put to is a study fact. Deriving it from
    // the filtered sessions would let a selection shrink it — and with it the
    // eligible base — so an instrument twelve eligible people simply did not
    // answer would report an eligible base of zero and read as fully covered.
    const cohortKeys = [
      ...new Set(
        allSessions
          .map((session) => lookup.participantById.get(session.participantId)?.cohortKey)
          .filter((key): key is string => typeof key === "string"),
      ),
    ];
    const sessions = allSessions.filter((session) => scope.participantIds.has(session.participantId));
    const accounting = makeAccounting();
    for (const session of sessions) countStatus(accounting, session.status);
    const answered = sessions.filter((session) => session.status === "answered").length;
    const eligible = scopeParticipants(lookup, scope, cohortKeys).length;
    instruments.push({
      key: instrument.key,
      label: instrument.label,
      cohortKeys,
      base: makeBase(eligible, sessions.length, answered, accounting),
    });
  }

  const total = scopeParticipants(
    lookup,
    scope,
    [...declaredCohortKeys, ...extraCohortKeys],
  ).length;

  return {
    total,
    measured: [...measured].filter((id) => scope.participantIds.has(id)).length,
    cohorts,
    instruments,
    provenance: makeProvenance({
      calculationVersion: spec.calculationVersion,
      explanation:
        "Cuántas personas contempla el estudio, cómo se reparten entre sus cohortes y sobre cuántas " +
        "respuestas informa cada instrumento. La población del estudio no es el denominador de " +
        "ningún indicador: cada uno declara la base que realmente lo sostiene.",
      sources: ["study_participant", "survey_session", "participant_attribute_value", "performance_observation"],
      authorityIds: ["workbook-cohorts", "catalog-2-ausencia", "approved-dashboard"],
      notes: [
        "«measured» cuenta a quien dejó al menos un dato medido: una sesión respondida, una " +
          "observación de desempeño, o un valor en una columna de medición declarada. Los atributos " +
          "de padrón (giro, tipo de empresa, fechas de vigencia) NO cuentan: existen para todo el " +
          "mundo y no prueban participación alguna.",
        "La definición de «dato medido» es una decisión de producto registrada por el tablero " +
          "aprobado; la documentación metodológica no la enuncia.",
      ],
    }),
  };
}
