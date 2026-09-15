/**
 * THE PURE HALF OF THE CANONICAL CATEGORY REVIEW.
 *
 * Decisions in, a projection and a screenful of consequences out. No transport,
 * no clock, no randomness, no SHA — every function here is total over its
 * inputs and an offline gate drives all of them for real rather than in copy.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE ORDER OF THE THREE IDEAS IN THIS FILE.
 *
 *   1. WHAT IS IN FORCE. A ledger is a version chain per group; «in force» is
 *      the highest version, and a `revoked` head means nothing is.
 *   2. WHAT THAT CHANGES. The projection, the before/after counts, and the
 *      invariant that the number of people who answered never moves.
 *   3. WHAT WOULD BE REFUSED. Every rule the SQL write path enforces, checked
 *      here too — so a person is told before the click rather than shown a
 *      database error after it. The screen is not the security boundary; this
 *      is the courtesy, and `record_canonical_category_decision` is the rule.
 */

import {
  CATEGORY_REVIEW_LIMITS,
  EMPTY_CATEGORY_RESOLUTION,
  foldCategoryLabel,
  type CategoryCount,
  type CategoryFamily,
  type CategoryGrouping,
  type CategoryMemoryEntry,
  type CategoryRefusalCode,
  type CategoryResolution,
  type StoredCategoryDecision,
} from "./contract";
import { sortedFolds, type CategoryCandidate, type CategoryScan } from "./candidates";
import { RULE_STRENGTH, type NormalizationRule } from "./normalize";

/* -------------------------------------------------------------------------- */
/* 1. what is in force                                                         */
/* -------------------------------------------------------------------------- */

const foldKey = (folds: readonly string[]) => folds.join("");

/**
 * The groupings a build must apply.
 *
 * ONLY `grouped` CONTRIBUTES. `separate` records that a person looked and left
 * them apart, `postponed` that they deferred with a reason, and `revoked` that
 * they undid a grouping — none of the three changes a number, and all three are
 * evidence. Reading them as «no opinion» would lose the difference between a
 * question nobody has answered and one somebody answered with «no».
 *
 * DETERMINISTIC ORDER. Groupings are sorted by their first member's fold, so
 * two builds of the same ledger produce the same object and therefore the same
 * results document.
 */
export function resolutionFrom(
  decisions: readonly StoredCategoryDecision[],
): CategoryResolution {
  const byFamily = new Map<string, CategoryGrouping[]>();
  for (const decision of decisions) {
    if (decision.disposition !== "grouped") continue;
    if (decision.canonicalLabel === null) continue;
    if (decision.memberFolds.length < 2) continue;
    const list = byFamily.get(decision.familyKey) ?? [];
    list.push({
      label: decision.canonicalLabel,
      memberFolds: [...decision.memberFolds],
    });
    byFamily.set(decision.familyKey, list);
  }
  if (byFamily.size === 0) return EMPTY_CATEGORY_RESOLUTION;

  const groups: Record<string, readonly CategoryGrouping[]> = {};
  for (const key of [...byFamily.keys()].sort()) {
    groups[key] = (byFamily.get(key) ?? [])
      .sort((a, b) => (foldKey(a.memberFolds) < foldKey(b.memberFolds) ? -1 : 1))
      .map((group) => Object.freeze({ label: group.label, memberFolds: Object.freeze([...group.memberFolds]) }));
  }
  return Object.freeze({ groups: Object.freeze(groups) });
}

/** Folds an in-force grouping already covers, so a settled question is not re-asked. */
export function groupedFolds(
  decisions: readonly StoredCategoryDecision[],
  familyKey: string,
): Set<string> {
  const claimed = new Set<string>();
  for (const decision of decisions) {
    if (decision.familyKey !== familyKey) continue;
    if (decision.disposition !== "grouped") continue;
    for (const fold of decision.memberFolds) claimed.add(fold);
  }
  return claimed;
}

/**
 * Folds any decision has settled — grouped OR deliberately left apart OR
 * postponed with a reason.
 *
 * A candidate is a QUESTION, and all three of those are answers. Only a
 * `revoked` head reopens one, which is what undo is for.
 */
export function settledFolds(
  decisions: readonly StoredCategoryDecision[],
  familyKey: string,
): Set<string> {
  const settled = new Set<string>();
  for (const decision of decisions) {
    if (decision.familyKey !== familyKey) continue;
    if (decision.disposition === "revoked") continue;
    for (const fold of decision.memberFolds) settled.add(fold);
  }
  return settled;
}

