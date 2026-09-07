/**
 * THE COMPOSER ENGINE — pure functions over a `PresentationDocument`, and a
 * refusal that changes nothing.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THIS IS, AND WHAT IT DELIBERATELY IS NOT.
 *
 * Every operation here has the shape `(state, …args) => ComposerState`. No
 * class, no mutation, no React, no clock, no I/O, no transport, no storage. The
 * whole engine can be driven by a gate that hands it a document and compares
 * the answer to one written down in advance, and that is the point: the claims
 * this unit makes about undo, duplication and connection cleanup are only worth
 * making if a machine can check them.
 *
 * It is NOT the legacy editor's data model. The old engine was ~80 operations
 * over `ExperienceDefinitionV1`, with its own bands, band filters, sample
 * policy and category advisor. None of that is carried across. What IS carried
 * across is the shape of the thing — pure operations, a single commit choke
 * point, whole-document history, and a refusal that is a sentence rather than a
 * thrown error — because that shape was right and was expensive to arrive at.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * A REFUSAL IS NOT AN ERROR, AND IT CHANGES NOTHING.
 *
 * `refuse()` returns `{ ...state, refusal }`. The document keeps its identity —
 * the same object reference, not an equal copy — and `past`, `future`,
 * `sequence`, `openPageId` and `selectedBlockId` are untouched. That is what
 * makes "a rejected mutation leaves the document and the history unchanged" a
 * property rather than a promise: there is one function that produces a
 * refusal, and it has nowhere to put a change.
 *
 * Nothing here throws. A thrown error in an editor is a lost document, and
 * every condition an author can reach by clicking is a condition somebody
 * should be told about in a sentence.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * HISTORY IS WHOLE DOCUMENTS, AND IT IS SESSION-ONLY.
 *
 * `past` and `future` hold documents, not inverse operations. Inverse
 * operations are smaller and are wrong at exactly the moment they matter: an
 * inverse that is subtly incomplete restores a document that never existed, and
 * the author cannot tell, because it looks like theirs. A document is the
 * answer to "what did it look like" without anyone having to be clever.
 *
 * Sixty steps. Nothing is persisted, and Unit 6B.1 persists nothing at all:
 * closing the tab is the end of the session and of the history with it.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import {
  DEFAULT_DISPLAY_FORMAT,
  GRID_COLUMNS,
  duplicateBlock as clonePresentationBlock,
  duplicatePage as clonePresentationPage,
  isPresentationHandle,
  type Breakpoint,
  type ChartVariant,
  type DisplayFormat,
  type MethodologyDisclosureLevel,
  type PresentationBlock,
  type PresentationCatalog,
  type PresentationCatalogEntry,
  type PresentationDocument,
  type PresentationHandle,
  type PresentationPage,
  type ResponsiveBehavior,
  type ResultBlock,
  type SampleDisplayPolicy,
} from "../presentation";
import { mintFreeComposerId, takenComposerIds } from "./ids";
import { JOURNEY_ROUTES_VARIANTS, judgeChartVariant, offeredChartVariants } from "./renderer-capabilities";

/* -------------------------------------------------------------------------- */
/* state                                                                       */
/* -------------------------------------------------------------------------- */

/** How deep undo goes. Sixty edits is more than a sitting; more is a museum. */
export const COMPOSER_HISTORY_DEPTH = 60;


/**
 * Why an operation refused, as a closed code and a sentence for a person.
 *
 * The code is what a gate asserts and what a surface may branch on; the message
 * is what an author reads. Both are required, and the message is written in the
 * product's Spanish because it is product copy, not a log line.
 */
export type ComposerRefusalCode =
  | "page_not_found"
  | "page_title_empty"
  | "page_limit_reached"
  | "last_page"
  | "already_first"
  | "already_last"
  | "block_not_found"
  | "block_limit_reached"
  | "unknown_handle"
  | "handle_facet_mismatch"
  | "incompatible_chart_variant"
  | "chart_variant_not_implemented"
  | "invalid_span"
  | "mobile_span_fixed"
  | "invalid_display_format"
  | "sample_policy_unauthored"
  | "block_not_filterable"
  | "unsupported_filter_dimension"
  | "forbidden_filter_cross"
  | "panel_filters_itself"
  | "already_connected"
  | "not_connected"
  | "connection_limit_reached"
  | "dimension_limit_reached"
  | "nothing_to_undo"
  | "nothing_to_redo"
  | "text_too_long";

export type ComposerRefusal = { code: ComposerRefusalCode; message: string };

export type ComposerState = {
  /** The document as it stands. Session memory; nothing writes it anywhere. */
  document: PresentationDocument;
  /** Oldest first. Capped at `COMPOSER_HISTORY_DEPTH`. */
  past: PresentationDocument[];
  /** Most recently undone first. */
  future: PresentationDocument[];
  /** An id, never an index — pages get reordered. */
  openPageId: string | null;
  /** The block the inspector describes. */
  selectedBlockId: string | null;
  /** Monotonic within the session. Feeds id seeds so two adds differ. */
  sequence: number;
  /** The last refusal, or null. Cleared by the next successful commit. */
  refusal: ComposerRefusal | null;
};

/** What an operation needs to know about the study it is composing against. */
export type ComposerContext = { catalog: PresentationCatalog };

/* -------------------------------------------------------------------------- */
/* ceilings                                                                    */
/* -------------------------------------------------------------------------- */

/** The schema's own maxima, repeated so a refusal can quote the number. */
export const COMPOSER_LIMITS = Object.freeze({
  pages: 64,
  blocksPerPage: 256,
  connectionsPerBlock: 16,
  dimensionsPerPanel: 32,
  title: 160,
  description: 600,
  annotation: 600,
  editorialBody: 4000,
});

/* -------------------------------------------------------------------------- */
/* the two choke points                                                        */
/* -------------------------------------------------------------------------- */

function refuse(state: ComposerState, code: ComposerRefusalCode, message: string): ComposerState {
  // Everything except `refusal` is carried by reference on purpose: a gate
  // asserts `next.document === before.document`, which an equal-but-new object
  // would pass by value and fail by identity. Identity is the stronger claim.
  return { ...state, refusal: { code, message } };
}

/**
 * The only way a document changes.
 *
 * A commit whose document is REFERENCE-identical to the current one is a no-op
 * that still clears the refusal: an operation that legitimately decided there
 * was nothing to do should not spend an undo step, and should not leave a stale
 * sentence on screen either.
 */
