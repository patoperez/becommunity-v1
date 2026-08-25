"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { parseDataScope } from "@/lib/studies/scope";
import { brandConfigSchema, parseBrandConfig } from "@/lib/branding/config";
import {
  lifecycleAuditAvailable,
  LIFECYCLE_UNAVAILABLE_REASON,
  recordLifecycleEvent,
  setTenantArchived,
  tenantRefusesNewWork,
  TENANT_DELETION_DISABLED_REASON,
} from "@/lib/studio/lifecycle";
import {
  ARCHIVED_TENANT_REFUSAL,
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
 * EVIDENCE COMES FIRST, AND THAT IS THE WHOLE POINT.
 *
 * The record used to be written after the account was already gone, so a failed
 * write left an irreversible act with nothing describing it. The order is now:
 *
 *   1. `client_user_delete_started` is written and the write is CHECKED. If it
 *      fails — for any reason, missing schema included — nothing is deleted.
 *      Durable intent exists before anything irreversible happens.
 *   2. the account is deleted.
 *   3. `client_user_deleted` is written as the outcome.
 *
 * A started row with no matching deleted row therefore means "this was
 * attempted and the outcome is unknown", which is exactly what that state is.
 * The success message never claims a completion that was not recorded.
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
  const subjectLabel = profile.full_name || "Cuenta cliente";

  // (1) Durable intent, before anything irreversible. A failure here is fatal:
  //     an account is never destroyed without a record saying it was going to
  //     be.
  const intent = await recordLifecycleEvent(admin, {
    actorUserId: user.id,
    action: "client_user_delete_started",
    subjectKind: "client_user",
    subjectId: userId.data,
    tenantId: profile.tenant_id,
    subjectLabel,
  });
  if (!intent.recorded) {
    finish(
      "error",
      intent.unavailable
        ? LIFECYCLE_UNAVAILABLE_REASON
        : "No se pudo dejar constancia de esta eliminación, así que no se eliminó nada. Vuelve a intentarlo.",
      { returnTo, allowed },
    );
  }

  // (2) The irreversible step.
  const { error } = await admin.auth.admin.deleteUser(userId.data);
  if (error) finish("error", `No se pudo eliminar la cuenta: ${error.message}`, { returnTo, allowed });

  // (3) The outcome. If THIS fails the account is genuinely gone, and the
  //     message says the completion was not recorded rather than reporting a
  //     clean success the evidence does not support.
  const outcome = await recordLifecycleEvent(admin, {
    actorUserId: user.id,
    action: "client_user_deleted",
    subjectKind: "client_user",
    subjectId: userId.data,
    tenantId: profile.tenant_id,
    subjectLabel,
  });
  revalidatePath("/admin/clients");
  finish(
    outcome.recorded ? "ok" : "error",
    outcome.recorded
      ? `Cuenta ${accountEmail} eliminada. Los estudios, las respuestas y los comentarios del cliente se conservaron.`
      : `La cuenta ${accountEmail} se eliminó, pero el cierre no quedó registrado. En el historial figura como iniciada sin desenlace; avísale al equipo técnico.`,
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
 * No lifecycle mutation runs without somewhere to record it.
 *
 * FAIL CLOSED, deliberately. The product tells a consultant that suspending,
 * restoring and archiving leave administrative evidence. Where the record
 * cannot be written, the honest answer is to refuse and say so — not to apply
 * the change and quietly drop the evidence, which would leave the interface
 * claiming an audit trail it does not have.
 *
 * This is a READ probe, so it proves the table is there and reachable. It is
 * never the only thing an irreversible action relies on: that path writes a
 * real record first and refuses if the write itself fails.
 */
async function requireLifecycleAudit(
  admin: ReturnType<typeof createAdminClient>,
  options: { returnTo?: string; allowed?: readonly string[] } = {},
) {
  if (!(await lifecycleAuditAvailable(admin))) {
    finish("error", LIFECYCLE_UNAVAILABLE_REASON, options);
  }
}

/**
 * A REVERSIBLE lifecycle mutation that could not be recorded is undone.
 *
 * The mutation is applied, then the record is written. If that write fails the
 * change is reversed with the operation's own inverse — un-suspend, un-archive,
 * each a single idempotent call — and the operator is told nothing happened.
 * The window in which an unrecorded change exists is one round trip, and it
 * closes either way.
 *
 * This is the bounded compensating design that lets reversible actions proceed
 * at all. It is available only BECAUSE they are reversible; the irreversible
 * path cannot use it and does not.
 */
async function recordOrUndo(
  admin: ReturnType<typeof createAdminClient>,
  event: Parameters<typeof recordLifecycleEvent>[1],
  undo: () => Promise<unknown>,
  options: { returnTo?: string; allowed?: readonly string[] },
) {
  const audit = await recordLifecycleEvent(admin, event);
  if (audit.recorded) return;
  await undo();
  finish(
    "error",
    audit.unavailable
      ? LIFECYCLE_UNAVAILABLE_REASON
      : "No se pudo guardar el registro administrativo, así que se deshizo el cambio y todo quedó como estaba.",
    options,
  );
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
  await requireLifecycleAudit(admin, { returnTo, allowed });

  const { error } = await admin.auth.admin.updateUserById(userId.data, {
    ban_duration: SUSPENSION_DURATION,
  });
  if (error) finish("error", `No se pudo suspender el acceso: ${error.message}`, { returnTo, allowed });

  await recordOrUndo(
    admin,
    {
      actorUserId: user.id,
      action: "client_user_suspended",
      subjectKind: "client_user",
      subjectId: userId.data,
      tenantId: subject.tenantId,
      subjectLabel: subject.label,
    },
    () => admin.auth.admin.updateUserById(userId.data, { ban_duration: SUSPENSION_LIFTED }),
    { returnTo, allowed },
  );

  revalidatePath("/admin/clients");
  finish("ok", `${subject.label} ya no puede entrar. Su cuenta y sus datos siguen aquí.`, { returnTo, allowed });
}

/** Give the access back. The mirror of suspension, and just as ordinary. */
export async function restoreClientUser(formData: FormData) {
  const { user, admin } = await internalContext();
  const userId = uuid.safeParse(formData.get("user_id"));
  if (!userId.success) finish("error", "Cuenta inválida.");
  const subject = await clientUserContext(admin, userId.data);
  const returnTo = String(formData.get("return_to") ?? "");
  const allowed = clientReturnPaths(subject.tenantId);
  await requireLifecycleAudit(admin, { returnTo, allowed });

  const { error } = await admin.auth.admin.updateUserById(userId.data, {
    ban_duration: SUSPENSION_LIFTED,
  });
  if (error) finish("error", `No se pudo devolver el acceso: ${error.message}`, { returnTo, allowed });

  await recordOrUndo(
    admin,
    {
      actorUserId: user.id,
      action: "client_user_restored",
      subjectKind: "client_user",
      subjectId: userId.data,
      tenantId: subject.tenantId,
      subjectLabel: subject.label,
    },
    () => admin.auth.admin.updateUserById(userId.data, { ban_duration: SUSPENSION_DURATION }),
    { returnTo, allowed },
  );

  revalidatePath("/admin/clients");
  finish("ok", `${subject.label} puede volver a entrar.`, { returnTo, allowed });
}

// ---------------------------------------------------------------------------
// Client organisation lifecycle — archive, restore, and the deletion that is not
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
  await requireLifecycleAudit(admin, { returnTo, allowed });

  const result = await setTenantArchived(admin, tenantId.data, true, user.id);
  if (!result.ok) finish("error", result.message, { returnTo, allowed });

  await recordOrUndo(
    admin,
    {
      actorUserId: user.id,
      action: "tenant_archived",
      subjectKind: "tenant",
      subjectId: tenantId.data,
      tenantId: tenantId.data,
      subjectLabel: tenant.name,
    },
    () => setTenantArchived(admin, tenantId.data, false, user.id),
    { returnTo, allowed },
  );

  revalidatePath("/admin/clients");
  revalidatePath("/admin/studies");
  finish(
    "ok",
    `“${tenant.name}” quedó archivado: no admite estudios, invitaciones ni publicaciones nuevas. Quien ya tenía acceso lo conserva.`,
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
  await requireLifecycleAudit(admin, { returnTo, allowed });

  const result = await setTenantArchived(admin, tenantId.data, false, user.id);
  if (!result.ok) finish("error", result.message, { returnTo, allowed });

  await recordOrUndo(
    admin,
    {
      actorUserId: user.id,
      action: "tenant_restored",
      subjectKind: "tenant",
      subjectId: tenantId.data,
      tenantId: tenantId.data,
      subjectLabel: tenant.name,
    },
    () => setTenantArchived(admin, tenantId.data, true, user.id),
    { returnTo, allowed },
  );

  revalidatePath("/admin/clients");
  revalidatePath("/admin/studies");
  finish("ok", `“${tenant.name}” volvió a estar activo.`, { returnTo, allowed });
}

/**
 * Permanently delete a client organisation — REFUSED, on the server, always.
 *
 * This is not a stub and not a "coming soon". It is the deliberate, stated
 * outcome of a design review, and it is enforced here rather than by hiding a
 * control, so a caller that never rendered the page is refused identically.
 *
 * WHY. Deleting a client spans three systems with no shared transaction:
 * Postgres rows, Supabase Auth identities and Storage objects. The previous
 * implementation deleted the tenant row first and then attempted the other two,
 * which is precisely the order that can leave an Auth account or a stored file
 * behind after the cascade has already destroyed everything that pointed at
 * them — and it wrote its administrative record last, so a failure there landed
 * after the irreversible step. Counting failures afterwards is a report, not
 * transactional safety, and a report is not what an irreversible operation
 * needs.
 *
 * WHAT STAYS. Archiving, which is reversible and single-system. The impact
 * summary, which is executable and correct and which the client page still
 * renders. The exact-name confirmation, which the interface still asks for.
 * Nothing about the analysis was wrong; only the execution was unsafe.
 *
 * WHAT WOULD LIFT IT. A recoverable, idempotent, resumable cross-system
 * deletion workflow: durable intent, per-system steps that can be retried
 * without duplicating or losing work, and a terminal state that is either
 * complete or explicitly stuck. That is a real piece of engineering and it is
 * not this pass.
 */
export async function deleteTenant(formData: FormData) {
  const { admin } = await internalContext();
  const tenantId = uuid.safeParse(formData.get("tenant_id"));
  const returnTo = String(formData.get("return_to") ?? "");
  const allowed = clientReturnPaths(tenantId.success ? tenantId.data : null);
  // Refused BEFORE anything is read about the client and long before anything
  // could be destroyed. There is no path through this function that reaches a
  // delete, an Auth call or a Storage call.
  void admin;
  finish("error", TENANT_DELETION_DISABLED_REASON, { returnTo, allowed });
}
