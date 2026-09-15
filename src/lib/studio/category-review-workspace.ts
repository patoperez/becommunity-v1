import "server-only";

/**
 * THE CANONICAL CATEGORY REVIEW WORKSPACE — what a person must decide, what it
 * would change, and what they decided.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * IT ADDS NO DOOR TO THE CANONICAL LAYER.
 *
 * Every name here that touches canonical data comes from
 * `./presentation-workspace`, the composer's declared loader, through a SINGLE
 * import statement — the same discipline `publication-workspace.ts` and
 * `journey-pain-workspace.ts` both follow, and for the same reason.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * NOTHING HERE MERGES ANYTHING.
 *
 * The scan produces QUESTIONS. It has no threshold above which it would act, no
 * confidence value anywhere on the path, and no branch that writes a decision a
 * person did not take. There is no AI on this path at all: no model, no
 * provider, no key, no prompt, no cache and no import that could reach one.
 * That is a product decision — «Do not add AI. Qualitative editing remains
 * human-controlled» — and it is enforced by a gate that reads this folder's
 * imports rather than by anybody remembering it.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE DIGESTS STAY HERE.
 *
 * A decision is stored against a SERVER-COMPUTED digest of the family's
 * vocabulary, and freshness is decided by comparing that stored digest with one
 * recomputed here on every load. The browser is told `sourceVersion` — five
 * bytes of it, base32 — so a reviewer can SEE that a family moved, and is never
 * believed about it. There is no parameter anywhere on this path by which a
 * caller could assert a digest.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * AND THE CANONICAL SOURCE IS NEVER WRITTEN.
 *
 * No function in this file inserts, updates, upserts or deletes anything in any
 * canonical table. The one write it makes goes through migration 0034's own
 * function, into a table that holds no foreign key into `survey_response` and
 * no canonical row identifier at all.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  CATEGORY_REFUSAL_DETAIL,
  candidateImpact,
  categoryFindings,
  countPanel,
  freshnessOf,
  refuseCategoryDecision,
  scanFamily,
  settledFolds,
  sortedFolds,
  type CategoryCount,
  type CategoryDecisionInput,
  type CategoryFamily,
  type CategoryFamilyPanel,
  type CategoryLedgerState,
  type CategoryRefusalCode,
  type CategoryReviewPanel,
  type DecidedGroup,
} from "@/lib/category-review";
// ONE IMPORT STATEMENT, ONE PATH, ONE DOOR. See the header.
import {
  buildCategorySourceCounts,
  categorySourceDigest,
  categorySourceVersion,
  readAndBuildWithLedger,
  refusalFor,
  type ComposerScope,
} from "./presentation-workspace";

/**
 * NAMED AS A LITERAL AT THE CALL SITE, for the reason `category-ledger.ts`
 * records: a scan that reads string literals is defeated by a constant.
 */
export const CATEGORY_WRITE_FUNCTION = "record_canonical_category_decision";

export type CategoryReviewUnavailable = {
  reason: "category_review_unavailable" | "no_canonical_package" | "canonical_read_refused";
  detail: string;
};

export type CategoryReviewWorkspace =
  | { ok: true; panel: CategoryReviewPanel }
  | { ok: false; unavailable: CategoryReviewUnavailable };

/* -------------------------------------------------------------------------- */
/* load                                                                        */
/* -------------------------------------------------------------------------- */

/**
 * ONE canonical read, ONE ledger read, and every consequence derived from them.
 *
 * The published side of each family — the terms a client would see now, the
 * documented exclusions and the base — comes from the results the loader
 * already built WITH the projection in force. The evidence side — the labels as
 * the source coded them — is the same builder run with the empty resolution, so
 * the two can never describe different studies.
 */
