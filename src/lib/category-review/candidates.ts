/**
 * WHAT THE PRODUCT NOTICED — never what it decided.
 *
 * PORTED from `src/lib/categories/candidates.ts` on the production branch
 * (commit `022513e`), adapted to read a canonical qualitative family's label
 * counts instead of a legacy respondent's segment map. The comparison rules,
 * the bounds, the blocking strategy, the digit and negation guards and the
 * one-subject-per-fold rule are unchanged, because the measured false-merge
 * rate of 0/12 on the labelled fixture is evidence about exactly them.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * NOTHING HERE MERGES ANYTHING, AND NOTHING HERE RETURNS A CONFIDENCE.
 *
 * A candidate is a QUESTION. It carries the rule that produced it and the
 * labels it is about, so a reviewer judges the rule rather than a score. There
 * is no threshold above which this module would act, and no caller may treat
 * one of its outputs as a decision.
 */

import {
  CATEGORY_REVIEW_LIMITS,
  foldCategoryLabel,
  type CategoryCount,
} from "./contract";
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

/** Token overlap at or above which a resemblance is worth raising. */
const FUZZY_TOKEN_THRESHOLD = 0.6;
/** Edit similarity at or above which a SHORT pair is worth raising. */
const FUZZY_EDIT_THRESHOLD = 0.82;
/** Labels up to this length also get an edit-distance second opinion. */
const SHORT_LABEL_LENGTH = 24;
/** Blocked pair generation is capped; a family this wide is not a vocabulary. */
const MAX_FUZZY_PAIRS = 20_000;

export type CandidateWarning =
  | "numeric_labels"
  | "single_answer"
  | "long_labels"
  | "many_members"
  | "ordinal_neighbours";

export type CategoryCandidate = {
  /** Stable identity: the sorted folded members. Same members, same key. */
  memberFolds: string[];
  familyKey: string;
  /** The strongest rule that explains why these labels were put together. */
  rule: NormalizationRule;
  strength: "equivalent" | "strong" | "weak";
  /** Members, most-answered first. Always at least two. */
  values: CategoryCount[];
  /** Only meaningful for `fuzzy`; null for every deterministic rule. */
  similarity: number | null;
  /** The name proposed if a person chooses to group. Never applied by itself. */
  suggestedLabel: string;
  /** Answers across every member. */
  affectedCount: number;
  warnings: CandidateWarning[];
};

export type CategoryScan = {
  familyKey: string;
  candidates: CategoryCandidate[];
  /** Distinct non-empty labels the family carries. */
  distinctLabels: number;
  /** True when the family was too wide to scan as a coding vocabulary at all. */
  tooWide: boolean;
  /** True when resemblance comparison was withheld because of a bound. */
  fuzzyWithheld: boolean;
  /** Plain-language reason a bound was reached, or null. */
  boundNote: string | null;
};

/* -------------------------------------------------------------------------- */
/* deterministic grouping                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Bucket labels by each comparison key in turn, strongest rule first, and emit
 * a candidate the first time a rule explains a collision.
 *
 * Linear in the number of distinct labels per rule — four passes over a hash
 * map, no pair comparison at all. A label already explained by a stronger rule
 * is removed from consideration, so the same pair is never raised twice under
 * two rules and the reviewer always sees the best available reason.
 */
function deterministicCandidates(
  familyKey: string,
  counts: Map<string, number>,
  alreadyGrouped: ReadonlySet<string>,
): CategoryCandidate[] {
  const found: CategoryCandidate[] = [];
  const claimed = new Set(alreadyGrouped);

  for (const rule of ["unicode", "case_whitespace", "accent", "punctuation"] as const) {
    const buckets = new Map<string, string[]>();
    for (const raw of counts.keys()) {
      if (claimed.has(foldCategoryLabel(raw))) continue;
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
      if (new Set(members.map(foldCategoryLabel)).size < 2) continue;
      if (members.length > CATEGORY_REVIEW_LIMITS.maxGroupMembers) continue;

      found.push(buildCandidate(familyKey, rule, members, counts, null));
      for (const raw of members) claimed.add(foldCategoryLabel(raw));
    }
  }
  return found;
}

