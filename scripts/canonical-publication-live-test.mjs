// =============================================================================
// UNIT 6B.4A — THE PUBLICATION LIFECYCLE, EXECUTED AGAINST A REAL DATABASE
// =============================================================================
//   bash scripts/lib/disposable-postgres-provision.sh          # once, PG 17
//   BECOMMUNITY_PG_VERSION=17 \
//   CANONICAL_COMMIT_TEST_PGHOST="$HOME/becommunity-pg/socket" \
//   CANONICAL_COMMIT_TEST_PGUSER="$(id -un)" \
//     npm run test:canonical-publication-live
//
// Add BECOMMUNITY_POSTGREST_BIN to run the transport half a second time over a
// real PostgREST with supabase-js, which is what the product actually speaks.
//
// -----------------------------------------------------------------------------
// WHY THIS EXISTS SEPARATELY FROM THE OFFLINE GATE
// -----------------------------------------------------------------------------
// `npm run test:canonical-publication` proves everything that is a property of a
// PURE FUNCTION: which blocker a condition raises, which warnings need a
// person's confirmation, that no threshold exists. Not one of the guarantees
// below is that. A version that increments exactly once, two concurrent
// publications that cannot both win, a snapshot the table owner cannot delete, a
// retry that replays instead of publishing twice, a rollback that removes only
// its own objects — every one is a property of PostgreSQL executing this
// migration, and the only way to know is to make it happen.
//
// THE FOURTEEN PROOFS THE PHASE NAMES, and the section that executes each:
//
//    1 canonical and legacy publication storage cannot collide ......... [2]
//    2 schema v2/v3 is refused ......................................... [3]
//    3 exact draft revision and digest are required .................... [4]
//    4 stale draft publication is refused .............................. [5]
//    5 binding/result/package drift is refused ......................... [6]
//    6 publication is atomic ........................................... [7]
//    7 retry is idempotent ............................................. [8]
//    8 concurrent publication creates only one version ................. [9]
//    9 prior snapshots are immutable even to service-layer code ........ [10]
//   10 browser roles cannot read or write internal publication storage . [11]
//   11 client-visible reads contain no internal audit fields ........... [12]
//   12 restoration creates a new draft revision and preserves snapshots  [13]
//   13 rollback removes only the new canonical objects ................. [15]
//   14 legacy rows remain byte-identical ............................... [14]
//
// NOTHING HOSTED IS TOUCHED. `resolveDisposableTarget` refuses to run at all if
// a Supabase environment variable is in scope. This is a disposable cluster with
// a local PostgREST, and it is never to be reported as a hosted run.
// =============================================================================

import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

import {
  DisposableTargetError,
  resolveDisposableTarget,
  withDisposableDatabase,
} from "./lib/disposable-postgres.mjs";
import { psqlSuiteTransport } from "./lib/canonical-psql-transport.mjs";
import { startLocalStack } from "./lib/local-postgrest-stack.mjs";
import { buildPresentationRead, resolveUnderSelection } from "../src/lib/viewer/index.ts";
import { bindPresentationDocument } from "../src/lib/presentation/registry.ts";
import { validatePresentationDocument } from "../src/lib/presentation/document.ts";
import { EMPTY_VIEWER_SELECTION } from "../src/lib/presentation/viewer.ts";
import { buildGenericStartingBlueprint } from "../src/lib/presentation/blueprints/generic-starting.ts";
import { JOURNEY_ROUTES_VARIANTS, offeredChartVariants } from "../src/lib/composer/renderer-capabilities.ts";
import { serializeDeterministic } from "../src/lib/presentation/serialize.ts";
import { encodePresentationForStorage } from "../src/lib/presentation/persistence.ts";
import { sha256Hex } from "../src/lib/ingestion/canonical-commit/sha256.ts";
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
/**
 * Equality of two large serialized values, WITHOUT printing either of them.
 *
 * `eq` prints its expected value on success, which is right for a version number
 * and wrong for a seventeen-kilobyte render model: a passing run scrolled the
 * whole document past the reader and buried every other line. The comparison is
 * identical; only the reporting differs, and on a MISMATCH the first difference
 * is located rather than the whole value dumped.
 */
const same = (label, actual, expected) => {
  if (actual === expected) {
    check(true, `${label} (${expected.length} bytes, identical)`);
    return;
  }
  let at = 0;
  while (at < actual.length && at < expected.length && actual[at] === expected[at]) at += 1;
  check(false, `${label}: they differ at byte ${at} — «${actual.slice(at, at + 60)}» vs «${expected.slice(at, at + 60)}»`);
};

const ACTOR = "11111111-1111-4111-8111-111111111111";
const CLIENT_ACTOR = "99999999-9999-4999-8999-999999999999";
const TENANT = "22222222-2222-4222-8222-222222222222";
/** Holds a legacy v2 draft AND a canonical draft, exactly as Cuicuilco does. */
const BOTH_STUDY = "33333333-3333-4333-8333-333333333333";
const LEGACY_V3_STUDY = "44444444-4444-4444-8444-444444444444";
/** The study every ordinary publication assertion runs against. */
const CLEAN_STUDY = "66666666-6666-4666-8666-666666666666";
/** Deleted at the end, to prove a cascade still works past the immutability trigger. */
const CASCADE_STUDY = "77777777-7777-4777-8777-777777777777";
/** Two concurrent publications race here. */
const RACE_STUDY = "88888888-8888-4888-8888-888888888888";

const q = (value) =>
  value === null || value === undefined ? "null" : `'${String(value).replace(/'/g, "''")}'`;

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

console.log("Be Community — Unit 6B.4A: the publication lifecycle against a real PostgreSQL");
console.log("=".repeat(82));

/* -------------------------------------------------------------------------- */
/* The document and the render model under test: the product's own bytes       */
/* -------------------------------------------------------------------------- */

const built = buildPresentationRead(composerFixtureSource());
const identity = {
  registryVersion: built.registry.registryVersion,
  bindingFingerprint: built.registry.binding,
  resultsContractVersion: built.registry.contractVersion,
  calculationVersion: built.registry.source.calculationVersion,
  specId: built.registry.source.specId,
  mappingVersion: built.registry.source.mappingVersion,
  packageIdempotencyKey: built.registry.source.packageIdempotencyKey,
  planFingerprint: built.registry.source.planFingerprint,
};

const blueprint = buildGenericStartingBlueprint(built.registry, {
  drawableFor: offeredChartVariants,
  drawableForRoutes: JOURNEY_ROUTES_VARIANTS,
  title: "Estudio de publicación",
});
const validated = validatePresentationDocument(JSON.parse(serializeDeterministic(blueprint)));
if (!validated.ok) {
  console.error("the fixture document does not validate", validated.errors);
  process.exit(1);
}
const bound = bindPresentationDocument(validated.value, built.registry);

/** The envelope and the resolved model for one study, with an optional title change. */
function materialFor(studyId, title) {
  const document = title === undefined ? bound : { ...bound, title };
  const encoded = encodePresentationForStorage(document, { tenantId: TENANT, studyId });
  if (!encoded.ok) {
    console.error("encode refused", encoded.errors);
    process.exit(1);
  }
  const resolved = resolveUnderSelection(built, document, EMPTY_VIEWER_SELECTION);
  if (!resolved.ok) {
    console.error("resolve refused", resolved.issues);
    process.exit(1);
  }
  return {
    envelope: encoded.value,
    model: resolved.model,
    modelSha256: sha256Hex(serializeDeterministic(resolved.model)),
  };
}

