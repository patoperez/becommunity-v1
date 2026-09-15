// =============================================================================
// UNIT 6B.3A/6B.3B — READ-ONLY HOSTED FINGERPRINT
// =============================================================================
//   CANONICAL_HOSTED_TARGET_REF=<ref> \
//   CANONICAL_HOSTED_ACKNOWLEDGE=I-AUTHORIZE-MUTATION-OF-<ref> \
//   CANONICAL_HOSTED_SERVICE_KEY=<key> \
//   CANONICAL_HOSTED_DISPOSABLE_PREFIX=U4-RDONLY \
//     npm run test:canonical-presentation-hosted-fingerprint
//
// -----------------------------------------------------------------------------
// WHY A FINGERPRINT OF A PROJECT THIS UNIT NEVER TOUCHED
// -----------------------------------------------------------------------------
// Unit 6B.3A did all its work against disposable targets, so the honest
// expectation is that the hosted project is exactly as the previous unit left
// it. An expectation is not evidence. This reads the handful of facts that
// would move if anything had gone wrong — the two legacy experience drafts,
// the experience event log, and the counts of every protected table — and
// prints them beside what `docs/CURRENT_STATE.md` recorded at the end of Unit
// 6B.2.1, so a difference is visible rather than assumed.
//
// IT ALSO PINS WHAT UNIT 6B.3B PUT THERE. Until 2026-09-08 this section proved
// that `canonical_presentation_draft` did NOT exist, because migration 0029 was
// applied to no project. 6B.3B applied it and created Cuicuilco's first
// canonical draft, so the assertion is INVERTED rather than removed: the
// storage must exist, it must hold exactly one draft, that draft must be
// Cuicuilco's with the digest the encoder produced before the write, the event
// log must describe it, and no other study may have acquired one.
//
// IT IS AT REVISION 2 SINCE 2026-09-14, not 1. Unit 6B.4B2E rebound it: raising
// the results contract to `3.0.0` moved the binding digest, the composer
// refused to open the draft, and one explicit «Actualizar vínculo» recomputed
// the binding on the server. Only that field changed — the proof is that the
// old binding put back into the current definition reproduces the old digest —
// so the pinned pair moved and everything the pin exists to protect did not.
//
// AND WHAT UNIT 6B.4B1 PUT THERE, WITH THE OPPOSITE EMPHASIS. Until 2026-09-09
// §[3b] proved the three canonical PUBLICATION tables did not exist, because
// migration 0030 was applied to no project. 6B.4B1 applied it — and published
// nothing — so that assertion is inverted the same way, but into TWO claims
// rather than one: the storage must EXIST, and it must be EMPTY. Applying a
// migration and using it are different acts; this gate now fails if either the
// tables have gone or a publication has appeared.
//
// AND WHAT UNIT 6B.4B2D PUT THERE, THE SAME WAY AGAIN. Until 2026-09-14 §[3c]
// proved that the qualitative sign-off and journey-pain review storage did not
// exist, because `0031` and `0032` were applied to no project. 6B.4B2D applied
// both — and recorded no sign-off and no pain-item decision — so that section is
// inverted into the same two claims: the three tables must EXIST, and all three
// must be EMPTY. The emptiness is the half that matters: the storage was
// authorized, the editorial acts that fill it were not.
//
// -----------------------------------------------------------------------------
// IT WRITES NOTHING, AND THAT IS STRUCTURAL
// -----------------------------------------------------------------------------
// Every request below is a `select`. There is no `.insert(`, `.update(`,
// `.upsert(`, `.delete(` or `.rpc(` anywhere in this file, and an offline gate
// asserts that. The acknowledgement variable the shared guard demands is the
// gate to CONTACT a project at all; it is not a licence this script uses.
//
// PRIVACY. Counts, versions, revisions, timestamps and DIGESTS. A definition is
// hashed and never printed, and no respondent-level table is read at all.
// =============================================================================

import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { createClient } from "@supabase/supabase-js";

import { HostedTargetError, resolveHostedTarget } from "./lib/hosted-target.mjs";
// THE PRODUCT'S OWN SERIALIZATION AND DIGEST, so the reduction below is
// comparable with the digest the database holds. A second implementation of
// either would be a second answer, and the whole value of §[2c] is that its
// number is the same number `encodePresentationForStorage` computed.
import { serializeDeterministic } from "../src/lib/presentation/serialize.ts";
import { sha256Hex } from "../src/lib/ingestion/canonical-commit/sha256.ts";

/**
 * What the previous unit recorded, so this run compares rather than reports.
 * `docs/CURRENT_STATE.md`, end of Unit 6B.2 and Unit 6B.2.1.
 */
