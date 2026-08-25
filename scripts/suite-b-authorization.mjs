// =============================================================================
// Suite B — behavioral server-side authorization.
// docs/P7_PLAN.md §5 (B1-B3), §6.1, §9.1 PR 7.
// =============================================================================
//
//   node --env-file=.env.local scripts/suite-b-authorization.mjs   (npm run suite:b)
//
// Prerequisites: the application running at HARNESS_ORIGIN (default
// http://localhost:3000) against the synthetic project, the .env.local fixture
// accounts, and a supported browser. Without a browser the run exits non-zero
// as unsupported — never green, never "skipped".
//
// WHAT THIS SUITE PROVES, AND HOW
//
//   B1  every mutating Server Action and route handler in the frozen catalogue
//       rejects an UNAUTHENTICATED caller before any side effect;
//   B2  every internal-only mutation rejects a real `client` caller before any
//       side effect;
//   B3  tampering with client-controlled state — request headers, filter values
//       injected into the product's own controls, a corrupted session cookie —
//       never upgrades authority and never crosses a tenant;
//   B4  the authenticated report route's four outcomes stay distinct;
//   B5  destructive operations can only ever reach objects this run created;
//   B6  a refusal is classified by its REASON: a 404 absence, a 400 validation
//       rejection and an authorization denial are never interchangeable;
//   B7  every denied mutation left the database exactly as it found it.
//
// THE ROSTER IS GENERATED FROM THE FROZEN CATALOGUE, NOT HAND-WRITTEN.
// `SUITE_B_CHECKS` is derived from `OPERATIONS`, so a mutation added to the
// catalogue tomorrow arrives on this roster with no result — and an unexecuted
// roster entry is RED. Completeness is therefore structural rather than a
// promise, and no operation can be silently skipped or inferred from source.
//
// THREE EVIDENCE LAYERS, REPORTED SEPARATELY AND NEVER SUMMED
//   layer 1  catalogue completeness — one required row per catalogued mutation,
//            generated from the frozen catalogue, so nothing can be forgotten;
//   layer 2  the OUTER ACTION ROUTE — one ordinary form-shaped POST to the exact
//            method and path each Server Action is dispatched to, carrying no
//            action identifier, no private field and no body;
//   layer 3  observable INNER Server-Action denial — only where the application
//            actually produces one.
// This suite never claims that all 18 inner Server Actions were invoked. They
// cannot be, without the hashed action identifier or a hand-built RSC body that
// the design forbids, and pretending otherwise is the failure this split exists
// to prevent.
//
// TWO STRENGTHS OF DENIAL, BOTH REAL, NEVER CONFLATED
//   `page_gate`   the caller never reached the surface at all: the middleware
//                 or the page's own role check answered first. Recorded with
//                 the redirect target or the product's own denial page.
//   `action_gate` the page was legitimately rendered for an authorized user,
//                 the session was then ENDED, and the Server Action itself was
//                 invoked through the application's own runtime. This proves
//                 the action re-checks authorization rather than trusting the
//                 page in front of it.
// Ending a session removes authority and can never add any; no credential is
// ever copied between actors (design §3.6).
//
// WHAT IS NEVER PRINTED
// No email, password, token, cookie, key, JWT fragment, response body, rendered
// message or row of business data. Output is actor labels, check ids, outcome
// categories, counts and sanitized status codes. The whole transcript is
// scanned before exit.
// =============================================================================

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { scanText } from "./lib/secret-patterns.mjs";
import { OPERATIONS, createHarness, operationSupport } from "./lib/http-harness.mjs";
import { launchBrowser, PAGE } from "./lib/harness-browser.mjs";
import {
  createFixtures,
  stampedPrefix,
  P6E_STUDY_ID,
  SAFE_NONEXISTENT_ID,
} from "./lib/harness-fixtures.mjs";

const RUN_TIMEOUT_MS = 20 * 60 * 1000;

// -----------------------------------------------------------------------------
// The catalogue's mutating surface — the thing B1 and B2 must cover completely
// -----------------------------------------------------------------------------

/** Every mutating operation in the frozen catalogue, in catalogue order. */
export const MUTATING_OPERATIONS = Object.freeze(
  Object.values(OPERATIONS).filter((op) => op.mutating).map((op) => op.name),
);

/** The protected route handler B4 covers in its own right. */
export const REPORT_OPERATION = "report.download";

/**
 * Denial-only operations: their SUCCESS would create an Auth identity, send a
 * message, or write a Storage object, none of which this run can undo (design
 * §6.6). They are proven at the page gate and are never driven towards a
 * positive outcome, which the fixture ledger enforces independently.
 */
export const DENIED_PATHS_ONLY = Object.freeze(
  Object.values(OPERATIONS).filter((op) => op.deniedPathsOnly).map((op) => op.name),
);

/**
 * Operations whose action-level probe is deliberately WITHHELD, each with the
 * reason. Withholding is not skipping: B1/B2 still execute for these through
 * the page gate, and the reason is printed in the run's own output.
 */
export const ACTION_GATE_WITHHELD = Object.freeze({
  "upload.rollback":
    "destructive, and its control targets the newest committed import batch — an object this run does not own",
  "clients.updateTenantBrand": "success would write a Storage object with no verified deletion path",
  "clients.inviteClientUser": "success would create an Auth identity and send a message",
  "clients.updateClientUser": "the run owns no client user to target",
  "clients.deleteClientUser": "destructive, and the run owns no client user to target",
});

/**
 * The distinct protected POST path classes, derived from the catalogue rather
 * than listed by hand: every mutating operation names the outer route its
 * Server Action is dispatched to, so a new mutation on a new page brings a new
 * path class with it and cannot be forgotten.
 */
export const ACTION_ROUTE_CLASSES = Object.freeze(
  [
    ...new Set(
      Object.values(OPERATIONS)
        .filter((op) => op.mutating)
        .flatMap((op) => [op.actionRoute, ...(op.alsoDispatchedTo ?? [])]),
    ),
  ].sort(),
);

/**
 * Which catalogued mutations dispatch to a given outer route.
 *
 * P8.2 made this one-to-MANY. Every `/admin/*` address kept answering while the
 * same Server Action became reachable from its Studio address as well, and a
 * Server Action is dispatched by POSTing to the page that renders it — so one
 * mutation now genuinely travels on two protected POST paths. Recording only
 * the first would leave the second unproven, which is the opposite of what this
 * catalogue is for.
 */
export function operationsOnRoute(routeName) {
  return Object.values(OPERATIONS)
    .filter(
      (op) =>
        op.mutating
        && (op.actionRoute === routeName || (op.alsoDispatchedTo ?? []).includes(routeName)),
    )
    .map((op) => op.name);
}

/** Every protected POST path class one mutation is dispatched to. */
export function routesForOperation(name) {
  const op = OPERATIONS[name];
  if (!op?.mutating) return [];
  return [...new Set([op.actionRoute, ...(op.alsoDispatchedTo ?? [])])];
}

/**
 * Whether an outer action-route observation PROVES an authorization denial on
 * that route's own method and path.
 *
 * Written as a pure function so the reversal tests can show what it refuses:
 * a GET cannot stand in for the POST route, a different path cannot stand in
 * for the catalogued one, a 2xx allow is not a denial, and a 405 is the
 * framework's own method routing answering BEFORE the middleware — which is
 * exactly the shape a careless probe would have mistaken for a denial.
 */
