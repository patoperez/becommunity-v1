/**
 * WHAT THE REVIEW SCREEN RECEIVES, AND WHAT IT MAY SEND BACK.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE BROWSER NEVER HOLDS THE THING BEING PUBLISHED.
 *
 * The obvious design is the wrong one: hand the screen the document, the render
 * model, the digests and the identity, and let it post them back to publish. It
 * would work, and it would put a tenant uuid, a package key, a plan fingerprint
 * and two SHA-256 digests in a browser — every one of them internal, and the
 * whole set exactly what a review surface is forbidden to expose.
 *
 * So the publish action takes FOUR NUMBERS AND A LIST OF WORDS: which draft
 * revision was reviewed, which publication version was current when the screen
 * was drawn, which warnings were acknowledged, and one idempotency key. The
 * server re-reads the draft, rebuilds the registry from the study's current
 * canonical results, re-runs the whole preflight and only then publishes. The
 * browser cannot smuggle a document in, because there is no field for one; and
 * a review that has gone stale is refused by the numbers rather than trusted.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * A VERSION IS A NUMBER A PERSON CAN SAY OUT LOUD.
 *
 * Restoration names the publication by its VERSION, not by its row id, for the
 * same reason. The server maps the version to the snapshot, inside the study's
 * own scope, so a number from another study's history cannot reach a row.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THESE TYPES LIVE ON THE CLIENT-SAFE SIDE.
 *
 * The same reason `src/lib/composer/payload.ts` gives: a `"use client"` module
 * has to name the type of what it receives and the type of the action it is
 * handed, and importing either from the server-only module that produces them
 * would put a static import path to the canonical read layer into the browser's
 * import graph — which a boundary gate refuses, and is right to.
 */

import type { PresentationRenderModel } from "../presentation";
import type {
  CurrentPublicationSummary,
  PageInventoryEntry,
  PublicationBlocker,
  PublicationHistoryEntry,
  PublicationWarning,
  PublicationWarningCode,
  StructuralDifference,
} from "./contract";

/** Why there is no review to show, in a closed vocabulary. */
export type PublicationUnavailableReason =
  | "no_canonical_package"
  | "multiple_canonical_packages"
  | "specification_not_registered"
  | "canonical_read_refused"
  | "no_stored_draft"
  | "review_refused";

export type PublicationUnavailable = {
  reason: PublicationUnavailableReason;
  /** One sentence for an internal reviewer. Never a stack, never a key. */
  detail: string;
  /** Typed issues only — code and path. The contract's own prose stays on the server. */
  issues?: { code: string; path: string }[];
};

/**
 * Everything the review screen is given.
 *
 * There is no document here, no digest, no binding, no package identity, no
 * tenant and no study uuid. `model` is the public render model — finished
 * values the client would see — which is the whole point of showing a preview:
 * a reviewer approves what a reader gets.
 */
export type PublicationReviewPayload = {
  /** The exact draft revision under review. Shown, and sent back on publish. */
  draftRevision: number;
  /** When that revision was saved. ISO-8601 UTC; the screen formats it. */
  draftSavedAt: string;
  pageCount: number;
  blockCount: number;
  /** How many blocks a client would see something in. */
  visibleBlockCount: number;
  inventory: readonly PageInventoryEntry[];
  /** The client-visible preview of the draft under review. */
  model: PresentationRenderModel;
  blockers: readonly PublicationBlocker[];
  warnings: readonly PublicationWarning[];
  /** Which warnings must be ticked before the publish control works. */
  required: readonly PublicationWarningCode[];
  /** What the client is served right now, or null when nothing is published. */
  current: CurrentPublicationSummary | null;
  /** How this draft differs from what is published. Null when nothing is. */
  difference: StructuralDifference | null;
  history: readonly PublicationHistoryEntry[];
  /**
   * True when a publication could succeed with every required acknowledgement
   * ticked. The screen still disables the control until they ARE ticked, and the
   * server and the database each refuse independently.
   */
  publishable: boolean;
};

export type PublicationReview =
  | { ok: true; payload: PublicationReviewPayload }
  | { ok: false; unavailable: PublicationUnavailable };

/* -------------------------------------------------------------------------- */
/* publishing                                                                  */
/* -------------------------------------------------------------------------- */

/** Why a publication did not happen, in a CLOSED vocabulary the screen switches on. */
export type PublishRefusalReason =
  /** No session, not an internal role, or not this study's tenant. */
  | "not_authorized"
  /** The study id is not a uuid, or names no study. */
  | "invalid_scope"
  /** The preflight found blockers, or a required acknowledgement was missing. */
  | "preflight_refused"
  /**
   * The draft or the current publication moved while the screen was open.
   *
   * Separate from every other refusal and always will be: it is the only one
   * where nothing is wrong and the answer is simply "look again". Folding it
   * into a general failure would put a retry in front of somebody whose retry
   * would publish a document they have not seen.
   */
  | "conflict"
  /** The database refused for a reason it named. */
  | "storage_refused"
  /** The round trip did not complete, so whether it was applied is unknown. */
  | "transport_failed";

export type PublishResult =
  | {
      ok: true;
      /** The version this publication produced — or, on a replay, the original. */
      version: number;
      /** The version a client is served NOW. Differs from `version` only on a replay. */
      currentVersion: number;
      /** The version this one replaced, or null for a first publication. */
      replacedVersion: number | null;
      replayed: boolean;
    }
  | {
      ok: false;
      reason: PublishRefusalReason;
      detail: string;
      /** Present on `preflight_refused`: the blockers, so the screen can list them. */
      blockers?: readonly PublicationBlocker[];
      /** Present on `preflight_refused`: acknowledgements still missing. */
      unacknowledged?: readonly PublicationWarningCode[];
    };

/** The publish, as the SCREEN sees it. It knows nothing about what is behind it. */
export type PublishPresentation = (
  studyId: string,
  reviewedDraftRevision: number,
  expectedCurrentVersion: number | null,
  acknowledged: readonly string[],
  idempotencyKey: string,
) => Promise<PublishResult>;

/* -------------------------------------------------------------------------- */
/* restoring                                                                   */
/* -------------------------------------------------------------------------- */

export type RestoreRefusalReason =
  | "not_authorized"
  | "invalid_scope"
  /** The reason box was empty, or the version names no publication of this study. */
  | "restore_refused"
  /** Somebody saved the draft while this screen was open. */
  | "conflict"
  | "storage_refused"
  | "transport_failed";

export type RestoreResult =
  | {
      ok: true;
      /** The publication version that was brought back. */
      version: number;
      /** The NEW draft revision it created. Nothing was published by this. */
      draftRevision: number;
      replayed: boolean;
    }
  | { ok: false; reason: RestoreRefusalReason; detail: string; storedRevision?: number };

/**
 * The restore, as the SCREEN sees it.
 *
 * It takes the draft revision the screen believes is current, because a restore
 * REPLACES the working draft — and doing that over somebody else's unsaved-then-
 * saved work, without saying so, is the one outcome this whole lifecycle exists
 * to prevent.
 */
export type RestorePublication = (
  studyId: string,
  version: number,
  expectedDraftRevision: number | null,
  reason: string,
  idempotencyKey: string,
) => Promise<RestoreResult>;
