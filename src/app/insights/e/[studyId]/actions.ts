"use server";

/**
 * THE ONE ACTION A CLIENT'S READING SURFACE MAY CALL.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY A SERVER ACTION AT ALL.
 *
 * A reader ticking a filter needs figures recomputed, and recomputing needs the
 * registry's address map and the study's canonical results — neither of which
 * may reach a browser. The only two ways to be called from a browser are a
 * Server Action and an HTTP route handler; route handlers are a public URL
 * surface and the dependency gate refuses them the canonical layer outright.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * IT ACCEPTS NO DOCUMENT, NO TENANT AND NO IDENTITY.
 *
 * Two arguments: a study id, and a viewer selection as a JSON STRING. The
 * selection is a list of panel ids, opaque handles and ordinal tokens — no
 * value, no dimension name, no address and no threshold — and it is capped,
 * parsed inside a try/catch, and validated on the server against what this
 * study's own publication offers.
 *
 * THE STRING IS DELIBERATE. A Server Action's arguments are deserialized before
 * anything validates them, and a string is the one shape that cannot arrive as
 * a half-parsed object.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * IT RE-AUTHORIZES, AND IT WRITES NOTHING.
 *
 * `getUser()` verifies the JWT with the Auth server; the request-scoped client
 * is what reads the study row, so RLS decides whether this person may see it at
 * all, and the tenant every publication read uses comes from that row rather
 * than from this request. There is no insert, update, upsert, delete, RPC or
 * revalidation in this file, and the workspace function it calls performs none
 * either.
 */

import { z } from "zod";

import { createClient } from "@/lib/supabase/server";
import {
  PUBLISHED_SELECTION_DETAIL,
  type PublishedPreviewResult,
} from "@/lib/publication";
import { previewPublishedPresentationUnderSelection } from "@/lib/studies/published-presentation";

/** The same cap the composer and the review surface use, for the same reason. */
const MAX_SELECTION_BYTES = 8192;

const STUDY_ID = z.string().uuid();

const refused = (): PublishedPreviewResult => ({
  ok: false,
  refusal: "selection_not_available",
  detail: PUBLISHED_SELECTION_DETAIL.selection_not_available,
});

export async function previewPublishedStudyUnderSelection(
  studyId: string,
  viewerJson: string,
): Promise<PublishedPreviewResult> {
  if (!STUDY_ID.safeParse(studyId).success) return refused();
  if (typeof viewerJson !== "string" || viewerJson.length > MAX_SELECTION_BYTES) return refused();

  let selection: unknown;
  try {
    selection = JSON.parse(viewerJson);
  } catch {
    return refused();
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return {
      ok: false,
      refusal: "recomputation_refused",
      detail: PUBLISHED_SELECTION_DETAIL.recomputation_refused,
    };
  }

  return await previewPublishedPresentationUnderSelection(supabase, studyId, selection);
}
