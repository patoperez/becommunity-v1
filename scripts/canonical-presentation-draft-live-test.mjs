// =============================================================================
// UNIT 6B.3A — THE DURABLE DRAFT, EXECUTED AGAINST A REAL DATABASE
// =============================================================================
//   bash scripts/lib/disposable-postgres-provision.sh          # once, PG 17
//   BECOMMUNITY_PG_VERSION=17 \
//   CANONICAL_COMMIT_TEST_PGHOST="$HOME/becommunity-pg/socket" \
//   CANONICAL_COMMIT_TEST_PGUSER="$(id -un)" \
//     npm run test:canonical-presentation-draft-live
//
// Add BECOMMUNITY_POSTGREST_BIN to run the same assertions a SECOND time over a
// real PostgREST with supabase-js, which is the transport the product uses.
//
// -----------------------------------------------------------------------------
// WHY THIS GATE EXISTS SEPARATELY FROM THE OFFLINE ONE
// -----------------------------------------------------------------------------
// `npm run test:canonical-presentation-persistence` proves everything that is a
// property of an ENCODING or of a STATE TRANSITION, by calling functions. Not
// one of the guarantees below is either of those. A revision that increments
// exactly once, a stale expectation that loses, two concurrent saves that
// cannot both win, an idempotency key that replays instead of writing, a failed
// save that leaves neither a row nor an event — every one of them is a property
// of PostgreSQL executing this migration's function under real concurrency, and
// the only way to know is to make it happen.
//
// -----------------------------------------------------------------------------
// WHAT IT PROVES, AND WHAT IT DELIBERATELY DOES NOT
// -----------------------------------------------------------------------------
// PROVES: the schema, the RPC, concurrency, idempotency, atomicity, least
// privilege, and that the two legacy rows are byte-identical afterwards.
//
// DOES NOT PROVE: the hosted project's behaviour. This is a disposable cluster
// with a local PostgREST. It is never to be reported as a hosted run.
//
// DOES NOT PROVE: the canonical read half of `storeEditedPresentation`. That
// function reads a committed canonical package before it writes, and seeding
// one is the subject of `test:canonical-commit-live`. What this gate carries
// across the boundary is the EXACT envelope `encodePresentationForStorage`
// produces, so the bytes under test are the product's bytes.
//
// NOTHING HOSTED IS TOUCHED. `resolveDisposableTarget` refuses to run at all if
// a Supabase environment variable is in scope.
// =============================================================================

import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { join } from "node:path";

import {
  DisposableTargetError,
  resolveDisposableTarget,
  withDisposableDatabase,
} from "./lib/disposable-postgres.mjs";
import { psqlSuiteTransport } from "./lib/canonical-psql-transport.mjs";
import { startLocalStack } from "./lib/local-postgrest-stack.mjs";
import { buildPresentationRead } from "../src/lib/viewer/index.ts";
import { bindPresentationDocument } from "../src/lib/presentation/registry.ts";
import { validatePresentationDocument } from "../src/lib/presentation/document.ts";
import { serializeDeterministic } from "../src/lib/presentation/serialize.ts";
import {
  decodePresentationFromStorage,
  encodePresentationForStorage,
} from "../src/lib/presentation/persistence.ts";
import { composerFixtureSource } from "./lib/composer-fixture.mjs";

let failures = 0;
let executed = 0;
let skipped = 0;
const check = (condition, message) => {
  if (typeof message !== "string") {
    failures += 1;
    console.log("  ✗ FAIL: check() got a non-string message — arguments reversed?");
    return;
  }
  executed += 1;
  if (condition) console.log(`  ✓ ${message}`);
  else {
    failures += 1;
    console.log(`  ✗ FAIL: ${message}`);
  }
};
const eq = (label, actual, expected) =>
  check(
    Object.is(actual, expected),
    `${label} = ${JSON.stringify(expected)}${Object.is(actual, expected) ? "" : ` (was ${JSON.stringify(actual)})`}`,
  );

const ACTOR = "11111111-1111-4111-8111-111111111111";
const CLIENT_ACTOR = "99999999-9999-4999-8999-999999999999";
const TENANT = "22222222-2222-4222-8222-222222222222";
const LEGACY_V2_STUDY = "33333333-3333-4333-8333-333333333333";
const LEGACY_V3_STUDY = "44444444-4444-4444-8444-444444444444";
const CLEAN_STUDY = "66666666-6666-4666-8666-666666666666";

const q = (value) => (value === null || value === undefined ? "null" : `'${String(value).replace(/'/g, "''")}'`);

/* -------------------------------------------------------------------------- */

let target;
try {
  target = resolveDisposableTarget(process.env);
} catch (thrown) {
  if (thrown instanceof DisposableTargetError) {
    console.error(`REFUSED: ${thrown.message}`);
    process.exit(2);
  }
  throw thrown;
}

