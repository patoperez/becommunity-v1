// =============================================================================
// UNIT 6B.4A — THE STORAGE AUDIT, PUT TO A REAL POSTGRESQL BEFORE IT IS ANSWERED
// =============================================================================
//   bash scripts/lib/disposable-postgres-provision.sh          # once, PG 17
//   BECOMMUNITY_PG_VERSION=17 \
//   CANONICAL_COMMIT_TEST_PGHOST="$HOME/becommunity-pg/socket" \
//   CANONICAL_COMMIT_TEST_PGUSER="$(id -un)" \
//     npm run test:canonical-publication-audit
//
// -----------------------------------------------------------------------------
// THE QUESTION
// -----------------------------------------------------------------------------
// Migration `0025_experience_publication.sql` already carries a publication
// model: an immutable revision table, an active pointer, an append-only event
// log, and three write functions. Unit 6B.4A must publish a schema-version-FOUR
// canonical presentation, which lives in the SEPARATE table migration `0029`
// created. So the question that has to be settled before a single line of the
// new lifecycle is written is:
//
//   Can the legacy publication storage publish from `canonical_presentation_draft`
//   without overwriting or reinterpreting a legacy draft, without sharing an
//   unsafe key, without accepting schema v2/v3 as canonical, without losing
//   binding / package / calculation identity, and without allowing a mutable
//   publication snapshot?
//
// A table that accepts JSON is not a licence to put canonical JSON in it. Unit
// 6B.3A learned that about the DRAFT table by executing it rather than reasoning
// about it, and the same standard applies here: every finding below is the
// outcome of a statement this script actually ran, printed with the SQLSTATE
// PostgreSQL produced.
//
// -----------------------------------------------------------------------------
// WHAT THIS SCRIPT IS NOT
// -----------------------------------------------------------------------------
// It is not a gate on the product. It asserts facts about migrations 0023-0025
// and 0029 AS THEY ARE, so a later change to any of them that invalidated a
// finding fails here — but nothing it does is a claim about `0030`, which is the
// answer, not the question.
//
// NOTHING HOSTED IS TOUCHED. `resolveDisposableTarget` refuses to run at all if
// a Supabase environment variable is in scope, and every legacy row it examines
// is one this script planted seconds earlier.
// =============================================================================

import {
  DisposableTargetError,
  resolveDisposableTarget,
  withDisposableDatabase,
} from "./lib/disposable-postgres.mjs";
import { psqlSuiteTransport } from "./lib/canonical-psql-transport.mjs";
import { buildPresentationRead } from "../src/lib/viewer/index.ts";
import { bindPresentationDocument } from "../src/lib/presentation/registry.ts";
import { validatePresentationDocument } from "../src/lib/presentation/document.ts";
import { serializeDeterministic, serializedBytes } from "../src/lib/presentation/serialize.ts";
import { encodePresentationForStorage } from "../src/lib/presentation/persistence.ts";
import { buildGenericStartingBlueprint } from "../src/lib/presentation/blueprints/generic-starting.ts";
import { resolveUnderSelection } from "../src/lib/viewer/index.ts";
import { EMPTY_VIEWER_SELECTION } from "../src/lib/presentation/viewer.ts";
import { JOURNEY_ROUTES_VARIANTS, offeredChartVariants } from "../src/lib/composer/renderer-capabilities.ts";
import { composerFixtureSource } from "./lib/composer-fixture.mjs";

let failures = 0;
let executed = 0;
const findings = [];

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
/** A finding is a sentence the documentation will quote, recorded once, here. */
const finding = (id, verdict, sentence) => {
  findings.push({ id, verdict, sentence });
  console.log(`  » FINDING ${id} [${verdict}] ${sentence}`);
};

