// =============================================================================
// The HOSTED-TRANSPORT gate — level 3, supabase-js over PostgREST
//   CANONICAL_HOSTED_TARGET_REF=local \
//   CANONICAL_HOSTED_ACKNOWLEDGE=I-AUTHORIZE-MUTATION-OF-local \
//   CANONICAL_HOSTED_SERVICE_KEY=<key> \
//   CANONICAL_HOSTED_DISPOSABLE_PREFIX=U4-LOCAL1 \
//     npm run test:canonical-commit-hosted
// =============================================================================
// This runner executes `scripts/lib/canonical-suite.mjs` — the SAME assertions
// the local gate runs — through the transport the product actually uses. It is
// the only thing that can settle what level 2 structurally cannot: whether
// PostgREST accepts a multi-megabyte RPC body, what a supabase-js error really
// looks like, whether the service-role key path works end to end, and whether a
// commit fits inside the statement timeout the role carries.
//
// -----------------------------------------------------------------------------
// IT MUTATES A REAL DATABASE, SO IT IS BUILT AROUND FIVE RULES
// -----------------------------------------------------------------------------
//   1. THE TARGET IS NAMED, TWICE. `scripts/lib/hosted-target.mjs` accepts
//      exactly one project, and only when a second variable spells out that
//      same project inside a sentence about mutation. There is no default and
//      no `.env` is read, here or there.
//   2. NOTHING PRE-EXISTING IS TOUCHED. A census of all 41 protected tables is
//      taken before and after — counts only, never a row — and any movement is
//      a failure. Every object the run creates carries the run's
//      `U4-XXXXXX` prefix, which is what makes "delete exactly what we made"
//      decidable.
//   3. THE RUN CLEANS UP AFTER ITSELF, ON EVERY PATH. The canonical package is
//      reversed through the product's own rollback, then the run's own tenant,
//      study, jobs and assets are deleted by id. A failure does not skip this.
//   4. EVIDENCE LANDS OUTSIDE THE REPOSITORY, SCANNED FIRST.
//      `scripts/lib/hosted-evidence.mjs` refuses a directory inside the
//      worktree and refuses to write any artifact the secret scanner flags.
//   5. NO CREDENTIAL, RESPONDENT VALUE, WORKBOOK CELL OR PLAN FRAGMENT IS EVER
//      PRINTED OR JOURNALLED. The transport journal can record a name, a size
//      in bytes, an HTTP status, a duration and a code — its field list cannot
//      express an argument or a response body.
//
// IT IS DELIBERATELY OUTSIDE `npm test`. An unexecuted transport test must
// never be counted among the offline results.
// =============================================================================

import { buildSyntheticPackage } from "./lib/canonical-fixtures.mjs";
import { restSuiteTransport, deleteRunObjects } from "./lib/canonical-rest-transport.mjs";
import { SUITES } from "./lib/canonical-suite.mjs";
import { transportSuite } from "./lib/canonical-transport-suite.mjs";
import { assertTransportShape, createLedger } from "./lib/canonical-suite-transport.mjs";
import {
  ARTIFACTS,
  createTransportJournal,
  resolveEvidenceDirectory,
  writeArtifact,
} from "./lib/hosted-evidence.mjs";
import {
  HostedTargetError,
  PROTECTED_TABLES,
  assertProtectedObjectsUnchanged,
  describeTarget,
  resolveHostedTarget,
} from "./lib/hosted-target.mjs";

// ---------------------------------------------------------------------------
// [1] Authorization — refuse before anything else happens, and before any
//     module that could open a connection is asked to do anything.
// ---------------------------------------------------------------------------
let target;
try {
  target = resolveHostedTarget(process.env);
} catch (thrown) {
  if (thrown instanceof HostedTargetError) {
    console.error(`REFUSED: ${thrown.message}`);
    console.error(
      "\nThis gate mutates a real Supabase project, so it runs only against one\n" +
        "that was named explicitly and acknowledged by name. Set:\n" +
        "  CANONICAL_HOSTED_TARGET_REF          'local' or a twenty-letter project ref\n" +
        "  CANONICAL_HOSTED_ACKNOWLEDGE         I-AUTHORIZE-MUTATION-OF-<that ref>\n" +
        "  CANONICAL_HOSTED_SERVICE_KEY         the service key (never logged)\n" +
        "  CANONICAL_HOSTED_DISPOSABLE_PREFIX   U4-XXXXXX, stamped on everything it creates\n" +
        "Optionally CANONICAL_HOSTED_ANON_KEY, which turns on the privilege probes.",
    );
    process.exit(2);
  }
  throw thrown;
}