/* -------------------------------------------------------------------------- */
/* 2. what that changes                                                        */
/* -------------------------------------------------------------------------- */

export type CategoryImpact = {
  /** The members and their current counts, most-answered first. */
  before: CategoryCount[];
  /** The one category they would become. */
  after: CategoryCount;
  /** Distinct published categories before and after. */
  groupsBefore: number;
  groupsAfter: number;
  /**
   * THE INVARIANT, IN EXECUTABLE FORM. Grouping changes how many categories the
   * answers fall into; it can never change how many answers there are. A gate
   * asserts this on every fixture, and a false value here is a defect in the
   * projection rather than a fact about the study.
   */
  totalsUnchanged: boolean;
};

/** What one grouping would do to one family, counted from the family itself. */
export function candidateImpact(
  family: CategoryFamily,
  memberFolds: readonly string[],
  label: string,
): CategoryImpact {
  const wanted = new Set(memberFolds);
  const before = family.sourceLabels
    .filter((entry) => wanted.has(foldCategoryLabel(entry.label)))
    .sort((a, b) => b.count - a.count || (a.label < b.label ? -1 : 1));
  const moved = before.reduce((total, entry) => total + entry.count, 0);

  // THE AFTER DISTRIBUTION IS BUILT, NOT ASSERTED. Re-counting every label
  // through the projection is the only way `totalsUnchanged` can fail when the
  // projection is wrong, and a check that cannot fail is not one.
  const distinctBefore = new Set(family.sourceLabels.map((entry) => foldCategoryLabel(entry.label)));
  const after = new Map<string, number>();
  for (const entry of family.sourceLabels) {
    const fold = foldCategoryLabel(entry.label);
    const key = wanted.has(fold) ? foldCategoryLabel(label) : fold;
    after.set(key, (after.get(key) ?? 0) + entry.count);
  }

  const sourceTotal = family.sourceLabels.reduce((total, entry) => total + entry.count, 0);
  const afterTotal = [...after.values()].reduce((total, count) => total + count, 0);
  return {
    before,
    after: { label, count: after.get(foldCategoryLabel(label)) ?? moved },
    groupsBefore: distinctBefore.size,
    groupsAfter: after.size,
    totalsUnchanged: afterTotal === sourceTotal,
  };
}

/** The share one count is of a family's answered total, 0..1, or 0 with no base. */
export function shareOf(count: number, total: number): number {
  return total > 0 ? count / total : 0;
}

/* -------------------------------------------------------------------------- */
/* staleness                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * WHY A DECISION IS NOT WRONG BECAUSE THE FAMILY MOVED.
 *
 *   `context_changed` — the family's vocabulary moved since the decision. The
 *                       judgement may still be right; it was made about a
 *                       different question, so it is re-confirmed before a
 *                       publication rather than trusted silently.
 *   `member_absent`   — one of the labels the decision names is gone. Reported,
 *                       and deliberately NOT auto-revoked: the decision was
 *                       correct when it was made, and destroying the record of
 *                       a correct judgement is worse than carrying an inert one.
 */
export type CategoryFreshness = "fresh" | "context_changed" | "member_absent";

export function freshnessOf(
  decision: StoredCategoryDecision,
  family: CategoryFamily,
  currentDigest: string,
): CategoryFreshness {
  const present = new Set(family.sourceLabels.map((entry) => foldCategoryLabel(entry.label)));
  if (decision.memberFolds.some((fold) => !present.has(fold))) return "member_absent";
  if (decision.sourceDigest !== currentDigest) return "context_changed";
  return "fresh";
}

/* -------------------------------------------------------------------------- */
/* 3. what would be refused                                                    */
/* -------------------------------------------------------------------------- */

export type CategoryDecisionInput = {
  familyKey: string;
  /** Raw labels a person selected. Folded and sorted before anything else. */
  memberLabels: readonly string[];
  disposition: "grouped" | "separate" | "postponed" | "revoked";
  canonicalLabel: string | null;
  rationale: string | null;
};

