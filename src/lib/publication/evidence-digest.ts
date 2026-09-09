/**
 * THE QUALITATIVE EVIDENCE DIGEST — the arithmetic half of the sign-off.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY IT IS ITS OWN FILE.
 *
 * It needs the product's own synchronous SHA-256, which lives under
 * `src/lib/ingestion/canonical-commit/`. Everything the client-safe publication
 * barrel re-exports is one import away from a `"use client"` component, so
 * putting this beside the types put a path from the review screen straight into
 * the canonical layer's import graph — and the boundary gate refused it by name
 * the moment it existed.
 *
 * The barrel therefore does NOT re-export this file. Server modules import it
 * directly, offline gates import it directly, and a browser has no path to it.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THE DIGEST COVERS, AND WHAT IT DELIBERATELY DOES NOT.
 *
 *   IN:  each bound group's own label, where its categories came from, and the
 *        ordered list of its category labels and of the documented categories
 *        excluded from the cloud.
 *   OUT: every COUNT. A count moving means another person answered with a
 *        category that was already there; the words a reviewer read are
 *        unchanged, and invalidating their review for it would make the sign-off
 *        expire on almost every import for no reason anybody could act on.
 *   OUT: the group ORDER in the document, the block titles, the study and the
 *        tenant. A review is of words, and the same words reviewed once do not
 *        need reviewing again because somebody moved a card.
 *
 * It is pure: no clock, no randomness, no transport, no database.
 */

import { sha256Hex } from "../ingestion/canonical-commit/sha256";
import { opaqueIdentity } from "./opaque";
import type {
  QualitativeCategorySet,
  QualitativeReviewState,
  QualitativeSignOff,
} from "./qualitative-signoff";

/**
 * The digest of the exact evidence a sign-off is about.
 *
 * Deterministic and order-independent ACROSS groups — the sets are sorted by
 * label first, so two documents binding the same groups in a different order
 * produce the same digest — and order-DEPENDENT within a group, because the
 * order categories are shown in is part of what a reviewer read.
 *
 * THE SEPARATORS ARE THE ASCII UNIT AND RECORD SEPARATORS, written as escapes
 * rather than as literal bytes, because a category label is a person's own
 * Spanish and may legitimately contain any printable character — a comma, a
 * pipe, a newline, a bracket. A separator chosen from printable punctuation
 * lets two different sets spell one string and collide into one digest, which
 * would make a review of one of them silently count as a review of the other.
 */
export function qualitativeEvidenceDigest(sets: readonly QualitativeCategorySet[]): string {
  const UNIT = "\u001f";
  const RECORD = "\u001e";
  const canonical = [...sets]
    .sort((a, b) => (a.groupLabel < b.groupLabel ? -1 : a.groupLabel > b.groupLabel ? 1 : 0))
    .map((set) =>
      [
        set.groupLabel,
        set.coding,
        set.categories.join(UNIT),
        set.excluded.join(UNIT),
      ].join(RECORD),
    )
    .join(RECORD + RECORD);
  return sha256Hex(`qualitative-evidence-v1${RECORD}${canonical}`);
}

/**
 * Which of the four states this draft's qualitative review is in.
 *
 * The comparison is the whole of it: a sign-off is true while, and only while,
 * the categories still digest to what was signed. Nothing here reads a clock, so
 * a review does not expire with time — it expires when the words change.
 */
export function qualitativeReviewState(
  sets: readonly QualitativeCategorySet[],
  signOff: QualitativeSignOff | null,
): QualitativeReviewState {
  if (sets.length === 0) return "not_applicable";
  if (signOff === null) return "pending";
  return signOff.evidenceDigest === qualitativeEvidenceDigest(sets) ? "current" : "stale";
}


/**
 * The opaque identity of ONE group's exact words.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT IT IS FOR, AND WHY IT IS NOT THE EVIDENCE DIGEST.
 *
 * A sign-off has to be about the groups that were on screen, so a reviewer's
 * browser has to be able to say WHICH ONES. It says it with these: short,
 * base32, derived from the group's own label, coding and ordered category and
 * excluded labels — every one of which is printed in full on the page beneath
 * it, so a token discloses strictly nothing.
 *
 * IT IS NOT AND MUST NOT BECOME THE EVIDENCE DIGEST. Three differences, and
 * each of them is load-bearing:
 *
 *   * it is PER GROUP, so it can never stand for the whole set a sign-off is
 *     recorded against;
 *   * it is NOT HEXADECIMAL, so the browser boundary needs no exception for it
 *     — the rule is «no 64-hex value crosses», with no allowance, again;
 *   * and it is CHECKED, NEVER KEPT. The server mints the same tokens from the
 *     categories it just read and compares the sets; nothing derived from a
 *     submitted token is stored, compared against storage, or written into a
 *     publication record. What is recorded is `qualitativeEvidenceDigest` over
 *     the server's own read.
 *
 * The seed is domain-separated from the evidence digest's, so the two can never
 * be derived from one another even by accident.
 */
export function qualitativeGroupToken(set: QualitativeCategorySet): string {
  const UNIT = "\u001f";
  const RECORD = "\u001e";
  return opaqueIdentity(
    "q",
    [
      "qualitative-group-v1",
      set.groupLabel,
      set.coding,
      set.categories.join(UNIT),
      set.excluded.join(UNIT),
    ].join(RECORD),
    5,
  );
}

/**
 * Do these submitted tokens name EXACTLY the groups the server just read?
 *
 * Set equality, both directions, and duplicates collapse. A submitted set that
 * is missing a group means the reviewer did not see one that is bound now; a
 * submitted set with an extra means they saw one that is not. Either way the
 * categories moved between the reading and the click, and a sign-off about the
 * words on a screen nobody is looking at any more is not recorded.
 */
export function qualitativeTokensMatch(
  sets: readonly QualitativeCategorySet[],
  submitted: readonly string[],
): boolean {
  const expected = new Set(sets.map((set) => qualitativeGroupToken(set)));
  const given = new Set(submitted);
  if (expected.size !== given.size) return false;
  for (const token of expected) if (!given.has(token)) return false;
  return true;
}