const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const evidenceDirectory = resolveEvidenceDirectory(process.env, stamp);

console.log("Be Community — canonical commit and rollback gate (HOSTED TRANSPORT)");
console.log("=".repeat(78));
for (const [key, value] of Object.entries(describeTarget(target))) {
  console.log(`  ${key}: ${value}`);
}
console.log(`  evidence: ${evidenceDirectory}`);

// ---------------------------------------------------------------------------
// [2] The run
// ---------------------------------------------------------------------------
const journal = createTransportJournal();
const registry = { tenants: [], studies: [], jobs: [] };
const ledger = createLedger({ label: "rest" });
const observedCodes = new Set();
const transport = assertTransportShape(restSuiteTransport(target, { journal, registry, observedCodes }));

const { cleanBytes, painBytes } = await buildSyntheticPackage();
const context = {
  ledger,
  journal: null, // the REST journal is shape-checked; the suites never read it
  cleanFile: { fileName: "limpios.xlsx", bytes: cleanBytes },
  painFile: { fileName: "curado.xlsx", bytes: painBytes },
  realFiles: null, // synthetic fixtures only; the real workbooks never come here
  observedCodes,
};

let censusBefore = null;
let censusAfter = null;
let cleanup = { attempted: false, removed: null, error: null };
let inventory = null;

/** The four functions migration 0024 adds, probed for presence only. */
const INVENTORY_FUNCTIONS = [
  { name: "record_canonical_rows", rest: { p_import_job_id: null, p_tenant_id: null, p_study_id: null, p_target_table: "person_private", p_ids: [], p_ownership: "created" } },
  { name: "stage_canonical_package", rest: { p_tenant_id: null, p_study_id: null, p_request: {} } },
  { name: "commit_canonical_package", rest: { p_import_job_id: null, p_plan: {} } },
  { name: "rollback_canonical_package", rest: { p_import_job_id: null, p_actor: null } },
];

async function census() {
  const counts = {};
  for (const table of PROTECTED_TABLES) counts[table] = await transport.absolute(table);
  return counts;
}

try {
  // ---- [2a] read-only inventory, before a single write --------------------
  console.log("\n[census] counting every protected object — counts only, no row is read");
  censusBefore = await census();
  await transport.takeBaseline();
  inventory = await transport.inventory(PROTECTED_TABLES, INVENTORY_FUNCTIONS);
  const absentTables = Object.entries(inventory.tables).filter(([, state]) => state !== "present");
  const absentFunctions = Object.entries(inventory.functions).filter(([, state]) => state !== "present");
  console.log(`  ${Object.keys(censusBefore).length} protected tables counted`);
  console.log(`  server: ${inventory.banner ?? "unreported"}`);
  console.log(
    `  objects: ${Object.keys(inventory.tables).length - absentTables.length}/${Object.keys(inventory.tables).length} tables, ` +
      `${Object.keys(inventory.functions).length - absentFunctions.length}/${Object.keys(inventory.functions).length} functions present`,
  );
  ledger.check(
    "H0",
    absentTables.length === 0 && absentFunctions.length === 0,
    `migrations 0022-0024 are applied to this target${
      absentTables.length + absentFunctions.length > 0
        ? ` (missing ${[...absentTables, ...absentFunctions].map(([name]) => name).join(", ")})`
        : ""
    }`,
  );
  writeArtifact(evidenceDirectory, ARTIFACTS[0], {
    stamp,
    target: describeTarget(target),
    protectedTables: PROTECTED_TABLES.length,
    inventory,
    census: censusBefore,
  });

  // ---- [2b] the shared suites, over the hosted transport -------------------
  //
  // The LOCAL gate gives each suite a database of its own, created and dropped
  // around it. A hosted target has exactly one database, so that isolation has
  // to be rebuilt: before each suite the baseline census is re-taken, and after
  // it every object the suite created is reversed and deleted. Without this the
  // suites would read each other's rows through the unfiltered counts, and
  // "study A created no new person" would be measured against study A PLUS
  // whatever the previous suite left behind.
  for (const suite of [...SUITES, { label: "transport", run: transportSuite }]) {
    await transport.takeBaseline();
    try {
      await suite.run(transport, context);
    } finally {
      const swept = await deleteRunObjects(target, registry);
      registry.tenants.length = 0;
      registry.studies.length = 0;
      registry.jobs.length = 0;
      const rows = Object.values(swept).reduce((n, value) => n + (typeof value === "number" ? value : 0), 0);
      console.log(`  [${suite.label}] swept ${rows} row(s) this suite created`);
    }
  }
} catch (thrown) {
  ledger.bad("HARNESS", `the harness itself failed: ${thrown.message}`);
} finally {
  // ---- [2d] cleanup runs on EVERY path, including a failure ---------------
  console.log("\n[cleanup] deleting exactly what this run created");
  cleanup.attempted = true;
  try {
    cleanup.removed = await deleteRunObjects(target, registry);
    for (const [table, rows] of Object.entries(cleanup.removed)) console.log(`  ${table}: ${rows} row(s)`);
  } catch (thrown) {
    cleanup.error = thrown.message;
    ledger.bad("CLEANUP", `the run could not delete what it created: ${thrown.message}`);
  }
}

