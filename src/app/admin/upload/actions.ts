"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { parseFile } from "@/lib/ingestion/parse";
import { previewMappedImport } from "@/lib/ingestion/preview";
import {
  importMappingSchema,
  sourceSignature,
  type ImportMapping,
} from "@/lib/ingestion/mapping";
import { persistRespondents, rollbackImportBatch } from "@/lib/ingestion/persist";
import type { ImportPreviewRow, IngestError, IngestSummary, ParsedFile } from "@/lib/ingestion/canonical";
import { ALLOWED_UPLOAD_EXTENSIONS, MAX_UPLOAD_BYTES } from "@/lib/validation/schemas";
import { templatePayloadSchema } from "@/lib/templates/schema";

type AdminClient = ReturnType<typeof createAdminClient>;

export type ColumnSample = {
  header: string;
  samples: string[];
};

/**
 * Destinations this client's data already uses, so the mapping step can OFFER
 * them instead of asking anyone to retype one from memory (P8.2, contract C1).
 * Names only — no value, no respondent, no quote. Reusing an existing
 * destination is also what keeps two periods of one study comparable.
 */
export type KnownDestinations = {
  segments: string[];
  metrics: string[];
  themes: string[];
};

export type AnalyzeResult =
  | { status: "error"; message: string }
  | {
      status: "ready";
      fileName: string;
      signature: string;
      sourceRows: number;
      columns: ColumnSample[];
      mapping: ImportMapping;
      mappingId: string | null;
      mappingVersion: number | null;
      mappingSource: "saved" | "template" | "suggested";
      knownDestinations: KnownDestinations;
      notice?: string;
    };

export type PreviewResult =
  | { status: "error"; message: string; errors?: IngestError[] }
  | {
      status: "ready";
      signature: string;
      sourceRows: number;
      summary: IngestSummary;
      sample: ImportPreviewRow[];
      mapping: ImportMapping;
    };

export type ConfirmResult =
  | { status: "error"; message: string; errors?: IngestError[] }
  | {
      status: "success";
      message: string;
      summary: IngestSummary;
      importBatchId: string;
      mappingVersion: number;
      mappingReused: boolean;
    };

export type RollbackResult =
  | { status: "error"; message: string }
  | { status: "success"; message: string };

const tenantSchema = z.string().uuid("Cliente inválido.");
const mappingJsonSchema = z.string().min(2).max(500_000, "El mapeo es demasiado grande.");
const targetSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("existing"), studyId: z.string().uuid("Estudio inválido.") }),
  z.object({
    mode: z.literal("new"),
    studyName: z.string().trim().min(1, "Indica el nombre del estudio.").max(200),
    period: z.string().trim().max(100).optional(),
  }),
]);

async function authorizeInternal(): Promise<
  | { ok: true; userId: string; admin: AdminClient }
  | { ok: false; message: string }
> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, message: "No autenticado." };

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("user_id", user.id)
    .single<{ role: string }>();
  if (profile?.role !== "internal") {
    return { ok: false, message: "Acceso denegado: esta operación es solo para el equipo interno." };
  }
  return { ok: true, userId: user.id, admin: createAdminClient() };
}

async function verifyTenant(admin: AdminClient, rawTenantId: FormDataEntryValue | null) {
  const parsed = tenantSchema.safeParse(rawTenantId);
  if (!parsed.success) return { ok: false as const, message: parsed.error.issues[0]?.message ?? "Cliente inválido." };
  const { data, error } = await admin
    .from("tenant")
    .select("id, name")
    .eq("id", parsed.data)
    .maybeSingle<{ id: string; name: string }>();
  if (error) return { ok: false as const, message: `No se pudo verificar el cliente: ${error.message}` };
  if (!data) return { ok: false as const, message: "El cliente seleccionado no existe." };
  return { ok: true as const, tenant: data };
}

async function readUpload(formData: FormData): Promise<
  | { ok: true; file: File; parsed: ParsedFile }
  | { ok: false; message: string }
> {
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, message: "Adjunta un archivo CSV o Excel." };
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return { ok: false, message: "El archivo supera el límite de 10 MB." };
  }
  const ext = file.name.toLowerCase().split(".").pop() ?? "";
  if (!ALLOWED_UPLOAD_EXTENSIONS.includes(ext as (typeof ALLOWED_UPLOAD_EXTENSIONS)[number])) {
    return { ok: false, message: "Formato no soportado. Usa CSV o Excel (.csv, .xlsx, .xlsm)." };
  }
  try {
    return { ok: true, file, parsed: await parseFile(file.name, await file.arrayBuffer()) };
  } catch (error) {
    return { ok: false, message: `No se pudo leer el archivo: ${(error as Error).message}` };
  }
}

