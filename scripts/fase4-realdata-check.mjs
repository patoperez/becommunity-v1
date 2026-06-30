// Fase 4 real-data verification: runs the pivot engine over client A's actual
// RLS-scoped study data (the exact path the dashboard uses, minus React).
//   node --env-file=.env.local npx? -> use: npx tsx scripts/fase4-realdata-check.mjs
import { createClient } from "@supabase/supabase-js";
import { buildAllowlist, computePivot, validatePivotIntent } from "../src/lib/calc/pivot.ts";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const sb = createClient(url, anon, { auth: { persistSession: false } });

const { error: e } = await sb.auth.signInWithPassword({
  email: process.env.TEST_USER_A_EMAIL,
  password: process.env.TEST_USER_A_PASSWORD,
});
if (e) { console.error("sign-in failed:", e.message); process.exit(1); }

// Replicate loadStudyRows (RLS-scoped) inline.
async function loadRows(studyId) {
  const [{ data: resp }, { data: people }] = await Promise.all([
    sb.from("quant_response").select("respondent_id, metric_key, value").eq("study_id", studyId),
    sb.from("respondent").select("id, segments").eq("study_id", studyId),
  ]);
  const segById = new Map();
  const keys = new Set();
  for (const p of people ?? []) { segById.set(p.id, p.segments ?? {}); Object.keys(p.segments ?? {}).forEach((k) => keys.add(k)); }
  const allKeys = [...keys];
  return (resp ?? []).map((r) => {
    const segs = segById.get(r.respondent_id) ?? {};
    const row = { respondent_id: String(r.respondent_id), metric_key: String(r.metric_key), value: Number(r.value) };
    for (const k of allKeys) row[k] = segs[k] == null ? "" : String(segs[k]);
    return row;
  }).filter((r) => Number.isFinite(r.value));
}

const { data: studies } = await sb.from("study").select("id, name").order("created_at", { ascending: false });
console.log("Fase 4 — pivot over REAL RLS-scoped data (signed in as Tenant A)\n");

for (const study of studies ?? []) {
  const rows = await loadRows(study.id);
  if (rows.length === 0) { console.log(`• ${study.name}: (sin datos)\n`); continue; }
  const allow = buildAllowlist(rows);
  console.log(`• ${study.name}`);
  console.log("  dimensiones permitidas:", allow.dimensions.join(", "));
  console.log("  métricas permitidas:   ", allow.metrics.join(", "));

  // A representative live cross: rows=genero, columns=nivel (if present), avg first metric.
  const metric = allow.metrics.includes("sat_maestros") ? "sat_maestros" : allow.metrics[0];
  const colDim = allow.dimensions.includes("nivel") ? ["nivel"] : [];
  const intent = { rows: ["genero"], columns: colDim, values: [{ field: metric, agg: "avg" }] };
  const v = validatePivotIntent(intent, allow);
  console.log("  intent válido:", v.ok);
  const r = computePivot(rows, intent, allow);
  const cols = r.colCombos.map((c) => c.labels[0] || "(total)").join(" | ");
  console.log(`  cruce genero × ${colDim[0] ?? "(total)"} · avg ${metric}:  columnas = [${cols}]`);
  for (const b of r.body) {
    const cells = r.colCombos.map((c) => `${c.labels[0] || "·"}=${b.cells[`${c.key}|m0`]}`).join("  ");
    console.log(`     ${b.rowLabels[0] || "(sin dato)"}:  ${cells}`);
  }

  // Adversarial: a field NOT in the allowlist must be rejected before compute.
  const badIntent = { rows: ["ssn"], columns: [], values: [{ field: metric, agg: "avg" }] };
  console.log("  adversarial (rows:['ssn']) rejected:", !validatePivotIntent(badIntent, allow).ok);
  console.log();
}
console.log("Done.");
