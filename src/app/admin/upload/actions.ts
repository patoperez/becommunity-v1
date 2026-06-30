"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { parseFile } from "@/lib/ingestion/parse";
import { wideSurveyAdapter } from "@/lib/ingestion/adapters/wide-survey";
import { persistRespondents } from "@/lib/ingestion/persist";
import type { IngestError, IngestSummary } from "@/lib/ingestion/canonical";

const MAX_BYTES = 10 * 1024 * 1024; // 10 MB

export type IngestState = {
  status: "idle" | "success" | "error";
  message?: string;
  errors?: IngestError[];
  summary?: IngestSummary;
};

/**
 * Server action: ingest a study data file into the canonical schema.
 *
 * Defense in depth (§6.4):
 *  1. AUTHORIZATION on the server — only an authenticated INTERNAL user may load
 *     data. The UI hiding the page is NOT the control; this check is (§6.1 anti-
 *     pattern: "authorization only in the frontend").
 *  2. VALIDATION before the DB — parse + adapter + Zod run first; if anything is
 *     wrong we return clear messages and write NOTHING.
 *  3. Writes use the service_role admin client (§6.3) only after 1 and 2 pass.
 */
export async function ingestStudyFile(
  _prev: IngestState,
  formData: FormData,
): Promise<IngestState> {
  // 1) Authorization ----------------------------------------------------------
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { status: "error", message: "No autenticado." };

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("user_id", user.id)
    .single<{ role: string }>();

  if (profile?.role !== "internal") {
    return {
      status: "error",
      message: "Acceso denegado: solo el equipo interno de Be Community puede cargar datos.",
    };
  }

  // 2) Inputs -----------------------------------------------------------------
  const tenantId = String(formData.get("tenant_id") ?? "");
  const studyName = String(formData.get("study_name") ?? "").trim();
  const period = String(formData.get("period") ?? "").trim() || null;
  const requiredRaw = String(formData.get("required_columns") ?? "").trim();
  const requiredColumns = requiredRaw
    ? requiredRaw.split(",").map((s) => s.trim()).filter(Boolean)
    : [];
  const file = formData.get("file");

  if (!tenantId) return { status: "error", message: "Selecciona un cliente (tenant)." };
  if (!studyName) return { status: "error", message: "Indica el nombre del estudio." };
  if (!(file instanceof File) || file.size === 0) {
    return { status: "error", message: "Adjunta un archivo CSV o Excel." };
  }
  if (file.size > MAX_BYTES) {
    return { status: "error", message: "El archivo supera el límite de 10 MB." };
  }

  const admin = createAdminClient();

  // Verify the target tenant exists (the dropdown is server-sourced, but never
  // trust the submitted value).
  const { data: tenant, error: tenantErr } = await admin
    .from("tenant")
    .select("id, name")
    .eq("id", tenantId)
    .maybeSingle<{ id: string; name: string }>();
  if (tenantErr) return { status: "error", message: `Error verificando el cliente: ${tenantErr.message}` };
  if (!tenant) return { status: "error", message: "El cliente seleccionado no existe." };

  // 3) Parse ------------------------------------------------------------------
  let parsed;
  try {
    parsed = await parseFile(file.name, await file.arrayBuffer());
  } catch (e) {
    return { status: "error", message: `No se pudo leer el archivo: ${(e as Error).message}` };
  }

  // 4) Adapt + validate BEFORE touching the database --------------------------
  const result = wideSurveyAdapter.adapt(parsed, {
    requiredColumns,
    defaultSource: "encuesta",
  });
  if (!result.ok) {
    return {
      status: "error",
      message: "El archivo tiene errores de validación. No se cargó ningún dato.",
      errors: result.errors,
    };
  }

  // 5) Find or create the study (only now that the data is known-good) --------
  let studyId: string;
  const { data: existing } = await admin
    .from("study")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("name", studyName)
    .maybeSingle<{ id: string }>();
  if (existing) {
    studyId = existing.id;
  } else {
    const { data: created, error: createErr } = await admin
      .from("study")
      .insert({ tenant_id: tenantId, name: studyName, period, status: "draft" })
      .select("id")
      .single<{ id: string }>();
    if (createErr || !created) {
      return { status: "error", message: `No se pudo crear el estudio: ${createErr?.message}` };
    }
    studyId = created.id;
  }

  // 6) Persist ----------------------------------------------------------------
  try {
    const summary = await persistRespondents(admin, {
      tenantId,
      studyId,
      respondents: result.respondents,
    });
    revalidatePath("/dashboard");
    return {
      status: "success",
      message: `Carga completa en el estudio "${studyName}" (${tenant.name}).`,
      summary,
    };
  } catch (e) {
    return { status: "error", message: `Error al guardar en la base de datos: ${(e as Error).message}` };
  }
}
