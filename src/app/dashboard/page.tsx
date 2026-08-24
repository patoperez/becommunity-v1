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
import { InsightsShell } from "@/components/shell/InsightsShell";
import { StudioShell, STUDIO_STOPS } from "@/components/shell/StudioShell";
import { StateBlock } from "@/components/States";
import { Forward } from "@/components/Actions";
import { studyStateLabel } from "@/lib/language/results";
import StudyComingSoon from "./StudyComingSoon";

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

/**
 * What needs attention, derived only from what this page already loaded.
 *
 * The rule this obeys: state nothing the current model cannot prove. A study
 * with no rows genuinely has no data; a draft with data genuinely has not been
 * published; a touchpoint whose metric produced no value genuinely has no
 * result. Everything else a consultant might want here — who it is assigned to,
 * when it is due, whether someone approved it — does not exist in the schema,
 * and P8-A adds no migration, so it is not claimed.
 *
 * The colour groups the KIND of work. It is never a verdict on a number.
 */
type AttentionItem = {
  studyId: string;
  studyName: string;
  period: string | null;
  kind: "sin-datos" | "sin-publicar" | "recorrido-incompleto";
  headline: string;
  actionLabel: string;
  href: string;
  accent: { fill: string; surface: string; line: string };
};

const ATTENTION_ACCENT = {
  "sin-datos": {
    fill: "var(--color-blue)",
    surface: "var(--color-sky-surface)",
    line: "var(--color-sky-line)",
  },
  "sin-publicar": {
    fill: "var(--color-lavender)",
    surface: "var(--color-lavender-surface)",
    line: "var(--color-lavender-line)",
  },
  "recorrido-incompleto": {
    fill: "var(--color-yellow)",
    surface: "var(--color-yellow-surface)",
    line: "var(--color-yellow-line)",
  },
} as const;

