import { adaptMappedSurvey } from "../src/lib/ingestion/adapters/mapped-survey.ts";
import { sourceSignature } from "../src/lib/ingestion/mapping.ts";
import { previewMappedImport } from "../src/lib/ingestion/preview.ts";
import { parseXlsx } from "../src/lib/ingestion/parse.ts";
import ExcelJS from "exceljs";

let failures = 0;
const ok = (message) => console.log("  ✓", message);
const bad = (message) => { console.error("  ✗ FAIL:", message); failures++; };
const eq = (label, actual, expected) => Object.is(actual, expected)
  ? ok(`${label} = ${String(expected)}`)
  : bad(`${label}: expected ${String(expected)}, got ${String(actual)}`);
const includes = (label, errors, pattern) => errors.some((error) => pattern.test(error.message))
  ? ok(label)
  : bad(`${label}: ${JSON.stringify(errors)}`);

const headers = ["Marca temporal", "Nivel escolar", "Probabilidad de recomendar", "Satisfacción docentes", "Comentario"];
const mapping = {
  version: 1,
  name: "Encuesta escolar",
  columns: [
    { sourceColumn: "Marca temporal", target: { kind: "ignore" } },
    { sourceColumn: "Nivel escolar", target: { kind: "segment", key: "nivel", required: true } },
    { sourceColumn: "Probabilidad de recomendar", target: { kind: "quantitative", metricKey: "nps", min: 1, max: 10, required: true } },
    { sourceColumn: "Satisfacción docentes", target: { kind: "quantitative", metricKey: "sat_docentes", recodingTableId: "satisfaccion_5" } },
    { sourceColumn: "Comentario", target: { kind: "qualitative", theme: "comentario_general", source: "forms" } },
  ],
  recodingTables: [{
    id: "satisfaccion_5",
    version: 1,
    values: { "Muy insatisfecho": 1, "Insatisfecho": 2, "Neutral": 3, "Satisfecho": 4, "Muy satisfecho": 5 },
  }],
};

console.log("Be Community — P2 universal-ingestion core gate");

console.log("\n[1] Stable source signatures");
const signatureA = await sourceSignature(headers);
const signatureB = await sourceSignature([...headers].reverse().map((header) => ` ${header.toUpperCase()} `));
eq("same header set has same signature", signatureA, signatureB);
eq("signature has SHA-256 shape", /^sha256:[0-9a-f]{64}$/.test(signatureA), true);
try {
  await sourceSignature(["Nivel", " nivel "]);
  bad("equivalent duplicate headers must be rejected");
} catch { ok("equivalent duplicate headers rejected"); }
try {
  await sourceSignature([]);
  bad("empty header set must be rejected");
} catch { ok("empty header set rejected"); }

console.log("\n[2] Raw Forms-style headers map without prefixes");
const goodFile = {
  headers,
  rows: [
    { "Marca temporal": "2026-08-20", "Nivel escolar": "Primaria", "Probabilidad de recomendar": "9", "Satisfacción docentes": "Muy satisfecho", Comentario: "Excelente atención" },
    { "Marca temporal": "2026-08-20", "Nivel escolar": "Secundaria", "Probabilidad de recomendar": "6", "Satisfacción docentes": " neutral ", Comentario: "" },
  ],
};
const good = adaptMappedSurvey(goodFile, mapping);
if (!good.ok) {
  bad(`valid file rejected: ${JSON.stringify(good.errors)}`);
} else {
  eq("respondents", good.summary.respondents, 2);
  eq("quantitative rows", good.summary.quant, 4);
  eq("qualitative rows", good.summary.qual, 1);
  eq("segment mapped", good.respondents[0].segments.nivel, "Primaria");
  eq("numeric metric mapped", good.respondents[0].quant[0].value, 9);
  eq("text recoded to number", good.respondents[0].quant[1].value, 5);
  eq("recoding ignores surrounding whitespace/case", good.respondents[1].quant[1].value, 3);
}

