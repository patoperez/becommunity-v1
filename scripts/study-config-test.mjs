import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { parseDashboardConfig, dashboardConfigFromSections, DEFAULT_DASHBOARD_SECTIONS } from "../src/lib/dashboard/config.ts";
import { journeyDefinitionSchema, parseJourneyDefinition } from "../src/lib/calc/journey.ts";
import { buildStudyDashboard } from "../src/lib/dashboard/view.ts";

assert.deepEqual(parseDashboardConfig({}).sections, DEFAULT_DASHBOARD_SECTIONS, "legacy studies remain fully visible");
const partial = parseDashboardConfig({ version: 1, sections: { report: false, qualitative: false } });
assert.equal(partial.sections.report, false);
assert.equal(partial.sections.qualitative, false);
assert.equal(partial.sections.metrics, true);
assert.equal(parseDashboardConfig({ sections: { report: "yes" } }).sections.report, true, "malformed config falls back safely");
assert.equal(dashboardConfigFromSections(partial.sections).version, 1);

const journey = { stages: [
  { id: "inicio", label: "Inicio", metric: "sat_servicio", description: "Primer contacto" },
  { id: "cierre", label: "Cierre", metric: "nps_recomendacion" },
] };
assert.deepEqual(parseJourneyDefinition(journey), journey.stages);
assert.equal(journeyDefinitionSchema.safeParse({ stages: [...journey.stages, journey.stages[0]] }).success, false, "stage ids are unique");
assert.deepEqual(parseJourneyDefinition({ stages: [{ id: "Bad ID", label: "x", metric: "x" }] }), [], "invalid definitions fail closed");

const rows = Array.from({ length: 30 }, (_, index) => ({ respondent_id: `r-${index}`, metric_key: "sat_servicio", value: 8, area: "General" }));
const hidden = buildStudyDashboard(rows, [], journey.stages, {}, {
  version: 1,
  sections: { filters: false, journey: false, qualitative: false, metrics: false, segments: false, pivot: false, report: false },
});
assert.deepEqual(hidden.filterOptions, []);
assert.deepEqual(hidden.view.journey, []);
assert.deepEqual(hidden.view.tiles, []);
assert.deepEqual(hidden.view.averages, []);
assert.deepEqual(hidden.view.crosses, []);
assert.equal(hidden.view.canPivot, false);
assert.equal(hidden.sections.report, false);

const actions = await readFile(new URL("../src/app/admin/studies/actions.ts", import.meta.url), "utf8");
const page = await readFile(new URL("../src/app/admin/studies/page.tsx", import.meta.url), "utf8");
const refresh = await readFile(new URL("../src/app/dashboard/data-actions.ts", import.meta.url), "utf8");
const route = await readFile(new URL("../src/app/api/studies/[studyId]/report/route.ts", import.meta.url), "utf8");
assert.match(actions, /statusSchema = z\.enum\(\["draft", "published", "archived"\]\)/);
assert.match(actions, /Carga respuestas o confirma hallazgos antes de publicar/, "empty studies cannot be published");
assert.match(actions, /review_status", "confirmed"/, "unreviewed qualitative text cannot make a study publishable");
assert.match(actions, /dashboardConfigFromSections/);
assert.match(actions, /journeyDefinitionSchema/);
assert.match(page, /StudyConfigurator/);
assert.match(refresh, /context\.study\.dashboard_config/, "filtered refresh uses the persisted configuration");
assert.match(route, /if \(!sections\.report\)/, "disabled reports must not be downloadable by URL");

console.log("Study publication and dashboard configuration gate: PASS");
