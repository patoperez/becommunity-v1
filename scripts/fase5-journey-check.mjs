// Fase 5 verification: the data-connected journey, headless. Signs in as Tenant A
// (RLS-scoped), reads the study's journey_definition, and computes each stage's
// metric with the engine — i.e. exactly what the hover read-out shows.
//   npx tsx scripts/fase5-journey-check.mjs   (with --env-file=.env.local)
import { createClient } from "@supabase/supabase-js";
import { parseJourneyDefinition } from "../src/lib/calc/journey.ts";
import { computeStageMetric } from "../src/lib/calc/engine.ts";

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
  auth: { persistSession: false },
});
const { error } = await sb.auth.signInWithPassword({
  email: process.env.TEST_USER_A_EMAIL,
  password: process.env.TEST_USER_A_PASSWORD,
});
if (error) { console.error("sign-in failed:", error.message); process.exit(1); }

async function loadRows(studyId) {
  const [{ data: resp }, { data: people }] = await Promise.all([
    sb.from("quant_response").select("respondent_id, metric_key, value").eq("study_id", studyId),
    sb.from("respondent").select("id, segments").eq("study_id", studyId),
  ]);
  const segById = new Map((people ?? []).map((p) => [p.id, p.segments ?? {}]));
  const keys = new Set();
  for (const p of people ?? []) Object.keys(p.segments ?? {}).forEach((k) => keys.add(k));
  return (resp ?? []).map((r) => {
    const row = { respondent_id: String(r.respondent_id), metric_key: String(r.metric_key), value: Number(r.value) };
    const segs = segById.get(r.respondent_id) ?? {};
    for (const k of keys) row[k] = segs[k] == null ? "" : String(segs[k]);
    return row;
  }).filter((r) => Number.isFinite(r.value));
}

const { data: study } = await sb
  .from("study").select("id, name, journey_definition").eq("name", "Journey Demo 2026").single();
if (!study) { console.error("Journey Demo 2026 not found — run seed-journey-demo.mjs"); process.exit(1); }

const stages = parseJourneyDefinition(study.journey_definition);
const rows = await loadRows(study.id);

console.log(`Fase 5 — data-connected journey for "${study.name}" (RLS-scoped as Tenant A)`);
console.log(`Stages parsed from journey_definition: ${stages.length}\n`);

let failures = 0;
for (const s of stages) {
  const m = computeStageMetric(rows, s.metric);
  const head = m.value == null ? "—" : m.unit === "nps" ? String(m.value) : m.value.toFixed(2);
  const detail = m.detail.map((d) => `${d.label}=${d.value}`).join(", ");
  console.log(`  ${s.label.padEnd(14)} [${s.metric.padEnd(16)}] ${m.kind.toUpperCase().padEnd(8)} ${head.padStart(6)}  (n=${m.n})  ${detail}`);
  if (m.value == null || m.n === 0) { console.error(`     ✗ stage '${s.id}' has no data`); failures++; }
}

// Spot-check two known values:
//   nps_admision [9,8,10,6,9,7,10,9]: prom(>=9)=5, detr(<=6)=1, n=8 -> (5-1)/8*100 = 50
//   sat_informes [8,7,9,6,8,7,9,8]: mean = 62/8 = 7.75
const nps = computeStageMetric(rows, "nps_admision");
const sat = computeStageMetric(rows, "sat_informes");
console.log("\nSpot-checks vs hand-computed:");
nps.value === 50 ? console.log("  ✓ NPS admisión = 50") : (console.error(`  ✗ NPS admisión = ${nps.value} (expected 50)`), failures++);
Math.abs((sat.value ?? 0) - 7.75) < 1e-9 ? console.log("  ✓ avg sat_informes = 7.75") : (console.error(`  ✗ sat_informes = ${sat.value} (expected 7.75)`), failures++);

console.log("\n" + "=".repeat(60));
if (failures) { console.error(`RESULT: ${failures} problem(s).`); process.exit(1); }
console.log("RESULT: every stage is data-connected and values match. OK.");
