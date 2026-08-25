"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { parseDataScope } from "@/lib/studies/scope";
import { brandConfigSchema, parseBrandConfig } from "@/lib/branding/config";

const uuid = z.string().uuid();
const tenantName = z.string().trim().min(2).max(160);
const fullName = z.string().trim().max(120);
const email = z.string().trim().toLowerCase().email().max(254);

async function internalContext() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { data: profile } = await supabase.from("profiles")
    .select("role").eq("user_id", user.id).single<{ role: string }>();
  if (profile?.role !== "internal") throw new Error("Acceso denegado.");
  return { user, admin: createAdminClient() };
}

function finish(kind: "ok" | "error", message: string): never {
  redirect(`/admin/clients?${kind}=${encodeURIComponent(message)}`);
}

/**
 * The access choice arrives serialized from the Studio picker, and is parsed by
 * exactly the same fail-closed parser the enforcement boundary uses. A request
 * that bypasses the picker and posts something else is rejected here, so the
 * no-code interface is convenience and this remains the check.
 */
function readScope(value: FormDataEntryValue | null) {
  try {
    return parseDataScope(JSON.parse(String(value ?? "{}").trim() || "{}"));
  } catch {
    finish("error", "No se pudo guardar el acceso. Vuelve a elegir qué podrá ver esta persona.");
  }
}

async function tenantExists(admin: ReturnType<typeof createAdminClient>, tenantId: string) {
  const { data, error } = await admin.from("tenant").select("id").eq("id", tenantId).maybeSingle();
  if (error || !data) finish("error", "El cliente seleccionado no existe.");
}

