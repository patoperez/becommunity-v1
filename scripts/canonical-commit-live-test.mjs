// =============================================================================
// MANDATORY canonical commit and rollback gate — DATABASE-EXECUTED (level 2)
//   CANONICAL_COMMIT_TEST_PGHOST=/path/to/socket \
//   CANONICAL_COMMIT_TEST_PGUSER=<user> \
//     npx tsx scripts/canonical-commit-live-test.mjs
// =============================================================================
// This gate EXECUTES migration 0024 against a real PostgreSQL server and asserts
// the resulting database state. Nothing here is satisfied by reading SQL text:
// every claim is a query or a mutation against a disposable database that this
// script creates and destroys.
//
// It is deliberately OUTSIDE `npm test`, because a database is not always
// available and an unexecuted database test must never be counted among the
// offline results.
//
// THE ASSERTIONS THEMSELVES LIVE IN `scripts/lib/canonical-suite.mjs`. This file
// is the LOCAL runner: it resolves a disposable target, builds the psql
// transport, and drives the shared suites. `scripts/canonical-commit-hosted-test.mjs`
// is the second runner over the same suites, so the two levels of proof answer
// the same questions rather than merely similar ones.
//
// WHERE IT MAY RUN. Only against a database it created itself, on a loopback
// address or a unix socket, whose name matches
// `becommunity_canonical_test_<suffix>`. `scripts/lib/disposable-postgres.mjs`
// owns those rules; the OFFLINE gate executes them too, so a weakened guard
// fails `npm test` rather than waiting for a run nobody makes. The gate refuses
// outright if the shell carries a configured Supabase project, and it reads no
// `.env` file of any kind.
//
// WHAT IT NEVER PRINTS. A credential, a respondent value, a workbook cell, a
// plan fragment, or the text of a PostgreSQL error. A database message quotes
// the values that violated the constraint, so failures are reported by SQLSTATE
// and by the safe code the migration raised.
//
// The synthetic package comes from `scripts/lib/canonical-fixtures.mjs`, the
// same fixtures the offline gate uses. The real Cuicuilco workbooks are read
// only when their paths are supplied, only to measure the serialization
// boundary, and every byte of that run is deleted with the database.
// =============================================================================

import { readFileSync } from "node:fs";

import {
  DisposableTargetError,
  resolveDisposableTarget,
  withDisposableDatabase,
} from "./lib/disposable-postgres.mjs";
import { buildSyntheticPackage } from "./lib/canonical-fixtures.mjs";
import { psqlSuiteTransport } from "./lib/canonical-psql-transport.mjs";
import { SUITES } from "./lib/canonical-suite.mjs";
import { assertTransportShape, createLedger } from "./lib/canonical-suite-transport.mjs";

// ---------------------------------------------------------------------------
// Target resolution — refuse before anything else happens
// ---------------------------------------------------------------------------
let target;
try {
  target = resolveDisposableTarget(process.env);
} catch (thrown) {
  if (thrown instanceof DisposableTargetError) {
    console.error(`REFUSED: ${thrown.message}`);
    console.error(
      "\nThis gate runs only against a disposable local PostgreSQL server.\n" +
        "Provide CANONICAL_COMMIT_TEST_PGHOST (a loopback host or a unix socket\n" +
        "directory) and CANONICAL_COMMIT_TEST_PGUSER, or an equivalent\n" +
        "CANONICAL_COMMIT_TEST_DATABASE_URL without a password.",
    );
    process.exit(2);
  }
  throw thrown;
}

console.log("Be Community — canonical commit and rollback gate (DATABASE-EXECUTED)");
console.log("=".repeat(78));
console.log(
  `  server: ${target.isSocket ? "unix socket" : "loopback"}  user: ${target.user}  ` +
    `admin db: ${target.adminDatabase}`,
);

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------
const { cleanBytes, painBytes } = await buildSyntheticPackage();
const cleanFile = { fileName: "limpios.xlsx", bytes: cleanBytes };
const painFile = { fileName: "curado.xlsx", bytes: painBytes };

/** The real workbooks, ONLY when both paths are supplied on purpose. */
function realFiles() {
  const cleanPath = process.env.CANONICAL_COMMIT_TEST_CLEAN_XLSX;
  const painPath = process.env.CANONICAL_COMMIT_TEST_PAIN_XLSX;
  if (!cleanPath || !painPath) return null;
  const load = (path) => {
    const buffer = readFileSync(path);
    return {
      fileName: "package.xlsx",
      bytes: buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength),
    };
  };
  return [load(cleanPath), load(painPath)];
}

const REAL_FILES = realFiles();
const ledger = createLedger({ label: "psql" });

async function main() {
  try {
    for (const suite of SUITES) {
      await withDisposableDatabase(target, suite.label, async (db) => {
        const journal = [];
        const transport = assertTransportShape(psqlSuiteTransport(db, journal));
        await suite.run(transport, {
          ledger,
          journal,
          cleanFile,
          painFile,
          realFiles: REAL_FILES,
        });
      });
    }
  } catch (thrown) {
    ledger.bad("HARNESS", `the harness itself failed: ${thrown.message}`);
  }

  console.log("\n" + "=".repeat(78));
  const tally = ledger.tally();
  console.log(
    `Executed ${tally.executed} database assertions: ${tally.passed} passed, ${tally.failed} failed` +
      `${tally.skipped > 0 ? `, ${tally.skipped} skipped (not executed, not counted as passed)` : ""}.`,
  );
  for (const skipped of ledger.results.filter((r) => r.skipped)) {
    console.log(`  – ${skipped.id} needs '${skipped.capability}': ${skipped.message}`);
  }
  if (ledger.timings.length > 0) {
    console.log("\nMeasured, without any content:");
    for (const line of ledger.timings) console.log(`  ${line}`);
  }
  if (tally.failed > 0) {
    console.error("RESULT: the database contradicts the contract. GATE BLOCKED.");
    process.exit(1);
  }
  console.log("RESULT: migration 0024 behaves as documented against a real PostgreSQL. GATE PASSED.");
}

await main();
