// =============================================================================
// MANDATORY parity gate — Workers-safe calculation layer vs the Arquero oracle
//   npx tsx scripts/cloudflare-calc-compat-test.mjs
// =============================================================================
// Arquero 8.0.3 compiles its expressions with the `Function` constructor, which
// Cloudflare Workers prohibit, so the production engine was rewritten on plain
// data structures (src/lib/calc/table.ts). Arquero stays pinned as a DEV-ONLY
// dependency and is used here as the parity ORACLE: the pre-change engine and
// pivot implementations are reproduced verbatim below, run against the same
// deterministic synthetic fixtures, and diffed field-by-field against the new
// production code.
//
// Compared: values, nulls, counts, row order, column order, labels, raw
// precision (exact float identity, never an epsilon) and the full set of output
// keys. Any mismatch prints an actionable diff and exits non-zero.
//
// Fixtures are synthetic and seeded. No client, consultant or production data.
// =============================================================================

import { from, op } from "arquero";
import { roundTo, DECIMALS, npsFromScores, csatTopBox, mean } from "../src/lib/calc/metrics.ts";
import {
  buildTable,
  metricAverages,
  crossAverage,
  metricKeys,
  segmentKeys,
  computeStudyMetrics,
  computeStageMetric,
  nps as engineNps,
  csat as engineCsat,
} from "../src/lib/calc/engine.ts";
import { computePivot, buildAllowlist, validatePivotIntent } from "../src/lib/calc/pivot.ts";

let failures = 0;
const ok = (m) => console.log("  ✓", m);
const bad = (m) => { console.error("  ✗ FAIL:", m); failures++; };

