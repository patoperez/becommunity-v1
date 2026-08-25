"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { parseDataScope } from "@/lib/studies/scope";
import { brandConfigSchema, parseBrandConfig } from "@/lib/branding/config";
import {
  countTenantImpact,
  listTenantStorageObjects,
  recordLifecycleEvent,
  setTenantArchived,
  tenantRefusesNewWork,
} from "@/lib/studio/lifecycle";
import {
  ARCHIVED_TENANT_REFUSAL,
  impactDifferences,
  impactIsUnchanged,
  nameConfirmationRefusal,
  parseImpact,
  SUSPENSION_DURATION,
  SUSPENSION_LIFTED,
} from "@/lib/studio/lifecycle-model";
import { clientReturnPaths, safeReturnPath } from "@/lib/studio/routes";

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

/**
 * Where the operator lands afterwards.
 *
 * The legacy address stays the default so every existing link, bookmark and
 * catalogued outcome contract is unchanged. A submitted `return_to` is honoured
 * only when it EQUALS one of the paths the caller built from an id it had
 * already validated.
 */
function finish(
  kind: "ok" | "error",
  message: string,
  options: { returnTo?: string; allowed?: readonly string[] } = {},
): never {
  const base = safeReturnPath(options.returnTo, options.allowed ?? [], "/admin/clients");
  const separator = base.includes("?") ? "&" : "?";
  redirect(`${base}${separator}${kind}=${encodeURIComponent(message)}`);
}

/**
 * An administrative action that succeeded and was NOT recorded says so.
 *
 * Presenting an unrecorded suspension or deletion as if the evidence existed
 * would be the one lie this workflow cannot afford, so the absence travels with
 * the success message instead of being swallowed.
 */
function auditNote(result: { recorded: boolean; unavailable: boolean }): string {
  if (result.recorded) return "";
  return result.unavailable
    ? " (No quedó registrado en el historial administrativo: falta aplicar la migración 0015 en este entorno.)"
    : " (No se pudo guardar el registro administrativo de esta acción.)";
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
  const returnTo = String(formData.get("return_to") ?? "");
  const allowed = clientReturnPaths(tenantId.data);
  const { data, error } = await admin.from("tenant").update({ name: name.data })
    .eq("id", tenantId.data).select("id").maybeSingle();
  if (error || !data) finish("error", "No se pudo actualizar el cliente.", { returnTo, allowed });
  revalidatePath("/admin/clients");
  revalidatePath("/dashboard");
  finish("ok", "Nombre del cliente actualizado.", { returnTo, allowed });
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
  finish("ok", "Identidad visual del cliente actualizada.", {
    returnTo: String(formData.get("return_to") ?? ""),
    allowed: clientReturnPaths(tenantId.data),
  });
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
  // An archived client accepts no new people. Checked on the server, now.
  if (await tenantRefusesNewWork(admin, tenantId.data)) finish("error", ARCHIVED_TENANT_REFUSAL);

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
  const returnTo = String(formData.get("return_to") ?? "");
  const allowed = clientReturnPaths(tenantId.data);
  const { data, error } = await admin.from("profiles").update({
    tenant_id: tenantId.data,
    full_name: name.data || null,
    data_scope: scope,
  }).eq("user_id", userId.data).eq("role", "client").select("user_id").maybeSingle();
  if (error || !data) finish("error", "No se pudo actualizar el usuario cliente.", { returnTo, allowed });
  revalidatePath("/admin/clients");
  revalidatePath("/dashboard");
  finish("ok", "Usuario y acceso actualizados.", { returnTo, allowed });
}

/**
 * Permanently delete one client user.
 *
 * Distinct from suspension in every way that matters: this destroys the account
 * and the profile — including the part of the results that person was scoped
 * to — and it cannot be undone. Nothing belonging to the CLIENT is touched:
 * studies, responses and comments were never that person's property.
 *
 * The exact-email confirmation is unchanged and is still checked here, against
 * the account the server read, so a request that never rendered the dialog is
 * refused identically.
 */
