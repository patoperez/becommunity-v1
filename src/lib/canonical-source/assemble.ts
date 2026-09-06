/**
 * THE DATABASE-BACKED ADAPTER — canonical rows become a read-model source.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THIS IS THE TWIN OF `results/adapters/commit-plan.ts`, AND IT IS THE SAME
 * BOUNDARY. That adapter turns a projected commit plan into a
 * `CanonicalResultSource`; this one turns the canonical TABLES into the same
 * shape, so the calculators, the contract and the results document do not know
 * or care which one produced their input. Nothing downstream changed when this
 * landed, and nothing downstream may change when a third adapter lands.
 *
 * THE FOUR REDACTION RULES ARE REPEATED HERE ON PURPOSE, not delegated:
 *
 *   - A PERSON DOES NOT CROSS. `read.ts` never selects `person_private` or
 *     `person_external_identifier` at all, so a name and a membership id are
 *     not merely dropped here — they never enter the process.
 *
 *   - FREE TEXT DOES NOT CROSS. An answer keeps its words only when its item is
 *     on the specification's closed-coded allowlist. Allowlist, not blocklist:
 *     an item nobody classified loses its words.
 *
 *   - PRIVATE ATTRIBUTES DO NOT CROSS. A definition the projection marked
 *     `private` is dropped whole, together with every value of it.
 *
 *   - THE NUMBER IS RESOLVED HERE. A scale answer stores a reference to a
 *     response option and leaves `value_numeric` null; a value the scale does
 *     not know is stored inline instead. A calculator must not have to know
 *     that, so both paths resolve into one number here.
 *
 * IT IS PURE. No transport, no client, no credential, no `node:` import, no
 * `process.env`: it takes rows and returns a source. `read.ts` fetches the
 * rows and `adapter.ts` is the only module that knows what a database is. That
 * separation is what lets the offline gate run this exact function over rows a
 * fake produced and compare the result with the in-memory adapter's.
 *
 * ORDER. Every array comes out in the shared comparison order defined by
 * `normalize.ts`, so the two adapters' outputs can be compared as data instead
 * of as prose. See that file for why a third order is the only honest one.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import type {
  CanonicalResultSource,
  ResultAnswer,
  ResultAttributeValue,
  ResultCuratedFinding,
} from "../results/source";
import type { StudyResultsSpec } from "../results/spec";
import { normalizeCanonicalResultSource } from "./normalize";
import { CanonicalReadError } from "./read";
import type { CanonicalRowSet } from "./rows";

export type CanonicalDatabaseAdapterOptions = {
  /** The study's results specification, whose allowlists govern the redaction. */
  spec: StudyResultsSpec;
  tenantId: string;
  studyId: string;
};

/**
 * PostgREST returns `numeric` as a JSON number and, for values it cannot
 * represent exactly, as a string. Both are accepted; anything else is a shape
 * error rather than a silent `NaN`.
 */
function numeric(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new CanonicalReadError("READ_SHAPE_INVALID", "numeric");
    return value;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new CanonicalReadError("READ_SHAPE_INVALID", "numeric");
  return parsed;
}

function requireMatchingSpec(rows: CanonicalRowSet, spec: StudyResultsSpec): void {
  if (rows.specId !== spec.specId) throw new CanonicalReadError("SPEC_ID_MISMATCH");
  if (rows.importJob.mapping_version !== spec.mappingVersion) throw new CanonicalReadError("MAPPING_VERSION_MISMATCH");
}

/**
 * Build a read-model source from one committed package's canonical rows.
 *
 * The rows carry no name, no external identifier and no curated prose — see
 * `rows.ts` — so what is redacted HERE is what the tables legitimately hold and
 * the read model must not: private attribute definitions, and the words of any
 * answer whose item is not closed-coded.
 */
