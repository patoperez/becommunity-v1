// =============================================================================
// MANDATORY calculation gate (§5.4 "Verificación obligatoria del motor de cálculo")
//   npx tsx scripts/calculation-test.mjs
// =============================================================================
// Validates the Arquero engine + canonical metric definitions against a fixed
// dataset whose results were computed BY HAND (the "known Excel result" stand-in).
// Every number the engine produces must match to the agreed decimal. This is a
// gate: nothing is built on top of the engine until it passes.
// =============================================================================

import { mean, npsFromScores, csatTopBox, percentage, roundTo } from "../src/lib/calc/metrics.ts";
import {
  computeStudyMetrics, metricAverages, crossAverage, buildTable,
  computeStageMetric, nps as engineNps, csat as engineCsat,
} from "../src/lib/calc/engine.ts";
import { computePivot, buildAllowlist } from "../src/lib/calc/pivot.ts";
import { formatNumber } from "../src/lib/calc/format.ts";

let failures = 0;
const ok = (m) => console.log("  ✓", m);
const bad = (m) => { console.error("  ✗ FAIL:", m); failures++; };
const near = (a, b, eps = 1e-9) => a !== null && Math.abs(a - b) <= eps;
const eq = (label, got, exp) => (near(typeof got === "number" ? got : NaN, exp) ? ok(`${label} = ${exp}`) : bad(`${label}: expected ${exp}, got ${got}`));
/** Explicit null assertion — `eq` cannot express "must be null" (see §7 of docs/CALCULATION_POLICY.md). */
const isNull = (label, got) => (got === null ? ok(`${label} = null`) : bad(`${label}: expected null, got ${got}`));
/** Assert a call does NOT throw, and hand the result to a checker. */
const noThrow = (label, fn) => {
  try { const r = fn(); ok(`${label} did not throw`); return r; }
  catch (e) { bad(`${label} THREW: ${e.message}`); return null; }
};

// ---- Known dataset (8 respondents). Hand-computed expectations below. --------
//  resp  genero  nps  sat_general(1-5)
//   1      F      9     5
//   2      F     10     4
//   3      F      6     3
//   4      F      8     5
//   5      M      7     2
//   6      M      9     4
//   7      M      3     1
//   8      M     10     5
const people = [
  { id: "1", genero: "F", nps: 9, sat: 5 },
  { id: "2", genero: "F", nps: 10, sat: 4 },
  { id: "3", genero: "F", nps: 6, sat: 3 },
  { id: "4", genero: "F", nps: 8, sat: 5 },
  { id: "5", genero: "M", nps: 7, sat: 2 },
  { id: "6", genero: "M", nps: 9, sat: 4 },
  { id: "7", genero: "M", nps: 3, sat: 1 },
  { id: "8", genero: "M", nps: 10, sat: 5 },
];
const rows = people.flatMap((p) => [
  { respondent_id: p.id, metric_key: "nps", value: p.nps, genero: p.genero },
  { respondent_id: p.id, metric_key: "sat_general", value: p.sat, genero: p.genero },
]);

// HAND-COMPUTED EXPECTED VALUES:
//  NPS scores [9,10,6,8,7,9,3,10]: promoters(>=9)=4, detractors(<=6)=2, passives=2, n=8
//     NPS = (4-2)/8*100 = 25.0
//  CSAT sat>=4: satisfied = {5,4,5,4,5} = 5 of 8 -> 62.5%
//  mean nps = 62/8 = 7.75 ; mean sat = 29/8 = 3.625
//  cross sat by genero: F=[5,4,3,5]->4.25 (n4), M=[2,4,1,5]->3.0 (n4)
//  cross nps by genero: F=[9,10,6,8]->8.25 (n4), M=[7,9,3,10]->7.25 (n4)

function testCentralFunctions() {
  console.log("\n[1] Canonical metric definitions (metrics.ts)");
  const r = npsFromScores([9, 10, 6, 8, 7, 9, 3, 10]);
  eq("NPS", r.nps, 25.0);
  eq("  promoters", r.promoters, 4);
  eq("  passives", r.passives, 2);
  eq("  detractors", r.detractors, 2);
  eq("  total", r.total, 8);
  eq("mean(nps)", mean([9, 10, 6, 8, 7, 9, 3, 10]), 7.75);
  eq("mean(sat)", mean([5, 4, 3, 5, 2, 4, 1, 5]), 3.63); // 3.625 -> 2dp
  const c = csatTopBox([5, 4, 3, 5, 2, 4, 1, 5], 4);
  eq("CSAT(top-2-box, min4)", c.csat, 62.5);
  eq("  satisfied", c.satisfied, 5);
  // edge cases
  mean([]) === null ? ok("mean([]) = null (no silent 0)") : bad("mean([]) should be null");
  eq("NPS([]) = 0", npsFromScores([]).nps, 0);
}