console.log("Be Community — Unit 6B.3A: the durable draft against a real PostgreSQL");
console.log("=".repeat(78));

/* -------------------------------------------------------------------------- */
/* The document under test: the product's own bytes                            */
/* -------------------------------------------------------------------------- */

const built = buildPresentationRead(composerFixtureSource());
const template = {
  schemaVersion: 4,
  documentKind: "canonical_presentation",
  registryVersion: built.registry.registryVersion,
  binding: null,
  id: "doc-persistencia",
  title: "Documento de prueba",
  locale: "es-MX",
  samplePolicy: { mode: "show_all" },
  methodologyDisclosure: "none",
  pages: [{ id: "pagina-uno", title: "Primera", order: 1, blocks: [] }],
};
const validated = validatePresentationDocument(JSON.parse(JSON.stringify(template)));
if (!validated.ok) {
  console.error("the fixture document does not validate", validated.errors);
  process.exit(1);
}
const bound = bindPresentationDocument(validated.value, built.registry);

/** The envelope for one study, with an optional title change so bytes differ. */
function envelopeFor(studyId, title) {
  const document = title === undefined ? bound : { ...bound, title };
  const encoded = encodePresentationForStorage(document, { tenantId: TENANT, studyId });
  if (!encoded.ok) {
    console.error("encode refused", encoded.errors);
    process.exit(1);
  }
  return encoded.value;
}

