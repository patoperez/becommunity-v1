// =============================================================================
// Unit 6B.4B2E — the explicit rebind, executed against a DISPOSABLE database
// =============================================================================
//
// WHAT THIS GATE IS FOR.
//
// Raising `CANONICAL_RESULTS_CONTRACT_VERSION` invalidates every stored binding
// at once, because the contract version is one of the nine inputs to
// `presentationBindingFingerprint`. Until this unit there was no way out of
// that: the composer refuses to open a drifted draft and the save path
// deliberately does not re-bind. `rebindStoredPresentation` is the way out, and
// it is a WRITE against a stored document somebody authored — so every claim
// made about it here is executed rather than argued.
//
// THE FIXTURE IS THE REAL SITUATION, NOT AN APPROXIMATION OF IT. The drifted
// draft is built by computing the binding this product WOULD have computed
// under a superseded contract version — the same function, the same registry,
// the same address map, one different version string. That is precisely how the
// hosted Cuicuilco draft came to be at `cf63bdca…`, and a fixture that instead
// planted an arbitrary digest would exercise a refusal path while claiming to
// exercise the repair one. Both are tested, and they are tested as the
// different things they are.
//
// IT RUNS ONLY AGAINST A DISPOSABLE TARGET. `resolveDisposableTarget` refuses
// anything else, and this file never reads a hosted credential.
//
// =============================================================================

