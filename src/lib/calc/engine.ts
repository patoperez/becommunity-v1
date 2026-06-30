import { from, op, type ColumnTable } from "arquero";
import {
  csatTopBox,
  mean,
  npsFromScores,
  type CsatResult,
  type NpsResult,
} from "./metrics";

/**
 * Calculation engine (§5.2). Arquero handles the relational work — filter,
 * group, average, count, cross — declaratively. Composite indicators delegate to
 * the canonical definitions in metrics.ts (NPS/CSAT live there, once).
 *
 * Input rows are "long/tidy": one row per quantitative answer, with the
 * respondent's segments flattened onto the row:
 *   { respondent_id, metric_key, value, <segmentKey>: <string>, ... }
 */

export type LongRow = {
  respondent_id: string;
  metric_key: string;
  value: number;
} & Record<string, string | number>;

export const NPS_METRIC = "nps";
/** Default satisfied threshold for CSAT Top-2-Box on a 0–10 scale. */
export const DEFAULT_CSAT_MIN = 9;

export type AverageRow = { metric_key: string; average: number | null; n: number };
export type CrossRow = { segment: string; average: number | null; n: number };

export function buildTable(rows: LongRow[]): ColumnTable {
  return from(rows);
}

/** Distinct metric keys present in the data. */
export function metricKeys(dt: ColumnTable): string[] {
  return [...new Set(dt.array("metric_key") as string[])];
}

/** Segment columns = any column that is not one of the reserved ones. */
export function segmentKeys(dt: ColumnTable): string[] {
  const reserved = new Set(["respondent_id", "metric_key", "value"]);
  return dt.columnNames().filter((c) => !reserved.has(c));
}

// Arquero parses these expression functions from source; the param annotations
// are only for TypeScript. `Row` types the plain objects coming out of .objects().
type ExprRow = { metric_key: string; value: number } & Record<string, unknown>;
type ExprParams = { metricKey: string };
type Row = Record<string, unknown>;

/** Raw numeric values for a metric (Arquero filter, params-bound — §5.2). */
function valuesFor(dt: ColumnTable, metricKey: string): number[] {
  return dt
    .params({ metricKey })
    .filter((d: ExprRow, $: ExprParams) => d.metric_key === $.metricKey)
    .array("value") as number[];
}

/** Average + n per metric (§5.2 rollup pattern). One declarative pass. */
export function metricAverages(dt: ColumnTable): AverageRow[] {
  return (dt
    .groupby("metric_key")
    .rollup({ average: (d: ExprRow) => op.average(d.value), n: () => op.count() })
    .objects() as Row[])
    .map((r) => ({
      metric_key: String(r.metric_key),
      average: r.average == null ? null : Number(r.average),
      n: Number(r.n),
    }));
}

/**
 * Cross: average of one metric by one segment (the §5.2 género × sat_maestros
 * example), declaratively in Arquero.
 */
export function crossAverage(dt: ColumnTable, metricKey: string, segment: string): CrossRow[] {
  return (dt
    .params({ metricKey })
    .filter((d: ExprRow, $: ExprParams) => d.metric_key === $.metricKey)
    .groupby(segment)
    .rollup({ average: (d: ExprRow) => op.average(d.value), n: () => op.count() })
    .objects() as Row[])
    .map((r) => ({
      segment: r[segment] == null ? "(sin dato)" : String(r[segment]),
      average: r.average == null ? null : Number(r.average),
      n: Number(r.n),
    }));
}

/** NPS for a study, via the canonical definition. */
export function nps(dt: ColumnTable, metricKey = NPS_METRIC): NpsResult | null {
  const values = valuesFor(dt, metricKey);
  if (values.length === 0) return null;
  return npsFromScores(values);
}

/** CSAT (Top-N-Box) for a metric, via the canonical definition. */
export function csat(dt: ColumnTable, metricKey: string, satisfiedMin = DEFAULT_CSAT_MIN): CsatResult | null {
  const values = valuesFor(dt, metricKey);
  if (values.length === 0) return null;
  return csatTopBox(values, satisfiedMin);
}

