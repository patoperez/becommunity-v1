// =============================================================================
// MANDATORY canonical package preflight gate
//   npx tsx scripts/canonical-package-preflight-test.mjs
// =============================================================================
// Unit 2 parses and validates a multi-file canonical study package. It writes
// NOTHING: no Supabase call, no canonical row, no legacy row. This gate proves
// three separable things.
//
//   THE READER. `readXlsxWorkbook` must see every worksheet, keep the exact
//   worksheet name (one real source sheet ends in a space), keep physical
//   coordinates so a blank cell does not shift its neighbours, keep a formula
//   apart from the value it cached, and keep fills and merges as UNINTERPRETED
//   evidence. `readXlsx` and `parseXlsx` — through which every existing study
//   was imported — must behave exactly as before.
//
//   THE CONTRACT. Two files, two semantic roles, resolved by STRUCTURE. A
//   renamed file must still resolve; two files that both look like one role,
//   a missing role, an ambiguous signature, a missing worksheet, a shifted
//   header, a duplicated identity and a wrong count must each block, because a
//   package the product cannot describe unambiguously must not be imported.
//
//   THE PRIVACY BOUNDARY. The report is shown on screen, written to logs and
//   stored on `import_job.error_report`. Every fixture below therefore plants
//   sentinel strings where a name, an answer or an identifier would be, and
//   the gate fails if ONE of them appears anywhere in the serialised report.
//
// Every fixture is BUILT HERE, from synthetic values. No client workbook, name,
// answer or identifier is committed to this repository.
// =============================================================================

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import { MAX_UPLOAD_BYTES } from "../src/lib/validation/schemas.ts";
import { XLSX_LIMITS, XlsxLimitError, readXlsx, readXlsxWorkbook } from "../src/lib/ingestion/xlsx-reader.ts";
import { parseXlsx } from "../src/lib/ingestion/parse.ts";
import {
  CUICUILCO_PACKAGE_SPEC_V1,
  classifySourceValue,
  columnLetters,
  columnNumber,
  packageIdempotencyKey,
  preflightCanonicalPackage,
} from "../src/lib/ingestion/canonical-package/index.ts";

let failures = 0;
const ok = (m) => console.log("  ✓", m);
const bad = (m) => {
  console.error("  ✗ FAIL:", m);
  failures += 1;
};
const check = (condition, message) => (condition ? ok(message) : bad(message));

const { default: JSZip } = await import("jszip");
const NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
const REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";

// ---------------------------------------------------------------------------
// Fixture builder — synthetic workbooks, authored here
// ---------------------------------------------------------------------------

const escapeXml = (value) =>
  String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

/** Cell constructors. `blank` writes an explicit empty cell, gaps and all. */
const text = (value, style) => ({ kind: "text", value, style });
const num = (value, style) => ({ kind: "num", value, style });
const formula = (source, cached, style) => ({ kind: "formula", source, cached, style });
const blank = (style) => ({ kind: "blank", style });

/**
 * Styles carry two solid RGB fills and one THEME fill, so the gate can prove
 * the reader keeps an explicit colour AND records a themed cell that has no
 * colour of its own instead of reading it as unfilled.
 */
const STYLES =
  '<numFmts><numFmt numFmtId="164" formatCode="dd/mm/yyyy"/></numFmts>' +
  "<fills>" +
  '<fill><patternFill patternType="none"/></fill>' +
  '<fill><patternFill patternType="gray125"/></fill>' +
  '<fill><patternFill patternType="solid"><fgColor rgb="FFFF0000"/></patternFill></fill>' +
  '<fill><patternFill patternType="solid"><fgColor rgb="FFFFFF00"/></patternFill></fill>' +
  '<fill><patternFill patternType="solid"><fgColor theme="4" tint="0.4"/></patternFill></fill>' +
  "</fills>" +
  "<cellXfs>" +
  '<xf numFmtId="0" fillId="0"/>' +
  '<xf numFmtId="14" fillId="0"/>' +
  '<xf numFmtId="0" fillId="2"/>' +
  '<xf numFmtId="0" fillId="3"/>' +
  '<xf numFmtId="0" fillId="4"/>' +
  "</cellXfs>";

const STYLE = { plain: 0, date: 1, red: 2, yellow: 3, theme: 4 };

function cellXml(ref, cell, p) {
  const attrs = [`r="${ref}"`];
  if (cell.style !== undefined) attrs.push(`s="${cell.style}"`);
  if (cell.kind === "blank") return `<${p}c ${attrs.join(" ")}/>`;
  if (cell.kind === "text") {
    attrs.push('t="inlineStr"');
    return `<${p}c ${attrs.join(" ")}><${p}is><${p}t>${escapeXml(cell.value)}</${p}t></${p}is></${p}c>`;
  }
  if (cell.kind === "formula") {
    const cached = cell.cached === undefined ? "" : `<${p}v>${escapeXml(cell.cached)}</${p}v>`;
    return `<${p}c ${attrs.join(" ")}><${p}f>${escapeXml(cell.source)}</${p}f>${cached}</${p}c>`;
  }
  return `<${p}c ${attrs.join(" ")}><${p}v>${escapeXml(cell.value)}</${p}v></${p}c>`;
}

/**
 * `sheets` is a list of `{ name, state?, rows, merges? }` where `rows` maps a
 * physical row number to a map of column letter -> cell. Nothing is inferred:
 * a row that is not listed does not exist, which is how a gap stays a gap.
 *
 * The namespace options are deliberately INDEPENDENT. `prefix` prefixes the
 * workbook and worksheet parts; `relsPrefix` prefixes the relationships part.
 * They are separate documents with separate declarations, so a fixture that
 * prefixes one and not the other is not an exotic case — it is the ordinary
 * one, and a test that moves them together cannot tell whether the reader ever
 * looked at the relationships part's own naming.
 *
 * `relsTargetFor` decides which worksheet PART each sheet's relationship points
 * at (null omits the relationship entirely, leaving a dangling id), and
 * `relationshipIdFor` decides what that id is called. Together they let a test
 * prove the reader follows the relationship rather than the sheet's position.
 */
async function buildWorkbook({
  sheets,
  prefix = "x",
  relsPrefix = "",
  date1904 = false,
  styles = STYLES,
  omitRels = false,
  omitSheetRelationshipId = false,
  relsTargetFirst = false,
  relsTargetFor = (index) => index + 1,
  relationshipIdFor = (index) => `rId${index + 1}`,
}) {
  const zip = new JSZip();
  const p = prefix ? `${prefix}:` : "";
  const rp = relsPrefix ? `${relsPrefix}:` : "";
  const xmlns = prefix ? ` xmlns:${prefix}="${NS}"` : ` xmlns="${NS}"`;
  const relsXmlns = relsPrefix ? ` xmlns:${relsPrefix}="${REL}/package"` : ` xmlns="${REL}/package"`;

  const sheetTags = sheets
    .map(
      (sheet, index) =>
        `<${p}sheet name="${escapeXml(sheet.name)}" sheetId="${index + 1}" ` +
        `state="${sheet.state ?? "visible"}"` +
        (omitSheetRelationshipId ? "" : ` r:id="${relationshipIdFor(index)}" xmlns:r="${REL}"`) +
        `/>`,
    )
    .join("");
  zip.file(
    "xl/workbook.xml",
    `<?xml version="1.0" encoding="utf-8"?><${p}workbook${xmlns}${date1904 ? ' date1904="1"' : ""}>` +
      `<${p}sheets>${sheetTags}</${p}sheets></${p}workbook>`,
  );

  if (!omitRels) {
    const rels = sheets
      .map((_, index) => {
        const part = relsTargetFor(index);
        if (part === null) return "";
        const id = `Id="${relationshipIdFor(index)}"`;
        const target = `Target="worksheets/sheet${part}.xml"`;
        const type = `Type="${REL}/worksheet"`;
        const attrs = relsTargetFirst ? `${type} ${target} ${id}` : `${id} ${type} ${target}`;
        return `<${rp}Relationship ${attrs}/>`;
      })
      .join("");
    zip.file(
      "xl/_rels/workbook.xml.rels",
      `<?xml version="1.0" encoding="utf-8"?>` +
        `<${rp}Relationships${relsXmlns}>${rels}</${rp}Relationships>`,
    );
  }

  sheets.forEach((sheet, index) => {
    const rowNumbers = Object.keys(sheet.rows ?? {})
      .map(Number)
      .sort((a, b) => a - b);
    const body = rowNumbers
      .map((rowNumber) => {
        const cells = sheet.rows[rowNumber];
        const columns = Object.keys(cells).sort((a, b) => columnNumber(a) - columnNumber(b));
        const rendered = columns.map((column) => cellXml(`${column}${rowNumber}`, cells[column], p)).join("");
        return `<${p}row r="${rowNumber}">${rendered}</${p}row>`;
      })
      .join("");
    const merges = (sheet.merges ?? []).map((ref) => `<${p}mergeCell ref="${ref}"/>`).join("");
    const mergeBlock = merges ? `<${p}mergeCells count="${sheet.merges.length}">${merges}</${p}mergeCells>` : "";
    zip.file(
      `xl/worksheets/sheet${index + 1}.xml`,
      `<?xml version="1.0" encoding="utf-8"?><${p}worksheet${xmlns}>` +
        `<${p}sheetData>${body}</${p}sheetData>${mergeBlock}</${p}worksheet>`,
    );
  });

  if (styles) {
    zip.file(
      "xl/styles.xml",
      `<?xml version="1.0" encoding="utf-8"?><${p}styleSheet${xmlns}>${styles}</${p}styleSheet>`,
    );
  }
  const buffer = await zip.generateAsync({ type: "nodebuffer" });
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
}

