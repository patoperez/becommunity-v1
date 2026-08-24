import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { parseJourneyDefinition } from "@/lib/calc/journey";
import { generateSuggestions, reviewObservations } from "./actions";
import { StudioShell } from "@/components/shell/StudioShell";
import { STUDIO_HOME } from "@/components/shell/BackLink";
import { StateBlock } from "@/components/States";
import { logout } from "@/app/dashboard/actions";

export const metadata = { title: "Revisión cualitativa · Be Community" };

type Search = Promise<{ study?: string; ok?: string; error?: string }>;
type Study = { id: string; name: string; period: string | null; journey_definition: unknown };
type Observation = {
  id: string; source: string | null; category: string | null; theme: string | null; quote: string | null;
  suggested_theme: string | null; confirmed_theme: string | null; confirmed_stage_key: string | null;
  review_status: "pending" | "confirmed" | "rejected"; quote_approved: boolean;
};

const input =
  "min-h-11 rounded-lg border border-line-strong bg-surface px-3 py-2 text-sm text-strong";

/** The raw enum, translated at the presentation boundary only. */
const REVIEW_STATUS: Record<Observation["review_status"], string> = {
  pending: "Pendiente",
  confirmed: "Confirmada",
  rejected: "Descartada",
};

/**
 * Each summary uses its own semantic family as a TINT and an edge, never as a
 * saturated block: pending is the work waiting (caution), confirmed is work
 * finished (positive), rejected is work deliberately set aside (danger).
 */