/* -------------------------------------------------------------------------- */
/* resemblance                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Blocked pair generation: only labels sharing a leading or longest token are
 * ever compared.
 *
 * Without blocking this is O(n²) on a set the product cannot bound at import
 * time. With it, a label is compared only against labels that already look
 * related, and the total is capped besides. The cost is missing a pair that
 * shares no significant token — an acceptable loss for a stage whose output is
 * a question, and one the deterministic rules do not share.
 */
function fuzzyPairs(labels: readonly string[]): [string, string][] {
  const blocks = new Map<string, string[]>();
  for (const raw of labels) {
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

/** Whether exactly one of the two labels is negated. */
function negationAsymmetry(a: string, b: string): boolean {
  const negated = (value: string) => similarityTokens(value).some((token) => NEGATIONS.has(token));
  return negated(a) !== negated(b);
}

/**
 * Resemblance candidates: pairs of CATEGORIES, never of spellings, never chains.
 *
 * IT COMPARES FOLDS, NOT RAW LABELS, AND THAT IS THE WHOLE POINT. Two spellings
 * the automatic fold has already made one category would look highly similar —
 * they are, they are the same words — and raising them asks a question with no
 * answer. So each fold contributes exactly one comparison subject, and a pair is
 * only ever between two DIFFERENT categories.
 *
 * Pairs only, never transitive chains: a chain would let A~B and B~C silently
 * propose that A and C are one answer, which is how an ordinal scale collapses
 * into a single band. A consultant who wants three categories together says so
 * three times, deliberately.
 */
function fuzzyCandidates(
  familyKey: string,
  counts: Map<string, number>,
  claimed: ReadonlySet<string>,
): CategoryCandidate[] {
  const byFold = new Map<string, { raws: string[]; total: number }>();
  for (const [raw, count] of counts) {
    const fold = foldCategoryLabel(raw);
    if (!fold || claimed.has(fold)) continue;
    const entry = byFold.get(fold) ?? { raws: [], total: 0 };
    entry.raws.push(raw);
    entry.total += count;
    byFold.set(fold, entry);
  }

  // One subject per category: the spelling most answers used, ties broken
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

  const found: CategoryCandidate[] = [];
  for (const [a, b] of fuzzyPairs([...subjectOf.values()])) {
    const foldA = foldOfSubject.get(a);
    const foldB = foldOfSubject.get(b);
    // Defensive: subjects are one per fold, so this cannot fire. If it ever
    // did, it would mean raising a settled question, so it refuses instead.
    if (!foldA || !foldB || foldA === foldB) continue;

    // A NUMBER IS NOT A WORD. If two phrases differ in their digits, the digits
    // are what distinguishes them. Textual similarity carries no information
    // whatever about a number, so it is not allowed to speak here. The
    // deterministic rules are deliberately still free to raise such a pair: an
    // encoding or spacing difference inside a number is still an encoding
    // difference, and that is a fact about the text rather than a guess.
    if (digitsDiffer(a, b)) continue;

    // A NEGATION IS NOT A REWORDING — the single most damaging false proposal
    // this queue could make, because it is also the most plausible-looking.
    // Symmetry is what makes the guard safe for the real case: two negative
    // wordings of one answer are both negated, so it does not apply to them.
    if (negationAsymmetry(a, b)) continue;

    const tokens = tokenSimilarity(a, b);
    const short = a.length <= SHORT_LABEL_LENGTH && b.length <= SHORT_LABEL_LENGTH;
    const edits = short ? editSimilarity(a, b) : 0;
    if (!(tokens >= FUZZY_TOKEN_THRESHOLD || (short && edits >= FUZZY_EDIT_THRESHOLD))) continue;

    const members = [...(byFold.get(foldA)?.raws ?? []), ...(byFold.get(foldB)?.raws ?? [])];
    if (members.length > CATEGORY_REVIEW_LIMITS.maxGroupMembers) continue;
    found.push(buildCandidate(familyKey, "fuzzy", members, counts, Math.max(tokens, edits)));
  }

  return found.sort((left, right) => (right.similarity ?? 0) - (left.similarity ?? 0));
}

/* -------------------------------------------------------------------------- */
/* construction                                                                */
/* -------------------------------------------------------------------------- */

function buildCandidate(
  familyKey: string,
  rule: NormalizationRule,
  members: readonly string[],
  counts: Map<string, number>,
  similarity: number | null,
): CategoryCandidate {
  const values: CategoryCount[] = members
    .map((label) => ({ label, count: counts.get(label) ?? 0 }))
    .sort((a, b) => b.count - a.count || (a.label < b.label ? -1 : 1));

  const warnings: CandidateWarning[] = [];
  if (values.some((value) => looksNumeric(value.label))) warnings.push("numeric_labels");
  if (values.every((value) => value.count <= 1)) warnings.push("single_answer");
  if (values.some((value) => value.label.length > 80)) warnings.push("long_labels");
  if (values.length > 3) warnings.push("many_members");
  // Two labels differing only in their digits sit next to each other on a scale
  // far more often than they are the same answer.
  if (values.length === 2 && digitsDiffer(values[0].label, values[1].label)) {
    warnings.push("ordinal_neighbours");
  }

  return {
    memberFolds: sortedFolds(members),
    familyKey,
    rule,
    strength: RULE_STRENGTH[rule],
    values,
    similarity,
    // The wording most answers actually used, with the lexicographically
    // smallest breaking a tie so the proposal never depends on row order.
    suggestedLabel: values[0].label,
    affectedCount: values.reduce((total, value) => total + value.count, 0),
    warnings,
  };
}

/**
 * The group's identity: the folded members, de-duplicated and sorted.
 *
 * It must not change when the same two labels are re-detected under a different
 * rule, in a different order, or after one of them gains an answer. Folds rather
 * than raw spellings, so a family that later receives a differently-cased copy
 * is not treated as a different question from the one already answered.
 */
export function sortedFolds(labels: readonly string[]): string[] {
  return [...new Set(labels.map(foldCategoryLabel).filter(Boolean))].sort();
}

/* -------------------------------------------------------------------------- */
/* entry point                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Scan one family for candidates.
 *
 * `alreadyGrouped` are the folds a decision in force has already put together.
 * A question that has been answered is not a question, and re-asking it is how
 * a reviewer learns to click past this screen.
 */
export function scanFamily(
  familyKey: string,
  labels: readonly CategoryCount[],
  alreadyGrouped: ReadonlySet<string> = new Set(),
): CategoryScan {
  const counts = new Map<string, number>();
  for (const entry of labels) {
    if (entry.label.trim() === "") continue;
    counts.set(entry.label, (counts.get(entry.label) ?? 0) + entry.count);
  }

  const distinctLabels = counts.size;
  if (distinctLabels > CATEGORY_REVIEW_LIMITS.maxFamilyLabels) {
    return {
      familyKey,
      candidates: [],
      distinctLabels,
      tooWide: true,
      fuzzyWithheld: true,
      boundNote:
        `Esta familia tiene ${distinctLabels} respuestas distintas. Con tantas no es una ` +
        "lista de categorías: casi siempre es texto libre mapeado por error. Revisa cómo se " +
        "importó la columna antes de agrupar nada.",
    };
  }

  const deterministic = deterministicCandidates(familyKey, counts, alreadyGrouped);
  const claimed = new Set(alreadyGrouped);
  for (const candidate of deterministic) {
    for (const value of candidate.values) claimed.add(foldCategoryLabel(value.label));
  }

  const fuzzyWithheld = distinctLabels > CATEGORY_REVIEW_LIMITS.maxFuzzyLabels;
  const fuzzy = fuzzyWithheld ? [] : fuzzyCandidates(familyKey, counts, claimed);

  return {
    familyKey,
    // THE INVARIANT, ENFORCED ONCE, AT THE EXIT. A candidate must join at least
    // two categories that are not already one. A group naming a single fold is
    // a question whose answer changes nothing. Every producer above already
    // respects this; the filter is here so no future one can quietly stop.
    candidates: [...deterministic, ...fuzzy].filter(
      (candidate) => candidate.memberFolds.length >= 2,
    ),
    distinctLabels,
    tooWide: false,
    fuzzyWithheld,
    boundNote: fuzzyWithheld
      ? `Esta familia tiene ${distinctLabels} respuestas distintas. Se buscaron diferencias de ` +
        "escritura (mayúsculas, acentos, espacios, puntuación), pero no parecidos de " +
        "redacción: en una lista tan larga producirían más ruido que ayuda."
      : null,
  };
}
