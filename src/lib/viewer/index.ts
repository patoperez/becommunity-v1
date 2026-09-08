/**
 * THE FILTERED RESOLUTION — one read, many recomputations, one render model.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THIS MODULE IS, AND WHY IT IS ITS OWN FOLDER.
 *
 * It is the composition three layers meet in: a reader's SELECTION, the
 * canonical RESULTS builder, and the presentation REGISTRY and RESOLVER. None
 * of the three may hold it.
 *
 *   `src/lib/results/` must not know what a presentation is;
 *   `src/lib/presentation/` must not calculate, and calling the results builder
 *     is calculating even when the arithmetic is somebody else's;
 *   `src/lib/studio/` is the application's own loader layer, and this is not
 *     application code — it takes no client, opens no connection, and reads no
 *     environment.
 *
 * So it is pure, it imports by relative path like every other gate-reachable
 * module under `src/lib/`, and an offline gate drives the REAL composition
 * rather than a copy of it. A copy is exactly how a filter semantics gate ends
 * up green while the product does something else.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE ORDER MATTERS, AND HERE IS WHY EACH STEP IS WHERE IT IS.
 *
 *   1. VALIDATE THE SELECTION against what this document and this study
 *      actually offer. `applyFilters` throws on an unknown dimension or value
 *      by design — reject by default — and a throw is not an answer a reader
 *      can be shown, so nothing unvalidated ever reaches it.
 *
 *   2. WORK OUT WHAT MUST BE RECOMPUTED. One constraint set per distinct
 *      combination of connected panels, de-duplicated, and never one per block:
 *      the approved layout has three panels, so it has three recomputations
 *      rather than twenty-four.
 *
 *   3. RECOMPUTE FROM THE SAME SOURCE. The evidence is read once; every
 *      selection is a fresh pass of the pure builder over that same in-memory
 *      object. Two reads could disagree, and two registries built from
 *      disagreeing reads is the one way their addresses could stop describing
 *      the same positions.
 *
 *   4. REBUILD THE REGISTRY FROM EACH RECOMPUTATION. Addresses are positions
 *      and stay put — every addressed array is derived from the source or the
 *      specification — but AVAILABILITY and BASES are not, and the sample
 *      policy decides against a base. Reusing the unfiltered registry would
 *      resolve cleanly and decide every "annotate below" against a base nobody
 *      in the selection has.
 *
 *   5. RESOLVE ONCE, with the unfiltered document as the default view. The
 *      resolver compares each rebuilt registry's binding against the bound one
 *      and refuses on `filter_registry_drift` if the positions ever move.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * AND NOTHING HERE DECIDES A NUMBER.
 *
 * Every figure in the model this returns was computed by `src/lib/results/`,
 * rounded exactly once at the precision its unit declares, and formatted by the
 * canonical layer. This module chooses WHICH population each block is computed
 * over; it never chooses what the answer is.
 */

import { buildCanonicalStudyResults } from "../results/build";
import type { CanonicalStudyResults } from "../results/contract";
import type { CanonicalResultSource } from "../results/source";
import type { PresentationDocument, PresentationIssue } from "../presentation";
import {
  VIEWER_LIMITS,
  validateViewerSelection,
  viewerRecomputations,
  type ViewerSelection,
} from "../presentation/viewer";
import {
  buildCanonicalPresentationRegistry,
  viewerAppliedFilters,
  viewerOfferFor,
  type CanonicalPresentationRegistry,
} from "../presentation/registry";
import { resolvePresentation } from "../presentation/resolve";
import type { PresentationRenderModel } from "../presentation/render-model";

/**
 * One canonical read, and the two things every recomputation is measured
 * against: the study's UNFILTERED results and the registry built from them.
 *
 * `source` is kept because a recomputation is a fresh build over the same
 * evidence, not a second read.
 */
export type CanonicalPresentationRead = {
  source: CanonicalResultSource;
  results: CanonicalStudyResults;
  registry: CanonicalPresentationRegistry;
};

/** Build the unfiltered pair from evidence that has already been read. */
export function buildPresentationRead(source: CanonicalResultSource): CanonicalPresentationRead {
  const results = buildCanonicalStudyResults(source);
  return { source, results, registry: buildCanonicalPresentationRegistry(results) };
}

/** Why a selection could not be honoured. Codes and paths only, never prose. */
export type ViewerResolution =
  | {
      ok: true;
      model: PresentationRenderModel;
      /** The selection actually applied, normalized. Echoed, never assumed. */
      selection: ViewerSelection;
      /** How many full recomputations this resolution required. */
      recomputations: number;
    }
  | { ok: false; issues: { code: string; path: string }[] };

/**
 * Resolve one BOUND document under one reader's selection.
 *
 * The document must already be bound: binding is a deliberate act by whoever
 * decided this layout describes this registry, and a binding made on the read
 * path would agree by construction and prove nothing. This function refuses an
 * unbound document by delegating to the resolver, which has always refused one.
 */
export function resolveUnderSelection(
  read: CanonicalPresentationRead,
  bound: PresentationDocument,
  candidate: unknown,
): ViewerResolution {
  // 1. THE SELECTION, checked against the offer and never against itself.
  const validated = validateViewerSelection(candidate, viewerOfferFor(bound, read.registry));
  if (!validated.ok) return { ok: false, issues: [{ code: validated.code, path: "$.viewer" }] };
  const selection = validated.selection;

  // 2. WHAT MUST BE RECOMPUTED, bounded before any of it is done.
  const required = viewerRecomputations(bound, selection);
  if (required.length > VIEWER_LIMITS.recomputations) {
    return { ok: false, issues: [{ code: "too_many_filter_recomputations", path: "$.viewer" }] };
  }

  // 3 and 4. ONE BUILD AND ONE REGISTRY PER DISTINCT CONSTRAINT SET.
  const views = new Map<
    string,
    { results: CanonicalStudyResults; registry: CanonicalPresentationRegistry }
  >();
  for (const recomputation of required) {
    const applied = viewerAppliedFilters(read.registry, read.results, recomputation.constraints);
    if (applied === null) {
      // A position this study never minted. It cannot happen after step 1 and
      // it refuses anyway: the alternative is handing an unvalidated value to a
      // function documented to throw on one.
      return { ok: false, issues: [{ code: "unknown_filter_option", path: "$.viewer" }] };
    }
    const filtered = buildCanonicalStudyResults(read.source, { filters: applied });
    views.set(recomputation.key, {
      results: filtered,
      registry: buildCanonicalPresentationRegistry(filtered),
    });
  }

  // 5. ONE RESOLUTION.
  const resolved = resolvePresentation({
    document: bound,
    registry: read.registry,
    results: read.results,
    viewer: { selection, views },
  });
  if (!resolved.ok) return { ok: false, issues: issuesOf(resolved.errors) };
  return { ok: true, model: resolved.value, selection, recomputations: required.length };
}

/**
 * CODES AND PATHS, never `detail`.
 *
 * The contract's own prose is written for a reviewer auditing a document, and
 * 6A.1 decided it stops at the server. The same decision holds here even though
 * the first reader of this is internal, because the shape is the one a client
 * route will eventually receive.
 */
function issuesOf(errors: readonly PresentationIssue[]): { code: string; path: string }[] {
  return errors.map((entry) => ({ code: entry.code, path: entry.path }));
}
