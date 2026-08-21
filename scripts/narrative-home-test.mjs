import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { buildNarrativeHome } from "../src/lib/dashboard/narrative.ts";

const safeMetric = (key, title, value) => ({ key, title, value, detail: null, visibility: "standard" });
const dashboard = {
  sections: { narrative: true, trends: true, filters: true, journey: true, qualitative: true, metrics: true, segments: true, pivot: true, report: true },
  filterOptions: [], pivotAllowlist: { dimensions: [], metrics: [] },
  view: {
    emptyStudy: false, emptySelection: false, selectionVisibility: "standard", selectedUnits: 40, sourceUnits: 40,
    tiles: [safeMetric("respondents", "Encuestados", "40"), safeMetric("nps", "NPS", "45"), safeMetric("csat:sat_servicio", "CSAT servicio", "80%")],
    averages: [safeMetric("average:cri", "CRI", "31.25")], crossSegment: null, crosses: [], journey: [], canPivot: false,
    qualitative: { themes: [
      { theme: "acompanamiento", count: 12, n: 12, visibility: "caution" },
      { theme: "comunicacion", count: 8, n: 8, visibility: "caution" },
    ], quotes: [], hasSuppressedThemes: true },
  },
};
const longitudinal = { periods: 3, series: [
  { key: "nps", title: "NPS", unit: "nps", points: [
    { studyName: "2024", period: "2024", value: 20, n: 40, visibility: "standard" },
    { studyName: "2025", period: "2025", value: 36.7, n: 40, visibility: "standard" },
    { studyName: "2026", period: "2026", value: 45, n: 40, visibility: "standard" },
  ] },
  { key: "csat:sat_servicio", title: "CSAT servicio", unit: "percent", points: [
    { studyName: "2024", period: "2024", value: 70, n: 40, visibility: "standard" },
    { studyName: "2025", period: "2025", value: null, n: null, visibility: "no-data" },
    { studyName: "2026", period: "2026", value: 80, n: 40, visibility: "standard" },
  ] },
  { key: "average:cri", title: "CRI", unit: "score", points: [
    { studyName: "2024", period: "2024", value: 35, n: 40, visibility: "standard" },
    { studyName: "2025", period: "2025", value: 32.5, n: 40, visibility: "standard" },
    { studyName: "2026", period: "2026", value: 31.25, n: 40, visibility: "standard" },
  ] },
] };

const view = buildNarrativeHome({ id: "study-current", name: "Experiencia 2026", period: "2026" }, dashboard, longitudinal);
assert.equal(view.metrics.some((metric) => metric.key === "respondents"), false, "sample size is not a headline KPI");
assert.equal(view.metrics.find((metric) => metric.key === "nps").delta, "+8.3 pts");
assert.equal(view.metrics.find((metric) => metric.key === "nps").movement, "up");
assert.equal(view.metrics.find((metric) => metric.key === "average:cri").delta, "-1.25 pts", "negative movement stays descriptive");
assert.equal(view.metrics.find((metric) => metric.key === "csat:sat_servicio").delta, null, "an immediate missing wave must not be skipped");
assert.deepEqual(view.themes, [{ theme: "acompanamiento", count: 12 }, { theme: "comunicacion", count: 8 }]);
assert.equal(JSON.stringify(view).includes("respondent_id"), false);

const page = await readFile(new URL("../src/app/dashboard/page.tsx", import.meta.url), "utf8");
assert.match(page, /profile\?\.role === "internal"[\s\S]*?narrative/, "internal multi-tenant views must not receive a client narrative");
console.log("Narrative home gate: PASS");
