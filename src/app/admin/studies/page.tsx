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
import { StudioShell } from "@/components/shell/StudioShell";
import { STUDIO_HOME } from "@/components/shell/BackLink";
import { StateBlock } from "@/components/States";
import { Forward } from "@/components/Actions";
import { studyStateLabel } from "@/lib/language/results";
import { logout } from "@/app/dashboard/actions";
import { loadStudyMetricOptions } from "@/lib/studio/metric-inventory";
import { loadTenantArchiveState } from "@/lib/studio/lifecycle";
import { parsePageRequest, resolvePage } from "@/lib/studio/paging";
import { Pager } from "@/components/studio/Pager";
import { studioStudy, studioStudyPublish } from "@/lib/studio/routes";

export const metadata = { title: "Estudios y plantillas · Be Community" };

type Search = Promise<{ ok?: string; error?: string; p?: string; por?: string }>;
type Tenant = { id: string; name: string };
type Study = { id: string; tenant_id: string; name: string; period: string | null; status: string; dashboard_config: unknown; journey_definition: unknown };
type Template = {
  id: string; name: string; description: string; version: number; preview: Record<string, number>;
  updated_at: string;
};

const input =
  "min-h-11 w-full rounded-lg border border-line-strong bg-surface px-3 py-2 text-sm text-strong";
const button =
  "min-h-11 rounded-lg bg-ink px-4 py-2 text-sm font-semibold text-paper hover:bg-[#183b5c]";

