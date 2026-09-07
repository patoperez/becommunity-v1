import "server-only";

import { parseJourneyDefinition } from "@/lib/calc/journey";
import type { SegmentFilters } from "@/lib/calc/filters";
import type { ConfirmedQualitative } from "@/lib/qualitative/published";
import { buildStudyDashboard, type StudyDashboardPayload } from "@/lib/dashboard/view";
import type { ShadowDiagnostics } from "@/lib/shadow/contract";
import { runStudyShadowComparison } from "@/lib/shadow/server";
import type { AuthorizedStudy } from "@/lib/studies/authorized";
import type { LongRow } from "@/lib/calc/engine";

/**
 * THE ONE APPROVED SERVER LOADER that may reach the shadow comparison.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT IT RETURNS, AND WHAT THE PAGE MAY USE. `legacy` is the EXACT payload
 * `buildStudyDashboard` produces from the exact same five arguments the page
 * used to pass it — same function, same order, same values, no wrapper around
 * the result. `shadow` is server-only diagnostics that the page must not read
 * and does not: `scripts/shadow-boundary-test.mjs` fails if any file under
 * `src/app` or `src/components` so much as names the field.
 *
 * WHY THE SHADOW CANNOT DELAY THE PAGE BEYOND ITS BUDGET. `runShadowComparison`
 * races the canonical read against a strict wall-clock budget and returns a
 * safe status on every failure path; the legacy payload is computed BEFORE it
 * and is passed by reference, so no branch of the shadow can change, delay past
 * the budget, or fail the value the page renders.
 *
 * WHY IT IS THE ONLY DOOR. A page importing `@/lib/canonical-source/*` directly
 * would put the canonical read one edit away from a React prop. This module is
 * the single edge in the dependency graph from the application to the canonical
 * layer, and the boundary gate asserts there is exactly one.
 *
 * DISABLED BY DEFAULT. With `BECOMMUNITY_SHADOW_MODE` unset — which is every
 * environment today — the canonical adapter is never constructed and never
 * called, and `shadow.status` is `disabled_by_flag`.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export type StudyDashboardWithShadow = {
  /** Byte-for-byte what the page rendered before this loader existed. */
  legacy: StudyDashboardPayload;
  /** SERVER-ONLY. Never a prop, never serialized, never in a response body. */
  shadow: ShadowDiagnostics;
};

export async function loadStudyDashboard(params: {
  study: Pick<AuthorizedStudy, "id" | "tenant_id" | "journey_definition" | "dashboard_config">;
  rows: LongRow[];
  qualitative: ConfirmedQualitative[];
  filters: SegmentFilters;
}): Promise<StudyDashboardWithShadow> {
  const { study, rows, qualitative, filters } = params;

  // Identical to the call this loader replaced, argument for argument.
  const legacy = buildStudyDashboard(
    rows,
    qualitative,
    parseJourneyDefinition(study.journey_definition),
    filters,
    study.dashboard_config,
  );

  const shadow = await runStudyShadowComparison({
    scope: { tenantId: study.tenant_id, studyId: study.id },
    legacy,
    filters,
  });

  return { legacy, shadow };
}
