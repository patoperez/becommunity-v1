// =============================================================================
// Input-boundary validation gate (§5.3). Proves the Zod schemas reject malformed
// input and accept valid input at every boundary. Offline, no DB.
//   npx tsx scripts/validation-test.mjs
// =============================================================================
import { loginSchema, uploadSchema } from "../src/lib/validation/schemas.ts";
import { authErrorMessage } from "../src/app/login/errors.ts";

let failures = 0;
const ok = (m) => console.log("  ✓", m);
const bad = (m) => { console.error("  ✗ FAIL:", m); failures++; };
const accepts = (label, schema, input) =>
  schema.safeParse(input).success ? ok(`accepts ${label}`) : bad(`should accept ${label}`);
const rejects = (label, schema, input) =>
  !schema.safeParse(input).success ? ok(`rejects ${label}`) : bad(`should reject ${label}`);

const UUID = "298c79c0-a88e-487b-a63d-3d7062c6111e";

console.log("\n[1] loginSchema");
accepts("valid email+password", loginSchema, { email: "user@school.mx", password: "s3cret" });
accepts("email needing trim", loginSchema, { email: "  user@school.mx  ", password: "x" });
rejects("missing email", loginSchema, { password: "x" });
rejects("null email (non-string)", loginSchema, { email: null, password: "x" });
rejects("malformed email", loginSchema, { email: "not-an-email", password: "x" });
rejects("empty password", loginSchema, { email: "user@school.mx", password: "" });
rejects("oversize email (>254)", loginSchema, { email: "a".repeat(250) + "@x.com", password: "x" });

console.log("\n[2] uploadSchema");
accepts("valid minimal", uploadSchema, { tenant_id: UUID, study_name: "Satisfacción 2026", required_columns: [] });
accepts("valid with period + columns", uploadSchema, { tenant_id: UUID, study_name: "S", period: "2026", required_columns: ["seg_nivel", "seg_grupo"] });
rejects("non-uuid tenant_id", uploadSchema, { tenant_id: "abc", study_name: "S", required_columns: [] });
rejects("null tenant_id", uploadSchema, { tenant_id: null, study_name: "S", required_columns: [] });
rejects("empty study_name", uploadSchema, { tenant_id: UUID, study_name: "   ", required_columns: [] });
rejects("oversize study_name (>200)", uploadSchema, { tenant_id: UUID, study_name: "x".repeat(201), required_columns: [] });
rejects("column with spaces", uploadSchema, { tenant_id: UUID, study_name: "S", required_columns: ["seg nivel"] });
rejects("column with injection chars", uploadSchema, { tenant_id: UUID, study_name: "S", required_columns: ["a;drop"] });
rejects("too many columns (>50)", uploadSchema, { tenant_id: UUID, study_name: "S", required_columns: Array(51).fill("c") });

console.log("\n[3] authErrorMessage (error-code allowlist)");
authErrorMessage("invalid_credentials") ? ok("maps 'invalid_credentials'") : bad("should map 'invalid_credentials'");
authErrorMessage("missing_fields") ? ok("maps 'missing_fields'") : bad("should map 'missing_fields'");
authErrorMessage("<script>alert(1)</script>") === null ? ok("drops arbitrary code -> null") : bad("arbitrary code should map to null");
authErrorMessage(undefined) === null ? ok("undefined -> null") : bad("undefined should map to null");

console.log("\n" + "=".repeat(60));
if (failures > 0) { console.error(`RESULT: ${failures} failure(s) — boundary validation GATE BLOCKED.`); process.exit(1); }
console.log("RESULT: all boundary-validation checks passed.");
