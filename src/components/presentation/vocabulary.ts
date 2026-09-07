/**
 * THE RENDERER'S VOCABULARY — semantic names to Be Community's own tokens.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * A COLOUR ARRIVES AS A MEANING, NOT AS A HEX.
 *
 * `ResultBand.semanticColor` is one of eight words. The canonical layer chose
 * the word; the palette that draws it belongs here, and it is the APPLICATION's
 * palette — `globals.css` — never the approved dashboard's stylesheet. The two
 * happen to share a warm-paper identity, which is why the adaptation looks like
 * the oracle; they are not the same file and this one is not a copy.
 *
 * `--color-blue` is a FILL, not a text colour: it reaches 4.33:1 on the sunken
 * surface and the contrast gate forbids `text-blue` in eight named files for
 * exactly that reason. Text uses `--color-evidence`. Every pair below keeps
 * that split: `mark` is what a bar or a dot is painted with, `text` is what a
 * word is written in, and they are never swapped.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * GROUPING COLOUR AND OUTCOME COLOUR ARE DIFFERENT FAMILIES.
 *
 * `safe` / `alert` / `danger` are a VERDICT — the study says this is good or
 * bad — and they map to positive / caution / danger. The five category tints
 * mean "this is a different thing" and never a verdict, so a composition bar
 * whose parts are promoters, passives and detractors uses the category family
 * even though a reader may read a verdict into it: the parts of a whole are not
 * three judgements, and painting them as judgements would be this layer
 * asserting something the canonical band did not.
 *
 * `red` / `yellow` / `green` are the source's own band words and DO carry a
 * verdict, so those three go to the outcome family. `gray` and `neutral` carry
 * none and go to the line colour.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import type { ResultUnit, SemanticColor } from "@/lib/results/contract";

/** What a mark is painted with, and what a word beside it is written in. */
export type BandPalette = {
  /** A CSS colour for a bar, a dot, a stroke. Never used for text. */
  mark: string;
  /** A Tailwind text class that clears 4.5:1 on every product surface. */
  text: string;
  /** A tinted plate class pair for a chip or a cell. */
  surface: string;
};

const OUTCOME: Record<"safe" | "alert" | "danger", BandPalette> = {
  safe: { mark: "var(--color-positive)", text: "text-positive", surface: "bg-positive-surface border-positive-line" },
  alert: { mark: "var(--color-caution)", text: "text-caution", surface: "bg-caution-surface border-caution-line" },
  danger: { mark: "var(--color-danger)", text: "text-danger", surface: "bg-danger-surface border-danger-line" },
};

const NEUTRAL: BandPalette = {
  mark: "var(--color-line-strong)",
  text: "text-muted",
  surface: "bg-surface-sunken border-line",
};

export function bandPalette(color: SemanticColor | null): BandPalette {
  switch (color) {
    case "safe":
    case "green":
      return OUTCOME.safe;
    case "alert":
    case "yellow":
      return OUTCOME.alert;
    case "danger":
    case "red":
      return OUTCOME.danger;
    default:
      return NEUTRAL;
  }
}

/**
 * The five grouping tints, in a fixed cycle.
 *
 * Fixed so the same category is the same colour every time a page is drawn, and
 * so two adjacent blocks do not both open on the same hue. The order matches
 * `globals.css`'s own declaration order.
 */
export const CATEGORY_MARKS: readonly string[] = Object.freeze([
  "var(--color-green)",
  "var(--color-sky)",
  "var(--color-yellow)",
  "var(--color-lavender)",
  "var(--color-magenta)",
]);

export function categoryMark(index: number, offset = 0): string {
  return CATEGORY_MARKS[(index + offset) % CATEGORY_MARKS.length];
}

/**
 * The unit a value is in, for LAYOUT decisions only.
 *
 * A renderer may ask "does this belong on a 0..100 track" to choose a geometry.
 * It may never ask "what is this value" to change the value, and it may never
 * derive the drawn text from the unit — `formatted` is the only text.
 */
export function unitIsHundredScale(unit: ResultUnit): boolean {
  return unit === "percent" || unit === "index" || unit === "ratio";
}

/** The suffix a scale carries, as a caption beside a number that already reads. */
export function unitSuffix(unit: ResultUnit): string | null {
  switch (unit) {
    case "percent":
    case "ratio":
      return "%";
    case "index":
      return "/ 100";
    default:
      return null;
  }
}

/* -------------------------------------------------------------------------- */
/* the twelve-column grid                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Span to Tailwind class, as a LOOKUP rather than a template.
 *
 * Tailwind v4 scans source text for complete class names; `col-span-${n}` is
 * never in the source, so the class is never generated and the block silently
 * spans one column. A table is the only form that survives the scanner.
 */
export const DESKTOP_SPAN: Record<number, string> = {
  1: "lg:col-span-1", 2: "lg:col-span-2", 3: "lg:col-span-3", 4: "lg:col-span-4",
  5: "lg:col-span-5", 6: "lg:col-span-6", 7: "lg:col-span-7", 8: "lg:col-span-8",
  9: "lg:col-span-9", 10: "lg:col-span-10", 11: "lg:col-span-11", 12: "lg:col-span-12",
};

export const TABLET_SPAN: Record<number, string> = {
  1: "sm:col-span-1", 2: "sm:col-span-2", 3: "sm:col-span-3", 4: "sm:col-span-4",
  5: "sm:col-span-5", 6: "sm:col-span-6", 7: "sm:col-span-7", 8: "sm:col-span-8",
  9: "sm:col-span-9", 10: "sm:col-span-10", 11: "sm:col-span-11", 12: "sm:col-span-12",
};
