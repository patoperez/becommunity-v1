import "server-only";

import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

/**
 * The server-side gate every `/studio/**` route runs, first, before it reads
 * anything (P8.2).
 *
 * It is the SAME check the `/admin/**` pages already perform, in one place:
 * the session is revalidated with `getUser()` — never `getSession()` — and the
 * role is read from the database, not from a header, a cookie or a claim.
 *
 * IT ALWAYS REDIRECTS. A wrong-role caller is answered with a redirect to
 * `/dashboard`, never with a rendered denial page: a status-level denial is
 * something the adversarial harness can classify, and one path class already
 * answers with HTTP 200 and a rendered panel, which is a limitation the suite
 * has to state rather than a pattern to copy.
 *
 * The admin client is created only AFTER the role check succeeds, so no
 * privileged client exists on a request that was never authorized.
 */
export async function requireInternal() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("user_id", user.id)
    .single<{ role: string }>();
  if (profile?.role !== "internal") redirect("/dashboard");

  return { user, supabase, admin: createAdminClient() };
}
