import "server-only";
import { createClient } from "@supabase/supabase-js";

/**
 * Admin Supabase client using the SERVICE_ROLE key. BYPASSES ALL RLS (§6.3).
 *
 * - Only ever import this from server code (the "server-only" guard above
 *   throws at build time if it leaks into a client bundle).
 * - Use exclusively for explicit internal/administrative operations
 *   (Be Community staff provisioning tenants, ingesting data, etc.).
 * - Never expose the key via NEXT_PUBLIC_*.
 *
 * WHERE THE KEY COMES FROM. In the Cloudflare Worker this is an encrypted
 * runtime secret. The OpenNext adapter copies every Worker binding into
 * `process.env` before the first request handler runs, and it does so BEFORE
 * applying the build-time `.env` snapshot, so the runtime secret is what this
 * reads and a build-time value could never override it. The build must not
 * carry this variable at all: `npm run test:secrets` fails if the name appears
 * in the compiled env snapshot. See wrangler.toml and docs/DEPLOYMENT.md.
 */
export function createAdminClient() {
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceRoleKey) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY is not set");
  }
  // A publishable/anon key here would not fail — it would quietly build a
  // client with NO privileges, and every administrative read would come back
  // empty as though the data did not exist. Refuse the confusion outright.
  if (serviceRoleKey.startsWith("sb_publishable_")) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY holds a publishable key, not a secret key");
  }

  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    serviceRoleKey,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
}
