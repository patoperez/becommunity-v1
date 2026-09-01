import "server-only";

/**
 * The server-only entry point for writing a canonical package.
 *
 * It exists so that importing the write path is a DELIBERATE act. `./index`
 * carries the pure projector, the plan types and the safe result DTO and can be
 * imported from anywhere; this file carries the two functions that talk to the
 * database, and its own `server-only` marker fails the build if it is ever
 * pulled into a client bundle — even indirectly.
 *
 * Neither function is reachable from a browser in any case: migration 0024
 * revokes both RPCs from `public`, `anon` and `authenticated` and grants them
 * only to `service_role`, and every canonical table denies browser roles with
 * RLS and FORCE RLS. This boundary is the first of the two, not the only one.
 */
export { commitCanonicalPackage, rollbackCanonicalPackage } from "./adapter";
export type { CanonicalCommitFile, CanonicalCommitParams } from "./adapter";
