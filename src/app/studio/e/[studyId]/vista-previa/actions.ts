"use server";

import { z } from "zod";

import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { loadStudioStudy } from "@/lib/studio/study-workspace";
import { loadBuilderRegistry } from "@/lib/experience/builder-workspace";
import { resolveExperience } from "@/lib/experience/resolve";
import { registryWithDerivedBands } from "@/lib/experience/band-filters";
import { loadExperienceDraft } from "@/lib/experience/storage";
import type { BlockDataSet } from "@/lib/experience/data";
import { EXPERIENCE_LIMITS } from "@/lib/experience/limits";

/**
 * Recompute the draft preview's numbers for one set of reader choices.
 *
 * THE DOCUMENT IS NEVER SENT BY THE BROWSER. The preview renders the SAVED
 * draft, so the server reads it itself. What arrives is a study id and a
 * selection — which means the request cannot describe an arrangement nobody
 * saved, cannot name another study's registry, and stays small.
 *
 * IT REVALIDATES NOTHING AND WRITES NOTHING. No `revalidatePath`: forcing a
 * re-render of the current route inside a Server Action response is exactly
 * what made the builder's autosave take the whole editor down on the Worker,
 * and this route does even more per render than that one did. It computes
 * aggregates and returns them.
 *
 * THE READER'S CHOICES ARE TRANSIENT. Nothing here writes a draft, a revision,
 * an answer or a calculation. A selection decides which rows an aggregate is
 * computed over on this one request and then it is gone.
 */

const uuid = z.string().uuid();

/**
 * The untrusted boundary for a selection. Bounded on every axis, and the
 * VALUES are checked against the study's own registry below rather than
 * trusted from here — a well-shaped string is not a value this study carries.
 */
const selectionSchema = z
  .record(
    z.string().min(1).max(64),
    z.array(z.string().min(1).max(240)).max(EXPERIENCE_LIMITS.defaultValuesPerFilter),
  )
  .refine(
    (value) => Object.keys(value).length <= EXPERIENCE_LIMITS.filterDefinitions,
    { message: "too many filters" },
  );

export type PreviewDataOutcome =
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

export async function previewDraftData(
  rawStudyId: string,
  rawSelection: unknown,
): Promise<PreviewDataOutcome> {
  const studyId = uuid.safeParse(rawStudyId);
  if (!studyId.success) return { ok: false, message: "Solicitud inválida." };

  const parsed = selectionSchema.safeParse(rawSelection ?? {});
  if (!parsed.success) return { ok: false, message: "Esa combinación de filtros no es válida." };

  // Re-authorized from scratch. A Server Action is a public HTTP endpoint with
  // a hard-to-guess name; the page having authorized proves nothing about the
  // request that arrives here.
  const actor = await internalActor();
  if (!actor) return { ok: false, message: "Tu cuenta no puede ver esta vista previa." };

  const studio = await loadStudioStudy(actor.admin, studyId.data);
  if (!studio) return { ok: false, message: "Este estudio ya no existe." };

  const context = await loadBuilderRegistry(actor.admin, studio);
  const stored = await loadExperienceDraft(actor.admin, studio.study.id);
  const definition = stored.ok && stored.draft ? stored.draft.definition : context.adapted;

  // Every chosen value is checked against the study's OWN registry. A value
  // this study does not carry is dropped rather than passed to the engine,
  // so a crafted request narrows to nothing rather than to somebody else's
  // rows.
  const declared = new Map(definition.filterDefinitions.map((filter) => [filter.id, filter]));
  // The allowlist reads the WIDENED registry, so a reader choosing "Rojo" on a
  // characteristic the document derives is checked against the band labels
  // rather than dropped as unknown.
  const registry = registryWithDerivedBands(definition, context.registry);
  const allowed = new Map(
    registry.dimensions.map((dimension) => [
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