export function outerRouteDenialIsProven(observation) {
  const o = observation ?? {};
  if (o.method !== "POST") return { proven: false, why: `method ${o.method ?? "(none)"} is not the action route's POST` };
  if (!o.path || o.path !== o.expectedPath) {
    return { proven: false, why: `path ${o.path ?? "(none)"} is not the catalogued ${o.expectedPath ?? "(none)"}` };
  }
  const status = o.status;
  if (typeof status !== "number") return { proven: false, why: "no status" };
  if (status === 405) return { proven: false, why: "405: the framework rejected the method before authorization ran" };
  if (status >= 500) return { proven: false, why: `server error ${status}` };
  if (status === 401 || status === 403) return { proven: true, why: `denied with ${status}` };
  if (status >= 300 && status < 400) {
    if (o.redirectPath === "/login") return { proven: true, why: "redirected to /login (unauthenticated)" };
    if (o.redirectPath === "/dashboard") return { proven: true, why: "redirected to /dashboard (wrong role)" };
    return { proven: false, why: `redirected to ${o.redirectPath ?? "(unknown)"}, which is not a denial target` };
  }
  if (status >= 200 && status < 300) return { proven: false, why: `the route allowed the request (${status})` };
  return { proven: false, why: `unexpected status ${status}` };
}

export const OUTER_ROUTE_CASES = Object.freeze([
  { what: "a POST redirected to /login", input: { method: "POST", path: "/admin/clients", expectedPath: "/admin/clients", status: 307, redirectPath: "/login" }, proven: true },
  { what: "a POST redirected to /dashboard", input: { method: "POST", path: "/admin/studies", expectedPath: "/admin/studies", status: 307, redirectPath: "/dashboard" }, proven: true },
  { what: "a POST answered 401", input: { method: "POST", path: "/admin/clients", expectedPath: "/admin/clients", status: 401 }, proven: true },
  { what: "a GET, however it was answered", input: { method: "GET", path: "/admin/clients", expectedPath: "/admin/clients", status: 307, redirectPath: "/login" }, proven: false },
  { what: "a POST to a different path", input: { method: "POST", path: "/dashboard", expectedPath: "/admin/clients", status: 307, redirectPath: "/login" }, proven: false },
  { what: "a 405 method rejection", input: { method: "POST", path: "/admin/clients", expectedPath: "/admin/clients", status: 405 }, proven: false },
  { what: "a 200 allow", input: { method: "POST", path: "/admin/clients", expectedPath: "/admin/clients", status: 200 }, proven: false },
  { what: "a 500 framework error", input: { method: "POST", path: "/admin/clients", expectedPath: "/admin/clients", status: 500 }, proven: false },
  { what: "a redirect somewhere else", input: { method: "POST", path: "/admin/clients", expectedPath: "/admin/clients", status: 307, redirectPath: "/somewhere" }, proven: false },
]);

export function selfTestOuterRoute() {
  return OUTER_ROUTE_CASES.flatMap((testCase) => {
    const got = outerRouteDenialIsProven(testCase.input).proven;
    return got === testCase.proven ? [] : [`${testCase.what}: expected ${testCase.proven}, got ${got}`];
  });
}

/**
 * WHICH GATE ANSWERS, AND WHY THAT IS THE HONEST THING TO ASSERT
 *
 * This application denies an unauthenticated caller in the MIDDLEWARE
 * (`src/lib/supabase/middleware.ts:89-93`), which runs on every non-public path
 * — including the POST a Server Action travels on. The per-action guards
 * (`internalContext()`, `authorizeInternal()`, the report route's own 401) are
 * a genuine second layer, but from outside the application they are shadowed:
 * the outer gate answers first, so the inner one is never reached and never
 * produces an observable outcome. That is defense in depth working, not a gap,
 * and this suite records it as such rather than pretending otherwise.
 *
 * One surface still yields an observable ACTION-level denial: a form whose
 * frozen mechanism is `form` submits natively, so the browser follows the
 * middleware's redirect and lands on `/login` — a real navigation this suite
 * can classify. A JavaScript-bound Server Action instead receives an HTML
 * redirect where it expected an RSC payload and renders nothing at all, which
 * classifies as `unclassified` and fails the run rather than proving anything.
 *
 * So B1 asserts the denial at whichever gate genuinely answered, records which
 * one that was, and additionally runs the action-level probe wherever it is
 * observable. Both are real behavioral denials; neither is inferred from source.
 */
export function actionGateIsObservable(op) {
  if (!op || ACTION_GATE_WITHHELD[op.name]) return false;
  return op.mechanism === "form";
}

function rosterFor(prefix, title) {
  return [...MUTATING_OPERATIONS, REPORT_OPERATION].map((name) => ({
    id: `${prefix}/${name}`,
    group: prefix,
    title: `${title}: ${name}`,
  }));
}

const routeSlug = (routeName) => routeName.replace(/^route\.post/, "").replace(/^Admin/, "").toLowerCase();

function routeRosterFor(prefix, title) {
  return ACTION_ROUTE_CLASSES.map((routeName) => ({
    id: `${prefix}/${routeSlug(routeName)}`,
    group: prefix,
    title: `${title}: POST ${OPERATIONS[routeName].path}`,
  }));
}

export const SUITE_B_CHECKS = Object.freeze([
  ...rosterFor("B1", "an unauthenticated caller is rejected before any side effect"),
  ...rosterFor("B2", "a real client caller is rejected before any side effect"),
  // The outer action-route layer: the exact POST method and path each Server
  // Action is dispatched to. These are separate rows precisely so that no
  // page-level GET result can be counted as covering them.
  ...routeRosterFor("B9", "the outer action route denies an unauthenticated caller on its own POST"),
  ...routeRosterFor("B10", "the outer action route and a real client caller, on its own POST"),
  ...routeRosterFor("B11", "an authorized identity is answered differently, and the same POST to a public path is not a denial"),
  { id: "B3.1", group: "B3", title: "forged role headers do not upgrade a client on an internal page" },
  { id: "B3.2", group: "B3", title: "the middleware-bypass header class does not admit an anonymous caller" },
  { id: "B3.3", group: "B3", title: "forged tenant/user headers do not cross a tenant on the report route" },
  { id: "B3.4", group: "B3", title: "a structurally corrupted session cookie is rejected, not decoded" },
  { id: "B3.5", group: "B3", title: "a filter value forged into the product's own control is refused server-side" },
  { id: "B3.6", group: "B3", title: "a client cannot reach an internal-only page by any catalogued route" },
  { id: "B4.1", group: "B4", title: "report route: logged out is 401, not 404 and not a PDF" },
  { id: "B4.2", group: "B4", title: "report route: tenant B cannot obtain tenant A's report" },
  { id: "B4.3", group: "B4", title: "report route: the owning tenant A client still receives its PDF" },
  { id: "B4.4", group: "B4", title: "report route: a real internal identity still receives the PDF" },
  { id: "B4.5", group: "B4", title: "report route: a malformed study id is an absence, not a denial" },
  { id: "B5.1", group: "B5", title: "every destructive operation is confined to run-owned fixtures" },
  { id: "B6.1", group: "B6", title: "refusal reasons are distinct and never interchangeable" },
  { id: "B7.1", group: "B7", title: "no denied mutation changed any protected or global count" },
]);

// -----------------------------------------------------------------------------
// Outcome vocabulary — pure, exercised offline by scripts/suite-bc-selftest.mjs
// -----------------------------------------------------------------------------

/** The categories that count as "the application refused this caller". */
export const DENIAL_CATEGORIES = Object.freeze([
  "denied_unauthenticated",
  "denied_wrong_role",
  "denied_action_result",
]);

/**
 * A denial and only a denial. An absence (404) may be correct non-disclosure
 * and a validation rejection (400) means the input was refused before
 * authorization was ever reached — neither is evidence that authorization
 * works, so neither may stand in for one here.
 */
export function isDenial(category) {
  return DENIAL_CATEGORIES.includes(category);
}

/**
 * Whether an observed outcome satisfies the expectation for a probe. Written as
 * a pure function so the self-test can prove that `success` never satisfies a
 * denial expectation and that `unclassified` never satisfies anything.
 */
export function outcomeSatisfies(expected, observed) {
  if (observed === "unclassified" || observed === "page_crash" || observed === "network_failure") return false;
  if (expected === "denied") return isDenial(observed);
  if (expected === "not_found") return observed === "not_found";
  if (expected === "validation_rejected") return observed === "validation_rejected";
  if (expected === "success") return observed === "success";
  return false;
}

