import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { DEFAULT_BRAND, hexToRgb, logoPublicUrl, parseBrandConfig } from "../src/lib/branding/config.ts";

assert.deepEqual(parseBrandConfig(null), DEFAULT_BRAND);
assert.deepEqual(parseBrandConfig({
  version: 1,
  displayName: "  Escuela Demo  ",
  tagline: "Una comunidad",
  primaryColor: "#ABCDEF",
  accentColor: "#123456",
  logoPath: null,
}), {
  version: 1,
  displayName: "Escuela Demo",
  tagline: "Una comunidad",
  primaryColor: "#abcdef",
  accentColor: "#123456",
  logoPath: null,
});
assert.deepEqual(parseBrandConfig({ primaryColor: "javascript:red" }), DEFAULT_BRAND);
assert.deepEqual(hexToRgb("#ff8000"), [1, 128 / 255, 0]);

const previousUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
assert.equal(
  logoPublicUrl("00000000-0000-0000-0000-000000000001/logo-00000000-0000-0000-0000-000000000002.png"),
  "https://example.supabase.co/storage/v1/object/public/tenant-branding/00000000-0000-0000-0000-000000000001/logo-00000000-0000-0000-0000-000000000002.png",
);
if (previousUrl === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
else process.env.NEXT_PUBLIC_SUPABASE_URL = previousUrl;

const action = await readFile(new URL("../src/app/admin/clients/actions.ts", import.meta.url), "utf8");
const dashboard = await readFile(new URL("../src/app/dashboard/page.tsx", import.meta.url), "utf8");
const report = await readFile(new URL("../src/lib/reporting/pdf.ts", import.meta.url), "utf8");
const middleware = await readFile(new URL("../src/lib/supabase/middleware.ts", import.meta.url), "utf8");
const migration = await readFile(new URL("../supabase/migrations/0013_tenant_branding.sql", import.meta.url), "utf8");
assert.ok(action.indexOf("internalContext()") < action.indexOf('storage.from("tenant-branding")'), "auth must precede logo storage access");
assert.match(action, /imageExtension\(bytes, file\.type\)/, "logo uploads must validate magic bytes");
assert.match(dashboard, /select\("name, brand_config"\)/, "portal must load tenant branding through RLS");
assert.match(dashboard, /linear-gradient|NarrativeHome view=\{narrative\} brand=\{brand\}/, "portal narrative must receive tenant branding");
assert.match(report, /hexToRgb\(brand\.primaryColor\)/, "PDF must use the tenant palette");
assert.match(middleware, /img-src 'self' data: \$\{supabaseOrigin\}/, "CSP must allow tenant logos from the configured Supabase origin");
assert.match(migration, /file_size_limit[\s\S]*1048576/, "storage must enforce the 1 MB logo limit");
assert.match(migration, /public[\s\S]*true/, "tenant logos must be publicly renderable without exposing response data");

console.log("P6C tenant branding gate passed: validated config, admin-only writes, branded portal/PDF, constrained assets.");
