/**
 * THE SHADOW WORKFLOW — the order of operations, with the canonical read
 * injected so every refusal and every failure can be executed offline.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE ORDER IS THE SAFETY PROPERTY, and it is this:
 *
 *   1. decide the policy from the environment and the scope;
 *   2. if it refuses, RETURN — without having named the canonical loader;
 *   3. otherwise race the canonical read against a strict budget;
 *   4. reduce anything thrown to a safe code;
 *   5. compare;
 *   6. return diagnostics BESIDE the legacy result, which is untouched.
 *
 * The legacy result is never an input to any of this. It is passed through, by
 * reference, and returned unchanged — the workflow cannot alter it because it
 * has no code that writes to it.
 *
 * WHY THE LOADER IS A FUNCTION AND NOT AN IMPORT. `loadCanonical` is supplied by
 * the caller, so this module holds no Supabase client, no credential and no
 * `server-only` marker, and the offline gate can prove "with the flag off the
 * canonical adapter is never called" by counting invocations of a fake instead
 * of arguing from the source text. `server.ts` supplies the real one.
 *
 * WHY THE BUDGET IS A RACE AND NOT A HOPE. A canonical read that hangs must not
 * hold a page. `Promise.race` against a timer bounds it; the timer is always
 * cleared, and the losing promise's rejection is swallowed deliberately so a
 * late failure cannot become an unhandled rejection after the page has already
 * answered. A timeout is reported as `canonical_timeout`, never as agreement.
 *
 * NOTHING HERE WRITES. There is no insert, no update, no RPC and no storage
 * call in this module or in anything it is allowed to be given: the transport
 * contract below exposes exactly one read.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { sha256Prefixed } from "../ingestion/canonical-commit/sha256";
import type { CanonicalStudyResults } from "../results/contract";
import type { StudyDashboardPayload } from "../dashboard/view";
import type { SegmentFilters } from "../calc/filters";
import { compareLegacyWithCanonical } from "./compare";
import { inertDiagnostics, type ShadowDiagnostics, type ShadowFinding, type ShadowStatus } from "./contract";
import { resolveShadowPolicy, type ShadowScope } from "./policy";

/** The ONE thing the shadow may ask the outside world to do. */
export type CanonicalReader = (scope: ShadowScope) => Promise<CanonicalStudyResults>;

export type ShadowRunParams = {
  scope: ShadowScope;
  legacy: StudyDashboardPayload;
  filters: SegmentFilters;
  env: Record<string, string | undefined>;
  loadCanonical: CanonicalReader;
  /** Injected so a test can drive elapsed time without sleeping. */
  now?: () => number;
};

/**
 * A stable digest of the filter selection.
 *
 * The VALUES never appear: a filter value is a segment label a respondent
 * carries, so the fingerprint is a hash and the dimension COUNT, which is
 * enough to tell two diagnostic sets apart without describing either.
 */
export function filterFingerprint(filters: SegmentFilters): string {
  const entries = Object.entries(filters ?? {})
    .filter(([, value]) => typeof value === "string" && value !== "")
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  if (entries.length === 0) return "sha256:unfiltered";
  return sha256Prefixed(JSON.stringify(entries));
}

/** True when the document has the shape the comparator needs. */
function isResultsDocument(value: unknown): value is CanonicalStudyResults {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<CanonicalStudyResults>;
  return (
    typeof candidate.contractVersion === "string" &&
    typeof candidate.study === "object" &&
    candidate.study !== null &&
    typeof candidate.population === "object" &&
    candidate.population !== null &&
    typeof (candidate.population as { total?: unknown }).total === "number" &&
    typeof candidate.recommendation === "object" &&
    Array.isArray((candidate.recommendation as { scopes?: unknown }).scopes) &&
    typeof candidate.renewal === "object" &&
    typeof candidate.journey === "object" &&
    Array.isArray((candidate.journey as { touchpoints?: unknown }).touchpoints) &&
    typeof candidate.filters === "object" &&
    Array.isArray((candidate.filters as { dimensions?: unknown }).dimensions) &&
    typeof candidate.performance === "object" &&
    typeof candidate.retention === "object" &&
    typeof candidate.qualitative === "object"
  );
}

