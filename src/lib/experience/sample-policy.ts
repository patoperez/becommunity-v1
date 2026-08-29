/**
 * How small a base may be before the product stops showing the number.
 *
 * WHAT CHANGED, AND WHY IT IS A PRODUCT DECISION RATHER THAN A BUG FIX.
 *
 * Until now the answer was a constant: fewer than five distinct responses and
 * the result disappeared, everywhere, for every study, with no way to say
 * otherwise (`src/lib/calc/disclosure.ts`). That rule was written for a
 * school-survey study where a cell of three is three identifiable children.
 * It is the wrong default for a study whose whole population is eleven people
 * and who commissioned the work to see those eleven answers: there the rule
 * does not protect anybody, it deletes the deliverable.
 *
 * So the constant becomes an explicit, versioned, per-study POLICY with three
 * modes, and the owner's decision is that a NEWLY COMPOSED experience defaults
 * to `show_all`.
 *
 *   show_all    aggregated results are visible from n = 1.
 *   warn_below  the value is shown, and a result under the threshold is marked
 *               as resting on few answers.
 *   hide_below  a result under the threshold is withheld.
 *
 * WHAT DID NOT CHANGE, AND MUST NOT.
 *
 *  - Nothing here is a security boundary. Tenant isolation, RLS, the
 *    server-side authorization on every route and mutation, and the rule that
 *    raw personal data never crosses to a client are not configurable, are not
 *    reachable from this file, and are unaffected by any mode. This policy
 *    decides whether an AGGREGATE is rendered; it never decides who may ask.
 *
 *  - Every study that exists today keeps the behaviour it has today. The
 *    legacy rule is preserved verbatim as `LEGACY_SAMPLE_POLICY`, the
 *    compatibility adapter stamps it onto every definition it derives from an
 *    existing study, and the deployed client routes are untouched by this
 *    module. A published snapshot carries the policy it was published under, so
 *    a report already on a client's desk cannot change because somebody edited
 *    a preference afterwards.
 *
 *  - The evaluation returns a STATE, not a sentence. Copy belongs to
 *    `src/lib/language/sample.ts`; a calculation that carries its own wording
 *    is a calculation that has to be re-tested every time the wording changes.
 */

import { sampleVisibility, DEFAULT_MINIMUM_SAMPLE_SIZE } from "@/lib/calc/disclosure";

export const SAMPLE_POLICY_MODES = ["show_all", "warn_below", "hide_below"] as const;
export type SamplePolicyMode = (typeof SAMPLE_POLICY_MODES)[number];

/**
 * Versioned on purpose. A stored policy is read back by code that may be older
 * or newer than the code that wrote it, and "which rule produced this number"
 * is a question a published study has to be able to answer years later.
 */
export const SAMPLE_POLICY_VERSION = 1;

export type SampleVisibilityPolicy = {
  policyVersion: typeof SAMPLE_POLICY_VERSION;
  mode: SamplePolicyMode;
  /**
   * The count a result must reach. Meaningful for `warn_below` and
   * `hide_below`; carried but unused under `show_all`, so that switching modes
   * back and forth does not lose the number the operator chose.
   */
  threshold: number;
};

/** What a NEW experience gets. The owner's decision, stated once. */
export const DEFAULT_SAMPLE_POLICY: SampleVisibilityPolicy = {
  policyVersion: SAMPLE_POLICY_VERSION,
  mode: "show_all",
  threshold: DEFAULT_MINIMUM_SAMPLE_SIZE,
};

/**
 * The rule every study built before the composer runs under, unchanged.
 * The adapter stamps this, never the new default: an existing study's
 * behaviour changes only when a person deliberately changes it.
 */
export const LEGACY_SAMPLE_POLICY: SampleVisibilityPolicy = {
  policyVersion: SAMPLE_POLICY_VERSION,
  mode: "hide_below",
  threshold: DEFAULT_MINIMUM_SAMPLE_SIZE,
};

/** A block either inherits the study's policy or states its own. */
export type SamplePolicyOverride =
  | { kind: "inherit" }
  | { kind: "override"; policy: SampleVisibilityPolicy };

export const INHERIT_SAMPLE_POLICY: SamplePolicyOverride = { kind: "inherit" };

