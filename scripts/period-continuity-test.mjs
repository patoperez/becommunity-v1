// =============================================================================
// MANDATORY retention-series gate
//   npx tsx scripts/period-continuity-test.mjs
// =============================================================================
// A membership history is a set of independent rows. Two different things can
// be wrong with it, and treating them the same way is how a real membership
// event gets erased:
//
//   ARITHMETIC is a defect. ending = starting - lost + new must hold, and the
//   published rates must be what the canonical functions produce.
//
//   A DISCONTINUITY is a question. A period opening with a different roster
//   than the last one closed with may be a member approved between the two
//   dates, or a mistyped count. Only the source can say. The gate proves it is
//   REPORTED, and proves nothing "corrects" it.
//
// The six-period fixture reproduces the real Cuicuilco series exactly, because
// that series is the reason this exists: it is arithmetically sound in every
// row and still opens its second period one member above the first period's
// close. Counts only — no respondent, no answer, no name.
// =============================================================================

import { readFileSync } from "node:fs";
import {
  continuityFindings,
  arithmeticFindings,
  periodFindings,
  describeFinding,
  canonicalPeriodPoints,
} from "../src/lib/calc/period-continuity.ts";

let failures = 0;
const ok = (m) => console.log("  ✓", m);
const bad = (m) => {
  console.error("  ✗ FAIL:", m);
  failures += 1;
};
const check = (c, m) => (c ? ok(m) : bad(m));

const row = (periodOrder, periodLabel, startingMembers, newMembers, lostMembers, endingMembers, retention, churn) => ({
  periodOrder, periodLabel, startingMembers, newMembers, lostMembers, endingMembers, retention, churn,
});

// The real series, counts only.
const SERIES = [
  row(0, "oct 2023 - mar 2024", 11, 13, 3, 21, 72.73, 27.27),
  row(1, "abril 2024 - sept 2024", 22, 6, 4, 24, 81.82, 18.18),
  row(2, "oct 2024 - mar 2025", 24, 7, 5, 26, 79.17, 20.83),
  row(3, "abril 2025 - sept 2025", 26, 12, 11, 27, 57.69, 42.31),
  row(4, "oct 2025 - mar 2026", 27, 10, 10, 27, 62.96, 37.04),
  row(5, "abril 2026 - jul 2026 (sep 26)", 27, 8, 7, 28, 74.07, 25.93),
];

console.log("Be Community — retention series gate");

// ---- [1] Arithmetic --------------------------------------------------------
console.log("\n[1] Every row adds up, and every rate is the canonical one");
{
  const found = arithmeticFindings(SERIES);
  check(found.length === 0, "the real series is arithmetically sound (" + found.length + " finding(s))");

  const brokenEnding = [row(0, "p1", 10, 5, 2, 99, 80, 20)];
  const endingFinding = arithmeticFindings(brokenEnding);
  check(
    endingFinding.length === 1 && endingFinding[0].field === "endingMembers" && endingFinding[0].expected === 13,
    "a closing count that does not add up is reported with the number it should be",
  );

  const brokenRate = [row(0, "p1", 11, 13, 3, 21, 70.0, 27.27)];
  const rateFinding = arithmeticFindings(brokenRate);
  check(
    rateFinding.length === 1 && rateFinding[0].field === "retention" && rateFinding[0].expected === 72.73,
    "a published rate that is not the canonical one is reported (expected 72.73)",
  );

  const brokenChurn = [row(0, "p1", 11, 13, 3, 21, 72.73, 30.0)];
  const churnFinding = arithmeticFindings(brokenChurn);
  check(
    churnFinding.length === 1 && churnFinding[0].field === "churn" && churnFinding[0].expected === 27.27,
    "a wrong churn rate is reported too",
  );

  // A row that already contradicts itself must not also be reported for the
  // rates derived from its own broken counts.
  check(
    arithmeticFindings(brokenEnding).every((f) => f.field === "endingMembers"),
    "a self-contradictory row produces one finding, not three",
  );
}

