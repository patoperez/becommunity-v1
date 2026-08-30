/**
 * SEMÁFORO — the model behind "verde, amarillo, rojo", and the reason it is a
 * model rather than three colours.
 *
 * WHAT WAS THERE BEFORE. The composer registered a `traffic_light` variant,
 * and a block that chose it printed its number under a chip saying
 * *"Falta configurar el rango"* — because a `comparison` carried a single
 * `target` and nothing said what a value on either side of it MEANT. There was
 * no way to say "65 to 79 is amarillo, and amarillo means the chapter is
 * holding but not growing". A semáforo with no agreed bands is not a semáforo;
 * it is a number with a coloured border, and colouring one arbitrarily is how a
 * consultant publishes a judgement nobody made.
 *
 * THE RULE THIS FILE EXISTS TO KEEP: **the product never invents a
 * classification.** Thresholds come from a person, or the block says it is not
 * configured and offers the controls to configure it. Percentiles of the
 * study's own distribution are explicitly NOT a source — "the worst third of
 * this chapter" is a different statement from "below the standard", and
 * deriving one from the other silently would put a verdict on a client's screen
 * that nobody agreed to.
 *
 * TWO SOURCES, BOTH EXPLICIT.
 *
 *   `numeric`   ordered, non-overlapping ranges over a declared scale, with
 *               inclusive/exclusive bounds stated per edge so 80 belongs to
 *               exactly one band and everybody can see which.
 *   `category`  a documented categorical field mapped straight to bands, with
 *               no arithmetic at all. When a study already records "Verde",
 *               that is the answer, and deriving it again from a number would
 *               be a second, competing truth.
 *
 * COLOUR IS NEVER THE ONLY SIGNAL. Every band carries a shape and a
 * plain-language meaning as well as a colour role, and the renderer prints all
 * three. That is an accessibility floor, and it is also what makes a printed
 * report and a black-and-white photocopy still say something.
 *
 * NOTHING HERE READS DATA. It maps a value to a band. What produced the value
 * is the canonical calculation layer, untouched.
 */

/** Brand roles, never hex authored by an operator. Same closed-set rule as the theme. */
export const BAND_COLOR_ROLES = [
  "positive",
  "caution",
  "danger",
  "evidence",
  "neutral",
] as const;
export type BandColorRole = (typeof BAND_COLOR_ROLES)[number];

/**
 * The non-colour signal. A shape a reader can name, so "the red one" is never
 * the only way to say which band a result is in.
 */
export const BAND_SHAPES = ["circle", "triangle", "square", "diamond", "bar"] as const;
export type BandShape = (typeof BAND_SHAPES)[number];

export const BAND_SOURCES = ["numeric", "category"] as const;
export type BandSource = (typeof BAND_SOURCES)[number];

export type BandBound = {
  /** The value at the edge. Null means "open" — no lower or no upper limit. */
  value: number | null;
  /** Whether the edge value itself belongs to this band. */
  inclusive: boolean;
};

export type Band = {
  id: string;
  label: string;
  colorRole: BandColorRole;
  shape: BandShape;
  /** What being in this band MEANS, in the words a consultant would say. */
  meaning: string;
  /** Numeric bands only. Both open is a band that catches everything. */
  lower: BandBound;
  upper: BandBound;
  /** Categorical bands only: the exact recorded values that land here. */
  values: readonly string[];
};

export type BandScheme = {
  id: string;
  title: string;
  description: string | null;
  source: BandSource;
  /** The scale the numeric bands are read against. Null for a categorical scheme. */
  scale: { minimum: number; maximum: number } | null;
  bands: readonly Band[];
  /** What to say when there is no value at all. Never a band, never a colour. */
  noDataLabel: string;
};

export type BandVerdict =
  | { kind: "band"; band: Band; index: number }
  | { kind: "no_data" }
  /** A value the scheme does not classify. Reported, never rounded into a band. */
  | { kind: "unclassified"; detail: string };

/** Whether a numeric value falls inside one band's bounds. */
function withinBounds(value: number, band: Band): boolean {
  const { lower, upper } = band;
  if (lower.value !== null) {
    if (lower.inclusive ? value < lower.value : value <= lower.value) return false;
  }
  if (upper.value !== null) {
    if (upper.inclusive ? value > upper.value : value >= upper.value) return false;
  }
  return true;
}

/**
 * Which band a value is in.
 *
 * A value no band claims comes back as `unclassified` with the reason. It is
 * NOT pushed into the nearest band: a scheme with a gap in it is a scheme
 * somebody has to finish, and the screen saying so is how they find out.
 */
