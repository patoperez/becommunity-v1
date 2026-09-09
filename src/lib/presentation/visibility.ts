/**
 * WHAT A CLIENT WOULD SEE — asked ONCE, for every surface that needs the answer.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS FILE EXISTS.
 *
 * Three places used to answer this question with three implementations: the
 * renderer decided which cards to draw, the publication inventory decided what
 * to count as client-visible, and the preflight decided whether anything was
 * visible at all. They agreed on nine of the eleven payload shapes and
 * disagreed on the one that matters most.
 *
 * A FILTER PANEL IS CONTENT ONLY WHERE FILTERING IS REAL. The renderer knew
 * that — `filterPanelIsOperable` asks whether the surface handed it viewer
 * controls — and the inventory did not, so a review screen said «23 bloques los
 * ve el cliente» over a preview that drew 20. Three panels, counted by one half
 * of the screen and dropped by the other, in a product whose whole promise is
 * that what a reviewer approves is what a client is served.
 *
 * So the predicate lives here, it takes the same `live` argument every caller
 * must supply, and there is exactly one of it. A count and a drawing that
 * disagree are now impossible rather than unlikely, and a gate renders the real
 * component to real markup and compares the two.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * IT IS PURE, AND IT IS CLIENT-SAFE.
 *
 * It reads a `PresentationRenderModel` — already-final values a client may be
 * shown — and nothing else. No environment, no clock, no transport, no
 * registry, no address, no threshold. `live` is a property of the SURFACE, in
 * exactly the way `audience` is: the same model drawn on the authoring canvas
 * and in the reading view is the same bytes, and only the surface differs.
 */

import type { PresentationRenderModel, RenderBlock, RenderPage, RenderSampleDisplay } from "./render-model";

/**
 * The note a reader is shown beside a sample outcome, or nothing.
 *
 * `shown_with_note` carries a sentence about a result the client IS given, and
 * `withheld_by_policy` carries one only when somebody authored a public note.
 * Both are the C11 exception — a caveat about what a reader is being shown is
 * analytical honesty — and neither is ever a threshold, a base or a name.
 */
export function sampleVisibleNote(sample: RenderSampleDisplay): string | null {
  if (sample.state === "shown_with_note") return sample.note;
  if (sample.state === "withheld_by_policy") return sample.note;
  return null;
}

/**
 * Does this panel offer a reader anything they can actually use?
 *
 * Three facts, all in the model: it is a panel, the surface is live, it offers
 * at least one characteristic, and it moves at least one block. A panel nobody
 * connected to anything changes no figure, and a control that changes nothing
 * is a control that lies about what it is.
 */
export function filterPanelIsOperable(block: RenderBlock, live: boolean): boolean {
  if (block.payload.shape !== "filter_controls") return false;
  if (!live) return false;
  if (block.payload.dimensions.length === 0) return false;
  return block.payload.selection.movesBlocks > 0;
}

/**
 * Does this block have anything a CLIENT may be shown?
 *
 * C11: a block whose whole content is an omission renders as nothing — no card,
 * no heading, no reserved row. The question has to be asked BEFORE a card is
 * drawn, because a leaf returning null still leaves a bordered box with a title
 * over an empty space, and an empty box is exactly the shape of a gap C11
 * removes.
 */
export function clientHasContent(block: RenderBlock, live: boolean): boolean {
  const payload = block.payload;
  // AN ABSENCE THE CONTRACT STATES IS NOT A GAP WE MADE.
  //
  // "Nobody responded" and "no authority states this relationship" are facts
  // about the STUDY, and C11's exception is explicit that a caveat about what a
  // reader is being shown survives. An earlier version filtered any block with
  // an empty payload, so those two sentences were removed along with the gaps —
  // the opposite defect, and the more damaging one, because it makes a study
  // look complete where it was honest.
  const stated =
    "absence" in payload &&
    payload.absence !== null &&
    (payload.absence.state === "unavailable" || payload.absence.state === "unresolved");
  if (stated) return true;
  switch (payload.shape) {
    case "value":
      return payload.value !== null;
    case "categories":
      return payload.categories.length > 0;
    case "series":
      return payload.points.some((point) =>
        point.measures.some(
          (measure) =>
            measure.value !== null ||
            measure.absence?.state === "unavailable" ||
            measure.absence?.state === "unresolved",
        ),
      );
    case "terms":
      return payload.terms.length > 0;
    case "cohorts":
      return payload.cohorts.length > 0;
    case "instrument_bases":
      return payload.instruments.length > 0;
    case "touchpoint":
      return (
        payload.satisfaction !== null ||
        payload.processUnawareness !== null ||
        payload.unawarenessShare !== null
      );
    case "journey_group":
      return payload.touchpointCount > 0;
    // A route with no points is a route nobody finished configuring: the
    // block exists, and there is nothing in it for a reader.
    case "routes":
      return payload.routes.some((route) => route.points.length > 0);
    case "editorial":
      return payload.body !== null;
    // A FILTER PANEL IS CONTENT WHEN IT WORKS, AND AN UNFINISHED EDGE WHEN IT
    // DOES NOT.
    //
    // Unit 6B.1 answered `false` unconditionally, and that was right while the
    // controls were dead: a client's page must not carry a control that will
    // work later. A LIVE panel is the opposite — it is a finished part of the
    // deliverable, and hiding it would take a reader's own instrument away.
    case "filter_controls":
      return filterPanelIsOperable(block, live);
    default:
      return false;
  }
}

/**
 * Would a CLIENT see anything at all for this block?
 *
 * `clientHasContent` asks about the payload. This asks the whole question,
 * including the block-level sample outcome: a block whose sample was withheld
 * by policy carries no content AND, unless somebody authored a public note, no
 * sentence either — so on a client surface it is a titled card over nothing,
 * which is the exact shape C11 removes.
 */
export function clientSeesBlock(block: RenderBlock, live: boolean): boolean {
  if (!block.visible) return false;
  if (block.sampleDisplay.state === "withheld_by_policy") {
    return sampleVisibleNote(block.sampleDisplay) !== null;
  }
  return clientHasContent(block, live);
}

/**
 * And would a client see anything at all for this PAGE?
 *
 * A page heading over nothing is a heading over nothing whether the emptiness
 * came from one block or from all of them.
 */
export function clientSeesPage(page: RenderPage, live: boolean): boolean {
  return page.blocks.some((block) => clientSeesBlock(block, live));
}

/** How many blocks a client would see something in. Counted, never estimated. */
export function countClientVisibleBlocks(model: PresentationRenderModel, live: boolean): number {
  let total = 0;
  for (const page of model.pages) {
    for (const block of page.blocks) if (clientSeesBlock(block, live)) total += 1;
  }
  return total;
}
