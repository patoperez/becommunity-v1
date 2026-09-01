/**
 * The PRIVATE canonical commit plan.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THIS TYPE IS THE OPPOSITE OF THE PREFLIGHT DTO, ON PURPOSE.
 *
 * `CanonicalPackagePreflight` (Unit 2) is displayed on an internal screen,
 * written to logs and stored on `import_job.error_report`, so it deliberately
 * carries no name, answer, qualitative text, category value or identifier —
 * only structure, coordinates, counts, hashes and colours.
 *
 * A commit needs exactly the values that DTO refuses to carry. Widening the
 * preflight to reach them would copy every respondent's name and every answer
 * into a screen, a log line and a stored jsonb column in one edit, so the two
 * shapes stay separate types with separate rules:
 *
 *   `CanonicalPackagePreflight`  safe    → screen, log, error_report, tests
 *   `CanonicalCommitPlan`        private → the RPC payload, and nothing else
 *
 * A value in this file may travel to exactly one place: `p_plan` of
 * `public.commit_canonical_package`, over the service-role connection, from a
 * `server-only` module. It must never be logged, never be returned to a
 * browser, never be embedded in an error and never be written to a file. The
 * Unit 3 gate asserts that the safe result DTO and every error path are free of
 * the sentinel values planted in its fixtures.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import type { SourceValueStatus } from "../canonical-package/values";

/** Every family the commit RPC knows how to write, in payload order. */
export const PLAN_FAMILIES = [
  "persons",
  "personIdentifiers",
  "participants",
  "membershipEpisodes",
  "attributeDefinitions",
  "participantAttributeValues",
  "responseScales",
  "responseOptions",
  "surveyInstruments",
  "studyDomains",
  "surveyItems",
  "surveySessions",
  "surveyResponses",
  "visualAnnotations",
  "performanceDimensions",
  "performanceObservations",
  "bandSchemes",
  "bandRules",
  "retentionPeriods",
  "metricDefinitions",
  "metricItemLinks",
  "journeyModels",
  "journeyStages",
  "journeyStageEvidenceLinks",
  "organizationalUnits",
  "cultureDimensions",
  "painPoints",
  "painPointJourneyStages",
  "painPointOrganizationalUnits",
  "painPointPerformanceDimensions",
  "painPointCultureDimensions",
  "sourceLineage",
] as const;

export type PlanFamily = (typeof PLAN_FAMILIES)[number];

/** A person, before the database has decided whether it already knows them. */
export type PlanPerson = {
  /** Plan-local handle. Rows reference a person by this, never by row order. */
  key: string;
  /** The uuid used ONLY if this tenant has no person behind the same identity. */
  id: string;
  displayName: string;
  normalizedName: string;
  /** The identity the database matches on to reuse an existing person. */
  identityNamespace: string;
  identityNormalizedValue: string;
};

export type PlanPersonIdentifier = {
  id: string;
  personKey: string;
  namespace: string;
  originalValue: string;
  normalizedValue: string;
  isPrimary: boolean;
};

export type PlanParticipant = {
  id: string;
  personKey: string;
  cohortKey: string;
  participationStatus: "included" | "excluded" | "withdrawn";
  surveyParticipationStatus: "responded" | "not_participated" | "unknown";
  sourceStatus: SourceValueStatus;
};

export type PlanMembershipEpisode = {
  id: string;
  participantId: string;
  startsOn: string | null;
  endsOn: string | null;
  status: Exclude<SourceValueStatus, "not_participated">;
  endReason: string | null;
};

export type PlanAttributeDefinition = {
  id: string;
  key: string;
  label: string;
  dataType: "text" | "category" | "number" | "date" | "boolean";
  sensitivity: "private" | "internal" | "client_eligible";
  filterable: boolean;
  displayOrder: number;
};

export type PlanParticipantAttributeValue = {
  id: string;
  participantId: string;
  attributeDefinitionId: string;
  status: SourceValueStatus;
  valueText: string | null;
  valueNumeric: number | null;
  valueDate: string | null;
  valueBoolean: boolean | null;
  /** The source cell exactly as the workbook spells it. Never a normalisation. */
  sourceRawValue: string | null;
};

export type PlanResponseScale = {
  id: string;
  key: string;
  label: string;
  valueType: "numeric" | "text" | "mixed";
};

export type PlanResponseOption = {
  id: string;
  responseScaleId: string;
  rawValue: string;
  numericValue: number | null;
  /** The label the SOURCE derived beside the value. Evidence, not a second answer. */
  derivedLabel: string | null;
  responseStatus: Exclude<SourceValueStatus, "not_participated">;
  displayOrder: number;
};

