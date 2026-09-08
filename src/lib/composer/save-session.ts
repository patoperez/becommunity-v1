/**
 * THE SAVE SESSION — six states, and the rules that stop a lie appearing in any
 * of them.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS IS A PURE MODULE AND NOT A HANDFUL OF `useState` CALLS.
 *
 * Every dangerous property this unit has to guarantee is a property of a STATE
 * TRANSITION, not of a request:
 *
 *   * a response that arrives after a newer one must not mark newer work saved;
 *   * a failed or timed-out save must never read «Guardado»;
 *   * a conflict must never resolve itself by writing;
 *   * a save that succeeded must still leave the screen honest when the author
 *     kept typing while it was in flight.
 *
 * None of those can be proved by driving a browser, and all of them can be
 * proved by calling functions. So the transitions live here, pure, and the
 * component owns only the timer, the network call and the pixels.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT «SAVED» IS ALLOWED TO MEAN.
 *
 * Exactly one thing: the document the store holds is REFERENCE-IDENTICAL to the
 * document on screen. The composer's `commit` already guarantees a fresh object
 * for every real edit and the SAME object when an operation decided there was
 * nothing to do (`editor.ts`), so reference identity is both cheap and exact —
 * and it is a stronger claim than deep equality, which two structurally equal
 * documents would also pass.
 *
 * That is why a successful save whose document is no longer the current one
 * lands in «Cambios sin guardar» and not in «Guardado». The revision it
 * returned is still recorded, because the next save must present it; but the
 * screen does not claim the author's newest paragraph is stored, because it is
 * not.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE TWO SEQUENCES, AND WHY DROPPING BY SEQUENCE IS NOT ENOUGH ON ITS OWN.
 *
 * `sequence` counts attempts; `accepted` is the highest whose answer has been
 * applied. An answer older than `accepted` is dropped unread — that is the
 * out-of-order guard, and it is necessary.
 *
 * It is not sufficient. Two attempts can be sent, the FIRST can answer last and
 * be dropped correctly, and the second's answer can still be about a document
 * the author has since edited. So the document check above runs on every
 * accepted answer as well. One guard is about which answer wins; the other is
 * about what winning entitles it to say.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import type { PresentationDocument } from "../presentation";
import type { SaveRefusalReason, SaveResult } from "./payload";

/**
 * The six states, in the product's own words.
 *
 * The code is a stable token and the Spanish is the label; they are declared
 * together so a screen cannot invent a seventh state or a different sentence.
 */
export const SAVE_STATE_LABEL = Object.freeze({
  sin_cambios: "Sin cambios",
  guardando: "Guardando…",
  guardado: "Guardado",
  cambios_sin_guardar: "Cambios sin guardar",
  no_pudimos_guardar: "No pudimos guardar",
  version_mas_reciente: "Hay una versión más reciente",
} as const);

export type SaveState = keyof typeof SAVE_STATE_LABEL;

/** The idempotency key shape migration 0029's CHECK constraint admits. */
export const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9_.:-]{8,120}$/;

export type SaveAttempt = {
  sequence: number;
  /** The exact document sent, held BY REFERENCE for the identity check. */
  document: PresentationDocument;
  /** Reused verbatim by a retry, so a replay is a no-op rather than a revision. */
  idempotencyKey: string;
  /** The revision presented as expected, kept so a retry presents the same one. */
  expectedRevision: number | null;
};

export type SaveSession = {
  state: SaveState;
  /**
   * The revision the STORE holds, as far as this session knows.
   *
   * `null` means nothing is stored yet, which is what a first save must present
   * as its expected revision — migration 0029 refuses a non-null expectation
   * against an absent row, precisely so an editor cannot pretend to be updating
   * something that does not exist.
   */
  revision: number | null;
  /** The document known to be in the store, by reference. Null when nothing is. */
  savedDocument: PresentationDocument | null;
  /** The attempt in flight, or null. */
  inFlight: SaveAttempt | null;
  /** Monotonic attempt counter. */
  sequence: number;
  /** Highest sequence whose answer has been applied. */
  accepted: number;
  /** The sentence beside the state, or null when the state says everything. */
  message: string | null;
  /** What the store holds, set only when the state is `version_mas_reciente`. */
  storedRevision: number | null;
  /** The last refusal's reason, kept so a screen can decide what to offer. */
  refusal: SaveRefusalReason | null;
  /** Typed document issues from the last `document_refused`, for a reviewer. */
  issues: { code: string; path: string }[] | null;
  /** The attempt a retry would repeat. Null when there is nothing to retry. */
  retryable: SaveAttempt | null;
};

