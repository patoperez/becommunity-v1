// =============================================================================
// Private metadata commit — live behavioral gate (credential-bearing).
//
//   npm run test:private-metadata-live
//
// WHY THIS EXISTS. Migration 0019 declared `jsonb_object_length(jsonb)`, a
// function PostgreSQL does not have. `create or replace function` accepted it,
// because PL/pgSQL only prepares a statement the first time it runs. Every
// offline gate passed and the deploy succeeded; the first person to confirm a
// real import got `function jsonb_object_length(jsonb) does not exist`.
//
// No amount of reading the migration text could have caught that. Only
// execution can. This gate EXECUTES public.commit_import_batch_with_private
// against the linked synthetic PostgreSQL through the real PostgREST path, so a
// non-existent function inside the body fails the gate again — every case below
// forces PL/pgSQL to prepare the whole guard chain, including the key count.
//
//   [1] project    the configured URL is the linked synthetic project
//   [2] accept     a real commit with 11 private fields per person writes
//                  respondents, responses, observations and private metadata
//   [3] boundary   exactly 100 private fields commit; 101 are refused
//   [4] shape      a non-object privateMetadata, a bad key, a non-string value,
//                  an oversized value and a non-array payload are all refused
//   [5] atomic     every refusal leaves zero respondents, responses and
//                  observations behind
//   [6] privilege  anon and a really-signed-in user CANNOT execute it;
//                  service_role can
//   [7] cleanup    every object this gate created is removed and proven gone
//
// All data is synthetic and created by this script under a clearly temporary
// study name. It never reads, writes or deletes a pre-existing client, study,
// user, upload or import. It prints no key, token, email or business datum.
// =============================================================================