function testArqueroEngine() {
  console.log("\n[2] Arquero engine (engine.ts)");
  const dt = buildTable(rows);
  const avg = metricAverages(dt);
  const satAvg = avg.find((a) => a.metric_key === "sat_general");
  const npsAvg = avg.find((a) => a.metric_key === "nps");
  // CHANGED (P1): engine averages are now rounded ONCE at DECIMALS.score (2 dp)
  // in the calc layer instead of being returned raw and rounded by the UI.
  // Raw mean is 3.625; rounded once at 2 dp -> 3.63. The rendered value is
  // identical to before (the UI used to toFixed(2) the raw 3.625 to "3.63").
  near(satAvg?.average, 3.63) ? ok("metricAverages sat_general = 3.63 (raw 3.625, rounded once @2dp)") : bad(`sat avg = ${satAvg?.average}`);
  satAvg?.n === 8 ? ok("metricAverages sat_general n = 8") : bad(`sat n = ${satAvg?.n}`);
  near(npsAvg?.average, 7.75) ? ok("metricAverages nps = 7.75") : bad(`nps avg = ${npsAvg?.average}`);

  const crossSat = crossAverage(dt, "sat_general", "genero");
  const f = crossSat.find((x) => x.segment === "F");
  const m = crossSat.find((x) => x.segment === "M");
  near(f?.average, 4.25) && f?.n === 4 ? ok("cross sat_general · F = 4.25 (n4)") : bad(`F = ${JSON.stringify(f)}`);
  near(m?.average, 3.0) && m?.n === 4 ? ok("cross sat_general · M = 3.0 (n4)") : bad(`M = ${JSON.stringify(m)}`);
}

function testOrchestration() {
  console.log("\n[3] computeStudyMetrics (what the dashboard renders)");
  const result = computeStudyMetrics(rows, { csatMin: 4, satMetricPrefix: "sat" });
  result.respondents === 8 ? ok("respondents = 8") : bad(`respondents = ${result.respondents}`);
  eq("nps.nps", result.nps?.nps, 25.0);
  result.averages.every((a) => a.metric_key !== "nps") ? ok("nps excluded from averages list") : bad("nps leaked into averages");
  const csat = result.csat.find((c) => c.metric_key === "sat_general");
  eq("csat(sat_general)", csat?.result.csat, 62.5);
  result.crossSegment === "genero" ? ok("cross segment auto-selected = genero") : bad(`crossSegment = ${result.crossSegment}`);
  const npsCross = result.crosses.find((c) => c.metric_key === "nps");
  const cf = npsCross?.rows.find((x) => x.segment === "F");
  near(cf?.average, 8.25) ? ok("cross nps · F = 8.25") : bad(`nps·F = ${cf?.average}`);
}

