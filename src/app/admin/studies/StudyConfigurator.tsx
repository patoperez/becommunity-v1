"use client";

import { useState } from "react";
import Link from "next/link";
import type { JourneyStage } from "@/lib/calc/journey";
import type { DashboardSectionKey, DashboardSections } from "@/lib/dashboard/config";
import { updateStudyConfiguration } from "./actions";

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

const input = "w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950";

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

  return <details className="rounded-xl border bg-white p-5 open:ring-1 open:ring-zinc-200 dark:bg-zinc-900 dark:open:ring-zinc-700">
    <summary className="cursor-pointer list-none">
      <div className="flex flex-wrap items-center justify-between gap-3"><div><p className="font-medium">{study.name}</p><p className="text-xs text-zinc-500">{study.period ?? "Sin periodo"} · {stages.length} etapas</p></div><span className={`rounded-full px-2.5 py-1 text-xs font-medium ${study.status === "published" ? "bg-emerald-100 text-emerald-800" : study.status === "archived" ? "bg-zinc-200 text-zinc-700" : "bg-amber-100 text-amber-800"}`}>{study.status}</span></div>
    </summary>
    <form action={updateStudyConfiguration} className="mt-5 space-y-7 border-t pt-5">
      <input type="hidden" name="study_id" value={study.id} />
      <section><div className="flex flex-wrap items-center justify-between gap-3"><h3 className="text-sm font-semibold">Identidad y publicación</h3><Link href={`/admin/preview/${study.id}`} target="_blank" className="rounded-lg border border-sky-300 bg-sky-50 px-3 py-1.5 text-xs font-semibold text-sky-800 hover:bg-sky-100">Vista previa como cliente ↗</Link></div><div className="mt-3 grid gap-3 sm:grid-cols-3"><input className={input} name="name" required maxLength={200} defaultValue={study.name} /><input className={input} name="period" maxLength={100} defaultValue={study.period ?? ""} placeholder="Periodo" /><select className={input} name="status" defaultValue={study.status}><option value="draft">Borrador · solo equipo interno</option><option value="published">Publicado · visible al cliente</option><option value="archived">Archivado · oculto al cliente</option></select></div><p className="mt-2 text-xs text-zinc-500">No se permite publicar un estudio vacío. Los clientes solo ven estudios con estado publicado.</p></section>

      <section><h3 className="text-sm font-semibold">Secciones visibles</h3><div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{Object.entries(sectionLabels).map(([key, label]) => <label key={key} className="flex items-center gap-2 rounded-lg border bg-zinc-50 px-3 py-2 text-sm dark:bg-zinc-950"><input type="checkbox" name={`section_${key}`} defaultChecked={sections[key as DashboardSectionKey]} />{label}</label>)}</div></section>

      <section><div className="flex flex-wrap items-center justify-between gap-3"><div><h3 className="text-sm font-semibold">Etapas del journey</h3><p className="mt-1 text-xs text-zinc-500">El identificador es estable y la métrica debe usar su clave canónica, por ejemplo <code>sat_servicio</code>.</p></div><button type="button" onClick={addStage} disabled={stages.length >= 30} className="rounded-lg border px-3 py-1.5 text-sm disabled:opacity-40">Añadir etapa</button></div>
        <div className="mt-3 space-y-3">{stages.map((stage, index) => <div key={`${stage.id}-${index}`} className="grid gap-2 rounded-xl border bg-zinc-50 p-3 sm:grid-cols-[120px_1fr_1fr_auto] dark:bg-zinc-950">
          <input className={input} name="stage_id" required maxLength={64} defaultValue={stage.id} aria-label={`Identificador etapa ${index + 1}`} />
          <input className={input} name="stage_label" required maxLength={120} defaultValue={stage.label} aria-label={`Nombre etapa ${index + 1}`} />
          <input className={`${input} font-mono`} name="stage_metric" required maxLength={120} defaultValue={stage.metric} placeholder="metric_key" aria-label={`Métrica etapa ${index + 1}`} />
          <button type="button" onClick={() => setStages(stages.filter((_, item) => item !== index))} className="rounded-lg px-3 py-2 text-sm text-red-700">Quitar</button>
          <textarea className={`${input} sm:col-span-4`} name="stage_description" maxLength={500} rows={2} defaultValue={stage.description ?? ""} placeholder="Descripción opcional de la etapa" />
        </div>)}</div>
      </section>
      <button className="rounded-lg bg-zinc-900 px-5 py-2.5 text-sm font-medium text-white hover:bg-zinc-700 dark:bg-zinc-50 dark:text-zinc-900">Guardar configuración</button>
    </form>
  </details>;
}
