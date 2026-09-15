import "server-only";

/**
 * THE CATEGORY DECISION LEDGER — one read, three possible answers, and none of
 * them is a guess.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * IT IS NOT A CANONICAL READ, AND IT MUST NOT BECOME ONE.
 *
 * `canonical_category_decision` holds EDITORIAL DECISIONS, exactly as
 * `canonical_journey_pain_decision` does. It carries no canonical row
 * identifier, no foreign key into `survey_response`, `survey_item` or
 * `response_option`, and no evidence — only category LABELS a person selected
 * and the name they chose for them. This module therefore reaches no module
 * under `src/lib/canonical-source/`, adds no door, and the boundary gate's cut
 * is unaffected by it.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * A MISSING FUNCTION IS NOT A FAILED READ, AND A FAILED READ IS NOT AN EMPTY
 * ONE.
 *
 * Three states, because two is what cost Unit 6B.4B2J its release:
 *
 *   `ready`           — the ledger answered. Zero rows means zero rows.
 *   `not_provisioned` — migration 0034 is not applied in this environment, so
 *                       the function does not exist. PostgREST says `PGRST202`
 *                       and PostgreSQL says `42883`; either is a fact about
 *                       PROVISIONING. No decision can exist where nothing can
 *                       record one, so the empty resolution is exactly right —
 *                       and the screen says so rather than implying somebody
 *                       reviewed and found nothing.
 *   `unavailable`     — the read was attempted and failed: a timeout, a refusal,
 *                       a cancelled request, a runtime that would not make the
 *                       subrequest. The resolution is UNKNOWN, not empty, and
 *                       every surface that would have applied it refuses.
 *
 * The distinction is drawn on the ERROR CODE and never on an empty result, and
 * the failure's own message is classified into one of eight closed transport
 * codes rather than forwarded.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  TRANSPORT_FAILURE_DETAIL,
  classifyTransportFailure,
} from "@/lib/publication";
import {
  CATEGORY_DISPOSITIONS,
  EMPTY_CATEGORY_RESOLUTION,
  resolutionFrom,
  type CategoryDisposition,
  type CategoryLedgerState,
  type CategoryMemoryEntry,
  type CategoryResolution,
  type StoredCategoryDecision,
} from "@/lib/category-review";

/**
 * NAMED AS A LITERAL AT THE CALL SITE, and this constant is documentation only.
 *
 * An allowlist that reads string literals is defeated by `client.rpc(NAME, …)`:
 * the name leaves the call, the scan finds nothing, and «nothing» passes. The
 * composer gate counts `.rpc(` calls against `.rpc("literal"` ones for exactly
 * that reason, and it caught this file writing the constant.
 */
export const CATEGORY_LEDGER_READ_FUNCTION = "read_canonical_category_decisions";

/**
 * The codes that mean «this environment has not been migrated», and nothing
 * else.
 *
 * `PGRST202` is PostgREST's «no function matches»; `42883` is PostgreSQL's own
 * `undefined_function`, which arrives when the call reaches the database by a
 * path PostgREST did not screen. Neither can be produced by a network failure,
 * a timeout, a cancelled request or an authorization refusal, so widening this
 * list is the one edit that could turn a real failure back into «no decisions».
 */
const NOT_PROVISIONED_CODES = new Set(["PGRST202", "42883"]);

export type CategoryLedgerScope = { tenantId: string; studyId: string };

function isDisposition(value: unknown): value is CategoryDisposition {
  return typeof value === "string" && (CATEGORY_DISPOSITIONS as readonly string[]).includes(value);
}

function stringsOf(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
}

function decisionOf(entry: unknown): StoredCategoryDecision | null {
  if (typeof entry !== "object" || entry === null) return null;
  const row = entry as Record<string, unknown>;
  if (!isDisposition(row.disposition)) return null;
  if (typeof row.decisionId !== "string") return null;
  if (typeof row.familyKey !== "string") return null;
  if (typeof row.sourceDigest !== "string") return null;
  if (typeof row.decidedAt !== "string") return null;
  if (typeof row.version !== "number" || !Number.isInteger(row.version) || row.version < 1) return null;
  const memberFolds = stringsOf(row.memberFolds);
  if (memberFolds.length < 2) return null;
  return {
    decisionId: row.decisionId,
    familyKey: row.familyKey,
    memberFolds,
    memberLabels: stringsOf(row.memberLabels),
    sourceDigest: row.sourceDigest,
    disposition: row.disposition,
    canonicalKey: typeof row.canonicalKey === "string" ? row.canonicalKey : null,
    canonicalLabel: typeof row.canonicalLabel === "string" ? row.canonicalLabel : null,
    rationale: typeof row.rationale === "string" ? row.rationale : null,
    version: row.version,
    decidedAt: row.decidedAt,
  };
}

