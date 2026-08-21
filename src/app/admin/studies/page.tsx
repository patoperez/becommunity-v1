import Link from "next/link";
import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import {
  createBlankStudy,
  createStudyFromTemplate,
  deleteTemplate,
  saveStudyAsTemplate,
  updateTemplateMetadata,
} from "./actions";
import StudyConfigurator from "./StudyConfigurator";
import { parseDashboardConfig } from "@/lib/dashboard/config";
import { parseJourneyDefinition } from "@/lib/calc/journey";

export const metadata = { title: "Estudios y plantillas · Be Community" };

type Search = Promise<{ ok?: string; error?: string }>;
type Tenant = { id: string; name: string };
type Study = { id: string; tenant_id: string; name: string; period: string | null; status: string; dashboard_config: unknown; journey_definition: unknown };
type Template = {
  id: string; name: string; description: string; version: number; preview: Record<string, number>;
  updated_at: string;
};

const input = "w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950";
const button = "rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 dark:bg-zinc-50 dark:text-zinc-900";

export default async function StudiesPage({ searchParams }: { searchParams: Search }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { data: profile } = await supabase.from("profiles").select("role").eq("user_id", user.id).single<{ role: string }>();
  if (profile?.role !== "internal") redirect("/dashboard");

  const admin = createAdminClient();
  const [{ data: tenants }, { data: studies }, { data: templates }, query] = await Promise.all([
    admin.from("tenant").select("id, name").order("name").returns<Tenant[]>(),
    admin.from("study").select("id, tenant_id, name, period, status, dashboard_config, journey_definition").order("created_at", { ascending: false }).returns<Study[]>(),
    admin.from("study_template").select("id, name, description, version, preview, updated_at")
      .eq("created_by", user.id).order("updated_at", { ascending: false }).returns<Template[]>(),
    searchParams,
  ]);
  const tenantList = tenants ?? [];
  const studyList = studies ?? [];
  const templateList = templates ?? [];

  return <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950">
    <header className="border-b border-zinc-200 bg-white px-6 py-4 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="mx-auto flex max-w-7xl items-center justify-between">
        <div><h1 className="text-lg font-semibold">Estudios y plantillas</h1><p className="text-xs text-zinc-500">Inicio estilo Word · biblioteca personal</p></div>
        <div className="flex gap-2"><Link className="rounded-lg border px-3 py-1.5 text-sm" href="/admin/qualitative">Revisión cualitativa</Link><Link className="rounded-lg border px-3 py-1.5 text-sm" href="/admin/upload">Cargar datos</Link><Link className="rounded-lg border px-3 py-1.5 text-sm" href="/dashboard">Portal</Link></div>
      </div>
    </header>
    <main className="mx-auto max-w-7xl space-y-10 px-6 py-10">
      {query.ok ? <p className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">{query.ok}</p> : null}
      {query.error ? <p className="rounded-lg bg-red-50 p-3 text-sm text-red-800">{query.error}</p> : null}

      <section>
        <h2 className="text-xl font-semibold">Comenzar un estudio</h2>
        <div className="mt-4 grid gap-5 lg:grid-cols-3">
          <form action={createBlankStudy} className="rounded-xl border-2 border-dashed border-zinc-300 bg-white p-5 dark:border-zinc-700 dark:bg-zinc-900">
            <div className="text-4xl font-light text-zinc-400">＋</div><h3 className="mt-3 font-semibold">Estudio en blanco</h3><p className="mb-4 text-sm text-zinc-500">Empieza sin configuración heredada.</p>
            <select name="tenant_id" required className={input}><option value="">Selecciona cliente</option>{tenantList.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</select>
            <input name="name" required maxLength={200} placeholder="Nombre del estudio" className={`${input} mt-2`} />
            <input name="period" maxLength={100} placeholder="Periodo (opcional)" className={`${input} mt-2`} />
            <button className={`${button} mt-4`}>Crear y cargar datos</button>
          </form>
          {templateList.map(template => <article key={template.id} className="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
            <div className="flex justify-between gap-3"><div><h3 className="font-semibold">{template.name}</h3><p className="text-xs text-zinc-500">Versión {template.version}</p></div><span className="text-3xl">▤</span></div>
            <p className="mt-3 min-h-10 text-sm text-zinc-600 dark:text-zinc-400">{template.description || "Sin descripción"}</p>
            <p className="mt-3 text-xs text-zinc-500">{template.preview.metrics ?? 0} métricas · {template.preview.dimensions ?? 0} dimensiones · {template.preview.mappings ?? 0} mapeos</p>
            <form action={createStudyFromTemplate} className="mt-4 space-y-2">
              <input type="hidden" name="template_id" value={template.id} />
              <select name="tenant_id" required className={input}><option value="">Selecciona cliente</option>{tenantList.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</select>
              <input name="name" required maxLength={200} placeholder="Nombre del nuevo estudio" className={input} />
              <input name="period" maxLength={100} placeholder="Periodo (opcional)" className={input} />
              <button className={button}>Usar plantilla</button>
            </form>
            <details className="mt-4 border-t pt-3"><summary className="cursor-pointer text-sm text-zinc-600">Editar o eliminar</summary>
              <form action={updateTemplateMetadata} className="mt-3 space-y-2"><input type="hidden" name="template_id" value={template.id} /><input name="name" defaultValue={template.name} required className={input} /><textarea name="description" defaultValue={template.description} maxLength={1000} className={input} /><button className="rounded-lg border px-3 py-1.5 text-sm">Guardar nueva versión</button></form>
              <form action={deleteTemplate} className="mt-3 space-y-2"><input type="hidden" name="template_id" value={template.id} /><label className="flex items-center gap-2 text-xs text-red-700"><input type="checkbox" required /> Confirmo que quiero eliminar esta plantilla</label><button className="text-sm text-red-700 underline">Eliminar plantilla</button></form>
            </details>
          </article>)}
        </div>
      </section>

      <section className="rounded-xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
        <h2 className="text-xl font-semibold">Guardar estudio como plantilla</h2><p className="mt-1 text-sm text-zinc-500">Solo se copia configuración. Las respuestas y citas nunca entran en la plantilla.</p>
        <form action={saveStudyAsTemplate} className="mt-4 grid gap-3 md:grid-cols-2">
          <select name="study_id" required className={input}><option value="">Selecciona estudio</option>{studyList.map(s => <option key={s.id} value={s.id}>{s.name}{s.period ? ` · ${s.period}` : ""}</option>)}</select>
          <select name="template_id" className={input}><option value="">Crear plantilla nueva</option>{templateList.map(t => <option key={t.id} value={t.id}>Sobrescribir “{t.name}” (v{t.version})</option>)}</select>
          <input name="name" required maxLength={120} placeholder="Nombre de la plantilla" className={input} />
          <input name="description" maxLength={1000} placeholder="Descripción" className={input} />
          <button className={`${button} md:col-span-2 md:w-fit`}>Guardar como plantilla</button>
        </form>
      </section>

      <section><h2 className="text-xl font-semibold">Estudios existentes</h2><div className="mt-4 grid gap-3 md:grid-cols-2">{studyList.map(study => <div key={study.id} className="flex items-center justify-between rounded-lg border bg-white p-4 dark:bg-zinc-900"><div><p className="font-medium">{study.name}</p><p className="text-xs text-zinc-500">{study.period ?? "Sin periodo"}</p></div><Link className="text-sm underline" href={`/admin/upload?tenant=${study.tenant_id}&study=${study.id}`}>Cargar datos</Link></div>)}</div></section>
      <section><div><h2 className="text-xl font-semibold">Configurar y publicar</h2><p className="mt-1 text-sm text-zinc-500">La configuración se aplica también al recálculo filtrado y al informe PDF.</p></div><div className="mt-4 space-y-3">{studyList.map(study => <StudyConfigurator key={study.id} study={study} sections={parseDashboardConfig(study.dashboard_config).sections} initialStages={parseJourneyDefinition(study.journey_definition)} />)}</div></section>
    </main>
  </div>;
}
