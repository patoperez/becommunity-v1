/**
 * THE QUALITATIVE SIGN-OFF — who read WHICH categories, and when that stops
 * being true.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT WAS WRONG, AND WHY IT WAS WORSE THAN A MISSING FEATURE.
 *
 * `QualitativeGroupResult.reviewStatus` was the literal `"pending"`, written by
 * the results builder on every group of every study for ever. The publication
 * preflight read it and raised «nadie del equipo las ha revisado todavía», so
 * that warning appeared on every review of every study, could never be cleared
 * by reviewing anything, and named two group labels — «Miembros activos» and
 * «Desertores» — while THREE blocks in the approved layout draw those
 * categories. «Razones declaradas de riesgo» draws the active group and was
 * never mentioned.
 *
 * A permanent warning is not a warning. People learn to tick it, which is the
 * opposite of what a review boundary is for; and a warning that names two of
 * three affected blocks teaches a reviewer that the list is the whole list.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT REPLACES IT.
 *
 * A review is an act by a person against an EXACT SET OF WORDS. So it is
 * recorded with a digest of that set, and it is true only while the set
 * digests to the same thing. Add a category, remove one, rename one, or import
 * evidence that produces a different vocabulary, and the digest moves and the
 * review is stale — automatically, with nobody having to remember.
 *
 * WHAT THE DIGEST COVERS, AND WHAT IT DELIBERATELY DOES NOT.
 *
 *   IN:  each bound group's own label, where its categories came from
 *        (`source_coded` or `be_community_curated`), and the ordered list of its
 *        category labels and of the documented categories excluded from the
 *        cloud.
 *   OUT: every COUNT. A count moving means another person answered with a
 *        category that was already there; the words a reviewer read are
 *        unchanged, and invalidating their review for it would make the sign-off
 *        expire on almost every import for no reason anybody could act on.
 *   OUT: the group ORDER in the document, the block titles, the study, the
 *        tenant. A review is of words, and the same words reviewed once do not
 *        need reviewing again because somebody moved a card.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * NOTHING BUT CLOSED-CODED LABELS CROSSES THIS BOUNDARY.
 *
 * The category labels ARE the data — the source's vocabulary is short, closed
 * and already published to a client in the term cloud — and the free-text
 * column beside every one of them never enters the read model at all. There is
 * no field on any type here for a quotation, a name, a note about a person or a
 * respondent's own words, so none can travel through it, be digested by it, or
 * be stored by the record it produces.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE DIGEST IS NOT IN THIS FILE, AND A BOUNDARY GATE IS WHY.
 *
 * `qualitativeEvidenceDigest` and `qualitativeReviewState` live in
 * `./evidence-digest`, because computing a digest means importing the product's
 * own SHA-256 — which lives under `src/lib/ingestion/canonical-commit/`. Any
 * module the client-safe publication barrel re-exports is one import away from a
 * `"use client"` component, so re-exporting the digest put a path from the
 * review screen into the canonical layer's import graph. The boundary gate found
 * it the moment it existed, which is what that gate is for.
 *
 * So this half — the TYPES, the Spanish for a coding, and which blocks are
 * affected — is client-safe and stays here, and the arithmetic half is
 * server-only by where it lives. Both are pure: no clock, no randomness, no
 * transport, no database, so an offline gate drives the real functions rather
 * than copies of them.
 */

/** Where a category set came from. The canonical layer's own vocabulary. */
export type QualitativeCoding = "source_coded" | "be_community_curated";

/**
 * One qualitative group as a reviewer must read it, and as the digest sees it.
 *
 * `blocks` is what the review screen NAMES — every visible block in this
 * document that draws these categories, by its authored title. It is not part
 * of the digest: moving a card does not un-review a word.
 */
export type QualitativeCategorySet = {
  /** The group's own label, as a client reads it. Never a handle. */
  groupLabel: string;
  coding: QualitativeCoding;
  /** Every category label, in the order the client is shown them. */
  categories: readonly string[];
  /** Documented categories kept out of the cloud and reported beside it. */
  excluded: readonly string[];
  /** «Página · Bloque» for every visible block that draws this group. */
  blocks: readonly string[];
};

/** Plain Spanish for a coding, for a screen. One way only, never parsed back. */
export const CODING_LABEL: Record<QualitativeCoding, string> = {
  source_coded: "Codificadas por la fuente del estudio",
  be_community_curated: "Curadas por Be Community",
};

/** A recorded sign-off, as the store holds it. No actor reaches a screen. */
export type QualitativeSignOff = {
  /** The digest of the categories that were actually read. */
  evidenceDigest: string;
  /** ISO-8601 UTC. The surface formats it. */
  reviewedAt: string;
};

/**
 * The state of the qualitative review for one draft, in one closed word.
 *
 *   `not_applicable` — this document binds no qualitative group at all.
 *   `pending`        — it binds some, and nobody has ever recorded a review.
 *   `stale`          — somebody reviewed, and the categories have changed since.
 *   `current`        — somebody reviewed exactly these categories.
 *
 * THE TYPE IS HERE AND THE FUNCTION THAT DECIDES IT IS NOT. Deciding needs the
 * digest, which needs SHA-256, which the client-safe barrel may not reach; a
 * closed union of four words needs nothing at all. So a review screen may name
 * the state it was handed without acquiring a path into the canonical layer.
 */
export type QualitativeReviewState = "not_applicable" | "pending" | "stale" | "current";

/**
 * Every visible block these categories are drawn in, deduplicated and ordered.
 *
 * THE HALF THE OLD WARNING MISSED. It listed GROUP labels, and a group is drawn
 * by as many blocks as an author chose to draw it in — the approved layout
 * draws the active group twice, once as «Miembros activos» and once as «Razones
 * declaradas de riesgo». A reviewer told «estas dos categorías» while three
 * places on the client's page carry them has been told something false.
 */
export function affectedBlocks(sets: readonly QualitativeCategorySet[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const set of sets) {
    for (const block of set.blocks) {
      if (seen.has(block)) continue;
      seen.add(block);
      out.push(block);
    }
  }
  return out;
}
