/**
 * Finding the categories a person might read as one and the product counts as
 * two — and stopping there.
 *
 * NOTHING IN THIS FILE MERGES ANYTHING. Every function returns questions. The
 * only thing that groups two categories is a person's recorded decision
 * (src/lib/categories/decisions.ts), and the only thing that changes a number
 * is that decision's projection.
 *
 * WHY CANDIDATES ARE NOT RANKED HERE. A review queue sorted by string distance
 * puts the most linguistically interesting pair first, which is not the same as
 * the pair most likely to change what a client decides. Four members miscounted
 * in a chapter of sixty is a real defect; two spellings used once each, in a
 * characteristic nothing is broken down by, is housekeeping. Ranking is applied
 * by `src/lib/categories/impact.ts` over the groups this module produces.
 *
 * BOUNDS ARE PART OF THE CONTRACT. A column somebody mapped as a category by
 * mistake — a free-text comment, an email address, a timestamp — has as many
 * distinct values as it has rows. Comparing those pairwise is quadratic on data
 * the product cannot refuse at import time, so every stage here is either
 * linear or explicitly capped, and the caller is TOLD when a cap was reached
 * rather than being handed a short list that looks complete.
 */

import { foldSegmentValue, type SegmentAliases } from "@/lib/calc/segments";
import {
  RULE_STRENGTH,
  comparisonKeys,
  digitsDiffer,
  editSimilarity,
  looksNumeric,
  similarityTokens,
  tokenSimilarity,
  type NormalizationRule,
} from "./normalize";

// ---------------------------------------------------------------------------
// Bounds
// ---------------------------------------------------------------------------

/** Beyond this many distinct values, a characteristic is not a category. */
export const MAX_DISTINCT_VALUES = 400;
/** Fuzzy comparison is withheld above this, and the caller is told why. */
export const MAX_FUZZY_VALUES = 150;
/** Hard ceiling on fuzzy pair comparisons, whatever the blocking produces. */
export const MAX_FUZZY_PAIRS = 20_000;
/** A group larger than this is a sign the rule is wrong, not a big category. */
export const MAX_GROUP_MEMBERS = 12;
/** The group key stored on a decision. Bounded so it stays btree-indexable. */
export const MAX_GROUP_KEY_LENGTH = 2000;

/** Token overlap at or above this raises a fuzzy question. */
export const FUZZY_TOKEN_THRESHOLD = 0.6;
/** Edit similarity at or above this raises one, for short values. */
export const FUZZY_EDIT_THRESHOLD = 0.82;
/** Above this length, values are judged on tokens only. */
export const SHORT_VALUE_LENGTH = 24;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** One raw spelling and how many respondents carry it. */
export type CategoryValue = { raw: string; count: number };

export type CandidateWarning =
  | "numeric_values"
  | "single_respondent"
  | "long_values"
  | "many_members"
  | "ordinal_neighbours";

export type CandidateGroup = {
  /** Stable identity: the sorted folded members. Same members, same key. */
  groupKey: string;
  dimensionKey: string;
  /** The strongest rule that explains why these values were put together. */
  rule: NormalizationRule;
  strength: "equivalent" | "strong" | "weak";
  /** Members, most-used first. Always at least two. */
  values: CategoryValue[];
  /** Only meaningful for `fuzzy`; null for every deterministic rule. */
  similarity: number | null;
  /** The label proposed if a person chooses to group. Never applied by itself. */
  suggestedLabel: string;
  /** Respondents across every member. */
  affectedCount: number;
  warnings: CandidateWarning[];
};

export type CandidateScan = {
  dimensionKey: string;
  groups: CandidateGroup[];
  /** Distinct non-empty values the characteristic carries. */
  distinctValues: number;
  /** True when the characteristic was too wide to scan as a category at all. */
  tooWide: boolean;
  /** True when fuzzy comparison was withheld because of a bound. */
  fuzzyWithheld: boolean;
  /** Plain-language reason a bound was reached, or null. */
  boundNote: string | null;
};