/**
 * Every rule `record_canonical_category_decision` enforces, checked before the
 * click.
 *
 * It returns a CODE and never a sentence, so the screen, the gate and the
 * action all agree about what happened. `null` means nothing here objects —
 * which is not permission: the database checks all of it again, against the
 * state as it is at the moment of the write rather than as it was when the page
 * was rendered.
 */
export function refuseCategoryDecision(
  input: CategoryDecisionInput,
  family: CategoryFamily | undefined,
  decisions: readonly StoredCategoryDecision[],
): CategoryRefusalCode | null {
  if (!family || family.key !== input.familyKey) return "family_unknown";

  const folds = sortedFolds(input.memberLabels);
  if (folds.length < 2) return "too_few_members";
  if (folds.length > CATEGORY_REVIEW_LIMITS.maxGroupMembers) return "too_many_members";

  const present = new Set(family.sourceLabels.map((entry) => foldCategoryLabel(entry.label)));
  if (folds.some((fold) => !present.has(fold))) return "members_not_current";

  const inForce = decisions.filter((entry) => entry.familyKey === input.familyKey);
  const head = inForce.find((entry) => foldKey(entry.memberFolds) === foldKey(folds)) ?? null;

  if (input.disposition === "revoked") {
    if (head === null || head.disposition === "revoked") return "nothing_to_undo";
    return null;
  }

  if (input.disposition === "postponed") {
    const reason = (input.rationale ?? "").trim();
    if (reason.length < CATEGORY_REVIEW_LIMITS.minPostponeReason) return "reason_required";
    if (reason.length > CATEGORY_REVIEW_LIMITS.maxRationaleLength) return "reason_required";
    return null;
  }

  if (input.disposition === "separate") return null;

  // ---- grouped ------------------------------------------------------------
  const label = (input.canonicalLabel ?? "").trim();
  if (label === "") return "name_required";
  if (label.length > CATEGORY_REVIEW_LIMITS.maxLabelLength) return "name_too_long";
  const labelFold = foldCategoryLabel(label);

  for (const other of inForce) {
    if (other.disposition !== "grouped") continue;
    if (foldKey(other.memberFolds) === foldKey(folds)) continue;
    // (a) one label, one category
    if (other.memberFolds.some((fold) => folds.includes(fold))) return "member_already_grouped";
    // (b) two categories may not share a visible name
    if (other.canonicalLabel !== null && foldCategoryLabel(other.canonicalLabel) === labelFold) {
      return "name_conflicts";
    }
    // (c) a name is never a member of another group — the only shape in which
    // this flat mapping could form a chain, so refusing it makes cycles
    // structurally impossible.
    if (other.memberFolds.includes(labelFold)) return "name_is_a_member";
  }
  return null;
}

/* -------------------------------------------------------------------------- */
/* what holds up a publication                                                 */
/* -------------------------------------------------------------------------- */

/** At least this many answers must move before a difference can block. */
export const MIN_BLOCKING_MOVED = 2;
/** …and it must reach this share of the family's answered total. */
export const MIN_BLOCKING_SHARE = 0.05;

export type CategoryVerdict = "blocks" | "warns" | "quiet";

export type CategoryFinding = {
  familyKey: string;
  memberFolds: string[];
  rule: NormalizationRule;
  verdict: CategoryVerdict;
  summary: string;
  because: string;
};

/**
 * WHAT MAY HOLD UP A PUBLICATION, AND WHAT MAY NEVER.
 *
 * Importing is never blocked. Saving is never blocked. Working is never
 * blocked. A publication is held up ONLY by a deterministic, high-confidence,
 * materially significant difference that nobody has decided:
 *
 *   * two labels that RENDER IDENTICALLY — an invisible character, an exotic
 *     space — always hold it up, because a reader cannot tell them apart and
 *     therefore cannot audit the number;
 *   * an accent or punctuation difference holds it up only when at least
 *     `MIN_BLOCKING_MOVED` answers would change category AND it reaches
 *     `MIN_BLOCKING_SHARE` of the family.
 *
 * A WORDING RESEMBLANCE NEVER HOLDS UP ANYTHING. It is the weakest evidence
 * this product produces and blocking on it would teach a consultant to tick
 * past the strong ones. There is no confidence value anywhere in this function
 * and no import in this file that could supply one.
 *
 * Three honest ways past a block, and all three are decisions with an author:
 * group them, record that they stay separate, or postpone with a written
 * reason. There is no override flag.
 */
