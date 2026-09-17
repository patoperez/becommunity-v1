// =============================================================================
// THE BOUND ON EVERY USER-FACING SUPABASE CALL — offline behavioural gate
//   npm run test:upstream-bounds          (part of `npm test`)
// =============================================================================
// It needs no browser, no database, no credential and no build output. It
// starts ONE local HTTP stand-in on 127.0.0.1 and drives the REAL installed
// Supabase clients (`@supabase/supabase-js`, `auth-js`, `postgrest-js`) through
// the REAL policy (`src/lib/upstream/*`) against it, counting what reaches the
// stand-in. Nothing here re-implements a classifier or a bound: every verdict is
// the output of the code the product runs.
//
// WHY IT EXISTS
//
// Unit 6B.4B2O's fault injection recorded `hang /rest/v1 → 000000`: a review
// page whose data read never answered, and a probe that got no response at all.
// Only the middleware's session check had a bound, and that bound was built on
// `AbortSignal.timeout()`, whose `TimeoutError` postgrest-js does not recognise
// as an abort — so any PostgREST GET behind it would have been retried three
// times. Unit 6B.4B2P replaced the one-off with one policy. This gate proves:
//
//   1. A HUNG READ ENDS, ONCE. One attempt reaches the stand-in, the result is
//      a timeout, and it arrives near the bound — while the naive
//      `AbortSignal.timeout` wrapper, run as a CONTROL, is retried.
//   2. A BODY THAT STALLS AFTER ITS HEADERS IS JUST AS HUNG, and ends the same.
//   3. A CALLER'S OWN SIGNAL IS HONOURED: pre-aborted makes no request; aborted
//      in flight is a cancellation, never a timeout.
//   4. A RUNAWAY `Retry-After` IS NOT OBEYED.
//   5. THE FACTS STAY APART: empty is empty only when the database answered
//      nothing; a refusal, a 404 with no body, a 500 and a dead connection are
//      each something else — for reads, for the session check and for sign-in.
//   6. STUDIO'S DOOR DECIDES FROM WHAT WAS LEARNED, and every non-internal
//      branch refuses.
//   7. THE REAL MIDDLEWARE redirects a failed session check to /login AND names
//      the outage — and names nothing when the answer was an ordinary «no».
// =============================================================================

import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFileSync } from "node:fs";

let passed = 0;
let failed = 0;
/**
 * The gate's own voice. `quietly` captures `console.error` while a check runs;
 * if the watchdog fires INSIDE such a window, the capture is never undone, and a
 * FAIL line written through `console.error` would vanish into it. The verdict
 * is therefore written through a handle taken before anything is captured.
 */
const report = console.error.bind(console);
/**
 * EVERY CHECK HAS ITS OWN DEADLINE. The stand-in holds a HANG open forever, so
 * whether a hang check ends depends on the code under test; if that bound ever
 * regresses, the regression must surface here as a named FAIL within seconds,
 * not as a gate that runs until CI kills it. The slowest honest check (the
 * middleware's real eight-second session bound) finishes well inside this.
 */
const CHECK_DEADLINE_MS = 30_000;
const record = async (label, fn) => {
  let timer;
  try {
    await Promise.race([
      fn(),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`did not finish within ${CHECK_DEADLINE_MS} ms — a hang was not bounded`)), CHECK_DEADLINE_MS);
      }),
    ]);
    passed += 1;
    console.log("  ✓", label);
  } catch (thrown) {
    failed += 1;
    report("  ✗ FAIL:", label);
    report("      ", thrown instanceof Error ? thrown.message.split("\n")[0] : String(thrown));
  } finally {
    clearTimeout(timer);
  }
};
const quietly = async (fn) => {
  const original = console.error;
  const lines = [];
  console.error = (...args) => lines.push(args.map(String).join(" "));
  try {
    return { value: await fn(), lines };
  } finally {
    console.error = original;
  }
};
const elapsed = async (fn) => {
  const t0 = performance.now();
  const value = await fn();
  return { value, ms: performance.now() - t0 };
};
const readSource = (relative) => readFileSync(new URL(`../${relative}`, import.meta.url), "utf8").replace(/\r\n?/g, "\n");

console.log("Be Community — el límite de toda llamada a Supabase (offline, stand-in local)");
console.log("=".repeat(78));