const EXPECTED = {
  drafts: [
    { schemaVersion: 2, revision: 72, note: "«La voz de las y los Nets de Cuicuilco» — legacy v2" },
    { schemaVersion: 3, revision: 14, note: "the P6E synthetic acceptance study — legacy v3" },
  ],
  experienceEvents: 86,
  /**
   * The definition digests, recorded by the first run of this script on
   * 2026-09-08 and compared by every run after it.
   *
   * A revision number moving is the loud way a legacy row changes. The quiet
   * way is a definition edited under the SAME revision — which no revision
   * check would catch, and which a digest catches exactly. The first run had
   * nothing to compare against and said so; from here the comparison is the
   * point of computing them.
   */
  definitionSha256: {
    "cd4d6acd-88b9-4804-829f-75b6d91a32b7": "9a08dacbc4d63c4e",
    "ad275928-dbd1-4acf-9de9-fa1623b32a60": "a1fe3298761e85c8",
  },
  /**
   * The canonical draft Unit 6B.3B created, on 2026-09-08.
   *
   * Every field is pinned, not merely counted. The digest in particular is the
   * one `encodePresentationForStorage` computed BEFORE the write and the
   * database has held unchanged since — the same reasoning that pins the two
   * legacy digests above, applied to the row this phase created.
   */
  canonicalDraft: {
    studyId: "cd4d6acd-88b9-4804-829f-75b6d91a32b7",
    /**
     * REVISION 2 SINCE 2026-09-14 — Unit 6B.4B2E's explicit rebind.
     *
     * It was 1, bound to `cf63bdca…` under results contract `2.2.0`. Raising
     * the contract to `3.0.0` moved the binding digest — the contract version
     * is one of its nine inputs — and the composer then refused to open the
     * draft at all. One explicit «Actualizar vínculo» recomputed the binding on
     * the server and saved revision 2.
     *
     * NOTHING AN AUTHOR WROTE MOVED WITH IT, and that is checked rather than
     * asserted: putting the OLD binding back into the CURRENT definition
     * reproduces `511d7f54…` exactly, so `binding` is the only field that
     * differs between the two revisions. The document is still the same one
     * page and twenty-four blocks, still `show_all`, still titled «La voz de
     * las y los Nets de Cuicuilco».
     */
    /**
     * REVISION 3 SINCE 2026-09-14 — Unit 6B.4B2H's explicit capability upgrade.
     *
     * It was 2. The document had been stored before `requiredContent` existed
     * and carried the key zero times, so the publication preflight read its
     * empty journey pain-cloud slot as the acknowledgeable warning
     * `configuration_required_blocks` where today's blueprint intends the
     * non-acknowledgeable blocker `required_content_missing`. One explicit
     * «Declarar contenido obligatorio» added that one boolean, on the one block
     * the server's own blueprint names, and saved revision 3.
     *
     * NOTHING ELSE MOVED, and it is checked rather than asserted: deleting
     * `$.pages[0].blocks[21].requiredContent` from the revision-3 definition
     * reproduces `78a34758…` — the revision-2 digest — exactly. The binding did
     * not move at all.
     */
    revision: 3,
    registryVersion: "1.0.0",
    binding: "e2ee45b43fe99102776d4617e12d9a7584d764ddd792199c0dbb96b08a25e2d2",
    definitionSha256: "5f1ec0349f81a155e97f52a4aeea5f555fb02e5054b6d8c1da084e3ff057f4da",
    /**
     * The revision-2 digest, and it is not merely history: §[2c] REPRODUCES it
     * by removing the field the upgrade added, which is what makes «only
     * capability metadata was added» a fact rather than a claim.
     */
    revisionTwoDefinitionSha256: "78a34758eca3b3d59349fd1dd09ae24114122a2d27575b9c35d852823b25a52d",
    /** The blocks the upgrade declared, by authored id. Exactly these. */
    requiredContentBlockIds: ["temas-recorrido"],
    samplePolicyMode: "show_all",
    pages: 1,
    blocks: 24,
    /** What it was before the rebind, kept so a regression can be recognised. */
    supersededBinding: "cf63bdca71e842fb0f6af50665348567a7b5a0f14f21b62683d2b0d0b5ca2037",
    supersededDefinitionSha256: "511d7f54f3ec0a391b45db259f64d57f9d415a9b2f5711c6f5fc551cdb67809d",
  },
  /**
   * THE EDITORIAL STATE UNIT 6B.4B2G TRANSCRIBED, pinned by SEMANTICS.
   *
   * Not «non-empty», and not a count. Every item key and every touchpoint handle
   * is written down, so a decision that changes target, a decision that
   * disappears, a sixteenth that appears, or a superseded row promoted back into
   * force all fail by name.
   *
   * THE PUBLIC PHRASES ARE DELIBERATELY NOT HERE. They are a real client's
   * curated prose and that never enters this repository — the same rule that
   * keeps the two workbooks out of it. Their PRESENCE is asserted instead: every
   * decision in force must carry a non-empty phrase.
   *
   * The keys and handles are opaque: `pp…` is derived from the study and the
   * source row, `journey-touchpoint:g1-t…` is a registry address. Neither is
   * prose and neither identifies a person.
   */
  editorial: {
    tenantId: "e63b2092-244e-4751-b7e9-19172a9f6b41",
    signOffDigest: "4ed838c49fba6f544fd239d1395fa691c6efc0979f80190af826749cb561ff0b",
    /** Rows the table holds in total, history included. */
    decisionRows: 20,
    /** Decisions IN FORCE — the latest per item key — and their targets. */
    inForce: [
      ["pp2ssjqwobsxile5vy", ["journey-touchpoint:g1-t26"]],
      ["pp3sfkielw4zxlmjwd", ["journey-touchpoint:g1-t27"]],
      ["pp43gtmir3nn2mxg5g", ["journey-touchpoint:g1-t12"]],
      ["pp75fioamajytmems4", ["journey-touchpoint:g1-t14"]],
      ["ppawbwjs65joodprei", ["journey-touchpoint:g1-t28"]],
      ["ppaywdrbs6yjocv3lh", ["journey-touchpoint:g1-t4"]],
      ["ppb423ot3a2jqzsi6t", ["journey-touchpoint:g1-t29"]],
      ["ppdfhnubzdv7g55owy", ["journey-touchpoint:g1-t7"]],
      ["ppio4yk7xkduiipmeq", ["journey-touchpoint:g1-t13"]],
      ["ppm6itaxols7bmvtpr", ["journey-touchpoint:g1-t25"]],
      ["ppqicj3qmgufjf2dta", ["journey-touchpoint:g1-t10"]],
      ["pprailpwvcpyflus3u", ["journey-touchpoint:g1-t8"]],
      ["pps3rorrpgkjyagxxi", ["journey-touchpoint:g1-t9"]],
      ["ppw7yj73tpjbqnwvgh", ["journey-touchpoint:g1-t2"]],
      ["ppzj7jj6gbertay53s", ["journey-touchpoint:g1-t1"]],
    ],
    /** Superseded rows, which must stay superseded and stay distinguishable. */
    supersededRows: 5,
    supersededDisposition: "unresolved",
  },
};

