/**
 * THE FAMILY DIGEST — what «this decision was made about a different question»
 * is measured against.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY IT IS ITS OWN FILE.
 *
 * It needs the product's own synchronous SHA-256, which lives under
 * `src/lib/ingestion/canonical-commit/`. Everything the client-safe barrel
 * re-exports is one import away from a `"use client"` component, so putting
 * this beside the types would put a path from the review screen straight into
 * the canonical layer's import graph — which the boundary gate refuses by name.
 * `evidence-digest.ts` and `journey-pain-digest.ts` are split off for exactly
 * this reason and this is the same split.
 *
 * The barrel therefore does NOT re-export this file. Server modules import it
 * directly, offline gates import it directly, and a browser has no path to it.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT IS INSIDE THE DIGEST, AND WHAT IS DELIBERATELY OUTSIDE IT.
 *
 *   IN: the family's key, its coding provenance, and its whole VOCABULARY —
 *       every source label and every documented exclusion, folded and sorted.
 *       An ordinal or emergent category's meaning lives in its neighbours, so a
 *       decision taken over a different vocabulary is STALE rather than simply
 *       older, and a label added, removed or respelled must say so.
 *
 *   OUT: the COUNTS. Another person answering with a category that already
 *        existed changes no word anybody read. Expiring a decision for it would
 *        make the review go stale on almost every import for a reason nobody
 *        could act on — the same defect the permanent «pending» warning had,
 *        wearing different clothes. It is the identical rule
 *        `qualitativeEvidenceDigest` and `painSourceDigest` both follow.
 *
 *   OUT: the DISPLAY ORDER, which is by count and therefore moves whenever a
 *        count does. The vocabulary is sorted by codepoint here so the digest
 *        depends on the SET of words rather than on how many people chose each.
 *
 * THE SEPARATOR IS THE ASCII RECORD SEPARATOR, written as an escape rather than
 * as a literal byte, because a category label is the study's own Spanish and may
 * contain any printable character. A separator chosen from printable punctuation
 * lets two different vocabularies spell one string and collide into one digest,
 * which would make a decision about one silently count as a decision about the
 * other.
 */

import { sha256Hex } from "../ingestion/canonical-commit/sha256";
import { base32 } from "../publication/opaque";
import { foldCategoryLabel } from "./contract";

const RECORD = "";
const UNIT = "";

export type CategoryFamilyWords = {
  key: string;
  coding: string;
  /** Every source label the family carries, in any order. */
  sourceLabels: readonly string[];
  /** Every documented exclusion, in any order. */
  excludedLabels: readonly string[];
};

/** The SHA-256 a decision is stored against and compared with on every read. */
export function categorySourceDigest(words: CategoryFamilyWords): string {
  const folded = (labels: readonly string[]) =>
    [...new Set(labels.map(foldCategoryLabel).filter(Boolean))].sort().join(UNIT);
  return sha256Hex(
    [
      "category-source-v1",
      words.key,
      words.coding,
      folded(words.sourceLabels),
      folded(words.excludedLabels),
    ].join(RECORD),
  );
}

/**
 * The short opaque marker a browser is shown instead of the digest.
 *
 * Forty bits of the digest, base32. It is enough for a reviewer's screen to
 * show that a family is not the family they decided about, and the server never
 * accepts it back as evidence of anything — freshness is decided by comparing
 * two SERVER-COMPUTED digests, here and in the store. It is not hexadecimal,
 * because the browser-boundary gate refuses every 64-character hex run on a
 * rendered page and that rule is not narrowed for anything.
 */
export function categorySourceVersion(digest: string): string {
  const bytes = new Uint8Array(5);
  for (let index = 0; index < 5; index += 1) {
    bytes[index] = Number.parseInt(digest.slice(index * 2, index * 2 + 2), 16);
  }
  return `v${base32(bytes, 5)}`;
}