const {
  boundedFetch, withinDeadline, upstreamSurface, upstreamAbort,
  UPSTREAM_ATTEMPT_TIMEOUT_MS, UPSTREAM_TIMEOUT_MESSAGE, UPSTREAM_CANCELLED_MESSAGE, RETRY_AFTER_CEILING_SECONDS,
} = await import("../src/lib/upstream/bounded-fetch.ts");
const { classifyRead, classifySession, classifySignIn } = await import("../src/lib/upstream/outcome.ts");
const { decideInternalAccess } = await import("../src/lib/studio/internal-access.ts");
const { classifyTransportFailure } = await import("../src/lib/publication/read-failure.ts");
const { signInErrorCode } = await import("../src/app/login/errors.ts");
const { createClient } = await import("@supabase/supabase-js");

/* ---------------------------------------------------------------------------
 * THE STAND-IN. One server; each test installs the handler it needs and reads
 * how many requests arrived. A socket that is destroyed or never answered is
 * cleaned up when the server closes.
 * ------------------------------------------------------------------------- */
let handler = (_req, res) => { res.writeHead(500); res.end(); };
let arrivals = [];
const sockets = new Set();
const server = createServer((req, res) => {
  arrivals.push(`${req.method} ${req.url.split("?")[0]}`);
  handler(req, res);
});
server.on("connection", (socket) => { sockets.add(socket); socket.on("close", () => sockets.delete(socket)); });
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const ORIGIN = `http://127.0.0.1:${server.address().port}`;
const serve = (fn) => { handler = fn; arrivals = []; };
const json = (res, status, body, headers = {}) => { res.writeHead(status, { "content-type": "application/json", ...headers }); res.end(JSON.stringify(body)); };
const HANG = () => {};
/**
 * GoTrue as it really answers a refusal: NAMED, under the API version auth-js
 * asks for. Measured against the hosted project in Unit 6B.4B2P: a sign-in
 * refusal is 400 with code invalid_credentials, a bad token 403 with code
 * bad_jwt, and the response carries x-supabase-api-version 2024-01-01. The
 * GATEWAY in front of it refuses a bad API key with a 401 and no code at all.
 */
const gotrue = (res, status, body) => json(res, status, body, { "x-supabase-api-version": "2024-01-01" });
const GATEWAY_REFUSAL = (_req, res) => json(res, 401, { message: "Invalid API key", hint: "Double check your Supabase anon or service_role API key." });

// A short bound so a hang costs this gate a fraction of a second.
const BOUND_MS = 300;
const bounded = boundedFetch({ timeoutMs: { auth: BOUND_MS, rest: BOUND_MS } });
const client = (fetchImpl = bounded) =>
  createClient(ORIGIN, "sb_publishable_stand_in", {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { fetch: fetchImpl },
  });

/* ------------------------------------------------------------------------- */
console.log("\n[1] La política, sin red");

await record("only /auth/v1 and /rest/v1 are bounded; storage and anything else pass through untouched", async () => {
  assert.equal(upstreamSurface(`${ORIGIN}/auth/v1/token?grant_type=password`), "auth");
  assert.equal(upstreamSurface(new URL(`${ORIGIN}/rest/v1/profiles`)), "rest");
  assert.equal(upstreamSurface(new Request(`${ORIGIN}/rest/v1/rpc/read_canonical_row_set`, { method: "POST" })), "rest");
  assert.equal(upstreamSurface(`${ORIGIN}/storage/v1/object/logos/x.png`), null);
  assert.equal(upstreamSurface("not a url"), null);
  let seen;
  const passThrough = boundedFetch({ base: async (input, init) => { seen = init; return new Response("ok"); } });
  const init = { method: "PUT" };
  await passThrough(`${ORIGIN}/storage/v1/object/x`, init);
  assert.equal(seen, init, "an unbounded surface must receive the caller's init unchanged");
  assert.deepEqual(UPSTREAM_ATTEMPT_TIMEOUT_MS, { auth: 8_000, rest: 10_000 });
});

await record("every abort is an AbortError carrying only a sentinel — the one name postgrest-js does not retry", async () => {
  for (const kind of ["timeout", "cancelled"]) {
    const abort = upstreamAbort(kind);
    assert.equal(abort.name, "AbortError");
    assert.equal(abort.message, kind === "timeout" ? UPSTREAM_TIMEOUT_MESSAGE : UPSTREAM_CANCELLED_MESSAGE);
  }
});

await record("a caller signal that is already aborted makes NO request", async () => {
  let calls = 0;
  const f = boundedFetch({ base: async () => { calls += 1; return new Response("x"); } });
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(f(`${ORIGIN}/rest/v1/x`, { signal: controller.signal }), (e) => e.name === "AbortError" && e.message === UPSTREAM_CANCELLED_MESSAGE);
  assert.equal(calls, 0);
});

