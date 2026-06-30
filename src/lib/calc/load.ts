import type { SupabaseClient } from "@supabase/supabase-js";
import type { LongRow } from "./engine";

/**
 * Load one study's quantitative answers as engine-ready long rows, with each
 * respondent's segments flattened onto the row.
 *
 * The caller passes the RLS-scoped client (the user's server session), so a
 * client user can only ever load their own tenant's study (§6.2). This function
 * never uses service_role.
 *
 * All rows are given the SAME segment columns (union across respondents, missing
 * filled with "") so Arquero sees a rectangular table.
 */
export async function loadStudyRows(
  client: SupabaseClient,
  studyId: string,
): Promise<LongRow[]> {
  const [{ data: responses, error: rErr }, { data: respondents, error: pErr }] = await Promise.all([
    client
      .from("quant_response")
      .select("respondent_id, metric_key, value")
      .eq("study_id", studyId),
    client.from("respondent").select("id, segments").eq("study_id", studyId),
  ]);
  if (rErr) throw new Error(`quant_response: ${rErr.message}`);
  if (pErr) throw new Error(`respondent: ${pErr.message}`);

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
