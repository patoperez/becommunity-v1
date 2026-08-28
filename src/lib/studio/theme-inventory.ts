import "server-only";

import type { createAdminClient } from "@/lib/supabase/admin";
import { themeOptions, type ThemeBearingRow, type ThemeOption } from "./theme-picker";
import { keysetWindow, selectAllPages } from "@/lib/supabase/paginate";

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

/** The theme columns plus the primary key, which is the keyset cursor. */
type KeyedThemeRow = ThemeBearingRow & { id: string };

export async function loadStudyThemeOptions(
  admin: ReturnType<typeof createAdminClient>,
  studyId: string,
): Promise<ThemeOption[]> {
  const data = await selectAllPages<KeyedThemeRow>(
    "study themes",
    (cursor, size) =>
      keysetWindow(
        admin
          .from("qual_observation")
          .select("id, theme, suggested_theme, confirmed_theme, review_status")
          .eq("study_id", studyId),
        { column: "id", cursor, size },
      ).returns<KeyedThemeRow[]>(),
    { maxRows: MAX_OBSERVATIONS, cursorOf: (row) => row.id },
  );
  return themeOptions(data);
}
