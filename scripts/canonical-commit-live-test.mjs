// =============================================================================
// MANDATORY canonical commit and rollback gate — DATABASE-EXECUTED
//   CANONICAL_COMMIT_TEST_PGHOST=/path/to/socket \
//   CANONICAL_COMMIT_TEST_PGUSER=<user> \
//     npx tsx scripts/canonical-commit-live-test.mjs
// =============================================================================
// This gate EXECUTES migration 0024 against a real PostgreSQL server and asserts
// the resulting database state. Nothing here is satisfied by reading SQL text:
// every claim is a query or a mutation against a disposable database that this
// script creates and destroys.
//
// It is deliberately OUTSIDE `npm test`, because a database is not always
// available and an unexecuted database test must never be counted among the
// offline results.
//
// WHERE IT MAY RUN. Only against a database it created itself, on a loopback
// address or a unix socket, whose name matches
// `becommunity_canonical_test_<suffix>`. `scripts/lib/disposable-postgres.mjs`
// owns those rules; the OFFLINE gate executes them too, so a weakened guard
// fails `npm test` rather than waiting for a run nobody makes. The gate refuses
// outright if the shell carries a configured Supabase project, and it reads no
// `.env` file of any kind.
//
// WHAT IT NEVER PRINTS. A credential, a respondent value, a workbook cell, a
// plan fragment, or the text of a PostgreSQL error. A database message quotes
// the values that violated the constraint, so failures are reported by SQLSTATE
// and by the safe code the migration raised.
//
// The synthetic package comes from `scripts/lib/canonical-fixtures.mjs`, the
// same fixtures the offline gate uses. The real Cuicuilco workbooks are read
// only when their paths are supplied, only to measure the serialization
// boundary, and every byte of that run is deleted with the database.
// =============================================================================

