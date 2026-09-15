/**
 * WHAT A CLIENT IS GIVEN WHEN A STUDY HAS A CANONICAL PUBLICATION.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THIS FILE IS PURE, AND IT HAS TO BE.
 *
 * The reading surface is a `"use client"` component, so the shapes it names
 * have to live somewhere a browser bundle may import. Nothing here reads, and
 * nothing here is server-only: it is a vocabulary, and the server-only module
 * that fills it is `src/lib/studies/published-presentation.ts`.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT IS DELIBERATELY ABSENT.
 *
 * No draft revision, no definition, no digest, no binding, no registry build,
 * no package identity, no acknowledgement list, no actor, no note, no event and
 * no publication history. A client is served a finished render model and the
 * date it was published; everything else on the publication row exists so an
 * INTERNAL reviewer can attribute drift, and a reader has no use for any of it.
 *
 * The publication VERSION is absent for a softer reason: the database's own
 * client read exposes it, and a version number is a true, harmless fact — but
 * it is also the first internal-sounding thing that would appear on a client's
 * screen, and nothing on this surface needs it. It stays on the server.
 */

import type { PresentationRenderModel } from "@/lib/presentation";

/**
 * Why a study that HAS an active canonical publication could not be served.
 *
 * A closed vocabulary, and every member is a failure rather than an absence: a
 * study with no publication at all is not in here, because that is the ordinary
 * state of almost every study and is answered by the documented fallback.
 */
export type PublishedReadRefusal =
  /** The pointer, the snapshot or the projection could not be read. */
  | "publication_read_refused"
  /** A row came back that is not a publication this reader can serve. */
  | "publication_malformed";

/**
 * Why a reader's own filter selection was not applied.
 *
 * THE SNAPSHOT IS STILL SERVED IN EVERY ONE OF THESE CASES. A refused selection
 * never becomes a blank page: the reader is shown the complete published study,
 * which is the thing that was approved, and told plainly that their selection
 * was not applied to it.
 */
export type PublishedSelectionRefusal =
  /**
   * RECOMPUTING THE PUBLICATION RIGHT NOW NO LONGER REPRODUCES IT.
   *
   * The study's evidence, the registry build, the editorial content or the
   * resolver moved after the publication was made. The snapshot is unaffected —
   * it is stored — but a FILTERED figure has to be computed, and computing it
   * over different inputs would put a number on the screen that does not belong
   * to the study anybody approved.
   */
  | "study_moved_since_publication"
  /** The selection names a panel, dimension or option this study never offered. */
  | "selection_not_available"
  /** The study's canonical results could not be read at all. */
  | "recomputation_refused";

/** The publication, as a reading surface receives it. */
export type PublishedStudyPayload = {
  /** ISO-8601 UTC, exactly as the database projected it. */
  publishedAt: string;
  /** The immutable published render model, or its recomputation under filters. */
  model: PresentationRenderModel;
  /** Blocks a client sees under this model. Counted on the server. */
  visibleBlockCount: number;
  /**
   * WHETHER THIS PUBLICATION CAN BE RECOMPUTED UNDER A READER'S FILTERS.
   *
   * False means the publication is still served exactly as approved and the
   * filter controls are NOT mounted — a control that would refuse every click
   * is worse than no control, and `clientSeesBlock` already drops a filter
   * panel from a surface whose controls are not live.
   */
  filtersLive: boolean;
};

export type PublishedClientRead =
  | { state: "published"; payload: PublishedStudyPayload }
  /** No active canonical publication. The documented fallback applies. */
  | { state: "not_published" }
  /** There IS one and it could not be served. Never falls back — see the module. */
  | { state: "unreadable"; reason: PublishedReadRefusal };

/** One sentence a reader can act on, per refusal. Never a code, never a key. */
export const PUBLISHED_READ_DETAIL: Record<PublishedReadRefusal, string> = {
  publication_read_refused:
    "No pudimos abrir tu estudio en este momento. No es algo que hayas hecho tú: vuelve a intentarlo en un rato y, si sigue igual, escríbele al equipo de Be Community.",
  publication_malformed:
    "No pudimos abrir tu estudio en este momento. Ya avisamos al equipo de Be Community para que lo revise.",
};

export const PUBLISHED_SELECTION_DETAIL: Record<PublishedSelectionRefusal, string> = {
  study_moved_since_publication:
    "Estás viendo el estudio completo, tal como se publicó. Por ahora no podemos recalcularlo con esa selección porque el estudio cambió después de publicarse.",
  selection_not_available:
    "Estás viendo el estudio completo. Esa selección no existe en este estudio, así que no se aplicó.",
  recomputation_refused:
    "Estás viendo el estudio completo. No pudimos recalcular las cifras con esa selección; vuelve a intentarlo en un momento.",
};

export type PublishedPreviewResult =
  | { ok: true; payload: PublishedStudyPayload }
  | { ok: false; refusal: PublishedSelectionRefusal; detail: string };

/**
 * The filter action, as the reading surface names it.
 *
 * The selection travels as a JSON STRING for the same reason every other
 * viewer action's does: a Server Action's arguments are deserialized before
 * anything validates them, and a string is the one shape that cannot arrive as
 * a half-parsed object.
 */
export type PreviewPublishedUnderSelection = (
  studyId: string,
  viewerJson: string,
) => Promise<PublishedPreviewResult>;
