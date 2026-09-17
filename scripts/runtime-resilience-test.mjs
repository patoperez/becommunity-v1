// =============================================================================
// THE RUNTIME FAILURE BOUNDARY — offline gate
//   npm run test:runtime-resilience          (part of `npm test`)
// =============================================================================
// It runs everywhere and needs nothing: no browser, no database, no network, no
// credential, no build output. «Everywhere» is a claim this gate now proves
// about itself: section [0] runs its own source detectors over CRLF and LF
// copies of the same files and requires identical answers, because on a Windows
// checkout with `core.autocrlf=true` every file it reads has CRLF endings — and
// until Unit 6B.4B2P two of its checks failed there for that reason alone.
//
// WHY IT EXISTS
//
// Cloudflare answers **Error 1101 — "Worker threw a JavaScript exception"** when
// the Worker's `fetch` handler rejects. The entry the OpenNext adapter generates
// has no `try`/`catch` anywhere: it awaits the middleware handler, performs a
// request-time `import()` of the server handler, and awaits that. A rejection
// from any of the three reaches the edge, and the reader — on ANY route,
// including `/login`, which reads nothing — gets Cloudflare's error page.
//
// Unit 6B.4B2N recorded thirteen 1101s. Unit 6B.4B2O could not reproduce them by
// any upstream failure it could inject against the real artifact, and no
// per-invocation record exists because Workers Logs was never enabled on the
// Worker. So the correction does not guess at the cause: it removes the
// CATEGORY of rejections, by giving the Worker an exception boundary and giving
// the middleware one of its own.
//
// ⓘ CORRECTED IN UNIT 6B.4B2P: the recorded 1101s were `exceededResources`
// TERMINATIONS, not rejections. A termination never reaches a `catch`, so this
// gate proves the boundary and proves nothing about those bursts.
//
// WHAT THIS GATE PROVES — BY RUNNING THE CODE, NOT BY RESTATING IT
//   1. THE ANSWER IS CONTROLLED. 503, `Retry-After`, `no-store`, a closed code,
//      HTML for a document and JSON for an API path.
//   2. NOTHING ABOUT THE FAILURE CROSSES. The thrown value is never a parameter,
//      so no message, stack, upstream body, query, cookie or identifier can
//      reach the reader — proved by feeding hostile values in and scanning the
//      response for every one of them.
//   3. THE LOG LINE IS A CLOSED SHAPE. A code, a route CLASS, a method from a
//      closed list and a server-generated correlation id.
//   4. «UNAVAILABLE» IS NEVER «EMPTY».
//   5. THE BOUNDARY DELEGATES ONCE. `withRuntimeBoundary` is executed with
//      delegates that succeed, throw, throw a string and fail to load, and the
//      delegate's calls are COUNTED — a boundary that retries turns one failing
//      request into several.
//   6. THE MIDDLEWARE'S OWN BOUNDARY ANSWERS. The real `updateSession` is run
//      with its client unable to start, and must answer the controlled 503.
//   7. THE TWO FAILURES OF THE SESSION CHECK, AND OF SIGN-IN, ARE TOLD APART —
//      by the one shared classifier, run against the auth library's own error
//      classes. (This used to be a hand copy of the classifier tested against
//      itself; a copy stays green when the original changes.)
// =============================================================================

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

let passed = 0;
let failed = 0;
const check = (label, fn) => {
  try {
    fn();
    passed += 1;
    console.log("  ✓", label);
  } catch (thrown) {
    failed += 1;
    console.error("  ✗ FAIL:", label);
    console.error("      ", thrown instanceof Error ? thrown.message.split("\n")[0] : String(thrown));
  }
};
const checkAsync = async (label, fn) => {
  try {
    await fn();
    passed += 1;
    console.log("  ✓", label);
  } catch (thrown) {
    failed += 1;
    console.error("  ✗ FAIL:", label);
    console.error("      ", thrown instanceof Error ? thrown.message.split("\n")[0] : String(thrown));
  }
};

/** Capture `console.error` lines for the duration of `fn`. */
async function capturingErrors(fn) {
  const lines = [];
  const original = console.error;
  console.error = (...args) => lines.push(args.map(String).join(" "));
  try {
    const value = await fn();
    return { value, lines };
  } finally {
    console.error = original;
  }
}

console.log("Be Community — la frontera de fallo del runtime (offline)");
console.log("=".repeat(78));

