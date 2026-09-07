"use client";

/**
 * THE THREE-PANE COMPOSER — pages and catalogue, canvas, inspector.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * NOTHING HERE IS SAVED, AND THE SCREEN SAYS SO.
 *
 * Unit 6B.1 stores nothing. The document lives in this component's memory and
 * ends when the tab does. That is not a limitation to be hidden behind a
 * hopeful "draft" label — it is the single most important thing an author needs
 * to know before they spend an hour in here, so it is stated at the top, in
 * words, above everything else.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THE PREVIEW GOES STALE RATHER THAN FOLLOWING THE EDITS.
 *
 * Resolving a document means reading the canonical results on the server. Doing
 * that on every keystroke would be a request per character; doing it on a timer
 * would mean the numbers on screen belong to a document that no longer exists
 * and nobody could say which. So the STRUCTURE on the canvas is always live —
 * blocks appear, move and disappear as they are edited — and the VALUES are the
 * ones from the last resolution, explicitly marked stale until somebody asks
 * for a new one.
 *
 * A block added since the last refresh has no resolved counterpart at all, and
 * says so in its own card rather than borrowing another block's numbers.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { useCallback, useEffect, useId, useReducer, useRef, useState, useSyncExternalStore } from "react";

import {
  addBlock,
  addPage,
  connectBlockToPanel,
  connectionCandidates,
  disconnectBlockFromPanel,
  dropIndexFor,
  duplicateBlock,
  duplicatePage,
  findBlock,
  findPage,
  moveBlock,
  moveBlockToIndex,
  movePage,
  offeredChartVariants,
  openComposer,
  openPage,
  redo,
  removeBlock,
  removePage,
  renamePage,
  selectBlock,
  setBlockBinding,
  setBlockCopy,
  setBlockDisclosure,
  setBlockDisplayFormat,
  setBlockResponsive,
  setBlockSamplePolicy,
  setBlockSpan,
  setBlockVisibility,
  setChartVariant,
  setDocumentDisclosure,
  setDocumentSamplePolicy,
  setEditorialBody,
  togglePanelDimension,
  undo,
  type AddBlockRequest,
  type ComposerPayload,
  type ComposerState,
  type RefreshPreview,
} from "@/lib/composer";
import {
  GRID_COLUMNS,
  METHODOLOGY_DISCLOSURE_LEVELS,
  type MethodologyDisclosureLevel,
  type PresentationBlock,
  type PresentationRenderModel,
  type RenderBlock,
} from "@/lib/presentation";
import { PresentationRenderer } from "@/components/presentation/PresentationRenderer";
import {
  CANVAS_WIDTH,
  DEFAULT_CHROME,
  readChrome,
  serverChrome,
  setChrome,
  subscribeChrome,
  visiblePanels,
  ZOOM_LABEL,
  type CanvasMode,
  type CanvasZoom,
} from "./chrome";

const btn =
  "min-h-11 rounded-lg border border-line bg-surface px-3 text-sm font-medium text-body transition-colors duration-[var(--motion-state)] ease-brand hover:border-line-strong motion-reduce:transition-none";
const btnActive = "min-h-11 rounded-lg border border-evidence bg-evidence px-3 text-sm font-medium text-on-inverse";
const field =
  "min-h-11 w-full rounded-lg border border-line-strong bg-surface px-3 py-2 text-sm text-strong";

export function ComposerWorkspace({
  payload,
  studyId,
  refresh,
}: {
  payload: ComposerPayload;
  studyId: string;
  refresh: RefreshPreview;
}) {
  const chrome = useSyncExternalStore(subscribeChrome, readChrome, serverChrome);
  const panels = visiblePanels(chrome);

  // THE OPERATION IS THE ACTION.
  //
  // A reducer whose action carries the operation keeps every edit pure and keeps
  // it in ONE place. Two earlier shapes were wrong: running the operation inside
  // a `setState` updater and calling three other setters from in there (an impure
  // updater React may invoke twice), and mirroring the state into a ref written
  // during render (which the React lint refuses, correctly). The consequences of
  // an edit are drawn from the state it produced, in an effect, where a ref is
  // legal and a stale closure is impossible.
  const [state, dispatch] = useReducer(
    (current: ComposerState, action: { run: (s: ComposerState) => ComposerState }) => action.run(current),
    payload.document,
    openComposer,
  );
  const [refreshNotice, setRefreshNotice] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ model: PresentationRenderModel; stale: boolean }>({
    model: payload.model,
    stale: false,
  });
  const [pending, setPending] = useState(false);
  const [issues, setIssues] = useState<{ code: string; path: string }[] | null>(null);
  const [drawer, setDrawer] = useState<"none" | "left" | "right">("none");

  /** The single choke point. Every control goes through it. */
  const act = useCallback((run: (s: ComposerState) => ComposerState) => dispatch({ run }), []);

  /**
   * An edit makes the preview stale — derived from the document, not remembered
   * at each of the thirty-odd call sites.
   *
   * `seenDocument` is written in an effect, which is where a ref may be written.
   * It doubles as "the document as the screen currently knows it", which the
   * refresh below needs after its await.
   */
  const seenDocument = useRef(payload.document);
  useEffect(() => {
    if (state.document === seenDocument.current) return;
    seenDocument.current = state.document;
    setPreview((previous) => (previous.stale ? previous : { ...previous, stale: true }));
    setIssues(null);
    setRefreshNotice(null);
  }, [state.document]);

  // The refusal IS the notice; there is nothing to remember. A message from the
  // refresh fills in when no refusal stands.
  const notice = state.refusal?.message ?? refreshNotice;

  const document_ = state.document;
  const page = state.openPageId === null ? null : findPage(document_, state.openPageId);
  const selected = state.selectedBlockId === null ? null : findBlock(document_, state.selectedBlockId);
  const context = { catalog: payload.catalog };

  // Ctrl/⌘+Z and ⇧+Ctrl/⌘+Z, ignored inside a text field — the browser's own
  // undo is what a person means while they are typing.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== "z") return;
      const target = event.target as HTMLElement | null;
      if (target && (/^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName) || target.isContentEditable)) return;
      event.preventDefault();
      act(event.shiftKey ? redo : undo);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [act]);

  // Escape leaves focus mode, but only when there is nothing nearer to leave.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      const target = event.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
      if (target?.closest("dialog, [role='dialog'], [role='menu']")) return;
      if (drawer !== "none") {
        setDrawer("none");
        return;
      }
      if (readChrome().focus) setChrome({ focus: false });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [drawer]);

  const onRefresh = useCallback(async () => {
    setPending(true);
    setRefreshNotice(null);
    // WHAT WAS SENT IS WHAT MAY BE MARKED FRESH.
    //
    // The round trip takes as long as a canonical read, and an author can edit
    // during it. An earlier version cleared the staleness flag on whatever came
    // back, so a preview resolved from the OLD document was labelled up to date
    // over a newer one — the single most misleading state this screen can be in.
    const sent = seenDocument.current;
    try {
      const result = await refresh(studyId, JSON.stringify(sent));
      if (result.ok) {
        const current = seenDocument.current;
        setPreview({ model: result.model, stale: current !== sent });
        setIssues(null);
        setRefreshNotice(
          current === sent
            ? "Vista previa actualizada."
            : "Vista previa actualizada, y el documento ya cambió desde entonces: sigue desactualizada.",
        );
      } else {
        setIssues(result.unavailable.issues ?? []);
        setRefreshNotice(result.unavailable.detail);
      }
    } catch {
      setRefreshNotice("No se pudo actualizar la vista previa. La sesión sigue intacta.");
    } finally {
      setPending(false);
    }
  }, [refresh, studyId]);

  // THE ZOOM IS RESOLVED ONCE, WHERE BOTH THE CONTROL AND THE CANVAS CAN SEE IT.
  //
  // It was computed inside the canvas and the toolbar showed the stored
  // preference, so while the automatic fit was active the control read 100% over
  // a canvas drawn at 62%. The room a canvas has depends on which panels are
  // open, so it is measured rather than derived from a breakpoint.
  const canvasFrame = useRef<HTMLDivElement | null>(null);
  const [room, setRoom] = useState(0);
  useEffect(() => {
    const element = canvasFrame.current;
    if (!element) return;
    const measure = () => setRoom(element.clientWidth);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const canvasWidth = CANVAS_WIDTH[chrome.mode];
  const previewFits = room === 0 || room >= canvasWidth;
  const zoomIsAutomatic = !chrome.zoomChosen && !previewFits;
  const effectiveZoom: CanvasZoom = zoomIsAutomatic ? "fit" : chrome.zoom;

  const resolvedById = new Map<string, RenderBlock>();
  for (const renderPage of preview.model.pages) {
    for (const block of renderPage.blocks) resolvedById.set(block.id, block);
  }

  return (
    <div className="w-full min-w-0">
      <SessionBanner />

      <Toolbar
        chrome={chrome}
        panels={panels}
        pending={pending}
        stale={preview.stale}
        canUndo={state.past.length > 0}
        canRedo={state.future.length > 0}
        effectiveZoom={effectiveZoom}
        zoomIsAutomatic={zoomIsAutomatic}
        onUndo={() => act(undo)}
        onRedo={() => act(redo)}
        onRefresh={onRefresh}
        onDrawer={setDrawer}
      />

      {notice ? (
        <p
          aria-live="polite"
          className="mt-2 rounded-lg border border-evidence-line bg-evidence-surface px-3 py-2 text-sm text-body"
        >
          {notice}
        </p>
      ) : null}

      {issues && issues.length > 0 ? (
        <div className="mt-2 rounded-lg border border-caution-line bg-caution-surface px-3 py-2 text-sm text-caution">
          <p className="font-semibold">La presentación no resolvió. Nada se dibuja a medias.</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-5">
            {issues.map((issue, index) => (
              <li key={index}>
                <code className="text-xs">{issue.code}</code> en <code className="text-xs">{issue.path}</code>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="mt-3 flex min-w-0 items-start gap-4">
        {/* LEFT — pages and catalogue. Docks at lg (1024). */}
        <Panel
          side="left"
          open={panels.left}
          drawerOpen={drawer === "left"}
          onCollapse={() => setChrome({ left: false })}
          onCloseDrawer={() => setDrawer("none")}
          label="Páginas y catálogo"
        >
          <PagesPanel state={state} act={act} context={context} payload={payload} />
        </Panel>

        {panels.left ? null : (
          <RestoreTab side="left" onRestore={() => setChrome({ left: true, focus: false, right: panels.right })} />
        )}

        {/* CENTRE — the canvas, and it is the dominant area at every width. */}
        <div className="min-w-0 flex-1">
          <Canvas
            chrome={chrome}
            page={page}
            state={state}
            act={act}
            resolvedById={resolvedById}
            stale={preview.stale}
            model={preview.model}
            frameRef={canvasFrame}
            room={room}
            effectiveZoom={effectiveZoom}
            zoomIsAutomatic={zoomIsAutomatic}
          />
        </div>

        {panels.right ? null : (
          <RestoreTab side="right" onRestore={() => setChrome({ right: true, focus: false, left: panels.left })} />
        )}

        {/* RIGHT — the inspector for the selected block. Docks at xl (1280). */}
        <Panel
          side="right"
          open={panels.right}
          drawerOpen={drawer === "right"}
          onCollapse={() => setChrome({ right: false })}
          onCloseDrawer={() => setDrawer("none")}
          label="Ficha del bloque"
        >
          <Inspector selected={selected} state={state} act={act} context={context} payload={payload} />
        </Panel>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */

function SessionBanner() {
  return (
    <div className="rounded-xl border-2 border-caution-line bg-caution-surface p-4">
      <p className="font-display text-base font-bold text-caution">
        Nada de lo que hagas aquí se guarda.
      </p>
      <ul className="mt-1.5 list-disc space-y-0.5 pl-5 text-sm text-caution">
        <li>Los cambios viven sólo en esta pestaña, en memoria.</li>
        <li>Si recargas o sales, se pierden por completo.</li>
        <li>El cliente no ve nada de esto, y no se publica nada.</li>
        <li>No se toca el borrador guardado que ya existe para este estudio.</li>
      </ul>
    </div>
  );
}

/* -------------------------------------------------------------------------- */

function Toolbar({
  chrome,
  panels,
  pending,
  stale,
  canUndo,
  canRedo,
  effectiveZoom,
  zoomIsAutomatic,
  onUndo,
  onRedo,
  onRefresh,
  onDrawer,
}: {
  chrome: typeof DEFAULT_CHROME;
  panels: { left: boolean; right: boolean };
  pending: boolean;
  stale: boolean;
  canUndo: boolean;
  canRedo: boolean;
  effectiveZoom: CanvasZoom;
  zoomIsAutomatic: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onRefresh: () => void;
  onDrawer: (drawer: "none" | "left" | "right") => void;
}) {
  return (
    <div className="mt-3 flex flex-wrap items-center gap-2 rounded-xl border border-line bg-surface p-2">
      <button type="button" className={btn} onClick={onUndo} disabled={!canUndo} aria-keyshortcuts="Control+Z">
        Deshacer
      </button>
      <button type="button" className={btn} onClick={onRedo} disabled={!canRedo} aria-keyshortcuts="Shift+Control+Z">
        Rehacer
      </button>

      <span className="mx-1 hidden h-6 w-px bg-line sm:block" aria-hidden="true" />

      <fieldset className="flex items-center gap-1">
        <legend className="sr-only">Ancho del lienzo</legend>
        {(["desktop", "tablet", "mobile"] as CanvasMode[]).map((mode) => (
          <button
            key={mode}
            type="button"
            aria-pressed={chrome.mode === mode}
            className={chrome.mode === mode ? btnActive : btn}
            onClick={() => setChrome({ mode })}
          >
            {mode === "desktop" ? "Escritorio" : mode === "tablet" ? "Tableta" : "Teléfono"}
          </button>
        ))}
      </fieldset>

      {/*
        A SELECT READING 100% OVER A CANVAS DRAWN AT 62% IS A CONTROL THAT LIES.
        The value shown is the one IN EFFECT, and when the fit is automatic the
        control says so beside itself — the earlier version showed the stored
        preference, which is exactly the number nobody was looking at.
      */}
      <label className="flex items-center gap-1.5 text-sm text-muted">
        <span className="sr-only sm:not-sr-only">Zoom</span>
        <select
          className="min-h-11 rounded-lg border border-line bg-surface px-2 text-sm text-body"
          value={String(effectiveZoom)}
          onChange={(event) => {
            const raw = event.target.value;
            const zoom: CanvasZoom = raw === "fit" ? "fit" : (Number(raw) as 1 | 0.75 | 0.5);
            // Choosing anything — 100% included — ends the automatic fitting.
            setChrome({ zoom, zoomChosen: true });
          }}
        >
          {["fit", "1", "0.75", "0.5"].map((value) => (
            <option key={value} value={value}>
              {ZOOM_LABEL[value]}
            </option>
          ))}
        </select>
        {zoomIsAutomatic ? <span className="text-xs text-muted">automática</span> : null}
      </label>

      <span className="mx-1 hidden h-6 w-px bg-line sm:block" aria-hidden="true" />

      {/*
        THE LABEL READS THE VISIBLE STATE, SO THE CLICK MUST WRITE THE VISIBLE
        STATE. An earlier version labelled itself from `panels` (which focus mode
        forces false) and toggled `chrome` (which focus mode leaves alone), so in
        focus mode the button said "Mostrar páginas" and hid them: leaving focus
        mode was correct, and it took the panel with it.
      */}
      <button
        type="button"
        className={btn}
        aria-pressed={panels.left}
        onClick={() => setChrome({ left: !panels.left, focus: false })}
      >
        {panels.left ? "Ocultar páginas" : "Mostrar páginas"}
      </button>
      <button
        type="button"
        className={btn}
        aria-pressed={panels.right}
        onClick={() => setChrome({ right: !panels.right, focus: false })}
      >
        {panels.right ? "Ocultar ficha" : "Mostrar ficha"}
      </button>
      <button
        type="button"
        className={chrome.focus ? btnActive : btn}
        aria-pressed={chrome.focus}
        onClick={() => setChrome({ focus: !chrome.focus })}
      >
        {chrome.focus ? "Salir de foco" : "Modo foco"}
      </button>

      {/* Drawer openers, for widths where the panels are not docked. */}
      <button type="button" className={`${btn} lg:hidden`} onClick={() => onDrawer("left")}>
        Páginas
      </button>
      <button type="button" className={`${btn} xl:hidden`} onClick={() => onDrawer("right")}>
        Ficha
      </button>

      <span className="ml-auto flex items-center gap-2">
        {stale ? (
          <span className="rounded-full border border-caution-line bg-caution-surface px-2.5 py-1 text-xs font-semibold text-caution">
            Vista previa desactualizada
          </span>
        ) : (
          <span className="rounded-full border border-positive-line bg-positive-surface px-2.5 py-1 text-xs font-semibold text-positive">
            Vista previa al día
          </span>
        )}
        <button
          type="button"
          onClick={onRefresh}
          disabled={pending}
          className="min-h-11 rounded-lg bg-ink px-4 text-sm font-semibold text-paper hover:bg-[#183b5c] disabled:cursor-not-allowed disabled:opacity-50"
        >
          {pending ? "Actualizando…" : "Actualizar vista previa"}
        </button>
      </span>
    </div>
  );
}

/* -------------------------------------------------------------------------- */

/**
 * ONE element, two behaviours: a docked column on a wide screen and a drawer on
 * a narrow one, through responsive classes on a single `<aside>`.
 *
 * Rendering it twice would give the same controls two sets of DOM ids, and a
 * duplicate id is both an accessibility defect and a gate failure.
 */
function Panel({
  side,
  open,
  drawerOpen,
  onCollapse,
  onCloseDrawer,
  label,
  children,
}: {
  side: "left" | "right";
  open: boolean;
  drawerOpen: boolean;
  onCollapse: () => void;
  onCloseDrawer: () => void;
  label: string;
  children: React.ReactNode;
}) {
  const dock = side === "left" ? "lg:block" : "xl:block";
  const hiddenDock = side === "left" ? "lg:hidden" : "xl:hidden";
  return (
    <>
      {drawerOpen ? (
        <button
          type="button"
          aria-label="Cerrar el panel"
          onClick={onCloseDrawer}
          className={`fixed inset-0 z-30 bg-ink/40 ${hiddenDock}`}
        />
      ) : null}
      <aside
        aria-label={label}
        className={[
          "min-w-0 shrink-0",
          drawerOpen
            ? `fixed inset-y-0 z-40 w-[min(20rem,88vw)] overflow-y-auto bg-surface p-4 shadow-lifted ${side === "left" ? "left-0" : "right-0"} ${hiddenDock}`
            : "hidden",
          open ? `${dock} relative lg:w-72` : "",
        ].join(" ")}
      >
        <div className="flex items-center justify-between gap-2">
          <h2 className="font-display text-sm font-semibold text-strong">{label}</h2>
          <button type="button" onClick={drawerOpen ? onCloseDrawer : onCollapse} className={`${btn} px-2`}>
            {drawerOpen ? "Cerrar" : "Ocultar"}
          </button>
        </div>
        <div className="mt-3">{children}</div>

        {/*
          THE SEAM. A 24px-wide strip in the 16px gap between the panel and the
          canvas, carrying a real focusable button that is 44px tall. The narrow
          dimension is deliberate and measured: it is a seam, not a control
          surface, and the accessible way to collapse the panel is the labelled
          toolbar button above. Double-clicking the strip is the accelerator.

          The panel must be `relative` for `-right-4` to resolve against IT and
          not against the viewport — otherwise the strip pins itself 16px off the
          edge of the window and pushes the document into horizontal scroll.
        */}
        {open && !drawerOpen ? (
          <div
            onDoubleClick={onCollapse}
            className={`absolute inset-y-0 hidden w-6 cursor-col-resize items-center ${side === "left" ? "-right-4" : "-left-4"} ${dock} lg:flex`}
          >
            <button
              type="button"
              onClick={onCollapse}
              draggable={false}
              aria-label={`Ocultar ${label.toLowerCase()}`}
              className="h-11 w-6 shrink-0 select-none rounded-full border border-line bg-surface text-xs text-muted hover:border-line-strong"
            >
              {side === "left" ? "‹" : "›"}
            </button>
          </div>
        ) : null}
      </aside>
    </>
  );
}

/**
 * The restore tab a collapsed panel leaves behind.
 *
 * It gets its OWN strip rather than floating over the canvas: floated, it
 * covered the page title and the block count. Restoring one panel pins the
 * other to whatever is on screen right now, so restoring one never drags its
 * neighbour back out of focus mode.
 */
function RestoreTab({ side, onRestore }: { side: "left" | "right"; onRestore: () => void }) {
  const dock = side === "left" ? "lg:flex" : "xl:flex";
  return (
    <div className={`hidden shrink-0 items-start ${dock}`}>
      <button
        type="button"
        onClick={onRestore}
        aria-label={side === "left" ? "Mostrar páginas y catálogo" : "Mostrar la ficha del bloque"}
        className="min-h-11 w-11 rounded-lg border border-line bg-surface text-sm text-muted hover:border-line-strong"
      >
        {side === "left" ? "›" : "‹"}
      </button>
    </div>
  );
}

/* -------------------------------------------------------------------------- */

function PagesPanel({
  state,
  act,
  context,
  payload,
}: {
  state: ComposerState;
  act: (run: (s: ComposerState) => ComposerState) => void;
  context: { catalog: ComposerPayload["catalog"] };
  payload: ComposerPayload;
}) {
  const [newPage, setNewPage] = useState("");
  const [query, setQuery] = useState("");
  const openId = state.openPageId;

  const entries = payload.catalog.entries.filter((entry) => {
    if (entry.semantic === "filter_dimension") return false;
    if (query.trim().length === 0) return true;
    return entry.label.toLowerCase().includes(query.trim().toLowerCase());
  });

  return (
    <div className="space-y-5">
      <section>
        <h3 className="text-xs font-semibold uppercase tracking-[0.08em] text-muted">Páginas</h3>
        <ul className="mt-2 space-y-1">
          {state.document.pages.map((page, index) => (
            <li key={page.id}>
              <div
                className={`rounded-lg border px-2 py-1.5 ${page.id === openId ? "border-evidence bg-evidence-surface" : "border-line bg-surface"}`}
              >
                <button
                  type="button"
                  onClick={() => act((s) => openPage(s, page.id))}
                  className="block min-h-11 w-full text-left text-sm text-strong"
                >
                  {page.title}
                  <span className="ml-1 text-xs text-muted">
                    ({page.blocks.length} {page.blocks.length === 1 ? "bloque" : "bloques"})
                  </span>
                </button>
                <div className="mt-1 flex flex-wrap gap-1">
                  <button type="button" className={`${btn} px-2 text-xs`} onClick={() => act((s) => movePage(s, page.id, -1))} aria-label={`Subir ${page.title}`}>
                    ↑
                  </button>
                  <button type="button" className={`${btn} px-2 text-xs`} onClick={() => act((s) => movePage(s, page.id, 1))} aria-label={`Bajar ${page.title}`}>
                    ↓
                  </button>
                  <button type="button" className={`${btn} px-2 text-xs`} onClick={() => act((s) => duplicatePage(s, page.id))}>
                    Duplicar
                  </button>
                  <button type="button" className={`${btn} px-2 text-xs`} onClick={() => act((s) => removePage(s, page.id))}>
                    Quitar
                  </button>
                </div>
                {page.id === openId ? (
                  <label className="mt-1.5 block text-xs text-muted">
                    Nombre
                    <input
                      className={`${field} mt-1`}
                      defaultValue={page.title}
                      key={`${page.id}-${index}`}
                      onBlur={(event) => act((s) => renamePage(s, page.id, event.target.value))}
                    />
                  </label>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
        <div className="mt-2 flex gap-1">
          <input
            className={field}
            value={newPage}
            placeholder="Nueva página"
            onChange={(event) => setNewPage(event.target.value)}
          />
          <button
            type="button"
            className={btn}
            onClick={() => {
              act((s) => addPage(s, newPage));
              setNewPage("");
            }}
          >
            Añadir
          </button>
        </div>
      </section>

      <section>
        <h3 className="text-xs font-semibold uppercase tracking-[0.08em] text-muted">Catálogo</h3>
        <p className="mt-1 text-xs text-muted">
          Sólo lo que este estudio publica. No se escribe ningún identificador a mano.
        </p>
        <input
          className={`${field} mt-2`}
          value={query}
          placeholder="Buscar un resultado"
          onChange={(event) => setQuery(event.target.value)}
          aria-label="Buscar en el catálogo"
        />
        <div className="mt-2 flex flex-wrap gap-1">
          <button
            type="button"
            className={`${btn} px-2 text-xs`}
            onClick={() => act((s) => (s.openPageId ? addBlock(s, context, s.openPageId, { kind: "editorial" }) : s))}
          >
            + Texto
          </button>
          <button
            type="button"
            className={`${btn} px-2 text-xs`}
            onClick={() => act((s) => (s.openPageId ? addBlock(s, context, s.openPageId, { kind: "filter_panel" }) : s))}
          >
            + Panel de filtros
          </button>
        </div>
        <ul className="mt-2 max-h-80 space-y-1 overflow-y-auto pr-1">
          {entries.map((entry) => {
            const isGroup = entry.semantic === "journey_group";
            const isSlot = entry.semantic === "editorial_slot";
            const request: AddBlockRequest = isGroup
              ? { kind: "journey_routes", binding: entry.handle }
              : isSlot
                ? { kind: "editorial", slot: entry.handle }
                : { kind: "result", binding: entry.handle };
            const offered = offeredChartVariants(entry.semantic);
            const drawable = isSlot || offered.length > 0;
            return (
              <li key={entry.handle}>
                <button
                  type="button"
                  disabled={!drawable}
                  onClick={() => act((s) => (s.openPageId ? addBlock(s, context, s.openPageId, request) : s))}
                  className="min-h-11 w-full rounded-lg border border-line bg-surface px-2 py-1.5 text-left text-sm text-body hover:border-line-strong disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <span className="block [overflow-wrap:anywhere]">{entry.label}</span>
                  <span className="mt-0.5 block text-xs text-muted">
                    {drawable ? `${offered.length || 1} forma(s) disponible(s)` : "Esta versión aún no lo dibuja"}
                    {entry.availability === "configuration_required" ? " · pendiente de configuración" : ""}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}

/* -------------------------------------------------------------------------- */

function Canvas({
  chrome,
  page,
  state,
  act,
  resolvedById,
  stale,
  model,
  frameRef,
  room,
  effectiveZoom,
  zoomIsAutomatic,
}: {
  chrome: typeof DEFAULT_CHROME;
  page: ReturnType<typeof findPage>;
  state: ComposerState;
  act: (run: (s: ComposerState) => ComposerState) => void;
  resolvedById: Map<string, RenderBlock>;
  stale: boolean;
  model: PresentationRenderModel;
  frameRef: React.RefObject<HTMLDivElement | null>;
  room: number;
  effectiveZoom: CanvasZoom;
  zoomIsAutomatic: boolean;
}) {
  const [dragging, setDragging] = useState<string | null>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);

  const width = CANVAS_WIDTH[chrome.mode];
  const effective = effectiveZoom;
  const automatic = zoomIsAutomatic;
  const scale =
    effective === "fit"
      ? room === 0
        ? 1
        : Math.max(0.4, Math.min(1, room / width))
      : effective;

  if (!page) {
    return (
      <div className="rounded-2xl border border-line bg-surface p-6">
        <p className="text-sm text-muted">Abre una página en el panel de la izquierda.</p>
      </div>
    );
  }

  return (
    <div className="min-w-0">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-display text-lg font-semibold text-strong">{page.title}</h2>
        <p className="text-xs text-muted">
          {page.blocks.length} {page.blocks.length === 1 ? "bloque" : "bloques"} ·{" "}
          {ZOOM_LABEL[String(effective)]}
          {automatic ? " (automática)" : ""} · {model.pages.length}{" "}
          {model.pages.length === 1 ? "página resuelta" : "páginas resueltas"}
        </p>
      </div>

      {stale ? (
        <p className="mt-2 rounded-lg border border-caution-line bg-caution-surface px-3 py-2 text-sm text-caution">
          Las cifras que se ven abajo son las de la última resolución. La estructura sí está al día. Pulsa
          «Actualizar vista previa» para volver a resolver contra los resultados del estudio.
        </p>
      ) : null}

      {/*
        TWO NESTED BOXES. `transform: scale()` does not change layout, so the
        outer box carries the SCALED size and the inner one is the true previewed
        width under the transform. Without the outer box the page would reserve
        room for the unscaled canvas and gain a horizontal scrollbar the person
        just zoomed out to avoid.
      */}
      <div ref={frameRef} className="mt-3 min-w-0 overflow-x-auto">
        <div style={{ width: width * scale }}>
          <div
            style={{
              width,
              transform: `scale(${scale})`,
              transformOrigin: "top left",
              ["--canvas-scale" as string]: String(scale),
            }}
          >
            <div className="grid grid-cols-12 gap-4 rounded-2xl border border-line bg-surface-page p-4">
              {page.blocks.map((block, index) => (
                <BlockShell
                  key={block.id}
                  block={block}
                  index={index}
                  total={page.blocks.length}
                  selected={state.selectedBlockId === block.id}
                  resolved={resolvedById.get(block.id) ?? null}
                  stale={stale}
                  mode={chrome.mode}
                  act={act}
                  dragging={dragging}
                  dropIndex={dropIndex}
                  setDragging={setDragging}
                  setDropIndex={setDropIndex}
                />
              ))}
              {page.blocks.length === 0 ? (
                <p className="col-span-12 rounded-xl border border-dashed border-line-strong p-6 text-center text-sm text-muted">
                  Esta página está vacía. Añade un bloque desde el catálogo.
                </p>
              ) : null}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

const SPAN_CLASS: Record<number, string> = {
  1: "col-span-1", 2: "col-span-2", 3: "col-span-3", 4: "col-span-4",
  5: "col-span-5", 6: "col-span-6", 7: "col-span-7", 8: "col-span-8",
  9: "col-span-9", 10: "col-span-10", 11: "col-span-11", 12: "col-span-12",
};

/**
 * A block on the canvas: its chrome OUTSIDE the drawing, and the drawing inert.
 *
 * The handle, the name and the menu sit above the rendered block rather than on
 * top of it, and the drawing itself is `inert` so a click inside a chart selects
 * the block rather than operating the chart. A preview you can accidentally
 * interact with is a preview that lies about what a client will experience.
 */
function BlockShell({
  block,
  index,
  total,
  selected,
  resolved,
  stale,
  mode,
  act,
  dragging,
  dropIndex,
  setDragging,
  setDropIndex,
}: {
  block: PresentationBlock;
  index: number;
  total: number;
  selected: boolean;
  resolved: RenderBlock | null;
  stale: boolean;
  mode: CanvasMode;
  act: (run: (s: ComposerState) => ComposerState) => void;
  dragging: string | null;
  dropIndex: number | null;
  setDragging: (id: string | null) => void;
  setDropIndex: (index: number | null) => void;
}) {
  const [menu, setMenu] = useState(false);
  const span = mode === "mobile" ? GRID_COLUMNS : mode === "tablet" ? block.placement.span.tablet : block.placement.span.desktop;
  const title = block.copy.title ?? "Bloque sin título";

  return (
    <div
      className={`${SPAN_CLASS[span] ?? SPAN_CLASS[12]} min-w-0 ${dropIndex === index ? "border-t-2 border-evidence-line pt-1" : ""}`}
      onDragOver={(event) => {
        if (!dragging) return;
        event.preventDefault();
        const box = event.currentTarget.getBoundingClientRect();
        const after = event.clientY - box.top > box.height / 2;
        setDropIndex(index + (after ? 1 : 0));
      }}
      onDrop={(event) => {
        event.preventDefault();
        const moved = dragging ?? event.dataTransfer.getData("text/plain");
        const raw = dropIndex ?? index;
        if (moved) {
          // `raw` is the DROP LINE, page-local. Turning it into the index the
          // operation wants is `dropIndexFor`'s job, and it lives in the engine
          // so a gate can drive it — this handler once did the arithmetic itself
          // against an index from a flattened list of every page's blocks.
          act((s) => moveBlockToIndex(s, moved, dropIndexFor(s.document, moved, raw)));
        }
        setDragging(null);
        setDropIndex(null);
      }}
    >
      <div
        className={`rounded-xl border-2 ${selected ? "border-evidence" : "border-transparent"}`}
        onClick={() => act((s) => selectBlock(s, block.id))}
      >
        <div className="flex flex-wrap items-center gap-1 rounded-t-lg bg-surface-sunken px-2 py-1">
          <button
            type="button"
            draggable
            onDragStart={(event) => {
              setDragging(block.id);
              event.dataTransfer.setData("text/plain", block.id);
            }}
            onDragEnd={() => {
              setDragging(null);
              setDropIndex(null);
            }}
            onKeyDown={(event) => {
              if (event.key === "ArrowUp") {
                event.preventDefault();
                act((s) => moveBlock(s, block.id, -1));
              } else if (event.key === "ArrowDown") {
                event.preventDefault();
                act((s) => moveBlock(s, block.id, 1));
              }
            }}
            aria-label={`Mover «${title}». Usa las flechas arriba y abajo, o arrastra.`}
            style={{ minHeight: "calc(2.75rem / var(--canvas-scale, 1) + 1px)", minWidth: "calc(2.75rem / var(--canvas-scale, 1) + 1px)" }}
            className="cursor-grab rounded-md border border-line bg-surface px-2 text-sm text-muted"
          >
            ⠿
          </button>
          <span className="min-w-0 flex-1 truncate text-xs text-muted">
            {index + 1}/{total} · {title}
          </span>
          {!block.visible ? (
            <span className="rounded-full bg-line px-2 py-0.5 text-[0.65rem] font-semibold text-muted">Oculto</span>
          ) : null}
          <button
            type="button"
            aria-expanded={menu}
            aria-label={`Acciones de «${title}»`}
            onClick={(event) => {
              event.stopPropagation();
              setMenu((open) => !open);
            }}
            style={{ minHeight: "calc(2.75rem / var(--canvas-scale, 1) + 1px)", minWidth: "calc(2.75rem / var(--canvas-scale, 1) + 1px)" }}
            className="rounded-md border border-line bg-surface px-2 text-sm text-muted"
          >
            ⋯
          </button>
        </div>

        {menu ? (
          <div
            role="menu"
            onClick={(event) => event.stopPropagation()}
            className="flex flex-wrap gap-1 border-x border-line bg-surface px-2 py-1.5"
          >
            <button type="button" role="menuitem" className={`${btn} px-2 text-xs`} onClick={() => { act((s) => moveBlock(s, block.id, -1)); setMenu(false); }}>Subir</button>
            <button type="button" role="menuitem" className={`${btn} px-2 text-xs`} onClick={() => { act((s) => moveBlock(s, block.id, 1)); setMenu(false); }}>Bajar</button>
            <button type="button" role="menuitem" className={`${btn} px-2 text-xs`} onClick={() => { act((s) => duplicateBlock(s, block.id)); setMenu(false); }}>Duplicar</button>
            <button type="button" role="menuitem" className={`${btn} px-2 text-xs`} onClick={() => { act((s) => setBlockVisibility(s, block.id, !block.visible)); setMenu(false); }}>{block.visible ? "Ocultar" : "Mostrar"}</button>
            <button type="button" role="menuitem" className={`${btn} px-2 text-xs`} onClick={() => { act((s) => removeBlock(s, block.id)); setMenu(false); }}>Quitar</button>
          </div>
        ) : null}

        <div className="rounded-b-lg border border-line bg-surface p-1" inert>
          {resolved ? (
            <PresentationRenderer
              model={{
                schemaVersion: 4,
                contractVersion: "",
                registryVersion: "",
                title: "",
                locale: "es-MX",
                pages: [{ id: "one", title: "", order: 0, blocks: [{ ...resolved, placement: { ...resolved.placement, span: { desktop: 12, tablet: 12, mobile: 12 } } }] }],
              }}
              audience="internal"
            />
          ) : (
            <p className="rounded-lg border border-dashed border-line-strong bg-surface-sunken p-4 text-sm text-muted">
              {stale
                ? "Este bloque todavía no se ha previsualizado. Pulsa «Actualizar vista previa»."
                : "Este bloque no aparece en la última resolución."}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */

function Inspector({
  selected,
  state,
  act,
  context,
  payload,
}: {
  selected: ReturnType<typeof findBlock>;
  state: ComposerState;
  act: (run: (s: ComposerState) => ComposerState) => void;
  context: { catalog: ComposerPayload["catalog"] };
  payload: ComposerPayload;
}) {
  const authorId = useId();
  const [author, setAuthor] = useState("");
  const [rationale, setRationale] = useState("");

  if (!selected) {
    return (
      <div className="space-y-4">
        <p className="text-sm text-muted">Selecciona un bloque en el lienzo para ver su ficha.</p>
        <section className="rounded-lg border border-line bg-surface p-3">
          <h3 className="text-xs font-semibold uppercase tracking-[0.08em] text-muted">Documento</h3>
          <p className="mt-1 text-xs text-muted">
            Plano de partida: {payload.blueprint.label}. {payload.blueprint.because}
          </p>
          <label className="mt-3 block text-xs text-muted">
            Divulgación metodológica
            <select
              className={`${field} mt-1`}
              value={state.document.methodologyDisclosure}
              onChange={(event) => act((s) => setDocumentDisclosure(s, event.target.value as MethodologyDisclosureLevel))}
            >
              {METHODOLOGY_DISCLOSURE_LEVELS.map((level) => (
                <option key={level} value={level}>{level}</option>
              ))}
            </select>
          </label>
          <fieldset className="mt-3">
            <legend className="text-xs text-muted">Política de muestra del documento</legend>
            <p className="mt-1 text-xs text-muted">
              Ahora: <strong>{state.document.samplePolicy.mode}</strong>. Ocultar o anotar por base pequeña
              exige quién lo decide y por qué; nunca ocurre solo.
            </p>
            <label className="mt-2 block text-xs text-muted" htmlFor={`${authorId}-a`}>
              Quién lo decide
              <input id={`${authorId}-a`} className={`${field} mt-1`} value={author} onChange={(event) => setAuthor(event.target.value)} />
            </label>
            <label className="mt-2 block text-xs text-muted" htmlFor={`${authorId}-r`}>
              Por qué
              <input id={`${authorId}-r`} className={`${field} mt-1`} value={rationale} onChange={(event) => setRationale(event.target.value)} />
            </label>
            <div className="mt-2 flex flex-wrap gap-1">
              <button type="button" className={`${btn} px-2 text-xs`} onClick={() => act((s) => setDocumentSamplePolicy(s, { mode: "show_all" }))}>
                Mostrarlo todo
              </button>
              <button
                type="button"
                className={`${btn} px-2 text-xs`}
                onClick={() =>
                  act((s) =>
                    setDocumentSamplePolicy(s, {
                      mode: "annotate_below",
                      threshold: 5,
                      note: "Base pequeña.",
                      authoredBy: author,
                      rationale,
                    }),
                  )
                }
              >
                Anotar bajo 5
              </button>
              <button
                type="button"
                className={`${btn} px-2 text-xs`}
                onClick={() =>
                  act((s) =>
                    setDocumentSamplePolicy(s, {
                      mode: "hide_below",
                      threshold: 5,
                      authoredBy: author,
                      rationale,
                      publicNote: null,
                    }),
                  )
                }
              >
                Ocultar bajo 5
              </button>
            </div>
          </fieldset>
        </section>
      </div>
    );
  }

  const block = selected.block;
  const entry = block.kind === "result" ? payload.catalog.entries.find((e) => e.handle === block.binding) : null;
  const offered = entry ? offeredChartVariants(entry.semantic) : [];
  // A REVISION, SO AN UNDONE EDIT DOES NOT COME BACK ON THE NEXT BLUR.
  //
  // These fields are uncontrolled — a controlled one would commit per keystroke
  // and fill the sixty-step history with typing. Uncontrolled means the DOM keeps
  // the text, so after an undo the field still held the undone words and the next
  // blur wrote them back. Keying on the history depth remounts them whenever the
  // document moves, which is exactly when their default is stale. Typing does not
  // commit, so nothing remounts under the cursor.
  const revision = `${state.past.length}-${state.future.length}`;

  return (
    <div className="space-y-4">
      <section>
        <h3 className="text-xs font-semibold uppercase tracking-[0.08em] text-muted">Texto</h3>
        <label className="mt-2 block text-xs text-muted">
          Título
          <input
            className={`${field} mt-1`}
            defaultValue={block.copy.title ?? ""}
            key={`${block.id}-title-${revision}`}
            onBlur={(event) => act((s) => setBlockCopy(s, block.id, "title", event.target.value || null))}
          />
        </label>
        <label className="mt-2 block text-xs text-muted">
          Descripción
          <textarea
            className={`${field} mt-1 min-h-[5rem]`}
            defaultValue={block.copy.description ?? ""}
            key={`${block.id}-desc-${revision}`}
            onBlur={(event) => act((s) => setBlockCopy(s, block.id, "description", event.target.value || null))}
          />
        </label>
        {block.kind === "editorial" ? (
          <label className="mt-2 block text-xs text-muted">
            Cuerpo redactado
            <textarea
              className={`${field} mt-1 min-h-[7rem]`}
              defaultValue={block.content?.body ?? ""}
              key={`${block.id}-body-${revision}`}
              onBlur={(event) => act((s) => setEditorialBody(s, block.id, event.target.value || null))}
            />
          </label>
        ) : null}
      </section>

      {block.kind === "result" ? (
        <section>
          <h3 className="text-xs font-semibold uppercase tracking-[0.08em] text-muted">Resultado y forma</h3>
          <label className="mt-2 block text-xs text-muted">
            Qué mide
            <select
              className={`${field} mt-1`}
              value={block.binding}
              onChange={(event) => act((s) => setBlockBinding(s, context, block.id, event.target.value))}
            >
              {payload.catalog.entries
                .filter((candidate) => candidate.semantic !== "filter_dimension" && candidate.semantic !== "editorial_slot")
                .map((candidate) => (
                  <option key={candidate.handle} value={candidate.handle}>{candidate.label}</option>
                ))}
            </select>
          </label>
          <label className="mt-2 block text-xs text-muted">
            Cómo se dibuja
            <select
              className={`${field} mt-1`}
              value={block.chartVariant}
              onChange={(event) => act((s) => setChartVariant(s, context, block.id, event.target.value))}
            >
              {offered.map((variant) => (
                <option key={variant} value={variant}>{variant}</option>
              ))}
            </select>
          </label>
          <p className="mt-1 text-xs text-muted">
            Sólo aparecen las formas que son honestas para esta medición Y que esta versión dibuja.
          </p>
        </section>
      ) : null}

      {block.kind === "filter_panel" ? (
        <FilterPanelCard block={block} state={state} act={act} context={context} payload={payload} />
      ) : null}

      <section>
        <h3 className="text-xs font-semibold uppercase tracking-[0.08em] text-muted">Rejilla</h3>
        <div className="mt-2 grid grid-cols-2 gap-2">
          <label className="text-xs text-muted">
            Escritorio
            <select
              className={`${field} mt-1`}
              value={block.placement.span.desktop}
              onChange={(event) => act((s) => setBlockSpan(s, block.id, "desktop", Number(event.target.value)))}
            >
              {Array.from({ length: GRID_COLUMNS }, (_, i) => i + 1).map((n) => (
                <option key={n} value={n}>{n}</option>
              ))}
            </select>
          </label>
          <label className="text-xs text-muted">
            Tableta
            <select
              className={`${field} mt-1`}
              value={block.placement.span.tablet}
              onChange={(event) => act((s) => setBlockSpan(s, block.id, "tablet", Number(event.target.value)))}
            >
              {Array.from({ length: GRID_COLUMNS }, (_, i) => i + 1).map((n) => (
                <option key={n} value={n}>{n}</option>
              ))}
            </select>
          </label>
        </div>
        <p className="mt-1 text-xs text-muted">
          En teléfono cada bloque ocupa el ancho completo; eso no se ajusta.
        </p>
        <label className="mt-2 block text-xs text-muted">
          Si no cabe
          <select
            className={`${field} mt-1`}
            value={block.placement.responsive}
            onChange={(event) => act((s) => setBlockResponsive(s, block.id, event.target.value as "reflow" | "stack" | "scroll_x"))}
          >
            <option value="reflow">Pasa a su propia fila</option>
            <option value="stack">Apila sus partes</option>
            <option value="scroll_x">Se desplaza dentro de su caja</option>
          </select>
        </label>
        <label className="mt-2 block text-xs text-muted">
          Decimales
          <select
            className={`${field} mt-1`}
            value={block.displayFormat.kind === "fixed_decimals" ? String(block.displayFormat.decimals) : "canonical"}
            onChange={(event) =>
              act((s) =>
                setBlockDisplayFormat(
                  s,
                  block.id,
                  event.target.value === "canonical"
                    ? { kind: "canonical" }
                    : { kind: "fixed_decimals", decimals: Number(event.target.value) },
                ),
              )
            }
          >
            <option value="canonical">Como los da el estudio</option>
            <option value="0">0</option>
            <option value="1">1</option>
            <option value="2">2</option>
          </select>
        </label>
        <p className="mt-1 text-xs text-muted">
          Sólo rellena con ceros. Nunca acorta ni redondea: pedir menos decimales de los que la medición
          declara se rechaza.
        </p>
      </section>

      <section>
        <h3 className="text-xs font-semibold uppercase tracking-[0.08em] text-muted">Divulgación</h3>
        <label className="mt-2 block text-xs text-muted">
          Nivel de este bloque
          <select
            className={`${field} mt-1`}
            value={block.methodologyDisclosure ?? ""}
            onChange={(event) =>
              act((s) => setBlockDisclosure(s, block.id, event.target.value === "" ? null : (event.target.value as MethodologyDisclosureLevel)))
            }
          >
            <option value="">Heredar el del documento</option>
            {METHODOLOGY_DISCLOSURE_LEVELS.map((level) => (
              <option key={level} value={level}>{level}</option>
            ))}
          </select>
        </label>
        <button
          type="button"
          className={`${btn} mt-2 px-2 text-xs`}
          onClick={() => act((s) => setBlockSamplePolicy(s, block.id, null))}
        >
          Heredar la política de muestra del documento
        </button>
      </section>
    </div>
  );
}

/**
 * THE PANEL CARD IS THE CONNECTION EDITOR, and the block card is read-only
 * about it.
 *
 * Putting a checkbox list of every block on every panel-eligible block is what
 * the legacy builder did, and it produced thirteen tick boxes on a paragraph.
 * The decision "what does this panel move" is one decision, made once, where
 * the panel is.
 */
function FilterPanelCard({
  block,
  state,
  act,
  context,
  payload,
}: {
  block: PresentationBlock & { kind: "filter_panel" };
  state: ComposerState;
  act: (run: (s: ComposerState) => ComposerState) => void;
  context: { catalog: ComposerPayload["catalog"] };
  payload: ComposerPayload;
}) {
  const dimensions = payload.catalog.entries.filter((entry) => entry.semantic === "filter_dimension");
  const candidates = connectionCandidates(state.document, context, block.id);

  return (
    <section>
      <h3 className="text-xs font-semibold uppercase tracking-[0.08em] text-muted">Qué ofrece este panel</h3>
      <ul className="mt-2 space-y-1">
        {dimensions.map((dimension) => {
          const offered = block.dimensions.includes(dimension.handle);
          return (
            <li key={dimension.handle}>
              <label className="flex min-h-11 items-center gap-2 rounded-lg border border-line bg-surface px-2 text-sm text-body">
                <input
                  type="checkbox"
                  checked={offered}
                  onChange={(event) => act((s) => togglePanelDimension(s, context, block.id, dimension.handle, event.target.checked))}
                />
                {dimension.label}
              </label>
            </li>
          );
        })}
      </ul>

      <h3 className="mt-4 text-xs font-semibold uppercase tracking-[0.08em] text-muted">Qué mueve</h3>
      <p className="mt-1 text-xs text-muted">
        Compartir una característica nunca es una conexión. Un filtro mueve un bloque porque alguien lo
        escribió aquí.
      </p>
      <ul className="mt-2 space-y-1">
        {candidates.eligible.map(({ block: target, connected }) => (
          <li key={target.id}>
            <label className="flex min-h-11 items-center gap-2 rounded-lg border border-line bg-surface px-2 text-sm text-body">
              <input
                type="checkbox"
                checked={connected}
                onChange={(event) =>
                  act((s) =>
                    event.target.checked
                      ? connectBlockToPanel(s, context, target.id, block.id)
                      : disconnectBlockFromPanel(s, target.id, block.id),
                  )
                }
              />
              <span className="min-w-0 [overflow-wrap:anywhere]">{target.copy.title ?? target.id}</span>
            </label>
          </li>
        ))}
      </ul>
      {candidates.ineligible.length > 0 ? (
        <details className="mt-2">
          <summary className="min-h-11 cursor-pointer text-xs text-muted">
            No se pueden conectar ({candidates.ineligible.length})
          </summary>
          <ul className="mt-1 space-y-1 text-xs text-muted">
            {candidates.ineligible.map(({ block: target, reason }) => (
              <li key={target.id}>
                <span className="[overflow-wrap:anywhere]">{target.copy.title ?? target.id}</span> —{" "}
                {reason === "block_not_filterable"
                  ? "es contenido fijo: no muestra ningún número que un filtro pueda cambiar."
                  : reason === "forbidden_filter_cross"
                    ? "una autoridad del estudio prohíbe cruzar esta característica con esa medición."
                    : reason === "unsupported_filter_dimension"
                      ? "esa medición no se puede desglosar por una de las características del panel."
                      : "no está en el catálogo de este estudio."}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </section>
  );
}
