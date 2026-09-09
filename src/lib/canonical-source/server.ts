import "server-only";

/**
 * The server-only entry point for READING the canonical tables.
 *
 * It exists so that importing the read path is a DELIBERATE act, exactly as
 * `canonical-commit/server.ts` does for the write path. `./index` carries the
 * pure assembler, the read workflow, the row types and the shared comparison
 * order and can be imported from anywhere; this file carries the two functions
 * that talk to a database, and its own `server-only` marker fails the build if
 * either is ever pulled into a client bundle — even indirectly.
 *
 * Neither function is reachable from a browser in any case: every canonical
 * table denies `public`, `anon` and `authenticated` with RLS and FORCE RLS
 * (migrations 0026, 0027 and 0028). This boundary is the first of the two, not
 * the only one.
 *
 * NO CLIENT-FACING ROUTE IMPORTS THIS YET, and none may until the read-path
 * integration is separately authorized. The application still reads through
 * `src/lib/dashboard/view.ts`.
 */
export {
  loadCanonicalResultSource,
  loadCanonicalStudyResults,
  loadCuratedPainReviewEvidence,
} from "./adapter";
export type { LoadCanonicalSourceParams } from "./adapter";
export type {
  CuratedPainEvidence,
  CuratedPainRow,
  CuratedPainStageLink,
  CuratedStageRow,
} from "./curated-review";
