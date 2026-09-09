// =============================================================================
// UNIT 6B.4B2 — THE QUALITATIVE SIGN-OFF, EXECUTED AGAINST A REAL DATABASE
// =============================================================================
//   bash scripts/lib/disposable-postgres-provision.sh          # once, PG 17
//   BECOMMUNITY_PG_VERSION=17 \
//   CANONICAL_COMMIT_TEST_PGHOST="$HOME/becommunity-pg/socket" \
//   CANONICAL_COMMIT_TEST_PGUSER="$(id -un)" \
//     npm run test:canonical-qualitative-signoff-live
//
// -----------------------------------------------------------------------------
// WHY THIS EXISTS SEPARATELY FROM THE OFFLINE GATE
// -----------------------------------------------------------------------------
// `npm run test:canonical-publication` proves what is a property of a PURE
// FUNCTION: what the digest covers, which state a sign-off is in, which warning
// a state raises. Not one of the guarantees below is that.
//
// A row that cannot be updated, a delete that is refused while its study exists
// and permitted by a cascade, a replay that writes nothing, a publication and
// its qualitative record that are written together or not at all, a claim of
// «reviewed» that the database itself refuses unless a matching row exists — every
// one is a property of PostgreSQL executing migration 0031, and the only way to
// know is to make it happen.
//
// THE NINE PROOFS, and the section that executes each:
//
//   1 the two tables exist, locked down, service_role SELECT only ....... [1]
//   2 an unauthorized or unknown actor cannot record a sign-off ......... [2]
//   3 a malformed digest and an empty category set are refused .......... [2]
//   4 a sign-off is written, and the same words replay without a second .. [3]
//   5 a sign-off is immutable, and deletable only with its study ........ [4]
//   6 publishing writes the qualitative record IN THE SAME TRANSACTION ... [5]
//   7 «current» is refused unless the sign-off matches this study AND
//     this digest .......................................................  [6]
//   8 a REFUSED publication leaves no qualitative record at all .......... [7]
//   9 browser roles reach neither table ................................. [8]
//
// NOTHING HOSTED IS TOUCHED. `resolveDisposableTarget` refuses to run at all if
// a Supabase environment variable is in scope. This is a disposable cluster, and
// it is never to be reported as a hosted run.
// =============================================================================

import {
  DisposableTargetError,
  resolveDisposableTarget,
  withDisposableDatabase,
} from "./lib/disposable-postgres.mjs";
import { psqlSuiteTransport } from "./lib/canonical-psql-transport.mjs";
import { buildPresentationRead, resolveUnderSelection } from "../src/lib/viewer/index.ts";
import { bindPresentationDocument } from "../src/lib/presentation/registry.ts";
import { validatePresentationDocument } from "../src/lib/presentation/document.ts";
import { EMPTY_VIEWER_SELECTION } from "../src/lib/presentation/viewer.ts";
import { buildGenericStartingBlueprint } from "../src/lib/presentation/blueprints/generic-starting.ts";
import { JOURNEY_ROUTES_VARIANTS, offeredChartVariants } from "../src/lib/composer/renderer-capabilities.ts";
import { serializeDeterministic } from "../src/lib/presentation/serialize.ts";
import { encodePresentationForStorage } from "../src/lib/presentation/persistence.ts";
import { sha256Hex } from "../src/lib/ingestion/canonical-commit/sha256.ts";
import { qualitativeEvidenceDigest } from "../src/lib/publication/evidence-digest.ts";
import { composerFixtureSource } from "./lib/composer-fixture.mjs";

let failures = 0;
let executed = 0;
const check = (condition, message) => {
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
const STUDY = "66666666-6666-4666-8666-666666666666";
const OTHER_STUDY = "55555555-5555-4555-8555-555555555555";
/** Deleted at the end, to prove a cascade still works past the immutability trigger. */
const CASCADE_STUDY = "77777777-7777-4777-8777-777777777777";

const q = (value) =>
  value === null || value === undefined ? "null" : `'${String(value).replace(/'/g, "''")}'`;
const arr = (values) => `'{${values.map((v) => `"${String(v).replace(/"/g, '\\"')}"`).join(",")}}'::text[]`;

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

