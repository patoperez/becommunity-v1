/**
 * THE SHADOW WORKFLOW — the order of operations, with the canonical read
 * injected so every refusal and every failure can be executed offline.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE ORDER IS THE SAFETY PROPERTY, and it is this:
 *
 *   1. decide the policy from the environment and the scope;
 *   2. if it refuses, RETURN — without having named the canonical loader;
 *   3. otherwise start the canonical read WITH A CANCELLATION SIGNAL and race
 *      it against a strict budget;
 *   4. on a timeout, ABORT the read before returning;
 *   5. reduce anything thrown to a safe code;
 *   6. compare;
 *   7. return diagnostics BESIDE the legacy result, which is untouched.
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
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THE BUDGET NOW CANCELS. (Phase 3.1 — the correction.)
 *
 * Phase 3 raced the read against a timer and reported `canonical_timeout` when
 * the timer won. That bounded the PAGE, which is what it was written for, and
 * bounded nothing else: the losing promise was a Supabase read in flight, and
 * it stayed in flight — the socket open, the next page still to be requested,
 * the response still to be parsed — long after the request that asked for it
 * had answered. On a Worker, that is work billed to a request that no longer
 * exists and a connection held out of a pool of six.
 *
 * So the budget now owns an `AbortController`. The signal is handed to
 * `loadCanonical`, which threads it through the canonical adapter, the read
 * workflow, the transport and every paginated query down to
 * `PostgrestTransformBuilder.abortSignal`, which is the supported cancellation
 * API and puts the signal on the underlying `fetch`. When the timer fires the
 * controller is aborted FIRST and the rejection is raised second, so by the
 * time this function returns `canonical_timeout` the outstanding request has
 * been cancelled and the read loop has been told not to start another page.
 * The controller is also aborted in the `finally`, so an early return on any
 * other path leaves nothing running either.
 *
 * A late REJECTION is still swallowed — an aborted `fetch` rejects, and that
 * rejection arrives after this function has returned, so it is attached to a
 * no-op handler and can never become an unhandled rejection. A late RESOLUTION
 * is still discarded: an answer that arrived after the budget is by definition
 * not the answer this run may use.
 *
 * NOTHING HERE WRITES. There is no insert, no update, no RPC and no storage
 * call in this module or in anything it is allowed to be given: the reader
 * contract below is one function returning one document.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import type { CanonicalStudyResults } from "../results/contract";
import type { StudyDashboardPayload } from "../dashboard/view";
import type { SegmentFilters } from "../calc/filters";
import { compareLegacyWithCanonical } from "./compare";
import {
  inertDiagnostics,
  type ShadowDiagnostics,
  type ShadowFilterScope,
  type ShadowFinding,
  type ShadowStatus,
} from "./contract";
import { safeDimensionKeys } from "./diagnostics";
import { resolveShadowPolicy, type ShadowScope } from "./policy";

/**
 * The ONE thing the shadow may ask the outside world to do — and it must be
 * cancellable. The signal is not optional: a reader that ignored it would
 * reintroduce exactly the defect this signature exists to close.
 */
export type CanonicalReader = (
  scope: ShadowScope,
  options: { signal: AbortSignal },
) => Promise<CanonicalStudyResults>;

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
 * Describe the filter selection without describing it.
 *
 * Phase 3 hashed the `[key, value]` pairs with an unsalted SHA-256 and called
 * the result a fingerprint. It was not one. The values come from a catalogue
 * the same legacy payload publishes to the browser — thirteen dimensions whose
 * value spaces are single digits to low tens — so the whole space of realistic
 * selections is a few thousand strings and a dictionary reverses the digest
 * immediately. A hash that is trivially invertible is the value, stored in a
 * way that stops anybody noticing it is the value.
 *
 * What is recorded instead is what is genuinely safe and enough to tell two
 * diagnostic sets apart: WHETHER a filter was applied, HOW MANY dimensions it
 * constrained, and those dimension KEYS whose shape is conservative enough to
 * publish. Never a value, hashed or otherwise.
 */
