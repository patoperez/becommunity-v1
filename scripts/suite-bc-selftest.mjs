// =============================================================================
// Suites B and C self-test — OFFLINE, credential-free, deterministic.
// =============================================================================
//
//   npm run test:suite-bc-selftest    (part of the deterministic `npm test` chain)
//
// Suites B and C are live: they need the synthetic project, a running app and a
// browser. Their SAFETY properties must not need any of that to be proven, so
// this file exercises them against mock objects and pure functions:
//
//   [1]  complete must-execute rosters, generated from the frozen catalogue
//   [2]  outcome classification — a success, an absence or a validation
//        rejection can never satisfy a denial
//   [3]  pre-dispatch refusal — an unsupported or protected operation reaches
//        no browser context, no navigation, no request and no ledger entry
//   [4]  exact allowed-path and supported-operation changes, each paired with
//        a neighbouring negative case
//   [5]  fixture ownership, the protected-object deny-list, cancellation
//        settlement, cleanup order and cleanup failure behaviour
//   [6]  response and output sanitization: the no-secret, no-payload contract
//   [7]  package-script composition: `test:pivot` in the deterministic chain,
//        Suites B and C exactly once in `gates:live`, no live credential in CI
//   [8]  REVERSAL — every new assertion is shown to FAIL when the protection it
//        guards is removed or weakened
//
// It imports the suites for their real implementations, which is safe because
// neither module runs anything on import. It touches no network and reads no
// credential: every gateway here is a mock.
// =============================================================================

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { scanText } from "./lib/secret-patterns.mjs";
import {
  createFixtures,
  P6E_STUDY_ID,
  SAFE_NONEXISTENT_ID,
  KINDS,
} from "./lib/harness-fixtures.mjs";
import {
  OPERATIONS,
  FORGEABLE_HEADERS,
  createHarness,
  operationSupport,
  supportedMutations,
  classify,
} from "./lib/http-harness.mjs";
import { PAGE, hasBrowserDriver, BROWSER_DRIVERS } from "./lib/harness-browser.mjs";
import {
  inspectHttpResponse,
  selfTestInspector,
  INSPECTION_KINDS,
} from "./lib/response-inspect.mjs";
import {
  SUITE_B_CHECKS,
  MUTATING_OPERATIONS,
  ACTION_GATE_WITHHELD,
  actionGateIsObservable,
  DENIED_PATHS_ONLY,
  isDenial,
  outcomeSatisfies,
  selfTestOutcomes,
  OUTCOME_CASES,
  createReporter,
} from "./suite-b-authorization.mjs";
import {
  SUITE_C_CHECKS,
  INJECTION_STRINGS,
  buildXssPayload,
  injectionResponseIsSafe,
  xssObservationIsInert,
  selfTestInjectionClassifier,
  selfTestXssClassifier,
  selfTestRefusalClassifier,
  uploadRefusalIsAcceptable,
  REFUSAL_CASES,
} from "./suite-c-input.mjs";