export type SampleState = "no_data" | "visible" | "warning" | "suppressed";

export type SampleOutcome = {
  state: SampleState;
  /**
   * The count, when the outcome permits revealing it, and null when it does
   * not. A suppressed result never carries its own n: publishing "hidden,
   * n = 3" hides the value and announces the base, which is the half that
   * identifies people.
   */
  disclosedSampleSize: number | null;
  /** The threshold that decided this, or null when no threshold applied. */
  threshold: number | null;
  mode: SamplePolicyMode;
  /** Machine-readable, for gates and telemetry. Never shown to a reader. */
  reason:
    | "no_responses"
    | "policy_shows_all"
    | "at_or_above_threshold"
    | "below_threshold";
};

function assertPolicy(policy: SampleVisibilityPolicy): void {
  if (policy.policyVersion !== SAMPLE_POLICY_VERSION) {
    throw new RangeError(`unsupported sample policy version ${policy.policyVersion}`);
  }
  if (!SAMPLE_POLICY_MODES.includes(policy.mode)) {
    throw new RangeError(`unsupported sample policy mode ${policy.mode}`);
  }
  if (!Number.isSafeInteger(policy.threshold) || policy.threshold < 1) {
    throw new RangeError("sample policy threshold must be a positive safe integer");
  }
}

/** The policy that actually governs one block: its own, or the study's. */
export function resolveSamplePolicy(
  study: SampleVisibilityPolicy,
  override: SamplePolicyOverride | null | undefined,
): SampleVisibilityPolicy {
  if (override && override.kind === "override") return override.policy;
  return study;
}

/**
 * THE canonical evaluation. One function, one place, independently tested.
 *
 * Every surface that decides whether to draw a number asks this and reads the
 * state; no surface re-implements "is five enough".
 */
export function evaluateSampleVisibility(
  sampleSize: number,
  policy: SampleVisibilityPolicy,
): SampleOutcome {
  if (!Number.isSafeInteger(sampleSize) || sampleSize < 0) {
    throw new RangeError("sampleSize must be a non-negative safe integer");
  }
  assertPolicy(policy);

  // No answers is not a disclosure decision. It is the absence of a result,
  // and it reads the same under every mode.
  if (sampleSize === 0) {
    return {
      state: "no_data",
      disclosedSampleSize: 0,
      threshold: null,
      mode: policy.mode,
      reason: "no_responses",
    };
  }

  if (policy.mode === "show_all") {
    return {
      state: "visible",
      disclosedSampleSize: sampleSize,
      threshold: null,
      mode: policy.mode,
      reason: "policy_shows_all",
    };
  }

  const below = sampleSize < policy.threshold;
  if (!below) {
    return {
      state: "visible",
      disclosedSampleSize: sampleSize,
      threshold: policy.threshold,
      mode: policy.mode,
      reason: "at_or_above_threshold",
    };
  }

  if (policy.mode === "warn_below") {
    return {
      state: "warning",
      disclosedSampleSize: sampleSize,
      threshold: policy.threshold,
      mode: policy.mode,
      reason: "below_threshold",
    };
  }

  return {
    state: "suppressed",
    disclosedSampleSize: null,
    threshold: policy.threshold,
    mode: policy.mode,
    reason: "below_threshold",
  };
}

/**
 * The same question answered the way the deployed product answers it today.
 *
 * It exists so the equivalence can be ASSERTED rather than assumed: a gate
 * walks every base from zero upwards and requires this function and
 * `evaluateSampleVisibility(n, LEGACY_SAMPLE_POLICY)` to agree about what is
 * withheld. If a future edit to either rule breaks that agreement, a legacy
 * study's behaviour has changed and the gate says so.
 */
export function legacySampleState(sampleSize: number): SampleState {
  const visibility = sampleVisibility(sampleSize);
  if (visibility === "no-data") return "no_data";
  if (visibility === "suppressed") return "suppressed";
  // `caution` is a note ABOUT a shown value, not a withholding. Under the
  // policy model that is the same thing `warn_below` produces, but the legacy
  // caution threshold is a separate, unchanged concern: what this function
  // reports is whether the value is shown.
  return "visible";
}
