"use client";

import { useMemo, useState } from "react";
import type { LongRow } from "@/lib/calc/engine";
import {
  AGG_KINDS,
  buildAllowlist,
  computePivot,
  validatePivotIntent,
  type AggKind,
  type PivotAllowlist,
  type PivotIntent,
} from "@/lib/calc/pivot";

const AGG_LABEL: Record<AggKind, string> = {
  avg: "Promedio",
  count: "Conteo",
  sum: "Suma",
  min: "Mínimo",
  max: "Máximo",
};

const NONE = "__none__";

function fmt(n: number | null): string {
  if (n == null) return "—";
  return Number.isInteger(n) ? String(n) : n.toFixed(2);
}

function labelize(s: string): string {
  return s.replace(/_/g, " ");
}

export default function PivotExplorer({
  rows,
  allowlist,
}: {
  rows: LongRow[];
  /** Passed from the server, but rebuilt client-side too as the source of truth. */
  allowlist?: PivotAllowlist;
}) {
  // The allowlist is derived from the user's own data; rebuild it here so the
  // client never trusts an externally-supplied field list.
  const allow = useMemo(() => allowlist ?? buildAllowlist(rows), [allowlist, rows]);

  const [rowDim, setRowDim] = useState<string>(allow.dimensions[0] ?? "");
  const [colDim, setColDim] = useState<string>(NONE);
  const [metric, setMetric] = useState<string>(allow.metrics[0] ?? "");
  const [agg, setAgg] = useState<AggKind>("avg");

  // The user's selection, modeled as a validated structure (§5.3) — not free
  // imperative control.
  const intent: PivotIntent = useMemo(
    () => ({
      rows: rowDim ? [rowDim] : [],
      columns: colDim !== NONE && colDim ? [colDim] : [],
      values: [{ field: metric, agg }],
    }),
    [rowDim, colDim, metric, agg],
  );

  // Live recalculation: validate the intent against the allowlist FIRST; only
  // compute if it passes. Re-runs on every selector change.
  const { result, errors } = useMemo(() => {
    const v = validatePivotIntent(intent, allow);
    if (!v.ok) return { result: null, errors: v.errors };
    try {
      return { result: computePivot(rows, intent, allow), errors: [] as string[] };
    } catch (e) {
      return { result: null, errors: [(e as Error).message] };
    }
  }, [intent, rows, allow]);

  const hasColumns = intent.columns.length > 0;
  const measure = result?.measures[0];
  const barRows =
    result && !hasColumns && measure
      ? result.body
          .map((b) => ({ label: b.rowLabels[0] || "(sin dato)", value: b.cells[`|${measure.id}`] ?? null }))
          .filter((b) => b.value != null)
      : [];
  const maxBar = barRows.reduce((mx, b) => Math.max(mx, b.value ?? 0), 0) || 1;

  const selectCls =
    "rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-50";

  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      <h4 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">Explorador de cruces</h4>
      <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
        Elige dimensiones y métrica; el resultado se recalcula en vivo.
      </p>

      {/* Controls */}
      <div className="mt-3 flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-xs text-zinc-600 dark:text-zinc-400">
          Filas
          <select value={rowDim} onChange={(e) => setRowDim(e.target.value)} className={selectCls}>
            {allow.dimensions.map((d) => (
              <option key={d} value={d}>
                {labelize(d)}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1 text-xs text-zinc-600 dark:text-zinc-400">
          Columnas
          <select value={colDim} onChange={(e) => setColDim(e.target.value)} className={selectCls}>
            <option value={NONE}>(ninguna)</option>
            {allow.dimensions
              .filter((d) => d !== rowDim)
              .map((d) => (
                <option key={d} value={d}>
                  {labelize(d)}
                </option>
              ))}
          </select>
        </label>

        <label className="flex flex-col gap-1 text-xs text-zinc-600 dark:text-zinc-400">
          Métrica
          <select value={metric} onChange={(e) => setMetric(e.target.value)} className={selectCls}>
            {allow.metrics.map((m) => (
              <option key={m} value={m}>
                {labelize(m)}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1 text-xs text-zinc-600 dark:text-zinc-400">
          Agregación
          <select value={agg} onChange={(e) => setAgg(e.target.value as AggKind)} className={selectCls}>
            {AGG_KINDS.map((a) => (
              <option key={a} value={a}>
                {AGG_LABEL[a]}
              </option>
            ))}
          </select>
        </label>
      </div>

      {/* Errors (rejected by the allowlist before any compute) */}
      {errors.length > 0 ? (
        <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
          {errors.map((e, i) => (
            <p key={i}>{e}</p>
          ))}
        </div>
      ) : null}

      {/* Result table */}
      {result && measure ? (
        <div className="mt-4 overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-zinc-50 text-left text-xs text-zinc-600 dark:bg-zinc-950 dark:text-zinc-300">
                <th className="px-3 py-2 font-medium">{labelize(rowDim)}</th>
                {hasColumns ? (
                  result.colCombos.map((c) => (
                    <th key={c.key} className="px-3 py-2 text-right font-medium">
                      {labelize(c.labels[0] || "(sin dato)")}
                    </th>
                  ))
                ) : (
                  <th className="px-3 py-2 text-right font-medium">{measure.label}</th>
                )}
              </tr>
            </thead>
            <tbody>
              {result.body.map((b, i) => (
                <tr key={i} className="border-t border-zinc-100 dark:border-zinc-800">
                  <td className="px-3 py-2 text-zinc-700 dark:text-zinc-300">{b.rowLabels[0] || "(sin dato)"}</td>
                  {hasColumns ? (
                    result.colCombos.map((c) => (
                      <td key={c.key} className="px-3 py-2 text-right font-medium text-zinc-900 dark:text-zinc-50">
                        {fmt(b.cells[`${c.key}|${measure.id}`] ?? null)}
                      </td>
                    ))
                  ) : (
                    <td className="px-3 py-2 text-right font-medium text-zinc-900 dark:text-zinc-50">
                      {fmt(b.cells[`|${measure.id}`] ?? null)}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {/* Bar chart (1-D breakdown) */}
      {barRows.length > 0 && measure ? (
        <div className="mt-4">
          <p className="mb-2 text-xs font-medium text-zinc-600 dark:text-zinc-400">{measure.label}</p>
          <div className="flex flex-col gap-1.5">
            {barRows.map((b) => (
              <div key={b.label} className="flex items-center gap-2">
                <span className="w-24 shrink-0 truncate text-xs text-zinc-600 dark:text-zinc-400">{b.label}</span>
                <div className="h-5 flex-1 rounded bg-zinc-100 dark:bg-zinc-800">
                  <div
                    className="flex h-5 items-center justify-end rounded bg-zinc-900 px-2 text-[10px] font-medium text-white dark:bg-zinc-200 dark:text-zinc-900"
                    style={{ width: `${Math.max(8, ((b.value ?? 0) / maxBar) * 100)}%` }}
                  >
                    {fmt(b.value)}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
