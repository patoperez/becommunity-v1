/**
 * THE VIEWER SELECTION — what a reader chose, and nothing else.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * IT IS NOT PART OF THE DOCUMENT, AND IT MUST NEVER BECOME PART OF ONE.
 *
 * A `PresentationDocument` is CONFIGURATION: pages, blocks, bindings, panels and
 * the explicit connections between them. It is the thing an author writes and a
 * publisher stores. A viewer selection is the opposite kind of fact — it is what
 * one reader is looking at right now, it lasts as long as their attention does,
 * and two readers of the same published study hold different ones at the same
 * moment.
 *
 * Storing a selection inside the document would make one reader's momentary
 * choice part of everybody's published layout, and would make "what does this
 * study say" depend on who last touched a dropdown. So the selection travels in
 * its own contract, is validated on its own terms, and is thrown away when the
 * page is closed. `validatePresentationDocument` refuses an unknown field, so a
 * selection cannot be smuggled into a document even by accident.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT A BROWSER IS ALLOWED TO NAME.
 *
 * Three things, and all three are opaque:
 *
 *   1. a PANEL ID — an identifier the document itself authored;
 *   2. a DIMENSION HANDLE — the same opaque handle the catalogue publishes,
 *      built from a label a reader is already shown or from an ordinal;
 *   3. an OPTION TOKEN — `o0`, `o1`, `o2` … the ORDINAL POSITION of a value
 *      inside the dimension the server offered.
 *
 * It may not name a database column, a canonical address, a study, a tenant, a
 * cohort key, a raw answer, or anything shaped like a predicate. There is
 * nowhere in these types to put one, which is stronger than checking for one.
 *
 * The option TOKEN in particular is why the raw value never makes the round
 * trip. A cohort's canonical value is `active`; that is an internal enum, and a
 * reader must never be offered it, nor send it back. The token is a position,
 * the label beside it is the study's own Spanish, and the server is the only
 * side that ever holds the value the position points at.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * HOW SELECTIONS COMBINE, SAID ONCE SO IT IS SAID THE SAME WAY EVERYWHERE.
 *
 *   Several values inside ONE dimension  → OR   (any of them)
 *   Several dimensions inside ONE panel  → AND  (all of them)
 *   Several panels moving ONE block      → AND  (all of them)
 *
 * The third rule is the reason a block's constraint list may carry the same
 * dimension twice: two panels may both constrain «Generación», with different
 * values, and the honest reading of "both apply" is that a person must satisfy
 * both lists. That is the INTERSECTION, and it is expressed by keeping the two
 * constraints separate rather than by intersecting them here — an intersection
 * computed here could come out empty, and an empty value list means "not
 * constrained" to the canonical filter layer, which would silently turn "nobody
 * matches" into "everybody matches". Two constraints that share no value simply
 * match nobody, which is what a reader asked for and what they will be told.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * AND NOTHING HERE CALCULATES.
 *
 * This module sorts, compares strings, joins and splits. It holds no threshold,
 * no denominator and no arithmetic; the whole presentation layer is scanned for
 * `Math.`, division and multiplication and this file must keep that true.
 */

import type { PresentationDocument, PresentationBlock } from "./document";
import type { PresentationErrorCode } from "./errors";
import type { PresentationHandle } from "./handles";
import { compareHandles, handleFacet, isPresentationHandle } from "./handles";

/* -------------------------------------------------------------------------- */
/* the shape                                                                   */
/* -------------------------------------------------------------------------- */

/** One dimension a reader constrained, and the option tokens they chose. */
export type ViewerDimensionSelection = {
  /** The opaque dimension handle, exactly as the panel offered it. */
  handle: string;
  /** Ordinal option tokens. Empty means the dimension is not constrained. */
  options: string[];
};

/** What a reader chose on ONE panel. */
export type ViewerPanelSelection = {
  /** The panel's own id, as the document authored it. */
  panelId: string;
  dimensions: ViewerDimensionSelection[];
};

/**
 * The whole ephemeral selection.
 *
 * `panels` is a list rather than a map so the shape serializes deterministically
 * and validates with an ordinary array schema. It is normalized — sorted,
 * de-duplicated, emptied of empty entries — before it is used for anything.
 */
export type ViewerSelection = {
  panels: ViewerPanelSelection[];
};

/** «Todas las personas», in every panel. The neutral selection. */
export const EMPTY_VIEWER_SELECTION: ViewerSelection = Object.freeze({ panels: [] }) as ViewerSelection;

