"use client";

import { useState } from "react";
import Link from "next/link";
import type { JourneyStage } from "@/lib/calc/journey";
import type { DashboardSectionKey, DashboardSections } from "@/lib/dashboard/config";
import { updateStudyConfiguration } from "./actions";
import { studyStateLabel } from "@/lib/language/results";

type Study = { id: string; name: string; period: string | null; status: string };

const sectionLabels: Record<DashboardSectionKey, string> = {
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

export default function StudyConfigurator({ study, sections, initialStages }: {
  study: Study;
  sections: DashboardSections;
  initialStages: JourneyStage[];
}) {
  const [stages, setStages] = useState(initialStages);

  function addStage() {
    const suffix = stages.length + 1;
    setStages([...stages, { id: `etapa_${suffix}`, label: `Etapa ${suffix}`, metric: "", description: "" }]);
  }

  return <details className="rounded-xl border border-line bg-surface p-5 open:shadow-raised">
    <summary className="min-h-11 cursor-pointer list-none">
      <div className="flex flex-wrap items-center justify-between gap-3"><div><p className="font-medium text-strong">{study.name}</p><p className="text-xs text-muted">{study.period ?? "Sin periodo"} · {stages.length} etapas</p></div><span className={`shrink-0 rounded-full border px-2.5 py-0.5 text-xs font-medium ${study.status === "published" ? "border-positive-line bg-positive-surface text-positive" : study.status === "archived" ? "border-line bg-surface-sunken text-muted" : "border-caution-line bg-caution-surface text-caution"}`}>{studyStateLabel(study.status)}</span></div>
    </summary>
    <form action={updateStudyConfiguration} className="mt-5 space-y-7 border-t border-line pt-5">
      <input type="hidden" name="study_id" value={study.id} />
      <section><div className="flex flex-wrap items-center justify-between gap-3"><h3 className="text-sm font-semibold text-strong">Identidad y publicación</h3><Link href={`/admin/preview/${study.id}`} target="_blank" className="inline-flex min-h-11 items-center rounded-lg border border-sky-line bg-sky-surface px-3 py-1.5 text-xs font-semibold text-strong">Vista previa como cliente ↗</Link></div><div className="mt-3 grid gap-3 sm:grid-cols-3"><input className={input} name="name" required maxLength={200} defaultValue={study.name} /><input className={input} name="period" maxLength={100} defaultValue={study.period ?? ""} placeholder="Periodo" /><select className={input} name="status" defaultValue={study.status}><option value="draft">Borrador · solo equipo interno</option><option value="published">Publicado · visible al cliente</option><option value="archived">Archivado · oculto al cliente</option></select></div><p className="mt-2 text-xs text-muted">No se permite publicar un estudio vacío. Los clientes solo ven estudios con estado publicado.</p></section>

      <section><h3 className="text-sm font-semibold text-strong">Secciones visibles</h3><div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{Object.entries(sectionLabels).map(([key, label]) => <label key={key} className="flex min-h-11 items-center gap-2 rounded-lg border border-line bg-surface-page px-3 py-2 text-sm text-strong"><input type="checkbox" name={`section_${key}`} defaultChecked={sections[key as DashboardSectionKey]} />{label}</label>)}</div></section>

      <section><div className="flex flex-wrap items-center justify-between gap-3"><div><h3 className="text-sm font-semibold text-strong">Etapas del journey</h3><p className="mt-1 text-xs text-muted">El identificador es estable y la métrica debe usar su clave canónica, por ejemplo <code>sat_servicio</code>.</p></div><button type="button" onClick={addStage} disabled={stages.length >= 30} className="min-h-11 rounded-lg border border-line-strong bg-surface px-3 py-1.5 text-sm font-medium text-strong disabled:opacity-40">Añadir etapa</button></div>
        <div className="mt-3 space-y-3">{stages.map((stage, index) => <div key={`${stage.id}-${index}`} className="grid gap-2 rounded-xl border border-line bg-surface-page p-3 sm:grid-cols-[120px_1fr_1fr_auto]">
          <input className={input} name="stage_id" required maxLength={64} defaultValue={stage.id} aria-label={`Identificador etapa ${index + 1}`} />
          <input className={input} name="stage_label" required maxLength={120} defaultValue={stage.label} aria-label={`Nombre etapa ${index + 1}`} />
          <input className={`${input} font-mono`} name="stage_metric" required maxLength={120} defaultValue={stage.metric} placeholder="metric_key" aria-label={`Métrica etapa ${index + 1}`} />
          <button type="button" onClick={() => setStages(stages.filter((_, item) => item !== index))} className="min-h-11 rounded-lg px-3 py-2 text-sm font-medium text-danger">Quitar</button>
          <textarea className={`${input} sm:col-span-4`} name="stage_description" maxLength={500} rows={2} defaultValue={stage.description ?? ""} placeholder="Descripción opcional de la etapa" />
        </div>)}</div>
      </section>
      <button className="min-h-11 rounded-lg bg-ink px-5 py-2.5 text-sm font-semibold text-paper hover:bg-[#183b5c]">Guardar configuración</button>
    </form>
  </details>;
}
