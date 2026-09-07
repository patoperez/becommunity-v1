/**
 * SESSION IDENTIFIERS — deterministic, collision-safe, and made of no clock.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY NOT `crypto.randomUUID()`.
 *
 * Three reasons, and the third is the one that actually bites.
 *
 *   1. A `PresentationDocument` id is an `identifier`: `^[a-z0-9][a-z0-9_-]*$`,
 *      at most 64 characters. A UUID's hyphens fit; its shape does not say what
 *      kind of thing it names, and every id in a document is read by a person
 *      before it is read by a machine.
 *
 *   2. The composer is a SERVER-RENDERED React tree that then hydrates. An id
 *      minted during render must be the same id on both sides or React replaces
 *      the subtree — and an id that changes between the two is a block whose
 *      filter connections point at a block that no longer exists.
 *
 *   3. A gate cannot assert anything about a random id. Every claim this unit
 *      makes about duplication, undo and connection cleanup is asserted by
 *      running an operation and comparing the result to a written-down answer.
 *      Randomness makes the answer unwritable.
 *
 * So an id is a HASH OF A SEED, and the seed is a sentence describing the act
 * that created the thing: `"panorama/block/added/7"`. Same document, same act,
 * same id, in Node, in a browser and in workerd — `Math.imul` is specified
 * 32-bit arithmetic, so the three runtimes agree bit for bit.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY A SEQUENCE NUMBER IS NOT ENOUGH, AND WHAT THE OLD BUILDER GOT WRONG.
 *
 * The legacy experience builder counted from zero every time it was OPENED. Two
 * sessions that both duplicated the same block minted the SAME id twice, the
 * document then held two blocks under one identifier, and the strict boundary
 * refused it. Because that is a property of the DOCUMENT and not of the
 * request, every subsequent save failed — for ever. It became a surface you
 * could keep working in and never save again.
 *
 * The fix is not a global counter: a global counter is a clock wearing a
 * different hat, and it would take determinism away to buy uniqueness that is
 * already available for free. Instead `mintFreeId` asks the DOCUMENT what is
 * taken and re-salts the seed — `seed~1`, `seed~2` — until the answer is free.
 * Given the same document and the same act the answer is still the same id
 * every time, which is exactly the property a gate needs.
 *
 * Unit 6B.1 stores nothing, so it cannot reproduce that defect. The design is
 * carried across anyway, because the unit that does store will inherit this
 * file and not the reasoning that produced it.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import type { PresentationDocument } from "../presentation";

/** What an id names. Two letters, so the prefix cannot be read as a word. */
export type ComposerIdKind = "page" | "block" | "route";

const KIND_PREFIX: Record<ComposerIdKind, string> = {
  page: "pg",
  block: "bk",
  route: "rt",
};

/** The grammar `document.ts` enforces. Repeated here so a mint can self-check. */
export const COMPOSER_ID_PATTERN = /^[a-z0-9][a-z0-9_-]*$/;

/* -------------------------------------------------------------------------- */
/* the hash                                                                    */
/* -------------------------------------------------------------------------- */

const FNV_PRIME = 0x01000193;

/**
 * FNV-1a over UTF-16 code units, byte-wise, at a caller-chosen offset basis.
 *
 * Both bytes of each code unit are folded in, so `"añ"` and `"an"` cannot
 * collide through a truncated low byte. `Math.imul` is used rather than `*`
 * because a 32-bit multiply overflows a double at the fourth round and JavaScript
 * would silently start losing the low bits — the same input would then hash
 * differently under an optimiser that kept more precision.
 */
function fnv1a(input: string, basis: number): number {
  let hash = basis >>> 0;
  for (let index = 0; index < input.length; index += 1) {
    const unit = input.charCodeAt(index);
    hash = Math.imul(hash ^ (unit & 0xff), FNV_PRIME) >>> 0;
    hash = Math.imul(hash ^ (unit >>> 8), FNV_PRIME) >>> 0;
  }
  return hash >>> 0;
}

/** Base-36, left-padded, so every chunk is exactly seven characters. */
function chunk(value: number): string {
  return value.toString(36).padStart(7, "0").slice(-7);
}

/**
 * Three independent hashes of the same seed, concatenated.
 *
 * One 32-bit hash is ~4.3e9 values; at a few hundred ids per document the
 * birthday probability is negligible but not zero, and `mintFreeId` would
 * silently paper over it by re-salting — turning a hash defect into a shrug.
 * Three different offset bases give ~95 bits, which makes a collision a thing
 * that does not happen rather than a thing that is handled.
 */
export function composerToken(seed: string): string {
  return chunk(fnv1a(seed, 0x811c9dc5)) + chunk(fnv1a(seed, 0x2fb1c1a3)) + chunk(fnv1a(seed, 0x7ab4f19d));
}

/* -------------------------------------------------------------------------- */
/* minting                                                                     */
/* -------------------------------------------------------------------------- */

/** `bk_9x2k4m1p0qz7v3n8y5r` — 24 characters, well inside the 64 the schema allows. */
export function composerId(kind: ComposerIdKind, seed: string): string {
  return `${KIND_PREFIX[kind]}_${composerToken(seed)}`;
}

/**
 * The number of re-salts before minting gives up.
 *
 * A document is capped at 64 pages of 256 blocks, so 512 alternatives cannot be
 * exhausted by legitimate content. Reaching the ceiling means the hash is
 * broken, and the honest response is to say so rather than to return a
 * duplicate that the schema will refuse later, further from the cause.
 */
const MAX_SALTS = 512;

/**
 * Every identifier the document currently holds, of every kind, in one pass.
 *
 * Pages, blocks and routes share one namespace here even though the schema
 * scopes them separately. That is deliberate: it costs nothing, and it means a
 * page and a block can never be confused for one another in a connection list
 * or in a gate's error message.
 */
export function takenComposerIds(document: PresentationDocument): Set<string> {
  const taken = new Set<string>();
  taken.add(document.id);
  for (const page of document.pages) {
    taken.add(page.id);
    for (const block of page.blocks) {
      taken.add(block.id);
      if (block.kind === "journey_routes") {
        for (const route of block.routes) taken.add(route.id);
      }
    }
  }
  return taken;
}

/**
 * Mint an id that is free, and stay deterministic while doing it.
 *
 * `taken` may be a plain set or a predicate. The predicate form exists for
 * page duplication, which mints many ids inside one operation and must not hand
 * out the same one twice before any of them has reached the document.
 */
export function mintFreeComposerId(
  kind: ComposerIdKind,
  seed: string,
  taken: Set<string> | ((id: string) => boolean),
): string {
  const isTaken = typeof taken === "function" ? taken : (id: string) => taken.has(id);
  for (let salt = 0; salt <= MAX_SALTS; salt += 1) {
    const candidate = composerId(kind, salt === 0 ? seed : `${seed}~${salt}`);
    if (!isTaken(candidate)) return candidate;
  }
  throw new Error(`composer: no free ${kind} id after ${MAX_SALTS} salts for seed "${seed}"`);
}

// A seed-returning mirror of `mintFreeComposerId` was written here and removed:
// the only caller that would have needed one is page duplication, and it holds
// ids rather than seeds because `duplicatePage` in `document.ts` asks for an id
// per block. An unused second salting path is a second place for the salting
// rule to be wrong.
