/**
 * THE ONE BOUND FOR USER-FACING CALLS TO SUPABASE AUTH AND POSTGREST.
 *
 * Unit 6B.4B2O bounded ONE call — the middleware's session check — and left
 * every other read unbounded. Its own fault injection recorded the result:
 * `hang /rest/v1 → 000000`, a review page that never answered at all. This
 * module is the policy that replaces the one-off. A client adopts it through
 * `global.fetch`, so a call a library adds later inherits the bound instead of
 * escaping it. WHICH clients adopt it is stated where they are made, not
 * assumed here: the reader's cookie client (`src/lib/supabase/server.ts`), the
 * middleware's, and every admin client created with `{ bounded: true }` — the
 * ones that READ to serve a page. Admin clients that commit imports, uploads or
 * publications stay unbounded on purpose; a limit on a long write abandons an
 * operation whose outcome is then unknown.
 *
 * FOUR RULES, EACH LEARNED FROM THE INSTALLED LIBRARIES RATHER THAN ASSUMED:
 *
 *   1. AN ABORT MUST BE NAMED `AbortError`. `@supabase/postgrest-js` 2.108.2
 *      re-throws a fetch rejection immediately only when its `name` is
 *      `AbortError`; anything else on a GET is treated as a network failure and
 *      RETRIED three times with 1, 2 and 4 s sleeps. `AbortSignal.timeout()`
 *      rejects with a `TimeoutError`, so the obvious bound quietly turns one hung
 *      read into four. Every abort here is a `DOMException` named `AbortError`.
 *   2. THE ABORT CARRIES A SENTINEL MESSAGE, and nothing else. `@supabase/auth-js`
 *      wraps every fetch rejection as `AuthRetryableFetchError` and keeps only
 *      the message, so the message is the one thing that survives to say
 *      «timeout» rather than «connection refused». No URL, header or upstream
 *      text is ever put in it.
 *   3. A CALLER'S OWN SIGNAL IS HONOURED. An already-aborted signal makes no
 *      request at all; a signal that aborts in flight cancels the request and is
 *      reported as a cancellation, never as a timeout.
 *   4. A `Retry-After` NOBODY CONTROLS IS CAPPED. postgrest-js sleeps for a
 *      503/520's `Retry-After` with no upper limit; a header of an hour would
 *      hold a page for an hour. Above the ceiling the header is dropped and the
 *      library falls back to its own short backoff.
 *
 * WHAT IT DOES NOT DO: it does not retry, it does not cache, it does not turn a
 * failure into data, and it bounds only `/auth/v1/` and `/rest/v1/` — storage
 * uploads and anything else pass through untouched.
 *
 * The timer stays armed after the response headers arrive, deliberately: the
 * body is read AFTER `fetch` resolves, and an upstream that sends headers and
 * then stalls is exactly as hung as one that sends nothing.
 *
 * It imports nothing, so the edge middleware, the Node server and the offline
 * gates execute the same code.
 */

/** Per-attempt bounds, by surface. Measured medians are ~1 s; these are ceilings, not targets. */
export const UPSTREAM_ATTEMPT_TIMEOUT_MS = { auth: 8_000, rest: 10_000 } as const;

/** The only text an abort from this module ever carries. */
export const UPSTREAM_TIMEOUT_MESSAGE = "becommunity:upstream_timeout";
export const UPSTREAM_CANCELLED_MESSAGE = "becommunity:upstream_cancelled";

/** Above this, an upstream's `Retry-After` is dropped rather than obeyed. */
export const RETRY_AFTER_CEILING_SECONDS = 2;

export type UpstreamSurface = keyof typeof UPSTREAM_ATTEMPT_TIMEOUT_MS;
type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

/** An abort postgrest-js recognises as an abort, carrying only a sentinel. */
export function upstreamAbort(kind: "timeout" | "cancelled"): DOMException {
  return new DOMException(kind === "timeout" ? UPSTREAM_TIMEOUT_MESSAGE : UPSTREAM_CANCELLED_MESSAGE, "AbortError");
}

function urlOf(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

/** Which bounded surface a request belongs to, or null when it is not bounded here. */
export function upstreamSurface(input: RequestInfo | URL): UpstreamSurface | null {
  let pathname: string;
  try {
    pathname = new URL(urlOf(input)).pathname;
  } catch {
    return null;
  }
  if (pathname.startsWith("/auth/v1/")) return "auth";
  if (pathname.startsWith("/rest/v1/")) return "rest";
  return null;
}

function withoutRunawayRetryAfter(response: Response): Response {
  if (response.status !== 503 && response.status !== 520) return response;
  const header = response.headers.get("retry-after");
  if (header === null) return response;
  const seconds = Number.parseInt(header, 10);
  if (Number.isFinite(seconds) && seconds >= 0 && seconds <= RETRY_AFTER_CEILING_SECONDS) return response;
  const headers = new Headers(response.headers);
  headers.delete("retry-after");
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

export function boundedFetch(
  options: { base?: FetchLike; timeoutMs?: Partial<Record<UpstreamSurface, number>> } = {},
): FetchLike {
  const base: FetchLike = options.base ?? ((input, init) => fetch(input, init));
  return async (input, init) => {
    const surface = upstreamSurface(input);
    if (surface === null) return base(input, init);

    const caller = init?.signal ?? null;
    if (caller?.aborted) throw upstreamAbort("cancelled");

    const controller = new AbortController();
    const onCallerAbort = () => controller.abort(upstreamAbort("cancelled"));
    caller?.addEventListener("abort", onCallerAbort, { once: true });

    const limit = options.timeoutMs?.[surface] ?? UPSTREAM_ATTEMPT_TIMEOUT_MS[surface];
    const timer = setTimeout(() => controller.abort(upstreamAbort("timeout")), limit);
    // A pending bound must never keep a Node process alive on its own.
    (timer as { unref?: () => void }).unref?.();

    try {
      const response = await base(input, { ...init, signal: controller.signal });
      return withoutRunawayRetryAfter(response);
    } catch (thrown) {
      clearTimeout(timer);
      caller?.removeEventListener("abort", onCallerAbort);
      if (controller.signal.aborted) {
        const reason: unknown = controller.signal.reason;
        throw reason instanceof DOMException && reason.name === "AbortError" ? reason : upstreamAbort("timeout");
      }
      throw thrown;
    }
  };
}

/**
 * A signal for a call this policy does not see — Storage passes through
 * `boundedFetch` untouched — that aborts the same way the policy does: an
 * `AbortError` carrying the timeout sentinel.
 */
export function upstreamDeadlineSignal(ms: number): AbortSignal {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(upstreamAbort("timeout")), ms);
  (timer as { unref?: () => void }).unref?.();
  return controller.signal;
}

/**
 * Bound a whole operation, not one attempt. `auth-js` retries a token refresh
 * for up to thirty seconds on its own, re-arming a fresh per-attempt bound each
 * time, so a per-attempt bound alone does not make a session check predictable.
 * The operation keeps running if it loses the race; the READER stops waiting.
 */
export async function withinDeadline<T>(
  work: PromiseLike<T>,
  ms: number,
): Promise<{ settled: true; value: T } | { settled: false }> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<{ settled: false }>((resolve) => {
    timer = setTimeout(() => resolve({ settled: false }), ms);
    (timer as { unref?: () => void }).unref?.();
  });
  const settled = Promise.resolve(work).then((value) => ({ settled: true as const, value }));
  try {
    return await Promise.race([settled, expired]);
  } finally {
    clearTimeout(timer);
    // The loser may still reject later; that rejection belongs to nobody.
    settled.catch(() => {});
  }
}
