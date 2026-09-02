import { sha256Bytes, toHex } from "./sha256";

/**
 * Deterministic record identifiers.
 *
 * WHY THEY ARE DERIVED AND NOT RANDOM. The commit plan carries the primary key
 * of every row before any row exists, because lineage has to point at a record
 * that has not been written yet. If those keys were random, two projections of
 * the SAME bytes would differ, the plan fingerprint would differ with them, and
 * three promises this unit makes would break at once:
 *
 *   * a retry after a failure could not be proved to be the same package;
 *   * "the same two files in either order are the same package" would hold for
 *     the idempotency key and quietly fail for the plan;
 *   * a duplicate would be invisible — two commits would insert two sets of
 *     rows with different keys and no unique index would notice.
 *
 * Derived keys make all three structural: the same source bytes, mapping
 * version and record produce the same uuid, every time, on any machine.
 *
 * WHY UUID VERSION 8. RFC 9562 reserves version 8 for custom, implementation
 * defined layouts, which is exactly what this is: 122 bits taken from a
 * SHA-256 over the package key, the target table and the record's natural key.
 * Calling it version 4 would claim randomness that is not there, and version 5
 * would claim SHA-1, which this does not use.
 */

/** The number of bits actually taken from the digest. Version and variant fix six. */
export const DERIVED_UUID_ENTROPY_BITS = 122;

/**
 * The separator between the three parts of a derived key.
 *
 * U+001F (unit separator) can appear in neither the package key
 * (`sha256:<hex>`) nor a table name (`[a-z_]+`), so the boundaries stay
 * unambiguous however the natural key is spelled: `("a", "bc")` and
 * `("ab", "c")` cannot collapse onto one identifier. It is built from its code
 * point rather than written literally, so no control byte ever sits in a
 * source file the secret and diff scanners read.
 */
const SEPARATOR = String.fromCharCode(31);

function formatUuidV8(bytes: Uint8Array): string {
  const out = bytes.slice(0, 16);
  // Version 8 in the high nibble of byte 6; RFC 9562 variant (10xx) in byte 8.
  out[6] = (out[6] & 0x0f) | 0x80;
  out[8] = (out[8] & 0x3f) | 0x80;
  const hex = toHex(out);
  return (
    `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-` +
    `${hex.slice(16, 20)}-${hex.slice(20, 32)}`
  );
}

/**
 * A stable uuid for one canonical record.
 *
 * `scopeKey` is the package idempotency key TOGETHER WITH the tenant and study
 * the plan is for. The study is load-bearing: the package key is derived from
 * the mapping version, the roles and the file hashes, so the same two files
 * imported into a second study would otherwise derive the SAME primary key for
 * every row and collide on the first insert. Scoping by study keeps each
 * import's rows distinct while leaving genuinely shared records — a person, who
 * is tenant-scoped — to be matched by their natural key at commit time, which
 * is what the database's reuse path is for.
 *
 * `targetTable` separates a participant from the person behind it.
 * `naturalKey` is whatever makes the record unique WITHIN its table — the same
 * key the database's own unique constraint uses, so a collision here would
 * already have been a collision there.
 */
export function derivedRecordId(
  scopeKey: string,
  targetTable: string,
  naturalKey: string,
): string {
  const message = scopeKey + SEPARATOR + targetTable + SEPARATOR + naturalKey;
  return formatUuidV8(sha256Bytes(new TextEncoder().encode(message)));
}

/** True for the canonical 8-4-4-4-12 lowercase hexadecimal form. */
export function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value);
}
