import { from, op } from "arquero";
import type { LongRow } from "./engine";

/**
 * Dynamic cross-tabulation (§5.3). The user's interactive selection is modeled
 * as a validated PivotIntent — never imperative free control — and the requested
 * fields are checked against an allowlist BEFORE anything reaches Arquero. This
 * is the mandatory safety gate: a malformed or out-of-scope intent can never
 * drive the calculation engine.
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

type ExprRow = { metric_key: string; value: number } & Record<string, unknown>;
type Row = Record<string, unknown>;

function rollupExpr(agg: AggKind) {
  switch (agg) {
    case "avg":
      return (d: ExprRow) => op.average(d.value);
    case "sum":
      return (d: ExprRow) => op.sum(d.value);
    case "min":
      return (d: ExprRow) => op.min(d.value);
    case "max":
      return (d: ExprRow) => op.max(d.value);
    case "count":
      return () => op.count();
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
  const rowKeyMap = new Map<string, string[]>();
  const colKeyMap = new Map<string, string[]>();
  const cellMap = new Map<string, number | null>();
  const cellNMap = new Map<string, number>();

  for (const m of measures) {
    const filtered = from(rows)
      .params({ field: m.field })
      .filter((d: ExprRow, $: { field: string }) => d.metric_key === $.field);
    const grouped = groupFields.length
      ? filtered.groupby(groupFields).rollup({ val: rollupExpr(m.agg), n: () => op.count() })
      : filtered.rollup({ val: rollupExpr(m.agg), n: () => op.count() });

    for (const obj of grouped.objects() as Row[]) {
      const rk = intent.rows.map((f) => String(obj[f] ?? ""));
      const ck = intent.columns.map((f) => String(obj[f] ?? ""));
      const rks = rk.join("§");
      const cks = ck.join("§");
      rowKeyMap.set(rks, rk);
      colKeyMap.set(cks, ck);
      // RAW precision on purpose. Pivot cells are NOT display-terminal: the
      // PivotExplorer derives `maxBar` and the bar-width ratio
      // ((value / maxBar) * 100) from them. Rounding here would feed rounding
      // error into that derived calculation, so the canonical rounding is
      // applied once at the presentation boundary (`formatNumber`) instead.
      cellMap.set(`${rks}|${cks}|${m.id}`, obj.val == null ? null : Number(obj.val));
      cellNMap.set(`${rks}|${cks}|${m.id}`, Number(obj.n));
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
