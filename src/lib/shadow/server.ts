import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { loadCanonicalStudyResults } from "@/lib/canonical-source/server";
import type { StudyDashboardPayload } from "@/lib/dashboard/view";
import type { SegmentFilters } from "@/lib/calc/filters";
import type { ShadowDiagnostics } from "./contract";
import { runShadowComparison } from "./orchestrate";
import type { ShadowScope } from "./policy";

/**
 * THE SERVER-ONLY ENTRY POINT for the shadow comparison.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY `server-only` IS THE FIRST LINE. This is the only module in the folder
 * that names a privileged client or the canonical read path. `import
 * "server-only"` fails the BUILD if it is ever reachable from a client
 * component, which is stronger than a convention and is the same guard
 * `supabase/admin.ts`, `canonical-source/adapter.ts` and
 * `canonical-commit/adapter.ts` use.
 *
 * WHY THIS FILE IS SHORT. Everything that can be decided without a database is
 * decided next door and proved there: the flag and the allowlist in
 * `policy.ts`, the order of operations and the budget in `orchestrate.ts`, the
 * comparison in `compare.ts`, the safe field list in `contract.ts`. What is
 * left here is the one thing that genuinely needs a connection.
 *
 * THE ADMIN CLIENT IS CREATED LAZILY, INSIDE THE READER. `runShadowComparison`
 * calls `loadCanonical` only after the flag and the exact tenant/study
 * allowlist have both passed, so a deployment with the shadow off never
 * constructs a service-role client for it at all.
 *
 * IT ONLY READS. `loadCanonicalStudyResults` pages `select`s scoped by tenant
 * and study; there is no insert, update, delete or RPC on this path, and the
 * boundary gate proves the reachable module graph contains none.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export async function runStudyShadowComparison(params: {
  scope: ShadowScope;
  legacy: StudyDashboardPayload;
  filters: SegmentFilters;
}): Promise<ShadowDiagnostics> {
  return runShadowComparison({
    scope: params.scope,
    legacy: params.legacy,
    filters: params.filters,
    env: process.env as Record<string, string | undefined>,
    loadCanonical: async (scope) =>
      loadCanonicalStudyResults(createAdminClient(), {
        tenantId: scope.tenantId,
        studyId: scope.studyId,
      }),
  });
}