/* -------------------------------------------------------------------------- */
/* the ceilings                                                                */
/* -------------------------------------------------------------------------- */

/**
 * Bounds, checked before anything is interpreted.
 *
 * They are not tuning. Every one of them bounds work a browser can ask the
 * server to do: each distinct constraint set is a separate recomputation of the
 * whole study, so an unbounded document-and-selection pair is an unbounded
 * amount of server arithmetic requested by an unauthenticated-shaped input.
 */
export const VIEWER_LIMITS = Object.freeze({
  /** Panels a single selection may name. The document itself caps at 256 blocks. */
  panels: 32,
  /** Dimensions one panel may constrain. The document caps a panel at 32. */
  dimensionsPerPanel: 32,
  /** Option tokens one dimension may carry. */
  optionsPerDimension: 64,
  /**
   * DISTINCT constraint sets one resolution may require.
   *
   * Blocks connected to the same panels share a set, so the realistic number is
   * the number of distinct panel COMBINATIONS in the document — three or four
   * for the approved layout. The ceiling is what stops a hand-built document
   * from asking for hundreds of full recomputations in one request.
   */
  recomputations: 24,
  /** Characters an encoded viewer state may occupy. */
  encodedLength: 2048,
});

/* -------------------------------------------------------------------------- */
/* option tokens                                                               */
/* -------------------------------------------------------------------------- */

/**
 * The token for the option at `index` of a dimension's offered values.
 *
 * A POSITION, and deliberately nothing else. The values a dimension offers are
 * derived by the canonical layer from the source alone — never from the active
 * selection — so the position is stable for as long as the package behind it is,
 * and the binding fingerprint already refuses a document whose package moved.
 *
 * `String(index)` and not `index + 1`: the layer performs no arithmetic, and a
 * zero-based ordinal is exactly as opaque as a one-based one.
 */
export function filterOptionToken(index: number): string {
  return `o${String(index)}`;
}

const OPTION_TOKEN_PATTERN = /^o(?:0|[1-9][0-9]{0,3})$/;

/** True when `value` is syntactically an option token. Says nothing about existence. */
export function isFilterOptionToken(value: unknown): value is string {
  return typeof value === "string" && OPTION_TOKEN_PATTERN.test(value);
}

/**
 * The panel-id grammar, repeated here on purpose.
 *
 * `document.ts` validates block ids with the same shape when it parses a
 * document. This module is handed a selection, not a document, and a selection
 * that names `../../etc` must be refused before anything looks it up — so the
 * grammar is asserted on the way in rather than assumed from elsewhere.
 */
const PANEL_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/;

/** True when `value` is syntactically a panel id. Says nothing about existence. */
export function isViewerPanelId(value: unknown): value is string {
  return typeof value === "string" && PANEL_ID_PATTERN.test(value);
}

/* -------------------------------------------------------------------------- */
/* normalization                                                               */
/* -------------------------------------------------------------------------- */

function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values)].sort(compareStrings);
}

/**
 * One canonical form for a selection, so two equal selections are equal bytes.
 *
 * Sorting is not cosmetic. The constraint SET is what decides which recomputed
 * results a block reads, and two orderings of the same set must choose the same
 * one — otherwise the same reader state would produce two server round trips and
 * two identical-but-separately-computed answers.
 *
 * Empty dimensions and empty panels are dropped: "constrained by nothing" and
 * "not constrained" are the same fact, and keeping both spellings would let a
 * neutral selection look active.
 */
export function normalizeViewerSelection(selection: ViewerSelection): ViewerSelection {
  const byPanel = new Map<string, Map<string, string[]>>();
  for (const panel of selection.panels) {
    let dimensions = byPanel.get(panel.panelId);
    if (!dimensions) {
      dimensions = new Map();
      byPanel.set(panel.panelId, dimensions);
    }
    for (const dimension of panel.dimensions) {
      const options = uniqueSorted([...(dimensions.get(dimension.handle) ?? []), ...dimension.options]);
      if (options.length > 0) dimensions.set(dimension.handle, options);
    }
  }

  const panels: ViewerPanelSelection[] = [];
  for (const panelId of [...byPanel.keys()].sort(compareStrings)) {
    const dimensions = byPanel.get(panelId)!;
    const entries = [...dimensions.entries()]
      .filter(([, options]) => options.length > 0)
      .sort((a, b) => compareStrings(a[0], b[0]))
      .map(([handle, options]) => ({ handle, options }));
    if (entries.length > 0) panels.push({ panelId, dimensions: entries });
  }
  return { panels };
}

