/**
 * THE BUILDER — one canonical record set in, one versioned results document out.
 *
 * Pure and deterministic: the same source and the same options produce a
 * byte-identical document, because every ordering here comes from the source's
 * own order or from an explicit comparison, never from a hash.
 *
 * This function is the whole public calculation surface. A future dashboard
 * calls a server route, that route calls an adapter and then this, and what
 * crosses to the browser is the object this returns — already calculated,
 * already banded, already formatted, and carrying the base every number rests
 * on. There is no second place where a business metric may be computed.
 */

import { authorities } from "./authorities";
import {
  CANONICAL_RESULTS_CONTRACT_VERSION,
  type AppliedFilter,
  type CanonicalStudyResults,
  type StudyPeriod,
  type UnresolvedItem,
} from "./contract";
import { applyFilters } from "./filters";
import { buildJourney } from "./journey";
import { buildLookup } from "./lookup";
import { buildPerformance } from "./performance";
import { buildPopulation } from "./population";
import { buildQualitativeGroups, buildCuratedFindingCounts } from "./qualitative";
import { buildRecommendation } from "./recommendation";
import { buildRenewal } from "./renewal";
import { buildRetention } from "./retention";
import type { CanonicalResultSource } from "./source";
import { CANONICAL_RESULTS_SPECS, type StudyResultsSpec } from "./spec";

export type BuildResultsOptions = {
  /** Filter selection. Evaluated over people, before any aggregation. */
  filters?: AppliedFilter[];
  /** The period the study reports on, and the date its source was cut at. */
  period?: StudyPeriod;
  /** Override the study's results specification. Defaults to the registered one. */
  spec?: StudyResultsSpec;
};

function specFor(source: CanonicalResultSource, override?: StudyResultsSpec): StudyResultsSpec {
  const spec = override ?? CANONICAL_RESULTS_SPECS[source.identity.specId];
  if (!spec) throw new RangeError(`no results specification for study spec: ${source.identity.specId}`);
  if (spec.mappingVersion !== source.identity.mappingVersion) {
    throw new RangeError(
      `results specification mapping version ${spec.mappingVersion} does not match the source's ${source.identity.mappingVersion}`,
    );
  }
  return spec;
}

/**
 * The open questions, gathered where a reader will actually find them.
 *
 * Every one of these is carried in the data instead of being resolved by this
 * layer. Two of them are conflicts between documents that both count as
 * authorities; the third is a relationship no authority states at all.
 */
