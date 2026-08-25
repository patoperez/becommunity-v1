"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { collectStudyTemplatePayload } from "@/lib/templates/collect";
import { EMPTY_TEMPLATE_PAYLOAD, templatePayloadSchema, templatePreview } from "@/lib/templates/schema";
import { dashboardConfigFromSections, dashboardSectionKeys, type DashboardSections } from "@/lib/dashboard/config";
import { journeyDefinitionSchema } from "@/lib/calc/journey";
import { tenantRefusesNewWork } from "@/lib/studio/lifecycle";
import { ARCHIVED_TENANT_REFUSAL } from "@/lib/studio/lifecycle-model";
import {
  safeReturnPath,
  studyConfigurationReturnPaths,
  studioStudyPublish,
  templateReturnPaths,
} from "@/lib/studio/routes";

const uuid = z.string().uuid();
const nameSchema = z.string().trim().min(1).max(200);
const templateNameSchema = z.string().trim().min(1).max(120);
const statusSchema = z.enum(["draft", "published", "archived"]);

async function internalContext() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { data: profile } = await supabase.from("profiles").select("role").eq("user_id", user.id).single<{ role: string }>();
  if (profile?.role !== "internal") throw new Error("Acceso denegado.");
  return { user, admin: createAdminClient() };
}

/**
 * Where the operator lands afterwards.
 *
 * The legacy address is the default, so every existing link and every
 * catalogued outcome contract is unchanged. A submitted `return_to` is honoured
 * only when it EQUALS one of the paths the caller built from an id it had
 * already validated — never because it looked like a Studio path, and never
 * from module state that two concurrent requests could share.
 */
function finish(
  kind: "ok" | "error",
  message: string,
  options: { returnTo?: string; allowed?: readonly string[] } = {},
): never {
  const base = safeReturnPath(options.returnTo, options.allowed ?? [], "/admin/studies");
  const separator = base.includes("?") ? "&" : "?";
  redirect(`${base}${separator}${kind}=${encodeURIComponent(message)}`);
}

/** The template library's own address, when the submission came from there. */
function templateReturn(formData: FormData) {
  return { returnTo: String(formData.get("return_to") ?? ""), allowed: templateReturnPaths() };
}

export async function createBlankStudy(formData: FormData) {
  const { admin } = await internalContext();
  const tenantId = uuid.safeParse(formData.get("tenant_id"));
  const name = nameSchema.safeParse(formData.get("name"));
  if (!tenantId.success || !name.success) finish("error", "Revisa el cliente y el nombre del estudio.");
  // An archived client accepts no new work. Checked here, on the server, at the
  // moment of the write — not by hiding the control on a page that may have
  // been rendered before a colleague archived the client.
  if (await tenantRefusesNewWork(admin, tenantId.data)) finish("error", ARCHIVED_TENANT_REFUSAL);
  const period = String(formData.get("period") ?? "").trim().slice(0, 100) || null;
  const { data, error } = await admin.from("study").insert({
    tenant_id: tenantId.data,
    name: name.data,
    period,
    status: "draft",
    dashboard_config: EMPTY_TEMPLATE_PAYLOAD.dashboardConfig,
    journey_definition: EMPTY_TEMPLATE_PAYLOAD.journeyDefinition,
    template_snapshot: EMPTY_TEMPLATE_PAYLOAD,
  }).select("id").single<{ id: string }>();
  if (error || !data) finish("error", `No se pudo crear el estudio: ${error?.message ?? "respuesta vacía"}`);
  revalidatePath("/admin/studies");
  redirect(`/admin/upload?tenant=${tenantId.data}&study=${data.id}`);
}

export async function createStudyFromTemplate(formData: FormData) {
  const { user, admin } = await internalContext();
  const templateId = uuid.safeParse(formData.get("template_id"));
  const tenantId = uuid.safeParse(formData.get("tenant_id"));
  const name = nameSchema.safeParse(formData.get("name"));
  if (!templateId.success || !tenantId.success || !name.success) finish("error", "Revisa la plantilla, el cliente y el nombre.");
  if (await tenantRefusesNewWork(admin, tenantId.data)) finish("error", ARCHIVED_TENANT_REFUSAL);
  const period = String(formData.get("period") ?? "").trim().slice(0, 100) || null;
  const { data, error } = await admin.rpc("instantiate_study_template", {
    p_template_id: templateId.data,
    p_created_by: user.id,
    p_tenant_id: tenantId.data,
    p_name: name.data,
    p_period: period,
  });
  const result = data as { id?: string } | null;
  if (error || !result?.id) finish("error", `No se pudo usar la plantilla: ${error?.message ?? "respuesta inválida"}`);
  revalidatePath("/admin/studies");
  redirect(`/admin/upload?tenant=${tenantId.data}&study=${result.id}`);
}

