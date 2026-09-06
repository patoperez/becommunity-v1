/**
 * THE IN-MEMORY ADAPTER — a projected commit plan becomes a read-model source.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THIS IS FOR. The canonical projection can be built from the two source
 * workbooks entirely in memory, with no database anywhere in its module graph.
 * That makes it the one place a result can be calculated and compared against
 * the approved dashboard before a single canonical row exists in any hosted
 * project. A later adapter will build the IDENTICAL shape from the canonical
 * tables; nothing downstream of this file changes when it does.
 *
 * THIS IS ALSO THE REDACTION BOUNDARY, and it is the reason the adapter exists
 * as a separate module rather than as a cast:
 *
 *   - A PERSON DOES NOT CROSS. `persons` and `personIdentifiers` are read to
 *     resolve nothing at all — the read model addresses a participation, and
 *     the participation's own uuid is the only handle it gets.
 *
 *   - FREE TEXT DOES NOT CROSS. An answer keeps its words only when its item is
 *     on the specification's closed-coded allowlist. Everything else arrives
 *     with its status, its scale option and its number, and without its text.
 *     Allowlist, not blocklist: an item nobody classified loses its words.
 *
 *   - PRIVATE ATTRIBUTES DO NOT CROSS. A definition the projection marks
 *     `private` — the form's own submission timestamp, for instance — is
 *     dropped whole, together with every value of it.
 *
 *   - THE NUMBER IS RESOLVED HERE. The projection stores a scale answer as a
 *     reference to a response option and leaves `value_numeric` null; a value
 *     the scale does not know is stored inline instead. A calculator must not
 *     have to know that, so this adapter resolves both paths into one number.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import type {
  CanonicalCommitPlan,
  PlanResponseOption,
  PlanSurveyItem,
} from "../../ingestion/canonical-commit/plan";
import type { CanonicalResultSource, ResultCultureDimension, ResultNamedEntity } from "../source";
import type { StudyResultsSpec } from "../spec";

export type CommitPlanAdapterOptions = {
  /** The study's results specification, whose allowlists govern the redaction. */
  spec: StudyResultsSpec;
};

function requireMatchingSpec(plan: CanonicalCommitPlan, spec: StudyResultsSpec): void {
  if (plan.specId !== spec.specId) {
    throw new RangeError(`plan spec '${plan.specId}' does not match results spec '${spec.specId}'`);
  }
  if (plan.mappingVersion !== spec.mappingVersion) {
    throw new RangeError(
      `plan mapping version ${plan.mappingVersion} does not match results spec version ${spec.mappingVersion}`,
    );
  }
}

/**
 * Build a read-model source from a projected commit plan.
 *
 * The plan carries real names, answers and qualitative text — see the header of
 * `canonical-commit/plan.ts`. Everything this function returns has been through
 * the redaction described above, so the returned object is safe to calculate
 * over and the plan itself never travels further.
 */
