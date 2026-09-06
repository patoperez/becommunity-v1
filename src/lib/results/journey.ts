/**
 * THE JOURNEY — measured touchpoints, their groups, and the link nobody stated.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT IS PROVEN, AND BY WHOM.
 *
 *   The GROUPS are the source's. The satisfaction sheet carries exactly four
 *   merged ranges on its band row, and those four bands are what put fifty-five
 *   touchpoints into four categories. The process documentation names the same
 *   four categories for this client and says «En el dashboard separar cada
 *   categoría» — but it does NOT say which touchpoint belongs to which. The
 *   workbook does. Group membership is therefore workbook evidence, and column
 *   order on the header row is the order inside a group.
 *
 *   WHAT A TOUCHPOINT OWNS is settled, and it is a rule rather than a gap. A
 *   touchpoint DIRECTLY owns its satisfaction result, its TDP and the auxiliary
 *   unawareness share, each with its own base. Study-level metrics —
 *   recommendation, renewal risk, retention, attrition, LTV — are NOT
 *   implicitly attached to a touchpoint or a stage, and no generic association
 *   is ever inferred. The methodology owner decided this on 2026-09-06, and it
 *   agrees with §7.2, which collapses stage into touchpoint outright: «Las
 *   etapas son puntos de contacto o touchpoints».
 *
 *   Anything further is a CONFIGURATION ACT. A future study may declare a
 *   stage-to-metric link explicitly, with provenance, and the contract carries
 *   it; nothing infers one. Adjacency is not evidence, two labels that sound
 *   alike are not evidence, and the approved dashboard's hand-written alias
 *   table is an implementation rather than an authority — it is not copied here.
 *
 * TWO UNAWARENESS QUANTITIES, and the name is settled. `processUnawarenessTdp`
 * IS the Tasa de Desconocimiento de Proceso; `unawarenessShareOfResponses` is a
 * useful auxiliary proportion over a wider denominator and is never called TDP.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import {
  processUnawarenessTdp,
  touchpointCsatOnScale,
  unawarenessShareOfResponses,
} from "../calc/business-metrics";
import { normalizeToken } from "../ingestion/canonical-package/values";
import { authorities } from "./authorities";
import type {
  JourneyExclusion,
  JourneyGroupResult,
  JourneyModelResult,
  JourneyResult,
  JourneyStageEvidenceResult,
  JourneyStageEvidenceLink,
  JourneyTouchpointResult,
  MetricResult,
} from "./contract";
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
  unavailableMetric,
} from "./measure";
import { scopeParticipants } from "./lookup";
import type { CanonicalResultSource, ResultItem } from "./source";
import type { StudyResultsSpec } from "./spec";

/**
 * A column the source itself could not produce a value for.
 *
 * `#REF!` and its relatives are classified `source_unavailable` before anything
 * downstream sees them, so a touchpoint whose every record is that state is a
 * broken column, not an unpopular process. It is removed from the journey and
 * REPORTED as removed — never dropped in silence, and never reported as a
 * satisfaction of zero.
 */
const SOURCE_ERROR_RULE = "source_error_column";

type Tally = {
  records: number;
  ratings: number[];
  satisfied: number;
  dissatisfied: number;
  unaware: number;
  answered: number;
  sourceUnavailable: number;
  accounting: ReturnType<typeof makeAccounting>;
};

function tallyTouchpoint(
  lookup: ResultLookup,
  spec: StudyResultsSpec,
  item: ResultItem,
  sessionIds: Set<string>,
): Tally {
  const accounting = makeAccounting();
  const unawareLabels = new Set(spec.unawareness.derivedLabels.map(normalizeToken));
  const unawareValues = new Set(spec.unawareness.rawValues.map(normalizeToken));
  const { min, max, satisfiedFrom } = spec.satisfactionScale;

  const ratings: number[] = [];
  let records = 0;
  let unaware = 0;
  let answered = 0;
  let sourceUnavailable = 0;

  for (const answer of lookup.answersByItem.get(item.key) ?? []) {
    if (!sessionIds.has(answer.sessionId)) continue;
    records += 1;
    countStatus(accounting, answer.status, answer.numeric);
    if (answer.status === "source_unavailable") sourceUnavailable += 1;
    if (answer.status !== "answered") continue;
    answered += 1;

    const value = answer.numeric;
    if (value !== null && Number.isSafeInteger(value) && value >= min && value <= max) {
      ratings.push(value);
      continue;
    }
    const isUnaware =
      (answer.derivedLabel !== null && unawareLabels.has(normalizeToken(answer.derivedLabel))) ||
      (answer.optionRawValue !== null && unawareValues.has(normalizeToken(answer.optionRawValue)));
    if (isUnaware) {
      unaware += 1;
      accounting.phenomenon += 1;
      continue;
    }
    accounting.outOfScale += 1;
  }

  return {
    records,
    ratings,
    satisfied: ratings.filter((rating) => rating >= satisfiedFrom).length,
    dissatisfied: ratings.filter((rating) => rating < satisfiedFrom).length,
    unaware,
    answered,
    sourceUnavailable,
    accounting,
  };
}

