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
 *   The METRIC-TO-STAGE LINK is not proven, and this module refuses it. The
 *   methodology collapses the two levels outright — «Las etapas son puntos de
 *   contacto o touchpoints» — so there is no stage layer above a touchpoint for
 *   a metric to attach to, and no document assigns recommendation, renewal
 *   risk, retention or attrition to a position in the journey. The curated
 *   eighteen-stage model the pain map carries is kept SEPARATE from the
 *   measured touchpoints, and every one of its stages is reported as a gap.
 *
 *   Adjacency is not evidence. Two labels that sound alike are not evidence.
 *   The approved dashboard resolves this with a hand-written alias table inside
 *   its own build script, which is an implementation and not an authority.
 *
 * TWO DIFFERENT UNAWARENESS QUANTITIES, both documented, both emitted. See
 * `processUnawarenessRate` and `processUnawarenessRatio` for the conflict over
 * which of them owns the name "TDP". This module does not resolve it.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import {
  processUnawarenessRate,
  processUnawarenessRatio,
  touchpointCsatOnScale,
} from "../calc/business-metrics";
import { normalizeToken } from "../ingestion/canonical-package/values";
import { authorities } from "./authorities";
import type {
  JourneyExclusion,
  JourneyGroupResult,
  JourneyModelResult,
  JourneyResult,
  JourneyStageEvidenceResult,
  JourneyStageGap,
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
const UNAWARE_SHARE_EXPLANATION =
  "Qué proporción de quienes respondieron sobre este punto de contacto declaró no conocerlo o no haberlo usado.";
const UNAWARE_RATIO_EXPLANATION =
  "Cuánto pesa el desconocimiento de este punto de contacto frente a las personas que sí pudieron evaluarlo. " +
  "Puede superar el cien por ciento cuando quienes no lo conocen son más que quienes lo evaluaron.";

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

      const unawareShareEnvelope = {
        key: `unaware_share_${item.key}`,
        label: item.label,
        base: unawareBase,
        provenance: makeProvenance({
          calculationVersion: spec.calculationVersion,
          explanation: UNAWARE_SHARE_EXPLANATION,
          sources: ["survey_response", "response_option"],
          authorityIds: ["catalog-5-tdp", "methodology-7-1-conocimiento"],
          notes: [
            "Proporción sobre TODAS las respuestas del punto (satisfechas, insatisfechas y de " +
              "desconocimiento). Acotada entre cero y cien. Es la lectura de docs/CALCULATION_CATALOG.md §5 " +
              "y la que hace sumar cien al gráfico de «% que conoce / % que no conoce» de §7.1.",
            "CONFLICTO DE AUTORIDAD sobre el NOMBRE: docs/CALCULATION_CATALOG.md §5 llama TDP a esta " +
              "proporción, mientras la documentación integral §4.1 llama TDP a la razón sobre la base " +
              "válida. Ambas cantidades están documentadas; el nombre no está resuelto y no se " +
              "resuelve aquí.",
          ],
        }),
      };

      const unawareRatioEnvelope = {
        key: `unawareness_ratio_${item.key}`,
        label: item.label,
        base,
        provenance: makeProvenance({
          calculationVersion: spec.calculationVersion,
          explanation: UNAWARE_RATIO_EXPLANATION,
          metricKey: lookup.metricByKey.has(`tdp_item_${item.key}`) ? `tdp_item_${item.key}` : null,
          sources: ["survey_response", "response_option"],
          authorityIds: ["methodology-4-1-tdp", "approved-dashboard"],
          notes: [
            "Razón sobre la base válida (satisfechas más insatisfechas), tal como la enuncia la " +
              "documentación integral §4.1 y como la calcula el tablero aprobado. Puede superar cien " +
              "y no se acota: acotarla borraría justamente los casos que la medida existe para mostrar.",
            "CONFLICTO DE AUTORIDAD sobre el NOMBRE: ver la nota equivalente en la proporción de " +
              "desconocimiento. La documentación integral no define bandas para esta razón.",
          ],
        }),
      };

      const unawareShareRate = processUnawarenessRate(tally.unaware, responses);
      const unawareRatio = processUnawarenessRatio(tally.unaware, valid);

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

      const unawareShare: MetricResult =
        unawareShareRate.value === null
          ? unavailableMetric(
              unawareShareEnvelope,
              reasonForEmptyBase(unawareBase, scope.filtered),
              "Este punto de contacto no recibió respuesta alguna en esta selección.",
            )
          : availableMetric(unawareShareEnvelope, makeValue(unawareShareRate.value, "percent"));

      const unawarenessRatio: MetricResult =
        unawareRatio.value === null
          ? unavailableMetric(
              unawareRatioEnvelope,
              reasonForEmptyBase(base, scope.filtered),
              "Nadie de esta selección pudo evaluar este punto de contacto, así que no hay base contra la cual medir el desconocimiento.",
            )
          : availableMetric(unawareRatioEnvelope, makeValue(unawareRatio.value, "ratio"));

      touchpoints.push({
        key: item.key,
        label: item.label,
        shortLabel: null,
        groupKey: domain.key,
        order,
        satisfaction,
        unawareShare,
        unawarenessRatio,
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
export function buildStageEvidence(source: CanonicalResultSource): JourneyStageEvidenceResult {
  const proven = new Map<string, string[]>();
  for (const link of source.journeyStageEvidence) {
    const keys = proven.get(link.journeyStageKey) ?? [];
    if (link.metricKey) keys.push(link.metricKey);
    proven.set(link.journeyStageKey, keys);
  }

  const gaps: JourneyStageGap[] = source.journeyStages
    .slice()
    .sort((a, b) => a.stageOrder - b.stageOrder)
    .filter((stage) => (proven.get(stage.key) ?? []).length === 0)
    .map((stage) => ({
      stageKey: stage.key,
      stageLabel: stage.label,
      stageOrder: stage.stageOrder,
      provenMetricKeys: [],
      detail:
        "Ninguna fuente autoritativa enuncia qué indicador corresponde a esta etapa curada. " +
        "La documentación integral colapsa etapa y punto de contacto, de modo que no existe una " +
        "capa de etapas por encima de los puntos a la que un indicador pudiera adscribirse.",
    }));

  return {
    status: "unresolved",
    reason: "relationship_not_stated",
    detail:
      "No se emite ningún vínculo entre indicador y etapa del recorrido. Lo único que las fuentes " +
      "sostienen es que el CSAT se calcula POR PUNTO DE CONTACTO y que las etapas SON los puntos de " +
      "contacto; nadie adscribe recomendación, riesgo de renovación, retención ni deserción a una " +
      "posición del recorrido. Un vínculo inferido por parecido de etiquetas o por vecindad visual " +
      "sería una relación que nadie hizo.",
    wouldBeSettledBy:
      "Una confirmación explícita de la responsable metodológica, o un artefacto de mapeo aprobado " +
      "que nombre indicador y etapa en la misma fila. Ninguno de los dos existe hoy en el paquete.",
    gaps,
    authorities: authorities(
      "methodology-7-2-journey",
      "methodology-4-1-csat",
      "methodology-4-1-categorias-csat",
      "canonical-model-projection",
      "approved-dashboard",
    ),
  };
}