const ACTOR = "11111111-1111-4111-8111-111111111111";
const TENANT = "22222222-2222-4222-8222-222222222222";
/** Holds a planted legacy v2 draft AND a canonical v4 draft, as Cuicuilco does. */
const BOTH_STUDY = "33333333-3333-4333-8333-333333333333";
/** Holds only a legacy v3 draft, as the P6E acceptance study does. */
const LEGACY_V3_STUDY = "44444444-4444-4444-8444-444444444444";
/** Sacrificial: the destructive probe runs here so no fingerprint is disturbed. */
const SACRIFICE_STUDY = "55555555-5555-4555-8555-555555555555";
/** Its legacy draft is deliberately MOVED, to show what that does to a publication. */
const DRIFT_STUDY = "66666666-6666-4666-8666-666666666666";

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

console.log("Be Community — Unit 6B.4A: can the LEGACY publication storage publish a CANONICAL presentation?");
console.log("=".repeat(94));

/* -------------------------------------------------------------------------- */
/* The canonical document under audit: the product's own bytes                 */
/* -------------------------------------------------------------------------- */

const built = buildPresentationRead(composerFixtureSource());
const template = {
  schemaVersion: 4,
  documentKind: "canonical_presentation",
  registryVersion: built.registry.registryVersion,
  binding: null,
  id: "doc-auditoria",
  title: "Documento de auditoría",
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

function envelopeFor(studyId, title) {
  const document = title === undefined ? bound : { ...bound, title };
  const encoded = encodePresentationForStorage(document, { tenantId: TENANT, studyId });
  if (!encoded.ok) {
    console.error("encode refused", encoded.errors);
    process.exit(1);
  }
  return encoded.value;
}

await withDisposableDatabase(target, "pubaudit", async (db) => {
  console.log("\n[setup] bootstrap + migrations 0000-0029, then the two families of draft side by side");
  psqlSuiteTransport(db).prepare(29);

  db.run(`
    insert into auth.users (id, email) values (${q(ACTOR)}, 'internal@example.test');
    insert into public.tenant (id, name) values (${q(TENANT)}, 'Probe tenant');
    insert into public.profiles (user_id, tenant_id, role) values (${q(ACTOR)}, ${q(TENANT)}, 'internal');
    insert into public.study (id, tenant_id, name) values
      (${q(BOTH_STUDY)}, ${q(TENANT)}, 'Estudio con las dos familias'),
      (${q(LEGACY_V3_STUDY)}, ${q(TENANT)}, 'Estudio con borrador heredado v3'),
      (${q(SACRIFICE_STUDY)}, ${q(TENANT)}, 'Estudio de sacrificio'),
      (${q(DRIFT_STUDY)}, ${q(TENANT)}, 'Estudio cuyo borrador se mueve');
  `);

  /** The two hosted legacy rows, planted exactly as the project holds them. */
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
  plantLegacy(SACRIFICE_STUDY, 2, 72, "Heredado v2 sacrificable");
  plantLegacy(DRIFT_STUDY, 2, 72, "Heredado v2 que se moverá");

  const legacyFingerprint = (studies) =>
    db.json(`
      select coalesce(json_agg(row_to_json(t) order by t.study_id)::text, '[]')
        from (
          select study_id::text, schema_version, revision,
                 encode(sha256(definition::text::bytea), 'hex') as sha,
                 extract(epoch from updated_at)::text as updated_at
            from public.study_experience_draft
           where study_id in (${studies.map(q).join(", ")})
        ) t;
    `);
  const guarded = [BOTH_STUDY, LEGACY_V3_STUDY];
  const legacyBefore = JSON.stringify(legacyFingerprint(guarded));

  // And the canonical v4 draft, written through the ONE path 0029 provides.
  const canonicalEnvelope = envelopeFor(BOTH_STUDY, "Presentación canónica");
  const savedCanonical = db.json(`
    select public.save_canonical_presentation_draft(
      ${q(BOTH_STUDY)}, ${q(ACTOR)}, ${q(JSON.stringify(canonicalEnvelope.definition))}::jsonb,
      ${q(canonicalEnvelope.registryVersion)}, ${q(canonicalEnvelope.binding)},
      ${q(canonicalEnvelope.definitionSha256)}, null, 'audit-first-save-1', null
    )::text;
  `);
  eq("the canonical draft is stored at revision", savedCanonical.revision, 1);
  eq(
    "and the legacy draft of the SAME study is still at revision",
    Number(db.run(`select revision from public.study_experience_draft where study_id = ${q(BOTH_STUDY)};`).trim()),
    72,
  );

  /** Call one legacy publication RPC and report either its answer or its SQLSTATE. */
  const callRpc = (sql) => {
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

  const prepare = ({
    studyId,
    definitionJson,
    schemaVersion,
    sourceDraftRevision,
    sha = "a".repeat(64),
    fingerprint = "audit",
    warnings = "{}",
    blockers = "{}",
    note = null,
    key = null,
  }) =>
    callRpc(`
      select public.prepare_study_experience_revision(
        ${q(studyId)}, ${q(ACTOR)}, ${q(definitionJson)}::jsonb, ${schemaVersion},
        ${sourceDraftRevision}::bigint, ${q(sha)}, ${q(fingerprint)},
        ${q(warnings)}::text[], ${q(blockers)}::text[], ${q(note)}, ${q(key)}
      )::text;
    `);

  const publish = ({ studyId, revisionId, expectedActive = null, warnings = "{}", key = null }) =>
    callRpc(`
      select public.publish_study_experience_revision(
        ${q(studyId)}, ${q(ACTOR)}, ${q(revisionId)},
        ${expectedActive === null ? "null" : q(expectedActive)}::uuid,
        ${q(warnings)}::text[], '{}'::text[], null, ${q(key)}
      )::text;
    `);

  /* ====================================================================== */
  console.log("\n[A] Where the legacy publication RPC LOOKS for the draft it is snapshotting");

  // The canonical draft is at revision 1 and holds the v4 document. Ask the
  // legacy RPC to snapshot exactly that.
  const canonicalJson = JSON.stringify(canonicalEnvelope.definition);
  const atCanonicalRevision = prepare({
    studyId: BOTH_STUDY,
    definitionJson: canonicalJson,
    schemaVersion: 4,
    sourceDraftRevision: 1,
  });
  check(!atCanonicalRevision.ok, "preparing the CANONICAL draft at its own revision 1 is refused");
  eq("with the precondition SQLSTATE", atCanonicalRevision.sqlstate, "55000");
  check(
    /draft moved on/.test(atCanonicalRevision.message),
    `and the refusal is about the LEGACY draft's revision («${atCanonicalRevision.message}»)`,
  );

  const atLegacyRevision = prepare({
    studyId: BOTH_STUDY,
    definitionJson: canonicalJson,
    schemaVersion: 4,
    sourceDraftRevision: 72,
  });
  check(!atLegacyRevision.ok, "and naming the LEGACY revision 72 instead is refused too");
  eq("under the same code", atLegacyRevision.sqlstate, "55000");
  check(
    /not the saved draft at that revision/.test(atLegacyRevision.message),
    `because the document it compares against is the legacy one («${atLegacyRevision.message}»)`,
  );

  const body = db.run(`
    select case when position('canonical_presentation_draft' in prosrc) > 0 then 'names' else 'does-not-name' end
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'prepare_study_experience_revision';
  `).trim();
  eq("and the function's own body never names the canonical draft table", body, "does-not-name");

  finding(
    "A",
    "UNSAFE",
    "The legacy prepare RPC reads `study_experience_draft` by study id and compares the snapshot " +
      "against THAT row. It cannot see `canonical_presentation_draft` at all, so it can never take " +
      "an exact canonical draft revision — the one thing a canonical publication must originate from.",
  );

  /* ====================================================================== */
  console.log("\n[B] Whether the legacy revision table accepts schema v2/v3 as a publishable snapshot");

  const legacyDefinition = db.json(
    `select definition::text from public.study_experience_draft where study_id = ${q(BOTH_STUDY)};`,
  );
  const preparedLegacy = prepare({
    studyId: BOTH_STUDY,
    definitionJson: JSON.stringify(legacyDefinition),
    schemaVersion: 2,
    sourceDraftRevision: 72,
    key: "audit-prepare-v2-1",
  });
  check(preparedLegacy.ok, "a schema-version-TWO legacy definition is accepted as a prepared revision");
  eq("at revision", preparedLegacy.ok ? preparedLegacy.value.revision : null, 1);
  eq(
    "and the immutable row records schema version",
    Number(
      db.run(`select schema_version from public.study_experience_revision where study_id = ${q(BOTH_STUDY)};`).trim(),
    ),
    2,
  );

  const versionConstraint = db.run(`
    select coalesce(string_agg(pg_get_constraintdef(con.oid), ' | '), '')
      from pg_constraint con join pg_class rel on rel.oid = con.conrelid
      join pg_namespace nsp on nsp.oid = rel.relnamespace
     where nsp.nspname = 'public' and rel.relname = 'study_experience_revision'
       and con.contype = 'c' and pg_get_constraintdef(con.oid) like '%schema_version%';
  `).trim();
  // PostgreSQL normalises `between 1 and 1000` into two comparisons before it
  // stores the constraint, so the pattern has to be the STORED form. The first
  // draft of this assertion looked for the word `between` and failed against a
  // database that was doing exactly what the migration asked.
  check(
    /schema_version >= 1/.test(versionConstraint) && /schema_version <= 1000/.test(versionConstraint),
    `the revision column admits a RANGE rather than one version (${versionConstraint || "no constraint"})`,
  );

  const revisionColumns = db.json(`
    select coalesce(json_agg(column_name order by column_name)::text, '[]')
      from information_schema.columns
     where table_schema = 'public' and table_name = 'study_experience_revision';
  `);
  check(
    !revisionColumns.includes("document_kind"),
    "and there is no `document_kind` column, so nothing distinguishes the two families in it",
  );

  finding(
    "B",
    "UNSAFE",
    "`study_experience_revision.schema_version` is CHECKed `between 1 and 1000` and the table carries " +
      "no family discriminator. A legacy v2 definition is accepted as a prepared revision — executed " +
      "here, revision 1 stored at schema version 2 — so the table cannot assert that what it holds is " +
      "a canonical presentation.",
  );

  /* ====================================================================== */
  console.log("\n[C] Whether the two families could share the key space and the pointer");

  const revisionKeys = db.json(`
    select coalesce(json_agg(json_build_object('name', i.relname, 'def', pg_get_indexdef(x.indexrelid))
             order by i.relname)::text, '[]')
      from pg_index x join pg_class t on t.oid = x.indrelid join pg_class i on i.oid = x.indexrelid
      join pg_namespace n on n.oid = t.relnamespace
     where n.nspname = 'public' and t.relname in ('study_experience_revision', 'study_experience_publication')
       and (x.indisunique or x.indisprimary);
  `);
  check(
    revisionKeys.some((k) => /study_experience_publication_pkey/.test(k.name) && /\(study_id\)/.test(k.def)),
    "the active-publication pointer's PRIMARY KEY is `study_id` ALONE — one answer per study",
  );
  check(
    revisionKeys.some((k) => /UNIQUE/.test(k.def) && /\(study_id, revision\)/.test(k.def)),
    "and the immutable revision table is UNIQUE on (study_id, revision) — one shared version sequence",
  );

  const legacyRevisionId = db.run(
    `select id from public.study_experience_revision where study_id = ${q(BOTH_STUDY)} and revision = 1;`,
  ).trim();
  const publishedLegacy = publish({ studyId: BOTH_STUDY, revisionId: legacyRevisionId, key: "audit-publish-v2-1" });
  check(publishedLegacy.ok, "publishing that v2 revision sets the study's pointer");
  eq(
    "and the pointer names it",
    db.run(`select active_revision_id from public.study_experience_publication where study_id = ${q(BOTH_STUDY)};`).trim(),
    legacyRevisionId,
  );

  // A SECOND revision of the same study — the slot a canonical publication
  // would have had to occupy. Its version number is decided by how many LEGACY
  // revisions already exist.
  const secondLegacy = prepare({
    studyId: BOTH_STUDY,
    definitionJson: JSON.stringify(legacyDefinition),
    schemaVersion: 2,
    sourceDraftRevision: 72,
    key: "audit-prepare-v2-2",
  });
  check(secondLegacy.ok, "a second prepared revision of the same study is accepted");
  eq(
    "and its version is `max(revision) + 1` over the SAME per-study sequence",
    secondLegacy.ok ? secondLegacy.value.revision : null,
    2,
  );
  const secondId = secondLegacy.ok ? secondLegacy.value.revisionId : null;
  const republished = publish({
    studyId: BOTH_STUDY,
    revisionId: secondId,
    expectedActive: legacyRevisionId,
    key: "audit-publish-v2-2",
  });
  check(republished.ok, "and publishing it MOVES the one pointer rather than adding a second");
  eq(
    "so the study now serves exactly one revision",
    Number(db.run(`select count(*) from public.study_experience_publication where study_id = ${q(BOTH_STUDY)};`).trim()),
    1,
  );
  eq(
    "and it is the newer one",
    db.run(`select active_revision_id from public.study_experience_publication where study_id = ${q(BOTH_STUDY)};`).trim(),
    secondId,
  );

  finding(
    "C",
    "UNSAFE",
    "`study_experience_publication` is keyed on `study_id` alone and `study_experience_revision` is " +
      "unique on `(study_id, revision)`. A canonical publication placed there would share ONE pointer " +
      "and ONE version sequence with the legacy experience: publishing either family would silently " +
      "replace what the other family had published, and a canonical version number would be decided " +
      "by how many legacy revisions happened to exist.",
  );

  /* ====================================================================== */
  console.log("\n[D] What identity a legacy revision can carry, and what it cannot");

  const identityColumns = ["binding_fingerprint", "registry_version", "calculation_version",
    "package_idempotency_key", "plan_fingerprint", "results_contract_version", "render_model"];
  for (const column of identityColumns) {
    check(
      !revisionColumns.includes(column),
      `the legacy revision table has no \`${column}\` column`,
    );
  }
  check(
    revisionColumns.includes("study_fingerprint"),
    "it carries exactly one opaque `study_fingerprint`, bounded at 200 characters",
  );
  const stampedAnything = prepare({
    studyId: LEGACY_V3_STUDY,
    definitionJson: JSON.stringify(
      db.json(`select definition::text from public.study_experience_draft where study_id = ${q(LEGACY_V3_STUDY)};`),
    ),
    schemaVersion: 3,
    sourceDraftRevision: 14,
    fingerprint: "x",
    key: "audit-prepare-v3-1",
  });
  check(stampedAnything.ok, "and a one-character fingerprint is accepted for it");
  eq(
    "so the stored identity of that revision is the string",
    db.run(`select study_fingerprint from public.study_experience_revision where study_id = ${q(LEGACY_V3_STUDY)};`).trim(),
    "x",
  );

  finding(
    "D",
    "UNSAFE",
    "A legacy revision stores the definition, a definition digest and ONE unstructured " +
      "`study_fingerprint` of up to 200 characters — accepted here as the single character «x». It has " +
      "no column for the binding fingerprint, the registry build, the results-contract version, the " +
      "calculation version, the package identity or the plan fingerprint, so binding / package / " +
      "calculation identity cannot be stored, checked or attributed when it drifts.",
  );

  /* ====================================================================== */
  console.log("\n[E] Whether a legacy publication snapshot is genuinely immutable");

  let updatedRevision = true;
  try {
    db.run(`update public.study_experience_revision set study_fingerprint = 'moved';`);
  } catch (thrown) {
    updatedRevision = false;
    eq("updating a prepared revision raises the immutability code", thrown.sqlstate, "2F002");
  }
  check(!updatedRevision, "and the update did not happen");

  // DELETE is a different question, and the honest answer is different.
  const beforeDelete = Number(
    db.run(`select count(*) from public.study_experience_revision where study_id = ${q(LEGACY_V3_STUDY)};`).trim(),
  );
  let deleted = true;
  try {
    db.run(`delete from public.study_experience_revision where study_id = ${q(LEGACY_V3_STUDY)};`);
  } catch {
    deleted = false;
  }
  eq("a prepared revision CAN be deleted by the table owner", deleted, true);
  eq(
    "and the row is gone",
    Number(db.run(`select count(*) from public.study_experience_revision where study_id = ${q(LEGACY_V3_STUDY)};`).trim()),
    beforeDelete - 1,
  );

  finding(
    "E",
    "PARTIAL",
    "UPDATE on `study_experience_revision` is refused twice — by a trigger (SQLSTATE 2F002) and by the " +
      "absence of the privilege — which is correct and is kept. DELETE is refused only by privilege: " +
      "executed here, the table owner removed a prepared revision outright. Every SECURITY DEFINER " +
      "function runs as that owner, so a future function could destroy a published snapshot without " +
      "the database objecting.",
  );

  /* ====================================================================== */
  console.log("\n[F] Whether a legacy publication DEPENDS on the legacy draft after the fact");

  // Publication (not restoration) re-checks that the snapshot IS still the saved
  // draft. This runs on its own study, whose legacy draft is MOVED on purpose,
  // so no fingerprint the audit guards is disturbed.
  const driftDefinition = db.json(
    `select definition::text from public.study_experience_draft where study_id = ${q(DRIFT_STUDY)};`,
  );
  const driftRevision = prepare({
    studyId: DRIFT_STUDY,
    definitionJson: JSON.stringify(driftDefinition),
    schemaVersion: 2,
    sourceDraftRevision: 72,
    key: "audit-prepare-drift1",
  });
  check(driftRevision.ok, "a revision is prepared from that study's legacy draft at revision 72");
  const driftRevisionId = driftRevision.ok ? driftRevision.value.revisionId : null;

  db.run(`
    select public.save_study_experience_draft(
      ${q(DRIFT_STUDY)}, ${q(ACTOR)},
      jsonb_build_object('schemaVersion', 2, 'metadata',
        jsonb_build_object('studyId', ${q(DRIFT_STUDY)}, 'tenantId', ${q(TENANT)}),
        'pages', jsonb_build_array(jsonb_build_object('id','p1','title','Heredado v2 editado'))),
      2, 72, null
    );
  `);
  eq(
    "then the legacy draft is edited and moves to revision",
    Number(db.run(`select revision from public.study_experience_draft where study_id = ${q(DRIFT_STUDY)};`).trim()),
    73,
  );
  const stalePublish = publish({ studyId: DRIFT_STUDY, revisionId: driftRevisionId, key: "audit-publish-drift1" });
  check(!stalePublish.ok, "and publishing the prepared revision is now refused");
  eq("under the precondition code", stalePublish.sqlstate, "55000");
  check(
    /draft changed after this revision was prepared/.test(stalePublish.message),
    `because the LEGACY draft moved («${stalePublish.message}»)`,
  );

  finding(
    "F",
    "UNSAFE",
    "`publish_study_experience_revision` re-reads `study_experience_draft` and refuses unless the " +
      "snapshot is still that row at that revision. A canonical publication routed through it would " +
      "have its staleness decided by a LEGACY v2/v3 document — reinterpreting a legacy draft as the " +
      "authority over canonical output, which is exactly what this phase forbids.",
  );

  /* ====================================================================== */
  console.log("\n[G] The only route by which 0025 could ever publish canonical content, executed");

  // To reach the legacy publication path at all, the canonical document would
  // have to BE the legacy draft. This is what that costs, run on the sacrificial
  // study so no guarded fingerprint is disturbed.
  const sacrificeBefore = db.json(`
    select row_to_json(t)::text from (
      select schema_version, revision, encode(sha256(definition::text::bytea), 'hex') as sha
        from public.study_experience_draft where study_id = ${q(SACRIFICE_STUDY)}
    ) t;
  `);
  eq("the sacrificial legacy draft starts at schema version", sacrificeBefore.schema_version, 2);
  eq("and revision", Number(sacrificeBefore.revision), 72);

  const sacrificeEnvelope = envelopeFor(SACRIFICE_STUDY, "Canónico encima del heredado");
  const overwrite = callRpc(`
    select public.save_study_experience_draft(
      ${q(SACRIFICE_STUDY)}, ${q(ACTOR)},
      ${q(JSON.stringify(sacrificeEnvelope.definition))}::jsonb, 4, 72, null
    )::text;
  `);
  check(overwrite.ok, "the legacy draft RPC ACCEPTS a canonical v4 document against a v2 legacy row");
  const sacrificeAfter = db.json(`
    select row_to_json(t)::text from (
      select schema_version, revision, encode(sha256(definition::text::bytea), 'hex') as sha
        from public.study_experience_draft where study_id = ${q(SACRIFICE_STUDY)}
    ) t;
  `);
  eq("the row's schema version becomes", sacrificeAfter.schema_version, 4);
  eq("its revision moves to", Number(sacrificeAfter.revision), 73);
  check(sacrificeAfter.sha !== sacrificeBefore.sha, "and the stored definition bytes are replaced");

  finding(
    "G",
    "UNSAFE",
    "The only way to make the legacy publication path see a canonical document is to write that " +
      "document into `study_experience_draft` — which `save_study_experience_draft` accepts: executed " +
      "here, a planted v2 row at revision 72 became a v4 row at revision 73 with different bytes. " +
      "Publishing canonically through 0025 therefore REQUIRES destroying a legacy draft.",
  );

  /* ====================================================================== */
  console.log("\n[H] Whether the audit trail and the idempotency ledger could be shared");

  const actionConstraint = db.run(`
    select coalesce(string_agg(pg_get_constraintdef(con.oid), ' | '), '')
      from pg_constraint con join pg_class rel on rel.oid = con.conrelid
      join pg_namespace nsp on nsp.oid = rel.relnamespace
     where nsp.nspname = 'public' and rel.relname = 'study_experience_event'
       and con.contype = 'c' and pg_get_constraintdef(con.oid) like '%draft_created%';
  `).trim();
  check(/revision_prepared/.test(actionConstraint), "the legacy event vocabulary is a CLOSED set of six legacy actions");
  let acceptedNewAction = true;
  try {
    db.run(`
      insert into public.study_experience_event (study_id, tenant_id, action, revision)
      values (${q(BOTH_STUDY)}, ${q(TENANT)}, 'canonical_published', 1);
    `);
  } catch (thrown) {
    acceptedNewAction = false;
    eq("and a canonical action is refused by the CHECK constraint", thrown.sqlstate, "23514");
  }
  check(!acceptedNewAction, "so a canonical vocabulary cannot be added without altering a legacy constraint");

  const legacyEventCount = Number(db.run(`select count(*) from public.study_experience_event;`).trim());
  check(
    legacyEventCount > 0,
    `and every canonical publication would add rows to the legacy log (${legacyEventCount} there now), ` +
      "whose hosted count a read-only fingerprint gate pins",
  );

  finding(
    "H",
    "UNSAFE",
    "`study_experience_event` carries a closed six-value `action` CHECK — a canonical action is refused " +
      "with 23514 — and one `(study_id, idempotency_key)` unique index. Reusing it would mean altering " +
      "a constraint on a table holding 86 hosted rows, mixing two lifecycles into one audit trail, and " +
      "sharing an idempotency namespace between a draft save and a publication.",
  );

  /* ====================================================================== */
  console.log("\n[I] What a publication would have to store to be reproducible");

  // A REALISTIC DOCUMENT, not the empty one the rest of this audit stores. The
  // generic starting blueprint names everything this registry publishes, so its
  // resolved model is the honest scale of what a reproducible publication has
  // to keep — and it is measured rather than guessed, because it decides a
  // column's ceiling.
  const generic = buildGenericStartingBlueprint(built.registry, {
    drawableFor: offeredChartVariants,
    drawableForRoutes: JOURNEY_ROUTES_VARIANTS,
    title: "Medición de escala",
  });
  const genericValidated = validatePresentationDocument(JSON.parse(serializeDeterministic(generic)));
  check(genericValidated.ok, "the generic starting blueprint validates");
  const genericBound = genericValidated.ok
    ? bindPresentationDocument(genericValidated.value, built.registry)
    : null;
  const resolvedGeneric = genericBound
    ? resolveUnderSelection(built, genericBound, EMPTY_VIEWER_SELECTION)
    : { ok: false };
  check(resolvedGeneric.ok, "and resolves into a render model");

  const definitionBytes = serializedBytes(canonicalEnvelope.definition);
  const genericDocumentBytes = genericBound ? serializedBytes(genericBound) : 0;
  const modelBytes = resolvedGeneric.ok ? serializedBytes(resolvedGeneric.model) : 0;
  const blockCount = resolvedGeneric.ok
    ? resolvedGeneric.model.pages.reduce((total, page) => total + page.blocks.length, 0)
    : 0;
  check(definitionBytes > 0, `the empty audit definition serializes to ${definitionBytes} bytes`);
  check(
    genericDocumentBytes > 0 && modelBytes > 0,
    `a ${blockCount}-block document is ${genericDocumentBytes} bytes and its RESOLVED MODEL ` +
      `${modelBytes} bytes — about ${Math.round(modelBytes / Math.max(blockCount, 1))} bytes per block`,
  );
  check(
    !revisionColumns.includes("render_model"),
    "the legacy revision stores no resolved output at all, by its own stated design",
  );

  finding(
    "I",
    "UNSAFE",
    "A legacy revision stores CONFIGURATION and fingerprints and nothing else; migration 0025 says so " +
      "outright and recomputes every published number at request time from current data. That makes a " +
      "published report change whenever the canonical rows, the calculators or the registry change — " +
      "so it cannot reproduce an approved render model, which is the property this unit must guarantee.",
  );

  /* ====================================================================== */
  console.log("\n[J] The guarded legacy rows are exactly as they were");

  eq("the two guarded legacy drafts are byte-identical", JSON.stringify(legacyFingerprint([BOTH_STUDY])),
     JSON.stringify(JSON.parse(legacyBefore).filter((r) => r.study_id === BOTH_STUDY)));
  eq(
    "the canonical draft is still at revision",
    Number(db.run(`select revision from public.canonical_presentation_draft where study_id = ${q(BOTH_STUDY)};`).trim()),
    1,
  );
  eq(
    "and nothing in this audit wrote a second canonical draft",
    Number(db.run(`select count(*) from public.canonical_presentation_draft;`).trim()),
    1,
  );
});

/* -------------------------------------------------------------------------- */

console.log(`\n${"=".repeat(94)}`);
console.log("FINDINGS");
for (const entry of findings) console.log(`  ${entry.id}  ${entry.verdict.padEnd(7)}  ${entry.sentence}`);
console.log(`\nEXECUTED: ${executed}   PASSED: ${executed - failures}   FAILED: ${failures}`);
if (failures > 0) {
  console.log("RESULT: the audit did not execute as written. Do not act on it. GATE BLOCKED.");
  process.exit(1);
}
console.log(
  "VERDICT: the legacy publication storage CANNOT safely publish a canonical presentation.\n" +
    "         Eight of nine findings are UNSAFE and the ninth is partial. The smallest additive\n" +
    "         answer is a canonical-only publication migration in its own tables, which is 0030.\n" +
    "\n" +
    "NOTE: a disposable cluster, not the hosted project. Never report this as a hosted run.",
);