function commit(
  state: ComposerState,
  document: PresentationDocument,
  extra: Partial<ComposerState> = {},
): ComposerState {
  if (document === state.document) return { ...state, ...extra, refusal: null };
  return {
    ...state,
    ...extra,
    document,
    past: [...state.past, state.document].slice(-COMPOSER_HISTORY_DEPTH),
    future: [],
    sequence: state.sequence + 1,
    refusal: null,
  };
}

/* -------------------------------------------------------------------------- */
/* order is derived, never edited                                              */
/* -------------------------------------------------------------------------- */

/**
 * Re-derive `order` from array position.
 *
 * `placement.order` is the resolver's sort key, and the array is what an author
 * manipulates. Keeping the two in step by editing `order` directly is how they
 * drift; deriving it after every structural change is how they cannot.
 */
function renumberBlocks(page: PresentationPage): PresentationPage {
  return {
    ...page,
    blocks: page.blocks.map((block, index) =>
      block.placement.order === index ? block : { ...block, placement: { ...block.placement, order: index } },
    ),
  };
}

function renumberPages(document: PresentationDocument): PresentationDocument {
  return {
    ...document,
    pages: document.pages.map((page, index) => (page.order === index ? page : { ...page, order: index })),
  };
}

/* -------------------------------------------------------------------------- */
/* lookups                                                                     */
/* -------------------------------------------------------------------------- */

export function findPage(document: PresentationDocument, pageId: string): PresentationPage | null {
  return document.pages.find((page) => page.id === pageId) ?? null;
}

export function findBlock(
  document: PresentationDocument,
  blockId: string,
): { page: PresentationPage; block: PresentationBlock } | null {
  for (const page of document.pages) {
    const block = page.blocks.find((candidate) => candidate.id === blockId);
    if (block) return { page, block };
  }
  return null;
}

export function catalogEntry(
  catalog: PresentationCatalog,
  handle: string,
): PresentationCatalogEntry | null {
  return catalog.entries.find((entry) => entry.handle === handle) ?? null;
}

/** Replace one block in place, renumbering nothing — the position has not moved. */
/**
 * Replace one block in place, and return the SAME document when nothing moved.
 *
 * `commit` skips the history step when the document comes back
 * reference-identical, which is how an operation that legitimately decided
 * there was nothing to do avoids spending an undo. An earlier version rebuilt
 * the document unconditionally, so that guard was dead for every block
 * operation: blurring a text field without typing pushed an undo step, and
 * sixty of those would have flushed a real edit out of the history.
 *
 * The update function decides. Every caller that can no-op returns the block it
 * was given, and identity does the rest.
 */
function replaceBlock(
  document: PresentationDocument,
  blockId: string,
  update: (block: PresentationBlock) => PresentationBlock,
): PresentationDocument {
  let changed = false;
  const pages = document.pages.map((page) => {
    if (!page.blocks.some((block) => block.id === blockId)) return page;
    let pageChanged = false;
    const blocks = page.blocks.map((block) => {
      if (block.id !== blockId) return block;
      const next = update(block);
      if (next !== block) pageChanged = true;
      return next;
    });
    if (!pageChanged) return page;
    changed = true;
    return { ...page, blocks };
  });
  return changed ? { ...document, pages } : document;
}

/**
 * The characters `document.ts` refuses in authored text, repeated here.
 *
 * The schema rejects them and the editor did not, so a paste carrying a
 * bidirectional override or a stray control byte produced a document that
 * looked fine on screen and could never be resolved or stored. The editor is
 * the surface where a person can be told; refusing there is the point.
 */
const CONTROL_CHARACTERS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u200e\u200f\u202a-\u202e]/;

/** Authored text the strict v4 schema will accept: bounded AND clean. */
function authoredTextIsValid(value: string, max: number): boolean {
  return value.length <= max && !CONTROL_CHARACTERS.test(value);
}

/* -------------------------------------------------------------------------- */
/* opening a session                                                           */
/* -------------------------------------------------------------------------- */

/** Start a session over a document. The first page is open; nothing is selected. */
export function openComposer(document: PresentationDocument): ComposerState {
  return {
    document,
    past: [],
    future: [],
    openPageId: document.pages[0]?.id ?? null,
    selectedBlockId: null,
    sequence: 0,
    refusal: null,
  };
}

/* -------------------------------------------------------------------------- */
/* navigation — never a document change, never a history step                  */
/* -------------------------------------------------------------------------- */

export function openPage(state: ComposerState, pageId: string): ComposerState {
  if (!findPage(state.document, pageId)) {
    return refuse(state, "page_not_found", "Esa página ya no está en la presentación.");
  }
  return { ...state, openPageId: pageId, selectedBlockId: null, refusal: null };
}

export function selectBlock(state: ComposerState, blockId: string | null): ComposerState {
  if (blockId === null) return { ...state, selectedBlockId: null, refusal: null };
  const found = findBlock(state.document, blockId);
  if (!found) return refuse(state, "block_not_found", "Ese bloque ya no está en la presentación.");
  return { ...state, openPageId: found.page.id, selectedBlockId: blockId, refusal: null };
}

/* -------------------------------------------------------------------------- */
/* history                                                                     */
/* -------------------------------------------------------------------------- */

/** A selection that the restored document does not contain becomes nothing. */
function reconcileSelection(
  document: PresentationDocument,
  openPageId: string | null,
  selectedBlockId: string | null,
): { openPageId: string | null; selectedBlockId: string | null } {
  const page = openPageId !== null && findPage(document, openPageId) ? openPageId : (document.pages[0]?.id ?? null);
  const block = selectedBlockId !== null && findBlock(document, selectedBlockId) ? selectedBlockId : null;
  return { openPageId: page, selectedBlockId: block };
}

export function undo(state: ComposerState): ComposerState {
  const previous = state.past[state.past.length - 1];
  if (previous === undefined) return refuse(state, "nothing_to_undo", "No hay nada que deshacer.");
  return {
    ...state,
    document: previous,
    past: state.past.slice(0, -1),
    future: [state.document, ...state.future].slice(0, COMPOSER_HISTORY_DEPTH),
    ...reconcileSelection(previous, state.openPageId, state.selectedBlockId),
    refusal: null,
  };
}

export function redo(state: ComposerState): ComposerState {
  const next = state.future[0];
  if (next === undefined) return refuse(state, "nothing_to_redo", "No hay nada que rehacer.");
  return {
    ...state,
    document: next,
    past: [...state.past, state.document].slice(-COMPOSER_HISTORY_DEPTH),
    future: state.future.slice(1),
    ...reconcileSelection(next, state.openPageId, state.selectedBlockId),
    refusal: null,
  };
}

/* -------------------------------------------------------------------------- */
/* pages                                                                       */
/* -------------------------------------------------------------------------- */

