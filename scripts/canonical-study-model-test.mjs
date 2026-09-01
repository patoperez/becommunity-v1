// =============================================================================
// Canonical study model — offline structural gate.
//
// This checks the migration contract without requiring a database. PostgreSQL
// execution remains a separate staging gate before either migration is applied.
// =============================================================================

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const read = (path) => readFileSync(root + path, "utf8");
const foundation = read("supabase/migrations/0022_canonical_ingestion_foundation.sql");
const analysis = read("supabase/migrations/0023_canonical_analysis_model.sql");
const foundationRollback = read("supabase/rollbacks/0022_drop_canonical_ingestion_foundation.sql");
const analysisRollback = read("supabase/rollbacks/0023_drop_canonical_analysis_model.sql");

const foundationTables = [
  "source_asset", "import_job", "import_job_asset", "visual_annotation",
  "person_private", "person_external_identifier", "study_participant",
  "membership_episode", "attribute_definition", "participant_attribute_value",
  "response_scale", "response_option", "survey_instrument", "study_domain",
  "survey_item", "survey_session", "survey_response", "source_lineage",
];
const analysisTables = [
  "performance_dimension", "performance_observation", "band_scheme", "band_rule",
  "metric_definition", "metric_item_link", "journey_model", "journey_stage",
  "journey_stage_evidence_link", "organizational_unit", "culture_dimension",
  "pain_point", "pain_point_journey_stage", "pain_point_organizational_unit",
  "pain_point_performance_dimension", "pain_point_culture_dimension",
];

let failures = 0;
const pass = (message) => console.log("  ✓", message);
const fail = (message) => {
  console.error("  ✗ FAIL:", message);
  failures += 1;
};
const check = (condition, message) => (condition ? pass(message) : fail(message));
const escaped = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const createdTables = (sql) => [...sql.matchAll(/create table public\.([a-z0-9_]+)\s*\(/gi)].map((m) => m[1]);
const droppedTables = (sql) => [...sql.matchAll(/drop table public\.([a-z0-9_]+)\s*;/gi)].map((m) => m[1]);
const sameMembers = (actual, expected) =>
  actual.length === expected.length && expected.every((name) => actual.includes(name));

console.log("Be Community — canonical study model gate");

console.log("\n[1] The migrations create only the declared additive model");
check(sameMembers(createdTables(foundation), foundationTables), "0022 creates the 18 declared ingestion tables");
check(sameMembers(createdTables(analysis), analysisTables), "0023 creates the 16 declared analysis tables");
check(!/\b(update|delete\s+from|truncate)\b/i.test(foundation + analysis), "neither migration rewrites existing rows");
check(!/\bdrop\s+table\b/i.test(foundation + analysis), "neither forward migration drops a table");
check(
  /create unique index respondent_id_tenant_study_uidx[\s\S]*?\(id, tenant_id, study_id\)/i.test(foundation),
  "the legacy respondent bridge is scoped to tenant and study",
);

console.log("\n[2] Every new table is internal-only and FORCE-RLS protected");
for (const [name, sql, tables] of [
  ["0022", foundation, foundationTables],
  ["0023", analysis, analysisTables],
]) {
  for (const table of tables) {
    check(new RegExp(`['\"]${escaped(table)}['\"]`).test(sql), `${name} registers ${table} in its security loop`);
  }
  check(/enable row level security/i.test(sql), `${name} enables RLS`);
  check(/force row level security/i.test(sql), `${name} forces RLS`);
  check(/for all to anon, authenticated using \(false\) with check \(false\)/i.test(sql), `${name} denies browser roles`);
  check(/revoke all privileges on table public\.%I from anon, authenticated/i.test(sql), `${name} revokes browser table privileges`);
  check(/grant all privileges on table public\.%I to service_role/i.test(sql), `${name} grants the service role`);
}

console.log("\n[3] Semantics remain typed instead of collapsing missing data into zero");
for (const status of ["answered", "missing", "unknown", "not_applicable", "source_unavailable", "not_participated"]) {
  check(foundation.includes(`'${status}'`), `foundation preserves the ${status} state`);
}
check(
  /status = 'answered' and num_nonnulls\(value_text, value_numeric, value_date, value_boolean\) = 1/i.test(foundation),
  "participant attributes require exactly one typed value when answered",
);
check(
  /status = 'answered' and num_nonnulls\(response_option_id, value_numeric, value_text, value_date, value_boolean\) = 1/i.test(foundation),
  "survey responses require exactly one typed value when answered",
);
check(
  /status = 'answered' and value is not null/i.test(analysis),
  "performance observations cannot manufacture a numeric zero for unavailable source data",
);

console.log("\n[4] Findings and evidence use real foreign keys");
check(!/\btarget_type\b/i.test(analysis), "analysis relationships do not use a polymorphic target_type");
for (const table of ["journey_stage", "organizational_unit", "performance_dimension", "culture_dimension"]) {
  check(new RegExp(`references public\\.${escaped(table)} \\(id, tenant_id, study_id\\)`, "i").test(analysis), `pain/evidence links reference ${table}`);
}
check(/superseded_by_id is null or superseded_by_id <> id/i.test(analysis), "a pain point cannot merge into itself");
check(/num_nonnulls\(metric_definition_id, survey_item_id, performance_dimension_id\) = 1/i.test(analysis), "journey evidence has exactly one source");

console.log("\n[5] Both migrations have complete reverse scripts");
check(sameMembers(droppedTables(foundationRollback), foundationTables), "0022 rollback drops all 18 foundation tables");
check(sameMembers(droppedTables(analysisRollback), analysisTables), "0023 rollback drops all 16 analysis tables");
check(/drop index public\.respondent_id_tenant_study_uidx/i.test(foundationRollback), "0022 rollback removes its compatibility index");
for (const column of ["series_key", "period_starts_on", "period_ends_on"]) {
  check(new RegExp(`drop column ${column}`, "i").test(analysisRollback), `0023 rollback removes study_period_snapshot.${column}`);
}
check(/add constraint source_lineage_target_table_check/i.test(analysisRollback), "0023 rollback restores the 0022 lineage vocabulary");

console.log("\n" + "=".repeat(70));
if (failures > 0) {
  console.error(`RESULT: ${failures} failure(s). GATE BLOCKED.`);
  process.exit(1);
}
console.log("RESULT: the canonical study model contract is internally consistent. GATE PASSED.");
