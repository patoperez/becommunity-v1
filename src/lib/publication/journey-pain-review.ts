/**
 * THE JOURNEY PAIN REVIEW — the contract between a reviewer's screen and the
 * server that loads, checks and stores their decisions.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THERE IS A HUMAN IN THIS LOOP AT ALL.
 *
 * The approved dashboard draws «Puntos de dolor del recorrido» as a cloud of
 * phrases and puts a badge on each touchpoint that carries one. Neither is
 * derivable from the canonical sources, and that was measured rather than
 * assumed (hosted, read-only, 2026-09-09):
 *
 *   * of the eighteen curated journey-stage labels, ZERO match a canonical
 *     `survey_item.label`, SIX match the workbook's short label row and FIVE
 *     match the bracketed text inside the prompt. Three defensible readings of
 *     the same two sources give three different answers;
 *   * «Reunión semanal presencial/en línea» is ONE stage over TWO touchpoints,
 *     so the relation is not one-to-one and never was;
 *   * «BNI Connect» is ambiguous between the web platform and the phone app,
 *     and «App celular» names that same app;
 *   * `journey_stage_evidence_link` holds ZERO rows, which is exactly what the
 *     contract's `journey_stage_evidence` requirement says it holds until a
 *     configuration declares otherwise;
 *   * and all fifty `pain_point` rows are `review_status = 'pending'`. Nobody
 *     has cleared any of those phrases for a client to read.
 *
 * The approved demo resolves all of it with a 38-entry hand-written alias table
 * and a phrase-splitting rule. Both are implementation, neither is authority,
 * and this product copies neither.
 *
 * So: a person decides. This file is the vocabulary they decide in.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT MAY CROSS TO THE BROWSER, AND WHAT HAS NO FIELD TO CROSS IN.
 *
 * MAY:  the curated phrase, the source's own stage wording, how many source
 *       items carry that phrase, the current disposition, an OPAQUE item token
 *       and an OPAQUE source-version marker.
 * MAY NOT: a respondent, a respondent identifier, a survey comment, an adjacent
 *       free-text answer, a name — and the SHA-256 source digest itself. There
 *       is no field on any type in this file for any of them, so none can
 *       travel through it. `pain_point` carries no respondent column at all —
 *       its provenance is a workbook cell, not a person — and the review reads
 *       four columns of it and no other table's text.
 *
 * THE DIGEST IS DELIBERATELY ABSENT FROM THE WIRE. A browser that held one
 * could echo it back, and then the server's freshness check would be checking
 * the browser's memory against itself. The server recomputes it from the
 * study's current rows on every load and on every write; the browser is told
 * only `sourceVersion`, a short opaque marker it can compare for equality and
 * cannot compute, so a reviewer can SEE that an item moved without being able
 * to assert that it did not.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE ARITHMETIC IS NOT IN THIS FILE, AND A BOUNDARY GATE IS WHY.
 *
 * `painItemToken`, `painSourceDigest` and `painSourceVersion` need the
 * product's own SHA-256, which lives under `src/lib/ingestion/canonical-commit/`.
 * Anything the client-safe publication barrel re-exports is one import away
 * from a `"use client"` component, so they live in `./journey-pain-digest` and
 * the barrel does not re-export it — the same split, for the same reason, as
 * `qualitative-signoff.ts` and `evidence-digest.ts`.
 */

import type { PresentationHandle } from "../presentation/handles";

/**
 * What a reviewer decided about one source item.
 *
 * `unreviewed` is the absence of a decision and is never stored: it is what an
 * item has before anybody looks at it. The other three are acts.
 *
 *   `approved`   — this phrase may be published, mapped to these touchpoints.
 *   `rejected`   — this phrase must NOT be published, and here is why.
 *   `unresolved` — a person looked, and deliberately could not decide. It is
 *                  NOT the same as nobody looking, and conflating the two is
 *                  how «we reviewed everything» becomes true of a queue nobody
 *                  finished.
 */
export type PainDisposition = "approved" | "rejected" | "unresolved";

