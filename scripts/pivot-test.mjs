// =============================================================================
// Fase 4 — PivotIntent validation + computation gate (§5.3)
//   npx tsx scripts/pivot-test.mjs
// =============================================================================
// Proves the MANDATORY safety rule: fields are validated against an allowlist
// BEFORE the engine runs, and computePivot refuses an out-of-scope intent.
// =============================================================================

import { buildAllowlist, validatePivotIntent, computePivot } from "../src/lib/calc/pivot.ts";

let failures = 0;
const ok = (m) => console.log("  ✓", m);
const bad = (m) => { console.error("  ✗ FAIL:", m); failures++; };
const near = (a, b, eps = 1e-9) => a != null && Math.abs(a - b) <= eps;

// Known dataset: genero × nivel, metric sat (1-5) and nps (0-10).
//  resp genero nivel     sat nps
//   1    F     preescolar 5   9
//   2    F     primaria   3   6
//   3    M     preescolar 4   10
//   4    M     primaria   2   7
//   5    F     preescolar 5   8
const people = [
  { id: "1", genero: "F", nivel: "preescolar", sat: 5, nps: 9 },
  { id: "2", genero: "F", nivel: "primaria", sat: 3, nps: 6 },
  { id: "3", genero: "M", nivel: "preescolar", sat: 4, nps: 10 },
  { id: "4", genero: "M", nivel: "primaria", sat: 2, nps: 7 },
  { id: "5", genero: "F", nivel: "preescolar", sat: 5, nps: 8 },
];
const rows = people.flatMap((p) => [
  { respondent_id: p.id, metric_key: "sat", value: p.sat, genero: p.genero, nivel: p.nivel },
  { respondent_id: p.id, metric_key: "nps", value: p.nps, genero: p.genero, nivel: p.nivel },
]);

const allow = buildAllowlist(rows);

function testAllowlist() {
  console.log("\n[1] Allowlist derived from data");
  allow.dimensions.sort().join(",") === "genero,nivel" ? ok("dimensions = genero,nivel") : bad(`dims = ${allow.dimensions}`);
  allow.metrics.sort().join(",") === "nps,sat" ? ok("metrics = nps,sat") : bad(`metrics = ${allow.metrics}`);
}

function testValidationRejects() {
  console.log("\n[2] MANDATORY validation rejects out-of-allowlist fields");
  const cases = [
    { name: "unknown row dimension", intent: { rows: ["address"], columns: [], values: [{ field: "sat", agg: "avg" }] } },
    { name: "unknown column dimension", intent: { rows: ["genero"], columns: ["secret"], values: [{ field: "sat", agg: "avg" }] } },
    { name: "unknown metric (injection attempt)", intent: { rows: ["genero"], columns: [], values: [{ field: "DROP TABLE", agg: "avg" }] } },
    { name: "invalid aggregation", intent: { rows: ["genero"], columns: [], values: [{ field: "sat", agg: "eval" }] } },
    { name: "no metric selected", intent: { rows: ["genero"], columns: [], values: [] } },
    { name: "row == column", intent: { rows: ["genero"], columns: ["genero"], values: [{ field: "sat", agg: "avg" }] } },
  ];
  for (const c of cases) {
    const v = validatePivotIntent(c.intent, allow);
    !v.ok ? ok(`rejected: ${c.name}`) : bad(`should have rejected: ${c.name}`);
  }
}

function testComputeRefusesInvalid() {
  console.log("\n[3] computePivot THROWS on invalid intent (structural gate)");
  try {
    computePivot(rows, { rows: ["address"], columns: [], values: [{ field: "sat", agg: "avg" }] }, allow);
    bad("computePivot did not throw on invalid intent");
  } catch {
    ok("computePivot refused to run an out-of-scope intent");
  }
}

function testComputeCorrect() {
  console.log("\n[4] computePivot matches hand-computed crosses");
  // Valid: genero × nivel, avg sat
  const r = computePivot(
    rows,
    { rows: ["genero"], columns: ["nivel"], values: [{ field: "sat", agg: "avg" }] },
    allow,
  );
  // Expected avg sat:
  //  F·preescolar: [5,5] -> 5     F·primaria: [3] -> 3
  //  M·preescolar: [4] -> 4       M·primaria: [2] -> 2
  const get = (g, n) => {
    const row = r.body.find((b) => b.rowLabels[0] === g);
    const col = r.colCombos.find((c) => c.labels[0] === n);
    return row && col ? row.cells[`${col.key}|m0`] : undefined;
  };
  near(get("F", "preescolar"), 5) ? ok("F·preescolar avg sat = 5") : bad(`F·preescolar = ${get("F", "preescolar")}`);
  near(get("F", "primaria"), 3) ? ok("F·primaria avg sat = 3") : bad(`F·primaria = ${get("F", "primaria")}`);
  near(get("M", "preescolar"), 4) ? ok("M·preescolar avg sat = 4") : bad(`M·preescolar = ${get("M", "preescolar")}`);
  near(get("M", "primaria"), 2) ? ok("M·primaria avg sat = 2") : bad(`M·primaria = ${get("M", "primaria")}`);

  // 1-D: genero, count of nps responses
  const c = computePivot(rows, { rows: ["genero"], columns: [], values: [{ field: "nps", agg: "count" }] }, allow);
  const fCount = c.body.find((b) => b.rowLabels[0] === "F")?.cells["|m0"];
  const mCount = c.body.find((b) => b.rowLabels[0] === "M")?.cells["|m0"];
  fCount === 3 && mCount === 2 ? ok("count nps by genero: F=3, M=2") : bad(`counts F=${fCount} M=${mCount}`);
  const fN = c.body.find((b) => b.rowLabels[0] === "F")?.cellNs["|m0"];
  const mN = c.body.find((b) => b.rowLabels[0] === "M")?.cellNs["|m0"];
  if (fN === 3 && mN === 2) ok("privacy cell n is carried: F=3, M=2");
  else bad(`cell n F=${fN} M=${mN}`);

  // sum + min + max sanity on sat by genero
  const s = computePivot(rows, { rows: ["genero"], columns: [], values: [{ field: "sat", agg: "sum" }] }, allow);
  const fSum = s.body.find((b) => b.rowLabels[0] === "F")?.cells["|m0"];
  fSum === 13 ? ok("sum sat F = 13 (5+3+5)") : bad(`sum sat F = ${fSum}`);
}

console.log("Be Community — Fase 4 pivot gate (§5.3)");
testAllowlist();
testValidationRejects();
testComputeRefusesInvalid();
testComputeCorrect();
console.log("\n" + "=".repeat(60));
if (failures > 0) { console.error(`RESULT: ${failures} failure(s). GATE BLOCKED.`); process.exit(1); }
console.log("RESULT: pivot validation + computation correct. GATE PASSED.");
