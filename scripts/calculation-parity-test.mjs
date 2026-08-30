// =============================================================================
// One study, four surfaces, one number
// =============================================================================
// Credentials-free and deterministic. It builds a study whose answers it knows
// exactly, computes the expected Top-2-Box BY HAND from the documented rule,
// and then asserts that every path a number can reach a person through agrees
// with it and with each other:
//
//   the composer's engine      src/lib/experience/data.ts, through the semantic
//                              registry the adapter builds
//   the client dashboard       src/lib/dashboard/view.ts
//   the server PDF             src/lib/reporting/pdf.ts
//   the longitudinal series    src/lib/dashboard/longitudinal.ts
//
// WHY IT EXISTS. `computeStudyMetrics` was called from three of those four with
// no `csatMin` at all, so every satisfaction result on them was measured
// against `DEFAULT_CSAT_MIN` — the threshold for a 0–10 scale. A study answered
// 1–5 therefore reported a confident, wrong 0 % on the client's own screen and
// in the report they keep. The composer had already been fixed by deriving the
// scale in its own adapter, which is exactly the shape of defect this file
// exists to catch: one fact, derived twice, and only one of them right.
//
// BOTH DOCUMENTED SCALES ARE EXERCISED. 1–5 (satisfied from 4) and 0–10
// (satisfied from 9), in the same study, so a fix that hardcodes either one
// fails here.
//
// AND A SCALE NOBODY DOCUMENTED IS REFUSED RATHER THAN GUESSED. A result
// answered 0–100 has no authoritative Top-2-Box; every surface omits it, and
// none of them prints a zero in its place.
// =============================================================================

import assert from "node:assert/strict";
import { inflateSync } from "node:zlib";

import { csatTopBox, mean, roundTo, DECIMALS } from "../src/lib/calc/metrics.ts";
import { computeStageMetric, computeStudyMetrics } from "../src/lib/calc/engine.ts";
import {
  documentedTopBoxMinimum,
  observedScales,
  resolveTopBoxMinimum,
  topBoxMinimumsFor,
} from "../src/lib/calc/scale.ts";
import { buildStudyDashboard } from "../src/lib/dashboard/view.ts";
import { buildLongitudinalView } from "../src/lib/dashboard/longitudinal.ts";
import { buildStudyReport } from "../src/lib/reporting/pdf.ts";
import { adaptLegacyStudy, registryKeyIndex } from "../src/lib/experience/adapter.ts";
import { resolveBlockData } from "../src/lib/experience/data.ts";

let checks = 0;
const ok = (message) => {
  checks += 1;
  console.log(`  PASS  ${message}`);
};

// ---------------------------------------------------------------------------
// One study, with answers this file chose
// ---------------------------------------------------------------------------

/**
 * Twelve people, three results, two documented scales and one undocumented one.
 *
 * The values are written out rather than generated so the expected numbers
 * below can be derived by hand and disagree loudly with an engine that changes
 * behaviour.
 */
const GENERATION = ["X", "Y", "Z"];
const SENIORITY = ["nuevo", "veterano"];

/** 1–5: satisfied from 4. Six of twelve are 4 or 5. */
const SAT_FIVE = [1, 2, 3, 4, 5, 5, 3, 4, 2, 5, 1, 4];
/** 0–10: satisfied from 9. Four of twelve are 9 or 10. */
const SAT_TEN = [0, 3, 5, 9, 10, 7, 8, 9, 2, 10, 6, 4];
/** 0–100: no documented Top-2-Box at all. */
const SAT_HUNDRED = [10, 20, 30, 40, 55, 60, 70, 80, 90, 95, 100, 15];
/** The recommendation result, so NPS is exercised beside the rest. */
const NPS = [10, 9, 8, 7, 6, 10, 9, 5, 3, 10, 9, 8];

const rows = [];
for (let index = 0; index < 12; index += 1) {
  const segments = {
    seg_generacion: GENERATION[index % GENERATION.length],
    seg_antiguedad: SENIORITY[index % SENIORITY.length],
  };
  const push = (metric_key, value) =>
    rows.push({ respondent_id: `r${index}`, metric_key, value, ...segments });
  push("sat_cinco", SAT_FIVE[index]);
  push("sat_diez", SAT_TEN[index]);
  push("sat_cien", SAT_HUNDRED[index]);
  push("nps_recomendacion", NPS[index]);
}

