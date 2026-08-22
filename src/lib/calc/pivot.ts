import {
  aggregateAverage,
  aggregateCount,
  aggregateMax,
  aggregateMin,
  aggregateSum,
  assertColumn,
  fromRows,
  groupRows,
  type DataRow,
} from "./table";
import type { LongRow } from "./engine";

/**
 * Dynamic cross-tabulation (§5.3). The user's interactive selection is modeled
 * as a validated PivotIntent — never imperative free control — and the requested
 * fields are checked against an allowlist BEFORE anything reaches the engine.
 * This is the mandatory safety gate: a malformed or out-of-scope intent can never
 * drive the calculation engine.
 *
 * Field names selected by the user are used ONLY as string lookups against the
 * table's declared columns (see table.ts). They are never compiled, evaluated, or
 * used as object prototypes — which is also why this file no longer uses Arquero,
 * whose expression compiler calls `Function` and is rejected by Cloudflare Workers.
 */

export type AggKind = "avg" | "count" | "sum" | "min" | "max";
export const AGG_KINDS: AggKind[] = ["avg", "count", "sum", "min", "max"];

/** §5.3 — exactly as modeled in the document. */
export type PivotIntent = {
  rows: string[];
  columns: string[];
  values: { field: string; agg: AggKind }[];
};

/** The fields a user is allowed to reference, derived from their own data. */
export type PivotAllowlist = {
  dimensions: string[]; // segment keys usable as rows/columns
  metrics: string[]; // metric keys usable as value fields
  aggs: AggKind[];
};

export type PivotValidation = { ok: true } | { ok: false; errors: string[] };

const RESERVED = new Set(["respondent_id", "metric_key", "value"]);

/** Build the allowlist from the study's own rows — a user can only ever cross
 * dimensions and metrics that actually exist in their (RLS-scoped) data. */
export function buildAllowlist(rows: LongRow[]): PivotAllowlist {
  const dimensions = new Set<string>();
  const metrics = new Set<string>();
  for (const r of rows) {
    for (const k of Object.keys(r)) if (!RESERVED.has(k)) dimensions.add(k);
    metrics.add(r.metric_key);
  }
  return { dimensions: [...dimensions], metrics: [...metrics], aggs: AGG_KINDS };
}

/**
 * MANDATORY validation (§5.3). Every requested field/aggregation must be in the
 * allowlist. Returns friendly errors; never throws. Call this BEFORE computing.
 */
export function validatePivotIntent(intent: PivotIntent, allow: PivotAllowlist): PivotValidation {
  const errors: string[] = [];
  const dimSet = new Set(allow.dimensions);
  const metSet = new Set(allow.metrics);
  const aggSet = new Set(allow.aggs);

  for (const f of intent.rows) if (!dimSet.has(f)) errors.push(`Dimensión de fila no permitida: '${f}'.`);
  for (const f of intent.columns) if (!dimSet.has(f)) errors.push(`Dimensión de columna no permitida: '${f}'.`);

  const overlap = intent.rows.filter((f) => intent.columns.includes(f));
  if (overlap.length) errors.push(`Una dimensión no puede ser fila y columna a la vez: ${overlap.join(", ")}.`);

  if (intent.rows.length === 0 && intent.columns.length === 0)
    errors.push("Selecciona al menos una dimensión para cruzar.");

  if (intent.values.length === 0) errors.push("Selecciona al menos una métrica.");
  for (const v of intent.values) {
    if (!metSet.has(v.field)) errors.push(`Métrica no permitida: '${v.field}'.`);
    if (!aggSet.has(v.agg)) errors.push(`Agregación no permitida: '${v.agg}'.`);
  }

  return errors.length ? { ok: false, errors } : { ok: true };
}

export type PivotMeasure = { id: string; field: string; agg: AggKind; label: string };
export type PivotResult = {
  rowFields: string[];
  colFields: string[];
  measures: PivotMeasure[];
  colCombos: { key: string; labels: string[] }[];
  /** body cell key = `${colKey}|${measureId}` */
  body: {
    rowLabels: string[];
    cells: Record<string, number | null>;
    /** Valid source-row count for the matching cell/measure. */
    cellNs: Record<string, number>;
  }[];
};

const aggLabel: Record<AggKind, string> = {
  avg: "Promedio",
  count: "Conteo",
  sum: "Suma",
  min: "Mín",
  max: "Máx",
};

/**
 * Combo keys stay `§`-joined so the emitted shape is unchanged (an empty
 * dimension list is still `""`, a single label is still the label itself), but
 * the separator and the escape character are escaped inside each part first.
 *
 * Without that escaping the tuples ["a§b","c"] and ["a","b§c"] both collapse to
 * "a§b§c" and silently share one cell — distinct respondent groups merging into
 * one another. `|` is escaped too because the body cell key is `${colKey}|${id}`.
 * For any label free of `\`, `§` and `|` — i.e. every ordinary segment value —
 * the key is byte-identical to the previous implementation.
 */
