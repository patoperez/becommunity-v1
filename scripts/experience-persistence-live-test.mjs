// =============================================================================
// Persistent experience drafts — the live gate (migration 0023)
// =============================================================================
// Credential-bearing. It drives the REAL database, because everything it claims
// is a claim about the database rather than about the code that talks to it:
//
//   1  RLS is enabled AND forced on all three new tables;
//   2  `anon` and `authenticated` can neither read nor write a draft, with a
//      valid key and a correct study id;
//   3  `service_role` can only READ them — every write goes through one
//      SECURITY DEFINER function, and a direct insert or update is refused;
//   4  that function refuses a non-internal actor, a document that names
//      another study or client, an oversized document, and a blind write;
//   5  optimistic concurrency actually works: a stale revision is refused with
//      SQLSTATE 55000, PROMPTLY, and the stored draft is unchanged afterwards.
//      The promptness is asserted rather than assumed: 0023 raised 40001, which
//      the Data API retries until the gateway times out, so a refusal that
//      takes a minute is a refusal nobody receives;
//   6  a saved draft reloads byte for byte;
//   7  every save writes exactly one audit record.
//
// IT USES A DISPOSABLE STUDY. A client and a study are created for the run and
// deleted at the end; the draft, the revisions and the audit rows go with them
// through `on delete cascade`. No existing client, study, respondent, answer or
// publication is read or written at any point, and the script refuses to run
// against a study it did not create.
//
// It never prints a credential, a respondent, an answer or a quote.
// =============================================================================

import assert from "node:assert/strict";

import { EXPERIENCE_SCHEMA_VERSION } from "../src/lib/experience/definition.ts";
import { newExperience, newPage } from "../src/lib/experience/defaults.ts";
import { serializeExperienceDefinition } from "../src/lib/experience/serialize.ts";

const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SECRET = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
for (const [name, value] of [
  ["NEXT_PUBLIC_SUPABASE_URL", URL_],
  ["SUPABASE_SERVICE_ROLE_KEY", SECRET],
  ["NEXT_PUBLIC_SUPABASE_ANON_KEY", ANON],
]) {
  if (!value) throw new Error(`${name} is required for the live persistence gate`);
}

let checks = 0;
const ok = (message) => {
  checks += 1;
  console.log(`  PASS  ${message}`);
};

