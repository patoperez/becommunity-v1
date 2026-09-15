import "server-only";

/**
 * THE JOURNEY PAIN REVIEW WORKSPACE — load what a person must decide, check
 * what they decided, and produce content only when the decisions are complete.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * IT ADDS NO DOOR TO THE CANONICAL LAYER.
 *
 * Every name here that touches canonical data comes from
 * `./presentation-workspace`, the composer's declared loader, through a SINGLE
 * import statement — the same discipline `publication-workspace.ts` follows and
 * for the same reason. The curated pain read is a real canonical read, so it
 * matters more here than anywhere: it arrives through the declared loader
 * rather than through an edge of this module's own.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * NOTHING HERE PROPOSES A MAPPING.
 *
 * Not from string similarity, not from normalized labels, not from position, not
 * from workbook order, and not from the approved demo's hand-written alias
 * table. There is no comparison anywhere in this file between a source stage's
 * wording and a touchpoint's label, and there is no code path that writes a
 * touchpoint into a decision that a person did not choose.
 *
 * The reason is measured rather than stylistic: of the eighteen curated stage
 * labels, ZERO match a canonical `survey_item.label`, SIX match the workbook's
 * short label row and FIVE match the bracketed text inside the prompt. Three
 * defensible readings of the same two sources give three different answers, so
 * any rule this file could contain would be a choice about which reading to
 * privilege — and that choice is a person's.
 *
 * What a reviewer IS given is a neutral SEARCH over the touchpoints, which
 * filters a list they are already being shown. A filter narrows what somebody
 * looks at; it does not tick a box.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE DIGESTS STAY HERE.
 *
 * A decision is stored against a SERVER-COMPUTED digest of the source words it
 * was made about, and freshness is decided by comparing that stored digest with
 * one recomputed here on every load. The browser is told `sourceVersion` — five
 * bytes of it, base32 — so a reviewer can SEE that an item moved, and is never
 * believed about it. There is no parameter anywhere on this path by which a
 * caller could assert a digest.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * AND THE CANONICAL SOURCE IS NEVER WRITTEN.
 *
 * `pain_point` is READ, in three columns, and no function in this file inserts,
 * updates, upserts or deletes anything in it — nor in any other canonical
 * table. The one write this module makes goes through migration 0032's
 * `record_canonical_journey_pain_decision`, into a table of its own that holds
 * no foreign key into `pain_point` at all.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  PAIN_REVIEW_LIMITS,
  TRANSPORT_FAILURE_DETAIL,
  classifyTransportFailure,
  type PainDecisionInput,
  type PainDecisionResult,
  type PainReviewOutcome,
} from "@/lib/publication";
import type { PresentationRenderModel } from "@/lib/presentation";
// THE PURE HALF, IMPORTED RATHER THAN DUPLICATED. It is off the client-safe
// barrel for the same reason `evidence-digest.ts` is — it reaches the product's
// SHA-256 — so this module names it directly, and so does the offline gate that
// drives it.
import {
  PAIN_REVIEW_NOT_APPLICABLE,
  buildPainReviewItems,
  painReviewCounts,
  painReviewGaps,
  painTouchpointChoices,
  type StoredPainDecision,
} from "@/lib/publication/journey-pain-model";
// ONE IMPORT STATEMENT, ONE PATH, ONE DOOR. See the header.
import {
  loadCuratedPainReviewEvidence,
  painSourceDigest,
  type ComposerScope,
  type CuratedPainEvidence,
} from "./presentation-workspace";

const DECISION_TABLE = "canonical_journey_pain_decision";

/**
 * Read the decisions in force for one study.
 *
 * A MISSING TABLE IS NOT AN EMPTY REVIEW, AND A FAILED READ IS NOT ONE EITHER.
 *
 * This used to answer «no decisions» to both, which the panel then reported as
 * a queue nobody had started. Unit 6B.4B2K found what that costs: on the
 * Cloudflare edge this RPC was refused by the runtime, not by the database, and
 * fifteen recorded approvals were reported to their own author as unreviewed.
 * So a REFUSAL is now distinguishable from an EMPTY ANSWER — the first throws
 * and the caller reports an unreadable review, the second returns zero rows and
 * means zero rows.
 *
 * It must never be reported as «reviewed» either. Both of those are still true;
 * what is new is that there are now three states rather than two.
 */
