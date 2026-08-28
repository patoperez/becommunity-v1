/**
 * Conservative normalisation, for FINDING candidates — never for merging them.
 *
 * THE ASYMMETRY THIS MODULE EXISTS TO ENFORCE. A missed alias is a question a
 * consultant never got asked. A false merge is a number a client acted on that
 * was never true. They are not the same size of mistake, so the two jobs are
 * kept in separate functions with separate names:
 *
 *   `foldSegmentValue` (src/lib/calc/segments.ts) is the MERGING fold. Case and
 *   whitespace only. It is applied automatically because nobody writing a
 *   questionnaire means "Legal y Contable" and "Legal y contable" as two
 *   answers. It is not redefined here, because widening it is a product
 *   decision with a client-visible consequence and it must stay in one place.
 *
 *   Everything below is a COMPARISON key. Two values sharing one is a question
 *   worth putting to a person. No caller may merge on the strength of one, and
 *   nothing here returns a notion of "confident enough".
 *
 * Every transformation is layered and named, so a candidate can always say
 * which rule produced it and a reviewer can judge that rule rather than a
 * similarity score.
 *
 * The original text is never altered, anywhere. These functions derive keys;
 * `respondent.segments` keeps exactly what was imported.
 *
 * WHY THE CHARACTER CLASSES ARE BUILT FROM CODEPOINT NUMBERS. Half of what this
 * module detects is invisible. A zero-width space written literally into a
 * character class looks like an empty class, survives code review, and is
 * deleted without trace by the next editor, formatter or copy-paste that
 * touches the file — leaving a regex that silently matches nothing. Numbers
 * cannot be lost that way, and they are greppable and reviewable besides. This
 * file is therefore pure ASCII apart from ordinary Spanish prose in comments.
 */

/** Inclusive codepoint range, as numbers. */
function range(from: number, to: number): number[] {
  return Array.from({ length: to - from + 1 }, (_, index) => from + index);
}

/**
 * A character class over exact codepoints.
 *
 * Every codepoint used below is above U+007F, so none of them is a regex
 * metacharacter and none needs escaping inside the class.
 */
function classOf(points: readonly number[]): RegExp {
  return new RegExp(`[${points.map((point) => String.fromCodePoint(point)).join("")}]`, "gu");
}

/**
 * Characters that carry no meaning and can arrive invisibly from a paste:
 * soft hyphen, zero-width space, zero-width non-joiner, zero-width joiner,
 * word joiner, byte-order mark.
 */
const INVISIBLE = classOf([0x00ad, 0x200b, 0x200c, 0x200d, 0x2060, 0xfeff]);

/**
 * Unicode spaces a spreadsheet export produces that are not U+0020: no-break
 * space, Ogham space mark, the U+2000-U+200A typographic run, narrow no-break
 * space, medium mathematical space, ideographic space.
 */
const EXOTIC_SPACE = classOf([0x00a0, 0x1680, ...range(0x2000, 0x200a), 0x202f, 0x205f, 0x3000]);

/** Combining diacritical marks, for the accent-insensitive key. */
const COMBINING_MARKS = classOf(range(0x0300, 0x036f));

/** How two values came to be compared. Ordered from most to least defensible. */
export type NormalizationRule =
  /** Different Unicode encodings of identical text. Semantics-preserving. */
  | "unicode"
  /** Letter case and surrounding/repeated whitespace. The automatic fold. */
  | "case_whitespace"
  /** Accent/diacritic differences. Meaning-bearing in Spanish. NOT automatic. */
  | "accent"
  /** Punctuation and symbol differences. */
  | "punctuation"
  /** Different words with a high measured similarity. Weakest evidence. */
  | "fuzzy";

/** Rules a reviewer may be shown without a similarity score attached. */
export const DETERMINISTIC_RULES: readonly NormalizationRule[] = [
  "unicode",
  "case_whitespace",
  "accent",
  "punctuation",
];

/**
 * How strong the evidence for a rule is, on its own.
 *
 * `unicode` and `case_whitespace` are provably semantics preserving: the two
 * strings are the same text, differently encoded or spaced. `accent` and
 * `punctuation` are NOT — "Publico" and "Público" are a plausible typo and also
 * two different words — so they are strong enough to raise as a question and
 * never strong enough to decide.
 */
export const RULE_STRENGTH: Record<NormalizationRule, "equivalent" | "strong" | "weak"> = {
  unicode: "equivalent",
  case_whitespace: "equivalent",
  accent: "strong",
  punctuation: "strong",
  fuzzy: "weak",
};

/**
 * Canonical Unicode form with invisible characters removed and exotic spaces
 * normalised to ordinary ones.
 *
 * NFC and not NFD: NFC is the form the web platform and PostgreSQL comparisons
 * assume, and composing is reversible in a way that decomposing-and-discarding
 * is not. Nothing meaningful is lost — "café" typed as `e` + U+0301 and as
 * U+00E9 are the same word, and every human-facing surface already treats them
 * so.
 */
export function canonicalText(raw: string): string {
  return raw.normalize("NFC").replace(INVISIBLE, "").replace(EXOTIC_SPACE, " ");
}

/** Trim, collapse runs of whitespace, and lowercase. Mirrors the merging fold. */
function caseSpaceKey(raw: string): string {
  return canonicalText(raw).trim().replace(/\s+/g, " ").toLocaleLowerCase("es-MX");
}

/** The case/space key with diacritics stripped. */
function accentKey(raw: string): string {
  return caseSpaceKey(raw).normalize("NFD").replace(COMBINING_MARKS, "");
}

