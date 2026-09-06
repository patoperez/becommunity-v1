/**
 * FILTERS — evaluated over people, BEFORE any aggregation.
 *
 * A filter selects a POPULATION; every metric is then recomputed inside it and
 * reports the denominator that selection produced. Filtering an aggregate after
 * the fact would give a number nobody measured, so the only thing this module
 * hands the calculators is a set of participant ids.
 *
 * Two states, and only two, for a selection:
 *   - it matches people, and every metric recomputes over them;
 *   - it matches nobody, and every metric is `unavailable` with
 *     `empty_filtered_population` — never a measured zero.
 *
 * A cross an authority forbids is REFUSED at the dimension, not dropped in
 * silence: the dimension carries the section it may not cross and the id of the
 * authority that says so, and the section that would have used it reports
 * `cross_not_permitted`.
 */

import type { SourceValueStatus } from "../ingestion/canonical-package/values";
import type { AppliedFilter, FilterDimension, FilterResult, FilterValue } from "./contract";
import type { CanonicalResultSource, ResultAttributeValue } from "./source";
import type { StudyResultsSpec } from "./spec";

/** The synthetic dimension every study has: which cohort a person belongs to. */
export const COHORT_DIMENSION_KEY = "cohort";

/**
 * A person who ANSWERED, whose answer this boundary is not allowed to carry.
 *
 * They produce no filter option, so they are reported beside the absences —
 * but under their OWN reason, never under the source state "answered". Filing
 * them as an absence would turn every answered person into a missing one the
 * moment a study marks a date or a boolean attribute filterable.
 */
export const ANSWERED_NOT_CARRIED = "answered_not_carried";

function codepointCompare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function valuesByParticipant(source: CanonicalResultSource): Map<string, Map<string, ResultAttributeValue>> {
  const byParticipant = new Map<string, Map<string, ResultAttributeValue>>();
  for (const value of source.attributeValues) {
    let row = byParticipant.get(value.participantId);
    if (!row) {
      row = new Map();
      byParticipant.set(value.participantId, row);
    }
    row.set(value.attributeKey, value);
  }
  return byParticipant;
}

/**
 * The dimensions a caller may filter on.
 *
 * Only a definition the source marks FILTERABLE and does not mark PRIVATE
 * becomes one. A private attribute — the form's own timestamp, for instance —
 * is operational team data and never crosses this boundary in any shape,
 * including as a filter a client could enumerate.
 */
export function buildFilterDimensions(source: CanonicalResultSource, spec: StudyResultsSpec): FilterDimension[] {
  const dimensions: FilterDimension[] = [];

  const cohortCounts = new Map<string, number>();
  for (const participant of source.participants) {
    cohortCounts.set(participant.cohortKey, (cohortCounts.get(participant.cohortKey) ?? 0) + 1);
  }
  const cohortValues: FilterValue[] = spec.cohorts
    .filter((cohort) => cohortCounts.has(cohort.key))
    .map((cohort) => ({ value: cohort.key, participants: cohortCounts.get(cohort.key) ?? 0 }));
  for (const [key, participants] of [...cohortCounts.entries()].sort((a, b) => codepointCompare(a[0], b[0]))) {
    if (!cohortValues.some((value) => value.value === key)) cohortValues.push({ value: key, participants });
  }
  dimensions.push({
    key: COHORT_DIMENSION_KEY,
    label: "Cohorte",
    dataType: "category",
    values: cohortValues,
    absent: [],
    forbiddenSections: forbiddenFor(spec, COHORT_DIMENSION_KEY),
  });

  const byKey = new Map<string, ResultAttributeValue[]>();
  for (const value of source.attributeValues) {
    const list = byKey.get(value.attributeKey);
    if (list) list.push(value);
    else byKey.set(value.attributeKey, [value]);
  }

  for (const definition of [...source.attributeDefinitions].sort((a, b) =>
    a.displayOrder === b.displayOrder ? codepointCompare(a.key, b.key) : a.displayOrder - b.displayOrder,
  )) {
    if (!definition.filterable) continue;
    if (definition.sensitivity === "private") continue;

    const counts = new Map<string, number>();
    const absent = new Map<SourceValueStatus | typeof ANSWERED_NOT_CARRIED, number>();
    for (const value of byKey.get(definition.key) ?? []) {
      if (value.status !== "answered") {
        absent.set(value.status, (absent.get(value.status) ?? 0) + 1);
        continue;
      }
      const text = value.text ?? (value.numeric === null ? null : String(value.numeric));
      // An answered value the adapter was not allowed to carry is still an
      // ANSWER; it simply cannot be offered as a filter option. It is reported
      // under its own reason so the arithmetic closes without calling an
      // answered person absent.
      if (text === null) {
        absent.set(ANSWERED_NOT_CARRIED, (absent.get(ANSWERED_NOT_CARRIED) ?? 0) + 1);
        continue;
      }
      counts.set(text, (counts.get(text) ?? 0) + 1);
    }

    dimensions.push({
      key: definition.key,
      label: definition.label,
      dataType: definition.dataType,
      values: [...counts.entries()]
        .sort((a, b) => codepointCompare(a[0], b[0]))
        .map(([value, participants]) => ({ value, participants })),
      absent: [...absent.entries()]
        .sort((a, b) => codepointCompare(a[0], b[0]))
        .map(([status, participants]) => ({ status, participants })),
      forbiddenSections: forbiddenFor(spec, definition.key),
    });
  }

  return dimensions;
}

