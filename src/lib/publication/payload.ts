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
import type { PainItemState, PainReviewGap } from "./journey-pain-review";
import type {
  QualitativeCategorySet,
  QualitativeReviewState,
} from "./qualitative-signoff";
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
  /** The qualitative categories this document publishes, and who read them. */
  qualitative: QualitativeReviewPanel;
  /**
   * The journey pain review: what a person has decided, and what is left.
   *
   * A SUMMARY, not the queue. The editor is its own screen and loads the items
   * itself; this panel carries the counts and the closed gap codes the review
   * screen needs to say «faltan 12» and to link there. Keeping the whole queue
   * out of this payload keeps the review screen's own contract small and means
   * a curated phrase is loaded exactly where somebody is editing it.
   */
  pain: PainReviewSummary;
};

/**
 * How far the journey pain review has got, as the publication screen says it.
 *
 * FINISHED FACTS ONLY: four counts the server made, a closed list of gap codes,
 * and one boolean. No phrase, no token, no source wording — the review screen
 * links to the editor rather than reproducing it, and a curated phrase belongs
 * on the screen where somebody is deciding about it.
 */
export type PainReviewSummary = {
  applicable: boolean;
  complete: boolean;
  gaps: readonly PainReviewGap[];
  counts: Record<PainItemState, number>;
};

/**
 * WHAT A REVIEWER IS SHOWN ABOUT THE QUALITATIVE CATEGORIES, AND SIGNS OFF ON.
 *
 * The words themselves, every visible block that draws them, where the coding
 * came from, and the state of the review. Not a group label and a permanent
 * «pending», which is what this replaced.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * NO DIGEST CROSSES. IT USED TO, AND THAT WAS THE DEFECT.
 *
 * The first version of this panel carried the qualitative evidence digest and
 * the browser echoed it back to sign off. The argument for it was that the
 * digest covers only category labels a client is already shown, so it discloses
 * nothing — which is true, and is not the point. The point is that a sign-off
 * recorded against a value the browser supplied is a sign-off whose subject the
 * browser chose, and «the server recomputes and compares» does not change that:
 * a comparison against an echo is the client's memory checked against itself.
 * The browser-boundary gate had to be NARROWED to admit that one value, and a
 * rule with an exception is a rule with a place to hide a second one.
 *
 * SO THE DIGEST IS GONE FROM THE WIRE AND FROM THIS TYPE. There is no field for
 * it, so there is nothing to echo. The server reloads the draft, recomputes the
 * digest from the study's own current results, and records the sign-off against
 * THAT — the value it derived, never a value it was handed.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT DOES CROSS IS AN OPAQUE GROUP IDENTITY, AND WHAT IT IS FOR.
 *
 * A sign-off still has to be about the groups that were on screen, so each
 * group carries a short opaque `token`. It is derived from that group's own
 * label, coding and category list — every one of which is printed in full on
 * the page beneath it, so it discloses strictly nothing — and it MOVES when
 * those words move.
 *
 * It is an ASSERTION THE SERVER CHECKS, never a value the server keeps. The
 * server mints the same tokens from what it just read; a submitted set that
 * does not match exactly means the categories changed between the reading and
 * the click, and the sign-off is refused rather than recorded. Nothing derived
 * from a submitted token is ever stored, compared against storage, or written
 * into a publication record.
 */
export type QualitativeReviewGroup = QualitativeCategorySet & {
  /**
   * The opaque identity of this group's exact words. Echoed to sign off.
   *
   * Short, base32, and never hexadecimal — so no scan of a rendered page can
   * confuse it with a storage digest, and neither can a person reading the
   * page's source.
   */
  token: string;
};

export type QualitativeReviewPanel = {
  state: QualitativeReviewState;
  /** When the sign-off in force was recorded. Null when there is none. */
  reviewedAt: string | null;
  /** One entry per bound group: its words, the blocks that draw them, its token. */
  groups: readonly QualitativeReviewGroup[];
};

