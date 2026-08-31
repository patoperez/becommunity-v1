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

import type { ConfirmedQualitative } from "@/lib/qualitative/published";

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
  /**
   * WHO THE NUMBER IS ABOUT, before anything is grouped.
   *
   * The author's fixed narrowing and the reader's current choices, already
   * combined by the caller into one list of characteristic-and-values. It is
   * expressed in HANDLES like everything else, resolved through the same
   * server-side index, and a handle this study does not have is a refusal
   * rather than a silently unfiltered result.
   *
   * COMBINATION IS AND ACROSS CHARACTERISTICS, OR WITHIN ONE. Choosing two
   * generations means "either generation"; choosing a generation and a sphere
   * means "that generation AND that sphere". That is the behaviour the
   * deployed dashboard already has, and it is the only reading of a filter bar
   * that matches what people expect from one.
   */
  restrict?: readonly { dimensionId: string; values: readonly string[] }[];
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
  /**
   * Present only on a qualitative series. Carries BOTH counts and the spellings
   * the review folded into each canonical theme, because a cloud needs to say
   * which basis it used and to show what a theme is made of.
   */
  themes?: ThemeDatum[];
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
  topBoxMinimum: number | null,
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
    // NO THRESHOLD, NO NUMBER. `satisfiedMin` is an explicit input by design
    // (`docs/CALCULATION_POLICY.md` §5); applying the 0–10 default to a study
    // answered 1–5 produced a confident 0 % on every satisfaction result. A
    // missing configuration is reported as missing.
    if (topBoxMinimum === null) return { value: null, n: values.length };
    const result = csatTopBox(values, topBoxMinimum);
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
function detailFor(
  aggregation: Aggregation,
  rows: readonly DataRow[],
  topBoxMinimum: number | null,
): { label: string; value: string }[] {
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
    // The same explicit threshold the value was computed with, so the
    // breakdown can never describe a different calculation from the number
    // it sits under.
    if (topBoxMinimum === null) return [];
    const result = csatTopBox(values, topBoxMinimum);
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

  // The narrowing, resolved to real columns before anything is aggregated. A
  // handle the study does not have refuses; it never silently widens the
  // result to everybody, which would be a wrong number rather than an error.
  const restrictions: { key: string; values: Set<string> }[] = [];
  for (const entry of request.restrict ?? []) {
    if (entry.values.length === 0) continue;
    const key = index.dimensions[entry.dimensionId];
    if (!key) return { ok: false, blockId: request.blockId, reason: "unknown_dimension" };
    restrictions.push({ key, values: new Set(entry.values) });
  }

  const unit = unitForAggregation(request.aggregation, metric.unit);
  const decimals = decimalsForUnit(unit);
  const metricRows = (rows as readonly DataRow[]).filter((row) => {
    if (row.metric_key !== metricKey) return false;
    for (const restriction of restrictions) {
      const value = row[restriction.key];
      if (typeof value !== "string" || !restriction.values.has(value)) return false;
    }
    return true;
  });
  const totalAnswers = numericValues(metricRows).length;

  const topBoxMinimum = metric.topBoxMinimum;
  if (request.aggregation === "top_box" && topBoxMinimum === null) {
    return { ok: false, blockId: request.blockId, reason: "unsupported_aggregation" };
  }

  const overallAggregate = aggregate(request.aggregation, metricRows, unit, totalAnswers, topBoxMinimum);
  const overall: DataCell = {
    categoryKey: "",
    value: overallAggregate.value,
    n: overallAggregate.n,
  };
  const detail = detailFor(request.aggregation, metricRows, topBoxMinimum);

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
      aggregate(request.aggregation, group.rows, unit, totalAnswers, topBoxMinimum),
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
      categoryTotals.set(
        key,
        aggregate(request.aggregation, group.rows, unit, totalAnswers, topBoxMinimum).value,
      );
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
export const dataKeyForThemes = (blockId: string) => `themes:${blockId}`;
export const dataKeyForAwareness = (journeyId: string, momentId: string) =>
  `unaware:${journeyId}:${momentId}`;

/**
 * HOW MANY PEOPLE DID NOT KNOW THIS MOMENT EXISTED.
 *
 * The numerator is the people whose answer to the configured awareness result
 * is one of the exact values a person marked as meaning "no lo conocía". The
 * denominator is the people who ANSWERED that question at all.
 *
 * WHAT IS NOT IN EITHER HALF. A blank, a skip, a non-numeric cell: an absence
 * is not an answer, and counting one as "did not know" invents a numerator
 * while counting it in the base invents a denominator. Both are ways of
 * printing a percentage nobody supplied. Somebody who answered the question
 * with a value that is NOT in the list is in the denominator only, which is
 * what makes the number a share of the people who were asked.
 *
 * The comparison is on the STORED value written as text, because the
 * configured values are what the study records and this module never guesses
 * how to coerce one shape into another.
 */
export function resolveAwareness(
  rows: readonly LongRow[],
  index: RegistryKeyIndex,
  awareness: { metricId: string; values: readonly string[] },
  restrict: readonly { dimensionId: string; values: readonly string[] }[],
): { ok: true; share: number | null; unaware: number; answered: number } | { ok: false; reason: string } {
  const metricKey = index.metrics[awareness.metricId];
  if (!metricKey) return { ok: false, reason: "unknown_metric" };

  const columns: { key: string; values: Set<string> }[] = [];
  for (const entry of restrict) {
    if (entry.values.length === 0) continue;
    const key = index.dimensions[entry.dimensionId];
    if (!key) return { ok: false, reason: "unknown_dimension" };
    columns.push({ key, values: new Set(entry.values) });
  }

  const marked = new Set(awareness.values.map((value) => value.trim()));
  let answered = 0;
  let unaware = 0;
  for (const row of rows as readonly DataRow[]) {
    if (row.metric_key !== metricKey) continue;
    let matches = true;
    for (const column of columns) {
      const value = row[column.key];
      if (typeof value !== "string" || !column.values.has(value)) {
        matches = false;
        break;
      }
    }
    if (!matches) continue;
    const raw = row.value;
    // An absence is not an answer, so it is in neither half.
    if (raw === null || raw === undefined || raw === "") continue;
    answered += 1;
    if (marked.has(String(raw))) unaware += 1;
  }

  return {
    ok: true,
    share: answered === 0 ? null : percentage(unaware, answered, DECIMALS.percent),
    unaware,
    answered,
  };
}

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
/**
 * What the reader currently has chosen, by filter id.
 *
 * TRANSIENT, AND NEVER PART OF THE DOCUMENT. It arrives from the URL of the
 * preview, lives in the page's own state, and is thrown away. Nothing here can
 * reach the saved definition, the survey answers or a calculation: the whole
 * of its effect is which rows an aggregate is computed over on this request.
 */
export type ViewerSelection = Readonly<Record<string, readonly string[]>>;

export const NO_SELECTION: ViewerSelection = Object.freeze({});

/**
 * The narrowing one block is under: what the author fixed, plus what the
 * reader chose on the filters that actually move this block.
 *
 * A READER CAN NEVER WIDEN PAST THE AUTHOR. When both name the same
 * characteristic the two are intersected, so a block fixed to "renovaron" can
 * be narrowed to one generation of them and never opened up to everybody. An
 * intersection that is empty stays empty — an honest "nobody matches both"
 * rather than quietly dropping the author's restriction.
 */
export function blockRestriction(
  definition: ExperienceDefinitionV1,
  blockId: string,
  block: { query: { fixedFilters: readonly { dimensionId: string; values: readonly string[] }[] } | null },
  selection: ViewerSelection,
  movedBy: Map<string, Set<string>>,
): { dimensionId: string; values: readonly string[] }[] {
  const byDimension = new Map<string, string[]>();
  for (const fixed of block.query?.fixedFilters ?? []) {
    byDimension.set(fixed.dimensionId, [...fixed.values]);
  }

  for (const filter of definition.filterDefinitions) {
    const chosen = selection[filter.id];
    if (!chosen || chosen.length === 0) continue;
    if (!movedBy.get(filter.id)?.has(blockId)) continue;
    const existing = byDimension.get(filter.dimensionId);
    if (!existing) {
      byDimension.set(filter.dimensionId, [...chosen]);
      continue;
    }
    const allowed = new Set(existing);
    byDimension.set(filter.dimensionId, chosen.filter((value) => allowed.has(value)));
  }

  return [...byDimension].map(([dimensionId, values]) => ({ dimensionId, values }));
}

export function blockDataRequests(
  definition: ExperienceDefinitionV1,
  registry: SemanticRegistry,
  selection: ViewerSelection = NO_SELECTION,
  movedBy: Map<string, Set<string>> = new Map(),
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
          restrict: blockRestriction(definition, block.id, block, selection, movedBy),
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
        restrict: blockRestriction(definition, block.id, block, selection, movedBy),
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
        // A journey moment belongs to the journey BLOCK, so it is narrowed by
        // whatever moves that block.
        restrict: journeyRestriction(definition, journey.id, selection, movedBy),
      });
    }
  }

  return requests;
}

