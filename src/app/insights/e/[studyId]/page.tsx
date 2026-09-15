import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { logout } from "@/app/dashboard/actions";
import LongitudinalTrends from "@/app/dashboard/LongitudinalTrends";
import NarrativeHome from "@/app/dashboard/NarrativeHome";
import StudyCard from "@/app/dashboard/StudyCard";
import { StateBlock } from "@/components/States";
import { InsightsShell } from "@/components/shell/InsightsShell";
import { buildSegmentFilterOptions, validateSegmentFilters } from "@/lib/calc/filters";
import { buildLongitudinalView } from "@/lib/dashboard/longitudinal";
import { buildNarrativeHome } from "@/lib/dashboard/narrative";
import { parseDashboardConfig } from "@/lib/dashboard/config";
import { logoPublicUrl, parseBrandConfig } from "@/lib/branding/config";
import { parseInsightsFilters, type InsightsSearchParams } from "@/lib/insights/filters";
import { PUBLISHED_READ_DETAIL } from "@/lib/publication";
import { loadAuthorizedStudyData, type AuthorizedStudy } from "@/lib/studies/authorized";
import { loadPublishedClientExperience } from "@/lib/studies/published-presentation";
import { loadStudyDashboard } from "@/lib/studies/study-dashboard";
import { createClient } from "@/lib/supabase/server";
import { PeriodSeries } from "@/components/studio/PeriodSeries";
import { PublishedStudyView } from "@/components/insights/PublishedStudyView";
import { previewPublishedStudyUnderSelection } from "./actions";

export const metadata = { title: "Estudio · Insights" };

type StudySummary = AuthorizedStudy;

/**
 * The shell's utility corner, identical on both branches.
 *
 * One implementation rather than two, because a client reaching the canonical
 * experience and a client reaching the legacy one must not find different ways
 * out of the page — and «the same corner» is easier to keep true than to check.
 */
function ClientUtility() {
  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      <Link
        href="/insights"
        className="inline-flex min-h-11 items-center rounded-lg border border-line-strong bg-surface px-3 py-2 text-sm font-semibold text-strong hover:bg-surface-sunken"
      >
        Todos los estudios
      </Link>
      <form action={logout}>
        <button
          type="submit"
          className="min-h-11 rounded-lg border border-line-strong bg-surface px-3 py-2 text-sm font-semibold text-strong hover:bg-surface-sunken"
        >
          Cerrar sesión
        </button>
      </form>
    </div>
  );
}

