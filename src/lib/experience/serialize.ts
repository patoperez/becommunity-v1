/**
 * Turning a definition into bytes, and back, without surprises.
 *
 * Two properties are needed and neither is free.
 *
 * DETERMINISM. The same document must always produce the same bytes, whichever
 * order its fields happened to be built in. Object key order is an accident of
 * construction in JavaScript, and an accident is exactly what a content hash,
 * a diff between two adapter runs, or an immutable publication snapshot cannot
 * be built on. So keys are sorted, recursively, at serialization time. Arrays
 * are NOT sorted: their order is meaning.
 *
 * BOUNDEDNESS. Field limits multiply. A document can satisfy every individual
 * maximum and still be far larger than anything that should be stored, so the
 * serialized length is checked against one explicit ceiling.
 */

import { stableToken } from "./ids";
import { EXPERIENCE_LIMITS } from "./limits";
import type { ExperienceDefinitionV1 } from "./definition";

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

function sortKeys(value: Json): Json {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value !== null && typeof value === "object") {
    const sorted: { [key: string]: Json } = {};
    for (const key of Object.keys(value).sort()) sorted[key] = sortKeys(value[key]);
    return sorted;
  }
  return value;
}

/**
 * The canonical bytes of a definition.
 *
 * `pretty` is for the export a person reads or hands to another consultant; the
 * compact form is what a hash or a stored blob uses. Both are key-sorted, so
 * the pretty form is a reformatting of the same document, never a different one.
 */
export function serializeExperienceDefinition(
  definition: ExperienceDefinitionV1,
  options: { pretty?: boolean } = {},
): string {
  const canonical = sortKeys(JSON.parse(JSON.stringify(definition)) as Json);
  return JSON.stringify(canonical, null, options.pretty ? 2 : 0);
}

/** Whether the serialized document fits the one ceiling that actually binds. */
export function withinSizeLimit(definition: ExperienceDefinitionV1): boolean {
  return serializedBytes(definition) <= EXPERIENCE_LIMITS.serializedBytes;
}

export function serializedBytes(definition: ExperienceDefinitionV1): number {
  const serialized = serializeExperienceDefinition(definition);
  // Counted in UTF-8 bytes, which is what a database column and a Worker
  // response body actually spend — not in UTF-16 code units.
  return typeof TextEncoder === "undefined"
    ? serialized.length
    : new TextEncoder().encode(serialized).length;
}

/**
 * A stable content stamp for one definition.
 *
 * Used to tell "this is the same arrangement" from "somebody changed
 * something" without diffing two documents field by field. It is a naming
 * function, never a signature: it proves nothing about who wrote the document.
 */
export function definitionSignature(definition: ExperienceDefinitionV1): string {
  return stableToken(serializeExperienceDefinition(definition));
}