export function describeFilterScope(filters: SegmentFilters): ShadowFilterScope {
  const keys = Object.entries(filters ?? {})
    .filter(([, value]) => typeof value === "string" && value !== "")
    .map(([key]) => key);
  const unique = [...new Set(keys)];
  return {
    filtered: unique.length > 0,
    dimensionKeys: safeDimensionKeys(unique),
    dimensionCount: unique.length,
  };
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

/** The reason a run was cut short by its budget. Never a message. */
export class TimeoutSignal extends Error {}

/**
 * Start one cancellable piece of work and bound it by a wall-clock budget.
 *
 * THE ORDER INSIDE THE TIMER IS ABORT, THEN REJECT. Rejecting first would
 * return `canonical_timeout` to a caller while the read it timed out on was
 * still running, which is the Phase 3 behaviour this replaces.
 *
 * AND THE VERDICT DOES NOT COME FROM WHO WON THE RACE, ON EITHER PATH.
 * `abort()` dispatches its listeners SYNCHRONOUSLY, so a reader that settles
 * from inside its own abort listener settles `work` before the timer's
 * `reject` settles `timeout`, and `Promise.race` hands back the reader's
 * answer. If it REJECTED, a budget expiry would be classified as a transport
 * error; if it RESOLVED, a document that arrived after the budget would be
 * used as though it had arrived in time — the worse of the two. `expired` is
 * set by the timer before it aborts and before it rejects, and it is checked
 * on both the fulfilled and the rejected path. A real `fetch` settles
 * asynchronously so neither bites in production, which is exactly why they
 * would have been defects nobody saw until they needed the number.
 *
 * ⚠️ AND `abort()` IS CALLED WITH NO ARGUMENT, WHICH IS NOT COSMETIC. A custom
 * abort reason replaces the platform's own `AbortError`, and PostgREST decides
 * whether a rejected `fetch` was cancelled by looking at exactly that:
 * `fetchError?.name === "AbortError" || fetchError?.code === "ABORT_ERR"`
 * (`@supabase/postgrest-js`). A reason it does not recognise is treated as a
 * NETWORK FAILURE, and because the read is a GET it is then retried three times
 * with backoff — so the budget would have issued three MORE requests after the
 * caller gave up, which is worse than the race it replaced. Measured against
 * the hosted project before this was fixed: three extra requests inside two
 * seconds. Nothing reads `signal.reason` anywhere in this codebase, so the
 * platform's default reason costs nothing and is the only one that works.
 *
 * The timer is deliberately NOT `unref`ed. `clearTimeout` in the `finally`
 * always runs and is what stops it holding anything open; an unreferenced timer
 * would additionally fail to fire whenever the work it is racing keeps nothing
 * else alive — which is exactly the hung-read case the budget exists for.
 */
async function withBudget<T>(start: (signal: AbortSignal) => Promise<T>, budgetMs: number): Promise<T> {
  const controller = new AbortController();
  let expired = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      expired = true;
      // NO ARGUMENT. See the header: a custom abort reason is not recognised as
      // an abort by PostgREST and gets the request RETRIED.
      controller.abort();
      reject(new TimeoutSignal("budget"));
    }, budgetMs);
  });

  let work: Promise<T>;
  try {
    work = Promise.resolve(start(controller.signal));
  } catch (thrown) {
    if (timer !== undefined) clearTimeout(timer);
    controller.abort();
    throw thrown;
  }
  // A late failure must not surface as an unhandled rejection minutes after the
  // page has answered. Attaching this handler does not consume the rejection
  // for the race below; it only guarantees the promise is never unhandled.
  work.catch(() => undefined);

  try {
    const value = await Promise.race([work, timeout]);
    // The clock, not the race. An answer that arrived after the budget is by
    // definition not the answer this run may use, however it got here.
    if (expired) throw new TimeoutSignal("budget");
    return value;
  } catch (thrown) {
    throw expired ? new TimeoutSignal("budget") : thrown;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    // On EVERY exit — success, timeout, transport failure — nothing may be left
    // running. Aborting an already-settled read is a no-op.
    controller.abort();
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
  const filterScope = describeFilterScope(filters);

  // The canonical loader is not named, let alone called, on a refusal path.
  if (!policy.allowed) {
    return inertDiagnostics(policy.reason, scope.tenantId, scope.studyId, policy.budgetMs, filterScope);
  }

  const started = now();
  const base: Omit<ShadowDiagnostics, "status" | "elapsedMs" | "findings" | "counts"> = {
    tenantId: scope.tenantId,
    studyId: scope.studyId,
    filterScope,
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
    document = await withBudget((signal) => loadCanonical(scope, { signal }), policy.budgetMs);
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
    const findings = compareLegacyWithCanonical(legacy, document, { filtered: filterScope.filtered });
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