// ---------------------------------------------------------------------------
// Synthetic Cuicuilco-shaped package
// ---------------------------------------------------------------------------

/**
 * SENTINELS. Everything a real workbook would hold privately is written here as
 * a token that exists nowhere else. If one of these reaches the report, the
 * privacy section fails and names the token.
 */
const SENTINEL = {
  name: (n) => `ZNOMBREPRIV${String(n).padStart(3, "0")}`,
  id: (n) => `ZIDPRIV${String(n).padStart(3, "0")}`,
  quote: (n) => `ZTEXTOPRIV${String(n).padStart(3, "0")}`,
  category: (n) => `ZCATEGPRIV${String(n).padStart(3, "0")}`,
};

const ACTIVE = 28;
const DESERTERS = 32;
const TOTAL = ACTIVE + DESERTERS;

const range = (count, from = 1) => Array.from({ length: count }, (_, index) => index + from);

/** A header row of synthetic labels across a column band. */
function headerRow(columns, label) {
  const row = {};
  columns.forEach((column, index) => {
    row[column] = text(`${label} ${index + 1}`);
  });
  return row;
}

function columnsBetween(from, to) {
  const out = [];
  for (let column = columnNumber(from); column <= columnNumber(to); column++) out.push(columnLetters(column));
  return out;
}

const CSAT_VALUE_COLUMNS = columnsBetween("D", "DI").filter((_, index) => index % 2 === 0);
const CSAT_LABEL_COLUMNS = columnsBetween("D", "DI").filter((_, index) => index % 2 === 1);

function perfilClienteSheet(overrides = {}) {
  const columns = columnsBetween("A", "X");
  const rows = { 2: headerRow(columns, "Encabezado activo") };
  const months = columnsBetween("P", "X");
  for (let index = 0; index < ACTIVE; index++) {
    const row = 3 + index;
    const person = index + 1;
    const cells = {
      A: num(45000 + index, STYLE.date),
      B: text(SENTINEL.name(person)),
      C: text(SENTINEL.id(person)),
      D: text(SENTINEL.category(1)),
      E: text(SENTINEL.category(2)),
      F: text(SENTINEL.category(3)),
      // Two spellings that normalise identically: an alias candidate a human
      // must decide on, never a merge this unit performs.
      G: text(index % 2 === 0 ? "Servicios profesionales" : "servicios  profesionales "),
      H: text(SENTINEL.category(4)),
      I: text(SENTINEL.category(5)),
      J: text(SENTINEL.category(6)),
      K: num(44000 + index, STYLE.date),
      L: num(46000 + index, STYLE.date),
      M: num(2),
      N: num(1000 + index),
    };
    // Two participants carry NO numeric month at all. They must stay
    // `source_unavailable`; a zero here would be a fabricated performance.
    const noMonths = index >= ACTIVE - 2;
    if (noMonths) {
      cells.O = text("Sin dato");
      months.forEach((column, monthIndex) => {
        cells[column] = monthIndex % 2 === 0 ? text("NA") : blank(STYLE.plain);
      });
    } else {
      cells.O = num(50 + (index % 40));
      months.forEach((column, monthIndex) => {
        const value = 30 + ((index + monthIndex) % 65);
        cells[column] = num(value, value < 50 ? STYLE.red : STYLE.yellow);
      });
    }
    rows[row] = cells;
  }
  if (overrides.mutate) overrides.mutate(rows);
  return { name: "Perfil Cliente", rows };
}

function perfilDesertoresSheet(overrides = {}) {
  const columns = columnsBetween("A", "N");
  const rows = { 2: headerRow(columns, "Encabezado desertor") };
  for (let index = 0; index < DESERTERS; index++) {
    const row = 3 + index;
    const person = ACTIVE + index + 1;
    // Eleven of the thirty-two took the exit survey. "No" in this column means
    // "did not take part" and must never become an answer.
    const responded = index < 11;
    rows[row] = {
      A: responded ? num(45100 + index, STYLE.date) : blank(STYLE.plain),
      B: text(SENTINEL.name(person)),
      C: text(SENTINEL.id(person)),
      D: text(responded ? "Sí" : "No"),
      E: text(responded ? SENTINEL.category(7) : "Sin dato"),
      F: text(responded ? SENTINEL.category(8) : "Sin dato"),
      G: text(responded ? SENTINEL.category(9) : "Sin dato"),
      H: text(index % 3 === 0 ? "Comercio local" : "comercio   local"),
      I: text(SENTINEL.category(10)),
      J: text(responded ? SENTINEL.category(11) : "Sin información"),
      K: num(43000 + index, STYLE.date),
      L: num(45500 + index, STYLE.date),
      M: num(3),
      N: text("Sin dato"),
    };
  }
  if (overrides.mutate) overrides.mutate(rows);
  return { name: "Perfil Desertores", rows };
}

function idClienteSheet(overrides = {}) {
  const rows = { 1: { A: text("Nombre"), B: text("Identificador") } };
  for (let person = 1; person <= TOTAL; person++) {
    rows[person + 1] = { A: text(SENTINEL.name(person)), B: text(SENTINEL.id(person)) };
  }
  if (overrides.mutate) overrides.mutate(rows);
  return { name: "IDCliente", rows };
}

function simpleListSheet(name, count, labelA, labelB) {
  const rows = { 1: { A: text(labelA), B: text(labelB) } };
  for (let index = 0; index < count; index++) {
    rows[index + 2] = { A: text(`${labelA} ${index + 1}`), B: text(`${labelB} ${index + 1}`) };
  }
  return { name, rows };
}

function retencionSheet(overrides = {}) {
  const rows = { 1: headerRow(columnsBetween("A", "G"), "Encabezado retención") };
  for (let index = 0; index < 6; index++) {
    const starting = 40 + index * 2;
    const added = 3 + index;
    const lost = 2 + index;
    const ending = starting - lost + added;
    rows[index + 2] = {
      A: text(`Periodo ${index + 1}`),
      B: num(starting),
      C: num(added),
      D: num(ending),
      E: num(lost),
      F: formula(`(D${index + 2}-C${index + 2})/B${index + 2}`, String((ending - added) / starting)),
      G: formula(`E${index + 2}/B${index + 2}`, String(lost / starting)),
    };
  }
  if (overrides.mutate) overrides.mutate(rows);
  return { name: "RetenciónDeserción", rows };
}

