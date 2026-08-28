/**
 * How the category review speaks.
 *
 * THE RULE THIS FILE ENFORCES. A consultant reviewing categories is a
 * researcher, not an engineer. Nothing on that screen may require knowing what
 * a fold, a normalisation rule, a canonical key, a signature, a jaccard
 * coefficient or a Levenshtein distance is. Every one of those exists in the
 * code; none of them reaches a sentence.
 *
 * Kept in one module rather than scattered through JSX so the vocabulary can be
 * reviewed as prose, and so a gate can assert that the raw rule names never
 * reach a rendered string.
 */

import type { CandidateWarning } from "./candidates";
import type { NormalizationRule } from "./normalize";
import type { SuggestionSource } from "./decisions";

/** Why the product put two answers side by side. */
export const RULE_REASON: Record<NormalizationRule, string> = {
  unicode:
    "Se ven exactamente iguales en pantalla, pero llevan caracteres invisibles distintos " +
    "(un espacio especial o una marca sin ancho).",
  case_whitespace: "Solo se diferencian en mayúsculas o espacios.",
  accent: "Solo se diferencian en los acentos.",
  punctuation: "Solo se diferencian en la puntuación o los símbolos.",
  fuzzy: "Están redactadas de forma parecida y podrían significar lo mismo.",
};

/** A short badge, for the card header. */
export const RULE_BADGE: Record<NormalizationRule, string> = {
  unicode: "Caracteres invisibles",
  case_whitespace: "Mayúsculas o espacios",
  accent: "Acentos",
  punctuation: "Puntuación",
  fuzzy: "Redacción parecida",
};

/** How sure the product is, said without a number. */
export const STRENGTH_NOTE: Record<"equivalent" | "strong" | "weak", string> = {
  equivalent:
    "Es una diferencia de escritura, no de significado: es casi seguro que son la misma respuesta.",
  strong:
    "Es una diferencia de escritura, pero podría cambiar el significado. Compruébalo antes de agrupar.",
  weak:
    "Es solo un parecido de redacción. El producto no puede saber si significan lo mismo; " +
    "solo alguien que conozca los cuestionarios puede decidirlo.",
};

/** Where the proposal came from, said honestly. */
export const SOURCE_LABEL: Record<SuggestionSource, string> = {
  deterministic: "Detectado por diferencias de escritura",
  fuzzy: "Detectado por parecido de redacción",
  ai: "Sugerido por el asistente",
  template_memory: "Decidido antes en una plantilla de este cliente",
  tenant_memory: "Decidido antes en otro estudio de este cliente",
  manual: "Elegido a mano",
};

/** Things worth saying out loud beside a proposal. */
export const WARNING_TEXT: Record<CandidateWarning, string> = {
  numeric_values:
    "Contienen números. Dos posiciones de una misma escala se escriben parecido y NO son la " +
    "misma respuesta.",
  single_respondent:
    "Cada una la respondió una sola persona, así que agruparlas cambia muy poco.",
  long_values:
    "Son textos largos. Puede que esta columna sea una respuesta abierta y no una categoría.",
  many_members: "Son más de tres respuestas a la vez. Revísalas una por una antes de agrupar.",
  ordinal_neighbours:
    "Los números que contienen no son los mismos. Suele indicar dos tramos contiguos de una " +
    "escala, no una repetición.",
};

/** What the advisor said, in the product's own words. */
export const ADVISOR_DECISION: Record<string, string> = {
  probable_merge: "Cree que sí son la misma respuesta",
  probable_separate: "Cree que NO son la misma respuesta",
  uncertain: "No está seguro",
};

export const ADVISOR_CONFIDENCE: Record<string, string> = {
  low: "poca seguridad",
  medium: "seguridad media",
  high: "mucha seguridad",
};

export const ADVISOR_RISK: Record<string, string> = {
  low: "riesgo bajo si se equivoca",
  medium: "riesgo medio si se equivoca",
  high: "riesgo alto si se equivoca",
};

/** The decision as it reads on a card that already carries one. */
export const DECISION_LABEL: Record<string, string> = {
  grouped: "Agrupadas",
  separate: "Se dejan separadas",
  postponed: "Pendiente",
  revoked: "Sin decidir",
};

export const DECISION_TONE: Record<string, "positive" | "neutral" | "caution"> = {
  grouped: "positive",
  separate: "neutral",
  postponed: "caution",
  revoked: "neutral",
};

/** "3 personas" / "1 persona". */
export function people(count: number): string {
  return count === 1 ? "1 persona" : `${count} personas`;
}

/** "3 respuestas" / "1 respuesta". */
export function answers(count: number): string {
  return count === 1 ? "1 respuesta" : `${count} respuestas`;
}

/**
 * The sentence a card leads with: what would change, before anything changes.
 *
 * It always states the invariant — the number of people does not change — since
 * that is the fear a consultant brings to this screen and the one thing the
 * product can promise absolutely.
 */
export function groupingConsequence(input: {
  members: number;
  affected: number;
  moved: number;
  label: string;
  categoriesBefore: number;
  categoriesAfter: number;
}): string {
  return (
    `${answers(input.members)} pasarán a contarse como “${input.label}”. ` +
    `Afecta a ${people(input.affected)}, de las cuales ${people(input.moved)} ` +
    `dejan de aparecer bajo la etiqueta que respondieron. ` +
    `La característica pasa de ${input.categoriesBefore} a ${input.categoriesAfter} categorías. ` +
    "El total de personas que respondieron no cambia, y los datos originales no se tocan."
  );
}

/** What keeping them apart does — and does not — do. */
export function separateConsequence(members: number): string {
  return (
    `Las ${members} respuestas siguen contándose por separado y no se volverá a proponer ` +
    "agruparlas en este estudio. La decisión queda registrada con tu nombre y se puede deshacer."
  );
}

/** What undoing does. */
export function undoConsequence(label: string | null): string {
  return label
    ? `Las respuestas dejarán de contarse como “${label}” y volverán a contarse por separado. ` +
        "La decisión anterior no se borra: queda en el historial junto a esta."
    : "La decisión anterior se deshace. No se borra: queda en el historial junto a esta.";
}
