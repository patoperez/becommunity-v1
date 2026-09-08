/**
 * THE PUBLICATION LAYER — pure, client-safe, and it reaches no transport.
 *
 * Everything behind this barrel is a function over a `PresentationRenderModel`
 * or over plain facts the server assembled: the preflight, the inventory, the
 * structural difference, and the closed vocabularies all three speak. There is
 * no Supabase client, no `server-only` marker, no clock and no randomness, which
 * is why an offline gate drives the REAL preflight rather than a copy of it and
 * why a `"use client"` review surface may import the types it renders.
 *
 * The transport half — reading the draft, building the registry, calling the
 * publication RPC — lives in `src/lib/studio/publication-workspace.ts`, behind
 * `import "server-only"`, exactly as the composer's does.
 */

export {
  WARNINGS_REQUIRING_ACKNOWLEDGEMENT,
  warningRequiresAcknowledgement,
} from "./contract";
export type {
  BlockInventoryEntry,
  CurrentPublicationSummary,
  PageInventoryEntry,
  PublicationBlocker,
  PublicationBlockerCode,
  PublicationFinding,
  PublicationHistoryEntry,
  PublicationIdentity,
  PublicationPreflight,
  PublicationWarning,
  PublicationWarningCode,
  PublishedPresentation,
  StructuralChange,
  StructuralDifference,
} from "./contract";

export { runPublicationPreflight } from "./preflight";
export type {
  PublicationIssue,
  PublicationSubject,
  QualitativeBinding,
  StoredDraftFacts,
} from "./preflight";

export { blockTitle, buildPublicationInventory, countVisibleToClient, pageTitle } from "./inventory";
export { structuralDifference } from "./difference";

export type {
  PublicationReview,
  PublicationReviewPayload,
  PublicationUnavailable,
  PublicationUnavailableReason,
  PublishPresentation,
  PublishRefusalReason,
  PublishResult,
  RestorePublication,
  RestoreRefusalReason,
  RestoreResult,
} from "./payload";
