/**
 * THE CANONICAL STUDY RESULTS CONTRACT — versioned, aggregate-only, server-computed.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THIS FILE IS FOR.
 *
 * A future dashboard must RECEIVE authoritative results, never compute them.
 * The standing rule that composite metrics are canonical functions defined once
 * (`src/lib/calc/metrics.ts`, `src/lib/calc/business-metrics.ts`) applies to
 * that dashboard exactly as it applies today, so the boundary between "the
 * server decided" and "the browser drew it" needs a shape. This is that shape.
 *
 * Everything here is an AGGREGATE. There is deliberately nowhere to put a
 * respondent row, a name, an identifier, a membership date or a raw qualitative
 * answer: the types do not admit one, and `npm run test:canonical-results`
 * re-checks the emitted object.
 *
 * VERSIONED. `CANONICAL_RESULTS_CONTRACT_VERSION` changes when the SHAPE
 * changes. `calculationVersion` (carried on every result) changes when a
 * FORMULA changes. They are different questions and are answered separately.
 *
 * THREE STATES, AND THEY ARE NOT INTERCHANGEABLE.
 *
 *   available   — the value was calculated and the base it rests on is stated.
 *   unavailable — there was nothing to calculate. A base of zero is NOT a
 *                 measured zero, and this state is what keeps the two apart.
 *   unresolved  — the sources disagree, or the relationship the metric would
 *                 need has not been stated by any authority. Neither a pass
 *                 nor a failure: a question for a human, carried in the data
 *                 instead of guessed.
 *
 * NO SUPPRESSION. A small base is REPORTED, never used to withhold a result.
 * Every result carries the exact base it rests on and enough accounting for a
 * later, configurable privacy rule to be applied by a layer that owns that
 * decision — but this layer applies none. See `docs/CANONICAL_RESULTS_MODEL.md`.
 *
 * NO FORMULA DISCLOSURE. `explanation` is client-safe prose. The formula, the
 * document section that authorises it and any internal caveat live in
 * `internal`, which a client surface must not render.
 * ─────────────────────────────────────────────────────────────────────────────
 */