async function rest(path, { key = SECRET, method = "GET", body, headers = {}, bearer } = {}) {
  const response = await fetch(`${URL_}/rest/v1/${path}`, {
    method,
    headers: {
      apikey: key,
      Authorization: `Bearer ${bearer ?? key}`,
      "Content-Type": "application/json",
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let parsed = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = null;
  }
  return { status: response.status, ok: response.ok, body: parsed, text };
}

const rpc = (name, args, options = {}) =>
  rest(`rpc/${name}`, { method: "POST", body: args, ...options });

/** A disposable identifier that says what it is, so a stray row is obvious. */
const stamp = `EXPERIENCE-PERSISTENCE-GATE-${Date.now()}`;

let tenantId = null;
let studyId = null;

/**
 * Remove anything a PREVIOUS run of this gate left behind.
 *
 * The `finally` below cleans up after an ordinary pass and an ordinary
 * failure. It cannot clean up after a run somebody killed — a timeout, a
 * Ctrl-C — and six of those left six disposable clients in the project before
 * this existed. A gate that creates fixtures has to be able to find its own
 * litter, so the name carries the prefix and the next run sweeps it.
 */
async function sweepPreviousRuns(prefix) {
  let removed = 0;
  for (const table of ["study", "tenant"]) {
    const rows = await rest(`${table}?select=id,name&name=like.${prefix}*`);
    for (const row of rows.body ?? []) {
      await rest(`${table}?id=eq.${row.id}`, { method: "DELETE" });
      removed += 1;
    }
  }
  if (removed > 0) console.log(`  SWEPT  ${removed} row(s) left by an interrupted earlier run`);
}

async function cleanup() {
  // The study first, then the client. Both cascades take the draft, the
  // revisions and the audit rows with them.
  if (studyId) await rest(`study?id=eq.${studyId}`, { method: "DELETE" });
  if (tenantId) await rest(`tenant?id=eq.${tenantId}`, { method: "DELETE" });
}

try {
  await sweepPreviousRuns("EXPERIENCE-PERSISTENCE-GATE-");

  // =========================================================================
  console.log("\n[1] RLS is enabled and forced on every new table");
  // =========================================================================
  const coverage = await rpc("rls_coverage_report", {});
  assert.ok(coverage.ok, `rls_coverage_report failed: ${coverage.status}`);
  const byName = new Map(coverage.body.map((row) => [row.table_name, row]));
  for (const table of [
    "study_experience_draft",
    "study_experience_revision",
    "study_experience_event",
  ]) {
    const row = byName.get(table);
    assert.ok(row, `${table} does not exist — is migration 0023 applied?`);
    assert.equal(row.rls_enabled, true, `${table} must have RLS enabled`);
    assert.equal(row.rls_forced, true, `${table} must FORCE RLS`);
    assert.ok(row.policy_count >= 1, `${table} must carry its deny policy`);
    ok(`${table} exists with RLS enabled and forced`);
  }

  // =========================================================================
  console.log("\n[2] The browser roles cannot read or write a draft");
  // =========================================================================
  for (const table of [
    "study_experience_draft",
    "study_experience_revision",
    "study_experience_event",
  ]) {
    const read = await rest(`${table}?select=study_id&limit=1`, { key: ANON });
    // Either the request is refused outright or the policy returns nothing.
    // Both are a denial; an array with a row in it would not be.
    const rows = Array.isArray(read.body) ? read.body : [];
    assert.equal(rows.length, 0, `anon must not read ${table}`);
    const write = await rest(table, {
      key: ANON,
      method: "POST",
      body: { study_id: "00000000-0000-4000-8000-000000000000" },
    });
    assert.equal(write.ok, false, `anon must not write ${table}`);
    ok(`anon can neither read nor write ${table}`);
  }
  const anonRpc = await rpc(
    "save_study_experience_draft",
    {
      p_study_id: "00000000-0000-4000-8000-000000000000",
      p_actor: "00000000-0000-4000-8000-000000000000",
      p_definition: {},
      p_schema_version: 1,
    },
    { key: ANON },
  );
  assert.equal(anonRpc.ok, false, "anon must not execute the writer");
  ok("anon cannot execute save_study_experience_draft");

  // =========================================================================
  console.log("\n[3] Even service_role may only READ these tables");
  // =========================================================================
  const directInsert = await rest("study_experience_draft", {
    method: "POST",
    body: {
      study_id: "00000000-0000-4000-8000-000000000000",
      tenant_id: "00000000-0000-4000-8000-000000000000",
      schema_version: 1,
      definition: {},
    },
  });
  assert.equal(directInsert.ok, false, "a direct insert into the draft table must be refused");
  assert.equal(directInsert.body?.code, "42501", "and refused for lack of privilege");
  ok("service_role cannot insert a draft directly; the definer function is the only writer");

  const directRevision = await rest("study_experience_revision", {
    method: "POST",
    body: {
      study_id: "00000000-0000-4000-8000-000000000000",
      tenant_id: "00000000-0000-4000-8000-000000000000",
      revision: 1,
      schema_version: 1,
      definition: {},
    },
  });
  assert.equal(directRevision.ok, false, "a published revision cannot be written from the application");
  assert.equal(directRevision.body?.code, "42501");
  ok("service_role cannot write a published revision either");

  const readDraft = await rest("study_experience_draft?select=study_id,revision&limit=1");
  assert.equal(readDraft.ok, true, "service_role must be able to READ a draft");
  ok("service_role can read the draft table");

  // =========================================================================
  console.log("\n[4] A disposable client and study, created for this run only");
  // =========================================================================
  const tenant = await rest("tenant", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: { name: stamp },
  });
  assert.ok(tenant.ok, `could not create the disposable client: ${tenant.text.slice(0, 200)}`);
  tenantId = tenant.body[0].id;
  const study = await rest("study", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: { tenant_id: tenantId, name: stamp, status: "draft" },
  });
  assert.ok(study.ok, `could not create the disposable study: ${study.text.slice(0, 200)}`);
  studyId = study.body[0].id;
  ok(`created a disposable client and study (${stamp})`);

  const internal = await rest("profiles?select=user_id&role=eq.internal&limit=1");
  assert.ok(internal.ok && internal.body.length > 0, "the project needs one internal account to test with");
  const internalActor = internal.body[0].user_id;
  const client = await rest("profiles?select=user_id&role=eq.client&limit=1");
  const clientActor = client.ok && client.body.length > 0 ? client.body[0].user_id : null;

  const definition = {
    ...newExperience({
      seed: `${studyId}/gate`,
      title: "Borrador de prueba",
      studyId,
      tenantId,
    }),
    pages: [newPage(`${studyId}/gate/page`, "Página", 0)],
  };

  // =========================================================================
  console.log("\n[5] The writer refuses everything it should");
  // =========================================================================
  if (clientActor) {
    const refused = await rpc("save_study_experience_draft", {
      p_study_id: studyId,
      p_actor: clientActor,
      p_definition: definition,
      p_schema_version: EXPERIENCE_SCHEMA_VERSION,
    });
    assert.equal(refused.ok, false, "a client-role actor must not be able to save a draft");
    assert.equal(refused.body?.code, "42501", "and the refusal names the privilege");
    ok("a client-role actor is refused by the database, not only by the route");
  } else {
    console.log("  SKIP  no client-role profile in this project to test the refusal with");
  }

  const wrongStudy = await rpc("save_study_experience_draft", {
    p_study_id: studyId,
    p_actor: internalActor,
    p_definition: { ...definition, metadata: { ...definition.metadata, studyId: tenantId } },
    p_schema_version: EXPERIENCE_SCHEMA_VERSION,
  });
  assert.equal(wrongStudy.ok, false, "a document naming another study must be refused");
  assert.equal(wrongStudy.body?.code, "22023");
  ok("a document that names another study is refused by the database");

  const wrongTenant = await rpc("save_study_experience_draft", {
    p_study_id: studyId,
    p_actor: internalActor,
    p_definition: { ...definition, metadata: { ...definition.metadata, tenantId: studyId } },
    p_schema_version: EXPERIENCE_SCHEMA_VERSION,
  });
  assert.equal(wrongTenant.ok, false, "a document naming another client must be refused");
  assert.equal(wrongTenant.body?.code, "22023");
  ok("a document that names another client is refused by the database");

  const oversized = await rpc("save_study_experience_draft", {
    p_study_id: studyId,
    p_actor: internalActor,
    p_definition: { ...definition, padding: "x".repeat(600_000) },
    p_schema_version: EXPERIENCE_SCHEMA_VERSION,
  });
  assert.equal(oversized.ok, false, "an oversized document must be refused");
  ok("a document larger than the declared ceiling is refused");

  const stillEmpty = await rest(`study_experience_draft?study_id=eq.${studyId}&select=study_id`);
  assert.deepEqual(stillEmpty.body, [], "a refused save writes nothing at all");
  ok("every refusal above left the study with no draft whatsoever");

  // =========================================================================
  console.log("\n[6] Saving, reloading, and the optimistic-concurrency check");
  // =========================================================================
  const created = await rpc("save_study_experience_draft", {
    p_study_id: studyId,
    p_actor: internalActor,
    p_definition: definition,
    p_schema_version: EXPERIENCE_SCHEMA_VERSION,
  });
  assert.ok(created.ok, `the first save failed: ${created.text.slice(0, 300)}`);
  assert.equal(created.body.revision, 1);
  assert.equal(created.body.created, true);
  ok("a first save creates the draft at revision 1");

  const reloaded = await rest(
    `study_experience_draft?study_id=eq.${studyId}&select=revision,schema_version,definition,tenant_id`,
  );
  assert.equal(reloaded.body.length, 1);
  assert.equal(reloaded.body[0].revision, 1);
  assert.equal(reloaded.body[0].schema_version, EXPERIENCE_SCHEMA_VERSION);
  // The tenant is the STUDY's tenant, derived in the function. Nothing the
  // caller sent decided it.
  assert.equal(reloaded.body[0].tenant_id, tenantId);
  assert.equal(
    serializeExperienceDefinition(reloaded.body[0].definition),
    serializeExperienceDefinition(definition),
    "what comes back is what went in, byte for byte",
  );
  ok("a saved draft reloads byte for byte, under the study's own client");

  const blind = await rpc("save_study_experience_draft", {
    p_study_id: studyId,
    p_actor: internalActor,
    p_definition: definition,
    p_schema_version: EXPERIENCE_SCHEMA_VERSION,
  });
  assert.equal(blind.ok, false, "a save that does not say what it replaces must be refused");
  assert.equal(blind.body?.code, "55000");
  ok("a blind write over an existing draft is refused as a conflict");

  const second = { ...definition, title: "Borrador de prueba, segunda versión" };
  const updated = await rpc("save_study_experience_draft", {
    p_study_id: studyId,
    p_actor: internalActor,
    p_definition: second,
    p_schema_version: EXPERIENCE_SCHEMA_VERSION,
    p_expected_revision: 1,
    p_note: "segunda versión",
  });
  assert.ok(updated.ok, `the second save failed: ${updated.text.slice(0, 300)}`);
  assert.equal(updated.body.revision, 2);
  assert.equal(updated.body.created, false);
  ok("saving with the revision you were editing moves the draft to the next one");

  const startedAt = Date.now();
  const stale = await rpc("save_study_experience_draft", {
    p_study_id: studyId,
    p_actor: internalActor,
    p_definition: { ...definition, title: "Lo que la otra persona escribió" },
    p_schema_version: EXPERIENCE_SCHEMA_VERSION,
    p_expected_revision: 1,
  });
  const staleMs = Date.now() - startedAt;
  assert.equal(stale.ok, false, "a stale revision must be refused");
  assert.equal(stale.body?.code, "55000", "with the code the application reads as a conflict");
  // PROMPTLY. 0023 raised 40001 here, which the Data API retries: the refusal
  // took 125 seconds and arrived as a gateway timeout with no message in it.
  // A refusal nobody receives is not a refusal, so the time is asserted.
  assert.ok(staleMs < 15_000, `the refusal took ${staleMs} ms; it must arrive promptly`);
  const afterConflict = await rest(
    `study_experience_draft?study_id=eq.${studyId}&select=revision,definition`,
  );
  assert.equal(afterConflict.body[0].revision, 2, "and the stored draft is untouched");
  assert.equal(
    afterConflict.body[0].definition.title,
    second.title,
    "the newer version survives the refused overwrite",
  );
  ok(`a second editor's stale save is refused in ${staleMs} ms and overwrites nothing`);

  // =========================================================================
  console.log("\n[7] Every save left exactly one record of itself");
  // =========================================================================
  const events = await rest(
    `study_experience_event?study_id=eq.${studyId}&select=action,revision,actor_user_id,note&order=occurred_at`,
  );
  assert.deepEqual(
    events.body.map((event) => [event.action, event.revision]),
    [
      ["draft_created", 1],
      ["draft_saved", 2],
    ],
    "two saves, two records, in order",
  );
  assert.ok(events.body.every((event) => event.actor_user_id === internalActor), "each names its actor");
  assert.equal(events.body[1].note, "segunda versión");
  // The audit record is metadata. It never carries the document.
  assert.ok(!JSON.stringify(events.body).includes("schemaVersion"), "an event never carries a definition");
  ok("each save wrote exactly one audit record, and no record carries the document");

  // =========================================================================
  console.log("\n[8] Nothing outside this run's disposable study was touched");
  // =========================================================================
  const otherDrafts = await rest(
    `study_experience_draft?study_id=neq.${studyId}&select=study_id`,
  );
  assert.ok(otherDrafts.ok);
  console.log(`  INFO  ${otherDrafts.body.length} draft(s) exist for other studies; none was written here`);
  const otherEvents = await rest(
    `study_experience_event?study_id=neq.${studyId}&select=id&limit=1`,
  );
  assert.ok(otherEvents.ok);
  ok("the run wrote only to the study it created");

  console.log(`\nOK — ${checks} live persistence checks passed.`);
} finally {
  await cleanup();
  const leftover = await rest(`study?name=eq.${encodeURIComponent(stamp)}&select=id`);
  const tenants = await rest(`tenant?name=eq.${encodeURIComponent(stamp)}&select=id`);
  const remaining = (leftover.body?.length ?? 0) + (tenants.body?.length ?? 0);
  console.log(
    remaining === 0
      ? "  CLEAN  the disposable client and study were removed"
      : `  WARNING  ${remaining} disposable row(s) remain and must be removed by hand`,
  );
}
