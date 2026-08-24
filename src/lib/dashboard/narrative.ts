import { formatNumber } from "@/lib/calc/format";
import { DECIMALS, roundTo } from "@/lib/calc/metrics";
import type { SampleVisibility } from "@/lib/calc/disclosure";
import type { SafeJourneyStage, StageUnit, StudyDashboardPayload } from "@/lib/dashboard/view";
import type { LongitudinalSeries, LongitudinalView } from "@/lib/dashboard/longitudinal";

export type NarrativeMetric = {
  key: string;
  title: string;
  value: string | null;
  delta: string | null;
  movement: "up" | "down" | "flat" | "unavailable";
};

/**
 * The lowest-scoring touchpoint AMONG THOSE THAT SHARE A SCALE. Comparing an
 * NPS stage with a 1-5 average would be meaningless, so the spotlight is only
 * produced when at least two stages sit on the same scale, and it is described
 * as exactly that: the lowest of the comparable moments. It is a factual
 * ordering of numbers the product already computed — not a threshold, not an
 * alert, and not a judgement about whether the number is acceptable.
 */
export type NarrativeSpotlight = {
  id: string;
  label: string;
  value: string;
  unit: StageUnit;
  n: number | null;
  visibility: SampleVisibility;
  /** How many stages shared the scale it was chosen from. */
  comparedWith: number;
  /**
   * The lowest and highest of those comparable stages. A score has no absolute
   * domain the client can be told about, so the only honest track to place it on
   * is the range of its own peers.
   */
  peerMin: number;
  peerMax: number;
};

export type NarrativeHomeView = {
  currentStudy: {
    id: string;
    name: string;
    period: string | null;
    reportAvailable: boolean;
  };
  metrics: NarrativeMetric[];
  themes: { theme: string; count: number }[];
  hasPreviousWave: boolean;
  /** The base the whole study rests on, for the sample-context sentence. */
  sample: { units: number | null; visibility: SampleVisibility };
  /** The weakest comparable touchpoint, when the study has a journey. */
  spotlight: NarrativeSpotlight | null;
  /** How many touchpoints the journey holds at all. */
  stageCount: number;
  /**
   * How many of those touchpoints have no result yet. Internal preview names
   * this as a readiness gap before publication; the client never sees a count
   * of what is missing.
   */
  stagesWithoutResult: number;
  /** Whether any approved quote exists at all, for the readiness notice. */
  hasVoices: boolean;
  /** One already-approved quote, if the study has any. */
  voice: { quote: string; theme: string | null } | null;
  /** The characteristics a reader may explore by, as stored keys. */
  characteristics: string[];
};

function deltaFor(series: LongitudinalSeries | undefined): Pick<NarrativeMetric, "delta" | "movement"> {
  if (!series || series.points.length < 2) return { delta: null, movement: "unavailable" };
  const current = series.points.at(-1)?.value;
  const previous = series.points.at(-2)?.value;
  if (current == null || previous == null) return { delta: null, movement: "unavailable" };
  const decimals = series.unit === "nps" ? DECIMALS.nps
    : series.unit === "percent" ? DECIMALS.percent : DECIMALS.score;
  const difference = roundTo(current - previous, decimals);
  const sign = difference > 0 ? "+" : "";
  const suffix = series.unit === "percent" ? " pp" : " pts";
  return {
    delta: `${sign}${formatNumber(difference, decimals)}${suffix}`,
    movement: difference > 0 ? "up" : difference < 0 ? "down" : "flat",
  };
}

function priority(key: string): number {
  if (key === "nps") return 0;
  if (key.startsWith("csat:")) return 1;
  return 2;
}

function findSpotlight(journey: SafeJourneyStage[]): NarrativeSpotlight | null {
  const byUnit = new Map<StageUnit, SafeJourneyStage[]>();
  for (const stage of journey) {
    if (stage.numeric == null || stage.value == null) continue;
    byUnit.set(stage.unit, [...(byUnit.get(stage.unit) ?? []), stage]);
  }
  // The largest group of stages that actually share a scale.
  let best: SafeJourneyStage[] = [];
  for (const group of byUnit.values()) {
    if (group.length > best.length) best = group;
  }
  if (best.length < 2) return null;
  const values = best.map((stage) => stage.numeric as number);
  const lowest = best.reduce((low, stage) =>
    (stage.numeric as number) < (low.numeric as number) ? stage : low,
  );
  return {
    id: lowest.id,
    label: lowest.label,
    value: lowest.value as string,
    unit: lowest.unit,
    n: lowest.n,
    visibility: lowest.visibility,
    comparedWith: best.length,
    peerMin: Math.min(...values),
    peerMax: Math.max(...values),
  };
}

/** Builds a consumption-first summary exclusively from already-safe DTOs. */
export function buildNarrativeHome(
  study: { id: string; name: string; period: string | null },
  dashboard: StudyDashboardPayload,
  longitudinal: LongitudinalView,
): NarrativeHomeView {
  const seriesByKey = new Map(longitudinal.series.map((series) => [series.key, series]));
  const metricSources = [...dashboard.view.tiles, ...dashboard.view.averages]
    .filter((metric) => metric.key !== "respondents")
    .sort((a, b) => priority(a.key) - priority(b.key) || a.title.localeCompare(b.title, "es"))
    .slice(0, 4);

  return {
    currentStudy: {
      id: study.id,
      name: study.name,
      period: study.period,
      reportAvailable: dashboard.sections.report && !dashboard.view.emptyStudy,
    },
    metrics: metricSources.map((metric) => ({
      key: metric.key,
      title: metric.title,
      value: metric.value,
      ...deltaFor(seriesByKey.get(metric.key)),
    })),
    themes: dashboard.view.qualitative.themes.slice(0, 3)
      .map(({ theme, count }) => ({ theme, count })),
    hasPreviousWave: longitudinal.periods >= 2,
    sample: {
      units: dashboard.view.selectedUnits,
      visibility: dashboard.view.selectionVisibility,
    },
    spotlight: findSpotlight(dashboard.view.journey),
    stageCount: dashboard.view.journey.length,
    stagesWithoutResult: dashboard.view.journey.filter((stage) => stage.value == null).length,
    hasVoices: dashboard.view.qualitative.quotes.length > 0,
    voice: dashboard.view.qualitative.quotes[0] ?? null,
    characteristics: dashboard.filterOptions.map((option) => option.key),
  };
}
