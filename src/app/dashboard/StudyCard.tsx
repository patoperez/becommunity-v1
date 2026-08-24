"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import type { SegmentFilters } from "@/lib/calc/filters";
import type { SafeMetric, StudyDashboardPayload } from "@/lib/dashboard/view";
import PivotExplorer from "./PivotExplorer";
import JourneyMap from "./JourneyMap";
import QualitativeInsights from "./QualitativeInsights";
import { refreshStudyDashboard } from "./data-actions";
import { MethodDisclosure, SampleContext } from "@/components/SampleContext";
import { StateBlock } from "@/components/States";
import {
  characteristicLabel,
  comparisonQuestion,
  humanize,
  resultLanguage,
  studyStateLabel,
} from "@/lib/language/results";
import { sampleCopy } from "@/lib/language/sample";

type Study = { id: string; name: string; period: string | null; status: string };

/**
 * One study, in a deliberate reading order: what it rests on, then the
 * recorrido, then what people said, then the results, then the comparisons.
 *
 * FROZEN MECHANISM — DO NOT CHANGE WITHOUT CHANGING THE HARNESS.
 * The filter block below keeps two strings exactly as they were:
 *   - each `<select>` keeps `aria-label="Filtrar por <dimensión>"`;
 *   - the live region keeps "<n> de <n> unidades de respuesta" /
 *     "Muestra insuficiente ..." / "Actualizando resultados agregados...".
 * Suite A's scoped-dashboard probe locates the control by that aria-label and
 * parses the unit counts out of that live region, and Suites B and C settle
 * `dashboard.refresh` on it. Retiring this wording is real work — it needs the
 * harness's frozen mechanism updated in the same change — and it belongs to
 * P8-B, not to a presentation pass. Every OTHER `n=` on this surface is gone.
 */
function label(value: string) { return value.replace(/_/g, " "); }

