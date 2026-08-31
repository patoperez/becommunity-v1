/**
 * The two stamps a publication is built on, and what each one is a statement
 * about.
 *
 * `definitionHash` NAMES AN ARRANGEMENT. SHA-256 over the canonical, key-sorted
 * serialization in `serialize.ts` — the same bytes the database stores, so the
 * hash a review screen quotes is the hash of the document that would actually
 * be served. It replaces nothing: `definitionSignature` in `serialize.ts` stays
 * where it is and stays a 14-character FNV token, because it is used for cheap
 * "did this change" comparisons inside one request and a cryptographic digest
 * would be a slower answer to a question that never leaves the process.
 *
 * This one is different because it OUTLIVES the request. It is written into an
 * immutable row, printed on a history screen, quoted in a report, and compared
 * years later against a document somebody exported. FNV collides by design —
 * it is a naming function, and its author says so — and "the delivered report
 * and this draft are the same arrangement" is not a claim to make on a 32-bit
 * hash pair. It is still not a security primitive: it authenticates nobody. It
 * is an identity that two independent parties can compute and compare.
 *
 * `studyFingerprint` NAMES WHAT THE ARRANGEMENT WAS REVIEWED AGAINST. A page is
 * approved over THESE results, with THESE names, under THIS disclosure rule,
 * grouped by THESE category decisions. Change any of them and the approval is
 * about something that is no longer on screen. Recording it makes "the study's
 * configuration moved since this was prepared" a fact somebody can be shown
 * rather than a thing nobody notices.
 *
 * WHY BOTH ARE ASYNC. `crypto.subtle.digest` is the one SHA-256 available in
 * all three runtimes this code has to work in — Node, the browser, and workerd
 * — and it is a promise everywhere. `src/lib/ingestion/mapping.ts` already
 * takes the same shape for the import source signature; this follows it rather
 * than introducing a second convention.
 */

import type { ExperienceDefinitionV1 } from "./definition";
import type { SampleVisibilityPolicy } from "./sample-policy";
import { serializeExperienceDefinition } from "./serialize";

/** Lower-case hex, 64 characters. The one shape every stored hash has. */
export const SHA256_HEX = /^[0-9a-f]{64}$/;

/** A study fingerprint, as stored: a prefixed digest, 71 characters. */
export const STUDY_FINGERPRINT_PATTERN = /^sha256:[0-9a-f]{64}$/;

export async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * The canonical hash of one definition.
 *
 * Over the WHOLE document, deliberately. It is tempting to exclude the `review`
 * and `publication` sub-objects as editor bookkeeping, and that would make the
 * hash a statement about "the arrangement" rather than "the document" — but
 * what is frozen, stored and served is the document, and a hash that covers
 * less than what is stored cannot prove that what is stored is what was
 * reviewed. The structural diff is where bookkeeping is ignored, because there
 * the question genuinely is "what changed for a reader".
 */
export function definitionHash(definition: ExperienceDefinitionV1): Promise<string> {
  return sha256Hex(serializeExperienceDefinition(definition));
}

/**
 * What a review was carried out against.
 *
 * `registryVersion` already stamps the results and characteristics the study
 * produces and what they are called. The sample policy and the category
 * grouping are the other two inputs to a number a client reads, and neither is
 * part of the registry stamp.
 */
export type StudyFingerprintInput = {
  registryVersion: string;
  samplePolicy: SampleVisibilityPolicy;
  /**
   * A stamp over the category decisions the numbers are grouped by.
   *
   * TODAY EVERY CALLER PASSES NULL, AND THAT IS CORRECT RATHER THAN A GAP. The
   * registry is built from `loadStudyRows`, which returns segment values
   * ALREADY canonicalized by the category review — so a grouping decision
   * changes the dimension values, which changes `registryVersion`, which is
   * already in this stamp. Adding a second read of the alias configuration
   * would cost a query to restate a fact the first field carries.
   *
   * The field stays because the day grouping stops being visible in the
   * registry — a decision that merges two values into one label without
   * changing the set, say — it must be possible to add it here without changing
   * the shape of every stored fingerprint. Null is recorded as "none" rather
   * than skipped, so introducing a real signature changes the stamp.
   */
  categorySignature: string | null;
};

export async function studyFingerprint(input: StudyFingerprintInput): Promise<string> {
  const canonical = JSON.stringify([
    "becommunity/experience/study-fingerprint/v1",
    input.registryVersion,
    input.samplePolicy.policyVersion,
    input.samplePolicy.mode,
    input.samplePolicy.threshold,
    input.categorySignature ?? "none",
  ]);
  return `sha256:${await sha256Hex(canonical)}`;
}

/** The first eight characters, for a screen. Never for a comparison. */
export function shortHash(hash: string): string {
  const bare = hash.startsWith("sha256:") ? hash.slice("sha256:".length) : hash;
  return bare.slice(0, 8);
}

// ---------------------------------------------------------------------------
// Idempotency keys
// ---------------------------------------------------------------------------

/**
 * What makes two attempts THE SAME attempt.
 *
 * A key is derived from the INTENT rather than generated at random, and that is
 * the decision worth explaining. A random key would make a browser's automatic
 * retry — the one nobody asked for, after a connection dropped between the
 * write landing and the response arriving — a second, different publication.
 * Deriving it means the retry carries the key the first attempt used, finds the
 * event that attempt wrote, and returns it.
 *
 * It also means two DELIBERATELY different acts cannot collide, because
 * everything that makes them different is in the key:
 *
 *   preparing    which study, which draft revision, which exact document, and
 *                which warnings were acknowledged — so acknowledging one more
 *                warning and preparing again is a new revision, not a silent
 *                replay of the old one;
 *   publishing   which study, which revision, and what was active before it —
 *                so publishing the same revision again after a rollback is a
 *                new act, while pressing the button twice is not.
 *
 * The shape matches the database's own check: letters, digits and
 * `_ . : -`, between 8 and 120 characters.
 */
export const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9_.:-]{8,120}$/;

export async function prepareIdempotencyKey(input: {
  studyId: string;
  sourceDraftRevision: number;
  definitionSha256: string;
  acknowledgedWarnings: readonly string[];
}): Promise<string> {
  const ack = await sha256Hex([...input.acknowledgedWarnings].sort().join(","));
  return [
    "prep",
    input.studyId,
    String(input.sourceDraftRevision),
    input.definitionSha256.slice(0, 16),
    ack.slice(0, 8),
  ].join(":");
}

export function selectionIdempotencyKey(input: {
  kind: "pub" | "rst";
  studyId: string;
  revisionId: string;
  expectedActiveRevisionId: string | null;
}): string {
  return [
    input.kind,
    input.studyId,
    input.revisionId,
    input.expectedActiveRevisionId ?? "none",
  ].join(":");
}