const SUMMARY = [
  { key: "pending", label: "Pendientes", surface: "bg-caution-surface", line: "border-caution-line", text: "text-caution" },
  { key: "confirmed", label: "Confirmadas", surface: "bg-positive-surface", line: "border-positive-line", text: "text-positive" },
  { key: "rejected", label: "Descartadas", surface: "bg-danger-surface", line: "border-danger-line", text: "text-danger" },
] as const;

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
  const { data: observations } = selected
    ? await admin.from("qual_observation")
      .select("id, source, category, theme, quote, suggested_theme, confirmed_theme, confirmed_stage_key, review_status, quote_approved")
      .eq("study_id", selected.id).order("created_at", { ascending: true }).limit(100).returns<Observation[]>()
    : { data: [] as Observation[] };
  const rows = observations ?? [];
  const stages = selected ? parseJourneyDefinition(selected.journey_definition) : [];
  const counts = {
    pending: rows.filter((row) => row.review_status === "pending").length,
    confirmed: rows.filter((row) => row.review_status === "confirmed").length,
    rejected: rows.filter((row) => row.review_status === "rejected").length,
  };

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

      {/* Zone 1 — which study am I reviewing. */}
      <section className="rounded-xl border border-voice-line bg-voice-surface p-4 sm:p-5">
        <h2 className="text-base font-semibold text-strong">¿De qué estudio?</h2>
        <form className="mt-3 flex flex-wrap items-end gap-3" method="get">
          <label className="flex min-w-0 flex-col gap-1 text-sm font-medium text-strong">
            Estudio
            <select name="study" defaultValue={selected?.id ?? ""} className={input}>
              {(studies ?? []).map((study) => <option key={study.id} value={study.id}>{study.name}{study.period ? ` · ${study.period}` : ""}</option>)}
            </select>
          </label>
          <button className="min-h-11 rounded-lg bg-ink px-4 py-2 text-sm font-semibold text-paper hover:bg-[#183b5c]">Abrir</button>
        </form>
      </section>

      {!selected ? (
        <StateBlock title="Todavía no hay ningún estudio que revisar">
          <p>Crea o importa un estudio antes de revisar observaciones.</p>
        </StateBlock>
      ) : rows.length === 0 ? (
        <StateBlock title="Este estudio no tiene observaciones cualitativas">
          <p>
            Su archivo no traía columnas de texto abierto, o todavía no se ha
            cargado. Cuando existan comentarios, aparecerán aquí para revisarlos
            uno por uno.
          </p>
        </StateBlock>
      ) : <>
        {/* Zone 2 — where the work stands. */}
        <section aria-label="Estado de la revisión" className="grid gap-3 sm:grid-cols-3">
          {SUMMARY.map((item) => (
            <div key={item.key} className={`rounded-xl border ${item.line} ${item.surface} p-4`}>
              <p className={`text-xs font-semibold uppercase tracking-wide ${item.text}`}>{item.label}</p>
              <p className="tabular mt-1 font-display text-2xl font-semibold text-strong">{counts[item.key]}</p>
            </div>
          ))}
        </section>

        {/* Zone 3 — the machine's first pass. */}
        <section className="rounded-xl border border-line bg-surface p-4 sm:p-5">
          <h2 className="text-base font-semibold text-strong">Primera pasada automática</h2>
          <p className="mt-1 max-w-prose text-sm text-muted">
            Propone un tema por palabras clave, de forma determinista. No confirma
            nada y no publica nada.
          </p>
          <form action={generateSuggestions} className="mt-3">
            <input type="hidden" name="study_id" value={selected.id} />
            <button className="min-h-11 rounded-lg border border-sky-line bg-sky-surface px-4 py-2 text-sm font-semibold text-strong hover:brightness-[0.98]">Generar sugerencias pendientes</button>
          </form>
        </section>

        <form action={reviewObservations} className="space-y-4">
          <input type="hidden" name="study_id" value={selected.id} />

          {/* Zone 4 — the review table itself. */}
          <section className="overflow-hidden rounded-xl border border-line bg-surface">
            <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 border-b border-line px-4 py-3 sm:px-5">
              <h2 className="text-base font-semibold text-strong">Observaciones</h2>
              <p className="text-sm text-muted">
                {rows.length === 100 ? "Se muestran las primeras 100" : `${rows.length} en este estudio`}
              </p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[900px] text-left text-sm">
                <thead className="bg-surface-sunken text-xs uppercase tracking-wide text-muted">
                  <tr><th className="p-3">Elegir</th><th className="p-3">Cita interna</th><th className="p-3">Tema origen</th><th className="p-3">Sugerencia</th><th className="p-3">Confirmado</th><th className="p-3">Publicar cita</th></tr>
                </thead>
                <tbody>{rows.map((row) => <tr key={row.id} className="border-t border-line align-top">
                  <td className="p-3"><input type="checkbox" name="observation_id" value={row.id} className="h-4 w-4" /></td>
                  <td className="max-w-md p-3">
                    <p className="text-strong">{row.quote || "(sin texto)"}</p>
                    <p className="mt-1 flex flex-wrap items-center gap-x-2 text-xs text-muted">
                      <span>{row.source ?? "sin fuente"}</span>
                      <span
                        className={`rounded-full border px-2 py-0.5 font-medium ${
                          row.review_status === "confirmed"
                            ? "border-positive-line bg-positive-surface text-positive"
                            : row.review_status === "rejected"
                              ? "border-danger-line bg-danger-surface text-danger"
                              : "border-caution-line bg-caution-surface text-caution"
                        }`}
                      >
                        {REVIEW_STATUS[row.review_status]}
                      </span>
                    </p>
                  </td>
                  <td className="p-3 font-mono text-xs text-muted">{row.theme ?? "—"}</td>
                  <td className="p-3 font-mono text-xs text-muted">{row.suggested_theme ?? "—"}</td>
                  <td className="p-3 font-mono text-xs text-muted">{row.confirmed_theme ?? "—"}{row.confirmed_stage_key ? <span className="block text-muted">etapa: {row.confirmed_stage_key}</span> : null}</td>
                  <td className="p-3"><input aria-label={`Publicar cita ${row.id}`} type="checkbox" name="quote_id" value={row.id} defaultChecked={row.quote_approved} className="h-4 w-4" /></td>
                </tr>)}</tbody>
              </table>
            </div>
          </section>

          {/* Zone 5 — what to do with the rows you chose. */}
          <section className="rounded-xl border border-voice-line bg-voice-surface p-4 sm:p-5">
            <h2 className="text-base font-semibold text-strong">Acciones sobre lo seleccionado</h2>
            <div className="mt-3 flex flex-wrap items-end gap-3">
              <label className="flex flex-col gap-1 text-xs font-medium text-strong">Tema para reetiquetar/fusionar<input name="theme" maxLength={120} className={input} placeholder="comunicacion" /></label>
              <label className="flex flex-col gap-1 text-xs font-medium text-strong">Etapa del journey<select name="stage_key" className={input}><option value="">Sin etapa</option>{stages.map((stage) => <option key={stage.id} value={stage.id}>{stage.label}</option>)}</select></label>
              <button name="mode" value="accept" className="min-h-11 rounded-lg border border-positive-line bg-positive-surface px-4 py-2 text-sm font-semibold text-positive hover:brightness-[0.98]">Aceptar sugerencias</button>
              <button name="mode" value="retag" className="min-h-11 rounded-lg border border-sky-line bg-sky-surface px-4 py-2 text-sm font-semibold text-strong hover:brightness-[0.98]">Reetiquetar / fusionar</button>
              <button name="mode" value="reject" className="min-h-11 rounded-lg border border-danger-line bg-danger-surface px-4 py-2 text-sm font-semibold text-danger hover:brightness-[0.98]">Rechazar</button>
            </div>
            <p className="mt-2.5 text-xs text-muted">Seleccionar varias filas y asignarles el mismo tema las fusiona bajo una categoría confirmada.</p>
          </section>
        </form>
      </>}
    </div>
  </StudioShell>;
}