function forbiddenFor(spec: StudyResultsSpec, attributeKey: string): { section: string; authorityId: string }[] {
  return spec.forbiddenCrosses
    .filter((cross) => cross.attributeKey === attributeKey)
    .map((cross) => ({ section: cross.section, authorityId: cross.authorityId }));
}

export type FilterEvaluation = {
  /** Participant ids remaining after the selection. */
  participantIds: Set<string>;
  result: FilterResult;
  /** Dimension keys the caller actually constrained. */
  constrainedDimensionKeys: string[];
};

/**
 * Apply a selection.
 *
 * Reject by default: an unknown dimension and an unknown value are both
 * refused rather than quietly matching nothing, because a typo that silently
 * empties a population looks exactly like a real finding.
 */
export function applyFilters(
  source: CanonicalResultSource,
  spec: StudyResultsSpec,
  applied: AppliedFilter[],
): FilterEvaluation {
  const dimensions = buildFilterDimensions(source, spec);
  const byDimension = new Map(dimensions.map((dimension) => [dimension.key, dimension]));

  const normalized: AppliedFilter[] = [];
  for (const filter of applied) {
    const dimension = byDimension.get(filter.dimensionKey);
    if (!dimension) throw new RangeError(`unknown filter dimension: ${filter.dimensionKey}`);
    const values = [...new Set(filter.values)].sort(codepointCompare);
    for (const value of values) {
      if (!dimension.values.some((candidate) => candidate.value === value)) {
        throw new RangeError(`unknown value for filter dimension ${filter.dimensionKey}`);
      }
    }
    if (values.length > 0) normalized.push({ dimensionKey: filter.dimensionKey, values });
  }
  normalized.sort((a, b) => codepointCompare(a.dimensionKey, b.dimensionKey));

  const attributeValues = valuesByParticipant(source);
  const participantIds = new Set<string>();
  for (const participant of source.participants) {
    let keep = true;
    for (const filter of normalized) {
      if (filter.dimensionKey === COHORT_DIMENSION_KEY) {
        if (!filter.values.includes(participant.cohortKey)) keep = false;
      } else {
        const value = attributeValues.get(participant.participantId)?.get(filter.dimensionKey);
        const text = value && value.status === "answered" ? value.text ?? (value.numeric === null ? null : String(value.numeric)) : null;
        if (text === null || !filter.values.includes(text)) keep = false;
      }
      if (!keep) break;
    }
    if (keep) participantIds.add(participant.participantId);
  }

  return {
    participantIds,
    constrainedDimensionKeys: normalized.map((filter) => filter.dimensionKey),
    result: {
      dimensions,
      applied: normalized,
      resultingPopulation: participantIds.size,
      empty: participantIds.size === 0,
    },
  };
}

/** True when the section may not be crossed with any dimension the caller constrained. */
export function crossIsForbidden(
  spec: StudyResultsSpec,
  section: string,
  constrainedDimensionKeys: string[],
): { forbidden: true; authorityId: string; dimensionKey: string } | { forbidden: false } {
  for (const cross of spec.forbiddenCrosses) {
    if (cross.section !== section) continue;
    if (constrainedDimensionKeys.includes(cross.attributeKey)) {
      return { forbidden: true, authorityId: cross.authorityId, dimensionKey: cross.attributeKey };
    }
  }
  return { forbidden: false };
}
