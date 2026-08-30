"use client";

/**
 * VISTA PREVIA DEL BORRADOR — the composed draft, with the study's real
 * numbers, for internal eyes only.
 *
 * IT IS NOT THE BUILDER'S CANVAS. No handles, no menus, no inspector, no
 * selection. It draws the identity layer once and then the pages, exactly as
 * the arrangement says — so what the consultant judges here is the shape of
 * the work rather than the shape of the tool.
 *
 * IT IS NOT THE CLIENT'S PAGE EITHER, and it says so in a banner that cannot
 * be missed. Nothing on this screen has been published; the client is still
 * being served whatever they were being served before.
 *
 * THE READER'S CHOICES ARE TRANSIENT. They live in this component's state,
 * they are mirrored into the address bar so the view can be refreshed or
 * shared with a colleague, and they are never written anywhere. Recomputation
 * goes to one Server Action that reads the saved draft itself and returns
 * numbers.
 */

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";

import { primaryAction, secondaryAction } from "@/components/Actions";
import { BlockView } from "@/components/studio/experience/BlockView";
import { IdentityLayer } from "@/components/studio/experience/ExploreViews";
import type { BuilderEvidence } from "@/lib/experience/builder-workspace";
import type { BlockDataSet, ViewerSelection } from "@/lib/experience/data";
import type { ExperienceDefinitionV1 } from "@/lib/experience/definition";
import { responsiveSpanClass } from "@/lib/experience/layout";
import type { SemanticRegistry } from "@/lib/experience/registry";
import { viewerSelectionToQuery } from "@/lib/experience/viewer-params";

export type PreviewDataAction = (
  studyId: string,
  selection: unknown,
) => Promise<{ ok: true; data: BlockDataSet } | { ok: false; message: string }>;

