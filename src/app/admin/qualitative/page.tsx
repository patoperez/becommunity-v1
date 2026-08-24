import Link from "next/link";
import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { parseJourneyDefinition } from "@/lib/calc/journey";
import { generateSuggestions, reviewObservations } from "./actions";

export const metadata = { title: "Revisión cualitativa · Be Community" };

type Search = Promise<{ study?: string; ok?: string; error?: string }>;
type Study = { id: string; name: string; period: string | null; journey_definition: unknown };
type Observation = {
  id: string; source: string | null; category: string | null; theme: string | null; quote: string | null;
  suggested_theme: string | null; confirmed_theme: string | null; confirmed_stage_key: string | null;
  review_status: "pending" | "confirmed" | "rejected"; quote_approved: boolean;
};

const input = "rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950";

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

  return <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950">
    <header className="border-b border-zinc-200 bg-white px-6 py-4 dark:border-zinc-800 dark:bg-zinc-900"><div className="mx-auto flex max-w-7xl items-center justify-between"><div><h1 className="text-lg font-semibold">Revisión cualitativa</h1><p className="text-xs text-zinc-500">Las sugerencias nunca se publican sin confirmación humana.</p></div><div className="flex gap-2"><Link className="rounded-lg border px-3 py-1.5 text-sm" href="/admin/studies">Estudios</Link><Link className="rounded-lg border px-3 py-1.5 text-sm" href="/dashboard">Portal</Link></div></div></header>
    <main id="contenido" className="mx-auto max-w-7xl space-y-6 px-6 py-8">
      {query.ok ? <p className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">{query.ok}</p> : null}
      {query.error ? <p className="rounded-lg bg-red-50 p-3 text-sm text-red-800">{query.error}</p> : null}
      <form className="flex flex-wrap items-end gap-3" method="get"><label className="flex flex-col gap-1 text-sm font-medium">Estudio<select name="study" defaultValue={selected?.id ?? ""} className={input}>{(studies ?? []).map((study) => <option key={study.id} value={study.id}>{study.name}{study.period ? ` · ${study.period}` : ""}</option>)}</select></label><button className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white">Abrir</button></form>
      {!selected ? <p className="rounded-xl border bg-white p-8 text-sm text-zinc-500">Crea o importa un estudio antes de revisar observaciones.</p> : <>
        <section className="grid gap-3 sm:grid-cols-3">{Object.entries(counts).map(([key, value]) => <div key={key} className="rounded-xl border bg-white p-4 dark:bg-zinc-900"><p className="text-xs uppercase text-zinc-500">{key.replace("pending", "pendientes").replace("confirmed", "confirmadas").replace("rejected", "rechazadas")}</p><p className="mt-1 text-2xl font-semibold">{value}</p></div>)}</section>
        <form action={generateSuggestions}><input type="hidden" name="study_id" value={selected.id} /><button className="rounded-lg border border-sky-300 bg-sky-50 px-4 py-2 text-sm font-medium text-sky-800">Generar sugerencias pendientes</button><p className="mt-1 text-xs text-zinc-500">Primera pasada determinista por palabras clave; requiere revisión manual.</p></form>
        <form action={reviewObservations} className="space-y-4">
          <input type="hidden" name="study_id" value={selected.id} />
          <div className="overflow-x-auto rounded-xl border bg-white dark:bg-zinc-900"><table className="w-full min-w-[900px] text-left text-sm"><thead className="bg-zinc-100 text-xs uppercase text-zinc-500 dark:bg-zinc-800"><tr><th className="p-3">Elegir</th><th className="p-3">Cita interna</th><th className="p-3">Tema origen</th><th className="p-3">Sugerencia</th><th className="p-3">Confirmado</th><th className="p-3">Publicar cita</th></tr></thead><tbody>{rows.map((row) => <tr key={row.id} className="border-t align-top dark:border-zinc-800"><td className="p-3"><input type="checkbox" name="observation_id" value={row.id} /></td><td className="max-w-md p-3"><p>{row.quote || "(sin texto)"}</p><p className="mt-1 text-xs text-zinc-400">{row.source ?? "sin fuente"} · {row.review_status}</p></td><td className="p-3 font-mono text-xs">{row.theme ?? "—"}</td><td className="p-3 font-mono text-xs">{row.suggested_theme ?? "—"}</td><td className="p-3 font-mono text-xs">{row.confirmed_theme ?? "—"}{row.confirmed_stage_key ? <span className="block text-zinc-400">etapa: {row.confirmed_stage_key}</span> : null}</td><td className="p-3"><input aria-label={`Publicar cita ${row.id}`} type="checkbox" name="quote_id" value={row.id} defaultChecked={row.quote_approved} /></td></tr>)}</tbody></table></div>
          <div className="rounded-xl border bg-white p-4 dark:bg-zinc-900"><div className="flex flex-wrap items-end gap-3"><label className="flex flex-col gap-1 text-xs font-medium">Tema para reetiquetar/fusionar<input name="theme" maxLength={120} className={input} placeholder="comunicacion" /></label><label className="flex flex-col gap-1 text-xs font-medium">Etapa del journey<select name="stage_key" className={input}><option value="">Sin etapa</option>{stages.map((stage) => <option key={stage.id} value={stage.id}>{stage.label}</option>)}</select></label><button name="mode" value="accept" className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-medium text-white">Aceptar sugerencias</button><button name="mode" value="retag" className="rounded-lg bg-sky-700 px-4 py-2 text-sm font-medium text-white">Reetiquetar / fusionar</button><button name="mode" value="reject" className="rounded-lg bg-red-700 px-4 py-2 text-sm font-medium text-white">Rechazar</button></div><p className="mt-2 text-xs text-zinc-500">Seleccionar varias filas y asignarles el mismo tema las fusiona bajo una categoría confirmada.</p></div>
        </form>
      </>}
    </main>
  </div>;
}
