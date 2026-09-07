/**
 * THE PART-AND-WHOLE DRAWINGS — stacked bar, bars, and the table that always
 * stands behind them.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE COMPOSITION BAR IS THE SHARES, NOT A NORMALISATION OF THEM.
 *
 * Each segment takes exactly the width its own `share` states. Those shares were
 * rounded once, on the server, at percent precision, so three of them may sum to
 * 99.9 rather than 100 — and the honest drawing leaves the 0.1 as a hairline of
 * track rather than stretching the parts to close it. Closing it would mean
 * re-deriving a share, which is arithmetic on a result, and the bar would then
 * disagree with the legend beneath it that prints the real numbers.
 *
 * A count and a share are printed exactly as they arrived. `null` means an empty
 * base and is drawn as nothing — never as a zero, because a measured zero and an
 * absent measurement are different facts and the contract keeps them apart.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * EVERY RULER IS THE SAME LENGTH.
 *
 * The bars use `MeasureList`/`MeasureRow`, whose grid is on the LIST and whose
 * rows are `display: contents`. That is not a stylistic preference: the approved
 * dashboard shipped per-row grids first, and a long category name gave itself a
 * ruler ~130px shorter than a short one, in a picture whose entire purpose is
 * comparing lengths.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import type { RenderBlock, RenderCategory } from "@/lib/presentation";
import { AbsenceNotice, type PresentationAudience } from "./absence";
import { Count, MeasureList, MeasureRow, Share } from "./primitives";
import { bandPalette, categoryMark } from "./vocabulary";

type LeafProps = { block: RenderBlock; audience: PresentationAudience };

function markFor(category: RenderCategory, index: number, offset: number): string {
  return category.band ? bandPalette(category.band.semanticColor).mark : categoryMark(index, offset);
}

/** Rows a table can draw, whichever payload the block turned out to carry. */
type Row = { label: string; note: string | null; count: number | null; share: number | null; mark: string };

function rowsOf(block: RenderBlock, offset = 0): Row[] {
  const payload = block.payload;
  if (payload.shape === "categories") {
    return payload.categories.map((category, index) => ({
      label: category.label,
      note: category.note,
      count: category.count,
      share: category.share,
      mark: markFor(category, index, offset),
    }));
  }
  if (payload.shape === "terms") {
    return payload.terms.map((term, index) => ({
      label: term.label,
      note: null,
      count: term.count,
      share: term.share,
      mark: categoryMark(index, offset),
    }));
  }
  if (payload.shape === "cohorts") {
    return payload.cohorts.map((cohort, index) => ({
      label: cohort.label,
      note: null,
      count: cohort.measured,
      share: null,
      mark: categoryMark(index, offset),
    }));
  }
  if (payload.shape === "instrument_bases") {
    return payload.instruments.map((instrument, index) => ({
      label: instrument.label,
      note: null,
      count: instrument.base.valid,
      share: null,
      mark: categoryMark(index, offset),
    }));
  }
  return [];
}

/** The longest count in the set, so a bar length has a track to be a share of. */
function largestCount(rows: Row[]): number {
  let largest = 0;
  for (const row of rows) if (row.count !== null && row.count > largest) largest = row.count;
  return largest;
}

function absenceOf(block: RenderBlock) {
  const payload = block.payload;
  if (payload.shape === "categories" || payload.shape === "value" || payload.shape === "editorial") {
    return payload.absence;
  }
  return null;
}

