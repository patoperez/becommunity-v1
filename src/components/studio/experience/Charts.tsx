import type { ReactNode } from "react";

import { formatNumber } from "@/lib/calc/format";
import type { DataCell, ResolvedBlockData, SeriesUnit } from "@/lib/experience/data";
import type { ChartVariant } from "@/lib/experience/charts";
import { CHART_SPECS, alternativeVariant } from "@/lib/experience/charts";
import {
  evaluateSampleVisibility,
  type SampleVisibilityPolicy,
} from "@/lib/experience/sample-policy";
import type { PlacedTheme, ThemeCloudLayout } from "@/lib/experience/theme-cloud";

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
    <div className="rounded-lg border border-dashed border-line bg-surface-sunken px-4 py-5 text-sm">
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
      <p className="font-display text-3xl font-semibold leading-tight text-strong">
        {formatValue(cell.value, data.unit, data.decimals)}
      </p>
      <p className="mt-0.5 truncate text-xs text-muted">{data.metricLabel}</p>
      {cell.state === "warning" ? (
        <p className="mt-1 text-xs text-caution">
          Pocas respuestas: {cell.disclosedSampleSize}. Léelo como un indicio.
        </p>
      ) : (
        <p className="mt-1 text-xs text-muted">{cell.disclosedSampleSize} respuestas</p>
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
}: {
  data: ResolvedBlockData;
  policy: SampleVisibilityPolicy;
  target: TargetRange | null;
}) {
  const cell = applyPolicy(data.overall, policy);
  if (cell.state === "no_data" || cell.state === "suppressed") {
    return <KpiChart data={data} policy={policy} />;
  }
  if (!target || (target.minimum === null && target.maximum === null)) {
    return (
      <div className="min-w-0">
        <KpiChart data={data} policy={policy} showDetail={false} />
        <p className="mt-2 rounded-lg border border-caution-line bg-caution-surface px-2.5 py-2 text-xs text-caution">
          Un semáforo necesita un rango acordado. Define el rango ideal de este resultado en la
          ficha del bloque; mientras tanto se muestra el número sin color.
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
              </>
            ) : (
              <p className="mt-1 text-xs text-caution">
                {moment.missing
                  ?? (cell?.state === "suppressed"
                    ? "No se muestra: muy pocas respuestas."
                    : "Todavía sin respuestas.")}
              </p>
            )}
          </li>
        );
      })}
    </ol>
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

export function ThemeCloud({ layout }: { layout: ThemeCloudLayout }) {
  if (layout.ordered.length === 0) {
    return (
      <EmptyChart
        title="Todavía no hay temas confirmados"
        detail="Solo entra lo que el equipo ya confirmó en la revisión cualitativa."
      />
    );
  }
  const { width, height } = layout.options;
  const ROLE_COLOR: Record<PlacedTheme["colorRole"], string> = {
    evidence: "var(--color-evidence)",
    voice: "var(--color-voice)",
    sky: "var(--color-evidence-strong)",
    lavender: "var(--color-lavender)",
    green: "var(--color-positive)",
  };
  return (
    <ChartFrame
      label={`Nube de ${layout.ordered.length} temas confirmados, del más mencionado al menos mencionado.`}
      table={
        <ul>
          {layout.ordered.map((theme) => (
            <li key={theme.label}>
              {theme.label}: {theme.count} {theme.count === 1 ? "mención" : "menciones"}
            </li>
          ))}
        </ul>
      }
    >
      <svg aria-hidden="true" viewBox={`0 0 ${width} ${height}`} className="h-44 w-full min-w-0">
        {layout.placed.map((theme) => (
          <text
            key={theme.label}
            x={theme.x}
            y={theme.y}
            textAnchor="middle"
            dominantBaseline="middle"
            fontSize={theme.fontSize}
            fontWeight="600"
            fill={ROLE_COLOR[theme.colorRole]}
          >
            {theme.label} ({theme.count})
          </text>
        ))}
      </svg>
      {layout.omitted.length > 0 ? (
        <p className="mt-1 text-xs text-muted">
          {layout.omitted.length} tema(s) más no cupieron en el dibujo. Están en la lista completa.
        </p>
      ) : null}
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