// ---- [2e] the census must be exactly where it started ---------------------
console.log("\n[census] counting the protected objects again");
try {
  censusAfter = await census();
  assertProtectedObjectsUnchanged(censusBefore, censusAfter);
  ledger.ok("H1", "every pre-existing object is exactly as the run found it");
} catch (thrown) {
  ledger.bad("H1", `the protected-object census moved: ${thrown.message}`);
}

// ---------------------------------------------------------------------------
// [3] Evidence
// ---------------------------------------------------------------------------
writeArtifact(evidenceDirectory, ARTIFACTS[1], { stamp, inventory, census: censusBefore });
writeArtifact(evidenceDirectory, ARTIFACTS[2], { stamp, census: censusAfter });
writeArtifact(evidenceDirectory, ARTIFACTS[3], { stamp, calls: journal.all(), summary: journal.summary() });
writeArtifact(evidenceDirectory, ARTIFACTS[4], {
  stamp,
  transport: transport.kind,
  capabilities: transport.capabilities,
  tally: ledger.tally(),
  results: ledger.results.map(({ id, ok, skipped, capability, message }) => ({
    id,
    ok,
    skipped: skipped ?? false,
    capability: capability ?? null,
    message,
  })),
});
writeArtifact(evidenceDirectory, ARTIFACTS[5], { stamp, cleanup, registry });

// ---------------------------------------------------------------------------
// [4] The verdict
// ---------------------------------------------------------------------------
console.log("\n" + "=".repeat(78));
const tally = ledger.tally();
console.log(
  `Executed ${tally.executed} hosted-transport assertions: ${tally.passed} passed, ` +
    `${tally.failed} failed, ${tally.skipped} skipped (not executed, not counted as passed).`,
);
for (const skipped of ledger.results.filter((r) => r.skipped)) {
  console.log(`  – ${skipped.id} needs '${skipped.capability}': ${skipped.message}`);
}
console.log("\nTransport, in sizes and durations only:");
for (const entry of journal.summary()) {
  console.log(
    `  ${entry.name}: ${entry.calls} call(s), largest body ${entry.maxPayloadBytes} bytes, ` +
      `slowest ${entry.maxWallMs.toFixed(0)} ms`,
  );
}
console.log(`\nEvidence written to ${evidenceDirectory}`);
console.log(
  "NOTE: a green run here proves the HTTP transport and the service-role key path.\n" +
    "      It does not promote the skipped assertions: DDL-injected failure, the\n" +
    "      catalogue comparison and the deterministic race remain level-2 results.",
);
if (tally.failed > 0) {
  console.error("RESULT: the hosted transport contradicts the contract. GATE BLOCKED.");
  process.exit(1);
}
console.log("RESULT: the canonical commit and rollback behave as documented over PostgREST. GATE PASSED.");