console.log("Be Community — Unit 6B.4B2: the qualitative sign-off against a real PostgreSQL");
console.log("=".repeat(82));

/* ---- the product's own bytes, so a publication here is a real one -------- */

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
  title: "Estudio de firma cualitativa",
});
const validated = validatePresentationDocument(JSON.parse(serializeDeterministic(blueprint)));
if (!validated.ok) {
  console.error("the fixture document does not validate", validated.errors);
  process.exit(1);
}
const bound = bindPresentationDocument(validated.value, built.registry);
const encoded = encodePresentationForStorage(bound, { tenantId: TENANT, studyId: STUDY });
if (!encoded.ok) {
  console.error("encode refused", encoded.errors);
  process.exit(1);
}
const resolved = resolveUnderSelection(built, bound, EMPTY_VIEWER_SELECTION);
if (!resolved.ok) {
  console.error("resolve refused", resolved.issues);
  process.exit(1);
}
const MATERIAL = {
  envelope: encoded.value,
  model: resolved.model,
  modelSha256: sha256Hex(serializeDeterministic(resolved.model)),
};

/** The real digest, over a real category set, from the product's own function. */
const CATEGORY_SET = [
  {
    groupLabel: "Razones declaradas",
    coding: "source_coded",
    categories: ["Tiempo", "Costo", "Resultados"],
    excluded: ["No aplica"],
    blocks: ["Panorama · Miembros activos", "Panorama · Razones declaradas de riesgo"],
  },
];
const DIGEST = qualitativeEvidenceDigest(CATEGORY_SET);
const OTHER_DIGEST = qualitativeEvidenceDigest([
  { ...CATEGORY_SET[0], categories: ["Tiempo", "Costo"] },
]);

