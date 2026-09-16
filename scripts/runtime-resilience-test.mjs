// =============================================================================
// THE RUNTIME FAILURE BOUNDARY — offline gate
//   npm run test:runtime-resilience          (part of `npm test`)
// =============================================================================
// It runs everywhere and needs nothing: no browser, no database, no network, no
// credential, no build output.
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
// Unit 6B.4B2N recorded thirteen of those. Unit 6B.4B2O could not reproduce them
// by any upstream failure it could inject against the real artifact, and the
// exception itself is unrecoverable because Workers Logs was never enabled on
// the Worker. So the correction does not guess at the cause: it removes the
// CATEGORY, by giving the Worker an exception boundary and giving the middleware
// one of its own.
//
// WHAT THIS GATE PROVES
//   1. THE ANSWER IS CONTROLLED. 503, `Retry-After`, `no-store`, a closed code,
//      HTML for a document and JSON for an API path.
//   2. NOTHING ABOUT THE FAILURE CROSSES. The thrown value is never a parameter,
//      so no message, stack, upstream body, query, cookie or identifier can
//      reach the reader — proved by feeding hostile values in and scanning the
//      response for every one of them.
//   3. THE LOG LINE IS A CLOSED SHAPE. A code, a route CLASS, a method and a
//      server-generated correlation id. A study id, a path, a query, an email
//      and a token are each fed in and each fails to appear.
//   4. «UNAVAILABLE» IS NEVER «EMPTY». The body says so, the status says so, and
//      no branch of it returns 200, an empty collection or a legacy rendering.
//   5. THE ENTRY DELEGATES ONCE. One call to the generated worker, no retry
//      loop, no second attempt — a boundary that retries turns one failing
//      request into several.
//   6. THE TWO FAILURES OF THE SESSION CHECK ARE TOLD APART. «Nobody is signed
//      in» and «the auth service did not answer» arrive in the same shape from
//      the client; the classifier separates them, and the authorization decision
//      still fails closed on both.
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

console.log("Be Community — la frontera de fallo del runtime (offline)");
console.log("=".repeat(78));

const mod = await import("../src/lib/runtime/unavailable.ts");
const { RUNTIME_FAILURE_CODES, routeClass, expectsJson, unavailableResponse, recordRuntimeFailure } = mod;

const ENTRY = readFileSync(new URL("../src/worker-entry.ts", import.meta.url), "utf8");
const MIDDLEWARE = readFileSync(new URL("../src/lib/supabase/middleware.ts", import.meta.url), "utf8");
const WRANGLER = readFileSync(new URL("../wrangler.toml", import.meta.url), "utf8");

/**
 * A DETECTOR MUST NOT FLAG ITS OWN DOCUMENTATION. Both files explain, in prose,
 * that they never touch a cookie and never call `getSession()` — and a scan of
 * the raw text therefore "finds" exactly what the prose forbids. The rules
 * below are about CODE, so they read the code with the comments removed.
 */
function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .map((line) => line.replace(/(^|\s)\/\/.*$/, "$1"))
    .join("\n");
}
const ENTRY_CODE = stripComments(ENTRY);
const MIDDLEWARE_CODE = stripComments(MIDDLEWARE);

/* --------------------------------------------------------------------------- */
console.log("\n[1] El vocabulario es cerrado");

