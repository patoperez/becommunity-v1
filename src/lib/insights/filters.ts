import type { SegmentFilters } from "@/lib/calc/filters";
import { parseReportFilters, type ReportFilterParseResult } from "@/lib/reporting/filters";

export type InsightsSearchParams = Record<string, string | string[] | undefined>;

/**
 * Turns Next's page search params into the exact bounded filter grammar used by
 * the authenticated PDF. One URL therefore describes both the screen and the
 * report; neither surface gets to invent a second parser.
 */
export function parseInsightsFilters(params: InsightsSearchParams): ReportFilterParseResult {
  const query = new URLSearchParams();
  for (const [key, raw] of Object.entries(params)) {
    if (Array.isArray(raw)) {
      for (const value of raw) query.append(key, value);
    } else if (typeof raw === "string") {
      query.append(key, raw);
    }
  }
  return parseReportFilters(query);
}

export function filterQuery(filters: SegmentFilters): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(filters).sort(([a], [b]) => a.localeCompare(b, "es"))) {
    if (value) query.set(`f.${key}`, value);
  }
  return query.toString();
}

export function insightsStudyHref(studyId: string, filters: SegmentFilters = {}): string {
  const query = filterQuery(filters);
  const path = `/insights/e/${encodeURIComponent(studyId)}`;
  return query ? `${path}?${query}` : path;
}
