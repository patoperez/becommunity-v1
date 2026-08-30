import "server-only";

import type { createAdminClient } from "@/lib/supabase/admin";

import { EXPERIENCE_SCHEMA_VERSION, type ExperienceDefinitionV1 } from "./definition";
import { migrateExperienceDefinition } from "./migrate";
import { serializedBytes } from "./serialize";
import { EXPERIENCE_LIMITS } from "./limits";

/**
 * Reading and writing the one stored draft of a composed experience
 * (migration 0023).
 *
 * WHERE THE AUTHORIZATION IS. Not here. Every caller runs `requireInternal()`
 * first and hands this module the admin client that check produced; this file
 * issues the reads and the one RPC and asserts nothing about who is asking.
 * That is deliberate — an authorization check buried in a data-access helper is
 * an authorization check the next caller forgets to run. The database repeats
 * it anyway: RLS denies `anon` and `authenticated` outright on all three
 * tables, and `save_study_experience_draft` re-reads the actor's role from
 * `public.profiles` before it writes anything.
 *
 * WHAT IS NEVER TRUSTED. The tenant. It is derived from the study row inside
 * the function, never taken from the request, and the function refuses a
 * document whose own `metadata.studyId` / `metadata.tenantId` disagree with the
 * study being written to.
 *
 * WHAT IS NEVER SILENTLY REPAIRED. A stored document that the current schema
 * refuses comes back as `{ ok: false }` with the reason, and the builder shows
 * the study's adapted arrangement instead of pretending the draft loaded.
 * Half-reading a document whose meaning has changed is how a page quietly loses
 * a section.
 */

export type StoredDraft = {
  definition: ExperienceDefinitionV1;
  /** The optimistic-concurrency token. Sent back with every save. */
  revision: number;
  schemaVersion: number;
  updatedAt: string;
  updatedBy: string | null;
  createdAt: string;
};

export type LoadDraftResult =
  | { ok: true; draft: StoredDraft | null }
  | { ok: false; reason: string };

type DraftRow = {
  schema_version: number;
  revision: number;
  definition: unknown;
  created_at: string;
  updated_at: string;
  updated_by: string | null;
};

export async function loadExperienceDraft(
  admin: ReturnType<typeof createAdminClient>,
  studyId: string,
): Promise<LoadDraftResult> {
  const { data, error } = await admin
    .from("study_experience_draft")
    .select("schema_version, revision, definition, created_at, updated_at, updated_by")
    .eq("study_id", studyId)
    .maybeSingle<DraftRow>();

  if (error) {
    // A table a migration has not created yet is not a broken study: the
    // builder falls back to the study's adapted arrangement and says the draft
    // could not be read, which is honest in both cases.
    if (error.code === "42P01" || error.code === "PGRST205") {
      return { ok: false, reason: "El almacenamiento de borradores todavía no existe en esta base." };
    }
    return { ok: false, reason: `No se pudo leer el borrador: ${error.message}` };
  }
  if (!data) return { ok: true, draft: null };

  const migrated = migrateExperienceDefinition(data.definition);
  if (!migrated.ok) {
    return {
      ok: false,
      reason:
        migrated.reason === "unknown_version"
          ? `El borrador guardado usa una versión que esta versión del producto no entiende (${migrated.detail}).`
          : `El borrador guardado ya no es válido: ${migrated.detail}`,
    };
  }

  return {
    ok: true,
    draft: {
      definition: migrated.definition,
      revision: Number(data.revision),
      schemaVersion: Number(data.schema_version),
      createdAt: data.created_at,
      updatedAt: data.updated_at,
      updatedBy: data.updated_by,
    },
  };
}

export type SaveDraftResult =
  | { ok: true; revision: number; created: boolean }
  /**
   * Somebody else saved a newer revision. The caller reloads and tells the
   * person, rather than replacing work it never saw.
   */
  | { ok: false; kind: "conflict"; message: string }
  | { ok: false; kind: "rejected"; message: string }
  | { ok: false; kind: "unavailable"; message: string };

export async function saveExperienceDraft(
  admin: ReturnType<typeof createAdminClient>,
  input: {
    studyId: string;
    actorId: string;
    definition: ExperienceDefinitionV1;
    /** Null exactly when the caller believes no draft exists yet. */
    expectedRevision: number | null;
    note?: string | null;
  },
): Promise<SaveDraftResult> {
  // The ceiling the database also enforces, checked here so the person is told
  // in words rather than by a constraint violation.
  if (serializedBytes(input.definition) > EXPERIENCE_LIMITS.serializedBytes) {
    return {
      ok: false,
      kind: "rejected",
      message: "Esta experiencia es demasiado grande para guardarse. Quita bloques o páginas.",
    };
  }

  const { data, error } = await admin.rpc("save_study_experience_draft", {
    p_study_id: input.studyId,
    p_actor: input.actorId,
    p_definition: input.definition,
    p_schema_version: EXPERIENCE_SCHEMA_VERSION,
    p_expected_revision: input.expectedRevision,
    p_note: input.note ?? null,
  });

  if (error) {
    if (error.code === "40001") {
      return {
        ok: false,
        kind: "conflict",
        message:
          "Alguien más guardó una versión más nueva de este borrador. Recarga para ver sus cambios antes de volver a guardar.",
      };
    }
    if (error.code === "42501") {
      return { ok: false, kind: "rejected", message: "Tu cuenta no puede editar este estudio." };
    }
    if (error.code === "P0002") {
      return { ok: false, kind: "rejected", message: "Este estudio ya no existe." };
    }
    if (error.code === "22023") {
      return { ok: false, kind: "rejected", message: "El borrador no se pudo guardar tal como está." };
    }
    return {
      ok: false,
      kind: "unavailable",
      message: "No se pudo guardar en este momento. Vuelve a intentarlo.",
    };
  }

  const result = data as { revision?: number; created?: boolean } | null;
  if (!result || typeof result.revision !== "number") {
    return {
      ok: false,
      kind: "unavailable",
      message: "El guardado no confirmó una versión. Vuelve a intentarlo.",
    };
  }
  return { ok: true, revision: result.revision, created: Boolean(result.created) };
}