export function categoryFindings(
  family: CategoryFamily,
  scan: CategoryScan,
): CategoryFinding[] {
  const findings: CategoryFinding[] = [];
  for (const candidate of scan.candidates) {
    findings.push(findingFor(family, candidate));
  }
  return findings;
}

function findingFor(family: CategoryFamily, candidate: CategoryCandidate): CategoryFinding {
  const moved = candidate.affectedCount;
  const share = shareOf(moved, family.total);
  const names = candidate.values.map((value) => `«${value.label}»`).join(" y ");

  if (RULE_STRENGTH[candidate.rule] === "equivalent") {
    return {
      familyKey: family.key,
      memberFolds: candidate.memberFolds,
      rule: candidate.rule,
      verdict: "blocks",
      summary: `${names} se leen igual en pantalla y se cuentan aparte.`,
      because:
        `Afecta a ${moved} respuesta${moved === 1 ? "" : "s"} de «${family.label}». Quien lea el ` +
        "informe no puede distinguirlas, así que tampoco puede revisar el número.",
    };
  }

  if (candidate.rule === "accent" || candidate.rule === "punctuation") {
    const material = moved >= MIN_BLOCKING_MOVED && share >= MIN_BLOCKING_SHARE;
    return {
      familyKey: family.key,
      memberFolds: candidate.memberFolds,
      rule: candidate.rule,
      verdict: material ? "blocks" : "warns",
      summary:
        candidate.rule === "accent"
          ? `${names} se diferencian solo por acentos.`
          : `${names} se diferencian solo por signos de puntuación.`,
      because: material
        ? `Moverían ${moved} respuesta${moved === 1 ? "" : "s"} de «${family.label}», el ` +
          `${Math.round(share * 100)} % de esa familia.`
        : `Afecta a ${moved} respuesta${moved === 1 ? "" : "s"}; es poco para detener una ` +
          "publicación, y conviene decidirlo igualmente.",
    };
  }

  return {
    familyKey: family.key,
    memberFolds: candidate.memberFolds,
    rule: candidate.rule,
    verdict: "warns",
    summary: `${names} se parecen en su redacción.`,
    because:
      "Un parecido de redacción es la evidencia más débil que este producto produce y nunca " +
      "detiene una publicación. Decidirlo es tuyo.",
  };
}

/* -------------------------------------------------------------------------- */
/* the panel                                                                   */
/* -------------------------------------------------------------------------- */

export type DecidedGroup = {
  decisionId: string;
  memberFolds: string[];
  memberLabels: string[];
  disposition: StoredCategoryDecision["disposition"];
  canonicalLabel: string | null;
  rationale: string | null;
  version: number;
  decidedAt: string;
  freshness: CategoryFreshness;
  /** The labels as they stand NOW, when they are all still present. */
  currentLabels: CategoryCount[];
};

export type CategoryFamilyPanel = {
  family: CategoryFamily;
  /** Opaque marker of the family's vocabulary. Never the digest itself. */
  sourceVersion: string;
  scan: CategoryScan;
  candidates: CategoryCandidate[];
  findings: CategoryFinding[];
  decided: DecidedGroup[];
  memory: CategoryMemoryEntry[];
};

export type CategoryReviewPanel = {
  families: CategoryFamilyPanel[];
  /** Whether this environment can record a decision at all. */
  canDecide: boolean;
  counts: {
    families: number;
    candidates: number;
    blocking: number;
    decided: number;
    stale: number;
  };
};

/** Every blocking finding across the panel, in the order a reviewer reads them. */
export function blockingFindings(panel: CategoryReviewPanel): CategoryFinding[] {
  return panel.families.flatMap((entry) =>
    entry.findings.filter((finding) => finding.verdict === "blocks"),
  );
}

export function countPanel(families: readonly CategoryFamilyPanel[]): CategoryReviewPanel["counts"] {
  return {
    families: families.length,
    candidates: families.reduce((total, entry) => total + entry.candidates.length, 0),
    blocking: families.reduce(
      (total, entry) => total + entry.findings.filter((f) => f.verdict === "blocks").length,
      0,
    ),
    decided: families.reduce((total, entry) => total + entry.decided.length, 0),
    stale: families.reduce(
      (total, entry) => total + entry.decided.filter((d) => d.freshness !== "fresh").length,
      0,
    ),
  };
}
