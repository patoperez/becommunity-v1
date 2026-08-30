/**
 * Every edit the dashboard builder can make, as pure functions.
 *
 * WHY THEY LIVE HERE AND NOT IN THE COMPONENT. A React component is a bad
 * place to keep rules: it cannot be tested without a browser, it mixes the
 * decision with the rendering, and the first time a second surface needs the
 * same edit the rule gets copied. Every operation below takes a state and
 * returns a NEW state, touches nothing else, and is asserted by an offline
 * gate. The component holds one state object and calls these; that is all it
 * does.
 *
 * WHAT CHANGED WHEN THE BUILDER STOPPED BEING A PROTOTYPE. Nothing about the
 * shape of these functions, and everything about what happens afterwards. The
 * definition they return is now SAVED — through one Server Action, into one
 * row, under an optimistic-concurrency check. So two properties that were
 * merely tidy are now load-bearing:
 *
 *   AN EDIT NEVER LEAVES A DANGLING REFERENCE. Removing a block or a page
 *   cleans up after itself in all six places a filter id can appear, drops a
 *   connection left naming nothing, and takes a block-scoped filter nothing
 *   references any more. A document that fails validation is a document the
 *   server refuses to store, and the person who lost their work would never
 *   know which click did it.
 *
 *   A REFUSAL IS A SENTENCE. Every operation that declines returns the state
 *   unchanged WITH a reason a person can read, because an edit that silently
 *   does nothing is an edit somebody believes worked.
 *
 * TWO BEHAVIOURS THAT ARE DECISIONS RATHER THAN OMISSIONS:
 *
 *   A DUPLICATE ANSWERS TO NOTHING. Copying a block copies its query, its
 *   drawing and its layout, and deliberately NOT the filter connections that
 *   pointed at the original. A filter moves a block because somebody said so;
 *   inheriting that by accident is exactly the "same key, same behaviour"
 *   coupling the connection model exists to prevent.
 *
 *   IDENTIFIERS ARE MINTED, NEVER DERIVED FROM A LABEL. A duplicated block, a
 *   duplicated page and every block inside it get fresh opaque ids from the
 *   session's monotonic counter, so no copy can ever collide with its source
 *   or with anything React has already seen.
 *
 * UNDO AND REDO LIVE HERE TOO, for the same reason the operations do: a
 * history kept in a component is a history no gate can assert. It is bounded,
 * it holds documents rather than inverse operations, and it is deliberately
 * per-session — reopening the builder starts from what was saved.
 */

import { blockSpec, type BlockType } from "./blocks";
import {
  CHART_SPECS,
  compatibleVariants,
  type ChartVariant,
} from "./charts";
import { newBlock, newPage } from "./defaults";
import {
  findBlock,
  type ExperienceBlock,
  type ExperienceDefinitionV1,
  type ExperiencePage,
  type FilterPanel,
  type FilterPanelLayout,
  type FilterTarget,
} from "./definition";
import { filterTargetRefusal } from "./filters";
import { mintFreeId, mintId, type IdKind } from "./ids";
import { BREAKPOINTS, GRID_COLUMNS, type Breakpoint } from "./layout";
import type { Aggregation, SemanticRegistry } from "./registry";
import { findDimension, findMetric } from "./registry";
import {
  SAMPLE_POLICY_VERSION,
  type SamplePolicyMode,
  type SamplePolicyOverride,
} from "./sample-policy";
import { EXPERIENCE_LIMITS } from "./limits";

/** How many steps back a session remembers. Bounded, like everything else. */
export const HISTORY_DEPTH = 60;

/** Everything the builder holds while somebody is working in it. */
export type EditorState = {
  definition: ExperienceDefinitionV1;
  /** The block the inspector is describing, or null. */
  selectedBlockId: string | null;
  /** The page on the canvas. An id, never an index: pages get reordered. */
  openPageId: string | null;
  /**
   * A counter the builder never reuses, so a block added after another was
   * removed can never be given an identifier React has already seen.
   */
  sequence: number;
  /**
   * Why the last action changed nothing, in the words a person reads, or null
   * when the last action landed.
   */
  refusal: string | null;
  /** Documents, oldest first. Bounded to `HISTORY_DEPTH`. */
  past: ExperienceDefinitionV1[];
  /** Documents undone and not yet redone, most recently undone first. */
  future: ExperienceDefinitionV1[];
};

export function initialState(
  definition: ExperienceDefinitionV1,
  openPageId: string | null = definition.pages[0]?.id ?? null,
): EditorState {
  return {
    definition,
    selectedBlockId: null,
    openPageId,
    sequence: 0,
    refusal: null,
    past: [],
    future: [],
  };
}

/** The state unchanged, with the reason it did not change. */
function refuse(state: EditorState, reason: string): EditorState {
  return { ...state, refusal: reason };
}

/**
 * Record a change. One place, so no operation can forget the history and no
 * operation can push a step for an edit that changed nothing.
 */
function commit(
  state: EditorState,
  definition: ExperienceDefinitionV1,
  extra: Partial<Omit<EditorState, "definition" | "past" | "future" | "refusal">> = {},
): EditorState {
  if (definition === state.definition) return { ...state, ...extra, refusal: null };
  return {
    ...state,
    ...extra,
    definition,
    refusal: null,
    past: [...state.past, state.definition].slice(-HISTORY_DEPTH),
    future: [],
  };
}

export function canUndo(state: EditorState): boolean {
  return state.past.length > 0;
}

export function canRedo(state: EditorState): boolean {
  return state.future.length > 0;
}

export function undo(state: EditorState): EditorState {
  if (state.past.length === 0) return refuse(state, "No hay nada que deshacer.");
  const previous = state.past[state.past.length - 1];
  return {
    ...state,
    definition: previous,
    past: state.past.slice(0, -1),
    future: [state.definition, ...state.future].slice(0, HISTORY_DEPTH),
    selectedBlockId: stillThere(previous, state.selectedBlockId),
    openPageId: stillOpen(previous, state.openPageId),
    refusal: null,
  };
}

export function redo(state: EditorState): EditorState {
  if (state.future.length === 0) return refuse(state, "No hay nada que rehacer.");
  const next = state.future[0];
  return {
    ...state,
    definition: next,
    past: [...state.past, state.definition].slice(-HISTORY_DEPTH),
    future: state.future.slice(1),
    selectedBlockId: stillThere(next, state.selectedBlockId),
    openPageId: stillOpen(next, state.openPageId),
    refusal: null,
  };
}

