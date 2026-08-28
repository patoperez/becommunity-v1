// =============================================================================
// Reconcile a real study against the workbooks it was imported from.
//
//   npx tsx scripts/real-study-verify.mjs --study <uuid> \
//     --workbook <path.xlsx> [--workbook <path.xlsx>] [--periods <path.xlsx>]
//     (needs NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY)
// =============================================================================
// READ-ONLY. This script never writes, and it is the check that must pass
// before a real study is published and after anything touches it.
//
// WHAT IT PROVES, and why each line is here:
//
//   COUNTS AND SUMS, PER METRIC KEY. A wrong number does not throw. The paging
//   defect that motivated this read a study's first 1 000 answers and showed a
//   mean over a third of the people, with no error anywhere. Comparing every
//   key's count AND its sum catches a missing row, a duplicated row and a
//   mistyped value; comparing only counts catches the first two.
//
//   SEGMENT VALUES. Same reasoning, for the characteristics people are grouped
//   and filtered by.
//
//   THE ARITHMETIC IS DONE HERE, not by the calculation engine. A check that
//   asks the engine whether the engine is right proves nothing. Counts and sums
//   are added up in this file from the workbook cells.
//
// WHAT IT NEVER PRINTS: a participant value, a quote, a name, or anything from
// `private_metadata`. Private fields are counted, never read.
//
// The workbook paths are arguments. Real study files live outside this
// repository and must stay there.
// =============================================================================

import { readFile } from "node:fs/promises";
import { createClient } from "@supabase/supabase-js";
import { readXlsx } from "../src/lib/ingestion/xlsx-reader.ts";
import {
  canonicalSegmentLabels,
  parseSegmentAliases,
  residualCollisions,
} from "../src/lib/calc/segments.ts";
import { arithmeticFindings, continuityFindings, canonicalPeriodPoints, describeFinding } from "../src/lib/calc/period-continuity.ts";
import { parseJourneyDefinition } from "../src/lib/calc/journey.ts";
import { stageIdFromLabel } from "../src/lib/studio/journey-picker.ts";

const argAll = (name) => {
  const out = [];
  process.argv.forEach((v, i) => { if (v === "--" + name && process.argv[i + 1]) out.push(process.argv[i + 1]); });
  return out;
};
const arg = (name) => argAll(name)[0] ?? null;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const studyId = arg("study");
const workbooks = argAll("workbook");
if (!UUID.test(studyId ?? "") || workbooks.length === 0) {
  console.error("Usage: --study <uuid> --workbook <path.xlsx> [--workbook <path.xlsx>]");
  process.exit(2);
}
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const secret = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !secret) {
  console.error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set.");
  process.exit(2);
}
const admin = createClient(url, secret, { auth: { persistSession: false } });

let problems = 0;
const ok = (m) => console.log("  ok    " + m);
const bad = (m) => { console.error("  WRONG " + m); problems += 1; };
const note = (m) => console.log("  note  " + m);
const check = (c, m) => (c ? ok(m) : bad(m));
const round = (x) => Math.round(x * 1e6) / 1e6;

