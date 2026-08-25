/**
 * The import-mapping vocabulary (P8.2, contract C1).
 *
 * WHAT DOES NOT CHANGE. `ImportMapping`, `importMappingSchema`, the source
 * signature, the adapter, the recoding semantics, the atomic commit and the
 * rollback are all untouched. The stored configuration is byte-identical to
 * what the previous screen produced, which is what keeps a saved mapping
 * reusable and a study longitudinally comparable.
 *
 * WHAT CHANGES. Nobody types a stored key any more. A destination is CHOSEN
 * from what already exists, or created by naming it in ordinary words; the
 * stable key is derived here, once, and then never moves — renaming what a
 * person reads on screen would otherwise silently repoint an existing mapping
 * at a different destination, which is the failure that breaks comparability
 * between two periods of the same study.
 */

import { QUALITATIVE_SOURCES, type QualitativeSource } from "./canonical";
import type { ColumnTarget, ImportMapping } from "./mapping";

export type DestinationKind = ColumnTarget["kind"];

/** The four choices an operator actually makes about a column. */
export const DESTINATION_CHOICES: {
  kind: DestinationKind;
  label: string;
  hint: string;
}[] = [
  {
    kind: "ignore",
    label: "No importar",
    hint: "La columna se queda en el archivo y no entra al estudio.",
  },
  {
    kind: "segment",
    label: "Dato para filtrar",
    hint: "Sirve para separar resultados: nivel, campus, área, antigüedad.",
  },
  {
    kind: "quantitative",
    label: "Resultado numérico",
    hint: "Una calificación o puntaje que se va a promediar y comparar.",
  },
  {
    kind: "qualitative",
    label: "Comentario abierto",
    hint: "Texto que escribió la persona y que se revisa antes de publicarse.",
  },
];

export const DESTINATION_KIND_LABEL: Record<DestinationKind, string> = Object.fromEntries(
  DESTINATION_CHOICES.map((choice) => [choice.kind, choice.label]),
) as Record<DestinationKind, string>;

/** How each stored source value reads to a person. The allowlist is unchanged. */
export const QUALITATIVE_SOURCE_LABEL: Record<QualitativeSource, string> = {
  encuesta: "Encuesta",
  mystery_shopper: "Visita de cliente incógnito",
  focus_group: "Grupo focal",
};

export function qualitativeSourceLabel(source: string): string {
  return (QUALITATIVE_SOURCE_LABEL as Record<string, string>)[source] ?? destinationLabel(source);
}

export const QUALITATIVE_SOURCE_CHOICES = QUALITATIVE_SOURCES.map((source) => ({
  value: source,
  label: QUALITATIVE_SOURCE_LABEL[source],
}));

/**
 * The name a stored key shows as. Deliberately derived rather than stored: the
 * mapping schema has no label field, and adding one would change the saved
 * configuration bytes that decide whether an existing mapping is reused or a
 * new version is written.
 */
export function destinationLabel(key: string): string {
  const words = key.replace(/[_-]+/g, " ").trim();
  if (!words) return key;
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * The stable key for a name a person typed. Returns null when the name cannot
 * become one — the workflow then says so in words instead of quietly mangling
 * it into something the operator never chose.
 */
export function keyFromLabel(label: string): string | null {
  const slug = label
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("es-MX")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 64)
    .replace(/_+$/g, "");
  if (!slug || !/^[a-z]/.test(slug)) return null;
  return slug;
}

/** Why a typed name was refused, in the words the operator needs. */
export function nameRejectionReason(label: string, taken: Iterable<string>): string | null {
  const trimmed = label.trim();
  if (trimmed === "") return "Escribe un nombre para este destino.";
  const key = keyFromLabel(trimmed);
  if (!key) return "El nombre debe empezar con una letra y contener al menos una letra o número.";
  for (const existing of taken) {
    if (existing === key) {
      return `Ya existe “${destinationLabel(existing)}”. Selecciónalo en la lista para reutilizarlo.`;
    }
  }
  return null;
}

/**
 * A first proposal for a column, derived from its own header. It is a
 * suggestion the operator can accept with one look, never a value they had to
 * remember. The fallbacks keep the proposal a VALID key so the chooser always
 * has something selectable.
 */