// ---------------------------------------------------------------------------
// Value inventory
// ---------------------------------------------------------------------------

/**
 * Distinct raw values per characteristic, with respondent counts.
 *
 * Blank values are skipped, not counted as a category: "did not answer" is an
 * absence, and offering it for merging would invite somebody to fold it into a
 * real answer and turn silence into agreement.
 */
export function inventoryValues(
  respondents: readonly { segments: Record<string, unknown> | null }[],
): Map<string, Map<string, number>> {
  const byKey = new Map<string, Map<string, number>>();
  for (const respondent of respondents) {
    for (const [key, value] of Object.entries(respondent.segments ?? {})) {
      if (value == null) continue;
      const raw = String(value);
      if (raw.trim() === "") continue;
      const counts = byKey.get(key) ?? new Map<string, number>();
      counts.set(raw, (counts.get(raw) ?? 0) + 1);
      byKey.set(key, counts);
    }
  }
  return byKey;
}

/**
 * The group key: a JSON array of the members' folds, sorted.
 *
 * It is the identity a decision is recorded against, so it must not change when
 * the same two values are re-detected under a different rule, in a different
 * order, or after one of them gains a respondent. Folds rather than raw values,
 * so a study that later receives "LEGAL Y CONTABLE" is not treated as a
 * different question from the one already answered.
 *
 * JSON rather than a delimiter, because a category is arbitrary text and there
 * is no character it cannot contain. `["a b","c"]` and `["a","b c"]` are
 * distinct keys; a joined string would make them identical. It also stays
 * readable in a database row, which a control character does not.
 */
export function groupKeyFor(values: readonly string[]): string {
  const folds = [...new Set(values.map(foldSegmentValue).filter(Boolean))].sort();
  return JSON.stringify(folds).slice(0, MAX_GROUP_KEY_LENGTH);
}