import { readFileSync, existsSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const FUNCTION = "commit_import_batch_with_private";
const LINKED_REF_FILE = "supabase/.temp/project-ref";
const STUDY_PREFIX = "TMP_PRIVATE_METADATA_GATE_";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const secret = process.env.SUPABASE_SERVICE_ROLE_KEY;
const tenantId = process.env.TEST_TENANT_A_ID;
const internalEmail = process.env.TEST_INTERNAL_EMAIL;
const internalPassword = process.env.TEST_INTERNAL_PASSWORD;

if (!url || !anonKey || !secret || !tenantId || !internalEmail || !internalPassword) {
  console.error("Missing environment for the private metadata live gate.");
  process.exit(2);
}

let failures = 0;
const ok = (m) => console.log("  ✓", m);
const fail = (m) => {
  console.error("  x FAIL:", m);
  failures++;
};
const check = (condition, m) => (condition ? ok(m) : fail(m));
const eq = (label, actual, expected) =>
  check(Object.is(actual, expected), `${label} = ${String(expected)}${Object.is(actual, expected) ? "" : ` (got ${String(actual)})`}`);

// Every control must record an outcome; an unexecuted control fails the gate.
const CONTROLS = ["project", "accept", "boundary", "shape", "atomic", "privilege", "cleanup"];
const executed = new Set();
const ran = (name) => executed.add(name);

const admin = createClient(url, secret, { auth: { autoRefreshToken: false, persistSession: false } });

const signature = `sha256:${"c".repeat(64)}`;
const privateFields = (count, prefix = "campo") =>
  Object.fromEntries(Array.from({ length: count }, (_, i) => [`${prefix}_${i}`, `valor sintetico ${i}`]));

const respondentRow = (overrides = {}) => ({
  id: crypto.randomUUID(),
  privateMetadata: {},
  segments: { nivel: "Primaria" },
  quant: [{ metric_key: "nps", value: 9 }],
  qual: [{ source: "encuesta", category: null, theme: "tema", quote: "Comentario sintetico" }],
  ...overrides,
});

// --- [1] Project identity ----------------------------------------------------
function checkProject() {
  console.log("\n[1] Project identity:");
  if (!existsSync(LINKED_REF_FILE)) {
    fail(`${LINKED_REF_FILE} is absent — the linked synthetic project cannot be confirmed`);
    return false;
  }
  const linked = readFileSync(LINKED_REF_FILE, "utf8").trim();
  const ref = new URL(url).host.split(".")[0];
  if (!linked || ref !== linked) {
    fail("the configured Supabase URL does not belong to the linked project — refusing to continue");
    return false;
  }
  ok("the configured URL matches the linked Supabase project ref");
  ran("project");
  return true;
}

// --- Staging + invocation helpers -------------------------------------------
const stagedBatches = [];

async function stage(studyId, respondents, fileName) {
  const list = Array.isArray(respondents) ? respondents : [];
  const { data, error } = await admin
    .from("import_batch")
    .insert({
      tenant_id: tenantId,
      study_id: studyId,
      source_signature: signature,
      file_name: fileName,
      status: "staged",
      source_rows: Math.max(list.length, 1),
      expected_respondents: Math.max(list.length, 1),
      expected_quant: list.reduce((n, r) => n + (r.quant?.length ?? 0), 0),
      expected_qual: list.reduce((n, r) => n + (r.qual?.length ?? 0), 0),
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(`could not stage batch: ${error?.message ?? "unknown"}`);
  stagedBatches.push(data.id);
  return data.id;
}

async function commit(batchId, respondents) {
  const { data, error } = await admin.rpc(FUNCTION, {
    p_import_batch_id: batchId,
    p_respondents: respondents,
  });
  return { data, error };
}

async function residue(batchId) {
  const [r, q, o] = await Promise.all([
    admin.from("respondent").select("id", { count: "exact", head: true }).eq("import_batch_id", batchId),
    admin.from("quant_response").select("id", { count: "exact", head: true }).eq("import_batch_id", batchId),
    admin.from("qual_observation").select("id", { count: "exact", head: true }).eq("import_batch_id", batchId),
  ]);
  return { respondents: r.count ?? -1, quant: q.count ?? -1, qual: o.count ?? -1 };
}

// A refusal must be a refusal, not a crash: the SQLSTATE has to be the one the
// migration raises. `42883` (undefined function) would mean the defect is back.
async function expectRefusal(label, batchId, respondents, expectedCode) {
  const { data, error } = await commit(batchId, respondents);
  if (!error) {
    fail(`${label}: the commit SUCCEEDED — the guard is not enforcing`);
    return;
  }
  if (error.code === "42883") {
    fail(`${label}: refused with 42883 undefined function (${error.message}) — a function in the body does not exist`);
    return;
  }
  check(error.code === expectedCode, `${label}: refused with SQLSTATE ${expectedCode}${error.code === expectedCode ? "" : ` (got ${error.code})`}`);
  if (data) fail(`${label}: an error carried data`);
  const left = await residue(batchId);
  check(
    left.respondents === 0 && left.quant === 0 && left.qual === 0,
    `${label}: left no respondent, response or observation behind (${left.respondents}/${left.quant}/${left.qual})`,
  );
}

// --- Privilege probes over the real wire -------------------------------------
// `apikey` selects the project; `Authorization` selects the ROLE. No forged JWT,
// no header rewriting, no SET ROLE — each probe uses that role's own credential.
async function rawRpc(bearer) {
  const res = await fetch(`${url}/rest/v1/rpc/${FUNCTION}`, {
    method: "POST",
    headers: {
      apikey: anonKey,
      Authorization: `Bearer ${bearer}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({ p_import_batch_id: crypto.randomUUID(), p_respondents: [] }),
  });
  let payload = null;
  try {
    payload = await res.json();
  } catch {
    payload = null;
  }
  return { status: res.status, code: payload?.code ?? null, executed: res.ok };
}

const DENIAL_CODE = "42501";
const ABSENCE_CODES = new Set(["PGRST202", "42883"]);

function assertCannotExecute(role, r) {
  if (r.executed) {
    fail(`${role} EXECUTED ${FUNCTION} — the privilege model is broken`);
    return;
  }
  if (r.code === DENIAL_CODE) ok(`${role} rejected with an execute-permission denial (status ${r.status}, code ${r.code})`);
  else if (ABSENCE_CODES.has(r.code)) fail(`${role} got absence (status ${r.status}, code ${r.code}) — obscurity is not denial`);
  else fail(`${role} rejected for the WRONG reason (status ${r.status}, code ${r.code ?? "none"})`);
}

// --- Run ---------------------------------------------------------------------
console.log("Be Community — private metadata live gate");

if (!checkProject()) {
  console.error("\nRefusing to run against an unconfirmed project.");
  process.exit(3);
}

const studyName = `${STUDY_PREFIX}${Date.now()}`;
const { data: study, error: studyError } = await admin
  .from("study")
  .insert({ tenant_id: tenantId, name: studyName, status: "draft" })
  .select("id")
  .single();
if (studyError || !study) {
  console.error(`Could not create the temporary study: ${studyError?.message ?? "unknown error"}`);
  process.exit(3);
}

const committedBatches = [];

try {
  // --- [2] The real-world shape that failed in production --------------------
  console.log("\n[2] A commit carrying 11 private fields per person:");
  {
    const people = [respondentRow({ privateMetadata: privateFields(11) }), respondentRow({ privateMetadata: privateFields(11) })];
    const batchId = await stage(study.id, people, "acepta_11_campos.csv");
    const { data, error } = await commit(batchId, people);
    if (error) {
      fail(`the commit was refused: ${error.code} ${error.message}`);
    } else {
      committedBatches.push(batchId);
      eq("committed respondents", data?.respondents, 2);
      eq("committed quantitative responses", data?.quant, 2);
      eq("committed qualitative observations", data?.qual, 2);
      const written = await residue(batchId);
      eq("respondent rows written", written.respondents, 2);
      eq("quantitative rows written", written.quant, 2);
      eq("qualitative rows written", written.qual, 2);
      const { data: stored } = await admin
        .from("respondent")
        .select("id, private_metadata")
        .eq("import_batch_id", batchId);
      const counts = (stored ?? []).map((row) => Object.keys(row.private_metadata ?? {}).length);
      check(
        counts.length === 2 && counts.every((n) => n === 11),
        `private metadata stored with 11 keys per person (got ${JSON.stringify(counts)})`,
      );
      const first = (stored ?? [])[0]?.private_metadata ?? {};
      check(first.campo_0 === "valor sintetico 0", "the stored private value round-trips exactly");
      ran("accept");
    }
  }

  // --- [3] The limit itself --------------------------------------------------
  console.log("\n[3] The 100-key limit, at the boundary:");
  {
    const person = respondentRow({ privateMetadata: privateFields(100) });
    check(Object.keys(person.privateMetadata).length === 100, "the accepted payload really carries 100 keys");
    const batchId = await stage(study.id, [person], "acepta_100_campos.csv");
    const { error } = await commit(batchId, [person]);
    if (error) fail(`exactly 100 private fields were refused: ${error.code} ${error.message}`);
    else {
      committedBatches.push(batchId);
      ok("exactly 100 private fields are accepted");
      const { data: stored } = await admin
        .from("respondent")
        .select("private_metadata")
        .eq("import_batch_id", batchId)
        .single();
      eq("stored key count", Object.keys(stored?.private_metadata ?? {}).length, 100);
    }

    const tooMany = respondentRow({ privateMetadata: privateFields(101) });
    check(Object.keys(tooMany.privateMetadata).length === 101, "the refused payload really carries 101 keys");
    const overBatch = await stage(study.id, [tooMany], "rechaza_101_campos.csv");
    await expectRefusal("101 private fields", overBatch, [tooMany], "54000");
    ran("boundary");
    ran("atomic");
  }

  // --- [4] Shape and value guards --------------------------------------------
  console.log("\n[4] Shape, key and value guards still refuse:");
  {
    const cases = [
      ["privateMetadata that is not an object", respondentRow({ privateMetadata: ["folio"] }), "22023"],
      ["a key outside the allowed pattern", respondentRow({ privateMetadata: { "Folio-Interno": "x" } }), "22023"],
      ["a non-string private value", respondentRow({ privateMetadata: { folio: 41 } }), "22023"],
      ["a private value over 2000 bytes", respondentRow({ privateMetadata: { folio: "x".repeat(2001) } }), "22023"],
    ];
    for (const [label, person, code] of cases) {
      const batchId = await stage(study.id, [person], "rechazo.csv");
      await expectRefusal(label, batchId, [person], code);
    }

    const totalCase = respondentRow({
      privateMetadata: Object.fromEntries(
        Array.from({ length: 30 }, (_, i) => [`campo_${i}`, "y".repeat(1900)]),
      ),
    });
    const totalBatch = await stage(study.id, [totalCase], "rechazo_total.csv");
    await expectRefusal("private metadata over 32768 bytes in total", totalBatch, [totalCase], "54000");

    const arrayBatch = await stage(study.id, [respondentRow()], "rechazo_no_arreglo.csv");
    await expectRefusal("a payload that is not a JSON array", arrayBatch, { id: "x" }, "22023");
    ran("shape");
  }

  // --- [5] Privilege model ---------------------------------------------------
  console.log("\n[5] Only service_role may execute the function:");
  {
    assertCannotExecute("anon", await rawRpc(anonKey));

    const browser = createClient(url, anonKey, { auth: { autoRefreshToken: false, persistSession: false } });
    const { data: session, error: signInError } = await browser.auth.signInWithPassword({
      email: internalEmail,
      password: internalPassword,
    });
    if (signInError || !session?.session?.access_token) {
      fail("could not sign in a real user — the authenticated control could not run");
    } else {
      assertCannotExecute("authenticated", await rawRpc(session.session.access_token));
      await browser.auth.signOut();
    }

    // service_role executed it successfully several times above; a rejection
    // here would have failed [2] already. Recorded explicitly so the positive
    // control is visible next to the negatives.
    check(committedBatches.length >= 2, `service_role executed ${FUNCTION} successfully (${committedBatches.length} commit(s))`);
    ran("privilege");
  }
} catch (error) {
  fail(`the gate aborted: ${error instanceof Error ? error.message : String(error)}`);
} finally {
  // --- [6] Cleanup -----------------------------------------------------------
  console.log("\n[6] Removing every object this gate created:");
  for (const batchId of committedBatches) {
    await admin.rpc("rollback_import_batch", { p_import_batch_id: batchId });
  }
  for (const batchId of stagedBatches) {
    await admin.from("import_batch").delete().eq("id", batchId);
  }
  await admin.from("study").delete().eq("id", study.id);

  const [leftBatches, leftStudies] = await Promise.all([
    admin.from("import_batch").select("id", { count: "exact", head: true }).eq("study_id", study.id),
    admin.from("study").select("id", { count: "exact", head: true }).like("name", `${STUDY_PREFIX}%`),
  ]);
  eq("temporary import batches left behind", leftBatches.count ?? -1, 0);
  eq("temporary studies left behind", leftStudies.count ?? -1, 0);
  ran("cleanup");
}

console.log("\n" + "=".repeat(60));
const missing = CONTROLS.filter((c) => !executed.has(c));
if (missing.length > 0) {
  console.error(`Controls that never ran: ${missing.join(", ")}`);
  failures += missing.length;
}
if (failures > 0) {
  console.error(`Private metadata live gate FAILED with ${failures} failure(s).`);
  process.exit(1);
}
console.log("Private metadata live gate passed.");
