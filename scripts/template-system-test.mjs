import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { cloneTemplatePayload, templatePayloadSchema, templatePreview } from "../src/lib/templates/schema.ts";

const source = {
  version: 1,
  metricSet: ["nps", "csat_docentes"],
  segmentationDimensions: [{ key: "nivel", label: "Nivel", parentKey: null, config: {} }],
  recodingTables: [{ key: "acuerdo", name: "Escala de acuerdo", version: 1, values: { "Muy de acuerdo": 5 } }],
  columnMappings: [],
  journeyDefinition: { stages: [{ key: "entrada", metricKey: "nps" }] },
  dashboardConfig: { sections: ["resumen"] },
  qualitativeCategories: ["fortalezas"],
};

const parsed = templatePayloadSchema.parse({
  ...source,
  respondents: [{ id: "sensible", value: 10 }],
  quotes: ["texto sensible"],
});
assert.equal("respondents" in parsed, false, "response rows must be stripped from template payloads");
assert.equal("quotes" in parsed, false, "quotes must be stripped from template payloads");

const studySnapshot = cloneTemplatePayload(parsed);
source.metricSet.push("cri");
source.dashboardConfig.sections.push("journey");
assert.deepEqual(studySnapshot.metricSet, ["nps", "csat_docentes"], "study snapshot must be independent");
assert.deepEqual(studySnapshot.dashboardConfig, { sections: ["resumen"] }, "nested config must be deep-copied");
assert.deepEqual(templatePreview(studySnapshot), {
  metrics: 2,
  dimensions: 1,
  mappings: 0,
  journeyStages: 1,
  qualitativeCategories: 1,
});

const migration = readFileSync(new URL("../supabase/migrations/0006_study_template_framework.sql", import.meta.url), "utf8");
const protectionMigration = readFileSync(new URL("../supabase/migrations/0007_protect_template_snapshot_columns.sql", import.meta.url), "utf8");
assert.match(migration, /template_snapshot jsonb not null/, "study must persist a template snapshot");
assert.match(migration, /source\.payload, source\.id, source\.version/, "instantiation must copy payload and origin version");
assert.match(migration, /revoke all[^;]+authenticated/si, "browser roles must not execute template operations");
assert.doesNotMatch(migration, /quant_response|qual_observation|respondent\s/i, "instantiation must not copy study data");
assert.match(protectionMigration, /revoke select on table public\.study from authenticated/i);
assert.doesNotMatch(protectionMigration.match(/grant select \([\s\S]*?\)/i)?.[0] ?? "", /template_snapshot|template_origin/i,
  "client column allowlist must exclude internal template provenance");

console.log("Template framework tests passed: schema, privacy, preview, and deep-copy semantics.");
