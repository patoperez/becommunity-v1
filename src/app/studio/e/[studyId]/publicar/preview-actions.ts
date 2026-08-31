"use server";

import { z } from "zod";

import { registryWithDerivedBands } from "@/lib/experience/band-filters";
import { loadBuilderRegistry } from "@/lib/experience/builder-workspace";
import type { BlockDataSet } from "@/lib/experience/data";
import { EXPERIENCE_LIMITS } from "@/lib/experience/limits";
import { loadRevision, revisionIsReadable } from "@/lib/experience/publication";
import { resolveExperience } from "@/lib/experience/resolve";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { loadStudioStudy } from "@/lib/studio/study-workspace";

/**
 * Recompute ONE IMMUTABLE REVISION's numbers for one set of reader choices.
 *
 * IT IS THE REVISION, NEVER THE DRAFT. The document is read from
 * `study_experience_revision` by id, scoped to the study, so this action cannot
 * be talked into previewing the mutable draft and cannot be pointed at another
 * client's revision by supplying a valid identifier from one.
 *
 * WHY THE PREVIEW NEEDS ITS OWN ACTION rather than reusing the draft preview's:
 * they answer different questions and must never silently answer each other's.
 * `previewDraftData` reads the saved draft. This reads a frozen snapshot. A
 * single action that read "whichever exists" is exactly how a reviewer ends up
 * approving one thing and publishing another.
 *
 * NO `revalidatePath`, no write of any kind, and the selection is transient.
 */

const uuid = z.string().uuid();

const selectionSchema = z
  .record(
    z.string().min(1).max(64),
    z.array(z.string().min(1).max(240)).max(EXPERIENCE_LIMITS.defaultValuesPerFilter),
  )
  .refine((value) => Object.keys(value).length <= EXPERIENCE_LIMITS.filterDefinitions, {
    message: "too many filters",
  });

export type RevisionPreviewOutcome =
  | { ok: true; data: BlockDataSet }
  | { ok: false; message: string };

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

export async function previewRevisionData(
  rawStudyId: string,
  rawRevisionId: string,
  rawSelection: unknown,
): Promise<RevisionPreviewOutcome> {
  const studyId = uuid.safeParse(rawStudyId);
  const revisionId = uuid.safeParse(rawRevisionId);
  if (!studyId.success || !revisionId.success) {
    return { ok: false, message: "Solicitud inválida." };
  }
  const parsed = selectionSchema.safeParse(rawSelection ?? {});
  if (!parsed.success) return { ok: false, message: "Esa combinación de filtros no es válida." };

  // Re-authorized from scratch: a Server Action is a public HTTP endpoint, and
  // the page having authorized proves nothing about this request.
  const actor = await internalActor();
  if (!actor) return { ok: false, message: "Tu cuenta no puede ver esta revisión." };

  const studio = await loadStudioStudy(actor.admin, studyId.data);
  if (!studio) return { ok: false, message: "Este estudio ya no existe." };

  const revision = await loadRevision(actor.admin, studyId.data, revisionId.data);
  if (!revision) return { ok: false, message: "Esa revisión no existe en este estudio." };
  if (!revisionIsReadable(revision)) return { ok: false, message: revision.reason };

  const context = await loadBuilderRegistry(actor.admin, studio);
  const definition = revision.definition;

  const declared = new Map(definition.filterDefinitions.map((filter) => [filter.id, filter]));
  const widened = registryWithDerivedBands(definition, context.registry);
  const allowed = new Map(
    widened.dimensions.map((dimension) => [
      dimension.id,
      new Set(dimension.values.map((entry) => entry.value)),
    ]),
  );
  const selection: Record<string, string[]> = {};
  for (const [filterId, values] of Object.entries(parsed.data)) {
    const filter = declared.get(filterId);
    if (!filter) continue;
    const known = allowed.get(filter.dimensionId);
    if (!known) continue;
    const kept = values.filter((value) => known.has(value));
    if (kept.length === 0) continue;
    selection[filterId] = filter.control === "single_select" ? [kept[0]] : kept;
  }

  try {
    return {
      ok: true,
      data: resolveExperience({
        rows: context.rows,
        registry: context.registry,
        index: context.keyIndex,
        definition,
        selection,
        confirmed: context.confirmed,
      }).data,
    };
  } catch {
    return { ok: false, message: "No se pudieron calcular los resultados con esos filtros." };
  }
}
