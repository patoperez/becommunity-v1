/**
 * Source value semantics.
 *
 * THE RULE THIS FILE EXISTS FOR: absence is not zero.
 *
 * A member with no numeric month is not a member who performed at 0. "Sin
 * información" is not a satisfaction of nought. "No participó" is not an
 * answer at all. Every one of those becomes a plausible, wrong number the
 * moment something calls `Number(raw) || 0`, and a wrong number does not
 * throw — it is presented to a client as a finding about their organisation.
 *
 * So every source cell is classified into exactly one state before anything
 * downstream may read it, and only `answered` ever carries a value. The states
 * are the same vocabulary the migrations enforce in the database, so a value
 * that survives this function can be stored without translation.
 */

export const ABSENCE_STATES = [
  "missing",
  "unknown",
  "not_applicable",
  "source_unavailable",
  "not_participated",
] as const;

export type AbsenceState = (typeof ABSENCE_STATES)[number];
export type SourceValueStatus = "answered" | AbsenceState;

export type ClassifiedValue = {
  status: SourceValueStatus;
  /** The raw source text, unchanged. Internal only — never reaches the DTO. */
  raw: string;
  /** A finite number ONLY when the status is `answered`. Never a filled-in 0. */
  numeric: number | null;
};

/**
 * Whitespace-, case- and accent-insensitive comparison form.
 *
 * Used to RECOGNISE a token, never to replace the source value: the raw text
 * is carried alongside so a later unit can store `source_raw_value` exactly as
 * the workbook spelled it.
 */
export function normalizeToken(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLocaleLowerCase("es-MX");
}

/**
 * Case- and accent-insensitive form of a NAME, used only to report a near
 * miss. It never binds a sheet or an identity: two names that differ only in
 * accent are different names until a human says otherwise.
 */
export function normalizeLoose(value: string): string {
  return normalizeWhitespace(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("es-MX");
}

/** Whitespace-only normalisation, for names that must otherwise match exactly. */
export function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

/**
 * The absence vocabulary the approved Cuicuilco mapping states verbatim.
 *
 * This table is deliberately SHORT. Every entry is a phrase the mapping
 * workbook or the physical specification names; nothing was inferred from what
 * a value looks like. A phrase this table does not know stays `answered` and
 * is preserved as text — which a human can then review — rather than being
 * guessed into an absence that quietly removes a real response.
 */
const ABSENCE_TOKENS: ReadonlyMap<string, AbsenceState> = new Map<string, AbsenceState>([
  ["", "missing"],
  ["na", "source_unavailable"],
  ["n/a", "source_unavailable"],
  ["n.a.", "source_unavailable"],
  ["sin dato", "source_unavailable"],
  ["sin datos", "source_unavailable"],
  ["sin informacion", "source_unavailable"],
  ["no participo", "not_participated"],
  ["no aplica", "not_applicable"],
]);

/**
 * A spreadsheet ERROR is not a value either.
 *
 * `#N/A`, `#¡DIV/0!` and friends reach the reader as the cell's stored text.
 * They are recorded as `source_unavailable` — the source failed to produce a
 * value — and the preflight raises them separately so a human sees that the
 * workbook itself is broken at that cell rather than merely empty.
 */
const ERROR_TOKEN = /^#[^\s]*$/;

export function isSpreadsheetError(raw: string): boolean {
  return ERROR_TOKEN.test(raw.trim());
}

/**
 * Strict numeric reading.
 *
 * Deliberately narrow. A cell that reads "4 de 5", "aprox. 80" or "80%" is NOT
 * a number here; it stays text so a human decides. Excel numeric cells arrive
 * from the reader as plain decimals, so the only concession is a single comma
 * used as a decimal separator, which is how a Spanish-locale TEXT cell spells
 * one. A comma is never treated as a thousands separator, because "1,500"
 * would then silently become one thousand five hundred instead of one and a
 * half.
 */
export function readNumeric(raw: string): number | null {
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  const candidate = /^-?\d+,\d+$/.test(trimmed) ? trimmed.replace(",", ".") : trimmed;
  if (!/^-?\d+(\.\d+)?$/.test(candidate)) return null;
  const value = Number(candidate);
  return Number.isFinite(value) ? value : null;
}

/**
 * Classify one source cell.
 *
 * `extraTokens` carries CONTEXT that only holds for one column — the deserter
 * profile's "Respuesta" column, where a bare "No" means the person did not
 * take the survey, while a bare "No" anywhere else is an ordinary answer.
 * Column context belongs in configuration, not in a global table, which is why
 * it is a parameter rather than another row above.
 */
export function classifySourceValue(
  raw: string,
  extraTokens?: ReadonlyMap<string, AbsenceState>,
): ClassifiedValue {
  const token = normalizeToken(raw);
  const contextual = extraTokens?.get(token);
  if (contextual) return { status: contextual, raw, numeric: null };
  const known = ABSENCE_TOKENS.get(token);
  if (known) return { status: known, raw, numeric: null };
  if (isSpreadsheetError(raw)) return { status: "source_unavailable", raw, numeric: null };
  // "0" reaches here and stays `answered` with numeric 0. A real zero is a
  // real answer; only absence is refused a number.
  return { status: "answered", raw, numeric: readNumeric(raw) };
}

/** True when the cell carries something a person or a formula actually put there. */
export function isPopulated(raw: string): boolean {
  return raw.trim() !== "";
}
