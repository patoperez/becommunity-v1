import type { ParsedFile, RawRow } from "./canonical";

/**
 * Native SpreadsheetML reader for the ingestion path.
 *
 * WHY THIS EXISTS — the defect it replaces.
 *
 * The parser used to hand the workbook to ExcelJS. Under workerd, ExcelJS's
 * `xlsx.load` poisons the isolate: the FIRST TWO requests that call it succeed,
 * and in the third request the promise never settles — it neither resolves nor
 * rejects. The runtime cancels the hung request and answers HTTP 500. In the
 * product this looked like "analyze worked, preview worked, confirm failed",
 * with nothing written and no error message the operator could act on. It was
 * reproduced against real workerd and traced to `xlsx.load` itself: a
 * JSZip-only round trip over the same bytes succeeds on every request, and
 * repeating the parse five times INSIDE one request is also fine. Only the
 * third REQUEST that reaches ExcelJS hangs.
 *
 * This module reads the parts of SpreadsheetML the ingestion path actually
 * needs, using JSZip (proven safe here) and string parsing. That removes the
 * hang, removes the re-zip normalisation the old code needed, and makes dates
 * deterministic instead of locale- and timezone-dependent.
 *
 * WHAT IT READS. The first worksheet only, exactly as before. Cell positions
 * come from each cell's own `r` reference, so a blank cell written as
 * `<c r="W3"/>` keeps every later value in its own column — compressing that
 * gap would silently attribute a value to the wrong metric.
 *
 * WHAT IT DELIBERATELY DOES NOT DO. No styling, no charts, no formulas
 * (cached formula results are read, the formula itself is ignored), no writing.
 * This is a read-only ingestion reader, not a spreadsheet library.
 */

/** Optional namespace prefix: these files are written as `<x:sheet …>`. */
const P = "(?:[A-Za-z0-9]+:)?";
const re = (body: string, flags = "g") => new RegExp(body, flags);

/** Excel's 1900 date system has a deliberate leap-year bug; day 0 is 1899-12-30. */
const EPOCH_1900 = Date.UTC(1899, 11, 30);
const EPOCH_1904 = Date.UTC(1904, 0, 1);

/** Built-in number formats that are dates or times (ECMA-376 §18.8.30). */
const BUILTIN_DATE_FORMATS = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 45, 46, 47]);

function decodeXml(value: string): string {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number(dec)))
    .replace(/&amp;/g, "&");
}

/** "AB" -> 27. Column letters are 1-based in the file, 0-based here. */
function columnIndex(reference: string): number {
  const letters = reference.match(/^[A-Z]+/)?.[0] ?? "A";
  let index = 0;
  for (const letter of letters) index = index * 26 + (letter.charCodeAt(0) - 64);
  return index - 1;
}

/**
 * `<si>` entries may be split into several `<t>` runs by formatting; the cell's
 * text is their concatenation, so the runs are joined rather than taking one.
 */
function parseSharedStrings(xml: string | null): string[] {
  if (!xml) return [];
  const items = xml.match(re(`<${P}si\\b[^>]*\\/>|<${P}si\\b[^>]*>[\\s\\S]*?<\\/${P}si>`)) ?? [];
  return items.map((item) =>
    [...item.matchAll(re(`<${P}t\\b[^>]*>([\\s\\S]*?)<\\/${P}t>`))].map((m) => decodeXml(m[1])).join(""),
  );
}

/** Style index -> is this cell formatted as a date/time? */
function parseDateStyles(xml: string | null): Set<number> {
  const dateStyles = new Set<number>();
  if (!xml) return dateStyles;

  const customDateFormats = new Set<number>();
  for (const m of xml.matchAll(re(`<${P}numFmt\\b[^>]*numFmtId="(\\d+)"[^>]*formatCode="([^"]*)"`))) {
    // Strip quoted literals and bracketed sections before looking for date
    // tokens, so a currency format like "\"day\"#,##0" is not read as a date.
    const code = decodeXml(m[2]).replace(/"[^"]*"/g, "").replace(/\[[^\]]*\]/g, "");
    if (/[ymdhs]/i.test(code)) customDateFormats.add(Number(m[1]));
  }

  const cellXfs = xml.match(re(`<${P}cellXfs\\b[\\s\\S]*?<\\/${P}cellXfs>`, ""))?.[0];
  if (!cellXfs) return dateStyles;
  const entries = cellXfs.match(re(`<${P}xf\\b[^>]*\\/>|<${P}xf\\b[^>]*>[\\s\\S]*?<\\/${P}xf>`)) ?? [];
  entries.forEach((entry, index) => {
    const numFmtId = Number(entry.match(/\bnumFmtId="(\d+)"/)?.[1] ?? "0");
    if (BUILTIN_DATE_FORMATS.has(numFmtId) || customDateFormats.has(numFmtId)) dateStyles.add(index);
  });
  return dateStyles;
}

const pad = (value: number, width = 2) => String(value).padStart(width, "0");

/**
 * Excel stores a date as a day count with no timezone. It is rendered here in
 * ISO form from the UTC components, so the same file always yields the same
 * text — the previous reader formatted a JS `Date` with `toString()`, which
 * moved the value with the server's timezone and could read a day early.
 */