/**
 * EVERY SOURCE FILE IS READ WITH ITS LINE ENDINGS NORMALISED. The rules below
 * are about code, and a carriage return is not code; a Windows checkout must
 * give the same verdict as a Linux one.
 */
const normalizeNewlines = (text) => text.replace(/\r\n?/g, "\n");
const readSource = (relative) => normalizeNewlines(readFileSync(new URL(`../${relative}`, import.meta.url), "utf8"));

/**
 * A DETECTOR MUST NOT FLAG ITS OWN DOCUMENTATION. The files explain, in prose,
 * that they never touch a cookie and never call `getSession()` — and a scan of
 * the raw text therefore "finds" exactly what the prose forbids. The rules
 * below are about CODE, so they read the code with the comments removed. Line
 * comments are recognised per line whatever the line ending.
 */
function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split(/\r?\n/)
    .map((line) => line.replace(/(^|\s)\/\/.*$/, "$1"))
    .join("\n");
}

const mod = await import("../src/lib/runtime/unavailable.ts");
const { RUNTIME_FAILURE_CODES, routeClass, expectsJson, unavailableResponse, recordRuntimeFailure, normalizeMethod } = mod;
const { withRuntimeBoundary, isModuleLoadFailure } = await import("../src/lib/runtime/boundary.ts");

const ENTRY = readSource("src/worker-entry.ts");
const BOUNDARY = readSource("src/lib/runtime/boundary.ts");
const MIDDLEWARE = readSource("src/lib/supabase/middleware.ts");
const WRANGLER = readSource("wrangler.toml");
const LOGIN_ACTION = readSource("src/app/login/actions.ts");
const ENTRY_CODE = stripComments(ENTRY);
const BOUNDARY_CODE = stripComments(BOUNDARY);
const MIDDLEWARE_CODE = stripComments(MIDDLEWARE);
const LOGIN_ACTION_CODE = stripComments(LOGIN_ACTION);

/* --------------------------------------------------------------------------- */
console.log("\n[0] El veredicto no depende del final de línea");

check("the source detectors give the same answer on a CRLF copy and an LF copy", () => {
  for (const [name, raw] of [["worker-entry", ENTRY], ["middleware", MIDDLEWARE], ["login action", LOGIN_ACTION], ["wrangler", WRANGLER]]) {
    const crlf = raw.replace(/\n/g, "\r\n");
    assert.equal(normalizeNewlines(crlf), raw, `${name}: normalising CRLF must restore the LF text`);
    assert.equal(stripComments(crlf).replace(/\r/g, ""), stripComments(raw), `${name}: comment stripping must not depend on line endings`);
    const commentLines = stripComments(crlf).split("\n").filter((line) => line.trim().startsWith("//"));
    assert.equal(commentLines.length, 0, `${name}: a CRLF line comment survived`);
  }
});
check("a line comment is removed from a CRLF file — the exact defect that failed this gate on Windows", () => {
  const crlf = "const a = 1;\r\n// getSession() for an authorization decision\r\nconst b = 2;\r\n";
  assert.doesNotMatch(stripComments(crlf), /getSession\(\)/);
  assert.match(stripComments(crlf), /const b = 2;/);
});

/* --------------------------------------------------------------------------- */
console.log("\n[1] El vocabulario es cerrado");

check("the codes are a frozen, closed list", () => {
  assert.deepEqual([...RUNTIME_FAILURE_CODES].sort(), [
    "authorization_timeout",
    "authorization_unverifiable",
    "middleware_unhandled",
    "module_load_failed",
    "session_timeout",
    "session_unverifiable",
    "sign_in_timeout",
    "sign_in_unverifiable",
    "worker_unhandled",
  ]);
});
check("the route classes cover the product's surfaces and never carry an identifier", () => {
  assert.equal(routeClass("/api/health"), "health");
  assert.equal(routeClass("/login"), "auth");
  assert.equal(routeClass("/studio/e/cd4d6acd-88b9-4804-829f-75b6d91a32b7/revision"), "studio");
  assert.equal(routeClass("/insights/e/cd4d6acd-88b9-4804-829f-75b6d91a32b7"), "insights");
  assert.equal(routeClass("/admin/upload"), "admin");
  assert.equal(routeClass("/api/studies/x/report"), "api");
  assert.equal(routeClass("/"), "other");
});
check("an API path is answered as JSON and a document path as a document", () => {
  assert.equal(expectsJson("/api/health"), true);
  assert.equal(expectsJson("/api/studies/x/report"), true);
  assert.equal(expectsJson("/login"), false);
  assert.equal(expectsJson("/studio"), false);
});

