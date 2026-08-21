import assert from "node:assert/strict";
import { computeStudyMetrics } from "../src/lib/calc/engine.ts";
import {
  buildSegmentFilterOptions,
  filterRowsBySegments,
  validateSegmentFilters,
} from "../src/lib/calc/filters.ts";

const people = [
  { id: "1", genero: "F", nivel: "preescolar", nps: 9, sat: 5 },
  { id: "2", genero: "F", nivel: "primaria", nps: 6, sat: 3 },
  { id: "3", genero: "M", nivel: "preescolar", nps: 10, sat: 4 },
  { id: "4", genero: "M", nivel: "primaria", nps: 7, sat: 2 },
  { id: "5", genero: "F", nivel: "preescolar", nps: 8, sat: 5 },
];
const rows = people.flatMap((person) => [
  { respondent_id: person.id, metric_key: "nps", value: person.nps, genero: person.genero, nivel: person.nivel },
  { respondent_id: person.id, metric_key: "sat", value: person.sat, genero: person.genero, nivel: person.nivel },
]);

const options = buildSegmentFilterOptions(rows);
assert.deepEqual(options, [
  { key: "genero", values: ["F", "M"] },
  { key: "nivel", values: ["preescolar", "primaria"] },
]);

const selected = filterRowsBySegments(rows, { genero: "F", nivel: "preescolar" }, options);
assert.equal(selected.length, 4);
assert.deepEqual([...new Set(selected.map((row) => row.respondent_id))], ["1", "5"]);
const metrics = computeStudyMetrics(selected);
assert.equal(metrics.respondents, 2);
assert.equal(metrics.nps?.nps, 50);
assert.equal(metrics.averages.find((metric) => metric.metric_key === "sat")?.average, 5);

assert.equal(filterRowsBySegments(rows, {}, options), rows, "no filters should preserve the input rows");
assert.deepEqual(filterRowsBySegments(rows, { genero: "M", nivel: "secundaria" }, [
  ...options,
  { key: "nivel", values: ["preescolar", "primaria", "secundaria"] },
]), []);
assert.deepEqual(validateSegmentFilters({ secreto: "x" }, options), {
  ok: false,
  errors: ["Dimensión de filtro no permitida: 'secreto'."],
});
assert.deepEqual(validateSegmentFilters({ genero: "DROP TABLE" }, options), {
  ok: false,
  errors: ["Valor no permitido para 'genero': 'DROP TABLE'."],
});
assert.throws(() => filterRowsBySegments(rows, { secreto: "x" }, options), /Filtros inválidos/);
assert.throws(() => filterRowsBySegments(rows, { genero: "DROP TABLE" }, options), /Filtros inválidos/);

console.log("P4A BI filter tests passed: catalogue, two-filter AND, live metrics, and allowlist rejection.");