/**
 * WHAT THIS PAYLOAD DELIBERATELY DOES NOT CARRY, AND WHY IT LOST A FIELD.
 *
 * It had a `publishable: boolean` — "no blockers" — and the review screen never
 * read it: the screen derives the same fact from `blockers.length` because it
 * also has to derive «and every required acknowledgement is ticked», which the
 * server cannot know. Two sources of truth for one thing is one source of truth
 * and one thing that can disagree with it, and the one that disagrees is always
 * the one nobody is looking at. The screen computes it; the server and the
 * database each refuse independently.
 */

export type PublicationReview =
  | { ok: true; payload: PublicationReviewPayload }
  | { ok: false; unavailable: PublicationUnavailable };

/* -------------------------------------------------------------------------- */
/* the review preview, under a reader's own selection                          */
/* -------------------------------------------------------------------------- */

/**
 * WHAT COMES BACK WHEN A REVIEWER OPERATES A FILTER IN THE PREVIEW.
 *
 * A render model, and the count of blocks a client would see under that
 * selection. Nothing else — no document, no digest, no binding, no identity,
 * and no draft revision, because operating a filter does not change which
 * revision is under review.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * A SELECTION IN THE PREVIEW WRITES NOTHING, AND THAT IS ENFORCED BY SHAPE.
 *
 * The action that produces this reads the STORED draft, resolves it under the
 * selection, and returns. It has no insert, no update, no upsert, no delete, no
 * RPC and no `revalidatePath`; the draft's revision, its bytes and its digest
 * are the same after as before, and the publication snapshot — which does not
 * exist yet at review time — is not touched at all. A reviewer moving a
 * checkbox is a reader moving a checkbox: ephemeral, private to the request,
 * and gone when the screen closes.
 *
 * And publishing still ignores it entirely. `publishStoredPresentation`
 * resolves the stored draft under `EMPTY_VIEWER_SELECTION`, so what is snapshot
 * is the unfiltered document whatever the reviewer happened to be looking at.
 */
export type PublicationPreviewPayload = {
  model: PresentationRenderModel;
  /** Blocks a client would see under this selection. Counted on the server. */
  visibleBlockCount: number;
};

export type PublicationPreviewResult =
  | { ok: true; payload: PublicationPreviewPayload }
  | { ok: false; unavailable: PublicationUnavailable };

/**
 * The preview action, as the review surface names it.
 *
 * The selection travels as a JSON STRING for the same reason the composer's
 * does: a Server Action's arguments are deserialized before anything validates
 * them, and a string is the one shape that cannot arrive as a half-parsed
 * object. It is capped, parsed inside a try/catch, and then validated against
 * what this document and this study actually offer.
 */
export type PreviewPublicationUnderSelection = (
  studyId: string,
  viewerJson: string,
) => Promise<PublicationPreviewResult>;

/* -------------------------------------------------------------------------- */
/* recording a qualitative sign-off                                            */
/* -------------------------------------------------------------------------- */

export type SignOffRefusalReason =
  | "not_authorized"
  | "invalid_scope"
  /** The categories changed between the reading and the click. */
  | "evidence_moved"
  /** The draft moved between the screen and the click. */
  | "draft_moved"
  | "storage_refused";

export type SignOffResult =
  | {
      ok: true;
      /** ISO-8601 UTC of the sign-off now in force. */
      reviewedAt: string;
      /** True when these exact words had already been signed off. */
      replayed: boolean;
    }
  | { ok: false; reason: SignOffRefusalReason; detail: string };

/**
 * Record that a person read one exact set of categories.
 *
 * WHAT IT TAKES IS AN INTENT AND A LIST OF OPAQUE TOKENS, and nothing else.
 * The draft revision names the review the person was doing; the tokens name the
 * groups they were looking at. Both are checked against what the server reads
 * for itself, and the digest the record is written against is derived there —
 * there is no parameter by which a caller could supply one.
 */
export type RecordQualitativeSignOff = (
  studyId: string,
  reviewedDraftRevision: number,
  groupTokens: readonly string[],
) => Promise<SignOffResult>;

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
