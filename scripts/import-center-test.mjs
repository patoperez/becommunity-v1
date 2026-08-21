import { readFileSync } from "node:fs";

let failures = 0;
const ok = (message) => console.log("  ✓", message);
const bad = (message) => { console.error("  ✗ FAIL:", message); failures++; };
const includes = (label, text, pattern) => pattern.test(text) ? ok(label) : bad(`${label}: ${pattern} absent`);

const migration = readFileSync(new URL("../supabase/migrations/0005_save_import_mapping.sql", import.meta.url), "utf8");
const actions = readFileSync(new URL("../src/app/admin/upload/actions.ts", import.meta.url), "utf8");
const config = readFileSync(new URL("../next.config.ts", import.meta.url), "utf8");

console.log("Be Community — P2C import-center contract gate");

console.log("\n[1] Mapping versioning is atomic and internal-only");
includes("mapping RPC is SECURITY DEFINER", migration, /security definer/i);
includes("mapping RPC has empty search_path", migration, /set search_path = ''/i);
includes("same configuration is reused", migration, /current_mapping\.configuration = p_configuration/i);
includes("concurrent first versions are serialized", migration, /pg_advisory_xact_lock/i);
includes("old active versions are deactivated", migration, /set is_active = false/i);
includes("browser roles cannot execute", migration, /revoke all on function[\s\S]*from public, anon, authenticated/i);
includes("only service role receives execution", migration, /grant execute on function[\s\S]*to service_role/i);

console.log("\n[2] Every mutation re-checks server authorization");
for (const action of ["analyzeImportFile", "previewImportFile", "confirmImportFile", "rollbackLatestImport"]) {
  includes(`${action} authorizes internally`, actions, new RegExp(`export async function ${action}[\\s\\S]*?authorizeInternal\\(\\)`));
}
includes("confirmation re-runs pure preview", actions, /confirmImportFile[\s\S]*previewMappedImport/);
includes("rollback is restricted to latest committed batch", actions, /Only se puede revertir|Solo se puede revertir/);

console.log("\n[3] Product upload limit reaches the Server Action");
includes("multipart envelope is above 10 MiB product limit", config, /bodySizeLimit:\s*["']11mb["']/);

console.log("\n" + "=".repeat(60));
if (failures > 0) {
  console.error(`RESULT: ${failures} failure(s) — P2C contract blocked.`);
  process.exit(1);
}
console.log("RESULT: import-center authorization and versioning contracts passed.");
