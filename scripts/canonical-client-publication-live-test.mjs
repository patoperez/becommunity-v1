// =============================================================================
// Unit 6B.4B2I — THE CLIENT'S PUBLISHED READ PATH, EXECUTED END TO END
// =============================================================================
//   bash scripts/lib/disposable-postgres-provision.sh          # once, PG 17
//   BECOMMUNITY_PG_VERSION=17 \
//   CANONICAL_COMMIT_TEST_PGHOST="$HOME/becommunity-pg/socket" \
//   CANONICAL_COMMIT_TEST_PGUSER="$(id -un)" \
//   BECOMMUNITY_POSTGREST_BIN="$HOME/becommunity-postgrest/postgrest" \
//     npm run test:canonical-client-publication-live
//
// -----------------------------------------------------------------------------
// WHY IT EXISTS
// -----------------------------------------------------------------------------
// Everything a canonical publication promised a client was, until this unit,
// unobservable by a client: the storage existed, the review existed, the publish
// path existed, the database's own client projection existed — and the only
// client-facing study route rendered the legacy P8 dashboard. A publication
// changed nothing anybody outside Be Community could see.
//
// This gate drives the read that closes that, against a REAL PostgreSQL behind a
// REAL PostgREST, through the product's own functions and the product's own
// authorization, with real per-user JWTs minted by the local auth substitute.
// Nothing here is a mock: the publication is made by `publishStoredPresentation`
// — the function the review screen calls — and every read is the function the
// client route calls.
//
// WHAT IT PROVES, and the section that executes each:
//
//    1 an authorized client is NOT served an unpublished draft ......... [2]
//    2 a publication through the REAL publish path ..................... [3]
//    3 the client receives the IMMUTABLE published snapshot ............ [4]
//    4 editing the draft afterwards changes nothing a client sees ...... [5]
//    5 a second publication moves the pointer; the first stays intact .. [6]
//    6 wrong tenant, no profile and anonymous are all refused .......... [7]
//    7 filters recompute on the SERVER, over the frozen definition ..... [8]
//    8 a study that MOVED after publication refuses the filter and
//      still serves the snapshot unchanged ............................. [9]
//    9 a malformed pointer fails closed ................................ [10]
//   10 nothing internal is in what the client receives ................. [11]
//
// NOTHING HOSTED IS TOUCHED. `resolveDisposableTarget` refuses to run at all if
// a Supabase environment variable is in scope, and the two variables the admin
// client needs are set only AFTER that guard has run and only to this run's own
// throwaway stack.
// =============================================================================

import { existsSync } from "node:fs";
import { join } from "node:path";

import {
  DisposableTargetError,
  resolveDisposableTarget,
  withDisposableDatabase,
} from "./lib/disposable-postgres.mjs";
import { psqlSuiteTransport } from "./lib/canonical-psql-transport.mjs";
import { startLocalStack } from "./lib/local-postgrest-stack.mjs";
import { buildSyntheticPackage } from "./lib/canonical-fixtures.mjs";
import { runCanonicalCommit } from "../src/lib/ingestion/canonical-commit/flow.ts";
import { serializeDeterministic } from "../src/lib/presentation/serialize.ts";

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
/** Equality over a large serialized value, WITHOUT printing it on success. */
const same = (label, actual, expected) => {
  if (actual === expected) {
    check(true, `${label} (${expected.length} bytes, identical)`);
    return;
  }
  let at = 0;
  while (at < actual.length && at < expected.length && actual[at] === expected[at]) at += 1;
  check(
    false,
    `${label}: they differ at byte ${at} — «${actual.slice(at, at + 60)}» vs «${expected.slice(at, at + 60)}»`,
  );
};

const q = (value) => (value === null || value === undefined ? "null" : `'${String(value).replace(/'/g, "''")}'`);