await withDisposableDatabase(target, "qualsignoff", async (db) => {
  console.log("\n[setup] bootstrap + migrations 0000-0031");
  psqlSuiteTransport(db).prepare(31);

  db.run(`
    insert into auth.users (id, email) values
      (${q(ACTOR)}, 'internal@example.test'),
      (${q(CLIENT_ACTOR)}, 'client@example.test');
    insert into public.tenant (id, name) values (${q(TENANT)}, 'Probe tenant');
    insert into public.profiles (user_id, tenant_id, role) values
      (${q(ACTOR)}, ${q(TENANT)}, 'internal'),
      (${q(CLIENT_ACTOR)}, ${q(TENANT)}, 'client');
    insert into public.study (id, tenant_id, name) values
      (${q(STUDY)}, ${q(TENANT)}, 'Estudio de firma'),
      (${q(OTHER_STUDY)}, ${q(TENANT)}, 'Otro estudio'),
      (${q(CASCADE_STUDY)}, ${q(TENANT)}, 'Estudio que se borra entero');
  `);

  // THE DATABASE'S OWN MESSAGE IS KEPT. A refusal reported only as a boolean is
  // a mystery, and this gate has already spent one run on `pg_advisory_xact_lock`
  // being called with two bigints when no such overload exists.
  const attempt = (sql) => {
    try {
      return { ok: true, value: db.json(sql) };
    } catch (thrown) {
      return {
        ok: false,
        sqlstate: thrown.sqlstate ?? null,
        message: /ERROR:\s+[0-9A-Z]{5}:\s+(.*)/.exec(thrown.databaseMessage ?? "")?.[1] ?? "",
      };
    }
  };
  /** Report an unexpected refusal WITH what the database said about it. */
  const succeeded = (outcome, message) =>
    check(outcome.ok, outcome.ok ? message : `${message} — ${outcome.sqlstate} ${outcome.message}`);
  const recordSql = (over = {}) => {
    const {
      studyId = STUDY,
      actor = ACTOR,
      digest = DIGEST,
      categories = ["Tiempo", "Costo", "Resultados", "No aplica"],
      blocks = ["Panorama · Miembros activos", "Panorama · Razones declaradas de riesgo"],
    } = over;
    return `select public.record_canonical_qualitative_signoff(
      ${q(studyId)}, ${q(actor)}, ${q(digest)}, ${arr(categories)}, ${arr(blocks)}, null)::text;`;
  };
  const countIn = (table) => Number(db.run(`select count(*) from public.${table};`).trim());

  /* ------------------------------------------------------------------------ */
  console.log("\n[1] Las dos tablas existen, cerradas, y service_role sólo puede LEER");

  for (const table of ["canonical_qualitative_signoff", "canonical_publication_qualitative_signoff"]) {
    eq(
      `${table} existe`,
      db.run(`select to_regclass('public.${table}') is not null;`).trim(),
      "t",
    );
    eq(
      `${table} tiene RLS y FORCE RLS`,
      db.run(
        `select relrowsecurity and relforcerowsecurity from pg_class where oid = 'public.${table}'::regclass;`,
      ).trim(),
      "t",
    );
    eq(
      `y service_role sólo tiene SELECT sobre ${table}`,
      db
        .run(
          `select coalesce(string_agg(distinct privilege_type, ',' order by privilege_type), 'none')
             from information_schema.role_table_grants
            where table_schema = 'public' and table_name = '${table}' and grantee = 'service_role';`,
        )
        .trim(),
      "SELECT",
    );
    eq(
      `y anon/authenticated no tienen ninguno sobre ${table}`,
      db
        .run(
          `select count(*) from information_schema.role_table_grants
            where table_schema = 'public' and table_name = '${table}'
              and grantee in ('anon', 'authenticated');`,
        )
        .trim(),
      "0",
    );
  }
  eq(
    "las dos funciones de escritura son SECURITY DEFINER",
    db
      .run(
        `select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public' and p.prosecdef
            and p.proname in ('record_canonical_qualitative_signoff',
                              'publish_canonical_presentation_with_qualitative');`,
      )
      .trim(),
    "2",
  );
  // AND `publish_canonical_presentation` IS STILL THERE, UNREPLACED. 0031 wraps
  // applied history rather than rewriting it, and the wrapper is worthless if
  // the thing it wraps has been quietly redefined.
  eq(
    "y `publish_canonical_presentation` sigue existiendo, sin reemplazar",
    db
      .run(
        `select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public' and p.proname = 'publish_canonical_presentation';`,
      )
      .trim(),
    "1",
  );

  /* ------------------------------------------------------------------------ */
  console.log("\n[2] Quién puede registrar una revisión, y qué se rechaza antes de escribir");

  eq(
    "un actor con rol de cliente es rechazado",
    attempt(recordSql({ actor: CLIENT_ACTOR })).sqlstate,
    "42501",
  );
  eq(
    "un actor nulo también",
    attempt(recordSql({ actor: null })).sqlstate,
    "42501",
  );
  eq(
    "un estudio que no existe es rechazado, y no como un fallo de permisos",
    attempt(recordSql({ studyId: "00000000-0000-4000-8000-000000000000" })).sqlstate,
    "P0002",
  );
  eq(
    "una huella con la forma equivocada es rechazada",
    attempt(recordSql({ digest: "no-es-una-huella" })).sqlstate,
    "22023",
  );
  eq(
    "y una revisión que no nombra ninguna categoría también",
    attempt(recordSql({ categories: [] })).sqlstate,
    "22023",
  );
  eq("y nada de eso escribió una fila", countIn("canonical_qualitative_signoff"), 0);

  /* ------------------------------------------------------------------------ */
  console.log("\n[3] Se registra una vez, y las mismas palabras no se registran dos veces");

  const first = attempt(recordSql());
  succeeded(first, "una revisión legítima se registra");
  eq("y se declara creada", first.value?.created, true);
  eq("una fila", countIn("canonical_qualitative_signoff"), 1);
  eq(
    "y guarda las palabras, no sólo la huella",
    db.run(`select cardinality(category_labels) from public.canonical_qualitative_signoff;`).trim(),
    "4",
  );
  eq(
    "y los bloques que las dibujan",
    db.run(`select cardinality(block_titles) from public.canonical_qualitative_signoff;`).trim(),
    "2",
  );

  const replay = attempt(recordSql());
  succeeded(replay, "registrar las MISMAS palabras otra vez responde");
  eq("y dice que no creó nada", replay.value?.created, false);
  eq("sigue habiendo una sola fila", countIn("canonical_qualitative_signoff"), 1);
  eq("y devuelve la misma firma", replay.value?.signoffId, first.value?.signoffId);

  // DIFFERENT WORDS ARE A DIFFERENT DECISION.
  const second = attempt(recordSql({ digest: OTHER_DIGEST, categories: ["Tiempo", "Costo"] }));
  succeeded(second, "otras palabras SÍ son una segunda decisión");
  eq("y ahora hay dos", countIn("canonical_qualitative_signoff"), 2);

  /* ------------------------------------------------------------------------ */
  console.log("\n[4] Una revisión es inmutable, y sólo se va con su estudio");

  const signoffId = first.value.signoffId;
  eq(
    "actualizarla es rechazado como inmutable",
    attempt(
      `select (update_result)::text from (
         update public.canonical_qualitative_signoff set note = 'editado'
          where id = ${q(signoffId)} returning 1 as update_result) u;`,
    ).sqlstate,
    "2F002",
  );
  eq(
    "borrarla mientras su estudio existe, también",
    attempt(
      `select (d)::text from (
         delete from public.canonical_qualitative_signoff
          where id = ${q(signoffId)} returning 1 as d) x;`,
    ).sqlstate,
    "2F002",
  );
  eq("y sigue ahí", countIn("canonical_qualitative_signoff"), 2);

  // A WHOLE STUDY CAN STILL BE DELETED. The trigger refuses a delete only while
  // the parent exists, which is what a cascade looks like from inside it.
  db.run(recordSql({ studyId: CASCADE_STUDY, digest: DIGEST }).replace("::text;", "::text;"));
  eq("una firma más, en el estudio desechable", countIn("canonical_qualitative_signoff"), 3);
  db.run(`delete from public.study where id = ${q(CASCADE_STUDY)};`);
  eq("borrar el estudio entero se lleva su firma", countIn("canonical_qualitative_signoff"), 2);

  /* ------------------------------------------------------------------------ */
  console.log("\n[5] Publicar escribe el registro cualitativo en la MISMA transacción");

  db.json(`
    select public.save_canonical_presentation_draft(
      ${q(STUDY)}, ${q(ACTOR)}, ${q(JSON.stringify(MATERIAL.envelope.definition))}::jsonb,
      ${q(MATERIAL.envelope.registryVersion)}, ${q(MATERIAL.envelope.binding)},
      ${q(MATERIAL.envelope.definitionSha256)}, null, 'draft-key-000001', null)::text;
  `);

  const publishSql = (over = {}) => {
    const {
      state = "current",
      digest = DIGEST,
      signoff = signoffId,
      revision = 1,
      key = null,
      expectedActive = null,
      definitionSha = MATERIAL.envelope.definitionSha256,
    } = over;
    return `select public.publish_canonical_presentation_with_qualitative(
      ${q(STUDY)}, ${q(ACTOR)}, ${revision}::bigint,
      ${q(JSON.stringify(MATERIAL.envelope.definition))}::jsonb, ${q(definitionSha)},
      ${q(JSON.stringify(MATERIAL.model))}::jsonb, ${q(MATERIAL.modelSha256)},
      ${q(identity.registryVersion)}, ${q(identity.bindingFingerprint)},
      ${q(identity.resultsContractVersion)}, ${q(identity.calculationVersion)},
      ${q(identity.specId)}, ${identity.mappingVersion},
      ${q(identity.packageIdempotencyKey)}, ${q(identity.planFingerprint)},
      ${q(state)}, ${digest === null ? "null" : q(digest)}, ${signoff === null ? "null" : `${q(signoff)}::uuid`},
      '{}'::text[], '{}'::text[], '{}'::text[],
      ${expectedActive === null ? "null" : q(expectedActive)}::uuid, ${q(key)}, null)::text;`;
  };

  const published = attempt(publishSql({ key: "publish-key-0001" }));
  succeeded(published, "una publicación con la revisión al día se realiza");
  eq("y es la versión 1", published.value?.version, 1);
  eq("y devuelve el estado cualitativo", published.value?.qualitativeReviewState, "current");
  eq("hay una instantánea", countIn("canonical_presentation_revision"), 1);
  eq("y su registro cualitativo, uno a uno", countIn("canonical_publication_qualitative_signoff"), 1);
  eq(
    "que apunta a la firma exacta",
    db.run(`select signoff_id::text from public.canonical_publication_qualitative_signoff;`).trim(),
    signoffId,
  );
  eq(
    "y a la instantánea exacta",
    db
      .run(
        `select (l.revision_id = r.id)::text
           from public.canonical_publication_qualitative_signoff l,
                public.canonical_presentation_revision r;`,
      )
      .trim(),
    "t",
  );

  // A REPLAY WRITES NOTHING, which is what a replay means.
  const replayedPublish = attempt(publishSql({ key: "publish-key-0001" }));
  succeeded(replayedPublish, "el mismo idempotency key responde");
  eq("y se declara repetición", replayedPublish.value?.replayed, true);
  eq("sin una segunda instantánea", countIn("canonical_presentation_revision"), 1);
  eq("ni un segundo registro cualitativo", countIn("canonical_publication_qualitative_signoff"), 1);

  // THE RECORD IS IMMUTABLE TOO.
  eq(
    "el registro cualitativo de una publicación no se puede editar",
    attempt(
      `select (u)::text from (
         update public.canonical_publication_qualitative_signoff set review_state = 'pending'
          returning 1 as u) x;`,
    ).sqlstate,
    "2F002",
  );

  /* ------------------------------------------------------------------------ */
  console.log("\n[6] «Revisado» es una afirmación sobre una fila, y la base la comprueba");

  eq(
    "«current» sin nombrar la firma es rechazado",
    attempt(publishSql({ signoff: null, revision: 1, key: "k-nosignoff" })).sqlstate,
    "22023",
  );
  eq(
    "«current» sin huella, también",
    attempt(publishSql({ digest: null, revision: 1, key: "k-nodigest" })).sqlstate,
    "22023",
  );
  // A SIGN-OFF OF ANOTHER STUDY IS NOT THIS STUDY'S.
  const foreign = db.json(recordSql({ studyId: OTHER_STUDY, digest: DIGEST }));
  eq(
    "una firma de otro estudio es rechazada",
    attempt(publishSql({ signoff: foreign.signoffId, revision: 1, key: "k-foreign" })).sqlstate,
    "22023",
  );
  // AND A SIGN-OFF OF OTHER WORDS IS NOT A SIGN-OFF OF THESE.
  eq(
    "una firma cuya huella no es ésta se rechaza como conflicto",
    attempt(publishSql({ digest: OTHER_DIGEST, revision: 1, key: "k-moved" })).sqlstate,
    "55000",
  );
  eq(
    "un estado que no está en el vocabulario cerrado es rechazado",
    attempt(publishSql({ state: "reviewed", revision: 1, key: "k-badstate" })).sqlstate,
    "22023",
  );
  eq("y ninguna de esas cinco publicó nada", countIn("canonical_presentation_revision"), 1);

  /* ------------------------------------------------------------------------ */
  console.log("\n[7] Una publicación RECHAZADA no deja registro cualitativo alguno");

  const before = countIn("canonical_publication_qualitative_signoff");
  // A stale draft revision: the inner function refuses, and the wrapper's own
  // insert must go with it. If they were two transactions, this would leave a
  // qualitative record for a publication that does not exist.
  const stale = attempt(publishSql({ revision: 99, key: "k-stale" }));
  eq("una revisión de borrador rancia es rechazada", stale.sqlstate, "55000");
  eq("y no dejó registro cualitativo", countIn("canonical_publication_qualitative_signoff"), before);
  eq("ni instantánea", countIn("canonical_presentation_revision"), 1);

  // AND «pending» IS RECORDABLE, because publishing unreviewed categories is a
  // decision a person may legitimately make, acknowledged in the open.
  db.json(`
    select public.save_canonical_presentation_draft(
      ${q(STUDY)}, ${q(ACTOR)}, ${q(JSON.stringify(MATERIAL.envelope.definition))}::jsonb,
      ${q(MATERIAL.envelope.registryVersion)}, ${q(MATERIAL.envelope.binding)},
      ${q(MATERIAL.envelope.definitionSha256)}, 1::bigint, 'draft-key-000002', null)::text;
  `);
  const activeRevision = db
    .run(`select active_revision_id::text from public.canonical_presentation_publication;`)
    .trim();
  const pendingPublish = attempt(
    publishSql({
      state: "pending",
      signoff: null,
      revision: 2,
      key: "k-pending",
      expectedActive: activeRevision,
    }),
  );
  succeeded(pendingPublish, "publicar con las categorías sin revisar se permite");
  eq("y queda registrado como pendiente", pendingPublish.value?.qualitativeReviewState, "pending");
  eq("con dos registros cualitativos", countIn("canonical_publication_qualitative_signoff"), 2);
  eq(
    "y el segundo no nombra firma alguna",
    db
      .run(
        `select count(*) from public.canonical_publication_qualitative_signoff
          where review_state = 'pending' and signoff_id is null;`,
      )
      .trim(),
    "1",
  );

  /* ------------------------------------------------------------------------ */
  console.log("\n[8] Los roles del navegador no alcanzan ninguna de las dos tablas");

  for (const role of ["anon", "authenticated"]) {
    for (const table of [
      "canonical_qualitative_signoff",
      "canonical_publication_qualitative_signoff",
    ]) {
      // AN EXPLICIT TRANSACTION. Outside one, `set local role` applies to the
      // implicit single-statement transaction and is gone before the next
      // statement — so the query runs as the table OWNER and the assertion
      // passes for the wrong reason.
      eq(
        `${role} no puede leer ${table}`,
        attempt(
          `begin; set local role ${role}; select count(*)::text from public.${table}; rollback;`,
        ).sqlstate,
        "42501",
      );
    }
    eq(
      `${role} no puede ejecutar el registro de firmas`,
      attempt(
        `begin; set local role ${role}; ${recordSql()} rollback;`,
      ).sqlstate,
      "42501",
    );
  }

  console.log(`\n${"=".repeat(82)}`);
  console.log(`EXECUTED: ${executed}   PASSED: ${executed - failures}   FAILED: ${failures}`);
});

if (failures > 0) {
  console.log(
    "RESULT: the qualitative sign-off does NOT behave as migration 0031 documents. GATE BLOCKED.",
  );
  process.exit(1);
}
console.log(
  "RESULT: a sign-off is written once and replayed rather than duplicated, it is immutable and\n" +
    "        goes only with its study, publishing writes its qualitative record in the same\n" +
    "        transaction, a refused publication leaves none, «current» is refused unless a\n" +
    "        sign-off of THIS study carrying THIS digest exists, «pending» is recordable because\n" +
    "        publishing unreviewed categories is a person's decision, and neither browser role\n" +
    "        reaches either table. GATE PASSED.\n",
);
console.log("NOTE: a disposable cluster, not the hosted project. Never report this as a hosted run.");