function csatSheet(overrides = {}) {
  const domains = CUICUILCO_PACKAGE_SPEC_V1.pairedInstruments[0].domains;
  const rows = {
    1: Object.fromEntries(
      domains.map((domain) => [domain.firstValueColumn, text(`Dominio ${domain.key}`, STYLE.theme)]),
    ),
    2: {
      A: text("Marca temporal"),
      B: text("Nombre"),
      C: text("Identificador"),
      ...Object.fromEntries(CSAT_VALUE_COLUMNS.map((column, index) => [column, text(`Ítem ${index + 1}`)])),
      ...Object.fromEntries(CSAT_LABEL_COLUMNS.map((column, index) => [column, text(`Etiqueta ${index + 1}`)])),
    },
  };
  for (let index = 0; index < ACTIVE; index++) {
    const row = 3 + index;
    const cells = { A: num(45200 + index, STYLE.date), B: text(SENTINEL.name(index + 1)), C: text(SENTINEL.id(index + 1)) };
    CSAT_VALUE_COLUMNS.forEach((column, item) => {
      // One item per respondent is an unknown the source spells out. It is not
      // in the absence table, so it stays text for a human rather than being
      // guessed into a state or a number.
      cells[column] = item === index % CSAT_VALUE_COLUMNS.length ? text("No lo conozco") : num(1 + ((index + item) % 5));
    });
    CSAT_LABEL_COLUMNS.forEach((column, item) => {
      cells[column] = text(`Etiqueta derivada ${1 + ((index + item) % 5)}`);
    });
    rows[row] = cells;
  }
  if (overrides.mutate) overrides.mutate(rows);
  return {
    name: "CSAT",
    rows,
    merges: domains.map((domain) => `${domain.firstValueColumn}1:${domain.lastLabelColumn}1`),
  };
}

function instrumentSheet(name, count, columns, idColumn, firstPerson) {
  const rows = { 1: headerRow(columns, `Encabezado ${name}`) };
  for (let index = 0; index < count; index++) {
    const cells = {};
    columns.forEach((column) => {
      cells[column] = text(SENTINEL.quote(index + 1));
    });
    cells.A = num(45300 + index, STYLE.date);
    cells.B = text(SENTINEL.name(firstPerson + index));
    cells[idColumn] = text(SENTINEL.id(firstPerson + index));
    cells.D = num(1 + (index % 10));
    rows[index + 2] = cells;
  }
  return { name, rows };
}

function cleanSheets(overrides = {}) {
  return [
    perfilClienteSheet(overrides.perfilCliente ?? {}),
    perfilDesertoresSheet(overrides.perfilDesertores ?? {}),
    idClienteSheet(overrides.idCliente ?? {}),
    simpleListSheet("Generaciones", 5, "Rango", "Generación"),
    retencionSheet(overrides.retencion ?? {}),
    csatSheet(overrides.csat ?? {}),
    simpleListSheet("SatisfacciónCSAT", 6, "Escala", "Ponderación"),
    instrumentSheet("NPS", 28, columnsBetween("A", "E"), "C", 1),
    instrumentSheet("NPS desertores", 11, columnsBetween("A", "G"), "C", ACTIVE + 1),
    simpleListSheet("Recomendación NPS", 10, "Escala", "Ponderación"),
    instrumentSheet("CRI", 28, columnsBetween("A", "F"), "C", 1),
  ];
}

function painEntitySheet(name, entityRow, from, to, contentRow, filledFraction) {
  const columns = columnsBetween(from, to);
  const rows = {
    1: { A: text(`Título ${name}`) },
    [entityRow]: { A: text("Elemento") },
    [contentRow]: { A: text("Hallazgo") },
  };
  columns.forEach((column, index) => {
    rows[entityRow][column] = text(`Elemento ${index + 1}`, index % 2 === 0 ? STYLE.red : STYLE.yellow);
    // Deliberately not every element carries curated text. An element with no
    // finding must produce no finding, not an empty one.
    rows[contentRow][column] =
      index % filledFraction === 0 ? blank(STYLE.plain) : text(SENTINEL.quote(100 + index), STYLE.yellow);
  });
  return { name, rows };
}

function painSheets(overrides = {}) {
  const sheets = [
    painEntitySheet("Journey", 6, "B", "S", 7, 4),
    // The source really does end this name in a space.
    painEntitySheet("Equipos ", 3, "B", "K", 4, 5),
    painEntitySheet("Desempeño", 7, "B", "H", 8, 8),
    painEntitySheet("Cultura EDL", 6, "B", "K", 7, 6),
    painEntitySheet("Cultura Miembros", 8, "B", "K", 9, 7),
  ];
  if (overrides.mutate) overrides.mutate(sheets);
  return sheets;
}

const cleanWorkbook = (overrides) => buildWorkbook({ sheets: cleanSheets(overrides ?? {}) });
const painWorkbook = (overrides) => buildWorkbook({ sheets: painSheets(overrides ?? {}) });

const file = (fileName, bytes) => ({ fileName, bytes });

const codes = (result) => result.findings.map((finding) => finding.code);
const has = (result, code) => codes(result).includes(code);
const findingFor = (result, code) => result.findings.find((finding) => finding.code === code) ?? null;
const expectationFor = (result, code) => result.expectations.find((entry) => entry.code === code) ?? null;

async function refusal(run) {
  try {
    await run();
    return null;
  } catch (error) {
    return error;
  }
}

console.log("Be Community — canonical package preflight gate");

const cleanBytes = await cleanWorkbook();
const painBytes = await painWorkbook();

// ---- [1] The multi-sheet reader -------------------------------------------
console.log("\n[1] The reader sees every sheet, exactly as the file spells it");
{
  const workbook = await readXlsxWorkbook(cleanBytes);
  check(workbook.sheets.length === 11, `the clean workbook yields 11 sheets (got ${workbook.sheets.length})`);
  check(
    workbook.sheets[0].name === "Perfil Cliente" && workbook.sheets[0].index === 1,
    "the first sheet keeps its name and its position",
  );
  check(
    workbook.sheets.map((sheet) => sheet.name).includes("RetenciónDeserción"),
    "an accented worksheet name survives the round trip",
  );

  const pain = await readXlsxWorkbook(painBytes);
  const equipos = pain.sheets.find((sheet) => sheet.name === "Equipos ");
  check(Boolean(equipos), "a worksheet name that ends in a space keeps the space (lineage depends on it)");
  check(pain.sheets.length === 5, `the curated workbook yields 5 sheets (got ${pain.sheets.length})`);

  const csat = workbook.sheets.find((sheet) => sheet.name === "CSAT");
  check(csat.mergedRanges.length === 4, `CSAT keeps its 4 merged domain bands (got ${csat.mergedRanges.length})`);
  check(csat.mergedRanges.includes("D1:BI1"), "the first merged band keeps its exact range");
  const domainCell = csat.cells.find((cell) => cell.address === "D1");
  check(domainCell?.fillTheme === 4 && domainCell.fillRgb === null,
    "a THEME fill is recorded as evidence even though it carries no colour of its own");

  const journey = pain.sheets.find((sheet) => sheet.name === "Journey");
  const b6 = journey.cells.find((cell) => cell.address === "B6");
  check(b6?.fillRgb === "FFFF0000", `an explicit ARGB fill is retained uppercase (got ${b6?.fillRgb})`);
  check(typeof b6?.styleIndex === "number", "the source style index is retained");
}

console.log("\n[2] Coordinates are physical: a gap is a gap");
{
  const bytes = await buildWorkbook({
    sheets: [
      {
        name: "Hoja",
        rows: {
          1: { A: text("a"), B: text("b"), C: text("c") },
          // B2 is written as an explicitly empty cell; D3 is simply absent.
          2: { A: text("1"), B: blank(STYLE.plain), C: text("3") },
          3: { A: text("x"), E: text("y") },
        },
      },
    ],
  });
  const [sheet] = (await readXlsxWorkbook(bytes)).sheets;
  const at = (address) => sheet.cells.find((cell) => cell.address === address) ?? null;
  check(at("A2")?.text === "1" && at("C2")?.text === "3", "values keep their own columns across an empty cell");
  check(at("B2")?.text === "" && at("B2")?.column === 2, "the empty cell exists at its own coordinate, empty");
  check(at("E3")?.column === 5 && at("E3")?.text === "y", "an omitted cell does not pull the next value left");
  check(sheet.maxRow === 3 && sheet.maxColumn === 5, `extents are physical (${sheet.maxRow}x${sheet.maxColumn})`);
}