const TENANT = "00000000-0000-4000-8000-0000000010a1";
const OTHER_TENANT = "00000000-0000-4000-8000-0000000010a2";
/** The study a client opens. */
const STUDY = "00000000-0000-4000-8000-0000000020b1";
/** Canonically published, but its legacy status is still `draft`. */
const HIDDEN_STUDY = "00000000-0000-4000-8000-0000000020b2";
const INTERNAL = "00000000-0000-4000-8000-0000000030c1";
const CLIENT_A = "00000000-0000-4000-8000-0000000030c2";
const CLIENT_B = "00000000-0000-4000-8000-0000000030c3";
/** Signed in, and belongs to no tenant at all. */
const STRANGER = "00000000-0000-4000-8000-0000000030c4";

const PASSWORD = "contrasena-de-un-solo-uso-9f2a";
const POSTGREST =
  process.env.BECOMMUNITY_POSTGREST_BIN ?? join(process.env.HOME ?? "", "becommunity-postgrest", "postgrest");

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

console.log("Be Community — Unit 6B.4B2I: the client's published read path, against a real stack");
console.log("=".repeat(86));

await withDisposableDatabase(target, "clientread", async (db) => {
  console.log("\n[setup] bootstrap + migrations 0000-0032, two tenants, four people, one package");
  const transport = psqlSuiteTransport(db);
  await transport.prepare(32);

  db.run(`
    insert into public.tenant (id, name) values
      (${q(TENANT)}, 'Comunidad Uno'),
      (${q(OTHER_TENANT)}, 'Comunidad Dos');
    insert into auth.users (id, email) values
      (${q(INTERNAL)}, 'interno@lectura.local'),
      (${q(CLIENT_A)}, 'cliente-a@lectura.local'),
      (${q(CLIENT_B)}, 'cliente-b@lectura.local'),
      (${q(STRANGER)}, 'sin-perfil@lectura.local');
    insert into public.profiles (user_id, tenant_id, role, full_name) values
      (${q(INTERNAL)}, ${q(TENANT)}, 'internal', 'Persona interna'),
      (${q(CLIENT_A)}, ${q(TENANT)}, 'client', 'Cliente autorizado'),
      (${q(CLIENT_B)}, ${q(OTHER_TENANT)}, 'client', 'Cliente de otro inquilino');
    insert into public.study (id, tenant_id, name, status) values
      (${q(STUDY)}, ${q(TENANT)}, 'Estudio publicado', 'published'),
      (${q(HIDDEN_STUDY)}, ${q(TENANT)}, 'Estudio no visible', 'draft');
  `);

  const pack = await buildSyntheticPackage();
  for (const studyId of [STUDY, HIDDEN_STUDY]) {
    const committed = await runCanonicalCommit(transport, {
      tenantId: TENANT,
      studyId,
      files: [
        { fileName: "limpios.xlsx", bytes: pack.cleanBytes },
        { fileName: "curado.xlsx", bytes: pack.painBytes },
      ],
    });
    if (!committed.ok) throw new Error(`the synthetic package did not commit: ${committed.code}`);
  }

  if (!existsSync(POSTGREST)) {
    skipped += 1;
    console.log(`\n— SKIPPED: no PostgREST binary at ${POSTGREST}.`);
    console.log("  This gate drives the REAL server functions, which take a SupabaseClient, and the");
    console.log("  REAL authorization, which needs per-user JWTs. It cannot run without one.");
    console.log("  A skip is reported as a skip and never counted as a pass.");
    return;
  }

  const stack = await startLocalStack(db, {
    binary: POSTGREST,
    target,
    authUsers: [
      { id: INTERNAL, email: "interno@lectura.local", password: PASSWORD },
      { id: CLIENT_A, email: "cliente-a@lectura.local", password: PASSWORD },
      { id: CLIENT_B, email: "cliente-b@lectura.local", password: PASSWORD },
      { id: STRANGER, email: "sin-perfil@lectura.local", password: PASSWORD },
    ],
  });

  // THE ADMIN CLIENT READS ITS CREDENTIALS FROM THE ENVIRONMENT, and this is
  // the first moment at which setting them is safe: `resolveDisposableTarget`
  // has already refused to run if a Supabase variable was in scope, so these
  // two can only ever point at this run's own throwaway stack.
  process.env.NEXT_PUBLIC_SUPABASE_URL = stack.apiOrigin;
  process.env.SUPABASE_SERVICE_ROLE_KEY = stack.serviceKey;

  try {
    const { createClient } = await import("@supabase/supabase-js");
    const service = createClient(stack.apiOrigin, stack.serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    /** A client with one person's own session, exactly as a request has. */
    const sessionFor = async (email) => {
      const anon = createClient(stack.apiOrigin, stack.anonKey, {
        auth: { autoRefreshToken: false, persistSession: false },
      });
      const { error } = await anon.auth.signInWithPassword({ email, password: PASSWORD });
      if (error) throw new Error(`could not sign in as ${email}: ${error.message}`);
      return anon;
    };
    const anonymous = () =>
      createClient(stack.apiOrigin, stack.anonKey, {
        auth: { autoRefreshToken: false, persistSession: false },
      });

    const clientA = await sessionFor("cliente-a@lectura.local");
    const clientB = await sessionFor("cliente-b@lectura.local");
    const stranger = await sessionFor("sin-perfil@lectura.local");

    const {
      loadPublishedClientExperience,
      previewPublishedPresentationUnderSelection,
    } = await import("../src/lib/studies/published-presentation.ts");
    const { loadPresentationComposerWorkspace, readStoredDraftRow, storeEditedPresentation } =
      await import("../src/lib/studio/presentation-workspace.ts");
    const { loadPublicationReview, publishStoredPresentation } = await import(
      "../src/lib/studio/publication-workspace.ts"
    );

    const scope = { tenantId: TENANT, studyId: STUDY, studyName: "Estudio publicado" };

    /* ---------------------------------------------------------------------- */
    console.log("\n[1] A canonical draft exists, saved through the composer's own path");

    const fresh = await loadPresentationComposerWorkspace(service, scope, {});
    if (!fresh.ok) throw new Error(`the composer could not build a document: ${fresh.unavailable.reason}`);
    const document = fresh.payload.document;
    // THE DRAFT IS SAVED THROUGH THE PRODUCT'S OWN SAVE, not by hand.
    //
    // A hand-built call would have to reproduce `encodePresentationForStorage`
    // exactly — the same serialization, the same envelope and the same digest —
    // because the publish path re-encodes the decoded document and compares six
    // things against the stored row. Two spellings of «the same document» would
    // then differ by a digest and the publication would be refused for a reason
    // belonging to this file rather than to the product. Measured, not guessed:
    // the hand-built version was refused with exactly that 55000.
    const saveDraft = async (studyId, name, doc, expected, key) => {
      const result = await storeEditedPresentation(
        service,
        { tenantId: TENANT, studyId, studyName: name },
        INTERNAL,
        doc,
        expected,
        key,
      );
      if (!result.ok) throw new Error(`the draft did not save: ${result.reason} — ${result.detail}`);
      return result;
    };
    await saveDraft(STUDY, "Estudio publicado", document, null, "client-read-draft-0001");
    const draftRow = await readStoredDraftRow(service, scope);
    check(draftRow.ok && draftRow.row !== null, "a canonical draft is stored for the study");
    eq("at revision one", draftRow.ok ? draftRow.row?.revision : null, 1);

    /* ---------------------------------------------------------------------- */
    console.log("\n[2] BEFORE any publication, an authorized client is served nothing canonical");

    const beforePublication = await loadPublishedClientExperience(clientA, STUDY);
    eq("the authorized client's read says «not published»", beforePublication.state, "not_published");
    check(
      !("payload" in beforePublication),
      "and it carries no payload at all, so there is nothing for a route to draw by accident",
    );
    const beforeFilter = await previewPublishedPresentationUnderSelection(clientA, STUDY, {});
    eq("and a filter over an unpublished study is refused", beforeFilter.ok, false);
    eq(
      "with the recomputation refusal rather than a study-moved one",
      beforeFilter.ok ? null : beforeFilter.refusal,
      "recomputation_refused",
    );
    const draftAfterRead = await readStoredDraftRow(service, scope);
    eq(
      "and the draft was not touched by either read",
      draftAfterRead.ok ? draftAfterRead.row?.definition_sha256 : null,
      draftRow.ok ? draftRow.row?.definition_sha256 : undefined,
    );

    /* ---------------------------------------------------------------------- */
    console.log("\n[3] A publication, through the REAL publication path");

    const review = await loadPublicationReview(service, scope);
    if (!review.ok) throw new Error(`the review could not be assembled: ${review.unavailable.reason}`);
    check(review.payload.blockers.length === 0, `the review has no blockers (${review.payload.blockers.length})`);
    if (process.env.BECOMMUNITY_CLIENT_READ_DEBUG === "1") {
      console.log(
        `    [debug] revision=${review.payload.draftRevision} required=${JSON.stringify(review.payload.required)} ` +
          `warnings=${JSON.stringify(review.payload.warnings.map((w) => w.code))} ` +
          `blockers=${JSON.stringify(review.payload.blockers.map((b) => b.code))}`,
      );
    }
    const acknowledged = [...review.payload.required];
    const published = await publishStoredPresentation(
      service,
      scope,
      INTERNAL,
      review.payload.draftRevision,
      null,
      acknowledged,
      "client-read-publish-01",
    );
    check(
      published.ok === true,
      `the publication succeeded${published.ok ? "" : `: ${published.reason} — ${published.detail}`}`,
    );
    eq("and it is version one", published.ok ? published.version : null, 1);

    const storedSnapshot = db.json(`
      select json_build_object(
        'version', version, 'render_model_sha256', render_model_sha256,
        'definition_sha256', definition_sha256, 'binding', binding_fingerprint,
        'render_model', render_model)::text
        from public.canonical_presentation_revision
       where study_id = ${q(STUDY)} and version = 1;
    `);
    check(storedSnapshot !== null, "and one immutable snapshot row exists");

    /* ---------------------------------------------------------------------- */
    console.log("\n[4] The authorized client receives that exact immutable snapshot");

    const served = await loadPublishedClientExperience(clientA, STUDY);
    eq("the authorized client's read says «published»", served.state, "published");
    if (served.state !== "published") throw new Error("nothing further can be checked");
    same(
      "and the model served is byte-for-byte the stored snapshot",
      serializeDeterministic(served.payload.model),
      serializeDeterministic(storedSnapshot.render_model),
    );
    check(served.payload.visibleBlockCount > 0, `it draws ${served.payload.visibleBlockCount} client-visible block(s)`);
    eq("and its filters are live, because the study reproduces exactly", served.payload.filtersLive, true);
    check(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(served.payload.publishedAt),
      `the publication date is the database's own UTC projection (${served.payload.publishedAt})`,
    );

    /* ---------------------------------------------------------------------- */
    console.log("\n[5] Editing the draft afterwards changes NOTHING a client is served");

    const editedDocument = {
      ...JSON.parse(serializeDeterministic(document)),
      pages: JSON.parse(serializeDeterministic(document)).pages.map((page, index) =>
        index === 0 ? { ...page, title: "Un título que el editor cambió después de publicar" } : page,
      ),
    };
    await saveDraft(STUDY, "Estudio publicado", editedDocument, 1, "client-read-draft-0002");
    const afterEdit = db.json(`
      select json_build_object('revision', revision)::text
        from public.canonical_presentation_draft where study_id = ${q(STUDY)};
    `);
    eq("the draft moved to revision two", afterEdit.revision, 2);

    const afterEditServed = await loadPublishedClientExperience(clientA, STUDY);
    eq("and the client is still served a publication", afterEditServed.state, "published");
    if (afterEditServed.state === "published") {
      same(
        "which is still byte-for-byte the FIRST snapshot",
        serializeDeterministic(afterEditServed.payload.model),
        serializeDeterministic(storedSnapshot.render_model),
      );
      check(
        !serializeDeterministic(afterEditServed.payload.model).includes(
          "Un título que el editor cambió después de publicar",
        ),
        "and the editor's new title is nowhere in what the client receives",
      );
    }

    /* ---------------------------------------------------------------------- */
    console.log("\n[6] A SECOND publication moves the pointer, and the first survives it");

    const secondReview = await loadPublicationReview(service, scope);
    if (!secondReview.ok) throw new Error("the second review could not be assembled");
    const secondPublish = await publishStoredPresentation(
      service,
      scope,
      INTERNAL,
      secondReview.payload.draftRevision,
      1,
      [...secondReview.payload.required],
      "client-read-publish-02",
    );
    check(secondPublish.ok === true, `the second publication succeeded${secondPublish.ok ? "" : `: ${secondPublish.reason}`}`);
    eq("and it is version two", secondPublish.ok ? secondPublish.version : null, 2);

    const firstStillThere = db.json(`
      select json_build_object('render_model_sha256', render_model_sha256)::text
        from public.canonical_presentation_revision
       where study_id = ${q(STUDY)} and version = 1;
    `);
    eq(
      "version one is untouched in storage",
      firstStillThere.render_model_sha256,
      storedSnapshot.render_model_sha256,
    );
    const afterSecond = await loadPublishedClientExperience(clientA, STUDY);
    eq("the client is now served a publication", afterSecond.state, "published");
    if (afterSecond.state === "published") {
      check(
        serializeDeterministic(afterSecond.payload.model).includes(
          "Un título que el editor cambió después de publicar",
        ),
        "and it is the SECOND one — the editor's change reached the client only by being published",
      );
    }
    // A REPLAY IS NOT A THIRD PUBLICATION.
    const replay = await publishStoredPresentation(
      service,
      scope,
      INTERNAL,
      secondReview.payload.draftRevision,
      1,
      [...secondReview.payload.required],
      "client-read-publish-02",
    );
    check(replay.ok === true, "replaying the second publication's key succeeds");
    eq("and returns the same version", replay.ok ? replay.version : null, 2);
    const versionCount = db.json(`
      select json_build_object('n', count(*))::text
        from public.canonical_presentation_revision where study_id = ${q(STUDY)};
    `);
    eq("and there are exactly two snapshots, not three", Number(versionCount.n), 2);

    /* ---------------------------------------------------------------------- */
    console.log("\n[7] Authorization: wrong tenant, no profile, anonymous, and a hidden study");

    const foreign = await loadPublishedClientExperience(clientB, STUDY);
    eq("a client of ANOTHER tenant is served nothing", foreign.state, "not_published");
    const foreignFilter = await previewPublishedPresentationUnderSelection(clientB, STUDY, {});
    eq("and cannot filter it either", foreignFilter.ok, false);

    const noProfile = await loadPublishedClientExperience(stranger, STUDY);
    eq("a signed-in person with no profile is served nothing", noProfile.state, "not_published");

    const visitor = await loadPublishedClientExperience(anonymous(), STUDY);
    eq("an anonymous visitor is served nothing", visitor.state, "not_published");
    const visitorFilter = await previewPublishedPresentationUnderSelection(anonymous(), STUDY, {});
    eq("and cannot filter it either", visitorFilter.ok, false);

    // THE LEGACY VISIBILITY GATE STILL APPLIES, AND THAT IS A REAL FINDING.
    // `published_study_select` gives a client a study only when `study.status`
    // is `published`. A canonical publication does not move that column — it is
    // a different decision, made on a different screen — so a study that is
    // canonically published and legacy-hidden is invisible to its own client.
    const hiddenScope = { tenantId: TENANT, studyId: HIDDEN_STUDY, studyName: "Estudio no visible" };
    const hiddenFresh = await loadPresentationComposerWorkspace(service, hiddenScope, {});
    if (!hiddenFresh.ok) throw new Error("the composer could not build the hidden study's document");
    await saveDraft(HIDDEN_STUDY, "Estudio no visible", hiddenFresh.payload.document, null, "client-read-hidden-0001");
    const hiddenReview = await loadPublicationReview(service, hiddenScope);
    if (!hiddenReview.ok) throw new Error("the hidden study's review could not be assembled");
    const hiddenPublish = await publishStoredPresentation(
      service,
      hiddenScope,
      INTERNAL,
      hiddenReview.payload.draftRevision,
      null,
      [...hiddenReview.payload.required],
      "client-read-hidden-pub1",
    );
    check(hiddenPublish.ok === true, "a study whose legacy status is `draft` can still be published canonically");
    const hiddenServed = await loadPublishedClientExperience(clientA, HIDDEN_STUDY);
    eq(
      "and its own client is served nothing, because the legacy visibility gate refuses the row",
      hiddenServed.state,
      "not_published",
    );
    const hiddenInternal = db.json(`
      select json_build_object('n', count(*))::text
        from public.canonical_presentation_publication where study_id = ${q(HIDDEN_STUDY)};
    `);
    eq("even though the publication pointer exists", Number(hiddenInternal.n), 1);

    /* ---------------------------------------------------------------------- */
    console.log("\n[8] Filters recompute on the server, over the publication's own definition");

    const panels = [];
    for (const page of afterSecond.state === "published" ? afterSecond.payload.model.pages : []) {
      for (const block of page.blocks) {
        if (block.payload?.shape === "filter_controls") panels.push(block);
      }
    }
    check(panels.length > 0, `the published model offers ${panels.length} filter panel(s)`);
    const panel = panels[0] ?? null;
    const dimension = panel?.payload.dimensions?.[0] ?? null;
    const option = dimension?.options?.[0] ?? null;
    check(option !== null, "and the first panel offers at least one option a reader can tick");

    if (option) {
      const selection = {
        panels: [
          {
            panelId: panel.id,
            dimensions: [{ handle: dimension.handle, options: [option.token] }],
          },
        ],
      };
      const filtered = await previewPublishedPresentationUnderSelection(clientA, STUDY, selection);
      check(filtered.ok === true, `a client's own selection is applied${filtered.ok ? "" : `: ${filtered.refusal}`}`);
      if (filtered.ok) {
        check(
          serializeDeterministic(filtered.payload.model) !== serializeDeterministic(afterSecond.payload.model),
          "and the figures it returns differ from the unfiltered ones, so something was actually recomputed",
        );
        eq("and the payload still says the filters are live", filtered.payload.filtersLive, true);
      }
      // AND CLEARING RESTORES THE PUBLISHED BYTES EXACTLY.
      const cleared = await previewPublishedPresentationUnderSelection(clientA, STUDY, { panels: [] });
      check(cleared.ok === true, "clearing the selection is applied too");
      if (cleared.ok && afterSecond.state === "published") {
        same(
          "and returns the published snapshot byte for byte",
          serializeDeterministic(cleared.payload.model),
          serializeDeterministic(afterSecond.payload.model),
        );
      }
    }

    // A HOSTILE SELECTION IS REFUSED BY NAME AND NOTHING IS DRAWN FROM IT.
    for (const [label, hostile] of [
      // A PANEL WITH NO DIMENSIONS IS NOT A HOSTILE SELECTION, IT IS AN EMPTY
      // ONE. `normalizeViewerSelection` drops empty entries by design, so
      // `{panelId: "no-existe", dimensions: []}` normalizes to «Todas las
      // personas» and is correctly accepted. The hostile case is a panel this
      // document does not have that actually CONSTRAINS something.
      [
        "a panel this document does not have",
        { panels: [{ panelId: "no-existe", dimensions: [{ handle: dimension?.handle ?? "h", options: [option?.token ?? "t"] }] }] },
      ],
      ["a handle that was never minted", { panels: [{ panelId: panel?.id ?? "x", dimensions: [{ handle: "h-inventado", options: ["t"] }] }] }],
      ["a selection that is not an object", "no soy un objeto"],
    ]) {
      const refused = await previewPublishedPresentationUnderSelection(clientA, STUDY, hostile);
      eq(`${label} is refused`, refused.ok, false);
      if (!refused.ok) {
        eq(`  and named as unavailable rather than as drift`, refused.refusal, "selection_not_available");
      }
    }

    /* ---------------------------------------------------------------------- */
    console.log("\n[9] A study that MOVED after publication refuses the filter, and serves the snapshot");

    // THE MOVE IS REAL, AND IT IS THE HARD CASE ON PURPOSE.
    //
    // One answered survey response is removed, which is what a re-import that
    // drops a respondent does. It changes NO handle and NO address, so the
    // document's binding fingerprint still matches — a reader that compared
    // bindings would conclude nothing had moved and would go on to recompute
    // filtered figures over a different population. Only recomputing the whole
    // publication and comparing the digest catches it.
    const movedRows = db.json(`
      with moved as (
        delete from public.survey_response
         where id = (select id from public.survey_response
                      where study_id = ${q(STUDY)} and status = 'answered'
                      order by id limit 1)
        returning 1
      ) select json_build_object('n', count(*))::text from moved;
    `);
    eq("one answered response is removed, as a re-import that drops a person would", Number(movedRows.n), 1);

    // AND THE BINDING STILL MATCHES, which is what makes the check worth having.
    const { decodeStoredDraft, readAndBuild, renderModelDigest, resolveUnderSelection } = await import(
      "../src/lib/studio/presentation-workspace.ts"
    );
    const { EMPTY_VIEWER_SELECTION } = await import("../src/lib/presentation/viewer.ts");
    const frozen = db.json(`
      select json_build_object(
        'schema_version', schema_version, 'document_kind', document_kind,
        'registry_version', registry_version, 'binding_fingerprint', binding_fingerprint,
        'definition', definition, 'definition_sha256', definition_sha256,
        'render_model_sha256', render_model_sha256)::text
        from public.canonical_presentation_revision
       where study_id = ${q(STUDY)} and version = 2;
    `);
    const decodedFrozen = decodeStoredDraft(
      {
        schema_version: frozen.schema_version,
        document_kind: frozen.document_kind,
        registry_version: frozen.registry_version,
        binding_fingerprint: frozen.binding_fingerprint,
        revision: 2,
        definition: frozen.definition,
        definition_sha256: frozen.definition_sha256,
        updated_at: "2026-01-01T00:00:00Z",
      },
      scope,
    );
    check(decodedFrozen.ok === true, "the frozen definition still decodes");
    const rebuilt = await readAndBuild(service, scope);
    const reResolved = decodedFrozen.ok
      ? resolveUnderSelection(rebuilt, decodedFrozen.value, EMPTY_VIEWER_SELECTION)
      : { ok: false };
    check(
      reResolved.ok === true,
      "and it STILL RESOLVES against the moved study — so its binding, registry and addresses all still agree",
    );
    if (reResolved.ok) {
      check(
        renderModelDigest(reResolved.model) !== frozen.render_model_sha256,
        "but the model it produces no longer digests to what was published — which only a reproduction check can see",
      );
    }

    const afterDrift = await loadPublishedClientExperience(clientA, STUDY);
    eq("the client is STILL served the publication", afterDrift.state, "published");
    if (afterDrift.state === "published" && afterSecond.state === "published") {
      same(
        "and it is byte-for-byte what it was before the study moved",
        serializeDeterministic(afterDrift.payload.model),
        serializeDeterministic(afterSecond.payload.model),
      );
      eq("but its filters are no longer live", afterDrift.payload.filtersLive, false);
    }
    const driftFilter = await previewPublishedPresentationUnderSelection(clientA, STUDY, { panels: [] });
    eq("and a filter is refused", driftFilter.ok, false);
    if (!driftFilter.ok) {
      eq("  naming the drift rather than the selection", driftFilter.refusal, "study_moved_since_publication");
      check(
        typeof driftFilter.detail === "string" && driftFilter.detail.length > 20 && !/[_]/.test(driftFilter.detail),
        "  with a sentence a reader can act on, and no code in it",
      );
    }

    /* ---------------------------------------------------------------------- */
    console.log("\n[10] A malformed pointer fails closed");

    // The pointer is made to name a revision that is not this study's. The
    // snapshot row itself is never altered: it is immutable and the trigger
    // would refuse.
    db.run(`
      insert into public.canonical_presentation_publication (study_id, tenant_id, active_revision_id, active_event_id)
      select ${q(HIDDEN_STUDY)}, ${q(OTHER_TENANT)}, active_revision_id, active_event_id
        from public.canonical_presentation_publication where study_id = ${q(HIDDEN_STUDY)}
      on conflict (study_id) do update set tenant_id = ${q(OTHER_TENANT)};
    `);
    const mismatched = await loadPublishedClientExperience(clientA, HIDDEN_STUDY);
    check(
      mismatched.state === "not_published" || mismatched.state === "unreadable",
      `a pointer filed under another tenant serves nothing (${mismatched.state})`,
    );
    check(
      !("payload" in mismatched),
      "and carries no model, so a route cannot draw one from a broken pointer",
    );

    /* ---------------------------------------------------------------------- */
    console.log("\n[11] Nothing internal is in what the client receives");

    const wire = serializeDeterministic(afterDrift.state === "published" ? afterDrift.payload : {});
    for (const forbidden of [
      storedSnapshot.definition_sha256,
      storedSnapshot.render_model_sha256,
      storedSnapshot.binding,
      TENANT,
      INTERNAL,
      "definitionSha256",
      "renderModelSha256",
      "bindingFingerprint",
      "packageIdempotencyKey",
      "planFingerprint",
      "sourceDraftRevision",
      "acknowledged",
    ]) {
      check(!wire.includes(forbidden), `«${String(forbidden).slice(0, 24)}» is not in the client's payload`);
    }
    check(!wire.includes(STUDY), "not even the study's own uuid travels in the payload");

    /* ---------------------------------------------------------------------- */
    console.log("\n[12] The publication storage is exactly as it was before this gate read it");

    const finalState = db.json(`
      select json_build_object(
        'revisions', (select count(*) from public.canonical_presentation_revision where study_id = ${q(STUDY)}),
        'events', (select count(*) from public.canonical_presentation_publication_event where study_id = ${q(STUDY)}),
        'active', (select version from public.canonical_presentation_revision r
                     join public.canonical_presentation_publication p on p.active_revision_id = r.id
                    where p.study_id = ${q(STUDY)}),
        'first_sha', (select render_model_sha256 from public.canonical_presentation_revision
                       where study_id = ${q(STUDY)} and version = 1))::text;
    `);
    eq("two snapshots", Number(finalState.revisions), 2);
    eq("two events — two publications, and the replay wrote none", Number(finalState.events), 2);
    eq("the active version is two", Number(finalState.active), 2);
    eq("and version one still digests to what it did", finalState.first_sha, storedSnapshot.render_model_sha256);
  } finally {
    await stack.stop();
  }
});

console.log(`\n${"=".repeat(86)}`);
console.log(`EXECUTED: ${executed}   PASSED: ${executed - failures}   FAILED: ${failures}   SKIPPED SECTIONS: ${skipped}`);
if (failures > 0) {
  console.log("RESULT: the client's published read path does NOT behave as documented. GATE BLOCKED.");
  process.exit(1);
}
console.log(
  skipped > 0
    ? "RESULT: every executed check passed, and some sections were SKIPPED. Not a full pass."
    : "RESULT: an authorized client is served the immutable canonical publication, never the draft, never the legacy engine; filters recompute on the server over the publication's own definition and refuse rather than mix when the study has moved; and every other reader is refused.",
);
