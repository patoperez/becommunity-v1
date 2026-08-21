import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceRole) throw new Error("Supabase environment is missing");
const admin = createClient(url, serviceRole, { auth: { autoRefreshToken: false, persistSession: false } });
const marker = `p6a-${Date.now()}-${Math.random().toString(16).slice(2)}`;
const email = `${marker}@becommunity.test`;
let tenantId = null;
let userId = null;

try {
  const { data: tenant, error: tenantError } = await admin.from("tenant")
    .insert({ name: `P6A fixture ${marker}` }).select("id").single();
  if (tenantError) throw tenantError;
  tenantId = tenant.id;

  const { data: account, error: accountError } = await admin.auth.admin.createUser({
    email,
    password: `Tmp-${crypto.randomUUID()}!`,
    email_confirm: true,
  });
  if (accountError || !account.user) throw accountError ?? new Error("empty auth user");
  userId = account.user.id;

  const { error: profileError } = await admin.from("profiles").upsert({
    user_id: userId,
    tenant_id: tenantId,
    role: "client",
    full_name: "P6A fixture",
    data_scope: { area: ["Direccion"] },
  }, { onConflict: "user_id" });
  if (profileError) throw profileError;
  const { data: profile, error: readError } = await admin.from("profiles")
    .select("tenant_id, role, data_scope").eq("user_id", userId).single();
  if (readError || profile.tenant_id !== tenantId || profile.role !== "client"
    || profile.data_scope?.area?.[0] !== "Direccion") throw readError ?? new Error("profile mismatch");

  const { error: updateError } = await admin.from("profiles")
    .update({ data_scope: { nivel: ["Primaria"] } }).eq("user_id", userId).eq("role", "client");
  if (updateError) throw updateError;
  console.log("P6A live tenant/profile lifecycle: PASS");
} finally {
  if (userId) await admin.auth.admin.deleteUser(userId);
  if (tenantId) await admin.from("tenant").delete().eq("id", tenantId);
}
