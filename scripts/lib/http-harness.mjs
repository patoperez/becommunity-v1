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
import { browserDriverFor, hasBrowserDriver } from "./harness-browser.mjs";
import { inspectHttpResponse } from "./response-inspect.mjs";

// ---------------------------------------------------------------------------
// Vocabulary
// ---------------------------------------------------------------------------

// `scopedClient` is Suite A's temporary restricted-scope identity (PR 6): a real
// `client` in an existing synthetic tenant whose profile carries a non-empty
// `data_scope`. It is an ordinary actor here — the harness knows nothing about
// what its scope means, exactly as it knows nothing about tenancy.
export const ACTOR_IDS = ["tenantA", "tenantB", "internal", "scopedClient", "anonymous", "invalidToken"];
export const MECHANISMS = ["http", "form", "browser"];
/** No "expired" member: N4 is deferred and must never be simulated by N3 (§3.4). */
export const SESSION_KINDS = ["live", "invalid", "revoked_refresh", "none"];

export const ERROR_CATEGORIES = [
  "denied_unauthenticated",
  "denied_wrong_role",
  "denied_action_result",
  "not_found",
  "validation_rejected",
  // 405. A real, nameable HTTP answer and never an authorization one: it is
  // what a route says when the METHOD is wrong, which the suites use as the
  // control that distinguishes a method rejection from a denial. It is in the
  // closed vocabulary precisely so it cannot fall through to `unclassified`
  // and be argued about later.
  "method_not_allowed",
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
    if (o.redirectTo === "/dashboard") return o.fromInternalPath ? "denied_wrong_role" : "success";
    return "unclassified";
  }
  if (status === 404) return "not_found";
  if (status === 405) return "method_not_allowed";
  if (status === 400) return "validation_rejected";
  if (status >= 200 && status < 300) {
    if (o.domSignal === "denial") return "denied_action_result";
    // The product's own rendered wrong-role page, served with HTTP 200
    // (`/admin/upload` for a `client`, design §1.8 AM4). It is a ROLE denial,
    // not an action result, and the two must never collapse into one category.
    if (o.domSignal === "denied_role") return "denied_wrong_role";
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
  { what: "302 to /dashboard from an internal route", input: { status: 307, redirectTo: "/dashboard", fromInternalPath: true }, expect: "denied_wrong_role" },
  { what: "302 to /dashboard after login", input: { status: 307, redirectTo: "/dashboard", fromInternalPath: false }, expect: "success" },
  { what: "404 not found", input: { status: 404 }, expect: "not_found" },
  { what: "405 method not allowed", input: { status: 405 }, expect: "method_not_allowed" },
  { what: "400 in the report route's error shape", input: { status: 400 }, expect: "validation_rejected" },
  { what: "200 whose rendered DOM shows the denial region", input: { status: 200, domSignal: "denial" }, expect: "denied_action_result" },
  { what: "200 rendering the app's own wrong-role page (AM4)", input: { status: 200, domSignal: "denied_role" }, expect: "denied_wrong_role" },
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
  fromInternalPath: path.startsWith("/admin") || path.startsWith("/studio"),
  ...extra,
});

const action = (name, extra) => ({ name, mutating: true, ...extra });

/**
 * An OUTER ACTION-ROUTE probe (PR 7 review pass).
 *
 * Every Server Action in this application is dispatched by POSTing to the page
 * that renders it. Driving the action itself from outside would require the
 * hashed Next-Action identifier or a hand-built RSC body, both forbidden —
 * so the reachable, honest thing to test is the OUTER boundary on that exact
 * method and path: one ordinary form-shaped POST, no action identifier, no
 * private field, no mutation payload.
 *
 * The `content-type` is declared rather than implicit so that every probe sends
 * the same, ordinary, form-shaped request and nothing is left to `fetch` to
 * infer. The suite pairs these probes with a PUBLIC-path control
 * (`route.postHealth`): the same request to a public route handler that exports
 * only GET is answered 405 with no redirect, which is what shows the
 * protected-path denial is specific to protected paths rather than a blanket
 * answer to any POST.
 */
const routeProbe = (name, path) => ({
  name,
  urlClass: path,
  path,
  method: "POST",
  mechanism: "http",
  mutating: false,
  outerRouteProbe: true,
  /** Declared, so `httpRun` never improvises a body or a content type. */
  contentType: "application/x-www-form-urlencoded",
  fromInternalPath: path.startsWith("/admin") || path.startsWith("/studio"),
});

/**
 * Outcome contracts, expressed once. Every admin Server Action in this app ends
 * in `redirect(...)`, and each family redirects to a fixed path carrying either
 * `?ok=` or `?error=` (`clients/actions.ts:27`, `studies/actions.ts:28`,
 * `qualitative/actions.ts:23`). An unauthenticated caller is redirected to
 * `/login` by the same guard before any of that (`internalContext()`).
 *
 * Only the PATH and the presence of a QUERY KEY are ever read — never the
 * message those keys carry, which contains product text.
 */
const adminOutcome = (path) => ({
  denied: { path: "/login" },
  validation: { path, query: "error" },
  success: { path, query: "ok" },
});