/**
 * The SHAPE version. Bump when a field is added, removed or re-typed.
 *
 * 2.0.0 — the methodology owner resolved the questions 1.0.0 was carrying, and
 * the shape moved with them: the touchpoint's authoritative unawareness metric
 * is now `tdp` (the ratio over the valid base) with the auxiliary proportion
 * beside it under an explicit name, and the journey's stage-evidence result is
 * a settled contract rule rather than an open question. Breaking, so major.
 *
 * 2.1.0 — `FilterValue` gained `label`. A filter value is the only place this
 * contract published a string a reader would be shown WITHOUT the study's own
 * words for it: the cohort dimension's values are `active` and `deserter`, and
 * the Spanish the study actually uses for them — «Miembros activos»,
 * «Desertores» — sat unused in the specification. A surface offering those
 * values as controls would print the enum. Additive, so minor: nothing moved,
 * nothing was re-typed, and no number changed.
 *
 * 2.2.0 — `FilterDimension` gained `cohortLabels`. A study can ask the SAME
 * question of two different populations on two different sheets, and this
 * contract then publishes two dimensions with byte-identical labels —
 * «Generación» twice, «Giro» twice, six pairs in the approved study. They are
 * not interchangeable: each is answered by exactly one cohort, so a selection
 * on one is implicitly scoped to that cohort, and a surface that showed them
 * under one name would offer a reader two controls it could not tell apart.
 * Which cohorts answered is a fact this layer already holds; saying it is what
 * lets a surface name them truthfully. Additive, so minor.
 *
 * 2.3.0 — `FilterValue` gained `rawValues`. The source states one answer in
 * more than one spelling: «Construcción» and «Construcción·» — the same word
 * with a trailing space — were two filter options with two counts, and the
 * approved study's «Giro» column carries FOUR such pairs while «Tipo de
 * empresa» carries one. A reader picking one of them saw a third of the
 * people who had actually answered it, and no screen could tell them apart.
 *
 * So a filter value is now a GROUP: one display spelling, and every canonical
 * raw value that differs from it by leading or trailing whitespace only. The
 * raws are preserved rather than rewritten — the canonical rows are evidence
 * and this boundary does not edit evidence — and `applyFilters` matches a
 * person carrying ANY of them. Values differing by so much as one internal
 * character are never merged: that would be this layer deciding two answers
 * mean the same thing, which is an editorial judgement nobody made.
 *
 * Additive in SHAPE and not in OUTPUT: a dimension that had a whitespace
 * twin now publishes one option instead of two, and its participant count is
 * the sum. That is the defect being corrected, not a side effect of it.
 *
 * 3.0.0 — `QualitativeGroupResult.reviewStatus` is GONE, and its removal is
 * the reason this is a major. It was the literal `"pending"`, written by
 * `buildQualitativeGroups` on every group of every study for ever, and it was
 * read as «nobody at Be Community has reviewed these categories». That reading
 * was true of nothing: this layer cannot know whether anybody reviewed
 * anything, because a review is a person's act recorded somewhere else, and a
 * constant that never changes is not a fact — it is a sentence that happens to
 * be printed. A review surface consequently showed the same permanent warning
 * whatever anybody did, which is how a warning stops being read.
 *
 * `coding` replaces it and says the thing this layer DOES know: where the
 * categories came from. `source_coded` means the source's own closed-coded
 * columns — the category vocabulary the study itself created while reading
 * answers — and `be_community_curated` means a Be Community analyst produced
 * them. The two are decided differently and the distinction is the first thing
 * a reviewer needs; conflating them under one review state hid it.
 *
 * WHERE THE REVIEW STATE WENT. To the publication boundary, tied to a DIGEST
 * of the exact category set, so «reviewed» means «reviewed these words» and
 * goes stale by itself when the words change. `CuratedFindingCount.reviewStatus`
 * stays exactly as it was: that one is a real canonical column on `pain_point`,
 * written by ingestion and readable per row.
 */
export const CANONICAL_RESULTS_CONTRACT_VERSION = "3.0.0";

/**
 * The unit a number lives in. Presentation may style it; it may not change it.
 *
 * A unit exists per DECLARED PRECISION, not per pretty name: each one below is
 * pinned to a `DECIMALS` entry in `docs/CALCULATION_POLICY.md` §4, and the
 * canonical function that produces a value of that unit already rounds at
 * exactly that precision. Collapsing two units with different precisions into
 * one — a −100..100 recommendation score and a 1..5 rating average, say — is
 * how a value gets rounded a second time, at a coarser precision, and moves.
 */
export type ResultUnit =
  /** Net Promoter Score, −100..100, one decimal. */
  | "nps"
  /** A composite index on a 0..100 points scale, one decimal. */
  | "index"
  /** A percentage, 0..100, one decimal. */
  | "percent"
  /** A ratio expressed per hundred that may exceed 100, one decimal. */
  | "ratio"
  /** A rating-scale average, two decimals. */
  | "score"
  /** A whole count. */
  | "count";

export type ResultStatus = "available" | "unavailable" | "unresolved";

/** Why there was nothing to calculate. Never a synonym for "the answer is 0". */
export type UnavailableReason =
  /** Nobody was eligible for this instrument at all. */
  | "no_eligible_population"
  /** Eligible people existed; none of them produced a record. */
  | "no_responses"
  /** Records existed; none carried an answer the formula can use. */
  | "no_valid_answers"
  /** The source does not carry this measurement for this study. */
  | "not_collected"
  /** The applied filter selection matches nobody. */
  | "empty_filtered_population"
  /** An authority forbids this cross. The value exists; publishing it does not. */
  | "cross_not_permitted";

