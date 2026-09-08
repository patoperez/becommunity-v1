// =============================================================================
// UNIT 6B.3A — READ-ONLY HOSTED FINGERPRINT
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
// It also proves the ONE thing that would be a real failure of this unit:
// migration 0029 is applied to no project, so `canonical_presentation_draft`
// must NOT exist here.
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

console.log("Be Community — Unit 6B.3A: READ-ONLY hosted fingerprint");
console.log("=".repeat(78));
console.log(`  project: ${target.ref}`);
console.log("  every request below is a select; nothing is written.");

const evidence = process.env.BECOMMUNITY_QA_EVIDENCE ?? "/tmp/becommunity-qa-6b3a";
mkdirSync(evidence, { recursive: true });
const record = { ref: target.ref, readAt: new Date().toISOString(), drafts: [], counts: {}, absent: {} };

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
console.log("\n[3] Migration 0029 is applied to NO project, so its tables are absent here");

for (const table of ["canonical_presentation_draft", "canonical_presentation_draft_event"]) {
  const { error } = await client.from(table).select("study_id").limit(1);
  record.absent[table] = error?.code ?? "PRESENT";
  check(
    error !== null,
    `${table} does not exist on the hosted project${error ? ` (${error.code})` : " — IT EXISTS, WHICH MEANS 0029 WAS APPLIED"}`,
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
    "        0029's tables do not exist here, and every protected table was counted. Nothing was\n" +
    "        written.",
);
