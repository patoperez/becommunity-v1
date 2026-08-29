import "server-only";

import type { createAdminClient } from "@/lib/supabase/admin";
import { buildSegmentFilterOptions } from "@/lib/calc/filters";
import { loadStudyRows } from "@/lib/calc/load";
import { loadStudyThemeOptions } from "@/lib/studio/theme-inventory";
import type { StudioStudyWorkspace } from "@/lib/studio/study-workspace";

import type { LegacyStudySnapshot } from "./adapter";

/**
 * One existing study, read into the plain object the compatibility adapter
 * takes.
 *
 * READ AFTER `requireInternal()`, with the already-created admin client, like
 * every other Studio loader. It is READ-ONLY in the strongest sense available:
 * it issues selects and nothing else, and the adapter it feeds cannot write
 * even if it wanted to, because it is a pure function in a module with no
 * database import at all.
 *
 * It reads no quote, no respondent identifier and no answer beyond what the
 * aggregation layer already reads for the same study on the client preview.
 * The segment values come back through `loadStudyRows`, which is the same
 * loader the deployed dashboard uses, so the characteristics the composer
 * offers are exactly the ones the client's screen already filters by —
 * canonicalized by the category review, not raw.
 */

/**
 * The scale a result lives on.
 *
 * The same branching `computeStageMetric` uses, so a result is never described
 * on a scale the engine does not compute it on. Deliberately duplicated as a
 * two-line rule rather than imported from the picker, which would drag the
 * whole calculation engine into a module that only needs to label a unit.
 */
function unitFor(metricKey: string): "nps" | "percent" | "score" {
  if (metricKey.startsWith("nps")) return "nps";
  if (metricKey.startsWith("sat") || metricKey.startsWith("csat")) return "percent";
  return "score";
}

export async function loadLegacyStudySnapshot(
  admin: ReturnType<typeof createAdminClient>,
  workspace: StudioStudyWorkspace,
): Promise<LegacyStudySnapshot> {
  const { study } = workspace;
  const [rows, themes] = await Promise.all([
    loadStudyRows(admin, study.id),
    loadStudyThemeOptions(admin, study.id),
  ]);

  const dimensions = buildSegmentFilterOptions(rows).map((option) => ({
    key: option.key,
    values: option.values,
  }));

  return {
    studyId: study.id,
    tenantId: study.tenantId,
    studyName: study.name,
    clientName: study.clientName,
    period: study.period,
    status: study.status,
    dashboardConfig: study.dashboardConfig,
    // The stored shape, handed over exactly as the adapter's own parser
    // expects it. Nothing is normalized on the way.
    journeyDefinition: { stages: study.stages },
    metrics: workspace.metricOptions.map((option) => ({
      key: option.key,
      name: option.name,
      question: option.question,
      unit: unitFor(option.key),
      responses: option.people,
      available: option.available,
    })),
    dimensions,
    themes: themes.map((theme) => ({ label: theme.label, confirmed: theme.confirmed })),
    periods: study.period ? [study.period] : [],
  };
}
