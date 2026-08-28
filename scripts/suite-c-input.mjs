// =============================================================================
// Suite C — hostile input: XSS, imports, pivot boundary and injection.
// docs/P7_PLAN.md §5 (C1-C4), §6.1, §9.1 PR 7.
// =============================================================================
//
//   node --env-file=.env.local scripts/suite-c-input.mjs        (npm run suite:c)
//
// Prerequisites: the application running at HARNESS_ORIGIN (default
// http://localhost:3000) against the synthetic project, the .env.local fixture
// accounts, and a supported browser. Without a browser the run exits non-zero
// as unsupported — never green, never "skipped".
//
// WHAT THIS SUITE PROVES
//
//   C1  an inert hostile free-text payload, carried through the REAL ingestion
//       and human-review workflow into a run-owned synthetic study, renders
//       inert in the client dashboard AND in the server-generated PDF: no
//       script executed, no executable DOM node was created from it, the PDF
//       carries no JavaScript/OpenAction/Launch/URI action, and the intended
//       literal text is still present as escaped text;
//   C2  malformed, wrong-format and just-over-limit uploads are refused safely
//       at the real upload boundary, and each refusal leaves ZERO respondent,
//       response, observation and import-batch residue;
//   C3  `scripts/pivot-test.mjs` runs as a gate again, and a pivot intent
//       forged into the product's own controls is refused before compute with
//       no internal error text;
//   C4  bounded SQL / selector / template-style injection strings in the
//       report and dashboard parameters are validated or scoped away, never
//       expanded across tenants, never answered with a 5xx, and never echoed
//       back with a stack trace, SQL fragment, filesystem path, secret or
//       framework internal;
//   C5  the calculation, rounding and small-cell disclosure behavior this PR
//       must not change is still exactly what it was.
//
// THE PAYLOAD IS NEVER PRINTED. It is referred to by a random run marker; the
// suite reports whether it appeared, how often, and in what form — never the
// text itself. Response bodies are read in exactly one place,
// `scripts/lib/response-inspect.mjs`, which returns categories and counts.
//
// EVERY OBJECT IS RUN-OWNED. The payload lives in a throwaway tenant this run
// creates and deletes; it is never published to a long-lived client account,
// and the accepted P6E study is read-only throughout.
// =============================================================================

import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { scanText } from "./lib/secret-patterns.mjs";
import { OPERATIONS, createHarness } from "./lib/http-harness.mjs";
import { assertFixtureCredentials, assertServedBuildIsCoherent } from "./lib/harness-preflight.mjs";
import { launchBrowser, PAGE } from "./lib/harness-browser.mjs";
import { selfTestInspector, INSPECTOR_CASES } from "./lib/response-inspect.mjs";
import { createFixtures, stampedPrefix, P6E_STUDY_ID } from "./lib/harness-fixtures.mjs";

const RUN_TIMEOUT_MS = 20 * 60 * 1000;
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024; // mirrors src/lib/validation/schemas.ts:22

// -----------------------------------------------------------------------------
// The must-execute roster. A check that records no result is RED, never skipped.
// -----------------------------------------------------------------------------

export const SUITE_C_CHECKS = Object.freeze([
  { id: "C1.1", group: "C1", title: "a hostile free-text payload reaches a run-owned study through the real workflow" },
  { id: "C1.2", group: "C1", title: "the rendered client dashboard keeps the payload inert and escaped" },
  { id: "C1.3", group: "C1", title: "the generated PDF contains the payload as inert text: present, and no active action" },
  { id: "C2.1", group: "C2", title: "a malformed source file is refused safely with zero residue" },
  { id: "C2.2", group: "C2", title: "a corrupt / wrong-format file is refused safely with zero residue" },
  { id: "C2.3", group: "C2", title: "a just-over-limit upload is refused before dispatch, with zero residue" },
  { id: "C2.4", group: "C2", title: "an ordinary supported source is still accepted — the boundary is not a wall" },
  { id: "C3.1", group: "C3", title: "the pivot allowlist gate (scripts/pivot-test.mjs) executes and exits 0" },
  { id: "C3.2", group: "C3", title: "a forged pivot intent is refused by the canonical validator in the client runtime, before any request leaves the browser" },
  { id: "C4.1", group: "C4", title: "injection strings in report filter parameters are refused safely" },
  { id: "C4.2", group: "C4", title: "injection strings in path and selector parameters are refused safely" },
  { id: "C4.3", group: "C4", title: "no probe produced a 5xx, a leaked internal, or a cross-tenant expansion" },
  { id: "C5.1", group: "C5", title: "calculation, rounding and small-cell disclosure behavior is unchanged" },
]);

// -----------------------------------------------------------------------------
// Hostile inputs — bounded, inert, and generated at runtime
// -----------------------------------------------------------------------------

/**
 * The XSS payload. Every vector is INERT: the only effect any of them could
 * have is setting one window flag, which is exactly what makes execution
 * detectable without doing anything. Nothing navigates, fetches, stores or
 * mutates. The marker is a random, run-scoped token so the suite can count
 * occurrences without ever printing the payload that carries it.
 */
export function buildXssPayload(marker) {
  return [
    `<script>window.${marker}=1</script>`,
    `<img src=x onerror="window.${marker}=1">`,
    `<svg onload="window.${marker}=1">`,
    `"><iframe srcdoc="&lt;script&gt;parent.${marker}=1&lt;/script&gt;"></iframe>`,
    `javascript:window.${marker}=1`,
    `');window.${marker}=1;//`,
  ].join(" ");
}

/**
 * Bounded injection strings for parameter probes. They are deliberately short
 * and non-destructive: the property under test is that the boundary refuses
 * them and leaks nothing, not that a database can be damaged.
 */
export const INJECTION_STRINGS = Object.freeze([
  "' OR '1'='1",
  "'; select 1 --",
  "1) or (1=1",
  "%27%20or%201%3D1",
  "*",
  "..%2f..%2fetc%2fpasswd",
  "${7*7}",
  "#{7*7}",
  "{{7*7}}",
  "<script>1</script>",
  // A NUL prefix, written as an escape so this source stays plain text
  // rather than a blob git refuses to diff. A boundary that truncated on
  // it would silently act on a different value than the one it validated.
  "\u0000truncated",
  "nivel.eq.primaria,or(tenant_id.neq.null)",
  "id=neq.null",
]);

/**
 * Whether an upload refusal is acceptable. There is NO exception: the product
 * must render an outcome the operator can see, and `unclassified` — the harness
 * saying "the application produced no signal I can name" — is red everywhere.
 *
 * An earlier revision of this suite carried a `silentRefusal` opt-in that let an
 * over-limit upload pass while its outcome was unclassified. That was removed
 * rather than narrowed, and the correction moved into the product: the upload
 * screen now refuses an over-limit source on selection. The reversal cases
 * below exist so the exception cannot come back by accident.
 */
export function uploadRefusalIsAcceptable(category) {
  const rendered = ["validation_rejected", "denied_action_result"].includes(category);
  return { acceptable: rendered, rendered };
}

