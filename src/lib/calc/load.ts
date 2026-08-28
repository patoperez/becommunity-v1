import type { SupabaseClient } from "@supabase/supabase-js";
import { selectAllPages } from "@/lib/supabase/paginate";
import type { LongRow } from "./engine";

/**
 * Bounds for one study. They are refusal thresholds, not page sizes: reaching
 * one means the study is larger than this loader is willing to read in full,
 * and the caller gets an error instead of a silently partial aggregate.
 */
const MAX_RESPONSES = 500_000;
const MAX_RESPONDENTS = 50_000;

/**
 * Load one study's quantitative answers as engine-ready long rows, with each
 * respondent's segments flattened onto the row.
 *
 * This low-level loader requires a privileged server client. User-facing code
 * must call loadAuthorizedStudyData, which checks the request session and study
 * through RLS before invoking this function for one exact study ID.
 *
 * All rows are given the SAME segment columns (union across respondents, missing
 * filled with "") so the calculation layer sees a rectangular table. Its column
 * schema is taken from the FIRST row, so a ragged shape would hide the segments
 * that only appear on later rows.
 */
export async function loadStudyRows(
  client: SupabaseClient,
  studyId: string,
): Promise<LongRow[]> {
  // Both sets are read page by page. A single `.select()` would stop at the
  // Data API's 1000-row cap and aggregate a fraction of the study without
  // saying so — see src/lib/supabase/paginate.ts.
  const [responses, respondents] = await Promise.all([
    selectAllPages<{ respondent_id: string; metric_key: string; value: number | string | null }>(
      "quant_response",
      (from, to) =>
        client
          .from("quant_response")
          .select("respondent_id, metric_key, value")
          .eq("study_id", studyId)
          .range(from, to)
          .returns<{ respondent_id: string; metric_key: string; value: number | string | null }[]>(),
      MAX_RESPONSES,
    ),
    selectAllPages<{ id: string; segments: Record<string, unknown> | null }>(
      "respondent",
      (from, to) =>
        client
          .from("respondent")
          .select("id, segments")
          .eq("study_id", studyId)
          .range(from, to)
          .returns<{ id: string; segments: Record<string, unknown> | null }[]>(),
      MAX_RESPONDENTS,
    ),
  ]);

  const segmentsById = new Map<string, Record<string, unknown>>();
  const segmentKeys = new Set<string>();
  for (const r of respondents ?? []) {
    const segs = (r.segments ?? {}) as Record<string, unknown>;
    segmentsById.set(r.id as string, segs);
    for (const k of Object.keys(segs)) segmentKeys.add(k);
  }
  const allSegmentKeys = [...segmentKeys];

  const rows: LongRow[] = [];
  for (const resp of responses ?? []) {
    const value = Number(resp.value);
    if (!Number.isFinite(value)) continue; // null/NaN values are not aggregated
    const segs = segmentsById.get(resp.respondent_id as string) ?? {};
    const row: LongRow = {
      respondent_id: String(resp.respondent_id),
      metric_key: String(resp.metric_key),
      value,
    };
    for (const k of allSegmentKeys) {
      const v = segs[k];
      row[k] = v == null ? "" : String(v);
    }
    rows.push(row);
  }
  return rows;
}