function ResultCard({ metric }: { metric: SafeMetric }) {
  const language = resultLanguage(metric.key, metric.title);
  const suppressed = metric.visibility === "suppressed";
  return (
    <div className="flex min-w-0 flex-col rounded-lg border border-line bg-surface px-4 py-3.5">
      <p className="text-sm font-medium text-muted">{language.name}</p>
      <p className="tabular mt-1 font-display text-2xl font-semibold text-strong">
        {suppressed ? "—" : metric.value ?? "—"}
      </p>
      {suppressed ? (
        <p className="mt-1 text-xs text-caution">
          {sampleCopy("suppressed", null).headline}
        </p>
      ) : (
        <MethodDisclosure summary="Cómo se calcula">
          <p>{language.method}</p>
          {metric.detail ? (
            <p className="mt-1.5">
              <span className="font-semibold text-strong">Detalle técnico:</span>{" "}
              <span className="tabular">{metric.detail}</span>
            </p>
          ) : null}
        </MethodDisclosure>
      )}
    </div>
  );
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

  const showQualitative =
    view.selectionVisibility !== "suppressed" && !view.emptySelection;

  return (
    <section
      id={`study-${study.id}`}
      aria-labelledby={`study-${study.id}-titulo`}
      className="scroll-mt-6 min-w-0 rounded-2xl border border-line bg-surface-page p-5 sm:p-6"
    >
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
        <div className="min-w-0">
          <h3 id={`study-${study.id}-titulo`} className="break-words text-2xl">
            {study.name}
          </h3>
          <p className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-sm text-muted">
            {study.period ? <span className="break-words">{study.period}</span> : null}
            <span className="rounded-full border border-line bg-surface px-2 py-0.5 text-xs font-medium text-muted">
              {studyStateLabel(study.status)}
            </span>
          </p>
        </div>
        {dashboard.sections.report && !view.emptyStudy ? (
          <a
            href={reportHref}
            className="inline-flex min-h-11 items-center rounded-lg border border-line-strong bg-surface px-3.5 py-2 text-sm font-semibold text-strong hover:bg-surface-sunken"
          >
            Descargar el informe
            {activeFilterCount > 0 ? (
              <span className="ml-1.5 text-xs font-normal text-muted">
                (con lo que estás viendo)
              </span>
            ) : null}
          </a>
        ) : null}
      </div>

      {view.emptyStudy ? (
        <div className="mt-5">
          <StateBlock title="Este estudio todavía no tiene datos">
            <p>
              El equipo de Be Community aún no ha cargado las respuestas. Cuando
              lo haga, verás aquí los resultados y el recorrido completo.
            </p>
          </StateBlock>
        </div>
      ) : (
        <div className="mt-5 flex flex-col gap-6">
          {/* What this study rests on, before anything is read from it. */}
          <SampleContext
            visibility={view.selectionVisibility}
            count={view.selectedUnits}
            unit="voices"
            detail
          />

          {/* --- FROZEN MECHANISM (see the file header) --------------------- */}
          {dashboard.filterOptions.length ? (
            <div className="rounded-xl border border-line bg-surface p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h4 className="text-base font-semibold text-strong">Ver sólo…</h4>
                  <p aria-live="polite" className="mt-0.5 text-xs text-muted">
                    {pending
                      ? "Actualizando resultados agregados..."
                      : view.selectionVisibility === "suppressed"
                        ? "Muestra insuficiente · se ocultaron los resultados de esta selección"
                        : `${view.selectedUnits} de ${view.sourceUnits} unidades de respuesta`}
                  </p>
                </div>
                {activeFilterCount ? (
                  <button
                    type="button"
                    onClick={() => applyFilters({})}
                    className="min-h-11 rounded-lg border border-line-strong bg-surface px-3 py-1.5 text-sm font-medium text-strong hover:bg-surface-sunken"
                  >
                    Quitar {activeFilterCount === 1 ? "el filtro" : `los ${activeFilterCount} filtros`}
                  </button>
                ) : null}
              </div>
              <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {dashboard.filterOptions.map((option) => (
                  <label key={option.key} className="flex flex-col gap-1 text-sm font-medium text-strong">
                    {characteristicLabel(option.key)}
                    <select
                      aria-label={`Filtrar por ${label(option.key)}`}
                      value={filters[option.key] ?? ""}
                      onChange={(event) => applyFilters({ ...filters, [option.key]: event.target.value })}
                      className="min-h-11 rounded-lg border border-line-strong bg-surface px-3 py-2 text-sm text-strong"
                    >
                      <option value="">Todas las personas</option>
                      {option.values.map((value) => (
                        <option key={value} value={value}>{value}</option>
                      ))}
                    </select>
                  </label>
                ))}
              </div>
            </div>
          ) : null}
          {/* --- end frozen mechanism -------------------------------------- */}

          {error ? (
            <StateBlock
              tone="danger"
              title="No pudimos recalcular con esa selección"
              action={
                <button
                  type="button"
                  onClick={() => applyFilters(filters)}
                  className="min-h-11 rounded-lg border border-danger-line bg-surface px-3.5 py-2 text-sm font-semibold text-danger"
                >
                  Reintentar
                </button>
              }
            >
              <p>
                Los resultados que ves siguen siendo los últimos correctos.
                Puedes reintentar, o quitar los filtros y empezar de nuevo.
              </p>
            </StateBlock>
          ) : null}

          {view.emptySelection ? (
            <StateBlock
              tone="caution"
              title="Nadie coincide con esa combinación"
              action={
                <button
                  type="button"
                  onClick={() => applyFilters({})}
                  className="min-h-11 rounded-lg border border-caution-line bg-surface px-3.5 py-2 text-sm font-semibold text-caution"
                >
                  Ver a todas las personas
                </button>
              }
            >
              <p>Prueba con menos filtros o con otra combinación.</p>
            </StateBlock>
          ) : null}

          {view.selectionVisibility === "suppressed" ? (
            <StateBlock
              tone="caution"
              title={sampleCopy("suppressed", null).headline}
              action={
                <button
                  type="button"
                  onClick={() => applyFilters({})}
                  className="min-h-11 rounded-lg border border-caution-line bg-surface px-3.5 py-2 text-sm font-semibold text-caution"
                >
                  Ver a todas las personas
                </button>
              }
            >
              <p>{sampleCopy("suppressed", null).detail}</p>
            </StateBlock>
          ) : null}

          {view.journey.length ? <JourneyMap stages={view.journey} /> : null}

          {showQualitative ? (
            <section className="rounded-xl border border-line bg-surface p-5 sm:p-6">
              <QualitativeInsights summary={view.qualitative} />
            </section>
          ) : null}

          {view.tiles.length || view.averages.length ? (
            <section className="rounded-xl border border-line bg-surface p-5 sm:p-6">
              <h4 className="text-xl">Los resultados, uno por uno</h4>
              <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {view.tiles.map((metric) => <ResultCard key={metric.key} metric={metric} />)}
                {view.averages.map((metric) => <ResultCard key={metric.key} metric={metric} />)}
              </div>
            </section>
          ) : null}

          {view.crossSegment && view.crosses.length ? (
            <section className="rounded-xl border border-line bg-surface p-5 sm:p-6">
              <h4 className="text-xl">{comparisonQuestion(view.crossSegment)}</h4>
              <p className="mt-1 text-sm text-muted">
                El mismo resultado, separado por {characteristicLabel(view.crossSegment).toLowerCase()}.
              </p>
              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                {view.crosses.map((cross) => (
                  <div key={cross.metricKey} className="min-w-0 overflow-hidden rounded-lg border border-line">
                    <p className="border-b border-line bg-surface-sunken px-3.5 py-2 text-sm font-semibold text-strong">
                      {humanize(cross.metricKey)}
                    </p>
                    <ul className="divide-y divide-line">
                      {cross.rows.map((row) => (
                        <li key={row.segment} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 px-3.5 py-2.5">
                          <span className="min-w-0 break-words text-sm text-strong">{row.segment}</span>
                          {row.visibility === "suppressed" ? (
                            <span className="text-xs font-medium text-caution">
                              Muy pocas respuestas para mostrarlo
                            </span>
                          ) : (
                            <span className="flex items-baseline gap-2">
                              <span className="tabular text-base font-semibold text-strong">{row.value}</span>
                              <span className="text-xs text-muted">
                                {row.n === 1 ? "1 persona" : `${row.n} personas`}
                              </span>
                            </span>
                          )}
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            </section>
          ) : null}

          {view.canPivot ? (
            <PivotExplorer studyId={study.id} filters={filters} allowlist={dashboard.pivotAllowlist} />
          ) : null}
        </div>
      )}
    </section>
  );
}
