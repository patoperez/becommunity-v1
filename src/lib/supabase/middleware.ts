import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Build the Content-Security-Policy (§5.2). Nonce-based `script-src` with
 * `strict-dynamic` (the Next-supported pattern — Next stamps the nonce onto its
 * own inline/bootstrap scripts when it sees this CSP on the request headers).
 * `connect-src` whitelists ONLY the Supabase project origin (derived from env,
 * never hardcoded) plus 'self' — nothing broader.
 */
function buildCsp(nonce: string): string {
  let supabaseOrigin = "";
  try {
    supabaseOrigin = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").origin;
  } catch {
    supabaseOrigin = "";
  }
  const connectSrc = ["'self'", supabaseOrigin].filter(Boolean).join(" ");
  return [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`,
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' data: ${supabaseOrigin}`.trim(),
    "font-src 'self'",
    `connect-src ${connectSrc}`,
    "frame-ancestors 'none'",
    "form-action 'self'",
  ].join("; ");
}

/**
 * Refreshes the Supabase session on every request and enforces a first gate of
 * route protection. This is ONE layer of defense (§6.4): every protected Server
 * Component must independently re-check auth — never trust the middleware alone.
 *
 * It also mints the per-request CSP nonce and attaches the Content-Security-
 * Policy (§5.2). The nonce is set on the REQUEST headers so Next applies it to
 * its own scripts, and the CSP is set on the response that renders the document.
 */
export async function updateSession(request: NextRequest) {
  // Per-request CSP nonce (16 random bytes, base64). getRandomValues + btoa work
  // on the Edge runtime (Buffer is not guaranteed there).
  const nonce = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(16))));
  const csp = buildCsp(nonce);

  // Forward the nonce + CSP to the app via request headers so Next can read them.
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("content-security-policy", csp);

  let supabaseResponse = NextResponse.next({ request: { headers: requestHeaders } });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          supabaseResponse = NextResponse.next({ request: { headers: requestHeaders } });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  // getUser() revalidates the JWT against the Supabase Auth server. NEVER use
  // getSession() for an authorization decision — it only decodes the cookie and
  // can be spoofed. This is the core of "defense in depth" (§6.4).
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;
  const isAuthRoute = pathname.startsWith("/login");
  // /api/health is the public anti-pause endpoint (§9.1) — Uptime Robot must
  // reach it without a session.
  const isPublicRoute = isAuthRoute || pathname === "/" || pathname.startsWith("/api/health");

  if (!user && !isPublicRoute) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  if (user && isAuthRoute) {
    const url = request.nextUrl.clone();
    url.pathname = "/dashboard";
    return NextResponse.redirect(url);
  }

  // Attach the CSP to the document response (the nonce it carries matches the one
  // Next stamped onto its scripts via the request header above).
  supabaseResponse.headers.set("content-security-policy", csp);
  return supabaseResponse;
}