export default async function InsightsStudyPage({
  params,
  searchParams,
}: {
  params: Promise<{ studyId: string }>;
  searchParams: Promise<InsightsSearchParams>;
}) {
  const { studyId } = await params;
  if (!z.string().uuid().safeParse(studyId).success) notFound();

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase.from("profiles").select("role")
    .eq("user_id", user.id).maybeSingle<{ role: string }>();
  if (!profile) redirect("/dashboard");
  if (profile.role === "internal") redirect(`/studio/e/${studyId}/vista-cliente`);

  // ─────────────────────────────────────────────────────────────────────────
  // THE CANONICAL PUBLICATION COMES FIRST, WHEN THERE IS ONE.
  //
  // Unit 6B.4B2I. Until it, this address always rendered the legacy P8
  // experience, so publishing a canonical presentation changed nothing any
  // client could see — the storage, the review and the publish path all
  // existed and no reading surface consulted them.
  //
  // THE THREE BRANCHES ARE EXPLICIT AND NONE OF THEM IS SILENT:
  //
  //   `published`     — an active canonical publication exists, and the client
  //                     is served that IMMUTABLE SNAPSHOT. Not the draft, not a
  //                     recomputation of it, not the legacy engine.
  //   `not_published` — no canonical publication. The documented legacy
  //                     behaviour below is preserved exactly as it was.
  //   `unreadable`    — there IS one and it could not be served. The client is
  //                     told so. It deliberately does NOT fall back to the
  //                     legacy view: answering a request for a published study
  //                     with different numbers from a different engine, and
  //                     saying nothing about it, is the one thing worse than an
  //                     honest unavailable state.
  // ─────────────────────────────────────────────────────────────────────────
  const published = await loadPublishedClientExperience(supabase, studyId);
  if (published.state !== "not_published") {
    const { data: publishedStudy } = await supabase.from("study")
      .select("id, name, tenant_id").eq("id", studyId)
      .maybeSingle<{ id: string; name: string; tenant_id: string }>();
    if (!publishedStudy) notFound();
    const { data: publishedTenant } = await supabase.from("tenant")
      .select("name, brand_config").eq("id", publishedStudy.tenant_id)
      .maybeSingle<{ name: string; brand_config: unknown }>();
    const publishedBrand = parseBrandConfig(publishedTenant?.brand_config);
    return (
      <InsightsShell
        brandName={publishedBrand.displayName ?? publishedTenant?.name ?? "Be Community"}
        tagline={publishedBrand.tagline}
        brand={publishedBrand}
        logoUrl={logoPublicUrl(publishedBrand.logoPath)}
        userEmail={user.email ?? ""}
        utility={<ClientUtility />}
      >
        {published.state === "published" ? (
          <PublishedStudyView
            studyId={publishedStudy.id}
            studyName={publishedStudy.name}
            payload={published.payload}
            preview={previewPublishedStudyUnderSelection}
          />
        ) : (
          <StateBlock tone="caution" title="No pudimos abrir tu estudio">
            <p data-testid="publicacion-no-disponible">
              {PUBLISHED_READ_DETAIL[published.reason]}
            </p>
          </StateBlock>
        )}
      </InsightsShell>
    );
  }

  const selected = await loadAuthorizedStudyData(supabase, studyId);
  if (!selected) notFound();
  const { study, tenantName, brand, presentation, rows, qualitative, publishedInterpretation, periodSeries } = selected;
  const { sections } = parseDashboardConfig(study.dashboard_config);
  const parsed = parseInsightsFilters(await searchParams);
  const options = buildSegmentFilterOptions([...rows, ...qualitative]);
  const validation = parsed.ok ? validateSegmentFilters(parsed.filters, options) : null;
  const filters = sections.filters && parsed.ok && validation?.ok ? parsed.filters : {};
  const filterProblem = !parsed.ok
    ? parsed.error
    : validation && !validation.ok
      ? "Ese enlace contiene una selección que este estudio no permite."
      : null;

  // The SAME legacy payload as before, built by the same function from the same
  // five arguments. `loadStudyDashboard` additionally runs the server-only
  // canonical shadow comparison, which is disabled by default and whose
  // diagnostics this page deliberately does not read — only `legacy` is bound,
  // so nothing else can reach a prop, the serialized payload or the browser.
  const { legacy: dashboard } = await loadStudyDashboard({
    study,
    rows,
    qualitative,
    filters,
  });

  const { data: candidates } = await supabase.from("study")
    .select("id, tenant_id, name, period, status, dashboard_config, journey_definition, created_at")
    .eq("tenant_id", study.tenant_id)
    .eq("status", "published")
    .order("created_at", { ascending: false })
    .returns<StudySummary[]>();
  const histories = await Promise.all((candidates ?? []).map(async (candidate) => {
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

  return (
    <InsightsShell
      brandName={displayName}
      tagline={brand.tagline}
      brand={brand}
      logoUrl={logoPublicUrl(brand.logoPath)}
      userEmail={user.email ?? ""}
      utility={<ClientUtility />}
    >
      {filterProblem ? (
        <div className="mb-6">
          <StateBlock
            tone="caution"
            title="Abrimos el estudio sin esa selección"
            action={
              <Link
                href={`/insights/e/${encodeURIComponent(study.id)}`}
                className="inline-flex min-h-11 items-center rounded-lg border border-caution-line bg-surface px-4 py-2.5 text-sm font-semibold text-caution"
              >
                Ver el estudio completo
              </Link>
            }
          >
            <p>{filterProblem} Ningún resultado se calculó con valores no permitidos.</p>
          </StateBlock>
        </div>
      ) : null}
      {narrative ? (
        <NarrativeHome view={narrative} brand={brand} presentation={presentation} interpretation={publishedInterpretation} studyDestination={`#study-${study.id}`} />
      ) : null}
      <LongitudinalTrends view={longitudinal} />
      <PeriodSeries points={periodSeries} />
      <h1 className="sr-only">{study.name}</h1>
      <StudyCard
        study={study}
        initialDashboard={dashboard}
        initialFilters={filters}
        syncFiltersToUrl
      />
    </InsightsShell>
  );
}
