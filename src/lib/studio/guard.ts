import "server-only";

import { redirect } from "next/navigation";
import { recordRuntimeFailure } from "@/lib/runtime/unavailable";
import { decideInternalAccess, type InternalAccessDecision } from "@/lib/studio/internal-access";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { withinDeadline } from "@/lib/upstream/bounded-fetch";
import { classifyRead, classifySession, type ReadOutcome } from "@/lib/upstream/outcome";

/**
 * The whole session check, including any token refresh auth-js decides to
 * retry. Each attempt is already bounded by the client's fetch; this bounds the
 * OPERATION, so a reader is answered in seconds rather than after a retry loop.
 */
const SESSION_CHECK_DEADLINE_MS = 9_000;

/**
 * Studio could not find out who is asking. Thrown, never returned, so no page
 * can mistake it for a result; it renders `src/app/studio/error.tsx`. Its
 * message is a closed CODE and nothing from any upstream.
 */
export class InternalAccessUnavailableError extends Error {
  constructor(readonly code: Extract<InternalAccessDecision, { kind: "unavailable" }>["code"]) {
    super(code);
    this.name = "InternalAccessUnavailableError";
  }
}

/**
 * The server-side gate every `/studio/**` route runs, first, before it reads
 * anything (P8.2).
 *
 * It is the SAME check the `/admin/**` pages already perform, in one place:
 * the session is revalidated with `getUser()` — never `getSession()` — and the
 * role is read from the database, not from a header, a cookie or a claim.
 *
 * IT REDIRECTS FOR A VERDICT AND REFUSES FOR AN OUTAGE. A signed-out reader goes
 * to `/login` and a wrong-role caller to `/dashboard`, never to a rendered
 * denial page: a status-level denial is something the adversarial harness can
 * classify. But «the auth service did not answer» and «the role read failed»
 * are not verdicts about the person, and since Unit 6B.4B2P they are no longer
 * dressed as one: they record a closed code and render Studio's own error
 * state. Every one of those branches still refuses.
 *
 * Both clients handed out here are BOUNDED (`src/lib/upstream/bounded-fetch.ts`):
 * a hung read ends as an error the loaders already report, not as a page that
 * never answers.
 *
 * The admin client is created only AFTER the role check succeeds, so no
 * privileged client exists on a request that was never authorized.
 */
export async function requireInternal() {
  const supabase = await createClient();
  const attempt = await withinDeadline(supabase.auth.getUser(), SESSION_CHECK_DEADLINE_MS);
  const session = classifySession(attempt.settled ? attempt.value : null);
  const user = attempt.settled ? attempt.value.data.user : null;

  let profileOutcome: ReadOutcome | null = null;
  let profile: { role: string } | null = null;
  if (session === "authenticated" && user) {
    // A LIST, not `single` or `maybeSingle`. «No profile row» is an answer (not
    // internal) and must not arrive as the same shape a failed read does:
    // `single` turns it into an error, and `maybeSingle` resolves an EMPTY-BODY
    // 2xx to the same `data: null` as a real miss. Only an array proves the
    // database answered. `user_id` is the key, so a second row is not an answer
    // either — it fails closed as unverifiable.
    const read = await supabase
      .from("profiles")
      .select("role")
      .eq("user_id", user.id)
      .limit(2)
      .returns<{ role: string }[]>();
    profileOutcome = classifyRead(read, "many");
    if (profileOutcome === "ok" && read.data?.length !== 1) profileOutcome = "upstream_failure";
    profile = profileOutcome === "ok" && read.data ? read.data[0] : null;
  }

  const decision = decideInternalAccess(session, profileOutcome, profile?.role);
  if (decision.kind === "unauthenticated") redirect("/login");
  if (decision.kind === "unavailable") {
    recordRuntimeFailure({ code: decision.code, pathname: "/studio", method: "GET" });
    throw new InternalAccessUnavailableError(decision.code);
  }
  if (decision.kind !== "internal" || !user || profile?.role !== "internal") redirect("/dashboard");

  return { user, supabase, admin: createAdminClient({ bounded: true }) };
}
