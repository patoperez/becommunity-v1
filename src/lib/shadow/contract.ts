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
 * EVERY TEXT FIELD IS A CLOSED SET. Phase 3.1 removed the last two places a
 * free string could enter a diagnostic: the finding's `note` — which held
 * English sentences and could just as easily have held a database message —
 * and the `rule`. Both are now unions declared here, so an arbitrary string
 * cannot be constructed at the type level and `runtimeShadowRecord` rejects one
 * at run time. The prose those notes carried lives in
 * `docs/LEGACY_CANONICAL_COMPATIBILITY.md`, where a human reads it, and in the
 * comments of `compare.ts`, where the decision was made.
 *
 * THE FIELD LIST IS THE PRIVACY BOUNDARY, and it is deliberately narrow. A
 * finding may carry a key from a closed list, a section from a closed list, a
 * classification, two numbers that are already aggregates published on both
 * sides, a rounding rule and a note code. It has NO field for a respondent id,
 * a name, an answer, a segment value, a qualitative phrase or a database
 * message — so a later edit cannot add one without changing this file, and the
 * gate reads this file's own field list to prove it.
 *
 * THERE IS NO FILTER FINGERPRINT ANY MORE. Phase 3 hashed the applied filter's
 * `[key, value]` pairs with an unsalted SHA-256. That is not a redaction: this
 * product's filter values come from a catalogue the same payload publishes, so
 * the entire space of single-dimension selections is a few hundred candidates
 * and the whole space of realistic selections a few thousand — precomputable in
 * milliseconds. A digest that can be reversed by a dictionary is a value
 * written in a way that looks safe. `ShadowFilterScope` therefore records what
 * is genuinely safe and nothing else: whether a filter was applied, how many
 * dimensions it constrained, and those dimension KEYS that match a conservative
 * shape. No value, hashed or otherwise, ever appears.
 *
 * TWO AUDIENCES, TWO SHAPES. `ShadowDiagnostics` is the FULL local operator
 * evidence: it lives for the length of one call, is printed by a command-line
 * operator a human is watching, and may carry the aggregates both layers
 * already publish. `ShadowRuntimeRecord` is what a running server may hand to a
 * sink, and it carries codes and totals ONLY — never a value, never a base.
 * `runtimeShadowRecord` in `diagnostics.ts` is the one function that turns the
 * first into the second, and it is a whitelist, not a redaction pass.
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

/**
 * EVERY key a finding may carry, exhaustively.
 *
 * The comparator may not construct a key; it may only choose one from here. A
 * study-specific key — a metric key, a segment key, a touchpoint name — is
 * therefore impossible to emit even by accident, which is the property that
 * lets the runtime record carry the key at all.
 */
export const SHADOW_FINDING_KEYS = [
  "disclosure.small_sample_suppression",
  "journey.groups",
  "journey.touchpoints",
  "legacy.crosses",
  "legacy.filterOptions",
  "legacy.metric_keys.csat",
  "legacy.metric_keys.desempeno",
  "legacy.metric_keys.other",
  "legacy.metric_keys.tdp",
  "legacy.pivot.allowlist",
  "performance.dimensions",
  "population.measured",
  "population.selected",
  "population.total",
  "qualitative.curatedFindingCounts",
  "qualitative.curated_journey_cloud",
  "recommendation.nps.activos.value",
  "recommendation.nps.combinado.base",
  "recommendation.nps.combinado.value",
  "recommendation.nps.desertores.value",
  "renewal.cri.base",
  "renewal.cri.value",
  "renewal.forbidden_cross",
  "retention.periods",
] as const;

export type ShadowFindingKey = (typeof SHADOW_FINDING_KEYS)[number];

/** The document sections a key may belong to. Also closed. */
export const SHADOW_SECTIONS = [
  "crosses",
  "disclosure",
  "filters",
  "journey",
  "legacy_metric_space",
  "performance",
  "pivot",
  "population",
  "qualitative",
  "recommendation",
  "renewal",
  "retention",
] as const;

export type ShadowSection = (typeof SHADOW_SECTIONS)[number];

/**
 * How equality was decided. A closed list, so `rule` cannot carry a sentence.
 *
 * `decimals:<n>` stops at six because no contract in this product declares more
 * — `DECIMALS` in `calc/metrics.ts` tops out at two — and an open-ended
 * template would be an open-ended string again.
 */
export const COMPARISON_RULES = [
  "exact",
  "not-compared",
  "decimals:0",
  "decimals:1",
  "decimals:2",
  "decimals:3",
  "decimals:4",
  "decimals:5",
  "decimals:6",
] as const;