export const OPERATIONS = Object.freeze({
  // --- pages and route handlers: ordinary HTTP (§2.1) ----------------------
  "page.root": page("page.root", "/"),
  "page.login": page("page.login", "/login"),
  "page.dashboard": page("page.dashboard", "/dashboard", { acceptsForgedHeaders: true }),
  "page.adminClients": page("page.adminClients", "/admin/clients", { acceptsForgedHeaders: true }),
  "page.adminStudies": page("page.adminStudies", "/admin/studies", { acceptsForgedHeaders: true }),
  "page.adminQualitative": page("page.adminQualitative", "/admin/qualitative", { acceptsForgedHeaders: true }),
  "page.adminUpload": page("page.adminUpload", "/admin/upload", { acceptsForgedHeaders: true }),
  "page.adminPreview": page("page.adminPreview", "/admin/preview/:studyId", { acceptsForgedHeaders: true }),
  "page.studioHome": page("page.studioHome", "/studio", { acceptsForgedHeaders: true }),
  "page.studioClients": page("page.studioClients", "/studio/clientes", { acceptsForgedHeaders: true }),
  "page.studioStudies": page("page.studioStudies", "/studio/estudios", { acceptsForgedHeaders: true }),
  "page.studioTemplates": page("page.studioTemplates", "/studio/plantillas", { acceptsForgedHeaders: true }),
  "page.studioStudy": page("page.studioStudy", "/studio/e/:studyId", { acceptsForgedHeaders: true }),
  "health.get": page("health.get", "/api/health"),
  "report.download": page("report.download", "/api/studies/:studyId/report", {
    successSignalHeader: { header: "content-type", contains: "application/pdf" },
    // The route's own public contract is `f.<dimension>=<value>` query
    // parameters (`src/lib/reporting/filters.ts`). Declaring it in the frozen
    // catalogue is what lets `run()` append them: a caller cannot improvise a
    // query on an operation that has not been reviewed for one.
    acceptsQuery: true,
    acceptsForgedHeaders: true,
    // PR 7: this is an ORDINARY route handler whose body is a public product
    // contract (a PDF, or the documented JSON validation error). It is the only
    // operation whose response may be handed to the sanitizing inspector, and
    // the inspector returns categories and counts only (§ response-inspect).
    inspectable: true,
  }),
  "qualitative.selectStudy": page("qualitative.selectStudy", "/admin/qualitative?study=:studyId", {
    urlClass: "/admin/qualitative?study=:studyId",
  }),

  // --- outer action-route probes: the POST method and path every Server
  // --- Action on that page is dispatched to (see `routeProbe`) ------------
  "route.postAdminClients": routeProbe("route.postAdminClients", "/admin/clients"),
  // P8.2 gave every Studio surface its own address while every `/admin/*`
  // address kept answering. A Server Action is dispatched by POSTing to the
  // page that renders it, so each new address is a new protected POST path
  // class and each one is catalogued here. The dynamic classes carry a literal
  // all-zero id: the routes check the internal role BEFORE reading the id, so a
  // wrong-role caller is redirected without the probe ever naming a real
  // object.
  "route.postStudioClients": routeProbe("route.postStudioClients", "/studio/clientes"),
  "route.postStudioClient": routeProbe(
    "route.postStudioClient",
    "/studio/clientes/00000000-0000-0000-0000-000000000000",
  ),
  "route.postStudioTemplates": routeProbe("route.postStudioTemplates", "/studio/plantillas"),
  "route.postStudioStudyIndicators": routeProbe(
    "route.postStudioStudyIndicators",
    "/studio/e/00000000-0000-0000-0000-000000000000/indicadores",
  ),
  "route.postStudioStudyQualitative": routeProbe(
    "route.postStudioStudyQualitative",
    "/studio/e/00000000-0000-0000-0000-000000000000/cualitativo",
  ),
  "route.postStudioStudyPublish": routeProbe(
    "route.postStudioStudyPublish",
    "/studio/e/00000000-0000-0000-0000-000000000000/publicar",
  ),
  "route.postAdminStudies": routeProbe("route.postAdminStudies", "/admin/studies"),
  "route.postAdminQualitative": routeProbe("route.postAdminQualitative", "/admin/qualitative"),
  "route.postAdminUpload": routeProbe("route.postAdminUpload", "/admin/upload"),
  // The PUBLIC-path control. `/api/health` is public by design and its route
  // handler exports only GET, so the identical form-shaped POST is answered 405
  // with no redirect. It is not an action route and no mutation names it: it
  // exists so a protected-path denial can be shown to be specific.
  "route.postHealth": routeProbe("route.postHealth", "/api/health"),

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
    mutating: false,
    // `logout` signs out and redirects to /login (`dashboard/actions.ts:11`).
    outcome: { success: { path: "/login" } },
  }),

  // --- internal-only admin mutations --------------------------------------
  "clients.createTenant": action("clients.createTenant", {
    alsoDispatchedTo: ["route.postStudioClients"],
    actionRoute: "route.postAdminClients",
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
    outcome: adminOutcome("/admin/clients"),
  }),
  "clients.renameTenant": action("clients.renameTenant", {
    alsoDispatchedTo: ["route.postStudioClient"],
    actionRoute: "route.postAdminClients",
    urlClass: "/admin/clients", mechanism: "browser", page: "/admin/clients",
    submitLabel: "Guardar", fields: ["name"], identifyBy: "tenant_id",
    targetParams: ["tenant_id"], creates: [], outcome: adminOutcome("/admin/clients"),
  }),
  "clients.updateTenantBrand": action("clients.updateTenantBrand", {
    alsoDispatchedTo: ["route.postStudioClient"],
    actionRoute: "route.postAdminClients",
    urlClass: "/admin/clients", mechanism: "browser", page: "/admin/clients",
    // Verified against `clients/page.tsx:92`: the accessible name is
    // "Guardar identidad". The PR-5 catalogue recorded "Guardar marca", which
    // no control carries; the corrected value is the product's own contract.
    submitLabel: "Guardar identidad", fields: ["display_name", "tagline"], identifyBy: "tenant_id",
    // Writes a Storage object, and `storage_object` deliberately has no ledger
    // kind (its safe deletion path is unverified), so only DENIAL paths run.
    deniedPathsOnly: true, creates: [], outcome: adminOutcome("/admin/clients"),
  }),
  "clients.inviteClientUser": action("clients.inviteClientUser", {
    alsoDispatchedTo: ["route.postStudioClient"],
    actionRoute: "route.postAdminClients",
    urlClass: "/admin/clients", mechanism: "browser", page: "/admin/clients",
    submitLabel: "Enviar invitación", fields: ["tenant_id", "email", "full_name", "data_scope"],
    // AM2: the positive path creates an Auth identity and sends a message. The
    // harness never creates or invites one (§6.6), so only denial paths run.
    deniedPathsOnly: true, creates: [], outcome: adminOutcome("/admin/clients"),
  }),
  "clients.updateClientUser": action("clients.updateClientUser", {
    alsoDispatchedTo: ["route.postStudioClient"],
    actionRoute: "route.postAdminClients",
    urlClass: "/admin/clients", mechanism: "browser", page: "/admin/clients",
    submitLabel: "Guardar usuario", fields: ["full_name", "data_scope"], identifyBy: "user_id",
    // The run owns no client user, so this operation may only ever be denied.
    deniedPathsOnly: true, creates: [], outcome: adminOutcome("/admin/clients"),
  }),
  "clients.deleteClientUser": action("clients.deleteClientUser", {
    alsoDispatchedTo: ["route.postStudioClient"],
    actionRoute: "route.postAdminClients",
    urlClass: "/admin/clients", mechanism: "browser", page: "/admin/clients",
    submitLabel: "Eliminar cuenta cliente", fields: ["confirmation_email"], identifyBy: "user_id",
    deniedPathsOnly: true, destructive: true, creates: [], outcome: adminOutcome("/admin/clients"),
  }),
  "qualitative.generateSuggestions": action("qualitative.generateSuggestions", {
    alsoDispatchedTo: ["route.postStudioStudyQualitative"],
    actionRoute: "route.postAdminQualitative",
    urlClass: "/admin/qualitative", mechanism: "browser", page: "/admin/qualitative?study=:studyId",
    submitLabel: "Generar sugerencias pendientes", fields: [],
    targetParams: ["studyId"], creates: [], outcome: adminOutcome("/admin/qualitative"),
  }),
  "qualitative.reviewObservations": action("qualitative.reviewObservations", {
    alsoDispatchedTo: ["route.postStudioStudyQualitative"],
    actionRoute: "route.postAdminQualitative",
    urlClass: "/admin/qualitative", mechanism: "browser", page: "/admin/qualitative?study=:studyId",
    submitLabel: "Aceptar sugerencias", fields: ["theme", "stage_key"],
    // The page renders only the SELECTED study's observations, so checking its
    // own checkboxes can never reach another study's rows.
    checkAllNamed: ["observation_id", "quote_id"],
    targetParams: ["studyId"], creates: [], outcome: adminOutcome("/admin/qualitative"),
  }),
  "studies.createBlank": action("studies.createBlank", {
    actionRoute: "route.postAdminStudies",
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
  "studies.createFromTemplate": action("studies.createFromTemplate", {
    alsoDispatchedTo: ["route.postStudioTemplates"],
    actionRoute: "route.postAdminStudies",
    urlClass: "/admin/studies", mechanism: "browser", page: "/admin/studies",
    submitLabel: "Usar plantilla", fields: ["tenant_id", "name", "period"], identifyBy: "template_id",
    scopeParams: ["tenant_id"], targetParams: ["template_id"], creates: ["study"],
    outcome: adminOutcome("/admin/studies"),
  }),
  "studies.saveAsTemplate": action("studies.saveAsTemplate", {
    alsoDispatchedTo: ["route.postStudioTemplates"],
    actionRoute: "route.postAdminStudies",
    urlClass: "/admin/studies", mechanism: "browser", page: "/admin/studies",
    submitLabel: "Guardar como plantilla", fields: ["study_id", "template_id", "name", "description"],
    targetParams: ["study_id"], creates: ["studyTemplate"], outcome: adminOutcome("/admin/studies"),
  }),
  "studies.updateTemplateMetadata": action("studies.updateTemplateMetadata", {
    alsoDispatchedTo: ["route.postStudioTemplates"],
    actionRoute: "route.postAdminStudies",
    urlClass: "/admin/studies", mechanism: "browser", page: "/admin/studies",
    submitLabel: "Guardar nueva versión", fields: ["name", "description"], identifyBy: "template_id",
    targetParams: ["template_id"], creates: [], outcome: adminOutcome("/admin/studies"),
  }),
  "studies.deleteTemplate": action("studies.deleteTemplate", {
    alsoDispatchedTo: ["route.postStudioTemplates"],
    actionRoute: "route.postAdminStudies",
    urlClass: "/admin/studies", mechanism: "browser", page: "/admin/studies",
    submitLabel: "Eliminar plantilla", fields: [], identifyBy: "template_id",
    // The form carries a `required` confirmation checkbox; a real user ticks it.
    checkAllInForm: true,
    targetParams: ["template_id"], destructive: true, creates: [],
    outcome: adminOutcome("/admin/studies"),
  }),
  "studies.updateConfiguration": action("studies.updateConfiguration", {
    alsoDispatchedTo: ["route.postStudioStudyIndicators"],
    actionRoute: "route.postAdminStudies",
    urlClass: "/admin/studies", mechanism: "browser", page: "/admin/studies",
    submitLabel: "Guardar configuración", fields: ["name", "period", "status"], identifyBy: "study_id",
    targetParams: ["study_id"], creates: [], outcome: adminOutcome("/admin/studies"),
  }),

  // --- P8.2 account and client lifecycle, and publication -----------------
  //
  // All six are DENIAL-PATHS-ONLY. Their success would ban an Auth identity,
  // destroy a client organisation with every row and Storage object under it,
  // or change what a client can see — none of which this run can undo, and the
  // fixture ledger enforces that independently. They are proven at the page
  // gate exactly like the other denial-only operations.
  "clients.suspendClientUser": action("clients.suspendClientUser", {
    actionRoute: "route.postStudioClient",
    urlClass: "/studio/clientes/:tenantId", mechanism: "browser",
    page: "/studio/clientes/:tenantId",
    submitLabel: "Suspender el acceso", fields: [], identifyBy: "user_id",
    deniedPathsOnly: true, creates: [], outcome: adminOutcome("/studio/clientes/:tenantId"),
  }),
  "clients.restoreClientUser": action("clients.restoreClientUser", {
    actionRoute: "route.postStudioClient",
    urlClass: "/studio/clientes/:tenantId", mechanism: "browser",
    page: "/studio/clientes/:tenantId",
    submitLabel: "Devolver el acceso", fields: [], identifyBy: "user_id",
    deniedPathsOnly: true, creates: [], outcome: adminOutcome("/studio/clientes/:tenantId"),
  }),
  "clients.archiveTenant": action("clients.archiveTenant", {
    actionRoute: "route.postStudioClient",
    urlClass: "/studio/clientes/:tenantId", mechanism: "browser",
    page: "/studio/clientes/:tenantId",
    submitLabel: "Archivar el cliente", fields: [], identifyBy: "tenant_id",
    deniedPathsOnly: true, creates: [], outcome: adminOutcome("/studio/clientes/:tenantId"),
  }),
  "clients.restoreTenant": action("clients.restoreTenant", {
    actionRoute: "route.postStudioClient",
    urlClass: "/studio/clientes/:tenantId", mechanism: "browser",
    page: "/studio/clientes/:tenantId",
    submitLabel: "Reactivar el cliente", fields: [], identifyBy: "tenant_id",
    deniedPathsOnly: true, creates: [], outcome: adminOutcome("/studio/clientes/:tenantId"),
  }),
  "clients.deleteTenant": action("clients.deleteTenant", {
    actionRoute: "route.postStudioClient",
    urlClass: "/studio/clientes/:tenantId", mechanism: "browser",
    page: "/studio/clientes/:tenantId",
    submitLabel: "Eliminar el cliente para siempre",
    fields: ["confirmation_name", "impact"], identifyBy: "tenant_id",
    deniedPathsOnly: true, destructive: true, creates: [],
    outcome: adminOutcome("/studio/clientes/:tenantId"),
  }),
  "studies.setPublication": action("studies.setPublication", {
    actionRoute: "route.postStudioStudyPublish",
    urlClass: "/studio/e/:studyId/publicar", mechanism: "browser",
    page: "/studio/e/:studyId/publicar",
    submitLabel: "Publicar para el cliente", fields: [], identifyBy: "study_id",
    // Publication changes what a real client account can see. The run never
    // drives it to success; the denial paths are what this suite is for.
    deniedPathsOnly: true, creates: [], outcome: adminOutcome("/studio/e/:studyId/publicar"),
  }),

  // --- imperative, client-invoked: browser only (§1.7) --------------------
  "upload.analyze": action("upload.analyze", {
    actionRoute: "route.postAdminUpload",
    urlClass: "/admin/upload", mechanism: "browser", page: "/admin/upload",
    imperative: true, scopeParams: ["tenant_id"], creates: [],
  }),
  "upload.preview": action("upload.preview", {
    actionRoute: "route.postAdminUpload",
    urlClass: "/admin/upload", mechanism: "browser", page: "/admin/upload",
    imperative: true, scopeParams: ["tenant_id"], creates: [],
  }),
  "upload.confirm": action("upload.confirm", {
    actionRoute: "route.postAdminUpload",
    urlClass: "/admin/upload", mechanism: "browser", page: "/admin/upload",
    imperative: true, scopeParams: ["tenant_id"], targetParams: ["study_id"],
    creates: ["importBatch"],
  }),
  "upload.rollback": action("upload.rollback", {
    actionRoute: "route.postAdminUpload",
    urlClass: "/admin/upload", mechanism: "browser", page: "/admin/upload",
    // The control targets the LATEST COMMITTED batch, which the page derives
    // itself and never renders as an id. Ownership therefore cannot be proven
    // from a parameter: the caller must prove, immediately before dispatch,
    // that the latest committed batch is one this run created. `targetParams`
    // names the id it must have verified.
    imperative: true, destructive: true, targetParams: ["batch_id"], creates: [],
  }),
  "dashboard.refresh": action("dashboard.refresh", {
    urlClass: "/dashboard", mechanism: "browser", page: "/dashboard",
    imperative: true, mutating: false, creates: [],
  }),
  "dashboard.pivot": action("dashboard.pivot", {
    urlClass: "/dashboard", mechanism: "browser", page: "/dashboard",
    imperative: true, mutating: false, creates: [],
  }),
});

