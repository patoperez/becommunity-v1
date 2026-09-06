/**
 * THE READ-MODEL SOURCE — what every adapter must produce, and nothing more.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * This is the seam between "where the canonical records live" and "what the
 * business calculations read". The calculators in this folder know only this
 * shape. An in-memory adapter builds it from a projected commit plan; a later
 * database adapter will build the identical shape from the canonical tables,
 * and neither calculator nor contract changes when that happens.
 *
 * TWO THINGS ARE DELIBERATELY ABSENT, and their absence is the privacy design:
 *
 *   1. THERE IS NO PERSON. No name, no external identifier, no person row. The
 *      read model addresses a PARTICIPATION, by an opaque id, and cannot name
 *      the human behind it even if a later edit wanted to.
 *
 *   2. THERE IS NO FREE TEXT. `ResultAnswer` carries a `text` only for items an
 *      adapter has been told are CLOSED-CODED categories. Everything else keeps
 *      its status and loses its words at the adapter boundary — an allowlist,
 *      rejecting by default, the same way every other untrusted boundary in
 *      this repository works.
 *
 * `import "server-only"` is deliberately NOT here. Nothing in this folder opens
 * a connection or holds a credential; it is pure, deterministic and evaluable
 * on workerd, which is what lets an offline gate run the real calculations. The
 * boundary that matters is enforced by `npm run test:canonical-results`, which
 * fails if any module here reaches a transport or if a browser module reaches a
 * formula.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import type { SourceValueStatus } from "../ingestion/canonical-package/values";

/** A person's role in one study and one cohort. The read model's atom. */
export type ResultParticipant = {
  participantId: string;
  cohortKey: string;
  participationStatus: "included" | "excluded" | "withdrawn";
  /** Whether the source says this person took their cohort's own instrument. */
  surveyParticipationStatus: "responded" | "not_participated" | "unknown";
  sourceStatus: SourceValueStatus;
};

export type ResultAttributeDefinition = {
  key: string;
  label: string;
  dataType: "text" | "category" | "number" | "date" | "boolean";
  sensitivity: "private" | "internal" | "client_eligible";
  filterable: boolean;
  displayOrder: number;
};

export type ResultAttributeValue = {
  participantId: string;
  attributeKey: string;
  status: SourceValueStatus;
  /** Present only for a definition the adapter was told is a closed category. */
  text: string | null;
  numeric: number | null;
};

export type ResultInstrument = {
  key: string;
  label: string;
  audience: string;
  instrumentType: "profile" | "survey" | "index" | "exit" | "other";
};

export type ResultDomain = {
  key: string;
  label: string;
  instrumentKey: string;
  displayOrder: number;
  /** True when a merged band in the source is what groups these columns. */
  groupedByMergedRange: boolean;
};

export type ResultItem = {
  key: string;
  label: string;
  instrumentKey: string;
  domainKey: string | null;
  scaleKey: string | null;
  itemOrder: number;
};

export type ResultScaleOption = {
  scaleKey: string;
  rawValue: string;
  /** Null for an option the scale does not put a number on. */
  numericValue: number | null;
  /** The label the SOURCE derived beside the value. Evidence, not an answer. */
  derivedLabel: string | null;
  displayOrder: number;
};

export type ResultSession = {
  sessionId: string;
  instrumentKey: string;
  participantId: string;
  status: SourceValueStatus;
};

export type ResultAnswer = {
  sessionId: string;
  itemKey: string;
  status: SourceValueStatus;
  numeric: number | null;
  /** Only for a closed-coded item. Null everywhere else, by construction. */
  text: string | null;
  /** The scale option this answer resolved to, when it resolved to one. */
  optionRawValue: string | null;
  /** The label the source derived beside the answer. Reconciliation evidence. */
  derivedLabel: string | null;
};

export type ResultRetentionPeriod = {
  seriesKey: string;
  order: number;
  label: string;
  startsOn: string | null;
  endsOn: string | null;
  starting: { count: number | null; status: SourceValueStatus };
  joined: { count: number | null; status: SourceValueStatus };
  ending: { count: number | null; status: SourceValueStatus };
  lost: { count: number | null; status: SourceValueStatus };
  identityVerified: boolean;
};

export type ResultPerformanceDimension = {
  key: string;
  label: string;
  displayOrder: number;
  bandSchemeKey: string | null;
};

export type ResultPerformanceObservation = {
  participantId: string;
  dimensionKey: string;
  periodStart: string;
  periodLabel: string;
  status: SourceValueStatus;
  value: number | null;
};

