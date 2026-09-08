"use server";

/**
 * THE TWO PUBLICATION ACTIONS, AND THE ORDER THEY DO THINGS IN.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * BOTH REPEAT THE WHOLE AUTHORIZATION DANCE RATHER THAN INHERITING IT.
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
 * NEITHER REDIRECTS.
 *
 * The review screen holds acknowledgements a person ticked and a confirmation
 * they gave. A redirect would remount it and throw both away, and the operator
 * would be back at a screen that looks like they never decided anything. So
 * these return, and the page does not navigate.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THEY ACCEPT IS FOUR NUMBERS AND A LIST OF WORDS.
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
 * AND NEITHER CAN REACH A LEGACY EXPERIENCE TABLE.
 *
 * `study_experience_draft`, `_revision`, `_event` and `_publication` are not
 * named in this file, not named in the module it calls, and not named in the
 * body of any function that module calls. Migration 0030's storage is separate
 * from all four, which is what makes that a structural fact rather than an
 * abstention.
 */

import { z } from "zod";

import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import {
  publishStoredPresentation,
  restoreStoredPublication,
} from "@/lib/studio/publication-workspace";
import type { PublishResult, RestoreResult } from "@/lib/publication";

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