export type StudyMetrics = {
  respondents: number;
  nps: NpsResult | null;
  averages: AverageRow[];
  csat: { metric_key: string; result: CsatResult }[];
  crossSegment: string | null;
  crosses: { metric_key: string; rows: CrossRow[] }[];
};

/**
 * High-level orchestration used by the dashboard. Computes the §5.4 "included"
 * metrics for one study: averages, counts, NPS, CSAT and a single segment cross.
 */
export function computeStudyMetrics(
  rows: LongRow[],
  opts: { crossSegment?: string; csatMin?: number; satMetricPrefix?: string } = {},
): StudyMetrics {
  const dt = buildTable(rows);
  const keys = metricKeys(dt);
  const segments = segmentKeys(dt);
  const satPrefix = opts.satMetricPrefix ?? "sat";
  const csatMin = opts.csatMin ?? DEFAULT_CSAT_MIN;

  const respondents = new Set(rows.map((r) => r.respondent_id)).size;

  const averages = metricAverages(dt).filter((a) => a.metric_key !== NPS_METRIC);

  const csatList = keys
    .filter((k) => k === "csat" || k.startsWith(satPrefix))
    .map((k) => ({ metric_key: k, result: csat(dt, k, csatMin) }))
    .filter((c): c is { metric_key: string; result: CsatResult } => c.result !== null);

  // Prefer 'genero' as the cross dimension, else the first available segment.
  const crossSegment =
    opts.crossSegment ?? (segments.includes("genero") ? "genero" : segments[0] ?? null);
  const crosses = crossSegment
    ? keys.map((k) => ({ metric_key: k, rows: crossAverage(dt, k, crossSegment) }))
    : [];

  return { respondents, nps: nps(dt), averages, csat: csatList, crossSegment, crosses };
}

// ---- Journey stage metric (§8.2 "conectado a datos") ------------------------

export type StageMetric = {
  metricKey: string;
  kind: "nps" | "csat" | "average";
  /** Headline value for the stage; null when the stage has no data. */
  value: number | null;
  unit: "nps" | "percent" | "score";
  n: number;
  /** Breakdown shown on hover. */
  detail: { label: string; value: string }[];
};

/**
 * Compute the headline metric for one journey stage from the study's data,
 * choosing the canonical indicator by metric-key convention:
 *   nps_ -> NPS · sat_ or csat -> average + CSAT · otherwise -> average
 * Uses the same engine/metric definitions as the rest of the system (§5.2).
 */
export function computeStageMetric(
  rows: LongRow[],
  metricKey: string,
  csatMin = DEFAULT_CSAT_MIN,
): StageMetric {
  const dt = buildTable(rows);
  const values = valuesFor(dt, metricKey);
  const n = values.length;

  if (n === 0) {
    return { metricKey, kind: "average", value: null, unit: "score", n: 0, detail: [] };
  }

  if (metricKey.startsWith("nps")) {
    const r = npsFromScores(values);
    return {
      metricKey,
      kind: "nps",
      value: r.nps,
      unit: "nps",
      n: r.total,
      detail: [
        { label: "Promotores", value: String(r.promoters) },
        { label: "Pasivos", value: String(r.passives) },
        { label: "Detractores", value: String(r.detractors) },
      ],
    };
  }

  if (metricKey.startsWith("sat") || metricKey.startsWith("csat")) {
    const avg = mean(values);
    const c = csatTopBox(values, csatMin);
    return {
      metricKey,
      kind: "csat",
      value: avg,
      unit: "score",
      n,
      detail: [
        { label: "CSAT (Top-2-Box)", value: `${c.csat}%` },
        { label: "Satisfechos", value: `${c.satisfied}/${c.total}` },
      ],
    };
  }

  return { metricKey, kind: "average", value: mean(values), unit: "score", n, detail: [] };
}