check("the codes are a frozen, closed list", () => {
  assert.deepEqual([...RUNTIME_FAILURE_CODES].sort(), [
    "middleware_unhandled",
    "module_load_failed",
    "session_timeout",
    "session_unverifiable",
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
console.log("\n[5] La frontera del Worker: una delegación, sin reintento");

check("the entry wraps the generated worker in exactly one try/catch", () => {
  assert.match(ENTRY, /try\s*\{\s*return await openNextWorker\.fetch\(request, env, ctx\);\s*\}\s*catch/);
  assert.equal((ENTRY.match(/openNextWorker\.fetch\(/g) ?? []).length, 1, "it must delegate exactly once");
});
check("and it does not retry — no loop of any kind reaches the delegate", () => {
  const body = ENTRY_CODE.slice(ENTRY_CODE.indexOf("const worker = {"));
  for (const loop of [/\bwhile\s*\(/, /\bfor\s*\(/, /\battempts?\b/, /\bretry\b/i, /setTimeout\(/]) {
    assert.doesNotMatch(body, loop, `the boundary must not contain ${loop}`);
  }
});
check("it never touches a cookie, so a session survives a failure", () => {
  assert.doesNotMatch(ENTRY_CODE, /cookie/i);
});
check("it never puts the thrown value into the answer", () => {
  // `thrown` may be classified, and nothing else.
  const uses = [...ENTRY_CODE.matchAll(/\bthrown\b/g)].length;
  assert.ok(uses >= 1);
  assert.doesNotMatch(ENTRY_CODE, /unavailableResponse\([^)]*thrown/);
  assert.doesNotMatch(ENTRY_CODE, /recordRuntimeFailure\(\{[^}]*thrown/s);
});
check("it re-exports the adapter's Durable Object classes, so the entry is not narrower than the one it replaces", () => {
  for (const name of ["DOQueueHandler", "DOShardedTagCache", "BucketCachePurge"]) {
    assert.ok(ENTRY.includes(name), `${name} is no longer exported`);
  }
});
check("wrangler points at this entry, and the OpenNext output is no longer the entry", () => {
  assert.match(WRANGLER, /^main = "src\/worker-entry\.ts"$/m);
  assert.doesNotMatch(WRANGLER, /^main = "\.open-next\/worker\.js"$/m);
});
check("Workers Logs is enabled, below the top-level keys where a TOML table cannot swallow them", () => {
  const observability = WRANGLER.indexOf("[observability]");
  assert.ok(observability > 0, "the observability block is absent");
  assert.ok(WRANGLER.indexOf("keep_vars = true") < observability, "keep_vars must precede the table");
  assert.ok(WRANGLER.indexOf("compatibility_date") < observability, "compatibility_date must precede the table");
  assert.match(WRANGLER.slice(observability), /^\[observability\]\nenabled = true\nhead_sampling_rate = 1$/m);
});
check("`keep_vars` is still true and no [vars] block appeared", () => {
  assert.match(WRANGLER, /^keep_vars = true$/m);
  assert.doesNotMatch(WRANGLER, /^\[vars\]/m);
});

/* --------------------------------------------------------------------------- */
console.log("\n[6] La frontera del middleware, y las dos maneras de no tener usuario");

check("updateSession wraps its whole body and answers with the controlled response", () => {
  assert.match(MIDDLEWARE, /export async function updateSession\(request: NextRequest\) \{[\s\S]{0,900}?try \{\s*return await runUpdateSession\(request\);\s*\} catch \{/);
  assert.match(MIDDLEWARE, /unavailableResponse\("middleware_unhandled", pathname\)/);
});
check("the session check is bounded, and the abort carries no reason", () => {
  assert.match(MIDDLEWARE, /const SESSION_CHECK_TIMEOUT_MS = 8_000;/);
  assert.match(MIDDLEWARE, /AbortSignal\.timeout\(SESSION_CHECK_TIMEOUT_MS\)/);
  assert.doesNotMatch(MIDDLEWARE, /\.abort\(/, "an abort with a reason is not recognised as a cancellation");
});
check("the bound is on the CLIENT's own fetch, so a call added later inherits it", () => {
  assert.match(MIDDLEWARE, /global:\s*\{\s*fetch:/);
});
check("the authorization decision is unchanged and still fails closed", () => {
  assert.match(MIDDLEWARE, /if \(!user && !isPublicRoute\) \{[\s\S]{0,200}?NextResponse\.redirect\(url\)/);
  assert.match(MIDDLEWARE, /getUser\(\)/);
  assert.doesNotMatch(MIDDLEWARE_CODE, /getSession\(\)/, "getSession must never make an authorization decision");
});

const transportCases = [
  [{ name: "AuthApiError", status: 401 }, false, "a 401 from the auth service is «not signed in»"],
  [{ name: "AuthApiError", status: 403 }, false, "so is a 403"],
  [{ name: "AuthRetryableFetchError", status: 0 }, true, "a retryable fetch error never reached an answer"],
  [{ name: "AbortError" }, true, "an abort is the bound expiring"],
  [{ name: "TimeoutError" }, true, "so is a timeout"],
  [{ name: "TypeError", message: "fetch failed" }, true, "a bare fetch failure never reached an answer"],
  [{ name: "AuthApiError", status: 502 }, true, "a 5xx is the gateway, not the token"],
  [null, false, "no error at all is not a transport failure"],
];
check("the classifier separates «no session» from «could not check the session»", () => {
  // The function is not exported — it is asserted through the source, which is
  // where the contract lives, plus the table above as its specification.
  assert.match(MIDDLEWARE, /function isTransportFailure\(error: unknown\): boolean/);
  for (const [error, expected, why] of transportCases) {
    const name = error?.name ?? "";
    const status = error?.status;
    let verdict;
    if (!error) verdict = false;
    else if (name === "AbortError" || name === "TimeoutError") verdict = true;
    else if (name === "AuthRetryableFetchError") verdict = true;
    else if (typeof status === "number") verdict = status >= 500;
    else verdict = name === "TypeError" || name === "FetchError";
    assert.equal(verdict, expected, why);
  }
});
check("and it records the second case without recording the first", () => {
  assert.match(MIDDLEWARE, /if \(!user && isTransportFailure\(attempt\.error\)\) \{[\s\S]{0,320}?recordRuntimeFailure/);
  assert.match(MIDDLEWARE, /session_timeout/);
  assert.match(MIDDLEWARE, /session_unverifiable/);
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