/** Why a value is a question rather than a number. */
export type UnresolvedReason =
  /** Two authorities give different denominators, scales or names. */
  | "authority_conflict"
  /** No authority states the relationship this result would assert. */
  | "relationship_not_stated"
  /** The source carries part of what the metric needs and not the rest. */
  | "source_incomplete";

/**
 * Answer accounting for one aggregate.
 *
 * Empty, missing, invalid, not-applicable and ZERO stay distinguishable here.
 *
 * The first six fields PARTITION the records: every record is counted in
 * exactly one of them, and they sum to the number of records considered.
 *
 * The last three are SUBSETS of `answered`, not further states, and are
 * reported separately because each answers a question the partition cannot:
 * `outOfScale` — answered, but off the scale the metric is defined on;
 * `phenomenon` — answered with the very category the metric measures (an
 * unawareness reply is not a missing satisfaction rating); and `zeroValued` —
 * answered with the number zero, so a measured nought is never mistaken for
 * nothing at all.
 */
export type AnswerAccounting = {
  answered: number;
  missing: number;
  unknown: number;
  notApplicable: number;
  sourceUnavailable: number;
  notParticipated: number;
  /** Answered, but outside the scale the metric is defined on. Bad data. */
  outOfScale: number;
  /** Answered with a value the metric treats as its own phenomenon (e.g. unawareness). */
  phenomenon: number;
  /** Of `answered`, how many carried the number zero. */
  zeroValued: number;
};

export function emptyAccounting(): AnswerAccounting {
  return {
    answered: 0,
    missing: 0,
    unknown: 0,
    notApplicable: 0,
    sourceUnavailable: 0,
    notParticipated: 0,
    outOfScale: 0,
    phenomenon: 0,
    zeroValued: 0,
  };
}

/**
 * The three bases, kept apart on purpose.
 *
 * `eligible` is not a population and a population is not a denominator. A study
 * of sixty people can carry an instrument only twenty-eight of them were asked,
 * eleven of whom answered — and none of those three numbers is the denominator
 * of every metric in it.
 */
export type ResultBase = {
  /** People this instrument could in principle measure. */
  eligible: number;
  /** Of those, the ones that produced a record for it. */
  responded: number;
  /** Of those records, the ones carrying an answer this formula uses. THE DENOMINATOR. */
  valid: number;
  accounting: AnswerAccounting;
};

export function emptyBase(): ResultBase {
  return { eligible: 0, responded: 0, valid: 0, accounting: emptyAccounting() };
}

/** A document, section and the statement that authorises a decision. Internal. */
export type AuthorityReference = {
  /** Stable id so a report can cite the same authority twice without repeating it. */
  id: string;
  document: string;
  section: string;
  /** What that section states, in the language it states it. Internal only. */
  statement: string;
};

/** Everything a reviewer needs to audit a number. Not client copy. */
export type ResultInternalProvenance = {
  /** Canonical `metric_definition.key` when the projection carries one. */
  metricKey: string | null;
  /** The canonical families the value was computed from. */
  sources: string[];
  authorities: AuthorityReference[];
  notes: string[];
};

/**
 * Provenance as it crosses the boundary.
 *
 * `explanation` is the only field a client surface may render. It is prose: no
 * digit, no operator, no formula — a description of WHAT was measured, never of
 * HOW. The gate enforces that character by character, because "safe explanatory
 * copy" is exactly the kind of promise that decays one helpful edit at a time.
 */
export type ResultProvenance = {
  calculationVersion: string;
  explanation: string;
  internal: ResultInternalProvenance;
};

export type SemanticColor = "gray" | "red" | "yellow" | "green" | "safe" | "alert" | "danger" | "neutral";

/**
 * A presentation band.
 *
 * The RANGE is a documented business rule and lives in the canonical band
 * functions. The LABEL is configuration read from the study's own band scheme.
 * A colour is a semantic name, never a hex value: the palette belongs to the UI.
 */
