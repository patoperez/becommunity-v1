import "server-only";

import type { createAdminClient } from "@/lib/supabase/admin";
import { themeOptions, type ThemeBearingRow, type ThemeOption } from "./theme-picker";
import { selectAllPages } from "@/lib/supabase/paginate";

/**
 * The themes one study already carries, for the merge picker (P8.2).
 *
 * Read AFTER the caller has proved an internal role, with the already-created
 * admin client, exactly like the rest of the Studio backoffice.
 *
 * IT READS THE WHOLE STUDY, NOT THE PAGE. The review list is paged; the theme
 * vocabulary must not be. A picker that only offered the themes visible on page
 * three would invite a consultant to "create" a theme that already exists on
 * page one, which is precisely the duplication this workflow removes.
 *
 * Only the four theme columns and the review status are selected. No quote and
 * no respondent id is read here.
 */

const MAX_OBSERVATIONS = 100_000;

export async function loadStudyThemeOptions(
  admin: ReturnType<typeof createAdminClient>,
  studyId: string,
): Promise<ThemeOption[]> {
  const data = await selectAllPages<ThemeBearingRow>(
    "study themes",
    (from, to) =>
      admin
        .from("qual_observation")
        .select("theme, suggested_theme, confirmed_theme, review_status")
        .eq("study_id", studyId)
        .range(from, to)
        .returns<ThemeBearingRow[]>(),
    MAX_OBSERVATIONS,
  );
  return themeOptions(data);
}
