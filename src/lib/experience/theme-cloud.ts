/**
 * What a theme cloud has to be, before one is built.
 *
 * THE HONEST STARTING POINT: the deployed visualization is not a cloud. It
 * places up to nine words at nine hardcoded percentage positions
 * (`src/components/evidence/QualitativeCloud.tsx`), which means a tenth theme
 * silently disappears and two long labels can sit on top of each other. It is
 * good enough to have shipped and it is not what the product should mean by
 * "nube de temas".
 *
 * This module is the CONTRACT for the real one, plus the deterministic layout
 * that satisfies it. It does not replace the deployed component: that stays
 * exactly as it is until a slice deliberately swaps it, and nothing here is
 * imported by any client-facing route.
 *
 * The rules that make it publishable rather than decorative:
 *
 *  - SOURCE. Only CONFIRMED themes and their counts. Never raw comment text,
 *    never a suggestion, never anything a person has not approved. A cloud
 *    built from free text would put an unreviewed sentence on a client's
 *    screen, which is the one thing the qualitative boundary exists to stop.
 *  - SIZE MEANS COUNT, and the count is written next to the word, so the
 *    graphic is never the only place the quantity exists.
 *  - DETERMINISTIC POSITIONS. The same themes always land in the same places,
 *    so a screenshot in a report and the screen agree, and so a gate can assert
 *    a layout without rendering it.
 *  - NO OVERLAP. Placement is collision-checked against already-placed boxes.
 *  - AN ORDERED LIST IS ALWAYS AVAILABLE, and it is the reference. The visual
 *    is the alternative, not the other way round.
 *
 * AI grouping is explicitly not part of this. Themes are grouped by the human
 * category review, which already exists and already records who decided what.
 */

export const THEME_VISUALIZATIONS = ["cloud", "bubbles", "bars", "list"] as const;
export type ThemeVisualization = (typeof THEME_VISUALIZATIONS)[number];

/** The brand roles a word may take. Roles, never hex authored by an operator. */
export const THEME_COLOR_ROLES = ["evidence", "voice", "sky", "lavender", "green"] as const;
export type ThemeColorRole = (typeof THEME_COLOR_ROLES)[number];

export type ThemeCloudInput = {
  /** A CONFIRMED theme and how many confirmed observations carry it. */
  label: string;
  count: number;
  /**
   * Where the reader is sent to see the evidence behind the word. A route the
   * caller constructs; the cloud never builds a link out of a stored value.
   */
  evidenceHref: string | null;
};

/**
 * How words are turned to fill a box.
 *
 * `horizontal` reads best and is what a printed report wants. `mixed` fills a
 * box more densely by turning some words 90°, which is what makes a cloud look
 * like a cloud rather than like a centred list — at the cost of the reader
 * tilting their head. `mostly_horizontal` is the compromise and the default:
 * every third word turns, deterministically by POSITION rather than at random,
 * so the same themes always produce the same picture.
 */
export const THEME_ORIENTATIONS = ["horizontal", "mostly_horizontal", "mixed"] as const;
export type ThemeOrientation = (typeof THEME_ORIENTATIONS)[number];

export type ThemeCloudOptions = {
  /** The drawing area. Bounded so the layout is responsive by construction. */
  width: number;
  height: number;
  /** Words beyond this are summarized rather than dropped silently. */
  maximumWords: number;
  minimumFontSize: number;
  maximumFontSize: number;
  orientation: ThemeOrientation;
  /**
   * WHETHER THE COUNT IS DRAWN BESIDE THE WORD — which is a LAYOUT fact, not a
   * decoration.
   *
   * The renderer draws “precio y valor (12)” when it is on and “precio y
   * valor” when it is off, and those are different widths. Reserving space for
   * the shorter one and drawing the longer one is not a rounding error: it is
   * how two words end up printed on top of each other, and the reserved box is
   * the only thing standing between a cloud and that.
   */
  showCounts: boolean;
};

export const DEFAULT_THEME_CLOUD_OPTIONS: ThemeCloudOptions = {
  width: 1200,
  height: 675,
  maximumWords: 40,
  minimumFontSize: 20,
  maximumFontSize: 56,
  orientation: "mostly_horizontal",
  showCounts: true,
};

