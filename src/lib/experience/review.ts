/**
 * Who approved what, and what un-approves it.
 *
 * MODELLED, NOT PERSISTED. This slice writes nothing: there is no table, no
 * migration and no Server Action behind any of it. What exists here is the
 * SHAPE a persistent editor will have to store, and — more usefully — the rule
 * that decides when an approval has stopped meaning anything.
 *
 * The rule matters more than the schema. "Approved" is not a property of a
 * document; it is a statement that a named person looked at THIS arrangement,
 * built on THESE results, under THIS disclosure policy, over THIS data, and
 * said it could go to a client. Change any of those four and the statement is
 * no longer about what is on screen. The product already learned this the
 * expensive way with published category groupings, which is why publication
 * pins a snapshot rather than re-reading the working state.
 *
 * `approvalInvalidations` is therefore a pure comparison between what was
 * approved and what is true now. A future persistent editor calls it before
 * letting anything be published, and a reviewer is told which of the four
 * changed rather than being asked to re-approve for unstated reasons.
 */

import type { SampleVisibilityPolicy } from "./sample-policy";

export const REVIEW_STATUSES = [
  "draft",
  "in_review",
  "approved",
  "published",
  "superseded",
] as const;
export type ReviewStatus = (typeof REVIEW_STATUSES)[number];

export const APPROVAL_INVALIDATION_REASONS = [
  "schema_version_changed",
  "semantic_registry_changed",
  "data_revision_changed",
  "sample_policy_changed",
  "journeys_changed",
  "categories_changed",
  "consent_changed",
] as const;
export type ApprovalInvalidationReason = (typeof APPROVAL_INVALIDATION_REASONS)[number];

export type ExperienceReview = {
  status: ReviewStatus;
  /** Increments on every saved change. Never reused, never decremented. */
  revision: number;
  authorId: string | null;
  reviewerId: string | null;
  publisherId: string | null;
  /** What changed since the last revision, in the author's own words. */
  changeSummary: string | null;
  approvedAt: string | null;
  /** Why a previously approved definition is no longer approved. */
  invalidationReasons: readonly ApprovalInvalidationReason[];
};

export const NEW_REVIEW: ExperienceReview = {
  status: "draft",
  revision: 1,
  authorId: null,
  reviewerId: null,
  publisherId: null,
  changeSummary: null,
  approvedAt: null,
  invalidationReasons: [],
};

/**
 * What a published snapshot has to carry with it so it stays reproducible.
 *
 * The client's delivered experience is the SNAPSHOT, never the working draft.
 * A newer draft does not reach a client until it is approved and published
 * again, which is the rule P8.4 already established for interpretations and
 * which this model inherits rather than reinvents.
 */
export type ExperiencePublication = {
  snapshotId: string | null;
  publishedAt: string | null;
  /** The schema the snapshot was written under. */
  schemaVersion: number;
  /** The registry stamp the snapshot was approved against. */
  registryVersion: string | null;
  /** Which revision of the underlying data produced the numbers. */
  dataRevision: string | null;
  /** The disclosure rule in force at publication. Frozen with the snapshot. */
  samplePolicy: SampleVisibilityPolicy | null;
  /** The category grouping pinned at publication, by reference. */
  categorySnapshotId: string | null;
};

export const UNPUBLISHED: ExperiencePublication = {
  snapshotId: null,
  publishedAt: null,
  schemaVersion: 1,
  registryVersion: null,
  dataRevision: null,
  samplePolicy: null,
  categorySnapshotId: null,
};

/** The four facts an approval is a statement about. */
export type ApprovalBasis = {
  schemaVersion: number;
  registryVersion: string | null;
  dataRevision: string | null;
  samplePolicy: SampleVisibilityPolicy | null;
  /** A stamp over the journeys as approved. */
  journeySignature: string | null;
  /** A stamp over the category decisions the numbers were grouped by. */
  categorySignature: string | null;
  /** A stamp over what the client consented to being shown. */
  consentSignature: string | null;
};

function samePolicy(
  a: SampleVisibilityPolicy | null,
  b: SampleVisibilityPolicy | null,
): boolean {
  if (a === null || b === null) return a === b;
  return a.policyVersion === b.policyVersion && a.mode === b.mode && a.threshold === b.threshold;
}

/**
 * Everything that has changed since approval, in a stable order.
 *
 * An empty array means the approval still describes what is on screen. It is
 * deliberately a LIST rather than a boolean: a reviewer asked to look again
 * deserves to be told which of the four things moved.
 */
export function approvalInvalidations(
  approved: ApprovalBasis,
  current: ApprovalBasis,
): ApprovalInvalidationReason[] {
  const reasons: ApprovalInvalidationReason[] = [];
  if (approved.schemaVersion !== current.schemaVersion) reasons.push("schema_version_changed");
  if (approved.registryVersion !== current.registryVersion) reasons.push("semantic_registry_changed");
  if (approved.dataRevision !== current.dataRevision) reasons.push("data_revision_changed");
  if (!samePolicy(approved.samplePolicy, current.samplePolicy)) reasons.push("sample_policy_changed");
  if (approved.journeySignature !== current.journeySignature) reasons.push("journeys_changed");
  if (approved.categorySignature !== current.categorySignature) reasons.push("categories_changed");
  if (approved.consentSignature !== current.consentSignature) reasons.push("consent_changed");
  return reasons;
}

/** Whether an approved definition may still be published unchanged. */
export function approvalHolds(approved: ApprovalBasis, current: ApprovalBasis): boolean {
  return approvalInvalidations(approved, current).length === 0;
}
