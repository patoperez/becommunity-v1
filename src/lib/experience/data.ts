/**
 * The numbers a composed block shows, computed the way the product already
 * computes them.
 *
 * THE RULE THIS MODULE EXISTS TO KEEP: NO FORMULA IS INVENTED HERE. Every value
 * comes out of `src/lib/calc/metrics.ts` — `npsFromScores`, `csatTopBox`,
 * `mean`, `percentage` — or out of the Workers-safe grouping primitives in
 * `src/lib/calc/table.ts`. This file decides WHICH rows go into a canonical
 * function and how the result is labelled. It never decides what the function
 * does, and a composed page therefore cannot produce a number the deployed
 * dashboard would disagree with.
 *
 * ROUNDING HAPPENS EXACTLY ONCE, here, at the precision the aggregation's unit
 * declares (`docs/CALCULATION_POLICY.md` §4). `formatNumber` re-applies the same
 * canonical `roundTo` at the same precision, which is idempotent, so no value
 * is rounded twice to a different answer.
 *
 * WHAT IT NEVER SEES AND NEVER RETURNS. A respondent id, an answer, a quote, a
 * name. It reads long rows — `{ respondent_id, metric_key, value, …segments }`
 * — the same rows the deployed dashboard reads, and returns aggregates and the
 * counts behind them. `respondent_id` is used only to keep the base honest and
 * never leaves this module.
 *
 * HANDLES STAY ON THE SERVER. A block references a result by opaque registry
 * handle. The mapping from handle to canonical metric key is built server-side
 * and passed in; it is never part of a definition, never sent to a browser, and
 * a request naming a handle the index does not carry resolves to nothing rather
 * than to a guess.
 */

import { DEFAULT_CSAT_MIN } from "@/lib/calc/engine";
import type { LongRow } from "@/lib/calc/engine";
import { DECIMALS, csatTopBox, mean, npsFromScores, percentage, roundTo } from "@/lib/calc/metrics";
import {
  aggregateMax,
  aggregateMin,
  aggregateSum,
  groupRows,
  tupleKey,
  type DataRow,
} from "@/lib/calc/table";

import type { ExperienceDefinitionV1 } from "./definition";
import type { Aggregation, SemanticRegistry } from "./registry";
import { findDimension, findMetric } from "./registry";
import { EXPERIENCE_LIMITS } from "./limits";

/**
 * The server's private map from opaque handle to the canonical key the
 * calculation layer knows. Built where the study is read; never serialized into
 * a definition and never sent to a browser.
 */
export type RegistryKeyIndex = {
  metrics: Readonly<Record<string, string>>;
  dimensions: Readonly<Record<string, string>>;
};

/** What one block asks for. Handles only — never a key, never a column name. */
export type BlockDataRequest = {
  blockId: string;
  metricId: string;
  aggregation: Aggregation;
  primaryDimensionId: string | null;
  secondaryDimensionId: string | null;
  topN: number | null;
  sort: { by: "value" | "label" | "dimension_order"; direction: "asc" | "desc" };
};

export type SeriesUnit = "nps" | "percent" | "score" | "count";

export type DataCell = {
  categoryKey: string;
  /** Already rounded, exactly once, at `decimals`. Null when there is no data. */
  value: number | null;
  /** Distinct answers behind the cell. The base every disclosure rule reads. */
  n: number;
};

export type ResolvedBlockData = {
  blockId: string;
  /** What the number is, in the reader's words. */
  metricLabel: string;
  unit: SeriesUnit;
  decimals: number;
  /** The characteristic along the axis, or null when the block asks for none. */
  categoryLabel: string | null;
  /** The characteristic that splits it into series, or null. */
  seriesLabel: string | null;
  categories: { key: string; label: string }[];
  /** One unnamed series when there is no second characteristic. */
  series: { key: string; label: string | null; cells: DataCell[] }[];
  /** The whole selection, before any breakdown. Always present. */
  overall: DataCell;
  /**
   * Extra rows the reader is told about rather than shown, when `topN` cut the
   * list. Counted, never silently dropped.
   */
  omittedCategories: number;
  /** A canonical breakdown, for the results that carry one (NPS, Top-2-Box). */
  detail: { label: string; value: string }[];
};

