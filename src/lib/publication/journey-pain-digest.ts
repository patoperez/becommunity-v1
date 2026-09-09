/**
 * THE JOURNEY-PAIN IDENTITIES AND DIGESTS — the arithmetic half of the review.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY IT IS ITS OWN FILE.
 *
 * It needs the product's own synchronous SHA-256, which lives under
 * `src/lib/ingestion/canonical-commit/`. Everything the client-safe publication
 * barrel re-exports is one import away from a `"use client"` component, so
 * putting this beside the types would put a path from the review screen
 * straight into the canonical layer's import graph — which the boundary gate
 * refuses by name. `evidence-digest.ts` is split from `qualitative-signoff.ts`
 * for exactly this reason and this is the same split.
 *
 * The barrel therefore does NOT re-export this file. Server modules import it
 * directly, offline gates import it directly, and a browser has no path to it.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THREE VALUES, THREE DIFFERENT JOBS, AND ONLY TWO OF THEM MAY BE SEEN.
 *
 *   `painItemToken`     — an OPAQUE, stable identity for one source item. It
 *                         reaches the browser and is stored beside a decision.
 *   `painSourceDigest`  — a SHA-256 of the words a decision was made about. It
 *                         is stored and compared SERVER-SIDE and never crosses.
 *   `painSourceVersion` — a short opaque marker derived from that digest. It
 *                         reaches the browser so a reviewer can see an item
 *                         moved; it is far too short to be reversed into the
 *                         digest and is never accepted back as an assertion.
 *
 * NEITHER OF THE TWO THAT CROSS IS HEXADECIMAL, and that is on purpose. The
 * browser-boundary gate scans a rendered page for any 64-character hex run and
 * refuses ALL of them — a rule that was once narrowed to admit one digest and
 * is narrowed no longer. An identity encoded in base32 cannot be mistaken for a
 * storage digest by that scan or by a person reading a page's source.
 */

import { sha256Hex, toHex } from "../ingestion/canonical-commit/sha256";
import { OPAQUE_ALPHABET, base32, opaqueIdentity } from "./opaque";

/**
 * An opaque, stable identity for one source pain item.
 *
 * DERIVED FROM THE STUDY AND THE ROW TOGETHER, so the same row in two studies
 * — which cannot happen today and could after a copy — yields two tokens, and a
 * token from one study can never address an item in another. Eighty bits is
 * ample for a queue the database bounds at five hundred, and the token is never
 * the security boundary: the server resolves it against THIS study's own rows
 * and answers `unknown_item` for anything else.
 *
 * IT IS NOT REVERSIBLE INTO THE ROW ID, and it is not meant to be a secret
 * either. What it is, is not-an-identifier: a browser holding it holds a
 * position in a list this server built, not a key into a table.
 */
export function painItemToken(studyId: string, painPointId: string): string {
  return opaqueIdentity("pp", `pain-item-v1\u001e${studyId}\u001e${painPointId}`, 10);
}

/** The words one decision is about, as the digest sees them. */
export type PainSourceWords = {
  token: string;
  curatedPhrase: string;
  sourceContext: string;
  sourceStatus: string;
};

/**
 * The digest of the exact source an item's decision was made about.
 *
 * WHAT IS IN, AND WHAT IS DELIBERATELY OUT.
 *
 *   IN:  the item's own identity, the curated phrase, the source's stage
 *        wording and the source row's review status. Those are the four things
 *        a reviewer read before deciding, and a change to any of them means
 *        they decided about something else.
 *   OUT: the OCCURRENCE COUNT. Another workbook cell repeating a phrase somebody
 *        already approved adds no word to read. Expiring the decision for it
 *        would make the review go stale on almost every import for a reason
 *        nobody could act on — which is the same defect the permanent
 *        «pending» warning had, wearing different clothes. It is the identical
 *        rule `qualitativeEvidenceDigest` follows, and for the identical reason.
 *
 * THE SEPARATOR IS THE ASCII RECORD SEPARATOR, written as an escape rather than
 * as a literal byte, because a curated phrase is a consultant's own Spanish and
 * may contain any printable character. A separator chosen from printable
 * punctuation lets two different items spell one string and collide into one
 * digest, which would make a decision about one silently count as a decision
 * about the other.
 */
export function painSourceDigest(words: PainSourceWords): string {
  const RECORD = "\u001e";
  return sha256Hex(
    [
      "pain-source-v1",
      words.token,
      words.curatedPhrase,
      words.sourceContext,
      words.sourceStatus,
    ].join(RECORD),
  );
}

/**
 * The short opaque marker a browser is shown instead of the digest.
 *
 * Forty bits of the digest, base32. It is enough for a reviewer's screen to
 * show that an item is not the item they decided about, and the server never
 * accepts it back as evidence of anything — freshness is decided by comparing
 * two SERVER-COMPUTED digests, here and in the store.
 */
export function painSourceVersion(digest: string): string {
  const bytes = new Uint8Array(5);
  for (let index = 0; index < 5; index += 1) {
    bytes[index] = Number.parseInt(digest.slice(index * 2, index * 2 + 2), 16);
  }
  return `v${base32(bytes, 5)}`;
}

/** Exported for the gate that pins the encoding, and used by nothing else. */
export const PAIN_TOKEN_ALPHABET = OPAQUE_ALPHABET;

/** Exported so a gate can prove the digest helper agrees with the raw hash. */
export const painDigestHexOf = (bytes: Uint8Array): string => toHex(bytes);