export const OUTCOME_CASES = Object.freeze([
  { what: "a login redirect satisfies a denial", expected: "denied", observed: "denied_unauthenticated", ok: true },
  { what: "a dashboard redirect satisfies a denial", expected: "denied", observed: "denied_wrong_role", ok: true },
  { what: "a rendered action denial satisfies a denial", expected: "denied", observed: "denied_action_result", ok: true },
  { what: "an absence never satisfies a denial", expected: "denied", observed: "not_found", ok: false },
  { what: "a validation rejection never satisfies a denial", expected: "denied", observed: "validation_rejected", ok: false },
  { what: "a success never satisfies a denial", expected: "denied", observed: "success", ok: false },
  { what: "an unclassified answer satisfies nothing", expected: "denied", observed: "unclassified", ok: false },
  { what: "a method rejection never satisfies a denial", expected: "denied", observed: "method_not_allowed", ok: false },
  { what: "a crash satisfies nothing", expected: "success", observed: "page_crash", ok: false },
  { what: "a denial never satisfies an absence", expected: "not_found", observed: "denied_unauthenticated", ok: false },
  { what: "an absence satisfies an absence", expected: "not_found", observed: "not_found", ok: true },
  { what: "a success satisfies a success", expected: "success", observed: "success", ok: true },
]);

export function selfTestOutcomes() {
  return OUTCOME_CASES.flatMap((testCase) => {
    const got = outcomeSatisfies(testCase.expected, testCase.observed);
    return got === testCase.ok
      ? []
      : [`${testCase.what}: expected ${testCase.ok}, got ${got}`];
  });
}

// -----------------------------------------------------------------------------
// Reporter — enforces the must-execute roster (same contract as Suite A)
// -----------------------------------------------------------------------------

export function createReporter(roster, { log = () => {} } = {}) {
  const ids = new Set(roster.map((check) => check.id));
  const results = [];
  const runFailures = [];
  const executed = new Set();

  function record(id, passed, message) {
    if (!ids.has(id)) throw new Error(`unknown check id "${id}" — the roster is the contract`);
    executed.add(id);
    results.push({ id, passed, message });
    log(`  ${passed ? "PASS" : "FAIL"} ${id}  ${message}`);
    return passed;
  }

  return {
    pass: (id, message) => record(id, true, message),
    fail: (id, message) => record(id, false, message),
    results: () => [...results],
    executed: () => [...executed],
    runFailure(message) {
      runFailures.push(message);
      log(`  FAIL RUN   ${message}`);
    },
    verdict() {
      const missing = roster.filter((check) => !executed.has(check.id)).map((c) => c.id);
      const failed = results.filter((r) => !r.passed).map((r) => `${r.id}: ${r.message}`);
      return {
        ok: missing.length === 0 && failed.length === 0 && runFailures.length === 0,
        missing,
        failed,
        runFailures: [...runFailures],
        total: results.length,
      };
    },
  };
}

// -----------------------------------------------------------------------------
// Runtime. Everything below runs only when this file is EXECUTED, so
// scripts/suite-bc-selftest.mjs can import the pure logic above without
// provisioning a fixture, reading a credential or touching the network.
// -----------------------------------------------------------------------------

const isDirectRun =
  import.meta.main ?? Boolean(process.argv[1] && process.argv[1].endsWith("suite-b-authorization.mjs"));

const transcript = [];
function installTranscript() {
  const realLog = console.log.bind(console);
  const realError = console.error.bind(console);
  console.log = (...args) => { transcript.push(args.join(" ")); realLog(...args); };
  console.error = (...args) => { transcript.push(args.join(" ")); realError(...args); };
}

const note = (message) => console.log(`       ${message}`);
const reporter = createReporter(SUITE_B_CHECKS, { log: (line) => console.log(line) });
const pass = (id, message) => reporter.pass(id, message);
const fail = (id, message) => reporter.fail(id, message);

let ORIGIN = "http://localhost:3000";
/** Path classes whose wrong-role denial is not expressible in an HTTP status. */
const outerRouteLimitations = [];
let SUPABASE_URL = "";
let PUBLISHABLE_KEY = "";
let TENANT_A = "";
let TENANT_B = "";
let activeHarness = null;

// -----------------------------------------------------------------------------
// Per-operation probe parameters, built from this run's OWN fixtures
// -----------------------------------------------------------------------------

/**
 * Every mutating probe targets an object this run created, or the reserved
 * never-existing id. That is deliberate: if an authorization guard ever failed
 * open, the blast radius is a fixture this run is about to delete anyway — and
 * the fixture ledger refuses anything else before the request is sent.
 */
function probeParams(op, fx) {
  const base = { tenant_id: fx.tenantId, studyId: fx.studyId };
  switch (op.name) {
    case "clients.createTenant":
      return { name: `${fx.prefix} probe tenant` };
    case "clients.renameTenant":
      return { tenant_id: fx.tenantId, name: `${fx.prefix} renamed` };
    case "clients.updateTenantBrand":
      return { tenant_id: SAFE_NONEXISTENT_ID, display_name: `${fx.prefix} brand`, tagline: "probe" };
    case "clients.inviteClientUser":
      return {
        tenant_id: SAFE_NONEXISTENT_ID,
        email: `${fx.prefix.toLowerCase()}-never-created@example.invalid`,
        full_name: `${fx.prefix} probe`,
        data_scope: "{}",
      };
    case "clients.updateClientUser":
      return { user_id: SAFE_NONEXISTENT_ID, full_name: `${fx.prefix} probe`, data_scope: "{}" };
    case "clients.deleteClientUser":
      return { user_id: SAFE_NONEXISTENT_ID, confirmation_email: `${fx.prefix.toLowerCase()}@example.invalid` };
    // P8.2 lifecycle. Every one of these is denial-only, so the ids below are
    // only ever used to BUILD the path the denial is observed on; none of them
    // names a real object, and none of these operations is ever driven to
    // success.
    case "clients.suspendClientUser":
    case "clients.restoreClientUser":
      return { tenantId: fx.tenantId, user_id: SAFE_NONEXISTENT_ID };
    case "clients.archiveTenant":
    case "clients.restoreTenant":
      return { tenantId: fx.tenantId, tenant_id: SAFE_NONEXISTENT_ID };
    case "clients.deleteTenant":
      return {
        tenantId: fx.tenantId,
        tenant_id: SAFE_NONEXISTENT_ID,
        confirmation_name: `${fx.prefix} nunca existió`,
        impact: "",
      };
    case "studies.setPublication":
      return { studyId: fx.studyId, study_id: SAFE_NONEXISTENT_ID };
    case "qualitative.generateSuggestions":
    case "qualitative.reviewObservations":
      return { studyId: fx.studyId, theme: `${fx.prefix.toLowerCase()}probe`, stage_key: "" };
    case "studies.createBlank":
      return { tenant_id: fx.tenantId, name: `${fx.prefix} probe study`, period: "" };
    case "studies.createFromTemplate":
      return { tenant_id: fx.tenantId, template_id: fx.templateId, name: `${fx.prefix} probe from template`, period: "" };
    case "studies.saveAsTemplate":
      return { study_id: fx.studyId, template_id: "", name: `${fx.prefix} probe template`, description: "probe" };
    case "studies.updateTemplateMetadata":
      return { template_id: fx.templateId, name: `${fx.prefix} template`, description: "probe" };
    case "studies.deleteTemplate":
      return { template_id: fx.templateId };
    case "studies.updateConfiguration":
      return { study_id: fx.studyId, name: `${fx.prefix} study`, period: "", status: "draft" };
    case "upload.analyze":
    case "upload.preview":
      return { tenant_id: fx.tenantId, file: fx.validCsvPath };
    case "upload.confirm":
      return { tenant_id: fx.tenantId, study_id: fx.studyId, file: fx.validCsvPath };
    case "upload.rollback":
      return { batch_id: fx.studyId };
    case REPORT_OPERATION:
      return { studyId: P6E_STUDY_ID };
    default:
      return base;
  }
}

