"use server";

/**
 * Recording a category decision, and asking for a second opinion.
 *
 * WHAT THESE ACTIONS DO NOT DO. They do not decide anything. Every path here
 * requires an explicit human act — a chosen decision and, for a grouping, a
 * chosen final name. No confidence value from any source reaches the write, and
 * `consultCategoryAdvisor` deliberately writes nothing at all: it obtains an
 * opinion and puts it on the screen beside the candidate, where a person reads
 * it and then decides.
 *
 * AUTHORIZATION IS RE-ESTABLISHED HERE AND AGAIN IN SQL. `internalContext()`
 * revalidates the session with `getUser()` and reads the role from the
 * database; `record_category_decision` then independently refuses an actor who
 * is not internal. A caller that never opened the review screen gets nowhere,
 * and neither does one that opened it and then lost the role.
 */

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { foldSegmentValue } from "@/lib/calc/segments";
import { groupKeyMembers, MAX_GROUP_MEMBERS } from "@/lib/categories/candidates";
import { decisionRefusal, MIN_POSTPONE_REASON } from "@/lib/categories/decisions";
import { consultAdvisor } from "@/lib/categories/advisor/service";
import { loadCategoryWorkspace } from "@/lib/categories/load";
import { categoryReturnPaths, safeReturnPath, studioStudyCategories } from "@/lib/studio/routes";

const uuid = z.string().uuid();
const dimensionSchema = z.string().trim().min(1).max(80).regex(/^[\p{L}\p{N}_-]+$/u);
const labelSchema = z.string().trim().min(1).max(200);
const reasonSchema = z.string().trim().max(400);

/**
 * The members arrive as repeated `member` fields — hidden inputs on a candidate
 * card, checkboxes on the manual form.
 *
 * They are re-folded, re-sorted and re-deduplicated here rather than trusted:
 * the folded, sorted list IS the group's identity, and accepting a client's
 * ordering would let a hand-made request open a second version chain for a
 * question that already has one.
 */
const membersSchema = z
  .array(z.string().max(200))
  .max(64)
  .transform((raw, ctx) => {
    const folds = [...new Set(raw.map(foldSegmentValue).filter(Boolean))].sort();
    if (folds.length < 2 || folds.length > MAX_GROUP_MEMBERS) {
      ctx.addIssue({
        code: "custom",
        message: `a decision needs 2 to ${MAX_GROUP_MEMBERS} categories`,
      });
      return z.NEVER;
    }
    return folds;
  });

const decisionSchema = z.enum(["grouped", "separate", "postponed", "revoked"]);
const sourceSchema = z.enum([
  "deterministic",
  "fuzzy",
  "ai",
  "template_memory",
  "tenant_memory",
  "manual",
]);

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
    .single<{ role: string }>();
  if (profile?.role !== "internal") throw new Error("Acceso denegado.");
  return { user, admin: createAdminClient() };
}

function finish(studyId: string, kind: "ok" | "error", message: string, returnTo?: string): never {
  const base = safeReturnPath(returnTo, categoryReturnPaths(studyId), studioStudyCategories(studyId));
  const separator = base.includes("?") ? "&" : "?";
  redirect(`${base}${separator}${kind}=${encodeURIComponent(message)}`);
}

/**
 * Record one decision: group, keep separate, postpone, or undo.
 *
 * The whole write is one `record_category_decision` call, so the ledger row and
 * the projection that actually changes a number share a transaction. A decision
 * cannot be recorded without taking effect, and cannot take effect without
 * being recorded.
 */
