// =============================================================================
// Suite A self-test — OFFLINE, credential-free, deterministic.
// =============================================================================
//
//   npm run test:suite-a-selftest      (part of the deterministic `npm test` chain)
//
// Suite A itself is live: it needs the synthetic project, a running app and a
// browser. Its SAFETY properties must not need any of that to be proven, so this
// file exercises them against mock objects:
//
//   [1] result classification — obscurity never counts as a privilege denial
//   [2] must-execute enforcement — an unrecorded roster entry is red
//   [3] fixture ownership — the ledger refuses what it cannot prove it owns
//   [4] exact cleanup ordering — children before parents, newest first
//   [5] forced-failure cleanup — a failing check still reaches exact-id deletion
//   [6] secret-safe output — the shapes Suite A prints carry no secret class
//
// It imports `scripts/suite-a-isolation.mjs` for the real implementations, which
// is safe because that module runs nothing on import. It touches no network and
// reads no credential: every gateway here is a mock.
// =============================================================================

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { scanText } from "./lib/secret-patterns.mjs";
import { createFixtures, stampedPrefix, newFixtureSecret, P6E_STUDY_ID } from "./lib/harness-fixtures.mjs";
import {
  SUITE_A_CHECKS,
  CLASSIFIER_CASES,
  PG,
  classifyPostgrest,
  anonymousReadIsSafe,
  createReporter,
  selfTestClassifier,
} from "./suite-a-isolation.mjs";

