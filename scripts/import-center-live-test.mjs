import { createHash } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const tenantId = process.env.TEST_TENANT_A_ID;
if (!url || !anonKey || !serviceKey || !tenantId) {
  console.error("Missing environment for P2C live gate.");
  process.exit(2);
}

const admin = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });
const anon = createClient(url, anonKey, { auth: { autoRefreshToken: false, persistSession: false } });
const signature = `sha256:${createHash("sha256").update(`p2c-${Date.now()}-${crypto.randomUUID()}`).digest("hex")}`;
const mapping = {
  version: 1,
  name: "P2C live mapping",
  columns: [{ sourceColumn: "Calificación", target: { kind: "quantitative", metricKey: "nps" } }],
  recodingTables: [],
};

let failures = 0;
const ok = (message) => console.log("  ✓", message);
const bad = (message) => { console.error("  ✗ FAIL:", message); failures++; };
const eq = (label, actual, expected) => Object.is(actual, expected) ? ok(`${label} = ${String(expected)}`) : bad(`${label}: expected ${String(expected)}, got ${String(actual)}`);

console.log("Be Community — P2C live mapping-version gate");

try {
  console.log("\n[1] Browser role cannot save internal mappings");
  const { error: anonError } = await anon.rpc("save_import_mapping", {
    p_tenant_id: tenantId,
    p_source_signature: signature,
    p_name: mapping.name,
    p_configuration: mapping,
    p_created_by: null,
  });
  eq("anon rejected", Boolean(anonError), true);

  console.log("\n[2] Identical mapping reuses one version");
  const first = await admin.rpc("save_import_mapping", {
    p_tenant_id: tenantId,
    p_source_signature: signature,
    p_name: mapping.name,
    p_configuration: mapping,
    p_created_by: null,
  });
  if (first.error) throw first.error;
  eq("first version", first.data.version, 1);
  eq("first call creates", first.data.reused, false);
  const second = await admin.rpc("save_import_mapping", {
    p_tenant_id: tenantId,
    p_source_signature: signature,
    p_name: mapping.name,
    p_configuration: mapping,
    p_created_by: null,
  });
  if (second.error) throw second.error;
  eq("same id reused", second.data.id, first.data.id);
  eq("same version reused", second.data.version, 1);
  eq("reuse flag", second.data.reused, true);

  console.log("\n[3] Changed mapping creates the next active version");
  const changed = { ...mapping, name: "P2C live mapping updated" };
  const third = await admin.rpc("save_import_mapping", {
    p_tenant_id: tenantId,
    p_source_signature: signature,
    p_name: changed.name,
    p_configuration: changed,
    p_created_by: null,
  });
  if (third.error) throw third.error;
  eq("changed version", third.data.version, 2);
  eq("changed mapping is new", third.data.reused, false);
  const { data: rows, error: rowsError } = await admin
    .from("import_mapping")
    .select("version, is_active")
    .eq("tenant_id", tenantId)
    .eq("source_signature", signature)
    .order("version");
  if (rowsError) throw rowsError;
  eq("two audit versions", rows.length, 2);
  eq("v1 inactive", rows[0].is_active, false);
  eq("v2 active", rows[1].is_active, true);
} catch (error) {
  bad((error instanceof Error ? error.message : String(error)) || "live gate failed");
} finally {
  const { error } = await admin.from("import_mapping").delete().eq("source_signature", signature);
  if (error) bad(`cleanup failed: ${error.message}`);
  else ok("temporary mapping versions removed");
}

console.log("\n" + "=".repeat(60));
if (failures > 0) {
  console.error(`RESULT: ${failures} failure(s) — P2C live gate blocked.`);
  process.exit(1);
}
console.log("RESULT: remote mapping reuse, versioning, and denial passed.");
