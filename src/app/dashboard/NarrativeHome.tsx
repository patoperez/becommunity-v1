import type { NarrativeHomeView } from "@/lib/dashboard/narrative";

function Delta({ metric }: { metric: NarrativeHomeView["metrics"][number] }) {
  if (!metric.delta) return <span className="text-zinc-400">Sin comparativo inmediato</span>;
  const arrow = metric.movement === "up" ? "↑" : metric.movement === "down" ? "↓" : "→";
  return <span className="text-sky-700 dark:text-sky-300">{arrow} {metric.delta} vs. periodo anterior</span>;
}

export default function NarrativeHome({ view }: { view: NarrativeHomeView }) {
  const studyAnchor = `study-${view.currentStudy.id}`;
  const reportHref = `/api/studies/${encodeURIComponent(view.currentStudy.id)}/report`;

  return <section className="mb-8 overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
    <div className="bg-gradient-to-br from-sky-950 via-sky-900 to-cyan-800 px-6 py-7 text-white">
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-cyan-200">Panorama actual</p>
      <div className="mt-2 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="text-2xl font-semibold">{view.currentStudy.name}</h2>
          <p className="mt-1 text-sm text-sky-100">{view.currentStudy.period ?? "Periodo actual"} · Lo esencial antes de explorar</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <a href={`#${studyAnchor}`} className="rounded-lg bg-white px-3 py-2 text-xs font-semibold text-sky-950 hover:bg-sky-50">Explorar estudio</a>
          {view.currentStudy.reportAvailable ? <a href={reportHref} className="rounded-lg border border-white/40 px-3 py-2 text-xs font-semibold text-white hover:bg-white/10">Descargar informe PDF</a> : null}
        </div>
      </div>
    </div>

    <div className="p-6">
      <div>
        <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">Qué cambió</h3>
        {view.metrics.length ? <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {view.metrics.map((metric) => <div key={metric.key} className="rounded-xl border border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-800 dark:bg-zinc-950">
            <p className="text-xs font-medium text-zinc-500 dark:text-zinc-400">{metric.title}</p>
            <p className="mt-1 text-2xl font-semibold text-zinc-900 dark:text-zinc-50">{metric.value ?? "—"}</p>
            <p className="mt-1 text-[11px]"><Delta metric={metric} /></p>
          </div>)}
        </div> : <p className="mt-2 text-sm text-zinc-500">El estudio actual aún no tiene indicadores publicables.</p>}
      </div>

      <div className="mt-6 border-t border-zinc-200 pt-5 dark:border-zinc-800">
        <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">Qué está apareciendo</h3>
        {view.themes.length ? <div className="mt-3 flex flex-wrap gap-2">
          {view.themes.map((theme) => <span key={theme.theme} className="rounded-full bg-violet-50 px-3 py-1.5 text-sm text-violet-800 dark:bg-violet-950 dark:text-violet-200">{theme.theme.replace(/_/g, " ")} <span className="ml-1 text-xs text-violet-500">{theme.count} menc.</span></span>)}
        </div> : <p className="mt-2 text-sm text-zinc-500">Todavía no hay temas cualitativos confirmados para mostrar.</p>}
        {!view.hasPreviousWave ? <p className="mt-4 text-xs text-zinc-400">Cuando exista otra ola comparable, esta portada mostrará automáticamente los cambios.</p> : null}
      </div>
    </div>
  </section>;
}
