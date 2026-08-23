"use client";

import { useState } from "react";
import type { SafeJourneyStage } from "@/lib/dashboard/view";
import QualitativeInsights from "./QualitativeInsights";

export default function JourneyMap({ stages }: { stages: SafeJourneyStage[] }) {
  const [active, setActive] = useState(0);
  const current = stages[active];
  if (stages.length === 0) return null;

  return <div className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
    <h4 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">Journey map</h4>
    <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">Pasa el cursor por cada etapa para ver sus resultados agregados.</p>
    <div className="mt-4 flex items-start gap-1 overflow-x-auto pb-2">
      {stages.map((stage, index) => {
        const isActive = index === active;
        const hasData = stage.value != null && stage.visibility !== "suppressed";
        return <button key={stage.id} type="button" onMouseEnter={() => setActive(index)} onFocus={() => setActive(index)} onClick={() => setActive(index)} aria-pressed={isActive} className="group flex min-w-[110px] flex-1 flex-col items-center text-center outline-none">
          <div className="flex w-full items-center">
            <span className={`h-0.5 flex-1 ${index === 0 ? "opacity-0" : "bg-zinc-200 dark:bg-zinc-700"}`} />
            <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full border text-xs font-semibold transition-colors ${isActive ? "border-zinc-900 bg-zinc-900 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900" : "border-zinc-300 bg-white text-zinc-500 group-hover:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-400"}`}>{index + 1}</span>
            <span className={`h-0.5 flex-1 ${index === stages.length - 1 ? "opacity-0" : "bg-zinc-200 dark:bg-zinc-700"}`} />
          </div>
          <span className="mt-1.5 px-1 text-xs font-medium text-zinc-700 dark:text-zinc-300">{stage.label}</span>
          <span className={`mt-0.5 text-lg font-semibold ${hasData ? "text-zinc-900 dark:text-zinc-50" : "text-zinc-400 dark:text-zinc-600"}`}>{stage.visibility === "suppressed" ? "—" : stage.value ?? "—"}</span>
          <span className="text-[10px] uppercase tracking-wide text-zinc-400">{stage.kindLabel}</span>
        </button>;
      })}
    </div>
    {current ? <div className="mt-3 rounded-lg border border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-800 dark:bg-zinc-950">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <div className="min-w-0"><p className="break-words text-sm font-semibold text-zinc-900 dark:text-zinc-50">{current.label}</p><p className="break-all font-mono text-xs text-zinc-500 dark:text-zinc-400">{current.metricKey}</p></div>
        <p className="text-2xl font-bold text-zinc-900 dark:text-zinc-50">{current.visibility === "suppressed" ? "—" : current.value ?? "—"}<span className="ml-1 text-xs font-normal text-zinc-500">{current.kindLabel}</span></p>
      </div>
      {current.description ? <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">{current.description}</p> : null}
      {current.visibility === "suppressed" ? <p className="mt-2 text-sm font-medium text-amber-700 dark:text-amber-300">Muestra insuficiente para mostrar esta etapa.</p> : current.value == null ? <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">Esta etapa todavía no tiene datos en este estudio.</p> : <div className="mt-3 flex flex-wrap gap-4"><div><p className="text-xs uppercase tracking-wide text-zinc-400">Respuestas</p><p className="text-sm font-medium text-zinc-800 dark:text-zinc-200">n = {current.n}</p></div>{current.detail.map((item) => <div key={item.label}><p className="text-xs uppercase tracking-wide text-zinc-400">{item.label}</p><p className="text-sm font-medium text-zinc-800 dark:text-zinc-200">{item.value}</p></div>)}</div>}
      <QualitativeInsights summary={current.qualitative} compact />
    </div> : null}
  </div>;
}