export async function recordCategoryDecision(formData: FormData) {
  const { user, admin } = await internalContext();

  const studyId = uuid.safeParse(formData.get("study_id"));
  if (!studyId.success) finish("", "error", "Estudio inválido.");
  const returnTo = String(formData.get("return_to") ?? "");

  const dimensionKey = dimensionSchema.safeParse(formData.get("dimension_key"));
  const members = membersSchema.safeParse(formData.getAll("member").map(String));
  const decision = decisionSchema.safeParse(formData.get("decision"));
  const source = sourceSchema.safeParse(formData.get("suggestion_source") ?? "manual");

  if (!dimensionKey.success || !members.success || !decision.success || !source.success) {
    finish(studyId.data, "error", "Revisa la característica, las respuestas y la decisión.", returnTo);
  }

  const rawLabel = String(formData.get("canonical_label") ?? "").trim();
  const label = decision.data === "grouped" ? labelSchema.safeParse(rawLabel) : null;
  if (decision.data === "grouped" && !label?.success) {
    finish(studyId.data, "error", "Escribe cómo se va a llamar la categoría final.", returnTo);
  }
  const reason = reasonSchema.safeParse(String(formData.get("reason") ?? ""));
  if (!reason.success) finish(studyId.data, "error", "La explicación es demasiado larga.", returnTo);

  if (decision.data === "postponed" && reason.data.length < MIN_POSTPONE_REASON) {
    finish(
      studyId.data,
      "error",
      "Para posponerlo, escribe por qué queda pendiente. Alguien tiene que poder retomarlo.",
      returnTo,
    );
  }

  // The workspace is re-derived from the database so the refusal rules are
  // checked against the CURRENT state, not against whatever the browser was
  // showing when the page was rendered.
  const workspace = await loadCategoryWorkspace(admin, studyId.data);
  if (!workspace) finish(studyId.data, "error", "El estudio ya no existe.", returnTo);

  const groupKey = JSON.stringify(members.data);
  const refusal = decisionRefusal(
    {
      dimensionKey: dimensionKey.data,
      groupKey,
      decision: decision.data,
      canonicalLabel: decision.data === "grouped" ? rawLabel : null,
      reason: reason.data,
    },
    workspace.ledger,
  );
  if (refusal) finish(studyId.data, "error", refusal, returnTo);

  // The raw spellings currently on file for these folds, recorded so a reader a
  // year from now sees what was actually on screen.
  const memberValues = (workspace.dimensions.find((entry) => entry.key === dimensionKey.data)?.values ?? [])
    .filter((value) => members.data.includes(foldSegmentValue(value.raw)))
    .map((value) => value.raw);

  const signature =
    workspace.dimensions.find((entry) => entry.key === dimensionKey.data)?.contextSignature ?? "";

  const { error } = await admin.rpc("record_category_decision", {
    p_study_id: studyId.data,
    p_dimension_key: dimensionKey.data,
    p_member_folds: members.data,
    p_member_values: memberValues,
    p_context_signature: signature,
    p_decision: decision.data,
    p_canonical_label: decision.data === "grouped" ? rawLabel : null,
    p_canonical_fold: decision.data === "grouped" ? foldSegmentValue(rawLabel) : null,
    p_reason: reason.data || null,
    p_suggestion_source: source.data,
    p_language: "es",
    p_advisor: null,
    p_actor: user.id,
  });
  if (error) {
    finish(studyId.data, "error", `No se pudo guardar la decisión: ${error.message}`, returnTo);
  }

  revalidatePath(studioStudyCategories(studyId.data));
  revalidatePath("/dashboard");
  finish(studyId.data, "ok", confirmation(decision.data, rawLabel, groupKey), returnTo);
}

function confirmation(decision: string, label: string, groupKey: string): string {
  const count = groupKeyMembers(groupKey).length;
  if (decision === "grouped") {
    return `${count} respuestas se cuentan ahora como “${label}”. Los datos originales no se tocaron.`;
  }
  if (decision === "separate") {
    return "Quedan como respuestas distintas. No se volverá a proponer agruparlas aquí.";
  }
  if (decision === "postponed") {
    return "Queda pendiente, con tu explicación anotada.";
  }
  return "Se deshizo la decisión anterior. El historial se conserva completo.";
}

/**
 * Ask the advisor about one candidate.
 *
 * It writes nothing. The opinion lands in the isolate's cache and the review
 * screen renders it beside the candidate; accepting it is a separate,
 * deliberate act through `recordCategoryDecision`.
 *
 * The payload is built from aggregates the server already holds — the option
 * labels and their respondent counts — and `redactionRefusal` inside the
 * adapter refuses outright if anything in it looks like a person rather than a
 * category.
 */
export async function consultCategoryAdvisor(formData: FormData) {
  const { admin } = await internalContext();

  const studyId = uuid.safeParse(formData.get("study_id"));
  if (!studyId.success) finish("", "error", "Estudio inválido.");
  const returnTo = String(formData.get("return_to") ?? "");
  const dimensionKey = dimensionSchema.safeParse(formData.get("dimension_key"));
  const members = membersSchema.safeParse(formData.getAll("member").map(String));
  if (!dimensionKey.success || !members.success) {
    finish(studyId.data, "error", "Revisa la característica y las respuestas.", returnTo);
  }

  const workspace = await loadCategoryWorkspace(admin, studyId.data);
  if (!workspace) finish(studyId.data, "error", "El estudio ya no existe.", returnTo);
  const dimension = workspace.dimensions.find((entry) => entry.key === dimensionKey.data);
  if (!dimension) finish(studyId.data, "error", "Esa característica ya no existe.", returnTo);

  const candidateLabels = dimension.values
    .filter((value) => members.data.includes(foldSegmentValue(value.raw)))
    .map((value) => value.raw);
  if (candidateLabels.length < 2) {
    finish(studyId.data, "error", "Esas respuestas ya no están en el estudio.", returnTo);
  }

  const outcome = await consultAdvisor({
    tenantId: workspace.tenantId,
    contextSignature: dimension.contextSignature,
    groupKey: JSON.stringify(members.data),
    dimensionKey: dimension.key,
    dimensionLabel: dimension.label,
    optionCounts: new Map(dimension.values.map((value) => [value.raw, value.count])),
    candidateLabels,
  });

  revalidatePath(studioStudyCategories(studyId.data));
  if (!outcome.ok) finish(studyId.data, "error", outcome.message, returnTo);
  finish(
    studyId.data,
    "ok",
    "El asistente respondió. Su opinión aparece junto a la pareja; la decisión sigue siendo tuya.",
    returnTo,
  );
}
