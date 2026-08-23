// =============================================================================
// P7 adversarial harness — PR 5 self-test (docs/P7_HARNESS_DESIGN.md §9).
// =============================================================================
// This file is the ONLY place in PR 5 that asserts anything, and everything it
// asserts is about the MECHANISM. It runs no security suite and returns no
// security verdict: Suites A, B, C and E own those (§5.4).
//
//   node --env-file=.env.local scripts/harness-selftest.mjs   (npm run test:harness-selftest)
//
// Requires a running local app (default http://localhost:3000), the .env.local
// fixture accounts, and a supported browser. Without a browser the run exits
// non-zero as unsupported/incomplete — never green, never "skipped" (S0).
//
// Structure: an offline phase (classifier, fixture-safety negatives, forced
// timeout cleanup, detector negatives) runs before anything touches the app; the
// live phase runs inside a bounded promise whose outer `finally` ALWAYS enters
// the same exact-id cleanup path, including on timeout.
// =============================================================================

import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { scanText } from "./lib/secret-patterns.mjs";
import {
  OPERATIONS,
  SESSION_KINDS,
  createHarness,
  selfTestClassifier,
  CLASSIFIER_CASES,
  evaluateOutcome,
  supportedMutations,
  unsupportedMutations,
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

/** The complete PR 5 surface. Anything else changing makes G7 fail. */
const ALLOWED_PATHS = new Set([
  "docs/P7_HARNESS_DESIGN.md",
  "docs/CURRENT_STATE.md",
  "package.json",
  ...HARNESS_FILES,
]);

const FORBIDDEN_PATH_RULES = [
  { test: (p) => p.startsWith("src/"), why: "application source" },
  { test: (p) => p.startsWith("supabase/"), why: "migrations or database policy" },
  { test: (p) => p.startsWith(".github/"), why: "CI configuration" },
  { test: (p) => p === "package-lock.json", why: "lockfile" },
  { test: (p) => p.startsWith("next.config"), why: "framework configuration" },
  { test: (p) => p.startsWith("wrangler"), why: "deployment configuration" },
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
    // Safe: this runs at module load, before any fixture exists or any object
    // could have been created, so there is no cleanup for it to bypass. Every
    // exit from inside the live phase throws AbortRun instead.
    process.exit(2);
  }
}

