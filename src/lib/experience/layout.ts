/**
 * Where a block sits, at each of three widths.
 *
 * THE ONE DESIGN DECISION THAT MATTERS HERE: there are no coordinates.
 *
 * A block declares an ORDER and a SPAN, and rows are computed by filling the
 * 12-column grid left to right and wrapping when the next block does not fit.
 * There is no x, no y, no pixel, no absolute position and no z-index — so two
 * blocks cannot overlap, and no arrangement can be wider than the grid. Those
 * two properties are not enforced by a check somebody could forget to run; they
 * are consequences of the model, and `rowsFor` below is how they are proved.
 *
 * Mobile is stricter still: every visible block spans the full width. A phone
 * has no room for two things side by side, and the deployed product already
 * paid for discovering that the hard way (the P6 mobile-overflow defects). A
 * composer that lets an operator put four cards in a row on a 320 px screen is
 * a composer that ships horizontal scrolling to a client.
 */

import { EXPERIENCE_LIMITS } from "./limits";
import { blockSpec, type BlockType } from "./blocks";

export const BREAKPOINTS = ["desktop", "tablet", "mobile"] as const;
export type Breakpoint = (typeof BREAKPOINTS)[number];

/** The width each breakpoint is designed against, in the acceptance matrix. */
export const BREAKPOINT_WIDTHS: Record<Breakpoint, number> = {
  desktop: 1280,
  tablet: 768,
  mobile: 360,
};

export type BlockPlacement = {
  /**
   * The block's position in the page's reading order at this width. Ties are
   * broken by the block's position in the page array, so an order that repeats
   * is legal and still deterministic.
   */
  order: number;
  /** How many of the twelve columns it occupies. */
  span: number;
  /** Whether it appears at this width at all. */
  visible: boolean;
};

export type ResponsiveLayout = Record<Breakpoint, BlockPlacement>;

export const GRID_COLUMNS = EXPERIENCE_LIMITS.gridColumns;

/**
 * A sensible starting layout for a block of one type.
 *
 * Desktop takes the type's declared default. Tablet doubles anything that was
 * narrower than half a row and gives everything else the full width, which is
 * the arrangement that keeps a three-across row of results readable at 768 px
 * without anybody having to think about it.
 */
export function defaultLayout(type: BlockType, order: number): ResponsiveLayout {
  const spec = blockSpec(type);
  const desktop = Math.min(GRID_COLUMNS, Math.max(spec.span.min, spec.span.default));
  const tablet =
    desktop <= GRID_COLUMNS / 2
      ? Math.min(GRID_COLUMNS, Math.max(spec.span.min, desktop * 2))
      : GRID_COLUMNS;
  return {
    desktop: { order, span: desktop, visible: true },
    tablet: { order, span: tablet, visible: true },
    // Full width, always. See the header.
    mobile: { order, span: GRID_COLUMNS, visible: true },
  };
}

export type LayoutProblem = {
  breakpoint: Breakpoint;
  code: "span_out_of_grid" | "span_below_minimum" | "span_above_maximum" | "mobile_not_full_width";
  detail: string;
};

/**
 * Everything wrong with one block's layout, as structured problems.
 *
 * Called by the validator, never by a renderer: a renderer that had to cope
 * with an invalid layout would be a renderer that could draw one.
 */
export function layoutProblems(type: BlockType, layout: ResponsiveLayout): LayoutProblem[] {
  const spec = blockSpec(type);
  const problems: LayoutProblem[] = [];
  for (const breakpoint of BREAKPOINTS) {
    const placement = layout[breakpoint];
    if (placement.span < 1 || placement.span > GRID_COLUMNS) {
      problems.push({
        breakpoint,
        code: "span_out_of_grid",
        detail: `el ancho ${placement.span} está fuera de la retícula de ${GRID_COLUMNS}`,
      });
      continue;
    }
    if (breakpoint === "mobile") {
      if (placement.span !== GRID_COLUMNS) {
        problems.push({
          breakpoint,
          code: "mobile_not_full_width",
          detail: "en teléfono cada bloque ocupa el ancho completo",
        });
      }
      // The per-type minimum does not apply on a phone: everything is full
      // width there, which is by definition at least the minimum.
      continue;
    }
    if (placement.span < spec.span.min) {
      problems.push({
        breakpoint,
        code: "span_below_minimum",
        detail: `este bloque necesita al menos ${spec.span.min} columnas`,
      });
    }
    if (placement.span > spec.span.max) {
      problems.push({
        breakpoint,
        code: "span_above_maximum",
        detail: `este bloque admite como máximo ${spec.span.max} columnas`,
      });
    }
  }
  return problems;
}