export async function deleteClientUser(formData: FormData) {
  const { user, admin } = await internalContext();
  const userId = uuid.safeParse(formData.get("user_id"));
  const confirmation = email.safeParse(formData.get("confirmation_email"));
  if (!userId.success || !confirmation.success) finish("error", "Confirma el correo exacto de la cuenta.");
  const [{ data: profile }, { data: account, error: accountError }] = await Promise.all([
    admin.from("profiles").select("role, tenant_id, full_name").eq("user_id", userId.data)
      .maybeSingle<{ role: string; tenant_id: string | null; full_name: string | null }>(),
    admin.auth.admin.getUserById(userId.data),
  ]);
  const accountEmail = account.user?.email?.toLowerCase();
  if (profile?.role !== "client" || accountError || !accountEmail || accountEmail !== confirmation.data) {
    finish("error", "La cuenta cliente o el correo de confirmación no coinciden.");
  }
  const returnTo = String(formData.get("return_to") ?? "");
  const allowed = clientReturnPaths(profile.tenant_id);
  const { error } = await admin.auth.admin.deleteUser(userId.data);
  if (error) finish("error", `No se pudo eliminar la cuenta: ${error.message}`, { returnTo, allowed });
  const audit = await recordLifecycleEvent(admin, {
    actorUserId: user.id,
    action: "client_user_deleted",
    subjectKind: "client_user",
    subjectId: userId.data,
    tenantId: profile.tenant_id,
    subjectLabel: profile.full_name || "Cuenta cliente",
  });
  revalidatePath("/admin/clients");
  finish(
    "ok",
    `Cuenta ${accountEmail} eliminada. Los estudios, las respuestas y los comentarios del cliente se conservaron.${auditNote(audit)}`,
    { returnTo, allowed },
  );
}

// ---------------------------------------------------------------------------
// Account lifecycle — suspend, restore, delete
// ---------------------------------------------------------------------------

/**
 * Load one client user and prove it is one, before anything is done to it.
 *
 * Role is re-read from the database on every lifecycle call. A client actor can
 * never reach here at all — `internalContext()` answered first — and an
 * internal actor still cannot act on an internal colleague's account through
 * this surface, because the profile must say `client`.
 */
async function clientUserContext(
  admin: ReturnType<typeof createAdminClient>,
  userId: string,
) {
  const [{ data: profile }, { data: account, error: accountError }] = await Promise.all([
    admin.from("profiles").select("role, tenant_id, full_name").eq("user_id", userId)
      .maybeSingle<{ role: string; tenant_id: string | null; full_name: string | null }>(),
    admin.auth.admin.getUserById(userId),
  ]);
  if (profile?.role !== "client" || accountError || !account.user) {
    finish("error", "Esa cuenta cliente ya no existe.");
  }
  return {
    tenantId: profile.tenant_id,
    label: profile.full_name || account.user.email || "Cuenta sin nombre",
    account: account.user,
  };
}

/**
 * Suspend a person's access.
 *
 * Enforced where authentication happens, not by a product flag: Supabase Auth
 * refuses the identity outright, so there is exactly one source of truth and
 * the interface can never show "con acceso" for somebody the Auth server is
 * already turning away. It is fully reversible and destroys nothing.
 */
export async function suspendClientUser(formData: FormData) {
  const { user, admin } = await internalContext();
  const userId = uuid.safeParse(formData.get("user_id"));
  if (!userId.success) finish("error", "Cuenta inválida.");
  const subject = await clientUserContext(admin, userId.data);
  const returnTo = String(formData.get("return_to") ?? "");
  const allowed = clientReturnPaths(subject.tenantId);

  const { error } = await admin.auth.admin.updateUserById(userId.data, {
    ban_duration: SUSPENSION_DURATION,
  });
  if (error) finish("error", `No se pudo suspender el acceso: ${error.message}`, { returnTo, allowed });

  const audit = await recordLifecycleEvent(admin, {
    actorUserId: user.id,
    action: "client_user_suspended",
    subjectKind: "client_user",
    subjectId: userId.data,
    tenantId: subject.tenantId,
    subjectLabel: subject.label,
  });
  revalidatePath("/admin/clients");
  finish(
    "ok",
    `${subject.label} ya no puede entrar. Su cuenta y sus datos siguen aquí.${auditNote(audit)}`,
    { returnTo, allowed },
  );
}