/**
 * Open a session over whatever the page loaded.
 *
 * `document` is the one on screen. When it came from the store — a reload, or a
 * revisit — pass `restored: true` and the session opens in «Sin cambios»,
 * because it genuinely is. When it is a freshly built blueprint that has never
 * been stored, it opens in «Cambios sin guardar»: a layout nobody has saved is
 * unsaved work, and calling it «Sin cambios» would invite an author to close
 * the tab on an hour of it.
 */
export function openSaveSession(input: {
  document: PresentationDocument;
  revision: number | null;
  restored: boolean;
}): SaveSession {
  return {
    state: input.restored ? "sin_cambios" : "cambios_sin_guardar",
    revision: input.revision,
    savedDocument: input.restored ? input.document : null,
    inFlight: null,
    sequence: 0,
    accepted: 0,
    message: null,
    storedRevision: null,
    refusal: null,
    issues: null,
    retryable: null,
  };
}

/**
 * Is the document on screen different from the one in the store?
 *
 * The single source of truth for the navigation warning, for whether autosave
 * has anything to do, and for whether «Guardar ahora» should be offered.
 */
export function hasUnsavedChanges(session: SaveSession, current: PresentationDocument): boolean {
  return session.savedDocument !== current;
}

/**
 * Tell the session the document changed.
 *
 * A no-op when the document is the same object, so a render that changes
 * nothing cannot walk the session out of «Guardado».
 *
 * A CONFLICT SURVIVES AN EDIT, and so does a FAILURE. Both are still true after
 * the author types another word — there is still a newer version, the last
 * attempt still failed — and replacing either with the milder «Cambios sin
 * guardar» would let a state the author must act on disappear by being typed
 * over. The two states already imply unsaved changes, so nothing is hidden.
 */
export function documentChanged(session: SaveSession, current: PresentationDocument): SaveSession {
  // BACK TO THE STORED DOCUMENT IS BACK TO «SIN CAMBIOS».
  //
  // `undo` returns the previous document BY REFERENCE — the very object
  // `commit` pushed onto the history — so an author who edits and undoes is
  // holding the stored document again, identically. This used to return the
  // session untouched, which made «Cambios sin guardar» absorbing: the screen
  // went on claiming unsaved work over a document that WAS saved, the
  // navigation warning went on interrupting, and the next autosave wrote a
  // revision whose content was already stored.
  //
  // A conflict and a failure are not undone by this: both are still true of the
  // store regardless of what is on screen, so they stay.
  if (session.savedDocument === current) {
    if (session.state === "cambios_sin_guardar") {
      return { ...session, state: "sin_cambios", message: null };
    }
    return session;
  }
  if (session.state === "version_mas_reciente" || session.state === "no_pudimos_guardar") return session;
  if (session.state === "guardando") return session;
  if (session.state === "cambios_sin_guardar") return session;
  return { ...session, state: "cambios_sin_guardar", message: null };
}

/** May a save be started at all? */
export function canSave(session: SaveSession, current: PresentationDocument): boolean {
  if (session.inFlight !== null) return false;
  // NEVER out of a conflict. Writing from here is the force-save this unit
  // exists to refuse: the expected revision the session holds is the stale one,
  // and presenting the stored one instead would overwrite the newer document
  // with an older one under the appearance of an ordinary save.
  if (session.state === "version_mas_reciente") return false;
  return hasUnsavedChanges(session, current);
}

/**
 * Is an autosave due?
 *
 * Everything `canSave` requires, and one thing more: NOT after a failure.
 *
 * A timer that retries a failed save every few seconds is a timer that turns
 * one refusal into a hundred, hides the failure behind its own noise, and — if
 * the failure was a timeout — sends a hundred writes whose answers nobody is
 * reading. A failure is the one state where the next attempt should be a person
 * deciding to make it, which is what «Reintentar» is for.
 */
