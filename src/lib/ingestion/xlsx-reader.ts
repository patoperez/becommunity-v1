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
 * WHAT IT READS. Cell positions come from each cell's own `r` reference, so a
 * blank cell written as `<c r="W3"/>` keeps every later value in its own
 * column — compressing that gap would silently attribute a value to the wrong
 * metric.
 *
 * TWO READERS, TWO CONTRACTS.
 *
 *   `readXlsx` is the LEGACY ingestion reader: the first worksheet, a header
 *   row, trimmed text. Its behaviour is pinned by `test:xlsx-hardening` and
 *   `test:workers-ingestion` and must not drift — every existing study was
 *   imported through it.
 *
 *   `readXlsxWorkbook` is the CANONICAL package reader: every worksheet, the
 *   exact worksheet name, physical coordinates, formula text and cached value
 *   kept apart, and style/merge evidence retained UNINTERPRETED. A fill colour
 *   has no global meaning in this product — the same red is a metric band on
 *   one sheet and a curated annotation on another — so the reader records the
 *   colour and refuses to decide what it means.
 *
 * WHAT IT DELIBERATELY DOES NOT DO. No charts, no interpretation of style, no
 * writing. This is a read-only ingestion reader, not a spreadsheet library.
 */

/** Optional namespace prefix: these files are written as `<x:sheet …>`. */
const P = "(?:[A-Za-z0-9]+:)?";
const re = (body: string, flags = "g") => new RegExp(body, flags);

/**
 * RESOURCE CEILINGS.
 *
 * A .xlsx is a ZIP, and a ZIP says how big it will be only after you have
 * expanded it. Ten megabytes of upload — the product limit — can declare
 * gigabytes of XML, and this reader runs inside a Worker with a small, hard
 * memory budget: the isolate is killed, not slowed, and the operator gets a
 * blank 500 with nothing to act on.
 *
 * These ceilings are deliberately far above any real study (volumes here are
 * thousands of rows) and far below what would exhaust the isolate. Every one of
 * them produces a plain Spanish sentence, and every one of them is reached
 * BEFORE any database write: the import commits in a single transaction after
 * parsing succeeds, so a refusal here leaves nothing behind.
 */
export const XLSX_LIMITS = {
  /** Expanded bytes for one part, and for the whole workbook. */
  partBytes: 32 * 1024 * 1024,
  totalBytes: 48 * 1024 * 1024,
  rows: 100_000,
  columns: 4_096,
  cells: 1_000_000,
  sharedStrings: 500_000,
  /** Multi-sheet reader only: `readXlsx` has always read exactly one sheet. */
  sheets: 512,
} as const;

export class XlsxLimitError extends Error {}

export type WorkbookCell = {
  address: string;
  /** Physical 1-based row, from the cell's own `r` reference. */
  row: number;
  /** Physical 1-based column, from the cell's own `r` reference. */
  column: number;
  /**
   * The INTERPRETED text: a shared or inline string, a boolean word, a plain
   * number, or an ISO date when the cell's style says the serial is a date.
   */
  text: string;
  /** The formula source, without a leading `=`. Null when there is none. */
  formula: string | null;
  /**
   * The RAW stored value, exactly as the file carries it, before any date or
   * number interpretation. `null` means the cell stored NO value at all —
   * which, on a cell that carries a formula, is the difference between "the
   * spreadsheet computed 0" and "nobody ever computed this". Reading those two
   * as the same thing is how a never-opened workbook becomes a column of zeros.
   */
  cachedValue: string | null;
  styleIndex: number | null;
  /** Explicit ARGB/RGB fill, uppercase, when the workbook stores one. */
  fillRgb: string | null;
  /**
   * Theme fill index when the fill is a theme reference. A cell with a theme
   * fill and no `fillRgb` still carries visual evidence; dropping it silently
   * would under-report what a human marked in the source.
   */
  fillTheme: number | null;
};

export type WorkbookSheet = {
  /**
   * The worksheet name EXACTLY as the file spells it — a trailing space
   * included. Matching normalises; lineage keeps the source spelling.
   */
  name: string;
  /** 1-based position in the workbook's own sheet order. */
  index: number;
  state: "visible" | "hidden" | "veryHidden";
  cells: WorkbookCell[];
  mergedRanges: string[];
  maxRow: number;
  maxColumn: number;
};

export type ParsedWorkbook = {
  dateSystem: "1900" | "1904";
  sheets: WorkbookSheet[];
};

