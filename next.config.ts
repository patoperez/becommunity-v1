import type { NextConfig } from "next";

// A phone reaches the local dev server through the workstation's LAN address,
// not through `localhost`. Next blocks dev chunks from any unlisted origin, so
// the page would render its HTML but never hydrate: native selects/details kept
// working while React controls appeared dead. Keep this opt-in and development
// only; the comma-separated host list is supplied by the person running the
// local review and no private-network wildcard reaches production.
const allowedDevOrigins = process.env.DEV_ALLOWED_ORIGINS
  ?.split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

// Static security response headers (§5.2). Applied to every response so they
// cover assets and redirects too; the per-request CSP (with nonce) is set in the
// session middleware. X-Frame-Options + the CSP frame-ancestors together deny
// framing (anti-clickjacking).
const securityHeaders = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
  { key: "Permissions-Policy", value: "geolocation=(), camera=(), microphone=()" },
];

const nextConfig: NextConfig = {
  ...(allowedDevOrigins?.length ? { allowedDevOrigins } : {}),
  experimental: {
    serverActions: {
      // Upload validation below still enforces the exact 10 MiB product limit.
      // Leave a small multipart envelope margin so valid files reach the action.
      bodySizeLimit: "11mb",
    },
  },
  async headers() {
    return [{ source: "/(.*)", headers: securityHeaders }];
  },
};

export default nextConfig;

// Enables Cloudflare bindings / OpenNext context during `next dev`
// (`getCloudflareContext()`); a no-op for the production build.
import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";
initOpenNextCloudflareForDev();