function suggestedKey(header: string, prefix: string): string {
  const stripped = header.toLocaleLowerCase("es-MX").startsWith(prefix)
    ? header.slice(prefix.length)
    : header;
  const normalized = stripped
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("es-MX")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 64);
  return /^[a-z]/.test(normalized) ? normalized : `campo_${normalized || "sin_nombre"}`.slice(0, 64);
}

function suggestedMapping(file: ParsedFile, fileName: string): ImportMapping {
  return {
    version: 1,
    name: `Mapeo ${fileName.replace(/\.[^.]+$/, "")}`.slice(0, 120),
    columns: file.headers.map((sourceColumn) => {
      const normalized = sourceColumn.trim().toLocaleLowerCase("es-MX");
      if (normalized.startsWith("seg_")) {
        return { sourceColumn, target: { kind: "segment" as const, key: suggestedKey(sourceColumn, "seg_") } };
      }
      if (normalized.startsWith("q_")) {
        return { sourceColumn, target: { kind: "quantitative" as const, metricKey: suggestedKey(sourceColumn, "q_") } };
      }
      if (normalized.startsWith("qual_")) {
        return { sourceColumn, target: { kind: "qualitative" as const, theme: suggestedKey(sourceColumn, "qual_"), source: "encuesta" as const } };
      }
      return { sourceColumn, target: { kind: "ignore" as const } };
    }),
    recodingTables: [],
  };
}

/** Only names the mapping schema could actually store are ever offered. */
const STORABLE_KEY = /^[a-z][a-z0-9_]{0,63}$/;
const MAX_DESTINATIONS = 200;

function collect(values: Iterable<unknown>): string[] {
  const keys = new Set<string>();
  for (const value of values) {
    if (typeof value !== "string") continue;
    const key = value.trim();
    if (STORABLE_KEY.test(key)) keys.add(key);
    if (keys.size >= MAX_DESTINATIONS) break;
  }
  return [...keys].sort((a, b) => a.localeCompare(b, "es-MX"));
}

async function loadKnownDestinations(
  admin: AdminClient,
  tenantId: string,
): Promise<KnownDestinations> {
  const [{ data: respondents }, { data: metrics }, { data: themes }] = await Promise.all([
    admin.from("respondent").select("segments").eq("tenant_id", tenantId).limit(2_000)
      .returns<{ segments: unknown }[]>(),
    admin.from("quant_response").select("metric_key").eq("tenant_id", tenantId).limit(5_000)
      .returns<{ metric_key: string }[]>(),
    admin.from("qual_observation").select("theme").eq("tenant_id", tenantId).limit(5_000)
      .returns<{ theme: string | null }[]>(),
  ]);
  const segmentKeys: string[] = [];
  for (const row of respondents ?? []) {
    if (row.segments && typeof row.segments === "object" && !Array.isArray(row.segments)) {
      segmentKeys.push(...Object.keys(row.segments as Record<string, unknown>));
    }
  }
  return {
    segments: collect(segmentKeys),
    metrics: collect((metrics ?? []).map((row) => row.metric_key)),
    themes: collect((themes ?? []).map((row) => row.theme)),
  };
}

function columnSamples(file: ParsedFile): ColumnSample[] {
  return file.headers.map((header) => {
    const values = new Set<string>();
    for (const row of file.rows) {
      const value = String(row[header] ?? "").trim();
      if (value) values.add(value);
      if (values.size === 4) break;
    }
    return { header, samples: [...values] };
  });
}

function readMapping(formData: FormData): { ok: true; mapping: ImportMapping } | { ok: false; message: string } {
  const raw = mappingJsonSchema.safeParse(formData.get("mapping_json"));
  if (!raw.success) return { ok: false, message: raw.error.issues[0]?.message ?? "Mapeo inválido." };
  let value: unknown;
  try {
    value = JSON.parse(raw.data);
  } catch {
    return { ok: false, message: "El mapeo no contiene JSON válido." };
  }
  const mapping = importMappingSchema.safeParse(value);
  if (!mapping.success) {
    return { ok: false, message: `Mapeo inválido: ${mapping.error.issues[0]?.message ?? "configuración incorrecta"}` };
  }
  return { ok: true, mapping: mapping.data };
}