export function addPage(state: ComposerState, title: string): ComposerState {
  const trimmed = title.trim();
  if (trimmed.length === 0) return refuse(state, "page_title_empty", "Una página necesita un nombre.");
  if (!authoredTextIsValid(trimmed, COMPOSER_LIMITS.title)) {
    return refuse(
      state,
      "text_too_long",
      `Un nombre de página admite ${COMPOSER_LIMITS.title} caracteres y ningún carácter de control.`,
    );
  }
  if (state.document.pages.length >= COMPOSER_LIMITS.pages) {
    return refuse(state, "page_limit_reached", `Una presentación admite ${COMPOSER_LIMITS.pages} páginas.`);
  }
  const id = mintFreeComposerId(
    "page",
    `${state.document.id}/page/added/${state.sequence}`,
    takenComposerIds(state.document),
  );
  const page: PresentationPage = { id, title: trimmed, order: state.document.pages.length, blocks: [] };
  return commit(state, { ...state.document, pages: [...state.document.pages, page] }, {
    openPageId: id,
    selectedBlockId: null,
  });
}

export function renamePage(state: ComposerState, pageId: string, title: string): ComposerState {
  if (!findPage(state.document, pageId)) {
    return refuse(state, "page_not_found", "Esa página ya no está en la presentación.");
  }
  const trimmed = title.trim();
  if (trimmed.length === 0) return refuse(state, "page_title_empty", "Una página necesita un nombre.");
  if (!authoredTextIsValid(trimmed, COMPOSER_LIMITS.title)) {
    return refuse(
      state,
      "text_too_long",
      `Un nombre de página admite ${COMPOSER_LIMITS.title} caracteres y ningún carácter de control.`,
    );
  }
  if (findPage(state.document, pageId)?.title === trimmed) return { ...state, refusal: null };
  return commit(state, {
    ...state.document,
    pages: state.document.pages.map((page) => (page.id === pageId ? { ...page, title: trimmed } : page)),
  });
}

/**
 * Move a page one place. `index` semantics are the ARRAY-AFTER-REMOVAL kind —
 * see `moveBlockToIndex` for why that is the only interpretation that makes a
 * drag behave the same going up as going down.
 */
export function movePage(state: ComposerState, pageId: string, direction: -1 | 1): ComposerState {
  const from = state.document.pages.findIndex((page) => page.id === pageId);
  if (from < 0) return refuse(state, "page_not_found", "Esa página ya no está en la presentación.");
  const to = from + direction;
  if (to < 0) return refuse(state, "already_first", "Ya es la primera página.");
  if (to >= state.document.pages.length) return refuse(state, "already_last", "Ya es la última página.");
  const pages = [...state.document.pages];
  const [moved] = pages.splice(from, 1);
  pages.splice(to, 0, moved);
  return commit(state, renumberPages({ ...state.document, pages }));
}

export function movePageToIndex(state: ComposerState, pageId: string, index: number): ComposerState {
  const from = state.document.pages.findIndex((page) => page.id === pageId);
  if (from < 0) return refuse(state, "page_not_found", "Esa página ya no está en la presentación.");
  const pages = [...state.document.pages];
  const [moved] = pages.splice(from, 1);
  const target = index < 0 ? 0 : index > pages.length ? pages.length : index;
  pages.splice(target, 0, moved);
  return commit(state, renumberPages({ ...state.document, pages }));
}

/**
 * Copy a page under fresh ids.
 *
 * `duplicatePage` in `document.ts` already owns the hard half: it remaps every
 * connection whose BOTH ends were copied and drops the rest, so a copied block
 * never keeps a connection to the original page's panel. This function's job is
 * only to supply ids that are free — including free of each other, which is why
 * the taken-set predicate adds as it answers.
 */
export function duplicatePage(state: ComposerState, pageId: string): ComposerState {
  const source = findPage(state.document, pageId);
  if (!source) return refuse(state, "page_not_found", "Esa página ya no está en la presentación.");
  if (state.document.pages.length >= COMPOSER_LIMITS.pages) {
    return refuse(state, "page_limit_reached", `Una presentación admite ${COMPOSER_LIMITS.pages} páginas.`);
  }

  const taken = takenComposerIds(state.document);
  const claim = (id: string) => {
    if (taken.has(id)) return true;
    taken.add(id);
    return false;
  };
  const newPageId = mintFreeComposerId("page", `${pageId}/pagecopy/${state.sequence}`, claim);
  const copy = clonePresentationPage(source, newPageId, (originalId, index) =>
    mintFreeComposerId("block", `${originalId}/pagecopy/${state.sequence}/${index}`, claim),
  );

  const at = state.document.pages.findIndex((page) => page.id === pageId);
  const pages = [...state.document.pages];
  pages.splice(at + 1, 0, { ...copy, title: suffixCopy(copy.title, COMPOSER_LIMITS.title) });
  return commit(state, renumberPages({ ...state.document, pages }), {
    openPageId: newPageId,
    selectedBlockId: null,
  });
}

export function removePage(state: ComposerState, pageId: string): ComposerState {
  const page = findPage(state.document, pageId);
  if (!page) return refuse(state, "page_not_found", "Esa página ya no está en la presentación.");
  if (state.document.pages.length <= 1) {
    return refuse(state, "last_page", "Una presentación necesita al menos una página.");
  }
  const removedIds = new Set(page.blocks.map((block) => block.id));
  const pages = state.document.pages.filter((candidate) => candidate.id !== pageId);
  const document = renumberPages(forgetBlocks({ ...state.document, pages }, removedIds));
  const stillOpen = state.openPageId !== null && state.openPageId !== pageId;
  return commit(state, document, {
    openPageId: stillOpen ? state.openPageId : (document.pages[0]?.id ?? null),
    selectedBlockId:
      state.selectedBlockId !== null && removedIds.has(state.selectedBlockId) ? null : state.selectedBlockId,
  });
}

function suffixCopy(title: string, max: number): string {
  const suffix = " (copia)";
  const room = max - suffix.length;
  return `${title.length > room ? title.slice(0, room) : title}${suffix}`;
}

/* -------------------------------------------------------------------------- */
/* the dangling-reference invariant                                            */
/* -------------------------------------------------------------------------- */

/**
 * Remove every trace of a set of blocks from every connection list.
 *
 * A filter connection names a PANEL BLOCK by id. Deleting the panel therefore
 * has to reach into every block that named it, or the document keeps a
 * connection to a control that no longer exists — which resolves, silently,
 * into a block that says it is moved by something that cannot move it.
 *
 * Both directions are handled by the same pass because both are the same
 * mistake: the removed block might have BEEN a panel (strip its id from
 * everyone's list) or might have HELD connections (they leave with it).
 */