function stillThere(definition: ExperienceDefinitionV1, blockId: string | null): string | null {
  if (!blockId) return null;
  return findBlock(definition, blockId) ? blockId : null;
}

function stillOpen(definition: ExperienceDefinitionV1, pageId: string | null): string | null {
  if (pageId && definition.pages.some((page) => page.id === pageId)) return pageId;
  return definition.pages[0]?.id ?? null;
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

/** Pages carry their reading order the same way blocks do. */
function renumberPages(definition: ExperienceDefinitionV1): ExperienceDefinitionV1 {
  return {
    ...definition,
    pages: definition.pages.map((page, index) => ({ ...page, order: index })),
  };
}

// ---------------------------------------------------------------------------
// Selection and navigation — no document changes, so no history step
// ---------------------------------------------------------------------------

export function selectBlock(state: EditorState, blockId: string | null): EditorState {
  return { ...state, selectedBlockId: blockId, refusal: null };
}

export function openPage(state: EditorState, pageId: string): EditorState {
  if (!state.definition.pages.some((page) => page.id === pageId)) {
    return refuse(state, "Esa página ya no está en la experiencia.");
  }
  return { ...state, openPageId: pageId, refusal: null };
}

// ---------------------------------------------------------------------------
// Editing one block's words and appearance
// ---------------------------------------------------------------------------

export function setBlockTitle(state: EditorState, blockId: string, title: string): EditorState {
  const trimmed = title.slice(0, EXPERIENCE_LIMITS.titleLength);
  return commit(
    state,
    mapBlock(state.definition, blockId, (block) => ({
      ...block,
      title: trimmed.trim() === "" ? null : trimmed,
    })),
  );
}

export type CopyField = "eyebrow" | "body" | "caption";

/**
 * The explanatory text a block carries.
 *
 * The catalogue decides whether a block carries prose at all, and the schema
 * refuses a divider that grew a paragraph. Refusing here as well means the
 * person is told, instead of typing into a field whose contents the server
 * later rejects for reasons nobody can see.
 */
export function setBlockCopy(
  state: EditorState,
  blockId: string,
  field: CopyField,
  value: string,
): EditorState {
  const found = findBlock(state.definition, blockId);
  if (!found) return refuse(state, "Ese bloque ya no está en la experiencia.");
  const spec = blockSpec(found.block.type as BlockType);
  if (spec.copy === "none") {
    return refuse(state, `“${spec.label}” no lleva texto.`);
  }
  if (field === "body" && spec.copy === "title_only") {
    return refuse(state, `“${spec.label}” solo lleva su título.`);
  }
  const limit = field === "body" ? EXPERIENCE_LIMITS.bodyLength : EXPERIENCE_LIMITS.titleLength;
  const trimmed = value.slice(0, limit);
  return commit(
    state,
    mapBlock(state.definition, blockId, (block) => ({
      ...block,
      copy: { ...block.copy, [field]: trimmed.trim() === "" ? null : trimmed },
    })),
  );
}

export function setBlockVisibility(
  state: EditorState,
  blockId: string,
  visible: boolean,
): EditorState {
  return commit(
    state,
    mapBlock(state.definition, blockId, (block) => ({ ...block, visible })),
  );
}

/**
 * How wide a block is at one width.
 *
 * ON A PHONE EVERY BLOCK IS FULL WIDTH, always, and asking for anything else is
 * refused rather than clamped: a 320 px screen has no room for two things side
 * by side, and a builder that let somebody arrange four cards in a row there is
 * a builder that ships horizontal scrolling to a client.
 */
export function setBlockSpan(
  state: EditorState,
  blockId: string,
  breakpoint: Breakpoint,
  span: number,
): EditorState {
  const found = findBlock(state.definition, blockId);
  if (!found) return refuse(state, "Ese bloque ya no está en la experiencia.");
  if (breakpoint === "mobile") {
    return refuse(state, "En teléfono cada bloque ocupa el ancho completo; eso no se ajusta.");
  }
  const spec = blockSpec(found.block.type as BlockType);
  const wanted = Math.round(span);
  if (wanted < spec.span.min || wanted > spec.span.max) {
    return refuse(
      state,
      `“${spec.label}” admite entre ${spec.span.min} y ${spec.span.max} de las ${GRID_COLUMNS} columnas.`,
    );
  }
  return commit(
    state,
    mapBlock(state.definition, blockId, (block) => ({
      ...block,
      layout: { ...block.layout, [breakpoint]: { ...block.layout[breakpoint], span: wanted } },
    })),
  );
}

export function setChartVariant(
  state: EditorState,
  blockId: string,
  variant: ChartVariant,
): EditorState {
  const found = findBlock(state.definition, blockId);
  if (!found) return refuse(state, "Ese bloque ya no está en la experiencia.");
  if (!found.block.visualization) {
    return refuse(state, "Este bloque no se dibuja como gráfica, así que no hay nada que cambiar.");
  }
  const spec = blockSpec(found.block.type as BlockType);
  // The catalogue decides what a block may become. A variant that is not on its
  // list is refused OUT LOUD rather than applied and rejected later.
  if (!(spec.variants as readonly string[]).includes(variant)) {
    return refuse(state, `“${spec.label}” no se puede dibujar de esa manera.`);
  }
  return commit(
    state,
    mapBlock(state.definition, blockId, (block) =>
      block.visualization
        ? { ...block, visualization: { ...block.visualization, variant } }
        : block,
    ),
  );
}

// ---------------------------------------------------------------------------
// Editing what a block asks for
// ---------------------------------------------------------------------------

function dimensionCount(query: { primaryDimensionId: string | null; secondaryDimensionId: string | null }): 0 | 1 | 2 {
  return ((query.primaryDimensionId ? 1 : 0) + (query.secondaryDimensionId ? 1 : 0)) as 0 | 1 | 2;
}

/**
 * The drawing a block should carry after its query changed.
 *
 * Keep what it has when the new query can still support it; otherwise take the
 * first drawing that the block type allows, the result can honestly become, and
 * the query can actually satisfy. Returning null means there is none, and the
 * caller refuses the whole edit rather than storing a block that validates
 * against nothing.
 */
function variantFor(
  blockType: BlockType,
  current: ChartVariant | null,
  metricCharts: readonly string[],
  dimensions: 0 | 1 | 2,
): ChartVariant | null {
  if (current === null) return null;
  const spec = blockSpec(blockType);
  const possible = compatibleVariants(metricCharts, dimensions).filter((variant) =>
    (spec.variants as readonly string[]).includes(variant),
  );
  if (current && possible.includes(current)) return current;
  return possible[0] ?? null;
}

export function setBlockMetric(
  state: EditorState,
  blockId: string,
  metricId: string,
  registry: SemanticRegistry,
): EditorState {
  const found = findBlock(state.definition, blockId);
  if (!found) return refuse(state, "Ese bloque ya no está en la experiencia.");
  if (!found.block.query) return refuse(state, "Este bloque no muestra un resultado.");
  const metric = findMetric(registry, metricId);
  if (!metric) return refuse(state, "Ese resultado no existe en este estudio.");

  const query = found.block.query;
  const aggregation: Aggregation = metric.aggregations.includes(query.aggregation)
    ? query.aggregation
    : metric.defaultAggregation;
  const variant = variantFor(
    found.block.type as BlockType,
    found.block.visualization?.variant ?? null,
    metric.charts,
    dimensionCount(query),
  );
  if (found.block.visualization && !variant) {
    return refuse(
      state,
      `“${metric.label}” no se puede dibujar como este bloque lo necesita. Cambia primero la gráfica o el desglose.`,
    );
  }

  return commit(
    state,
    mapBlock(state.definition, blockId, (block) =>
      block.query
        ? {
            ...block,
            query: {
              ...block.query,
              metricId: metric.id,
              aggregation,
              // The result declares how its own number is written down. Keeping
              // the previous format would print an NPS with a per-cent sign.
              numberFormat: { ...metric.format },
            },
            visualization:
              block.visualization && variant
                ? { ...block.visualization, variant }
                : block.visualization,
          }
        : block,
    ),
  );
}

export function setBlockAggregation(
  state: EditorState,
  blockId: string,
  aggregation: Aggregation,
  registry: SemanticRegistry,
): EditorState {
  const found = findBlock(state.definition, blockId);
  if (!found) return refuse(state, "Ese bloque ya no está en la experiencia.");
  if (!found.block.query) return refuse(state, "Este bloque no muestra un resultado.");
  const metric = findMetric(registry, found.block.query.metricId);
  if (!metric) return refuse(state, "Ese resultado no existe en este estudio.");
  if (!metric.aggregations.includes(aggregation)) {
    return refuse(state, `“${metric.label}” no se puede calcular de esa manera.`);
  }
  return commit(
    state,
    mapBlock(state.definition, blockId, (block) =>
      block.query ? { ...block, query: { ...block.query, aggregation } } : block,
    ),
  );
}

export function setBlockDimension(
  state: EditorState,
  blockId: string,
  slot: "primary" | "secondary",
  dimensionId: string | null,
  registry: SemanticRegistry,
): EditorState {
  const found = findBlock(state.definition, blockId);
  if (!found) return refuse(state, "Ese bloque ya no está en la experiencia.");
  if (!found.block.query) return refuse(state, "Este bloque no muestra un resultado.");
  const query = found.block.query;

  if (dimensionId !== null) {
    const dimension = findDimension(registry, dimensionId);
    if (!dimension) return refuse(state, "Esa característica no existe en este estudio.");
    if (dimension.values.length > EXPERIENCE_LIMITS.dimensionCardinality) {
      return refuse(
        state,
        `“${dimension.label}” tiene ${dimension.values.length} valores distintos; el máximo legible en una gráfica es ${EXPERIENCE_LIMITS.dimensionCardinality}.`,
      );
    }
    const other = slot === "primary" ? query.secondaryDimensionId : query.primaryDimensionId;
    if (other === dimensionId) {
      return refuse(state, "Un resultado no se puede cruzar dos veces con la misma característica.");
    }
  }

  const next = {
    primaryDimensionId: slot === "primary" ? dimensionId : query.primaryDimensionId,
    secondaryDimensionId: slot === "secondary" ? dimensionId : query.secondaryDimensionId,
  };
  // A second characteristic with no first one is not a cross, it is a mistake
  // the schema refuses. Removing the first promotes the second rather than
  // producing a document nothing can store.
  if (!next.primaryDimensionId && next.secondaryDimensionId) {
    next.primaryDimensionId = next.secondaryDimensionId;
    next.secondaryDimensionId = null;
  }

  const metric = findMetric(registry, query.metricId);
  if (!metric) return refuse(state, "Ese resultado ya no existe en este estudio.");
  const variant = variantFor(
    found.block.type as BlockType,
    found.block.visualization?.variant ?? null,
    metric.charts,
    dimensionCount(next),
  );
  if (found.block.visualization && !variant) {
    return refuse(
      state,
      "Con ese desglose no queda ninguna gráfica que este bloque pueda dibujar honestamente. Cambia primero el tipo de gráfica.",
    );
  }

  return commit(
    state,
    mapBlock(state.definition, blockId, (block) =>
      block.query
        ? {
            ...block,
            query: { ...block.query, ...next },
            visualization:
              block.visualization && variant
                ? { ...block.visualization, variant }
                : block.visualization,
          }
        : block,
    ),
  );
}

// ---------------------------------------------------------------------------
// Disclosure
// ---------------------------------------------------------------------------

export function setBlockSamplePolicy(
  state: EditorState,
  blockId: string,
  override: SamplePolicyOverride,
): EditorState {
  const found = findBlock(state.definition, blockId);
  if (!found) return refuse(state, "Ese bloque ya no está en la experiencia.");
  const spec = blockSpec(found.block.type as BlockType);
  if (!spec.allowsSamplePolicyOverride && override.kind === "override") {
    return refuse(state, `“${spec.label}” siempre sigue la regla del estudio.`);
  }
  return commit(
    state,
    mapBlock(state.definition, blockId, (block) => ({ ...block, samplePolicy: override })),
  );
}

/** The study-wide rule: show everything, warn under a number, or hide under it. */
export function setStudySamplePolicy(
  state: EditorState,
  mode: SamplePolicyMode,
  threshold: number = state.definition.sampleVisibilityPolicy.threshold,
): EditorState {
  return commit(state, {
    ...state.definition,
    sampleVisibilityPolicy: {
      policyVersion: SAMPLE_POLICY_VERSION,
      mode,
      threshold: Math.min(100_000, Math.max(1, Math.round(threshold))),
    },
  });
}

// ---------------------------------------------------------------------------
// Filter connections — explicit, never implied by a shared characteristic
// ---------------------------------------------------------------------------

/**
 * Whether one filter moves one block.
 *
 * This is the whole reason the connection structure exists: two charts can both
 * be broken down by generation and only one of them be meant to follow the
 * reader's choice. Connecting and disconnecting are therefore an explicit,
 * per-pair act, and a connection emptied of its last block is removed rather
 * than kept as a statement about nothing.
 */
export function setFilterConnection(
  state: EditorState,
  filterId: string,
  blockId: string,
  connected: boolean,
): EditorState {
  const definition = state.definition;
  if (!definition.filterDefinitions.some((filter) => filter.id === filterId)) {
    return refuse(state, "Ese filtro ya no existe en esta experiencia.");
  }
  if (!findBlock(definition, blockId)) {
    return refuse(state, "Ese bloque ya no está en la experiencia.");
  }

  // REFUSED, WITH THE REASON, WHEN THE BLOCK SHOWS NOTHING THAT RECOMPUTES.
  // The card no longer OFFERS this on a static block at all, but a connection
  // can also arrive from the panel's own target list and from an older
  // document, so the rule lives with the operation rather than with one screen.
  if (connected) {
    const found = findBlock(definition, blockId);
    const refusal = found ? filterTargetRefusal(found.block) : null;
    if (found && refusal) {
      const label = found.block.title ?? blockSpec(found.block.type as BlockType).label;
      return refuse(state, `“${label}” ${refusal}, así que un filtro no lo cambiaría.`);
    }
  }

  const existing = definition.filterConnections.find(
    (connection) => connection.filterId === filterId,
  );
  const already = existing?.blockIds.includes(blockId) ?? false;
  if (already === connected) {
    return refuse(
      state,
      connected
        ? "Ese filtro ya mueve este bloque."
        : "Ese filtro ya no movía este bloque.",
    );
  }

  if (connected) {
    if (!existing) {
      if (definition.filterConnections.length >= EXPERIENCE_LIMITS.filterConnections) {
        return refuse(
          state,
          `Esta experiencia ya tiene las ${EXPERIENCE_LIMITS.filterConnections} conexiones que admite.`,
        );
      }
      return commit(state, {
        ...definition,
        filterConnections: [
          ...definition.filterConnections,
          {
            id: mintFreeId(
              "connection",
              `${filterId}/${blockId}/${state.sequence + 1}`,
              (id) => definition.filterConnections.some((connection) => connection.id === id),
            ),
            filterId,
            blockIds: [blockId],
          },
        ],
      }, { sequence: state.sequence + 1 });
    }
    if (existing.blockIds.length >= EXPERIENCE_LIMITS.blocksPerConnection) {
      return refuse(state, "Ese filtro ya mueve todos los bloques que admite una conexión.");
    }
    return commit(state, {
      ...definition,
      filterConnections: definition.filterConnections.map((connection) =>
        connection.filterId === filterId
          ? { ...connection, blockIds: [...connection.blockIds, blockId] }
          : connection,
      ),
    });
  }

  return commit(state, {
    ...definition,
    filterConnections: definition.filterConnections
      .map((connection) =>
        connection.filterId === filterId
          ? { ...connection, blockIds: connection.blockIds.filter((id) => id !== blockId) }
          : connection,
      )
      .filter((connection) => connection.blockIds.length > 0),
  });
}

// ---------------------------------------------------------------------------
// Adding, copying, moving and removing
// ---------------------------------------------------------------------------

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
        // A fixed filter names a CHARACTERISTIC, not a filter definition, so
        // removing a viewer control can no longer change what a block is
        // permanently about. That independence is the point of the version-2
        // shape, and a panel's target names BLOCKS, so neither has anything to
        // clean up when a filter goes.
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

/**
 * Everything a document has to forget once a set of blocks is gone.
 *
 * Shared by "remove one block" and "remove a whole page", because the cleanup
 * is identical and a page removal that only remembered half of it would leave
 * exactly the dangling references this function exists to prevent.
 */
function forgetBlocks(
  definition: ExperienceDefinitionV1,
  removedBlockIds: ReadonlySet<string>,
): ExperienceDefinitionV1 {
  const connections = definition.filterConnections
    .map((connection) => ({
      ...connection,
      blockIds: connection.blockIds.filter((id) => !removedBlockIds.has(id)),
    }))
    // A connection that now names nothing is not a connection. Keeping it would
    // leave a statement about blocks that no longer exist in the document.
    .filter((connection) => connection.blockIds.length > 0);

  /*
   * A PANEL'S TARGET IS THE OTHER PLACE A BLOCK ID LIVES, so it is cleaned in
   * the same breath. A target left naming a removed block is refused by the
   * schema, which would turn "quitar este bloque" into a draft that can never
   * be saved again — the same class of dead end the duplicate-id defect was.
   *
   * A `sections` or `blocks` target emptied by the removal falls back to the
   * page it sits on rather than to nothing: a panel that governs nothing is a
   * box of controls that silently do not work, and the person is told which
   * blocks it used to move before they confirm.
   */
  const pagesWithoutBlocks = definition.pages.map((page) => ({
    ...page,
    blocks: page.blocks.map((block) => {
      if (!block.filterPanel) return block;
      const target = block.filterPanel.target;
      if (target.kind === "blocks") {
        const kept = target.blockIds.filter((id) => !removedBlockIds.has(id));
        return {
          ...block,
          filterPanel: {
            ...block.filterPanel,
            target: kept.length > 0
              ? { kind: "blocks" as const, blockIds: kept }
              : { kind: "page" as const },
          },
        };
      }
      if (target.kind === "sections") {
        const kept = target.sectionIds.filter((id) => !removedBlockIds.has(id));
        return {
          ...block,
          filterPanel: {
            ...block.filterPanel,
            target: kept.length > 0
              ? { kind: "sections" as const, sectionIds: kept }
              : { kind: "page" as const },
          },
        };
      }
      return block;
    }),
  }));

  // A block-scoped filter exists to be shown on one block. With that block
  // gone it has nowhere to live, so it goes too rather than becoming a
  // dangling reference — UNLESS something else still names it: a page, a
  // panel, another block's hosted controls, or a journey.
  const stillReferenced = new Set([
    ...pagesWithoutBlocks.flatMap((page) => [
      ...page.filterRefs,
      ...page.blocks.flatMap((block) => block.filterRefs),
    ]),
    ...definition.journeyReferences.flatMap((journey) => journey.filterRefs),
  ]);
  const orphaned = new Set(
    definition.filterDefinitions
      .filter((filter) => filter.scope === "block" && !stillReferenced.has(filter.id))
      .map((filter) => filter.id),
  );

  return pruneFilterReferences(
    { ...definition, pages: pagesWithoutBlocks, filterConnections: connections },
    orphaned,
  );
}


/**
 * Every identifier the document already holds, of every kind.
 *
 * The uniqueness rule the schema enforces is document-wide for pages and for
 * blocks, so the set a new id must avoid is document-wide too. Cheap: a
 * composed experience is bounded at 24 pages, 300 blocks, 24 filters and 200
 * connections, and this runs once per creating operation.
 */
function takenIds(definition: ExperienceDefinitionV1): Set<string> {
  const taken = new Set<string>([definition.id]);
  for (const page of definition.pages) {
    taken.add(page.id);
    for (const block of page.blocks) taken.add(block.id);
  }
  for (const filter of definition.filterDefinitions) taken.add(filter.id);
  for (const connection of definition.filterConnections) taken.add(connection.id);
  for (const journey of definition.journeyReferences) {
    taken.add(journey.id);
    for (const moment of journey.moments) taken.add(moment.id);
  }
  return taken;
}

/**
 * A seed whose minted identifier is free, for the factories that mint from a
 * seed rather than taking an id. Salted exactly the way `mintFreeId` salts, so
 * the two agree on what the nth alternative is.
 */
function freeSeed(definition: ExperienceDefinitionV1, kind: IdKind, seed: string): string {
  const taken = takenIds(definition);
  if (!taken.has(mintId(kind, seed))) return seed;
  for (let attempt = 1; attempt <= 512; attempt += 1) {
    const candidate = `${seed}~${attempt}`;
    if (!taken.has(mintId(kind, candidate))) return candidate;
  }
  return `${seed}~overflow`;
}

export function addBlock(
  state: EditorState,
  pageId: string,
  type: BlockType,
  registry: SemanticRegistry | null,
): EditorState {
  const page = state.definition.pages.find((candidate) => candidate.id === pageId);
  if (!page) return refuse(state, "Esa página ya no está en la experiencia.");
  const full = roomForOneMoreBlock(state.definition, page);
  if (full) return refuse(state, full);

  const sequence = state.sequence + 1;
  const created = newBlock({
    type,
    seed: freeSeed(state.definition, "block", `${pageId}/added/${sequence}`),
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

  return commit(
    state,
    mapPages(state.definition, (candidate) =>
      candidate.id === pageId
        ? renumber({ ...candidate, blocks: [...candidate.blocks, created] })
        : candidate,
    ),
    { selectedBlockId: created.id, sequence },
  );
}

export function duplicateBlock(state: EditorState, blockId: string): EditorState {
  const found = findBlock(state.definition, blockId);
  if (!found) return refuse(state, "Ese bloque ya no está en la experiencia.");
  // The same ceilings that bound "añadir". A copy is a block; an operation that
  // creates one without asking is an operation that can build a page the schema
  // then refuses to save.
  const full = roomForOneMoreBlock(state.definition, found.page);
  if (full) return refuse(state, full);

  const sequence = state.sequence + 1;
  const taken = takenIds(state.definition);
  const copy: ExperienceBlock = {
    ...found.block,
    id: mintFreeId("block", `${blockId}/copy/${sequence}`, (id) => taken.has(id)),
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
  return commit(state, definition, { selectedBlockId: copy.id, sequence });
}

export function removeBlock(state: EditorState, blockId: string): EditorState {
  const found = findBlock(state.definition, blockId);
  if (!found) return refuse(state, "Ese bloque ya no está en la experiencia.");

  const withoutBlock = mapPages(state.definition, (page) =>
    page.id === found.page.id
      ? renumber({ ...page, blocks: page.blocks.filter((block) => block.id !== blockId) })
      : page,
  );

  return commit(state, forgetBlocks(withoutBlock, new Set([blockId])), {
    selectedBlockId: state.selectedBlockId === blockId ? null : state.selectedBlockId,
  });
}

export function moveBlock(
  state: EditorState,
  blockId: string,
  direction: "up" | "down",
): EditorState {
  const found = findBlock(state.definition, blockId);
  if (!found) return refuse(state, "Ese bloque ya no está en la experiencia.");
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
  return commit(
    state,
    mapPages(state.definition, (page) => {
      if (page.id !== found.page.id) return page;
      const blocks = [...page.blocks];
      [blocks[index], blocks[target]] = [blocks[target], blocks[index]];
      return renumber({ ...page, blocks });
    }),
  );
}

/**
 * Drop a block at an exact position — what a drag ends in.
 *
 * `index` is a position in the page's block array AFTER the block has been
 * taken out of it, which is the only interpretation that makes "drop it where
 * the line is" behave the same dragging up and dragging down.
 */
export function moveBlockToIndex(
  state: EditorState,
  blockId: string,
  index: number,
): EditorState {
  const found = findBlock(state.definition, blockId);
  if (!found) return refuse(state, "Ese bloque ya no está en la experiencia.");
  const from = found.page.blocks.findIndex((block) => block.id === blockId);
  const remaining = found.page.blocks.filter((block) => block.id !== blockId);
  const target = Math.max(0, Math.min(remaining.length, Math.round(index)));
  if (target === from) return { ...state, refusal: null };
  const blocks = [...remaining];
  blocks.splice(target, 0, found.block);
  return commit(
    state,
    mapPages(state.definition, (page) =>
      page.id === found.page.id ? renumber({ ...page, blocks }) : page,
    ),
  );
}

// ---------------------------------------------------------------------------
// Pages
// ---------------------------------------------------------------------------

export function addPage(state: EditorState, title: string): EditorState {
  if (state.definition.pages.length >= EXPERIENCE_LIMITS.pages) {
    return refuse(
      state,
      `Una experiencia admite ${EXPERIENCE_LIMITS.pages} páginas como máximo.`,
    );
  }
  const trimmed = title.trim().slice(0, EXPERIENCE_LIMITS.titleLength);
  if (trimmed === "") return refuse(state, "Ponle un nombre a la página.");
  const sequence = state.sequence + 1;
  const page = newPage(
    freeSeed(state.definition, "page", `${state.definition.id}/page/added/${sequence}`),
    trimmed,
    state.definition.pages.length,
  );
  return commit(
    state,
    renumberPages({ ...state.definition, pages: [...state.definition.pages, page] }),
    { openPageId: page.id, selectedBlockId: null, sequence },
  );
}

export function renamePage(state: EditorState, pageId: string, title: string): EditorState {
  if (!state.definition.pages.some((page) => page.id === pageId)) {
    return refuse(state, "Esa página ya no está en la experiencia.");
  }
  const trimmed = title.slice(0, EXPERIENCE_LIMITS.titleLength);
  if (trimmed.trim() === "") return refuse(state, "Una página necesita un nombre.");
  return commit(
    state,
    mapPages(state.definition, (page) =>
      page.id === pageId ? { ...page, title: trimmed } : page,
    ),
  );
}

export function setPageVisibility(
  state: EditorState,
  pageId: string,
  visible: boolean,
): EditorState {
  if (!state.definition.pages.some((page) => page.id === pageId)) {
    return refuse(state, "Esa página ya no está en la experiencia.");
  }
  return commit(
    state,
    mapPages(state.definition, (page) => (page.id === pageId ? { ...page, visible } : page)),
  );
}

export function movePage(
  state: EditorState,
  pageId: string,
  direction: "up" | "down",
): EditorState {
  const index = state.definition.pages.findIndex((page) => page.id === pageId);
  if (index === -1) return refuse(state, "Esa página ya no está en la experiencia.");
  const target = direction === "up" ? index - 1 : index + 1;
  if (target < 0 || target >= state.definition.pages.length) {
    return refuse(
      state,
      direction === "up" ? "Ya es la primera página." : "Ya es la última página.",
    );
  }
  const pages = [...state.definition.pages];
  [pages[index], pages[target]] = [pages[target], pages[index]];
  return commit(state, renumberPages({ ...state.definition, pages }));
}

/** Drop a page at an exact position — what a drag in the page list ends in. */
export function movePageToIndex(state: EditorState, pageId: string, index: number): EditorState {
  const from = state.definition.pages.findIndex((page) => page.id === pageId);
  if (from === -1) return refuse(state, "Esa página ya no está en la experiencia.");
  const remaining = state.definition.pages.filter((page) => page.id !== pageId);
  const target = Math.max(0, Math.min(remaining.length, Math.round(index)));
  if (target === from) return { ...state, refusal: null };
  const pages = [...remaining];
  pages.splice(target, 0, state.definition.pages[from]);
  return commit(state, renumberPages({ ...state.definition, pages }));
}

/**
 * A copy of one page, with every block on it given a fresh identifier.
 *
 * Reusing a block id across two pages is a document the schema refuses
 * ("repeated block across pages"), and one the connection model could not read
 * either: a filter that named the block would silently move both copies. The
 * duplicate therefore answers to no connection, exactly like a duplicated
 * block, and for the same reason.
 */
export function duplicatePage(state: EditorState, pageId: string): EditorState {
  const source = state.definition.pages.find((page) => page.id === pageId);
  if (!source) return refuse(state, "Esa página ya no está en la experiencia.");
  if (state.definition.pages.length >= EXPERIENCE_LIMITS.pages) {
    return refuse(
      state,
      `Una experiencia admite ${EXPERIENCE_LIMITS.pages} páginas como máximo.`,
    );
  }
  const total = state.definition.pages.reduce((sum, page) => sum + page.blocks.length, 0);
  if (total + source.blocks.length > EXPERIENCE_LIMITS.blocks) {
    return refuse(
      state,
      `La copia no cabe: la experiencia llegaría a más de los ${EXPERIENCE_LIMITS.blocks} bloques que admite.`,
    );
  }

  const sequence = state.sequence + 1;
  const taken = takenIds(state.definition);
  const copy: ExperiencePage = {
    ...source,
    id: mintFreeId("page", `${pageId}/copy/${sequence}`, (id) => taken.has(id)),
    title: `${source.title} (copia)`.slice(0, EXPERIENCE_LIMITS.titleLength),
    // A page-scoped filter control belongs to the page it was declared on. The
    // copy hosts none, for the same reason a duplicated block hosts none.
    filterRefs: [],
    blocks: source.blocks.map((block, index) => ({
      ...block,
      id: mintFreeId("block", `${block.id}/pagecopy/${sequence}/${index}`, (id) => {
        if (taken.has(id)) return true;
        taken.add(id);
        return false;
      }),
      filterRefs: [],
    })),
  };
  const index = state.definition.pages.findIndex((page) => page.id === pageId);
  const pages = [...state.definition.pages];
  pages.splice(index + 1, 0, copy);
  return commit(state, renumberPages({ ...state.definition, pages }), {
    openPageId: copy.id,
    selectedBlockId: null,
    sequence,
  });
}

export function removePage(state: EditorState, pageId: string): EditorState {
  const source = state.definition.pages.find((page) => page.id === pageId);
  if (!source) return refuse(state, "Esa página ya no está en la experiencia.");
  if (state.definition.pages.length === 1) {
    return refuse(state, "Una experiencia necesita al menos una página.");
  }

  const removedBlockIds = new Set(source.blocks.map((block) => block.id));
  const withoutPage = renumberPages({
    ...state.definition,
    pages: state.definition.pages.filter((page) => page.id !== pageId),
    // A page-scoped filter cannot outlive its page: the schema requires it to
    // name one, so leaving it behind would be a dangling reference.
    filterDefinitions: state.definition.filterDefinitions.filter(
      (filter) => filter.pageId !== pageId,
    ),
  });
  const removedFilters = new Set(
    state.definition.filterDefinitions
      .filter((filter) => filter.pageId === pageId)
      .map((filter) => filter.id),
  );

  return commit(
    state,
    forgetBlocks(pruneFilterReferences(withoutPage, removedFilters), removedBlockIds),
    {
      openPageId: withoutPage.pages[0]?.id ?? null,
      selectedBlockId:
        state.selectedBlockId && removedBlockIds.has(state.selectedBlockId)
          ? null
          : state.selectedBlockId,
    },
  );
}

// ---------------------------------------------------------------------------
// Starting over
// ---------------------------------------------------------------------------

/**
 * Back to the arrangement the study's own configuration produces.
 *
 * This is an ORDINARY EDIT, not a discard: it replaces what is on screen, it
 * goes into the undo history like everything else, and it only reaches storage
 * when the draft is saved. Nothing is destroyed by pressing it.
 */
export function resetToAdapted(
  state: EditorState,
  adapted: ExperienceDefinitionV1,
): EditorState {
  return commit(state, adapted, {
    selectedBlockId: null,
    openPageId: adapted.pages[0]?.id ?? null,
  });
}

/**
 * Replace the document with one that arrived from elsewhere — the copy the
 * server sent back after somebody else saved a newer revision.
 *
 * It clears the history rather than pushing a step: "undo" after taking
 * somebody else's version would restore a document whose revision no longer
 * exists, and the next save would conflict again with no explanation.
 */
export function adoptDefinition(
  state: EditorState,
  definition: ExperienceDefinitionV1,
): EditorState {
  return {
    ...state,
    definition,
    past: [],
    future: [],
    selectedBlockId: stillThere(definition, state.selectedBlockId),
    openPageId: stillOpen(definition, state.openPageId),
    refusal: null,
  };
}

/** Re-exported so a caller needs one import for the chart vocabulary. */
export { CHART_SPECS };

// ---------------------------------------------------------------------------
// Identidad y portada del estudio
// ---------------------------------------------------------------------------

/**
 * The identity layer is edited on its own, and it is edited as a WHOLE FIELD
 * AT A TIME rather than through one setter per property.
 *
 * It is a small, closed object of authored words and five independent show
 * switches; five setters and five reducer cases would be five places for the
 * ceiling on a title to be forgotten. The trimming is done once, here.
 */
export type IdentityField = "title" | "organization" | "period" | "description";

export function setIdentityText(
  state: EditorState,
  field: IdentityField,
  value: string,
): EditorState {
  const limit =
    field === "description" ? EXPERIENCE_LIMITS.bodyLength : EXPERIENCE_LIMITS.titleLength;
  const trimmed = value.slice(0, limit);
  const empty = trimmed.trim() === "";
  const identity = { ...state.definition.identity };

  if (field === "title") {
    // The study's own name is the one part that cannot become nothing: an
    // identity layer with no title is a report that does not say what it is.
    if (empty) return refuse(state, "El estudio necesita un título visible.");
    identity.title = trimmed;
  } else {
    identity[field] = empty ? null : trimmed;
    // Emptying a part turns its switch off rather than leaving a heading with
    // nothing under it — absence renders as nothing, never as a blank line.
    if (empty) identity.show = { ...identity.show, [field]: false };
  }

  return commit(state, { ...state.definition, identity });
}

export type IdentityPart = "title" | "organization" | "period" | "description" | "mark";

export function toggleIdentityPart(
  state: EditorState,
  part: IdentityPart,
  shown: boolean,
): EditorState {
  const identity = state.definition.identity;
  if (shown && part !== "title" && part !== "mark" && !identity[part]) {
    return refuse(state, "Escribe algo antes de mostrarlo en la portada.");
  }
  return commit(state, {
    ...state.definition,
    identity: {
      ...identity,
      show: { ...identity.show, [part]: shown },
      mark: part === "mark"
        ? shown
          ? { source: "client_brand" as const }
          : { source: "none" as const }
        : identity.mark,
    },
  });
}

export function setIdentityVisible(state: EditorState, visible: boolean): EditorState {
  return commit(state, {
    ...state.definition,
    identity: { ...state.definition.identity, visible },
  });
}

export function setIdentityReportDownload(state: EditorState, offered: boolean): EditorState {
  return commit(state, {
    ...state.definition,
    identity: { ...state.definition.identity, showReportDownload: offered },
  });
}

// ---------------------------------------------------------------------------
// Panel de filtros para explorar
// ---------------------------------------------------------------------------

function mapPanel(
  state: EditorState,
  blockId: string,
  change: (panel: FilterPanel, block: ExperienceBlock) => FilterPanel,
): EditorState {
  const found = findBlock(state.definition, blockId);
  if (!found || !found.block.filterPanel) {
    return refuse(state, "Ese panel de filtros ya no está en la experiencia.");
  }
  return commit(
    state,
    mapBlock(state.definition, blockId, (block) =>
      block.filterPanel ? { ...block, filterPanel: change(block.filterPanel, block) } : block,
    ),
  );
}

export function setPanelLayout(
  state: EditorState,
  blockId: string,
  layout: FilterPanelLayout,
): EditorState {
  return mapPanel(state, blockId, (panel) => ({ ...panel, layout }));
}

export function setPanelIntro(state: EditorState, blockId: string, intro: string): EditorState {
  const trimmed = intro.slice(0, EXPERIENCE_LIMITS.bodyLength);
  return mapPanel(state, blockId, (panel) => ({
    ...panel,
    intro: trimmed.trim() === "" ? null : trimmed,
  }));
}

export function setPanelOption(
  state: EditorState,
  blockId: string,
  option: "showClear" | "showActive",
  on: boolean,
): EditorState {
  return mapPanel(state, blockId, (panel) => ({ ...panel, [option]: on }));
}

/**
 * Offer a characteristic on this panel, or stop offering it.
 *
 * ADDING A CONTROL IS NOT THE SAME ACT AS CHOOSING WHAT IT MOVES. The panel's
 * `target` answers the second question once for the whole panel, so adding a
 * characteristic here never silently rewires anything.
 */
export function togglePanelFilter(
  state: EditorState,
  blockId: string,
  filterId: string,
  offered: boolean,
): EditorState {
  const found = findBlock(state.definition, blockId);
  if (!found || found.block.type !== "filter_panel") {
    return refuse(state, "Ese panel de filtros ya no está en la experiencia.");
  }
  if (!state.definition.filterDefinitions.some((filter) => filter.id === filterId)) {
    return refuse(state, "Esa característica ya no está en la experiencia.");
  }
  const current = found.block.filterRefs;
  if (offered && current.includes(filterId)) return state;
  if (!offered && !current.includes(filterId)) return state;
  if (offered && current.length >= EXPERIENCE_LIMITS.filtersPerPanel) {
    return refuse(
      state,
      `Un panel ofrece hasta ${EXPERIENCE_LIMITS.filtersPerPanel} características.`,
    );
  }
  return commit(
    state,
    mapBlock(state.definition, blockId, (block) => ({
      ...block,
      filterRefs: offered
        ? [...current, filterId]
        : current.filter((candidate) => candidate !== filterId),
    })),
  );
}

/** The order the controls appear in, which is the order a person reads them. */
export function movePanelFilter(
  state: EditorState,
  blockId: string,
  filterId: string,
  direction: "up" | "down",
): EditorState {
  const found = findBlock(state.definition, blockId);
  if (!found || found.block.type !== "filter_panel") {
    return refuse(state, "Ese panel de filtros ya no está en la experiencia.");
  }
  const order = [...found.block.filterRefs];
  const index = order.indexOf(filterId);
  if (index < 0) return refuse(state, "Ese filtro no está en este panel.");
  const next = direction === "up" ? index - 1 : index + 1;
  if (next < 0) return refuse(state, "Ya es el primero del panel.");
  if (next >= order.length) return refuse(state, "Ya es el último del panel.");
  [order[index], order[next]] = [order[next], order[index]];
  return commit(
    state,
    mapBlock(state.definition, blockId, (block) => ({ ...block, filterRefs: order })),
  );
}

/**
 * WHAT THIS PANEL MOVES.
 *
 * The scope changes; nothing about the controls does. A `blocks` or `sections`
 * target that would name nothing is refused with a sentence rather than
 * stored, because a panel connected to nothing looks identical to a panel that
 * is simply not working.
 */
export function setPanelTarget(
  state: EditorState,
  blockId: string,
  target: FilterTarget,
): EditorState {
  const found = findBlock(state.definition, blockId);
  if (!found || found.block.type !== "filter_panel") {
    return refuse(state, "Ese panel de filtros ya no está en la experiencia.");
  }
  if (target.kind === "blocks" && target.blockIds.length === 0) {
    return refuse(state, "Elige al menos un bloque para que el panel tenga algo que mover.");
  }
  if (target.kind === "sections" && target.sectionIds.length === 0) {
    return refuse(state, "Elige al menos una sección para que el panel tenga algo que mover.");
  }
  return mapPanel(state, blockId, (panel) => ({ ...panel, target }));
}

/**
 * STOP ONE PANEL MOVING ONE BLOCK, asked from the block's own card.
 *
 * A panel whose scope is "exactly these blocks" simply loses this one. A panel
 * whose scope is the whole experience, the whole page or chosen sections
 * governs this block BY POSITION rather than by name, so there is nothing here
 * to remove — and inventing a per-block exception list would make "every
 * compatible block" mean something different on every panel. It is refused
 * with a sentence that says where the decision actually lives, which is the
 * panel the card links to.
 */
export function detachBlockFromPanel(
  state: EditorState,
  panelId: string,
  blockId: string,
): EditorState {
  const panel = findBlock(state.definition, panelId);
  if (!panel || !panel.block.filterPanel) {
    return refuse(state, "Ese panel de filtros ya no está en la experiencia.");
  }
  const target = panel.block.filterPanel.target;
  const name = panel.block.title ?? blockSpec("filter_panel").label;
  if (target.kind === "blocks") return togglePanelTargetBlock(state, panelId, blockId, false);

  const scope =
    target.kind === "experience"
      ? "toda la experiencia"
      : target.kind === "page"
        ? "toda esta página"
        : "las secciones que tiene elegidas";
  return refuse(
    state,
    `“${name}” mueve ${scope}, así que no se puede quitar un bloque suelto. Abre el panel y cambia su alcance.`,
  );
}

/**
 * Add or remove ONE block from an explicit `blocks` target.
 *
 * REFUSED, WITH A REASON, WHEN THE BLOCK CANNOT RESPOND. A KPI, a chart, a
 * comparison, a table, a journey, a theme summary and the theme cloud can all
 * follow a filter; a divider, a spacer, an image and a plain paragraph cannot,
 * because there is no number in them to recompute. Saying which and why beats
 * a checkbox that silently does nothing.
 */
export function togglePanelTargetBlock(
  state: EditorState,
  panelId: string,
  blockId: string,
  connected: boolean,
): EditorState {
  const panel = findBlock(state.definition, panelId);
  if (!panel || !panel.block.filterPanel) {
    return refuse(state, "Ese panel de filtros ya no está en la experiencia.");
  }
  const candidate = findBlock(state.definition, blockId);
  if (!candidate) return refuse(state, "Ese bloque ya no está en la experiencia.");

  if (connected) {
    if (candidate.block.id === panel.block.id) {
      return refuse(state, "Un panel no se filtra a sí mismo.");
    }
    const refusal = filterTargetRefusal(candidate.block);
    if (refusal) {
      return refuse(
        state,
        `“${candidate.block.title ?? blockSpec(candidate.block.type as BlockType).label}” ${refusal}, así que un filtro no lo cambiaría.`,
      );
    }
  }

  const target = panel.block.filterPanel.target;
  const current = target.kind === "blocks" ? target.blockIds : [];
  const next = connected
    ? current.includes(blockId)
      ? current
      : [...current, blockId]
    : current.filter((id) => id !== blockId);

  if (next.length === 0) {
    return refuse(
      state,
      "Un panel necesita mover al menos un bloque. Cámbialo a “toda la página” o elige otro bloque antes de quitar este.",
    );
  }
  if (next.length > EXPERIENCE_LIMITS.blocksPerConnection) {
    return refuse(state, "Ese panel ya mueve todos los bloques que admite.");
  }
  return mapPanel(state, panelId, (config) => ({
    ...config,
    target: { kind: "blocks", blockIds: next },
  }));
}
