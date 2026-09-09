/**
 * THE JOURNEY PAIN REVIEW MODEL — the pure half, and it is where every decision
 * about «is this finished» is actually taken.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY IT IS SPLIT FROM THE WORKSPACE.
 *
 * `src/lib/studio/journey-pain-workspace.ts` carries `import "server-only"`,
 * which fails the build if it is ever reachable from a client bundle — and,
 * under plain Node, throws on import. That is exactly right for the module that
 * holds a database client, and exactly wrong for the module an OFFLINE GATE has
 * to drive: a gate that cannot import the real completion rule would have to
 * reimplement it, and a reimplemented rule is a second rule.
 *
 * So the arithmetic is here: building the queue, deciding the gaps, counting the
 * states, and turning approvals into content. It is pure — no clock, no
 * randomness, no transport, no database — and `scripts/journey-pain-review-test.mjs`
 * drives these functions rather than copies of them.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * IT IS NOT RE-EXPORTED BY THE CLIENT-SAFE BARREL, AND THAT IS THE SAME
 * BOUNDARY.
 *
 * It imports `./journey-pain-digest`, which imports the product's SHA-256 from
 * under `canonical-commit/`. Everything `src/lib/publication/index.ts`
 * re-exports is one import away from a `"use client"` component, so this file
 * stays off the barrel exactly as `evidence-digest.ts` does. Server modules
 * import it directly, offline gates import it directly, and a browser has no
 * path to it.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * NOTHING HERE PROPOSES A MAPPING.
 *
 * Not from string similarity, not from normalized labels, not from position,
 * not from workbook order, and not from the approved demo's hand-written alias
 * table. There is no comparison anywhere in this file between a source stage's
 * wording and a touchpoint's label. The measured reason is in the workspace's
 * own header: three defensible readings of the same two sources give three
 * different answers, so any rule here would be a choice about which reading to
 * privilege — and that choice is a person's.
 */

import type {
  PainItemState,
  PainReviewGap,
  PainReviewItem,
  PainReviewPanel,
  PainTouchpointChoice,
} from "./journey-pain-review";
import { painItemToken, painSourceDigest, painSourceVersion } from "./journey-pain-digest";
import {
  buildJourneyPainContent,
  type AuthoredPainMapping,
  type JourneyPainContent,
} from "../presentation/journey-pain";
import type { PresentationHandle } from "../presentation/handles";
import type { PresentationRenderModel } from "../presentation/render-model";

/** The curated evidence this model reasons over, exactly as the reader returns it. */
export type CuratedPainEvidenceShape = {
  painPoints: { id: string; normalizedText: string; reviewStatus: string }[];
  stageLinks: { painPointId: string; journeyStageId: string; displayOrder: number }[];
  stages: { id: string; label: string; stageOrder: number }[];
};

/** One decision in force, exactly as migration 0032's read function returns it. */
export type StoredPainDecision = {
  itemKey: string;
  sourceDigest: string;
  disposition: "approved" | "rejected" | "unresolved";
  publicPhrase: string | null;
  touchpoints: string[];
  rationale: string | null;
  decidedAt: string;
};

export const EMPTY_PAIN_COUNTS: Record<PainItemState, number> = {
  unreviewed: 0,
  approved: 0,
  rejected: 0,
  unresolved: 0,
};

/**
 * The review of a study whose source carries no journey pain material at all.
 *
 * COMPLETE, and deliberately: a study whose workbook has no curated pain rows
 * has nothing for a person to decide, so there is no queue to finish. Whether
 * its LAYOUT requires the content is a separate question the publication
 * preflight asks of the document, not of this.
 */
export const PAIN_REVIEW_NOT_APPLICABLE: PainReviewPanel = {
  applicable: false,
  items: [],
  choices: [],
  gaps: [],
  complete: true,
  counts: { ...EMPTY_PAIN_COUNTS },
};

/**
 * Every touchpoint a decision may target, grouped by the route that draws it.
 *
 * READ FROM THE RESOLVED MODEL, not from the registry, and that is the whole
 * design of this list. The registry knows every touchpoint the study measured;
 * the MODEL knows the five visible routes this document actually draws and
 * which touchpoints each one shows. A reviewer looking for «Reunión semanal
 * presencial» looks under «Operación», because that is where a reader will
 * find it — and a touchpoint no route draws is one a badge would be invisible
 * on, so offering it would be offering a decision with no effect.
 *
 * The order is the document's own: routes in the order they are drawn, points
 * in the order each route shows them. Nothing is sorted by label, because a
 * list sorted differently from the page it describes is a list a person has to
 * translate.
 */
