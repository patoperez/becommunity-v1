"use client";

import Link from "next/link";
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useReducer,
  useRef,
  useState,
  useSyncExternalStore,
  useTransition,
} from "react";

import { blockCatalogue, blockSpec, type BlockType } from "@/lib/experience/blocks";
import { blockFilterSources, filterDimensionKinds } from "@/lib/experience/filters";
import {
  CHART_PALETTES,
  CHART_SPECS,
  compatibleVariants,
  isRendererImplemented,
  type ChartPalette,
  type ChartVariant,
} from "@/lib/experience/charts";
import { canAddBlock } from "@/lib/experience/defaults";
import {
  findBlock,
  parseExperienceDefinition,
  type ThemeCloudConfig,
  type ExperienceBlock,
  type ExperienceDefinitionV1,
  type ExperiencePage,
} from "@/lib/experience/definition";
import type { BlockDataSet } from "@/lib/experience/data";
import {
  addBand,
  addBandScheme,
  addBlock,
  addJourney,
  addMoment,
  addPage,
  adoptDefinition,
  canRedo,
  canUndo,
  detachBlockFromPanel,
  duplicateBlock,
  duplicateJourney,
  duplicateMoment,
  duplicatePage,
  initialState,
  moveBand,
  moveBlock,
  moveBlockToIndex,
  moveMoment,
  movePage,
  openPage,
  redo,
  removeBand,
  removeBandScheme,
  removeBlock,
  removeJourney,
  removeMoment,
  removePage,
  renameBandScheme,
  renameJourney,
  renamePage,
  resetToAdapted,
  selectBlock,
  setBlockAggregation,
  setBlockCopy,
  setBlockDimension,
  setBlockMetric,
  setBlockSamplePolicy,
  setBlockSpan,
  setBlockTitle,
  setBlockVisibility,
  setBand,
  setBandSchemeDescription,
  setBandSchemeFilter,
  setBandSchemeScale,
  setBandSchemeSource,
  setBlockBandScheme,
  setBlockJourney,
  setChartPalette,
  setChartVariant,
  setThemeCloud,
  setFilterConnection,
  setJourneyBandScheme,
  setJourneyDescription,
  setJourneyVariant,
  setMomentAwareness,
  setMomentBandScheme,
  setMomentBody,
  setMomentMetric,
  setMomentTitle,
  setMomentVariant,
  setMomentVisible,
  setPageVisibility,
  setStudySamplePolicy,
  undo,
  type EditorState,
  setIdentityText,
  toggleIdentityPart,
  setIdentityVisible,
  setIdentityReportDownload,
  setPanelIntro,
  setPanelLayout,
  setPanelOption,
  togglePanelFilter,
  movePanelFilter,
  setPanelTarget,
  togglePanelTargetBlock,
} from "@/lib/experience/editor";

import { FilterPanelCard, IdentityPanel } from "./AuthoringPanels";
import { JourneyManager } from "./JourneyManager";
import { SemaforoManager } from "./SemaforoManager";
import {
  BREAKPOINTS,
  BREAKPOINT_WIDTHS,
  GRID_COLUMNS,
  responsiveSpanClass,
  type Breakpoint,
} from "@/lib/experience/layout";
import { findMetric, type Aggregation, type SemanticRegistry } from "@/lib/experience/registry";
import { registryWithDerivedBands } from "@/lib/experience/band-filters";
import {
  SAMPLE_POLICY_MODES,
  SAMPLE_POLICY_VERSION,
  type SamplePolicyMode,
} from "@/lib/experience/sample-policy";
import { definitionSignature, serializeExperienceDefinition } from "@/lib/experience/serialize";
import { validateExperienceDefinition } from "@/lib/experience/validate";
import type { BuilderClientPayload } from "@/lib/experience/builder-workspace";
import { ConfirmAction } from "@/components/studio/ConfirmAction";

import { BlockView } from "./BlockView";

/**
 * "Construcción del dashboard" — the internal builder.
 *
 * IT SAVES. That is the sentence that separates this from what came before it,
 * and everything else in this file follows from it. An edit lands in local
 * state, an autosave carries it to one Server Action after a pause, the server
 * revalidates the document from scratch and stores it under an
 * optimistic-concurrency check, and reloading the page brings back what was
 * saved. The screen says which of those has happened, always, in words.
 *
 * WHAT IT STILL DOES NOT DO. It does not publish. Nothing here changes what a
 * client sees: the client dashboard and the internal client preview read the
 * study's own configuration exactly as they did before, and no client-facing
 * route imports anything from `src/lib/experience/**`. Publication is the next
 * milestone and it needs its own review boundary.
 *
 * THE ARRANGEMENT, AND WHY EACH PART IS WHERE IT IS.
 *
 *   left     pages, and the catalogue of blocks that can be added to the open
 *            one. Collapsible on a computer, a drawer on a narrow screen.
 *   centre   the canvas. It is the dominant area at every width, because it is
 *            the thing being built; the panels get out of its way.
 *   right    the selected block's properties, including every destructive and
 *            secondary action. A block on the canvas therefore carries TWO
 *            controls — a drag handle and a compact menu — instead of the five
 *            permanent buttons the prototype crammed into every narrow card.
 *   top      what state the draft is in, undo, redo, the width being previewed,
 *            and the way out.
 *
 * REORDERING HAS TWO WAYS IN, AND NEITHER IS A FALLBACK FOR THE OTHER. The
 * handle is draggable with a pointer, and the same handle moves the block with
 * the arrow keys while it has focus; the compact menu carries "subir" and
 * "bajar" as well. Native drag and drop does not exist on a phone, so on a
 * phone the keyboard and menu routes are the ones that work — which is why they
 * are real controls rather than an accessibility afterthought.
 *
 * PRECISION LAYOUT IS A DESKTOP JOB. The column-width control appears from
 * 768 px up. Below that a person can read, select, hide, reorder and edit the
 * words; they cannot fiddle with a twelve-column grid through a 320 px
 * viewport, and pretending otherwise produces a control nobody can hit.
 */

/** The palettes, in the words a person chooses between rather than the tokens. */
const PALETTE_LABEL: Record<ChartPalette, string> = {
  auto: "La que corresponda",
  mono: "Un solo tono, de claro a oscuro",
  cool: "Fríos",
  warm: "Cálidos",
  diverging: "De un extremo al otro",
  categorical: "Colores distintos por categoría",
};

const MODE_LABEL: Record<SamplePolicyMode, string> = {
  show_all: "Mostrar todos los resultados",
  warn_below: "Mostrar con aviso cuando hay pocas respuestas",
  hide_below: "Ocultar cuando hay pocas respuestas",
};

const MODE_DETAIL: Record<SamplePolicyMode, string> = {
  show_all:
    "Los resultados se ven desde una sola respuesta. Es la opción por omisión para las experiencias nuevas.",
  warn_below:
    "El número se ve siempre; debajo del mínimo se acompaña de un aviso de que descansa en pocas respuestas.",
  hide_below:
    "Debajo del mínimo el resultado no se muestra. Es la regla con la que funcionan hoy los estudios existentes.",
};

const BREAKPOINT_LABEL: Record<Breakpoint, string> = {
  desktop: "Computadora",
  tablet: "Tableta",
  mobile: "Teléfono",
};

const AGGREGATION_LABEL: Record<Aggregation, string> = {
  value: "Valor",
  average: "Promedio",
  sum: "Suma",
  count: "Cantidad de respuestas",
  share: "Porcentaje del total",
  min: "El menor",
  max: "El mayor",
  net_score: "Recomendación neta",
  top_box: "Porcentaje de satisfacción",
};

const button =
  "inline-flex min-h-11 items-center justify-center gap-1.5 rounded-lg border border-line-strong bg-surface px-3 py-2 text-sm font-medium text-strong transition-colors duration-[var(--motion-state)] hover:bg-surface-sunken disabled:cursor-not-allowed disabled:opacity-45";

const iconButton =
  "inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg border border-line bg-surface text-sm font-medium text-strong transition-colors duration-[var(--motion-state)] hover:bg-surface-sunken disabled:cursor-not-allowed disabled:opacity-40";

const menuItem =
  "flex min-h-11 w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm text-body hover:bg-surface-sunken disabled:cursor-not-allowed disabled:opacity-45";

const field =
  "min-h-11 w-full rounded-lg border border-line-strong bg-surface px-3 py-2 text-sm text-strong";

/**
 * The canvas scale. "fit" is measured from the room the canvas has; the rest
 * are fixed steps for reading at a size a person chose.
 */
export type CanvasZoom = "fit" | 1 | 0.75 | 0.5;

/**
 * The editor's own chrome, remembered for the browser session and nowhere else.
 *
 * `zoomChosen` is the difference between "this is what the editor decided for
 * you" and "this is what you asked for". Without it the automatic fit below
 * could not exist without taking the choice away: either the editor never
 * adapts, or it overrides a person who deliberately picked 100 %. One boolean
 * keeps both true.
 */
type ChromePreference = {
  left: boolean;
  right: boolean;
  focus: boolean;
  zoom: CanvasZoom;
  /** True once a person has picked a scale from the control themselves. */
  zoomChosen: boolean;
};

const CHROME_PREFERENCE_KEY = "becommunity.composer.chrome";

/**
 * THE CANVAS OPENS AT FULL SIZE, and that is a decision rather than an
 * oversight.
 *
 * A scaled canvas shrinks the editor's OWN controls with the drawing inside
 * it: at 40 % a 44 px drag handle measures 18 px, and an 18 px target is not a
 * target. Full size keeps every control operable and pans inside the canvas's
 * own box when the previewed width does not fit — which is what the room
 * freed by hiding a panel then buys: less panning, not a smaller picture.
 * "Ajustar al espacio" is there for the moment somebody wants the whole
 * arrangement at once, chosen deliberately, on a screen with room for it.
 */
const DEFAULT_CHROME: ChromePreference = {
  left: true,
  right: true,
  focus: false,
  zoom: 1,
  zoomChosen: false,
};

/**
 * Below this the canvas is never scaled, whatever is remembered.
 *
 * Scaling is a desktop affordance. On a phone the same 44 px rule that governs
 * every other control governs the ones on the canvas, and there is no scale at
 * which both "see the whole arrangement" and "the handle is still a handle"
 * are true. So on a narrow screen the canvas draws at full size and pans, and
 * the scale control is not offered at all.
 */
const SCALING_MIN_WIDTH = 1024;

function subscribeScalable(listener: () => void): () => void {
  const query = window.matchMedia(`(min-width: ${SCALING_MIN_WIDTH}px)`);
  query.addEventListener("change", listener);
  return () => query.removeEventListener("change", listener);
}

function readScalable(): boolean {
  return window.matchMedia(`(min-width: ${SCALING_MIN_WIDTH}px)`).matches;
}

/** The server draws at full size, which is what every snapshot agrees on. */
function serverScalable(): boolean {
  return true;
}

/**
 * THE EDITOR'S CHROME, KEPT OUTSIDE REACT ON PURPOSE.
 *
 * A tiny external store, read through `useSyncExternalStore`. The server and
 * the hydration pass are handed `DEFAULT_CHROME` — the same values the HTML
 * was rendered with, so there is nothing to mismatch — and the stored
 * preference arrives in the same commit rather than as a second render kicked
 * off from an effect.
 *
 * NOTHING ABOUT THE DOCUMENT IS EVER WRITTEN HERE. Four fields, all of them
 * about where things are on one person's screen. A draft lives in the study.
 */
let chromeCache: ChromePreference | null = null;
const chromeListeners = new Set<() => void>();

/** The snapshot React gets while rendering on the server and while hydrating. */
function serverChrome(): ChromePreference {
  return DEFAULT_CHROME;
}

/** Cached, because `getSnapshot` must return the same object until it changes. */
function readChrome(): ChromePreference {
  if (chromeCache) return chromeCache;
  let value = DEFAULT_CHROME;
  try {
    const stored = window.sessionStorage.getItem(CHROME_PREFERENCE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored) as Partial<ChromePreference>;
      value = {
        left: typeof parsed.left === "boolean" ? parsed.left : DEFAULT_CHROME.left,
        right: typeof parsed.right === "boolean" ? parsed.right : DEFAULT_CHROME.right,
        focus: typeof parsed.focus === "boolean" ? parsed.focus : DEFAULT_CHROME.focus,
        zoom:
          parsed.zoom === "fit" || parsed.zoom === 1 || parsed.zoom === 0.75 || parsed.zoom === 0.5
            ? parsed.zoom
            : DEFAULT_CHROME.zoom,
        zoomChosen:
          typeof parsed.zoomChosen === "boolean" ? parsed.zoomChosen : DEFAULT_CHROME.zoomChosen,
      };
    }
  } catch {
    // A browser that refuses storage is a browser that gets the defaults.
  }
  chromeCache = value;
  return value;
}

function subscribeChrome(listener: () => void): () => void {
  chromeListeners.add(listener);
  return () => {
    chromeListeners.delete(listener);
  };
}

/** Change part of the chrome, remember it, and tell every reader. */
function setChrome(patch: Partial<ChromePreference>): void {
  const next = { ...readChrome(), ...patch };
  chromeCache = next;
  try {
    window.sessionStorage.setItem(CHROME_PREFERENCE_KEY, JSON.stringify(next));
  } catch {
    // Not being able to remember a preference is not a reason to fail.
  }
  for (const listener of chromeListeners) listener();
}

/**
 * The floor a fitted canvas will not go below.
 *
 * Below roughly this, "the whole arrangement at once" stops being readable and
 * becomes a thumbnail. At that point the canvas keeps a size somebody can read
 * and pans inside its own box instead — the page itself still never scrolls
 * sideways.
 */
const MINIMUM_FIT_SCALE = 0.4;

type SaveStatus = "unsaved" | "dirty" | "saving" | "saved" | "error" | "conflict";

/**
 * Everything the last save attempt produced. Stored once, so what the screen
 * says about the draft is DERIVED rather than kept in a second place that can
 * disagree with the first.
 */
type SaveOutcome =
  | { kind: "saved"; revision: number }
  /** Tied to one exact document: the next edit is a new attempt worth making. */
  | { kind: "error"; message: string; signature: string }
  /** Tied to one revision: editing does not make somebody else's save go away. */
  | {
      kind: "conflict";
      message: string;
      revision: number | null;
      current: { definition: ExperienceDefinitionV1; revision: number } | null;
    };

type BuilderState = {
  editor: EditorState;
  /** What the last action did, or why it did nothing. */
  notice: string | null;
  /** Whether anything has actually been changed in this session. */
  edited: boolean;
};

function reduceBuilder(
  current: BuilderState,
  action: { run: (state: EditorState) => EditorState; done: string },
): BuilderState {
  const editor = action.run(current.editor);
  return {
    editor,
    notice: editor.refusal ?? (action.done === "" ? null : action.done),
    edited: current.edited || editor.definition !== current.editor.definition,
  };
}

export type SaveDraftAction = (
  studyId: string,
  definition: unknown,
  expectedRevision: number | null,
) => Promise<
  | { ok: true; revision: number; created: boolean; savedAt: string }
  | { ok: false; kind: "conflict"; message: string; current: { definition: ExperienceDefinitionV1; revision: number } | null }
  | { ok: false; kind: "invalid" | "denied" | "unavailable"; message: string }
>;

