import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { PDFDocument } from "pdf-lib";
import { buildStudyPdf } from "../src/lib/reporting/pdf.ts";
import { parseReportFilters } from "../src/lib/reporting/filters.ts";

const routeSource = await readFile(new URL("../src/app/api/studies/[studyId]/report/route.ts", import.meta.url), "utf8");
assert.match(routeSource, /createClient\(\)/, "report route must use the request-scoped Supabase client");
assert.match(routeSource, /auth\.getUser\(\)/, "report route must verify the user with Supabase Auth");
assert.doesNotMatch(routeSource, /createAdminClient|service_role/i, "report route must never bypass RLS");
assert.match(routeSource, /private, no-store/, "report response must not be cached");
assert.match(routeSource, /confirmedQualitative|loadConfirmedQualitative/, "report must use the confirmed qualitative surface");

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

const bytes = await buildStudyPdf({
  tenantName: "Cliente demostracion",
  study: { id: "study-demo", name: "Experiencia de comunidad", period: "2026", status: "published" },
  rows,
  qualitative,
  filters: {},
  journeyStages: [
    { id: "inicio", label: "Inicio", metric: "sat_acompanamiento", description: "Primer contacto y bienvenida." },
    { id: "seguimiento", label: "Seguimiento", metric: "sat_comunicacion", description: "Comunicacion durante el proceso." },
  ],
  generatedAt: new Date("2026-08-20T18:00:00-06:00"),
});

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

const output = process.env.P4D_SAMPLE_PDF;
if (output) {
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, bytes);
}

console.log(`server PDF gate: ${parsed.getPageCount()} pages, ${bytes.length} bytes`);
