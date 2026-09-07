/**
 * THE SEMANTIC COMPARATOR — legacy payload against canonical document.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * IT IS NOT A DEEP EQUALITY CHECK, and it must never become one. The two
 * payloads are different shapes answering overlapping questions: the legacy
 * `StudyDashboardPayload` publishes formatted strings for a metric-key space
 * the legacy adapter invented at import time (`csat_interacciones_…_ap`), and
 * `CanonicalStudyResults` publishes typed aggregates over the projector's own
 * key space (`csat_ax`). A structural diff of the two says nothing true.
 *
 * SO ONLY AN AUTHORITATIVE CORRESPONDENCE IS COMPARED. A field is compared here
 * only when an authority states the correspondence and NO ALIAS TABLE is needed
 * to find it:
 *
 *   `nps`  the legacy metric key is literally `nps` and the canonical
 *          `combinado` scope is the study-wide recommendation. One name, one
 *          meaning, both sides.
 *   `cri`  the legacy metric key is literally `cri` and the canonical renewal
 *          index is the study's one churn-risk index.
 *   population  a distinct-person count on both sides.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * AND NOTHING FILTERED IS COMPARED AT ALL. (Phase 3.1 — the correction.)
 *
 * `shadow/server.ts` reads the canonical document by TENANT AND STUDY. It does
 * not apply the request's legacy filter selection, and it cannot: a legacy
 * filter selects over legacy segment keys (`esfera`, `estado_membresia`) and a
 * canonical filter over canonical attribute keys (`perfil_cliente_h`), and no
 * authority maps one onto the other. Until that configuration exists, the
 * canonical document is ALWAYS the unfiltered one.
 *
 * Phase 3 guarded `population.selected` for exactly this reason and then
 * compared the filtered legacy NPS and the filtered legacy CRI against that
 * unfiltered document anyway. That is not a weaker comparison; it is a WRONG
 * one, and it could produce either a false agreement (a filter that happens to
 * leave the number unchanged) or a false disagreement (any filter that does
 * not). Both are worse than reporting nothing.
 *
 * So under an active filter every quantity the filter touches is reported
 * `presentation_configuration_required` with mismatch `filter_scope`, `agrees`
 * null and NO NUMBERS. What the filter touches is not a judgement call — it is
 * read off `dashboard/view.ts`:
 *
 *   FILTERED, because they are computed from `filteredRows` /
 *   `filteredQualitative` or from `selectedCount` (view.ts:184-190, 215-277):
 *     view.tiles          → `recommendation.nps.combinado.{value,base}`
 *     view.averages       → `renewal.cri.{value,base}`, `legacy.metric_keys.*`
 *     view.selectedUnits  → `population.selected`
 *     view.selectionVisibility → `disclosure.small_sample_suppression`
 *     view.crosses        → `legacy.crosses`
 *     view.qualitative    → `qualitative.curated_journey_cloud`
 *
 *   NOT FILTERED, provably, and therefore still comparable:
 *     view.sourceUnits    → `population.measured`   (view.ts:186 counts `rows`
 *                           and `qualitative`, not their filtered forms; 268
 *                           suppresses on that same unfiltered count)
 *     filterOptions       → `legacy.filterOptions`  (view.ts:182, unfiltered)
 *     pivotAllowlist      → `legacy.pivot.allowlist` (view.ts:183, unfiltered)
 *
 * That last group is why a filtered run is not simply empty, and it is pinned
 * by a gate: `shadow-boundary-test.mjs` asserts `sourceUnits`, `filterOptions`
 * and `pivotAllowlist` are identical between a filtered and an unfiltered build
 * of the same fixtures, so the day someone filters them the gate fails instead
 * of this comment quietly becoming false.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * EVERYTHING PER-TOUCHPOINT IS CLASSIFIED, NOT COMPARED. Matching
 * `csat_rendicion_de_cuentas_1_a_1` to `csat_bj` needs a study-level map from a
 * legacy metric key to a canonical item key. That map is real — the human
 * approved it at import time, and `import_mapping.configuration` plus
 * `source_lineage.source_column` could reconstruct it — but it is
 * CONFIGURATION, and inventing one here is exactly the hand-written alias table
 * `docs/CANONICAL_RESULTS_MODEL.md` forbids copying into production code. Those
 * fields are reported `presentation_configuration_required`, and the canonical
 * counterpart each one would map to is named in
 * `docs/LEGACY_CANONICAL_COMPATIBILITY.md` §7 rather than in a string field.
 *
 * IT PARSES DISPLAY STRINGS ONLY WHERE THE LEGACY PAYLOAD HAS NOTHING ELSE, and
 * strictly. `SafeMetric.value` is a formatted string and `SafeMetric.detail` is
 * a sentence; a value that does not match the exact expected shape is reported
 * `legacy_unparseable` and NOT compared. A comparator that guessed at a number
 * would manufacture agreement, which is worse than reporting none.
 *
 * PURE, DETERMINISTIC, TRANSPORT-FREE, AND ORDERED. Findings come out sorted by
 * key so two runs over the same inputs produce the same array. Every key and
 * every note is a member of a closed list in `contract.ts`, so a study-specific
 * string cannot leave this file even by accident.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { DECIMALS, roundTo } from "../calc/metrics";
import type { CanonicalStudyResults, MetricResult } from "../results/contract";
import type { StudyDashboardPayload, SafeMetric } from "../dashboard/view";
import { decimalsRule, type ShadowFinding, type ShadowFindingKey, type ShadowSection } from "./contract";

/** The legacy metric keys whose canonical counterpart needs no alias table. */
export const DIRECTLY_CORRESPONDING_LEGACY_KEYS = ["nps", "cri"] as const;

