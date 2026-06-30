import { createBrowserClient } from "@supabase/ssr";

/**
 * Browser Supabase client. Uses the ANON public key.
 *
 * SECURITY (Section 6.3): the anon key is safe in the browser ONLY because
 * Row Level Security is enabled on every table in the public schema. Without
 * RLS this key grants full read/write access (the Moltbook incident, §6.1).
 */
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