/** True when nothing at all is constrained — «Todas las personas». */
export function viewerSelectionIsNeutral(selection: ViewerSelection): boolean {
  return selection.panels.every((panel) => panel.dimensions.every((dimension) => dimension.options.length === 0));
}

/* -------------------------------------------------------------------------- */
/* editing, on the reader's side                                               */
/* -------------------------------------------------------------------------- */

/**
 * Turn one option on or off. Pure, and it returns a normalized selection.
 *
 * This is the ONLY way the browser changes a selection, which is what keeps the
 * client from inventing a shape the server has never seen. It is here rather
 * than in the component so the combination rules have exactly one implementation
 * and a gate can drive it without a browser.
 */
export function toggleViewerOption(
  selection: ViewerSelection,
  panelId: string,
  handle: string,
  token: string,
  on: boolean,
): ViewerSelection {
  const panels = selection.panels.map((panel) => {
    if (panel.panelId !== panelId) return panel;
    const existing = panel.dimensions.find((dimension) => dimension.handle === handle);
    const options = on
      ? [...(existing?.options ?? []), token]
      : (existing?.options ?? []).filter((candidate) => candidate !== token);
    const others = panel.dimensions.filter((dimension) => dimension.handle !== handle);
    return { panelId, dimensions: [...others, { handle, options }] };
  });
  const known = selection.panels.some((panel) => panel.panelId === panelId);
  const next = known ? panels : [...panels, { panelId, dimensions: [{ handle, options: on ? [token] : [] }] }];
  return normalizeViewerSelection({ panels: next });
}

/** Return this panel to «Todas las personas», leaving every other panel alone. */
export function clearViewerPanel(selection: ViewerSelection, panelId: string): ViewerSelection {
  return normalizeViewerSelection({
    panels: selection.panels.filter((panel) => panel.panelId !== panelId),
  });
}

/** What one panel currently constrains. */
export function viewerPanelSelection(selection: ViewerSelection, panelId: string): ViewerDimensionSelection[] {
  return selection.panels.find((panel) => panel.panelId === panelId)?.dimensions ?? [];
}

/** The option tokens chosen for one control. */
export function viewerDimensionOptions(
  selection: ViewerSelection,
  panelId: string,
  handle: string,
): string[] {
  return viewerPanelSelection(selection, panelId).find((dimension) => dimension.handle === handle)?.options ?? [];
}

/* -------------------------------------------------------------------------- */
/* constraint sets, and the key that names one                                 */
/* -------------------------------------------------------------------------- */

/**
 * One constraint: a dimension, and the tokens a person may match ANY of.
 *
 * A list of these is what a block resolves under. The same handle may appear
 * twice — see the combination rules at the top of the file — and that repetition
 * is meaningful, so nothing here collapses it.
 */
export type ViewerConstraint = {
  handle: string;
  options: string[];
};

function compareConstraints(a: ViewerConstraint, b: ViewerConstraint): number {
  if (a.handle !== b.handle) return compareStrings(a.handle, b.handle);
  return compareStrings(a.options.join("."), b.options.join("."));
}

/**
 * The constraints that move a block, gathered from every panel connected to it.
 *
 * Two panels imposing the IDENTICAL constraint on the same dimension are the
 * same requirement said twice, so the pair is de-duplicated: applying it once
 * and applying it twice select the same people, and one spelling means one
 * recomputation instead of two.
 *
 * Two panels imposing DIFFERENT constraints on the same dimension are kept
 * apart, because a person must satisfy both.
 */
export function viewerConstraintsFor(
  selection: ViewerSelection,
  connectedPanelIds: readonly string[],
): ViewerConstraint[] {
  const seen = new Set<string>();
  const constraints: ViewerConstraint[] = [];
  for (const panelId of connectedPanelIds) {
    for (const dimension of viewerPanelSelection(selection, panelId)) {
      if (dimension.options.length === 0) continue;
      const options = uniqueSorted(dimension.options);
      const signature = `${dimension.handle}=${options.join(".")}`;
      if (seen.has(signature)) continue;
      seen.add(signature);
      constraints.push({ handle: dimension.handle, options });
    }
  }
  return constraints.sort(compareConstraints);
}

/**
 * The key that names one constraint set.
 *
 * The empty string is the UNFILTERED set, and it is a value the rest of the
 * layer relies on: a block no panel moves resolves under `""`, which is the
 * study's own unfiltered results document, byte for byte the one an unfiltered
 * page would have received.
 */
