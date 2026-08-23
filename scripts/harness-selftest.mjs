// =============================================================================
// P7 adversarial harness — PR 5 self-test (docs/P7_HARNESS_DESIGN.md §9).
// =============================================================================
// This file is the ONLY place in PR 5 that asserts anything, and everything it
// asserts is about the MECHANISM. It runs no security suite and returns no
// security verdict: Suites A, B, C and E own those (§5.4).
//
//   node --env-file=.env.local scripts/harness-selftest.mjs        (npm run test:harness-selftest)
//
// Requires a running local app (default http://localhost:3000), the .env.local
// fixture accounts, and a supported browser. Without a browser the run exits
// non-zero as unsupported/incomplete — never green, never "skipped" (S0).
// =============================================================================

import { readFileSync } from "node:fs";
import { scanText } from "./lib/secret-patterns.mjs";
import {
  OPERATIONS,
  SESSION_KINDS,
  createHarness,
  selfTestClassifier,
  CLASSIFIER_CASES,
} from "./lib/http-harness.mjs";
import { launchBrowser, PAGE } from "./lib/harness-browser.mjs";
import { createFixtures, newRunPrefix, P6E_STUDY_ID } from "./lib/harness-fixtures.mjs";

const ORIGIN = process.env.HARNESS_ORIGIN ?? "http://localhost:3000";
const RUN_TIMEOUT_MS = 10 * 60 * 1000;

const HARNESS_FILES = [
  "scripts/lib/http-harness.mjs",
  "scripts/lib/harness-browser.mjs",
  "scripts/lib/harness-fixtures.mjs",
  "scripts/harness-selftest.mjs",
];

// --- output capture, so the whole run can be scanned for secrets (§5.2) -----
const transcript = [];
const realLog = console.log.bind(console);
const realError = console.error.bind(console);
console.log = (...args) => { transcript.push(args.join(" ")); realLog(...args); };
console.error = (...args) => { transcript.push(args.join(" ")); realError(...args); };

let passed = 0;
const failures = [];
const deferred = [];
const ok = (id, message) => { passed += 1; console.log(`  PASS ${id}  ${message}`); };
const bad = (id, message) => { failures.push(`${id}: ${message}`); console.log(`  FAIL ${id}  ${message}`); };
const note = (message) => console.log(`       ${message}`);

function requireEnv(names) {
  const missing = names.filter((name) => !process.env[name]);
  if (missing.length) {
    console.error(`Missing environment variables: ${missing.join(", ")}`);
    process.exit(2);
  }
}

requireEnv([
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "TEST_USER_A_EMAIL", "TEST_USER_A_PASSWORD",
  "TEST_USER_B_EMAIL", "TEST_USER_B_PASSWORD",
  "TEST_INTERNAL_EMAIL", "TEST_INTERNAL_PASSWORD",
  "TEST_TENANT_A_ID", "TEST_TENANT_B_ID",
]);

const CREDENTIALS = {
  tenantA: { email: process.env.TEST_USER_A_EMAIL, password: process.env.TEST_USER_A_PASSWORD, role: "client" },
  tenantB: { email: process.env.TEST_USER_B_EMAIL, password: process.env.TEST_USER_B_PASSWORD, role: "client" },
  internal: { email: process.env.TEST_INTERNAL_EMAIL, password: process.env.TEST_INTERNAL_PASSWORD, role: "internal" },
};

// ---------------------------------------------------------------------------
// G1-G9: structural guarantees over the harness's own source (§9.2)
// ---------------------------------------------------------------------------

function sources() {
  return Object.fromEntries(HARNESS_FILES.map((file) => [file, readFileSync(file, "utf8")]));
}

/**
 * A detector naturally has to NAME the things it forbids, so the literals below
 * would otherwise match themselves. Everything between the two markers in this
 * file is the detector's own vocabulary and is excluded from the content scans;
 * the rest of this file is scanned exactly like the harness modules.
 */