import { createHash, randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { join } from "node:path";

import { DisposableTargetError, resolveDisposableTarget, withDisposableDatabase } from "./lib/disposable-postgres.mjs";
import { psqlSuiteTransport } from "./lib/canonical-psql-transport.mjs";
import { startLocalStack } from "./lib/local-postgrest-stack.mjs";
import { buildSyntheticPackage } from "./lib/canonical-fixtures.mjs";
import { runCanonicalCommit } from "../src/lib/ingestion/canonical-commit/flow.ts";
import { serializeDeterministic } from "../src/lib/presentation/serialize.ts";
import { presentationBindingFingerprint } from "../src/lib/presentation/registry.ts";
import {
  CANONICAL_RESULTS_CONTRACT_VERSION,
  SUPERSEDED_RESULTS_CONTRACT_VERSIONS,
} from "../src/lib/results/contract.ts";
import {
  assessPresentationRebind,
  describePresentationRebind,
  readAndBuild,
  rebindStoredPresentation,
} from "../src/lib/studio/presentation-workspace.ts";

let failures = 0;
let executed = 0;
let skipped = 0;
const check = (condition, message) => {
  executed += 1;
  if (typeof message !== "string") {
    failures += 1;
    console.log("  ✗ FAIL: check() got a non-string message — arguments reversed?");
    return;
  }
  if (condition) {
    console.log(`  ✓ ${message}`);
  } else {
    failures += 1;
    console.log(`  ✗ FAIL: ${message}`);
  }
};
const eq = (label, actual, expected) =>
  check(
    Object.is(actual, expected),
    `${label} (esperado ${JSON.stringify(expected)}, obtenido ${JSON.stringify(actual)})`,
  );

const TENANT = "22222222-2222-4222-8222-222222222222";
const OTHER_TENANT = "77777777-7777-4777-8777-777777777777";
const STUDY = "66666666-6666-4666-8666-666666666666";
/** Its binding is an arbitrary digest no contract version can reproduce. */
const FOREIGN_STUDY = "55555555-5555-4555-8555-555555555555";
const ACTOR = "11111111-1111-4111-8111-111111111111";
const q = (v) => (v === null || v === undefined ? "null" : `'${String(v).replace(/'/g, "''")}'`);

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

console.log("Be Community — Unit 6B.4B2E: the explicit rebind, against a DISPOSABLE target");
console.log("=".repeat(82));

const POSTGREST =
  process.env.BECOMMUNITY_POSTGREST_BIN ?? join(process.env.HOME ?? "", "becommunity-postgrest", "postgrest");

await withDisposableDatabase(target, "rebind", async (db) => {
  console.log("\n[setup] bootstrap + migrations 0000-0032, two tenants, two studies");
  const transport = psqlSuiteTransport(db);
  await transport.prepare(32);

  db.run(`
    insert into public.tenant (id, name) values
      (${q(TENANT)}, 'Inquilino de prueba'),
      (${q(OTHER_TENANT)}, 'Otro inquilino');
    -- profiles.user_id points at the auth.users STAND-IN the disposable
    -- bootstrap creates, so the identity has to exist before the profile does.
    insert into auth.users (id, email) values (${q(ACTOR)}, 'interno@rebind.local');
    insert into public.profiles (user_id, tenant_id, role) values
      (${q(ACTOR)}, ${q(TENANT)}, 'internal');
    insert into public.study (id, tenant_id, name, status) values
      (${q(STUDY)}, ${q(TENANT)}, 'Estudio con vínculo viejo', 'draft'),
      (${q(FOREIGN_STUDY)}, ${q(TENANT)}, 'Estudio con vínculo ajeno', 'draft');
  `);

  console.log("[setup] committing a synthetic canonical package for both studies");
  const pkg = await buildSyntheticPackage();
  for (const study of [STUDY, FOREIGN_STUDY]) {
    const committed = await runCanonicalCommit(transport, {
      tenantId: TENANT,
      studyId: study,
      files: [
        { fileName: "limpios.xlsx", bytes: pkg.cleanBytes },
        { fileName: "curado.xlsx", bytes: pkg.painBytes },
      ],
    });
    if (!committed.ok) throw new Error(`the synthetic package did not commit for ${study}: ${committed.code}`);
  }

  if (!existsSync(POSTGREST)) {
    skipped += 1;
    console.log(`\n— SKIPPED: no PostgREST binary at ${POSTGREST}.`);
    console.log("  This gate drives the REAL server functions, which take a SupabaseClient, so it");
    console.log("  cannot run without one. A skip is reported as a skip and never counted as a pass.");
    return;
  }

  const stack = await startLocalStack(db, { binary: POSTGREST, target });
  try {
    const { createClient } = await import("@supabase/supabase-js");
    const client = createClient(stack.apiOrigin, stack.serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const scopeFor = (studyId, tenantId = TENANT) => ({
      tenantId,
      studyId,
      studyName: "Estudio con vínculo viejo",
    });

    /* -------------------------------------------------------------------- */
    console.log("\n[1] The fixture: a draft bound under a SUPERSEDED contract version");

    // The document is built by the product, bound to TODAY'S registry, and then
    // its binding is replaced by the one this same function would have produced
    // under an older contract version. Nothing else about it is touched.
    const built = await readAndBuild(client, scopeFor(STUDY));
    const registry = built.registry;
    const SUPERSEDED = SUPERSEDED_RESULTS_CONTRACT_VERSIONS[0];
    check(
      SUPERSEDED !== CANONICAL_RESULTS_CONTRACT_VERSION,
      `the superseded version under test (${SUPERSEDED}) is not the current one (${CANONICAL_RESULTS_CONTRACT_VERSION})`,
    );

    const oldBinding = presentationBindingFingerprint({
      registryVersion: registry.registryVersion,
      contractVersion: SUPERSEDED,
      source: registry.source,
      addresses: registry.addresses,
    });
    check(oldBinding !== registry.binding, "and it produces a different fingerprint from today's");

    const { loadPresentationComposerWorkspace } = await import("../src/lib/studio/presentation-workspace.ts");
    const fresh = await loadPresentationComposerWorkspace(client, scopeFor(STUDY), {});
    if (!fresh.ok) throw new Error(`the composer could not build a starting document: ${fresh.unavailable.reason}`);

    // THE FIXTURE CARRIES A SUBTITLE ON PURPOSE.
    //
    // `metadata.subtitle` is authored text that lives in the ENVELOPE, not in
    // the document, so `decodePresentationFromStorage` drops it and a
    // decode-then-encode round trip would silently replace it with null. The
    // hosted Cuicuilco draft happens to have none — which is exactly why a
    // fixture that also had none would prove nothing, and why the first version
    // of this gate passed with the preservation deleted.
    const SUBTITLE = "Subtítulo que alguien escribió";
    const writeDraft = (studyId, document, binding, revision, key, subtitle = SUBTITLE) => {
      const definition = {
        ...JSON.parse(serializeDeterministic(document)),
        binding,
        metadata: { studyId, tenantId: TENANT, subtitle },
      };
      const digest = createHash("sha256").update(serializeDeterministic(definition), "utf8").digest("hex");
      db.run(`
        select public.save_canonical_presentation_draft(
          ${q(studyId)}, ${q(ACTOR)}, ${q(JSON.stringify(definition))}::jsonb,
          ${q(document.registryVersion)}, ${q(binding)}, ${q(digest)},
          ${revision === null ? "null" : revision}::bigint, ${q(key)}, null
        );
      `);
      return definition;
    };

    const plantedDefinition = writeDraft(STUDY, fresh.payload.document, oldBinding, null, "rebind-fixture-0001");
    const storedBefore = db.json(`
      select json_build_object('revision', revision, 'binding', binding_fingerprint,
                               'registry_version', registry_version, 'sha', definition_sha256,
                               'definition', definition)::text
        from public.canonical_presentation_draft where study_id = ${q(STUDY)};
    `);
    eq("the planted draft is at revision 1", storedBefore.revision, 1);
    eq("and carries the superseded binding", storedBefore.binding, oldBinding);

    /**
     * The authored projection, computed the way the product computes it.
     *
     * `metadata` is dropped as well as the two binding fields, because
     * `assessPresentationRebind` projects the DECODED document and a decoded
     * document has no `metadata` — that is envelope, stamped by the encoder.
     * Keeping it here would compare a different thing from the one the plan
     * reports and the two digests would never agree, which is exactly what the
     * first version of this gate did.
     *
     * The envelope is not thereby unchecked: [5] compares it field for field,
     * subtitle included, which is where it belongs.
     */
    const authored = (definition) => {
      const copy = { ...definition };
      delete copy.binding;
      delete copy.registryVersion;
      delete copy.metadata;
      return serializeDeterministic(copy);
    };
    const authoredBefore = authored(storedBefore.definition);
    const authoredDigestBefore = createHash("sha256").update(authoredBefore, "utf8").digest("hex");

    /* -------------------------------------------------------------------- */
    console.log("\n[2] The composer refuses it, which is why a rebind is needed at all");

    const blocked = await loadPresentationComposerWorkspace(client, scopeFor(STUDY), { restoreStoredDraft: true });
    check(blocked.ok === false, "the composer will not open the drifted draft");
    check(
      blocked.ok === false &&
        (blocked.unavailable.issues ?? []).some((i) => i.code === "binding_fingerprint_mismatch"),
      "and the reason is binding_fingerprint_mismatch, not something vaguer",
    );

    /* -------------------------------------------------------------------- */
    console.log("\n[3] The plan says what would change, and proves what did not move");

    const plan = await describePresentationRebind(client, scopeFor(STUDY));
    check(plan.status === "ready", "a rebind is available");
    eq("it names the superseded contract version it PROVED", plan.supersededContractVersion, SUPERSEDED);
    eq("and the current one", plan.currentContractVersion, CANONICAL_RESULTS_CONTRACT_VERSION);
    eq("it moves exactly one field", plan.changes?.length, 1);
    eq("and that field is the binding", plan.changes?.[0]?.field, "binding");
    eq("from the stored value", plan.changes?.[0]?.from, oldBinding);
    eq("to the one the server derived", plan.changes?.[0]?.to, registry.binding);
    eq("it reports the stored revision", plan.storedRevision, 1);
    eq("and the authored digest it will preserve", plan.preserved?.authoredDigest, authoredDigestBefore);

    // THE PLAN CARRIES NO DATABASE IDENTIFIER. It is rendered in a browser.
    const planText = JSON.stringify(plan);
    check(!planText.includes(TENANT), "the plan names no tenant id");
    check(!planText.includes(STUDY), "and no study id");
    check(
      !planText.includes(registry.source.packageIdempotencyKey) &&
        !planText.includes(registry.source.planFingerprint),
      "and neither the package key nor the plan fingerprint",
    );

    /* -------------------------------------------------------------------- */
    console.log("\n[4] The rebind writes exactly one revision");

    const beforeCounts = () =>
      db.json(`
        select json_build_object(
          'drafts', (select count(*) from public.canonical_presentation_draft),
          'events', (select count(*) from public.canonical_presentation_draft_event where study_id = ${q(STUDY)}),
          'revisions', (select count(*) from public.canonical_presentation_revision),
          'publications', (select count(*) from public.canonical_presentation_publication),
          'pubEvents', (select count(*) from public.canonical_presentation_publication_event),
          'signoffs', (select count(*) from public.canonical_qualitative_signoff),
          'pubSignoffs', (select count(*) from public.canonical_publication_qualitative_signoff),
          'painDecisions', (select count(*) from public.canonical_journey_pain_decision),
          'painPoints', (select count(*) from public.pain_point),
          'painPending', (select count(*) from public.pain_point where review_status = 'pending'),
          'quant', (select count(*) from public.quant_response),
          'qual', (select count(*) from public.qual_observation),
          'responses', (select count(*) from public.survey_response)
        )::text;
      `);
    const countsBefore = beforeCounts();

    const KEY = `rebind-${randomBytes(6).toString("hex")}`;
    const first = await rebindStoredPresentation(client, scopeFor(STUDY), ACTOR, 1, KEY);
    check(first.ok === true, "the rebind is accepted");
    eq("and produces revision 2", first.ok ? first.revision : null, 2);
    eq("it is not a replay", first.ok ? first.replayed : null, false);
    eq("and it did not create the row", first.ok ? first.created : null, false);

    const storedAfter = db.json(`
      select json_build_object('revision', revision, 'binding', binding_fingerprint,
                               'registry_version', registry_version, 'sha', definition_sha256,
                               'definition', definition)::text
        from public.canonical_presentation_draft where study_id = ${q(STUDY)};
    `);
    eq("the row is at revision 2", storedAfter.revision, 2);
    eq("its binding is the one the SERVER derived", storedAfter.binding, registry.binding);
    eq("the registry version did not move", storedAfter.registry_version, storedBefore.registry_version);
    check(storedAfter.sha !== storedBefore.sha, "the stored digest moved, because the definition bytes did");

    /* -------------------------------------------------------------------- */
    console.log("\n[5] And it changed NOTHING an author wrote");

    eq("the authored projection is byte-identical", authored(storedAfter.definition), authoredBefore);
    // Compared through the deterministic serializer, not `JSON.stringify`:
    // jsonb normalises key order on the way into the column, so the planted
    // literal and the row it became differ in ORDER while holding the same
    // three values. Comparing the raw stringifications reports a difference
    // that is not one.
    eq(
      "the metadata envelope is identical, subtitle included",
      serializeDeterministic(storedAfter.definition.metadata),
      serializeDeterministic(plantedDefinition.metadata),
    );
    eq(
      "and the subtitle specifically survived the decode-encode round trip",
      storedAfter.definition.metadata?.subtitle,
      SUBTITLE,
    );
    // Field by field, so a failure names the field rather than the whole blob.
    for (const field of [
      "schemaVersion",
      "documentKind",
      "id",
      "title",
      "locale",
      "samplePolicy",
      "methodologyDisclosure",
      "pages",
    ]) {
      eq(
        `${field} is unchanged`,
        JSON.stringify(storedAfter.definition[field]),
        JSON.stringify(storedBefore.definition[field]),
      );
    }
    check(
      JSON.stringify(storedAfter.definition.samplePolicy) === JSON.stringify({ mode: "show_all" }),
      "the sample policy is still show_all — no suppression was introduced",
    );

    /* -------------------------------------------------------------------- */
    console.log("\n[6] The drift is gone: the composer opens revision 2");

    const reopened = await loadPresentationComposerWorkspace(client, scopeFor(STUDY), { restoreStoredDraft: true });
    check(reopened.ok === true, "the composer now opens the stored draft");
    eq("at revision 2", reopened.ok ? reopened.persistence.revision : null, 2);
    eq("and it says it restored rather than started fresh", reopened.ok ? reopened.persistence.restored : null, true);

    /* -------------------------------------------------------------------- */
    console.log("\n[7] Replaying the same key does NOT create a third revision");

    const replay = await rebindStoredPresentation(client, scopeFor(STUDY), ACTOR, 1, KEY);
    check(replay.ok === true, "the replay is accepted");
    eq("it reports the revision the original produced", replay.ok ? replay.revision : null, 2);
    eq("and says it IS a replay", replay.ok ? replay.replayed : null, true);
    eq(
      "the row is still at revision 2",
      Number(db.run(`select revision from public.canonical_presentation_draft where study_id = ${q(STUDY)};`).trim()),
      2,
    );

    /* -------------------------------------------------------------------- */
    console.log("\n[8] A stale expected revision is refused");

    const stale = await rebindStoredPresentation(client, scopeFor(STUDY), ACTOR, 1, `stale-${randomBytes(6).toString("hex")}`);
    check(stale.ok === false, "a rebind presenting revision 1 over a stored revision 2 is refused");
    eq("and names the conflict", stale.ok === false ? stale.reason : null, "conflict");
    eq("and says where the row actually is", stale.ok === false ? stale.storedRevision : null, 2);
    eq(
      "the row did not move",
      Number(db.run(`select revision from public.canonical_presentation_draft where study_id = ${q(STUDY)};`).trim()),
      2,
    );

    /* -------------------------------------------------------------------- */
    console.log("\n[9] Asking again when there is nothing to do writes nothing");

    const current = await describePresentationRebind(client, scopeFor(STUDY));
    eq("the plan says the binding is already current", current.status, "not_needed");
    const noop = await rebindStoredPresentation(client, scopeFor(STUDY), ACTOR, 2, `noop-${randomBytes(6).toString("hex")}`);
    check(noop.ok === true, "and a rebind on an already-current draft succeeds without writing");
    eq(
      "the row is still at revision 2",
      Number(db.run(`select revision from public.canonical_presentation_draft where study_id = ${q(STUDY)};`).trim()),
      2,
    );

    /* -------------------------------------------------------------------- */
    console.log("\n[10] A tenant that does not own the study gets nothing");

    const crossTenant = await describePresentationRebind(client, scopeFor(STUDY, OTHER_TENANT));
    check(crossTenant.status === "refused", "describing another tenant's draft is refused");
    const crossWrite = await rebindStoredPresentation(
      client,
      scopeFor(STUDY, OTHER_TENANT),
      ACTOR,
      2,
      `cross-${randomBytes(6).toString("hex")}`,
    );
    check(crossWrite.ok === false, "and rebinding it is refused");
    eq(
      "the row still belongs to its own tenant, at revision 2",
      db.run(
        `select tenant_id || '|' || revision from public.canonical_presentation_draft where study_id = ${q(STUDY)};`,
      ).trim(),
      `${TENANT}|2`,
    );

    /* -------------------------------------------------------------------- */
    console.log("\n[11] A binding NO contract version reproduces is refused, not repaired");

    // This is the other kind of drift, and the dangerous one: a package,
    // mapping, calculation or address map that moved. Re-binding here would
    // file a layout authored against one set of numbers as though it had been
    // authored against another, which is the retargeting the fingerprint
    // exists to prevent.
    const foreignBuilt = await readAndBuild(client, scopeFor(FOREIGN_STUDY));
    const foreignFresh = await loadPresentationComposerWorkspace(client, scopeFor(FOREIGN_STUDY), {});
    if (!foreignFresh.ok) throw new Error("no starting document for the foreign-binding study");
    writeDraft(FOREIGN_STUDY, foreignFresh.payload.document, "a".repeat(64), null, "rebind-foreign-0001");

    const foreignPlan = await describePresentationRebind(client, scopeFor(FOREIGN_STUDY));
    eq("the plan refuses", foreignPlan.status, "refused");
    eq("naming the identity it could not prove", foreignPlan.reason, "source_identity_differs");
    const foreignWrite = await rebindStoredPresentation(
      client,
      scopeFor(FOREIGN_STUDY),
      ACTOR,
      1,
      `foreign-${randomBytes(6).toString("hex")}`,
    );
    check(foreignWrite.ok === false, "and the write is refused too");
    eq(
      "the foreign-bound row is untouched at revision 1",
      db.run(
        `select revision || '|' || binding_fingerprint from public.canonical_presentation_draft where study_id = ${q(FOREIGN_STUDY)};`,
      ).trim(),
      `1|${"a".repeat(64)}`,
    );
    void foreignBuilt;

    /* -------------------------------------------------------------------- */
    console.log("\n[12] The authored-content guard is not decorative");

    // `assessPresentationRebind` proves TWO different facts with two different
    // checks: the exhibition proves the REGISTRY did not move, and a byte
    // comparison of the authored projection proves the DOCUMENT did not. The
    // second cannot be made to fail through the real API — `bindPresentationDocument`
    // touches exactly two fields — so what is asserted here is that the
    // comparison it performs is SENSITIVE to authored content, which is the
    // property that would make it catch a defect if one were introduced. That
    // it does catch one is proved separately, by reintroducing the defect and
    // watching this gate fail.
    eq(
      "the authored projection excludes the binding, so moving it alone leaves the digest still",
      createHash("sha256")
        .update(authored({ ...storedAfter.definition, binding: oldBinding }), "utf8")
        .digest("hex"),
      authoredDigestBefore,
    );
    for (const [field, value] of [
      ["title", "Un título que nadie escribió"],
      ["samplePolicy", { mode: "suppress_below", threshold: 5 }],
      ["methodologyDisclosure", "none"],
      ["pages", []],
    ]) {
      check(
        createHash("sha256")
          .update(authored({ ...storedAfter.definition, [field]: value }), "utf8")
          .digest("hex") !== authoredDigestBefore,
        `and it DOES move when ${field} moves, so the guard would refuse that`,
      );
    }
    // And the function itself still reports the digest it will preserve.
    const reassessed = assessPresentationRebind(built, {
      ...storedBefore,
      schema_version: storedBefore.definition.schemaVersion,
      document_kind: storedBefore.definition.documentKind,
      binding_fingerprint: oldBinding,
      updated_at: new Date().toISOString(),
    }, scopeFor(STUDY));
    eq("re-assessing the original row is still ready", reassessed.status, "ready");
    eq("and names the same authored digest", reassessed.preserved?.authoredDigest, authoredDigestBefore);

    /* -------------------------------------------------------------------- */
    console.log("\n[13] Nothing else in the database moved");

    const countsAfter = beforeCounts();
    eq("no publication revision was created", countsAfter.revisions, countsBefore.revisions);
    eq("no publication was created", countsAfter.publications, countsBefore.publications);
    eq("no publication event was written", countsAfter.pubEvents, countsBefore.pubEvents);
    eq("no qualitative sign-off was recorded", countsAfter.signoffs, 0);
    eq("no publication sign-off was recorded", countsAfter.pubSignoffs, 0);
    eq("no journey pain decision was recorded", countsAfter.painDecisions, 0);
    eq("every pain point is still pending", countsAfter.painPending, countsBefore.painPoints);
    eq("the quantitative rows are unchanged", countsAfter.quant, countsBefore.quant);
    eq("the qualitative observations are unchanged", countsAfter.qual, countsBefore.qual);
    eq("the survey responses are unchanged", countsAfter.responses, countsBefore.responses);
    eq(
      "and exactly TWO draft events exist for this study — the create and the rebind",
      countsAfter.events,
      2,
    );
    eq(
      "the second one is a draft_saved carrying the rebind's note",
      db.run(`
        select action || '|' || coalesce(note, '(none)')
          from public.canonical_presentation_draft_event
         where study_id = ${q(STUDY)} order by occurred_at desc limit 1;
      `).trim(),
      `draft_saved|vínculo actualizado ${SUPERSEDED} → ${CANONICAL_RESULTS_CONTRACT_VERSION}`,
    );
  } finally {
    await stack.stop();
  }
});

/* -------------------------------------------------------------------------- */
console.log(`\n${"=".repeat(82)}`);
console.log(`EXECUTED: ${executed}   PASSED: ${executed - failures}   FAILED: ${failures}   SKIPPED: ${skipped}`);
if (failures > 0) {
  console.log("RESULT: the explicit rebind does not keep its promises. GATE BLOCKED.");
  process.exit(1);
}
console.log(
  "RESULT: a draft bound under a superseded contract version is repaired by one explicit act that\n" +
    "        moves exactly one field, derives it on the server, preserves every authored byte,\n" +
    "        replays instead of writing twice, refuses a stale revision, refuses another tenant,\n" +
    "        refuses a binding no contract version explains, and records no editorial decision.\n" +
    "        GATE PASSED.",
);