await record("a failure that is not an abort is re-thrown as itself", async () => {
  const refusal = new TypeError("fetch failed");
  const f = boundedFetch({ base: async () => { throw refusal; } });
  await assert.rejects(f(`${ORIGIN}/rest/v1/x`), (e) => e === refusal);
});

await record(`a Retry-After above ${RETRY_AFTER_CEILING_SECONDS} s is dropped; one within it, and any other status, are kept`, async () => {
  const withHeader = (status, value) => boundedFetch({ base: async () => new Response("busy", { status, headers: { "retry-after": value } }) });
  assert.equal((await withHeader(503, "3600")(`${ORIGIN}/rest/v1/x`)).headers.get("retry-after"), null);
  assert.equal((await withHeader(520, "86400")(`${ORIGIN}/rest/v1/x`)).headers.get("retry-after"), null);
  assert.equal((await withHeader(503, "garbage")(`${ORIGIN}/rest/v1/x`)).headers.get("retry-after"), null);
  assert.equal((await withHeader(503, "1")(`${ORIGIN}/rest/v1/x`)).headers.get("retry-after"), "1");
  assert.equal((await withHeader(429, "3600")(`${ORIGIN}/rest/v1/x`)).headers.get("retry-after"), "3600");
  const kept = await withHeader(503, "3600")(`${ORIGIN}/rest/v1/x`);
  assert.equal(kept.status, 503);
  assert.equal(await kept.text(), "busy", "the body must survive the header being dropped");
});

await record("withinDeadline answers at the deadline, and a late rejection belongs to nobody", async () => {
  const unhandled = [];
  const onUnhandled = (reason) => unhandled.push(reason);
  process.on("unhandledRejection", onUnhandled);
  try {
    assert.deepEqual(await withinDeadline(Promise.resolve(7), 1_000), { settled: true, value: 7 });
    const { value, ms } = await elapsed(() => withinDeadline(new Promise((_, reject) => setTimeout(() => reject(new Error("late")), 250)), 50));
    assert.deepEqual(value, { settled: false });
    assert.ok(ms < 200, `answered after ${ms.toFixed(0)} ms`);
    await new Promise((resolve) => setTimeout(resolve, 350));
    assert.equal(unhandled.length, 0, "the losing promise's rejection escaped");
  } finally {
    process.off("unhandledRejection", onUnhandled);
  }
});

/* ------------------------------------------------------------------------- */
console.log("\n[2] PostgREST real contra el stand-in");

await record("a HUNG read ends as a timeout near the bound, and ONE attempt reaches the upstream", async () => {
  serve(HANG);
  const { value: result, ms } = await elapsed(() => client().from("profiles").select("role"));
  assert.equal(classifyRead(result, "many"), "timeout");
  assert.equal(arrivals.length, 1, `attempts reaching the stand-in: ${arrivals.length}`);
  assert.ok(ms < BOUND_MS + 1_500, `ended after ${ms.toFixed(0)} ms`);
  assert.ok(!JSON.stringify(result.error).includes("127.0.0.1"), "the classified error text carries no address");
});

await record("CONTROL: the naive AbortSignal.timeout bound on the same hang is RETRIED by postgrest-js", async () => {
  serve(HANG);
  const naive = (input, init) => fetch(input, { ...init, signal: init?.signal ?? AbortSignal.timeout(BOUND_MS) });
  const { value: result } = await elapsed(() => client(naive).from("profiles").select("role"));
  assert.ok(result.error, "the naive bound still ends in an error");
  assert.ok(arrivals.length >= 2, `the control must show the retry hazard; attempts: ${arrivals.length}`);
});

await record("a body that STALLS after its headers is just as hung, and ends the same way", async () => {
  serve((_req, res) => { res.writeHead(200, { "content-type": "application/json" }); res.write('[{"role":"inte'); });
  const { value: result, ms } = await elapsed(() => client().from("profiles").select("role"));
  assert.equal(classifyRead(result, "many"), "timeout");
  assert.equal(arrivals.length, 1);
  assert.ok(ms < BOUND_MS + 1_500, `ended after ${ms.toFixed(0)} ms`);
});

await record("a caller signal aborted IN FLIGHT is a cancellation, never a timeout, and is not retried", async () => {
  serve(HANG);
  const controller = new AbortController();
  setTimeout(() => controller.abort(), 60);
  const { value: result, ms } = await elapsed(() => client().from("profiles").select("role").abortSignal(controller.signal));
  assert.equal(classifyRead(result, "many"), "cancelled");
  assert.equal(arrivals.length, 1);
  assert.ok(ms < BOUND_MS, `a cancellation must not wait for the bound (${ms.toFixed(0)} ms)`);
});

