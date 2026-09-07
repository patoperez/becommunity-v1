"use server";

/**
 * THE EXPLICIT PREVIEW REFRESH — the only server call this screen makes, and
 * the only Server Action in the product that returns a value.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY IT RETURNS INSTEAD OF REDIRECTING.
 *
 * Every other Studio action in this repository ends in `redirect()` and reads
 * its outcome back from `?ok=` / `?error=`. That pattern is right for a
 * mutation: the row changed, the page should be re-read, and a redirect is the
 * cheapest way to say so.
 *
 * It is exactly wrong here. Unit 6B.1 is SESSION-ONLY: the document being
 * composed lives in browser memory and nowhere else. A redirect would remount
 * the page, and the author's work would be gone — not corrupted, not
 * conflicted, gone, with the product having thrown it away in response to a
 * button labelled "update the preview". So this action returns, the page does
 * not navigate, and the session survives.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT IT DOES BEFORE IT BELIEVES ANYTHING.
 *
 *   1. REVALIDATES THE SESSION ITSELF. It does not trust the page's gate. The
 *      user is fetched with `getUser()` — never `getSession()` — and the role is
 *      read from the database. A wrong role THROWS rather than redirects: a
 *      redirect from an action looks like success to the caller.
 *   2. VALIDATES THE SCOPE. The study id is parsed as a UUID and the study row
 *      is read back to recover its tenant, so the tenant is never taken from the
 *      request. A caller cannot name somebody else's tenant, because a caller
 *      does not get to name a tenant at all.
 *   3. TREATS THE DOCUMENT AS HOSTILE. It arrives as a JSON string from a
 *      browser and is parsed inside a try/catch and validated against the strict
 *      v4 schema before anything reads a field of it.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * AND IT WRITES NOTHING.
 *
 * No insert, update, upsert, delete, RPC, `revalidatePath` or draft. There is no
 * storage path in Unit 6B.1 at all; the existing legacy draft row is not read
 * and not touched. This action is a read that ends in a value.
 */

import { z } from "zod";

import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { resolveEditedPresentation } from "@/lib/studio/presentation-workspace";
import type { PreviewResult } from "@/lib/composer";

const uuid = z.string().uuid();
/**
 * A ceiling on the payload, checked before it is parsed.
 *
 * The definition column's own limit is 512 KiB and the schema bounds every
 * string inside a document, but `JSON.parse` runs before either of those can
 * speak. A megabyte of nested arrays is refused by length rather than by
 * exhausting the parser.
 */
const MAX_DOCUMENT_BYTES = 512 * 1024;

export async function refreshPresentationPreview(
  studyId: string,
  documentJson: string,
): Promise<PreviewResult> {
  // 1. AUTHORIZATION, redone here rather than inherited.
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Acceso denegado.");
  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("user_id", user.id)
    .maybeSingle<{ role: string }>();
  if (profile?.role !== "internal") throw new Error("Acceso denegado.");

  // 2. SCOPE, validated and then READ BACK rather than accepted.
  if (!uuid.safeParse(studyId).success) throw new Error("Estudio inválido.");
  const admin = createAdminClient();
  const { data: study, error } = await admin
    .from("study")
    .select("id, tenant_id, name")
    .eq("id", studyId)
    .maybeSingle<{ id: string; tenant_id: string; name: string }>();
  if (error) throw new Error(`study: ${error.message}`);
  if (!study) throw new Error("Estudio inválido.");

  // 3. THE DOCUMENT, as untrusted as anything that ever arrives from a browser.
  if (typeof documentJson !== "string" || documentJson.length > MAX_DOCUMENT_BYTES) {
    return {
      ok: false,
      unavailable: {
        reason: "presentation_unresolved",
        detail: "El documento enviado excede el tamaño que esta capa admite.",
      },
    };
  }
  let candidate: unknown;
  try {
    candidate = JSON.parse(documentJson);
  } catch {
    return {
      ok: false,
      unavailable: {
        reason: "presentation_unresolved",
        detail: "El documento enviado no es JSON válido.",
      },
    };
  }

  return resolveEditedPresentation(
    admin,
    { tenantId: study.tenant_id, studyId: study.id, studyName: study.name },
    candidate,
  );
}