export type PlacedBlock = { id: string; type: BlockType; layout: ResponsiveLayout };

/**
 * The rows one page produces at one width.
 *
 * This IS the overlap guarantee: blocks are consumed in order, each row is
 * filled until the next span would exceed twelve columns, and a new row starts.
 * Nothing is ever placed on top of anything, and no row can total more than the
 * grid — a gate asserts exactly that over generated arrangements.
 */
export function rowsFor(blocks: readonly PlacedBlock[], breakpoint: Breakpoint): string[][] {
  const ordered = blocks
    .map((block, index) => ({ block, index }))
    .filter(({ block }) => block.layout[breakpoint].visible)
    .sort((a, b) => {
      const byOrder = a.block.layout[breakpoint].order - b.block.layout[breakpoint].order;
      return byOrder !== 0 ? byOrder : a.index - b.index;
    });

  const rows: string[][] = [];
  let row: string[] = [];
  let used = 0;
  for (const { block } of ordered) {
    const span = Math.min(GRID_COLUMNS, Math.max(1, block.layout[breakpoint].span));
    if (used + span > GRID_COLUMNS && row.length > 0) {
      rows.push(row);
      row = [];
      used = 0;
    }
    row.push(block.id);
    used += span;
  }
  if (row.length > 0) rows.push(row);
  return rows;
}

/** How wide each row actually is. Never more than the grid, by construction. */
export function rowWidths(blocks: readonly PlacedBlock[], breakpoint: Breakpoint): number[] {
  const spanById = new Map(
    blocks.map((block) => [
      block.id,
      Math.min(GRID_COLUMNS, Math.max(1, block.layout[breakpoint].span)),
    ]),
  );
  return rowsFor(blocks, breakpoint).map((row) =>
    row.reduce((total, id) => total + (spanById.get(id) ?? 0), 0),
  );
}

/** The Tailwind column-span utility for a placement. A closed mapping. */
const SPAN_CLASS: Record<number, string> = {
  1: "col-span-1",
  2: "col-span-2",
  3: "col-span-3",
  4: "col-span-4",
  5: "col-span-5",
  6: "col-span-6",
  7: "col-span-7",
  8: "col-span-8",
  9: "col-span-9",
  10: "col-span-10",
  11: "col-span-11",
  12: "col-span-12",
};

/**
 * The class for one span. Deliberately a lookup rather than a template string:
 * Tailwind cannot see a class it has to compute, and an operator-chosen number
 * must never become part of a class name.
 */
export function spanClass(span: number): string {
  return SPAN_CLASS[Math.min(GRID_COLUMNS, Math.max(1, Math.round(span)))] ?? "col-span-12";
}

/** The same mapping, applied only from 640 px up. Written out for the same reason. */
const SM_SPAN_CLASS: Record<number, string> = {
  1: "sm:col-span-1",
  2: "sm:col-span-2",
  3: "sm:col-span-3",
  4: "sm:col-span-4",
  5: "sm:col-span-5",
  6: "sm:col-span-6",
  7: "sm:col-span-7",
  8: "sm:col-span-8",
  9: "sm:col-span-9",
  10: "sm:col-span-10",
  11: "sm:col-span-11",
  12: "sm:col-span-12",
};

/**
 * The span a composing surface applies ONLY when the screen it is drawn on has
 * room for it.
 *
 * A preview of the 1280 px arrangement, shown on a 390 px phone, cannot honour
 * a three-column block: three columns of a 390 px screen is 85 px, which is not
 * a preview of anything. The composer therefore stacks below 640 px and applies
 * the previewed placement above it, and says which width it is previewing. The
 * DEFINITION is untouched by this: what a block spans at each breakpoint is
 * still exactly what the document says.
 */
export function responsiveSpanClass(span: number): string {
  const clamped = Math.min(GRID_COLUMNS, Math.max(1, Math.round(span)));
  return `${spanClass(GRID_COLUMNS)} ${SM_SPAN_CLASS[clamped] ?? "sm:col-span-12"}`;
}