function encodeComboKey(parts: readonly string[]): string {
  return parts
    .map((p) => p.replace(/\\/g, "\\\\").replace(/§/g, "\\§").replace(/\|/g, "\\|"))
    .join("§");
}

function aggregateCell(agg: AggKind, rows: readonly DataRow[]): number | undefined {
  switch (agg) {
    case "avg":
      return aggregateAverage(rows, "value");
    case "sum":
      return aggregateSum(rows, "value");
    case "min":
      return aggregateMin(rows, "value");
    case "max":
      return aggregateMax(rows, "value");
    case "count":
      return aggregateCount(rows);
  }
}

/**
 * Compute the cross-tab. Re-validates the intent against the allowlist and
 * THROWS if it is invalid — so it is structurally impossible to run the engine
 * on an unvalidated or out-of-scope intent (defense in depth on top of the UI's
 * own pre-check).
 */
export function computePivot(rows: LongRow[], intent: PivotIntent, allow: PivotAllowlist): PivotResult {
  const v = validatePivotIntent(intent, allow);
  if (!v.ok) throw new Error(`PivotIntent inválido: ${v.errors.join(" ")}`);

  const measures: PivotMeasure[] = intent.values.map((val, i) => ({
    id: `m${i}`,
    field: val.field,
    agg: val.agg,
    label: `${aggLabel[val.agg]} · ${val.field}`,
  }));

  const groupFields = [...intent.rows, ...intent.columns];
  // Every dynamic field must be a real column of this table before it is used.
  // The allowlist is a union over all rows, while the table's schema comes from
  // the first row, so an unknown or non-rectangular dimension still fails loudly
  // here rather than grouping into nothing.
  const table = fromRows(rows as readonly DataRow[]);
  assertColumn(table, "metric_key");
  for (const f of groupFields) assertColumn(table, f);
  if (measures.some((m) => m.agg !== "count")) assertColumn(table, "value");

  const rowKeyMap = new Map<string, string[]>();
  const colKeyMap = new Map<string, string[]>();
  const cellMap = new Map<string, number | null>();
  const cellNMap = new Map<string, number>();

  for (const m of measures) {
    const filtered = table.rows.filter((r) => r["metric_key"] === m.field);
    // With no dimensions at all a rollup still yields exactly one result row,
    // even when nothing matched the metric — that empty row is what produces the
    // null cell with n = 0.
    const groups = groupFields.length
      ? groupRows(filtered, groupFields)
      : [{ values: [] as unknown[], rows: filtered }];

    for (const group of groups) {
      const valueOf = (field: string) => group.values[groupFields.indexOf(field)];
      const rk = intent.rows.map((f) => String(valueOf(f) ?? ""));
      const ck = intent.columns.map((f) => String(valueOf(f) ?? ""));
      const rks = encodeComboKey(rk);
      const cks = encodeComboKey(ck);
      rowKeyMap.set(rks, rk);
      colKeyMap.set(cks, ck);
      const cell = aggregateCell(m.agg, group.rows);
      // RAW precision on purpose. Pivot cells are NOT display-terminal: the
      // PivotExplorer derives `maxBar` and the bar-width ratio
      // ((value / maxBar) * 100) from them. Rounding here would feed rounding
      // error into that derived calculation, so the canonical rounding is
      // applied once at the presentation boundary (`formatNumber`) instead.
      cellMap.set(`${rks}|${cks}|${m.id}`, cell == null ? null : Number(cell));
      cellNMap.set(`${rks}|${cks}|${m.id}`, aggregateCount(group.rows));
    }
  }

  const sortedRows = [...rowKeyMap.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  const sortedCols = [...colKeyMap.entries()].sort((a, b) => a[0].localeCompare(b[0]));

  const colCombos = sortedCols.map(([key, labels]) => ({ key, labels }));
  const body = sortedRows.map(([rks, rowLabels]) => {
    const cells: Record<string, number | null> = {};
    const cellNs: Record<string, number> = {};
    for (const [cks] of sortedCols) {
      for (const m of measures) {
        cells[`${cks}|${m.id}`] = cellMap.get(`${rks}|${cks}|${m.id}`) ?? null;
        cellNs[`${cks}|${m.id}`] = cellNMap.get(`${rks}|${cks}|${m.id}`) ?? 0;
      }
    }
    return { rowLabels, cells, cellNs };
  });

  return { rowFields: intent.rows, colFields: intent.columns, measures, colCombos, body };
}
