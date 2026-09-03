// =============================================================================
// The canonical commit and rollback assertions — TRANSPORT-NEUTRAL
// =============================================================================
// These are the same assertions the database gate has always run, with the same
// ids and the same messages. What changed is that they no longer know how they
// reach PostgreSQL: everything goes through the contract in
// `canonical-suite-transport.mjs`, so the local PostgreSQL runner
// (`scripts/canonical-commit-live-test.mjs`) and the hosted runner
// (`scripts/canonical-commit-hosted-test.mjs`) execute ONE body of assertions.
//
// -----------------------------------------------------------------------------
// WHAT A SECOND TRANSPORT CAN AND CANNOT ANSWER
// -----------------------------------------------------------------------------
// Some cases here are irreducibly local. They are not skipped quietly; each one
// declares the capability it needs, and a transport without that capability
// records a SKIP naming it. A skip is never a pass.
//
//   ddl                 L4.x, L5.x, X6b, X6c, X3.x, L16.x, X7.x — the injected
//                       CHECK constraint, the blocking trigger, and executing
//                       migration/rollback .sql files. No REST client can make
//                       a healthy database fail halfway through a commit, and
//                       adding a permanent failure-injection hook to the
//                       migration would be a worse thing than an honest skip.
//   catalogue           L15.x, X7.4 — pg_catalog is not exposed through
//                       PostgREST.
//   roleSwitch          L14.x — needs an identity, not arbitrary SQL, so a REST
//                       transport CAN answer these with a second, anon-keyed
//                       client.
//   concurrentSessions  L9.x — determinism comes from one session holding the
//                       job lock for three seconds. Two simultaneous REST calls
//                       would prove the same thing only probabilistically, and
//                       a flaky assertion is worse than a declared skip.
//   rawErrorText        X7.2 — matches the database's own message text.
//
// NOTHING HERE PRINTS a credential, a respondent value, a workbook cell, a plan
// fragment, or the text of a PostgreSQL error.
// =============================================================================

import { runCanonicalCommit, runCanonicalRollback } from "../../src/lib/ingestion/canonical-commit/flow.ts";

const SENTINEL_PATTERN = /Z(?:NOMBRE|ID|TEXTO|CATEG)PRIV\d{3}/;

