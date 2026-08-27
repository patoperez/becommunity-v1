// =============================================================================
// Suite A — tenant isolation, data-scope enforcement and least privilege.
// docs/P7_PLAN.md §5 (A1–A5), §6.1, §9.1 PR 6.
// =============================================================================
//
//   node --env-file=.env.local scripts/suite-a-isolation.mjs      (npm run suite:a)
//
// Prerequisites: the application running at HARNESS_ORIGIN (default
// http://localhost:3000) against the synthetic project, the .env.local fixture
// accounts, and a supported browser. Without a browser the run exits non-zero as
// unsupported — never green, never "skipped".
//
// WHAT MAKES A RESULT ADMISSIBLE HERE
// Every authorization verdict is produced by a REAL identity that signed in
// through the publishable-key path — the application's own login form for the
// app surfaces, `signInWithPassword` for the PostgREST surfaces. The privileged
// fixture gateway in `lib/harness-fixtures.mjs` is used for four things, and
// only these: provisioning the temporary scoped identity; bounded metadata
// accounting and reconciliation; exact cleanup; and the A5.2 composite-FK
// integrity probe. The first three never issue a request whose result is
// asserted. A5.2 does, and is labelled throughout — in its own heading, its own
// output line and its roster title — as a privileged DATABASE-INTEGRITY control.
// It is never client-authorization evidence.
//
// WHAT IS NEVER PRINTED
// No email, password, token, cookie, key, JWT fragment, response body or row of
// business data. Output is actor labels, check ids, categories, counts and
// sanitized status/error codes. The whole transcript is scanned before exit.
//
// MERGED GATES
// A1.5 executes `scripts/isolation-test.mjs` and A4.1 executes
// `scripts/rls-coverage-test.mjs` as child processes and requires exit 0. Their
// coverage is therefore preserved by execution, not by restatement, and both
// remain independently runnable as `npm run test:isolation` and
// `npm run test:rls-coverage`.
// =============================================================================

import { spawnSync } from "node:child_process";
import { createClient } from "@supabase/supabase-js";
import { scanText } from "./lib/secret-patterns.mjs";
import { OPERATIONS, createHarness } from "./lib/http-harness.mjs";
import { launchBrowser, PAGE } from "./lib/harness-browser.mjs";
import {
  createFixtures,
  newFixtureSecret,
  stampedPrefix,
  P6E_STUDY_ID,
} from "./lib/harness-fixtures.mjs";

const RUN_TIMEOUT_MS = 12 * 60 * 1000;

// -----------------------------------------------------------------------------
// The must-execute roster. A check that records no result is RED, never skipped.
// -----------------------------------------------------------------------------

export const SUITE_A_CHECKS = Object.freeze([
  { id: "A1.1", group: "A1", title: "anonymous PostgREST access is rejected or empty, classified by reason" },
  { id: "A1.2", group: "A1", title: "an authenticated tenant A client cannot read tenant B data" },
  { id: "A1.3", group: "A1", title: "an authenticated tenant A client cannot write tenant B data" },
  { id: "A1.4", group: "A1", title: "an authenticated client is read-only inside its own tenant" },
  { id: "A1.5", group: "A1", title: "the merged isolation gate (safe views, internal-only surfaces, RPCs) exits 0" },
  { id: "A2.1", group: "A2", title: "the scoped identity is genuinely restricted, proven as itself" },
  { id: "A2.2", group: "A2", title: "the dashboard data path enforces the profile scope, server-side" },
  { id: "A2.3", group: "A2", title: "the PDF report route enforces the profile scope" },
  { id: "A2.4", group: "A2", title: "PostgREST offers the scoped client no path around the application layer" },
  { id: "A2.5", group: "A2", title: "caller-supplied filters only narrow the profile scope" },
  { id: "A3.1", group: "A3", title: "a real internal identity reads the intended metadata across both tenants" },
  { id: "A3.2", group: "A3", title: "anonymous sees nothing on the internal and report surfaces" },
  { id: "A3.3", group: "A3", title: "a client gains no internal visibility from parameters, headers or tenant ids" },
  { id: "A4.1", group: "A4", title: "the executable RLS/FORCE-RLS coverage gate and 0014 privilege model exit 0" },
  { id: "A5.1", group: "A5", title: "client writes are denied by grant, cross-tenant and own-tenant" },
  { id: "A5.2", group: "A5", title: "a mismatched tenant/study stamp is rejected by the composite FK, zero rows" },
]);

// -----------------------------------------------------------------------------
// Result classification — pure, exercised offline by scripts/suite-a-selftest.mjs
// -----------------------------------------------------------------------------

export const PG = Object.freeze({
  DENIED: "denied_privilege",
  EMPTY: "empty",
  ROWS: "rows",
  ABSENT: "absent",
  OTHER: "other",
});

/**
 * A rejection counts only when it is a PRIVILEGE denial. An undefined table or
 * a missing function proves obscurity, not least privilege, so those classify
 * as `absent` and can never stand in for a denial.
 */
export function classifyPostgrest(result) {
  const error = result?.error ?? null;
  if (error) {
    if (error.code === "42501" || /permission denied/i.test(error.message ?? "")) return PG.DENIED;
    if (["PGRST202", "PGRST205", "42883", "42P01"].includes(error.code)) return PG.ABSENT;
    return PG.OTHER;
  }
  const data = result?.data;
  if (Array.isArray(data)) return data.length > 0 ? PG.ROWS : PG.EMPTY;
  return data == null ? PG.EMPTY : PG.ROWS;
}