export function canonicalResultSourceFromRows(
  rows: CanonicalRowSet,
  options: CanonicalDatabaseAdapterOptions,
): CanonicalResultSource {
  const { spec } = options;
  requireMatchingSpec(rows, spec);

  const closedCodedItems = new Set(spec.closedCodedItemKeys);

  const instrumentById = new Map(rows.instruments.map((row) => [row.id, row]));
  const domainById = new Map(rows.domains.map((row) => [row.id, row]));
  const scaleById = new Map(rows.responseScales.map((row) => [row.id, row]));
  const itemById = new Map(rows.items.map((row) => [row.id, row]));
  const optionById = new Map(rows.responseOptions.map((row) => [row.id, row]));
  const bandSchemeById = new Map(rows.bandSchemes.map((row) => [row.id, row]));
  const metricById = new Map(rows.metricDefinitions.map((row) => [row.id, row]));
  const journeyModelById = new Map(rows.journeyModels.map((row) => [row.id, row]));
  const journeyStageById = new Map(rows.journeyStages.map((row) => [row.id, row]));
  const performanceDimensionById = new Map(rows.performanceDimensions.map((row) => [row.id, row]));
  const organizationalUnitById = new Map(rows.organizationalUnits.map((row) => [row.id, row]));
  const cultureDimensionById = new Map(rows.cultureDimensions.map((row) => [row.id, row]));

  // A definition marked private is dropped whole — not filtered later, not
  // carried "just in case". Its values go with it.
  const publicDefinitions = rows.attributeDefinitions.filter((row) => row.sensitivity !== "private");
  const publicDefinitionIds = new Set(publicDefinitions.map((row) => row.id));
  const definitionById = new Map(publicDefinitions.map((row) => [row.id, row]));
  const definitionByKey = new Map(publicDefinitions.map((row) => [row.key, row]));

  /**
   * An attribute keeps its text only when all three hold: the specification
   * recognises its key, the projection marked it FILTERABLE, and it is not
   * private. Identical rule, identical order, to the in-memory adapter.
   */
  const attributeTextAllowed = (definitionKey: string): boolean => {
    const definition = definitionByKey.get(definitionKey);
    if (!definition || !definition.filterable) return false;
    return spec.closedCodedAttributePrefixes.some((prefix) => definitionKey.startsWith(prefix));
  };

  const attributeValues: ResultAttributeValue[] = rows.attributeValues
    .filter((row) => publicDefinitionIds.has(row.attribute_definition_id))
    .map((row) => {
      const key = definitionById.get(row.attribute_definition_id)?.key ?? row.attribute_definition_id;
      return {
        participantId: row.participant_id,
        attributeKey: key,
        status: row.status,
        text: attributeTextAllowed(key) ? row.value_text : null,
        numeric: numeric(row.value_numeric),
      };
    });

  const answers: ResultAnswer[] = rows.responses.map((row) => {
    const itemKey = itemById.get(row.survey_item_id)?.key ?? row.survey_item_id;
    const option = row.response_option_id ? optionById.get(row.response_option_id) ?? null : null;
    const carriesText = closedCodedItems.has(itemKey);
    return {
      sessionId: row.survey_session_id,
      itemKey,
      status: row.status,
      // One number, whichever of the two places the commit put it in.
      numeric: numeric(row.value_numeric) ?? (option ? numeric(option.numeric_value) : null),
      text: carriesText ? row.value_text ?? option?.raw_value ?? null : null,
      optionRawValue: option?.raw_value ?? null,
      derivedLabel: row.source_derived_label,
    };
  });

  const findingLinks = new Map<
    string,
    {
      journeyStageKeys: string[];
      organizationalUnitKeys: string[];
      performanceDimensionKeys: string[];
      cultureDimensionKeys: string[];
    }
  >();
  const linksFor = (painPointId: string) => {
    let entry = findingLinks.get(painPointId);
    if (!entry) {
      entry = {
        journeyStageKeys: [],
        organizationalUnitKeys: [],
        performanceDimensionKeys: [],
        cultureDimensionKeys: [],
      };
      findingLinks.set(painPointId, entry);
    }
    return entry;
  };
  for (const link of rows.painPointJourneyStages) {
    const key = journeyStageById.get(link.journey_stage_id)?.key;
    if (key) linksFor(link.pain_point_id).journeyStageKeys.push(key);
  }
  for (const link of rows.painPointOrganizationalUnits) {
    const key = organizationalUnitById.get(link.organizational_unit_id)?.key;
    if (key) linksFor(link.pain_point_id).organizationalUnitKeys.push(key);
  }
  for (const link of rows.painPointPerformanceDimensions) {
    const key = performanceDimensionById.get(link.performance_dimension_id)?.key;
    if (key) linksFor(link.pain_point_id).performanceDimensionKeys.push(key);
  }
  for (const link of rows.painPointCultureDimensions) {
    const key = cultureDimensionById.get(link.culture_dimension_id)?.key;
    if (key) linksFor(link.pain_point_id).cultureDimensionKeys.push(key);
  }

  /**
   * `merged` is a REFUSAL, not a mapping.
   *
   * The schema allows a pain point to be superseded by another; the read model
   * has three review states and no way to say "this one was folded into that
   * one". Counting a merged finding as pending would double-count it, and
   * dropping it silently would make a number quietly smaller than the table.
   * Neither is this adapter's decision to take, so it names the state and stops.
   * Nothing this unit imports can create one: a projected pain point is always
   * `pending`.
   */
  const curatedFindings: ResultCuratedFinding[] = rows.painPoints.map((row) => {
    if (row.review_status === "merged") throw new CanonicalReadError("CURATED_FINDING_MERGED_UNSUPPORTED");
    const links = findingLinks.get(row.id);
    return {
      reviewStatus: row.review_status,
      journeyStageKeys: links?.journeyStageKeys ?? [],
      organizationalUnitKeys: links?.organizationalUnitKeys ?? [],
      performanceDimensionKeys: links?.performanceDimensionKeys ?? [],
      cultureDimensionKeys: links?.cultureDimensionKeys ?? [],
    };
  });

  const source: CanonicalResultSource = {
    identity: {
      specId: rows.specId,
      mappingVersion: rows.importJob.mapping_version,
      calculationVersion: spec.calculationVersion,
      tenantId: options.tenantId,
      studyId: options.studyId,
      packageIdempotencyKey: rows.importJob.idempotency_key,
      planFingerprint: rows.planFingerprint,
    },

    participants: rows.participants.map((row) => ({
      participantId: row.id,
      cohortKey: row.cohort_key,
      participationStatus: row.participation_status,
      surveyParticipationStatus: row.survey_participation_status,
      sourceStatus: row.source_status,
    })),

    attributeDefinitions: publicDefinitions.map((row) => ({
      key: row.key,
      label: row.label,
      dataType: row.data_type,
      sensitivity: row.sensitivity,
      filterable: row.filterable,
      displayOrder: row.display_order,
    })),

    attributeValues,

    instruments: rows.instruments.map((row) => ({
      key: row.key,
      label: row.label,
      audience: row.audience,
      instrumentType: row.instrument_type,
    })),

    domains: rows.domains.map((row) => ({
      key: row.key,
      label: row.label,
      instrumentKey: instrumentById.get(row.survey_instrument_id)?.key ?? row.survey_instrument_id,
      displayOrder: row.display_order,
      // A domain tied to a visual annotation is a domain whose grouping came
      // from a merged range in the source.
      groupedByMergedRange: row.visual_annotation_id !== null,
    })),

    items: rows.items.map((row) => ({
      key: row.key,
      label: row.label,
      instrumentKey: instrumentById.get(row.survey_instrument_id)?.key ?? row.survey_instrument_id,
      domainKey: row.study_domain_id ? domainById.get(row.study_domain_id)?.key ?? null : null,
      scaleKey: row.response_scale_id ? scaleById.get(row.response_scale_id)?.key ?? null : null,
      itemOrder: row.item_order,
    })),

    scaleOptions: rows.responseOptions.map((row) => ({
      scaleKey: scaleById.get(row.response_scale_id)?.key ?? row.response_scale_id,
      rawValue: row.raw_value,
      numericValue: numeric(row.numeric_value),
      derivedLabel: row.derived_label,
      displayOrder: row.display_order,
    })),

    sessions: rows.sessions.map((row) => ({
      sessionId: row.id,
      instrumentKey: instrumentById.get(row.survey_instrument_id)?.key ?? row.survey_instrument_id,
      participantId: row.participant_id,
      status: row.status,
    })),

    answers,

    retentionPeriods: rows.retentionPeriods.map((row) => ({
      seriesKey: row.series_key,
      order: row.period_order,
      label: row.period_label,
      startsOn: row.period_starts_on,
      endsOn: row.period_ends_on,
      starting: { count: row.starting_count, status: row.starting_status },
      joined: { count: row.new_count, status: row.new_status },
      ending: { count: row.ending_count, status: row.ending_status },
      lost: { count: row.lost_count, status: row.lost_status },
      identityVerified: row.identity_verified,
    })),

    performanceDimensions: rows.performanceDimensions.map((row) => ({
      key: row.key,
      label: row.label,
      displayOrder: row.display_order,
      bandSchemeKey: null,
    })),

    performanceObservations: rows.performanceObservations.map((row) => ({
      participantId: row.participant_id,
      dimensionKey: performanceDimensionById.get(row.performance_dimension_id)?.key ?? row.performance_dimension_id,
      periodStart: row.period_start,
      periodLabel: row.period_label,
      status: row.status,
      value: numeric(row.value),
    })),

    bandSchemes: rows.bandSchemes.map((scheme) => ({
      key: scheme.key,
      label: scheme.label,
      unit: scheme.unit,
      description: scheme.description,
      rules: rows.bandRules
        .filter((rule) => rule.band_scheme_id === scheme.id)
        .slice()
        .sort((a, b) => a.display_order - b.display_order)
        .map((rule) => ({
          schemeKey: scheme.key,
          lowerBound: numeric(rule.lower_bound),
          upperBound: numeric(rule.upper_bound),
          lowerInclusive: rule.lower_inclusive,
          upperInclusive: rule.upper_inclusive,
          label: rule.label,
          semanticColor: rule.semantic_color,
          displayOrder: rule.display_order,
        })),
    })),

    metricDefinitions: rows.metricDefinitions.map((row) => ({
      key: row.key,
      label: row.label,
      family: row.family,
      unit: row.unit,
      precision: row.precision,
      calculationVersion: row.calculation_version,
      bandSchemeKey: row.band_scheme_id ? bandSchemeById.get(row.band_scheme_id)?.key ?? null : null,
    })),

    journeyModels: rows.journeyModels.map((row) => ({
      key: row.key,
      label: row.label,
      audience: row.audience,
      displayOrder: row.display_order,
    })),

    journeyStages: rows.journeyStages.map((row) => ({
      key: row.key,
      label: row.label,
      journeyModelKey: journeyModelById.get(row.journey_model_id)?.key ?? row.journey_model_id,
      stageOrder: row.stage_order,
    })),

    journeyStageEvidence: rows.journeyStageEvidenceLinks.map((row) => ({
      journeyStageKey: journeyStageById.get(row.journey_stage_id)?.key ?? row.journey_stage_id,
      metricKey: row.metric_definition_id ? metricById.get(row.metric_definition_id)?.key ?? null : null,
      itemKey: row.survey_item_id ? itemById.get(row.survey_item_id)?.key ?? null : null,
      performanceDimensionKey: row.performance_dimension_id
        ? performanceDimensionById.get(row.performance_dimension_id)?.key ?? null
        : null,
      role: row.role,
    })),

    organizationalUnits: rows.organizationalUnits.map((row) => ({
      key: row.key,
      label: row.label,
      displayOrder: row.display_order,
    })),

    cultureDimensions: rows.cultureDimensions.map((row) => ({
      key: row.key,
      label: row.label,
      audience: row.audience,
      displayOrder: row.display_order,
    })),

    curatedFindings,
  };

  return normalizeCanonicalResultSource(source);
}