/** The 100% composition bar. One track, parts in their own already-final shares. */
export function StackedBar({ block, audience }: LeafProps) {
  if (block.payload.shape !== "categories") return <TableBlock block={block} audience={audience} />;
  const { categories, absence } = block.payload;
  if (categories.length === 0) {
    return absence ? <AbsenceNotice absence={absence} audience={audience} /> : null;
  }
  const label = categories
    .map((category) => `${category.label}: ${category.count ?? "sin base"}${category.share === null ? "" : ` (${category.share}%)`}`)
    .join("; ");
  return (
    <div>
      <div
        className="flex h-10 w-full overflow-hidden rounded-md border border-line bg-surface-sunken"
        role="img"
        aria-label={label}
      >
        {categories.map((category, index) =>
          category.share === null ? null : (
            <span
              key={category.label}
              className="flex items-center justify-center transition-[flex-basis] duration-[var(--motion-content)] ease-brand motion-reduce:transition-none"
              style={{
                flex: `0 0 ${category.share}%`,
                backgroundColor: markFor(category, index, 0),
              }}
            >
              {category.share >= 11 ? (
                <b className="tabular text-xs font-bold text-ink">
                  {category.share}
                  <span className="text-[0.85em]">%</span>
                </b>
              ) : null}
            </span>
          ),
        )}
      </div>
      <dl className="mt-3 grid gap-2 [grid-template-columns:repeat(auto-fit,minmax(9.5rem,1fr))]">
        {categories.map((category, index) => (
          <div key={category.label} className="rounded-md border border-line bg-surface px-2.5 py-2">
            <dt className="flex items-center gap-1.5 text-xs text-muted">
              <span
                className="inline-block h-2.5 w-2.5 shrink-0 rounded-[3px]"
                style={{ backgroundColor: markFor(category, index, 0) }}
                aria-hidden="true"
              />
              <span className="min-w-0 [overflow-wrap:anywhere]">{category.label}</span>
            </dt>
            <dd className="mt-1 flex items-baseline gap-1.5">
              <Count of={category.count ?? 0} className="font-display text-xl font-bold text-strong" />
              <Share of={category.share} className="text-xs text-muted" />
            </dd>
            {category.note ? <dd className="mt-0.5 text-xs text-muted">{category.note}</dd> : null}
          </div>
        ))}
      </dl>
    </div>
  );
}

/** Horizontal rulers, one per category, all exactly as long as each other. */
export function BarHorizontal({ block, audience, offset = 0 }: LeafProps & { offset?: number }) {
  const rows = rowsOf(block, offset);
  if (rows.length === 0) {
    const absence = absenceOf(block);
    return absence ? <AbsenceNotice absence={absence} audience={audience} /> : null;
  }
  const largest = largestCount(rows);
  return (
    <MeasureList>
      {rows.map((row) => (
        <MeasureRow
          key={row.label}
          label={row.note ? `${row.label} · ${row.note}` : row.label}
          fraction={largest === 0 || row.count === null ? 0 : row.count / largest}
          mark={row.mark}
        >
          <Count of={row.count ?? 0} />
          {row.share === null ? null : (
            <>
              {" · "}
              <Share of={row.share} />
            </>
          )}
        </MeasureRow>
      ))}
    </MeasureList>
  );
}

/**
 * Columns.
 *
 * Wide sets scroll INSIDE their own box — `overflow-x-auto` on the frame with a
 * `min-w-max` track — so the document itself never gains a horizontal scrollbar
 * at any supported width.
 */