function forgetBlocks(document: PresentationDocument, removed: Set<string>): PresentationDocument {
  return {
    ...document,
    pages: document.pages.map((page) => ({
      ...page,
      blocks: page.blocks
        .filter((block) => !removed.has(block.id))
        .map((block) =>
          block.connectedFilterPanelIds.some((id) => removed.has(id))
            ? {
                ...block,
                connectedFilterPanelIds: block.connectedFilterPanelIds.filter((id) => !removed.has(id)),
              }
            : block,
        ),
    })),
  };
}

/* -------------------------------------------------------------------------- */
/* blocks — adding                                                             */
/* -------------------------------------------------------------------------- */

/** The default placement a new block lands on: half width, reflowing, full on phone. */
function defaultPlacement(order: number, desktop: number) {
  return {
    order,
    span: { desktop, tablet: desktop > 6 ? GRID_COLUMNS : 6, mobile: GRID_COLUMNS },
    responsive: "reflow" as ResponsiveBehavior,
  };
}

const EMPTY_COPY = { title: null, description: null, annotation: null };

/** What an author may ask for when adding. Never a canonical key — a handle. */
export type AddBlockRequest =
  | { kind: "result"; binding: string; chartVariant?: string }
  | { kind: "filter_panel" }
  | { kind: "editorial"; slot?: string | null }
  | { kind: "journey_routes"; binding: string; chartVariant?: string };

export function addBlock(
  state: ComposerState,
  context: ComposerContext,
  pageId: string,
  request: AddBlockRequest,
): ComposerState {
  const page = findPage(state.document, pageId);
  if (!page) return refuse(state, "page_not_found", "Esa página ya no está en la presentación.");
  if (page.blocks.length >= COMPOSER_LIMITS.blocksPerPage) {
    return refuse(state, "block_limit_reached", `Una página admite ${COMPOSER_LIMITS.blocksPerPage} bloques.`);
  }

  const id = mintFreeComposerId(
    "block",
    `${pageId}/block/added/${state.sequence}`,
    takenComposerIds(state.document),
  );
  const order = page.blocks.length;

  let block: PresentationBlock;
  if (request.kind === "result" || request.kind === "journey_routes") {
    const entry = catalogEntry(context.catalog, request.binding);
    if (!entry) {
      return refuse(state, "unknown_handle", "Ese resultado no está en el catálogo de este estudio.");
    }
    // A JOURNEY_ROUTES BLOCK IS NOT A RESULT BLOCK BOUND TO A GROUP.
    //
    // Its payload is `routes` — the touchpoints a person decided each route
    // draws — and the route map draws exactly that. A RESULT block bound to the
    // same group resolves to `journey_group`, a label and a count, which the
    // route map cannot draw at all. Judging the first against the second's
    // capability list refuses the only block that works.
    const offered = request.kind === "journey_routes" ? JOURNEY_ROUTES_VARIANTS : offeredChartVariants(entry.semantic);
    const variant = request.chartVariant ?? offered[0];
    if (variant === undefined) {
      return refuse(
        state,
        "chart_variant_not_implemented",
        `«${entry.label}» todavía no tiene ninguna forma de dibujarse en esta versión.`,
      );
    }
    const verdict =
      request.kind === "journey_routes"
        ? JOURNEY_ROUTES_VARIANTS.includes(variant as ChartVariant)
          ? null
          : ({ reason: "not_implemented" } as const)
        : judgeChartVariant(entry.semantic, variant);
    if (verdict) return refuseVariant(state, entry.label, variant, verdict.reason);

    block =
      request.kind === "result"
        ? {
            kind: "result",
            id,
            copy: { ...EMPTY_COPY, title: entry.label.slice(0, COMPOSER_LIMITS.title) },
            placement: defaultPlacement(order, 6),
            visible: true,
            connectedFilterPanelIds: [],
            samplePolicy: null,
            methodologyDisclosure: null,
            displayFormat: DEFAULT_DISPLAY_FORMAT,
            binding: entry.handle,
            chartVariant: variant,
          }
        : {
            kind: "journey_routes",
            id,
            copy: { ...EMPTY_COPY, title: entry.label.slice(0, COMPOSER_LIMITS.title) },
            placement: defaultPlacement(order, GRID_COLUMNS),
            visible: true,
            connectedFilterPanelIds: [],
            samplePolicy: null,
            methodologyDisclosure: null,
            displayFormat: DEFAULT_DISPLAY_FORMAT,
            chartVariant: variant,
            routes: [],
          };
  } else if (request.kind === "filter_panel") {
    block = {
      kind: "filter_panel",
      id,
      copy: { ...EMPTY_COPY, title: "Filtros" },
      placement: defaultPlacement(order, GRID_COLUMNS),
      visible: true,
      connectedFilterPanelIds: [],
      samplePolicy: null,
      methodologyDisclosure: null,
      displayFormat: DEFAULT_DISPLAY_FORMAT,
      dimensions: [],
    };
  } else {
    let slot: PresentationHandle | null = null;
    if (request.slot !== undefined && request.slot !== null) {
      const entry = catalogEntry(context.catalog, request.slot);
      if (!entry) return refuse(state, "unknown_handle", "Ese espacio editorial no está en el catálogo.");
      if (entry.semantic !== "editorial_slot") {
        return refuse(state, "handle_facet_mismatch", "Ese identificador no nombra un espacio editorial.");
      }
      slot = entry.handle;
    }
    block = {
      kind: "editorial",
      id,
      copy: { ...EMPTY_COPY },
      placement: defaultPlacement(order, GRID_COLUMNS),
      visible: true,
      connectedFilterPanelIds: [],
      samplePolicy: null,
      methodologyDisclosure: null,
      displayFormat: DEFAULT_DISPLAY_FORMAT,
      slot,
      content: null,
    };
  }

  const document = {
    ...state.document,
    pages: state.document.pages.map((candidate) =>
      candidate.id === pageId ? { ...candidate, blocks: [...candidate.blocks, block] } : candidate,
    ),
  };
  return commit(state, document, { openPageId: pageId, selectedBlockId: id });
}

function refuseVariant(
  state: ComposerState,
  label: string,
  variant: string,
  reason: "incompatible_with_semantic" | "not_implemented",
): ComposerState {
  return reason === "incompatible_with_semantic"
    ? refuse(
        state,
        "incompatible_chart_variant",
        `«${label}» no puede dibujarse así: esa forma diría algo que la medición no dice.`,
      )
    : refuse(
        state,
        "chart_variant_not_implemented",
        `«${variant}» es una forma honesta para «${label}», pero esta versión todavía no la dibuja.`,
      );
}

