import { defineCloudflareConfig } from "@opennextjs/cloudflare";

// OpenNext Cloudflare adapter config. Defaults are sufficient for Be Community:
// the Next.js server runs on the Node.js runtime inside a Cloudflare Worker.
//
// NOTE: that does NOT mean every Node library works. workerd polyfills Node with
// unenv, whose unimplemented APIs throw — ExcelJS's Node entry hits a
// module-level process.umask() (unzipper -> fstream) and is fatal here. Verify
// new Node dependencies under real workerd; see src/lib/ingestion/parse.ts.
//
// Optional add-ons (incremental cache, tag cache, durable-object queue) can be
// wired here later; not needed for v1.
export default defineCloudflareConfig({});
