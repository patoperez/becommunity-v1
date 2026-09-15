// =============================================================================
// Unit 6B.4B2H — the explicit capability upgrade, executed against a DISPOSABLE
// database
// =============================================================================
//
// WHAT THIS GATE IS FOR.
//
// `requiredContent` was added to `PresentationBlock` after documents had been
// stored. A document older than the field does not declare which of its blocks
// the layout requires, so the publication preflight reads a missing required
// block as the ACKNOWLEDGEABLE warning `configuration_required_blocks` instead
// of the non-acknowledgeable blocker `required_content_missing`. That is the
// hosted Cuicuilco draft's exact situation and it was measured, not assumed:
// its stored definition contains the key zero times.
//
// `upgradeStoredPresentationCapabilities` is the way out, and it is a WRITE
// against a document somebody authored — so every claim made about it here is
// EXECUTED rather than argued.
//
// THE FIXTURE IS THE REAL SITUATION. The planted draft is the product's own
// document with every `requiredContent` stripped, at revision 2, bound to
// today's registry. That is what a legacy row looks like. A fixture that
// planted a document which already carried the flag would exercise the
// «nothing to do» branch while claiming to exercise the upgrade.
//
// IT RUNS ONLY AGAINST A DISPOSABLE TARGET. `resolveDisposableTarget` refuses
// anything else, and this file never reads a hosted credential.
//
// =============================================================================