/** The legacy metric-key prefixes whose correspondence needs configuration. */
export const CONFIGURATION_REQUIRED_PREFIXES = ["csat_", "tdp_", "desempeno_"] as const;

/**
 * The finding key each prefix is reported under, and the one for everything
 * else. Closed, so a study's own metric key can never become a finding key.
 */
const PREFIX_FINDING_KEY = {
  "csat_": "legacy.metric_keys.csat",
  "tdp_": "legacy.metric_keys.tdp",
  "desempeno_": "legacy.metric_keys.desempeno",
  other: "legacy.metric_keys.other",
} as const satisfies Record<string, ShadowFindingKey>;

type PrefixBucket = keyof typeof PREFIX_FINDING_KEY;

/**
 * The canonical counterpart a configured presentation map would point each
 * prefix at. A code, because the sentence belongs in the compatibility document
 * and a code is what a machine may store.
 *
 * ⚠️ `tdp_` is deliberately NOT `touchpoints[].tdp`. The legacy `tdp_` columns
 * hold a per-person 0/100 flag whose mean is the unawareness share over ALL
 * responses; `touchpoints[].tdp` is the ratio over the VALID base. A map that
 * pointed one at the other would compare two different quantities.
 */
const PREFIX_NOTE = {
  "csat_": "canonical_counterpart_is_top_box_share",
  "tdp_": "canonical_counterpart_is_unaware_share_not_tdp",
  "desempeno_": "canonical_counterpart_is_performance_periods",
  other: "no_canonical_counterpart_stated",
} as const satisfies Record<PrefixBucket, ShadowFinding["noteCode"]>;

/** The order the prefix buckets are reported in, filtered or not. */
const PREFIX_BUCKETS = ["csat_", "tdp_", "desempeno_", "other"] as const satisfies readonly PrefixBucket[];

type Finding = ShadowFinding;

function finding(partial: Partial<Finding> & Pick<Finding, "key" | "section" | "classification">): Finding {
  return {
    agrees: null,
    mismatch: null,
    legacyValue: null,
    canonicalValue: null,
    legacyBase: null,
    canonicalBase: null,
    rule: "not-compared",
    noteCode: null,
    ...partial,
  };
}

/**
 * A comparison the active filter makes impossible.
 *
 * No number, no agreement, no disagreement — and the classification says what
 * would make it possible: an approved presentation mapping between the legacy
 * filter key space and the canonical attribute key space.
 */
