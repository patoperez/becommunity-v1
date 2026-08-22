// =============================================================================
// MANDATORY Workers-runtime safety gate
//   npx tsx scripts/workers-runtime-safety-test.mjs
// =============================================================================
// Cloudflare Workers refuse runtime code generation. Arquero 8.0.3 compiles its
// table expressions with the `Function` constructor, so every data-bearing
// dashboard render failed in production with:
//   EvalError: Code generation from strings disallowed for this context
//
// A static grep is not sufficient — a transitive import or a lazily-compiled
// expression would slip through. This gate therefore does BOTH:
//
//   [1] RUNTIME: installs guards that throw when `eval`, `Function(...)`,
//       `new Function(...)` or `fn.constructor(...)` is invoked — the same
//       prohibition workerd enforces — and then executes the real production
//       engine and pivot paths on non-empty data, asserting the results are
//       genuinely data-bearing.
//   [2] POSITIVE CONTROL: runs the Arquero pipeline under the same guards and
//       asserts it DOES trip them, proving the gate is not vacuous.
//   [3] STATIC: scans src/ and asserts no production-reachable file imports
//       Arquero.
//
// Globals are restored in a finally block.
// =============================================================================

import { readdirSync, statSync, readFileSync } from "node:fs";
import { join } from "node:path";

let failures = 0;
const ok = (m) => console.log("  ✓", m);
const bad = (m) => { console.error("  ✗ FAIL:", m); failures++; };

console.log("Be Community — Workers runtime safety gate");

// Modules are imported BEFORE the guards are installed: the loader/transpiler
// itself may legitimately use codegen. What must be codegen-free is EXECUTION.
const engine = await import("../src/lib/calc/engine.ts");
const pivot = await import("../src/lib/calc/pivot.ts");
const arquero = await import("arquero");

// ---- fixtures (synthetic) ---------------------------------------------------
const people = [
  { id: "1", genero: "F", nivel: "preescolar", sat: 5, nps: 9 },
  { id: "2", genero: "F", nivel: "primaria", sat: 3, nps: 6 },
  { id: "3", genero: "M", nivel: "preescolar", sat: 4, nps: 10 },
  { id: "4", genero: "M", nivel: "primaria", sat: 2, nps: 7 },
  { id: "5", genero: "F", nivel: "preescolar", sat: 5, nps: 8 },
];
const rows = people.flatMap((p) => [
  { respondent_id: p.id, metric_key: "sat_general", value: p.sat, genero: p.genero, nivel: p.nivel },
  { respondent_id: p.id, metric_key: "nps", value: p.nps, genero: p.genero, nivel: p.nivel },
]);

// ---- guards -----------------------------------------------------------------
const RealFunction = globalThis.Function;
const realEval = globalThis.eval;
const realCtorDesc = Object.getOwnPropertyDescriptor(RealFunction.prototype, "constructor");
let tripped = null;

function deny(what) {
  tripped = what;
  throw new EvalError("Code generation from strings disallowed for this context");
}

const guardedFunction = new Proxy(RealFunction, {
  apply: () => deny("Function(...) called"),
  construct: () => deny("new Function(...) called"),
});

function installGuards() {
  tripped = null;
  globalThis.Function = guardedFunction;
  // `(function(){}).constructor` is the classic back door to the same compiler.
  Object.defineProperty(RealFunction.prototype, "constructor", {
    value: guardedFunction, writable: true, configurable: true,
  });
  globalThis.eval = () => deny("eval(...) called");
}

function restoreGuards() {
  globalThis.Function = RealFunction;
  globalThis.eval = realEval;
  if (realCtorDesc) Object.defineProperty(RealFunction.prototype, "constructor", realCtorDesc);
}

// ---- [0] the guard itself must work ----------------------------------------
console.log("\n[0] Guard self-test");
try {
  installGuards();
  let threw = false;
  try { new globalThis.Function("return 1"); } catch { threw = true; }
  threw ? ok("new Function(...) is blocked") : bad("guard did NOT block new Function");
  threw = false;
  try { globalThis.eval("1"); } catch { threw = true; }
  threw ? ok("eval(...) is blocked") : bad("guard did NOT block eval");
  threw = false;
  try { (function () {}).constructor("return 1"); } catch { threw = true; }
  threw ? ok("fn.constructor(...) is blocked") : bad("guard did NOT block fn.constructor");
} finally { restoreGuards(); }

// ---- [1] production calculation paths under the guards ----------------------
console.log("\n[1] Production engine + pivot execute with codegen disabled");
let results = null;
try {
  installGuards();
  const dt = engine.buildTable(rows);
  results = {
    metricKeys: engine.metricKeys(dt),
    segmentKeys: engine.segmentKeys(dt),
    averages: engine.metricAverages(dt),
    cross: engine.crossAverage(dt, "sat_general", "genero"),
    nps: engine.nps(dt),
    csat: engine.csat(dt, "sat_general", 4),
    study: engine.computeStudyMetrics(rows, { csatMin: 4, satMetricPrefix: "sat" }),
    stage: engine.computeStageMetric(rows, "nps"),
  };
  const allow = pivot.buildAllowlist(rows);
  results.pivot = pivot.computePivot(
    rows,
    { rows: ["genero"], columns: ["nivel"], values: [
      { field: "sat_general", agg: "avg" }, { field: "sat_general", agg: "count" },
      { field: "sat_general", agg: "sum" }, { field: "sat_general", agg: "min" },
      { field: "sat_general", agg: "max" },
    ] },
    allow,
  );
  results.allowlist = allow;
} catch (e) {
  bad(`production path tripped the codegen guard or threw: ${e?.message}`);
} finally { restoreGuards(); }