const CSAT_EXPLANATION =
  "Qué proporción de las personas que pudieron evaluar este punto de contacto quedó satisfecha con él.";
const TDP_EXPLANATION =
  "Cuánto pesa el desconocimiento de este punto de contacto frente a las personas que sí pudieron evaluarlo. " +
  "Puede superar el cien por ciento cuando quienes no lo conocen son más que quienes lo evaluaron.";
const UNAWARE_SHARE_EXPLANATION =
  "Qué proporción de quienes respondieron sobre este punto de contacto declaró no conocerlo o no haberlo usado.";

export function buildJourney(
  source: CanonicalResultSource,
  spec: StudyResultsSpec,
  scope: ResultScope,
  lookup: ResultLookup = buildLookup(source),
): JourneyResult {
  const instrumentKey = spec.journeyInstrumentKey;
  const instrumentSessions = lookup.sessionsByInstrument.get(instrumentKey) ?? [];
  /**
   * Whether a column is broken is a property of the SOURCE, not of a selection.
   *
   * Deciding it inside the filtered scope would make a filter change which
   * touchpoints exist: a narrow selection could let a `#REF!` column back into
   * the journey (no records in scope, so the guard cannot fire), and a
   * selection whose few members all happen to lack a value could brand a
   * perfectly healthy column a spreadsheet error. Both are decided here, once,
   * over every session the instrument has.
   */
  const allSessionIds = new Set(instrumentSessions.map((session) => session.sessionId));
  const sessionIds = new Set(
    instrumentSessions
      .filter((session) => scope.participantIds.has(session.participantId))
      .map((session) => session.sessionId),
  );
  const eligibleCohorts = [
    ...new Set(
      instrumentSessions
        .map((session) => lookup.participantById.get(session.participantId)?.cohortKey)
        .filter((key): key is string => typeof key === "string"),
    ),
  ];
  const eligible = scopeParticipants(lookup, scope, eligibleCohorts).length;

  const domains = source.domains
    .filter((domain) => domain.instrumentKey === instrumentKey)
    .slice()
    .sort((a, b) => a.displayOrder - b.displayOrder);

  const touchpoints: JourneyTouchpointResult[] = [];
  const excluded: JourneyExclusion[] = [];
  const groups: JourneyGroupResult[] = [];

  const groupProvenance = makeProvenance({
    calculationVersion: spec.calculationVersion,
    explanation:
      "Los puntos de contacto se agrupan tal como los agrupa la fuente del estudio, y se presentan " +
      "en el orden en que la fuente los presenta.",
    sources: ["study_domain", "survey_item"],
    authorityIds: ["workbook-csat-merged-bands", "methodology-4-1-categorias-csat"],
    notes: [
      "La pertenencia de cada punto a su categoría es evidencia del libro: los cuatro rangos " +
        "combinados de la fila de bandas son lo único que la enuncia. La documentación integral " +
        "nombra las cuatro categorías pero no dice qué punto va en cuál.",
    ],
  });

  for (const domain of domains) {
    const items = (lookup.itemsByDomain.get(domain.key) ?? []).slice().sort((a, b) => a.itemOrder - b.itemOrder);
    const keptKeys: string[] = [];

    for (const [order, item] of items.entries()) {
      // The exclusion decision is taken over the WHOLE column; the reported
      // numbers are taken inside the selection. They are different questions.
      const sourceTally = tallyTouchpoint(lookup, spec, item, allSessionIds);
      const tally = tallyTouchpoint(lookup, spec, item, sessionIds);

      if (
        sourceTally.records > 0 &&
        sourceTally.answered === 0 &&
        sourceTally.sourceUnavailable === sourceTally.records
      ) {
        const named = spec.excludedTouchpoints.find(
          (rule) =>
            (rule.itemKey !== null && rule.itemKey === item.key) ||
            (rule.label !== null && normalizeToken(rule.label) === normalizeToken(item.label)),
        );
        excluded.push({
          key: item.key,
          label: item.label,
          ruleId: named?.ruleId ?? SOURCE_ERROR_RULE,
          detail:
            named?.detail ??
            "Todas las respuestas de esta columna son un error de la hoja de cálculo, de modo que la " +
              "fuente no produjo valor alguno. La columna queda fuera del recorrido y se reporta como excluida.",
          authorityId: named?.authorityId ?? null,
        });
        continue;
      }

      const valid = tally.ratings.length;
      const responses = valid + tally.unaware;
      const base = makeBase(eligible, tally.records, valid, tally.accounting);
      const csat = touchpointCsatOnScale(tally.ratings, {
        min: spec.satisfactionScale.min,
        max: spec.satisfactionScale.max,
        satisfiedMin: spec.satisfactionScale.satisfiedFrom,
      });

      const satisfactionEnvelope = {
        key: `csat_${item.key}`,
        label: item.label,
        base,
        provenance: makeProvenance({
          calculationVersion: spec.calculationVersion,
          explanation: CSAT_EXPLANATION,
          metricKey: lookup.metricByKey.has(`csat_item_${item.key}`) ? `csat_item_${item.key}` : null,
          sources: ["survey_response", "response_option", "survey_item"],
          authorityIds: ["methodology-4-1-csat", "catalog-4-csat", "workbook-csat-scale"],
          notes: [
            "No existe un CSAT general obtenido promediando puntos de contacto: el catálogo lo " +
              "prohíbe explícitamente y este contrato no emite uno.",
          ],
        }),
      };

      // The unawareness base is every response the touchpoint received, so its
      // accounting is the same records with a different denominator.
      const unawareBase = makeBase(eligible, tally.records, responses, tally.accounting);

      const tdpEnvelope = {
        key: `tdp_${item.key}`,
        label: item.label,
        base,
        provenance: makeProvenance({
          calculationVersion: spec.calculationVersion,
          explanation: TDP_EXPLANATION,
          metricKey: lookup.metricByKey.has(`tdp_item_${item.key}`) ? `tdp_item_${item.key}` : null,
          sources: ["survey_response", "response_option"],
          authorityIds: ["methodology-4-1-tdp", "catalog-5-tdp", "owner-decision-tdp", "approved-dashboard"],
          notes: [
            "TDP: razón sobre la BASE VÁLIDA (satisfechas más insatisfechas), tal como la enuncia la " +
              "documentación integral §4.1 y como la calcula el tablero aprobado. Puede superar cien " +
              "y no se acota: acotarla borraría justamente los casos que la medida existe para mostrar.",
            "Resuelto el 6 de septiembre de 2026 por la propiedad metodológica. La documentación " +
              "integral no define bandas para esta razón, así que no se emite ninguna.",
          ],
        }),
      };

      // The auxiliary base is every classified response the touchpoint
      // received, so its accounting is the same records with a wider
      // denominator.
      const shareEnvelope = {
        key: `unaware_share_of_responses_${item.key}`,
        label: item.label,
        base: unawareBase,
        provenance: makeProvenance({
          calculationVersion: spec.calculationVersion,
          explanation: UNAWARE_SHARE_EXPLANATION,
          sources: ["survey_response", "response_option"],
          authorityIds: ["methodology-7-1-conocimiento", "owner-decision-tdp"],
          notes: [
            "Cantidad AUXILIAR, no es TDP. Proporción sobre TODAS las respuestas clasificadas del " +
              "punto (satisfechas, insatisfechas y de desconocimiento), acotada entre cero y cien. " +
              "Es el complemento de «% que conoce» del gráfico apilado de §7.1, que sólo cierra en " +
              "cien con este denominador.",
            "Se publica junto al TDP y nunca en su lugar; su denominador va declarado en la base " +
              "del propio resultado.",
          ],
        }),
      };

      const tdpRate = processUnawarenessTdp(tally.unaware, valid);
      const shareRate = unawarenessShareOfResponses(tally.unaware, responses);

      const satisfaction: MetricResult =
        csat === null
          ? unavailableMetric(
              satisfactionEnvelope,
              reasonForEmptyBase(base, scope.filtered),
              "Nadie de esta selección pudo evaluar este punto de contacto.",
            )
          : availableMetric(
              satisfactionEnvelope,
              makeValue(csat.csat, "percent", resolveBand(source, spec.bandSchemeKeys.csat, "csat", csat.csat)),
            );

      const tdp: MetricResult =
        tdpRate.value === null
          ? unavailableMetric(
              tdpEnvelope,
              reasonForEmptyBase(base, scope.filtered),
              "Nadie de esta selección pudo evaluar este punto de contacto, así que no hay base válida contra la cual medir el desconocimiento.",
            )
          : availableMetric(tdpEnvelope, makeValue(tdpRate.value, "ratio"));

      const unawareShareOfResponses: MetricResult =
        shareRate.value === null
          ? unavailableMetric(
              shareEnvelope,
              reasonForEmptyBase(unawareBase, scope.filtered),
              "Este punto de contacto no recibió respuesta alguna en esta selección.",
            )
          : availableMetric(shareEnvelope, makeValue(shareRate.value, "percent"));

      touchpoints.push({
        key: item.key,
        label: item.label,
        shortLabel: null,
        groupKey: domain.key,
        order,
        satisfaction,
        tdp,
        unawareShareOfResponses,
        counts: {
          satisfied: tally.satisfied,
          dissatisfied: tally.dissatisfied,
          unaware: tally.unaware,
          valid,
          responses,
        },
        scale: spec.satisfactionScale,
      });
      keptKeys.push(item.key);
    }

    groups.push({
      key: domain.key,
      label: domain.label,
      order: domain.displayOrder,
      touchpointKeys: keptKeys,
      provenance: groupProvenance,
    });
  }

  return {
    groups,
    touchpoints,
    excluded,
    curatedModels: buildCuratedModels(source),
    stageEvidence: buildStageEvidence(source),
  };
}