// ---------------------------------------------------------------------------
console.log("\n[1] The scale is read, and the threshold is documented");
// ---------------------------------------------------------------------------

const spans = observedScales(rows);
assert.deepEqual(spans.get("sat_cinco"), { minimum: 1, maximum: 5 });
assert.deepEqual(spans.get("sat_diez"), { minimum: 0, maximum: 10 });
assert.deepEqual(spans.get("sat_cien"), { minimum: 10, maximum: 100 });
ok("the span of each result is read from the study's own answers");

assert.equal(documentedTopBoxMinimum({ minimum: 1, maximum: 5 }), 4, "1–5 is satisfied from 4");
assert.equal(documentedTopBoxMinimum({ minimum: 0, maximum: 10 }), 9, "0–10 is satisfied from 9");
assert.equal(documentedTopBoxMinimum({ minimum: 1, maximum: 10 }), 9, "1–10 is satisfied from 9");
assert.equal(documentedTopBoxMinimum({ minimum: 10, maximum: 100 }), null, "0–100 has no rule");
assert.equal(documentedTopBoxMinimum(null), null, "no answers means no rule");
ok("only the two scales the catalogue documents produce a threshold; anything else produces none");

const thresholds = topBoxMinimumsFor(rows);
assert.equal(thresholds.get("sat_cinco"), 4);
assert.equal(thresholds.get("sat_diez"), 9);
assert.equal(thresholds.get("sat_cien"), null);
ok("the study's thresholds are derived once, per result, from the whole row set");

assert.equal(resolveTopBoxMinimum("sat_cinco", { explicit: 7, declared: thresholds }), 7);
assert.equal(resolveTopBoxMinimum("sat_cinco", { declared: thresholds }), 4);
assert.equal(resolveTopBoxMinimum("nada", { declared: thresholds }), null);
ok("a caller that states a threshold is obeyed; one that does not gets the documented one");

// A NARROWED SELECTION MUST NOT MOVE A THRESHOLD. This is the reason every
// caller derives from the whole study and passes the map down.
const middling = rows.filter(
  (row) => row.metric_key !== "sat_diez" || (row.value >= 1 && row.value <= 5),
);
assert.equal(
  documentedTopBoxMinimum(observedScales(middling).get("sat_diez")),
  4,
  "deriving from a narrowed set WOULD misread a 0–10 result as 1–5 — which is why nothing does",
);
assert.equal(thresholds.get("sat_diez"), 9, "and the threshold handed down is still the study's");
ok("a filter cannot change which documented rule a result is measured against");

// ---------------------------------------------------------------------------
console.log("\n[2] The expected numbers, computed here by hand");
// ---------------------------------------------------------------------------

const expected = {
  sat_cinco: csatTopBox(SAT_FIVE, 4),
  sat_diez: csatTopBox(SAT_TEN, 9),
};
assert.equal(expected.sat_cinco.satisfied, 6, "six of twelve answered 4 or 5");
assert.equal(expected.sat_cinco.total, 12);
assert.equal(expected.sat_cinco.csat, 50, "which is 50 %");
assert.equal(expected.sat_diez.satisfied, 4, "four of twelve answered 9 or 10");
assert.equal(expected.sat_diez.csat, roundTo((4 / 12) * 100, DECIMALS.percent));
ok(`the documented answers are ${expected.sat_cinco.csat} % on the 1–5 result and ${expected.sat_diez.csat} % on the 0–10 one`);

// The defect, stated as an assertion: the old default on a 1–5 scale.
assert.equal(
  csatTopBox(SAT_FIVE, 9).csat,
  0,
  "the 0–10 default applied to a 1–5 result is exactly the wrong 0 % this exists to prevent",
);
ok("applying the 0–10 default to a 1–5 result yields 0 % — the defect, reproduced");

// ---------------------------------------------------------------------------
console.log("\n[3] The engine agrees, on both scales, and refuses the third");
// ---------------------------------------------------------------------------

const engine = computeStudyMetrics(rows, { includeCrosses: false });
const byKey = new Map(engine.csat.map((entry) => [entry.metric_key, entry.result]));
assert.equal(byKey.get("sat_cinco").csat, expected.sat_cinco.csat);
assert.equal(byKey.get("sat_cinco").satisfiedMin, 4);
assert.equal(byKey.get("sat_diez").csat, expected.sat_diez.csat);
assert.equal(byKey.get("sat_diez").satisfiedMin, 9);
ok("computeStudyMetrics reads each result's own scale with no caller telling it to");

