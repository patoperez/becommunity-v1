import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { LongRow } from "@/lib/calc/engine";
import { parseJourneyDefinition } from "@/lib/calc/journey";
import StudyCard from "./StudyCard";
import { logout } from "./actions";
import { buildStudyDashboard, type StudyDashboardPayload } from "@/lib/dashboard/view";
import { buildLongitudinalView } from "@/lib/dashboard/longitudinal";
import { loadAuthorizedStudyData } from "@/lib/studies/authorized";
import LongitudinalTrends from "./LongitudinalTrends";
import { buildNarrativeHome } from "@/lib/dashboard/narrative";
import NarrativeHome from "./NarrativeHome";
import { parseDashboardConfig } from "@/lib/dashboard/config";
import { logoPublicUrl, parseBrandConfig } from "@/lib/branding/config";
import { InsightsShell } from "@/components/shell/InsightsShell";
import { StudioShell } from "@/components/shell/StudioShell";
import { StateBlock } from "@/components/States";
import { StudioHomeView } from "@/components/studio/StudioHomeView";
import StudyComingSoon from "./StudyComingSoon";
import { StudyLibrary } from "@/components/insights/StudyLibrary";
import { insightsStudyHref } from "@/lib/insights/filters";

export const metadata = {
  title: "Inicio",
};

type Profile = {
  tenant_id: string | null;
  role: string;
  full_name: string | null;
  data_scope: unknown;
};

type Study = {
  id: string;
  name: string;
  period: string | null;
  status: string;
  dashboard_config: unknown;
  journey_definition: unknown;
  created_at: string;
};

/** The sign-out control, identical in both shells. */
function SignOut({ tone = "ink" }: { tone?: "ink" | "paper" }) {
  return (
    <form action={logout}>
      <button
        type="submit"
        className={
          tone === "paper"
            ? "min-h-11 rounded-lg border border-paper/40 px-3 py-1.5 text-sm font-medium text-paper transition-colors duration-[var(--motion-state)] hover:bg-paper/10"
            : "min-h-11 rounded-lg border border-line-strong bg-surface px-3 py-1.5 text-sm font-medium text-strong transition-colors duration-[var(--motion-state)] hover:bg-surface-sunken"
        }
      >
        Cerrar sesión
      </button>
    </form>
  );
}

