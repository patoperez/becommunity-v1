// =============================================================================
// P7 adversarial harness — core (docs/P7_HARNESS_DESIGN.md §2, §3, §5, §8).
// =============================================================================
// This module is ASSERTION-NEUTRAL. It reaches the running application as a
// named identity and returns sanitized observations. It contains no security
// expectation: the suites own their verdicts (§5.4). `harness-selftest.mjs` is
// the only caller that asserts anything, and it asserts the MECHANISM.
//
// Standing prohibitions realized here as absences of code:
//   - no hashed Next-Action id is synthesized, scraped, stored or replayed;
//   - no framework hidden field is ever read — where a form must be submitted,
//     the browser submits its own DOM;
//   - no React/RSC wire payload is built, parsed, snapshotted or classified;
//   - no bypass flag, no test mode, no alternate authorization path;
//   - no value printed here is derived from a cookie or token (§3.5, §5.2).
// =============================================================================

import { randomBytes } from "node:crypto";
import { createServerClient } from "@supabase/ssr";
import { browserDriverFor } from "./harness-browser.mjs";

// ---------------------------------------------------------------------------
// Vocabulary
// ---------------------------------------------------------------------------

export const ACTOR_IDS = ["tenantA", "tenantB", "internal", "anonymous", "invalidToken"];
export const MECHANISMS = ["http", "form", "browser"];
/** No "expired" member: N4 is deferred and must never be simulated by N3 (§3.4). */
export const SESSION_KINDS = ["live", "invalid", "revoked_refresh", "none"];

export const ERROR_CATEGORIES = [
  "denied_unauthenticated",
  "denied_wrong_role",
  "denied_action_result",
  "not_found",
  "validation_rejected",
  "success",
  "success_no_op",
  "network_failure",
  "page_crash",
  "unclassified",
];

/** Supabase auth cookies. Only these participate in the isolation check (§3.3). */
const AUTH_COOKIE = /^sb-.*-auth-token(\.\d+)?$/;

// ---------------------------------------------------------------------------
// Session labels — random, credential-independent (§3.5)
// ---------------------------------------------------------------------------

/**
 * Minted from the runtime's random source BEFORE any credential is read. It is
 * not derived from, and carries no information about, any cookie or token, so
 * printing it discloses nothing. This deliberately replaces the credential
 * digest an earlier draft proposed (design §5.2, rejected alternative R-7b).
 */
export function newSessionLabel() {
  return [...randomBytes(8)].map((b) => (b % 36).toString(36)).join("");
}

// ---------------------------------------------------------------------------
// Cookie jar — values live here and are never printed, hashed or shared
// ---------------------------------------------------------------------------

