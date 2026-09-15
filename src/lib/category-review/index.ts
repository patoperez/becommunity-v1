/**
 * THE CLIENT-SAFE BARREL for the canonical category review.
 *
 * Everything re-exported here is pure: types, closed lists, Spanish sentences
 * and total functions over strings. Nothing on this path reaches a transport,
 * a clock, the filesystem or the product's SHA-256, so a `"use client"`
 * component may import it without acquiring an edge into the canonical layer's
 * import graph — which the boundary gate refuses by name.
 *
 * `./digest.ts` is deliberately NOT re-exported: it imports the canonical
 * commit layer's synchronous SHA-256. Server modules and offline gates import
 * it directly, exactly as they do `journey-pain-digest.ts`.
 */

export {
  CATEGORY_DISPOSITIONS,
  CATEGORY_REFUSAL_DETAIL,
  CATEGORY_REVIEW_LIMITS,
  EMPTY_CATEGORY_RESOLUTION,
  categoryLabelMap,
  foldCategoryLabel,
  resolutionIsEmpty,
} from "./contract";
export type {
  CategoryCount,
  CategoryDecisionOutcome,
  CategoryDecisionSubmission,
  CategoryDisposition,
  CategoryFamily,
  CategoryGrouping,
  CategoryLedgerState,
  CategoryMemoryEntry,
  CategoryRefusalCode,
  CategoryResolution,
  RecordCategoryDecision,
  StoredCategoryDecision,
} from "./contract";

export { scanFamily, sortedFolds } from "./candidates";
export type { CandidateWarning, CategoryCandidate, CategoryScan } from "./candidates";

export {
  DETERMINISTIC_RULES,
  RULE_STRENGTH,
  differsOnlyByInvisibles,
  looksNumeric,
} from "./normalize";
export type { NormalizationRule } from "./normalize";

export {
  MIN_BLOCKING_MOVED,
  MIN_BLOCKING_SHARE,
  blockingFindings,
  candidateImpact,
  categoryFindings,
  countPanel,
  freshnessOf,
  groupedFolds,
  refuseCategoryDecision,
  resolutionFrom,
  settledFolds,
  shareOf,
} from "./model";
export type {
  CategoryDecisionInput,
  CategoryFamilyPanel,
  CategoryFinding,
  CategoryFreshness,
  CategoryImpact,
  CategoryReviewPanel,
  CategoryVerdict,
  DecidedGroup,
} from "./model";