export type ResultBand = {
  schemeKey: string;
  semanticColor: SemanticColor;
  label: string | null;
};

/**
 * One number, already final.
 *
 * `value` is rounded EXACTLY ONCE, by the canonical function that defines the
 * metric, at the precision its unit declares (`docs/CALCULATION_POLICY.md` §4).
 * `formatted` is the presentation boundary — `formatNumber` — applied here, on
 * the server, so the browser never rounds. Re-rounding an already-rounded value
 * at the same precision cannot move it, which is what makes both true at once.
 */
export type ResultValue = {
  value: number;
  unit: ResultUnit;
  decimals: number;
  formatted: string;
  band: ResultBand | null;
};

/** One candidate reading of a metric two authorities define differently. */
export type ResultCandidate = {
  authorityId: string;
  /** What this authority uses as the denominator, in words. */
  denominator: string;
  value: ResultValue;
  base: ResultBase;
};

export type MetricResult = {
  key: string;
  label: string;
  base: ResultBase;
  provenance: ResultProvenance;
} & (
  | { status: "available"; value: ResultValue }
  | { status: "unavailable"; reason: UnavailableReason; detail: string }
  | {
      status: "unresolved";
      reason: UnresolvedReason;
      detail: string;
      /** Every reading an authority actually states. Never a preferred one. */
      candidates: ResultCandidate[];
    }
);

/** Collected at the top level so a reader never has to hunt for the open questions. */
export type UnresolvedItem = {
  key: string;
  section: string;
  reason: UnresolvedReason;
  detail: string;
  /** What would settle it. */
  wouldBeSettledBy: string;
  authorities: AuthorityReference[];
};

/**
 * Something the contract deliberately leaves to configuration or to editorial
 * review — settled, not open.
 *
 * The difference from `UnresolvedItem` is the whole point. An unresolved item
 * is a question nobody has answered; a configuration requirement is an answer:
 * "this is not calculated, and here is who supplies it." Reporting the second
 * as the first turns a working design into a permanent-looking defect.
 */
export type ConfigurationRequirement = {
  key: string;
  section: string;
  /** Whether a study/template configures it, or a human curates the content. */
  kind: "study_configuration" | "editorial_review";
  detail: string;
  /** Who supplies it, and in what artefact. */
  suppliedBy: string;
  authorities: AuthorityReference[];
};

/* -------------------------------------------------------------------------- */
/* population                                                                  */
/* -------------------------------------------------------------------------- */

export type CohortResult = {
  key: string;
  label: string;
  /** Everyone the source places in this cohort. */
  total: number;
  /** Of those, the ones that left at least one measured datum behind. */
  measured: number;
  /** Of those, the ones that answered this cohort's own instrument. */
  responded: number;
  /** Of those, the ones the source states did NOT take part. Not a missing answer. */
  notParticipated: number;
  /** Neither responded nor declined — the source says nothing. */
  participationUnknown: number;
};

export type InstrumentBaseResult = {
  key: string;
  label: string;
  /** Which cohorts this instrument was put to. */
  cohortKeys: string[];
  base: ResultBase;
};

export type PopulationResult = {
  /** The study population. The headline figure, and almost never a denominator. */
  total: number;
  /** People with at least one measured datum. Different from `total`, on purpose. */
  measured: number;
  cohorts: CohortResult[];
  instruments: InstrumentBaseResult[];
  provenance: ResultProvenance;
};

/* -------------------------------------------------------------------------- */
/* filters                                                                     */
/* -------------------------------------------------------------------------- */