/**
 * The accent key with punctuation and symbols removed.
 *
 * Digits and letters survive, so "51% a 100%" and "51 a 100" collapse together
 * while "51 a 100" and "61 a 100" never do. Values that are essentially numbers
 * are handled by `looksNumeric`, which the candidate stage uses to withhold
 * them from the fuzzy rule entirely.
 */
function punctuationKey(raw: string): string {
  return accentKey(raw)
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/**
 * Every comparison key for one raw value, strongest rule first.
 *
 * A caller compares values by walking these in order and stopping at the first
 * rule under which two values agree — so a pair is always attributed to the
 * STRONGEST rule that explains it, never to a weaker one that also would.
 */
export function comparisonKeys(raw: string): { rule: NormalizationRule; key: string }[] {
  const canonical = canonicalText(raw);
  return [
    // `unicode` compares the canonicalised text as written: two values that
    // differ only by encoding, an invisible character or an exotic space land
    // here. Case is still significant, so this rule never absorbs a case-only
    // pair that `case_whitespace` should explain.
    { rule: "unicode", key: canonical.trim() },
    { rule: "case_whitespace", key: caseSpaceKey(raw) },
    { rule: "accent", key: accentKey(raw) },
    { rule: "punctuation", key: punctuationKey(raw) },
  ];
}

/**
 * Whether two values differ ONLY by invisible characters or exotic spacing —
 * reported separately because a reviewer reads "these are indistinguishable on
 * screen" very differently from "these are the same text".
 */
export function differsOnlyByInvisibles(a: string, b: string): boolean {
  if (a === b) return false;
  return canonicalText(a) === canonicalText(b);
}

/**
 * Word tokens for similarity, with a crude Spanish-aware truncation.
 *
 * Spanish inflects heavily at the end of a word: "recuperé", "recuperado" and
 * "recuperar" share a stem that a whole-word comparison misses entirely, which
 * is precisely the pair this product exists to notice ("No recuperé nada" /
 * "No he recuperado nada"). Truncating to a prefix is not stemming and does not
 * pretend to be — it is a deliberately dumb, inspectable rule whose failure
 * mode is over-generation of QUESTIONS, never a merge.
 *
 * Tokens of five characters or fewer keep their full form: truncating "no" or
 * "nada" would collapse words that carry the entire meaning of an answer.
 */
export function similarityTokens(raw: string): string[] {
  return punctuationKey(raw)
    .split(" ")
    .filter(Boolean)
    .map((word) => (word.length > 5 ? word.slice(0, 5) : word));
}

/**
 * Jaccard overlap of the truncated token sets, 0..1.
 *
 * Chosen over edit distance as the primary signal because these are phrases,
 * not words: "No recuperé nada" and "No he recuperado nada" are many edits
 * apart but share most of their meaning-bearing tokens. Edit distance is
 * applied afterwards, by the caller, as a second opinion on short values.
 */
export function tokenSimilarity(a: string, b: string): number {
  const left = new Set(similarityTokens(a));
  const right = new Set(similarityTokens(b));
  if (left.size === 0 || right.size === 0) return 0;
  let shared = 0;
  for (const token of left) if (right.has(token)) shared += 1;
  return shared / (left.size + right.size - shared);
}

/** Beyond this length an edit distance costs more than it tells us. */
const MAX_EDIT_LENGTH = 120;

/**
 * Normalised Levenshtein similarity, 0..1, bounded deliberately.
 *
 * Values longer than `MAX_EDIT_LENGTH`, or whose lengths differ by more than
 * half the longer one, return 0 rather than costing O(n·m) on a free-text field
 * somebody mapped as a category by mistake. The caller treats 0 as "no fuzzy
 * evidence", which is the safe direction.
 */
export function editSimilarity(a: string, b: string): number {
  const left = punctuationKey(a);
  const right = punctuationKey(b);
  if (left === right) return 1;
  if (left.length === 0 || right.length === 0) return 0;
  if (left.length > MAX_EDIT_LENGTH || right.length > MAX_EDIT_LENGTH) return 0;
  if (Math.abs(left.length - right.length) > Math.max(left.length, right.length) / 2) return 0;

  let previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let i = 1; i <= left.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= right.length; j += 1) {
      const cost = left[i - 1] === right[j - 1] ? 0 : 1;
      current[j] = Math.min(current[j - 1] + 1, previous[j] + 1, previous[j - 1] + cost);
    }
    previous = current;
  }
  return 1 - previous[right.length] / Math.max(left.length, right.length);
}

/**
 * Whether two values carry different digits.
 *
 * The important case is ordinal scales. "51% a 100%" and "61% a 100%" are one
 * character apart and are different answers; "2025" and "2026" are two
 * different years. Textual similarity carries no information about a number, so
 * the candidate stage refuses to raise a fuzzy question when the difference is
 * in the digits. The deterministic rules may still raise such a pair, because a
 * pure encoding or spacing difference in a number is still an encoding
 * difference.
 */
export function digitsDiffer(a: string, b: string): boolean {
  const digitsOf = (value: string) => (canonicalText(value).match(/\p{Nd}/gu) ?? []).join("");
  return digitsOf(a) !== digitsOf(b);
}

/**
 * A value that reads as a number, a range or a percentage rather than a phrase.
 *
 * "51% a 100%", "+100%", "2026" and "1 a 5" are numbers with decoration. A
 * value carrying more than three letters is a phrase, whatever digits it also
 * contains.
 */
export function looksNumeric(raw: string): boolean {
  const text = canonicalText(raw).trim();
  if (text === "") return false;
  if (!/\p{Nd}/u.test(text)) return false;
  return (text.match(/\p{L}/gu) ?? []).length <= 3;
}