// ---------------------------------------------------------------------------
// Declared outcome contracts (§5.3) — public path/query only
// ---------------------------------------------------------------------------

/**
 * Classifies a submitted form from its DECLARED, static outcome contract using
 * only the public path the framework navigated to and its query keys.
 *
 * Rules that require a query key are strictly more specific than path-only
 * rules, so they are matched FIRST. Checking in declaration order instead would
 * make `/login?error=` unreachable behind a path-only `/login` denial rule.
 * An outcome the operation did not declare is `none`, which classifies as
 * `unclassified` and fails the run — success is never the default.
 */
export function evaluateOutcome(op, landedFull) {
  const contract = op?.outcome;
  if (!contract) {
    throw new Error(
      `no outcome contract for "${op?.name}" — not implemented in PR 5; a later suite ` +
        "must declare and review one before this operation can be classified",
    );
  }
  const [path, query = ""] = String(landedFull).split("?");
  const params = new URLSearchParams(query);
  const rules = [
    ["denial", contract.denied],
    ["validation", contract.validation],
    ["success", contract.success],
  ].filter(([, rule]) => Boolean(rule));
  const matches = ([, rule]) => path === rule.path && (!rule.query || params.has(rule.query));
  const specific = rules.filter(([, rule]) => Boolean(rule.query));
  const general = rules.filter(([, rule]) => !rule.query);
  const hit = specific.find(matches) ?? general.find(matches);
  return hit ? hit[0] : "none";
}

