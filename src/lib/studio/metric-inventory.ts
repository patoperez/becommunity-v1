import "server-only";

import type { LongRow } from "@/lib/calc/engine";
import type { createAdminClient } from "@/lib/supabase/admin";
import { journeyMetricOptions, type JourneyMetricOption } from "./journey-picker";

/**
 * Which results each study genuinely produced, for the recorrido picker (P8.2).
 *
 * Read AFTER the caller has proved an internal role, with the already-created
 * admin client.
 *
 * IT READS ONLY WHAT THE PICKER NEEDS. `computeStageMetric` looks at
 * `metric_key` and `value` and nothing else, so this loader deliberately does
 * not join respondents or read segments: the picker never needs to know who
 * answered, and the smallest query that can answer the question is the one that
 * cannot leak more than the answer.
 *
 * Several studies are answered in ONE query, because the configurator renders a
 * page of studies at a time and one round trip per study would turn a page into
 * a queue.
 */

const MAX_RESPONSES = 200_000;

type ResponseRow = { study_id: string; metric_key: string; value: number | string | null };

export async function loadStudyMetricOptions(
  admin: ReturnType<typeof createAdminClient>,
  studyIds: string[],
): Promise<Record<string, JourneyMetricOption[]>> {
  const options: Record<string, JourneyMetricOption[]> = Object.fromEntries(
    studyIds.map((studyId) => [studyId, []]),
  );
  if (studyIds.length === 0) return options;

  const { data, error } = await admin
    .from("quant_response")
    .select("study_id, metric_key, value")
    .in("study_id", studyIds)
    .limit(MAX_RESPONSES)
    .returns<ResponseRow[]>();
  if (error) throw new Error(`quant_response metrics: ${error.message}`);

  const byStudy = new Map<string, LongRow[]>();
  for (const row of data ?? []) {
    const value = Number(row.value);
    // A non-numeric answer is not aggregated anywhere else either; including it
    // here would offer a result whose preview the engine could not reproduce.
    if (!Number.isFinite(value)) continue;
    const studyId = String(row.study_id);
    if (!(studyId in options)) continue;
    const rows = byStudy.get(studyId) ?? [];
    rows.push({ respondent_id: "", metric_key: String(row.metric_key), value });
    byStudy.set(studyId, rows);
  }
  for (const studyId of studyIds) {
    options[studyId] = journeyMetricOptions(byStudy.get(studyId) ?? []);
  }
  return options;
}