export default async function DashboardPage() {
  const supabase = await createClient();

  // DEFENSE IN DEPTH (§6.4): re-validate the session here, server-side, even
  // though middleware already gated the route. getUser() verifies the JWT with
  // the Auth server — never getSession() for an auth decision.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  // The user -> tenant + role link (§7.1). RLS lets a user read only their own
  // profile row. If there is no profile, the account is not provisioned.
  const { data: profile } = await supabase
    .from("profiles")
    .select("tenant_id, role, full_name, data_scope")
    .eq("user_id", user.id)
    .single<Profile>();

  // Tenant name + studies are fetched with the user's own session, so RLS
  // (§6.2) guarantees only this tenant's rows can ever come back — the server
  // does not, and cannot, hand over another client's data.
  const [{ data: tenant }, { data: studies }] = await Promise.all([
    supabase
      .from("tenant")
      .select("name, brand_config")
      .eq("id", profile?.tenant_id ?? "")
      .maybeSingle<{ name: string; brand_config: unknown }>(),
    supabase
      .from("study")
      .select("id, name, period, status, dashboard_config, journey_definition, created_at")
      .order("created_at", { ascending: false })
      .returns<Study[]>(),
  ]);

  // ---------------------------------------------------------------------------
  // Be Community Studio — the internal home.
  //
  // ROUTE COMPATIBILITY (P8.2). Studio's own address is `/studio`, and this
  // route keeps answering for internal staff because bookmarks, the sign-in
  // redirect and the frozen adversarial catalogue all point here. Both render
  // `StudioHomeView`, so there is one implementation and the two addresses
  // cannot drift apart.
  //
  // It returns BEFORE any study data is loaded. Internal staff need none of it
  // here, and loading every study's complete authorized dataset in order to
  // render a list of names was by far the most expensive thing this route did.
  // ---------------------------------------------------------------------------
  if (profile?.role === "internal") {
    return (
      <StudioShell
        userEmail={user.email ?? ""}
        currentHref="/dashboard"
        breadcrumb={["Studio", "Inicio"]}
        title="Tu espacio de trabajo"
        lead="Desde aquí preparas, revisas y publicas los estudios de cada cliente. Nada llega a un cliente hasta que se publica."
        utility={<SignOut tone="paper" />}
      >
        <StudioHomeView />
      </StudioShell>
    );
  }

  // Load each study's rows once (server-side, RLS-scoped, so only this tenant's
  // data is ever read). From the same rows we derive the static metrics (§5.2)
  // and the pivot allowlist (§5.3) — a user can only ever cross fields that exist
  // in their own data.
  const loadedStudyData: {
    study: Study;
    dashboard: StudyDashboardPayload;
    rows: LongRow[];
  }[] = studies
    ? await Promise.all(
        studies.map(async (study) => {
          const authorized = await loadAuthorizedStudyData(supabase, study.id);
          if (!authorized) throw new Error("Study authorization changed during dashboard load");
          const { rows, qualitative } = authorized;
          return {
            study,
            rows,
            // This is the serialization boundary: raw rows stay in this Server
            // Component. The browser receives only sanitized aggregate DTOs.
            dashboard: buildStudyDashboard(
              rows,
              qualitative,
              parseJourneyDefinition(study.journey_definition),
              {},
              study.dashboard_config,
            ),
          };
        }),
      )
    : [];
  // Internal users may see studies from more than one tenant. Never aggregate
  // those into a fake cross-client history: P5A belongs to a client portal and
  // the backoffice will require an explicit tenant selection in P6.
  const currentSections = loadedStudyData[0]
    ? parseDashboardConfig(loadedStudyData[0].study.dashboard_config).sections
    : null;
  const longitudinal = currentSections?.trends === false
    ? { periods: 0, series: [] }
    : buildLongitudinalView(loadedStudyData.map(({ study, rows }) => ({
        name: study.name,
        period: study.period,
        createdAt: study.created_at,
        rows,
      })));
  const studyData = loadedStudyData.map(({ study, dashboard }) => ({ study, dashboard }));
  const narrative = !studyData[0] || currentSections?.narrative === false
    ? null
    : buildNarrativeHome(studyData[0].study, studyData[0].dashboard, longitudinal);
  const brand = parseBrandConfig(tenant?.brand_config);
  const brandName = brand.displayName ?? tenant?.name ?? "Be Community";
  const brandLogo = logoPublicUrl(brand.logoPath);

  // ---------------------------------------------------------------------------
  // Be Community Insights — the client home.
  // ---------------------------------------------------------------------------
  return (
    <InsightsShell
      brandName={brandName}
      tagline={brand.tagline}
      brand={brand}
      logoUrl={brandLogo}
      userEmail={user.email ?? ""}
      utility={<SignOut />}
    >
      {!profile ? (
        <StateBlock tone="caution" title="Tu cuenta todavía no está vinculada">
          <p>
            No encontramos a qué comunidad perteneces, así que no podemos
            mostrarte ningún estudio. Escríbele al equipo de Be Community y lo
            resolvemos.
          </p>
        </StateBlock>
      ) : !studies || studies.length === 0 ? (
        /* Concise, and with one small thing to do. Publication mechanics are
           internal workflow and are no longer explained to the client. */
        <StudyComingSoon />
      ) : (
        <>
          {narrative ? (
            <NarrativeHome view={narrative} brand={brand} studyDestination={insightsStudyHref(narrative.currentStudy.id)} />
          ) : (
            /* The panorama is switched off for this study. Say so — the page
               used to open on a bare heading with no explanation (C5). */
            <div className="mb-10">
              <StateBlock title="Este estudio se muestra sin panorama">
                <p>
                  El equipo de Be Community configuró este estudio para leerse
                  directamente en el detalle, más abajo.
                </p>
              </StateBlock>
            </div>
          )}
          <LongitudinalTrends view={longitudinal} />

          {/* Keep the current study's real controls on the compatibility home:
              the protected live suites drive this exact surface. Older studies
              become concise doorways instead of repeated report-length cards. */}
          {studyData[0] ? (
            <div className="mt-10">
              <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.13em] text-evidence">Explorar</p>
                  <h2 className="mt-1.5 text-2xl">Mira el estudio más reciente</h2>
                </div>
                <a
                  href={insightsStudyHref(studyData[0].study.id)}
                  className="inline-flex min-h-11 items-center rounded-lg border border-line-strong bg-surface px-4 py-2.5 text-sm font-semibold text-strong hover:bg-surface-sunken"
                >
                  Abrirlo en su propia vista
                </a>
              </div>
              <StudyCard
                study={studyData[0].study}
                initialDashboard={studyData[0].dashboard}
              />
            </div>
          ) : null}

          <StudyLibrary
            studies={studyData}
            currentId={studyData[0]?.study.id ?? null}
          />
        </>
      )}
    </InsightsShell>
  );
}