await record("a caller signal already aborted reaches the upstream ZERO times", async () => {
  serve((_req, res) => json(res, 200, []));
  const controller = new AbortController();
  controller.abort();
  const result = await client().from("profiles").select("role").abortSignal(controller.signal);
  assert.equal(classifyRead(result, "many"), "cancelled");
  assert.equal(arrivals.length, 0);
});

await record("EMPTY only when the database answered nothing: [], a maybeSingle miss, a single() of 0 rows", async () => {
  serve((_req, res) => json(res, 200, []));
  assert.equal(classifyRead(await client().from("t").select("id"), "many"), "empty");
  assert.equal(classifyRead(await client().from("t").select("id").maybeSingle(), "optional_one"), "empty");
  serve((_req, res) => json(res, 406, { code: "PGRST116", details: "The result contains 0 rows", hint: null, message: "JSON object requested, multiple (or no) rows returned" }));
  assert.equal(classifyRead(await client().from("t").select("id").single(), "one"), "empty");
});

await record("and never empty for anything else: rows, two rows for one, a 404 with no body, a 500, broken JSON", async () => {
  serve((_req, res) => json(res, 200, [{ id: 1 }]));
  assert.equal(classifyRead(await client().from("t").select("id"), "many"), "ok");
  assert.equal(classifyRead(await client().from("t").select("id").maybeSingle(), "optional_one"), "ok");
  serve((_req, res) => json(res, 406, { code: "PGRST116", details: "The result contains 2 rows", hint: null, message: "JSON object requested, multiple (or no) rows returned" }));
  assert.equal(classifyRead(await client().from("t").select("id").single(), "one"), "upstream_failure");
  serve((_req, res) => { res.writeHead(200, { "content-type": "application/json" }); res.end(""); });
  const emptyBody = await client().from("profiles").select("role").limit(2);
  assert.equal(emptyBody.error, null, "postgrest-js reports a 200 with an EMPTY body with no error and no data");
  assert.equal(classifyRead(emptyBody, "many"), "upstream_failure", "a list read cannot mistake no answer for no row — which is why the Studio door reads a list");
  serve((_req, res) => { res.writeHead(404); res.end(); });
  const missing = await client().from("t").select("id");
  assert.equal(missing.error, null, "postgrest-js reports this with no error at all");
  assert.equal(classifyRead(missing, "many"), "upstream_failure", "a 404 with no body is not an empty answer");
  serve((_req, res) => { res.writeHead(500, { "content-type": "text/html" }); res.end("<html>upstream is unwell</html>"); });
  assert.equal(classifyRead(await client().rpc("read_canonical_row_set", {}), "many"), "upstream_failure");
  serve((_req, res) => { res.writeHead(200, { "content-type": "application/json" }); res.end("<!doctype html>not json"); });
  assert.equal(classifyRead(await client().rpc("read_canonical_row_set", {}), "many"), "upstream_failure");
});

await record("a refusal is a refusal: 401, and RLS's 42501", async () => {
  serve((_req, res) => json(res, 401, { code: "PGRST301", message: "JWT expired" }));
  assert.equal(classifyRead(await client().from("t").select("id"), "many"), "authorization_refused");
  serve((_req, res) => json(res, 403, { code: "42501", message: "permission denied for table t" }));
  assert.equal(classifyRead(await client().rpc("read_canonical_row_set", {}), "many"), "authorization_refused");
});

await record("a dead connection is an upstream failure, not empty (an RPC, which postgrest-js never retries)", async () => {
  serve((req) => req.socket.destroy());
  const result = await client().rpc("read_canonical_row_set", {});
  assert.equal(classifyRead(result, "many"), "upstream_failure");
  assert.equal(arrivals.length, 1);
});

await record("the canonical readers' own classifier agrees: the bound's timeout is TIMED_OUT, a cancel is CANCELLED", async () => {
  serve(HANG);
  const timedOut = await client().from("t").select("id");
  assert.equal(classifyTransportFailure(timedOut.error), "TIMED_OUT");
  const controller = new AbortController();
  controller.abort();
  const cancelled = await client().from("t").select("id").abortSignal(controller.signal);
  assert.equal(classifyTransportFailure(cancelled.error), "CANCELLED");
  assert.equal(classifyTransportFailure({ message: "TimeoutError: The operation was aborted due to timeout" }), "TIMED_OUT");
  assert.equal(classifyTransportFailure({ message: "AbortError: This operation was aborted" }), "CANCELLED");
});

