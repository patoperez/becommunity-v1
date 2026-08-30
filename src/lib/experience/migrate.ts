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
export const SUPPORTED_SCHEMA_VERSIONS = [1, 2] as const;

export type MigrationOutcome =
  | { ok: true; definition: ExperienceDefinitionV1; migratedFrom: number }
  | { ok: false; reason: "unknown_version" | "invalid_document"; detail: string };

/**
 * VERSION 1 -> VERSION 2.
 *
 * Three changes, and each one is a move rather than a loss:
 *
 *  1. THE STUDY'S IDENTITY LEAVES PANORAMA. Version 1 put the study title, the
 *     client, the period and the introductory sentence in a `cover` BLOCK on
 *     the first page. Version 2 has a global `identity` layer. The migration
 *     reads the first cover block, carries its words into the identity, and
 *     REMOVES that block — carrying it and leaving it would print the study's
 *     name twice, which is the "duplication or data loss" the move exists to
 *     avoid. A cover block that is not the first one is left exactly where it
 *     is: a person put it there on purpose.
 *
 *  2. `query.filterRefs` BECOMES `query.fixedFilters`. A version-1 fixed
 *     narrowing named a `filterDefinition`; a version-2 one carries the
 *     characteristic and the values itself. Each reference is resolved through
 *     the document's own filter definitions and its default values become the
 *     fixed values. A reference that resolved to nothing, or to a filter with
 *     no defaults, restricted nothing in version 1 either, so it is dropped
 *     rather than invented.
 *
 *  3. EVERY BLOCK GAINS `filterPanel: null`. No version-1 block was a panel.
 *
 * Nothing else about the document is touched: pages, blocks, layout,
 * connections, journeys, review and publication survive byte for byte.
 */
function oneToTwo(value: unknown): unknown {
  if (typeof value !== "object" || value === null) return value;
  const document = value as Record<string, unknown>;
  const pages = Array.isArray(document.pages) ? [...(document.pages as unknown[])] : [];

  const filterDefaults = new Map<string, { dimensionId: string; values: string[] }>();
  if (Array.isArray(document.filterDefinitions)) {
    for (const entry of document.filterDefinitions as Record<string, unknown>[]) {
      if (!entry || typeof entry.id !== "string" || typeof entry.dimensionId !== "string") continue;
      const values = Array.isArray(entry.defaultValues)
        ? (entry.defaultValues as unknown[]).filter((v): v is string => typeof v === "string")
        : [];
      filterDefaults.set(entry.id, { dimensionId: entry.dimensionId, values });
    }
  }

  // The identity, taken from the first page's first cover block when there is
  // one. `title` falls back to the document's own title, which every version-1
  // document has.
  let identityTitle = typeof document.title === "string" ? document.title : "Estudio";
  let identityDescription: string | null = null;
  let coverBlockId: string | null = null;
  const firstPage = pages[0] as Record<string, unknown> | undefined;
  if (firstPage && Array.isArray(firstPage.blocks)) {
    const cover = (firstPage.blocks as Record<string, unknown>[]).find(
      (block) => block && block.type === "cover",
    );
    if (cover) {
      coverBlockId = typeof cover.id === "string" ? cover.id : null;
      if (typeof cover.title === "string" && cover.title.trim() !== "") identityTitle = cover.title;
      const copy = cover.copy as Record<string, unknown> | undefined;
      const body = copy && typeof copy.body === "string" ? copy.body : null;
      identityDescription = body && body.trim() !== "" ? body : null;
    }
  }

  const metadata = (document.metadata ?? {}) as Record<string, unknown>;
  const subtitle = typeof metadata.subtitle === "string" ? metadata.subtitle : null;
  const theme = (document.theme ?? {}) as Record<string, unknown>;
  const showMark = theme.showClientMark !== false;

  const migratedPages = pages.map((rawPage, pageIndex) => {
    const page = (rawPage ?? {}) as Record<string, unknown>;
    const blocks = Array.isArray(page.blocks) ? (page.blocks as Record<string, unknown>[]) : [];
    const kept = blocks.filter(
      (block) => !(pageIndex === 0 && coverBlockId !== null && block?.id === coverBlockId),
    );
    return {
      ...page,
      blocks: kept.map((rawBlock, blockIndex) => {
        const block = { ...(rawBlock ?? {}) } as Record<string, unknown>;
        block.filterPanel = null;
        // The cover is gone from the top of page one, so the blocks that
        // followed it move up. `order` is renumbered per breakpoint rather
        // than left with a gap, because a gap is a layout nobody authored.
        const layout = block.layout as Record<string, Record<string, unknown>> | undefined;
        if (layout && coverBlockId !== null && pageIndex === 0) {
          block.layout = Object.fromEntries(
            Object.entries(layout).map(([breakpoint, placement]) => [
              breakpoint,
              { ...placement, order: blockIndex },
            ]),
          );
        }
        const query = block.query as Record<string, unknown> | null | undefined;
        if (query && typeof query === "object") {
          const refs = Array.isArray(query.filterRefs) ? (query.filterRefs as unknown[]) : [];
          const fixed: { dimensionId: string; values: string[] }[] = [];
          const seen = new Set<string>();
          for (const ref of refs) {
            if (typeof ref !== "string") continue;
            const resolved = filterDefaults.get(ref);
            if (!resolved || resolved.values.length === 0) continue;
            if (seen.has(resolved.dimensionId)) continue;
            seen.add(resolved.dimensionId);
            fixed.push({ dimensionId: resolved.dimensionId, values: [...resolved.values] });
          }
          const nextQuery = { ...query, fixedFilters: fixed };
          delete (nextQuery as Record<string, unknown>).filterRefs;
          block.query = nextQuery;
        }
        return block;
      }),
    };
  });

  return {
    ...document,
    schemaVersion: 2,
    identity: {
      visible: true,
      title: identityTitle,
      organization: null,
      period: null,
      description: identityDescription ?? subtitle,
      mark: showMark ? { source: "client_brand" } : { source: "none" },
      showReportDownload: false,
      show: {
        title: true,
        organization: true,
        period: true,
        description: (identityDescription ?? subtitle) !== null,
        mark: showMark,
      },
    },
    pages: migratedPages,
  };
}

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

  // One step per version, applied in order.
  let current: unknown = value;
  if (version < 2) current = oneToTwo(current);

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
