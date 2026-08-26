import "server-only";

import type { createAdminClient } from "@/lib/supabase/admin";
import { parseInterpretationContent, type InterpretationContent, type InterpretationState } from "./schema";

export type StudyInterpretation = {
  state: InterpretationState;
  draft: InterpretationContent | null;
  published: InterpretationContent | null;
  publishedAt: string | null;
};

export async function loadStudyInterpretation(
  admin: ReturnType<typeof createAdminClient>,
  studyId: string,
): Promise<StudyInterpretation> {
  const { data, error } = await admin.from("study_interpretation")
    .select("review_status, draft_content, published_content, published_at")
    .eq("study_id", studyId).maybeSingle<{
      review_status: InterpretationState;
      draft_content: unknown;
      published_content: unknown;
      published_at: string | null;
    }>();
  if (error && error.code !== "42P01" && error.code !== "PGRST205") throw new Error(`study_interpretation: ${error.message}`);
  return {
    state: data?.review_status ?? "draft",
    draft: parseInterpretationContent(data?.draft_content),
    published: parseInterpretationContent(data?.published_content),
    publishedAt: data?.published_at ?? null,
  };
}
