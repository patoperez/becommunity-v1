import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { PeriodPoint } from "@/lib/ingestion/period-series";

/** migration 0019: `expected_periods between 1 and 240`. */
const MAX_PERIODS = 240;

export async function loadLatestPeriodSeries(client: SupabaseClient, studyId: string): Promise<PeriodPoint[]> {
  const { data: latest, error: latestError } = await client.from("period_series_import")
    .select("id")
    .eq("study_id", studyId)
    .eq("status", "committed")
    .order("committed_at", { ascending: false })
    .limit(1)
    .maybeSingle<{ id: string }>();
  if (latestError) throw new Error(`period_series_import: ${latestError.message}`);
  if (!latest) return [];
  const { data, error } = await client.from("study_period_snapshot")
    .select("period_label, period_order, starting_members, new_members, ending_members, lost_members, retention_rate, churn_rate")
    .eq("import_id", latest.id)
    .order("period_order")
    // One import can carry at most 240 periods (migration 0019 enforces it), so
    // this is a complete read, not a first page.
    .limit(MAX_PERIODS)
    .returns<Record<string, unknown>[]>();
  if (error) throw new Error(`study_period_snapshot: ${error.message}`);
  return (data ?? []).map((row) => ({
    periodLabel: String(row.period_label),
    periodOrder: Number(row.period_order),
    startingMembers: Number(row.starting_members),
    newMembers: Number(row.new_members),
    endingMembers: Number(row.ending_members),
    lostMembers: Number(row.lost_members),
    retention: Number(row.retention_rate),
    churn: Number(row.churn_rate),
  }));
}

