"use client";

import { useMemo, useState } from "react";
import { StateBlock } from "@/components/States";
import type { LongitudinalSeries, LongitudinalView } from "@/lib/dashboard/longitudinal";
import { sampleCopy } from "@/lib/language/sample";

const WIDTH = 760, HEIGHT = 270;
const MARGIN = { top: 30, right: 24, bottom: 54, left: 54 };

function formatted(value: number, unit: LongitudinalSeries["unit"]): string {
  const number = new Intl.NumberFormat("es-MX", { maximumFractionDigits: 2 }).format(value);
  return unit === "percent" ? `${number}%` : number;
}

function pointCopy(point: LongitudinalSeries["points"][number]): string {
  return point.visibility === "no-data" ? "Sin resultado en este periodo" : sampleCopy(point.visibility, point.n).headline;
}

function domain(series: LongitudinalSeries): [number, number] {
  if (series.unit === "nps") return [-100, 100];
  if (series.unit === "percent") return [0, 100];
  const values = series.points.flatMap((point) => point.value == null ? [] : [point.value]);
  if (!values.length) return [0, 10];
  const low = Math.min(...values), high = Math.max(...values);
  if (low === high) return [Math.min(0, low - 1), high + 1];
  const padding = Math.max((high - low) * 0.2, 0.5);
  return [Math.max(0, low - padding), high + padding];
}

function TrendList({ series }: { series: LongitudinalSeries }) {
  return <ol className="mt-5 grid gap-3 sm:grid-cols-2">{series.points.map((point, index) => <li key={`${point.studyName}-${index}`} className="rounded-xl border border-line bg-surface-sunken p-4">
    <p className="text-xs font-semibold uppercase tracking-wide text-muted">{point.period}</p>
    <p className="tabular mt-2 text-2xl font-semibold text-strong">{point.value == null ? "—" : formatted(point.value, series.unit)}</p>
    <p className="mt-1 text-sm text-muted">{pointCopy(point)}</p>
  </li>)}</ol>;
}

function TrendChart({ series }: { series: LongitudinalSeries }) {
  const [minimum, maximum] = domain(series);
  const innerWidth = WIDTH - MARGIN.left - MARGIN.right, innerHeight = HEIGHT - MARGIN.top - MARGIN.bottom;
  const x = (index: number) => MARGIN.left + index * innerWidth / Math.max(series.points.length - 1, 1);
  const y = (value: number) => MARGIN.top + (maximum - value) * innerHeight / (maximum - minimum);
  const ticks = Array.from({ length: 5 }, (_, index) => minimum + (maximum - minimum) * index / 4);
  return <div className="mt-5 overflow-x-auto"><svg role="img" aria-label={`Evolución de ${series.title}`} viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className="min-w-[620px] w-full">
    {ticks.map((tick) => <g key={tick}><line x1={MARGIN.left} x2={WIDTH - MARGIN.right} y1={y(tick)} y2={y(tick)} className="stroke-line" /><text x={MARGIN.left - 10} y={y(tick) + 4} textAnchor="end" className="fill-muted text-[11px]">{formatted(tick, series.unit)}</text></g>)}
    {series.points.slice(0, -1).map((point, index) => { const next = series.points[index + 1]; return point.value == null || next.value == null ? null : <line key={`${point.period}-${next.period}`} x1={x(index)} y1={y(point.value)} x2={x(index + 1)} y2={y(next.value)} className="stroke-evidence" strokeWidth="3" />; })}
    {series.points.map((point, index) => { const cy = point.value == null ? MARGIN.top + innerHeight / 2 : y(point.value); const description = `${point.period}: ${point.value == null ? "sin resultado visible" : formatted(point.value, series.unit)}. ${pointCopy(point)}`; return <g key={`${point.studyName}-${index}`} tabIndex={0} aria-label={description}>
      {point.value == null ? <path d={`M ${x(index) - 6} ${cy - 6} L ${x(index) + 6} ${cy + 6} M ${x(index) + 6} ${cy - 6} L ${x(index) - 6} ${cy + 6}`} className="stroke-muted" strokeWidth="2" /> : <circle cx={x(index)} cy={cy} r="7" className="fill-evidence stroke-surface" strokeWidth="3" />}
      {point.value != null ? <text x={x(index)} y={cy - 14} textAnchor="middle" className="fill-strong text-[11px] font-semibold">{formatted(point.value, series.unit)}</text> : null}
      <text x={x(index)} y={HEIGHT - 24} textAnchor="middle" className="fill-muted text-[11px]">{point.period}</text>
    </g>; })}
  </svg></div>;
}

function TrendTable({ series }: { series: LongitudinalSeries }) {
  return <details className="mt-5 rounded-xl border border-line bg-surface"><summary className="min-h-11 cursor-pointer px-4 py-3 text-sm font-semibold text-strong">Ver los periodos en una tabla</summary><div className="overflow-x-auto border-t border-line"><table className="w-full text-left text-sm"><thead className="bg-surface-sunken text-muted"><tr><th className="px-4 py-3 font-medium">Periodo</th><th className="px-4 py-3 font-medium">Resultado</th><th className="px-4 py-3 font-medium">Contexto</th></tr></thead><tbody>{series.points.map((point, index) => <tr key={`${point.studyName}-${index}`} className="border-t border-line"><td className="px-4 py-3 text-strong">{point.period}</td><td className="tabular px-4 py-3 font-semibold text-strong">{point.value == null ? "—" : formatted(point.value, series.unit)}</td><td className="px-4 py-3 text-muted">{pointCopy(point)}</td></tr>)}</tbody></table></div></details>;
}

export default function LongitudinalTrends({ view }: { view: LongitudinalView }) {
  const [selectedKey, setSelectedKey] = useState(view.series[0]?.key ?? "");
  const selected = useMemo(() => view.series.find((series) => series.key === selectedKey) ?? view.series[0], [selectedKey, view.series]);
  if (view.periods < 2 || !selected) return null;
  const comparable = selected.points.filter((point) => point.value != null).length;
  return <section className="mb-8 rounded-2xl border border-line bg-surface p-5 sm:p-7"><div className="flex flex-wrap items-start justify-between gap-4"><div><p className="text-xs font-semibold uppercase tracking-wide text-evidence">A través del tiempo</p><h2 className="mt-1 text-2xl font-semibold text-strong">Cómo ha cambiado</h2><p className="mt-1 max-w-2xl text-sm text-muted">El mismo indicador, leído periodo por periodo. Si una medición no lo incluyó, dejamos el espacio visible.</p></div><label className="flex w-full min-w-0 flex-col gap-1 text-xs font-medium text-muted sm:w-auto sm:min-w-52">Indicador<select value={selected.key} onChange={(event) => setSelectedKey(event.target.value)} className="min-h-11 rounded-lg border border-line bg-surface px-3 py-2 text-sm text-strong">{view.series.map((series) => <option key={series.key} value={series.key}>{series.title}</option>)}</select></label></div>
    {comparable < 2 ? <div className="mt-5"><StateBlock title="Aún no hay dos resultados visibles para comparar"><p>Conservamos el periodo sin resultado para que la historia no parezca completa cuando todavía no lo está.</p></StateBlock></div> : selected.points.length < 4 ? <TrendList series={selected} /> : <TrendChart series={selected} />}
    <TrendTable series={selected} />
  </section>;
}
