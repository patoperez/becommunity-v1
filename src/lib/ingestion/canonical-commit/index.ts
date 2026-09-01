/**
 * Canonical package commit and rollback (Unit 3) — the SAFE surface.
 *
 * This barrel deliberately does NOT re-export `adapter.ts`. That module is
 * `server-only` and holds the one code path that has a plan full of real
 * values and a database connection at the same time; re-exporting it here
 * would make every importer of this file server-only by accident, and the
 * first time somebody imported a type from a client component the build would
 * fail for a reason that has nothing to do with what they were doing.
 *
 * The adapter is reached through `./server`, which exists to make that import
 * a deliberate act.
 *
 * The projector and the plan types ARE exported: they are pure, they touch no
 * database, and the gate and the read-only dry run need them. A plan built
 * here still carries private values — see the header of `plan.ts` for where it
 * may and may not travel.
 */
export { buildCanonicalCommitPlan } from "./projector";
export type { ProjectionInput } from "./projector";
export {
  CANONICAL_PROJECTION_SPECS,
  CUICUILCO_PROJECTION_V1,
} from "./projection-spec";
export type {
  AttributeColumnSpec,
  BandSchemeProjectionSpec,
  CohortProjectionSpec,
  CuratedEntityProjectionSpec,
  InstrumentProjectionSpec,
  PackageProjectionSpec,
  PerformanceProjectionSpec,
  RetentionProjectionSpec,
  ScaleProjectionSpec,
} from "./projection-spec";
export { PLAN_FAMILIES } from "./plan";
export type {
  CanonicalCommitPlan,
  CommitPlanBuild,
  PlanExpectedCounts,
  PlanFamily,
  PlanIssue,
} from "./plan";
export { canonicalJson, commitPlanFingerprint, planFingerprintMatches } from "./fingerprint";
export { DERIVED_UUID_ENTROPY_BITS, derivedRecordId, isUuid } from "./ids";
export { sha256Bytes, sha256Hex, sha256Prefixed, toHex } from "./sha256";
export { expectedCountsFor, reconcileCounts, OWNERSHIP_COUNT_PREFIX } from "./reconcile";
export type { CountDisagreement, Reconciliation } from "./reconcile";
export {
  COMMIT_ERROR_MESSAGES,
  commitErrorMessage,
  refusal,
  safeErrorCode,
} from "./result";
export type {
  CanonicalCommitCounts,
  CanonicalCommitFailure,
  CanonicalCommitOutcome,
  CanonicalCommitSuccess,
  CanonicalRollbackOutcome,
} from "./result";
