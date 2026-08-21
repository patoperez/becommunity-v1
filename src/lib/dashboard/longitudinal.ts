import { computeStudyMetrics, type LongRow } from "@/lib/calc/engine";
import { sampleVisibility, type SampleVisibility } from "@/lib/calc/disclosure";

export type LongitudinalStudyInput = {
  name: string;
  period: string | null;
  createdAt: string;
  rows: LongRow[];
};

export type LongitudinalPoint = {
  studyName: string;
  period: string;
  value: number | null;
  n: number | null;
  visibility: SampleVisibility;
};

export type LongitudinalSeries = {
  key: string;
  title: string;
  unit: "nps" | "percent" | "score";
  points: LongitudinalPoint[];
};

export type LongitudinalView = {
  periods: number;
  series: LongitudinalSeries[];
};

type MetricValue = {
  title: string;
  unit: LongitudinalSeries["unit"];
  value: number;
  n: number;
};

function label(value: string): string {
  return value.replace(/_/g, " ");
}

function valuesForStudy(rows: LongRow[]): Map<string, MetricValue> {
  const metrics = computeStudyMetrics(rows);
  const values = new Map<string, MetricValue>();

  if (metrics.nps) {
    values.set("nps", {
      title: "NPS",
      unit: "nps",
      value: metrics.nps.nps,
      n: metrics.nps.total,
    });
  }

  for (const item of metrics.csat) {
    values.set(`csat:${item.metric_key}`, {
      title: `CSAT ${label(item.metric_key)}`,
      unit: "percent",
      value: item.result.csat,
      n: item.result.total,
    });
  }

  for (const item of metrics.averages) {
    if (item.average == null) continue;
    values.set(`average:${item.metric_key}`, {
      title: label(item.metric_key),
      unit: "score",
      value: item.average,
      n: item.n,
    });
  }

  return values;
}

/**
 * Builds the client-safe longitudinal memory for one tenant. Raw response rows
 * are consumed here on the server and never included in the returned DTO.
 * Stable metric keys, rather than question wording, define comparability.
 */
export function buildLongitudinalView(studies: LongitudinalStudyInput[]): LongitudinalView {
  const ordered = [...studies].sort((a, b) => {
    const byDate = Date.parse(a.createdAt) - Date.parse(b.createdAt);
    if (Number.isFinite(byDate) && byDate !== 0) return byDate;
    return a.name.localeCompare(b.name, "es");
  });
  const snapshots = ordered.map((study) => ({
    study,
    values: valuesForStudy(study.rows),
  }));
  const definitions = new Map<string, Pick<MetricValue, "title" | "unit">>();

  for (const snapshot of snapshots) {
    for (const [key, metric] of snapshot.values) {
      if (!definitions.has(key)) definitions.set(key, { title: metric.title, unit: metric.unit });
    }
  }

  const series = [...definitions.entries()]
    .map(([key, definition]) => ({
      key,
      ...definition,
      points: snapshots.map(({ study, values }) => {
        const metric = values.get(key);
        if (!metric) {
          return {
            studyName: study.name,
            period: study.period?.trim() || study.name,
            value: null,
            n: null,
            visibility: "no-data" as const,
          };
        }
        const visibility = sampleVisibility(metric.n);
        return {
          studyName: study.name,
          period: study.period?.trim() || study.name,
          value: visibility === "suppressed" ? null : metric.value,
          n: visibility === "suppressed" ? null : metric.n,
          visibility,
        };
      }),
    }))
    .sort((a, b) => a.title.localeCompare(b.title, "es"));

  return { periods: ordered.length, series };
}