/** Including the state an item is in before a person reaches it. */
export type PainItemState = PainDisposition | "unreviewed";

/** Plain Spanish for a state, for a screen. One way only, never parsed back. */
export const PAIN_STATE_LABEL: Record<PainItemState, string> = {
  unreviewed: "Sin revisar",
  approved: "Aprobado",
  rejected: "Excluido",
  unresolved: "Sin resolver",
};

/**
 * One canonical touchpoint a reviewer may choose, grouped by its visible route.
 *
 * THE ROUTE IS THE PRESENTATION'S, NOT THE SOURCE'S. The approved layout shows
 * five routes over the source's four groups, and a reviewer looking for
 * «Reunión semanal presencial» will look under «Operación» because that is
 * where a reader will find it.
 */
export type PainTouchpointChoice = {
  /** The opaque presentation handle. The only thing a decision stores. */
  handle: PresentationHandle;
  /** The touchpoint's own label, as a client reads it. Never a handle. */
  label: string;
  /** The visible route that draws it, by its authored title. */
  routeTitle: string;
};

/**
 * One source pain item, as a reviewer must see it to decide.
 *
 * Every field here is curated content or an opaque token. See the header for
 * what has no field.
 */
export type PainReviewItem = {
  /**
   * An OPAQUE, STABLE identity for this source item.
   *
   * Derived from the study and the row, so it is the same token on every load
   * and can key a stored decision; it is not the row's database identifier and
   * cannot be turned back into one without the study's own rows. If a
   * re-import mints different rows, the tokens move, every stored decision
   * stops matching an item, and the review reopens — which is the safe
   * direction and is stated rather than silent.
   */
  token: string;
  /** The curated phrase, whitespace-normalized by the projector. */
  curatedPhrase: string;
  /** The stage or context wording the SOURCE provided for it. Never inferred. */
  sourceContext: string;
  /**
   * How many source items in this study carry this exact curated phrase.
   *
   * Curation the projector already did, reported so a reviewer knows whether
   * they are deciding once or many times. It is NOT a count of people: no
   * respondent is attached to a pain point in any shape.
   */
  occurrences: number;
  /** The source row's own review status, as the canonical table holds it. */
  sourceStatus: string;
  /** What this reviewer has decided, or `unreviewed`. */
  state: PainItemState;
  /**
   * A short OPAQUE marker of the source words this item currently carries.
   *
   * Not the digest, and not computable by a browser. Equal markers mean the
   * words did not move; different markers mean they did. See the header.
   */
  sourceVersion: string;
  /** True when a decision exists and the source has moved since it was made. */
  stale: boolean;
  /** The approved public phrase, when one was approved. */
  publicPhrase: string | null;
  /** The touchpoints chosen, when this was approved. Empty otherwise. */
  touchpoints: readonly PresentationHandle[];
  /** Why it was rejected or left unresolved, when somebody wrote a reason. */
  rationale: string | null;
  /** ISO-8601 UTC of the decision in force, or null when there is none. */
  decidedAt: string | null;
};

/**
 * Why this study's journey-pain content is not publishable yet.
 *
 * A CLOSED VOCABULARY, so a screen switches on it rather than matching prose,
 * and every member names a thing a person can go and do.
 */
export type PainReviewGap =
  /** At least one in-scope item has no explicit disposition. */
  | "undecided_items"
  /** An approved item carries no public phrase. */
  | "approved_without_phrase"
  /** An approved item was mapped to no touchpoint. */
  | "approved_without_touchpoint"
  /** A decision was made about words that have since changed. */
  | "stale_source"
  /** A mapping names a touchpoint this study's presentation does not have. */
  | "unknown_touchpoint";