// ---------------------------------------------------------------------------
// ORACLE — the pre-change Arquero implementations, copied verbatim.
// ---------------------------------------------------------------------------
const oracle = {
  buildTable: (rows) => from(rows),
  metricKeys: (dt) => [...new Set(dt.array("metric_key"))],
  segmentKeys: (dt) => {
    const reserved = new Set(["respondent_id", "metric_key", "value"]);
    return dt.columnNames().filter((c) => !reserved.has(c));
  },
  isEmpty: (dt) => dt.numRows() === 0,
  valuesFor(dt, metricKey) {
    if (this.isEmpty(dt)) return [];
    return dt.params({ metricKey }).filter((d, $) => d.metric_key === $.metricKey).array("value");
  },
  metricAverages(dt) {
    if (this.isEmpty(dt)) return [];
    return dt
      .groupby("metric_key")
      .rollup({ average: (d) => op.average(d.value), n: () => op.count() })
      .objects()
      .map((r) => ({
        metric_key: String(r.metric_key),
        average: r.average == null ? null : roundTo(Number(r.average), DECIMALS.score),
        n: Number(r.n),
      }));
  },
  crossAverage(dt, metricKey, segment) {
    if (this.isEmpty(dt)) return [];
    return dt
      .params({ metricKey })
      .filter((d, $) => d.metric_key === $.metricKey)
      .groupby(segment)
      .rollup({ average: (d) => op.average(d.value), n: () => op.count() })
      .objects()
      .map((r) => ({
        segment: r[segment] == null ? "(sin dato)" : String(r[segment]),
        average: r.average == null ? null : roundTo(Number(r.average), DECIMALS.score),
        n: Number(r.n),
      }));
  },
  nps(dt, metricKey = "nps") {
    const values = this.valuesFor(dt, metricKey);
    return values.length === 0 ? null : npsFromScores(values);
  },
  csat(dt, metricKey, satisfiedMin = 9) {
    const values = this.valuesFor(dt, metricKey);
    return values.length === 0 ? null : csatTopBox(values, satisfiedMin);
  },
  computeStudyMetrics(rows, opts = {}) {
    const dt = this.buildTable(rows);
    const keys = this.metricKeys(dt);
    const segments = this.segmentKeys(dt);
    const satPrefix = opts.satMetricPrefix ?? "sat";
    const csatMin = opts.csatMin ?? 9;
    const respondents = new Set(rows.map((r) => r.respondent_id)).size;
    const averages = this.metricAverages(dt).filter((a) => a.metric_key !== "nps");
    const csatList = keys
      .filter((k) => k === "csat" || k.startsWith(satPrefix))
      .map((k) => ({ metric_key: k, result: this.csat(dt, k, csatMin) }))
      .filter((c) => c.result !== null);
    const crossSegment = opts.crossSegment ?? (segments.includes("genero") ? "genero" : segments[0] ?? null);
    const crosses = crossSegment ? keys.map((k) => ({ metric_key: k, rows: this.crossAverage(dt, k, crossSegment) })) : [];
    return { respondents, nps: this.nps(dt), averages, csat: csatList, crossSegment, crosses };
  },
  computeStageMetric(rows, metricKey, csatMin = 9) {
    const dt = this.buildTable(rows);
    const values = this.valuesFor(dt, metricKey);
    const n = values.length;
    if (n === 0) return { metricKey, kind: "average", value: null, unit: "score", n: 0, detail: [] };
    if (metricKey.startsWith("nps")) {
      const r = npsFromScores(values);
      return { metricKey, kind: "nps", value: r.nps, unit: "nps", n: r.total, detail: [
        { label: "Promotores", value: String(r.promoters) },
        { label: "Pasivos", value: String(r.passives) },
        { label: "Detractores", value: String(r.detractors) },
      ] };
    }
    if (metricKey.startsWith("sat") || metricKey.startsWith("csat")) {
      const avg = mean(values, DECIMALS.journeyHeadline);
      const c = csatTopBox(values, csatMin);
      return { metricKey, kind: "csat", value: avg, unit: "score", n, detail: [
        { label: "CSAT (Top-2-Box)", value: `${c.csat}%` },
        { label: "Satisfechos", value: `${c.satisfied}/${c.total}` },
      ] };
    }
    return { metricKey, kind: "average", value: mean(values, DECIMALS.journeyHeadline), unit: "score", n, detail: [] };
  },
  rollupExpr(agg) {
    switch (agg) {
      case "avg": return (d) => op.average(d.value);
      case "sum": return (d) => op.sum(d.value);
      case "min": return (d) => op.min(d.value);
      case "max": return (d) => op.max(d.value);
      case "count": return () => op.count();
    }
  },
  computePivot(rows, intent, allow) {
    const aggLabel = { avg: "Promedio", count: "Conteo", sum: "Suma", min: "Mín", max: "Máx" };
    const v = validatePivotIntent(intent, allow);
    if (!v.ok) throw new Error(`PivotIntent inválido: ${v.errors.join(" ")}`);
    const measures = intent.values.map((val, i) => ({
      id: `m${i}`, field: val.field, agg: val.agg, label: `${aggLabel[val.agg]} · ${val.field}`,
    }));
    const groupFields = [...intent.rows, ...intent.columns];
    const rowKeyMap = new Map(); const colKeyMap = new Map();
    const cellMap = new Map(); const cellNMap = new Map();
    for (const m of measures) {
      const filtered = from(rows).params({ field: m.field }).filter((d, $) => d.metric_key === $.field);
      const grouped = groupFields.length
        ? filtered.groupby(groupFields).rollup({ val: this.rollupExpr(m.agg), n: () => op.count() })
        : filtered.rollup({ val: this.rollupExpr(m.agg), n: () => op.count() });
      for (const obj of grouped.objects()) {
        const rk = intent.rows.map((f) => String(obj[f] ?? ""));
        const ck = intent.columns.map((f) => String(obj[f] ?? ""));
        const rks = rk.join("§"); const cks = ck.join("§");
        rowKeyMap.set(rks, rk); colKeyMap.set(cks, ck);
        cellMap.set(`${rks}|${cks}|${m.id}`, obj.val == null ? null : Number(obj.val));
        cellNMap.set(`${rks}|${cks}|${m.id}`, Number(obj.n));
      }
    }
    const sortedRows = [...rowKeyMap.entries()].sort((a, b) => a[0].localeCompare(b[0]));
    const sortedCols = [...colKeyMap.entries()].sort((a, b) => a[0].localeCompare(b[0]));
    const colCombos = sortedCols.map(([key, labels]) => ({ key, labels }));
    const body = sortedRows.map(([rks, rowLabels]) => {
      const cells = {}; const cellNs = {};
      for (const [cks] of sortedCols) {
        for (const m of measures) {
          cells[`${cks}|${m.id}`] = cellMap.get(`${rks}|${cks}|${m.id}`) ?? null;
          cellNs[`${cks}|${m.id}`] = cellNMap.get(`${rks}|${cks}|${m.id}`) ?? 0;
        }
      }
      return { rowLabels, cells, cellNs };
    });
    return { rowFields: intent.rows, colFields: intent.columns, measures, colCombos, body };
  },
};

