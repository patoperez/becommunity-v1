import { readFileSync } from "node:fs";
import {
  persistRespondents,
  rollbackImportBatch,
} from "../src/lib/ingestion/persist.ts";

let failures = 0;
const ok = (message) => console.log("  ✓", message);
const bad = (message) => { console.error("  ✗ FAIL:", message); failures++; };
const eq = (label, actual, expected) => Object.is(actual, expected)
  ? ok(`${label} = ${String(expected)}`)
  : bad(`${label}: expected ${String(expected)}, got ${String(actual)}`);
const includes = (label, text, pattern) => pattern.test(text)
  ? ok(label)
  : bad(`${label}: pattern ${pattern} absent`);

const BATCH_ID = "10000000-0000-4000-8000-000000000001";
const SIGNATURE = `sha256:${"a".repeat(64)}`;
const respondents = [{
  id: "20000000-0000-4000-8000-000000000001",
  sourceRow: 41,
  privateMetadata: { folio: "INTERNO-41" },
  segments: { nivel: "Primaria" },
  quant: [{ metric_key: "nps", value: 9 }],
  qual: [{ source: "encuesta", category: null, theme: "comentario", quote: "Buen servicio" }],
}];

function fakeClient({ commitError = null, commitData = null } = {}) {
  const calls = [];
  const client = {
    calls,
    from(table) {
      calls.push({ kind: "from", table });
      return {
        insert(row) {
          calls.push({ kind: "insert", table, row });
          return {
            select() {
              return { single: async () => ({ data: { id: BATCH_ID }, error: null }) };
            },
          };
        },
        update(row) {
          calls.push({ kind: "update", table, row });
          const builder = {
            eq(column, value) {
              calls.push({ kind: "eq", table, column, value });
              return builder;
            },
          };
          return builder;
        },
      };
    },
    async rpc(name, args) {
      calls.push({ kind: "rpc", name, args });
      if (name === "commit_import_batch_with_private") {
        if (commitError) return { data: null, error: { message: commitError } };
        return {
          data: commitData ?? { import_batch_id: BATCH_ID, respondents: 1, quant: 1, qual: 1 },
          error: null,
        };
      }
      return { data: { import_batch_id: BATCH_ID, status: "rolled_back" }, error: null };
    },
  };
  return client;
}

const params = {
  tenantId: "30000000-0000-4000-8000-000000000001",
  studyId: "40000000-0000-4000-8000-000000000001",
  sourceSignature: SIGNATURE,
  fileName: "respuestas.csv",
  sourceRows: 1,
  createdBy: "50000000-0000-4000-8000-000000000001",
  respondents,
};

console.log("Be Community — P2B atomic-ingestion contract gate");

console.log("\n[1] Application persistence uses one transactional RPC");
const successClient = fakeClient();
const summary = await persistRespondents(successClient, params);
eq("batch id returned", summary.importBatchId, BATCH_ID);
eq("respondents returned", summary.respondents, 1);
eq("only control table is addressed directly", successClient.calls.filter((call) => call.kind === "from").every((call) => call.table === "import_batch"), true);
eq("private-aware commit RPC called once", successClient.calls.filter((call) => call.kind === "rpc" && call.name === "commit_import_batch_with_private").length, 1);
const staged = successClient.calls.find((call) => call.kind === "insert")?.row;
eq("preview respondent count staged", staged.expected_respondents, 1);
eq("preview quant count staged", staged.expected_quant, 1);
eq("preview qual count staged", staged.expected_qual, 1);
const commitPayload = successClient.calls.find((call) => call.kind === "rpc" && call.name === "commit_import_batch_with_private")?.args.p_respondents;
eq("source row is not persisted", "sourceRow" in commitPayload[0], false);
eq("tenant id is absent from canonical payload", "tenant_id" in commitPayload[0], false);
eq("private metadata is carried only inside the canonical payload", commitPayload[0].privateMetadata.folio, "INTERNO-41");

console.log("\n[2] RPC failure records audit state, not fallback writes");
const failureClient = fakeClient({ commitError: "invalid canonical quantitative response" });
try {
  await persistRespondents(failureClient, params);
  bad("failed RPC must reject persistence");
} catch { ok("failed RPC rejects persistence"); }
eq("failed batch marked once", failureClient.calls.filter((call) => call.kind === "update" && call.row.status === "failed").length, 1);
eq("no direct response-table fallback", failureClient.calls.some((call) => ["respondent", "quant_response", "qual_observation"].includes(call.table)), false);

console.log("\n[3] Suspicious RPC response is rolled back");
const mismatchClient = fakeClient({
  commitData: { import_batch_id: BATCH_ID, respondents: 1, quant: 99, qual: 1 },
});
try {
  await persistRespondents(mismatchClient, params);
  bad("mismatched RPC counts must reject persistence");
} catch { ok("mismatched RPC counts reject persistence"); }
eq("mismatch triggers rollback", mismatchClient.calls.some((call) => call.kind === "rpc" && call.name === "rollback_import_batch"), true);

console.log("\n[4] Rollback uses the restricted RPC");
const rollbackClient = fakeClient();
await rollbackImportBatch(rollbackClient, BATCH_ID);
eq("rollback RPC called", rollbackClient.calls.some((call) => call.kind === "rpc" && call.name === "rollback_import_batch"), true);

console.log("\n[5] Migration security contract");
const sql = readFileSync(new URL("../supabase/migrations/0003_universal_ingestion_storage.sql", import.meta.url), "utf8");
for (const table of ["import_mapping", "recoding_table", "import_batch"]) {
  includes(`${table} forces RLS`, sql, new RegExp(`alter table public\\.%I force row level security`));
}
includes("browser roles explicitly denied", sql, /for all to anon, authenticated using \(false\) with check \(false\)/i);
includes("browser table privileges revoked", sql, /revoke all privileges on table public\.%I from anon, authenticated/i);
includes("commit function is SECURITY DEFINER", sql, /function public\.commit_import_batch[\s\S]*?security definer/i);
includes("commit function has empty search_path", sql, /function public\.commit_import_batch[\s\S]*?set search_path = ''/i);
includes("authenticated cannot execute commit", sql, /revoke all on function public\.commit_import_batch\(uuid, jsonb\) from public, anon, authenticated/i);
includes("only service role receives commit execution", sql, /grant execute on function public\.commit_import_batch\(uuid, jsonb\) to service_role/i);
includes("payload counts checked before inserts", sql, /canonical payload counts do not match staged preview[\s\S]*?insert into public\.respondent/i);
includes("tenant and study derived from locked batch", sql, /from public\.import_batch[\s\S]*?for update[\s\S]*?batch\.tenant_id[\s\S]*?batch\.study_id/i);

console.log("\n" + "=".repeat(60));
if (failures > 0) {
  console.error(`RESULT: ${failures} failure(s) — atomic-ingestion gate blocked.`);
  process.exit(1);
}
console.log("RESULT: atomic persistence and migration security contracts passed.");
