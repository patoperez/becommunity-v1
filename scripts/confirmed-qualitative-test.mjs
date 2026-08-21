import assert from "node:assert/strict";
import { summarizeConfirmedQualitative } from "../src/lib/qualitative/published.ts";
import { buildSegmentFilterOptions, filterRowsBySegments } from "../src/lib/calc/filters.ts";

const rows = [
  ...Array.from({ length: 5 }, (_, index) => ({ id: `a${index}`, respondent_id: `r${index}`, theme: "comunicacion", stage_key: "admision", quote: index === 0 ? "Cita aprobada" : null, source: "encuesta", category: null, genero: "F" })),
  ...Array.from({ length: 4 }, (_, index) => ({ id: `b${index}`, respondent_id: `x${index}`, theme: "precio", stage_key: null, quote: null, source: "encuesta", category: null, genero: "M" })),
];
const summary = summarizeConfirmedQualitative(rows);
assert.deepEqual(summary.themes.map(({ theme, count, n, visibility }) => ({ theme, count, n, visibility })), [
  { theme: "comunicacion", count: 5, n: 5, visibility: "caution" },
  { theme: "precio", count: 4, n: 4, visibility: "suppressed" },
]);
assert.deepEqual(summary.quotes, [{ id: "a0", quote: "Cita aprobada", theme: "comunicacion", themeVisibility: "caution" }]);
const options = buildSegmentFilterOptions(rows);
assert.deepEqual(options, [{ key: "genero", values: ["F", "M"] }]);
assert.equal(filterRowsBySegments(rows, { genero: "F" }, options).length, 5);
console.log("P4C confirmed qualitative tests passed: suppression, approved quotes, and shared filtering.");
