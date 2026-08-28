import type { SupabaseClient } from "@supabase/supabase-js";
import { keysetWindow, selectAllPages } from "@/lib/supabase/paginate";
import type { LongRow } from "./engine";

/**
 * Bounds for one study. They are refusal thresholds, not page sizes: reaching
 * one means the study is larger than this loader is willing to read in full,
 * and the caller gets an error instead of a silently partial aggregate.
 */
const MAX_RESPONSES = 500_000;
const MAX_RESPONDENTS = 50_000;

/** Both reads carry the primary key: it is the keyset cursor, not a value the
 * caller uses. See src/lib/supabase/paginate.ts. */
type ResponseRow = {
  id: string;
  respondent_id: string;
  metric_key: string;
  value: number | string | null;
};
type RespondentRow = { id: string; segments: Record<string, unknown> | null };

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
    selectAllPages<ResponseRow>(
      "quant_response",
      (cursor, size) =>
        keysetWindow(
          client
            .from("quant_response")
            .select("id, respondent_id, metric_key, value")
            .eq("study_id", studyId),
          { column: "id", cursor, size },
        ).returns<ResponseRow[]>(),
      { maxRows: MAX_RESPONSES, cursorOf: (row) => row.id },
    ),
    selectAllPages<RespondentRow>(
      "respondent",
      (cursor, size) =>
        keysetWindow(
          client.from("respondent").select("id, segments").eq("study_id", studyId),
          { column: "id", cursor, size },
        ).returns<RespondentRow[]>(),
      { maxRows: MAX_RESPONDENTS, cursorOf: (row) => row.id },
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