export async function loadCategoryReview(
  client: SupabaseClient,
  scope: ComposerScope,
): Promise<CategoryReviewWorkspace> {
  let built;
  try {
    built = await readAndBuildWithLedger(client, scope);
  } catch (thrown) {
    const refusal = refusalFor(thrown);
    return {
      ok: false,
      unavailable: {
        reason:
          refusal.reason === "no_canonical_package"
            ? "no_canonical_package"
            : "canonical_read_refused",
        detail: refusal.detail,
      },
    };
  }

  const { read, ledger } = built;
  const sourceCounts = buildCategorySourceCounts(read.source);
  const decisions = ledger.kind === "ready" ? ledger.decisions : [];
  const memory = ledger.kind === "ready" ? ledger.memory : [];

  const families: CategoryFamilyPanel[] = read.results.qualitative.groups.map((group) => {
    const sourceLabels: CategoryCount[] = sourceCounts.get(group.key) ?? [];
    const family: CategoryFamily = {
      key: group.key,
      label: group.label,
      coding: group.coding,
      sourceDescription: group.sourceDescription,
      terms: group.terms.map((term) => ({ label: term.label, count: term.count })),
      excluded: group.excluded.map((entry) => ({ label: entry.label, count: entry.count })),
      sourceLabels,
      total: group.total,
    };

    const digest = categorySourceDigest({
      key: family.key,
      coding: family.coding,
      sourceLabels: sourceLabels.map((entry) => entry.label),
      excludedLabels: family.excluded.map((entry) => entry.label),
    });

    const mine = decisions.filter((entry) => entry.familyKey === family.key);
    const scan = scanFamily(family.key, sourceLabels, settledFolds(mine, family.key));

    const decided: DecidedGroup[] = mine
      .map((decision) => ({
        decisionId: decision.decisionId,
        memberFolds: decision.memberFolds,
        memberLabels: decision.memberLabels,
        disposition: decision.disposition,
        canonicalLabel: decision.canonicalLabel,
        rationale: decision.rationale,
        version: decision.version,
        decidedAt: decision.decidedAt,
        freshness: freshnessOf(decision, family, digest),
        currentLabels: sourceLabels.filter((entry) =>
          decision.memberFolds.includes(entry.label.trim().replace(/\s+/g, " ").toLowerCase()),
        ),
      }))
      .sort((a, b) => (a.decidedAt < b.decidedAt ? 1 : -1));

    return {
      family,
      sourceVersion: categorySourceVersion(digest),
      scan,
      candidates: scan.candidates,
      findings: categoryFindings(family, scan),
      decided,
      memory: memory.filter((entry) => entry.familyKey === family.key),
    };
  });

  return {
    ok: true,
    panel: {
      families,
      // «This environment can record a decision» is a fact about provisioning,
      // and it is answered by the ledger rather than by the absence of rows.
      canDecide: ledger.kind === "ready",
      counts: countPanel(families),
    },
  };
}

/* -------------------------------------------------------------------------- */
/* write                                                                       */
/* -------------------------------------------------------------------------- */

export type CategoryDecisionResult =
  | { ok: true; created: boolean; version: number }
  | { ok: false; code: CategoryRefusalCode; detail: string };

/**
 * Record one decision.
 *
 * The workspace is RE-DERIVED from the database before anything is written, so
 * every rule is checked against the CURRENT state rather than against whatever
 * the browser was showing when the page was rendered — and the digest the
 * decision is stored against is the one this server just computed, never one a
 * caller supplied.
 *
 * `expectedVersion` is the version the screen displayed. It is the one number
 * the browser is believed about, and being believed about it is the point: if
 * it disagrees with the chain head, somebody else decided while the screen was
 * open and the write is refused rather than layered on top.
 */