console.log("\n[3] Located validation errors and zero accepted bundle");
const corrupt = adaptMappedSurvey({
  headers,
  rows: [
    { "Marca temporal": "", "Nivel escolar": "", "Probabilidad de recomendar": "once", "Satisfacción docentes": "Perfecto", Comentario: "" },
    { "Marca temporal": "", "Nivel escolar": "Primaria", "Probabilidad de recomendar": "11", "Satisfacción docentes": "Satisfecho", Comentario: "" },
  ],
}, mapping);
if (corrupt.ok) {
  bad("corrupt file was accepted");
} else {
  eq("all corrupt cells reported", corrupt.errors.length, 4);
  eq("required segment points to row 2", corrupt.errors.some((error) => error.row === 2 && error.column === "Nivel escolar"), true);
  includes("non-numeric value reported", corrupt.errors, /once/);
  includes("unknown recoding label reported", corrupt.errors, /Perfecto/);
  includes("out-of-range value reported", corrupt.errors, /máximo 10/);
  eq("error result exposes no respondent bundle", "respondents" in corrupt, false);
}

console.log("\n[4] Mapping configuration is validated before rows");
const missingColumn = adaptMappedSurvey(goodFile, {
  ...mapping,
  columns: [{ sourceColumn: "Columna inexistente", target: { kind: "segment", key: "nivel" } }],
});
if (missingColumn.ok) bad("missing mapped column was accepted");
else includes("missing mapped column reported", missingColumn.errors, /no contiene la columna mapeada/);

const badRange = adaptMappedSurvey(goodFile, {
  ...mapping,
  columns: [{ sourceColumn: "Probabilidad de recomendar", target: { kind: "quantitative", metricKey: "nps", min: 10, max: 1 } }],
});
if (badRange.ok) bad("invalid range was accepted");
else includes("invalid min/max rejected", badRange.errors, /mínimo no puede ser mayor/);

const missingRecoding = adaptMappedSurvey(goodFile, {
  ...mapping,
  columns: [{ sourceColumn: "Comentario", target: { kind: "quantitative", metricKey: "sat", recodingTableId: "inexistente" } }],
  recodingTables: [],
});
if (missingRecoding.ok) bad("missing recoding table was accepted");
else includes("missing recoding table rejected before rows", missingRecoding.errors, /No existe la tabla de recodificación/);

const optionalMapping = {
  ...mapping,
  columns: mapping.columns.map((column) => ({ ...column, target: { ...column.target, required: false } })),
};
const emptyOutput = adaptMappedSurvey({ headers, rows: [Object.fromEntries(headers.map((header) => [header, ""]))] }, optionalMapping);
if (emptyOutput.ok) bad("file without usable mapped data was accepted");
else includes("file without usable mapped data rejected", emptyOutput.errors, /no contiene respuestas utilizables/);

console.log("\n[5] Preview is pure and bounded");
const preview = await previewMappedImport(goodFile, mapping, 1);
eq("preview source rows", preview.sourceRows, 2);
eq("preview sample is bounded", preview.sample.length, 1);
eq("preview carries signature", preview.signature, signatureA);
eq("preview contains no persistence metadata", "tenantId" in preview, false);

const previewWithSkippedRow = await previewMappedImport({
  headers,
  rows: [
    Object.fromEntries(headers.map((header) => [header, ""])),
    goodFile.rows[0],
  ],
}, optionalMapping, 1);
eq("preview preserves original file row", previewWithSkippedRow.sample[0].sourceRow, 3);

console.log("\n[6] XLSX header positions cannot shift silently");
const workbook = new ExcelJS.Workbook();
const sheet = workbook.addWorksheet("Respuestas");
sheet.addRow(["Nivel", "", "NPS"]);
sheet.addRow(["Primaria", "dato que no debe moverse", 9]);
const xlsxBytes = await workbook.xlsx.writeBuffer();
const xlsxBuffer = xlsxBytes.buffer.slice(xlsxBytes.byteOffset, xlsxBytes.byteOffset + xlsxBytes.byteLength);
const parsedXlsx = await parseXlsx(xlsxBuffer);
eq("blank middle header preserved", parsedXlsx.headers[1], "");
eq("later header keeps physical column", parsedXlsx.rows[0].NPS, "9");
const blankHeaderResult = adaptMappedSurvey(parsedXlsx, {
  version: 1,
  name: "XLSX inválido",
  columns: [{ sourceColumn: "NPS", target: { kind: "quantitative", metricKey: "nps" } }],
  recodingTables: [],
});
if (blankHeaderResult.ok) bad("blank XLSX header was accepted");
else includes("blank XLSX header rejected explicitly", blankHeaderResult.errors, /encabezados no vacíos/);

console.log("\n" + "=".repeat(60));
if (failures > 0) {
  console.error(`RESULT: ${failures} failure(s) — universal-ingestion gate blocked.`);
  process.exit(1);
}
console.log("RESULT: universal mapping, recoding, preview, and validation contracts passed.");