export function proposedKeyFromHeader(header: string, kind: DestinationKind): string {
  const stripped = header.trim().replace(/^(seg|q|qual)_/i, "");
  const fallback =
    kind === "quantitative" ? "resultado" : kind === "qualitative" ? "comentario" : "dato";
  return keyFromLabel(stripped) ?? keyFromLabel(header) ?? fallback;
}

/** The target a newly chosen kind starts from, with its proposed destination. */
export function targetForKind(kind: DestinationKind, header: string): ColumnTarget {
  const key = proposedKeyFromHeader(header, kind);
  if (kind === "segment") return { kind, key };
  if (kind === "quantitative") return { kind, metricKey: key };
  if (kind === "qualitative") return { kind, theme: key, source: "encuesta" };
  return { kind: "ignore" };
}

/** The stored key a target points at, or null when the column is not imported. */
export function targetKey(target: ColumnTarget): string | null {
  if (target.kind === "segment") return target.key;
  if (target.kind === "quantitative") return target.metricKey;
  if (target.kind === "qualitative") return target.theme;
  return null;
}

/** The same target pointed at a different stored key, preserving its settings. */
export function withTargetKey(target: ColumnTarget, key: string): ColumnTarget {
  if (target.kind === "segment") return { ...target, key };
  if (target.kind === "quantitative") return { ...target, metricKey: key };
  if (target.kind === "qualitative") return { ...target, theme: key };
  return target;
}

/** Destinations of one kind already used by this mapping. */
export function keysInUse(mapping: ImportMapping, kind: DestinationKind): string[] {
  const keys = new Set<string>();
  for (const column of mapping.columns) {
    if (column.target.kind !== kind) continue;
    const key = targetKey(column.target);
    if (key) keys.add(key);
  }
  return [...keys];
}

/**
 * Filter destinations a person can choose for one kind: everything the client
 * already uses, everything this mapping already uses, and whatever this column
 * points at right now, without repeats.
 */
export function destinationOptions(
  mapping: ImportMapping,
  kind: DestinationKind,
  known: string[],
  current: string | null,
): { key: string; label: string; known: boolean }[] {
  const knownSet = new Set(known);
  const keys = new Set<string>([...known, ...keysInUse(mapping, kind)]);
  if (current) keys.add(current);
  return [...keys]
    .map((key) => ({ key, label: destinationLabel(key), known: knownSet.has(key) }))
    .sort((a, b) => a.label.localeCompare(b.label, "es-MX"));
}

/**
 * Filter destinations that two columns share.
 *
 * Only `segment` is reported: the adapter writes each segment onto one field of
 * the person, so a second column pointing at the same one overwrites the first.
 * Numbers and comments are appended, so sharing a destination there is ordinary
 * and gets no warning it does not deserve.
 */
export function duplicateSegmentDestinations(mapping: ImportMapping): string[] {
  const seen = new Map<string, number>();
  for (const column of mapping.columns) {
    if (column.target.kind !== "segment") continue;
    seen.set(column.target.key, (seen.get(column.target.key) ?? 0) + 1);
  }
  return [...seen.entries()].filter(([, count]) => count > 1).map(([key]) => key);
}

/** How the recoding tables read: a name, never the generated identifier. */
export function recodingTableLabel(id: string): string {
  return destinationLabel(id);
}

/**
 * What one previewed row will produce, in the shape the readable preview
 * renders. This is a VIEW of the canonical payload the adapter already built —
 * the same objects the commit will write — not a second transformation of the
 * file.
 */
export type PreviewRowSummary = {
  sourceRow: number;
  filters: { label: string; value: string }[];
  results: { label: string; value: number }[];
  comments: { label: string; source: string; quote: string }[];
};

export function summarizePreviewRow(row: {
  sourceRow: number;
  segments: Record<string, string>;
  quant: { metric_key: string; value: number }[];
  qual: { source: string; theme: string; quote: string }[];
}): PreviewRowSummary {
  return {
    sourceRow: row.sourceRow,
    filters: Object.entries(row.segments).map(([key, value]) => ({
      label: destinationLabel(key),
      value,
    })),
    results: row.quant.map((entry) => ({
      label: destinationLabel(entry.metric_key),
      value: entry.value,
    })),
    comments: row.qual.map((entry) => ({
      label: destinationLabel(entry.theme),
      source: qualitativeSourceLabel(entry.source),
      quote: entry.quote,
    })),
  };
}
