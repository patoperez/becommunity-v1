/**
 * THE INVENTORY — what is in this presentation, in words a consultant reads.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT MAY BE SAID, AND WHAT MAY NOT.
 *
 * A review screen exists so a person can decide. That means it has to name
 * things, and every name it uses comes from ONE of three places: the author's
 * own title, a fixed Spanish word for a closed vocabulary member, or an ordinal
 * position. Never an id, never a handle, never a semantic enum, never a chart
 * variant string, never a canonical key. «bloque-cri-2 · touchpoint_satisfaction
 * · kpi_with_base» is storage, and asking somebody to approve storage is asking
 * them to approve something they cannot read.
 *
 * A BLOCK WITHOUT A TITLE STILL HAS TO BE NAMEABLE, because a reviewer told
 * «hay un bloque sin contenido» and given no way to find it is worse off than
 * one told nothing. So an untitled block is named by WHAT IT IS and WHERE IT IS
 * — «Resultado sin título (3.º de la página)» — which is derivable from the
 * render model and reveals nothing.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * IT IS PURE, AND IT READS ONLY THE RESOLVED MODEL.
 *
 * Not the document. The model is what a client would receive, so an inventory
 * built from it describes what would actually be delivered rather than what the
 * layout intends. Those differ exactly where it matters: a block waiting for
 * content is in the document and is nothing on the page.
 */

import { clientSeesBlock, filterPanelIsOperable } from "../presentation";
import type { PresentationRenderModel, RenderBlock, RenderPage } from "../presentation";
import type { BlockInventoryEntry, PageInventoryEntry } from "./contract";

/** What the block draws, in one Spanish word, from the payload's own shape. */
const KIND_LABEL: Record<string, string> = {
  value: "Resultado",
  categories: "Distribución",
  series: "Serie por periodo",
  terms: "Categorías cualitativas",
  cohorts: "Participación",
  instrument_bases: "Bases por instrumento",
  touchpoint: "Punto de contacto",
  journey_group: "Grupo del recorrido",
  routes: "Recorrido",
  filter_controls: "Panel de filtros",
  editorial: "Texto",
};

/** A page's own title, or a stated absence. Never an id. */
export function pageTitle(page: RenderPage): string {
  const title = page.title.trim();
  return title.length > 0 ? title : `Página ${page.order + 1}`;
}

/**
 * A block's own title, or what it is and where it sits.
 *
 * `placement.order` is the author's own ordering number and is shown as a
 * position rather than as itself, because it is not necessarily contiguous and a
 * reviewer counting cards down a page must be able to find the one named.
 */
export function blockTitle(block: RenderBlock, positionInPage?: number): string {
  const title = block.copy.title?.trim() ?? "";
  if (title.length > 0) return title;
  const kind = KIND_LABEL[block.payload.shape] ?? "Bloque";
  return positionInPage === undefined
    ? `${kind} sin título`
    : `${kind} sin título (${positionInPage}.º de la página)`;
}

/**
 * What the client would see here, in one phrase.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE VERDICT IS THE RENDERER'S, AND ONLY THE SENTENCE IS THIS FILE'S.
 *
 * `visibleToClient` used to be decided here, by a second implementation of the
 * renderer's rule. The two agreed on ten shapes and disagreed on the eleventh:
 * a filter panel is content on a surface where filtering works and an
 * unfinished edge where it does not, the renderer knew that and this file did
 * not, and a review screen reported «23» over a preview that drew 20.
 *
 * So the answer now comes from `clientSeesBlock` — the one the renderer calls,
 * with the same `live` argument — and what remains here is the SENTENCE, which
 * is a reviewer's own vocabulary and belongs to the review surface. The order
 * of the tests is the order of precedence a reader experiences: a hidden block
 * is nothing whatever its availability says, and a withheld result is nothing
 * whatever its payload holds.
 */
function blockState(block: RenderBlock, live: boolean): { state: string; visibleToClient: boolean } {
  const visibleToClient = clientSeesBlock(block, live);
  if (!block.visible) return { state: "Oculto: no se dibuja", visibleToClient };
  if (block.availability === "unresolved") {
    return { state: "Pregunta abierta: el contrato no lo resuelve", visibleToClient };
  }
  if (block.availability === "configuration_required") {
    return { state: "Espera contenido: al cliente no le aparece nada", visibleToClient };
  }
  if (block.availability === "unavailable") {
    return { state: "El estudio no tiene esta medición", visibleToClient };
  }
  if (block.sampleDisplay.state === "withheld_by_policy") {
    return { state: "Reservado por una política escrita a mano", visibleToClient };
  }
  // A PANEL THAT CANNOT APPEAR IS NAMED AS SUCH, AND NEVER COUNTED.
  //
  // A panel nobody connected to a block moves no figure, so the renderer draws
  // it for nobody. Saying «se dibuja» about it — as this file used to, because
  // its availability is `available` and its payload is not empty — is the exact
  // sentence that made the count disagree with the picture.
  if (block.payload.shape === "filter_controls" && !filterPanelIsOperable(block, live)) {
    return {
      state: live
        ? "No mueve ninguna cifra: al cliente no le aparece"
        : "Los filtros no se aplican en esta vista: al cliente no le aparece",
      visibleToClient,
    };
  }
  if (block.sampleDisplay.state === "shown_with_note") {
    return { state: "Se dibuja, con la nota que alguien escribió", visibleToClient };
  }
  if (!visibleToClient) {
    // Everything above is a NAMED reason. This is the honest catch-all for a
    // block the renderer drops for a reason the sentences above do not cover —
    // an empty payload, say — and it says so rather than claiming it is drawn.
    return { state: "No hay contenido que dibujar: al cliente no le aparece", visibleToClient };
  }
  return { state: "Se dibuja", visibleToClient };
}

/**
 * The whole inventory, page by page, in the order the client would read it.
 *
 * `live` is the surface fact, and it is REQUIRED rather than defaulted: the
 * review preview draws the client's own reading surface, where filtering works,
 * and an inventory built for a different surface would describe a different
 * deliverable.
 */
export function buildPublicationInventory(
  model: PresentationRenderModel,
  live: boolean,
): PageInventoryEntry[] {
  return model.pages.map((page) => ({
    title: pageTitle(page),
    blocks: page.blocks.map((block, index): BlockInventoryEntry => {
      const { state, visibleToClient } = blockState(block, live);
      return {
        title: blockTitle(block, index + 1),
        kind: KIND_LABEL[block.payload.shape] ?? "Bloque",
        state,
        visibleToClient,
      };
    }),
  }));
}

/**
 * How many blocks a client would see something in. Counted, never estimated.
 *
 * It is the inventory's own verdict summed, which is the renderer's verdict
 * summed, which is what the preview draws. The three cannot disagree because
 * there is one predicate and it takes the surface as an argument.
 */
export function countVisibleToClient(model: PresentationRenderModel, live: boolean): number {
  let total = 0;
  for (const page of model.pages) {
    for (const block of page.blocks) if (blockState(block, live).visibleToClient) total += 1;
  }
  return total;
}
