"use server";

/**
 * THE FIVE PUBLICATION ACTIONS, AND THE ORDER THEY DO THINGS IN.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * EVERY ONE REPEATS THE WHOLE AUTHORIZATION DANCE RATHER THAN INHERITING IT.
 *
 * A Server Action is a public HTTP endpoint that happens to be written in
 * TypeScript, and the page's gate has never run for it. So the session is
 * fetched with `getUser()` — never `getSession()` — the role is read from the
 * database, and the study id is parsed as a uuid, all BEFORE the privileged
 * client exists. `createAdminClient()` builds a client that bypasses every RLS
 * policy in the database; one built before that check is one that exists during
 * the moment the answer might be "no".
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * NONE OF THEM REDIRECTS.
 *
 * The review screen holds acknowledgements a person ticked and a confirmation
 * they gave. A redirect would remount it and throw both away, and the operator
 * would be back at a screen that looks like they never decided anything. So
 * these return, and the page does not navigate.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THEY ACCEPT IS NUMBERS, CLOSED WORDS AND OPAQUE TOKENS.
 *
 * No document, no render model, no digest, no binding, no package identity — the
 * browser holds none of those and there is no parameter for one. Everything a
 * publication is made of is read again HERE, on the server, from the store and
 * from the study's current canonical results, and the whole preflight runs again
 * over that fresh read. What the browser sends is an ASSERTION about what a
 * person reviewed: this draft revision, over this publication version. The
 * assertion is checked, and a review that went stale between the screen and the
 * click is refused rather than trusted.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * NO DIGEST IS A PARAMETER ANYWHERE IN THIS FILE.
 *
 * The qualitative sign-off used to take one. It does not: a record written
 * against a value the caller supplied has a subject the caller chose, and
 * «the server recomputes and compares» is the browser's memory checked against
 * itself. Every digest in this unit — evidence, definition, render model,
 * binding fingerprint, plan fingerprint, package key, calculation version — is
 * derived on the server, from the server's own read, and none of them has a
 * parameter, a field or a return path that reaches a browser.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * AND NONE OF THEM CAN REACH A LEGACY EXPERIENCE TABLE, OR MUTATE THE
 * CANONICAL SOURCE.
 *
 * `study_experience_draft`, `_revision`, `_event` and `_publication` are not
 * named in this file, not named in the module it calls, and not named in the
 * body of any function that module calls. Migration 0030's storage is separate
 * from all four, which is what makes that a structural fact rather than an
 * abstention.
 *
 * `pain_point` likewise. The journey pain decision writes through migration
 * 0032's own function, into a table that holds no foreign key into `pain_point`
 * and no column that could carry one — so a presentation decision can never be
 * the reason canonical evidence changes.
 */

import { z } from "zod";

import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import {
  previewStoredPresentationUnderSelection,
  publishStoredPresentation,
  recordQualitativeSignOff,
  recordStoredJourneyPainDecision,
  restoreStoredPublication,
} from "@/lib/studio/publication-workspace";
import type {
  PainDecisionInput,
  PainDecisionResult,
  PainDisposition,
  PublicationPreviewResult,
  PublishResult,
  RestoreResult,
  SignOffResult,
} from "@/lib/publication";

const uuid = z.string().uuid();

/**
 * The idempotency key's shape, repeated here rather than trusted from the round
 * trip: a malformed key would be refused by the database as a generic storage
 * failure, and the screen would tell an operator their publication failed when
 * in fact the browser sent nonsense.
 */
const IDEMPOTENCY_KEY = z.string().regex(/^[A-Za-z0-9_.:-]{8,113}$/);

/** A revision or a version is a bounded positive integer, and nothing else. */
const REVISION = z.number().int().min(1).max(Number.MAX_SAFE_INTEGER);
const OPTIONAL_VERSION = REVISION.nullable();

/**
 * The acknowledgements, bounded and shaped.
 *
 * A closed vocabulary of short lower-case codes; the server compares them
 * against the codes ITS OWN preflight raised, so an unknown one changes nothing
 * — it simply fails to satisfy a requirement. The bound exists so a caller
 * cannot post a megabyte of strings into a comparison.
 */
const ACKNOWLEDGED = z.array(z.string().regex(/^[a-z0-9_]{1,64}$/)).max(32);

/** A stated reason, bounded exactly as the column is. */
const REASON = z.string().min(1).max(200);

