import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { logout } from "@/app/dashboard/actions";
import LongitudinalTrends from "@/app/dashboard/LongitudinalTrends";
import NarrativeHome from "@/app/dashboard/NarrativeHome";
import StudyCard from "@/app/dashboard/StudyCard";
import { StateBlock } from "@/components/States";
import { InsightsShell } from "@/components/shell/InsightsShell";
import { parseJourneyDefinition } from "@/lib/calc/journey";
import { buildSegmentFilterOptions, validateSegmentFilters } from "@/lib/calc/filters";
import { buildLongitudinalView } from "@/lib/dashboard/longitudinal";
import { buildNarrativeHome } from "@/lib/dashboard/narrative";
import { parseDashboardConfig } from "@/lib/dashboard/config";
import { buildStudyDashboard } from "@/lib/dashboard/view";
import { logoPublicUrl } from "@/lib/branding/config";
import { parseInsightsFilters, type InsightsSearchParams } from "@/lib/insights/filters";
import { loadAuthorizedStudyData, type AuthorizedStudy } from "@/lib/studies/authorized";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { PeriodSeries } from "@/components/studio/PeriodSeries";
import { PublishedExperience } from "@/components/insights/PublishedExperience";
import {
  activeComposition,
  resolveClientExperience,
  type ClientExperienceInput,
} from "@/lib/experience/client-experience";
import { registryWithDerivedBands } from "@/lib/experience/band-filters";
import { parseViewerSelection } from "@/lib/experience/viewer-params";
import { publishedExperienceData } from "./experience-actions";

export const metadata = { title: "Estudio · Insights" };

type StudySummary = AuthorizedStudy;

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

  const selected = await loadAuthorizedStudyData(supabase, studyId);
  if (!selected) notFound();
  const { study, tenantName, brand, presentation, rows, qualitative, publishedInterpretation, periodSeries } = selected;

  /*
   * THE PER-STUDY COMPATIBILITY BOUNDARY.
   *
   * A study is served the composed experience when — and only when — it has an
   * ACTIVE PUBLISHED REVISION this build can read. Every other study keeps the
   * legacy dashboard below, unchanged, byte for byte: no study moves because a
   * draft was saved, because a revision was prepared, or because the composer
   * gained a feature. Moving one is a deliberate act on
   * `/studio/e/[studyId]/publicar`, one study at a time.
   *
   * A published revision this build cannot read falls back to the same legacy
   * dashboard rather than to an error page. The client keeps a working screen
   * with real numbers; the internal publication screen is where that failure is
   * named, because "we could not read what we published" is not a sentence a
   * client should ever meet.
   */
  const composedContext: ClientExperienceInput = {
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
  };
  const composedLoad = await activeComposition(createAdminClient(), composedContext);

  if (composedLoad.kind === "composed") {
    const definition = composedLoad.composition.active.definition;
    // The reader's choices, through the composer's own bounded parser, checked
    // against the registry this reader's own rows produced.
    const selection = parseViewerSelection(
      await searchParams,
      definition,
      registryWithDerivedBands(definition, composedLoad.composition.registry),
    );
    const experience = resolveClientExperience(composedLoad.composition, {
      ...composedContext,
      selection,
    });
    const composedBrandName = brand.displayName ?? tenantName;
    return (
      <InsightsShell
        brandName={composedBrandName}
        tagline={brand.tagline}
        brand={brand}
        logoUrl={logoPublicUrl(brand.logoPath)}
        userEmail={user.email ?? ""}
        utility={
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
        }
      >
        <h1 className="sr-only">{study.name}</h1>
        <PublishedExperience
          studyId={study.id}
          definition={definition}
          registry={experience.registry}
          data={experience.data}
          evidence={experience.evidence}
          summary={experience.summary}
          study={{ name: study.name, clientName: tenantName, period: study.period }}
          initialSelection={selection}
          reportHref={
            rows.length > 0 ? `/api/studies/${encodeURIComponent(study.id)}/report` : null
          }
          refresh={publishedExperienceData}
        />
      </InsightsShell>
    );
  }

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

  const dashboard = buildStudyDashboard(
    rows,
    qualitative,
    parseJourneyDefinition(study.journey_definition),
    filters,
    study.dashboard_config,
  );

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
      utility={
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
      }
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