export type BlockDataOutcome =
  | { ok: true; data: ResolvedBlockData }
  | { ok: false; blockId: string; reason: "unknown_metric" | "unknown_dimension" | "unsupported_aggregation" };

/** The scale an aggregation produces, independent of the result's own unit. */
export function unitForAggregation(aggregation: Aggregation, metricUnit: string): SeriesUnit {
  if (aggregation === "net_score") return "nps";
  if (aggregation === "top_box" || aggregation === "share") return "percent";
  if (aggregation === "count") return "count";
  if (metricUnit === "percent") return "percent";
  if (metricUnit === "nps") return "nps";
  return "score";
}

export function decimalsForUnit(unit: SeriesUnit): number {
  if (unit === "nps") return DECIMALS.nps;
  if (unit === "percent") return DECIMALS.percent;
  if (unit === "count") return 0;
  return DECIMALS.score;
}

function numericValues(rows: readonly DataRow[]): number[] {
  const values: number[] = [];
  for (const row of rows) {
    const value = Number(row.value);
    if (Number.isFinite(value)) values.push(value);
  }
  return values;
}

/**
 * One cell, through the canonical function its aggregation names.
 *
 * `total` is the base the whole selection rests on, needed only by `share` —
 * which is "how much of the study's answers to this result fall in this group",
 * a proportion of a whole and therefore the aggregation a pie may use.
 */
function aggregate(
  aggregation: Aggregation,
  rows: readonly DataRow[],
  unit: SeriesUnit,
  total: number,
): { value: number | null; n: number } {
  const values = numericValues(rows);
  const n = values.length;
  if (aggregation === "count") return { value: n, n };
  if (aggregation === "share") {
    return { value: total === 0 ? null : percentage(n, total, DECIMALS.percent), n };
  }
  if (n === 0) return { value: null, n: 0 };
  if (aggregation === "net_score") return { value: npsFromScores(values).nps, n: values.length };
  if (aggregation === "top_box") {
    const result = csatTopBox(values, DEFAULT_CSAT_MIN);
    return { value: result.csat, n: result.total };
  }
  if (aggregation === "sum") {
    const sum = aggregateSum(rows, "value");
    return { value: sum == null ? null : roundTo(Number(sum), decimalsForUnit(unit)), n };
  }
  if (aggregation === "min") {
    const min = aggregateMin(rows, "value");
    return { value: min == null ? null : roundTo(Number(min), decimalsForUnit(unit)), n };
  }
  if (aggregation === "max") {
    const max = aggregateMax(rows, "value");
    return { value: max == null ? null : roundTo(Number(max), decimalsForUnit(unit)), n };
  }
  // `average` and `value` are the same canonical mean; `value` exists so a
  // result computed as a composite can still be read as its own raw average.
  return { value: mean(values, decimalsForUnit(unit)), n };
}

/** The breakdown a result carries with it, when its aggregation has one. */
function detailFor(aggregation: Aggregation, rows: readonly DataRow[]): { label: string; value: string }[] {
  const values = numericValues(rows);
  if (values.length === 0) return [];
  if (aggregation === "net_score") {
    const result = npsFromScores(values);
    return [
      { label: "Promotores", value: String(result.promoters) },
      { label: "Pasivos", value: String(result.passives) },
      { label: "Detractores", value: String(result.detractors) },
    ];
  }
  if (aggregation === "top_box") {
    const result = csatTopBox(values, DEFAULT_CSAT_MIN);
    return [
      { label: "Satisfechas", value: String(result.satisfied) },
      { label: "Respuestas", value: String(result.total) },
      { label: "Desde", value: String(result.satisfiedMin) },
    ];
  }
  return [];
}

const MISSING_LABEL = "(sin dato)";

/**
 * The key of one cell.
 *
 * `tupleKey` rather than a joined string, for the reason it was written: a
 * category value is a segment value a client imported, and "a b" + "c" and "a"
 * + "b c" collapse into one cell under any separator a value can contain. Two
 * distinct groups sharing a cell is a wrong number, not a cosmetic bug.
 */
