/**
 * WHAT THE COMPOSER SCREEN RECEIVES — declared once, on the client-safe side.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THESE TYPES LIVE HERE AND NOT BESIDE THE LOADER THAT PRODUCES THEM.
 *
 * The natural home for `ComposerPayload` is the server-only module that builds
 * one. It cannot be: the client component that RECEIVES a payload has to name
 * its type, and importing it from there would give a `"use client"` file a
 * static import path to `@/lib/canonical-source`, which the shadow-boundary
 * gate refuses outright and is right to.
 *
 * The same is true of the Server Action's return type. A client component
 * calling an action normally imports it, and that import is a real edge in the
 * graph — so the action is passed DOWN as a prop from the server page instead,
 * and the prop's type is declared here, where a browser may see it.
 *
 * Declaring the types on the safe side and having the server module import them
 * is the only arrangement where there is ONE declaration. The alternative — a
 * client-side mirror of a server-side type — is two declarations that agree
 * until the day they do not, and the day they do not is the day a field the
 * server stopped sending is still being read.
 *
 * Everything named here is already client-safe on its own terms: an authorable
 * document, the catalogue projection, a render model of finished values, and
 * closed strings. There is no address, no registry source, no row and no
 * identifier of a person anywhere in this file.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import type {
  PresentationCatalog,
  PresentationDocument,
  PresentationRenderModel,
  ViewerSelection,
} from "../presentation";

/** Which starting layout was chosen, and why. Internal chrome text. */
export type BlueprintChoice = {
  id: string;
  label: string;
  /** A sentence for a reviewer. Never shown to a client. */
  because: string;
};

/** Everything the composer screen receives, named in rather than filtered out. */
export type ComposerPayload = {
  /** Bound. An unbound document cannot resolve, so one never crosses. */
  document: PresentationDocument;
  /** The registry minus its address map and its database scope. */
  catalog: PresentationCatalog;
  /** Already-final values, already formatted by the canonical layer. */
  model: PresentationRenderModel;
  blueprint: BlueprintChoice;
};

/** Why there is no composer for this study, in a closed vocabulary. */
export type ComposerUnavailableReason =
  | "no_canonical_package"
  | "multiple_canonical_packages"
  | "specification_not_registered"
  | "canonical_read_refused"
  | "nothing_to_present"
  | "presentation_unresolved";

export type ComposerUnavailable = {
  reason: ComposerUnavailableReason;
  /** One sentence for an internal reviewer. Never a stack, never a key. */
  detail: string;
  /** Typed issues only — code and path. The contract's own prose stays server-side. */
  issues?: { code: string; path: string }[];
};

export type ComposerWorkspace =
  | {
      ok: true;
      payload: ComposerPayload;
      /**
       * Unit 6B.3A. What the store holds for this study, decided by the SERVER.
       *
       * The screen must not infer "is this saved" from the document it was
       * handed: a restored draft and a freshly built blueprint are the same
       * shape, and guessing wrong in the safe-looking direction is what lets an
       * author close a tab on an hour of work.
       */
      persistence: PersistenceState;
    }
  | { ok: false; unavailable: ComposerUnavailable };

/**
 * What the explicit preview refresh answers with. A model, or named issues.
 *
 * `selection` is the viewer selection the model was ACTUALLY resolved under,
 * normalized by the server. It is echoed rather than assumed so that a model
 * and the controls beside it can be proved to describe the same population —
 * the state this unit exists to keep honest — and so that a future link can be
 * built from what the server accepted rather than from what the browser asked
 * for.
 */
export type PreviewResult =
  | {
      ok: true;
      model: PresentationRenderModel;
      document: PresentationDocument;
      selection: ViewerSelection;
    }
  | { ok: false; unavailable: ComposerUnavailable };

/**
 * The shape of the refresh, as the SCREEN sees it.
 *
 * The screen is handed a function and knows nothing about what is behind it.
 * That is what keeps the composer surface testable without a database and
 * unable to reach one by accident.
 *
 * `viewerJson` carries the reader's selection. It is a SEPARATE argument from
 * the document on purpose: a selection is not configuration, it is never
 * stored, and putting it inside the document would be the one mistake this
 * unit's architecture exists to prevent — the strict v4 schema would refuse it
 * anyway, which is the point.
 */
