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
  type ConfigurationRequirement,
  type StudyPeriod,
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
 * What this document deliberately leaves to configuration or editorial review.
 *
 * These are ANSWERS, not open questions. Each one says who supplies the thing
 * and in what artefact, so a reader can tell a working design from a defect —
 * which is exactly what an `unresolved` entry could not do for them.
 *
 * The methodology owner settled all three of this study's former open
 * questions on 2026-09-06. `unresolved` is consequently empty for Cuicuilco,
 * and empty is the healthy state.
 */
function collectConfigurationRequirements(results: {
  hasCuratedFindings: boolean;
  hasJourneyStages: boolean;
}): ConfigurationRequirement[] {
  const items: ConfigurationRequirement[] = [];

  if (results.hasJourneyStages) {
    items.push({
      key: "journey_stage_evidence",
      section: "journey",
      kind: "study_configuration",
      detail:
        "Un punto de contacto ya posee directamente su CSAT, su TDP y la proporción auxiliar de " +
        "desconocimiento. Ningún indicador de estudio se adscribe implícitamente a una etapa, y " +
        "no se infiere ninguna asociación genérica: es una regla del contrato. Un vínculo extra " +
        "existe únicamente si una configuración lo declara.",
      suppliedBy:
        "Configuración explícita de estudio o plantilla, con procedencia, transportada tal cual " +
        "por la proyección canónica.",
      authorities: authorities("owner-decision-journey-metrics", "methodology-7-2-journey"),
    });
  }

  if (results.hasCuratedFindings) {
    items.push({
      key: "curated_journey_pain_cloud",
      section: "qualitative",
      kind: "editorial_review",
      detail:
        "La nube de frases del recorrido del tablero aprobado es contenido editorial curado, no " +
        "un indicador calculado en servidor: depende de una segmentación editorial de frases y de " +
        "un mapeo de alias que no puede derivarse autoritativamente de las fuentes canónicas. " +
        "Este contrato emite en su lugar el conteo de hallazgos curados por entidad curada, que " +
        "sí está sostenido por claves foráneas reales. No es un cálculo fallido ni un bloqueo " +
        "para la importación canónica futura.",
      suppliedBy:
        "Revisión editorial humana, y en su caso una configuración aprobada de segmentación de " +
        "frases y de correspondencia entre punto de contacto y etapa curada.",
      authorities: authorities("owner-decision-journey-cloud", "approved-dashboard"),
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
    // Empty, and empty is the healthy state: every question this document
    // once carried was settled by the methodology owner on 2026-09-06.
    unresolved: [],
    configurationRequired: collectConfigurationRequirements({
      hasCuratedFindings: curatedFindingCounts.length > 0,
      hasJourneyStages: source.journeyStages.length > 0,
    }),
  };
}
