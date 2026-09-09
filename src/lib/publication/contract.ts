/**
 * THE PUBLICATION CONTRACT — closed blockers, closed warnings, and one verdict.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY EVERY CODE IS CLOSED.
 *
 * A review screen that said «no se puede publicar» and nothing else would be a
 * screen nobody could act on, and a gate asserting "preflight failed" passes
 * just as happily when it fails for the wrong reason. So a blocker is a member
 * of a CLOSED union, its Spanish sentence is written once, beside it, and a gate
 * can say "this input is refused as `draft_revision_moved`, and not as
 * `binding_drift`" — which is the difference between a proof and a coincidence.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * A BLOCKER AND A WARNING ARE DIFFERENT KINDS OF FACT, AND THE LINE IS DRAWN
 * ONCE, HERE.
 *
 * A BLOCKER says the publication would be WRONG: invalid, unresolved, stale,
 * unbound, unauthorized, or not reproducible. There is no acknowledgement that
 * makes one of those acceptable, so none is offered — a checkbox beside "this
 * document no longer matches this study's results" would be a way to publish
 * numbers nobody stands behind.
 *
 * A WARNING says the publication would be INCOMPLETE, or would show a client
 * less than the study holds. Those are decisions, and a decision is a person's
 * to make — so the ones that change what a client sees require an explicit
 * acknowledgement, and the ones that are merely worth knowing do not.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT IS DELIBERATELY NOT HERE.
 *
 * NO THRESHOLD. There is no number in this file, no comparison against a base,
 * and no rule about a small sample. `docs/CANONICAL_PRESENTATION_MODEL.md` §7 is
 * unambiguous: the canonical layer suppresses nothing, the system default is
 * `show_all`, and the only way a result is annotated or withheld is an AUTHORED
 * policy carrying an author and a stated reason. So the two sample warnings
 * below are derived from `RenderBlock.sampleDisplay` — the OUTCOME the resolver
 * already decided from that authored policy — and can never fire for a document
 * whose policy is `show_all`, however small its bases are. A preflight that
 * counted respondents and warned below some number would be inventing the
 * suppression rule this product spent a unit removing.
 *
 * NO METHODOLOGY. Nothing here decides whether a result is right, only whether
 * the document that names it still describes this study.
 */

import type { PresentationRenderModel } from "../presentation";

/* -------------------------------------------------------------------------- */
/* the one fact about the surface a client reads                               */
/* -------------------------------------------------------------------------- */

/**
 * DOES THE CLIENT'S OWN READING SURFACE HAND THE RENDERER LIVE FILTER CONTROLS?
 *
 * It does. Unit 6B.2 turned the panels into working viewer controls, and a
 * working control is a finished part of the deliverable rather than an
 * unfinished edge — `docs/CURRENT_STATE.md` §"Unit 6B.2" and `FilterControls`
 * both say so.
 *
 * It is declared ONCE, here, because three places have to agree about it and
 * two of them used to disagree in silence:
 *
 *   - the review preview MOUNTS the renderer with viewer controls, so what a
 *     reviewer approves is the screen a client gets, panels and all;
 *   - the inventory and the preflight COUNT with it, so «los ve el cliente»
 *     counts the same blocks the preview drew.
 *
 * A gate renders the real component to real markup and compares the two. If the
 * client route ever ships without live filtering, this constant is the one line
 * that changes and every count follows it.
 */
export const CLIENT_SURFACE_IS_LIVE = true;

/* -------------------------------------------------------------------------- */
/* blockers                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Every condition under which a canonical presentation may not be published.
 *
 * Grouped by the six families the lifecycle names, so a reader can check the
 * list against the requirement rather than against their memory of it.
 */
