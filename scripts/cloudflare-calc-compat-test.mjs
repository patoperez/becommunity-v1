// =============================================================================
// MANDATORY parity gate — Workers-safe calculation layer vs the Arquero oracle
//   npx tsx scripts/cloudflare-calc-compat-test.mjs
// =============================================================================
// Arquero 8.0.3 compiles its expressions with the `Function` constructor, which
// Cloudflare Workers prohibit, so the production engine was rewritten on plain
// data structures (src/lib/calc/table.ts). Arquero stays pinned as a DEV-ONLY
// dependency and is used here as the parity ORACLE.
//
// ORACLE INDEPENDENCE (this is the point of the file): the oracle below is a
// self-contained reproduction of the PRE-CHANGE implementation — including its
// own `buildAllowlist` and its own `validatePivotIntent`. It never calls the
// production module under test, so a regression cannot corrupt both sides of
// the comparison and still pass.
//
// Compared: values, nulls, counts, row order, column order, labels, raw
// precision (exact float identity, never an epsilon) and the full set of output
// keys. Throws are compared by NORMALIZED ERROR CATEGORY, so an unrelated
// TypeError can never be mistaken for the expected failure.
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

// ---------------------------------------------------------------------------
// ORACLE — the pre-change implementations, reproduced in full and independently.
// Nothing here imports from src/lib/calc/pivot.ts.
// ---------------------------------------------------------------------------
const ORACLE_AGG_KINDS = ["avg", "count", "sum", "min", "max"];
const ORACLE_RESERVED = new Set(["respondent_id", "metric_key", "value"]);