/* <detector-vocabulary> */
// Literal test data only. These name the very things the suite sources must not
// contain, so they would match themselves. The harness self-test's G10 detectors
// strip exactly this block before scanning; NOTHING else in this file is exempt.
const FORBIDDEN_IN_SUITE = [
  [/SUPABASE_SERVICE_ROLE_KEY|SUPABASE_SECRET_KEY/, "a suite must not read the privileged credential"],
  [/\bawait\s+\w*[Rr]esponse\.(json|text)\s*\(/, "a suite must not read a response body itself"],
  [/next-action|\$ACTION_ID|encodeReply\s*\(/, "a suite must not touch the private wire protocol"],
  [/Date\.now\s*=(?!=)|setSystemTime/, "a suite must not manipulate the clock"],
];
// The inspector is the ONE module allowed to read a body, and only under the
// shape asserted in section [6].
const INSPECTOR_FILE = "scripts/lib/response-inspect.mjs";
/* </detector-vocabulary> */

let passed = 0;
const ok = (message) => { passed += 1; console.log(`  PASS  ${message}`); };

// --- [1] Complete, generated rosters ----------------------------------------

console.log("\n[1] Must-execute rosters, generated from the frozen catalogue:");
{
  const catalogueMutations = Object.values(OPERATIONS).filter((op) => op.mutating).map((op) => op.name);
  assert.deepEqual([...MUTATING_OPERATIONS], catalogueMutations, "the B roster must be derived from the catalogue");
  assert.ok(catalogueMutations.length >= 18, "the catalogue must still carry the inventoried mutation surface");
  ok(`${catalogueMutations.length} catalogued mutations drive the Suite B roster; none is hand-listed`);

  for (const group of ["B1", "B2"]) {
    for (const name of [...MUTATING_OPERATIONS, "report.download"]) {
      assert.ok(
        SUITE_B_CHECKS.some((check) => check.id === `${group}/${name}`),
        `${group} must carry a required check for ${name}`,
      );
    }
  }
  ok(`B1 and B2 each carry one required check per mutation plus the report route (${SUITE_B_CHECKS.length} total)`);

  const groups = new Set(SUITE_B_CHECKS.map((check) => check.group));
  assert.deepEqual([...groups].sort(), ["B1", "B2", "B3", "B4", "B5", "B6", "B7"]);
  const cGroups = new Set(SUITE_C_CHECKS.map((check) => check.group));
  assert.deepEqual([...cGroups].sort(), ["C1", "C2", "C3", "C4", "C5"]);
  ok("every Suite B and Suite C group is represented; none is optional");

  // A roster that recorded nothing is red, and an unknown id throws.
  const reporter = createReporter(SUITE_B_CHECKS);
  assert.equal(reporter.verdict().ok, false, "a run that recorded nothing must be red");
  assert.equal(reporter.verdict().missing.length, SUITE_B_CHECKS.length);
  assert.throws(() => reporter.pass("B9/nope", "typo"), /unknown check id/);
  ok("an unexecuted required check is red, and the roster is the contract for check ids");

  // Every withheld action-level probe names a real operation and a reason.
  for (const [name, reason] of Object.entries(ACTION_GATE_WITHHELD)) {
    assert.ok(OPERATIONS[name], `${name} must be a catalogue operation`);
    assert.ok(reason.length > 20, `${name} must carry a stated reason, not a shrug`);
  }
  ok(`${Object.keys(ACTION_GATE_WITHHELD).length} withheld action-level probes each name an operation and a reason`);

  // Denial-only operations are exactly the ones whose success cannot be undone.
  assert.deepEqual(
    [...DENIED_PATHS_ONLY].sort(),
    ["clients.deleteClientUser", "clients.inviteClientUser", "clients.updateClientUser", "clients.updateTenantBrand"],
    "the denial-only set must stay exactly the operations whose success this run cannot undo",
  );
  ok("the denial-only set is exactly the four operations whose success creates an Auth identity, a message or a Storage object");

  // The gate model. B1 asserts a denial at whichever gate genuinely answered;
  // the ACTION-level probe runs only where the application produces something
  // observable. Pinning this offline stops it from quietly widening into a
  // claim the run cannot actually support.
  const observable = MUTATING_OPERATIONS.filter((name) => actionGateIsObservable(OPERATIONS[name]));
  assert.deepEqual(observable, ["clients.createTenant"], "only a natively-submitting form yields an observable action-gate denial");
  for (const name of observable) {
    assert.equal(OPERATIONS[name].mechanism, "form", "an observable action gate requires the frozen `form` mechanism");
    assert.ok(OPERATIONS[name].degradationVerifiedAt, "and that mechanism must rest on a recorded discovery run");
  }
  for (const name of Object.keys(ACTION_GATE_WITHHELD)) {
    assert.equal(actionGateIsObservable(OPERATIONS[name]), false, `${name} must never be action-probed`);
  }
  ok("the action-level probe runs only on the natively-submitting form, and never on a withheld operation");
}

// --- [2] Outcome classification ---------------------------------------------

console.log("\n[2] Outcome classification:");
{
  assert.deepEqual(selfTestOutcomes(), [], "the Suite B outcome cases must all hold");
  ok(`${OUTCOME_CASES.length} outcome cases hold`);

  assert.equal(outcomeSatisfies("denied", "success"), false, "a success can never satisfy a denial");
  assert.equal(outcomeSatisfies("denied", "not_found"), false, "an absence can never satisfy a denial");
  assert.equal(outcomeSatisfies("denied", "validation_rejected"), false, "a validation rejection is not a denial");
  assert.equal(outcomeSatisfies("denied", "unclassified"), false, "an unknown answer satisfies nothing");
  assert.equal(outcomeSatisfies("denied", "page_crash"), false, "a crash is never a denial");
  assert.equal(isDenial("denied_action_result"), true);
  assert.equal(isDenial("not_found"), false);
  ok("a 404 absence, a 400 validation rejection and an authorization denial stay distinct");

  // The harness classifier keeps the app's own 200 wrong-role page apart from
  // an action result, which is what makes `/admin/upload` (AM4) reportable.
  assert.equal(classify({ status: 200, domSignal: "denied_role" }), "denied_wrong_role");
  assert.equal(classify({ status: 200, domSignal: "denial" }), "denied_action_result");
  assert.equal(classify({ status: 200, domSignal: "none" }), "unclassified");
  assert.equal(classify({ status: 500 }), "page_crash");
  ok("the app's HTTP-200 wrong-role page is a role denial, and silence is unclassified, never success");

  assert.deepEqual(selfTestInjectionClassifier(), []);
  assert.deepEqual(selfTestXssClassifier(), []);
  assert.deepEqual(selfTestInspector(), []);
  assert.deepEqual(selfTestRefusalClassifier(), []);
  ok(`the Suite C injection, XSS, leak and refusal classifiers all hold (${REFUSAL_CASES.length} refusal cases)`);

  // Suite C carries exactly ONE deliberate leniency: an over-limit upload that
  // the product refuses without rendering any message. Its reach is pinned here
  // so it can never widen into "an unclassified answer is fine".
  assert.equal(uploadRefusalIsAcceptable("unclassified", false).acceptable, false, "silence is never acceptable by default");
  assert.equal(uploadRefusalIsAcceptable("unclassified", true).acceptable, true, "and only where a check opts in");
  assert.equal(uploadRefusalIsAcceptable("unclassified", true).rendered, false, "an opted-in silence is never reported as rendered");
  for (const category of ["success", "page_crash", "network_failure", "not_found", "denied_wrong_role"]) {
    assert.equal(
      uploadRefusalIsAcceptable(category, true).acceptable,
      false,
      `${category} must never be accepted as an upload refusal, opt-in or not`,
    );
  }
  ok("the one upload leniency reaches exactly `unclassified` on an opted-in check, and nothing else");

  assert.equal(injectionResponseIsSafe({ status: 500, leakClasses: [], secretClasses: [] }).safe, false);
  assert.equal(
    injectionResponseIsSafe({ status: 400, leakClasses: [], secretClasses: [], activeMarkup: true, contentTypeClass: "html", nosniff: true }).safe,
    false,
    "hostile markup echoed as HTML is never safe",
  );
  assert.equal(
    injectionResponseIsSafe({ status: 400, leakClasses: [], secretClasses: [], activeMarkup: true, contentTypeClass: "json", nosniff: false }).safe,
    false,
    "an echo without nosniff is never safe",
  );
  assert.equal(xssObservationIsInert({ executed: false, executableNodes: 0, inlineHandlers: 0, literalPresent: false }).inert, false);
  ok("a 5xx, an HTML echo, a missing nosniff and a never-rendered payload all fail rather than pass quietly");
}

// --- [3] Pre-dispatch refusal, with zero side effects ------------------------

console.log("\n[3] Pre-dispatch refusal (offline spies, no browser, no network):");
{
  const calls = { contexts: 0, navigations: 0, fetches: 0, authorize: 0, track: 0, drivers: 0 };
  const spyFixtures = {
    prefix: "P7B-TEST-spy",
    ledger: [],
    authorizeMutation: () => { calls.authorize += 1; },
    track: () => { calls.track += 1; },
    preflight: async () => ({}),
    cleanup: async () => ({ clean: true, removed: 0, leaked: [], residual: {} }),
    halt: () => {},
    tenantId: () => null,
  };
  const spyBrowser = {
    port: 0,
    binary: "spy",
    createContext: async () => {
      calls.contexts += 1;
      return {
        navigate: async () => { calls.navigations += 1; return "/"; },
        evaluate: async () => null,
        location: async () => "/",
        waitForDom: async () => true,
        submitAndWait: async () => "/",
        cookies: async () => [],
        clearCookies: async () => {},
        setCookies: async () => {},
        setFileInput: async () => "ok",
        dispose: async () => {},
        browserContextId: "spy",
      };
    },
    close: async () => {},
  };

  const realFetch = globalThis.fetch;
  globalThis.fetch = async (...args) => { calls.fetches += 1; return realFetch(...args); };

  let harness;
  try {
    harness = await createHarness({
      origin: "http://127.0.0.1:1",
      actors: ["internal"],
      browser: "required",
      fixtures: spyFixtures,
      credentials: { internal: { email: "spy@example.invalid", password: "unused", role: "internal" } },
      supabase: { url: "http://127.0.0.1:1", anonKey: "unused" },
      launchBrowser: async () => spyBrowser,
      PAGE,
    });

    // (a) An imperative operation with no reviewed driver. Constructed here
    //     rather than taken from the catalogue, precisely because every
    //     catalogued imperative operation now HAS a reviewed driver — the
    //     guard must still refuse an undriven one.
    const undriven = {
      name: "upload.notImplementedYet",
      urlClass: "/admin/upload",
      page: "/admin/upload",
      mechanism: "browser",
      imperative: true,
      mutating: true,
      creates: ["study"],
    };
    assert.equal(hasBrowserDriver(undriven.name), false);
    await assert.rejects(
      () => harness.run("internal", undriven, {}),
      (error) => error.code === "UNSUPPORTED_OPERATION",
      "an imperative operation with no reviewed driver must be refused before dispatch",
    );

    // (b) A form operation with no declared outcome contract.
    const uncontracted = {
      name: "clients.noContract",
      urlClass: "/admin/clients",
      page: "/admin/clients",
      mechanism: "browser",
      mutating: true,
      creates: ["tenant"],
      submitLabel: "Guardar",
    };
    await assert.rejects(
      () => harness.run("internal", uncontracted, {}),
      (error) => error.code === "UNSUPPORTED_OPERATION",
      "an operation with no declared outcome contract must be refused before dispatch",
    );

    // (c) A mutating operation with no ownership metadata at all.
    const unowned = { name: "x.unowned", urlClass: "/x", mechanism: "http", path: "/x", mutating: true };
    assert.equal(operationSupport(unowned).supported, false);
    await assert.rejects(() => harness.run("internal", unowned, {}), (error) => error.code === "UNSUPPORTED_OPERATION");

    // (a)-(c) are refused by the STATIC capability guard, before the harness
    // consults the fixture ledger at all. Nothing may have happened yet.
    assert.deepEqual(
      calls,
      { contexts: 0, navigations: 0, fetches: 0, authorize: 0, track: 0, drivers: 0 },
      "an unsupported operation must be refused before even the ownership check runs",
    );

    // (d) A query on an operation that never declared `acceptsQuery`.
    await assert.rejects(
      () => harness.run("internal", OPERATIONS["page.dashboard"], { query: [["a", "b"]] }),
      /does not declare acceptsQuery/,
    );

    // (e) A forged header on an operation that never declared it.
    await assert.rejects(
      () => harness.run("internal", OPERATIONS["health.get"], { headers: { "x-role": "internal" } }),
      /does not declare acceptsForgedHeaders/,
    );

    // (f) A header outside the reviewed list, even on an operation that does.
    for (const name of ["cookie", "authorization", "apikey"]) {
      await assert.rejects(
        () => harness.run("internal", OPERATIONS["page.adminStudies"], { headers: { [name]: "x" } }),
        /not on the reviewed list/,
        `${name} must never be forgeable — that would be impersonation, not tampering`,
      );
    }

    // (g) `endSessionAfterLoad` on an ordinary HTTP operation is a caller error.
    await assert.rejects(
      () => harness.run("internal", OPERATIONS["page.adminStudies"], {}, { endSessionAfterLoad: true }),
      /meaningless for the http operation/,
    );

    // (h) An operation that is not declared inspectable may not have its body read.
    await assert.rejects(
      () => harness.inspect("internal", OPERATIONS["page.dashboard"], {}, { expect: "text" }),
      (error) => error.code === "NOT_INSPECTABLE",
      "only a declared-inspectable ordinary route handler may be inspected",
    );

    await harness.close();
  } finally {
    globalThis.fetch = realFetch;
  }

  // (d)-(h) are ordinary, non-mutating operations refused for a DIFFERENT
  // reason — an undeclared query, an undeclared or credential-bearing header,
  // a meaningless option, an undeclared inspection. They legitimately reach the
  // ledger's no-op ownership check for a non-mutating operation, and must still
  // never open a context, navigate, issue a request or ledger anything.
  assert.equal(calls.contexts, 0, "no browser context may be created by a refused operation");
  assert.equal(calls.navigations, 0, "no navigation may occur");
  assert.equal(calls.fetches, 0, "no request may leave the process");
  assert.equal(calls.track, 0, "nothing may be ledgered");
  assert.equal(calls.drivers, 0, "no browser driver may run");
  ok("9 refusal classes all fail before dispatch, with zero contexts, navigations, requests and ledger entries");
}

// --- [4] Exact allowed changes, each with a neighbouring negative -------------

console.log("\n[4] Exact allowed paths and supported operations:");
{
  // The supported mutation surface is now the whole catalogue, which is the
  // point of Suites B and C — but every entry must still declare ownership.
  const supported = supportedMutations();
  assert.deepEqual([...supported].sort(), [...MUTATING_OPERATIONS].sort(), "every catalogued mutation must be executable");
  for (const name of supported) {
    const op = OPERATIONS[name];
    const declared =
      op.deniedPathsOnly === true ||
      (op.creates?.length ?? 0) > 0 ||
      (op.scopeParams?.length ?? 0) > 0 ||
      (op.targetParams?.length ?? 0) > 0;
    assert.ok(declared, `${name} must declare how ownership is proven`);
  }
  ok(`all ${supported.length} catalogued mutations are executable and each declares ownership metadata`);

  // The forgeable-header list is exact, and the credential-bearing headers are
  // absent by construction rather than by convention.
  for (const name of ["cookie", "authorization", "apikey", "x-supabase-auth"]) {
    assert.ok(!FORGEABLE_HEADERS.has(name), `${name} must never be forgeable`);
  }
  for (const name of ["x-middleware-subrequest", "x-role", "x-forwarded-host"]) {
    assert.ok(FORGEABLE_HEADERS.has(name), `${name} is a reviewed tampering probe`);
  }
  ok(`${FORGEABLE_HEADERS.size} forgeable headers, none of which carries a credential`);

  // Only `report.download` may be inspected, and only as an ordinary GET.
  const inspectable = Object.values(OPERATIONS).filter((op) => op.inspectable).map((op) => op.name);
  assert.deepEqual(inspectable, ["report.download"], "exactly one operation may have its body inspected");
  assert.equal(OPERATIONS["report.download"].mechanism, "http");
  ok("exactly one operation is inspectable, and it is an ordinary HTTP route handler");

  // Reviewed browser drivers: the exact set, with a neighbouring negative.
  assert.deepEqual(
    Object.keys(BROWSER_DRIVERS).sort(),
    ["dashboard.pivot", "dashboard.refresh", "upload.analyze", "upload.confirm", "upload.preview", "upload.rollback"],
    "the reviewed driver set is exact",
  );
  assert.equal(hasBrowserDriver("upload.somethingElse"), false);
  ok("6 reviewed browser drivers exist, and an unreviewed name still has none");

  // Mechanisms stay frozen: `form` only where a discovery run was recorded.
  for (const op of Object.values(OPERATIONS)) {
    if (op.mechanism === "form") {
      assert.ok(op.degradationVerifiedAt, `${op.name} is frozen as 'form' without a recorded discovery run`);
    }
    assert.ok(["http", "form", "browser"].includes(op.mechanism), `${op.name} carries an unknown mechanism`);
    assert.ok(!("fallback" in op) && !("demoted" in op), `${op.name} must carry no fallback or demotion field`);
  }
  assert.ok(Object.isFrozen(OPERATIONS), "the catalogue must be frozen");
  ok("every mechanism is frozen; `form` appears only with a recorded discovery run; no fallback or demotion field exists");
}

// --- [5] Fixtures: ownership, deny-list, order, cancellation, failure --------

const PREFIX = "P7B-20260823T000000Z-abc123";
const RUN_TENANT = "11111111-1111-1111-1111-111111111111";
const OTHER_TENANT = "22222222-2222-2222-2222-222222222222";
const RUN_STUDY = "33333333-3333-3333-3333-333333333333";

function mockGateway(objects, { failDeleteOf = new Set(), throwOnRead = new Set() } = {}) {
  const calls = [];
  const store = new Map(objects.map((object) => [`${object.kind}:${object.id}`, object]));
  const prefixColumn = (kind) => KINDS[kind].prefixColumn;
  return {
    calls,
    async countPrefixed(kind, prefix) {
      return [...store.values()].filter(
        (object) => object.kind === kind &&
          String(object.meta?.[prefixColumn(kind)] ?? "").toLowerCase().startsWith(prefix.toLowerCase()),
      ).length;
    },
    async countWhere() { return 0; },
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

console.log("\n[5] Fixture ownership, deny-list, ordering and cancellation:");
{
  const fixtures = createFixtures({
    prefix: PREFIX,
    protectedTenantIds: [OTHER_TENANT],
    gateway: mockGateway([]),
    prefixedKinds: ["tenant", "study", "studyTemplate", "importBatch"],
  });

  assert.throws(() => fixtures.track({ kind: "storage_object", id: "x" }), /no ownership validator/);
  assert.throws(() => fixtures.track({ kind: "importBatch", id: P6E_STUDY_ID }), /protected object/);
  ok("a kind without a deletion strategy, and any protected id, can never enter the ledger");

  fixtures.track({ kind: "tenant", id: RUN_TENANT });
  fixtures.track({ kind: "study", id: RUN_STUDY });

  // Scope: a fixture may only be created inside this run's throwaway tenant.
  assert.throws(
    () => fixtures.authorizeMutation(OPERATIONS["studies.createBlank"], { tenant_id: OTHER_TENANT }),
    /deny-list|fixture scope/,
  );
  fixtures.authorizeMutation(OPERATIONS["studies.createBlank"], { tenant_id: RUN_TENANT });
  ok("a scoped mutation is refused outside the run's own tenant and allowed inside it");

  // Targets: only ledgered objects may be mutated.
  assert.throws(
    () => fixtures.authorizeMutation(OPERATIONS["studies.updateConfiguration"], { study_id: P6E_STUDY_ID }),
    /deny-list|ownership/,
  );
  fixtures.authorizeMutation(OPERATIONS["studies.updateConfiguration"], { study_id: RUN_STUDY });
  ok("a targeted mutation is refused on an object this run does not own");

  // Denial-only operations: the reserved never-existing id, or nothing real.
  fixtures.authorizeMutation(OPERATIONS["clients.deleteClientUser"], { user_id: SAFE_NONEXISTENT_ID });
  assert.throws(
    () => fixtures.authorizeMutation(OPERATIONS["clients.deleteClientUser"], { user_id: OTHER_TENANT }),
    /deny-list|denial-only|ownership/,
  );
  assert.throws(
    () => fixtures.authorizeMutation(OPERATIONS["clients.inviteClientUser"], { tenant_id: "44444444-4444-4444-4444-444444444444" }),
    /denial-only/,
    "a denial-only operation may not name any real id this run does not own",
  );
  ok("a denial-only operation accepts only the reserved never-existing id or a ledgered object");

  // Cancellation closes the ledger to any further work.
  fixtures.halt();
  assert.throws(() => fixtures.track({ kind: "study", id: "z" }), /ledger is closed/);
  assert.throws(() => fixtures.authorizeMutation(OPERATIONS["studies.createBlank"], { tenant_id: RUN_TENANT }), /ledger is closed/);
  ok("once cancelled or cleaned up, no fixture can be tracked and no mutation authorized");
}
{
  // Ownership validators, including the two kinds PR 7 adds.
  const context = { prefix: PREFIX, tenantId: RUN_TENANT, studyIds: [RUN_STUDY], homeTenantId: null };
  assert.equal(KINDS.importBatch.owned({ file_name: `${PREFIX}-x.csv`, tenant_id: RUN_TENANT, study_id: RUN_STUDY }, context), true);
  assert.equal(KINDS.importBatch.owned({ file_name: `${PREFIX}-x.csv`, tenant_id: OTHER_TENANT, study_id: RUN_STUDY }, context), false);
  assert.equal(KINDS.importBatch.owned({ file_name: `${PREFIX}-x.csv`, tenant_id: RUN_TENANT, study_id: "other" }, context), false);
  assert.equal(KINDS.importBatch.owned({ file_name: "real-import.csv", tenant_id: RUN_TENANT, study_id: RUN_STUDY }, context), false);
  assert.equal(KINDS.studyTemplate.owned({ name: `${PREFIX} template` }, context), true);
  assert.equal(KINDS.studyTemplate.owned({ name: "Plantilla real" }, context), false);
  ok("an import batch is owned only when its prefix, tenant AND study all belong to this run");

  // Deletion order: an import batch before its study, a study before its tenant.
  const order = Object.entries(KINDS).sort((a, b) => a[1].order - b[1].order).map(([kind]) => kind);
  assert.ok(order.indexOf("importBatch") < order.indexOf("study"), "an import batch is deleted before its study");
  assert.ok(order.indexOf("study") < order.indexOf("tenant"), "a study is deleted before its tenant");
  assert.ok(order.indexOf("clientProfile") < order.indexOf("authUser"), "a profile is deleted before its identity");
  ok(`deletion order is ${order.join(" -> ")}`);
}
{
  const gateway = mockGateway([
    { kind: "tenant", id: RUN_TENANT, meta: { id: RUN_TENANT, name: `${PREFIX} tenant` } },
    { kind: "study", id: RUN_STUDY, meta: { id: RUN_STUDY, name: `${PREFIX} study`, tenant_id: RUN_TENANT } },
    { kind: "importBatch", id: "batch-1", meta: { id: "batch-1", file_name: `${PREFIX}-x.csv`, tenant_id: RUN_TENANT, study_id: RUN_STUDY } },
  ]);
  const fixtures = createFixtures({
    prefix: PREFIX, gateway, prefixedKinds: ["tenant", "study", "importBatch"],
  });
  fixtures.track({ kind: "tenant", id: RUN_TENANT });
  fixtures.track({ kind: "study", id: RUN_STUDY });
  fixtures.track({ kind: "importBatch", id: "batch-1" });
  const result = await fixtures.cleanup();
  assert.deepEqual(gateway.calls, [`importBatch:batch-1`, `study:${RUN_STUDY}`, `tenant:${RUN_TENANT}`]);
  assert.equal(result.clean, true);
  assert.equal(result.removed, 3);
  ok("cleanup deletes exactly the ledgered ids, import batch before study before tenant, and re-counts residue to zero");
}
{
  // A wrongly captured id must survive cleanup, and the run must go red.
  const gateway = mockGateway([
    { kind: "study", id: "real", meta: { id: "real", name: "Estudio real", tenant_id: RUN_TENANT } },
  ]);
  const fixtures = createFixtures({ prefix: PREFIX, gateway, prefixedKinds: ["study"] });
  fixtures.track({ kind: "tenant", id: RUN_TENANT });
  fixtures.track({ kind: "study", id: "real" });
  const result = await fixtures.cleanup();
  assert.deepEqual(gateway.calls, [], "no delete may be issued for an object ownership could not prove");
  assert.equal(result.clean, false, "a refusal must make the run red rather than pass quietly");
  ok("an id captured wrongly is refused, not deleted, and the run goes red");
}
{
  // A failing delete, and a read that throws, are both surfaced as residue.
  const gateway = mockGateway(
    [{ kind: "study", id: RUN_STUDY, meta: { id: RUN_STUDY, name: `${PREFIX} study`, tenant_id: RUN_TENANT } }],
    { failDeleteOf: new Set([RUN_STUDY]) },
  );
  const fixtures = createFixtures({ prefix: PREFIX, gateway, prefixedKinds: ["study"] });
  fixtures.track({ kind: "tenant", id: RUN_TENANT });
  fixtures.track({ kind: "study", id: RUN_STUDY });
  const result = await fixtures.cleanup();
  assert.equal(result.clean, false);
  assert.equal(result.leaked.length, 1);

  const throwing = mockGateway(
    [{ kind: "study", id: RUN_STUDY, meta: { id: RUN_STUDY, name: `${PREFIX} study`, tenant_id: RUN_TENANT } }],
    { throwOnRead: new Set([RUN_STUDY]) },
  );
  const fixtures2 = createFixtures({ prefix: PREFIX, gateway: throwing, prefixedKinds: ["study"] });
  fixtures2.track({ kind: "tenant", id: RUN_TENANT });
  fixtures2.track({ kind: "study", id: RUN_STUDY });
  const result2 = await fixtures2.cleanup();
  assert.deepEqual(throwing.calls, [], "an unreadable object is never deleted on a guess");
  assert.equal(result2.clean, false);
  ok("a failed delete and an unreadable object are both reported as residue, never silently accepted");
}
{
  // A forced mid-run failure still reaches exact-id cleanup.
  const gateway = mockGateway([
    { kind: "tenant", id: RUN_TENANT, meta: { id: RUN_TENANT, name: `${PREFIX} tenant` } },
  ]);
  const fixtures = createFixtures({ prefix: PREFIX, gateway, prefixedKinds: ["tenant"] });
  const reporter = createReporter(SUITE_B_CHECKS);
  let reached = false;
  try {
    fixtures.track({ kind: "tenant", id: RUN_TENANT });
    reporter.fail("B3.1", "forced failure");
    throw new Error("forced failure mid-run");
  } catch (error) {
    reporter.runFailure(error.message);
  } finally {
    reached = true;
    const result = await fixtures.cleanup();
    assert.equal(result.clean, true, "a failing run must still reach exact-id cleanup");
    assert.deepEqual(gateway.calls, [`tenant:${RUN_TENANT}`]);
  }
  assert.equal(reached, true);
  assert.equal(reporter.verdict().ok, false);
  ok("a forced mid-run failure still reaches cleanup, and the run is still reported red");
}

// --- [6] Sanitization: no secret, no payload, no body outside the inspector ---

console.log("\n[6] Response and output sanitization:");
{
  const marker = "p7cxabc123";
  const payload = buildXssPayload(marker);
  assert.ok(payload.includes(marker), "the payload must carry the run marker so occurrences can be counted");
  assert.ok(!/fetch\(|XMLHttpRequest|document\.cookie|localStorage|location\s*=/.test(payload),
    "the payload must be inert: it may set one window flag and nothing else");
  ok("the XSS payload is inert — it sets one window flag and never navigates, fetches or reads storage");

  // The suites' own printed shapes carry no secret class, including the ones
  // that mention a fixture id or a hostile probe.
  const sample = [
    `  run prefix: ${PREFIX}  (ownership namespace, never a deletion key)`,
    "  PASS B1/clients.createTenant  internal denied at the action_gate: denied_unauthenticated -> /login (HTTP 200)",
    "  PASS B2/upload.analyze  tenantA denied at the page_gate: denied_wrong_role (HTTP 200)",
    "  PASS C1.2  the payload renders as escaped text only (6 textual occurrence(s))",
    "  PASS C4.1  18 injection probes across filter names and values: statuses 400, zero 5xx",
    `       ledgered importBatch ${RUN_STUDY}`,
    '  FAIL RUN   fixture cleanup left residue: {"study":1}',
  ].join("\n");
  assert.deepEqual(scanText(sample), [], "the suites' own output shapes must not match any secret class");
  ok("the shapes Suites B and C print pass the secret scan with zero matches");

  // The injection strings are bounded and never destructive.
  for (const value of INJECTION_STRINGS) {
    assert.ok(value.length <= 64, "an injection probe must stay bounded");
    assert.ok(!/drop\s+table|delete\s+from|truncate\s+table|update\s+.*\s+set/i.test(value),
      "an injection probe must never attempt a destructive statement");
  }
  ok(`${INJECTION_STRINGS.length} injection probes are bounded and none attempts a destructive statement`);

  // The suite sources themselves read no credential, no body and no wire payload.
  for (const file of ["scripts/suite-b-authorization.mjs", "scripts/suite-c-input.mjs"]) {
    const source = readFileSync(file, "utf8");
    for (const [pattern, why] of FORBIDDEN_IN_SUITE) assert.ok(!pattern.test(source), `${file}: ${why}`);
  }
  ok("neither suite reads a privileged credential, a response body, a wire payload or the clock");

  // A fixture leak this PR actually caused: an abandoned CDP waiter rejected
  // after its operation had already failed, Node killed the process, and the
  // `finally` cleanup never ran. Every live suite must now catch that and wind
  // down through cleanup instead of dying.
  for (const file of [
    "scripts/suite-a-isolation.mjs",
    "scripts/suite-b-authorization.mjs",
    "scripts/suite-c-input.mjs",
  ]) {
    const source = readFileSync(file, "utf8");
    assert.match(source, /process\.on\("unhandledRejection"/, `${file} must not let an unhandled rejection bypass cleanup`);
    assert.match(source, /runFailure\(`unhandled rejection/, `${file} must record it as a run failure`);
    assert.match(source, /controller\.abort\(\)/, `${file} must cancel so the run settles before cleanup`);
  }
  ok("all three live suites turn an unhandled rejection into a red run that still reaches exact-id cleanup");

  // The inspector is the ONE place a body is read, and it never returns one.
  const inspector = readFileSync(INSPECTOR_FILE, "utf8");
  const bodyReads = inspector.split("\n").filter((line) => /await response\.(arrayBuffer|text|json)\(/.test(line));
  assert.equal(bodyReads.length, 1, "the inspector must contain exactly one body read");
  assert.ok(!/console\.(log|error|warn)/.test(inspector), "the inspector must never print anything");
  assert.ok(!/return\s+(text|bytes)\b|body:\s*text|text,\s*$/m.test(inspector),
    "the inspector must never return the body it read");
  assert.deepEqual([...INSPECTION_KINDS], ["pdf", "json", "text"], "the declared shapes are exact");
  assert.rejects(
    () => inspectHttpResponse({ url: "http://127.0.0.1:1", expect: "html" }),
    /must be one of/,
    "an undeclared shape is refused rather than guessed",
  );
  ok("the inspector has exactly one body read, prints nothing, returns no body, and refuses an undeclared shape");
}

// --- [7] Canonical gate wiring ----------------------------------------------

console.log("\n[7] Canonical gate wiring:");
{
  const pkg = JSON.parse(readFileSync("package.json", "utf8"));
  const scripts = pkg.scripts ?? {};
  const occurrences = (haystack, needle) => haystack.split(needle).length - 1;

  for (const name of ["suite:a", "suite:b", "suite:c", "test:pivot", "test:suite-bc-selftest"]) {
    assert.ok(scripts[name], `${name} must exist as a canonical command`);
  }
  assert.match(scripts["suite:b"], /scripts\/suite-b-authorization\.mjs/);
  assert.match(scripts["suite:c"], /scripts\/suite-c-input\.mjs/);
  assert.match(scripts["test:pivot"], /scripts\/pivot-test\.mjs/);
  ok("suite:b, suite:c and test:pivot exist and point at their own scripts");

  // The live chain runs each suite exactly once, in an explicit order.
  const live = scripts["gates:live"] ?? "";
  for (const name of ["run test:qualitative-live", "run suite:a", "run suite:b", "run suite:c"]) {
    assert.equal(occurrences(live, name), 1, `gates:live must run ${name} exactly once`);
  }
  const order = ["test:qualitative-live", "suite:a", "suite:b", "suite:c"].map((name) => live.indexOf(`run ${name}`));
  assert.deepEqual(order, [...order].sort((a, b) => a - b), "the live chain order must be qualitative -> a -> b -> c");
  assert.equal(occurrences(live, "run test:isolation"), 0, "gates:live must not chain a child Suite A already runs");
  assert.equal(occurrences(live, "run test:rls-coverage"), 0, "gates:live must not chain a child Suite A already runs");
  assert.equal(occurrences(live, "run test:pivot"), 0, "gates:live must not chain the child Suite C already runs");
  ok("gates:live is qualitative-live -> suite:a -> suite:b -> suite:c, each exactly once, with no duplicated child");

  // The deterministic chain gains the pivot gate and this self-test, and stays
  // credentials-free.
  const test = scripts.test ?? "";
  assert.equal(occurrences(test, "run test:pivot"), 1, "the deterministic chain must run test:pivot exactly once");
  assert.equal(occurrences(test, "run test:suite-bc-selftest"), 1);
  assert.equal(occurrences(test, "run test:suite-a-selftest"), 1, "Suite A's self-test must remain in the chain");
  for (const name of ["suite:a", "suite:b", "suite:c", "test:isolation", "test:rls-coverage"]) {
    assert.equal(occurrences(test, `run ${name}`), 0, `${name} is live and must not enter the deterministic chain`);
  }
  ok("npm test gains test:pivot and this self-test, keeps Suite A's, and stays free of every live gate");

  const offline = scripts["gates:offline"] ?? "";
  for (const name of ["suite:a", "suite:b", "suite:c"]) {
    assert.equal(occurrences(offline, name), 0, "gates:offline must stay credentials-free");
  }
  assert.match(scripts.gates ?? "", /run gates:offline/);
  assert.match(scripts.gates ?? "", /run gates:live/);
  assert.ok((scripts.gates ?? "").indexOf("gates:offline") < (scripts.gates ?? "").indexOf("gates:live"));
  ok("gates:offline stays credentials-free and gates still composes offline then live");

  // The live scripts carry the env file; the offline ones must not need one.
  for (const name of ["suite:b", "suite:c"]) {
    assert.match(scripts[name], /--env-file=\.env\.local/, `${name} is live and reads the local env file`);
  }
  assert.ok(!/--env-file/.test(scripts["test:pivot"]), "test:pivot must not require a credential file");
  assert.ok(!/--env-file/.test(scripts["test:suite-bc-selftest"]), "this self-test must not require a credential file");
  ok("the live suites read .env.local; the two new offline gates require no credential at all");

  // CI stays offline and credential-free.
  const ci = readFileSync(".github/workflows/ci.yml", "utf8");
  assert.match(ci, /npm run gates:offline/, "CI must run the offline chain");
  assert.ok(!/run:.*npm run gates:live/.test(ci), "CI must never execute gates:live");
  for (const name of ["suite:b", "suite:c"]) {
    assert.ok(!ci.includes(`npm run ${name}`), `CI must never execute ${name}`);
  }
  for (const name of ["TEST_USER_A_PASSWORD", "TEST_INTERNAL_PASSWORD", "SUPABASE_SERVICE_ROLE_KEY: "]) {
    assert.ok(!ci.includes(name), `CI must receive no live credential (${name})`);
  }
  ok("CI runs only gates:offline, never a live suite, and receives no live credential");

  // The retired V1-era scripts are gone and nothing references them.
  const referenced = JSON.stringify(scripts);
  for (const name of ["fase4-realdata-check", "fase5-journey-check", "ingest-test.ts"]) {
    assert.ok(!referenced.includes(name), `${name} was retired and must not be referenced by any npm script`);
  }
  ok("the three retired V1-era scripts are referenced by no npm script");
}

// --- [8] Reversal: the new assertions fail when their protection is removed ---

console.log("\n[8] Reversal — each protection, removed, makes its own check fail:");
{
  // (a) Weakening the denial vocabulary to "anything non-200" would let a 404
  //     absence and a validation rejection count as authorization evidence.
  const loose = (expected, observed) => observed !== "success";
  assert.equal(loose("denied", "not_found"), true, "the weakened rule would accept an absence");
  assert.equal(outcomeSatisfies("denied", "not_found"), false, "the real rule refuses it");
  ok("weakening 'denied' to 'anything non-200' would accept a 404 absence; the real rule refuses it");

  // (b) Dropping the nosniff requirement would accept an echo a browser could
  //     re-interpret as a document.
  const withoutNosniff = { status: 400, leakClasses: [], secretClasses: [], activeMarkup: true, contentTypeClass: "json", nosniff: false };
  assert.equal(injectionResponseIsSafe(withoutNosniff).safe, false);
  assert.equal(injectionResponseIsSafe({ ...withoutNosniff, nosniff: true }).safe, true);
  ok("removing the nosniff requirement flips an unsafe echo to safe; the real rule keeps it unsafe");

  // (c) Dropping the literal-present requirement would let a payload that never
  //     rendered at all be reported as "inert".
  const neverRendered = { executed: false, executableNodes: 0, inlineHandlers: 0, literalPresent: false };
  assert.equal(xssObservationIsInert(neverRendered).inert, false);
  assert.equal(xssObservationIsInert({ ...neverRendered, literalPresent: true }).inert, true);
  ok("a payload that never rendered cannot be reported inert; the positive control is load-bearing");

  // (d) Removing the ownership requirement would let a mutation reach a real
  //     object this run never created.
  const permissive = createFixtures({ prefix: PREFIX, gateway: mockGateway([]), prefixedKinds: ["study"] });
  permissive.track({ kind: "tenant", id: RUN_TENANT });
  assert.throws(() => permissive.authorizeMutation(OPERATIONS["studies.deleteTemplate"], { template_id: OTHER_TENANT }), /deny-list|ownership/);
  const noTargets = { ...OPERATIONS["studies.deleteTemplate"], targetParams: [], deniedPathsOnly: false, creates: ["study"] };
  permissive.authorizeMutation(noTargets, { template_id: OTHER_TENANT });
  ok("removing `targetParams` lets a destructive mutation name an unowned object; the real descriptor refuses it");

  // (e) Removing the roster generation would let a new catalogue mutation ship
  //     with no check at all.
  const handWritten = ["B1/clients.createTenant"];
  const missed = MUTATING_OPERATIONS.filter((name) => !handWritten.includes(`B1/${name}`));
  assert.ok(missed.length > 0, "a hand-written roster would omit most of the catalogue");
  assert.equal(
    MUTATING_OPERATIONS.every((name) => SUITE_B_CHECKS.some((c) => c.id === `B1/${name}`)),
    true,
  );
  ok(`a hand-written roster would omit ${missed.length} mutations; the generated roster omits none`);

  // (f) Allowing a credential-bearing header to be forged would turn a
  //     tampering probe into impersonation.
  assert.ok(!FORGEABLE_HEADERS.has("cookie"));
  const permissiveHeaders = new Set([...FORGEABLE_HEADERS, "cookie"]);
  assert.ok(permissiveHeaders.has("cookie"), "the weakened list would allow it");
  ok("adding `cookie` to the forgeable list would allow impersonation; the real list excludes it");
}

console.log(`\nSuites B and C offline self-test: ${passed} checks passed.`);
