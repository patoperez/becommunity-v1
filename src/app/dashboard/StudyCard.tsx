"use client";

import { useMemo, useState } from "react";
import { computeStudyMetrics, type LongRow } from "@/lib/calc/engine";
import { buildAllowlist } from "@/lib/calc/pivot";
import type { JourneyStage } from "@/lib/calc/journey";
import {
  buildSegmentFilterOptions,
  filterRowsBySegments,
  type SegmentFilters,
} from "@/lib/calc/filters";
import { formatScore } from "@/lib/calc/format";
import { sampleVisibility } from "@/lib/calc/disclosure";
import PivotExplorer from "./PivotExplorer";
import JourneyMap from "./JourneyMap";

type Study = { id: string; name: string; period: string | null; status: string };

// Single shared policy: values arrive pre-rounded from the calc layer; this
// formats only (docs/CALCULATION_POLICY.md §4).
const fmt = formatScore;

function label(metricKey: string): string {
  return metricKey.replace(/_/g, " ");
}

function Tile({ title, value, sub, n }: { title: string; value: string; sub?: string; n: number }) {
  const visibility = sampleVisibility(n);
  const suppressed = visibility === "suppressed";
  return (
    <div className="rounded-lg border border-zinc-200 bg-zinc-50 px-4 py-3 dark:border-zinc-800 dark:bg-zinc-950">
      <p className="text-xs uppercase tracking-wide text-zinc-500 dark:text-zinc-400">{title}</p>
      <p className="mt-1 text-2xl font-semibold text-zinc-900 dark:text-zinc-50">{suppressed ? "—" : value}</p>
      {suppressed ? <p className="mt-0.5 text-xs text-amber-700 dark:text-amber-300">Muestra insuficiente</p> : sub ? <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">{sub}</p> : null}
    </div>
  );
}

export default function StudyCard({
  study,
  rows,
  journeyStages,
}: {
  study: Study;
  rows: LongRow[];
  journeyStages: JourneyStage[];
}) {
  const filterOptions = useMemo(() => buildSegmentFilterOptions(rows), [rows]);
  const [filters, setFilters] = useState<SegmentFilters>({});
  const filteredRows = useMemo(
    () => filterRowsBySegments(rows, filters, filterOptions),
    [rows, filters, filterOptions],
  );
  const metrics = useMemo(() => computeStudyMetrics(filteredRows), [filteredRows]);
  const allowlist = useMemo(() => buildAllowlist(rows), [rows]);
  const sourceRespondents = useMemo(
    () => new Set(rows.map((row) => row.respondent_id)).size,
    [rows],
  );
  const activeFilterCount = Object.values(filters).filter(Boolean).length;
  const emptyStudy = rows.length === 0;
  const emptySelection = !emptyStudy && filteredRows.length === 0;
  const selectionVisibility = sampleVisibility(metrics.respondents);
  const selectionSuppressed = selectionVisibility === "suppressed";
  const canPivot = filteredRows.length > 0 && allowlist.dimensions.length > 0 && allowlist.metrics.length > 0;
  const hasJourney = journeyStages.length > 0 && filteredRows.length > 0;

  function setFilter(key: string, value: string) {
    setFilters((current) => ({ ...current, [key]: value }));
  }

  function clearFilters() {
    setFilters({});
  }

  return (
    <section className="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-semibold text-zinc-900 dark:text-zinc-50">{study.name}</h3>
          {study.period ? (
            <p className="text-xs text-zinc-500 dark:text-zinc-400">{study.period}</p>
          ) : null}
        </div>
        <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
          {study.status}
        </span>
      </div>

      {emptyStudy ? (
        <p className="mt-4 text-sm text-zinc-500 dark:text-zinc-400">
          Este estudio todavía no tiene datos cargados.
        </p>
      ) : (
        <div className="mt-4 flex flex-col gap-5">
          {filterOptions.length > 0 ? (
            <div className="rounded-xl border border-sky-200 bg-sky-50 p-4 dark:border-sky-900 dark:bg-sky-950/40">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h4 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">Filtros del estudio</h4>
                  <p aria-live="polite" className="mt-0.5 text-xs text-zinc-600 dark:text-zinc-400">
                    {selectionSuppressed
                      ? "Muestra insuficiente · se ocultaron los resultados de esta selección"
                      : `${metrics.respondents} de ${sourceRespondents} encuestados · todas las visualizaciones se recalculan en vivo`}
                  </p>
                </div>
                {activeFilterCount > 0 ? (
                  <button type="button" onClick={clearFilters} className="rounded-lg border border-sky-300 bg-white px-3 py-1.5 text-xs font-medium text-sky-800 hover:bg-sky-100 dark:border-sky-800 dark:bg-zinc-950 dark:text-sky-300">
                    Limpiar {activeFilterCount === 1 ? "filtro" : `${activeFilterCount} filtros`}
                  </button>
                ) : null}
              </div>
              <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {filterOptions.map((option) => (
                  <label key={option.key} className="flex flex-col gap-1 text-xs font-medium text-zinc-700 dark:text-zinc-300">
                    {label(option.key)}
                    <select
                      aria-label={`Filtrar por ${label(option.key)}`}
                      value={filters[option.key] ?? ""}
                      onChange={(event) => setFilter(option.key, event.target.value)}
                      className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-50"
                    >
                      <option value="">Todos</option>
                      {option.values.map((value) => <option key={value} value={value}>{value}</option>)}
                    </select>
                  </label>
                ))}
              </div>
            </div>
          ) : null}

          {emptySelection ? (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">
              No hay respuestas para esta combinación de filtros. Ajusta o limpia la selección.
            </div>
          ) : null}

          {selectionVisibility === "caution" ? (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">
              Base pequeña (n={metrics.respondents}). Interpreta los resultados con cautela.
            </div>
          ) : null}

          {selectionSuppressed ? (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm font-medium text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">
              Muestra insuficiente. Se requieren al menos cinco encuestados para mostrar resultados segmentados.
            </div>
          ) : null}

          {/* Data-connected journey map (§8), rendered from journey_definition */}
          {!selectionSuppressed && hasJourney ? <JourneyMap stages={journeyStages} rows={filteredRows} /> : null}

          {/* Headline tiles */}
          {!selectionSuppressed && !emptySelection ? <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Tile title="Encuestados" value={String(metrics.respondents)} n={metrics.respondents} />
            {metrics.nps ? (
              <Tile
                title="NPS"
                value={String(metrics.nps.nps)}
                sub={`${metrics.nps.promoters} prom · ${metrics.nps.detractors} detr · n=${metrics.nps.total}`}
                n={metrics.nps.total}
              />
            ) : null}
            {metrics.csat.map((c) => (
              <Tile
                key={c.metric_key}
                title={`CSAT ${label(c.metric_key)}`}
                value={`${c.result.csat}%`}
                sub={`Top-box ≥${c.result.satisfiedMin} · ${c.result.satisfied}/${c.result.total}`}
                n={c.result.total}
              />
            ))}
          </div> : null}

          {/* Averages */}
          {!selectionSuppressed && metrics.averages.length > 0 ? (
            <div>
              <h4 className="text-sm font-medium text-zinc-700 dark:text-zinc-300">Promedios</h4>
              <div className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-4">
                {metrics.averages.map((a) => (
                  <Tile key={a.metric_key} title={label(a.metric_key)} value={fmt(a.average)} sub={`n=${a.n}`} n={a.n} />
                ))}
              </div>
            </div>
          ) : null}

          {/* Cross by segment (§5.2 example) */}
          {!selectionSuppressed && metrics.crossSegment && metrics.crosses.length > 0 ? (
            <div>
              <h4 className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
                Cruce por <span className="font-mono">{metrics.crossSegment}</span>
              </h4>
              <div className="mt-2 grid gap-4 sm:grid-cols-2">
                {metrics.crosses.map((cross) => (
                  <div key={cross.metric_key} className="overflow-hidden rounded-lg border border-zinc-200 dark:border-zinc-800">
                    <div className="bg-zinc-50 px-3 py-1.5 text-xs font-medium text-zinc-600 dark:bg-zinc-950 dark:text-zinc-300">
                      {label(cross.metric_key)} (promedio)
                    </div>
                    <table className="w-full text-sm">
                      <tbody>
                        {cross.rows.map((row) => (
                          <tr key={row.segment} className="border-t border-zinc-100 dark:border-zinc-800">
                            <td className="px-3 py-1.5 text-zinc-700 dark:text-zinc-300">{row.segment}</td>
                            {sampleVisibility(row.n) === "suppressed" ? (
                              <td colSpan={2} className="px-3 py-1.5 text-right text-xs font-medium text-amber-700 dark:text-amber-300">Muestra insuficiente</td>
                            ) : <>
                              <td className="px-3 py-1.5 text-right font-medium text-zinc-900 dark:text-zinc-50">{fmt(row.average)}</td>
                              <td className="px-3 py-1.5 text-right text-xs text-zinc-400">n={row.n}</td>
                            </>}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {/* Interactive dynamic cross-tabulation (§5.3) */}
          {!selectionSuppressed && canPivot ? <PivotExplorer rows={filteredRows} allowlist={allowlist} /> : null}
        </div>
      )}
    </section>
  );
}
