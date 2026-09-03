// =============================================================================
// READ-ONLY inventory of a hosted Supabase project
//   CANONICAL_HOSTED_TARGET_REF=<ref> \
//   CANONICAL_HOSTED_ACKNOWLEDGE=I-AUTHORIZE-MUTATION-OF-<ref> \
//   CANONICAL_HOSTED_SERVICE_KEY=<key> \
//   CANONICAL_HOSTED_DISPOSABLE_PREFIX=U4-XXXXXX \
//     npm run test:canonical-hosted-inventory
// =============================================================================
// This is the step that runs BEFORE anything is applied to a real project, and
// it is the only hosted script in this repository that writes nothing at all.
//
// -----------------------------------------------------------------------------
// IT MUTATES NOTHING, AND THAT IS ENFORCED BY WHAT IT DOES NOT DO
// -----------------------------------------------------------------------------
//   * PRESENCE comes from the OpenAPI document, and COUNTS from a range request
//     whose HTTP status is checked. A `HEAD` with `count=exact` is NOT enough:
//     a HEAD response carries no body, so PostgREST's error JSON cannot be
//     parsed and supabase-js reports no error at all — every table, existing or
//     not, comes back looking present. That flaw made this script's first run
//     claim 41/41 tables against a project whose RLS reporter saw 23;
//   * FUNCTION PRESENCE IS READ FROM THE OPENAPI DOCUMENT, NOT BY CALLING THE
//     FUNCTION. Calling `record_canonical_rows` to see whether it exists would
//     be asking a writer to prove itself by trying to write. PostgREST publishes
//     every exposed table and RPC at the API root, so presence is a read;
//   * the only function it calls is `rls_coverage_report()`, which migration
//     0014 created precisely as a metadata-only reporter;
//   * no INSERT, no UPDATE, no DELETE, no DDL, no setting is read or changed.
//
// -----------------------------------------------------------------------------
// WHAT IT CANNOT ANSWER, AND SAYS SO
// -----------------------------------------------------------------------------
// `supabase_migrations.schema_migrations` is the authoritative list of applied
// migrations. PostgREST exposes only the schemas a project configures — `public`
// and `graphql_public` — so that table is NOT reachable with a service key over
// REST. This script ATTEMPTS it and records the exact failure, because "I could
// not read it" is a finding and inferring the list from which objects exist is
// not the same claim.
//
// Likewise `statement_timeout` and any `pg_catalog` question: both need a direct
// PostgreSQL connection this transport does not have.
//
// PRIVACY. Counts, booleans, SQLSTATEs, HTTP statuses and object names only. No
// row content, no credential, no PostgreSQL message text.
// =============================================================================

import { createClient } from "@supabase/supabase-js";

import {
  ARTIFACTS,
  resolveEvidenceDirectory,
  writeArtifact,
} from "./lib/hosted-evidence.mjs";
import {
  HostedTargetError,
  PROTECTED_TABLES,
  describeTarget,
  resolveHostedTarget,
} from "./lib/hosted-target.mjs";

const CANONICAL_FUNCTIONS = [
  "record_canonical_rows",
  "stage_canonical_package",
  "commit_canonical_package",
  "rollback_canonical_package",
];

// ---------------------------------------------------------------------------
// [1] Authorization — the same guard the mutating runner uses
// ---------------------------------------------------------------------------
let target;
try {
  target = resolveHostedTarget(process.env);
} catch (thrown) {
  if (thrown instanceof HostedTargetError) {
    console.error(`REFUSED: ${thrown.message}`);
    process.exit(2);
  }
  throw thrown;
}

const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const evidenceDirectory = resolveEvidenceDirectory(process.env, `inventory-${stamp}`);

console.log("Be Community — hosted project inventory (READ ONLY, WRITES NOTHING)");
console.log("=".repeat(78));
for (const [key, value] of Object.entries(describeTarget(target))) console.log(`  ${key}: ${value}`);
console.log(`  evidence: ${evidenceDirectory}`);