/**
 * The blocks whose evidence is the confirmed qualitative review.
 *
 * Named here rather than tested for at each call site, so the resolver, the
 * renderer and the gate agree about which blocks get a theme series.
 */
export function qualitativeBlockIds(definition: ExperienceDefinitionV1): string[] {
  return definition.pages.flatMap((page) =>
    page.blocks
      .filter((block) => block.type === "qualitative_themes" || block.type === "theme_cloud")
      .map((block) => block.id),
  );
}

/**
 * Every configured awareness measure, with the journey and moment it belongs
 * to. A moment with no mapping produces nothing at all, which is what "not
 * configured" has to mean rather than a zero.
 */
export function awarenessRequests(definition: ExperienceDefinitionV1): {
  journeyId: string;
  momentId: string;
  awareness: { metricId: string; values: readonly string[] };
}[] {
  return definition.journeyReferences.flatMap((journey) =>
    journey.moments.flatMap((moment) =>
      moment.awareness
        ? [{ journeyId: journey.id, momentId: moment.id, awareness: moment.awareness }]
        : [],
    ),
  );
}

/**
 * EVERY KEY `resolveDefinitionData` PRODUCES, and no other.
 *
 * The numbers a document asks for, plus one theme series per qualitative block
 * and one share per configured awareness measure. The gate compares the
 * resolved set against exactly this, so a surface cannot start computing
 * something the document never asked for.
 */
