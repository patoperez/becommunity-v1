import { createClient } from "@supabase/supabase-js";
import assert from "node:assert/strict";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceRole) throw new Error("Supabase environment is missing");
const admin = createClient(url, serviceRole, { auth: { autoRefreshToken: false, persistSession: false } });
const marker = `p6c-${Date.now()}-${Math.random().toString(16).slice(2)}`;
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");
let tenantId = null;
let logoPath = null;

try {
  const { data: tenant, error: tenantError } = await admin.from("tenant")
    .insert({ name: `P6C fixture ${marker}` }).select("id, brand_config").single();
  if (tenantError) throw tenantError;
  tenantId = tenant.id;
  if (!tenant.brand_config || typeof tenant.brand_config !== "object") throw new Error("brand_config default missing");

  logoPath = `${tenantId}/logo-${crypto.randomUUID()}.png`;
  const { error: uploadError } = await admin.storage.from("tenant-branding")
    .upload(logoPath, png, { contentType: "image/png", upsert: false });
  if (uploadError) throw uploadError;
  const brand = {
    version: 1,
    displayName: "P6C Demo",
    tagline: "Identidad verificada",
    primaryColor: "#123456",
    accentColor: "#2f9e8f",
    logoPath,
  };
  const { data: updated, error: updateError } = await admin.from("tenant")
    .update({ brand_config: brand }).eq("id", tenantId).select("brand_config").single();
  if (updateError) throw updateError;
  assert.deepEqual(updated.brand_config, brand, "brand_config round-trip mismatch");

  const { data: publicAsset } = admin.storage.from("tenant-branding").getPublicUrl(logoPath);
  const response = await fetch(publicAsset.publicUrl);
  if (!response.ok || response.headers.get("content-type") !== "image/png") {
    throw new Error(`public logo failed: ${response.status} ${response.headers.get("content-type")}`);
  }
  console.log("P6C live tenant brand/storage lifecycle: PASS");
} finally {
  if (logoPath) await admin.storage.from("tenant-branding").remove([logoPath]);
  if (tenantId) await admin.from("tenant").delete().eq("id", tenantId);
}