/* ------------------------------------------------------------------------- */
console.log("\n[3] Auth real contra el stand-in: la sesión y el inicio de sesión");

const USER = { id: "00000000-0000-0000-0000-0000000000a1", aud: "authenticated", role: "authenticated", email: "stand-in@becommunity.test", app_metadata: {}, user_metadata: {}, created_at: "2026-01-01T00:00:00Z" };
const getUser = () => quietly(() => client().auth.getUser("stand-in-access-token"));
const signIn = () => quietly(() => client().auth.signInWithPassword({ email: "stand-in@becommunity.test", password: "not-a-real-password" }));

await record("the session check: a user is authenticated; two NAMED 403s and a missing session are not signed in", async () => {
  serve((_req, res) => json(res, 200, USER));
  assert.equal(classifySession((await getUser()).value), "authenticated");
  serve((_req, res) => gotrue(res, 403, { code: "bad_jwt", message: "invalid JWT" }));
  assert.equal(classifySession((await getUser()).value), "unauthenticated");
  serve((_req, res) => gotrue(res, 403, { code: "user_banned", message: "banned" }));
  assert.equal(classifySession((await getUser()).value), "unauthenticated");
  assert.equal(classifySession(await client().auth.getUser()), "unauthenticated", "no session at all is not an outage");
});

await record("and an outage is an outage: 500, 429, an unreadable 400, a dead connection", async () => {
  for (const [label, respond] of [
    ["500", (_req, res) => json(res, 500, { msg: "boom" })],
    ["429", (_req, res) => json(res, 429, { code: "over_request_rate_limit", msg: "slow down" })],
    ["html 400", (_req, res) => { res.writeHead(400, { "content-type": "text/html" }); res.end("<html>proxy</html>"); }],
    ["dead connection", (req) => req.socket.destroy()],
    ["gateway 401, no code (a revoked or wrong API key)", GATEWAY_REFUSAL],
  ]) {
    serve(respond);
    assert.equal(classifySession((await getUser()).value), "upstream_failure", label);
  }
});

await record("a HUNG session check ends as a timeout near the bound — the code 6B.4B2O could never record", async () => {
  serve(HANG);
  const { value, ms } = await elapsed(() => getUser());
  assert.equal(classifySession(value.value), "timeout");
  assert.equal(arrivals.length, 1);
  assert.ok(ms < BOUND_MS + 1_500, `ended after ${ms.toFixed(0)} ms`);
});

await record("withinDeadline over a REAL hung auth client resolves unsettled, and that is classified as a timeout", async () => {
  serve(HANG);
  const { value: attempt } = await quietly(async () => {
    const raced = await withinDeadline(client(boundedFetch({ timeoutMs: { auth: 600 } })).auth.getUser("stand-in-access-token"), 100);
    await new Promise((resolve) => setTimeout(resolve, 900)); // let the abandoned attempt end inside the quiet window
    return raced;
  });
  assert.deepEqual(attempt, { settled: false });
  assert.equal(classifySession(attempt.settled ? attempt.value : null), "timeout");
});

await record("sign-in: only the service's 4xx says «invalid credentials»; every outage says «not your password»", async () => {
  const cases = [
    ["400 invalid_credentials", (_req, res) => gotrue(res, 400, { code: "invalid_credentials", message: "Invalid login credentials" }), "invalid_credentials", "invalid_credentials"],
    ["legacy 400 with error_code", (_req, res) => json(res, 400, { code: 400, error_code: "invalid_credentials", msg: "Invalid login credentials" }), "invalid_credentials", "invalid_credentials"],
    ["gateway 401, no code", GATEWAY_REFUSAL, "upstream_failure", "service_unavailable"],
    ["500", (_req, res) => json(res, 500, { msg: "boom" }), "upstream_failure", "service_unavailable"],
    ["503", (_req, res) => json(res, 503, { msg: "down" }), "upstream_failure", "service_unavailable"],
    ["429", (_req, res) => json(res, 429, { code: "over_request_rate_limit", msg: "slow down" }), "upstream_failure", "service_unavailable"],
    ["html 400", (_req, res) => { res.writeHead(400, { "content-type": "text/html" }); res.end("<html>proxy</html>"); }, "upstream_failure", "service_unavailable"],
    ["dead connection", (req) => req.socket.destroy(), "upstream_failure", "service_unavailable"],
  ];
  for (const [label, respond, outcome, code] of cases) {
    serve(respond);
    const { value } = await signIn();
    assert.equal(classifySignIn(value.error), outcome, label);
    assert.equal(signInErrorCode(classifySignIn(value.error)), code, label);
  }
});

