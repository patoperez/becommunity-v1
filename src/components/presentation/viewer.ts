/**
 * WHAT A READING SURFACE HANDS THE RENDERER SO ITS FILTERS ARE REAL.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * A PROP, NOT A FLAG ON THE MODEL.
 *
 * `PresentationRenderModel` is the same bytes wherever it is drawn — Unit 6A
 * settled that, and the audience follows the same rule for the same reason. So
 * whether the filter controls are OPERABLE is a property of the SURFACE that
 * mounted them, and the surface says so by handing this object down.
 *
 * Absent, every control is genuinely `disabled`. That matters more than it
 * looks: the authoring canvas wraps every drawing in an `inert` container so a
 * click inside a chart selects the BLOCK, and a control that looked live there
 * would be a control a reviewer clicks and learns something false from. The
 * composer therefore passes nothing on the canvas and passes this in the
 * reading view, and the difference is visible rather than inferred.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * IT CARRIES NO DATA AND NO RULE.
 *
 * Four callbacks, a status, a sentence, and the reader's own selection in the
 * opaque vocabulary the server offered — panel ids, handles and ordinal tokens.
 * There is no threshold here, no base, no count and no predicate: everything a
 * reader is shown about what their selection DID arrives already finished
 * inside the render model, computed where the study's numbers are.
 */

import type { ViewerSelection } from "@/lib/presentation";

export type ViewerControlsStatus = "idle" | "loading" | "error";

export type ViewerControls = {
  /**
   * What the reader has ASKED for, which may be ahead of what is drawn.
   *
   * The controls follow this so a click registers immediately; the sentences
   * and counts follow the render model, which describes what was actually
   * computed. While a request is in flight the two differ and the surface says
   * so out loud — the one thing it must never do is let them differ silently.
   */
  pending: ViewerSelection;
  status: ViewerControlsStatus;
  /** A sentence for a person when something went wrong. Never a code. */
  message: string | null;
  onToggle: (panelId: string, handle: string, token: string, on: boolean) => void;
  onClearPanel: (panelId: string) => void;
};
