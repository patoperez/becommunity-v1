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
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ONE ANSWER, ONE OPTION — EVEN WHEN THE SOURCE SPELLS IT TWICE.
 *
 * The approved study's «Giro» column holds «Construcción» and «Construcción·»,
 * «Capacitación y Coaching» and «Capacitación y Coaching·», and two more pairs
 * like them; «Tipo de empresa» holds «B2B» and «B2B·». They are the same
 * answer with a trailing space, and they were two options with two counts, so
 * a reader who picked one saw a third of the people who gave it.
 *
 * Options are therefore GROUPED by the answer with its outer whitespace
 * removed. Every raw spelling is preserved on the value, the canonical rows
 * are not touched, and `applyFilters` matches a person carrying any spelling
 * in the group. Nothing that differs by a single internal character is ever
 * merged: that is an editorial judgement, and this file makes none.
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

/**
 * The display spelling a raw answer groups under.
 *
 * `trim()` and nothing else: it removes leading and trailing whitespace —
 * including the non-breaking space and the byte-order mark, which JavaScript
 * counts as whitespace and spreadsheets emit — and touches not one character
 * in between.
 *
 * A WHITESPACE-ONLY ANSWER GROUPS WITH NOTHING. Its trimmed form is the empty
 * string, which is not a spelling anybody could read on a control, and
 * folding every such answer into one blank option would merge answers this
 * boundary cannot tell apart. So it keeps its own raw form and its own count,
 * exactly as it did before grouping existed.
 */
function displaySpelling(raw: string): string {
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : raw;
}

/**
 * Build one dimension's grouped values from its raw answer counts.
 *
 * `value` is the first raw in codepoint order, so two builds over the same
 * evidence name the same representative. `rawValues` is every spelling, also
 * in codepoint order, so the whole structure is byte-stable.
 */
