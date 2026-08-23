import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { PDFDocument } from "pdf-lib";
import { buildStudyPdf, buildStudyReport } from "../src/lib/reporting/pdf.ts";
import { parseReportFilters } from "../src/lib/reporting/filters.ts";

const routeSource = await readFile(new URL("../src/app/api/studies/[studyId]/report/route.ts", import.meta.url), "utf8");
assert.match(routeSource, /createClient\(\)/, "report route must use the request-scoped Supabase client");
assert.match(routeSource, /auth\.getUser\(\)/, "report route must verify the user with Supabase Auth");
assert.doesNotMatch(routeSource, /createAdminClient|service_role/i, "report route must never bypass RLS");
assert.match(routeSource, /loadAuthorizedStudyData/, "report must authorize through the centralized publication boundary");
assert.match(routeSource, /private, no-store/, "report response must not be cached");
assert.doesNotMatch(routeSource, /loadStudyRows|loadConfirmedQualitative/, "report must not query raw tables directly");

assert.deepEqual(
  parseReportFilters(new URLSearchParams("f.segmento=Familias&ignored=value")),
  { ok: true, filters: { segmento: "Familias" } },
);
assert.equal(parseReportFilters(new URLSearchParams("f.segmento=a&f.segmento=b")).ok, false);
assert.equal(parseReportFilters(new URLSearchParams(`f.segmento=${"x".repeat(201)}`)).ok, false);

const rows = [];
const qualitative = [];
for (let i = 1; i <= 36; i += 1) {
  const respondent_id = `r-${i}`;
  const segmento = i <= 30 ? "Familias" : "Egresados";
  rows.push(
    { respondent_id, metric_key: "nps", value: i % 5 === 0 ? 5 : 10, segmento },
    { respondent_id, metric_key: "sat_acompanamiento", value: 7 + (i % 4), segmento },
    { respondent_id, metric_key: "sat_comunicacion", value: 6 + (i % 5), segmento },
  );
  if (i <= 30) qualitative.push({
    id: `q-${i}`,
    respondent_id,
    theme: i % 2 ? "acompanamiento" : "comunicacion",
    stage_key: i % 2 ? "inicio" : "seguimiento",
    quote: i <= 4 ? `Comentario aprobado numero ${i} sobre la experiencia.` : null,
    source: "encuesta",
    category: "experiencia",
    segmento,
  });
}

const reportInput = {
  tenantName: "Cliente demostracion",
  brand: {
    version: 1,
    displayName: "Comunidad Demo",
    tagline: "Escuchar para transformar",
    primaryColor: "#123456",
    accentColor: "#2f9e8f",
    logoPath: null,
  },
  study: { id: "study-demo", name: "Experiencia de comunidad", period: "2026", status: "published" },
  rows,
  qualitative,
  filters: {},
  journeyStages: [
    { id: "inicio", label: "Inicio", metric: "sat_acompanamiento", description: "Primer contacto y bienvenida." },
    { id: "seguimiento", label: "Seguimiento", metric: "sat_comunicacion", description: "Comunicacion durante el proceso." },
  ],
  generatedAt: new Date("2026-08-20T18:00:00-06:00"),
};

const bytes = await buildStudyPdf(reportInput);

assert.equal(Buffer.from(bytes.slice(0, 5)).toString("ascii"), "%PDF-");
const parsed = await PDFDocument.load(bytes);
assert.ok(parsed.getPageCount() >= 2, "the narrative report should span multiple pages");
assert.equal(parsed.getTitle(), "Experiencia de comunidad - Informe Be Community");
assert.equal(parsed.getAuthor(), "Be Community");

const suppressedBytes = await buildStudyPdf({
  tenantName: "Cliente demostracion",
  study: { id: "small", name: "Seleccion pequena", period: null, status: "published" },
  rows: rows.filter((row) => ["r-1", "r-2", "r-3"].includes(row.respondent_id)),
  qualitative: [],
  filters: { segmento: "Familias" },
  journeyStages: [],
  generatedAt: new Date("2026-08-20T18:00:00-06:00"),
});
assert.equal(Buffer.from(suppressedBytes.slice(0, 5)).toString("ascii"), "%PDF-");