// ---------------------------------------------------------------------------
// Structural diff. Distinguishes null / undefined / missing key, preserves array
// order, and compares numbers with Object.is so raw precision must match exactly.
// ---------------------------------------------------------------------------
function deepDiff(a, b, path = "", out = []) {
  if (Object.is(a, b)) return out;
  const ta = a === null ? "null" : Array.isArray(a) ? "array" : typeof a;
  const tb = b === null ? "null" : Array.isArray(b) ? "array" : typeof b;
  if (ta !== tb) { out.push(`${path || "<root>"}: type ${ta} vs ${tb} (${fmt(a)} vs ${fmt(b)})`); return out; }
  if (ta === "array") {
    if (a.length !== b.length) out.push(`${path}.length: ${a.length} vs ${b.length}`);
    for (let i = 0; i < Math.max(a.length, b.length); i++) deepDiff(a[i], b[i], `${path}[${i}]`, out);
    return out;
  }
  if (ta === "object") {
    const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])];
    const ka = Object.keys(a).join(","); const kb = Object.keys(b).join(",");
    if (ka !== kb) out.push(`${path}: key set/order "${ka}" vs "${kb}"`);
    for (const k of keys) deepDiff(a[k], b[k], `${path}.${k}`, out);
    return out;
  }
  out.push(`${path || "<root>"}: ${fmt(a)} vs ${fmt(b)}`);
  return out;
}
const fmt = (v) => (v === undefined ? "undefined" : typeof v === "number" ? String(v) : JSON.stringify(v));

/** Run a thunk, capturing a throw as a comparable outcome. */
function attempt(fn) {
  try { return { threw: false, value: fn() }; }
  catch (e) { return { threw: true, message: String(e?.message ?? e) }; }
}

/**
 * Compare oracle vs production. Throw-vs-throw counts as parity: the ERROR TEXT
 * is intentionally allowed to differ (Arquero reports its internal expression
 * name, e.g. `d.metric_key`, where table.ts reports the column name).
 */
function compare(label, oracleFn, newFn) {
  const o = attempt(oracleFn);
  const n = attempt(newFn);
  if (o.threw || n.threw) {
    if (o.threw && n.threw) { ok(`${label} — both threw (parity preserved)`); return; }
    bad(`${label} — oracle ${o.threw ? "threw" : "returned"} but new ${n.threw ? "threw" : "returned"}` +
        (n.threw ? `; new error: ${n.message}` : `; oracle error: ${o.message}`));
    return;
  }
  const diff = deepDiff(o.value, n.value);
  if (diff.length === 0) ok(label);
  else { bad(`${label} — ${diff.length} difference(s):`); for (const d of diff.slice(0, 12)) console.error("      ·", d); }
}

// ---------------------------------------------------------------------------
// Deterministic seeded synthetic fixtures.
// ---------------------------------------------------------------------------
function lcg(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }

function seededRows(seed, n) {
  const rnd = lcg(seed);
  const generos = ["F", "M", "No binario", "Ñoño"];
  const niveles = ["preescolar", "primaria", "secundaria", ""];
  const metrics = ["nps", "sat_general", "sat_maestros", "otro"];
  const rows = [];
  for (let i = 0; i < n; i++) {
    const metric = metrics[Math.floor(rnd() * metrics.length)];
    const raw = metric === "nps" ? Math.floor(rnd() * 11) : Math.round(rnd() * 500) / 100;
    rows.push({
      respondent_id: `r${Math.floor(rnd() * Math.max(2, n / 3))}`,
      metric_key: metric,
      value: rnd() < 0.05 ? -raw : raw,
      genero: generos[Math.floor(rnd() * generos.length)],
      nivel: niveles[Math.floor(rnd() * niveles.length)],
    });
  }
  return rows;
}

const R = (respondent_id, metric_key, value, extra = {}) => ({ respondent_id, metric_key, value, ...extra });

