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
  useTransition,
} from "react";

import { blockCatalogue, blockSpec, type BlockType } from "@/lib/experience/blocks";
import { CHART_SPECS, compatibleVariants, isRendererImplemented, type ChartVariant } from "@/lib/experience/charts";
import { canAddBlock } from "@/lib/experience/defaults";
import {
  filtersAffecting,
  findBlock,
  parseExperienceDefinition,
  type ExperienceBlock,
  type ExperienceDefinitionV1,
  type ExperiencePage,
} from "@/lib/experience/definition";
import type { BlockDataSet } from "@/lib/experience/data";
import {
  addBlock,
  addPage,
  adoptDefinition,
  canRedo,
  canUndo,
  duplicateBlock,
  duplicatePage,
  initialState,
  moveBlock,
  moveBlockToIndex,
  movePage,
  openPage,
  redo,
  removeBlock,
  removePage,
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
  setChartVariant,
  setFilterConnection,
  setPageVisibility,
  setStudySamplePolicy,
  undo,
  type EditorState,
} from "@/lib/experience/editor";
import {
  BREAKPOINTS,
  BREAKPOINT_WIDTHS,
  GRID_COLUMNS,
  responsiveSpanClass,
  type Breakpoint,
} from "@/lib/experience/layout";
import { findMetric, type Aggregation, type SemanticRegistry } from "@/lib/experience/registry";
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
  saveDraft,
  refreshData,
}: {
  payload: BuilderClientPayload;
  exitHref: string;
  previewHref: string;
  saveDraft: SaveDraftAction;
  refreshData: RefreshDataAction;
}) {
  const { study, registry, adapted, adapterWarnings, evidence } = payload;
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
  const [leftOpen, setLeftOpen] = useState(true);
  const [rightOpen, setRightOpen] = useState(true);
  const [drawer, setDrawer] = useState<"none" | "left" | "right">("none");
  const [pendingType, setPendingType] = useState<BlockType>("rich_text");
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
        onToggleLeft={() => setLeftOpen((open) => !open)}
        onToggleRight={() => setRightOpen((open) => !open)}
        onOpenDrawer={setDrawer}
        leftOpen={leftOpen}
        rightOpen={rightOpen}
        exitHref={exitHref}
        previewHref={previewHref}
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

      <div className="grid min-w-0 gap-4 lg:grid-cols-[auto_minmax(0,1fr)] xl:grid-cols-[auto_minmax(0,1fr)_auto]">
        <Panel
          side="left"
          label="Páginas y catálogo de bloques"
          open={leftOpen}
          drawerOpen={drawer === "left"}
          onClose={() => setDrawer("none")}
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
        <div role="region" aria-label="Lienzo de la página" className="min-w-0">
          {page ? (
            <Canvas
              page={page}
              definition={definition}
              registry={registry}
              data={data}
              evidence={evidence}
              study={study}
              breakpoint={preview}
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
          open={rightOpen}
          drawerOpen={drawer === "right"}
          onClose={() => setDrawer("none")}
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
              onConnection={(filterId, connected) =>
                act(
                  (current) => setFilterConnection(current, filterId, selected.block.id, connected),
                  connected ? "El filtro ahora mueve este bloque." : "El filtro ya no mueve este bloque.",
                )
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
  onPreview,
  canUndo: undoable,
  canRedo: redoable,
  onUndo,
  onRedo,
  onSave,
  onDownload,
  onToggleLeft,
  onToggleRight,
  onOpenDrawer,
  leftOpen,
  rightOpen,
  exitHref,
  previewHref,
}: {
  status: SaveStatus;
  statusMessage: string | null;
  dirty: boolean;
  revision: number | null;
  blocking: number;
  pages: number;
  blocks: number;
  preview: Breakpoint;
  onPreview: (breakpoint: Breakpoint) => void;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onSave: () => void;
  onDownload: () => void;
  onToggleLeft: () => void;
  onToggleRight: () => void;
  onOpenDrawer: (drawer: "left" | "right") => void;
  leftOpen: boolean;
  rightOpen: boolean;
  exitHref: string;
  previewHref: string;
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

        <span className="ml-auto flex flex-wrap gap-2">
          <Link href={previewHref} className={button}>
            Vista del cliente
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
        <button type="button" className={`${button} hidden lg:inline-flex`} onClick={onToggleLeft} aria-pressed={leftOpen}>
          {leftOpen ? "Ocultar páginas" : "Mostrar páginas"}
        </button>
        <button type="button" className={`${button} hidden xl:inline-flex`} onClick={onToggleRight} aria-pressed={rightOpen}>
          {rightOpen ? "Ocultar ficha" : "Mostrar ficha"}
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
  children,
}: {
  side: "left" | "right";
  label: string;
  open: boolean;
  drawerOpen: boolean;
  onClose: () => void;
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
  const dock = side === "left"
    ? { column: open ? "lg:flex" : "lg:hidden", header: "lg:hidden", chrome: "lg:static lg:z-auto lg:w-64 lg:border-0 lg:bg-transparent lg:p-0 lg:shadow-none xl:w-72" }
    : { column: open ? "xl:flex" : "xl:hidden", header: "xl:hidden", chrome: "xl:static xl:z-auto xl:w-80 xl:border-0 xl:bg-transparent xl:p-0 xl:shadow-none" };

  return (
    <aside
      aria-label={label}
      className={[
        drawerOpen ? "flex" : "hidden",
        dock.column,
        "fixed inset-y-0 z-40 w-[min(22rem,88vw)] flex-col gap-4 overflow-y-auto border-line bg-surface-page p-4 shadow-lifted",
        side === "left" ? "left-0 border-r" : "right-0 border-l",
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
function Menu({ label, children }: { label: string; children: React.ReactNode }) {
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
        <ul className="mt-3 grid min-w-0 grid-cols-12 gap-3">
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
      )}
    </section>
  );
}

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
          className="flex min-h-11 min-w-11 cursor-grab items-center justify-center rounded-md text-muted hover:bg-surface-sunken active:cursor-grabbing"
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
          onClick={onSelect}
          aria-current={selected ? "true" : undefined}
          className="flex min-h-11 min-w-11 flex-1 basis-24 flex-col justify-center rounded-md px-1 text-left"
        >
          <span className="block truncate text-sm font-semibold text-strong">{name}</span>
          <span className="block truncate text-xs text-muted">
            {spec.label} · {block.layout[breakpoint].span} de {GRID_COLUMNS}
            {hidden ? " · oculto" : ""}
          </span>
        </button>

        <Menu label={`Acciones de “${name}”`}>
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
  onConnection,
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
  onConnection: (filterId: string, connected: boolean) => void;
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
  const connected = new Set(filtersAffecting(definition, block.id));

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

        {/* --- Which filters move it -------------------------------------- */}
        {definition.filterDefinitions.length > 0 ? (
          <section>
            <h3 className="text-sm font-semibold text-strong">Qué filtros lo mueven</h3>
            <p className="mt-1 text-xs text-muted">
              Un filtro mueve un bloque solo cuando alguien lo dice aquí. Compartir una
              característica no basta.
            </p>
            <ul className="mt-2 space-y-1">
              {definition.filterDefinitions.map((filter) => (
                <li key={filter.id}>
                  <label className="flex min-h-11 cursor-pointer items-center gap-2.5 rounded-lg px-1 text-sm text-body hover:bg-surface-sunken">
                    <input
                      type="checkbox"
                      className="h-4 w-4 shrink-0"
                      checked={connected.has(filter.id)}
                      onChange={(event) => onConnection(filter.id, event.target.checked)}
                    />
                    <span className="min-w-0 truncate">{filter.label}</span>
                  </label>
                </li>
              ))}
            </ul>
          </section>
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
