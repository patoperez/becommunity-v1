/**
 * WHICH BLOCKS A FILTER ACTUALLY MOVES, resolved in exactly one place.
 *
 * There are two ways an author can say that a block follows a filter, and they
 * exist for two different reasons:
 *
 *   `filterConnections`     one block, named deliberately, one at a time. This
 *                           is the precise instrument, and it is what the
 *                           block's own card offers.
 *
 *   a panel's `target`      a scope — this page, these sections, these blocks,
 *                           or the whole experience. This is what a person
 *                           reaches for when they place a visible panel and
 *                           mean "these controls drive what is under them".
 *
 * A block responds when EITHER says so. That union is computed here, by one
 * pure function, and every surface that needs the answer calls it: the
 * builder's canvas, the block card, the validator, the internal draft preview
 * and the gate. Two surfaces deriving "does this filter move that block"
 * separately is how a preview starts disagreeing with what the author was
 * shown while composing.
 *
 * NOTHING HERE READS DATA. It maps identifiers to identifiers. What a filter
 * choice then does to a number is `applyViewerFilters` in `data.ts`, which is
 * the only place respondents are touched at all.
 */

import { blockSpec, type BlockType } from "./blocks";
import type {
  ExperienceBlock,
  ExperienceDefinitionV1,
  ExperiencePage,
  FilterDefinition,
} from "./definition";

/**
 * Whether a block is the kind of thing a reader's filter can move.
 *
 * It is the registry's `allowsFilters` and nothing else — deliberately, so a
 * block type added later declares its own compatibility in the one table that
 * already governs everything else about it, and becomes a legal filter target
 * without a single edit here. The theme cloud and the qualitative summary are
 * compatible today; the real theme-cloud visualization arriving later inherits
 * that rather than needing an exception carved for it.
 */
export function isFilterTargetable(block: ExperienceBlock): boolean {
  return blockSpec(block.type as BlockType).allowsFilters;
}

/** Every block in the experience, with the page it sits on. */
export function allBlocks(
  definition: ExperienceDefinitionV1,
): { page: ExperiencePage; block: ExperienceBlock }[] {
  return definition.pages.flatMap((page) => page.blocks.map((block) => ({ page, block })));
}

/** The page a block sits on, or null when it names nothing. */
export function pageOfBlock(
  definition: ExperienceDefinitionV1,
  blockId: string,
): ExperiencePage | null {
  return definition.pages.find((page) => page.blocks.some((b) => b.id === blockId)) ?? null;
}

/**
 * The blocks a section heading governs: the ones after it, up to the next
 * section heading or the end of the page.
 *
 * A `section` block is the only container this model has — blocks do not nest,
 * by construction — so "the blocks under this heading" is a reading of the
 * page's order rather than a parent-child link. The heading itself is not one
 * of them: a heading draws no aggregate, so moving it would mean nothing.
 */
export function sectionMembers(page: ExperiencePage, sectionId: string): ExperienceBlock[] {
  const ordered = [...page.blocks];
  const start = ordered.findIndex((block) => block.id === sectionId);
  if (start < 0) return [];
  const members: ExperienceBlock[] = [];
  for (let index = start + 1; index < ordered.length; index += 1) {
    if (ordered[index].type === "section") break;
    members.push(ordered[index]);
  }
  return members;
}

/**
 * The block ids one panel governs, resolved against the document as it is now.
 *
 * `experience` and `page` resolve dynamically, so a block added afterwards
 * joins what the panel already moves — which is what "every compatible block"
 * has to mean if the phrase is not to go quietly stale. `sections` and
 * `blocks` are by id and stay by id, so renaming anything changes nothing.
 *
 * A panel never moves ITSELF or another panel: a control that filtered the
 * control box is a loop nobody asked for.
 */
export function panelTargetBlockIds(
  definition: ExperienceDefinitionV1,
  panel: ExperienceBlock,
): Set<string> {
  const config = panel.filterPanel;
  const governed = new Set<string>();
  if (!config) return governed;

  const eligible = (block: ExperienceBlock) =>
    block.id !== panel.id && block.type !== "filter_panel" && isFilterTargetable(block);

  if (config.target.kind === "experience") {
    for (const { block } of allBlocks(definition)) if (eligible(block)) governed.add(block.id);
    return governed;
  }

  const page = pageOfBlock(definition, panel.id);
  if (config.target.kind === "page") {
    for (const block of page?.blocks ?? []) if (eligible(block)) governed.add(block.id);
    return governed;
  }

  if (config.target.kind === "sections") {
    for (const sectionId of config.target.sectionIds) {
      const home = pageOfBlock(definition, sectionId);
      if (!home) continue;
      for (const block of sectionMembers(home, sectionId)) {
        if (eligible(block)) governed.add(block.id);
      }
    }
    return governed;
  }

  const byId = new Map(allBlocks(definition).map(({ block }) => [block.id, block]));
  for (const blockId of config.target.blockIds) {
    const block = byId.get(blockId);
    if (block && eligible(block)) governed.add(block.id);
  }
  return governed;
}

