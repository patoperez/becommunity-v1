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
 * EVERYTHING PER-TOUCHPOINT IS CLASSIFIED, NOT COMPARED. Matching
 * `csat_rendicion_de_cuentas_1_a_1` to `csat_bj` needs a study-level map from a
 * legacy metric key to a canonical item key. That map is real — the human
 * approved it at import time, and `import_mapping.configuration` plus
 * `source_lineage.source_column` could reconstruct it — but it is
 * CONFIGURATION, and inventing one here is exactly the hand-written alias table
 * `docs/CANONICAL_RESULTS_MODEL.md` forbids copying into production code. Those
 * fields are reported `presentation_configuration_required`, with the canonical
 * counterpart NAMED so the configuration that would unlock them is obvious.
 *
 * IT PARSES DISPLAY STRINGS ONLY WHERE THE LEGACY PAYLOAD HAS NOTHING ELSE, and
 * strictly. `SafeMetric.value` is a formatted string and `SafeMetric.detail` is
 * a sentence; a value that does not match the exact expected shape is reported
 * `legacy_unparseable` and NOT compared. A comparator that guessed at a number
 * would manufacture agreement, which is worse than reporting none.
 *
 * PURE, DETERMINISTIC, TRANSPORT-FREE, AND ORDERED. Findings come out sorted by
 * key so two runs over the same inputs produce the same array.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { DECIMALS, roundTo } from "../calc/metrics";
import type { CanonicalStudyResults, MetricResult } from "../results/contract";
import type { StudyDashboardPayload, SafeMetric } from "../dashboard/view";
import type { ShadowFinding } from "./contract";

/** The legacy metric keys whose canonical counterpart needs no alias table. */
export const DIRECTLY_CORRESPONDING_LEGACY_KEYS = ["nps", "cri"] as const;

/** The legacy metric-key prefixes whose correspondence needs configuration. */
export const CONFIGURATION_REQUIRED_PREFIXES = ["csat_", "tdp_", "desempeno_"] as const;

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
    note: null,
    ...partial,
  };
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
 */