/** A study's state as a compact accent, not a loud card. */
function StateChip({ status }: { status: string }) {
  const tone = status === "published"
    ? "border-positive-line bg-positive-surface text-positive"
    : status === "archived"
      ? "border-line bg-surface-sunken text-muted"
      : "border-caution-line bg-caution-surface text-caution";
  return (
    <span className={`shrink-0 rounded-full border px-2.5 py-0.5 text-xs font-medium ${tone}`}>
      {studyStateLabel(status)}
    </span>
  );
}

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

  // The configurator used to render one open-ended editor for EVERY study in
  // the database. It is now a bounded page of the newest studies, with the
  // count stated, so the list can grow for years without the page growing with
  // it — and so the results picker only has to read the studies on screen.
  const configWindow = resolvePage(parsePageRequest(query), studyList.length);
  const configurable = studyList.slice(configWindow.from, configWindow.from + configWindow.size);
  const [metricOptions, archiveState] = await Promise.all([
    loadStudyMetricOptions(admin, configurable.map((study) => study.id)),
    loadTenantArchiveState(admin, tenantList.map((tenant) => tenant.id)),
  ]);
  const archivedTenants = new Set(
    Object.entries(archiveState.archivedAt).flatMap(([id, at]) => (at ? [id] : [])),
  );

  return <StudioShell
    userEmail={user.email ?? ""}
    currentHref="/admin/studies"
    back={STUDIO_HOME}
    breadcrumb={["Studio", "Estudios y plantillas"]}
    title="Estudios y plantillas"
    lead="Crea un estudio, reutiliza una configuración que ya funcionó, y decide qué ve el cliente y cuándo."
    headerAccent={{ surface: "var(--color-sky-surface)", line: "var(--color-sky-line)" }}
    utility={<form action={logout}><button type="submit" className="min-h-11 rounded-lg border border-paper/40 px-3 py-1.5 text-sm font-medium text-paper transition-colors duration-[var(--motion-state)] hover:bg-paper/10">Cerrar sesión</button></form>}
  >
    <div className="space-y-10">
      {query.ok ? <p role="status" className="rounded-lg border border-positive-line bg-positive-surface px-4 py-3 text-sm text-positive">{query.ok}</p> : null}
      {query.error ? <p role="status" className="rounded-lg border border-danger-line bg-danger-surface px-4 py-3 text-sm text-danger">{query.error}</p> : null}

      {/* Starting work — the sky family. */}
      <section aria-labelledby="comenzar" className="rounded-2xl border border-sky-line bg-sky-surface p-5 sm:p-6">
        <h2 id="comenzar" className="text-xl">Comenzar un estudio</h2>
        <p className="mt-1 max-w-prose text-sm text-muted">
          Empieza en blanco, o parte de una plantilla que ya trae indicadores,
          puntos de contacto y la forma de leer el archivo.
        </p>
        <div className="mt-5 grid gap-4 lg:grid-cols-3">
          <form action={createBlankStudy} className="flex flex-col rounded-xl border border-dashed border-line-strong bg-surface p-5">
            <div aria-hidden="true" className="text-3xl font-light text-line-strong">＋</div>
            <h3 className="mt-2 font-display text-lg font-semibold text-strong">Estudio en blanco</h3>
            <p className="mb-4 text-sm text-muted">Empieza sin configuración heredada.</p>
            <select name="tenant_id" required className={input}><option value="">Selecciona cliente</option>{tenantList.filter(t => !archivedTenants.has(t.id)).map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</select>
            <input name="name" required maxLength={200} placeholder="Nombre del estudio" className={`${input} mt-2`} />
            <input name="period" maxLength={100} placeholder="Periodo (opcional)" className={`${input} mt-2`} />
            <button className={`${button} mt-4`}>Crear y cargar datos</button>
          </form>

          {templateList.map(template => <article key={template.id} className="flex flex-col rounded-xl border border-line bg-surface p-5">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h3 className="break-words font-display text-lg font-semibold text-strong">{template.name}</h3>
                <p className="text-xs text-muted">Versión {template.version}</p>
              </div>
              <span aria-hidden="true" className="text-2xl text-lavender">▤</span>
            </div>
            <p className="mt-2 min-h-10 text-sm text-muted">{template.description || "Sin descripción"}</p>
            <p className="mt-2 text-xs text-muted">{template.preview.metrics ?? 0} métricas · {template.preview.dimensions ?? 0} dimensiones · {template.preview.mappings ?? 0} mapeos</p>
            <form action={createStudyFromTemplate} className="mt-4 space-y-2">
              <input type="hidden" name="template_id" value={template.id} />
              <select name="tenant_id" required className={input}><option value="">Selecciona cliente</option>{tenantList.filter(t => !archivedTenants.has(t.id)).map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</select>
              <input name="name" required maxLength={200} placeholder="Nombre del nuevo estudio" className={input} />
              <input name="period" maxLength={100} placeholder="Periodo (opcional)" className={input} />
              <button className={button}>Usar plantilla</button>
            </form>
            <details className="mt-4 border-t border-line pt-3">
              <summary className="min-h-11 cursor-pointer text-sm font-medium text-muted">Editar o eliminar</summary>
              <form action={updateTemplateMetadata} className="mt-3 space-y-2"><input type="hidden" name="template_id" value={template.id} /><input name="name" defaultValue={template.name} required className={input} /><textarea name="description" defaultValue={template.description} maxLength={1000} className={input} /><button className="min-h-11 rounded-lg border border-line-strong bg-surface px-3 py-1.5 text-sm font-medium text-strong hover:bg-surface-sunken">Guardar nueva versión</button></form>
              <form action={deleteTemplate} className="mt-3 space-y-2"><input type="hidden" name="template_id" value={template.id} /><label className="flex items-center gap-2 text-xs text-danger"><input type="checkbox" required /> Confirmo que quiero eliminar esta plantilla</label><button className="text-sm font-semibold text-danger underline underline-offset-4">Eliminar plantilla</button></form>
            </details>
          </article>)}
        </div>
      </section>

      {/* Reusing work — the lavender family. */}
      <section aria-labelledby="plantilla" className="rounded-2xl border border-lavender-line bg-lavender-surface p-5 sm:p-6">
        <h2 id="plantilla" className="text-xl">Guardar estudio como plantilla</h2>
        <p className="mt-1 max-w-prose text-sm text-muted">Solo se copia configuración. Las respuestas y las citas nunca entran en la plantilla.</p>
        <form action={saveStudyAsTemplate} className="mt-4 grid max-w-3xl gap-3 md:grid-cols-2">
          <select name="study_id" required className={input}><option value="">Selecciona estudio</option>{studyList.map(s => <option key={s.id} value={s.id}>{s.name}{s.period ? ` · ${s.period}` : ""}</option>)}</select>
          <select name="template_id" className={input}><option value="">Crear plantilla nueva</option>{templateList.map(t => <option key={t.id} value={t.id}>Sobrescribir “{t.name}” (v{t.version})</option>)}</select>
          <input name="name" required maxLength={120} placeholder="Nombre de la plantilla" className={input} />
          <input name="description" maxLength={1000} placeholder="Descripción" className={input} />
          <button className={`${button} md:col-span-2 md:w-fit`}>Guardar como plantilla</button>
        </form>
      </section>

      {/* Existing work — neutral, with compact status accents. */}
      <section aria-labelledby="existentes">
        <h2 id="existentes" className="text-xl">Estudios existentes</h2>
        {studyList.length === 0 ? (
          <div className="mt-4"><StateBlock title="Todavía no hay ningún estudio"><p>Crea el primero arriba.</p></StateBlock></div>
        ) : (
          <ul className="mt-4 divide-y divide-line overflow-hidden rounded-xl border border-line bg-surface">
            {studyList.map(study => (
              <li key={study.id} className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 px-4 py-3.5 sm:px-5">
                <div className="flex min-w-0 items-center gap-3">
                  <StateChip status={study.status} />
                  <div className="min-w-0">
                    <p className="break-words font-medium text-strong">{study.name}</p>
                    <p className="text-sm text-muted">{study.period ?? "Sin periodo"}</p>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-4">
                  <Link className="inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-evidence underline-offset-4 hover:underline" href={studioStudy(study.id)}>Abrir el estudio <Forward /></Link>
                  <Link className="inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-evidence underline-offset-4 hover:underline" href={`/admin/upload?tenant=${study.tenant_id}&study=${study.id}`}>Cargar datos <Forward /></Link>
                  <Link className="inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-evidence underline-offset-4 hover:underline" href={`/admin/preview/${study.id}`}>Ver como el cliente <Forward /></Link>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="configurar">
        <h2 id="configurar" className="text-xl">Configurar y publicar</h2>
        <p className="mt-1 max-w-prose text-sm text-muted">La configuración se aplica también al recálculo filtrado y al informe PDF.</p>
        <div className="mt-4 space-y-3">
          {configurable.map(study => <StudyConfigurator
            key={study.id}
            study={study}
            sections={parseDashboardConfig(study.dashboard_config).sections}
            initialStages={parseJourneyDefinition(study.journey_definition)}
            metricOptions={metricOptions[study.id] ?? []}
            previewHref={`/admin/preview/${study.id}`}
            publishHref={studioStudyPublish(study.id)}
          />)}
        </div>
        <div className="mt-4">
          <Pager
            window={configWindow}
            basePath="/admin/studies"
            params={{ por: query.por ?? null }}
            noun={{ one: "estudio", many: "estudios" }}
            label="Paginación de estudios configurables"
          />
        </div>
      </section>
    </div>
  </StudioShell>;
}