// =============================================================================
// [4] EDGE CASES — canonical definitions (P1). Every expectation hand-computed.
// =============================================================================
function testMetricEdgeCases() {
  console.log("\n[4] Canonical metric edge cases");

  // ---- NPS boundaries: promoters >=9, passives 7-8, detractors <=6 ----------
  // [6,7,8,9]: d={6}=1, pa={7,8}=2, p={9}=1, n=4 -> (1-1)/4*100 = 0
  const band = npsFromScores([6, 7, 8, 9]);
  eq("NPS band [6,7,8,9]", band.nps, 0);
  eq("  detractors (6 is a detractor)", band.detractors, 1);
  eq("  passives (7,8)", band.passives, 2);
  eq("  promoters (9 is a promoter)", band.promoters, 1);

  // All promoters / all detractors -> the extremes of the -100..100 scale.
  eq("NPS all promoters [9,10]", npsFromScores([9, 10]).nps, 100);
  eq("NPS all detractors [0,6]", npsFromScores([0, 6]).nps, -100);

  // A balanced set scores 0 with n>0 — must be distinguishable from "no data".
  const balanced = npsFromScores([7, 8]);
  eq("NPS all passives [7,8]", balanced.nps, 0);
  eq("  ...with total 2 (0 means balanced, NOT empty)", balanced.total, 2);
  const emptyNps = npsFromScores([]);
  eq("NPS([]) = 0 (numeric, per §7 contract)", emptyNps.nps, 0);
  eq("  ...with total 0 (this is what 'no data' looks like)", emptyNps.total, 0);

  // Out-of-scale values are ignored: only 5 is valid -> n=1, detractor.
  const oos = npsFromScores([11, -1, 5]);
  eq("NPS ignores out-of-0..10 [11,-1,5]", oos.nps, -100);
  eq("  valid n", oos.total, 1);
  // Non-finite values are ignored: only 9 survives.
  const nf = npsFromScores([NaN, Infinity, 9]);
  eq("NPS ignores NaN/Infinity", nf.nps, 100);
  eq("  valid n", nf.total, 1);

  // Repeating decimals: (2-1)/3*100 = 33.333... -> 1 dp -> 33.3
  eq("NPS [9,9,0] (thirds)", npsFromScores([9, 9, 0]).nps, 33.3);
  // (1-2)/3*100 = -33.333... -> -33.3   (negative, 1 dp)
  eq("NPS [9,0,0] (negative thirds)", npsFromScores([9, 0, 0]).nps, -33.3);

  // ---- CSAT: threshold is inclusive (>=) and scale-agnostic ----------------
  const atMin = csatTopBox([4], 4);
  eq("CSAT value exactly at satisfiedMin counts", atMin.csat, 100);
  eq("CSAT just below threshold [3.9] min4", csatTopBox([3.9], 4).csat, 0);
  eq("CSAT [4,1,1] min4 (1/3)", csatTopBox([4, 1, 1], 4).csat, 33.3);
  eq("CSAT [4,4,1] min4 (2/3)", csatTopBox([4, 4, 1], 4).csat, 66.7);
  // Same function, 0-10 scale, Top-2-Box = min 9: {9,10} of 3 -> 66.7
  eq("CSAT scale-agnostic [9,10,8] min9", csatTopBox([9, 10, 8], 9).csat, 66.7);
  eq("CSAT ignores NaN", csatTopBox([NaN, 4, 4], 4).csat, 100);
  const emptyCsat = csatTopBox([], 4);
  eq("CSAT([]) = 0 (numeric, per §7)", emptyCsat.csat, 0);
  eq("  ...with total 0", emptyCsat.total, 0);
  eq("  ...threshold echoed back for UI transparency", emptyCsat.satisfiedMin, 4);

  // ---- mean: null on empty (no silent 0) -----------------------------------
  isNull("mean([])", mean([]));
  eq("mean([5])", mean([5]), 5);
  eq("mean([1,2])", mean([1, 2]), 1.5);
  eq("mean([1,2,2]) = 5/3 -> 2dp", mean([1, 2, 2]), 1.67);
  eq("mean([1,2], 0 decimals)", mean([1, 2], 0), 2); // 1.5 -> half-up -> 2
  eq("mean([-1,-2])", mean([-1, -2]), -1.5);

  // ---- percentage ----------------------------------------------------------
  eq("percentage(0,0) guard", percentage(0, 0), 0);
  eq("percentage(1,3)", percentage(1, 3), 33.3);
  eq("percentage(2,3)", percentage(2, 3), 66.7);
  eq("percentage(1,8) exact", percentage(1, 8), 12.5);
  eq("percentage(5,5)", percentage(5, 5), 100);
}