await withDisposableDatabase(target, "presdraft", async (db) => {
  console.log("\n[setup] bootstrap + migrations 0000-0029");
  psqlSuiteTransport(db).prepare(29);

  db.run(`
    insert into auth.users (id, email) values
      (${q(ACTOR)}, 'internal@example.test'),
      (${q(CLIENT_ACTOR)}, 'client@example.test');
    insert into public.tenant (id, name) values (${q(TENANT)}, 'Probe tenant');
    insert into public.profiles (user_id, tenant_id, role) values
      (${q(ACTOR)}, ${q(TENANT)}, 'internal'),
      (${q(CLIENT_ACTOR)}, ${q(TENANT)}, 'client');
    insert into public.study (id, tenant_id, name) values
      (${q(LEGACY_V2_STUDY)}, ${q(TENANT)}, 'Estudio con borrador heredado v2'),
      (${q(LEGACY_V3_STUDY)}, ${q(TENANT)}, 'Estudio con borrador heredado v3'),
      (${q(CLEAN_STUDY)}, ${q(TENANT)}, 'Estudio limpio');
  `);

  // The two hosted legacy rows, planted exactly as the project holds them.
  db.run(`
    insert into public.study_experience_draft
      (study_id, tenant_id, schema_version, revision, definition, created_by, updated_by)
    values
      (${q(LEGACY_V2_STUDY)}, ${q(TENANT)}, 2, 72,
       jsonb_build_object('schemaVersion', 2, 'metadata',
         jsonb_build_object('studyId', ${q(LEGACY_V2_STUDY)}, 'tenantId', ${q(TENANT)}),
         'pages', jsonb_build_array(jsonb_build_object('id','p1','title','Heredado v2'))),
       ${q(ACTOR)}, ${q(ACTOR)}),
      (${q(LEGACY_V3_STUDY)}, ${q(TENANT)}, 3, 14,
       jsonb_build_object('schemaVersion', 3, 'metadata',
         jsonb_build_object('studyId', ${q(LEGACY_V3_STUDY)}, 'tenantId', ${q(TENANT)}),
         'pages', jsonb_build_array(jsonb_build_object('id','p1','title','Heredado v3'))),
       ${q(ACTOR)}, ${q(ACTOR)});
  `);

  const legacyFingerprint = () =>
    db.json(`
      select coalesce(json_agg(row_to_json(t) order by t.study_id)::text, '[]')
        from (
          select study_id::text, schema_version, revision,
                 encode(sha256(definition::text::bytea), 'hex') as sha,
                 extract(epoch from updated_at)::text as updated_at,
                 extract(epoch from created_at)::text as created_at,
                 created_by::text, updated_by::text
            from public.study_experience_draft
        ) t;
    `);
  const legacyBefore = JSON.stringify(legacyFingerprint());
  const legacyEventsBefore = db.run("select count(*) from public.study_experience_event;").trim();

  /** Call the save RPC through psql and return its jsonb answer, or its SQLSTATE. */
  const save = (studyId, envelope, expectedRevision, idempotencyKey, actor = ACTOR, note = null) => {
    try {
      return {
        ok: true,
        value: db.json(`
          select public.save_canonical_presentation_draft(
            ${q(studyId)}, ${q(actor)},
            ${q(JSON.stringify(envelope.definition))}::jsonb,
            ${q(envelope.registryVersion)}, ${q(envelope.binding)}, ${q(envelope.definitionSha256)},
            ${expectedRevision === null ? "null" : `${expectedRevision}::bigint`},
            ${q(idempotencyKey)}, ${q(note)}
          )::text;
        `),
      };
    } catch (thrown) {
      return { ok: false, sqlstate: thrown.sqlstate ?? null };
    }
  };

  /* ---------------------------------------------------------------------- */
  console.log("\n[1] Encode → store → load → decode, byte for byte");

  const envelope = envelopeFor(CLEAN_STUDY);
  const first = save(CLEAN_STUDY, envelope, null, "first-save-000001");
  check(first.ok, "a first save is accepted");
  eq("and its revision is", first.ok ? first.value.revision : null, 1);
  eq("and it reports itself as a creation", first.ok ? first.value.created : null, true);
  eq("and not as a replay", first.ok ? first.value.replayed : null, false);

  const row = db.json(`
    select row_to_json(t)::text from (
      select schema_version, document_kind, registry_version, binding_fingerprint,
             revision, definition, definition_sha256
        from public.canonical_presentation_draft where study_id = ${q(CLEAN_STUDY)}
    ) t;
  `);
  const decoded = decodePresentationFromStorage(
    {
      schemaVersion: row.schema_version,
      definition: row.definition,
      definitionSha256: row.definition_sha256,
      documentKind: row.document_kind,
      registryVersion: row.registry_version,
      binding: row.binding_fingerprint,
    },
    { tenantId: TENANT, studyId: CLEAN_STUDY },
  );
  check(decoded.ok, "the stored row decodes back into a presentation document");
  if (decoded.ok) {
    eq(
      "and it is byte-identical to the document that was saved",
      serializeDeterministic(decoded.value),
      serializeDeterministic(bound),
    );
  }
  // THE DIGEST SURVIVED THE COLUMN. `jsonb` reorders keys and does not keep the
  // original text, so this is the assertion that proves the canonical, key-sorted
  // serialization is what makes the hash stable across a round trip.
  eq(
    "and the digest still matches after PostgreSQL normalised the jsonb",
    createHash("sha256").update(serializeDeterministic(row.definition), "utf8").digest("hex"),
    row.definition_sha256,
  );
  eq("the row records the family", row.document_kind, "canonical_presentation");
  eq("the schema version", row.schema_version, 4);
  eq("the registry build", row.registry_version, bound.registryVersion);
  eq("and the binding", row.binding_fingerprint, bound.binding);

  /* ---------------------------------------------------------------------- */
  console.log("\n[2] The revision increments exactly once per save");

  const second = save(CLEAN_STUDY, envelopeFor(CLEAN_STUDY, "Segundo"), 1, "second-save-00001");
  eq("a second save moves the revision to", second.ok ? second.value.revision : null, 2);
  eq("and is not a creation", second.ok ? second.value.created : null, false);
  const third = save(CLEAN_STUDY, envelopeFor(CLEAN_STUDY, "Tercero"), 2, "third-save-000001");
  eq("a third moves it to", third.ok ? third.value.revision : null, 3);
  eq(
    "and the row holds exactly that",
    Number(db.run(`select revision from public.canonical_presentation_draft where study_id = ${q(CLEAN_STUDY)};`).trim()),
    3,
  );
  eq(
    "with one event per real save",
    Number(db.run(`select count(*) from public.canonical_presentation_draft_event where study_id = ${q(CLEAN_STUDY)};`).trim()),
    3,
  );

  /* ---------------------------------------------------------------------- */
  console.log("\n[3] An idempotency key replays instead of writing");

  // A DIFFERENT BODY UNDER THE SAME KEY, and that difference is the whole test.
  //
  // This used to resend the IDENTICAL envelope, so «the body sent the second
  // time is ignored entirely» was satisfied whether the body was ignored or
  // written — the stated property was untested. Deleting the replay branch's
  // `return` would not have failed it. Resending DIFFERENT bytes is what makes
  // the stored document's title an actual witness.
  const replay = save(CLEAN_STUDY, envelopeFor(CLEAN_STUDY, "Cuerpo distinto bajo la misma clave"), 2, "third-save-000001");
  check(replay.ok, "resending a save under a key already recorded is accepted");
  eq("and answers with the revision the first attempt produced", replay.ok ? replay.value.revision : null, 3);
  eq("and says so", replay.ok ? replay.value.replayed : null, true);
  eq(
    "and the revision did NOT move",
    Number(db.run(`select revision from public.canonical_presentation_draft where study_id = ${q(CLEAN_STUDY)};`).trim()),
    3,
  );
  eq(
    "and no second event was written",
    Number(db.run(`select count(*) from public.canonical_presentation_draft_event where study_id = ${q(CLEAN_STUDY)};`).trim()),
    3,
  );
  // A REPLAY IS NOT AN OVERWRITE. The body sent the second time is ignored
  // entirely, which is what makes a retry after a lost response safe.
  const afterReplay = db.json(`select definition::text from public.canonical_presentation_draft where study_id = ${q(CLEAN_STUDY)};`);
  eq(
    "and the stored document is the FIRST attempt's, not the one just resent",
    afterReplay.title,
    "Tercero",
  );

  /* ---------------------------------------------------------------------- */
  console.log("\n[4] A stale revision is a typed conflict, and never an overwrite");

  const stale = save(CLEAN_STUDY, envelopeFor(CLEAN_STUDY, "Rancio"), 1, "stale-save-000001");
  check(!stale.ok, "a save presenting a revision the store has moved past is refused");
  eq("with the conflict SQLSTATE the Data API does not retry", stale.sqlstate, "55000");
  const afterStale = db.json(`select definition::text from public.canonical_presentation_draft where study_id = ${q(CLEAN_STUDY)};`);
  eq("and the newer stored document is untouched", afterStale.title, "Tercero");

  const noExpectation = save(CLEAN_STUDY, envelopeFor(CLEAN_STUDY, "Sin expectativa"), null, "noexp-save-000001");
  check(!noExpectation.ok, "and a save presenting NO expectation over an existing draft is refused too");
  eq("under the same code", noExpectation.sqlstate, "55000");

  /* ---------------------------------------------------------------------- */
  console.log("\n[5] Wrong tenant, study, family, version or actor: refused");

  const otherTenantEnvelope = encodePresentationForStorage(bound, {
    tenantId: LEGACY_V2_STUDY, // a uuid that is not this study's tenant
    studyId: CLEAN_STUDY,
  });
  check(otherTenantEnvelope.ok, "an envelope naming another tenant encodes (the encoder does not know the study row)");
  const wrongTenant = save(CLEAN_STUDY, otherTenantEnvelope.value, 3, "wrongtenant-00001");
  check(!wrongTenant.ok, "but the database refuses it");
  eq("as invalid input", wrongTenant.sqlstate, "22023");

  const wrongStudyEnvelope = envelopeFor(LEGACY_V3_STUDY);
  const wrongStudy = save(CLEAN_STUDY, wrongStudyEnvelope, 3, "wrongstudy-000001");
  check(!wrongStudy.ok && wrongStudy.sqlstate === "22023", "a document naming another study is refused");

  const legacyFamily = {
    definition: { schemaVersion: 2, documentKind: "experience_definition", metadata: { studyId: CLEAN_STUDY, tenantId: TENANT } },
    registryVersion: bound.registryVersion,
    binding: bound.binding,
    definitionSha256: "0".repeat(64),
  };
  const legacyRefused = save(CLEAN_STUDY, legacyFamily, 3, "legacyfamily-0001");
  check(!legacyRefused.ok && legacyRefused.sqlstate === "22023", "a legacy-family document is refused by the canonical path");

  const wrongBinding = save(
    CLEAN_STUDY,
    { ...envelopeFor(CLEAN_STUDY, "Enlace"), binding: "b".repeat(64) },
    3,
    "wrongbinding-0001",
  );
  check(!wrongBinding.ok && wrongBinding.sqlstate === "22023", "a binding disagreeing with the document is refused");

  const clientActor = save(CLEAN_STUDY, envelopeFor(CLEAN_STUDY, "Cliente"), 3, "clientactor-00001", CLIENT_ACTOR);
  check(!clientActor.ok, "a client-role actor cannot save");
  eq("and is refused as insufficient privilege", clientActor.sqlstate, "42501");

  const unknownStudy = save("77777777-7777-4777-8777-777777777777", envelope, null, "unknownstudy-0001");
  check(!unknownStudy.ok && unknownStudy.sqlstate === "P0002", "an unknown study is refused");

  eq(
    "and after every one of those refusals the revision is still",
    Number(db.run(`select revision from public.canonical_presentation_draft where study_id = ${q(CLEAN_STUDY)};`).trim()),
    3,
  );

  /* ---------------------------------------------------------------------- */
  console.log("\n[6] A canonical draft COEXISTS with a legacy draft for the same study");

  const beside = save(LEGACY_V2_STUDY, envelopeFor(LEGACY_V2_STUDY, "Junto al heredado"), null, "beside-save-00001");
  check(beside.ok, "a canonical draft can be saved for the study that holds the legacy v2 row");
  eq("at its own revision one", beside.ok ? beside.value.revision : null, 1);
  eq(
    "and the legacy row is still at schema version 2",
    Number(db.run(`select schema_version from public.study_experience_draft where study_id = ${q(LEGACY_V2_STUDY)};`).trim()),
    2,
  );
  eq(
    "and still at revision 72",
    Number(db.run(`select revision from public.study_experience_draft where study_id = ${q(LEGACY_V2_STUDY)};`).trim()),
    72,
  );

  const beside3 = save(LEGACY_V3_STUDY, envelopeFor(LEGACY_V3_STUDY, "Junto al v3"), null, "beside3-save-0001");
  check(beside3.ok, "and the same for the study holding the legacy v3 row");
  eq(
    "whose version is still 3",
    Number(db.run(`select schema_version from public.study_experience_draft where study_id = ${q(LEGACY_V3_STUDY)};`).trim()),
    3,
  );
  eq(
    "and whose revision is still 14",
    Number(db.run(`select revision from public.study_experience_draft where study_id = ${q(LEGACY_V3_STUDY)};`).trim()),
    14,
  );

  /* ---------------------------------------------------------------------- */
  console.log("\n[7] A failure leaves neither a revision nor an event");

  const before = db.run(`
    select revision::text || '|' || (
      select count(*)::text from public.canonical_presentation_draft_event where study_id = ${q(CLEAN_STUDY)}
    ) from public.canonical_presentation_draft where study_id = ${q(CLEAN_STUDY)};
  `).trim();
  // A note longer than the column admits fails AFTER the row would have moved,
  // which is the only honest way to test "no partial revision or event".
  const partial = save(CLEAN_STUDY, envelopeFor(CLEAN_STUDY, "Fallará"), 3, "partial-save-0001", ACTOR, "x".repeat(201));
  check(!partial.ok, "a save whose event cannot be written is refused");
  const after = db.run(`
    select revision::text || '|' || (
      select count(*)::text from public.canonical_presentation_draft_event where study_id = ${q(CLEAN_STUDY)}
    ) from public.canonical_presentation_draft where study_id = ${q(CLEAN_STUDY)};
  `).trim();
  eq("and the revision and the event count are exactly what they were", after, before);

  /* ---------------------------------------------------------------------- */
  console.log("\n[8] The event log is append-only");

  let updated = true;
  try {
    db.run("update public.canonical_presentation_draft_event set revision = 999;");
  } catch (thrown) {
    updated = false;
    eq("updating an event raises the immutability code", thrown.sqlstate, "2F002");
  }
  check(!updated, "and the update did not happen");

  /* ---------------------------------------------------------------------- */
  console.log("\n[9] Least privilege, RLS and the browser roles");

  const grants = db.json(`
    select coalesce(json_agg(json_build_object('t', table_name, 'g', grantee, 'p', privilege_type)
             order by table_name, grantee, privilege_type)::text, '[]')
      from information_schema.role_table_grants
     where table_schema = 'public'
       and table_name like 'canonical_presentation_draft%'
       and grantee in ('anon', 'authenticated', 'service_role');
  `);
  const serviceGrants = grants.filter((g) => g.g === "service_role").map((g) => g.p).sort();
  eq("service_role holds only SELECT on the draft tables", JSON.stringify([...new Set(serviceGrants)]), '["SELECT"]');
  eq(
    "and the browser roles hold nothing at all",
    grants.filter((g) => g.g === "anon" || g.g === "authenticated").length,
    0,
  );

  const rls = db.json(`
    select coalesce(json_agg(json_build_object('r', relname, 'e', relrowsecurity, 'f', relforcerowsecurity)
             order by relname)::text, '[]')
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind = 'r' and c.relname like 'canonical_presentation_draft%';
  `);
  check(rls.length === 2 && rls.every((r) => r.e && r.f), "both tables are RLS-enabled and FORCE RLS");

  const fn = db.json(`
    select coalesce(json_agg(json_build_object('n', p.proname, 'd', p.prosecdef,
             'c', coalesce(array_to_string(p.proconfig, ','), ''),
             'a', coalesce(array_to_string(p.proacl::text[], ','), ''))
             order by p.proname)::text, '[]')
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'save_canonical_presentation_draft';
  `);
  check(fn.length === 1 && fn[0].d === true, "the save function is SECURITY DEFINER");
  check(fn.length === 1 && fn[0].c === 'search_path=""', "with an empty search_path");
  check(
    fn.length === 1 && fn[0].a.includes("service_role=X") && !/\banon=X/.test(fn[0].a) && !/authenticated=X/.test(fn[0].a),
    "and EXECUTE is granted to service_role and to no browser role",
  );

  // BROWSER ROLES CANNOT READ THE TABLE.
  //
  // INSIDE AN EXPLICIT TRANSACTION, and that is not a detail. `set local role`
  // outside one applies to the implicit single-statement transaction it is in
  // and is gone before the next statement runs — so the SELECT executed as the
  // table's OWNER, succeeded, and this assertion read green while proving the
  // opposite of what it claimed. It failed loudly here only because it was
  // written to expect a refusal; an assertion written the other way round would
  // have passed silently forever.
  for (const role of ["anon", "authenticated"]) {
    for (const [what, statement] of [
      ["read", `select 1 from public.canonical_presentation_draft limit 1;`],
      ["read the event log", `select 1 from public.canonical_presentation_draft_event limit 1;`],
      ["execute the save function", `select public.save_canonical_presentation_draft(
         ${q(CLEAN_STUDY)}, ${q(ACTOR)}, '{}'::jsonb, '1.0.0', ${q("a".repeat(64))}, ${q("b".repeat(64))}, null, null, null);`],
    ]) {
      // THE CODE, NOT MERELY A FAILURE. `catch {}` alone would pass if the
      // statement failed for ANY reason — a typo, a wrong argument type, a
      // missing table — so a grant that had been quietly widened would still
      // look denied. 42501 is insufficient_privilege and nothing else is.
      let sqlstate = null;
      try {
        db.run(`begin; set local role ${role}; ${statement} rollback;`);
      } catch (thrown) {
        sqlstate = thrown.sqlstate ?? null;
      }
      eq(`role ${role} cannot ${what}, and is refused for lack of privilege`, sqlstate, "42501");
    }
  }

  // THE FUNCTION'S OWN BODY CANNOT NAME A LEGACY TABLE.
  const body = db.run(`
    select case when position('study_experience' in prosrc) > 0 then 'names' else 'does-not-name' end
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'save_canonical_presentation_draft';
  `).trim();
  eq("the save function's body", body, "does-not-name");

  /* ---------------------------------------------------------------------- */
  console.log("\n[9b] Two GENUINELY concurrent saves cannot lose an update");

  /**
   * One save in its own psql process, with a settle delay INSIDE the
   * transaction so two of them really do overlap.
   *
   * This is the assertion that needed a second connection. `db.run` is
   * synchronous, so everything above happens one statement at a time and could
   * not have caught a lost update if there were one.
   */
  const concurrentSave = (studyId, title, expectedRevision, idempotencyKey) =>
    new Promise((resolve) => {
      const sql = `
        begin;
        select pg_sleep(0.4);
        do $race$
        declare a jsonb;
        begin
          a := public.save_canonical_presentation_draft(
            ${q(studyId)}, ${q(ACTOR)},
            ${q(JSON.stringify(envelopeFor(studyId, title).definition))}::jsonb,
            ${q(bound.registryVersion)}, ${q(bound.binding)},
            ${q(envelopeFor(studyId, title).definitionSha256)},
            ${expectedRevision === null ? "null" : `${expectedRevision}::bigint`},
            ${q(idempotencyKey)}, null);
          raise notice 'OK %', a::text;
        exception when others then
          raise notice 'ERR %', sqlstate;
        end
        $race$;
        commit;`;
      execFile(
        db.psql,
        ["-X", "-q", "-A", "-t", ...db.connectionArgs(), "-c", sql],
        { encoding: "utf8" },
        (_error, stdout, stderr) => {
          const text = `${stdout}${stderr}`;
          const okMatch = /NOTICE:\s+OK (\{.*\})/.exec(text);
          const errMatch = /NOTICE:\s+ERR ([0-9A-Z]{5})/.exec(text);
          resolve(
            okMatch ? { ok: true, value: JSON.parse(okMatch[1]) } : { ok: false, sqlstate: errMatch?.[1] ?? null },
          );
        },
      );
    });

  const RACE_STUDY = CLEAN_STUDY;
  const raceBase = Number(
    db.run(`select revision from public.canonical_presentation_draft where study_id = ${q(RACE_STUDY)};`).trim(),
  );

  // RACE 1 — two saves from the SAME revision. Exactly one may win.
  const [raceA, raceB] = await Promise.all([
    concurrentSave(RACE_STUDY, "Carrera A", raceBase, "raceone-aaaa-0001"),
    concurrentSave(RACE_STUDY, "Carrera B", raceBase, "raceone-bbbb-0001"),
  ]);
  const winners = [raceA, raceB].filter((r) => r.ok);
  const losers = [raceA, raceB].filter((r) => !r.ok);
  eq("exactly one of two concurrent saves from one revision wins", winners.length, 1);
  eq("and exactly one loses", losers.length, 1);
  eq("the loser is refused as a TYPED conflict, never a raw key violation", losers[0]?.sqlstate, "55000");
  eq("and the revision moved by exactly one", winners[0]?.value.revision, raceBase + 1);
  eq(
    "and the stored document is the winner's, whole",
    db.json(`select definition::text from public.canonical_presentation_draft where study_id = ${q(RACE_STUDY)};`).title,
    winners[0]?.value.revision === raceBase + 1 && raceA.ok ? "Carrera A" : "Carrera B",
  );

  // RACE 2 — two concurrent CREATES, where a row-level FOR UPDATE locks nothing
  // because there is no row yet. This is the hole the legacy function has.
  db.run(`
    insert into public.study (id, tenant_id, name)
    values ('88888888-8888-4888-8888-888888888888', ${q(TENANT)}, 'Estudio de carrera');
  `);
  const CREATE_RACE_STUDY = "88888888-8888-4888-8888-888888888888";
  const [createA, createB] = await Promise.all([
    concurrentSave(CREATE_RACE_STUDY, "Crea A", null, "racetwo-aaaa-0001"),
    concurrentSave(CREATE_RACE_STUDY, "Crea B", null, "racetwo-bbbb-0001"),
  ]);
  eq("exactly one of two concurrent FIRST saves wins", [createA, createB].filter((r) => r.ok).length, 1);
  eq(
    "and the loser is a typed conflict rather than a primary-key violation",
    [createA, createB].find((r) => !r.ok)?.sqlstate,
    "55000",
  );
  eq(
    "and exactly one row exists",
    Number(db.run(`select count(*) from public.canonical_presentation_draft where study_id = ${q(CREATE_RACE_STUDY)};`).trim()),
    1,
  );
  eq(
    "at revision one, with one event",
    db.run(`select revision::text || '|' || (select count(*)::text from public.canonical_presentation_draft_event where study_id = ${q(CREATE_RACE_STUDY)}) from public.canonical_presentation_draft where study_id = ${q(CREATE_RACE_STUDY)};`).trim(),
    "1|1",
  );

  // RACE 3 — two concurrent saves under ONE idempotency key.
  const idemBase = Number(
    db.run(`select revision from public.canonical_presentation_draft where study_id = ${q(RACE_STUDY)};`).trim(),
  );
  const [idemA, idemB] = await Promise.all([
    concurrentSave(RACE_STUDY, "Idem A", idemBase, "racethree-key-001"),
    concurrentSave(RACE_STUDY, "Idem B", idemBase, "racethree-key-001"),
  ]);
  check(idemA.ok && idemB.ok, "two concurrent saves under one idempotency key BOTH succeed");
  eq("and both answer with the same revision", idemA.value?.revision, idemB.value?.revision);
  eq("which is exactly one past where it started", idemA.value?.revision, idemBase + 1);
  eq(
    "one of them wrote and the other replayed",
    [idemA, idemB].filter((r) => r.value?.replayed === true).length,
    1,
  );
  eq(
    "and only ONE event carries that key",
    Number(db.run(`select count(*) from public.canonical_presentation_draft_event where idempotency_key = 'racethree-key-001';`).trim()),
    1,
  );

  /* ---------------------------------------------------------------------- */
  console.log("\n[10] The two legacy rows are byte-identical to how they started");

  const legacyAfter = JSON.stringify(legacyFingerprint());
  eq("the legacy draft fingerprint is unchanged", legacyAfter, legacyBefore);
  eq(
    "and the legacy event log gained nothing",
    db.run("select count(*) from public.study_experience_event;").trim(),
    legacyEventsBefore,
  );

  /* ---------------------------------------------------------------------- */
  console.log("\n[10b] The same contract over a real PostgREST, through supabase-js");

  // THE TRANSPORT IS PART OF THE CONTRACT, AND THIS IS THE ASSERTION THAT PAYS
  // FOR IT. `storeEditedPresentation` decides a conflict by reading
  // `error.code === "55000"`. Whether a PL/pgSQL `raise … using errcode` still
  // IS that string by the time it has crossed PostgREST, been serialized to
  // JSON and been parsed by supabase-js is not something source code can
  // answer — and if it were anything else, every conflict would reach an
  // operator as a generic failure beside a retry button that overwrites newer
  // work. Migration 0024 already paid once for assuming a SQLSTATE survives a
  // transport; this is that lesson executed rather than remembered.
  const POSTGREST =
    process.env.BECOMMUNITY_POSTGREST_BIN ?? join(process.env.HOME ?? "", "becommunity-postgrest", "postgrest");
  if (!existsSync(POSTGREST)) {
    skipped += 1;
    console.log(`  — SKIPPED: no PostgREST binary at ${POSTGREST}. Set BECOMMUNITY_POSTGREST_BIN to execute this section.`);
    console.log("    (A skip is reported as a skip and is never counted as a pass.)");
  } else {
    const stack = await startLocalStack(db, { binary: POSTGREST, target });
    try {
      const { createClient } = await import("@supabase/supabase-js");
      const client = createClient(stack.apiOrigin, stack.serviceKey, {
        auth: { autoRefreshToken: false, persistSession: false },
      });
      const httpStudy = CREATE_RACE_STUDY;
      const current = Number(
        db.run(`select revision from public.canonical_presentation_draft where study_id = ${q(httpStudy)};`).trim(),
      );
      const callSave = (envelope, expectedRevision, idempotencyKey) =>
        client.rpc("save_canonical_presentation_draft", {
          p_study_id: httpStudy,
          p_actor: ACTOR,
          p_definition: envelope.definition,
          p_registry_version: envelope.registryVersion,
          p_binding_fingerprint: envelope.binding,
          p_definition_sha256: envelope.definitionSha256,
          p_expected_revision: expectedRevision,
          p_idempotency_key: idempotencyKey,
          p_note: null,
        });

      const httpOk = await callSave(envelopeFor(httpStudy, "Por HTTP"), current, "http-save-0000001");
      check(httpOk.error === null, "a save over HTTP with supabase-js succeeds");
      eq("and returns the next revision", httpOk.data?.revision, current + 1);
      eq("and says it is not a replay", httpOk.data?.replayed, false);

      const httpReplay = await callSave(envelopeFor(httpStudy, "Por HTTP"), current, "http-save-0000001");
      check(httpReplay.error === null, "and replaying the same key over HTTP succeeds too");
      eq("with the same revision", httpReplay.data?.revision, current + 1);
      eq("and says it IS a replay", httpReplay.data?.replayed, true);

      const httpConflict = await callSave(envelopeFor(httpStudy, "Rancio"), current, "http-stale-000001");
      check(httpConflict.error !== null, "a stale revision over HTTP is refused");
      eq(
        "and its code reaches supabase-js as the exact string the product switches on",
        httpConflict.error?.code,
        "55000",
      );
      // AND THE MESSAGE CARRIES NO DOCUMENT. A constraint violation quotes the
      // values that violated it, and those values would be the presentation.
      check(
        typeof httpConflict.error?.message === "string" && !httpConflict.error.message.includes("Rancio"),
        "and the error message does not quote the document that was refused",
      );

      const httpRefused = await callSave(
        {
          definition: { schemaVersion: 2, documentKind: "experience_definition" },
          registryVersion: "1.0.0",
          binding: "a".repeat(64),
          definitionSha256: "b".repeat(64),
        },
        current + 1,
        "http-legacy-000001",
      );
      eq("a legacy-family document over HTTP is refused as invalid input", httpRefused.error?.code, "22023");

      // THE BROWSER ROLES CANNOT REACH IT OVER HTTP EITHER. The same refusal as
      // the SET ROLE one above, taken the way a browser would take it: through
      // the API, with the key a browser is given.
      for (const [role, key] of [
        ["anon", stack.anonKey],
        ["authenticated", stack.authenticatedKey],
      ]) {
        const roleClient = createClient(stack.apiOrigin, key, {
          auth: { autoRefreshToken: false, persistSession: false },
        });
        const rpcAttempt = await roleClient.rpc("save_canonical_presentation_draft", {
          p_study_id: httpStudy,
          p_actor: ACTOR,
          p_definition: {},
          p_registry_version: "1.0.0",
          p_binding_fingerprint: "a".repeat(64),
          p_definition_sha256: "b".repeat(64),
          p_expected_revision: null,
          p_idempotency_key: null,
          p_note: null,
        });
        check(rpcAttempt.error !== null, `the ${role} key cannot execute the save function over HTTP`);
        const readAttempt = await roleClient.from("canonical_presentation_draft").select("revision").limit(1);
        check(
          readAttempt.error !== null || (readAttempt.data ?? []).length === 0,
          `and the ${role} key reads no canonical draft row`,
        );
      }
      console.log(`  (PostgREST ${(await stack.serverHeader()) ?? "unreported"} — a LOCAL substitute, never a hosted run.)`);
    } finally {
      await stack.stop();
    }
  }

  /* ---------------------------------------------------------------------- */
  console.log("\n[11] The rollback removes everything this migration made, and only that");

  psqlSuiteTransport(db).applyRollback("0029_drop_canonical_presentation_draft.sql");
  eq(
    "no canonical presentation object survives the rollback",
    db.run(`
      select (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
               where n.nspname='public' and c.relname like 'canonical_presentation%')
           + (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
               where n.nspname='public' and p.proname like '%canonical_presentation%');
    `).trim(),
    "0",
  );
  eq("and the legacy rows are STILL byte-identical", JSON.stringify(legacyFingerprint()), legacyBefore);
});

/* -------------------------------------------------------------------------- */

console.log(`\n${"=".repeat(78)}`);
console.log(`EXECUTED: ${executed}   PASSED: ${executed - failures}   FAILED: ${failures}   SKIPPED SECTIONS: ${skipped}`);
if (failures > 0) {
  console.log("RESULT: the durable draft does NOT behave as documented. GATE BLOCKED.");
  process.exit(1);
}
console.log(
  "RESULT: a v4 document survives the column byte for byte, the revision increments exactly once,\n" +
    "        a replayed key writes nothing, a stale revision is a typed conflict that overwrites\n" +
    "        nothing, a wrong tenant/study/family/binding/actor is refused, a canonical draft\n" +
    "        coexists with a legacy one, a failure leaves neither row nor event, the log is\n" +
    "        append-only, service_role holds only SELECT, and the two legacy rows are\n" +
    "        byte-identical before and after — including after the rollback. GATE PASSED.\n" +
    "\n" +
    "NOTE: a disposable cluster, not the hosted project. Never report this as a hosted run.",
);
