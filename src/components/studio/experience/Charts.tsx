import { useRef, useState, type ReactNode } from "react";

import { formatNumber } from "@/lib/calc/format";
import type { DataCell, ResolvedBlockData, SeriesUnit, ThemeDatum } from "@/lib/experience/data";
import type { ChartPalette, ChartVariant } from "@/lib/experience/charts";
import { CHART_SPECS, alternativeVariant } from "@/lib/experience/charts";
import {
  evaluateSampleVisibility,
  type SampleVisibilityPolicy,
} from "@/lib/experience/sample-policy";
import type { PlacedTheme, ThemeCloudLayout } from "@/lib/experience/theme-cloud";
import {
  bandRangeText,
  classify,
  verdictText,
  type BandColorRole,
  type BandScheme,
  type BandShape,
} from "@/lib/experience/bands";

/**
 * The drawings, and the two rules they all obey.
 *
 * 1. NOTHING IS INVENTED. Every number arrives already computed and already
 *    rounded by `src/lib/experience/data.ts`, which uses the canonical metric
 *    functions and nothing else. These components choose a shape, a colour and
 *    a label. They never do arithmetic on a value beyond turning it into a
 *    length, and a cell with no data is drawn as a gap rather than as a zero.
 *
 * 2. THE PICTURE IS NEVER THE ONLY PLACE THE NUMBER EXISTS. Every chart carries
 *    a real table of the same values for a screen reader, the SVG itself is
 *    `aria-hidden`, and every empty state says which kind of emptiness it is —
 *    nobody answered, the disclosure rule withheld it, or the block points at
 *    something the study no longer produces. Those are three different
 *    sentences and a reader can act on each one differently.
 *
 * The disclosure policy is applied HERE as well as in the model, because this
 * is the surface a consultant judges: the builder shows what the rule currently
 * in force would actually produce, so choosing between "mostrar todo" and
 * "ocultar" is a decision somebody can see the consequence of.
 */

/** Brand roles, in the order a multi-series chart walks them. */
const SERIES_COLORS = [
  "var(--color-blue)",
  "var(--color-magenta)",
  "var(--color-green)",
  "var(--color-yellow)",
  "var(--color-lavender)",
  "var(--color-sky)",
] as const;

const UNIT_SUFFIX: Record<SeriesUnit, string> = {
  nps: "",
  percent: " %",
  score: "",
  count: "",
};

export function formatValue(value: number | null, unit: SeriesUnit, decimals: number): string {
  if (value == null) return "—";
  return `${formatNumber(value, decimals)}${UNIT_SUFFIX[unit]}`;
}

export type CellState = {
  state: "no_data" | "visible" | "warning" | "suppressed";
  value: number | null;
  disclosedSampleSize: number | null;
};

/**
 * One cell, after the disclosure rule has had its say.
 *
 * A suppressed cell loses its value AND its count: publishing "oculto, n = 3"
 * hides the number and announces the base, which is the half that identifies
 * people.
 */
export function applyPolicy(cell: DataCell, policy: SampleVisibilityPolicy): CellState {
  const outcome = evaluateSampleVisibility(cell.n, policy);
  return {
    state: outcome.state,
    value: outcome.state === "suppressed" || outcome.state === "no_data" ? null : cell.value,
    disclosedSampleSize: outcome.disclosedSampleSize,
  };
}

// ---------------------------------------------------------------------------
// Shared furniture
// ---------------------------------------------------------------------------

export function ChartFrame({
  label,
  children,
  table,
}: {
  /** What the picture says, in one sentence, for somebody who cannot see it. */
  label: string;
  children: ReactNode;
  /** The same numbers as text. Always present, never decorative. */
  table: ReactNode;
}) {
  return (
    <figure className="m-0 min-w-0">
      <div role="img" aria-label={label} className="min-w-0">
        {children}
      </div>
      <div className="sr-only">{table}</div>
    </figure>
  );
}

export function EmptyChart({ title, detail }: { title: string; detail?: string }) {
  return (
    <div className="min-w-0 rounded-lg border border-dashed border-line bg-surface-sunken px-4 py-5 text-sm [overflow-wrap:anywhere]">
      <p className="font-medium text-strong">{title}</p>
      {detail ? <p className="mt-1 text-muted">{detail}</p> : null}
    </div>
  );
}

