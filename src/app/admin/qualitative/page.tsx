import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { parseJourneyDefinition } from "@/lib/calc/journey";
import { StudioShell } from "@/components/shell/StudioShell";
import { STUDIO_HOME } from "@/components/shell/BackLink";
import { StateBlock } from "@/components/States";
import { logout } from "@/app/dashboard/actions";
import { QualitativeWorkspaceView } from "@/components/studio/QualitativeWorkspaceView";
import {
  loadQualitativeWorkspace,
  parseReviewState,
} from "@/lib/studio/qualitative-workspace";
import { parsePageRequest } from "@/lib/studio/paging";

export const metadata = { title: "Revisión cualitativa · Be Community" };

type Search = Promise<{
  study?: string;
  estado?: string;
  p?: string;
  por?: string;
  ok?: string;
  error?: string;
}>;
type Study = { id: string; name: string; period: string | null; journey_definition: unknown };

const input =
  "min-h-11 rounded-lg border border-line-strong bg-surface px-3 py-2 text-sm text-strong";

/**
 * The legacy address of the qualitative review.
 *
 * It keeps its own URL, its `?study=` parameter, its Server Actions and its
 * control names, because bookmarks and the frozen adversarial catalogue both
 * depend on them. What changed is inside: the silent `.limit(100)` became
 * visible paging and a state filter, and the free-text theme box became a
 * picker over the themes this study already carries.
 */
export default async function QualitativePage({ searchParams }: { searchParams: Search }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { data: profile } = await supabase.from("profiles").select("role").eq("user_id", user.id).single<{ role: string }>();
  if (profile?.role !== "internal") redirect("/dashboard");

  const query = await searchParams;
  const admin = createAdminClient();
  const { data: studies } = await admin.from("study").select("id, name, period, journey_definition")
    .order("created_at", { ascending: false }).returns<Study[]>();
  const selected = (studies ?? []).find((study) => study.id === query.study) ?? studies?.[0] ?? null;

  const state = parseReviewState(query.estado);
  const workspace = selected
    ? await loadQualitativeWorkspace(admin, selected.id, {
        state,
        page: parsePageRequest(query),
      })
    : null;
  const stages = selected ? parseJourneyDefinition(selected.journey_definition) : [];

  return <StudioShell
    userEmail={user.email ?? ""}
    currentHref="/admin/qualitative"
    back={STUDIO_HOME}
    breadcrumb={["Studio", "Lo que dijeron las personas"]}
    title="Revisión cualitativa"
    lead="Las sugerencias son propuestas. Nada se publica sin que una persona lo confirme, y cada cita se aprueba por separado."
    headerAccent={{ surface: "var(--color-lavender-surface)", line: "var(--color-lavender-line)" }}
    utility={<form action={logout}><button type="submit" className="min-h-11 rounded-lg border border-paper/40 px-3 py-1.5 text-sm font-medium text-paper transition-colors duration-[var(--motion-state)] hover:bg-paper/10">Cerrar sesión</button></form>}
  >
    <div className="space-y-6">
      {query.ok ? <p role="status" className="rounded-lg border border-positive-line bg-positive-surface px-4 py-3 text-sm text-positive">{query.ok}</p> : null}
      {query.error ? <p role="status" className="rounded-lg border border-danger-line bg-danger-surface px-4 py-3 text-sm text-danger">{query.error}</p> : null}

      {!selected || !workspace ? (
        <StateBlock title="Todavía no hay ningún estudio que revisar">
          <p>Crea o importa un estudio antes de revisar observaciones.</p>
        </StateBlock>
      ) : (
        <QualitativeWorkspaceView
          studyId={selected.id}
          workspace={workspace}
          stages={stages.map((stage) => ({ id: stage.id, label: stage.label }))}
          basePath="/admin/qualitative"
          filterParams={{ study: selected.id, estado: state, por: query.por ?? null }}
          selector={
            <section className="rounded-xl border border-voice-line bg-voice-surface p-4 sm:p-5">
              <h2 className="text-base font-semibold text-strong">¿De qué estudio?</h2>
              <form className="mt-3 flex flex-wrap items-end gap-3" method="get">
                <label className="flex min-w-0 flex-col gap-1 text-sm font-medium text-strong">
                  Estudio
                  <select name="study" defaultValue={selected.id} className={input}>
                    {(studies ?? []).map((study) => <option key={study.id} value={study.id}>{study.name}{study.period ? ` · ${study.period}` : ""}</option>)}
                  </select>
                </label>
                <button className="min-h-11 rounded-lg bg-ink px-4 py-2 text-sm font-semibold text-paper hover:bg-[#183b5c]">Abrir</button>
              </form>
            </section>
          }
        />
      )}
    </div>
  </StudioShell>;
}