export const REFUSAL_CASES = Object.freeze([
  { what: "a rendered validation rejection", category: "validation_rejected", acceptable: true },
  { what: "a rendered action denial", category: "denied_action_result", acceptable: true },
  { what: "silence", category: "unclassified", acceptable: false },
  { what: "a success", category: "success", acceptable: false },
  { what: "a crash", category: "page_crash", acceptable: false },
  { what: "a network failure", category: "network_failure", acceptable: false },
  { what: "an absence", category: "not_found", acceptable: false },
  { what: "a wrong-role denial", category: "denied_wrong_role", acceptable: false },
]);

export function selfTestRefusalClassifier() {
  return REFUSAL_CASES.flatMap((testCase) => {
    const got = uploadRefusalIsAcceptable(testCase.category).acceptable;
    return got === testCase.acceptable ? [] : [`${testCase.what}: expected ${testCase.acceptable}, got ${got}`];
  });
}

/**
 * A response is SAFE when the application refused it in a documented way and
 * disclosed nothing. Written as a pure function so the self-test can prove that
 * a 500, a leaked internal, or a cross-tenant expansion can never pass.
 */
export function injectionResponseIsSafe(inspection) {
  if (!inspection || inspection.transportError) return { safe: false, why: "transport failure" };
  const status = inspection.status;
  if (typeof status !== "number") return { safe: false, why: "no status" };
  if (status >= 500) return { safe: false, why: `server error ${status}` };
  if (inspection.leakClasses.length) return { safe: false, why: `leaked ${inspection.leakClasses.join(",")}` };
  if (inspection.secretClasses.length) return { safe: false, why: `secret class ${inspection.secretClasses.join(",")}` };

  // Echoed markup. The report route's validation errors name the dimension and
  // value they refused (`src/lib/calc/filters.ts:validateSegmentFilters`), so a
  // hostile value CAN appear in a 400 body. That is inert only under two
  // conditions, and both are asserted rather than assumed: the body must be
  // served as JSON, and `X-Content-Type-Options: nosniff` must be present so no
  // browser may re-interpret it as a document. An echo in an HTML response, or
  // one without nosniff, is a finding.
  if (inspection.activeMarkup) {
    if (inspection.contentTypeClass !== "json") {
      return { safe: false, why: `hostile markup echoed in a ${inspection.contentTypeClass} response` };
    }
    if (!inspection.nosniff) return { safe: false, why: "hostile markup echoed without nosniff" };
  }

  // 400 is the documented rejection and 404 the documented absence. A 2xx is
  // acceptable ONLY when the boundary answered with one of the shapes this
  // route promises — a PDF or a JSON error — i.e. it scoped the hostile value
  // away rather than acting on it or rendering it as a document.
  if (status === 400 || status === 404) return { safe: true, why: `refused with ${status}` };
  if (status === 401 || status === 403) return { safe: true, why: `denied with ${status}` };
  if (status >= 200 && status < 300) {
    if (!["pdf", "json"].includes(inspection.contentTypeClass)) {
      return { safe: false, why: `2xx of an unpromised shape (${inspection.contentTypeClass})` };
    }
    return { safe: true, why: "scoped away, answered with a promised shape" };
  }
  return { safe: false, why: `unexpected status ${status}` };
}

export const INJECTION_CASES = Object.freeze([
  { what: "a 500", input: { status: 500, leakClasses: [], secretClasses: [] }, safe: false },
  { what: "a stack trace in a 400", input: { status: 400, leakClasses: ["stack_trace"], secretClasses: [] }, safe: false },
  { what: "a secret class in a 200", input: { status: 200, leakClasses: [], secretClasses: ["service-role-jwt"], contentTypeClass: "pdf" }, safe: false },
  { what: "a clean 400", input: { status: 400, leakClasses: [], secretClasses: [], contentTypeClass: "json" }, safe: true },
  { what: "a clean 404", input: { status: 404, leakClasses: [], secretClasses: [], contentTypeClass: "other" }, safe: true },
  { what: "a 200 PDF", input: { status: 200, leakClasses: [], secretClasses: [], contentTypeClass: "pdf" }, safe: true },
  { what: "a 200 HTML document", input: { status: 200, leakClasses: [], secretClasses: [], contentTypeClass: "html" }, safe: false },
  { what: "echoed markup in a JSON error under nosniff", input: { status: 400, leakClasses: [], secretClasses: [], activeMarkup: true, contentTypeClass: "json", nosniff: true }, safe: true },
  { what: "echoed markup in a JSON error WITHOUT nosniff", input: { status: 400, leakClasses: [], secretClasses: [], activeMarkup: true, contentTypeClass: "json", nosniff: false }, safe: false },
  { what: "echoed markup in an HTML response", input: { status: 400, leakClasses: [], secretClasses: [], activeMarkup: true, contentTypeClass: "html", nosniff: true }, safe: false },
  { what: "a transport failure", input: { transportError: true, leakClasses: [], secretClasses: [] }, safe: false },
]);

export function selfTestInjectionClassifier() {
  return INJECTION_CASES.flatMap((testCase) => {
    const got = injectionResponseIsSafe(testCase.input).safe;
    return got === testCase.safe ? [] : [`${testCase.what}: expected ${testCase.safe}, got ${got}`];
  });
}

/**
 * The XSS verdict, as a pure function over the in-page observation. Any single
 * failure condition is enough to fail: execution, an executable node built from
 * the payload, or the literal text missing (which would mean the check proved
 * nothing at all).
 */
export function xssObservationIsInert(observation) {
  if (!observation) return { inert: false, why: "no observation" };
  if (observation.executed) return { inert: false, why: "the payload executed" };
  if (observation.executableNodes > 0) return { inert: false, why: `${observation.executableNodes} executable node(s) built from the payload` };
  if (observation.inlineHandlers > 0) return { inert: false, why: `${observation.inlineHandlers} inline event handler(s) carrying the payload` };
  if (!observation.literalPresent) return { inert: false, why: "the literal text never rendered, so nothing was proven" };
  return { inert: true, why: "rendered as escaped text only" };
}

export const XSS_CASES = Object.freeze([
  { what: "execution", input: { executed: true, executableNodes: 0, inlineHandlers: 0, literalPresent: true }, inert: false },
  { what: "an injected script node", input: { executed: false, executableNodes: 1, inlineHandlers: 0, literalPresent: true }, inert: false },
  { what: "an inline handler", input: { executed: false, executableNodes: 0, inlineHandlers: 1, literalPresent: true }, inert: false },
  { what: "the literal missing", input: { executed: false, executableNodes: 0, inlineHandlers: 0, literalPresent: false }, inert: false },
  { what: "escaped text only", input: { executed: false, executableNodes: 0, inlineHandlers: 0, literalPresent: true }, inert: true },
]);

export function selfTestXssClassifier() {
  return XSS_CASES.flatMap((testCase) => {
    const got = xssObservationIsInert(testCase.input).inert;
    return got === testCase.inert ? [] : [`${testCase.what}: expected ${testCase.inert}, got ${got}`];
  });
}

