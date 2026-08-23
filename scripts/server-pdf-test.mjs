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

// 3. Every section heading lands with body content, never alone at a page foot.
for (const { section, page } of layout.sectionPages) {
  assert.ok(layout.pageBlocks[page - 1] >= 2, `section "${section}" was stranded on page ${page}`);
}

// The shape that produced the reported defect: three journey stages plus a
// four-metric / two-segment cross, whose closing section lands on a page edge.
const wideRows = [];
for (let i = 1; i <= 20; i += 1) {
  const respondent_id = `p-${i}`;
  const genero = i % 2 ? "F" : "M";
  wideRows.push(
    { respondent_id, metric_key: "nps", value: i % 4 === 0 ? 6 : 9, genero },
    { respondent_id, metric_key: "sat_general", value: 8 + (i % 2) * 0.5, genero },
    { respondent_id, metric_key: "sat_maestros", value: 7 + (i % 3), genero },
    { respondent_id, metric_key: "confianza", value: 6 + (i % 3), genero },
  );
}
const { layout: wideLayout } = await buildStudyReport({
  tenantName: "Colegio de prueba",
  study: { id: "wide", name: "Estudio con cruce completo", period: "2026", status: "published" },
  rows: wideRows,
  qualitative: [],
  filters: {},
  journeyStages: [
    { id: "recomendacion", label: "Recomendacion", metric: "nps", description: "Probabilidad de recomendacion." },
    { id: "satisfaccion", label: "Satisfaccion general", metric: "sat_general", description: "Evaluacion general." },
    { id: "confianza", label: "Confianza", metric: "confianza", description: "Indicador de confianza." },
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
assert.ok(shortLayout.pageLowestY[0] >= shortLayout.footerRuleY + 25);

const output = process.env.P4D_SAMPLE_PDF;
if (output) {
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, bytes);
}

console.log(
  `server PDF gate: ${parsed.getPageCount()} pages, ${bytes.length} bytes, ` +
    `footer clearance ${layout.footerClearance}pt, blocks/page ${layout.pageBlocks.join("/")}; ` +
    `wide fixture ${wideLayout.pages} pages, blocks/page ${wideLayout.pageBlocks.join("/")}`,
);