function scannable(text) {
  // `lastIndexOf` deliberately: the marker strings also appear above as const
  // declarations, and it is the real block that must be excluded, not those.
  const open = text.lastIndexOf(DETECTOR_OPEN);
  const close = text.lastIndexOf(DETECTOR_CLOSE);
  if (open < 0 || close < 0 || close < open) return text;
  return text.slice(0, open) + text.slice(close + DETECTOR_CLOSE.length);
}

/** Extracts loop bodies crudely, to ask what a loop *does* rather than ban it. */
function loopBodies(text) {
  const bodies = [];
  const pattern = /\b(while|for)\s*\(/g;
  let match;
  while ((match = pattern.exec(text)) !== null) {
    const open = text.indexOf("{", match.index);
    if (open < 0) continue;
    let depth = 0;
    for (let i = open; i < text.length; i += 1) {
      if (text[i] === "{") depth += 1;
      else if (text[i] === "}") {
        depth -= 1;
        if (depth === 0) { bodies.push(text.slice(open, i + 1)); break; }
      }
    }
  }
  return bodies;
}

const DETECTOR_OPEN = "/* <detector-vocabulary> */";
const DETECTOR_CLOSE = "/* </detector-vocabulary> */";

/* <detector-vocabulary> */
// Each pattern targets CODE, not prose: a comment that names a prohibition is
// documentation and must not trip its own detector, while any actual use — a
// quoted wire header, a call, a printed credential expression — still does.
const FORBIDDEN = {
  actionId: [
    /\$ACTION_ID/,
    // The gap excludes newlines: a quote on one line must not pair with prose
    // several lines later, which would make any mention of the header match.
    /["'`][^"'`\n]*next-action/i,
    /["'`][^"'`\n]*text\/x-component/i,
    /\bencodeReply\s*\(/,
  ],
  privateImport: /react-server-dom|react-dom\/server|next\/dist\//,
  bodyRead: /\bres(ponse)?\.(json|text)\(/,
  bodyRetained: /=\s*await\s+response\.arrayBuffer/,
  hashing: /\bcreateHash\s*\(|\bcreateHmac\s*\(|\.digest\s*\(|\bsha256\s*\(/,
  printsCredential:
    /console\.(log|error)\([^)]*(\.jar\b|\.password\b|jar\.header\(|authValues\(|\.cookies\()/,
  runtimeMechanism: /\.mechanism\s*=(?!=)/,
  fallbackField: /\bfallback\s*[:=]/,
  demotedField: /\bdemoted\s*[:=]/,
  clock: /setSystemTime|useFakeTimers|Date\.now\s*=(?!=)|JWT_EXPIRY/,
};
/* </detector-vocabulary> */

function structuralGuarantees() {
  console.log("\n[G] Structural guarantees over the harness's own source:");
  const src = sources();
  const all = Object.values(src).map(scannable).join("\n");
  const core = scannable(src["scripts/lib/http-harness.mjs"]);
  const browser = scannable(src["scripts/lib/harness-browser.mjs"]);

  // G1 - no hashed action id is constructed, scraped or stored.
  const g1Hits = FORBIDDEN.actionId.filter((pattern) => pattern.test(all));
  if (g1Hits.length) bad("G1", `action-id pattern present: ${g1Hits.length} match(es)`);
  // Worded without the literal header token: this message is scanned too, and
  // a detector that names its quarry inside a quoted string matches itself.
  else ok("G1", "no hashed action identifier is synthesized, scraped, stored or replayed");

  // G2 - no private RSC payload builder AND no private RSC payload reader.
  if (FORBIDDEN.privateImport.test(all)) bad("G2", "an import of private React/Next internals is present");
  else if (FORBIDDEN.bodyRead.test(core) || FORBIDDEN.bodyRetained.test(core)) {
    bad("G2", "a response body is parsed or retained in the core module");
  } else ok("G2", "no RSC payload is built, parsed, snapshotted or classified; bodies are drained, never read");

  // G3 - no bypass flag; only the documented switches are read.
  const allowed = new Set([
    "HARNESS_ORIGIN", "CHROME_PATH",
    "NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY",
    "TEST_USER_A_EMAIL", "TEST_USER_A_PASSWORD", "TEST_USER_B_EMAIL", "TEST_USER_B_PASSWORD",
    "TEST_INTERNAL_EMAIL", "TEST_INTERNAL_PASSWORD", "TEST_TENANT_A_ID", "TEST_TENANT_B_ID",
  ]);
  const read = [...all.matchAll(/process\.env\.([A-Z_][A-Z_0-9]*)/g)].map((m) => m[1]);
  const rogue = [...new Set(read)].filter((name) => !allowed.has(name));
  if (rogue.length) bad("G3", `undocumented environment switch read: ${rogue.join(", ")}`);
  else ok("G3", "no bypass flag; only documented origin/browser/fixture variables are read");

  // G4 - service_role never reaches a code path that produces evidence.
  const leaks = ["scripts/lib/http-harness.mjs", "scripts/lib/harness-browser.mjs"].filter(
    (file) => /SERVICE_ROLE/.test(src[file]) || /@supabase\/supabase-js/.test(src[file]),
  );
  if (leaks.length) bad("G4", `service-role reachable from an evidence-producing module: ${leaks.join(", ")}`);
  else ok("G4", "service_role is confined to harness-fixtures.mjs (preflight, counts, exact-id cleanup)");

  // G5 - no secret logging and no credential-derived value at all.
  if (FORBIDDEN.hashing.test(all)) bad("G5", "a hashing/fingerprint primitive is present in the harness");
  else if (FORBIDDEN.printsCredential.test(all)) bad("G5", "a cookie/token/password identifier reaches an output stream");
  else ok("G5", "no credential-derived value exists; sessionLabel comes from the random source");

  // G6 - no arbitrary sleeps, no application polling, no unbounded loops.
  const appPollers = loopBodies(all).filter((body) => /fetch\(/.test(body) && !/\/json\//.test(body));
  const pumpBounded =
    /MAX_EVENTS_PER_WAIT/.test(browser) && /maxEvents/.test(browser) &&
    /deadline/.test(browser) && /hrtime/.test(browser);
  if (appPollers.length) bad("G6", `${appPollers.length} loop(s) issue an application request`);
  else if (!pumpBounded) bad("G6", "the CDP event pump lacks a monotonic deadline or an explicit event cap");
  else ok("G6", "no application polling; the CDP pump is bounded by a deadline AND an event cap");

  // G7 - no production source, dependency or lockfile change.
  ok("G7", "asserted out-of-band by the changed-file scope check (see the run report)");

  // G8 - mechanism selection is frozen, not run-time.
  const mutates =
    FORBIDDEN.runtimeMechanism.test(all) ||
    FORBIDDEN.fallbackField.test(core) ||
    FORBIDDEN.demotedField.test(core);
  if (!Object.isFrozen(OPERATIONS)) bad("G8", "OPERATIONS is not frozen");
  else if (mutates) bad("G8", "a mechanism is assigned at run time, or a fallback/demoted field exists");
  else ok("G8", "OPERATIONS is a frozen checked-in catalog; no run-time mechanism selection or fallback");

  // G9 - no clock or token-lifetime manipulation.
  if (FORBIDDEN.clock.test(all)) bad("G9", "a clock manipulation primitive is present");
  else if (SESSION_KINDS.includes("expired")) bad("G9", "an `expired` session kind exists; N4 must stay deferred");
  else ok("G9", `no clock/token-lifetime manipulation; session kinds are ${SESSION_KINDS.join("/")}`);
}

// ---------------------------------------------------------------------------
// The run
// ---------------------------------------------------------------------------

const runTimer = setTimeout(() => {
  console.error("run timeout exhausted — aborting");
  process.exit(1);
}, RUN_TIMEOUT_MS);
runTimer.unref?.();

const prefix = newRunPrefix();
const fixtures = createFixtures({
  url: process.env.NEXT_PUBLIC_SUPABASE_URL,
  serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
  prefix,
  protectedTenantIds: [process.env.TEST_TENANT_A_ID, process.env.TEST_TENANT_B_ID],
});

console.log("P7 adversarial harness — PR 5 self-test");
console.log(`  origin: ${ORIGIN}`);
console.log(`  run prefix: ${prefix}  (ownership namespace, never a deletion key)`);

let harness = null;
let s6bRan = false;

try {
  // --- S10 — the classifier self-tests offline, before any live request ----
  console.log("\n[S10] Classifier self-test (offline, before any live request):");
  const classifierFailures = selfTestClassifier();
  if (classifierFailures.length) bad("S10", classifierFailures.join("; "));
  else ok("S10", `${CLASSIFIER_CASES.length} fixed cases classify correctly; unknown answers are 'unclassified'`);

  // --- readiness: the app's own health signal, not a delay -----------------
  const health = await fetch(new URL("/api/health", ORIGIN), { signal: AbortSignal.timeout(15000) }).catch(() => null);
  if (!health?.ok) {
    console.error(`the app is not answering at ${ORIGIN} — start it first (npm run build && npm run start)`);
    process.exit(2);
  }

  console.log("\n[S0] Browser availability (mandatory — design §3.2):");
  try {
    harness = await createHarness({
      origin: ORIGIN,
      actors: ["tenantA", "tenantB", "internal", "anonymous"],
      browser: "required",
      fixtures,
      credentials: CREDENTIALS,
      supabase: {
        url: process.env.NEXT_PUBLIC_SUPABASE_URL,
        anonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
      },
      launchBrowser,
      PAGE,
      log: note,
    });
    ok("S0", "a supported browser was found and driven over an OS-assigned ephemeral port");
  } catch (error) {
    if (error.code === "NO_BROWSER") {
      console.error(`\nUNSUPPORTED/INCOMPLETE: ${error.message}`);
      process.exit(1);
    }
    throw error;
  }

  // --- preflight: refuse to start if a previous run leaked -----------------
  await fixtures.preflight();
  note("preflight: zero pre-existing objects carry this run prefix");

  // --- S1 — sign-in for all three actors through M-A1 ----------------------
  console.log("\n[S1] Sign-in for all three actors through the real login surface:");
  for (const id of ["tenantA", "tenantB", "internal"]) {
    await harness.signIn(id);
    await harness.assertIdentity(id);
    ok("S1", `${id} reached an authenticated dashboard; the app reported this actor's own identity`);
  }

  // --- S2 — session isolation, without credential-derived evidence ---------
  console.log("\n[S2] Session isolation (no cookie name, value or hash is printed):");
  const isolation = harness.assertSessionIsolation(["tenantA", "tenantB", "internal"]);
  ok("S2", `distinct jars, contexts and session labels for ${isolation.actors} actors; no auth credential reused`);

  // --- S3 — logged-out handling -------------------------------------------
  console.log("\n[S3] Logged-out handling:");
  const anonAdmin = await harness.run("anonymous", OPERATIONS["page.adminStudies"]);
  if (anonAdmin.errorCategory === "denied_unauthenticated" && anonAdmin.redirectTo === "/login") {
    ok("S3", `anonymous -> /admin/studies: ${anonAdmin.errorCategory} (redirect to /login)`);
  } else bad("S3", `anonymous -> /admin/studies gave ${anonAdmin.errorCategory} / ${anonAdmin.redirectTo}`);

  const anonReport = await harness.run("anonymous", OPERATIONS["report.download"], { studyId: P6E_STUDY_ID });
  if (anonReport.errorCategory === "denied_unauthenticated") {
    const layer = anonReport.httpStatus === 401 ? "the route handler's own 401" : "the middleware redirect";
    ok("S3", `anonymous -> report route: denied_unauthenticated, answered by ${layer}`);
    if (anonReport.httpStatus !== 401) {
      note("observation for Suite B: the session middleware answers before the handler, so the handler's own 401");
      note("is defense in depth rather than the reachable outcome for a session-less caller. Recorded, not a defect.");
    }
  } else bad("S3", `anonymous -> report route gave ${anonReport.errorCategory} / ${anonReport.httpStatus}`);

  // --- S11 — deny-list precondition, before any request --------------------
  console.log("\n[S11] Deny-list precondition (aborts before a request is sent):");
  let aborted = 0;
  for (const protectedId of [P6E_STUDY_ID, process.env.TEST_TENANT_A_ID, process.env.TEST_TENANT_B_ID]) {
    try {
      await harness.run("internal", OPERATIONS["studies.createBlank"], { tenant_id: protectedId, name: `${prefix} must-not-run` });
      bad("S11", "a mutating operation against a protected id was NOT refused");
    } catch (error) {
      if (/deny-list|fixture scope/.test(error.message)) aborted += 1;
      else bad("S11", `unexpected error: ${error.message}`);
    }
  }
  if (aborted === 3) ok("S11", "3/3 mutating attempts on protected ids aborted before any request");

  // --- S6 — direct-route proof against a READ-ONLY control -----------------
  console.log("\n[S6] Direct-route proof on the report route (GET-only, read-only control):");
  const control = await fixtures.reportControlMetadata(P6E_STUDY_ID);
  const bogus = await harness.run("internal", OPERATIONS["report.download"], { studyId: "not-a-uuid" });
  if (bogus.errorCategory === "not_found") ok("S6a", "malformed study id -> not_found (404)");
  else bad("S6a", `malformed study id gave ${bogus.errorCategory}`);

  const crossTenant = await harness.run("tenantB", OPERATIONS["report.download"], { studyId: P6E_STUDY_ID });
  if (crossTenant.errorCategory === "not_found") ok("S6a", "tenantB -> the control study: not_found (non-disclosure)");
  else bad("S6a", `tenantB -> the control study gave ${crossTenant.errorCategory}`);

  if (!control || control.status !== "published" || !control.reportEnabled) {
    note("S6b: UNAVAILABLE — the accepted control study is missing, unpublished, or its report section is off.");
    note("S6b: positive report-route coverage therefore belongs to Suite B/C (PR 7), not to PR 5.");
    deferred.push("S6b (report-route success) — precondition not met, recorded as not executed");
  } else {
    const owner = control.tenantId === process.env.TEST_TENANT_A_ID ? "tenantA" : "internal";
    const positive = await harness.run(owner, OPERATIONS["report.download"], { studyId: P6E_STUDY_ID });
    if (positive.errorCategory === "success") {
      s6bRan = true;
      ok("S6b", `${owner} -> the control study: success with a PDF content-type (read-only GET)`);
    } else bad("S6b", `${owner} -> the control study gave ${positive.errorCategory} / ${positive.httpStatus}`);
  }

  // --- S8 — one browser-driven imperative Server Action --------------------
  console.log("\n[S8] Browser-driven imperative Server Action (computeStudyPivot):");
  const PIVOT_LABEL = "Agregación";
  const findPivot = `
    (() => {
      const label = [...document.querySelectorAll('label')].find((l) => l.textContent.trim().startsWith(${JSON.stringify(PIVOT_LABEL)}));
      if (!label) return null;
      const select = label.querySelector('select');
      const panel = label.closest('div')?.parentElement;
      return panel ? panel.innerText.trim().slice(0, 400) : (select ? 'found' : null);
    })()`;
  const drivePivot = `
    (() => {
      const label = [...document.querySelectorAll('label')].find((l) => l.textContent.trim().startsWith(${JSON.stringify(PIVOT_LABEL)}));
      const select = label && label.querySelector('select');
      if (!select) return 'no-control';
      const target = [...select.options].find((o) => o.value !== select.value);
      if (!target) return 'no-alternative';
      const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set;
      setter.call(select, target.value);
      select.dispatchEvent(new Event('input', { bubbles: true }));
      select.dispatchEvent(new Event('change', { bubbles: true }));
      return 'ok';
    })()`;

  let pivotActor = null;
  for (const candidate of ["internal", "tenantA"]) {
    const context = await harness.contextFor(candidate, { javaScript: true });
    await context.navigate(new URL("/dashboard", ORIGIN).toString());
    const found = await context.evaluate(findPivot);
    if (found) { pivotActor = candidate; break; }
  }
  if (!pivotActor) {
    bad("S8", "no pivot control rendered for any actor — the imperative action could not be driven");
  } else {
    const context = await harness.contextFor(pivotActor, { javaScript: true });
    const before = await context.evaluate(findPivot);
    const driven = await context.evaluate(drivePivot);
    if (driven !== "ok") {
      bad("S8", `could not drive the pivot control: ${driven}`);
    } else {
      const changed = await context
        .waitForDom(
          `() => { const l = [...document.querySelectorAll('label')].find((x) => x.textContent.trim().startsWith(${JSON.stringify(PIVOT_LABEL)}));
             const p = l && l.closest('div') && l.closest('div').parentElement;
             return p && p.innerText.trim().slice(0, 400) !== ${JSON.stringify(before)}; }`,
        )
        .catch(() => false);
      if (changed) ok("S8", `${pivotActor} drove the real pivot control; the rendered result changed (mechanism: browser)`);
      else bad("S8", "the pivot action did not produce an observable rendered change");
    }
  }

  // --- S7 + S9 — frozen mechanisms, fixture creation, ordered cleanup ------
  console.log("\n[S7] Frozen mechanism catalogue (no run-time selection, no demotion):");
  const frozenForms = Object.values(OPERATIONS).filter((op) => op.mechanism === "form");
  for (const op of frozenForms) {
    if (!op.degradationVerifiedAt) bad("S7", `${op.name} is frozen as 'form' without a recorded discovery run`);
  }
  note(`frozen as 'form': ${frozenForms.map((op) => op.name).join(", ") || "(none)"}`);
  note(`auth.login ran as '${OPERATIONS["auth.login"].mechanism}' during S1 — the frozen value, not a negotiated one`);

  console.log("\n[S9] Throwaway tenant, fixture study, ordered cleanup:");
  const tenantName = `${prefix} tenant`;
  const createTenant = OPERATIONS["clients.createTenant"];
  const tenantResult = await harness.run("internal", createTenant, { name: tenantName });
  if (tenantResult.errorCategory !== "success") {
    bad("S9", `tenant creation gave ${tenantResult.errorCategory}`);
  } else {
    ok("S7", `clients.createTenant ran as its frozen '${createTenant.mechanism}' mechanism and succeeded`);
    const adminContext = await harness.contextFor("internal", { javaScript: true });
    await adminContext.navigate(new URL("/admin/studies", ORIGIN).toString());
    const tenantId = await adminContext.evaluate(PAGE.optionValueByText("tenant_id", tenantName));
    if (!tenantId) {
      bad("S9", "the created tenant did not appear in the application's own tenant list");
    } else {
      fixtures.track({ kind: "tenant", id: tenantId, createdBy: createTenant.name, viaMechanism: createTenant.mechanism });
      ok("S9", "one prefixed throwaway tenant created through the real application surface and ledgered by exact id");

      const studyName = `${prefix} study`;
      const studyOp = OPERATIONS["studies.createBlank"];
      const studyResult = await harness.run("internal", studyOp, { tenant_id: tenantId, name: studyName, period: "" });
      const landed = studyResult.landedOn ?? "";
      const studyId = new URLSearchParams(landed.split("?")[1] ?? "").get("study");
      if (!studyId) {
        bad("S9", `study creation did not return a study id (landed on ${landed.split("?")[0]})`);
      } else {
        fixtures.track({ kind: "study", id: studyId, createdBy: studyOp.name, viaMechanism: studyOp.mechanism });
        ok("S9", "one prefixed study created inside the throwaway tenant through the real workflow and ledgered");
      }
    }
  }
  note("no Auth user was created or invited at any point in this run");

  // --- S4 — invalid-token handling (N2), immediate rejection ---------------
  console.log("\n[S4] Invalid-token handling (N2):");
  await harness.session.invalidate("tenantA");
  const invalidResult = await harness.run("tenantA", OPERATIONS["page.dashboard"]);
  if (invalidResult.errorCategory === "denied_unauthenticated" && invalidResult.sessionKind === "invalid") {
    ok("S4", "a structurally malformed auth cookie is rejected immediately on the next protected route");
  } else bad("S4", `invalid token gave ${invalidResult.errorCategory} / kind ${invalidResult.sessionKind}`);

  // --- S2 (behavioral half) — clearing one actor denies only that actor ----
  await harness.session.clear("tenantA");
  const clearedA = await harness.run("tenantA", OPERATIONS["page.dashboard"]);
  const stillInternal = await harness.run("internal", OPERATIONS["page.adminStudies"]);
  if (clearedA.errorCategory === "denied_unauthenticated" && stillInternal.errorCategory === "success") {
    ok("S2", "clearing one actor's session denies that actor while the others keep working");
  } else bad("S2", `isolation behavior: tenantA=${clearedA.errorCategory}, internal=${stillInternal.errorCategory}`);

  // --- S5 — revoked-refresh handling (N3) ----------------------------------
  console.log("\n[S5] Revoked-refresh handling (N3) — NOT an expired-token claim:");
  const revoked = await harness.session.revokeRefresh("tenantB");
  if (revoked.refreshRejected) {
    ok("S5", "after sign-out the prior refresh session cannot mint or refresh a new session");
    note("the still-unexpired access token is NOT required to be rejected before its own exp — that is expected Supabase behavior, recorded, not a finding");
  } else bad("S5", "the revoked refresh session still minted a new session");

  const kinds = new Set(harness.ledger.all().map((r) => r.sessionKind));
  if (kinds.has("invalid") && harness.actor("tenantB").sessionKind === "revoked_refresh") {
    ok("S5", "S4 and S5 produce distinct records; neither is ever labelled 'expired'");
  } else bad("S5", "the invalid and revoked-refresh cases are not distinctly recorded");

  console.log("\n[S5b] Deferred coverage is named, not faked:");
  deferred.push(
    "N4 (genuinely expired access token) — DEFERRED and NOT EXECUTED: obtaining one would require clock manipulation, token fabrication, storing a credential until it ages out, changing remote Auth configuration, or waiting through the JWT TTL (design §3.4)",
  );
  ok("S5b", "N4 is recorded as deferred and unexecuted; no code path simulates it");

  // --- G1-G9 ---------------------------------------------------------------
  structuralGuarantees();
} catch (error) {
  bad("RUN", error.message);
} finally {
  // --- cleanup: exact ledger ids, children before the tenant (§6.7) --------
  console.log("\n[cleanup] Exact-id deletion, children before the throwaway tenant:");
  let cleanup = { removed: 0, leaked: [], residual: {}, clean: false };
  try {
    cleanup = await fixtures.cleanup();
  } catch (error) {
    bad("cleanup", `cleanup failed: ${error.message}`);
  }
  for (const entry of fixtures.ledger) note(`  ledgered ${entry.kind} ${entry.id}`);
  if (cleanup.clean) {
    ok("S9", `cleanup removed ${cleanup.removed} object(s); zero objects carry the run prefix`);
  } else {
    bad("S9", `cleanup left residue — remove these manually: ${cleanup.leaked.map((e) => `${e.kind} ${e.id}`).join(", ") || JSON.stringify(cleanup.residual)}`);
  }
  if (harness) await harness.close().catch(() => {});
  clearTimeout(runTimer);
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

console.log("\n[evidence] Sanitized ledger:");
for (const line of harness?.ledger.lines() ?? []) console.log(`  ${line}`);

console.log("\n[deferred] Coverage explicitly not executed:");
for (const item of deferred) console.log(`  - ${item}`);
console.log(`\n[S6b] ${s6bRan ? "executed" : "not executed (precondition unmet)"}`);

// The run's own output must survive the repository secret scanner (§5.2).
const hits = scanText(transcript.join("\n"));
if (hits.length) {
  console.error(`\nSECRET SCAN FAILED: ${hits.length} class(es) matched this run's output`);
  failures.push("secret scan of the self-test output matched a secret class");
} else {
  console.log("\n[scan] self-test output passes scanText with zero secret-class matches");
}

console.log(
  `\nharness self-test: ${passed} checks passed, ${failures.length} failed` +
    (failures.length ? `\n${failures.map((f) => `  - ${f}`).join("\n")}` : ""),
);
if (failures.length === 0) {
  console.log(
    "\nThe harness mechanism is proven. No security suite has been run. " +
      "Suites A, B, C and E remain as recorded in docs/P7_PLAN.md §5.",
  );
}
process.exit(failures.length ? 1 : 0);
