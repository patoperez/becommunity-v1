import "server-only";

import type { createAdminClient } from "@/lib/supabase/admin";
import type { JourneyStage } from "@/lib/calc/journey";
import type { JourneyMetricOption } from "@/lib/studio/journey-picker";
import { selectAllPages } from "@/lib/supabase/paginate";

/** Refusal threshold, not a page size (src/lib/supabase/paginate.ts). */
const MAX_OBSERVATIONS = 100_000;

export type InterpretationEvidenceOption = {
  kind: "metric" | "journey" | "theme";
  ref: string;
  label: string;
};

export async function loadInterpretationEvidence(
  admin: ReturnType<typeof createAdminClient>,
  studyId: string,
  metrics: JourneyMetricOption[],
  stages: JourneyStage[],
): Promise<InterpretationEvidenceOption[]> {
  const themeRows = await selectAllPages<{ confirmed_theme: string | null }>(
    "qualitative evidence",
    (from, to) =>
      admin.from("qual_observation")
        .select("confirmed_theme").eq("study_id", studyId).eq("review_status", "confirmed")
        .range(from, to)
        .returns<{ confirmed_theme: string | null }[]>(),
    MAX_OBSERVATIONS,
  );

  const themeCounts = new Map<string, number>();
  for (const row of themeRows ?? []) {
    const theme = row.confirmed_theme?.trim();
    if (theme) themeCounts.set(theme, (themeCounts.get(theme) ?? 0) + 1);
  }
  return [
    ...metrics.map((item) => ({
      kind: "metric" as const,
      ref: item.key,
      label: `${item.name}${item.today == null ? "" : ` · ${item.today}`}`,
    })),
    ...stages.map((item) => ({ kind: "journey" as const, ref: item.id, label: `Recorrido · ${item.label}` })),
    ...[...themeCounts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "es-MX")).slice(0, 20)
      .map(([theme, count]) => ({ kind: "theme" as const, ref: theme, label: `Tema · ${theme} (${count})` })),
  ];
}
