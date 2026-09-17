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
 * FIVE RULES, EACH LEARNED FROM THE INSTALLED LIBRARIES RATHER THAN ASSUMED:
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
 *   5. THE BOUND ENDS WHEN THE ANSWER DOES. ⚠️ ADDED IN UNIT 6B.4B2Q: until this
 *      unit the timer and the caller's abort listener were released only on the
 *      FAILURE path, so every SUCCESSFUL call left a timer armed for the rest of
 *      its eight or ten seconds and a listener attached to a signal it no longer
 *      cared about. On a page that makes dozens of reads that is dozens of live
 *      timers per request, and an abort the caller raises after a call has
 *      already succeeded would still fire into it. The bound is now held PER
 *      PHASE — reaching the headers, then reading the body — and released at the
 *      end of each: at the headers, and again at the body's EOF, cancellation or
 *      failure. A response with no body, and a response whose body is never read
 *      at all, therefore hold nothing.
 *
 * WHAT IT DOES NOT DO: it does not retry, it does not cache, it does not turn a
 * failure into data, it never BUFFERS a body (the stream is wrapped, one chunk
 * at a time, so backpressure and cancellation still reach the upstream), and it
 * bounds only `/auth/v1/` and `/rest/v1/` — storage uploads and anything else
 * pass through untouched.
 *
 * A body that stalls after its headers is still bounded, deliberately: the body
 * is read AFTER `fetch` resolves, and an upstream that sends headers and then
 * stalls is exactly as hung as one that sends nothing. The bound for that is
 * armed by the FIRST read rather than by the headers, so it protects a reader
 * who is waiting and costs nothing when there is none.
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

/**
 * ONE REQUEST'S WHOLE CONVERSATION WITH ONE UPSTREAM.
 *
 * ⚠️ ADDED IN UNIT 6B.4B2Q. `withinDeadline()` used to stop WAITING for an
 * operation and say so plainly: «the operation keeps running if it loses the
 * race». That left the abandoned work in flight — a hung `getUser()` still
 * holding its socket, and `auth-js` still free to open the NEXT attempt of a
 * token refresh it had already been told nobody was waiting for. An operation
 * now carries its own signal into the client's `fetch`, so expiry CANCELS what
 * is in flight and refuses what has not started yet.
 *
 * ONE PER REQUEST, NEVER SHARED: an operation is created where a request is
 * handled, so expiring one can never cancel another reader's work.
 */
export type UpstreamOperation = {
  readonly signal: AbortSignal;
  /** The deadline passed: cancel the attempt in flight, and start no other. */
  expire(): void;
};

export function upstreamOperation(): UpstreamOperation {
  const controller = new AbortController();
  return {
    signal: controller.signal,
    expire() {
      if (!controller.signal.aborted) controller.abort(upstreamAbort("timeout"));
    },
  };
}

/** An abort we can hand to a library, from whatever a signal was aborted with. */
function abortOf(signal: AbortSignal, fallback: "timeout" | "cancelled"): DOMException {
  const reason: unknown = signal.reason;
  return reason instanceof DOMException && reason.name === "AbortError" ? reason : upstreamAbort(fallback);
}

/**
 * A copy of a response's headers. `Set-Cookie` is the one header that may appear
 * more than once, and constructing `Headers` from another `Headers` joins
 * repeats with a comma; this keeps them apart. (Neither bounded surface sets
 * cookies today — the gate pins the behaviour so that stays true by test rather
 * than by assumption.)
 */
function copyHeaders(source: Headers): Headers {
  const headers = new Headers(source);
  const getSetCookie = (source as { getSetCookie?: () => string[] }).getSetCookie;
  const cookies = typeof getSetCookie === "function" ? getSetCookie.call(source) : [];
  if (cookies.length > 1) {
    headers.delete("set-cookie");
    for (const cookie of cookies) headers.append("set-cookie", cookie);
  }
  return headers;
}

/** Is this a `Retry-After` nobody here controls, longer than the ceiling allows? */
function hasRunawayRetryAfter(response: Response): boolean {
  if (response.status !== 503 && response.status !== 520) return false;
  const header = response.headers.get("retry-after");
  if (header === null) return false;
  const seconds = Number.parseInt(header, 10);
  return !(Number.isFinite(seconds) && seconds >= 0 && seconds <= RETRY_AFTER_CEILING_SECONDS);
}

/** What a phase of one request holds while it is in progress. */
type Bound = {
  /** Arm the bound for this phase. Returns false when the request is already cancelled. */
  start(): boolean;
  /** Release everything this request holds. Idempotent. */
  stop(): void;
};

/**
 * The same body, one chunk at a time, that says when it begins and when it ends.
 *
 * It is a PULL source: nothing is read until the consumer asks, so the upstream
 * keeps its backpressure and no response is ever buffered. The bound is armed on
 * the FIRST read and released at EOF, on a read failure (including the bound's
 * own abort) and when the consumer cancels — the three ways a body can finish.
 *
 * ⓘ ARMED ON THE FIRST READ, NOT WHEN THE HEADERS ARRIVED. A body nobody ever
 * reads is not a hang: `@supabase/auth-js` throws `AuthRetryableFetchError` for a
 * 5xx BEFORE it calls `response.json()`, so on every auth outage the body is
 * abandoned unread — and a bound armed at the headers would sit there for the
 * rest of its eight seconds and then abort a request that had already finished.
 */