// ---------------------------------------------------------------------------
// Static capability model (§2.2) — what PR 5 can actually execute
// ---------------------------------------------------------------------------

/**
 * Decided from the frozen catalogue alone, BEFORE any side effect. A catalogue
 * entry exists for every inventoried surface, but PR 5 only implements a few of
 * them; calling any other must fail before it can navigate, fill or submit a
 * real form and mutate live data.
 */
export function operationSupport(op) {
  if (!op || !op.name) return { supported: false, reason: "not a catalogue operation" };

  // Mutating operations must additionally declare how ownership is proven, or
  // the fixture ledger cannot decide whether the target belongs to this run.
  //
  // `deniedPathsOnly` is the fourth admissible declaration and the strictest:
  // the operation may never be driven towards a positive outcome at all, and
  // the ledger forces every id-shaped parameter it receives to be either a
  // ledgered object or the reserved never-existing id (§ fixtures). An
  // operation whose success would create an Auth identity, send a message or
  // write a Storage object carries it, because no ledger kind can undo those.
  const ownershipDeclared =
    op.deniedPathsOnly === true ||
    (op.creates?.length ?? 0) > 0 ||
    (op.scopeParams?.length ?? 0) > 0 ||
    (op.targetParams?.length ?? 0) > 0;
  if (op.mutating && !ownershipDeclared) {
    return { supported: false, reason: "mutating operation without ownership metadata" };
  }

  if (op.mechanism === "http") return { supported: true, reason: "ordinary HTTP contract" };
  if (op.imperative) {
    return hasBrowserDriver(op.name)
      ? { supported: true, reason: "reviewed browser driver" }
      : { supported: false, reason: "no reviewed browser driver in PR 5" };
  }
  if (!op.submitLabel) return { supported: false, reason: "no reviewed execution path" };
  if (!op.outcome) return { supported: false, reason: "no declared outcome contract in PR 5" };
  return { supported: true, reason: "reviewed form execution path and outcome contract" };
}

