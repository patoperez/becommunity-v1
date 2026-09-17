import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import { recordRuntimeFailure, unavailableResponse, type RuntimeFailureCode } from "@/lib/runtime/unavailable";
import { boundedFetch, upstreamOperation, withinDeadline } from "@/lib/upstream/bounded-fetch";
import { classifySession } from "@/lib/upstream/outcome";

/**
 * HOW LONG THE SESSION CHECK MAY TAKE BEFORE IT IS A FAILURE.
 *
 * `getUser()` revalidates the JWT against the Supabase Auth server, so the
 * middleware makes a network call on EVERY authenticated request to EVERY
 * route. It had no bound at all: fault injection against the built Worker under
 * workerd showed that an auth service which accepts the connection and never
 * answers leaves the request open until something above gives up — measured at
 * over forty-five seconds, with no response and no log.
 *
 * TWO BOUNDS, BECAUSE ONE WAS NOT ENOUGH (Unit 6B.4B2P). Each ATTEMPT is bounded
 * at eight seconds by the client's own fetch (`UPSTREAM_ATTEMPT_TIMEOUT_MS.auth`).
 * But auth-js retries a token refresh on its own for up to thirty seconds,
 * re-arming a fresh per-attempt bound each time, so a session near expiry could
 * still hold a request for about forty seconds. This bounds the whole OPERATION.
 *
 * ⚠️ CORRECTED IN UNIT 6B.4B2Q. Until this unit the operation bound stopped the
 * WAIT and let the work run on, so a hung check kept its socket and auth-js
 * stayed free to open the next attempt of a refresh nobody was waiting for. The
 * deadline now EXPIRES the operation: the attempt in flight is aborted, and the
 * next retry is refused before it reaches the network.
 */
const SESSION_CHECK_DEADLINE_MS = 9_000;

/**
 * Build the Content-Security-Policy (§5.2). Nonce-based `script-src` with
 * `strict-dynamic` (the Next-supported pattern — Next stamps the nonce onto its
 * own inline/bootstrap scripts when it sees this CSP on the request headers).
 * `connect-src` whitelists ONLY the Supabase project origin (derived from env,
 * never hardcoded) plus 'self' — nothing broader.
 */
function buildCsp(nonce: string): string {
  let supabaseOrigin = "";
  try {
    supabaseOrigin = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").origin;
  } catch {
    supabaseOrigin = "";
  }
  const connectSrc = ["'self'", supabaseOrigin].filter(Boolean).join(" ");
  return [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`,
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' data: ${supabaseOrigin}`.trim(),
    "font-src 'self'",
    `connect-src ${connectSrc}`,
    "frame-ancestors 'none'",
    "form-action 'self'",
  ].join("; ");
}

/**
 * Refreshes the Supabase session on every request and enforces a first gate of
 * route protection. This is ONE layer of defense (§6.4): every protected Server
 * Component must independently re-check auth — never trust the middleware alone.
 *
 * It also mints the per-request CSP nonce and attaches the Content-Security-
 * Policy (§5.2). The nonce is set on the REQUEST headers so Next applies it to
 * its own scripts, and the CSP is set on the response that renders the document.
 */
export async function updateSession(request: NextRequest) {
  // THE MIDDLEWARE RUNS ON EVERY ROUTE AND SITS OUTSIDE EVERY ERROR BOUNDARY.
  // `error.tsx` and `global-error.tsx` catch a Server Component that throws;
  // neither can see this function. A rejection here reaches the Worker's fetch
  // handler, and Cloudflare answers Error 1101 — on `/login` as readily as on a
  // review screen. So it is wrapped, and what it answers with is the product's
  // own controlled 503 rather than the edge's error page.
  try {
    return await runUpdateSession(request);
  } catch {
    const { pathname } = request.nextUrl;
    recordRuntimeFailure({ code: "middleware_unhandled", pathname, method: request.method });
    return unavailableResponse("middleware_unhandled", pathname);
  }
}

/**
 * The controlled answer, KEEPING WHATEVER COOKIES THE SESSION WORK PRODUCED.
 *
 * An outage must not sign anybody out. If auth-js managed to refresh the token
 * before the service stopped answering, `setAll` has already put the new pair on
 * the response being built; dropping it would invalidate a refresh token the
 * browser no longer has. The page itself is `unavailableResponse`'s and nothing
 * else: no message, no path, no identifier.
 */
function unavailableCarryingCookies(
  code: RuntimeFailureCode,
  pathname: string,
  carrying: NextResponse,
): NextResponse {
  const answer = unavailableResponse(code, pathname);
  const response = new NextResponse(answer.body, { status: answer.status, headers: answer.headers });
  for (const cookie of carrying.cookies.getAll()) response.cookies.set(cookie);
  return response;
}