export function definitionDataKeys(
  definition: ExperienceDefinitionV1,
  registry: SemanticRegistry,
): string[] {
  return [
    ...blockDataRequests(definition, registry).map((request) => request.key),
    ...qualitativeBlockIds(definition).map(dataKeyForThemes),
    ...awarenessRequests(definition).map((request) =>
      dataKeyForAwareness(request.journeyId, request.momentId),
    ),
  ];
}

/** The resolved set, keyed the way the surfaces look it up. */
/**
 * An awareness share, in the same shape as every other resolved number.
 *
 * `overall.value` is the percentage and `overall.n` is the DENOMINATOR — the
 * people who answered the question — so the disclosure rule reads the base it
 * should read. The numerator is written out in `detail`, because a percentage
 * whose numerator a reader cannot see is one they cannot check.
 */
function awarenessSeries(
  momentId: string,
  outcome: { share: number | null; unaware: number; answered: number },
): ResolvedBlockData {
  return {
    blockId: momentId,
    metricLabel: "No conocía este momento",
    unit: "percent",
    decimals: DECIMALS.percent,
    categoryLabel: null,
    seriesLabel: null,
    categories: [],
    series: [{ key: "", label: null, cells: [] }],
    overall: { categoryKey: "", value: outcome.share, n: outcome.answered },
    omittedCategories: 0,
    detail: [
      { label: "No lo conocían", value: String(outcome.unaware) },
      { label: "Respondieron la pregunta", value: String(outcome.answered) },
    ],
  };
}

export type BlockDataSet = Record<
  string,
  { ok: true; data: ResolvedBlockData } | { ok: false; reason: string }
>;

/**
 * The narrowing every block drawing this journey is under.
 *
 * A journey draws many numbers from one block, so its moments follow whatever
 * moves the block. When several blocks draw the same journey they are
 * intersected: a moment has one number per request, and computing it under the
 * loosest of several scopes would show one block's answer inside another.
 */
function journeyRestriction(
  definition: ExperienceDefinitionV1,
  journeyId: string,
  selection: ViewerSelection,
  movedBy: Map<string, Set<string>>,
): { dimensionId: string; values: readonly string[] }[] {
  const hosts = definition.pages
    .flatMap((page) => page.blocks)
    .filter((block) => block.journeyRef === journeyId);
  if (hosts.length === 0) return [];
  const perHost = hosts.map((block) =>
    blockRestriction(definition, block.id, block, selection, movedBy),
  );
  const [first, ...rest] = perHost;
  return first.flatMap((entry) => {
    let values = [...entry.values];
    for (const other of rest) {
      const match = other.find((candidate) => candidate.dimensionId === entry.dimensionId);
      if (!match) return [];
      const allowed = new Set(match.values);
      values = values.filter((value) => allowed.has(value));
    }
    return [{ dimensionId: entry.dimensionId, values }];
  });
}

