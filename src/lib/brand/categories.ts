/**
 * Category accents — the disciplined half of the broader palette.
 *
 * The identity's five secondary hues are used to tell one thing apart from
 * another: which touchpoint you are standing on, which finding the selector is
 * showing, which kind of work is waiting. Assignment is by POSITION, so it is
 * deterministic and stable across renders, and it carries no verdict: a stage
 * is not "green because it is good", it is green because it is the third stage.
 *
 * Outcome meaning stays with the semantic caution / danger / positive tokens,
 * which are never sourced from here.
 */

export type CategoryAccent = {
  /** The hue itself, for fills and marks only. */
  fill: string;
  /** A tint safe to put `--color-strong` text on. */
  surface: string;
  /** A visible border derived from the hue. */
  line: string;
};

/**
 * Ordered so that adjacent items are easy to tell apart, including for the two
 * most common colour-vision deficiencies — which is why blue and magenta lead
 * and green never sits next to yellow.
 */
export const CATEGORY_ACCENTS: CategoryAccent[] = [
  { fill: "var(--color-blue)", surface: "var(--color-sky-surface)", line: "var(--color-sky-line)" },
  { fill: "var(--color-magenta)", surface: "var(--color-magenta-surface)", line: "var(--color-magenta-line)" },
  { fill: "var(--color-green)", surface: "var(--color-green-surface)", line: "var(--color-green-line)" },
  { fill: "var(--color-lavender)", surface: "var(--color-lavender-surface)", line: "var(--color-lavender-line)" },
  { fill: "var(--color-yellow)", surface: "var(--color-yellow-surface)", line: "var(--color-yellow-line)" },
];

/** The accent for the item at `index`, cycling when there are more than five. */
export function categoryAccent(index: number): CategoryAccent {
  const list = CATEGORY_ACCENTS;
  return list[((index % list.length) + list.length) % list.length];
}
