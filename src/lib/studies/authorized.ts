import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { loadStudyRows } from "@/lib/calc/load";
import type { ConfirmedQualitative } from "@/lib/qualitative/published";
import { createAdminClient } from "@/lib/supabase/admin";
import { applyDataScope, parseDataScope } from "@/lib/studies/scope";

export type AuthorizedStudy = {
  id: string;
  tenant_id: string;
  name: string;
  period: string | null;
  status: string;
  journey_definition: unknown;
  created_at: string;
};

export type AuthorizedStudyData = {
  study: AuthorizedStudy;
  tenantName: string;
  rows: Awaited<ReturnType<typeof loadStudyRows>>;
  qualitative: ConfirmedQualitative[];
};

async function loadConfirmedQualitativeInternal(
  admin: ReturnType<typeof createAdminClient>,
  studyId: string,
): Promise<ConfirmedQualitative[]> {
  const [{ data: observations, error: observationError }, { data: respondents, error: respondentError }] = await Promise.all([
    admin.from("qual_observation")
      .select("id, respondent_id, confirmed_theme, confirmed_stage_key, quote, quote_approved, source, category")
      .eq("study_id", studyId)
      .eq("review_status", "confirmed"),
    admin.from("respondent").select("id, segments").eq("study_id", studyId),
  ]);
  if (observationError) throw new Error(`qual_observation: ${observationError.message}`);
  if (respondentError) throw new Error(`respondent: ${respondentError.message}`);

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
      .select("id, tenant_id, name, period, status, journey_definition, created_at")
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
  const [{ data: tenant, error: tenantError }, rows, qualitative] = await Promise.all([
    admin.from("tenant").select("name").eq("id", study.tenant_id).maybeSingle<{ name: string }>(),
    loadStudyRows(admin, study.id),
    loadConfirmedQualitativeInternal(admin, study.id),
  ]);
  if (tenantError) throw new Error(`tenant: ${tenantError.message}`);
  return {
    study,
    tenantName: tenant?.name ?? "Be Community",
    rows: applyDataScope(rows, scope),
    qualitative: applyDataScope(qualitative, scope),
  };
}
