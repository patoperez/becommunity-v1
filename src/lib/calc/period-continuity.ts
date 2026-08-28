import { churnRate, retentionRate } from "./business-metrics";
import { roundTo } from "./metrics";

/**
 * Does a retention series hold together? (P9)
 *
 * A membership history is six independent rows, and nothing in the schema makes
 * period N+1 start where period N ended. The real Cuicuilco series ends its
 * first period with 21 members and starts its second with 22.
 *
 * THIS MODULE DOES NOT DECIDE WHAT THAT MEANS. A discontinuity is a QUESTION
 * for the person who owns the chapter's roster, not an error:
 *
 *   - a member approved between one period closing and the next opening is a
 *     legitimate +1 that no row is wrong about;
 *   - a mistyped opening count is a defect;
 *   - and only the source can tell them apart.
 *
 * Treating every gap as a defect would invite someone to "fix" the number until
 * the sequence looked tidy, which is how a real membership event gets erased.
 * So this reports, with the arithmetic attached, and a human answers.
 *
 * The ARITHMETIC, by contrast, is not a question. Within one period
 * `ending = starting - lost + new` must hold, and the two published rates must
 * be what the canonical functions produce at the declared precision. A row that
 * fails those is wrong, whatever the source says.
 *
 * Both are INTERNAL findings. A client is never shown "these two rows disagree"
 * — they are shown a history the firm has checked.
 */

export type PeriodRow = {
  periodLabel: string;
  periodOrder: number;
  startingMembers: number;
  newMembers: number;
  endingMembers: number;
  lostMembers: number;
  retention: number;
  churn: number;
};

export type ContinuityFinding = {
  kind: "continuity";
  fromLabel: string;
  toLabel: string;
  endingMembers: number;
  startingMembers: number;
  /** Positive: the next period opened with MORE members than the last one closed with. */
  difference: number;
};

export type ArithmeticFinding = {
  kind: "arithmetic";
  periodLabel: string;
  field: "endingMembers" | "retention" | "churn";
  stored: number;
  expected: number;
};

export type PeriodFinding = ContinuityFinding | ArithmeticFinding;

/**
 * The precision the SERIES IS STORED AT: migration 0019 declares
 * `retention_rate numeric(7,2)`, and the import writes the rate the source
 * workbook authored. Comparing a stored rate against the canonical formula at
 * any other precision would report a rounding difference as a defect.
 */
const STORED_DECIMALS = 2;

/** Order-independent: the caller's rows are sorted by declared period order. */
function ordered<T extends PeriodRow>(rows: readonly T[]): T[] {
  return [...rows].sort((a, b) => a.periodOrder - b.periodOrder);
}

/**
 * Where a period opens with a different roster than the previous one closed
 * with. Consecutive by `periodOrder` only — a gap in the ORDER is a series with
 * a period missing, which is a different question and not one this answers.
 */
export function continuityFindings(rows: readonly PeriodRow[]): ContinuityFinding[] {
  const sorted = ordered(rows);
  const findings: ContinuityFinding[] = [];
  for (let i = 1; i < sorted.length; i += 1) {
    const previous = sorted[i - 1];
    const current = sorted[i];
    if (current.periodOrder !== previous.periodOrder + 1) continue;
    if (current.startingMembers === previous.endingMembers) continue;
    findings.push({
      kind: "continuity",
      fromLabel: previous.periodLabel,
      toLabel: current.periodLabel,
      endingMembers: previous.endingMembers,
      startingMembers: current.startingMembers,
      difference: current.startingMembers - previous.endingMembers,
    });
  }
  return findings;
}

/**
 * Rows whose own numbers do not add up, or whose published rates are not what
 * the canonical functions produce. Unlike a discontinuity, these are defects.
 */
