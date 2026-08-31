import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import type { SupabaseClient } from "@supabase/supabase-js";
import { loadAuthorizedStudyData } from "@/lib/studies/authorized";
import { buildStudyDashboard } from "@/lib/dashboard/view";
import { parseJourneyDefinition } from "@/lib/calc/journey";
import { parseDashboardConfig } from "@/lib/dashboard/config";
import { buildLongitudinalView } from "@/lib/dashboard/longitudinal";
import { buildNarrativeHome } from "@/lib/dashboard/narrative";
import { logoPublicUrl } from "@/lib/branding/config";
import NarrativeHome from "@/app/dashboard/NarrativeHome";
import LongitudinalTrends from "@/app/dashboard/LongitudinalTrends";
import StudyCard from "@/app/dashboard/StudyCard";
import { InsightsShell } from "@/components/shell/InsightsShell";
import { PeriodSeries } from "@/components/studio/PeriodSeries";
import { PublishedExperience } from "@/components/insights/PublishedExperience";
import { publishedExperienceData } from "@/app/insights/e/[studyId]/experience-actions";
import { selectClientExperience } from "@/lib/experience/client-experience";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * The internal client preview, rendered once for both of its addresses.
 *
 * `/admin/preview/[studyId]` and `/studio/e/[studyId]/vista-cliente` show the
 * SAME screen through the SAME client shell, because the whole point of this
 * surface is that what an internal reviewer sees is what the client will see.
 * Two implementations of it would be two chances for that to stop being true.
 *
 * Contract C11 holds here in reverse: the CLIENT surface stays silent about
 * anything Be Community chose not to publish, and this INTERNAL surface is
 * where the omissions are named — which is why `audience="preview"` is passed
 * through unchanged.
 */

type StudySummary = {
  id: string;
  tenant_id: string;
  name: string;
  period: string | null;
  status: string;
  dashboard_config: unknown;
  journey_definition: unknown;
  created_at: string;
};

export async function ClientPreviewView({
  requestClient,
  studyId,
  userEmail,
  banner,
  utility,
  footer,
}: {
  /** The request-scoped client: authorization runs through RLS first. */
  requestClient: SupabaseClient;
  studyId: string;
  userEmail: string;
  banner: ReactNode;
  /** The persistent escape path, outside the dismissible notice. */
  utility: ReactNode;
  /** What an internal reviewer may do next, after looking. */
  footer?: ReactNode;
}) {
  // A study this session may not read, or that no longer exists, is an ABSENCE
  // rather than a denial: both routes have already proved an internal role, so
  // saying "denied" here would misdescribe what happened.
  const selected = await loadAuthorizedStudyData(requestClient, studyId);
  if (!selected) notFound();
  const { study, rows, qualitative, tenantName, brand, presentation, publishedInterpretation, periodSeries } = selected;

  /*
   * WHEN A COMPOSED EXPERIENCE IS PUBLISHED, THIS IS THAT EXPERIENCE.
   *
   * The label on this surface is "what the client is being served today", and
   * the moment a study's client-facing screen becomes a composed revision, a
   * legacy dashboard drawn here stops being that. It would be an internal
   * preview that quietly previews something else — the exact failure the two
   * separate preview addresses were introduced to prevent.
   *
   * The selection is the SAME one `/insights/e/[studyId]` makes, through the
   * same function, so the two cannot answer differently. Both of this
   * component's addresses get it at once, which is why the branch is here
   * rather than in either page.
   */
  const composed = await selectClientExperience(createAdminClient(), {
    study: {
      id: study.id,
      tenantId: study.tenant_id,
      name: study.name,
      period: study.period,
      status: study.status,
    },
    clientName: tenantName,
    rows,
    qualitative,
    reportAvailable: rows.length > 0,
  });

  if (composed.kind === "composed") {
    return (
      <InsightsShell
        brandName={brand.displayName ?? tenantName}
        tagline={brand.tagline}
        brand={brand}
        logoUrl={logoPublicUrl(brand.logoPath)}
        userEmail={userEmail}
        banner={banner}
        utility={utility}
      >
        <h2 className="sr-only">Vista del estudio</h2>
        <PublishedExperience
          studyId={study.id}
          definition={composed.experience.definition}
          registry={composed.experience.registry}
          data={composed.experience.data}
          evidence={composed.experience.evidence}
          summary={composed.experience.summary}
          study={{ name: study.name, clientName: tenantName, period: study.period }}
          initialSelection={{}}
          reportHref={rows.length > 0 ? `/api/studies/${encodeURIComponent(study.id)}/report` : null}
          refresh={publishedExperienceData}
        />
        {footer}
      </InsightsShell>
    );
  }

  const { sections } = parseDashboardConfig(study.dashboard_config);
  const dashboard = buildStudyDashboard(
    rows,
    qualitative,
    parseJourneyDefinition(study.journey_definition),
    {},
    study.dashboard_config,
  );

  // Recreate the history the client would have after publication: currently
  // published studies plus the selected draft/archived study being previewed.
  const { data: tenantStudies } = await requestClient.from("study")
    .select("id, tenant_id, name, period, status, dashboard_config, journey_definition, created_at")
    .eq("tenant_id", study.tenant_id)
    .order("created_at", { ascending: false })
    .returns<StudySummary[]>();
  const visibleCandidates = (tenantStudies ?? []).filter((candidate) => (
    candidate.status === "published" || candidate.id === study.id
  ));
  const histories = await Promise.all(visibleCandidates.map(async (candidate) => {
    if (candidate.id === study.id) return { study, rows };
    const loaded = await loadAuthorizedStudyData(requestClient, candidate.id);
    return loaded ? { study: loaded.study, rows: loaded.rows } : null;
  }));
  const longitudinal = sections.trends
    ? buildLongitudinalView(histories.flatMap((item) => item ? [{
        name: item.study.name,
        period: item.study.period,
        createdAt: item.study.created_at,
        rows: item.rows,
      }] : []))
    : { periods: 0, series: [] };
  const narrative = sections.narrative ? buildNarrativeHome(study, dashboard, longitudinal) : null;
  const displayName = brand.displayName ?? tenantName;
  const logoUrl = logoPublicUrl(brand.logoPath);

  return (
    <InsightsShell
      brandName={displayName}
      tagline={brand.tagline}
      brand={brand}
      logoUrl={logoUrl}
      userEmail={userEmail}
      banner={banner}
      utility={utility}
    >
      {narrative ? <NarrativeHome view={narrative} brand={brand} presentation={presentation} interpretation={publishedInterpretation} audience="preview" /> : null}
      <LongitudinalTrends view={longitudinal} />
      <PeriodSeries points={periodSeries} />
      <h2 className="sr-only">Vista del estudio</h2>
      <StudyCard study={study} initialDashboard={dashboard} audience="preview" />
      {footer}
    </InsightsShell>
  );
}