/** Keyset read: the completeness contract of src/lib/supabase/paginate.ts. */
async function readAll(table, select, apply) {
  const rows = [];
  let cursor = null;
  for (let page = 0; page < 2000; page += 1) {
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

// ---- The source ------------------------------------------------------------
const source = { rows: 0, quant: new Map(), qual: 0, segments: new Map(), withPrivate: 0 };
for (const path of workbooks) {
  const buffer = await readFile(path);
  const parsed = await readXlsx(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength));
  for (const row of parsed.rows) {
    source.rows += 1;
    let hasPrivate = false;
    for (const [column, cell] of Object.entries(row)) {
      const value = String(cell ?? "").trim();
      if (value === "") continue;
      if (column.startsWith("priv_")) { hasPrivate = true; continue; }
      if (column.startsWith("q_")) {
        const number = Number(value);
        if (!Number.isFinite(number)) continue;
        const key = column.slice(2);
        const agg = source.quant.get(key) ?? { n: 0, sum: 0 };
        agg.n += 1;
        agg.sum += number;
        source.quant.set(key, agg);
      } else if (column.startsWith("qual_")) {
        source.qual += 1;
      } else if (column.startsWith("seg_")) {
        const key = column.slice(4);
        const values = source.segments.get(key) ?? new Map();
        values.set(value, (values.get(value) ?? 0) + 1);
        source.segments.set(key, values);
      }
    }
    if (hasPrivate) source.withPrivate += 1;
  }
}

// ---- The database ----------------------------------------------------------
const { data: study, error: studyError } = await admin
  .from("study").select("id, name, period, status, tenant_id, journey_definition").eq("id", studyId).maybeSingle();
if (studyError || !study) { console.error("Study not found: " + (studyError?.message ?? studyId)); process.exit(1); }
const { data: tenant } = await admin.from("tenant").select("name").eq("id", study.tenant_id).maybeSingle();

const respondents = await readAll("respondent", "id, segments, private_metadata", (q) => q.eq("study_id", studyId));
const quant = await readAll("quant_response", "id, respondent_id, metric_key, value", (q) => q.eq("study_id", studyId));
const qual = await readAll(
  "qual_observation",
  "id, review_status, quote_approved, reviewed_by, reviewed_at, confirmed_theme, suggested_theme, theme",
  (q) => q.eq("study_id", studyId),
);
const { data: dimensions } = await admin.from("segment_dimension").select("key, config").eq("study_id", studyId);

console.log("=".repeat(72));
console.log("Real-study reconciliation");
console.log("=".repeat(72));
console.log("study   " + study.name);
console.log("client  " + (tenant?.name ?? "?") + "   period " + (study.period ?? "-") + "   status " + study.status);
console.log("source  " + workbooks.length + " workbook(s)");

// ---- [1] Counts ------------------------------------------------------------
console.log("\n[1] Counts");
check(source.rows === respondents.length, "respondents: source " + source.rows + " = database " + respondents.length);
const sourceQuantTotal = [...source.quant.values()].reduce((a, b) => a + b.n, 0);
check(sourceQuantTotal === quant.length, "quantitative answers: source " + sourceQuantTotal + " = database " + quant.length);
check(source.qual === qual.length, "qualitative answers: source " + source.qual + " = database " + qual.length);
const dbKeys = new Set(quant.map((r) => r.metric_key));
check(source.quant.size === dbKeys.size, "distinct metric keys: source " + source.quant.size + " = database " + dbKeys.size);
const withPrivate = respondents.filter((r) => Object.keys(r.private_metadata ?? {}).length > 0).length;
check(source.withPrivate === withPrivate, "respondents carrying protected fields: source " + source.withPrivate + " = database " + withPrivate + " (counted, never read)");
note("respondents with at least one answer: " + new Set(quant.map((r) => r.respondent_id)).size);

// ---- [2] Every metric key, by count and by sum ------------------------------
console.log("\n[2] Every metric key, by count and by sum");
const dbAgg = new Map();
for (const r of quant) {
  const value = Number(r.value);
  const agg = dbAgg.get(r.metric_key) ?? { n: 0, sum: 0 };
  if (Number.isFinite(value)) { agg.n += 1; agg.sum += value; }
  dbAgg.set(r.metric_key, agg);
}
let keyProblems = 0;
for (const key of [...new Set([...source.quant.keys(), ...dbAgg.keys()])].sort()) {
  const a = source.quant.get(key) ?? { n: 0, sum: 0 };
  const b = dbAgg.get(key) ?? { n: 0, sum: 0 };
  if (a.n !== b.n || round(a.sum) !== round(b.sum)) {
    keyProblems += 1;
    bad(key + ": source n=" + a.n + " sum=" + round(a.sum) + " | database n=" + b.n + " sum=" + round(b.sum));
  }
}
check(keyProblems === 0, keyProblems === 0 ? "all " + source.quant.size + " metric keys reconcile exactly" : keyProblems + " key(s) differ");

// ---- [3] Segment values -----------------------------------------------------
console.log("\n[3] Segment values");
const dbSegments = new Map();
for (const r of respondents) {
  for (const [key, value] of Object.entries(r.segments ?? {})) {
    const text = String(value).trim();
    if (!text) continue;
    const values = dbSegments.get(key) ?? new Map();
    values.set(text, (values.get(text) ?? 0) + 1);
    dbSegments.set(key, values);
  }
}
let segmentProblems = 0;
for (const key of [...new Set([...source.segments.keys(), ...dbSegments.keys()])].sort()) {
  const a = source.segments.get(key) ?? new Map();
  const b = dbSegments.get(key) ?? new Map();
  for (const value of new Set([...a.keys(), ...b.keys()])) {
    if ((a.get(value) ?? 0) !== (b.get(value) ?? 0)) {
      segmentProblems += 1;
      bad(key + " " + JSON.stringify(value) + ": source " + (a.get(value) ?? 0) + " | database " + (b.get(value) ?? 0));
    }
  }
}
check(segmentProblems === 0, segmentProblems === 0 ? dbSegments.size + " segment keys reconcile exactly, value by value" : segmentProblems + " value(s) differ");

// ---- [4] How the study will read -------------------------------------------
console.log("\n[4] How the characteristics will read");
const aliases = parseSegmentAliases(dimensions ?? []);
const labels = canonicalSegmentLabels(respondents, aliases);
for (const [key, forKey] of [...labels.entries()].sort()) {
  const merged = new Map();
  for (const [raw, label] of forKey) if (raw !== label) merged.set(label, [...(merged.get(label) ?? []), raw]);
  for (const [label, raws] of merged) {
    note(key + ": " + raws.map((r) => JSON.stringify(r)).join(" + ") + " reads as " + JSON.stringify(label));
  }
}
const residual = residualCollisions(respondents, aliases);
if (residual.length === 0) {
  ok("no near-duplicate characteristic values are left unresolved");
} else {
  for (const finding of residual) {
    note("STILL SEPARATE " + finding.key + ": " + finding.values.map((v) => JSON.stringify(v)).join(" vs "));
  }
  note("Those differ by more than case or spacing. A person decides whether they are one answer.");
}

// ---- [5] The membership history --------------------------------------------
console.log("\n[5] The membership history");
const { data: latestImport } = await admin.from("period_series_import")
  .select("id, file_name, status").eq("study_id", studyId).eq("status", "committed")
  .order("committed_at", { ascending: false }).limit(1).maybeSingle();
if (!latestImport) {
  note("no committed membership history for this study");
} else {
  const { data: snapshots } = await admin.from("study_period_snapshot")
    .select("period_label, period_order, starting_members, new_members, ending_members, lost_members, retention_rate, churn_rate")
    .eq("import_id", latestImport.id).order("period_order").limit(240);
  const rows = (snapshots ?? []).map((r) => ({
    periodLabel: String(r.period_label), periodOrder: Number(r.period_order),
    startingMembers: Number(r.starting_members), newMembers: Number(r.new_members),
    endingMembers: Number(r.ending_members), lostMembers: Number(r.lost_members),
    retention: Number(r.retention_rate), churn: Number(r.churn_rate),
  }));
  const wrong = arithmeticFindings(rows);
  check(wrong.length === 0, wrong.length === 0
    ? rows.length + " period(s): every row adds up and every stored rate is the canonical one"
    : wrong.length + " period row(s) do not add up");
  for (const finding of wrong) bad(describeFinding(finding));

  const jumps = continuityFindings(rows);
  if (jumps.length === 0) {
    ok("the roster joins up from one period to the next");
  } else {
    for (const finding of jumps) note("OPEN QUESTION " + describeFinding(finding));
  }
  const shown = canonicalPeriodPoints(rows);
  note("as the client will see it: " + shown.map((p) => p.retention + "%").join("  "));
}

// ---- [6] The qualitative review --------------------------------------------
console.log("\n[6] The qualitative review");
const byStatus = {};
for (const o of qual) byStatus[o.review_status] = (byStatus[o.review_status] ?? 0) + 1;
note("review status: " + JSON.stringify(byStatus));
const approved = qual.filter((o) => o.quote_approved).length;
check(approved === 0 || byStatus.confirmed > 0, "approved quotes: " + approved);
const themes = new Map();
for (const o of qual) {
  const theme = o.confirmed_theme ?? o.suggested_theme ?? o.theme;
  if (theme) themes.set(theme, (themes.get(theme) ?? 0) + 1);
}
note("themes in play: " + [...themes.entries()].sort().map(([t, n]) => t + " x" + n).join(", "));
const stamps = new Map();
for (const o of qual) {
  if (o.review_status !== "confirmed") continue;
  const k = String(o.reviewed_by) + " @ " + String(o.reviewed_at);
  stamps.set(k, (stamps.get(k) ?? 0) + 1);
}
for (const [k, n] of stamps) {
  if (n >= 5) bad("PROVENANCE: " + n + " confirmations share one timestamp (" + k + ") — that is a bulk call, not " + n + " editorial decisions");
  else note("confirmed " + n + " at " + k);
}
const clientVisible = qual.filter((o) => o.review_status === "confirmed" && (o.confirmed_theme ?? "").trim() !== "").length;
note("findings a client would see if this study were published today: " + clientVisible);
note("quotes a client would see: " + qual.filter((o) => o.review_status === "confirmed" && o.quote_approved).length);

// ---- [7] The journey --------------------------------------------------------
console.log("\n[7] The journey");
const stages = parseJourneyDefinition(study.journey_definition);
const taken = new Set();
let stageProblems = 0;
for (const [index, stage] of stages.entries()) {
  const expected = stageIdFromLabel(stage.label, taken, index + 1);
  taken.add(expected);
  const hasMetric = dbKeys.has(stage.metric);
  if (!hasMetric) { stageProblems += 1; bad(stage.label + ": its metric " + stage.metric + " is not in this study's data"); }
  if (expected !== stage.id) {
    note("identifier " + stage.id + " does not read like " + JSON.stringify(stage.label) +
      " (stable after a rename; run scripts/journey-identifier-repair.mjs if it was never generated by Studio)");
  }
  ok(stage.id.padEnd(28) + stage.label + "  ->  " + stage.metric + (hasMetric ? "" : "  MISSING"));
}
check(stageProblems === 0, stageProblems === 0 ? "every stage measures something this study actually holds" : stageProblems + " stage(s) point at a metric that is not here");

// ---- Verdict ----------------------------------------------------------------
console.log("\n" + "=".repeat(72));
if (problems > 0) {
  console.error("RESULT: " + problems + " problem(s). This study does not reconcile with its source.");
  process.exit(1);
}
console.log("RESULT: the study reconciles with its source, exactly.");
console.log("Status is " + study.status + ". Publication is a separate, explicit decision.");
