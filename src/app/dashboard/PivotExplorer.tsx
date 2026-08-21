"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { AGG_KINDS, validatePivotIntent, type AggKind, type PivotAllowlist, type PivotIntent } from "@/lib/calc/pivot";
import type { SegmentFilters } from "@/lib/calc/filters";
import type { SafePivotResult } from "@/lib/dashboard/view";
import { formatScore } from "@/lib/calc/format";
import { computeStudyPivot } from "./data-actions";

const AGG_LABEL: Record<AggKind, string> = { avg: "Promedio", count: "Conteo", sum: "Suma", min: "Mínimo", max: "Máximo" };
const NONE = "__none__";
const fmt = formatScore;
function labelize(value: string) { return value.replace(/_/g, " "); }

export default function PivotExplorer({ studyId, filters, allowlist }: { studyId: string; filters: SegmentFilters; allowlist: PivotAllowlist }) {
  const [rowDim, setRowDim] = useState(allowlist.dimensions[0] ?? "");
  const [colDim, setColDim] = useState(NONE);
  const [metric, setMetric] = useState(allowlist.metrics[0] ?? "");
  const [agg, setAgg] = useState<AggKind>("avg");
  const [result, setResult] = useState<SafePivotResult | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [pending, startTransition] = useTransition();
  const request = useRef(0);
  const intent: PivotIntent = useMemo(() => ({ rows: rowDim ? [rowDim] : [], columns: colDim !== NONE && colDim ? [colDim] : [], values: [{ field: metric, agg }] }), [rowDim, colDim, metric, agg]);
  const validation = useMemo(() => validatePivotIntent(intent, allowlist), [allowlist, intent]);

  useEffect(() => {
    if (!validation.ok) return;
    const current = ++request.current;
    startTransition(async () => {
      const response = await computeStudyPivot(studyId, filters, intent);
      if (current !== request.current) return;
      if (response.ok) { setResult(response.data); setErrors([]); }
      else { setResult(null); setErrors([response.error]); }
    });
  }, [allowlist, filters, intent, studyId, validation]);

  const hasColumns = intent.columns.length > 0;
  const visibleResult = validation.ok ? result : null;
  const visibleErrors = validation.ok ? errors : validation.errors;
  const measure = visibleResult?.measures[0];
  const barRows = visibleResult && !hasColumns && measure ? visibleResult.body.map((row) => ({ label: row.rowLabels[0] || "(sin dato)", value: row.cells[`|${measure.id}`] ?? null })).filter((row) => row.value != null) : [];
  const maxBar = barRows.reduce((max, row) => Math.max(max, row.value ?? 0), 0) || 1;
  const selectCls = "rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-50";

  return <div className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
    <div className="flex items-start justify-between gap-3"><div><h4 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">Explorador de cruces</h4><p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">El servidor recalcula resultados agregados; las filas de respuesta no llegan al navegador.</p></div>{pending ? <span className="text-xs text-violet-600">Calculando...</span> : null}</div>
    <div className="mt-3 flex flex-wrap items-end gap-3">
      <label className="flex flex-col gap-1 text-xs text-zinc-600 dark:text-zinc-400">Filas<select value={rowDim} onChange={(event) => setRowDim(event.target.value)} className={selectCls}>{allowlist.dimensions.map((dimension) => <option key={dimension} value={dimension}>{labelize(dimension)}</option>)}</select></label>
      <label className="flex flex-col gap-1 text-xs text-zinc-600 dark:text-zinc-400">Columnas<select value={colDim} onChange={(event) => setColDim(event.target.value)} className={selectCls}><option value={NONE}>(ninguna)</option>{allowlist.dimensions.filter((dimension) => dimension !== rowDim).map((dimension) => <option key={dimension} value={dimension}>{labelize(dimension)}</option>)}</select></label>
      <label className="flex flex-col gap-1 text-xs text-zinc-600 dark:text-zinc-400">Métrica<select value={metric} onChange={(event) => setMetric(event.target.value)} className={selectCls}>{allowlist.metrics.map((item) => <option key={item} value={item}>{labelize(item)}</option>)}</select></label>
      <label className="flex flex-col gap-1 text-xs text-zinc-600 dark:text-zinc-400">Agregación<select value={agg} onChange={(event) => setAgg(event.target.value as AggKind)} className={selectCls}>{AGG_KINDS.map((item) => <option key={item} value={item}>{AGG_LABEL[item]}</option>)}</select></label>
    </div>
    {visibleErrors.length ? <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{visibleErrors.map((error) => <p key={error}>{error}</p>)}</div> : null}
    {visibleResult && measure ? <div className="mt-4 overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800"><table className="w-full text-sm"><thead><tr className="bg-zinc-50 text-left text-xs text-zinc-600 dark:bg-zinc-950 dark:text-zinc-300"><th className="px-3 py-2 font-medium">{labelize(rowDim)}</th>{hasColumns ? visibleResult.colCombos.map((column) => <th key={column.key} className="px-3 py-2 text-right font-medium">{labelize(column.labels[0] || "(sin dato)")}</th>) : <th className="px-3 py-2 text-right font-medium">{measure.label}</th>}</tr></thead><tbody>{visibleResult.body.map((row, index) => <tr key={index} className="border-t border-zinc-100 dark:border-zinc-800"><td className="px-3 py-2 text-zinc-700 dark:text-zinc-300">{row.rowLabels[0] || "(sin dato)"}</td>{hasColumns ? visibleResult.colCombos.map((column) => { const key = `${column.key}|${measure.id}`; return <td key={key} className="px-3 py-2 text-right font-medium">{row.suppressed[key] ? "Muestra insuficiente" : fmt(row.cells[key] ?? null)}</td>; }) : <td className="px-3 py-2 text-right font-medium">{row.suppressed[`|${measure.id}`] ? "Muestra insuficiente" : fmt(row.cells[`|${measure.id}`] ?? null)}</td>}</tr>)}</tbody></table></div> : null}
    {barRows.length && measure ? <div className="mt-4"><p className="mb-2 text-xs font-medium text-zinc-600">{measure.label}</p><div className="flex flex-col gap-1.5">{barRows.map((row) => <div key={row.label} className="flex items-center gap-2"><span className="w-24 shrink-0 truncate text-xs text-zinc-600">{row.label}</span><div className="h-5 flex-1 rounded bg-zinc-100"><div className="flex h-5 items-center justify-end rounded bg-zinc-900 px-2 text-[10px] font-medium text-white" style={{ width: `${Math.max(8, ((row.value ?? 0) / maxBar) * 100)}%` }}>{fmt(row.value)}</div></div></div>)}</div></div> : null}
  </div>;
}