/**
 * A ceiling on the viewer selection, checked before it is parsed.
 *
 * A selection is a list of panel ids, opaque handles and ordinal tokens, and
 * the presentation layer's own limits already bound it to 32 panels of 32
 * dimensions of 64 tokens — every one of them short. `JSON.parse` runs before
 * any of those limits can speak, so a megabyte of nested arrays is refused by
 * LENGTH first. The composer's preview action uses the same ceiling for the
 * same reason.
 */
const MAX_VIEWER_BYTES = 64 * 1024;

/**
 * AN OPAQUE IDENTITY, AND THERE IS NO SCHEMA HERE FOR A DIGEST.
 *
 * The sign-off used to accept a 64-hex evidence digest, and it does not any
 * more: a record written against a value the browser supplied is a record whose
 * subject the browser chose. What crosses now is a short base32 token per group,
 * derived from words already printed on the page, which the server re-derives
 * from its own read and compares. The alphabet contains letters past `f`, so
 * nothing shaped like a storage digest can be spelled in it.
 *
 * The bound is what protects the comparison: a caller cannot post a thousand
 * tokens into a set intersection. The approved layout binds two groups.
 */
const OPAQUE_TOKEN = z.string().regex(/^[a-z][a-z2-7]{1,31}$/);
const GROUP_TOKENS = z.array(OPAQUE_TOKEN).min(1).max(64);

/** The opaque identity of one curated source pain item. Shape only. */
const PAIN_ITEM_TOKEN = z.string().regex(/^pp[a-z2-7]{16}$/);

/**
 * One journey pain decision, bounded and shaped before anything is read.
 *
 * The disposition is a closed vocabulary; the phrase and the reason are bounded
 * exactly as the columns are; the touchpoints are opaque handles which the
 * SERVER then checks against the offer it built from this document — a shape
 * that parses is never a handle that exists.
 */
const PAIN_DECISION = z
  .object({
    token: PAIN_ITEM_TOKEN,
    disposition: z.enum(["approved", "rejected", "unresolved"]),
    publicPhrase: z.string().max(300).nullable(),
    touchpoints: z.array(z.string().max(128)).max(16),
    rationale: z.string().max(300).nullable(),
  })
  .strict();

/** Authorize, then — and only then — build the privileged client and the scope. */
async function authorizedStudioScope(
  studyId: string,
): Promise<
  | {
      ok: true;
      admin: ReturnType<typeof createAdminClient>;
      userId: string;
      scope: { tenantId: string; studyId: string; studyName: string };
    }
  | { ok: false; reason: "not_authorized" | "invalid_scope"; detail: string }
> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, reason: "not_authorized", detail: "Acceso denegado." };

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("user_id", user.id)
    .maybeSingle<{ role: string }>();
  if (profile?.role !== "internal") {
    return { ok: false, reason: "not_authorized", detail: "Acceso denegado." };
  }

  if (!uuid.safeParse(studyId).success) {
    return { ok: false, reason: "invalid_scope", detail: "Estudio inválido." };
  }

  // ONLY NOW. Everything above used the REQUEST-scoped client, which is subject
  // to RLS; the line below is the first privileged thing that exists.
  const admin = createAdminClient();
  const { data: study, error } = await admin
    .from("study")
    .select("id, tenant_id, name")
    .eq("id", studyId)
    .maybeSingle<{ id: string; tenant_id: string; name: string }>();
  if (error || !study) {
    return { ok: false, reason: "invalid_scope", detail: "Estudio inválido." };
  }

  // THE TENANT IS READ, NEVER RECEIVED. A caller does not get to name a tenant,
  // so a caller cannot name somebody else's.
  return {
    ok: true,
    admin,
    userId: user.id,
    scope: { tenantId: study.tenant_id, studyId: study.id, studyName: study.name },
  };
}

/**
 * Publish the stored canonical presentation, or refuse for a named reason.
 *
 * Every refusal leaves what the client is being served exactly as it was. There
 * is no path through this function that publishes something a preflight did not
 * approve on this side of the wire.
 */