export function classify(
  scheme: BandScheme,
  value: number | string | null | undefined,
): BandVerdict {
  if (value === null || value === undefined || value === "") return { kind: "no_data" };

  if (scheme.source === "category") {
    const text = String(value);
    const index = scheme.bands.findIndex((band) => band.values.includes(text));
    if (index < 0) {
      return { kind: "unclassified", detail: `“${text}” no está en ninguna banda de este semáforo.` };
    }
    return { kind: "band", band: scheme.bands[index], index };
  }

  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric)) {
    return { kind: "unclassified", detail: "El valor no es un número que este semáforo pueda leer." };
  }
  const index = scheme.bands.findIndex((band) => withinBounds(numeric, band));
  if (index < 0) {
    return { kind: "unclassified", detail: `${numeric} queda fuera de todas las bandas configuradas.` };
  }
  return { kind: "band", band: scheme.bands[index], index };
}

/**
 * WHY A SCHEME IS NOT READY, in the words the builder prints.
 *
 * Empty when it is. Every one of these is a state a person passes through
 * while building a scheme, so they are said next to the controls rather than
 * used to block a save.
 */
export function schemeProblems(scheme: BandScheme): string[] {
  const problems: string[] = [];
  if (scheme.bands.length < 2) {
    problems.push("Un semáforo necesita al menos dos bandas para distinguir algo.");
  }
  for (const band of scheme.bands) {
    if (band.label.trim() === "") problems.push("Una banda no tiene nombre visible.");
    if (band.meaning.trim() === "") {
      problems.push(`“${band.label || "Una banda"}” no dice qué significa estar en ella.`);
    }
  }

  if (scheme.source === "category") {
    const seen = new Map<string, string>();
    for (const band of scheme.bands) {
      if (band.values.length === 0) {
        problems.push(`“${band.label}” no tiene ningún valor asignado.`);
      }
      for (const value of band.values) {
        const already = seen.get(value);
        if (already) {
          problems.push(`“${value}” está en “${already}” y en “${band.label}”: elige una.`);
        }
        seen.set(value, band.label);
      }
    }
    return problems;
  }

  if (!scheme.scale) {
    problems.push("Falta decir sobre qué escala se leen las bandas.");
  }

  /*
   * OVERLAP AND GAPS, CHECKED AT THE EDGES.
   *
   * Two bands that both claim 80 make the colour depend on the order they
   * happen to be written in. A gap between 79 and 80 makes a real answer
   * unclassifiable. Both are reported by the exact value that breaks, because
   * "the bands overlap" is not something somebody can act on.
   */
  const ordered = [...scheme.bands];
  for (let index = 0; index + 1 < ordered.length; index += 1) {
    const current = ordered[index];
    const next = ordered[index + 1];
    if (current.upper.value === null || next.lower.value === null) continue;
    if (current.upper.value > next.lower.value) {
      problems.push(`“${current.label}” y “${next.label}” se enciman alrededor de ${next.lower.value}.`);
      continue;
    }
    if (current.upper.value < next.lower.value) {
      problems.push(
        `Entre ${current.upper.value} y ${next.lower.value} no hay ninguna banda: un resultado ahí no tendría color.`,
      );
      continue;
    }
    if (current.upper.inclusive && next.lower.inclusive) {
      problems.push(`${next.lower.value} pertenece a “${current.label}” y a “${next.label}” a la vez.`);
    }
    if (!current.upper.inclusive && !next.lower.inclusive) {
      problems.push(`${next.lower.value} no pertenece a ninguna banda.`);
    }
  }
  return problems;
}

/** Whether a scheme can colour anything at all. */
export function schemeIsUsable(scheme: BandScheme): boolean {
  return schemeProblems(scheme).length === 0;
}

/** One band's bounds, written the way a person reads them. */
export function bandRangeText(scheme: BandScheme, band: Band): string {
  if (scheme.source === "category") return band.values.join(", ");
  const { lower, upper } = band;
  if (lower.value === null && upper.value === null) return "cualquier valor";
  if (lower.value === null) return `${upper.inclusive ? "hasta" : "menos de"} ${upper.value}`;
  if (upper.value === null) return `${lower.inclusive ? "desde" : "más de"} ${lower.value}`;
  return `${lower.value}${lower.inclusive ? "" : " (exclusivo)"} a ${upper.value}${upper.inclusive ? "" : " (exclusivo)"}`;
}

/**
 * The accessible sentence for one verdict — the text a screen reader reads and
 * the text a black-and-white print carries. Colour is never in it, because
 * colour is never the signal.
 */
export function verdictText(scheme: BandScheme, verdict: BandVerdict): string {
  if (verdict.kind === "no_data") return scheme.noDataLabel;
  if (verdict.kind === "unclassified") return verdict.detail;
  return `${verdict.band.label}: ${verdict.band.meaning}`;
}
