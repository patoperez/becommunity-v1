/**
 * THE POSTGREST QUERY SHAPE — pure, structural, and the only place a filter
 * string is ever built.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS IS SEPARATE FROM `adapter.ts`. The adapter is `server-only` because
 * it holds a real `SupabaseClient`. But the interesting part of it — the ORDER
 * of the calls (scope first, then window, then order, then limit) and the
 * composite keyset filter — is neither privileged nor transport-specific: it is
 * a pure function from a request to a chain of builder calls. Kept here, with
 * the client described STRUCTURALLY rather than imported, it can be exercised
 * by the offline gate against a fake builder that records what it was asked
 * for. A rule nobody can execute is a rule nobody is keeping.
 *
 * WHY THE FILTER STRING IS SAFE. A composite keyset is expressed to PostgREST
 * as `or=(a.gt.X,and(a.eq.X,b.gt.Y))`. `X` and `Y` are interpolated, so a value
 * carrying a comma, a dot or a parenthesis would be read as filter SYNTAX
 * rather than as data. Every key column of every read in `read.ts` is a
 * `uuid`; each value is re-checked against a strict uuid pattern immediately
 * before it is placed into the string, and anything else throws instead of
 * being sent, escaped or quoted. Check and use are deliberately not separated.
 *
 * WHY THE SCOPE IS APPLIED FIRST AND IS NOT OPTIONAL. `tenant_id` and
 * `study_id` are both filtered before any window is added, so a window can
 * never widen a scope. That matters more than usual on this path: the
 * connection this runs over is service-role and bypasses RLS, so the query IS
 * the tenant boundary.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { CanonicalReadError } from "./read";
import type { CanonicalReadRequest, CanonicalReadTransport } from "./read";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** The builder surface one page needs. Described, never imported. */
export type PostgrestScopedQuery = {
  eq(column: string, value: string): PostgrestScopedQuery;
  or(filter: string): PostgrestScopedQuery;
  order(column: string, options: { ascending: boolean }): PostgrestScopedQuery;
  limit(count: number): PostgrestScopedQuery;
};

/** The client surface one page needs. Described, never imported. */
export type PostgrestReadClient = {
  from(table: string): { select(columns: string): PostgrestScopedQuery };
};

export function requireUuid(value: unknown): string {
  if (typeof value !== "string" || !UUID.test(value)) throw new CanonicalReadError("READ_KEY_NOT_UUID");
  return value;
}

/**
 * The lexicographic "strictly after this tuple" window, as a PostgREST filter.
 *
 * One key column is a plain `gt`. Two is the standard expansion
 * `a > A OR (a = A AND b > B)` — exactly "the next rows in (a, b) order", which
 * can neither skip nor repeat a row across a page boundary. Three or more is
 * refused rather than approximated; no read in this folder needs one.
 */
export function keysetFilter(keyColumns: readonly string[], cursor: Record<string, string>): string {
  const values = keyColumns.map((column) => requireUuid(cursor[column]));
  if (keyColumns.length === 1) return `${keyColumns[0]}.gt.${values[0]}`;
  if (keyColumns.length === 2) {
    return `${keyColumns[0]}.gt.${values[0]},and(${keyColumns[0]}.eq.${values[0]},${keyColumns[1]}.gt.${values[1]})`;
  }
  throw new CanonicalReadError("READ_KEY_ARITY_UNSUPPORTED");
}

/** Bind a PostgREST-shaped client to the read workflow's transport contract. */
export function postgrestReadTransport(client: PostgrestReadClient): CanonicalReadTransport {
  return {
    readPage: async (request: CanonicalReadRequest) => {
      let query = client.from(request.table).select(request.columns.join(","));

      // Scope first, always. Tenant AND study, never one of the two.
      query = query
        .eq("tenant_id", requireUuid(request.scope.tenantId))
        .eq("study_id", requireUuid(request.scope.studyId));
      for (const [column, value] of Object.entries(request.equals ?? {})) query = query.eq(column, value);

      if (request.cursor !== null) query = query.or(keysetFilter(request.keyColumns, request.cursor));
      for (const column of request.keyColumns) query = query.order(column, { ascending: true });
      query = query.limit(request.limit);

      const answer = (await (query as unknown as PromiseLike<{
        data: Record<string, unknown>[] | null;
        error: unknown;
      }>)) ?? { data: null, error: null };
      return { rows: answer.data, error: answer.error };
    },
  };
}