assert.ok(!byKey.has("sat_cien"), "a result with no documented threshold is omitted");
assert.ok(
  engine.averages.some((entry) => entry.metric_key === "sat_cien"),
  "and its AVERAGE is still reported — omitting the Top-2-Box is not omitting the result",
);
ok("a result on an undocumented scale keeps its average and reports no Top-2-Box, rather than 0 %");

// An explicit caller still gets exactly what it asks for.
const explicit = computeStudyMetrics(rows, { csatMin: 4, includeCrosses: false });
const explicitByKey = new Map(explicit.csat.map((entry) => [entry.metric_key, entry.result]));
assert.equal(explicitByKey.get("sat_diez").satisfiedMin, 4, "an explicit threshold is obeyed");
assert.equal(explicitByKey.get("sat_cien").satisfiedMin, 4, "including where none is documented");
ok("a caller that states a threshold still gets exactly the result it always got");

// The journey headline follows the same rule.
const stageFive = computeStageMetric(rows, "sat_cinco");
assert.equal(stageFive.value, mean(SAT_FIVE, DECIMALS.journeyHeadline), "the average is the headline");
assert.ok(
  stageFive.detail.some((entry) => entry.value === `${expected.sat_cinco.csat}%`),
  "and the Top-2-Box beside it is the documented one",
);
const stageHundred = computeStageMetric(rows, "sat_cien");
assert.equal(
  stageHundred.value,
  mean(SAT_HUNDRED, DECIMALS.journeyHeadline),
  "an undocumented scale keeps its average",
);
assert.deepEqual(stageHundred.detail, [], "and prints no Top-2-Box it cannot justify");
ok("a journey moment keeps its average and states a Top-2-Box only where one is documented");

// ---------------------------------------------------------------------------
console.log("\n[4] Every surface produces the same aggregate from the same rows");
// ---------------------------------------------------------------------------

const stages = [
  { id: "s1", label: "Satisfacción 1–5", metric: "sat_cinco", description: null },
  { id: "s2", label: "Satisfacción 0–10", metric: "sat_diez", description: null },
];
const config = {
  sections: { metrics: true, journey: true, qualitative: true, filters: true, report: true },
};

// --- the client dashboard ---------------------------------------------------
const dashboard = buildStudyDashboard(rows, [], stages, {}, config);
const csatTiles = (payload) =>
  new Map(
    payload.view.tiles
      .filter((entry) => entry.key.startsWith("csat:"))
      .map((entry) => [entry.key.slice("csat:".length), entry.value]),
  );
const dashboardCsat = csatTiles(dashboard);
assert.equal(
  dashboardCsat.get("sat_cinco"),
  `${expected.sat_cinco.csat}%`,
  `the client dashboard must read ${expected.sat_cinco.csat} % on the 1–5 result, not ${dashboardCsat.get("sat_cinco")}`,
);
assert.equal(dashboardCsat.get("sat_diez"), `${expected.sat_diez.csat}%`);
assert.ok(!dashboardCsat.has("sat_cien"), "and shows no Top-2-Box tile for an undocumented scale");
ok(`the client dashboard reads ${dashboardCsat.get("sat_cinco")} and ${dashboardCsat.get("sat_diez")} — the documented values`);

// And no tile anywhere on it claims a satisfaction result is zero.
const zeroTiles = dashboard.view.tiles
  .filter((entry) => entry.key.startsWith("csat:") && entry.value === "0%");
assert.deepEqual(zeroTiles, [], `a satisfaction tile reads 0 %: ${JSON.stringify(zeroTiles)}`);
ok("no satisfaction tile on the client dashboard reads 0 %");

// --- the server PDF ---------------------------------------------------------
const report = await buildStudyReport({
  tenantName: "Parity",
  study: { id: "s", name: "Parity", period: "2026", status: "published" },
  rows,
  allRows: rows,
  journeyStages: stages,
  qualitative: [],
  filters: {},
  sections: config.sections,
  generatedAt: new Date("2026-01-01T00:00:00Z"),
});
/**
 * THE TEXT A CLIENT WOULD ACTUALLY READ, out of the bytes a client would
 * actually receive.
 *
 * The layout the writer returns is page geometry — it says where things were
 * drawn, never what they said. Asserting a number is in the report therefore
 * means reading the report: the content streams are inflated and the operands
 * of the text-showing operators are collected. Anything less would be checking
 * that the PDF path was CALLED correctly rather than that it PRINTED correctly.
 */
