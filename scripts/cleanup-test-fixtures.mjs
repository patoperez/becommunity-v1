// =============================================================================
// Fase 6 cleanup — remove ALL test fixtures so the database is pristine (§3.1).
//   node --env-file=.env.local scripts/cleanup-test-fixtures.mjs
// =============================================================================
// Deletes the test auth users and the two TEST tenants. FK cascades (migration
// 0000) then remove every dependent row: deleting a tenant cascades its studies,
// respondents, quant_response, qual_observation and client profiles; deleting an
// auth user cascades its profile. Afterwards it verifies every public table is
// empty and strips the TEST_* block from .env.local.
//
// This is destructive and intentional — it only targets the known test fixtures
// created by the seed scripts.
// =============================================================================

import { createClient } from "@supabase/supabase-js";
import { readFileSync, writeFileSync } from "node:fs";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceRole) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(2);
}
const admin = createClient(url, serviceRole, { auth: { persistSession: false } });

const TEST_EMAILS = [
  "test-tenant-a@becommunity.test",
  "test-tenant-b@becommunity.test",
  "test-internal@becommunity.test",
];
const TEST_TENANT_NAMES = ["Colegio Alfa (TEST A)", "Colegio Beta (TEST B)"];

async function deleteTestUsers() {
  let removed = 0;
  let page = 1;
  const toDelete = [];
  for (;;) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw new Error(`listUsers: ${error.message}`);
    for (const u of data.users) if (TEST_EMAILS.includes(u.email)) toDelete.push(u);
    if (data.users.length < 200) break;
    page += 1;
  }
  for (const u of toDelete) {
    const { error } = await admin.auth.admin.deleteUser(u.id);
    if (error) throw new Error(`deleteUser ${u.email}: ${error.message}`);
    console.log(`  deleted auth user: ${u.email}`);
    removed += 1;
  }
  return removed;
}

async function deleteTestTenants() {
  let removed = 0;
  for (const name of TEST_TENANT_NAMES) {
    const { data, error } = await admin.from("tenant").delete().eq("name", name).select("id");
    if (error) throw new Error(`delete tenant '${name}': ${error.message}`);
    if (data && data.length) {
      console.log(`  deleted tenant: ${name} (${data.length})`);
      removed += data.length;
    }
  }
  return removed;
}

async function verifyEmpty() {
  const tables = ["tenant", "profiles", "study", "respondent", "quant_response", "qual_observation", "segment_dimension", "journey_definition"];
  let dirty = 0;
  for (const t of tables) {
    const { count, error } = await admin.from(t).select("*", { count: "exact", head: true });
    if (error) throw new Error(`count ${t}: ${error.message}`);
    const n = count ?? 0;
    console.log(`  ${t.padEnd(18)} rows = ${n}`);
    if (n > 0) dirty += n;
  }
  // Auth users
  const { data } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
  const remainingTest = (data?.users ?? []).filter((u) => TEST_EMAILS.includes(u.email));
  console.log(`  auth users (total)  = ${data?.users.length ?? 0}; remaining test users = ${remainingTest.length}`);
  return dirty === 0 && remainingTest.length === 0;
}

function stripTestEnv() {
  const path = ".env.local";
  const before = readFileSync(path, "utf8");
  const after = before.replace(/\n# --- TEST FIXTURES[\s\S]*$/, "\n");
  if (after !== before) {
    writeFileSync(path, after.trimEnd() + "\n");
    console.log("  removed TEST_* block from .env.local");
  } else {
    console.log("  no TEST_* block found in .env.local");
  }
}

async function main() {
  console.log("Deleting test users…");
  const u = await deleteTestUsers();
  console.log("Deleting test tenants (cascades all data)…");
  const t = await deleteTestTenants();

  console.log("\nVerifying database is pristine…");
  const clean = await verifyEmpty();

  console.log("\nCleaning .env.local…");
  stripTestEnv();

  console.log("\n" + "=".repeat(60));
  console.log(`Removed ${u} test user(s), ${t} test tenant(s).`);
  if (!clean) { console.error("RESULT: database is NOT empty — review above."); process.exit(1); }
  console.log("RESULT: database is pristine and ready for real data.");
}

main().catch((e) => { console.error("Cleanup failed:", e.message); process.exit(1); });