/* -------------------------------------------------------------------------- */
/* blocks — moving, duplicating, removing                                      */
/* -------------------------------------------------------------------------- */

export function moveBlock(state: ComposerState, blockId: string, direction: -1 | 1): ComposerState {
  const found = findBlock(state.document, blockId);
  if (!found) return refuse(state, "block_not_found", "Ese bloque ya no está en la presentación.");
  const from = found.page.blocks.findIndex((block) => block.id === blockId);
  const to = from + direction;
  if (to < 0) return refuse(state, "already_first", "Ya es el primer bloque de la página.");
  if (to >= found.page.blocks.length) return refuse(state, "already_last", "Ya es el último bloque de la página.");
  return commit(state, reorderWithin(state.document, found.page.id, from, to));
}

/**
 * Turn a DROP LINE into the index `moveBlockToIndex` expects.
 *
 * A drop line sits BETWEEN two blocks, so it is a position in the array as the
 * author currently sees it. `moveBlockToIndex` wants a position in the array
 * AFTER the block has been taken out, which differs by one whenever the block
 * came from above the line. Both indices are PAGE-LOCAL.
 *
 * The compensation used to live in the drop handler and compared a page-local
 * drop line against a source index found in a flattened list of every page's
 * blocks. On the first page the two agree, which is why it looked right; on any
 * later page the source index was offset by every preceding page's block count,
 * the comparison went the wrong way, and the block landed one slot past where
 * the line promised. It is a function now so a gate can drive it.
 */
export function dropIndexFor(
  document: PresentationDocument,
  blockId: string,
  dropLine: number,
): number {
  const found = findBlock(document, blockId);
  if (!found) return dropLine;
  const from = found.page.blocks.findIndex((block) => block.id === blockId);
  return from >= 0 && from < dropLine ? dropLine - 1 : dropLine;
}

/**
 * Drop a block at a position.
 *
 * `index` is a position in the array AFTER the block has been taken out of it.
 * That is the only reading under which "put it where the line is" behaves the
 * same dragging up as dragging down; a caller holding a raw insertion point
 * subtracts one when the source sits above it.
 */
export function moveBlockToIndex(state: ComposerState, blockId: string, index: number): ComposerState {
  const found = findBlock(state.document, blockId);
  if (!found) return refuse(state, "block_not_found", "Ese bloque ya no está en la presentación.");
  const from = found.page.blocks.findIndex((block) => block.id === blockId);
  const last = found.page.blocks.length - 1;
  const to = index < 0 ? 0 : index > last ? last : index;
  return commit(state, reorderWithin(state.document, found.page.id, from, to));
}

function reorderWithin(
  document: PresentationDocument,
  pageId: string,
  from: number,
  to: number,
): PresentationDocument {
  if (from === to) return document;
  return {
    ...document,
    pages: document.pages.map((page) => {
      if (page.id !== pageId) return page;
      const blocks = [...page.blocks];
      const [moved] = blocks.splice(from, 1);
      blocks.splice(to, 0, moved);
      return renumberBlocks({ ...page, blocks });
    }),
  };
}

/**
 * Copy a block, immediately after its source.
 *
 * `duplicateBlock` in `document.ts` deep-copies and clears
 * `connectedFilterPanelIds`, which is the decision that matters: a filter moves
 * a block because somebody said so, and a copy that inherited that would double
 * what the filter moves without anyone having asked for it.
 */
export function duplicateBlock(state: ComposerState, blockId: string): ComposerState {
  const found = findBlock(state.document, blockId);
  if (!found) return refuse(state, "block_not_found", "Ese bloque ya no está en la presentación.");
  if (found.page.blocks.length >= COMPOSER_LIMITS.blocksPerPage) {
    return refuse(state, "block_limit_reached", `Una página admite ${COMPOSER_LIMITS.blocksPerPage} bloques.`);
  }
  const newId = mintFreeComposerId(
    "block",
    `${blockId}/copy/${state.sequence}`,
    takenComposerIds(state.document),
  );
  const copy = clonePresentationBlock(found.block, newId);
  const titled: PresentationBlock =
    copy.copy.title === null
      ? copy
      : { ...copy, copy: { ...copy.copy, title: suffixCopy(copy.copy.title, COMPOSER_LIMITS.title) } };

  const at = found.page.blocks.findIndex((block) => block.id === blockId);
  const document = {
    ...state.document,
    pages: state.document.pages.map((page) => {
      if (page.id !== found.page.id) return page;
      const blocks = [...page.blocks];
      blocks.splice(at + 1, 0, titled);
      return renumberBlocks({ ...page, blocks });
    }),
  };
  return commit(state, document, { selectedBlockId: newId });
}

export function removeBlock(state: ComposerState, blockId: string): ComposerState {
  const found = findBlock(state.document, blockId);
  if (!found) return refuse(state, "block_not_found", "Ese bloque ya no está en la presentación.");
  const document = forgetBlocks(state.document, new Set([blockId]));
  const renumbered = {
    ...document,
    pages: document.pages.map((page) => (page.id === found.page.id ? renumberBlocks(page) : page)),
  };
  return commit(state, renumbered, {
    selectedBlockId: state.selectedBlockId === blockId ? null : state.selectedBlockId,
  });
}

export function setBlockVisibility(state: ComposerState, blockId: string, visible: boolean): ComposerState {
  if (!findBlock(state.document, blockId)) {
    return refuse(state, "block_not_found", "Ese bloque ya no está en la presentación.");
  }
  return commit(
    state,
    replaceBlock(state.document, blockId, (block) => (block.visible === visible ? block : { ...block, visible })),
  );
}

/* -------------------------------------------------------------------------- */
/* blocks — authored copy                                                      */
/* -------------------------------------------------------------------------- */

export type CopyField = "title" | "description" | "annotation";

const COPY_LIMIT: Record<CopyField, number> = {
  title: COMPOSER_LIMITS.title,
  description: COMPOSER_LIMITS.description,
  annotation: COMPOSER_LIMITS.annotation,
};

export function setBlockCopy(
  state: ComposerState,
  blockId: string,
  field: CopyField,
  value: string | null,
): ComposerState {
  if (!findBlock(state.document, blockId)) {
    return refuse(state, "block_not_found", "Ese bloque ya no está en la presentación.");
  }
  if (value !== null && !authoredTextIsValid(value, COPY_LIMIT[field])) {
    return refuse(
      state,
      "text_too_long",
      `Ese texto admite ${COPY_LIMIT[field]} caracteres y ningún carácter de control.`,
    );
  }
  return commit(
    state,
    replaceBlock(state.document, blockId, (block) =>
      block.copy[field] === value ? block : { ...block, copy: { ...block.copy, [field]: value } },
    ),
  );
}

