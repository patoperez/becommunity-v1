import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { CanonicalCommitParams, CommitTransport } from "./flow";
import { runCanonicalCommit, runCanonicalRollback } from "./flow";
import type { CanonicalCommitOutcome, CanonicalRollbackOutcome } from "./result";

/**
 * The SERVER-ONLY persistence adapter for a canonical package.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY `server-only` IS THE FIRST LINE. This is the only module in the unit that
 * holds a real database client. `import "server-only"` fails the BUILD if it is
 * ever reachable from a client component, which is a stronger guarantee than a
 * convention, and it is the same guard `src/lib/supabase/admin.ts` uses for the
 * service-role key itself.
 *
 * WHAT A BROWSER STILL CANNOT DO, even if this module leaked. Both RPCs are
 * revoked from `public`, `anon` and `authenticated` and granted only to
 * `service_role` (migration 0024), and every canonical table denies browser
 * roles outright with RLS and FORCE RLS (0022, 0023, 0024). A browser holding
 * this code and a session token still has no privilege to execute either
 * function or to read or write a single canonical row.
 *
 * WHAT THE SERVER ITSELF CANNOT DO. Skip the preflight. `runCanonicalCommit`
 * re-reads the EXACT uploaded bytes, re-runs the deterministic preflight over
 * them, and refuses to stage anything unless that run has zero blockers. There
 * is no parameter for a previously-computed report.
 * ─────────────────────────────────────────────────────────────────────────────
 */

function transportFor(client: SupabaseClient): CommitTransport {
  return {
    rpc: async (name, args) => {
      const { data, error } = await client.rpc(name, args);
      return { data, error };
    },
  };
}

export async function commitCanonicalPackage(
  client: SupabaseClient,
  params: CanonicalCommitParams,
): Promise<CanonicalCommitOutcome> {
  return runCanonicalCommit(transportFor(client), params);
}

export async function rollbackCanonicalPackage(
  client: SupabaseClient,
  importJobId: string,
  actorId?: string | null,
): Promise<CanonicalRollbackOutcome> {
  return runCanonicalRollback(transportFor(client), importJobId, actorId);
}

export type { CanonicalCommitFile, CanonicalCommitParams } from "./flow";
