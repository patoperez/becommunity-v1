import "server-only";

/**
 * The advisor as the application uses it: one place that owns the flags, the
 * provider, the per-tenant budget and the answer cache.
 *
 * WHY A CONSULTATION IS A SEPARATE ACT. The advisor is not consulted while the
 * review screen loads. A study can carry dozens of candidates and most of them
 * are answered in a second by looking at two strings — spending a request, a
 * few seconds and somebody's money on all of them, every time the page is
 * opened, would be waste dressed as helpfulness. A consultant asks for a second
 * opinion on the one pair that is genuinely unclear.
 *
 * HOW THE ANSWER SURVIVES THE REDIRECT. The Server Action consults, stores the
 * outcome in the isolate's cache, and redirects; the page then reads the cache
 * while rendering. The cache is bounded, keyed tenant-first and deliberately
 * not durable — an advisory opinion is not a record. The record is the decision
 * a person made, and the ledger stores the model, prompt and schema versions
 * alongside it.
 *
 * THE SECRET. Read from the environment at call time and handed to the adapter.
 * It is never returned, never logged, never stored and never placed in an error
 * message.
 */

import {
  advisorCacheKey,
  minimalPackage,
  type AdvisorPackage,
} from "./contract";
import { advisorAvailability, type AdvisorAvailability } from "./flags";
import { createOpenAiAdvisor } from "./openai";
import {
  FAILURE_MESSAGE,
  createAdvisorCache,
  createAdvisorLimiter,
  nullAdvisor,
  type AdvisorOutcome,
  type CategoryAdvisor,
} from "./provider";

/**
 * Module state, and why it is acceptable here.
 *
 * Both are per-isolate, hold no client data beyond a category label already
 * scoped by a tenant-first key, and are correctness-neutral: losing them costs
 * one extra request. Nothing in the product's behaviour depends on them
 * surviving, which is the test for whether module state is safe to keep.
 */
const cache = createAdvisorCache(200);
const limiter = createAdvisorLimiter({ perTenant: 40, windowMs: 60_000 });

/** How many consultations one request may run at once. */
export const MAX_CONCURRENT_CONSULTATIONS = 3;

export type AdvisorStatus =
  | { enabled: true; model: string }
  | { enabled: false; reason: string; detail: string };

export function advisorStatus(): AdvisorStatus {
  const availability = advisorAvailability();
  return availability.available
    ? { enabled: true, model: availability.model }
    : { enabled: false, reason: availability.reason, detail: availability.detail };
}

function providerFor(availability: AdvisorAvailability): CategoryAdvisor {
  if (!availability.available) return nullAdvisor(availability.detail);
  return createOpenAiAdvisor({
    apiKey: String(process.env.OPENAI_API_KEY ?? ""),
    model: availability.model,
    reasoningEffort: availability.reasoningEffort,
    timeoutMs: availability.timeoutMs,
  });
}

export type ConsultRequest = {
  tenantId: string;
  contextSignature: string;
  groupKey: string;
  dimensionKey: string;
  dimensionLabel: string | null;
  optionCounts: ReadonlyMap<string, number>;
  candidateLabels: readonly string[];
};

/** A previously obtained opinion for this exact question, if the isolate has one. */
export function cachedVerdict(request: {
  tenantId: string;
  contextSignature: string;
  groupKey: string;
}): AdvisorOutcome | null {
  const availability = advisorAvailability();
  if (!availability.available) return null;
  return cache.get(
    advisorCacheKey({
      tenantId: request.tenantId,
      model: availability.model,
      contextSignature: request.contextSignature,
      groupKey: request.groupKey,
    }),
  );
}

/**
 * Ask for a second opinion on one candidate.
 *
 * Order matters: availability, then the cache, then the budget, then the
 * network. A cached answer must not consume budget, and a request that the
 * budget refuses must not reach the provider.
 */
export async function consultAdvisor(request: ConsultRequest): Promise<AdvisorOutcome> {
  const availability = advisorAvailability();
  if (!availability.available) {
    return { ok: false, failure: "disabled", message: availability.detail };
  }

  const key = advisorCacheKey({
    tenantId: request.tenantId,
    model: availability.model,
    contextSignature: request.contextSignature,
    groupKey: request.groupKey,
  });
  const held = cache.get(key);
  if (held) return held;

  if (!limiter.take(request.tenantId)) {
    return { ok: false, failure: "rate_limited", message: FAILURE_MESSAGE.rate_limited };
  }

  const payload: AdvisorPackage = minimalPackage({
    dimensionKey: request.dimensionKey,
    dimensionLabel: request.dimensionLabel,
    optionCounts: request.optionCounts,
    candidateLabels: request.candidateLabels,
  });

  const outcome = await providerFor(availability).advise(payload);
  cache.set(key, outcome);
  return outcome;
}
