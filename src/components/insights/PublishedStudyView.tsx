"use client";

/**
 * THE CLIENT'S PUBLISHED STUDY — the canonical experience, on the client's own
 * address, drawn by the same renderer the internal review approves.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * IT IS THE SAME COMPONENT, AND THAT IS THE ENTIRE POINT.
 *
 * `PresentationRenderer` with `audience="client"` is what
 * `PublicationReviewView` mounts inside «Lo que vería el cliente». If this
 * surface drew the model any other way, «revisé la vista del cliente» would be
 * a statement about a screen no client is served — which is the one failure the
 * review exists to prevent. There is no second renderer, no second layout and
 * no second vocabulary here: this file supplies a shell, a filter session and a
 * sentence, and hands the model straight through.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * IT COMPUTES NOTHING.
 *
 * No aggregation, no deduplication, no classification, no phrase counting, no
 * threshold and no rounding. Every number and every phrase arrives finished
 * inside the render model, computed where the study's data is. Contract C1.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * NOTHING INTERNAL REACHES IT.
 *
 * Its props are a study id, a finished render model, a date, a count and one
 * action. There is no draft revision here, no publication version, no digest,
 * no binding, no package identity, no tenant, no editor, no acknowledgement and
 * no history — the payload type has nowhere to put any of them.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHEN THE FILTERS ARE NOT LIVE, THEY ARE NOT DRAWN.
 *
 * `filtersLive` is false when the server could not reproduce the publication
 * from today's data — the study was re-imported, an approved phrase changed, or
 * the resolver moved. The publication is still served exactly as approved; what
 * is withheld is the ability to recompute it. The renderer is then mounted with
 * NO viewer object, and `clientSeesBlock` drops the filter panels rather than
 * showing controls that would refuse every click.
 */

import { useCallback, useEffect, useRef, useState } from "react";

import { PresentationRenderer } from "@/components/presentation/PresentationRenderer";
import type { ViewerControls } from "@/components/presentation/viewer";
import {
  acceptViewerResponse,
  openViewerSession,
  requestViewerCleared,
  requestViewerOption,
  requestViewerPanelCleared,
  type ViewerSession,
} from "@/lib/composer";
import { viewerSelectionIsNeutral } from "@/lib/presentation";
import type { PresentationRenderModel } from "@/lib/presentation";
import type {
  PreviewPublishedUnderSelection,
  PublishedStudyPayload,
} from "@/lib/publication";

/** The publication date, in the words a reader uses rather than as a stamp. */
function publishedOn(iso: string): string | null {
  const when = new Date(iso);
  if (Number.isNaN(when.getTime())) return null;
  return new Intl.DateTimeFormat("es-MX", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(when);
}

export function PublishedStudyView({
  studyId,
  studyName,
  payload,
  preview,
}: {
  studyId: string;
  studyName: string;
  payload: PublishedStudyPayload;
  preview: PreviewPublishedUnderSelection;
}) {
  const [session, setSession] = useState<ViewerSession>(openViewerSession);
  /**
   * The LIVE session, for the callbacks.
   *
   * A callback closes over the session of the render that created it, so two
   * quick clicks would each start from the same «before» state and one choice
   * would be lost. Written in an effect rather than during render: mutating a
   * ref while rendering is what makes a component fail to update.
   */
  const sessionRef = useRef(session);
  useEffect(() => {
    sessionRef.current = session;
  }, [session]);

  const [shown, setShown] = useState<{ model: PresentationRenderModel; visible: number }>({
    model: payload.model,
    visible: payload.visibleBlockCount,
  });
  /**
   * The newest request wins, and an older answer is DROPPED rather than drawn.
   * A model resolved under an older selection, beneath a newer set of ticked
   * boxes, is the one state a reader could not see was wrong.
   */
  const inFlight = useRef(0);

  const runViewer = useCallback(
    async (next: { session: ViewerSession; request: number | null }) => {
      setSession(next.session);
      if (next.request === null) return;
      const request = next.request;
      const ticket = (inFlight.current += 1);
      try {
        const result = await preview(studyId, JSON.stringify(next.session.pending));
        if (ticket !== inFlight.current) return;
        if (result.ok) {
          setShown({ model: result.payload.model, visible: result.payload.visibleBlockCount });
          setSession((live) => acceptViewerResponse(live, request, { ok: true }));
        } else {
          setSession((live) =>
            acceptViewerResponse(live, request, { ok: false, message: result.detail }),
          );
        }
      } catch {
        if (ticket !== inFlight.current) return;
        setSession((live) =>
          acceptViewerResponse(live, request, {
            ok: false,
            message:
              "No se pudieron aplicar los filtros. Sigues viendo las cifras con la selección anterior.",
          }),
        );
      }
    },
    [preview, studyId],
  );

  const viewer: ViewerControls = {
    pending: session.pending,
    status: session.status,
    message: session.message,
    onToggle: (panelId, handle, token, on) =>
      void runViewer(requestViewerOption(sessionRef.current, panelId, handle, token, on)),
    onClearPanel: (panelId) =>
      void runViewer(requestViewerPanelCleared(sessionRef.current, panelId)),
  };
  const filtered = !viewerSelectionIsNeutral(session.applied);
  const when = publishedOn(payload.publishedAt);

  return (
    <section data-testid="estudio-publicado" data-visible-blocks={shown.visible}>
      <h1 className="sr-only">{studyName}</h1>
      {when ? (
        <p className="mb-4 text-xs text-muted" data-testid="publicado-el">
          Publicado el {when}.
        </p>
      ) : null}

      {filtered ? (
        <div
          className="mb-4 flex flex-wrap items-center gap-3 rounded-lg border border-line bg-surface-sunken px-4 py-3"
          data-testid="seleccion-activa"
        >
          <p className="text-sm text-muted">
            Estás viendo una selección, no el estudio completo.
          </p>
          <button
            type="button"
            className="ml-auto inline-flex min-h-11 items-center rounded-lg border border-line-strong bg-surface px-4 py-2.5 text-sm font-semibold text-strong hover:bg-surface-sunken"
            disabled={session.status === "loading"}
            onClick={() => void runViewer(requestViewerCleared(sessionRef.current))}
            data-testid="ver-estudio-completo"
          >
            Ver el estudio completo
          </button>
        </div>
      ) : null}

      {/* THE SAME RENDERER, THE SAME AUDIENCE. The viewer object is withheld —
          not faked — when the server said this publication cannot be recomputed,
          and the filter panels go with it.

          `presentacion-canonica` is the SAME hook the internal review puts
          around its own preview, and it is there so the two can be compared as
          text rather than by eye: «revisé la vista del cliente» is a claim about
          this exact subtree, and a QA that compared whole pages would compare
          the review's own chrome as well and could never agree. */}
      <div data-testid="presentacion-canonica">
        <PresentationRenderer
          model={shown.model}
          audience="client"
          viewer={payload.filtersLive ? viewer : undefined}
        />
      </div>
    </section>
  );
}
