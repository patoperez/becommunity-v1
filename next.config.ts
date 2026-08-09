import type { NextConfig } from "next";

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
  async headers() {
    return [{ source: "/(.*)", headers: securityHeaders }];
  },
};

export default nextConfig;

// Enables Cloudflare bindings / OpenNext context during `next dev`
// (`getCloudflareContext()`); a no-op for the production build.
import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";
initOpenNextCloudflareForDev();
