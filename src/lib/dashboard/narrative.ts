import { formatNumber } from "@/lib/calc/format";
import { DECIMALS, roundTo } from "@/lib/calc/metrics";
import type { StudyDashboardPayload } from "@/lib/dashboard/view";
import type { LongitudinalSeries, LongitudinalView } from "@/lib/dashboard/longitudinal";

export type NarrativeMetric = {
  key: string;
  title: string;
  value: string | null;
  delta: string | null;
  movement: "up" | "down" | "flat" | "unavailable";
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
      reportAvailable: !dashboard.view.emptyStudy,
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
  };
}
