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
const TENANT_SCOPED = [
  "study",
  "respondent",
  "quant_response",
  "qual_observation",
  "segment_dimension",
  "journey_definition",
];

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
  for (const t of [...TENANT_SCOPED, "tenant", "profiles"]) {
    const { data, error } = await c.from(t).select("*").limit(1);
    if (!error && data && data.length > 0) {
      fail(`anon read returned ${data.length} row(s) from "${t}"`);
    } else {
      pass(`anon read on "${t}" returned no data`);
    }
  }
}

// --- Test 2: client A must not READ tenant B's rows --------------------------
async function testCrossTenantRead(clientA) {
  console.log("\n[2] Cross-tenant READ (Client A querying Tenant B):");
  for (const t of TENANT_SCOPED) {
    const { data, error } = await clientA
      .from(t).select("*").eq("tenant_id", TENANT_B);
    if (error) { pass(`"${t}" rejected (${error.code ?? error.message})`); continue; }
    if (data && data.length > 0) fail(`read ${data.length} of Tenant B's rows from "${t}"`);
    else pass(`"${t}" returned zero of Tenant B's rows`);
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

async function main() {
  console.log("Be Community — RLS isolation test");
  await testAnonymous();
  const clientA = await signIn(
    process.env.TEST_USER_A_EMAIL, process.env.TEST_USER_A_PASSWORD,
  );
  await testCrossTenantRead(clientA);
  await testCrossTenantWrite(clientA);

  console.log("\n" + "=".repeat(60));
  if (failures > 0) {
    console.error(`RESULT: ${failures} failure(s) — DO NOT load real data.`);
    process.exit(1);
  }
  console.log("RESULT: all isolation checks passed.");
}

main().catch((e) => { console.error("Test crashed:", e.message); process.exit(3); });