function buildCuratedModels(source: CanonicalResultSource): JourneyModelResult[] {
  return source.journeyModels
    .slice()
    .sort((a, b) => a.displayOrder - b.displayOrder)
    .map((model) => ({
      key: model.key,
      label: model.label,
      audience: model.audience,
      stages: source.journeyStages
        .filter((stage) => stage.journeyModelKey === model.key)
        .slice()
        .sort((a, b) => a.stageOrder - b.stageOrder)
        .map((stage) => ({ key: stage.key, label: stage.label, order: stage.stageOrder })),
    }));
}

/**
 * The mapping-gap report.
 *
 * One entry per curated stage, each stating that no authority links a metric to
 * it. `provenMetricKeys` is empty and stays empty: a list of "likely" metrics
 * would be a guess wearing a data structure, and a consultant reading it would
 * have no way to tell it apart from a relationship somebody actually made.
 */
/**
 * The journey stage-evidence result — a SETTLED CONTRACT RULE.
 *
 * A touchpoint owns its satisfaction and its two unawareness results directly.
 * No study-level metric is implicitly attached to a touchpoint or a stage, and
 * no generic association is ever inferred. That is the answer, not a gap in
 * one: reporting it as an unresolved question per curated stage described a
 * working design as a permanent defect, and it stopped doing that on
 * 2026-09-06 when the methodology owner settled the rule.
 *
 *  carries exactly what a study or template EXPLICITLY configured, with
 * provenance. For Cuicuilco v1 the projection supplies none, so it is empty —
 * and empty is correct, not incomplete.
 */
