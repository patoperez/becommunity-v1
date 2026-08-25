/**
 * Choosing and merging qualitative themes (P8.2, contract C1).
 *
 * WHAT DOES NOT CHANGE. The stored value is still `qual_observation
 * .confirmed_theme`, still normalised by the same `normalizeTheme`, still
 * written by the same `review_qual_observations` RPC in the same atomic call,
 * and a quote is still approved separately from a theme. Nothing here decides
 * what a client sees.
 *
 * WHAT CHANGES. The free-text box is gone. It was the single most expensive
 * control in the product: typing "Comunicación" one day and "comunicacion
 * interna" the next produced two themes that mean the same thing, and nothing
 * on screen showed that a third had just been created. Merging is now a
 * selection over the themes this study already carries, and creating a genuinely
 * new one is a separate, deliberate, labelled act that refuses a name which
 * would collide with an existing theme instead of silently resolving it.
 *
 * Every function is pure so the anti-duplication rule can be proved without a
 * database.
 */

import { normalizeTheme } from "@/lib/qualitative/suggest";

/** One theme this study already carries, with how it is currently used. */
export type ThemeOption = {
  /** The stored key. Chosen, never typed. */
  key: string;
  /** How it reads on screen. */
  label: string;
  /** Observations already CONFIRMED under it — the client-visible ones. */
  confirmed: number;
  /** Observations that merely carry it as a source or machine suggestion. */
  proposed: number;
};

/** The three places a theme name can already exist on an observation. */
export type ThemeBearingRow = {
  theme?: string | null;
  suggested_theme?: string | null;
  confirmed_theme?: string | null;
  review_status?: string | null;
};

/** How a stored theme key reads to a person: `atencion_y_servicio` -> `Atención y servicio`. */
export function themeLabel(key: string): string {
  const words = key.replace(/[_-]+/g, " ").trim();
  if (!words) return key;
  return words.charAt(0).toLocaleUpperCase("es-MX") + words.slice(1);
}

/**
 * Every theme this study already carries, ordered by how established it is:
 * confirmed themes first (they are what a client would see), then proposals,
 * then alphabetically so the list does not reshuffle between reviews.
 */
export function themeOptions(rows: ThemeBearingRow[]): ThemeOption[] {
  const byKey = new Map<string, ThemeOption>();
  const touch = (raw: string | null | undefined, kind: "confirmed" | "proposed") => {
    const key = normalizeTheme(String(raw ?? ""));
    if (!key) return;
    const option = byKey.get(key) ?? { key, label: themeLabel(key), confirmed: 0, proposed: 0 };
    option[kind] += 1;
    byKey.set(key, option);
  };
  for (const row of rows) {
    if (row.review_status === "confirmed") touch(row.confirmed_theme, "confirmed");
    else touch(row.confirmed_theme, "proposed");
    touch(row.suggested_theme, "proposed");
    touch(row.theme, "proposed");
  }
  return [...byKey.values()].sort(
    (a, b) =>
      Number(b.confirmed > 0) - Number(a.confirmed > 0) ||
      b.confirmed - a.confirmed ||
      a.label.localeCompare(b.label, "es-MX"),
  );
}

/**
 * The stored key for a name a person wrote, or null when the name cannot become
 * one. Deliberately the SAME normalisation the server applies, so what the
 * operator is shown is exactly what will be stored.
 */
export function themeKeyFromLabel(label: string): string | null {
  const key = normalizeTheme(label);
  if (!key || !/^[a-z]/.test(key)) return null;
  return key;
}

/**
 * Why a new theme name was refused.
 *
 * A collision is REPORTED, never resolved: quietly folding "Comunicación
 * interna" into an existing `comunicacion_interna` would be right by accident,
 * and quietly creating a second one would be the bug this control exists to
 * remove. The operator is told which existing theme it matches and asked to
 * select it.
 */
export function newThemeRefusal(label: string, existing: ThemeOption[]): string | null {
  const trimmed = label.trim();
  if (trimmed === "") return "Escribe cómo se va a llamar el tema.";
  const key = themeKeyFromLabel(trimmed);
  if (!key) {
    return "El nombre debe empezar con una letra y contener al menos una letra o un número.";
  }
  const collision = existing.find((option) => option.key === key);
  if (collision) {
    return `“${collision.label}” ya existe en este estudio. Selecciónalo en la lista para unir estas observaciones a ese tema.`;
  }
  return null;
}

/**
 * What the chosen action will do, stated before it is done.
 *
 * The count of already-confirmed observations is what makes a merge legible: a
 * consultant needs to know she is joining five comments to twelve, not creating
 * a thirteenth theme.
 */
export function mergeConsequence(
  selected: number,
  target: { key: string; label: string; confirmed: number } | null,
  isNew: boolean,
): string {
  if (selected === 0) return "Marca las observaciones sobre las que quieres actuar.";
  const observations = selected === 1 ? "1 observación" : `${selected} observaciones`;
  if (!target) return `Elige el tema con el que se confirmarán ${observations}.`;
  if (isNew) {
    return `Se creará el tema “${target.label}” y ${observations} quedarán confirmadas bajo él. Es un tema nuevo en este estudio.`;
  }
  if (target.confirmed === 0) {
    return `${observations} quedarán confirmadas bajo “${target.label}”, que todavía no tiene ninguna observación confirmada.`;
  }
  const already = target.confirmed === 1
    ? "a la que ya estaba confirmada"
    : `a las ${target.confirmed} ya confirmadas`;
  return `${observations} se unirán ${already} bajo “${target.label}”.`;
}

/** What confirming the machine's own proposal will do. */
export function acceptConsequence(selected: number): string {
  if (selected === 0) return "Marca las observaciones sobre las que quieres actuar.";
  const observations = selected === 1 ? "1 observación" : `${selected} observaciones`;
  return `${observations} quedarán confirmadas con el tema que la primera pasada propuso para cada una. Las citas solo se publican si las marcas por separado.`;
}

/** What discarding will do — and what it does not do. */
export function rejectConsequence(selected: number): string {
  if (selected === 0) return "Marca las observaciones sobre las que quieres actuar.";
  const observations = selected === 1 ? "1 observación" : `${selected} observaciones`;
  return `${observations} quedarán descartadas: no se publican y dejan de contar como pendientes. El texto original se conserva y se pueden volver a revisar.`;
}