export type PublicationBlockerCode =
  /* -------- there are no canonical results to publish against -------- */
  | "no_canonical_package"
  | "multiple_canonical_packages"
  | "specification_not_registered"
  | "canonical_read_refused"

  /* -------- there is nothing, or nothing readable, to publish -------- */
  /** The study has never saved a canonical draft. */
  | "no_stored_draft"
  /** A row exists and will not decode: corrupt, out of scope, or written around the encoder. */
  | "stored_draft_undecodable"

  /* -------- INVALID -------- */
  /** The stored document does not validate as a canonical schema-version-four presentation. */
  | "document_invalid"
  /** The document carries no binding, so it describes no study and could never resolve. */
  | "document_unbound"

  /* -------- UNRESOLVED -------- */
  /** The document does not resolve against this study's current canonical results. */
  | "document_unresolved"
  /**
   * A block resolved to the contract's own `unresolved` state.
   *
   * Different from a block that is merely `unavailable`. Unavailable means the
   * study does not carry that measurement and absence renders as nothing, which
   * is contract C11 working as designed. UNRESOLVED means the authorities
   * disagree, or none states the relationship — an open question. Publishing a
   * report containing an open question presents it as settled.
   */
  | "block_unresolved"

  /* -------- STALE -------- */
  /** The draft revision under review is not the one the store now holds. */
  | "draft_revision_moved"
  /** The revision matches and the bytes do not: something wrote around the encoder. */
  | "draft_digest_moved"

  /* -------- DRIFT -------- */
  /**
   * The results this document names are no longer the study's results.
   *
   * THREE CODES AND NOT SEVEN, AND THE FIRST DRAFT OF THIS UNION HAD SEVEN. It
   * also had `results_contract_drift`, `calculation_version_drift`,
   * `package_identity_drift` and `plan_fingerprint_drift` — and not one of them
   * could ever be raised, because the stored draft carries only two identity
   * columns and every one of those four is INSIDE the binding digest rather than
   * beside it. A closed union whose members cannot occur is not a stronger
   * contract; it is four sentences no reviewer will ever read and four
   * assertions no gate can make fail. They live on as the ATTRIBUTION of this
   * blocker, built from the last publication's own pinned columns, and as the
   * informational warning that says the evidence moved.
   */
  | "binding_drift"
  /** The document was authored against a different presentation vocabulary. */
  | "registry_version_drift"
  /** The stored row belongs to another study. Refused before anything else reads it. */
  | "study_scope_drift"

  /* -------- NON-REPRODUCIBLE -------- */
  /**
   * Two resolutions of the same document over the same read produced different
   * bytes.
   *
   * It cannot happen — the resolver is pure and the serialization is
   * deterministic — which is exactly why it is checked rather than assumed. A
   * publication is a promise that what was approved is what will be served, and
   * a promise nobody tests is a hope.
   */
  | "render_model_not_reproducible"

  /* -------- REQUIRED CONTENT THE AUTHOR DECLARED, AND IS MISSING -------- */
  /**
   * A block the author marked as required content shows a client nothing.
   *
   * THE ONE BLOCKER A PERSON CAN CLEAR BY EDITING THE LAYOUT, and it is
   * deliberately not acknowledgeable. `configuration_required` stays a
   * warning for every block nobody marked: what nobody has finished renders
   * as nothing (C11), and publishing that is a decision. But the approved
   * north-star for a study is not a menu — a layout that DECLARES the journey
   * pain cloud and delivers a page without it is a different experience from
   * the one that was signed off, and «entiendo que desaparecerá» is not the
   * person who signed it off saying so.
   *
   * The remedies are supplying the content or removing the block, both of
   * which are in the sentence. Neither is a checkbox.
   */
  | "required_content_missing"

  /* -------- UNAUTHORIZED, and the state of the world -------- */
  | "not_authorized"
  /** Somebody published while this review was open. */
  | "publication_pointer_moved";

/* -------------------------------------------------------------------------- */
/* warnings                                                                    */
/* -------------------------------------------------------------------------- */