/**
 * A show-text operator's operand, in either form a producer may write.
 *
 * pdf-lib writes HEX strings — `<48656C6C6F> Tj` — rather than the literal
 * `(Hello) Tj` most examples show, and a reader that only knows the literal
 * form quietly finds nothing and passes every "the number is absent" check it
 * was given. Both forms are read here for that reason.
 */
const TEXT_OPERAND = new RegExp(String.raw`(?:\((?:\\.|[^\\()])*\)|<[0-9A-Fa-f\s]*>)\s*Tj`, "g");
/** A backslash-escaped parenthesis or backslash inside a literal string. */
const ESCAPED_LITERAL = new RegExp(String.raw`\\([()\\])`, "g");

function decodeOperand(operand) {
  const body = operand.slice(0, operand.lastIndexOf("Tj")).trim();
  if (body.startsWith("<")) {
    const hex = body.slice(1, body.lastIndexOf(">")).replace(/\s+/g, "");
    let out = "";
    for (let index = 0; index + 1 < hex.length; index += 2) {
      out += String.fromCharCode(Number.parseInt(hex.slice(index, index + 2), 16));
    }
    return out;
  }
  return body.slice(1, body.lastIndexOf(")")).replace(ESCAPED_LITERAL, "$1");
}

function pdfText(bytes) {
  const buffer = Buffer.from(bytes);
  const pieces = [];
  let cursor = 0;
  for (;;) {
    const start = buffer.indexOf("stream", cursor);
    if (start < 0) break;
    const end = buffer.indexOf("endstream", start);
    if (end < 0) break;
    let from = start + "stream".length;
    if (buffer[from] === 0x0d) from += 1;
    if (buffer[from] === 0x0a) from += 1;
    const chunk = buffer.subarray(from, end);
    cursor = end + "endstream".length;
    let content;
    try {
      content = inflateSync(chunk).toString("latin1");
    } catch {
      content = chunk.toString("latin1");
    }
    for (const match of content.matchAll(TEXT_OPERAND)) pieces.push(decodeOperand(match[0]));
  }
  return pieces.join(" ");
}

const reportText = pdfText(report.bytes);
assert.ok(
  reportText.includes("BE COMMUNITY"),
  "the extractor must actually read the report; otherwise every check below is vacuous",
);
assert.ok(
  reportText.includes(`${expected.sat_cinco.csat}%`),
  `the report must carry ${expected.sat_cinco.csat} % for the 1–5 result`,
);
assert.ok(
  reportText.includes(`${expected.sat_diez.csat}%`),
  `the report must carry ${expected.sat_diez.csat} % for the 0–10 result`,
);
assert.ok(
  !/CSAT sat cien/i.test(reportText),
  "and prints no Top-2-Box for the result whose scale nobody documented",
);
assert.ok(
  !reportText.includes(" 0%"),
  `the report prints a satisfaction result as 0 %: ${reportText.slice(0, 400)}`,
);
ok("the server PDF carries the same two percentages the dashboard shows, and no fabricated zero");

// --- the longitudinal series ------------------------------------------------
const longitudinal = buildLongitudinalView([
  { name: "Parity", period: "2026", createdAt: "2026-01-01", rows },
  { name: "Parity", period: "2027", createdAt: "2027-01-01", rows },
]);
const series = longitudinal.series.find((entry) => entry.key === "csat:sat_cinco");
assert.ok(series, "the longitudinal view carries the 1–5 satisfaction series");
for (const point of series.points) {
  if (point.value == null) continue;
  assert.equal(
    point.value,
    expected.sat_cinco.csat,
    `a longitudinal point disagrees with the dashboard (${point.value})`,
  );
}
assert.ok(
  !longitudinal.series.some((entry) => entry.key === "csat:sat_cien"),
  "and carries no Top-2-Box series for an undocumented scale",
);
ok("every longitudinal point equals the same documented percentage");

