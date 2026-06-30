import { defineCloudflareConfig } from "@opennextjs/cloudflare";

// OpenNext Cloudflare adapter config. Defaults are sufficient for Be Community:
// the Next.js server runs on the Node.js runtime inside a Cloudflare Worker, so
// Node-based libraries (exceljs for .xlsx parsing) work in production.
//
// Optional add-ons (incremental cache, tag cache, durable-object queue) can be
// wired here later; not needed for v1.
export default defineCloudflareConfig({});