const oracle = {
  // -- independent copy of the pre-change buildAllowlist ---------------------
  buildAllowlist(rows) {
    const dimensions = new Set();
    const metrics = new Set();
    for (const r of rows) {
      for (const k of Object.keys(r)) {
        if (!ORACLE_RESERVED.has(k)) dimensions.add(k);
      }
      metrics.add(r.metric_key);
    }
    return { dimensions: [...dimensions], metrics: [...metrics], aggs: ORACLE_AGG_KINDS };
  },

  // -- independent copy of the pre-change validatePivotIntent ----------------
  // Error text and PUSH ORDER are part of the observable contract.
  validatePivotIntent(intent, allow) {
    const errors = [];
    const dimSet = new Set(allow.dimensions);
    const metSet = new Set(allow.metrics);
    const aggSet = new Set(allow.aggs);

    for (const f of intent.rows) {
      if (!dimSet.has(f)) errors.push(`Dimensión de fila no permitida: '${f}'.`);
    }
    for (const f of intent.columns) {
      if (!dimSet.has(f)) errors.push(`Dimensión de columna no permitida: '${f}'.`);
    }
    const overlap = intent.rows.filter((f) => intent.columns.includes(f));
    if (overlap.length) errors.push(`Una dimensión no puede ser fila y columna a la vez: ${overlap.join(", ")}.`);
    if (intent.rows.length === 0 && intent.columns.length === 0) {
      errors.push("Selecciona al menos una dimensión para cruzar.");
    }
    if (intent.values.length === 0) errors.push("Selecciona al menos una métrica.");
    for (const v of intent.values) {
      if (!metSet.has(v.field)) errors.push(`Métrica no permitida: '${v.field}'.`);
      if (!aggSet.has(v.agg)) errors.push(`Agregación no permitida: '${v.agg}'.`);
    }
    return errors.length ? { ok: false, errors } : { ok: true };
  },

  buildTable: (rows) => from(rows),
  metricKeys: (dt) => [...new Set(dt.array("metric_key"))],
  segmentKeys(dt) {
    return dt.columnNames().filter((c) => !ORACLE_RESERVED.has(c));
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
      default: throw new Error(`unsupported agg ${agg}`);
    }
  },
  computePivot(rows, intent, allow) {
    const aggLabel = { avg: "Promedio", count: "Conteo", sum: "Suma", min: "Mín", max: "Máx" };
    // Uses the ORACLE validator, never the production one.
    const v = this.validatePivotIntent(intent, allow);
    if (!v.ok) throw new Error(`PivotIntent inválido: ${v.errors.join(" ")}`);
    const measures = intent.values.map((val, i) => ({
      id: `m${i}`, field: val.field, agg: val.agg, label: `${aggLabel[val.agg]} · ${val.field}`,
    }));
    const groupFields = [...intent.rows, ...intent.columns];
    const rowKeyMap = new Map();
    const colKeyMap = new Map();
    const cellMap = new Map();
    const cellNMap = new Map();
    for (const m of measures) {
      const filtered = from(rows).params({ field: m.field }).filter((d, $) => d.metric_key === $.field);
      const grouped = groupFields.length
        ? filtered.groupby(groupFields).rollup({ val: this.rollupExpr(m.agg), n: () => op.count() })
        : filtered.rollup({ val: this.rollupExpr(m.agg), n: () => op.count() });
      for (const obj of grouped.objects()) {
        const rk = intent.rows.map((f) => String(obj[f] ?? ""));
        const ck = intent.columns.map((f) => String(obj[f] ?? ""));
        const rks = rk.join("§");
        const cks = ck.join("§");
        rowKeyMap.set(rks, rk);
        colKeyMap.set(cks, ck);
        cellMap.set(`${rks}|${cks}|${m.id}`, obj.val == null ? null : Number(obj.val));
        cellNMap.set(`${rks}|${cks}|${m.id}`, Number(obj.n));
      }
    }
    const sortedRows = [...rowKeyMap.entries()].sort((a, b) => a[0].localeCompare(b[0]));
    const sortedCols = [...colKeyMap.entries()].sort((a, b) => a[0].localeCompare(b[0]));
    const colCombos = sortedCols.map(([key, labels]) => ({ key, labels }));
    const body = sortedRows.map(([rks, rowLabels]) => {
      const cells = {};
      const cellNs = {};
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
// Structural diff + normalized throw comparison.
// ---------------------------------------------------------------------------
const fmt = (v) => (v === undefined ? "undefined" : typeof v === "number" ? String(v) : JSON.stringify(v));

function deepDiff(a, b, path = "", out = []) {
  if (Object.is(a, b)) return out;
  const ta = a === null ? "null" : Array.isArray(a) ? "array" : typeof a;
  const tb = b === null ? "null" : Array.isArray(b) ? "array" : typeof b;
  if (ta !== tb) {
    out.push(`${path || "<root>"}: type ${ta} vs ${tb} (${fmt(a)} vs ${fmt(b)})`);
    return out;
  }
  if (ta === "array") {
    if (a.length !== b.length) out.push(`${path}.length: ${a.length} vs ${b.length}`);
    for (let i = 0; i < Math.max(a.length, b.length); i += 1) deepDiff(a[i], b[i], `${path}[${i}]`, out);
    return out;
  }
  if (ta === "object") {
    const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])];
    const ka = Object.keys(a).join(",");
    const kb = Object.keys(b).join(",");
    if (ka !== kb) out.push(`${path}: key set/order "${ka}" vs "${kb}"`);
    for (const k of keys) deepDiff(a[k], b[k], `${path}.${k}`, out);
    return out;
  }
  out.push(`${path || "<root>"}: ${fmt(a)} vs ${fmt(b)}`);
  return out;
}

/**
 * Normalize a thrown error to an externally meaningful FAILURE CATEGORY.
 *
 * Arquero's internal wording is allowed to differ from table.ts's (it reports
 * `d.metric_key` where we report `metric_key`), but the category must match —
 * so an unrelated TypeError can never be scored as parity with an expected
 * invalid-column-reference.
 */
function errorCategory(err) {
  const msg = String(err?.message ?? err);
  if (/^PivotIntent inválido/.test(msg)) return "invalid-pivot-intent";
  if (/Invalid column reference/i.test(msg)) return "invalid-column-reference";
  if (err instanceof TypeError) return "TypeError";
  if (err instanceof RangeError) return "RangeError";
  if (err instanceof EvalError) return "EvalError";
  return `other:${err?.constructor?.name ?? "Error"}`;
}

function attempt(fn) {
  try {
    return { threw: false, value: fn() };
  } catch (e) {
    return { threw: true, category: errorCategory(e), message: String(e?.message ?? e) };
  }
}

