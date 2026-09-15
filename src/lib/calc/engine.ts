import {
  aggregateAverage,
  aggregateCount,
  assertColumn,
  columnValues,
  filterByColumn,
  fromRows,
  groupRows,
  numRows,
  type CalcTable,
  type DataRow,
} from "./table";
import {
  csatTopBox,
  mean,
  npsFromScores,
  roundTo,
  DECIMALS,
  type CsatResult,
  type NpsResult,
} from "./metrics";

/**
 * Calculation engine (§5.2). The relational work — filter, group, average, count,
 * cross — runs on the Workers-safe primitives in table.ts. Composite indicators
 * delegate to the canonical definitions in metrics.ts (NPS/CSAT live there, once).
 *
 * This layer used to be built on Arquero. Arquero compiles its expressions with
 * the `Function` constructor, which Cloudflare Workers prohibit, so every
 * data-bearing dashboard render failed in production with
 * `EvalError: Code generation from strings disallowed for this context`.
 * table.ts reproduces the exact Arquero semantics this engine depended on; the
 * numbers, ordering and null behaviour are unchanged (see
 * scripts/cloudflare-calc-compat-test.mjs, which diffs both implementations).
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

export function buildTable(rows: LongRow[]): CalcTable {
  return fromRows(rows as readonly DataRow[]);
}

/** Distinct metric keys present in the data, in first-appearance order. */
export function metricKeys(dt: CalcTable): string[] {
  return [...new Set(columnValues(dt, "metric_key") as string[])];
}

/** Segment columns = any column that is not one of the reserved ones. */
export function segmentKeys(dt: CalcTable): string[] {
  const reserved = new Set(["respondent_id", "metric_key", "value"]);
  return dt.columns.filter((c) => !reserved.has(c));
}

/**
 * An empty table has no columns, so any column reference on it is meaningless.
 * A study with zero quantitative rows is a normal state (e.g. a qualitative-only
 * upload), so every entry point below returns the empty result instead. This
 * guard is numerically inert: it changes nothing for a table that has rows.
 */
function isEmpty(dt: CalcTable): boolean {
  return numRows(dt) === 0;
}

/** Raw numeric values for a metric. Nulls are preserved, as the column holds them. */
function valuesFor(dt: CalcTable, metricKey: string): number[] {
  if (isEmpty(dt)) return [];
  return columnValues(filterByColumn(dt, "metric_key", metricKey), "value") as number[];
}

/** Average + n per metric (§5.2 rollup pattern). One pass over the grouped rows. */
export function metricAverages(dt: CalcTable): AverageRow[] {
  if (isEmpty(dt)) return [];
  return groupRows(dt.rows, ["metric_key"]).map((group) => {
    const average = aggregateAverage(group.rows, "value");
    return {
      metric_key: String(group.values[0]),
      // Rounded ONCE here, at the declared score precision. Display must format
      // at this same precision and never re-round (docs/CALCULATION_POLICY.md §4).
      average: average == null ? null : roundTo(Number(average), DECIMALS.score),
      n: aggregateCount(group.rows),
    };
  });
}

/**
 * Cross: average of one metric by one segment (the §5.2 género × sat_maestros
 * example). The segment name is validated as a real column before it is used, so
 * an unknown dimension fails loudly instead of silently grouping into nothing.
 */
export function crossAverage(dt: CalcTable, metricKey: string, segment: string): CrossRow[] {
  if (isEmpty(dt)) return [];
  assertColumn(dt, segment);
  const filtered = filterByColumn(dt, "metric_key", metricKey);
  return groupRows(filtered.rows, [segment]).map((group) => {
    const average = aggregateAverage(group.rows, "value");
    const value = group.values[0];
    return {
      segment: value == null ? "(sin dato)" : String(value),
      // Rounded ONCE, same policy as metricAverages.
      average: average == null ? null : roundTo(Number(average), DECIMALS.score),
      n: aggregateCount(group.rows),
    };
  });
}

/** NPS for a study, via the canonical definition. */
export function nps(dt: CalcTable, metricKey = NPS_METRIC): NpsResult | null {
  const values = valuesFor(dt, metricKey);
  if (values.length === 0) return null;
  return npsFromScores(values);
}

/** CSAT (Top-N-Box) for a metric, via the canonical definition. */
export function csat(dt: CalcTable, metricKey: string, satisfiedMin = DEFAULT_CSAT_MIN): CsatResult | null {
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
  opts: {
    crossSegment?: string;
    csatMin?: number;
    satMetricPrefix?: string;
    /**
     * Whether to cross EVERY metric key against the chosen segment. Defaults to
     * true, so every existing caller — the PDF included — keeps the exact
     * result it had. The dashboard passes false because it no longer renders
     * that product: a real study with 123 metric keys and 28 values of one
     * characteristic produced 3 400 rows of which almost all were below the
     * disclosure minimum. Nothing about a cross that IS asked for changes; this
     * only stops computing crosses nobody reads.
     */
    includeCrosses?: boolean;
  } = {},
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
  const crosses = crossSegment && opts.includeCrosses !== false
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
    // Rounded ONCE at the journey headline precision. Previously this rounded to
    // 2 dp here and the JourneyMap re-rounded with toFixed(1) — double rounding,
    // which shifts values (raw 3.445 -> 3.45 -> "3.5", instead of "3.4").
    const avg = mean(values, DECIMALS.journeyHeadline);
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

  // Rounded ONCE at the journey headline precision (see note above).
  return { metricKey, kind: "average", value: mean(values, DECIMALS.journeyHeadline), unit: "score", n, detail: [] };
}