export function arithmeticFindings(rows: readonly PeriodRow[]): ArithmeticFinding[] {
  const findings: ArithmeticFinding[] = [];
  for (const row of ordered(rows)) {
    const expectedEnding = row.startingMembers - row.lostMembers + row.newMembers;
    if (row.endingMembers !== expectedEnding) {
      findings.push({
        kind: "arithmetic",
        periodLabel: row.periodLabel,
        field: "endingMembers",
        stored: row.endingMembers,
        expected: expectedEnding,
      });
      // The rates are derived from these counts, so re-checking them against a
      // row that already contradicts itself would only add noise.
      continue;
    }
    if (row.startingMembers === 0) continue;
    // The canonical functions define WHAT the rate is; their numerator and
    // denominator are reused here so no formula is restated, and only the
    // PRECISION changes to the one the column stores.
    const retention = retentionRate(row.startingMembers, row.endingMembers, row.newMembers);
    const churn = churnRate(row.startingMembers, row.lostMembers);
    // A zero denominator means the canonical function declined to divide.
    // There is nothing to compare against, and inventing a comparison would be
    // worse than saying nothing.
    if (retention.denominator === 0 || churn.denominator === 0) continue;
    const expectedRetention = roundTo((retention.numerator / retention.denominator) * 100, STORED_DECIMALS);
    const expectedChurn = roundTo((churn.numerator / churn.denominator) * 100, STORED_DECIMALS);
    if (row.retention !== expectedRetention) {
      findings.push({
        kind: "arithmetic",
        periodLabel: row.periodLabel,
        field: "retention",
        stored: row.retention,
        expected: expectedRetention,
      });
    }
    if (row.churn !== expectedChurn) {
      findings.push({
        kind: "arithmetic",
        periodLabel: row.periodLabel,
        field: "churn",
        stored: row.churn,
        expected: expectedChurn,
      });
    }
  }
  return findings;
}

export function periodFindings(rows: readonly PeriodRow[]): PeriodFinding[] {
  return [...arithmeticFindings(rows), ...continuityFindings(rows)];
}

/** One internal sentence per finding. Never shown to a client. */
export function describeFinding(finding: PeriodFinding): string {
  if (finding.kind === "continuity") {
    const direction = finding.difference > 0 ? "más" : "menos";
    return (
      `“${finding.toLabel}” abre con ${finding.startingMembers} miembros y ` +
      `“${finding.fromLabel}” cerró con ${finding.endingMembers}: ` +
      `${Math.abs(finding.difference)} ${direction}. Puede ser un alta registrada entre el ` +
      "cierre de un periodo y la apertura del siguiente, o un dato mal capturado. " +
      "Confírmalo contra la fuente antes de publicar; no lo ajustes para que la serie cuadre."
    );
  }
  return (
    `“${finding.periodLabel}”: ${finding.field} guardado ${finding.stored}, ` +
    `calculado ${finding.expected}. La fila no cuadra consigo misma.`
  );
}

/**
 * The series as a client should SEE it: every rate derived once, from the
 * counts, by the canonical function, at the precision the policy declares.
 *
 * WHY NOT SHOW THE STORED RATE. `docs/CALCULATION_POLICY.md` declares
 * percentages at `DECIMALS.percent` and requires every value to be rounded
 * exactly ONCE. The stored rate has already been rounded once — the source
 * workbook authored 0.727272…, and `numeric(7,2)` kept 72.73. Rendering that
 * and then rounding it again to the declared precision is a double rounding,
 * and a double rounding is not always the same number as a single one
 * (72.749… stores as 72.75 and displays as 72.8; rounded once it is 72.7).
 *
 * The counts are exact integers, so deriving the rate from them here is one
 * rounding of an exact input. The stored rate stays untouched in the database,
 * where it is the source's authored value and what reconciliation compares.
 * When the two disagree, `arithmeticFindings` says so — internally.
 */
export function canonicalPeriodPoints<T extends PeriodRow>(rows: readonly T[]): T[] {
  return ordered(rows).map((row) => {
    if (row.startingMembers === 0) return { ...row };
    const retention = retentionRate(row.startingMembers, row.endingMembers, row.newMembers).value;
    const churn = churnRate(row.startingMembers, row.lostMembers).value;
    return {
      ...row,
      retention: retention ?? row.retention,
      churn: churn ?? row.churn,
    };
  });
}