/**
 * ONE THEME, AS THE CLOUD NEEDS TO KNOW IT.
 *
 * `mentions` and `people` are BOTH carried, always, whichever the block is
 * sized by — one person saying the same thing three times is 3 and 1, and a
 * reader who can see both can tell a widely-shared concern from a strongly-held
 * one. The cloud sizes by the configured basis and prints which one it used.
 *
 * `aliases` are the raw spellings the qualitative review folded INTO this
 * canonical theme. That fold is the merge point the product already has: a
 * person reviewing an observation chooses its `confirmed_theme`, and two
 * differently-worded suggestions confirmed to the same theme are the same theme
 * from then on. There is no second category system here and no new ledger —
 * this reads the decisions the review already recorded.
 */
export type ThemeDatum = {
  label: string;
  mentions: number;
  people: number;
  /** The raw spellings a person folded into this theme, minus the theme itself. */
  aliases: string[];
  /** Which qualitative sources it came from, so two clouds can differ. */
  sources: string[];
};

/**
 * THE CONFIRMED QUALITATIVE EVIDENCE, NARROWED THE SAME WAY A NUMBER IS.
 *
 * The catalogue declares that a "Lo que dijeron" summary and a theme cloud
 * respond to a reader's filter, and that declaration has to be TRUE: the
 * observations are joined to the people who said them, those people are
 * narrowed by exactly the restriction the block is under, and the counts are
 * recomputed.
 *
 * WHAT NEVER ENTERS. `quote` is not selected by any caller and is not read
 * here. A raw suggestion is read only to NAME the spellings a person folded
 * into a confirmed theme, never as a theme in its own right. A PENDING
 * observation is not in `confirmed` at all, so nothing unreviewed can reach a
 * client through this path.
 *
 * An observation with no respondent cannot be attributed to a characteristic,
 * so a narrowed view drops it rather than counting it under every value. With
 * no narrowing at all it is counted exactly as it always was.
 */
export function resolveThemeData(
  rows: readonly LongRow[],
  index: RegistryKeyIndex,
  confirmed: readonly ConfirmedQualitative[],
  blockId: string,
  restrict: readonly { dimensionId: string; values: readonly string[] }[],
  config: { basis: "mentions" | "people"; source: string | null } = {
    basis: "mentions",
    source: null,
  },
): ResolvedBlockData {
  const active = restrict.filter((entry) => entry.values.length > 0);

  // TWO CLOUDS, TWO QUESTIONS. A block may read one qualitative source, so a
  // page can carry "lo que dijeron en la encuesta" beside "lo que dijeron en el
  // focus group" without either being a filter of the other.
  let kept: readonly ConfirmedQualitative[] = config.source
    ? confirmed.filter((row) => row.source === config.source)
    : confirmed;

  if (active.length > 0) {
    const columns: { key: string; values: Set<string> }[] = [];
    for (const entry of active) {
      const key = index.dimensions[entry.dimensionId];
      // An unknown handle narrows to nothing rather than silently widening to
      // everybody — the same rule `resolveBlockData` applies to a number.
      if (!key) return themeSeries(blockId, [], config.basis);
      columns.push({ key, values: new Set(entry.values) });
    }
    const allowed = new Set<string>();
    for (const row of rows as readonly DataRow[]) {
      let matches = true;
      for (const column of columns) {
        const value = row[column.key];
        if (typeof value !== "string" || !column.values.has(value)) {
          matches = false;
          break;
        }
      }
      if (matches) allowed.add(String(row.respondent_id));
    }
    kept = kept.filter((row) => row.respondent_id !== null && allowed.has(row.respondent_id));
  }

  return themeSeries(blockId, summarizeThemes(kept), config.basis);
}

/**
 * The themes behind a set of confirmed observations, with both counts and the
 * spellings that were folded in.
 *
 * The voice count is computed exactly the way `summarizeConfirmedQualitative`
 * computes it, so a cloud and the client dashboard cannot disagree about a
 * theme's base: a respondent counts once, and an observation with no respondent
 * counts as its own unit rather than being dropped.
 */
