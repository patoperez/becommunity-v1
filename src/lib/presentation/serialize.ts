/**
 * DETERMINISTIC SERIALIZATION — the same document, the same bytes, every time.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * `study_experience_revision.definition_sha256` is a CHECK-constrained column
 * (`0025…sql:92-96`) holding a hash over the stored definition, and the whole
 * point of that column is that two people looking at the same revision are
 * looking at the same bytes. `JSON.stringify` cannot provide that: its key
 * order is the object's own insertion order, so two structurally identical
 * documents built by two different code paths hash differently.
 *
 * So keys are sorted, at every depth, in codepoint order. Arrays keep their
 * order — an array's order is DATA here (the order of pages, of blocks, of the
 * touchpoints inside a visible route) and sorting one would change the meaning
 * of the document rather than normalise its encoding.
 *
 * `undefined` is refused rather than dropped. `JSON.stringify` silently omits
 * an undefined property, so a document carrying one would serialize to bytes
 * that do not round-trip back to it — and a hash over bytes that do not
 * round-trip is a hash of the wrong thing.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { PresentationError } from "./errors";

/** The ceiling the database enforces: 512 KiB, matching `0023…sql:93-96`. */
export const SERIALIZED_BYTE_LIMIT = 512 * 1024;

function stable(value: unknown, path: string): unknown {
  if (value === undefined) {
    throw new PresentationError(
      "malformed_document",
      `valor indefinido en ${path}: no se serializa, porque JSON.stringify lo omitiría en silencio ` +
        "y los bytes dejarían de corresponder al documento.",
    );
  }
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) {
    // Order is meaning here, never encoding. It is preserved exactly.
    return value.map((entry, index) => stable(entry, `${path}[${index}]`));
  }
  const source = value as Record<string, unknown>;
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(source).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))) {
    sorted[key] = stable(source[key], `${path}.${key}`);
  }
  return sorted;
}

/**
 * Serialize any presentation-layer value with sorted keys.
 *
 * Used for the document, for the catalogue projection and for a render model —
 * the determinism gate compares two runs byte for byte through this function,
 * so all three are held to the same standard.
 */
export function serializeDeterministic(value: unknown): string {
  return JSON.stringify(stable(value, "$"));
}

/** How many bytes the stored form occupies, measured as UTF-8. */
export function serializedBytes(value: unknown): number {
  return new TextEncoder().encode(serializeDeterministic(value)).length;
}

/** Whether the stored form fits the column the database declares. */
export function withinSizeLimit(value: unknown): boolean {
  return serializedBytes(value) <= SERIALIZED_BYTE_LIMIT;
}
