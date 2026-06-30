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
 */
export function createAdminClient() {
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceRoleKey) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY is not set");
  }

  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    serviceRoleKey,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
}