function filterScoped(key: ShadowFindingKey, section: ShadowSection): Finding {
  return finding({
    key,
    section,
    classification: "presentation_configuration_required",
    mismatch: "filter_scope",
    noteCode: "filtered_scope_not_comparable",
  });
}

/**
 * A finding that is never compared but whose legacy NUMBER the filter changes.
 *
 * The classification is the truth about the field and stays; the number is
 * withheld, because "a count of legacy metric keys under this selection" is
 * still a quantity derived from a filtered population and this diagnostic has
 * no business carrying one.
 */
function valueWithheld(
  key: ShadowFindingKey,
  section: ShadowSection,
  classification: Finding["classification"],
  canonicalValue: number | null = null,
): Finding {
  return finding({
    key,
    section,
    classification,
    mismatch: "filter_scope",
    canonicalValue,
    noteCode: "legacy_value_withheld_under_filter",
  });
}

/**
 * A legacy `SafeMetric.value`, parsed strictly.
 *
 * The payload formats with `formatNumber`, which uses a plain `.` decimal
 * separator and may append `%`. Anything else — an em dash for null, a
 * suppressed null, a sentence — is NOT a number and is reported as such.
 */
export function parseLegacyNumber(value: string | null): number | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().replace(/%$/, "");
  if (!/^-?\d+(\.\d+)?$/.test(trimmed)) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