// --- the composer -----------------------------------------------------------
const snapshot = {
  studyId: "00000000-0000-4000-8000-000000000001",
  tenantId: "00000000-0000-4000-8000-000000000002",
  studyName: "Parity",
  clientName: "Parity",
  period: "2026",
  status: "published",
  dashboardConfig: config,
  journeyDefinition: { stages },
  metrics: [...spans.keys()].map((key) => ({
    key,
    name: key,
    question: key,
    unit: key.startsWith("nps") ? "nps" : "percent",
    responses: 12,
    available: true,
    scale: spans.get(key),
  })),
  dimensions: [
    { key: "seg_generacion", values: [...new Set(GENERATION)] },
    { key: "seg_antiguedad", values: [...new Set(SENIORITY)] },
  ],
  themes: [],
  periods: ["2026"],
};
const { registry } = adaptLegacyStudy(snapshot);
const index = registryKeyIndex(snapshot);
const composerValue = (key) => {
  const metric = registry.metrics.find((entry) => index.metrics[entry.id] === key);
  assert.ok(metric, `the registry carries ${key}`);
  const outcome = resolveBlockData(rows, registry, index, {
    blockId: "b",
    metricId: metric.id,
    aggregation: "top_box",
    primaryDimensionId: null,
    secondaryDimensionId: null,
    topN: null,
    sort: { by: "value", direction: "desc" },
    restrict: [],
  });
  return { metric, outcome };
};

const composerFive = composerValue("sat_cinco");
assert.equal(composerFive.metric.topBoxMinimum, 4, "the registry carries the documented threshold");
assert.ok(composerFive.outcome.ok, "the composer computes the 1–5 Top-2-Box");
assert.equal(
  composerFive.outcome.data.overall.value,
  expected.sat_cinco.csat,
  "and it equals the dashboard's number",
);
const composerTen = composerValue("sat_diez");
assert.equal(composerTen.metric.topBoxMinimum, 9);
assert.equal(composerTen.outcome.data.overall.value, expected.sat_diez.csat);
ok("the composer's engine produces the same two percentages as the dashboard, the PDF and the series");

const composerHundred = composerValue("sat_cien");
assert.equal(composerHundred.metric.topBoxMinimum, null, "no threshold is invented for 0–100");
assert.ok(
  !composerHundred.metric.aggregations.includes("top_box"),
  "so the composer does not OFFER a Top-2-Box for it",
);
assert.equal(composerHundred.outcome.ok, false, "and asking for one anyway is refused");
assert.equal(composerHundred.outcome.reason, "unsupported_aggregation");
ok("an undocumented scale is refused by the composer rather than answered with a fabricated number");

// --- and all four together --------------------------------------------------
const everywhere = [
  { where: "the engine", value: byKey.get("sat_cinco").csat },
  { where: "the client dashboard", value: Number(dashboardCsat.get("sat_cinco").replace("%", "")) },
  { where: "the longitudinal series", value: series.points[0].value },
  { where: "the composer", value: composerFive.outcome.data.overall.value },
];
for (const entry of everywhere) {
  assert.equal(
    entry.value,
    expected.sat_cinco.csat,
    `${entry.where} disagrees: ${entry.value} instead of ${expected.sat_cinco.csat}`,
  );
}
ok(
  `all four surfaces produce ${expected.sat_cinco.csat} % from the same rows: `
    + everywhere.map((entry) => entry.where).join(", "),
);

// ---------------------------------------------------------------------------
console.log("\n[5] A narrowed selection is narrowed, not rescaled");
// ---------------------------------------------------------------------------

const veterans = rows.filter((row) => row.seg_antiguedad === "veterano");
const veteranFive = SAT_FIVE.filter((_, index) => index % 2 === 1);
const narrowed = computeStudyMetrics(veterans, {
  includeCrosses: false,
  topBoxMinimums: thresholds,
});
const narrowedByKey = new Map(narrowed.csat.map((entry) => [entry.metric_key, entry.result]));
assert.equal(narrowedByKey.get("sat_cinco").satisfiedMin, 4, "the threshold is the study's");
assert.equal(
  narrowedByKey.get("sat_cinco").csat,
  csatTopBox(veteranFive, 4).csat,
  "and the number is the one those rows produce under it",
);
assert.equal(
  narrowedByKey.get("sat_diez").satisfiedMin,
  9,
  "a 0–10 result stays a 0–10 result however the rows are narrowed",
);
const filteredDashboard = buildStudyDashboard(rows, [], stages, { seg_antiguedad: "veterano" }, config);
const filteredCsat = csatTiles(filteredDashboard).get("sat_cinco");
assert.equal(
  filteredCsat,
  `${csatTopBox(veteranFive, 4).csat}%`,
  "and the filtered dashboard agrees with the filtered engine",
);
ok("a filter narrows which rows are counted and never which rule they are counted under");

console.log(`\nOK — ${checks} calculation-parity checks passed.`);
