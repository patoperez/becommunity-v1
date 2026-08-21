"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { normalizeTheme, suggestTheme } from "@/lib/qualitative/suggest";

const uuid = z.string().uuid();
const idsSchema = z.array(z.string().uuid()).min(1).max(100);

async function internalContext() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { data: profile } = await supabase.from("profiles").select("role").eq("user_id", user.id).single<{ role: string }>();
  if (profile?.role !== "internal") throw new Error("Acceso denegado.");
  return { user, admin: createAdminClient() };
}

function finish(studyId: string, kind: "ok" | "error", message: string): never {
  redirect(`/admin/qualitative?study=${studyId}&${kind}=${encodeURIComponent(message)}`);
}

export async function generateSuggestions(formData: FormData) {
  const { admin } = await internalContext();
  const studyId = uuid.safeParse(formData.get("study_id"));
  if (!studyId.success) finish("", "error", "Estudio inválido.");
  const { data: study } = await admin.from("study").select("id").eq("id", studyId.data).maybeSingle();
  if (!study) finish(studyId.data, "error", "El estudio no existe.");
  const { data, error } = await admin.from("qual_observation")
    .select("id, quote, theme").eq("study_id", studyId.data).eq("review_status", "pending")
    .is("suggested_theme", null).limit(500)
    .returns<{ id: string; quote: string | null; theme: string | null }[]>();
  if (error) finish(studyId.data, "error", `No se pudieron cargar las observaciones: ${error.message}`);
  const updates = await Promise.all((data ?? []).map((row) => admin.from("qual_observation")
    .update({ suggested_theme: suggestTheme(row.quote ?? "", row.theme) }).eq("id", row.id).eq("study_id", studyId.data)));
  const failed = updates.find((result) => result.error)?.error;
  if (failed) finish(studyId.data, "error", `No se pudieron guardar las sugerencias: ${failed.message}`);
  revalidatePath("/admin/qualitative");
  finish(studyId.data, "ok", `${updates.length} sugerencias generadas. Aún no son visibles para el cliente.`);
}

export async function reviewObservations(formData: FormData) {
  const { user, admin } = await internalContext();
  const studyId = uuid.safeParse(formData.get("study_id"));
  const ids = idsSchema.safeParse(formData.getAll("observation_id"));
  const mode = z.enum(["accept", "retag", "reject"]).safeParse(formData.get("mode"));
  if (!studyId.success || !ids.success || !mode.success) finish(studyId.success ? studyId.data : "", "error", "Selecciona observaciones y una acción válida.");
  const quoteIds = idsSchema.max(100).safeParse(formData.getAll("quote_id"));
  const theme = mode.data === "retag" ? normalizeTheme(String(formData.get("theme") ?? "")) : "";
  if (mode.data === "retag" && !theme) finish(studyId.data, "error", "Escribe el tema confirmado para reetiquetar o fusionar.");
  const stageKey = normalizeTheme(String(formData.get("stage_key") ?? ""));
  const { data, error } = await admin.rpc("review_qual_observations", {
    p_ids: ids.data,
    p_study_id: studyId.data,
    p_mode: mode.data,
    p_theme: theme,
    p_stage_key: stageKey,
    p_quote_ids: quoteIds.success ? quoteIds.data.filter((id) => ids.data.includes(id)) : [],
    p_reviewer: user.id,
  });
  if (error) finish(studyId.data, "error", `No se pudo guardar la revisión: ${error.message}`);
  revalidatePath("/admin/qualitative");
  revalidatePath("/dashboard");
  const verb = mode.data === "reject" ? "rechazadas" : mode.data === "retag" ? "reetiquetadas/fusionadas" : "confirmadas";
  finish(studyId.data, "ok", `${Number(data)} observaciones ${verb}.`);
}