// ---- [2] Continuity --------------------------------------------------------
console.log("\n[2] A roster that jumps between periods is reported, not corrected");
{
  const found = continuityFindings(SERIES);
  check(found.length === 1, "the real series has exactly one discontinuity (got " + found.length + ")");
  const only = found[0];
  check(only.endingMembers === 21 && only.startingMembers === 22 && only.difference === 1,
    "it is the 21 -> 22 step between the first two periods");
  check(only.fromLabel === "oct 2023 - mar 2024" && only.toLabel === "abril 2024 - sept 2024",
    "it names both periods so a person can check the source");

  const text = describeFinding(only);
  check(text.includes("21") && text.includes("22"), "the description carries both counts");
  check(
    /no lo ajustes/.test(text),
    "the description tells the reader NOT to adjust the number to make the series tidy",
  );

  const continuous = SERIES.map((r, i) => (i === 1 ? { ...r, startingMembers: 21 } : r));
  check(continuityFindings(continuous).length === 0, "a series that joins up reports nothing");

  // Order must not depend on the order rows arrive in.
  check(continuityFindings([...SERIES].reverse()).length === 1, "the check is independent of row order");

  // A missing period is not a discontinuity: it is a different question.
  const withGap = [SERIES[0], { ...SERIES[2], periodOrder: 2 }];
  check(continuityFindings(withGap).length === 0, "a gap in the period ORDER is not reported as a roster jump");
  check(continuityFindings([SERIES[0]]).length === 0, "a single period has nothing to be continuous with");
  check(continuityFindings([]).length === 0, "an empty series reports nothing");
}

// ---- [3] The two kinds stay apart ------------------------------------------
console.log("\n[3] A defect and a question are never the same finding");
{
  const all = periodFindings(SERIES);
  check(all.length === 1 && all[0].kind === "continuity",
    "the real series yields one question and zero defects");
  check(
    periodFindings([row(0, "p1", 10, 5, 2, 99, 80, 20)]).every((f) => f.kind === "arithmetic"),
    "a broken row yields a defect, not a question",
  );
}

// ---- [4] The displayed rate is rounded once, at the declared precision -----
console.log("");
console.log("[4] What a client sees is derived from the counts, not re-rounded");
{
  const shown = canonicalPeriodPoints(SERIES);
  check(shown[0].retention === 72.7, "the first period displays 72.7, not the stored 72.73 (got " + shown[0].retention + ")");
  check(shown[0].churn === 27.3, "churn is shown at the same declared precision (got " + shown[0].churn + ")");
  check(
    shown.every((p) => Number.isInteger(Math.round(p.retention * 10)) && Math.abs(p.retention * 10 - Math.round(p.retention * 10)) < 1e-9),
    "every displayed rate carries at most one decimal",
  );
  check(SERIES[0].retention === 72.73, "the stored value is not mutated");

  // A double rounding is not the same number as a single one. 42 ending with
  // 13 joiners over 40 starting is 72.4999...; stored at two decimals that is
  // 72.5, and rounding THAT again gives 72.5, while the exact value rounded
  // once is 72.5 as well — so the knife-edge case is built explicitly below.
  const knife = [row(0, "p", 800, 0, 194, 606, 75.75, 24.25)];
  const once = canonicalPeriodPoints(knife)[0].retention;
  check(once === 75.8, "a knife-edge value is rounded once from the exact ratio (got " + once + ")");

  const zero = [row(0, "p", 0, 0, 0, 0, 0, 0)];
  check(canonicalPeriodPoints(zero).length === 1, "a period with no starting members does not throw");
}

// ---- [5] The read path actually uses it ------------------------------------
console.log("");
console.log("[5] The loader every client surface goes through derives the rates");
{
  const loader = readFileSync("src/lib/studies/period-series.ts", "utf8");
  check(loader.includes("canonicalPeriodPoints("), "loadLatestPeriodSeries passes its rows through the canonical derivation");
}

console.log("\n" + "=".repeat(70));
if (failures > 0) {
  console.error("RESULT: " + failures + " failure(s). GATE BLOCKED.");
  process.exit(1);
}
console.log("RESULT: the series is checked, and its open question is stated. GATE PASSED.");