export function autosaveIsDue(session: SaveSession, current: PresentationDocument): boolean {
  if (session.state === "no_pudimos_guardar") return false;
  return canSave(session, current);
}

/**
 * Start an attempt.
 *
 * The key is supplied rather than minted here, because minting one needs a
 * clock or a random source and this module has neither. The caller passes a
 * fresh key for a new attempt and the PREVIOUS key for a retry, which is what
 * makes a retry a replay instead of a second revision.
 */
export function beginSave(
  session: SaveSession,
  current: PresentationDocument,
  idempotencyKey: string,
): SaveSession {
  // NO SECOND ATTEMPT WHILE ONE IS IN FLIGHT.
  //
  // The screen already prevents it — the button is disabled and `autosaveIsDue`
  // is false — but a rule this important should not live only in a disabled
  // attribute. Two attempts in flight would each carry a sequence number, and
  // the older one's answer would be dropped by `acceptSaveResponse` even though
  // its write may well have moved the revision: the session would then hold a
  // revision behind the store and take a conflict nobody caused.
  if (session.inFlight !== null) return session;

  if (!IDEMPOTENCY_KEY_PATTERN.test(idempotencyKey)) {
    // A programming error in the caller, not something an author can cause. It
    // is refused rather than sent, because the database would refuse it anyway
    // and the screen would report a save failure that was never attempted.
    return {
      ...session,
      state: "no_pudimos_guardar",
      message: "No se pudo preparar el guardado. Vuelve a intentarlo.",
      refusal: "transport_failed",
    };
  }
  const sequence = session.sequence + 1;
  return {
    ...session,
    state: "guardando",
    message: null,
    issues: null,
    refusal: null,
    sequence,
    inFlight: {
      sequence,
      document: current,
      idempotencyKey,
      expectedRevision: session.revision,
    },
  };
}

/**
 * The attempt a retry may repeat — and ONLY while repeating it is still honest.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE BUG THIS SIGNATURE EXISTS TO PREVENT, WHICH THIS UNIT SHIPPED AND CAUGHT.
 *
 * It used to take the session alone and return `session.retryable` outright.
 * The screen then retried under that attempt's idempotency key while sending
 * the document CURRENTLY on screen. Follow it through:
 *
 *   1. a save of document A times out — no answer, so nobody knows whether it
 *      was applied. It was: the store now holds A at revision N+1, and the
 *      event carries key K;
 *   2. the author keeps working, and the screen now holds document B;
 *   3. the author presses «Reintentar». The old key K is resent, with B;
 *   4. the database finds K already recorded and REPLAYS: it returns revision
 *      N+1 and writes nothing, which is exactly what a replay should do;
 *   5. the session sees a success whose document is the one on screen, and says
 *      «Guardado».
 *
 * The store holds A. The screen says B is saved. B is not saved, and the author
 * has been told it is — which is the single failure this whole unit exists to
 * make impossible, arriving through the mechanism built to prevent it.
 *
 * So a retry may reuse a key only when it is repeating the SAME document. Once
 * the document has moved, the attempt is no longer repeatable and the caller
 * must start a NEW attempt with a fresh key. That new attempt presents the
 * revision this session knows, which may now be stale — and a conflict is the
 * right answer: it tells the author a newer version exists, which is true, and
 * it is theirs.
 */
export function retryAttempt(
  session: SaveSession,
  current: PresentationDocument,
): SaveAttempt | null {
  if (session.retryable === null) return null;
  return session.retryable.document === current ? session.retryable : null;
}

/**
 * Apply an answer.
 *
 * `sequence` is the attempt the answer belongs to. `current` is the document on
 * screen AT THE MOMENT THE ANSWER ARRIVED, which is the only thing that decides
 * whether «Guardado» is true.
 */
