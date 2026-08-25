import "server-only";

import type { createAdminClient } from "@/lib/supabase/admin";
import type { ReviewRow } from "@/components/studio/QualitativeReview";
import type { ThemeOption } from "./theme-picker";
import { loadStudyThemeOptions } from "./theme-inventory";
import { parseChoice, resolvePage, type PageRequest, type PageWindow } from "./paging";

/**
 * The qualitative review workspace, loaded once for both addresses (P8.2).
 *
 * `/admin/qualitative` and `/studio/e/[studyId]/cualitativo` are the same job at
 * two addresses, so they share this loader rather than drifting into two
 * implementations of the same human-review boundary.
 *
 * WHAT IT FIXES. The page used to read `.limit(100)` and render whatever came
 * back, with a caption that only said "se muestran las primeras 100" when the
 * count happened to land exactly on the limit. A study with 100 observations
 * and a study with 400 looked identical. Counting and paging are now explicit,
 * and both are scoped to one study with an `.eq()` on the query itself.
 */

export const REVIEW_STATES = ["pending", "confirmed", "rejected"] as const;
export type ReviewState = (typeof REVIEW_STATES)[number];

export const REVIEW_STATE_LABEL: Record<ReviewState, string> = {
  pending: "Pendientes",
  confirmed: "Confirmadas",
  rejected: "Descartadas",
};

export type QualitativeWorkspace = {
  rows: ReviewRow[];
  themes: ThemeOption[];
  counts: Record<ReviewState, number>;
  total: number;
  window: PageWindow;
  state: ReviewState | null;
};

type ObservationRow = {
  id: string;
  source: string | null;
  theme: string | null;
  quote: string | null;
  suggested_theme: string | null;
  confirmed_theme: string | null;
  confirmed_stage_key: string | null;
  review_status: ReviewState;
  quote_approved: boolean;
};

export function parseReviewState(raw: unknown): ReviewState | null {
  return parseChoice(raw, REVIEW_STATES);
}

export async function loadQualitativeWorkspace(
  admin: ReturnType<typeof createAdminClient>,
  studyId: string,
  { state, page }: { state: ReviewState | null; page: PageRequest },
): Promise<QualitativeWorkspace> {
  const countFor = async (value: ReviewState) => {
    const { count, error } = await admin
      .from("qual_observation")
      .select("id", { count: "exact", head: true })
      .eq("study_id", studyId)
      .eq("review_status", value);
    if (error) throw new Error(`qual_observation count: ${error.message}`);
    return count ?? 0;
  };

  const [pending, confirmed, rejected, themes] = await Promise.all([
    countFor("pending"),
    countFor("confirmed"),
    countFor("rejected"),
    loadStudyThemeOptions(admin, studyId),
  ]);
  const counts = { pending, confirmed, rejected };
  const total = pending + confirmed + rejected;
  const filteredTotal = state ? counts[state] : total;
  const view = resolvePage(page, filteredTotal);

  // The scope is applied on the query, never carried inside a generic filter
  // object: a study filter that can be forgotten is a study filter that will be.
  let query = admin
    .from("qual_observation")
    .select(
      "id, source, theme, quote, suggested_theme, confirmed_theme, confirmed_stage_key, review_status, quote_approved",
    )
    .eq("study_id", studyId);
  if (state) query = query.eq("review_status", state);
  const { data, error } = await query
    .order("created_at", { ascending: true })
    .order("id", { ascending: true })
    .range(view.from, view.to)
    .returns<ObservationRow[]>();
  if (error) throw new Error(`qual_observation page: ${error.message}`);

  return {
    rows: (data ?? []).map((row) => ({
      id: row.id,
      quote: row.quote,
      source: row.source,
      sourceTheme: row.theme,
      suggested: row.suggested_theme,
      confirmed: row.confirmed_theme,
      stageKey: row.confirmed_stage_key,
      status: row.review_status,
      quoteApproved: row.quote_approved,
    })),
    themes,
    counts,
    total,
    window: view,
    state,
  };
}