function imageExtension(bytes: Uint8Array, mime: string): "png" | "jpg" | "webp" | null {
  if (mime === "image/png" && bytes.length >= 8
    && [137, 80, 78, 71, 13, 10, 26, 10].every((value, index) => bytes[index] === value)) return "png";
  if (mime === "image/jpeg" && bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "jpg";
  if (mime === "image/webp" && bytes.length >= 12
    && new TextDecoder().decode(bytes.slice(0, 4)) === "RIFF"
    && new TextDecoder().decode(bytes.slice(8, 12)) === "WEBP") return "webp";
  return null;
}

export async function createTenant(formData: FormData) {
  const { admin } = await internalContext();
  const name = tenantName.safeParse(formData.get("name"));
  if (!name.success) finish("error", "El nombre del cliente debe tener entre 2 y 160 caracteres.");
  const { error } = await admin.from("tenant").insert({ name: name.data });
  if (error) finish("error", `No se pudo crear el cliente: ${error.message}`);
  revalidatePath("/admin/clients");
  finish("ok", `Cliente “${name.data}” creado.`);
}

export async function renameTenant(formData: FormData) {
  const { admin } = await internalContext();
  const tenantId = uuid.safeParse(formData.get("tenant_id"));
  const name = tenantName.safeParse(formData.get("name"));
  if (!tenantId.success || !name.success) finish("error", "Revisa el cliente y su nombre.");
  const { data, error } = await admin.from("tenant").update({ name: name.data })
    .eq("id", tenantId.data).select("id").maybeSingle();
  if (error || !data) finish("error", "No se pudo actualizar el cliente.");
  revalidatePath("/admin/clients");
  revalidatePath("/dashboard");
  finish("ok", "Nombre del cliente actualizado.");
}

export async function updateTenantBrand(formData: FormData) {
  const { admin } = await internalContext();
  const tenantId = uuid.safeParse(formData.get("tenant_id"));
  const values = brandConfigSchema().safeParse({
    displayName: formData.get("display_name"),
    tagline: formData.get("tagline"),
    primaryColor: formData.get("primary_color"),
    accentColor: formData.get("accent_color"),
  });
  if (!tenantId.success || !values.success) finish("error", "Revisa el nombre visible, leyenda y colores de marca.");
  const { data: tenant, error: tenantError } = await admin.from("tenant")
    .select("name, brand_config").eq("id", tenantId.data)
    .maybeSingle<{ name: string; brand_config: unknown }>();
  if (tenantError || !tenant) finish("error", "El cliente seleccionado no existe.");
  const previous = parseBrandConfig(tenant.brand_config);
  const rawLogo = formData.get("logo");
  const file = rawLogo instanceof File && rawLogo.size > 0 ? rawLogo : null;
  let nextLogoPath = formData.get("remove_logo") === "on" ? null : previous.logoPath;
  let uploadedPath: string | null = null;

  if (file) {
    if (file.size > 1_048_576) finish("error", "El logotipo no puede superar 1 MB.");
    const bytes = new Uint8Array(await file.arrayBuffer());
    const extension = imageExtension(bytes, file.type);
    if (!extension) finish("error", "El logotipo debe ser un PNG, JPEG o WebP real.");
    uploadedPath = `${tenantId.data}/logo-${crypto.randomUUID()}.${extension}`;
    const { error: uploadError } = await admin.storage.from("tenant-branding")
      .upload(uploadedPath, bytes, { contentType: file.type, upsert: false, cacheControl: "3600" });
    if (uploadError) finish("error", `No se pudo subir el logotipo: ${uploadError.message}`);
    nextLogoPath = uploadedPath;
  }

  const nextBrand = {
    version: 1,
    displayName: values.data.displayName || null,
    tagline: values.data.tagline,
    primaryColor: values.data.primaryColor,
    accentColor: values.data.accentColor,
    logoPath: nextLogoPath,
  };
  const { data, error } = await admin.from("tenant").update({ brand_config: nextBrand })
    .eq("id", tenantId.data).select("id").maybeSingle();
  if (error || !data) {
    if (uploadedPath) await admin.storage.from("tenant-branding").remove([uploadedPath]);
    finish("error", "No se pudo guardar la marca del cliente.");
  }
  if (previous.logoPath && previous.logoPath !== nextLogoPath) {
    await admin.storage.from("tenant-branding").remove([previous.logoPath]);
  }
  revalidatePath("/admin/clients");
  revalidatePath("/dashboard");
  finish("ok", "Identidad visual del cliente actualizada.");
}

export async function inviteClientUser(formData: FormData) {
  const { admin } = await internalContext();
  const tenantId = uuid.safeParse(formData.get("tenant_id"));
  const address = email.safeParse(formData.get("email"));
  const name = fullName.safeParse(formData.get("full_name"));
  if (!tenantId.success || !address.success || !name.success) {
    finish("error", "Revisa el cliente, correo y nombre de la persona.");
  }
  const scope = readScope(formData.get("data_scope"));
  await tenantExists(admin, tenantId.data);

  const { data: invited, error: inviteError } = await admin.auth.admin.inviteUserByEmail(address.data, {
    data: { full_name: name.data },
  });
  if (inviteError || !invited.user) {
    finish("error", `No se pudo enviar la invitación: ${inviteError?.message ?? "respuesta vacía"}`);
  }
  // The project may provision a minimal profile from an auth-user trigger.
  // Upsert completes that row and also works when no trigger is installed.
  const { error: profileError } = await admin.from("profiles").upsert({
    user_id: invited.user.id,
    tenant_id: tenantId.data,
    role: "client",
    full_name: name.data || null,
    data_scope: scope,
  }, { onConflict: "user_id" });
  if (profileError) {
    await admin.auth.admin.deleteUser(invited.user.id);
    finish("error", `La invitación se revirtió porque no pudo crearse el perfil: ${profileError.message}`);
  }
  revalidatePath("/admin/clients");
  finish("ok", `Invitación enviada a ${address.data}.`);
}

export async function updateClientUser(formData: FormData) {
  const { admin } = await internalContext();
  const userId = uuid.safeParse(formData.get("user_id"));
  const tenantId = uuid.safeParse(formData.get("tenant_id"));
  const name = fullName.safeParse(formData.get("full_name"));
  if (!userId.success || !tenantId.success || !name.success) finish("error", "Perfil inválido.");
  const scope = readScope(formData.get("data_scope"));
  await tenantExists(admin, tenantId.data);
  const { data, error } = await admin.from("profiles").update({
    tenant_id: tenantId.data,
    full_name: name.data || null,
    data_scope: scope,
  }).eq("user_id", userId.data).eq("role", "client").select("user_id").maybeSingle();
  if (error || !data) finish("error", "No se pudo actualizar el usuario cliente.");
  revalidatePath("/admin/clients");
  revalidatePath("/dashboard");
  finish("ok", "Usuario y acceso actualizados.");
}

export async function deleteClientUser(formData: FormData) {
  const { admin } = await internalContext();
  const userId = uuid.safeParse(formData.get("user_id"));
  const confirmation = email.safeParse(formData.get("confirmation_email"));
  if (!userId.success || !confirmation.success) finish("error", "Confirma el correo exacto de la cuenta.");
  const [{ data: profile }, { data: account, error: accountError }] = await Promise.all([
    admin.from("profiles").select("role").eq("user_id", userId.data).maybeSingle<{ role: string }>(),
    admin.auth.admin.getUserById(userId.data),
  ]);
  const accountEmail = account.user?.email?.toLowerCase();
  if (profile?.role !== "client" || accountError || !accountEmail || accountEmail !== confirmation.data) {
    finish("error", "La cuenta cliente o el correo de confirmación no coinciden.");
  }
  const { error } = await admin.auth.admin.deleteUser(userId.data);
  if (error) finish("error", `No se pudo eliminar la cuenta: ${error.message}`);
  revalidatePath("/admin/clients");
  finish("ok", `Cuenta ${accountEmail} eliminada. Los estudios del cliente se conservaron.`);
}