export type PlanSurveyInstrument = {
  id: string;
  key: string;
  label: string;
  audience: string;
  version: number;
  instrumentType: "profile" | "survey" | "index" | "exit" | "other";
};

export type PlanStudyDomain = {
  id: string;
  surveyInstrumentId: string;
  key: string;
  label: string;
  displayOrder: number;
  visualAnnotationId: string | null;
};

export type PlanSurveyItem = {
  id: string;
  surveyInstrumentId: string;
  studyDomainId: string | null;
  responseScaleId: string | null;
  key: string;
  prompt: string;
  label: string;
  itemOrder: number;
};

export type PlanSurveySession = {
  id: string;
  surveyInstrumentId: string;
  participantId: string;
  sourceAssetRole: string;
  sourceRowNumber: number | null;
  occurrenceKey: string;
  submittedAt: string | null;
  status: SourceValueStatus;
};

export type PlanSurveyResponse = {
  id: string;
  surveySessionId: string;
  surveyItemId: string;
  responseOptionId: string | null;
  status: SourceValueStatus;
  valueNumeric: number | null;
  valueText: string | null;
  valueDate: string | null;
  valueBoolean: boolean | null;
  sourceRawValue: string | null;
  /** The spreadsheet's own label for this answer. Reconciliation evidence only. */
  sourceDerivedLabel: string | null;
};

export type PlanVisualAnnotation = {
  id: string;
  sourceAssetRole: string;
  sheetName: string;
  cellOrRange: string;
  fillRgb: string | null;
  fontRgb: string | null;
  sourceStyleId: number | null;
  role:
    | "structural_group"
    | "metric_band"
    | "curated_warning"
    | "process_group"
    | "section_emphasis"
    | "curated_annotation"
    | "unhighlighted";
  interpretation: string;
  confidence: "observed" | "inferred" | "confirmed";
  reviewStatus: "pending" | "confirmed" | "rejected";
};

export type PlanPerformanceDimension = {
  id: string;
  key: string;
  label: string;
  displayOrder: number;
};

export type PlanPerformanceObservation = {
  id: string;
  participantId: string;
  performanceDimensionId: string;
  periodStart: string;
  periodLabel: string;
  status: SourceValueStatus;
  value: number | null;
  sourceBandLabel: string | null;
  visualAnnotationId: string | null;
};

export type PlanBandScheme = {
  id: string;
  key: string;
  label: string;
  unit: "score" | "percent" | "count" | "currency" | "ratio" | "years";
  description: string;
};

export type PlanBandRule = {
  id: string;
  bandSchemeId: string;
  lowerBound: number | null;
  upperBound: number | null;
  lowerInclusive: boolean;
  upperInclusive: boolean;
  label: string;
  semanticColor: "gray" | "red" | "yellow" | "green" | "safe" | "alert" | "danger" | "neutral";
  displayOrder: number;
};

export type PlanRetentionPeriod = {
  id: string;
  seriesKey: string;
  periodOrder: number;
  periodLabel: string;
  periodStartsOn: string | null;
  periodEndsOn: string | null;
  startingStatus: SourceValueStatus;
  startingCount: number | null;
  newStatus: SourceValueStatus;
  newCount: number | null;
  endingStatus: SourceValueStatus;
  endingCount: number | null;
  lostStatus: SourceValueStatus;
  lostCount: number | null;
  /** True only when the four counts exist AND final = inicial - perdidos + nuevos. */
  identityVerified: boolean;
};

export type PlanMetricDefinition = {
  id: string;
  key: string;
  label: string;
  family: "nps" | "csat" | "tdp" | "cri" | "retention" | "churn" | "mean" | "count";
  unit: "score" | "percent" | "count" | "currency" | "ratio" | "years";
  precision: number;
  calculationVersion: string;
  bandSchemeId: string | null;
  isPublishable: boolean;
};

export type PlanMetricItemLink = {
  id: string;
  metricDefinitionId: string;
  surveyItemId: string | null;
  studyDomainId: string | null;
  performanceDimensionId: string | null;
  role: string;
  displayOrder: number;
};

export type PlanJourneyModel = {
  id: string;
  key: string;
  label: string;
  audience: string;
  description: string;
  displayOrder: number;
};

export type PlanJourneyStage = {
  id: string;
  journeyModelId: string;
  key: string;
  label: string;
  stageOrder: number;
  description: string;
  visualAnnotationId: string | null;
};

export type PlanJourneyStageEvidenceLink = {
  id: string;
  journeyStageId: string;
  metricDefinitionId: string | null;
  surveyItemId: string | null;
  performanceDimensionId: string | null;
  role: "primary" | "supporting" | "context";
  displayOrder: number;
};

export type PlanOrganizationalUnit = {
  id: string;
  key: string;
  label: string;
  displayOrder: number;
  visualAnnotationId: string | null;
};