export function createJar() {
  const store = new Map();
  return {
    set(name, value) {
      store.set(name, value);
    },
    clear() {
      store.clear();
    },
    size: () => store.size,
    header() {
      return [...store.entries()].map(([name, value]) => `${name}=${value}`).join("; ");
    },
    entries: () => [...store.entries()].map(([name, value]) => ({ name, value })),
    /** Auth-cookie values only, for the in-memory disjointness check (§3.3). */
    authValues: () =>
      [...store.entries()].filter(([name]) => AUTH_COOKIE.test(name)).map(([, value]) => value),
    authNamesCount: () => [...store.keys()].filter((name) => AUTH_COOKIE.test(name)).length,
    absorb(setCookieLines) {
      for (const line of setCookieLines) {
        const [pair] = line.split(";");
        const index = pair.indexOf("=");
        if (index < 1) continue;
        const name = pair.slice(0, index).trim();
        const value = pair.slice(index + 1).trim();
        if (value === "" || /expires=Thu, 01 Jan 1970/i.test(line)) store.delete(name);
        else store.set(name, value);
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Outcome classifier (§5.3) — closed vocabulary, `unclassified` fails the run
// ---------------------------------------------------------------------------

/**
 * Classifies from PUBLIC signals only: HTTP status, the redirect target, the
 * response content-type, and (for imperative actions) the stable rendered DOM.
 * A Server-Action / RSC response body is never an input here (§2.3).
 */
export function classify(observation) {
  const o = observation ?? {};
  if (o.transportError) return "network_failure";
  const status = o.status;
  if (typeof status !== "number") return "unclassified";
  if (status >= 500) return "page_crash";
  if (status === 401) return "denied_unauthenticated";
  if (status >= 300 && status < 400) {
    if (o.redirectTo === "/login") return "denied_unauthenticated";
    if (o.redirectTo === "/dashboard") return o.fromAdminPath ? "denied_wrong_role" : "success";
    return "unclassified";
  }
  if (status === 404) return "not_found";
  if (status === 400) return "validation_rejected";
  if (status >= 200 && status < 300) {
    if (o.domSignal === "denial") return "denied_action_result";
    if (o.domSignal === "validation") return "validation_rejected";
    if (o.domSignal === "success") return "success";
    if (o.domSignal === "none") return "unclassified";
    if (o.successSignal) return "success";
    return "unclassified";
  }
  return "unclassified";
}

/** Fixed cases, exercised offline before any live request (§5.3). */
export const CLASSIFIER_CASES = [
  { what: "302 to /login", input: { status: 302, redirectTo: "/login" }, expect: "denied_unauthenticated" },
  { what: "401 from a route handler", input: { status: 401 }, expect: "denied_unauthenticated" },
  { what: "302 to /dashboard from /admin", input: { status: 307, redirectTo: "/dashboard", fromAdminPath: true }, expect: "denied_wrong_role" },
  { what: "404 not found", input: { status: 404 }, expect: "not_found" },
  { what: "400 in the report route's error shape", input: { status: 400 }, expect: "validation_rejected" },
  { what: "200 whose rendered DOM shows the denial region", input: { status: 200, domSignal: "denial" }, expect: "denied_action_result" },
  { what: "200 with the operation's success signal", input: { status: 200, successSignal: true }, expect: "success" },
  { what: "500 server error", input: { status: 500 }, expect: "page_crash" },
  { what: "socket failure", input: { transportError: true }, expect: "network_failure" },
  { what: "unknown answer", input: { status: 418 }, expect: "unclassified" },
];

export function selfTestClassifier() {
  const failures = [];
  for (const testCase of CLASSIFIER_CASES) {
    const got = classify(testCase.input);
    if (got !== testCase.expect) failures.push(`${testCase.what}: expected ${testCase.expect}, got ${got}`);
  }
  return failures;
}

// ---------------------------------------------------------------------------
// The operation catalogue — §1's inventory as data, with FROZEN mechanisms
// ---------------------------------------------------------------------------
//
// `mechanism` is a checked-in fact reviewed in this diff (§2.2). It is never
// assigned or rewritten at run time, there is no fallback field, and a frozen
// `form` that stops submitting natively is RED — never demoted to `browser`.
// `degradationVerifiedAt` records the implementation-time discovery run that
// justifies a `form` entry.

const page = (name, path, extra = {}) => ({
  name,
  urlClass: path,
  path,
  method: "GET",
  mechanism: "http",
  mutating: false,
  fromAdminPath: path.startsWith("/admin"),
  ...extra,
});

const action = (name, extra) => ({ name, mutating: true, ...extra });

export const OPERATIONS = Object.freeze({
  // --- pages and route handlers: ordinary HTTP (§2.1) ----------------------
  "page.root": page("page.root", "/"),
  "page.login": page("page.login", "/login"),
  "page.dashboard": page("page.dashboard", "/dashboard"),
  "page.adminClients": page("page.adminClients", "/admin/clients"),
  "page.adminStudies": page("page.adminStudies", "/admin/studies"),
  "page.adminQualitative": page("page.adminQualitative", "/admin/qualitative"),
  "page.adminUpload": page("page.adminUpload", "/admin/upload"),
  "page.adminPreview": page("page.adminPreview", "/admin/preview/:studyId"),
  "health.get": page("health.get", "/api/health"),
  "report.download": page("report.download", "/api/studies/:studyId/report", {
    successSignalHeader: { header: "content-type", contains: "application/pdf" },
  }),
  "qualitative.selectStudy": page("qualitative.selectStudy", "/admin/qualitative", {
    urlClass: "/admin/qualitative?study=:studyId",
  }),

  // --- session lifecycle ---------------------------------------------------
  "auth.login": action("auth.login", {
    urlClass: "/login",
    mechanism: "form",
    degradationVerifiedAt: "2026-08-23 discovery run (design §2.2 step 2)",
    page: "/login",
    submitLabel: "Iniciar sesión",
    fields: ["email", "password"],
    creates: [],
    mutating: false,
    // The login action redirects on success and re-renders /login with a fixed
    // error CODE on failure (`login/actions.ts:24,32,36`). Both are public
    // redirect targets; neither requires reading a response body.
    outcome: {
      success: { path: "/dashboard" },
      validation: { path: "/login", query: "error" },
      denied: { path: "/login" },
    },
  }),
  "auth.logout": action("auth.logout", {
    urlClass: "/dashboard",
    mechanism: "browser",
    page: "/dashboard",
    submitLabel: "Cerrar sesión",
    fields: [],
    creates: [],
  }),

  // --- internal-only admin mutations --------------------------------------
  "clients.createTenant": action("clients.createTenant", {
    urlClass: "/admin/clients",
    mechanism: "form",
    degradationVerifiedAt: "2026-08-23 discovery run (design §2.2 step 2)",
    page: "/admin/clients",
    submitLabel: "Crear cliente",
    fields: ["name"],
    creates: ["tenant"],
    // `internalContext()` redirects an unauthenticated caller to /login and
    // `finish()` returns to /admin/clients with either ?ok= or ?error=
    // (`clients/actions.ts:19,27`). Validation is checked BEFORE success so a
    // rejection on the same path can never be read as a success.
    outcome: {
      denied: { path: "/login" },
      validation: { path: "/admin/clients", query: "error" },
      success: { path: "/admin/clients", query: "ok" },
    },
  }),
  "clients.renameTenant": action("clients.renameTenant", { urlClass: "/admin/clients", mechanism: "browser", page: "/admin/clients", submitLabel: "Guardar", fields: ["tenant_id", "name"], creates: [] }),
  "clients.updateTenantBrand": action("clients.updateTenantBrand", { urlClass: "/admin/clients", mechanism: "browser", page: "/admin/clients", submitLabel: "Guardar marca", fields: ["tenant_id"], creates: ["storage_object"] }),
  "clients.inviteClientUser": action("clients.inviteClientUser", { urlClass: "/admin/clients", mechanism: "browser", page: "/admin/clients", submitLabel: "Enviar invitación", fields: ["tenant_id", "email", "full_name", "data_scope"], creates: ["profile"], deniedPathsOnly: true }),
  "clients.updateClientUser": action("clients.updateClientUser", { urlClass: "/admin/clients", mechanism: "browser", page: "/admin/clients", submitLabel: "Guardar usuario", fields: ["user_id", "full_name", "tenant_id", "data_scope"], creates: [] }),
  "clients.deleteClientUser": action("clients.deleteClientUser", { urlClass: "/admin/clients", mechanism: "browser", page: "/admin/clients", submitLabel: "Eliminar cuenta cliente", fields: ["user_id", "confirmation_email"], creates: [], destructive: true }),
  "qualitative.generateSuggestions": action("qualitative.generateSuggestions", { urlClass: "/admin/qualitative", mechanism: "browser", page: "/admin/qualitative", submitLabel: "Generar sugerencias pendientes", fields: ["study_id"], creates: [] }),
  "qualitative.reviewObservations": action("qualitative.reviewObservations", { urlClass: "/admin/qualitative", mechanism: "browser", page: "/admin/qualitative", submitLabel: "Aceptar sugerencias", fields: ["study_id", "theme", "stage_key"], creates: [] }),
  "studies.createBlank": action("studies.createBlank", {
    urlClass: "/admin/studies",
    mechanism: "browser",
    page: "/admin/studies",
    submitLabel: "Crear y cargar datos",
    fields: ["tenant_id", "name", "period"],
    creates: ["study"],
    scopeParams: ["tenant_id"],
    // Success redirects to the upload screen carrying the new study id
    // (`studies/actions.ts:48`); a rejection returns to /admin/studies?error=.
    outcome: {
      denied: { path: "/login" },
      validation: { path: "/admin/studies", query: "error" },
      success: { path: "/admin/upload", query: "study" },
    },
  }),
  "studies.createFromTemplate": action("studies.createFromTemplate", { urlClass: "/admin/studies", mechanism: "browser", page: "/admin/studies", submitLabel: "Usar plantilla", fields: ["template_id", "tenant_id", "name", "period"], creates: ["study"] }),
  "studies.saveAsTemplate": action("studies.saveAsTemplate", { urlClass: "/admin/studies", mechanism: "browser", page: "/admin/studies", submitLabel: "Guardar como plantilla", fields: ["study_id", "template_id", "name", "description"], creates: ["study_template"] }),
  "studies.updateTemplateMetadata": action("studies.updateTemplateMetadata", { urlClass: "/admin/studies", mechanism: "browser", page: "/admin/studies", submitLabel: "Guardar nueva versión", fields: ["template_id", "name", "description"], creates: ["study_template"] }),
  "studies.deleteTemplate": action("studies.deleteTemplate", { urlClass: "/admin/studies", mechanism: "browser", page: "/admin/studies", submitLabel: "Eliminar plantilla", fields: ["template_id"], creates: [], destructive: true }),
  "studies.updateConfiguration": action("studies.updateConfiguration", { urlClass: "/admin/studies", mechanism: "browser", page: "/admin/studies", submitLabel: "Guardar configuración", fields: ["study_id", "name", "period", "status"], creates: [] }),

  // --- imperative, client-invoked: browser only (§1.7) --------------------
  "upload.analyze": action("upload.analyze", { urlClass: "/admin/upload", mechanism: "browser", page: "/admin/upload", imperative: true, creates: [] }),
  "upload.preview": action("upload.preview", { urlClass: "/admin/upload", mechanism: "browser", page: "/admin/upload", imperative: true, creates: [] }),
  "upload.confirm": action("upload.confirm", { urlClass: "/admin/upload", mechanism: "browser", page: "/admin/upload", imperative: true, creates: ["import_batch"] }),
  "upload.rollback": action("upload.rollback", { urlClass: "/admin/upload", mechanism: "browser", page: "/admin/upload", imperative: true, creates: [] }),
  "dashboard.refresh": action("dashboard.refresh", { urlClass: "/dashboard", mechanism: "browser", page: "/dashboard", imperative: true, mutating: false, creates: [] }),
  "dashboard.pivot": action("dashboard.pivot", { urlClass: "/dashboard", mechanism: "browser", page: "/dashboard", imperative: true, mutating: false, creates: [] }),
});

// ---------------------------------------------------------------------------
// Evidence ledger — sanitized at construction, so nothing needs redacting
// ---------------------------------------------------------------------------

export function createLedger() {
  const records = [];
  return {
    add(record) {
      const sanitized = {
        actor: record.actor,
        sessionLabel: record.sessionLabel ?? null,
        sessionKind: record.sessionKind ?? "none",
        operation: record.operation,
        mechanism: record.mechanism,
        httpOnlySession: Boolean(record.httpOnlySession),
        urlClass: record.urlClass,
        httpStatus: record.httpStatus ?? null,
        redirectTo: record.redirectTo ?? null,
        errorCategory: record.errorCategory,
        residue: record.residue ?? null,
        assertion: record.assertion ?? "not_asserted",
        durationMs: record.durationMs ?? 0,
      };
      records.push(sanitized);
      return sanitized;
    },
    all: () => [...records],
    lines: () =>
      records.map(
        (r) =>
          `${r.actor}/${r.sessionKind}[${r.sessionLabel ?? "-"}] ${r.operation} ` +
          `${r.mechanism} ${r.urlClass} -> ${r.httpStatus ?? "-"} ` +
          `${r.redirectTo ? `=> ${r.redirectTo} ` : ""}${r.errorCategory} (${r.durationMs}ms)`,
      ),
  };
}

// ---------------------------------------------------------------------------
// Redirect helper — path only, query stripped except a safe allow-list (§5.1)
// ---------------------------------------------------------------------------

const SAFE_QUERY_KEYS = new Set(["error"]);

export function redirectPath(location, origin) {
  if (!location) return null;
  let url;
  try {
    url = new URL(location, origin);
  } catch {
    return null;
  }
  const kept = [...url.searchParams.entries()].filter(([key]) => SAFE_QUERY_KEYS.has(key));
  const query = kept.length ? `?${kept.map(([k, v]) => `${k}=${v}`).join("&")}` : "";
  return `${url.pathname}${query}`;
}

// ---------------------------------------------------------------------------
// The harness
// ---------------------------------------------------------------------------

const HTTP_TIMEOUT_MS = 15_000;
const now = () => Number(process.hrtime.bigint() / 1_000_000n);

export async function createHarness(options) {
  const {
    origin,
    actors: wanted,
    browser: browserMode,
    fixtures,
    credentials,
    supabase: supabaseConfig,
    launchBrowser,
    PAGE,
    log = () => {},
  } = options;

  if (browserMode !== "required" && browserMode !== "httpOnlyUtility") {
    throw new Error('createHarness: browser must be "required" or "httpOnlyUtility"');
  }

  const ledger = createLedger();
  const actors = new Map();
  let browser = null;

  for (const id of wanted) {
    actors.set(id, {
      id,
      role: credentials[id]?.role ?? null,
      sessionKind: id === "anonymous" ? "none" : "none",
      sessionLabel: null,
      httpOnlySession: false,
      jar: createJar(),
      contexts: {},
    });
  }

  if (browserMode === "required") {
    browser = await launchBrowser();
    log(`  browser: ${browser.binary} on ephemeral port ${browser.port}`);
  }

  function actor(id) {
    const found = actors.get(id);
    if (!found) throw new Error(`unknown actor ${id}`);
    return found;
  }

  async function contextFor(id, { javaScript }) {
    if (!browser) throw new Error("a browser is required for this mechanism (design §3.2)");
    const key = javaScript ? "js" : "nojs";
    const a = actor(id);
    if (!a.contexts[key]) {
      a.contexts[key] = await browser.createContext({ label: `${id}:${key}`, javaScript });
    }
    return a.contexts[key];
  }

  // --- the http mechanism ---------------------------------------------------

  async function httpRun(a, op, params) {
    const path = fillPath(op.path ?? op.urlClass, params);
    const started = now();
    let response = null;
    let transportError = false;
    try {
      const headers = {};
      const cookie = a.jar.header();
      if (cookie) headers.cookie = cookie;
      response = await fetch(new URL(path, origin), {
        method: op.method ?? "GET",
        headers,
        redirect: "manual",
        signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
      });
      a.jar.absorb(response.headers.getSetCookie());
    } catch {
      transportError = true;
    }
    const contentType = response?.headers.get("content-type") ?? null;
    const successSignal =
      op.successSignalHeader && contentType
        ? contentType.includes(op.successSignalHeader.contains)
        : response
          ? response.status >= 200 && response.status < 300
          : false;
    const observation = {
      status: response?.status ?? null,
      redirectTo: redirectPath(response?.headers.get("location"), origin),
      fromAdminPath: Boolean(op.fromAdminPath),
      successSignal,
      transportError,
    };
    // Drain the body so the socket is released. It is never read, parsed,
    // classified or stored — only its length is discarded (§2.3, §5.2).
    if (response) await response.arrayBuffer().catch(() => {});
    return finish(a, op, "http", observation, now() - started);
  }

  // --- the form / browser mechanisms ---------------------------------------

  /**
   * Classifies a submitted form from its DECLARED, static outcome contract:
   * the public path the framework navigated to plus a public query key. An
   * outcome the operation did not declare is `none`, which classifies as
   * `unclassified` and fails the run — success is never the default.
   */
  function evaluateOutcome(op, landedFull) {
    const contract = op.outcome;
    if (!contract) {
      throw new Error(
        `no outcome contract for "${op.name}" — not implemented in PR 5; a later suite ` +
          "must declare and review one before this operation can be classified",
      );
    }
    const [path, query = ""] = landedFull.split("?");
    const params = new URLSearchParams(query);
    const matches = (rule) =>
      rule && path === rule.path && (!rule.query || params.has(rule.query));
    if (matches(contract.denied)) return "denial";
    if (matches(contract.validation)) return "validation";
    if (matches(contract.success)) return "success";
    return "none";
  }

  async function browserRun(a, op, params, mechanism) {
    const javaScript = mechanism !== "form";
    const context = await contextFor(a.id, { javaScript });
    const started = now();

    // Imperative Server Actions have no form; a reviewed, statically dispatched
    // driver drives the app's own controls (design §1.7). An operation without
    // one throws rather than being reported as any outcome.
    if (op.imperative) {
      const driver = browserDriverFor(op.name);
      const observation = await driver({ context, origin, PAGE });
      return finish(a, op, mechanism, observation, now() - started);
    }

    const pagePath = fillPath(op.page ?? op.urlClass, params);
    await context.navigate(new URL(pagePath, origin).toString());
    const landed = await context.evaluate("location.pathname");
    if (landed === "/login" && pagePath !== "/login") {
      return finish(a, op, mechanism, { status: 302, redirectTo: "/login" }, now() - started);
    }
    const ready = await context.evaluate(PAGE.landmark);
    if (!ready) {
      return finish(a, op, mechanism, { status: 200, domSignal: "none" }, now() - started);
    }
    const formIndex = await context.evaluate(PAGE.formBySubmit(op.submitLabel));
    if (formIndex < 0) {
      throw new Error(
        `control_absent_on_authorized_page: "${op.submitLabel}" not found on ${pagePath} — ` +
          "the page rendered, so this is a rendering/inventory regression, not a denial (§4.2)",
      );
    }
    for (const field of op.fields ?? []) {
      if (params[field] === undefined) continue;
      const result = await context.evaluate(PAGE.setField(formIndex, field, String(params[field])));
      if (result !== "ok") throw new Error(`could not fill field ${field}: ${result}`);
    }
    const finalPath = await context.submitAndWait(PAGE.clickSubmit(formIndex));
    const observation = {
      status: 200,
      redirectTo: null,
      domSignal: evaluateOutcome(op, finalPath),
      landedOn: finalPath,
    };
    const record = finish(a, op, mechanism, observation, now() - started);
    record.landedOn = finalPath;
    return record;
  }

  function finish(a, op, mechanism, observation, durationMs) {
    return ledger.add({
      actor: a.id,
      sessionLabel: a.sessionLabel,
      sessionKind: a.sessionKind,
      operation: op.name,
      mechanism,
      httpOnlySession: a.httpOnlySession,
      urlClass: op.urlClass,
      httpStatus: observation.status,
      redirectTo: observation.redirectTo ?? null,
      errorCategory: classify(observation),
      durationMs,
    });
  }

  function fillPath(template, params = {}) {
    return template.replace(/:([A-Za-z]+)/g, (match, key) => {
      if (params[key] === undefined) throw new Error(`missing path parameter ${key}`);
      return encodeURIComponent(params[key]);
    });
  }

  // --- the single execution entry point (§8.3) ------------------------------

  async function run(actorId, op, params = {}) {
    const a = actor(actorId);
    // Ownership and scope are decided by the fixture ledger, before any request
    // leaves the process (§6.2, §6.6).
    fixtures.authorizeMutation(op, params);
    if (op.mechanism === "http") return httpRun(a, op, params);
    return browserRun(a, op, params, op.mechanism);
  }

  // --- sign-in through the application's own login surface (§3.2) -----------

  /** One real pass through M-A1 in one context. No shortcut, no cookie copy. */
  async function loginInContext(actorId, javaScript) {
    const creds = credentials[actorId];
    const context = await contextFor(actorId, { javaScript });
    await context.navigate(new URL("/login", origin).toString());
    const formIndex = await context.evaluate(PAGE.formBySubmit("Iniciar sesión"));
    if (formIndex < 0) throw new Error("login form not found by its accessible submit name");
    await context.evaluate(PAGE.setField(formIndex, "email", creds.email));
    await context.evaluate(PAGE.setField(formIndex, "password", creds.password));
    const landed = await context.submitAndWait(PAGE.clickSubmit(formIndex));
    if (!landed.startsWith("/dashboard")) {
      throw new Error(
        `sign-in for ${actorId} (js=${javaScript}) did not reach the dashboard (landed on ${landed})`,
      );
    }
    return context;
  }

  /**
   * Signs the actor in through the application's own login surface, once per
   * context the actor will use. Each context therefore holds a session the app
   * itself issued — the harness never copies a credential between contexts, and
   * `auth.login`'s frozen `form` mechanism is exercised for real by the
   * JavaScript-disabled pass (§3.2).
   */
  async function signIn(actorId) {
    const a = actor(actorId);
    if (!credentials[actorId]) throw new Error(`no credentials configured for ${actorId}`);
    a.sessionLabel = newSessionLabel();
    if (OPERATIONS["auth.login"].mechanism === "form") await loginInContext(actorId, false);
    const context = await loginInContext(actorId, true);
    const cookies = await context.cookies(origin);
    a.jar.clear();
    for (const { name, value } of cookies) a.jar.set(name, value);
    a.sessionKind = "live";
    a.httpOnlySession = false;
    return a;
  }

  /** The app's own rendered identity signal — never read from the cookie (§3.5). */
  async function assertIdentity(actorId) {
    actor(actorId); // rejects an unknown actor id before any request is made
    const creds = credentials[actorId];
    const context = await contextFor(actorId, { javaScript: true });
    await context.navigate(new URL("/dashboard", origin).toString());
    const shown = await context.evaluate(
      "(document.querySelector('header')?.innerText || '').trim()",
    );
    if (!shown.includes(creds.email)) {
      throw new Error(`identity mismatch for ${actorId}: the app did not report this actor`);
    }
    return true;
  }

  /**
   * Structural + behavioral isolation (§3.3). Compares auth-cookie values in
   * memory and returns a verdict; prints no name, value, hash or token-derived
   * metadata, and never fails on identical NON-auth cookies.
   */
  function assertSessionIsolation(ids) {
    const live = ids.map((id) => actor(id));
    const jars = new Set(live.map((a) => a.jar));
    const owned = live.flatMap((a) => Object.values(a.contexts).map((c) => c.browserContextId));
    const contexts = new Set(owned);
    if (jars.size !== live.length) throw new Error("session isolation: a jar object is shared between actors");
    if (contexts.size !== owned.length) throw new Error("session isolation: a browser context is shared between actors");
    const labels = new Set(live.map((a) => a.sessionLabel));
    if (labels.size !== live.length) throw new Error("session isolation: session labels are not distinct");
    for (let i = 0; i < live.length; i += 1) {
      for (let j = i + 1; j < live.length; j += 1) {
        const left = new Set(live[i].jar.authValues());
        const shared = live[j].jar.authValues().some((value) => left.has(value));
        if (shared) {
          throw new Error(
            `session isolation: an auth credential is reused between ${live[i].id} and ${live[j].id}`,
          );
        }
      }
    }
    return { actors: live.length, contexts: contexts.size };
  }

  // --- session manipulation (§3.4) — no signing, no clock control -----------

  const session = {
    /** N2: structurally malformed bytes. No signature is ever produced. */
    async invalidate(actorId) {
      const a = actor(actorId);
      const context = await contextFor(actorId, { javaScript: true });
      const replacements = a.jar
        .entries()
        .filter(({ name }) => AUTH_COOKIE.test(name))
        .map(({ name, value }) => ({
          name,
          value: `${randomBytes(Math.max(8, Math.min(48, value.length >> 2))).toString("base64url")}`,
        }));
      if (!replacements.length) throw new Error("invalidate: no auth cookie present to corrupt");
      for (const { name, value } of replacements) a.jar.set(name, value);
      await context.clearCookies();
      await context.setCookies(origin, a.jar.entries());
      a.sessionKind = "invalid";
      a.sessionLabel = newSessionLabel();
      return a;
    },

    /** N1: empty jar, in EVERY context this actor owns. */
    async clear(actorId) {
      const a = actor(actorId);
      a.jar.clear();
      // Clearing only one context would leave the actor signed in elsewhere and
      // make a later real sign-in redirect straight past the login form.
      for (const context of Object.values(a.contexts)) await context.clearCookies();
      a.sessionKind = "none";
      a.sessionLabel = newSessionLabel();
      return a;
    },

    /**
     * N3: after sign-out, prove the prior REFRESH session cannot mint a new one.
     * Deliberately does NOT claim the already-issued access JWT is rejected
     * before its own `exp` — Supabase does not promise that (§3.4).
     */
    async revokeRefresh(actorId) {
      const a = actor(actorId);
      const captured = a.jar.entries();
      const context = await contextFor(actorId, { javaScript: true });
      await context.navigate(new URL("/dashboard", origin).toString());
      const formIndex = await context.evaluate(PAGE.formBySubmit("Cerrar sesión"));
      if (formIndex < 0) throw new Error("logout control not found by its accessible name");
      const landed = await context.submitAndWait(PAGE.clickSubmit(formIndex));
      // A navigation event can fire before the sign-out action has settled
      // server-side. Wait for the application's own completed outcome — the
      // login form rendered — so the refresh attempt below cannot race it.
      if (!landed.startsWith("/login")) {
        await context.waitForDom(
          "() => location.pathname === '/login' && !!document.querySelector('form input[name=password]')",
        );
      }

      // Replay the captured jar through the app's own SSR client. The client
      // parses the cookie itself: no token is extracted, printed or stored here.
      const replay = new Map(captured.map(({ name, value }) => [name, value]));
      const client = createServerClient(supabaseConfig.url, supabaseConfig.anonKey, {
        cookies: {
          getAll: () => [...replay.entries()].map(([name, value]) => ({ name, value })),
          setAll: (list) => list.forEach(({ name, value }) => replay.set(name, value)),
        },
      });
      const { data, error } = await client.auth.refreshSession();
      a.sessionKind = "revoked_refresh";
      a.sessionLabel = newSessionLabel();
      const refreshRejected = Boolean(error) || !data?.session;
      return { refreshRejected, errorName: error ? "refresh_rejected" : null };
    },
  };

  /**
   * Implementation-time DISCOVERY only (§1.6, §2.2). Reports whether a surface
   * submits natively with JavaScript disabled. It does NOT change any
   * mechanism: the result is written into OPERATIONS by hand and reviewed in
   * PR 5's diff. Calling it never makes a `browser` surface run as `form`.
   */
  async function assertDegrades(op, params = {}, expectPath) {
    const a = actor(params.__actor ?? "internal");
    const context = await contextFor(a.id, { javaScript: false });
    await context.navigate(new URL(op.page, origin).toString());
    const formIndex = await context.evaluate(PAGE.formBySubmit(op.submitLabel));
    if (formIndex < 0) return { degrades: false, reason: "form-not-rendered" };
    for (const field of op.fields ?? []) {
      if (params[field] === undefined) continue;
      const filled = await context.evaluate(PAGE.setField(formIndex, field, String(params[field])));
      if (filled !== "ok") return { degrades: false, reason: `field-${field}-${filled}` };
    }
    let landed;
    try {
      landed = await context.submitAndWait(PAGE.clickSubmit(formIndex));
    } catch (error) {
      return { degrades: false, reason: `no-navigation: ${error.message}` };
    }
    const degrades = expectPath ? landed.startsWith(expectPath) : landed !== op.page;
    return { degrades, landedOn: landed };
  }

  async function close() {
    if (browser) await browser.close();
  }

  return {
    origin,
    actor,
    actors,
    ledger,
    run,
    signIn,
    assertIdentity,
    assertSessionIsolation,
    session,
    assertDegrades,
    contextFor,
    fixtures,
    close,
  };
}
