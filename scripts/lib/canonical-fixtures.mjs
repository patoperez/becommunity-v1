// =============================================================================
// Synthetic Cuicuilco-shaped workbook fixtures
// =============================================================================
// One definition, shared by the OFFLINE gate (`canonical-commit-test.mjs`) and
// the DATABASE gate (`canonical-commit-live-test.mjs`). Two copies of a fixture
// drift, and a drifted fixture makes the two gates prove different things while
// reporting the same names.
//
// Every value here is authored, not copied. Where a real workbook would hold a
// name, an identifier, an answer or a comment there is a SENTINEL that exists
// nowhere else, so a gate can assert that none of them reached a report. The
// only real-world vocabulary is the business wording the calculation catalogue
// already documents (the CRI risk categories and the three NPS labels), which
// the projector must MATCH in order to identify a metric's evidence column.
//
// No client workbook, name, answer or identifier is committed to this
// repository.
// =============================================================================

import { columnLetters, columnNumber } from "../../src/lib/ingestion/canonical-package/sheet-view.ts";
import { CUICUILCO_PACKAGE_SPEC_V1 } from "../../src/lib/ingestion/canonical-package/spec.ts";

const { default: JSZip } = await import("jszip");
const NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
const REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";

const escapeXml = (value) =>
  String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const text = (value, style) => ({ kind: "text", value, style });
const num = (value, style) => ({ kind: "num", value, style });
const formula = (source, cached, style) => ({ kind: "formula", source, cached, style });
const blank = (style) => ({ kind: "blank", style });

const STYLES =
  '<numFmts><numFmt numFmtId="164" formatCode="dd/mm/yyyy"/></numFmts>' +
  "<fills>" +
  '<fill><patternFill patternType="none"/></fill>' +
  '<fill><patternFill patternType="gray125"/></fill>' +
  '<fill><patternFill patternType="solid"><fgColor rgb="FFFF0000"/></patternFill></fill>' +
  '<fill><patternFill patternType="solid"><fgColor rgb="FFFFFF00"/></patternFill></fill>' +
  '<fill><patternFill patternType="solid"><fgColor theme="4" tint="0.4"/></patternFill></fill>' +
  '<fill><patternFill patternType="solid"><fgColor rgb="FF6AA84F"/></patternFill></fill>' +
  "</fills>" +
  "<cellXfs>" +
  '<xf numFmtId="0" fillId="0"/>' +
  '<xf numFmtId="14" fillId="0"/>' +
  '<xf numFmtId="0" fillId="2"/>' +
  '<xf numFmtId="0" fillId="3"/>' +
  '<xf numFmtId="0" fillId="4"/>' +
  '<xf numFmtId="0" fillId="5"/>' +
  "</cellXfs>";

const STYLE = { plain: 0, date: 1, red: 2, yellow: 3, theme: 4, green: 5 };

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

async function buildWorkbook(sheets) {
  const zip = new JSZip();
  const p = "x:";
  const xmlns = ` xmlns:x="${NS}"`;
  const sheetTags = sheets
    .map(
      (sheet, index) =>
        `<${p}sheet name="${escapeXml(sheet.name)}" sheetId="${index + 1}" state="visible" ` +
        `r:id="rId${index + 1}" xmlns:r="${REL}"/>`,
    )
    .join("");
  zip.file(
    "xl/workbook.xml",
    `<?xml version="1.0" encoding="utf-8"?><${p}workbook${xmlns}><${p}sheets>${sheetTags}</${p}sheets></${p}workbook>`,
  );
  zip.file(
    "xl/_rels/workbook.xml.rels",
    `<?xml version="1.0" encoding="utf-8"?><Relationships xmlns="${REL}/package">` +
      sheets
        .map(
          (_, index) =>
            `<Relationship Id="rId${index + 1}" Type="${REL}/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`,
        )
        .join("") +
      "</Relationships>",
  );
  sheets.forEach((sheet, index) => {
    const rowNumbers = Object.keys(sheet.rows ?? {})
      .map(Number)
      .sort((a, b) => a - b);
    const body = rowNumbers
      .map((rowNumber) => {
        const cells = sheet.rows[rowNumber];
        const columns = Object.keys(cells).sort((a, b) => columnNumber(a) - columnNumber(b));
        return `<${p}row r="${rowNumber}">${columns.map((column) => cellXml(`${column}${rowNumber}`, cells[column], p)).join("")}</${p}row>`;
      })
      .join("");
    const merges = (sheet.merges ?? []).map((ref) => `<${p}mergeCell ref="${ref}"/>`).join("");
    const mergeBlock = merges ? `<${p}mergeCells count="${sheet.merges.length}">${merges}</${p}mergeCells>` : "";
    zip.file(
      `xl/worksheets/sheet${index + 1}.xml`,
      `<?xml version="1.0" encoding="utf-8"?><${p}worksheet${xmlns}><${p}sheetData>${body}</${p}sheetData>${mergeBlock}</${p}worksheet>`,
    );
  });
  zip.file("xl/styles.xml", `<?xml version="1.0" encoding="utf-8"?><${p}styleSheet${xmlns}>${STYLES}</${p}styleSheet>`);
  const buffer = await zip.generateAsync({ type: "nodebuffer" });
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
}

