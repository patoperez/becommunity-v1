import type { CanonicalCommitPlan, PlanExpectedCounts, PlanFamily } from "./plan";
import { PLAN_FAMILIES } from "./plan";

/**
 * Count reconciliation.
 *
 * WHO IS AUTHORITATIVE. The database. `commit_canonical_package` measures every
 * family with PostgreSQL's own ROW_COUNT and refuses the transaction when a
 * measurement disagrees with the declared count, so a caller cannot talk the
 * database into believing it wrote more or fewer rows than it did.
 *
 * WHAT THIS MODULE ADDS. The same comparison on the way back, so a mismatch is
 * caught even if a future schema change made the database's own check
 * unreachable, and so the operator is told WHICH family disagreed rather than
 * being handed a bare failure. Two independent checks of the same invariant is
 * the point, not redundancy to be tidied away.
 *
 * The ownership keys the database adds (`_personsCreated`, `_personsReused`,
 * `_identifiersCreated`, `_identifiersReused`, `_ledgerRows`) are reported and
 * never reconciled: how many people already existed is a fact about the
 * database's history, not about this package.
 */

export const OWNERSHIP_COUNT_PREFIX = "_";

export type CountDisagreement = {
  family: string;
  expected: number | null;
  actual: number | null;
};

export type Reconciliation = {
  ok: boolean;
  disagreements: CountDisagreement[];
  /** Family counts the database measured, ownership detail excluded. */
  measured: Record<string, number>;
  /** Ownership and ledger detail, reported for the record. */
  ownership: Record<string, number>;
};

export function expectedCountsFor(plan: CanonicalCommitPlan): PlanExpectedCounts {
  const counts = {} as PlanExpectedCounts;
  for (const family of PLAN_FAMILIES) counts[family] = plan[family].length;
  return counts;
}

/** Every family the plan declares must be measured, and measured identically. */
export function reconcileCounts(
  expected: PlanExpectedCounts,
  reported: Record<string, unknown> | null | undefined,
): Reconciliation {
  const measured: Record<string, number> = {};
  const ownership: Record<string, number> = {};
  for (const [key, value] of Object.entries(reported ?? {})) {
    if (typeof value !== "number" || !Number.isInteger(value)) continue;
    if (key.startsWith(OWNERSHIP_COUNT_PREFIX)) ownership[key] = value;
    else measured[key] = value;
  }

  const disagreements: CountDisagreement[] = [];
  for (const family of PLAN_FAMILIES) {
    const declared = expected[family as PlanFamily];
    const actual = Object.prototype.hasOwnProperty.call(measured, family) ? measured[family] : null;
    if (actual !== declared) disagreements.push({ family, expected: declared, actual });
  }
  for (const family of Object.keys(measured)) {
    if (!(PLAN_FAMILIES as readonly string[]).includes(family)) {
      disagreements.push({ family, expected: null, actual: measured[family] });
    }
  }

  return { ok: disagreements.length === 0, disagreements, measured, ownership };
}