await record("a HUNG sign-in ends as a timeout, ONCE, near the bound, and is answered «not your password»", async () => {
  serve(HANG);
  const { value, ms } = await elapsed(() => signIn());
  assert.equal(classifySignIn(value.value.error), "timeout");
  assert.equal(signInErrorCode("timeout"), "service_unavailable");
  assert.equal(arrivals.length, 1, "auth-js must not retry a sign-in");
  assert.ok(ms < BOUND_MS + 1_500, `ended after ${ms.toFixed(0)} ms`);
});

/* ------------------------------------------------------------------------- */
console.log("\n[4] La puerta de Studio decide con lo que realmente supo");

await record("every combination refuses unless the session is verified AND the role read says internal", async () => {
  const SESSIONS = ["authenticated", "unauthenticated", "timeout", "cancelled", "upstream_failure"];
  const PROFILES = [null, "ok", "empty", "authorization_refused", "timeout", "cancelled", "upstream_failure"];
  const ROLES = ["internal", "client", undefined, "INTERNAL"];
  for (const session of SESSIONS) for (const profile of PROFILES) for (const role of ROLES) {
    const decision = decideInternalAccess(session, profile, role);
    const expectInternal = session === "authenticated" && profile === "ok" && role === "internal";
    assert.equal(decision.kind === "internal", expectInternal, `${session}/${profile}/${role} → ${decision.kind}`);
  }
});

await record("a verdict redirects; an outage is named, and never dressed as a verdict", async () => {
  assert.deepEqual(decideInternalAccess("unauthenticated", null, undefined), { kind: "unauthenticated" });
  assert.deepEqual(decideInternalAccess("authenticated", "ok", "client"), { kind: "not_internal" });
  assert.deepEqual(decideInternalAccess("authenticated", "empty", undefined), { kind: "not_internal" });
  assert.deepEqual(decideInternalAccess("timeout", null, undefined), { kind: "unavailable", code: "session_timeout" });
  assert.deepEqual(decideInternalAccess("upstream_failure", null, undefined), { kind: "unavailable", code: "session_unverifiable" });
  assert.deepEqual(decideInternalAccess("authenticated", "timeout", undefined), { kind: "unavailable", code: "authorization_timeout" });
  assert.deepEqual(decideInternalAccess("authenticated", "upstream_failure", undefined), { kind: "unavailable", code: "authorization_unverifiable" });
  assert.deepEqual(decideInternalAccess("authenticated", "authorization_refused", undefined), { kind: "unavailable", code: "authorization_unverifiable" });
  assert.deepEqual(decideInternalAccess("authenticated", null, "internal"), { kind: "unavailable", code: "authorization_unverifiable" }, "a role that was never read is not a role");
});

