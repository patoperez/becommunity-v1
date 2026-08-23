import Link from "next/link";
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

export const metadata = {
  title: "Portal · Be Community",
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
  const longitudinal = profile?.role === "internal" || currentSections?.trends === false
    ? { periods: 0, series: [] }
    : buildLongitudinalView(loadedStudyData.map(({ study, rows }) => ({
        name: study.name,
        period: study.period,
        createdAt: study.created_at,
        rows,
      })));
  const studyData = loadedStudyData.map(({ study, dashboard }) => ({ study, dashboard }));
  const narrative = profile?.role === "internal" || !studyData[0] || currentSections?.narrative === false
    ? null
    : buildNarrativeHome(studyData[0].study, studyData[0].dashboard, longitudinal);
  const brand = parseBrandConfig(tenant?.brand_config);
  const brandName = brand.displayName ?? tenant?.name ?? "Be Community";
  const brandLogo = logoPublicUrl(brand.logoPath);

  return (
    <div className="flex flex-1 flex-col bg-zinc-50 dark:bg-zinc-950">
      <header
        className="flex items-center justify-between border-b px-6 py-4 text-white"
        style={{ backgroundColor: brand.primaryColor, borderColor: brand.accentColor }}
      >
        <div className="flex min-w-0 items-center gap-3">
          {brandLogo ? <>
            {/* Dynamic tenant Storage URLs cannot use a static Next Image remote allowlist. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={brandLogo} alt={`Logotipo de ${brandName}`} className="h-11 w-11 shrink-0 rounded-lg bg-white object-contain p-1" />
          </> : null}
          <div className="min-w-0">
            <h1 className="truncate text-lg font-semibold">{profile?.role === "internal" ? "Be Community" : brandName}</h1>
            <p className="truncate text-xs text-white/75">
              {profile?.role === "internal" ? "Equipo interno" : brand.tagline}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <span className="hidden text-sm text-white/80 sm:inline">
            {user.email}
          </span>
          <form action={logout}>
            <button
              type="submit"
              className="rounded-lg border border-white/40 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-white/10"
            >
              Cerrar sesión
            </button>
          </form>
        </div>
      </header>

      <main className="mx-auto w-full max-w-4xl flex-1 px-6 py-10">
        {profile?.role === "internal" ? (
          <div className="mb-8 flex items-center justify-between rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
            <div>
              <h2 className="font-semibold text-zinc-900 dark:text-zinc-50">Panel interno</h2>
              <p className="text-sm text-zinc-500 dark:text-zinc-400">
                Carga datos de un estudio hacia el modelo canónico.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Link href="/admin/clients" className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium">Clientes y usuarios</Link>
              <Link href="/admin/qualitative" className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium">Revisión cualitativa</Link>
              <Link
                href="/admin/studies"
                className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200"
              >
                Estudios y plantillas
              </Link>
            </div>
          </div>
        ) : null}

        {narrative ? <NarrativeHome view={narrative} brand={brand} /> : null}
        <LongitudinalTrends view={longitudinal} />

        <h2 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">
          Tus estudios
        </h2>

        {!profile ? (
          <div className="mt-6 rounded-xl border border-amber-200 bg-amber-50 p-6 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">
            Tu cuenta aún no está vinculada a un cliente. Contacta al equipo de
            Be Community.
          </div>
        ) : !studies || studies.length === 0 ? (
          <div className="mt-6 rounded-xl border border-zinc-200 bg-white p-10 text-center dark:border-zinc-800 dark:bg-zinc-900">
            <p className="text-sm text-zinc-600 dark:text-zinc-400">
              Todavía no hay estudios disponibles. Aparecerán aquí en cuanto Be
              Community los publique.
            </p>
          </div>
        ) : (
          <div className="mt-6 grid grid-cols-1 gap-4">
            {studyData.map(({ study, dashboard }) => (
              <StudyCard
                key={study.id}
                study={study}
                initialDashboard={dashboard}
              />
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
