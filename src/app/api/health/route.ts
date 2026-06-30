import { NextResponse } from "next/server";

// Health / anti-pause endpoint (§9.1). Uptime Robot pings this every ~5 minutes;
// the Supabase touch generates the activity that keeps the free-tier project from
// auto-pausing after 7 idle days. Returns 503 if Supabase is unreachable so the
// monitor can also alert on a real outage.
//
// Uses only the public anon key — no secret here, safe to expose.
export const dynamic = "force-dynamic";
// Cloudflare Pages requires the Edge runtime for non-static routes.
export const runtime = "edge";

export async function GET() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  let supabaseReachable = false;
  try {
    // GoTrue health endpoint: a real, lightweight request to the project.
    const res = await fetch(`${url}/auth/v1/health`, {
      headers: { apikey: anon ?? "" },
      signal: AbortSignal.timeout(5000),
      cache: "no-store",
    });
    supabaseReachable = res.ok;
  } catch {
    supabaseReachable = false;
  }

  return NextResponse.json(
    { status: supabaseReachable ? "ok" : "degraded", supabase: supabaseReachable, ts: new Date().toISOString() },
    { status: supabaseReachable ? 200 : 503, headers: { "cache-control": "no-store" } },
  );
}
