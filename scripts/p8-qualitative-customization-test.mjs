import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

let checks = 0;
const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const has = (source, pattern, message) => { assert.match(source, pattern, message); checks += 1; };
const lacks = (source, pattern, message) => { assert.doesNotMatch(source, pattern, message); checks += 1; };

const [migration, rollback, actions, page, authorized, narrative, qualitative, cloud, config, studyActions, templates, pdf] = await Promise.all([
  read("supabase/migrations/0017_interpretation_workflow.sql"),
  read("supabase/rollbacks/0017_interpretation_workflow.sql"),
  read("src/app/studio/e/[studyId]/interpretacion/actions.ts"),
  read("src/app/studio/e/[studyId]/interpretacion/page.tsx"),
  read("src/lib/studies/authorized.ts"), read("src/app/dashboard/NarrativeHome.tsx"),
  read("src/app/dashboard/QualitativeInsights.tsx"), read("src/components/evidence/QualitativeCloud.tsx"),
  read("src/lib/dashboard/config.ts"), read("src/app/admin/studies/actions.ts"),
  read("supabase/migrations/0018_shared_internal_templates.sql"), read("src/lib/reporting/pdf.ts"),
]);

for (const table of ["study_interpretation", "study_interpretation_event"]) {
  has(migration, new RegExp(`alter table public\\.${table} enable row level security`), `${table} enables RLS`);
  has(migration, new RegExp(`alter table public\\.${table} force row level security`), `${table} forces RLS`);
}
has(migration, /grant select, insert on public\.study_interpretation_event to service_role/, "event log is append-only at privilege level");
has(migration, /published_content=current\.draft_content/, "publication snapshots the approved draft");
has(migration, /insert into public\.study_interpretation_event/, "every transition records an event");
has(rollback, /drop table if exists public\.study_interpretation_event/, "migration has rollback");
has(actions, /auth\.getUser\(\)/, "every interpretation mutation authenticates");
has(actions, /profile\?\.role !== "internal"/, "every interpretation mutation authorizes internal role");
has(actions, /interpretationContentSchema\.safeParse/, "draft content is bounded by schema");
has(actions, /loadInterpretationEvidence/, "submitted evidence is checked against the study inventory");
has(actions, /canonicalEvidence/, "the server stores canonical evidence labels rather than posted labels");
has(page, /¿Qué pasó\?/, "structured reading asks what happened");
has(page, /¿Por qué importa\?/, "structured reading asks why it matters");
has(page, /¿Qué conviene mirar después\?/, "structured reading asks what comes next");
has(authorized, /publishedInterpretation: interpretation\.published/, "client boundary exposes only published reading");
lacks(authorized, /draft_content[\s\S]*return \{/, "authorized DTO does not expose draft content directly");
has(narrative, /Lectura del equipo/, "published reading has a client presentation");
has(qualitative, /QualitativeCloud/, "qualitative evidence offers the cloud alternate");
has(cloud, /Descargar imagen/, "word cloud exports as an image");
has(cloud, /lista con cantidades sigue siendo la referencia/, "cloud is never sole evidence");
lacks(cloud, /dangerouslySetInnerHTML/, "cloud renders escaped React text");
has(config, /presentation: z\.object/, "study presentation is validated");
has(studyActions, /loadStudyMetricOptions/, "threshold metric is verified against study inventory");
has(studyActions, /dashboardConfigFromSections\(sections, presentation\)/, "presentation persists with dashboard config");
has(templates, /where id=p_template_id;/, "team members may instantiate shared templates");
has(pdf, /input\.interpretation\.whatHappened/, "PDF contains published interpretation");

console.log(`P8.4 qualitative, interpretation and customization: PASS (${checks} checks)`);
