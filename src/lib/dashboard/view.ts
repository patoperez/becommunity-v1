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
import { DECIMALS } from "@/lib/calc/metrics";
import { buildAllowlist, type PivotAllowlist, type PivotResult } from "@/lib/calc/pivot";
import type { JourneyStage } from "@/lib/calc/journey";
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

export type SafeJourneyStage = {
  id: string;
  label: string;
  metricKey: string;
  description?: string;
  value: string | null;
  kindLabel: string;
  visibility: SampleVisibility;
  n: number | null;
  detail: { label: string; value: string }[];
  qualitative: SafeQualitativeSummary;
};

export type SafeCross = {
  metricKey: string;
  rows: {
    segment: string;
    value: string | null;
    n: number | null;
    visibility: SampleVisibility;
  }[];
};

export type SafeStudyView = {
  emptyStudy: boolean;
  emptySelection: boolean;
  selectionVisibility: SampleVisibility;
  selectedUnits: number | null;
  sourceUnits: number | null;
  tiles: SafeMetric[];
  averages: SafeMetric[];
  crossSegment: string | null;
  crosses: SafeCross[];
  journey: SafeJourneyStage[];
  qualitative: SafeQualitativeSummary;
  canPivot: boolean;
};

export type StudyDashboardPayload = {
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

function journeyHeadline(value: ReturnType<typeof computeStageMetric>): string | null {
  if (value.value == null) return null;
  if (value.unit === "nps") return formatNumber(value.value, DECIMALS.nps);
  if (value.unit === "percent") return `${formatNumber(value.value, DECIMALS.percent)}%`;
  return formatNumber(value.value, DECIMALS.journeyHeadline);
}

export function buildStudyDashboard(
  rows: LongRow[],
  qualitative: ConfirmedQualitative[],
  stages: JourneyStage[],
  filters: SegmentFilters,
): StudyDashboardPayload {
  const filterOptions = buildSegmentFilterOptions([...rows, ...qualitative]);
  const pivotAllowlist = buildAllowlist(rows);
  const filteredRows = filterRowsBySegments(rows, filters, filterOptions);
  const filteredQualitative = filterRowsBySegments(qualitative, filters, filterOptions);
  const sourceCount = distinctUnits(rows, qualitative);
  const selectedCount = distinctUnits(filteredRows, filteredQualitative);
  const selectionVisibility = sampleVisibility(selectedCount);
  const selectionSuppressed = selectionVisibility === "suppressed";
  const metrics = computeStudyMetrics(filteredRows);

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

  const crosses: SafeCross[] = selectionSuppressed ? [] : metrics.crosses.map((cross) => ({
    metricKey: cross.metric_key,
    rows: cross.rows.map((row) => {
      const visibility = sampleVisibility(row.n);
      return {
        segment: row.segment,
        value: visibility === "suppressed" ? null : formatScore(row.average),
        n: visibleCount(row.n, visibility),
        visibility,
      };
    }),
  }));

  const journey: SafeJourneyStage[] = selectionSuppressed ? [] : stages.map((stage) => {
    const metric = computeStageMetric(filteredRows, stage.metric);
    const visibility = sampleVisibility(metric.n);
    const stageSummary = summarizeConfirmedQualitative(
      filteredQualitative.filter((row) => row.stage_key === stage.id),
    );
    return {
      id: stage.id,
      label: stage.label,
      metricKey: stage.metric,
      description: stage.description,
      value: visibility === "suppressed" ? null : journeyHeadline(metric),
      kindLabel: metric.value == null ? "sin datos" : metric.kind === "nps" ? "NPS" : "Promedio",
      visibility,
      n: visibleCount(metric.n, visibility),
      detail: visibility === "suppressed" ? [] : metric.detail,
      qualitative: sanitizeQualitativeSummary(stageSummary),
    };
  });

  return {
    filterOptions,
    pivotAllowlist,
    view: {
      emptyStudy: sourceCount === 0,
      emptySelection: sourceCount > 0 && selectedCount === 0,
      selectionVisibility,
      selectedUnits: visibleCount(selectedCount, selectionVisibility),
      sourceUnits: visibleCount(sourceCount, sampleVisibility(sourceCount)),
      tiles,
      averages,
      crossSegment: selectionSuppressed ? null : metrics.crossSegment,
      crosses,
      journey,
      qualitative: selectionSuppressed
        ? { themes: [], quotes: [], hasSuppressedThemes: false }
        : sanitizeQualitativeSummary(summarizeConfirmedQualitative(filteredQualitative)),
      canPivot: !selectionSuppressed && filteredRows.length > 0
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