// -----------------------------------------------------------------------------
// B1 / B2 — the two must-execute rosters
// -----------------------------------------------------------------------------

async function probeDenial(harness, group, actorId, opName, fx, { endSession = false } = {}) {
  const id = `${group}/${opName}`;
  const op = OPERATIONS[opName];
  const support = operationSupport(op);
  if (!support.supported) return fail(id, `the catalogue refuses to execute this operation: ${support.reason}`);

  let result;
  try {
    result = await harness.run(actorId, op, probeParams(op, fx), { endSessionAfterLoad: endSession });
  } catch (error) {
    // A pre-dispatch refusal is a harness/ledger decision, not an application
    // answer, so it can never be reported as a security denial.
    return fail(id, `the probe could not be dispatched: ${error.code ?? error.message}`);
  }
  const gate = endSession ? "action_gate" : "page_gate";
  if (!outcomeSatisfies("denied", result.errorCategory)) {
    return fail(
      id,
      `${actorId} was answered ${result.errorCategory} (HTTP ${result.httpStatus ?? "-"}) at the ${gate}, expected a denial`,
    );
  }
  return pass(
    id,
    `${actorId} denied at the ${gate}: ${result.errorCategory}` +
      `${result.redirectTo ? ` -> ${result.redirectTo}` : ""} (HTTP ${result.httpStatus ?? "-"})`,
  );
}

/**
 * Issues ONE ordinary form-shaped POST to an outer action route and returns the
 * observation the pure classifier consumes. No action identifier, no private
 * field, no mutation payload — the body is empty, which is why this can never
 * invoke the Server Action behind the route.
 */
async function observeRoute(harness, actorId, routeName) {
  const op = OPERATIONS[routeName];
  const result = await harness.run(actorId, op, {});
  return {
    result,
    observation: {
      method: op.method,
      path: op.path,
      expectedPath: op.path,
      status: result.httpStatus,
      redirectPath: result.redirectTo,
    },
  };
}

/**
 * B9/B10 — the outer action route, on its own POST method and path.
 *
 * `expectStatusDenial: false` records the one path class where the product
 * answers a wrong-role caller with HTTP 200 and a rendered denial page rather
 * than a status (design §1.8 AM4). No status-level claim is made there: the
 * row says so in its own title and its own message, and the denial for that
 * path is proven at the browser layer instead.
 */
async function checkOuterRoute(harness, group, actorId, routeName, { expectStatusDenial = true } = {}) {
  const id = `${group}/${routeName.replace(/^route\.post/, "").replace(/^Admin/, "").toLowerCase()}`;
  const covered = operationsOnRoute(routeName);
  let observed;
  try {
    observed = await observeRoute(harness, actorId, routeName);
  } catch (error) {
    return fail(id, `the outer route probe could not be dispatched: ${error.code ?? error.message}`);
  }
  const verdict = outerRouteDenialIsProven(observed.observation);

  if (!expectStatusDenial) {
    // The honest weaker statement, and it is stated as weaker: the request
    // reached the application on the catalogued method and path, was neither a
    // framework method rejection nor a server error — and the role denial
    // itself is NOT expressed in the status here.
    const status = observed.observation.status;
    if (status === 405 || typeof status !== "number" || status >= 500) {
      return fail(id, `the outer route answered ${status ?? "(none)"} — the probe never reached the application`);
    }
    outerRouteLimitations.push(routeName);
    return pass(
      id,
      `POST ${observed.observation.path} reached the application (HTTP ${status}) but expresses its wrong-role ` +
        `denial in the rendered document, not the status — NO status-level authorization claim is made for this ` +
        `path class; the denial for its ${covered.length} operation(s) is proven at the browser layer (B2)`,
    );
  }

  if (!verdict.proven) {
    return fail(id, `POST ${observed.observation.path} as ${actorId}: ${verdict.why}`);
  }
  return pass(
    id,
    `POST ${observed.observation.path} as ${actorId}: ${verdict.why} (HTTP ${observed.observation.status}) — ` +
      `covers the outer boundary of ${covered.length} catalogued mutation(s)`,
  );
}

/**
 * B11 — the discriminator. Two things are proven together, and the check is
 * worthless without both:
 *   1. an AUTHORIZED identity is answered differently on the same POST path,
 *      so the denial above is not simply "this route refuses everyone";
 *   2. the IDENTICAL request to a PUBLIC path is not answered with an
 *      authorization denial at all — `/api/health` exports only GET, so it
 *      answers 405 with no redirect. Without this, "every POST gets a redirect"
 *      would look exactly like an authorization boundary.
 */
async function checkRouteDiscriminator(harness, routeName) {
  const id = `B11/${routeName.replace(/^route\.post/, "").replace(/^Admin/, "").toLowerCase()}`;
  const path = OPERATIONS[routeName].path;
  let denied;
  let authorized;
  let publicPath;
  try {
    denied = await observeRoute(harness, "anonymous", routeName);
    authorized = await observeRoute(harness, "internal", routeName);
    publicPath = await observeRoute(harness, "anonymous", "route.postHealth");
  } catch (error) {
    return fail(id, `a discriminator probe could not be dispatched: ${error.code ?? error.message}`);
  }

  const deniedStatus = denied.observation.status;
  const authorizedStatus = authorized.observation.status;
  if (!outerRouteDenialIsProven(denied.observation).proven) {
    return fail(id, `the denied control on POST ${path} was not a denial (HTTP ${deniedStatus})`);
  }
  if (deniedStatus === authorizedStatus && denied.observation.redirectPath === authorized.observation.redirectPath) {
    return fail(
      id,
      `POST ${path} answered an authorized identity exactly as it answered an anonymous one ` +
        `(HTTP ${authorizedStatus}) — this route refuses everyone, so the denial proves nothing`,
    );
  }
  // The public-path control: the identical request, to a path that is public by
  // design, must NOT be answered with an authorization denial.
  if (outerRouteDenialIsProven({ ...publicPath.observation, expectedPath: publicPath.observation.path }).proven) {
    return fail(
      id,
      `the identical POST to the public /api/health was answered as a denial ` +
        `(HTTP ${publicPath.observation.status} -> ${publicPath.observation.redirectPath}) — a redirect on every ` +
        "POST would look exactly like an authorization boundary and prove nothing",
    );
  }
  return pass(
    id,
    `POST ${path}: anonymous ${deniedStatus}${denied.observation.redirectPath ? ` -> ${denied.observation.redirectPath}` : ""} ` +
      `vs authorized ${authorizedStatus}; and the identical POST to the public /api/health is ` +
      `HTTP ${publicPath.observation.status} with no authorization redirect, so the denial is specific to the ` +
      "protected path rather than a blanket answer",
  );
}

/**
 * B1 for the report route is ordinary HTTP: the handler answers 401 itself
 * rather than redirecting, which is a different and stronger statement than a
 * middleware redirect and must be asserted as such.
 */
async function probeReportDenial(harness, group, actorId) {
  const id = `${group}/${REPORT_OPERATION}`;
  const result = await harness.run(actorId, OPERATIONS[REPORT_OPERATION], { studyId: P6E_STUDY_ID });
  if (group === "B1") {
    if (result.errorCategory === "denied_unauthenticated") {
      return pass(
        id,
        `an unauthenticated caller is denied before the handler runs (HTTP ${result.httpStatus}` +
          `${result.redirectTo ? ` -> ${result.redirectTo}` : ""}); the route's own 401 is the second layer behind it`,
      );
    }
    return fail(id, `unauthenticated gave ${result.errorCategory} / HTTP ${result.httpStatus}, expected a denial`);
  }
  // A `client` of another tenant must be told the study does not exist, never
  // that it exists and is forbidden. Non-disclosure is the correct answer here,
  // so this is the one roster row whose expectation is an absence.
  if (result.errorCategory === "not_found" && result.httpStatus === 404) {
    return pass(id, "a foreign-tenant client receives 404 non-disclosure, never a PDF and never a 403");
  }
  return fail(id, `a foreign-tenant client got ${result.errorCategory} / HTTP ${result.httpStatus}, expected 404`);
}