console.log("\n[3] A formula and the value it cached are separate facts");
{
  const bytes = await buildWorkbook({
    sheets: [
      {
        name: "Hoja",
        rows: {
          1: { A: text("total"), B: text("pendiente"), C: text("cero") },
          2: {
            A: formula("SUM(D1:D9)", "42"),
            B: formula("SUM(E1:E9)"),
            C: num(0),
          },
        },
      },
    ],
  });
  const [sheet] = (await readXlsxWorkbook(bytes)).sheets;
  const at = (address) => sheet.cells.find((cell) => cell.address === address) ?? null;
  check(at("A2")?.formula === "SUM(D1:D9)", "the formula source is preserved");
  check(at("A2")?.cachedValue === "42" && at("A2")?.text === "42", "its cached value is preserved separately");
  check(at("B2")?.formula === "SUM(E1:E9)", "a formula with no cached value keeps its source");
  check(
    at("B2")?.cachedValue === null && at("B2")?.text === "",
    "and its cached value is null — not 0, and not an empty string masquerading as a result",
  );
  check(at("C2")?.cachedValue === "0" && at("C2")?.text === "0", "a real zero is still a real zero");
}

// ---- [4] XML namespace prefixes, part by part ------------------------------
console.log("\n[4] Namespace prefixes are honoured on every part, independently");
{
  // A relationships document is its OWN part with its OWN declarations. A
  // fixture that prefixes the workbook while leaving the relationships plain
  // proves nothing about the relationships parser: that case passes whether or
  // not the parser understands prefixes at all, which is exactly how a reader
  // can claim optional-prefix support while matching only `<Relationship>`.
  // Each part is therefore varied INDEPENDENTLY here, including the case where
  // the two parts choose different prefixes — valid, and unreachable by any
  // fixture that moves them together.
  const trio = [
    { name: "Uno", rows: { 1: { A: text("h1") }, 2: { A: text("v1") } } },
    { name: "Dos", rows: { 1: { A: text("h2") }, 2: { A: text("v2") } } },
    { name: "Tres", rows: { 1: { A: text("h3") }, 2: { A: text("v3") } } },
  ];
  const valueOf = (sheet) => sheet.cells.find((cell) => cell.address === "A2")?.text ?? null;

  for (const [label, prefix, relsPrefix] of [
    ["workbook x:, relationships plain (what real exporters write)", "x", ""],
    ["workbook plain, relationships plain", "", ""],
    ["workbook plain, relationships rel:", "", "rel"],
    ["workbook x:, relationships rel: — different prefixes", "x", "rel"],
    ["workbook ss:, relationships ss: — the same prefix on both parts", "ss", "ss"],
    ["prefixes using _ . and -, which XML allows and the old pattern refused", "a_b.c-d", "r_1.2-3"],
  ]) {
    const workbook = await readXlsxWorkbook(await buildWorkbook({ sheets: trio, prefix, relsPrefix }));
    check(
      workbook.sheets.map((sheet) => sheet.name).join(",") === "Uno,Dos,Tres",
      `${label}: all three sheets resolve, in workbook order`,
    );
    check(
      workbook.sheets.map(valueOf).join(",") === "v1,v2,v3",
      `${label}: each sheet carries its OWN worksheet part`,
    );
  }

  const reordered = await buildWorkbook({
    sheets: trio,
    prefix: "x",
    relsPrefix: "rel",
    relsTargetFirst: true,
  });
  check(
    (await readXlsxWorkbook(reordered)).sheets.map(valueOf).join(",") === "v1,v2,v3",
    "a prefixed relationship with Target before Id still resolves — attributes have no order",
  );

  // Resolution must follow the RELATIONSHIP, not the sheet's position. With the
  // targets reversed, the first sheet must load the third part. A reader that
  // quietly fell back to position would pass every check above and still read
  // the wrong data here, with no error at all.
  const reversed = await buildWorkbook({
    sheets: trio,
    prefix: "x",
    relsPrefix: "rel",
    relsTargetFor: (index) => trio.length - index,
  });
  const followed = await readXlsxWorkbook(reversed);
  check(
    followed.sheets.map((sheet) => sheet.name).join(",") === "Uno,Dos,Tres" &&
      followed.sheets.map(valueOf).join(",") === "v3,v2,v1",
    "a prefixed relationship is followed to its own target, not to the sheet's position",
  );

  // `sheetId` is an unrelated internal number sitting on the same element as
  // `r:id`. Reading it as the relationship would not fail loudly — it would
  // resolve to a real but WRONG part. This trap names the relationships "1" and
  // "2", matching the sheetIds, points them at the opposite parts, and removes
  // `r:id` entirely, so a reader that confused the two would swap the sheets.
  const trap = await buildWorkbook({
    sheets: [trio[0], trio[1]],
    prefix: "x",
    relsPrefix: "rel",
    omitSheetRelationshipId: true,
    relationshipIdFor: (index) => String(index + 1),
    relsTargetFor: (index) => 2 - index,
  });
  check(
    (await readXlsxWorkbook(trap)).sheets.map(valueOf).join(",") === "v1,v2",
    "sheetId is never read as the relationship id: each sheet falls back to its own ordinal part",
  );

  // A relationship that is absent falls back to the ordinal part, because
  // dropping the sheet would report "falta la hoja X" for a file that has X.
  const dangling = await buildWorkbook({
    sheets: [trio[0], trio[1]],
    prefix: "x",
    relsPrefix: "rel",
    relsTargetFor: (index) => (index === 1 ? null : index + 1),
  });
  const recovered = await readXlsxWorkbook(dangling);
  check(
    recovered.sheets.length === 2 && recovered.sheets.map(valueOf).join(",") === "v1,v2",
    "a sheet whose relationship is missing falls back to its ordinal part instead of vanishing",
  );

  // A relationship that RESOLVES to a part that is not in the archive is a
  // different thing, and must refuse rather than quietly read a neighbour.
  const unresolvable = await refusal(async () =>
    readXlsxWorkbook(
      await buildWorkbook({ sheets: [trio[0]], prefix: "x", relsPrefix: "rel", relsTargetFor: () => 9 }),
    ),
  );
  check(
    unresolvable instanceof Error && /'Uno'/.test(unresolvable.message),
    "a relationship pointing at a part that is not there refuses BY NAME rather than silently",
  );

  // The LEGACY reader shares this relationships parser, so it is exercised
  // through a prefixed part too — and must produce exactly what it produces
  // through the plain part real exporters write.
  const legacyPlain = await readXlsx(
    await buildWorkbook({ sheets: [trio[0], trio[1]], prefix: "x", relsPrefix: "" }),
  );
  const legacyPrefixed = await readXlsx(
    await buildWorkbook({ sheets: [trio[0], trio[1]], prefix: "x", relsPrefix: "rel" }),
  );
  check(
    JSON.stringify(legacyPlain) === JSON.stringify({ headers: ["h1"], rows: [{ h1: "v1" }] }),
    `readXlsx reads the first sheet through a plain relationships part (got ${JSON.stringify(legacyPlain)})`,
  );
  check(
    JSON.stringify(legacyPrefixed) === JSON.stringify(legacyPlain),
    "and produces byte-identical output through a prefixed one",
  );
}

