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
// Cuicuilco's at revision 1 with the digest the encoder produced before the
// write, exactly one `draft_created` event must describe it, and no other study
// may have acquired one.
//
// AND WHAT UNIT 6B.4B1 PUT THERE, WITH THE OPPOSITE EMPHASIS. Until 2026-09-09
// §[3b] proved the three canonical PUBLICATION tables did not exist, because
// migration 0030 was applied to no project. 6B.4B1 applied it — and published
// nothing — so that assertion is inverted the same way, but into TWO claims
// rather than one: the storage must EXIST, and it must be EMPTY. Applying a
// migration and using it are different acts; this gate now fails if either the
// tables have gone or a publication has appeared.
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
    revision: 1,
    registryVersion: "1.0.0",
    binding: "cf63bdca71e842fb0f6af50665348567a7b5a0f14f21b62683d2b0d0b5ca2037",
    definitionSha256: "511d7f54f3ec0a391b45db259f64d57f9d415a9b2f5711c6f5fc551cdb67809d",
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
const record = { ref: target.ref, readAt: new Date().toISOString(), drafts: [], counts: {}, present: {},
                 canonicalDrafts: [], canonicalEvents: null };

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
  }
  // NO STUDY BUT THIS ONE. A second canonical draft would mean something wrote
  // where this phase authorized nothing.
  const strangers = canonicalDrafts.filter((candidate) => candidate.study_id !== expected.studyId);
  check(strangers.length === 0, `no other study has acquired a canonical draft (${strangers.length})`);
}

const { data: canonicalEvents, error: canonicalEventError } = await client
  .from("canonical_presentation_draft_event")
  .select("study_id, action, revision, idempotency_key, occurred_at")
  .order("occurred_at", { ascending: true });

check(canonicalEventError === null, `the canonical draft event log reads${canonicalEventError ? ` — ${canonicalEventError.code}` : ""}`);
if (canonicalEvents) {
  record.canonicalEvents = canonicalEvents.length;
  check(canonicalEvents.length === 1, `it holds exactly one event (${canonicalEvents.length})`);
  const first = canonicalEvents[0];
  if (first) {
    check(first.action === "draft_created", `and it is a ${first.action} at revision ${first.revision}`);
    check(first.revision === 1, `the first and only revision (${first.revision})`);
    check(first.study_id === EXPECTED.canonicalDraft.studyId, "for Cuicuilco and no one else");
  }
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
console.log("\n[3b] Migrations 0031 and 0032 are NOT applied there, and their storage is absent");

/*
 * THE MIRROR THE OTHER WAY ROUND, AND IT IS THE ONE THIS UNIT NEEDS.
 *
 * §[3] above asserts that 0030's storage EXISTS, because it was applied. `0031`
 * (the qualitative sign-off) and `0032` (the journey pain review) are authored
 * and applied to NO project, so the finding worth catching here is a table that
 * has APPEARED — which would mean somebody applied a migration this line of
 * work has not authorized.
 *
 * WHEN EITHER IS APPLIED, THIS SECTION IS INVERTED RATHER THAN DELETED, exactly
 * as §[3] was on 2026-09-09: a target that has LOST the storage is as much a
 * finding as one that gained it unexpectedly, and the only moment a check
 * nobody has seen fail can be shown to work is immediately after the change
 * that flips it.
 *
 * A CONTROL COMES FIRST. `pain_point` is a canonical table that IS there, read
 * through the same client, so «not found» below is known to mean absence rather
 * than a broken read.
 */
{
  const control = await client.from("pain_point").select("id").limit(1);
  check(
    control.error === null,
    `a canonical table that IS there reads cleanly, so an absence below means something${control.error ? ` — ${control.error.code}` : ""}`,
  );
}
for (const [table, migration] of [
  ["canonical_qualitative_signoff", "0031"],
  ["canonical_publication_qualitative_signoff", "0031"],
  ["canonical_journey_pain_decision", "0032"],
]) {
  const { error } = await client.from(table).select("study_id").limit(1);
  const absent = error !== null;
  record.present[table] = absent ? `absent (${error.code})` : "PRESENT";
  check(
    absent,
    `${table} is absent, so ${migration} is not applied${absent ? "" : " — IT IS THERE. A migration was applied that this unit did not authorize. Stop and investigate."}`,
  );
}

/*
 * AND NEITHER MIGRATION'S FUNCTIONS ARE EXPOSED.
 *
 * A table can be dropped and leave a function behind, and a function is the
 * thing that could actually write — so the two are asserted separately. Read
 * out of the API description, never called, for the reason §[3] records: this
 * file contains no `.insert(`, `.upsert(`, `.delete(` or `.rpc(` at all, and an
 * unmatched call would still be a call.
 */
{
  const description = await fetch(target.restUrl, {
    headers: { apikey: target.serviceKey, Authorization: `Bearer ${target.serviceKey}` },
  });
  check(description.ok, `the API description reads again (${description.status})`);
  const paths = description.ok ? Object.keys((await description.json())?.paths ?? {}) : [];
  check(
    paths.includes("/rpc/save_canonical_presentation_draft"),
    "and still lists a function that IS there, so the absences below are not an empty answer",
  );
  for (const fn of [
    "record_canonical_qualitative_signoff",
    "publish_canonical_presentation_with_qualitative",
    "read_canonical_qualitative_signoffs",
    "record_canonical_journey_pain_decision",
    "read_canonical_journey_pain_decisions",
  ]) {
    const present = paths.includes(`/rpc/${fn}`);
    record.present[fn] = present ? "PRESENT" : "absent";
    check(
      !present,
      `${fn} is not exposed${present ? " — IT IS THERE. Stop and investigate." : ""}`,
    );
  }
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
    "        revision 1, under one draft_created event — no other study has acquired one,\n" +
    "        migration 0030's storage exists and is EMPTY in all three tables so no experience\n" +
    "        has been published, and every protected table was counted. Nothing was written.",
);
