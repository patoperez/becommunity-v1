/**
 * How a stored definition survives the schema changing under it.
 *
 * There is exactly one version today, so this file currently does very little.
 * It exists now, rather than later, because the moment version 2 appears is the
 * moment it is too late to decide the strategy: there will already be stored
 * documents, published snapshots and templates written under version 1, and
 * whatever happens to them will be whatever the first migration happened to do.
 *
 * THE STRATEGY, DECIDED NOW.
 *
 *  1. FORWARD ONLY, ONE STEP AT A TIME. A migration takes version N to N+1 and
 *     nothing else. Reaching version 5 from version 1 runs four small, testable
 *     functions rather than one large one nobody can reason about.
 *
 *  2. NEVER IN PLACE. Migration is a pure function producing a new document.
 *     The stored blob is rewritten only when a person saves, so opening an old
 *     experience cannot quietly rewrite history.
 *
 *  3. A PUBLISHED SNAPSHOT IS NEVER MIGRATED. It is read at the version it was
 *     written under, and it renders through the code path for that version, or
 *     it is not rendered at all. A client's delivered report does not change
 *     because the product's schema moved on; that rule already governs category
 *     groupings and interpretations, and it governs this too.
 *
 *  4. AN UNKNOWN VERSION IS A REFUSAL, NOT A GUESS. A document written by a
 *     newer build than the one reading it is rejected with its version named.
 *     Half-reading a document whose meaning has changed is how a page silently
 *     loses a section.
 *
 *  5. EVERY MIGRATION IS TESTED AGAINST A FROZEN FIXTURE of the version it
 *     starts from. The fixture is committed, never regenerated.
 */

import {
  EXPERIENCE_SCHEMA_VERSION,
  parseExperienceDefinition,
  type ExperienceDefinitionV1,
} from "./definition";

/** Every version this build can read. Extended, never rewritten. */
export const SUPPORTED_SCHEMA_VERSIONS = [1] as const;

export type MigrationOutcome =
  | { ok: true; definition: ExperienceDefinitionV1; migratedFrom: number }
  | { ok: false; reason: "unknown_version" | "invalid_document"; detail: string };

/** The version a stored blob declares, or null when it declares none. */
export function declaredVersion(value: unknown): number | null {
  if (typeof value !== "object" || value === null) return null;
  const version = (value as { schemaVersion?: unknown }).schemaVersion;
  return typeof version === "number" && Number.isSafeInteger(version) ? version : null;
}

/**
 * Read a stored definition, bringing it forward if it was written by an older
 * build. The result is always validated by the current schema, so a migration
 * that produced something invalid fails loudly here rather than downstream.
 */
export function migrateExperienceDefinition(value: unknown): MigrationOutcome {
  const version = declaredVersion(value);
  if (version === null) {
    return { ok: false, reason: "unknown_version", detail: "el documento no declara su versión" };
  }
  if (!(SUPPORTED_SCHEMA_VERSIONS as readonly number[]).includes(version)) {
    return {
      ok: false,
      reason: "unknown_version",
      detail: `versión ${version}; esta versión del producto entiende hasta la ${EXPERIENCE_SCHEMA_VERSION}`,
    };
  }

  // One step per version, applied in order. Empty today, by construction.
  const current = value;

  const parsed = parseExperienceDefinition(current);
  if (!parsed.ok) {
    return {
      ok: false,
      reason: "invalid_document",
      detail: parsed.issues
        .slice(0, 3)
        .map((issue) => `${issue.path || "documento"}: ${issue.message}`)
        .join("; "),
    };
  }
  return { ok: true, definition: parsed.definition, migratedFrom: version };
}