/** Every visible filter panel in the experience, in reading order. */
export function filterPanels(
  definition: ExperienceDefinitionV1,
): { page: ExperiencePage; block: ExperienceBlock }[] {
  return allBlocks(definition).filter(({ block }) => block.type === "filter_panel");
}

/**
 * The complete answer: for every filter, every block it moves.
 *
 * The union of the explicit connections and every panel that hosts the filter.
 */
export function effectiveFilterTargets(
  definition: ExperienceDefinitionV1,
): Map<string, Set<string>> {
  const moved = new Map<string, Set<string>>();
  const add = (filterId: string, blockId: string) => {
    const set = moved.get(filterId) ?? new Set<string>();
    set.add(blockId);
    moved.set(filterId, set);
  };

  for (const connection of definition.filterConnections) {
    for (const blockId of connection.blockIds) add(connection.filterId, blockId);
  }
  for (const { block } of filterPanels(definition)) {
    const governed = panelTargetBlockIds(definition, block);
    for (const filterId of block.filterRefs) {
      for (const blockId of governed) add(filterId, blockId);
    }
  }
  return moved;
}

/** Whether one block follows one filter. */
export function blockRespondsTo(
  definition: ExperienceDefinitionV1,
  blockId: string,
  filterId: string,
): boolean {
  return effectiveFilterTargets(definition).get(filterId)?.has(blockId) ?? false;
}

/**
 * What a person is about to break, in words, before they remove something.
 *
 * Removing a block that a panel names, or removing a panel that is the only
 * thing driving some filters, changes what OTHER parts of the page do. The
 * confirmation says so rather than discovering it afterwards.
 */
export function removalConsequence(
  definition: ExperienceDefinitionV1,
  blockId: string,
): string | null {
  const found = allBlocks(definition).find(({ block }) => block.id === blockId);
  if (!found) return null;

  if (found.block.type === "filter_panel") {
    const governed = panelTargetBlockIds(definition, found.block);
    if (governed.size === 0 || found.block.filterRefs.length === 0) return null;
    const others = new Set<string>();
    for (const { block } of filterPanels(definition)) {
      if (block.id === found.block.id) continue;
      for (const filterId of block.filterRefs) others.add(filterId);
    }
    const orphaned = found.block.filterRefs.filter((filterId) => !others.has(filterId));
    if (orphaned.length === 0) return null;
    return `Al quitarlo, ${governed.size === 1 ? "1 bloque deja" : `${governed.size} bloques dejan`} de poder filtrarse desde aquí, y ${
      orphaned.length === 1 ? "1 característica deja" : `${orphaned.length} características dejan`
    } de tener un control visible en la experiencia.`;
  }

  const panelsNaming = filterPanels(definition).filter(({ block }) => {
    const target = block.filterPanel?.target;
    if (target?.kind === "blocks") return target.blockIds.includes(blockId);
    if (target?.kind === "sections") return target.sectionIds.includes(blockId);
    return false;
  });
  if (panelsNaming.length === 0) return null;
  return panelsNaming.length === 1
    ? "Un panel de filtros lo tiene elegido explícitamente; se quitará de ese panel."
    : `${panelsNaming.length} paneles de filtros lo tienen elegido explícitamente; se quitará de todos.`;
}

/**
 * The filters a panel offers, resolved to their definitions and IN THE ORDER
 * THE PANEL LISTS THEM. A reference naming nothing is dropped here rather than
 * rendered as an empty control.
 */
export function panelControls(
  definition: ExperienceDefinitionV1,
  panel: ExperienceBlock,
): FilterDefinition[] {
  const byId = new Map(definition.filterDefinitions.map((filter) => [filter.id, filter]));
  return panel.filterRefs.flatMap((filterId) => {
    const filter = byId.get(filterId);
    return filter ? [filter] : [];
  });
}