// =============================================================================
// [5] PRECISION / ROUNDING POLICY — locks docs/CALCULATION_POLICY.md §2-§3.
// These assertions exist so the rounding mode cannot drift silently.
// =============================================================================
function testRoundingPolicy() {
  console.log("\n[5] Precision & rounding policy (docs/CALCULATION_POLICY.md)");

  // Half AWAY FROM ZERO (Excel ROUND parity). 1/16*100 = 6.25 exactly -> 6.3
  eq("half-away-from-zero, positive: percentage(1,16) 6.25 -> 6.3", percentage(1, 16), 6.3);
  // Negative halves are now SYMMETRIC with positives (was -0.12 under half-up).
  eq("half-away-from-zero, negative: mean([-0.125]) -> -0.13", mean([-0.125]), -0.13);
  eq("half-away-from-zero, positive: mean([0.125]) -> 0.13", mean([0.125]), 0.13);
  // Symmetry is the property that was previously violated.
  (mean([0.125]) === -mean([-0.125]))
    ? ok("symmetry: round(-x) === -round(x) at a tie")
    : bad(`symmetry broken: ${mean([0.125])} vs ${mean([-0.125])}`);

  // Number.EPSILON nudge is load-bearing: 1.005*100 === 100.49999999999999,
  // so without the nudge this would round DOWN to 1.
  eq("EPSILON nudge: mean([1.005]) -> 1.01", mean([1.005]), 1.01);

  // Default precision: NPS/CSAT 1 dp, mean 2 dp.
  eq("NPS default precision = 1 dp", npsFromScores([9, 9, 0]).nps, 33.3);
  eq("mean default precision = 2 dp", mean([1, 1, 2]), 1.33);
}

// =============================================================================
// [6] EMPTY-TABLE CONTRACT (engine) — a study with zero quantitative rows is a
// legitimate state (e.g. a qualitative-only upload). It must NOT throw.
// Regression guard: Arquero column refs on an empty table used to throw
// "Invalid column reference", which crashed the dashboard for such a study.
// =============================================================================
function testEmptyTableContract() {
  console.log("\n[6] Empty-study contract (engine must not throw)");

  const m = noThrow("computeStudyMetrics([])", () => computeStudyMetrics([]));
  if (m) {
    eq("  respondents", m.respondents, 0);
    isNull("  nps", m.nps);
    eq("  averages length", m.averages.length, 0);
    eq("  csat length", m.csat.length, 0);
    eq("  crosses length", m.crosses.length, 0);
    m.crossSegment === null ? ok("  crossSegment = null") : bad(`crossSegment = ${m.crossSegment}`);
  }

  const stage = noThrow("computeStageMetric([], 'nps')", () => computeStageMetric([], "nps"));
  if (stage) {
    isNull("  stage value", stage.value);
    eq("  stage n", stage.n, 0);
  }

  const emptyTable = buildTable([]);
  const avgs = noThrow("metricAverages(empty table)", () => metricAverages(emptyTable));
  if (avgs) eq("  length", avgs.length, 0);
  const cross = noThrow("crossAverage(empty table)", () => crossAverage(emptyTable, "nps", "genero"));
  if (cross) eq("  length", cross.length, 0);
  const n = noThrow("engine.nps(empty table)", () => engineNps(emptyTable));
  if (n !== undefined) isNull("  engine.nps", n);
  const c = noThrow("engine.csat(empty table)", () => engineCsat(emptyTable, "sat_general"));
  if (c !== undefined) isNull("  engine.csat", c);
}

// =============================================================================
// [7] EXCEL-PARITY — PROPOSED, PENDING HUMAN DECISION. **Diagnostic only.**
// =============================================================================
// The shared helper rounds halves toward +Infinity; Excel's ROUND() rounds halves
// AWAY FROM ZERO. They agree on every non-negative value, so they differ only on
// negative exact halves. These assertions record the expected values IF the
// policy is switched. They deliberately do NOT count toward `failures` — the gate
// must stay green until a human approves the change (docs/CALCULATION_POLICY.md §2).
//
// Proposed implementation (reference only — NOT wired into src/):
//   const f = 10 ** decimals;
//   const s = value < 0 ? -1 : 1;
//   return s * Math.round((Math.abs(value) + Number.EPSILON) * f) / f;
// Note the EPSILON stays BEFORE scaling and is applied to the absolute value, so
// the load-bearing 1.005 -> 1.01 correction (§3) is preserved under both modes.
function testExcelParity() {
  console.log("\n[7] Excel ROUND() parity — HARD tests against the canonical roundTo()");

  // Every case below is asserted against the REAL helper (not a local copy), so
  // the gate fails if the rounding mode ever drifts back.
  const cases = [
    // [label, value, decimals, expected]
    ["-0.125 @2dp  (mean scale)", -0.125, 2, -0.13],
    ["-1.005 @2dp  (EPSILON + tie)", -1.005, 2, -1.01],
    ["-2.675 @2dp", -2.675, 2, -2.68],
    ["-6.25  @1dp  (NPS n=16, diff=-1)", -6.25, 1, -6.3],
    ["-31.25 @1dp  (NPS n=16, diff=-5)", -31.25, 1, -31.3],
    ["-93.75 @1dp  (NPS n=16, diff=-15)", -93.75, 1, -93.8],
    ["-0.05  @1dp", -0.05, 1, -0.1],
  ];
  for (const [label, v, d, expected] of cases) eq(`roundTo(${label})`, roundTo(v, d), expected);

  // Invariants the mode switch had to PRESERVE — asserted, not merely reported.
  eq("preserved: EPSILON fix roundTo(1.005,2)", roundTo(1.005, 2), 1.01);
  eq("preserved: positive tie roundTo(0.125,2)", roundTo(0.125, 2), 0.13);
  eq("preserved: positive tie roundTo(6.25,1)", roundTo(6.25, 1), 6.3);
  eq("preserved: percentage(1,3)", percentage(1, 3), 33.3);
  eq("preserved: NPS 25.0", npsFromScores([9, 10, 6, 8, 7, 9, 3, 10]).nps, 25.0);
}

