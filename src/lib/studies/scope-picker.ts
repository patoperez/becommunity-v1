/**
 * The no-code access-scope model (P8.2, contract C1).
 *
 * WHAT DOES NOT CHANGE. The stored value is still exactly `DataScope` —
 * `Record<string, string[]>`, empty object meaning full tenant access,
 * dimensions combining with AND and values within a dimension with OR — and it
 * is still parsed by `parseDataScope` and enforced by `applyDataScope` inside
 * `loadAuthorizedStudyData`. Nothing here is an authorization boundary.
 *
 * WHAT CHANGES. Studio no longer asks a person to author that object. This
 * module turns it into a selection over characteristics that genuinely exist in
 * the client's data, and back again, plus the plain-language sentence that
 * states what the person will actually be able to see.
 *
 * Every function here is pure so the behaviour can be proved without a browser.
 */

import type { DataScope } from "./scope";

/** One value of one characteristic, with how many people currently carry it. */
export type ScopeValueOption = {
  value: string;
  label: string;
  units: number;
};

/** One characteristic ("Nivel", "Campus") offered by the client's own data. */
export type ScopeDimensionOption = {
  key: string;
  label: string;
  values: ScopeValueOption[];
  /** True when the client carries more values than the picker will show. */
  truncated?: boolean;
};

/**
 * What one client's data currently offers. `combinations` are AGGREGATE counts
 * of people per distinct set of characteristic values — never respondent rows,
 * never an answer, never an identifier. `countable` is false when the client's
 * data is too varied to ship those counts, and the picker then simply declines
 * to show a number rather than showing a wrong one.
 */
export type TenantScopeInventory = {
  tenantId: string;
  dimensions: ScopeDimensionOption[];
  combinations: { values: Record<string, string>; units: number }[];
  totalUnits: number;
  countable: boolean;
};

export const EMPTY_INVENTORY = (tenantId: string): TenantScopeInventory => ({
  tenantId,
  dimensions: [],
  combinations: [],
  totalUnits: 0,
  countable: true,
});

/**
 * The two states an ordinary user chooses between. `all` is full tenant access
 * and serializes to `{}`; `part` is a restriction and must name at least one
 * value, because an empty restriction would silently widen to full access.
 */
export type ScopeMode = "all" | "part";

export type ScopeSelection = {
  mode: ScopeMode;
  /** Characteristic key -> chosen values. Only meaningful when mode is `part`. */
  values: Record<string, string[]>;
};

/** A selected value that the client's current data no longer contains. */
export type UnavailableSelection = { dimension: string; value: string };

/**
 * Turn a stored scope into a selection, WITHOUT dropping anything.
 *
 * A dimension or value that no longer appears in the data is kept selected and
 * reported through `unavailable`, so the picker can mark it as historical. A
 * scope that quietly lost a restriction would widen one person's access, which
 * is the one failure mode this whole workflow exists to prevent.
 */
export function reconcileScope(
  scope: DataScope,
  inventory: TenantScopeInventory | null,
): { selection: ScopeSelection; unavailable: UnavailableSelection[] } {
  const entries = Object.entries(scope).filter(([, values]) => values.length > 0);
  if (entries.length === 0) {
    return { selection: { mode: "all", values: {} }, unavailable: [] };
  }

  const known = new Map(
    (inventory?.dimensions ?? []).map((dimension) => [
      dimension.key,
      new Set(dimension.values.map((option) => option.value)),
    ]),
  );
  const unavailable: UnavailableSelection[] = [];
  const values: Record<string, string[]> = {};
  for (const [dimension, selected] of entries) {
    const deduped = [...new Set(selected)];
    values[dimension] = deduped;
    const offered = known.get(dimension);
    for (const value of deduped) {
      if (!offered || !offered.has(value)) unavailable.push({ dimension, value });
    }
  }
  return { selection: { mode: "part", values }, unavailable };
}

/** The stored object for a selection. `all` — and only `all` — produces `{}`. */
export function toDataScope(selection: ScopeSelection): DataScope {
  if (selection.mode === "all") return {};
  const scope: DataScope = {};
  for (const [dimension, values] of Object.entries(selection.values)) {
    const deduped = [...new Set(values.filter((value) => value.trim() !== ""))];
    if (deduped.length > 0) scope[dimension] = deduped;
  }
  return scope;
}

/**
 * The exact string the existing Server Action contract receives in its
 * `data_scope` field. It is never shown to anyone: the interface shows the
 * sentence below it instead.
 */
export function serializeScope(selection: ScopeSelection): string {
  return JSON.stringify(toDataScope(selection));
}

/**
 * `part` with nothing chosen is incomplete, not "everything". The picker
 * refuses to submit it rather than serializing a restriction away.
 */
export function isSelectionComplete(selection: ScopeSelection): boolean {
  if (selection.mode === "all") return true;
  return Object.keys(toDataScope(selection)).length > 0;
}

function joinWith(parts: string[], conjunction: string): string {
  if (parts.length <= 1) return parts[0] ?? "";
  return `${parts.slice(0, -1).join(", ")} ${conjunction} ${parts[parts.length - 1]}`;
}

/**
 * The always-visible effective-access sentence.
 *
 * It states the OR inside a characteristic and the AND between characteristics
 * in ordinary words, because those two rules are the whole meaning of the
 * stored object and the person choosing must not have to infer them.
 */
export function scopeSummarySentence(
  selection: ScopeSelection,
  inventory: TenantScopeInventory | null,
  clientName: string,
): string {
  if (selection.mode === "all") {
    return `Puede ver todos los resultados de ${clientName}.`;
  }
  const scope = toDataScope(selection);
  const entries = Object.entries(scope);
  if (entries.length === 0) {
    return "Todavía no elegiste qué parte podrá ver esta persona.";
  }
  const labels = new Map((inventory?.dimensions ?? []).map((d) => [d.key, d.label]));
  const parts = entries.map(([dimension, values]) => {
    const label = labels.get(dimension) ?? dimensionFallbackLabel(dimension);
    return `${joinWith(values, "o")} (${label})`;
  });
  return `Puede ver únicamente las respuestas de ${joinWith(parts, "y")}.`;
}

/**
 * A readable characteristic name when the client's current data no longer
 * offers it, so a historical restriction still reads as words.
 */
export function dimensionFallbackLabel(key: string): string {
  const words = key.replace(/[_-]+/g, " ").trim();
  if (!words) return key;
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * How many people currently match, or null when it cannot be answered honestly.
 *
 * This is a snapshot of today's data, never a promise: the surface that shows
 * it says so. It is computed from aggregate combination counts with exactly the
 * enforcement rule — every characteristic must match (AND), any of its chosen
 * values counts (OR).
 */
export function countMatchingUnits(
  selection: ScopeSelection,
  inventory: TenantScopeInventory | null,
): number | null {
  if (!inventory || !inventory.countable) return null;
  if (selection.mode === "all") return inventory.totalUnits;
  const scope = toDataScope(selection);
  const entries = Object.entries(scope);
  if (entries.length === 0) return null;
  let total = 0;
  for (const combination of inventory.combinations) {
    const matches = entries.every(([dimension, allowed]) => {
      const value = combination.values[dimension];
      return value != null && allowed.includes(value);
    });
    if (matches) total += combination.units;
  }
  return total;
}
