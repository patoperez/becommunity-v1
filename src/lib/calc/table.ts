/**
 * Workers-safe relational primitives (§5.2 support layer).
 *
 * WHY THIS FILE EXISTS
 * Arquero 8.0.3 compiles its table expressions with the JavaScript `Function`
 * constructor. Cloudflare Workers forbid runtime code generation, so every
 * data-bearing aggregation threw `EvalError: Code generation from strings
 * disallowed for this context` in production. These helpers reproduce the exact
 * subset of Arquero semantics the calculation layer relied on, using ordinary
 * data structures only — no `eval`, no `Function`, no generated source.
 *
 * Dynamic dimension names stay DATA: they are looked up as string keys against a
 * declared column list and are never turned into code or object prototypes.
 *
 * Arquero parity notes (verified against arquero@8.0.3, kept as the dev-time
 * oracle in scripts/cloudflare-calc-compat-test.mjs):
 *  - `from(rows)` derives columns from the FIRST row only; keys that appear on
 *    later rows are invisible to the table.
 *  - a declared column missing on a given row reads as `undefined`.
 *  - `groupby` emits groups in FIRST-APPEARANCE order, never sorted.
 *  - `null`, `undefined` and `""` are three DISTINCT group keys.
 *  - `op.average/sum/min/max` skip invalid values (`null`, `undefined`, `NaN`)
 *    and return `undefined` when a group holds no valid value at all.
 *  - `op.count()` counts EVERY row in the group, including invalid ones.
 */

export type DataRow = Record<string, unknown>;

/** A materialized table: the rows plus the column list Arquero would expose. */
export type CalcTable = {
  readonly rows: readonly DataRow[];
  readonly columns: readonly string[];
};

/** One group produced by {@link groupRows}: its key tuple and member rows. */
export type RowGroup = {
  /** Raw group-key values, in the order of the requested fields. */
  readonly values: readonly unknown[];
  readonly rows: readonly DataRow[];
};

/**
 * Build a table from long/tidy rows. Columns come from the first row only, which
 * is what `aq.from(rows)` does — later rows carrying extra keys do not widen the
 * schema, and code must not start seeing fields Arquero would have hidden.
 */
export function fromRows(rows: readonly DataRow[]): CalcTable {
  return { rows, columns: rows.length > 0 ? Object.keys(rows[0]) : [] };
}

export function numRows(table: CalcTable): number {
  return table.rows.length;
}

export function hasColumn(table: CalcTable, column: string): boolean {
  return table.columns.includes(column);
}

/**
 * All values of one column, in row order. An empty table has no columns at all,
 * and Arquero answers `[]` there rather than throwing — a study with zero
 * quantitative rows is a normal state. On a non-empty table an unknown column is
 * a programming error and throws, exactly as Arquero's column reference does.
 */
export function columnValues(table: CalcTable, column: string): unknown[] {
  if (table.rows.length === 0) return [];
  assertColumn(table, column);
  return table.rows.map((row) => row[column]);
}

/** Guard used wherever a dynamic field name reaches the engine. */
export function assertColumn(table: CalcTable, column: string): void {
  if (!hasColumn(table, column)) {
    throw new Error(`Invalid column reference: "${column}"`);
  }
}

/** Rows whose `column` strictly equals `value`, keeping the declared schema. */
export function filterByColumn(table: CalcTable, column: string, value: unknown): CalcTable {
  if (table.rows.length === 0) return table;
  assertColumn(table, column);
  return { rows: table.rows.filter((row) => row[column] === value), columns: table.columns };
}

/**
 * Collision-free structural key for a tuple of group values.
 *
 * Each element is tagged with its kind before being encoded, so `null`,
 * `undefined`, the number 1 and the string "1" can never share a bucket — and
 * because the parts are JSON-encoded strings, no separator character (including
 * the `§` the pivot uses for DISPLAY keys) can smuggle a tuple boundary.
 */
export function tupleKey(values: readonly unknown[]): string {
  return JSON.stringify(values.map(keyPart));
}

function keyPart(value: unknown): string {
  if (value === undefined) return "u";
  if (value === null) return "n";
  const kind = typeof value;
  if (kind === "number" || kind === "boolean" || kind === "bigint") return `${kind[0]}:${String(value)}`;
  return `s:${String(value)}`;
}

/**
 * Group rows by the given fields, in first-appearance order (Arquero's order).
 *
 * A `Map` keyed by the structural tuple key is used deliberately: group keys are
 * user-controlled segment values, and a plain object would expose them to
 * prototype keys such as `__proto__` or `constructor`.
 */
export function groupRows(rows: readonly DataRow[], fields: readonly string[]): RowGroup[] {
  const groups = new Map<string, { values: unknown[]; rows: DataRow[] }>();
  for (const row of rows) {
    const values = fields.map((field) => row[field]);
    const key = tupleKey(values);
    const existing = groups.get(key);
    if (existing) existing.rows.push(row);
    else groups.set(key, { values, rows: [row] });
  }
  return [...groups.values()];
}

/** Arquero's validity test: `null`, `undefined` and `NaN` are all skipped. */
function isValidNumber(value: unknown): boolean {
  return value != null && !Number.isNaN(value as number);
}

/** The valid numeric values of `field` across `rows`, in row order. */
export function validValues(rows: readonly DataRow[], field: string): number[] {
  const out: number[] = [];
  for (const row of rows) {
    const v = row[field];
    if (isValidNumber(v)) out.push(v as number);
  }
  return out;
}

// ---- The five supported aggregations ---------------------------------------
// These match Arquero's `op.*` exactly, including the `undefined` (NOT zero)
// answer when a group holds no valid value, which the callers turn into a null
// cell.

/**
 * Arithmetic mean, computed with Welford's INCREMENTAL update rather than
 * sum/count.
 *
 * This is not a stylistic choice: Arquero's `op.average` accumulates
 * `mean += (v - mean) / k`, and pivot cells are stored RAW and unrounded, so a
 * plain sum/count would return a value that differs in the last ulp
 * (2.6666666666666665 vs 2.666666666666667). Those cells feed the bar-width
 * ratio in PivotExplorer, so the exact float is part of the observable output.
 * The parity gate compares with Object.is and fails on any such drift.
 */
export function aggregateAverage(rows: readonly DataRow[], field: string): number | undefined {
  let mean = 0;
  let valid = 0;
  for (const row of rows) {
    const v = row[field];
    if (!isValidNumber(v)) continue;
    valid += 1;
    mean += ((v as number) - mean) / valid;
  }
  return valid === 0 ? undefined : mean;
}

export function aggregateSum(rows: readonly DataRow[], field: string): number | undefined {
  const values = validValues(rows, field);
  if (values.length === 0) return undefined;
  let total = 0;
  for (const v of values) total += v;
  return total;
}

export function aggregateMin(rows: readonly DataRow[], field: string): number | undefined {
  const values = validValues(rows, field);
  if (values.length === 0) return undefined;
  let best = values[0];
  for (const v of values) if (v < best) best = v;
  return best;
}

export function aggregateMax(rows: readonly DataRow[], field: string): number | undefined {
  const values = validValues(rows, field);
  if (values.length === 0) return undefined;
  let best = values[0];
  for (const v of values) if (v > best) best = v;
  return best;
}

/** `op.count()` — every row in the group, valid values or not. */
export function aggregateCount(rows: readonly DataRow[]): number {
  return rows.length;
}
