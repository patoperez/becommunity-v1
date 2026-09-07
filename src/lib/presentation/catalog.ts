/**
 * THE CATALOGUE PROJECTION — the registry, minus the half a client may not have.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * An editor eventually needs to know what it may bind to: which handles exist,
 * what each one means, how it may be drawn, whether a value is there, and which
 * filters it accepts or refuses. All of that is describable and all of it lives
 * in `RegistryEntry`.
 *
 * What an editor must NOT have is the binding itself. `registry.addresses` says
 * where a value sits inside the results document, and it stays on the server —
 * not because an array index is dangerous on its own, but because the moment a
 * client holds addresses, the temptation is to resolve one, and resolving one
 * client-side is how a browser starts owning a number.
 *
 * This projection is therefore a DROP, not a transform: every field it keeps is
 * copied unchanged from an entry that was already client-safe, and the one
 * field it removes is removed entirely. There is nothing to get subtly wrong,
 * which is the property worth having at a boundary.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import type { CanonicalPresentationRegistry, RegistryEntry } from "./registry";

/** One catalogue row. Structurally an entry; nominally a promise about safety. */
export type PresentationCatalogEntry = RegistryEntry;

/** Everything an editor may know about what it can bind to. */
export type PresentationCatalog = {
  registryVersion: string;
  contractVersion: string;
  entries: readonly PresentationCatalogEntry[];
};

/**
 * Project a registry into its client-reachable catalogue.
 *
 * The address map is dropped and nothing replaces it. `entries` is already
 * sorted by handle when the registry is built, so the catalogue is
 * deterministic without re-sorting.
 */
export function projectPresentationCatalog(registry: CanonicalPresentationRegistry): PresentationCatalog {
  return {
    registryVersion: registry.registryVersion,
    contractVersion: registry.contractVersion,
    entries: registry.entries,
  };
}
