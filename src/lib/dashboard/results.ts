import type { JourneyStage } from "@/lib/calc/journey";
import type { StudyThreshold } from "@/lib/dashboard/config";

/**
 * WHICH RESULTS A STUDY LEADS WITH, AND WHICH ONE IT KEEPS AS REFERENCE.
 *
 * A real instrument produces far more numbers than a reading. The Cuicuilco
 * study produces 123 of them; rendered open, one card each, they were the first
 * thing a client saw and they buried the recorrido, the retention series and
 * the consultant's own reading underneath several screens of scroll.
 *
 * The split here invents nothing and hides nothing. A result is FEATURED when
 * the study's own configuration names it — a recorrido moment points at it, or
 * it is the configured alert metric, or it is one of the two canonical results
 * (`respondents`, `nps`) the product defines itself. Everything else stays
 * available, complete, in a disclosure the reader opens.
 *
 * This module is deliberately free of React and of the calculation engine: it
 * decides an ORDER over keys that already exist, so a gate can assert it
 * without a browser and without a database.
 */

/** The two result families the product defines itself, in reading order. */
const CANONICAL_KEYS = ["respondents", "nps"] as const;

/**
 * A study small enough that no reader is ever buried by it. Below this, the
 * distinction between "featured" and "the rest" is noise: every result is
 * shown, exactly as it was before this split existed.
 */
export const SMALL_STUDY_RESULTS = 6;

type KeyedResult = { key: string };

/**
 * The dashboard view names a result `respondents`, `nps`, `csat:<key>` or
 * `average:<key>`. A stage stores the RAW metric key, so mapping one to the
 * other is a lookup against what the view actually produced — never a guess
 * about which family a key would land in.
 */
export function viewKeyForMetric(metricKey: string, available: readonly KeyedResult[]): string | null {
  const keys = new Set(available.map((item) => item.key));
  for (const candidate of [metricKey, `csat:${metricKey}`, `average:${metricKey}`]) {
    if (keys.has(candidate)) return candidate;
  }
  return null;
}

/**
 * The result keys this study leads with, in reading order, deduplicated and
 * restricted to results that actually exist in the current selection.
 */
export function featuredResultKeys(
  available: readonly KeyedResult[],
  stages: readonly JourneyStage[],
  threshold: StudyThreshold | null = null,
): string[] {
  const keys = new Set(available.map((item) => item.key));
  const ordered: string[] = [];
  const add = (key: string | null) => {
    if (key && keys.has(key) && !ordered.includes(key)) ordered.push(key);
  };
  for (const key of CANONICAL_KEYS) add(key);
  for (const stage of stages) add(viewKeyForMetric(stage.metric, available));
  if (threshold) add(viewKeyForMetric(threshold.metric, available));
  return ordered;
}

/**
 * The name the study's own configuration gives a result, keyed by the view key.
 *
 * A recorrido moment is authored: somebody typed "Dar referencias" for
 * `csat_rendicion_de_cuentas_dar_referencias`. That is a real display name and
 * it beats anything derivable from the column key. The first stage to claim a
 * metric wins, so the map is stable when two moments share one metric.
 */
export function authoredResultLabels(
  available: readonly KeyedResult[],
  stages: readonly JourneyStage[],
): Record<string, string> {
  const labels: Record<string, string> = {};
  for (const stage of stages) {
    const label = stage.label.trim();
    if (!label) continue;
    const key = viewKeyForMetric(stage.metric, available);
    if (key && !labels[key]) labels[key] = label;
  }
  return labels;
}

export type ResultInventory<T extends KeyedResult> = {
  /** What the page shows open, in configuration order. */
  featured: T[];
  /** Every result the selection produced, in the order the view built them. */
  all: T[];
  total: number;
  /** How many of them are withheld for being below the disclosure minimum. */
  suppressed: number;
  /**
   * Whether the complete inventory needs a disclosure of its own. False when
   * everything is already on screen — a closed control repeating what is
   * visible above it is a worse page, not a safer one.
   */
  needsDisclosure: boolean;
};

/**
 * Splits the results the view produced into what the page leads with and the
 * complete inventory behind it. Nothing is dropped: `all` is every result,
 * suppressed ones included, in their original order.
 */
export function buildResultInventory<T extends KeyedResult & { visibility: string }>(
  results: readonly T[],
  featuredKeys: readonly string[],
): ResultInventory<T> {
  const all = [...results];
  const suppressed = all.filter((item) => item.visibility === "suppressed").length;
  if (all.length <= SMALL_STUDY_RESULTS) {
    return { featured: all, all, total: all.length, suppressed, needsDisclosure: false };
  }
  const byKey = new Map(all.map((item) => [item.key, item]));
  const featured = featuredKeys.flatMap((key) => {
    const found = byKey.get(key);
    return found ? [found] : [];
  });
  return {
    featured,
    all,
    total: all.length,
    suppressed,
    needsDisclosure: featured.length < all.length,
  };
}