export function acceptSaveResponse(
  session: SaveSession,
  sequence: number,
  result: SaveResult,
  current: PresentationDocument,
): SaveSession {
  // [1] OUT OF ORDER. An answer to an attempt older than one already applied is
  //     dropped unread. Applying it would move `revision` backwards, and the
  //     next save would then present a stale expectation and take a conflict
  //     the author did nothing to cause.
  if (sequence <= session.accepted) return session;

  // An answer to an attempt this session does not recognise — a stale closure
  // surviving a reset — is also dropped.
  const attempt = session.inFlight?.sequence === sequence ? session.inFlight : null;
  if (attempt === null) return session;

  const base = { ...session, accepted: sequence, inFlight: null };

  if (result.ok) {
    // [2a] A REPLAY THAT HAS BEEN SUPERSEDED IS A CONFLICT, not a success.
    //
    // The database answers a replayed key with the revision that key produced
    // AND with where the row is now. When they differ, the save under this key
    // WAS applied and somebody has saved over it since — so the document this
    // session sent is no longer what the store holds, and calling it saved
    // would be the same lie as any other. It is reported as what it is: there
    // is a newer version, and the local document is untouched.
    if (result.replayed && result.currentRevision !== result.revision) {
      return {
        ...base,
        state: "version_mas_reciente",
        message:
          "Tu guardado sí se aplicó, y alguien guardó encima después. No se sobrescribe: tus " +
          "cambios siguen aquí y puedes cargar la versión almacenada cuando decidas hacerlo.",
        storedRevision: result.currentRevision,
        refusal: "conflict",
        issues: null,
        retryable: null,
      };
    }

    // [2b] WHAT WAS SAVED IS WHAT WAS SENT, and nothing else. The revision is
    //     recorded either way, because the store really did move and the next
    //     save must present the new number.
    const stillCurrent = attempt.document === current;
    return {
      ...base,
      revision: result.currentRevision,
      savedDocument: attempt.document,
      state: stillCurrent ? "guardado" : "cambios_sin_guardar",
      message: null,
      storedRevision: null,
      refusal: null,
      issues: null,
      retryable: null,
    };
  }

  if (result.reason === "conflict") {
    // [3] THE LOCAL DOCUMENT IS NOT TOUCHED. `savedDocument` and `revision`
    //     stay exactly as they were, so nothing about the author's work or the
    //     session's idea of what it last stored is rewritten by somebody else's
    //     save. The stored revision is recorded separately, to be shown and not
    //     to be saved against.
    return {
      ...base,
      state: "version_mas_reciente",
      message: result.detail,
      storedRevision: result.storedRevision ?? null,
      refusal: "conflict",
      issues: null,
      retryable: null,
    };
  }

  // [4] EVERY OTHER REFUSAL. The work stays local and the screen says so. The
  //     attempt is kept as retryable ONLY when repeating it is safe: a refusal
  //     the document caused will refuse identically, and offering a retry for
  //     it would be a button that cannot work.
  const retryable =
    result.reason === "transport_failed" || result.reason === "storage_refused" ? attempt : null;

  return {
    ...base,
    state: "no_pudimos_guardar",
    message: result.detail,
    storedRevision: null,
    refusal: result.reason,
    issues: result.issues ?? null,
    retryable,
  };
}

/**
 * Adopt the stored version, deliberately.
 *
 * The ONLY way out of a conflict, and it is destructive of local work by
 * definition — which is why nothing here calls it. A person does, after being
 * told what it costs.
 */
export function adoptStoredVersion(
  session: SaveSession,
  document: PresentationDocument,
  revision: number,
): SaveSession {
  return {
    ...session,
    state: "sin_cambios",
    revision,
    savedDocument: document,
    inFlight: null,
    message: null,
    storedRevision: null,
    refusal: null,
    issues: null,
    retryable: null,
  };
}

/**
 * Give up on a failed attempt without retrying and without adopting anything.
 *
 * The work stays exactly where it is; only the alarm is acknowledged. From
 * here the ordinary «Cambios sin guardar» is true again, and autosave may
 * resume. It refuses to do this out of a conflict, where dismissing the notice
 * would leave a session that believes it may save over newer data.
 */
export function dismissSaveFailure(session: SaveSession): SaveSession {
  if (session.state !== "no_pudimos_guardar") return session;
  return { ...session, state: "cambios_sin_guardar", message: null, refusal: null, issues: null };
}
