// =============================================================================
// Fase 2 ingestion verification (run with: npx tsx scripts/ingest-test.ts)
// =============================================================================
// Exercises the REAL ingestion modules (parse -> adapter -> Zod -> persist)
// against the live database, covering:
//   - the good path (correct canonical mapping + counts)
//   - the malformed path (clear errors, NOTHING written)
//   - the missing-required-column path (§6.4 "falta la columna…")
// Requires .env.local with URL + SERVICE_ROLE + TEST_TENANT_A_ID.
//   node --env-file=.env.local node_modules/tsx/dist/cli.mjs scripts/ingest-test.ts
// =============================================================================

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { parseCsv } from "../src/lib/ingestion/parse";
import { wideSurveyAdapter } from "../src/lib/ingestion/adapters/wide-survey";
import { persistRespondents } from "../src/lib/ingestion/persist";
import { sourceSignature } from "../src/lib/ingestion/mapping";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const svc = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const tenantId = process.env.TEST_TENANT_A_ID!;
if (!url || !svc || !tenantId) {
  console.error("Missing env: NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / TEST_TENANT_A_ID");
  process.exit(2);
}

const admin = createClient(url, svc, { auth: { persistSession: false } });
let failures = 0;
const ok = (m: string) => console.log("  ✓", m);
const bad = (m: string) => { console.error("  ✗ FAIL:", m); failures++; };
const read = (f: string) => readFileSync(new URL(`../docs/samples/${f}`, import.meta.url), "utf8");

async function testGoodPath() {
  console.log("\n[1] Good file -> canonical mapping + persistence");
  const parsed = parseCsv(read("study_good.csv"));
  const result = wideSurveyAdapter.adapt(parsed, { requiredColumns: ["seg_nivel", "seg_grupo"], defaultSource: "encuesta" });
  if (!result.ok) { bad("adapter rejected a valid file: " + JSON.stringify(result.errors)); return; }

  const s = result.summary;
  s.respondents === 5 ? ok("5 respondents") : bad(`expected 5 respondents, got ${s.respondents}`);
  s.quant === 10 ? ok("10 quant_response rows") : bad(`expected 10 quant, got ${s.quant}`);
  s.qual === 4 ? ok("4 qual_observation rows (empty cell skipped)") : bad(`expected 4 qual, got ${s.qual}`);

  // Persist into a throwaway study, verify DB counts, then clean up.
  const { data: study, error } = await admin
    .from("study").insert({ tenant_id: tenantId, name: "INGEST_TEST_" + Date.now(), status: "draft" })
    .select("id").single();
  if (error) { bad("could not create test study: " + error.message); return; }

  try {
    await persistRespondents(admin, {
      tenantId,
      studyId: study.id,
      sourceSignature: await sourceSignature(parsed.headers),
      fileName: "study_good.csv",
      sourceRows: parsed.rows.length,
      respondents: result.respondents,
    });
    const counts = await Promise.all([
      admin.from("respondent").select("id", { count: "exact", head: true }).eq("study_id", study.id),
      admin.from("quant_response").select("id", { count: "exact", head: true }).eq("study_id", study.id),
      admin.from("qual_observation").select("id", { count: "exact", head: true }).eq("study_id", study.id),
    ]);
    const [r, q, ql] = counts.map((c) => c.count ?? -1);
    r === 5 ? ok(`DB: respondent=5`) : bad(`DB respondent=${r}`);
    q === 10 ? ok(`DB: quant_response=10`) : bad(`DB quant_response=${q}`);
    ql === 4 ? ok(`DB: qual_observation=4`) : bad(`DB qual_observation=${ql}`);

    // Spot-check canonical content: a known quant value and a segment.
    const sample = await admin.from("quant_response")
      .select("metric_key,value").eq("study_id", study.id).eq("metric_key", "nps").order("value");
    const npsValues = (sample.data ?? []).map((x) => Number(x.value)).sort((a, b) => a - b);
    JSON.stringify(npsValues) === JSON.stringify([6, 7, 8, 9, 10])
      ? ok("DB: nps values = [6,7,8,9,10]") : bad("nps values = " + JSON.stringify(npsValues));
  } finally {
    await admin.from("study").delete().eq("id", study.id); // cascade cleans children
    ok("cleaned up test study (cascade)");
  }
}

function testMalformed() {
  console.log("\n[2] Malformed file -> clear errors, no write");
  const parsed = parseCsv(read("study_bad.csv"));
  const result = wideSurveyAdapter.adapt(parsed, { defaultSource: "encuesta" });
  if (result.ok) { bad("adapter ACCEPTED a malformed file (should have errored)"); return; }
  const msgs = result.errors.map((e) => e.message).join(" | ");
  result.errors.length >= 2 ? ok(`${result.errors.length} validation errors reported`) : bad("too few errors");
  /nueve/.test(msgs) ? ok("flags non-numeric 'nueve' in q_nps") : bad("did not flag 'nueve'");
  /siete/.test(msgs) ? ok("flags non-numeric 'siete' in q_sat_maestros") : bad("did not flag 'siete'");
  result.errors.some((e) => e.row === 2 && e.column === "q_nps") ? ok("error pinpoints row 2 / q_nps") : bad("no row/column pinpoint");
}

function testMissingColumn() {
  console.log("\n[3] Missing required column -> 'falta la columna' (§6.4)");
  const parsed = parseCsv(read("study_bad.csv")); // has no seg_nivel
  const result = wideSurveyAdapter.adapt(parsed, { requiredColumns: ["seg_nivel"] });
  if (result.ok) { bad("missing required column was not caught"); return; }
  result.errors.some((e) => /Falta la columna obligatoria 'seg_nivel'/.test(e.message))
    ? ok("reports \"Falta la columna obligatoria 'seg_nivel'.\"") : bad("missing-column message absent");
}

async function main() {
  console.log("Be Community — Fase 2 ingestion test");
  await testGoodPath();
  testMalformed();
  testMissingColumn();
  console.log("\n" + "=".repeat(60));
  if (failures > 0) { console.error(`RESULT: ${failures} failure(s).`); process.exit(1); }
  console.log("RESULT: all ingestion checks passed.");
}

main().catch((e) => { console.error("Crashed:", e); process.exit(3); });