// ---- [5] Legacy behaviour is unchanged -------------------------------------
console.log("\n[5] readXlsx and parseXlsx behave exactly as before");
{
  const legacy = await buildWorkbook({
    sheets: [
      {
        name: "Datos",
        rows: {
          1: { A: text("seg_nivel"), B: text("q_uno"), C: text("q_dos"), D: text("priv_fecha") },
          2: { A: text("primaria"), B: blank(STYLE.plain), C: num(7), D: num(45992, STYLE.date) },
        },
      },
      { name: "Otra", rows: { 1: { A: text("no_leer") }, 2: { A: text("tampoco") } } },
    ],
  });
  const parsed = await readXlsx(legacy);
  check(
    JSON.stringify(parsed.headers) === JSON.stringify(["seg_nivel", "q_uno", "q_dos", "priv_fecha"]),
    `readXlsx still reads the FIRST sheet's header row (got ${parsed.headers.join(",")})`,
  );
  check(parsed.rows.length === 1, `and only the first sheet's rows (got ${parsed.rows.length})`);
  check(parsed.rows[0].q_uno === "" && parsed.rows[0].q_dos === "7", "blank-cell alignment is unchanged");
  check(parsed.rows[0].priv_fecha === "2025-12-01", "date rendering is unchanged and timezone-independent");
  check(!Object.keys(parsed.rows[0]).includes("no_leer"), "the second sheet is not merged into the legacy result");

  const viaParse = await parseXlsx(legacy);
  check(
    JSON.stringify(viaParse) === JSON.stringify(parsed),
    "parseXlsx returns exactly what readXlsx returns, headers trimmed",
  );

  // REGRESSION GUARD. Both real source workbooks style whole empty grids, so a
  // header row physically continues past its last named column as
  // `<c r="Z1" s="5"/>`. If the legacy reader kept those, its header array
  // would grow trailing empty names — and `sourceSignature()` refuses a header
  // set with an empty or duplicated name, so an import that works today would
  // start failing. The canonical reader wants exactly those cells; the legacy
  // reader must not see them.
  const styledGrid = await buildWorkbook({
    sheets: [
      {
        name: "Datos",
        rows: {
          1: { A: text("q_a"), B: text("q_b"), C: blank(STYLE.yellow), D: blank(STYLE.yellow) },
          2: { A: text("1"), B: text("2"), C: blank(STYLE.yellow), D: blank(STYLE.yellow) },
        },
      },
    ],
  });
  const legacyGrid = await readXlsx(styledGrid);
  check(
    JSON.stringify(legacyGrid.headers) === JSON.stringify(["q_a", "q_b"]),
    `styled-but-empty header cells do NOT widen the legacy header row (got ${JSON.stringify(legacyGrid.headers)})`,
  );
  check(
    legacyGrid.headers.every((header) => header !== ""),
    "so no empty header name reaches sourceSignature(), which refuses one",
  );
  const canonicalGrid = (await readXlsxWorkbook(styledGrid)).sheets[0];
  check(
    canonicalGrid.cells.some((cell) => cell.address === "C1" && cell.text === "" && cell.fillRgb === "FFFFFF00"),
    "while the canonical reader DOES keep them, as style evidence at their own coordinate",
  );

  const prefixless = await buildWorkbook({
    prefix: "",
    sheets: [{ name: "Datos", rows: { 1: { A: text("q_a") }, 2: { A: text("5") } } }],
  });
  const plain = await readXlsx(prefixless);
  check(plain.headers[0] === "q_a" && plain.rows[0].q_a === "5", "an unprefixed workbook still reads");
  const workbookPrefixless = await readXlsxWorkbook(prefixless);
  check(workbookPrefixless.sheets.length === 1, "the multi-sheet reader also accepts an unprefixed workbook");
}

// ---- [6] The package contract ----------------------------------------------
console.log("\n[6] A valid two-workbook package is recognised by structure");
const baseline = await preflightCanonicalPackage([
  file("datos.xlsx", cleanBytes),
  file("dolores.xlsx", painBytes),
]);
{
  const blockers = baseline.findings.filter((finding) => finding.severity === "blocker");
  check(
    blockers.length === 0,
    `no blocker on a valid package${blockers.length ? `: ${blockers.map((b) => `${b.code} — ${b.message}`).join(" | ")}` : ""}`,
  );
  check(baseline.confirmationAllowed === true, "confirmation is allowed");
  check(
    baseline.assets.map((asset) => asset.role).join(",") === "clean_study_data,curated_pain_map",
    "both semantic roles resolved",
  );
  check(baseline.mappingVersion === CUICUILCO_PACKAGE_SPEC_V1.mappingVersion, "the mapping version is reported");
  check(
    typeof baseline.packageIdempotencyKey === "string" && /^sha256:[0-9a-f]{64}$/.test(baseline.packageIdempotencyKey),
    "the package idempotency key has the shape migration 0022 enforces",
  );
  check(
    baseline.assets.every((asset) => /^sha256:[0-9a-f]{64}$/.test(asset.sha256)),
    "every asset carries a SHA-256 of its own bytes",
  );
  check(
    baseline.assets.every((asset) => asset.sheetSignature && asset.structuralSignature),
    "every asset carries both structural signatures",
  );
  check(
    baseline.assets[0].sheets.length === 11 && baseline.assets[1].sheets.length === 5,
    "detected sheets are reported per asset",
  );
  check(
    baseline.assets.every((asset) => asset.sheets.every((sheet) => sheet.expected)),
    "every detected sheet is one the specification asked for",
  );
}

console.log("\n[7] Every count the approved mapping declares is reconciled");
{
  const expected = [
    ["RECORDS_PERFIL_CLIENTE", 28],
    ["RECORDS_PERFIL_DESERTORES", 32],
    ["RECORDS_ID_CLIENTE", 60],
    ["RECORDS_GENERACIONES", 5],
    ["RECORDS_RETENCION_DESERCION", 6],
    ["RECORDS_CSAT", 28],
    ["RECORDS_SATISFACCION_CSAT", 6],
    ["RECORDS_NPS", 28],
    ["RECORDS_NPS_DESERTORES", 11],
    ["RECORDS_RECOMENDACION_NPS", 10],
    ["RECORDS_CRI", 28],
    ["IDENTITY_CATALOGUE_UNIQUE", 60],
    ["IDENTITY_COHORT_ACTIVE", 28],
    ["IDENTITY_COHORT_DESERTER", 32],
    ["IDENTITY_UNION_TOTAL", 60],
    ["CSAT_ITEMS_TOTAL", 55],
    ["CSAT_DOMAIN_INTERACCIONES_OPERACION", 29],
    ["CSAT_DOMAIN_RENDICION_CUENTAS", 6],
    ["CSAT_DOMAIN_CULTURA_EDL", 10],
    ["CSAT_DOMAIN_CULTURA_MIEMBROS", 10],
    ["PERFORMANCE_PERIODS", 9],
    ["RETENTION_PERIODS", 6],
    ["ENTITIES_JOURNEY", 18],
    ["ENTITIES_EQUIPOS", 10],
    ["ENTITIES_DESEMPENO", 7],
    ["ENTITIES_CULTURA_EDL", 10],
    ["ENTITIES_CULTURA_MIEMBROS", 10],
  ];
  for (const [code, count] of expected) {
    const entry = expectationFor(baseline, code);
    check(
      Boolean(entry) && entry.expected === count && entry.actual === count && entry.satisfied,
      `${code} = ${count} (expected ${entry?.expected}, actual ${entry?.actual})`,
    );
  }
  check(
    baseline.expectations.length === expected.length,
    `no expectation is missing from the report (declared ${expected.length}, reported ${baseline.expectations.length})`,
  );
  check(
    baseline.expectations.every((entry) => entry.coordinate !== null || entry.code === "IDENTITY_UNION_TOTAL"),
    "every sheet-scoped expectation carries a coordinate",
  );
}

console.log("\n[8] Identity is resolved by identifier and reconciled with the catalogue");
{
  const swappedNames = await cleanWorkbook({
    idCliente: { mutate: (rows) => { rows[2].A = text("ZNOMBREPRIVOTRO"); } },
  });
  const result = await preflightCanonicalPackage([file("a.xlsx", swappedNames), file("b.xlsx", painBytes)]);
  check(has(result, "IDENTITY_NAME_DISAGREEMENT"), "a name that disagrees with the catalogue is reported");
  check(
    findingFor(result, "IDENTITY_NAME_DISAGREEMENT").severity === "warning",
    "as a warning: the join is by identifier, so a name difference does not stop the import",
  );
  check(result.confirmationAllowed === true, "and it alone does not block confirmation");

  const orphan = await cleanWorkbook({
    perfilCliente: { mutate: (rows) => { rows[3].C = text("ZIDPRIV999"); } },
  });
  const orphanResult = await preflightCanonicalPackage([file("a.xlsx", orphan), file("b.xlsx", painBytes)]);
  check(has(orphanResult, "IDENTITY_NOT_IN_CATALOGUE"), "an identifier absent from the catalogue blocks");
  check(has(orphanResult, "IDENTITY_CATALOGUE_UNUSED"), "and the catalogue entry it abandoned is reported too");
  check(orphanResult.confirmationAllowed === false, "confirmation is refused");

  const duplicated = await cleanWorkbook({
    idCliente: { mutate: (rows) => { rows[3].B = rows[2].B; } },
  });
  const duplicatedResult = await preflightCanonicalPackage([file("a.xlsx", duplicated), file("b.xlsx", painBytes)]);
  check(has(duplicatedResult, "SHEET_DUPLICATE_IDENTITY"), "a repeated identifier in the catalogue blocks");
  check(
    /filas?[^.]*3/i.test(findingFor(duplicatedResult, "SHEET_DUPLICATE_IDENTITY").message),
    "and the message names the rows to open, not the value",
  );

  const overlap = await cleanWorkbook({
    perfilDesertores: { mutate: (rows) => { rows[3].C = text(SENTINEL.id(1)); } },
  });
  const overlapResult = await preflightCanonicalPackage([file("a.xlsx", overlap), file("b.xlsx", painBytes)]);
  check(has(overlapResult, "IDENTITY_COHORT_OVERLAP"), "one identity in two cohorts blocks");
}