export function viewerConstraintKey(constraints: readonly ViewerConstraint[]): string {
  return constraints.map((constraint) => `${constraint.handle}=${constraint.options.join(".")}`).join("|");
}

/** The key a BLOCK resolves under. */
export function viewerKeyForBlock(selection: ViewerSelection, block: PresentationBlock): string {
  return viewerConstraintKey(viewerConstraintsFor(selection, block.connectedFilterPanelIds));
}

/**
 * The key a PANEL reports its own counts under.
 *
 * A panel says how many people ITS OWN selection leaves, which is not the same
 * question as what any one block it moves resolves under: a block moved by two
 * panels is narrower than either panel alone, and a panel that says otherwise
 * would be describing somebody else's arithmetic.
 */
export function viewerKeyForPanel(selection: ViewerSelection, panelId: string): string {
  return viewerConstraintKey(viewerConstraintsFor(selection, [panelId]));
}

/**
 * Every distinct constraint set a document needs under this selection.
 *
 * The unfiltered key `""` is excluded: it is always available and is never a
 * recomputation. What comes back is exactly the set of extra results documents
 * the server must build, keyed and de-duplicated, so nothing is computed twice
 * and nothing a block will ask for is missing.
 */
export function viewerRecomputations(
  document: PresentationDocument,
  selection: ViewerSelection,
): { key: string; constraints: ViewerConstraint[] }[] {
  const byKey = new Map<string, ViewerConstraint[]>();
  const add = (constraints: ViewerConstraint[]) => {
    const key = viewerConstraintKey(constraints);
    if (key.length === 0 || byKey.has(key)) return;
    byKey.set(key, constraints);
  };
  for (const page of document.pages) {
    for (const block of page.blocks) {
      if (block.kind === "filter_panel") add(viewerConstraintsFor(selection, [block.id]));
      add(viewerConstraintsFor(selection, block.connectedFilterPanelIds));
    }
  }
  return [...byKey.entries()]
    .sort((a, b) => compareStrings(a[0], b[0]))
    .map(([key, constraints]) => ({ key, constraints }));
}

/* -------------------------------------------------------------------------- */
/* validation — the selection against the document that offered it             */
/* -------------------------------------------------------------------------- */

/**
 * What a panel legitimately offers, as the server knows it.
 *
 * Built from the DOCUMENT (which panels exist and which dimensions each one
 * offers) and from the REGISTRY (which option tokens each dimension actually
 * has). A selection is checked against this and against nothing else, so
 * "the browser sent it" is never a reason to believe it.
 */
export type ViewerOffer = {
  /** Panel id → the dimension handles that panel offers, in document order. */
  panels: ReadonlyMap<string, readonly PresentationHandle[]>;
  /** Dimension handle → the option tokens the registry minted for it. */
  options: ReadonlyMap<PresentationHandle, ReadonlySet<string>>;
};

/**
 * Why a viewer selection was refused.
 *
 * A NARROWED VIEW of the layer's one refusal vocabulary rather than a second
 * one, so every code here already has a Spanish sentence in `labels.ts` and a
 * new code cannot be invented without deciding what it says to a person.
 */
export type ViewerRefusalCode = Extract<
  PresentationErrorCode,
  | "viewer_selection_malformed"
  | "unknown_filter_panel"
  | "filter_dimension_not_offered"
  | "unknown_filter_option"
  | "too_many_filter_recomputations"
>;

export type ViewerValidation =
  | { ok: true; selection: ViewerSelection }
  | { ok: false; code: ViewerRefusalCode };

/**
 * The panels a document actually contains, and what each one offers.
 *
 * Only `filter_panel` blocks are collected, so a selection naming a KPI block's
 * id is refused as an unknown panel rather than quietly ignored.
 */
export function viewerPanelOffers(
  document: PresentationDocument,
): Map<string, readonly PresentationHandle[]> {
  const panels = new Map<string, readonly PresentationHandle[]>();
  for (const page of document.pages) {
    for (const block of page.blocks) {
      if (block.kind === "filter_panel") panels.set(block.id, block.dimensions);
    }
  }
  return panels;
}

/**
 * Validate a selection that arrived from a browser.
 *
 * REJECT BY DEFAULT, and refuse rather than repair. A dimension the panel does
 * not offer is not dropped and the rest honoured: dropping it would answer a
 * question nobody asked while looking exactly like an answer to the question
 * they did. Every refusal carries a closed code and NO echo of the offending
 * input — an error message that quotes what it was sent is a way to get a value
 * back out of a system that had decided not to publish it.
 */