function serialToIsoDate(serial: number, use1904: boolean): string {
  const epoch = use1904 ? EPOCH_1904 : EPOCH_1900;
  const ms = Math.round(serial * 86400000);
  const date = new Date(epoch + ms);
  const stamp =
    `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
  const hasTime = Math.abs(serial - Math.floor(serial)) > 1e-9;
  if (!hasTime) return stamp;
  return `${stamp}T${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())}`;
}

/** A number becomes its plain decimal text; no thousands separators, no format. */
function numberToText(value: number): string {
  return Number.isFinite(value) ? String(value) : "";
}

type SheetCell = { column: number; text: string };

function parseSheet(
  xml: string,
  shared: string[],
  dateStyles: Set<number>,
  use1904: boolean,
): SheetCell[][] {
  const rows: SheetCell[][] = [];
  const rowMatches = xml.match(re(`<${P}row\\b[^>]*\\/>|<${P}row\\b[^>]*>[\\s\\S]*?<\\/${P}row>`)) ?? [];
  for (const rowXml of rowMatches) {
    const rowNumber = Number(rowXml.match(/\br="(\d+)"/)?.[1] ?? "0");
    if (rowNumber <= 0) continue;
    const cells: SheetCell[] = [];
    // Self-closing cells MUST be matched first. A lazy `<c …>…</c>` would run
    // past `<c r="W3"/>` to the NEXT cell's closing tag and attribute that
    // cell's value to the empty one, shifting every later column.
    const cellMatches = rowXml.match(re(`<${P}c\\b[^>]*\\/>|<${P}c\\b[^>]*>[\\s\\S]*?<\\/${P}c>`)) ?? [];
    let fallbackColumn = 0;
    for (const cellXml of cellMatches) {
      const reference = cellXml.match(/\br="([A-Z]+\d+)"/)?.[1];
      const column = reference ? columnIndex(reference) : fallbackColumn;
      fallbackColumn = column + 1;
      const type = cellXml.match(/\bt="([^"]+)"/)?.[1] ?? "n";
      const styleIndex = Number(cellXml.match(/\bs="(\d+)"/)?.[1] ?? "-1");

      let text = "";
      if (type === "inlineStr") {
        text = [...cellXml.matchAll(re(`<${P}t\\b[^>]*>([\\s\\S]*?)<\\/${P}t>`))]
          .map((m) => decodeXml(m[1]))
          .join("");
      } else {
        const raw = cellXml.match(re(`<${P}v\\b[^>]*>([\\s\\S]*?)<\\/${P}v>`, ""))?.[1];
        if (raw === undefined) {
          text = "";
        } else if (type === "s") {
          text = shared[Number(raw)] ?? "";
        } else if (type === "str" || type === "e") {
          text = decodeXml(raw);
        } else if (type === "b") {
          text = raw === "1" ? "TRUE" : "FALSE";
        } else {
          const value = Number(raw);
          text = dateStyles.has(styleIndex) && Number.isFinite(value)
            ? serialToIsoDate(value, use1904)
            : numberToText(value);
        }
      }
      if (text !== "") cells.push({ column, text });
    }
    rows[rowNumber - 1] = cells;
  }
  return rows;
}

function entryText(zip: { file(path: string): { async(kind: "string"): Promise<string> } | null }, path: string) {
  const entry = zip.file(path);
  return entry ? entry.async("string") : Promise.resolve(null);
}

export async function readXlsx(buffer: ArrayBuffer): Promise<ParsedFile> {
  const { default: JSZip } = await import("jszip");
  const zip = await JSZip.loadAsync(buffer);

  const workbookXml = await entryText(zip, "xl/workbook.xml");
  if (!workbookXml) throw new Error("El archivo Excel no tiene un libro legible.");
  const use1904 = /date1904="(1|true)"/i.test(workbookXml);

  // Relationship attributes appear in any order, so each element is read whole
  // rather than assuming `Id` precedes `Target`.
  const relsXml = (await entryText(zip, "xl/_rels/workbook.xml.rels")) ?? "";
  const relationships = new Map<string, string>();
  for (const element of relsXml.match(/<Relationship\b[^>]*?\/?>/g) ?? []) {
    const id = element.match(/\bId="([^"]+)"/)?.[1];
    const target = element.match(/\bTarget="([^"]+)"/)?.[1];
    if (id && target) relationships.set(id, target);
  }

  const firstSheet = workbookXml.match(
    re(`<${P}sheet\\b[^>]*\\/?>`, ""),
  )?.[0];
  if (!firstSheet) throw new Error("El archivo Excel no tiene hojas.");
  const relationshipId = firstSheet.match(/r:id="([^"]+)"/)?.[1];
  let target = (relationshipId && relationships.get(relationshipId)) || "worksheets/sheet1.xml";
  // Targets may be absolute ("/xl/worksheets/sheet1.xml") or relative.
  target = target.replace(/^\//, "");
  if (!target.startsWith("xl/")) target = `xl/${target}`;

  const sheetXml = await entryText(zip, target);
  if (!sheetXml) throw new Error("El archivo Excel no tiene hojas.");

  const shared = parseSharedStrings(await entryText(zip, "xl/sharedStrings.xml"));
  const dateStyles = parseDateStyles(await entryText(zip, "xl/styles.xml"));
  const rows = parseSheet(sheetXml, shared, dateStyles, use1904);

  const headerCells = rows[0] ?? [];
  const width = headerCells.reduce((max, cell) => Math.max(max, cell.column + 1), 0);
  const headers: string[] = Array.from({ length: width }, () => "");
  for (const cell of headerCells) headers[cell.column] = cell.text.trim();

  const parsedRows: RawRow[] = [];
  for (let index = 1; index < rows.length; index++) {
    const cells = rows[index];
    if (!cells || cells.length === 0) continue;
    const row: RawRow = {};
    for (const header of headers) if (header) row[header] = "";
    let hasValue = false;
    for (const cell of cells) {
      const header = headers[cell.column];
      if (!header) continue;
      const text = cell.text.trim();
      row[header] = text;
      if (text !== "") hasValue = true;
    }
    if (hasValue) parsedRows.push(row);
  }

  return { headers, rows: parsedRows };
}