export function canonicalResultSourceFromCommitPlan(
  plan: CanonicalCommitPlan,
  options: CommitPlanAdapterOptions,
): CanonicalResultSource {
  const { spec } = options;
  requireMatchingSpec(plan, spec);

  const closedCodedItems = new Set(spec.closedCodedItemKeys);

  const instrumentById = new Map(plan.surveyInstruments.map((instrument) => [instrument.id, instrument]));
  const domainById = new Map(plan.studyDomains.map((domain) => [domain.id, domain]));
  const scaleById = new Map(plan.responseScales.map((scale) => [scale.id, scale]));
  const itemById = new Map<string, PlanSurveyItem>(plan.surveyItems.map((item) => [item.id, item]));
  const optionById = new Map<string, PlanResponseOption>(plan.responseOptions.map((option) => [option.id, option]));

  // A definition marked private is dropped whole — not filtered later, not
  // carried "just in case". Its values go with it.
  const publicDefinitions = plan.attributeDefinitions.filter((definition) => definition.sensitivity !== "private");
  const publicDefinitionIds = new Set(publicDefinitions.map((definition) => definition.id));
  const definitionById = new Map(publicDefinitions.map((definition) => [definition.id, definition]));

  /**
   * An attribute keeps its text only when all three hold: the specification
   * recognises its key, the projection marked it FILTERABLE, and it is not
   * private. A filterable category is exactly the vocabulary a filter panel
   * must offer; a date, a number or an unfilterable column has no business
   * carrying text through this boundary, and does not.
   */
  const attributeTextAllowed = (definitionKey: string): boolean => {
    const definition = publicDefinitions.find((candidate) => candidate.key === definitionKey);
    if (!definition || !definition.filterable) return false;
    return spec.closedCodedAttributePrefixes.some((prefix) => definitionKey.startsWith(prefix));
  };

  const journeyModelById = new Map(plan.journeyModels.map((model) => [model.id, model]));
  const journeyStageById = new Map(plan.journeyStages.map((stage) => [stage.id, stage]));
  const organizationalUnitById = new Map(plan.organizationalUnits.map((unit) => [unit.id, unit]));
  const performanceDimensionById = new Map(plan.performanceDimensions.map((dimension) => [dimension.id, dimension]));
  const cultureDimensionById = new Map(plan.cultureDimensions.map((dimension) => [dimension.id, dimension]));
  const bandSchemeById = new Map(plan.bandSchemes.map((scheme) => [scheme.id, scheme]));
  const metricById = new Map(plan.metricDefinitions.map((metric) => [metric.id, metric]));

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
  for (const link of plan.painPointJourneyStages) {
    const key = journeyStageById.get(link.journeyStageId)?.key;
    if (key) linksFor(link.painPointId).journeyStageKeys.push(key);
  }
  for (const link of plan.painPointOrganizationalUnits) {
    const key = organizationalUnitById.get(link.organizationalUnitId)?.key;
    if (key) linksFor(link.painPointId).organizationalUnitKeys.push(key);
  }
  for (const link of plan.painPointPerformanceDimensions) {
    const key = performanceDimensionById.get(link.performanceDimensionId)?.key;
    if (key) linksFor(link.painPointId).performanceDimensionKeys.push(key);
  }
  for (const link of plan.painPointCultureDimensions) {
    const key = cultureDimensionById.get(link.cultureDimensionId)?.key;
    if (key) linksFor(link.painPointId).cultureDimensionKeys.push(key);
  }

  const organizationalUnits: ResultNamedEntity[] = plan.organizationalUnits.map((unit) => ({
    key: unit.key,
    label: unit.label,
    displayOrder: unit.displayOrder,
  }));

  const cultureDimensions: ResultCultureDimension[] = plan.cultureDimensions.map((dimension) => ({
    key: dimension.key,
    label: dimension.label,
    audience: dimension.audience,
    displayOrder: dimension.displayOrder,
  }));

  return {
    identity: {
      specId: plan.specId,
      mappingVersion: plan.mappingVersion,
      calculationVersion: spec.calculationVersion,
      tenantId: plan.tenantId,
      studyId: plan.studyId,
      packageIdempotencyKey: plan.packageIdempotencyKey,
      planFingerprint: plan.planFingerprint,
    },

    participants: plan.participants.map((participant) => ({
      participantId: participant.id,
      cohortKey: participant.cohortKey,
      participationStatus: participant.participationStatus,
      surveyParticipationStatus: participant.surveyParticipationStatus,
      sourceStatus: participant.sourceStatus,
    })),

    attributeDefinitions: publicDefinitions.map((definition) => ({
      key: definition.key,
      label: definition.label,
      dataType: definition.dataType,
      sensitivity: definition.sensitivity,
      filterable: definition.filterable,
      displayOrder: definition.displayOrder,
    })),

    attributeValues: plan.participantAttributeValues
      .filter((value) => publicDefinitionIds.has(value.attributeDefinitionId))
      .map((value) => {
        const definition = definitionById.get(value.attributeDefinitionId);
        const key = definition?.key ?? value.attributeDefinitionId;
        return {
          participantId: value.participantId,
          attributeKey: key,
          status: value.status,
          text: attributeTextAllowed(key) ? value.valueText : null,
          numeric: value.valueNumeric,
        };
      }),

    instruments: plan.surveyInstruments.map((instrument) => ({
      key: instrument.key,
      label: instrument.label,
      audience: instrument.audience,
      instrumentType: instrument.instrumentType,
    })),

    domains: plan.studyDomains.map((domain) => ({
      key: domain.key,
      label: domain.label,
      instrumentKey: instrumentById.get(domain.surveyInstrumentId)?.key ?? domain.surveyInstrumentId,
      displayOrder: domain.displayOrder,
      // A domain the projection tied to a visual annotation is a domain whose
      // grouping came from a merged range in the source.
      groupedByMergedRange: domain.visualAnnotationId !== null,
    })),

    items: plan.surveyItems.map((item) => ({
      key: item.key,
      label: item.label,
      instrumentKey: instrumentById.get(item.surveyInstrumentId)?.key ?? item.surveyInstrumentId,
      domainKey: item.studyDomainId ? domainById.get(item.studyDomainId)?.key ?? null : null,
      scaleKey: item.responseScaleId ? scaleById.get(item.responseScaleId)?.key ?? null : null,
      itemOrder: item.itemOrder,
    })),

    scaleOptions: plan.responseOptions.map((option) => ({
      scaleKey: scaleById.get(option.responseScaleId)?.key ?? option.responseScaleId,
      rawValue: option.rawValue,
      numericValue: option.numericValue,
      derivedLabel: option.derivedLabel,
      displayOrder: option.displayOrder,
    })),

    sessions: plan.surveySessions.map((session) => ({
      sessionId: session.id,
      instrumentKey: instrumentById.get(session.surveyInstrumentId)?.key ?? session.surveyInstrumentId,
      participantId: session.participantId,
      status: session.status,
    })),

    answers: plan.surveyResponses.map((response) => {
      const item = itemById.get(response.surveyItemId);
      const itemKey = item?.key ?? response.surveyItemId;
      const option = response.responseOptionId ? optionById.get(response.responseOptionId) ?? null : null;
      const carriesText = closedCodedItems.has(itemKey);
      return {
        sessionId: response.surveySessionId,
        itemKey,
        status: response.status,
        // One number, whichever of the two places the projection put it in.
        numeric: response.valueNumeric ?? option?.numericValue ?? null,
        text: carriesText ? response.valueText ?? option?.rawValue ?? null : null,
        optionRawValue: option?.rawValue ?? null,
        derivedLabel: response.sourceDerivedLabel,
      };
    }),

    retentionPeriods: plan.retentionPeriods.map((period) => ({
      seriesKey: period.seriesKey,
      order: period.periodOrder,
      label: period.periodLabel,
      startsOn: period.periodStartsOn,
      endsOn: period.periodEndsOn,
      starting: { count: period.startingCount, status: period.startingStatus },
      joined: { count: period.newCount, status: period.newStatus },
      ending: { count: period.endingCount, status: period.endingStatus },
      lost: { count: period.lostCount, status: period.lostStatus },
      identityVerified: period.identityVerified,
    })),

    performanceDimensions: plan.performanceDimensions.map((dimension) => ({
      key: dimension.key,
      label: dimension.label,
      displayOrder: dimension.displayOrder,
      bandSchemeKey: null,
    })),

    performanceObservations: plan.performanceObservations.map((observation) => ({
      participantId: observation.participantId,
      dimensionKey:
        performanceDimensionById.get(observation.performanceDimensionId)?.key ?? observation.performanceDimensionId,
      periodStart: observation.periodStart,
      periodLabel: observation.periodLabel,
      status: observation.status,
      value: observation.value,
    })),

    bandSchemes: plan.bandSchemes.map((scheme) => ({
      key: scheme.key,
      label: scheme.label,
      unit: scheme.unit,
      description: scheme.description,
      rules: plan.bandRules
        .filter((rule) => rule.bandSchemeId === scheme.id)
        .slice()
        .sort((a, b) => a.displayOrder - b.displayOrder)
        .map((rule) => ({
          schemeKey: scheme.key,
          lowerBound: rule.lowerBound,
          upperBound: rule.upperBound,
          lowerInclusive: rule.lowerInclusive,
          upperInclusive: rule.upperInclusive,
          label: rule.label,
          semanticColor: rule.semanticColor,
          displayOrder: rule.displayOrder,
        })),
    })),

    metricDefinitions: plan.metricDefinitions.map((metric) => ({
      key: metric.key,
      label: metric.label,
      family: metric.family,
      unit: metric.unit,
      precision: metric.precision,
      calculationVersion: metric.calculationVersion,
      bandSchemeKey: metric.bandSchemeId ? bandSchemeById.get(metric.bandSchemeId)?.key ?? null : null,
    })),

    journeyModels: plan.journeyModels.map((model) => ({
      key: model.key,
      label: model.label,
      audience: model.audience,
      displayOrder: model.displayOrder,
    })),

    journeyStages: plan.journeyStages.map((stage) => ({
      key: stage.key,
      label: stage.label,
      journeyModelKey: journeyModelById.get(stage.journeyModelId)?.key ?? stage.journeyModelId,
      stageOrder: stage.stageOrder,
    })),

    // Empty for Cuicuilco v1, and that emptiness is a finding the results layer
    // reports rather than a hole it fills.
    journeyStageEvidence: plan.journeyStageEvidenceLinks.map((link) => ({
      journeyStageKey: journeyStageById.get(link.journeyStageId)?.key ?? link.journeyStageId,
      metricKey: link.metricDefinitionId ? metricById.get(link.metricDefinitionId)?.key ?? null : null,
      itemKey: link.surveyItemId ? itemById.get(link.surveyItemId)?.key ?? null : null,
      performanceDimensionKey: link.performanceDimensionId
        ? performanceDimensionById.get(link.performanceDimensionId)?.key ?? null
        : null,
      role: link.role,
    })),

    organizationalUnits,
    cultureDimensions,

    curatedFindings: plan.painPoints.map((point) => {
      const links = findingLinks.get(point.id);
      return {
        reviewStatus: point.reviewStatus,
        journeyStageKeys: links?.journeyStageKeys ?? [],
        organizationalUnitKeys: links?.organizationalUnitKeys ?? [],
        performanceDimensionKeys: links?.performanceDimensionKeys ?? [],
        cultureDimensionKeys: links?.cultureDimensionKeys ?? [],
      };
    }),
  };
}
