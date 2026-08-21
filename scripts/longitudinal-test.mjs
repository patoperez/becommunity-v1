import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { buildLongitudinalView } from "../src/lib/dashboard/longitudinal.ts";

function rows(metric, values) {
  return values.map((value, index) => ({ respondent_id: `person-${index}`, metric_key: metric, value, seg_group: "A" }));
}

const view = buildLongitudinalView([
  { name: "Tercero", period: "2026", createdAt: "2026-01-01T00:00:00Z", rows: [...rows("nps", [10, 10, 9, 8, 0]), ...rows("new_stage", [5, 4, 5, 4, 5])] },
  { name: "Primero", period: "2024", createdAt: "2024-01-01T00:00:00Z", rows: rows("nps", [10, 9, 8, 7, 0, 1]) },
  { name: "Segundo", period: "2025", createdAt: "2025-01-01T00:00:00Z", rows: rows("nps", [10, 9, 8]) },
]);

assert.equal(view.periods, 3);
const nps = view.series.find((series) => series.key === "nps");
assert.ok(nps);
assert.deepEqual(nps.points.map((point) => point.period), ["2024", "2025", "2026"], "periods must be chronological");
assert.equal(nps.points[0].visibility, "caution");
assert.equal(nps.points[1].visibility, "suppressed");
assert.equal(nps.points[1].value, null, "small-sample values must not cross the boundary");
assert.equal(nps.points[1].n, null, "small-sample exact n must not cross the boundary");

const newStage = view.series.find((series) => series.key === "average:new_stage");
assert.ok(newStage);
assert.deepEqual(newStage.points.map((point) => point.visibility), ["no-data", "no-data", "caution"], "new metrics retain earlier gaps");

const serialized = JSON.stringify(view);
assert.doesNotMatch(serialized, /person-/i, "respondent identifiers must never be serialized");
assert.doesNotMatch(serialized, /respondent_id|metric_key|seg_group/, "raw row field names must never be serialized");

const pageSource = await readFile(new URL("../src/app/dashboard/page.tsx", import.meta.url), "utf8");
const componentSource = await readFile(new URL("../src/app/dashboard/LongitudinalTrends.tsx", import.meta.url), "utf8");
assert.match(pageSource, /buildLongitudinalView/, "the Server Component must build the longitudinal DTO");
assert.match(pageSource, /profile\?\.role === "internal"/, "internal users must not aggregate multiple tenants into one history");
assert.doesNotMatch(componentSource, /LongRow|respondent_id/, "the client chart must accept aggregate DTOs only");

console.log("Longitudinal aggregation gate: PASS");
