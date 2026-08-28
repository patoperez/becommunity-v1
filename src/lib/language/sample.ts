/**
 * The one sample-context vocabulary (P8 contract C4).
 *
 * Before P8 the same idea was phrased five different ways across the product,
 * and every one of them exposed `n=` to a school director: `Base pequeña
 * (n=23)`, `20 de 20 unidades de respuesta`, `n=12`, `Muestra insuficiente`,
 * `Base distinta n=12`.
 *
 * Here it is said once, in ordinary Spanish, in the same voice as the result it
 * accompanies. The exact count and the rule behind it are never deleted — they
 * move into the methodology disclosure, which is where the audit's §5.2
 * "reveal at" column puts them.
 *
 * This module contains STRINGS ONLY. The disclosure thresholds themselves live
 * in `src/lib/calc/disclosure.ts` and are unchanged.
 */

import type { SampleVisibility } from "@/lib/calc/disclosure";
import { DEFAULT_SAMPLE_SIZE_POLICY } from "@/lib/calc/disclosure";

/**
 * What is being counted. The product counts two different things and has always
 * conflated them behind the word "unidades":
 *  - `people`   — respondents behind a numeric result;
 *  - `voices`   — people *and* separate comments behind a mixed result.
 */
export type SampleUnit = "people" | "voices";

export type SampleTone = "standard" | "caution" | "suppressed" | "no-data";

export type SampleContextCopy = {
  tone: SampleTone;
  /** The always-visible sentence. Never contains `n=`. */
  headline: string;
  /** One more sentence, shown wherever there is room for it. */
  detail: string | null;
  /** The precise statement, for the "cómo se midió" disclosure only. */
  methodology: string;
};

const { minimum, cautionBelow } = DEFAULT_SAMPLE_SIZE_POLICY;

function noun(count: number, unit: SampleUnit): string {
  if (unit === "voices") {
    return count === 1 ? "1 persona o comentario" : `${count} personas y comentarios`;
  }
  return count === 1 ? "1 persona" : `${count} personas`;
}

/**
 * The canonical phrasing for one sample. `count` is null exactly when the
 * product is not allowed to reveal it (a suppressed selection never serializes
 * its own n — see `src/lib/dashboard/view.ts`).
 */
export function sampleCopy(
  visibility: SampleVisibility,
  count: number | null,
  unit: SampleUnit = "people",
): SampleContextCopy {
  if (visibility === "no-data") {
    return {
      tone: "no-data",
      headline: "Todavía nadie respondió esta parte",
      detail: "Cuando lleguen respuestas, el resultado aparecerá aquí.",
      methodology: "Sin respuestas registradas para esta selección.",
    };
  }

  if (visibility === "suppressed") {
    return {
      tone: "suppressed",
      headline: "Muy pocas respuestas para mostrarlo sin identificar a nadie",
      detail:
        "Ocultamos los resultados cuando hay tan poca gente detrás que alguien podría reconocerse. Amplía la selección para verlo.",
      methodology:
        `Regla de divulgación: se ocultan los resultados con menos de ${minimum} respuestas distintas. ` +
        "El número exacto no se publica, precisamente porque es pequeño.",
    };
  }

  const amount = count == null ? null : noun(count, unit);

  if (visibility === "caution") {
    return {
      tone: "caution",
      headline: amount
        ? `Pocas respuestas: ${amount}`
        : "Pocas respuestas",
      detail: "Tómalo como un indicio de por dónde mirar, no como una conclusión.",
      methodology:
        `Base de entre ${minimum} y ${cautionBelow - 1} respuestas distintas` +
        (count == null ? "." : ` (n = ${count}).`),
    };
  }

  return {
    tone: "standard",
    headline: amount ? `${amount} respondieron` : "Base suficiente para leerlo",
    detail: null,
    methodology:
      `Base de ${cautionBelow} respuestas distintas o más` +
      (count == null ? "." : ` (n = ${count}).`),
  };
}

/**
 * The one sentence that describes the base a whole study rests on, used at the
 * top of a study before any individual result.
 */
export function studyBaseSentence(
  visibility: SampleVisibility,
  count: number | null,
  /**
   * What the base is described AS. Pass `people` when the client is not being
   * shown any qualitative content: naming comments the reader cannot see would
   * advertise something Be Community chose not to publish. The COUNT is
   * unchanged either way — only the noun differs.
   */
  unit: SampleUnit = "voices",
): string {
  const copy = sampleCopy(visibility, count, unit);
  if (count != null && (copy.tone === "standard" || copy.tone === "caution")) {
    const base = `Este estudio recoge la voz de ${noun(count, unit)}`;
    // WHAT THE NUMBER COUNTS, said in the same breath as the number.
    //
    // It is the people who left at least one recorded answer — not everyone on
    // the list a study was drawn from. The real Cuicuilco study imported 60
    // people and this sentence says 54, because six of them answered nothing at
    // all. Both numbers are correct; only one of them is a base for a result,
    // and a reader who is not told which is looking at will assume the other.
    const counted = " Se cuenta a quien dejó al menos una respuesta.";
    return copy.tone === "caution"
      ? `${base} — todavía pocas, así que léelo como un indicio.${counted}`
      : `${base}.${counted}`;
  }
  return copy.headline + ".";
}

/**
 * How a filtered selection is described relative to the whole study. Used where
 * the reader has narrowed the view and needs to know what they are now looking
 * at — without the word "unidades".
 */
export function selectionSentence(
  selected: number | null,
  source: number | null,
): string | null {
  if (selected == null || source == null) return null;
  if (selected === source) return `Estás viendo a todas las personas del estudio (${source}).`;
  return `Estás viendo ${selected} de ${source} personas y comentarios del estudio.`;
}