/** Give the access back. The mirror of suspension, and just as ordinary. */
export async function restoreClientUser(formData: FormData) {
  const { user, admin } = await internalContext();
  const userId = uuid.safeParse(formData.get("user_id"));
  if (!userId.success) finish("error", "Cuenta inválida.");
  const subject = await clientUserContext(admin, userId.data);
  const returnTo = String(formData.get("return_to") ?? "");
  const allowed = clientReturnPaths(subject.tenantId);

  const { error } = await admin.auth.admin.updateUserById(userId.data, {
    ban_duration: SUSPENSION_LIFTED,
  });
  if (error) finish("error", `No se pudo devolver el acceso: ${error.message}`, { returnTo, allowed });

  const audit = await recordLifecycleEvent(admin, {
    actorUserId: user.id,
    action: "client_user_restored",
    subjectKind: "client_user",
    subjectId: userId.data,
    tenantId: subject.tenantId,
    subjectLabel: subject.label,
  });
  revalidatePath("/admin/clients");
  finish("ok", `${subject.label} puede volver a entrar.${auditNote(audit)}`, { returnTo, allowed });
}

// ---------------------------------------------------------------------------
// Client organisation lifecycle — archive, restore, delete
// ---------------------------------------------------------------------------

async function tenantContext(admin: ReturnType<typeof createAdminClient>, tenantId: string) {
  const { data, error } = await admin.from("tenant").select("id, name").eq("id", tenantId)
    .maybeSingle<{ id: string; name: string }>();
  if (error || !data) finish("error", "El cliente seleccionado no existe.");
  return data;
}

/**
 * Archive a client. The ordinary, reversible action.
 *
 * It stops NEW work — no new study, no new invitation, no new publication — and
 * stops nothing else. It is not a way to lock people out: that is per-person
 * suspension, and the interface says so rather than letting an operator assume
 * one from the other.
 */
export async function archiveTenant(formData: FormData) {
  const { user, admin } = await internalContext();
  const tenantId = uuid.safeParse(formData.get("tenant_id"));
  if (!tenantId.success) finish("error", "Cliente inválido.");
  const tenant = await tenantContext(admin, tenantId.data);
  const returnTo = String(formData.get("return_to") ?? "");
  const allowed = clientReturnPaths(tenantId.data);

  const result = await setTenantArchived(admin, tenantId.data, true, user.id);
  if (!result.ok) finish("error", result.message, { returnTo, allowed });

  const audit = await recordLifecycleEvent(admin, {
    actorUserId: user.id,
    action: "tenant_archived",
    subjectKind: "tenant",
    subjectId: tenantId.data,
    tenantId: tenantId.data,
    subjectLabel: tenant.name,
  });
  revalidatePath("/admin/clients");
  revalidatePath("/admin/studies");
  finish(
    "ok",
    `“${tenant.name}” quedó archivado: no admite estudios, invitaciones ni publicaciones nuevas. Quien ya tenía acceso lo conserva.${auditNote(audit)}`,
    { returnTo, allowed },
  );
}

/** Bring an archived client back into ordinary work. */
export async function restoreTenant(formData: FormData) {
  const { user, admin } = await internalContext();
  const tenantId = uuid.safeParse(formData.get("tenant_id"));
  if (!tenantId.success) finish("error", "Cliente inválido.");
  const tenant = await tenantContext(admin, tenantId.data);
  const returnTo = String(formData.get("return_to") ?? "");
  const allowed = clientReturnPaths(tenantId.data);

  const result = await setTenantArchived(admin, tenantId.data, false, user.id);
  if (!result.ok) finish("error", result.message, { returnTo, allowed });

  const audit = await recordLifecycleEvent(admin, {
    actorUserId: user.id,
    action: "tenant_restored",
    subjectKind: "tenant",
    subjectId: tenantId.data,
    tenantId: tenantId.data,
    subjectLabel: tenant.name,
  });
  revalidatePath("/admin/clients");
  revalidatePath("/admin/studies");
  finish("ok", `“${tenant.name}” volvió a estar activo.${auditNote(audit)}`, { returnTo, allowed });
}

/**
 * Permanently delete a client organisation. The exceptional action.
 *
 * FOUR THINGS GUARD IT, AND NONE OF THEM IS THE DIALOG:
 *
 *  1. the caller is internal, proved on the server;
 *  2. the typed name must match the client's own name exactly — checked here,
 *     with the same comparison the interface used, so a request that never
 *     rendered the dialog is refused identically;
 *  3. the impact summary the operator READ is compared against a summary
 *     recomputed at this instant, and any difference stops the deletion. A
 *     colleague importing a file while the dialog was open would otherwise mean
 *     destroying more than the summary named;
 *  4. every dependent object is handled deliberately and in an order that
 *     cannot orphan one: identities are collected first, the row cascade runs,
 *     then the Auth accounts and the stored files that no cascade would have
 *     reached.
 *
 * What is kept is kept on purpose: the administrative record of this deletion,
 * and the team's saved templates, whose `created_from` reference is set null by
 * the schema rather than taking the template with it.
 */