const FIXTURES = {
  empty: [],
  oneRow: [R("1", "m", 5, { g: "A" })],
  duplicates: [R("1", "m", 2, { g: "A" }), R("2", "m", 2, { g: "A" }), R("3", "m", 2, { g: "A" })],
  negatives: [R("1", "m", -3.5, { g: "A" }), R("2", "m", 1.25, { g: "A" }), R("3", "m", -0.75, { g: "B" })],
  // 5/3 = 1.6666666666666667 — must survive as a raw repeating decimal.
  thirds: [R("1", "m", 1, { g: "A" }), R("2", "m", 2, { g: "A" }), R("3", "m", 2, { g: "A" })],
  emptyStringSeg: [R("1", "m", 1, { g: "" }), R("2", "m", 3, { g: "x" }), R("3", "m", 5, { g: "" })],
  unicodeSeg: [R("1", "m", 1, { g: "Ñoño" }), R("2", "m", 2, { g: "日本語" }), R("3", "m", 3, { g: "emoji-🙂" })],
  // Segment labels that contain the pivot's own display delimiter.
  delimiterSeg: [
    R("1", "m", 1, { g: "a§b", h: "c" }),
    R("2", "m", 3, { g: "a", h: "b§c" }),
    R("3", "m", 5, { g: "a§b", h: "c" }),
    R("4", "m", 7, { g: "x|y", h: "z" }),
  ],
  multiMetric: [
    R("1", "nps", 9, { genero: "F" }), R("1", "sat_general", 5, { genero: "F" }),
    R("2", "nps", 6, { genero: "M" }), R("2", "sat_general", 3, { genero: "M" }),
    R("3", "nps", 10, { genero: "F" }), R("3", "sat_general", 4, { genero: "F" }),
  ],
  // Metric/cross ORDER is first-appearance, never sorted: b before a.
  ordering: [R("1", "b", 1, { g: "z" }), R("2", "a", 2, { g: "y" }), R("3", "b", 3, { g: "x" })],
  multiDim: [
    R("1", "m", 1, { g: "F", h: "p" }), R("2", "m", 2, { g: "F", h: "q" }),
    R("3", "m", 3, { g: "M", h: "p" }), R("4", "m", 4, { g: "M", h: "q" }),
    R("5", "m", 5, { g: "F", h: "p" }),
  ],
  seeded: seededRows(20260822, 240),
};

// Rows whose FIRST row omits a segment key that later rows carry. Arquero hides
// the key entirely; the new table layer reproduces that, so both must agree.
FIXTURES.missingSegProp = [R("1", "m", 1), R("2", "m", 3, { g: "A" })];
// A declared segment column that is absent on a later row (reads as undefined).
FIXTURES.sparseSeg = [R("1", "m", 1, { g: "A" }), { respondent_id: "2", metric_key: "m", value: 3 }];

console.log("Be Community — Cloudflare/Workers calculation parity gate");

// ---------------------------------------------------------------------------
console.log("\n[1] engine.ts — table introspection");
for (const [name, rows] of Object.entries(FIXTURES)) {
  compare(`metricKeys · ${name}`, () => oracle.metricKeys(oracle.buildTable(rows)), () => metricKeys(buildTable(rows)));
  compare(`segmentKeys · ${name}`, () => oracle.segmentKeys(oracle.buildTable(rows)), () => segmentKeys(buildTable(rows)));
}

console.log("\n[2] engine.ts — metricAverages (round-once @ DECIMALS.score)");
for (const [name, rows] of Object.entries(FIXTURES)) {
  compare(`metricAverages · ${name}`, () => oracle.metricAverages(oracle.buildTable(rows)), () => metricAverages(buildTable(rows)));
}

console.log("\n[3] engine.ts — crossAverage (incl. '(sin dato)' presentation)");
const crossCases = [
  ["oneRow", "m", "g"], ["duplicates", "m", "g"], ["negatives", "m", "g"], ["thirds", "m", "g"],
  ["emptyStringSeg", "m", "g"], ["unicodeSeg", "m", "g"], ["delimiterSeg", "m", "g"],
  ["multiMetric", "nps", "genero"], ["multiMetric", "sat_general", "genero"],
  ["ordering", "b", "g"], ["multiDim", "m", "h"], ["seeded", "sat_general", "genero"],
  ["seeded", "nps", "nivel"], ["sparseSeg", "m", "g"], ["empty", "m", "g"],
  ["missingSegProp", "m", "g"], // oracle throws: 'g' is not a column of the table
];
for (const [name, metric, seg] of crossCases) {
  compare(`crossAverage · ${name} · ${metric} × ${seg}`,
    () => oracle.crossAverage(oracle.buildTable(FIXTURES[name]), metric, seg),
    () => crossAverage(buildTable(FIXTURES[name]), metric, seg));
}

console.log("\n[4] engine.ts — canonical NPS / CSAT delegation");
for (const [name, rows] of Object.entries(FIXTURES)) {
  compare(`nps · ${name}`, () => oracle.nps(oracle.buildTable(rows)), () => engineNps(buildTable(rows)));
  compare(`csat · ${name}`, () => oracle.csat(oracle.buildTable(rows), "sat_general", 4), () => engineCsat(buildTable(rows), "sat_general", 4));
}

