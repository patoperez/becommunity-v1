// =============================================================================
// Private metadata guard — offline structural gate.
//
//   npm run test:private-metadata
//
// WHY THIS EXISTS. Migration 0019 shipped `jsonb_object_length(jsonb)`, which is
// not a PostgreSQL function. PL/pgSQL prepares each SQL statement on first
// execution, so `create or replace function` accepted the body, every offline
// gate passed, the deploy succeeded, and the defect surfaced only when an
// operator confirmed a real import. Nothing in the repository could have caught
// it: the existing checks asserted that the migration TEXT contained certain
// phrases, never that the SQL it declared was executable.
//
// This gate closes the structural half of that hole:
//
//   [1] effective definitions — replaying every migration in order, no function
//       that is still live may call a JSON builtin PostgreSQL does not have.
//       Superseded historical definitions are exempt, because a migration that
//       is already recorded as applied must never be rewritten.
//   [2] the 0019 -> 0020 repair — the historical `jsonb_object_length` use is
//       accounted for by a LATER, complete replacement of the same function.
//   [3] the 0020 contract — the corrective migration reproduces every guarantee
//       0019 declared, and counts keys with a valid construct.
//
// The behavioral half lives in scripts/private-metadata-live-test.mjs, which
// executes the function against real PostgreSQL. A structural gate alone can
// never prove a function exists; only execution can. Both are required.
// =============================================================================

import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const MIGRATIONS_DIR = fileURLToPath(new URL("../supabase/migrations/", import.meta.url));
const SIGNATURE = "public.commit_import_batch_with_private(uuid, jsonb)";
const REPAIR = "0020_fix_private_metadata_field_count.sql";
const ORIGINAL = "0019_private_metadata_and_period_series.sql";

let failures = 0;
const ok = (m) => console.log("  ✓", m);
const fail = (m) => {
  console.error("  x FAIL:", m);
  failures++;
};
const check = (condition, m) => (condition ? ok(m) : fail(m));

// PostgreSQL 17 JSON/JSONB function names. `jsonb_object_length` is absent
// because PostgreSQL has no such function — that absence IS the gate.
const JSON_BUILTINS = new Set([
  "json_agg", "json_array", "json_array_elements", "json_array_elements_text",
  "json_array_length", "json_arrayagg", "json_build_array", "json_build_object",
  "json_each", "json_each_text", "json_exists", "json_extract_path",
  "json_extract_path_text", "json_object", "json_object_agg",
  "json_object_agg_strict", "json_object_agg_unique", "json_object_agg_unique_strict",
  "json_object_keys", "json_objectagg", "json_populate_record",
  "json_populate_record_valid", "json_populate_recordset", "json_query",
  "json_scalar", "json_serialize", "json_strip_nulls", "json_table",
  "json_to_record", "json_to_recordset", "json_typeof", "json_value",
  "jsonb_agg", "jsonb_array_elements", "jsonb_array_elements_text",
  "jsonb_array_length", "jsonb_build_array", "jsonb_build_object", "jsonb_concat",
  "jsonb_delete", "jsonb_each", "jsonb_each_text", "jsonb_exists",
  "jsonb_extract_path", "jsonb_extract_path_text", "jsonb_insert", "jsonb_object",
  "jsonb_object_agg", "jsonb_object_agg_strict", "jsonb_object_agg_unique",
  "jsonb_object_agg_unique_strict", "jsonb_object_keys", "jsonb_path_exists",
  "jsonb_path_exists_tz", "jsonb_path_match", "jsonb_path_match_tz",
  "jsonb_path_query", "jsonb_path_query_array", "jsonb_path_query_array_tz",
  "jsonb_path_query_first", "jsonb_path_query_first_tz", "jsonb_path_query_tz",
  "jsonb_populate_record", "jsonb_populate_record_valid", "jsonb_populate_recordset",
  "jsonb_pretty", "jsonb_set", "jsonb_set_lax", "jsonb_strip_nulls",
  "jsonb_to_record", "jsonb_to_recordset", "jsonb_typeof",
  "to_json", "to_jsonb", "row_to_json", "array_to_json",
]);

const stripComments = (sql) =>
  sql
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("--"))
    .join("\n");

const files = readdirSync(MIGRATIONS_DIR)
  .filter((name) => /^\d{4}_.*\.sql$/.test(name))
  .sort();

// Every `create or replace function <sig> ... as $$ body $$;` in a migration.
// Signatures are normalised to `schema.name(type, type)` so a later migration
// replacing the same function is recognised as superseding the earlier one.
function definitionsIn(sql) {
  const out = [];
  const re =
    /create\s+or\s+replace\s+function\s+([a-z_][a-z0-9_]*\.[a-z_][a-z0-9_]*)\s*\(([^)]*)\)([\s\S]*?)\$\$([\s\S]*?)\$\$\s*;/gi;
  for (const m of sql.matchAll(re)) {
    const types = m[2]
      .split(",")
      .map((arg) => arg.trim().split(/\s+/).slice(-1)[0].toLowerCase())
      .filter(Boolean);
    out.push({
      signature: `${m[1].toLowerCase()}(${types.join(", ")})`,
      whole: m[0],
    });
  }
  return out;
}

const effective = new Map();
const historical = [];
for (const name of files) {
  const sql = stripComments(readFileSync(MIGRATIONS_DIR + name, "utf8"));
  for (const def of definitionsIn(sql)) {
    historical.push({ ...def, migration: name });
    effective.set(def.signature, { ...def, migration: name });
  }
}

