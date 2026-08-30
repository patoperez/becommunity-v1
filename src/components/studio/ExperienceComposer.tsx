"use client";

import { useId, useMemo, useRef, useState } from "react";

import { blockCatalogue, blockSpec, type BlockType } from "@/lib/experience/blocks";
import {
  CHART_SPECS,
  compatibleVariants,
  renderableVariant,
  type ChartVariant,
} from "@/lib/experience/charts";
import { canAddBlock } from "@/lib/experience/defaults";
import {
  filtersAffecting,
  findBlock,
  parseExperienceDefinition,
  type ExperienceBlock,
  type ExperienceDefinitionV1,
  type ExperiencePage,
} from "@/lib/experience/definition";
import {
  BREAKPOINTS,
  BREAKPOINT_WIDTHS,
  responsiveSpanClass,
  type Breakpoint,
} from "@/lib/experience/layout";
import {
  addBlock,
  duplicateBlock,
  initialState,
  moveBlock,
  removeBlock,
  resetPrototype,
  selectBlock,
  setBlockSamplePolicy,
  setBlockTitle,
  setBlockVisibility,
  setChartVariant,
  setStudySamplePolicy,
} from "@/lib/experience/prototype";
import {
  findDimension,
  findMetric,
  type SemanticMetric,
  type SemanticRegistry,
} from "@/lib/experience/registry";
import {
  evaluateSampleVisibility,
  resolveSamplePolicy,
  SAMPLE_POLICY_MODES,
  SAMPLE_POLICY_VERSION,
  type SamplePolicyMode,
} from "@/lib/experience/sample-policy";
import { serializeExperienceDefinition } from "@/lib/experience/serialize";
import { validateExperienceDefinition } from "@/lib/experience/validate";

