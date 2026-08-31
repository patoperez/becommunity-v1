"use client";

/**
 * THE CLIENT'S OWN SCREEN, rendered from an immutable published revision.
 *
 * IT IS NOT THE BUILDER'S CANVAS AND IT IS NOT THE DRAFT PREVIEW. No handles,
 * no menus, no inspector, no selection, no banner, no link back into Studio,
 * no revision number, no hash, no note, no acknowledgement, no warning, and no
 * sentence about anything that is missing. A client reading this page cannot
 * tell that a review happened, and that is correct: the review is how Be
 * Community decided what to send, not part of what was sent.
 *
 * CONTRACT C11 IS ENFORCED BEFORE ANYTHING IS DRAWN. `visiblePagesForClient`
 * removes every block that would otherwise have produced an internal sentence —
 * "este bloque todavía no apunta a un resultado", "todavía no se calcularon los
 * resultados" — along with the separators and section headings that would have
 * framed the hole they left. What is not published renders as nothing at all.
 * What IS published keeps every caveat it needs: a small base, a suppressed
 * segment and a missing value behind a visible number are analytical honesty
 * and are drawn by `BlockView` exactly as they are internally.
 *
 * THE READER'S CHOICES ARE TRANSIENT. They live in this component's state, they
 * are mirrored into the address bar so a view can be refreshed or shared, and
 * they are never written anywhere. They cannot alter the published definition:
 * the Server Action they go to reads the ACTIVE REVISION itself and returns
 * numbers, so a request cannot describe an arrangement nobody published.
 */

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";

import { BlockView } from "@/components/studio/experience/BlockView";
import { IdentityLayer } from "@/components/studio/experience/ExploreViews";
import type { BuilderEvidence } from "@/lib/experience/builder-workspace";
import type { ClientEvidenceSummary } from "@/lib/experience/client-visibility";
import { visiblePagesForClient } from "@/lib/experience/client-visibility";
import type { BlockDataSet, ViewerSelection } from "@/lib/experience/data";
import type { ExperienceDefinitionV1 } from "@/lib/experience/definition";
import { responsiveSpanClass } from "@/lib/experience/layout";
import type { SemanticRegistry } from "@/lib/experience/registry";
import { viewerSelectionToQuery } from "@/lib/experience/viewer-params";

export type PublishedDataAction = (
  studyId: string,
  selection: unknown,
) => Promise<{ ok: true; data: BlockDataSet } | { ok: false; message: string }>;

