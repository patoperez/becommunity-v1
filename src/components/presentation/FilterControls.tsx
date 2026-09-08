/**
 * THE FILTER CONTROLS — real where filtering is real, and visibly dead where it
 * is not.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * A CONTROL THAT LOOKS LIVE AND DOES NOTHING IS WORSE THAN NO CONTROL.
 *
 * That was Unit 6B.1's reason for disabling every control here, and it is still
 * the rule; what changed is that there is now a surface where the controls DO
 * something. So the component asks one question — was it handed viewer controls
 * — and answers it honestly in both directions:
 *
 *   handed them          → real checkboxes, a real summary, a real count;
 *   not handed them      → genuinely `disabled`, under a sentence saying where
 *                          filtering works;
 *   handed them, but the panel moves no block
 *                        → genuinely `disabled`, under a sentence saying why,
 *                          because a control that changes nothing is the same
 *                          deception in a different costume.
 *
 * A CLIENT SEES A LIVE PANEL AND NEVER A DEAD ONE. C11 removes the SHAPE OF A
 * GAP from a client's page — an unfinished edge, a control that will work
 * later. It does not remove a working control, which is a finished part of a
 * finished deliverable. `clientHasContent` asks the same question this file
 * does, and the two must keep the same answer.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * SEVERAL VALUES INSIDE ONE CHARACTERISTIC ARE AN «O».
 *
 * That is why these are checkboxes and not a `<select>`. A single-value control
 * cannot express «Boomer o Generación X», and the semantics this unit requires
 * are OR inside a characteristic, AND between characteristics, AND between
 * panels. The copy says so in words, because a reader should not have to infer
 * a boolean algebra from a widget.
 *
 * The approved reference dashboard uses a single-select `<select>` per
 * dimension and has no multi-select anywhere, so there is no approved visual
 * north for this control. It is new, and it is recorded as new.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * EVERY NUMBER AND EVERY SENTENCE HERE WAS COMPUTED ON THE SERVER.
 *
 * The per-option counts are the canonical layer's own UNFILTERED figures — how
 * many people carry a characteristic is a fact about the study, and a count
 * that shrank with the selection would be a number nobody measured under the
 * selection that produced it. The «quedan N personas de M» sentence, the active
 * summary and the empty-state sentence all arrive finished in
 * `payload.selection`. Nothing on this side adds, divides, rounds or compares.
 */

import type { RenderBlock } from "@/lib/presentation";
import { InternalPlaceholder, type PresentationAudience } from "./absence";
import { Count } from "./primitives";
import type { ViewerControls } from "./viewer";

/**
 * Does this panel offer a reader anything they can actually use?
 *
 * Asked here and asked again by `clientHasContent`, from the same three facts,
 * so a client is never shown a card this component would then draw as a
 * disabled placeholder inside.
 */
export function filterPanelIsOperable(block: RenderBlock, live: boolean): boolean {
  if (block.payload.shape !== "filter_controls") return false;
  if (!live) return false;
  if (block.payload.dimensions.length === 0) return false;
  return block.payload.selection.movesBlocks > 0;
}