/** The folded members a group key names, for display when raw values are gone. */
export function groupKeyMembers(groupKey: string): string[] {
  try {
    const parsed: unknown = JSON.parse(groupKey);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((value): value is string => typeof value === "string");
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Deterministic grouping
// ---------------------------------------------------------------------------

/**
 * Bucket values by each comparison key in turn, strongest rule first, and emit
 * a group the first time a rule explains a collision.
 *
 * Linear in the number of distinct values per rule — four passes over a hash
 * map, no pair comparison at all. A value already explained by a stronger rule
 * is removed from consideration, so the same pair is never raised twice under
 * two rules and the reviewer always sees the best available reason.
 */
function deterministicGroups(
  dimensionKey: string,
  counts: Map<string, number>,
  alreadyGrouped: ReadonlySet<string>,
): CandidateGroup[] {
  const groups: CandidateGroup[] = [];
  const claimed = new Set(alreadyGrouped);

  for (const rule of ["unicode", "case_whitespace", "accent", "punctuation"] as const) {
    const buckets = new Map<string, string[]>();
    for (const raw of counts.keys()) {
      if (claimed.has(foldSegmentValue(raw))) continue;
      const entry = comparisonKeys(raw).find((candidate) => candidate.rule === rule);
      if (!entry || entry.key === "") continue;
      const bucket = buckets.get(entry.key) ?? [];
      bucket.push(raw);
      buckets.set(entry.key, bucket);
    }

    for (const members of buckets.values()) {
      if (members.length < 2) continue;
      // Two spellings that FOLD together are already one category everywhere in
      // the product. Raising them would ask a person to approve something that
      // has already happened, which teaches them the queue is noise. Only a
      // bucket spanning more than one fold is a real question.
      if (new Set(members.map(foldSegmentValue)).size < 2) continue;
      if (members.length > MAX_GROUP_MEMBERS) continue;

      groups.push(buildGroup(dimensionKey, rule, members, counts, null));
      for (const raw of members) claimed.add(foldSegmentValue(raw));
    }
  }
  return groups;
}

// ---------------------------------------------------------------------------
// Fuzzy grouping
// ---------------------------------------------------------------------------

/**
 * Blocked pair generation: only values sharing a leading or longest token are
 * ever compared.
 *
 * Without blocking this is O(n^2) on a set the product cannot bound at import
 * time. With it, a value is compared only against values that already look
 * related, and the total is capped besides. The cost is missing a pair that
 * shares no significant token — an acceptable loss for a stage whose output is
 * a question, and one the deterministic rules do not share.
 */
function fuzzyPairs(values: readonly string[]): [string, string][] {
  const blocks = new Map<string, string[]>();
  for (const raw of values) {
    const tokens = similarityTokens(raw);
    const longest = tokens.reduce((best, token) => (token.length > best.length ? token : best), "");
    for (const block of new Set([tokens[0] ?? "", longest].filter(Boolean))) {
      const bucket = blocks.get(block) ?? [];
      bucket.push(raw);
      blocks.set(block, bucket);
    }
  }

  const seen = new Set<string>();
  const pairs: [string, string][] = [];
  for (const bucket of blocks.values()) {
    if (bucket.length < 2) continue;
    for (let i = 0; i < bucket.length; i += 1) {
      for (let j = i + 1; j < bucket.length; j += 1) {
        if (pairs.length >= MAX_FUZZY_PAIRS) return pairs;
        const pair: [string, string] =
          bucket[i] < bucket[j] ? [bucket[i], bucket[j]] : [bucket[j], bucket[i]];
        const id = JSON.stringify(pair);
        if (seen.has(id)) continue;
        seen.add(id);
        pairs.push(pair);
      }
    }
  }
  return pairs;
}

/**
 * Words that flip an answer's meaning rather than reword it.
 *
 * Deliberately a short, literal list rather than anything clever. Spanish
 * first, since that is what the instruments are written in, with the two
 * English equivalents that appear in mixed exports. A list is inspectable and
 * its failure mode is a missed question; a cleverer test's failure mode is a
 * merged negation.
 */
const NEGATIONS = new Set([
  "no",
  "nunca",
  "jamas",
  "ningun",
  "ningu",
  "sin",
  "tampoco",
  "not",
  "never",
  "none",
]);

/** Whether exactly one of the two values is negated. */
function negationAsymmetry(a: string, b: string): boolean {
  const negated = (value: string) => similarityTokens(value).some((token) => NEGATIONS.has(token));
  return negated(a) !== negated(b);
}

/**
 * Fuzzy candidates: pairs of CATEGORIES, never of spellings, and never chains.
 *
 * IT COMPARES FOLDS, NOT RAW VALUES, AND THAT IS THE WHOLE POINT. "Legal y
 * Contable" and "Legal y contable" are two spellings the automatic fold has
 * already made one category. Comparing raw values would find them highly
 * similar — they are, they are the same words — and raise a question that has
 * no answer: agreeing changes nothing, because they are already grouped. A
 * queue full of those teaches a reviewer to stop reading it. So each fold
 * contributes exactly one comparison subject, and a pair is only ever between
 * two DIFFERENT categories.
 *
 * A group carries every raw spelling of both folds, so one decision covers all
 * of them rather than leaving a variant behind.
 *
 * Pairs only, never transitive chains: a chain would let A~B and B~C silently
 * propose that A and C are one answer, which is how an ordinal scale collapses
 * into a single band. A consultant who wants three groups together says so
 * three times, deliberately.
 */
function fuzzyGroups(
  dimensionKey: string,
  counts: Map<string, number>,
  claimed: ReadonlySet<string>,
): CandidateGroup[] {
  // fold -> every raw spelling of it, and the fold's total respondents.
  const byFold = new Map<string, { raws: string[]; total: number }>();
  for (const [raw, count] of counts) {
    const fold = foldSegmentValue(raw);
    if (!fold || claimed.has(fold)) continue;
    const entry = byFold.get(fold) ?? { raws: [], total: 0 };
    entry.raws.push(raw);
    entry.total += count;
    byFold.set(fold, entry);
  }

  // One subject per category: the spelling most respondents used, ties broken
  // lexicographically so the comparison never depends on row order.
  const subjectOf = new Map<string, string>();
  for (const [fold, entry] of byFold) {
    subjectOf.set(
      fold,
      [...entry.raws].sort(
        (a, b) => (counts.get(b) ?? 0) - (counts.get(a) ?? 0) || (a < b ? -1 : 1),
      )[0],
    );
  }
  const foldOfSubject = new Map([...subjectOf].map(([fold, subject]) => [subject, fold]));

  const groups: CandidateGroup[] = [];
  for (const [a, b] of fuzzyPairs([...subjectOf.values()])) {
    const foldA = foldOfSubject.get(a);
    const foldB = foldOfSubject.get(b);
    // Defensive: subjects are one per fold, so this cannot fire. If it ever
    // did, it would mean raising a settled question, so it refuses instead.
    if (!foldA || !foldB || foldA === foldB) continue;

    // A NUMBER IS NOT A WORD. If two phrases differ in their digits, the digits
    // are what distinguishes them — "51% a 100%" and "61% a 100%", "1 a 5
    // empleados" and "6 a 50 empleados", "2025" and "2026". Textual similarity
    // carries no information whatever about a number, so it is not allowed to
    // speak here. Measured: this alone removes a false proposal the evaluation
    // fixture caught, and removes no true alias from it, because two wordings
    // of one answer essentially never disagree about a quantity.
    //
    // The deterministic rules are deliberately still free to raise such a pair:
    // an encoding or spacing difference inside a number is still an encoding
    // difference, and that is a fact about the text rather than a guess.
    if (digitsDiffer(a, b)) continue;

    // A NEGATION IS NOT A REWORDING. "Lo recomendaría" and "No lo recomendaría"
    // share every token but one and mean opposite things — the single most
    // damaging false proposal this queue could make, because it is also the
    // most plausible-looking. When one side carries a negation and the other
    // does not, the resemblance is withheld.
    //
    // Symmetry is what makes this safe for the real case: "No he recuperado
    // nada" and "No recuperé nada" are BOTH negative, so the guard does not
    // apply and the pair is still raised.
    if (negationAsymmetry(a, b)) continue;

    const tokens = tokenSimilarity(a, b);
    const short = a.length <= SHORT_VALUE_LENGTH && b.length <= SHORT_VALUE_LENGTH;
    const edits = short ? editSimilarity(a, b) : 0;
    if (!(tokens >= FUZZY_TOKEN_THRESHOLD || (short && edits >= FUZZY_EDIT_THRESHOLD))) continue;

    const members = [...(byFold.get(foldA)?.raws ?? []), ...(byFold.get(foldB)?.raws ?? [])];
    if (members.length > MAX_GROUP_MEMBERS) continue;
    groups.push(buildGroup(dimensionKey, "fuzzy", members, counts, Math.max(tokens, edits)));
  }

  return groups.sort((left, right) => (right.similarity ?? 0) - (left.similarity ?? 0));
}

// ---------------------------------------------------------------------------
// Group construction
// ---------------------------------------------------------------------------

function buildGroup(
  dimensionKey: string,
  rule: NormalizationRule,
  members: readonly string[],
  counts: Map<string, number>,
  similarity: number | null,
): CandidateGroup {
  const values: CategoryValue[] = members
    .map((raw) => ({ raw, count: counts.get(raw) ?? 0 }))
    .sort((a, b) => b.count - a.count || (a.raw < b.raw ? -1 : 1));

  const warnings: CandidateWarning[] = [];
  if (values.some((value) => looksNumeric(value.raw))) warnings.push("numeric_values");
  if (values.every((value) => value.count <= 1)) warnings.push("single_respondent");
  if (values.some((value) => value.raw.length > 80)) warnings.push("long_values");
  if (values.length > 3) warnings.push("many_members");
  // Two values differing only in their digits sit next to each other on a scale
  // far more often than they are the same answer.
  if (values.length === 2 && digitsDiffer(values[0].raw, values[1].raw)) {
    warnings.push("ordinal_neighbours");
  }

  return {
    groupKey: groupKeyFor(members),
    dimensionKey,
    rule,
    strength: RULE_STRENGTH[rule],
    values,
    similarity,
    // The wording most respondents actually used, with the lexicographically
    // smallest breaking a tie so the proposal never depends on row order.
    suggestedLabel: values[0].raw,
    affectedCount: values.reduce((total, value) => total + value.count, 0),
    warnings,
  };
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/**
 * Scan one characteristic for candidates.
 *
 * `aliases` are the study's already-recorded groupings. Values a decision has
 * already put together are not re-offered: a question that has been answered is
 * not a question, and re-asking it is how a reviewer learns to click past this
 * screen.
 */
export function scanDimension(
  dimensionKey: string,
  counts: Map<string, number>,
  aliases: SegmentAliases = {},
): CandidateScan {
  const distinctValues = counts.size;
  if (distinctValues > MAX_DISTINCT_VALUES) {
    return {
      dimensionKey,
      groups: [],
      distinctValues,
      tooWide: true,
      fuzzyWithheld: true,
      boundNote:
        `Esta característica tiene ${distinctValues} respuestas distintas. Con tantas no es ` +
        "una categoría: casi siempre es texto libre o un dato de identificación mapeado por " +
        "error. Revisa cómo se importó la columna antes de agrupar nada.",
    };
  }

  // Folds already unified by a recorded decision, so a settled question is not
  // presented as an open one.
  const configured = aliases[dimensionKey] ?? {};
  const byLabel = new Map<string, string[]>();
  for (const [fold, label] of Object.entries(configured)) {
    byLabel.set(label, [...(byLabel.get(label) ?? []), fold]);
  }
  const claimed = new Set<string>();
  for (const folds of byLabel.values()) {
    if (folds.length > 1) for (const fold of folds) claimed.add(fold);
  }

  const groups = deterministicGroups(dimensionKey, counts, claimed);
  for (const group of groups) {
    for (const value of group.values) claimed.add(foldSegmentValue(value.raw));
  }

  const fuzzyWithheld = distinctValues > MAX_FUZZY_VALUES;
  const fuzzy = fuzzyWithheld ? [] : fuzzyGroups(dimensionKey, counts, claimed);

  return {
    dimensionKey,
    // THE INVARIANT, ENFORCED ONCE, AT THE EXIT. A candidate must join at least
    // two categories that are not already one. A group naming a single fold is
    // a question whose answer changes nothing, and asking it is how a reviewer
    // learns to click past this screen. Every producer above already respects
    // this; the filter is here so no future one can quietly stop.
    groups: [...groups, ...fuzzy].filter(
      (group) => groupKeyMembers(group.groupKey).length >= 2,
    ),
    distinctValues,
    tooWide: false,
    fuzzyWithheld,
    boundNote: fuzzyWithheld
      ? `Esta característica tiene ${distinctValues} respuestas distintas. Se buscaron ` +
        "diferencias de escritura (mayúsculas, acentos, espacios, puntuación), pero no " +
        "parecidos de redacción: en una lista tan larga producirían más ruido que ayuda."
      : null,
  };
}

/** Scan every characteristic a study carries. */
export function scanStudy(
  respondents: readonly { segments: Record<string, unknown> | null }[],
  aliases: SegmentAliases = {},
): CandidateScan[] {
  return [...inventoryValues(respondents).entries()]
    .sort(([a], [b]) => a.localeCompare(b, "es-MX"))
    .map(([key, counts]) => scanDimension(key, counts, aliases));
}