export type FilterValue = {
  /**
   * The value as the SOURCE states it. Never shown to a reader on its own.
   *
   * For an attribute it is the answer text; for the cohort dimension it is the
   * cohort key, which is an internal enum. A surface must render `label`.
   *
   * WHEN A GROUP HAS SEVERAL RAW SPELLINGS this is the FIRST of them in
   * codepoint order — a stable representative, so a stored selection and an
   * echoed one name the same string across two builds. It is never the whole
   * answer to «who carries this»: that is `rawValues`, and every matcher must
   * use it.
   */
  value: string;
  /**
   * EVERY canonical raw value this display option stands for.
   *
   * At least one, and equal to `[value]` in the ordinary case. More than one
   * when the source spells one answer several ways with different leading or
   * trailing whitespace. The raws are the canonical rows' own bytes,
   * preserved: nothing here rewrites evidence, and a lineage trace still
   * leads back to the exact cell.
   *
   * MEANINGFUL TEXT IS NEVER MERGED. «B2B» and «B2B ·» group; «B2B» and «B2C»
   * do not, and neither do «Construcción» and «Construccion». Deciding two
   * differently-spelled answers mean the same thing is an editorial act with
   * a person's name on it, and this boundary does not perform editorial acts.
   */
  rawValues: string[];
  /**
   * The study's own words for this value.
   *
   * Equal to `value` for an attribute — the answer text IS what a reader is
   * shown — and the specification's declared label for a cohort. It exists so
   * that a control can be built without a surface having to know which
   * dimension is which, and so that `active` never reaches a screen.
   */
  label: string;
  /**
   * How many people in the unfiltered population carry it.
   *
   * Over the WHOLE group: somebody who answered «Construcción·» and somebody
   * who answered «Construcción» both carry this option, because they gave the
   * same answer.
   */
  participants: number;
};

export type FilterDimension = {
  key: string;
  label: string;
  /**
   * The study's own words for the cohorts that ANSWERED this characteristic.
   *
   * Empty for the cohort dimension itself — it IS the cohorts — and empty for a
   * characteristic nobody answered. One entry means the characteristic is
   * recorded for exactly that population, which is what a surface needs in
   * order to tell two identically-worded questions apart without inventing a
   * distinction. Two or more means it is asked of several, and no qualifier is
   * needed.
   *
   * It is a DESCRIPTION and not a filter: nothing here narrows a population, and
   * a dimension's own `values` and counts are unchanged by it.
   */
  cohortLabels: string[];
  dataType: "text" | "category" | "number" | "date" | "boolean";
  values: FilterValue[];
  /**
   * People carrying no answer for this dimension, by source state. They are
   * NOT folded into a "sin dato" value: absence keeps its own state.
   */
  absent: { status: string; participants: number }[];
  /**
   * Sections this dimension may NOT be crossed with, and the authority that
   * forbids it. A forbidden cross is refused, not silently dropped.
   */
  forbiddenSections: { section: string; authorityId: string }[];
};

export type AppliedFilter = {
  dimensionKey: string;
  /**
   * Values selected. Empty means the dimension was not constrained.
   *
   * ONE ENTRY PER DISPLAY OPTION, named by its representative `value`, not
   * one per raw spelling. A selection is a reader choosing an answer; that
   * the source wrote that answer two ways is not part of what they chose, and
   * an echo listing both would show them a choice they did not make.
   * `applyFilters` expands each entry to its group's whole raw set before
   * testing anybody, and it accepts a raw spelling as a name for its group so
   * a selection stored before the grouping existed still resolves.
   */
  values: string[];
};

export type FilterResult = {
  dimensions: FilterDimension[];
  applied: AppliedFilter[];
  /** People remaining AFTER the filter and BEFORE any aggregation. */
  resultingPopulation: number;
  /** True when a selection matched nobody. Not an error, and not a zero. */
  empty: boolean;
};

/* -------------------------------------------------------------------------- */
/* recommendation (NPS)                                                        */
/* -------------------------------------------------------------------------- */

/**
 * Promoters, passives and detractors.
 *
 * NULL when there was no valid base to classify. A recommendation nobody
 * answered is not a chapter of zero promoters — and since a plain `number`
 * cannot say which of the two it is, the absence gets the null.
 */
