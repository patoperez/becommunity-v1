"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import type { SegmentFilters } from "@/lib/calc/filters";
import type { SafeMetric, StudyDashboardPayload } from "@/lib/dashboard/view";
import PivotExplorer from "./PivotExplorer";
import JourneyMap from "./JourneyMap";
import QualitativeInsights from "./QualitativeInsights";
import { refreshStudyDashboard } from "./data-actions";

type Study = { id: string; name: string; period: string | null; status: string };
function label(value: string) { return value.replace(/_/g, " "); }

function Tile({ metric }: { metric: SafeMetric }) {
  return <div className="rounded-lg border border-zinc-200 bg-zinc-50 px-4 py-3 dark:border-zinc-800 dark:bg-zinc-950">
    <p className="text-xs uppercase tracking-wide text-zinc-500 dark:text-zinc-400">{metric.title}</p>
    <p className="mt-1 text-2xl font-semibold text-zinc-900 dark:text-zinc-50">{metric.visibility === "suppressed" ? "—" : metric.value ?? "—"}</p>
    {metric.visibility === "suppressed" ? <p className="mt-0.5 text-xs text-amber-700 dark:text-amber-300">Muestra insuficiente</p> : metric.detail ? <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">{metric.detail}</p> : null}
  </div>;
}

export default function StudyCard({ study, initialDashboard }: { study: Study; initialDashboard: StudyDashboardPayload }) {
  const [filters, setFilters] = useState<SegmentFilters>({});
  const [dashboard, setDashboard] = useState(initialDashboard);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const request = useRef(0);
  const view = dashboard.view;
  const activeFilterCount = Object.values(filters).filter(Boolean).length;
  const reportHref = useMemo(() => {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(filters)) if (value) params.set(`f.${key}`, value);
    const query = params.toString();
    return `/api/studies/${encodeURIComponent(study.id)}/report${query ? `?${query}` : ""}`;
  }, [filters, study.id]);

  function applyFilters(next: SegmentFilters) {
    setFilters(next);
    setError(null);
    const current = ++request.current;
    startTransition(async () => {
      const response = await refreshStudyDashboard(study.id, next);
      if (current !== request.current) return;
      if (response.ok) setDashboard(response.data);
      else setError(response.error);
    });
  }

  return <section className="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div><h3 className="font-semibold text-zinc-900 dark:text-zinc-50">{study.name}</h3>{study.period ? <p className="text-xs text-zinc-500 dark:text-zinc-400">{study.period}</p> : null}</div>
      <div className="flex items-center gap-2">{!view.emptyStudy ? <a href={reportHref} className="rounded-lg border border-violet-300 bg-violet-50 px-3 py-1.5 text-xs font-semibold text-violet-800 hover:bg-violet-100 dark:border-violet-800 dark:bg-violet-950 dark:text-violet-200">Descargar informe PDF</a> : null}<span className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">{study.status}</span></div>
    </div>

    {view.emptyStudy ? <p className="mt-4 text-sm text-zinc-500 dark:text-zinc-400">Este estudio todavía no tiene datos cargados.</p> : <div className="mt-4 flex flex-col gap-5">
      {dashboard.filterOptions.length ? <div className="rounded-xl border border-sky-200 bg-sky-50 p-4 dark:border-sky-900 dark:bg-sky-950/40">
        <div className="flex flex-wrap items-start justify-between gap-3"><div><h4 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">Filtros del estudio</h4><p aria-live="polite" className="mt-0.5 text-xs text-zinc-600 dark:text-zinc-400">{pending ? "Actualizando resultados agregados..." : view.selectionVisibility === "suppressed" ? "Muestra insuficiente · se ocultaron los resultados de esta selección" : `${view.selectedUnits} de ${view.sourceUnits} unidades de respuesta`}</p></div>{activeFilterCount ? <button type="button" onClick={() => applyFilters({})} className="rounded-lg border border-sky-300 bg-white px-3 py-1.5 text-xs font-medium text-sky-800 hover:bg-sky-100">Limpiar {activeFilterCount === 1 ? "filtro" : `${activeFilterCount} filtros`}</button> : null}</div>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{dashboard.filterOptions.map((option) => <label key={option.key} className="flex flex-col gap-1 text-xs font-medium text-zinc-700 dark:text-zinc-300">{label(option.key)}<select aria-label={`Filtrar por ${label(option.key)}`} value={filters[option.key] ?? ""} onChange={(event) => applyFilters({ ...filters, [option.key]: event.target.value })} className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-50"><option value="">Todos</option>{option.values.map((value) => <option key={value} value={value}>{value}</option>)}</select></label>)}</div>
      </div> : null}
      {error ? <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div> : null}
      {view.emptySelection ? <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">No hay respuestas para esta combinación de filtros.</div> : null}
      {view.selectionVisibility === "caution" && view.selectedUnits != null ? <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">Base pequeña (n={view.selectedUnits}). Interpreta los resultados con cautela.</div> : null}
      {view.selectionVisibility === "suppressed" ? <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm font-medium text-amber-800">Muestra insuficiente. Se requieren al menos cinco unidades para mostrar resultados segmentados.</div> : null}
      {view.journey.length ? <JourneyMap stages={view.journey} /> : null}
      {view.selectionVisibility !== "suppressed" && !view.emptySelection ? <QualitativeInsights summary={view.qualitative} /> : null}
      {view.tiles.length ? <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">{view.tiles.map((metric) => <Tile key={metric.key} metric={metric} />)}</div> : null}
      {view.averages.length ? <div><h4 className="text-sm font-medium text-zinc-700 dark:text-zinc-300">Promedios</h4><div className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-4">{view.averages.map((metric) => <Tile key={metric.key} metric={metric} />)}</div></div> : null}
      {view.crossSegment && view.crosses.length ? <div><h4 className="text-sm font-medium text-zinc-700 dark:text-zinc-300">Cruce por <span className="font-mono">{view.crossSegment}</span></h4><div className="mt-2 grid gap-4 sm:grid-cols-2">{view.crosses.map((cross) => <div key={cross.metricKey} className="overflow-hidden rounded-lg border border-zinc-200"><div className="bg-zinc-50 px-3 py-1.5 text-xs font-medium text-zinc-600">{label(cross.metricKey)} (promedio)</div><table className="w-full text-sm"><tbody>{cross.rows.map((row) => <tr key={row.segment} className="border-t border-zinc-100"><td className="px-3 py-1.5 text-zinc-700">{row.segment}</td>{row.visibility === "suppressed" ? <td colSpan={2} className="px-3 py-1.5 text-right text-xs font-medium text-amber-700">Muestra insuficiente</td> : <><td className="px-3 py-1.5 text-right font-medium text-zinc-900">{row.value}</td><td className="px-3 py-1.5 text-right text-xs text-zinc-400">n={row.n}</td></>}</tr>)}</tbody></table></div>)}</div></div> : null}
      {view.canPivot ? <PivotExplorer studyId={study.id} filters={filters} allowlist={dashboard.pivotAllowlist} /> : null}
    </div>}
  </section>;
}