/** Plain Spanish for each gap, naming the consequence rather than the mechanism. */
export const PAIN_GAP_DETAIL: Record<PainReviewGap, string> = {
  undecided_items:
    "Hay frases del recorrido que nadie ha aprobado ni excluido todavía. Mientras queden sin decidir, la nube no se arma: publicaríamos una parte del material y llamaríamos completo al resultado.",
  approved_without_phrase:
    "Hay frases aprobadas sin texto público. Lo que el cliente leería sería el material de trabajo, no lo que se aprobó para su tablero.",
  approved_without_touchpoint:
    "Hay frases aprobadas que no están asignadas a ningún punto de contacto. Aparecerían en la nube y en ningún punto del recorrido, así que quien las lea no sabría de qué parte del proceso hablan.",
  stale_source:
    "El material de origen cambió después de que alguien lo revisó. Lo aprobado ya no es lo que hay, así que hay que volver a mirarlo antes de publicarlo.",
  unknown_touchpoint:
    "Hay asignaciones que apuntan a un punto de contacto que esta presentación ya no tiene. El cliente vería una frase suelta sin el punto al que pertenece.",
};

/**
 * The whole review of one study, as a screen and a preflight both read it.
 *
 * `complete` is the ONE fact everything else rests on, and it is decided on the
 * server from the fields beside it. A screen may show the gaps and a preflight
 * may raise them, and neither has to agree with the other about what "finished"
 * means.
 */
export type PainReviewPanel = {
  /**
   * Whether this study has any journey pain material at all.
   *
   * `false` means the study's source carries no `pain_point` attached to a
   * journey stage — a legitimate state for a study whose workbook has none —
   * and the whole review is `not_applicable` rather than empty.
   */
  applicable: boolean;
  items: readonly PainReviewItem[];
  /** Every touchpoint a decision may target, grouped by visible route. */
  choices: readonly PainTouchpointChoice[];
  /** Empty exactly when the review is complete. */
  gaps: readonly PainReviewGap[];
  complete: boolean;
  /** Items with each state, counted on the server so a screen counts nothing. */
  counts: Record<PainItemState, number>;
};

/* -------------------------------------------------------------------------- */
/* recording one decision                                                      */
/* -------------------------------------------------------------------------- */

export type PainDecisionRefusalReason =
  | "not_authorized"
  | "invalid_scope"
  /** The token names no item of this study. */
  | "unknown_item"
  /** The source words moved between the reading and the click. */
  | "source_moved"
  /** The decision is not internally consistent — see `detail`. */
  | "decision_incomplete"
  /** A chosen touchpoint is not one this study's presentation offers. */
  | "unknown_touchpoint"
  | "storage_refused";

export type PainDecisionResult =
  | { ok: true; recordedAt: string; replayed: boolean }
  | { ok: false; reason: PainDecisionRefusalReason; detail: string };

/**
 * What a browser may send to record ONE decision.
 *
 * An opaque token, a closed word, a phrase a person typed, opaque handles they
 * picked from a list this same server offered, and an optional reason. There is
 * no digest, no revision, no study identity beyond the route's own, and no
 * field for who decided — the actor is the authenticated session and is read
 * from it, so a caller cannot record a decision AS somebody else.
 */
export type PainDecisionInput = {
  token: string;
  disposition: PainDisposition;
  /** Required, non-empty, for `approved`. Ignored otherwise. */
  publicPhrase: string | null;
  /** Required, at least one, for `approved`. Ignored otherwise. */
  touchpoints: readonly string[];
  rationale: string | null;
};

export type RecordJourneyPainDecision = (
  studyId: string,
  input: PainDecisionInput,
) => Promise<PainDecisionResult>;

/* -------------------------------------------------------------------------- */
/* the bounds, declared once                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Every limit this boundary enforces, in one place.
 *
 * The database's own CHECK constraints carry the same numbers. Repeating them
 * here means a value past a bound is refused as a sentence a person can act on
 * rather than arriving as a generic storage failure that says a decision was
 * not recorded without saying why.
 */
export const PAIN_REVIEW_LIMITS = {
  /** A study's whole pain queue. Cuicuilco's is fifty. */
  items: 500,
  /** One approved public phrase. Long enough for a sentence, not a paragraph. */
  phrase: 300,
  /** Touchpoints one phrase may be mapped to. One stage over two points is the case. */
  touchpoints: 16,
  /** A stated reason. */
  rationale: 300,
} as const;
