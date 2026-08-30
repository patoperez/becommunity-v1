/**
 * The edits the internal prototype can make, as pure functions.
 *
 * WHY THEY LIVE HERE AND NOT IN THE COMPONENT. A React component is a bad
 * place to keep rules: it cannot be tested without a browser, it mixes the
 * decision with the rendering, and the first time a second surface needs the
 * same edit the rule gets copied. Every operation below takes a definition and
 * returns a NEW definition, touches nothing else, and is asserted by an offline
 * gate. The component holds the current definition in local state and calls
 * these; that is all it does.
 *
 * NOTHING HERE PERSISTS. No fetch, no Server Action, no storage. This slice is
 * for deciding whether the mental model is right before anything is built to
 * store it, and an edit that cannot be saved is an edit that cannot break a
 * client's study.
 *
 * Two behaviours are worth stating because they are decisions rather than
 * omissions:
 *
 *   A DUPLICATE ANSWERS TO NOTHING. Copying a block copies its query, its
 *   drawing and its layout, and deliberately NOT the filter connections that
 *   pointed at the original. A filter moves a block because somebody said so;
 *   inheriting that by accident is exactly the "same key, same behaviour"
 *   coupling the connection model exists to prevent.
 *
 *   REMOVING A BLOCK CLEANS UP AFTER ITSELF. Its id leaves every connection,
 *   a connection left naming nothing goes with it, and a block-scoped filter
 *   nothing still references leaves too — along with every mention of it, in
 *   all six places a filter id can appear. A dangling reference is a validation
 *   error, and the composer should not be able to produce one by accident.
 *
 *   A REFUSAL IS A SENTENCE. Every operation that declines returns the state
 *   unchanged WITH a reason a person can read, because an edit that silently
 *   does nothing is an edit somebody believes worked. The composer announces
 *   the reason and carries on; nothing here is ever a dead end.
 */

import { blockSpec, type BlockType } from "./blocks";
import type { ChartVariant } from "./charts";
import { newBlock } from "./defaults";
import {
  findBlock,
  type ExperienceBlock,
  type ExperienceDefinitionV1,
  type ExperiencePage,
} from "./definition";
import { mintId } from "./ids";
import { BREAKPOINTS } from "./layout";
import type { SemanticRegistry } from "./registry";
import {
  SAMPLE_POLICY_VERSION,
  type SamplePolicyMode,
  type SamplePolicyOverride,
} from "./sample-policy";
import { EXPERIENCE_LIMITS } from "./limits";

/** Everything the prototype holds while somebody is working in it. */
export type ComposerState = {
  definition: ExperienceDefinitionV1;
  /** The block the side panel is describing, or null. */
  selectedBlockId: string | null;
  /**
   * A counter the prototype never reuses, so a block added after another was
   * removed can never be given an identifier React has already seen.
   */
  sequence: number;
  /**
   * Why the last action changed nothing, in the words a person reads, or null
   * when the last action landed.
   *
   * An operation that quietly returns its input is an operation the person
   * believes worked. Every refusal below therefore SAYS SO, the composer
   * announces it, and editing continues — a refusal is a sentence, never a
   * dead end.
   */
  refusal: string | null;
};

export function initialState(definition: ExperienceDefinitionV1): ComposerState {
  return { definition, selectedBlockId: null, sequence: 0, refusal: null };
}

/** The state unchanged, with the reason it did not change. */
function refuse(state: ComposerState, reason: string): ComposerState {
  return { ...state, refusal: reason };
}

function mapPages(
  definition: ExperienceDefinitionV1,
  map: (page: ExperiencePage) => ExperiencePage,
): ExperienceDefinitionV1 {
  return { ...definition, pages: definition.pages.map(map) };
}

