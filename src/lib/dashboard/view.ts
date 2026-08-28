import {
  computeStageMetric,
  computeStudyMetrics,
  type LongRow,
} from "@/lib/calc/engine";
import {
  buildSegmentFilterOptions,
  filterRowsBySegments,
  type SegmentFilterOption,
  type SegmentFilters,
} from "@/lib/calc/filters";
import { sampleVisibility, type SampleVisibility } from "@/lib/calc/disclosure";
import { formatNumber, formatScore } from "@/lib/calc/format";
import { DECIMALS, roundTo } from "@/lib/calc/metrics";
import { buildAllowlist, type PivotAllowlist, type PivotResult } from "@/lib/calc/pivot";
import type { JourneyStage } from "@/lib/calc/journey";
import { parseDashboardConfig, type DashboardSections } from "@/lib/dashboard/config";
import { authoredResultLabels, featuredResultKeys } from "@/lib/dashboard/results";
import {
  summarizeConfirmedQualitative,
  type ConfirmedQualitative,
  type QualitativeSummary,
} from "@/lib/qualitative/published";

export type SafeMetric = {
  key: string;
  title: string;
  value: string | null;
  detail: string | null;
  visibility: SampleVisibility;
};

export type SafeQualitativeSummary = {
  themes: { theme: string; count: number; n: number; visibility: "caution" | "standard" }[];
  quotes: { quote: string; theme: string | null }[];
  hasSuppressedThemes: boolean;
};

export type StageUnit = "nps" | "percent" | "score";

export type SafeJourneyStage = {
  id: string;
  label: string;
  metricKey: string;
  description?: string;
  value: string | null;
  kindLabel: string;
  /**
   * The scale this stage's number lives on. Presentation-only: it lets the
   * journey say "de -100 a 100" in words instead of printing the canonical
   * metric key in a monospace box, and lets it compare only stages that share a
   * scale. It does not change which metric is computed or how.
   */
  unit: StageUnit;
  /**
   * The SAME already-rounded number that `value` renders, exposed numerically
   * so presentation can order and position stages without re-parsing a string.
   * Rounded exactly once, by `journeyHeadline`, at the precision the unit
   * declares (docs/CALCULATION_POLICY.md §4).
   */
  numeric: number | null;
  visibility: SampleVisibility;
  n: number | null;
  detail: { label: string; value: string }[];
  qualitative: SafeQualitativeSummary;
};

export type SafeStudyView = {
  emptyStudy: boolean;
  emptySelection: boolean;
  selectionVisibility: SampleVisibility;
  selectedUnits: number | null;
  sourceUnits: number | null;
  tiles: SafeMetric[];
  averages: SafeMetric[];
  /**
   * The characteristic a segment comparison opens on. It names the DEFAULT of
   * the one comparison explorer; it no longer introduces a pre-rendered matrix.
   */
  crossSegment: string | null;
  /**
   * The results the study's own configuration singles out, in reading order.
   * Everything else stays in the complete inventory behind its disclosure.
   */
  featuredKeys: string[];
  /** Display names the study authored for its results (recorrido moments). */
  resultLabels: Record<string, string>;
  journey: SafeJourneyStage[];
  qualitative: SafeQualitativeSummary;
  canPivot: boolean;
};

export type StudyDashboardPayload = {
  sections: DashboardSections;
  filterOptions: SegmentFilterOption[];
  pivotAllowlist: PivotAllowlist;
  view: SafeStudyView;
};

export type SafePivotResult = Omit<PivotResult, "body"> & {
  body: {
    rowLabels: string[];
    cells: Record<string, number | null>;
    cellNs: Record<string, number | null>;
    suppressed: Record<string, boolean>;
  }[];
};

function label(value: string): string {
  return value.replace(/_/g, " ");
}

function distinctUnits(rows: LongRow[], qualitative: ConfirmedQualitative[]): number {
  return new Set([
    ...rows.map((row) => `r:${row.respondent_id}`),
    ...qualitative.map((row) => (row.respondent_id ? `r:${row.respondent_id}` : `o:${row.id}`)),
  ]).size;
}