export function DraftPreview({
  studyId,
  definition,
  registry,
  evidence,
  study,
  initialData,
  initialSelection,
  builderHref,
  publishedHref,
  savedAt,
  hasDraft,
  refresh,
}: {
  studyId: string;
  definition: ExperienceDefinitionV1;
  registry: SemanticRegistry;
  evidence: BuilderEvidence;
  study: { name: string; clientName: string; period: string | null };
  initialData: BlockDataSet;
  initialSelection: ViewerSelection;
  builderHref: string;
  publishedHref: string;
  savedAt: string | null;
  hasDraft: boolean;
  refresh: PreviewDataAction;
}) {
  const [selection, setSelection] = useState<ViewerSelection>(initialSelection);
  const [data, setData] = useState<BlockDataSet>(initialData);
  const [problem, setProblem] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [openPageId, setOpenPageId] = useState<string | null>(
    definition.pages.find((page) => page.visible)?.id ?? definition.pages[0]?.id ?? null,
  );

  const visiblePages = useMemo(
    () => definition.pages.filter((page) => page.visible).sort((a, b) => a.order - b.order),
    [definition],
  );
  const page = visiblePages.find((candidate) => candidate.id === openPageId) ?? visiblePages[0] ?? null;

  /*
   * ONE EFFECT WATCHES THE SELECTION, AND IT IS THE ONLY THING THAT REACTS TO
   * IT.
   *
   * The first version called the recompute from inside the `setSelection`
   * updater, which looked tidy and was wrong: a state updater must be pure,
   * React is free to run it more than once, and a `setState` reached from
   * inside one is not supported. In practice a second choice made while the
   * first was still recomputing was silently dropped, and "Limpiar filtros"
   * did nothing at all — both of which a person would read as the filters
   * being broken rather than as a race.
   *
   * The handlers now do one thing: change the selection. Everything that
   * follows from a selection — the address bar and the numbers — happens here,
   * once, after it has actually changed.
   */
  const firstRender = useRef(true);
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }

    // The address bar follows the choices, so this view can be refreshed and
    // pasted to a colleague. `replaceState` rather than a router navigation:
    // re-running the route on every use of a select is the expensive
    // re-render this milestone exists to stop doing.
    const query = viewerSelectionToQuery(selection, definition);
    window.history.replaceState(null, "", `${window.location.pathname}${query}`);

    let current = true;
    startTransition(async () => {
      const result = await refresh(studyId, selection);
      if (!current) return;
      if (result.ok) {
        setData(result.data);
        setProblem(null);
      } else {
        // A failed recomputation leaves the last good numbers on screen and
        // says so. Blanking the page would make a transient network problem
        // look like a study with no data.
        setProblem(result.message);
      }
    });
    return () => {
      // A choice made while an earlier one is still in flight wins: the older
      // answer is for a selection nobody is looking at any more.
      current = false;
    };
  }, [selection, definition, refresh, studyId]);

  const onChange = useCallback((filterId: string, values: string[]) => {
    setSelection((current) => {
      const next = { ...current };
      if (values.length === 0) delete next[filterId];
      else next[filterId] = values;
      return next;
    });
  }, []);

  const onClear = useCallback((filterIds: string[]) => {
    setSelection((current) => {
      const next = { ...current };
      for (const filterId of filterIds) delete next[filterId];
      return next;
    });
  }, []);

  const viewer = useMemo(() => ({ selection, onChange, onClear }), [selection, onChange, onClear]);
  const activeCount = Object.keys(selection).length;

  return (
    <div className="min-w-0 space-y-4">
      {/*
        THE BANNER. It is the first thing on the page, it names what this is,
        and it says plainly that the client does not see any of it. An internal
        preview that could be mistaken for the client's own screen is worse
        than no preview at all.
      */}
      <div className="rounded-lg border border-caution-line bg-caution-surface px-3 py-3 text-sm text-caution">
        <p className="font-medium">
          Vista previa interna del borrador; el cliente todavía no ve estos cambios.
        </p>
        <p className="mt-1">
          {hasDraft
            ? `Estás viendo lo último que se guardó en Construcción${savedAt ? ` (${savedAt})` : ""}. Nada de esto está publicado.`
            : "Todavía no hay un borrador guardado, así que se muestra la configuración actual del estudio. Nada de esto está publicado."}
        </p>
        <div className="mt-2 flex flex-wrap gap-2">
          <Link href={builderHref} className={primaryAction}>
            Volver a Construcción
          </Link>
          <Link href={publishedHref} className={secondaryAction}>
            Ver versión actualmente publicada
          </Link>
        </div>
      </div>

      <IdentityLayer identity={definition.identity} />

      {visiblePages.length > 1 ? (
        <nav aria-label="Páginas de la experiencia" className="min-w-0">
          <ul className="flex min-w-0 flex-wrap gap-2">
            {visiblePages.map((candidate) => (
              <li key={candidate.id}>
                <button
                  type="button"
                  onClick={() => setOpenPageId(candidate.id)}
                  aria-current={candidate.id === page?.id ? "page" : undefined}
                  className={`min-h-11 rounded-lg border px-3 text-sm font-medium ${
                    candidate.id === page?.id
                      ? "border-evidence-line bg-evidence-surface text-strong"
                      : "border-line text-body hover:bg-surface-sunken"
                  }`}
                >
                  {candidate.title}
                </button>
              </li>
            ))}
          </ul>
        </nav>
      ) : null}

      <p className="text-xs text-muted" aria-live="polite">
        {pending
          ? "Actualizando los resultados…"
          : activeCount === 0
            ? "Sin filtros: cada bloque muestra todas las respuestas."
            : `${activeCount === 1 ? "1 filtro activo" : `${activeCount} filtros activos`}. Solo cambian los bloques conectados.`}
      </p>

      {problem ? (
        <p className="rounded-lg border border-danger-line bg-danger-surface px-3 py-2.5 text-sm text-danger">
          {problem} Se están mostrando los últimos resultados que sí se pudieron calcular.
        </p>
      ) : null}

      {page ? (
        <section className="min-w-0" aria-label={page.title}>
          {page.description ? (
            <p className="mb-3 max-w-3xl text-sm text-body">{page.description}</p>
          ) : null}
          <ul className="grid min-w-0 grid-cols-12 gap-3">
            {[...page.blocks]
              .filter((block) => block.visible && block.layout.desktop.visible)
              .sort((a, b) => a.layout.desktop.order - b.layout.desktop.order)
              .map((block) => (
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
      ) : (
        <p className="text-sm text-muted">Esta experiencia todavía no tiene páginas visibles.</p>
      )}
    </div>
  );
}
