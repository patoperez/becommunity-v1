"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { StateBlock } from "@/components/States";
import { AGG_KINDS, validatePivotIntent, type AggKind, type PivotAllowlist, type PivotIntent } from "@/lib/calc/pivot";
import type { SegmentFilters } from "@/lib/calc/filters";
import type { SafePivotResult } from "@/lib/dashboard/view";
import { formatScore } from "@/lib/calc/format";
import { characteristicLabel, resultName } from "@/lib/language/results";
import { sampleCopy } from "@/lib/language/sample";
import { computeStudyPivot } from "./data-actions";

/**
 * THE ONE SEGMENT COMPARISON.
 *
 * Until this pass the study page ALSO rendered a pre-computed cross of every
 * metric against one characteristic. On the real Cuicuilco study that was 123
 * results x 28 values of `giro` — some three thousand rows, of which almost all
 * were below the disclosure minimum, so the page repeated "muy pocas respuestas
 * para mostrarlo" hundreds of times and said nothing. It is gone. A comparison
 * now exists because a reader asked for it: one result, one characteristic, and
 * a second only when it is deliberately chosen.
 *
 * FROZEN MECHANISM — DO NOT CHANGE WITHOUT CHANGING THE HARNESS.
 *   - each control keeps its visible name ("Filas", "Columnas", "Métrica",
 *     "Agregación") as the first text inside its `<label>`, and its matching
 *     `aria-label`; Suites B and C locate and drive the controls by them;
 *   - the sr-only "Explorador de cruces" stays, because Suite C asserts its
 *     ABSENCE together with the result grid after a refused cross;
 *   - the "Preparando la comparación..." live region stays in the header, ahead
 *     of the controls, because the pivot driver settles on it;
 *   - the result grid stays a `<table>` that exists only while the intent is
 *     valid, because that is exactly what Suite C asserts is gone after a
 *     refusal.
 * The privacy rule is unchanged: a cell below the minimum never carries its
 * value, and `sanitizePivotResult` decided that on the server before this file
 * saw it.
 */

const AGG_LABEL: Record<AggKind, string> = { avg: "Promedio", count: "Cantidad", sum: "Suma", min: "El menor", max: "El mayor" };
const NONE = "__none__";
const labelize = (value: string) => value.replace(/_/g, " ");

/**
 * A metric key as a reader should see it. The allowlist holds RAW keys; the
 * authored labels the study configured are keyed the way the dashboard view
 * names a result, so both spellings are tried before falling back to the
 * derived vocabulary. Nothing is invented: with no authored name the key's own
 * words are used, exactly as the result cards use them.
 */
function metricName(raw: string, labels: Record<string, string>): string {
  const authored = labels[raw] ?? labels[`csat:${raw}`] ?? labels[`average:${raw}`] ?? null;
  const viewKey = raw === "nps" || raw.startsWith("nps") ? raw : `average:${raw}`;
  return resultName(viewKey, raw, authored);
}

/** Whether the study's configuration singles this raw metric key out. */
function isFeatured(raw: string, featuredKeys: readonly string[]): boolean {
  return featuredKeys.includes(raw)
    || featuredKeys.includes(`csat:${raw}`)
    || featuredKeys.includes(`average:${raw}`);
}