// The fixture service credential is deliberately absent from this list: it is
// owned, read and used exclusively by harness-fixtures.mjs (G4).
requireEnv([
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
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
// Detector vocabulary and the scope classifier
// ---------------------------------------------------------------------------

function sources() {
  return Object.fromEntries(HARNESS_FILES.map((file) => [file, readFileSync(file, "utf8")]));
}

/**
 * A detector must NAME what it forbids, so its own literal patterns would match
 * themselves. ONLY the literal pattern table between the markers is excluded —
 * never executable code and never a success message, both of which are scanned
 * exactly like the harness modules.
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
// Literal test data only. Every pattern targets CODE, not prose: a comment that
// names a prohibition is documentation and must not trip its own detector,
// while an actual use — a quoted wire header, a call, a printed credential
// expression, a runtime assignment — still does.
const ALLOWED_ENV = [
  "HARNESS_ORIGIN", "CHROME_PATH",
  "NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY",
  "TEST_USER_A_EMAIL", "TEST_USER_A_PASSWORD", "TEST_USER_B_EMAIL", "TEST_USER_B_PASSWORD",
  "TEST_INTERNAL_EMAIL", "TEST_INTERNAL_PASSWORD", "TEST_TENANT_A_ID", "TEST_TENANT_B_ID",
];
const CREDENTIAL_ENV = /SUPABASE_SERVICE_ROLE_KEY|SUPABASE_SECRET_KEY|service_role/;
const PRIVILEGED_CLIENT_IMPORT = /@supabase\/supabase-js/;
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

// Negative fixtures: the literal violating snippets each detector must catch.
// They live inside this block for the same reason the patterns do — a detector
// cannot be allowed to flag its own test data. The loop that USES them is
// executable code and stays outside, where it is scanned normally.
const CORE_FILE = "scripts/lib/http-harness.mjs";
const SELF_FILE = "scripts/harness-selftest.mjs";
const NEGATIVE_CASES = [
  { id: "G1", why: "a quoted private action header", file: CORE_FILE, inject: 'const h = { "next-action": id };' },
  { id: "G2", why: "a private transport import", file: CORE_FILE, inject: 'import x from "react-server-dom-webpack/client";' },
  { id: "G2", why: "a response-body read", file: CORE_FILE, inject: "const body = await response.text();" },
  { id: "G3", why: "an undocumented environment switch", file: CORE_FILE, inject: "if (process.env.HARNESS_BYPASS) skipAuth();" },
  { id: "G4", why: "the fixture credential outside the fixtures module", file: SELF_FILE, inject: "const k = process.env.SUPABASE_SERVICE_ROLE_KEY;" },
  { id: "G4", why: "a privileged client import outside the fixtures module", file: CORE_FILE, inject: 'import { createClient } from "@supabase/supabase-js";' },
  { id: "G5", why: "credential hashing", file: CORE_FILE, inject: 'const d = createHash("sha256").update(v);' },
  { id: "G5", why: "a printed credential expression", file: CORE_FILE, inject: "console.log(actor.jar.header());" },
  { id: "G6", why: "an application-request poll loop", file: CORE_FILE, inject: "while (waiting) { await fetch(new URL('/dashboard', origin)); }" },
  { id: "G8", why: "a run-time mechanism assignment", file: CORE_FILE, inject: 'op.mechanism = "browser";' },
  { id: "G9", why: "clock manipulation", file: CORE_FILE, inject: "Date.now = () => 0;" },
];
const SCOPE_CASES = [
  { why: "application source changed", scope: { files: ["src/app/login/actions.ts"], depsChanged: false, baseResolved: true } },
  { why: "a migration changed", scope: { files: ["supabase/migrations/0016_x.sql"], depsChanged: false, baseResolved: true } },
  { why: "CI changed", scope: { files: [".github/workflows/ci.yml"], depsChanged: false, baseResolved: true } },
  { why: "the lockfile changed", scope: { files: ["package-lock.json"], depsChanged: false, baseResolved: true } },
  { why: "a dependency changed", scope: { files: ["package.json"], depsChanged: true, baseResolved: true } },
  { why: "an unrelated path changed", scope: { files: ["scripts/isolation-test.mjs"], depsChanged: false, baseResolved: true } },
  { why: "the baseline could not be resolved", scope: { files: [], depsChanged: false, baseResolved: false } },
];
/* </detector-vocabulary> */

/**
 * Pure scope classifier for G7, so the detector itself can be tested offline
 * with synthetic inputs rather than only against this branch's real diff.
 */
export function evaluateScope({ files, depsChanged, baseResolved }) {
  const reasons = [];
  if (!baseResolved) reasons.push("the origin/main merge base could not be resolved");
  for (const file of files ?? []) {
    const rule = FORBIDDEN_PATH_RULES.find((entry) => entry.test(file));
    if (rule) reasons.push(`${rule.why} changed: ${file}`);
    else if (!ALLOWED_PATHS.has(file)) reasons.push(`path outside the approved PR 5 surface: ${file}`);
  }
  if (depsChanged) reasons.push("dependencies or devDependencies differ from origin/main");
  return { ok: reasons.length === 0, reasons };
}

function readBranchScope() {
  try {
    const git = (args) => execFileSync("git", args, { encoding: "utf8" });
    const base = git(["merge-base", "origin/main", "HEAD"]).trim();
    if (!base) return { baseResolved: false, files: [], depsChanged: false };
    const files = git(["diff", "--name-only", base]).split("\n").map((f) => f.trim()).filter(Boolean);
    const basePkg = JSON.parse(git(["show", `${base}:package.json`]));
    const currentPkg = JSON.parse(readFileSync("package.json", "utf8"));
    const depsChanged =
      JSON.stringify(basePkg.dependencies ?? {}) !== JSON.stringify(currentPkg.dependencies ?? {}) ||
      JSON.stringify(basePkg.devDependencies ?? {}) !== JSON.stringify(currentPkg.devDependencies ?? {});
    return { baseResolved: true, files, depsChanged };
  } catch {
    return { baseResolved: false, files: [], depsChanged: false };
  }
}

// ---------------------------------------------------------------------------
// The detector battery, as a pure function so negatives can be injected
// ---------------------------------------------------------------------------

function runDetectors(src, scope) {
  const results = [];
  const record = (id, passedCheck, message) => results.push({ id, passed: passedCheck, message });
  const all = Object.values(src).map(scannable).join("\n");
  const browser = scannable(src["scripts/lib/harness-browser.mjs"] ?? "");

  record(
    "G1",
    !FORBIDDEN.actionId.some((pattern) => pattern.test(all)),
    "no hashed action identifier is synthesized, scraped, stored or replayed",
  );

  // The prohibition is on APPLICATION / Server-Action response bodies. The one
  // narrow exemption is the browser's own DevTools handshake endpoint, which is
  // browser control, not application data — so the exemption is line-scoped and
  // must name /json/, never a blanket allowance.
  const bodyReads = all
    .split(/\r?\n/)
    .filter((line) => FORBIDDEN.bodyRead.test(line) || FORBIDDEN.bodyRetained.test(line))
    .filter((line) => !/\/json\//.test(line));
  record(
    "G2",
    !FORBIDDEN.privateImport.test(all) && bodyReads.length === 0,
    bodyReads.length
      ? `${bodyReads.length} application response body read(s) present`
      : "no private framework payload is built, imported, parsed or retained; app bodies are drained, never read",
  );

  const rogueEnv = [...new Set([...all.matchAll(/process\.env\.([A-Z_][A-Z_0-9]*)/g)].map((m) => m[1]))]
    .filter((name) => !ALLOWED_ENV.includes(name));
  record("G3", rogueEnv.length === 0, `no bypass switch; undocumented reads: ${rogueEnv.join(", ") || "none"}`);

  // G4 scans EVERY harness source, including this self-test. The fixtures
  // module is the single permitted holder of the privileged credential.
  const credentialLeaks = Object.entries(src)
    .filter(([file]) => file !== "scripts/lib/harness-fixtures.mjs")
    .filter(([, text]) => CREDENTIAL_ENV.test(scannable(text)) || PRIVILEGED_CLIENT_IMPORT.test(scannable(text)))
    .map(([file]) => file);
  record(
    "G4",
    credentialLeaks.length === 0,
    credentialLeaks.length
      ? `the privileged fixture credential leaked into ${credentialLeaks.join(", ")}`
      : "the privileged fixture credential is confined to the fixtures module",
  );

  record(
    "G5",
    !FORBIDDEN.hashing.test(all) && !FORBIDDEN.printsCredential.test(all),
    "no credential-derived value exists; the session label comes from the random source",
  );

  const appPollers = loopBodies(all).filter((body) => /fetch\(/.test(body) && !/\/json\//.test(body));
  const pumpBounded =
    /MAX_EVENTS_PER_WAIT/.test(browser) && /maxEvents/.test(browser) &&
    /deadline/.test(browser) && /hrtime/.test(browser);
  record(
    "G6",
    appPollers.length === 0 && pumpBounded,
    appPollers.length
      ? `${appPollers.length} loop(s) issue an application request`
      : "no application polling; the CDP pump is bounded by a deadline AND an event cap",
  );

  const scopeVerdict = evaluateScope(scope);
  record(
    "G7",
    scopeVerdict.ok,
    scopeVerdict.ok
      ? "the branch diff touches only the approved PR 5 surface; dependencies unchanged"
      : scopeVerdict.reasons.join("; "),
  );

  record(
    "G8",
    Object.isFrozen(OPERATIONS) &&
      !FORBIDDEN.runtimeMechanism.test(all) &&
      !FORBIDDEN.fallbackField.test(all) &&
      !FORBIDDEN.demotedField.test(all),
    "the catalogue is frozen; no run-time mechanism assignment and no fallback/demotion field",
  );

  record(
    "G9",
    !FORBIDDEN.clock.test(all) && !SESSION_KINDS.includes("expired"),
    `no clock or token-lifetime manipulation; session kinds are ${SESSION_KINDS.join("/")}`,
  );

  return results;
}

// ---------------------------------------------------------------------------
// Bounded execution: a timeout REJECTS, it never exits the process
// ---------------------------------------------------------------------------

/**
 * Raised instead of calling process.exit() from inside the live phase, so the
 * outer `finally` always reaches cleanup before the process ends.
 */
class AbortRun extends Error {
  constructor(message, exitCode) {
    super(message);
    this.name = "AbortRun";
    this.exitCode = exitCode;
  }
}
let abortRun = null;

const SHUTDOWN_MS = 15_000;

/**
 * Bounded runner with COOPERATIVE CANCELLATION.
 *
 * `Promise.race` alone is not enough: rejecting a guard leaves the live worker
 * running, so it could still issue browser/network work — or ledger a freshly
 * created object — while fixture cleanup is already deleting. This runner
 * instead aborts a shared signal, terminates the browser so pending CDP work
 * rejects, closes the fixture ledger so nothing further can be tracked, and
 * only THEN awaits the worker's settlement. Cleanup begins after that.
 *
 * Each operation keeps its own deadline and event cap; nothing here polls or
 * sleeps, and the shutdown wait is itself explicitly bounded.
 */
async function runCancellable(work, { deadlineMs, shutdownMs, onEvent, onCancel }) {
  const controller = new AbortController();
  const worker = Promise.resolve()
    .then(() => work(controller.signal))
    .then((value) => ({ ok: true, value }), (error) => ({ ok: false, error }));

  let timer = null;
  const deadline = new Promise((resolve) => {
    timer = setTimeout(() => resolve("timeout"), deadlineMs);
  });
  const first = await Promise.race([worker.then(() => "worker"), deadline]);
  clearTimeout(timer);
  if (first === "worker") return { timedOut: false, settled: await worker, shutdownFailed: false };

  onEvent?.("timeout/abort");
  controller.abort(new Error("run deadline exhausted"));
  // Stop the world BEFORE waiting: terminating the browser makes in-flight CDP
  // work reject, and closing the ledger blocks any late fixture activity.
  await onCancel?.();

  let shutdownTimer = null;
  const shutdown = new Promise((resolve) => {
    shutdownTimer = setTimeout(() => resolve("shutdown-deadline"), shutdownMs);
  });
  const outcome = await Promise.race([worker.then(() => "settled"), shutdown]);
  clearTimeout(shutdownTimer);
  if (outcome !== "settled") {
    onEvent?.("shutdown deadline exhausted");
    return { timedOut: true, settled: null, shutdownFailed: true };
  }
  onEvent?.("worker settled");
  return { timedOut: true, settled: await worker, shutdownFailed: false };
}

// ---------------------------------------------------------------------------
// Offline phase — no application, no remote rows
// ---------------------------------------------------------------------------

/** A mock data gateway: records deletes, so ownership rules can be proven offline. */
function mockGateway(objects) {
  const deletes = [];
  return {
    deletes,
    async countPrefixed(kind, prefix) {
      return Object.values(objects).filter(
        (o) => o.kind === kind && typeof o.name === "string" && o.name.startsWith(prefix) && !o.deleted,
      ).length;
    },
    async readMeta(kind, id) {
      const found = objects[id];
      return found && found.kind === kind && !found.deleted ? { ...found } : null;
    },
    async deleteById(kind, id) {
      deletes.push({ kind, id });
      if (objects[id]) objects[id].deleted = true;
      return { ok: true };
    },
    async reportControl() {
      return null;
    },
  };
}

async function offlineFixtureSafety() {
  console.log("\n[N] Fixture-safety negatives (offline, no remote rows):");
  const prefix = "P7H-TEST-offline";
  const tenantId = "11111111-1111-1111-1111-111111111111";
  const studyId = "22222222-2222-2222-2222-222222222222";
  const strangerId = "33333333-3333-3333-3333-333333333333";

  // N1 — an unsupported kind is refused by track(), not silently undeletable.
  {
    const f = createFixtures({ prefix, gateway: mockGateway({}) });
    try {
      f.track({ kind: "storage_object", id: strangerId });
      bad("N1", "track() accepted a kind with no ownership validator");
    } catch {
      ok("N1", "track() refuses a kind with no ownership validator or deletion strategy");
    }
  }

  // N2 — a scoped mutation before any tenant is ledgered must abort.
  {
    const f = createFixtures({ prefix, gateway: mockGateway({}) });
    try {
      f.authorizeMutation(OPERATIONS["studies.createBlank"], { tenant_id: tenantId });
      bad("N2", "a scoped mutation was allowed with no throwaway tenant ledgered");
    } catch {
      ok("N2", "a scoped mutation aborts while no throwaway tenant is ledgered");
    }
  }

  // N3 — a scoped mutation into a DIFFERENT tenant must abort.
  {
    const objects = { [tenantId]: { kind: "tenant", id: tenantId, name: `${prefix} tenant` } };
    const f = createFixtures({ prefix, gateway: mockGateway(objects) });
    f.track({ kind: "tenant", id: tenantId });
    try {
      f.authorizeMutation(OPERATIONS["studies.createBlank"], { tenant_id: strangerId });
      bad("N3", "a fixture was allowed outside the run's throwaway tenant");
    } catch {
      ok("N3", "a fixture targeting another tenant aborts before any request");
    }
  }

  // N4 — an exact id the run does not own can never reach a delete call.
  {
    const objects = {
      [tenantId]: { kind: "tenant", id: tenantId, name: `${prefix} tenant` },
      [strangerId]: { kind: "study", id: strangerId, name: "Satisfacción 2026 (TEST)", tenant_id: tenantId },
    };
    const gateway = mockGateway(objects);
    const f = createFixtures({ prefix, gateway });
    f.track({ kind: "tenant", id: tenantId });
    f.track({ kind: "study", id: strangerId }); // a wrongly captured id
    const result = await f.cleanup();
    if (gateway.deletes.some((d) => d.id === strangerId)) {
      bad("N4", "an object without the run prefix was deleted");
    } else if (result.clean) {
      bad("N4", "cleanup reported clean while refusing an unowned object");
    } else ok("N4", "a name without the run prefix is refused before deletion and the run goes red");
  }

  // N5 — a study whose tenant is not the throwaway tenant is refused.
  {
    const objects = {
      [tenantId]: { kind: "tenant", id: tenantId, name: `${prefix} tenant` },
      [studyId]: { kind: "study", id: studyId, name: `${prefix} study`, tenant_id: strangerId },
    };
    const gateway = mockGateway(objects);
    const f = createFixtures({ prefix, gateway });
    f.track({ kind: "tenant", id: tenantId });
    f.track({ kind: "study", id: studyId });
    await f.cleanup();
    if (gateway.deletes.some((d) => d.id === studyId)) {
      bad("N5", "a study outside the throwaway tenant was deleted");
    } else ok("N5", "a study whose tenant is not the throwaway tenant is refused");
  }

  // N6 — a deny-listed id can never enter the ledger.
  {
    const f = createFixtures({ prefix, protectedTenantIds: [tenantId], gateway: mockGateway({}) });
    let aborted = 0;
    for (const id of [P6E_STUDY_ID, tenantId]) {
      try { f.track({ kind: "study", id }); } catch { aborted += 1; }
    }
    if (aborted === 2) ok("N6", "deny-listed ids cannot enter the ledger at all");
    else bad("N6", "a deny-listed id was accepted by the ledger");
  }

  // N7 — deletion order is child-kind first, newest-first within a kind.
  {
    const objects = {
      [tenantId]: { kind: "tenant", id: tenantId, name: `${prefix} tenant` },
      [studyId]: { kind: "study", id: studyId, name: `${prefix} study 1`, tenant_id: tenantId },
      [strangerId]: { kind: "study", id: strangerId, name: `${prefix} study 2`, tenant_id: tenantId },
    };
    const gateway = mockGateway(objects);
    const f = createFixtures({ prefix, gateway });
    f.track({ kind: "tenant", id: tenantId });
    f.track({ kind: "study", id: studyId });
    f.track({ kind: "study", id: strangerId });
    const result = await f.cleanup();
    const order = gateway.deletes.map((d) => (d.kind === "tenant" ? "tenant" : d.id === strangerId ? "study:newer" : "study:older"));
    const expected = ["study:newer", "study:older", "tenant"];
    if (JSON.stringify(order) === JSON.stringify(expected) && result.clean) {
      ok("N7", "cleanup order is child-kind before tenant, newest-first within a kind");
    } else bad("N7", `unexpected deletion order: ${order.join(" -> ")}`);
  }
}

/**
 * Deterministic negative concurrency proof for the run deadline.
 *
 * The live worker deliberately keeps going past the deadline and then tries to
 * ledger a NEW fixture. Cancellation must prevent that attempt, the worker must
 * settle, and only then may cleanup start — so the event trace is exactly
 * timeout/abort -> worker settled -> child cleanup -> tenant cleanup, with
 * nothing after cleanup. All offline: no remote row is created.
 */
async function offlineTimeoutCleanup() {
  console.log("\n[N] Forced-timeout cancellation and cleanup ordering (offline, mock fixtures):");
  const prefix = "P7H-TEST-timeout";
  const tenantId = "44444444-4444-4444-4444-444444444444";
  const studyId = "55555555-5555-5555-5555-555555555555";
  const lateId = "66666666-6666-6666-6666-666666666666";
  const trace = [];
  const objects = {
    [tenantId]: { kind: "tenant", id: tenantId, name: `${prefix} tenant` },
    [studyId]: { kind: "study", id: studyId, name: `${prefix} study`, tenant_id: tenantId },
  };
  const gateway = mockGateway(objects);
  const deleteById = gateway.deleteById.bind(gateway);
  gateway.deleteById = async (kind, id) => {
    trace.push(`cleanup:${kind}`);
    return deleteById(kind, id);
  };
  const f = createFixtures({ prefix, gateway });
  f.track({ kind: "tenant", id: tenantId });
  f.track({ kind: "study", id: studyId });

  let lateMutation = "not attempted";
  let browserTerminated = false;

  // Work that ignores the signal and tries to mutate AFTER the deadline. A
  // timer stands in for slow browser/network work; it is a mock, not a poll.
  const work = async () => {
    await new Promise((resolve) => setTimeout(resolve, 120));
    try {
      f.track({ kind: "study", id: lateId, createdBy: "post-timeout" });
      lateMutation = "PERFORMED";
      trace.push("late-track");
    } catch {
      lateMutation = "refused";
    }
  };

  const result = await runCancellable(work, {
    deadlineMs: 40,
    shutdownMs: 5000,
    onEvent: (event) => trace.push(event),
    onCancel: async () => {
      browserTerminated = true; // stands in for harness.close()
      f.halt();
    },
  });

  const cleanup = await f.cleanup();
  const expected = ["timeout/abort", "worker settled", "cleanup:study", "cleanup:tenant"];

  if (!result.timedOut) bad("N8", "the deadline did not fire");
  else if (result.shutdownFailed) bad("N8", "the worker did not settle within the shutdown deadline");
  else if (lateMutation !== "refused") bad("N8", `a post-timeout mutation was ${lateMutation}`);
  else if (!browserTerminated) bad("N8", "the browser was not terminated before awaiting settlement");
  else if (JSON.stringify(trace) !== JSON.stringify(expected)) {
    bad("N8", `unexpected event order: ${trace.join(" -> ")}`);
  } else if (f.ledger.length !== 2 || !cleanup.clean) {
    bad("N8", "the ledger or cleanup result changed after cancellation");
  } else {
    ok("N8", `cancellation ordering is exact: ${trace.join(" -> ")}`);
    ok("N8", "the post-timeout mutation was refused; live work settled before cleanup began");
  }
}

/**
 * Zero-side-effect proof: a catalogued-but-unsupported mutation must fail
 * before any context, navigation, request, ownership check or ledger activity.
 */
async function offlineUnsupportedOperations() {
  console.log("\n[N] Unsupported operations fail before any side effect (offline spies):");
  const calls = { contexts: 0, navigations: 0, fetches: 0, authorize: 0, track: 0 };

  const spyFixtures = {
    prefix: "P7H-TEST-spy",
    ledger: [],
    authorizeMutation: () => { calls.authorize += 1; },
    track: () => { calls.track += 1; },
    preflight: async () => ({}),
    cleanup: async () => ({ clean: true, removed: 0, leaked: [], residual: {} }),
    halt: () => {},
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
        dispose: async () => {},
        browserContextId: "spy",
      };
    },
    close: async () => {},
  };

  const realFetch = globalThis.fetch;
  globalThis.fetch = async (...args) => { calls.fetches += 1; return realFetch(...args); };

  let refused = 0;
  const probes = ["clients.renameTenant", "clients.deleteClientUser", "upload.confirm", "studies.deleteTemplate"];
  try {
    const spyHarness = await createHarness({
      origin: "http://127.0.0.1:1",
      actors: ["internal"],
      browser: "required",
      fixtures: spyFixtures,
      credentials: { internal: { email: "spy@example.invalid", password: "unused", role: "internal" } },
      supabase: { url: "http://127.0.0.1:1", anonKey: "unused" },
      launchBrowser: async () => spyBrowser,
      PAGE,
    });
    for (const name of probes) {
      try {
        await spyHarness.run("internal", OPERATIONS[name], { tenant_id: "x", user_id: "x", template_id: "x" });
        bad("N11", `${name} executed despite having no PR 5 support`);
      } catch (error) {
        if (error.code === "UNSUPPORTED_OPERATION") refused += 1;
        else bad("N11", `${name} threw an unexpected error: ${error.message}`);
      }
    }
    await spyHarness.close();
  } finally {
    globalThis.fetch = realFetch;
  }

  const noEffects =
    calls.contexts === 0 && calls.navigations === 0 && calls.fetches === 0 &&
    calls.authorize === 0 && calls.track === 0;
  if (refused !== probes.length) bad("N11", `${refused}/${probes.length} unsupported operations were refused`);
  else if (!noEffects) bad("N11", `side effects occurred: ${JSON.stringify(calls)}`);
  else {
    ok("N11", `${refused}/${probes.length} unsupported form/imperative mutations refused before dispatch`);
    ok("N11", "zero contexts, navigations, requests, ownership checks and ledger calls");
  }
}

/** The declared login contract, including the query-specificity ordering. */
function offlineOutcomeCases() {
  console.log("\n[N] Declared outcome contracts (public path/query only):");
  const login = OPERATIONS["auth.login"];
  const cases = [
    { landed: "/dashboard", expect: "success" },
    { landed: "/login?error=invalid_credentials", expect: "validation" },
    { landed: "/login", expect: "denial" },
    { landed: "/admin/studies", expect: "none" },
  ];
  const wrong = cases.filter((c) => evaluateOutcome(login, c.landed) !== c.expect);
  if (wrong.length) {
    bad("N12", `login outcome mismatch: ${wrong.map((c) => `${c.landed} != ${c.expect}`).join(", ")}`);
  } else {
    ok("N12", "auth.login: /dashboard=success, /login?error=validation, /login=denial, other=unclassified");
  }
  try {
    evaluateOutcome(OPERATIONS["clients.renameTenant"], "/admin/clients?ok=1");
    bad("N12", "an operation with no declared contract was classified");
  } catch {
    ok("N12", "an operation with no declared contract throws instead of being classified");
  }
}

/** The catalogue itself: nothing unsupported can reach dispatch. */
function offlineCatalogSupport() {
  console.log("\n[N] Catalogue capability model:");
  const supported = supportedMutations();
  const missingOwnership = supported.filter((name) => {
    const op = OPERATIONS[name];
    return !((op.creates?.length ?? 0) > 0 || (op.scopeParams?.length ?? 0) > 0 || (op.targetParams?.length ?? 0) > 0);
  });
  const expected = ["clients.createTenant", "studies.createBlank"];
  if (JSON.stringify(supported) !== JSON.stringify(expected)) {
    bad("N13", `supported mutation surface drifted: ${supported.join(", ")}`);
  } else if (missingOwnership.length) {
    bad("N13", `supported mutations without ownership metadata: ${missingOwnership.join(", ")}`);
  } else {
    ok("N13", `supported mutations are exactly ${supported.join(", ")}; each declares ownership metadata`);
    note(`${unsupportedMutations().length} catalogued mutations remain unsupported and cannot reach dispatch`);
  }
}

function offlineDetectorNegatives() {
  console.log("\n[N] Detector negatives (each injected violation must be caught):");
  const real = sources();
  const goodScope = { files: [...ALLOWED_PATHS], depsChanged: false, baseResolved: true };

  let caught = 0;
  for (const testCase of NEGATIVE_CASES) {
    const mutated = { ...real, [testCase.file]: `${real[testCase.file]}\n${testCase.inject}\n` };
    const verdict = runDetectors(mutated, goodScope).find((r) => r.id === testCase.id);
    if (verdict && !verdict.passed) caught += 1;
    else bad(`N9/${testCase.id}`, `${testCase.why} was NOT caught by ${testCase.id}`);
  }
  if (caught === NEGATIVE_CASES.length) {
    ok("N9", `${caught}/${NEGATIVE_CASES.length} injected violations were caught by their own detector`);
  }

  let scopeCaught = 0;
  for (const testCase of SCOPE_CASES) {
    if (!evaluateScope(testCase.scope).ok) scopeCaught += 1;
    else bad("N10/G7", `${testCase.why} was NOT caught by the scope classifier`);
  }
  if (scopeCaught === SCOPE_CASES.length) {
    ok("N10", `${scopeCaught}/${SCOPE_CASES.length} out-of-scope diffs are rejected, including an unresolved baseline`);
  }
}

// ---------------------------------------------------------------------------
// Live phase
// ---------------------------------------------------------------------------

const prefix = newRunPrefix();
const fixtures = createFixtures({
  prefix,
  protectedTenantIds: [process.env.TEST_TENANT_A_ID, process.env.TEST_TENANT_B_ID],
});

console.log("P7 adversarial harness — PR 5 self-test");
console.log(`  origin: ${ORIGIN}`);
console.log(`  run prefix: ${prefix}  (ownership namespace, never a deletion key)`);

let harness = null;
let s6bRan = false;

async function livePhase(signal) {
  const readiness = signal
    ? AbortSignal.any([AbortSignal.timeout(15000), signal])
    : AbortSignal.timeout(15000);
  const health = await fetch(new URL("/api/health", ORIGIN), { signal: readiness }).catch(() => null);
  if (!health?.ok) {
    throw new AbortRun(`the app is not answering at ${ORIGIN} — start it first (npm run build && npm run start)`, 2);
  }

  console.log("\n[S0] Browser availability (mandatory — design §3.2):");
  try {
    harness = await createHarness({
      origin: ORIGIN,
      actors: ["tenantA", "tenantB", "internal", "anonymous"],
      browser: "required",
      signal,
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
      throw new AbortRun(`UNSUPPORTED/INCOMPLETE: ${error.message}`, 1);
    }
    throw error;
  }

  await fixtures.preflight();
  note("preflight: zero pre-existing objects carry this run prefix");

  // --- S1 -----------------------------------------------------------------
  console.log("\n[S1] Sign-in for all three actors through the real login surface:");
  for (const id of ["tenantA", "tenantB", "internal"]) {
    await harness.signIn(id);
    await harness.assertIdentity(id);
    ok("S1", `${id} reached an authenticated dashboard; the app reported this actor's own identity`);
  }

  // --- S2: structural AND behavioral, both against LIVE sessions -----------
  console.log("\n[S2] Session isolation (no cookie name, value or hash is printed):");
  const isolation = harness.assertSessionIsolation(["tenantA", "tenantB", "internal"]);
  ok("S2", `distinct jars, contexts and session labels for ${isolation.actors} actors; no auth credential reused`);

  // tenantB is LIVE here — that is the point: clearing a valid session must
  // affect exactly one actor.
  await harness.session.clear("tenantB");
  const clearedB = await harness.run("tenantB", OPERATIONS["page.dashboard"]);
  const otherA = await harness.run("tenantA", OPERATIONS["page.dashboard"]);
  const otherInternal = await harness.run("internal", OPERATIONS["page.adminStudies"]);
  if (
    clearedB.errorCategory === "denied_unauthenticated" &&
    otherA.errorCategory === "success" &&
    otherInternal.errorCategory === "success"
  ) {
    ok("S2", "clearing one LIVE actor denies exactly that actor; the other two stay authenticated");
  } else {
    bad("S2", `live-session isolation: tenantB=${clearedB.errorCategory}, tenantA=${otherA.errorCategory}, internal=${otherInternal.errorCategory}`);
  }
  await harness.signIn("tenantB");
  await harness.assertIdentity("tenantB");
  ok("S2", "tenantB signed back in through the real login flow after the isolation probe");

  // --- S3 -----------------------------------------------------------------
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

  // --- S11 ----------------------------------------------------------------
  console.log("\n[S11] Ownership and deny-list preconditions (abort before any request):");
  let aborted = 0;
  for (const protectedId of [P6E_STUDY_ID, process.env.TEST_TENANT_A_ID, process.env.TEST_TENANT_B_ID]) {
    try {
      await harness.run("internal", OPERATIONS["studies.createBlank"], { tenant_id: protectedId, name: `${prefix} must-not-run` });
      bad("S11", "a mutating operation against a protected id was NOT refused");
    } catch (error) {
      if (/deny-list|fixture scope|ownership/.test(error.message)) aborted += 1;
      else bad("S11", `unexpected error: ${error.message}`);
    }
  }
  if (aborted === 3) ok("S11", "3/3 mutating attempts on protected ids aborted before any request");

  // --- S6 -----------------------------------------------------------------
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

  // --- S8 — through harness.run only --------------------------------------
  console.log("\n[S8] Imperative Server Action through the public entry point:");
  let pivot = await harness.run("internal", OPERATIONS["dashboard.pivot"]);
  if (pivot.errorCategory !== "success") pivot = await harness.run("tenantA", OPERATIONS["dashboard.pivot"]);
  if (pivot.errorCategory === "success" && pivot.mechanism === "browser") {
    ok("S8", `harness.run drove computeStudyPivot through the app's own controls (${pivot.actor}, mechanism: browser)`);
  } else {
    bad("S8", `dashboard.pivot gave ${pivot.errorCategory} / mechanism ${pivot.mechanism}`);
  }
  // An imperative operation with no reviewed driver must fail at the earliest
  // possible point — the pre-dispatch capability guard — so it can never reach
  // a context, a navigation or a real control. UnsupportedDriverError remains
  // in the dispatcher as defense in depth behind this guard.
  try {
    await harness.run("internal", OPERATIONS["upload.rollback"]);
    bad("S8", "an imperative operation with no reviewed driver was executed");
  } catch (error) {
    if (error.code === "UNSUPPORTED_OPERATION") {
      ok("S8", "an undriven imperative operation is refused before dispatch, never as success");
    } else bad("S8", `unexpected error for an undriven operation: ${error.message}`);
  }

  // --- S7 + S9 ------------------------------------------------------------
  console.log("\n[S7] Frozen mechanism catalogue (no run-time selection, no demotion):");
  for (const op of Object.values(OPERATIONS).filter((entry) => entry.mechanism === "form")) {
    if (!op.degradationVerifiedAt) bad("S7", `${op.name} is frozen as 'form' without a recorded discovery run`);
  }
  const frozenForms = Object.values(OPERATIONS).filter((op) => op.mechanism === "form").map((op) => op.name);
  note(`frozen as 'form': ${frozenForms.join(", ")}`);
  note(`auth.login ran as '${OPERATIONS["auth.login"].mechanism}' during S1 — the frozen value, not a negotiated one`);

  console.log("\n[S9] Throwaway tenant, fixture study, ordered cleanup:");
  const tenantName = `${prefix} tenant`;
  const createTenant = OPERATIONS["clients.createTenant"];
  const tenantResult = await harness.run("internal", createTenant, { name: tenantName });
  if (tenantResult.errorCategory !== "success") {
    bad("S9", `tenant creation gave ${tenantResult.errorCategory}`);
    return;
  }
  ok("S7", `clients.createTenant ran as its frozen '${createTenant.mechanism}' mechanism and matched its declared outcome contract`);

  const adminContext = await harness.contextFor("internal", { javaScript: true });
  await adminContext.navigate(new URL("/admin/studies", ORIGIN).toString());
  const tenantId = await adminContext.evaluate(PAGE.optionValueByText("tenant_id", tenantName));
  if (!tenantId) {
    bad("S9", "the created tenant did not appear in the application's own tenant list");
    return;
  }
  fixtures.track({ kind: "tenant", id: tenantId, createdBy: createTenant.name, viaMechanism: createTenant.mechanism });
  ok("S9", "one prefixed throwaway tenant created through the real application surface and ledgered by exact id");

  const studyOp = OPERATIONS["studies.createBlank"];
  const studyResult = await harness.run("internal", studyOp, {
    tenant_id: tenantId,
    name: `${prefix} study`,
    period: "",
  });
  const studyId = new URLSearchParams((studyResult.landedOn ?? "").split("?")[1] ?? "").get("study");
  if (studyResult.errorCategory !== "success" || !studyId) {
    bad("S9", `study creation gave ${studyResult.errorCategory}`);
    return;
  }
  fixtures.track({ kind: "study", id: studyId, createdBy: studyOp.name, viaMechanism: studyOp.mechanism });
  ok("S9", "one prefixed study created inside the throwaway tenant through the real workflow and ledgered");
  note("no Auth user was created or invited at any point in this run");

  // --- S4 — an independent, currently VALID session -----------------------
  console.log("\n[S4] Invalid-token handling (N2) against a currently valid session:");
  const beforeInvalidation = await harness.run("tenantA", OPERATIONS["page.dashboard"]);
  if (beforeInvalidation.errorCategory !== "success") {
    bad("S4", `tenantA was not authenticated before invalidation (${beforeInvalidation.errorCategory})`);
  } else {
    await harness.session.invalidate("tenantA");
    const afterInvalidation = await harness.run("tenantA", OPERATIONS["page.dashboard"]);
    if (afterInvalidation.errorCategory === "denied_unauthenticated" && afterInvalidation.sessionKind === "invalid") {
      ok("S4", "a valid session whose cookie is then structurally corrupted is rejected immediately");
    } else bad("S4", `invalid token gave ${afterInvalidation.errorCategory} / kind ${afterInvalidation.sessionKind}`);
  }

  // --- S5 -----------------------------------------------------------------
  console.log("\n[S5] Revoked-refresh handling (N3) — NOT an expired-token claim:");
  const revoked = await harness.session.revokeRefresh("tenantB");
  if (revoked.refreshRejected) {
    ok("S5", "after sign-out the prior refresh session cannot mint or refresh a new session");
    note("the still-unexpired access token is NOT required to be rejected before its own exp — expected Supabase behavior, recorded, not a finding");
  } else bad("S5", "the revoked refresh session still minted a new session");

  if (harness.ledger.all().some((r) => r.sessionKind === "invalid") &&
      harness.actor("tenantB").sessionKind === "revoked_refresh") {
    ok("S5", "S4 and S5 produce distinct records; neither is ever labelled 'expired'");
  } else bad("S5", "the invalid and revoked-refresh cases are not distinctly recorded");

  console.log("\n[S5b] Deferred coverage is named, not faked:");
  deferred.push(
    "N4 (genuinely expired access token) — DEFERRED and NOT EXECUTED: obtaining one would require clock manipulation, token fabrication, storing a credential until it ages out, changing remote Auth configuration, or waiting through the JWT TTL (design §3.4)",
  );
  ok("S5b", "N4 is recorded as deferred and unexecuted; no code path simulates it");
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

console.log("\n[S10] Classifier self-test (offline, before any live request):");
const classifierFailures = selfTestClassifier();
if (classifierFailures.length) bad("S10", classifierFailures.join("; "));
else ok("S10", `${CLASSIFIER_CASES.length} fixed cases classify correctly; unknown answers are 'unclassified'`);

await offlineFixtureSafety();
await offlineTimeoutCleanup();
await offlineUnsupportedOperations();
offlineOutcomeCases();
offlineCatalogSupport();
offlineDetectorNegatives();

const bounded = await runCancellable((signal) => livePhase(signal), {
  deadlineMs: RUN_TIMEOUT_MS,
  shutdownMs: SHUTDOWN_MS,
  onEvent: (event) => note(`run lifecycle: ${event}`),
  // Stop the world before awaiting settlement: terminate the browser so pending
  // CDP work rejects, and close the ledger so nothing further can be tracked.
  onCancel: async () => {
    fixtures.halt();
    if (harness) await harness.close().catch(() => {});
  },
});

try {
  if (bounded.timedOut) {
    if (bounded.shutdownFailed) {
      bad("RUN", "the live phase did not settle within the shutdown deadline — cleanup safety is NOT claimed");
    } else {
      bad("RUN", `the live phase exceeded its ${RUN_TIMEOUT_MS}ms deadline and was cancelled`);
    }
  } else if (bounded.settled && !bounded.settled.ok) {
    throw bounded.settled.error;
  }
} catch (error) {
  if (error instanceof AbortRun) abortRun = error;
  else bad("RUN", error.message);
} finally {
  // Entered on success, on assertion failure, on exception AND on timeout — the
  // timeout rejects the race, it never exits the process (§6.7).
  console.log("\n[cleanup] Exact-id deletion, ownership re-proved, children before the tenant:");
  let cleanup = { removed: 0, leaked: [], refused: [], failed: [], residual: {}, clean: false };
  try {
    cleanup = await fixtures.cleanup();
  } catch (error) {
    bad("cleanup", `cleanup failed: ${error.message}`);
  }
  for (const entry of fixtures.ledger) note(`  ledgered ${entry.kind} ${entry.id}`);
  if (cleanup.clean) {
    ok("S9", `cleanup removed ${cleanup.removed} object(s); zero objects carry the run prefix`);
  } else {
    bad(
      "S9",
      `cleanup left residue — remove these manually: ${
        cleanup.leaked.map((e) => `${e.kind} ${e.id}`).join(", ") || JSON.stringify(cleanup.residual)
      }`,
    );
  }
  if (harness) await harness.close().catch(() => {});
}

// --- G1-G9 against the real sources and the real branch diff ---------------
console.log("\n[G] Structural guarantees over every harness source:");
for (const result of runDetectors(sources(), readBranchScope())) {
  if (result.passed) ok(result.id, result.message);
  else bad(result.id, result.message);
}

console.log("\n[evidence] Sanitized ledger:");
for (const line of harness?.ledger.lines() ?? []) console.log(`  ${line}`);

console.log("\n[deferred] Coverage explicitly not executed:");
for (const item of deferred) console.log(`  - ${item}`);
console.log(`\n[S6b] ${s6bRan ? "executed" : "not executed (precondition unmet)"}`);

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
if (abortRun) {
  console.error(`
${abortRun.message}`);
  process.exitCode = abortRun.exitCode;
} else {
  process.exitCode = failures.length ? 1 : 0;
}