console.log("\n[9] A package the product cannot describe unambiguously is refused");
{
  const onlyClean = await preflightCanonicalPackage([file("solo.xlsx", cleanBytes)]);
  check(has(onlyClean, "PACKAGE_ROLE_MISSING"), "a missing role blocks");
  check(onlyClean.packageIdempotencyKey === null, "and an undecided package has no idempotency key");
  check(onlyClean.confirmationAllowed === false, "confirmation is refused");

  // Structurally identical, byte-different: a duplicate ROLE, not a duplicate FILE.
  const secondClean = await cleanWorkbook({
    perfilCliente: { mutate: (rows) => { rows[3].N = num(999999); } },
  });
  const duplicateRole = await preflightCanonicalPackage([
    file("uno.xlsx", cleanBytes),
    file("dos.xlsx", secondClean),
  ]);
  check(has(duplicateRole, "PACKAGE_ROLE_DUPLICATED"), "two files claiming the same role block");
  check(
    duplicateRole.assets.every((asset) => asset.role === null),
    "and neither file is arbitrarily given the role",
  );

  const sameFileTwice = await preflightCanonicalPackage([
    file("uno.xlsx", cleanBytes),
    file("copia de uno.xlsx", cleanBytes.slice(0)),
  ]);
  check(has(sameFileTwice, "PACKAGE_DUPLICATE_FILE"), "the same bytes uploaded twice block, whatever they are called");

  const merged = await buildWorkbook({ sheets: [...cleanSheets(), ...painSheets()] });
  const ambiguous = await preflightCanonicalPackage([file("todo.xlsx", merged), file("dolores.xlsx", painBytes)]);
  check(has(ambiguous, "PACKAGE_AMBIGUOUS_SIGNATURE"), "a workbook matching two roles blocks as ambiguous");

  const missingSheet = await buildWorkbook({
    sheets: cleanSheets().filter((sheet) => sheet.name !== "CRI"),
  });
  const missingResult = await preflightCanonicalPackage([file("a.xlsx", missingSheet), file("b.xlsx", painBytes)]);
  check(has(missingResult, "PACKAGE_ASSET_UNRECOGNISED"), "a workbook missing a required worksheet is not recognised");
  check(
    findingFor(missingResult, "PACKAGE_ASSET_UNRECOGNISED").message.includes("'CRI'"),
    "and the message names the worksheet that is missing",
  );
  check(has(missingResult, "PACKAGE_ROLE_MISSING"), "so its role is reported missing");

  const accentless = await buildWorkbook({
    sheets: painSheets().map((sheet) =>
      sheet.name === "Desempeño" ? { ...sheet, name: "Desempeno" } : sheet,
    ),
  });
  const nearMiss = await preflightCanonicalPackage([file("a.xlsx", cleanBytes), file("b.xlsx", accentless)]);
  check(
    findingFor(nearMiss, "PACKAGE_ASSET_UNRECOGNISED")?.message.includes("Desempeno"),
    "an accent-only difference is NOT silently accepted, and the near miss is named",
  );

  const duplicateSheetName = await buildWorkbook({
    sheets: [...painSheets(), { name: "Journey", rows: { 1: { A: text("otra") } } }],
  });
  const duplicateSheetResult = await preflightCanonicalPackage([
    file("a.xlsx", cleanBytes),
    file("b.xlsx", duplicateSheetName),
  ]);
  check(
    has(duplicateSheetResult, "ASSET_DUPLICATE_SHEET_NAME"),
    "two worksheets with the same name block instead of one being picked",
  );
}

console.log("\n[10] A moved header anchor is caught before any count is trusted");
{
  // The whole sheet shifted up one row: the counts would still look plausible.
  const shifted = await buildWorkbook({
    sheets: cleanSheets().map((sheet) => {
      if (sheet.name !== "Perfil Cliente") return sheet;
      const rows = {};
      for (const [row, cells] of Object.entries(sheet.rows)) rows[Number(row) - 1] = cells;
      return { ...sheet, rows };
    }),
  });
  const result = await preflightCanonicalPackage([file("a.xlsx", shifted), file("b.xlsx", painBytes)]);
  check(has(result, "SHEET_HEADER_ANCHOR_SHIFTED"), "content in a cell the anchor requires empty blocks");
  check(result.confirmationAllowed === false, "and confirmation is refused");

  const noHeader = await buildWorkbook({
    sheets: cleanSheets().map((sheet) => {
      if (sheet.name !== "NPS") return sheet;
      const rows = { ...sheet.rows };
      delete rows[1];
      return { ...sheet, rows };
    }),
  });
  const noHeaderResult = await preflightCanonicalPackage([file("a.xlsx", noHeader), file("b.xlsx", painBytes)]);
  check(has(noHeaderResult, "SHEET_HEADER_ANCHOR_MISSING"), "a missing header row blocks");

  const shortBand = await buildWorkbook({
    sheets: painSheets({
      mutate: (sheets) => {
        const journey = sheets.find((sheet) => sheet.name === "Journey");
        delete journey.rows[6].S;
      },
    }),
  });
  const shortResult = await preflightCanonicalPackage([file("a.xlsx", cleanBytes), file("b.xlsx", shortBand)]);
  const entities = expectationFor(shortResult, "ENTITIES_JOURNEY");
  check(entities?.actual === 17 && entities.satisfied === false, "a short entity band is reported as 17 of 18");
  check(has(shortResult, "ENTITIES_JOURNEY"), "and it blocks");
}

console.log("\n[11] A wrong count blocks, and says exactly which");
{
  const short = await buildWorkbook({
    sheets: cleanSheets().map((sheet) => {
      if (sheet.name !== "CSAT") return sheet;
      const rows = { ...sheet.rows };
      delete rows[30];
      return { ...sheet, rows };
    }),
  });
  const result = await preflightCanonicalPackage([file("a.xlsx", short), file("b.xlsx", painBytes)]);
  const entry = expectationFor(result, "RECORDS_CSAT");
  check(entry?.expected === 28 && entry.actual === 27, "27 CSAT sessions where 28 were expected");
  check(has(result, "RECORDS_CSAT"), "the shortfall is a blocker, not a note");

  const shortDomain = await buildWorkbook({
    sheets: cleanSheets({
      csat: { mutate: (rows) => { delete rows[2].BH; } },
    }),
  });
  const domainResult = await preflightCanonicalPackage([file("a.xlsx", shortDomain), file("b.xlsx", painBytes)]);
  check(
    expectationFor(domainResult, "CSAT_DOMAIN_INTERACCIONES_OPERACION")?.actual === 28,
    "a missing item header shrinks its domain to 28 of 29",
  );
  check(expectationFor(domainResult, "CSAT_ITEMS_TOTAL")?.actual === 54, "and the CSAT total falls to 54 of 55");
}