/** The mutating surface PR 5 can actually execute — used by the catalogue check. */
export function supportedMutations() {
  return Object.values(OPERATIONS)
    .filter((op) => op.mutating && operationSupport(op).supported)
    .map((op) => op.name);
}

export function unsupportedMutations() {
  return Object.values(OPERATIONS)
    .filter((op) => op.mutating && !operationSupport(op).supported)
    .map((op) => op.name);
}

// ---------------------------------------------------------------------------
// Evidence ledger — sanitized at construction, so nothing needs redacting
// ---------------------------------------------------------------------------

/** A driver diagnostic: fixed tokens only, short, no rendered product text. */
const FIXED_TOKEN_NOTE = /^[A-Za-z0-9 _.:=-]{1,80}$/;

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
        // A driver's own diagnostic token, and ONLY that. Drivers report why a
        // step could not proceed with fixed words they choose themselves
        // ("tenant-no-option", "file-no-control", "analyze-disabled"), never
        // with anything the product rendered. The pattern is the guarantee: a
        // note that could carry rendered text, a quote or a credential does not
        // match it and is dropped. Without this, a step that never ran is
        // indistinguishable in the transcript from one that ran and was refused
        // — which is exactly how eight upload checks stayed unexplained.
        note: FIXED_TOKEN_NOTE.test(record.note ?? "") ? record.note : null,
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
          `${r.redirectTo ? `=> ${r.redirectTo} ` : ""}${r.errorCategory} (${r.durationMs}ms)` +
          `${r.note ? ` [${r.note}]` : ""}`,
      ),
  };
}

