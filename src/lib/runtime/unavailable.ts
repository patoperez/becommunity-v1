/**
 * THE CONTROLLED UNAVAILABLE RESPONSE, AND THE CLOSED VOCABULARY BEHIND IT.
 *
 * Cloudflare answers **Error 1101 — «Worker threw a JavaScript exception»** when
 * the Worker's `fetch` handler rejects. The generated OpenNext entry has no
 * `try`/`catch` anywhere: a throw from the middleware handler, from the
 * request-time `import()` of the server handler, or from the server handler
 * itself goes straight to the edge, and every route of the application answers
 * with Cloudflare's own error page — including `/login`, which reads nothing.
 *
 * That page is the worst possible answer. It is branded by Cloudflare rather
 * than by the product, it tells a reader nothing they can act on, it is
 * indistinguishable from the site being gone, and it carries no status a monitor
 * can alert on differently from a network failure.
 *
 * This module builds the answer that replaces it. Three rules govern it:
 *
 *   1. **NOTHING ABOUT THE FAILURE CROSSES.** No message, no stack, no upstream
 *      body, no URL query, no cookie, no identifier. A reader gets a sentence and
 *      a closed code; the code names a CLASS of failure and nothing about this
 *      request. A failure page that quotes its own exception is a failure page
 *      that leaks whatever the exception happened to be holding.
 *   2. **IT FAILS CLOSED.** It serves no data, sets no cookie, and never falls
 *      back to a cached, legacy or empty rendering of what the reader asked for.
 *      «Unavailable» must never be mistakable for «empty».
 *   3. **IT IS HONEST ABOUT BEING TEMPORARY.** HTTP 503 with `Retry-After`, so a
 *      monitor, a crawler and a person all read the same thing.
 */

/** Every failure this boundary is allowed to name. Closed on purpose. */
export const RUNTIME_FAILURE_CODES = [
  /** The Worker's own fetch handler rejected — what Cloudflare would answer 1101 for. */
  "worker_unhandled",
  /** The edge middleware rejected before any page ran. */
  "middleware_unhandled",
  /** The session could not be verified because the auth service did not answer. */
  "session_unverifiable",
  /** The session check was still running when its bound expired. */
  "session_timeout",
  /** A request-time module load failed. */
  "module_load_failed",
  /** Studio's role read failed or was refused, so nobody could say who is asking. */
  "authorization_unverifiable",
  /** Studio's role read was still running when its bound expired. */
  "authorization_timeout",
  /** A sign-in attempt did not reach an answer from the auth service. */
  "sign_in_unverifiable",
  /** A sign-in attempt was still running when its bound expired. */
  "sign_in_timeout",
] as const;

export type RuntimeFailureCode = (typeof RUNTIME_FAILURE_CODES)[number];

/**
 * The route CLASS, never the route. `/studio/e/<uuid>/revision` is a study
 * identifier in a log line; `studio` is not.
 *
 * ⓘ That keeps the identifier out of THIS line. It is not what keeps it out of
 * Workers Logs as a whole: Cloudflare's automatic INVOCATION log records every
 * request's method and full URL when it is on, which is why `wrangler.toml`
 * asks for invocation logs off (Unit 6B.4B2P).
 */
export type RouteClass = "health" | "auth" | "studio" | "insights" | "admin" | "api" | "other";

export function routeClass(pathname: string): RouteClass {
  if (pathname.startsWith("/api/health")) return "health";
  if (pathname.startsWith("/login")) return "auth";
  if (pathname.startsWith("/studio")) return "studio";
  if (pathname.startsWith("/insights")) return "insights";
  if (pathname.startsWith("/admin")) return "admin";
  if (pathname.startsWith("/api/")) return "api";
  return "other";
}

/** Does this path expect JSON rather than a document? */
export function expectsJson(pathname: string): boolean {
  return pathname.startsWith("/api/");
}

const RETRY_AFTER_SECONDS = 15;

/**
 * The page a person gets. Deliberately self-contained: no script, no stylesheet,
 * no font and no image, because every one of those is another request that can
 * fail in the same moment as the one that brought the reader here.
 */
