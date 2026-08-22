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
// expression would slip through. This gate therefore does all of:
//
//   [1] IMPORT-TIME: dynamically imports the production calculation modules
//       WHILE the codegen guards are active, with a cache-busting specifier so
//       the modules are genuinely evaluated rather than served from the ESM
//       cache. Module-scope codegen would be caught here.
//   [2] RUN-TIME: executes the real engine and pivot with `eval`,
//       `Function(...)`, `new Function(...)` and `fn.constructor(...)` all
//       throwing, exactly as workerd would.
//   [3] DATA-BEARING: asserts the results are real, so the gate cannot pass on
//       empty output.
//   [4] POSITIVE CONTROL: runs the Arquero pipeline under the same guards and
//       asserts it DOES trip them, proving the gate is not vacuous.
//   [5] STATIC: asserts no production-reachable file imports Arquero and that
//       Arquero stays a dev-only pinned dependency.
//
// Globals are restored in a finally block.
// =============================================================================

import { readdirSync, statSync, readFileSync } from "node:fs";
import { join } from "node:path";

let failures = 0;
function ok(message) {
  console.log("  ✓", message);
}
function bad(message) {
  console.error("  ✗ FAIL:", message);
  failures += 1;
}
/** Assertion helper — a plain call, so no bare-expression lint warnings. */
function check(condition, message) {
  if (condition) {
    ok(message);
  } else {
    bad(message);
  }
}

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

console.log("Be Community — Workers runtime safety gate");

// ---- [0] the guard itself must work ----------------------------------------
console.log("\n[0] Guard self-test");
try {
  installGuards();
  let blockedNew = false;
  try {
    const made = new globalThis.Function("return 1");
    void made;
  } catch {
    blockedNew = true;
  }
  let blockedEval = false;
  try {
    globalThis.eval("1");
  } catch {
    blockedEval = true;
  }
  let blockedCtor = false;
  try {
    (function () {}).constructor("return 1");
  } catch {
    blockedCtor = true;
  }
  restoreGuards();
  check(blockedNew, "new Function(...) is blocked");
  check(blockedEval, "eval(...) is blocked");
  check(blockedCtor, "fn.constructor(...) is blocked");
} finally {
  restoreGuards();
}

// ---- [1] IMPORT the production modules while guards are active --------------
// A cache-busting query forces a real module evaluation instead of an ESM cache
// hit, so module-scope code generation would be caught here rather than missed.
console.log("\n[1] Production modules IMPORT cleanly with codegen disabled");
let engine = null;
let pivot = null;
let importTripped = null;
let importError = null;
const bust = Date.now();
try {
  installGuards();
  engine = await import(`../src/lib/calc/engine.ts?workersGate=${bust}`);
  pivot = await import(`../src/lib/calc/pivot.ts?workersGate=${bust}`);
  importTripped = tripped;
} catch (e) {
  importError = e;
} finally {
  restoreGuards();
}
if (importError) {
  bad(`importing the calculation modules under the guards threw: ${importError.message}`);
} else {
  check(importTripped === null, "engine.ts and pivot.ts evaluate with no eval / Function / new Function");
  check(engine !== null && pivot !== null, "both modules loaded under the guards");
}

// ---- [2] production calculation paths under the guards ----------------------
console.log("\n[2] Production engine + pivot EXECUTE with codegen disabled");
let results = null;
let execError = null;
try {
  installGuards();
  const dt = engine.buildTable(rows);
  const allow = pivot.buildAllowlist(rows);
  results = {
    metricKeys: engine.metricKeys(dt),
    segmentKeys: engine.segmentKeys(dt),
    averages: engine.metricAverages(dt),
    cross: engine.crossAverage(dt, "sat_general", "genero"),
    nps: engine.nps(dt),
    csat: engine.csat(dt, "sat_general", 4),
    study: engine.computeStudyMetrics(rows, { csatMin: 4, satMetricPrefix: "sat" }),
    stage: engine.computeStageMetric(rows, "nps"),
    allowlist: allow,
    pivot: pivot.computePivot(
      rows,
      { rows: ["genero"], columns: ["nivel"], values: [
        { field: "sat_general", agg: "avg" }, { field: "sat_general", agg: "count" },
        { field: "sat_general", agg: "sum" }, { field: "sat_general", agg: "min" },
        { field: "sat_general", agg: "max" },
      ] },
      allow,
    ),
  };
} catch (e) {
  execError = e;
} finally {
  restoreGuards();
}
if (execError) {
  bad(`production path tripped the codegen guard or threw: ${execError.message}`);
}
check(tripped === null, `no eval / Function / new Function during execution${tripped ? ` (tripped: ${tripped})` : ""}`);