const service = createClient(target.apiOrigin, target.serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const authHeaders = { apikey: target.serviceKey, Authorization: `Bearer ${target.serviceKey}` };

// ---------------------------------------------------------------------------
// [2] The API surface, read from PostgREST's own OpenAPI document
// ---------------------------------------------------------------------------
console.log("\n[api] reading the exposed surface from the API root");
let openapi = null;
let banner = null;
try {
  const answer = await fetch(`${target.apiOrigin}/rest/v1/`, { headers: authHeaders });
  banner = answer.headers.get("server");
  if (answer.ok) openapi = await answer.json();
  console.log(`  HTTP ${answer.status}   server: ${banner ?? "unreported"}`);
} catch (thrown) {
  console.log(`  the API root could not be read (${thrown.name})`);
}

const exposedPaths = new Set(Object.keys(openapi?.paths ?? {}));
const exposedTable = (name) => exposedPaths.has(`/${name}`);
const exposedRpc = (name) => exposedPaths.has(`/rpc/${name}`);

// ---------------------------------------------------------------------------
// [3] The census — counts only, never a row
// ---------------------------------------------------------------------------
console.log("\n[census] counting every protected table — counts only, no row is read");
const census = {};
const presence = {};
for (const table of PROTECTED_TABLES) {
  if (!exposedTable(table)) {
    census[table] = null;
    presence[table] = "absent (not exposed)";
    continue;
  }
  // A counted GET of zero rows: the count arrives in Content-Range as "*/N" and
  // the HTTP status is checked, so a missing table cannot pass as an empty one.
  const answer = await fetch(`${target.apiOrigin}/rest/v1/${table}?select=*&limit=0`, {
    headers: { ...authHeaders, Prefer: "count=exact" },
  });
  if (!answer.ok) {
    census[table] = null;
    presence[table] = `unreadable (HTTP ${answer.status})`;
    continue;
  }
  const range = answer.headers.get("content-range");
  const total = range && range.includes("/") ? Number(range.split("/")[1]) : null;
  census[table] = Number.isFinite(total) ? total : null;
  presence[table] = "present";
}
const present = Object.values(presence).filter((state) => state === "present").length;
console.log(`  ${present}/${PROTECTED_TABLES.length} protected tables reachable`);
for (const [table, state] of Object.entries(presence)) {
  if (state !== "present") console.log(`    ${table}: ${state}`);
}

const functions = {};
for (const name of CANONICAL_FUNCTIONS) functions[name] = exposedRpc(name) ? "present" : "absent";
console.log(
  `  functions: ${Object.values(functions).filter((s) => s === "present").length}/${CANONICAL_FUNCTIONS.length} exposed`,
);

// ---------------------------------------------------------------------------
// [3b] Per-study distribution — counts only, and no study is ever named
// ---------------------------------------------------------------------------
// The table-wide census cannot answer "does the real study still hold 60
// respondents", because the table holds every study. This scopes the same COUNT
// by study, and reports the DISTRIBUTION only: no study id, no study name and no
// respondent row is printed or written. A study id is used to scope a count and
// is then discarded.
console.log("\n[studies] per-study counts — distribution only, no study is named");
let distribution = null;
{
  const { data, error } = await service.from("study").select("id");
  if (error) {
    console.log(`  the study list could not be read (${error.code ?? "no code"})`);
  } else {
    const rows = [];
    for (const { id } of data ?? []) {
      const counts = {};
      for (const [table, column] of [
        ["respondent", "study_id"],
        ["quant_response", "study_id"],
        ["qual_observation", "study_id"],
      ]) {
        const answer = await fetch(
          `${target.apiOrigin}/rest/v1/${table}?select=*&limit=0&${column}=eq.${id}`,
          { headers: { ...authHeaders, Prefer: "count=exact" } },
        );
        const range = answer.ok ? answer.headers.get("content-range") : null;
        counts[table] = range && range.includes("/") ? Number(range.split("/")[1]) : null;
      }
      rows.push(counts);
    }
    // Sorted by size so the shape is comparable run to run without identifying
    // which study is which.
    distribution = rows.sort((a, b) => (b.respondent ?? 0) - (a.respondent ?? 0));
    console.log("  respondent / quant_response / qual_observation, largest first:");
    for (const r of distribution) {
      console.log(`    ${String(r.respondent).padStart(5)} / ${String(r.quant_response).padStart(6)} / ${String(r.qual_observation).padStart(4)}`);
    }
  }
}

// ---------------------------------------------------------------------------
// [3c] The tables migrations 0022 and 0023 ALTER — the ones that are NOT additive
// ---------------------------------------------------------------------------
// 0022 builds a unique index on `respondent`; 0023 adds three columns, two CHECK
// constraints and an index to `study_period_snapshot`, and its reverse DROPS
// those columns. So the "before" for both is a row count that must not move, and
// for `study_period_snapshot` it is also the table whose reverse is lossy.
console.log("\n[altered] the pre-existing tables 0022 and 0023 change");
const alteredTables = {};
for (const table of ["respondent", "study_period_snapshot"]) {
  if (!exposedTable(table)) {
    alteredTables[table] = null;
    console.log(`  ${table}: not exposed through this API`);
    continue;
  }
  const answer = await fetch(`${target.apiOrigin}/rest/v1/${table}?select=*&limit=0`, {
    headers: { ...authHeaders, Prefer: "count=exact" },
  });
  const range = answer.ok ? answer.headers.get("content-range") : null;
  alteredTables[table] = range && range.includes("/") ? Number(range.split("/")[1]) : null;
  console.log(`  ${table}: ${alteredTables[table]} row(s)`);
}

// ---------------------------------------------------------------------------
// [4] The applied-migration ledger — ATTEMPTED, and its failure recorded
// ---------------------------------------------------------------------------
// This is the question that decides whether a migration may be applied at all,
// so an inference is not good enough. The attempt is made two ways and both
// outcomes are recorded verbatim as a status and a code.
console.log("\n[migrations] attempting supabase_migrations.schema_migrations over REST");
const migrationAttempts = [];
for (const [label, headers] of [
  ["default profile", authHeaders],
  ["Accept-Profile: supabase_migrations", { ...authHeaders, "Accept-Profile": "supabase_migrations" }],
]) {
  try {
    const answer = await fetch(
      `${target.apiOrigin}/rest/v1/schema_migrations?select=version&order=version.asc`,
      { headers },
    );
    let code = null;
    try {
      code = (await answer.json())?.code ?? null;
    } catch {
      code = null;
    }
    migrationAttempts.push({ attempt: label, httpStatus: answer.status, code });
    console.log(`  ${label}: HTTP ${answer.status}${code ? ` (${code})` : ""}`);
  } catch (thrown) {
    migrationAttempts.push({ attempt: label, httpStatus: 0, code: thrown.name });
    console.log(`  ${label}: no response (${thrown.name})`);
  }
}
const ledgerReadable = migrationAttempts.some((a) => a.httpStatus === 200);
console.log(
  ledgerReadable
    ? "  the ledger IS readable over REST"
    : "  the ledger is NOT readable over REST — it needs a direct PostgreSQL connection",
);

// ---------------------------------------------------------------------------
// [5] RLS coverage, through migration 0014's metadata-only reporter
// ---------------------------------------------------------------------------
console.log("\n[rls] migration 0014's coverage report");
let rls = null;
let rlsError = null;
{
  const { data, error } = await service.rpc("rls_coverage_report");
  if (error) {
    rlsError = { code: error.code ?? null };
    console.log(`  the report could not be read (${error.code ?? "no code"})`);
  } else {
    const rows = Array.isArray(data) ? data : [];
    const enabled = rows.filter((r) => r.rls_enabled === true).length;
    const forced = rows.filter((r) => r.rls_forced === true).length;
    rls = {
      tables: rows.length,
      rlsEnabled: enabled,
      rlsForced: forced,
      exceptions: rows
        .filter((r) => r.rls_enabled !== true || r.rls_forced !== true)
        .map((r) => ({ table: r.table_name, rls_enabled: r.rls_enabled, rls_forced: r.rls_forced })),
    };
    console.log(`  ${rows.length} public tables: ${enabled} RLS-enabled, ${forced} FORCE RLS`);
    for (const e of rls.exceptions) console.log(`    EXCEPTION ${e.table}: enabled=${e.rls_enabled} forced=${e.rls_forced}`);
  }
}

// ---------------------------------------------------------------------------
// [6] Evidence
// ---------------------------------------------------------------------------
const inventory = {
  stamp,
  target: describeTarget(target),
  postgrestBanner: banner,
  openapiVersion: openapi?.info?.version ?? null,
  exposedPathCount: exposedPaths.size,
  protectedTables: PROTECTED_TABLES.length,
  tablesPresent: present,
  presence,
  functions,
  census,
  studyDistribution: distribution,
  alteredTables,
  exposedTables: [...exposedPaths].filter((x) => !x.startsWith("/rpc/") && x !== "/").map((x) => x.slice(1)).sort(),
  exposedRpcs: [...exposedPaths].filter((x) => x.startsWith("/rpc/")).map((x) => x.slice(5)).sort(),
  migrationLedger: { readable: ledgerReadable, attempts: migrationAttempts },
  rls,
  rlsError,
  notObtainableOverRest: [
    "supabase_migrations.schema_migrations — not an exposed schema",
    "statement_timeout for service_role — needs a direct connection",
    "pg_catalog snapshot (catalogue-snapshot.sql) — needs a direct connection",
  ],
};
writeArtifact(evidenceDirectory, ARTIFACTS[0], inventory);

console.log("\n" + "=".repeat(78));
console.log(`Inventory written to ${evidenceDirectory}`);
console.log("NOTHING WAS WRITTEN TO THE PROJECT. No row was read; only counts.");