function cellKey(categoryKey: string, seriesKey: string): string {
  return tupleKey([categoryKey, seriesKey]);
}

function orderCategories(
  categories: { key: string; label: string }[],
  valueByKey: Map<string, number | null>,
  sort: BlockDataRequest["sort"],
  declared: readonly string[],
): { key: string; label: string }[] {
  const direction = sort.direction === "asc" ? 1 : -1;
  if (sort.by === "dimension_order") {
    const position = new Map(declared.map((value, index) => [value, index]));
    return [...categories].sort(
      (a, b) => ((position.get(a.key) ?? Number.MAX_SAFE_INTEGER) - (position.get(b.key) ?? Number.MAX_SAFE_INTEGER)) * direction,
    );
  }
  if (sort.by === "label") {
    return [...categories].sort((a, b) => a.label.localeCompare(b.label, "es-MX") * direction);
  }
  return [...categories].sort((a, b) => {
    const left = valueByKey.get(a.key);
    const right = valueByKey.get(b.key);
    // A category with no value sorts last whichever way the list runs: a hole
    // is not a low score, and putting it at the top would read as one.
    if (left == null && right == null) return a.label.localeCompare(b.label, "es-MX");
    if (left == null) return 1;
    if (right == null) return -1;
    if (left === right) return a.label.localeCompare(b.label, "es-MX");
    return (left - right) * direction;
  });
}

/**
 * One block's numbers.
 *
 * Returns a refusal rather than an empty chart when the request names something
 * this study does not have: an empty chart says "nobody answered", and that is
 * a different statement from "this block points at a result that is gone".
 */
