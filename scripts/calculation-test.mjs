// =============================================================================
// MANDATORY calculation gate (§5.4 "Verificación obligatoria del motor de cálculo")
//   npx tsx scripts/calculation-test.mjs
// =============================================================================
// Validates the Arquero engine + canonical metric definitions against a fixed
// dataset whose results were computed BY HAND (the "known Excel result" stand-in).
// Every number the engine produces must match to the agreed decimal. This is a
// gate: nothing is built on top of the engine until it passes.
// =============================================================================

import { mean, npsFromScores, csatTopBox } from "../src/lib/calc/metrics.ts";
import { computeStudyMetrics, metricAverages, crossAverage, buildTable } from "../src/lib/calc/engine.ts";

let failures = 0;
const ok = (m) => console.log("  ✓", m);
const bad = (m) => { console.error("  ✗ FAIL:", m); failures++; };
const near = (a, b, eps = 1e-9) => a !== null && Math.abs(a - b) <= eps;
const eq = (label, got, exp) => (near(typeof got === "number" ? got : NaN, exp) ? ok(`${label} = ${exp}`) : bad(`${label}: expected ${exp}, got ${got}`));

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
  near(satAvg?.average, 3.625) ? ok("metricAverages sat_general = 3.625") : bad(`sat avg = ${satAvg?.average}`);
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

console.log("Be Community — Fase 3 calculation gate (§5.4)");
testCentralFunctions();
testArqueroEngine();
testOrchestration();
console.log("\n" + "=".repeat(60));
if (failures > 0) { console.error(`RESULT: ${failures} failure(s) — engine does NOT match known values. GATE BLOCKED.`); process.exit(1); }
console.log("RESULT: engine matches all hand-computed values. GATE PASSED.");
