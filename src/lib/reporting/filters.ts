import type { SegmentFilters } from "@/lib/calc/filters";

export type ReportFilterParseResult =
  | { ok: true; filters: SegmentFilters }
  | { ok: false; error: string };

/** Parse only bounded `f.<dimension>` query parameters; allowlist validation follows after data load. */
export function parseReportFilters(params: URLSearchParams): ReportFilterParseResult {
  const filters: SegmentFilters = {};
  for (const [key, value] of params) {
    if (!key.startsWith("f.")) continue;
    const dimension = key.slice(2);
    if (!dimension || dimension.length > 80 || value.length > 200) {
      return { ok: false, error: "Filtro fuera de limites" };
    }
    if (Object.hasOwn(filters, dimension)) {
      return { ok: false, error: `Filtro duplicado: ${dimension}` };
    }
    if (Object.keys(filters).length >= 20) {
      return { ok: false, error: "Demasiados filtros" };
    }
    filters[dimension] = value;
  }
  return { ok: true, filters };
}