async function readDecisions(
  client: SupabaseClient,
  scope: ComposerScope,
): Promise<StoredPainDecision[]> {
  const { data, error } = await client.rpc("read_canonical_journey_pain_decisions", {
    p_study_id: scope.studyId,
    p_tenant_id: scope.tenantId,
  });
  // THE ERROR IS NOT SWALLOWED AND ITS MESSAGE IS NOT FORWARDED. It is thrown
  // as a value the caller classifies into one of eight closed codes, exactly as
  // a failed curated read is.
  if (error) throw error;
  if (!Array.isArray(data)) throw new Error("DECODE_FAILED: rpc did not return a list");
  const rows: StoredPainDecision[] = [];
  for (const entry of data as unknown[]) {
    if (typeof entry !== "object" || entry === null) continue;
    const row = entry as Record<string, unknown>;
    const disposition = row.disposition;
    if (disposition !== "approved" && disposition !== "rejected" && disposition !== "unresolved") {
      continue;
    }
    if (typeof row.itemKey !== "string" || typeof row.sourceDigest !== "string") continue;
    if (typeof row.decidedAt !== "string") continue;
    rows.push({
      itemKey: row.itemKey,
      sourceDigest: row.sourceDigest,
      disposition,
      publicPhrase: typeof row.publicPhrase === "string" ? row.publicPhrase : null,
      touchpoints: Array.isArray(row.touchpoints)
        ? row.touchpoints.filter((value): value is string => typeof value === "string")
        : [],
      rationale: typeof row.rationale === "string" ? row.rationale : null,
      decidedAt: row.decidedAt,
    });
  }
  return rows;
}

/**
 * Load the whole review for one study.
 *
 * `model` is the document resolved WITHOUT authored pain content — the caller
 * resolves once to learn which touchpoints exist, builds this, and resolves
 * again with the content when the review turns out to be complete. Resolving
 * with content first would need the content to know the choices to check the
 * content, which is not a loop this layer is willing to have.
 */
export async function loadJourneyPainReview(
  client: SupabaseClient,
  scope: ComposerScope,
  model: PresentationRenderModel | null,
): Promise<PainReviewOutcome> {
  let evidence: CuratedPainEvidence;
  try {
    evidence = await loadCuratedPainReviewEvidence(client, {
      tenantId: scope.tenantId,
      studyId: scope.studyId,
    });
  } catch (thrown) {
    // A READ THAT FAILED IS NOT A STUDY WITHOUT PAIN MATERIAL, AND IT IS NOT AN
    // UNFINISHED REVIEW EITHER.
    //
    // This used to return an applicable review with nothing in it and the gap
    // «undecided_items», on the argument that leaving the publication blocked
    // was the safe direction. It was the safe direction and the wrong SENTENCE:
    // every consumer then told a reviewer that their editorial work was
    // unfinished, which on the Cloudflare edge it demonstrably was not — the
    // runtime had refused the request, not the database, and fifteen approvals
    // were sitting in the table the whole time.
    //
    // So the failure is now a DIFFERENT TYPE, carrying one of eight closed
    // codes. The database's own message is still never forwarded: a refusal in
    // this schema quotes values, and `classifyTransportFailure` reads the
    // thrown value without retaining a byte of it.
    const code = classifyTransportFailure(thrown);
    return { ok: false, unavailable: { code, detail: TRANSPORT_FAILURE_DETAIL[code] } };
  }

  let decisions: StoredPainDecision[];
  try {
    decisions = await readDecisions(client, scope);
  } catch (thrown) {
    const code = classifyTransportFailure(thrown);
    return { ok: false, unavailable: { code, detail: TRANSPORT_FAILURE_DETAIL[code] } };
  }
  const items = buildPainReviewItems(scope.studyId, evidence, decisions);
  if (items.length === 0) return { ok: true, panel: PAIN_REVIEW_NOT_APPLICABLE };
  if (items.length > PAIN_REVIEW_LIMITS.items) {
    // A queue past the bound is refused rather than truncated, for the same
    // reason every canonical read refuses past its ceiling: a silently shorter
    // list is a review that looks finished because half of it is missing. It is
    // reported as an UNREADABLE review rather than an unfinished one, because
    // nobody failed to decide anything — the queue outgrew what this screen can
    // put in front of a person.
    return {
      ok: false,
      unavailable: { code: "DATABASE_REFUSED", detail: TRANSPORT_FAILURE_DETAIL.DATABASE_REFUSED },
    };
  }

  const choices = painTouchpointChoices(model);
  const gaps = painReviewGaps(items, choices);
  return {
    ok: true,
    panel: {
      applicable: true,
      items,
      choices,
      gaps,
      complete: gaps.length === 0,
      counts: painReviewCounts(items),
    },
  };
}

/* -------------------------------------------------------------------------- */
/* recording one decision                                                      */
/* -------------------------------------------------------------------------- */

const refuse = (
  reason: Exclude<PainDecisionResult & { ok: false }, never>["reason"],
  detail: string,
): PainDecisionResult => ({ ok: false, reason, detail });

/**
 * Record one reviewer's decision about one item.
 *
 * THE ORDER IS THE SECURITY ARGUMENT.
 *
 *   1. the queue is rebuilt from the study's CURRENT rows, so the token is
 *      resolved against evidence that exists now rather than against a list the
 *      browser remembers;
 *   2. the source digest is RECOMPUTED here — never accepted, never echoed —
 *      so a decision is always stored against the words that are actually
 *      there;
 *   3. every chosen touchpoint is checked against the offer THIS SERVER built
 *      from THIS document, so a handle a reviewer could not have been shown is
 *      refused rather than stored;
 *   4. and only then does the one write path run.
 *
 * It writes through `record_canonical_journey_pain_decision` and nothing else.
 * The table grants `service_role` SELECT only, so that function is the sole way
 * a row is created — a caller that could INSERT directly could manufacture an
 * approval nobody gave.
 */
