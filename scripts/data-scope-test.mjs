import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { applyDataScope, parseDataScope } from "../src/lib/studies/scope.ts";

const rows = [
  { id: "a", area: "Direccion", nivel: "Primaria", value: 1 },
  { id: "b", area: "Direccion", nivel: "Secundaria", value: 2 },
  { id: "c", area: "Academica", nivel: "Primaria", value: 3 },
  { id: "d", nivel: "Primaria", value: 4 },
];

assert.strictEqual(applyDataScope(rows, {}), rows, "empty scope preserves full tenant access without copying");
assert.deepEqual(applyDataScope(rows, { area: ["Direccion"] }).map((row) => row.id), ["a", "b"]);
assert.deepEqual(applyDataScope(rows, { area: ["Direccion"], nivel: ["Primaria"] }).map((row) => row.id), ["a"], "dimensions combine with AND");
assert.deepEqual(applyDataScope(rows, { area: ["Direccion", "Academica"] }).map((row) => row.id), ["a", "b", "c"], "values combine with OR");
assert.deepEqual(parseDataScope({ area: [" Direccion ", "Direccion"] }), { area: ["Direccion"] }, "scope values are trimmed and deduplicated");
assert.throws(() => parseDataScope({ "bad key": ["x"] }), /Invalid profile data scope/);
assert.throws(() => parseDataScope({ area: [] }), /Invalid profile data scope/, "empty allowlists fail closed");

const loader = await readFile(new URL("../src/lib/studies/authorized.ts", import.meta.url), "utf8");
assert.match(loader, /requestClient\.from\("profiles"\)/, "scope must come from the request user's own RLS row");
assert.match(loader, /profile\.role === "internal" \? \{\} : parseDataScope/, "internal users must not inherit a client scope");
assert.match(loader, /applyDataScope\(rows, scope\)/);
assert.match(loader, /applyDataScope\(qualitative, scope\)/);

const migration = await readFile(new URL("../supabase/migrations/0012_profile_data_scopes.sql", import.meta.url), "utf8");
assert.match(migration, /default '\{\}'::jsonb/);
assert.match(migration, /jsonb_typeof\(data_scope\) = 'object'/);

console.log("Per-user data scope gate: PASS");