export function FilterControl({
  block,
  audience,
  viewer,
}: {
  block: RenderBlock;
  audience: PresentationAudience;
  viewer?: ViewerControls;
}) {
  if (block.payload.shape !== "filter_controls") return null;
  const { dimensions, selection } = block.payload;
  const operable = filterPanelIsOperable(block, viewer !== undefined);

  // A client is shown a working panel and nothing else. An empty one, a
  // disconnected one and a canvas one are all unfinished edges, and C11 keeps
  // those off a finished deliverable.
  if (audience === "client" && !operable) return null;

  if (dimensions.length === 0) {
    return (
      <InternalPlaceholder
        title="Panel sin características"
        detail="Este panel no ofrece todavía ninguna característica por la que filtrar, así que no mueve nada."
        action="Elige sus características en la ficha del bloque."
      />
    );
  }

  /**
   * WHAT THE BOXES SHOW.
   *
   * On a live surface, what the reader has ASKED for — so a click registers at
   * once, even while the server is still recomputing. On a dead one, what was
   * actually APPLIED, which the model carries: a disabled control that always
   * looked empty would say "no filter" over figures computed under one.
   */
  const chosenFor = (dimension: { handle: string; selected: string[] }): string[] => {
    if (!viewer) return dimension.selected;
    return (
      viewer.pending.panels
        .find((panel) => panel.panelId === block.id)
        ?.dimensions.find((entry) => entry.handle === dimension.handle)?.options ?? []
    );
  };

  const busy = viewer?.status === "loading";

  return (
    <div aria-busy={busy || undefined}>
      {/*
        WHAT IS IN FORCE, ANNOUNCED.

        The sentence and both counts come from the render model, so they
        describe the population the figures below were actually computed over.
        `aria-live` is on this one region rather than on the page, because a
        filter change replaces a whole screen of blocks and announcing all of
        them would bury the one thing that changed.
      */}
      <p aria-live="polite" className="text-sm text-body">
        <span className="font-semibold">
          {selection.neutral ? "Todas las personas" : selection.summary}
        </span>
        <span className="text-muted"> · {selection.countSentence}</span>
      </p>

      <div className="mt-3 grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(13rem,1fr))]">
        {dimensions.map((dimension) => {
          const chosen = chosenFor(dimension);
          return (
            <fieldset key={dimension.handle} className="min-w-0 border-0 p-0">
              <legend className="text-xs font-semibold text-muted">{dimension.label}</legend>
              {chosen.length === 0 ? (
                <p className="mt-0.5 text-xs text-muted">Todas las personas</p>
              ) : null}
              <ul className="mt-1 space-y-0.5">
                {dimension.options.map((option) => {
                  const checked = chosen.includes(option.token);
                  return (
                    <li key={option.token}>
                      <label
                        className={`flex min-h-11 items-center gap-2 rounded-md px-2 text-sm ${
                          operable
                            ? "cursor-pointer text-body hover:bg-surface-sunken"
                            : "cursor-not-allowed text-muted opacity-70"
                        }`}
                      >
                        <input
                          type="checkbox"
                          className="size-4 shrink-0"
                          checked={checked}
                          disabled={!operable}
                          onChange={(event) =>
                            viewer?.onToggle(
                              block.id,
                              dimension.handle,
                              option.token,
                              event.target.checked,
                            )
                          }
                        />
                        <span className="min-w-0 [overflow-wrap:anywhere]">{option.label}</span>
                        {/*
                          Each option's own participant count. NOT a total:
                          adding them would be this layer producing a number the
                          study never produced, and a segment total is exactly
                          the kind of figure a reader would then quote.
                        */}
                        <span className="ml-auto shrink-0 text-xs text-muted">
                          <Count of={option.participants} />
                        </span>
                      </label>
                    </li>
                  );
                })}
              </ul>
            </fieldset>
          );
        })}
      </div>

      <p className="mt-2 text-xs text-muted">
        Dentro de una característica, elegir varios valores incluye a quien cumpla cualquiera de
        ellos. Entre características, se muestran quienes cumplen todas.
      </p>

      {operable ? (
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <button
            type="button"
            className="min-h-11 rounded-lg border border-line bg-surface px-3 text-sm font-medium text-body disabled:cursor-not-allowed disabled:opacity-60"
            disabled={selection.neutral || busy}
            onClick={() => viewer?.onClearPanel(block.id)}
          >
            Limpiar filtros
          </button>
          {busy ? (
            <span aria-live="polite" className="text-sm text-muted">
              Actualizando resultados… las cifras siguen siendo las de la selección anterior.
            </span>
          ) : null}
          {viewer?.status === "error" && viewer.message ? (
            <span role="status" className="text-sm text-caution">
              {viewer.message}
            </span>
          ) : null}
        </div>
      ) : null}

      {/*
        WHY IT IS DEAD, when it is dead. Internal surfaces only: a client never
        reaches this branch, because a panel that is not operable is not drawn
        for them at all.
      */}
      {operable ? null : (
        <div className="mt-3">
          {viewer === undefined ? (
            <InternalPlaceholder
              title="Aquí los filtros no se aplican"
              detail="El lienzo de composición muestra la estructura; los controles están desactivados a propósito para que un clic seleccione el bloque y no mueva las cifras."
              action="Abre la vista de lectura para filtrar de verdad."
            />
          ) : (
            <InternalPlaceholder
              title="Este panel todavía no mueve nada"
              detail="Ningún bloque está conectado a este panel, así que sus controles no cambiarían ninguna cifra. Compartir una característica no es una conexión."
              action="Conéctalo a los bloques que deba mover en la ficha del panel."
            />
          )}
        </div>
      )}
    </div>
  );
}