/**
 * "Construcción del dashboard" — the internal prototype.
 *
 * WHAT IT IS FOR. Before anything is built to STORE a composed experience, the
 * team has to know whether the mental model is right: does thinking in pages,
 * blocks, connections and a disclosure policy match how a consultant actually
 * wants to assemble a client's study? That question is answered by moving
 * things around and looking at the result, not by reading a schema. So this
 * screen loads a real study through the compatibility adapter and lets somebody
 * rearrange it.
 *
 * WHAT IT DELIBERATELY IS NOT. It saves nothing. There is no autosave, no
 * Server Action, no draft, no publication, no `fetch`. Closing or reloading the
 * tab discards everything, which is stated on the screen rather than left to be
 * discovered. Every edit is a pure function from
 * `src/lib/experience/prototype.ts`; this component holds one state object and
 * calls them.
 *
 * THE ARRANGEMENT IS THE ARGUMENT. Pages and the block catalogue on the left,
 * the composition in the middle, the selected block's properties on the right,
 * and the prototype's status across the top. It is the shape the real builder
 * will have, so what the owner judges here is the thing that gets built — not a
 * list of controls standing in for it. Below `lg` the three columns become one,
 * in reading order, because a phone has room for one.
 *
 * WHAT THE MIDDLE COLUMN SHOWS, AND WHAT IT DOES NOT. It draws the STRUCTURE of
 * the page — which block, how wide, in what order, with which result and which
 * breakdown — at whichever width is being previewed. It does NOT draw the
 * study's numbers: this slice reads no aggregation, so a preview with numbers
 * in it would be a preview with invented numbers in it. Every result frame says
 * so, and a variant with no renderer yet says that too, next to the
 * representation that stands in for it.
 *
 * The technical vocabulary stays out of the interface. A block is named by what
 * it is ("Gráfica", "Recorrido"), never by its type token; a result is named by
 * what it measures, never by its handle; and the serialized document is
 * reachable only through a download, never rendered on screen.
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

const button =
  "inline-flex min-h-11 items-center justify-center rounded-lg border border-line-strong bg-surface px-3 py-2 text-sm font-medium text-strong transition-colors duration-[var(--motion-state)] hover:bg-surface-sunken disabled:cursor-not-allowed disabled:opacity-45";

const smallButton =
  "inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg border border-line px-2.5 py-1.5 text-xs font-medium text-strong transition-colors duration-[var(--motion-state)] hover:bg-surface-sunken disabled:cursor-not-allowed disabled:opacity-40";

const field =
  "min-h-11 w-full rounded-lg border border-line-strong bg-surface px-3 py-2 text-sm text-strong";

export function ExperienceComposer({
  original,
  registry,
  adapterWarnings,
}: {
  original: ExperienceDefinitionV1;
  registry: SemanticRegistry;
  adapterWarnings: { code: string; detail: string }[];
}) {
  const [state, setState] = useState(() => initialState(original));
  const ids = useId().replace(/[^a-zA-Z0-9]/g, "");
  const { definition, selectedBlockId } = state;

  /** Which page is on the canvas. An id, never an index: pages can be reordered. */
  const [openPageId, setOpenPageId] = useState<string | null>(
    () => original.pages[0]?.id ?? null,
  );
  /** Which width the canvas is drawn at. */
  const [preview, setPreview] = useState<Breakpoint>("desktop");
  const [pendingType, setPendingType] = useState<BlockType>("rich_text");
  /** What the last deliberate action did, for the live region. */
  const [confirmation, setConfirmation] = useState<string | null>(null);
  const downloadRef = useRef<HTMLAnchorElement | null>(null);

  const schemaIssues = useMemo(() => {
    const parsed = parseExperienceDefinition(definition);
    return parsed.ok ? [] : parsed.issues;
  }, [definition]);

  const report = useMemo(
    () => validateExperienceDefinition(definition, registry),
    [definition, registry],
  );

  // A linear scan over a few dozen blocks, computed on every render on purpose:
  // it is cheaper than the memo that would guard it, and the React compiler
  // cannot preserve a manual memo whose body returns early.
  const selected = selectedBlockId ? findBlock(definition, selectedBlockId) : null;

  const page: ExperiencePage | null =
    definition.pages.find((candidate) => candidate.id === openPageId) ?? definition.pages[0] ?? null;

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
  const blocking = schemaIssues.length + report.errors.length;

  /** Every action goes through here, so a refusal is always announced. */
  function act(operation: (current: typeof state) => typeof state, done: string) {
    setState((current) => {
      const next = operation(current);
      setConfirmation(next.refusal ?? done);
      return next;
    });
  }

  function download() {
    const contents = serializeExperienceDefinition(definition, { pretty: true });
    const blob = new Blob([contents], { type: "application/json;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = downloadRef.current;
    if (!link) return;
    link.href = url;
    link.download = "construccion-prototipo.json";
    link.click();
    // Revoking in the same tick cancels the download in some browsers. The
    // handle is released on the next turn of the event loop instead.
    setTimeout(() => URL.revokeObjectURL(url), 0);
    setConfirmation(
      `Se descargó la versión que tienes en pantalla: ${definition.pages.length} páginas y ${totalBlocks} bloques. Sigue sin guardarse nada.`,
    );
  }

  const policy = definition.sampleVisibilityPolicy;

  return (
    <div className="space-y-5">
      {/* ---- Top: what this is, what state it is in, what you can do to it -- */}
      <section className="rounded-xl border border-caution-line bg-caution-surface p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-caution">
              Solo para el equipo de Be Community · prototipo
            </p>
            <h2 className="mt-1 font-display text-lg font-semibold text-caution">
              Nada de lo que hagas aquí se guarda ni se publica
            </h2>
            <p className="mt-1 max-w-prose text-sm text-caution">
              Esta pantalla arma el estudio actual con el modelo nuevo para ver si la forma de
              trabajar es la correcta. Los cambios viven solo mientras la pestaña esté abierta: al
              recargar vuelve a aparecer la configuración real del estudio, que no se toca en ningún
              momento. El cliente no ve esta pantalla ni nada de lo que hagas en ella.
            </p>
            <p className="mt-2 text-sm text-caution">
              <span className="font-semibold">
                {definition.pages.length === 1
                  ? "1 página"
                  : `${definition.pages.length} páginas`}
                {" · "}
                {totalBlocks === 1 ? "1 bloque" : `${totalBlocks} bloques`}
              </span>
              {" · "}
              {blocking > 0
                ? "hay algo que impediría guardar esta experiencia"
                : "la experiencia es válida tal como está"}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className={button}
              onClick={() => {
                setState((current) => resetPrototype(current, original));
                setOpenPageId(original.pages[0]?.id ?? null);
                setConfirmation("Volvió a aparecer la configuración real del estudio.");
              }}
            >
              Volver a la configuración actual
            </button>
            <button type="button" className={button} onClick={download}>
              Descargar esta versión
            </button>
            {/* The one way the document leaves the screen. Never rendered. */}
            <a ref={downloadRef} className="sr-only" aria-hidden="true" tabIndex={-1} href="#">
              Descarga
            </a>
          </div>
        </div>

        <fieldset className="mt-4">
          <legend className="text-sm font-medium text-caution">Ver la página como se vería en</legend>
          <div className="mt-1.5 flex flex-wrap gap-2">
            {BREAKPOINTS.map((breakpoint) => (
              <button
                key={breakpoint}
                type="button"
                aria-pressed={preview === breakpoint}
                onClick={() => {
                  setPreview(breakpoint);
                  setConfirmation(
                    `La composición se muestra como en ${BREAKPOINT_LABEL[breakpoint].toLowerCase()}.`,
                  );
                }}
                className={`${smallButton} ${
                  preview === breakpoint
                    ? "border-evidence-line bg-evidence-surface text-evidence"
                    : "bg-surface"
                }`}
              >
                {BREAKPOINT_LABEL[breakpoint]} ({BREAKPOINT_WIDTHS[breakpoint]} px)
              </button>
            ))}
          </div>
        </fieldset>

        <p aria-live="polite" className="mt-3 min-h-5 text-sm text-caution">
          {state.refusal ?? confirmation ?? ""}
        </p>
      </section>

      {/* ---- The three columns ------------------------------------------- */}
      <div className="grid gap-5 lg:grid-cols-[15rem_minmax(0,1fr)] xl:grid-cols-[15rem_minmax(0,1fr)_21rem]">
        {/* ---- Left: pages and the catalogue ----------------------------- */}
        <div className="min-w-0 space-y-4">
          <nav
            aria-label="Páginas de la experiencia"
            className="rounded-xl border border-line bg-surface p-3"
          >
            <h2 className="px-1 font-display text-sm font-semibold text-strong">Páginas</h2>
            <ul className="mt-2 space-y-1">
              {definition.pages.map((entry) => (
                <li key={entry.id}>
                  <button
                    type="button"
                    aria-current={entry.id === page?.id ? "page" : undefined}
                    onClick={() => {
                      setOpenPageId(entry.id);
                      setConfirmation(`Estás viendo “${entry.title}”.`);
                    }}
                    className={`flex min-h-11 w-full min-w-0 items-center justify-between gap-2 rounded-lg px-3 py-2 text-left text-sm ${
                      entry.id === page?.id
                        ? "bg-evidence-surface font-semibold text-evidence"
                        : "text-body hover:bg-surface-sunken"
                    }`}
                  >
                    <span className="min-w-0 truncate">{entry.title}</span>
                    <span className="shrink-0 text-xs text-muted">{entry.blocks.length}</span>
                  </button>
                </li>
              ))}
            </ul>
          </nav>

          {page ? (
            <div className="rounded-xl border border-line bg-surface p-3">
              <h2 className="px-1 font-display text-sm font-semibold text-strong">
                Catálogo de bloques
              </h2>
              <p className="mt-1 px-1 text-xs text-muted">
                Solo aparecen los que este estudio puede sostener con los resultados que tiene.
              </p>
              <div className="mt-2 px-1">
                <label
                  htmlFor={`${ids}-add-${page.id}`}
                  className="block text-sm font-medium text-strong"
                >
                  Añadir a “{page.title}”
                </label>
                <select
                  id={`${ids}-add-${page.id}`}
                  value={pendingType}
                  onChange={(event) => setPendingType(event.target.value as BlockType)}
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
                <button
                  type="button"
                  className={`${button} mt-2 w-full`}
                  onClick={() =>
                    act(
                      (current) => addBlock(current, page.id, pendingType, registry),
                      `Se añadió “${blockSpec(pendingType).label}” al final de “${page.title}”.`,
                    )
                  }
                >
                  Añadir bloque
                </button>
              </div>
            </div>
          ) : null}

          {/* ---- The study-wide disclosure rule ------------------------- */}
          <section className="rounded-xl border border-line bg-surface p-3">
            <h2 className="px-1 font-display text-sm font-semibold text-strong">
              Cuándo se muestra un resultado con pocas respuestas
            </h2>
            <p className="mt-1 px-1 text-xs text-muted">
              Esta regla vale para todo el estudio. Un bloque puede tener la suya propia, y en ese
              caso manda la del bloque.
            </p>
            <fieldset className="mt-2 px-1">
              <legend className="sr-only">Regla del estudio</legend>
              <div className="space-y-2">
                {SAMPLE_POLICY_MODES.map((mode) => (
                  <label
                    key={mode}
                    className={`flex min-h-11 cursor-pointer items-start gap-3 rounded-lg border p-2.5 ${
                      policy.mode === mode
                        ? "border-evidence-line bg-evidence-surface"
                        : "border-line bg-surface hover:bg-surface-sunken"
                    }`}
                  >
                    <input
                      type="radio"
                      name={`${ids}-policy`}
                      value={mode}
                      checked={policy.mode === mode}
                      onChange={() =>
                        act(
                          (current) => setStudySamplePolicy(current, mode),
                          `La regla del estudio ahora es: ${MODE_LABEL[mode].toLowerCase()}.`,
                        )
                      }
                      className="mt-1 size-4"
                    />
                    <span className="min-w-0">
                      <span className="block text-sm font-semibold text-strong">
                        {MODE_LABEL[mode]}
                      </span>
                      <span className="block text-xs text-muted">{MODE_DETAIL[mode]}</span>
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>
            {policy.mode === "show_all" ? null : (
              <p className="mt-3 flex flex-wrap items-center gap-2 px-1 text-sm text-body">
                <label htmlFor={`${ids}-threshold`} className="font-medium text-strong">
                  Mínimo de respuestas
                </label>
                <input
                  id={`${ids}-threshold`}
                  type="number"
                  min={1}
                  max={200}
                  value={policy.threshold}
                  onChange={(event) =>
                    act(
                      (current) =>
                        setStudySamplePolicy(
                          current,
                          policy.mode,
                          Number(event.target.value) || 1,
                        ),
                      "Se cambió el mínimo de respuestas del estudio.",
                    )
                  }
                  className="min-h-11 w-24 rounded-lg border border-line-strong bg-surface px-3 py-2 text-sm text-strong"
                />
              </p>
            )}
            <p className="mt-2 px-1 text-xs text-muted">
              Con esta regla, un resultado con una sola respuesta{" "}
              <strong className="font-semibold text-strong">
                {describeOutcome(evaluateSampleVisibility(1, policy).state)}
              </strong>
              {"; "}
              con cuatro{" "}
              <strong className="font-semibold text-strong">
                {describeOutcome(evaluateSampleVisibility(4, policy).state)}
              </strong>
              .
            </p>
            <p className="mt-2 px-1 text-xs text-muted">
              Cambiar esta regla aquí no cambia lo que el cliente ve hoy. El estudio publicado sigue
              funcionando exactamente igual hasta que alguien lo cambie en su configuración real.
            </p>
          </section>
        </div>

        {/* ---- Middle: the composition ---------------------------------- */}
        <div className="min-w-0">
          {page ? (
            <PageCanvas
              page={page}
              breakpoint={preview}
              registry={registry}
              selectedBlockId={selectedBlockId}
              onSelect={(blockId) =>
                setState((current) => selectBlock(current, blockId))
              }
              onMove={(block, direction) =>
                act(
                  (current) => moveBlock(current, block.id, direction),
                  `Se movió “${blockName(block)}” ${direction === "up" ? "hacia arriba" : "hacia abajo"}.`,
                )
              }
              onDuplicate={(block) =>
                act(
                  (current) => duplicateBlock(current, block.id),
                  `Se duplicó “${blockName(block)}”. La copia no hereda ningún filtro.`,
                )
              }
              onToggle={(block) =>
                act(
                  (current) => setBlockVisibility(current, block.id, !block.visible),
                  block.visible
                    ? `“${blockName(block)}” queda oculto.`
                    : `“${blockName(block)}” vuelve a mostrarse.`,
                )
              }
              onRemove={(block) =>
                act(
                  (current) => removeBlock(current, block.id),
                  `Se quitó “${blockName(block)}” del prototipo.`,
                )
              }
            />
          ) : (
            <p className="rounded-xl border border-dashed border-line bg-surface px-4 py-6 text-sm text-muted">
              Esta experiencia todavía no tiene páginas.
            </p>
          )}
        </div>

        {/* ---- Right: the selected block -------------------------------- */}
        <aside className="min-w-0 xl:col-start-3 xl:row-start-1">
          <div className="rounded-xl border border-line bg-surface p-4 xl:sticky xl:top-4">
            <h2 className="font-display text-base font-semibold text-strong">Bloque seleccionado</h2>
            {selected ? (
              <BlockInspector
                key={selected.block.id}
                block={selected.block}
                pageTitle={selected.page.title}
                registry={registry}
                definition={definition}
                idPrefix={ids}
                onTitle={(title) =>
                  setState((current) => setBlockTitle(current, selected.block.id, title))
                }
                onVariant={(variant) =>
                  act(
                    (current) => setChartVariant(current, selected.block.id, variant),
                    `“${blockName(selected.block)}” ahora se dibuja como ${CHART_SPECS[
                      variant
                    ].label.toLowerCase()}.`,
                  )
                }
                onSamplePolicy={(override, said) =>
                  act(
                    (current) => setBlockSamplePolicy(current, selected.block.id, override),
                    said,
                  )
                }
              />
            ) : (
              <p className="mt-2 text-sm text-muted">
                Elige un bloque de la composición para ver de dónde sale su número, qué filtros lo
                mueven y cómo se acomoda en cada pantalla.
              </p>
            )}
          </div>
        </aside>
      </div>

      {/* ---- What the model could and could not say ---------------------- */}
      <ValidationPanel
        schemaIssues={schemaIssues}
        errors={report.errors}
        warnings={report.warnings}
        adapterWarnings={adapterWarnings}
      />
    </div>
  );
}

function describeOutcome(state: string): string {
  if (state === "visible") return "se muestra";
  if (state === "warning") return "se muestra con aviso";
  if (state === "suppressed") return "no se muestra";
  return "no tiene datos";
}

function blockName(block: ExperienceBlock): string {
  return block.title ?? blockSpec(block.type as BlockType).label;
}

// ---------------------------------------------------------------------------
// The composition
// ---------------------------------------------------------------------------

/**
 * One page, drawn at one width.
 *
 * Order and span come from the block's own placement at this breakpoint, and
 * the twelve-column grid is the same one the model declares — so what is on
 * screen is the arrangement the document describes, not a second interpretation
 * of it. A block that is hidden stays in place, dimmed and labelled: an editor
 * that made a hidden block disappear would be an editor that could not bring it
 * back.
 */
function PageCanvas({
  page,
  breakpoint,
  registry,
  selectedBlockId,
  onSelect,
  onMove,
  onDuplicate,
  onToggle,
  onRemove,
}: {
  page: ExperiencePage;
  breakpoint: Breakpoint;
  registry: SemanticRegistry;
  selectedBlockId: string | null;
  onSelect: (blockId: string) => void;
  onMove: (block: ExperienceBlock, direction: "up" | "down") => void;
  onDuplicate: (block: ExperienceBlock) => void;
  onToggle: (block: ExperienceBlock) => void;
  onRemove: (block: ExperienceBlock) => void;
}) {
  const ordered = page.blocks
    .map((block, index) => ({ block, index }))
    .sort((a, b) => {
      const byOrder = a.block.layout[breakpoint].order - b.block.layout[breakpoint].order;
      return byOrder !== 0 ? byOrder : a.index - b.index;
    });

  return (
    <section className="rounded-xl border border-line bg-surface-sunken p-3 sm:p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-display text-base font-semibold text-strong">{page.title}</h2>
        <p className="text-xs text-muted">
          {BREAKPOINT_LABEL[breakpoint]} · {page.blocks.length === 1
            ? "1 bloque"
            : `${page.blocks.length} bloques`}
        </p>
      </div>
      <p className="mt-1 text-xs text-muted">
        Esta es la estructura de la página, no sus números: el prototipo no calcula nada del estudio.
      </p>
      <p className="mt-1 text-xs text-muted sm:hidden">
        En una pantalla de este ancho los bloques se muestran uno debajo de otro. El ancho que le
        toca a cada uno en “{BREAKPOINT_LABEL[breakpoint]}” está escrito en su ficha.
      </p>

      {page.blocks.length === 0 ? (
        <p className="mt-3 rounded-lg border border-dashed border-line bg-surface px-4 py-6 text-sm text-muted">
          Esta página todavía no tiene bloques. Añade uno desde el catálogo.
        </p>
      ) : (
        <ul className="mt-3 grid grid-cols-12 gap-3">
          {ordered.map(({ block, index }) => (
            <li
              key={block.id}
              className={`${responsiveSpanClass(block.layout[breakpoint].span)} min-w-0`}
            >
              <CanvasBlock
                block={block}
                registry={registry}
                breakpoint={breakpoint}
                selected={block.id === selectedBlockId}
                first={index === 0}
                last={index === page.blocks.length - 1}
                onSelect={() => onSelect(block.id)}
                onMove={(direction) => onMove(block, direction)}
                onDuplicate={() => onDuplicate(block)}
                onToggle={() => onToggle(block)}
                onRemove={() => onRemove(block)}
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
  registry,
  breakpoint,
  selected,
  first,
  last,
  onSelect,
  onMove,
  onDuplicate,
  onToggle,
  onRemove,
}: {
  block: ExperienceBlock;
  registry: SemanticRegistry;
  breakpoint: Breakpoint;
  selected: boolean;
  first: boolean;
  last: boolean;
  onSelect: () => void;
  onMove: (direction: "up" | "down") => void;
  onDuplicate: () => void;
  onToggle: () => void;
  onRemove: () => void;
}) {
  const spec = blockSpec(block.type as BlockType);
  const name = blockName(block);
  const hidden = !block.visible || !block.layout[breakpoint].visible;
  const small = smallButton;

  return (
    <div
      className={`flex h-full min-w-0 flex-col rounded-lg border bg-surface ${
        selected ? "border-evidence-line ring-2 ring-evidence-line" : "border-line"
      }`}
    >
      <button
        type="button"
        onClick={onSelect}
        aria-current={selected ? "true" : undefined}
        className="min-h-11 min-w-0 rounded-t-lg px-3 py-2 text-left"
      >
        <span className="block truncate text-sm font-semibold text-strong">{name}</span>
        <span className="block truncate text-xs text-muted">
          {spec.label} · {block.layout[breakpoint].span} de 12
          {hidden ? " · oculto" : ""}
        </span>
      </button>

      <div className={`min-w-0 flex-1 px-3 pb-2 ${hidden ? "opacity-45" : ""}`}>
        <BlockPreview block={block} registry={registry} />
      </div>

      <div className="flex flex-wrap gap-1.5 border-t border-line px-3 py-2">
        <button
          type="button"
          className={small}
          onClick={() => onMove("up")}
          disabled={first}
          aria-label={`Subir “${name}”`}
        >
          Subir
        </button>
        <button
          type="button"
          className={small}
          onClick={() => onMove("down")}
          disabled={last}
          aria-label={`Bajar “${name}”`}
        >
          Bajar
        </button>
        <button
          type="button"
          className={small}
          onClick={onDuplicate}
          aria-label={`Duplicar “${name}”`}
        >
          Duplicar
        </button>
        <button
          type="button"
          className={small}
          onClick={onToggle}
          aria-pressed={!block.visible}
          aria-label={block.visible ? `Ocultar “${name}”` : `Mostrar “${name}”`}
        >
          {block.visible ? "Ocultar" : "Mostrar"}
        </button>
        <button
          type="button"
          className={small}
          onClick={onRemove}
          aria-label={`Quitar “${name}” del prototipo`}
        >
          Quitar
        </button>
      </div>
    </div>
  );
}

/**
 * What one block looks like, honestly.
 *
 * The rule this function exists to keep: NOTHING HERE PRETENDS. A variant whose
 * renderer does not exist yet says so and shows the representation the registry
 * declares as its stand-in. A result frame says that the prototype carries no
 * numbers. A recorrido moment whose result the study no longer produces appears
 * WITHOUT a number rather than being dropped, because dropping it is how a
 * broken configuration stays invisible.
 */
function BlockPreview({
  block,
  registry,
}: {
  block: ExperienceBlock;
  registry: SemanticRegistry;
}) {
  const metric = block.query ? findMetric(registry, block.query.metricId) : null;
  const dimension = block.query?.primaryDimensionId
    ? findDimension(registry, block.query.primaryDimensionId)
    : null;
  const variant = block.visualization?.variant ?? null;
  const drawn = variant ? renderableVariant(variant) : null;
  const substituted = variant !== null && drawn !== null && drawn !== variant;

  const frame = "rounded-lg border border-dashed border-line bg-surface-sunken px-3 py-3";

  if (block.type === "divider") {
    return <hr className="my-3 border-t border-line-strong" />;
  }
  if (block.type === "spacer") {
    return <div className="h-8" aria-hidden="true" />;
  }

  return (
    <div className="min-w-0 space-y-2">
      {block.type === "cover" ? (
        <div className={frame}>
          <p className="truncate font-display text-base font-semibold text-strong">
            {block.title ?? "Portada del estudio"}
          </p>
          <p className="text-xs text-muted">Nombre del estudio, periodo y una frase de apertura.</p>
        </div>
      ) : null}

      {block.type === "section" ? (
        <p className="border-l-4 border-evidence-line pl-3 font-display text-sm font-semibold text-strong">
          {block.title ?? "Sección"}
        </p>
      ) : null}

      {(block.type === "rich_text"
        || block.type === "finding"
        || block.type === "interpretation"
        || block.type === "recommendation") ? (
        <div className={frame}>
          <p className="text-sm text-body">
            {block.copy.body
              ?? (block.type === "interpretation"
                ? "Aquí entra la lectura aprobada del equipo. Nunca se redacta desde esta pantalla."
                : "Aquí entra el texto que escriba el equipo.")}
          </p>
        </div>
      ) : null}

      {block.type === "image" ? (
        <div className={frame}>
          <p className="text-sm text-body">Imagen: {block.image?.alt ?? "sin descripción"}</p>
        </div>
      ) : null}

      {block.type === "report_download" ? (
        <div className={frame}>
          <p className="text-sm font-medium text-strong">Descargar el informe (PDF)</p>
          <p className="text-xs text-muted">
            Se descarga con los filtros que el lector tenga puestos en ese momento.
          </p>
        </div>
      ) : null}

      {metric ? (
        <div className={frame}>
          <p className="text-xs font-semibold text-strong">{metric.label}</p>
          <p className="font-display text-2xl font-semibold text-line-strong" aria-hidden="true">
            ——
          </p>
          {dimension ? (
            <p className="text-xs text-muted">
              Por {dimension.label} ({dimension.values.length})
            </p>
          ) : null}
          {block.query && block.query.comparison.kind === "target" ? (
            <p className="mt-1 text-xs text-caution">
              {block.query.comparison.targetLabel ?? "Rango ideal"}:{" "}
              {describeTargetRange(block.query.comparison)}
            </p>
          ) : null}
        </div>
      ) : null}

      {block.type === "journey" ? (
        <div className={frame}>
          <p className="text-xs font-semibold uppercase tracking-[0.1em] text-muted">Recorrido</p>
          <p className="text-xs text-muted">
            Los momentos configurados del estudio, en orden, cada uno con su resultado.
          </p>
        </div>
      ) : null}

      {block.type === "qualitative_themes" || block.type === "theme_cloud" ? (
        <div className={frame}>
          <p className="text-sm text-body">
            {block.type === "theme_cloud"
              ? "Los temas confirmados, con el tamaño según cuántas veces se dijeron."
              : "Los temas confirmados y las frases aprobadas que los sostienen."}
          </p>
          <p className="mt-1 text-xs text-muted">
            Solo entra lo que el equipo ya confirmó en la revisión cualitativa.
          </p>
        </div>
      ) : null}

      {block.type === "all_results_disclosure" ? (
        <div className={frame}>
          <p className="text-sm text-body">El inventario completo de resultados, plegado.</p>
        </div>
      ) : null}

      {variant && drawn ? (
        <p className={`text-xs ${substituted ? "text-caution" : "text-muted"}`}>
          {/* The full explanation lives in the properties panel and in the
              warnings below; a quarter-width card gets the short form. */}
          {substituted
            ? `${CHART_SPECS[variant].label} → ${CHART_SPECS[drawn].label.toLowerCase()}`
            : CHART_SPECS[variant].label}
        </p>
      ) : null}
    </div>
  );
}

function describeTargetRange(comparison: {
  target: number | null;
  targetMaximum: number | null;
}): string {
  if (comparison.target !== null && comparison.targetMaximum !== null) {
    return `entre ${comparison.target} y ${comparison.targetMaximum}`;
  }
  if (comparison.target !== null) return `al menos ${comparison.target}`;
  if (comparison.targetMaximum !== null) return `como máximo ${comparison.targetMaximum}`;
  return "sin definir";
}

// ---------------------------------------------------------------------------
// The inspector
// ---------------------------------------------------------------------------

function BlockInspector({
  block,
  pageTitle,
  registry,
  definition,
  idPrefix,
  onTitle,
  onVariant,
  onSamplePolicy,
}: {
  block: ExperienceBlock;
  pageTitle: string;
  registry: SemanticRegistry;
  definition: ExperienceDefinitionV1;
  idPrefix: string;
  onTitle: (title: string) => void;
  onVariant: (variant: ChartVariant) => void;
  onSamplePolicy: (
    override: { kind: "inherit" } | { kind: "override"; policy: typeof definition.sampleVisibilityPolicy },
    said: string,
  ) => void;
}) {
  const spec = blockSpec(block.type as BlockType);
  const metric: SemanticMetric | null = block.query
    ? findMetric(registry, block.query.metricId)
    : null;
  const dimensions = block.query
    ? [block.query.primaryDimensionId, block.query.secondaryDimensionId]
        .filter((id): id is string => typeof id === "string")
        .map((id) => findDimension(registry, id))
        .filter((dimension): dimension is NonNullable<typeof dimension> => Boolean(dimension))
    : [];
  const moving = filtersAffecting(definition, block.id)
    .map((filterId) => definition.filterDefinitions.find((filter) => filter.id === filterId))
    .filter((filter): filter is NonNullable<typeof filter> => Boolean(filter));
  const effective = resolveSamplePolicy(definition.sampleVisibilityPolicy, block.samplePolicy);

  // Which drawings this result can honestly become, given how many
  // characteristics the block's query actually supplies. Data, never a special
  // case — and the ones that fail the test stay on the list, marked, so that
  // choosing one shows what the product would refuse and why.
  const supplied = Math.min(2, dimensions.length) as 0 | 1 | 2;
  const compatible = new Set<string>(
    metric ? compatibleVariants(metric.charts, supplied) : spec.variants,
  );

  return (
    <div className="mt-3 space-y-4">
      <p className="text-sm text-muted">
        {spec.label} · en “{pageTitle}”
      </p>

      <div>
        <label htmlFor={`${idPrefix}-title`} className="block text-sm font-medium text-strong">
          Título visible
        </label>
        <input
          id={`${idPrefix}-title`}
          type="text"
          value={block.title ?? ""}
          onChange={(event) => onTitle(event.target.value)}
          className={`${field} mt-1`}
        />
      </div>

      {block.visualization ? (
        <div>
          <label htmlFor={`${idPrefix}-variant`} className="block text-sm font-medium text-strong">
            Cómo se dibuja
          </label>
          <select
            id={`${idPrefix}-variant`}
            value={block.visualization.variant}
            onChange={(event) => onVariant(event.target.value as ChartVariant)}
            className={`${field} mt-1`}
          >
            <optgroup label="Compatibles con este resultado">
              {spec.variants
                .filter((variant) => compatible.has(variant))
                .map((variant) => (
                  <option key={variant} value={variant}>
                    {CHART_SPECS[variant].label}
                  </option>
                ))}
            </optgroup>
            {spec.variants.some((variant) => !compatible.has(variant)) ? (
              <optgroup label="No compatibles con este resultado">
                {spec.variants
                  .filter((variant) => !compatible.has(variant))
                  .map((variant) => (
                    <option key={variant} value={variant}>
                      {CHART_SPECS[variant].label}
                    </option>
                  ))}
              </optgroup>
            ) : null}
          </select>
          <p className="mt-1 text-sm text-muted">
            {CHART_SPECS[block.visualization.variant].description}
          </p>
          {CHART_SPECS[block.visualization.variant].rendererImplemented ? null : (
            <p className="mt-1 text-sm text-caution">
              Esta variante todavía no tiene su propio dibujo. En el prototipo se muestra como{" "}
              {CHART_SPECS[renderableVariant(block.visualization.variant)].label.toLowerCase()}.
            </p>
          )}
        </div>
      ) : null}

      <fieldset>
        <legend className="text-sm font-medium text-strong">
          Con pocas respuestas, este bloque
        </legend>
        {spec.allowsSamplePolicyOverride ? (
          <div className="mt-1.5 space-y-1.5">
            <label className="flex min-h-11 cursor-pointer items-start gap-2 rounded-lg border border-line p-2 text-sm">
              <input
                type="radio"
                name={`${idPrefix}-block-policy`}
                checked={block.samplePolicy.kind === "inherit"}
                onChange={() =>
                  onSamplePolicy(
                    { kind: "inherit" },
                    "Este bloque vuelve a seguir la regla del estudio.",
                  )
                }
                className="mt-1 size-4"
              />
              <span className="min-w-0 text-body">
                Sigue la regla del estudio ({MODE_LABEL[definition.sampleVisibilityPolicy.mode].toLowerCase()})
              </span>
            </label>
            {SAMPLE_POLICY_MODES.map((mode) => (
              <label
                key={mode}
                className="flex min-h-11 cursor-pointer items-start gap-2 rounded-lg border border-line p-2 text-sm"
              >
                <input
                  type="radio"
                  name={`${idPrefix}-block-policy`}
                  checked={
                    block.samplePolicy.kind === "override" && block.samplePolicy.policy.mode === mode
                  }
                  onChange={() =>
                    onSamplePolicy(
                      {
                        kind: "override",
                        policy: {
                          policyVersion: SAMPLE_POLICY_VERSION,
                          mode,
                          threshold: definition.sampleVisibilityPolicy.threshold,
                        },
                      },
                      `Este bloque tiene ahora su propia regla: ${MODE_LABEL[mode].toLowerCase()}.`,
                    )
                  }
                  className="mt-1 size-4"
                />
                <span className="min-w-0 text-body">Regla propia: {MODE_LABEL[mode].toLowerCase()}</span>
              </label>
            ))}
          </div>
        ) : (
          <p className="mt-1.5 text-sm text-muted">
            “{spec.label}” siempre sigue la regla del estudio.
          </p>
        )}
      </fieldset>

      <dl className="space-y-3 text-sm">
        <div>
          <dt className="font-medium text-strong">Resultado</dt>
          <dd className="text-muted">
            {metric
              ? `${metric.label} — ${metric.question}`
              : spec.allowsQuery
                ? "Sin resultado elegido."
                : "Este bloque no lee un resultado."}
          </dd>
        </div>
        <div>
          <dt className="font-medium text-strong">Desglose</dt>
          <dd className="text-muted">
            {dimensions.length === 0
              ? "Sin desglose."
              : dimensions
                  .map(
                    (dimension) =>
                      `${dimension.label} (${dimension.values.length} ${
                        dimension.values.length === 1 ? "valor" : "valores"
                      })`,
                  )
                  .join(" · ")}
          </dd>
        </div>
        <div>
          <dt className="font-medium text-strong">Filtros que lo mueven</dt>
          <dd className="text-muted">
            {moving.length === 0
              ? "Ninguno. Un filtro mueve este bloque solo si está conectado a él."
              : moving.map((filter) => filter.label).join(" · ")}
          </dd>
        </div>
        <div>
          <dt className="font-medium text-strong">Regla que aplica hoy</dt>
          <dd className="text-muted">
            {block.samplePolicy.kind === "inherit"
              ? "La del estudio: "
              : "La propia de este bloque: "}
            {MODE_LABEL[effective.mode].toLowerCase()}
            {effective.mode === "show_all" ? "." : ` (mínimo ${effective.threshold}).`}
          </dd>
        </div>
        <div>
          <dt className="font-medium text-strong">Ancho en pantalla</dt>
          <dd className="text-muted">
            {BREAKPOINTS.map(
              (breakpoint) =>
                `${BREAKPOINT_LABEL[breakpoint]} (${BREAKPOINT_WIDTHS[breakpoint]} px): ${
                  block.layout[breakpoint].span
                } de 12`,
            ).join(" · ")}
          </dd>
        </div>
      </dl>
    </div>
  );
}

/**
 * The same sentence, said once, with how many blocks it is about.
 *
 * Five blocks drawn as a traffic light produce five identical warnings. A list
 * that repeats one sentence five times is a list nobody reads to the end — and
 * it was also five React children with the same key, which is a correctness
 * problem, not only a reading one.
 */
function collapse(issues: { code: string; detail: string }[]): {
  key: string;
  detail: string;
  count: number;
}[] {
  const seen = new Map<string, { key: string; detail: string; count: number }>();
  for (const issue of issues) {
    const key = `${issue.code}::${issue.detail}`;
    const found = seen.get(key);
    if (found) found.count += 1;
    else seen.set(key, { key, detail: issue.detail, count: 1 });
  }
  return [...seen.values()];
}

function ValidationPanel({
  schemaIssues,
  errors,
  warnings,
  adapterWarnings,
}: {
  schemaIssues: { path: string; message: string }[];
  errors: { code: string; detail: string }[];
  warnings: { code: string; detail: string }[];
  adapterWarnings: { code: string; detail: string }[];
}) {
  const blocking = schemaIssues.length + errors.length;
  const collapsedErrors = collapse(errors);
  const collapsedWarnings = collapse(warnings);
  const collapsedAdapter = collapse(adapterWarnings);
  return (
    <section
      aria-live="polite"
      className={`rounded-xl border p-4 sm:p-5 ${
        blocking > 0 ? "border-danger-line bg-danger-surface" : "border-line bg-surface"
      }`}
    >
      <h2
        className={`font-display text-base font-semibold ${
          blocking > 0 ? "text-danger" : "text-strong"
        }`}
      >
        {blocking > 0
          ? "Esto impediría guardar la experiencia"
          : "La experiencia es válida tal como está"}
      </h2>
      {blocking > 0 ? (
        <ul className="mt-2 space-y-1.5 text-sm text-danger">
          {schemaIssues.slice(0, 8).map((issue, index) => (
            <li key={`schema-${index}`}>
              {issue.path ? `${issue.path}: ` : ""}
              {issue.message}
            </li>
          ))}
          {collapsedErrors.slice(0, 8).map((issue) => (
            <li key={issue.key}>
              {issue.detail}
              {issue.count > 1 ? ` (en ${issue.count} bloques)` : ""}
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-1 text-sm text-muted">
          Nada de lo que hay en pantalla contradice el modelo. Los avisos de abajo son sugerencias:
          se puede publicar sin atenderlos.
        </p>
      )}

      {collapsedWarnings.length > 0 ? (
        <div className="mt-4">
          <h3 className="text-sm font-semibold text-caution">Avisos que no impiden nada</h3>
          <ul className="mt-1.5 space-y-1.5 text-sm text-caution">
            {collapsedWarnings.slice(0, 10).map((issue) => (
              <li key={issue.key}>
                {issue.detail}
                {issue.count > 1 ? ` (en ${issue.count} bloques)` : ""}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {collapsedAdapter.length > 0 ? (
        <div className="mt-4">
          <h3 className="text-sm font-semibold text-strong">
            Lo que el modelo todavía no sabe representar de este estudio
          </h3>
          <ul className="mt-1.5 space-y-1.5 text-sm text-muted">
            {collapsedAdapter.map((issue) => (
              <li key={issue.key}>
                {issue.detail}
                {issue.count > 1 ? ` (${issue.count} veces)` : ""}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
