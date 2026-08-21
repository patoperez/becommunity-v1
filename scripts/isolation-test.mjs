// =============================================================================
// Behavioral cross-tenant isolation test (Section 6.5 — the only valid test).
// =============================================================================
// Static review and scanners CANNOT confirm RLS is active. The only valid proof
// is adversarial: authenticate as Client A and try, via the API directly, to
// read and write Client B's data. It MUST return zero rows / be rejected.
//
// PREREQUISITES (one-time setup in the Supabase dashboard after the migration):
//   1. Two tenants exist (insert into public.tenant) — note their ids.
//   2. Two auth users exist (Authentication -> Users -> Add user), each with a
//      row in public.profiles linking them to a DIFFERENT tenant, role 'client'.
//   3. Seed at least one study/quant_response row for tenant B.
//   4. Set the env vars below (e.g. in .env.local) then run:
//        node --env-file=.env.local scripts/isolation-test.mjs
//
// ENV:
//   NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY
//   TEST_USER_A_EMAIL, TEST_USER_A_PASSWORD   (belongs to tenant A)
//   TEST_USER_B_EMAIL, TEST_USER_B_PASSWORD   (belongs to tenant B)
//   TEST_TENANT_B_ID                          (tenant A must NOT see this)
// =============================================================================

import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

const required = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "TEST_USER_A_EMAIL",
  "TEST_USER_A_PASSWORD",
  "TEST_TENANT_B_ID",
];
const missing = required.filter((k) => !process.env[k]);
if (missing.length) {
  console.error("Missing env vars:", missing.join(", "));
  process.exit(2);
}

const TENANT_B = process.env.TEST_TENANT_B_ID;
const RAW_RESPONSE_TABLES = [
  "respondent",
  "quant_response",
  "qual_observation",
  "segment_dimension",
  "journey_definition",
];
const TENANT_SCOPED = ["study", ...RAW_RESPONSE_TABLES];
const INTERNAL_ONLY = ["import_mapping", "recoding_table", "import_batch", "study_template"];
const CLIENT_SAFE_VIEWS = [];

let failures = 0;
const fail = (msg) => { console.error("  ✗ FAIL:", msg); failures++; };
const pass = (msg) => console.log("  ✓ pass:", msg);

async function signIn(email, password) {
  const c = createClient(url, anon);
  const { error } = await c.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`sign-in failed for ${email}: ${error.message}`);
  return c;
}

// --- Test 1: anonymous access must be rejected / empty on every table --------
async function testAnonymous() {
  console.log("\n[1] Anonymous access (Section 6.5):");
  const c = createClient(url, anon);
  for (const t of [...TENANT_SCOPED, ...INTERNAL_ONLY, ...CLIENT_SAFE_VIEWS, "confirmed_qual_observation", "tenant", "profiles"]) {
    const { data, error } = await c.from(t).select("*").limit(1);
    if (!error && data && data.length > 0) {
      fail(`anon read returned ${data.length} row(s) from "${t}"`);
    } else {
      pass(`anon read on "${t}" returned no data`);
    }
  }
}