export function setEditorialBody(state: ComposerState, blockId: string, body: string | null): ComposerState {
  const found = findBlock(state.document, blockId);
  if (!found) return refuse(state, "block_not_found", "Ese bloque ya no está en la presentación.");
  if (found.block.kind !== "editorial") {
    return refuse(state, "block_not_found", "Ese bloque no es un texto editorial.");
  }
  if (body !== null && !authoredTextIsValid(body, COMPOSER_LIMITS.editorialBody)) {
    return refuse(
      state,
      "text_too_long",
      `Un texto editorial admite ${COMPOSER_LIMITS.editorialBody} caracteres y ningún carácter de control.`,
    );
  }
  return commit(
    state,
    replaceBlock(state.document, blockId, (block) => {
      if (block.kind !== "editorial") return block;
      if ((block.content?.body ?? null) === body) return block;
      return { ...block, content: body === null ? null : { body } };
    }),
  );
}

/* -------------------------------------------------------------------------- */
/* blocks — binding and variant                                                */
/* -------------------------------------------------------------------------- */

export function setBlockBinding(
  state: ComposerState,
  context: ComposerContext,
  blockId: string,
  handle: string,
): ComposerState {
  const found = findBlock(state.document, blockId);
  if (!found) return refuse(state, "block_not_found", "Ese bloque ya no está en la presentación.");
  if (found.block.kind !== "result") {
    return refuse(state, "block_not_found", "Sólo un bloque de resultado se enlaza a una medición.");
  }
  if (!isPresentationHandle(handle)) {
    return refuse(state, "unknown_handle", "Ese identificador no tiene la forma de un enlace de presentación.");
  }
  const entry = catalogEntry(context.catalog, handle);
  if (!entry) return refuse(state, "unknown_handle", "Ese resultado no está en el catálogo de este estudio.");

  // The variant travels with the binding. A block bound to a distribution and
  // drawn as a stacked bar, re-bound to a single value, would keep a drawing
  // that the new quantity cannot honestly wear — so the current variant is
  // re-judged and the authority's first OFFERED choice takes over when it fails.
  const offered = offeredChartVariants(entry.semantic);
  const keep = judgeChartVariant(entry.semantic, found.block.chartVariant) === null;
  const variant = keep ? found.block.chartVariant : offered[0];
  if (variant === undefined) {
    return refuse(
      state,
      "chart_variant_not_implemented",
      `«${entry.label}» todavía no tiene ninguna forma de dibujarse en esta versión.`,
    );
  }
  return commit(
    state,
    replaceBlock(state.document, blockId, (block) =>
      block.kind === "result" && (block.binding !== entry.handle || block.chartVariant !== variant)
        ? { ...block, binding: entry.handle, chartVariant: variant }
        : block,
    ),
  );
}

export function setChartVariant(
  state: ComposerState,
  context: ComposerContext,
  blockId: string,
  variant: string,
): ComposerState {
  const found = findBlock(state.document, blockId);
  if (!found) return refuse(state, "block_not_found", "Ese bloque ya no está en la presentación.");
  if (found.block.kind !== "result" && found.block.kind !== "journey_routes") {
    return refuse(state, "incompatible_chart_variant", "Ese bloque no se dibuja como una gráfica.");
  }
  if (found.block.kind === "journey_routes") {
    if (!JOURNEY_ROUTES_VARIANTS.includes(variant as ChartVariant)) {
      return refuseVariant(state, "el recorrido", variant, "not_implemented");
    }
    return commit(
      state,
      replaceBlock(state.document, blockId, (block) =>
        block.kind === "journey_routes" && block.chartVariant !== variant ? { ...block, chartVariant: variant } : block,
      ),
    );
  }
  const entry = catalogEntry(context.catalog, found.block.binding);
  if (!entry) {
    return refuse(state, "unknown_handle", "Ese resultado no está en el catálogo de este estudio.");
  }
  const verdict = judgeChartVariant(entry.semantic, variant);
  if (verdict) return refuseVariant(state, entry.label, variant, verdict.reason);
  return commit(
    state,
    replaceBlock(state.document, blockId, (block) =>
      (block.kind === "result" || block.kind === "journey_routes") && block.chartVariant !== variant
        ? { ...block, chartVariant: variant }
        : block,
    ),
  );
}

/* -------------------------------------------------------------------------- */
/* blocks — layout                                                             */
/* -------------------------------------------------------------------------- */

export function setBlockSpan(
  state: ComposerState,
  blockId: string,
  breakpoint: Breakpoint,
  span: number,
): ComposerState {
  if (!findBlock(state.document, blockId)) {
    return refuse(state, "block_not_found", "Ese bloque ya no está en la presentación.");
  }
  // Phone is not a width an author chooses. Every approved block is full width
  // there, and a narrower one would put two columns inside 360px — the geometry
  // the acceptance matrix already measured a KPI clipping its own number in.
  if (breakpoint === "mobile" && span !== GRID_COLUMNS) {
    return refuse(
      state,
      "mobile_span_fixed",
      "En teléfono cada bloque ocupa el ancho completo; eso no se ajusta.",
    );
  }
  if (!Number.isInteger(span) || span < 1 || span > GRID_COLUMNS) {
    return refuse(state, "invalid_span", `Un bloque ocupa entre 1 y ${GRID_COLUMNS} columnas.`);
  }
  return commit(
    state,
    replaceBlock(state.document, blockId, (block) =>
      block.placement.span[breakpoint] === span
        ? block
        : { ...block, placement: { ...block.placement, span: { ...block.placement.span, [breakpoint]: span } } },
    ),
  );
}

export function setBlockResponsive(
  state: ComposerState,
  blockId: string,
  responsive: ResponsiveBehavior,
): ComposerState {
  if (!findBlock(state.document, blockId)) {
    return refuse(state, "block_not_found", "Ese bloque ya no está en la presentación.");
  }
  return commit(
    state,
    replaceBlock(state.document, blockId, (block) =>
      block.placement.responsive === responsive
        ? block
        : { ...block, placement: { ...block.placement, responsive } },
    ),
  );
}