export async function publishCanonicalPresentation(
  studyId: string,
  reviewedDraftRevision: number,
  expectedCurrentVersion: number | null,
  acknowledged: readonly string[],
  idempotencyKey: string,
): Promise<PublishResult> {
  const authorized = await authorizedStudioScope(studyId);
  if (!authorized.ok) {
    return { ok: false, reason: authorized.reason, detail: authorized.detail };
  }

  const revision = REVISION.safeParse(reviewedDraftRevision);
  const version = OPTIONAL_VERSION.safeParse(expectedCurrentVersion);
  const codes = ACKNOWLEDGED.safeParse(acknowledged);
  if (!revision.success || !version.success || !codes.success) {
    return {
      ok: false,
      reason: "preflight_refused",
      detail: "Lo que se envió no describe una revisión de este estudio, así que no se publica.",
    };
  }
  if (!IDEMPOTENCY_KEY.safeParse(idempotencyKey).success) {
    return {
      ok: false,
      reason: "preflight_refused",
      detail: "La clave de reintento enviada no tiene la forma que esta capa admite.",
    };
  }

  return publishStoredPresentation(
    authorized.admin,
    authorized.scope,
    authorized.userId,
    revision.data,
    version.data,
    codes.data,
    idempotencyKey,
  );
}

/**
 * Bring an approved publication back into the working draft.
 *
 * It publishes nothing and it deletes nothing. The version travels as a NUMBER
 * and is resolved to a row inside this study's own scope, so a number from
 * another study's history cannot reach a snapshot.
 */
export async function restoreCanonicalPublication(
  studyId: string,
  version: number,
  expectedDraftRevision: number | null,
  reason: string,
  idempotencyKey: string,
): Promise<RestoreResult> {
  const authorized = await authorizedStudioScope(studyId);
  if (!authorized.ok) {
    return { ok: false, reason: authorized.reason, detail: authorized.detail };
  }

  const parsedVersion = REVISION.safeParse(version);
  const parsedRevision = OPTIONAL_VERSION.safeParse(expectedDraftRevision);
  const parsedReason = REASON.safeParse(typeof reason === "string" ? reason.trim() : "");
  if (!parsedVersion.success || !parsedRevision.success) {
    return {
      ok: false,
      reason: "restore_refused",
      detail: "Lo que se envió no describe una versión de este estudio.",
    };
  }
  if (!parsedReason.success) {
    return {
      ok: false,
      reason: "restore_refused",
      detail: "Una restauración tiene que decir por qué, en una frase corta.",
    };
  }
  if (!IDEMPOTENCY_KEY.safeParse(idempotencyKey).success) {
    return {
      ok: false,
      reason: "restore_refused",
      detail: "La clave de reintento enviada no tiene la forma que esta capa admite.",
    };
  }

  return restoreStoredPublication(
    authorized.admin,
    authorized.scope,
    authorized.userId,
    parsedVersion.data,
    parsedRevision.data,
    parsedReason.data,
    idempotencyKey,
  );
}

/**
 * Resolve the draft under review beneath a reviewer's own filter selection.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * IT IS A READ THAT ENDS IN A VALUE, AND IT WRITES NOTHING.
 *
 * No insert, update, upsert, delete, RPC or `revalidatePath`. The stored draft
 * keeps its revision, its bytes and its digest; the publication pointer is not
 * read for it and not moved by it. A reviewer ticking a filter box is doing
 * exactly what a reader will do, and a reader's selection has never been
 * allowed to change what exists.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE SELECTION IS HOSTILE UNTIL IT IS VALIDATED.
 *
 * It arrives as a JSON string from a browser: capped by length, parsed inside a
 * try/catch, and then checked against what THIS document and THIS study
 * actually offer — which panel exists, which characteristics that panel offers,
 * which ordinal positions the study minted. A selection is never turned into a
 * predicate here; the browser names positions and the server looks the values
 * up, so a canonical value has no field to travel in.
 */
export async function previewPublicationUnderSelection(
  studyId: string,
  viewerJson: string,
): Promise<PublicationPreviewResult> {
  const authorized = await authorizedStudioScope(studyId);
  if (!authorized.ok) {
    return {
      ok: false,
      unavailable: { reason: "review_refused", detail: authorized.detail },
    };
  }

  if (typeof viewerJson !== "string" || viewerJson.length > MAX_VIEWER_BYTES) {
    return {
      ok: false,
      unavailable: {
        reason: "review_refused",
        detail: "La selección de filtros enviada excede el tamaño que esta capa admite.",
      },
    };
  }
  let candidate: unknown;
  try {
    candidate = JSON.parse(viewerJson);
  } catch {
    return {
      ok: false,
      unavailable: {
        reason: "review_refused",
        detail: "La selección de filtros enviada no es JSON válido.",
      },
    };
  }

  return previewStoredPresentationUnderSelection(authorized.admin, authorized.scope, candidate);
}