export type ComparisonRule = (typeof COMPARISON_RULES)[number];

/** `decimals:<n>` as a contract value, or a refusal. Never a free string. */
export function decimalsRule(decimals: number): ComparisonRule {
  const candidate = `decimals:${decimals}`;
  const found = COMPARISON_RULES.find((rule) => rule === candidate);
  if (!found) throw new RangeError("decimals is outside the declared comparison rules");
  return found;
}

/**
 * WHY a field was not compared, or what the reader must know about one that
 * was. A closed vocabulary — never a message, never prose, never a value.
 *
 * The sentences these replaced are in `docs/LEGACY_CANONICAL_COMPATIBILITY.md`
 * §4 and §7 and in the comments of `compare.ts`. A code is what a machine may
 * store; the explanation is what a human reads, and the two do not belong in
 * the same field.
 */
export const NOTE_CODES = [
  /* absence and unreadability, on either side */
  "legacy_absent",
  "legacy_suppressed",
  "legacy_unparseable",
  "canonical_unavailable",

  /* the named transformations */
  "measured_population_definitions_differ",
  "nps_scale_differs",
  "cri_precision_differs",
  "unfiltered_selection_only",

  /* what only one side can answer */
  "canonical_population_has_no_legacy_counterpart",
  "legacy_has_no_cohort_split",
  "canonical_refuses_a_cross_legacy_cannot_express",
  "canonical_only_per_touchpoint_results",
  "canonical_only_source_grouping",
  "canonical_only_retention_identity",
  "canonical_only_monthly_performance",
  "canonical_only_curated_finding_counts",
  "legacy_only_pivot_explorer",
  "legacy_filter_key_space_differs",
  "legacy_cross_needs_presentation_map",
  "canonical_reports_base_legacy_suppresses",
  "editorial_content_differs_on_both_sides",

  /* the key spaces a configured presentation map would unlock */
  "canonical_counterpart_is_top_box_share",
  "canonical_counterpart_is_unaware_share_not_tdp",
  "canonical_counterpart_is_performance_periods",
  "no_canonical_counterpart_stated",

  /* the filter scope — Phase 3.1 */
  "filtered_scope_not_comparable",
  "legacy_value_withheld_under_filter",
] as const;

export type NoteCode = (typeof NOTE_CODES)[number];

/** The exact fields one finding may carry. Nothing else may be added here. */
export type ShadowFinding = {
  /** One of `SHADOW_FINDING_KEYS`. Stable, and never study-specific. */
  key: ShadowFindingKey;
  /** Which document section the key belongs to. */
  section: ShadowSection;
  classification: CompatibilityClassification;
  /** True only when the two agreed under the declared rule. Null when not compared. */
  agrees: boolean | null;
  /** Set only when `agrees` is false, or when a scope refuses the comparison. */
  mismatch: MismatchKind | null;
  /** An aggregate both layers already publish, or null when not compared. */
  legacyValue: number | null;
  canonicalValue: number | null;
  /** The denominators, when the field has one on both sides. */
  legacyBase: number | null;
  canonicalBase: number | null;
  /** How equality was decided. One of `COMPARISON_RULES`. */
  rule: ComparisonRule;
  /** Why, as one code from `NOTE_CODES`. Never a message. */
  noteCode: NoteCode | null;
};

/**
 * The applied filter selection, described without describing it.
 *
 * `dimensionCount` is always the truth. `dimensionKeys` is the subset of those
 * keys whose shape is conservative enough to record: a legacy segment key is
 * whatever column the study's workbook happened to carry, so a key that is not
 * plainly a machine identifier is counted and dropped rather than published.
 * There is no field for a value.
 */
export type ShadowFilterScope = {
  filtered: boolean;
  dimensionKeys: string[];
  dimensionCount: number;
};

/** The complete, safe result of one shadow run — the LOCAL OPERATOR evidence. */
export type ShadowDiagnostics = {
  status: ShadowStatus;
  /** The tenant and study the run was authorized for. Uuids, never names. */
  tenantId: string;
  studyId: string;
  /** What was filtered, never what it was filtered to. */
  filterScope: ShadowFilterScope;
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
  filterScope: ShadowFilterScope,
): ShadowDiagnostics {
  return {
    status,
    tenantId,
    studyId,
    filterScope,
    contractVersion: null,
    planFingerprint: null,
    packageIdempotencyKey: null,
    budgetMs,
    elapsedMs: 0,
    findings: [],
    counts: { compared: 0, agreed: 0, disagreed: 0, classified: 0 },
  };
}