import { createHash, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { join } from "node:path";

import { DisposableTargetError, resolveDisposableTarget, withDisposableDatabase } from "./lib/disposable-postgres.mjs";
import { psqlSuiteTransport } from "./lib/canonical-psql-transport.mjs";
import { startLocalStack } from "./lib/local-postgrest-stack.mjs";
import { runCanonicalCommit } from "../src/lib/ingestion/canonical-commit/flow.ts";
import { serializeDeterministic } from "../src/lib/presentation/serialize.ts";
import {
  assessCapabilityUpgrade,
  describeCapabilityUpgrade,
  loadPresentationComposerWorkspace,
  readAndBuild,
  readStoredDraftRow,
  upgradeStoredPresentationCapabilities,
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
const eq = (message, actual, expected) =>
  check(
    actual === expected,
    `${message} (${JSON.stringify(actual)}${actual === expected ? "" : ` — expected ${JSON.stringify(expected)}`})`,
  );

const q = (value) => `'${String(value).replace(/'/g, "''")}'`;
const sha = (text) => createHash("sha256").update(text, "utf8").digest("hex");

const TENANT = "00000000-0000-4000-8000-00000000c001";
const OTHER_TENANT = "00000000-0000-4000-8000-00000000c002";
const STUDY = "00000000-0000-4000-8000-00000000d001";
const ACTOR = "00000000-0000-4000-8000-00000000e001";
const POSTGREST = process.env.BECOMMUNITY_POSTGREST_BIN ?? join(process.env.HOME ?? "", "becommunity-postgrest", "postgrest");

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

console.log("Be Community — Unit 6B.4B2H: the explicit capability upgrade, on a disposable database");
console.log("=".repeat(86));

await withDisposableDatabase(target, "capability", async (db) => {
  console.log("\n[setup] bootstrap + migrations 0000-0032, one tenant, one study");
  const transport = psqlSuiteTransport(db);
  await transport.prepare(32);

  db.run(`
    insert into public.tenant (id, name) values
      (${q(TENANT)}, 'Inquilino de prueba'),
      (${q(OTHER_TENANT)}, 'Otro inquilino');
    insert into auth.users (id, email) values (${q(ACTOR)}, 'interno@capacidad.local');
    insert into public.profiles (user_id, tenant_id, role) values
      (${q(ACTOR)}, ${q(TENANT)}, 'internal');
    insert into public.study (id, tenant_id, name, status) values
      (${q(STUDY)}, ${q(TENANT)}, 'Estudio con borrador heredado', 'draft');
  `);

  // THE FIXTURE NEEDS THE APPROVED BLUEPRINT, AND ONLY THE REAL PACKAGE
  // SELECTS IT.
  //
  // `requiredContent` is authored per block, and the only registered layout that
  // marks any block with it is `cuicuilco-aprobado`. `chooseBlueprint` selects a
  // registered layout only when the registry publishes every handle that layout
  // names, and the synthetic package deliberately does not — it produced
  // `inicio-generico`, whose blocks are all optional, so an upgrade would have
  // had nothing to add and this gate would have passed while testing the
  // «nothing to do» branch.
  //
  // So the package committed here is the REAL one when its two workbooks are
  // available, and the gate is SKIPPED when they are not. A skip is reported as
  // a skip and never counted as a pass. The alternative — teaching the generic
  // blueprint to require something, or giving production a test hook — would be
  // changing the product to suit its test.
  const cleanPath = process.env.CANONICAL_RESULTS_PARITY_CLEAN_XLSX;
  const painPath = process.env.CANONICAL_RESULTS_PARITY_PAIN_XLSX;
  if (!cleanPath || !painPath || !existsSync(cleanPath) || !existsSync(painPath)) {
    skipped += 1;
    console.log("\n— SKIPPED: this gate needs the two real workbooks, whose paths are machine-specific.");
    console.log("  Set CANONICAL_RESULTS_PARITY_CLEAN_XLSX and _PAIN_XLSX.");
    console.log("  Only the approved blueprint marks a block as required content, and only the real");
    console.log("  package selects it. A skip is reported as a skip and never counted as a pass.");
    return;
  }

  console.log("[setup] committing the real canonical package, so the approved blueprint is selectable");
  const { readFileSync } = await import("node:fs");
  const bytesOf = (path) => {
    const buffer = readFileSync(path);
    return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
  };
  const committed = await runCanonicalCommit(transport, {
    tenantId: TENANT,
    studyId: STUDY,
    files: [
      { fileName: cleanPath.replace(/^.*[\\/]/, ""), bytes: bytesOf(cleanPath) },
      { fileName: painPath.replace(/^.*[\\/]/, ""), bytes: bytesOf(painPath) },
    ],
  });
  if (!committed.ok) throw new Error(`the real package did not commit: ${committed.code}`);

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

    const scope = { tenantId: TENANT, studyId: STUDY, studyName: "Estudio con borrador heredado" };
    const foreignScope = { ...scope, tenantId: OTHER_TENANT };

    /* -------------------------------------------------------------------- */
    console.log("\n[1] The fixture: a stored draft that PREDATES `requiredContent`");

    const fresh = await loadPresentationComposerWorkspace(client, scope, {});
    if (!fresh.ok) throw new Error(`the composer could not build a starting document: ${fresh.unavailable.reason}`);
    const blueprintId = fresh.payload.blueprint?.id ?? "(none)";
    check(
      blueprintId === "cuicuilco-aprobado",
      `the synthetic package selects the approved blueprint (${blueprintId}) — the one that marks a block required`,
    );

    const requiredInBlueprint = fresh.payload.document.pages.flatMap((page) =>
      page.blocks.filter((block) => block.requiredContent === true).map((block) => block.id),
    );
    check(
      requiredInBlueprint.length > 0,
      `today's blueprint marks ${requiredInBlueprint.length} block(s) as required content (${requiredInBlueprint.join(", ")})`,
    );

    // THE LEGACY DOCUMENT: the same document with every `requiredContent`
    // stripped. This is what a row saved before the field looks like.
    const legacy = JSON.parse(serializeDeterministic(fresh.payload.document));
    for (const page of legacy.pages) for (const block of page.blocks) delete block.requiredContent;
    check(
      !JSON.stringify(legacy).includes("requiredContent"),
      "the planted document carries the key zero times, exactly as the hosted one does",
    );

    const SUBTITLE = "Subtítulo que alguien escribió";
    const plant = (document, expected, key) => {
      const definition = {
        ...JSON.parse(serializeDeterministic(document)),
        metadata: { studyId: STUDY, tenantId: TENANT, subtitle: SUBTITLE },
      };
      db.run(`
        select public.save_canonical_presentation_draft(
          ${q(STUDY)}, ${q(ACTOR)}, ${q(JSON.stringify(definition))}::jsonb,
          ${q(document.registryVersion)}, ${q(document.binding)},
          ${q(sha(serializeDeterministic(definition)))},
          ${expected === null ? "null" : expected}::bigint, ${q(key)}, null
        );
      `);
      return definition;
    };
    plant(legacy, null, "capability-fixture-0001");
    // A SECOND SAVE, so the fixture sits at REVISION 2 exactly as the hosted
    // draft does. The upgrade under test is therefore 2 → 3, not 1 → 2.
    plant(legacy, 1, "capability-fixture-0002");

    const readRow = () =>
      db.json(`
        select json_build_object('revision', revision, 'binding', binding_fingerprint,
                                 'registry_version', registry_version, 'sha', definition_sha256,
                                 'definition', definition)::text
          from public.canonical_presentation_draft where study_id = ${q(STUDY)};
      `);
    const before = readRow();
    eq("the planted draft is at revision 2", before.revision, 2);
    check(
      !JSON.stringify(before.definition).includes("requiredContent"),
      "and the stored definition declares no capability at all",
    );

    /** The document with every `requiredContent` removed — the invariant. */
    const stripped = (definition) => {
      const copy = JSON.parse(serializeDeterministic(definition));
      for (const page of copy.pages) for (const block of page.blocks) delete block.requiredContent;
      return serializeDeterministic(copy);
    };
    const strippedBefore = stripped(before.definition);

    /**
     * The same projection WITHOUT the envelope, which is what the plan reports.
     *
     * `assessCapabilityUpgrade` projects the DECODED document, and a decoded
     * document has no `metadata` — that is envelope, stamped by the encoder.
     * Comparing the plan's digest against a projection that kept it would
     * compare two different things and could never agree. The envelope is not
     * thereby unchecked: [7] compares it field for field, subtitle included.
     */
    const strippedDocument = (definition) => {
      const copy = JSON.parse(stripped(definition));
      delete copy.metadata;
      return serializeDeterministic(copy);
    };

    /* -------------------------------------------------------------------- */
    console.log("\n[2] Editorial state exists BEFORE the upgrade, so it can be shown to survive it");

    const { recordQualitativeSignOff, loadPublicationReview, recordStoredJourneyPainDecision, loadJourneyPainEditor } =
      await import("../src/lib/studio/publication-workspace.ts");

    const painPanel = await loadJourneyPainEditor(client, scope);
    check(painPanel.ok === true, "the journey pain editor opens over the synthetic study");
    let decidedToken = null;
    if (painPanel.ok && painPanel.panel.items.length > 0 && painPanel.panel.choices.length > 0) {
      decidedToken = painPanel.panel.items[0].token;
      const decision = await recordStoredJourneyPainDecision(client, scope, ACTOR, {
        token: decidedToken,
        disposition: "approved",
        publicPhrase: painPanel.panel.items[0].curatedPhrase,
        touchpoints: [painPanel.panel.choices[0].handle],
        rationale: null,
      });
      check(decision.ok === true, "one journey decision is recorded before the upgrade");
    }

    const reviewBefore = await loadPublicationReview(client, {
      tenantId: TENANT,
      studyId: STUDY,
      studyName: scope.studyName,
    });
    check(reviewBefore.ok === true, "the publication review loads before the upgrade");
    if (reviewBefore.ok) {
      const signOff = await recordQualitativeSignOff(
        client,
        scope,
        ACTOR,
        reviewBefore.payload.draftRevision,
        reviewBefore.payload.qualitative.groups.map((group) => group.token),
      );
      check(signOff.ok === true, "a qualitative sign-off is recorded before the upgrade");
    }
    const signOffBefore = db.json(
      `select coalesce(json_agg(t order by t->>'evidence_digest'), '[]'::json)::text from (
         select to_jsonb(s) - 'id' as t from public.canonical_qualitative_signoff s) x;`,
    );
    const decisionsBefore = db.json(
      `select coalesce(json_agg(t order by t->>'item_key'), '[]'::json)::text from (
         select to_jsonb(d) - 'id' as t from public.canonical_journey_pain_decision d) x;`,
    );

    /* -------------------------------------------------------------------- */
    console.log("\n[3] The plan: what the upgrade says it would change");

    const built = await readAndBuild(client, scope);
    const stored = await readStoredDraftRow(client, scope);
    const plan = assessCapabilityUpgrade(built, stored.row, scope);
    check(plan.status === "ready", `an upgrade is available (${plan.status}${plan.status === "ready" ? "" : ` — ${plan.reason}`})`);
    if (plan.status !== "ready") throw new Error("the fixture did not produce an upgradeable draft");

    eq("it is planned over revision 2", plan.storedRevision, 2);
    eq("from the approved blueprint", plan.blueprintId, "cuicuilco-aprobado");
    eq(
      "and it names exactly the blocks the blueprint requires",
      plan.changes.map((c) => c.blockId).sort().join(","),
      [...requiredInBlueprint].sort().join(","),
    );
    check(
      plan.changes.every((c) => c.field === "requiredContent" && c.to === "true" && c.from === "(ausente)"),
      "every change is one absent `requiredContent` becoming true",
    );
    const planText = JSON.stringify(plan);
    check(!planText.includes(TENANT), "the plan names no tenant id");
    check(!planText.includes(STUDY), "and no study id");
    eq("the plan reports the binding it will not touch", plan.preserved.binding, before.binding);
    eq(
      "and the stripped digest of the stored document",
      plan.preserved.strippedDigest,
      sha(strippedDocument(before.definition)),
    );

    const described = await describeCapabilityUpgrade(client, scope);
    check(
      described.status === "ready" && JSON.stringify(described) === planText,
      "the description a screen would show is the same plan the write will use",
    );
    eq("and describing it wrote nothing", readRow().revision, 2);

    /* -------------------------------------------------------------------- */
    console.log("\n[4] Cross-tenant is refused, and nothing moves");

    const foreign = await upgradeStoredPresentationCapabilities(
      client,
      foreignScope,
      ACTOR,
      2,
      `capability-foreign-${randomUUID()}`,
    );
    check(foreign.ok === false, `another tenant is refused (${foreign.ok ? "accepted" : foreign.reason})`);
    eq("and the row is untouched", readRow().revision, 2);

    /* -------------------------------------------------------------------- */
    console.log("\n[5] A stale expected revision is refused, and nothing moves");

    const stale = await upgradeStoredPresentationCapabilities(
      client,
      scope,
      ACTOR,
      1,
      `capability-stale-${randomUUID()}`,
    );
    check(stale.ok === false && stale.reason === "conflict", `a stale revision is a conflict (${stale.ok ? "accepted" : stale.reason})`);
    check(stale.ok === false && stale.storedRevision === 2, "and the refusal says which revision is current");
    eq("the row is still at revision 2", readRow().revision, 2);

    /* -------------------------------------------------------------------- */
    console.log("\n[6] The upgrade: revision 2 becomes 3, exactly once");

    const KEY = `capability-r2-${randomUUID()}`;
    const first = await upgradeStoredPresentationCapabilities(client, scope, ACTOR, 2, KEY);
    check(first.ok === true, `the upgrade is accepted (${first.ok ? "ok" : first.reason})`);
    check(first.ok === true && first.revision === 3, `and the draft is at revision ${first.ok ? first.revision : "?"}`);
    // `created` means the draft ROW was created — migration 0029 writes
    // `draft_created` only for a study's first save — so it is correctly FALSE
    // here. What «exactly once» needs is that this was not a replay.
    check(first.ok === true && first.replayed === false, "it wrote rather than replayed");
    check(first.ok === true && first.created === false, "and it did not claim to have created the draft row");

    const after = readRow();
    eq("the row reads revision 3", after.revision, 3);

    /* -------------------------------------------------------------------- */
    console.log("\n[7] ONLY the classified capability metadata changed");

    eq("the binding is byte-identical", after.binding, before.binding);
    eq("the registry version is byte-identical", after.registry_version, before.registry_version);
    eq(
      "the document with `requiredContent` removed is byte-identical",
      stripped(after.definition),
      strippedBefore,
    );
    check(after.sha !== before.sha, "the stored digest moved, because the definition bytes did");

    const requiredAfter = after.definition.pages.flatMap((page) =>
      page.blocks.filter((block) => block.requiredContent === true).map((block) => block.id),
    );
    eq(
      "exactly the planned blocks now declare required content",
      [...requiredAfter].sort().join(","),
      [...requiredInBlueprint].sort().join(","),
    );
    eq("the subtitle survived the round trip", after.definition.metadata.subtitle, SUBTITLE);
    eq("the envelope still names the study", after.definition.metadata.studyId, STUDY);

    // REVERSIBILITY, EXECUTED: deleting exactly what was added reproduces the
    // revision-2 definition, metadata included.
    const reverted = JSON.parse(JSON.stringify(after.definition));
    for (const page of reverted.pages) {
      for (const block of page.blocks) {
        if (requiredInBlueprint.includes(block.id)) delete block.requiredContent;
      }
    }
    eq(
      "removing the added metadata reproduces the revision-2 definition exactly",
      serializeDeterministic(reverted),
      serializeDeterministic(before.definition),
    );

    /* -------------------------------------------------------------------- */
    console.log("\n[8] The same key replays, and does not make a revision 4");

    const replay = await upgradeStoredPresentationCapabilities(client, scope, ACTOR, 2, KEY);
    check(replay.ok === true, `the replay is accepted (${replay.ok ? "ok" : replay.reason})`);
    check(replay.ok === true && replay.revision === 3, "and answers with revision 3");
    check(replay.ok === true && replay.replayed === true, "marked as a replay rather than a new write");
    eq("the row is still at revision 3", readRow().revision, 3);

    // AND A SECOND ATTEMPT WITH A FRESH KEY IS «NOTHING TO DO», not a fourth
    // revision: the document now declares the capability.
    const again = await upgradeStoredPresentationCapabilities(client, scope, ACTOR, 3, `capability-again-${randomUUID()}`);
    check(again.ok === true, "a fresh attempt over the upgraded row is accepted");
    check(again.ok === true && again.revision === 3, "and answers with revision 3, having written nothing");
    eq("the row is still at revision 3", readRow().revision, 3);
    const nowPlan = assessCapabilityUpgrade(await readAndBuild(client, scope), (await readStoredDraftRow(client, scope)).row, scope);
    check(
      nowPlan.status === "not_needed" && nowPlan.reason === "already_current",
      `and the assessment now says there is nothing to do (${nowPlan.status})`,
    );

    /* -------------------------------------------------------------------- */
    console.log("\n[9] The editorial state survived, and no publication appeared");

    const signOffAfter = db.json(
      `select coalesce(json_agg(t order by t->>'evidence_digest'), '[]'::json)::text from (
         select to_jsonb(s) - 'id' as t from public.canonical_qualitative_signoff s) x;`,
    );
    const decisionsAfter = db.json(
      `select coalesce(json_agg(t order by t->>'item_key'), '[]'::json)::text from (
         select to_jsonb(d) - 'id' as t from public.canonical_journey_pain_decision d) x;`,
    );
    eq(
      "every qualitative sign-off row is byte-identical",
      JSON.stringify(signOffAfter),
      JSON.stringify(signOffBefore),
    );
    eq(
      "every journey decision row is byte-identical",
      JSON.stringify(decisionsAfter),
      JSON.stringify(decisionsBefore),
    );

    const reviewAfter = await loadPublicationReview(client, {
      tenantId: TENANT,
      studyId: STUDY,
      studyName: scope.studyName,
    });
    check(reviewAfter.ok === true, "the publication review still loads");
    if (reviewAfter.ok) {
      eq("it is now reviewing revision 3", reviewAfter.payload.draftRevision, 3);
      eq(
        "and the qualitative sign-off is still CURRENT — a capability upgrade does not stale it",
        reviewAfter.payload.qualitative.state,
        "current",
      );
    }
    if (decidedToken !== null) {
      const painAfter = await loadJourneyPainEditor(client, scope);
      check(
        painAfter.ok === true &&
          painAfter.panel.items.some((item) => item.token === decidedToken && item.state === "approved" && !item.stale),
        "the journey decision is still in force and not stale",
      );
    }

    for (const table of [
      "canonical_presentation_publication",
      "canonical_presentation_revision",
      "canonical_presentation_publication_event",
    ]) {
      const count = db.json(`select json_build_object('n', count(*))::text from public.${table};`);
      eq(`${table} is still empty`, Number(count.n), 0);
    }

    /* -------------------------------------------------------------------- */
    console.log("\n[10] The audit event, and the composer");

    const events = db.json(`
      select coalesce(json_agg(json_build_object('action', action, 'revision', revision, 'note', note)
                               order by occurred_at), '[]'::json)::text
        from public.canonical_presentation_draft_event where study_id = ${q(STUDY)};
    `);
    eq("the draft log holds one event per revision", events.length, 3);
    check(
      events[2].action === "draft_saved" && events[2].revision === 3,
      `the third is a draft_saved at revision ${events[2].revision}`,
    );
    check(
      typeof events[2].note === "string" && events[2].note.includes("requiredContent"),
      `and its note names what was declared — «${events[2].note}»`,
    );

    const reopened = await loadPresentationComposerWorkspace(client, scope, { restoreStoredDraft: true });
    check(reopened.ok === true, "the composer opens the upgraded draft");
  } finally {
    await stack.stop();
  }
});

console.log("\n" + "=".repeat(86));
console.log(`EXECUTED: ${executed}   PASSED: ${executed - failures}   FAILED: ${failures}   SKIPPED: ${skipped}`);
if (skipped > 0 && executed === 0) {
  console.log("RESULT: SKIPPED. A skipped gate is not a passed gate.");
  process.exit(2);
}
if (failures > 0) process.exit(1);
console.log(
  "RESULT: a document older than `requiredContent` declares it exactly once, on the blocks the\n" +
    "        server's own blueprint names; removing what was added reproduces the stored definition\n" +
    "        byte for byte; the binding, the authored content and the envelope's subtitle do not\n" +
    "        move; a stale revision and another tenant are refused; the key replays without a fourth\n" +
    "        revision; and the sign-off, the journey decision and the empty publication tables are\n" +
    "        exactly as they were. GATE PASSED.",
);
