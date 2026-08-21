import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { loadStudyRows } from "@/lib/calc/load";
import type { LongRow } from "@/lib/calc/engine";
import { parseJourneyDefinition, type JourneyStage } from "@/lib/calc/journey";
import StudyCard from "./StudyCard";
import { logout } from "./actions";

export const metadata = {
  title: "Portal · Be Community",
};

type Profile = {
  tenant_id: string | null;
  role: string;
  full_name: string | null;
};

type Study = {
  id: string;
  name: string;
  period: string | null;
  status: string;
  journey_definition: unknown;
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
    .select("tenant_id, role, full_name")
    .eq("user_id", user.id)
    .single<Profile>();

  // Tenant name + studies are fetched with the user's own session, so RLS
  // (§6.2) guarantees only this tenant's rows can ever come back — the server
  // does not, and cannot, hand over another client's data.
  const [{ data: tenant }, { data: studies }] = await Promise.all([
    supabase
      .from("tenant")
      .select("name")
      .eq("id", profile?.tenant_id ?? "")
      .maybeSingle<{ name: string }>(),
    supabase
      .from("study")
      .select("id, name, period, status, journey_definition")
      .order("created_at", { ascending: false })
      .returns<Study[]>(),
  ]);

  // Load each study's rows once (server-side, RLS-scoped, so only this tenant's
  // data is ever read). From the same rows we derive the static metrics (§5.2)
  // and the pivot allowlist (§5.3) — a user can only ever cross fields that exist
  // in their own data.
  const studyData: {
    study: Study;
    rows: LongRow[];
    journeyStages: JourneyStage[];
  }[] = studies
    ? await Promise.all(
        studies.map(async (study) => {
          const rows = await loadStudyRows(supabase, study.id);
          return {
            study,
            rows,
            journeyStages: parseJourneyDefinition(study.journey_definition),
          };
        }),
      )
    : [];

  return (
    <div className="flex flex-1 flex-col bg-zinc-50 dark:bg-zinc-950">
      <header className="flex items-center justify-between border-b border-zinc-200 bg-white px-6 py-4 dark:border-zinc-800 dark:bg-zinc-900">
        <div>
          <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">
            Be Community
          </h1>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            {tenant?.name ?? (profile?.role === "internal" ? "Equipo interno" : "Portal de cliente")}
          </p>
        </div>
        <div className="flex items-center gap-4">
          <span className="hidden text-sm text-zinc-600 sm:inline dark:text-zinc-400">
            {user.email}
          </span>
          <form action={logout}>
            <button
              type="submit"
              className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
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
            <Link
              href="/admin/studies"
              className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200"
            >
              Estudios y plantillas
            </Link>
          </div>
        ) : null}

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
          <div className="mt-6 grid gap-4">
            {studyData.map(({ study, rows, journeyStages }) => (
              <StudyCard
                key={study.id}
                study={study}
                rows={rows}
                journeyStages={journeyStages}
              />
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