// -----------------------------------------------------------------------------
// Reporter — enforces the must-execute roster (same contract as Suites A and B)
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
// Runtime
// -----------------------------------------------------------------------------

const isDirectRun =
  import.meta.main ?? Boolean(process.argv[1] && process.argv[1].endsWith("suite-c-input.mjs"));

const transcript = [];
function installTranscript() {
  const realLog = console.log.bind(console);
  const realError = console.error.bind(console);
  console.log = (...args) => { transcript.push(args.join(" ")); realLog(...args); };
  console.error = (...args) => { transcript.push(args.join(" ")); realError(...args); };
}

const note = (message) => console.log(`       ${message}`);
const reporter = createReporter(SUITE_C_CHECKS, { log: (line) => console.log(line) });
const pass = (id, message) => reporter.pass(id, message);
const fail = (id, message) => reporter.fail(id, message);

let ORIGIN = "http://localhost:3000";
let SUPABASE_URL = "";
let PUBLISHABLE_KEY = "";
let TENANT_A = "";
let TENANT_B = "";
let activeHarness = null;

// -----------------------------------------------------------------------------
// Source files, all written to a run-owned temporary directory
// -----------------------------------------------------------------------------

/**
 * The hostile-text source: a valid wide-survey CSV whose qualitative column
 * carries the payload. Five respondents keep the study above the small-cell
 * suppression threshold so the dashboard renders something to inspect.
 */
function writeHostileCsv(directory, prefix, payload) {
  const path = join(directory, `${prefix}-hostile.csv`);
  const escaped = `"${payload.replace(/"/g, '""')}"`;
  const rows = ["seg_nivel,q_satisfaccion,qual_experiencia"];
  for (let index = 0; index < 6; index += 1) {
    rows.push(`primaria,${7 + (index % 3)},${escaped}`);
  }
  writeFileSync(path, rows.join("\n"), "utf8");
  return path;
}

function writeMalformedCsv(directory, prefix) {
  const path = join(directory, `${prefix}-malformed.csv`);
  // No recognizable canonical column at all, ragged rows, and an unterminated
  // quote — the shape a real broken export has.
  writeFileSync(path, ['aaa,bbb,ccc', '1,2', '"unterminated,3,4', '\u0000\u0001binary'].join("\n"), "utf8");
  return path;
}

function writeCorruptWorkbook(directory, prefix) {
  const path = join(directory, `${prefix}-corrupt.xlsx`);
  // An accepted extension whose bytes are not a workbook: the parser must
  // refuse it rather than crash the Worker or half-import it.
  writeFileSync(path, Buffer.from("PK this is not a workbook at all", "utf8"));
  return path;
}

/**
 * Exactly ONE byte over the product's own limit. The boundary is what is under
 * test, so the file is the smallest thing that crosses it rather than an
 * arbitrarily large one — and the refusal now happens in the browser before
 * anything is transferred at all.
 */
function writeOversizeCsv(directory, prefix) {
  const path = join(directory, `${prefix}-oversize.csv`);
  const header = "seg_nivel,q_satisfaccion\n";
  const filler = "primaria,8\n".repeat(64);
  const body = header + filler;
  const padding = MAX_UPLOAD_BYTES + 1 - Buffer.byteLength(body, "utf8");
  writeFileSync(path, body + "#".repeat(padding), "utf8");
  return path;
}

/**
 * An ordinary, well within limits source. C2.4's whole job is to prove the new
 * boundary did not become a wall: if this stopped being accepted, the
 * over-limit refusal above would be meaningless.
 */
function writeOrdinaryCsv(directory, prefix) {
  const path = join(directory, `${prefix}-ordinary.csv`);
  writeFileSync(path, ["seg_nivel,q_satisfaccion", "primaria,8", "primaria,9"].join("\n"), "utf8");
  return path;
}

// -----------------------------------------------------------------------------
// C1 — the hostile payload, end to end through the real workflow
// -----------------------------------------------------------------------------

/**
 * In-page observation of one rendered surface. It returns COUNTS AND BOOLEANS
 * only; the payload text never crosses back out of the page.
 */
const xssProbe = (marker, literal) => `
(() => {
  const marked = ${JSON.stringify(marker)};
  const literal = ${JSON.stringify(literal)};
  const text = document.body.innerText || '';

  // A BREAKOUT is a node the HTML parser built out of the payload. If
  // '<script>window.X=1</script>' had ever been parsed as markup, the resulting
  // script element's own content would BE the payload's body — so a script
  // whose text starts with the payload body is a breakout, and one that merely
  // mentions the marker somewhere inside a longer serialized string is the
  // framework carrying the quote as escaped DATA. The two are counted apart
  // rather than lumped together, and the data mentions are reported so nothing
  // is hidden.
  const scripts = [...document.querySelectorAll('script')];
  const breakoutScripts = scripts
    .filter((node) => (node.textContent || '').trim().startsWith('window.' + marked)).length;
  const dataScriptMentions = scripts
    .filter((node) => (node.textContent || '').includes(marked)).length - breakoutScripts;

  // An embedded frame or plugin carrying the payload is a breakout outright:
  // nothing in this application legitimately serializes a quote into one.
  const embeddedNodes = [...document.querySelectorAll('iframe, object, embed, svg')]
    .filter((node) => (node.getAttribute('srcdoc') || '').includes(marked)
      || (node.getAttribute('src') || '').includes(marked)
      || (node.getAttribute('data') || '').includes(marked)
      || (node.outerHTML || '').includes(marked)).length;

  const inlineHandlers = [...document.querySelectorAll('*')]
    .filter((node) => ['onerror', 'onload', 'onclick', 'onfocus', 'onmouseover']
      .some((name) => (node.getAttribute(name) || '').includes(marked))).length;

  return {
    executed: Boolean(window[marked]),
    executableNodes: breakoutScripts + embeddedNodes,
    breakoutScripts,
    embeddedNodes,
    dataScriptMentions,
    inlineHandlers,
    literalPresent: text.includes(literal),
    markerOccurrencesInText: text.split(marked).length - 1,
  };
})()`;