function summarizeThemes(rows: readonly ConfirmedQualitative[]): ThemeDatum[] {
  const byTheme = new Map<
    string,
    { mentions: number; units: Set<string>; aliases: Set<string>; sources: Set<string> }
  >();
  for (const row of rows) {
    const label = row.theme.trim();
    if (label === "") continue;
    const entry = byTheme.get(label) ?? {
      mentions: 0,
      units: new Set<string>(),
      aliases: new Set<string>(),
      sources: new Set<string>(),
    };
    entry.mentions += 1;
    entry.units.add(row.respondent_id ? `r:${row.respondent_id}` : `o:${row.id}`);
    const raw = typeof row.suggestedTheme === "string" ? row.suggestedTheme.trim() : "";
    if (raw !== "" && raw !== label) entry.aliases.add(raw);
    if (row.source) entry.sources.add(row.source);
    byTheme.set(label, entry);
  }
  return [...byTheme.entries()]
    .map(([label, entry]) => ({
      label,
      mentions: entry.mentions,
      people: entry.units.size,
      aliases: [...entry.aliases].sort((a, b) => a.localeCompare(b, "es-MX")),
      sources: [...entry.sources].sort((a, b) => a.localeCompare(b, "es-MX")),
    }))
    // Deterministic: by mentions, then by name, so ties never reorder.
    .sort((a, b) => b.mentions - a.mentions || a.label.localeCompare(b.label, "es-MX"));
}

function themeSeries(
  blockId: string,
  themes: readonly ThemeDatum[],
  basis: "mentions" | "people",
): ResolvedBlockData {
  const sized = (theme: ThemeDatum) => (basis === "people" ? theme.people : theme.mentions);
  return {
    blockId,
    metricLabel: basis === "people" ? "Personas que lo mencionaron" : "Menciones confirmadas",
    unit: "count",
    decimals: 0,
    categoryLabel: "Tema",
    seriesLabel: null,
    categories: themes.map((theme) => ({ key: theme.label, label: theme.label })),
    series: [
      {
        key: "",
        label: null,
        cells: themes.map((theme) => ({
          categoryKey: theme.label,
          value: sized(theme),
          // THE BASE A DISCLOSURE RULE READS IS ALWAYS THE NUMBER OF VOICES,
          // whichever number the cloud is sized by. A theme mentioned six times
          // by two people is still two people, and that is what decides whether
          // it may be shown at all.
          n: theme.people,
        })),
      },
    ],
    overall: {
      categoryKey: "",
      value: themes.reduce((sum, theme) => sum + sized(theme), 0),
      n: themes.reduce((sum, theme) => sum + theme.people, 0),
    },
    omittedCategories: 0,
    detail: [],
    themes: [...themes],
  };
}

export function resolveDefinitionData(
  rows: readonly LongRow[],
  registry: SemanticRegistry,
  index: RegistryKeyIndex,
  definition: ExperienceDefinitionV1,
  selection: ViewerSelection = NO_SELECTION,
  movedBy: Map<string, Set<string>> = new Map(),
  confirmed: readonly ConfirmedQualitative[] = [],
): BlockDataSet {
  const set: BlockDataSet = {};

  // The qualitative blocks, narrowed by whatever moves them. Resolved beside
  // the numbers rather than in a second pass, so a surface can never draw a
  // filtered chart next to an unfiltered theme count.
  const blocksById = new Map(
    definition.pages.flatMap((page) => page.blocks).map((block) => [block.id, block]),
  );
  for (const blockId of qualitativeBlockIds(definition)) {
    const block = blocksById.get(blockId);
    if (!block) continue;
    set[dataKeyForThemes(blockId)] = {
      ok: true,
      data: resolveThemeData(
        rows,
        index,
        confirmed,
        blockId,
        blockRestriction(definition, blockId, block, selection, movedBy),
        // The BLOCK's own settings, so two clouds on one page can count
        // different things from different sources and each say which.
        {
          basis: block.themeCloud?.basis ?? "mentions",
          source: block.themeCloud?.source ?? null,
        },
      ),
    };
  }

  /*
   * THE AWARENESS SHARES, under the same narrowing as the journey carrying
   * them. A moment's "no lo conocía" has to move with the filter for the same
   * reason its satisfaction score does: the two sit side by side and a reader
   * compares them.
   */
  for (const request of awarenessRequests(definition)) {
    const outcome = resolveAwareness(
      rows,
      index,
      request.awareness,
      journeyRestriction(definition, request.journeyId, selection, movedBy),
    );
    set[dataKeyForAwareness(request.journeyId, request.momentId)] = outcome.ok
      ? { ok: true, data: awarenessSeries(request.momentId, outcome) }
      : {
          ok: false,
          reason:
            outcome.reason === "unknown_metric"
              ? "La medida de desconocimiento apunta a un resultado que este estudio ya no produce."
              : "La medida de desconocimiento se narra por una característica que este estudio ya no tiene.",
        };
  }

  for (const request of blockDataRequests(definition, registry, selection, movedBy)) {
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
