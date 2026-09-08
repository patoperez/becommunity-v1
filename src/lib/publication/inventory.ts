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
 * The order of the tests is the order of precedence a reader experiences: a
 * hidden block is nothing whatever its availability says, and a withheld result
 * is nothing whatever its payload holds.
 */
function blockState(block: RenderBlock): { state: string; visibleToClient: boolean } {
  if (!block.visible) return { state: "Oculto: no se dibuja", visibleToClient: false };
  if (block.availability === "unresolved") {
    return { state: "Pregunta abierta: el contrato no lo resuelve", visibleToClient: false };
  }
  if (block.availability === "configuration_required") {
    return { state: "Espera contenido: al cliente no le aparece nada", visibleToClient: false };
  }
  if (block.availability === "unavailable") {
    return { state: "El estudio no tiene esta medición", visibleToClient: false };
  }
  if (block.sampleDisplay.state === "withheld_by_policy") {
    return { state: "Reservado por una política escrita a mano", visibleToClient: false };
  }
  if (block.sampleDisplay.state === "shown_with_note") {
    return { state: "Se dibuja, con la nota que alguien escribió", visibleToClient: true };
  }
  return { state: "Se dibuja", visibleToClient: true };
}

/** The whole inventory, page by page, in the order the client would read it. */
export function buildPublicationInventory(model: PresentationRenderModel): PageInventoryEntry[] {
  return model.pages.map((page) => ({
    title: pageTitle(page),
    blocks: page.blocks.map((block, index): BlockInventoryEntry => {
      const { state, visibleToClient } = blockState(block);
      return {
        title: blockTitle(block, index + 1),
        kind: KIND_LABEL[block.payload.shape] ?? "Bloque",
        state,
        visibleToClient,
      };
    }),
  }));
}

/** How many blocks a client would see something in. Counted, never estimated. */
export function countVisibleToClient(model: PresentationRenderModel): number {
  let total = 0;
  for (const page of model.pages) {
    for (const block of page.blocks) if (blockState(block).visibleToClient) total += 1;
  }
  return total;
}