export type PlacedTheme = {
  label: string;
  count: number;
  fontSize: number;
  colorRole: ThemeColorRole;
  /** 0 or 90. Deterministic: decided by position, never by a random number. */
  rotation: 0 | 90;
  /** Box centre and extent, in the drawing area's own units. */
  x: number;
  y: number;
  width: number;
  height: number;
  evidenceHref: string | null;
};

export type ThemeCloudLayout = {
  options: ThemeCloudOptions;
  placed: PlacedTheme[];
  /** Words that did not fit. Counted, never silently discarded. */
  omitted: { label: string; count: number }[];
  /** The reference representation, always present, always ordered. */
  ordered: { label: string; count: number }[];
};

export const THEME_WORD_PADDING = { x: 4, y: 2 } as const;

/**
 * A crude but stable text-extent estimate. No DOM, no fonts, no measurement.
 *
 * DELIBERATELY GENEROUS. The estimate has one job: to be at least as wide as
 * the glyphs that will actually be drawn. Too wide and the cloud is a little
 * airier than it had to be; too narrow and two words are printed on top of
 * each other, which is the one failure a cloud cannot recover from. The words
 * are drawn semibold, which is wider than the regular face this ratio was
 * first fitted against, so the ratio errs upward on purpose.
 */
function extent(text: string, fontSize: number): { width: number; height: number } {
  return {
    width: text.length * fontSize * 0.64 + fontSize + THEME_WORD_PADDING.x * 2,
    height: fontSize * 1.6 + THEME_WORD_PADDING.y * 2,
  };
}

/**
 * THE HALO AROUND A WORD IS PART OF THE WORD'S FOOTPRINT.
 *
 * A selected word is drawn inside a rounded plate, and a focused one gets a
 * ring. That plate is a few units larger than the glyphs, and if the layout
 * reserved only the glyphs then two neighbours whose boxes merely TOUCH would
 * have plates that overlap by exactly this much — visible the moment somebody
 * selects one. So the padding is declared here, counted into every reserved
 * box, and the renderer draws the plate at the reserved box rather than adding
 * the padding a second time.
 */

/** What the renderer will actually put on the screen for one word. */
function drawnText(label: string, count: number, showCounts: boolean): string {
  return showCounts ? `${label} (${count})` : label;
}

function overlaps(a: PlacedTheme, b: PlacedTheme): boolean {
  return (
    Math.abs(a.x - b.x) * 2 < a.width + b.width && Math.abs(a.y - b.y) * 2 < a.height + b.height
  );
}

/**
 * A compact, collision-aware, entirely deterministic layout.
 *
 * Words are placed largest first, spiralling out from the centre on a fixed
 * lattice. There is no randomness and no clock, so the same input always
 * produces the same output — which is what lets a report and a screen show the
 * same picture, and what lets a gate assert one.
 */
export function layoutThemeCloud(
  themes: readonly ThemeCloudInput[],
  options: ThemeCloudOptions = DEFAULT_THEME_CLOUD_OPTIONS,
): ThemeCloudLayout {
  const ordered = [...themes]
    .filter((theme) => theme.count > 0 && theme.label.trim() !== "")
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, "es-MX"))
    .map((theme) => ({ ...theme, label: theme.label.trim() }));

  const considered = ordered.slice(0, options.maximumWords);
  const capped = ordered
    .slice(options.maximumWords)
    .map((theme) => ({ label: theme.label, count: theme.count }));

  /*
   * NARROW THE RANGE BEFORE DROPPING A THEME.
   *
   * A cloud that cannot fit its words has two ways out, and only one of them
   * is honest about what it is doing. Dropping the smaller themes silently
   * changes what the reader is looking at; drawing everything a little closer
   * in size changes only how it looks. So the spread between the smallest and
   * the largest word is reduced in fixed steps until everything fits, and the
   * FLOOR is never crossed: the smallest word stays exactly the size the block
   * was configured with, which is the size somebody decided was readable.
   *
   * Deterministic and bounded: five attempts, in a fixed order, no clock and
   * no randomness — the same themes in the same box always produce the same
   * picture, on a screen and in a report.
   */
  const spreads = [1, 0.8, 0.6, 0.4, 0];
  let attempt = attemptLayout(considered, options, spreads[0]);
  for (const spread of spreads.slice(1)) {
    if (attempt.omitted.length === 0) break;
    attempt = attemptLayout(considered, options, spread);
  }

  return {
    options,
    placed: attempt.placed,
    omitted: [...attempt.omitted, ...capped],
    ordered: ordered.map((theme) => ({ label: theme.label, count: theme.count })),
  };
}

