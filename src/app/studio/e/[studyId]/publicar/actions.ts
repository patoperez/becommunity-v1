"use server";

import { redirect } from "next/navigation";
import { z } from "zod";

import { definitionHash, prepareIdempotencyKey, selectionIdempotencyKey } from "@/lib/experience/fingerprint";
import { acknowledgementMatches } from "@/lib/experience/preflight";
import {
  prepareRevision,
  publishRevision,
  restoreRevision,
  revisionIsReadable,
  loadRevision,
} from "@/lib/experience/publication";
import { loadPublicationWorkspace } from "@/lib/experience/publication-workspace";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { loadStudioStudy } from "@/lib/studio/study-workspace";
import {
  safeReturnPath,
  studioStudyPublicationHistory,
  studioStudyPublish,
} from "@/lib/studio/routes";

/**
 * The three acts that move a composed experience toward, and back through, a
 * client's screen.
 *
 * NO `revalidatePath`, ANYWHERE IN THIS FILE. It makes Next re-render the
 * route inside the action's own response, and this route now loads a study's
 * rows, its registry, its draft, its newest revision, its active publication
 * and two structural diffs. On the Worker that is exactly the shape of request
 * that landed the write and then aborted the re-render, replacing the whole
 * screen with an error boundary after a SUCCESSFUL publication — the single
 * worst moment for it to happen. Each action ends in a `redirect` to a short
 * address instead: the browser makes a fresh, ordinary GET and the mutation
 * response stays small.
 *
 * AUTHORIZATION IS REDONE HERE, FROM SCRATCH. A Server Action is a public HTTP
 * endpoint with a hard-to-guess name; the page having authorized proves nothing
 * about the request that arrives. `internalContext()` revalidates the session
 * with `getUser()` and re-reads the role from the database before it creates a
 * privileged client, and `assert_experience_publisher` inside each database
 * function re-reads it again.
 *
 * EVERY PRECONDITION IS RE-DERIVED, NEVER READ FROM THE REQUEST. The preflight
 * runs again on the server against the document that is actually stored. The
 * only things the form contributes are the identifiers of what the operator was
 * looking at and the concurrency tokens — and each of those is a token the
 * database compares rather than trusts.
 */

const uuid = z.string().uuid();
const reasonSchema = z.string().trim().min(1).max(200);
const noteSchema = z.string().trim().max(200);
/** A warning code, from the closed vocabulary the database also constrains. */
const codeSchema = z.string().regex(/^[a-z0-9_]{1,64}$/);

async function internalContext() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("user_id", user.id)
    .maybeSingle<{ role: string }>();
  if (profile?.role !== "internal") throw new Error("Acceso denegado.");
  return { user, admin: createAdminClient() };
}

/**
 * Where the operator lands afterwards.
 *
 * The path is BUILT from an id this file has already validated and the
 * submitted value is accepted only when it equals one of them, so a supplied
 * `return_to` can never introduce a host or a path of an attacker's choosing.
 * The same rule `src/lib/studio/routes.ts` states for every other action.
 */
function finish(
  kind: "ok" | "error",
  message: string,
  options: { returnTo?: string; allowed?: readonly string[]; fallback: string },
): never {
  const base = safeReturnPath(options.returnTo, options.allowed ?? [], options.fallback);
  const separator = base.includes("?") ? "&" : "?";
  redirect(`${base}${separator}${kind}=${encodeURIComponent(message)}`);
}

function publicationPaths(studyId: string): string[] {
  return [studioStudyPublish(studyId), studioStudyPublicationHistory(studyId)];
}

/** The acknowledgement checkboxes, as submitted. Bounded and de-duplicated. */
function submittedCodes(formData: FormData): string[] {
  const raw = formData.getAll("ack").map((value) => String(value));
  if (raw.length > 64) return raw.slice(0, 64);
  const parsed = raw.flatMap((value) => {
    const check = codeSchema.safeParse(value);
    return check.success ? [check.data] : [];
  });
  return [...new Set(parsed)].sort();
}

// ---------------------------------------------------------------------------
// 1. Prepare — freeze the saved draft as an immutable revision
// ---------------------------------------------------------------------------