export type PlanCultureDimension = {
  id: string;
  key: string;
  label: string;
  audience: "edl" | "members";
  displayOrder: number;
  visualAnnotationId: string | null;
};

export type PlanPainPoint = {
  id: string;
  rawText: string;
  normalizedText: string;
  /** Always `pending`: an imported finding has been read by nobody. */
  reviewStatus: "pending";
  sourceVisualAnnotationId: string | null;
};

export type PlanPainPointRelation = {
  id: string;
  painPointId: string;
  displayOrder: number;
};

export type PlanPainPointJourneyStage = PlanPainPointRelation & { journeyStageId: string };
export type PlanPainPointOrganizationalUnit = PlanPainPointRelation & { organizationalUnitId: string };
export type PlanPainPointPerformanceDimension = PlanPainPointRelation & { performanceDimensionId: string };
export type PlanPainPointCultureDimension = PlanPainPointRelation & { cultureDimensionId: string };

/**
 * One persisted fact, traced to the cell that produced it.
 *
 * `sourceAssetRole` rather than an asset uuid: the payload names a ROLE and the
 * database resolves it through this job's own `import_job_asset` links, so a
 * payload can never cite a file the job does not carry.
 *
 * `sourceRawValue` is populated only where the target row does not already
 * store the raw text itself. Repeating it on every response would double the
 * payload for no extra provenance.
 */
export type PlanSourceLineage = {
  sourceAssetRole: string;
  /** The worksheet name EXACTLY as the source spells it, trailing space included. */
  sheetName: string;
  cellOrRange: string;
  sourceRow: number | null;
  sourceColumn: string | null;
  targetTable: string;
  targetRecordId: string;
  targetField: string;
  transformationKey: string;
  sourceRawValue: string | null;
};

/** Declared counts, one per family. The database measures its own and compares. */
export type PlanExpectedCounts = Record<PlanFamily, number>;

export type CanonicalCommitPlan = {
  specId: string;
  mappingVersion: number;
  tenantId: string;
  studyId: string;
  /** The Unit 2 package key: mapping version, roles and file hashes sorted by role. */
  packageIdempotencyKey: string;
  /** sha256 over the canonical serialisation of everything below. */
  planFingerprint: string;
  expectedCounts: PlanExpectedCounts;

  persons: PlanPerson[];
  personIdentifiers: PlanPersonIdentifier[];
  participants: PlanParticipant[];
  membershipEpisodes: PlanMembershipEpisode[];
  attributeDefinitions: PlanAttributeDefinition[];
  participantAttributeValues: PlanParticipantAttributeValue[];
  responseScales: PlanResponseScale[];
  responseOptions: PlanResponseOption[];
  surveyInstruments: PlanSurveyInstrument[];
  studyDomains: PlanStudyDomain[];
  surveyItems: PlanSurveyItem[];
  surveySessions: PlanSurveySession[];
  surveyResponses: PlanSurveyResponse[];
  visualAnnotations: PlanVisualAnnotation[];
  performanceDimensions: PlanPerformanceDimension[];
  performanceObservations: PlanPerformanceObservation[];
  bandSchemes: PlanBandScheme[];
  bandRules: PlanBandRule[];
  retentionPeriods: PlanRetentionPeriod[];
  metricDefinitions: PlanMetricDefinition[];
  metricItemLinks: PlanMetricItemLink[];
  journeyModels: PlanJourneyModel[];
  journeyStages: PlanJourneyStage[];
  journeyStageEvidenceLinks: PlanJourneyStageEvidenceLink[];
  organizationalUnits: PlanOrganizationalUnit[];
  cultureDimensions: PlanCultureDimension[];
  painPoints: PlanPainPoint[];
  painPointJourneyStages: PlanPainPointJourneyStage[];
  painPointOrganizationalUnits: PlanPainPointOrganizationalUnit[];
  painPointPerformanceDimensions: PlanPainPointPerformanceDimension[];
  painPointCultureDimensions: PlanPainPointCultureDimension[];
  sourceLineage: PlanSourceLineage[];
};

/**
 * A problem found while PROJECTING, before anything is staged.
 *
 * It is privacy-safe by construction and uses exactly the vocabulary of a
 * preflight finding, so a projection blocker can be shown on the same screen
 * as a preflight blocker without a second redaction rule.
 */
export type PlanIssue = {
  code: string;
  severity: "blocker" | "warning";
  assetRole: string | null;
  sheet: string | null;
  coordinate: string | null;
  message: string;
  expected: number | string | null;
  actual: number | string | null;
};

export type CommitPlanBuild =
  | { ok: true; plan: CanonicalCommitPlan; issues: PlanIssue[] }
  | { ok: false; plan: null; issues: PlanIssue[] };