export async function analyzeImportFile(formData: FormData): Promise<AnalyzeResult> {
  const auth = await authorizeInternal();
  if (!auth.ok) return { status: "error", message: auth.message };
  const tenant = await verifyTenant(auth.admin, formData.get("tenant_id"));
  if (!tenant.ok) return { status: "error", message: tenant.message };
  const upload = await readUpload(formData);
  if (!upload.ok) return { status: "error", message: upload.message };

  let signature: string;
  try {
    signature = await sourceSignature(upload.parsed.headers);
  } catch (error) {
    return { status: "error", message: (error as Error).message };
  }

  const { data: saved, error } = await auth.admin
    .from("import_mapping")
    .select("id, version, configuration")
    .eq("tenant_id", tenant.tenant.id)
    .eq("source_signature", signature)
    .eq("is_active", true)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle<{ id: string; version: number; configuration: unknown }>();
  if (error) return { status: "error", message: `No se pudo buscar un mapeo previo: ${error.message}` };

  const parsedSaved = saved ? importMappingSchema.safeParse(saved.configuration) : null;
  let templateMapping: ImportMapping | null = null;
  const studyId = z.string().uuid().safeParse(formData.get("study_id"));
  if (!parsedSaved?.success && studyId.success) {
    const { data: study } = await auth.admin.from("study")
      .select("template_snapshot")
      .eq("id", studyId.data)
      .eq("tenant_id", tenant.tenant.id)
      .maybeSingle<{ template_snapshot: unknown }>();
    const snapshot = templatePayloadSchema.safeParse(study?.template_snapshot);
    templateMapping = snapshot.success
      ? snapshot.data.columnMappings.find((candidate) => candidate.sourceSignature === signature)?.mapping ?? null
      : null;
  }
  const mapping = parsedSaved?.success
    ? parsedSaved.data
    : templateMapping ?? suggestedMapping(upload.parsed, upload.file.name);
  const knownDestinations = await loadKnownDestinations(auth.admin, tenant.tenant.id);

  return {
    status: "ready",
    fileName: upload.file.name,
    signature,
    sourceRows: upload.parsed.rows.length,
    columns: columnSamples(upload.parsed),
    mapping,
    mappingId: parsedSaved?.success ? saved?.id ?? null : null,
    mappingVersion: parsedSaved?.success ? saved?.version ?? null : null,
    mappingSource: parsedSaved?.success ? "saved" : templateMapping ? "template" : "suggested",
    knownDestinations,
    notice: saved && !parsedSaved?.success
      ? "La lectura guardada ya no se puede aplicar tal cual, así que se preparó una propuesta nueva. Revísala con cuidado."
      : templateMapping ? "Se reconoció la estructura guardada en la plantilla del estudio." : undefined,
  };
}

export async function previewImportFile(formData: FormData): Promise<PreviewResult> {
  const auth = await authorizeInternal();
  if (!auth.ok) return { status: "error", message: auth.message };
  const tenant = await verifyTenant(auth.admin, formData.get("tenant_id"));
  if (!tenant.ok) return { status: "error", message: tenant.message };
  const upload = await readUpload(formData);
  if (!upload.ok) return { status: "error", message: upload.message };
  const mapping = readMapping(formData);
  if (!mapping.ok) return { status: "error", message: mapping.message };

  try {
    const preview = await previewMappedImport(upload.parsed, mapping.mapping, 5);
    if (!preview.result.ok) {
      return {
        status: "error",
        message: "Corrige los errores antes de confirmar. No se guardó ningún dato.",
        errors: preview.result.errors,
      };
    }
    return {
      status: "ready",
      signature: preview.signature,
      sourceRows: preview.sourceRows,
      summary: preview.result.summary,
      sample: preview.sample,
      mapping: mapping.mapping,
    };
  } catch (error) {
    return { status: "error", message: `No se pudo generar la vista previa: ${(error as Error).message}` };
  }
}

async function saveMapping(
  admin: AdminClient,
  params: { tenantId: string; signature: string; mapping: ImportMapping; userId: string },
) {
  const { data, error } = await admin.rpc("save_import_mapping", {
    p_tenant_id: params.tenantId,
    p_source_signature: params.signature,
    p_name: params.mapping.name,
    p_configuration: params.mapping,
    p_created_by: params.userId,
  });
  if (error) throw new Error(`No se pudo guardar el mapeo: ${error.message}`);
  const result = data as { id?: string; version?: number; reused?: boolean } | null;
  if (!result?.id || !Number.isSafeInteger(result.version) || typeof result.reused !== "boolean") {
    throw new Error("La base de datos devolvió una versión de mapeo inválida.");
  }
  return { id: result.id, version: result.version as number, reused: result.reused };
}