// =============================================================================
// [8] ROUNDING REGRESSION — proves the mode switch changed ONLY tie cases.
// Compares the canonical helper against the LEGACY half-up implementation:
//   * non-tie values and positive ties MUST be identical (no silent drift),
//   * negative ties MUST differ, exactly as documented.
// =============================================================================
function testRoundingRegression() {
  console.log("\n[8] Rounding regression (legacy half-up vs canonical half-away-from-zero)");
  const legacyHalfUp = (v, d) => { const f = 10 ** d; return Math.round((v + Number.EPSILON) * f) / f; };

  // --- A) Values that MUST be unchanged by the switch -----------------------
  const unchanged = [
    [100 / 3, 1], [200 / 3, 1], [-100 / 3, 1], [25, 1], [100, 1], [-100, 1], [0, 1],
    [7.75, 2], [-7.75, 2], [3.625, 2], [4.25, 2], [3.0, 2], [5 / 3, 2], [-5 / 3, 2],
    [1.005, 2], [2.675, 2], [12.5, 1], [6.25, 1], [0.125, 2], [62.5, 1], [33.35, 1],
  ];
  let drift = 0;
  for (const [v, d] of unchanged) {
    if (roundTo(v, d) !== legacyHalfUp(v, d)) {
      bad(`UNEXPECTED DRIFT: roundTo(${v},${d})=${roundTo(v, d)} but legacy=${legacyHalfUp(v, d)}`);
      drift++;
    }
  }
  drift === 0
    ? ok(`${unchanged.length} non-tie / positive-tie values identical to legacy (no silent drift)`)
    : bad(`${drift} unexpected drift(s)`);

  // --- B) The COMPLETE list of intentional changes --------------------------
  // [value, decimals, legacy(old), canonical(new)]
  const intentional = [
    [-0.125, 2, -0.12, -0.13],
    [-1.005, 2, -1, -1.01],
    [-2.675, 2, -2.67, -2.68],
    [-6.25, 1, -6.2, -6.3],
    [-31.25, 1, -31.2, -31.3],
    [-93.75, 1, -93.7, -93.8],
    [-33.35, 1, -33.3, -33.4],
    [-0.05, 1, -0, -0.1],
  ];
  for (const [v, d, oldVal, newVal] of intentional) {
    const gotOld = legacyHalfUp(v, d), gotNew = roundTo(v, d);
    (near(gotOld, oldVal) && near(gotNew, newVal))
      ? ok(`documented change @${d}dp: ${v}: ${oldVal} -> ${newVal}`)
      : bad(`change mismatch for ${v}@${d}dp: legacy=${gotOld} (exp ${oldVal}), new=${gotNew} (exp ${newVal})`);
  }
  console.log("  every intentional change is a NEGATIVE exact half; positives and non-ties are untouched.");

  // --- C) Metric-level invariance on the known-good dataset -----------------
  // The headline study numbers must be byte-identical to pre-P1 values.
  eq("study NPS unchanged", npsFromScores([9, 10, 6, 8, 7, 9, 3, 10]).nps, 25.0);
  eq("study CSAT unchanged", csatTopBox([5, 4, 3, 5, 2, 4, 1, 5], 4).csat, 62.5);
  eq("study mean(nps) unchanged", mean([9, 10, 6, 8, 7, 9, 3, 10]), 7.75);
  eq("study mean(sat) unchanged", mean([5, 4, 3, 5, 2, 4, 1, 5]), 3.63);
}