export type NpsDistribution = {
  promoters: number | null;
  passives: number | null;
  detractors: number | null;
};

export type NpsScopeResult = {
  key: string;
  label: string;
  /** Which cohorts the scope pools. */
  cohortKeys: string[];
  score: MetricResult;
  distribution: NpsDistribution;
  /**
   * Each band's share of the valid base, rounded once at percent precision.
   * Null on an empty base, for the same reason the counts are.
   */
  distributionShare: NpsDistribution;
  scale: { min: number; max: number };
};

/* -------------------------------------------------------------------------- */
/* renewal intention (CRI)                                                     */
/* -------------------------------------------------------------------------- */

export type RenewalCategoryResult = {
  /** The documented response, exactly as the catalogue spells it. */
  response: string;
  /** The documented alert level for that response. */
  level: string;
  riskPoints: number;
  /**
   * How many people chose this rung.
   *
   * A rung nobody chose over a real base is a MEASURED ZERO and is reported as
   * `0` — that is the point of publishing all five rungs. `null` means there was
   * no base at all, which is a different fact and must not read as agreement.
   */
  count: number | null;
  /** Share of the valid base, rounded once at percent precision. Null on an empty base. */
  share: number | null;
};

export type RenewalResult = {
  index: MetricResult;
  /**
   * The five rungs — or NULL when the whole indicator is refused.
   *
   * An authority that forbids a cross forbids the DISTRIBUTION as much as the
   * index. Publishing five zeroes beside a non-empty base would state that
   * nobody chose anything, which is false; null states that nothing is being
   * reported, which is what a refusal means.
   */
  distribution: RenewalCategoryResult[] | null;
  base: ResultBase;
};

/* -------------------------------------------------------------------------- */
/* retention and attrition                                                     */
/* -------------------------------------------------------------------------- */

export type PeriodCount = {
  /** Null whenever the source did not give a number. Never a filled-in 0. */
  count: number | null;
  status: string;
};

export type RetentionPeriodResult = {
  seriesKey: string;
  order: number;
  /** The source's own label, byte for byte. It is not uniform, and it is a key. */
  label: string;
  startsOn: string | null;
  endsOn: string | null;
  starting: PeriodCount;
  joined: PeriodCount;
  ending: PeriodCount;
  lost: PeriodCount;
  /** True only when four counts exist AND final = inicial - perdidos + nuevos. */
  identityVerified: boolean;
  retention: MetricResult;
  attrition: MetricResult;
};

/* -------------------------------------------------------------------------- */
/* journey                                                                     */
/* -------------------------------------------------------------------------- */

export type JourneyTouchpointResult = {
  key: string;
  /** The item label exactly as the source states it — for this study, the full question. */
  label: string;
  /**
   * A short display name, when the source carries one.
   *
   * NULL for Cuicuilco v1. The satisfaction sheet does carry a short label in
   * the column beside each answer, but the projection records that column as
   * the answer's derived label rather than as the item's name, so no short name
   * reaches the canonical record set. Deriving one by cutting the question text
   * apart would be a transformation nobody documented, so this stays null until
   * a projection revision records the label column's own header.
   */
  shortLabel: string | null;
  groupKey: string;
  /** Position inside its group, from the source's own column order. */
  order: number;
  /**
   * The touchpoint's own satisfaction result.
   *
   * A touchpoint DIRECTLY OWNS this and the two unawareness results below,
   * together with their bases. No other study metric attaches to it: see
   * `JourneyStageEvidenceResult`.
   */
  satisfaction: MetricResult;
  /**
   * TDP — Tasa de Desconocimiento de Proceso. THE metric of that name.
   *
   * Unawareness over the VALID base (satisfied + dissatisfied), per process
   * documentation §4.1 and the owner decision of 2026-09-06. A ratio: it may
   * exceed 100, and is deliberately not clamped.
   */
  tdp: MetricResult;
  /**
   * AUXILIARY — unawareness over every classified response of the touchpoint.
   *
   * A different quantity with a different denominator, kept because it is the
   * complement of "% who know this process" and that pair closes at a hundred.
   * It is never called TDP and never replaces it.
   */
  unawareShareOfResponses: MetricResult;
  counts: {
    satisfied: number;
    dissatisfied: number;
    unaware: number;
    /** satisfied + dissatisfied. The CSAT denominator. */
    valid: number;
    /** valid + unaware. Every response the touchpoint received. */
    responses: number;
  };
  scale: { min: number; max: number; satisfiedFrom: number };
};