export async function saveStudyAsTemplate(formData: FormData) {
  const { user, admin } = await internalContext();
  const studyId = uuid.safeParse(formData.get("study_id"));
  const name = templateNameSchema.safeParse(formData.get("name"));
  const rawTemplateId = String(formData.get("template_id") ?? "");
  const templateId = rawTemplateId ? uuid.safeParse(rawTemplateId) : null;
  if (!studyId.success || !name.success || (templateId && !templateId.success)) {
    finish("error", "Revisa el estudio, el nombre y la plantilla de destino.");
  }
  const { data: study, error: studyError } = await admin.from("study")
    .select("id, dashboard_config, journey_definition, template_snapshot")
    .eq("id", studyId.data)
    .maybeSingle<{ id: string; dashboard_config: unknown; journey_definition: unknown; template_snapshot: unknown }>();
  if (studyError || !study) finish("error", "El estudio seleccionado no existe.");
  const payload = await collectStudyTemplatePayload(admin, study);
  const { error } = await admin.rpc("save_study_template", {
    p_template_id: templateId?.success ? templateId.data : null,
    p_created_by: user.id,
    p_name: name.data,
    p_description: String(formData.get("description") ?? "").trim().slice(0, 1000),
    p_preview: templatePreview(payload),
    p_payload: payload,
    p_created_from: study.id,
  });
  if (error) finish("error", `No se pudo guardar la plantilla: ${error.message}`, templateReturn(formData));
  revalidatePath("/admin/studies");
  finish(
    "ok",
    templateId?.success ? "Plantilla actualizada con una nueva versión." : "Plantilla guardada.",
    templateReturn(formData),
  );
}

export async function updateTemplateMetadata(formData: FormData) {
  const { user, admin } = await internalContext();
  const templateId = uuid.safeParse(formData.get("template_id"));
  const name = templateNameSchema.safeParse(formData.get("name"));
  if (!templateId.success || !name.success) finish("error", "Plantilla inválida.");
  const { data: template } = await admin.from("study_template")
    .select("payload, created_from").eq("id", templateId.data).eq("created_by", user.id)
    .maybeSingle<{ payload: unknown; created_from: string | null }>();
  const payload = templatePayloadSchema.safeParse(template?.payload);
  if (!template || !payload.success) finish("error", "La plantilla no existe o está dañada.");
  const { error } = await admin.rpc("save_study_template", {
    p_template_id: templateId.data,
    p_created_by: user.id,
    p_name: name.data,
    p_description: String(formData.get("description") ?? "").trim().slice(0, 1000),
    p_preview: templatePreview(payload.data),
    p_payload: payload.data,
    p_created_from: template.created_from,
  });
  if (error) finish("error", `No se pudo actualizar: ${error.message}`, templateReturn(formData));
  revalidatePath("/admin/studies");
  finish("ok", "Plantilla actualizada; se incrementó su versión.", templateReturn(formData));
}

export async function deleteTemplate(formData: FormData) {
  const { user, admin } = await internalContext();
  const templateId = uuid.safeParse(formData.get("template_id"));
  if (!templateId.success) finish("error", "Plantilla inválida.");
  const { error } = await admin.from("study_template").delete().eq("id", templateId.data).eq("created_by", user.id);
  if (error) finish("error", `No se pudo eliminar: ${error.message}`, templateReturn(formData));
  revalidatePath("/admin/studies");
  finish("ok", "Plantilla eliminada. Los estudios existentes conservan su copia.", templateReturn(formData));
}

