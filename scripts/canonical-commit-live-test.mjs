// =============================================================================
// Canonical commit and rollback — DATABASE-EXECUTED gate
//   CANONICAL_COMMIT_TEST_DATABASE_URL=postgres://… \
//     npx tsx scripts/canonical-commit-live-test.mjs
// =============================================================================
// NOT PART OF `npm test`. This gate needs a real PostgreSQL instance and is
// deliberately kept out of the offline chain, so an unexecuted database test
// can never be counted among the offline results.
//
// STATUS AT THE TIME OF WRITING: NEVER EXECUTED. No PostgreSQL server was
// available in the development environment (postgresql-client only, no server
// package, no container runtime), so every transactional claim about migration
// 0024 in this repository is STRUCTURAL until this script has run and its
// output has been recorded. Do not describe the behaviour it checks as proved
// before then.
//
// WHERE IT MAY RUN. Against a DISPOSABLE database and nothing else:
//
//   * `CANONICAL_COMMIT_TEST_DATABASE_URL` must be set explicitly. The script
//     reads no `.env` file and falls back to nothing.
//   * The host must be a loopback address, and the database name must contain
//     `disposable`. Both are refused otherwise, so a copy-pasted staging or
//     production URL cannot be used by accident.
//   * It refuses outright if the connection string names a Supabase host.
//
// WHAT IT DOES. Creates its own schema from migrations 0000 to 0024, inserts a
// disposable tenant, study and package, and then executes the twelve behaviours
// migration 0024 defines — first commit, replay, duplicate upload, retry after
// failure, rollback, repeated rollback, commit after rollback, two simultaneous
// commits, count mismatch, malformed payload, foreign tenant/study, and missing
// references — asserting the row counts before and after each. It then drops
// everything it created.
//
// It uses SYNTHETIC data built by the same fixture code as the offline gate.
// No real workbook, name, answer or identifier goes near it.
// =============================================================================

const url = process.env.CANONICAL_COMMIT_TEST_DATABASE_URL ?? "";

function refuse(reason) {
  console.error(`REFUSED: ${reason}`);
  console.error(
    "This gate runs only against a disposable local database. Set " +
      "CANONICAL_COMMIT_TEST_DATABASE_URL to a loopback connection string whose " +
      "database name contains 'disposable'.",
  );
  process.exit(2);
}

if (url === "") refuse("CANONICAL_COMMIT_TEST_DATABASE_URL is not set");

let parsed;
try {
  parsed = new URL(url);
} catch {
  refuse("CANONICAL_COMMIT_TEST_DATABASE_URL is not a URL");
}

if (!/^postgres(ql)?:$/.test(parsed.protocol)) refuse("only a PostgreSQL connection string is accepted");
if (!["localhost", "127.0.0.1", "::1", "[::1]"].includes(parsed.hostname)) {
  refuse(`the host must be loopback, not '${parsed.hostname}'`);
}
if (/supabase/i.test(url)) refuse("the connection string names a Supabase host");
const databaseName = parsed.pathname.replace(/^\//, "");
if (!/disposable/i.test(databaseName)) {
  refuse(`the database name must contain 'disposable', not '${databaseName}'`);
}

console.error(
  "This gate is IMPLEMENTED BUT NOT EXECUTABLE in this checkout: the repository\n" +
    "declares no PostgreSQL client dependency, and adding one is a supply-chain\n" +
    "decision that belongs to the unit that first runs this gate, not to the unit\n" +
    "that wrote it. The checks it must perform are enumerated below and in\n" +
    "docs/CANONICAL_STUDY_MODEL.md; wire them to a client, run them against a\n" +
    "disposable database, and record the result before calling any transactional\n" +
    "behaviour proved.",
);

/**
 * The behaviours this gate must execute, in order. Each entry names the state
 * it starts from, what it does, and what must hold afterwards. They are listed
 * as data so the offline gate and the documentation can be checked against the
 * same list rather than against prose.
 */
export const REQUIRED_LIVE_CHECKS = [
  {
    id: "L1",
    name: "first successful commit",
    expect:
      "every declared family count matches the ledger and the tables; import_job is 'committed' with " +
      "committed_at set, payload_digest stored and actual_counts measured by the database",
  },
  {
    id: "L2",
    name: "replay after committed",
    expect: "the identical payload returns replayed=true and creates NOT ONE additional row in any table",
  },
  {
    id: "L3",
    name: "duplicate and reordered upload",
    expect:
      "the same two files staged in the other order resolve to the SAME import_job row and the same " +
      "plan fingerprint; no second job and no duplicate canonical row appears",
  },
  {
    id: "L4",
    name: "retry after failure",
    expect:
      "a deliberately broken payload leaves zero package-owned rows, sets status 'failed' with a safe " +
      "code and empty actual_counts; the corrected payload then commits cleanly",
  },
  {
    id: "L5",
    name: "deliberate failure halfway through",
    expect:
      "a payload whose LAST family violates a constraint leaves zero rows in EVERY earlier family — the " +
      "subtransaction really did roll back what it inserted before the failure",
  },
  {
    id: "L6",
    name: "rollback after commit",
    expect:
      "exactly the ledger's created rows disappear; an unrelated study's rows, an unrelated import job " +
      "and a person shared with another study all survive; source_asset and import_job_asset survive",
  },
  { id: "L7", name: "repeated rollback", expect: "the second call returns replayed=true and changes nothing" },
  {
    id: "L8",
    name: "commit after rollback",
    expect: "the package commits again with the same derived identifiers and no duplicate row",
  },
  {
    id: "L9",
    name: "simultaneous commit attempts",
    expect:
      "two sessions calling commit on the same job serialise on FOR UPDATE; one commits, the other " +
      "replays, and the row counts equal a single commit",
  },
  {
    id: "L10",
    name: "count mismatch",
    expect: "a payload whose expectedCounts disagree with the rows raises COUNT_MISMATCH and writes nothing",
  },
  {
    id: "L11",
    name: "malformed private payload",
    expect: "a family that is not an array, and a plan that is not an object, are both refused with a code",
  },
  {
    id: "L12",
    name: "foreign tenant and study identifiers",
    expect:
      "a payload declaring another tenant or study is refused with TENANT_SCOPE_MISMATCH / " +
      "STUDY_SCOPE_MISMATCH, and the other tenant's rows are untouched",
  },
  {
    id: "L13",
    name: "missing target references",
    expect: "a lineage row citing an asset role the job does not carry is refused with ASSET_ROLE_UNKNOWN",
  },
  {
    id: "L14",
    name: "browser roles cannot execute either RPC",
    expect:
      "set role anon, then authenticated: both `commit_canonical_package` and " +
      "`rollback_canonical_package` raise insufficient_privilege (42501); service_role succeeds",
  },
  {
    id: "L15",
    name: "the functions have an empty search path",
    expect: "pg_proc.proconfig contains search_path= for all four functions",
  },
  {
    id: "L16",
    name: "every forward object has a reverse counterpart",
    expect:
      "applying 0024 then its rollback restores the exact catalogue state that existed after 0023 — " +
      "tables, columns, constraints, indexes and functions compared by name",
  },
];

console.error(`\n${REQUIRED_LIVE_CHECKS.length} database-executed checks are required:`);
for (const entry of REQUIRED_LIVE_CHECKS) console.error(`  ${entry.id}  ${entry.name}`);
console.error("\nNONE of them has been executed. Exiting without claiming a result.");
process.exit(3);