/* --------------------------------------------------------------------------- */
console.log("\n[2] La respuesta es controlada, en todos los códigos y en ambas formas");

for (const code of RUNTIME_FAILURE_CODES) {
  await checkAsync(`«${code}» answers 503 with a retry hint, uncacheable, on a document path`, async () => {
    const res = unavailableResponse(code, "/studio/e/abc/revision");
    assert.equal(res.status, 503);
    assert.equal(res.headers.get("retry-after"), "15");
    assert.equal(res.headers.get("cache-control"), "no-store");
    assert.equal(res.headers.get("x-becommunity-unavailable"), code);
    assert.match(res.headers.get("content-type") ?? "", /text\/html/);
    const body = await res.text();
    assert.match(body, /No podemos mostrarte esto ahora mismo/);
    assert.match(body, new RegExp(code));
    assert.match(body, /<meta name="robots" content="noindex">/);
  });
}

await checkAsync("an API path answers the same failure as JSON", async () => {
  const res = unavailableResponse("worker_unhandled", "/api/health");
  assert.equal(res.status, 503);
  assert.match(res.headers.get("content-type") ?? "", /application\/json/);
  const body = JSON.parse(await res.text());
  assert.deepEqual(body, { status: "unavailable", code: "worker_unhandled", retryAfterSeconds: 15 });
});