import { spawn } from "node:child_process";
import { readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

import {
  DisposableTargetError,
  resolveDisposableTarget,
  withDisposableDatabase,
} from "./lib/disposable-postgres.mjs";
import { buildSyntheticPackage } from "./lib/canonical-fixtures.mjs";
import { runCanonicalCommit, runCanonicalRollback } from "../src/lib/ingestion/canonical-commit/flow.ts";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const MIGRATIONS = join(ROOT, "supabase", "migrations");
const ROLLBACKS = join(ROOT, "supabase", "rollbacks");
const LIB = join(ROOT, "scripts", "lib");

let failures = 0;
const results = [];
const ok = (id, message) => {
  console.log(`  ✓ ${id}  ${message}`);
  results.push({ id, ok: true, message });
};
const bad = (id, message) => {
  console.error(`  ✗ ${id}  FAIL: ${message}`);
  results.push({ id, ok: false, message });
  failures += 1;
};
const check = (id, condition, message) => (condition ? ok(id, message) : bad(id, message));

// ---------------------------------------------------------------------------
// Target resolution — refuse before anything else happens
// ---------------------------------------------------------------------------
let target;
try {
  target = resolveDisposableTarget(process.env);
} catch (thrown) {
  if (thrown instanceof DisposableTargetError) {
    console.error(`REFUSED: ${thrown.message}`);
    console.error(
      "\nThis gate runs only against a disposable local PostgreSQL server.\n" +
        "Provide CANONICAL_COMMIT_TEST_PGHOST (a loopback host or a unix socket\n" +
        "directory) and CANONICAL_COMMIT_TEST_PGUSER, or an equivalent\n" +
        "CANONICAL_COMMIT_TEST_DATABASE_URL without a password.",
    );
    process.exit(2);
  }
  throw thrown;
}

console.log("Be Community — canonical commit and rollback gate (DATABASE-EXECUTED)");
console.log("=".repeat(78));
console.log(
  `  server: ${target.isSocket ? "unix socket" : "loopback"}  user: ${target.user}  ` +
    `admin db: ${target.adminDatabase}`,
);

// ---------------------------------------------------------------------------
// Fixtures and constants
// ---------------------------------------------------------------------------
const { cleanBytes, painBytes } = await buildSyntheticPackage();
const cleanFile = { fileName: "limpios.xlsx", bytes: cleanBytes };
const painFile = { fileName: "curado.xlsx", bytes: painBytes };
const SENTINEL_PATTERN = /Z(?:NOMBRE|ID|TEXTO|CATEG)PRIV\d{3}/;

/** Plan family -> the table that family lands in. `sourceLineage` is job-scoped. */
const FAMILY_TABLE = {
  persons: "person_private",
  personIdentifiers: "person_external_identifier",
  participants: "study_participant",
  membershipEpisodes: "membership_episode",
  attributeDefinitions: "attribute_definition",
  participantAttributeValues: "participant_attribute_value",
  responseScales: "response_scale",
  responseOptions: "response_option",
  surveyInstruments: "survey_instrument",
  studyDomains: "study_domain",
  surveyItems: "survey_item",
  surveySessions: "survey_session",
  surveyResponses: "survey_response",
  visualAnnotations: "visual_annotation",
  performanceDimensions: "performance_dimension",
  performanceObservations: "performance_observation",
  bandSchemes: "band_scheme",
  bandRules: "band_rule",
  retentionPeriods: "retention_period",
  metricDefinitions: "metric_definition",
  metricItemLinks: "metric_item_link",
  journeyModels: "journey_model",
  journeyStages: "journey_stage",
  journeyStageEvidenceLinks: "journey_stage_evidence_link",
  organizationalUnits: "organizational_unit",
  cultureDimensions: "culture_dimension",
  painPoints: "pain_point",
  painPointJourneyStages: "pain_point_journey_stage",
  painPointOrganizationalUnits: "pain_point_organizational_unit",
  painPointPerformanceDimensions: "pain_point_performance_dimension",
  painPointCultureDimensions: "pain_point_culture_dimension",
};

/** The signature of every function the transport may call. */
const RPC_CALLS = {
  stage_canonical_package: (a) =>
    `public.stage_canonical_package((${a}.j->>'p_tenant_id')::uuid, (${a}.j->>'p_study_id')::uuid, ${a}.j->'p_request')`,
  commit_canonical_package: (a) =>
    `public.commit_canonical_package((${a}.j->>'p_import_job_id')::uuid, ${a}.j->'p_plan')`,
  rollback_canonical_package: (a) =>
    `public.rollback_canonical_package((${a}.j->>'p_import_job_id')::uuid, nullif(${a}.j->>'p_actor', '')::uuid)`,
};

let rpcSequence = 0;

/**
 * The transport the product's own workflow talks through.
 *
 * The payload is written to a private file and read back by the server with
 * `pg_read_file`, so the exact bytes `JSON.stringify` produced are what
 * PostgreSQL parses — no shell quoting, no truncation, no re-encoding. The call
 * itself is made after `set role service_role`, so every RPC in this gate runs
 * with the privileges the product actually uses, not the superuser's.
 */
function psqlTransport(db, journal) {
  return {
    rpc: async (name, args) => {
      const build = RPC_CALLS[name];
      if (!build) return { data: null, error: { message: "UNKNOWN_FUNCTION" } };
      const file = db.writePayload(`rpc-${name}-${rpcSequence++}`, args);
      const bytes = statSync(file).size;
      const sql =
        "create temp table _rpc_arg(j jsonb);\n" +
        `insert into _rpc_arg select pg_read_file($payload$${file}$payload$)::jsonb;\n` +
        "grant select on _rpc_arg to service_role;\n" +
        "set role service_role;\n" +
        `select coalesce(${build("a")}::text, 'null') from _rpc_arg a;\n` +
        "reset role;\n";
      const started = process.hrtime.bigint();
      try {
        const data = db.json(sql);
        journal?.push({ name, bytes, ms: Number(process.hrtime.bigint() - started) / 1e6, ok: true });
        return { data, error: null };
      } catch (thrown) {
        journal?.push({
          name,
          bytes,
          ms: Number(process.hrtime.bigint() - started) / 1e6,
          ok: false,
          sqlstate: thrown.sqlstate,
        });
        // The raw message is handed to the code under test, exactly as
        // supabase-js would hand it over. It is never logged from here.
        return { data: null, error: { message: thrown.databaseMessage ?? "" } };
      } finally {
        rmSync(file, { force: true });
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Database preparation
// ---------------------------------------------------------------------------
/** Every tracked migration, in the order its number gives it. */
const MIGRATION_FILES = readdirSync(MIGRATIONS)
  .filter((name) => /^\d{4}_.*\.sql$/.test(name))
  .sort();

function migrationPath(prefix) {
  const file = MIGRATION_FILES.find((name) => name.startsWith(`${prefix}_`));
  if (!file) throw new Error(`no migration file for ${prefix}`);
  return join(MIGRATIONS, file);
}

/**
 * Bootstrap, then migrations 0000..upTo in their REAL order.
 *
 * The migrations are applied verbatim. Nothing is rewritten to make them apply,
 * because a migration edited for the test would prove the edit, not the
 * migration.
 */
function prepare(db, upTo = 24) {
  db.applyFile(join(LIB, "disposable-bootstrap.sql"));
  for (const name of MIGRATION_FILES) {
    const number = Number(name.slice(0, 4));
    if (number > upTo) break;
    db.applyFile(join(MIGRATIONS, name));
  }
}

const SNAPSHOT_SQL = readFileSync(join(LIB, "catalogue-snapshot.sql"), "utf8");
const snapshot = (db) => JSON.parse(db.run(SNAPSHOT_SQL).trim());

/** A tenant and a study, created the way the product's server would. */
function seedStudy(db, label) {
  return db.json(
    `set role service_role;
     with t as (
       insert into public.tenant (name) values ('${label} tenant') returning id
     ), s as (
       insert into public.study (tenant_id, name) select id, '${label} study' from t returning id, tenant_id
     )
     select json_build_object('tenant', s.tenant_id::text, 'studyId', s.id::text)::text from s;`,
  );
}

const countOf = (db, table, extra = "") =>
  Number(db.run(`select count(*) from public.${table}${extra ? ` where ${extra}` : ""};`).trim());

const jobRow = (db, id) =>
  db.json(
    `select row_to_json(x)::text from (
       select status, commit_attempts, rollback_count, last_error_code,
              committed_at is not null as has_committed_at,
              rolled_back_at is not null as has_rolled_back_at,
              payload_digest is not null as has_digest,
              actual_counts, error_report
       from public.import_job where id = '${id}'
     ) x;`,
  );

const safeOutcome = (outcome) => {
  const text = JSON.stringify(outcome);
  return {
    clean: !SENTINEL_PATTERN.test(text) && !/duplicate key value|violates|ERROR:|CONTEXT:/.test(text),
    text,
  };
};

// ---------------------------------------------------------------------------
// The gate
// ---------------------------------------------------------------------------
const timings = [];

async function commitPackage(db, scope, files = [cleanFile, painFile]) {
  const journal = [];
  const outcome = await runCanonicalCommit(psqlTransport(db, journal), {
    tenantId: scope.tenant,
    studyId: scope.studyId,
    files,
  });
  return { outcome, journal };
}

async function main() {
  try {
    await withDisposableDatabase(target, "core", coreSuite);
    await withDisposableDatabase(target, "sharing", sharingSuite);
    await withDisposableDatabase(target, "security", securitySuite);
    await withDisposableDatabase(target, "catalogue", catalogueSuite);
    await withDisposableDatabase(target, "realpkg", realPackageSuite);
  } catch (thrown) {
    bad("HARNESS", `the harness itself failed: ${thrown.message}`);
  }

  console.log("\n" + "=".repeat(78));
  const passed = results.filter((r) => r.ok).length;
  console.log(`Executed ${results.length} database assertions: ${passed} passed, ${failures} failed.`);
  if (timings.length > 0) {
    console.log("\nMeasured, without any content:");
    for (const line of timings) console.log(`  ${line}`);
  }
  if (failures > 0) {
    console.error("RESULT: the database contradicts the contract. GATE BLOCKED.");
    process.exit(1);
  }
  console.log("RESULT: migration 0024 behaves as documented against a real PostgreSQL. GATE PASSED.");
}

// ---- L1-L5, L7-L8, L10-L13 and the count/ledger cases ---------------------
async function coreSuite(db) {
  console.log("\n[core] first commit, replay, failure, retry, rollback");
  prepare(db);
  const scope = seedStudy(db, "core");

  // ---- L1: the first commit writes the complete package --------------------
  const first = await commitPackage(db, scope);
  check("L1.1", first.outcome.ok === true, `the first commit succeeds (${first.outcome.ok ? "ok" : first.outcome.code})`);
  if (!first.outcome.ok) return;
  const jobId = first.outcome.importJobId;
  const job = jobRow(db, jobId);
  check("L1.2", job.status === "committed", `import_job is 'committed' (${job.status})`);
  check("L1.3", job.has_committed_at && job.has_digest, "committed_at and payload_digest are recorded");
  check("L1.4", job.commit_attempts === 1, `commit_attempts is 1 (${job.commit_attempts})`);

  let familyMismatch = [];
  for (const [family, table] of Object.entries(FAMILY_TABLE)) {
    const declared = Number(job.actual_counts[family]);
    const rows = countOf(db, table);
    const expected = family === "persons" || family === "personIdentifiers" ? declared : declared;
    if (rows !== expected) familyMismatch.push(`${family}:${rows}!=${expected}`);
  }
  check("L1.5", familyMismatch.length === 0, `every family's rows match its measured count${familyMismatch.length ? ` (${familyMismatch.slice(0, 3).join(", ")})` : ""}`);
  const lineage = countOf(db, "source_lineage", `import_job_id = '${jobId}'`);
  check("L1.6", lineage === Number(job.actual_counts.sourceLineage), `source_lineage rows match (${lineage})`);

  // EXTRA: ledger consistency, family by family.
  const ledgerMismatch = [];
  for (const [family, table] of Object.entries(FAMILY_TABLE)) {
    const created = Number(
      db.run(
        `select count(*) from public.import_job_record where import_job_id = '${jobId}' and target_table = '${table}' and ownership = 'created';`,
      ).trim(),
    );
    const reused = Number(
      db.run(
        `select count(*) from public.import_job_record where import_job_id = '${jobId}' and target_table = '${table}' and ownership = 'reused';`,
      ).trim(),
    );
    if (created + reused !== Number(job.actual_counts[family])) {
      ledgerMismatch.push(`${family}:${created}+${reused}!=${job.actual_counts[family]}`);
    }
  }
  check(
    "X1",
    ledgerMismatch.length === 0,
    `every declared family is represented in the ledger${ledgerMismatch.length ? ` (${ledgerMismatch.slice(0, 3).join(", ")})` : ""}`,
  );

  const totalOwned = countOf(db, "import_job_record", `import_job_id = '${jobId}'`);
  timings.push(
    `L1 wrote ${Object.values(FAMILY_TABLE).reduce((n, t) => n + countOf(db, t), 0)} canonical rows, ` +
      `${lineage} lineage rows, ${totalOwned} ledger rows`,
  );

  // ---- L2: an exact replay is idempotent -----------------------------------
  const before = snapshotRowCounts(db);
  const replay = await commitPackage(db, scope);
  check("L2.1", replay.outcome.ok === true && replay.outcome.replayed === true, "an exact replay reports replayed=true");
  check("L2.2", replay.outcome.importJobId === jobId, "and resolves to the same import job");
  const after = snapshotRowCounts(db);
  check("L2.3", JSON.stringify(before) === JSON.stringify(after), "and creates no row anywhere");
  check("L2.4", jobRow(db, jobId).commit_attempts === 1, "and does not count as another attempt");

  // ---- L3: the same job may not be committed with a different payload ------
  const tampered = await tamperedCommit(db, jobId, scope);
  check("L3.1", tampered.ok === false, `a changed payload under the staged identity is refused (${tampered.ok ? "accepted" : tampered.code})`);
  check("L3.2", tampered.code === "COMMITTED_PAYLOAD_DIFFERS", `with COMMITTED_PAYLOAD_DIFFERS (${tampered.code})`);
  check("L3.3", JSON.stringify(snapshotRowCounts(db)) === JSON.stringify(after), "and writes nothing");
  check("X6a", safeOutcome(tampered).clean, "the refusal carries no respondent value and no PostgreSQL message");

  // ---- L6: rollback removes exactly what the package created ---------------
  console.log("\n[core] rollback");
  const otherScope = seedStudy(db, "unrelated");
  const otherJournal = [];
  const unrelated = await runCanonicalCommit(psqlTransport(db, otherJournal), {
    tenantId: otherScope.tenant,
    studyId: otherScope.studyId,
    files: [cleanFile, painFile],
  });
  check("L6.0", unrelated.ok === true, `a second, unrelated study commits too (${unrelated.ok ? "ok" : unrelated.code})`);
  const assetsBefore = countOf(db, "source_asset");
  const jobAssetsBefore = countOf(db, "import_job_asset");
  const unrelatedRows = countOf(db, "study_participant", `study_id = '${otherScope.studyId}'`);

  const reverted = await runCanonicalRollback(psqlTransport(db), jobId, null);
  check("L6.1", reverted.ok === true, `the rollback succeeds (${reverted.ok ? "ok" : reverted.code})`);
  check("L6.2", countOf(db, "study_participant", `study_id = '${scope.studyId}'`) === 0, "the package's participants are gone");
  check("L6.3", countOf(db, "source_lineage", `import_job_id = '${jobId}'`) === 0, "its lineage is gone");
  check("L6.4", countOf(db, "import_job_record", `import_job_id = '${jobId}'`) === 0, "its ledger is empty");
  check(
    "L6.5",
    countOf(db, "study_participant", `study_id = '${otherScope.studyId}'`) === unrelatedRows,
    "the unrelated study is untouched",
  );
  check("L6.6", countOf(db, "source_asset") === assetsBefore, "source assets survive as provenance");
  check("L6.7", countOf(db, "import_job_asset") === jobAssetsBefore, "and so do the job's asset links");
  const afterRollback = jobRow(db, jobId);
  check("L6.8", afterRollback.status === "rolled_back", `the audit job survives as 'rolled_back' (${afterRollback.status})`);
  check("L6.9", afterRollback.has_rolled_back_at && afterRollback.rollback_count === 1, "with a timestamp and a count");
  check(
    "L6.10",
    countOf(db, "person_private", `tenant_id = '${otherScope.tenant}'`) > 0,
    "the unrelated tenant keeps every one of its own identities",
  );
  check(
    "L6.11",
    countOf(db, "person_private", `tenant_id = '${scope.tenant}'`) === 0,
    "while the reversed package's own, unshared identities are gone",
  );

  // ---- L7: repeating the rollback is a no-op -------------------------------
  const countsAfterRollback = snapshotRowCounts(db);
  const again = await runCanonicalRollback(psqlTransport(db), jobId, null);
  check("L7.1", again.ok === true && again.replayed === true, "a repeated rollback reports replayed=true");
  check("L7.2", JSON.stringify(snapshotRowCounts(db)) === JSON.stringify(countsAfterRollback), "and changes nothing");
  check("L7.3", jobRow(db, jobId).rollback_count === 1, "and does not count as a second rollback");

  // ---- L8: committing again after a rollback -------------------------------
  const recommitted = await commitPackage(db, scope);
  check("L8.1", recommitted.ok !== false || recommitted.outcome.ok === true, "a package commits again after being reversed");
  check("L8.2", recommitted.outcome.ok === true && recommitted.outcome.replayed === false, "as a real commit, not a replay");
  if (recommitted.outcome.ok) {
    const rejob = jobRow(db, jobId);
    check("L8.3", rejob.status === "committed" && rejob.commit_attempts === 2, `attempt 2 is recorded (${rejob.commit_attempts})`);
    const dupes = Number(
      db.run(
        `select count(*) from (
           select person_id, cohort_key from public.study_participant
           where study_id = '${scope.studyId}' group by 1,2 having count(*) > 1
         ) d;`,
      ).trim(),
    );
    check("L8.4", dupes === 0, "and produces no duplicate participation");
  }

  // ---- L4/L5: an injected mid-commit failure, then a retry -----------------
  console.log("\n[core] injected mid-commit failure and retry");
  await runCanonicalRollback(psqlTransport(db), jobId, null);
  const retryScope = seedStudy(db, "retry");
  // `pain_point` is written LATE, after persons, participants, attributes,
  // sessions and responses. A constraint that refuses every row therefore fails
  // the commit halfway through, which is exactly the case the subtransaction
  // exists for.
  db.run("alter table public.pain_point add constraint tmp_injected_failure check (false) not valid;");
  const failedRun = await commitPackage(db, retryScope);
  check("L4.1", failedRun.outcome.ok === false, `a mid-commit failure is reported as a failure (${failedRun.outcome.ok ? "accepted" : failedRun.outcome.code})`);
  check("L4.2", failedRun.outcome.status === "failed", `and recorded as 'failed' (${failedRun.outcome.status})`);
  const failedJobId = failedRun.outcome.importJobId;
  const failedJob = failedJobId ? jobRow(db, failedJobId) : null;
  check("L4.3", failedJob?.status === "failed", `the job says 'failed' (${failedJob?.status})`);
  check("L4.4", failedJob?.last_error_code === "DATABASE_CONSTRAINT", `with a safe code (${failedJob?.last_error_code})`);
  check(
    "L4.5",
    countOf(db, "study_participant", `study_id = '${retryScope.studyId}'`) === 0,
    "not one participant of the failed attempt survives",
  );
  const strayFamilies = Object.values(FAMILY_TABLE).filter(
    (table) =>
      table !== "person_private" &&
      table !== "person_external_identifier" &&
      countOf(db, table, `study_id = '${retryScope.studyId}'`) > 0,
  );
  check("L4.6", strayFamilies.length === 0, `zero partial rows in EVERY family${strayFamilies.length ? ` (${strayFamilies.join(", ")})` : ""}`);
  check("L4.7", countOf(db, "import_job_record", `import_job_id = '${failedJobId}'`) === 0, "and the ledger is empty");
  check("L4.8", countOf(db, "source_lineage", `import_job_id = '${failedJobId}'`) === 0, "and no lineage was left behind");
  check("X6b", safeOutcome(failedRun.outcome).clean, "the failure carries no respondent value and no PostgreSQL message");
  check(
    "X6c",
    !SENTINEL_PATTERN.test(JSON.stringify(failedJob?.error_report ?? {})),
    "and neither does what was stored on the job",
  );

  db.run("alter table public.pain_point drop constraint tmp_injected_failure;");
  const retried = await commitPackage(db, retryScope);
  check("L5.1", retried.outcome.ok === true, `the retry succeeds (${retried.outcome.ok ? "ok" : retried.outcome.code})`);
  check("L5.2", retried.outcome.replayed === false, "as a real commit");
  const retryJob = jobRow(db, retried.outcome.importJobId ?? failedJobId);
  check("L5.3", retryJob.commit_attempts === 2, `and is attempt 2 of the same job (${retryJob.commit_attempts})`);
  const retryDupes = Number(
    db.run(
      `select count(*) from (
         select person_id, cohort_key from public.study_participant
         where study_id = '${retryScope.studyId}' group by 1,2 having count(*) > 1
       ) d;`,
    ).trim(),
  );
  check("L5.4", retryDupes === 0, "exactly once, with no duplicate rows");

  // ---- L10: a count that disagrees ----------------------------------------
  console.log("\n[core] refusals");
  const mismatchScope = seedStudy(db, "counts");
  const mismatch = await commitWithMutatedPlan(db, mismatchScope, (plan) => {
    plan.expectedCounts.surveyResponses += 1;
  });
  check("L10.1", mismatch.ok === false, `a declared count that disagrees is refused (${mismatch.ok ? "accepted" : mismatch.code})`);
  check("L10.2", mismatch.code === "COUNT_MISMATCH", `with COUNT_MISMATCH (${mismatch.code})`);
  check(
    "L10.3",
    countOf(db, "study_participant", `study_id = '${mismatchScope.studyId}'`) === 0,
    "and no part of the package survives",
  );

  // ---- L11: malformed payloads -------------------------------------------
  const malformedScope = seedStudy(db, "malformed");
  const notArray = await commitWithMutatedPlan(db, malformedScope, (plan) => {
    plan.painPoints = { not: "an array" };
  });
  check("L11.1", notArray.ok === false && notArray.code === "PLAN_FAMILY_NOT_ARRAY", `a family that is not an array is refused (${notArray.code})`);
  const notObject = await rawCommit(db, malformedScope, "[]");
  check("L11.2", notObject.code === "PLAN_NOT_OBJECT", `a plan that is not an object is refused (${notObject.code})`);
  check(
    "L11.3",
    countOf(db, "study_participant", `study_id = '${malformedScope.studyId}'`) === 0,
    "and neither writes anything",
  );

  // ---- L12: foreign tenant and study --------------------------------------
  const foreignScope = seedStudy(db, "foreign");
  const foreignTenantRows = countOf(db, "study_participant", `tenant_id = '${foreignScope.tenant}'`);
  const foreignTenant = await commitWithMutatedPlan(db, mismatchScope, (plan) => {
    plan.tenantId = foreignScope.tenant;
  });
  check("L12.1", foreignTenant.ok === false && foreignTenant.code === "TENANT_SCOPE_MISMATCH", `a foreign tenant is refused (${foreignTenant.code})`);
  const foreignStudy = await commitWithMutatedPlan(db, mismatchScope, (plan) => {
    plan.studyId = foreignScope.studyId;
  });
  check("L12.2", foreignStudy.ok === false && foreignStudy.code === "STUDY_SCOPE_MISMATCH", `a foreign study is refused (${foreignStudy.code})`);
  check(
    "L12.3",
    countOf(db, "study_participant", `tenant_id = '${foreignScope.tenant}'`) === foreignTenantRows,
    "and the foreign tenant is unchanged",
  );

  // ---- L13: lineage citing a role the job does not carry ------------------
  const roleScope = seedStudy(db, "assetrole");
  const strayRole = await commitWithMutatedPlan(db, roleScope, (plan) => {
    plan.sourceLineage[0].sourceAssetRole = "a_role_this_job_does_not_have";
  });
  check("L13.1", strayRole.ok === false, `lineage citing an unattached role is refused (${strayRole.ok ? "accepted" : strayRole.code})`);
  check("L13.2", strayRole.code === "ASSET_ROLE_UNKNOWN", `with ASSET_ROLE_UNKNOWN (${strayRole.code})`);
  check(
    "L13.3",
    countOf(db, "study_participant", `study_id = '${roleScope.studyId}'`) === 0,
    "and nothing was written",
  );

  // ---- EXTRA: duplicate asset roles ---------------------------------------
  const dupScope = seedStudy(db, "duproles");
  const duplicateRole = await stageWithMutatedRequest(db, dupScope, (request) => {
    request.assets[1].role = request.assets[0].role;
  });
  check(
    "X2",
    duplicateRole.ok === false,
    `two assets claiming one role cannot build an ambiguous asset map (${duplicateRole.ok ? "accepted" : duplicateRole.code})`,
  );
  const sameAssetTwice = await stageWithMutatedRequest(db, dupScope, (request) => {
    request.assets[1] = { ...request.assets[0], role: "curated_pain_map" };
  });
  check(
    "X2b",
    sameAssetTwice.ok === false && sameAssetTwice.code === "ASSET_SET_NOT_DISTINCT",
    `one file claiming two roles is refused by NAME, not by a cardinality violation (${sameAssetTwice.code})`,
  );

  // ---- EXTRA: a rollback that fails leaves the package committed ----------
  console.log("\n[core] a rollback that cannot finish");
  const guardScope = seedStudy(db, "rbfail");
  const guarded = await commitPackage(db, guardScope);
  if (guarded.outcome.ok) {
    const guardedJob = guarded.outcome.importJobId;
    db.run(
      `create function public.tmp_block_delete() returns trigger language plpgsql as $$
         begin raise exception using errcode = '55000', message = 'TMP_BLOCKED'; end $$;
       create trigger tmp_block_pain before delete on public.pain_point
         for each row execute function public.tmp_block_delete();`,
    );
    const blocked = await runCanonicalRollback(psqlTransport(db), guardedJob, null);
    check("X3.1", blocked.ok === false, `a rollback that cannot finish reports failure (${blocked.ok ? "claimed success" : blocked.code})`);
    const stillCommitted = jobRow(db, guardedJob);
    check("X3.2", stillCommitted.status === "committed", `the job is NOT marked rolled_back (${stillCommitted.status})`);
    check(
      "X3.3",
      countOf(db, "import_job_record", `import_job_id = '${guardedJob}'`) > 0,
      "and its owned rows are still identified by the ledger",
    );
    check(
      "X3.4",
      countOf(db, "study_participant", `study_id = '${guardScope.studyId}'`) > 0,
      "and the canonical rows are still there",
    );
    db.run("drop trigger tmp_block_pain on public.pain_point; drop function public.tmp_block_delete();");
    const unblocked = await runCanonicalRollback(psqlTransport(db), guardedJob, null);
    check("X3.5", unblocked.ok === true, "and the rollback completes once the obstruction is gone");
  } else {
    bad("X3.1", "could not commit the package the rollback-failure case needs");
  }
}

/** Row counts for every canonical table, as one comparable object. */
function snapshotRowCounts(db) {
  const tables = [...new Set(Object.values(FAMILY_TABLE))].sort();
  const sql =
    "select json_build_object(" +
    tables.map((t) => `'${t}', (select count(*) from public.${t})`).join(", ") +
    ", 'source_lineage', (select count(*) from public.source_lineage)" +
    ", 'import_job_record', (select count(*) from public.import_job_record)" +
    ")::text;";
  return JSON.parse(db.run(sql).trim());
}

// ---------------------------------------------------------------------------
// Mutating a plan AFTER the flow has produced it
// ---------------------------------------------------------------------------
// The workflow refuses to build an invalid plan, which is the point of it. To
// test what the DATABASE does with one, the plan is projected honestly, staged
// honestly, and only then altered — exactly the shape of an attack where the
// payload is tampered with between validation and commit.
async function projectAndStage(db, scope) {
  const journal = [];
  const transport = psqlTransport(db, journal);
  const captured = { request: null, plan: null };
  const capturing = {
    rpc: async (name, args) => {
      if (name === "stage_canonical_package") captured.request = args.p_request;
      if (name === "commit_canonical_package") {
        captured.plan = args.p_plan;
        captured.jobId = args.p_import_job_id;
        return { data: null, error: { message: "HARNESS_STOP" } };
      }
      return transport.rpc(name, args);
    },
  };
  await runCanonicalCommit(capturing, {
    tenantId: scope.tenant,
    studyId: scope.studyId,
    files: [cleanFile, painFile],
  });
  return captured;
}

async function commitWithMutatedPlan(db, scope, mutate) {
  const captured = await projectAndStage(db, scope);
  if (!captured.plan) return { ok: false, code: "HARNESS_COULD_NOT_STAGE" };
  const plan = JSON.parse(JSON.stringify(captured.plan));
  mutate(plan);
  return callCommit(db, captured.jobId, plan);
}

async function tamperedCommit(db, jobId, scope) {
  const captured = await projectAndStage(db, scope);
  const plan = JSON.parse(JSON.stringify(captured.plan));
  plan.participants = plan.participants.slice(0, -1);
  plan.expectedCounts.participants -= 1;
  return callCommit(db, jobId, plan);
}

async function callCommit(db, jobId, plan) {
  const transport = psqlTransport(db);
  const { data, error } = await transport.rpc("commit_canonical_package", {
    p_import_job_id: jobId,
    p_plan: plan,
  });
  if (error) {
    const { safeErrorCode } = await import("../src/lib/ingestion/canonical-commit/result.ts");
    return { ok: false, code: safeErrorCode(error), raw: null };
  }
  if (data?.status === "failed") return { ok: false, code: data.code };
  return { ok: data?.status === "committed", code: data?.status ?? "NO_RESULT" };
}

async function rawCommit(db, scope, planLiteral) {
  const captured = await projectAndStage(db, scope);
  const transport = psqlTransport(db);
  const { error } = await transport.rpc("commit_canonical_package", {
    p_import_job_id: captured.jobId,
    p_plan: JSON.parse(planLiteral),
  });
  const { safeErrorCode } = await import("../src/lib/ingestion/canonical-commit/result.ts");
  return { code: error ? safeErrorCode(error) : "ACCEPTED" };
}

async function stageWithMutatedRequest(db, scope, mutate) {
  const captured = await projectAndStage(db, scope);
  if (!captured.request) return { ok: false, code: "HARNESS_COULD_NOT_PROJECT" };
  const request = JSON.parse(JSON.stringify(captured.request));
  mutate(request);
  const transport = psqlTransport(db);
  const { data, error } = await transport.rpc("stage_canonical_package", {
    p_tenant_id: scope.tenant,
    p_study_id: scope.studyId,
    p_request: request,
  });
  if (error) {
    const { safeErrorCode } = await import("../src/lib/ingestion/canonical-commit/result.ts");
    return { ok: false, code: safeErrorCode(error) };
  }
  return { ok: true, code: data?.status ?? "STAGED" };
}

// ---- L9 plus the shared-identity cases ------------------------------------
async function sharingSuite(db) {
  console.log("\n[sharing] concurrency, shared identities and retention");
  prepare(db);
  const studyA = seedStudy(db, "sharea");

  // Two studies of the SAME tenant import the same people. The second reuses
  // every person, which is what makes rollback's retention rule observable.
  const first = await commitPackage(db, studyA);
  check("X4.0", first.outcome.ok === true, `study A commits (${first.outcome.ok ? "ok" : first.outcome.code})`);
  const personsAfterA = countOf(db, "person_private");

  const studyB = { tenant: studyA.tenant, studyId: seedStudyInTenant(db, studyA.tenant, "shareb") };
  const second = await commitPackage(db, studyB);
  check("X4.1", second.outcome.ok === true, `study B of the same tenant commits (${second.outcome.ok ? "ok" : second.outcome.code})`);
  check("X4.2", countOf(db, "person_private") === personsAfterA, "and creates no new person — it reuses study A's identities");
  const reused = Number(
    db.run(
      `select count(*) from public.import_job_record where import_job_id = '${second.outcome.importJobId}' and target_table = 'person_private' and ownership = 'reused';`,
    ).trim(),
  );
  check("X4.3", reused === personsAfterA, `the ledger records ${reused} reused identities`);

  const revertA = await runCanonicalRollback(psqlTransport(db), first.outcome.importJobId, null);
  check("X4.4", revertA.ok === true, "study A is reversed");
  check("X4.5", countOf(db, "person_private") === personsAfterA, "and every shared person is retained, not destroyed");
  check("X4.6", revertA.retainedSharedIdentities === personsAfterA, `and the retention is reported (${revertA.retainedSharedIdentities})`);
  check(
    "X4.7",
    countOf(db, "study_participant", `study_id = '${studyB.studyId}'`) > 0,
    "study B still has its participations",
  );

  const recommitA = await commitPackage(db, studyA);
  check("X5.1", recommitA.outcome.ok === true, `study A commits again over the retained identities (${recommitA.outcome.ok ? "ok" : recommitA.outcome.code})`);
  check("X5.2", countOf(db, "person_private") === personsAfterA, "still creating no new person");
  const reusedAgain = Number(
    db.run(
      `select count(*) from public.import_job_record where import_job_id = '${recommitA.outcome.importJobId}' and target_table = 'person_private' and ownership = 'reused';`,
    ).trim(),
  );
  check("X5.3", reusedAgain === personsAfterA, "and recording all of them as reused this time");

  // ---- L9: two genuinely concurrent sessions ------------------------------
  console.log("\n[sharing] two concurrent commits");
  const raceScope = { tenant: studyA.tenant, studyId: seedStudyInTenant(db, studyA.tenant, "race") };
  const captured = await projectAndStage(db, raceScope);
  if (!captured.plan) {
    bad("L9.1", "could not stage the package the concurrency case needs");
    return;
  }
  const planFile = db.writePayload("race-plan", { p_import_job_id: captured.jobId, p_plan: captured.plan });
  const slow = join(db.scratch, "race-a.sql");
  const fast = join(db.scratch, "race-b.sql");
  const body =
    "create temp table _rpc_arg(j jsonb);\n" +
    `insert into _rpc_arg select pg_read_file($payload$${planFile}$payload$)::jsonb;\n` +
    "grant select on _rpc_arg to service_role;\n" +
    "set role service_role;\n" +
    `select coalesce(${RPC_CALLS.commit_canonical_package("a")}::text, 'null') from _rpc_arg a;\n` +
    "reset role;\n";
  // A holds the job lock for three seconds AFTER committing the package, inside
  // one explicit transaction. B starts while that lock is held, so it really
  // does wait on the row rather than on a sleep in this script.
  writeFileSync(slow, `begin;\n${body}select pg_sleep(3);\ncommit;\n`, { mode: 0o600 });
  writeFileSync(fast, body, { mode: 0o600 });

  const runA = spawnPsql(db, slow);
  await delay(900);
  const runB = spawnPsql(db, fast);
  const [outA, outB] = await Promise.all([runA, runB]);

  const parse = (out) => {
    const line = out.stdout.split("\n").map((l) => l.trim()).filter((l) => l.startsWith("{"))[0];
    return line ? JSON.parse(line) : null;
  };
  const resultA = parse(outA);
  const resultB = parse(outB);
  check("L9.1", outA.code === 0 && outB.code === 0, `both sessions completed (${outA.code}, ${outB.code})`);
  const committedCount = [resultA, resultB].filter((r) => r?.status === "committed" && r?.replayed === false).length;
  const replayedCount = [resultA, resultB].filter((r) => r?.replayed === true).length;
  check("L9.2", committedCount === 1, `exactly one session committed (${committedCount})`);
  check("L9.3", replayedCount === 1, `and the other replayed (${replayedCount})`);
  const raceDupes = Number(
    db.run(
      `select count(*) from (
         select person_id, cohort_key from public.study_participant
         where study_id = '${raceScope.studyId}' group by 1,2 having count(*) > 1
       ) d;`,
    ).trim(),
  );
  check("L9.4", raceDupes === 0, "and the row counts equal a single commit");
  check("L9.5", jobRow(db, captured.jobId).commit_attempts === 1, "with one recorded attempt");
}

function seedStudyInTenant(db, tenantId, label) {
  return db
    .run(
      `set role service_role;
       insert into public.study (tenant_id, name) values ('${tenantId}', '${label} study') returning id;`,
    )
    .trim();
}

function spawnPsql(db, file) {
  return new Promise((resolve) => {
    const args = ["-X", "-q", "-A", "-t", "-v", "ON_ERROR_STOP=1", ...db.connectionArgs(), "-f", file];
    const child = spawn("psql", args, { env: { ...process.env, PGCLIENTENCODING: "UTF8" } });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ---- L14 and L15 -----------------------------------------------------------
async function securitySuite(db) {
  console.log("\n[security] privileges, search paths and browser-role denial");
  prepare(db);

  const FUNCTIONS = [
    ["record_canonical_rows", "'00000000-0000-4000-8000-000000000001'::uuid, '00000000-0000-4000-8000-000000000001'::uuid, '00000000-0000-4000-8000-000000000001'::uuid, 'person_private', '{}'::uuid[], 'created'"],
    ["stage_canonical_package", "'00000000-0000-4000-8000-000000000001'::uuid, '00000000-0000-4000-8000-000000000001'::uuid, '{}'::jsonb"],
    ["commit_canonical_package", "'00000000-0000-4000-8000-000000000001'::uuid, '{}'::jsonb"],
    ["rollback_canonical_package", "'00000000-0000-4000-8000-000000000001'::uuid, null::uuid"],
  ];

  for (const role of ["anon", "authenticated"]) {
    for (const [fn, args] of FUNCTIONS) {
      let denied = false;
      let state = null;
      try {
        db.run(`set role ${role};\nselect public.${fn}(${args});\n`);
      } catch (thrown) {
        state = thrown.sqlstate;
        denied = thrown.sqlstate === "42501";
      }
      check("L14.1", denied, `${role} cannot execute ${fn} (sqlstate ${state ?? "none — IT SUCCEEDED"})`);
    }
  }

  // service_role must be able to execute the two operations the server performs.
  for (const fn of ["stage_canonical_package", "commit_canonical_package", "rollback_canonical_package"]) {
    let sqlstate = null;
    try {
      const args = FUNCTIONS.find(([name]) => name === fn)[1];
      db.run(`set role service_role;\nselect public.${fn}(${args});\n`);
    } catch (thrown) {
      sqlstate = thrown.sqlstate;
    }
    // A missing job is P0002 / 42501-free: the point is that EXECUTE was allowed.
    check("L14.2", sqlstate !== "42501", `service_role may execute ${fn} (sqlstate ${sqlstate ?? "none"})`);
  }

  // Direct table access by a browser role must be denied on the new tables too.
  for (const table of ["import_job_record", "retention_period", "person_private", "survey_response"]) {
    for (const role of ["anon", "authenticated"]) {
      let sqlstate = null;
      try {
        db.run(`set role ${role};\nselect * from public.${table} limit 1;\n`);
      } catch (thrown) {
        sqlstate = thrown.sqlstate;
      }
      check("L14.3", sqlstate === "42501", `${role} cannot read public.${table} (sqlstate ${sqlstate ?? "none — IT SUCCEEDED"})`);
    }
  }

  // ---- L15: definer, empty search path, exact grants ----------------------
  const facts = db.json(
    `select json_agg(json_build_object(
       'name', p.proname,
       'secdef', p.prosecdef,
       'config', coalesce(array_to_json(p.proconfig), '[]'::json),
       'acl', coalesce(array_to_string(p.proacl::text[], ','), '')
     ) order by p.proname)::text
     from pg_catalog.pg_proc p
     join pg_catalog.pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in ('record_canonical_rows','stage_canonical_package','commit_canonical_package','rollback_canonical_package');`,
  );
  check("L15.1", Array.isArray(facts) && facts.length === 4, `all four functions exist (${facts?.length ?? 0})`);
  for (const fn of facts ?? []) {
    check("L15.2", fn.secdef === true, `${fn.name} is SECURITY DEFINER`);
    // PostgreSQL stores `set search_path = ''` as the setting `search_path=""`.
    // Both spellings mean the same empty path; anything else does not.
    const searchPath = (fn.config ?? []).find((entry) => entry.startsWith("search_path="));
    check(
      "L15.3",
      searchPath === "search_path=" || searchPath === 'search_path=""',
      `${fn.name} has an EMPTY search_path (${JSON.stringify(fn.config)})`,
    );
    const acl = fn.acl;
    check("L15.4", !/\banon=/.test(acl) && !/\bauthenticated=/.test(acl), `${fn.name} grants nothing to a browser role`);
    check("L15.5", /service_role=X/.test(acl), `${fn.name} grants EXECUTE to service_role`);
    check("L15.6", !/^=X|,=X/.test(acl), `${fn.name} does not leave EXECUTE with PUBLIC`);
  }

  // The two new tables must carry RLS, FORCE RLS and a deny policy.
  const tables = db.json(
    `select json_agg(json_build_object(
       'name', c.relname, 'rls', c.relrowsecurity, 'force', c.relforcerowsecurity,
       'policies', (select count(*) from pg_catalog.pg_policy p where p.polrelid = c.oid)
     ) order by c.relname)::text
     from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relname in ('import_job_record', 'retention_period');`,
  );
  for (const t of tables ?? []) {
    check("L15.7", t.rls && t.force, `${t.name} has RLS and FORCE RLS`);
    check("L15.8", Number(t.policies) === 1, `${t.name} carries its deny-browser-roles policy`);
  }
}

// ---- L16 plus the rollback-refusal case ------------------------------------
async function catalogueSuite(db) {
  console.log("\n[catalogue] 0024 applied, reversed, and compared to the 0023 state");
  prepare(db, 23);
  const before = snapshot(db);
  db.applyFile(migrationPath("0024"));
  const withUnit3 = snapshot(db);
  check(
    "L16.1",
    JSON.stringify(before) !== JSON.stringify(withUnit3),
    "applying 0024 actually changes the catalogue",
  );

  db.applyFile(join(ROLLBACKS, "0024_drop_canonical_commit_and_rollback.sql"));
  const after = snapshot(db);
  const differences = diffCatalogue(before, after);
  check(
    "L16.2",
    differences.length === 0,
    `reversing 0024 restores the exact 0023 catalogue${differences.length ? ` (${differences.slice(0, 4).join("; ")})` : ""}`,
  );

  // EXTRA: the reverse script must refuse while a package still owns rows.
  console.log("\n[catalogue] the reverse script refuses to orphan owned rows");
  db.applyFile(migrationPath("0024"));
  const scope = seedStudy(db, "guard");
  const committed = await commitPackage(db, scope);
  check("X7.0", committed.outcome.ok === true, `a package is committed (${committed.outcome.ok ? "ok" : committed.outcome.code})`);
  let refusedState = null;
  let refusedMessage = "";
  try {
    db.applyFile(join(ROLLBACKS, "0024_drop_canonical_commit_and_rollback.sql"));
  } catch (thrown) {
    refusedState = thrown.sqlstate;
    refusedMessage = thrown.databaseMessage ?? "";
  }
  check("X7.1", refusedState === "55000", `the reverse script refuses (sqlstate ${refusedState ?? "none — IT RAN"})`);
  check(
    "X7.2",
    /CANONICAL_PACKAGES_STILL_OWNED/.test(refusedMessage),
    "naming the reason, not a constraint violation",
  );
  check(
    "X7.3",
    countOf(db, "import_job_record") > 0 && countOf(db, "study_participant") > 0,
    "and the ledger and the canonical rows are both still there",
  );
  const stillPresent = db.json(
    "select json_build_object('ledger', to_regclass('public.import_job_record') is not null, 'fn', to_regprocedure('public.commit_canonical_package(uuid, jsonb)') is not null)::text;",
  );
  check("X7.4", stillPresent.ledger === true && stillPresent.fn === true, "nothing was dropped by the refused run");

  await runCanonicalRollback(psqlTransport(db), committed.outcome.importJobId, null);
  let secondState = null;
  try {
    db.applyFile(join(ROLLBACKS, "0024_drop_canonical_commit_and_rollback.sql"));
  } catch (thrown) {
    secondState = thrown.sqlstate;
  }
  check("X7.5", secondState === null, `and it succeeds once the package is reversed (${secondState ?? "ok"})`);
}

function diffCatalogue(before, after) {
  const differences = [];
  const walk = (a, b, path) => {
    if (JSON.stringify(a) === JSON.stringify(b)) return;
    if (Array.isArray(a) && Array.isArray(b)) {
      const key = (item) => item?.name ?? item?.signature ?? JSON.stringify(item);
      const beforeMap = new Map(a.map((item) => [key(item), item]));
      const afterMap = new Map(b.map((item) => [key(item), item]));
      for (const name of beforeMap.keys()) {
        if (!afterMap.has(name)) differences.push(`${path}: '${name}' disappeared`);
      }
      for (const name of afterMap.keys()) {
        if (!beforeMap.has(name)) differences.push(`${path}: '${name}' remained`);
      }
      for (const [name, item] of beforeMap) {
        if (afterMap.has(name)) walk(item, afterMap.get(name), `${path}/${name}`);
      }
      return;
    }
    if (a && b && typeof a === "object" && typeof b === "object") {
      for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
        walk(a[key], b[key], `${path}/${key}`);
      }
      return;
    }
    differences.push(`${path}: ${JSON.stringify(a)} became ${JSON.stringify(b)}`);
  };
  walk(before, after, "");
  return differences;
}

// ---- The real package across the serialization boundary --------------------
async function realPackageSuite(db) {
  const cleanPath = process.env.CANONICAL_COMMIT_TEST_CLEAN_XLSX;
  const painPath = process.env.CANONICAL_COMMIT_TEST_PAIN_XLSX;
  if (!cleanPath || !painPath) {
    console.log("\n[real] SKIPPED — set CANONICAL_COMMIT_TEST_CLEAN_XLSX and _PAIN_XLSX to run it");
    results.push({ id: "X8", ok: true, message: "real-package boundary not requested", skipped: true });
    return;
  }
  console.log("\n[real] the complete package across the serialization boundary");
  prepare(db);
  const scope = seedStudy(db, "realpkg");
  const load = (path) => {
    const buffer = readFileSync(path);
    return {
      fileName: "package.xlsx",
      bytes: buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength),
    };
  };
  const journal = [];
  const started = process.hrtime.bigint();
  const outcome = await runCanonicalCommit(psqlTransport(db, journal), {
    tenantId: scope.tenant,
    studyId: scope.studyId,
    files: [load(cleanPath), load(painPath)],
  });
  const elapsed = Number(process.hrtime.bigint() - started) / 1e6;
  check("X8.1", outcome.ok === true, `the real package commits (${outcome.ok ? "ok" : outcome.code})`);
  if (!outcome.ok) return;

  const commitCall = journal.find((entry) => entry.name === "commit_canonical_package");
  const rows = Object.values(FAMILY_TABLE).reduce((n, table) => n + countOf(db, table), 0);
  const lineage = countOf(db, "source_lineage");
  check("X8.2", rows > 0 && lineage > 0, `${rows} canonical rows and ${lineage} lineage rows`);
  check(
    "X8.3",
    Number(outcome.counts.measured.persons) === 60 && Number(outcome.counts.measured.surveyResponses) === 1685,
    `the database measured the documented totals (persons=${outcome.counts.measured.persons}, responses=${outcome.counts.measured.surveyResponses})`,
  );

  const rollbackStarted = process.hrtime.bigint();
  const reverted = await runCanonicalRollback(psqlTransport(db), outcome.importJobId, null);
  const rollbackMs = Number(process.hrtime.bigint() - rollbackStarted) / 1e6;
  check("X8.4", reverted.ok === true, `and reverses completely (${reverted.ok ? "ok" : reverted.code})`);
  check(
    "X8.5",
    Object.values(FAMILY_TABLE).every((table) => countOf(db, table) === 0),
    "leaving zero canonical rows",
  );

  timings.push(
    `real package: plan ${describeBytes(journal)} · whole commit ${elapsed.toFixed(0)} ms ` +
      `(RPC ${commitCall ? commitCall.ms.toFixed(0) : "?"} ms) · rollback ${rollbackMs.toFixed(0)} ms · ` +
      `${rows} canonical rows · ${lineage} lineage rows`,
  );
}

function describeBytes(journal) {
  const entry = journal.find((e) => e.name === "commit_canonical_package");
  return entry?.bytes ? `${(entry.bytes / 1048576).toFixed(2)} MiB (${entry.bytes} bytes)` : "unmeasured";
}

// The entry point runs LAST, so every helper above it is initialised.
await main();