async function runUpdateSession(request: NextRequest) {
  // Per-request CSP nonce (16 random bytes, base64). getRandomValues + btoa work
  // on the Edge runtime (Buffer is not guaranteed there).
  const nonce = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(16))));
  const csp = buildCsp(nonce);

  // Forward the nonce + CSP to the app via request headers so Next can read them.
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("content-security-policy", csp);

  let supabaseResponse = NextResponse.next({ request: { headers: requestHeaders } });

  // THIS REQUEST'S OWN CANCELLATION, created here and never shared: expiring it
  // can cancel nothing but this request's own session check.
  const operation = upstreamOperation();

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      /*
        EVERY CALL THIS CLIENT MAKES IS BOUNDED. The bound goes on the client's
        own `fetch` rather than on one call site, so a library that adds a
        request later inherits it instead of escaping it.

        ⚠️ CORRECTED IN UNIT 6B.4B2P. This used `AbortSignal.timeout()` and said
        «the abort carries NO reason». It does carry one: a `TimeoutError`, which
        `@supabase/postgrest-js` does NOT recognise as an abort, so a PostgREST
        GET behind that bound would have been retried three times. It was
        harmless here only because this client makes auth calls alone. The
        shared policy aborts with an `AbortError` carrying a sentinel message,
        and honours a caller's own signal.

        It also carries THIS REQUEST'S operation signal (Unit 6B.4B2Q), so the
        deadline below cancels the conversation rather than merely stopping the
        wait for it.
      */
      global: { fetch: boundedFetch({ signal: operation.signal }) },
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          supabaseResponse = NextResponse.next({ request: { headers: requestHeaders } });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  // getUser() revalidates the JWT against the Supabase Auth server. NEVER use
  // getSession() for an authorization decision — it only decodes the cookie and
  // can be spoofed. This is the core of "defense in depth" (§6.4).
  //
  // ⓘ «NO SESSION» AND «COULD NOT CHECK THE SESSION» ARE DIFFERENT FACTS, and
  // the client returns both the same way: `{ data: { user: null }, error }`.
  // Fault injection confirmed it — a refused connection, a reset, malformed
  // JSON, a truncated body and HTTP 500 all came back as «no user», so an auth
  // outage silently presents every signed-in person as a stranger. The
  // AUTHORIZATION decision below is unchanged and still fails closed on both,
  // because refusing a reader we cannot vouch for is correct either way. What is
  // new is that the second case is now NAMED, so it is visible in the logs
  // instead of looking like a quiet afternoon of people signing out.
  //
  // ⚠️ CORRECTED IN UNIT 6B.4B2P: the timeout used to be detected by
  // `error.name === "AbortError"`, which can never be true — auth-js renames
  // every fetch rejection `AuthRetryableFetchError` — so `session_timeout` was
  // unreachable. The shared classifier reads the bound's sentinel instead.
  const attempt = await withinDeadline(supabase.auth.getUser(), SESSION_CHECK_DEADLINE_MS, operation);
  const session = classifySession(attempt.settled ? attempt.value : null);
  const user = session === "authenticated" && attempt.settled ? attempt.value.data.user : null;
  const outage: RuntimeFailureCode | null =
    session === "timeout" || session === "cancelled"
      ? "session_timeout"
      : session === "upstream_failure"
        ? "session_unverifiable"
        : null;
  if (outage) {
    recordRuntimeFailure({ code: outage, pathname: request.nextUrl.pathname, method: request.method });
  }

  const { pathname } = request.nextUrl;
  const isAuthRoute = pathname.startsWith("/login");
  // /api/health is the public anti-pause endpoint (§9.1) — Uptime Robot must
  // reach it without a session.
  const isPublicRoute = isAuthRoute || pathname === "/" || pathname.startsWith("/api/health");

  // ⓘ AN OUTAGE IS NOT A SIGN-OUT (Unit 6B.4B2Q). Until this unit a session the
  // auth service never answered for was handled exactly like a verified «nobody
  // is signed in»: the reader was redirected to `/login`, where — their cookies
  // still perfectly valid — they were invited to type a password that could not
  // be checked either. That is the conflation this whole policy exists to
  // prevent, committed by the code that names it. It fails closed the same way,
  // and now it says which thing happened: a controlled 503 carrying the closed
  // code, never a redirect, on every route that needs a session. `/login`, `/`
  // and `/api/health` still render, because none of them needs the answer.
  if (outage && !isPublicRoute) return unavailableCarryingCookies(outage, pathname, supabaseResponse);

  if (!user && !isPublicRoute) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  if (user && isAuthRoute) {
    const url = request.nextUrl.clone();
    url.pathname = "/dashboard";
    return NextResponse.redirect(url);
  }

  // Attach the CSP to the document response (the nonce it carries matches the one
  // Next stamped onto its scripts via the request header above).
  supabaseResponse.headers.set("content-security-policy", csp);
  return supabaseResponse;
}
