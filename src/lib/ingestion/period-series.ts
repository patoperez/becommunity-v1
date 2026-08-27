import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { churnRate, retentionRate } from "@/lib/calc/business-metrics";
import type { IngestError, ParsedFile } from "./canonical";

export const periodPointSchema = z.object({
  periodLabel: z.string().trim().min(1).max(100),
  periodOrder: z.number().int().min(0).max(9999),
  startingMembers: z.number().int().nonnegative(),
  newMembers: z.number().int().nonnegative(),
  endingMembers: z.number().int().nonnegative(),
  lostMembers: z.number().int().nonnegative(),
  retention: z.number().min(0).max(100),
  churn: z.number().min(0).max(100),
});

export type PeriodPoint = z.infer<typeof periodPointSchema>;
export type PeriodSeriesAdaptResult =
  | { ok: true; points: PeriodPoint[] }
  | { ok: false; errors: IngestError[] };

const FIELD_ALIASES = {
  periodLabel: ["periodo", "period", "mes"],
  startingMembers: ["miembros_inicio", "miembros inicio", "miembros al inicio", "inicio"],
  newMembers: ["miembros_nuevos", "miembros nuevos", "nuevos"],
  endingMembers: ["miembros_final", "miembros final", "miembros al final", "final"],
  lostMembers: ["miembros_perdidos", "miembros perdidos", "perdidos"],
  retention: ["retencion", "retencion_pct", "retención", "retención (%)"],
  churn: ["desercion", "desercion_pct", "deserción", "deserción (%)"],
} as const;

function normalized(value: string): string {
  return value.trim().normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("es-MX");
}

function findHeader(headers: string[], aliases: readonly string[]): string | null {
  const wanted = new Set(aliases.map(normalized));
  return headers.find((header) => wanted.has(normalized(header))) ?? null;
}

function parseCount(raw: string): number | null {
  const cleaned = raw.trim().replace(/[\s,]/g, "");
  if (!/^\d+$/.test(cleaned)) return null;
  const value = Number(cleaned);
  return Number.isSafeInteger(value) ? value : null;
}

function parsePercent(raw: string): number | null {
  const cleaned = raw.trim().replace("%", "").replace(",", ".");
  if (cleaned === "") return null;
  const value = Number(cleaned);
  return Number.isFinite(value) ? value : null;
}

/** Reads aggregate period rows without ever treating them as respondents. */
export function adaptPeriodSeries(file: ParsedFile): PeriodSeriesAdaptResult {
  const periodHeader = findHeader(file.headers, FIELD_ALIASES.periodLabel);
  const startHeader = findHeader(file.headers, FIELD_ALIASES.startingMembers);
  const newHeader = findHeader(file.headers, FIELD_ALIASES.newMembers);
  const endHeader = findHeader(file.headers, FIELD_ALIASES.endingMembers);
  const lostHeader = findHeader(file.headers, FIELD_ALIASES.lostMembers);
  const retentionHeader = findHeader(file.headers, FIELD_ALIASES.retention);
  const churnHeader = findHeader(file.headers, FIELD_ALIASES.churn);
  const required = [
    ["Periodo", periodHeader],
    ["Miembros al inicio", startHeader],
    ["Miembros nuevos", newHeader],
    ["Miembros al final", endHeader],
    ["Miembros perdidos", lostHeader],
  ] as const;
  const missing = required.filter(([, header]) => !header).map(([label]) => label);
  if (missing.length > 0) {
    return { ok: false, errors: [{ row: null, column: null, message: `Faltan columnas: ${missing.join(", ")}.` }] };
  }

  const errors: IngestError[] = [];
  const points: PeriodPoint[] = [];
  file.rows.forEach((row, index) => {
    const rowNumber = index + 2;
    const periodLabel = String(row[periodHeader!] ?? "").trim();
    const counts = [startHeader!, newHeader!, endHeader!, lostHeader!].map((header) => parseCount(String(row[header] ?? "")));
    if (!periodLabel) errors.push({ row: rowNumber, column: periodHeader, message: "El periodo no puede quedar vacío." });
    counts.forEach((value, countIndex) => {
      if (value === null) errors.push({ row: rowNumber, column: [startHeader, newHeader, endHeader, lostHeader][countIndex], message: "Debe ser un conteo entero mayor o igual a cero." });
    });
    if (!periodLabel || counts.some((value) => value === null)) return;
    const [startingMembers, newMembers, endingMembers, lostMembers] = counts as number[];
    if (startingMembers === 0) {
      errors.push({ row: rowNumber, column: startHeader, message: "El inicio debe ser mayor que cero para calcular tasas." });
      return;
    }
    if (endingMembers !== startingMembers - lostMembers + newMembers) {
      errors.push({ row: rowNumber, column: endHeader, message: "El cierre no coincide con inicio − pérdidas + altas nuevas." });
      return;
    }
    try {
      const retention = retentionRate(startingMembers, endingMembers, newMembers).value;
      const churn = churnRate(startingMembers, lostMembers).value;
      if (retention === null || churn === null) return;
      const suppliedRetention = retentionHeader ? parsePercent(String(row[retentionHeader] ?? "")) : null;
      const suppliedChurn = churnHeader ? parsePercent(String(row[churnHeader] ?? "")) : null;
      if (suppliedRetention !== null && Math.abs(suppliedRetention - retention) > 0.11) {
        errors.push({ row: rowNumber, column: retentionHeader, message: `La retención escrita (${suppliedRetention}%) no coincide con los conteos (${retention}%).` });
      }
      if (suppliedChurn !== null && Math.abs(suppliedChurn - churn) > 0.11) {
        errors.push({ row: rowNumber, column: churnHeader, message: `La deserción escrita (${suppliedChurn}%) no coincide con los conteos (${churn}%).` });
      }
      points.push({ periodLabel, periodOrder: index, startingMembers, newMembers, endingMembers, lostMembers, retention, churn });
    } catch (error) {
      errors.push({ row: rowNumber, column: null, message: (error as Error).message });
    }
  });
  if (errors.length > 0) return { ok: false, errors };
  if (points.length === 0) return { ok: false, errors: [{ row: null, column: null, message: "El archivo no contiene periodos utilizables." }] };
  return { ok: true, points };
}

export async function persistPeriodSeries(client: SupabaseClient, params: {
  tenantId: string;
  studyId: string;
  sourceSignature: string;
  fileName: string;
  createdBy: string;
  points: PeriodPoint[];
}): Promise<string> {
  const points = z.array(periodPointSchema).min(1).max(240).parse(params.points);
  const { data: batch, error: stageError } = await client.from("period_series_import").insert({
    tenant_id: params.tenantId,
    study_id: params.studyId,
    source_signature: params.sourceSignature,
    file_name: params.fileName,
    expected_periods: points.length,
    created_by: params.createdBy,
  }).select("id").single<{ id: string }>();
  if (stageError || !batch) throw new Error(`No se pudo preparar la serie: ${stageError?.message ?? "respuesta vacía"}`);
  const { data, error } = await client.rpc("commit_period_series_import", {
    p_import_id: batch.id,
    p_periods: points,
  });
  if (error) {
    await client.from("period_series_import").update({
      status: "failed",
      error_message: error.message.replace(/[\r\n\t]+/g, " ").slice(0, 1_000),
    }).eq("id", batch.id).eq("status", "staged");
    throw new Error(`No se pudo guardar la serie: ${error.message}`);
  }
  const result = data as { import_id?: string; periods?: number } | null;
  if (result?.import_id !== batch.id || result.periods !== points.length) throw new Error("La base devolvió un conteo distinto al revisado.");
  return batch.id;
}