/** The plain-text table every chart carries. */
function ValueTable({
  data,
  policy,
  caption,
}: {
  data: ResolvedBlockData;
  policy: SampleVisibilityPolicy;
  caption: string;
}) {
  const multi = data.series.length > 1 || data.series[0]?.label !== null;
  return (
    <table>
      <caption>{caption}</caption>
      <thead>
        <tr>
          <th scope="col">{data.categoryLabel ?? "Resultado"}</th>
          {data.series.map((series) => (
            <th key={series.key} scope="col">
              {multi ? (series.label ?? "Total") : data.metricLabel}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {data.categories.length === 0 ? (
          <tr>
            <th scope="row">{data.metricLabel}</th>
            <td>{describeCell(applyPolicy(data.overall, policy), data.unit, data.decimals)}</td>
          </tr>
        ) : (
          data.categories.map((category, index) => (
            <tr key={category.key}>
              <th scope="row">{category.label}</th>
              {data.series.map((series) => (
                <td key={series.key}>
                  {describeCell(
                    applyPolicy(series.cells[index] ?? { categoryKey: category.key, value: null, n: 0 }, policy),
                    data.unit,
                    data.decimals,
                  )}
                </td>
              ))}
            </tr>
          ))
        )}
      </tbody>
    </table>
  );
}

function describeCell(cell: CellState, unit: SeriesUnit, decimals: number): string {
  if (cell.state === "no_data") return "sin respuestas";
  if (cell.state === "suppressed") return "no se muestra: muy pocas respuestas";
  const value = formatValue(cell.value, unit, decimals);
  if (cell.state === "warning") {
    return `${value} (pocas respuestas: ${cell.disclosedSampleSize})`;
  }
  return `${value} sobre ${cell.disclosedSampleSize} respuestas`;
}

/** One sentence describing the whole picture. */
function chartLabel(data: ResolvedBlockData, shape: string): string {
  const by = data.categoryLabel ? ` por ${data.categoryLabel}` : "";
  const and = data.seriesLabel ? ` y ${data.seriesLabel}` : "";
  return `${shape}: ${data.metricLabel}${by}${and}. ${data.categories.length} categorías.`;
}

/** The extent every proportional drawing is measured against. */
function scaleFor(data: ResolvedBlockData, policy: SampleVisibilityPolicy): { min: number; max: number } {
  const values: number[] = [];
  for (const series of data.series) {
    for (const cell of series.cells) {
      const shown = applyPolicy(cell, policy);
      if (shown.value != null) values.push(shown.value);
    }
  }
  if (values.length === 0) return { min: 0, max: 1 };
  const max = Math.max(...values, 0);
  const min = Math.min(...values, 0);
  return { min, max: max === min ? min + 1 : max };
}

function ratio(value: number, scale: { min: number; max: number }): number {
  const span = scale.max - scale.min;
  if (span <= 0) return 0;
  return Math.max(0, Math.min(1, (value - scale.min) / span));
}

function hasAnyValue(data: ResolvedBlockData, policy: SampleVisibilityPolicy): boolean {
  return data.series.some((series) =>
    series.cells.some((cell) => applyPolicy(cell, policy).value != null),
  );
}

function Legend({ data }: { data: ResolvedBlockData }) {
  if (!data.seriesLabel) return null;
  return (
    <ul className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted">
      {data.series.map((series, index) => (
        <li key={series.key} className="flex items-center gap-1.5">
          <span
            aria-hidden="true"
            className="inline-block h-2.5 w-2.5 shrink-0 rounded-sm"
            style={{ background: SERIES_COLORS[index % SERIES_COLORS.length] }}
          />
          <span className="truncate">{series.label}</span>
        </li>
      ))}
    </ul>
  );
}

// ---------------------------------------------------------------------------
// KPI and traffic light
// ---------------------------------------------------------------------------

export function KpiChart({
  data,
  policy,
  showDetail = true,
}: {
  data: ResolvedBlockData;
  policy: SampleVisibilityPolicy;
  showDetail?: boolean;
}) {
  const cell = applyPolicy(data.overall, policy);
  if (cell.state === "no_data") {
    return <EmptyChart title="Todavía nadie respondió esta parte" detail="Cuando lleguen respuestas, el número aparecerá aquí." />;
  }
  if (cell.state === "suppressed") {
    return (
      <EmptyChart
        title="No se muestra: muy pocas respuestas"
        detail="La regla de divulgación de este estudio oculta los resultados con muy poca gente detrás."
      />
    );
  }
  return (
    <div className="min-w-0">
      <p className="font-display text-2xl font-semibold leading-tight text-strong [overflow-wrap:anywhere] sm:text-3xl">
        {formatValue(cell.value, data.unit, data.decimals)}
      </p>
      <p className="mt-0.5 truncate text-xs text-muted">{data.metricLabel}</p>
      {cell.state === "warning" ? (
        <p className="mt-1 text-xs text-caution [overflow-wrap:anywhere]">
          Pocas respuestas: {cell.disclosedSampleSize}. Léelo como un indicio.
        </p>
      ) : (
        <p className="mt-1 text-xs text-muted [overflow-wrap:anywhere]">
          {cell.disclosedSampleSize} respuestas
        </p>
      )}
      {showDetail && data.detail.length > 0 ? (
        <ul className="mt-2 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted">
          {data.detail.map((item) => (
            <li key={item.label}>
              {item.label}: {item.value}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

export type TargetRange = { minimum: number | null; maximum: number | null; label: string | null };

/**
 * The semáforo, drawn as a semáforo.
 *
 * Green inside the agreed range, amber just outside it, red beyond that — a
 * statement ABOUT A THRESHOLD somebody agreed to. With no range configured it
 * says so rather than colouring a number by an invented rule, because a traffic
 * light with no agreement behind it is decoration that reads as judgement.
 */
export function TrafficLightChart({
  data,
  policy,
  target,
  scheme,
}: {
  data: ResolvedBlockData;
  policy: SampleVisibilityPolicy;
  target: TargetRange | null;
  /**
   * The agreed bands, when a person has configured some. A scheme is the real
   * semáforo and it WINS over a bare range: a range says "inside or outside",
   * a scheme says which band, what it means, and what the other bands are.
   */
  scheme: BandScheme | null;
}) {
  const cell = applyPolicy(data.overall, policy);
  if (cell.state === "no_data" || cell.state === "suppressed") {
    return <KpiChart data={data} policy={policy} />;
  }
  if (scheme) return <SemaforoChart data={data} policy={policy} scheme={scheme} />;
  if (!target || (target.minimum === null && target.maximum === null)) {
    /*
     * A SHORT CHIP HERE, THE WHOLE SENTENCE IN THE BLOCK'S CARD.
     *
     * This paragraph used to be printed in full inside every block that
     * lacked a range. On a canvas showing a dozen quarter-width cards it
     * repeated a hundred words a dozen times and buried the numbers it was
     * about. The block says WHAT is missing in three words; the card the
     * person opens to fix it says what to do about it, once.
     */
    return (
      <div className="min-w-0">
        <KpiChart data={data} policy={policy} showDetail={false} />
        <p className="mt-1.5 inline-flex max-w-full items-center gap-1 rounded-md border border-caution-line bg-caution-surface px-2 py-1 text-xs text-caution">
          <span aria-hidden="true">▲</span>
          <span className="min-w-0 truncate">Falta configurar el rango</span>
        </p>
      </div>
    );
  }

  const value = cell.value ?? 0;
  const inside =
    (target.minimum === null || value >= target.minimum)
    && (target.maximum === null || value <= target.maximum);
  const margin = Math.max(1, Math.abs((target.minimum ?? target.maximum ?? 0) * 0.1));
  const near =
    !inside
    && ((target.minimum !== null && value >= target.minimum - margin)
      || (target.maximum !== null && value <= target.maximum + margin));
  const light: "green" | "yellow" | "red" = inside ? "green" : near ? "yellow" : "red";
  const LIGHT_STYLE = {
    green: { dot: "var(--color-green)", box: "border-positive-line bg-positive-surface text-positive" },
    yellow: { dot: "var(--color-yellow)", box: "border-caution-line bg-caution-surface text-caution" },
    red: { dot: "var(--color-magenta)", box: "border-danger-line bg-danger-surface text-danger" },
  } as const;
  const range =
    target.minimum !== null && target.maximum !== null
      ? `entre ${target.minimum} y ${target.maximum}`
      : target.minimum !== null
        ? `al menos ${target.minimum}`
        : `como máximo ${target.maximum}`;
  const verdict = inside
    ? "dentro del rango acordado"
    : near
      ? "cerca del rango acordado"
      : "fuera del rango acordado";

  return (
    <ChartFrame
      label={`Semáforo: ${data.metricLabel} está ${verdict} (${range}).`}
      table={<ValueTable data={data} policy={policy} caption={data.metricLabel} />}
    >
      <div className={`flex min-w-0 items-center gap-3 rounded-lg border px-3 py-2.5 ${LIGHT_STYLE[light].box}`}>
        <span
          aria-hidden="true"
          className="inline-block h-6 w-6 shrink-0 rounded-full ring-2 ring-inset ring-white/40"
          style={{ background: LIGHT_STYLE[light].dot }}
        />
        <span className="min-w-0">
          <span className="block font-display text-2xl font-semibold leading-tight">
            {formatValue(cell.value, data.unit, data.decimals)}
          </span>
          <span className="block text-xs">
            {target.label ? `${target.label}: ` : "Rango ideal: "}
            {range} · {verdict}
          </span>
        </span>
      </div>
    </ChartFrame>
  );
}

// ---------------------------------------------------------------------------
// Bars
// ---------------------------------------------------------------------------

export function HorizontalBars({
  data,
  policy,
  showValueLabels = true,
}: {
  data: ResolvedBlockData;
  policy: SampleVisibilityPolicy;
  showValueLabels?: boolean;
}) {
  if (data.categories.length === 0) {
    return <EmptyChart title="Este bloque no tiene un desglose que dibujar" detail="Elige una característica en la ficha del bloque." />;
  }
  if (!hasAnyValue(data, policy)) return <NothingToShow data={data} policy={policy} />;
  const scale = scaleFor(data, policy);
  const grouped = data.series.length > 1;

  return (
    <ChartFrame
      label={chartLabel(data, "Barras horizontales")}
      table={<ValueTable data={data} policy={policy} caption={data.metricLabel} />}
    >
      <ul className="m-0 min-w-0 list-none space-y-2 p-0">
        {data.categories.map((category, index) => (
          <li key={category.key} className="min-w-0">
            <p className="truncate text-xs font-medium text-body" title={category.label}>
              {category.label}
            </p>
            <div className="mt-1 space-y-1">
              {data.series.map((series, seriesIndex) => {
                const cell = applyPolicy(
                  series.cells[index] ?? { categoryKey: category.key, value: null, n: 0 },
                  policy,
                );
                return (
                  <div key={series.key} className="flex min-w-0 items-center gap-2">
                    <span className="h-3 min-w-0 flex-1 overflow-hidden rounded-sm bg-surface-sunken">
                      {cell.value != null ? (
                        <span
                          aria-hidden="true"
                          className="block h-full rounded-sm"
                          style={{
                            width: `${Math.max(2, ratio(cell.value, scale) * 100)}%`,
                            background: SERIES_COLORS[seriesIndex % SERIES_COLORS.length],
                          }}
                        />
                      ) : null}
                    </span>
                    {showValueLabels ? (
                      <span
                        className={`w-20 shrink-0 text-right text-xs tabular-nums ${
                          cell.state === "warning" ? "text-caution" : "text-muted"
                        }`}
                      >
                        {cell.state === "suppressed"
                          ? "oculto"
                          : formatValue(cell.value, data.unit, data.decimals)}
                      </span>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </li>
        ))}
      </ul>
      {grouped ? <Legend data={data} /> : null}
      <OmittedNote data={data} />
    </ChartFrame>
  );
}

export function VerticalBars({
  data,
  policy,
  showValueLabels = true,
}: {
  data: ResolvedBlockData;
  policy: SampleVisibilityPolicy;
  showValueLabels?: boolean;
}) {
  if (data.categories.length === 0) {
    return <EmptyChart title="Este bloque no tiene un desglose que dibujar" detail="Elige una característica en la ficha del bloque." />;
  }
  if (!hasAnyValue(data, policy)) return <NothingToShow data={data} policy={policy} />;
  const scale = scaleFor(data, policy);

  return (
    <ChartFrame
      label={chartLabel(data, "Barras verticales")}
      table={<ValueTable data={data} policy={policy} caption={data.metricLabel} />}
    >
      <div className="min-w-0 overflow-x-auto">
        <ul
          className="m-0 flex list-none items-end gap-2 p-0"
          style={{ minWidth: `${Math.max(1, data.categories.length) * 56}px` }}
        >
          {data.categories.map((category, index) => (
            <li key={category.key} className="flex min-w-0 flex-1 flex-col items-center gap-1">
              <div className="flex h-32 w-full items-end justify-center gap-1">
                {data.series.map((series, seriesIndex) => {
                  const cell = applyPolicy(
                    series.cells[index] ?? { categoryKey: category.key, value: null, n: 0 },
                    policy,
                  );
                  return (
                    <span
                      key={series.key}
                      aria-hidden="true"
                      className="w-full max-w-8 rounded-t-sm bg-surface-sunken"
                      style={{
                        height: cell.value == null ? "2px" : `${Math.max(2, ratio(cell.value, scale) * 100)}%`,
                        background:
                          cell.value == null
                            ? "var(--color-line)"
                            : SERIES_COLORS[seriesIndex % SERIES_COLORS.length],
                      }}
                    />
                  );
                })}
              </div>
              {showValueLabels ? (
                <span className="text-[0.65rem] tabular-nums text-muted">
                  {formatValue(
                    applyPolicy(series0(data, index), policy).value,
                    data.unit,
                    data.decimals,
                  )}
                </span>
              ) : null}
              <span className="w-full truncate text-center text-[0.65rem] text-body" title={category.label}>
                {category.label}
              </span>
            </li>
          ))}
        </ul>
      </div>
      <Legend data={data} />
      <OmittedNote data={data} />
    </ChartFrame>
  );
}

function series0(data: ResolvedBlockData, index: number): DataCell {
  return data.series[0]?.cells[index] ?? { categoryKey: "", value: null, n: 0 };
}

/**
 * Stacked bars.
 *
 * `hundred` normalizes each bar to its own total, which is a different
 * statement: the reparto inside each category, with the total deliberately
 * removed. Both refuse to stack a cell the disclosure rule withheld — a
 * suppressed segment leaves a gap in the bar rather than being folded into its
 * neighbour, because folding it in would publish its size.
 */
export function StackedBars({
  data,
  policy,
  hundred = false,
}: {
  data: ResolvedBlockData;
  policy: SampleVisibilityPolicy;
  hundred?: boolean;
}) {
  if (data.categories.length === 0 || data.series.length === 0) {
    return <EmptyChart title="Una barra apilada necesita dos características" detail="Elige la segunda en la ficha del bloque." />;
  }
  if (!hasAnyValue(data, policy)) return <NothingToShow data={data} policy={policy} />;

  const totals = data.categories.map((_, index) =>
    data.series.reduce((sum, series) => {
      const cell = applyPolicy(series.cells[index] ?? { categoryKey: "", value: null, n: 0 }, policy);
      return sum + Math.max(0, cell.value ?? 0);
    }, 0),
  );
  const widest = Math.max(1, ...totals);

  return (
    <ChartFrame
      label={chartLabel(data, hundred ? "Barras apiladas al 100 %" : "Barras apiladas")}
      table={<ValueTable data={data} policy={policy} caption={data.metricLabel} />}
    >
      <ul className="m-0 min-w-0 list-none space-y-2 p-0">
        {data.categories.map((category, index) => {
          const total = totals[index];
          const denominator = hundred ? total : widest;
          return (
            <li key={category.key} className="min-w-0">
              <p className="truncate text-xs font-medium text-body" title={category.label}>
                {category.label}
              </p>
              <div
                aria-hidden="true"
                className="mt-1 flex h-4 w-full overflow-hidden rounded-sm bg-surface-sunken"
              >
                {data.series.map((series, seriesIndex) => {
                  const cell = applyPolicy(
                    series.cells[index] ?? { categoryKey: category.key, value: null, n: 0 },
                    policy,
                  );
                  const value = Math.max(0, cell.value ?? 0);
                  const width = denominator <= 0 ? 0 : (value / denominator) * 100;
                  if (width <= 0) return null;
                  return (
                    <span
                      key={series.key}
                      className="h-full"
                      style={{
                        width: `${width}%`,
                        background: SERIES_COLORS[seriesIndex % SERIES_COLORS.length],
                      }}
                    />
                  );
                })}
              </div>
            </li>
          );
        })}
      </ul>
      <Legend data={data} />
      <OmittedNote data={data} />
    </ChartFrame>
  );
}

// ---------------------------------------------------------------------------
// Line and area
// ---------------------------------------------------------------------------

export function LineChart({
  data,
  policy,
  area = false,
}: {
  data: ResolvedBlockData;
  policy: SampleVisibilityPolicy;
  area?: boolean;
}) {
  if (data.categories.length === 0) {
    return <EmptyChart title="Una línea necesita algo sobre lo que avanzar" detail="Elige la característica del eje en la ficha del bloque." />;
  }
  if (data.categories.length === 1) {
    return (
      <EmptyChart
        title="Un solo punto no dibuja una línea"
        detail="Este estudio tiene un único valor en esta característica; el número está en la tabla del bloque."
      />
    );
  }
  if (!hasAnyValue(data, policy)) return <NothingToShow data={data} policy={policy} />;

  const width = 480;
  const height = 160;
  const padding = 8;
  const scale = scaleFor(data, policy);
  const step = data.categories.length > 1 ? (width - padding * 2) / (data.categories.length - 1) : 0;
  const yFor = (value: number) => height - padding - ratio(value, scale) * (height - padding * 2);

  return (
    <ChartFrame
      label={chartLabel(data, area ? "Área" : "Línea")}
      table={<ValueTable data={data} policy={policy} caption={data.metricLabel} />}
    >
      <div className="min-w-0 overflow-x-auto">
        <svg
          aria-hidden="true"
          viewBox={`0 0 ${width} ${height}`}
          className="h-40 w-full min-w-[18rem]"
          preserveAspectRatio="none"
        >
          {data.series.map((series, seriesIndex) => {
            const points = series.cells
              .map((cell, index) => ({ cell: applyPolicy(cell, policy), index }))
              .filter((point) => point.cell.value != null)
              .map((point) => ({ x: padding + point.index * step, y: yFor(point.cell.value as number) }));
            if (points.length === 0) return null;
            const path = points.map((point, index) => `${index === 0 ? "M" : "L"}${point.x},${point.y}`).join(" ");
            const color = SERIES_COLORS[seriesIndex % SERIES_COLORS.length];
            return (
              <g key={series.key}>
                {area ? (
                  <path
                    d={`${path} L${points[points.length - 1].x},${height - padding} L${points[0].x},${height - padding} Z`}
                    fill={color}
                    opacity="0.18"
                  />
                ) : null}
                <path d={path} fill="none" stroke={color} strokeWidth="2.5" strokeLinejoin="round" />
                {points.map((point) => (
                  <circle key={`${point.x}-${point.y}`} cx={point.x} cy={point.y} r="3" fill={color} />
                ))}
              </g>
            );
          })}
        </svg>
      </div>
      <ul className="mt-1 flex min-w-0 list-none justify-between gap-2 p-0 text-[0.65rem] text-muted">
        <li className="truncate">{data.categories[0]?.label}</li>
        <li className="truncate">{data.categories[data.categories.length - 1]?.label}</li>
      </ul>
      <Legend data={data} />
      <OmittedNote data={data} />
    </ChartFrame>
  );
}

// ---------------------------------------------------------------------------
// Pie and donut
// ---------------------------------------------------------------------------

export function PieChart({
  data,
  policy,
  donut = false,
}: {
  data: ResolvedBlockData;
  policy: SampleVisibilityPolicy;
  donut?: boolean;
}) {
  if (data.categories.length === 0) {
    return <EmptyChart title="Un reparto necesita partes" detail="Elige una característica en la ficha del bloque." />;
  }
  const slices = data.categories
    .map((category, index) => ({
      label: category.label,
      key: category.key,
      cell: applyPolicy(series0(data, index), policy),
    }))
    .filter((slice) => (slice.cell.value ?? 0) > 0);
  const total = slices.reduce((sum, slice) => sum + (slice.cell.value ?? 0), 0);
  if (total <= 0) return <NothingToShow data={data} policy={policy} />;

  const size = 120;
  const centre = size / 2;
  const radius = centre - 4;

  // The wedges are computed ONCE, before anything is drawn. An accumulator
  // mutated inside a `map` is a render that depends on the order React happens
  // to call it in, which is a picture that can come out different on a re-render
  // for no reason a reader could see.
  const wedges = slices.reduce<
    { key: string; label: string; cell: CellState; path: string; color: string; end: number }[]
  >((placed, slice, index) => {
    const start = placed.length === 0 ? -Math.PI / 2 : placed[placed.length - 1].end;
    const share = (slice.cell.value as number) / total;
    const end = start + share * Math.PI * 2;
    const large = end - start > Math.PI ? 1 : 0;
    const x1 = centre + Math.cos(start) * radius;
    const y1 = centre + Math.sin(start) * radius;
    const x2 = centre + Math.cos(end) * radius;
    const y2 = centre + Math.sin(end) * radius;
    const path =
      share >= 0.999
        ? `M ${centre} ${centre - radius} A ${radius} ${radius} 0 1 1 ${centre - 0.01} ${centre - radius} Z`
        : `M ${centre} ${centre} L ${x1} ${y1} A ${radius} ${radius} 0 ${large} 1 ${x2} ${y2} Z`;
    return [
      ...placed,
      {
        key: slice.key,
        label: slice.label,
        cell: slice.cell,
        path,
        color: SERIES_COLORS[index % SERIES_COLORS.length],
        end,
      },
    ];
  }, []);

  return (
    <ChartFrame
      label={chartLabel(data, donut ? "Dona" : "Pastel")}
      table={<ValueTable data={data} policy={policy} caption={data.metricLabel} />}
    >
      <div className="flex min-w-0 flex-wrap items-center gap-4">
        <svg aria-hidden="true" viewBox={`0 0 ${size} ${size}`} className="h-28 w-28 shrink-0">
          {wedges.map((wedge) => (
            <path key={wedge.key} d={wedge.path} fill={wedge.color} />
          ))}
          {donut ? <circle cx={centre} cy={centre} r={radius * 0.58} fill="var(--color-surface)" /> : null}
        </svg>
        <ul className="m-0 min-w-0 flex-1 list-none space-y-1 p-0 text-xs">
          {wedges.map((wedge) => (
            <li key={wedge.key} className="flex min-w-0 items-center gap-2">
              <span
                aria-hidden="true"
                className="inline-block h-2.5 w-2.5 shrink-0 rounded-sm"
                style={{ background: wedge.color }}
              />
              <span className="min-w-0 flex-1 truncate text-body">{wedge.label}</span>
              <span className="shrink-0 tabular-nums text-muted">
                {formatValue(wedge.cell.value, data.unit, data.decimals)}
              </span>
            </li>
          ))}
        </ul>
      </div>
      <OmittedNote data={data} />
    </ChartFrame>
  );
}

// ---------------------------------------------------------------------------
// Table
// ---------------------------------------------------------------------------

export function DataTable({
  data,
  policy,
}: {
  data: ResolvedBlockData;
  policy: SampleVisibilityPolicy;
}) {
  if (data.categories.length === 0) {
    const cell = applyPolicy(data.overall, policy);
    return (
      <table className="w-full text-sm">
        <caption className="sr-only">{data.metricLabel}</caption>
        <tbody>
          <tr className="border-t border-line">
            <th scope="row" className="py-1.5 pr-3 text-left font-medium text-body">
              {data.metricLabel}
            </th>
            <td className="py-1.5 text-right tabular-nums text-strong">
              {cell.state === "suppressed" ? "oculto" : formatValue(cell.value, data.unit, data.decimals)}
            </td>
          </tr>
        </tbody>
      </table>
    );
  }
  const multi = data.series.length > 1;
  return (
    <div className="min-w-0 overflow-x-auto">
      <table className="w-full min-w-[16rem] text-sm">
        <caption className="sr-only">{data.metricLabel}</caption>
        <thead>
          <tr className="border-b border-line-strong text-xs text-muted">
            <th scope="col" className="py-1.5 pr-3 text-left font-medium">
              {data.categoryLabel}
            </th>
            {data.series.map((series) => (
              <th key={series.key} scope="col" className="py-1.5 pl-3 text-right font-medium">
                {multi ? series.label : data.metricLabel}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.categories.map((category, index) => (
            <tr key={category.key} className="border-b border-line last:border-0">
              <th scope="row" className="max-w-[14rem] truncate py-1.5 pr-3 text-left font-normal text-body">
                {category.label}
              </th>
              {data.series.map((series) => {
                const cell = applyPolicy(
                  series.cells[index] ?? { categoryKey: category.key, value: null, n: 0 },
                  policy,
                );
                return (
                  <td
                    key={series.key}
                    className={`py-1.5 pl-3 text-right tabular-nums ${
                      cell.state === "warning" ? "text-caution" : "text-strong"
                    }`}
                  >
                    {cell.state === "suppressed"
                      ? "oculto"
                      : formatValue(cell.value, data.unit, data.decimals)}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <OmittedNote data={data} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Journey, retention and the theme cloud
// ---------------------------------------------------------------------------

export type JourneyMomentView = {
  id: string;
  title: string;
  description: string | null;
  data: ResolvedBlockData | null;
  /** Why there is no number, when there is none. */
  missing: string | null;
  /** Prose written for this moment alone, beside the number. */
  body: string | null;
  /**
   * "No sabía que existía este momento", when a mapping is configured. Null
   * when nobody configured one — which is a DIFFERENT statement from zero
   * percent, and the card says so rather than printing a 0.
   */
  awareness: ResolvedBlockData | null;
  /** Why the awareness share is absent, when a mapping exists but failed. */
  awarenessMissing: string | null;
  /** The semáforo this moment is read against, inherited or its own. */
  scheme: BandScheme | null;
};

export function JourneyChart({
  moments,
  policy,
}: {
  moments: JourneyMomentView[];
  policy: SampleVisibilityPolicy;
}) {
  if (moments.length === 0) {
    return (
      <EmptyChart
        title="Este recorrido todavía no tiene momentos"
        detail="Los momentos se configuran en el recorrido del estudio, no desde aquí."
      />
    );
  }
  return (
    <ol className="m-0 grid min-w-0 list-none grid-cols-1 gap-2 p-0 sm:grid-cols-2 lg:grid-cols-3">
      {moments.map((moment, index) => {
        const cell = moment.data ? applyPolicy(moment.data.overall, policy) : null;
        return (
          <li key={moment.id} className="min-w-0 rounded-lg border border-line bg-surface px-3 py-2.5">
            <p className="text-[0.65rem] font-semibold uppercase tracking-[0.1em] text-muted">
              Momento {index + 1}
            </p>
            <p className="mt-0.5 truncate font-medium text-strong" title={moment.title}>
              {moment.title}
            </p>
            {cell && moment.data && cell.state !== "no_data" && cell.state !== "suppressed" ? (
              <>
                <p className="mt-1 font-display text-xl font-semibold text-strong">
                  {formatValue(cell.value, moment.data.unit, moment.data.decimals)}
                </p>
                <p className={`text-xs ${cell.state === "warning" ? "text-caution" : "text-muted"}`}>
                  {moment.data.metricLabel} · {cell.disclosedSampleSize} respuestas
                </p>
                {moment.scheme ? (
                  <div className="mt-1.5">
                    <TrafficLightBadge scheme={moment.scheme} value={cell.value} compact />
                  </div>
                ) : null}
              </>
            ) : (
              <p className="mt-1 text-xs text-caution">
                {moment.missing
                  ?? (cell?.state === "suppressed"
                    ? "No se muestra: muy pocas respuestas."
                    : "Todavía sin respuestas.")}
              </p>
            )}
            {moment.body ? <p className="mt-1.5 text-xs text-body">{moment.body}</p> : null}
            <MomentAwareness moment={moment} policy={policy} />
          </li>
        );
      })}
    </ol>
  );
}

/**
 * "NO SABÍA QUE EXISTÍA ESTE MOMENTO", with its own arithmetic on show.
 *
 * A percentage, its numerator and its base, all three, because a share of an
 * unstated denominator is a number nobody can check. It renders NOTHING when
 * no mapping is configured: a moment where the question was never asked and a
 * moment where nobody said no are different findings, and printing 0 % for the
 * first is the more damaging of the two mistakes.
 */
function MomentAwareness({
  moment,
  policy,
}: {
  moment: JourneyMomentView;
  policy: SampleVisibilityPolicy;
}) {
  if (moment.awarenessMissing) {
    return <p className="mt-1.5 text-xs text-caution">{moment.awarenessMissing}</p>;
  }
  if (!moment.awareness) return null;
  const cell = applyPolicy(moment.awareness.overall, policy);
  if (cell.state === "suppressed") {
    return (
      <p className="mt-1.5 text-xs text-muted">
        No se muestra quién no lo conocía: muy pocas respuestas.
      </p>
    );
  }
  if (cell.state === "no_data" || cell.value === null) {
    return (
      <p className="mt-1.5 text-xs text-muted">Nadie respondió si conocía este momento.</p>
    );
  }
  const numerator = moment.awareness.detail.find((entry) => entry.label === "No lo conocían")?.value;
  const base = cell.disclosedSampleSize;
  const explanation =
    numerator !== undefined && base !== null
      ? `${numerator} de ${base} personas que respondieron la pregunta dijeron que no conocían este momento.`
      : "Porcentaje de quienes respondieron la pregunta y dijeron que no lo conocían.";
  return (
    <p
      className={`mt-1.5 rounded-md px-2 py-1 text-xs ${
        cell.state === "warning" ? "bg-caution-surface text-caution" : "bg-surface-sunken text-body"
      }`}
      title={explanation}
    >
      <span className="font-semibold">
        {formatValue(cell.value, "percent", moment.awareness.decimals)}
      </span>{" "}
      no conocía este momento
      <span className="sr-only"> — {explanation}</span>
      {numerator !== undefined && base !== null ? (
        <span className="block text-[0.7rem] text-muted">
          {numerator} de {base} que respondieron
        </span>
      ) : null}
    </p>
  );
}

export function RetentionSeries({
  data,
  policy,
  periods,
}: {
  data: ResolvedBlockData | null;
  policy: SampleVisibilityPolicy;
  periods: string[];
}) {
  if (periods.length < 2) {
    return (
      <EmptyChart
        title="Todavía no hay con qué comparar"
        detail={
          periods.length === 1
            ? `Este estudio tiene un solo periodo (${periods[0]}). Una serie de permanencia necesita al menos dos.`
            : "Este estudio no tiene periodos registrados, así que no hay serie que dibujar."
        }
      />
    );
  }
  if (!data) return <EmptyChart title="Este bloque todavía no apunta a un resultado" />;
  return <LineChart data={data} policy={policy} />;
}

/**
 * THE THEMATIC CLOUD — a real one.
 *
 * What was there before placed words at hardcoded positions and printed the
 * label with its count beside it. This one is a cloud: sized by the configured
 * basis, turned deterministically, collision-free, selectable by mouse and by
 * keyboard, with a ranked list that is the reference rather than the fallback,
 * a detail panel for one theme, and an export that matches exactly what is on
 * screen.
 *
 * WHAT IT NEVER DRAWS. A pending theme — those never reach this component,
 * because only confirmed observations are loaded at all. A quote. A name. A
 * respondent. The words are the canonical themes a person confirmed, and the
 * "related spellings" are the raw wordings that same person folded INTO each
 * one, which is the merge the review already recorded.
 */
export function ThemeCloud({
  layout,
  basis = "mentions",
  showCounts = true,
  palette = "auto",
  themes = [],
  policy,
  exportName = "nube-de-temas",
}: {
  layout: ThemeCloudLayout;
  basis?: "mentions" | "people";
  showCounts?: boolean;
  palette?: ChartPalette;
  /** The richer per-theme record, for the detail panel. */
  themes?: ThemeDatum[];
  policy?: SampleVisibilityPolicy;
  exportName?: string;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const [listOpen, setListOpen] = useState(false);
  const svgRef = useRef<SVGSVGElement | null>(null);

  if (layout.ordered.length === 0) {
    return (
      <EmptyChart
        title="Todavía no hay temas confirmados"
        detail="Solo entra lo que el equipo ya confirmó en la revisión cualitativa; nada se toma de un comentario sin revisar."
      />
    );
  }

  const { width, height } = layout.options;
  const ramp = PALETTE_RAMP[palette] ?? PALETTE_RAMP.auto;
  const ROLE_COLOR: Record<PlacedTheme["colorRole"], string> = {
    evidence: "var(--color-evidence)",
    voice: "var(--color-voice)",
    sky: "var(--color-evidence-strong)",
    lavender: "var(--color-lavender)",
    green: "var(--color-positive)",
  };
  const colorOf = (theme: PlacedTheme, index: number) =>
    palette === "auto" ? ROLE_COLOR[theme.colorRole] : ramp[index % ramp.length];

  const word = basis === "people" ? "personas" : "menciones";
  const one = basis === "people" ? "persona" : "mención";
  const detail = themes.find((theme) => theme.label === selected) ?? null;
  const selectedCount = layout.ordered.find((theme) => theme.label === selected)?.count ?? null;

  /**
   * THE EXPORT IS THE PICTURE, not a re-render of it.
   *
   * It serializes the SVG that is on screen at that moment, so a filtered cloud
   * exports the filtered cloud and there is no second code path that could
   * disagree with the first. It carries words and counts and nothing else — the
   * same content the page already shows.
   */
  const download = () => {
    const svg = svgRef.current;
    if (!svg) return;
    const clone = svg.cloneNode(true) as SVGSVGElement;
    clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    clone.removeAttribute("aria-hidden");
    const blob = new Blob([clone.outerHTML], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${exportName}.svg`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  return (
    <ChartFrame
      label={`Nube de ${layout.ordered.length} temas confirmados, del más mencionado al menos mencionado, por ${word}.`}
      table={
        <ol>
          {layout.ordered.map((theme) => (
            <li key={theme.label}>
              {theme.label}: {theme.count} {theme.count === 1 ? one : word}
            </li>
          ))}
        </ol>
      }
    >
      <div className="min-w-0">
        <svg
          ref={svgRef}
          viewBox={`0 0 ${width} ${height}`}
          className="h-56 w-full min-w-0 sm:h-72"
          role="group"
          aria-label={`Nube de temas, por ${word}`}
          data-theme-cloud=""
        >
          {layout.placed.map((theme, index) => {
            const active = theme.label === selected;
            return (
              <g
                key={theme.label}
                // EVERY WORD IS A CONTROL, reachable in order by keyboard.
                // A cloud a person can only use with a mouse is a cloud half
                // the readers of a report cannot use at all.
                role="button"
                tabIndex={0}
                aria-pressed={active}
                aria-label={`${theme.label}: ${theme.count} ${theme.count === 1 ? one : word}`}
                data-theme={theme.label}
                onClick={() => setSelected(active ? null : theme.label)}
                onKeyDown={(event) => {
                  if (event.key !== "Enter" && event.key !== " ") return;
                  event.preventDefault();
                  setSelected(active ? null : theme.label);
                }}
                className="cursor-pointer outline-none [&:focus-visible>rect]:stroke-2"
                transform={
                  theme.rotation === 90 ? `rotate(-90 ${theme.x} ${theme.y})` : undefined
                }
              >
                <rect
                  x={theme.x - (theme.rotation === 90 ? theme.height : theme.width) / 2 - 4}
                  y={theme.y - (theme.rotation === 90 ? theme.width : theme.height) / 2 - 2}
                  width={(theme.rotation === 90 ? theme.height : theme.width) + 8}
                  height={(theme.rotation === 90 ? theme.width : theme.height) + 4}
                  rx={4}
                  fill={active ? "var(--color-surface-sunken)" : "transparent"}
                  stroke={active ? colorOf(theme, index) : "transparent"}
                />
                <text
                  x={theme.x}
                  y={theme.y}
                  textAnchor="middle"
                  dominantBaseline="middle"
                  fontSize={theme.fontSize}
                  fontWeight="600"
                  fill={colorOf(theme, index)}
                  opacity={selected && !active ? 0.45 : 1}
                >
                  {showCounts ? `${theme.label} (${theme.count})` : theme.label}
                </text>
              </g>
            );
          })}
        </svg>

        <p className="mt-1 text-xs text-muted">
          El tamaño de cada palabra es su número de {word}.
          {layout.omitted.length > 0
            ? ` ${layout.omitted.length} tema(s) más no cupieron en el dibujo y están en la lista completa.`
            : ""}
        </p>

        {/* --- One theme, when somebody picks one ------------------------- */}
        {selected ? (
          <div
            className="mt-2 rounded-lg border border-line bg-surface-sunken p-3"
            data-theme-detail={selected}
          >
            <div className="flex min-w-0 flex-wrap items-baseline justify-between gap-2">
              <p className="font-display text-sm font-semibold text-strong">{selected}</p>
              <button
                type="button"
                onClick={() => setSelected(null)}
                className="min-h-11 rounded-md border border-line px-3 text-xs font-medium text-body hover:bg-surface"
              >
                Cerrar
              </button>
            </div>
            <p className="mt-1 text-sm text-body">
              {detail
                ? `${detail.mentions} ${detail.mentions === 1 ? "mención" : "menciones"} de ${detail.people} ${detail.people === 1 ? "persona" : "personas"}.`
                : `${selectedCount} ${selectedCount === 1 ? one : word}.`}
            </p>
            {detail && detail.aliases.length > 0 ? (
              <p className="mt-1 text-xs text-muted">
                Se agruparon aquí, en la revisión cualitativa: {detail.aliases.join(", ")}.
              </p>
            ) : null}
            {detail && detail.sources.length > 0 ? (
              <p className="mt-1 text-xs text-muted">
                De: {detail.sources.join(", ")}.
              </p>
            ) : null}
            {/*
              NO QUOTE APPEARS HERE. The approval model records a quote as
              approved separately from the theme, and nothing in the composer
              reads one — so the detail says what the theme IS made of and
              never what somebody wrote.
            */}
          </div>
        ) : null}

        {/* --- The ranked list, visible on request ------------------------ */}
        <div className="mt-2 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setListOpen((open) => !open)}
            aria-expanded={listOpen}
            className="min-h-11 rounded-lg border border-line-strong bg-surface px-3 text-sm font-medium text-strong hover:bg-surface-sunken"
          >
            {listOpen ? "Ocultar la lista" : "Ver la lista ordenada"}
          </button>
          <button
            type="button"
            onClick={download}
            className="min-h-11 rounded-lg border border-line-strong bg-surface px-3 text-sm font-medium text-strong hover:bg-surface-sunken"
          >
            Descargar la nube
          </button>
        </div>

        {listOpen ? (
          <ol className="mt-2 min-w-0 space-y-1" data-theme-list="">
            {layout.ordered.map((theme, index) => (
              <li key={theme.label} className="min-w-0">
                <button
                  type="button"
                  onClick={() => setSelected(theme.label === selected ? null : theme.label)}
                  aria-pressed={theme.label === selected}
                  className={`flex min-h-11 w-full min-w-0 items-baseline justify-between gap-3 rounded-md px-2 text-left text-sm ${
                    theme.label === selected ? "bg-evidence-surface" : "hover:bg-surface-sunken"
                  }`}
                >
                  <span className="min-w-0 truncate text-body">
                    {index + 1}. {theme.label}
                  </span>
                  <span className="shrink-0 font-semibold text-strong">
                    {theme.count} {theme.count === 1 ? one : word}
                  </span>
                </button>
              </li>
            ))}
          </ol>
        ) : null}
      </div>
    </ChartFrame>
  );
}

// ---------------------------------------------------------------------------
// The honest states
// ---------------------------------------------------------------------------

function NothingToShow({
  data,
  policy,
}: {
  data: ResolvedBlockData;
  policy: SampleVisibilityPolicy;
}) {
  const anySample = data.series.some((series) => series.cells.some((cell) => cell.n > 0));
  if (!anySample) {
    return (
      <EmptyChart
        title="Todavía nadie respondió esta parte"
        detail="Cuando lleguen respuestas, la gráfica aparecerá aquí."
      />
    );
  }
  void policy;
  return (
    <EmptyChart
      title="La regla de divulgación está ocultando todo este desglose"
      detail="Cada grupo tiene menos respuestas que el mínimo configurado. Cambia la regla del estudio, o dale a este bloque la suya."
    />
  );
}

function OmittedNote({ data }: { data: ResolvedBlockData }) {
  if (data.omittedCategories <= 0) return null;
  return (
    <p className="mt-1.5 text-xs text-muted">
      Se muestran {data.categories.length} de {data.categories.length + data.omittedCategories}{" "}
      categorías.
    </p>
  );
}

/**
 * A drawing this build does not have.
 *
 * It says WHICH drawing is missing, by name, and shows the reference
 * representation underneath — labelled as the reference. The one thing it never
 * does is show the alternative silently, which is how somebody publishes a page
 * they did not choose.
 */
export function UnavailableRenderer({
  variant,
  children,
}: {
  variant: ChartVariant;
  children: ReactNode;
}) {
  const spec = CHART_SPECS[variant];
  const alternative = alternativeVariant(variant);
  return (
    <div className="min-w-0">
      <p className="rounded-lg border border-caution-line bg-caution-surface px-2.5 py-2 text-xs text-caution">
        <span className="font-semibold">“{spec.label}” todavía no se dibuja en esta versión.</span>{" "}
        Abajo está{" "}
        {alternative ? CHART_SPECS[alternative].label.toLowerCase() : "la tabla"} con los mismos
        números, como referencia. No es la misma gráfica.
      </p>
      <div className="mt-2 min-w-0">{children}</div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Semáforo — the real one, read against a scheme somebody agreed to
// ---------------------------------------------------------------------------

/**
 * COLOUR IS NEVER THE ONLY SIGNAL.
 *
 * Every band carries a shape and a sentence as well as a colour role, and all
 * three are drawn. That is an accessibility floor — roughly one man in twelve
 * cannot tell this product's verde from its rojo — and it is also what makes a
 * printed report and a photocopy still say something.
 */
const BAND_ROLE_STYLE: Record<
  BandColorRole,
  { dot: string; box: string; text: string }
> = {
  positive: {
    dot: "var(--color-green)",
    box: "border-positive-line bg-positive-surface",
    text: "text-positive",
  },
  caution: {
    dot: "var(--color-yellow)",
    box: "border-caution-line bg-caution-surface",
    text: "text-caution",
  },
  danger: {
    dot: "var(--color-magenta)",
    box: "border-danger-line bg-danger-surface",
    text: "text-danger",
  },
  evidence: {
    dot: "var(--color-evidence)",
    box: "border-evidence-line bg-evidence-surface",
    text: "text-evidence",
  },
  neutral: { dot: "var(--color-line-strong)", box: "border-line bg-surface-sunken", text: "text-body" },
};

/** The non-colour signal, drawn. A name a reader can say out loud. */
function BandGlyph({ shape, color, size = 18 }: { shape: BandShape; color: string; size?: number }) {
  const half = size / 2;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true" focusable="false">
      {shape === "circle" ? <circle cx={half} cy={half} r={half - 1} fill={color} /> : null}
      {shape === "square" ? (
        <rect x={1} y={1} width={size - 2} height={size - 2} rx={2} fill={color} />
      ) : null}
      {shape === "triangle" ? (
        <polygon points={`${half},1 ${size - 1},${size - 1} 1,${size - 1}`} fill={color} />
      ) : null}
      {shape === "diamond" ? (
        <polygon points={`${half},1 ${size - 1},${half} ${half},${size - 1} 1,${half}`} fill={color} />
      ) : null}
      {shape === "bar" ? (
        <rect x={1} y={half - 3} width={size - 2} height={6} rx={2} fill={color} />
      ) : null}
    </svg>
  );
}

/**
 * One value's verdict, compact enough to sit inside a journey moment.
 *
 * An unclassified value says so rather than borrowing the nearest colour: a
 * scheme with a gap in it is a scheme somebody has to finish, and this is how
 * they find out.
 */
export function TrafficLightBadge({
  scheme,
  value,
  compact = false,
}: {
  scheme: BandScheme;
  value: number | string | null;
  compact?: boolean;
}) {
  const verdict = classify(scheme, value);
  if (verdict.kind === "no_data") {
    return <span className="text-xs text-muted">{scheme.noDataLabel}</span>;
  }
  if (verdict.kind === "unclassified") {
    return (
      <span className="inline-flex items-center gap-1 rounded-md border border-caution-line bg-caution-surface px-2 py-0.5 text-xs text-caution">
        <span aria-hidden="true">▲</span>
        <span className="min-w-0">{verdict.detail}</span>
      </span>
    );
  }
  const style = BAND_ROLE_STYLE[verdict.band.colorRole];
  return (
    <span
      className={`inline-flex min-w-0 items-center gap-1.5 rounded-md border px-2 py-0.5 ${style.box} ${style.text}`}
      title={`${verdict.band.label}: ${verdict.band.meaning}`}
    >
      <BandGlyph shape={verdict.band.shape} color={style.dot} size={compact ? 12 : 16} />
      <span className="min-w-0 truncate text-xs font-semibold">{verdict.band.label}</span>
      {compact ? null : <span className="min-w-0 truncate text-xs">{verdict.band.meaning}</span>}
      <span className="sr-only">. {verdict.band.meaning}</span>
    </span>
  );
}

/** Every band, in order, so a reader can see what the colours mean. */
export function BandLegend({ scheme }: { scheme: BandScheme }) {
  return (
    <ul className="m-0 mt-2 flex min-w-0 flex-wrap gap-x-3 gap-y-1 p-0">
      {scheme.bands.map((band) => {
        const style = BAND_ROLE_STYLE[band.colorRole];
        return (
          <li key={band.id} className="flex min-w-0 list-none items-center gap-1.5 text-xs text-body">
            <BandGlyph shape={band.shape} color={style.dot} size={12} />
            <span className="min-w-0 truncate">
              <span className="font-medium text-strong">{band.label}</span>
              <span className="text-muted"> · {bandRangeText(scheme, band)}</span>
            </span>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * THE SEMÁFORO, drawn against a scheme.
 *
 * The value, the band it falls in, the shape, the sentence, and the whole
 * legend beneath — so the reading is checkable rather than a colour somebody
 * has to interpret. Every band's range is written out, which is also what
 * makes the picture printable: the legend survives a photocopy.
 */
export function SemaforoChart({
  data,
  policy,
  scheme,
}: {
  data: ResolvedBlockData;
  policy: SampleVisibilityPolicy;
  scheme: BandScheme;
}) {
  const cell = applyPolicy(data.overall, policy);
  if (cell.state === "no_data" || cell.state === "suppressed") {
    return <KpiChart data={data} policy={policy} />;
  }
  const verdict = classify(scheme, cell.value);
  const style =
    verdict.kind === "band" ? BAND_ROLE_STYLE[verdict.band.colorRole] : BAND_ROLE_STYLE.neutral;

  return (
    <ChartFrame
      label={`Semáforo “${scheme.title}”: ${data.metricLabel} vale ${formatValue(
        cell.value,
        data.unit,
        data.decimals,
      )} y queda en ${verdictText(scheme, verdict)}`}
      table={
        <table>
          <caption>
            {data.metricLabel} · semáforo {scheme.title}
          </caption>
          <tbody>
            <tr>
              <th scope="row">Valor</th>
              <td>{formatValue(cell.value, data.unit, data.decimals)}</td>
            </tr>
            <tr>
              <th scope="row">Clasificación</th>
              <td>{verdictText(scheme, verdict)}</td>
            </tr>
            <tr>
              <th scope="row">Base</th>
              <td>{cell.disclosedSampleSize ?? "no se revela"}</td>
            </tr>
            {scheme.bands.map((band) => (
              <tr key={band.id}>
                <th scope="row">{band.label}</th>
                <td>
                  {bandRangeText(scheme, band)} — {band.meaning}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      }
    >
      <div className={`min-w-0 rounded-lg border px-3 py-2.5 ${style.box}`}>
        <div className="flex min-w-0 flex-wrap items-center gap-3">
          <BandGlyph
            shape={verdict.kind === "band" ? verdict.band.shape : "circle"}
            color={style.dot}
            size={26}
          />
          <p className={`font-display text-2xl font-semibold ${style.text}`}>
            {formatValue(cell.value, data.unit, data.decimals)}
          </p>
          <div className="min-w-0">
            <p className={`text-sm font-semibold ${style.text}`}>
              {verdict.kind === "band" ? verdict.band.label : verdictText(scheme, verdict)}
            </p>
            <p className="text-xs text-body">
              {verdict.kind === "band" ? verdict.band.meaning : ""}
            </p>
          </div>
        </div>
        <p className={`mt-1 text-xs ${cell.state === "warning" ? "text-caution" : "text-muted"}`}>
          {data.metricLabel}
          {cell.disclosedSampleSize === null ? "" : ` · ${cell.disclosedSampleSize} respuestas`}
        </p>
        <BandLegend scheme={scheme} />
      </div>
    </ChartFrame>
  );
}

/**
 * WHAT A BLOCK SAYS WHEN NOBODY HAS AGREED WHAT GOOD LOOKS LIKE.
 *
 * The number, and a chip naming exactly what is missing. Never a colour: the
 * whole point of the semáforo model is that the product does not decide where
 * verde begins, and a "sensible default" here would be the product publishing
 * a verdict nobody made.
 */
export function SemaforoUnconfigured({
  data,
  policy,
}: {
  data: ResolvedBlockData;
  policy: SampleVisibilityPolicy;
}) {
  return (
    <div className="min-w-0">
      <KpiChart data={data} policy={policy} showDetail={false} />
      <p className="mt-1.5 inline-flex max-w-full items-center gap-1 rounded-md border border-caution-line bg-caution-surface px-2 py-1 text-xs text-caution">
        <span aria-hidden="true">▲</span>
        <span className="min-w-0 truncate">Falta configurar el semáforo</span>
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// The three drawings that used to say they were not drawn
// ---------------------------------------------------------------------------

/**
 * THE PALETTES, resolved from the role a block declared.
 *
 * Ramps rather than lists, because a heat map, a treemap and a bubble field
 * encode a QUANTITY in colour and a rainbow implies categories where there are
 * degrees. `categorical` is the exception and exists for the case where the
 * fill genuinely distinguishes rather than ranks.
 */
const PALETTE_RAMP: Record<ChartPalette, readonly string[]> = {
  auto: ["var(--color-sky)", "var(--color-blue)", "var(--color-evidence)"],
  mono: ["var(--color-sky)", "var(--color-blue)", "var(--color-evidence)"],
  cool: ["var(--color-sky)", "var(--color-lavender)", "var(--color-blue)"],
  warm: ["var(--color-yellow)", "var(--color-magenta)", "var(--color-voice)"],
  diverging: ["var(--color-magenta)", "var(--color-yellow)", "var(--color-green)"],
  categorical: SERIES_COLORS,
};

/**
 * A cell's fill for a ramp, as an opacity over one hue.
 *
 * INTENSITY IS NOT INTERPOLATED BETWEEN NEIGHBOURS. Each cell is coloured from
 * its OWN value against the whole range, so no colour anywhere on the drawing
 * stands for a number that was not measured. A smooth gradient across a grid
 * would invent readings between the ones that exist, which is the specific
 * dishonesty a heat map is prone to.
 */
function rampFill(weight: number, palette: ChartPalette): { color: string; opacity: number } {
  const ramp = PALETTE_RAMP[palette] ?? PALETTE_RAMP.auto;
  const color = ramp[Math.min(ramp.length - 1, Math.floor(weight * ramp.length))] ?? ramp[0];
  // Floored well above zero: a real, measured, low value must never be
  // indistinguishable from an empty cell.
  return { color, opacity: 0.25 + weight * 0.75 };
}

/** Text that stays legible on a filled cell of a given weight. */
function fillText(weight: number): string {
  return weight > 0.55 ? "var(--color-paper)" : "var(--color-strong)";
}

// --- Heat map --------------------------------------------------------------

/**
 * TWO CHARACTERISTICS CROSSED, with the value as intensity.
 *
 * WHAT MAKES IT HONEST RATHER THAN DECORATIVE:
 *
 *  - a cell with no answers is drawn as an EMPTY cell with a dash, never as
 *    the bottom of the colour scale, because "nobody answered" and "everybody
 *    answered badly" are opposite findings;
 *  - a cell the disclosure rule withheld says so and shows no colour at all,
 *    since the intensity would leak the very number that was suppressed;
 *  - every cell carries its value and its base as text on hover AND in the
 *    table underneath, so the colour is never the only place the number is;
 *  - the legend states the range the colours span, in the result's own unit.
 *
 * On a narrow screen it scrolls inside its own box: a grid squeezed to 320 px
 * is a grid nobody can read, and shrinking the cells until the labels collide
 * would be worse than asking somebody to scroll.
 */
export function HeatMap({
  data,
  policy,
  palette = "auto",
  showValueLabels = true,
}: {
  data: ResolvedBlockData;
  policy: SampleVisibilityPolicy;
  palette?: ChartPalette;
  showValueLabels?: boolean;
}) {
  if (data.categories.length === 0 || !hasAnyValue(data, policy)) {
    return (
      <EmptyChart
        title="Todavía no hay con qué llenar el mapa"
        detail="Un mapa de calor necesita dos características cruzadas y al menos un valor."
      />
    );
  }
  const scale = scaleFor(data, policy);
  const cells = data.series.map((series) =>
    series.cells.map((cell) => applyPolicy(cell, policy)),
  );

  return (
    <ChartFrame
      label={chartLabel(data, "Mapa de calor")}
      table={<ValueTable data={data} policy={policy} caption={data.metricLabel} />}
    >
      <div className="min-w-0 overflow-x-auto">
        <table className="min-w-full border-separate border-spacing-0.5 text-xs">
          <tbody>
            <tr>
              <td className="sticky left-0 z-10 bg-surface px-1 py-1 text-[0.65rem] font-semibold text-muted">
                {data.categoryLabel ?? ""}
              </td>
              {data.series.map((series) => (
                <th
                  key={series.key}
                  scope="col"
                  className="min-w-16 px-1 py-1 text-center align-bottom text-[0.65rem] font-semibold text-muted"
                >
                  <span className="block max-w-24 truncate" title={series.label ?? "Total"}>
                    {series.label ?? "Total"}
                  </span>
                </th>
              ))}
            </tr>
            {data.categories.map((category, row) => (
              <tr key={category.key}>
                <th
                  scope="row"
                  className="sticky left-0 z-10 max-w-32 truncate bg-surface px-1 py-1 text-left font-medium text-body"
                  title={category.label}
                >
                  {category.label}
                </th>
                {data.series.map((series, column) => {
                  const cell = cells[column]?.[row];
                  if (!cell || cell.state === "no_data") {
                    return (
                      <td
                        key={series.key}
                        className="min-w-16 rounded border border-dashed border-line px-1 py-2 text-center text-muted"
                        title={`${category.label} · ${series.label ?? "Total"}: sin respuestas`}
                      >
                        —
                      </td>
                    );
                  }
                  if (cell.state === "suppressed") {
                    return (
                      <td
                        key={series.key}
                        className="min-w-16 rounded border border-line bg-surface-sunken px-1 py-2 text-center text-muted"
                        title={`${category.label} · ${series.label ?? "Total"}: no se muestra, muy pocas respuestas`}
                      >
                        ·
                      </td>
                    );
                  }
                  const weight = ratio(cell.value ?? 0, scale);
                  const fill = rampFill(weight, palette);
                  return (
                    <td
                      key={series.key}
                      className="min-w-16 rounded px-1 py-2 text-center font-medium"
                      style={{
                        backgroundColor: fill.color,
                        opacity: undefined,
                        color: fillText(weight),
                        boxShadow: `inset 0 0 0 999px color-mix(in srgb, var(--color-paper) ${Math.round(
                          (1 - fill.opacity) * 100,
                        )}%, transparent)`,
                      }}
                      title={`${category.label} · ${series.label ?? "Total"}: ${formatValue(
                        cell.value,
                        data.unit,
                        data.decimals,
                      )} sobre ${cell.disclosedSampleSize} respuestas`}
                    >
                      {showValueLabels ? formatValue(cell.value, data.unit, data.decimals) : ""}
                      {cell.state === "warning" ? <span aria-hidden="true"> ▲</span> : null}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-1.5 text-xs text-muted">
        Más intenso = más alto. De {formatValue(scale.min, data.unit, data.decimals)} a{" "}
        {formatValue(scale.max, data.unit, data.decimals)}. Una celda vacía (—) es que nadie
        respondió; un punto (·) es que hubo muy pocas respuestas para mostrarla.
      </p>
    </ChartFrame>
  );
}

// --- Bubbles ---------------------------------------------------------------

/**
 * TWO CHARACTERISTICS CROSSED, with the value as AREA.
 *
 * AREA, NOT RADIUS. A circle drawn with its radius proportional to the value
 * exaggerates every difference by the square — a value twice as large looks
 * four times as big. So the radius is the square root of the weight, which is
 * what makes the AREA proportional and the reading honest.
 *
 * The catalogue restricts this to `count`, `sum`, `share` and `top_box` for a
 * reason a comment cannot fix: an NPS runs from -100 and a promedio has no
 * zero point, and neither has an area. A negative bubble is not a small
 * bubble.
 *
 * A cell with no answers draws NOTHING, not a dot. The smallest visible circle
 * still has to mean a measured value.
 */
export function BubbleChart({
  data,
  policy,
  palette = "auto",
}: {
  data: ResolvedBlockData;
  policy: SampleVisibilityPolicy;
  palette?: ChartPalette;
}) {
  if (data.categories.length === 0 || !hasAnyValue(data, policy)) {
    return (
      <EmptyChart
        title="Todavía no hay con qué dibujar las burbujas"
        detail="Necesita dos características cruzadas y al menos un valor."
      />
    );
  }
  const scale = scaleFor(data, policy);
  const columns = data.series.length;
  const rows = data.categories.length;
  // A fixed lattice: one bubble per crossing, at the centre of its cell. There
  // is no packing and no jitter, so the same data always draws the same
  // picture and two bubbles can never be placed on top of each other.
  const cellW = 96;
  const cellH = 56;
  const left = 120;
  const top = 28;
  const width = left + columns * cellW + 12;
  const height = top + rows * cellH + 12;
  const maxRadius = Math.min(cellW, cellH) / 2 - 6;
  const ramp = PALETTE_RAMP[palette] ?? PALETTE_RAMP.auto;

  return (
    <ChartFrame
      label={chartLabel(data, "Burbujas")}
      table={<ValueTable data={data} policy={policy} caption={data.metricLabel} />}
    >
      <div className="min-w-0 overflow-x-auto">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          width={width}
          height={height}
          aria-hidden="true"
          focusable="false"
          className="max-w-full"
        >
          {data.series.map((series, column) => (
            <text
              key={series.key}
              x={left + column * cellW + cellW / 2}
              y={16}
              textAnchor="middle"
              fontSize="10"
              fill="var(--color-muted)"
            >
              {(series.label ?? "Total").slice(0, 14)}
            </text>
          ))}
          {data.categories.map((category, row) => (
            <text
              key={category.key}
              x={left - 8}
              y={top + row * cellH + cellH / 2 + 3}
              textAnchor="end"
              fontSize="10"
              fill="var(--color-body)"
            >
              {category.label.slice(0, 18)}
            </text>
          ))}
          {data.series.map((series, column) =>
            data.categories.map((category, row) => {
              const cell = applyPolicy(
                series.cells[row] ?? { categoryKey: category.key, value: null, n: 0 },
                policy,
              );
              if (cell.state === "no_data" || cell.state === "suppressed" || cell.value === null) {
                return null;
              }
              const weight = ratio(cell.value, scale);
              // AREA proportional: radius scales with the square root.
              const radius = Math.max(3, Math.sqrt(weight) * maxRadius);
              return (
                <circle
                  key={`${series.key}-${category.key}`}
                  cx={left + column * cellW + cellW / 2}
                  cy={top + row * cellH + cellH / 2}
                  r={radius}
                  fill={ramp[column % ramp.length]}
                  fillOpacity={0.72}
                  stroke="var(--color-paper)"
                  strokeWidth={1}
                />
              );
            }),
          )}
        </svg>
      </div>
      <p className="mt-1.5 text-xs text-muted">
        El ÁREA de cada burbuja es proporcional al valor, de{" "}
        {formatValue(scale.min, data.unit, data.decimals)} a{" "}
        {formatValue(scale.max, data.unit, data.decimals)}. Un cruce sin respuestas no dibuja
        ninguna burbuja.
      </p>
      <VisibleValueList data={data} policy={policy} />
    </ChartFrame>
  );
}

// --- Treemap ---------------------------------------------------------------

/**
 * PARTS OF A WHOLE, BY AREA.
 *
 * The rectangle sizes are shares of the total, which is the entire claim the
 * drawing makes — and why the catalogue restricts it to `count`, `sum` and
 * `share`, the aggregations whose parts genuinely add up. A treemap of
 * averages would be a picture of an assertion nobody made.
 *
 * The layout is a deterministic slice-and-dice: largest first, alternating
 * horizontal and vertical cuts. No randomness, no clock, so a report and a
 * screen always show the same rectangles in the same places.
 *
 * A rectangle too small for its label keeps the rectangle and drops the text
 * rather than overlapping its neighbour; the ordered list underneath is the
 * reference and always carries every label and every number.
 */
export function TreemapChart({
  data,
  policy,
  palette = "auto",
}: {
  data: ResolvedBlockData;
  policy: SampleVisibilityPolicy;
  palette?: ChartPalette;
}) {
  const series = data.series[0];
  const entries = (series?.cells ?? [])
    .map((cell, index) => ({
      key: data.categories[index]?.key ?? String(index),
      label: data.categories[index]?.label ?? "",
      cell: applyPolicy(cell, policy),
    }))
    .filter((entry) => entry.cell.state !== "no_data" && (entry.cell.value ?? 0) > 0)
    // Deterministic: by value, then by label, so ties never reorder.
    .sort((a, b) => (b.cell.value ?? 0) - (a.cell.value ?? 0) || a.label.localeCompare(b.label, "es-MX"));

  if (entries.length === 0) {
    return (
      <EmptyChart
        title="Todavía no hay partes que repartir"
        detail="Los rectángulos representan la parte que cada categoría ocupa del total; sin valores positivos no hay reparto que dibujar."
      />
    );
  }

  const suppressed = (series?.cells ?? []).filter(
    (cell) => applyPolicy(cell, policy).state === "suppressed",
  ).length;
  const total = entries.reduce((sum, entry) => sum + (entry.cell.value ?? 0), 0);
  const width = 640;
  const height = 320;
  const ramp = PALETTE_RAMP[palette] ?? PALETTE_RAMP.auto;

  type Rect = { x: number; y: number; w: number; h: number };
  const placed: (Rect & { label: string; value: number; base: number | null; index: number })[] = [];
  let box: Rect = { x: 0, y: 0, w: width, h: height };
  let remaining = total;
  entries.forEach((entry, index) => {
    const value = entry.cell.value ?? 0;
    const share = remaining <= 0 ? 0 : value / remaining;
    const horizontal = box.w >= box.h;
    const cut = index === entries.length - 1
      ? { w: box.w, h: box.h }
      : horizontal
        ? { w: box.w * share, h: box.h }
        : { w: box.w, h: box.h * share };
    placed.push({
      x: box.x,
      y: box.y,
      w: cut.w,
      h: cut.h,
      label: entry.label,
      value,
      base: entry.cell.disclosedSampleSize,
      index,
    });
    box = horizontal
      ? { x: box.x + cut.w, y: box.y, w: box.w - cut.w, h: box.h }
      : { x: box.x, y: box.y + cut.h, w: box.w, h: box.h - cut.h };
    remaining -= value;
  });

  return (
    <ChartFrame
      label={chartLabel(data, "Rectángulos proporcionales")}
      table={<ValueTable data={data} policy={policy} caption={data.metricLabel} />}
    >
      <div className="min-w-0 overflow-x-auto">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          className="h-auto w-full min-w-80"
          aria-hidden="true"
          focusable="false"
        >
          {placed.map((rect) => {
            const weight = total <= 0 ? 0 : rect.value / total;
            const fill = ramp[rect.index % ramp.length];
            // A LABEL THAT WOULD NOT FIT IS DROPPED, NOT SHRUNK TO ILLEGIBILITY
            // AND NOT ALLOWED TO SPILL. The list underneath carries every one.
            const roomy = rect.w > 74 && rect.h > 34;
            return (
              <g key={rect.label + rect.index}>
                <rect
                  x={rect.x + 1}
                  y={rect.y + 1}
                  width={Math.max(0, rect.w - 2)}
                  height={Math.max(0, rect.h - 2)}
                  fill={fill}
                  fillOpacity={0.35 + weight * 0.5}
                  stroke="var(--color-paper)"
                  strokeWidth={2}
                  rx={3}
                />
                {roomy ? (
                  <>
                    <text
                      x={rect.x + 8}
                      y={rect.y + 18}
                      fontSize="11"
                      fontWeight="600"
                      fill="var(--color-strong)"
                    >
                      {rect.label.slice(0, Math.max(4, Math.floor(rect.w / 7)))}
                    </text>
                    <text x={rect.x + 8} y={rect.y + 32} fontSize="10" fill="var(--color-body)">
                      {formatValue(rect.value, data.unit, data.decimals)}
                    </text>
                  </>
                ) : null}
              </g>
            );
          })}
        </svg>
      </div>
      <p className="mt-1.5 text-xs text-muted">
        El área de cada rectángulo es su parte del total ({formatValue(total, data.unit, data.decimals)}).
        {suppressed > 0
          ? ` ${suppressed === 1 ? "1 categoría no se muestra" : `${suppressed} categorías no se muestran`} por tener muy pocas respuestas.`
          : ""}
      </p>
      <VisibleValueList data={data} policy={policy} />
    </ChartFrame>
  );
}

/**
 * THE ORDERED LIST BENEATH A DRAWING, VISIBLE RATHER THAN SCREEN-READER-ONLY.
 *
 * A bubble field and a treemap both encode magnitude as area, which the eye
 * reads approximately at best. So the numbers are printed as well as drawn —
 * for everybody, not only for somebody using a screen reader, and it is the
 * representation that survives a phone.
 */
function VisibleValueList({
  data,
  policy,
}: {
  data: ResolvedBlockData;
  policy: SampleVisibilityPolicy;
}) {
  const series = data.series[0];
  if (!series) return null;
  const rows = data.categories
    .map((category, index) => ({
      label: category.label,
      cell: applyPolicy(series.cells[index] ?? { categoryKey: category.key, value: null, n: 0 }, policy),
    }))
    .filter((row) => row.cell.state !== "no_data");
  if (rows.length === 0) return null;
  return (
    <ul className="m-0 mt-2 flex min-w-0 flex-wrap gap-x-4 gap-y-1 p-0 text-xs">
      {rows.slice(0, 24).map((row) => (
        <li key={row.label} className="flex min-w-0 list-none items-baseline gap-1">
          <span className="min-w-0 truncate text-body">{row.label}</span>
          <span className="font-semibold text-strong">
            {row.cell.state === "suppressed"
              ? "—"
              : formatValue(row.cell.value, data.unit, data.decimals)}
          </span>
        </li>
      ))}
    </ul>
  );
}