export type RefreshPreview = (
  studyId: string,
  documentJson: string,
  viewerJson: string,
) => Promise<PreviewResult>;

/* -------------------------------------------------------------------------- */
/* PERSISTENCE — Unit 6B.3A                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Why a save did not happen, in a CLOSED vocabulary the screen switches on.
 *
 * `conflict` is separate from every other refusal and always will be. It is the
 * only one where the operator's document is still good and the STORED one has
 * moved on — so it is the only one that offers to load the stored version, and
 * the only one that must never resolve itself by writing. Folding it into a
 * general "no pudimos guardar" would put a retry button in front of a person
 * whose retry would destroy somebody else's work.
 *
 * `transport_failed` is separate from `storage_refused` for the opposite
 * reason: a refusal is an answer and a timeout is not. A request that never
 * completed may still have been applied, which is exactly why the save carries
 * an idempotency key and why a retry under the same key is safe.
 */
export type SaveRefusalReason =
  /** No session, not an internal role, or not this study's tenant. */
  | "not_authorized"
  /** The study id is not a uuid, or names no study. */
  | "invalid_scope"
  /** The document did not validate as a canonical presentation, version four. */
  | "document_refused"
  /** A newer revision is stored. The local document is untouched. */
  | "conflict"
  /** The database refused for a reason it named. */
  | "storage_refused"
  /** The round trip did not complete, so whether it was applied is unknown. */
  | "transport_failed";

/**
 * What a save answers with.
 *
 * `revision` on success is the revision the STORE now holds, which the next
 * save must present as its expected revision. `replayed` says the idempotency
 * key had already been recorded — the save was a no-op and the revision is the
 * one the first attempt produced.
 *
 * On a conflict, `storedRevision` is what the store holds now. It is offered so
 * the screen can say how far behind the operator is; it is NOT enough to save
 * with, because saving against it would overwrite the newer document.
 */
export type SaveResult =
  | {
      ok: true;
      /** The revision THIS save produced — or, on a replay, the one it produced originally. */
      revision: number;
      /**
       * Where the row is NOW.
       *
       * Equal to `revision` on a real write. On a REPLAY it can be higher:
       * the key's save was applied, and somebody has saved over it since. A
       * caller that ignored this would report a document stored while the store
       * held somebody else's.
       */
      currentRevision: number;
      created: boolean;
      replayed: boolean;
    }
  | {
      ok: false;
      reason: SaveRefusalReason;
      /** One sentence in Spanish for an internal operator. Never a stack, never a key. */
      detail: string;
      /** Typed document issues only — code and path — when the reason is `document_refused`. */
      issues?: { code: string; path: string }[];
      /** Present only on `conflict`. */
      storedRevision?: number;
    };

/**
 * What a deliberate reload answers with.
 *
 * There is no stored draft for most studies, and that is not a failure — it is
 * the ordinary first visit. `absent` says so without inventing an empty
 * document, because an empty document saved over a real one is data loss
 * wearing the clothes of a fresh start.
 */
export type LoadResult =
  | { ok: true; present: true; document: PresentationDocument; revision: number; model: PresentationRenderModel }
  | { ok: true; present: false }
  | { ok: false; unavailable: ComposerUnavailable };

/** The save, as the SCREEN sees it. The screen knows nothing about what is behind it. */
export type SaveDraft = (
  studyId: string,
  documentJson: string,
  expectedRevision: number | null,
  idempotencyKey: string,
) => Promise<SaveResult>;

/** The deliberate reload, as the SCREEN sees it. */
export type LoadDraft = (studyId: string) => Promise<LoadResult>;

/**
 * What the composer screen is told about storage when it first renders.
 *
 * `revision` is null when no draft is stored yet, which is what the first save
 * must present as its expected revision. `document` being the STORED one rather
 * than the blueprint is what makes a reload restore work instead of discarding
 * it — the page decides which to hand over, and the screen does not guess.
 */
export type PersistenceState = {
  /** The revision the store holds, or null when nothing is stored. */
  revision: number | null;
  /** Whether the document the screen opened with came from the store. */
  restored: boolean;
};