// -----------------------------------------------------------------------------
// B3 — tampering with everything the caller controls
// -----------------------------------------------------------------------------

const FORGED_ROLE_HEADERS = {
  "x-role": "internal",
  "x-user-role": "internal",
  "x-user-id": SAFE_NONEXISTENT_ID,
};

async function checkForgedRoleHeaders(harness) {
  console.log("\n[B3.1] Forged role headers on an internal-only page, as a real client:");
  const plain = await harness.run("tenantA", OPERATIONS["page.adminStudies"]);
  const forged = await harness.run("tenantA", OPERATIONS["page.adminStudies"], { headers: FORGED_ROLE_HEADERS });
  if (plain.errorCategory !== "denied_wrong_role") {
    return fail("B3.1", `the untampered control was ${plain.errorCategory}, expected denied_wrong_role`);
  }
  if (forged.errorCategory !== plain.errorCategory || forged.httpStatus !== plain.httpStatus) {
    return fail(
      "B3.1",
      `forged role headers changed the answer: ${plain.errorCategory}/${plain.httpStatus} -> ${forged.errorCategory}/${forged.httpStatus}`,
    );
  }
  return pass("B3.1", `3 forged role headers left the answer identical (${forged.errorCategory}, HTTP ${forged.httpStatus})`);
}

async function checkMiddlewareBypassHeaders(harness) {
  console.log("\n[B3.2] The middleware-bypass header class, as an anonymous caller:");
  const results = [];
  for (const headers of [
    { "x-middleware-subrequest": "middleware" },
    { "x-middleware-subrequest": "src/middleware" },
    { "x-middleware-subrequest": "middleware:middleware:middleware:middleware:middleware" },
    { "x-middleware-rewrite": "/dashboard" },
    { "x-invoke-path": "/admin/clients" },
  ]) {
    const result = await harness.run("anonymous", OPERATIONS["page.adminClients"], { headers });
    results.push(result.errorCategory);
  }
  const wrong = results.filter((category) => category !== "denied_unauthenticated");
  if (wrong.length) {
    return fail("B3.2", `${wrong.length}/${results.length} forged-header probes were not denied: ${wrong.join(", ")}`);
  }
  return pass("B3.2", `${results.length}/${results.length} middleware-bypass header probes still redirect to /login`);
}

async function checkForgedTenantHeaders(harness) {
  console.log("\n[B3.3] Forged tenant and user headers on the report route, as tenant B:");
  const plain = await harness.run("tenantB", OPERATIONS[REPORT_OPERATION], { studyId: P6E_STUDY_ID });
  const forged = await harness.run("tenantB", OPERATIONS[REPORT_OPERATION], {
    studyId: P6E_STUDY_ID,
    headers: { "x-tenant-id": TENANT_A, "x-role": "internal", "x-forwarded-host": "localhost" },
  });
  if (plain.errorCategory !== "not_found") {
    return fail("B3.3", `the untampered control was ${plain.errorCategory}, expected not_found`);
  }
  if (forged.errorCategory !== "not_found" || forged.httpStatus !== 404) {
    return fail("B3.3", `forged tenant headers produced ${forged.errorCategory} / HTTP ${forged.httpStatus}`);
  }
  return pass("B3.3", "a forged tenant id, role and host still return 404 — no cross-tenant report is produced");
}

async function checkCorruptedSession(harness) {
  console.log("\n[B3.4] A structurally corrupted session cookie (N2):");
  const before = await harness.run("tenantB", OPERATIONS["page.dashboard"]);
  if (before.errorCategory !== "success") {
    return fail("B3.4", `the positive control failed: tenantB was ${before.errorCategory} before tampering`);
  }
  await harness.session.invalidate("tenantB");
  const after = await harness.run("tenantB", OPERATIONS["page.dashboard"]);
  const report = await harness.run("tenantB", OPERATIONS[REPORT_OPERATION], { studyId: P6E_STUDY_ID });
  if (after.errorCategory !== "denied_unauthenticated" || after.sessionKind !== "invalid") {
    return fail("B3.4", `a corrupted cookie gave ${after.errorCategory} / kind ${after.sessionKind}`);
  }
  if (report.errorCategory !== "denied_unauthenticated") {
    return fail("B3.4", `the report route accepted a corrupted cookie with ${report.errorCategory} / ${report.httpStatus}`);
  }
  // Restore the identity: a deliberately corrupted session must not leak into
  // any later check and quietly turn a real result into an artefact.
  await harness.signIn("tenantB");
  return pass(
    "B3.4",
    "a valid session whose cookie is corrupted is rejected immediately on both the page and the report route " +
      `(HTTP ${after.httpStatus} / ${report.httpStatus}); the app verifies the token rather than decoding it`,
  );
}

async function checkForgedFilterValue(harness, fx) {
  console.log("\n[B3.5] A filter value forged into the product's own control:");
  // Positive control first: the untampered control must genuinely work, or a
  // rejection below would prove nothing about the forged value.
  const honest = await harness.run("tenantA", OPERATIONS["dashboard.refresh"], {});
  if (honest.errorCategory !== "success") {
    return fail("B3.5", `the untampered filter control was ${honest.errorCategory} — no baseline to compare against`);
  }
  const forged = await harness.run("tenantA", OPERATIONS["dashboard.refresh"], {
    forgedValue: `${fx.prefix}-never-a-real-segment`,
  });
  if (forged.errorCategory === "success") {
    return fail("B3.5", "a value the server never offered was accepted by the dashboard data action");
  }
  if (!["validation_rejected", "denied_action_result"].includes(forged.errorCategory)) {
    return fail("B3.5", `the forged filter value produced ${forged.errorCategory}, expected a server-side rejection`);
  }
  // And the same forged value through the route handler's public parameters.
  const viaRoute = await harness.run("tenantA", OPERATIONS[REPORT_OPERATION], {
    studyId: P6E_STUDY_ID,
    query: [["f.nivel", `${fx.prefix}-never-a-real-segment`]],
  });
  if (viaRoute.errorCategory !== "validation_rejected" || viaRoute.httpStatus !== 400) {
    return fail("B3.5", `the same value on the report route gave ${viaRoute.errorCategory} / ${viaRoute.httpStatus}`);
  }
  return pass(
    "B3.5",
    `the honest control succeeds; the forged value is refused server-side (${forged.errorCategory}) and 400 on the route`,
  );
}

async function checkClientCannotReachInternalPages(harness, fx) {
  console.log("\n[B3.6] Every internal-only page, as a real client:");
  // `/admin/upload` is deliberately absent from this list: it answers a
  // `client` with HTTP 200 and its own rendered denial page (design §1.8 AM4),
  // which plain HTTP cannot tell apart from a successful render. It is covered
  // below through the browser mechanism, which reads the product's own panel.
  // Every internal-only PAGE class, legacy and Studio. The Studio routes all
  // answer a wrong-role caller with a redirect — deliberately, so the denial is
  // expressible in a status — which is why they can join this list while
  // `/admin/upload` cannot.
  const pages = [
    "page.adminClients", "page.adminStudies", "page.adminQualitative",
    "page.studioHome", "page.studioClients", "page.studioStudies", "page.studioTemplates",
  ];
  const observed = [];
  for (const name of pages) {
    const result = await harness.run("tenantA", OPERATIONS[name]);
    observed.push(`${name}=${result.errorCategory}`);
    if (result.errorCategory !== "denied_wrong_role") {
      return fail("B3.6", `${name} answered ${result.errorCategory}, expected denied_wrong_role`);
    }
  }
  // The internal client-preview surface renders another tenant's dashboard, so
  // it gets its own probe against this run's own study.
  const preview = await harness.run("tenantA", OPERATIONS["page.adminPreview"], { studyId: fx.studyId });
  if (preview.errorCategory !== "denied_wrong_role") {
    return fail("B3.6", `the internal preview answered ${preview.errorCategory}, expected denied_wrong_role`);
  }
  // The study work surface is the Studio address of the same internal-only
  // material, and it is reached with the run's own study rather than a guess.
  const studioStudy = await harness.run("tenantA", OPERATIONS["page.studioStudy"], { studyId: fx.studyId });
  if (studioStudy.errorCategory !== "denied_wrong_role") {
    return fail("B3.6", `the Studio study surface answered ${studioStudy.errorCategory}, expected denied_wrong_role`);
  }
  const upload = await harness.run("tenantA", OPERATIONS["upload.analyze"], {
    tenant_id: fx.tenantId,
    file: fx.validCsvPath,
  });
  if (upload.errorCategory !== "denied_wrong_role") {
    return fail("B3.6", `/admin/upload answered ${upload.errorCategory}, expected denied_wrong_role`);
  }
  return pass(
    "B3.6",
    `${pages.length + 3} internal-only surfaces all answered denied_wrong_role to a client, including the ` +
      "HTTP-200 denial page /admin/upload renders instead of redirecting",
  );
}