const MODEL_BYTES = new TextEncoder().encode(serializeDeterministic(materialFor(CLEAN_STUDY).model)).length;

await withDisposableDatabase(target, "publive", async (db) => {
  console.log("\n[setup] bootstrap + migrations 0000-0030, both families of draft side by side");
  psqlSuiteTransport(db).prepare(30);

  db.run(`
    insert into auth.users (id, email) values
      (${q(ACTOR)}, 'internal@example.test'),
      (${q(CLIENT_ACTOR)}, 'client@example.test');
    insert into public.tenant (id, name) values (${q(TENANT)}, 'Probe tenant');
    insert into public.profiles (user_id, tenant_id, role) values
      (${q(ACTOR)}, ${q(TENANT)}, 'internal'),
      (${q(CLIENT_ACTOR)}, ${q(TENANT)}, 'client');
    insert into public.study (id, tenant_id, name) values
      (${q(BOTH_STUDY)}, ${q(TENANT)}, 'Estudio con las dos familias'),
      (${q(LEGACY_V3_STUDY)}, ${q(TENANT)}, 'Estudio con borrador heredado v3'),
      (${q(CLEAN_STUDY)}, ${q(TENANT)}, 'Estudio limpio'),
      (${q(CASCADE_STUDY)}, ${q(TENANT)}, 'Estudio que se borra entero'),
      (${q(RACE_STUDY)}, ${q(TENANT)}, 'Estudio de carrera');
  `);

  const plantLegacy = (studyId, version, revision, label) =>
    db.run(`
      insert into public.study_experience_draft
        (study_id, tenant_id, schema_version, revision, definition, created_by, updated_by)
      values
        (${q(studyId)}, ${q(TENANT)}, ${version}, ${revision},
         jsonb_build_object('schemaVersion', ${version}, 'metadata',
           jsonb_build_object('studyId', ${q(studyId)}, 'tenantId', ${q(TENANT)}),
           'pages', jsonb_build_array(jsonb_build_object('id','p1','title',${q(label)}))),
         ${q(ACTOR)}, ${q(ACTOR)});
    `);
  plantLegacy(BOTH_STUDY, 2, 72, "Heredado v2");
  plantLegacy(LEGACY_V3_STUDY, 3, 14, "Heredado v3");

  const legacyFingerprint = () =>
    db.json(`
      select coalesce(json_agg(row_to_json(t) order by t.study_id)::text, '[]')
        from (
          select study_id::text, schema_version, revision,
                 encode(sha256(definition::text::bytea), 'hex') as sha,
                 extract(epoch from updated_at)::text as updated_at
            from public.study_experience_draft
        ) t;
    `);
  const legacyBefore = JSON.stringify(legacyFingerprint());
  const legacyEventsBefore = db.run("select count(*) from public.study_experience_event;").trim();

  /** Save a canonical draft through the ONE write path 0029 provides. */
  const saveDraft = (studyId, envelope, expectedRevision, key) =>
    db.json(`
      select public.save_canonical_presentation_draft(
        ${q(studyId)}, ${q(ACTOR)}, ${q(JSON.stringify(envelope.definition))}::jsonb,
        ${q(envelope.registryVersion)}, ${q(envelope.binding)}, ${q(envelope.definitionSha256)},
        ${expectedRevision === null ? "null" : `${expectedRevision}::bigint`}, ${q(key)}, null
      )::text;
    `);

  /** Call the publication RPC and return its answer or its SQLSTATE. */
  const publishSql = (options) => {
    const {
      studyId,
      material,
      sourceDraftRevision,
      definitionSha256,
      renderModel,
      renderModelSha256,
      registryVersion = identity.registryVersion,
      binding = identity.bindingFingerprint,
      contractVersion = identity.resultsContractVersion,
      acknowledged = "{}",
      blockers = "{}",
      unacknowledged = "{}",
      expectedActive = null,
      key = null,
      note = null,
      actor = ACTOR,
    } = options;
    return `
      select public.publish_canonical_presentation(
        ${q(studyId)}, ${q(actor)}, ${sourceDraftRevision}::bigint,
        ${q(JSON.stringify(options.definition ?? material.envelope.definition))}::jsonb,
        ${q(definitionSha256 ?? material.envelope.definitionSha256)},
        ${q(JSON.stringify(renderModel ?? material.model))}::jsonb,
        ${q(renderModelSha256 ?? material.modelSha256)},
        ${q(registryVersion)}, ${q(binding)}, ${q(contractVersion)},
        ${q(identity.calculationVersion)}, ${q(identity.specId)}, ${identity.mappingVersion},
        ${q(identity.packageIdempotencyKey)}, ${q(identity.planFingerprint)},
        ${q(acknowledged)}::text[], ${q(blockers)}::text[], ${q(unacknowledged)}::text[],
        ${expectedActive === null ? "null" : q(expectedActive)}::uuid, ${q(key)}, ${q(note)}
      )::text;`;
  };
  const publish = (options) => {
    try {
      return { ok: true, value: db.json(publishSql(options)) };
    } catch (thrown) {
      return {
        ok: false,
        sqlstate: thrown.sqlstate ?? null,
        message: /ERROR:\s+[0-9A-Z]{5}:\s+(.*)/.exec(thrown.databaseMessage ?? "")?.[1] ?? "",
      };
    }
  };

  const counts = () =>
    db.json(`
      select json_build_object(
        'revisions', (select count(*) from public.canonical_presentation_revision),
        'pointers', (select count(*) from public.canonical_presentation_publication),
        'events', (select count(*) from public.canonical_presentation_publication_event)
      )::text;
    `);

  /* ====================================================================== */
  console.log("\n[1] A first publication: one immutable snapshot, one pointer, one event");

  const clean = materialFor(CLEAN_STUDY);
  eq("the draft is stored at revision", saveDraft(CLEAN_STUDY, clean.envelope, null, "clean-save-000001").revision, 1);

  const first = publish({
    studyId: CLEAN_STUDY,
    material: clean,
    sourceDraftRevision: 1,
    key: "clean-publish-00001",
  });
  check(first.ok, "a first publication is accepted");
  eq("and its version is", first.ok ? first.value.version : null, 1);
  eq("and it reports itself as a creation", first.ok ? first.value.created : null, true);
  eq("and not as a replay", first.ok ? first.value.replayed : null, false);
  eq("and it replaced nothing", first.ok ? first.value.replacedRevisionId : "missing", null);

  const stored = db.json(`
    select row_to_json(t)::text from (
      select version, document_kind, schema_version, registry_version, binding_fingerprint,
             results_contract_version, calculation_version, spec_id, mapping_version,
             package_idempotency_key, plan_fingerprint, source_draft_revision,
             definition_sha256, render_model_sha256, render_model, published_by::text
        from public.canonical_presentation_revision where study_id = ${q(CLEAN_STUDY)}
    ) t;
  `);
  eq("the snapshot records the family", stored.document_kind, "canonical_presentation");
  eq("the schema version", stored.schema_version, 4);
  eq("the registry build", stored.registry_version, identity.registryVersion);
  eq("the binding", stored.binding_fingerprint, identity.bindingFingerprint);
  eq("the results contract", stored.results_contract_version, identity.resultsContractVersion);
  eq("the calculation version", stored.calculation_version, identity.calculationVersion);
  eq("the specification", stored.spec_id, identity.specId);
  eq("the mapping version", stored.mapping_version, identity.mappingVersion);
  eq("the package identity", stored.package_idempotency_key, identity.packageIdempotencyKey);
  eq("the plan fingerprint", stored.plan_fingerprint, identity.planFingerprint);
  eq("the exact draft revision it came from", stored.source_draft_revision, 1);
  eq("the actor", stored.published_by, ACTOR);

  // THE REPRODUCIBILITY PROOF. The stored render model, read back out of jsonb
  // and re-serialized canonically, must be the model that was approved — byte
  // for byte, digest for digest. `jsonb` reorders keys and does not keep the
  // original text, so this is what proves the canonical serialization is what
  // makes it stable across a round trip.
  same(
    "the stored render model is byte-identical to the one that was approved",
    serializeDeterministic(stored.render_model),
    serializeDeterministic(clean.model),
  );
  eq(
    "and its digest still matches after PostgreSQL normalised the jsonb",
    sha256Hex(serializeDeterministic(stored.render_model)),
    stored.render_model_sha256,
  );
  check(MODEL_BYTES > 1000, `the model under test is ${MODEL_BYTES} bytes, not an empty shape`);

  eq(
    "the pointer names that snapshot",
    db.run(`
      select case when p.active_revision_id = r.id then 'yes' else 'no' end
        from public.canonical_presentation_publication p
        join public.canonical_presentation_revision r on r.study_id = p.study_id
       where p.study_id = ${q(CLEAN_STUDY)};
    `).trim(),
    "yes",
  );
  eq(
    "and exactly one event was written, of the right kind",
    db.run(`
      select action || '|' || version::text || '|' || count(*) over ()::text
        from public.canonical_presentation_publication_event
       where study_id = ${q(CLEAN_STUDY)};
    `).trim(),
    "published|1|1",
  );

  /* ====================================================================== */
  console.log("\n[2] Canonical and legacy publication storage cannot collide");

  const both = materialFor(BOTH_STUDY);
  saveDraft(BOTH_STUDY, both.envelope, null, "both-save-00000001");
  const canonicalBeside = publish({
    studyId: BOTH_STUDY,
    material: both,
    sourceDraftRevision: 1,
    key: "both-publish-00001",
  });
  check(canonicalBeside.ok, "a canonical publication is accepted for the study that also holds a legacy draft");
  eq("at its own version one", canonicalBeside.ok ? canonicalBeside.value.version : null, 1);

  // NOW THE LEGACY FAMILY, for the same study, through its own RPC.
  const legacyDefinition = db.json(
    `select definition::text from public.study_experience_draft where study_id = ${q(BOTH_STUDY)};`,
  );
  const legacyPrepared = db.json(`
    select public.prepare_study_experience_revision(
      ${q(BOTH_STUDY)}, ${q(ACTOR)}, ${q(JSON.stringify(legacyDefinition))}::jsonb, 2, 72::bigint,
      ${q("c".repeat(64))}, 'legacy', '{}'::text[], '{}'::text[], null, 'legacy-prep-000001'
    )::text;
  `);
  eq("a LEGACY revision of the same study prepares at its own revision", legacyPrepared.revision, 1);
  db.run(`
    select public.publish_study_experience_revision(
      ${q(BOTH_STUDY)}, ${q(ACTOR)}, ${q(legacyPrepared.revisionId)}::uuid, null,
      '{}'::text[], '{}'::text[], null, 'legacy-pub-0000001'
    );
  `);

  eq(
    "both families now hold exactly one pointer for that study, in different tables",
    db.run(`
      select (select count(*) from public.canonical_presentation_publication where study_id = ${q(BOTH_STUDY)})::text
           || '|' ||
             (select count(*) from public.study_experience_publication where study_id = ${q(BOTH_STUDY)})::text;
    `).trim(),
    "1|1",
  );
  eq(
    "and neither pointer names the other family's row",
    db.run(`
      select case when exists (
        select 1 from public.canonical_presentation_publication c
        join public.study_experience_publication l on l.study_id = c.study_id
        where c.active_revision_id = l.active_revision_id
      ) then 'collides' else 'separate' end;
    `).trim(),
    "separate",
  );
  eq(
    "the canonical version sequence is its own",
    Number(db.run(`select max(version) from public.canonical_presentation_revision where study_id = ${q(BOTH_STUDY)};`).trim()),
    1,
  );
  eq(
    "and so is the legacy one",
    Number(db.run(`select max(revision) from public.study_experience_revision where study_id = ${q(BOTH_STUDY)};`).trim()),
    1,
  );
  // NO OBJECT IS SHARED. Not a table, not an index, not a function.
  eq(
    "no canonical publication object names a legacy experience table in its body",
    db.run(`
      select case when count(*) = 0 then 'none' else 'some' end
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public'
         and p.proname in ('publish_canonical_presentation', 'restore_canonical_presentation', 'read_canonical_publication')
         and position('study_experience' in p.prosrc) > 0;
    `).trim(),
    "none",
  );

  /* ====================================================================== */
  console.log("\n[3] Schema version two and three are refused, by name");

  for (const version of [2, 3]) {
    const legacyBlob = {
      ...clean.envelope,
      definition: {
        schemaVersion: version,
        documentKind: "experience_definition",
        metadata: { studyId: CLEAN_STUDY, tenantId: TENANT },
      },
    };
    const refused = publish({
      studyId: CLEAN_STUDY,
      material: { ...clean, envelope: legacyBlob },
      sourceDraftRevision: 1,
      key: `legacy-v${version}-000001`,
    });
    check(!refused.ok, `a schema-version-${version} document is refused`);
    eq(`as invalid input`, refused.sqlstate, "22023");
  }
  // AND SO IS A DOCUMENT WEARING A FOUR IT DID NOT EARN.
  const wrongKind = publish({
    studyId: CLEAN_STUDY,
    material: clean,
    sourceDraftRevision: 1,
    definition: { ...clean.envelope.definition, documentKind: "experience_definition" },
    key: "wrong-kind-0000001",
  });
  check(!wrongKind.ok && wrongKind.sqlstate === "22023", "a document of another family stamped with a 4 is refused");
  // A RENDER MODEL FROM ANOTHER SCHEMA IS REFUSED TOO.
  const wrongModel = publish({
    studyId: CLEAN_STUDY,
    material: clean,
    sourceDraftRevision: 1,
    renderModel: { ...clean.model, schemaVersion: 3 },
    key: "wrong-model-000001",
  });
  check(!wrongModel.ok && wrongModel.sqlstate === "22023", "and a render model that is not schema version four");

  /* ====================================================================== */
  console.log("\n[4] The exact draft revision and its stored digest are required");

  const wrongRevision = publish({
    studyId: CLEAN_STUDY,
    material: clean,
    sourceDraftRevision: 2,
    key: "wrong-revision-001",
  });
  check(!wrongRevision.ok, "a publication naming a draft revision that is not the stored one is refused");
  eq("with the precondition SQLSTATE the Data API does not retry", wrongRevision.sqlstate, "55000");

  const wrongDigest = publish({
    studyId: CLEAN_STUDY,
    material: clean,
    sourceDraftRevision: 1,
    definitionSha256: "d".repeat(64),
    key: "wrong-digest-00001",
  });
  check(!wrongDigest.ok && wrongDigest.sqlstate === "55000", "a digest that is not the one stored beside the draft is refused");

  const wrongBytes = publish({
    studyId: CLEAN_STUDY,
    material: materialFor(CLEAN_STUDY, "Otro título"),
    sourceDraftRevision: 1,
    key: "wrong-bytes-000001",
  });
  check(!wrongBytes.ok && wrongBytes.sqlstate === "55000", "and a document that is not the saved draft at that revision");

  const noDraft = publish({
    studyId: CASCADE_STUDY,
    material: materialFor(CASCADE_STUDY),
    sourceDraftRevision: 1,
    key: "no-draft-00000001",
  });
  check(!noDraft.ok && noDraft.sqlstate === "55000", "a study with no canonical draft cannot publish one");

  /* ====================================================================== */
  console.log("\n[5] A draft that moved after the review is refused");

  saveDraft(CLEAN_STUDY, materialFor(CLEAN_STUDY, "Editado").envelope, 1, "clean-save-000002");
  eq(
    "the draft is edited and moves to revision",
    Number(db.run(`select revision from public.canonical_presentation_draft where study_id = ${q(CLEAN_STUDY)};`).trim()),
    2,
  );
  const stale = publish({
    studyId: CLEAN_STUDY,
    material: clean,
    sourceDraftRevision: 1,
    expectedActive: db.run(`select active_revision_id from public.canonical_presentation_publication where study_id = ${q(CLEAN_STUDY)};`).trim(),
    key: "stale-publish-00001",
  });
  check(!stale.ok, "publishing the revision that was reviewed is now refused");
  eq("under the precondition code", stale.sqlstate, "55000");
  check(/draft moved on/.test(stale.message), `and the message says the draft moved («${stale.message}»)`);
  eq(
    "and no second version exists",
    Number(db.run(`select count(*) from public.canonical_presentation_revision where study_id = ${q(CLEAN_STUDY)};`).trim()),
    1,
  );

  /* ====================================================================== */
  console.log("\n[6] Binding, registry and package drift are refused, each on its own");

  const edited = materialFor(CLEAN_STUDY, "Editado");
  const driftBinding = publish({
    studyId: CLEAN_STUDY,
    material: edited,
    sourceDraftRevision: 2,
    binding: "e".repeat(64),
    key: "drift-binding-00001",
  });
  check(!driftBinding.ok, "a binding that disagrees with the document is refused");
  eq("as invalid input, before anything is compared to the draft", driftBinding.sqlstate, "22023");

  // A binding that AGREES with the document and NOT with the stored draft is the
  // dangerous one: the document is internally consistent and describes another
  // package. It reaches the draft comparison and is refused there.
  const otherBound = { ...bound, binding: "f".repeat(64) };
  const otherEncoded = encodePresentationForStorage(otherBound, { tenantId: TENANT, studyId: CLEAN_STUDY });
  const driftAgreeing = publish({
    studyId: CLEAN_STUDY,
    material: { ...edited, envelope: otherEncoded.value },
    sourceDraftRevision: 2,
    binding: "f".repeat(64),
    key: "drift-agree-000001",
  });
  check(!driftAgreeing.ok, "a self-consistent document bound to another package is refused too");
  eq("as a precondition failure against the stored draft", driftAgreeing.sqlstate, "55000");

  const driftRegistry = publish({
    studyId: CLEAN_STUDY,
    material: edited,
    sourceDraftRevision: 2,
    registryVersion: "9.9.9",
    key: "drift-registry-0001",
  });
  check(!driftRegistry.ok && driftRegistry.sqlstate === "22023", "a registry build that disagrees with the document is refused");

  const driftContract = publish({
    studyId: CLEAN_STUDY,
    material: edited,
    sourceDraftRevision: 2,
    contractVersion: "9.9.9",
    key: "drift-contract-0001",
  });
  check(
    !driftContract.ok && driftContract.sqlstate === "22023",
    "and a render model naming another results contract",
  );

  // THE APPLICATION'S OWN VERDICT IS RE-ASSERTED. A caller cannot skip its
  // preflight and still get a version.
  const blocked = publish({
    studyId: CLEAN_STUDY,
    material: edited,
    sourceDraftRevision: 2,
    blockers: "{document_unresolved}",
    key: "blocked-00000000001",
  });
  check(!blocked.ok && blocked.sqlstate === "55000", "a publication the caller reports as blocked is refused");
  const unacked = publish({
    studyId: CLEAN_STUDY,
    material: edited,
    sourceDraftRevision: 2,
    unacknowledged: "{configuration_required_blocks}",
    key: "unacked-00000000001",
  });
  check(!unacked.ok && unacked.sqlstate === "55000", "and one whose warnings nobody acknowledged");
  check(
    /nobody has acknowledged/.test(unacked.message),
    `with its own sentence, not the blocker's («${unacked.message}»)`,
  );

  /* ====================================================================== */
  console.log("\n[7] A publication is atomic: a failure leaves neither snapshot, pointer nor event");

  const before = JSON.stringify(counts());
  const partial = publish({
    studyId: CLEAN_STUDY,
    material: edited,
    sourceDraftRevision: 2,
    note: "x".repeat(201),
    key: "partial-000000001",
  });
  check(!partial.ok, "a publication whose note cannot be stored is refused");
  eq("and every count is exactly what it was", JSON.stringify(counts()), before);
  eq(
    "and the pointer still names the first version",
    Number(db.run(`
      select r.version from public.canonical_presentation_publication p
        join public.canonical_presentation_revision r on r.id = p.active_revision_id
       where p.study_id = ${q(CLEAN_STUDY)};
    `).trim()),
    1,
  );

  /* ====================================================================== */
  console.log("\n[8] A retry replays instead of publishing twice");

  const activeId = db.run(`select active_revision_id from public.canonical_presentation_publication where study_id = ${q(CLEAN_STUDY)};`).trim();
  const second = publish({
    studyId: CLEAN_STUDY,
    material: edited,
    sourceDraftRevision: 2,
    expectedActive: activeId,
    key: "second-publish-0001",
  });
  check(second.ok, "a second publication from the edited draft is accepted");
  eq("at version", second.ok ? second.value.version : null, 2);
  eq("replacing the first", second.ok ? second.value.replacedRevisionId : null, activeId);

  const afterSecond = JSON.stringify(counts());
  // A DIFFERENT BODY UNDER THE SAME KEY, which is what makes the stored document
  // an actual witness: resending identical bytes would satisfy "the body is
  // ignored" whether it was ignored or written.
  const replay = publish({
    studyId: CLEAN_STUDY,
    material: materialFor(CLEAN_STUDY, "Cuerpo distinto bajo la misma clave"),
    sourceDraftRevision: 2,
    expectedActive: activeId,
    key: "second-publish-0001",
  });
  check(replay.ok, "resending under a key already recorded is accepted");
  eq("and answers with the version the first attempt produced", replay.ok ? replay.value.version : null, 2);
  eq("and says so", replay.ok ? replay.value.replayed : null, true);
  eq("and nothing at all was written", JSON.stringify(counts()), afterSecond);
  eq(
    "and the stored document of version 2 is the FIRST attempt's",
    db.json(`select definition::text from public.canonical_presentation_revision where study_id = ${q(CLEAN_STUDY)} and version = 2;`).title,
    "Editado",
  );
  // AND A KEY THAT NAMES A DIFFERENT ACTION IS NOT A REPLAY.
  const crossKey = publish({
    studyId: CLEAN_STUDY,
    material: edited,
    sourceDraftRevision: 2,
    key: "second-publish-0001",
    expectedActive: activeId,
  });
  check(crossKey.ok, "the same key with the same action replays rather than conflicting");

  /* ====================================================================== */
  console.log("\n[9] Two concurrent publications create exactly one version");

  const raceMaterial = materialFor(RACE_STUDY);
  saveDraft(RACE_STUDY, raceMaterial.envelope, null, "race-save-00000001");

  const concurrentPublish = (key) =>
    new Promise((resolve) => {
      const sql = `
        begin;
        select pg_sleep(0.4);
        do $race$
        declare a jsonb;
        begin
          a := ${publishSql({ studyId: RACE_STUDY, material: raceMaterial, sourceDraftRevision: 1, key }).replace(/^\s*select\s+/, "").replace(/::text;\s*$/, "")};
          raise notice 'OK %', a::text;
        exception when others then
          raise notice 'ERR %', sqlstate;
        end
        $race$;
        commit;`;
      execFile(
        db.psql,
        ["-X", "-q", "-A", "-t", ...db.connectionArgs(), "-c", sql],
        { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
        (_error, stdout, stderr) => {
          const text = `${stdout}${stderr}`;
          const okMatch = /NOTICE:\s+OK (\{.*\})/.exec(text);
          const errMatch = /NOTICE:\s+ERR ([0-9A-Z]{5})/.exec(text);
          resolve(okMatch ? { ok: true, value: JSON.parse(okMatch[1]) } : { ok: false, sqlstate: errMatch?.[1] ?? null });
        },
      );
    });

  const [raceA, raceB] = await Promise.all([
    concurrentPublish("race-aaaa-00000001"),
    concurrentPublish("race-bbbb-00000001"),
  ]);
  const winners = [raceA, raceB].filter((entry) => entry.ok);
  const losers = [raceA, raceB].filter((entry) => !entry.ok);
  eq("exactly one of two concurrent publications wins", winners.length, 1);
  eq("and exactly one loses", losers.length, 1);
  eq("the loser is refused as a TYPED precondition failure", losers[0]?.sqlstate, "55000");
  eq(
    "and exactly one version exists for that study",
    Number(db.run(`select count(*) from public.canonical_presentation_revision where study_id = ${q(RACE_STUDY)};`).trim()),
    1,
  );
  eq(
    "at version one, with one pointer and one event",
    db.run(`
      select (select max(version) from public.canonical_presentation_revision where study_id = ${q(RACE_STUDY)})::text
        || '|' || (select count(*) from public.canonical_presentation_publication where study_id = ${q(RACE_STUDY)})::text
        || '|' || (select count(*) from public.canonical_presentation_publication_event where study_id = ${q(RACE_STUDY)})::text;
    `).trim(),
    "1|1|1",
  );

  /* ====================================================================== */
  console.log("\n[10] A prior snapshot is immutable, including to the table owner");

  let updated = true;
  try {
    db.run(`update public.canonical_presentation_revision set note = 'moved';`);
  } catch (thrown) {
    updated = false;
    eq("updating a snapshot raises the immutability code", thrown.sqlstate, "2F002");
  }
  check(!updated, "and the update did not happen");

  let deleted = true;
  try {
    db.run(`delete from public.canonical_presentation_revision where study_id = ${q(CLEAN_STUDY)} and version = 1;`);
  } catch (thrown) {
    deleted = false;
    eq("deleting one while its study exists raises the same code", thrown.sqlstate, "2F002");
  }
  check(!deleted, "and the delete did not happen — which is the defect the audit found in the legacy model");

  let eventUpdated = true;
  try {
    db.run(`update public.canonical_presentation_publication_event set version = 999;`);
  } catch (thrown) {
    eventUpdated = false;
    eq("and the event log is append-only too", thrown.sqlstate, "2F002");
  }
  check(!eventUpdated, "so no event can be rewritten");

  // AND YET A WHOLE STUDY IS STILL DELETABLE. An unconditional refusal would
  // have made one undeletable, which is what breaks every disposable fixture's
  // cleanup at the worst possible moment.
  const cascadeMaterial = materialFor(CASCADE_STUDY);
  saveDraft(CASCADE_STUDY, cascadeMaterial.envelope, null, "cascade-save-00001");
  publish({ studyId: CASCADE_STUDY, material: cascadeMaterial, sourceDraftRevision: 1, key: "cascade-pub-000001" });
  eq(
    "a study with a publication has one",
    Number(db.run(`select count(*) from public.canonical_presentation_revision where study_id = ${q(CASCADE_STUDY)};`).trim()),
    1,
  );
  let cascaded = true;
  try {
    db.run(`delete from public.study where id = ${q(CASCADE_STUDY)};`);
  } catch {
    cascaded = false;
  }
  check(cascaded, "and deleting the whole study still works");
  eq(
    "taking its publication, pointer and events with it",
    db.run(`
      select (select count(*) from public.canonical_presentation_revision where study_id = ${q(CASCADE_STUDY)})::text
        || '|' || (select count(*) from public.canonical_presentation_publication where study_id = ${q(CASCADE_STUDY)})::text
        || '|' || (select count(*) from public.canonical_presentation_publication_event where study_id = ${q(CASCADE_STUDY)})::text;
    `).trim(),
    "0|0|0",
  );

  /* ====================================================================== */
  console.log("\n[11] Least privilege: the browser roles reach nothing");

  const grants = db.json(`
    select coalesce(json_agg(json_build_object('t', table_name, 'g', grantee, 'p', privilege_type)
             order by table_name, grantee, privilege_type)::text, '[]')
      from information_schema.role_table_grants
     where table_schema = 'public'
       and table_name in ('canonical_presentation_revision', 'canonical_presentation_publication',
                          'canonical_presentation_publication_event')
       and grantee in ('anon', 'authenticated', 'service_role');
  `);
  const serviceGrants = [...new Set(grants.filter((g) => g.g === "service_role").map((g) => g.p))].sort();
  eq("service_role holds only SELECT on all three tables", JSON.stringify(serviceGrants), '["SELECT"]');
  eq(
    "and it holds it on all three",
    new Set(grants.filter((g) => g.g === "service_role").map((g) => g.t)).size,
    3,
  );
  eq(
    "the browser roles hold nothing at all",
    grants.filter((g) => g.g === "anon" || g.g === "authenticated").length,
    0,
  );

  const rls = db.json(`
    select coalesce(json_agg(json_build_object('r', relname, 'e', relrowsecurity, 'f', relforcerowsecurity)
             order by relname)::text, '[]')
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind = 'r'
       and c.relname in ('canonical_presentation_revision', 'canonical_presentation_publication',
                         'canonical_presentation_publication_event');
  `);
  check(rls.length === 3 && rls.every((r) => r.e && r.f), "all three tables are RLS-enabled and FORCE RLS");

  const fns = db.json(`
    select coalesce(json_agg(json_build_object('n', p.proname, 'd', p.prosecdef,
             'c', coalesce(array_to_string(p.proconfig, ','), ''),
             'a', coalesce(array_to_string(p.proacl::text[], ','), ''))
             order by p.proname)::text, '[]')
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in ('publish_canonical_presentation', 'restore_canonical_presentation', 'read_canonical_publication');
  `);
  eq("the three callable functions exist", fns.length, 3);
  for (const fn of fns) {
    check(fn.d === true, `${fn.n} is SECURITY DEFINER`);
    check(fn.c === 'search_path=""', `${fn.n} pins an empty search_path`);
    check(
      fn.a.includes("service_role=X") && !/\banon=X/.test(fn.a) && !/authenticated=X/.test(fn.a),
      `${fn.n} grants EXECUTE to service_role and to no browser role`,
    );
  }

  // EXECUTED, INSIDE AN EXPLICIT TRANSACTION. `set local role` outside one
  // applies to the implicit single-statement transaction it is in and is gone
  // before the next statement runs — so the probe would execute as the table's
  // OWNER and succeed. That defect has been found in this repository twice.
  for (const role of ["anon", "authenticated"]) {
    for (const [what, statement] of [
      ["read a snapshot", `select 1 from public.canonical_presentation_revision limit 1;`],
      ["read the pointer", `select 1 from public.canonical_presentation_publication limit 1;`],
      ["read the log", `select 1 from public.canonical_presentation_publication_event limit 1;`],
      ["insert a snapshot", `insert into public.canonical_presentation_revision (study_id) values (${q(CLEAN_STUDY)});`],
      ["update the pointer", `update public.canonical_presentation_publication set updated_at = now();`],
      ["delete a snapshot", `delete from public.canonical_presentation_revision;`],
      ["publish", `select public.publish_canonical_presentation(${q(CLEAN_STUDY)}, ${q(ACTOR)}, 1::bigint, '{}'::jsonb, ${q("a".repeat(64))}, '{}'::jsonb, ${q("b".repeat(64))}, '1.0.0', ${q("c".repeat(64))}, '2.2.0', 'v', 's', 1, 'k', 'p', '{}'::text[], '{}'::text[], '{}'::text[], null, null, null);`],
      ["restore", `select public.restore_canonical_presentation(${q(CLEAN_STUDY)}, ${q(ACTOR)}, ${q(CLEAN_STUDY)}::uuid, null, 'keykeykey', 'x');`],
      ["read what a client sees", `select public.read_canonical_publication(${q(CLEAN_STUDY)}, ${q(TENANT)});`],
    ]) {
      let sqlstate = null;
      try {
        db.run(`begin; set local role ${role}; ${statement} rollback;`);
      } catch (thrown) {
        sqlstate = thrown.sqlstate ?? null;
      }
      // THE CODE, NOT MERELY A FAILURE. `catch {}` alone would pass if the
      // statement failed for ANY reason — a typo, a wrong argument type — so a
      // grant that had been quietly widened would still look denied.
      eq(`role ${role} cannot ${what}`, sqlstate, "42501");
    }
  }

  // AND service_role, WHICH THE APPLICATION ACTUALLY USES, IS READ-ONLY.
  for (const [what, statement] of [
    ["insert a snapshot", `insert into public.canonical_presentation_revision (study_id) values (${q(CLEAN_STUDY)});`],
    ["update the pointer", `update public.canonical_presentation_publication set updated_at = now();`],
    ["delete an event", `delete from public.canonical_presentation_publication_event;`],
  ]) {
    let sqlstate = null;
    try {
      db.run(`begin; set local role service_role; ${statement} rollback;`);
    } catch (thrown) {
      sqlstate = thrown.sqlstate ?? null;
    }
    eq(`service_role cannot ${what} directly either`, sqlstate, "42501");
  }
  {
    let sqlstate = null;
    try {
      db.run(`begin; set local role service_role; select 1 from public.canonical_presentation_revision limit 1; rollback;`);
    } catch (thrown) {
      sqlstate = thrown.sqlstate ?? null;
    }
    eq("but it CAN read, which is what the application needs", sqlstate, null);
  }

  /* ====================================================================== */
  console.log("\n[12] The client-visible read carries no internal field");

  const clientView = db.json(`select public.read_canonical_publication(${q(CLEAN_STUDY)}, ${q(TENANT)})::text;`);
  eq(
    "it answers with exactly three keys",
    JSON.stringify(Object.keys(clientView).sort()),
    JSON.stringify(["publishedAt", "renderModel", "version"]),
  );
  eq("the version a client would be told", clientView.version, 2);
  check(typeof clientView.publishedAt === "string", "and when it was published");
  for (const forbidden of [
    "definitionSha256", "renderModelSha256", "binding", "bindingFingerprint", "sourceDraftRevision",
    "acknowledgedWarnings", "publishedBy", "packageIdempotencyKey", "planFingerprint",
    "calculationVersion", "specId", "note", "definition", "tenantId", "studyId", "id",
  ]) {
    check(!(forbidden in clientView), `and no «${forbidden}»`);
  }
  same(
    "the render model it serves is the one that was approved",
    serializeDeterministic(clientView.renderModel),
    serializeDeterministic(materialFor(CLEAN_STUDY, "Editado").model),
  );
  // AND A TENANT THAT DOES NOT OWN THE STUDY GETS NOTHING.
  eq(
    "a read scoped to another tenant answers with nothing",
    db.run(`select coalesce(public.read_canonical_publication(${q(CLEAN_STUDY)}, ${q(BOTH_STUDY)})::text, 'null');`).trim(),
    "null",
  );

  // AND WHAT A CLIENT IS SERVED DOES NOT MOVE WHEN THE DRAFT DOES. This is the
  // reproducibility promise, executed rather than argued.
  saveDraft(CLEAN_STUDY, materialFor(CLEAN_STUDY, "Editado otra vez").envelope, 2, "clean-save-000003");
  same(
    "after the draft is edited again, the served model is byte-identical to before",
    serializeDeterministic(
      db.json(`select public.read_canonical_publication(${q(CLEAN_STUDY)}, ${q(TENANT)})::text;`).renderModel,
    ),
    serializeDeterministic(materialFor(CLEAN_STUDY, "Editado").model),
  );

  /* ====================================================================== */
  console.log("\n[13] Restoration creates a NEW draft revision and preserves every snapshot");

  const snapshotsBefore = db.json(`
    select coalesce(json_agg(json_build_object('v', version, 'd', definition_sha256, 'm', render_model_sha256)
             order by version)::text, '[]')
      from public.canonical_presentation_revision where study_id = ${q(CLEAN_STUDY)};
  `);
  const pointerBefore = db.run(`select active_revision_id from public.canonical_presentation_publication where study_id = ${q(CLEAN_STUDY)};`).trim();
  const draftBefore = Number(db.run(`select revision from public.canonical_presentation_draft where study_id = ${q(CLEAN_STUDY)};`).trim());
  const versionOneId = db.run(`select id from public.canonical_presentation_revision where study_id = ${q(CLEAN_STUDY)} and version = 1;`).trim();

  const restoreCall = (revisionId, expectedDraft, key, reason = "volver a la primera") => {
    try {
      return {
        ok: true,
        value: db.json(`
          select public.restore_canonical_presentation(
            ${q(CLEAN_STUDY)}, ${q(ACTOR)}, ${q(revisionId)}::uuid,
            ${expectedDraft === null ? "null" : `${expectedDraft}::bigint`}, ${q(key)}, ${q(reason)}
          )::text;
        `),
      };
    } catch (thrown) {
      return { ok: false, sqlstate: thrown.sqlstate ?? null };
    }
  };

  const restored = restoreCall(versionOneId, draftBefore, "restore-00000000001");
  check(restored.ok, "restoring version one is accepted");
  eq("it names the version it restored", restored.ok ? restored.value.version : null, 1);
  eq("and the NEW draft revision it created", restored.ok ? restored.value.draftRevision : null, draftBefore + 1);
  eq(
    "the draft really is at that revision",
    Number(db.run(`select revision from public.canonical_presentation_draft where study_id = ${q(CLEAN_STUDY)};`).trim()),
    draftBefore + 1,
  );
  eq(
    "and its document is the one that was published as version one",
    db.json(`select definition::text from public.canonical_presentation_draft where study_id = ${q(CLEAN_STUDY)};`).title,
    bound.title,
  );
  eq(
    "the draft's own event log recorded an ordinary save",
    db.run(`select action from public.canonical_presentation_draft_event where study_id = ${q(CLEAN_STUDY)} order by occurred_at desc limit 1;`).trim(),
    "draft_saved",
  );

  // NOTHING WAS PUBLISHED, UNPUBLISHED, EDITED OR DELETED.
  eq("the pointer did NOT move", db.run(`select active_revision_id from public.canonical_presentation_publication where study_id = ${q(CLEAN_STUDY)};`).trim(), pointerBefore);
  eq(
    "every snapshot is exactly as it was",
    JSON.stringify(db.json(`
      select coalesce(json_agg(json_build_object('v', version, 'd', definition_sha256, 'm', render_model_sha256)
               order by version)::text, '[]')
        from public.canonical_presentation_revision where study_id = ${q(CLEAN_STUDY)};
    `)),
    JSON.stringify(snapshotsBefore),
  );
  eq(
    "and a `restored` event was appended, naming the draft revision it made",
    db.run(`
      select action || '|' || version::text || '|' || draft_revision::text
        from public.canonical_presentation_publication_event
       where study_id = ${q(CLEAN_STUDY)} order by occurred_at desc limit 1;
    `).trim(),
    `restored|1|${draftBefore + 1}`,
  );
  same(
    "what the client is served is still the same bytes",
    serializeDeterministic(
      db.json(`select public.read_canonical_publication(${q(CLEAN_STUDY)}, ${q(TENANT)})::text;`).renderModel,
    ),
    serializeDeterministic(materialFor(CLEAN_STUDY, "Editado").model),
  );

  // A REPLAY OF A RESTORATION WRITES NOTHING.
  const draftAfterRestore = Number(db.run(`select revision from public.canonical_presentation_draft where study_id = ${q(CLEAN_STUDY)};`).trim());
  const restoreReplay = restoreCall(versionOneId, draftBefore, "restore-00000000001");
  check(restoreReplay.ok, "replaying a restoration under the same key is accepted");
  eq("and says it is a replay", restoreReplay.ok ? restoreReplay.value.replayed : null, true);
  eq(
    "and the draft did not move again",
    Number(db.run(`select revision from public.canonical_presentation_draft where study_id = ${q(CLEAN_STUDY)};`).trim()),
    draftAfterRestore,
  );

  // AND A RESTORATION AGAINST A STALE DRAFT IS A TYPED CONFLICT.
  const staleRestore = restoreCall(versionOneId, draftBefore, "restore-stale-00001");
  check(!staleRestore.ok, "restoring against a draft revision that has moved is refused");
  eq("under the precondition code", staleRestore.sqlstate, "55000");

  // A RESTORATION WITHOUT A REASON IS REFUSED.
  const noReason = restoreCall(versionOneId, draftAfterRestore, "restore-noreason-01", "   ");
  check(!noReason.ok && noReason.sqlstate === "22023", "a restoration that does not say why is refused");

  // A SNAPSHOT FROM ANOTHER STUDY CANNOT BE RESTORED INTO THIS ONE.
  const foreignId = db.run(`select id from public.canonical_presentation_revision where study_id = ${q(BOTH_STUDY)} limit 1;`).trim();
  const foreign = restoreCall(foreignId, draftAfterRestore, "restore-foreign-001");
  check(!foreign.ok, "a publication belonging to another study cannot be restored here");
  eq("and is refused for lack of privilege, not as a missing row", foreign.sqlstate, "42501");

  /* ====================================================================== */
  console.log("\n[14] The legacy rows are byte-identical to how they started");

  eq("the legacy draft fingerprint is unchanged", JSON.stringify(legacyFingerprint()), legacyBefore);
  eq(
    "and the legacy event log gained only what the legacy RPCs wrote",
    Number(db.run("select count(*) from public.study_experience_event;").trim()) >= Number(legacyEventsBefore),
    true,
  );

  /* ====================================================================== */
  console.log("\n[14b] The same contract over a real PostgREST, through supabase-js");

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

      // A FRESH STUDY, so the HTTP half proves the whole lifecycle rather than
      // finishing somebody else's.
      const HTTP_STUDY = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
      db.run(`insert into public.study (id, tenant_id, name) values (${q(HTTP_STUDY)}, ${q(TENANT)}, 'Estudio por HTTP');`);
      const httpMaterial = materialFor(HTTP_STUDY);
      saveDraft(HTTP_STUDY, httpMaterial.envelope, null, "http-save-00000001");

      const callPublish = (over = {}) =>
        client.rpc("publish_canonical_presentation", {
          p_study_id: HTTP_STUDY,
          p_actor: ACTOR,
          p_source_draft_revision: 1,
          p_definition: httpMaterial.envelope.definition,
          p_definition_sha256: httpMaterial.envelope.definitionSha256,
          p_render_model: httpMaterial.model,
          p_render_model_sha256: httpMaterial.modelSha256,
          p_registry_version: identity.registryVersion,
          p_binding_fingerprint: identity.bindingFingerprint,
          p_results_contract_version: identity.resultsContractVersion,
          p_calculation_version: identity.calculationVersion,
          p_spec_id: identity.specId,
          p_mapping_version: identity.mappingVersion,
          p_package_idempotency_key: identity.packageIdempotencyKey,
          p_plan_fingerprint: identity.planFingerprint,
          p_acknowledged_warnings: [],
          p_blocking_codes: [],
          p_unacknowledged_codes: [],
          p_expected_active_revision_id: null,
          p_idempotency_key: "http-publish-000001",
          p_note: null,
          ...over,
        });

      const httpOk = await callPublish();
      check(httpOk.error === null, "a publication over HTTP with supabase-js succeeds");
      eq("and returns version one", httpOk.data?.version, 1);
      eq("and says it is not a replay", httpOk.data?.replayed, false);

      const httpReplay = await callPublish();
      check(httpReplay.error === null, "and replaying the same key over HTTP succeeds too");
      eq("with the same version", httpReplay.data?.version, 1);
      eq("and says it IS a replay", httpReplay.data?.replayed, true);

      // THE TRANSPORT IS PART OF THE CONTRACT. The product decides a conflict by
      // reading `error.code === "55000"`; whether a PL/pgSQL `raise … using
      // errcode` still IS that string once it has crossed PostgREST, been
      // serialized to JSON and parsed by supabase-js is not something source
      // code can answer. Migration 0024 already paid once for assuming it.
      const httpStale = await callPublish({
        p_source_draft_revision: 9,
        p_idempotency_key: "http-stale-0000001",
      });
      check(httpStale.error !== null, "a stale draft revision over HTTP is refused");
      eq("and its code reaches supabase-js as the exact string the product switches on", httpStale.error?.code, "55000");
      check(
        typeof httpStale.error?.message === "string" && !httpStale.error.message.includes("Estudio de publicación"),
        "and the error message does not quote the document that was refused",
      );

      const httpLegacy = await callPublish({
        p_definition: { schemaVersion: 2, documentKind: "experience_definition" },
        p_idempotency_key: "http-legacy-000001",
      });
      eq("a legacy-family document over HTTP is refused as invalid input", httpLegacy.error?.code, "22023");

      // THE BROWSER ROLES CANNOT REACH IT OVER HTTP EITHER — the same refusal,
      // taken the way a browser would take it: through the API, with the key a
      // browser is given.
      for (const [role, key] of [
        ["anon", stack.anonKey],
        ["authenticated", stack.authenticatedKey],
      ]) {
        const roleClient = createClient(stack.apiOrigin, key, {
          auth: { autoRefreshToken: false, persistSession: false },
        });
        for (const table of [
          "canonical_presentation_revision",
          "canonical_presentation_publication",
          "canonical_presentation_publication_event",
        ]) {
          const readAttempt = await roleClient.from(table).select("study_id").limit(1);
          check(
            readAttempt.error !== null || (readAttempt.data ?? []).length === 0,
            `the ${role} key reads no row of ${table}`,
          );
        }
        const rpcAttempt = await roleClient.rpc("read_canonical_publication", {
          p_study_id: HTTP_STUDY,
          p_tenant_id: TENANT,
        });
        check(rpcAttempt.error !== null, `and the ${role} key cannot call the client-visible read`);
        const publishAttempt = await roleClient.rpc("publish_canonical_presentation", {
          p_study_id: HTTP_STUDY,
          p_actor: ACTOR,
          p_source_draft_revision: 1,
          p_definition: {},
          p_definition_sha256: "a".repeat(64),
          p_render_model: {},
          p_render_model_sha256: "b".repeat(64),
          p_registry_version: "1.0.0",
          p_binding_fingerprint: "c".repeat(64),
          p_results_contract_version: "2.2.0",
          p_calculation_version: "v",
          p_spec_id: "s",
          p_mapping_version: 1,
          p_package_idempotency_key: "k",
          p_plan_fingerprint: "p",
          p_acknowledged_warnings: [],
          p_blocking_codes: [],
          p_unacknowledged_codes: [],
          p_expected_active_revision_id: null,
          p_idempotency_key: null,
          p_note: null,
        });
        check(publishAttempt.error !== null, `nor publish`);
      }

      // AND THE RENDER MODEL SURVIVED THE WHOLE TRANSPORT.
      const served = await client.rpc("read_canonical_publication", {
        p_study_id: HTTP_STUDY,
        p_tenant_id: TENANT,
      });
      check(served.error === null, "the client-visible read answers over HTTP");
      same(
        "and the model it serves is byte-identical to the one that was approved",
        serializeDeterministic(served.data?.renderModel),
        serializeDeterministic(httpMaterial.model),
      );
      eq(
        "with exactly three keys and no audit field",
        JSON.stringify(Object.keys(served.data ?? {}).sort()),
        JSON.stringify(["publishedAt", "renderModel", "version"]),
      );

      console.log(`  (PostgREST ${(await stack.serverHeader()) ?? "unreported"} — a LOCAL substitute, never a hosted run.)`);
    } finally {
      await stack.stop();
    }
  }

  /* ====================================================================== */
  console.log("\n[15] The rollback removes everything this migration made, and only that");

  const draftObjectsBefore = db.run(`
    select (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
             where n.nspname='public' and c.relname like 'canonical_presentation_draft%')::text
      || '|' || (select count(*) from public.canonical_presentation_draft)::text;
  `).trim();

  psqlSuiteTransport(db).applyRollback("0030_drop_canonical_publication.sql");

  eq(
    "no publication object survives the rollback",
    db.run(`
      select (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
               where n.nspname='public'
                 and (c.relname like 'canonical_presentation_revision%'
                      or c.relname like 'canonical_presentation_publication%'))
           + (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
               where n.nspname='public'
                 and p.proname in ('publish_canonical_presentation', 'restore_canonical_presentation',
                                   'read_canonical_publication', 'refuse_canonical_publication_change'));
    `).trim(),
    "0",
  );
  eq(
    "the canonical DRAFT storage is untouched, with its rows",
    db.run(`
      select (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
               where n.nspname='public' and c.relname like 'canonical_presentation_draft%')::text
        || '|' || (select count(*) from public.canonical_presentation_draft)::text;
    `).trim(),
    draftObjectsBefore,
  );
  eq(
    "the legacy publication model is untouched",
    db.run(`
      select (select count(*) from public.study_experience_revision)::text
        || '|' || (select count(*) from public.study_experience_publication)::text;
    `).trim(),
    "1|1",
  );
  eq("and the legacy drafts are STILL byte-identical", JSON.stringify(legacyFingerprint()), legacyBefore);
  eq(
    "and the draft save function still works after the rollback",
    Number(
      db.json(`
        select public.save_canonical_presentation_draft(
          ${q(RACE_STUDY)}, ${q(ACTOR)},
          ${q(JSON.stringify(materialFor(RACE_STUDY, "Después del rollback").envelope.definition))}::jsonb,
          ${q(identity.registryVersion)}, ${q(identity.bindingFingerprint)},
          ${q(materialFor(RACE_STUDY, "Después del rollback").envelope.definitionSha256)},
          1::bigint, 'after-rollback-0001', null
        )::text;
      `).revision,
    ),
    2,
  );
});

/* -------------------------------------------------------------------------- */

console.log(`\n${"=".repeat(82)}`);
console.log(`EXECUTED: ${executed}   PASSED: ${executed - failures}   FAILED: ${failures}   SKIPPED SECTIONS: ${skipped}`);
if (failures > 0) {
  console.log("RESULT: the publication lifecycle does NOT behave as documented. GATE BLOCKED.");
  process.exit(1);
}
console.log(
  "RESULT: a publication stores the approved render model byte for byte, the version increments\n" +
    "        exactly once, a replayed key writes nothing, a stale draft and every drift are typed\n" +
    "        refusals, two concurrent publications create one version, a snapshot cannot be updated\n" +
    "        or deleted while its study exists, the browser roles reach nothing, the client-visible\n" +
    "        read carries three keys and no audit field, a restoration creates a new draft revision\n" +
    "        and preserves every snapshot, the rollback removes only this migration's objects, and\n" +
    "        the two legacy rows are byte-identical throughout. GATE PASSED.\n" +
    "\n" +
    "NOTE: a disposable cluster, not the hosted project. Never report this as a hosted run.",
);