// ---------------------------------------------------------------------------
// The synthetic Cuicuilco-shaped package
// ---------------------------------------------------------------------------

// SENTINELS. Everything a real workbook would hold privately is written as a
// token that exists nowhere else, so a leak names itself.
const SENTINEL = {
  name: (n) => `ZNOMBREPRIV${String(n).padStart(3, "0")}`,
  id: (n) => `ZIDPRIV${String(n).padStart(3, "0")}`,
  quote: (n) => `ZTEXTOPRIV${String(n).padStart(3, "0")}`,
  category: (n) => `ZCATEGPRIV${String(n).padStart(3, "0")}`,
};

const ACTIVE = 28;
const DESERTERS = 32;
const TOTAL = ACTIVE + DESERTERS;
const RESPONDING_DESERTERS = 11;

// Business vocabulary quoted from docs/CALCULATION_CATALOG.md. Not private.
const CRI_OPTIONS = ["Nada probable", "Poco probable", "Algo probable", "Muy probable"];
const NPS_LABELS = ["Detractor", "Pasivo", "Promotor"];
const CSAT_SCALE = ["1", "2", "3", "4", "5", "No lo conozco"];

function columnsBetween(from, to) {
  const out = [];
  for (let column = columnNumber(from); column <= columnNumber(to); column++) out.push(columnLetters(column));
  return out;
}

const CSAT_ALL = columnsBetween("D", "DI");
const CSAT_VALUES = CSAT_ALL.filter((_, index) => index % 2 === 0);
const CSAT_LABELS = CSAT_ALL.filter((_, index) => index % 2 === 1);

function headerRow(columns, label) {
  const row = {};
  columns.forEach((column, index) => {
    row[column] = text(`${label} ${index + 1}`);
  });
  return row;
}

/**
 * The five absence spellings the mapping names, plus a spreadsheet error and a
 * genuinely blank cell. Each must reach the plan as itself.
 */
const ABSENCE_CYCLE = ["NA", "", "Sin dato", "Sin información", "No aplica", "#¡DIV/0!"];

function perfilClienteSheet(mutate) {
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
      G: text(index % 2 === 0 ? "Servicios profesionales" : "servicios  profesionales "),
      H: text(SENTINEL.category(4)),
      I: text(SENTINEL.category(5)),
      J: text(SENTINEL.category(6)),
      K: num(44000 + index, STYLE.date),
      L: num(46000 + index, STYLE.date),
      M: num(2),
      N: num(1000 + index),
    };
    const noMonths = index >= ACTIVE - 2;
    if (noMonths) {
      cells.O = text("Sin dato");
      months.forEach((column, monthIndex) => {
        const token = ABSENCE_CYCLE[monthIndex % ABSENCE_CYCLE.length];
        cells[column] = token === "" ? blank(STYLE.plain) : text(token);
      });
    } else {
      cells.O = num(50 + (index % 40));
      months.forEach((column, monthIndex) => {
        const value = 30 + ((index + monthIndex) % 65);
        cells[column] = num(value, value < 50 ? STYLE.red : value < 70 ? STYLE.yellow : STYLE.green);
      });
      // One participant's March is an answered value that is NOT a number. It
      // must become `unknown`, never a score and never a zero.
      if (index === 3) cells.U = text("aproximadamente 80");
    }
    rows[row] = cells;
  }
  if (mutate) mutate(rows);
  return { name: "Perfil Cliente", rows };
}

