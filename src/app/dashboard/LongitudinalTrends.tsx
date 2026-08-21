"use client";

import { useMemo, useState } from "react";
import type { LongitudinalSeries, LongitudinalView } from "@/lib/dashboard/longitudinal";

const WIDTH = 760;
const HEIGHT = 280;
const MARGIN = { top: 24, right: 24, bottom: 62, left: 54 };

function formatted(value: number, unit: LongitudinalSeries["unit"]): string {
  const number = new Intl.NumberFormat("es-MX", { maximumFractionDigits: 2 }).format(value);
  return unit === "percent" ? `${number}%` : number;
}

function domain(series: LongitudinalSeries): [number, number] {
  if (series.unit === "nps") return [-100, 100];
  if (series.unit === "percent") return [0, 100];
  const values = series.points.flatMap((point) => point.value == null ? [] : [point.value]);
  if (!values.length) return [0, 10];
  const low = Math.min(...values);
  const high = Math.max(...values);
  if (low === high) return [Math.min(0, low - 1), high + 1];
  const padding = Math.max((high - low) * 0.2, 0.5);
  return [Math.max(0, low - padding), high + padding];
}

function TrendChart({ series }: { series: LongitudinalSeries }) {
  const [minimum, maximum] = domain(series);
  const innerWidth = WIDTH - MARGIN.left - MARGIN.right;
  const innerHeight = HEIGHT - MARGIN.top - MARGIN.bottom;
  const x = (index: number) => MARGIN.left + (series.points.length === 1 ? innerWidth / 2 : index * innerWidth / (series.points.length - 1));
  const y = (value: number) => MARGIN.top + (maximum - value) * innerHeight / (maximum - minimum);
  const ticks = Array.from({ length: 5 }, (_, index) => minimum + (maximum - minimum) * index / 4);

  return <div className="mt-4 overflow-x-auto">
    <svg role="img" aria-label={`Evolución de ${series.title}`} viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className="min-w-[620px] w-full">
      {ticks.map((tick) => <g key={tick}>
        <line x1={MARGIN.left} x2={WIDTH - MARGIN.right} y1={y(tick)} y2={y(tick)} stroke="currentColor" className="text-zinc-200 dark:text-zinc-700" />
        <text x={MARGIN.left - 10} y={y(tick) + 4} textAnchor="end" className="fill-zinc-500 text-[11px]">{formatted(tick, series.unit)}</text>
      </g>)}
      {series.points.slice(0, -1).map((point, index) => {
        const next = series.points[index + 1];
        if (point.value == null || next.value == null) return null;
        return <line key={`${point.period}-${next.period}`} x1={x(index)} y1={y(point.value)} x2={x(index + 1)} y2={y(next.value)} stroke="#0284c7" strokeWidth="3" />;
      })}
      {series.points.map((point, index) => <g key={`${point.studyName}-${index}`}>
        {point.value == null ? <>
          <circle cx={x(index)} cy={MARGIN.top + innerHeight / 2} r="5" fill="white" stroke="#a1a1aa" strokeWidth="2" strokeDasharray="2 2" />
          <text x={x(index)} y={MARGIN.top + innerHeight / 2 - 10} textAnchor="middle" className="fill-zinc-500 text-[10px]">{point.visibility === "suppressed" ? "oculto" : "sin datos"}</text>
        </> : <>
          <circle cx={x(index)} cy={y(point.value)} r="6" fill="#0284c7" stroke="white" strokeWidth="2" />
          <text x={x(index)} y={y(point.value) - 12} textAnchor="middle" className="fill-zinc-900 text-[11px] font-semibold dark:fill-zinc-100">{formatted(point.value, series.unit)}</text>
        </>}
        <text x={x(index)} y={HEIGHT - 34} textAnchor="middle" className="fill-zinc-700 text-[11px] dark:fill-zinc-300">{point.period}</text>
        <text x={x(index)} y={HEIGHT - 18} textAnchor="middle" className="fill-zinc-400 text-[9px]">{point.n == null ? "" : `n=${point.n}${point.visibility === "caution" ? " · cautela" : ""}`}</text>
      </g>)}
    </svg>
  </div>;
}

export default function LongitudinalTrends({ view }: { view: LongitudinalView }) {
  const [selectedKey, setSelectedKey] = useState(view.series[0]?.key ?? "");
  const selected = useMemo(() => view.series.find((series) => series.key === selectedKey) ?? view.series[0], [selectedKey, view.series]);

  if (view.periods < 2 || !selected) return null;
  const comparable = selected.points.filter((point) => point.value != null).length;

  return <section className="mb-8 rounded-xl border border-sky-200 bg-white p-5 dark:border-sky-900 dark:bg-zinc-900">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-sky-700 dark:text-sky-300">Memoria longitudinal</p>
        <h2 className="mt-1 text-xl font-semibold text-zinc-900 dark:text-zinc-50">Evolución entre periodos</h2>
        <p className="mt-1 max-w-2xl text-sm text-zinc-500 dark:text-zinc-400">Compara el mismo indicador por su clave estable, aunque cambie la redacción de la pregunta. Los periodos sin ese indicador permanecen como huecos.</p>
      </div>
      <label className="flex min-w-52 flex-col gap-1 text-xs font-medium text-zinc-600 dark:text-zinc-300">Indicador
        <select value={selected.key} onChange={(event) => setSelectedKey(event.target.value)} className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-50">
          {view.series.map((series) => <option key={series.key} value={series.key}>{series.title}</option>)}
        </select>
      </label>
    </div>
    {comparable < 2 ? <p className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">Todavía no hay dos periodos visibles para comparar este indicador.</p> : null}
    <TrendChart series={selected} />
    <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">Las muestras de 1 a 4 se ocultan; de 5 a 29 se muestran con advertencia de cautela.</p>
  </section>;
}
