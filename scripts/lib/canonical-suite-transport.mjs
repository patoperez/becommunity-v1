// =============================================================================
// The contract every canonical-commit suite transport must satisfy
// =============================================================================
// `scripts/lib/canonical-suite.mjs` holds the assertions. It must not know
// whether it is talking to a local PostgreSQL through `psql` or to a Supabase
// project through PostgREST, because the WHOLE POINT of Unit 4 is to run the
// same assertions over a second transport and compare the answers.
//
// -----------------------------------------------------------------------------
// CAPABILITIES ARE DECLARED, NOT DISCOVERED
// -----------------------------------------------------------------------------
// Some assertions cannot exist over REST — you cannot add a CHECK constraint,
// hold a row lock for three seconds, or read `pg_catalog` through PostgREST.
// The wrong answer is to let those assertions silently disappear: a suite that
// quietly shrinks from 136 executed assertions to 65 and still prints "PASSED"
// is worse than one that fails.
//
// So a transport DECLARES what it can do, the suite CONSULTS that declaration,
// and anything it cannot execute is recorded as SKIPPED with the capability
// that was missing. A skip is never counted as a pass, and the final line
// reports the three numbers separately.
//
// A transport that declares a capability it does not implement fails loudly:
// `assertTransportShape` checks that every method a declared capability
// requires is actually a function, BEFORE a single assertion runs.
// =============================================================================

/** The capability names a transport may declare, and what each one unlocks. */
export const CAPABILITIES = Object.freeze({
  /** Can execute .sql files verbatim: migrations, rollbacks, DDL injection. */
  ddl: ["applySqlFile", "applyMigration", "applyRollback"],
  /** Can read pg_catalog: function ACLs, search paths, RLS flags, snapshots. */
  catalogue: ["catalogueSnapshot", "functionFacts", "tableSecurityFacts", "objectsPresent"],
  /** Can run arbitrary SQL — the escape hatch, used only where nothing else works. */
  rawSql: ["sql", "json"],
  /** Can act as anon / authenticated / service_role and report the SQLSTATE. */
  roleSwitch: ["probeFunctionExecute", "probeTableRead"],
  /** Can run two genuinely overlapping commits against one job. */
  concurrentSessions: ["raceCommit"],
  /** Surfaces the database's own error text (never printed, only matched). */
  rawErrorText: [],
});

/**
 * Methods every transport must have, whatever it declares.
 *
 * `prepare` is here rather than under `ddl` because both transports need an
 * answer to "is the schema ready?" — psql answers it by applying migrations
 * 0000..N verbatim, a hosted transport by verifying the objects exist and
 * refusing if they do not. Neither may skip it.
 */
const REQUIRED = [
  "rpc",
  "count",
  "counts",
  "readJob",
  "createStudy",
  "createStudyInTenant",
  "duplicateParticipations",
  "prepare",
];

export class TransportShapeError extends Error {}

/**
 * Prove the transport is what it says it is, before any assertion runs.
 *
 * This is the check that stops a capability from being declared for
 * convenience: declaring `catalogue` without implementing `functionFacts` is a
 * hard error here rather than a confusing failure sixty assertions later.
 */
export function assertTransportShape(transport) {
  if (!transport || typeof transport !== "object") {
    throw new TransportShapeError("a transport must be an object.");
  }
  if (!transport.capabilities || typeof transport.capabilities !== "object") {
    throw new TransportShapeError("a transport must declare its capabilities.");
  }
  const missing = REQUIRED.filter((name) => typeof transport[name] !== "function");
  if (missing.length > 0) {
    throw new TransportShapeError(`a transport must implement ${missing.join(", ")}.`);
  }
  const unknown = Object.keys(transport.capabilities).filter((name) => !(name in CAPABILITIES));
  if (unknown.length > 0) {
    throw new TransportShapeError(`unknown capability/capabilities: ${unknown.join(", ")}.`);
  }
  for (const [name, methods] of Object.entries(CAPABILITIES)) {
    if (!transport.capabilities[name]) continue;
    const absent = methods.filter((method) => typeof transport[method] !== "function");
    if (absent.length > 0) {
      throw new TransportShapeError(
        `capability '${name}' is declared but ${absent.join(", ")} is not implemented. ` +
          "A capability is a promise the suite relies on.",
      );
    }
  }
  return transport;
}

/**
 * The assertion ledger.
 *
 * PASS, FAIL and SKIP are three separate outcomes. `skip` exists so a transport
 * that cannot execute an assertion says so, in the results, with the capability
 * it lacked — rather than the assertion evaporating.
 */
export function createLedger({ label } = {}) {
  const results = [];
  let failures = 0;
  const ok = (id, message) => {
    console.log(`  ✓ ${id}  ${message}`);
    results.push({ id, ok: true, message });
  };
  const bad = (id, message) => {
    console.error(`  ✗ ${id}  FAIL: ${message}`);
    results.push({ id, ok: false, message });
    failures += 1;
  };
  const skip = (id, capability, message) => {
    console.log(`  – ${id}  SKIPPED (needs '${capability}')  ${message}`);
    results.push({ id, ok: false, skipped: true, capability, message });
  };
  return {
    label,
    results,
    timings: [],
    ok,
    bad,
    skip,
    check: (id, condition, message) => (condition ? ok(id, message) : bad(id, message)),
    /** Run `body` only if the transport declares `capability`; otherwise record skips. */
    needs(transport, capability, ids, message, body) {
      if (transport.capabilities[capability]) return body();
      for (const id of ids) skip(id, capability, message);
      return undefined;
    },
    get failures() {
      return failures;
    },
    tally() {
      const executed = results.filter((r) => !r.skipped);
      return {
        executed: executed.length,
        passed: executed.filter((r) => r.ok).length,
        failed: executed.filter((r) => !r.ok).length,
        skipped: results.filter((r) => r.skipped).length,
      };
    },
  };
}