function visibleCount(n: number, visibility: SampleVisibility): number | null {
  return visibility === "suppressed" ? null : n;
}

function safeMetric(key: string, title: string, value: string, detail: string, n: number): SafeMetric {
  const visibility = sampleVisibility(n);
  return {
    key,
    title,
    value: visibility === "suppressed" ? null : value,
    detail: visibility === "suppressed" ? null : detail,
    visibility,
  };
}

export function sanitizeQualitativeSummary(summary: QualitativeSummary): SafeQualitativeSummary {
  const visibility = new Map(summary.themes.map((theme) => [theme.theme, theme.visibility]));
  return {
    themes: summary.themes
      .filter((theme): theme is typeof theme & { visibility: "caution" | "standard" } =>
        theme.visibility === "caution" || theme.visibility === "standard")
      .map(({ theme, count, n, visibility: state }) => ({ theme, count, n, visibility: state })),
    quotes: summary.quotes.map((quote) => ({
      quote: quote.quote,
      theme: visibility.get(quote.theme) === "suppressed" ? null : quote.theme,
    })),
    hasSuppressedThemes: summary.themes.some((theme) => theme.visibility === "suppressed"),
  };
}

function stageDecimals(unit: StageUnit): number {
  if (unit === "nps") return DECIMALS.nps;
  if (unit === "percent") return DECIMALS.percent;
  return DECIMALS.journeyHeadline;
}

/**
 * Rounds ONCE, at the precision the unit declares, and returns both the display
 * string and the number that string represents. `formatNumber` re-applies the
 * canonical `roundTo` at the same precision, which is idempotent, so no value is
 * rounded to a different result twice.
 */
function journeyHeadline(
  value: ReturnType<typeof computeStageMetric>,
): { text: string | null; numeric: number | null } {
  if (value.value == null) return { text: null, numeric: null };
  const decimals = stageDecimals(value.unit);
  const numeric = roundTo(value.value, decimals);
  const formatted = formatNumber(numeric, decimals);
  return {
    text: value.unit === "percent" ? `${formatted}%` : formatted,
    numeric,
  };
}