function memoryOf(entry: unknown): CategoryMemoryEntry | null {
  if (typeof entry !== "object" || entry === null) return null;
  const row = entry as Record<string, unknown>;
  if (!isDisposition(row.disposition)) return null;
  if (typeof row.familyKey !== "string") return null;
  if (typeof row.decidedAt !== "string") return null;
  const memberFolds = stringsOf(row.memberFolds);
  if (memberFolds.length < 2) return null;
  return {
    familyKey: row.familyKey,
    memberFolds,
    disposition: row.disposition,
    canonicalLabel: typeof row.canonicalLabel === "string" ? row.canonicalLabel : null,
    decidedAt: row.decidedAt,
  };
}

/** ONE outbound request, whatever the study holds. */
export async function readCategoryLedger(
  client: SupabaseClient,
  scope: CategoryLedgerScope,
): Promise<CategoryLedgerState> {
  const { data, error } = await client.rpc("read_canonical_category_decisions", {
    p_study_id: scope.studyId,
    p_tenant_id: scope.tenantId,
  });

  if (error) {
    const code = typeof error.code === "string" ? error.code : "";
    if (NOT_PROVISIONED_CODES.has(code)) return { kind: "not_provisioned" };
    const transport = classifyTransportFailure(error);
    return { kind: "unavailable", code: transport, detail: TRANSPORT_FAILURE_DETAIL[transport] };
  }

  // A SHAPE THAT IS NOT THE SHAPE IS A FAILURE, NOT AN EMPTY ANSWER. The
  // function returns a jsonb object with two keys; anything else means
  // something answered that is not this function.
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    return {
      kind: "unavailable",
      code: "DECODE_FAILED",
      detail: TRANSPORT_FAILURE_DETAIL.DECODE_FAILED,
    };
  }
  const payload = data as Record<string, unknown>;
  if (!Array.isArray(payload.decisions) || !Array.isArray(payload.memory)) {
    return {
      kind: "unavailable",
      code: "DECODE_FAILED",
      detail: TRANSPORT_FAILURE_DETAIL.DECODE_FAILED,
    };
  }

  const decisions: StoredCategoryDecision[] = [];
  for (const entry of payload.decisions) {
    const decision = decisionOf(entry);
    if (decision) decisions.push(decision);
  }
  const memory: CategoryMemoryEntry[] = [];
  for (const entry of payload.memory) {
    const recalled = memoryOf(entry);
    if (recalled) memory.push(recalled);
  }
  return { kind: "ready", decisions, memory };
}

/**
 * The projection a build applies, or a refusal.
 *
 * `not_provisioned` yields the EMPTY resolution deliberately: an environment
 * with no ledger has no decisions, so the empty projection is the true one and
 * every number is exactly what it was before this feature existed.
 */
export function resolutionOf(
  state: CategoryLedgerState,
): { ok: true; resolution: CategoryResolution } | { ok: false; code: string; detail: string } {
  if (state.kind === "unavailable") return { ok: false, code: state.code, detail: state.detail };
  if (state.kind === "not_provisioned") return { ok: true, resolution: EMPTY_CATEGORY_RESOLUTION };
  return { ok: true, resolution: resolutionFrom(state.decisions) };
}

/**
 * Thrown by the canonical loader when the ledger could not be read, so every
 * existing caller's `refusalFor` turns it into the typed unavailable it already
 * knows how to render. It carries a CLOSED code and a prepared sentence, never
 * the underlying message.
 */
export class CategoryLedgerError extends Error {
  readonly code: string;
  readonly detail: string;
  constructor(code: string, detail: string) {
    super(`category ledger unavailable: ${code}`);
    this.name = "CategoryLedgerError";
    this.code = code;
    this.detail = detail;
  }
}