export async function prepareExperienceRevision(formData: FormData) {
  const { user, admin } = await internalContext();
  const studyId = uuid.safeParse(formData.get("study_id"));
  if (!studyId.success) {
    finish("error", "Revisa el estudio.", { fallback: "/studio/estudios" });
  }
  const fallback = studioStudyPublish(studyId.data);
  const allowed = publicationPaths(studyId.data);
  const returnTo = String(formData.get("return_to") ?? fallback);
  const fail: (message: string) => never = (message) => finish("error", message, { returnTo, allowed, fallback });

  const studio = await loadStudioStudy(admin, studyId.data);
  if (!studio) fail("Este estudio ya no existe.");

  const workspace = await loadPublicationWorkspace(admin, studio);
  if (!workspace.draft) {
    fail(
      "Todavía no hay un borrador guardado de esta experiencia. Ábrela en Construcción y guarda antes de preparar una revisión.",
    );
  }

  // THE SNAPSHOT IS THE SAVED DRAFT, and it is read here rather than accepted
  // from the browser. The database compares it against the stored draft again,
  // as `jsonb`, inside the transaction — so a prepared revision is provably the
  // draft it says it is even if this code were bypassed entirely.
  const definition = workspace.draft.definition;
  const expectedRevision = z
    .coerce.number()
    .int()
    .min(1)
    .safeParse(formData.get("draft_revision"));
  if (!expectedRevision.success || expectedRevision.data !== workspace.draft.revision) {
    fail(
      "El borrador cambió mientras mirabas esta pantalla. Recárgala para revisar la versión más reciente.",
    );
  }

  const preflight = workspace.draftPreflight;
  if (preflight.blockers.length > 0) {
    const first = preflight.blockers[0];
    const rest = preflight.blockers.length - 1;
    fail(
      `${first.detail}${rest > 0 ? ` Y ${rest} problema${rest === 1 ? "" : "s"} más.` : ""}`,
    );
  }

  // EXACTLY THE WARNINGS ON SCREEN, in both directions. A missing code means
  // publishing something nobody saw; an extra one means the acknowledgement is
  // about a different document. There is deliberately no control that accepts
  // everything at once.
  const acknowledged = submittedCodes(formData);
  const match = acknowledgementMatches(preflight.warningCodes, acknowledged);
  if (!match.ok) {
    fail(
      match.missing.length > 0
        ? "Falta marcar alguna advertencia. Revisa la lista completa y vuelve a intentarlo."
        : "Las advertencias marcadas no son las de esta versión. Recarga la pantalla y revísalas otra vez.",
    );
  }

  const noteRaw = noteSchema.safeParse(String(formData.get("note") ?? ""));
  const note = noteRaw.success && noteRaw.data.length > 0 ? noteRaw.data : null;

  const hash = await definitionHash(definition);
  const key = await prepareIdempotencyKey({
    studyId: studyId.data,
    sourceDraftRevision: workspace.draft.revision,
    definitionSha256: hash,
    acknowledgedWarnings: acknowledged,
  });

  const result = await prepareRevision(admin, {
    studyId: studyId.data,
    actorId: user.id,
    definition,
    sourceDraftRevision: workspace.draft.revision,
    definitionSha256: hash,
    studyFingerprint: workspace.studyFingerprint,
    acknowledgedWarnings: acknowledged,
    blockingCodes: preflight.blockerCodes,
    note,
    idempotencyKey: key,
  });

  if (!result.ok) fail(result.message);

  finish(
    "ok",
    result.created
      ? `Revisión ${result.revision} preparada. Revísala y publícala cuando estés de acuerdo.`
      : `Esta revisión ya estaba preparada (la ${result.revision}).`,
    { returnTo, allowed, fallback },
  );
}

// ---------------------------------------------------------------------------
// 2. Publish — one atomic selection
// ---------------------------------------------------------------------------