class TimeoutSignal extends Error {}

/**
 * Race one promise against a budget.
 *
 * The loser is not abandoned silently: a late rejection is attached to a
 * no-op handler so it cannot surface as an unhandled rejection minutes after
 * the page has answered. A late RESOLUTION is simply discarded — the answer
 * arrived after the budget and is by definition not the answer this run may
 * use.
 */
async function withBudget<T>(work: Promise<T>, budgetMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    // The timer is deliberately NOT `unref`ed. `clearTimeout` in the `finally`
    // below is what stops it holding anything open, and it always runs; an
    // unreferenced timer would additionally fail to fire whenever the work it
    // is racing keeps nothing else alive — which is exactly the hung-read case
    // the budget exists for.
    timer = setTimeout(() => reject(new TimeoutSignal("budget")), budgetMs);
  });
  work.catch(() => undefined);
  try {
    return await Promise.race([work, timeout]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

function tally(findings: ShadowFinding[]): ShadowDiagnostics["counts"] {
  let compared = 0;
  let agreed = 0;
  let disagreed = 0;
  let classified = 0;
  for (const item of findings) {
    if (item.agrees === null) classified += 1;
    else {
      compared += 1;
      if (item.agrees) agreed += 1;
      else disagreed += 1;
    }
  }
  return { compared, agreed, disagreed, classified };
}

/**
 * Run the shadow comparison, or refuse.
 *
 * Returns SAFE diagnostics on every path. No branch returns a database
 * message, a stack, a workbook value or a respondent value — a thrown value is
 * reduced to one of the statuses in `contract.ts` and then discarded.
 */
export async function runShadowComparison(params: ShadowRunParams): Promise<ShadowDiagnostics> {
  const { scope, legacy, filters, env, loadCanonical } = params;
  const now = params.now ?? (() => Date.now());
  const policy = resolveShadowPolicy(env, scope);

  // The canonical loader is not named, let alone called, on a refusal path.
  if (!policy.allowed) {
    return inertDiagnostics(policy.reason, scope.tenantId, scope.studyId, policy.budgetMs);
  }

  const started = now();
  const base: Omit<ShadowDiagnostics, "status" | "elapsedMs" | "findings" | "counts"> = {
    tenantId: scope.tenantId,
    studyId: scope.studyId,
    filterFingerprint: filterFingerprint(filters),
    contractVersion: null,
    planFingerprint: null,
    packageIdempotencyKey: null,
    budgetMs: policy.budgetMs,
  };
  const fail = (status: Exclude<ShadowStatus, "compared">): ShadowDiagnostics => ({
    ...base,
    status,
    elapsedMs: now() - started,
    findings: [],
    counts: { compared: 0, agreed: 0, disagreed: 0, classified: 0 },
  });

  let document: unknown;
  try {
    document = await withBudget(loadCanonical(scope), policy.budgetMs);
  } catch (thrown) {
    return fail(thrown instanceof TimeoutSignal ? "canonical_timeout" : "canonical_transport_error");
  }

  // The shape check is INSIDE the guard, not before it. A malformed document
  // can be malformed by throwing — a getter that raises is exactly what a
  // half-deserialized or proxied value does — and a validator that ran outside
  // the catch would let that escape into the page it exists to protect.
  try {
    if (!isResultsDocument(document)) return fail("canonical_malformed");
  } catch {
    return fail("canonical_malformed");
  }

  try {
    const findings = compareLegacyWithCanonical(legacy, document, {
      filtered: Object.keys(filters ?? {}).length > 0,
    });
    return {
      ...base,
      status: "compared",
      contractVersion: document.contractVersion,
      planFingerprint: document.study.planFingerprint ?? null,
      packageIdempotencyKey: document.study.packageIdempotencyKey ?? null,
      elapsedMs: now() - started,
      findings,
      counts: tally(findings),
    };
  } catch {
    return fail("comparator_error");
  }
}