function watchedBody(body: ReadableStream<Uint8Array>, bound: Bound): ReadableStream<Uint8Array> {
  const reader = body.getReader();
  let reading = false;
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (!reading) {
        reading = true;
        // A false start means the caller already gave up; `reader.read()` then
        // rejects with that reason and the catch below reports it.
        bound.start();
      }
      try {
        const { done, value } = await reader.read();
        if (done) {
          bound.stop();
          controller.close();
          return;
        }
        controller.enqueue(value);
      } catch (thrown) {
        bound.stop();
        controller.error(thrown);
      }
    },
    cancel(reason) {
      bound.stop();
      return reader.cancel(reason);
    },
  },
  // `highWaterMark: 0` IS LOAD-BEARING. A default ReadableStream pulls one chunk
  // the moment it is constructed, to fill a queue of one — which would arm the
  // body's bound for a body nobody has asked for yet, and would read ahead from
  // the upstream. At zero, `pull` runs only when the consumer actually reads.
  { highWaterMark: 0 });
}

export function boundedFetch(
  options: {
    base?: FetchLike;
    timeoutMs?: Partial<Record<UpstreamSurface, number>>;
    /** The operation this client belongs to, when one request owns the whole conversation. */
    signal?: AbortSignal;
  } = {},
): FetchLike {
  const base: FetchLike = options.base ?? ((input, init) => fetch(input, init));
  return async (input, init) => {
    const surface = upstreamSurface(input);
    if (surface === null) return base(input, init);

    const caller = init?.signal ?? null;
    const operation = options.signal ?? null;
    // Neither of these makes a request. A caller who already gave up, and an
    // operation already past its deadline, are answered without touching the
    // network — which is what stops a retry loop from outliving its deadline.
    if (caller?.aborted) throw upstreamAbort("cancelled");
    if (operation?.aborted) throw abortOf(operation, "cancelled");

    const controller = new AbortController();
    const limit = options.timeoutMs?.[surface] ?? UPSTREAM_ATTEMPT_TIMEOUT_MS[surface];

    /*
      ONE BOUND, ARMED PER PHASE. A request has two: reaching the headers, and
      reading the body. `stop()` releases everything the current phase holds —
      the timer AND the listeners — and `start()` takes it again. Between the two
      phases the request holds NOTHING, which is what makes a response nobody
      reads cost nothing at all.
    */
    let timer: ReturnType<typeof setTimeout> | undefined;
    let listening = false;
    const bound: Bound = {
      start() {
        if (caller?.aborted) {
          controller.abort(upstreamAbort("cancelled"));
          return false;
        }
        if (operation?.aborted) {
          controller.abort(abortOf(operation, "cancelled"));
          return false;
        }
        if (!listening) {
          caller?.addEventListener("abort", onCallerAbort, { once: true });
          operation?.addEventListener("abort", onOperationAbort, { once: true });
          listening = true;
        }
        timer = setTimeout(() => {
          controller.abort(upstreamAbort("timeout"));
          bound.stop();
        }, limit);
        // A pending bound must never keep a Node process alive on its own.
        (timer as { unref?: () => void }).unref?.();
        return true;
      },
      stop() {
        clearTimeout(timer);
        timer = undefined;
        if (!listening) return;
        caller?.removeEventListener("abort", onCallerAbort);
        operation?.removeEventListener("abort", onOperationAbort);
        listening = false;
      },
    };
    function onCallerAbort() {
      controller.abort(upstreamAbort("cancelled"));
      bound.stop();
    }
    function onOperationAbort() {
      controller.abort(operation ? abortOf(operation, "cancelled") : upstreamAbort("cancelled"));
      bound.stop();
    }

    bound.start();
    try {
      const response = await base(input, { ...init, signal: controller.signal });
      // The first phase is over the moment the headers are here.
      bound.stop();
      const runaway = hasRunawayRetryAfter(response);
      // A response with no body (204, 304, a HEAD) is already complete.
      if (response.body === null) {
        if (!runaway) return response;
        const headers = copyHeaders(response.headers);
        headers.delete("retry-after");
        return new Response(null, { status: response.status, statusText: response.statusText, headers });
      }
      const headers = copyHeaders(response.headers);
      if (runaway) headers.delete("retry-after");
      // The body handed on is the DECODED stream, so the two headers that
      // describe the encoded one would be describing something else.
      headers.delete("content-encoding");
      headers.delete("content-length");
      return new Response(watchedBody(response.body, bound), {
        status: response.status,
        statusText: response.statusText,
        headers,
      });
    } catch (thrown) {
      bound.stop();
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
 * This bounds the whole OPERATION.
 *
 * ⚠️ CORRECTED IN UNIT 6B.4B2Q. This used to stop the WAIT and let the work run
 * on: «the operation keeps running if it loses the race; the READER stops
 * waiting». A caller that passes its `operation` now cancels the work as well —
 * the attempt in flight is aborted, and the next retry is refused before it
 * reaches the network. The abandoned promise's rejection is still absorbed here,
 * because by then nobody is listening for it.
 */
export async function withinDeadline<T>(
  work: PromiseLike<T>,
  ms: number,
  operation?: Pick<UpstreamOperation, "expire">,
): Promise<{ settled: true; value: T } | { settled: false }> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<{ settled: false }>((resolve) => {
    timer = setTimeout(() => {
      operation?.expire();
      resolve({ settled: false });
    }, ms);
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
