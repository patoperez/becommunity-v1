const RESERVED = new Set([
  "id", "respondent_id", "metric_key", "value",
  "theme", "stage_key", "quote", "source", "category",
]);

export type SegmentableRow = Record<string, unknown>;

export type SegmentFilterOption = { key: string; values: string[] };
export type SegmentFilters = Record<string, string>;
export type SegmentFilterValidation = { ok: true } | { ok: false; errors: string[] };

/** Stable filter catalogue derived exclusively from the RLS-scoped study rows. */
export function buildSegmentFilterOptions(rows: SegmentableRow[]): SegmentFilterOption[] {
  const dimensions = new Map<string, Set<string>>();
  for (const row of rows) {
    for (const [key, rawValue] of Object.entries(row)) {
      if (RESERVED.has(key)) continue;
      const value = String(rawValue ?? "").trim();
      if (!value) continue;
      const values = dimensions.get(key) ?? new Set<string>();
      values.add(value);
      dimensions.set(key, values);
    }
  }
  return [...dimensions.entries()]
    .sort(([a], [b]) => a.localeCompare(b, "es"))
    .map(([key, values]) => ({
      key,
      values: [...values].sort((a, b) => a.localeCompare(b, "es")),
    }));
}

export function validateSegmentFilters(
  filters: SegmentFilters,
  options: SegmentFilterOption[],
): SegmentFilterValidation {
  const allowed = new Map(options.map((option) => [option.key, new Set(option.values)]));
  const errors: string[] = [];
  for (const [key, value] of Object.entries(filters)) {
    if (!value) continue;
    const values = allowed.get(key);
    if (!values) errors.push(`Dimensión de filtro no permitida: '${key}'.`);
    else if (!values.has(value)) errors.push(`Valor no permitido para '${key}': '${value}'.`);
  }
  return errors.length ? { ok: false, errors } : { ok: true };
}

/**
 * Applies a validated AND filter across dimensions. Computations that consume
 * the returned rows continue through the canonical calculation layer.
 */
export function filterRowsBySegments<T extends SegmentableRow>(
  rows: T[],
  filters: SegmentFilters,
  options = buildSegmentFilterOptions(rows),
): T[] {
  const validation = validateSegmentFilters(filters, options);
  if (!validation.ok) throw new Error(`Filtros inválidos: ${validation.errors.join(" ")}`);
  const active = Object.entries(filters).filter(([, value]) => Boolean(value));
  if (active.length === 0) return rows;
  return rows.filter((row) => active.every(([key, value]) => String(row[key] ?? "") === value));
}
