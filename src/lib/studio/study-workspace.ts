import "server-only";

import type { createAdminClient } from "@/lib/supabase/admin";
import { parseJourneyDefinition, type JourneyStage } from "@/lib/calc/journey";
import { parseDashboardConfig, type DashboardSections } from "@/lib/dashboard/config";
import { loadTenantArchiveState } from "./lifecycle";
import { loadStudyMetricOptions } from "./metric-inventory";
import { studyReadiness, type StudyReadiness } from "./readiness";
import type { JourneyMetricOption } from "./journey-picker";

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
): Promise<number> {
  let query = admin.from(table).select(selectColumn, { count: "exact", head: true });
  for (const [column, value] of filters) query = query.eq(column, value);
  const { count, error } = await query;
  if (error) throw new Error(`${table} count: ${error.message}`);
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
    archiveState,
    metricOptionsByStudy,
  ] = await Promise.all([
    admin.from("tenant").select("name").eq("id", study.tenant_id).maybeSingle<{ name: string }>(),
    headCount(admin, "respondent", [["study_id", study.id]]),
    headCount(admin, "quant_response", [["study_id", study.id]]),
    headCount(admin, "qual_observation", [["study_id", study.id], ["review_status", "confirmed"]]),
    headCount(admin, "qual_observation", [["study_id", study.id], ["review_status", "pending"]]),
    headCount(admin, "qual_observation", [["study_id", study.id], ["review_status", "rejected"]]),
    headCount(admin, "import_batch", [["study_id", study.id]]),
    headCount(admin, "import_batch", [["study_id", study.id], ["status", "staged"]]),
    headCount(admin, "import_batch", [["study_id", study.id], ["status", "failed"]]),
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
    },
  };
}