export function BarVertical({ block, audience, offset = 0 }: LeafProps & { offset?: number }) {
  const rows = rowsOf(block, offset);
  if (rows.length === 0) {
    const absence = absenceOf(block);
    return absence ? <AbsenceNotice absence={absence} audience={audience} /> : null;
  }
  const largest = largestCount(rows);
  return (
    <div className="overflow-x-auto">
      <ul className="flex min-w-max items-end gap-3 pb-1">
        {rows.map((row) => {
          const height = largest === 0 || row.count === null ? 0 : (row.count / largest) * 100;
          return (
            <li key={row.label} className="flex w-24 shrink-0 flex-col items-center gap-1.5">
              <span className="text-sm text-body">
                <Count of={row.count ?? 0} />
              </span>
              <span className="flex h-32 w-full items-end rounded-t-md bg-surface-sunken" aria-hidden="true">
                <i
                  className="block w-full rounded-t-md transition-[height] duration-[var(--motion-content)] ease-brand motion-reduce:transition-none"
                  style={{ height: `${height}%`, backgroundColor: row.mark }}
                />
              </span>
              <span className="w-full text-center text-xs text-muted [overflow-wrap:anywhere]">{row.label}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/**
 * The table.
 *
 * It is a real `<table>`, always available as the alternative to every drawing,
 * because the picture is never the only carrier of a number. Wide tables scroll
 * inside their own box for the same reason the columns do.
 */
export function TableBlock({ block, audience }: LeafProps) {
  const payload = block.payload;

  if (payload.shape === "series") {
    return (
      <div className="overflow-x-auto">
        <table className="min-w-max border-collapse text-sm">
          <thead>
            <tr className="border-b border-line text-left">
              <th scope="col" className="py-2 pr-4 font-semibold text-strong">Periodo</th>
              {(payload.points[0]?.measures ?? []).map((measure) => (
                <th key={measure.label} scope="col" className="py-2 pr-4 font-semibold text-strong">
                  {measure.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {payload.points.map((point) => (
              <tr key={`${point.order}-${point.label}`} className="border-b border-line last:border-0">
                <th scope="row" className="py-2 pr-4 text-left font-normal text-body">{point.label}</th>
                {point.measures.map((measure) => (
                  <td key={measure.label} className="py-2 pr-4 text-body">
                    {measure.value ? (
                      <span className="tabular">{measure.value.formatted}</span>
                    ) : measure.absence ? (
                      <AbsenceNotice absence={measure.absence} audience={audience} />
                    ) : null}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  if (payload.shape === "cohorts") {
    return (
      <div className="overflow-x-auto">
        <table className="min-w-max border-collapse text-sm">
          <thead>
            <tr className="border-b border-line text-left">
              <th scope="col" className="py-2 pr-4 font-semibold text-strong">Grupo</th>
              <th scope="col" className="py-2 pr-4 font-semibold text-strong">Total</th>
              <th scope="col" className="py-2 pr-4 font-semibold text-strong">Con dato</th>
              <th scope="col" className="py-2 pr-4 font-semibold text-strong">Respondieron</th>
              <th scope="col" className="py-2 pr-4 font-semibold text-strong">No participaron</th>
              <th scope="col" className="py-2 pr-4 font-semibold text-strong">Sin registro</th>
            </tr>
          </thead>
          <tbody>
            {payload.cohorts.map((cohort) => (
              <tr key={cohort.label} className="border-b border-line last:border-0">
                <th scope="row" className="py-2 pr-4 text-left font-normal text-body">{cohort.label}</th>
                <td className="py-2 pr-4"><Count of={cohort.total} /></td>
                <td className="py-2 pr-4"><Count of={cohort.measured} /></td>
                <td className="py-2 pr-4"><Count of={cohort.responded} /></td>
                <td className="py-2 pr-4"><Count of={cohort.notParticipated} /></td>
                <td className="py-2 pr-4"><Count of={cohort.participationUnknown} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  const rows = rowsOf(block);
  if (rows.length === 0) {
    const absence = absenceOf(block);
    return absence ? <AbsenceNotice absence={absence} audience={audience} /> : null;
  }
  return (
    <div className="overflow-x-auto">
      <table className="min-w-max border-collapse text-sm">
        <thead>
          <tr className="border-b border-line text-left">
            <th scope="col" className="py-2 pr-4 font-semibold text-strong">Categoría</th>
            <th scope="col" className="py-2 pr-4 font-semibold text-strong">Personas</th>
            <th scope="col" className="py-2 font-semibold text-strong">Proporción</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.label} className="border-b border-line last:border-0">
              <th scope="row" className="py-2 pr-4 text-left font-normal text-body [overflow-wrap:anywhere]">
                {row.note ? `${row.label} · ${row.note}` : row.label}
              </th>
              <td className="py-2 pr-4"><Count of={row.count ?? 0} /></td>
              <td className="py-2"><Share of={row.share} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