/** The reasons an anonymous read is acceptable: denied outright, or empty by RLS. */
export function anonymousReadIsSafe(category) {
  return category === PG.DENIED || category === PG.EMPTY;
}

export const CLASSIFIER_CASES = Object.freeze([
  { what: "42501 permission denied", input: { error: { code: "42501" } }, expect: PG.DENIED },
  { what: "a message-only permission denial", input: { error: { message: "permission denied for table x" } }, expect: PG.DENIED },
  { what: "an undefined table", input: { error: { code: "42P01" } }, expect: PG.ABSENT },
  { what: "an unexposed function", input: { error: { code: "PGRST202" } }, expect: PG.ABSENT },
  { what: "an unrelated error", input: { error: { code: "23503" } }, expect: PG.OTHER },
  { what: "zero rows", input: { data: [] }, expect: PG.EMPTY },
  { what: "one row", input: { data: [{ id: "x" }] }, expect: PG.ROWS },
  { what: "a null single", input: { data: null }, expect: PG.EMPTY },
  { what: "an object single", input: { data: { id: "x" } }, expect: PG.ROWS },
]);

export function selfTestClassifier() {
  return CLASSIFIER_CASES.flatMap((testCase) => {
    const got = classifyPostgrest(testCase.input);
    return got === testCase.expect ? [] : [`${testCase.what}: expected ${testCase.expect}, got ${got}`];
  });
}

// -----------------------------------------------------------------------------
// Reporter — enforces the must-execute roster
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
    /**
     * A failure that belongs to the run itself — an abort, a cleanup residue, a
     * metadata drift — rather than to one check. Kept separate so a run-level
     * problem is never mis-attributed to a security check that did pass.
     */
    runFailure(message) {
      runFailures.push(message);
      log(`  FAIL RUN   ${message}`);
    },
    /** Green only when every roster id ran, nothing failed, and the run was clean. */
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
// The synthetic scope this run provisions
// -----------------------------------------------------------------------------
//
// Values belong to the accepted P6E synthetic dataset (`docs/CURRENT_STATE.md`).
// They are never assumed: A2's precondition proves, through the UNSCOPED tenant A
// client, that both values are legitimately reachable in the tenant before any
// scoped assertion is made. A restriction that is invisible because the value
// does not exist would prove nothing.
const SCOPE_DIMENSION = "nivel";
const IN_SCOPE_VALUE = "primaria";
const OUT_OF_SCOPE_VALUE = "secundaria";
const ORTHOGONAL_DIMENSION = "genero";
const ORTHOGONAL_VALUE = "F";
const FIXTURE_SCOPE = Object.freeze({ [SCOPE_DIMENSION]: [IN_SCOPE_VALUE] });

const TENANT_SCOPED_TABLES = ["study", "respondent", "quant_response", "qual_observation", "segment_dimension", "journey_definition"];
const RAW_TABLES = ["respondent", "quant_response", "qual_observation", "segment_dimension", "journey_definition", "confirmed_qual_observation"];
const INTERNAL_ONLY_TABLES = ["import_mapping", "recoding_table", "import_batch", "study_template"];
const ZERO_ID = "00000000-0000-0000-0000-000000000000";

// -----------------------------------------------------------------------------
// In-page probes. Every one returns COUNTS AND BOOLEANS, never a rendered value.
// Controls are located by accessible name only, exactly as the harness requires.
// -----------------------------------------------------------------------------

const STATUS_EXPR = `(() => {
  const node = [...document.querySelectorAll('[aria-live="polite"]')]
    .find((n) => /unidades de respuesta|Muestra insuficiente|Actualizando/.test(n.textContent || ''));
  return node ? (node.textContent || '').trim() : '';
})()`;

const filterProbe = (dimension, probeValue) => `
(() => {
  const select = [...document.querySelectorAll('select')].find(
    (s) => (s.getAttribute('aria-label') || '') === ${JSON.stringify(`Filtrar por ${dimension}`)},
  );
  if (!select) return { found: false };
  const values = [...select.options].map((o) => o.value).filter((v) => v !== '');
  const status = ${STATUS_EXPR};
  const units = status.match(/(\\d+)\\s+de\\s+(\\d+)\\s+unidades/);
  return {
    found: true,
    optionCount: values.length,
    includesProbe: values.includes(${JSON.stringify(probeValue)}),
    selectedUnits: units ? Number(units[1]) : null,
    sourceUnits: units ? Number(units[2]) : null,
  };
})()`;

// -----------------------------------------------------------------------------
// Runtime. Everything below runs only when this file is EXECUTED, so
// scripts/suite-a-selftest.mjs can import the pure logic above without
// provisioning a fixture, reading a credential or touching the network.
// -----------------------------------------------------------------------------

const isDirectRun =
  import.meta.main ?? Boolean(process.argv[1] && process.argv[1].endsWith("suite-a-isolation.mjs"));

/** The whole transcript is scanned for secret classes before the process exits. */
const transcript = [];
function installTranscript() {
  const realLog = console.log.bind(console);
  const realError = console.error.bind(console);
  console.log = (...args) => { transcript.push(args.join(" ")); realLog(...args); };
  console.error = (...args) => { transcript.push(args.join(" ")); realError(...args); };
}

