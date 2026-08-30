"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { loadStudioStudy } from "@/lib/studio/study-workspace";
import { loadBuilderWorkspace } from "@/lib/experience/builder-workspace";
import {
  parseExperienceDefinition,
  type ExperienceDefinitionV1,
} from "@/lib/experience/definition";
import { resolveDefinitionData, type BlockDataSet } from "@/lib/experience/data";
import { saveExperienceDraft } from "@/lib/experience/storage";
import { validateExperienceDefinition } from "@/lib/experience/validate";
import { studioStudyComposer } from "@/lib/studio/routes";

/**
 * The two things the dashboard builder asks the server for: save this draft,
 * and compute these numbers.
 *
 * BOTH RE-AUTHORIZE FROM SCRATCH. A Server Action is a public HTTP endpoint
 * with a hard-to-guess name — nothing more. The session is revalidated with
 * `getUser()`, the role is read from the database, and the privileged client is
 * created only afterwards. The fact that the page which rendered the form
 * already ran `requireInternal()` proves nothing about the request that
 * arrives here.
 *
 * NOTHING SUBMITTED IS TRUSTED, AND THAT INCLUDES THE DOCUMENT. The definition
 * goes through the same strict Zod boundary a stored blob does, is re-validated
 * against a registry the SERVER rebuilds from the study's own data, and is
 * refused when its `metadata` names a study or a client other than the one
 * being written to. The tenant is never read from the request at any layer:
 * the Server Action does not take one, and `save_study_experience_draft`
 * derives it from the study row.
 *
 * NOTHING HERE PUBLISHES. Saving a draft changes no client-facing surface, and
 * `revalidatePath` deliberately names only the builder's own address.
 */

const uuid = z.string().uuid();
/** A revision is a small positive integer counter, or absent for a first save. */
const revisionSchema = z.number().int().min(1).max(1_000_000).nullable();
const noteSchema = z.string().max(200).nullable().optional();

export type SaveDraftOutcome =
  | { ok: true; revision: number; created: boolean; savedAt: string }
  | {
      ok: false;
      kind: "conflict";
      message: string;
      /** The version that is actually stored, so the person can take it. */
      current: { definition: ExperienceDefinitionV1; revision: number } | null;
    }
  | { ok: false; kind: "invalid" | "denied" | "unavailable"; message: string };

async function internalActor() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("user_id", user.id)
    .maybeSingle<{ role: string }>();
  if (profile?.role !== "internal") return null;
  return { user, admin: createAdminClient() };
}

export async function saveExperienceDraftAction(
  rawStudyId: string,
  rawDefinition: unknown,
  rawExpectedRevision: number | null,
  rawNote?: string | null,
): Promise<SaveDraftOutcome> {
  const studyId = uuid.safeParse(rawStudyId);
  const expected = revisionSchema.safeParse(rawExpectedRevision ?? null);
  const note = noteSchema.safeParse(rawNote ?? null);
  if (!studyId.success || !expected.success || !note.success) {
    return { ok: false, kind: "invalid", message: "Solicitud inválida." };
  }

  const actor = await internalActor();
  if (!actor) {
    return { ok: false, kind: "denied", message: "Tu cuenta no puede editar este estudio." };
  }

  // THE UNTRUSTED BOUNDARY. Strict, bounded, injection-refusing, and run here
  // rather than only in the browser — a composer that validated only in the
  // browser is a composer whose rules an attacker skips by posting the
  // document directly.
  const parsed = parseExperienceDefinition(rawDefinition);
  if (!parsed.ok) {
    const first = parsed.issues[0];
    return {
      ok: false,
      kind: "invalid",
      message: `El borrador no se puede guardar tal como está: ${first?.message ?? "documento inválido"}.`,
    };
  }

  const studio = await loadStudioStudy(actor.admin, studyId.data);
  if (!studio) return { ok: false, kind: "invalid", message: "Este estudio ya no existe." };

  // A document that names another study or another client is refused rather
  // than rewritten to name this one: rewriting would store an arrangement
  // built against a registry that never belonged to this study.
  if (
    parsed.definition.metadata.studyId !== studio.study.id
    || parsed.definition.metadata.tenantId !== studio.study.tenantId
  ) {
    return {
      ok: false,
      kind: "invalid",
      message: "Ese borrador pertenece a otro estudio.",
    };
  }

  const workspace = await loadBuilderWorkspace(actor.admin, studio);
  const report = validateExperienceDefinition(parsed.definition, workspace.registry);
  if (report.errors.length > 0) {
    return {
      ok: false,
      kind: "invalid",
      message: `Hay algo que impide guardar: ${report.errors[0].detail}`,
    };
  }

  const saved = await saveExperienceDraft(actor.admin, {
    studyId: studio.study.id,
    actorId: actor.user.id,
    definition: parsed.definition,
    expectedRevision: expected.data,
    note: note.data ?? null,
  });

  if (!saved.ok) {
    if (saved.kind === "conflict") {
      return {
        ok: false,
        kind: "conflict",
        message: saved.message,
        current: workspace.draft
          ? { definition: workspace.draft.definition, revision: workspace.draft.revision }
          : null,
      };
    }
    return {
      ok: false,
      kind: saved.kind === "rejected" ? "invalid" : "unavailable",
      message: saved.message,
    };
  }

  // Only the builder's own address. Saving a draft changes nothing a client
  // sees, so revalidating a client route here would be a lie about what
  // happened.
  revalidatePath(studioStudyComposer(studio.study.id));
  return {
    ok: true,
    revision: saved.revision,
    created: saved.created,
    savedAt: new Date().toISOString(),
  };
}

export type RefreshDataOutcome =
  | { ok: true; data: BlockDataSet }
  | { ok: false; message: string };

/**
 * The numbers for a document that is being edited but not yet saved.
 *
 * It computes aggregates and returns nothing else. The registry and the
 * handle-to-key index are rebuilt on the server from the study's own data, so
 * a request naming a handle this study does not have resolves to a refusal
 * rather than to somebody else's number.
 */
export async function refreshExperienceData(
  rawStudyId: string,
  rawDefinition: unknown,
): Promise<RefreshDataOutcome> {
  const studyId = uuid.safeParse(rawStudyId);
  if (!studyId.success) return { ok: false, message: "Solicitud inválida." };

  const actor = await internalActor();
  if (!actor) return { ok: false, message: "Tu cuenta no puede ver este estudio." };

  const parsed = parseExperienceDefinition(rawDefinition);
  if (!parsed.ok) return { ok: false, message: "No se pudieron calcular los resultados." };

  const studio = await loadStudioStudy(actor.admin, studyId.data);
  if (!studio) return { ok: false, message: "Este estudio ya no existe." };
  if (
    parsed.definition.metadata.studyId !== studio.study.id
    || parsed.definition.metadata.tenantId !== studio.study.tenantId
  ) {
    return { ok: false, message: "Ese borrador pertenece a otro estudio." };
  }

  const workspace = await loadBuilderWorkspace(actor.admin, studio);
  try {
    return {
      ok: true,
      data: resolveDefinitionData(
        workspace.rows,
        workspace.registry,
        workspace.keyIndex,
        parsed.definition,
      ),
    };
  } catch {
    return { ok: false, message: "No se pudieron calcular los resultados." };
  }
}