/** Tracks how much expanded XML one workbook has been allowed to produce. */
function budget() {
  let remaining: number = XLSX_LIMITS.totalBytes;
  return {
    take(bytes: number, what: string) {
      if (bytes > XLSX_LIMITS.partBytes || bytes > remaining) {
        throw new XlsxLimitError(
          "El archivo Excel es demasiado grande al descomprimirse (" + what + "). " +
            "Divídelo en archivos más pequeños o exporta solo las columnas que necesitas.",
        );
      }
      remaining -= bytes;
    },
  };
}

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
  if (items.length > XLSX_LIMITS.sharedStrings) {
    throw new XlsxLimitError(
      "El archivo Excel contiene demasiado texto distinto para procesarlo (" +
        items.length + " valores). Reduce el archivo antes de subirlo.",
    );
  }
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

/**
 * Style index -> the fill a cell carries.
 *
 * A fill is either an explicit ARGB/RGB value or a THEME reference with no
 * colour of its own. Both are evidence that a human marked the cell; only the
 * first can be reported as a colour. Recording the theme index separately keeps
 * the mark visible instead of reading it as "no fill", which would silently
 * under-report what the source highlighted.
 *
 * `bgColor` is consulted only when `fgColor` carries nothing: a solid pattern
 * fill stores its colour in `fgColor`, but some writers emit only `bgColor`.
 */
export type StyleFill = { rgb: string | null; theme: number | null };

