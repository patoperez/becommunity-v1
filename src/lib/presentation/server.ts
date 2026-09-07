/**
 * THE SERVER-ONLY PRESENTATION SURFACE - binding, resolution, persistence.
 *
 * `import "server-only"` is the marker Next.js turns into a build error the
 * moment a `"use client"` module reaches this file, transitively, by any route.
 * It is the same mechanism `src/lib/supabase/admin.ts` and `src/lib/shadow/`
 * already use, and it is here for the same reason: everything below knows WHERE
 * a value sits.
 *
 * Three things live behind it.
 *
 *   THE ADDRESS MAP. `CanonicalAddress` is an array position inside a results
 *   document. A browser holding one is a browser one step from resolving it,
 *   and resolving it client-side is a browser owning a number.
 *
 *   THE EXACT BINDING. `RegistrySource` names the tenant, the study, the plan
 *   and the package a registry was built from. Those are database identifiers;
 *   they exist so the resolver can REFUSE, and they never cross to a client.
 *
 *   PERSISTENCE. Encoding stamps a tenant and a study into a definition;
 *   decoding refuses one that belongs to somebody else.
 *
 * Offline gates import the pure implementation modules directly rather than
 * this file, because `server-only` throws under a plain Node import and a gate
 * is not a client. That is allowed and intended: the boundary this file draws
 * is for PRODUCTION code, and an import-graph gate proves no route, component
 * or `"use client"` module crosses it.
 */

import "server-only";

export {
  bindPresentationDocument,
  buildCanonicalPresentationRegistry,
  presentationBindingFingerprint,
  projectPresentationCatalog,
  registryEntry,
} from "./registry";
export type { CanonicalAddress, CanonicalPresentationRegistry, RegistrySource } from "./registry";

export { resolvePresentation } from "./resolve";
export type { ResolveInput } from "./resolve";

export { decodePresentationFromStorage, encodePresentationForStorage } from "./persistence";
export type { PresentationPublicationState, PresentationScope, StoredPresentation } from "./persistence";

export {
  APPROVED_FIRST_GROUP_PARTITION,
  APPROVED_ROUTE_IDS,
  buildApprovedCuicuilcoBlueprint,
} from "./blueprints/cuicuilco-approved";

/**
 * The starting layout for a study no registered blueprint fits.
 *
 * Behind `server-only` with the approved one, for the same reason: it takes a
 * REGISTRY, and a registry carries the address map and the database scope. What
 * it returns — an unbound document — is client-safe; what it reads to build one
 * is not.
 */
export { buildGenericStartingBlueprint } from "./blueprints/generic-starting";
export type { GenericBlueprintOptions } from "./blueprints/generic-starting";