export async function recordCategoryDecision(
  client: SupabaseClient,
  scope: ComposerScope,
  actorId: string,
  input: CategoryDecisionInput & { expectedVersion: number | null },
): Promise<CategoryDecisionResult> {
  const workspace = await loadCategoryReview(client, scope);
  if (!workspace.ok) {
    return { ok: false, code: "write_failed", detail: workspace.unavailable.detail };
  }
  if (!workspace.panel.canDecide) {
    return {
      ok: false,
      code: "ledger_not_provisioned",
      detail: CATEGORY_REFUSAL_DETAIL.ledger_not_provisioned,
    };
  }

  const entry = workspace.panel.families.find((item) => item.family.key === input.familyKey);
  const stored = entry
    ? entry.decided.map((decision) => ({
        decisionId: decision.decisionId,
        familyKey: entry.family.key,
        memberFolds: decision.memberFolds,
        memberLabels: decision.memberLabels,
        sourceDigest: "",
        disposition: decision.disposition,
        canonicalKey: null,
        canonicalLabel: decision.canonicalLabel,
        rationale: decision.rationale,
        version: decision.version,
        decidedAt: decision.decidedAt,
      }))
    : [];

  const refusal = refuseCategoryDecision(input, entry?.family, stored);
  if (refusal) return { ok: false, code: refusal, detail: CATEGORY_REFUSAL_DETAIL[refusal] };
  if (!entry) {
    return { ok: false, code: "family_unknown", detail: CATEGORY_REFUSAL_DETAIL.family_unknown };
  }

  const folds = sortedFolds(input.memberLabels);
  // THE SPELLINGS AS THEY STAND NOW, taken from the server's own inventory
  // rather than from the submitted strings, so the record shows what was
  // actually on screen and a caller cannot write a spelling the study does not
  // carry.
  const labels = entry.family.sourceLabels
    .filter((value) => folds.includes(value.label.trim().replace(/\s+/g, " ").toLowerCase()))
    .map((value) => value.label);

  const digest = categorySourceDigest({
    key: entry.family.key,
    coding: entry.family.coding,
    sourceLabels: entry.family.sourceLabels.map((value) => value.label),
    excludedLabels: entry.family.excluded.map((value) => value.label),
  });

  const label = input.disposition === "grouped" ? (input.canonicalLabel ?? "").trim() : null;
  const { data, error } = await client.rpc("record_canonical_category_decision", {
    p_study_id: scope.studyId,
    p_actor: actorId,
    p_family_key: entry.family.key,
    p_member_folds: folds,
    p_member_labels: labels,
    p_source_digest: digest,
    p_disposition: input.disposition,
    p_canonical_label: label,
    p_canonical_fold: label === null ? null : label.trim().replace(/\s+/g, " ").toLowerCase(),
    p_rationale: (input.rationale ?? "").trim() || null,
    p_expected_version: input.expectedVersion,
  });

  if (error) return { ok: false, ...writeRefusal(error) };
  const payload = (data ?? {}) as Record<string, unknown>;
  return {
    ok: true,
    created: payload.created === true,
    version: typeof payload.version === "number" ? payload.version : 0,
  };
}

/**
 * The database's refusal, mapped onto the SAME closed vocabulary the screen
 * already uses.
 *
 * The message is never forwarded: a caller learns which rule refused, not what
 * the database said about it. `55000` is the conflict code migrations 0024,
 * 0029 and 0031 all use; `23505` is the three-rule conflict; `42501` is the
 * authorization refusal the function makes before it reads anything.
 */
function writeRefusal(error: { code?: string; message?: string }): {
  code: CategoryRefusalCode;
  detail: string;
} {
  const code = typeof error.code === "string" ? error.code : "";
  if (code === "PGRST202" || code === "42883") {
    return {
      code: "ledger_not_provisioned",
      detail: CATEGORY_REFUSAL_DETAIL.ledger_not_provisioned,
    };
  }
  if (code === "42501") {
    return { code: "not_authorized", detail: CATEGORY_REFUSAL_DETAIL.not_authorized };
  }
  if (code === "23505") {
    return {
      code: "member_already_grouped",
      detail: CATEGORY_REFUSAL_DETAIL.member_already_grouped,
    };
  }
  if (code === "55000") {
    const message = typeof error.message === "string" ? error.message : "";
    if (message.includes("nothing to undo")) {
      return { code: "nothing_to_undo", detail: CATEGORY_REFUSAL_DETAIL.nothing_to_undo };
    }
    return { code: "stale_version", detail: CATEGORY_REFUSAL_DETAIL.stale_version };
  }
  return { code: "write_failed", detail: CATEGORY_REFUSAL_DETAIL.write_failed };
}

export type { CategoryLedgerState };
export { candidateImpact };