/** Every condition worth telling a reviewer that does not stop a publication. */
export type PublicationWarningCode =
  /**
   * Blocks the contract says a human or a configuration must fill, and nobody
   * has. ACKNOWLEDGEMENT REQUIRED.
   *
   * Contract C11: what has not been finished renders as NOTHING on the client
   * side — no placeholder, no empty card, no heading. So publishing this is a
   * decision to show the client less than the layout describes, and a person has
   * to make it knowingly. It is emphatically not a blocker: the approved
   * blueprint deliberately declares the curated pain-cloud slot and leaves it
   * empty, and a rule that blocked on it would make the approved layout
   * unpublishable forever.
   */
  | "configuration_required_blocks"
  /**
   * Curated qualitative categories nobody at Be Community has reviewed.
   * ACKNOWLEDGEMENT REQUIRED.
   *
   * `src/lib/results/qualitative.ts` states the rule and hands the decision
   * here in as many words: the categories are the SOURCE's own coding, not a
   * review artefact, "so the publication boundary must decide about them before
   * showing them to a client". Deciding is what an acknowledgement is. Blocking
   * outright would not be deciding — it would be refusing forever.
   */
  | "qualitative_review_pending"
  /**
   * An AUTHORED sample policy withheld a result. ACKNOWLEDGEMENT REQUIRED.
   *
   * Somebody wrote a `hide_below` rule with their name and a reason, and it
   * fired. The client will not see those numbers. Nothing here decided that and
   * nothing here can: with the default `show_all` this warning cannot occur.
   */
  | "withheld_by_sample_policy"
  /** An AUTHORED policy annotated a result with its caption. Informational. */
  | "annotated_by_sample_policy"
  /**
   * The contract says the study does not carry these measurements.
   * Informational: absence renders as nothing, which is C11 working.
   */
  | "unavailable_blocks"
  /** Blocks the author marked not visible. They resolve and are not drawn. */
  | "hidden_blocks"
  /**
   * Nothing a client would see. ACKNOWLEDGEMENT REQUIRED.
   *
   * A document whose every block is hidden, withheld or waiting for content
   * publishes a page with nothing on it. That is a valid document and a strange
   * deliverable, so it is a decision rather than a defect.
   */
  | "nothing_visible"
  /** This would be the study's first publication. Informational. */
  | "first_publication"
  /** The structure differs from what is published now. Informational. */
  | "structure_changed"
  /**
   * The study's evidence, projection, calculations or results contract moved
   * since the current publication was made. Informational.
   *
   * This is not a reason to refuse — it is the ordinary reason to publish again.
   * It exists so a reviewer looking at «versión 2, publicada el …» is told the
   * numbers behind it are no longer the study's current numbers, which is
   * precisely the fact a stored render model would otherwise hide.
   */
  | "evidence_changed_since_publication"
  /**
   * A filter panel the author put on the page that a client will never receive.
   * ACKNOWLEDGEMENT REQUIRED.
   *
   * A panel no block is connected to moves no figure, so the renderer draws it
   * for nobody — C11 again: an unfinished edge is not a client's business. The
   * consequence is what the sentence says: somebody authored a control and the
   * client gets a page without it. That is a decision, and it used to be
   * invisible on both halves of this screen at once — the inventory counted the
   * panel as visible and the preview did not draw it.
   */
  | "inoperable_filter_panels"
  /**
   * A filter dimension whose options include ones only ONE person carries.
   * ACKNOWLEDGEMENT REQUIRED.
   *
   * NOT A THRESHOLD, AND THE DIFFERENCE IS THE WHOLE REASON THIS CODE EXISTS.
   * There is still no number in this file: "one person" is not a chosen cut-off
   * below which something is hidden, it is the definition of a group of one —
   * an option a reader can select to isolate a single identifiable individual.
   * Nothing is suppressed, no sample policy changes, `show_all` stays the
   * default, and every option keeps being offered. What happens is that the
   * fact is SAID, by dimension, and the operator decides: take the dimension
   * out of the panel in Construcción, or keep it and say so.
   *
   * The alternative — hiding those options automatically — would be this
   * software making a privacy decision on the client's behalf, which is
   * precisely what this product does not do.
   */
  | "granular_filter_dimensions";

/** Which warnings a person has to tick before the publish control works. */
export const WARNINGS_REQUIRING_ACKNOWLEDGEMENT: readonly PublicationWarningCode[] = [
  "configuration_required_blocks",
  "qualitative_review_pending",
  "withheld_by_sample_policy",
  "nothing_visible",
  "inoperable_filter_panels",
  "granular_filter_dimensions",
];

export function warningRequiresAcknowledgement(code: PublicationWarningCode): boolean {
  return WARNINGS_REQUIRING_ACKNOWLEDGEMENT.includes(code);
}

/* -------------------------------------------------------------------------- */
/* findings                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * One finding, as a reviewer reads it.
 *
 * `detail` is plain Spanish written for the consultant who has to act on it.
 * `where` names the affected pages and blocks BY THEIR AUTHORED TITLES, never by
 * an id, a handle or a canonical key — a review screen that said
 * «bloque-cri-2 falla» would be asking a person to read storage.
 */