function collectUnresolved(results: {
  journeyGapCount: number;
  hasTouchpoints: boolean;
  hasCuratedFindings: boolean;
}): UnresolvedItem[] {
  const items: UnresolvedItem[] = [];

  items.push({
    key: "journey_stage_evidence",
    section: "journey",
    reason: "relationship_not_stated",
    detail:
      `No se emite vínculo alguno entre indicador y etapa del recorrido; ${results.journeyGapCount} ` +
      "etapas curadas quedan sin indicador probado. La documentación integral colapsa etapa y punto " +
      "de contacto, de modo que no existe una capa de etapas a la que un indicador pudiera adscribirse, " +
      "y ninguna fuente adscribe recomendación, riesgo de renovación, retención ni deserción a una " +
      "posición del recorrido.",
    wouldBeSettledBy:
      "Una confirmación explícita de la responsable metodológica, o un artefacto de mapeo aprobado que " +
      "nombre indicador y etapa en la misma fila.",
    authorities: authorities("methodology-7-2-journey", "methodology-4-1-csat", "canonical-model-projection"),
  });

  if (results.hasTouchpoints) {
    items.push({
      key: "tdp_name_conflict",
      section: "journey",
      reason: "authority_conflict",
      detail:
        "Dos documentos autoritativos dan el nombre «TDP» a dos cantidades distintas. " +
        "La documentación integral §4.1 lo da a la RAZÓN sobre la base válida (satisfechas más " +
        "insatisfechas), que puede superar cien; docs/CALCULATION_CATALOG.md §5 lo da a la PROPORCIÓN " +
        "sobre todas las respuestas del punto, acotada entre cero y cien. El propio §7.1 de la " +
        "documentación integral describe un gráfico apilado de «% que conoce / % que no conoce», que " +
        "sólo cierra con el denominador de la proporción. Ambas cantidades se emiten, bajo nombres " +
        "inequívocos y con su base declarada; el nombre no se resuelve aquí.",
      wouldBeSettledBy:
        "Una confirmación explícita de la responsable metodológica sobre a cuál de las dos cantidades " +
        "corresponde el nombre TDP, y la corrección del documento que quede equivocado.",
      authorities: authorities("methodology-4-1-tdp", "catalog-5-tdp", "methodology-7-1-conocimiento", "approved-dashboard"),
    });
  }

  if (results.hasCuratedFindings) {
    items.push({
      key: "curated_pain_phrase_cloud",
      section: "qualitative",
      reason: "source_incomplete",
      detail:
        "La nube de frases del recorrido que muestra el tablero aprobado no es reproducible desde el " +
        "modelo canónico. Necesita dos cosas que ninguna fuente enuncia: una regla para partir la celda " +
        "curada en frases sueltas, y una correspondencia entre cada punto de contacto medido y la etapa " +
        "curada de la que toma sus frases. El tablero aprobado resuelve la segunda con una tabla de " +
        "alias escrita a mano en su propio script de construcción, que es una implementación y no una " +
        "autoridad. Este contrato emite en su lugar el conteo de hallazgos curados por entidad curada, " +
        "que sí está sostenido por claves foráneas reales.",
      wouldBeSettledBy:
        "Una regla de segmentación de frases aprobada, y un mapeo aprobado entre punto de contacto y " +
        "etapa curada.",
      authorities: authorities("approved-dashboard", "canonical-model-projection", "methodology-7-2-journey"),
    });
  }

  return items;
}

export function buildCanonicalStudyResults(
  source: CanonicalResultSource,
  options: BuildResultsOptions = {},
): CanonicalStudyResults {
  const spec = specFor(source, options.spec);
  const lookup = buildLookup(source);

  const applied = options.filters ?? [];
  const evaluation = applyFilters(source, spec, applied);
  const scope = { participantIds: evaluation.participantIds, filtered: evaluation.result.applied.length > 0 };

  const journey = buildJourney(source, spec, scope, lookup);
  const curatedFindingCounts = buildCuratedFindingCounts(source);

  return {
    contractVersion: CANONICAL_RESULTS_CONTRACT_VERSION,
    study: {
      specId: source.identity.specId,
      mappingVersion: source.identity.mappingVersion,
      calculationVersion: spec.calculationVersion,
      tenantId: source.identity.tenantId,
      studyId: source.identity.studyId,
      packageIdempotencyKey: source.identity.packageIdempotencyKey,
      planFingerprint: source.identity.planFingerprint,
    },
    period: options.period ?? { label: null, dataCutoff: null },
    population: buildPopulation(source, spec, scope, lookup),
    filters: evaluation.result,
    recommendation: { scopes: buildRecommendation(source, spec, scope, lookup) },
    renewal: buildRenewal(source, spec, scope, evaluation.constrainedDimensionKeys, lookup),
    // Retention takes no lookup: its base is the membership roster, not the
    // participants, so it has nothing to index against.
    retention: { periods: buildRetention(source, spec, scope) },
    journey,
    performance: { dimensions: buildPerformance(source, spec, scope, lookup) },
    qualitative: {
      groups: buildQualitativeGroups(source, spec, scope, lookup),
      curatedFindingCounts,
    },
    unresolved: collectUnresolved({
      journeyGapCount: journey.stageEvidence.gaps.length,
      hasTouchpoints: journey.touchpoints.length > 0,
      hasCuratedFindings: curatedFindingCounts.length > 0,
    }),
  };
}