/** The `n=<count>` a legacy average carries in its detail sentence. */
export function parseLegacyBase(detail: string | null): number | null {
  if (typeof detail !== "string") return null;
  const match = /(?:^|\s)n=(\d+)(?:\s|$)/.exec(detail);
  if (!match) return null;
  const parsed = Number(match[1]);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

/** The `n=<count>` the NPS tile carries at the end of its detail sentence. */
export function parseNpsBase(detail: string | null): number | null {
  return parseLegacyBase(detail);
}

function metricValue(metric: MetricResult | undefined): number | null {
  if (!metric || metric.status !== "available") return null;
  return metric.value.value;
}

function metricBase(metric: MetricResult | undefined): number | null {
  return metric ? metric.base.valid : null;
}

/**
 * Compare two already-rounded aggregates at a declared precision.
 *
 * Both sides round exactly once at their own contract precision, and those
 * precisions differ by design — the legacy mean of a score rounds at
 * `DECIMALS.score` (2) while the canonical index rounds at `DECIMALS.percent`
 * (1). Comparing them at the COARSER of the two is the only honest rule: it
 * asks "do these describe the same number" rather than "did two contracts
 * choose the same number of decimals", which is a documented difference and not
 * a disagreement.
 */
function agreesAt(left: number, right: number, decimals: number): boolean {
  return Object.is(roundTo(left, decimals), roundTo(right, decimals));
}

function tile(payload: StudyDashboardPayload, key: string): SafeMetric | undefined {
  return payload.view.tiles.find((entry) => entry.key === key);
}

function average(payload: StudyDashboardPayload, metricKey: string): SafeMetric | undefined {
  return payload.view.averages.find((entry) => entry.key === `average:${metricKey}`);
}

function scope(results: CanonicalStudyResults, key: string) {
  return results.recommendation.scopes.find((entry) => entry.key === key);
}

/**
 * Compare one legacy payload with one canonical document.
 *
 * Both are already-computed aggregates. Nothing here recalculates a business
 * metric: it reads what each layer published and says whether the two agree.
 *
 * `options.filtered` is the request's own answer to "did the reader constrain
 * the population", and it is authoritative here: it comes from the SAME
 * already-validated selection `buildStudyDashboard` was given.
 */
export function compareLegacyWithCanonical(
  legacy: StudyDashboardPayload,
  canonical: CanonicalStudyResults,
  options: { filtered: boolean },
): Finding[] {
  const findings: Finding[] = [];
  const filtered = options.filtered === true;

  // ---------------------------------------------------------------------------
  // POPULATION. The legacy payload has ONE kind of person count and the
  // canonical contract has two, and the difference is the point of the
  // contract: `total` is the study POPULATION and `measured` is the people the
  // study holds a datum about. The legacy layer never sees a roster — it counts
  // whoever left a quantitative answer or a confirmed qualitative observation —
  // so its `sourceUnits` corresponds to `measured`, and `total` has no legacy
  // counterpart at all. Reporting `total` as a mismatch would call a capability
  // the legacy layer does not have a canonical defect.
  //
  // `sourceUnits` is the UNFILTERED count on both sides (view.ts:186, 268), so
  // this one comparison survives a filter — see the header.
  // ---------------------------------------------------------------------------
  const sourceUnits = legacy.view.sourceUnits;
  findings.push(
    sourceUnits === null
      ? finding({
          key: "population.measured",
          section: "population",
          classification: "equivalent_after_named_transformation",
          noteCode: "legacy_suppressed",
        })
      : finding({
          key: "population.measured",
          section: "population",
          classification: "equivalent_after_named_transformation",
          agrees: sourceUnits === canonical.population.measured,
          mismatch: sourceUnits === canonical.population.measured ? null : "base",
          legacyValue: sourceUnits,
          canonicalValue: canonical.population.measured,
          rule: "exact",
          noteCode: "measured_population_definitions_differ",
        }),
  );

  findings.push(
    finding({
      key: "population.total",
      section: "population",
      classification: "canonical_only",
      canonicalValue: canonical.population.total,
      noteCode: "canonical_population_has_no_legacy_counterpart",
    }),
  );

  // The selected count is only comparable UNFILTERED: a legacy filter selects
  // over legacy segment keys and a canonical filter over canonical attribute
  // keys, and no authority maps one onto the other.
  const selectedUnits = legacy.view.selectedUnits;
  findings.push(
    filtered
      ? filterScoped("population.selected", "population")
      : selectedUnits === null
        ? finding({
            key: "population.selected",
            section: "population",
            classification: "equivalent_after_named_transformation",
            noteCode: "legacy_suppressed",
          })
        : finding({
            key: "population.selected",
            section: "population",
            classification: "equivalent_after_named_transformation",
            agrees: selectedUnits === canonical.population.measured,
            mismatch: selectedUnits === canonical.population.measured ? null : "base",
            legacyValue: selectedUnits,
            canonicalValue: canonical.population.measured,
            rule: "exact",
            noteCode: "unfiltered_selection_only",
          }),
  );

  // ---------------------------------------------------------------------------
  // RECOMMENDATION. The legacy metric key is literally `nps`; the canonical
  // `combinado` scope is the study-wide recommendation over both cohorts. One
  // name, one meaning. The scales differ by one value — legacy accepts 0-10 and
  // the confirmed Be Community scale is 1-10 — so the transformation is named.
  //
  // UNDER A FILTER NEITHER THE VALUE NOR THE BASE IS TOUCHED. `view.tiles` is
  // computed from `filteredRows` and is EMPTY when the selection is suppressed,
  // so a filtered run could otherwise report "legacy absent" as a disagreement
  // about a number the canonical side never claimed to answer.
  // ---------------------------------------------------------------------------
  const npsTile = tile(legacy, "nps");
  const combined = scope(canonical, "combinado");
  const canonicalNps = metricValue(combined?.score);
  const canonicalNpsBase = metricBase(combined?.score);
  const legacyNps = parseLegacyNumber(npsTile?.value ?? null);
  const legacyNpsBase = parseNpsBase(npsTile?.detail ?? null);

  if (filtered) {
    findings.push(filterScoped("recommendation.nps.combinado.value", "recommendation"));
    findings.push(filterScoped("recommendation.nps.combinado.base", "recommendation"));
  } else {
    if (!npsTile) {
      findings.push(
        finding({
          key: "recommendation.nps.combinado.value",
          section: "recommendation",
          classification: "equivalent_after_named_transformation",
          mismatch: "availability",
          agrees: canonicalNps === null,
          canonicalValue: canonicalNps,
          canonicalBase: canonicalNpsBase,
          noteCode: "legacy_absent",
        }),
      );
    } else if (legacyNps === null || canonicalNps === null) {
      findings.push(
        finding({
          key: "recommendation.nps.combinado.value",
          section: "recommendation",
          classification: "equivalent_after_named_transformation",
          mismatch: "availability",
          agrees: legacyNps === null && canonicalNps === null,
          legacyValue: legacyNps,
          canonicalValue: canonicalNps,
          noteCode: legacyNps === null ? "legacy_unparseable" : "canonical_unavailable",
        }),
      );
    } else {
      const same = agreesAt(legacyNps, canonicalNps, DECIMALS.nps);
      findings.push(
        finding({
          key: "recommendation.nps.combinado.value",
          section: "recommendation",
          classification: "equivalent_after_named_transformation",
          agrees: same,
          mismatch: same ? null : "value",
          legacyValue: legacyNps,
          canonicalValue: canonicalNps,
          legacyBase: legacyNpsBase,
          canonicalBase: canonicalNpsBase,
          rule: decimalsRule(DECIMALS.nps),
          noteCode: "nps_scale_differs",
        }),
      );
    }

    if (legacyNpsBase !== null && canonicalNpsBase !== null) {
      const same = legacyNpsBase === canonicalNpsBase;
      findings.push(
        finding({
          key: "recommendation.nps.combinado.base",
          section: "recommendation",
          classification: "exact_equivalent",
          agrees: same,
          mismatch: same ? null : "base",
          legacyValue: legacyNpsBase,
          canonicalValue: canonicalNpsBase,
          rule: "exact",
        }),
      );
    } else {
      findings.push(
        finding({
          key: "recommendation.nps.combinado.base",
          section: "recommendation",
          classification: "exact_equivalent",
          mismatch: "availability",
          noteCode: legacyNpsBase === null ? "legacy_unparseable" : "canonical_unavailable",
        }),
      );
    }
  }

  // The per-cohort scopes have no legacy counterpart at all: the legacy engine
  // computes ONE nps over every row that carries the key. Canonical-only, and
  // the canonical document is unfiltered whatever the request asked for.
  for (const [key, canonicalKey] of [
    ["recommendation.nps.activos.value", "activos"],
    ["recommendation.nps.desertores.value", "desertores"],
  ] as const) {
    const cohortScope = scope(canonical, canonicalKey);
    findings.push(
      finding({
        key,
        section: "recommendation",
        classification: "canonical_only",
        canonicalValue: metricValue(cohortScope?.score),
        canonicalBase: metricBase(cohortScope?.score),
        noteCode: "legacy_has_no_cohort_split",
      }),
    );
  }

  // ---------------------------------------------------------------------------
  // RENEWAL. The legacy metric key is literally `cri` and its per-person values
  // are the confirmed risk weights, so the legacy AVERAGE of that key and the
  // canonical churn-risk index are the same arithmetic mean over the same base.
  // They round at different declared precisions, so the comparison uses the
  // coarser one — and, like the NPS, only when nothing is filtered.
  // ---------------------------------------------------------------------------
  const criAverage = average(legacy, "cri");
  const canonicalCri = metricValue(canonical.renewal.index);
  const canonicalCriBase = canonical.renewal.base.valid;
  const legacyCri = parseLegacyNumber(criAverage?.value ?? null);
  const legacyCriBase = parseLegacyBase(criAverage?.detail ?? null);

  if (filtered) {
    findings.push(filterScoped("renewal.cri.value", "renewal"));
    findings.push(filterScoped("renewal.cri.base", "renewal"));
  } else {
    if (legacyCri === null || canonicalCri === null) {
      findings.push(
        finding({
          key: "renewal.cri.value",
          section: "renewal",
          classification: "equivalent_after_named_transformation",
          mismatch: "availability",
          agrees: legacyCri === null && canonicalCri === null,
          legacyValue: legacyCri,
          canonicalValue: canonicalCri,
          noteCode: !criAverage
            ? "legacy_absent"
            : legacyCri === null
              ? "legacy_unparseable"
              : "canonical_unavailable",
        }),
      );
    } else {
      // The coarser of the two declared precisions. Legacy rounds a score at 2,
      // the canonical index rounds a percent-scaled quantity at 1.
      const decimals = Math.min(DECIMALS.score, DECIMALS.percent);
      const same = agreesAt(legacyCri, canonicalCri, decimals);
      findings.push(
        finding({
          key: "renewal.cri.value",
          section: "renewal",
          classification: "equivalent_after_named_transformation",
          agrees: same,
          mismatch: same ? null : "value",
          legacyValue: legacyCri,
          canonicalValue: canonicalCri,
          legacyBase: legacyCriBase,
          canonicalBase: canonicalCriBase,
          rule: decimalsRule(decimals),
          noteCode: "cri_precision_differs",
        }),
      );
    }

    if (legacyCriBase !== null) {
      const same = legacyCriBase === canonicalCriBase;
      findings.push(
        finding({
          key: "renewal.cri.base",
          section: "renewal",
          classification: "exact_equivalent",
          agrees: same,
          mismatch: same ? null : "base",
          legacyValue: legacyCriBase,
          canonicalValue: canonicalCriBase,
          rule: "exact",
        }),
      );
    } else {
      findings.push(
        finding({
          key: "renewal.cri.base",
          section: "renewal",
          classification: "exact_equivalent",
          mismatch: "availability",
          noteCode: criAverage ? "legacy_unparseable" : "legacy_absent",
        }),
      );
    }
  }

  // The refused cross is reported as a FACT of the canonical contract, never as
  // a disagreement: the legacy layer has no concept of a forbidden cross, so
  // there is nothing on the other side to disagree with.
  const forbidden = canonical.filters.dimensions
    .flatMap((dimension) => dimension.forbiddenSections.map((entry) => `${dimension.key}/${entry.section}`))
    .sort();
  findings.push(
    finding({
      key: "renewal.forbidden_cross",
      section: "renewal",
      classification: "canonical_only",
      mismatch: forbidden.length > 0 ? "forbidden_cross" : null,
      canonicalValue: forbidden.length,
      noteCode: "canonical_refuses_a_cross_legacy_cannot_express",
    }),
  );

  // ---------------------------------------------------------------------------
  // THE KEY SPACES THAT NEED A CONFIGURED MAP. Every legacy average whose key
  // carries one of the configuration-required prefixes is reported once, by
  // prefix. Reporting 122 identical findings would bury the three that were
  // actually compared.
  //
  // `view.averages` is computed from `filteredRows` and is EMPTY under a
  // suppressed selection, so under a filter the COUNT is withheld.
  //
  // ALL FOUR BUCKETS ARE ALWAYS EMITTED, including the ones this study has none
  // of. A bucket that appeared only when the data happened to contain it would
  // make the finding SET depend on the data — so a filtered run and an
  // unfiltered run of the same study could report different numbers of
  // findings, and "24 findings" would stop being a property anything could
  // check. `legacyValue: 0` is also a true and useful statement: this payload
  // publishes no average under that prefix.
  // ---------------------------------------------------------------------------
  const prefixCounts = new Map<PrefixBucket, number>(PREFIX_BUCKETS.map((bucket) => [bucket, 0]));
  for (const entry of legacy.view.averages) {
    const metricKey = entry.key.replace(/^average:/, "");
    if ((DIRECTLY_CORRESPONDING_LEGACY_KEYS as readonly string[]).includes(metricKey)) continue;
    const prefix: PrefixBucket =
      CONFIGURATION_REQUIRED_PREFIXES.find((candidate) => metricKey.startsWith(candidate)) ?? "other";
    prefixCounts.set(prefix, (prefixCounts.get(prefix) ?? 0) + 1);
  }
  for (const bucket of PREFIX_BUCKETS) {
    const classification = bucket === "other" ? "legacy_only" : "presentation_configuration_required";
    findings.push(
      filtered
        ? valueWithheld(PREFIX_FINDING_KEY[bucket], "legacy_metric_space", classification)
        : finding({
            key: PREFIX_FINDING_KEY[bucket],
            section: "legacy_metric_space",
            classification,
            mismatch: bucket === "other" ? null : "presentation_only",
            legacyValue: prefixCounts.get(bucket) ?? 0,
            noteCode: PREFIX_NOTE[bucket],
          }),
    );
  }

  // ---------------------------------------------------------------------------
  // WHAT EACH LAYER HAS AND THE OTHER DOES NOT.
  // ---------------------------------------------------------------------------
  const canonicalOnly: [ShadowFindingKey, ShadowSection, number | null, ShadowFinding["noteCode"]][] = [
    ["journey.touchpoints", "journey", canonical.journey.touchpoints.length, "canonical_only_per_touchpoint_results"],
    ["journey.groups", "journey", canonical.journey.groups.length, "canonical_only_source_grouping"],
    ["retention.periods", "retention", canonical.retention.periods.length, "canonical_only_retention_identity"],
    [
      "performance.dimensions",
      "performance",
      canonical.performance.dimensions.length,
      "canonical_only_monthly_performance",
    ],
    [
      "qualitative.curatedFindingCounts",
      "qualitative",
      canonical.qualitative.curatedFindingCounts.length,
      "canonical_only_curated_finding_counts",
    ],
  ];
  for (const [key, section, value, noteCode] of canonicalOnly) {
    findings.push(finding({ key, section, classification: "canonical_only", canonicalValue: value, noteCode }));
  }

  // The pivot allowlist and the filter catalogue are both built from the
  // UNFILTERED rows (view.ts:182-183), so their counts stay legible under a
  // filter. The cross series are not (view.ts:223), so that one is withheld.
  findings.push(
    finding({
      key: "legacy.pivot.allowlist",
      section: "pivot",
      classification: "legacy_only",
      legacyValue: legacy.pivotAllowlist.dimensions.length + legacy.pivotAllowlist.metrics.length,
      noteCode: "legacy_only_pivot_explorer",
    }),
  );
  findings.push(
    finding({
      key: "legacy.filterOptions",
      section: "filters",
      classification: "legacy_only",
      legacyValue: legacy.filterOptions.length,
      noteCode: "legacy_filter_key_space_differs",
    }),
  );
  findings.push(
    filtered
      ? valueWithheld("legacy.crosses", "crosses", "legacy_only")
      : finding({
          key: "legacy.crosses",
          section: "crosses",
          classification: "legacy_only",
          legacyValue: legacy.view.crosses.length,
          noteCode: "legacy_cross_needs_presentation_map",
        }),
  );

  // Suppression is the one place the two layers deliberately DISAGREE about
  // what to publish, so it is a replacement rather than a mismatch. Under a
  // filter the legacy side of it IS the disclosure decision about the selected
  // subgroup, so the flag is withheld rather than published.
  findings.push(
    filtered
      ? valueWithheld("disclosure.small_sample_suppression", "disclosure", "canonical_replacement", 0)
      : finding({
          key: "disclosure.small_sample_suppression",
          section: "disclosure",
          classification: "canonical_replacement",
          legacyValue: legacy.view.selectionVisibility === "suppressed" ? 1 : 0,
          canonicalValue: 0,
          noteCode: "canonical_reports_base_legacy_suppresses",
        }),
  );

  // The curated journey cloud is editorial content by decision, on both sides.
  // The legacy side counts CONFIRMED QUALITATIVE THEMES over the filtered
  // observations (view.ts:274-276), so under a filter only the canonical side
  // is reported.
  const canonicalCloud = canonical.configurationRequired.some((item) => item.key === "curated_journey_pain_cloud")
    ? 1
    : 0;
  findings.push(
    filtered
      ? valueWithheld("qualitative.curated_journey_cloud", "qualitative", "editorial_configuration_required", canonicalCloud)
      : finding({
          key: "qualitative.curated_journey_cloud",
          section: "qualitative",
          classification: "editorial_configuration_required",
          mismatch: "editorial_only",
          legacyValue: legacy.view.qualitative.themes.length,
          canonicalValue: canonicalCloud,
          noteCode: "editorial_content_differs_on_both_sides",
        }),
  );

  return findings.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
}