console.log("\n[5] engine.ts — computeStudyMetrics orchestration");
const studyOpts = [{}, { csatMin: 4, satMetricPrefix: "sat" }, { crossSegment: "g" }, { csatMin: 1 }];
for (const [name, rows] of Object.entries(FIXTURES)) {
  for (const [i, opts] of studyOpts.entries()) {
    compare(`computeStudyMetrics · ${name} · opts${i}`,
      () => oracle.computeStudyMetrics(rows, opts), () => computeStudyMetrics(rows, opts));
  }
}

console.log("\n[6] engine.ts — computeStageMetric (journey headline)");
for (const [name, rows] of Object.entries(FIXTURES)) {
  for (const mk of ["nps", "sat_general", "m", "otro", "missing"]) {
    compare(`computeStageMetric · ${name} · ${mk}`,
      () => oracle.computeStageMetric(rows, mk), () => computeStageMetric(rows, mk));
  }
}

console.log("\n[7] pivot.ts — allowlist + intent validation");
for (const [name, rows] of Object.entries(FIXTURES)) {
  compare(`buildAllowlist · ${name}`, () => buildAllowlist(rows), () => buildAllowlist(rows));
}
const invalidIntents = [
  { rows: ["address"], columns: [], values: [{ field: "m", agg: "avg" }] },
  { rows: ["g"], columns: ["secret"], values: [{ field: "m", agg: "avg" }] },
  { rows: ["g"], columns: [], values: [{ field: "DROP TABLE", agg: "avg" }] },
  { rows: ["g"], columns: [], values: [{ field: "m", agg: "eval" }] },
  { rows: ["g"], columns: [], values: [] },
  { rows: ["g"], columns: ["g"], values: [{ field: "m", agg: "avg" }] },
  { rows: [], columns: [], values: [{ field: "m", agg: "avg" }] },
  { rows: ["__proto__"], columns: [], values: [{ field: "m", agg: "avg" }] },
  { rows: ["constructor"], columns: [], values: [{ field: "m", agg: "avg" }] },
];
for (const [i, intent] of invalidIntents.entries()) {
  const allow = buildAllowlist(FIXTURES.multiDim);
  compare(`invalid intent #${i} rejected identically`,
    () => oracle.computePivot(FIXTURES.multiDim, intent, allow),
    () => computePivot(FIXTURES.multiDim, intent, allow));
}

console.log("\n[8] pivot.ts — all aggregations, dimensions and measure shapes");
const AGGS = ["avg", "count", "sum", "min", "max"];
const pivotCases = [];
for (const name of ["oneRow", "duplicates", "negatives", "thirds", "emptyStringSeg", "unicodeSeg", "multiDim", "seeded", "sparseSeg"]) {
  const rows = FIXTURES[name];
  const dims = [...new Set(rows.flatMap((r) => Object.keys(r)))].filter((k) => !["respondent_id", "metric_key", "value"].includes(k));
  const metric = rows[0]?.metric_key ?? "m";
  for (const agg of AGGS) {
    if (dims[0]) pivotCases.push([name, { rows: [dims[0]], columns: [], values: [{ field: metric, agg }] }, `row-only ${agg}`]);
    if (dims[0]) pivotCases.push([name, { rows: [], columns: [dims[0]], values: [{ field: metric, agg }] }, `col-only ${agg}`]);
    if (dims[0] && dims[1]) pivotCases.push([name, { rows: [dims[0]], columns: [dims[1]], values: [{ field: metric, agg }] }, `row+col ${agg}`]);
  }
  if (dims[0]) {
    pivotCases.push([name, { rows: [dims[0]], columns: [], values: [
      { field: metric, agg: "avg" }, { field: metric, agg: "count" }, { field: metric, agg: "sum" },
    ] }, "multi-measure same metric"]);
  }
  if (dims[0] && dims[1]) {
    pivotCases.push([name, { rows: [dims[0], dims[1]], columns: [], values: [{ field: metric, agg: "avg" }] }, "two row dims"]);
  }
}
// A metric that matches nothing: exercises null cells and zero sample size.
pivotCases.push(["multiDim", { rows: ["g"], columns: [], values: [{ field: "m", agg: "avg" }] }, "baseline"]);
for (const [name, intent, label] of pivotCases) {
  const rows = FIXTURES[name];
  const allow = buildAllowlist(rows);
  compare(`computePivot · ${name} · ${label} · ${JSON.stringify(intent.rows)}×${JSON.stringify(intent.columns)}`,
    () => oracle.computePivot(rows, intent, allow), () => computePivot(rows, intent, allow));
}