export function buildStageEvidence(source: CanonicalResultSource): JourneyStageEvidenceResult {
  const links: JourneyStageEvidenceLink[] = source.journeyStageEvidence.map((link) => ({
    stageKey: link.journeyStageKey,
    metricKey: link.metricKey,
    itemKey: link.itemKey,
    performanceDimensionKey: link.performanceDimensionKey,
    role: link.role,
  }));

  return {
    status: "requires_explicit_configuration",
    rule: "journey_stage_evidence_is_explicit_only",
    detail:
      "Un punto de contacto posee directamente su CSAT, su TDP y la proporción auxiliar de " +
      "desconocimiento, cada uno con su base. Los indicadores de estudio —recomendación, riesgo " +
      "de renovación, retención, deserción, LTV— NO se adscriben implícitamente a un punto de " +
      "contacto ni a una etapa, y no se infiere ninguna asociación genérica. La documentación " +
      "integral §7.2 colapsa etapa y punto de contacto, de modo que no existe una capa " +
      "intermedia a la que un indicador pudiera adscribirse por sí solo. Esto es una regla del " +
      "contrato, no una incertidumbre del estudio.",
    configuredBy:
      "Configuración explícita de estudio o plantilla, con procedencia, que nombre indicador y " +
      "etapa en la misma declaración. La proyección canónica la transporta tal cual; nada la " +
      "deduce, y la tabla de alias escrita a mano del tablero de emergencia no se copia aquí.",
    links,
    authorities: authorities(
      "owner-decision-journey-metrics",
      "methodology-7-2-journey",
      "methodology-4-1-csat",
      "canonical-model-projection",
    ),
  };
}
