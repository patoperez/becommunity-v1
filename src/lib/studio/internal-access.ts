/**
 * WHO MAY OPEN STUDIO, DECIDED FROM WHAT WAS ACTUALLY LEARNED.
 *
 * `requireInternal()` asks two questions — is there a verified session, and is
 * that person internal — and until Unit 6B.4B2P it read only the happy half of
 * each answer. A session check the auth service never answered redirected to
 * `/login` exactly like a signed-out visitor; a role read that failed, timed
 * out or was refused redirected to `/dashboard` exactly like a client. Both
 * failed closed, which is right. Both also turned an OUTAGE into a VERDICT about
 * the person, and neither left a trace.
 *
 * This is the decision on its own, with no I/O, so the gate executes it:
 *
 *   * «nobody is signed in»          → `unauthenticated` (redirect to /login)
 *   * «signed in, and not internal»  → `not_internal`    (redirect to /dashboard)
 *     — including «no profile row», which is what it always meant;
 *   * «we could not find out»        → `unavailable`, with a closed code. The
 *     caller renders Studio's own error state and creates NO privileged client.
 *
 * Nothing here widens access. Every branch that is not `internal` refuses.
 */

import type { RuntimeFailureCode } from "@/lib/runtime/unavailable";
import type { ReadOutcome, SessionOutcome } from "@/lib/upstream/outcome";

export type InternalAccessDecision =
  | { kind: "internal" }
  | { kind: "unauthenticated" }
  | { kind: "not_internal" }
  | { kind: "unavailable"; code: Extract<RuntimeFailureCode, "session_timeout" | "session_unverifiable" | "authorization_timeout" | "authorization_unverifiable"> };

/**
 * @param session  how the session check ended
 * @param profile  how the role read ended, or `null` when it was not attempted
 * @param role     the role the read returned, when it returned one
 */
export function decideInternalAccess(
  session: SessionOutcome,
  profile: ReadOutcome | null,
  role: unknown,
): InternalAccessDecision {
  switch (session) {
    case "unauthenticated":
      return { kind: "unauthenticated" };
    case "timeout":
    case "cancelled":
      return { kind: "unavailable", code: "session_timeout" };
    case "upstream_failure":
      return { kind: "unavailable", code: "session_unverifiable" };
    case "authenticated":
      break;
  }
  switch (profile) {
    case "ok":
      return role === "internal" ? { kind: "internal" } : { kind: "not_internal" };
    case "empty":
      return { kind: "not_internal" };
    case "timeout":
    case "cancelled":
      return { kind: "unavailable", code: "authorization_timeout" };
    // A refusal to read one's OWN profile a moment after the session was
    // verified says nothing about the role; it is a failure to find out.
    case "authorization_refused":
    case "upstream_failure":
    case null:
      return { kind: "unavailable", code: "authorization_unverifiable" };
  }
}