/* <detector-vocabulary> */
// Literal test data only. These name the very things Suite A's source must not
// contain, so they would match themselves. The markers are the same ones the
// harness self-test uses: its G10 detectors strip exactly this block before
// scanning, and NOTHING else in this file is exempt - every line of executable
// code above and below is scanned normally.
const FORBIDDEN_IN_SUITE = [
  [/SUPABASE_SERVICE_ROLE_KEY|SUPABASE_SECRET_KEY/, "the suite must not read the privileged credential"],
  [/\bawait\s+\w*[Rr]esponse\.(json|text)\s*\(/, "the suite must not read a response body"],
  [/next-action|\$ACTION_ID|encodeReply\s*\(/, "the suite must not touch the private wire protocol"],
  [/Date\.now\s*=(?!=)|setSystemTime/, "the suite must not manipulate the clock"],
];
/* </detector-vocabulary> */

let passed = 0;
const ok = (message) => { passed += 1; console.log(`  PASS  ${message}`); };

// --- [1] Result classification ----------------------------------------------

console.log("\n[1] Result classification:");
assert.deepEqual(selfTestClassifier(), [], "the fixed classification cases must all hold");
ok(`${CLASSIFIER_CASES.length} classification cases hold`);

assert.equal(classifyPostgrest({ error: { code: "42P01" } }), PG.ABSENT);
assert.equal(anonymousReadIsSafe(PG.ABSENT), false, "an undefined table is not a safe anonymous outcome");
assert.equal(anonymousReadIsSafe(PG.OTHER), false, "an unrelated error is not a safe anonymous outcome");
assert.equal(anonymousReadIsSafe(PG.ROWS), false, "returned rows are never safe");
assert.equal(anonymousReadIsSafe(PG.DENIED), true);
assert.equal(anonymousReadIsSafe(PG.EMPTY), true);
ok("a missing table or an unrelated error can never masquerade as least privilege");

// --- [2] Must-execute enforcement -------------------------------------------

console.log("\n[2] Must-execute enforcement:");
{
  const roster = [{ id: "X1" }, { id: "X2" }];
  const reporter = createReporter(roster);
  reporter.pass("X1", "done");
  const verdict = reporter.verdict();
  assert.equal(verdict.ok, false, "a roster entry that recorded nothing must make the run red");
  assert.deepEqual(verdict.missing, ["X2"]);
  ok("an unexecuted required check is red, never skipped and never passed");

  reporter.pass("X2", "done");
  assert.equal(reporter.verdict().ok, true);
  reporter.runFailure("cleanup left residue");
  const after = reporter.verdict();
  assert.equal(after.ok, false, "a run-level failure must make the run red");
  assert.deepEqual(after.failed, [], "a run-level failure must not be attributed to a security check");
  ok("a run-level failure reds the run without mis-attributing it to a passing check");

  assert.throws(() => reporter.pass("X9", "typo"), /unknown check id/);
  ok("the roster is the contract: an unknown check id throws rather than being counted");
}
{
  const reporter = createReporter(SUITE_A_CHECKS);
  const verdict = reporter.verdict();
  assert.equal(verdict.missing.length, SUITE_A_CHECKS.length);
  assert.equal(verdict.ok, false, "a run that recorded nothing at all must be red");
  const groups = new Set(SUITE_A_CHECKS.map((check) => check.group));
  assert.deepEqual([...groups].sort(), ["A1", "A2", "A3", "A4", "A5"], "every Suite A group must be on the roster");
  ok(`the Suite A roster carries ${SUITE_A_CHECKS.length} required checks across A1-A5, none optional`);
}

// --- mock gateway ------------------------------------------------------------

function mockGateway(objects, { failDeleteOf = new Set(), throwOnRead = new Set() } = {}) {
  const calls = [];
  const store = new Map(objects.map((object) => [`${object.kind}:${object.id}`, object]));
  return {
    calls,
    async countPrefixed(kind, prefix) {
      return [...store.values()].filter(
        (object) => object.kind === kind && String(object.meta?.[kind === "authUser" ? "email" : kind === "clientProfile" ? "full_name" : "name"] ?? "")
          .toLowerCase()
          .startsWith(prefix.toLowerCase()),
      ).length;
    },
    async readMeta(kind, id) {
      if (throwOnRead.has(id)) throw new Error("transport failure");
      return store.get(`${kind}:${id}`)?.meta ?? null;
    },
    async deleteById(kind, id) {
      calls.push(`${kind}:${id}`);
      if (failDeleteOf.has(id)) return { ok: false };
      store.delete(`${kind}:${id}`);
      return { ok: true };
    },
  };
}

const PREFIX = "P7A-20260823T000000Z-abc123";
const HOME_TENANT = "11111111-1111-1111-1111-111111111111";
const OTHER_TENANT = "22222222-2222-2222-2222-222222222222";

// --- [3] Fixture ownership ---------------------------------------------------

console.log("\n[3] Fixture ownership:");
{
  const fixtures = createFixtures({
    prefix: PREFIX,
    gateway: mockGateway([]),
    prefixedKinds: ["clientProfile", "authUser"],
    homeTenantId: HOME_TENANT,
  });
  assert.throws(() => fixtures.track({ kind: "storage_object", id: "x" }), /no ownership validator/);
  ok("a kind with no ownership validator or deletion strategy cannot be tracked");
  assert.throws(() => fixtures.track({ kind: "authUser", id: P6E_STUDY_ID }), /protected object/);
  ok("a protected object can never enter the ledger");
  fixtures.track({ kind: "authUser", id: "u1" });
  assert.throws(() => fixtures.track({ kind: "authUser", id: "u1" }), /already tracked/);
  ok("the same kind and id cannot be ledgered twice");
  fixtures.track({ kind: "clientProfile", id: "u1" });
  assert.equal(fixtures.ledger.length, 2, "a profile and its own Auth identity share one UUID and must both be ledgered");
  ok("a profile and the identity it belongs to are both ledgered, so both are deleted by exact id");
  fixtures.halt();
  assert.throws(() => fixtures.track({ kind: "clientProfile", id: "u1" }), /ledger is closed/);
  ok("once the run is cancelled or cleaned up, nothing further can be tracked");
}
{
  const KINDS = createFixtures({ prefix: PREFIX, gateway: mockGateway([]) }).KINDS;
  const context = { prefix: PREFIX, tenantId: null, homeTenantId: HOME_TENANT };
  assert.equal(KINDS.authUser.owned({ email: `${PREFIX.toLowerCase()}@example.com` }, context), true);
  assert.equal(KINDS.authUser.owned({ email: "someone@real.test" }, context), false);
  assert.equal(
    KINDS.clientProfile.owned({ full_name: `${PREFIX} fixture`, role: "client", tenant_id: HOME_TENANT }, context),
    true,
  );
  assert.equal(
    KINDS.clientProfile.owned({ full_name: `${PREFIX} fixture`, role: "client", tenant_id: OTHER_TENANT }, context),
    false,
    "a profile outside the declared home tenant is not owned by this run",
  );
  assert.equal(
    KINDS.clientProfile.owned({ full_name: "Real Person", role: "client", tenant_id: HOME_TENANT }, context),
    false,
    "an unprefixed profile is never owned, whatever tenant it sits in",
  );
  assert.equal(
    KINDS.clientProfile.owned({ full_name: `${PREFIX} fixture`, role: "internal", tenant_id: HOME_TENANT }, context),
    false,
    "an internal profile is outside this fixture's shape",
  );
  ok("ownership is proven from re-read metadata; prefix alone never authorizes a delete");
}

// --- [4] Exact cleanup ordering ---------------------------------------------

console.log("\n[4] Exact cleanup ordering:");
{
  const objects = [
    { kind: "authUser", id: "u1", meta: { id: "u1", email: `${PREFIX.toLowerCase()}@example.com` } },
    { kind: "clientProfile", id: "u1", meta: { user_id: "u1", full_name: `${PREFIX} fixture`, role: "client", tenant_id: HOME_TENANT } },
  ];
  const gateway = mockGateway(objects);
  const fixtures = createFixtures({
    prefix: PREFIX,
    gateway,
    prefixedKinds: ["clientProfile", "authUser"],
    homeTenantId: HOME_TENANT,
  });
  fixtures.track({ kind: "authUser", id: "u1" });
  fixtures.track({ kind: "clientProfile", id: "u1" });
  assert.deepEqual(fixtures.deletionOrder().map((entry) => entry.kind), ["clientProfile", "authUser"]);
  const result = await fixtures.cleanup();
  assert.deepEqual(gateway.calls, ["clientProfile:u1", "authUser:u1"], "the profile is removed before its identity");
  assert.equal(result.removed, 2);
  assert.equal(result.clean, true);
  assert.deepEqual(result.residual, { clientProfile: 0, authUser: 0 });
  ok("cleanup removes exactly the ledgered ids, children before parents, and re-counts residue to zero");
}
{
  // An id the run does not genuinely own must survive cleanup untouched.
  const gateway = mockGateway([
    { kind: "clientProfile", id: "real", meta: { user_id: "real", full_name: "Real Person", role: "client", tenant_id: HOME_TENANT } },
  ]);
  const fixtures = createFixtures({
    prefix: PREFIX,
    gateway,
    prefixedKinds: ["clientProfile", "authUser"],
    homeTenantId: HOME_TENANT,
  });
  fixtures.track({ kind: "clientProfile", id: "real" });
  const result = await fixtures.cleanup();
  assert.deepEqual(gateway.calls, [], "no delete may be issued for an object ownership could not prove");
  assert.equal(result.removed, 0);
  assert.equal(result.clean, false, "a refusal must make the run red rather than pass quietly");
  ok("an id captured wrongly is refused, not deleted, and the run goes red");
}

// --- [5] Forced-failure cleanup ---------------------------------------------

console.log("\n[5] Forced-failure cleanup:");
{
  const gateway = mockGateway([
    { kind: "authUser", id: "u1", meta: { id: "u1", email: `${PREFIX.toLowerCase()}@example.com` } },
    { kind: "clientProfile", id: "u1", meta: { user_id: "u1", full_name: `${PREFIX} fixture`, role: "client", tenant_id: HOME_TENANT } },
  ]);
  const fixtures = createFixtures({
    prefix: PREFIX,
    gateway,
    prefixedKinds: ["clientProfile", "authUser"],
    homeTenantId: HOME_TENANT,
  });
  const reporter = createReporter(SUITE_A_CHECKS);
  let reached = false;
  try {
    fixtures.track({ kind: "authUser", id: "u1" });
    fixtures.track({ kind: "clientProfile", id: "u1" });
    reporter.fail("A2.2", "forced failure");
    throw new Error("forced failure mid-run");
  } catch (error) {
    reporter.runFailure(error.message);
  } finally {
    reached = true;
    const result = await fixtures.cleanup();
    assert.equal(result.clean, true, "a failing run must still reach exact-id cleanup");
    assert.deepEqual(gateway.calls, ["clientProfile:u1", "authUser:u1"]);
  }
  assert.equal(reached, true);
  assert.equal(reporter.verdict().ok, false);
  ok("a forced mid-run failure still reaches cleanup, and the run is still reported red");
}
{
  // A delete that fails must be surfaced, never swallowed.
  const gateway = mockGateway(
    [{ kind: "authUser", id: "u1", meta: { id: "u1", email: `${PREFIX.toLowerCase()}@example.com` } }],
    { failDeleteOf: new Set(["u1"]) },
  );
  const fixtures = createFixtures({ prefix: PREFIX, gateway, prefixedKinds: ["authUser"], homeTenantId: HOME_TENANT });
  fixtures.track({ kind: "authUser", id: "u1" });
  const result = await fixtures.cleanup();
  assert.equal(result.clean, false);
  assert.equal(result.leaked.length, 1, "a failed delete is reported as leaked residue");
  ok("a delete that fails is reported as residue, never silently accepted");
}

// --- [6] Secret-safe output --------------------------------------------------

console.log("\n[6] Secret-safe output:");
{
  const prefix = stampedPrefix("P7A");
  assert.match(prefix, /^P7A-\d{8}T\d{6}Z-[a-z0-9]{6}$/, "the Suite A prefix must be distinguishable from PR 5's P7H-");
  assert.ok(!prefix.startsWith("P7H-"), "Suite A must never mint PR 5's self-test prefix");
  const secret = newFixtureSecret();
  assert.ok(secret.length >= 32, "the fixture password must come from the runtime's random source");
  ok("the run prefix is P7A-namespaced and the fixture password is random and never derived");

  // The transcript shapes Suite A actually prints must carry no secret class.
  const sample = [
    `  run prefix: ${prefix}  (ownership namespace, never a deletion key)`,
    `  PASS A1.1  14 surfaces closed to anonymous — 9 denied by privilege, 5 empty by RLS`,
    `  PASS A2.2  the scoped client sees 1/2 option(s) and 10/20 response units`,
    `  PASS A2.3  out-of-scope rejected 400`,
    `  PASS A5.2  the composite FK rejected the mismatched stamp (23503); import_batch 1 -> 1`,
    `       ledgered authUser 3f1b0c2e-0000-4000-8000-000000000000`,
    `  FAIL RUN   fixture cleanup left residue: {"clientProfile":1,"authUser":1}`,
  ].join("\n");
  assert.deepEqual(scanText(sample), [], "Suite A's own output shapes must not match any secret class");
  ok("the shapes Suite A prints pass the secret scan with zero matches");
}
{
  // The suite source itself must not name the privileged credential: the
  // fixtures module is the single permitted holder of it.
  const source = readFileSync("scripts/suite-a-isolation.mjs", "utf8");
  for (const [pattern, why] of FORBIDDEN_IN_SUITE) assert.ok(!pattern.test(source), why);
  ok("the suite reads no privileged credential, no response body, no private wire payload and no clock");
}

// --- [7] Canonical gate wiring ----------------------------------------------
//
// README.md and CLAUDE.md call `npm run gates` the complete release chain. That
// is only true if the chain actually executes Suite A. Suite A already runs
// isolation-test.mjs (A1.5) and rls-coverage-test.mjs (A4.1) as child processes,
// so chaining those separately after it would duplicate two of its sixteen
// checks while still omitting the other fourteen. These assertions pin the
// shape rather than the prose.

console.log("\n[7] Canonical gate wiring:");
{
  const pkg = JSON.parse(readFileSync("package.json", "utf8"));
  const scripts = pkg.scripts ?? {};
  const occurrences = (haystack, needle) => haystack.split(needle).length - 1;

  const live = scripts["gates:live"] ?? "";
  assert.equal(occurrences(live, "run suite:a"), 1, "gates:live must run suite:a exactly once");
  ok("gates:live executes the complete Suite A exactly once");

  assert.equal(occurrences(live, "run test:isolation"), 0, "gates:live must not chain test:isolation separately");
  assert.equal(occurrences(live, "run test:rls-coverage"), 0, "gates:live must not chain test:rls-coverage separately");
  ok("gates:live does not separately re-run the two children Suite A already executes");

  for (const name of ["test:isolation", "test:rls-coverage", "suite:a"]) {
    assert.ok(scripts[name], `${name} must remain independently runnable`);
  }
  assert.match(scripts["test:isolation"], /scripts\/isolation-test\.mjs/);
  assert.match(scripts["test:rls-coverage"], /scripts\/rls-coverage-test\.mjs/);
  ok("test:isolation and test:rls-coverage remain independently runnable standalone scripts");

  const gates = scripts.gates ?? "";
  assert.match(gates, /run gates:offline/, "gates must compose gates:offline");
  assert.match(gates, /run gates:live/, "gates must compose gates:live");
  assert.ok(gates.indexOf("gates:offline") < gates.indexOf("gates:live"), "offline runs before live");
  ok("gates still composes gates:offline then gates:live");

  // The offline chain must stay credentials-free: Suite A is live, so it must
  // not appear there, and CI must run the offline chain and nothing else.
  const offline = scripts["gates:offline"] ?? "";
  assert.equal(occurrences(offline, "suite:a"), 0, "gates:offline must stay credentials-free");
  const ci = readFileSync(".github/workflows/ci.yml", "utf8");
  assert.match(ci, /npm run gates:offline/, "CI must run the offline chain");
  assert.ok(!/run:.*npm run gates:live/.test(ci), "CI must never execute gates:live");
  for (const name of ["TEST_USER_A_PASSWORD", "TEST_INTERNAL_PASSWORD", "SUPABASE_SERVICE_ROLE_KEY: "]) {
    assert.ok(!ci.includes(name), `CI must receive no live credential (${name})`);
  }
  ok("gates:offline stays credentials-free; CI runs only gates:offline and receives no live credential");
}

// --- [N] A2.2 drives the filter by its frozen aria-label, not visible text ---
//
// A2.2 is the check that proves the profile data scope is re-derived ON THE
// SERVER for every data request, by driving the study's own filter control and
// requiring the returned view to stay scope-limited. It once located that
// control with `changeSelectByLabel`, which searches VISIBLE <label> text — and
// P8 humanised that text ("genero" -> "Genero"), so the driver returned
// `no-control` and a passing product reported as a failing gate.
//
// The control's `aria-label` is the frozen contract: `StudyCard.tsx` builds it
// from the raw dimension key. This pins the driver to it, so the regression
// cannot come back quietly.
{
  console.log("\n[A2.2 driver] the scope probe uses the frozen aria-label mechanism:");
  const suite = readFileSync("scripts/suite-a-isolation.mjs", "utf8");
  const browser = readFileSync("scripts/lib/harness-browser.mjs", "utf8");
  const card = readFileSync("src/app/dashboard/StudyCard.tsx", "utf8");

  assert.match(
    suite,
    /PAGE\.changeSelectByAriaLabel\(\s*`Filtrar por \$\{ORTHOGONAL_DIMENSION\}`/,
    "A2.2 must drive the filter through changeSelectByAriaLabel with the frozen prefix",
  );
  // The CALL SITE specifically: the explanatory comment above it names the
  // retired helper on purpose, so counting the bare identifier would match the
  // very sentence that records why it was retired.
  assert.equal(
    suite.split("PAGE.changeSelectByLabel(").length - 1, 0,
    "A2.2 must not fall back to the visible-label helper, which P8's humanised copy defeats",
  );
  assert.match(browser, /changeSelectByAriaLabel: \(prefix\) =>/, "the aria-label helper must exist");
  assert.match(
    browser,
    /getAttribute\('aria-label'\) \|\| ''\)\.startsWith/,
    "and it must match on the aria-label, by prefix",
  );

  // The product side of the contract: the aria-label is built from the RAW key,
  // which is why the frozen prefix works and why humanising the visible label
  // is not a product defect.
  assert.match(
    card,
    /aria-label=\{`Filtrar por \$\{label\(option\.key\)\}`\}/,
    "StudyCard must keep the raw-key aria-label the suite depends on",
  );
  assert.match(card, /function label\(value: string\) \{ return value\.replace\(\/_\/g, " "\); \}/,
    "and `label` must stay the raw-key transform, not the humanised one");
  assert.match(card, /\{characteristicLabel\(option\.key\)\}/,
    "while the VISIBLE label stays humanised for the reader");

  // The check itself must still be a real probe, not a softened one.
  assert.match(suite, /if \(driven !== "ok"\) return fail\("A2\.2"/,
    "an undrivable control must still fail A2.2, never be skipped");
  assert.match(suite, /after\.includesProbe \|\| after\.optionCount !== scoped\.view\.optionCount/,
    "A2.2 must still require the scoped shape to hold after the real data action");
  ok("A2.2 drives the frozen aria-label, still fails closed, and the product contract it relies on is pinned");
}

console.log(`\nSuite A offline self-test: ${passed} checks passed.`);