function documentBody(code: RuntimeFailureCode): string {
  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Be Community · no disponible por ahora</title>
<style>
  :root { color-scheme: light }
  body { margin:0; min-height:100vh; display:flex; align-items:center; justify-content:center;
         background:#f6f6f4; color:#232321;
         font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif }
  main { max-width:34rem; padding:2rem 1.5rem; }
  h1 { font-size:1.35rem; margin:0 0 .75rem; }
  p { margin:0 0 .75rem; line-height:1.55; font-size:1rem; }
  code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size:.85rem; color:#6b6b66 }
</style>
</head>
<body>
<main>
  <h1>No podemos mostrarte esto ahora mismo</h1>
  <p>Algo de lo que esta pantalla necesita no respondió. No es un problema con tu sesión y no se
     perdió nada de tu trabajo.</p>
  <p>Vuelve a intentarlo en unos segundos. Si sigue igual, avisa a Be Community.</p>
  <p><code>${code}</code></p>
</main>
</body>
</html>`;
}

/**
 * Builds the controlled answer. It takes a CODE, never an error: the caller
 * classifies, and nothing derived from the thrown value can reach the reader.
 */
export function unavailableResponse(code: RuntimeFailureCode, pathname: string): Response {
  const headers: Record<string, string> = {
    "cache-control": "no-store",
    "retry-after": String(RETRY_AFTER_SECONDS),
    "x-becommunity-unavailable": code,
  };
  if (expectsJson(pathname)) {
    return new Response(
      JSON.stringify({ status: "unavailable", code, retryAfterSeconds: RETRY_AFTER_SECONDS }),
      { status: 503, headers: { ...headers, "content-type": "application/json; charset=utf-8" } },
    );
  }
  return new Response(documentBody(code), {
    status: 503,
    headers: { ...headers, "content-type": "text/html; charset=utf-8" },
  });
}

/**
 * The HTTP method, from a closed list. A method is chosen by the CLIENT, so an
 * arbitrary token — or a long string built to smuggle something into a log —
 * is recorded as `OTHER`, never as itself.
 */
export const LOGGED_METHODS = ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"] as const;
export type LoggedMethod = (typeof LOGGED_METHODS)[number] | "OTHER";

export function normalizeMethod(method: string): LoggedMethod {
  const upper = typeof method === "string" ? method.toUpperCase() : "";
  return (LOGGED_METHODS as readonly string[]).includes(upper) ? (upper as LoggedMethod) : "OTHER";
}

/**
 * ONE STRUCTURED LINE, AND ONLY WHAT A CLOSED VOCABULARY ALLOWS.
 *
 * Workers Logs records `console` output, and this is the whole of the runtime
 * instrumentation THIS CODE adds: no new route, no new binding, no new
 * variable. What THIS LINE may carry is fixed here rather than at each call
 * site — a code, a route class, an HTTP method from a closed list, and a
 * correlation id the SERVER generates. A path, a query, a cookie, a token, an
 * email, a study id, a database message and a stack trace are absent from it by
 * construction: `pathname` is accepted only to derive the route class and is
 * never written, and none of the others is a parameter.
 *
 * ⚠️ CORRECTED IN UNIT 6B.4B2P. This comment used to call the line «the whole of
 * the runtime instrumentation» and say «none of them is a parameter». Both
 * overclaimed. `pathname` IS a parameter. And this line is only what THIS CODE
 * writes: were `[observability] enabled = true` applied to the Worker,
 * Cloudflare's INVOCATION log would record every request's method and full URL
 * beside it — `wrangler.toml` now sets `invocation_logs = false` for that — and
 * libraries and the framework write their own console output regardless
 * (`@supabase/auth-js` logs every failed auth fetch's raw rejection; Next logs an
 * error thrown while rendering, with its stack). Observability is a
 * script-level, non-versioned setting: none of it takes effect until a deploy.
 */
export function recordRuntimeFailure(input: {
  code: RuntimeFailureCode;
  pathname: string;
  method: string;
  /** Milliseconds from the start of the request, when the caller knows it. */
  elapsedMs?: number;
}): string {
  const correlationId = crypto.randomUUID();
  const line = {
    event: "runtime_failure",
    code: input.code,
    routeClass: routeClass(input.pathname),
    method: normalizeMethod(input.method),
    correlationId,
    ...(typeof input.elapsedMs === "number" ? { elapsedMs: Math.round(input.elapsedMs) } : {}),
  };
  try {
    console.error(JSON.stringify(line));
  } catch {
    // A logger that throws must not become the failure it was reporting.
  }
  return correlationId;
}