const jsonCallsIn = (text) =>
  [...text.matchAll(/\b((?:jsonb?|to_json|row_to_json|array_to_json)[a-z0-9_]*)\s*\(/gi)].map((m) =>
    m[1].toLowerCase(),
  );

console.log("Be Community — private metadata guard (offline)");

console.log(`\n[1] Effective function definitions call only real JSON builtins (${effective.size} function(s)):`);
{
  const offenders = [];
  for (const [signature, def] of effective) {
    for (const called of jsonCallsIn(def.whole)) {
      if (!JSON_BUILTINS.has(called)) offenders.push(`${def.migration}: ${signature} calls ${called}()`);
    }
  }
  check(
    offenders.length === 0,
    `no live definition calls a non-existent JSON function${offenders.length ? ` — ${offenders.join("; ")}` : ""}`,
  );
  check(
    ![...effective.values()].some((d) => /jsonb_object_length/i.test(d.whole)),
    "no live definition calls jsonb_object_length (PostgreSQL has jsonb_array_length, not jsonb_object_length)",
  );
}

console.log("\n[2] The historical 0019 defect is repaired by a later migration, not by a rewrite:");
{
  const offending = historical.filter((d) => /jsonb_object_length/i.test(d.whole));
  check(
    offending.length > 0,
    "the historical jsonb_object_length definition is still on record (0019 was not rewritten)",
  );
  for (const def of offending) {
    const live = effective.get(def.signature);
    check(
      Boolean(live) && live.migration !== def.migration && !/jsonb_object_length/i.test(live.whole),
      `${def.signature} from ${def.migration} is superseded by a clean definition (${live?.migration ?? "none"})`,
    );
    check(Boolean(live) && live.migration > def.migration, `the replacement migration sorts after ${def.migration}`);
  }
  check(
    /jsonb_object_length/.test(readFileSync(MIGRATIONS_DIR + ORIGINAL, "utf8")),
    "migration 0019 is left as applied — it is already recorded against the database",
  );
}

console.log("\n[3] Migration 0020 reproduces the whole function and every guarantee:");
{
  const raw = readFileSync(MIGRATIONS_DIR + REPAIR, "utf8");
  const code = stripComments(raw);
  const def = effective.get("public.commit_import_batch_with_private(uuid, jsonb)");
  check(def?.migration === REPAIR, `${SIGNATURE} is last defined by ${REPAIR}`);

  const body = def?.whole ?? "";
  for (const [label, re] of [
    ["language plpgsql", /\blanguage plpgsql\b/i],
    ["security definer", /\bsecurity definer\b/i],
    ["an empty search_path", /\bset search_path = ''/],
    ["the array-shape rejection", /jsonb_typeof\(p_respondents\)\s*<>\s*'array'/i],
    ["the privateMetadata object-shape rejection", /private metadata must be an object/i],
    ["the key pattern restriction", /\^\[a-z\]\[a-z0-9_\]\{0,63\}\$/],
    ["string-only private values", /jsonb_typeof\(value\) is distinct from 'string'/i],
    ["the 2000-byte per-value cap", /octet_length\(value #>> '\{\}'\) > 2000/i],
    ["the 32768-byte total cap", /> 32768/],
    ["the 100-key cap", /> 100/],
    ["delegation to public.commit_import_batch", /public\.commit_import_batch\(p_import_batch_id, p_respondents\)/i],
    ["the private_metadata write-back", /update public\.respondent[\s\S]*set private_metadata/i],
  ]) {
    check(re.test(body), `0020 declares ${label}`);
  }

  check(
    /\(\s*select count\(\*\)\s*from jsonb_object_keys\(/i.test(body),
    "0020 counts keys with count(*) over jsonb_object_keys — a real PostgreSQL set-returning function",
  );
  // The header comment names the defect on purpose; no executable line may.
  check(!/jsonb_object_length/i.test(code), "no executable statement in 0020 references jsonb_object_length");
  check(
    code.includes(`revoke all on function ${SIGNATURE} from public, anon, authenticated;`),
    "0020 revokes execute from public, anon and authenticated",
  );
  check(
    code.includes(`grant execute on function ${SIGNATURE} to service_role;`),
    "0020 grants execute to service_role",
  );
  const grantees = [...code.matchAll(/grant execute on function[^;]*\bto\s+([^;]+);/gi)]
    .map((m) => m[1].trim())
    .filter((g) => g !== "service_role");
  check(
    grantees.length === 0,
    `0020 grants execute to no other role${grantees.length ? ` — ${grantees.join(", ")}` : ""}`,
  );
  check(!/\bgrant\b[^;]*\bon\s+(?:all\s+)?tables?\b/i.test(code), "0020 adds no table-level grant");
  check(
    !/\b(drop|truncate|delete from|alter policy|disable row level security)\b/i.test(code),
    "0020 drops nothing and relaxes no RLS",
  );
  check(
    /^\s*begin;/m.test(code) && /commit;\s*$/.test(code.trimEnd()),
    "0020 applies inside one transaction",
  );
}

console.log("\n" + "=".repeat(60));
if (failures > 0) {
  console.error(`Private metadata guard FAILED with ${failures} failure(s).`);
  process.exit(1);
}
console.log("Private metadata guard passed.");