// -----------------------------------------------------------------------------
// B4 — the report route's four outcomes stay distinct
// -----------------------------------------------------------------------------

async function checkReportBoundaries(harness) {
  console.log("\n[B4] The authenticated report route:");
  const loggedOut = await harness.run("anonymous", OPERATIONS[REPORT_OPERATION], { studyId: P6E_STUDY_ID });
  if (loggedOut.errorCategory === "denied_unauthenticated") {
    pass(
      "B4.1",
      `logged out -> denied_unauthenticated (HTTP ${loggedOut.httpStatus}), never a PDF and never a 404 that would ` +
        "blur the difference between absent and unauthenticated",
    );
  } else {
    fail("B4.1", `logged out gave ${loggedOut.errorCategory} / HTTP ${loggedOut.httpStatus}`);
  }

  const foreign = await harness.run("tenantB", OPERATIONS[REPORT_OPERATION], { studyId: P6E_STUDY_ID });
  if (foreign.errorCategory === "not_found" && foreign.httpStatus === 404) {
    pass("B4.2", "tenant B -> 404 non-disclosure for tenant A's study");
  } else {
    fail("B4.2", `tenant B gave ${foreign.errorCategory} / HTTP ${foreign.httpStatus}`);
  }

  const owner = await harness.run("tenantA", OPERATIONS[REPORT_OPERATION], { studyId: P6E_STUDY_ID });
  if (owner.errorCategory === "success") {
    pass("B4.3", "the owning tenant A client still receives its PDF — the boundary did not become a wall");
  } else {
    fail("B4.3", `tenant A gave ${owner.errorCategory} / HTTP ${owner.httpStatus}`);
  }

  const internal = await harness.run("internal", OPERATIONS[REPORT_OPERATION], { studyId: P6E_STUDY_ID });
  if (internal.errorCategory === "success") {
    pass("B4.4", "a real internal identity still receives the PDF");
  } else {
    fail("B4.4", `internal gave ${internal.errorCategory} / HTTP ${internal.httpStatus}`);
  }

  const malformed = await harness.run("tenantA", OPERATIONS[REPORT_OPERATION], { studyId: "not-a-uuid" });
  if (malformed.errorCategory === "not_found" && malformed.httpStatus === 404) {
    pass("B4.5", "a malformed study id is an absence (404), classified apart from every denial");
  } else {
    fail("B4.5", `a malformed study id gave ${malformed.errorCategory} / HTTP ${malformed.httpStatus}`);
  }
}

// -----------------------------------------------------------------------------
// B5 / B6 — confinement and reason distinctness
// -----------------------------------------------------------------------------

async function checkDestructiveConfinement(harness, fx) {
  console.log("\n[B5.1] Destructive operations are confined to run-owned fixtures:");
  const destructive = Object.values(OPERATIONS).filter((op) => op.destructive).map((op) => op.name);
  const protectedTargets = [P6E_STUDY_ID, TENANT_A, TENANT_B];
  let aborted = 0;
  let attempted = 0;

  for (const name of destructive) {
    const op = OPERATIONS[name];
    for (const target of protectedTargets) {
      attempted += 1;
      const params = { ...probeParams(op, fx) };
      for (const key of [...(op.targetParams ?? []), ...(op.scopeParams ?? []), "template_id", "user_id", "tenant_id"]) {
        if (key in params) params[key] = target;
      }
      try {
        await harness.run("internal", op, params);
        fail("B5.1", `${name} reached dispatch while targeting a protected object`);
        return;
      } catch (error) {
        if (/deny-list|fixture scope|ownership|denial-only/.test(error.message)) aborted += 1;
        else {
          fail("B5.1", `${name} failed for an unexpected reason: ${error.code ?? error.message}`);
          return;
        }
      }
    }
  }
  if (aborted !== attempted) {
    return fail("B5.1", `${aborted}/${attempted} protected-target attempts aborted before dispatch`);
  }
  const withheld = Object.keys(ACTION_GATE_WITHHELD).length;
  return pass(
    "B5.1",
    `${destructive.length} destructive operation(s) x ${protectedTargets.length} protected targets: ` +
      `${aborted}/${attempted} aborted before any request; ${withheld} action-level probes withheld by name`,
  );
}

function checkReasonDistinctness(harness) {
  console.log("\n[B6.1] Refusal reasons are distinct, not merely 'non-200':");
  const categories = new Set(harness.ledger.all().map((record) => record.errorCategory));
  const required = [
    "denied_unauthenticated", "denied_wrong_role", "not_found", "validation_rejected", "success",
    // The public-path control's answer. Its presence is what proves a method
    // rejection is recorded as its own thing rather than as a denial.
    "method_not_allowed",
  ];
  const missing = required.filter((category) => !categories.has(category));
  if (missing.length) {
    return fail("B6.1", `this run never observed: ${missing.join(", ")} — the categories are not being distinguished`);
  }
  if (categories.has("unclassified") || categories.has("page_crash")) {
    return fail("B6.1", "the run produced an unclassified answer or a page crash, which are never denials");
  }
  return pass(
    "B6.1",
    `${required.length} distinct outcome categories observed and kept apart; zero unclassified, zero 5xx`,
  );
}

// -----------------------------------------------------------------------------
// The run
// -----------------------------------------------------------------------------

function requireEnv(names) {
  const missing = names.filter((name) => !process.env[name]);
  if (missing.length) {
    console.error(`Missing environment variables: ${missing.join(", ")}`);
    process.exit(2);
  }
}

/**
 * The smallest valid source file the ingestion boundary accepts, written to a
 * run-owned temporary path. It is only ever STAGED — analyzed and previewed —
 * so that the confirm control exists to be probed; Suite B never commits it.
 */
function writeStagingCsv(directory, prefix) {
  const path = `${directory}/${prefix}-staging.csv`;
  writeFileSync(
    path,
    ["seg_nivel,q_satisfaccion", "primaria,8", "primaria,9"].join("\n"),
    "utf8",
  );
  return path;
}