function attentionItems(
  studies: { study: Study; dashboard: StudyDashboardPayload }[],
): AttentionItem[] {
  const items: AttentionItem[] = [];

  for (const { study, dashboard } of studies) {
    const base = { studyId: study.id, studyName: study.name, period: study.period };

    if (dashboard.view.emptyStudy) {
      items.push({
        ...base,
        kind: "sin-datos",
        headline: "Todavía no tiene datos cargados",
        actionLabel: "Cargar datos",
        href: "/admin/upload",
        accent: ATTENTION_ACCENT["sin-datos"],
      });
      continue;
    }

    if (study.status === "draft") {
      items.push({
        ...base,
        kind: "sin-publicar",
        headline: "Tiene datos y sigue sin publicarse",
        actionLabel: "Revisarlo como el cliente",
        href: `/admin/preview/${study.id}`,
        accent: ATTENTION_ACCENT["sin-publicar"],
      });
    }

    const withoutResult = dashboard.view.journey.filter((stage) => stage.value == null).length;
    if (withoutResult > 0) {
      items.push({
        ...base,
        kind: "recorrido-incompleto",
        headline:
          withoutResult === 1
            ? "Un momento del recorrido no tiene resultado"
            : `${withoutResult} momentos del recorrido no tienen resultado`,
        actionLabel: "Ver el recorrido",
        href: `/admin/preview/${study.id}`,
        accent: ATTENTION_ACCENT["recorrido-incompleto"],
      });
    }
  }

  // Missing data first, then unpublished work, then gaps inside a study that is
  // otherwise ready. Cap the list: a home page that lists forty things is a
  // backlog, not an answer to "what needs me now".
  const rank = { "sin-datos": 0, "sin-publicar": 1, "recorrido-incompleto": 2 };
  return items.sort((a, b) => rank[a.kind] - rank[b.kind]).slice(0, 6);
}

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

  // ---------------------------------------------------------------------------
  // Be Community Studio — the internal home.
  //
  // Internal staff previously landed on the CLIENT product with a grey "Panel
  // interno" strip bolted on top, and then saw every tenant's studies in one
  // undifferentiated list. They now get their own shell, their own orientation
  // and their own primary task hierarchy.
  //
  // MIGRATION BOUNDARY: the four internal screens keep their `/admin/*`
  // addresses and their current chrome. Moving them onto this shell and onto
  // the `/studio/*` routes the information architecture defines is P8-B.
  // ---------------------------------------------------------------------------
  if (profile?.role === "internal") {
    const attention = attentionItems(studyData);
    return (
      <StudioShell
        userEmail={user.email ?? ""}
        currentHref="/dashboard"
        breadcrumb={["Studio", "Inicio"]}
        title="Tu espacio de trabajo"
        lead="Desde aquí preparas, revisas y publicas los estudios de cada cliente. Nada llega a un cliente hasta que se publica."
        utility={<SignOut tone="paper" />}
      >
        {/*
          What needs attention, first.
          Every item is derived from state the page already loaded, and says
          only what the current model can prove. No deadline, no assignee, no
          approval state and no count that would need a query this page does not
          make. When nothing qualifies, the section says so rather than
          inventing work.
        */}
        <section aria-labelledby="studio-atencion">
          <h2 id="studio-atencion" className="text-xl">
            ¿Qué necesita atención?
          </h2>
          {attention.length === 0 ? (
            <div className="mt-4">
              <StateBlock title="Nada pendiente que el producto pueda detectar">
                <p>
                  Todos los estudios con datos están publicados y sus recorridos
                  tienen resultado. Lo que siga depende de tu criterio, no de un
                  aviso automático.
                </p>
              </StateBlock>
            </div>
          ) : (
            <ul className="mt-4 grid grid-cols-1 gap-3 lg:grid-cols-2">
              {attention.map((item) => (
                <li key={`${item.studyId}-${item.kind}`}>
                  <Link
                    href={item.href}
                    className="flex h-full min-w-0 items-start gap-3.5 rounded-xl border p-4 transition-colors duration-[var(--motion-state)] hover:shadow-raised"
                    style={{ borderColor: item.accent.line, backgroundColor: item.accent.surface }}
                  >
                    {/* The dot groups the KIND of work. It is not a verdict on
                        any number. */}
                    <span
                      aria-hidden="true"
                      className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full"
                      style={{ backgroundColor: item.accent.fill }}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-semibold text-strong">
                        {item.headline}
                      </span>
                      <span className="mt-0.5 block break-words text-sm text-muted">
                        {item.studyName}
                        {item.period ? ` · ${item.period}` : ""}
                      </span>
                      <span className="mt-1.5 inline-flex items-center gap-1.5 text-sm font-semibold text-evidence">
                        {item.actionLabel} <Forward />
                      </span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section aria-labelledby="studio-tareas" className="mt-10">
          <h2 id="studio-tareas" className="text-xl">
            Ir a
          </h2>
          {/* The three things the consultant actually does to a study. Client
              administration is a secondary path below, as the information
              architecture puts it — it is not part of preparing a study. */}
          <ul className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
            {STUDIO_STOPS.filter((stop) => stop.href !== "/admin/clients" && stop.href !== "/dashboard").map((stop) => (
              <li key={stop.href}>
                <Link
                  href={stop.href}
                  className="flex h-full min-w-0 flex-col rounded-xl border border-line bg-surface p-5 transition-colors duration-[var(--motion-state)] hover:border-line-strong hover:bg-surface-sunken/50"
                >
                  <span className="flex items-center gap-2 font-display text-lg font-semibold text-strong">
                    {stop.label}
                    <Forward />
                  </span>
                  <span className="mt-1 text-sm text-muted">{stop.description}</span>
                </Link>
              </li>
            ))}
          </ul>
          <p className="mt-4 text-sm text-muted">
            ¿Necesitas dar o quitar acceso a alguien?{" "}
            <Link
              href="/admin/clients"
              className="font-semibold text-evidence underline-offset-4 hover:underline"
            >
              Ir a clientes y accesos
            </Link>
            .
          </p>
        </section>

        <section aria-labelledby="studio-estudios" className="mt-10">
          <h2 id="studio-estudios" className="text-xl">
            Estudios recientes
          </h2>
          {studyData.length === 0 ? (
            <div className="mt-4">
              <StateBlock title="Todavía no hay ningún estudio">
                <p>
                  Crea el primero desde <strong>Estudios y plantillas</strong>, o
                  empieza trayendo un archivo de datos.
                </p>
              </StateBlock>
            </div>
          ) : (
            <ul className="mt-4 divide-y divide-line overflow-hidden rounded-xl border border-line bg-surface">
              {studyData.slice(0, 8).map(({ study, dashboard }) => (
                <li
                  key={study.id}
                  className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 px-5 py-3.5"
                >
                  <div className="min-w-0">
                    <p className="break-words font-medium text-strong">{study.name}</p>
                    <p className="text-sm text-muted">
                      {study.period ?? "Sin periodo"} ·{" "}
                      {dashboard.view.emptyStudy
                        ? "sin datos cargados"
                        : "con datos cargados"}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="rounded-full border border-line bg-surface-sunken px-2.5 py-0.5 text-xs font-medium text-muted">
                      {studyStateLabel(study.status)}
                    </span>
                    <Link
                      href={`/admin/preview/${study.id}`}
                      className="inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-evidence underline-offset-4 hover:underline"
                    >
                      Ver como el cliente <Forward />
                    </Link>
                  </div>
                </li>
              ))}
            </ul>
          )}
          {studyData.length > 8 ? (
            <p className="mt-3 text-sm text-muted">
              Se muestran los 8 más recientes.{" "}
              <Link href="/admin/studies" className="font-semibold text-evidence underline-offset-4 hover:underline">
                Ver todos los estudios
              </Link>
              .
            </p>
          ) : null}
        </section>
      </StudioShell>
    );
  }

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
            <NarrativeHome view={narrative} brand={brand} />
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

          <h2 className="sr-only">Tus estudios</h2>
          <div className="grid grid-cols-1 gap-6">
            {studyData.map(({ study, dashboard }) => (
              <StudyCard
                key={study.id}
                study={study}
                initialDashboard={dashboard}
              />
            ))}
          </div>
        </>
      )}
    </InsightsShell>
  );
}