function perfilDesertoresSheet(mutate) {
  const columns = columnsBetween("A", "N");
  const rows = { 2: headerRow(columns, "Encabezado desertor") };
  for (let index = 0; index < DESERTERS; index++) {
    const row = 3 + index;
    const person = ACTIVE + index + 1;
    const responded = index < RESPONDING_DESERTERS;
    rows[row] = {
      A: responded ? num(45100 + index, STYLE.date) : blank(STYLE.plain),
      B: text(SENTINEL.name(person)),
      C: text(SENTINEL.id(person)),
      D: text(responded ? "Sí" : "No"),
      E: text(responded ? SENTINEL.category(7) : "Sin dato"),
      F: text(responded ? SENTINEL.category(8) : "Sin dato"),
      G: text(responded ? SENTINEL.category(9) : "No aplica"),
      H: text(index % 3 === 0 ? "Comercio local" : "comercio   local"),
      I: text(SENTINEL.category(10)),
      J: text(responded ? SENTINEL.category(11) : "Sin información"),
      K: num(43000 + index, STYLE.date),
      L: num(45500 + index, STYLE.date),
      M: num(3),
      N: responded ? num(500 + index) : text("Sin dato"),
    };
  }
  if (mutate) mutate(rows);
  return { name: "Perfil Desertores", rows };
}

function idClienteSheet(mutate) {
  const rows = { 1: { A: text("Nombre"), B: text("Identificador") } };
  for (let person = 1; person <= TOTAL; person++) {
    rows[person + 1] = { A: text(SENTINEL.name(person)), B: text(SENTINEL.id(person)) };
  }
  if (mutate) mutate(rows);
  return { name: "IDCliente", rows };
}

function listSheet(name, values) {
  const rows = { 1: { A: text("Valor"), B: text("Etiqueta") } };
  values.forEach(([raw, label], index) => {
    rows[index + 2] = { A: typeof raw === "number" ? num(raw) : text(raw), B: text(label) };
  });
  return { name, rows };
}

function retencionSheet() {
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
  return { name: "RetenciónDeserción", rows };
}

function csatSheet(mutate) {
  const domains = CUICUILCO_PACKAGE_SPEC_V1.pairedInstruments[0].domains;
  const rows = {
    1: Object.fromEntries(domains.map((domain) => [domain.firstValueColumn, text(`Dominio ${domain.key}`, STYLE.theme)])),
    2: {
      A: text("Marca temporal"),
      B: text("Nombre"),
      C: text("Identificador"),
      ...Object.fromEntries(CSAT_VALUES.map((column, index) => [column, text(`Ítem ${index + 1}`)])),
      ...Object.fromEntries(CSAT_LABELS.map((column, index) => [column, text(`Etiqueta ${index + 1}`)])),
    },
  };
  for (let index = 0; index < ACTIVE; index++) {
    const row = 3 + index;
    const cells = {
      A: num(45200 + index, STYLE.date),
      B: text(SENTINEL.name(index + 1)),
      C: text(SENTINEL.id(index + 1)),
    };
    CSAT_VALUES.forEach((column, item) => {
      if (index === 0 && item === 0) {
        // AN ANSWERED ZERO. It is not in the scale, so it cannot hide behind an
        // option: it must arrive as the number 0 with status `answered`.
        cells[column] = num(0);
      } else if (item === index % CSAT_VALUES.length) {
        cells[column] = text("No lo conozco");
      } else {
        cells[column] = num(1 + ((index + item) % 5));
      }
    });
    CSAT_LABELS.forEach((column, item) => {
      cells[column] = text(`Etiqueta derivada ${1 + ((index + item) % 5)}`);
    });
    rows[row] = cells;
  }
  if (mutate) mutate(rows);
  return {
    name: "CSAT",
    rows,
    merges: domains.map((domain) => `${domain.firstValueColumn}1:${domain.lastLabelColumn}1`),
  };
}

function npsSheet(name, count, firstPerson, extraColumns) {
  const columns = columnsBetween("A", extraColumns ? "G" : "E");
  const rows = { 1: headerRow(columns, `Encabezado ${name}`) };
  for (let index = 0; index < count; index++) {
    const score = 1 + (index % 10);
    const cells = {
      A: num(45300 + index, STYLE.date),
      B: text(SENTINEL.name(firstPerson + index)),
      C: text(SENTINEL.id(firstPerson + index)),
      D: num(score),
      E: text(score >= 9 ? NPS_LABELS[2] : score >= 7 ? NPS_LABELS[1] : NPS_LABELS[0]),
    };
    if (extraColumns) {
      cells.F = text(SENTINEL.category(20 + (index % 3)));
      cells.G = text(SENTINEL.quote(index + 1));
    }
    rows[index + 2] = cells;
  }
  return { name, rows };
}