export type PublicationFinding<Code extends string> = {
  code: Code;
  /** One sentence naming what is wrong, or what the reviewer is deciding. */
  detail: string;
  /** Authored titles of the pages and blocks concerned. Possibly empty. */
  where: readonly string[];
};

export type PublicationBlocker = PublicationFinding<PublicationBlockerCode>;
export type PublicationWarning = PublicationFinding<PublicationWarningCode> & {
  requiresAcknowledgement: boolean;
};

/* -------------------------------------------------------------------------- */
/* identity                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Everything a publication is pinned to. SERVER-ONLY.
 *
 * `tenantId` and `studyId` are database identifiers and the reason this type
 * never crosses to a browser. The preflight compares an identity built from the
 * CURRENT canonical results against the one the stored draft was authored
 * against, field by field, so a refusal names which one moved.
 */
export type PublicationIdentity = {
  tenantId: string;
  studyId: string;
  registryVersion: string;
  bindingFingerprint: string;
  resultsContractVersion: string;
  calculationVersion: string;
  specId: string;
  mappingVersion: number;
  packageIdempotencyKey: string;
  planFingerprint: string;
};

/* -------------------------------------------------------------------------- */
/* the inventory a reviewer reads                                              */
/* -------------------------------------------------------------------------- */

/** What one block is, in words. No id, no handle, no semantic enum. */
export type BlockInventoryEntry = {
  /** The author's own title, or a stated absence. Never an id. */
  title: string;
  /** «Resultado», «Panel de filtros», «Texto», «Recorrido». */
  kind: string;
  /** «Se dibuja», «Oculto», «Sin contenido», «Reservado por política». */
  state: string;
  /** True when a client would see something here. */
  visibleToClient: boolean;
};

export type PageInventoryEntry = {
  title: string;
  blocks: readonly BlockInventoryEntry[];
};

/* -------------------------------------------------------------------------- */
/* the structural difference                                                   */
/* -------------------------------------------------------------------------- */

/** One line of «qué cambió respecto a lo publicado». */
export type StructuralChange = {
  kind: "page_added" | "page_removed" | "page_renamed" | "block_added" | "block_removed" | "block_changed";
  /** A finished Spanish sentence. Built from authored titles only. */
  sentence: string;
};

export type StructuralDifference = {
  /** True when the two structures are the same. */
  identical: boolean;
  changes: readonly StructuralChange[];
};

/* -------------------------------------------------------------------------- */
/* the verdict                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * The result of a preflight.
 *
 * `unacknowledged` is the subset of required acknowledgements the reviewer has
 * not given. `canPublish` is true only when there are no blockers AND that
 * subset is empty — and the same two conditions are re-asserted by the database,
 * which refuses a publication whose caller reports either.
 */
export type PublicationPreflight = {
  blockers: readonly PublicationBlocker[];
  warnings: readonly PublicationWarning[];
  /** Codes a person must tick, whether or not they have. */
  required: readonly PublicationWarningCode[];
  /** Of those, the ones still missing. */
  unacknowledged: readonly PublicationWarningCode[];
  canPublish: boolean;
};

/* -------------------------------------------------------------------------- */
/* what the review screen receives                                             */
/* -------------------------------------------------------------------------- */

/** One entry of the publication history, as a reviewer reads it. */
export type PublicationHistoryEntry = {
  /** The publication version. A number a person can say out loud. */
  version: number;
  /** «Publicada» or «Restaurada al borrador». */
  action: "published" | "restored";
  /** ISO-8601 UTC. Formatted for display by the surface. */
  occurredAt: string;
  /** The version this one replaced, when it replaced one. */
  replacedVersion: number | null;
  /** The draft revision a restoration created. */
  draftRevision: number | null;
  /** The internal note somebody wrote. Bounded, internal, never client-facing. */
  note: string | null;
  /** True when this is the version a client is served right now. */
  current: boolean;
};

/** What a client would be served. No audit field is reachable from here. */
export type PublishedPresentation = {
  version: number;
  publishedAt: string;
  renderModel: PresentationRenderModel;
};

/** The current publication, as the review screen describes it. */
export type CurrentPublicationSummary = {
  version: number;
  publishedAt: string;
  /** The draft revision that version was taken from. */
  sourceDraftRevision: number;
};
