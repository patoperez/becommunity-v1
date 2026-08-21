import type { SupabaseClient } from "@supabase/supabase-js";
import { sampleVisibility } from "@/lib/calc/disclosure";

export type ConfirmedQualitative = {
  id: string;
  respondent_id: string | null;
  theme: string;
  stage_key: string | null;
  quote: string | null;
  source: string | null;
  category: string | null;
} & Record<string, unknown>;

export type QualitativeSummary = {
  themes: { theme: string; count: number; n: number; visibility: ReturnType<typeof sampleVisibility> }[];
  quotes: { id: string; quote: string; theme: string; themeVisibility: ReturnType<typeof sampleVisibility> }[];
};

export async function loadConfirmedQualitative(
  client: SupabaseClient,
  studyId: string,
): Promise<ConfirmedQualitative[]> {
  const [{ data: observations, error: observationError }, { data: respondents, error: respondentError }] = await Promise.all([
    client.from("confirmed_qual_observation")
      .select("id, respondent_id, theme, stage_key, quote, source, category")
      .eq("study_id", studyId),
    client.from("respondent").select("id, segments").eq("study_id", studyId),
  ]);
  if (observationError) throw new Error(`confirmed_qual_observation: ${observationError.message}`);
  if (respondentError) throw new Error(`respondent: ${respondentError.message}`);
  const segments = new Map((respondents ?? []).map((row) => [String(row.id), (row.segments ?? {}) as Record<string, unknown>]));
  return (observations ?? []).map((row) => ({
    id: String(row.id),
    respondent_id: row.respondent_id ? String(row.respondent_id) : null,
    theme: String(row.theme),
    stage_key: row.stage_key ? String(row.stage_key) : null,
    quote: row.quote ? String(row.quote) : null,
    source: row.source ? String(row.source) : null,
    category: row.category ? String(row.category) : null,
    ...(row.respondent_id ? segments.get(String(row.respondent_id)) ?? {} : {}),
  }));
}

export function summarizeConfirmedQualitative(rows: ConfirmedQualitative[]): QualitativeSummary {
  const aggregates = new Map<string, { count: number; units: Set<string> }>();
  for (const row of rows) {
    const aggregate = aggregates.get(row.theme) ?? { count: 0, units: new Set<string>() };
    aggregate.count += 1;
    aggregate.units.add(row.respondent_id ? `r:${row.respondent_id}` : `o:${row.id}`);
    aggregates.set(row.theme, aggregate);
  }
  const themes = [...aggregates.entries()]
    .map(([theme, aggregate]) => ({
      theme,
      count: aggregate.count,
      n: aggregate.units.size,
      visibility: sampleVisibility(aggregate.units.size),
    }))
    .sort((a, b) => b.count - a.count || a.theme.localeCompare(b.theme, "es"));
  const visibilityByTheme = new Map(themes.map((theme) => [theme.theme, theme.visibility]));
  return {
    themes,
    quotes: rows.filter((row): row is ConfirmedQualitative & { quote: string } => Boolean(row.quote))
      .slice(0, 5).map((row) => ({
        id: row.id,
        quote: row.quote,
        theme: row.theme,
        themeVisibility: visibilityByTheme.get(row.theme) ?? "no-data",
      })),
  };
}
