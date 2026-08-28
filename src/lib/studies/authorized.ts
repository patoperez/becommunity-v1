import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { loadStudyRows } from "@/lib/calc/load";
import type { ConfirmedQualitative } from "@/lib/qualitative/published";
import { createAdminClient } from "@/lib/supabase/admin";
import { applyDataScope, parseDataScope } from "@/lib/studies/scope";
import { parseBrandConfig, type BrandConfig } from "@/lib/branding/config";
import { parseDashboardConfig, type StudyPresentation } from "@/lib/dashboard/config";
import { loadStudyInterpretation } from "@/lib/interpretation/load";
import type { InterpretationContent } from "@/lib/interpretation/schema";
import { loadLatestPeriodSeries } from "@/lib/studies/period-series";
import { keysetWindow, selectAllPages } from "@/lib/supabase/paginate";

/** Refusal thresholds, not page sizes (src/lib/supabase/paginate.ts). */
const MAX_OBSERVATIONS = 100_000;
const MAX_RESPONDENTS = 50_000;

export type AuthorizedStudy = {
  id: string;
  tenant_id: string;
  name: string;
  period: string | null;
  status: string;
  dashboard_config: unknown;
  journey_definition: unknown;
  created_at: string;
};

export type AuthorizedStudyData = {
  study: AuthorizedStudy;
  tenantName: string;
  brand: BrandConfig;
  presentation: StudyPresentation;
  rows: Awaited<ReturnType<typeof loadStudyRows>>;
  qualitative: ConfirmedQualitative[];
  publishedInterpretation: InterpretationContent | null;
  periodSeries: Awaited<ReturnType<typeof loadLatestPeriodSeries>>;
};

async function loadConfirmedQualitativeInternal(
  admin: ReturnType<typeof createAdminClient>,
  studyId: string,
): Promise<ConfirmedQualitative[]> {
  // Paged: a single `.select()` stops at the Data API's 1000-row cap without
  // saying so, which would drop confirmed findings from a large study.
  type ObservationRow = {
    id: string; respondent_id: string | null; confirmed_theme: string | null;
    confirmed_stage_key: string | null; quote: string | null; quote_approved: boolean | null;
    source: string | null; category: string | null;
  };
  const [observations, respondents] = await Promise.all([
    selectAllPages<ObservationRow>(
      "qual_observation",
      (cursor, size) =>
        keysetWindow(
          admin.from("qual_observation")
            .select("id, respondent_id, confirmed_theme, confirmed_stage_key, quote, quote_approved, source, category")
            .eq("study_id", studyId)
            .eq("review_status", "confirmed"),
          { column: "id", cursor, size },
        ).returns<ObservationRow[]>(),
      { maxRows: MAX_OBSERVATIONS, cursorOf: (row) => row.id },
    ),
    selectAllPages<{ id: string; segments: Record<string, unknown> | null }>(
      "respondent",
      (cursor, size) =>
        keysetWindow(
          admin.from("respondent").select("id, segments").eq("study_id", studyId),
          { column: "id", cursor, size },
        ).returns<{ id: string; segments: Record<string, unknown> | null }[]>(),
      { maxRows: MAX_RESPONDENTS, cursorOf: (row) => row.id },
    ),
  ]);

  const segments = new Map((respondents ?? []).map((row) => [
    String(row.id),
    (row.segments ?? {}) as Record<string, unknown>,
  ]));
  return (observations ?? []).flatMap((row) => {
    const theme = typeof row.confirmed_theme === "string" ? row.confirmed_theme.trim() : "";
    if (!theme) return [];
    const respondentId = row.respondent_id ? String(row.respondent_id) : null;
    return [{
      id: String(row.id),
      respondent_id: respondentId,
      theme,
      stage_key: row.confirmed_stage_key ? String(row.confirmed_stage_key) : null,
      quote: row.quote_approved && row.quote ? String(row.quote) : null,
      source: row.source ? String(row.source) : null,
      category: row.category ? String(row.category) : null,
      ...(respondentId ? segments.get(respondentId) ?? {} : {}),
    }];
  });
}

/**
 * Authorizes with the request-scoped client first, then loads the exact study
 * through the server-only admin client. The admin query is unreachable until
 * RLS confirms that this user may see this study (published-only for clients).
 */
export async function loadAuthorizedStudyData(
  requestClient: SupabaseClient,
  studyId: string,
): Promise<AuthorizedStudyData | null> {
  const [{ data: study, error: studyError }, { data: profile, error: profileError }] = await Promise.all([
    requestClient.from("study")
      .select("id, tenant_id, name, period, status, dashboard_config, journey_definition, created_at")
      .eq("id", studyId)
      .maybeSingle<AuthorizedStudy>(),
    requestClient.from("profiles").select("role, data_scope")
      .maybeSingle<{ role: string; data_scope: unknown }>(),
  ]);
  if (studyError) throw new Error(`study authorization: ${studyError.message}`);
  if (profileError) throw new Error(`profile scope: ${profileError.message}`);
  if (!study || !profile) return null;
  const scope = profile.role === "internal" ? {} : parseDataScope(profile.data_scope);

  const admin = createAdminClient();
  const [{ data: tenant, error: tenantError }, rows, qualitative, interpretation, periodSeries] = await Promise.all([
    admin.from("tenant").select("name, brand_config").eq("id", study.tenant_id)
      .maybeSingle<{ name: string; brand_config: unknown }>(),
    loadStudyRows(admin, study.id),
    loadConfirmedQualitativeInternal(admin, study.id),
    loadStudyInterpretation(admin, study.id),
    loadLatestPeriodSeries(admin, study.id),
  ]);
  if (tenantError) throw new Error(`tenant: ${tenantError.message}`);
  const tenantBrand = parseBrandConfig(tenant?.brand_config);
  const studyPresentation = parseDashboardConfig(study.dashboard_config).presentation;
  const presentation: StudyPresentation = {
    primaryColor: studyPresentation.primaryColor,
    accentColor: studyPresentation.accentColor,
    coverLabel: studyPresentation.coverLabel ?? tenantBrand.presentationDefaults.coverLabel,
    coverNote: studyPresentation.coverNote ?? tenantBrand.presentationDefaults.coverNote,
    threshold: studyPresentation.threshold ?? tenantBrand.presentationDefaults.threshold,
  };
  return {
    study,
    tenantName: tenant?.name ?? "Be Community",
    brand: {
      ...tenantBrand,
      primaryColor: presentation.primaryColor ?? tenantBrand.primaryColor,
      accentColor: presentation.accentColor ?? tenantBrand.accentColor,
    },
    presentation,
    rows: applyDataScope(rows, scope),
    qualitative: applyDataScope(qualitative, scope),
    publishedInterpretation: interpretation.published,
    periodSeries,
  };
}
