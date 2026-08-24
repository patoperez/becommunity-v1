/**
 * Client-facing vocabulary for results, characteristics and study state.
 *
 * The calculation layer keeps its canonical keys — nothing here renames a
 * metric key, a segment key or a status value at the source. This module is the
 * PRESENTATION boundary the audit's §5.2 vocabulary table asks for: the server
 * contract stays exactly as it is, and the person reading the screen stops
 * seeing `csat:sat_servicio`, `NPS`, `Cruce por area` or `published`.
 *
 * Rule: every entry says what the thing is in the consultant's own words. Where
 * the acronym is genuinely useful it appears in the methodology line, never in
 * the headline.
 */

/** Turn any stored key into readable words: `atencion_y_servicio` -> `Atencion y servicio`. */
export function humanize(key: string): string {
  const words = key.replace(/^(q|seg|qual)_/, "").replace(/[_:-]+/g, " ").trim();
  if (!words) return key;
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * The SUBJECT of a result, with the measurement prefix removed. `sat_general`
 * belongs under the heading "Satisfacción", so repeating "Sat" inside the name
 * reads as "Satisfacción · Sat general". Only the measurement prefix is
 * stripped — never a theme or a segment key, which keep their own words.
 */
function subject(key: string): string {
  return humanize(key.replace(/^(csat|sat|nps)[_-]/, ""));
}

export type ResultLanguage = {
  /** What this result is called on screen. Never an acronym on its own. */
  name: string;
  /** The question the result answers, in words a person would say out loud. */
  question: string;
  /** How it is calculated, for the "cómo se calcula" disclosure. */
  method: string;
};

/**
 * `respondents`, `nps`, `csat:<key>` and `average:<key>` are the four families
 * `src/lib/dashboard/view.ts` produces. Anything else falls through to a
 * humanised label rather than to a raw key.
 */
export function resultLanguage(key: string, fallbackTitle: string): ResultLanguage {
  if (key === "respondents") {
    return {
      name: "Personas que respondieron",
      question: "¿Cuánta gente está detrás de estos resultados?",
      method:
        "Cuenta de personas distintas con al menos una respuesta numérica en la selección actual.",
    };
  }

  if (key === "nps" || key.startsWith("nps")) {
    return {
      name: "Recomendación",
      question: "¿Qué tanto recomendarían esta experiencia?",
      method:
        "Se pregunta del 0 al 10. Se resta el porcentaje de quienes responden 0-6 " +
        "al porcentaje de quienes responden 9-10. El resultado va de -100 a 100. " +
        "Su nombre técnico es NPS (Net Promoter Score).",
    };
  }

  if (key.startsWith("csat:")) {
    const about = subject(key.slice("csat:".length));
    return {
      name: `Satisfacción · ${about}`,
      question: `¿Qué tan satisfechas están las personas con ${about.toLowerCase()}?`,
      method:
        "Porcentaje de personas que eligieron una de las dos calificaciones más altas de la escala. " +
        'Quienes respondieron "no lo conozco" no cuentan. Su nombre técnico es Top-2-Box.',
    };
  }

  if (key.startsWith("average:")) {
    const about = subject(key.slice("average:".length));
    return {
      name: about,
      question: `¿Cómo se calificó ${about.toLowerCase()}?`,
      method: "Promedio simple de las calificaciones registradas en la selección actual.",
    };
  }

  const name = fallbackTitle.trim() || humanize(key);
  return {
    name,
    question: `¿Cómo salió ${name.toLowerCase()}?`,
    method: "Resultado calculado sobre las respuestas de la selección actual.",
  };
}

/**
 * How a result's unit reads under its number.
 *
 * `score` deliberately does NOT claim a range. The scale a study uses is the
 * client's own instrument — it may be 1-5, 1-10 or something else — and the
 * aggregate the browser receives does not carry it. Inventing "de 1 a 5" here
 * would put a wrong denominator under a right number.
 */
export function unitLabel(unit: "nps" | "percent" | "score"): string {
  if (unit === "nps") return "recomendación";
  if (unit === "percent") return "por ciento";
  return "promedio de las calificaciones";
}

/** A characteristic (`area`, `antiguedad`) as the client sees it. */
export function characteristicLabel(key: string): string {
  return humanize(key);
}

/** The question a comparison answers, instead of the word "cruce" or "pivote". */
export function comparisonQuestion(key: string): string {
  return `¿Cambia según ${characteristicLabel(key).toLowerCase()}?`;
}

/**
 * A study's lifecycle state. `draft | published | archived` is a raw enum; the
 * client only ever perceives "Publicado", and the internal team gets readable
 * words instead of the stored value.
 */
export function studyStateLabel(status: string): string {
  if (status === "published") return "Publicado";
  if (status === "draft") return "Borrador";
  if (status === "archived") return "Archivado";
  return "En preparación";
}

/**
 * How a change between periods reads. Movement is descriptive, never a verdict:
 * the product does not decide that "up" is good without the consultant.
 */
export function movementLabel(
  movement: "up" | "down" | "flat" | "unavailable",
  delta: string | null,
): string {
  if (movement === "unavailable" || !delta) return "Sin medición anterior comparable";
  if (movement === "flat") return `Sin cambio respecto a la medición anterior (${delta})`;
  if (movement === "up") return `Subió ${delta} respecto a la medición anterior`;
  return `Bajó ${delta.replace("-", "")} respecto a la medición anterior`;
}