export function buildStudyDashboard(
  rows: LongRow[],
  qualitative: ConfirmedQualitative[],
  stages: JourneyStage[],
  filters: SegmentFilters,
  rawConfig: unknown = {},
): StudyDashboardPayload {
  const { sections, presentation } = parseDashboardConfig(rawConfig);
  const filterOptions = buildSegmentFilterOptions([...rows, ...qualitative]);
  const pivotAllowlist = buildAllowlist(rows);
  const filteredRows = filterRowsBySegments(rows, filters, filterOptions);
  const filteredQualitative = filterRowsBySegments(qualitative, filters, filterOptions);
  const sourceCount = distinctUnits(rows, qualitative);
  const selectedCount = distinctUnits(filteredRows, filteredQualitative);
  const selectionVisibility = sampleVisibility(selectedCount);
  const selectionSuppressed = selectionVisibility === "suppressed";
  // `includeCrosses: false` — the exhaustive metric x segment product is no
  // longer rendered anywhere on this surface, so it is no longer computed here.
  // Every formula, and every cross a reader actually asks for, is unchanged:
  // the comparison explorer computes exactly the one cross it was asked for,
  // through the same allowlisted server path it always used.
  const metrics = computeStudyMetrics(filteredRows, { includeCrosses: false });

  const tiles: SafeMetric[] = [];
  if (!selectionSuppressed && selectedCount > 0) {
    tiles.push(safeMetric("respondents", "Encuestados", String(metrics.respondents), "Base cuantitativa", metrics.respondents));
    if (metrics.nps) {
      tiles.push(safeMetric(
        "nps",
        "NPS",
        String(metrics.nps.nps),
        `${metrics.nps.promoters} prom - ${metrics.nps.detractors} detr - n=${metrics.nps.total}`,
        metrics.nps.total,
      ));
    }
    for (const item of metrics.csat) {
      tiles.push(safeMetric(
        `csat:${item.metric_key}`,
        `CSAT ${label(item.metric_key)}`,
        `${item.result.csat}%`,
        `Top-box >=${item.result.satisfiedMin} - ${item.result.satisfied}/${item.result.total}`,
        item.result.total,
      ));
    }
  }

  const averages = selectionSuppressed ? [] : metrics.averages.map((item) => safeMetric(
    `average:${item.metric_key}`,
    label(item.metric_key),
    formatScore(item.average),
    `n=${item.n}`,
    item.n,
  ));

  // The study's own configuration decides what leads. `published` is exactly
  // what the reader can be shown, so a result the selection suppressed can
  // never be promoted into the lead by having been named somewhere.
  const published = [...tiles, ...averages];
  const featured = featuredResultKeys(published, stages, presentation.threshold);

  const journey: SafeJourneyStage[] = selectionSuppressed ? [] : stages.map((stage) => {
    const metric = computeStageMetric(filteredRows, stage.metric);
    const visibility = sampleVisibility(metric.n);
    const stageSummary = summarizeConfirmedQualitative(
      filteredQualitative.filter((row) => row.stage_key === stage.id),
    );
    const headline = journeyHeadline(metric);
    return {
      id: stage.id,
      label: stage.label,
      metricKey: stage.metric,
      description: stage.description,
      value: visibility === "suppressed" ? null : headline.text,
      kindLabel: metric.value == null ? "sin datos" : metric.kind === "nps" ? "NPS" : "Promedio",
      unit: metric.unit,
      numeric: visibility === "suppressed" ? null : headline.numeric,
      visibility,
      n: visibleCount(metric.n, visibility),
      detail: visibility === "suppressed" ? [] : metric.detail,
      qualitative: sanitizeQualitativeSummary(stageSummary),
    };
  });

  return {
    sections,
    filterOptions: sections.filters ? filterOptions : [],
    pivotAllowlist,
    view: {
      emptyStudy: sourceCount === 0,
      emptySelection: sourceCount > 0 && selectedCount === 0,
      selectionVisibility,
      selectedUnits: visibleCount(selectedCount, selectionVisibility),
      sourceUnits: visibleCount(sourceCount, sampleVisibility(sourceCount)),
      tiles: sections.metrics ? tiles : [],
      averages: sections.metrics ? averages : [],
      crossSegment: sections.segments && !selectionSuppressed ? metrics.crossSegment : null,
      featuredKeys: sections.metrics ? featured : [],
      resultLabels: sections.metrics ? authoredResultLabels(published, stages) : {},
      journey: sections.journey ? journey : [],
      qualitative: !sections.qualitative || selectionSuppressed
        ? { themes: [], quotes: [], hasSuppressedThemes: false }
        : sanitizeQualitativeSummary(summarizeConfirmedQualitative(filteredQualitative)),
      canPivot: sections.pivot && !selectionSuppressed && filteredRows.length > 0
        && pivotAllowlist.dimensions.length > 0 && pivotAllowlist.metrics.length > 0,
    },
  };
}

export function sanitizePivotResult(result: PivotResult): SafePivotResult {
  return {
    ...result,
    body: result.body.map((row) => {
      const cells: Record<string, number | null> = {};
      const cellNs: Record<string, number | null> = {};
      const suppressed: Record<string, boolean> = {};
      for (const [key, value] of Object.entries(row.cells)) {
        const n = row.cellNs[key] ?? 0;
        const hidden = sampleVisibility(n) === "suppressed";
        cells[key] = hidden ? null : value;
        cellNs[key] = hidden ? null : n;
        suppressed[key] = hidden;
      }
      return { rowLabels: row.rowLabels, cells, cellNs, suppressed };
    }),
  };
}