export async function publishExperienceRevision(formData: FormData) {
  const { user, admin } = await internalContext();
  const studyId = uuid.safeParse(formData.get("study_id"));
  const revisionId = uuid.safeParse(formData.get("revision_id"));
  if (!studyId.success) finish("error", "Revisa el estudio.", { fallback: "/studio/estudios" });
  const fallback = studioStudyPublish(studyId.data);
  const allowed = publicationPaths(studyId.data);
  const returnTo = String(formData.get("return_to") ?? fallback);
  const fail: (message: string) => never = (message) => finish("error", message, { returnTo, allowed, fallback });
  if (!revisionId.success) fail("Revisa qué revisión quieres publicar.");

  const studio = await loadStudioStudy(admin, studyId.data);
  if (!studio) fail("Este estudio ya no existe.");

  const workspace = await loadPublicationWorkspace(admin, studio);
  const prepared = workspace.prepared;
  if (!prepared || prepared.id !== revisionId.data) {
    // Not the newest revision. Look it up explicitly rather than refusing,
    // because "publish an older prepared revision that was never published" is
    // a legitimate act — and it is scoped to this study, so an id from another
    // client resolves to nothing.
    const other = await loadRevision(admin, studyId.data, revisionId.data);
    if (!other) fail("Esa revisión no existe en este estudio.");
    if (!revisionIsReadable(other)) fail(other.reason);
  }
  if (prepared && prepared.id === revisionId.data && !revisionIsReadable(prepared)) {
    fail(prepared.reason);
  }

  const preflight =
    prepared && prepared.id === revisionId.data ? workspace.preparedPreflight : null;
  if (!preflight) {
    fail(
      "Solo se puede publicar la revisión preparada más reciente desde aquí. Abre el historial para restaurar una anterior.",
    );
  }
  if (preflight.blockers.length > 0) {
    const first = preflight.blockers[0];
    const rest = preflight.blockers.length - 1;
    fail(`${first.detail}${rest > 0 ? ` Y ${rest} problema${rest === 1 ? "" : "s"} más.` : ""}`);
  }

  const readable = prepared && revisionIsReadable(prepared) ? prepared : null;
  if (!readable) fail("Esa revisión no se puede leer con esta versión del producto.");

  // The acknowledgement the REVISION recorded, re-asserted. The database
  // compares it again and refuses a set that is not exactly this one.
  const acknowledged = submittedCodes(formData);
  const match = acknowledgementMatches(readable.acknowledgedWarnings, acknowledged);
  if (!match.ok) {
    fail(
      "Las advertencias marcadas no son las que quedaron registradas en esta revisión. Recarga la pantalla.",
    );
  }

  const expectedActive = String(formData.get("expected_active") ?? "");
  const expectedActiveRevisionId =
    expectedActive === "" || expectedActive === "none" ? null : expectedActive;
  if (expectedActiveRevisionId && !uuid.safeParse(expectedActiveRevisionId).success) {
    fail("Revisa qué versión estaba publicada.");
  }

  const noteRaw = noteSchema.safeParse(String(formData.get("note") ?? ""));
  const note = noteRaw.success && noteRaw.data.length > 0 ? noteRaw.data : null;

  const result = await publishRevision(admin, {
    studyId: studyId.data,
    actorId: user.id,
    revisionId: revisionId.data,
    expectedActiveRevisionId,
    acknowledgedWarnings: acknowledged,
    blockingCodes: preflight.blockerCodes,
    note,
    idempotencyKey: selectionIdempotencyKey({
      kind: "pub",
      studyId: studyId.data,
      revisionId: revisionId.data,
      expectedActiveRevisionId,
    }),
  });

  if (!result.ok) fail(result.message);

  finish(
    "ok",
    result.created
      ? `Publicado. El cliente ve la revisión ${readable.revision} desde ahora.`
      : `Esta publicación ya se había registrado. El cliente ve la revisión ${readable.revision}.`,
    { returnTo, allowed, fallback },
  );
}

// ---------------------------------------------------------------------------
// 3. Restore — a new publication event pointing at an older revision
// ---------------------------------------------------------------------------

export async function restoreExperienceRevision(formData: FormData) {
  const { user, admin } = await internalContext();
  const studyId = uuid.safeParse(formData.get("study_id"));
  const revisionId = uuid.safeParse(formData.get("revision_id"));
  if (!studyId.success) finish("error", "Revisa el estudio.", { fallback: "/studio/estudios" });
  const fallback = studioStudyPublicationHistory(studyId.data);
  const allowed = publicationPaths(studyId.data);
  const returnTo = String(formData.get("return_to") ?? fallback);
  const fail: (message: string) => never = (message) => finish("error", message, { returnTo, allowed, fallback });
  if (!revisionId.success) fail("Revisa qué revisión quieres restaurar.");

  const reason = reasonSchema.safeParse(String(formData.get("reason") ?? ""));
  if (!reason.success) {
    fail("Escribe por qué vuelves a esta revisión. Queda registrado con tu nombre y la hora.");
  }

  const studio = await loadStudioStudy(admin, studyId.data);
  if (!studio) fail("Este estudio ya no existe.");

  // Scoped to this study, so a valid identifier belonging to another client
  // resolves to nothing here — and the database checks the same thing again
  // against the study row rather than against anything this request sent.
  const revision = await loadRevision(admin, studyId.data, revisionId.data);
  if (!revision) fail("Esa revisión no existe en este estudio.");
  if (!revisionIsReadable(revision)) fail(revision.reason);

  const expectedActive = String(formData.get("expected_active") ?? "");
  const expectedActiveRevisionId =
    expectedActive === "" || expectedActive === "none" ? null : expectedActive;
  if (expectedActiveRevisionId && !uuid.safeParse(expectedActiveRevisionId).success) {
    fail("Revisa qué versión está publicada.");
  }
  if (expectedActiveRevisionId === revisionId.data) {
    fail("Esa revisión ya es la que está publicada.");
  }

  const result = await restoreRevision(admin, {
    studyId: studyId.data,
    actorId: user.id,
    revisionId: revisionId.data,
    expectedActiveRevisionId,
    reason: reason.data,
    idempotencyKey: selectionIdempotencyKey({
      kind: "rst",
      studyId: studyId.data,
      revisionId: revisionId.data,
      expectedActiveRevisionId,
    }),
  });

  if (!result.ok) fail(result.message);

  finish(
    "ok",
    result.created
      ? `Restaurado. El cliente vuelve a ver la revisión ${revision.revision}. La anterior sigue en el historial.`
      : `Esta restauración ya se había registrado. El cliente ve la revisión ${revision.revision}.`,
    { returnTo, allowed, fallback },
  );
}