export function setBlockDisplayFormat(
  state: ComposerState,
  blockId: string,
  format: DisplayFormat,
): ComposerState {
  if (!findBlock(state.document, blockId)) {
    return refuse(state, "block_not_found", "Ese bloque ya no está en la presentación.");
  }
  if (format.kind === "fixed_decimals") {
    if (!Number.isInteger(format.decimals) || format.decimals < 0 || format.decimals > 2) {
      return refuse(state, "invalid_display_format", "Un formato fijo admite entre 0 y 2 decimales.");
    }
  }
  return commit(
    state,
    replaceBlock(state.document, blockId, (block) => {
      const current = block.displayFormat;
      if (current.kind === format.kind && (current.kind !== "fixed_decimals" || current.decimals === (format as { decimals: number }).decimals)) {
        return block;
      }
      return { ...block, displayFormat: format };
    }),
  );
}

/* -------------------------------------------------------------------------- */
/* sample policy and disclosure                                                */
/* -------------------------------------------------------------------------- */

/**
 * A suppressing policy needs an author and a reason, and the engine will not
 * supply either.
 *
 * `show_all` is the default and the only mode that needs no argument. The other
 * two record who decided and why — not as ceremony, but because "a person
 * decided to hide this" is a different fact from "the software hid it", and the
 * second is the one this product must never be able to produce. Nothing here
 * defaults, inherits or stamps a threshold.
 */
function policyIsAuthored(policy: SampleDisplayPolicy): boolean {
  if (policy.mode === "show_all") return true;
  if (policy.authoredBy.trim().length === 0 || policy.rationale.trim().length === 0) return false;
  // The schema bounds these strings and refuses control characters in them just
  // as it does for any authored text. Accepting one here would build a document
  // that can never be resolved, and the author would find out at the preview.
  if (!authoredTextIsValid(policy.authoredBy, 120)) return false;
  if (!authoredTextIsValid(policy.rationale, 400)) return false;
  if (policy.mode === "annotate_below" && !authoredTextIsValid(policy.note, 200)) return false;
  if (policy.mode === "hide_below" && policy.publicNote !== null && !authoredTextIsValid(policy.publicNote, 200)) {
    return false;
  }
  return Number.isInteger(policy.threshold) && policy.threshold >= 0;
}

export function setDocumentSamplePolicy(state: ComposerState, policy: SampleDisplayPolicy): ComposerState {
  if (!policyIsAuthored(policy)) {
    return refuse(
      state,
      "sample_policy_unauthored",
      "Ocultar o anotar por base pequeña necesita quién lo decide y por qué.",
    );
  }
  return commit(state, { ...state.document, samplePolicy: policy });
}

export function setBlockSamplePolicy(
  state: ComposerState,
  blockId: string,
  policy: SampleDisplayPolicy | null,
): ComposerState {
  if (!findBlock(state.document, blockId)) {
    return refuse(state, "block_not_found", "Ese bloque ya no está en la presentación.");
  }
  if (policy !== null && !policyIsAuthored(policy)) {
    return refuse(
      state,
      "sample_policy_unauthored",
      "Ocultar o anotar por base pequeña necesita quién lo decide y por qué.",
    );
  }
  return commit(
    state,
    replaceBlock(state.document, blockId, (block) =>
      block.samplePolicy === null && policy === null ? block : { ...block, samplePolicy: policy },
    ),
  );
}

export function setDocumentDisclosure(
  state: ComposerState,
  level: MethodologyDisclosureLevel,
): ComposerState {
  if (state.document.methodologyDisclosure === level) return { ...state, refusal: null };
  return commit(state, { ...state.document, methodologyDisclosure: level });
}

export function setBlockDisclosure(
  state: ComposerState,
  blockId: string,
  level: MethodologyDisclosureLevel | null,
): ComposerState {
  if (!findBlock(state.document, blockId)) {
    return refuse(state, "block_not_found", "Ese bloque ya no está en la presentación.");
  }
  return commit(
    state,
    replaceBlock(state.document, blockId, (block) =>
      block.methodologyDisclosure === level ? block : { ...block, methodologyDisclosure: level },
    ),
  );
}

/* -------------------------------------------------------------------------- */
/* filter panels and explicit connections                                      */
/* -------------------------------------------------------------------------- */

/**
 * Which blocks a panel may be connected to.
 *
 * Only a `result` block recomputes under a filter. An editorial paragraph, a
 * filter panel and a journey route map do not, and offering them would produce
 * a control that appears to do something and does nothing — which is the exact
 * failure this whole connection model exists to prevent.
 */
export function blockIsFilterable(block: PresentationBlock): block is ResultBlock {
  return block.kind === "result";
}

export function togglePanelDimension(
  state: ComposerState,
  context: ComposerContext,
  panelId: string,
  handle: string,
  offered: boolean,
): ComposerState {
  const found = findBlock(state.document, panelId);
  if (!found) return refuse(state, "block_not_found", "Ese panel ya no está en la presentación.");
  if (found.block.kind !== "filter_panel") {
    return refuse(state, "block_not_found", "Ese bloque no es un panel de filtros.");
  }
  const entry = catalogEntry(context.catalog, handle);
  if (!entry) return refuse(state, "unknown_handle", "Esa característica no está en el catálogo de este estudio.");
  if (entry.semantic !== "filter_dimension") {
    return refuse(state, "handle_facet_mismatch", "Eso no es una característica por la que se pueda filtrar.");
  }
  const current = found.block.dimensions;
  const has = current.includes(entry.handle);
  if (offered === has) return { ...state, refusal: null };
  if (offered && current.length >= COMPOSER_LIMITS.dimensionsPerPanel) {
    return refuse(
      state,
      "dimension_limit_reached",
      `Un panel admite ${COMPOSER_LIMITS.dimensionsPerPanel} características.`,
    );
  }
  // OFFERING A DIMENSION IS ALSO A DECISION ABOUT EVERY BLOCK ALREADY CONNECTED.
  //
  // `connectBlockToPanel` refuses a forbidden cross and an unsupported
  // dimension at the moment somebody connects. Adding a dimension AFTERWARDS
  // reached the same forbidden state from the other direction and nothing
  // looked: the document then carried a cross an authority forbids, and the
  // author found out at the preview, phrased as a resolver failure rather than
  // as the decision they had just made.
  if (offered) {
    for (const page of state.document.pages) {
      for (const candidate of page.blocks) {
        if (!candidate.connectedFilterPanelIds.includes(panelId)) continue;
        if (!blockIsFilterable(candidate)) continue;
        const bound = catalogEntry(context.catalog, candidate.binding);
        if (!bound) continue;
        if (bound.forbiddenFilters.includes(entry.handle)) {
          return refuse(
            state,
            "forbidden_filter_cross",
            `Este panel ya mueve «${bound.label}», y una autoridad del estudio prohíbe cruzar esa medición con «${entry.label}».`,
          );
        }
        if (!bound.supportedFilters.includes(entry.handle)) {
          return refuse(
            state,
            "unsupported_filter_dimension",
            `Este panel ya mueve «${bound.label}», que no se puede desglosar por «${entry.label}».`,
          );
        }
      }
    }
  }
  const dimensions = offered
    ? [...current, entry.handle]
    : current.filter((candidate) => candidate !== entry.handle);
  return commit(
    state,
    replaceBlock(state.document, panelId, (block) =>
      block.kind === "filter_panel" ? { ...block, dimensions } : block,
    ),
  );
}