console.log("\n[9] pivot.ts — zero-match metric (null cells, n = 0)");
{
  const rows = FIXTURES.multiDim;
  const allow = { ...buildAllowlist(rows), metrics: [...buildAllowlist(rows).metrics, "absent"] };
  for (const intent of [
    { rows: ["g"], columns: [], values: [{ field: "absent", agg: "avg" }] },
    { rows: [], columns: ["g"], values: [{ field: "absent", agg: "count" }] },
    { rows: ["g"], columns: ["h"], values: [{ field: "absent", agg: "sum" }] },
  ]) {
    compare(`computePivot · zero-match · ${JSON.stringify(intent.values[0].agg)}`,
      () => oracle.computePivot(rows, intent, allow), () => computePivot(rows, intent, allow));
  }
}

// ---------------------------------------------------------------------------
// [10] INTENTIONAL DIFFERENCE — group-key collision hardening.
// The old `§`-join merged distinct tuples such as ["a§b","c"] and ["a","b§c"]
// into one cell. This is a correctness/security fix and is deliberately NOT
// claimed as parity; it is asserted explicitly instead.
// ---------------------------------------------------------------------------
console.log("\n[10] Group-key collision hardening (intentional difference)");
{
  const rows = FIXTURES.delimiterSeg;
  const allow = buildAllowlist(rows);
  const intent = { rows: ["g", "h"], columns: [], values: [{ field: "m", agg: "count" }] };
  const before = oracle.computePivot(rows, intent, allow);
  const after = computePivot(rows, intent, allow);

  const tuples = new Set(rows.map((r) => JSON.stringify([r.g, r.h])));
  if (before.body.length < tuples.size) ok(`oracle collides: ${tuples.size} distinct tuples -> ${before.body.length} rows`);
  else bad(`expected the oracle to collide, but it produced ${before.body.length} rows`);

  if (after.body.length === tuples.size) ok(`new impl keeps all ${tuples.size} tuples distinct`);
  else bad(`new impl produced ${after.body.length} rows for ${tuples.size} distinct tuples`);

  const labelSet = new Set(after.body.map((b) => JSON.stringify(b.rowLabels)));
  if (labelSet.size === after.body.length) ok("row labels remain unique and unmodified");
  else bad("row labels are not distinct");

  // ["a§b","c"] and ["a","b§c"] must land in different rows.
  const findRow = (g, h) => after.body.find((b) => b.rowLabels[0] === g && b.rowLabels[1] === h);
  const rowA = findRow("a§b", "c"); const rowB = findRow("a", "b§c");
  if (rowA && rowB && rowA !== rowB) ok('["a§b","c"] and ["a","b§c"] are distinct rows');
  else bad("delimiter-bearing tuples still collide");
  if (rowA?.cells["|m0"] === 2 && rowB?.cells["|m0"] === 1) ok("counts land in the right buckets (2 and 1)");
  else bad(`counts wrong: ${rowA?.cells["|m0"]} / ${rowB?.cells["|m0"]}`);
}

console.log("\n[11] Combo-key format is unchanged for ordinary labels");
{
  const rows = FIXTURES.multiDim;
  const allow = buildAllowlist(rows);
  const oneDim = computePivot(rows, { rows: ["g"], columns: [], values: [{ field: "m", agg: "avg" }] }, allow);
  oneDim.colCombos.length === 1 && oneDim.colCombos[0].key === ""
    ? ok('no-column pivot still uses the "" combo key (cells keyed "|m0")')
    : bad(`no-column combo key = ${JSON.stringify(oneDim.colCombos[0]?.key)}`);
  oneDim.body.every((b) => "|m0" in b.cells)
    ? ok('body cells still keyed "|m0"')
    : bad("body cell keys changed for the no-column case");
  const twoDim = computePivot(rows, { rows: ["g"], columns: ["h"], values: [{ field: "m", agg: "avg" }] }, allow);
  twoDim.colCombos.every((c) => c.key === c.labels.join("§"))
    ? ok("ordinary combo keys are byte-identical to the previous §-join")
    : bad("combo key format changed for ordinary labels");
}

console.log("\n" + "=".repeat(70));
if (failures > 0) { console.error(`RESULT: ${failures} parity failure(s). GATE BLOCKED.`); process.exit(1); }
console.log("RESULT: Workers-safe calculation layer matches the Arquero oracle. GATE PASSED.");