let failures = 0;
let executed = 0;
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

let target;
try {
  target = resolveHostedTarget(process.env);
} catch (thrown) {
  if (thrown instanceof HostedTargetError) {
    console.error(`REFUSED: ${thrown.message}`);
    process.exit(2);
  }
  throw thrown;
}

const client = createClient(target.apiOrigin, target.serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

console.log("Be Community — Units 6B.3A/6B.3B: READ-ONLY hosted fingerprint");
console.log("=".repeat(78));
console.log(`  project: ${target.ref}`);
console.log("  every request below is a select; nothing is written.");

const evidence = process.env.BECOMMUNITY_QA_EVIDENCE ?? "/tmp/becommunity-qa-6b3a";
mkdirSync(evidence, { recursive: true });
const record = {
  ref: target.ref,
  readAt: new Date().toISOString(),
  drafts: [],
  counts: {},
  present: {},
  canonicalDrafts: [],
  canonicalEvents: null,
  /** What the editorial tables hold — semantics, never a client's words. */
  editorial: {},
};

/* -------------------------------------------------------------------------- */
console.log("\n[1] The two legacy experience drafts");

const { data: drafts, error: draftError } = await client
  .from("study_experience_draft")
  .select("study_id, schema_version, revision, updated_at, definition")
  .order("revision", { ascending: false });

check(draftError === null, `the legacy draft table reads${draftError ? ` — ${draftError.code}` : ""}`);
if (drafts) {
  check(drafts.length === EXPECTED.drafts.length, `it holds ${EXPECTED.drafts.length} rows (${drafts.length})`);
  for (const row of drafts) {
    // THE DEFINITION IS HASHED, NEVER PRINTED. A digest proves the bytes did
    // not move; the bytes themselves are the firm's authoring work.
    const digest = createHash("sha256")
      .update(JSON.stringify(row.definition), "utf8")
      .digest("hex");
    record.drafts.push({
      studyId: row.study_id,
      schemaVersion: row.schema_version,
      revision: row.revision,
      updatedAt: row.updated_at,
      definitionSha256: digest,
    });
    const expected = EXPECTED.drafts.find((candidate) => candidate.schemaVersion === row.schema_version);
    check(
      expected !== undefined && expected.revision === row.revision,
      `a draft at schema version ${row.schema_version} is at revision ${row.revision}` +
        `${expected ? ` — expected ${expected.revision} (${expected.note})` : " — UNEXPECTED VERSION"}`,
    );
    // THE DIGEST IS COMPARED, not merely printed. A definition edited under the
    // same revision moves no number this script would otherwise read.
    const baseline = EXPECTED.definitionSha256[row.study_id];
    if (baseline === undefined) {
      console.log(`      study ${row.study_id}  definition sha-256 ${digest.slice(0, 16)}… (no baseline recorded)`);
    } else {
      check(
        digest.startsWith(baseline),
        `study ${row.study_id}: its definition still hashes to ${baseline}…` +
          `${digest.startsWith(baseline) ? "" : ` — IT IS NOW ${digest.slice(0, 16)}…, so the bytes moved`}`,
      );
    }
  }
  // NOT ONE OF THEM MAY BE VERSION FOUR. That is the failure this whole unit
  // was designed to make impossible, stated as a single assertion.
  check(
    drafts.every((row) => row.schema_version !== 4),
    "and NOT ONE of them is schema version 4 — no canonical document was written into a legacy row",
  );
}

/* -------------------------------------------------------------------------- */
console.log("\n[2] The experience log and the publication pointer");

for (const [table, expected] of [
  ["study_experience_event", EXPECTED.experienceEvents],
  ["study_experience_revision", null],
  ["study_experience_publication", null],
]) {
  const { count, error } = await client.from(table).select("*", { count: "exact", head: false }).limit(1);
  check(error === null, `${table} reads${error ? ` — ${error.code}` : ""}`);
  record.counts[table] = count ?? null;
  if (expected !== null) {
    check(count === expected, `${table} holds ${expected} rows (${count})`);
  } else {
    console.log(`      ${table}: ${count}`);
  }
}

/* -------------------------------------------------------------------------- */
console.log("\n[3] Migration 0029 IS applied here, and holds exactly one draft");

// THIS SECTION USED TO ASSERT THE OPPOSITE, AND WAS INVERTED RATHER THAN
// DELETED. While `0029` existed only in git, the finding worth catching was a
// table that had appeared. Unit 6B.3B applied it on 2026-09-08 and created
// Cuicuilco's first canonical draft, so the finding worth catching is now a
// table that has gone, a revision that has moved, or a second study that has
// quietly acquired a draft of its own. The direction changed; the job did not.
for (const table of ["canonical_presentation_draft", "canonical_presentation_draft_event"]) {
  const { error } = await client.from(table).select("study_id").limit(1);
  record.present[table] = error ? `absent (${error.code})` : "present";
  check(
    error === null,
    `${table} exists on the hosted project${error ? ` — IT IS GONE (${error.code}), WHICH MEANS 0029 WAS REVERSED` : ""}`,
  );
}

const { data: canonicalDrafts, error: canonicalError } = await client
  .from("canonical_presentation_draft")
  .select("study_id, tenant_id, document_kind, schema_version, registry_version, binding_fingerprint, revision, definition_sha256")
  .order("study_id", { ascending: true });

check(canonicalError === null, `the canonical draft table reads${canonicalError ? ` — ${canonicalError.code}` : ""}`);
if (canonicalDrafts) {
  record.canonicalDrafts = canonicalDrafts.map((row) => ({ ...row }));
  check(canonicalDrafts.length === 1, `it holds exactly one draft (${canonicalDrafts.length})`);
  const expected = EXPECTED.canonicalDraft;
  const row = canonicalDrafts.find((candidate) => candidate.study_id === expected.studyId);
  check(row !== undefined, `and it belongs to Cuicuilco (${expected.studyId})`);
  if (row) {
    check(row.revision === expected.revision, `at revision ${row.revision} — expected ${expected.revision}`);
    check(row.schema_version === 4, `schema version ${row.schema_version} — the canonical family`);
    check(row.document_kind === "canonical_presentation", `document kind ${row.document_kind}`);
    check(row.registry_version === expected.registryVersion, `registry build ${row.registry_version}`);
    check(row.binding_fingerprint === expected.binding, `bound to ${row.binding_fingerprint.slice(0, 16)}…`);
    // The column, compared. A definition edited under the same revision moves
    // no number this script would otherwise read — the same reasoning that put
    // a digest on the two legacy rows.
    check(
      row.definition_sha256 === expected.definitionSha256,
      `its definition still hashes to ${expected.definitionSha256.slice(0, 16)}…` +
        `${row.definition_sha256 === expected.definitionSha256 ? "" : ` — IT IS NOW ${row.definition_sha256.slice(0, 16)}…`}`,
    );
    // AND IT HAS NOT SLID BACK. A row carrying the pre-rebind binding again
    // would mean something restored an older revision over the current one,
    // which the checks above cannot distinguish from a fresh edit.
    check(
      row.binding_fingerprint !== expected.supersededBinding &&
        row.definition_sha256 !== expected.supersededDefinitionSha256,
      "and it is not the superseded revision-1 pair, so nothing rolled the rebind back",
    );
  }
  // NO STUDY BUT THIS ONE. A second canonical draft would mean something wrote
  // where this phase authorized nothing.
  const strangers = canonicalDrafts.filter((candidate) => candidate.study_id !== expected.studyId);
  check(strangers.length === 0, `no other study has acquired a canonical draft (${strangers.length})`);
}

/*
 * [2c] THE DEFINITION ITSELF — the capability it now declares, the policy it
 * still declares, and the revision it can still be reduced to.
 *
 * The column above is compared by DIGEST, which proves the bytes have not
 * moved; it cannot say WHAT those bytes are. This reads them.
 *
 * THE REVERSIBILITY CHECK IS THE POINT OF THIS SECTION. Unit 6B.4B2H added one
 * optional boolean to one block. Deleting exactly that field from the stored
 * definition has to reproduce `revisionTwoDefinitionSha256` — the digest the
 * database held before the upgrade. If it does, then nothing else changed,
 * and that is a fact about the bytes rather than a claim about the code that
 * wrote them. If it does not, something else moved with it.
 */
{
  const { data, error } = await client
    .from("canonical_presentation_draft")
    .select("definition")
    .eq("study_id", EXPECTED.canonicalDraft.studyId)
    .maybeSingle();
  check(error === null, `the stored definition reads${error ? ` — ${error.code}` : ""}`);
  const definition = data?.definition ?? null;
  check(definition !== null, "and it is there to read");
  if (definition) {
    const pages = Array.isArray(definition.pages) ? definition.pages : [];
    const blocks = pages.flatMap((page) => (Array.isArray(page.blocks) ? page.blocks : []));
    record.present.definitionPages = pages.length;
    record.present.definitionBlocks = blocks.length;

    check(pages.length === EXPECTED.canonicalDraft.pages, `it is ${pages.length} page, as composed`);
    check(blocks.length === EXPECTED.canonicalDraft.blocks, `and ${blocks.length} blocks, as composed`);

    // SAMPLE POLICY: show_all at the document, and NOT overridden anywhere. A
    // block-level policy is how automatic suppression would arrive, so both
    // halves are asserted rather than only the default.
    check(
      definition.samplePolicy?.mode === EXPECTED.canonicalDraft.samplePolicyMode,
      `the sample policy is «${definition.samplePolicy?.mode}» — expected «${EXPECTED.canonicalDraft.samplePolicyMode}»`,
    );
    check(
      blocks.every((block) => block.samplePolicy === null || block.samplePolicy === undefined),
      "and no block overrides it — no automatic small-sample suppression exists anywhere in the document",
    );

    // THE CAPABILITY, by block id, and exactly these.
    const declared = blocks.filter((block) => block.requiredContent === true).map((block) => block.id).sort();
    record.present.requiredContentBlockIds = declared;
    check(
      JSON.stringify(declared) === JSON.stringify([...EXPECTED.canonicalDraft.requiredContentBlockIds].sort()),
      `exactly ${JSON.stringify(EXPECTED.canonicalDraft.requiredContentBlockIds)} declare required content (${JSON.stringify(declared)})`,
    );
    check(
      blocks.every((block) => block.requiredContent === true || block.requiredContent === undefined),
      "and no block declares it FALSE — the upgrade added, it did not set",
    );

    // AND IT REDUCES TO REVISION 2. Deterministic serialization, the product's
    // own, so the digest is comparable with the one the database held.
    const reduced = JSON.parse(serializeDeterministic(definition));
    for (const page of reduced.pages) {
      for (const block of page.blocks) delete block.requiredContent;
    }
    const reducedDigest = sha256Hex(serializeDeterministic(reduced));
    check(
      reducedDigest === EXPECTED.canonicalDraft.revisionTwoDefinitionSha256,
      `removing the declared capability reproduces the revision-2 definition exactly (${reducedDigest.slice(0, 16)}…)` +
        `${reducedDigest === EXPECTED.canonicalDraft.revisionTwoDefinitionSha256 ? "" : ` — EXPECTED ${EXPECTED.canonicalDraft.revisionTwoDefinitionSha256.slice(0, 16)}…`}`,
    );
  }
}

const { data: canonicalEvents, error: canonicalEventError } = await client
  .from("canonical_presentation_draft_event")
  .select("study_id, action, revision, idempotency_key, occurred_at")
  .order("occurred_at", { ascending: true });

check(canonicalEventError === null, `the canonical draft event log reads${canonicalEventError ? ` — ${canonicalEventError.code}` : ""}`);
if (canonicalEvents) {
  record.canonicalEvents = canonicalEvents.length;
  // TWO SINCE 2026-09-14, and the second one is named rather than merely
  // counted. The rebind is a SAVE — it goes through the same RPC the composer
  // saves through — so it appends a `draft_saved`, and an event log that gained
  // anything else would mean a write nobody authorized.
  // THREE SINCE 2026-09-14, and each one is named rather than merely counted.
  // Both the rebind and the capability upgrade are SAVES — they go through the
  // same RPC the composer saves through — so each appends a `draft_saved`, and
  // an event log that gained anything else would mean a write nobody authorized.
  check(canonicalEvents.length === 3, `it holds exactly three events (${canonicalEvents.length})`);
  const [first, second, third] = canonicalEvents;
  if (first) {
    check(first.action === "draft_created", `the first is a ${first.action} at revision ${first.revision}`);
    check(first.revision === 1, `at revision 1 (${first.revision})`);
    check(first.study_id === EXPECTED.canonicalDraft.studyId, "for Cuicuilco and no one else");
  }
  if (second) {
    check(second.action === "draft_saved", `the second is a ${second.action} — Unit 6B.4B2E's rebind`);
    check(second.revision === 2, `at revision 2 (${second.revision})`);
    check(second.study_id === EXPECTED.canonicalDraft.studyId, "for Cuicuilco too, and no one else");
  }
  if (third) {
    check(
      third.action === "draft_saved",
      `the third is a ${third.action} — Unit 6B.4B2H's capability upgrade`,
    );
    check(third.revision === 3, `at revision 3 (${third.revision})`);
    check(third.study_id === EXPECTED.canonicalDraft.studyId, "for Cuicuilco too, and no one else");
    check(
      typeof third.idempotency_key === "string" && third.idempotency_key.startsWith("capability-r2-"),
      `and it carries the key that operation minted (${third.idempotency_key})`,
    );
  }
  check(
    canonicalEvents.every((e) => e.study_id === EXPECTED.canonicalDraft.studyId),
    "and no other study has a canonical draft event at all",
  );
}

/* -------------------------------------------------------------------------- */
/* -------------------------------------------------------------------------- */
console.log("\n[3b] Migration 0030 IS applied here, and its storage is EMPTY");

// THE SAME MIRROR, TURNED ROUND ON 2026-09-09 — INVERTED, NOT DELETED.
//
// It was written by Unit 6B.4A while the publication migration existed only in
// git, and it asserted the opposite: the three tables had to be ABSENT and the
// three functions uncallable, because the finding worth catching then was a
// table that had APPEARED. That check was never a formality — Unit 6B.4B1 ran
// it immediately after applying the migration and watched all six assertions
// fail, for exactly the right reason, which is the only way to learn that a
// check nobody has seen fail actually works.
//
// Unit 6B.4B1 applied `0030_canonical_publication.sql` on 2026-09-09, so the
// finding worth catching is now a publication table that has GONE — and,
// separately and just as importantly, one that has acquired a ROW. Applying the
// storage and using it are different acts: this phase authorized the first and
// forbade the second, so absence of the tables and presence of a publication
// are both failures, and this section asserts against both at once.
for (const table of [
  "canonical_presentation_revision",
  "canonical_presentation_publication",
  "canonical_presentation_publication_event",
]) {
  const { error } = await client.from(table).select("study_id").limit(1);
  record.present[table] = error ? `absent (${error.code})` : "present";
  check(
    error === null,
    `${table} exists on the hosted project${error ? ` — IT IS GONE (${error.code}), WHICH MEANS 0030 WAS REVERSED` : ""}`,
  );
}

// NO EXPERIENCE HAS BEEN PUBLISHED, AND THAT IS THE HALF THAT MATTERS MOST.
//
// The tables above are storage. A row in any of them means somebody published,
// restored or moved a pointer on the hosted project — none of which this line of
// work has authorized. There is no acceptable non-zero value here yet, so the
// expectation is a bare zero rather than a pinned count: when publishing IS
// authorized, this becomes a pinned version and pointer, in the same way §[3]
// pins the one canonical draft.
for (const [table, what] of [
  ["canonical_presentation_revision", "no immutable snapshot exists"],
  ["canonical_presentation_publication", "no study points at a current publication"],
  ["canonical_presentation_publication_event", "no publication or restoration was ever recorded"],
]) {
  const { count, error } = await client.from(table).select("*", { count: "exact", head: true });
  check(error === null, `${table} counts${error ? ` — ${error.code}` : ""}`);
  record.counts[table] = count ?? null;
  check(
    count === 0,
    `${what} (${count} rows)${count === 0 ? "" : " — SOMETHING PUBLISHED. Stop and investigate."}`,
  );
}
// THE FUNCTIONS ARE READ OUT OF THE API DESCRIPTION, NOT CALLED.
//
// The obvious probe is `client.rpc(name, {})` — an unmatched call never reaches
// a body, so it cannot write. It was written that way first, and an offline gate
// correctly failed it: this file's whole promise is that it contains no
// `.insert(`, `.upsert(`, `.delete(` or `.rpc(` at all, and that promise is
// worth more than the convenience of the probe. A rule that can be argued around
// once can be argued around again.
//
// PostgREST publishes its own OpenAPI document at the API root, and every
// function it exposes appears there as an `/rpc/<name>` path. Reading it is a
// GET, it is the same read the CLI uses to report a project's REST version, and
// it answers the same question without calling anything.
{
  const description = await fetch(target.restUrl, {
    headers: { apikey: target.serviceKey, Authorization: `Bearer ${target.serviceKey}` },
  });
  check(description.ok, `the API description reads (${description.status})`);
  const paths = description.ok ? Object.keys((await description.json())?.paths ?? {}) : [];
  check(paths.length > 0, `and lists ${paths.length} paths, so an absence below is not an empty answer`);
  // A CONTROL, so "not listed" is known to mean something: a function that IS
  // there must appear, or every assertion under this one passes vacuously.
  check(
    paths.includes("/rpc/save_canonical_presentation_draft"),
    "the canonical DRAFT save appears there, which is what makes the absences below meaningful",
  );
  // INVERTED WITH THE SECTION ABOVE, AND STILL NOT CALLED. Reading the
  // description proves the function is there; calling it would prove the same
  // thing and would be an invocation of a publication RPC, which is the one act
  // this line of work has not authorized. The reason for reading rather than
  // calling has not changed just because the expected answer has.
  for (const fn of ["publish_canonical_presentation", "restore_canonical_presentation", "read_canonical_publication"]) {
    const present = paths.includes(`/rpc/${fn}`);
    record.present[fn] = present ? "present" : "ABSENT";
    check(
      present,
      `${fn} is exposed by the hosted project${present ? "" : " — IT IS GONE, WHICH MEANS 0030 WAS REVERSED. Stop and investigate."}`,
    );
  }
}

/* -------------------------------------------------------------------------- */
console.log(
  "\n[3c] Migrations 0031 and 0032 are applied, and their storage holds EXACTLY" +
    " the editorial state Unit 6B.4B2G transcribed — pinned by semantics, not counts",
);

/*
 * INVERTED ON 2026-09-14, WHEN UNIT 6B.4B2D APPLIED `0031` AND `0032`.
 *
 * Until that day this section asserted the opposite — that neither migration's
 * storage existed — because neither had been applied anywhere. It was INVERTED
 * RATHER THAN DELETED, exactly as §[3] was on 2026-09-09: a target that has
 * LOST the storage is as much a finding as one that gained it unexpectedly, and
 * deleting the section would have left both directions unguarded.
 *
 * ⓘ THE OLD SECTION WAS RUN ONCE AGAINST THE APPLIED PROJECT BEFORE IT WAS
 * CHANGED, and it failed on exactly eight assertions — the three tables and the
 * five functions below — and on nothing else, while the other 57 in this file
 * still passed. That is the only moment a check nobody has seen fail can be
 * shown to work, and it is recorded in `docs/CURRENT_STATE.md` §"Unit 6B.4B2D".
 *
 * THE HALF THAT MATTERS MOST IS THE EMPTINESS, NOT THE EXISTENCE. Applying the
 * storage and writing an editorial decision into it are different acts; Unit
 * 6B.4B2D authorized the first and forbade the second. A non-zero count in any
 * of these three tables means a qualitative sign-off or a pain-item decision was
 * recorded that nobody has authorized, so each table is asserted EMPTY as well
 * as present.
 *
 * A CONTROL COMES FIRST. `pain_point` is a canonical table that IS there, read
 * through the same client, so a clean read below is known to mean presence
 * rather than a permissive client.
 */
{
  const control = await client.from("pain_point").select("id").limit(1);
  check(
    control.error === null,
    `a canonical table that IS there reads cleanly, so the reads below mean something${control.error ? ` — ${control.error.code}` : ""}`,
  );
}
for (const [table, migration] of [
  ["canonical_qualitative_signoff", "0031"],
  ["canonical_publication_qualitative_signoff", "0031"],
  ["canonical_journey_pain_decision", "0032"],
]) {
  const { count, error } = await client.from(table).select("*", { count: "exact", head: true });
  const present = error === null;
  record.present[table] = present ? `present (${count} rows)` : `ABSENT (${error.code})`;
  check(
    present,
    `${table} is present, so ${migration} is applied${present ? "" : " — IT IS GONE, WHICH MEANS THE MIGRATION WAS REVERSED. Stop and investigate."}`,
  );
}

/*
 * THE LINK TABLE IS STILL EMPTY, and it is the one of the three that should be.
 *
 * `canonical_publication_qualitative_signoff` records WHICH sign-off a
 * PUBLICATION was made under. Nothing has been published, so a row in it would
 * mean a publication exists that the five publication-table assertions in §[3b]
 * did not see — two independent readings of the same fact, which is why both
 * are kept.
 */
{
  const { count, error } = await client
    .from("canonical_publication_qualitative_signoff")
    .select("*", { count: "exact", head: true });
  check(
    error === null && count === 0,
    `canonical_publication_qualitative_signoff is EMPTY (${error ? error.code : count}) — nothing has been published under any sign-off`,
  );
}

/* ---- the qualitative sign-off: exactly one, for exactly this evidence ---- */
{
  const { data, error } = await client
    .from("canonical_qualitative_signoff")
    .select("study_id, tenant_id, evidence_digest, reviewed_at");
  check(error === null, `the sign-off table reads${error ? ` — ${error.code}` : ""}`);
  const rows = data ?? [];
  record.editorial.signOffRows = rows.length;
  check(rows.length === 1, `exactly ONE qualitative sign-off exists (${rows.length})`);
  if (rows.length === 1) {
    const row = rows[0];
    check(
      row.study_id === EXPECTED.canonicalDraft.studyId,
      `it belongs to Cuicuilco (${row.study_id === EXPECTED.canonicalDraft.studyId ? "yes" : row.study_id})`,
    );
    check(row.tenant_id === EXPECTED.editorial.tenantId, "and to its tenant");
    check(
      row.evidence_digest === EXPECTED.editorial.signOffDigest,
      `and it is against the CURRENT evidence digest (${row.evidence_digest.slice(0, 16)}…)`,
    );
    record.editorial.signOffDigest = row.evidence_digest;
    record.editorial.signOffAt = row.reviewed_at;
  }
}

/* ---- the journey decisions: fifteen, approved, and exactly these targets --- */
{
  const { data, error } = await client
    .from("canonical_journey_pain_decision")
    .select("study_id, tenant_id, item_key, disposition, public_phrase, touchpoints, decided_at");
  check(error === null, `the journey decision table reads${error ? ` — ${error.code}` : ""}`);
  const rows = data ?? [];
  record.editorial.decisionRows = rows.length;
  check(
    rows.length === EXPECTED.editorial.decisionRows,
    `the table holds ${EXPECTED.editorial.decisionRows} rows, history included (${rows.length})`,
  );
  check(
    rows.every((row) => row.study_id === EXPECTED.canonicalDraft.studyId),
    "every row belongs to Cuicuilco — no other study acquired a decision",
  );
  check(
    rows.every((row) => row.tenant_id === EXPECTED.editorial.tenantId),
    "and to its tenant",
  );

  /*
   * IN FORCE = THE LATEST PER ITEM KEY.
   *
   * The same rule migration 0032's `read_canonical_journey_pain_decisions`
   * applies, restated here rather than called: this file contains no `.rpc(`
   * at all — §[3] records why — and an unmatched call would still be a call.
   * The rule is one line and the raw rows are right here, so restating it
   * costs nothing and keeps the read-only property exact.
   */
  const inForce = new Map();
  for (const row of rows) {
    const held = inForce.get(row.item_key);
    if (!held || row.decided_at > held.decided_at) inForce.set(row.item_key, row);
  }
  record.editorial.inForce = inForce.size;

  check(inForce.size === EXPECTED.editorial.inForce.length, `${inForce.size} decisions are IN FORCE`);
  check(
    [...inForce.values()].every((row) => row.disposition === "approved"),
    `and every one is APPROVED (${[...new Set([...inForce.values()].map((r) => r.disposition))].join(", ")})`,
  );
  check(
    [...inForce.values()].filter((row) => row.disposition === "unresolved").length === 0,
    "ZERO are unresolved in force",
  );
  check(
    [...inForce.values()].every(
      (row) => typeof row.public_phrase === "string" && row.public_phrase.trim().length > 0,
    ),
    "every one carries a non-empty public phrase (its words are NOT recorded here)",
  );

  /*
   * ZERO UNDECIDED, measured against the SOURCE rather than assumed.
   *
   * The journey review's scope is the set of `pain_point` rows attached to a
   * journey stage. If that set is larger than the set of decisions in force,
   * somebody has an item nobody decided — which is precisely the state this
   * gate existed to detect before, inverted.
   */
  const { data: links } = await client.from("pain_point_journey_stage").select("pain_point_id");
  const journeyScoped = new Set((links ?? []).map((link) => link.pain_point_id)).size;
  record.editorial.journeyScopedPainRows = journeyScoped;
  check(
    journeyScoped === inForce.size,
    `ZERO undecided: the source has ${journeyScoped} journey pain rows and ${inForce.size} decisions in force`,
  );

  /* every target, by name, and every target well formed */
  const expectedMap = new Map(EXPECTED.editorial.inForce);
  for (const [key, targets] of expectedMap) {
    const row = inForce.get(key);
    check(row !== undefined, `${key} is in force`);
    if (!row) continue;
    check(
      JSON.stringify(row.touchpoints) === JSON.stringify(targets),
      `${key} targets exactly ${JSON.stringify(targets)}${
        JSON.stringify(row.touchpoints) === JSON.stringify(targets) ? "" : ` — IT TARGETS ${JSON.stringify(row.touchpoints)}`
      }`,
    );
  }
  const strangers = [...inForce.keys()].filter((key) => !expectedMap.has(key));
  check(strangers.length === 0, `no decision in force is outside the pinned set (${strangers.join(", ") || "none"})`);

  // LEGAL TARGETS: a handle of the journey-touchpoint family, at least one per
  // decision, none repeated inside a decision, and none shared between two —
  // the approved layout draws each touchpoint once.
  const HANDLE = /^journey-touchpoint:[a-z0-9-]+$/;
  check(
    [...inForce.values()].every(
      (row) =>
        Array.isArray(row.touchpoints) &&
        row.touchpoints.length >= 1 &&
        row.touchpoints.every((handle) => HANDLE.test(handle)) &&
        new Set(row.touchpoints).size === row.touchpoints.length,
    ),
    "every decision names at least one well-formed canonical touchpoint and repeats none",
  );
  const allTargets = [...inForce.values()].flatMap((row) => row.touchpoints);
  check(
    new Set(allTargets).size === allTargets.length,
    `and no touchpoint carries two decisions (${allTargets.length} targets, ${new Set(allTargets).size} distinct)`,
  );

  /* the superseded rows stay superseded, and stay attributable */
  const superseded = rows.filter((row) => inForce.get(row.item_key).decided_at !== row.decided_at);
  record.editorial.superseded = superseded.length;
  check(
    superseded.length === EXPECTED.editorial.supersededRows,
    `${superseded.length} rows are historical, superseded by a later decision on the same item`,
  );
  check(
    superseded.every((row) => row.disposition === EXPECTED.editorial.supersededDisposition),
    `and every one of them is «${EXPECTED.editorial.supersededDisposition}» — the exploratory records 6B.4B2G superseded`,
  );
  check(
    superseded.every((row) => row.decided_at < inForce.get(row.item_key).decided_at),
    "each is strictly older than the decision that replaced it, so history is distinguishable from force",
  );
  check(
    superseded.every((row) => expectedMap.has(row.item_key)),
    "and every superseded row belongs to an item that IS decided now",
  );
}

/*
 * AND BOTH MIGRATIONS' FUNCTIONS ARE EXPOSED.
 *
 * A table can be dropped and leave a function behind, and a function is the
 * thing that could actually write — so the two are asserted separately. Read
 * out of the API description, NEVER CALLED, for the reason §[3] records: this
 * file contains no `.insert(`, `.upsert(`, `.delete(` or `.rpc(` at all, and an
 * unmatched call would still be a call. That reason has not changed just
 * because the expected answer has — calling `record_canonical_qualitative_signoff`
 * to prove it exists would be the exact editorial act this unit forbade.
 */
{
  const description = await fetch(target.restUrl, {
    headers: { apikey: target.serviceKey, Authorization: `Bearer ${target.serviceKey}` },
  });
  check(description.ok, `the API description reads again (${description.status})`);
  const paths = description.ok ? Object.keys((await description.json())?.paths ?? {}) : [];
  check(
    paths.includes("/rpc/save_canonical_presentation_draft"),
    "and still lists a function that IS there, so the readings below are not an empty answer",
  );
  for (const fn of [
    "record_canonical_qualitative_signoff",
    "publish_canonical_presentation_with_qualitative",
    "read_canonical_qualitative_signoffs",
    "record_canonical_journey_pain_decision",
    "read_canonical_journey_pain_decisions",
  ]) {
    const present = paths.includes(`/rpc/${fn}`);
    record.present[fn] = present ? "present" : "ABSENT";
    check(
      present,
      `${fn} is exposed${present ? "" : " — IT IS GONE, WHICH MEANS THE MIGRATION WAS REVERSED. Stop and investigate."}`,
    );
  }
  // AND THE 0030 PUBLISH FUNCTION IS STILL THERE BESIDE ITS WRAPPER. `0031`
  // adds `publish_canonical_presentation_with_qualitative`; it does not replace
  // `publish_canonical_presentation`, and a project where the wrapper appeared
  // and the original vanished would be a different, and worse, database.
  check(
    paths.includes("/rpc/publish_canonical_presentation"),
    "and the 0030 publish function still exists BESIDE the 0031 wrapper, not replaced by it",
  );
}

/* -------------------------------------------------------------------------- */
console.log("\n[4] The canonical and legacy row counts");

const COUNTED = [
  "study", "respondent", "quant_response", "qual_observation",
  "study_participant", "survey_response", "performance_observation",
  "metric_definition", "pain_point", "import_job", "import_job_record",
];
for (const table of COUNTED) {
  const { count, error } = await client.from(table).select("*", { count: "exact", head: false }).limit(1);
  if (error) {
    record.counts[table] = `ERROR ${error.code}`;
    check(false, `${table} could not be counted (${error.code}) — an unreported hole is worse than a named gap`);
  } else {
    record.counts[table] = count;
    console.log(`      ${table}: ${count}`);
    executed += 1;
  }
}

/* -------------------------------------------------------------------------- */

const path = join(evidence, `hosted-fingerprint-${record.readAt.replace(/[:.]/g, "-")}.json`);
writeFileSync(path, `${JSON.stringify(record, null, 2)}\n`, "utf8");
console.log(`\n  fingerprint written to ${path}`);

console.log(`\n${"=".repeat(78)}`);
console.log(`EXECUTED: ${executed}   PASSED: ${executed - failures}   FAILED: ${failures}`);
if (failures > 0) {
  console.log("RESULT: the hosted project is NOT as the previous unit left it. STOP AND INVESTIGATE.");
  process.exit(1);
}
console.log(
  "RESULT: both legacy experience drafts are at the versions and revisions the previous unit\n" +
    "        recorded, neither is schema version 4, the experience log is unchanged, migration\n" +
    "        0029's storage exists and holds exactly ONE canonical draft — Cuicuilco's, at\n" +
    "        revision 3 after the explicit rebind and the explicit capability upgrade, under a\n" +
    "        draft_created and two draft_saved and nothing else — no other study has acquired\n" +
    "        one; its definition is one page of 24 blocks, its sample policy is show_all and no\n" +
    "        block overrides it, exactly the pinned block declares requiredContent, and removing\n" +
    "        that one field reproduces the revision-2 digest exactly, so nothing else moved with\n" +
    "        it; migration 0030's storage exists and is EMPTY in all three tables so no\n" +
    "        experience has been published; migrations 0031 and 0032 are applied and hold\n" +
    "        EXACTLY the editorial state Unit 6B.4B2G transcribed — ONE qualitative sign-off\n" +
    "        against the current evidence digest, FIFTEEN journey decisions in force, every one\n" +
    "        approved, every one carrying a public phrase and targeting exactly the pinned\n" +
    "        canonical touchpoint, ZERO unresolved, ZERO undecided against the source's own\n" +
    "        fifteen journey pain rows, and five older rows still superseded and still\n" +
    "        distinguishable from the decisions in force; the 0030 publish function still stands\n" +
    "        beside its 0031 wrapper, and every protected table was counted. Nothing was\n" +
    "        written, and no client's words were read into this record.",
);
