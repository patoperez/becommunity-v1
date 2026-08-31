"use server";

import { z } from "zod";

import {
  activeComposition,
  resolveClientExperience,
  type ClientExperienceInput,
} from "@/lib/experience/client-experience";
import type { BlockDataSet } from "@/lib/experience/data";
import { registryWithDerivedBands } from "@/lib/experience/band-filters";
import { EXPERIENCE_LIMITS } from "@/lib/experience/limits";
import { loadAuthorizedStudyData } from "@/lib/studies/authorized";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

/**
 * Recompute a published experience's numbers for one set of a reader's choices.
 *
 * THE DOCUMENT IS NEVER SENT BY THE BROWSER. What arrives is a study id and a
 * selection. The server reads the ACTIVE PUBLISHED REVISION itself, so a
 * request cannot describe an arrangement nobody published, cannot name another
 * study's registry, and stays small.
 *
 * AUTHORIZATION IS REDONE FROM SCRATCH, THROUGH THE READER'S OWN SESSION.
 * `loadAuthorizedStudyData` runs against the user's Supabase client, so RLS,
 * the tenant boundary, the published-study rule and the profile's `data_scope`
 * all apply exactly as they do on the page itself. The privileged client is
 * created only afterwards, and only to read the one table a browser role is
 * denied outright.
 *
 * IT REVALIDATES NOTHING AND WRITES NOTHING. No `revalidatePath`: forcing a
 * re-render of the current route inside a Server Action response is what took
 * the builder down on the Worker, and this route resolves a whole study's
 * aggregates. It computes and returns them.
 *
 * A SELECTION IS TRANSIENT. Nothing here writes a draft, a revision, a
 * publication, an answer or a calculation. A choice decides which rows an
 * aggregate is computed over on this one request and is then gone.
 */

const uuid = z.string().uuid();

/** The untrusted boundary. Bounded on every axis before a value is looked at. */
const selectionSchema = z
  .record(
    z.string().min(1).max(64),
    z.array(z.string().min(1).max(240)).max(EXPERIENCE_LIMITS.defaultValuesPerFilter),
  )
  .refine((value) => Object.keys(value).length <= EXPERIENCE_LIMITS.filterDefinitions, {
    message: "too many filters",
  });

export type PublishedDataOutcome =
  | { ok: true; data: BlockDataSet }
  | { ok: false; message: string };

export async function publishedExperienceData(
  rawStudyId: string,
  rawSelection: unknown,
): Promise<PublishedDataOutcome> {
  const studyId = uuid.safeParse(rawStudyId);
  if (!studyId.success) return { ok: false, message: "Solicitud inválida." };

  const parsed = selectionSchema.safeParse(rawSelection ?? {});
  if (!parsed.success) return { ok: false, message: "Esa combinación de filtros no es válida." };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, message: "Tu sesión expiró. Vuelve a entrar." };

  const authorized = await loadAuthorizedStudyData(supabase, studyId.data);
  if (!authorized) return { ok: false, message: "Este estudio ya no está disponible." };

  const admin = createAdminClient();
  const context: ClientExperienceInput = {
    study: {
      id: authorized.study.id,
      tenantId: authorized.study.tenant_id,
      name: authorized.study.name,
      period: authorized.study.period,
      status: authorized.study.status,
    },
    clientName: authorized.tenantName,
    rows: authorized.rows,
    qualitative: authorized.qualitative,
    reportAvailable: authorized.rows.length > 0,
  };

  // The document and the registry, WITHOUT the numbers. A reader's chosen
  // values have to be checked against what this study offers before anything is
  // computed, and resolving the whole study to learn that would be a second
  // pass over every row for an answer this call already has.
  const loaded = await activeComposition(admin, context);
  if (loaded.kind !== "composed") {
    return { ok: false, message: "Este estudio ya no usa esta vista." };
  }

  /*
   * EVERY CHOSEN VALUE IS CHECKED AGAINST THIS READER'S OWN REGISTRY.
   *
   * A filter the published document does not declare is dropped. A value the
   * reader's data does not contain is dropped. So a crafted request narrows to
   * nothing rather than to somebody else's rows — and, because the registry was
   * built from the rows their `data_scope` allows, a value that exists in the
   * study but not in their scope is refused here too.
   *
   * The allowlist reads the WIDENED registry, so a reader choosing a semáforo
   * band the document derives is checked against the band labels rather than
   * dropped as unknown.
   */
  const definition = loaded.composition.active.definition;
  const widened = registryWithDerivedBands(definition, loaded.composition.registry);
  const declared = new Map(definition.filterDefinitions.map((filter) => [filter.id, filter]));
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
    const resolved = resolveClientExperience(loaded.composition, { ...context, selection });
    return { ok: true, data: resolved.data };
  } catch {
    return { ok: false, message: "No se pudieron calcular los resultados con esos filtros." };
  }
}