export type RefreshDataAction = (
  studyId: string,
  definition: unknown,
) => Promise<{ ok: true; data: BlockDataSet } | { ok: false; message: string }>;

export function ExperienceBuilder({
  payload,
  exitHref,
  previewHref,
  draftPreviewHref,
  saveDraft,
  refreshData,
}: {
  payload: BuilderClientPayload;
  exitHref: string;
  previewHref: string;
  draftPreviewHref: string;
  saveDraft: SaveDraftAction;
  refreshData: RefreshDataAction;
}) {
  const { study, adapted, adapterWarnings, evidence } = payload;
  const ids = useId().replace(/[^a-zA-Z0-9]/g, "");

  /**
   * THE EDITOR, THROUGH A REDUCER.
   *
   * `dispatch` never changes identity, so `act` is stable and the keyboard
   * shortcuts subscribe to it once instead of on every keystroke — and the
   * operation is applied to the LATEST state inside the reducer rather than to
   * whatever a closure happened to capture. `notice` rides along with it so a
   * refusal and a confirmation are produced in the same place the edit is.
   */
  const [ui, dispatch] = useReducer(reduceBuilder, payload.definition, (initial) => ({
    editor: initialState(initial),
    notice: null,
    edited: false,
  }));
  const state = ui.editor;

  const [data, setData] = useState<BlockDataSet>(payload.data);
  const [preview, setPreview] = useState<Breakpoint>("desktop");
  /*
   * THE EDITOR'S CHROME IS NOT PART OF THE DOCUMENT, AND NOT PART OF REACT
   * STATE EITHER.
   *
   * Which panels are open, whether focus mode is on and how far the canvas is
   * zoomed are preferences of the PERSON, in this browser, for this session.
   * They never touch `state.definition`, so toggling a panel cannot mint a
   * revision, cannot mark the draft dirty and cannot wake the autosave —
   * `dirty` is derived from the document's signature alone, which makes that
   * true by construction rather than by remembering not to.
   *
   * It is read through `useSyncExternalStore` rather than restored in an
   * effect. Reading `sessionStorage` while rendering would make the server's
   * HTML and the browser's first render disagree, which React reports as a
   * hydration error; restoring it afterwards with `setState` inside an effect
   * is a cascading render the project's own lint refuses. This is the shape
   * React provides for exactly this: the server and the hydration pass see the
   * defaults, and the stored preference arrives in the same commit.
   */
  const chrome = useSyncExternalStore(subscribeChrome, readChrome, serverChrome);
  const leftOpen = chrome.left;
  const rightOpen = chrome.right;
  const focusMode = chrome.focus;
  const [drawer, setDrawer] = useState<"none" | "left" | "right">("none");

  /*
   * AUTOMATIC FIT, WITHOUT TAKING THE CHOICE AWAY.
   *
   * The canvas draws the previewed width at full size and pans when there is
   * not room for it. That is right when somebody is working on one block, and
   * wrong the moment an editor OPENS with both panels showing on a 1 280 px
   * screen: a 1 120 px canvas in roughly 700 px of room is a horizontal scroll
   * of something whose shape nobody can see, beside a scale control nothing
   * told them was there.
   *
   * So a session that has not chosen a scale gets "Ajustar al espacio"
   * whenever the previewed width does not fit, and full size whenever it does.
   * The moment somebody picks a scale from the control — 100 % included — that
   * choice is remembered for the session and this stops deciding anything.
   *
   * IT RECALCULATES FROM MEASUREMENT, so hiding a panel, restoring one,
   * entering focus mode, leaving it or resizing the window all re-answer the
   * question on their own: `canvasRoom` is what the canvas measured, not a
   * breakpoint somebody guessed from.
   *
   * NOTHING HERE TOUCHES THE DOCUMENT. It is a scale on one person's screen.
   */
  const [canvasRoom, setCanvasRoom] = useState(0);
  const previewWidth = CANVAS_WIDTH[preview];
  const previewFits = canvasRoom === 0 || canvasRoom >= previewWidth;
  const zoomIsAutomatic = !chrome.zoomChosen && !previewFits;
  const zoom: CanvasZoom = zoomIsAutomatic ? "fit" : chrome.zoom;

  /**
   * FOCUS MODE HIDES; IT DOES NOT FORGET.
   *
   * Leaving it restores exactly the panels that were open before, because it
   * never writes `left` or `right` — it is a third fact, read alongside them.
   * The selected page, the selected block, the zoom, the scroll position and
   * anything half-typed are all in state focus mode does not touch, so none of
   * them can be lost by entering or leaving it.
   */
  const showLeft = leftOpen && !focusMode;
  const showRight = rightOpen && !focusMode;
  const [pendingType, setPendingType] = useState<BlockType>("rich_text");
  /** Which recorrido the manager has open. Editor chrome; never the document. */
  const [openJourney, setOpenJourney] = useState<string | null>(null);
  /** Which semáforo the manager has open. Editor chrome; never the document. */
  const [openScheme, setOpenScheme] = useState<string | null>(null);
  const [newPageTitle, setNewPageTitle] = useState("");

  const [saving, setSaving] = useState(false);
  const [outcome, setOutcome] = useState<SaveOutcome | null>(null);
  const [revision, setRevision] = useState<number | null>(payload.draft?.revision ?? null);
  /**
   * The signature of what is actually stored, or null when nothing is.
   *
   * Null on a study that has never been composed, so the screen says "sin
   * guardar todavía" instead of claiming a draft exists. Opening the page does
   * NOT create one: the first save happens when somebody edits something.
   */
  const [savedSignature, setSavedSignature] = useState<string | null>(
    payload.draft ? definitionSignature(payload.definition) : null,
  );
  const [, startDataTransition] = useTransition();

  const definition = state.definition;
  const signature = useMemo(() => definitionSignature(definition), [definition]);
  const dirty = signature !== savedSignature;

  const downloadRef = useRef<HTMLAnchorElement | null>(null);
  /** Bounded: one automatic retry after a transient failure, then a person. */
  const transientFailures = useRef(0);

  /** Every action goes through here, so a refusal is always announced. */
  const act = useCallback(
    (run: (current: EditorState) => EditorState, done: string) => {
      dispatch({ run, done });
    },
    [],
  );

  // -------------------------------------------------------------------------
  // What state the draft is in — derived, never stored twice
  // -------------------------------------------------------------------------

  /**
   * A CONFLICT is about the revision, so it stands until the revision moves —
   * editing does not make somebody else's save go away. A FAILURE is about one
   * exact document, so the next edit clears it and the autosave tries again.
   */
  const conflicting = outcome?.kind === "conflict" && outcome.revision === revision;
  const failedHere = outcome?.kind === "error" && outcome.signature === signature;
  const status: SaveStatus = saving
    ? "saving"
    : conflicting
      ? "conflict"
      : failedHere
        ? "error"
        : dirty
          ? savedSignature === null && !ui.edited
            ? "unsaved"
            : "dirty"
          : "saved";
  const statusMessage =
    (conflicting || failedHere) && outcome && "message" in outcome ? outcome.message : null;
  const conflictVersion = conflicting && outcome.kind === "conflict" ? outcome.current : null;

  const save = useCallback(
    async (documentToSave: ExperienceDefinitionV1, because: "auto" | "manual") => {
      const sent = definitionSignature(documentToSave);
      setSaving(true);
      try {
        const result = await saveDraft(study.id, documentToSave, revision);
        if (result.ok) {
          transientFailures.current = 0;
          setRevision(result.revision);
          setSavedSignature(sent);
          setOutcome({ kind: "saved", revision: result.revision });
          if (because === "manual") {
            dispatch({ run: (current) => current, done: "Se guardó el borrador." });
          }
          return;
        }
        if (result.kind === "conflict") {
          setOutcome({
            kind: "conflict",
            message: result.message,
            revision,
            current: result.current,
          });
          dispatch({ run: (current) => current, done: result.message });
          return;
        }
        if (result.kind === "unavailable") transientFailures.current += 1;
        setOutcome({ kind: "error", message: result.message, signature: sent });
        dispatch({ run: (current) => current, done: result.message });
      } catch {
        transientFailures.current += 1;
        setOutcome({
          kind: "error",
          message: "No se pudo guardar en este momento. Vuelve a intentarlo.",
          signature: sent,
        });
      } finally {
        setSaving(false);
      }
    },
    [revision, saveDraft, study.id],
  );

  // Autosave. Debounced, and deliberately not attempted while a conflict stands
  // or while the same document has just been refused: retrying an identical
  // request against identical server state produces the identical answer and
  // buries the message that explains it.
  const autosaveBlocked = saving || conflicting || failedHere;
  useEffect(() => {
    if (!dirty || !ui.edited || autosaveBlocked) return;
    const timer = setTimeout(() => {
      void save(definition, "auto");
    }, 1200);
    return () => clearTimeout(timer);
  }, [definition, dirty, ui.edited, autosaveBlocked, save]);

  // ONE automatic retry after a transient failure, then it stops and waits for
  // a person. A save that keeps failing is a save that needs to be read about,
  // not one that needs to be attempted forty more times.
  useEffect(() => {
    if (!failedHere || saving || transientFailures.current !== 1) return;
    const timer = setTimeout(() => {
      transientFailures.current += 1;
      void save(definition, "auto");
    }, 4000);
    return () => clearTimeout(timer);
  }, [failedHere, saving, definition, save]);


  // A person who closes the tab mid-edit is told there is something unsaved.
  useEffect(() => {
    if (!dirty) return;
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);

  // -------------------------------------------------------------------------
  // Numbers
  // -------------------------------------------------------------------------

  // The set of aggregates the document needs, as one comparable string. When it
  // changes — a different result, a different breakdown, a block added — the
  // numbers are recomputed on the server. Renaming a block does not change it,
  // so typing a title never triggers a round trip.
  const dataShape = useMemo(
    () =>
      JSON.stringify([
        definition.pages.map((page) =>
          page.blocks.map((block) => [
            block.id,
            block.type,
            block.query?.metricId ?? null,
            block.query?.aggregation ?? null,
            block.query?.primaryDimensionId ?? null,
            block.query?.secondaryDimensionId ?? null,
            block.query?.topN ?? null,
            block.query?.sort.by ?? null,
            block.query?.sort.direction ?? null,
            /*
             * A CLOUD'S BASIS AND SOURCE ARE PART OF THE QUESTION, not part of
             * how it is painted.
             *
             * Mentions and people are two different counts, and "only the
             * focus group" is a different set of observations — both are
             * computed on the server. Leaving them out of this shape meant
             * switching the basis repainted the caption over the OLD numbers,
             * which is the exact failure a caption is supposed to prevent.
             * Everything else about a cloud — its palette, its font bounds,
             * how many words fit — is drawing, and correctly absent here.
             */
            block.themeCloud?.basis ?? null,
            block.themeCloud?.source ?? null,
          ]),
        ),
        definition.journeyReferences.map((journey) => [
          journey.id,
          journey.moments.map((moment) => [moment.id, moment.metricId]),
        ]),
      ]),
    [definition],
  );
  const loadedShape = useRef(dataShape);

  useEffect(() => {
    if (loadedShape.current === dataShape) return;
    const timer = setTimeout(() => {
      const wanted = dataShape;
      startDataTransition(async () => {
        const result = await refreshData(study.id, definition);
        if (result.ok) {
          loadedShape.current = wanted;
          setData(result.data);
        }
      });
    }, 500);
    return () => clearTimeout(timer);
  }, [dataShape, definition, refreshData, study.id]);

  // -------------------------------------------------------------------------
  // Derived views
  // -------------------------------------------------------------------------

  const page: ExperiencePage | null =
    definition.pages.find((candidate) => candidate.id === state.openPageId)
    ?? definition.pages[0]
    ?? null;
  const selected = state.selectedBlockId ? findBlock(definition, state.selectedBlockId) : null;

  const schemaIssues = useMemo(() => {
    const parsed = parseExperienceDefinition(definition);
    return parsed.ok ? [] : parsed.issues;
  }, [definition]);
  /*
   * THE REGISTRY THE EDITOR WORKS AGAINST INCLUDES WHAT THE DOCUMENT DERIVES.
   *
   * The server widens the registry with the semáforos the SAVED document
   * configures. That is right for the first paint and wrong for the next
   * minute: somebody who has just written a standard and named the result it
   * classifies has created a characteristic, and being told to save and reload
   * before the filter panel will offer it is being told that the editor does
   * not believe the edit happened.
   *
   * `registryWithDerivedBands` is a pure function of the document and the
   * study's own registry, so deriving it again here produces exactly what the
   * server will produce on the next load — one rule, evaluated in two places,
   * never two rules.
   */
  const registry = useMemo(
    () => registryWithDerivedBands(definition, payload.registry),
    [definition, payload.registry],
  );

  const report = useMemo(
    () => validateExperienceDefinition(definition, registry),
    [definition, registry],
  );
  const blocking = schemaIssues.length + report.errors.length;

  const catalogue = useMemo(
    () =>
      blockCatalogue()
        .map((group) => ({
          ...group,
          blocks: group.blocks.filter((spec) =>
            canAddBlock(spec.id, registry, definition.journeyReferences.length > 0),
          ),
        }))
        .filter((group) => group.blocks.length > 0),
    [registry, definition.journeyReferences.length],
  );

  const totalBlocks = definition.pages.reduce((total, entry) => total + entry.blocks.length, 0);

  // Ctrl/⌘+Z and ⇧+Ctrl/⌘+Z, the two shortcuts everybody already has in their
  // fingers. Ignored while the focus is in a text field, where the browser's own
  // undo is the one a person means.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== "z") return;
      const target = event.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || target?.isContentEditable) return;
      event.preventDefault();
      if (event.shiftKey) act(redo, "Se rehízo el último cambio.");
      else act(undo, "Se deshizo el último cambio.");
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [act]);

  /*
   * ESCAPE LEAVES FOCUS MODE — WHEN THERE IS NOTHING NEARER TO LEAVE.
   *
   * A dialog, a menu and a drawer all answer Escape first, and taking it from
   * them to close a mode two levels out is how a confirmation gets dismissed
   * by somebody who meant to leave a mode. So: not while a drawer is open, not
   * from inside a text field where Escape can mean "revert this entry", and
   * not when something has opened a modal above the editor. Only then, and it
   * is not the only way out: the toolbar keeps a labelled button.
   */
  useEffect(() => {
    if (!focusMode || drawer !== "none") return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      const target = event.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target?.isContentEditable) return;
      if (target?.closest("dialog, [role='dialog'], [role='menu']")) return;
      setChrome({ focus: false });
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [focusMode, drawer]);

  function download() {
    const contents = serializeExperienceDefinition(definition, { pretty: true });
    const blob = new Blob([contents], { type: "application/json;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = downloadRef.current;
    if (!link) return;
    link.href = url;
    link.download = `construccion-${study.id}.json`;
    link.click();
    // Revoking in the same tick cancels the download in some browsers. The
    // handle is released on the next turn of the event loop instead.
    setTimeout(() => URL.revokeObjectURL(url), 0);
    act(
      (current) => current,
      `Se descargó la versión que tienes en pantalla: ${definition.pages.length} páginas y ${totalBlocks} bloques.`,
    );
  }

  const policy = definition.sampleVisibilityPolicy;

  return (
    <div className="min-w-0 space-y-4">
      <TopBar
        status={status}
        statusMessage={statusMessage}
        dirty={dirty}
        revision={revision}
        blocking={blocking}
        pages={definition.pages.length}
        blocks={totalBlocks}
        preview={preview}
        zoom={zoom}
        zoomAutomatic={zoomIsAutomatic}
        onZoom={(next) => {
          setChrome({ zoom: next, zoomChosen: true });
          act(
            (current) => current,
            next === "fit"
              ? "La composición se ajusta al espacio disponible."
              : next === 1
                ? "La composición se ve a tamaño real."
                : `La composición se ve al ${Math.round(next * 100)} %.`,
          );
        }}
        onPreview={(next) => {
          setPreview(next);
          act(
            (current) => current,
            `La composición se muestra como en ${BREAKPOINT_LABEL[next].toLowerCase()}.`,
          );
        }}
        canUndo={canUndo(state)}
        canRedo={canRedo(state)}
        onUndo={() => act(undo, "Se deshizo el último cambio.")}
        onRedo={() => act(redo, "Se rehízo el último cambio.")}
        onSave={() => void save(definition, "manual")}
        onDownload={download}
        // Each toolbar toggle moves ONE side and pins the other to what is on
        // screen, for the same reason the edge tabs do: leaving focus mode is a
        // separate, differently-labelled act.
        onToggleLeft={() => setChrome({ focus: false, left: !showLeft, right: showRight })}
        onToggleRight={() => setChrome({ focus: false, right: !showRight, left: showLeft })}
        onToggleFocus={() => setChrome({ focus: !focusMode })}
        onOpenDrawer={setDrawer}
        leftOpen={showLeft}
        rightOpen={showRight}
        focusMode={focusMode}
        exitHref={exitHref}
        previewHref={previewHref}
        draftPreviewHref={draftPreviewHref}
      />

      {payload.draftProblem ? (
        <p className="rounded-lg border border-caution-line bg-caution-surface px-3 py-2.5 text-sm text-caution">
          {payload.draftProblem} Se está mostrando la configuración actual del estudio; al guardar,
          esa será la versión que quede.
        </p>
      ) : null}

      {status === "conflict" ? (
        <div className="rounded-lg border border-danger-line bg-danger-surface px-3 py-3 text-sm text-danger">
          <p className="font-semibold">{statusMessage}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              type="button"
              className={button}
              disabled={!conflictVersion}
              onClick={() => {
                if (!conflictVersion) return;
                setRevision(conflictVersion.revision);
                setSavedSignature(definitionSignature(conflictVersion.definition));
                setOutcome({ kind: "saved", revision: conflictVersion.revision });
                act(
                  (current) => adoptDefinition(current, conflictVersion.definition),
                  "Se cargó la versión guardada por la otra persona. Tus cambios sin guardar se descartaron.",
                );
              }}
            >
              Ver y quedarme con la versión guardada
            </button>
            <button
              type="button"
              className={button}
              onClick={download}
            >
              Descargar mi versión antes de decidir
            </button>
          </div>
        </div>
      ) : null}

      <p aria-live="polite" className="min-h-5 text-sm text-body">
        {ui.notice ?? ""}
      </p>

      {/* Only rendered below `lg`, and only while a drawer is open. */}
      {drawer !== "none" ? (
        <button
          type="button"
          aria-label="Cerrar el panel"
          className="fixed inset-0 z-30 cursor-default bg-ink/40 lg:hidden"
          onClick={() => setDrawer("none")}
        />
      ) : null}

      {/*
        THE TRACK GOES AWAY WITH THE PANEL.

        A hidden `aside` inside a `[auto_...]` track left a zero-width column
        AND its gap behind, so the canvas gained a little room instead of all
        of it. The template is now written from what is actually on screen, as
        four complete literal class strings so the stylesheet contains them.
      */}
      <div
        className={`grid min-w-0 gap-4 ${
          showLeft
            ? showRight
              ? "lg:grid-cols-[auto_minmax(0,1fr)] xl:grid-cols-[auto_minmax(0,1fr)_auto]"
              : "lg:grid-cols-[auto_minmax(0,1fr)] xl:grid-cols-[auto_minmax(0,1fr)]"
            : showRight
              ? "lg:grid-cols-[minmax(0,1fr)] xl:grid-cols-[minmax(0,1fr)_auto]"
              : "lg:grid-cols-[minmax(0,1fr)] xl:grid-cols-[minmax(0,1fr)]"
        }`}
      >
        <Panel
          side="left"
          label="Páginas y catálogo de bloques"
          open={showLeft}
          drawerOpen={drawer === "left"}
          onClose={() => setDrawer("none")}
          // ONLY THIS PANEL. `left: false` and nothing else — the right panel's
          // state is not read, not written, and cannot move as a side effect.
          onCollapse={() => setChrome({ left: false })}
          collapseLabel="Ocultar el panel de páginas y catálogo de bloques"
        >
          <PagesPanel
            idPrefix={ids}
            definition={definition}
            openPageId={page?.id ?? null}
            newPageTitle={newPageTitle}
            onNewPageTitle={setNewPageTitle}
            onOpen={(pageId) => act((current) => openPage(current, pageId), "")}
            onAddPage={() => {
              act((current) => addPage(current, newPageTitle), `Se añadió la página “${newPageTitle.trim()}”.`);
              setNewPageTitle("");
            }}
            onMovePage={(pageId, direction) =>
              act((current) => movePage(current, pageId, direction), "Se movió la página.")
            }
            onDuplicatePage={(pageId) =>
              act((current) => duplicatePage(current, pageId), "Se duplicó la página.")
            }
            onRenamePage={(pageId, title) =>
              act((current) => renamePage(current, pageId, title), "")
            }
            onTogglePage={(pageId, visible) =>
              act(
                (current) => setPageVisibility(current, pageId, visible),
                visible ? "La página vuelve a mostrarse." : "La página queda oculta.",
              )
            }
            onRemovePage={(pageId) =>
              act((current) => removePage(current, pageId), "Se quitó la página.")
            }
          />

          {page ? (
            <CataloguePanel
              idPrefix={ids}
              page={page}
              catalogue={catalogue}
              pendingType={pendingType}
              onPendingType={setPendingType}
              onAdd={() =>
                act(
                  (current) => addBlock(current, page.id, pendingType, registry),
                  `Se añadió “${blockSpec(pendingType).label}” al final de “${page.title}”.`,
                )
              }
            />
          ) : null}

          <IdentityPanel
            idPrefix={ids}
            identity={definition.identity}
            onText={(field, value) =>
              act((current) => setIdentityText(current, field, value), "")
            }
            onToggle={(part, shown) =>
              act(
                (current) => toggleIdentityPart(current, part, shown),
                shown ? "Se muestra en la portada." : "Se oculta de la portada.",
              )
            }
            onVisible={(visible) =>
              act(
                (current) => setIdentityVisible(current, visible),
                visible ? "La portada vuelve a mostrarse." : "La portada queda oculta.",
              )
            }
            onReportDownload={(offered) =>
              act((current) => setIdentityReportDownload(current, offered), "")
            }
          />

          {/*
            RECORRIDOS ARE DEFINED HERE, NOT ON THE CANVAS.

            Beside the pages and the identity, because a recorrido is a thing
            the STUDY has rather than a thing a page has: several blocks on
            several pages can be windows onto one of them, and editing it in
            one of those windows is what made the second one a fork.
          */}
          <JourneyManager
            idPrefix={ids}
            definition={definition}
            registry={registry}
            openJourneyId={openJourney}
            onOpenJourney={setOpenJourney}
            onAddJourney={(title) => {
              act(
                (current) => addJourney(current, title, registry),
                `Se añadió el recorrido “${title.trim()}”.`,
              );
            }}
            onDuplicateJourney={(journeyId) =>
              act(
                (current) => duplicateJourney(current, journeyId),
                "Se duplicó el recorrido. Es uno nuevo: editarlo no cambia el original.",
              )
            }
            onRenameJourney={(journeyId, title) =>
              act((current) => renameJourney(current, journeyId, title), "")
            }
            onJourneyDescription={(journeyId, description) =>
              act((current) => setJourneyDescription(current, journeyId, description), "")
            }
            onJourneyVariant={(journeyId, variant) =>
              act((current) => setJourneyVariant(current, journeyId, variant), "Cambió cómo se dibuja el recorrido.")
            }
            onJourneyBandScheme={(journeyId, bandSchemeId) =>
              act(
                (current) => setJourneyBandScheme(current, journeyId, bandSchemeId),
                "Cambió el semáforo del recorrido.",
              )
            }
            onRemoveJourney={(journeyId) =>
              act((current) => removeJourney(current, journeyId), "Se quitó el recorrido.")
            }
            onAddMoment={(journeyId, title) =>
              act((current) => addMoment(current, journeyId, title), `Se añadió el momento “${title.trim()}”.`)
            }
            onDuplicateMoment={(journeyId, momentId) =>
              act((current) => duplicateMoment(current, journeyId, momentId), "Se duplicó el momento.")
            }
            onMoveMoment={(journeyId, momentId, direction) =>
              act((current) => moveMoment(current, journeyId, momentId, direction), "Se movió el momento.")
            }
            onRemoveMoment={(journeyId, momentId) =>
              act((current) => removeMoment(current, journeyId, momentId), "Se quitó el momento.")
            }
            onMomentTitle={(journeyId, momentId, title) =>
              act((current) => setMomentTitle(current, journeyId, momentId, title), "")
            }
            onMomentBody={(journeyId, momentId, body) =>
              act((current) => setMomentBody(current, journeyId, momentId, body), "")
            }
            onMomentMetric={(journeyId, momentId, metricId) =>
              act(
                (current) => setMomentMetric(current, journeyId, momentId, metricId, registry),
                "Se cambió el resultado del momento.",
              )
            }
            onMomentVariant={(journeyId, momentId, variant) =>
              act((current) => setMomentVariant(current, journeyId, momentId, variant), "")
            }
            onMomentBandScheme={(journeyId, momentId, bandSchemeId) =>
              act((current) => setMomentBandScheme(current, journeyId, momentId, bandSchemeId), "")
            }
            onMomentAwareness={(journeyId, momentId, awareness) =>
              act(
                (current) => setMomentAwareness(current, journeyId, momentId, awareness, registry),
                awareness
                  ? "Se configuró quién no conocía este momento."
                  : "Este momento ya no mide el desconocimiento.",
              )
            }
            onMomentVisible={(journeyId, momentId, visible) =>
              act(
                (current) => setMomentVisible(current, journeyId, momentId, visible),
                visible ? "El momento vuelve a mostrarse." : "El momento queda oculto.",
              )
            }
          />

          {/*
            WHAT GOOD LOOKS LIKE, WRITTEN DOWN ONCE.

            Beside the recorridos, because a semáforo is the same kind of thing:
            a decision the STUDY carries, referenced by whatever reads it. A
            block, a recorrido and a single moment can all point at one, and
            editing it here changes all of them.
          */}
          <SemaforoManager
            idPrefix={ids}
            definition={definition}
            registry={registry}
            openSchemeId={openScheme}
            onOpenScheme={setOpenScheme}
            onAddScheme={(title) =>
              act((current) => addBandScheme(current, title), `Se añadió el semáforo “${title.trim()}”.`)
            }
            onRenameScheme={(schemeId, title) =>
              act((current) => renameBandScheme(current, schemeId, title), "")
            }
            onSchemeDescription={(schemeId, description) =>
              act((current) => setBandSchemeDescription(current, schemeId, description), "")
            }
            onSchemeSource={(schemeId, source) =>
              act(
                (current) => setBandSchemeSource(current, schemeId, source),
                source === "numeric"
                  ? "El semáforo clasifica por rangos."
                  : "El semáforo clasifica por categorías registradas.",
              )
            }
            onSchemeScale={(schemeId, scale) =>
              act((current) => setBandSchemeScale(current, schemeId, scale), "")
            }
            onSchemeFilter={(schemeId, metricId, filterLabel) =>
              act(
                (current) => setBandSchemeFilter(current, schemeId, metricId, filterLabel, registry),
                metricId
                  ? "Este semáforo se ofrecerá como característica para filtrar."
                  : "Este semáforo ya no se ofrece como filtro.",
              )
            }
            onRemoveScheme={(schemeId) =>
              act((current) => removeBandScheme(current, schemeId), "Se quitó el semáforo.")
            }
            onAddBand={(schemeId, bandLabel) =>
              act((current) => addBand(current, schemeId, bandLabel), "Se añadió una banda.")
            }
            onBand={(schemeId, bandId, patch) =>
              act((current) => setBand(current, schemeId, bandId, patch), "")
            }
            onMoveBand={(schemeId, bandId, direction) =>
              act((current) => moveBand(current, schemeId, bandId, direction), "Se movió la banda.")
            }
            onRemoveBand={(schemeId, bandId) =>
              act((current) => removeBand(current, schemeId, bandId), "Se quitó la banda.")
            }
          />

          <SamplePolicyPanel
            idPrefix={ids}
            mode={policy.mode}
            threshold={policy.threshold}
            onMode={(mode) =>
              act(
                (current) => setStudySamplePolicy(current, mode),
                `La regla del estudio es ahora: ${MODE_LABEL[mode].toLowerCase()}.`,
              )
            }
            onThreshold={(threshold) =>
              act((current) => setStudySamplePolicy(current, policy.mode, threshold), "")
            }
          />
        </Panel>

        {/* ---- The canvas: the dominant area at every width ----------------
            A region, not a second `<main>`: the shell already provides the
            document's one main landmark, and nesting another inside it gives a
            screen reader two answers to "where does the content start". */}
        {/*
          THE RESTORE TAB GETS ITS OWN STRIP, rather than sitting on top of the
          canvas. Floated over the card it covered the page's title and its
          block count — a control that hides the thing it is next to. The
          region simply starts a tab's width further in when a panel is hidden,
          which still leaves the canvas far wider than the 288 px panel it
          replaced.
        */}
        <div
          role="region"
          aria-label="Lienzo de la página"
          className={`relative min-w-0 ${showLeft ? "" : "lg:pl-12"} ${showRight ? "" : "xl:pr-12"}`}
        >
          {/*
            ALWAYS A WAY BACK, ON THE EDGE IT WENT OUT OF.

            The toolbar keeps its own "Mostrar páginas" / "Mostrar ficha" — in
            focus mode too, which is why focus mode is never a corner somebody
            is stuck in. These are the same act, put where the panel used to
            be, so restoring it is where a hand already is. They exist only at
            the widths where the panel is a COLUMN; below that it is a drawer
            with its own opener and a second control would be a second set of
            identifiers for one thing.
          */}
          {/*
            RESTORING ONE PANEL RESTORES ONE PANEL.

            Leaving focus mode is what restores the pair, and it is a different
            control with a different label. So each tab writes `focus: false`
            AND pins the other side to what is on screen right now: from focus
            mode the other stays hidden, and outside it the write is a no-op
            for that side. Without the pin, restoring the pages panel out of
            focus mode would drag the inspector back with it.
          */}
          {!showLeft ? (
            <button
              type="button"
              onClick={() => setChrome({ focus: false, left: true, right: showRight })}
              aria-label="Mostrar el panel de páginas y catálogo de bloques"
              title="Mostrar páginas y bloques"
              data-restore-tab="left"
              className="absolute left-0 top-2 z-10 hidden min-h-11 min-w-11 items-center justify-center rounded-lg border border-line-strong bg-surface text-sm font-medium text-strong hover:bg-surface-sunken lg:inline-flex"
            >
              ›
            </button>
          ) : null}
          {!showRight ? (
            <button
              type="button"
              onClick={() => setChrome({ focus: false, right: true, left: showLeft })}
              aria-label="Mostrar la ficha del bloque seleccionado"
              title="Mostrar la ficha del bloque"
              data-restore-tab="right"
              className="absolute right-0 top-2 z-10 hidden min-h-11 min-w-11 items-center justify-center rounded-lg border border-line-strong bg-surface text-sm font-medium text-strong hover:bg-surface-sunken xl:inline-flex"
            >
              ‹
            </button>
          ) : null}
          {page ? (
            <Canvas
              page={page}
              definition={definition}
              registry={registry}
              data={data}
              evidence={evidence}
              study={study}
              breakpoint={preview}
              zoom={zoom}
              onRoom={setCanvasRoom}
              selectedBlockId={state.selectedBlockId}
              onSelect={(blockId) => {
                act((current) => selectBlock(current, blockId), "");
                if (window.matchMedia("(max-width: 1279px)").matches) setDrawer("right");
              }}
              onMove={(blockId, direction) =>
                act((current) => moveBlock(current, blockId, direction), "Se movió el bloque.")
              }
              onDrop={(blockId, index) =>
                act((current) => moveBlockToIndex(current, blockId, index), "Se movió el bloque.")
              }
              onDuplicate={(blockId) =>
                act((current) => duplicateBlock(current, blockId), "Se duplicó el bloque.")
              }
              onToggle={(blockId, visible) =>
                act(
                  (current) => setBlockVisibility(current, blockId, visible),
                  visible ? "El bloque vuelve a mostrarse." : "El bloque queda oculto.",
                )
              }
              onRemove={(blockId) =>
                act((current) => removeBlock(current, blockId), "Se quitó el bloque.")
              }
            />
          ) : (
            <p className="rounded-xl border border-dashed border-line bg-surface px-4 py-8 text-sm text-muted">
              Esta experiencia no tiene páginas. Añade una desde el panel de páginas.
            </p>
          )}

          <Notices
            schemaIssues={schemaIssues}
            report={report}
            adapterWarnings={adapterWarnings}
          />
        </div>

        <Panel
          side="right"
          label="Ficha del bloque seleccionado"
          open={showRight}
          drawerOpen={drawer === "right"}
          onClose={() => setDrawer("none")}
          onCollapse={() => setChrome({ right: false })}
          collapseLabel="Ocultar la ficha del bloque seleccionado"
        >
          {selected ? (
            <Inspector
              idPrefix={ids}
              block={selected.block}
              pageTitle={selected.page.title}
              definition={definition}
              registry={registry}
              onTitle={(value) => act((current) => setBlockTitle(current, selected.block.id, value), "")}
              onCopy={(fieldName, value) =>
                act((current) => setBlockCopy(current, selected.block.id, fieldName, value), "")
              }
              onVariant={(variant) =>
                act(
                  (current) => setChartVariant(current, selected.block.id, variant),
                  `Ahora se dibuja como ${CHART_SPECS[variant].label.toLowerCase()}.`,
                )
              }
              onMetric={(metricId) =>
                act(
                  (current) => setBlockMetric(current, selected.block.id, metricId, registry),
                  "Se cambió el resultado del bloque.",
                )
              }
              onAggregation={(aggregation) =>
                act(
                  (current) => setBlockAggregation(current, selected.block.id, aggregation, registry),
                  "Se cambió cómo se calcula el resultado.",
                )
              }
              onDimension={(slot, dimensionId) =>
                act(
                  (current) => setBlockDimension(current, selected.block.id, slot, dimensionId, registry),
                  "Se cambió el desglose del bloque.",
                )
              }
              onSpan={(breakpoint, span) =>
                act((current) => setBlockSpan(current, selected.block.id, breakpoint, span), "")
              }
              onSamplePolicy={(override) =>
                act(
                  (current) => setBlockSamplePolicy(current, selected.block.id, override),
                  "Se cambió la regla de este bloque.",
                )
              }
              onJourney={(journeyId) =>
                act(
                  (current) => setBlockJourney(current, selected.block.id, journeyId),
                  "Este bloque ahora muestra otro recorrido.",
                )
              }
              onBandScheme={(schemeId) =>
                act(
                  (current) => setBlockBandScheme(current, selected.block.id, schemeId),
                  schemeId ? "Este bloque se lee con ese semáforo." : "Este bloque queda sin semáforo.",
                )
              }
              onPalette={(palette) =>
                act((current) => setChartPalette(current, selected.block.id, palette), "")
              }
              onThemeCloud={(patch) =>
                act((current) => setThemeCloud(current, selected.block.id, patch), "")
              }
              qualitativeSources={evidence.qualitativeSources}
              onOpenPanel={(pageId, panelId) => {
                act((current) => selectBlock(openPage(current, pageId), panelId), "");
                if (window.matchMedia("(max-width: 1279px)").matches) setDrawer("right");
              }}
              onDisconnectSource={(source) =>
                act(
                  (current) =>
                    source.panelId
                      ? detachBlockFromPanel(current, source.panelId, selected.block.id)
                      : source.filterIds.reduce(
                          (state, filterId) =>
                            setFilterConnection(state, filterId, selected.block.id, false),
                          current,
                        ),
                  "Este bloque ya no responde a ese filtro.",
                )
              }
              panelCard={
                selected.block.type === "filter_panel" ? (
                  <FilterPanelCard
                    idPrefix={ids}
                    block={selected.block}
                    definition={definition}
                    onIntro={(value) =>
                      act((current) => setPanelIntro(current, selected.block.id, value), "")
                    }
                    onLayout={(layout) =>
                      act((current) => setPanelLayout(current, selected.block.id, layout), "")
                    }
                    onOption={(option, on) =>
                      act((current) => setPanelOption(current, selected.block.id, option, on), "")
                    }
                    onToggleFilter={(filterId, offered) =>
                      act(
                        (current) => togglePanelFilter(current, selected.block.id, filterId, offered),
                        offered
                          ? "El panel ya ofrece esa característica."
                          : "El panel deja de ofrecer esa característica.",
                      )
                    }
                    onMoveFilter={(filterId, direction) =>
                      act(
                        (current) => movePanelFilter(current, selected.block.id, filterId, direction),
                        "Se movió el control dentro del panel.",
                      )
                    }
                    onTarget={(target) =>
                      act(
                        (current) => setPanelTarget(current, selected.block.id, target),
                        "Cambió lo que mueve este panel.",
                      )
                    }
                    onToggleTargetBlock={(blockId, connected) =>
                      act(
                        (current) =>
                          togglePanelTargetBlock(current, selected.block.id, blockId, connected),
                        connected
                          ? "El panel ahora mueve ese bloque."
                          : "El panel ya no mueve ese bloque.",
                      )
                    }
                  />
                ) : null
              }
              onDuplicate={() =>
                act((current) => duplicateBlock(current, selected.block.id), "Se duplicó el bloque.")
              }
              onToggle={() =>
                act(
                  (current) => setBlockVisibility(current, selected.block.id, !selected.block.visible),
                  selected.block.visible ? "El bloque queda oculto." : "El bloque vuelve a mostrarse.",
                )
              }
              onRemove={() =>
                act((current) => removeBlock(current, selected.block.id), "Se quitó el bloque.")
              }
            />
          ) : (
            <div className="rounded-xl border border-line bg-surface p-4">
              <h2 className="font-display text-sm font-semibold text-strong">Ficha del bloque</h2>
              <p className="mt-1 text-sm text-muted">
                Elige un bloque del lienzo para ver de dónde sale su número, cómo se dibuja, qué
                filtros lo mueven y qué tan ancho se ve.
              </p>
            </div>
          )}

          <div className="rounded-xl border border-line bg-surface p-4">
            <h2 className="font-display text-sm font-semibold text-strong">Esta experiencia</h2>
            <dl className="mt-2 space-y-1 text-sm text-body">
              <div className="flex justify-between gap-2">
                <dt className="text-muted">Estudio</dt>
                <dd className="min-w-0 truncate text-right">{study.name}</dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-muted">Cliente</dt>
                <dd className="min-w-0 truncate text-right">{study.clientName}</dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-muted">Personas que respondieron</dt>
                <dd>{evidence.respondents}</dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-muted">Resultados disponibles</dt>
                <dd>{registry.metrics.length}</dd>
              </div>
            </dl>
            <div className="mt-3 flex flex-wrap gap-2">
              <button type="button" className={button} onClick={download}>
                Descargar esta versión
              </button>
              <ConfirmAction
                trigger="Volver a la configuración del estudio"
                title="Volver a la configuración del estudio"
                objectName={study.name}
                severity="reversible"
                consequence={
                  <p>
                    El lienzo vuelve a la disposición que produce hoy la configuración del estudio.
                    Lo que tengas en pantalla se reemplaza.
                  </p>
                }
                recovery={
                  <p>
                    Se deshace con “Deshacer”, y el borrador guardado no cambia hasta que se
                    guarde de nuevo.
                  </p>
                }
                confirmLabel="Volver a esa disposición"
                action={() => {
                  act(
                    (current) => resetToAdapted(current, adapted),
                    "Volvió la disposición que produce la configuración del estudio.",
                  );
                }}
              />
            </div>
            <a ref={downloadRef} className="sr-only" aria-hidden="true" tabIndex={-1} href="#">
              Descarga
            </a>
          </div>
        </Panel>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// The top bar
// ---------------------------------------------------------------------------

const STATUS_TEXT: Record<SaveStatus, string> = {
  unsaved: "Sin guardar todavía",
  dirty: "Cambios sin guardar",
  saving: "Guardando…",
  saved: "Guardado",
  error: "No se pudo guardar",
  conflict: "Hay una versión más nueva",
};

const STATUS_STYLE: Record<SaveStatus, string> = {
  unsaved: "border-line bg-surface text-muted",
  dirty: "border-caution-line bg-caution-surface text-caution",
  saving: "border-evidence-line bg-evidence-surface text-evidence",
  saved: "border-positive-line bg-positive-surface text-positive",
  error: "border-danger-line bg-danger-surface text-danger",
  conflict: "border-danger-line bg-danger-surface text-danger",
};

function TopBar({
  status,
  statusMessage,
  dirty,
  revision,
  blocking,
  pages,
  blocks,
  preview,
  zoom,
  zoomAutomatic,
  onZoom,
  onPreview,
  canUndo: undoable,
  canRedo: redoable,
  onUndo,
  onRedo,
  onSave,
  onDownload,
  onToggleLeft,
  onToggleRight,
  onToggleFocus,
  onOpenDrawer,
  leftOpen,
  rightOpen,
  focusMode,
  exitHref,
  previewHref,
  draftPreviewHref,
}: {
  status: SaveStatus;
  statusMessage: string | null;
  dirty: boolean;
  revision: number | null;
  blocking: number;
  pages: number;
  blocks: number;
  preview: Breakpoint;
  zoom: CanvasZoom;
  /** True when the editor chose the scale because the width did not fit. */
  zoomAutomatic: boolean;
  onZoom: (zoom: CanvasZoom) => void;
  onPreview: (breakpoint: Breakpoint) => void;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onSave: () => void;
  onDownload: () => void;
  onToggleLeft: () => void;
  onToggleRight: () => void;
  onToggleFocus: () => void;
  onOpenDrawer: (drawer: "left" | "right") => void;
  leftOpen: boolean;
  rightOpen: boolean;
  focusMode: boolean;
  exitHref: string;
  previewHref: string;
  draftPreviewHref: string;
}) {
  return (
    <div className="min-w-0 rounded-xl border border-line bg-surface p-3 sm:p-4">
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <span
          aria-live="polite"
          className={`inline-flex min-h-11 items-center rounded-lg border px-3 py-1.5 text-sm font-medium ${STATUS_STYLE[status]}`}
        >
          {STATUS_TEXT[status]}
          {revision !== null && status === "saved" ? ` · versión ${revision}` : ""}
        </span>

        <button
          type="button"
          className={button}
          onClick={onSave}
          disabled={status === "saving" || (!dirty && status !== "error")}
        >
          Guardar ahora
        </button>
        {status === "error" ? (
          <button type="button" className={button} onClick={onSave}>
            Reintentar
          </button>
        ) : null}

        <span className="flex gap-1">
          <button
            type="button"
            className={iconButton}
            onClick={onUndo}
            disabled={!undoable}
            aria-label="Deshacer el último cambio"
            title="Deshacer (Ctrl+Z)"
          >
            ↶
          </button>
          <button
            type="button"
            className={iconButton}
            onClick={onRedo}
            disabled={!redoable}
            aria-label="Rehacer el último cambio"
            title="Rehacer (Ctrl+Mayús+Z)"
          >
            ↷
          </button>
        </span>

        {/*
          TWO PREVIEWS, TWO QUESTIONS, TWO LABELS.

          There used to be one button called "Vista del cliente", and it opened
          the client's CURRENT dashboard — which deliberately does not read a
          composed draft. That is the right behaviour for that page and the
          wrong thing to offer here: it implied the client's screen should
          already contain the edits, so every honest answer it gave looked like
          a bug. The two questions are now asked separately and neither label
          suggests the other's answer.
        */}
        <span className="ml-auto flex flex-wrap gap-2">
          <Link href={draftPreviewHref} className={button}>
            Vista previa del borrador
          </Link>
          <Link href={previewHref} className={button} title="Lo que el cliente ve hoy, sin tus cambios">
            Ver versión actualmente publicada
          </Link>
          <Link href={exitHref} className={button}>
            Salir
          </Link>
        </span>
      </div>

      {statusMessage && status === "error" ? (
        <p className="mt-2 text-sm text-danger">{statusMessage}</p>
      ) : null}

      <div className="mt-3 flex min-w-0 flex-wrap items-center gap-2 border-t border-line pt-3">
        {/* Panel controls: a toggle on a computer, a drawer opener below it. */}
        <button
          type="button"
          className={`${button} hidden lg:inline-flex`}
          onClick={onToggleLeft}
          aria-pressed={leftOpen}
          aria-label={
            leftOpen
              ? "Ocultar el panel de páginas y catálogo de bloques"
              : "Mostrar el panel de páginas y catálogo de bloques"
          }
        >
          {leftOpen ? "Ocultar páginas" : "Mostrar páginas"}
        </button>
        <button
          type="button"
          className={`${button} hidden xl:inline-flex`}
          onClick={onToggleRight}
          aria-pressed={rightOpen}
          aria-label={
            rightOpen
              ? "Ocultar la ficha del bloque seleccionado"
              : "Mostrar la ficha del bloque seleccionado"
          }
        >
          {rightOpen ? "Ocultar ficha" : "Mostrar ficha"}
        </button>
        {/*
          MODO ENFOQUE — one act, both panels, and the toolbar stays.

          Hiding two panels one at a time and then putting them both back is
          four decisions for one intention. This is the intention. The toolbar
          is deliberately still here while it is on: a mode you can only leave
          by guessing a key is a trap, so there is a labelled way out on screen
          AND `Escape` for a hand already on the keyboard.
        */}
        <button
          type="button"
          className={`${button} hidden lg:inline-flex`}
          onClick={onToggleFocus}
          aria-pressed={focusMode}
        >
          {focusMode ? "Salir de modo enfoque" : "Modo enfoque"}
        </button>
        <button type="button" className={`${button} lg:hidden`} onClick={() => onOpenDrawer("left")}>
          Páginas y bloques
        </button>
        <button type="button" className={`${button} xl:hidden`} onClick={() => onOpenDrawer("right")}>
          Ficha del bloque
        </button>
        <button type="button" className={button} onClick={onDownload}>
          Descargar
        </button>

        <fieldset className="ml-auto min-w-0">
          <legend className="sr-only">Ver la página como se vería en</legend>
          <div className="flex flex-wrap gap-1">
            {BREAKPOINTS.map((breakpoint) => (
              <button
                key={breakpoint}
                type="button"
                aria-pressed={preview === breakpoint}
                onClick={() => onPreview(breakpoint)}
                className={`inline-flex min-h-11 items-center rounded-lg border px-2.5 py-1.5 text-xs font-medium ${
                  preview === breakpoint
                    ? "border-evidence-line bg-evidence-surface text-evidence"
                    : "border-line bg-surface text-body hover:bg-surface-sunken"
                }`}
              >
                {BREAKPOINT_LABEL[breakpoint]}
                <span className="hidden sm:inline">&nbsp;({BREAKPOINT_WIDTHS[breakpoint]} px)</span>
              </button>
            ))}
          </div>
        </fieldset>

        {/*
          ZOOM, beside the width it applies to.

          The canvas draws each breakpoint at its real width and scrolls
          sideways inside its own box when there is not room. That keeps a
          three-column block three columns wide instead of an unreadable
          strip — and this is how somebody sees the whole arrangement at once
          when that is the question they have.
        */}
        <label className="hidden min-h-11 items-center gap-1.5 text-xs text-body lg:flex">
          <span>Escala</span>
          <select
            data-canvas-scale={zoomAutomatic ? "automatic" : "chosen"}
            value={String(zoom)}
            onChange={(event) =>
              onZoom(event.target.value === "fit" ? "fit" : (Number(event.target.value) as 1 | 0.75 | 0.5))
            }
            className="min-h-11 rounded-lg border border-line bg-surface px-2 py-1.5 text-xs text-strong"
          >
            <option value="fit">Ajustar al espacio</option>
            <option value="1">100 %</option>
            <option value="0.75">75 %</option>
            <option value="0.5">50 %</option>
          </select>
          {/*
            The control shows what is IN EFFECT, including when the editor
            chose it. A select reading "100 %" over a canvas drawn at 62 % is a
            control that lies, and the first thing somebody does with a lying
            control is stop trusting it.
          */}
          {zoomAutomatic ? (
            <span className="text-muted">automática</span>
          ) : null}
        </label>
      </div>

      <p className="mt-2 text-xs text-muted">
        {pages === 1 ? "1 página" : `${pages} páginas`} · {blocks === 1 ? "1 bloque" : `${blocks} bloques`} ·{" "}
        {blocking > 0
          ? "hay algo que impediría guardar esta experiencia"
          : "la experiencia es válida tal como está"}
        {" · "}
        el cliente todavía no ve nada de esto
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// The side panels — a column on a computer, a drawer on a narrow screen
// ---------------------------------------------------------------------------

function Panel({
  side,
  label,
  open,
  drawerOpen,
  onClose,
  onCollapse,
  collapseLabel,
  children,
}: {
  side: "left" | "right";
  label: string;
  open: boolean;
  drawerOpen: boolean;
  onClose: () => void;
  /** Collapse THIS panel, from its own inner edge. It never touches the other. */
  onCollapse: () => void;
  collapseLabel: string;
  children: React.ReactNode;
}) {
  useEffect(() => {
    if (!drawerOpen) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [drawerOpen, onClose]);

  // ONE element, two behaviours: a fixed drawer while it is narrow, a static
  // column once there is room. Rendering it twice would give the same controls
  // two sets of ids, which is exactly what the responsive acceptance pass
  // refuses.
  //
  // THE TWO SIDES DOCK AT DIFFERENT WIDTHS, and that is the whole point. Two
  // 288 px panels either side of a 1024 px screen leave 400 px of canvas, and a
  // three-column block inside 400 px is 49 px wide — the acceptance matrix
  // measured a KPI clipping its own number there. The canvas is the thing being
  // built, so it keeps the room: the pages dock at `lg`, the inspector waits
  // until `xl`, and below that each is a drawer over the canvas rather than a
  // column beside it.
  /*
   * `relative`, NOT `static`, ONCE IT IS A COLUMN — and that is a bug fix, not
   * a preference.
   *
   * The collapse rail is `absolute -right-4`, which means "sixteen units past
   * my containing block's edge". A statically positioned panel is not a
   * containing block, so the rail resolved against the VIEWPORT instead and was
   * drawn sixteen pixels off the right edge of the window: pinned to the wrong
   * side of the screen, and pushing the document into a horizontal scroll on
   * its way. `relative` lays out identically for a grid item and gives the rail
   * the edge it was written against.
   */
  const dock = side === "left"
    ? { column: open ? "lg:flex" : "lg:hidden", header: "lg:hidden", chrome: "lg:relative lg:z-auto lg:w-64 lg:border-0 lg:bg-transparent lg:p-0 lg:shadow-none xl:w-72" }
    : { column: open ? "xl:flex" : "xl:hidden", header: "xl:hidden", chrome: "xl:relative xl:z-auto xl:w-80 xl:border-0 xl:bg-transparent xl:p-0 xl:shadow-none" };

  /*
   * THE COLLAPSE RAIL, ON THE PANEL'S OWN INNER EDGE.
   *
   * The toolbar can already hide either panel and it stays. This is the same
   * act put where the hand already is: a slim strip along the edge where the
   * panel meets the canvas, carrying a real `<button>` so it is reachable by
   * keyboard, focusable in order and announced by name. A double-click on the
   * strip does the same thing — an accelerator for people who expect one from
   * an editor, never the only way in.
   *
   * `select-none` on both, because a double-click that selects the label
   * underneath it instead of collapsing the panel is the classic failure of
   * this pattern, and `draggable={false}` so the gesture can never be read as
   * the beginning of a drag.
   *
   * IT EXISTS ONLY WHERE THE PANEL IS A COLUMN. Below that width the panel is
   * a drawer with its own close button and its own toolbar opener; a 6 px edge
   * strip on a phone is a target nobody can hit, which is why the mobile route
   * is an explicit button and not this.
   */
  const rail = (
    <div
      className={`pointer-events-none absolute inset-y-0 z-20 hidden w-6 items-center justify-center ${
        side === "left" ? "-right-4 lg:flex" : "-left-4 xl:flex"
      }`}
    >
      <div
        onDoubleClick={onCollapse}
        draggable={false}
        data-collapse-rail={side}
        title={`${collapseLabel} · doble clic en la guía`}
        className="pointer-events-auto flex h-full w-1.5 select-none items-center justify-center rounded-full bg-line transition-colors duration-[var(--motion-state)] hover:bg-line-strong"
      >
        {/*
          `shrink-0`, BECAUSE THE STRIP IT SITS IN IS SIX PIXELS WIDE.
          Without it the flex parent squeezed this button down to the width of
          the guide line — a 6 px target, which is no target at all. It keeps
          its 24 x 44 and overhangs the guide, which is what the 24 px rail
          around it is for.

          TWENTY-FOUR WIDE, NOT FORTY-FOUR: it lives in the 16 px seam between
          the panel and the canvas, and the same act has a full-size labelled
          button in the toolbar ("Ocultar páginas" / "Ocultar ficha"). It is an
          accelerator with an equivalent elsewhere on the page, never the only
          way to do this.
        */}
        <button
          type="button"
          onClick={onCollapse}
          draggable={false}
          data-rail-control={side}
          aria-label={collapseLabel}
          title={collapseLabel}
          className="pointer-events-auto flex min-h-11 w-6 shrink-0 select-none items-center justify-center rounded-md border border-line-strong bg-surface text-xs font-semibold text-strong transition-colors duration-[var(--motion-state)] hover:bg-surface-sunken"
        >
          <span aria-hidden="true">{side === "left" ? "‹" : "›"}</span>
        </button>
      </div>
    </div>
  );

  return (
    <aside
      aria-label={label}
      className={[
        drawerOpen ? "flex" : "hidden",
        dock.column,
        "fixed inset-y-0 z-40 w-[min(22rem,88vw)] flex-col gap-4 overflow-y-auto border-line bg-surface-page p-4 shadow-lifted",
        side === "left" ? "left-0 border-r" : "right-0 border-l",
        // The rail is positioned against the panel, so the panel has to be the
        // containing block once it is a column. While it is a fixed drawer it
        // already establishes one, and the rail is hidden there anyway. Both
        // are handled by `dock.chrome`, at each side's own docking width — a
        // blanket `lg:relative` here would have made the inspector a containing
        // block 256 px before it becomes a column.
        dock.chrome,
      ].join(" ")}
    >
      <div className={`flex items-center justify-between ${dock.header}`}>
        <p className="font-display text-sm font-semibold text-strong">{label}</p>
        <button type="button" className={iconButton} onClick={onClose} aria-label="Cerrar el panel">
          ✕
        </button>
      </div>
      {children}
      {rail}
    </aside>
  );
}

// ---------------------------------------------------------------------------
// Pages
// ---------------------------------------------------------------------------

function PagesPanel({
  idPrefix,
  definition,
  openPageId,
  newPageTitle,
  onNewPageTitle,
  onOpen,
  onAddPage,
  onMovePage,
  onDuplicatePage,
  onRenamePage,
  onTogglePage,
  onRemovePage,
}: {
  idPrefix: string;
  definition: ExperienceDefinitionV1;
  openPageId: string | null;
  newPageTitle: string;
  onNewPageTitle: (value: string) => void;
  onOpen: (pageId: string) => void;
  onAddPage: () => void;
  onMovePage: (pageId: string, direction: "up" | "down") => void;
  onDuplicatePage: (pageId: string) => void;
  onRenamePage: (pageId: string, title: string) => void;
  onTogglePage: (pageId: string, visible: boolean) => void;
  onRemovePage: (pageId: string) => void;
}) {
  return (
    <nav aria-label="Páginas de la experiencia" className="rounded-xl border border-line bg-surface p-3">
      <h2 className="px-1 font-display text-sm font-semibold text-strong">Páginas</h2>
      <ul className="mt-2 space-y-1">
        {definition.pages.map((entry, index) => (
          <li key={entry.id} className="flex min-w-0 items-center gap-1">
            <button
              type="button"
              aria-current={entry.id === openPageId ? "page" : undefined}
              onClick={() => onOpen(entry.id)}
              className={`flex min-h-11 min-w-0 flex-1 items-center justify-between gap-2 rounded-lg px-3 py-2 text-left text-sm ${
                entry.id === openPageId
                  ? "bg-evidence-surface font-semibold text-evidence"
                  : "text-body hover:bg-surface-sunken"
              }`}
            >
              <span className="min-w-0 truncate">
                {entry.title}
                {entry.visible ? "" : " · oculta"}
              </span>
              <span className="shrink-0 text-xs text-muted">{entry.blocks.length}</span>
            </button>
            <Menu label={`Acciones de la página “${entry.title}”`}>
              <button
                type="button"
                className={menuItem}
                disabled={index === 0}
                onClick={() => onMovePage(entry.id, "up")}
              >
                Subir
              </button>
              <button
                type="button"
                className={menuItem}
                disabled={index === definition.pages.length - 1}
                onClick={() => onMovePage(entry.id, "down")}
              >
                Bajar
              </button>
              <button type="button" className={menuItem} onClick={() => onDuplicatePage(entry.id)}>
                Duplicar
              </button>
              <button
                type="button"
                className={menuItem}
                onClick={() => onTogglePage(entry.id, !entry.visible)}
              >
                {entry.visible ? "Ocultar" : "Mostrar"}
              </button>
              <ConfirmAction
                trigger="Quitar"
                triggerClassName={menuItem}
                title="Quitar la página"
                objectName={entry.title}
                severity="reversible"
                consequence={
                  <p>
                    Se quitan la página y sus {entry.blocks.length} bloque(s). Los filtros que solo
                    vivían en ella se van con ella.
                  </p>
                }
                recovery={<p>Se deshace con “Deshacer” mientras no cierres la pestaña.</p>}
                confirmLabel="Quitar la página"
                action={() => onRemovePage(entry.id)}
              />
            </Menu>
          </li>
        ))}
      </ul>

      {openPageId ? (
        <div className="mt-3 border-t border-line px-1 pt-3">
          <label htmlFor={`${idPrefix}-rename`} className="block text-xs font-medium text-strong">
            Nombre de la página abierta
          </label>
          <input
            id={`${idPrefix}-rename`}
            className={`${field} mt-1`}
            value={definition.pages.find((entry) => entry.id === openPageId)?.title ?? ""}
            onChange={(event) => onRenamePage(openPageId, event.target.value)}
          />
        </div>
      ) : null}

      <div className="mt-3 border-t border-line px-1 pt-3">
        <label htmlFor={`${idPrefix}-newpage`} className="block text-xs font-medium text-strong">
          Añadir una página
        </label>
        <input
          id={`${idPrefix}-newpage`}
          className={`${field} mt-1`}
          value={newPageTitle}
          placeholder="Cómo se llama"
          onChange={(event) => onNewPageTitle(event.target.value)}
        />
        <button
          type="button"
          className={`${button} mt-2 w-full`}
          onClick={onAddPage}
          disabled={newPageTitle.trim() === ""}
        >
          Añadir página
        </button>
      </div>
    </nav>
  );
}

function CataloguePanel({
  idPrefix,
  page,
  catalogue,
  pendingType,
  onPendingType,
  onAdd,
}: {
  idPrefix: string;
  page: ExperiencePage;
  catalogue: { group: string; label: string; blocks: { id: BlockType; label: string; description: string }[] }[];
  pendingType: BlockType;
  onPendingType: (type: BlockType) => void;
  onAdd: () => void;
}) {
  return (
    <div className="rounded-xl border border-line bg-surface p-3">
      <h2 className="px-1 font-display text-sm font-semibold text-strong">Catálogo de bloques</h2>
      <p className="mt-1 px-1 text-xs text-muted">
        Solo aparecen los que este estudio puede sostener con los resultados que tiene.
      </p>
      <div className="mt-2 px-1">
        <label htmlFor={`${idPrefix}-add`} className="block text-sm font-medium text-strong">
          Añadir a “{page.title}”
        </label>
        <select
          id={`${idPrefix}-add`}
          value={pendingType}
          onChange={(event) => onPendingType(event.target.value as BlockType)}
          className={`${field} mt-1`}
        >
          {catalogue.map((group) => (
            <optgroup key={group.group} label={group.label}>
              {group.blocks.map((spec) => (
                <option key={spec.id} value={spec.id}>
                  {spec.label}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
        <p className="mt-1 text-xs text-muted">{blockSpec(pendingType).description}</p>
        <button type="button" className={`${button} mt-2 w-full`} onClick={onAdd}>
          Añadir bloque
        </button>
      </div>
    </div>
  );
}

function SamplePolicyPanel({
  idPrefix,
  mode,
  threshold,
  onMode,
  onThreshold,
}: {
  idPrefix: string;
  mode: SamplePolicyMode;
  threshold: number;
  onMode: (mode: SamplePolicyMode) => void;
  onThreshold: (threshold: number) => void;
}) {
  return (
    <section className="rounded-xl border border-line bg-surface p-3">
      <h2 className="px-1 font-display text-sm font-semibold text-strong">
        Cuándo se muestra un resultado con pocas respuestas
      </h2>
      <p className="mt-1 px-1 text-xs text-muted">
        Esta regla vale para todo el estudio. Un bloque puede tener la suya propia, y en ese caso
        manda la del bloque.
      </p>
      <fieldset className="mt-2 px-1">
        <legend className="sr-only">Regla del estudio</legend>
        <div className="space-y-2">
          {SAMPLE_POLICY_MODES.map((candidate) => (
            <label
              key={candidate}
              className={`flex min-h-11 cursor-pointer items-start gap-3 rounded-lg border p-2.5 ${
                mode === candidate
                  ? "border-evidence-line bg-evidence-surface"
                  : "border-line bg-surface hover:bg-surface-sunken"
              }`}
            >
              <input
                type="radio"
                name={`${idPrefix}-policy`}
                className="mt-1 h-4 w-4 shrink-0"
                checked={mode === candidate}
                onChange={() => onMode(candidate)}
              />
              <span className="min-w-0">
                <span className="block text-sm font-medium text-strong">{MODE_LABEL[candidate]}</span>
                <span className="mt-0.5 block text-xs text-muted">{MODE_DETAIL[candidate]}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>
      {mode !== "show_all" ? (
        <div className="mt-2 px-1">
          <label htmlFor={`${idPrefix}-threshold`} className="block text-xs font-medium text-strong">
            Mínimo de respuestas
          </label>
          <input
            id={`${idPrefix}-threshold`}
            type="number"
            min={1}
            max={1000}
            className={`${field} mt-1`}
            value={threshold}
            onChange={(event) => onThreshold(Number(event.target.value))}
          />
        </div>
      ) : null}
    </section>
  );
}

// ---------------------------------------------------------------------------
// A compact menu
// ---------------------------------------------------------------------------

/**
 * The menu that holds everything a block card does not show all the time.
 *
 * IT DOES NOT EXIST UNTIL IT IS OPENED. The first version was a `<details>`,
 * which is keyboard-operable for free — and whose closed contents are still
 * laid out: the rendered acceptance matrix measured a 224 px panel hanging
 * 29 px off the left of a 320 px screen, from a menu nobody had opened. A
 * control that is not on screen should not have a position on screen, so the
 * panel is conditionally rendered instead.
 *
 * What `<details>` gave for free is written out here: the trigger says whether
 * it is expanded, Escape closes it and returns focus to the trigger, clicking
 * anywhere else closes it, and choosing an item closes it too — because a menu
 * that stays open over the thing it just changed hides the result of the
 * choice.
 */
function Menu({
  label,
  children,
  triggerStyle,
}: {
  label: string;
  children: React.ReactNode;
  /** Set on the canvas, where a scaled transform would otherwise shrink it. */
  triggerStyle?: React.CSSProperties;
}) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setOpen(false);
      triggerRef.current?.focus();
    }
    function onPointerDown(event: MouseEvent) {
      const target = event.target as Node;
      if (panelRef.current?.contains(target) || triggerRef.current?.contains(target)) return;
      setOpen(false);
    }
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("mousedown", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("mousedown", onPointerDown);
    };
  }, [open]);

  return (
    <div className="relative shrink-0">
      <button
        ref={triggerRef}
        type="button"
        aria-label={label}
        aria-expanded={open}
        aria-haspopup="menu"
        style={triggerStyle}
        className={iconButton}
        onClick={() => setOpen((current) => !current)}
      >
        <span aria-hidden="true">⋯</span>
      </button>
      {open ? (
        <div
          ref={panelRef}
          role="menu"
          aria-label={label}
          // Anchored to the trigger's right edge and never wider than the
          // screen it is opening on.
          className="absolute right-0 z-20 mt-1 w-56 max-w-[calc(100vw-2rem)] rounded-lg border border-line bg-surface p-1 shadow-lifted"
          onClick={() => setOpen(false)}
        >
          {children}
        </div>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// The canvas
// ---------------------------------------------------------------------------

function Canvas({
  page,
  definition,
  registry,
  data,
  evidence,
  study,
  breakpoint,
  zoom,
  onRoom,
  selectedBlockId,
  onSelect,
  onMove,
  onDrop,
  onDuplicate,
  onToggle,
  onRemove,
}: {
  page: ExperiencePage;
  definition: ExperienceDefinitionV1;
  registry: SemanticRegistry;
  data: BlockDataSet;
  evidence: BuilderClientPayload["evidence"];
  study: BuilderClientPayload["study"];
  breakpoint: Breakpoint;
  zoom: CanvasZoom;
  /**
   * How much room the canvas actually has, reported up so the editor can
   * decide whether the previewed width fits. Only measurement can answer that:
   * the room depends on which panels are open, which is a preference rather
   * than a breakpoint.
   */
  onRoom: (width: number) => void;
  selectedBlockId: string | null;
  onSelect: (blockId: string) => void;
  onMove: (blockId: string, direction: "up" | "down") => void;
  onDrop: (blockId: string, index: number) => void;
  onDuplicate: (blockId: string) => void;
  onToggle: (blockId: string, visible: boolean) => void;
  onRemove: (blockId: string) => void;
}) {
  const [dragging, setDragging] = useState<string | null>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);

  /*
   * THE CANVAS MEASURES THE ROOM IT HAS AND USES IT.
   *
   * Before, the grid was laid out at the previewed width and scrolled sideways
   * whatever the room; hiding a panel therefore revealed gutter rather than
   * making the composition bigger, and at 1 024 px a "computer" preview was a
   * long horizontal scroll of something nobody could see the shape of. It now
   * observes its own container and, at "Ajustar", draws the whole previewed
   * width inside whatever space it has — which is what makes hiding a panel a
   * real reflow instead of a wider empty column.
   *
   * WHY A ResizeObserver AND NOT A BREAKPOINT. The room the canvas has is not
   * a function of the viewport: it depends on which panels are open, which is
   * a preference. Only measuring answers it.
   */
  const [available, setAvailable] = useState(0);
  const [contentHeight, setContentHeight] = useState(0);

  /*
   * MEASURED THROUGH CALLBACK REFS, NOT THROUGH AN EFFECT.
   *
   * An empty page draws no frame at all, so an effect that reads
   * `frameRef.current` on mount found `null`, returned, and — with an empty
   * dependency list — never ran again. Add the first block to that page and
   * the frame appears unmeasured: `available` stays 0, and "Ajustar al
   * espacio" silently does nothing for the rest of the session. A person
   * chooses the fit, watches nothing happen, and reasonably concludes the
   * control is broken.
   *
   * A callback ref is called with the node the moment it exists and with
   * `null` when it goes away, which is exactly the event being waited for.
   */
  const frameObserver = useRef<ResizeObserver | null>(null);
  const measureFrame = useCallback(
    (node: HTMLDivElement | null) => {
      frameObserver.current?.disconnect();
      frameObserver.current = null;
      if (!node) {
        setAvailable(0);
        onRoom(0);
        return;
      }
      setAvailable(node.clientWidth);
      onRoom(node.clientWidth);
      if (typeof ResizeObserver === "undefined") return;
      const observer = new ResizeObserver((entries) => {
        for (const entry of entries) {
          setAvailable(entry.contentRect.width);
          onRoom(entry.contentRect.width);
        }
      });
      observer.observe(node);
      frameObserver.current = observer;
    },
    [onRoom],
  );

  const contentObserver = useRef<ResizeObserver | null>(null);
  const measureContent = useCallback((node: HTMLDivElement | null) => {
    contentObserver.current?.disconnect();
    contentObserver.current = null;
    if (!node) {
      setContentHeight(0);
      return;
    }
    setContentHeight(node.getBoundingClientRect().height);
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) setContentHeight(entry.contentRect.height);
    });
    observer.observe(node);
    contentObserver.current = observer;
  }, []);

  const canvasWidth = CANVAS_WIDTH[breakpoint];
  const scalable = useSyncExternalStore(subscribeScalable, readScalable, serverScalable);
  const scale = !scalable
    ? 1
    : zoom === "fit"
      ? available > 0
        ? Math.min(1, Math.max(MINIMUM_FIT_SCALE, available / canvasWidth))
        : 1
      : zoom;

  const ordered = page.blocks
    .map((block, index) => ({ block, index }))
    .sort((a, b) => {
      const byOrder = a.block.layout[breakpoint].order - b.block.layout[breakpoint].order;
      return byOrder !== 0 ? byOrder : a.index - b.index;
    });

  return (
    <section className="min-w-0 rounded-xl border border-line bg-surface-sunken p-3 sm:p-4">
      <div className="flex min-w-0 flex-wrap items-baseline justify-between gap-2">
        <h2 className="min-w-0 truncate font-display text-base font-semibold text-strong">
          {page.title}
        </h2>
        <p className="text-xs text-muted">
          {BREAKPOINT_LABEL[breakpoint]} ·{" "}
          {page.blocks.length === 1 ? "1 bloque" : `${page.blocks.length} bloques`}
        </p>
      </div>
      <p className="mt-1 text-xs text-muted">
        Los números son los del estudio, calculados con el mismo motor que el panel del cliente.
      </p>

      {page.blocks.length === 0 ? (
        <p className="mt-3 rounded-lg border border-dashed border-line bg-surface px-4 py-6 text-sm text-muted">
          Esta página todavía no tiene bloques. Añade uno desde el catálogo.
        </p>
      ) : (
        /*
          THE CANVAS KEEPS THE WIDTH IT IS PRETENDING TO BE.

          A twelve-column grid squeezed into whatever space is left between two
          panels is not a preview of a 1 280 px screen: four "full" columns
          became unreadable 90 px strips, and a KPI clipped its own number. The
          grid is now laid out at the width of the breakpoint being previewed
          and SCROLLS SIDEWAYS INSIDE ITS OWN BOX when there is not room for it
          — the page itself never scrolls sideways, which the acceptance matrix
          checks at every width. The zoom above is for seeing the whole
          arrangement at once; the scroll is for reading it at full size.
        */
        <div ref={measureFrame} className="mt-3 min-w-0 overflow-x-auto">
          {/*
            TWO BOXES, AND BOTH ARE NEEDED.

            `transform: scale()` does not change LAYOUT, so a scaled grid used
            to leave the scroll container claiming the unscaled width and a
            stripe of empty space below it. The outer box is the SIZE the
            scaled drawing actually occupies, measured; the inner one is the
            previewed width, drawn at full size and then scaled into it.

            Drag and drop stays correct under any scale because both
            `getBoundingClientRect()` and a pointer's `clientY` are in the same
            transformed viewport space — the comparison that decides a drop
            position never leaves that space, so it never needs to know the
            scale at all.
          */}
          <div
            style={{
              width: `${canvasWidth * scale}px`,
              height: contentHeight > 0 ? `${contentHeight * scale}px` : undefined,
            }}
          >
            <div
              ref={measureContent}
              /*
                `--canvas-scale` IS WHY SCALING NO LONGER SHRINKS A TARGET.
                
                `transform: scale()` shrinks everything inside it, the editor's
                own controls included: at 0.4 a 44 px handle measures 18 px, and
                an 18 px target is not a target. The block chrome therefore
                sizes itself as `44px / var(--canvas-scale)` — bigger in CANVAS
                coordinates by exactly the factor the transform will shrink it
                by, so what a finger or a pointer meets on screen is 44 px at
                every scale. The DRAWING inside still scales, which is the whole
                point of a preview.
              */
              style={
                {
                  width: `${canvasWidth}px`,
                  transform: scale === 1 ? undefined : `scale(${scale})`,
                  transformOrigin: "top left",
                  "--canvas-scale": String(scale),
                } as React.CSSProperties
              }
            >
        <ul className="grid min-w-0 grid-cols-12 gap-3">
          {ordered.map(({ block }, position) => (
            <li
              key={block.id}
              draggable
              onDragStart={(event) => {
                setDragging(block.id);
                event.dataTransfer.effectAllowed = "move";
                event.dataTransfer.setData("text/plain", block.id);
              }}
              onDragEnd={() => {
                setDragging(null);
                setDropIndex(null);
              }}
              onDragOver={(event) => {
                if (!dragging || dragging === block.id) return;
                event.preventDefault();
                const box = event.currentTarget.getBoundingClientRect();
                const after = event.clientY - box.top > box.height / 2;
                setDropIndex(position + (after ? 1 : 0));
              }}
              onDrop={(event) => {
                event.preventDefault();
                const moved = dragging ?? event.dataTransfer.getData("text/plain");
                if (!moved) return;
                const from = ordered.findIndex((entry) => entry.block.id === moved);
                const raw = dropIndex ?? position;
                onDrop(moved, from >= 0 && from < raw ? raw - 1 : raw);
                setDragging(null);
                setDropIndex(null);
              }}
              className={`${responsiveSpanClass(block.layout[breakpoint].span)} min-w-0 ${
                dropIndex === position ? "border-t-2 border-evidence-line pt-1" : ""
              }`}
            >
              <CanvasBlock
                block={block}
                definition={definition}
                registry={registry}
                data={data}
                evidence={evidence}
                study={study}
                breakpoint={breakpoint}
                selected={block.id === selectedBlockId}
                first={position === 0}
                last={position === ordered.length - 1}
                dragging={dragging === block.id}
                onSelect={() => onSelect(block.id)}
                onMove={(direction) => onMove(block.id, direction)}
                onDuplicate={() => onDuplicate(block.id)}
                onToggle={() => onToggle(block.id, !block.visible)}
                onRemove={() => onRemove(block.id)}
              />
            </li>
          ))}
        </ul>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

/**
 * The width each previewed breakpoint is drawn at.
 *
 * Not the breakpoint's own number for the desktop case: 1 280 is the width of
 * the WINDOW, and the canvas sits inside a shell with padding and up to two
 * panels. 1 120 is what a 1 280 px browser actually gives the content, so the
 * proportions on screen are the proportions a client will see.
 */
const CANVAS_WIDTH: Record<Breakpoint, number> = {
  desktop: 1120,
  tablet: 720,
  mobile: 360,
};

/**
 * A 44 x 44 target, expressed in CANVAS coordinates.
 *
 * The canvas may be drawn under a `scale()` transform, which shrinks physical
 * size. Dividing by `--canvas-scale` makes the box bigger in the transformed
 * coordinate space by exactly the factor the transform will shrink it by, so
 * the result on screen is 44 px whatever the scale. The fallback of 1 means an
 * unscaled canvas — and any context that never sets the variable — gets plain
 * 44 px.
 */
const COMPENSATED_TARGET: React.CSSProperties = {
  minHeight: "calc(2.75rem / var(--canvas-scale, 1))",
  minWidth: "calc(2.75rem / var(--canvas-scale, 1))",
};

function CanvasBlock({
  block,
  definition,
  registry,
  data,
  evidence,
  study,
  breakpoint,
  selected,
  first,
  last,
  dragging,
  onSelect,
  onMove,
  onDuplicate,
  onToggle,
  onRemove,
}: {
  block: ExperienceBlock;
  definition: ExperienceDefinitionV1;
  registry: SemanticRegistry;
  data: BlockDataSet;
  evidence: BuilderClientPayload["evidence"];
  study: BuilderClientPayload["study"];
  breakpoint: Breakpoint;
  selected: boolean;
  first: boolean;
  last: boolean;
  dragging: boolean;
  onSelect: () => void;
  onMove: (direction: "up" | "down") => void;
  onDuplicate: () => void;
  onToggle: () => void;
  onRemove: () => void;
}) {
  const spec = blockSpec(block.type as BlockType);
  const name = block.title ?? spec.label;
  const hidden = !block.visible || !block.layout[breakpoint].visible;

  return (
    <div
      // The block's OPAQUE identifier, which is already what the exported
      // document and every filter connection name. It is not a metric key, a
      // column or a respondent, and having it on the card is what lets a gate
      // drive "select THAT block" instead of guessing at a class name.
      data-block-id={block.id}
      data-block-type={block.type}
      className={`flex h-full min-w-0 flex-col rounded-lg border bg-surface ${
        selected ? "border-evidence-line ring-2 ring-evidence-line" : "border-line"
      } ${dragging ? "opacity-60" : ""}`}
    >
      {/*
        The card header wraps rather than crushing its middle. A narrow block —
        three of twelve columns on a 1 280 px screen — left the name button
        8 px wide between two 44 px controls, and an 8 px target is not a
        target. With `flex-wrap` and a real minimum, the name drops to its own
        line instead.
      */}
      <div className="flex min-w-0 flex-wrap items-center gap-1 border-b border-line px-2 py-1.5">
        {/*
          THE DRAG HANDLE, and the keyboard route through the same control. A
          pointer drags it; the arrow keys move the block while it has focus.
          Both are announced in its accessible name, because a handle whose
          keyboard behaviour is undiscoverable is a handle only a mouse user has.
        */}
        <button
          type="button"
          aria-label={`Mover “${name}”. Usa las flechas arriba y abajo, o arrastra.`}
          title="Arrastra, o usa las flechas ↑ ↓"
          style={COMPENSATED_TARGET}
          className="flex cursor-grab items-center justify-center rounded-md text-muted hover:bg-surface-sunken active:cursor-grabbing"
          onKeyDown={(event) => {
            if (event.key === "ArrowUp") {
              event.preventDefault();
              onMove("up");
            } else if (event.key === "ArrowDown") {
              event.preventDefault();
              onMove("down");
            }
          }}
        >
          <span aria-hidden="true">⠿</span>
        </button>

        <button
          type="button"
          data-block-select=""
          onClick={onSelect}
          aria-current={selected ? "true" : undefined}
          style={COMPENSATED_TARGET}
          className="flex flex-1 basis-24 flex-col justify-center rounded-md px-1 text-left"
        >
          <span className="block truncate text-sm font-semibold text-strong">{name}</span>
          <span className="block truncate text-xs text-muted">
            {spec.label} · {block.layout[breakpoint].span} de {GRID_COLUMNS}
            {hidden ? " · oculto" : ""}
          </span>
        </button>

        <Menu label={`Acciones de “${name}”`} triggerStyle={COMPENSATED_TARGET}>
          <button type="button" className={menuItem} onClick={onSelect}>
            Abrir su ficha
          </button>
          <button type="button" className={menuItem} disabled={first} onClick={() => onMove("up")}>
            Subir
          </button>
          <button type="button" className={menuItem} disabled={last} onClick={() => onMove("down")}>
            Bajar
          </button>
          <button type="button" className={menuItem} onClick={onDuplicate}>
            Duplicar
          </button>
          <button type="button" className={menuItem} onClick={onToggle}>
            {block.visible ? "Ocultar" : "Mostrar"}
          </button>
          <ConfirmAction
            trigger="Quitar"
            triggerClassName={menuItem}
            title="Quitar el bloque"
            objectName={name}
            severity="reversible"
            consequence={
              <p>
                Se quita de la página. Los filtros que solo lo movían a él dejan de existir, para
                que no queden apuntando a nada.
              </p>
            }
            recovery={<p>Se deshace con “Deshacer” mientras no cierres la pestaña.</p>}
            confirmLabel="Quitar el bloque"
            action={() => onRemove()}
          />
        </Menu>
      </div>

      <div className={`min-w-0 flex-1 px-3 py-2.5 ${hidden ? "opacity-45" : ""}`}>
        <BlockView
          block={block}
          definition={definition}
          registry={registry}
          data={data}
          evidence={evidence}
          study={study}
        />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// The inspector
// ---------------------------------------------------------------------------

function Inspector({
  idPrefix,
  block,
  pageTitle,
  definition,
  registry,
  onTitle,
  onCopy,
  onVariant,
  onMetric,
  onAggregation,
  onDimension,
  onSpan,
  onSamplePolicy,
  onJourney,
  onBandScheme,
  onPalette,
  onThemeCloud,
  qualitativeSources,
  onOpenPanel,
  onDisconnectSource,
  panelCard,
  onDuplicate,
  onToggle,
  onRemove,
}: {
  idPrefix: string;
  block: ExperienceBlock;
  pageTitle: string;
  definition: ExperienceDefinitionV1;
  registry: SemanticRegistry;
  onTitle: (value: string) => void;
  onCopy: (field: "eyebrow" | "body" | "caption", value: string) => void;
  onVariant: (variant: ChartVariant) => void;
  onMetric: (metricId: string) => void;
  onAggregation: (aggregation: Aggregation) => void;
  onDimension: (slot: "primary" | "secondary", dimensionId: string | null) => void;
  onSpan: (breakpoint: Breakpoint, span: number) => void;
  onSamplePolicy: (override: { kind: "inherit" } | { kind: "override"; policy: { policyVersion: 1; mode: SamplePolicyMode; threshold: number } }) => void;
  /** Which recorrido a journey block is a window onto. */
  onJourney: (journeyId: string) => void;
  /** Which semáforo this block reads, when it is drawn as one. */
  onBandScheme: (schemeId: string | null) => void;
  /** The palette a scaled drawing reads its colours from. */
  onPalette: (palette: ChartPalette) => void;
  /** One or more of a cloud's own settings. */
  onThemeCloud: (patch: Partial<ThemeCloudConfig>) => void;
  /** The qualitative sources this study actually has, for the cloud's picker. */
  qualitativeSources: string[];
  /** Select the panel that governs this block, so it can be edited there. */
  onOpenPanel: (pageId: string, panelId: string) => void;
  /** Stop one source moving this block: a panel target, or a direct connection. */
  onDisconnectSource: (source: { panelId: string | null; filterIds: string[] }) => void;
  /** The panel's own card, when the selected block is one. */
  panelCard?: React.ReactNode;
  onDuplicate: () => void;
  onToggle: () => void;
  onRemove: () => void;
}) {
  const spec = blockSpec(block.type as BlockType);
  const name = block.title ?? spec.label;
  const metric = block.query ? findMetric(registry, block.query.metricId) : null;
  const dimensionCount = ((block.query?.primaryDimensionId ? 1 : 0)
    + (block.query?.secondaryDimensionId ? 1 : 0)) as 0 | 1 | 2;
  const possible = metric ? compatibleVariants(metric.charts, dimensionCount) : [];
  const offered = (spec.variants as readonly ChartVariant[]).filter((variant) =>
    metric ? possible.includes(variant) : true,
  );
  const notOffered = (spec.variants as readonly ChartVariant[]).filter(
    (variant) => !offered.includes(variant),
  );

  return (
    <div className="rounded-xl border border-line bg-surface p-4">
      <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted">
        {spec.label} · {pageTitle}
      </p>
      <h2 className="mt-0.5 break-words font-display text-base font-semibold text-strong">{name}</h2>
      <p className="mt-1 text-xs text-muted">{spec.description}</p>

      <div className="mt-4 space-y-4">
        {/* --- What it says ------------------------------------------------ */}
        <section>
          <h3 className="text-sm font-semibold text-strong">Lo que dice</h3>
          <label htmlFor={`${idPrefix}-title`} className="mt-2 block text-xs font-medium text-body">
            Título visible
          </label>
          <input
            id={`${idPrefix}-title`}
            className={`${field} mt-1`}
            value={block.title ?? ""}
            onChange={(event) => onTitle(event.target.value)}
          />
          {spec.copy === "short" || spec.copy === "long" ? (
            <>
              <label htmlFor={`${idPrefix}-body`} className="mt-2 block text-xs font-medium text-body">
                Texto explicativo
              </label>
              <textarea
                id={`${idPrefix}-body`}
                rows={spec.copy === "long" ? 5 : 3}
                className={`${field} mt-1 min-h-24`}
                value={block.copy.body ?? ""}
                onChange={(event) => onCopy("body", event.target.value)}
              />
            </>
          ) : null}
        </section>

        {panelCard}

        {/* --- What the cloud counts and how it is drawn --------------------
            The basis is the part that matters: mentions and people are
            different numbers — one person saying the same thing three times is
            3 and 1 — and a cloud that silently used one while its caption
            implied the other would be a wrong number with a font size. ---- */}
        {block.themeCloud ? (
          <section>
            <h3 className="text-sm font-semibold text-strong">Qué cuenta esta nube</h3>
            <label htmlFor={`${idPrefix}-cloudbasis`} className="mt-2 block text-xs font-medium text-body">
              Tamaño de cada palabra
            </label>
            <select
              id={`${idPrefix}-cloudbasis`}
              className={`${field} mt-1`}
              value={block.themeCloud.basis}
              onChange={(event) => onThemeCloud({ basis: event.target.value as "mentions" | "people" })}
            >
              <option value="mentions">Menciones — cuántas veces se dijo</option>
              <option value="people">Personas — cuántas lo dijeron</option>
            </select>
            <p className="mt-1 text-xs text-muted">
              Son números distintos: alguien que repite lo mismo tres veces son 3 menciones y 1
              persona. La nube dice cuál está usando.
            </p>

            <label htmlFor={`${idPrefix}-cloudsource`} className="mt-2 block text-xs font-medium text-body">
              De qué fuente
            </label>
            <select
              id={`${idPrefix}-cloudsource`}
              className={`${field} mt-1`}
              value={block.themeCloud.source ?? ""}
              onChange={(event) =>
                onThemeCloud({ source: event.target.value === "" ? null : event.target.value })
              }
            >
              <option value="">Todas las fuentes</option>
              {qualitativeSources.map((source) => (
                <option key={source} value={source}>
                  {source}
                </option>
              ))}
            </select>

            <label htmlFor={`${idPrefix}-cloudmax`} className="mt-2 block text-xs font-medium text-body">
              Cuántos temas como máximo — {block.themeCloud.maximumThemes}
            </label>
            <input
              id={`${idPrefix}-cloudmax`}
              type="range"
              min={3}
              max={120}
              step={1}
              value={block.themeCloud.maximumThemes}
              onChange={(event) => onThemeCloud({ maximumThemes: Number(event.target.value) })}
              className="mt-1 h-11 w-full"
            />

            <div className="mt-2 flex gap-2">
              <div className="min-w-0 flex-1">
                <label htmlFor={`${idPrefix}-cloudmin`} className="block text-xs font-medium text-body">
                  Letra más chica
                </label>
                <input
                  id={`${idPrefix}-cloudmin`}
                  type="number"
                  min={8}
                  max={48}
                  className={`${field} mt-1`}
                  value={block.themeCloud.minimumFontSize}
                  onChange={(event) => onThemeCloud({ minimumFontSize: Number(event.target.value) })}
                />
              </div>
              <div className="min-w-0 flex-1">
                <label htmlFor={`${idPrefix}-cloudmaxfont`} className="block text-xs font-medium text-body">
                  Letra más grande
                </label>
                <input
                  id={`${idPrefix}-cloudmaxfont`}
                  type="number"
                  min={12}
                  max={96}
                  className={`${field} mt-1`}
                  value={block.themeCloud.maximumFontSize}
                  onChange={(event) => onThemeCloud({ maximumFontSize: Number(event.target.value) })}
                />
              </div>
            </div>

            <label htmlFor={`${idPrefix}-cloudorient`} className="mt-2 block text-xs font-medium text-body">
              Cómo se acomodan las palabras
            </label>
            <select
              id={`${idPrefix}-cloudorient`}
              className={`${field} mt-1`}
              value={block.themeCloud.orientation}
              onChange={(event) =>
                onThemeCloud({ orientation: event.target.value as "horizontal" | "mostly_horizontal" | "mixed" })
              }
            >
              <option value="horizontal">Todas horizontales</option>
              <option value="mostly_horizontal">Casi todas horizontales</option>
              <option value="mixed">Mezcladas</option>
            </select>

            <label htmlFor={`${idPrefix}-cloudpalette`} className="mt-2 block text-xs font-medium text-body">
              Paleta
            </label>
            <select
              id={`${idPrefix}-cloudpalette`}
              className={`${field} mt-1`}
              value={block.themeCloud.palette}
              onChange={(event) => onThemeCloud({ palette: event.target.value as ChartPalette })}
            >
              {CHART_PALETTES.map((option) => (
                <option key={option} value={option}>
                  {PALETTE_LABEL[option]}
                </option>
              ))}
            </select>

            <label className="mt-2 flex min-h-11 items-center gap-2 text-sm text-body">
              <input
                type="checkbox"
                className="size-4"
                checked={block.themeCloud.showCounts}
                onChange={(event) => onThemeCloud({ showCounts: event.target.checked })}
              />
              Escribir el número junto a cada palabra
            </label>
          </section>
        ) : null}

        {/* --- The palette a scaled drawing reads --------------------------- */}
        {block.visualization && CHART_SPECS[block.visualization.variant].usesPalette ? (
          <section>
            <h3 className="text-sm font-semibold text-strong">Paleta de la gráfica</h3>
            <select
              id={`${idPrefix}-palette`}
              className={`${field} mt-2`}
              value={block.visualization.palette}
              onChange={(event) => onPalette(event.target.value as ChartPalette)}
            >
              {CHART_PALETTES.map((option) => (
                <option key={option} value={option}>
                  {PALETTE_LABEL[option]}
                </option>
              ))}
            </select>
            <p className="mt-1 text-xs text-muted">
              Un mapa de calor, unas burbujas y unos rectángulos codifican una cantidad en el color,
              así que la escala importa. Un arcoíris sugiere categorías donde hay grados.
            </p>
          </section>
        ) : null}

        {/* --- The semáforo this block reads, when it is drawn as one -------
            Offered only on a block that actually chose the drawing, because a
            picker for a colour scheme on a bar chart is a control with no
            consequence. Null is a real answer and the canvas says so. ---- */}
        {block.visualization?.variant === "traffic_light" ? (
          <section>
            <h3 className="text-sm font-semibold text-strong">Con qué semáforo se lee</h3>
            <select
              id={`${idPrefix}-blockband`}
              className={`${field} mt-2`}
              value={block.bandSchemeId ?? ""}
              onChange={(event) =>
                onBandScheme(event.target.value === "" ? null : event.target.value)
              }
            >
              <option value="">Sin semáforo configurado</option>
              {definition.bandSchemes.map((scheme) => (
                <option key={scheme.id} value={scheme.id}>
                  {scheme.title}
                </option>
              ))}
            </select>
            <p className="mt-1 text-xs text-muted">
              {definition.bandSchemes.length === 0
                ? "Todavía no hay ningún semáforo. Se configuran en “Semáforos”, en el panel izquierdo: el producto no decide dónde empieza el verde."
                : "Las bandas, sus rangos y lo que significan se editan en “Semáforos”, en el panel izquierdo."}
            </p>
          </section>
        ) : null}

        {/* --- Which recorrido this block is a window onto ------------------
            A `journey` block does not CONTAIN a recorrido; it points at one.
            Changing the choice here moves the window, and the definition it
            was showing is untouched — which is the difference the two
            "Duplicar" verbs exist to keep visible. ----------------------- */}
        {spec.requiresJourney ? (
          <section>
            <h3 className="text-sm font-semibold text-strong">Qué recorrido muestra</h3>
            <select
              id={`${idPrefix}-journeyref`}
              className={`${field} mt-2`}
              value={block.journeyRef ?? ""}
              onChange={(event) => onJourney(event.target.value)}
            >
              {definition.journeyReferences.map((journey) => (
                <option key={journey.id} value={journey.id}>
                  {journey.title}
                  {journey.moments.length === 0 ? " (sin momentos)" : ""}
                </option>
              ))}
            </select>
            <p className="mt-1 text-xs text-muted">
              Se define en “Recorridos”, en el panel izquierdo. Duplicar este bloque abre otra
              ventana al mismo recorrido; para tener uno distinto, duplica el recorrido allí.
            </p>
          </section>
        ) : null}

        {/* --- Where its number comes from -------------------------------- */}
        {block.query ? (
          <section>
            <h3 className="text-sm font-semibold text-strong">De dónde sale el número</h3>
            <label htmlFor={`${idPrefix}-metric`} className="mt-2 block text-xs font-medium text-body">
              Resultado
            </label>
            <select
              id={`${idPrefix}-metric`}
              className={`${field} mt-1`}
              value={block.query.metricId}
              onChange={(event) => onMetric(event.target.value)}
            >
              {registry.metrics.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.label}
                  {entry.responses === 0 ? " (sin respuestas)" : ""}
                </option>
              ))}
            </select>

            <label htmlFor={`${idPrefix}-agg`} className="mt-2 block text-xs font-medium text-body">
              Cómo se calcula
            </label>
            <select
              id={`${idPrefix}-agg`}
              className={`${field} mt-1`}
              value={block.query.aggregation}
              onChange={(event) => onAggregation(event.target.value as Aggregation)}
            >
              {(metric?.aggregations ?? []).map((aggregation) => (
                <option key={aggregation} value={aggregation}>
                  {AGGREGATION_LABEL[aggregation]}
                </option>
              ))}
            </select>

            <label htmlFor={`${idPrefix}-dim1`} className="mt-2 block text-xs font-medium text-body">
              Desglosado por
            </label>
            <select
              id={`${idPrefix}-dim1`}
              className={`${field} mt-1`}
              value={block.query.primaryDimensionId ?? ""}
              onChange={(event) => onDimension("primary", event.target.value || null)}
            >
              <option value="">Sin desglose</option>
              {registry.dimensions.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.label} ({entry.values.length})
                </option>
              ))}
            </select>

            <label htmlFor={`${idPrefix}-dim2`} className="mt-2 block text-xs font-medium text-body">
              Y cruzado con
            </label>
            <select
              id={`${idPrefix}-dim2`}
              className={`${field} mt-1`}
              value={block.query.secondaryDimensionId ?? ""}
              onChange={(event) => onDimension("secondary", event.target.value || null)}
              disabled={!block.query.primaryDimensionId}
            >
              <option value="">Nada más</option>
              {registry.dimensions
                .filter((entry) => entry.id !== block.query?.primaryDimensionId)
                .map((entry) => (
                  <option key={entry.id} value={entry.id}>
                    {entry.label} ({entry.values.length})
                  </option>
                ))}
            </select>
            {metric ? (
              <p className="mt-1.5 text-xs text-muted">
                {metric.question} {metric.responses} respuesta(s) en este estudio.
              </p>
            ) : null}
          </section>
        ) : null}

        {/* --- How it is drawn -------------------------------------------- */}
        {block.visualization ? (
          <section>
            <h3 className="text-sm font-semibold text-strong">Cómo se dibuja</h3>
            <label htmlFor={`${idPrefix}-variant`} className="mt-2 block text-xs font-medium text-body">
              Gráfica
            </label>
            <select
              id={`${idPrefix}-variant`}
              className={`${field} mt-1`}
              value={block.visualization.variant}
              onChange={(event) => onVariant(event.target.value as ChartVariant)}
            >
              <optgroup label="Compatibles con este resultado">
                {offered.map((variant) => (
                  <option key={variant} value={variant}>
                    {CHART_SPECS[variant].label}
                    {isRendererImplemented(variant) ? "" : " — todavía no se dibuja"}
                  </option>
                ))}
              </optgroup>
              {notOffered.length > 0 ? (
                <optgroup label="No compatibles con este resultado">
                  {notOffered.map((variant) => (
                    <option key={variant} value={variant}>
                      {CHART_SPECS[variant].label}
                    </option>
                  ))}
                </optgroup>
              ) : null}
            </select>
            <p className="mt-1 text-xs text-muted">
              {CHART_SPECS[block.visualization.variant].description}
            </p>
            {!isRendererImplemented(block.visualization.variant) ? (
              <p className="mt-1 text-xs text-caution">
                Esta gráfica todavía no se dibuja en esta versión. El bloque lo dice y muestra una
                representación de referencia; no la sustituye en silencio.
              </p>
            ) : null}
          </section>
        ) : null}

        {/* --- Width. Desktop and tablet only. ---------------------------- */}
        <section className="hidden md:block">
          <h3 className="text-sm font-semibold text-strong">Qué tan ancho se ve</h3>
          {(["desktop", "tablet"] as const).map((breakpoint) => (
            <div key={breakpoint} className="mt-2">
              <label
                htmlFor={`${idPrefix}-span-${breakpoint}`}
                className="block text-xs font-medium text-body"
              >
                {BREAKPOINT_LABEL[breakpoint]} — {block.layout[breakpoint].span} de {GRID_COLUMNS}
              </label>
              <input
                id={`${idPrefix}-span-${breakpoint}`}
                type="range"
                min={spec.span.min}
                max={spec.span.max}
                step={1}
                value={block.layout[breakpoint].span}
                onChange={(event) => onSpan(breakpoint, Number(event.target.value))}
                className="mt-1 h-11 w-full"
              />
            </div>
          ))}
          <p className="mt-1 text-xs text-muted">
            En teléfono cada bloque ocupa el ancho completo. No es una preferencia: dos cosas lado a
            lado en 320 px no se leen.
          </p>
        </section>

        {/* --- What moves it: a SUMMARY, and only when it can be moved -----
            THE CHECKLIST THAT USED TO BE HERE IS GONE.

            It printed every characteristic in the study's registry, as
            checkboxes, on EVERY block — a paragraph, a heading, the approved
            team reading, the download button. Thirteen tick boxes that did
            nothing, on a card whose job is to explain one block.

            A static block now gets no filter section at all, and a data-backed
            one gets a sentence naming the panel that moves it and the
            characteristics that panel offers. Changing WHICH blocks a panel
            moves is the panel's job, and the way there is one click from
            here. ------------------------------------------------------------- */}
        {spec.capabilities.supportsViewerFilters ? (
          <BlockFilterSummary
            definition={definition}
            registry={registry}
            blockId={block.id}
            onOpenPanel={onOpenPanel}
            onDisconnect={onDisconnectSource}
          />
        ) : null}

        {/* --- Its own disclosure rule ------------------------------------ */}
        {spec.allowsSamplePolicyOverride ? (
          <section>
            <h3 className="text-sm font-semibold text-strong">Su propia regla de divulgación</h3>
            <label htmlFor={`${idPrefix}-blockpolicy`} className="mt-2 block text-xs font-medium text-body">
              Con pocas respuestas, este bloque
            </label>
            <select
              id={`${idPrefix}-blockpolicy`}
              className={`${field} mt-1`}
              value={block.samplePolicy.kind === "inherit" ? "inherit" : block.samplePolicy.policy.mode}
              onChange={(event) => {
                const value = event.target.value;
                if (value === "inherit") onSamplePolicy({ kind: "inherit" });
                else
                  onSamplePolicy({
                    kind: "override",
                    policy: {
                      policyVersion: SAMPLE_POLICY_VERSION,
                      mode: value as SamplePolicyMode,
                      threshold: definition.sampleVisibilityPolicy.threshold,
                    },
                  });
              }}
            >
              <option value="inherit">
                Sigue la regla del estudio ({MODE_LABEL[definition.sampleVisibilityPolicy.mode].toLowerCase()})
              </option>
              {SAMPLE_POLICY_MODES.map((mode) => (
                <option key={mode} value={mode}>
                  {MODE_LABEL[mode]}
                </option>
              ))}
            </select>
          </section>
        ) : null}

        {/* --- Everything destructive or secondary lives here -------------- */}
        <section className="border-t border-line pt-3">
          <h3 className="text-sm font-semibold text-strong">Acciones</h3>
          <div className="mt-2 flex flex-wrap gap-2">
            <button type="button" className={button} onClick={onDuplicate}>
              Duplicar
            </button>
            <button type="button" className={button} onClick={onToggle} aria-pressed={!block.visible}>
              {block.visible ? "Ocultar" : "Mostrar"}
            </button>
            <ConfirmAction
              trigger="Quitar"
              title="Quitar el bloque"
              objectName={name}
              severity="reversible"
              consequence={
                <p>
                  Se quita de “{pageTitle}”. Los filtros que solo lo movían a él dejan de existir,
                  para que no queden apuntando a nada.
                </p>
              }
              recovery={<p>Se deshace con “Deshacer” mientras no cierres la pestaña.</p>}
              confirmLabel="Quitar el bloque"
              action={() => onRemove()}
            />
          </div>
        </section>
      </div>
    </div>
  );
}

/**
 * WHAT MOVES THIS BLOCK — the compact summary that replaced a registry-wide
 * checklist.
 *
 * It is rendered ONLY for a block whose catalogue entry declares
 * `supportsViewerFilters`. A paragraph, a heading, the approved team reading,
 * the study's identity and the download button get nothing here — not an empty
 * section, not a disabled one, not an explanation of why: an absent control is
 * the clearest statement that there is no decision to make.
 *
 * For a block that CAN be moved it says which panel moves it and which
 * characteristics that panel offers, and it offers exactly two verbs:
 * disconnect, or go to the panel and edit it there. Choosing WHICH blocks a
 * panel governs belongs to the panel, in one place, once.
 */
function BlockFilterSummary({
  definition,
  registry,
  blockId,
  onOpenPanel,
  onDisconnect,
}: {
  definition: ExperienceDefinitionV1;
  registry: SemanticRegistry;
  blockId: string;
  onOpenPanel: (pageId: string, panelId: string) => void;
  onDisconnect: (source: { panelId: string | null; filterIds: string[] }) => void;
}) {
  const kinds = useMemo(() => filterDimensionKinds(definition, registry), [definition, registry]);
  const sources = useMemo(
    () => blockFilterSources(definition, blockId, kinds),
    [definition, blockId, kinds],
  );

  return (
    <section>
      <h3 className="text-sm font-semibold text-strong">Este bloque responde a</h3>
      {sources.length === 0 ? (
        <p className="mt-1 text-xs text-muted">
          Ningún filtro lo mueve todavía. Se decide desde un “Panel de filtros”: selecciónalo en el
          lienzo y elige ahí qué bloques cambia.
        </p>
      ) : (
        <ul className="mt-2 space-y-2">
          {sources.map((source) => (
            <li
              key={source.panelId ?? "direct"}
              className="rounded-lg border border-line bg-surface-sunken p-2.5"
            >
              <p className="text-sm text-body">
                {source.panelId ? (
                  <span className="font-medium text-strong">“{source.panelTitle}”: </span>
                ) : (
                  <span className="font-medium text-strong">Conexión directa: </span>
                )}
                {source.filters.map((filter) => filter.label).join(", ")}
              </p>
              <div className="mt-1.5 flex flex-wrap gap-2">
                {source.panelId && source.panelPageId ? (
                  <button
                    type="button"
                    className={button}
                    onClick={() =>
                      onOpenPanel(source.panelPageId as string, source.panelId as string)
                    }
                  >
                    Ir al panel
                  </button>
                ) : null}
                <button
                  type="button"
                  className={button}
                  onClick={() =>
                    onDisconnect({
                      panelId: source.panelId,
                      filterIds: source.filters.map((filter) => filter.id),
                    })
                  }
                >
                  Desconectar
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Notices
// ---------------------------------------------------------------------------

function collapse(issues: { code: string; detail: string }[]) {
  const seen = new Map<string, { detail: string; count: number }>();
  for (const issue of issues) {
    const existing = seen.get(issue.detail);
    if (existing) existing.count += 1;
    else seen.set(issue.detail, { detail: issue.detail, count: 1 });
  }
  return [...seen.values()];
}

function Notices({
  schemaIssues,
  report,
  adapterWarnings,
}: {
  schemaIssues: { path: string; message: string }[];
  report: ReturnType<typeof validateExperienceDefinition>;
  adapterWarnings: { code: string; detail: string }[];
}) {
  const errors = collapse(report.errors.map((issue) => ({ code: issue.code, detail: issue.detail })));
  const warnings = collapse(
    report.warnings.map((issue) => ({ code: issue.code, detail: issue.detail })),
  );

  return (
    <div className="mt-4 space-y-3">
      {schemaIssues.length > 0 || errors.length > 0 ? (
        <section className="rounded-xl border border-danger-line bg-danger-surface p-3">
          <h2 className="font-display text-sm font-semibold text-danger">
            Lo que impide guardar esta experiencia
          </h2>
          <ul className="mt-1.5 space-y-1 text-sm text-danger">
            {schemaIssues.slice(0, 6).map((issue) => (
              <li key={`${issue.path}-${issue.message}`}>{issue.message}</li>
            ))}
            {errors.slice(0, 8).map((issue) => (
              <li key={issue.detail}>
                {issue.detail}
                {issue.count > 1 ? ` (${issue.count} bloques)` : ""}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {warnings.length > 0 ? (
        <section className="rounded-xl border border-caution-line bg-caution-surface p-3">
          <h2 className="font-display text-sm font-semibold text-caution">
            Avisos que no impiden nada
          </h2>
          <ul className="mt-1.5 space-y-1 text-sm text-caution">
            {warnings.slice(0, 10).map((issue) => (
              <li key={issue.detail}>
                {issue.detail}
                {issue.count > 1 ? ` (${issue.count} bloques)` : ""}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {adapterWarnings.length > 0 ? (
        <section className="rounded-xl border border-line bg-surface p-3">
          <h2 className="font-display text-sm font-semibold text-strong">
            Lo que el modelo todavía no sabe representar de este estudio
          </h2>
          <p className="mt-1 text-xs text-muted">
            Notas internas del equipo. El cliente nunca las ve.
          </p>
          <ul className="mt-1.5 space-y-1 text-sm text-body">
            {adapterWarnings.map((warning) => (
              <li key={`${warning.code}-${warning.detail}`}>{warning.detail}</li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