// ---- [3] results must be genuinely data-bearing -----------------------------
console.log("\n[3] Results are data-bearing (the gate is not passing on empty output)");
if (results === null) {
  bad("no results captured");
} else {
  check(results.metricKeys.length === 2, `metricKeys = 2 metrics (got ${results.metricKeys.length})`);
  check(results.segmentKeys.join(",") === "genero,nivel", `segmentKeys = genero,nivel (got ${results.segmentKeys.join(",")})`);
  const sat = results.averages.find((a) => a.metric_key === "sat_general");
  check(Boolean(sat) && sat.n === 5 && sat.average === 3.8, `avg sat_general = 3.8 (n=5) (got ${JSON.stringify(sat)})`);
  const f = results.cross.find((c) => c.segment === "F");
  check(Boolean(f) && f.n === 3 && Math.abs(f.average - 4.33) < 1e-9, `cross sat_general · F = 4.33 (n=3) (got ${JSON.stringify(f)})`);
  check(Boolean(results.nps) && results.nps.total === 5, `NPS computed (total=5, nps=${results.nps?.nps})`);
  check(Boolean(results.csat) && results.csat.total === 5, `CSAT computed (${results.csat?.csat}%)`);
  check(results.study.respondents === 5, `computeStudyMetrics respondents = 5 (got ${results.study.respondents})`);
  check(results.stage.kind === "nps" && results.stage.n === 5, "computeStageMetric produced an NPS headline");

  const p = results.pivot;
  check(p.body.length === 2, `pivot body has 2 row combos (got ${p.body.length})`);
  check(p.colCombos.length === 2, `pivot has 2 column combos (got ${p.colCombos.length})`);
  check(p.measures.length === 5, `pivot carries all 5 aggregations (got ${p.measures.length})`);
  const cell = p.body.find((b) => b.rowLabels[0] === "F");
  const preKey = p.colCombos.find((c) => c.labels[0] === "preescolar")?.key;
  check(Boolean(cell) && preKey !== undefined && cell.cells[`${preKey}|m0`] === 5,
    `F·preescolar avg sat = 5, a real value (got ${cell?.cells[`${preKey}|m0`]})`);
  check(cell?.cellNs[`${preKey}|m0`] === 2, `F·preescolar n = 2 (got ${cell?.cellNs[`${preKey}|m0`]})`);
  const nonNull = p.body.flatMap((b) => Object.values(b.cells)).filter((v) => v !== null).length;
  check(nonNull >= 10, `${nonNull} non-null pivot cells`);
}

// ---- [4] positive control: Arquero MUST trip the same guards ----------------
// Arquero is imported OUTSIDE the guards on purpose: the failure mode being
// reproduced is its CALL-TIME expression compilation, which is what broke
// production.
console.log("\n[4] Positive control — the Arquero pipeline still trips the guard");
const arquero = await import("arquero");
let arqueroThrew = false;
try {
  installGuards();
  arquero.from(rows).groupby("metric_key")
    .rollup({ average: (d) => arquero.op.average(d.value) })
    .objects();
} catch {
  arqueroThrew = true;
} finally {
  restoreGuards();
}
check(arqueroThrew, "Arquero throws under the guard — the gate genuinely detects codegen");

// ---- [5] static import scan -------------------------------------------------
console.log("\n[5] No production-reachable file imports Arquero");
function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (/\.(ts|tsx|js|jsx|mjs)$/.test(name)) out.push(p);
  }
  return out;
}
const srcFiles = walk("src");
const offenders = srcFiles.filter((f) =>
  /(^|[^\w])(from\s+['"]arquero['"]|require\(\s*['"]arquero['"]\s*\)|import\(\s*['"]arquero['"]\s*\))/.test(readFileSync(f, "utf8")),
);
check(offenders.length === 0, `scanned ${srcFiles.length} files under src/ — zero Arquero imports${offenders.length ? `: ${offenders.join(", ")}` : ""}`);

const pkg = JSON.parse(readFileSync("package.json", "utf8"));
check(!pkg.dependencies?.arquero, "arquero is not a runtime dependency");
check(pkg.devDependencies?.arquero === "8.0.3", `arquero 8.0.3 retained as a dev-only parity oracle (got ${pkg.devDependencies?.arquero})`);

console.log("\n" + "=".repeat(70));
if (failures > 0) {
  console.error(`RESULT: ${failures} failure(s). GATE BLOCKED.`);
  process.exit(1);
}
console.log("RESULT: calculation layer imports and runs without runtime code generation. GATE PASSED.");