export type JourneyGroupResult = {
  key: string;
  label: string;
  order: number;
  /** Touchpoint keys, in the order the source presents them. */
  touchpointKeys: string[];
  /** Evidence that this grouping is the source's, not the product's. */
  provenance: ResultProvenance;
};

/** A touchpoint the source carries and this study deliberately does not report. */
export type JourneyExclusion = {
  key: string;
  label: string;
  ruleId: string;
  detail: string;
  authorityId: string | null;
};

/** One curated journey stage with no proven metric behind it. */
/** One stage-to-evidence link, present only when configuration supplies it. */
export type JourneyStageEvidenceLink = {
  stageKey: string;
  metricKey: string | null;
  itemKey: string | null;
  performanceDimensionKey: string | null;
  role: "primary" | "supporting" | "context";
};

/**
 * How a journey stage relates to a metric — a SETTLED CONTRACT RULE, not an
 * open question.
 *
 * A touchpoint directly owns its satisfaction result and its two unawareness
 * results, with their bases. Study-level metrics — recommendation, renewal
 * risk, retention, attrition, LTV — are NOT implicitly attached to any
 * touchpoint or stage, and no generic association is ever inferred. That is the
 * rule, decided by the methodology owner on 2026-09-06, and it is the correct
 * answer for this study rather than a gap in it.
 *
 * `links` is therefore empty unless a study or template EXPLICITLY configures
 * one, with provenance. `requires_explicit_configuration` names exactly that:
 * nothing is missing, and anything further is a configuration act.
 */
export type JourneyStageEvidenceResult = {
  status: "requires_explicit_configuration";
  /** The stable id of the contract rule, so a reader can look it up. */
  rule: "journey_stage_evidence_is_explicit_only";
  detail: string;
  /** What a future study must declare for a link to exist. */
  configuredBy: string;
  /** Links a configuration actually supplied. Empty for Cuicuilco v1. */
  links: JourneyStageEvidenceLink[];
  authorities: AuthorityReference[];
};

export type JourneyModelResult = {
  key: string;
  label: string;
  audience: string;
  stages: { key: string; label: string; order: number }[];
};

export type JourneyResult = {
  groups: JourneyGroupResult[];
  touchpoints: JourneyTouchpointResult[];
  excluded: JourneyExclusion[];
  /** The curated stage model, kept apart from the measured touchpoints. */
  curatedModels: JourneyModelResult[];
  stageEvidence: JourneyStageEvidenceResult;
};

/* -------------------------------------------------------------------------- */
/* performance                                                                 */
/* -------------------------------------------------------------------------- */

export type PerformancePeriodResult = {
  dimensionKey: string;
  periodStart: string;
  label: string;
  mean: MetricResult;
  /** The band each observed value fell in. Counts only. */
  bandCounts: { semanticColor: SemanticColor; label: string | null; count: number }[];
};

export type PerformanceDimensionResult = {
  key: string;
  label: string;
  order: number;
  periods: PerformancePeriodResult[];
};

/* -------------------------------------------------------------------------- */
/* qualitative                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * One curated category and its count.
 *
 * A LABEL and a COUNT, and never a respondent's words. The free-text column
 * beside every closed-coded category column does not enter the read model in
 * any shape, so a textual answer cannot be aggregated here even by accident.
 */
