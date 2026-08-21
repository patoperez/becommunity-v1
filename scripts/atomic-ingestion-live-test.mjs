// P2B live adversarial gate. Run only after migration 0003 is applied:
// node --env-file=.env.local scripts/atomic-ingestion-live-test.mjs

import { createClient } from "@supabase/supabase-js";
import { persistRespondents, rollbackImportBatch } from "../src/lib/ingestion/persist.ts";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const secret = process.env.SUPABASE_SERVICE_ROLE_KEY;
const tenantId = process.env.TEST_TENANT_A_ID;
if (!url || !secret || !tenantId) {
  console.error("Missing environment for P2B live gate.");
  process.exit(2);
}

const admin = createClient(url, secret, { auth: { autoRefreshToken: false, persistSession: false } });
let failures = 0;
const ok = (message) => console.log("  ✓", message);
const bad = (message) => { console.error("  ✗ FAIL:", message); failures++; };
const eq = (label, actual, expected) => Object.is(actual, expected)
  ? ok(`${label} = ${String(expected)}`)
  : bad(`${label}: expected ${String(expected)}, got ${String(actual)}`);

const signature = `sha256:${"b".repeat(64)}`;
const studyName = `P2B_ATOMIC_TEST_${Date.now()}`;
const { data: study, error: studyError } = await admin
  .from("study")
  .insert({ tenant_id: tenantId, name: studyName, status: "draft" })
  .select("id")
  .single();
if (studyError || !study) {
  console.error(`Could not create test study: ${studyError?.message ?? "unknown error"}`);
  process.exit(3);
}

try {
  console.log("Be Community — P2B live atomic-ingestion gate");

  console.log("\n[1] Invalid payload leaves zero response rows");
  const { data: badBatch, error: stageError } = await admin
    .from("import_batch")
    .insert({
      tenant_id: tenantId,
      study_id: study.id,
      source_signature: signature,
      file_name: "corrupt.csv",
      status: "staged",
      source_rows: 2,
      expected_respondents: 2,
      expected_quant: 2,
      expected_qual: 0,
    })
    .select("id")
    .single();
  if (stageError || !badBatch) {
    console.error(`Migration 0003 is not ready: ${stageError?.message ?? "could not stage batch"}`);
    process.exitCode = 4;
  } else {
    const invalidPayload = [
      { id: crypto.randomUUID(), segments: { nivel: "Primaria" }, quant: [{ metric_key: "nps", value: 9 }], qual: [] },
      { id: crypto.randomUUID(), segments: { nivel: "Primaria" }, quant: [{ metric_key: "nps", value: "nueve" }], qual: [] },
    ];
    const { error: commitError } = await admin.rpc("commit_import_batch", {
      p_import_batch_id: badBatch.id,
      p_respondents: invalidPayload,
    });
    eq("corrupt RPC rejected", Boolean(commitError), true);
    const [respondentRows, quantRows, qualRows] = await Promise.all([
      admin.from("respondent").select("id", { count: "exact", head: true }).eq("import_batch_id", badBatch.id),
      admin.from("quant_response").select("id", { count: "exact", head: true }).eq("import_batch_id", badBatch.id),
      admin.from("qual_observation").select("id", { count: "exact", head: true }).eq("import_batch_id", badBatch.id),
    ]);
    eq("respondent residue", respondentRows.count ?? -1, 0);
    eq("quantitative residue", quantRows.count ?? -1, 0);
    eq("qualitative residue", qualRows.count ?? -1, 0);

    console.log("\n[2] Valid import commits, then scoped rollback removes it");
    const respondents = [
      {
        id: crypto.randomUUID(),
        segments: { nivel: "Primaria" },
        quant: [{ metric_key: "nps", value: 9 }],
        qual: [{ source: "encuesta", category: null, theme: "comentario", quote: "Prueba temporal" }],
      },
      {
        id: crypto.randomUUID(),
        segments: { nivel: "Secundaria" },
        quant: [{ metric_key: "nps", value: 6 }],
        qual: [],
      },
    ];
    const summary = await persistRespondents(admin, {
      tenantId,
      studyId: study.id,
      sourceSignature: signature,
      fileName: "valid.csv",
      sourceRows: 2,
      respondents,
    });
    eq("committed respondents", summary.respondents, 2);
    eq("committed quant", summary.quant, 2);
    eq("committed qual", summary.qual, 1);

    const beforeRollback = await admin
      .from("respondent")
      .select("id", { count: "exact", head: true })
      .eq("import_batch_id", summary.importBatchId);
    eq("rows exist before rollback", beforeRollback.count ?? -1, 2);
    await rollbackImportBatch(admin, summary.importBatchId);
    const afterRollback = await admin
      .from("respondent")
      .select("id", { count: "exact", head: true })
      .eq("import_batch_id", summary.importBatchId);
    eq("rows removed by rollback", afterRollback.count ?? -1, 0);
  }
} finally {
  await admin.from("study").delete().eq("id", study.id);
  ok("test study removed");
}

console.log("\n" + "=".repeat(60));
if (process.exitCode === 4) {
  console.error("RESULT: migration 0003 must be applied before the live gate can run.");
} else if (failures > 0) {
  console.error(`RESULT: ${failures} failure(s) — P2B live gate blocked.`);
  process.exitCode = 1;
} else {
  console.log("RESULT: remote atomic commit and rollback passed with zero residue.");
}
