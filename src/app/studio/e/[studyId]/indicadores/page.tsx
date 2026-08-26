import { notFound } from "next/navigation";
import { z } from "zod";
import { requireInternal } from "@/lib/studio/guard";
import { loadStudioStudy } from "@/lib/studio/study-workspace";
import { StudyWorkSurface } from "@/components/studio/StudyWorkSurface";
import { JourneyStagesFields } from "@/components/studio/JourneyStagesFields";
import { updateStudyConfiguration } from "@/app/admin/studies/actions";
import { dashboardSectionKeys, type DashboardSectionKey } from "@/lib/dashboard/config";
import { historicalStageMetrics } from "@/lib/studio/journey-picker";
import { studioStudyIndicators } from "@/lib/studio/routes";

export const metadata = { title: "Resultados y recorrido · Be Community" };

type Params = Promise<{ studyId: string }>;
type Search = Promise<{ ok?: string; error?: string }>;

const SECTION_LABEL: Record<DashboardSectionKey, string> = {
  narrative: "Panorama narrativo",
  trends: "Tendencias históricas",
  filters: "Filtros interactivos",
  journey: "Journey map",
  qualitative: "Hallazgos cualitativos",
  metrics: "Indicadores y promedios",
  segments: "Cruces por segmento",
  pivot: "Explorador pivote",
  report: "Descarga de informe PDF",
};

const input =
  "min-h-11 w-full rounded-lg border border-line-strong bg-surface px-3 py-2 text-sm text-strong";

/**
 * What this study shows, and what each moment of the recorrido measures.
 *
 * The recorrido is the reason this screen exists in its own right: putting a
 * number on a touchpoint used to mean typing a canonical metric key from
 * memory, and getting it wrong produced a moment that renders blank with no
 * explanation. Here the results come from the study's own data, each labelled
 * with what it says today.
 *
 * The Server Action is the SAME one `/admin/studies` dispatches, with the same
 * fields; only the address and the return path differ.
 */