// --- Pagination invariants -------------------------------------------------
// Text extraction and a valid header say nothing about where the page breaks
// fall, so the generator reports the geometry it actually used.
const { layout } = await buildStudyReport(reportInput);

assert.ok(layout.pages >= 2, "the narrative report should span multiple pages");
assert.equal(layout.pageLowestY.length, layout.pages);
assert.equal(layout.pageBlocks.length, layout.pages);

// 1. Every page keeps real clearance between its last line and the footer rule,
//    so no page can push text down onto (or through) the footer.
assert.ok(layout.footerClearance >= 25, `footer clearance is only ${layout.footerClearance}pt`);
for (const [index, lowest] of layout.pageLowestY.entries()) {
  assert.ok(
    lowest >= layout.footerRuleY + 25,
    `page ${index + 1} body reaches y=${lowest}, too close to the footer rule at y=${layout.footerRuleY}`,
  );
  assert.ok(lowest >= layout.contentBottom, `page ${index + 1} body passed the content bottom limit`);
}

// 2. The closing methodology section is placed as one block. A final page that
//    carries a single stranded paragraph is the defect this guards against.
const closing = layout.sectionPages.at(-1);
assert.equal(closing.section, "Metodologia y lectura");
assert.equal(layout.groupPages.length, 1, "the closing section must be written as one keep-together block");
for (const group of layout.groupPages) {
  assert.equal(
    group.startPage,
    group.endPage,
    `a keep-together block was split across pages ${group.startPage}-${group.endPage}`,
  );
}
assert.ok(
  layout.pageBlocks.at(-1) > 1,
  "the last page must not hold a single orphaned paragraph",
);

// 2b. Keeping the closing section together must not be paid for with a page
//     that is mostly blank. When the closing block is the only thing on the
//     final page, that break has to have been unavoidable: the block must be
//     taller than the room still free on the page before it. This is a
//     geometric rule, so it holds for any study rather than for one fixture.
const CLOSING_BLOCKS = 6; // heading + five paragraphs
function assertClosingPageWasUnavoidable(measured, label) {
  if (measured.pages < 2) return;
  const group = measured.groupPages[0];
  if (group.startPage !== measured.pages) return;
  if (measured.pageBlocks.at(-1) !== CLOSING_BLOCKS) return;
  const closingHeight = measured.contentTop - measured.pageLowestY.at(-1);
  const roomBefore = measured.pageLowestY.at(-2) - measured.contentBottom;
  assert.ok(
    closingHeight > roomBefore,
    `${label}: the closing section opened page ${measured.pages} on its own while ` +
      `${roomBefore.toFixed(1)}pt were still free on the previous page (block is ${closingHeight.toFixed(1)}pt)`,
  );
}
assertClosingPageWasUnavoidable(layout, "narrative report");

// 3. Every section heading lands with body content, never alone at a page foot.
for (const { section, page } of layout.sectionPages) {
  assert.ok(layout.pageBlocks[page - 1] >= 2, `section "${section}" was stranded on page ${page}`);
}

// 3b. No page may end on a heading. A section or subsection title as the last
//     drawn block means its content was pushed to the next page - the journey
//     stage whose title and description stayed behind while its result card
//     moved on is exactly this shape.
function assertNoOrphanHeading(measured, label) {
  for (const [index, kind] of measured.pageLastBlock.entries()) {
    assert.ok(
      kind !== "section" && kind !== "subheading",
      `${label}: page ${index + 1} ends on a ${kind} title, whose content fell to the next page`,
    );
  }
}
assertNoOrphanHeading(layout, "narrative report");

