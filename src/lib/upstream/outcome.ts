/**
 * WHAT A SUPABASE ANSWER MEANT, IN A CLOSED VOCABULARY.
 *
 * Supabase's clients return failure as a value, and they return several
 * different facts in the same shape:
 *
 *   * `auth.getUser()` answers `{ user: null, error }` both for «nobody is
 *     signed in» and for «the auth service did not answer»;
 *   * `signInWithPassword()` answers an `error` both for a wrong password and
 *     for a refused connection;
 *   * a PostgREST read answers `{ data: null }` for «there is no row», for a
 *     404 with an empty body, and — with `error` set — for a refusal, a timeout
 *     and a dead connection.
 *
 * A caller that reads only `data` or only `user` turns an OUTAGE into an
 * ANSWER: a stranger, an invalid password, an empty study. These functions keep
 * the facts apart so each caller can fail closed in the right direction and say
 * something true. They read an error's name, status, code and message to
 * CLASSIFY it; nothing they return carries any of that text.
 *
 * The shapes are the installed libraries' (`@supabase/auth-js`,
 * `@supabase/postgrest-js` 2.108.2), and `npm run test:upstream-bounds` drives
 * the real clients against a local stand-in to prove each classification rather
 * than restating it.
 */

import { UPSTREAM_CANCELLED_MESSAGE, UPSTREAM_TIMEOUT_MESSAGE } from "./bounded-fetch";

export type SessionOutcome = "authenticated" | "unauthenticated" | "timeout" | "cancelled" | "upstream_failure";
export type SignInOutcome = "signed_in" | "invalid_credentials" | "timeout" | "cancelled" | "upstream_failure";
export type ReadOutcome = "ok" | "empty" | "authorization_refused" | "timeout" | "cancelled" | "upstream_failure";

/** The runtime shapes the classifiers read. Nothing here is ever returned. */
function field(value: unknown, key: string): unknown {
  return value !== null && typeof value === "object" ? (value as Record<string, unknown>)[key] : undefined;
}
function text(value: unknown, key: string): string {
  const found = field(value, key);
  return typeof found === "string" ? found : "";
}
function statusOf(value: unknown): number | null {
  const found = field(value, "status");
  return typeof found === "number" && Number.isFinite(found) ? found : null;
}

/**
 * An abort this application's bound produced, or an abort by name. The bound's
 * sentinel wins over the name, because auth-js renames every rejection.
 */
function abortKind(error: unknown): "timeout" | "cancelled" | null {
  const message = text(error, "message");
  if (message.includes(UPSTREAM_TIMEOUT_MESSAGE)) return "timeout";
  if (message.includes(UPSTREAM_CANCELLED_MESSAGE)) return "cancelled";
  const name = text(error, "name");
  if (name === "TimeoutError") return "timeout";
  if (name === "AbortError") return "cancelled";
  return null;
}

/** Errors that mean the auth service was not reached, or answered in a shape nobody can read. */
const AUTH_TRANSPORT_ERRORS = new Set(["AuthRetryableFetchError", "AuthUnknownError", "AuthInvalidTokenResponseError"]);

/**
 * WAS THIS 4xx A VERDICT FROM THE AUTH SERVICE ITSELF?
 *
 * GoTrue always names its refusals: `{ "code": "invalid_credentials" }` or
 * `{ "code": "bad_jwt" }` under the API version auth-js asks for, and
 * `error_code` without it — measured against the hosted project in Unit 6B.4B2P
 * — and auth-js carries that name on the error as `code`. The platform GATEWAY
 * in front of it does not: a revoked or wrong API key answers
 * `401 {"message":"Invalid API key"}` with no code at all. That is an outage of
 * configuration, and reading it as «wrong password» or «signed out» is exactly
 * the conflation this module exists to prevent. A 429 is a throttle, never a
 * verdict, whatever it carries.
 */
function isAuthVerdict(error: unknown): boolean {
  const status = statusOf(error);
  if (status === null || status < 400 || status >= 500 || status === 429) return false;
  return text(error, "code") !== "";
}

/**
 * The session check. `null` means the check did not finish inside its deadline.
 *
 * A named 4xx from the auth service is the service saying the token is not good
 * — an ordinary «not signed in», as is having no session to check at all.
 */
export function classifySession(attempt: { data: { user: unknown }; error: unknown } | null): SessionOutcome {
  if (attempt === null) return "timeout";
  if (attempt.data?.user) return "authenticated";
  const error = attempt.error;
  if (error === null || error === undefined) return "unauthenticated";
  const aborted = abortKind(error);
  if (aborted) return aborted;
  const name = text(error, "name");
  if (name === "AuthSessionMissingError" || name === "AuthInvalidJwtError") return "unauthenticated";
  if (AUTH_TRANSPORT_ERRORS.has(name)) return "upstream_failure";
  return isAuthVerdict(error) ? "unauthenticated" : "upstream_failure";
}

/**
 * The sign-in attempt. Only a named 4xx from the auth service is a statement
 * about the credentials; everything else is a statement about the
 * infrastructure, and telling a person their password is wrong during an outage
 * is simply false.
 */
export function classifySignIn(error: unknown): SignInOutcome {
  if (error === null || error === undefined) return "signed_in";
  const aborted = abortKind(error);
  if (aborted) return aborted;
  const name = text(error, "name");
  if (name === "AuthInvalidCredentialsError") return "invalid_credentials";
  if (AUTH_TRANSPORT_ERRORS.has(name)) return "upstream_failure";
  return isAuthVerdict(error) ? "invalid_credentials" : "upstream_failure";
}

/**
 * A PostgREST read, as the builder resolved it (`{ data, error, status }`).
 *
 *   * `one` — `.single()`: a row is required; «no row» is a refusal of 0 rows.
 *   * `optional_one` — `.maybeSingle()`: «no row» is data null with no error.
 *     ⓘ postgrest-js ALSO resolves a 2xx with an EMPTY BODY to data null with
 *     no error, so this expectation cannot tell «no row» from «no answer». Use
 *     it only where that difference cannot change a decision; read a LIST
 *     (`many`) where it can — `requireInternal()` does.
 *   * `many` — a list: an empty array is empty, anything else is not a list.
 *
 * «Empty» is returned ONLY when the database answered and the answer was
 * nothing. A 404 with an empty body (which postgrest-js reports as status 204
 * with no error and no data) is not an answer from PostgREST, and it is never
 * reported as empty.
 */
export function classifyRead(
  result: { data: unknown; error: unknown; status: number },
  expect: "one" | "optional_one" | "many",
): ReadOutcome {
  const { data, error, status } = result;
  if (error !== null && error !== undefined) {
    const aborted = abortKind(error);
    if (aborted) return aborted;
    const code = text(error, "code");
    if (expect === "one" && code === "PGRST116" && /\b0 rows\b/.test(text(error, "details"))) return "empty";
    if (status === 401 || status === 403 || /^(?:42501|PGRST301|PGRST302|PGRST303)$/.test(code)) {
      return "authorization_refused";
    }
    return "upstream_failure";
  }
  if (status === 204 || status < 200 || status >= 300) return "upstream_failure";
  if (expect === "many") {
    if (!Array.isArray(data)) return "upstream_failure";
    return data.length === 0 ? "empty" : "ok";
  }
  if (data === null || data === undefined) return expect === "optional_one" ? "empty" : "upstream_failure";
  if (Array.isArray(data) || typeof data !== "object") return "upstream_failure";
  return "ok";
}
