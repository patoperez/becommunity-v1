// =============================================================================
// Return an automated qualitative confirmation to human review.
//
//   node --env-file-if-exists=.env.local scripts/qualitative-review-reset.mjs \
//     --study <uuid> --actor <uuid> --backup-dir <path outside the repo> [--confirm]
// =============================================================================
// WHY A SCRIPT AND NOT A BUTTON. Undoing a review decision is not an ordinary
// consultant workflow — Studio deliberately has no "unconfirm everything"
// control, because the review queue is meant to move forwards. This is a
// maintenance tool for the one situation the product cannot express: a run that
// confirmed observations WITHOUT a human editorial decision.
//
// It refuses to guess. Without --confirm it only reports what it found, and it
// prints the PROVENANCE first: who the database says reviewed the observations
// and when. Twenty-five confirmations sharing one microsecond are a single
// automated call, not twenty-five judgements, and that is the evidence this
// tool exists to act on.
//
// PRIVACY. It reads review-state columns only. No quote, no respondent id and
// no private metadata is read, printed or written to the backup.
// =============================================================================

import { writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { createClient } from "@supabase/supabase-js";

const arg = (name) => {
  const at = process.argv.indexOf("--" + name);
  return at === -1 ? null : process.argv[at + 1] ?? null;
};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const studyId = arg("study");
const actorId = arg("actor");
const backupDir = arg("backup-dir");
const reason = arg("reason") ?? "automated confirmation returned to human editorial review";
const confirm = process.argv.includes("--confirm");

if (!UUID.test(studyId ?? "") || !UUID.test(actorId ?? "")) {
  console.error("Usage: --study <uuid> --actor <uuid> --backup-dir <path> [--reason <text>] [--confirm]");
  process.exit(2);
}
if (confirm && !backupDir) {
  console.error("--backup-dir is required with --confirm: the previous review state must be recoverable.");
  process.exit(2);
}
if (backupDir && backupDir.includes("becommunity-software")) {
  console.error("Refusing to write a backup inside the repository. Choose a path outside it.");
  process.exit(2);
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set.");
  process.exit(2);
}
const admin = createClient(url, key, { auth: { persistSession: false } });

const REVIEW_COLUMNS = "id, review_status, confirmed_theme, confirmed_stage_key, quote_approved, reviewed_by, reviewed_at";

/** Keyset read: the same completeness contract as src/lib/supabase/paginate.ts. */
async function readAll(table, select, apply) {
  const rows = [];
  let cursor = null;
  for (let page = 0; page < 1000; page++) {
    let q = apply(admin.from(table).select(select));
    if (cursor !== null) q = q.gt("id", cursor);
    const { data, error } = await q.order("id", { ascending: true }).limit(1000);
    if (error) throw new Error(table + ": " + error.message);
    rows.push(...data);
    if (data.length < 1000) return rows;
    cursor = data[data.length - 1].id;
  }
  throw new Error(table + ": too many pages");
}

const { data: study, error: studyError } = await admin
  .from("study").select("id, name, status, tenant_id").eq("id", studyId).maybeSingle();
if (studyError || !study) {
  console.error("Study not found: " + (studyError?.message ?? studyId));
  process.exit(1);
}

const observations = await readAll("qual_observation", REVIEW_COLUMNS, (q) => q.eq("study_id", studyId));
const confirmed = observations.filter((row) => row.review_status === "confirmed");

console.log("=".repeat(70));
console.log("Qualitative review reset");
console.log("=".repeat(70));
console.log("study        " + study.name + " (" + study.id + ")");
console.log("study status " + study.status);
console.log("observations " + observations.length + " total, " + confirmed.length + " confirmed");

// ---- Provenance ------------------------------------------------------------
console.log("\nPROVENANCE of the confirmations (reviewer, review time, count)");
const groups = new Map();
for (const row of confirmed) {
  const k = String(row.reviewed_by) + " @ " + String(row.reviewed_at);
  groups.set(k, (groups.get(k) ?? 0) + 1);
}
for (const [k, n] of [...groups.entries()].sort()) {
  console.log("  " + n + " observation(s)  " + k);
}
console.log(
  "\n  A group of many observations sharing ONE timestamp to the microsecond is a\n" +
    "  single bulk call. A human review produces distinct times.",
);

if (confirmed.length === 0) {
  console.log("\nNothing is confirmed. Nothing to do.");
  process.exit(0);
}

if (!confirm) {
  console.log("\nDRY RUN. Re-run with --confirm to move these " + confirmed.length + " observation(s) to pending.");
  process.exit(0);
}

// ---- Backup ----------------------------------------------------------------
if (!existsSync(backupDir)) mkdirSync(backupDir, { recursive: true });
const stamp = new Date().toISOString().replaceAll(":", "-").replace(/\..+/, "");
const backupPath = join(backupDir, "qual-review-state-" + studyId + "-" + stamp + ".json");
writeFileSync(
  backupPath,
  JSON.stringify({ study_id: studyId, captured_at: new Date().toISOString(), observations: confirmed }, null, 2),
);
console.log("\nBackup of the previous review state: " + backupPath);
console.log("  (review-state columns only — no quote, no respondent, no private metadata)");

// ---- Reset -----------------------------------------------------------------
const { data: affected, error } = await admin.rpc("reset_qual_observation_review", {
  p_ids: confirmed.map((row) => row.id),
  p_study_id: studyId,
  p_actor: actorId,
  p_reason: reason,
});
if (error) {
  console.error("\nRESET FAILED: " + error.message);
  console.error("Nothing was changed: the function and its audit record share one transaction.");
  process.exit(1);
}
console.log("\nReset " + affected + " observation(s) to pending.");

// ---- Verify ----------------------------------------------------------------
const after = await readAll("qual_observation", REVIEW_COLUMNS, (q) => q.eq("study_id", studyId));
const byStatus = {};
for (const row of after) byStatus[row.review_status] = (byStatus[row.review_status] ?? 0) + 1;
const approvedQuotes = after.filter((row) => row.quote_approved).length;
const stillConfirmed = after.filter((row) => row.review_status === "confirmed").length;

console.log("\nAFTER");
console.log("  review_status   " + JSON.stringify(byStatus));
console.log("  approved quotes " + approvedQuotes);
console.log("  reviewer stamps " + after.filter((row) => row.reviewed_by !== null).length);

const { data: events } = await admin
  .from("admin_lifecycle_event")
  .select("occurred_at, action, subject_kind, details")
  .eq("subject_id", studyId).eq("action", "qualitative_review_reset")
  .order("occurred_at", { ascending: false }).limit(3);
console.log("  audit record    " + JSON.stringify(events ?? []));

if (stillConfirmed !== 0 || approvedQuotes !== 0) {
  console.error("\nUNEXPECTED STATE: something is still confirmed or approved.");
  process.exit(1);
}
console.log("\nEvery observation is back in the human review queue. Nothing is client-visible.");
