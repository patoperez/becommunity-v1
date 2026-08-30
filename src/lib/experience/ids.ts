/**
 * Identifiers for everything the composer can create.
 *
 * THREE PROPERTIES, AND THEY ARE NOT NEGOTIABLE.
 *
 *  1. OPAQUE. An identifier is a hash, not a slug. The moment an id is derived
 *     from a visible label, renaming the block silently repoints every filter
 *     connection, every journey moment and every published snapshot that named
 *     it — the exact defect the recorrido editor already had to be rescued from
 *     (`src/lib/studio/journey-picker.ts`). Here it is prevented at the source:
 *     the label is never an input to the identifier.
 *
 *  2. STABLE. An id is minted once, from a SEED the caller controls, and the
 *     same seed always produces the same id. That is what lets the
 *     compatibility adapter be deterministic: the same legacy study adapted
 *     twice produces byte-identical output, so a diff between two runs shows
 *     real change rather than fresh randomness.
 *
 *  3. FREE OF CLOCKS AND ENTROPY. No `Date.now()`, no `Math.random()`, no
 *     `crypto.randomUUID()`. A server render and a client hydration must agree
 *     on the identifier of the same block, and a gate must be able to assert an
 *     exact document without freezing time.
 *
 * The hash is FNV-1a over 32-bit words, three times with different seeds. It is
 * a NAMING function, never a security primitive: it authenticates nothing and
 * protects nothing. What makes an id safe to trust is that the server validates
 * it against the definition it belongs to — never that it is hard to guess.
 *
 * Thirty-two-bit arithmetic rather than BigInt, deliberately: the project
 * compiles to ES2017, `Math.imul` is exact at every input, and the result is
 * identical in Node, in a browser and in workerd.
 */

const FNV_OFFSET = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

/** Every kind of thing the composer names, and its prefix. */
export const ID_KINDS = {
  experience: "ex",
  page: "pg",
  block: "bk",
  filter: "fl",
  connection: "cn",
  journey: "jr",
  moment: "jm",
  /** A reusable semáforo scheme, and one band inside one. */
  band: "bs",
  bandpart: "bp",
} as const;

export type IdKind = keyof typeof ID_KINDS;

/** Three 32-bit words, seven base-36 characters each. Fixed width, always. */
const WORD_LENGTH = 7;
const TOKEN_LENGTH = WORD_LENGTH * 3;

export const EXPERIENCE_ID_PATTERN = new RegExp(
  `^(?:${Object.values(ID_KINDS).join("|")})_[0-9a-z]{${TOKEN_LENGTH}}$`,
);

function fnv1a32(input: string, seed: number): number {
  let hash = seed >>> 0;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, FNV_PRIME) >>> 0;
  }
  return hash >>> 0;
}

function word(input: string, seed: number): string {
  return fnv1a32(input, seed).toString(36).padStart(WORD_LENGTH, "0").slice(-WORD_LENGTH);
}

/**
 * Mint the identifier for one thing.
 *
 * `seed` is whatever the CALLER considers the stable identity of the object —
 * a legacy study id plus a section name for the adapter, a source id plus a
 * monotonic counter for a duplicate. It is hashed, never stored, and never
 * recoverable from the result.
 */
export function mintId(kind: IdKind, seed: string): string {
  const salted = `becommunity/experience/v1/${kind}/${seed}`;
  const token =
    word(salted, FNV_OFFSET)
    + word(`${salted}#2`, FNV_OFFSET ^ 0x5bf03635)
    + word(`${salted}#3`, FNV_OFFSET ^ 0x27d4eb2f);
  return `${ID_KINDS[kind]}_${token}`;
}

/**
 * The same identifier, moved aside until it is free in the document it is
 * joining.
 *
 * THIS EXISTS BECAUSE A SEED IS ONLY AS UNIQUE AS THE COUNTER IN IT. The
 * editor's `sequence` starts at zero every time the builder is OPENED, so
 * duplicating the same block, or adding a block to the same page, in two
 * different sessions minted the SAME id twice. The document then held two
 * blocks with one identifier, the strict boundary refused it with "repeated
 * block", and — because the refusal is a property of the document rather than
 * of the request — every subsequent save failed too. The builder became a
 * surface somebody could keep working in and never save again.
 *
 * The counter is not made global, because a global counter is a clock by
 * another name and would destroy the determinism the adapter and the gates
 * depend on. Instead the caller says which identifiers are already taken, and
 * the seed is salted until it is free. Given the same document and the same
 * operation the answer is still the same id, every time.
 */
export function mintFreeId(kind: IdKind, seed: string, taken: (id: string) => boolean): string {
  const first = mintId(kind, seed);
  if (!taken(first)) return first;
  for (let attempt = 1; attempt <= 512; attempt += 1) {
    const candidate = mintId(kind, `${seed}~${attempt}`);
    if (!taken(candidate)) return candidate;
  }
  // Unreachable in practice: the document's own ceilings are far below 512
  // collisions on one seed. Returning the last candidate rather than throwing
  // keeps a pure function pure; the schema still refuses a duplicate.
  return mintId(kind, `${seed}~overflow`);
}

/** Whether a value is a well-formed identifier, optionally of one exact kind. */
export function isExperienceId(value: unknown, kind?: IdKind): boolean {
  if (typeof value !== "string") return false;
  if (!EXPERIENCE_ID_PATTERN.test(value)) return false;
  return kind ? value.startsWith(`${ID_KINDS[kind]}_`) : true;
}

/** The kind an identifier declares, or null when it declares none. */
export function idKindOf(value: string): IdKind | null {
  if (!isExperienceId(value)) return null;
  const prefix = value.slice(0, value.indexOf("_"));
  const found = Object.entries(ID_KINDS).find(([, code]) => code === prefix);
  return found ? (found[0] as IdKind) : null;
}

/** The same hash, for callers that need a stamp rather than an identifier. */
export function stableToken(seed: string): string {
  return word(seed, FNV_OFFSET) + word(`${seed}#2`, FNV_OFFSET ^ 0x5bf03635);
}
