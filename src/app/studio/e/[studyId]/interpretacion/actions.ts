"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { interpretationContentSchema } from "@/lib/interpretation/schema";
import { loadInterpretationEvidence } from "@/lib/interpretation/evidence";
import { loadStudioStudy } from "@/lib/studio/study-workspace";
import { studioStudyInterpretation } from "@/lib/studio/routes";

const uuid = z.string().uuid();
const actionSchema = z.enum(["draft_saved", "submitted", "approved", "changes_requested", "published", "unpublished"]);

function finish(studyId: string, kind: "ok" | "error", message: string): never {
  redirect(`${studioStudyInterpretation(studyId)}?${kind}=${encodeURIComponent(message)}`);
}

export async function transitionInterpretation(formData: FormData) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { data: profile } = await supabase.from("profiles").select("role").eq("user_id", user.id).maybeSingle<{ role: string }>();
  if (profile?.role !== "internal") throw new Error("Acceso denegado.");

  const studyId = uuid.safeParse(formData.get("study_id"));
  const action = actionSchema.safeParse(formData.get("transition"));
  if (!studyId.success || !action.success) throw new Error("Solicitud inválida.");

  const admin = createAdminClient();
  let content: unknown = null;
  if (action.data === "draft_saved") {
    const evidence = formData.getAll("evidence").flatMap((item) => {
      try { return [JSON.parse(String(item))]; } catch { return []; }
    });
    const parsed = interpretationContentSchema.safeParse({
      version: 1,
      whatHappened: formData.get("what_happened"),
      whyItMatters: formData.get("why_it_matters"),
      whatNext: formData.get("what_next"),
      evidence,
    });
    if (!parsed.success) finish(studyId.data, "error", "Completa las tres partes de la lectura y revisa la evidencia elegida.");
    const workspace = await loadStudioStudy(admin, studyId.data);
    if (!workspace) finish(studyId.data, "error", "El estudio ya no existe.");
    const allowed = await loadInterpretationEvidence(admin, studyId.data, workspace.metricOptions, workspace.study.stages);
    const byKey = new Map(allowed.map((item) => [`${item.kind}:${item.ref}`, item]));
    const canonicalEvidence = parsed.data.evidence.map((item) => byKey.get(`${item.kind}:${item.ref}`));
    if (canonicalEvidence.some((item) => !item)) {
      finish(studyId.data, "error", "La evidencia elegida cambió; vuelve a seleccionarla.");
    }
    content = { ...parsed.data, evidence: canonicalEvidence };
  }

  const { error } = await admin.rpc("transition_study_interpretation", {
    p_study_id: studyId.data,
    p_actor: user.id,
    p_action: action.data,
    p_content: content,
  });
  if (error) finish(studyId.data, "error", `No se pudo actualizar la lectura: ${error.message}`);
  revalidatePath(studioStudyInterpretation(studyId.data));
  revalidatePath(`/studio/e/${studyId.data}/vista-cliente`);
  revalidatePath(`/insights/e/${studyId.data}`);
  const message = {
    draft_saved: "Borrador guardado.", submitted: "Lectura enviada a revisión.", approved: "Lectura aprobada.",
    changes_requested: "La lectura volvió a borrador.", published: "Lectura publicada para el cliente.",
    unpublished: "Lectura retirada; los resultados numéricos siguen publicados.",
  }[action.data];
  finish(studyId.data, "ok", message);
}
