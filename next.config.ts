import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
};

export default nextConfig;

// Enables Cloudflare bindings / OpenNext context during `next dev`
// (`getCloudflareContext()`); a no-op for the production build.
import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";
initOpenNextCloudflareForDev();
