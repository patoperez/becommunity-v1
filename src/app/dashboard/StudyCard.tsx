"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import type { SegmentFilters } from "@/lib/calc/filters";
import type { SafeMetric, StudyDashboardPayload } from "@/lib/dashboard/view";
import { buildResultInventory } from "@/lib/dashboard/results";
import PivotExplorer from "./PivotExplorer";
import JourneyMap from "./JourneyMap";
import QualitativeInsights, { hasPublishableQualitative } from "./QualitativeInsights";
import { refreshStudyDashboard } from "./data-actions";
import { MethodDisclosure, SampleContext } from "@/components/SampleContext";
import { StateBlock } from "@/components/States";
import {
  characteristicLabel,
  hasAuthoredName,
  resultLanguage,
  resultName,
  studyStateLabel,
} from "@/lib/language/results";
import { sampleCopy } from "@/lib/language/sample";
import type { Audience } from "@/lib/dashboard/audience";
import { filterQuery } from "@/lib/insights/filters";

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

function ResultCard({ metric, authored }: { metric: SafeMetric; authored?: string | null }) {
  const language = resultLanguage(metric.key, metric.title);
  const suppressed = metric.visibility === "suppressed";
  return (
    <div className="flex min-w-0 flex-col rounded-lg border border-line bg-surface px-4 py-3.5">
      <p className="text-sm font-medium text-muted">{resultName(metric.key, metric.title, authored)}</p>
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

/**
 * THE COMPLETE RESULT INVENTORY — reference material, not the page.
 *
 * A real instrument produces more numbers than a reading. Rendered open, one
 * card each, the Cuicuilco study's 123 results were the first thing a client
 * saw and they buried the recorrido, the retention series and the consultant's
 * own interpretation under several screens of scroll.
 *
 * Nothing is withheld by closing it: every result the study produced is in
 * here, in the order the view built them, with the values and the disclosure
 * decisions already applied upstream. The summary carries the count, so the
 * decision to open it is made with the size known.
 *
 * SUPPRESSION IS SUMMARISED ONCE. Repeating "muy pocas respuestas" on row after
 * row taught a reader nothing and made the sentence invisible; the count is
 * stated at the top and each withheld value is an em dash with an accessible
 * name of its own.
 */
function AllResults({
  items,
  labels,
  suppressed,
  audience,
}: {
  items: SafeMetric[];
  labels: Record<string, string>;
  suppressed: number;
  audience: Audience;
}) {
  const [query, setQuery] = useState("");
  const needle = query.trim().toLowerCase();
  const named = useMemo(
    () => items.map((metric) => ({
      metric,
      name: resultName(metric.key, metric.title, labels[metric.key]),
      authored: hasAuthoredName(metric.key, labels[metric.key]),
    })),
    [items, labels],
  );
  const visible = needle
    ? named.filter((item) => item.name.toLowerCase().includes(needle))
    : named;
  // Internal only. What Be Community has not finished naming is its own work,
  // never a note on the client's screen (contract C11).
  const unnamed = audience === "preview" ? named.filter((item) => !item.authored).length : 0;

  return (
    <details className="mt-5 rounded-xl border border-line bg-surface-sunken/50">
      <summary className="flex min-h-11 cursor-pointer list-none flex-wrap items-center gap-x-2 gap-y-1 px-4 py-3 text-sm font-semibold text-strong">
        <span aria-hidden="true" className="inline-block transition-transform duration-[var(--motion-state)]">
          ›
        </span>
        Explorar todos los resultados
        <span className="font-normal text-muted">
          ({items.length === 1 ? "1 resultado" : `${items.length} resultados`})
        </span>
      </summary>
      <div className="border-t border-line px-4 py-4">
        {suppressed > 0 ? (
          <p className="text-sm text-caution">
            {suppressed === 1
              ? "Se ocultó 1 resultado porque no alcanza el mínimo necesario para proteger la privacidad."
              : `Se ocultaron ${suppressed} resultados porque no alcanzan el mínimo necesario para proteger la privacidad.`}
          </p>
        ) : null}
        {unnamed > 0 ? (
          <p className="mt-2 text-sm text-caution">
            Sólo para el equipo: {unnamed === 1
              ? "1 resultado todavía no tiene un nombre configurado y se muestra con el de la columna importada."
              : `${unnamed} resultados todavía no tienen un nombre configurado y se muestran con el de la columna importada.`}
          </p>
        ) : null}
        <label className="mt-3 flex flex-col gap-1 text-sm font-medium text-strong">
          Buscar un resultado
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Escribe parte del nombre"
            className="min-h-11 w-full min-w-0 rounded-lg border border-line-strong bg-surface px-3 py-2 text-sm font-normal text-strong"
          />
        </label>
        <p aria-live="polite" className="mt-2 text-xs text-muted">
          {visible.length === items.length
            ? `${items.length} resultados`
            : `${visible.length} de ${items.length} resultados`}
        </p>
        {visible.length === 0 ? (
          <p className="mt-3 text-sm text-muted">Ningún resultado se llama así. Prueba con otra palabra.</p>
        ) : (
          <ul className="mt-3 divide-y divide-line rounded-lg border border-line bg-surface">
            {visible.map(({ metric, name }) => (
              <li
                key={metric.key}
                className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 px-3.5 py-2.5"
              >
                <span className="min-w-0 break-words text-sm text-strong">{name}</span>
                {metric.visibility === "suppressed" ? (
                  <span className="text-base text-muted">
                    <span aria-hidden="true">—</span>
                    <span className="sr-only">Oculto para proteger la privacidad</span>
                  </span>
                ) : (
                  <span className="tabular text-base font-semibold text-strong">{metric.value ?? "—"}</span>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </details>
  );
}

export default function StudyCard({
  study,
  initialDashboard,
  initialFilters = {},
  syncFiltersToUrl = false,
  audience = "client",
}: {
  study: Study;
  initialDashboard: StudyDashboardPayload;
  /** The validated selection loaded from the URL on a study route. */
  initialFilters?: SegmentFilters;
  /** Keep the study URL and its PDF link on one canonical filter source. */
  syncFiltersToUrl?: boolean;
  /** Presentation only: the internal preview names readiness gaps, the client view never does. */
  audience?: Audience;
}) {
  const [filters, setFilters] = useState<SegmentFilters>(initialFilters);
  const [dashboard, setDashboard] = useState(initialDashboard);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const request = useRef(0);
  const view = dashboard.view;
  const activeFilterCount = Object.values(filters).filter(Boolean).length;
  const reportHref = useMemo(() => {
    const query = filterQuery(filters);
    return `/api/studies/${encodeURIComponent(study.id)}/report${query ? `?${query}` : ""}`;
  }, [filters, study.id]);
  // What leads, and what stays complete behind a disclosure. The split is the
  // study's own configuration (see src/lib/dashboard/results.ts); nothing is
  // dropped and no number is recomputed here.
  const inventory = useMemo(
    () => buildResultInventory([...view.tiles, ...view.averages], view.featuredKeys),
    [view.averages, view.featuredKeys, view.tiles],
  );

  function applyFilters(next: SegmentFilters) {
    setFilters(next);
    setError(null);
    const current = ++request.current;
    startTransition(async () => {
      const response = await refreshStudyDashboard(study.id, next);
      if (current !== request.current) return;
      if (response.ok) {
        setDashboard(response.data);
        if (syncFiltersToUrl) {
          const query = filterQuery(next);
          window.history.replaceState(null, "", query ? `${window.location.pathname}?${query}` : window.location.pathname);
        }
      }
      else setError(response.error);
    });
  }

  // The qualitative SECTION — its border, padding and heading — only exists if
  // there is something published inside it. Rendering the wrapper around a
  // component that returns null left an empty bordered card on the client's
  // page, which is exactly the "something is missing" signal a finished study
  // must never send. The internal preview keeps the wrapper so staff still get
  // the readiness note.
  const qualitativeVisible =
    view.selectionVisibility !== "suppressed" && !view.emptySelection;
  const showQualitative =
    qualitativeVisible &&
    (hasPublishableQualitative(view.qualitative) || audience === "preview");

  return (
    <section
      id={`study-${study.id}`}
      aria-labelledby={`study-${study.id}-titulo`}
      // `scroll-mt-20` clears the sticky internal-preview notice, so an anchor
      // jump from the panorama never lands underneath it.
      className="scroll-mt-20 min-w-0 rounded-2xl border border-line bg-surface-page p-5 sm:p-6"
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
                  <label key={option.key} className="flex min-w-0 flex-col gap-1 text-sm font-medium text-strong">
                    {characteristicLabel(option.key)}
                    <select
                      aria-label={`Filtrar por ${label(option.key)}`}
                      value={filters[option.key] ?? ""}
                      onChange={(event) => applyFilters({ ...filters, [option.key]: event.target.value })}
                      className="min-h-11 w-full min-w-0 rounded-lg border border-line-strong bg-surface px-3 py-2 text-sm text-strong"
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

          {view.journey.length ? <JourneyMap stages={view.journey} audience={audience} /> : null}

          {showQualitative ? (
            <section className="rounded-xl border border-line bg-surface p-5 sm:p-6">
              <QualitativeInsights summary={view.qualitative} audience={audience} />
            </section>
          ) : null}

          {inventory.total > 0 ? (
            <section
              aria-labelledby={`resultados-${study.id}`}
              className="rounded-xl border border-line bg-surface p-5 sm:p-6"
            >
              <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
                <h4 id={`resultados-${study.id}`} className="text-xl">
                  Los resultados de este estudio
                </h4>
                <p className="text-sm text-muted">
                  {inventory.total === 1 ? "1 resultado" : `${inventory.total} resultados`}
                </p>
              </div>
              {inventory.featured.length > 0 ? (
                <>
                  <p className="mt-1 max-w-prose text-sm text-muted">
                    {inventory.needsDisclosure
                      ? "Estos son los que el estudio sigue de cerca. El resto está completo más abajo."
                      : "Uno por uno, tal como los calculó el estudio."}
                  </p>
                  <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    {inventory.featured.map((metric) => (
                      <ResultCard key={metric.key} metric={metric} authored={view.resultLabels[metric.key]} />
                    ))}
                  </div>
                </>
              ) : null}
              {inventory.needsDisclosure ? (
                <AllResults
                  items={inventory.all}
                  labels={view.resultLabels}
                  suppressed={inventory.suppressed}
                  audience={audience}
                />
              ) : null}
            </section>
          ) : null}

          {view.canPivot ? (
            <PivotExplorer
              studyId={study.id}
              filters={filters}
              allowlist={dashboard.pivotAllowlist}
              defaultDimension={view.comparisonDimension}
              featuredKeys={view.featuredKeys}
              labels={view.resultLabels}
            />
          ) : null}
        </div>
      )}
    </section>
  );
}