function parseStyleFills(xml: string | null): Map<number, StyleFill> {
  const result = new Map<number, StyleFill>();
  if (!xml) return result;

  const fillsXml = xml.match(re(`<${P}fills\\b[\\s\\S]*?<\\/${P}fills>`, ""))?.[0];
  const fills: StyleFill[] = [];
  for (const fill of fillsXml?.match(re(`<${P}fill\\b[^>]*\\/>|<${P}fill\\b[^>]*>[\\s\\S]*?<\\/${P}fill>`)) ?? []) {
    const fg = fill.match(re(`<${P}fgColor\\b[^>]*?\\/?>`, ""))?.[0] ?? "";
    const bg = fill.match(re(`<${P}bgColor\\b[^>]*?\\/?>`, ""))?.[0] ?? "";
    const rgb =
      fg.match(/\brgb="([0-9A-Fa-f]{6,8})"/)?.[1] ??
      bg.match(/\brgb="([0-9A-Fa-f]{6,8})"/)?.[1] ??
      null;
    const themeRaw = fg.match(/\btheme="(\d+)"/)?.[1] ?? bg.match(/\btheme="(\d+)"/)?.[1];
    fills.push({
      rgb: rgb ? rgb.toUpperCase() : null,
      theme: themeRaw === undefined ? null : Number(themeRaw),
    });
  }

  const cellXfs = xml.match(re(`<${P}cellXfs\\b[\\s\\S]*?<\\/${P}cellXfs>`, ""))?.[0];
  const entries = cellXfs?.match(re(`<${P}xf\\b[^>]*\\/>|<${P}xf\\b[^>]*>[\\s\\S]*?<\\/${P}xf>`)) ?? [];
  entries.forEach((entry, styleIndex) => {
    const fillId = Number(entry.match(/\bfillId="(\d+)"/)?.[1] ?? "0");
    const fill = fills[fillId];
    if (fill && (fill.rgb !== null || fill.theme !== null)) result.set(styleIndex, fill);
  });
  return result;
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

type SheetCell = {
  column: number;
  text: string;
  formula: string | null;
  cachedValue: string | null;
  styleIndex: number | null;
  fillRgb: string | null;
  fillTheme: number | null;
};

/**
 * Counts cells across a WHOLE workbook. `readXlsx` reads one sheet, so its
 * counter was per-sheet by construction; the multi-sheet reader must not let a
 * thousand small sheets slip past a ceiling written for one large one.
 */
type CellCounter = { count: number };

/**
 * What the CANONICAL reader needs and the LEGACY reader must not get.
 *
 * `retainEvidenceOnlyCells` is the load-bearing one. `readXlsx` has always kept
 * a cell only when it had text, and its header row's width is the last cell it
 * kept. Both real source workbooks style entire empty grids
 * (`<c r="A1" s="5"/>`), so keeping those would extend the header row with
 * empty names — and `sourceSignature()` refuses a header set with an empty or
 * duplicated name. An import that works today would start failing. The
 * canonical reader wants exactly those cells, as style evidence, so the
 * behaviour is opt-in rather than shared.
 */
type SheetParseOptions = {
  styleFills?: Map<number, StyleFill>;
  counter?: CellCounter;
  retainEvidenceOnlyCells?: boolean;
};

function parseSheet(
  xml: string,
  shared: string[],
  dateStyles: Set<number>,
  use1904: boolean,
  options: SheetParseOptions = {},
): SheetCell[][] {
  const styleFills = options.styleFills ?? new Map<number, StyleFill>();
  const counter = options.counter ?? { count: 0 };
  const retainEvidenceOnlyCells = options.retainEvidenceOnlyCells ?? false;
  const rows: SheetCell[][] = [];
  const rowMatches = xml.match(re(`<${P}row\\b[^>]*\\/>|<${P}row\\b[^>]*>[\\s\\S]*?<\\/${P}row>`)) ?? [];
  for (const rowXml of rowMatches) {
    const rowNumber = Number(rowXml.match(/\br="(\d+)"/)?.[1] ?? "0");
    if (rowNumber <= 0) continue;
    if (rowNumber > XLSX_LIMITS.rows) {
      throw new XlsxLimitError(
        "El archivo Excel tiene más de " + XLSX_LIMITS.rows +
          " filas. Divídelo antes de subirlo.",
      );
    }
    const cells: SheetCell[] = [];
    // Self-closing cells MUST be matched first. A lazy `<c …>…</c>` would run
    // past `<c r="W3"/>` to the NEXT cell's closing tag and attribute that
    // cell's value to the empty one, shifting every later column.
    const cellMatches = rowXml.match(re(`<${P}c\\b[^>]*\\/>|<${P}c\\b[^>]*>[\\s\\S]*?<\\/${P}c>`)) ?? [];
    let fallbackColumn = 0;
    for (const cellXml of cellMatches) {
      const reference = cellXml.match(/\br="([A-Z]+\d+)"/)?.[1];
      const column = reference ? columnIndex(reference) : fallbackColumn;
      if (column < 0 || column >= XLSX_LIMITS.columns) {
        throw new XlsxLimitError(
          "El archivo Excel tiene más de " + XLSX_LIMITS.columns +
            " columnas. Exporta solo las columnas que necesitas.",
        );
      }
      counter.count += 1;
      if (counter.count > XLSX_LIMITS.cells) {
        throw new XlsxLimitError(
          "El archivo Excel tiene demasiadas celdas con contenido. " +
            "Divídelo antes de subirlo.",
        );
      }
      fallbackColumn = column + 1;
      const type = cellXml.match(/\bt="([^"]+)"/)?.[1] ?? "n";
      const styleIndex = Number(cellXml.match(/\bs="(\d+)"/)?.[1] ?? "-1");
      const formulaRaw = cellXml.match(re(`<${P}f\\b[^>]*>([\\s\\S]*?)<\\/${P}f>`, ""))?.[1];
      const formula = formulaRaw === undefined ? null : decodeXml(formulaRaw);

      let text = "";
      // The RAW stored token, kept apart from the interpretation below. A cell
      // that stored nothing keeps `null`, which is what separates a formula
      // nobody ever evaluated from a formula that genuinely produced "".
      let cachedValue: string | null = null;
      if (type === "inlineStr") {
        const runs = [...cellXml.matchAll(re(`<${P}t\\b[^>]*>([\\s\\S]*?)<\\/${P}t>`))];
        if (runs.length > 0) cachedValue = runs.map((m) => decodeXml(m[1])).join("");
        text = cachedValue ?? "";
      } else {
        const raw = cellXml.match(re(`<${P}v\\b[^>]*>([\\s\\S]*?)<\\/${P}v>`, ""))?.[1];
        if (raw !== undefined) cachedValue = decodeXml(raw);
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
      const fill = styleFills.get(styleIndex);
      // A cell with no text still carries evidence when it has a formula or a
      // style. The legacy reader drops it, exactly as it always has.
      const carriesEvidenceOnly = formula !== null || styleIndex >= 0;
      if (text !== "" || (retainEvidenceOnlyCells && carriesEvidenceOnly)) {
        cells.push({
          column,
          text,
          formula,
          cachedValue,
          styleIndex: styleIndex >= 0 ? styleIndex : null,
          fillRgb: fill?.rgb ?? null,
          fillTheme: fill?.theme ?? null,
        });
      }
    }
    rows[rowNumber - 1] = cells;
  }
  return rows;
}

type ZipEntry = {
  async(kind: "string"): Promise<string>;
  /** JSZip records the declared expanded size here. Absent on some entries. */
  _data?: { uncompressedSize?: number };
};
type ZipLike = { file(path: string): ZipEntry | null };

function relationshipTarget(target: string): string {
  const withoutRoot = target.replace(/^\//, "");
  return withoutRoot.startsWith("xl/") ? withoutRoot : `xl/${withoutRoot}`;
}

/**
 * The relationship id of a `<sheet>` element.
 *
 * The attribute is conventionally `r:id`, but `r` is only the prefix a writer
 * happened to bind to the relationships namespace: `<x:sheet rel:id="rId1"/>`
 * is equally valid. The prefix is therefore optional here. `sheetId` must NOT
 * match — it is an unrelated internal number, and reading it as a relationship
 * id would resolve every sheet to nothing.
 */
function relationshipId(element: string): string | null {
  return element.match(/[\s"'](?:[A-Za-z0-9_.-]+:)?id="([^"]+)"/)?.[1] ?? null;
}

/** Reads `<Relationship Id=… Target=…/>` in any attribute order. */
function relationshipMap(relsXml: string): Map<string, string> {
  const relationships = new Map<string, string>();
  for (const element of relsXml.match(/<Relationship\b[^>]*?\/?>/g) ?? []) {
    const id = element.match(/\bId="([^"]+)"/)?.[1];
    const target = element.match(/\bTarget="([^"]+)"/)?.[1];
    if (id && target) relationships.set(id, relationshipTarget(target));
  }
  return relationships;
}

/** `state="hidden"` on a `<sheet>`; anything unrecognised reads as visible. */
function sheetState(element: string): WorkbookSheet["state"] {
  const raw = element.match(/\bstate="([^"]+)"/)?.[1];
  if (raw === "hidden") return "hidden";
  if (raw === "veryHidden") return "veryHidden";
  return "visible";
}

function columnLetters(index: number): string {
  let value = index + 1;
  let letters = "";
  while (value > 0) {
    const remainder = (value - 1) % 26;
    letters = String.fromCharCode(65 + remainder) + letters;
    value = Math.floor((value - 1) / 26);
  }
  return letters;
}

/**
 * Read one part of the workbook, against a shared expansion budget.
 *
 * The DECLARED size is checked first, so a zip bomb is refused before it is
 * expanded rather than after the isolate has already died allocating it. The
 * declaration is only a claim, so the produced string is measured too.
 */
async function entryText(zip: ZipLike, path: string, take: (bytes: number, what: string) => void) {
  const entry = zip.file(path);
  if (!entry) return null;
  const declared = entry._data?.uncompressedSize;
  if (typeof declared === "number" && Number.isFinite(declared)) take(declared, path);
  const text = await entry.async("string");
  // Counted whether or not a declaration was available, and never twice for the
  // same part: a declared part costs the larger of the two, which is the honest
  // figure for what this workbook was allowed to expand to.
  if (typeof declared === "number" && Number.isFinite(declared)) {
    if (text.length > declared) take(text.length - declared, path);
  } else {
    take(text.length, path);
  }
  return text;
}

export async function readXlsx(buffer: ArrayBuffer): Promise<ParsedFile> {
  const { default: JSZip } = await import("jszip");
  // A .xlsx that is not a ZIP fails deep inside the library with an English,
  // technical message. An operator who picked the wrong file needs a sentence,
  // not a stack trace.
  let zip;
  try {
    zip = await JSZip.loadAsync(buffer);
  } catch {
    throw new Error("El archivo no es un .xlsx válido. Vuelve a exportarlo desde Excel y súbelo de nuevo.");
  }
  const { take } = budget();

  const workbookXml = await entryText(zip, "xl/workbook.xml", take);
  if (!workbookXml) throw new Error("El archivo Excel no tiene un libro legible.");
  const use1904 = /date1904="(1|true)"/i.test(workbookXml);

  // Relationship attributes appear in any order, so each element is read whole
  // rather than assuming `Id` precedes `Target`.
  const relsXml = (await entryText(zip, "xl/_rels/workbook.xml.rels", take)) ?? "";
  const relationships = relationshipMap(relsXml);

  const firstSheet = workbookXml.match(
    re(`<${P}sheet\\b[^>]*\\/?>`, ""),
  )?.[0];
  if (!firstSheet) throw new Error("El archivo Excel no tiene hojas.");
  // The `|| "worksheets/sheet1.xml"` fallback is the LEGACY behaviour and is
  // preserved exactly: this reader has always read the first worksheet, and a
  // file whose relationship cannot be resolved still reads sheet 1 rather than
  // failing an import that used to work.
  const rId = relationshipId(firstSheet);
  const target = (rId && relationships.get(rId)) || relationshipTarget("worksheets/sheet1.xml");

  const sheetXml = await entryText(zip, target, take);
  if (!sheetXml) throw new Error("El archivo Excel no tiene hojas.");

  const shared = parseSharedStrings(await entryText(zip, "xl/sharedStrings.xml", take));
  const dateStyles = parseDateStyles(await entryText(zip, "xl/styles.xml", take));
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

/**
 * Coordinate-preserving workbook reader for canonical multi-file packages.
 * Unlike `readXlsx`, it reads every worksheet and does not assume a header row.
 * Formula text and cached values remain separate, and explicit fills/merges are
 * retained as source evidence rather than interpreted here.
 */
export async function readXlsxWorkbook(buffer: ArrayBuffer): Promise<ParsedWorkbook> {
  const { default: JSZip } = await import("jszip");
  let zip;
  try {
    zip = await JSZip.loadAsync(buffer);
  } catch {
    throw new Error("El archivo no es un .xlsx válido. Vuelve a exportarlo desde Excel y súbelo de nuevo.");
  }
  const { take } = budget();
  const workbookXml = await entryText(zip, "xl/workbook.xml", take);
  if (!workbookXml) throw new Error("El archivo Excel no tiene un libro legible.");
  const use1904 = /date1904="(1|true)"/i.test(workbookXml);

  const relsXml = (await entryText(zip, "xl/_rels/workbook.xml.rels", take)) ?? "";
  const relationships = relationshipMap(relsXml);

  const shared = parseSharedStrings(await entryText(zip, "xl/sharedStrings.xml", take));
  const stylesXml = await entryText(zip, "xl/styles.xml", take);
  const dateStyles = parseDateStyles(stylesXml);
  const styleFills = parseStyleFills(stylesXml);
  const sheets: WorkbookSheet[] = [];
  // One counter for the whole workbook. Per-sheet counting would let a file
  // with five hundred small sheets expand past a ceiling meant to bound the
  // isolate's memory, which is the failure mode this refusal exists to stop.
  const counter: CellCounter = { count: 0 };

  const sheetElements = workbookXml.match(re(`<${P}sheet\\b[^>]*\\/?>`)) ?? [];
  if (sheetElements.length > XLSX_LIMITS.sheets) {
    throw new XlsxLimitError(
      "El archivo Excel tiene más de " + XLSX_LIMITS.sheets +
        " hojas. Divídelo antes de subirlo.",
    );
  }

  for (const [position, sheetElement] of sheetElements.entries()) {
    const nameRaw = sheetElement.match(/\bname="([^"]+)"/)?.[1];
    if (!nameRaw) {
      throw new Error(
        `La hoja en la posición ${position + 1} no tiene nombre. ` +
          "Vuelve a exportar el archivo desde Excel.",
      );
    }
    const name = decodeXml(nameRaw);
    const rId = relationshipId(sheetElement);
    // A missing relationship is NOT a reason to skip the sheet: dropping it
    // silently would report "falta la hoja X" for a file that does contain X.
    // The ordinal part is the documented default layout; if it is absent too,
    // the file is refused by name.
    const target =
      (rId ? relationships.get(rId) : undefined) ??
      relationshipTarget(`worksheets/sheet${position + 1}.xml`);
    const sheetXml = await entryText(zip, target, take);
    if (!sheetXml) throw new Error(`La hoja '${name}' no se pudo leer.`);

    const parsedRows = parseSheet(sheetXml, shared, dateStyles, use1904, {
      styleFills,
      counter,
      retainEvidenceOnlyCells: true,
    });
    const cells: WorkbookCell[] = [];
    let maxColumn = 0;
    parsedRows.forEach((row, rowIndex) => {
      for (const cell of row ?? []) {
        maxColumn = Math.max(maxColumn, cell.column + 1);
        cells.push({
          address: `${columnLetters(cell.column)}${rowIndex + 1}`,
          row: rowIndex + 1,
          column: cell.column + 1,
          text: cell.text,
          formula: cell.formula,
          cachedValue: cell.cachedValue,
          styleIndex: cell.styleIndex,
          fillRgb: cell.fillRgb,
          fillTheme: cell.fillTheme,
        });
      }
    });
    const mergedRanges = [...sheetXml.matchAll(re(`<${P}mergeCell\\b[^>]*\\bref="([^"]+)"`))]
      .map((match) => match[1]);
    sheets.push({
      name,
      index: position + 1,
      state: sheetState(sheetElement),
      cells,
      mergedRanges,
      maxRow: parsedRows.length,
      maxColumn,
    });
  }

  if (sheets.length === 0) throw new Error("El archivo Excel no tiene hojas.");
  return { dateSystem: use1904 ? "1904" : "1900", sheets };
}
