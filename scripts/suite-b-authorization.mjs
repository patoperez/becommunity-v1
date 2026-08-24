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

function rosterFor(prefix, title) {
  return [...MUTATING_OPERATIONS, REPORT_OPERATION].map((name) => ({
    id: `${prefix}/${name}`,
    group: prefix,
    title: `${title}: ${name}`,
  }));
}

export const SUITE_B_CHECKS = Object.freeze([
  ...rosterFor("B1", "an unauthenticated caller is rejected before any side effect"),
  ...rosterFor("B2", "a real client caller is rejected before any side effect"),
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
 * B1 for the report route is ordinary HTTP: the handler answers 401 itself
 * rather than redirecting, which is a different and stronger statement than a
 * middleware redirect and must be asserted as such.
 */
async function probeReportDenial(harness, group, actorId) {
  const id = `${group}/${REPORT_OPERATION}`;
  const result = await harness.run(actorId, OPERATIONS[REPORT_OPERATION], { studyId: P6E_STUDY_ID });
  if (group === "B1") {
    if (result.errorCategory === "denied_unauthenticated" && result.httpStatus === 401) {
      return pass(id, "an unauthenticated caller receives 401 from the route handler itself");
    }
    return fail(id, `unauthenticated gave ${result.errorCategory} / HTTP ${result.httpStatus}, expected 401`);
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
  if (report.errorCategory !== "denied_unauthenticated" || report.httpStatus !== 401) {
    return fail("B3.4", `the report route accepted a corrupted cookie with ${report.errorCategory} / ${report.httpStatus}`);
  }
  return pass("B3.4", "a valid session whose cookie is corrupted is rejected immediately on both the page and the route (401)");
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
  const pages = ["page.adminClients", "page.adminStudies", "page.adminQualitative", "page.adminUpload"];
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
  return pass("B3.6", `${pages.length + 1} internal-only surfaces all answered denied_wrong_role to a client`);
}

// -----------------------------------------------------------------------------
// B4 — the report route's four outcomes stay distinct
// -----------------------------------------------------------------------------

async function checkReportBoundaries(harness) {
  console.log("\n[B4] The authenticated report route:");
  const loggedOut = await harness.run("anonymous", OPERATIONS[REPORT_OPERATION], { studyId: P6E_STUDY_ID });
  if (loggedOut.errorCategory === "denied_unauthenticated" && loggedOut.httpStatus === 401) {
    pass("B4.1", "logged out -> 401 from the handler, not a redirect and not a PDF");
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
  const required = ["denied_unauthenticated", "denied_wrong_role", "not_found", "validation_rejected", "success"];
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
  for (const name of MUTATING_OPERATIONS) {
    const withheld = ACTION_GATE_WITHHELD[name];
    if (withheld) {
      await probeDenial(harness, "B1", "anonymous", name, fx);
      note(`${name}: action-level probe withheld — ${withheld}`);
      continue;
    }
    // The strong form: load the surface as the authorized internal identity,
    // END that session, then invoke the action through the app's own runtime.
    await probeDenial(harness, "B1", "internal", name, fx, { endSession: true });
    await harness.signIn("internal");
  }
  await probeReportDenial(harness, "B1", "anonymous");

  // --- B2: a real client --------------------------------------------------
  console.log("\n[B2] Every catalogued internal-only mutation, as a real client:");
  for (const name of MUTATING_OPERATIONS) {
    await probeDenial(harness, "B2", "tenantA", name, fx);
  }
  await probeReportDenial(harness, "B2", "tenantB");

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
