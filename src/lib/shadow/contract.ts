/**
 * THE SHADOW DIAGNOSTIC CONTRACT — what a comparison may say, and nothing more.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THIS IS FOR. Unit 5 Phase 3 runs the canonical results model BESIDE the
 * legacy one, on the same authorized study, and compares them. The legacy
 * result is what the application returns; the comparison exists to tell an
 * operator where the two agree and where they do not, BEFORE anybody proposes
 * switching a read path.
 *
 * THE FIELD LIST IS THE PRIVACY BOUNDARY, and it is deliberately narrow. A
 * finding may carry a stable key, a classification, two numbers that are
 * already aggregates published on both sides, a rounding rule, a filter
 * fingerprint and a safe code. It has NO field for a respondent id, a name, an
 * answer, a segment value, a qualitative phrase or a database message — so a
 * later edit cannot add one without changing this file, and the gate reads this
 * file's own field list to prove it.
 *
 * WHY BOTH NUMBERS MAY APPEAR. `legacyValue` and `canonicalValue` are values
 * the two aggregate layers ALREADY publish — an NPS, a base, a population
 * count. Neither is respondent-level and neither is derived from a single
 * person: every comparable field in `compare.ts` is a study-wide aggregate over
 * a base of at least eleven people. A finding whose value could not be
 * published is not compared at all; it is classified and carries no number.
 *
 * NOTHING HERE REACHES A BROWSER. `studies/study-dashboard.ts` returns the
 * diagnostics beside the legacy payload and the one approved page reads only
 * the payload. `scripts/shadow-boundary-test.mjs` fails if a route, a page or a
 * component so much as names the diagnostic field.
 * ─────────────────────────────────────────────────────────────────────────────
 */

/** How a legacy field relates to its canonical counterpart. */
export const COMPATIBILITY_CLASSIFICATIONS = [
  /** Same quantity, same base, same scale. Compared numerically. */
  "exact_equivalent",
  /** Same quantity once a NAMED, documented transformation is applied. */
  "equivalent_after_named_transformation",
  /** The canonical layer answers the question differently, on purpose. */
  "canonical_replacement",
  /** The legacy payload publishes it and the canonical contract does not. */
  "legacy_only",
  /** The canonical contract publishes it and the legacy payload does not. */
  "canonical_only",
  /** Comparable only once an approved presentation mapping is configured. */
  "presentation_configuration_required",
  /** Comparable only once human editorial review supplies the content. */
  "editorial_configuration_required",
  /** The two are different questions and no transformation makes them one. */
  "not_comparable",
] as const;

export type CompatibilityClassification = (typeof COMPATIBILITY_CLASSIFICATIONS)[number];

/** What a disagreement is ABOUT. A mismatch always names exactly one. */
export const MISMATCH_KINDS = [
  "value",
  "base",
  "cohort",
  "filter_scope",
  "ordering",
  "availability",
  "rounding",
  "forbidden_cross",
  "presentation_only",
  "editorial_only",
] as const;

export type MismatchKind = (typeof MISMATCH_KINDS)[number];

/**
 * Every state a shadow run may report. All safe to print, log and store.
 *
 * A database message never becomes one of these: `orchestrate.ts` reduces every
 * thrown value to a code from this list, because a PostgreSQL constraint
 * message quotes the values that violated it and in this schema those values
 * are respondent data.
 */
export const SHADOW_STATUSES = [
  /** The flag is off. The canonical adapter was never called. */
  "disabled_by_flag",
  /** The flag is on but this tenant/study pair is not on the allowlist. */
  "scope_not_allowlisted",
  /** The comparison ran and produced findings. */
  "compared",
  /** The canonical read did not finish inside the budget. */
  "canonical_timeout",
  /** The canonical read failed at the transport. No message is carried. */
  "canonical_transport_error",
  /** The canonical read returned something that is not a results document. */
  "canonical_malformed",
  /** The comparison itself threw. Reported, never swallowed. */
  "comparator_error",
] as const;

export type ShadowStatus = (typeof SHADOW_STATUSES)[number];

/** The exact fields one finding may carry. Nothing else may be added here. */
export type ShadowFinding = {
  /** Stable, human-meaningful, study-independent. e.g. `recommendation.nps.combinado.value`. */
  key: string;
  /** Which document section the key belongs to. */
  section: string;
  classification: CompatibilityClassification;
  /** True only when the two agreed under the declared rule. Null when not compared. */
  agrees: boolean | null;
  /** Set only when `agrees` is false. */
  mismatch: MismatchKind | null;
  /** An aggregate both layers already publish, or null when not compared. */
  legacyValue: number | null;
  canonicalValue: number | null;
  /** The denominators, when the field has one on both sides. */
  legacyBase: number | null;
  canonicalBase: number | null;
  /** How equality was decided. `exact` or `decimals:<n>`. */
  rule: string;
  /** Why a field was not compared, as a short stable token. Never a message. */
  note: string | null;
};

/** The complete, safe result of one shadow run. */
export type ShadowDiagnostics = {
  status: ShadowStatus;
  /** The tenant and study the run was authorized for. Uuids, never names. */
  tenantId: string;
  studyId: string;
  /** A stable digest of the applied filter selection. Never the values. */
  filterFingerprint: string;
  /** The canonical results contract version, when a document was read. */
  contractVersion: string | null;
  /** The imported package the canonical numbers came from. */
  planFingerprint: string | null;
  packageIdempotencyKey: string | null;
  /** Wall time the canonical read and the comparison were allowed, and took. */
  budgetMs: number;
  elapsedMs: number;
  findings: ShadowFinding[];
  counts: {
    compared: number;
    agreed: number;
    disagreed: number;
    /** Classified, and deliberately not compared. */
    classified: number;
  };
};

/** The shape of a run that never touched the canonical layer at all. */
export function inertDiagnostics(
  status: Extract<ShadowStatus, "disabled_by_flag" | "scope_not_allowlisted">,
  tenantId: string,
  studyId: string,
  budgetMs: number,
): ShadowDiagnostics {
  return {
    status,
    tenantId,
    studyId,
    filterFingerprint: "",
    contractVersion: null,
    planFingerprint: null,
    packageIdempotencyKey: null,
    budgetMs,
    elapsedMs: 0,
    findings: [],
    counts: { compared: 0, agreed: 0, disagreed: 0, classified: 0 },
  };
}