export async function confirmImportFile(formData: FormData): Promise<ConfirmResult> {
  const auth = await authorizeInternal();
  if (!auth.ok) return { status: "error", message: auth.message };
  const tenant = await verifyTenant(auth.admin, formData.get("tenant_id"));
  if (!tenant.ok) return { status: "error", message: tenant.message };
  const upload = await readUpload(formData);
  if (!upload.ok) return { status: "error", message: upload.message };
  const mapping = readMapping(formData);
  if (!mapping.ok) return { status: "error", message: mapping.message };

  const targetRaw = formData.get("study_mode") === "existing"
    ? { mode: "existing", studyId: formData.get("study_id") }
    : {
        mode: "new",
        studyName: formData.get("study_name"),
        period: String(formData.get("period") ?? "").trim() || undefined,
      };
  const target = targetSchema.safeParse(targetRaw);
  if (!target.success) {
    return { status: "error", message: target.error.issues[0]?.message ?? "Destino inválido." };
  }

  let preview;
  try {
    preview = await previewMappedImport(upload.parsed, mapping.mapping, 5);
  } catch (error) {
    return { status: "error", message: `No se pudo validar la importación: ${(error as Error).message}` };
  }
  if (!preview.result.ok) {
    return {
      status: "error",
      message: "El archivo cambió o contiene errores. No se guardó ningún dato.",
      errors: preview.result.errors,
    };
  }

  let studyId: string;
  let studyName: string;
  let createdStudyId: string | null = null;
  if (target.data.mode === "existing") {
    const { data: study, error } = await auth.admin
      .from("study")
      .select("id, name")
      .eq("id", target.data.studyId)
      .eq("tenant_id", tenant.tenant.id)
      .maybeSingle<{ id: string; name: string }>();
    if (error) return { status: "error", message: `No se pudo verificar el estudio: ${error.message}` };
    if (!study) return { status: "error", message: "El estudio no pertenece al cliente seleccionado." };
    studyId = study.id;
    studyName = study.name;
  } else {
    const { data: study, error } = await auth.admin
      .from("study")
      .insert({
        tenant_id: tenant.tenant.id,
        name: target.data.studyName,
        period: target.data.period ?? null,
        status: "draft",
      })
      .select("id, name")
      .single<{ id: string; name: string }>();
    if (error || !study) {
      return { status: "error", message: `No se pudo crear el estudio: ${error?.message ?? "respuesta vacía"}` };
    }
    studyId = study.id;
    studyName = study.name;
    createdStudyId = study.id;
  }

  try {
    const savedMapping = await saveMapping(auth.admin, {
      tenantId: tenant.tenant.id,
      signature: preview.signature,
      mapping: mapping.mapping,
      userId: auth.userId,
    });
    const summary = await persistRespondents(auth.admin, {
      tenantId: tenant.tenant.id,
      studyId,
      mappingId: savedMapping.id,
      sourceSignature: preview.signature,
      fileName: upload.file.name,
      sourceRows: upload.parsed.rows.length,
      createdBy: auth.userId,
      respondents: preview.result.respondents,
    });
    revalidatePath("/admin/upload");
    revalidatePath("/dashboard");
    return {
      status: "success",
      message: `Importación confirmada en “${studyName}” (${tenant.tenant.name}).`,
      summary,
      importBatchId: summary.importBatchId,
      mappingVersion: savedMapping.version,
      mappingReused: savedMapping.reused,
    };
  } catch (error) {
    if (createdStudyId) await auth.admin.from("study").delete().eq("id", createdStudyId);
    return { status: "error", message: `No se pudo confirmar la importación: ${(error as Error).message}` };
  }
}

export async function rollbackLatestImport(importBatchId: string): Promise<RollbackResult> {
  const auth = await authorizeInternal();
  if (!auth.ok) return { status: "error", message: auth.message };
  const parsedId = z.string().uuid().safeParse(importBatchId);
  if (!parsedId.success) return { status: "error", message: "Lote inválido." };

  const { data: latest, error } = await auth.admin
    .from("import_batch")
    .select("id, file_name")
    .eq("status", "committed")
    .order("committed_at", { ascending: false })
    .limit(1)
    .maybeSingle<{ id: string; file_name: string }>();
  if (error) return { status: "error", message: `No se pudo verificar el historial: ${error.message}` };
  if (!latest || latest.id !== parsedId.data) {
    return { status: "error", message: "Solo se puede revertir la importación confirmada más reciente." };
  }

  try {
    await rollbackImportBatch(auth.admin, latest.id);
    revalidatePath("/admin/upload");
    revalidatePath("/dashboard");
    return { status: "success", message: `Se revirtió “${latest.file_name}” sin afectar otros lotes.` };
  } catch (error) {
    return { status: "error", message: `No se pudo revertir el lote: ${(error as Error).message}` };
  }
}