export async function recordJourneyPainDecision(
  client: SupabaseClient,
  scope: ComposerScope,
  actorUserId: string,
  model: PresentationRenderModel | null,
  input: PainDecisionInput,
): Promise<PainDecisionResult> {
  let evidence: CuratedPainEvidence;
  try {
    evidence = await loadCuratedPainReviewEvidence(client, {
      tenantId: scope.tenantId,
      studyId: scope.studyId,
    });
  } catch {
    return refuse(
      "storage_refused",
      "No se pudo leer el material de origen, así que no se registra una decisión sobre algo que no se pudo comprobar. No cambió nada.",
    );
  }

  const items = buildPainReviewItems(scope.studyId, evidence, []);
  const item = items.find((candidate) => candidate.token === input.token);
  if (!item) {
    return refuse(
      "unknown_item",
      "Esa frase ya no está en el material de este estudio. Vuelve a cargar la pantalla.",
    );
  }

  const digest = painSourceDigest({
    token: item.token,
    curatedPhrase: item.curatedPhrase,
    sourceContext: item.sourceContext,
    sourceStatus: item.sourceStatus,
  });

  let phrase: string | null = null;
  let touchpoints: string[] = [];
  if (input.disposition === "approved") {
    phrase = (input.publicPhrase ?? "").trim();
    if (phrase.length === 0) {
      return refuse(
        "decision_incomplete",
        "Una frase aprobada tiene que decir qué lee el cliente. Escribe el texto público antes de aprobarla.",
      );
    }
    if (phrase.length > PAIN_REVIEW_LIMITS.phrase) {
      return refuse(
        "decision_incomplete",
        `El texto público no puede pasar de ${PAIN_REVIEW_LIMITS.phrase} caracteres.`,
      );
    }
    // DEDUPLICATED, IN THE REVIEWER'S OWN ORDER. The same point chosen twice is
    // one choice; refusing it would be refusing a double click.
    const chosen: string[] = [];
    for (const handle of input.touchpoints) {
      if (typeof handle !== "string") continue;
      if (!chosen.includes(handle)) chosen.push(handle);
    }
    if (chosen.length === 0) {
      return refuse(
        "decision_incomplete",
        "Una frase aprobada tiene que ir a por lo menos un punto de contacto. Si no sabes a cuál, márcala «sin resolver».",
      );
    }
    if (chosen.length > PAIN_REVIEW_LIMITS.touchpoints) {
      return refuse(
        "decision_incomplete",
        `Una frase no puede asignarse a más de ${PAIN_REVIEW_LIMITS.touchpoints} puntos de contacto.`,
      );
    }
    // AGAINST THE OFFER THIS SERVER BUILT, never against a pattern. A handle
    // that is well-formed and names nothing this document draws is refused.
    const offered = new Set(painTouchpointChoices(model).map((choice) => choice.handle as string));
    for (const handle of chosen) {
      if (!offered.has(handle)) {
        return refuse(
          "unknown_touchpoint",
          "Uno de los puntos de contacto elegidos ya no está en esta presentación. Vuelve a cargar la pantalla y elígelos otra vez.",
        );
      }
    }
    touchpoints = chosen;
  }

  const rationale = (input.rationale ?? "").trim();
  if (rationale.length > PAIN_REVIEW_LIMITS.rationale) {
    return refuse(
      "decision_incomplete",
      `El motivo no puede pasar de ${PAIN_REVIEW_LIMITS.rationale} caracteres.`,
    );
  }

  const { data, error } = await client.rpc("record_canonical_journey_pain_decision", {
    p_study_id: scope.studyId,
    p_actor: actorUserId,
    p_item_key: item.token,
    p_source_digest: digest,
    p_disposition: input.disposition,
    p_public_phrase: phrase,
    p_touchpoints: touchpoints,
    p_rationale: rationale.length === 0 ? null : rationale,
  });

  if (error) {
    return refuse(
      "storage_refused",
      // The database's own message is NOT forwarded: a constraint violation
      // quotes the values that violated it, and those values are the words.
      "No se pudo registrar la decisión. No cambió nada; puedes volver a intentarlo.",
    );
  }
  const answer = data as { decidedAt?: unknown; created?: unknown } | null;
  if (!answer || typeof answer.decidedAt !== "string") {
    return refuse(
      "storage_refused",
      "El registro de la decisión no devolvió una fecha, así que no se da por hecho.",
    );
  }
  return { ok: true, recordedAt: answer.decidedAt, replayed: answer.created !== true };
}

/** The table this module owns, named once so a gate can assert the set. */
export const JOURNEY_PAIN_TABLE = DECISION_TABLE;

/**
 * THE PURE HALF, RE-EXPORTED so a caller needs ONE import rather than two.
 *
 * `publication-workspace.ts` reaches the canonical layer through exactly one
 * import statement, and the same discipline applies to this module's callers:
 * one name, one path, one place a future edge would show up.
 */
export { PAIN_REVIEW_NOT_APPLICABLE, authoredPainContent } from "@/lib/publication/journey-pain-model";