function criSheet(mutate) {
  const columns = columnsBetween("A", "F");
  const rows = { 1: headerRow(columns, "Encabezado CRI") };
  for (let index = 0; index < ACTIVE; index++) {
    const cells = {
      A: num(45400 + index, STYLE.date),
      B: text(SENTINEL.name(index + 1)),
      C: text(SENTINEL.id(index + 1)),
      // D carries the documented risk categories, so the projector can
      // IDENTIFY it. E deliberately carries values from no documented set.
      D: text(CRI_OPTIONS[index % CRI_OPTIONS.length]),
      E: text(index % 7 === 0 ? "No aplica" : SENTINEL.category(30 + (index % 5))),
    };
    if (index % 7 !== 3) cells.F = text(SENTINEL.quote(200 + index));
    rows[index + 2] = cells;
  }
  if (mutate) mutate(rows);
  return { name: "CRI", rows };
}

function cleanSheets(mutations = {}) {
  return [
    perfilClienteSheet(mutations.perfilCliente),
    perfilDesertoresSheet(mutations.perfilDesertores),
    idClienteSheet(mutations.idCliente),
    // The value/label pairs are synthetic on BOTH sides. Real generational
    // vocabulary would coincide with the source workbook's own cells, and no
    // cell of a client workbook belongs in this repository even by accident.
    listSheet("Generaciones", [
      ["ZRANGO-01", "ZCOHORTE-01"],
      ["ZRANGO-02", "ZCOHORTE-02"],
      ["ZRANGO-03", "ZCOHORTE-03"],
      ["ZRANGO-04", "ZCOHORTE-04"],
      [2013, "ZCOHORTE-05"],
    ]),
    retencionSheet(),
    csatSheet(mutations.csat),
    listSheet(
      "SatisfacciónCSAT",
      CSAT_SCALE.map((value, index) => [
        /^\d+$/.test(value) ? Number(value) : value,
        `ZBANDA-0${index + 1}`,
      ]),
    ),
    npsSheet("NPS", ACTIVE, 1, false),
    npsSheet("NPS desertores", RESPONDING_DESERTERS, ACTIVE + 1, true),
    listSheet(
      "Recomendación NPS",
      Array.from({ length: 10 }, (_, index) => [
        index + 1,
        index + 1 >= 9 ? NPS_LABELS[2] : index + 1 >= 7 ? NPS_LABELS[1] : NPS_LABELS[0],
      ]),
    ),
    criSheet(mutations.cri),
  ];
}

function painEntitySheet(name, entityRow, from, to, contentRow, emptyEvery) {
  const columns = columnsBetween(from, to);
  const rows = {
    1: { A: text(`Título ${name}`) },
    [entityRow]: { A: text("Elemento") },
    [contentRow]: { A: text("Hallazgo") },
  };
  columns.forEach((column, index) => {
    rows[entityRow][column] = text(`Elemento ${index + 1}`, index % 2 === 0 ? STYLE.red : STYLE.yellow);
    rows[contentRow][column] =
      index % emptyEvery === 0 ? blank(STYLE.plain) : text(SENTINEL.quote(100 + index), STYLE.yellow);
  });
  return { name, rows };
}

function painSheets() {
  return [
    painEntitySheet("Journey", 6, "B", "S", 7, 4),
    painEntitySheet("Equipos ", 3, "B", "K", 4, 5),
    painEntitySheet("Desempeño", 7, "B", "H", 8, 8),
    painEntitySheet("Cultura EDL", 6, "B", "K", 7, 6),
    painEntitySheet("Cultura Miembros", 8, "B", "K", 9, 7),
  ];
}

export {
  ACTIVE,
  DESERTERS,
  TOTAL,
  RESPONDING_DESERTERS,
  CRI_OPTIONS,
  NPS_LABELS,
  CSAT_SCALE,
  CSAT_VALUES,
  CSAT_LABELS,
  SENTINEL,
  STYLE,
  blank,
  buildWorkbook,
  cleanSheets,
  columnsBetween,
  formula,
  num,
  painSheets,
  text,
};

/** The two workbooks of a complete, valid synthetic package. */
export async function buildSyntheticPackage(mutations = {}) {
  return {
    cleanBytes: await buildWorkbook(cleanSheets(mutations)),
    painBytes: await buildWorkbook(painSheets()),
  };
}