export function PublishedExperience({
  studyId,
  definition,
  registry,
  data: initialData,
  evidence,
  summary,
  study,
  initialSelection,
  reportHref,
  refresh,
}: {
  studyId: string;
  definition: ExperienceDefinitionV1;
  registry: SemanticRegistry;
  data: BlockDataSet;
  evidence: BuilderEvidence;
  summary: ClientEvidenceSummary;
  study: { name: string; clientName: string; period: string | null };
  initialSelection: ViewerSelection;
  /** Null when this study has no downloadable report, so nothing is offered. */
  reportHref: string | null;
  refresh: PublishedDataAction;
}) {
  const [selection, setSelection] = useState<ViewerSelection>(initialSelection);
  const [data, setData] = useState<BlockDataSet>(initialData);
  const [problem, setProblem] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const pages = useMemo(
    () => visiblePagesForClient({ definition, data, evidence: summary }),
    [definition, data, summary],
  );
  const [openPageId, setOpenPageId] = useState<string | null>(pages[0]?.page.id ?? null);
  const current = pages.find((entry) => entry.page.id === openPageId) ?? pages[0] ?? null;

  /*
   * ONE EFFECT WATCHES THE SELECTION.
   *
   * The same shape the draft preview settled on, and for the same measured
   * reason: calling the recompute from inside a `setState` updater silently
   * dropped a second choice made while the first was in flight, and made
   * "Limpiar filtros" appear to do nothing. A state updater must be pure.
   */
  const firstRender = useRef(true);
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    const query = viewerSelectionToQuery(selection, definition);
    window.history.replaceState(null, "", `${window.location.pathname}${query}`);

    let live = true;
    startTransition(async () => {
      const result = await refresh(studyId, selection);
      if (!live) return;
      if (result.ok) {
        setData(result.data);
        setProblem(null);
      } else {
        // A failed recomputation leaves the last good numbers on screen. Blanking
        // the page would make a dropped connection look like a study with no data.
        setProblem(result.message);
      }
    });
    return () => {
      live = false;
    };
  }, [selection, definition, refresh, studyId]);

  const onChange = useCallback((filterId: string, values: string[]) => {
    setSelection((currentSelection) => {
      const next = { ...currentSelection };
      if (values.length === 0) delete next[filterId];
      else next[filterId] = values;
      return next;
    });
  }, []);

  const onClear = useCallback((filterIds: string[]) => {
    setSelection((currentSelection) => {
      const next = { ...currentSelection };
      for (const filterId of filterIds) delete next[filterId];
      return next;
    });
  }, []);

  const viewer = useMemo(() => ({ selection, onChange, onClear }), [selection, onChange, onClear]);
  const activeCount = Object.keys(selection).length;

  const onDownload = useMemo(() => {
    if (!reportHref) return null;
    return () => {
      window.location.assign(reportHref);
    };
  }, [reportHref]);

  // Nothing published that this client can see. C11: silence, not an empty
  // state explaining the silence. The route above renders its own "this study
  // has nothing for you yet" only when it has no legacy content either.
  if (!current) return null;

  return (
    <div className="min-w-0 space-y-4">
      <IdentityLayer identity={definition.identity} onDownload={onDownload} />

      {pages.length > 1 ? (
        <nav aria-label="Secciones del estudio" className="min-w-0">
          <ul className="flex min-w-0 flex-wrap gap-2">
            {pages.map((entry) => (
              <li key={entry.page.id}>
                <button
                  type="button"
                  onClick={() => setOpenPageId(entry.page.id)}
                  aria-current={entry.page.id === current.page.id ? "page" : undefined}
                  className={`min-h-11 rounded-lg border px-3 text-sm font-medium ${
                    entry.page.id === current.page.id
                      ? "border-evidence-line bg-evidence-surface text-strong"
                      : "border-line text-body hover:bg-surface-sunken"
                  }`}
                >
                  {entry.page.title}
                </button>
              </li>
            ))}
          </ul>
        </nav>
      ) : null}

      {/*
        The live region exists only where there is something to narrate. A study
        with no viewer filters never renders a sentence about filters, because a
        control the reader does not have is not a fact they need.
      */}
      {definition.filterDefinitions.length > 0 ? (
        <p className="text-xs text-muted" aria-live="polite">
          {pending
            ? "Actualizando los resultados…"
            : activeCount === 0
              ? "Sin filtros: cada resultado considera todas las respuestas."
              : `${activeCount === 1 ? "1 filtro activo" : `${activeCount} filtros activos`}.`}
        </p>
      ) : null}

      {problem ? (
        <p className="rounded-lg border border-caution-line bg-caution-surface px-3 py-2.5 text-sm text-caution">
          {problem} Se están mostrando los últimos resultados que sí se pudieron calcular.
        </p>
      ) : null}

      <section className="min-w-0" aria-label={current.page.title}>
        {current.page.description ? (
          <p className="mb-3 max-w-3xl text-sm text-body">{current.page.description}</p>
        ) : null}
        <ul className="grid min-w-0 grid-cols-12 gap-3">
          {current.blocks.map((block) => (
            <li
              key={block.id}
              className={`${responsiveSpanClass(block.layout.desktop.span)} min-w-0`}
            >
              <BlockView
                block={block}
                definition={definition}
                registry={registry}
                data={data}
                evidence={evidence}
                study={study}
                viewer={viewer}
              />
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