// The shape that produced the reported defect: twenty respondents answering
// four metrics, three journey stages and a two-value cross. That inventory -
// a small-base callout, seven summary cards (two of them CSAT), three stage
// cards and eight cross cards - is what a full report actually looks like, and
// it is the shape whose closing section used to land on a page of its own.
const wideAnswers = [
  ["F", 10, 10, 8, 6], ["F", 9, 9, 8, 6], ["F", 8, 8, 7, 6], ["F", 6, 7, 7, 6], ["F", 5, 6, 5, 6],
  ["F", 10, 10, 9, 7], ["F", 9, 10, 9, 7], ["F", 9, 9, 8, 7], ["F", 8, 8, 8, 7], ["F", 6, 8, 6, 7],
  ["M", 10, 9, 10, 8], ["M", 9, 9, 9, 8], ["M", 8, 8, 8, 8], ["M", 6, 7, 7, 8], ["M", 5, 7, 6, 8],
  ["M", 10, 10, 10, 9], ["M", 9, 9, 10, 9], ["M", 9, 9, 9, 9], ["M", 8, 8, 8, 9], ["M", 6, 7, 8, 9],
];
const wideRows = [];
wideAnswers.forEach(([genero, nps, satGeneral, satMaestros, confianza], index) => {
  const respondent_id = `p-${index + 1}`;
  wideRows.push(
    { respondent_id, metric_key: "nps", value: nps, genero },
    { respondent_id, metric_key: "sat_general", value: satGeneral, genero },
    { respondent_id, metric_key: "sat_maestros", value: satMaestros, genero },
    { respondent_id, metric_key: "confianza", value: confianza, genero },
  );
});
const { layout: wideLayout } = await buildStudyReport({
  tenantName: "Colegio de prueba (TEST A)",
  // Branded like a real client report: a display name that differs from the
  // tenant, a tagline and a study title long enough to wrap. The header is
  // part of the page-one budget, so a bare fixture would understate it.
  brand: {
    version: 1,
    displayName: "BE COMMUNITY",
    tagline: "Resultados para decidir con contexto",
    primaryColor: "#1d4ed8",
    accentColor: "#2f9e8f",
    logoPath: null,
  },
  study: {
    id: "wide",
    name: "Estudio de cruce completo con datos sinteticos",
    period: "2026 - Validacion controlada",
    status: "published",
  },
  rows: wideRows,
  qualitative: [],
  filters: {},
  journeyStages: [
    { id: "recomendacion", label: "Recomendacion", metric: "nps", description: "Probabilidad de recomendacion del estudio sintetico." },
    { id: "satisfaccion", label: "Satisfaccion general", metric: "sat_general", description: "Evaluacion general de satisfaccion." },
    { id: "confianza", label: "Confianza", metric: "confianza", description: "Indicador sintetico de confianza." },
  ],
  generatedAt: new Date("2026-08-20T18:00:00-06:00"),
});
for (const [index, lowest] of wideLayout.pageLowestY.entries()) {
  assert.ok(
    lowest >= wideLayout.footerRuleY + 25,
    `wide report page ${index + 1} body reaches y=${lowest}, too close to the footer`,
  );
}
assert.equal(wideLayout.groupPages.length, 1);
assert.equal(
  wideLayout.groupPages[0].startPage,
  wideLayout.groupPages[0].endPage,
  "the closing section of the wide report was split across pages",
);
assert.ok(
  wideLayout.pageBlocks.at(-1) >= 6,
  `the wide report's last page holds only ${wideLayout.pageBlocks.at(-1)} block(s) - the closing section was stranded`,
);
assertClosingPageWasUnavoidable(wideLayout, "wide report");
assertNoOrphanHeading(wideLayout, "wide report");
// This shape - four metrics, three journey stages and a two-value cross over
// twenty respondents - is the shape of the accepted acceptance report. It has
// to read as two full A4 pages, not two pages plus a trailing methodology page.
assert.equal(
  wideLayout.pages,
  2,
  `the wide report paginates to ${wideLayout.pages} pages; this shape must fit two`,
);
assert.ok(
  wideLayout.pageLowestY.every((lowest) => lowest <= wideLayout.contentTop - 400),
  `the wide report left a page nearly empty: page lows ${wideLayout.pageLowestY.map((y) => y.toFixed(1)).join(", ")}`,
);

