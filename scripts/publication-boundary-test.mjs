import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const migration = await readFile(new URL("../supabase/migrations/0009_client_publication_boundary.sql", import.meta.url), "utf8");
const policyReplacement = await readFile(new URL("../supabase/migrations/0010_replace_study_select_policies.sql", import.meta.url), "utf8");
const statusContract = await readFile(new URL("../supabase/migrations/0011_normalize_study_status.sql", import.meta.url), "utf8");
const loader = await readFile(new URL("../src/lib/studies/authorized.ts", import.meta.url), "utf8");
const page = await readFile(new URL("../src/app/dashboard/page.tsx", import.meta.url), "utf8");
const actions = await readFile(new URL("../src/app/dashboard/data-actions.ts", import.meta.url), "utf8");
const report = await readFile(new URL("../src/app/api/studies/[studyId]/report/route.ts", import.meta.url), "utf8");

assert.match(migration, /study\.status = 'published'/, "client RLS must expose published studies only");
assert.match(migration, /profile\.role = 'internal'/, "internal users must retain study-metadata access");
assert.match(policyReplacement, /from pg_policies/, "all historical SELECT policies must be discovered, not assumed by name");
assert.match(policyReplacement, /and cmd = 'SELECT'/, "only study SELECT policies are replaced");
assert.match(policyReplacement, /study\.status = 'published'/, "the replacement policy must preserve the publication condition");
assert.match(statusContract, /status in \('draft', 'published', 'archived'\)/, "the database must accept the canonical publication lifecycle");
for (const table of ["respondent", "quant_response", "segment_dimension", "journey_definition"]) {
  assert.match(migration, new RegExp(`'${table}'`), `${table} must be in the raw-table denial set`);
}
assert.match(migration, /revoke all privileges on table public\.confirmed_qual_observation from anon, authenticated/i);

const authorizationIndex = loader.indexOf('requestClient.from("study")');
const adminIndex = loader.indexOf("createAdminClient()");
assert.ok(authorizationIndex >= 0 && adminIndex > authorizationIndex, "RLS study authorization must happen before admin loading");
assert.match(loader, /\.eq\("id", studyId\)/, "authorization and private loading must be scoped to one exact study ID");
assert.match(loader, /quote_approved && row\.quote/, "only independently approved quotes may be loaded");

for (const [name, source] of [["dashboard", page], ["actions", actions], ["report", report]]) {
  assert.match(source, /loadAuthorizedStudyData/, `${name} must use the centralized publication boundary`);
  assert.doesNotMatch(source, /loadStudyRows|loadConfirmedQualitative/, `${name} must not read raw tables directly`);
}
assert.match(actions, /auth\.getUser\(\)/, "server actions must authenticate every request");
assert.match(report, /auth\.getUser\(\)/, "PDF route must authenticate every request");

console.log("Client publication boundary gate: PASS");
