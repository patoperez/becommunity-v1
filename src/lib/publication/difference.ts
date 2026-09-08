/**
 * THE STRUCTURAL DIFFERENCE — what changed since what the client is served.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY STRUCTURE AND NOT NUMBERS.
 *
 * A publication stores the render model it was approved with, so the client is
 * being served finished figures that were true when somebody approved them.
 * Comparing those figures against today's would produce a list of numbers that
 * moved — which is interesting and is NOT what a reviewer is deciding. What they
 * are deciding is whether to replace one delivered report with another, and the
 * question that answers is: is this the same report, differently, or a different
 * report? So this compares SHAPE: pages, their order, the blocks in them, what
 * each block is, and whether a client would see it.
 *
 * The numbers are not hidden. They are on the screen, in the preview, which is
 * the resolved model of the draft under review — and the warning that says the
 * study's evidence has moved since the current publication is raised separately
 * by the preflight.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * BLOCKS ARE MATCHED BY POSITION WITHIN A MATCHED PAGE, NOT BY ID.
 *
 * Ids are storage and this file may not print one. Position is what a reader
 * experiences and what an author moves things around in, so a diff expressed in
 * positions is a diff a person can check by looking at two pages side by side.
 * The cost is honest and worth stating: inserting a block near the top reports
 * every block below it as changed. That is a true statement about a page whose
 * shape changed, and it is better than the alternative — matching by id, which
 * would be exact, silent about the reordering, and unprintable.
 */

import type { PresentationRenderModel, RenderBlock } from "../presentation";
import type { StructuralChange, StructuralDifference } from "./contract";
import { blockTitle, pageTitle } from "./inventory";

/** What makes two blocks the same block, as a reader would judge it. */
function describe(block: RenderBlock, position: number): string {
  return [
    blockTitle(block, position),
    block.payload.shape,
    block.visible ? "visible" : "oculto",
    block.availability,
    block.sampleDisplay.state,
  ].join("|");
}

/**
 * Compare the structure of the document under review against what is published.
 *
 * `published` is the stored render model of the current publication — the exact
 * bytes a client is being served — so this is a comparison against reality
 * rather than against a re-resolution of an older document.
 */
export function structuralDifference(
  published: PresentationRenderModel,
  candidate: PresentationRenderModel,
): StructuralDifference {
  const changes: StructuralChange[] = [];
  const publishedPages = published.pages;
  const candidatePages = candidate.pages;
  const shared = Math.min(publishedPages.length, candidatePages.length);

  for (let index = 0; index < shared; index += 1) {
    const before = publishedPages[index];
    const after = candidatePages[index];
    const beforeTitle = pageTitle(before);
    const afterTitle = pageTitle(after);

    if (beforeTitle !== afterTitle) {
      changes.push({
        kind: "page_renamed",
        sentence: `La página ${index + 1} se llamaba «${beforeTitle}» y ahora se llama «${afterTitle}».`,
      });
    }

    const sharedBlocks = Math.min(before.blocks.length, after.blocks.length);
    for (let position = 0; position < sharedBlocks; position += 1) {
      const beforeBlock = before.blocks[position];
      const afterBlock = after.blocks[position];
      if (describe(beforeBlock, position + 1) === describe(afterBlock, position + 1)) continue;
      const beforeName = blockTitle(beforeBlock, position + 1);
      const afterName = blockTitle(afterBlock, position + 1);
      changes.push({
        kind: "block_changed",
        sentence:
          beforeName === afterName
            ? `En «${afterTitle}», «${afterName}» no es igual que en lo publicado.`
            : `En «${afterTitle}», donde estaba «${beforeName}» ahora está «${afterName}».`,
      });
    }
    for (let position = sharedBlocks; position < before.blocks.length; position += 1) {
      changes.push({
        kind: "block_removed",
        sentence: `De «${beforeTitle}» se quitó «${blockTitle(before.blocks[position], position + 1)}».`,
      });
    }
    for (let position = sharedBlocks; position < after.blocks.length; position += 1) {
      changes.push({
        kind: "block_added",
        sentence: `A «${afterTitle}» se añadió «${blockTitle(after.blocks[position], position + 1)}».`,
      });
    }
  }

  for (let index = shared; index < publishedPages.length; index += 1) {
    changes.push({
      kind: "page_removed",
      sentence: `Se quitó la página «${pageTitle(publishedPages[index])}».`,
    });
  }
  for (let index = shared; index < candidatePages.length; index += 1) {
    changes.push({
      kind: "page_added",
      sentence: `Se añadió la página «${pageTitle(candidatePages[index])}».`,
    });
  }

  return { identical: changes.length === 0, changes };
}