await checkAsync("the page needs nothing else to render — no script, stylesheet, font or image", async () => {
  const body = await unavailableResponse("worker_unhandled", "/login").text();
  for (const forbidden of [/<script/i, /<link[^>]+rel=["']?stylesheet/i, /<img/i, /@font-face/i, /https?:\/\//]) {
    assert.doesNotMatch(body, forbidden, `the failure page must not depend on ${forbidden}`);
  }
});

await checkAsync("it never answers 200, and never with an empty collection", async () => {
  for (const code of RUNTIME_FAILURE_CODES) {
    for (const path of ["/login", "/api/health", "/studio", "/insights/e/x"]) {
      const res = unavailableResponse(code, path);
      assert.equal(res.status, 503, `${code} ${path}`);
      const body = await res.text();
      assert.notEqual(body.trim(), "[]");
      assert.notEqual(body.trim(), "{}");
      assert.doesNotMatch(body, /"data"\s*:\s*\[\s*\]/);
    }
  }
});

/* --------------------------------------------------------------------------- */
console.log("\n[3] Nada del fallo cruza");

const HOSTILE = {
  message: "PGRST301 JWT expired for user carla@becommunitymx.com at select * from pain_point",
  stack: "Error: boom\n    at loadCanonicalRowSet (/src/lib/canonical-source/read.ts:412:9)",
  token: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.aaaaaaaaaaaaaaaaaaaa.bbbbbbbbbbbb",
  cookie: "sb-ontvqazsqiwisdddblif-auth-token=aaaaaaaaaaaa",
  study: "cd4d6acd-88b9-4804-829f-75b6d91a32b7",
  query: "?email=carla%40becommunitymx.com&token=secret123",
};

await checkAsync("the builder takes a CODE, never an error — there is no parameter to leak through", async () => {
  // The signature itself is the proof: two strings, and the second is only ever
  // used to choose a shape and a class.
  assert.equal(unavailableResponse.length, 2);
  const body = await unavailableResponse("worker_unhandled", `/studio/e/${HOSTILE.study}/revision${HOSTILE.query}`).text();
  for (const [name, value] of Object.entries(HOSTILE)) {
    assert.ok(!body.includes(value), `«${name}» reached the reader`);
  }
  assert.ok(!body.includes("revision"), "the path itself reached the reader");
});

await checkAsync("nor through the headers", async () => {
  const res = unavailableResponse("session_timeout", `/studio/e/${HOSTILE.study}/revision${HOSTILE.query}`);
  const all = [...res.headers.entries()].map(([k, v]) => `${k}: ${v}`).join("\n");
  for (const value of Object.values(HOSTILE)) assert.ok(!all.includes(value));
  assert.equal(res.headers.get("set-cookie"), null, "a failure page must not set a cookie");
});

/* --------------------------------------------------------------------------- */
console.log("\n[4] La línea de registro es una forma cerrada");

check("it carries a code, a route CLASS, a method and a server-generated id — and nothing else", () => {
  const lines = [];
  const original = console.error;
  console.error = (line) => lines.push(line);
  let id;
  try {
    id = recordRuntimeFailure({
      code: "worker_unhandled",
      pathname: `/studio/e/${HOSTILE.study}/revision${HOSTILE.query}`,
      method: "GET",
      elapsedMs: 1234.7,
    });
  } finally {
    console.error = original;
  }
  assert.equal(lines.length, 1, "exactly one line");
  const record = JSON.parse(lines[0]);
  assert.deepEqual(Object.keys(record).sort(), ["code", "correlationId", "elapsedMs", "event", "method", "routeClass"]);
  assert.equal(record.event, "runtime_failure");
  assert.equal(record.routeClass, "studio");
  assert.equal(record.elapsedMs, 1235);
  assert.match(record.correlationId, /^[0-9a-f-]{36}$/);
  assert.equal(record.correlationId, id, "the id is returned to the caller so it can be correlated");
  for (const value of Object.values(HOSTILE)) assert.ok(!lines[0].includes(value), "a hostile value reached the log");
  assert.ok(!lines[0].includes("/studio/e/"), "the path reached the log");
});

check("the method is closed: a known method is recorded, anything else is OTHER", () => {
  for (const method of ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"]) assert.equal(normalizeMethod(method), method);
  assert.equal(normalizeMethod("get"), "GET", "case is not an identity");
  for (const hostile of ["PROPFIND", "", "GET\n{\"email\":\"carla@becommunitymx.com\"}", HOSTILE.token, "X".repeat(4096)]) {
    assert.equal(normalizeMethod(hostile), "OTHER", `«${hostile.slice(0, 24)}» must be recorded as OTHER`);
  }
});

check("and the line records the closed method, never the one the client sent", () => {
  const lines = [];
  const original = console.error;
  console.error = (line) => lines.push(line);
  try {
    recordRuntimeFailure({ code: "worker_unhandled", pathname: "/login", method: `BREW ${HOSTILE.message}` });
  } finally {
    console.error = original;
  }
  const record = JSON.parse(lines[0]);
  assert.equal(record.method, "OTHER");
  assert.ok(!lines[0].includes("carla@"), "a hostile method reached the log");
});

check("two failures never share a correlation id", () => {
  const original = console.error;
  console.error = () => {};
  try {
    const a = recordRuntimeFailure({ code: "worker_unhandled", pathname: "/login", method: "GET" });
    const b = recordRuntimeFailure({ code: "worker_unhandled", pathname: "/login", method: "GET" });
    assert.notEqual(a, b);
  } finally {
    console.error = original;
  }
});

check("a logger that throws does not become the failure it was reporting", () => {
  const original = console.error;
  console.error = () => { throw new Error("the log sink is down too"); };
  try {
    const id = recordRuntimeFailure({ code: "worker_unhandled", pathname: "/login", method: "GET" });
    assert.match(id, /^[0-9a-f-]{36}$/);
  } finally {
    console.error = original;
  }
});

/* --------------------------------------------------------------------------- */
console.log("\n[5] La frontera del Worker, EJECUTADA: una delegación, sin reintento");

const hostileError = Object.assign(new Error(HOSTILE.message), { stack: HOSTILE.stack });
const request = (path, headers = {}) => new Request(`https://becommunity.test${path}`, { headers });

await checkAsync("a delegate that succeeds is returned untouched, called once, and logs nothing", async () => {
  let calls = 0;
  const answer = new Response("ok", { status: 200, headers: { "x-from": "delegate" } });
  const handler = withRuntimeBoundary(async () => { calls += 1; return answer; });
  const { value, lines } = await capturingErrors(() => handler(request("/studio"), {}, {}));
  assert.equal(value, answer, "the boundary must not replace a successful response");
  assert.equal(calls, 1);
  assert.equal(lines.length, 0);
});

await checkAsync("a delegate that throws is answered 503 worker_unhandled — ONCE, with one line and no hostile value", async () => {
  let calls = 0;
  const handler = withRuntimeBoundary(async () => { calls += 1; throw hostileError; });
  const { value: res, lines } = await capturingErrors(() =>
    handler(request(`/studio/e/${HOSTILE.study}/revision${HOSTILE.query}`, { cookie: HOSTILE.cookie }), {}, {}),
  );
  assert.equal(calls, 1, "the boundary must not retry");
  assert.equal(res.status, 503);
  assert.equal(res.headers.get("x-becommunity-unavailable"), "worker_unhandled");
  assert.equal(res.headers.get("set-cookie"), null, "the boundary must not touch the session");
  const body = await res.text();
  assert.equal(lines.length, 1, "exactly one structured line");
  const record = JSON.parse(lines[0]);
  assert.equal(record.code, "worker_unhandled");
  assert.equal(record.routeClass, "studio");
  for (const value of Object.values(HOSTILE)) {
    assert.ok(!body.includes(value), "a hostile value reached the reader");
    assert.ok(!lines[0].includes(value), "a hostile value reached the log");
  }
});

await checkAsync("a thrown STRING is still a controlled answer, delegated once", async () => {
  let calls = 0;
  const handler = withRuntimeBoundary(async () => { calls += 1; throw HOSTILE.token; });
  const { value: res } = await capturingErrors(() => handler(request("/login"), {}, {}));
  assert.equal(calls, 1, "the boundary must not retry");
  assert.equal(res.status, 503);
  assert.equal(res.headers.get("x-becommunity-unavailable"), "worker_unhandled");
  assert.ok(!(await res.text()).includes(HOSTILE.token));
});

await checkAsync("a request-time module that fails to load is named module_load_failed, as JSON on an API path, and is NOT retried", async () => {
  let calls = 0;
  const handler = withRuntimeBoundary(async () => { calls += 1; throw new Error("Failed to fetch dynamically imported module: server-functions/default/handler.mjs"); });
  const { value: res, lines } = await capturingErrors(() => handler(request("/api/health"), {}, {}));
  assert.equal(calls, 1, "a module that failed to load must not be loaded again inside the boundary");
  assert.equal(res.headers.get("x-becommunity-unavailable"), "module_load_failed");
  assert.deepEqual(JSON.parse(await res.text()), { status: "unavailable", code: "module_load_failed", retryAfterSeconds: 15 });
  assert.equal(JSON.parse(lines[0]).routeClass, "health");
  assert.equal(isModuleLoadFailure(new Error("Cannot find module './x'")), true);
  assert.equal(isModuleLoadFailure(new Error(HOSTILE.message)), false);
});

check("the entry connects the build output THROUGH this boundary, delegating exactly once, and exports THAT", () => {
  assert.match(ENTRY_CODE, /import \{ withRuntimeBoundary \} from "\.\/lib\/runtime\/boundary";/);
  assert.match(ENTRY_CODE, /^const worker = \{\n\s*fetch: withRuntimeBoundary<[^>]*>\(\(request, env, ctx\) => openNextWorker\.fetch\(request, env, ctx\)\),\n\};$/m);
  assert.equal((ENTRY_CODE.match(/openNextWorker\.fetch\(/g) ?? []).length, 1, "it must delegate exactly once");
  assert.equal((ENTRY_CODE.match(/\bopenNextWorker\b/g) ?? []).length, 2, "the generated worker is imported and called once — never exported or aliased");
  assert.match(ENTRY_CODE, /^export default worker;$/m, "the wrapped worker must be the default export");
  assert.equal((ENTRY_CODE.match(/\bexport\s+default\b/g) ?? []).length, 1, "exactly one default export");
  assert.doesNotMatch(ENTRY_CODE, /\btry\s*\{/, "the entry must not grow a second, unexecuted boundary");
  assert.equal((BOUNDARY_CODE.match(/\bdelegate\(/g) ?? []).length, 1, "the boundary calls its delegate at exactly one site");
});
check("neither file contains a loop, a retry or a timer that could reach the delegate", () => {
  for (const [name, code] of [["entry", ENTRY_CODE], ["boundary", BOUNDARY_CODE]]) {
    for (const loop of [/\bwhile\s*\(/, /\bfor\s*\(/, /\battempts?\b/, /\bretry\b/i, /setTimeout\(/]) {
      assert.doesNotMatch(code, loop, `${name} must not contain ${loop}`);
    }
    assert.doesNotMatch(code, /cookie/i, `${name} must not touch a cookie`);
  }
});
check("it re-exports the adapter's Durable Object classes, so the entry is not narrower than the one it replaces", () => {
  assert.match(
    ENTRY_CODE,
    /export \{ DOQueueHandler, DOShardedTagCache, BucketCachePurge \} from "\.\.\/\.open-next\/worker\.js";/,
  );
});
check("wrangler points at this entry, and the OpenNext output is no longer the entry", () => {
  assert.match(WRANGLER, /^main = "src\/worker-entry\.ts"$/m);
  assert.doesNotMatch(WRANGLER, /^main = "\.open-next\/worker\.js"$/m);
});
check("Workers Logs keeps the structured lines, drops Cloudflare's URL log, and sits below the top-level keys", () => {
  const observability = WRANGLER.indexOf("[observability]");
  assert.ok(observability > 0, "the observability block is absent");
  assert.ok(WRANGLER.indexOf("keep_vars = true") < observability, "keep_vars must precede the table");
  assert.ok(WRANGLER.indexOf("compatibility_date") < observability, "compatibility_date must precede the table");
  assert.match(
    WRANGLER.slice(observability),
    /^\[observability\]\nenabled = true\nhead_sampling_rate = 1\n\n\[observability\.logs\]\ninvocation_logs = false$/m,
    "invocation logs record every request's full URL; they must stay off",
  );
  assert.equal((WRANGLER.match(/^invocation_logs\s*=/gm) ?? []).length, 1, "exactly one invocation_logs setting");
});
check("`keep_vars` is still true and no [vars] block appeared", () => {
  assert.match(WRANGLER, /^keep_vars = true$/m);
  assert.doesNotMatch(WRANGLER, /^\[vars\]/m);
});

/* --------------------------------------------------------------------------- */
console.log("\n[6] La frontera del middleware, EJECUTADA, y la política compartida");

const savedUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const savedKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
await checkAsync("the real updateSession, with a client that cannot start, answers 503 middleware_unhandled and one line", async () => {
  const { NextRequest } = await import("next/server");
  const { updateSession } = await import("../src/lib/supabase/middleware.ts");
  delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  try {
    const { value: res, lines } = await capturingErrors(() =>
      updateSession(new NextRequest(`https://becommunity.test/studio/e/${HOSTILE.study}/revision${HOSTILE.query}`)),
    );
    assert.equal(res.status, 503);
    assert.equal(res.headers.get("x-becommunity-unavailable"), "middleware_unhandled");
    const records = lines.filter((line) => line.startsWith("{")).map((line) => JSON.parse(line));
    assert.equal(records.length, 1, "exactly one structured line");
    assert.equal(records[0].code, "middleware_unhandled");
    assert.equal(records[0].routeClass, "studio");
    for (const value of Object.values(HOSTILE)) assert.ok(!lines.join("\n").includes(value));
  } finally {
    if (savedUrl === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL; else process.env.NEXT_PUBLIC_SUPABASE_URL = savedUrl;
    if (savedKey === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY; else process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = savedKey;
  }
});
check("updateSession's boundary encloses the WHOLE session check, not only the client's construction", () => {
  assert.match(MIDDLEWARE_CODE, /export async function updateSession\(request: NextRequest\) \{\s*try \{\s*return await runUpdateSession\(request\);\s*\} catch \{/);
  assert.equal((MIDDLEWARE_CODE.match(/runUpdateSession\(/g) ?? []).length, 2, "declared once and called only from inside the boundary");
});
check("the session check's deadline and its two logged outcomes are pinned", () => {
  assert.match(MIDDLEWARE_CODE, /const SESSION_CHECK_DEADLINE_MS = 9_000;/);
  assert.match(
    MIDDLEWARE_CODE,
    /if \(session === "timeout" \|\| session === "cancelled" \|\| session === "upstream_failure"\) \{\s*recordRuntimeFailure\(\{\s*code: session === "upstream_failure" \? "session_unverifiable" : "session_timeout",/,
  );
});
check("the middleware adopts the SHARED bound and the SHARED classifier, and keeps no copy of either", () => {
  assert.match(MIDDLEWARE_CODE, /global: \{ fetch: boundedFetch\(\) \}/);
  assert.match(MIDDLEWARE_CODE, /withinDeadline\(supabase\.auth\.getUser\(\), SESSION_CHECK_DEADLINE_MS\)/);
  assert.match(MIDDLEWARE_CODE, /classifySession\(/);
  assert.doesNotMatch(MIDDLEWARE_CODE, /AbortSignal\.timeout\(/, "a TimeoutError abort is retried by postgrest-js");
  assert.doesNotMatch(MIDDLEWARE_CODE, /function isTransportFailure/, "a private classifier drifts from the shared one");
});
check("the authorization decision is unchanged and still fails closed", () => {
  assert.match(MIDDLEWARE_CODE, /if \(!user && !isPublicRoute\) \{[\s\S]{0,200}?NextResponse\.redirect\(url\)/);
  assert.match(MIDDLEWARE_CODE, /getUser\(\)/);
  assert.doesNotMatch(MIDDLEWARE_CODE, /getSession\(\)/, "getSession must never make an authorization decision");
  // A user only exists when the shared classifier said «authenticated».
  assert.match(MIDDLEWARE_CODE, /const user = session === "authenticated" && attempt\.settled \? attempt\.value\.data\.user : null;/);
});

/* --------------------------------------------------------------------------- */
console.log("\n[7] «Tu contraseña está mal» y «no pudimos preguntar» — el clasificador REAL, con los errores REALES");

const authJs = await import("@supabase/auth-js");
const { classifySession, classifySignIn } = await import("../src/lib/upstream/outcome.ts");
const { UPSTREAM_TIMEOUT_MESSAGE, UPSTREAM_CANCELLED_MESSAGE } = await import("../src/lib/upstream/bounded-fetch.ts");
const loginErrors = await import("../src/app/login/errors.ts");

// Each error is an instance of the class the installed auth library throws, in
// the shape its own fetch layer builds it (`lib/fetch.js`: every fetch rejection
// becomes AuthRetryableFetchError with the rejection's MESSAGE and status 0).
// A 4xx is a VERDICT only when the auth service NAMED it — GoTrue always sends a
// code (measured against the hosted project in 6B.4B2P); the gateway in front of
// it does not. \`null\` marks a case that cannot occur on that path.
const AUTH_CASES = [
  // [error, session outcome, sign-in outcome, why]
  [new authJs.AuthApiError("invalid JWT", 403, "bad_jwt"), "unauthenticated", "invalid_credentials", "a named 403 is the service saying no"],
  [new authJs.AuthApiError("Invalid login credentials", 400, "invalid_credentials"), "unauthenticated", "invalid_credentials", "so is a named 400"],
  [new authJs.AuthApiError("User banned", 403, "user_banned"), "unauthenticated", "invalid_credentials", "and a named 403"],
  [new authJs.AuthApiError("Invalid API key", 401, undefined), "upstream_failure", "upstream_failure", "a CODE-LESS 401 is the gateway refusing the key — an outage, not a verdict"],
  [new authJs.AuthApiError("Not Found", 404, undefined), "upstream_failure", "upstream_failure", "and so is any other unnamed 4xx"],
  [new authJs.AuthSessionMissingError(), "unauthenticated", null, "no session is not an outage"],
  [new authJs.AuthInvalidCredentialsError("Email or phone and password are required"), null, "invalid_credentials", "the library's own refusal of the credentials"],
  [new authJs.AuthApiError("Too many requests", 429, "over_request_rate_limit"), "upstream_failure", "upstream_failure", "a throttle says nothing about the password"],
  [new authJs.AuthRetryableFetchError("fetch failed", 0), "upstream_failure", "upstream_failure", "a refused connection never reached an answer"],
  [new authJs.AuthRetryableFetchError("service unavailable", 503), "upstream_failure", "upstream_failure", "a 5xx is the gateway, not the token"],
  [new authJs.AuthUnknownError("Unexpected token < in JSON", new SyntaxError("x")), "upstream_failure", "upstream_failure", "an unreadable error page is not a verdict"],
  [new authJs.AuthInvalidTokenResponseError(), "upstream_failure", "upstream_failure", "a success with no session is not a verdict"],
  [new authJs.AuthRetryableFetchError(UPSTREAM_TIMEOUT_MESSAGE, 0), "timeout", "timeout", "the bound expired, and says so through the wrapper"],
  [new authJs.AuthRetryableFetchError(UPSTREAM_CANCELLED_MESSAGE, 0), "cancelled", "cancelled", "the caller gave up"],
];

check("the shared classifier tells every real auth error apart, for the session and for sign-in", () => {
  for (const [error, session, signIn, why] of AUTH_CASES) {
    if (session !== null) assert.equal(classifySession({ data: { user: null }, error }), session, `session: ${why}`);
    if (signIn !== null) assert.equal(classifySignIn(error), signIn, `sign-in: ${why}`);
  }
  assert.equal(classifySession({ data: { user: { id: "u" } }, error: null }), "authenticated");
  assert.equal(classifySession({ data: { user: null }, error: null }), "unauthenticated");
  assert.equal(classifySession(null), "timeout", "a session check that never finished is a timeout");
  assert.equal(classifySignIn(null), "signed_in");
});
check("only a statement about the credentials becomes invalid_credentials; every outage says «not your password»", () => {
  for (const [error, , signIn, why] of AUTH_CASES) {
    if (signIn === null) continue;
    const code = loginErrors.signInErrorCode(classifySignIn(error));
    assert.equal(code, signIn === "invalid_credentials" ? "invalid_credentials" : "service_unavailable", why);
    assert.ok(loginErrors.authErrorMessage(code), "the code must be on the allowlist");
  }
});
check("a hostile error text changes nothing but the classification it is allowed to change", () => {
  // An error whose TEXT imitates a verdict, a timeout sentinel lookalike and an
  // email: only name, status and code may decide, and the answer is a closed code.
  for (const error of [
    new authJs.AuthRetryableFetchError(`Invalid login credentials ${HOSTILE.message} ${HOSTILE.token}`, 0),
    new authJs.AuthApiError(`${HOSTILE.message}`, 401, undefined),
  ]) {
    const code = loginErrors.signInErrorCode(classifySignIn(error));
    assert.equal(code, "service_unavailable", "an unnamed refusal or a transport failure must never read as a verdict, whatever its text says");
  }
});
check("the logging decision for a failed sign-in is closed: an incident is named, a wrong password is not", () => {
  const expected = {
    signed_in: null,
    invalid_credentials: null,
    timeout: "sign_in_timeout",
    cancelled: "sign_in_unverifiable",
    upstream_failure: "sign_in_unverifiable",
  };
  for (const [outcome, code] of Object.entries(expected)) {
    assert.equal(loginErrors.signInFailureLogCode(outcome), code, outcome);
    if (code) assert.ok(RUNTIME_FAILURE_CODES.includes(code), `${code} must be in the closed vocabulary`);
  }
});
check("the sign-in vocabulary has a code for «the service did not answer», and its sentence does not blame the password", () => {
  const message = loginErrors.AUTH_ERROR_MESSAGES.service_unavailable;
  assert.equal(loginErrors.authErrorMessage("service_unavailable"), message);
  assert.match(message, /No es tu contraseña/);
  assert.doesNotMatch(message, /inválid/i);
  assert.match(message, /vuelve a intentarlo/i);
});
check("the allowlist is still an allowlist — an unknown code renders nothing", () => {
  assert.equal(loginErrors.authErrorMessage("<script>alert(1)</script>"), null);
  assert.equal(loginErrors.authErrorMessage(undefined), null);
  assert.equal(loginErrors.authErrorMessage("service_unavailable "), null);
});
check("the action uses the shared classifier and the pure code choice, and neither branch carries the error's own text", () => {
  assert.match(LOGIN_ACTION_CODE, /const outcome = classifySignIn\(error\);/);
  assert.match(LOGIN_ACTION_CODE, /redirect\(`\/login\?error=\$\{signInErrorCode\(outcome\)\}`\);/);
  assert.match(LOGIN_ACTION_CODE, /const logCode = signInFailureLogCode\(outcome\);\s*if \(logCode\) recordRuntimeFailure\(\{ code: logCode, pathname: "\/login", method: "POST" \}\);/);
  assert.doesNotMatch(LOGIN_ACTION_CODE, /function isAuthTransportFailure/, "a private classifier drifts from the shared one");
  assert.doesNotMatch(LOGIN_ACTION_CODE, /error\.message/);
  assert.doesNotMatch(LOGIN_ACTION_CODE, /\$\{error/);
});
check("the middleware and the action import the SAME classifier module — drift is impossible by construction", () => {
  assert.match(MIDDLEWARE_CODE, /import \{ classifySession \} from "@\/lib\/upstream\/outcome";/);
  assert.match(LOGIN_ACTION_CODE, /import \{ classifySignIn \} from "@\/lib\/upstream\/outcome";/);
});

console.log("\n" + "=".repeat(78));
console.log(`RESUMEN: ${passed + failed} comprobaciones, ${passed} aprobadas, ${failed} falladas.`);
if (failed > 0) {
  console.error("RESULTADO: la frontera de fallo NO cumple su contrato. COMPUERTA BLOQUEADA.");
  process.exit(1);
}
console.log(
  "RESULTADO: un fallo del Worker o del middleware se responde con 503 controlado y un código " +
    "cerrado, no filtra nada de la excepción ni de la ruta, registra una línea de forma fija, no " +
    "reintenta, no toca la sesión y nunca convierte «no disponible» en «vacío».",
);