await record("the Studio door and every reader's client are wired to the policy", async () => {
  const guard = readSource("src/lib/studio/guard.ts");
  const server = readSource("src/lib/supabase/server.ts");
  const admin = readSource("src/lib/supabase/admin.ts");
  assert.match(server, /global: \{ fetch: boundedFetch\(\) \}/, "the reader's client must be bounded");
  assert.match(admin, /options\.bounded \? \{ global: \{ fetch: boundedFetch\(\) \} \}/, "the admin client must offer the bound");
  assert.match(guard, /withinDeadline\(supabase\.auth\.getUser\(\), SESSION_CHECK_DEADLINE_MS\)/);
  assert.match(guard, /\.eq\("user_id", user\.id\)\s*\.limit\(2\)/, "the role is read as a LIST, so only an array proves an answer");
  assert.match(guard, /profileOutcome = classifyRead\(read, "many"\);/);
  assert.match(guard, /if \(profileOutcome === "ok" && read\.data\?\.length !== 1\) profileOutcome = "upstream_failure";/, "a second row is not an answer");
  assert.doesNotMatch(guard, /\.maybeSingle[<(]|\.single[<(]/, "neither single form can tell «no row» from «no answer»");
  assert.match(guard, /const SESSION_CHECK_DEADLINE_MS = 9_000;/);
  assert.match(guard, /recordRuntimeFailure\(\{ code: decision\.code, pathname: "\/studio", method: "GET" \}\);/, "an outage must leave a closed-code trace");
  assert.match(guard, /decideInternalAccess\(session, profileOutcome, profile\?\.role\)/);
  assert.match(guard, /admin: createAdminClient\(\{ bounded: true \}\)/, "Studio pages must read through a bounded client");
  assert.ok(guard.indexOf("decideInternalAccess(") < guard.indexOf("createAdminClient("), "no privileged client before the decision");
  assert.match(guard, /throw new InternalAccessUnavailableError\(decision\.code\)/, "an outage must not render as a page");
  // Every admin client that READS TO SERVE A PAGE takes the bound; those that
  // commit writes (the actions) stay unbounded on purpose.
  for (const file of [
    "src/components/studio/StudioHomeView.tsx",
    "src/lib/studies/authorized.ts",
    "src/lib/studies/published-presentation.ts",
    "src/app/admin/clients/page.tsx",
    "src/app/admin/qualitative/page.tsx",
    "src/app/admin/studies/page.tsx",
    "src/app/admin/upload/page.tsx",
  ]) {
    const code = readSource(file);
    const all = (code.match(/createAdminClient\(/g) ?? []).length;
    const boundedSites = (code.match(/createAdminClient\(\{ bounded: true \}\)/g) ?? []).length;
    assert.ok(all > 0 && all === boundedSites, `${file}: ${boundedSites} of ${all} admin client(s) bounded`);
  }
  // The Studio actions that only READ to answer a waiting person are bounded
  // too; the ones that commit stay unbounded, and each says which it is.
  const composer = readSource("src/app/studio/e/[studyId]/construccion/actions.ts");
  const review = readSource("src/app/studio/e/[studyId]/revision/actions.ts");
  for (const [name, code, reads, writes] of [["construccion", composer, 1, 3], ["revision", review, 1, 5]]) {
    assert.match(code, /const admin = createAdminClient\(\{ bounded: access === "read" \}\);/, `${name}: the scope helper bounds reads`);
    assert.equal((code.match(/authorizedStudioScope\(studyId, "read"\)/g) ?? []).length, reads, `${name}: read-only actions`);
    assert.equal((code.match(/authorizedStudioScope\(studyId, "write"\)/g) ?? []).length, writes, `${name}: writing actions`);
    assert.equal((code.match(/authorizedStudioScope\(studyId\)/g) ?? []).length, 0, `${name}: every call says whether it reads or writes`);
  }
  assert.match(composer, /export async function loadCanonicalPresentationDraft\([^)]*\)[^{]*\{\s*const authorized = await authorizedStudioScope\(studyId, "read"\);/);
  assert.match(review, /export async function previewPublicationUnderSelection\([\s\S]{0,120}?\{\s*const authorized = await authorizedStudioScope\(studyId, "read"\);/);
  assert.match(composer, /const admin = createAdminClient\(\{ bounded: true \}\);/, "the composer preview reads through a bounded client");
  assert.match(readSource("src/lib/studio/lifecycle.ts"), /\.list\(tenantId, \{ limit: STORAGE_PAGE, offset: page \* STORAGE_PAGE \}, \{ signal: upstreamDeadlineSignal\(10_000\) \}\)/, "the page-serving Storage listing carries its own bound");
});

/* ------------------------------------------------------------------------- */
console.log("\n[5] El middleware REAL contra el stand-in");

const COOKIE_NAME = "sb-127-auth-token"; // @supabase/ssr's key for a 127.0.0.1 origin
const SESSION = { access_token: "stand-in-access-token", token_type: "bearer", expires_in: 3600, expires_at: 9_999_999_999, refresh_token: "stand-in-refresh", user: USER };
const savedEnv = { url: process.env.NEXT_PUBLIC_SUPABASE_URL, key: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY };
process.env.NEXT_PUBLIC_SUPABASE_URL = ORIGIN;
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "sb_publishable_stand_in";
const { NextRequest } = await import("next/server");
const { updateSession } = await import("../src/lib/supabase/middleware.ts");
const visit = (path, withSession = true) =>
  quietly(() =>
    updateSession(
      new NextRequest(`https://becommunity.test${path}`, {
        headers: withSession ? { cookie: `${COOKIE_NAME}=${encodeURIComponent(JSON.stringify(SESSION))}` } : {},
      }),
    ),
  );
/** Where a redirect points. The middleware keeps the original query string, so compare the PATH. */
const redirectedTo = (res) => { const location = res.headers.get("location"); return location ? new URL(location).pathname : null; };
const runtimeLines = (lines) => lines.filter((line) => line.startsWith('{"event":"runtime_failure"')).map((line) => JSON.parse(line));

try {
  await record("a verified session passes, and names nothing", async () => {
    serve((_req, res) => json(res, 200, USER));
    const { value: res, lines } = await visit("/studio");
    assert.equal(res.headers.get("location"), null, "a verified reader must not be redirected");
    assert.equal(runtimeLines(lines).length, 0);
    assert.deepEqual(arrivals, ["GET /auth/v1/user"]);
  });

  await record("no cookie at all: redirected to /login, no upstream call, nothing named", async () => {
    serve((_req, res) => json(res, 200, USER));
    const { value: res, lines } = await visit("/studio", false);
    assert.equal(redirectedTo(res), "/login");
    assert.equal(arrivals.length, 0);
    assert.equal(runtimeLines(lines).length, 0);
  });

  await record("an ordinary, NAMED «no» (403 bad_jwt): redirected to /login, and nothing is named — a sign-out is not an incident", async () => {
    serve((_req, res) => gotrue(res, 403, { code: "bad_jwt", message: "invalid JWT" }));
    const { value: res, lines } = await visit("/studio");
    assert.equal(redirectedTo(res), "/login");
    assert.equal(runtimeLines(lines).length, 0);
  });

  await record("a HUNG session check on the REAL middleware: redirected at its eight-second bound, and named session_timeout once", async () => {
    serve(HANG);
    const { value: outcome, ms } = await elapsed(() => visit("/studio"));
    const { value: res, lines } = outcome;
    assert.equal(redirectedTo(res), "/login", "a session nobody could verify is refused");
    const named = runtimeLines(lines);
    assert.equal(named.length, 1);
    assert.equal(named[0].code, "session_timeout", "the timeout must be recorded AS a timeout");
    assert.equal(arrivals.length, 1, "the hung check must not be retried");
    assert.ok(ms >= 7_500 && ms < 10_500, `answered after ${ms.toFixed(0)} ms — the eight-second attempt bound, inside the nine-second deadline`);
  });

  await record("an OUTAGE (500, dead connection, a gateway 401 with no code): still redirected — fails closed — and named session_unverifiable once", async () => {
    for (const respond of [(_req, res) => json(res, 500, { msg: "boom" }), (req) => req.socket.destroy(), GATEWAY_REFUSAL]) {
      serve(respond);
      const { value: res, lines } = await visit(`/studio/e/cd4d6acd-88b9-4804-829f-75b6d91a32b7/revision?email=carla%40becommunitymx.com`);
      assert.equal(redirectedTo(res), "/login");
      const named = runtimeLines(lines);
      assert.equal(named.length, 1);
      assert.equal(named[0].code, "session_unverifiable");
      assert.equal(named[0].routeClass, "studio");
      assert.ok(!lines.join("\n").includes("cd4d6acd"), "the study id reached a log line");
      assert.ok(!lines.join("\n").includes("carla"), "the query reached a log line");
    }
  });
} finally {
  if (savedEnv.url === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL; else process.env.NEXT_PUBLIC_SUPABASE_URL = savedEnv.url;
  if (savedEnv.key === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY; else process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = savedEnv.key;
}

/* ------------------------------------------------------------------------- */
console.log("\n[6] Ningún módulo guarda su propia copia del clasificador");

await record("no source file declares a private auth-transport classifier any more", async () => {
  const { readdirSync, statSync } = await import("node:fs");
  const { join } = await import("node:path");
  const { fileURLToPath } = await import("node:url");
  const offenders = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.(ts|tsx)$/.test(entry) && /function (isTransportFailure|isAuthTransportFailure)\b/.test(readFileSync(full, "utf8"))) offenders.push(full);
    }
  };
  walk(fileURLToPath(new URL("../src/", import.meta.url)));
  assert.deepEqual(offenders, []);
});

for (const socket of sockets) socket.destroy();
await new Promise((resolve) => server.close(resolve));

console.log("\n" + "=".repeat(78));
console.log(`RESUMEN: ${passed + failed} comprobaciones, ${passed} aprobadas, ${failed} falladas.`);
if (failed > 0) {
  report("RESULTADO: una llamada a Supabase puede quedar sin límite o confundir hechos distintos. COMPUERTA BLOQUEADA.");
  process.exit(1);
}
console.log(
  "RESULTADO: toda lectura y todo inicio de sesión terminan, una sola vez, con un resultado que " +
    "distingue «vacío», «rechazado», «sin respuesta» y «tiempo agotado», y la puerta de Studio no " +
    "disfraza una caída de veredicto.",
);
process.exit(0);