export default async function StudioStudyIndicatorsPage({
  params,
  searchParams,
}: {
  params: Params;
  searchParams: Search;
}) {
  const { user, admin } = await requireInternal();
  const { studyId } = await params;
  if (!z.string().uuid().safeParse(studyId).success) notFound();
  const workspace = await loadStudioStudy(admin, studyId);
  if (!workspace) notFound();
  const query = await searchParams;
  const { study, metricOptions } = workspace;
  const presentation = (await import("@/lib/dashboard/config")).parseDashboardConfig(study.dashboardConfig).presentation;
  const historical = historicalStageMetrics(study.stages, metricOptions);

  return (
    <StudyWorkSurface
      workspace={workspace}
      current="indicadores"
      userEmail={user.email ?? ""}
      title="Resultados y recorrido"
      lead="Elige qué secciones ve el cliente y qué resultado muestra cada momento del recorrido."
      ok={query.ok}
      error={query.error}
    >
      <section aria-labelledby="resultados" className="rounded-xl border border-line bg-surface p-5">
        <h2 id="resultados" className="text-base font-semibold text-strong">
          Resultados que este estudio produjo
        </h2>
        {metricOptions.length === 0 ? (
          <p className="mt-2 text-sm text-muted">
            Todavía ninguno: hacen falta datos numéricos. Trae un archivo desde el paso de datos.
          </p>
        ) : (
          <ul className="mt-3 grid gap-2.5 sm:grid-cols-2">
            {metricOptions.map((option) => (
              <li key={option.key} className="rounded-lg border border-line bg-surface-page p-3">
                <p className="text-sm font-semibold text-strong">{option.name}</p>
                <p className="mt-0.5 text-xs text-muted">{option.question}</p>
                <p className="mt-1.5 text-sm text-body">
                  {option.today == null
                    ? "Hoy no tiene respuestas."
                    : `Hoy dice ${option.today} sobre ${option.people} ${
                        option.people === 1 ? "respuesta" : "respuestas"
                      }.`}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>

      {historical.length > 0 ? (
        <section className="rounded-xl border border-caution-line bg-caution-surface p-5">
          <h2 className="text-base font-semibold text-caution">
            Momentos que apuntan a un resultado que ya no existe
          </h2>
          <p className="mt-1 text-sm text-caution">
            Se conservan tal cual: el producto no los reasigna solo, porque hacerlo cambiaría en
            silencio lo que un cliente ya vio.
          </p>
          <ul className="mt-2.5 list-disc space-y-1 pl-5 text-sm text-caution">
            {historical.map((entry) => (
              <li key={entry.stageId}>{entry.label}</li>
            ))}
          </ul>
        </section>
      ) : null}

      <form action={updateStudyConfiguration} className="space-y-7 rounded-xl border border-line bg-surface p-5">
        <input type="hidden" name="study_id" value={study.id} />
        {/* The stored enum, carried unchanged: this form cannot move it, and the
            Server Action refuses any attempt to. */}
        <input type="hidden" name="status" value={study.status} />
        <input type="hidden" name="return_to" value={studioStudyIndicators(study.id)} />
        <input type="hidden" name="presentation_controls" value="on" />

        <JourneyStagesFields
          initialStages={study.stages}
          options={metricOptions}
          submitLabel="Guardar configuración"
          submitClassName="min-h-11 rounded-lg bg-ink px-5 py-2.5 text-sm font-semibold text-paper hover:bg-[#183b5c] disabled:cursor-not-allowed disabled:opacity-50"
        >
          <section>
            <h2 className="text-base font-semibold text-strong">Identidad</h2>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <label className="text-sm font-medium text-strong">
                Nombre del estudio
                <input className={`${input} mt-1 font-normal`} name="name" required maxLength={200} defaultValue={study.name} />
              </label>
              <label className="text-sm font-medium text-strong">
                Periodo <span className="font-normal text-muted">(opcional)</span>
                <input className={`${input} mt-1 font-normal`} name="period" maxLength={100} defaultValue={study.period ?? ""} placeholder="Ola 2 · 2026" />
              </label>
            </div>
          </section>

          <section className="rounded-xl border border-evidence-line bg-evidence-surface p-4">
            <h2 className="text-base font-semibold text-strong">Presentación de este estudio</h2>
            <p className="mt-1 max-w-prose text-xs text-muted">Déjalo vacío para usar la identidad del cliente. Al guardar este estudio como plantilla, estas decisiones también se conservan.</p>
            <label className="mt-3 flex min-h-11 items-center gap-2 text-sm font-medium text-strong"><input type="checkbox" name="use_study_palette" defaultChecked={Boolean(presentation.primaryColor || presentation.accentColor)} />Usar colores propios en este estudio</label>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <label className="text-sm font-medium text-strong">Color principal propio <span className="font-normal text-muted">(opcional)</span><input className={`${input} mt-1 h-11 p-1`} type="color" name="presentation_primary" defaultValue={presentation.primaryColor ?? study.clientBrand.primaryColor} /></label>
              <label className="text-sm font-medium text-strong">Color de acento propio <span className="font-normal text-muted">(opcional)</span><input className={`${input} mt-1 h-11 p-1`} type="color" name="presentation_accent" defaultValue={presentation.accentColor ?? study.clientBrand.accentColor} /></label>
              <label className="text-sm font-medium text-strong">Etiqueta de portada <span className="font-normal text-muted">(opcional)</span><input className={`${input} mt-1 font-normal`} name="cover_label" maxLength={80} defaultValue={presentation.coverLabel ?? ""} placeholder="Panorama del estudio" /></label>
              <label className="text-sm font-medium text-strong">Nota breve de portada <span className="font-normal text-muted">(opcional)</span><input className={`${input} mt-1 font-normal`} name="cover_note" maxLength={240} defaultValue={presentation.coverNote ?? ""} placeholder="Una frase propia para presentar este estudio" /></label>
            </div>
            <fieldset className="mt-5"><legend className="text-sm font-semibold text-strong">Una alerta útil, sólo si un resultado sale del rango ideal</legend><p className="mt-1 text-xs text-muted">No pinta todo como semáforo. Si el resultado está dentro del rango, no aparece ninguna alerta.</p><div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <label className="text-sm font-medium text-strong">Resultado<select className={`${input} mt-1 font-normal`} name="threshold_metric" defaultValue={presentation.threshold?.metric ?? ""}><option value="">Sin alerta</option>{metricOptions.map((option) => <option key={option.key} value={option.key}>{option.name}</option>)}</select></label>
              <label className="text-sm font-medium text-strong">Mínimo ideal<input className={`${input} mt-1 font-normal`} type="number" step="any" name="threshold_minimum" defaultValue={presentation.threshold?.minimum ?? ""} /></label>
              <label className="text-sm font-medium text-strong">Máximo ideal<input className={`${input} mt-1 font-normal`} type="number" step="any" name="threshold_maximum" defaultValue={presentation.threshold?.maximum ?? ""} /></label>
              <label className="text-sm font-medium text-strong">Cómo nombrarlo<input className={`${input} mt-1 font-normal`} name="threshold_label" maxLength={160} defaultValue={presentation.threshold?.label ?? "Fuera del rango ideal"} /></label>
            </div></fieldset>
          </section>

          <section>
            <h2 className="text-base font-semibold text-strong">Secciones visibles para el cliente</h2>
            <p className="mt-1 max-w-prose text-xs text-muted">
              Lo que apagues sencillamente no aparece: el cliente no ve un hueco ni un aviso.
            </p>
            <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {dashboardSectionKeys.map((key) => (
                <label key={key} className="flex min-h-11 items-center gap-2 rounded-lg border border-line bg-surface-page px-3 py-2 text-sm text-strong">
                  <input type="checkbox" name={`section_${key}`} defaultChecked={study.sections[key]} />
                  {SECTION_LABEL[key]}
                </label>
              ))}
            </div>
          </section>
        </JourneyStagesFields>
      </form>
    </StudyWorkSurface>
  );
}
