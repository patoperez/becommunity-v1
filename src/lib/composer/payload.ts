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
  | { ok: true; payload: ComposerPayload }
  | { ok: false; unavailable: ComposerUnavailable };

/** What the explicit preview refresh answers with. A model, or named issues. */
export type PreviewResult =
  | { ok: true; model: PresentationRenderModel; document: PresentationDocument }
  | { ok: false; unavailable: ComposerUnavailable };

/**
 * The shape of the refresh, as the SCREEN sees it.
 *
 * The screen is handed a function and knows nothing about what is behind it.
 * That is what keeps the composer surface testable without a database and
 * unable to reach one by accident.
 */
export type RefreshPreview = (studyId: string, documentJson: string) => Promise<PreviewResult>;
