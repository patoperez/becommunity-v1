// =============================================================================
// The canonical tables, and which plan family writes each of them
// =============================================================================
// One map, in one place, so the operator's reconciliation and the parity gate
// cannot drift apart or drift from migration 0028's own vocabulary.
//
// `scope` says how a table is addressed:
//
//   "study"   the table carries `tenant_id` AND `study_id`, so its rows can be
//             counted for exactly this study. Thirty of the thirty-two.
//   "tenant"  `person_private` and `person_external_identifier` carry only
//             `tenant_id`. A person is SHARED between studies on purpose —
//             reusing an identity across imports is the whole reason the
//             ownership ledger exists — so counting them "for this study" is a
//             question with no answer. They are reconciled through the ledger
//             (`_personsCreated`/`_personsReused`) instead, which is the only
//             place that distinguishes what this package made from what it
//             found.
//
// `ledger` says whether the ownership ledger names the table. `source_lineage`
// is the one family it does not: lineage is deleted by the cascade from
// `import_job`, not by the rollback's own DELETEs, and leaving it out of the
// ledger vocabulary is what makes that a structural fact instead of a habit.
// =============================================================================

export const CANONICAL_FAMILY_TABLES = Object.freeze([
  { family: "persons", table: "person_private", scope: "tenant", ledger: true },
  { family: "personIdentifiers", table: "person_external_identifier", scope: "tenant", ledger: true },
  { family: "participants", table: "study_participant", scope: "study", ledger: true },
  { family: "membershipEpisodes", table: "membership_episode", scope: "study", ledger: true },
  { family: "attributeDefinitions", table: "attribute_definition", scope: "study", ledger: true },
  { family: "participantAttributeValues", table: "participant_attribute_value", scope: "study", ledger: true },
  { family: "responseScales", table: "response_scale", scope: "study", ledger: true },
  { family: "responseOptions", table: "response_option", scope: "study", ledger: true },
  { family: "surveyInstruments", table: "survey_instrument", scope: "study", ledger: true },
  { family: "studyDomains", table: "study_domain", scope: "study", ledger: true },
  { family: "surveyItems", table: "survey_item", scope: "study", ledger: true },
  { family: "surveySessions", table: "survey_session", scope: "study", ledger: true },
  { family: "surveyResponses", table: "survey_response", scope: "study", ledger: true },
  { family: "visualAnnotations", table: "visual_annotation", scope: "study", ledger: true },
  { family: "performanceDimensions", table: "performance_dimension", scope: "study", ledger: true },
  { family: "performanceObservations", table: "performance_observation", scope: "study", ledger: true },
  { family: "bandSchemes", table: "band_scheme", scope: "study", ledger: true },
  { family: "bandRules", table: "band_rule", scope: "study", ledger: true },
  { family: "retentionPeriods", table: "retention_period", scope: "study", ledger: true },
  { family: "metricDefinitions", table: "metric_definition", scope: "study", ledger: true },
  { family: "metricItemLinks", table: "metric_item_link", scope: "study", ledger: true },
  { family: "journeyModels", table: "journey_model", scope: "study", ledger: true },
  { family: "journeyStages", table: "journey_stage", scope: "study", ledger: true },
  { family: "journeyStageEvidenceLinks", table: "journey_stage_evidence_link", scope: "study", ledger: true },
  { family: "organizationalUnits", table: "organizational_unit", scope: "study", ledger: true },
  { family: "cultureDimensions", table: "culture_dimension", scope: "study", ledger: true },
  { family: "painPoints", table: "pain_point", scope: "study", ledger: true },
  { family: "painPointJourneyStages", table: "pain_point_journey_stage", scope: "study", ledger: true },
  { family: "painPointOrganizationalUnits", table: "pain_point_organizational_unit", scope: "study", ledger: true },
  { family: "painPointPerformanceDimensions", table: "pain_point_performance_dimension", scope: "study", ledger: true },
  { family: "painPointCultureDimensions", table: "pain_point_culture_dimension", scope: "study", ledger: true },
  { family: "sourceLineage", table: "source_lineage", scope: "study", ledger: false },
]);

/** The thirty study-scoped canonical tables a per-study count can address. */
export const STUDY_SCOPED_CANONICAL_TABLES = Object.freeze(
  CANONICAL_FAMILY_TABLES.filter((entry) => entry.scope === "study").map((entry) => entry.table),
);

/** The four provenance tables a rollback must LEAVE BEHIND, and the job itself. */
export const PROVENANCE_TABLES = Object.freeze(["source_asset", "import_job", "import_job_asset"]);

export const FAMILY_BY_TABLE = Object.freeze(
  Object.fromEntries(CANONICAL_FAMILY_TABLES.map((entry) => [entry.table, entry.family])),
);

export const TABLE_BY_FAMILY = Object.freeze(
  Object.fromEntries(CANONICAL_FAMILY_TABLES.map((entry) => [entry.family, entry.table])),
);
