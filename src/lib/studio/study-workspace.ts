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
  /**
   * One column, several acceptable values — ONE request instead of one per
   * value.
   *
   * It exists because of a measurement rather than a style: every Studio page
   * pays for this loader, a Cloudflare Worker may make fifty outbound requests
   * per incoming request, and the review screen was measured at 27 of them.
   * `staged` and `failed` import batches are never reported apart — they are
   * summed into `unfinishedImports` on the next line and the parts are not
   * returned — so asking twice was buying a number nobody reads.
   */
  oneOf?: [string, string[]],
): Promise<number> {
  let query = admin.from(table).select(selectColumn, { count: "exact", head: true });
  for (const [column, value] of filters) query = query.eq(column, value);
  if (oneOf) query = query.in(oneOf[0], oneOf[1]);
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
    { data: tenant, error: tenantError },
    respondents,
    quantResponses,
    confirmedObservations,
    pendingObservations,
    rejectedObservations,
    importBatches,
    unfinishedImports,
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
    // BOTH UNFINISHED STATES IN ONE REQUEST. The two were counted separately and
    // then added together on the next line; nothing has ever read them apart.
    headCount(admin, "import_batch", [["study_id", study.id]], "id", ["status", ["staged", "failed"]]),
    loadTenantArchiveState(admin, [study.tenant_id]),
    loadStudyMetricOptions(admin, [study.id]),
  ]);

  // «UNAVAILABLE» IS NOT «DELETED». A failed tenant read used to render the
  // header as «Cliente eliminado» with the default brand — an outage reported as
  // a fact about the client. It now fails the page the way every other read in
  // this loader already does (Unit 6B.4B2P).
  if (tenantError) throw new Error("tenant: read failed");
  const stages = parseJourneyDefinition(study.journey_definition);
  const metricOptions = metricOptionsByStudy[study.id] ?? [];
  const offered = new Set(metricOptions.map((option) => option.key));
  const stagesWithoutResult = stages.filter((stage) => !offered.has(stage.metric)).length;
  const clientArchived = Boolean(archiveState.archivedAt[study.tenant_id]);

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
    },
  };
}