// ---- [12] Absence, never zero ---------------------------------------------
console.log("\n[12] Absence is never converted into a number");
{
  for (const [raw, status] of [
    ["", "missing"],
    ["NA", "source_unavailable"],
    ["N/A", "source_unavailable"],
    ["Sin dato", "source_unavailable"],
    ["Sin datos", "source_unavailable"],
    ["Sin información", "source_unavailable"],
    ["  sin  informacion ", "source_unavailable"],
    ["No participó", "not_participated"],
    ["No aplica", "not_applicable"],
    ["#N/A", "source_unavailable"],
    ["#¡DIV/0!", "source_unavailable"],
  ]) {
    const classified = classifySourceValue(raw);
    check(
      classified.status === status && classified.numeric === null,
      `${JSON.stringify(raw)} -> ${status} with no number (got ${classified.status}/${classified.numeric})`,
    );
  }
  const zero = classifySourceValue("0");
  check(zero.status === "answered" && zero.numeric === 0, "a real 0 stays an answered 0");
  const label = classifySourceValue("No lo conozco");
  check(
    label.status === "answered" && label.numeric === null,
    "an unrecognised phrase stays text for a human rather than being guessed into a state",
  );
  const notAnswer = classifySourceValue("No", new Map([["no", "not_participated"]]));
  check(
    notAnswer.status === "not_participated",
    "a column-scoped token turns a bare 'No' into non-participation, not an answer",
  );
  check(
    classifySourceValue("No").status === "answered",
    "and the same 'No' outside that column stays an ordinary answer",
  );

  const absence = findingFor(baseline, "PERFORMANCE_SOURCE_UNAVAILABLE");
  check(
    absence?.actual === 2,
    `the two participants with no numeric month are reported (got ${absence?.actual})`,
  );
  check(
    absence?.message.includes("nunca como") && absence.message.includes("source_unavailable"),
    "and the report says explicitly that they do not become 0",
  );
  const states = findingFor(baseline, "PERFORMANCE_ABSENCE_STATES");
  check(
    states?.expected === 28 * 9 && states.actual === 26 * 9,
    `performance cells are counted honestly (${states?.actual} numeric of ${states?.expected})`,
  );
  const contextual = findingFor(baseline, "CONTEXTUAL_ABSENCE_STATES");
  check(contextual?.actual === 21, `21 deserters did not take the exit survey (got ${contextual?.actual})`);

  const contradiction = await cleanWorkbook({
    perfilCliente: { mutate: (rows) => { rows[3 + ACTIVE - 1].O = num(72); } },
  });
  const contradictionResult = await preflightCanonicalPackage([
    file("a.xlsx", contradiction),
    file("b.xlsx", painBytes),
  ]);
  check(
    has(contradictionResult, "PERFORMANCE_OVERALL_CONTRADICTION"),
    "a source aggregate with no month behind it is reported rather than trusted",
  );
}

console.log("\n[13] Counts that must agree with each other are checked");
{
  const broken = await cleanWorkbook({
    retencion: { mutate: (rows) => { rows[2].D = num(9999); } },
  });
  const result = await preflightCanonicalPackage([file("a.xlsx", broken), file("b.xlsx", painBytes)]);
  check(
    has(result, "RETENTION_COUNT_IDENTITY_BROKEN"),
    "final = inicial - perdidos + nuevos is enforced on the source counts",
  );
  check(result.confirmationAllowed === false, "and a broken identity blocks, because the rates derive from it");

  const nonNumeric = await cleanWorkbook({
    retencion: { mutate: (rows) => { rows[3].B = text("Sin dato"); } },
  });
  const nonNumericResult = await preflightCanonicalPackage([
    file("a.xlsx", nonNumeric),
    file("b.xlsx", painBytes),
  ]);
  check(
    has(nonNumericResult, "RETENTION_COUNTS_NOT_NUMERIC"),
    "a period whose counts are not all numeric is reported as unverifiable, not as zero",
  );
}

// ---- [14] Evidence ---------------------------------------------------------
console.log("\n[14] Style, merges and formulas are recorded as evidence, not interpreted");
{
  const journey = baseline.visualEvidence.find((entry) => entry.sheet === "Journey");
  check(journey?.explicitFillCells > 0, `Journey reports explicitly filled cells (${journey?.explicitFillCells})`);
  check(
    journey?.fills.some((fill) => fill.rgb === "FFFF0000") && journey.fills.some((fill) => fill.rgb === "FFFFFF00"),
    "the distinct fills are counted per colour",
  );
  const csatEvidence = baseline.visualEvidence.find((entry) => entry.sheet === "CSAT");
  check(csatEvidence?.mergedRanges === 4, `CSAT reports its 4 merged ranges (${csatEvidence?.mergedRanges})`);
  check(csatEvidence?.themeFillCells === 4, `and its 4 theme-filled domain cells (${csatEvidence?.themeFillCells})`);
  check(
    baseline.findings.every((finding) => !/banda|semáforo|verde|rojo significa/i.test(finding.message)),
    "no finding assigns a meaning to a colour",
  );

  const retention = baseline.formulaReconciliation.find((entry) => entry.sheet === "RetenciónDeserción");
  check(retention?.formulaCells === 12, `the 12 rate formulas are counted (${retention?.formulaCells})`);
  check(retention?.withoutCachedValue === 0, "and all of them carry the value they produced");

  const uncached = await cleanWorkbook({
    retencion: { mutate: (rows) => { rows[2].F = formula("(D2-C2)/B2"); } },
  });
  const uncachedResult = await preflightCanonicalPackage([file("a.xlsx", uncached), file("b.xlsx", painBytes)]);
  check(
    has(uncachedResult, "FORMULA_WITHOUT_CACHED_VALUE"),
    "a formula with no cached value is reported so it is not read as an absence by accident",
  );
  check(
    findingFor(uncachedResult, "FORMULA_WITHOUT_CACHED_VALUE").message.includes("F2"),
    "and the coordinate is named",
  );
  check(
    findingFor(uncachedResult, "FORMULA_WITHOUT_CACHED_VALUE").severity === "warning",
    "as a warning: the value can be recovered by recalculating and re-exporting",
  );

  check(baseline.aliasCandidates.length > 0, "columns with two spellings of one value are flagged as alias candidates");
  check(
    baseline.aliasCandidates.every((candidate) => candidate.variants >= 2 && candidate.sampleCoordinates.length > 0),
    "each candidate names the column and coordinates a reviewer can open",
  );
  check(
    !JSON.stringify(baseline.aliasCandidates).includes("Servicios"),
    "and carries NO value: merging two redactions is a versioned human decision",
  );
}

// ---- [15] Idempotency ------------------------------------------------------
console.log("\n[15] The package key comes from content and role, never from a name or an order");
{
  const reversed = await preflightCanonicalPackage([
    file("dolores.xlsx", painBytes),
    file("datos.xlsx", cleanBytes),
  ]);
  check(
    reversed.packageIdempotencyKey === baseline.packageIdempotencyKey,
    "reversing the upload order produces the same package key",
  );
  check(
    JSON.stringify(reversed) === JSON.stringify(baseline),
    "and the ENTIRE report is byte-identical: the preflight is order-independent and deterministic",
  );

  const renamed = await preflightCanonicalPackage([
    file("archivo-sin-relación-con-nada.xlsx", painBytes),
    file("otro-nombre-cualquiera.xlsx", cleanBytes),
  ]);
  check(
    renamed.packageIdempotencyKey === baseline.packageIdempotencyKey,
    "renaming both files changes nothing: the role came from structure and the key from content",
  );
  check(
    renamed.assets.map((asset) => asset.role).join(",") === "clean_study_data,curated_pain_map",
    "and the roles still resolve",
  );

  const rerun = await preflightCanonicalPackage([file("datos.xlsx", cleanBytes), file("dolores.xlsx", painBytes)]);
  check(JSON.stringify(rerun) === JSON.stringify(baseline), "running the same package twice yields the same report");

  const changed = await cleanWorkbook({
    perfilCliente: { mutate: (rows) => { rows[3].N = num(4242); } },
  });
  const changedResult = await preflightCanonicalPackage([file("a.xlsx", changed), file("b.xlsx", painBytes)]);
  check(
    changedResult.packageIdempotencyKey !== baseline.packageIdempotencyKey,
    "one changed cell changes the key, so a corrected file is not mistaken for a retry",
  );

  const sameHashes = [
    { role: "curated_pain_map", sha256: `sha256:${"b".repeat(64)}` },
    { role: "clean_study_data", sha256: `sha256:${"a".repeat(64)}` },
  ];
  const forward = await packageIdempotencyKey("cuicuilco", 1, [...sameHashes].reverse());
  const backward = await packageIdempotencyKey("cuicuilco", 1, sameHashes);
  check(forward === backward, "the key derivation itself sorts by role");
  check(
    (await packageIdempotencyKey("cuicuilco", 2, sameHashes)) !== backward,
    "and a different mapping version is a different package",
  );
}