function groupedValues(counts: Map<string, number>): FilterValue[] {
  const groups = new Map<string, { raws: string[]; participants: number }>();
  for (const [raw, participants] of counts) {
    const display = displaySpelling(raw);
    const group = groups.get(display);
    if (group) {
      group.raws.push(raw);
      group.participants += participants;
    } else {
      groups.set(display, { raws: [raw], participants });
    }
  }
  return [...groups.entries()]
    .sort((a, b) => codepointCompare(a[0], b[0]))
    .map(([display, group]) => {
      const raws = [...group.raws].sort(codepointCompare);
      return { value: raws[0], label: display, rawValues: raws, participants: group.participants };
    });
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

  const byKey = new Map<string, ResultAttributeValue[]>();
  for (const value of source.attributeValues) {
    const list = byKey.get(value.attributeKey);
    if (list) list.push(value);
    else byKey.set(value.attributeKey, [value]);
  }

  const cohortCounts = new Map<string, number>();
  for (const participant of source.participants) {
    cohortCounts.set(participant.cohortKey, (cohortCounts.get(participant.cohortKey) ?? 0) + 1);
  }
  // THE LABEL IS THE STUDY'S OWN WORD, AND THE VALUE IS THE ENUM.
  //
  // A cohort's value is `active` or `deserter`. Those are storage vocabulary,
  // and a control that offered them would print an implementation detail to a
  // reader — the specification has always carried «Miembros activos» and
  // «Desertores» and this boundary was discarding them. A cohort the
  // specification does not declare has no word but its own, so it is labelled
  // with its key rather than with an invented sentence; `population.cohorts`
  // has always resolved it the same way.
  // NOT GROUPED, AND IT MUST NOT BE. A cohort key is a closed enum the
  // specification declares, not a person's typing, so there is no spelling
  // variation to fold — and folding a key would change what a stored
  // selection names.
  const cohortValues: FilterValue[] = spec.cohorts
    .filter((cohort) => cohortCounts.has(cohort.key))
    .map((cohort) => ({
      value: cohort.key,
      label: cohort.label,
      rawValues: [cohort.key],
      participants: cohortCounts.get(cohort.key) ?? 0,
    }));
  for (const [key, participants] of [...cohortCounts.entries()].sort((a, b) => codepointCompare(a[0], b[0]))) {
    if (!cohortValues.some((value) => value.value === key)) {
      cohortValues.push({ value: key, label: key, rawValues: [key], participants });
    }
  }
  dimensions.push({
    key: COHORT_DIMENSION_KEY,
    label: "Cohorte",
    // The cohort dimension IS the cohorts; qualifying it by them would say
    // «Cohorte (miembros activos, desertores)», which is a sentence about
    // itself.
    cohortLabels: [],
    dataType: "category",
    values: cohortValues,
    absent: [],
    forbiddenSections: forbiddenFor(spec, COHORT_DIMENSION_KEY),
  });

  /**
   * WHICH POPULATIONS ANSWER A CHARACTERISTIC.
   *
   * A study may ask the same question of two cohorts on two different sheets,
   * and this boundary then publishes two dimensions with byte-identical labels.
   * They are not the same characteristic to filter on: each is answered by one
   * population, so selecting a value on one implicitly excludes the other.
   *
   * The cohorts are read from the ANSWERS rather than declared anywhere, which
   * is what makes this true of any study rather than of this one. A cohort the
   * specification does not declare is named by its own key, the same fallback
   * `population.cohorts` has always used.
   */
  const cohortLabelByKey = new Map(spec.cohorts.map((cohort) => [cohort.key, cohort.label]));
  const cohortByParticipant = new Map(
    source.participants.map((participant) => [participant.participantId, participant.cohortKey]),
  );
  const cohortsAnswering = (attributeKey: string): string[] => {
    const keys = new Set<string>();
    for (const value of byKey.get(attributeKey) ?? []) {
      if (value.status !== "answered") continue;
      const cohortKey = cohortByParticipant.get(value.participantId);
      if (cohortKey !== undefined) keys.add(cohortKey);
    }
    // In the specification's own order, so two builds agree and so the order is
    // the one the study declares rather than the one the rows happened to be in.
    const declared = spec.cohorts.map((cohort) => cohort.key).filter((key) => keys.has(key));
    const extra = [...keys].filter((key) => !cohortLabelByKey.has(key)).sort(codepointCompare);
    return [...declared, ...extra].map((key) => cohortLabelByKey.get(key) ?? key);
  };

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
      cohortLabels: cohortsAnswering(definition.key),
      dataType: definition.dataType,
      // An attribute's answer text IS what a reader is shown, so the label is
      // that text with its outer whitespace removed — the one clean spelling
      // of an answer the source may have written several ways. Every raw
      // spelling stays on the value, and the count is over all of them.
      values: groupedValues(counts),
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

  // WHAT WAS CHOSEN, AND WHAT IT MATCHES, TRAVEL TOGETHER — ONE PAIR PER
  // CONSTRAINT.
  //
  // `values` is the ECHO: one representative value per display option a reader
  // picked, which is what they chose. `raws` is the SET OF RAW SPELLINGS those
  // options stand for, and it is the only thing a person is ever tested
  // against. Keeping them apart is what lets «Construcción» mean «Construcción
  // or Construcción·» without the echo claiming the reader ticked two boxes.
  //
  // THE PAIRING IS PER CONSTRAINT AND NEVER PER DIMENSION, and that is
  // load-bearing. Two panels may constrain the SAME characteristic differently,
  // and `viewerAppliedFilters` deliberately does not merge them: a person must
  // satisfy every entry, so «Generación X» from one panel and «Millenial» from
  // another intersect to nobody. Collecting the raw spellings into one set per
  // dimension key would union them instead — turning the AND that empties a
  // population into an OR that fills it, silently, and only when two panels
  // move one block.
  const constraints: { dimensionKey: string; values: string[]; raws: Set<string> }[] = [];
  for (const filter of applied) {
    const dimension = byDimension.get(filter.dimensionKey);
    if (!dimension) throw new RangeError(`unknown filter dimension: ${filter.dimensionKey}`);
    const chosen = new Set<string>();
    const raws = new Set<string>();
    for (const value of filter.values) {
      // A GROUP MAY BE NAMED BY ANY OF ITS SPELLINGS. The representative is
      // what this layer publishes today, and a selection saved before the
      // grouping existed names one of the others — refusing it would turn a
      // correction into a broken saved view.
      const group = dimension.values.find(
        (candidate) => candidate.value === value || candidate.rawValues.includes(value),
      );
      if (!group) {
        throw new RangeError(`unknown value for filter dimension ${filter.dimensionKey}`);
      }
      chosen.add(group.value);
      for (const raw of group.rawValues) raws.add(raw);
    }
    if (chosen.size === 0) continue;
    constraints.push({
      dimensionKey: filter.dimensionKey,
      values: [...chosen].sort(codepointCompare),
      raws,
    });
  }
  constraints.sort((a, b) => codepointCompare(a.dimensionKey, b.dimensionKey));
  const normalized: AppliedFilter[] = constraints.map(({ dimensionKey, values }) => ({
    dimensionKey,
    values,
  }));

  const attributeValues = valuesByParticipant(source);
  const participantIds = new Set<string>();
  for (const participant of source.participants) {
    let keep = true;
    for (const constraint of constraints) {
      // THE RAW SET OF THIS CONSTRAINT, NEVER THE ECHO AND NEVER THE
      // DIMENSION'S. A participant's stored answer is the source's own bytes —
      // trailing space and all — so it is tested against every spelling the
      // options chosen IN THIS CONSTRAINT stand for.
      if (constraint.dimensionKey === COHORT_DIMENSION_KEY) {
        if (!constraint.raws.has(participant.cohortKey)) keep = false;
      } else {
        const value = attributeValues.get(participant.participantId)?.get(constraint.dimensionKey);
        const text = value && value.status === "answered" ? value.text ?? (value.numeric === null ? null : String(value.numeric)) : null;
        if (text === null || !constraint.raws.has(text)) keep = false;
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