export default function PivotExplorer({
  studyId,
  filters,
  allowlist,
  defaultDimension = null,
  featuredKeys = [],
  labels = {},
}: {
  studyId: string;
  filters: SegmentFilters;
  allowlist: PivotAllowlist;
  /** The characteristic the study leads with, when it has one. */
  defaultDimension?: string | null;
  /** Result keys the study's configuration singles out, for ordering. */
  featuredKeys?: readonly string[];
  /** Display names the study authored, keyed as the dashboard view names them. */
  labels?: Record<string, string>;
}) {
  const named = useMemo(
    () => allowlist.metrics
      .map((raw) => ({ raw, name: metricName(raw, labels), featured: isFeatured(raw, featuredKeys) }))
      .sort((a, b) => Number(b.featured) - Number(a.featured) || a.name.localeCompare(b.name, "es")),
    [allowlist.metrics, featuredKeys, labels],
  );
  const featuredMetrics = named.filter((item) => item.featured);
  const otherMetrics = named.filter((item) => !item.featured);

  const [rowDim, setRowDim] = useState(
    defaultDimension && allowlist.dimensions.includes(defaultDimension)
      ? defaultDimension
      : allowlist.dimensions[0] ?? "",
  );
  const [colDim, setColDim] = useState(NONE);
  const [metric, setMetric] = useState(named[0]?.raw ?? allowlist.metrics[0] ?? "");
  const [agg, setAgg] = useState<AggKind>("avg");
  const [result, setResult] = useState<SafePivotResult | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [revision, setRevision] = useState(0);
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
  }, [filters, intent, revision, studyId, validation]);

  const visibleResult = validation.ok ? result : null;
  const visibleErrors = validation.ok ? errors : validation.errors;
  const measure = visibleResult?.measures[0];
  const hasColumns = intent.columns.length > 0;

  // ONE count, for the whole active comparison. Every cell the disclosure rule
  // withheld is counted here and named once below the grid, instead of each row
  // repeating the same sentence until it stops being read.
  const cellStates = useMemo(() => {
    if (!visibleResult || !measure) return { shown: 0, hidden: 0 };
    const columns = hasColumns ? visibleResult.colCombos.map((column) => column.key) : [""];
    let shown = 0;
    let hidden = 0;
    for (const row of visibleResult.body) {
      for (const column of columns) {
        const key = `${column}|${measure.id}`;
        if (row.suppressed[key]) hidden += 1;
        else if (row.cells[key] != null) shown += 1;
      }
    }
    return { shown, hidden };
  }, [hasColumns, measure, visibleResult]);
  const nothingEligible = Boolean(visibleResult && measure) && cellStates.shown === 0;
  const suppressedCopy = sampleCopy("suppressed", null);
  // The server names a measure "Promedio · csat_rendicion_de_cuentas_1_a_1".
  // That is the canonical identity and it stays exactly as it is on the wire;
  // the column heading a reader sees is the same measure in the same words the
  // result cards use.
  const measureLabel = `${AGG_LABEL[agg]} · ${metricName(metric, labels)}`;

  const barRows = visibleResult && !hasColumns && measure ? visibleResult.body.map((row) => ({ label: row.rowLabels[0] || "Sin dato", value: row.cells[`|${measure.id}`] ?? null, hidden: row.suppressed[`|${measure.id}`] })).filter((row) => row.value != null && !row.hidden) : [];
  const maxBar = barRows.reduce((max, row) => Math.max(max, row.value ?? 0), 0) || 1;

  return <section className="rounded-xl border border-line bg-surface p-4 sm:p-5" aria-labelledby="comparison-title">
    <span className="sr-only">Explorador de cruces</span>
    <div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0"><h4 id="comparison-title" className="text-xl">Comparar por segmento</h4><p className="mt-1 max-w-2xl text-sm text-muted">Elige un resultado y cómo separar a las personas. Verás sólo esa comparación, siempre con datos agrupados y nunca respuestas individuales.</p></div><span aria-live="polite" className="text-xs text-evidence">{pending ? "Preparando la comparación..." : ""}</span></div>
    <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <label className="flex flex-col gap-1 text-xs text-muted"><span className="sr-only">Filas</span><span>Primero separa por</span><select aria-label="Filas" value={rowDim} onChange={(event) => setRowDim(event.target.value)} className="min-h-11 rounded-lg border border-line bg-surface px-3 py-2 text-sm text-strong">{allowlist.dimensions.map((dimension) => <option key={dimension} value={dimension}>{characteristicLabel(dimension)}</option>)}</select></label>
      <label className="flex flex-col gap-1 text-xs text-muted"><span className="sr-only">Columnas</span><span>Y, si quieres, también por</span><select aria-label="Columnas" value={colDim} onChange={(event) => setColDim(event.target.value)} className="min-h-11 rounded-lg border border-line bg-surface px-3 py-2 text-sm text-strong"><option value={NONE}>Sin segunda separación</option>{allowlist.dimensions.filter((dimension) => dimension !== rowDim).map((dimension) => <option key={dimension} value={dimension}>{characteristicLabel(dimension)}</option>)}</select></label>
      <label className="flex flex-col gap-1 text-xs text-muted"><span className="sr-only">Métrica</span><span>Resultado que quieres mirar</span><select aria-label="Métrica" value={metric} onChange={(event) => setMetric(event.target.value)} className="min-h-11 rounded-lg border border-line bg-surface px-3 py-2 text-sm text-strong">
        {featuredMetrics.length && otherMetrics.length ? <>
          <optgroup label="Los que sigue el estudio">{featuredMetrics.map((item) => <option key={item.raw} value={item.raw}>{item.name}</option>)}</optgroup>
          <optgroup label="Todos los demás">{otherMetrics.map((item) => <option key={item.raw} value={item.raw}>{item.name}</option>)}</optgroup>
        </> : named.map((item) => <option key={item.raw} value={item.raw}>{item.name}</option>)}
      </select></label>
      <label className="flex flex-col gap-1 text-xs text-muted"><span className="sr-only">Agregación</span><span>Cómo resumirlo</span><select aria-label="Agregación" value={agg} onChange={(event) => setAgg(event.target.value as AggKind)} className="min-h-11 rounded-lg border border-line bg-surface px-3 py-2 text-sm text-strong">{AGG_KINDS.map((item) => <option key={item} value={item}>{AGG_LABEL[item]}</option>)}</select></label>
    </div>
    {visibleErrors.length ? <div className="mt-4"><StateBlock tone="danger" title="No pudimos preparar esta comparación" action={<button type="button" onClick={() => setRevision((value) => value + 1)} className="min-h-11 rounded-lg border border-danger-line bg-surface px-4 py-2 text-sm font-semibold text-danger">Intentar de nuevo</button>}><p>{visibleErrors.join(" ")}</p></StateBlock></div> : null}
    {nothingEligible ? <div className="mt-5"><StateBlock tone="caution" title={suppressedCopy.headline}><p>Ningún grupo de esta comparación llega al mínimo de respuestas. {suppressedCopy.detail}</p></StateBlock></div> : null}
    {visibleResult && measure && !nothingEligible ? <div className="mt-5 overflow-x-auto rounded-lg border border-line"><table className="w-full text-sm"><thead><tr className="bg-surface-sunken text-left text-xs text-muted"><th className="px-3 py-2 font-medium">{characteristicLabel(rowDim)}</th>{hasColumns ? visibleResult.colCombos.map((column) => <th key={column.key} className="px-3 py-2 text-right font-medium">{labelize(column.labels[0] || "Sin dato")}</th>) : <th className="px-3 py-2 text-right font-medium">{measureLabel}</th>}</tr></thead><tbody>{visibleResult.body.map((row, index) => <tr key={index} className="border-t border-line"><td className="px-3 py-2 text-muted">{row.rowLabels[0] || "Sin dato"}</td>{(hasColumns ? visibleResult.colCombos : [{ key: "" }]).map((column) => { const key = `${column.key}|${measure.id}`; return <td key={key} className="px-3 py-2 text-right font-medium text-strong">{row.suppressed[key] ? <><span aria-hidden="true">—</span><span className="sr-only">Oculto para proteger la privacidad</span></> : formatScore(row.cells[key] ?? null)}</td>; })}</tr>)}</tbody></table></div> : null}
    {!nothingEligible && cellStates.hidden > 0 ? <p className="mt-2 text-sm text-caution">{cellStates.hidden === 1 ? "Se ocultó 1 grupo porque no alcanza el mínimo necesario para proteger la privacidad." : `Se ocultaron ${cellStates.hidden} grupos porque no alcanzan el mínimo necesario para proteger la privacidad.`}</p> : null}
    {barRows.length && measure ? <div className="mt-5" aria-label={`Comparación visual de ${measureLabel}`}><p className="mb-2 text-xs font-medium text-muted">{measureLabel}</p><div className="flex flex-col gap-2">{barRows.map((row) => <div key={row.label} className="grid grid-cols-[6rem_1fr] items-center gap-2"><span className="truncate text-xs text-muted">{row.label}</span><div className="h-7 rounded bg-surface-sunken"><div className="flex h-7 items-center justify-end rounded bg-evidence px-2 text-xs font-semibold text-white" style={{ width: `${Math.max(10, ((row.value ?? 0) / maxBar) * 100)}%` }}>{formatScore(row.value)}</div></div></div>)}</div></div> : null}
  </section>;
}
