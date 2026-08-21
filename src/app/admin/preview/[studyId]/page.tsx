import Link from "next/link";
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

  return <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950">
    <div className="border-b border-amber-300 bg-amber-100 px-6 py-2 text-center text-xs font-semibold text-amber-950">
      Vista previa interna · el cliente no puede ver este estudio hasta que se publique
    </div>
    <header className="flex items-center justify-between border-b px-6 py-4 text-white" style={{ backgroundColor: brand.primaryColor, borderColor: brand.accentColor }}>
      <div className="flex min-w-0 items-center gap-3">
        {logoUrl ? <>
          {/* Dynamic tenant Storage URLs cannot use a static Next Image remote allowlist. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={logoUrl} alt={`Logotipo de ${displayName}`} className="h-11 w-11 shrink-0 rounded-lg bg-white object-contain p-1" />
        </> : null}
        <div className="min-w-0"><h1 className="truncate text-lg font-semibold">{displayName}</h1><p className="truncate text-xs text-white/75">{brand.tagline}</p></div>
      </div>
      <Link href="/admin/studies" className="rounded-lg border border-white/40 px-3 py-1.5 text-sm font-medium text-white hover:bg-white/10">Volver al backoffice</Link>
    </header>
    <main className="mx-auto w-full max-w-4xl px-6 py-10">
      {narrative ? <NarrativeHome view={narrative} brand={brand} /> : null}
      <LongitudinalTrends view={longitudinal} />
      <h2 className="mb-6 text-xl font-semibold text-zinc-900 dark:text-zinc-50">Vista del estudio</h2>
      <StudyCard study={study} initialDashboard={dashboard} />
    </main>
  </div>;
}