/**
 * Connect a block to a panel — the ONE act that makes a filter move a block.
 *
 * Sharing a dimension is not a connection and never becomes one. Two blocks
 * that both accept `dimension:esfera` are still two independent blocks; a panel
 * moves one of them because an author connected that one. The refusals below
 * are the whole argument: every way this could quietly become "same key, same
 * behaviour" is a named refusal instead.
 */
export function connectBlockToPanel(
  state: ComposerState,
  context: ComposerContext,
  blockId: string,
  panelId: string,
): ComposerState {
  const target = findBlock(state.document, blockId);
  if (!target) return refuse(state, "block_not_found", "Ese bloque ya no está en la presentación.");
  const panel = findBlock(state.document, panelId);
  if (!panel) return refuse(state, "block_not_found", "Ese panel ya no está en la presentación.");
  if (panel.block.kind !== "filter_panel") {
    return refuse(state, "block_not_found", "Ese bloque no es un panel de filtros.");
  }
  if (blockId === panelId) {
    return refuse(state, "panel_filters_itself", "Un panel no se filtra a sí mismo.");
  }
  if (!blockIsFilterable(target.block)) {
    return refuse(
      state,
      "block_not_filterable",
      `«${target.block.copy.title ?? "Ese bloque"}» es contenido fijo: no muestra ningún número que un filtro pueda cambiar.`,
    );
  }
  if (target.block.connectedFilterPanelIds.includes(panelId)) {
    return refuse(state, "already_connected", "Ese panel ya mueve este bloque.");
  }
  if (target.block.connectedFilterPanelIds.length >= COMPOSER_LIMITS.connectionsPerBlock) {
    return refuse(
      state,
      "connection_limit_reached",
      `Un bloque admite ${COMPOSER_LIMITS.connectionsPerBlock} paneles.`,
    );
  }

  const entry = catalogEntry(context.catalog, target.block.binding);
  if (!entry) return refuse(state, "unknown_handle", "Ese resultado no está en el catálogo de este estudio.");

  // Two different refusals, and they must stay different. A forbidden cross is
  // an AUTHORITY saying this pairing would mislead; an unsupported dimension is
  // a capability the result simply does not have. Merging them would tell an
  // author to go and ask for the wrong thing.
  for (const dimension of panel.block.dimensions) {
    if (entry.forbiddenFilters.includes(dimension)) {
      return refuse(
        state,
        "forbidden_filter_cross",
        `Ese panel ofrece una característica que no puede cruzarse con «${entry.label}».`,
      );
    }
  }
  for (const dimension of panel.block.dimensions) {
    if (!entry.supportedFilters.includes(dimension)) {
      return refuse(
        state,
        "unsupported_filter_dimension",
        `«${entry.label}» no se puede desglosar por una de las características de ese panel.`,
      );
    }
  }

  return commit(
    state,
    replaceBlock(state.document, blockId, (block) => ({
      ...block,
      connectedFilterPanelIds: [...block.connectedFilterPanelIds, panelId],
    })),
  );
}

export function disconnectBlockFromPanel(
  state: ComposerState,
  blockId: string,
  panelId: string,
): ComposerState {
  const target = findBlock(state.document, blockId);
  if (!target) return refuse(state, "block_not_found", "Ese bloque ya no está en la presentación.");
  if (!target.block.connectedFilterPanelIds.includes(panelId)) {
    return refuse(state, "not_connected", "Ese panel no mueve este bloque.");
  }
  return commit(
    state,
    replaceBlock(state.document, blockId, (block) => ({
      ...block,
      connectedFilterPanelIds: block.connectedFilterPanelIds.filter((id) => id !== panelId),
    })),
  );
}

/* -------------------------------------------------------------------------- */
/* what a surface may ask the engine                                           */
/* -------------------------------------------------------------------------- */

/** The panels that move this block, resolved to real blocks. */
export function panelsMoving(
  document: PresentationDocument,
  block: PresentationBlock,
): PresentationBlock[] {
  return block.connectedFilterPanelIds
    .map((id) => findBlock(document, id)?.block)
    .filter((candidate): candidate is PresentationBlock => candidate !== undefined);
}

/**
 * Every candidate a panel could be connected to, split by whether it can be.
 *
 * The split is the point. A person who wonders "why can I not tick the
 * interpretation" gets the answer next to the thing they could not tick,
 * rather than an absence to interpret.
 */
export function connectionCandidates(
  document: PresentationDocument,
  context: ComposerContext,
  panelId: string,
): {
  eligible: { block: PresentationBlock; pageId: string; connected: boolean }[];
  ineligible: { block: PresentationBlock; pageId: string; reason: ComposerRefusalCode }[];
} {
  const panel = findBlock(document, panelId);
  const eligible: { block: PresentationBlock; pageId: string; connected: boolean }[] = [];
  const ineligible: { block: PresentationBlock; pageId: string; reason: ComposerRefusalCode }[] = [];
  if (!panel || panel.block.kind !== "filter_panel") return { eligible, ineligible };
  const dimensions = panel.block.dimensions;

  for (const page of document.pages) {
    for (const block of page.blocks) {
      if (block.id === panelId) continue;
      if (!blockIsFilterable(block)) {
        ineligible.push({ block, pageId: page.id, reason: "block_not_filterable" });
        continue;
      }
      const entry = block.kind === "result" ? catalogEntry(context.catalog, block.binding) : null;
      if (!entry) {
        ineligible.push({ block, pageId: page.id, reason: "unknown_handle" });
        continue;
      }
      if (dimensions.some((dimension) => entry.forbiddenFilters.includes(dimension))) {
        ineligible.push({ block, pageId: page.id, reason: "forbidden_filter_cross" });
        continue;
      }
      if (dimensions.some((dimension) => !entry.supportedFilters.includes(dimension))) {
        ineligible.push({ block, pageId: page.id, reason: "unsupported_filter_dimension" });
        continue;
      }
      eligible.push({ block, pageId: page.id, connected: block.connectedFilterPanelIds.includes(panelId) });
    }
  }
  return { eligible, ineligible };
}