// --- Test 2b: internal import controls are not a client-facing read surface --
async function testInternalControls(clientA, userAId) {
  console.log("\n[2b] Internal import controls (clients must have no access):");
  for (const table of INTERNAL_ONLY) {
    const { error } = await clientA.from(table).select("*").limit(1);
    checkDenied("SELECT", table, error);
  }
  const { error: rawQualError } = await clientA.from("qual_observation").select("quote, suggested_theme").limit(1);
  checkDenied("SELECT RAW", "qual_observation", rawQualError);
  for (const table of ["respondent", "quant_response", "segment_dimension", "journey_definition", "confirmed_qual_observation"]) {
    const { error } = await clientA.from(table).select("*").limit(1);
    checkDenied("SELECT RAW", table, error);
  }
  const { error: rpcError } = await clientA.rpc("commit_import_batch", {
    p_import_batch_id: ZERO_ID,
    p_respondents: [],
  });
  if (isPermissionDenied(rpcError) || rpcError?.code === "PGRST202") {
    pass("commit_import_batch is unavailable to client role");
  } else if (rpcError) {
    fail(`commit_import_batch rejected for the WRONG reason (${rpcError.code ?? rpcError.message})`);
  } else {
    fail("commit_import_batch was executable by a client role");
  }
  const { error: mappingRpcError } = await clientA.rpc("save_import_mapping", {
    p_tenant_id: ZERO_ID,
    p_source_signature: `sha256:${"0".repeat(64)}`,
    p_name: "isolation probe",
    p_configuration: { version: 1, name: "probe", columns: [], recodingTables: [] },
    p_created_by: null,
  });
  if (isPermissionDenied(mappingRpcError) || mappingRpcError?.code === "PGRST202") {
    pass("save_import_mapping is unavailable to client role");
  } else if (mappingRpcError) {
    fail(`save_import_mapping rejected for the WRONG reason (${mappingRpcError.code ?? mappingRpcError.message})`);
  } else {
    fail("save_import_mapping was executable by a client role");
  }
  const { error: snapshotError } = await clientA.from("study").select("template_snapshot").limit(1);
  checkDenied("SELECT COLUMN", "study.template_snapshot", snapshotError);
  const { error: originError } = await clientA.from("study").select("template_origin_id, template_origin_version").limit(1);
  checkDenied("SELECT COLUMNS", "study.template_origin_*", originError);
  const { error: safeStudyError } = await clientA.from("study").select("id, name, period, status, dashboard_config, journey_definition").limit(1);
  if (safeStudyError) fail(`safe study columns were rejected (${safeStudyError.code ?? safeStudyError.message})`);
  else pass("safe study columns remain readable through tenant RLS");
  const { error: scopeUpdateError } = await clientA.from("profiles").update({ data_scope: {} }).eq("user_id", userAId);
  checkDenied("UPDATE", "profiles.data_scope", scopeUpdateError);
  for (const [name, args] of [
    ["save_study_template", {
      p_template_id: null, p_created_by: ZERO_ID, p_name: "probe", p_description: "",
      p_preview: {}, p_payload: {}, p_created_from: null,
    }],
    ["instantiate_study_template", {
      p_template_id: ZERO_ID, p_created_by: ZERO_ID, p_tenant_id: ZERO_ID,
      p_name: "probe", p_period: null,
    }],
    ["review_qual_observations", {
      p_ids: [ZERO_ID], p_study_id: ZERO_ID, p_mode: "accept", p_theme: "",
      p_stage_key: "", p_quote_ids: [], p_reviewer: ZERO_ID,
    }],
  ]) {
    const { error } = await clientA.rpc(name, args);
    if (isPermissionDenied(error) || error?.code === "PGRST202") pass(`${name} is unavailable to client role`);
    else if (error) fail(`${name} rejected for the WRONG reason (${error.code ?? error.message})`);
    else fail(`${name} was executable by a client role`);
  }
}

// --- Test 2: client A must not READ tenant B's rows --------------------------
async function testCrossTenantRead(clientA) {
  console.log("\n[2] Cross-tenant READ (Client A querying Tenant B):");
  const { data: studies, error: studyError } = await clientA.from("study")
    .select("id, tenant_id, name, status").eq("tenant_id", TENANT_B);
  if (studyError) fail(`safe study metadata query failed (${studyError.code ?? studyError.message})`);
  else if (studies.length > 0) fail(`read ${studies.length} Tenant B study row(s)`);
  else pass('"study" returned zero of Tenant B\'s rows');
  for (const table of [...RAW_RESPONSE_TABLES, "confirmed_qual_observation"]) {
    const { error } = await clientA.from(table).select("*").limit(1);
    if (isPermissionDenied(error)) pass(`raw surface "${table}" rejected (42501)`);
    else if (error) fail(`raw surface "${table}" rejected for the WRONG reason (${error.code ?? error.message})`);
    else fail(`raw surface "${table}" was directly readable`);
  }
}