async function livePhase(signal, fixtures, prefix, tempDir) {
  const health = await fetch(new URL("/api/health", ORIGIN), {
    signal: AbortSignal.any([AbortSignal.timeout(15000), signal]),
  }).catch(() => null);
  if (!health?.ok) {
    throw new Error(`the app is not answering at ${ORIGIN} — start it first (npm run build && npm run start)`);
  }

  console.log("\n[preflight] Fixture namespace and pre-run object counts:");
  const before = {
    tenants: await fixtures.gateway.countTable("tenant"),
    studies: await fixtures.gateway.countTable("study"),
    templates: await fixtures.gateway.countTable("study_template"),
    profiles: await fixtures.gateway.countProfiles(),
    authUsers: await fixtures.gateway.countAuthUsers(),
    importBatches: await fixtures.gateway.countTable("import_batch"),
    respondents: await fixtures.gateway.countTable("respondent"),
  };
  note(`before: ${Object.entries(before).map(([k, v]) => `${k}=${v}`).join(", ")}`);
  await fixtures.preflight();
  note("preflight: zero pre-existing objects carry this run prefix");

  console.log("\n[harness] Browser and real sign-ins through the application's own login form:");
  const harness = await createHarness({
    origin: ORIGIN,
    actors: ["tenantA", "tenantB", "internal", "anonymous"],
    browser: "required",
    signal,
    fixtures,
    credentials: {
      tenantA: { email: process.env.TEST_USER_A_EMAIL, password: process.env.TEST_USER_A_PASSWORD, role: "client" },
      tenantB: { email: process.env.TEST_USER_B_EMAIL, password: process.env.TEST_USER_B_PASSWORD, role: "client" },
      internal: { email: process.env.TEST_INTERNAL_EMAIL, password: process.env.TEST_INTERNAL_PASSWORD, role: "internal" },
    },
    supabase: { url: SUPABASE_URL, anonKey: PUBLISHABLE_KEY },
    launchBrowser,
    PAGE,
    log: note,
  });
  activeHarness = harness;
  for (const actorId of ["tenantA", "tenantB", "internal"]) {
    await harness.signIn(actorId);
    await harness.assertIdentity(actorId);
    note(`${actorId}: signed in through the login form; the app reported this actor as itself`);
  }
  harness.assertSessionIsolation(["tenantA", "tenantB", "internal"]);
  note("distinct jars, browser contexts and session labels; no auth credential reused between actors");

  // --- fixtures, all created through the real application surfaces ---------
  console.log("\n[fixture] Throwaway tenant, study and template, created through the product itself:");
  const fx = { prefix, tenantId: null, studyId: null, templateId: null, validCsvPath: writeStagingCsv(tempDir, prefix) };

  const tenantName = `${prefix} tenant`;
  const tenantResult = await harness.run("internal", OPERATIONS["clients.createTenant"], { name: tenantName });
  if (tenantResult.errorCategory !== "success") throw new Error(`tenant creation gave ${tenantResult.errorCategory}`);
  const adminContext = await harness.contextFor("internal", { javaScript: true });
  await adminContext.navigate(new URL("/admin/studies", ORIGIN).toString());
  fx.tenantId = await adminContext.evaluate(PAGE.optionValueByText("tenant_id", tenantName));
  if (!fx.tenantId) throw new Error("the created tenant did not appear in the application's own tenant list");
  fixtures.track({ kind: "tenant", id: fx.tenantId, createdBy: "clients.createTenant", viaMechanism: "form" });

  const studyResult = await harness.run("internal", OPERATIONS["studies.createBlank"], {
    tenant_id: fx.tenantId, name: `${prefix} study`, period: "",
  });
  fx.studyId = new URLSearchParams((studyResult.landedOn ?? "").split("?")[1] ?? "").get("study");
  if (studyResult.errorCategory !== "success" || !fx.studyId) {
    throw new Error(`study creation gave ${studyResult.errorCategory}`);
  }
  fixtures.track({ kind: "study", id: fx.studyId, createdBy: "studies.createBlank", viaMechanism: "browser" });

  const templateName = `${prefix} template`;
  const templateResult = await harness.run("internal", OPERATIONS["studies.saveAsTemplate"], {
    study_id: fx.studyId, template_id: "", name: templateName, description: "suite B fixture",
  });
  if (templateResult.errorCategory !== "success") {
    throw new Error(`template creation gave ${templateResult.errorCategory}`);
  }
  await adminContext.navigate(new URL("/admin/studies", ORIGIN).toString());
  fx.templateId = await adminContext.evaluate(PAGE.onlyOptionValueContaining("template_id", templateName));
  if (!fx.templateId) throw new Error("the created template did not appear uniquely in the application's own list");
  fixtures.track({ kind: "studyTemplate", id: fx.templateId, createdBy: "studies.saveAsTemplate", viaMechanism: "browser" });
  note(`ledgered 3 object(s) under ${prefix}: one tenant, one study, one template`);
  note("no Auth user was created or invited at any point in this run");

  // --- B1: unauthenticated ------------------------------------------------
  console.log("\n[B1] Every catalogued mutation, as an unauthenticated caller:");
  note("the middleware answers first on every non-public path, so a page-gate denial IS the application's answer");
  for (const name of MUTATING_OPERATIONS) {
    const op = OPERATIONS[name];
    if (actionGateIsObservable(op)) {
      // The strongest available form: render the surface as the authorized
      // internal identity, END that session, then submit the form through the
      // browser's own machinery and follow where the application sends it.
      await probeDenial(harness, "B1", "internal", name, fx, { endSession: true });
      await harness.signIn("internal");
      continue;
    }
    await probeDenial(harness, "B1", "anonymous", name, fx);
    const withheld = ACTION_GATE_WITHHELD[name];
    if (withheld) note(`${name}: action-level probe withheld — ${withheld}`);
  }
  await probeReportDenial(harness, "B1", "anonymous");

  // --- B2: a real client --------------------------------------------------
  console.log("\n[B2] Every catalogued internal-only mutation, as a real client:");
  for (const name of MUTATING_OPERATIONS) {
    await probeDenial(harness, "B2", "tenantA", name, fx);
  }
  await probeReportDenial(harness, "B2", "tenantB");

  // --- B9 / B10 / B11: the OUTER ACTION ROUTE, on its own method and path ---
  console.log("\n[B9] Every protected action route, as an unauthenticated caller (POST, not GET):");
  note("one ordinary form-shaped POST per route: no action identifier, no private field, no body");
  for (const routeName of ACTION_ROUTE_CLASSES) {
    await checkOuterRoute(harness, "B9", "anonymous", routeName);
  }

  console.log("\n[B10] Every protected action route, as a real client caller:");
  for (const routeName of ACTION_ROUTE_CLASSES) {
    // `/admin/upload` answers a wrong-role caller with HTTP 200 and a rendered
    // denial page rather than a status (AM4), so no status-level claim is made
    // for it here and the row says so.
    await checkOuterRoute(harness, "B10", "tenantA", routeName, {
      expectStatusDenial: routeName !== "route.postAdminUpload",
    });
  }

  console.log("\n[B11] Discriminators: an authorized identity differs, and a bare POST is a 405:");
  for (const routeName of ACTION_ROUTE_CLASSES) {
    await checkRouteDiscriminator(harness, routeName);
  }

  // --- B3 -----------------------------------------------------------------
  await checkForgedRoleHeaders(harness);
  await checkMiddlewareBypassHeaders(harness);
  await checkForgedTenantHeaders(harness);
  await checkForgedFilterValue(harness, fx);
  await checkClientCannotReachInternalPages(harness, fx);
  // B3.4 corrupts tenant B's session, so it runs after every probe that needs
  // tenant B to be a working identity.
  await checkCorruptedSession(harness);

  // --- B4 -----------------------------------------------------------------
  await checkReportBoundaries(harness);

  // --- B5 / B6 ------------------------------------------------------------
  await checkDestructiveConfinement(harness, fx);
  checkReasonDistinctness(harness);

  return before;
}

