import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { buildCanonicalStudyResults } from "../results/build";
import type { BuildResultsOptions } from "../results/build";
import type { CanonicalStudyResults } from "../results/contract";
import type { CanonicalResultSource } from "../results/source";
import { CANONICAL_RESULTS_SPECS } from "../results/spec";
import type { StudyResultsSpec } from "../results/spec";
import { canonicalResultSourceFromRows } from "./assemble";
import { postgrestReadTransport } from "./postgrest";
import type { PostgrestReadClient } from "./postgrest";
import { CanonicalReadError, loadCanonicalRowSet } from "./read";

/**
 * THE SERVER-ONLY READ ADAPTER for the canonical tables.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY `server-only` IS THE FIRST LINE. This is the only module in the folder
 * that holds a real database client. `import "server-only"` fails the BUILD if
 * it is ever reachable from a client component, which is stronger than a
 * convention, and it is the same guard `src/lib/supabase/admin.ts` uses for the
 * service-role key and `canonical-commit/adapter.ts` uses for the write path.
 *
 * WHAT A BROWSER STILL CANNOT DO, even if this module leaked. Every canonical
 * table denies `public`, `anon` and `authenticated` outright under RLS and
 * FORCE RLS (migrations 0026, 0027, 0028). A browser holding this code and a
 * session token still cannot read one canonical row. This boundary is the
 * first of two, not the only one.
 *
 * WHY THIS FILE IS SHORT. Everything that can be proved without a database
 * lives next door and is proved there: the reads and their ceilings in
 * `read.ts`, the query shape and the keyset filter in `postgrest.ts`, the
 * redaction in `assemble.ts`, the comparison order in `normalize.ts`. What is
 * left here is the one thing that genuinely needs a privileged client — and it
 * is exactly what `server-only` must guard.
 *
 * WHAT THIS RETURNS. An AGGREGATE document, or the neutral source behind it —
 * never a table row, never a person, never a word of free text. See `rows.ts`
 * for the columns that are never selected and `assemble.ts` for the ones that
 * are dropped after selection.
 *
 * NOTHING CLIENT-FACING IMPORTS THIS YET. The application still reads through
 * `src/lib/dashboard/view.ts`; switching a read path is separate, later work.
 * ─────────────────────────────────────────────────────────────────────────────
 */

export type LoadCanonicalSourceParams = {
  tenantId: string;
  studyId: string;
  /** Read exactly this package. Omitted, the study must have exactly one. */
  packageIdempotencyKey?: string;
  /** Override the study's results specification. Defaults to the registered one. */
  spec?: StudyResultsSpec;
};

/**
 * Read one committed package back out of the canonical tables as a read-model
 * source. Complete or not at all: a set larger than its declared ceiling, a
 * page that came back out of key order, or a study with anything but exactly
 * one committed package is a refusal, never a partial answer.
 */
export async function loadCanonicalResultSource(
  client: SupabaseClient,
  params: LoadCanonicalSourceParams,
): Promise<CanonicalResultSource> {
  const transport = postgrestReadTransport(client as unknown as PostgrestReadClient);
  const rows = await loadCanonicalRowSet(transport, {
    tenantId: params.tenantId,
    studyId: params.studyId,
    packageIdempotencyKey: params.packageIdempotencyKey,
  });
  const spec = params.spec ?? CANONICAL_RESULTS_SPECS[rows.specId];
  if (!spec) throw new CanonicalReadError("SPEC_NOT_REGISTERED");
  return canonicalResultSourceFromRows(rows, {
    spec,
    tenantId: params.tenantId,
    studyId: params.studyId,
  });
}

/**
 * The aggregate document, calculated from the canonical tables.
 *
 * The formulas are NOT reimplemented here and NOT computed in SQL: this reads
 * evidence, hands it to the one pure builder in `src/lib/results`, and returns
 * what that builder produced. There is no second place where a business metric
 * may be decided.
 */
export async function loadCanonicalStudyResults(
  client: SupabaseClient,
  params: LoadCanonicalSourceParams & { results?: BuildResultsOptions },
): Promise<CanonicalStudyResults> {
  const source = await loadCanonicalResultSource(client, params);
  return buildCanonicalStudyResults(source, { ...params.results, spec: params.spec ?? params.results?.spec });
}
