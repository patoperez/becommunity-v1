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

function finish(kind: "ok" | "error", message: string): never {
  redirect(`/admin/studies?${kind}=${encodeURIComponent(message)}`);
}

export async function createBlankStudy(formData: FormData) {
  const { admin } = await internalContext();
  const tenantId = uuid.safeParse(formData.get("tenant_id"));
  const name = nameSchema.safeParse(formData.get("name"));
  if (!tenantId.success || !name.success) finish("error", "Revisa el cliente y el nombre del estudio.");
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
  if (error) finish("error", `No se pudo guardar la plantilla: ${error.message}`);
  revalidatePath("/admin/studies");
  finish("ok", templateId?.success ? "Plantilla actualizada con una nueva versión." : "Plantilla guardada.");
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
  if (error) finish("error", `No se pudo actualizar: ${error.message}`);
  revalidatePath("/admin/studies");
  finish("ok", "Plantilla actualizada; se incrementó su versión.");
}

export async function deleteTemplate(formData: FormData) {
  const { user, admin } = await internalContext();
  const templateId = uuid.safeParse(formData.get("template_id"));
  if (!templateId.success) finish("error", "Plantilla inválida.");
  const { error } = await admin.from("study_template").delete().eq("id", templateId.data).eq("created_by", user.id);
  if (error) finish("error", `No se pudo eliminar: ${error.message}`);
  revalidatePath("/admin/studies");
  finish("ok", "Plantilla eliminada. Los estudios existentes conservan su copia.");
}

export async function updateStudyConfiguration(formData: FormData) {
  const { admin } = await internalContext();
  const studyId = uuid.safeParse(formData.get("study_id"));
  const name = nameSchema.safeParse(formData.get("name"));
  const status = statusSchema.safeParse(formData.get("status"));
  if (!studyId.success || !name.success || !status.success) finish("error", "Revisa el estudio, nombre y estado.");

  const ids = formData.getAll("stage_id").map(String);
  const labels = formData.getAll("stage_label").map(String);
  const metrics = formData.getAll("stage_metric").map(String);
  const descriptions = formData.getAll("stage_description").map(String);
  if (![labels.length, metrics.length, descriptions.length].every((length) => length === ids.length)) {
    finish("error", "Las etapas del journey están incompletas.");
  }
  const journey = journeyDefinitionSchema.safeParse({
    stages: ids.map((id, index) => ({
      id,
      label: labels[index],
      metric: metrics[index],
      description: descriptions[index] || undefined,
    })),
  });
  if (!journey.success) finish("error", "Revisa identificadores, métricas y textos del journey; no puede haber etapas duplicadas.");

  const sections = Object.fromEntries(dashboardSectionKeys.map((key) => [
    key,
    formData.get(`section_${key}`) === "on",
  ])) as DashboardSections;

  if (status.data === "published") {
    const [{ count: responses, error: responseError }, { count: observations, error: observationError }] = await Promise.all([
      admin.from("quant_response").select("id", { count: "exact", head: true }).eq("study_id", studyId.data),
      admin.from("qual_observation").select("id", { count: "exact", head: true })
        .eq("study_id", studyId.data).eq("review_status", "confirmed"),
    ]);
    if (responseError || observationError) finish("error", "No se pudo validar el contenido antes de publicar.");
    if ((responses ?? 0) + (observations ?? 0) === 0) finish("error", "Carga respuestas o confirma hallazgos antes de publicar el estudio.");
  }

  const period = String(formData.get("period") ?? "").trim().slice(0, 100) || null;
  const { data, error } = await admin.from("study").update({
    name: name.data,
    period,
    status: status.data,
    dashboard_config: dashboardConfigFromSections(sections),
    journey_definition: journey.data,
  }).eq("id", studyId.data).select("id").maybeSingle();
  if (error || !data) finish("error", `No se pudo guardar la configuración: ${error?.message ?? "estudio inexistente"}`);
  revalidatePath("/admin/studies");
  revalidatePath("/dashboard");
  finish("ok", status.data === "published" ? "Configuración guardada y estudio publicado." : "Configuración del estudio guardada.");
}
