"use client";

/**
 * THE WORKSPACE CHROME — which panels are open, how the canvas is drawn, and
 * why none of it is React state.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * IT LIVES OUTSIDE REACT SO IT CANNOT DIRTY THE DOCUMENT.
 *
 * Collapsing a panel, switching to the tablet canvas and zooming to 75% are
 * things a person does to the EDITOR. They are not edits to the presentation,
 * they must never appear in undo, and they must never make the document look
 * changed. Keeping them in a store that the document reducer cannot see makes
 * that true by construction rather than by everybody remembering.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY A `useSyncExternalStore` AND NOT `useState` + `useEffect`.
 *
 * The preference is restored from `sessionStorage`, and a browser store cannot
 * be read during render without the server's HTML and the client's first render
 * disagreeing — React replaces the tree and logs a hydration error. Reading it
 * in an effect instead means one render with the default and a second with the
 * real value, which is a visible flash of the wrong layout.
 *
 * `useSyncExternalStore` takes a third argument that is the SERVER snapshot, so
 * the server and the hydration pass both see `DEFAULT_CHROME` and agree, and the
 * stored preference arrives in the same commit as hydration. Every accessor is
 * wrapped in try/catch: a private window, cleared site data or a browser set to
 * block storage all throw on access, and none of them is a reason for an editor
 * not to open.
 */

export type CanvasMode = "desktop" | "tablet" | "mobile";
export type CanvasZoom = "fit" | 1 | 0.75 | 0.5;

export type ChromeState = {
  /** The pages-and-catalogue panel. */
  left: boolean;
  /** The selected-block inspector. */
  right: boolean;
  /**
   * Focus mode HIDES; it does not forget.
   *
   * It is a third flag read alongside the other two — `showLeft = left &&
   * !focus` — rather than something that writes into them. That is what makes
   * "leaving focus mode restores exactly what was open" true without storing a
   * copy of the previous state anywhere, and without the two ever drifting.
   */
  focus: boolean;
  mode: CanvasMode;
  zoom: CanvasZoom;
  /**
   * Has a person chosen a zoom?
   *
   * Until they have, the canvas may fit itself to the room it actually has. The
   * moment somebody picks anything from the control — 100% included — this goes
   * true and the automatic behaviour stops for the session. A control that
   * reads 100% over a canvas drawn at 62% is a control that lies.
   */
  zoomChosen: boolean;
};

export const DEFAULT_CHROME: ChromeState = {
  left: true,
  right: true,
  focus: false,
  mode: "desktop",
  // 1, not "fit". A scaled canvas shrinks the EDITOR's own controls along with
  // the drawing: at 50% a 44px handle measures 22px, and a 22px target is not a
  // target. Fitting is offered, and is automatic only until somebody chooses.
  zoom: 1,
  zoomChosen: false,
};

const KEY = "becommunity.composer.chrome";

let current: ChromeState = DEFAULT_CHROME;
let hydrated = false;
const listeners = new Set<() => void>();

function read(): ChromeState {
  try {
    const raw = window.sessionStorage.getItem(KEY);
    if (!raw) return DEFAULT_CHROME;
    const parsed = JSON.parse(raw) as Partial<ChromeState>;
    return {
      left: typeof parsed.left === "boolean" ? parsed.left : DEFAULT_CHROME.left,
      right: typeof parsed.right === "boolean" ? parsed.right : DEFAULT_CHROME.right,
      // Focus mode is NOT restored. Reopening the editor into a mode that hides
      // both panels, with no memory of having chosen it, looks like a broken
      // screen rather than a preference.
      focus: false,
      mode:
        parsed.mode === "tablet" || parsed.mode === "mobile" || parsed.mode === "desktop"
          ? parsed.mode
          : DEFAULT_CHROME.mode,
      zoom:
        parsed.zoom === "fit" || parsed.zoom === 1 || parsed.zoom === 0.75 || parsed.zoom === 0.5
          ? parsed.zoom
          : DEFAULT_CHROME.zoom,
      zoomChosen: typeof parsed.zoomChosen === "boolean" ? parsed.zoomChosen : DEFAULT_CHROME.zoomChosen,
    };
  } catch {
    return DEFAULT_CHROME;
  }
}

function write(state: ChromeState) {
  try {
    window.sessionStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    /* A browser that will not store a preference still gets to use the editor. */
  }
}

export function subscribeChrome(listener: () => void): () => void {
  if (!hydrated) {
    hydrated = true;
    current = read();
  }
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function readChrome(): ChromeState {
  if (!hydrated) {
    hydrated = true;
    current = read();
  }
  return current;
}

/** The snapshot the server renders and hydration matches. Always the default. */
export function serverChrome(): ChromeState {
  return DEFAULT_CHROME;
}

export function setChrome(patch: Partial<ChromeState>) {
  current = { ...current, ...patch };
  write(current);
  for (const listener of listeners) listener();
}

/** What is actually on screen, once focus mode has had its say. */
export function visiblePanels(state: ChromeState): { left: boolean; right: boolean } {
  return { left: state.left && !state.focus, right: state.right && !state.focus };
}

/** The literal width each canvas mode is drawn at, in canvas coordinates. */
export const CANVAS_WIDTH: Record<CanvasMode, number> = {
  // 1120 rather than 1280: 1280 is the WINDOW, and the canvas sits inside a
  // shell with padding and two possible panels.
  desktop: 1120,
  tablet: 768,
  mobile: 390,
};

export const ZOOM_LABEL: Record<string, string> = {
  fit: "Ajustar",
  "1": "100%",
  "0.75": "75%",
  "0.5": "50%",
};
