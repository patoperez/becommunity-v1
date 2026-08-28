import "server-only";

import type { createAdminClient } from "@/lib/supabase/admin";
import { parseJourneyDefinition, type JourneyStage } from "@/lib/calc/journey";
import { parseDashboardConfig, type DashboardSections } from "@/lib/dashboard/config";
import { loadTenantArchiveState } from "./lifecycle";
import { loadStudyMetricOptions } from "./metric-inventory";
import { studyReadiness, type StudyReadiness } from "./readiness";
import type { JourneyMetricOption } from "./journey-picker";
import { parseBrandConfig, type BrandConfig } from "@/lib/branding/config";

/**
 * One study, as Studio's work surface needs it (P8.2).
 *
 * Read AFTER `requireInternal()`. One loader answers the study header, the
 * process tabs, the readiness panel, the recorrido picker and the publication
 * decision, so those five surfaces can never disagree about the same study.
 *
 * It reads counts and metric keys — never a quote, never a respondent id,
 * never an answer value beyond what the results picker needs to say what a
 * result says today.
 */

export type StudioStudy = {
  id: string;
  tenantId: string;
  clientName: string;
  clientArchived: boolean;
  clientBrand: BrandConfig;
  name: string;
  period: string | null;
  status: string;
  createdAt: string;
  dashboardConfig: unknown;
  sections: DashboardSections;
  stages: JourneyStage[];
};

export type StudioStudyWorkspace = {
  study: StudioStudy;
  readiness: StudyReadiness;
  metricOptions: JourneyMetricOption[];
  counts: {
    respondents: number;
    quantResponses: number;
    confirmedObservations: number;
    pendingObservations: number;
    rejectedObservations: number;
    importBatches: number;
    unfinishedImports: number;
    /** Category decisions recorded for this study, any kind, any version. */
    categoryDecisions: number;
  };
};

type StudyRow = {
  id: string;
  tenant_id: string;
  name: string;
  period: string | null;
  status: string;
  created_at: string;
  dashboard_config: unknown;
  journey_definition: unknown;
};

async function headCount(
  admin: ReturnType<typeof createAdminClient>,
  table: string,
  filters: [string, string][],
  selectColumn = "id",
  options: { optionalTable?: boolean } = {},
): Promise<number> {
  let query = admin.from(table).select(selectColumn, { count: "exact", head: true });
  for (const [column, value] of filters) query = query.eq(column, value);
  const { count, error } = await query;
  if (error) {
    // A table a migration has not created yet is not a broken study. Only the
    // counts marked optional may degrade this way, and they degrade to zero,
    // which reads on screen as "nobody has done this yet" rather than as a
    // claim that there is nothing to do.
    if (options.optionalTable && (error.code === "42P01" || error.code === "PGRST205")) return 0;
    throw new Error(`${table} count: ${error.message}`);
  }
  return count ?? 0;
}

export async function loadStudioStudy(
  admin: ReturnType<typeof createAdminClient>,
  studyId: string,
): Promise<StudioStudyWorkspace | null> {
  const { data: study, error } = await admin
    .from("study")
    .select("id, tenant_id, name, period, status, created_at, dashboard_config, journey_definition")
    .eq("id", studyId)
    .maybeSingle<StudyRow>();
  if (error) throw new Error(`study: ${error.message}`);
  if (!study) return null;

  const [
    { data: tenant },
    respondents,
    quantResponses,
    confirmedObservations,
    pendingObservations,
    rejectedObservations,
    importBatches,
    stagedImports,
    failedImports,
    categoryDecisions,
    archiveState,
    metricOptionsByStudy,
  ] = await Promise.all([
    admin.from("tenant").select("name, brand_config").eq("id", study.tenant_id).maybeSingle<{ name: string; brand_config: unknown }>(),
    headCount(admin, "respondent", [["study_id", study.id]]),
    headCount(admin, "quant_response", [["study_id", study.id]]),
    headCount(admin, "qual_observation", [["study_id", study.id], ["review_status", "confirmed"]]),
    headCount(admin, "qual_observation", [["study_id", study.id], ["review_status", "pending"]]),
    headCount(admin, "qual_observation", [["study_id", study.id], ["review_status", "rejected"]]),
    headCount(admin, "import_batch", [["study_id", study.id]]),
    headCount(admin, "import_batch", [["study_id", study.id], ["status", "staged"]]),
    headCount(admin, "import_batch", [["study_id", study.id], ["status", "failed"]]),
    // A head count, so the process row can say whether anyone has reviewed the
    // categories without reading a single respondent.
    headCount(admin, "category_decision", [["study_id", study.id]], "id", { optionalTable: true }),
    loadTenantArchiveState(admin, [study.tenant_id]),
    loadStudyMetricOptions(admin, [study.id]),
  ]);

  const stages = parseJourneyDefinition(study.journey_definition);
  const metricOptions = metricOptionsByStudy[study.id] ?? [];
  const offered = new Set(metricOptions.map((option) => option.key));
  const stagesWithoutResult = stages.filter((stage) => !offered.has(stage.metric)).length;
  const clientArchived = Boolean(archiveState.archivedAt[study.tenant_id]);
  const unfinishedImports = stagedImports + failedImports;

  return {
    study: {
      id: study.id,
      tenantId: study.tenant_id,
      clientName: tenant?.name ?? "Cliente eliminado",
      clientArchived,
      clientBrand: parseBrandConfig(tenant?.brand_config),
      name: study.name,
      period: study.period,
      status: study.status,
      createdAt: study.created_at,
      dashboardConfig: study.dashboard_config,
      sections: parseDashboardConfig(study.dashboard_config).sections,
      stages,
    },
    readiness: studyReadiness({
      status: study.status,
      clientArchived,
      quantResponses,
      respondents,
      confirmedObservations,
      pendingObservations,
      unfinishedImports,
      totalStages: stages.length,
      stagesWithoutResult,
    }),
    metricOptions,
    counts: {
      respondents,
      quantResponses,
      confirmedObservations,
      pendingObservations,
      rejectedObservations,
      importBatches,
      unfinishedImports,
      categoryDecisions,
    },
  };
}