export type QualitativeTerm = {
  label: string;
  count: number;
  /** Share of the group's total mentions, rounded once at percent precision. */
  share: number | null;
};

/**
 * How many curated findings attach to one curated entity.
 *
 * COUNTS ONLY. The curated pain map is consultant prose nobody has cleared for
 * publication, so its words never cross this boundary — but how many findings
 * a stage, a team or a dimension accumulated is a real, provable aggregate,
 * carried by the real foreign keys the projection wrote.
 */
export type CuratedFindingCount = {
  entityKind: "journey_stage" | "organizational_unit" | "performance_dimension" | "culture_dimension";
  entityKey: string;
  entityLabel: string;
  count: number;
  reviewStatus: "pending" | "confirmed" | "mixed";
};

export type QualitativeGroupResult = {
  key: string;
  label: string;
  /** Which cohort produced the mentions. */
  cohortKeys: string[];
  /** Where the categories come from, in words a client may read. */
  sourceDescription: string;
  /** Total mentions covered by `terms`. */
  total: number;
  base: ResultBase;
  /** A documented category deliberately kept out of the cloud, and its count. */
  excluded: { label: string; count: number }[];
  terms: QualitativeTerm[];
  /**
   * WHERE THESE CATEGORIES CAME FROM — and deliberately NOT a review state.
   *
   * This field replaced `reviewStatus`, which was the constant `"pending"` on
   * every group of every study. Whether a person at Be Community has read a
   * category set is not something the canonical layer can know: it is an act
   * recorded at the publication boundary, against a digest of the exact set
   * that was read. What this layer knows is provenance, and provenance is what
   * decides who has to look:
   *
   *   `source_coded`         — the source's own closed-coded category columns,
   *                            a vocabulary the study created while reading its
   *                            own answers. Publishing them shows a client the
   *                            study's coding as it came.
   *   `be_community_curated` — categories a Be Community analyst produced.
   *                            Publishing them shows a client our own words.
   *
   * The two are different decisions, and a review screen that could not tell
   * them apart was asking one question about two things.
   */
  coding: "source_coded" | "be_community_curated";
  provenance: ResultProvenance;
};

/* -------------------------------------------------------------------------- */
/* the document                                                                */
/* -------------------------------------------------------------------------- */

export type StudyIdentity = {
  specId: string;
  mappingVersion: number;
  calculationVersion: string;
  tenantId: string;
  studyId: string;
  /** The package the numbers came from: mapping version, roles and file hashes. */
  packageIdempotencyKey: string;
  /** sha256 over the projected plan. Two equal fingerprints are the same numbers. */
  planFingerprint: string;
};

export type StudyPeriod = {
  label: string | null;
  /** ISO date the source was cut at, when the study declares one. */
  dataCutoff: string | null;
};

export type CanonicalStudyResults = {
  contractVersion: string;
  study: StudyIdentity;
  period: StudyPeriod;
  population: PopulationResult;
  filters: FilterResult;
  recommendation: { scopes: NpsScopeResult[] };
  renewal: RenewalResult;
  retention: { periods: RetentionPeriodResult[] };
  journey: JourneyResult;
  performance: { dimensions: PerformanceDimensionResult[] };
  qualitative: { groups: QualitativeGroupResult[]; curatedFindingCounts: CuratedFindingCount[] };
  /**
   * Every open question in the document, gathered in one place.
   *
   * EMPTY is the healthy state, and for Cuicuilco it is empty: what this array
   * once carried was resolved by the methodology owner on 2026-09-06 and now
   * appears either as a settled rule or in `configurationRequired`.
   */
  unresolved: UnresolvedItem[];
  /** What is deliberately supplied by configuration or editorial review. */
  configurationRequired: ConfigurationRequirement[];
};