export function painTouchpointChoices(
  model: PresentationRenderModel | null,
): PainTouchpointChoice[] {
  const choices: PainTouchpointChoice[] = [];
  const seen = new Set<string>();
  if (!model) return choices;
  for (const page of model.pages) {
    for (const block of page.blocks) {
      if (block.payload.shape !== "routes") continue;
      for (const route of block.payload.routes) {
        for (const point of route.points) {
          // A touchpoint appears in exactly one route — the resolver refuses a
          // duplicate by name — so this guard only bites if two ROUTE BLOCKS
          // draw the same journey, which a layout may legitimately do.
          if (seen.has(point.handle)) continue;
          seen.add(point.handle);
          choices.push({
            handle: point.handle as PresentationHandle,
            label: point.label,
            routeTitle: route.title,
          });
        }
      }
    }
  }
  return choices;
}

/**
 * Turn the curated evidence into the queue a person works through.
 *
 * PURE, and exported so an offline gate drives the real function rather than a
 * copy of it. Every token and every digest is computed here, so the same
 * evidence always produces the same queue.
 *
 * ITEMS WITHOUT A JOURNEY STAGE ARE NOT IN SCOPE. A `pain_point` attached to an
 * organizational unit, a performance dimension or a culture dimension is
 * curated evidence about something else — Cuicuilco has 8, 7 and 20 of those
 * beside its 15 journey ones — and asking a reviewer to map it to a JOURNEY
 * touchpoint would be asking a question the source does not pose. They are not
 * shown, not counted, and not a gap.
 */
export function buildPainReviewItems(
  studyId: string,
  evidence: CuratedPainEvidenceShape,
  decisions: readonly StoredPainDecision[],
): PainReviewItem[] {
  const stageById = new Map(evidence.stages.map((stage) => [stage.id, stage]));
  // The stage a pain row was placed in, by the SOURCE'S OWN display order, so a
  // row the source linked twice reads the same way on every load.
  const stageFor = new Map<string, { label: string; order: number; stageOrder: number }>();
  for (const link of [...evidence.stageLinks].sort((a, b) =>
    a.painPointId < b.painPointId
      ? -1
      : a.painPointId > b.painPointId
        ? 1
        : a.displayOrder - b.displayOrder,
  )) {
    if (stageFor.has(link.painPointId)) continue;
    const stage = stageById.get(link.journeyStageId);
    if (!stage) continue;
    stageFor.set(link.painPointId, {
      label: stage.label,
      order: link.displayOrder,
      stageOrder: stage.stageOrder,
    });
  }

  // HOW MANY SOURCE ITEMS CARRY EACH PHRASE. Curation the projector already
  // did, counted once here so a screen counts nothing. It is NOT a count of
  // people: no respondent is attached to a pain point in any shape.
  const occurrences = new Map<string, number>();
  for (const row of evidence.painPoints) {
    if (!stageFor.has(row.id)) continue;
    occurrences.set(row.normalizedText, (occurrences.get(row.normalizedText) ?? 0) + 1);
  }

  const byKey = new Map(decisions.map((decision) => [decision.itemKey, decision]));

  const items: PainReviewItem[] = [];
  /** The stage position and the in-stage position each item is ordered by. */
  const sortKeyByToken = new Map<string, { stageOrder: number; order: number }>();
  for (const row of evidence.painPoints) {
    const stage = stageFor.get(row.id);
    if (!stage) continue;
    const token = painItemToken(studyId, row.id);
    sortKeyByToken.set(token, { stageOrder: stage.stageOrder, order: stage.order });
    const digest = painSourceDigest({
      token,
      curatedPhrase: row.normalizedText,
      sourceContext: stage.label,
      sourceStatus: row.reviewStatus,
    });
    const decision = byKey.get(token) ?? null;
    // STALE IS A FACT ABOUT TWO SERVER-COMPUTED DIGESTS, one read from the
    // store and one recomputed from the rows that are there now. Nothing the
    // browser sent takes part in it.
    const stale = decision !== null && decision.sourceDigest !== digest;
    items.push({
      token,
      curatedPhrase: row.normalizedText,
      sourceContext: stage.label,
      occurrences: occurrences.get(row.normalizedText) ?? 1,
      sourceStatus: row.reviewStatus,
      // A STALE DECISION IS NOT A DECISION. The item goes back to `unreviewed`
      // and `stale` says why, so a reviewer is told «this changed» rather than
      // finding their approval silently attached to words they never read.
      state: decision === null || stale ? "unreviewed" : decision.disposition,
      sourceVersion: painSourceVersion(digest),
      stale,
      publicPhrase: decision && !stale ? decision.publicPhrase : null,
      touchpoints:
        decision && !stale ? (decision.touchpoints as PresentationHandle[]) : [],
      rationale: decision && !stale ? decision.rationale : null,
      decidedAt: decision && !stale ? decision.decidedAt : null,
    });
  }

  // THE SOURCE'S OWN ORDER: by the stage the workbook placed the item in, then
  // by the item's position inside that stage, then by the phrase — so two rows
  // sharing a cell never swap between loads and a reviewer working down the
  // list twice sees the same list. The keys are read from the map built above
  // rather than looked up by LABEL: two stages may legitimately carry the same
  // label, and matching on it would order one of them by the other's position.
  const orderOf = new Map(items.map((item) => [item.token, sortKeyByToken.get(item.token)!]));
  return items.sort((a, b) => {
    const left = orderOf.get(a.token)!;
    const right = orderOf.get(b.token)!;
    if (left.stageOrder !== right.stageOrder) return left.stageOrder - right.stageOrder;
    if (left.order !== right.order) return left.order - right.order;
    return a.curatedPhrase < b.curatedPhrase ? -1 : a.curatedPhrase > b.curatedPhrase ? 1 : 0;
  });
}

