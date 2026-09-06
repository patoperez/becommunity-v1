/**
 * THE CANONICAL ROWS, EXACTLY AS THE TABLES SPELL THEM.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * These types are the SHAPE OF THE DATABASE, not the shape of the read model.
 * They are `snake_case` because the columns are, and they carry only the
 * columns the read model actually needs — a column absent from a type here is
 * a column no `select` in this folder ever asks for, which is the cheapest and
 * most durable way to keep a name, an email or an external identifier out of
 * the process altogether.
 *
 * FOUR TABLES ARE DELIBERATELY ABSENT AND MUST STAY ABSENT:
 *
 *   `person_private`             — the name.
 *   `person_external_identifier` — the membership id.
 *   `source_lineage`             — the raw cell text, for every fact.
 *   `pain_point.raw_text`        — the consultant's prose.
 *
 * The read model has nowhere to put any of them (see `results/source.ts`), so
 * a `select` that fetched them would be reading real client data for no
 * purpose. `pain_point` IS read, for its review status and its links; its two
 * text columns are not in `PainPointRow` and are never requested.
 *
 * `study_id` and `tenant_id` are absent from every row type for the same
 * reason in reverse: every read in `read.ts` is scoped by both, so carrying
 * them back would be carrying back the question rather than the answer.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import type { SourceValueStatus } from "../ingestion/canonical-package/values";

/** A column list, and the key columns a page is ordered by. */
export type CanonicalTableRead = {
  /** The table, exactly as `public` spells it. */
  table: string;
  /** The columns to select, in the order they are written into the request. */
  columns: readonly string[];
  /**
   * The keyset. One column for a `uuid` primary key, two for a composite one.
   * Every column here must be a `uuid`, because `read.ts` refuses a cursor
   * value that is not one and a non-uuid key would make every page refuse.
   */
  keyColumns: readonly string[];
  /** Reading more than this many rows is a refusal, never a truncation. */
  maxRows: number;
};

export type ImportJobRow = {
  id: string;
  idempotency_key: string;
  mapping_version: number;
  status: string;
  committed_at: string | null;
};

export type StudyParticipantRow = {
  id: string;
  cohort_key: string;
  participation_status: "included" | "excluded" | "withdrawn";
  survey_participation_status: "responded" | "not_participated" | "unknown";
  source_status: SourceValueStatus;
};

export type AttributeDefinitionRow = {
  id: string;
  key: string;
  label: string;
  data_type: "text" | "category" | "number" | "date" | "boolean";
  sensitivity: "private" | "internal" | "client_eligible";
  filterable: boolean;
  display_order: number;
};

export type ParticipantAttributeValueRow = {
  id: string;
  participant_id: string;
  attribute_definition_id: string;
  status: SourceValueStatus;
  value_text: string | null;
  value_numeric: number | string | null;
};

export type ResponseScaleRow = {
  id: string;
  key: string;
};

export type ResponseOptionRow = {
  id: string;
  response_scale_id: string;
  raw_value: string;
  numeric_value: number | string | null;
  derived_label: string | null;
  display_order: number;
};

export type SurveyInstrumentRow = {
  id: string;
  key: string;
  label: string;
  audience: string;
  instrument_type: "profile" | "survey" | "index" | "exit" | "other";
};

export type StudyDomainRow = {
  id: string;
  survey_instrument_id: string;
  key: string;
  label: string;
  display_order: number;
  visual_annotation_id: string | null;
};

export type SurveyItemRow = {
  id: string;
  survey_instrument_id: string;
  study_domain_id: string | null;
  response_scale_id: string | null;
  key: string;
  label: string;
  item_order: number;
};

export type SurveySessionRow = {
  id: string;
  survey_instrument_id: string;
  participant_id: string;
  status: SourceValueStatus;
};

export type SurveyResponseRow = {
  id: string;
  survey_session_id: string;
  survey_item_id: string;
  response_option_id: string | null;
  status: SourceValueStatus;
  value_numeric: number | string | null;
  value_text: string | null;
  source_derived_label: string | null;
};

export type RetentionPeriodRow = {
  id: string;
  series_key: string;
  period_order: number;
  period_label: string;
  period_starts_on: string | null;
  period_ends_on: string | null;
  starting_status: SourceValueStatus;
  starting_count: number | null;
  new_status: SourceValueStatus;
  new_count: number | null;
  ending_status: SourceValueStatus;
  ending_count: number | null;
  lost_status: SourceValueStatus;
  lost_count: number | null;
  identity_verified: boolean;
};

