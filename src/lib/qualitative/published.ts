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