if (tripped) bad(`production code performed runtime code generation: ${tripped}`);
else ok("no eval / Function / new Function during engine + pivot execution");

// ---- [2] results must be genuinely data-bearing -----------------------------
console.log("\n[2] Results are data-bearing (the gate is not passing on empty output)");
if (results) {
  results.metricKeys.length === 2 ? ok("metricKeys = 2 metrics") : bad(`metricKeys = ${JSON.stringify(results.metricKeys)}`);
  results.segmentKeys.join(",") === "genero,nivel" ? ok("segmentKeys = genero,nivel") : bad(`segmentKeys = ${results.segmentKeys}`);
  const sat = results.averages.find((a) => a.metric_key === "sat_general");
  sat && sat.n === 5 && sat.average === 3.8 ? ok("avg sat_general = 3.8 (n=5)") : bad(`sat avg = ${JSON.stringify(sat)}`);
  const f = results.cross.find((c) => c.segment === "F");
  f && f.n === 3 && Math.abs(f.average - 4.33) < 1e-9 ? ok("cross sat_general · F = 4.33 (n=3)") : bad(`cross F = ${JSON.stringify(f)}`);
  results.nps && results.nps.total === 5 ? ok(`NPS computed (total=5, nps=${results.nps.nps})`) : bad(`nps = ${JSON.stringify(results.nps)}`);
  results.csat && results.csat.total === 5 ? ok(`CSAT computed (${results.csat.csat}%)`) : bad(`csat = ${JSON.stringify(results.csat)}`);
  results.study.respondents === 5 ? ok("computeStudyMetrics respondents = 5") : bad(`respondents = ${results.study.respondents}`);
  results.stage.kind === "nps" && results.stage.n === 5 ? ok("computeStageMetric produced an NPS headline") : bad(`stage = ${JSON.stringify(results.stage)}`);

  const p = results.pivot;
  p && p.body.length === 2 ? ok("pivot body has 2 row combos (F, M)") : bad(`pivot rows = ${p?.body.length}`);
  p && p.colCombos.length === 2 ? ok("pivot has 2 column combos") : bad(`pivot cols = ${p?.colCombos.length}`);
  p && p.measures.length === 5 ? ok("pivot carries all 5 aggregations") : bad(`measures = ${p?.measures.length}`);
  const cell = p?.body.find((b) => b.rowLabels[0] === "F");
  const preKey = p?.colCombos.find((c) => c.labels[0] === "preescolar")?.key;
  cell && preKey !== undefined && cell.cells[`${preKey}|m0`] === 5 ? ok("F·preescolar avg sat = 5 (real value, not null)") : bad(`F·preescolar = ${cell?.cells[`${preKey}|m0`]}`);
  cell && cell.cellNs[`${preKey}|m0`] === 2 ? ok("F·preescolar n = 2") : bad(`F·preescolar n = ${cell?.cellNs[`${preKey}|m0`]}`);
  const nonNull = p ? p.body.flatMap((b) => Object.values(b.cells)).filter((v) => v !== null).length : 0;
  nonNull >= 10 ? ok(`${nonNull} non-null pivot cells`) : bad(`only ${nonNull} non-null pivot cells`);
} else bad("no results captured");

// ---- [3] positive control: Arquero MUST trip the same guards ----------------
console.log("\n[3] Positive control — the Arquero pipeline still trips the guard");
let arqueroThrew = false;
try {
  installGuards();
  arquero.from(rows).groupby("metric_key")
    .rollup({ average: (d) => arquero.op.average(d.value) })
    .objects();
} catch {
  arqueroThrew = true;
} finally { restoreGuards(); }
arqueroThrew
  ? ok("Arquero throws under the guard — the gate genuinely detects codegen")
  : bad("Arquero did NOT trip the guard; this gate would not catch a regression");

// ---- [4] static import scan -------------------------------------------------
console.log("\n[4] No production-reachable file imports Arquero");
function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (/\.(ts|tsx|js|jsx|mjs)$/.test(name)) out.push(p);
  }
  return out;
}
const offenders = walk("src").filter((f) =>
  /(^|[^\w])(from\s+['"]arquero['"]|require\(\s*['"]arquero['"]\s*\)|import\(\s*['"]arquero['"]\s*\))/.test(readFileSync(f, "utf8")),
);
offenders.length === 0
  ? ok(`scanned ${walk("src").length} files under src/ — zero Arquero imports`)
  : bad(`Arquero imported by production files: ${offenders.join(", ")}`);

const pkg = JSON.parse(readFileSync("package.json", "utf8"));
!pkg.dependencies?.arquero ? ok("arquero is not a runtime dependency") : bad("arquero is still in dependencies");
pkg.devDependencies?.arquero === "8.0.3" ? ok("arquero 8.0.3 retained as a dev-only parity oracle") : bad(`devDependencies.arquero = ${pkg.devDependencies?.arquero}`);

console.log("\n" + "=".repeat(70));
if (failures > 0) { console.error(`RESULT: ${failures} failure(s). GATE BLOCKED.`); process.exit(1); }
console.log("RESULT: calculation layer runs without runtime code generation. GATE PASSED.");