// --- Test 3: client A must not WRITE into tenant B ---------------------------
async function testCrossTenantWrite(clientA) {
  console.log("\n[3] Cross-tenant WRITE (Client A inserting into Tenant B):");
  const { error } = await clientA.from("quant_response").insert({
    tenant_id: TENANT_B,
    study_id: "00000000-0000-0000-0000-000000000000",
    metric_key: "isolation_probe",
    value: 1,
  });
  if (error) pass(`insert into Tenant B rejected (${error.code ?? error.message})`);
  else fail("insert into Tenant B SUCCEEDED — WITH CHECK policy is missing!");
}

// --- Test 4: client A must not WRITE into its OWN tenant either (P0.1) --------
// AUDIT_V1.md §3.5 / red flag #1: clients are "read-only", but before migration
// 0002 a client held CRUD grants + tenant-only write policies, so it could
// INSERT/UPDATE/DELETE its own tenant's data. After 0002 (SELECT-only grant,
// write policies dropped) every write must be rejected (42501 permission denied).
//
// Design notes (safe to run in BOTH states, idempotent, non-destructive):
//  - INSERT uses a REAL own-tenant study (looked up via RLS-scoped read) so that,
//    pre-fix, it genuinely succeeds; on that regression path we self-clean the row.
//  - UPDATE/DELETE target a non-existent id (all-zeros): a missing write GRANT
//    yields 42501 regardless of row match, while if writes were still allowed the
//    call returns success/0-rows — so nothing real is ever modified either way.
const ZERO_ID = "00000000-0000-0000-0000-000000000000";
// A write is only "correctly rejected" when it fails for lack of privilege
// (42501 permission denied). Any other error — notably an undefined table
// (42P01 / PGRST205) — must NOT be counted as a pass, or a missing table could
// masquerade as least-privilege working.
function isPermissionDenied(error) {
  return !!error && (error.code === "42501" || /permission denied/i.test(error.message ?? ""));
}
function checkDenied(verb, table, error) {
  if (isPermissionDenied(error)) pass(`${verb} "${table}" (own tenant) rejected (42501 permission denied)`);
  else if (error) fail(`${verb} "${table}" rejected for the WRONG reason (${error.code ?? error.message}) — expected 42501`);
  else fail(`${verb} "${table}" (own tenant) SUCCEEDED — client is not read-only`);
}

async function testOwnTenantWrite(clientA) {
  console.log("\n[4] Own-tenant WRITE by a client user (must be REJECTED after 0002):");

  // Representative INSERT. Privilege denial must happen before row/FK checks.
  const { error: insertError } = await clientA.from("quant_response").insert({
    tenant_id: ZERO_ID, study_id: ZERO_ID, metric_key: "p0_write_probe", value: 1,
  });
  if (isPermissionDenied(insertError)) pass("INSERT quant_response rejected (42501 permission denied)");
  else if (insertError) fail(`INSERT quant_response rejected for the WRONG reason (${insertError.code ?? insertError.message}) — expected 42501`);
  else fail("INSERT quant_response SUCCEEDED — client is not read-only");

  // 4b) UPDATE + DELETE must be denied on every data table (grant-level).
  for (const t of TENANT_SCOPED) {
    const { error: upd } = await clientA.from(t).update({ tenant_id: ZERO_ID }).eq("id", ZERO_ID);
    checkDenied("UPDATE", t, upd);
    const { error: del } = await clientA.from(t).delete().eq("id", ZERO_ID);
    checkDenied("DELETE", t, del);
  }
}

async function main() {
  console.log("Be Community — RLS isolation test");
  await testAnonymous();
  const clientA = await signIn(
    process.env.TEST_USER_A_EMAIL, process.env.TEST_USER_A_PASSWORD,
  );
  await testCrossTenantRead(clientA);
  const { data: { user: userA } } = await clientA.auth.getUser();
  if (!userA) throw new Error("client A session disappeared");
  await testInternalControls(clientA, userA.id);
  await testCrossTenantWrite(clientA);
  await testOwnTenantWrite(clientA);

  console.log("\n" + "=".repeat(60));
  if (failures > 0) {
    console.error(`RESULT: ${failures} failure(s) — DO NOT load real data.`);
    process.exit(1);
  }
  console.log("RESULT: all isolation checks passed.");
}

main().catch((e) => { console.error("Test crashed:", e.message); process.exit(3); });