function compare(label, oracleFn, newFn) {
  const o = attempt(oracleFn);
  const n = attempt(newFn);
  if (o.threw !== n.threw) {
    bad(`${label} — oracle ${o.threw ? `threw (${o.category})` : "returned"} but new ${n.threw ? `threw (${n.category})` : "returned"}` +
        (n.threw ? `; new error: ${n.message}` : `; oracle error: ${o.message}`));
    return;
  }
  if (o.threw) {
    if (o.category === n.category) ok(`${label} — both threw ${o.category}`);
    else bad(`${label} — throw CATEGORY mismatch: oracle=${o.category} ("${o.message}") vs new=${n.category} ("${n.message}")`);
    return;
  }
  const diff = deepDiff(o.value, n.value);
  if (diff.length === 0) {
    ok(label);
  } else {
    bad(`${label} — ${diff.length} difference(s):`);
    for (const d of diff.slice(0, 12)) console.error("      ·", d);
  }
}

// ---------------------------------------------------------------------------
// Deterministic seeded synthetic fixtures.
// ---------------------------------------------------------------------------
function lcg(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

function seededRows(seed, n) {
  const rnd = lcg(seed);
  const generos = ["F", "M", "No binario", "Ñoño"];
  const niveles = ["preescolar", "primaria", "secundaria", ""];
  const metrics = ["nps", "sat_general", "sat_maestros", "otro"];
  const rows = [];
  for (let i = 0; i < n; i += 1) {
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

// ---------------------------------------------------------------------------
// RUNTIME-SEMANTICS fixtures. These deliberately use plain JS objects that are
// looser than the TypeScript `LongRow` type, to characterize what the engine
// actually does with null / undefined / NaN reaching it at runtime. Production
// data cannot contain these (loadStudyRows drops non-finite values and fills
// missing segments with ""), so this is defensive parity, not a live path.
// ---------------------------------------------------------------------------
FIXTURES.segNull = [R("1", "m", 1, { g: null }), R("2", "m", 3, { g: "A" }), R("3", "m", 5, { g: null })];
FIXTURES.segUndefined = [R("1", "m", 1, { g: undefined }), R("2", "m", 3, { g: "A" }), R("3", "m", 5, { g: undefined })];
FIXTURES.segNullVsUndefinedVsEmpty = [
  R("1", "m", 1, { g: null }), R("2", "m", 2, { g: undefined }), R("3", "m", 3, { g: "" }), R("4", "m", 4, { g: "z" }),
];
FIXTURES.valNull = [R("1", "m", null, { g: "A" }), R("2", "m", 4, { g: "A" })];
FIXTURES.valUndefined = [R("1", "m", undefined, { g: "A" }), R("2", "m", 4, { g: "A" })];
FIXTURES.valNaN = [R("1", "m", NaN, { g: "A" }), R("2", "m", 4, { g: "A" })];
// A group mixing valid and invalid numbers next to a group with only invalids.
FIXTURES.mixedValidity = [
  R("1", "m", 2, { g: "mixed" }), R("2", "m", null, { g: "mixed" }),
  R("3", "m", NaN, { g: "mixed" }), R("4", "m", 4, { g: "mixed" }),
  R("5", "m", undefined, { g: "mixed" }),
  R("6", "m", null, { g: "allInvalid" }), R("7", "m", NaN, { g: "allInvalid" }),
];
FIXTURES.allInvalid = [R("1", "m", null, { g: "A" }), R("2", "m", NaN, { g: "A" }), R("3", "m", undefined, { g: "A" })];

const RUNTIME_SEMANTICS_FIXTURES = [
  "segNull", "segUndefined", "segNullVsUndefinedVsEmpty",
  "valNull", "valUndefined", "valNaN", "mixedValidity", "allInvalid",
];

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
  ...RUNTIME_SEMANTICS_FIXTURES.map((f) => [f, "m", "g"]),
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

console.log("\n[7] pivot.ts — buildAllowlist vs the INDEPENDENT oracle allowlist");
for (const [name, rows] of Object.entries(FIXTURES)) {
  compare(`buildAllowlist · ${name}`, () => oracle.buildAllowlist(rows), () => buildAllowlist(rows));
}

console.log("\n[8] pivot.ts — validatePivotIntent vs the INDEPENDENT oracle validator");
const validationIntents = [
  { rows: ["address"], columns: [], values: [{ field: "m", agg: "avg" }] },
  { rows: ["g"], columns: ["secret"], values: [{ field: "m", agg: "avg" }] },
  { rows: ["g"], columns: [], values: [{ field: "DROP TABLE", agg: "avg" }] },
  { rows: ["g"], columns: [], values: [{ field: "m", agg: "eval" }] },
  { rows: ["g"], columns: [], values: [] },
  { rows: ["g"], columns: ["g"], values: [{ field: "m", agg: "avg" }] },
  { rows: [], columns: [], values: [{ field: "m", agg: "avg" }] },
  { rows: ["__proto__"], columns: [], values: [{ field: "m", agg: "avg" }] },
  { rows: ["constructor"], columns: [], values: [{ field: "m", agg: "avg" }] },
  // multiple simultaneous errors — asserts the exact push ORDER of the messages
  { rows: ["nope1"], columns: ["nope2"], values: [{ field: "nope3", agg: "nope4" }] },
  { rows: ["g", "h"], columns: ["h"], values: [{ field: "m", agg: "avg" }, { field: "zzz", agg: "min" }] },
  // valid intents must agree too
  { rows: ["g"], columns: [], values: [{ field: "m", agg: "avg" }] },
  { rows: ["g"], columns: ["h"], values: [{ field: "m", agg: "count" }] },
];
for (const [i, intent] of validationIntents.entries()) {
  const allow = oracle.buildAllowlist(FIXTURES.multiDim);
  compare(`validatePivotIntent #${i} (errors + order)`,
    () => oracle.validatePivotIntent(intent, allow),
    () => validatePivotIntent(intent, allow));
}

console.log("\n[9] pivot.ts — invalid intents rejected identically by computePivot");
for (const [i, intent] of validationIntents.slice(0, 11).entries()) {
  const allow = oracle.buildAllowlist(FIXTURES.multiDim);
  compare(`computePivot rejects intent #${i}`,
    () => oracle.computePivot(FIXTURES.multiDim, intent, allow),
    () => computePivot(FIXTURES.multiDim, intent, allow));
}

console.log("\n[10] pivot.ts — all aggregations, dimensions and measure shapes");
const AGGS = ["avg", "count", "sum", "min", "max"];
const pivotCases = [];
const pivotFixtureNames = [
  "oneRow", "duplicates", "negatives", "thirds", "emptyStringSeg", "unicodeSeg",
  "multiDim", "seeded", "sparseSeg", ...RUNTIME_SEMANTICS_FIXTURES,
];
for (const name of pivotFixtureNames) {
  const rows = FIXTURES[name];
  const dims = [...new Set(rows.flatMap((r) => Object.keys(r)))].filter((k) => !ORACLE_RESERVED.has(k));
  const metric = rows[0]?.metric_key ?? "m";
  for (const agg of AGGS) {
    if (dims[0]) {
      pivotCases.push([name, { rows: [dims[0]], columns: [], values: [{ field: metric, agg }] }, `row-only ${agg}`]);
      pivotCases.push([name, { rows: [], columns: [dims[0]], values: [{ field: metric, agg }] }, `col-only ${agg}`]);
    }
    if (dims[0] && dims[1]) {
      pivotCases.push([name, { rows: [dims[0]], columns: [dims[1]], values: [{ field: metric, agg }] }, `row+col ${agg}`]);
    }
  }
  if (dims[0]) {
    // All five aggregations at once, so cells AND cellNs are compared together.
    pivotCases.push([name, { rows: [dims[0]], columns: [], values: AGGS.map((agg) => ({ field: metric, agg })) }, "all five aggs + cellNs"]);
    pivotCases.push([name, { rows: [dims[0]], columns: [], values: [
      { field: metric, agg: "avg" }, { field: metric, agg: "count" }, { field: metric, agg: "sum" },
    ] }, "multi-measure same metric"]);
  }
  if (dims[0] && dims[1]) {
    pivotCases.push([name, { rows: [dims[0], dims[1]], columns: [], values: [{ field: metric, agg: "avg" }] }, "two row dims"]);
  }
}
for (const [name, intent, label] of pivotCases) {
  const rows = FIXTURES[name];
  const allow = oracle.buildAllowlist(rows);
  compare(`computePivot · ${name} · ${label} · ${JSON.stringify(intent.rows)}×${JSON.stringify(intent.columns)}`,
    () => oracle.computePivot(rows, intent, allow), () => computePivot(rows, intent, allow));
}

console.log("\n[11] pivot.ts — zero-match metric (null cells, n = 0)");
{
  const rows = FIXTURES.multiDim;
  const base = oracle.buildAllowlist(rows);
  const allow = { ...base, metrics: [...base.metrics, "absent"] };
  for (const agg of AGGS) {
    compare(`computePivot · zero-match · ${agg}`,
      () => oracle.computePivot(rows, { rows: ["g"], columns: ["h"], values: [{ field: "absent", agg }] }, allow),
      () => computePivot(rows, { rows: ["g"], columns: ["h"], values: [{ field: "absent", agg }] }, allow));
  }
}

// ---------------------------------------------------------------------------
// [12] INTENTIONAL DIFFERENCE — group-key collision hardening.
// The old `§`-join merged distinct tuples such as ["a§b","c"] and ["a","b§c"]
// into one cell. This is a correctness/security fix and is deliberately NOT
// claimed as parity; it is asserted explicitly instead.
// ---------------------------------------------------------------------------
console.log("\n[12] Group-key collision hardening (intentional difference)");
{
  const rows = FIXTURES.delimiterSeg;
  const allow = oracle.buildAllowlist(rows);
  const intent = { rows: ["g", "h"], columns: [], values: [{ field: "m", agg: "count" }] };
  const before = oracle.computePivot(rows, intent, allow);
  const after = computePivot(rows, intent, allow);

  const tuples = new Set(rows.map((r) => JSON.stringify([r.g, r.h])));
  check(before.body.length < tuples.size, `oracle collides: ${tuples.size} distinct tuples -> ${before.body.length} rows`);
  check(after.body.length === tuples.size, `new impl keeps all ${tuples.size} tuples distinct (got ${after.body.length})`);

  const labelSet = new Set(after.body.map((b) => JSON.stringify(b.rowLabels)));
  check(labelSet.size === after.body.length, "row labels remain unique and unmodified");

  const findRow = (g, h) => after.body.find((b) => b.rowLabels[0] === g && b.rowLabels[1] === h);
  const rowA = findRow("a§b", "c");
  const rowB = findRow("a", "b§c");
  check(Boolean(rowA) && Boolean(rowB) && rowA !== rowB, '["a§b","c"] and ["a","b§c"] are distinct rows');
  check(rowA?.cells["|m0"] === 2 && rowB?.cells["|m0"] === 1,
    `counts land in the right buckets (got ${rowA?.cells["|m0"]} and ${rowB?.cells["|m0"]})`);
}

console.log("\n[13] Combo-key format is unchanged for ordinary labels");
{
  const rows = FIXTURES.multiDim;
  const allow = oracle.buildAllowlist(rows);
  const oneDim = computePivot(rows, { rows: ["g"], columns: [], values: [{ field: "m", agg: "avg" }] }, allow);
  check(oneDim.colCombos.length === 1 && oneDim.colCombos[0].key === "",
    'no-column pivot still uses the "" combo key (cells keyed "|m0")');
  check(oneDim.body.every((b) => "|m0" in b.cells), 'body cells still keyed "|m0"');
  const twoDim = computePivot(rows, { rows: ["g"], columns: ["h"], values: [{ field: "m", agg: "avg" }] }, allow);
  check(twoDim.colCombos.every((c) => c.key === c.labels.join("§")),
    "ordinary combo keys are byte-identical to the previous §-join");
}

console.log("\n" + "=".repeat(70));
if (failures > 0) {
  console.error(`RESULT: ${failures} parity failure(s). GATE BLOCKED.`);
  process.exit(1);
}
console.log("RESULT: Workers-safe calculation layer matches the Arquero oracle. GATE PASSED.");
