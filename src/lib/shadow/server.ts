import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { loadCanonicalStudyResults } from "@/lib/canonical-source/server";
import type { StudyDashboardPayload } from "@/lib/dashboard/view";
import type { SegmentFilters } from "@/lib/calc/filters";
import type { ShadowDiagnostics } from "./contract";
import { runShadowComparison } from "./orchestrate";
import type { ShadowScope } from "./policy";
import { recordShadowRun } from "./sink";

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
 * comparison in `compare.ts`, the safe field list in `contract.ts` and the
 * runtime projection in `diagnostics.ts`. What is left here is the one thing
 * that genuinely needs a connection.
 *
 * THE ADMIN CLIENT IS CREATED LAZILY, INSIDE THE READER. `runShadowComparison`
 * calls `loadCanonical` only after the flag and the exact tenant/study
 * allowlist have both passed, so a deployment with the shadow off never
 * constructs a service-role client for it at all.
 *
 * THE BUDGET'S SIGNAL GOES ALL THE WAY DOWN. The reader receives the
 * orchestrator's `AbortSignal` and hands it to `loadCanonicalStudyResults`,
 * which threads it through the read workflow and onto every paginated query's
 * `PostgrestTransformBuilder.abortSignal`. A read this process has stopped waiting for is CANCELLED, not
 * abandoned — see the header of `orchestrate.ts` for why Phase 3's race alone
 * was not enough.
 *
 * ⚠️ THE CANONICAL DOCUMENT IS ALWAYS UNFILTERED. The read is scoped by tenant
 * and study and by nothing else; the request's legacy filter selection is NOT
 * applied and cannot be, because no authority maps a legacy segment key onto a
 * canonical attribute key. `compare.ts` is what makes that safe: under an
 * active filter it refuses to compare any quantity the filter touches instead
 * of comparing a filtered legacy number with this unfiltered document.
 *
 * THE SINK IS A NO-OP UNLESS A PROGRAM IN THIS PROCESS INSTALLED ONE.
 * `recordShadowRun` returns immediately when nothing is installed, which is
 * every deployment; when something is, it receives codes and totals only. It
 * swallows its own failures — including a rejection from an `async` sink, which
 * a plain `catch` would not have caught — so it cannot alter or fail what this
 * function returns.
 *
 * ⚠️ IT IS NOT COVERED BY THE BUDGET. It runs after the budget is spent, on the
 * awaited path, and `withBudget` bounds only the canonical read. Returning
 * `void` says nothing about latency: a slow installed sink would add its time
 * to the page. The only installer in this repository pushes onto a bounded
 * in-memory ring buffer, and any future one must be as cheap.
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
  const diagnostics = await runShadowComparison({
    scope: params.scope,
    legacy: params.legacy,
    filters: params.filters,
    env: process.env as Record<string, string | undefined>,
    loadCanonical: async (scope, options) =>
      loadCanonicalStudyResults(createAdminClient(), {
        tenantId: scope.tenantId,
        studyId: scope.studyId,
        signal: options.signal,
      }),
  });
  recordShadowRun(diagnostics);
  return diagnostics;
}