export function validateViewerSelection(candidate: unknown, offer: ViewerOffer): ViewerValidation {
  const shaped = shapeViewerSelection(candidate);
  if (shaped === null) return { ok: false, code: "viewer_selection_malformed" };

  const selection = normalizeViewerSelection(shaped);
  if (selection.panels.length > VIEWER_LIMITS.panels) {
    return { ok: false, code: "viewer_selection_malformed" };
  }

  for (const panel of selection.panels) {
    const offered = offer.panels.get(panel.panelId);
    if (!offered) return { ok: false, code: "unknown_filter_panel" };
    if (panel.dimensions.length > VIEWER_LIMITS.dimensionsPerPanel) {
      return { ok: false, code: "viewer_selection_malformed" };
    }
    for (const dimension of panel.dimensions) {
      if (!isPresentationHandle(dimension.handle)) {
        return { ok: false, code: "viewer_selection_malformed" };
      }
      if (handleFacet(dimension.handle) !== "dimension") {
        return { ok: false, code: "filter_dimension_not_offered" };
      }
      // OFFERED BY THIS PANEL, not merely known to the registry. A dimension the
      // author did not put on this panel has never been checked against the
      // blocks the panel moves, so honouring it would apply a cross nobody
      // validated — which is exactly how a forbidden one would arrive.
      if (!offered.includes(dimension.handle)) {
        return { ok: false, code: "filter_dimension_not_offered" };
      }
      if (dimension.options.length > VIEWER_LIMITS.optionsPerDimension) {
        return { ok: false, code: "viewer_selection_malformed" };
      }
      const tokens = offer.options.get(dimension.handle);
      if (!tokens) return { ok: false, code: "filter_dimension_not_offered" };
      for (const token of dimension.options) {
        if (!isFilterOptionToken(token)) return { ok: false, code: "viewer_selection_malformed" };
        if (!tokens.has(token)) return { ok: false, code: "unknown_filter_option" };
      }
    }
  }

  return { ok: true, selection };
}

/**
 * Shape-check an untrusted value without believing anything about it.
 *
 * Hand-written rather than a Zod schema on purpose: this runs on every filter
 * change, the shape is four fields deep, and the module is imported by the
 * browser — a validator that costs nothing to ship is worth more here than one
 * more dependency edge in a client bundle. The document, which is far larger and
 * far more structured, keeps its Zod schema.
 */
function shapeViewerSelection(candidate: unknown): ViewerSelection | null {
  if (typeof candidate !== "object" || candidate === null) return null;
  const panelsRaw = (candidate as { panels?: unknown }).panels;
  if (!Array.isArray(panelsRaw)) return null;
  if (panelsRaw.length > VIEWER_LIMITS.panels) return null;

  const panels: ViewerPanelSelection[] = [];
  for (const panelRaw of panelsRaw) {
    if (typeof panelRaw !== "object" || panelRaw === null) return null;
    const panelId = (panelRaw as { panelId?: unknown }).panelId;
    const dimensionsRaw = (panelRaw as { dimensions?: unknown }).dimensions;
    if (!isViewerPanelId(panelId)) return null;
    if (!Array.isArray(dimensionsRaw)) return null;
    if (dimensionsRaw.length > VIEWER_LIMITS.dimensionsPerPanel) return null;

    const dimensions: ViewerDimensionSelection[] = [];
    for (const dimensionRaw of dimensionsRaw) {
      if (typeof dimensionRaw !== "object" || dimensionRaw === null) return null;
      const handle = (dimensionRaw as { handle?: unknown }).handle;
      const optionsRaw = (dimensionRaw as { options?: unknown }).options;
      if (typeof handle !== "string" || handle.length === 0 || handle.length > 128) return null;
      if (!Array.isArray(optionsRaw)) return null;
      if (optionsRaw.length > VIEWER_LIMITS.optionsPerDimension) return null;
      const options: string[] = [];
      for (const option of optionsRaw) {
        if (typeof option !== "string") return null;
        options.push(option);
      }
      dimensions.push({ handle, options });
    }
    panels.push({ panelId, dimensions });
  }
  return { panels };
}

/** Order dimension handles the way the catalogue orders them. */
export function compareViewerDimensions(a: ViewerDimensionSelection, b: ViewerDimensionSelection): number {
  return compareHandles(a.handle as PresentationHandle, b.handle as PresentationHandle);
}