export function compareLegacyWithCanonical(
  legacy: StudyDashboardPayload,
  canonical: CanonicalStudyResults,
  options: { filtered: boolean },
): Finding[] {
  const findings: Finding[] = [];

  // ---------------------------------------------------------------------------
  // POPULATION. The legacy payload has ONE kind of person count and the
  // canonical contract has two, and the difference is the point of the
  // contract: `total` is the study POPULATION and `measured` is the people the
  // study holds a datum about. The legacy layer never sees a roster — it counts
  // whoever left a quantitative answer or a confirmed qualitative observation —
  // so its `sourceUnits` corresponds to `measured`, and `total` has no legacy
  // counterpart at all. Reporting `total` as a mismatch would call a capability
  // the legacy layer does not have a canonical defect.
  // ---------------------------------------------------------------------------
  const sourceUnits = legacy.view.sourceUnits;
  findings.push(
    sourceUnits === null
      ? finding({
          key: "population.measured",
          section: "population",
          classification: "equivalent_after_named_transformation",
          note: "legacy_suppressed",
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
          note: "legacy counts a quantitative answer or a confirmed qualitative observation; canonical counts an answered session, performance observation or declared measurement attribute",
        }),
  );

  findings.push(
    finding({
      key: "population.total",
      section: "population",
      classification: "canonical_only",
      canonicalValue: canonical.population.total,
      note: "the legacy payload has no field for the study population; it can only count people who answered",
    }),
  );

  // The selected count is only comparable UNFILTERED: a legacy filter selects
  // over legacy segment keys and a canonical filter over canonical attribute
  // keys, and no authority maps one onto the other.
  const selectedUnits = legacy.view.selectedUnits;
  findings.push(
    options.filtered
      ? finding({
          key: "population.selected",
          section: "population",
          classification: "presentation_configuration_required",
          mismatch: "filter_scope",
          note: "legacy and canonical filter dimensions are different key spaces",
        })
      : selectedUnits === null
        ? finding({
            key: "population.selected",
            section: "population",
            classification: "equivalent_after_named_transformation",
            note: "legacy_suppressed",
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
            note: "unfiltered selection only; the canonical document is read unfiltered",
          }),
  );

  // ---------------------------------------------------------------------------
  // RECOMMENDATION. The legacy metric key is literally `nps`; the canonical
  // `combinado` scope is the study-wide recommendation over both cohorts. One
  // name, one meaning. The scales differ by one value — legacy accepts 0-10 and
  // the confirmed Be Community scale is 1-10 — so the transformation is named.
  // ---------------------------------------------------------------------------
  const npsTile = tile(legacy, "nps");
  const combined = scope(canonical, "combinado");
  const canonicalNps = metricValue(combined?.score);
  const canonicalNpsBase = metricBase(combined?.score);
  const legacyNps = parseLegacyNumber(npsTile?.value ?? null);
  const legacyNpsBase = parseNpsBase(npsTile?.detail ?? null);

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
        note: "legacy_absent",
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
        note: legacyNps === null ? "legacy_unparseable" : "canonical_unavailable",
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
        rule: `decimals:${DECIMALS.nps}`,
        note: "legacy accepts 0-10; the confirmed Be Community scale is 1-10",
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
        note: legacyNpsBase === null ? "legacy_unparseable" : "canonical_unavailable",
      }),
    );
  }

  // The per-cohort scopes have no legacy counterpart at all: the legacy engine
  // computes ONE nps over every row that carries the key.
  for (const key of ["activos", "desertores"]) {
    const cohortScope = scope(canonical, key);
    findings.push(
      finding({
        key: `recommendation.nps.${key}.value`,
        section: "recommendation",
        classification: "canonical_only",
        canonicalValue: metricValue(cohortScope?.score),
        canonicalBase: metricBase(cohortScope?.score),
        note: "the legacy engine computes one study-wide NPS and no cohort split",
      }),
    );
  }

  // ---------------------------------------------------------------------------
  // RENEWAL. The legacy metric key is literally `cri` and its per-person values
  // are the confirmed risk weights, so the legacy AVERAGE of that key and the
  // canonical churn-risk index are the same arithmetic mean over the same base.
  // They round at different declared precisions, so the comparison uses the
  // coarser one.
  // ---------------------------------------------------------------------------
  const criAverage = average(legacy, "cri");
  const canonicalCri = metricValue(canonical.renewal.index);
  const canonicalCriBase = canonical.renewal.base.valid;
  const legacyCri = parseLegacyNumber(criAverage?.value ?? null);
  const legacyCriBase = parseLegacyBase(criAverage?.detail ?? null);

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
        note: !criAverage ? "legacy_absent" : legacyCri === null ? "legacy_unparseable" : "canonical_unavailable",
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
        rule: `decimals:${decimals}`,
        note: "legacy publishes the mean as a score at 2 dp; canonical as an index at 1 dp",
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
        note: criAverage ? "legacy_unparseable" : "legacy_absent",
      }),
    );
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
      note: "the canonical contract refuses a cross the legacy layer cannot express",
    }),
  );

  // ---------------------------------------------------------------------------
  // THE KEY SPACES THAT NEED A CONFIGURED MAP. Every legacy average whose key
  // carries one of the configuration-required prefixes is reported once, by
  // prefix, with its canonical counterpart NAMED. Reporting 122 identical
  // findings would bury the three that were actually compared.
  // ---------------------------------------------------------------------------
  const counts = new Map<string, number>();
  for (const entry of legacy.view.averages) {
    const metricKey = entry.key.replace(/^average:/, "");
    if ((DIRECTLY_CORRESPONDING_LEGACY_KEYS as readonly string[]).includes(metricKey)) continue;
    const prefix = CONFIGURATION_REQUIRED_PREFIXES.find((candidate) => metricKey.startsWith(candidate)) ?? "other";
    counts.set(prefix, (counts.get(prefix) ?? 0) + 1);
  }
  const CANONICAL_COUNTERPART: Record<string, string> = {
    "csat_": "journey.touchpoints[].satisfaction — a top-box share, not the legacy mean of 1-5 scores",
    "tdp_": "journey.touchpoints[].unawareShareOfResponses — NOT touchpoints[].tdp, which is the valid-base ratio",
    "desempeno_": "performance.dimensions[].periods[] — a different population and a different denominator",
    other: "no canonical counterpart is stated by any authority",
  };
  for (const [prefix, count] of [...counts.entries()].sort()) {
    findings.push(
      finding({
        key: `legacy.metric_keys.${prefix === "other" ? "other" : prefix.replace(/_$/, "")}`,
        section: "legacy_metric_space",
        classification: prefix === "other" ? "legacy_only" : "presentation_configuration_required",
        mismatch: prefix === "other" ? null : "presentation_only",
        legacyValue: count,
        note: CANONICAL_COUNTERPART[prefix],
      }),
    );
  }

  // ---------------------------------------------------------------------------
  // WHAT EACH LAYER HAS AND THE OTHER DOES NOT.
  // ---------------------------------------------------------------------------
  const canonicalOnly: [string, string, number | null, string][] = [
    ["journey.touchpoints", "journey", canonical.journey.touchpoints.length, "per-touchpoint CSAT, TDP and unawareness share"],
    ["journey.groups", "journey", canonical.journey.groups.length, "the source's own grouping of the touchpoints"],
    ["retention.periods", "retention", canonical.retention.periods.length, "historical retention with its own identity check"],
    ["performance.dimensions", "performance", canonical.performance.dimensions.length, "monthly performance with a per-month denominator"],
    [
      "qualitative.curatedFindingCounts",
      "qualitative",
      canonical.qualitative.curatedFindingCounts.length,
      "counts of curated findings per curated entity",
    ],
  ];
  for (const [key, section, value, note] of canonicalOnly) {
    findings.push(finding({ key, section, classification: "canonical_only", canonicalValue: value, note }));
  }

  const legacyOnly: [string, string, number | null, string][] = [
    [
      "legacy.pivot.allowlist",
      "pivot",
      legacy.pivotAllowlist.dimensions.length + legacy.pivotAllowlist.metrics.length,
      "the pivot explorer is a legacy-only capability",
    ],
    ["legacy.filterOptions", "filters", legacy.filterOptions.length, "legacy segment keys are a different key space from canonical attributes"],
    ["legacy.crosses", "crosses", legacy.view.crosses.length, "cross averages by legacy segment; needs the same configured map"],
  ];
  for (const [key, section, value, note] of legacyOnly) {
    findings.push(finding({ key, section, classification: "legacy_only", legacyValue: value, note }));
  }

  // Suppression is the one place the two layers deliberately DISAGREE about
  // what to publish, so it is a replacement rather than a mismatch.
  findings.push(
    finding({
      key: "disclosure.small_sample_suppression",
      section: "disclosure",
      classification: "canonical_replacement",
      legacyValue: legacy.view.selectionVisibility === "suppressed" ? 1 : 0,
      canonicalValue: 0,
      note: "the legacy layer withholds a small sample; the canonical layer reports its base and never suppresses",
    }),
  );

  // The curated journey cloud is editorial content by decision, on both sides.
  findings.push(
    finding({
      key: "qualitative.curated_journey_cloud",
      section: "qualitative",
      classification: "editorial_configuration_required",
      mismatch: "editorial_only",
      legacyValue: legacy.view.qualitative.themes.length,
      canonicalValue: canonical.configurationRequired.some((item) => item.key === "curated_journey_pain_cloud") ? 1 : 0,
      note: "legacy themes are reviewed survey answers; canonical curated findings are the consultant pain map",
    }),
  );

  return findings.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
}
