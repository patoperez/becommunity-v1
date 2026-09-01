import { sha256Prefixed } from "./sha256";
import type { CanonicalCommitPlan } from "./plan";

/**
 * The commit-plan fingerprint.
 *
 * WHAT IT PROVES. That the payload the database is asked to write is the plan
 * the server projected from the exact bytes it preflighted. The fingerprint is
 * staged on `import_job.plan_fingerprint` before the commit; the commit refuses
 * a payload that declares a different one, so a job cannot be committed with a
 * plan it was never validated for.
 *
 * WHAT IT IS NOT. A secret, and not a substitute for authorization. Only
 * `service_role` may execute either RPC, and the database independently
 * digests the payload it actually received before storing it. The fingerprint
 * binds intent; the grants and the payload digest bind everything else.
 *
 * WHY THE SERIALISATION IS CANONICAL. `JSON.stringify` preserves insertion
 * order, so two structurally identical plans built by different code paths
 * would fingerprint differently. Keys are therefore sorted at every level.
 * ARRAY order is NOT sorted: the projector emits every family in a
 * deterministic order derived from sheet and coordinate, and re-ordering here
 * would hide a real change in that order.
 */

type Json = string | number | boolean | null | Json[] | { [key: string]: Json };

/** Deterministic JSON: object keys sorted, arrays untouched, undefined dropped. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

function canonicalize(value: unknown): Json {
  if (value === null || value === undefined) return null;
  if (Array.isArray(value)) return value.map(canonicalize);
  if (typeof value === "object") {
    const source = value as Record<string, unknown>;
    const out: { [key: string]: Json } = {};
    for (const key of Object.keys(source).sort()) {
      if (source[key] === undefined) continue;
      out[key] = canonicalize(source[key]);
    }
    return out;
  }
  if (typeof value === "number") {
    // A non-finite number cannot survive JSON and must not be silently nulled
    // into an absence: the projector never produces one, and this makes that
    // assumption visible rather than load-bearing.
    if (!Number.isFinite(value)) throw new RangeError("canonicalJson: non-finite number");
    return value;
  }
  if (typeof value === "string" || typeof value === "boolean") return value;
  throw new TypeError(`canonicalJson: unsupported value of type ${typeof value}`);
}

/**
 * `sha256:<64 hex>` over the plan with its own fingerprint field excluded.
 *
 * Excluding the field is what makes the value stable: including it would make
 * the fingerprint depend on whatever placeholder happened to be in the slot.
 */
export function commitPlanFingerprint(plan: CanonicalCommitPlan): string {
  const rest: Record<string, unknown> = { ...plan };
  delete rest.planFingerprint;
  return sha256Prefixed(canonicalJson(rest));
}

/** True when the plan still carries the fingerprint of its own contents. */
export function planFingerprintMatches(plan: CanonicalCommitPlan): boolean {
  return plan.planFingerprint === commitPlanFingerprint(plan);
}
