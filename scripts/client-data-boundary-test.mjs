import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { buildStudyDashboard, sanitizePivotResult } from "../src/lib/dashboard/view.ts";

const rows = Array.from({ length: 6 }, (_, index) => ({
  respondent_id: `secret-person-${index + 1}`,
  metric_key: "sat_servicio",
  value: index + 4,
  area: index < 4 ? "Unica" : "General",
}));
const qualitative = Array.from({ length: 5 }, (_, index) => ({
  id: `secret-observation-${index + 1}`,
  respondent_id: `secret-person-${index + 1}`,
  theme: "acompanamiento",
  stage_key: "inicio",
  quote: index === 0 ? "Cita aprobada y publicable" : null,
  source: "encuesta",
  category: null,
  area: "Unica",
}));

const payload = buildStudyDashboard(rows, qualitative, [{ id: "inicio", label: "Inicio", metric: "sat_servicio" }], {});
const serialized = JSON.stringify(payload);
assert.doesNotMatch(serialized, /secret-person|secret-observation/, "respondent and observation identifiers must not cross the client boundary");
assert.doesNotMatch(serialized, /"respondent_id"|"stage_key"|"source"|"category"/, "row-level fields must not cross the client boundary");
assert.match(serialized, /Cita aprobada y publicable/, "independently approved quotes remain publishable");

const small = buildStudyDashboard(rows, qualitative, [{ id: "inicio", label: "Inicio", metric: "sat_servicio" }], { area: "General" });
assert.equal(small.view.selectionVisibility, "suppressed");
assert.equal(small.view.selectedUnits, null, "a suppressed selection must not serialize its exact n");
assert.equal(small.view.tiles.length, 0, "a suppressed selection must not serialize metric details");

const safePivot = sanitizePivotResult({
  rowFields: ["area"], colFields: [], measures: [{ id: "m0", field: "sat_servicio", agg: "avg", label: "Promedio" }], colCombos: [{ key: "", labels: [] }],
  body: [{ rowLabels: ["Unica"], cells: { "|m0": 5.5 }, cellNs: { "|m0": 4 } }],
});
assert.equal(safePivot.body[0].cells["|m0"], null);
assert.equal(safePivot.body[0].cellNs["|m0"], null);
assert.equal(safePivot.body[0].suppressed["|m0"], true);

const pageSource = await readFile(new URL("../src/app/dashboard/page.tsx", import.meta.url), "utf8");
const cardSource = await readFile(new URL("../src/app/dashboard/StudyCard.tsx", import.meta.url), "utf8");
const actionSource = await readFile(new URL("../src/app/dashboard/data-actions.ts", import.meta.url), "utf8");
assert.doesNotMatch(pageSource, /rows=\{|qualitative=\{/, "page must not pass raw rows to Client Components");
assert.doesNotMatch(cardSource, /LongRow|ConfirmedQualitative/, "StudyCard must accept aggregate DTOs only");
assert.match(actionSource, /auth\.getUser\(\)/, "every recalculation must verify the user");
assert.doesNotMatch(actionSource, /createAdminClient|service_role/i, "interactive calculations must never bypass RLS");

console.log("P4E client-data boundary passed: no raw rows/IDs, server auth, RLS, and pre-serialization suppression.");