export function resolveBlockData(
  rows: readonly LongRow[],
  registry: SemanticRegistry,
  index: RegistryKeyIndex,
  request: BlockDataRequest,
): BlockDataOutcome {
  const metric = findMetric(registry, request.metricId);
  const metricKey = index.metrics[request.metricId];
  if (!metric || !metricKey) {
    return { ok: false, blockId: request.blockId, reason: "unknown_metric" };
  }
  if (!metric.aggregations.includes(request.aggregation)) {
    return { ok: false, blockId: request.blockId, reason: "unsupported_aggregation" };
  }

  const dimensionSlots: { handle: string; key: string; label: string; values: readonly string[] }[] = [];
  for (const handle of [request.primaryDimensionId, request.secondaryDimensionId]) {
    if (!handle) continue;
    const dimension = findDimension(registry, handle);
    const key = index.dimensions[handle];
    if (!dimension || !key) {
      return { ok: false, blockId: request.blockId, reason: "unknown_dimension" };
    }
    dimensionSlots.push({
      handle,
      key,
      label: dimension.label,
      values: dimension.values.map((entry) => entry.value),
    });
  }

  const unit = unitForAggregation(request.aggregation, metric.unit);
  const decimals = decimalsForUnit(unit);
  const metricRows = (rows as readonly DataRow[]).filter((row) => row.metric_key === metricKey);
  const totalAnswers = numericValues(metricRows).length;

  const overallAggregate = aggregate(request.aggregation, metricRows, unit, totalAnswers);
  const overall: DataCell = {
    categoryKey: "",
    value: overallAggregate.value,
    n: overallAggregate.n,
  };
  const detail = detailFor(request.aggregation, metricRows);

  const base = {
    blockId: request.blockId,
    metricLabel: metric.label,
    unit,
    decimals,
    overall,
    detail,
  };

  if (dimensionSlots.length === 0) {
    return {
      ok: true,
      data: {
        ...base,
        categoryLabel: null,
        seriesLabel: null,
        categories: [],
        series: [{ key: "", label: null, cells: [] }],
        omittedCategories: 0,
      },
    };
  }

  const [primary, secondary] = dimensionSlots;
  const groupFields = dimensionSlots.map((slot) => slot.key);
  const groups = groupRows(metricRows, groupFields);

  const cellByKey = new Map<string, { value: number | null; n: number }>();
  const categoryLabels = new Map<string, string>();
  const seriesLabels = new Map<string, string>();
  for (const group of groups) {
    const rawCategory = group.values[0];
    const categoryKey = rawCategory == null || rawCategory === "" ? "" : String(rawCategory);
    categoryLabels.set(categoryKey, categoryKey === "" ? MISSING_LABEL : categoryKey);
    let seriesKey = "";
    if (secondary) {
      const rawSeries = group.values[1];
      seriesKey = rawSeries == null || rawSeries === "" ? "" : String(rawSeries);
      seriesLabels.set(seriesKey, seriesKey === "" ? MISSING_LABEL : seriesKey);
    }
    cellByKey.set(
      cellKey(categoryKey, seriesKey),
      aggregate(request.aggregation, group.rows, unit, totalAnswers),
    );
  }

  // Ordering is decided on the primary characteristic's overall value, not on
  // one series' value: a grouped chart whose categories reorder depending on
  // which series happened to be first is a chart that cannot be read twice.
  const categoryTotals = new Map<string, number | null>();
  if (secondary) {
    for (const group of groupRows(metricRows, [primary.key])) {
      const raw = group.values[0];
      const key = raw == null || raw === "" ? "" : String(raw);
      categoryTotals.set(key, aggregate(request.aggregation, group.rows, unit, totalAnswers).value);
    }
  } else {
    for (const key of categoryLabels.keys()) {
      categoryTotals.set(key, cellByKey.get(cellKey(key, ""))?.value ?? null);
    }
  }

  const allCategories = [...categoryLabels.entries()].map(([key, label]) => ({ key, label }));
  const ordered = orderCategories(allCategories, categoryTotals, request.sort, primary.values);
  const ceiling = Math.min(
    request.topN ?? EXPERIENCE_LIMITS.dimensionCardinality,
    EXPERIENCE_LIMITS.dimensionCardinality,
  );
  const categories = ordered.slice(0, ceiling);
  const omittedCategories = ordered.length - categories.length;

  const seriesKeys = secondary
    ? [...seriesLabels.keys()].sort((a, b) => a.localeCompare(b, "es-MX"))
    : [""];

  return {
    ok: true,
    data: {
      ...base,
      categoryLabel: primary.label,
      seriesLabel: secondary?.label ?? null,
      categories,
      series: seriesKeys.map((seriesKey) => ({
        key: seriesKey,
        label: secondary ? (seriesLabels.get(seriesKey) ?? MISSING_LABEL) : null,
        cells: categories.map((category) => {
          const cell = cellByKey.get(cellKey(category.key, seriesKey));
          return {
            categoryKey: category.key,
            value: cell?.value ?? null,
            n: cell?.n ?? 0,
          };
        }),
      })),
      omittedCategories,
    },
  };
}

/** Every block's numbers in one pass, in the order they were asked for. */
export function resolveBlockDataSet(
  rows: readonly LongRow[],
  registry: SemanticRegistry,
  index: RegistryKeyIndex,
  requests: readonly BlockDataRequest[],
): BlockDataOutcome[] {
  return requests.map((request) => resolveBlockData(rows, registry, index, request));
}

// ---------------------------------------------------------------------------
// What one document needs computed
// ---------------------------------------------------------------------------

/**
 * The identity of one request, so the same aggregate is asked for once and
 * looked up by the surface that needs it.
 *
 * `block:` is a block's own query. `moment:` is one step of a recorrido, which
 * has no block query of its own because a journey block draws many numbers.
 * `pivot:` is the cross a comparison explorer OPENS ON — the reader may change
 * it, and this is only what they see first.
 */
export const dataKeyForBlock = (blockId: string) => `block:${blockId}`;
export const dataKeyForMoment = (journeyId: string, momentId: string) =>
  `moment:${journeyId}:${momentId}`;
export const dataKeyForPivot = (blockId: string) => `pivot:${blockId}`;

/**
 * The characteristic a comparison explorer opens on: the one with the fewest
 * distinct values.
 *
 * The same rule the deployed dashboard already applies, and for the same
 * reason — it is the grouping most likely to put whole groups above whatever
 * disclosure minimum is in force, so the first thing a reader sees is a
 * comparison in which something can actually be shown.
 */
