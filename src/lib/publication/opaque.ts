/**
 * OPAQUE IDENTITIES — short, stable, base32, and deliberately not hexadecimal.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS EXISTS, AND WHY IT IS NOT A DIGEST.
 *
 * Two boundaries in this layer need a browser to be able to SAY WHICH THING it
 * is talking about — which qualitative group a reviewer read, which source pain
 * item they decided about — without holding a database identifier and without
 * holding a digest.
 *
 * The rule the browser boundary enforces is that NO 64-character hexadecimal
 * value crosses at all. That rule had an exception once, for the qualitative
 * evidence digest, and the exception is what this module removes: an identity
 * spelled in an alphabet containing `w`, `x`, `y` and `z` cannot match
 * `[0-9a-f]{64}` at any length, so a scan of a rendered page needs no
 * allowance for it and a person reading the page's source cannot mistake it for
 * a storage digest.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT AN IDENTITY IS ALLOWED TO BE, AND WHAT IT IS NEVER ALLOWED TO DO.
 *
 * It is derived from CONTENT THAT IS ALREADY ON THE PAGE — a group's own label
 * and its own category list, a source item's own identity — so it discloses
 * nothing that is not printed beneath it. It is stable, so a browser can echo
 * it and the server can recognise it.
 *
 * It is NEVER a value the server keeps, compares against storage, or writes
 * into a record. Every identity that arrives from a browser is re-derived here
 * from what the server just read, and the two sets are compared; a mismatch is
 * a refusal. What gets STORED is always the server's own full digest, computed
 * from the server's own read. So an identity is a way of saying «this one», and
 * it can never become a way of saying «and it is unchanged».
 *
 * Forty bits is the size, which is not a security parameter: an identity is
 * checked against a set the server built from its own read, so guessing one
 * buys nothing that being handed the list does not already buy.
 */

import { sha256Bytes } from "../ingestion/canonical-commit/sha256";

/**
 * RFC 4648 base32, lower-cased, padding dropped.
 *
 * It contains four letters past `f`, which is the property the whole module
 * rests on, and it needs no escaping in a URL, an HTML attribute or a JSON
 * string.
 */
export const OPAQUE_ALPHABET = "abcdefghijklmnopqrstuvwxyz234567";

/** Base32 of the first `bytes` bytes of `input`. Deterministic, no padding. */
export function base32(input: Uint8Array, bytes: number): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (let index = 0; index < bytes; index += 1) {
    value = (value << 8) | input[index];
    bits += 8;
    while (bits >= 5) {
      out += OPAQUE_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += OPAQUE_ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

/**
 * An opaque identity for one seed, under one prefix.
 *
 * The prefix is a short lower-case tag naming WHAT KIND of thing this
 * identifies, so a token from one boundary cannot be mistaken for one from
 * another by a reader or by a regular expression. The seed is domain-separated
 * by the caller — every caller starts it with its own version string — so two
 * boundaries hashing the same words never mint the same identity.
 */
export function opaqueIdentity(prefix: string, seed: string, bytes: number): string {
  return `${prefix}${base32(sha256Bytes(new TextEncoder().encode(seed)), bytes)}`;
}