/**
 * Every reason this review is not finished, in a closed vocabulary.
 *
 * THE FIVE CONDITIONS THE COMPLETION RULE NAMES, and no sixth: every in-scope
 * item has an explicit disposition; every approved item has a public phrase;
 * every approved item is mapped to at least one touchpoint; the source digest
 * still matches; and no mapping targets a missing touchpoint. `complete` is
 * exactly `gaps.length === 0`, so the two can never say different things.
 */
export function painReviewGaps(
  items: readonly PainReviewItem[],
  choices: readonly PainTouchpointChoice[],
): PainReviewGap[] {
  const offered = new Set(choices.map((choice) => choice.handle as string));
  const gaps = new Set<PainReviewGap>();
  for (const item of items) {
    if (item.stale) gaps.add("stale_source");
    if (item.state === "unreviewed") {
      gaps.add("undecided_items");
      continue;
    }
    if (item.state !== "approved") continue;
    if (item.publicPhrase === null || item.publicPhrase.trim().length === 0) {
      gaps.add("approved_without_phrase");
    }
    if (item.touchpoints.length === 0) gaps.add("approved_without_touchpoint");
    // A HANDLE THE DOCUMENT NO LONGER DRAWS. It happens when a layout is edited
    // after a mapping was made, and it is a BLOCKER rather than a silent drop:
    // the phrase would appear in the cloud and on no point of the journey.
    for (const handle of item.touchpoints) {
      if (!offered.has(handle as string)) gaps.add("unknown_touchpoint");
    }
  }
  // A FIXED ORDER, so two runs produce the same sentence in the same place.
  const ORDER: PainReviewGap[] = [
    "undecided_items",
    "stale_source",
    "approved_without_phrase",
    "approved_without_touchpoint",
    "unknown_touchpoint",
  ];
  return ORDER.filter((gap) => gaps.has(gap));
}

/** How many items are in each state. Counted here so a screen counts nothing. */
export function painReviewCounts(items: readonly PainReviewItem[]): Record<PainItemState, number> {
  const counts = { ...EMPTY_PAIN_COUNTS };
  for (const item of items) counts[item.state] += 1;
  return counts;
}

/**
 * The content a complete review authorizes, or null.
 *
 * NULL UNLESS THE REVIEW IS COMPLETE, which is the whole safety property: the
 * resolver draws the cloud and the badges from what this returns, so a partial
 * review cannot produce a partial cloud. There is no «best effort» branch.
 */
export function authoredPainContent(panel: PainReviewPanel): JourneyPainContent | null {
  if (!panel.applicable || !panel.complete) return null;
  const mappings: AuthoredPainMapping[] = [];
  for (const item of panel.items) {
    // REJECTED AND UNRESOLVED ITEMS ARE EXCLUDED, which is what those words
    // mean. An excluded phrase is not published, and a phrase somebody could
    // not resolve is not published under a guess.
    if (item.state !== "approved" || item.publicPhrase === null) continue;
    mappings.push({ phrase: item.publicPhrase, touchpoints: item.touchpoints });
  }
  if (mappings.length === 0) return null;
  return buildJourneyPainContent({ mappings });
}

