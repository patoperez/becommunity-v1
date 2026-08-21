"use server";

import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { parseJourneyDefinition } from "@/lib/calc/journey";
import {
  buildSegmentFilterOptions,
  filterRowsBySegments,
  validateSegmentFilters,
  type SegmentFilters,
} from "@/lib/calc/filters";
import { buildAllowlist, computePivot, validatePivotIntent, type PivotIntent } from "@/lib/calc/pivot";
import { buildStudyDashboard, sanitizePivotResult, type SafePivotResult, type StudyDashboardPayload } from "@/lib/dashboard/view";
import { loadAuthorizedStudyData } from "@/lib/studies/authorized";

const studyIdSchema = z.string().uuid();
const filtersSchema = z.record(z.string().min(1).max(80), z.string().max(200))
  .refine((value) => Object.keys(value).length <= 20, "Demasiados filtros");
const pivotIntentSchema = z.object({
  rows: z.array(z.string()).max(2),
  columns: z.array(z.string()).max(2),
  values: z.array(z.object({
    field: z.string(),
    agg: z.enum(["avg", "count", "sum", "min", "max"]),
  })).min(1).max(3),
});

type ActionResult<T> = { ok: true; data: T } | { ok: false; error: string };

async function authenticatedStudy(studyId: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const data = await loadAuthorizedStudyData(supabase, studyId);
  return data ? { supabase, ...data } : null;
}

export async function refreshStudyDashboard(
  rawStudyId: string,
  rawFilters: SegmentFilters,
): Promise<ActionResult<StudyDashboardPayload>> {
  const id = studyIdSchema.safeParse(rawStudyId);
  const parsedFilters = filtersSchema.safeParse(rawFilters);
  if (!id.success || !parsedFilters.success) return { ok: false, error: "Solicitud invalida" };
  const context = await authenticatedStudy(id.data);
  if (!context) return { ok: false, error: "Estudio no disponible" };
  try {
    return {
      ok: true,
      data: buildStudyDashboard(
        context.rows,
        context.qualitative,
        parseJourneyDefinition(context.study.journey_definition),
        parsedFilters.data,
        context.study.dashboard_config,
      ),
    };
  } catch {
    return { ok: false, error: "No fue posible recalcular el estudio" };
  }
}

export async function computeStudyPivot(
  rawStudyId: string,
  rawFilters: SegmentFilters,
  rawIntent: PivotIntent,
): Promise<ActionResult<SafePivotResult>> {
  const id = studyIdSchema.safeParse(rawStudyId);
  const parsedFilters = filtersSchema.safeParse(rawFilters);
  const intent = pivotIntentSchema.safeParse(rawIntent);
  if (!id.success || !parsedFilters.success || !intent.success) return { ok: false, error: "Solicitud invalida" };
  const context = await authenticatedStudy(id.data);
  if (!context) return { ok: false, error: "Estudio no disponible" };
  try {
    const rows = context.rows;
    const filterOptions = buildSegmentFilterOptions(rows);
    const filterValidation = validateSegmentFilters(parsedFilters.data, filterOptions);
    if (!filterValidation.ok) return { ok: false, error: "Filtros no permitidos" };
    const allowlist = buildAllowlist(rows);
    const pivotValidation = validatePivotIntent(intent.data, allowlist);
    if (!pivotValidation.ok) return { ok: false, error: pivotValidation.errors.join(" ") };
    const filtered = filterRowsBySegments(rows, parsedFilters.data, filterOptions);
    return { ok: true, data: sanitizePivotResult(computePivot(filtered, intent.data, allowlist)) };
  } catch {
    return { ok: false, error: "No fue posible calcular el cruce" };
  }
}