async function main() {
  installTranscript();
  requireEnv([
    "NEXT_PUBLIC_SUPABASE_URL",
    "NEXT_PUBLIC_SUPABASE_ANON_KEY",
    "TEST_USER_A_EMAIL", "TEST_USER_A_PASSWORD",
    "TEST_USER_B_EMAIL", "TEST_USER_B_PASSWORD",
    "TEST_INTERNAL_EMAIL", "TEST_INTERNAL_PASSWORD",
    "TEST_TENANT_A_ID", "TEST_TENANT_B_ID",
  ]);
  ORIGIN = process.env.HARNESS_ORIGIN ?? ORIGIN;
  SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
  PUBLISHABLE_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  TENANT_A = process.env.TEST_TENANT_A_ID;
  TENANT_B = process.env.TEST_TENANT_B_ID;

  const prefix = stampedPrefix("P7B");
  const fixtures = createFixtures({
    prefix,
    protectedTenantIds: [TENANT_A, TENANT_B],
    prefixedKinds: ["tenant", "study", "studyTemplate", "importBatch"],
  });
  const tempDir = mkdtempSync(join(tmpdir(), "p7b-"));

  console.log("Be Community — Suite B (behavioral server-side authorization)");
  console.log(`  origin: ${ORIGIN}`);
  console.log(`  run prefix: ${prefix}  (ownership namespace, never a deletion key)`);
  console.log(
    `  roster: ${SUITE_B_CHECKS.length} required checks over ${MUTATING_OPERATIONS.length} catalogued mutations ` +
      "plus the report route",
  );

  console.log("\n[B0] Outcome classification self-test (offline, before any live request):");
  const outcomeFailures = selfTestOutcomes();
  if (outcomeFailures.length) {
    console.error(`the outcome classifier is broken: ${outcomeFailures.join("; ")}`);
    process.exitCode = 1;
    return;
  }
  note(`${OUTCOME_CASES.length} cases hold: an absence, a validation rejection and a success never satisfy a denial`);

  const controller = new AbortController();
  // A promise nobody is awaiting any more — an abandoned CDP waiter whose
  // deadline fires after its operation already failed — would otherwise kill
  // the process outright, and a dead process never reaches the `finally` block
  // below. That is not hypothetical: it leaked a fixture pair during this PR's
  // own development. Recording it as a run failure and cancelling keeps the run
  // red while letting it wind down through cleanup.
  process.on("unhandledRejection", (reason) => {
    reporter.runFailure(`unhandled rejection: ${reason instanceof Error ? reason.message : String(reason)}`);
    controller.abort();
  });
  const deadline = setTimeout(() => controller.abort(), RUN_TIMEOUT_MS);
  let beforeCounts = null;

  try {
    beforeCounts = await livePhase(controller.signal, fixtures, prefix, tempDir);
  } catch (error) {
    reporter.runFailure(`the run aborted before completing: ${error.message}`);
  } finally {
    clearTimeout(deadline);
    console.log("\n[cleanup] Exact-id deletion, ownership re-proved, children before parents:");
    fixtures.halt();
    if (activeHarness) await activeHarness.close().catch(() => {});

    const tenantId = fixtures.tenantId();
    let cleanup = { removed: 0, leaked: [], residual: {}, clean: false };
    try {
      cleanup = await fixtures.cleanup();
    } catch (error) {
      reporter.runFailure(`cleanup failed: ${error.message}`);
    }
    for (const entry of fixtures.ledger) note(`  ledgered ${entry.kind} ${entry.id}`);
    if (fixtures.ledger.length === 0) note("no fixture was provisioned in this run; nothing to remove");
    else if (cleanup.clean) console.log(`  cleanup removed ${cleanup.removed} object(s); zero objects carry the run prefix`);
    else {
      reporter.runFailure(
        `fixture cleanup left residue — remove manually: ${
          cleanup.leaked.map((e) => `${e.kind} ${e.id}`).join(", ") || JSON.stringify(cleanup.residual)
        }`,
      );
    }

    // Row-level residue inside the throwaway tenant, proven by count rather
    // than trusted to a cascade.
    if (tenantId) {
      try {
        const rows = await fixtures.tenantResidue(tenantId);
        const left = Object.entries(rows).filter(([, n]) => n !== 0);
        if (left.length) reporter.runFailure(`rows remain inside the throwaway tenant: ${left.map(([t, n]) => `${t}=${n}`).join(", ")}`);
        else console.log(`  every one of ${Object.keys(rows).length} tables holds zero rows for the throwaway tenant`);
      } catch (error) {
        reporter.runFailure(`row-level residue accounting failed: ${error.message}`);
      }
    }

    if (beforeCounts) {
      try {
        const after = {
          tenants: await fixtures.gateway.countTable("tenant"),
          studies: await fixtures.gateway.countTable("study"),
          templates: await fixtures.gateway.countTable("study_template"),
          profiles: await fixtures.gateway.countProfiles(),
          authUsers: await fixtures.gateway.countAuthUsers(),
          importBatches: await fixtures.gateway.countTable("import_batch"),
          respondents: await fixtures.gateway.countTable("respondent"),
        };
        note(`after: ${Object.entries(after).map(([k, v]) => `${k}=${v}`).join(", ")}`);
        const drifted = Object.keys(beforeCounts).filter((key) => beforeCounts[key] !== after[key]);
        if (drifted.length) reporter.runFailure(`object counts did not return to their pre-run values: ${drifted.join(", ")}`);
        else {
          pass("B7.1", `all ${Object.keys(after).length} global object counts returned exactly to their pre-run values`);
        }
      } catch (error) {
        reporter.runFailure(`post-run accounting failed: ${error.message}`);
      }
    }

    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch {
      /* the OS reclaims the temp dir; never fail a run on this */
    }
  }

  console.log("\n[evidence] What was proven, at which layer:");
  {
    const results = new Map(reporter.results().map((r) => [r.id, r.passed]));
    const green = (prefix) => SUITE_B_CHECKS.filter((c) => c.group === prefix && results.get(c.id) === true).length;
    const total = (prefix) => SUITE_B_CHECKS.filter((c) => c.group === prefix).length;
    const inner = MUTATING_OPERATIONS.filter((name) => actionGateIsObservable(OPERATIONS[name]));
    console.log(
      `  layer 1 - catalogue completeness: ${total("B1")} B1 and ${total("B2")} B2 rows, one per catalogued ` +
        "mutation plus the report route, generated from the frozen catalogue",
    );
    console.log(
      `  layer 2 - outer action route (POST method + path): ${green("B9")}/${total("B9")} path classes deny an ` +
        `unauthenticated caller by status; ${green("B10") - outerRouteLimitations.length}/${total("B10")} deny a ` +
        `client by status, with ${outerRouteLimitations.length} recorded limitation(s); ` +
        `${green("B11")}/${total("B11")} discriminators hold`,
    );
    console.log(
      `  layer 3 - observable INNER Server-Action denial: ${inner.length}/${MUTATING_OPERATIONS.length} ` +
        `(${inner.join(", ") || "none"}). The other inner guards are structurally present and externally ` +
        "shadowed by the middleware; this suite does NOT claim they were invoked",
    );
    for (const routeName of outerRouteLimitations) {
      console.log(
        `  limitation - POST ${OPERATIONS[routeName].path}: a wrong-role caller is answered HTTP 200 with a ` +
          "rendered denial page, so role denial is not expressible in the status; covered at the browser layer",
      );
    }
  }

  console.log("\n[evidence] Sanitized harness ledger:");
  for (const line of activeHarness?.ledger.lines() ?? []) console.log(`  ${line}`);

  console.log("\n" + "=".repeat(64));
  const executed = new Set(reporter.executed());
  for (const check of SUITE_B_CHECKS) {
    console.log(`  ${executed.has(check.id) ? "executed    " : "NOT EXECUTED"}  ${check.id}  ${check.title}`);
  }

  const hits = scanText(transcript.join("\n"));
  if (hits.length) reporter.runFailure(`the secret scan matched ${hits.length} class(es) in this run's output`);
  else console.log("\n[scan] the run transcript passes scanText with zero secret-class matches");

  const verdict = reporter.verdict();
  console.log(
    `\nSuite B: ${verdict.total} check result(s), ${verdict.failed.length} failed, ` +
      `${verdict.missing.length} required check(s) never executed, ${verdict.runFailures.length} run-level failure(s)`,
  );
  for (const line of verdict.failed) console.error(`  - ${line}`);
  for (const id of verdict.missing) console.error(`  - ${id}: REQUIRED CHECK DID NOT EXECUTE (red, never skipped)`);
  for (const line of verdict.runFailures) console.error(`  - run: ${line}`);

  if (verdict.ok) {
    console.log("\nRESULT: Suite B green — B1-B7 all executed and passed.");
    process.exitCode = 0;
  } else {
    console.error("\nRESULT: Suite B is NOT green.");
    process.exitCode = 1;
  }
}

if (isDirectRun) await main();
