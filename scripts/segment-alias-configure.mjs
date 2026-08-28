// =============================================================================
// Record that two wordings are one answer.
//
//   npx tsx scripts/segment-alias-configure.mjs --study <uuid> \
//     --key <segment> --canonical "<label>" --alias "<a>" --alias "<b>" [--confirm]
// =============================================================================
// The lexical fold in src/lib/calc/segments.ts merges spellings that differ
// only by case or whitespace. It deliberately does NOT merge different WORDS —
// that is an editorial judgement about the instruments the answers came from,
// and only a person who has read them can make it.
//
// This writes that judgement down, as data, on `segment_dimension.config`:
//
//   { "aliases": { "<canonical label>": ["<wording>", "<wording>"] } }
//
// The RESPONDENT ROWS ARE NOT TOUCHED. Grouping happens on the way out of the
// database, so the imported value still matches the source workbook exactly and
// the reconciliation stays valid. Remove the configuration and the next read
// simply separates the wordings again.
//
// It refuses to configure a wording nobody in the study actually used, because
// that is almost always a typo in the command rather than a decision.
// =============================================================================

import { createClient } from "@supabase/supabase-js";
import { foldSegmentValue, parseSegmentAliases, canonicalSegmentLabels } from "../src/lib/calc/segments.ts";

const argAll = (name) => {
  const out = [];
  process.argv.forEach((value, index) => {
    if (value === "--" + name && process.argv[index + 1]) out.push(process.argv[index + 1]);
  });
  return out;
};
const arg = (name) => argAll(name)[0] ?? null;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const studyId = arg("study");
const key = arg("key");
const canonical = arg("canonical");
const aliases = argAll("alias");
const confirm = process.argv.includes("--confirm");

if (!UUID.test(studyId ?? "") || !key || !canonical || aliases.length < 2) {
  console.error('Usage: --study <uuid> --key <segment> --canonical "<label>" --alias "<a>" --alias "<b>" [--confirm]');
  process.exit(2);
}
if (!/^[a-z][a-z0-9_]{0,63}$/.test(key)) {
  console.error("The segment key must match ^[a-z][a-z0-9_]{0,63}$");
  process.exit(2);
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const secret = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !secret) {
  console.error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set.");
  process.exit(2);
}
const admin = createClient(url, secret, { auth: { persistSession: false } });

const { data: study, error } = await admin
  .from("study").select("id, name, tenant_id").eq("id", studyId).maybeSingle();
if (error || !study) {
  console.error("Study not found: " + (error?.message ?? studyId));
  process.exit(1);
}

/** Keyset read, same completeness contract as src/lib/supabase/paginate.ts. */
const respondents = [];
let cursor = null;
for (let page = 0; page < 1000; page += 1) {
  let q = admin.from("respondent").select("id, segments").eq("study_id", studyId);
  if (cursor !== null) q = q.gt("id", cursor);
  const { data, error: readError } = await q.order("id", { ascending: true }).limit(1000);
  if (readError) { console.error("respondent: " + readError.message); process.exit(1); }
  respondents.push(...data);
  if (data.length < 1000) break;
  cursor = data[data.length - 1].id;
}

const present = new Map();
for (const r of respondents) {
  const value = r.segments?.[key];
  if (value == null || String(value).trim() === "") continue;
  const raw = String(value);
  present.set(raw, (present.get(raw) ?? 0) + 1);
}

console.log("=".repeat(70));
console.log("Segment alias configuration");
console.log("=".repeat(70));
console.log("study     " + study.name);
console.log("segment   " + key);
console.log("canonical " + JSON.stringify(canonical));
console.log("\nVALUES THIS STUDY ACTUALLY CARRIES for " + key);
for (const [value, n] of [...present.entries()].sort()) {
  const chosen = aliases.some((a) => foldSegmentValue(a) === foldSegmentValue(value));
  console.log("  " + (chosen ? "->" : "  ") + " " + JSON.stringify(value) + "  x" + n);
}

const missing = aliases.filter((a) => ![...present.keys()].some((v) => foldSegmentValue(v) === foldSegmentValue(a)));
if (missing.length > 0) {
  console.error("\nREFUSING: nobody in this study answered " + missing.map((m) => JSON.stringify(m)).join(", ") + ".");
  console.error("Check the wording against the list above; it is usually a typo in the command.");
  process.exit(1);
}

const config = { aliases: { [canonical]: aliases } };
const merged = parseSegmentAliases([{ key, config }]);
const before = canonicalSegmentLabels(respondents, {});
const after = canonicalSegmentLabels(respondents, merged);
const groupsBefore = new Set(before.get(key)?.values() ?? []).size;
const groupsAfter = new Set(after.get(key)?.values() ?? []).size;
console.log("\nEFFECT: " + groupsBefore + " groups become " + groupsAfter);
for (const [raw, label] of after.get(key) ?? []) {
  if (before.get(key)?.get(raw) !== label) console.log("  " + JSON.stringify(raw) + " now reads as " + JSON.stringify(label));
}

if (!confirm) {
  console.log("\nDRY RUN. Re-run with --confirm to store this configuration.");
  process.exit(0);
}

const { data: existing } = await admin
  .from("segment_dimension").select("id, config").eq("study_id", studyId).eq("key", key).maybeSingle();

const write = existing
  ? admin.from("segment_dimension").update({ config }).eq("id", existing.id).select("id")
  : admin.from("segment_dimension")
      .insert({ tenant_id: study.tenant_id, study_id: studyId, key, label: null, config })
      .select("id");
const { data: written, error: writeError } = await write;
if (writeError || !written?.length) {
  console.error("Write failed: " + (writeError?.message ?? "no row"));
  process.exit(1);
}

const { data: verify } = await admin
  .from("segment_dimension").select("key, config").eq("study_id", studyId);
const stored = parseSegmentAliases(verify ?? []);
const ok = aliases.every((a) => stored[key]?.[foldSegmentValue(a)] === canonical);
console.log("\nStored. Verified from the database: " + (ok ? "every wording maps to the canonical label." : "MISMATCH"));
process.exit(ok ? 0 : 1);