function mapBlock(
  definition: ExperienceDefinitionV1,
  blockId: string,
  map: (block: ExperienceBlock) => ExperienceBlock,
): ExperienceDefinitionV1 {
  return mapPages(definition, (page) => ({
    ...page,
    blocks: page.blocks.map((block) => (block.id === blockId ? map(block) : block)),
  }));
}

/** Order is re-derived from array position, at every width, after any move. */
function renumber(page: ExperiencePage): ExperiencePage {
  return {
    ...page,
    blocks: page.blocks.map((block, index) => ({
      ...block,
      layout: Object.fromEntries(
        BREAKPOINTS.map((breakpoint) => [
          breakpoint,
          { ...block.layout[breakpoint], order: index },
        ]),
      ) as ExperienceBlock["layout"],
    })),
  };
}

export function selectBlock(state: ComposerState, blockId: string | null): ComposerState {
  return { ...state, selectedBlockId: blockId, refusal: null };
}

export function setBlockTitle(
  state: ComposerState,
  blockId: string,
  title: string,
): ComposerState {
  const trimmed = title.slice(0, EXPERIENCE_LIMITS.titleLength);
  return {
    ...state,
    refusal: null,
    definition: mapBlock(state.definition, blockId, (block) => ({
      ...block,
      title: trimmed.trim() === "" ? null : trimmed,
    })),
  };
}

export function setBlockVisibility(
  state: ComposerState,
  blockId: string,
  visible: boolean,
): ComposerState {
  return {
    ...state,
    refusal: null,
    definition: mapBlock(state.definition, blockId, (block) => ({ ...block, visible })),
  };
}

export function setChartVariant(
  state: ComposerState,
  blockId: string,
  variant: ChartVariant,
): ComposerState {
  const found = findBlock(state.definition, blockId);
  if (!found) return refuse(state, "Ese bloque ya no está en el prototipo.");
  if (!found.block.visualization) {
    return refuse(state, "Este bloque no se dibuja como gráfica, así que no hay nada que cambiar.");
  }
  const spec = blockSpec(found.block.type as BlockType);
  // The catalogue decides what a block may become. A variant that is not on its
  // list is refused OUT LOUD rather than applied and rejected later.
  if (!(spec.variants as readonly string[]).includes(variant)) {
    return refuse(state, `“${spec.label}” no se puede dibujar de esa manera.`);
  }
  return {
    ...state,
    refusal: null,
    definition: mapBlock(state.definition, blockId, (block) =>
      block.visualization
        ? { ...block, visualization: { ...block.visualization, variant } }
        : block,
    ),
  };
}

export function setBlockSamplePolicy(
  state: ComposerState,
  blockId: string,
  override: SamplePolicyOverride,
): ComposerState {
  const found = findBlock(state.definition, blockId);
  if (!found) return refuse(state, "Ese bloque ya no está en el prototipo.");
  const spec = blockSpec(found.block.type as BlockType);
  if (!spec.allowsSamplePolicyOverride && override.kind === "override") {
    return refuse(state, `“${spec.label}” siempre sigue la regla del estudio.`);
  }
  return {
    ...state,
    refusal: null,
    definition: mapBlock(state.definition, blockId, (block) => ({
      ...block,
      samplePolicy: override,
    })),
  };
}

/** The study-wide rule: show everything, warn under a number, or hide under it. */
export function setStudySamplePolicy(
  state: ComposerState,
  mode: SamplePolicyMode,
  threshold: number = state.definition.sampleVisibilityPolicy.threshold,
): ComposerState {
  return {
    ...state,
    refusal: null,
    definition: {
      ...state.definition,
      sampleVisibilityPolicy: {
        policyVersion: SAMPLE_POLICY_VERSION,
        mode,
        threshold: Math.min(100_000, Math.max(1, Math.round(threshold))),
      },
    },
  };
}