export function coarsestDimensionId(registry: SemanticRegistry): string | null {
  let best: { id: string; size: number; label: string } | null = null;
  for (const dimension of registry.dimensions) {
    if (!dimension.filterEligible || dimension.values.length === 0) continue;
    if (dimension.values.length > EXPERIENCE_LIMITS.dimensionCardinality) continue;
    const candidate = { id: dimension.id, size: dimension.values.length, label: dimension.label };
    if (
      !best
      || candidate.size < best.size
      || (candidate.size === best.size && candidate.label.localeCompare(best.label, "es-MX") < 0)
    ) best = candidate;
  }
  return best?.id ?? null;
}

/**
 * Every aggregate one document needs, keyed and de-duplicated.
 *
 * Pure, so the page that renders the builder and the Server Action that
 * refreshes it derive the SAME list from the same document. Two surfaces
 * computing "what does this page need" separately is how one of them starts
 * showing a number the other never asked for.
 */
export function blockDataRequests(
  definition: ExperienceDefinitionV1,
  registry: SemanticRegistry,
): (BlockDataRequest & { key: string })[] {
  const requests: (BlockDataRequest & { key: string })[] = [];
  const seen = new Set<string>();
  const push = (request: BlockDataRequest & { key: string }) => {
    if (seen.has(request.key)) return;
    seen.add(request.key);
    requests.push(request);
  };

  for (const page of definition.pages) {
    for (const block of page.blocks) {
      if (block.query) {
        push({
          key: dataKeyForBlock(block.id),
          blockId: block.id,
          metricId: block.query.metricId,
          aggregation: block.query.aggregation,
          primaryDimensionId: block.query.primaryDimensionId,
          secondaryDimensionId: block.query.secondaryDimensionId,
          topN: block.query.topN,
          sort: block.query.sort,
        });
        continue;
      }
      if (block.type !== "pivot_explorer") continue;
      const dimensionId = coarsestDimensionId(registry);
      const metric =
        registry.metrics.find((entry) => entry.publicationReady && entry.responses > 0)
        ?? registry.metrics[0];
      if (!dimensionId || !metric) continue;
      push({
        key: dataKeyForPivot(block.id),
        blockId: block.id,
        metricId: metric.id,
        aggregation: metric.defaultAggregation,
        primaryDimensionId: dimensionId,
        secondaryDimensionId: null,
        topN: null,
        sort: { by: "value", direction: "desc" },
      });
    }
  }

  for (const journey of definition.journeyReferences) {
    for (const moment of journey.moments) {
      if (!moment.metricId) continue;
      const metric = findMetric(registry, moment.metricId);
      if (!metric) continue;
      push({
        key: dataKeyForMoment(journey.id, moment.id),
        blockId: moment.id,
        metricId: moment.metricId,
        aggregation: metric.defaultAggregation,
        primaryDimensionId: null,
        secondaryDimensionId: null,
        topN: null,
        sort: { by: "value", direction: "desc" },
      });
    }
  }

  return requests;
}

/** The resolved set, keyed the way the surfaces look it up. */
export type BlockDataSet = Record<
  string,
  { ok: true; data: ResolvedBlockData } | { ok: false; reason: string }
>;

export function resolveDefinitionData(
  rows: readonly LongRow[],
  registry: SemanticRegistry,
  index: RegistryKeyIndex,
  definition: ExperienceDefinitionV1,
): BlockDataSet {
  const set: BlockDataSet = {};
  for (const request of blockDataRequests(definition, registry)) {
    const outcome = resolveBlockData(rows, registry, index, request);
    set[request.key] = outcome.ok
      ? { ok: true, data: outcome.data }
      : {
          ok: false,
          reason:
            outcome.reason === "unknown_metric"
              ? "Este bloque apunta a un resultado que este estudio ya no produce."
              : outcome.reason === "unknown_dimension"
                ? "Este bloque se desglosa por una característica que este estudio ya no tiene."
                : "Este resultado no se puede calcular de la manera que el bloque pide.",
        };
  }
  return set;
}
