import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

import { boundedFetch } from "@/lib/upstream/bounded-fetch";

/**
 * Server-side Supabase client bound to the request cookies. Uses the ANON key
 * and the authenticated user's session, so RLS policies (tenant isolation,
 * Section 6.2) still apply. Use this for all user-facing server code.
 *
 * EVERY AUTH AND POSTGREST CALL IT MAKES IS BOUNDED. This client serves the
 * sign-in action, `requireInternal()` and every page that reads as the reader,
 * and until Unit 6B.4B2P none of those calls had a time limit: a hung auth
 * service held a sign-in open indefinitely, and a hung PostgREST held a page
 * with no answer at all. The bound is on the client's own `fetch`, so a call
 * added later inherits it. It changes no authorization and no RLS: the same
 * key, the same session, the same requests — with an end.
 *
 * `signal` — ONE REQUEST'S OWN CANCELLATION (Unit 6B.4B2Q). A caller that bounds
 * a whole OPERATION rather than one attempt passes `upstreamOperation().signal`
 * here, so expiring that operation cancels the call in flight and refuses the
 * next retry instead of leaving abandoned work running. It is created per
 * request and never shared; omitting it leaves the per-attempt bound alone,
 * exactly as before.
 */
export async function createClient(options: { signal?: AbortSignal } = {}) {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      global: { fetch: boundedFetch({ signal: options.signal }) },
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            // Called from a Server Component — safe to ignore when middleware
            // refreshes the session.
          }
        },
      },
    },
  );
}