/** Whether one more block fits, and what to say when it does not. */
function roomForOneMoreBlock(
  definition: ExperienceDefinitionV1,
  page: ExperiencePage,
): string | null {
  if (page.blocks.length >= EXPERIENCE_LIMITS.blocksPerPage) {
    return `“${page.title}” ya tiene los ${EXPERIENCE_LIMITS.blocksPerPage} bloques que admite una página.`;
  }
  const total = definition.pages.reduce((sum, candidate) => sum + candidate.blocks.length, 0);
  if (total >= EXPERIENCE_LIMITS.blocks) {
    return `Esta experiencia ya tiene los ${EXPERIENCE_LIMITS.blocks} bloques que admite en total.`;
  }
  return null;
}

/**
 * Strip every mention of a set of filters from the document.
 *
 * A filter id can appear in six places: a block's hosted controls, a block
 * query's author-fixed narrowings, a page's hosted controls, a journey's filter
 * set, another filter's `dependsOn`, and a connection. Removing the definition
 * while leaving any of them behind produces a dangling reference — a hard
 * `unknown_reference` error the person did not ask for and cannot see the cause
 * of. So all six are pruned together, here, once.
 */
function pruneFilterReferences(
  definition: ExperienceDefinitionV1,
  removed: ReadonlySet<string>,
): ExperienceDefinitionV1 {
  if (removed.size === 0) return definition;
  const keep = (id: string) => !removed.has(id);
  return {
    ...definition,
    pages: definition.pages.map((page) => ({
      ...page,
      filterRefs: page.filterRefs.filter(keep),
      blocks: page.blocks.map((block) => ({
        ...block,
        filterRefs: block.filterRefs.filter(keep),
        query: block.query
          ? { ...block.query, filterRefs: block.query.filterRefs.filter(keep) }
          : null,
      })),
    })),
    filterDefinitions: definition.filterDefinitions
      .filter((filter) => keep(filter.id))
      .map((filter) => ({
        ...filter,
        dependsOn: filter.dependsOn && removed.has(filter.dependsOn) ? null : filter.dependsOn,
      })),
    filterConnections: definition.filterConnections.filter((connection) =>
      keep(connection.filterId),
    ),
    journeyReferences: definition.journeyReferences.map((journey) => ({
      ...journey,
      filterRefs: journey.filterRefs.filter(keep),
    })),
  };
}

export function duplicateBlock(state: ComposerState, blockId: string): ComposerState {
  const found = findBlock(state.definition, blockId);
  if (!found) return refuse(state, "Ese bloque ya no está en el prototipo.");
  // The same ceilings that bound "añadir". A copy is a block; an operation that
  // creates one without asking is an operation that can build a page the schema
  // then refuses to save.
  const full = roomForOneMoreBlock(state.definition, found.page);
  if (full) return refuse(state, full);

  const sequence = state.sequence + 1;
  const copy: ExperienceBlock = {
    ...found.block,
    id: mintId("block", `${blockId}/copy/${sequence}`),
    title: found.block.title
      ? `${found.block.title} (copia)`.slice(0, EXPERIENCE_LIMITS.titleLength)
      : null,
    // A duplicate hosts no filter control either. Two blocks presenting the
    // same control is not a thing anybody wants, and it is what copying
    // `filterRefs` produced.
    filterRefs: [],
  };
  const definition = mapPages(state.definition, (page) => {
    if (page.id !== found.page.id) return page;
    const index = page.blocks.findIndex((block) => block.id === blockId);
    const blocks = [...page.blocks];
    blocks.splice(index + 1, 0, copy);
    return renumber({ ...page, blocks });
  });
  // Deliberately no connection is copied. See the module header.
  return { ...state, definition, selectedBlockId: copy.id, sequence, refusal: null };
}