export type ResultBandRule = {
  schemeKey: string;
  lowerBound: number | null;
  upperBound: number | null;
  lowerInclusive: boolean;
  upperInclusive: boolean;
  label: string;
  semanticColor: "gray" | "red" | "yellow" | "green" | "safe" | "alert" | "danger" | "neutral";
  displayOrder: number;
};

export type ResultBandScheme = {
  key: string;
  label: string;
  unit: "score" | "percent" | "count" | "currency" | "ratio" | "years";
  description: string;
  rules: ResultBandRule[];
};

export type ResultMetricDefinition = {
  key: string;
  label: string;
  family: "nps" | "csat" | "tdp" | "cri" | "retention" | "churn" | "mean" | "count";
  unit: "score" | "percent" | "count" | "currency" | "ratio" | "years";
  precision: number;
  calculationVersion: string;
  bandSchemeKey: string | null;
};

export type ResultJourneyModel = {
  key: string;
  label: string;
  audience: string;
  displayOrder: number;
};

export type ResultJourneyStage = {
  key: string;
  label: string;
  journeyModelKey: string;
  stageOrder: number;
};

/**
 * A link from a curated journey stage to the evidence behind it.
 *
 * This array is EMPTY for Cuicuilco v1 and that is a finding, not an omission.
 * See `journey.ts` and `docs/CANONICAL_RESULTS_MODEL.md`.
 */
export type ResultJourneyStageEvidence = {
  journeyStageKey: string;
  metricKey: string | null;
  itemKey: string | null;
  performanceDimensionKey: string | null;
  role: "primary" | "supporting" | "context";
};

/**
 * One curated finding, carried WITHOUT its words.
 *
 * The curated pain map holds consultant prose that nobody has reviewed for
 * publication yet. The read model needs to know how MANY findings attach to
 * each curated entity and what review state they are in; it never needs the
 * prose, so the prose does not cross this boundary at all.
 */
export type ResultCuratedFinding = {
  reviewStatus: "pending" | "confirmed" | "rejected";
  journeyStageKeys: string[];
  organizationalUnitKeys: string[];
  performanceDimensionKeys: string[];
  cultureDimensionKeys: string[];
};

export type ResultNamedEntity = {
  key: string;
  label: string;
  displayOrder: number;
};

export type ResultCultureDimension = ResultNamedEntity & { audience: "edl" | "members" };

/** Study identity, carried through so a result can name the bytes behind it. */
export type ResultSourceIdentity = {
  specId: string;
  mappingVersion: number;
  calculationVersion: string;
  tenantId: string;
  studyId: string;
  packageIdempotencyKey: string;
  planFingerprint: string;
};

/**
 * The complete record set the calculators read.
 *
 * Ordering matters and is the adapter's responsibility: every array arrives in
 * the source's own order, so a result never depends on a hash iteration order.
 */
export type CanonicalResultSource = {
  identity: ResultSourceIdentity;
  participants: ResultParticipant[];
  attributeDefinitions: ResultAttributeDefinition[];
  attributeValues: ResultAttributeValue[];
  instruments: ResultInstrument[];
  domains: ResultDomain[];
  items: ResultItem[];
  scaleOptions: ResultScaleOption[];
  sessions: ResultSession[];
  answers: ResultAnswer[];
  retentionPeriods: ResultRetentionPeriod[];
  performanceDimensions: ResultPerformanceDimension[];
  performanceObservations: ResultPerformanceObservation[];
  bandSchemes: ResultBandScheme[];
  metricDefinitions: ResultMetricDefinition[];
  journeyModels: ResultJourneyModel[];
  journeyStages: ResultJourneyStage[];
  journeyStageEvidence: ResultJourneyStageEvidence[];
  organizationalUnits: ResultNamedEntity[];
  cultureDimensions: ResultCultureDimension[];
  curatedFindings: ResultCuratedFinding[];
};

/** An empty source. Every calculator must survive it without inventing a zero. */
export function emptyResultSource(identity: ResultSourceIdentity): CanonicalResultSource {
  return {
    identity,
    participants: [],
    attributeDefinitions: [],
    attributeValues: [],
    instruments: [],
    domains: [],
    items: [],
    scaleOptions: [],
    sessions: [],
    answers: [],
    retentionPeriods: [],
    performanceDimensions: [],
    performanceObservations: [],
    bandSchemes: [],
    metricDefinitions: [],
    journeyModels: [],
    journeyStages: [],
    journeyStageEvidence: [],
    organizationalUnits: [],
    cultureDimensions: [],
    curatedFindings: [],
  };
}