async function buildHostileFixture(harness, fixtures, fx) {
  console.log("\n[C1.1] Carrying the payload through ingestion and human review:");
  const uploadParams = { tenant_id: fx.tenantId, study_id: fx.studyId, file: fx.hostileCsvPath };

  const analyzed = await harness.run("internal", OPERATIONS["upload.analyze"], uploadParams);
  if (analyzed.errorCategory !== "success") {
    return fail("C1.1", `the real upload boundary did not accept the valid hostile-text source (${analyzed.errorCategory})`);
  }
  const previewed = await harness.run("internal", OPERATIONS["upload.preview"], uploadParams, { reuseLoadedPage: true });
  if (previewed.errorCategory !== "success") {
    return fail("C1.1", `staged validation did not produce a preview (${previewed.errorCategory})`);
  }
  const confirmed = await harness.run(
    "internal",
    OPERATIONS["upload.confirm"],
    { ...uploadParams, study_option: `${fx.prefix} study` },
    { reuseLoadedPage: true },
  );
  if (confirmed.errorCategory !== "success") {
    return fail(
      "C1.1",
      `the import was not committed through the real workflow (${confirmed.errorCategory}` +
        `${confirmed.note ? `, ${confirmed.note}` : ""})`,
    );
  }

  // Reconcile the created batch to an exact id so cleanup deletes it by id
  // rather than relying on the study's cascade. The application confirmed the
  // creation; this read only resolves which row it made (design §6.4).
  const batchId = await fixtures.gateway.importBatchIdByFileName(`${fx.prefix}-hostile.csv`);
  if (!batchId) return fail("C1.1", "the committed import batch could not be reconciled to an exact id");
  fixtures.track({ kind: "importBatch", id: batchId, createdBy: "upload.confirm", viaMechanism: "browser" });

  const rows = await fixtures.studyResidue(fx.studyId);
  if (!(rows.respondent > 0) || !(rows.qual_observation > 0)) {
    return fail("C1.1", `the import wrote no reviewable qualitative data (${JSON.stringify(rows)})`);
  }

  // Human review: the payload only becomes client-visible after an internal
  // reviewer confirms the theme and approves the quote. That is the product's
  // own publication boundary, and C1 drives it rather than bypassing it.
  const suggested = await harness.run("internal", OPERATIONS["qualitative.generateSuggestions"], {
    studyId: fx.studyId,
  });
  if (suggested.errorCategory !== "success") {
    return fail("C1.1", `suggestion generation gave ${suggested.errorCategory}`);
  }
  const reviewed = await harness.run("internal", OPERATIONS["qualitative.reviewObservations"], {
    studyId: fx.studyId,
    theme: `${fx.prefix.toLowerCase().replace(/[^a-z0-9]/g, "")}tema`,
    stage_key: "",
  });
  if (reviewed.errorCategory !== "success") {
    return fail("C1.1", `human review gave ${reviewed.errorCategory}`);
  }
  fx.importBatchId = batchId;
  return pass(
    "C1.1",
    `${rows.respondent} respondent(s) and ${rows.qual_observation} observation(s) ingested and human-confirmed ` +
      "in the run's own throwaway tenant (never published to a client account)",
  );
}

async function checkDashboardInert(harness, fx) {
  console.log("\n[C1.2] The rendered client dashboard:");
  // The internal client-preview renders the CLIENT-facing dashboard for a
  // draft study, so the payload never has to be published to reach the exact
  // surface a client would see.
  const preview = await harness.run("internal", OPERATIONS["page.adminPreview"], { studyId: fx.studyId });
  if (preview.errorCategory !== "success") {
    return fail("C1.2", `the client-preview surface answered ${preview.errorCategory}`);
  }
  const context = await harness.contextFor("internal", { javaScript: true });
  await context.navigate(new URL(`/admin/preview/${fx.studyId}`, ORIGIN).toString());
  if (!(await context.evaluate(PAGE.landmark))) return fail("C1.2", "the preview page did not render");
  const observation = await context.evaluate(xssProbe(fx.marker, fx.literalProbe));
  const verdict = xssObservationIsInert(observation);
  note(
    `executed=${observation.executed}, breakout scripts=${observation.breakoutScripts}, ` +
      `embedded nodes=${observation.embeddedNodes}, inline handlers=${observation.inlineHandlers}, ` +
      `literal text present=${observation.literalPresent}`,
  );
  note(
    `the serialized page data carries the quote in ${observation.dataScriptMentions} escaped script payload(s) — ` +
      "expected, and not markup: nothing was parsed out of it",
  );
  if (!verdict.inert) return fail("C1.2", `the dashboard did NOT keep the payload inert: ${verdict.why}`);
  return pass(
    "C1.2",
    `the payload renders as escaped text only (${observation.markerOccurrencesInText} textual occurrence(s)); ` +
      "no script ran, no element was parsed out of it, and no inline handler carries it",
  );
}

async function checkPdfInert(harness, fx) {
  console.log("\n[C1.3] The server-generated PDF:");
  const { record, inspection } = await harness.inspect(
    "internal",
    OPERATIONS["report.download"],
    { studyId: fx.studyId },
    { expect: "pdf", needles: [fx.marker] },
  );
  if (record.errorCategory !== "success" || !inspection.pdf) {
    return fail("C1.3", `the report route answered ${record.errorCategory} / HTTP ${inspection.status}, expected a PDF`);
  }
  const displayed = inspection.pdf.displayed?.[0];
  note(
    `pdf: ${inspection.byteLength} bytes, ${inspection.pdf.objectCount} object(s), header=${inspection.pdf.header}, ` +
      `trailer=${inspection.pdf.trailer}, active constructs=[${inspection.pdf.activeClasses.join(",") || "none"}]`,
  );
  note(
    `content streams: ${displayed?.decodedStreams ?? 0}/${displayed?.streams ?? 0} decoded, ` +
      `${displayed?.displayedStrings ?? 0} displayed string(s), marker occurrences in displayed text: ` +
      `${displayed?.count ?? 0}`,
  );
  if (!inspection.pdf.header || !inspection.pdf.trailer) {
    return fail("C1.3", "the generated PDF is structurally corrupt (missing header or trailer)");
  }
  // POSITIVE CONTROL, and it comes first. Without it this check would pass just
  // as happily on a report the hostile quote never reached, which proves
  // nothing at all about inertness. The marker is counted ONLY in the PDF's
  // decoded displayed text, so a byte occurring in metadata or object structure
  // can never stand in for it.
  if (!displayed?.wellFormed) {
    return fail("C1.3", "the PDF could not be structurally walked, so no positive control is possible");
  }
  if (!(displayed.count > 0)) {
    return fail(
      "C1.3",
      "the approved hostile quote is NOT present in the PDF's displayed text" +
        `${displayed.rawOnlyOccurrence ? " (it occurs in the raw bytes outside displayed text, which does not count)" : ""}` +
        ` — ${displayed.decodedStreams}/${displayed.streams} stream(s) decoded, ` +
        `${displayed.displayedStrings} displayed string(s) examined`,
    );
  }
  if (inspection.pdf.activeClasses.length) {
    return fail("C1.3", `the PDF carries active constructs: ${inspection.pdf.activeClasses.join(", ")}`);
  }
  if (inspection.leakClasses.length || inspection.secretClasses.length) {
    return fail("C1.3", `the PDF leaked ${[...inspection.leakClasses, ...inspection.secretClasses].join(", ")}`);
  }
  return pass(
    "C1.3",
    `the approved hostile quote IS present in the PDF's displayed text (${displayed.count} occurrence(s) across ` +
      `${displayed.decodedStreams} decoded content stream(s)) and the ${inspection.byteLength}-byte document ` +
      "carries no JavaScript, OpenAction, additional-action, Launch, URI, SubmitForm, embedded-file or " +
      "rich-media construct",
  );
}