export function removeBlock(state: ComposerState, blockId: string): ComposerState {
  const found = findBlock(state.definition, blockId);
  if (!found) return refuse(state, "Ese bloque ya no está en el prototipo.");

  const withoutBlock = mapPages(state.definition, (page) =>
    page.id === found.page.id
      ? renumber({ ...page, blocks: page.blocks.filter((block) => block.id !== blockId) })
      : page,
  );

  const connections = withoutBlock.filterConnections
    .map((connection) => ({
      ...connection,
      blockIds: connection.blockIds.filter((id) => id !== blockId),
    }))
    // A connection that now names nothing is not a connection. Keeping it would
    // leave a statement about blocks that no longer exist in the document.
    .filter((connection) => connection.blockIds.length > 0);

  // A block-scoped filter exists to be shown on one block. With that block
  // gone it has nowhere to live, so it goes too rather than becoming a
  // dangling reference — UNLESS something else still names it. "Something
  // else" includes a query's author-fixed narrowing, a page, and a journey,
  // not only another block's hosted controls.
  const stillReferenced = new Set([
    ...withoutBlock.pages.flatMap((page) => [
      ...page.filterRefs,
      ...page.blocks.flatMap((block) => [...block.filterRefs, ...(block.query?.filterRefs ?? [])]),
    ]),
    ...withoutBlock.journeyReferences.flatMap((journey) => journey.filterRefs),
  ]);
  const orphaned = new Set(
    withoutBlock.filterDefinitions
      .filter((filter) => filter.scope === "block" && !stillReferenced.has(filter.id))
      .map((filter) => filter.id),
  );

  return {
    ...state,
    definition: pruneFilterReferences({ ...withoutBlock, filterConnections: connections }, orphaned),
    selectedBlockId: state.selectedBlockId === blockId ? null : state.selectedBlockId,
    refusal: null,
  };
}

export function moveBlock(
  state: ComposerState,
  blockId: string,
  direction: "up" | "down",
): ComposerState {
  const found = findBlock(state.definition, blockId);
  if (!found) return refuse(state, "Ese bloque ya no está en el prototipo.");
  const index = found.page.blocks.findIndex((block) => block.id === blockId);
  const target = direction === "up" ? index - 1 : index + 1;
  if (target < 0 || target >= found.page.blocks.length) {
    return refuse(
      state,
      direction === "up"
        ? "Ya es el primer bloque de la página."
        : "Ya es el último bloque de la página.",
    );
  }
  const definition = mapPages(state.definition, (page) => {
    if (page.id !== found.page.id) return page;
    const blocks = [...page.blocks];
    [blocks[index], blocks[target]] = [blocks[target], blocks[index]];
    return renumber({ ...page, blocks });
  });
  return { ...state, definition, refusal: null };
}

export function addBlock(
  state: ComposerState,
  pageId: string,
  type: BlockType,
  registry: SemanticRegistry | null,
): ComposerState {
  const page = state.definition.pages.find((candidate) => candidate.id === pageId);
  if (!page) return refuse(state, "Esa página ya no está en el prototipo.");
  const full = roomForOneMoreBlock(state.definition, page);
  if (full) return refuse(state, full);

  const sequence = state.sequence + 1;
  const created = newBlock({
    type,
    seed: `${pageId}/added/${sequence}`,
    order: page.blocks.length,
    registry,
    journeyId: state.definition.journeyReferences[0]?.id ?? null,
  });
  if (!created) {
    return refuse(
      state,
      `“${blockSpec(type).label}” necesita algo que este estudio todavía no tiene, así que no se puede armar.`,
    );
  }

  return {
    ...state,
    definition: mapPages(state.definition, (candidate) =>
      candidate.id === pageId
        ? renumber({ ...candidate, blocks: [...candidate.blocks, created] })
        : candidate,
    ),
    selectedBlockId: created.id,
    sequence,
    refusal: null,
  };
}

/** Back to exactly what the study looks like today. Nothing was saved anyway. */
export function resetPrototype(
  state: ComposerState,
  original: ExperienceDefinitionV1,
): ComposerState {
  return { definition: original, selectedBlockId: null, sequence: state.sequence, refusal: null };
}