// ---- [16] Privacy ----------------------------------------------------------
console.log("\n[16] No private source value reaches the report");
{
  const reports = [baseline];
  for (const mutation of [
    { idCliente: { mutate: (rows) => { rows[2].A = text("ZNOMBREPRIVDISTINTO"); } } },
    { idCliente: { mutate: (rows) => { rows[3].B = rows[2].B; } } },
    { perfilCliente: { mutate: (rows) => { rows[3].C = text("ZIDPRIV999"); } } },
    { perfilDesertores: { mutate: (rows) => { rows[3].C = text(SENTINEL.id(1)); } } },
  ]) {
    const bytes = await cleanWorkbook(mutation);
    reports.push(await preflightCanonicalPackage([file("a.xlsx", bytes), file("b.xlsx", painBytes)]));
  }

  const serialized = JSON.stringify(reports);
  const leaked = [];
  for (const token of ["ZNOMBREPRIV", "ZIDPRIV", "ZTEXTOPRIV", "ZCATEGPRIV"]) {
    if (serialized.includes(token)) leaked.push(token);
  }
  check(
    leaked.length === 0,
    `no name, identifier, quote or category value appears in any report${leaked.length ? `: ${leaked.join(", ")}` : ""}`,
  );
  check(
    !serialized.includes("Servicios profesionales") && !serialized.includes("Comercio local"),
    "no free-text category value appears either, including in alias candidates",
  );
  check(
    reports.every((report) => report.findings.every((finding) => typeof finding.message === "string" && finding.message.length > 0)),
    "every finding still carries an operator-facing message",
  );
  check(
    reports.every((report) =>
      report.findings.every(
        (finding) =>
          typeof finding.code === "string" &&
          ["blocker", "warning", "info"].includes(finding.severity) &&
          "assetRole" in finding &&
          "sheet" in finding &&
          "coordinate" in finding,
      ),
    ),
    "every finding carries a stable code, a severity, an asset role, a sheet and a coordinate slot",
  );
  check(
    reports.every((report) => report.confirmationAllowed === (report.counts.blockers === 0)),
    "confirmation is allowed if and only if there is no blocker",
  );
  // The Spanish messages must actually be Spanish: an operator-facing sentence
  // in English is a defect, not a nicety.
  check(
    baseline.findings.every((finding) => /[a-záéíóúñ]/i.test(finding.message) && finding.message.endsWith(".")),
    "messages are written sentences",
  );
}

// ---- [17] Malformed input and resource ceilings ---------------------------
console.log("\n[17] Malformed and oversized input is refused before anything else happens");
{
  const notAZip = await preflightCanonicalPackage([
    file("roto.xlsx", new TextEncoder().encode("esto no es un xlsx").buffer),
    file("b.xlsx", painBytes),
  ]);
  check(has(notAZip, "ASSET_UNREADABLE"), "a file that is not a .xlsx is refused");
  check(
    /no es un \.xlsx válido/.test(findingFor(notAZip, "ASSET_UNREADABLE").message),
    "with the reader's own actionable Spanish sentence",
  );
  check(notAZip.confirmationAllowed === false, "and confirmation is refused");

  const empty = await preflightCanonicalPackage([file("vacio.xlsx", new ArrayBuffer(0))]);
  check(has(empty, "ASSET_EMPTY"), "an empty file is refused before it is parsed");

  const oversized = await preflightCanonicalPackage([
    file("enorme.xlsx", new ArrayBuffer(MAX_UPLOAD_BYTES + 1)),
  ]);
  check(
    has(oversized, "ASSET_TOO_LARGE"),
    "a file over the product's own upload ceiling is refused before it is parsed",
  );
  const atLimit = await preflightCanonicalPackage([file("justo.xlsx", new ArrayBuffer(MAX_UPLOAD_BYTES))]);
  check(
    !has(atLimit, "ASSET_TOO_LARGE"),
    "a file of exactly the ceiling is not over it — the same rule the upload boundary applies",
  );

  const none = await preflightCanonicalPackage([]);
  check(has(none, "PACKAGE_INPUT_INVALID"), "an empty package is refused by the input schema");

  const tooMany = await preflightCanonicalPackage(
    range(9).map((index) => file(`f${index}.xlsx`, cleanBytes.slice(0))),
  );
  check(has(tooMany, "PACKAGE_INPUT_INVALID"), "more files than a package admits is refused");

  const tooManySheets = await buildWorkbook({
    sheets: range(XLSX_LIMITS.sheets + 1).map((index) => ({
      name: `Hoja ${index}`,
      rows: { 1: { A: text("x") } },
    })),
  });
  const sheetCeiling = await refusal(() => readXlsxWorkbook(tooManySheets));
  check(sheetCeiling instanceof XlsxLimitError, "a workbook past the sheet ceiling is refused by the reader");
  check(
    Boolean(sheetCeiling) && sheetCeiling.message.includes("hojas"),
    "and the refusal names sheets in Spanish",
  );

  const noRels = await buildWorkbook({
    omitRels: true,
    sheets: [{ name: "Uno", rows: { 1: { A: text("a") } } }, { name: "Dos", rows: { 1: { A: text("b") } } }],
  });
  const fallback = await readXlsxWorkbook(noRels);
  check(
    fallback.sheets.length === 2 && fallback.sheets[1].name === "Dos",
    "a workbook with no relationship part falls back by position instead of silently losing sheets",
  );

  const missingPart = await refusal(async () => {
    const zip = new JSZip();
    zip.file(
      "xl/workbook.xml",
      `<?xml version="1.0"?><workbook xmlns="${NS}"><sheets>` +
        `<sheet name="Uno" sheetId="1" r:id="rId1" xmlns:r="${REL}"/></sheets></workbook>`,
    );
    const buffer = await zip.generateAsync({ type: "nodebuffer" });
    return readXlsxWorkbook(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength));
  });
  check(
    missingPart instanceof Error && /no se pudo leer/.test(missingPart.message),
    "a worksheet part that is not in the archive names the sheet it belongs to",
  );
}

// ---- [18] The Worker boundary and the write boundary ----------------------
console.log("\n[18] The unit stays Workers-safe and writes nothing");
{
  const walk = (dir) => {
    const out = [];
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) out.push(...walk(path));
      else if (/\.(ts|tsx)$/.test(name)) out.push(path);
    }
    return out;
  };
  const moduleFiles = walk(join("src", "lib", "ingestion", "canonical-package"));
  check(moduleFiles.length >= 6, `the module has ${moduleFiles.length} source files`);

  const sources = moduleFiles.map((path) => ({ path, code: readFileSync(path, "utf8") }));
  const excelJs = sources.filter(({ code }) => /['"]exceljs[^'"]*['"]/.test(code));
  check(excelJs.length === 0, `no module resolves ExcelJS${excelJs.length ? `: ${excelJs.map((s) => s.path).join(", ")}` : ""}`);

  // Unit 2 validates. It does not write. A Supabase client, an insert or an RPC
  // anywhere in this module would mean a refused package could still have left
  // something behind.
  const writers = sources.filter(({ code }) =>
    /@supabase|createClient|\.insert\(|\.upsert\(|\.rpc\(|\.delete\(|\.update\(/.test(code),
  );
  check(
    writers.length === 0,
    `no module in the unit reaches a database${writers.length ? `: ${writers.map((s) => s.path).join(", ")}` : ""}`,
  );

  const nodeOnly = sources.filter(({ code }) => /from\s+['"]node:|require\(/.test(code));
  check(nodeOnly.length === 0, "no module imports a Node-only builtin, so the unit evaluates on workerd");

  const reader = readFileSync(join("src", "lib", "ingestion", "xlsx-reader.ts"), "utf8");
  check(!/['"]exceljs[^'"]*['"]/.test(reader), "the reader still resolves no ExcelJS module");
  check(/await import\(\s*['"]jszip['"]\s*\)/.test(reader), "and still loads JSZip lazily, the only library it needs");

  const pkg = JSON.parse(readFileSync("package.json", "utf8"));
  check(!("exceljs" in (pkg.dependencies ?? {})), "exceljs is not a production dependency");
  check(
    (pkg.scripts?.test ?? "").includes("test:canonical-package"),
    "this gate is registered in the offline test chain",
  );
}

console.log("\n" + "=".repeat(70));
if (failures > 0) {
  console.error(`RESULT: ${failures} failure(s). GATE BLOCKED.`);
  process.exit(1);
}
console.log(
  "RESULT: the package parses, reconciles and refuses without writing anything, and no private value leaves the source. GATE PASSED.",
);