/** Plan family -> the table that family lands in. `sourceLineage` is job-scoped. */
export const FAMILY_TABLE = {
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

/** The four functions migration 0024 adds, with args for a privilege probe. */
const FUNCTIONS = [
  {
    name: "record_canonical_rows",
    sql: "'00000000-0000-4000-8000-000000000001'::uuid, '00000000-0000-4000-8000-000000000001'::uuid, '00000000-0000-4000-8000-000000000001'::uuid, 'person_private', '{}'::uuid[], 'created'",
    rest: {
      p_import_job_id: "00000000-0000-4000-8000-000000000001",
      p_tenant_id: "00000000-0000-4000-8000-000000000001",
      p_study_id: "00000000-0000-4000-8000-000000000001",
      p_target_table: "person_private",
      p_ids: [],
      p_ownership: "created",
    },
  },
  {
    name: "stage_canonical_package",
    sql: "'00000000-0000-4000-8000-000000000001'::uuid, '00000000-0000-4000-8000-000000000001'::uuid, '{}'::jsonb",
    rest: {
      p_tenant_id: "00000000-0000-4000-8000-000000000001",
      p_study_id: "00000000-0000-4000-8000-000000000001",
      p_request: {},
    },
  },
  {
    name: "commit_canonical_package",
    sql: "'00000000-0000-4000-8000-000000000001'::uuid, '{}'::jsonb",
    rest: { p_import_job_id: "00000000-0000-4000-8000-000000000001", p_plan: {} },
  },
  {
    name: "rollback_canonical_package",
    sql: "'00000000-0000-4000-8000-000000000001'::uuid, null::uuid",
    rest: { p_import_job_id: "00000000-0000-4000-8000-000000000001", p_actor: null },
  },
];

const safeOutcome = (outcome) => {
  const text = JSON.stringify(outcome);
  return {
    clean: !SENTINEL_PATTERN.test(text) && !/duplicate key value|violates|ERROR:|CONTEXT:/.test(text),
    text,
  };
};

/** Row counts for every canonical table, as one comparable object. */
async function snapshotRowCounts(t) {
  return t.counts([...Object.values(FAMILY_TABLE), "source_lineage", "import_job_record"]);
}

// Every transport call is awaited, because a transport may be a network client.
// These two helpers exist so the sequential shape stays readable where the
// original code used `reduce` and `filter`.
async function sumRows(t) {
  let total = 0;
  for (const table of Object.values(FAMILY_TABLE)) total += await t.count(table);
  return total;
}

async function filterAsync(items, predicate) {
  const kept = [];
  for (const item of items) if (await predicate(item)) kept.push(item);
  return kept;
}

async function commitPackage(t, ctx, scope, files = [ctx.cleanFile, ctx.painFile]) {
  const outcome = await runCanonicalCommit(t, {
    tenantId: scope.tenant,
    studyId: scope.studyId,
    files,
  });
  return { outcome };
}

// ---------------------------------------------------------------------------
// Mutating a plan AFTER the flow has produced it
// ---------------------------------------------------------------------------
// The workflow refuses to build an invalid plan, which is the point of it. To
// test what the DATABASE does with one, the plan is projected honestly, staged
// honestly, and only then altered — exactly the shape of an attack where the
// payload is tampered with between validation and commit.
async function projectAndStage(t, ctx, scope) {
  const captured = { request: null, plan: null };
  const capturing = {
    rpc: async (name, args) => {
      if (name === "stage_canonical_package") captured.request = args.p_request;
      if (name === "commit_canonical_package") {
        captured.plan = args.p_plan;
        captured.jobId = args.p_import_job_id;
        return { data: null, error: { message: "HARNESS_STOP" } };
      }
      return t.rpc(name, args);
    },
  };
  await runCanonicalCommit(capturing, {
    tenantId: scope.tenant,
    studyId: scope.studyId,
    files: [ctx.cleanFile, ctx.painFile],
  });
  return captured;
}

async function callCommit(t, jobId, plan) {
  const { data, error } = await t.rpc("commit_canonical_package", {
    p_import_job_id: jobId,
    p_plan: plan,
  });
  if (error) {
    const { safeErrorCode } = await import("../../src/lib/ingestion/canonical-commit/result.ts");
    return { ok: false, code: safeErrorCode(error), raw: null };
  }
  if (data?.status === "failed") return { ok: false, code: data.code };
  return { ok: data?.status === "committed", code: data?.status ?? "NO_RESULT" };
}

async function commitWithMutatedPlan(t, ctx, scope, mutate) {
  const captured = await projectAndStage(t, ctx, scope);
  if (!captured.plan) return { ok: false, code: "HARNESS_COULD_NOT_STAGE" };
  const plan = JSON.parse(JSON.stringify(captured.plan));
  mutate(plan);
  return callCommit(t, captured.jobId, plan);
}

async function tamperedCommit(t, ctx, jobId, scope) {
  const captured = await projectAndStage(t, ctx, scope);
  const plan = JSON.parse(JSON.stringify(captured.plan));
  plan.participants = plan.participants.slice(0, -1);
  plan.expectedCounts.participants -= 1;
  return callCommit(t, jobId, plan);
}

async function rawCommit(t, ctx, scope, planLiteral) {
  const captured = await projectAndStage(t, ctx, scope);
  const { error } = await t.rpc("commit_canonical_package", {
    p_import_job_id: captured.jobId,
    p_plan: JSON.parse(planLiteral),
  });
  const { safeErrorCode } = await import("../../src/lib/ingestion/canonical-commit/result.ts");
  return { code: error ? safeErrorCode(error) : "ACCEPTED" };
}

async function stageWithMutatedRequest(t, ctx, scope, mutate) {
  const captured = await projectAndStage(t, ctx, scope);
  if (!captured.request) return { ok: false, code: "HARNESS_COULD_NOT_PROJECT" };
  const request = JSON.parse(JSON.stringify(captured.request));
  mutate(request);
  const { data, error } = await t.rpc("stage_canonical_package", {
    p_tenant_id: scope.tenant,
    p_study_id: scope.studyId,
    p_request: request,
  });
  if (error) {
    const { safeErrorCode } = await import("../../src/lib/ingestion/canonical-commit/result.ts");
    return { ok: false, code: safeErrorCode(error) };
  }
  return { ok: true, code: data?.status ?? "STAGED" };
}

// ---- L1-L5, L7-L8, L10-L13 and the count/ledger cases ---------------------
export async function coreSuite(t, ctx) {
  const { check, bad, needs, timings } = ctx.ledger;
  console.log("\n[core] first commit, replay, failure, retry, rollback");
  await t.prepare();
  const scope = await t.createStudy("core");

  // ---- L1: the first commit writes the complete package --------------------
  const first = await commitPackage(t, ctx, scope);
  check("L1.1", first.outcome.ok === true, `the first commit succeeds (${first.outcome.ok ? "ok" : first.outcome.code})`);
  if (!first.outcome.ok) return;
  const jobId = first.outcome.importJobId;
  const job = await t.readJob(jobId);
  check("L1.2", job.status === "committed", `import_job is 'committed' (${job.status})`);
  check("L1.3", job.has_committed_at && job.has_digest, "committed_at and payload_digest are recorded");
  check("L1.4", job.commit_attempts === 1, `commit_attempts is 1 (${job.commit_attempts})`);

  // These counts are UNFILTERED, which is only equal to the job's own counts
  // because the database this suite runs against starts empty. A transport with
  // pre-existing data must compare deltas against a baseline census instead.
  let familyMismatch = [];
  for (const [family, table] of Object.entries(FAMILY_TABLE)) {
    const expected = Number(job.actual_counts[family]);
    const rows = await t.count(table);
    if (rows !== expected) familyMismatch.push(`${family}:${rows}!=${expected}`);
  }
  check("L1.5", familyMismatch.length === 0, `every family's rows match its measured count${familyMismatch.length ? ` (${familyMismatch.slice(0, 3).join(", ")})` : ""}`);
  const lineage = await t.count("source_lineage", { import_job_id: jobId });
  check("L1.6", lineage === Number(job.actual_counts.sourceLineage), `source_lineage rows match (${lineage})`);

  // EXTRA: ledger consistency, family by family.
  const ledgerMismatch = [];
  for (const [family, table] of Object.entries(FAMILY_TABLE)) {
    const created = await t.count("import_job_record", { import_job_id: jobId, target_table: table, ownership: "created" });
    const reused = await t.count("import_job_record", { import_job_id: jobId, target_table: table, ownership: "reused" });
    if (created + reused !== Number(job.actual_counts[family])) {
      ledgerMismatch.push(`${family}:${created}+${reused}!=${job.actual_counts[family]}`);
    }
  }
  check(
    "X1",
    ledgerMismatch.length === 0,
    `every declared family is represented in the ledger${ledgerMismatch.length ? ` (${ledgerMismatch.slice(0, 3).join(", ")})` : ""}`,
  );

  const totalOwned = await t.count("import_job_record", { import_job_id: jobId });
  timings.push(
    `L1 wrote ${await sumRows(t)} canonical rows, ` +
      `${lineage} lineage rows, ${totalOwned} ledger rows`,
  );

  // ---- L2: an exact replay is idempotent -----------------------------------
  const before = await snapshotRowCounts(t);
  const replay = await commitPackage(t, ctx, scope);
  check("L2.1", replay.outcome.ok === true && replay.outcome.replayed === true, "an exact replay reports replayed=true");
  check("L2.2", replay.outcome.importJobId === jobId, "and resolves to the same import job");
  const after = await snapshotRowCounts(t);
  check("L2.3", JSON.stringify(before) === JSON.stringify(after), "and creates no row anywhere");
  check("L2.4", (await t.readJob(jobId)).commit_attempts === 1, "and does not count as another attempt");

  // ---- L3: the same job may not be committed with a different payload ------
  const tampered = await tamperedCommit(t, ctx, jobId, scope);
  check("L3.1", tampered.ok === false, `a changed payload under the staged identity is refused (${tampered.ok ? "accepted" : tampered.code})`);
  check("L3.2", tampered.code === "COMMITTED_PAYLOAD_DIFFERS", `with COMMITTED_PAYLOAD_DIFFERS (${tampered.code})`);
  check("L3.3", JSON.stringify(await snapshotRowCounts(t)) === JSON.stringify(after), "and writes nothing");
  check("X6a", safeOutcome(tampered).clean, "the refusal carries no respondent value and no PostgreSQL message");

  // ---- L6: rollback removes exactly what the package created ---------------
  console.log("\n[core] rollback");
  const otherScope = await t.createStudy("unrelated");
  const unrelated = await runCanonicalCommit(t, {
    tenantId: otherScope.tenant,
    studyId: otherScope.studyId,
    files: [ctx.cleanFile, ctx.painFile],
  });
  check("L6.0", unrelated.ok === true, `a second, unrelated study commits too (${unrelated.ok ? "ok" : unrelated.code})`);
  const assetsBefore = await t.count("source_asset");
  const jobAssetsBefore = await t.count("import_job_asset");
  const unrelatedRows = await t.count("study_participant", { study_id: otherScope.studyId });

  const reverted = await runCanonicalRollback(t, jobId, null);
  check("L6.1", reverted.ok === true, `the rollback succeeds (${reverted.ok ? "ok" : reverted.code})`);
  check("L6.2", await t.count("study_participant", { study_id: scope.studyId }) === 0, "the package's participants are gone");
  check("L6.3", await t.count("source_lineage", { import_job_id: jobId }) === 0, "its lineage is gone");
  check("L6.4", await t.count("import_job_record", { import_job_id: jobId }) === 0, "its ledger is empty");
  check(
    "L6.5",
    await t.count("study_participant", { study_id: otherScope.studyId }) === unrelatedRows,
    "the unrelated study is untouched",
  );
  check("L6.6", await t.count("source_asset") === assetsBefore, "source assets survive as provenance");
  check("L6.7", await t.count("import_job_asset") === jobAssetsBefore, "and so do the job's asset links");
  const afterRollback = await t.readJob(jobId);
  check("L6.8", afterRollback.status === "rolled_back", `the audit job survives as 'rolled_back' (${afterRollback.status})`);
  check("L6.9", afterRollback.has_rolled_back_at && afterRollback.rollback_count === 1, "with a timestamp and a count");
  check(
    "L6.10",
    await t.count("person_private", { tenant_id: otherScope.tenant }) > 0,
    "the unrelated tenant keeps every one of its own identities",
  );
  check(
    "L6.11",
    await t.count("person_private", { tenant_id: scope.tenant }) === 0,
    "while the reversed package's own, unshared identities are gone",
  );

  // ---- L7: repeating the rollback is a no-op -------------------------------
  const countsAfterRollback = await snapshotRowCounts(t);
  const again = await runCanonicalRollback(t, jobId, null);
  check("L7.1", again.ok === true && again.replayed === true, "a repeated rollback reports replayed=true");
  check("L7.2", JSON.stringify(await snapshotRowCounts(t)) === JSON.stringify(countsAfterRollback), "and changes nothing");
  check("L7.3", (await t.readJob(jobId)).rollback_count === 1, "and does not count as a second rollback");

  // ---- L8: committing again after a rollback -------------------------------
  const recommitted = await commitPackage(t, ctx, scope);
  check("L8.1", recommitted.ok !== false || recommitted.outcome.ok === true, "a package commits again after being reversed");
  check("L8.2", recommitted.outcome.ok === true && recommitted.outcome.replayed === false, "as a real commit, not a replay");
  if (recommitted.outcome.ok) {
    const rejob = await t.readJob(jobId);
    check("L8.3", rejob.status === "committed" && rejob.commit_attempts === 2, `attempt 2 is recorded (${rejob.commit_attempts})`);
    check("L8.4", await t.duplicateParticipations(scope.studyId) === 0, "and produces no duplicate participation");
  }

  // ---- L4/L5: an injected mid-commit failure, then a retry -----------------
  // A healthy database cannot be made to fail halfway through a commit from
  // outside; this needs DDL, and a transport without it says so.
  await needs(
    t,
    "ddl",
    ["L4.1", "L4.2", "L4.3", "L4.4", "L4.5", "L4.6", "L4.7", "L4.8", "X6b", "X6c", "L5.1", "L5.2", "L5.3", "L5.4"],
    "an injected mid-commit failure needs DDL on the target",
    async () => {
      console.log("\n[core] injected mid-commit failure and retry");
      await runCanonicalRollback(t, jobId, null);
      const retryScope = await t.createStudy("retry");
      // `pain_point` is written LATE, after persons, participants, attributes,
      // sessions and responses. A constraint that refuses every row therefore
      // fails the commit halfway through, which is exactly the case the
      // subtransaction exists for.
      await t.sql("alter table public.pain_point add constraint tmp_injected_failure check (false) not valid;");
      const failedRun = await commitPackage(t, ctx, retryScope);
      check("L4.1", failedRun.outcome.ok === false, `a mid-commit failure is reported as a failure (${failedRun.outcome.ok ? "accepted" : failedRun.outcome.code})`);
      check("L4.2", failedRun.outcome.status === "failed", `and recorded as 'failed' (${failedRun.outcome.status})`);
      const failedJobId = failedRun.outcome.importJobId;
      const failedJob = failedJobId ? await t.readJob(failedJobId) : null;
      check("L4.3", failedJob?.status === "failed", `the job says 'failed' (${failedJob?.status})`);
      check("L4.4", failedJob?.last_error_code === "DATABASE_CONSTRAINT", `with a safe code (${failedJob?.last_error_code})`);
      check(
        "L4.5",
        await t.count("study_participant", { study_id: retryScope.studyId }) === 0,
        "not one participant of the failed attempt survives",
      );
      const strayFamilies = await filterAsync(
        Object.values(FAMILY_TABLE),
        async (table) =>
          table !== "person_private" &&
          table !== "person_external_identifier" &&
          (await t.count(table, { study_id: retryScope.studyId })) > 0,
      );
      check("L4.6", strayFamilies.length === 0, `zero partial rows in EVERY family${strayFamilies.length ? ` (${strayFamilies.join(", ")})` : ""}`);
      check("L4.7", await t.count("import_job_record", { import_job_id: failedJobId }) === 0, "and the ledger is empty");
      check("L4.8", await t.count("source_lineage", { import_job_id: failedJobId }) === 0, "and no lineage was left behind");
      check("X6b", safeOutcome(failedRun.outcome).clean, "the failure carries no respondent value and no PostgreSQL message");
      check(
        "X6c",
        !SENTINEL_PATTERN.test(JSON.stringify(failedJob?.error_report ?? {})),
        "and neither does what was stored on the job",
      );

      await t.sql("alter table public.pain_point drop constraint tmp_injected_failure;");
      const retried = await commitPackage(t, ctx, retryScope);
      check("L5.1", retried.outcome.ok === true, `the retry succeeds (${retried.outcome.ok ? "ok" : retried.outcome.code})`);
      check("L5.2", retried.outcome.replayed === false, "as a real commit");
      const retryJob = await t.readJob(retried.outcome.importJobId ?? failedJobId);
      check("L5.3", retryJob.commit_attempts === 2, `and is attempt 2 of the same job (${retryJob.commit_attempts})`);
      check("L5.4", await t.duplicateParticipations(retryScope.studyId) === 0, "exactly once, with no duplicate rows");
    },
  );

  // ---- L10: a count that disagrees ----------------------------------------
  console.log("\n[core] refusals");
  const mismatchScope = await t.createStudy("counts");
  const mismatch = await commitWithMutatedPlan(t, ctx, mismatchScope, (plan) => {
    plan.expectedCounts.surveyResponses += 1;
  });
  check("L10.1", mismatch.ok === false, `a declared count that disagrees is refused (${mismatch.ok ? "accepted" : mismatch.code})`);
  check("L10.2", mismatch.code === "COUNT_MISMATCH", `with COUNT_MISMATCH (${mismatch.code})`);
  check(
    "L10.3",
    await t.count("study_participant", { study_id: mismatchScope.studyId }) === 0,
    "and no part of the package survives",
  );

  // ---- L11: malformed payloads -------------------------------------------
  const malformedScope = await t.createStudy("malformed");
  const notArray = await commitWithMutatedPlan(t, ctx, malformedScope, (plan) => {
    plan.painPoints = { not: "an array" };
  });
  check("L11.1", notArray.ok === false && notArray.code === "PLAN_FAMILY_NOT_ARRAY", `a family that is not an array is refused (${notArray.code})`);
  const notObject = await rawCommit(t, ctx, malformedScope, "[]");
  check("L11.2", notObject.code === "PLAN_NOT_OBJECT", `a plan that is not an object is refused (${notObject.code})`);
  check(
    "L11.3",
    await t.count("study_participant", { study_id: malformedScope.studyId }) === 0,
    "and neither writes anything",
  );

  // ---- L12: foreign tenant and study --------------------------------------
  const foreignScope = await t.createStudy("foreign");
  const foreignTenantRows = await t.count("study_participant", { tenant_id: foreignScope.tenant });
  const foreignTenant = await commitWithMutatedPlan(t, ctx, mismatchScope, (plan) => {
    plan.tenantId = foreignScope.tenant;
  });
  check("L12.1", foreignTenant.ok === false && foreignTenant.code === "TENANT_SCOPE_MISMATCH", `a foreign tenant is refused (${foreignTenant.code})`);
  const foreignStudy = await commitWithMutatedPlan(t, ctx, mismatchScope, (plan) => {
    plan.studyId = foreignScope.studyId;
  });
  check("L12.2", foreignStudy.ok === false && foreignStudy.code === "STUDY_SCOPE_MISMATCH", `a foreign study is refused (${foreignStudy.code})`);
  check(
    "L12.3",
    await t.count("study_participant", { tenant_id: foreignScope.tenant }) === foreignTenantRows,
    "and the foreign tenant is unchanged",
  );

  // ---- L13: lineage citing a role the job does not carry ------------------
  const roleScope = await t.createStudy("assetrole");
  const strayRole = await commitWithMutatedPlan(t, ctx, roleScope, (plan) => {
    plan.sourceLineage[0].sourceAssetRole = "a_role_this_job_does_not_have";
  });
  check("L13.1", strayRole.ok === false, `lineage citing an unattached role is refused (${strayRole.ok ? "accepted" : strayRole.code})`);
  check("L13.2", strayRole.code === "ASSET_ROLE_UNKNOWN", `with ASSET_ROLE_UNKNOWN (${strayRole.code})`);
  check(
    "L13.3",
    await t.count("study_participant", { study_id: roleScope.studyId }) === 0,
    "and nothing was written",
  );

  // ---- EXTRA: duplicate asset roles ---------------------------------------
  const dupScope = await t.createStudy("duproles");
  const duplicateRole = await stageWithMutatedRequest(t, ctx, dupScope, (request) => {
    request.assets[1].role = request.assets[0].role;
  });
  check(
    "X2",
    duplicateRole.ok === false,
    `two assets claiming one role cannot build an ambiguous asset map (${duplicateRole.ok ? "accepted" : duplicateRole.code})`,
  );
  const sameAssetTwice = await stageWithMutatedRequest(t, ctx, dupScope, (request) => {
    request.assets[1] = { ...request.assets[0], role: "curated_pain_map" };
  });
  check(
    "X2b",
    sameAssetTwice.ok === false && sameAssetTwice.code === "ASSET_SET_NOT_DISTINCT",
    `one file claiming two roles is refused by NAME, not by a cardinality violation (${sameAssetTwice.code})`,
  );

  // ---- EXTRA: a rollback that fails leaves the package committed ----------
  await needs(
    t,
    "ddl",
    ["X3.1", "X3.2", "X3.3", "X3.4", "X3.5"],
    "obstructing a rollback needs a trigger, which needs DDL",
    async () => {
      console.log("\n[core] a rollback that cannot finish");
      const guardScope = await t.createStudy("rbfail");
      const guarded = await commitPackage(t, ctx, guardScope);
      if (!guarded.outcome.ok) {
        bad("X3.1", "could not commit the package the rollback-failure case needs");
        return;
      }
      const guardedJob = guarded.outcome.importJobId;
      await t.sql(
        `create function public.tmp_block_delete() returns trigger language plpgsql as $$
           begin raise exception using errcode = '55000', message = 'TMP_BLOCKED'; end $$;
         create trigger tmp_block_pain before delete on public.pain_point
           for each row execute function public.tmp_block_delete();`,
      );
      const blocked = await runCanonicalRollback(t, guardedJob, null);
      check("X3.1", blocked.ok === false, `a rollback that cannot finish reports failure (${blocked.ok ? "claimed success" : blocked.code})`);
      const stillCommitted = await t.readJob(guardedJob);
      check("X3.2", stillCommitted.status === "committed", `the job is NOT marked rolled_back (${stillCommitted.status})`);
      check(
        "X3.3",
        await t.count("import_job_record", { import_job_id: guardedJob }) > 0,
        "and its owned rows are still identified by the ledger",
      );
      check(
        "X3.4",
        await t.count("study_participant", { study_id: guardScope.studyId }) > 0,
        "and the canonical rows are still there",
      );
      await t.sql("drop trigger tmp_block_pain on public.pain_point; drop function public.tmp_block_delete();");
      const unblocked = await runCanonicalRollback(t, guardedJob, null);
      check("X3.5", unblocked.ok === true, "and the rollback completes once the obstruction is gone");
    },
  );
}

// ---- L9 plus the shared-identity cases ------------------------------------
export async function sharingSuite(t, ctx) {
  const { check, bad, needs } = ctx.ledger;
  console.log("\n[sharing] concurrency, shared identities and retention");
  await t.prepare();
  const studyA = await t.createStudy("sharea");

  // Two studies of the SAME tenant import the same people. The second reuses
  // every person, which is what makes rollback's retention rule observable.
  const first = await commitPackage(t, ctx, studyA);
  check("X4.0", first.outcome.ok === true, `study A commits (${first.outcome.ok ? "ok" : first.outcome.code})`);
  const personsAfterA = await t.count("person_private");

  const studyB = { tenant: studyA.tenant, studyId: await t.createStudyInTenant(studyA.tenant, "shareb") };
  const second = await commitPackage(t, ctx, studyB);
  check("X4.1", second.outcome.ok === true, `study B of the same tenant commits (${second.outcome.ok ? "ok" : second.outcome.code})`);
  check("X4.2", await t.count("person_private") === personsAfterA, "and creates no new person — it reuses study A's identities");
  const reused = await t.count("import_job_record", {
    import_job_id: second.outcome.importJobId,
    target_table: "person_private",
    ownership: "reused",
  });
  check("X4.3", reused === personsAfterA, `the ledger records ${reused} reused identities`);

  const revertA = await runCanonicalRollback(t, first.outcome.importJobId, null);
  check("X4.4", revertA.ok === true, "study A is reversed");
  check("X4.5", await t.count("person_private") === personsAfterA, "and every shared person is retained, not destroyed");
  check("X4.6", revertA.retainedSharedIdentities === personsAfterA, `and the retention is reported (${revertA.retainedSharedIdentities})`);
  check(
    "X4.7",
    await t.count("study_participant", { study_id: studyB.studyId }) > 0,
    "study B still has its participations",
  );

  const recommitA = await commitPackage(t, ctx, studyA);
  check("X5.1", recommitA.outcome.ok === true, `study A commits again over the retained identities (${recommitA.outcome.ok ? "ok" : recommitA.outcome.code})`);
  check("X5.2", await t.count("person_private") === personsAfterA, "still creating no new person");
  const reusedAgain = await t.count("import_job_record", {
    import_job_id: recommitA.outcome.importJobId,
    target_table: "person_private",
    ownership: "reused",
  });
  check("X5.3", reusedAgain === personsAfterA, "and recording all of them as reused this time");

  // ---- L9: two genuinely concurrent sessions ------------------------------
  await needs(
    t,
    "concurrentSessions",
    ["L9.1", "L9.2", "L9.3", "L9.4", "L9.5"],
    "a deterministic race needs one session to hold the job lock while another waits",
    async () => {
      console.log("\n[sharing] two concurrent commits");
      const raceScope = { tenant: studyA.tenant, studyId: await t.createStudyInTenant(studyA.tenant, "race") };
      const captured = await projectAndStage(t, ctx, raceScope);
      if (!captured.plan) {
        bad("L9.1", "could not stage the package the concurrency case needs");
        return;
      }
      const [runA, runB] = await t.raceCommit({ jobId: captured.jobId, plan: captured.plan });
      check("L9.1", runA.completed && runB.completed, `both sessions completed (${runA.code}, ${runB.code})`);
      const outcomes = [runA.result, runB.result];
      const committedCount = outcomes.filter((r) => r?.status === "committed" && r?.replayed === false).length;
      const replayedCount = outcomes.filter((r) => r?.replayed === true).length;
      check("L9.2", committedCount === 1, `exactly one session committed (${committedCount})`);
      check("L9.3", replayedCount === 1, `and the other replayed (${replayedCount})`);
      check("L9.4", await t.duplicateParticipations(raceScope.studyId) === 0, "and the row counts equal a single commit");
      check("L9.5", (await t.readJob(captured.jobId)).commit_attempts === 1, "with one recorded attempt");
    },
  );
}

// ---- L14 and L15 -----------------------------------------------------------
export async function securitySuite(t, ctx) {
  const { check, needs } = ctx.ledger;
  console.log("\n[security] privileges, search paths and browser-role denial");
  await t.prepare();

  await needs(
    t,
    "roleSwitch",
    ["L14.1", "L14.2", "L14.3"],
    "a privilege probe needs a second identity",
    async () => {
      for (const role of ["anon", "authenticated"]) {
        for (const fn of FUNCTIONS) {
          const state = await t.probeFunctionExecute(role, fn.name, fn);
          check("L14.1", state === "42501", `${role} cannot execute ${fn.name} (sqlstate ${state ?? "none — IT SUCCEEDED"})`);
        }
      }

      // service_role must be able to execute the two operations the server performs.
      for (const name of ["stage_canonical_package", "commit_canonical_package", "rollback_canonical_package"]) {
        const fn = FUNCTIONS.find((entry) => entry.name === name);
        const sqlstate = await t.probeFunctionExecute("service_role", name, fn);
        // A missing job is P0002 / 42501-free: the point is that EXECUTE was allowed.
        check("L14.2", sqlstate !== "42501", `service_role may execute ${name} (sqlstate ${sqlstate ?? "none"})`);
      }

      // Direct table access by a browser role must be denied on the new tables too.
      for (const table of ["import_job_record", "retention_period", "person_private", "survey_response"]) {
        for (const role of ["anon", "authenticated"]) {
          const sqlstate = await t.probeTableRead(role, table);
          check("L14.3", sqlstate === "42501", `${role} cannot read public.${table} (sqlstate ${sqlstate ?? "none — IT SUCCEEDED"})`);
        }
      }
    },
  );

  // ---- L15: definer, empty search path, exact grants ----------------------
  await needs(
    t,
    "catalogue",
    ["L15.1", "L15.2", "L15.3", "L15.4", "L15.5", "L15.6", "L15.7", "L15.8"],
    "function ACLs, search paths and RLS flags live in pg_catalog",
    async () => {
      const facts = await t.functionFacts(FUNCTIONS.map((fn) => fn.name));
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
      const tables = await t.tableSecurityFacts(["import_job_record", "retention_period"]);
      for (const table of tables ?? []) {
        check("L15.7", table.rls && table.force, `${table.name} has RLS and FORCE RLS`);
        check("L15.8", Number(table.policies) === 1, `${table.name} carries its deny-browser-roles policy`);
      }
    },
  );
}

// ---- L16 plus the rollback-refusal case ------------------------------------
export async function catalogueSuite(t, ctx) {
  const { check, needs, skip } = ctx.ledger;
  const ROLLBACK_FILE = "0024_drop_canonical_commit_and_rollback.sql";

  await needs(
    t,
    "ddl",
    ["L16.1", "L16.2", "X7.0", "X7.1", "X7.2", "X7.3", "X7.4", "X7.5"],
    "applying and reversing a migration needs DDL on the target",
    async () => {
      if (!t.capabilities.catalogue) {
        for (const id of ["L16.1", "L16.2", "X7.4"]) skip(id, "catalogue", "a catalogue comparison needs pg_catalog");
      }
      console.log("\n[catalogue] 0024 applied, reversed, and compared to the 0023 state");
      await t.prepare(23);
      const before = t.capabilities.catalogue ? await t.catalogueSnapshot() : null;
      await t.applyMigration("0024");
      if (t.capabilities.catalogue) {
        const withUnit3 = await t.catalogueSnapshot();
        check(
          "L16.1",
          JSON.stringify(before) !== JSON.stringify(withUnit3),
          "applying 0024 actually changes the catalogue",
        );
      }

      await t.applyRollback(ROLLBACK_FILE);
      if (t.capabilities.catalogue) {
        const after = await t.catalogueSnapshot();
        const differences = diffCatalogue(before, after);
        check(
          "L16.2",
          differences.length === 0,
          `reversing 0024 restores the exact 0023 catalogue${differences.length ? ` (${differences.slice(0, 4).join("; ")})` : ""}`,
        );
      }

      // EXTRA: the reverse script must refuse while a package still owns rows.
      console.log("\n[catalogue] the reverse script refuses to orphan owned rows");
      await t.applyMigration("0024");
      const scope = await t.createStudy("guard");
      const committed = await commitPackage(t, ctx, scope);
      check("X7.0", committed.outcome.ok === true, `a package is committed (${committed.outcome.ok ? "ok" : committed.outcome.code})`);
      let refusedState = null;
      let refusedMessage = "";
      try {
        await t.applyRollback(ROLLBACK_FILE);
      } catch (thrown) {
        refusedState = thrown.sqlstate;
        refusedMessage = thrown.databaseMessage ?? "";
      }
      check("X7.1", refusedState === "55000", `the reverse script refuses (sqlstate ${refusedState ?? "none — IT RAN"})`);
      if (t.capabilities.rawErrorText) {
        check(
          "X7.2",
          /CANONICAL_PACKAGES_STILL_OWNED/.test(refusedMessage),
          "naming the reason, not a constraint violation",
        );
      } else {
        skip("X7.2", "rawErrorText", "the database's own message text is not returned by this transport");
      }
      check(
        "X7.3",
        await t.count("import_job_record") > 0 && await t.count("study_participant") > 0,
        "and the ledger and the canonical rows are both still there",
      );
      if (t.capabilities.catalogue) {
        const stillPresent = await t.objectsPresent();
        check("X7.4", stillPresent.ledger === true && stillPresent.fn === true, "nothing was dropped by the refused run");
      }

      await runCanonicalRollback(t, committed.outcome.importJobId, null);
      let secondState = null;
      try {
        await t.applyRollback(ROLLBACK_FILE);
      } catch (thrown) {
        secondState = thrown.sqlstate;
      }
      check("X7.5", secondState === null, `and it succeeds once the package is reversed (${secondState ?? "ok"})`);
    },
  );
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
// X8.1 is the ONE assertion the local transport structurally cannot settle: it
// hands the server a file path, so it measures the plan's size without ever
// putting it on a wire. Over a REST transport the same assertion is the first
// real evidence about a request-body limit.
export async function realPackageSuite(t, ctx) {
  const ledger = ctx.ledger;
  const { check } = ledger;
  if (!ctx.realFiles) {
    console.log("\n[real] SKIPPED — set CANONICAL_COMMIT_TEST_CLEAN_XLSX and _PAIN_XLSX to run it");
    ledger.skip("X8", "realWorkbooks", "real-package boundary not requested");
    return;
  }
  console.log("\n[real] the complete package across the serialization boundary");
  await t.prepare();
  const scope = await t.createStudy("realpkg");
  const started = process.hrtime.bigint();
  const outcome = await runCanonicalCommit(t, {
    tenantId: scope.tenant,
    studyId: scope.studyId,
    files: ctx.realFiles,
  });
  const elapsed = Number(process.hrtime.bigint() - started) / 1e6;
  check("X8.1", outcome.ok === true, `the real package commits (${outcome.ok ? "ok" : outcome.code})`);
  if (!outcome.ok) return;

  const rows = await sumRows(t);
  const lineage = await t.count("source_lineage");
  check("X8.2", rows > 0 && lineage > 0, `${rows} canonical rows and ${lineage} lineage rows`);
  check(
    "X8.3",
    Number(outcome.counts.measured.persons) === 60 && Number(outcome.counts.measured.surveyResponses) === 1685,
    `the database measured the documented totals (persons=${outcome.counts.measured.persons}, responses=${outcome.counts.measured.surveyResponses})`,
  );

  const rollbackStarted = process.hrtime.bigint();
  const reverted = await runCanonicalRollback(t, outcome.importJobId, null);
  const rollbackMs = Number(process.hrtime.bigint() - rollbackStarted) / 1e6;
  check("X8.4", reverted.ok === true, `and reverses completely (${reverted.ok ? "ok" : reverted.code})`);
  check("X8.5", (await sumRows(t)) === 0, "leaving zero canonical rows");

  const commitCall = ctx.journal?.find((entry) => entry.name === "commit_canonical_package");
  ledger.timings.push(
    `real package: plan ${describeBytes(ctx.journal ?? [])} · whole commit ${elapsed.toFixed(0)} ms ` +
      `(RPC ${commitCall ? commitCall.ms.toFixed(0) : "?"} ms) · rollback ${rollbackMs.toFixed(0)} ms · ` +
      `${rows} canonical rows · ${lineage} lineage rows`,
  );
}

function describeBytes(journal) {
  const entry = journal.find((e) => e.name === "commit_canonical_package");
  return entry?.bytes ? `${(entry.bytes / 1048576).toFixed(2)} MiB (${entry.bytes} bytes)` : "unmeasured";
}

/** The suites, in the order a run executes them. */
export const SUITES = Object.freeze([
  { label: "core", run: coreSuite },
  { label: "sharing", run: sharingSuite },
  { label: "security", run: securitySuite },
  { label: "catalogue", run: catalogueSuite },
  { label: "realpkg", run: realPackageSuite },
]);