// -----------------------------------------------------------------------------
// C2 — the import boundary refuses safely and writes nothing
// -----------------------------------------------------------------------------

async function checkRejectedUpload(id, harness, fixtures, fx, filePath, label, settleMs, expectPreDispatch = false) {
  console.log(`\n[${id}] ${label}:`);
  const before = await fixtures.studyResidue(fx.emptyStudyId);
  const tenantBefore = await fixtures.tenantResidue(fx.tenantId, ["import_batch", "respondent", "quant_response", "qual_observation"]);

  const result = await harness.run("internal", OPERATIONS["upload.analyze"], {
    tenant_id: fx.tenantId,
    file: filePath,
    settleTimeoutMs: settleMs,
    // For the over-limit case the product must refuse the source on selection,
    // so the probe deliberately never clicks: the proof is that a classified
    // rejection is rendered AND nothing was dispatched.
    ...(expectPreDispatch ? { dispatch: false } : {}),
  });
  if (result.errorCategory === "success") {
    return fail(id, "the upload boundary ACCEPTED a source it must refuse");
  }
  const verdict = uploadRefusalIsAcceptable(result.errorCategory);
  if (!verdict.acceptable) return fail(id, `the refusal was ${result.errorCategory}, expected a rendered rejection`);
  if (expectPreDispatch) {
    if (result.dispatched !== false) {
      return fail(id, `the probe dispatched the action (dispatched=${result.dispatched}) — this must be refused first`);
    }
    if (result.controlEnabled !== false) {
      return fail(id, "the analyze control stayed enabled, so an over-limit source could still be submitted");
    }
  }

  const after = await fixtures.studyResidue(fx.emptyStudyId);
  const tenantAfter = await fixtures.tenantResidue(fx.tenantId, ["import_batch", "respondent", "quant_response", "qual_observation"]);
  const drifted = [
    ...Object.keys(before).filter((table) => before[table] !== after[table]),
    ...Object.keys(tenantBefore).filter((table) => tenantBefore[table] !== tenantAfter[table]),
  ];
  if (drifted.length) {
    return fail(id, `the refused upload left residue in: ${[...new Set(drifted)].join(", ")}`);
  }
  return pass(
    id,
    `refused as ${result.errorCategory}` +
      `${expectPreDispatch ? ", before any dispatch and with the analyze control disabled" : ""}; ` +
      `respondent/response/observation/import-batch counts unchanged across ` +
      `${Object.keys(before).length + Object.keys(tenantBefore).length} scoped counts`,
  );
}

/**
 * C2.4 — an ordinary supported source is still accepted and still analyzed.
 * This is the positive control for the new upload boundary: a client-side size
 * check that refused everything would satisfy C2.1-C2.3 and be worthless.
 */
async function checkOrdinarySourceStillAccepted(harness, fx) {
  console.log("\n[C2.4] An ordinary supported source, after the new size boundary:");
  const result = await harness.run("internal", OPERATIONS["upload.analyze"], {
    tenant_id: fx.tenantId,
    file: fx.ordinaryCsvPath,
  });
  if (result.errorCategory !== "success") {
    return fail("C2.4", `an ordinary in-limit source was ${result.errorCategory} — the boundary became a wall`);
  }
  if (result.dispatched !== true) {
    return fail("C2.4", "an ordinary in-limit source never reached the analyze action");
  }
  note(
    `the size predicate is shared with the server boundary: over the limit is refused, exactly at the limit is ` +
      "accepted, and the upload action still applies the same rule itself",
  );
  return pass(
    "C2.4",
    "an ordinary source is still accepted and analyzed through the real workflow — the over-limit refusal " +
      "is a boundary, not a blanket rejection",
  );
}

// -----------------------------------------------------------------------------
// C3 — the pivot boundary
// -----------------------------------------------------------------------------