/** One placement pass at a given spread between the smallest and largest word. */
function attemptLayout(
  considered: readonly (ThemeCloudInput & { label: string })[],
  options: ThemeCloudOptions,
  spread: number,
): { placed: PlacedTheme[]; omitted: { label: string; count: number }[] } {
  const omitted: { label: string; count: number }[] = [];
  const max = Math.max(1, ...considered.map((theme) => theme.count));
  const min = Math.min(...considered.map((theme) => theme.count), max);
  const placed: PlacedTheme[] = [];

  for (const [index, theme] of considered.entries()) {
    const weight = max === min ? 1 : (theme.count - min) / (max - min);
    const fontSize = Math.round(
      options.minimumFontSize
        + weight * spread * (options.maximumFontSize - options.minimumFontSize),
    );
    /*
     * ROTATION BY POSITION, NEVER BY CHANCE.
     *
     * A cloud that turns words at random redraws itself differently on every
     * reload, so a screenshot in a report and the screen stop agreeing and no
     * gate can assert a layout. The rule is arithmetic on the index: the
     * largest words stay horizontal in every mode, because the ones a reader
     * looks at first should not be the ones they have to tilt their head for.
     */
    const turned: 0 | 90 =
      options.orientation === "horizontal" || index < 2
        ? 0
        : options.orientation === "mixed"
          ? index % 2 === 1
            ? 90
            : 0
          : index % 3 === 2
            ? 90
            : 0;
    const flat = extent(drawnText(theme.label, theme.count, options.showCounts), fontSize);
    /*
     * ROTATION YIELDS TO FIT.
     *
     * A turned word is as tall as it is long, and a long theme turned on its
     * side is taller than the drawing area — so it can never be placed
     * anywhere, and the cloud reports it as "did not fit" when the only reason
     * is that the layout insisted on standing it up. Turning is a stylistic
     * choice; showing the theme is not. The rule stays deterministic: the same
     * theme in the same box always makes the same decision.
     */
    const rotation: 0 | 90 = turned === 90 && flat.width > options.height ? 0 : turned;
    // A turned word occupies a box turned with it.
    const box = rotation === 90 ? { width: flat.height, height: flat.width } : flat;
    const candidate: PlacedTheme = {
      label: theme.label,
      count: theme.count,
      fontSize,
      colorRole: THEME_COLOR_ROLES[index % THEME_COLOR_ROLES.length],
      rotation,
      x: options.width / 2,
      y: options.height / 2,
      width: box.width,
      height: box.height,
      evidenceHref: theme.evidenceHref,
    };

    // An Archimedean spiral on a fixed step. Bounded iterations: a word that
    // cannot be placed is reported, never looped over.
    let settled = false;
    for (let step = 0; step < 720; step += 1) {
      const angle = step * 0.35;
      const radius = step * 1.6;
      /*
       * ROUNDED BEFORE THE TEST, NOT AFTER IT.
       *
       * The position that gets drawn is the rounded one, so the position that
       * gets CHECKED has to be the rounded one too. Testing the exact spiral
       * point and then snapping it to whole units afterwards moves every word
       * by up to half a unit in each direction — enough for a pair that just
       * cleared to end up printed on top of each other, in a layout whose one
       * promise is that they never are.
       */
      candidate.x = Math.round(options.width / 2 + Math.cos(angle) * radius);
      candidate.y = Math.round(options.height / 2 + Math.sin(angle) * radius * 0.62);
      const insideX =
        candidate.x - candidate.width / 2 >= 0 && candidate.x + candidate.width / 2 <= options.width;
      const insideY =
        candidate.y - candidate.height / 2 >= 0
        && candidate.y + candidate.height / 2 <= options.height;
      if (!insideX || !insideY) continue;
      if (placed.some((other) => overlaps(candidate, other))) continue;
      settled = true;
      break;
    }
    if (settled) {
      placed.push({ ...candidate });
    } else {
      omitted.push({ label: theme.label, count: theme.count });
    }
  }

  return { placed, omitted };
}

/** What the accessible fallback says, in order, whatever the visual did. */
export function themeCloudAlternative(layout: ThemeCloudLayout): string[] {
  return layout.ordered.map(
    (theme) => `${theme.label}: ${theme.count} ${theme.count === 1 ? "mención" : "menciones"}`,
  );
}