export async function deleteTenant(formData: FormData) {
  const { user, admin } = await internalContext();
  const tenantId = uuid.safeParse(formData.get("tenant_id"));
  if (!tenantId.success) finish("error", "Cliente inválido.");
  const tenant = await tenantContext(admin, tenantId.data);
  const returnTo = String(formData.get("return_to") ?? "");
  const allowed = clientReturnPaths(null);

  const refusal = nameConfirmationRefusal(String(formData.get("confirmation_name") ?? ""), tenant.name);
  if (refusal) finish("error", refusal, { returnTo, allowed });

  const shown = parseImpact(String(formData.get("impact") ?? ""));
  if (!shown) {
    finish("error", "No se pudo leer el resumen que confirmaste. Vuelve a abrirlo y revísalo.", { returnTo, allowed });
  }
  const current = await countTenantImpact(admin, tenantId.data);
  if (!impactIsUnchanged(shown, current)) {
    finish(
      "error",
      `El cliente cambió mientras confirmabas, así que no se eliminó nada. Cambió: ${impactDifferences(shown, current).join("; ")}. Vuelve a revisar el resumen.`,
      { returnTo, allowed },
    );
  }

  // Collected BEFORE the cascade, because the cascade takes the profile rows
  // that name these identities with it.
  const { data: profiles, error: profileError } = await admin.from("profiles")
    .select("user_id").eq("tenant_id", tenantId.data).returns<{ user_id: string }[]>();
  if (profileError) finish("error", `No se pudo leer quién tiene acceso: ${profileError.message}`, { returnTo, allowed });
  const storagePaths = await listTenantStorageObjects(admin, tenantId.data);

  const { error: deleteError } = await admin.from("tenant").delete().eq("id", tenantId.data);
  if (deleteError) finish("error", `No se pudo eliminar el cliente: ${deleteError.message}`, { returnTo, allowed });

  // Neither of these is reached by a database cascade, so both are done here,
  // explicitly, and any failure is reported rather than assumed away.
  let orphanedAccounts = 0;
  for (const profile of profiles ?? []) {
    const { error } = await admin.auth.admin.deleteUser(profile.user_id);
    if (error) orphanedAccounts += 1;
  }
  let orphanedFiles = 0;
  if (storagePaths.length > 0) {
    const { error } = await admin.storage.from("tenant-branding").remove(storagePaths);
    if (error) orphanedFiles = storagePaths.length;
  }

  const audit = await recordLifecycleEvent(admin, {
    actorUserId: user.id,
    action: "tenant_deleted",
    subjectKind: "tenant",
    subjectId: tenantId.data,
    tenantId: tenantId.data,
    subjectLabel: tenant.name,
    details: {
      clientUsers: current.clientUsers,
      studies: current.studies,
      respondents: current.respondents,
      quantResponses: current.quantResponses,
      qualObservations: current.qualObservations,
      importBatches: current.importBatches,
      storageObjects: current.storageObjects,
      orphanedAccounts,
      orphanedFiles,
    },
  });

  revalidatePath("/admin/clients");
  revalidatePath("/admin/studies");
  revalidatePath("/dashboard");
  const leftovers = [
    orphanedAccounts > 0 ? `${orphanedAccounts} cuenta(s) de acceso no se pudieron borrar` : null,
    orphanedFiles > 0 ? `${orphanedFiles} archivo(s) guardados no se pudieron borrar` : null,
  ].filter(Boolean);
  finish(
    leftovers.length > 0 ? "error" : "ok",
    leftovers.length > 0
      ? `Se eliminó “${tenant.name}” y sus datos, pero ${leftovers.join(" y ")}. Avísale al equipo técnico.${auditNote(audit)}`
      : `Se eliminó “${tenant.name}” y todo lo que dependía de él.${auditNote(audit)}`,
    { returnTo, allowed },
  );
}
