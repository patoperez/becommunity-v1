/**
 * THE READING SESSION — what a reader has chosen, what they are actually being
 * shown, and the difference between the two while a request is in the air.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * TWO SELECTIONS, AND KEEPING THEM APART IS THE WHOLE POINT.
 *
 * `applied` is the selection the model on screen was resolved under. `pending`
 * is what the reader has just asked for. While a request is in flight the two
 * differ, and the surface says so; when it lands they are the same again.
 *
 * The alternative — one selection, updated optimistically — produces the single
 * most dishonest state a filtered dashboard can be in: controls that read
 * «Generación: Boomer» above numbers computed for everybody. Every requirement
 * in this unit about honest empty states is worthless if the controls and the
 * figures can disagree for a second and a half.
 *
 * So a FAILED request puts `pending` back to `applied` rather than leaving the
 * reader's choice standing over numbers that do not match it. The choice is
 * lost, which is a small cost, and it is said out loud.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * OUT-OF-ORDER RESPONSES.
 *
 * A reader clicking three checkboxes sends three requests, and the second may
 * come back after the third. `request` is a monotonically increasing counter,
 * every response carries the number it was asked under, and a response whose
 * number is not the current one is DROPPED — `acceptViewerResponse` returns the
 * state it was given, unchanged and reference-identical, so a caller can assert
 * that nothing happened rather than inferring it.
 *
 * The counter is not a clock and not a random id. This module is held to the
 * same purity as the rest of the editor engine: no `Date.now`, no
 * `Math.random`, no storage, no transport. A counter is also the only one of
 * the three that a gate can drive deterministically.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * AND IT IS NOT PART OF THE DOCUMENT.
 *
 * Nothing here touches `ComposerState`, and nothing here can be undone or
 * redone: a reader narrowing a view has not edited the presentation, and an
 * edit history that filled up with dropdown changes would push a real edit out
 * of a sixty-deep undo stack. It is also deliberately not stored anywhere, so a
 * reload returns to «Todas las personas».
 */

import {
  EMPTY_VIEWER_SELECTION,
  clearViewerPanel,
  normalizeViewerSelection,
  toggleViewerOption,
  viewerSelectionIsNeutral,
  type ViewerSelection,
} from "../presentation";

/** What the surface is doing about the reader's last choice. */
export type ViewerSessionStatus = "idle" | "loading" | "error";

export type ViewerSession = {
  /** The selection the model on screen was resolved under. */
  applied: ViewerSelection;
  /** What the reader has asked for. Equal to `applied` when nothing is in flight. */
  pending: ViewerSelection;
  /** The number of the newest request. Zero before anything has been asked. */
  request: number;
  status: ViewerSessionStatus;
  /** A sentence for a person. Never a code, never a payload. */
  message: string | null;
};

export function openViewerSession(): ViewerSession {
  return {
    applied: EMPTY_VIEWER_SELECTION,
    pending: EMPTY_VIEWER_SELECTION,
    request: 0,
    status: "idle",
    message: null,
  };
}

/** True when the reader has changed something that is not on screen yet. */
export function viewerSessionIsSettled(session: ViewerSession): boolean {
  return session.status !== "loading";
}

/** True when nothing at all is constrained — «Todas las personas». */
export function viewerSessionIsNeutral(session: ViewerSession): boolean {
  return viewerSelectionIsNeutral(session.applied) && viewerSelectionIsNeutral(session.pending);
}

/**
 * Ask for a selection.
 *
 * Returns the new session AND the request number to send with it, rather than
 * making the caller read the number back off the state — the two must be the
 * same number, and handing them out together is how they stay the same.
 *
 * A request for the selection ALREADY applied is not a request: it returns the
 * session unchanged, reference-identical, so a control that re-emits its own
 * value cannot spend a round trip.
 */
export function requestViewerSelection(
  session: ViewerSession,
  next: ViewerSelection,
): { session: ViewerSession; request: number | null } {
  const normalized = normalizeViewerSelection(next);
  if (
    session.status !== "loading" &&
    viewerSelectionKey(normalized) === viewerSelectionKey(session.applied)
  ) {
    return { session, request: null };
  }
  const request = session.request + 1;
  return {
    session: { applied: session.applied, pending: normalized, request, status: "loading", message: null },
    request,
  };
}

/** Toggle one option and ask for the result. */
export function requestViewerOption(
  session: ViewerSession,
  panelId: string,
  handle: string,
  token: string,
  on: boolean,
): { session: ViewerSession; request: number | null } {
  return requestViewerSelection(session, toggleViewerOption(session.pending, panelId, handle, token, on));
}

/** Return one panel to «Todas las personas» and ask for the result. */
export function requestViewerPanelCleared(
  session: ViewerSession,
  panelId: string,
): { session: ViewerSession; request: number | null } {
  return requestViewerSelection(session, clearViewerPanel(session.pending, panelId));
}

/** Return the whole view to «Todas las personas» and ask for the result. */
export function requestViewerCleared(session: ViewerSession): {
  session: ViewerSession;
  request: number | null;
} {
  return requestViewerSelection(session, EMPTY_VIEWER_SELECTION);
}

export type ViewerResponse =
  | { ok: true }
  /** A refusal already turned into a sentence a person can read. */
  | { ok: false; message: string };

/**
 * Take a response, or drop it.
 *
 * A response whose `request` is not the newest one is a slower earlier request
 * arriving late, and applying it would overwrite a newer selection with older
 * numbers. It returns `session` itself — the same object — so the caller does
 * not re-render and a gate can assert identity rather than deep-compare.
 */
export function acceptViewerResponse(
  session: ViewerSession,
  request: number,
  response: ViewerResponse,
): ViewerSession {
  if (request !== session.request) return session;
  if (response.ok) {
    return { applied: session.pending, pending: session.pending, request, status: "idle", message: null };
  }
  // THE CONTROLS GO BACK TO WHAT THE NUMBERS ACTUALLY SHOW.
  //
  // Leaving `pending` standing would leave a reader looking at controls that
  // describe a selection nothing on the page was computed under. The choice is
  // discarded and the sentence says why.
  return {
    applied: session.applied,
    pending: session.applied,
    request,
    status: "error",
    message: response.message,
  };
}

/** Clear an error notice without changing anything the reader chose. */
export function dismissViewerMessage(session: ViewerSession): ViewerSession {
  if (session.message === null && session.status !== "error") return session;
  return { ...session, status: "idle", message: null };
}

/**
 * A comparable spelling of a selection.
 *
 * Only ever used to answer "is this the same selection", never sent anywhere.
 * The canonical constraint key belongs to the presentation layer, which builds
 * it per BLOCK; this one is over the whole selection, panels included, because
 * two selections that differ only in which panel carries a constraint are two
 * different requests.
 */
function viewerSelectionKey(selection: ViewerSelection): string {
  return normalizeViewerSelection(selection)
    .panels.map(
      (panel) =>
        `${panel.panelId}~${panel.dimensions
          .map((dimension) => `${dimension.handle}=${dimension.options.join(".")}`)
          .join(",")}`,
    )
    .join(";");
}