export async function updateStudyConfiguration(formData: FormData) {
  const { admin } = await internalContext();
  const studyId = uuid.safeParse(formData.get("study_id"));
  const name = nameSchema.safeParse(formData.get("name"));
  const status = statusSchema.safeParse(formData.get("status"));
  if (!studyId.success || !name.success || !status.success) finish("error", "Revisa el estudio, nombre y estado.");
  const allowed = studyConfigurationReturnPaths(studyId.data);
  const returnTo = String(formData.get("return_to") ?? "");

  const ids = formData.getAll("stage_id").map(String);
  const labels = formData.getAll("stage_label").map(String);
  const metrics = formData.getAll("stage_metric").map(String);
  const descriptions = formData.getAll("stage_description").map(String);
  if (![labels.length, metrics.length, descriptions.length].every((length) => length === ids.length)) {
    finish("error", "Los momentos del recorrido están incompletos.", { returnTo, allowed });
  }
  const journey = journeyDefinitionSchema.safeParse({
    stages: ids.map((id, index) => ({
      id,
      label: labels[index],
      metric: metrics[index],
      description: descriptions[index] || undefined,
    })),
  });
  if (!journey.success) {
    finish("error", "Revisa los nombres y los resultados de cada momento; no puede haber dos momentos iguales.", { returnTo, allowed });
  }

  const sections = Object.fromEntries(dashboardSectionKeys.map((key) => [
    key,
    formData.get(`section_${key}`) === "on",
  ])) as DashboardSections;

  // PUBLICATION IS NOT CONFIGURATION.
  //
  // This action used to accept any status, so "publicado · visible al cliente"
  // could be chosen in the middle of a configuration form and saved without
  // anyone having looked at what the client would receive. The state the study
  // is actually in is now read here and compared: this action may only re-save
  // the state that already holds. Moving it happens in `setStudyPublication`,
  // whose only surface is reached through the client preview.
  const { data: current, error: currentError } = await admin.from("study")
    .select("status").eq("id", studyId.data).maybeSingle<{ status: string }>();
  if (currentError || !current) finish("error", "El estudio ya no existe.", { returnTo, allowed });
  if (status.data !== current.status) {
    finish(
      "error",
      "Desde aquí no se cambia quién ve el estudio. Revísalo como lo verá el cliente y decide la publicación ahí.",
      { returnTo, allowed },
    );
  }

  const period = String(formData.get("period") ?? "").trim().slice(0, 100) || null;
  const { data, error } = await admin.from("study").update({
    name: name.data,
    period,
    status: current.status,
    dashboard_config: dashboardConfigFromSections(sections),
    journey_definition: journey.data,
  }).eq("id", studyId.data).select("id").maybeSingle();
  if (error || !data) {
    finish("error", `No se pudo guardar la configuración: ${error?.message ?? "estudio inexistente"}`, { returnTo, allowed });
  }
  revalidatePath("/admin/studies");
  revalidatePath("/dashboard");
  finish("ok", "Configuración del estudio guardada.", { returnTo, allowed });
}

/**
 * Move a study between draft, published and archived.
 *
 * This is the ONLY path that changes who can see a study, and the only surface
 * rendering it is `/studio/e/[studyId]/publicar`, which is reached from the
 * client preview. The server keeps its own guards regardless of which page
 * dispatched the call:
 *
 *  - the caller is internal (`internalContext`);
 *  - an empty study still cannot be published, exactly as before;
 *  - an archived client cannot receive a new publication;
 *  - publishing requires the explicit acknowledgement the preview asks for, so
 *    a request that never passed through the preview is refused here as well.
 */
export async function setStudyPublication(formData: FormData) {
  const { admin } = await internalContext();
  const studyId = uuid.safeParse(formData.get("study_id"));
  const next = statusSchema.safeParse(formData.get("next_status"));
  if (!studyId.success || !next.success) finish("error", "Revisa el estudio y el estado.");
  const allowed = [studioStudyPublish(studyId.data)];
  const returnTo = String(formData.get("return_to") ?? studioStudyPublish(studyId.data));

  const { data: study, error: studyError } = await admin.from("study")
    .select("id, tenant_id, status, name").eq("id", studyId.data)
    .maybeSingle<{ id: string; tenant_id: string; status: string; name: string }>();
  if (studyError || !study) finish("error", "El estudio ya no existe.", { returnTo, allowed });

  if (next.data === study.status) {
    finish("error", "El estudio ya estaba en ese estado.", { returnTo, allowed });
  }

  if (next.data === "published") {
    if (formData.get("acknowledged") !== "on") {
      finish("error", "Confirma que revisaste la vista del cliente antes de publicar.", { returnTo, allowed });
    }
    if (await tenantRefusesNewWork(admin, study.tenant_id)) {
      finish("error", ARCHIVED_TENANT_REFUSAL, { returnTo, allowed });
    }
    const [{ count: responses, error: responseError }, { count: observations, error: observationError }] = await Promise.all([
      admin.from("quant_response").select("id", { count: "exact", head: true }).eq("study_id", studyId.data),
      admin.from("qual_observation").select("id", { count: "exact", head: true })
        .eq("study_id", studyId.data).eq("review_status", "confirmed"),
    ]);
    if (responseError || observationError) {
      finish("error", "No se pudo validar el contenido antes de publicar.", { returnTo, allowed });
    }
    if ((responses ?? 0) + (observations ?? 0) === 0) {
      finish("error", "Carga respuestas o confirma hallazgos antes de publicar el estudio.", { returnTo, allowed });
    }
  }

  const { data, error } = await admin.from("study").update({ status: next.data })
    .eq("id", studyId.data).select("id").maybeSingle();
  if (error || !data) {
    finish("error", `No se pudo cambiar el estado: ${error?.message ?? "estudio inexistente"}`, { returnTo, allowed });
  }
  revalidatePath("/admin/studies");
  revalidatePath("/dashboard");
  const message = next.data === "published"
    ? `“${study.name}” ya es visible para el cliente.`
    : next.data === "archived"
      ? `“${study.name}” quedó archivado y el cliente dejó de verlo.`
      : `“${study.name}” volvió a borrador y el cliente dejó de verlo.`;
  finish("ok", message, { returnTo, allowed });
}