/**
 * Record that this person read this study's exact qualitative categories.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THE BROWSER MAY SAY, AND WHAT IT MAY NOT.
 *
 * A REVIEW INTENT AND A LIST OF OPAQUE GROUP IDENTITIES. The draft revision
 * names the review the person was doing; the tokens name the groups they were
 * looking at. There is no parameter for the categories themselves, for a digest,
 * for a note about a person, for a quotation, or for who did the reviewing: the
 * actor is the authenticated session and is read from it, and the words are
 * re-read on the server from the study's own results.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE DIGEST USED TO BE A PARAMETER, AND ITS ABSENCE IS THE POINT.
 *
 * The browser held the qualitative evidence digest and echoed it back; the
 * server recomputed and compared. The argument was that the digest covers only
 * category labels a client already sees, so it discloses nothing — true, and
 * beside the point. A record written against a value the caller supplied has a
 * subject the caller chose, and comparing an echo against a fresh computation
 * is comparing the browser's memory with itself.
 *
 * Now the server reloads the draft, verifies the REVISION, the STUDY and the
 * BINDING, recomputes the digest from the study's current results, checks that
 * the submitted tokens name exactly the groups it just read, and writes the
 * record against ITS OWN digest. There is no parameter on this function by
 * which that value could be supplied, influenced or observed.
 */
export async function recordCanonicalQualitativeSignOff(
  studyId: string,
  reviewedDraftRevision: number,
  groupTokens: readonly string[],
): Promise<SignOffResult> {
  const authorized = await authorizedStudioScope(studyId);
  if (!authorized.ok) {
    return { ok: false, reason: authorized.reason, detail: authorized.detail };
  }
  const revision = REVISION.safeParse(reviewedDraftRevision);
  if (!revision.success) {
    return {
      ok: false,
      reason: "draft_moved",
      detail: "Lo que se envió no describe una revisión de este estudio. Vuelve a cargar la pantalla.",
    };
  }
  const tokens = GROUP_TOKENS.safeParse(groupTokens);
  if (!tokens.success) {
    return {
      ok: false,
      reason: "evidence_moved",
      detail: "Lo que se envió no nombra las categorías que había en pantalla. Vuelve a cargar la pantalla.",
    };
  }
  return recordQualitativeSignOff(
    authorized.admin,
    authorized.scope,
    authorized.userId,
    revision.data,
    tokens.data,
  );
}

/**
 * Record one reviewer's decision about one curated journey pain phrase.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * IT WRITES PRESENTATION CONFIGURATION AND NEVER CANONICAL EVIDENCE.
 *
 * `pain_point` is not named in this file, not named in the module it calls, and
 * not named in the body of any function that module calls in order to write.
 * The one write goes through migration 0032's
 * `record_canonical_journey_pain_decision`, into a table that holds no foreign
 * key into `pain_point` at all — so «the source is not mutated» is a structural
 * fact rather than an abstention.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THE BROWSER MAY SAY.
 *
 * An opaque item token, one of three closed words, the public phrase a person
 * typed, the opaque touchpoint handles they picked from a list this same server
 * offered, and an optional reason. There is no parameter for a digest, for the
 * source wording, for a tenant, or for who decided.
 *
 * Everything below is a SHAPE check. Whether the item exists, whether the words
 * still say what they said, and whether each chosen touchpoint is one this
 * document draws are all decided on the server against a fresh read.
 */
export async function recordCanonicalJourneyPainDecision(
  studyId: string,
  input: PainDecisionInput,
): Promise<PainDecisionResult> {
  const authorized = await authorizedStudioScope(studyId);
  if (!authorized.ok) {
    return { ok: false, reason: authorized.reason, detail: authorized.detail };
  }
  // A SERVER ACTION'S ARGUMENTS ARE DESERIALIZED BEFORE ANYTHING VALIDATES
  // THEM, so the whole object is parsed as one — an unknown key, a wrong type or
  // a missing field is refused here rather than reaching a function whose
  // parameter types the runtime never checked.
  const parsed = PAIN_DECISION.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      reason: "decision_incomplete",
      detail:
        "Lo que se envió no describe una decisión sobre una frase de este estudio, o excede el tamaño que esta capa admite.",
    };
  }
  return recordStoredJourneyPainDecision(
    authorized.admin,
    authorized.scope,
    authorized.userId,
    {
      token: parsed.data.token,
      disposition: parsed.data.disposition as PainDisposition,
      publicPhrase: parsed.data.publicPhrase,
      touchpoints: parsed.data.touchpoints,
      rationale: parsed.data.rationale,
    },
  );
}