const note = (message) => console.log(`       ${message}`);
const reporter = createReporter(SUITE_A_CHECKS, { log: (line) => console.log(line) });
const pass = (id, message) => reporter.pass(id, message);
const fail = (id, message) => reporter.fail(id, message);

// Assigned once, at the top of main(), from the verified environment.
let ORIGIN = "http://localhost:3000";
let SUPABASE_URL = "";
let PUBLISHABLE_KEY = "";
let TENANT_A = "";
let TENANT_B = "";
let activeHarness = null;

const openSessions = [];

// -----------------------------------------------------------------------------
// Identities. Only the publishable key is ever used to obtain one.
// -----------------------------------------------------------------------------

function publishableClient() {
  return createClient(SUPABASE_URL, PUBLISHABLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function signInIdentity(label, email, password) {
  const client = publishableClient();
  const { error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`sign-in failed for ${label} (${error.code ?? error.status ?? "error"})`);
  const { data, error: userError } = await client.auth.getUser();
  if (userError || !data?.user) throw new Error(`no server-verified user for ${label}`);
  if (data.user.role !== "authenticated") {
    throw new Error(`the verified session role for ${label} is "${data.user.role}", expected "authenticated"`);
  }
  openSessions.push(client);
  return { label, client, userId: data.user.id };
}

/** The access token of an already-signed-in identity. In memory only, never printed. */
async function accessTokenOf(identity) {
  const { data } = await identity.client.auth.getSession();
  const token = data?.session?.access_token;
  if (!token) throw new Error(`no access token on the ${identity.label} session`);
  return token;
}

// -----------------------------------------------------------------------------
// Merged gates, executed as child processes so their coverage is preserved by
// EXECUTION rather than by restatement.
// -----------------------------------------------------------------------------

function runMergedGate(id, script, label) {
  const result = spawnSync(process.execPath, [script], {
    encoding: "utf8",
    env: process.env,
    timeout: 5 * 60 * 1000,
  });
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`.trimEnd();
  for (const line of output.split("\n")) if (line.trim()) note(`| ${line}`);
  if (result.error) return fail(id, `${label} could not be executed (${result.error.code ?? result.error.message})`);
  if (result.status === 0) return pass(id, `${label} executed and exited 0`);
  return fail(id, `${label} exited ${result.status ?? "by signal"}`);
}

// -----------------------------------------------------------------------------
// A1 — tenant isolation
// -----------------------------------------------------------------------------

async function checkAnonymous() {
  console.log("\n[A1.1] Anonymous PostgREST access, classified by reason:");
  const anon = publishableClient();
  const surfaces = [...new Set([...TENANT_SCOPED_TABLES, ...RAW_TABLES, ...INTERNAL_ONLY_TABLES, "tenant", "profiles"])];
  const leaked = [];
  const reasons = { [PG.DENIED]: 0, [PG.EMPTY]: 0 };
  const wrong = [];
  for (const table of surfaces) {
    const category = classifyPostgrest(await anon.from(table).select("*").limit(1));
    if (category === PG.ROWS) leaked.push(table);
    else if (anonymousReadIsSafe(category)) reasons[category] += 1;
    else wrong.push(`${table}=${category}`);
  }
  if (leaked.length) return fail("A1.1", `anonymous read returned rows from: ${leaked.join(", ")}`);
  if (wrong.length) return fail("A1.1", `anonymous read rejected for the WRONG reason: ${wrong.join(", ")}`);
  return pass(
    "A1.1",
    `${surfaces.length} surfaces closed to anonymous — ${reasons[PG.DENIED]} denied by privilege, ${reasons[PG.EMPTY]} empty by RLS`,
  );
}

async function checkCrossTenantRead(clientA) {
  console.log("\n[A1.2] Cross-tenant READ (tenant A client querying tenant B):");
  const studyCategory = classifyPostgrest(
    await clientA.client.from("study").select("id, tenant_id").eq("tenant_id", TENANT_B),
  );
  if (studyCategory !== PG.EMPTY) return fail("A1.2", `tenant B study metadata came back as ${studyCategory}`);
  const wrong = [];
  for (const table of RAW_TABLES) {
    const category = classifyPostgrest(await clientA.client.from(table).select("*").limit(1));
    if (category !== PG.DENIED) wrong.push(`${table}=${category}`);
  }
  if (wrong.length) return fail("A1.2", `raw surface(s) not denied by privilege: ${wrong.join(", ")}`);
  return pass("A1.2", `zero tenant B study rows; ${RAW_TABLES.length} raw surfaces denied by privilege (42501)`);
}

async function checkCrossTenantWrite(clientA) {
  console.log("\n[A1.3] Cross-tenant WRITE (tenant A client inserting into tenant B):");
  // One attempt, no retry. A grant-level denial is decided before any row is
  // considered, so nothing is created on either the pass or the failure path.
  const category = classifyPostgrest(
    await clientA.client.from("quant_response").insert({
      tenant_id: TENANT_B, study_id: ZERO_ID, metric_key: "suite_a_probe", value: 1,
    }),
  );
  if (category === PG.DENIED) return pass("A1.3", "insert into tenant B denied by privilege (42501)");
  return fail("A1.3", `insert into tenant B classified as ${category}, expected a privilege denial`);
}

async function checkOwnTenantWrite(id, identity) {
  console.log(`\n[${id}] Own-tenant WRITE by ${identity.label} (must be denied by grant):`);
  const wrong = [];
  const insert = classifyPostgrest(
    await identity.client.from("quant_response").insert({
      tenant_id: ZERO_ID, study_id: ZERO_ID, metric_key: "suite_a_probe", value: 1,
    }),
  );
  if (insert !== PG.DENIED) wrong.push(`insert quant_response=${insert}`);
  for (const table of TENANT_SCOPED_TABLES) {
    // Both target a non-existent id: a missing grant denies regardless of row
    // match, so no real row is ever reachable by these probes.
    const updated = classifyPostgrest(await identity.client.from(table).update({ tenant_id: ZERO_ID }).eq("id", ZERO_ID));
    if (updated !== PG.DENIED) wrong.push(`update ${table}=${updated}`);
    const deleted = classifyPostgrest(await identity.client.from(table).delete().eq("id", ZERO_ID));
    if (deleted !== PG.DENIED) wrong.push(`delete ${table}=${deleted}`);
  }
  if (wrong.length) return fail(id, `write(s) not denied by privilege: ${wrong.join(", ")}`);
  return pass(id, `${identity.label}: insert plus ${TENANT_SCOPED_TABLES.length} update/delete pairs all denied (42501)`);
}

// -----------------------------------------------------------------------------
// A2 — behavioral `profiles.data_scope` enforcement (the A2 substitute, R2)
// -----------------------------------------------------------------------------

async function checkScopedIdentity(scoped) {
  console.log("\n[A2.1] The scoped identity, proven by reading its own profile as itself:");
  const { data, error } = await scoped.client
    .from("profiles")
    .select("tenant_id, role, data_scope")
    .eq("user_id", scoped.userId)
    .maybeSingle();
  if (error || !data) return fail("A2.1", `the scoped identity could not read its own profile (${error?.code ?? "no row"})`);
  const scope = data.data_scope ?? {};
  const dimensions = Object.keys(scope);
  const restricted =
    data.role === "client" &&
    data.tenant_id === TENANT_A &&
    dimensions.length === 1 &&
    dimensions[0] === SCOPE_DIMENSION &&
    Array.isArray(scope[SCOPE_DIMENSION]) &&
    scope[SCOPE_DIMENSION].length === 1 &&
    scope[SCOPE_DIMENSION][0] === IN_SCOPE_VALUE;
  if (!restricted) {
    return fail("A2.1", `the fixture is not restricted as configured (role=${data.role}, dimensions=${dimensions.length})`);
  }
  return pass("A2.1", `a real client identity in tenant A carrying exactly 1 scope dimension on "${SCOPE_DIMENSION}"`);
}

async function checkScopedDashboard(harness) {
  console.log("\n[A2.2] The dashboard data path, driven through the application's own controls:");
  const probe = filterProbe(SCOPE_DIMENSION, OUT_OF_SCOPE_VALUE);

  async function observe(actorId) {
    const context = await harness.contextFor(actorId, { javaScript: true });
    await context.navigate(new URL("/dashboard", ORIGIN).toString());
    if (!(await context.evaluate(PAGE.landmark))) throw new Error(`${actorId}: the dashboard did not render`);
    return { context, view: await context.evaluate(probe) };
  }

  const unscoped = await observe("tenantA");
  const scoped = await observe("scopedClient");
  if (!unscoped.view.found || !scoped.view.found) {
    return fail("A2.2", `the "${SCOPE_DIMENSION}" filter control was not rendered for both actors`);
  }
  note(
    `rendered options on "${SCOPE_DIMENSION}": unscoped=${unscoped.view.optionCount} ` +
      `(out-of-scope value offered: ${unscoped.view.includesProbe}), scoped=${scoped.view.optionCount} ` +
      `(offered: ${scoped.view.includesProbe})`,
  );
  note(`response units in view: unscoped=${unscoped.view.sourceUnits}, scoped=${scoped.view.sourceUnits}`);

  // Positive control first: an implementation that simply returned nothing must
  // not be able to pass this check.
  if (!(scoped.view.sourceUnits > 0) || scoped.view.optionCount < 1) {
    return fail("A2.2", "the scoped client saw no data at all — an empty result is not scope enforcement");
  }
  if (!unscoped.view.includesProbe || unscoped.view.optionCount <= scoped.view.optionCount) {
    return fail("A2.2", "the unscoped client did not see the wider tenant view, so no restriction can be attributed to scope");
  }
  if (scoped.view.includesProbe) {
    return fail("A2.2", `the scoped client was offered the out-of-scope value on "${SCOPE_DIMENSION}"`);
  }
  if (!(scoped.view.sourceUnits < unscoped.view.sourceUnits)) {
    return fail("A2.2", "the scoped client's response base was not narrower than the unscoped client's");
  }

  // Now the data ACTION, not just the first render: drive the study's own filter
  // control so the framework invokes the server, and require the returned view to
  // still be scope-limited. This is what proves the scope is re-derived on the
  // server for every data request rather than baked into the initial page.
  await scoped.context.evaluate(`window.__p7aStatus = ${STATUS_EXPR}; "ok";`);
  // The filter is located by its own frozen `aria-label`, not by the visible
  // label text. `StudyCard.tsx` renders `aria-label={`Filtrar por ${key}`}` from
  // the raw dimension key, which is a stable contract, while the VISIBLE label
  // is `characteristicLabel(key)` — humanised by P8, so "genero" now reads
  // "Genero" and a visible-text search finds nothing. Matching the aria-label
  // is what this control was always supposed to use; `changeSelectByLabel`
  // here was a driver bug, and it made a passing product look like a failing
  // one. The probe is not weakened: it still drives the real control and still
  // requires the returned view to stay scope-limited.
  const driven = await scoped.context.evaluate(
    PAGE.changeSelectByAriaLabel(`Filtrar por ${ORTHOGONAL_DIMENSION}`),
  );
  if (driven !== "ok") return fail("A2.2", `the "${ORTHOGONAL_DIMENSION}" control could not be driven (${driven})`);
  const settled = await scoped.context
    .waitForDom(
      `() => { const s = ${STATUS_EXPR}; return s !== '' && s !== window.__p7aStatus && !/Actualizando/.test(s); }`,
    )
    .catch(() => false);
  if (!settled) return fail("A2.2", "the dashboard data action never reported a settled result");
  const after = await scoped.context.evaluate(probe);
  if (!after.found || after.includesProbe || after.optionCount !== scoped.view.optionCount) {
    return fail("A2.2", `after a real data action the scoped view changed shape (offered: ${after.includesProbe})`);
  }
  return pass(
    "A2.2",
    `the scoped client sees ${scoped.view.optionCount}/${unscoped.view.optionCount} option(s) and ` +
      `${scoped.view.sourceUnits}/${unscoped.view.sourceUnits} response units, before AND after a real data action`,
  );
}

function reportRun(harness, actorId, query) {
  return harness.run(actorId, OPERATIONS["report.download"], { studyId: P6E_STUDY_ID, query });
}

async function checkScopedReport(harness) {
  console.log("\n[A2.3] The PDF report route, with caller-supplied filter parameters:");
  // Precondition, through the UNSCOPED tenant A client: both values are
  // legitimately reachable in this tenant. Without it, a 400 for the scoped
  // client could just mean the value does not exist anywhere.
  const wideIn = await reportRun(harness, "tenantA", [[`f.${SCOPE_DIMENSION}`, IN_SCOPE_VALUE]]);
  const wideOut = await reportRun(harness, "tenantA", [[`f.${SCOPE_DIMENSION}`, OUT_OF_SCOPE_VALUE]]);
  if (wideIn.errorCategory !== "success" || wideOut.errorCategory !== "success") {
    return fail(
      "A2.3",
      `precondition failed: the unscoped client got ${wideIn.errorCategory}/${wideOut.errorCategory} for the two values`,
    );
  }
  const scopedNone = await reportRun(harness, "scopedClient", undefined);
  const scopedIn = await reportRun(harness, "scopedClient", [[`f.${SCOPE_DIMENSION}`, IN_SCOPE_VALUE]]);
  const scopedOut = await reportRun(harness, "scopedClient", [[`f.${SCOPE_DIMENSION}`, OUT_OF_SCOPE_VALUE]]);
  if (scopedNone.errorCategory !== "success") {
    return fail("A2.3", `the scoped client could not obtain its own report at all (${scopedNone.errorCategory})`);
  }
  if (scopedIn.errorCategory !== "success") {
    return fail("A2.3", `the in-scope positive control failed (${scopedIn.errorCategory}) — an empty scope would also fail here`);
  }
  if (scopedOut.errorCategory !== "validation_rejected" || scopedOut.httpStatus !== 400) {
    return fail(
      "A2.3",
      `the out-of-scope request was ${scopedOut.errorCategory} / HTTP ${scopedOut.httpStatus}, expected a 400 rejection`,
    );
  }
  return pass(
    "A2.3",
    "unscoped: both values accepted; scoped: unfiltered and in-scope succeed with a PDF, out-of-scope rejected 400",
  );
}

async function checkScopedPostgrest(scoped) {
  console.log("\n[A2.4] Direct PostgREST access as the scoped client:");
  const wrong = [];
  for (const table of [...RAW_TABLES, ...INTERNAL_ONLY_TABLES]) {
    const category = classifyPostgrest(await scoped.client.from(table).select("*").limit(1));
    if (category !== PG.DENIED) wrong.push(`${table}=${category}`);
  }
  if (wrong.length) return fail("A2.4", `a direct read path exists around the app layer: ${wrong.join(", ")}`);

  // The one bypass that would make the scope meaningless: widening it in place.
  const widen = classifyPostgrest(
    await scoped.client.from("profiles").update({ data_scope: {} }).eq("user_id", scoped.userId),
  );
  if (widen !== PG.DENIED) return fail("A2.4", `the scoped client could rewrite its own data_scope (${widen})`);
  return pass(
    "A2.4",
    `${RAW_TABLES.length + INTERNAL_ONLY_TABLES.length} row-level surfaces denied by privilege; ` +
      "self-widening of data_scope denied (42501)",
  );
}

async function checkFiltersOnlyNarrow(harness) {
  console.log("\n[A2.5] Caller-supplied filters may narrow the scope, never widen or replace it:");
  const orthogonal = await reportRun(harness, "scopedClient", [[`f.${ORTHOGONAL_DIMENSION}`, ORTHOGONAL_VALUE]]);
  if (orthogonal.errorCategory !== "success") {
    return fail("A2.5", `narrowing on an orthogonal dimension failed (${orthogonal.errorCategory})`);
  }
  // A repeated parameter is the obvious attempt at "in scope OR out of scope".
  const repeated = await reportRun(harness, "scopedClient", [
    [`f.${SCOPE_DIMENSION}`, IN_SCOPE_VALUE],
    [`f.${SCOPE_DIMENSION}`, OUT_OF_SCOPE_VALUE],
  ]);
  if (repeated.errorCategory !== "validation_rejected") {
    return fail("A2.5", `a repeated scope parameter was ${repeated.errorCategory}, expected a rejection`);
  }
  // An unknown dimension must not become a new axis of access.
  const unknown = await reportRun(harness, "scopedClient", [["f.tenant_id", TENANT_B]]);
  if (unknown.errorCategory !== "validation_rejected") {
    return fail("A2.5", `an unknown filter dimension was ${unknown.errorCategory}, expected a rejection`);
  }
  return pass("A2.5", "orthogonal narrowing accepted; repeated scope parameter and unknown dimension both rejected 400");
}

// -----------------------------------------------------------------------------
// A3 — positive and negative role controls
// -----------------------------------------------------------------------------

async function checkInternalPositive(harness, internal) {
  console.log("\n[A3.1] Internal positive control (a real internal identity, no privileged key):");
  const { data, error } = await internal.client.from("study").select("id, tenant_id");
  if (error) return fail("A3.1", `the internal identity could not read study metadata (${error.code ?? error.message})`);
  const inA = (data ?? []).filter((row) => row.tenant_id === TENANT_A).length;
  const inB = (data ?? []).filter((row) => row.tenant_id === TENANT_B).length;
  if (inA < 1 || inB < 1) return fail("A3.1", `internal saw ${inA} tenant A and ${inB} tenant B studies — not both tenants`);
  const page = await harness.run("internal", OPERATIONS["page.adminStudies"]);
  if (page.errorCategory !== "success") return fail("A3.1", `the internal admin surface answered ${page.errorCategory}`);
  return pass("A3.1", `internal reads ${inA} tenant A and ${inB} tenant B studies and reaches /admin/studies (200)`);
}

async function checkAnonymousSeesNothing(harness) {
  console.log("\n[A3.2] Anonymous on the internal, dashboard and report surfaces:");
  const admin = await harness.run("anonymous", OPERATIONS["page.adminStudies"]);
  const report = await harness.run("anonymous", OPERATIONS["report.download"], { studyId: P6E_STUDY_ID });
  const dashboard = await harness.run("anonymous", OPERATIONS["page.dashboard"]);
  const categories = [admin.errorCategory, report.errorCategory, dashboard.errorCategory];
  if (categories.some((category) => category !== "denied_unauthenticated")) {
    return fail("A3.2", `anonymous outcomes were ${categories.join(", ")}, expected denied_unauthenticated for all three`);
  }
  return pass("A3.2", "anonymous is denied on /admin/studies, /dashboard and the report route");
}

async function checkClientVisibilityTampering(harness, clientA) {
  console.log("\n[A3.3] A client changing parameters, headers or tenant ids gains no internal visibility:");
  const byTenant = classifyPostgrest(await clientA.client.from("study").select("id").eq("tenant_id", TENANT_B));
  if (byTenant !== PG.EMPTY) return fail("A3.3", `targeting tenant B by parameter returned ${byTenant}`);
  const otherProfiles = classifyPostgrest(await clientA.client.from("profiles").select("user_id").eq("tenant_id", TENANT_B));
  if (otherProfiles !== PG.EMPTY) return fail("A3.3", `tenant B profiles returned ${otherProfiles}`);

  // The same request again, with forged role headers attached. PostgREST derives
  // the role from the signed token alone, and this proves that behaviorally. The
  // row count is read from the `content-range` HEADER; the body is never read.
  const token = await accessTokenOf(clientA);
  const forged = await fetch(
    `${SUPABASE_URL}/rest/v1/study?select=id&tenant_id=eq.${encodeURIComponent(TENANT_B)}`,
    {
      headers: {
        apikey: PUBLISHABLE_KEY,
        Authorization: `Bearer ${token}`,
        "x-role": "internal",
        "x-user-role": "privileged",
        Prefer: "count=exact",
        Range: "0-0",
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(15000),
    },
  );
  const forgedRows = Number((forged.headers.get("content-range") ?? "").split("/")[1] ?? NaN);
  if (forged.status >= 400 || forgedRows !== 0) {
    return fail("A3.3", `forged role headers changed the answer (status ${forged.status}, rows ${forgedRows})`);
  }

  const adminPage = await harness.run("tenantA", OPERATIONS["page.adminStudies"]);
  if (adminPage.errorCategory !== "denied_wrong_role") {
    return fail("A3.3", `a client reaching /admin/studies got ${adminPage.errorCategory}, expected denied_wrong_role`);
  }
  const foreignReport = await harness.run("tenantB", OPERATIONS["report.download"], { studyId: P6E_STUDY_ID });
  if (foreignReport.errorCategory !== "not_found") {
    return fail("A3.3", `a foreign tenant's report request got ${foreignReport.errorCategory}, expected not_found`);
  }
  return pass(
    "A3.3",
    "tenant-id parameters and forged role headers return zero rows; /admin/studies denies the client; a foreign report is 404",
  );
}

// -----------------------------------------------------------------------------
// A5.2 — privileged database-integrity control (NOT client authorization)
// -----------------------------------------------------------------------------

async function checkTenantStamping(fixtures, marker) {
  console.log("\n[A5.2] Composite-FK tenant stamping (privileged DATABASE INTEGRITY control):");
  note("this control runs through the privileged fixture gateway; it is not evidence about client authorization");
  const before = await fixtures.gateway.countTable("import_batch");
  const probe = await fixtures.gateway.probeCompositeTenantStamp({
    studyId: P6E_STUDY_ID,
    mismatchedTenantId: TENANT_B,
    marker,
  });
  const after = await fixtures.gateway.countTable("import_batch");
  if (!probe.rejected) return fail("A5.2", "a batch stamped with a tenant that does not own the study was ACCEPTED");
  if (probe.code !== "23503") {
    return fail("A5.2", `the mismatched stamp was rejected for the WRONG reason (${probe.code ?? "unknown"}), expected 23503`);
  }
  if (probe.rowsWithMarker !== 0 || after !== before) {
    return fail("A5.2", `the rejected write left residue (marked rows ${probe.rowsWithMarker}, table ${before} -> ${after})`);
  }
  return pass(
    "A5.2",
    `the composite FK rejected the mismatched tenant/study stamp (23503); import_batch ${before} -> ${after}, zero marked rows`,
  );
}

// -----------------------------------------------------------------------------
// The run
// -----------------------------------------------------------------------------

function requireEnv(names) {
  const missing = names.filter((name) => !process.env[name]);
  if (missing.length) {
    // Reached before any fixture exists, so there is no cleanup for it to skip.
    console.error(`Missing environment variables: ${missing.join(", ")}`);
    process.exit(2);
  }
}

async function livePhase(signal, fixtures, prefix) {
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
    profiles: await fixtures.gateway.countProfiles(),
    authUsers: await fixtures.gateway.countAuthUsers(),
    importBatches: await fixtures.gateway.countTable("import_batch"),
  };
  note(`before: ${Object.entries(before).map(([k, v]) => `${k}=${v}`).join(", ")}`);
  await fixtures.preflight();
  note("preflight: zero pre-existing objects carry this run prefix");

  // --- provision the temporary scoped identity ------------------------------
  console.log("\n[fixture] Provisioning the temporary scoped client identity:");
  const email = `${prefix.toLowerCase()}@example.com`;
  const fullName = `${prefix} scoped client fixture`;
  const secret = newFixtureSecret();
  const created = await fixtures.gateway.createAuthUser({ email, password: secret });
  fixtures.track({ kind: "authUser", id: created.id, createdBy: "suite-a", viaMechanism: "admin-api" });
  await fixtures.gateway.upsertClientProfile({
    userId: created.id,
    tenantId: TENANT_A,
    fullName,
    dataScope: FIXTURE_SCOPE,
  });
  fixtures.track({ kind: "clientProfile", id: created.id, createdBy: "suite-a", viaMechanism: "admin-api" });
  note(`ledgered 2 object(s) under ${prefix}; the address is confirmed in place, so no invitation and no message exist`);

  // --- the harness, with the scoped actor as a first-class identity ----------
  console.log("\n[harness] Browser and real sign-ins through the application's own login form:");
  const harness = await createHarness({
    origin: ORIGIN,
    actors: ["tenantA", "tenantB", "internal", "scopedClient", "anonymous"],
    browser: "required",
    signal,
    fixtures,
    credentials: {
      tenantA: { email: process.env.TEST_USER_A_EMAIL, password: process.env.TEST_USER_A_PASSWORD, role: "client" },
      tenantB: { email: process.env.TEST_USER_B_EMAIL, password: process.env.TEST_USER_B_PASSWORD, role: "client" },
      internal: { email: process.env.TEST_INTERNAL_EMAIL, password: process.env.TEST_INTERNAL_PASSWORD, role: "internal" },
      scopedClient: { email, password: secret, role: "client" },
    },
    supabase: { url: SUPABASE_URL, anonKey: PUBLISHABLE_KEY },
    launchBrowser,
    PAGE,
    log: note,
  });
  activeHarness = harness;
  for (const actorId of ["tenantA", "tenantB", "internal", "scopedClient"]) {
    await harness.signIn(actorId);
    await harness.assertIdentity(actorId);
    note(`${actorId}: signed in through the login form; the app reported this actor as itself`);
  }
  harness.assertSessionIsolation(["tenantA", "tenantB", "internal", "scopedClient"]);
  note("distinct jars, browser contexts and session labels; no auth credential reused between actors");

  // --- PostgREST identities (publishable key only) --------------------------
  const clientA = await signInIdentity("tenantA", process.env.TEST_USER_A_EMAIL, process.env.TEST_USER_A_PASSWORD);
  const internal = await signInIdentity("internal", process.env.TEST_INTERNAL_EMAIL, process.env.TEST_INTERNAL_PASSWORD);
  const scoped = await signInIdentity("scopedClient", email, secret);

  // --- A1 -------------------------------------------------------------------
  await checkAnonymous();
  await checkCrossTenantRead(clientA);
  await checkCrossTenantWrite(clientA);
  await checkOwnTenantWrite("A1.4", clientA);
  console.log("\n[A1.5] Merged gate — scripts/isolation-test.mjs:");
  runMergedGate("A1.5", "scripts/isolation-test.mjs", "the merged isolation gate");

  // --- A2 -------------------------------------------------------------------
  await checkScopedIdentity(scoped);
  await checkScopedDashboard(harness);
  await checkScopedReport(harness);
  await checkScopedPostgrest(scoped);
  await checkFiltersOnlyNarrow(harness);

  // --- A3 -------------------------------------------------------------------
  await checkInternalPositive(harness, internal);
  await checkAnonymousSeesNothing(harness);
  await checkClientVisibilityTampering(harness, clientA);

  // --- A4 -------------------------------------------------------------------
  console.log("\n[A4.1] Merged gate — scripts/rls-coverage-test.mjs:");
  runMergedGate("A4.1", "scripts/rls-coverage-test.mjs", "the RLS coverage and 0014 privilege gate");

  // --- A5 -------------------------------------------------------------------
  await checkOwnTenantWrite("A5.1", scoped);
  await checkTenantStamping(fixtures, `${prefix}-stamp-probe.csv`);

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

  const prefix = stampedPrefix("P7A");
  // The privileged credential stays inside the fixtures module; the suite holds
  // only this handle, and only for provisioning, counting and exact deletion.
  const fixtures = createFixtures({
    prefix,
    protectedTenantIds: [TENANT_A, TENANT_B],
    prefixedKinds: ["clientProfile", "authUser"],
    homeTenantId: TENANT_A,
  });

  console.log("Be Community — Suite A (tenant isolation, data scope, least privilege)");
  console.log(`  origin: ${ORIGIN}`);
  console.log(`  run prefix: ${prefix}  (ownership namespace, never a deletion key)`);

  console.log("\n[A0] Result classifier self-test (offline, before any live request):");
  const classifierFailures = selfTestClassifier();
  if (classifierFailures.length) {
    console.error(`the result classifier is broken: ${classifierFailures.join("; ")}`);
    process.exitCode = 1;
    return;
  }
  note(`${CLASSIFIER_CASES.length} classification cases hold; obscurity never counts as a privilege denial`);

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
    beforeCounts = await livePhase(controller.signal, fixtures, prefix);
  } catch (error) {
    // Never attributed to a security check: an aborted run leaves the remaining
    // roster entries UNEXECUTED, and unexecuted is already red.
    reporter.runFailure(`the run aborted before completing: ${error.message}`);
  } finally {
    clearTimeout(deadline);
    // Entered on success, on assertion failure, on exception AND on timeout.
    console.log("\n[cleanup] Exact-id deletion, ownership re-proved, children before parents:");
    fixtures.halt();
    if (activeHarness) await activeHarness.close().catch(() => {});
    for (const session of openSessions) await session.auth.signOut({ scope: "local" }).catch(() => {});

    let cleanup = { removed: 0, leaked: [], residual: {}, clean: false };
    try {
      cleanup = await fixtures.cleanup();
    } catch (error) {
      reporter.runFailure(`cleanup failed: ${error.message}`);
    }
    for (const entry of fixtures.ledger) note(`  ledgered ${entry.kind} ${entry.id}`);
    if (fixtures.ledger.length === 0) note("no fixture was provisioned in this run; nothing to remove");
    else if (cleanup.clean) {
      console.log(`  cleanup removed ${cleanup.removed} object(s); zero objects carry the run prefix`);
    } else {
      reporter.runFailure(
        `fixture cleanup left residue — remove manually: ${
          cleanup.leaked.map((e) => `${e.kind} ${e.id}`).join(", ") || JSON.stringify(cleanup.residual)
        }`,
      );
    }

    if (beforeCounts) {
      try {
        const after = {
          tenants: await fixtures.gateway.countTable("tenant"),
          studies: await fixtures.gateway.countTable("study"),
          profiles: await fixtures.gateway.countProfiles(),
          authUsers: await fixtures.gateway.countAuthUsers(),
          importBatches: await fixtures.gateway.countTable("import_batch"),
        };
        note(`after: ${Object.entries(after).map(([k, v]) => `${k}=${v}`).join(", ")}`);
        const drifted = Object.keys(beforeCounts).filter((key) => beforeCounts[key] !== after[key]);
        if (drifted.length) reporter.runFailure(`object counts did not return to their pre-run values: ${drifted.join(", ")}`);
        else console.log("  every tenant/study/profile/auth/import count returned to its pre-run value");
      } catch (error) {
        reporter.runFailure(`post-run accounting failed: ${error.message}`);
      }
    }
  }

  console.log("\n[evidence] Sanitized harness ledger:");
  for (const line of activeHarness?.ledger.lines() ?? []) console.log(`  ${line}`);

  console.log("\n" + "=".repeat(64));
  const executed = new Set(reporter.executed());
  for (const check of SUITE_A_CHECKS) {
    console.log(`  ${executed.has(check.id) ? "executed    " : "NOT EXECUTED"}  ${check.id}  ${check.title}`);
  }

  const hits = scanText(transcript.join("\n"));
  if (hits.length) reporter.runFailure(`the secret scan matched ${hits.length} class(es) in this run's output`);
  else console.log("\n[scan] the run transcript passes scanText with zero secret-class matches");

  const verdict = reporter.verdict();
  console.log(
    `\nSuite A: ${verdict.total} check result(s), ${verdict.failed.length} failed, ` +
      `${verdict.missing.length} required check(s) never executed, ${verdict.runFailures.length} run-level failure(s)`,
  );
  for (const line of verdict.failed) console.error(`  - ${line}`);
  for (const id of verdict.missing) console.error(`  - ${id}: REQUIRED CHECK DID NOT EXECUTE (red, never skipped)`);
  for (const line of verdict.runFailures) console.error(`  - run: ${line}`);

  if (verdict.ok) {
    console.log("\nRESULT: Suite A green — A1-A5 all executed and passed.");
    process.exitCode = 0;
  } else {
    console.error("\nRESULT: Suite A is NOT green.");
    process.exitCode = 1;
  }
}

if (isDirectRun) await main();
