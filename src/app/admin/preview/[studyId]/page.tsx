import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
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
import { PreviewNotice } from "@/components/shell/PreviewNotice";

export const metadata = { title: "Vista previa de cliente · Be Community" };

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

export default async function ClientPreviewPage({ params }: { params: Promise<{ studyId: string }> }) {
  const { studyId } = await params;
  if (!z.string().uuid().safeParse(studyId).success) notFound();

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { data: profile } = await supabase.from("profiles").select("role")
    .eq("user_id", user.id).single<{ role: string }>();
  if (profile?.role !== "internal") redirect("/dashboard");

  const selected = await loadAuthorizedStudyData(supabase, studyId);
  if (!selected) notFound();
  const { study, rows, qualitative, tenantName, brand } = selected;
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
  const { data: tenantStudies } = await supabase.from("study")
    .select("id, tenant_id, name, period, status, dashboard_config, journey_definition, created_at")
    .eq("tenant_id", study.tenant_id)
    .order("created_at", { ascending: false })
    .returns<StudySummary[]>();
  const visibleCandidates = (tenantStudies ?? []).filter((candidate) => (
    candidate.status === "published" || candidate.id === study.id
  ));
  const histories = await Promise.all(visibleCandidates.map(async (candidate) => {
    if (candidate.id === study.id) return { study, rows };
    const loaded = await loadAuthorizedStudyData(supabase, candidate.id);
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

  // The preview renders the CLIENT experience, through the client shell, so what
  // an internal reviewer sees is what the client will see — the audit called
  // this the best-conceived screen in the product and the model for P8.
  return <InsightsShell
    brandName={displayName}
    tagline={brand.tagline}
    brand={brand}
    logoUrl={logoUrl}
    userEmail={user.email ?? ""}
    // The sticky notice already carries the return to the study list, so the
    // header no longer duplicates it.
    banner={<PreviewNotice />}
  >
    {narrative ? <NarrativeHome view={narrative} brand={brand} audience="preview" /> : null}
    <LongitudinalTrends view={longitudinal} />
    <h2 className="sr-only">Vista del estudio</h2>
    <StudyCard study={study} initialDashboard={dashboard} audience="preview" />
  </InsightsShell>;
}