// ---------------------------------------------------------------------------
// Redirect helper — path only, query stripped except a safe allow-list (§5.1)
// ---------------------------------------------------------------------------

const SAFE_QUERY_KEYS = new Set(["error"]);

/**
 * The complete set of request headers a suite may forge (PR 7, Suite B3).
 *
 * Every entry is a header an attacker can trivially set and which a naive
 * implementation might trust: a claimed role, a claimed tenant, a proxy hint,
 * or the internal marker behind the 2025 Next.js middleware-bypass advisory
 * this repository's own dependency work tracked (R13).
 *
 * `cookie`, `authorization` and `apikey` are deliberately ABSENT and must stay
 * absent: forging one of those means carrying a credential the actor was never
 * issued, which is impersonation rather than tampering (§3.6).
 */
export const FORGEABLE_HEADERS = new Set([
  "x-middleware-subrequest",
  "x-middleware-rewrite",
  "x-forwarded-host",
  "x-forwarded-proto",
  "x-forwarded-for",
  "x-role",
  "x-user-role",
  "x-user-id",
  "x-tenant-id",
  "x-nonce",
  "x-invoke-path",
  "origin",
  "referer",
]);

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

  /** Cooperative cancellation: once aborted, nothing new may start. */
  const cancelSignal = options.signal ?? null;
  function assertLive() {
    if (cancelSignal?.aborted) {
      const error = new Error("run cancelled: no further work may start");
      error.code = "RUN_CANCELLED";
      throw error;
    }
  }

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
    const path = fillPath(op.path ?? op.urlClass, params) + queryFor(op, params);
    // Built BEFORE the try, so a refusal to forge an undeclared or
    // credential-bearing header propagates as the caller error it is instead of
    // being swallowed and recorded as a transport failure.
    const headers = forgedHeadersFor(op, params);
    const probeBody = outerRouteBody(op, params);
    if (probeBody.contentType) headers["content-type"] = probeBody.contentType;
    const started = now();
    let response = null;
    let transportError = false;
    try {
      const cookie = a.jar.header();
      if (cookie) headers.cookie = cookie;
      // The operation keeps its own bounded deadline AND honours cancellation.
      const deadline = AbortSignal.timeout(HTTP_TIMEOUT_MS);
      response = await fetch(new URL(path, origin), {
        method: op.method ?? "GET",
        headers,
        ...(probeBody.sendBody ? { body: "" } : {}),
        redirect: "manual",
        signal: cancelSignal ? AbortSignal.any([deadline, cancelSignal]) : deadline,
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
      fromInternalPath: Boolean(op.fromInternalPath),
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
   * Navigates to an operation's own page and resolves the §4.2 question BEFORE
   * anything is located, filled, clicked or dispatched: was the caller denied,
   * or did the page genuinely render?
   *
   * The three denial shapes this application actually produces are all covered,
   * and none of them is inferred from a missing control:
   *   - a redirect to `/login`               -> denied_unauthenticated
   *   - a redirect to `/dashboard` from an internal `/admin` or `/studio`
   *     surface -> denied_wrong_role
   *   - HTTP 200 carrying the app's own "Acceso denegado" panel, which is how
   *     `/admin/upload` answers a `client` (AM4) -> denied_wrong_role
   *
   * Returns an observation when the caller was denied or the page failed to
   * render, and `null` when the page is genuinely usable.
   */
  async function navigateAndClassify(context, op, pagePath, reuse) {
    // `reuse` keeps a STAGED workflow on the page it is already standing on —
    // analyze, then preview, then confirm, exactly as one user session does.
    // It skips the navigation, never the classification: the denial checks
    // below still run against whatever is actually rendered.
    if (!reuse) await context.navigate(new URL(pagePath, origin).toString());
    const landed = await context.evaluate("location.pathname");
    if (reuse) {
      if (await context.evaluate(PAGE.deniedPanel)) return { status: 200, domSignal: "denied_role" };
      if (!(await context.evaluate(PAGE.landmark))) return { status: 200, domSignal: "none" };
      return null;
    }
    const requested = pagePath.split("?")[0];
    if (landed === "/login" && requested !== "/login") {
      return { status: 302, redirectTo: "/login" };
    }
    if (landed === "/dashboard" && requested !== "/dashboard") {
      return {
        status: 302,
        redirectTo: "/dashboard",
        fromInternalPath: requested.startsWith("/admin") || requested.startsWith("/studio"),
      };
    }
    if (await context.evaluate(PAGE.deniedPanel)) {
      // The product rendered its own denial page with HTTP 200. Reporting this
      // as `success` because the status is 2xx is exactly the false pass the
      // classifier exists to prevent.
      return { status: 200, domSignal: "denied_role" };
    }
    if (!(await context.evaluate(PAGE.landmark))) return { status: 200, domSignal: "none" };
    return null;
  }

  /**
   * Ends this actor's session in one already-loaded context, without touching
   * any other actor. This REMOVES authority; it can never add any, and it
   * copies no credential between actors (§3.6). It exists so a Server Action
   * can be reached with its own page already rendered — the only honest way to
   * prove that the ACTION rejects a caller, rather than proving only that the
   * page in front of it does.
   */
  async function endSessionInContext(a) {
    a.jar.clear();
    // Every context this actor owns, not just the one in front of us: leaving a
    // session alive in a sibling context would make the next real sign-in skip
    // the login form, and would make the denial below prove less than it says.
    for (const context of Object.values(a.contexts)) await context.clearCookies();
    a.sessionKind = "none";
    a.sessionLabel = newSessionLabel();
  }

  async function browserRun(a, op, params, mechanism, options = {}) {
    const { endSessionAfterLoad = false, reuseLoadedPage = false } = options;
    const javaScript = mechanism !== "form";
    const context = await contextFor(a.id, { javaScript });
    const started = now();
    const pagePath = fillPath(op.page ?? op.urlClass, params);

    const denied = await navigateAndClassify(context, op, pagePath, reuseLoadedPage);
    if (denied) return finish(a, op, mechanism, denied, now() - started);

    // The page rendered for this actor. Ending the session here is what turns a
    // page-gate proof into an ACTION-gate proof (§ Suite B).
    if (endSessionAfterLoad) await endSessionInContext(a);

    // Imperative Server Actions have no form; a reviewed, statically dispatched
    // driver drives the app's own controls (design §1.7). An operation without
    // one throws rather than being reported as any outcome. The driver receives
    // an already-navigated, already-classified page.
    if (op.imperative) {
      const driver = browserDriverFor(op.name);
      const observation = await driver({ context, PAGE, params });
      const record = finish(a, op, mechanism, observation, now() - started);
      // A driver may attach a short diagnostic token describing the control
      // state it found (`confirm-disabled-checkboxes=3`). It is composed of
      // fixed tokens and counts only — never rendered text, never product
      // data — and it stays off the sanitized ledger.
      if (observation.note) record.note = observation.note;
      // Whether the driver actually invoked the Server Action. A suite that
      // asserts "nothing was dispatched" must be able to read that from the
      // record rather than infer it from a timing.
      if (observation.dispatched !== undefined) record.dispatched = observation.dispatched;
      if (observation.controlEnabled !== undefined) record.controlEnabled = observation.controlEnabled;
      return record;
    }

    // Where several identical forms are rendered — one per tenant, user or
    // template — the form is located by the value of the field the Server
    // Action itself reads (`formData.get("template_id")`). That is the server
    // contract of §4.1 rule 3, and it is what keeps a destructive submission
    // from reaching the neighbouring object's form.
    const formIndex = op.identifyBy && params[op.identifyBy] !== undefined
      ? await context.evaluate(
          PAGE.formByFieldValue(op.identifyBy, String(params[op.identifyBy]), op.submitLabel),
        )
      : await context.evaluate(PAGE.formBySubmit(op.submitLabel));
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
    // Confirmation checkboxes and row selectors are ticked the way a user ticks
    // them, and only within the located form.
    if (op.checkAllInForm) await context.evaluate(PAGE.checkAllInForm(formIndex));
    for (const name of op.checkAllNamed ?? []) {
      await context.evaluate(PAGE.checkAllInFormNamed(formIndex, name));
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
      // The driver's own fixed-token diagnostic, bounded by the ledger.
      note: observation.note ?? null,
    });
  }

  /**
   * Query parameters, only for an operation the frozen catalogue declares as
   * accepting them. `params.query` is an array of `[key, value]` pairs so a
   * deliberately repeated key stays expressible — the duplicate-parameter case
   * is itself part of what a suite may want to probe. The recorded `urlClass`
   * is the unchanged template, so nothing here reaches the evidence ledger.
   */
  function queryFor(op, params = {}) {
    const pairs = params.query;
    if (pairs === undefined) return "";
    if (!op.acceptsQuery) {
      throw new Error(`operation "${op.name}" does not declare acceptsQuery — refusing to append a query`);
    }
    if (!Array.isArray(pairs)) throw new Error("params.query must be an array of [key, value] pairs");
    const search = new URLSearchParams();
    for (const [key, value] of pairs) search.append(String(key), String(value));
    const encoded = search.toString();
    return encoded ? `?${encoded}` : "";
  }

  /**
   * Caller-forged request headers, for the tampering cases Suite B3 must probe
   * (a forged role claim, a forged proxy hint, the `x-middleware-subrequest`
   * header of the 2025 Next.js middleware-bypass class).
   *
   * Three rules keep this from becoming a bypass rather than a probe:
   *   1. Only an operation the frozen catalogue marks `acceptsForgedHeaders`
   *      may receive any, so a caller cannot improvise one on an unreviewed
   *      surface.
   *   2. Only names on `FORGEABLE_HEADERS` are accepted. `cookie`,
   *      `authorization` and `apikey` are absent by construction: forging one
   *      of those would be carrying a credential the actor was not issued,
   *      which §3.6 forbids outright.
   *   3. Nothing here relaxes an authorization decision — the whole point is
   *      that the answer must not change.
   */
  function forgedHeadersFor(op, params = {}) {
    const forged = params.headers;
    if (forged === undefined) return {};
    if (!op.acceptsForgedHeaders) {
      throw new Error(
        `operation "${op.name}" does not declare acceptsForgedHeaders — refusing to forge a request header`,
      );
    }
    const out = {};
    for (const [name, value] of Object.entries(forged)) {
      const lower = String(name).toLowerCase();
      if (!FORGEABLE_HEADERS.has(lower)) {
        throw new Error(`refusing to forge the header "${lower}": it is not on the reviewed list`);
      }
      out[lower] = String(value);
    }
    return out;
  }

  /**
   * The body an outer action-route probe carries: ALWAYS empty, and a content
   * type only when the probe is meant to reach the authorization boundary.
   *
   * Nothing here may ever carry a mutation payload or an action identifier —
   * the body is the empty string, the content type is the declared one, and
   * there is no code path that makes either anything else.
   */
  function outerRouteBody(op, params = {}) {
    if (!op.outerRouteProbe) return { sendBody: false, contentType: null };
    if (params.body !== undefined) {
      throw new Error(`outer route probe "${op.name}" must never carry a body`);
    }
    return { sendBody: true, contentType: op.contentType };
  }

  function fillPath(template, params = {}) {
    return template.replace(/:([A-Za-z]+)/g, (match, key) => {
      if (params[key] === undefined) throw new Error(`missing path parameter ${key}`);
      return encodeURIComponent(params[key]);
    });
  }

  // --- the single execution entry point (§8.3) ------------------------------

  async function run(actorId, op, params = {}, options = {}) {
    // 1. Cancellation. A cancelled run must start no further work at all, so
    //    live work cannot overlap fixture cleanup.
    assertLive();

    // 2. Static capability, decided from the frozen catalogue BEFORE any side
    //    effect: no context, no navigation, no field filled, no request. A
    //    catalogued-but-unimplemented mutation must never reach a real form.
    const support = operationSupport(op);
    if (!support.supported) {
      const error = new Error(
        `operation "${op?.name ?? "(unknown)"}" is not supported in PR 5: ${support.reason}`,
      );
      error.code = "UNSUPPORTED_OPERATION";
      throw error;
    }

    // 3. Ownership and scope, still before any request leaves the process.
    const a = actor(actorId);
    fixtures.authorizeMutation(op, params);

    // 4. `endSessionAfterLoad` is only meaningful where a page is rendered
    //    first, so asking for it on an ordinary HTTP operation is a caller
    //    error rather than something to silently ignore.
    if (options.endSessionAfterLoad && op.mechanism === "http") {
      throw new Error(`endSessionAfterLoad is meaningless for the http operation "${op.name}"`);
    }

    assertLive();
    if (op.mechanism === "http") return httpRun(a, op, params);
    return browserRun(a, op, params, op.mechanism, options);
  }

  /**
   * The ONE place a suite may look inside an application response, and only for
   * an ordinary route handler the frozen catalogue marks `inspectable` — today
   * exactly `report.download`, whose body is a public product contract (a PDF,
   * or the documented JSON validation error) rather than framework transport.
   *
   * The body is read inside `response-inspect.mjs` and never leaves it: what
   * comes back here is categories, counts, booleans and lengths, which is why
   * the result is safe to print by construction. A Server-Action / RSC payload
   * can never reach it, because no such operation is `inspectable` and the
   * inspector only ever issues its own ordinary HTTP request (§2.3, G11).
   */
  async function inspect(actorId, op, params = {}, { expect = "text", needles = [] } = {}) {
    assertLive();
    if (!op?.inspectable) {
      const error = new Error(
        `operation "${op?.name ?? "(unknown)"}" is not declared inspectable — refusing to read its response`,
      );
      error.code = "NOT_INSPECTABLE";
      throw error;
    }
    if (op.mechanism !== "http") {
      throw new Error(`only an ordinary HTTP operation may be inspected, not "${op.name}"`);
    }
    const a = actor(actorId);
    const started = now();
    const path = fillPath(op.path ?? op.urlClass, params) + queryFor(op, params);
    const inspection = await inspectHttpResponse({
      url: new URL(path, origin).toString(),
      cookie: a.jar.header() || undefined,
      headers: forgedHeadersFor(op, params),
      expect,
      needles,
      signal: cancelSignal ?? undefined,
    });
    const record = finish(
      a,
      op,
      "http",
      {
        status: inspection.status,
        transportError: inspection.transportError,
        successSignal: inspection.shapeMatchesExpectation,
        fromInternalPath: Boolean(op.fromInternalPath),
      },
      now() - started,
    );
    return { record, inspection };
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
    // Sign-in is idempotent: any session this actor still holds — in ANY of its
    // contexts — is ended first. Without this a re-sign-in after an invalidated
    // or ended session would find a sibling context still authenticated, be
    // bounced from /login to /dashboard, and fail looking for a login form that
    // is correctly absent. No credential is copied; authority is only removed.
    a.jar.clear();
    for (const context of Object.values(a.contexts)) await context.clearCookies();
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

  /**
   * Terminates the browser this harness started. Pending CDP work rejects
   * rather than hanging, so a cancelled live phase settles quickly.
   */
  async function close() {
    if (browser) {
      const current = browser;
      browser = null;
      await current.close();
    }
  }

  return {
    origin,
    actor,
    actors,
    ledger,
    run,
    inspect,
    signIn,
    assertIdentity,
    assertSessionIsolation,
    session,
    assertDegrades,
    contextFor,
    fixtures,
    close,
    assertLive,
  };
}