// =============================================================================
// [9] ROUNDING BOUNDARY CONTRACT — where each value is allowed to be rounded.
// =============================================================================
// Display-TERMINAL outputs (nothing derives from them) are rounded in the calc
// layer. Outputs that FEED a later calculation stay RAW and are rounded once at
// the presentation boundary, so no derived value inherits rounding error.
function testRoundingBoundaryContract() {
  console.log("\n[9] Rounding boundary contract (raw internally vs rounded at display)");

  // 5/3 = 1.666... — a value that is visibly different raw vs rounded.
  const thirds = [
    { respondent_id: "1", metric_key: "m", value: 1, g: "A" },
    { respondent_id: "2", metric_key: "m", value: 2, g: "A" },
    { respondent_id: "3", metric_key: "m", value: 2, g: "A" },
  ];

  // --- TERMINAL outputs: rounded in the calc layer ---------------------------
  const avg = metricAverages(buildTable(thirds))[0];
  eq("metricAverages (display-terminal) is rounded @2dp", avg.average, 1.67);
  const cross = crossAverage(buildTable(thirds), "m", "g")[0];
  eq("crossAverage (display-terminal) is rounded @2dp", cross.average, 1.67);

  // --- NON-terminal output: pivot cells stay RAW ----------------------------
  // PivotExplorer derives maxBar and (value / maxBar) * 100 from these cells,
  // so rounding here would feed error into a later calculation.
  const allow = buildAllowlist(thirds);
  const pivot = computePivot(thirds, { rows: ["g"], columns: [], values: [{ field: "m", agg: "avg" }] }, allow);
  const cell = pivot.body[0].cells["|m0"];
  near(cell, 5 / 3)
    ? ok("computePivot cell keeps RAW precision (1.666…, not 1.67)")
    : bad(`pivot cell should be raw 5/3, got ${cell}`);
  cell !== 1.67 ? ok("  ...and is NOT pre-rounded") : bad("pivot cell was rounded internally");

  // --- The presentation boundary applies CANONICAL rounding ------------------
  // toFixed alone is not the policy: (1.005).toFixed(2) === "1.00" and
  // (2.675).toFixed(2) === "2.67". formatNumber must use roundTo.
  formatNumber(1.005, 2) === "1.01" ? ok('formatNumber(1.005,2) = "1.01" (toFixed alone gives "1.00")') : bad(`formatNumber(1.005,2) = ${formatNumber(1.005, 2)}`);
  formatNumber(2.675, 2) === "2.68" ? ok('formatNumber(2.675,2) = "2.68" (toFixed alone gives "2.67")') : bad(`formatNumber(2.675,2) = ${formatNumber(2.675, 2)}`);
  formatNumber(-0.125, 2) === "-0.13" ? ok('formatNumber(-0.125,2) = "-0.13" (half away from zero)') : bad(`formatNumber(-0.125,2) = ${formatNumber(-0.125, 2)}`);
  formatNumber(5 / 3, 2) === "1.67" ? ok('formatNumber(raw 5/3, 2) = "1.67"') : bad(`formatNumber(5/3,2) = ${formatNumber(5 / 3, 2)}`);
  // Idempotent on an already-rounded value (no double-rounding drift).
  formatNumber(1.67, 2) === "1.67" ? ok("formatNumber is idempotent on pre-rounded values") : bad("formatNumber double-rounded");
  formatNumber(null, 2) === "—" ? ok("formatNumber(null) = em dash") : bad("null not handled");
}

console.log("Be Community — calculation gate (§5.4 + P1 edge cases)");
testCentralFunctions();
testArqueroEngine();
testOrchestration();
testMetricEdgeCases();
testRoundingPolicy();
testEmptyTableContract();
testExcelParity();
testRoundingRegression();
testRoundingBoundaryContract();
console.log("\n" + "=".repeat(60));
if (failures > 0) { console.error(`RESULT: ${failures} failure(s) — engine does NOT match known values. GATE BLOCKED.`); process.exit(1); }
console.log("RESULT: engine matches all hand-computed values. GATE PASSED.");