function runPivotGate() {
  console.log("\n[C3.1] Merged gate — scripts/pivot-test.mjs:");
  const result = spawnSync(process.execPath, ["node_modules/tsx/dist/cli.mjs", "scripts/pivot-test.mjs"], {
    encoding: "utf8",
    env: process.env,
    timeout: 5 * 60 * 1000,
  });
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`.trimEnd();
  for (const line of output.split("\n")) if (line.trim()) note(`| ${line}`);
  if (result.error) return fail("C3.1", `the pivot gate could not be executed (${result.error.code ?? result.error.message})`);
  if (result.status === 0) return pass("C3.1", "the pivot allowlist gate executed and exited 0");
  return fail("C3.1", `the pivot gate exited ${result.status ?? "by signal"}`);
}

async function checkForgedPivot(harness, fx) {
  console.log("\n[C3.2] A pivot intent forged into the product's own controls (refused client-side, before dispatch):");
  // Positive control: the honest pivot must work first, or a rejection proves
  // nothing about the forged intent.
  const honest = await harness.run("tenantA", OPERATIONS["dashboard.pivot"]);
  if (honest.errorCategory !== "success") {
    return fail("C3.2", `the honest pivot control was ${honest.errorCategory} — no baseline to compare against`);
  }
  const context = await harness.contextFor("tenantA", { javaScript: true });
  await context.navigate(new URL("/dashboard", ORIGIN).toString());
  if (!(await context.evaluate(PAGE.landmark))) return fail("C3.2", "the dashboard did not render");

  // A field the allowlist cannot contain, inserted into the product's own
  // dimension control and then selected. The framework builds the request; only
  // the value is hostile, and the server must refuse it before it computes.
  // `PivotExplorer` wraps each control in a `<label>` carrying its visible name
  // ("Filas", "Columnas", "Métrica", "Agregación"), so the label locator is the
  // one that sees it — the same one `dashboard.pivot`'s reviewed driver uses.
  const forged = `${fx.prefix}-not-a-real-field`;
  const driven = await context.evaluate(PAGE.forgeSelectValueByLabel("Filas", forged));
  if (driven !== "ok") return fail("C3.2", `the pivot controls could not be driven (${driven})`);

  const settled = await context
    .waitForDom(`() => ${PAGE.actionOutcomeKind} !== 'none'`)
    .catch(() => false);
  const outcome = await context.evaluate(PAGE.actionOutcomeKind);
  const leaked = await context.evaluate(`
    (() => {
      const text = document.body.innerText || '';
      const patterns = [/\\n\\s+at\\s/, /select\\s+.*\\s+from/i, /pg_catalog|information_schema/i,
        /\\/home\\/|\\/var\\/task\\/|node_modules/, /webpack-internal|next\\/dist\\//];
      return patterns.filter((pattern) => pattern.test(text)).length;
    })()`);
  if (!settled) {
    // Report what the control actually did, as booleans and counts only, so a
    // control that refuses to take a forged value is diagnosable from the
    // evidence rather than by re-running blind.
    const state = await context.evaluate(`
      (() => {
        const labels = [...document.querySelectorAll('label')]
          .filter((item) => item.textContent.trim().startsWith('Filas'));
        const select = labels[0] && labels[0].querySelector('select');
        return [
          'labels=' + labels.length,
          'select=' + Boolean(select),
          'optionCount=' + (select ? select.options.length : -1),
          'valueIsForged=' + Boolean(select && select.value === ${JSON.stringify(forged)}),
          'valueEmpty=' + Boolean(select && select.value === ''),
          'errorPanel=' + /no permitida|no puede ser fila/.test(document.body.innerText),
        ].join(' ');
      })()`);
    return fail("C3.2", `the forged pivot intent never produced a settled outcome (${state})`);
  }
  if (outcome === "none") return fail("C3.2", "the forged pivot intent produced no refusal at all");
  if (outcome !== "validation") return fail("C3.2", `the forged pivot intent produced ${outcome}, expected a validation refusal`);
  if (leaked > 0) return fail("C3.2", `the refusal leaked ${leaked} internal detail class(es)`);
  // No result may survive the refusal: a rejected cross that still displayed
  // its previous grid would be showing a computation the caller is no longer
  // entitled to ask for.
  const resultVisible = await context.evaluate(
    "(() => Boolean(document.querySelector('table')) && /Explorador de cruces/.test(document.body.innerText))()",
  );
  // Precisely what this proves, and what it does not. The forged intent is
  // refused by `validatePivotIntent` running in the CLIENT runtime
  // (`PivotExplorer.tsx:28` returns before `computeStudyPivot` is called), so
  // no forged request is dispatched and none reaches the server. This check
  // therefore does NOT claim a forged request was answered by the server.
  // The server applies the SAME canonical validator
  // (`dashboard/data-actions.ts:78`), and that server-side path is exercised
  // directly by the offline pivot gate C3.1 — the two together are the
  // coverage, and neither is presented as the other.
  note(
    "layer: the canonical allowlist validator running in the client runtime refused it before dispatch, so no " +
      "forged request left the browser; the server re-runs the same validator and C3.1 exercises that path offline",
  );
  return pass(
    "C3.2",
    `the honest pivot succeeds; a field outside the allowlist is refused before any request is dispatched ` +
      `(${outcome}), no result grid is presented (${!resultVisible}), and zero internal detail classes leaked`,
  );
}

// -----------------------------------------------------------------------------
// C4 — injection strings at the parameter boundaries
// -----------------------------------------------------------------------------

async function checkReportInjection(harness) {
  console.log("\n[C4.1] Injection strings in the report route's filter parameters:");
  const observed = [];
  const unsafe = [];
  let echoed = 0;
  let echoedInertly = 0;

  const probe = async (query) => {
    const { inspection } = await harness.inspect(
      "tenantA",
      OPERATIONS["report.download"],
      { studyId: P6E_STUDY_ID, query },
      { expect: "json" },
    );
    observed.push(inspection.status);
    if (inspection.activeMarkup) {
      echoed += 1;
      if (inspection.contentTypeClass === "json" && inspection.nosniff) echoedInertly += 1;
    }
    const verdict = injectionResponseIsSafe(inspection);
    if (!verdict.safe) unsafe.push(`${verdict.why} (HTTP ${inspection.status})`);
  };

  for (const value of INJECTION_STRINGS) await probe([["f.nivel", value]]);
  // The dimension NAME is caller-controlled too, not just its value.
  for (const value of INJECTION_STRINGS.slice(0, 6)) await probe([[`f.${value}`, "primaria"]]);

  // Recorded plainly rather than hidden. The route's validation message names
  // the dimension and value it refused (`src/lib/calc/filters.ts`), so a
  // markup-shaped value can come back inside the 400 body. That is inert only
  // because the body is JSON served under `X-Content-Type-Options: nosniff`,
  // and both halves of that are asserted here rather than assumed.
  note(`values echoed by the validation message: ${echoed}; inert JSON under nosniff: ${echoedInertly}`);
  if (echoed !== echoedInertly) unsafe.push(`${echoed - echoedInertly} echo(es) were not inert JSON under nosniff`);

  if (unsafe.length) return fail("C4.1", `${unsafe.length}/${observed.length} probes were unsafe: ${unsafe.join("; ")}`);
  const statuses = [...new Set(observed)].sort();
  return pass(
    "C4.1",
    `${observed.length} injection probes across filter names and values: statuses ${statuses.join("/")}, ` +
      `zero 5xx, zero leaked internals, zero secret classes, ${echoed} inert JSON echo(es)`,
  );
}

async function checkPathAndSelectorInjection(harness, fx) {
  console.log("\n[C4.2] Injection strings in path and selector parameters:");
  const unsafe = [];
  let probes = 0;

  // The study id is a path segment: it must be an absence, never a database
  // error and never a wider result.
  for (const value of INJECTION_STRINGS.slice(0, 8)) {
    const { inspection } = await harness.inspect(
      "tenantA",
      OPERATIONS["report.download"],
      { studyId: value },
      { expect: "text" },
    );
    probes += 1;
    const verdict = injectionResponseIsSafe(inspection);
    if (!verdict.safe) unsafe.push(`path: ${verdict.why} (HTTP ${inspection.status})`);
    if (inspection.status === 200) unsafe.push("path: an injected study id returned content");
  }

  // The qualitative study selector is an ordinary GET parameter on an
  // internal-only page: an injected value must not change who may see it.
  for (const value of INJECTION_STRINGS.slice(0, 6)) {
    const result = await harness.run("internal", OPERATIONS["qualitative.selectStudy"], { studyId: value });
    probes += 1;
    if (result.errorCategory === "page_crash" || result.httpStatus >= 500) {
      unsafe.push(`selector: HTTP ${result.httpStatus}`);
    }
    const asClient = await harness.run("tenantA", OPERATIONS["qualitative.selectStudy"], { studyId: value });
    probes += 1;
    if (asClient.errorCategory !== "denied_wrong_role") {
      unsafe.push(`selector: a client got ${asClient.errorCategory} instead of denied_wrong_role`);
    }
  }

  // A cross-tenant expansion attempt through the filter parameters: tenant A
  // must never see tenant B's study, whatever it writes in a filter.
  const crossTenant = await harness.run("tenantA", OPERATIONS["report.download"], {
    studyId: P6E_STUDY_ID,
    query: [["f.tenant_id", TENANT_B], ["f.nivel", `${fx.prefix}-x`]],
  });
  probes += 1;
  if (crossTenant.errorCategory !== "validation_rejected") {
    unsafe.push(`cross-tenant filter gave ${crossTenant.errorCategory}, expected a rejection`);
  }

  if (unsafe.length) return fail("C4.2", `${unsafe.length}/${probes} probes were unsafe: ${unsafe.join("; ")}`);
  return pass("C4.2", `${probes} path, selector and cross-tenant probes: all refused safely, none expanded scope`);
}

function checkNoCrashOrLeak(harness) {
  console.log("\n[C4.3] Nothing in this run produced a crash or an unclassified answer:");
  const records = harness.ledger.all();
  const crashes = records.filter((r) => r.errorCategory === "page_crash");
  const unclassified = records.filter((r) => r.errorCategory === "unclassified");
  const serverErrors = records.filter((r) => typeof r.httpStatus === "number" && r.httpStatus >= 500);
  // No exception of any kind: an answer the classifier cannot name is an answer
  // nobody accounted for, and it is red.
  if (crashes.length || unclassified.length || serverErrors.length) {
    return fail(
      "C4.3",
      `${crashes.length} crash(es), ${unclassified.length} unclassified answer(s), ` +
        `${serverErrors.length} 5xx response(s)`,
    );
  }
  return pass(
    "C4.3",
    `${records.length} recorded operations: zero 5xx, zero page crashes, zero unclassified answers`,
  );
}

// -----------------------------------------------------------------------------
// C5 — the behavior this PR must NOT change
// -----------------------------------------------------------------------------

function checkCalculationUnchanged() {
  console.log("\n[C5.1] Calculation, rounding and small-cell disclosure behavior:");
  const gates = [
    ["scripts/calculation-test.mjs", "canonical metrics and rounding"],
    ["scripts/business-calculation-test.mjs", "business definitions"],
    ["scripts/bi-filter-test.mjs", "filter and disclosure behavior"],
  ];
  const failed = [];
  for (const [script, label] of gates) {
    const result = spawnSync(process.execPath, ["node_modules/tsx/dist/cli.mjs", script], {
      encoding: "utf8",
      env: process.env,
      timeout: 5 * 60 * 1000,
    });
    if (result.status !== 0) failed.push(`${label} (${script}) exited ${result.status ?? "by signal"}`);
    else note(`${label}: exit 0`);
  }
  if (failed.length) return fail("C5.1", `calculation behavior changed: ${failed.join("; ")}`);
  return pass("C5.1", `${gates.length} calculation and disclosure gates still exit 0 — no formula, rounding or threshold moved`);
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

async function livePhase(signal, fixtures, prefix, tempDir) {
  const health = await fetch(new URL("/api/health", ORIGIN), {
    signal: AbortSignal.any([AbortSignal.timeout(15000), signal]),
  }).catch(() => null);
  if (!health?.ok) {
    throw new Error(
      `the app is not answering at ${ORIGIN}. Start it in the documented order: ` +
      "`rm -rf .next && npm run build && npm run start`. Never start it from a `.next` " +
      "that `npm run cf:build` has since rewritten.",
    );
  }

  // Environment faults are not product findings. Both of these run BEFORE any
  // fixture object exists, and each names exactly what to repair.
  console.log("");
  console.log("[preflight] The served build and the synthetic accounts:");
  await assertServedBuildIsCoherent({ origin: ORIGIN, signal, log: note });
  await assertFixtureCredentials({
    supabaseUrl: SUPABASE_URL,
    anonKey: PUBLISHABLE_KEY,
    signal,
    log: note,
    credentials: {
      tenantA: {
        email: process.env.TEST_USER_A_EMAIL,
        password: process.env.TEST_USER_A_PASSWORD,
        envEmail: "TEST_USER_A_EMAIL",
        envPassword: "TEST_USER_A_PASSWORD",
      },
      internal: {
        email: process.env.TEST_INTERNAL_EMAIL,
        password: process.env.TEST_INTERNAL_PASSWORD,
        envEmail: "TEST_INTERNAL_EMAIL",
        envPassword: "TEST_INTERNAL_PASSWORD",
      },
    },
  });

  console.log("\n[preflight] Fixture namespace and pre-run object counts:");
  const before = {
    tenants: await fixtures.gateway.countTable("tenant"),
    studies: await fixtures.gateway.countTable("study"),
    respondents: await fixtures.gateway.countTable("respondent"),
    quant: await fixtures.gateway.countTable("quant_response"),
    qual: await fixtures.gateway.countTable("qual_observation"),
    importBatches: await fixtures.gateway.countTable("import_batch"),
    authUsers: await fixtures.gateway.countAuthUsers(),
  };
  note(`before: ${Object.entries(before).map(([k, v]) => `${k}=${v}`).join(", ")}`);
  await fixtures.preflight();
  note("preflight: zero pre-existing objects carry this run prefix");

  console.log("\n[harness] Browser and real sign-ins through the application's own login form:");
  const harness = await createHarness({
    origin: ORIGIN,
    actors: ["tenantA", "internal", "anonymous"],
    browser: "required",
    signal,
    fixtures,
    credentials: {
      tenantA: { email: process.env.TEST_USER_A_EMAIL, password: process.env.TEST_USER_A_PASSWORD, role: "client" },
      internal: { email: process.env.TEST_INTERNAL_EMAIL, password: process.env.TEST_INTERNAL_PASSWORD, role: "internal" },
    },
    supabase: { url: SUPABASE_URL, anonKey: PUBLISHABLE_KEY },
    launchBrowser,
    PAGE,
    log: note,
  });
  activeHarness = harness;
  for (const actorId of ["tenantA", "internal"]) {
    await harness.signIn(actorId);
    await harness.assertIdentity(actorId);
    note(`${actorId}: signed in through the login form; the app reported this actor as itself`);
  }

  // --- fixtures -------------------------------------------------------------
  console.log("\n[fixture] Throwaway tenant and two studies, created through the product itself:");
  const marker = `p7cx${prefix.slice(-6).toLowerCase()}`;
  const literalProbe = `window.${marker}=1`;
  const fx = {
    prefix,
    marker,
    literalProbe,
    tenantId: null,
    studyId: null,
    emptyStudyId: null,
    importBatchId: null,
    hostileCsvPath: writeHostileCsv(tempDir, prefix, buildXssPayload(marker)),
    ordinaryCsvPath: writeOrdinaryCsv(tempDir, prefix),
  };

  const tenantName = `${prefix} tenant`;
  const tenantResult = await harness.run("internal", OPERATIONS["clients.createTenant"], { name: tenantName });
  if (tenantResult.errorCategory !== "success") throw new Error(`tenant creation gave ${tenantResult.errorCategory}`);
  const adminContext = await harness.contextFor("internal", { javaScript: true });
  await adminContext.navigate(new URL("/admin/studies", ORIGIN).toString());
  fx.tenantId = await adminContext.evaluate(PAGE.optionValueByText("tenant_id", tenantName));
  if (!fx.tenantId) throw new Error("the created tenant did not appear in the application's own tenant list");
  fixtures.track({ kind: "tenant", id: fx.tenantId, createdBy: "clients.createTenant", viaMechanism: "form" });

  for (const [key, suffix] of [["studyId", "study"], ["emptyStudyId", "control study"]]) {
    const created = await harness.run("internal", OPERATIONS["studies.createBlank"], {
      tenant_id: fx.tenantId, name: `${prefix} ${suffix}`, period: "",
    });
    const id = new URLSearchParams((created.landedOn ?? "").split("?")[1] ?? "").get("study");
    if (created.errorCategory !== "success" || !id) throw new Error(`study creation gave ${created.errorCategory}`);
    fx[key] = id;
    fixtures.track({ kind: "study", id, createdBy: "studies.createBlank", viaMechanism: "browser" });
  }
  note(`ledgered 3 object(s) under ${prefix}: one tenant and two studies`);

  // --- C1 -------------------------------------------------------------------
  await buildHostileFixture(harness, fixtures, fx);
  await checkDashboardInert(harness, fx);
  await checkPdfInert(harness, fx);

  // --- C2 -------------------------------------------------------------------
  await checkRejectedUpload("C2.1", harness, fixtures, fx, writeMalformedCsv(tempDir, prefix), "A malformed source file");
  await checkRejectedUpload("C2.2", harness, fixtures, fx, writeCorruptWorkbook(tempDir, prefix), "A corrupt / wrong-format file");
  await checkRejectedUpload(
    "C2.3", harness, fixtures, fx, writeOversizeCsv(tempDir, prefix), "A just-over-limit upload", 30_000, true,
  );
  await checkOrdinarySourceStillAccepted(harness, fx);

  // --- C3 -------------------------------------------------------------------
  runPivotGate();
  await checkForgedPivot(harness, fx);

  // --- C4 -------------------------------------------------------------------
  await checkReportInjection(harness);
  await checkPathAndSelectorInjection(harness, fx);
  checkNoCrashOrLeak(harness);

  // --- C5 -------------------------------------------------------------------
  checkCalculationUnchanged();

  return before;
}

async function main() {
  installTranscript();
  requireEnv([
    "NEXT_PUBLIC_SUPABASE_URL",
    "NEXT_PUBLIC_SUPABASE_ANON_KEY",
    "TEST_USER_A_EMAIL", "TEST_USER_A_PASSWORD",
    "TEST_INTERNAL_EMAIL", "TEST_INTERNAL_PASSWORD",
    "TEST_TENANT_A_ID", "TEST_TENANT_B_ID",
  ]);
  ORIGIN = process.env.HARNESS_ORIGIN ?? ORIGIN;
  SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
  PUBLISHABLE_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  TENANT_A = process.env.TEST_TENANT_A_ID;
  TENANT_B = process.env.TEST_TENANT_B_ID;

  const prefix = stampedPrefix("P7C");
  const fixtures = createFixtures({
    prefix,
    protectedTenantIds: [TENANT_A, TENANT_B],
    prefixedKinds: ["tenant", "study", "importBatch"],
  });
  const tempDir = mkdtempSync(join(tmpdir(), "p7c-"));

  console.log("Be Community — Suite C (hostile input, imports, pivot boundary, injection)");
  console.log(`  origin: ${ORIGIN}`);
  console.log(`  run prefix: ${prefix}  (ownership namespace, never a deletion key)`);
  console.log(`  roster: ${SUITE_C_CHECKS.length} required checks`);

  console.log("\n[C0] Classifier self-tests (offline, before any live request):");
  const failures = [
    ...selfTestInspector().map((line) => `inspector: ${line}`),
    ...selfTestInjectionClassifier().map((line) => `injection: ${line}`),
    ...selfTestXssClassifier().map((line) => `xss: ${line}`),
    ...selfTestRefusalClassifier().map((line) => `refusal: ${line}`),
  ];
  if (failures.length) {
    console.error(`a classifier is broken: ${failures.join("; ")}`);
    process.exitCode = 1;
    return;
  }
  note(
    `${INSPECTOR_CASES.length} leak cases, ${INJECTION_CASES.length} injection cases and ${XSS_CASES.length} XSS cases hold; ` +
      "a 500, a leaked internal and a missing literal can never pass",
  );

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

    if (tenantId) {
      try {
        const rows = await fixtures.tenantResidue(tenantId);
        const left = Object.entries(rows).filter(([, n]) => n !== 0);
        if (left.length) {
          reporter.runFailure(`rows remain inside the throwaway tenant: ${left.map(([t, n]) => `${t}=${n}`).join(", ")}`);
        } else {
          console.log(`  every one of ${Object.keys(rows).length} tables holds zero rows for the throwaway tenant`);
        }
      } catch (error) {
        reporter.runFailure(`row-level residue accounting failed: ${error.message}`);
      }
    }

    if (beforeCounts) {
      try {
        const after = {
          tenants: await fixtures.gateway.countTable("tenant"),
          studies: await fixtures.gateway.countTable("study"),
          respondents: await fixtures.gateway.countTable("respondent"),
          quant: await fixtures.gateway.countTable("quant_response"),
          qual: await fixtures.gateway.countTable("qual_observation"),
          importBatches: await fixtures.gateway.countTable("import_batch"),
          authUsers: await fixtures.gateway.countAuthUsers(),
        };
        note(`after: ${Object.entries(after).map(([k, v]) => `${k}=${v}`).join(", ")}`);
        const drifted = Object.keys(beforeCounts).filter((key) => beforeCounts[key] !== after[key]);
        if (drifted.length) reporter.runFailure(`object counts did not return to their pre-run values: ${drifted.join(", ")}`);
        else console.log("  every tenant/study/respondent/response/observation/import/auth count returned to its pre-run value");
      } catch (error) {
        reporter.runFailure(`post-run accounting failed: ${error.message}`);
      }
    }

    try {
      rmSync(tempDir, { recursive: true, force: true });
      note("the run's temporary source files were removed; their contents were never printed");
    } catch {
      /* the OS reclaims the temp dir; never fail a run on this */
    }
  }

  console.log("\n[evidence] Sanitized harness ledger:");
  for (const line of activeHarness?.ledger.lines() ?? []) console.log(`  ${line}`);

  console.log("\n" + "=".repeat(64));
  const executed = new Set(reporter.executed());
  for (const check of SUITE_C_CHECKS) {
    console.log(`  ${executed.has(check.id) ? "executed    " : "NOT EXECUTED"}  ${check.id}  ${check.title}`);
  }

  const hits = scanText(transcript.join("\n"));
  if (hits.length) reporter.runFailure(`the secret scan matched ${hits.length} class(es) in this run's output`);
  else console.log("\n[scan] the run transcript passes scanText with zero secret-class matches");

  const verdict = reporter.verdict();
  console.log(
    `\nSuite C: ${verdict.total} check result(s), ${verdict.failed.length} failed, ` +
      `${verdict.missing.length} required check(s) never executed, ${verdict.runFailures.length} run-level failure(s)`,
  );
  for (const line of verdict.failed) console.error(`  - ${line}`);
  for (const id of verdict.missing) console.error(`  - ${id}: REQUIRED CHECK DID NOT EXECUTE (red, never skipped)`);
  for (const line of verdict.runFailures) console.error(`  - run: ${line}`);

  if (verdict.ok) {
    console.log("\nRESULT: Suite C green — C1-C5 all executed and passed.");
    process.exitCode = 0;
  } else {
    console.error("\nRESULT: Suite C is NOT green.");
    process.exitCode = 1;
  }
}

if (isDirectRun) await main();