// A journey stage is one visual unit: its title, its description and its
// result card. A heading that reserves only a single body line strands itself
// at the foot of a page while the block it introduces starts on the next one.
// With this four-line stage description, ten summary metrics put the section
// title on that boundary and seven put a stage title on it.
const describedStage =
  "Primer contacto y bienvenida de la familia. Recoge la claridad de la informacion recibida, " +
  "el trato del personal de admisiones, los tiempos de respuesta a cada solicitud, la percepcion " +
  "general sobre el acompanamiento del equipo y la facilidad para completar cada tramite durante " +
  "todo el proceso de inscripcion al colegio, desde la primera visita al plantel hasta la firma " +
  "del contrato y la entrega de los materiales del ciclo.";
const describedLayouts = [];
for (const metricCount of [7, 10]) {
  const keys = Array.from({ length: metricCount }, (_, i) => `indicador_${i + 1}`);
  const describedRows = [];
  for (let i = 1; i <= 20; i += 1) {
    const respondent_id = `d-${i}`;
    const genero = i % 2 ? "F" : "M";
    describedRows.push({ respondent_id, metric_key: "nps", value: i % 4 === 0 ? 6 : 9, genero });
    for (const key of keys) describedRows.push({ respondent_id, metric_key: key, value: 7 + (i % 3), genero });
  }
  const { layout: describedLayout } = await buildStudyReport({
    tenantName: "Colegio de prueba",
    study: { id: `described-${metricCount}`, name: "Estudio con etapas descritas", period: "2026", status: "published" },
    rows: describedRows,
    qualitative: [],
    filters: {},
    sections: { metrics: true, journey: true, segments: false, qualitative: false, filters: true, pivot: true, report: true, trends: true, narrative: true },
    journeyStages: [
      { id: "a", label: "Recomendacion", metric: "nps", description: describedStage },
      { id: "b", label: "Acompanamiento", metric: keys[0], description: describedStage },
      { id: "c", label: "Comunicacion", metric: keys[1], description: describedStage },
    ],
    generatedAt: new Date("2026-08-20T18:00:00-06:00"),
  });
  const label = `described-journey report (${metricCount} metrics)`;
  assertNoOrphanHeading(describedLayout, label);
  assertClosingPageWasUnavoidable(describedLayout, label);
  for (const [index, lowest] of describedLayout.pageLowestY.entries()) {
    assert.ok(
      lowest >= describedLayout.footerRuleY + 25,
      `${label} page ${index + 1} body reaches y=${lowest}, too close to the footer`,
    );
  }
  describedLayouts.push(describedLayout);
}

// Positive control: a report short enough to fit one page must not be split,
// which proves the keep-together logic is not simply forcing a page break.
const { layout: shortLayout } = await buildStudyReport({
  tenantName: "Cliente demostracion",
  study: { id: "short", name: "Informe corto", period: "2026", status: "published" },
  rows: rows.filter((row) => row.respondent_id === "r-1"),
  qualitative: [],
  filters: {},
  journeyStages: [],
  sections: { metrics: false, journey: false, segments: false, qualitative: false, filters: true, pivot: true, report: true, trends: true, narrative: true },
  generatedAt: new Date("2026-08-20T18:00:00-06:00"),
});
assert.equal(shortLayout.pages, 1, "a short report must stay on one page");
assertClosingPageWasUnavoidable(shortLayout, "short report");
assertNoOrphanHeading(shortLayout, "short report");
assert.ok(shortLayout.pageLowestY[0] >= shortLayout.footerRuleY + 25);

const output = process.env.P4D_SAMPLE_PDF;
if (output) {
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, bytes);
}

console.log(
  `server PDF gate: ${parsed.getPageCount()} pages, ${bytes.length} bytes, ` +
    `footer clearance ${layout.footerClearance}pt, blocks/page ${layout.pageBlocks.join("/")}; ` +
    `wide fixture ${wideLayout.pages} pages, blocks/page ${wideLayout.pageBlocks.join("/")}; ` +
    `described-journey fixtures ${describedLayouts.map((l) => l.pages).join("/")} pages`,
);
