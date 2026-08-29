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
 *   and a block-scoped filter that only it hosted leaves with it. A dangling
 *   reference is a validation error, and the composer should not be able to
 *   produce one by accident.
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
};

export function initialState(definition: ExperienceDefinitionV1): ComposerState {
  return { definition, selectedBlockId: null, sequence: 0 };
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
  return { ...state, selectedBlockId: blockId };
}

export function setBlockTitle(
  state: ComposerState,
  blockId: string,
  title: string,
): ComposerState {
  const trimmed = title.slice(0, EXPERIENCE_LIMITS.titleLength);
  return {
    ...state,
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
    definition: mapBlock(state.definition, blockId, (block) => ({ ...block, visible })),
  };
}

export function setChartVariant(
  state: ComposerState,
  blockId: string,
  variant: ChartVariant,
): ComposerState {
  return {
    ...state,
    definition: mapBlock(state.definition, blockId, (block) => {
      if (!block.visualization) return block;
      const spec = blockSpec(block.type as BlockType);
      // The catalogue decides what a block may become. A variant that is not on
      // its list is ignored rather than applied and rejected later.
      if (!(spec.variants as readonly string[]).includes(variant)) return block;
      return { ...block, visualization: { ...block.visualization, variant } };
    }),
  };
}

export function setBlockSamplePolicy(
  state: ComposerState,
  blockId: string,
  override: SamplePolicyOverride,
): ComposerState {
  return {
    ...state,
    definition: mapBlock(state.definition, blockId, (block) => {
      const spec = blockSpec(block.type as BlockType);
      if (!spec.allowsSamplePolicyOverride && override.kind === "override") return block;
      return { ...block, samplePolicy: override };
    }),
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

export function duplicateBlock(state: ComposerState, blockId: string): ComposerState {
  const found = findBlock(state.definition, blockId);
  if (!found) return state;
  const sequence = state.sequence + 1;
  const copy: ExperienceBlock = {
    ...found.block,
    id: mintId("block", `${blockId}/copy/${sequence}`),
    title: found.block.title
      ? `${found.block.title} (copia)`.slice(0, EXPERIENCE_LIMITS.titleLength)
      : null,
  };
  const definition = mapPages(state.definition, (page) => {
    if (page.id !== found.page.id) return page;
    const index = page.blocks.findIndex((block) => block.id === blockId);
    const blocks = [...page.blocks];
    blocks.splice(index + 1, 0, copy);
    return renumber({ ...page, blocks });
  });
  // Deliberately no connection is copied. See the module header.
  return { ...state, definition, selectedBlockId: copy.id, sequence };
}

export function removeBlock(state: ComposerState, blockId: string): ComposerState {
  const found = findBlock(state.definition, blockId);
  if (!found) return state;

  const withoutBlock = mapPages(state.definition, (page) =>
    page.id === found.page.id
      ? renumber({ ...page, blocks: page.blocks.filter((block) => block.id !== blockId) })
      : page,
  );

  const connections = withoutBlock.filterConnections.map((connection) => ({
    ...connection,
    blockIds: connection.blockIds.filter((id) => id !== blockId),
  }));

  // A block-scoped filter exists to be shown on one block. With that block
  // gone it has nowhere to live, so it goes too rather than becoming a
  // dangling reference.
  const stillHosted = new Set(
    withoutBlock.pages.flatMap((page) => page.blocks.flatMap((block) => block.filterRefs)),
  );
  const filterDefinitions = withoutBlock.filterDefinitions.filter(
    (filter) => filter.scope !== "block" || stillHosted.has(filter.id),
  );
  const remaining = new Set(filterDefinitions.map((filter) => filter.id));

  return {
    ...state,
    definition: {
      ...withoutBlock,
      filterDefinitions,
      filterConnections: connections.filter((connection) => remaining.has(connection.filterId)),
    },
    selectedBlockId: state.selectedBlockId === blockId ? null : state.selectedBlockId,
  };
}

export function moveBlock(
  state: ComposerState,
  blockId: string,
  direction: "up" | "down",
): ComposerState {
  const found = findBlock(state.definition, blockId);
  if (!found) return state;
  const definition = mapPages(state.definition, (page) => {
    if (page.id !== found.page.id) return page;
    const index = page.blocks.findIndex((block) => block.id === blockId);
    const target = direction === "up" ? index - 1 : index + 1;
    if (target < 0 || target >= page.blocks.length) return page;
    const blocks = [...page.blocks];
    [blocks[index], blocks[target]] = [blocks[target], blocks[index]];
    return renumber({ ...page, blocks });
  });
  return { ...state, definition };
}

export function addBlock(
  state: ComposerState,
  pageId: string,
  type: BlockType,
  registry: SemanticRegistry | null,
): ComposerState {
  const page = state.definition.pages.find((candidate) => candidate.id === pageId);
  if (!page) return state;
  if (page.blocks.length >= EXPERIENCE_LIMITS.blocksPerPage) return state;
  const totalBlocks = state.definition.pages.reduce(
    (total, candidate) => total + candidate.blocks.length,
    0,
  );
  if (totalBlocks >= EXPERIENCE_LIMITS.blocks) return state;

  const sequence = state.sequence + 1;
  const created = newBlock({
    type,
    seed: `${pageId}/added/${sequence}`,
    order: page.blocks.length,
    registry,
    journeyId: state.definition.journeyReferences[0]?.id ?? null,
  });
  if (!created) return state;

  return {
    ...state,
    definition: mapPages(state.definition, (candidate) =>
      candidate.id === pageId
        ? renumber({ ...candidate, blocks: [...candidate.blocks, created] })
        : candidate,
    ),
    selectedBlockId: created.id,
    sequence,
  };
}

/** Back to exactly what the study looks like today. Nothing was saved anyway. */
export function resetPrototype(
  state: ComposerState,
  original: ExperienceDefinitionV1,
): ComposerState {
  return { definition: original, selectedBlockId: null, sequence: state.sequence };
}