export type PerformanceDimensionRow = {
  id: string;
  key: string;
  label: string;
  display_order: number;
};

export type PerformanceObservationRow = {
  id: string;
  participant_id: string;
  performance_dimension_id: string;
  period_start: string;
  period_label: string;
  status: SourceValueStatus;
  value: number | string | null;
};

export type BandSchemeRow = {
  id: string;
  key: string;
  label: string;
  unit: "score" | "percent" | "count" | "currency" | "ratio" | "years";
  description: string;
};

export type BandRuleRow = {
  id: string;
  band_scheme_id: string;
  lower_bound: number | string | null;
  upper_bound: number | string | null;
  lower_inclusive: boolean;
  upper_inclusive: boolean;
  label: string;
  semantic_color: "gray" | "red" | "yellow" | "green" | "safe" | "alert" | "danger" | "neutral";
  display_order: number;
};

export type MetricDefinitionRow = {
  id: string;
  key: string;
  label: string;
  family: "nps" | "csat" | "tdp" | "cri" | "retention" | "churn" | "mean" | "count";
  unit: "score" | "percent" | "count" | "currency" | "ratio" | "years";
  precision: number;
  calculation_version: string;
  band_scheme_id: string | null;
};

export type JourneyModelRow = {
  id: string;
  key: string;
  label: string;
  audience: string;
  display_order: number;
};

export type JourneyStageRow = {
  id: string;
  journey_model_id: string;
  key: string;
  label: string;
  stage_order: number;
};

export type JourneyStageEvidenceLinkRow = {
  id: string;
  journey_stage_id: string;
  metric_definition_id: string | null;
  survey_item_id: string | null;
  performance_dimension_id: string | null;
  role: "primary" | "supporting" | "context";
  display_order: number;
};

export type OrganizationalUnitRow = {
  id: string;
  key: string;
  label: string;
  display_order: number;
};

export type CultureDimensionRow = {
  id: string;
  key: string;
  label: string;
  audience: "edl" | "members";
  display_order: number;
};

/** No `raw_text`, no `normalized_text`. The prose never leaves the database. */
export type PainPointRow = {
  id: string;
  review_status: "pending" | "confirmed" | "rejected" | "merged";
  created_at: string;
};

export type PainPointJourneyStageRow = {
  pain_point_id: string;
  journey_stage_id: string;
  display_order: number;
};

export type PainPointOrganizationalUnitRow = {
  pain_point_id: string;
  organizational_unit_id: string;
  display_order: number;
};

export type PainPointPerformanceDimensionRow = {
  pain_point_id: string;
  performance_dimension_id: string;
  display_order: number;
};

export type PainPointCultureDimensionRow = {
  pain_point_id: string;
  culture_dimension_id: string;
  display_order: number;
};

/** Everything one committed package's canonical rows amount to. */
export type CanonicalRowSet = {
  importJob: ImportJobRow;
  planFingerprint: string;
  specId: string;
  participants: StudyParticipantRow[];
  attributeDefinitions: AttributeDefinitionRow[];
  attributeValues: ParticipantAttributeValueRow[];
  responseScales: ResponseScaleRow[];
  responseOptions: ResponseOptionRow[];
  instruments: SurveyInstrumentRow[];
  domains: StudyDomainRow[];
  items: SurveyItemRow[];
  sessions: SurveySessionRow[];
  responses: SurveyResponseRow[];
  retentionPeriods: RetentionPeriodRow[];
  performanceDimensions: PerformanceDimensionRow[];
  performanceObservations: PerformanceObservationRow[];
  bandSchemes: BandSchemeRow[];
  bandRules: BandRuleRow[];
  metricDefinitions: MetricDefinitionRow[];
  journeyModels: JourneyModelRow[];
  journeyStages: JourneyStageRow[];
  journeyStageEvidenceLinks: JourneyStageEvidenceLinkRow[];
  organizationalUnits: OrganizationalUnitRow[];
  cultureDimensions: CultureDimensionRow[];
  painPoints: PainPointRow[];
  painPointJourneyStages: PainPointJourneyStageRow[];
  painPointOrganizationalUnits: PainPointOrganizationalUnitRow[];
  painPointPerformanceDimensions: PainPointPerformanceDimensionRow[];
  painPointCultureDimensions: PainPointCultureDimensionRow[];
};
