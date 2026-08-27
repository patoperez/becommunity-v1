import Papa from "papaparse";
import type { ParsedFile, RawRow } from "./canonical";

/**
 * File parsing — turns CSV/XLSX bytes into a neutral { headers, rows } shape.
 * This is deliberately format-agnostic and has no knowledge of the canonical
 * schema; the adapter (next layer) does the mapping (§2).
 *
 * RUNTIME CONSTRAINT — DO NOT import ExcelJS at module scope.
 *
 * ExcelJS's Node entry pulls in unzipper -> fstream, and fstream/lib/writer.js
 * evaluates `process.umask()` at MODULE LOAD time. On Cloudflare Workers
 * `process.platform` is not "win32", so that call runs and unenv throws
 * `[unenv] process.umask is not implemented yet!`. A static import therefore
 * made this whole module — and with it the ingestion Server Actions
 * (analyze/preview/confirm/rollback) — impossible to evaluate in production,
 * breaking CSV uploads even though CSV never needs ExcelJS.
 *
 * ExcelJS is consequently loaded lazily, inside the XLSX branch only. Keep it
 * that way: scripts/workers-ingestion-runtime-test.mjs fails the build if it
 * ever becomes reachable from the CSV path again.
 */

/** Shown to the user when the XLSX reader cannot run in the current runtime. */
export const XLSX_UNAVAILABLE_MESSAGE =
  "El formato Excel (.xlsx/.xlsm) no está disponible en este entorno de ejecución. " +
  "Exporta la hoja como CSV (UTF-8) y vuelve a intentarlo.";

function normalizeHeaders(headers: string[]): string[] {
  return headers.map((h) => (h ?? "").trim());
}

export function parseCsv(text: string): ParsedFile {
  const result = Papa.parse<Record<string, string>>(text, {
    header: true,
    skipEmptyLines: "greedy",
    transformHeader: (h) => h.trim(),
  });

  // Papa surfaces structural problems (e.g. ragged rows) here.
  const fatal = result.errors.find((e) => e.type === "Delimiter" || e.code === "MissingQuotes");
  if (fatal) {
    throw new Error(`CSV malformado: ${fatal.message}`);
  }

  const headers = normalizeHeaders(result.meta.fields ?? []);
  const rows: RawRow[] = (result.data ?? []).map((row) => {
    const clean: RawRow = {};
    for (const h of headers) clean[h] = String(row[h] ?? "");
    return clean;
  });
  return { headers, rows };
}

type ExcelJsModule = typeof import("exceljs");

const SPREADSHEET_NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";

/**
 * Some standards-compliant writers use an explicit `x:` prefix for the main
 * SpreadsheetML namespace. ExcelJS 4's SAX reader only recognizes the same
 * elements when that namespace is the default, and otherwise fails before it
 * can even find `workbook.sheets`. Normalize only that known namespace and only
 * after the ordinary reader fails. Some of those writers also emit absolute
 * table relationships that ExcelJS cannot resolve. Tables are presentation
 * metadata for this read-only ingestion path, so their worksheet references are
 * removed while every cell value and formula remains unchanged.
 */
async function normalizePrefixedSpreadsheetXml(buffer: ArrayBuffer): Promise<ArrayBuffer | null> {
  const { default: JSZip } = await import("jszip");
  const zip = await JSZip.loadAsync(buffer);
  const targets = Object.values(zip.files).filter((entry) => !entry.dir && entry.name.endsWith(".xml"));
  let changed = false;
  await Promise.all(targets.map(async (entry) => {
    const xml = await entry.async("string");
    let normalized = xml;
    if (normalized.includes(`xmlns:x="${SPREADSHEET_NS}"`)) {
      normalized = normalized
        .replace(`xmlns:x="${SPREADSHEET_NS}"`, `xmlns="${SPREADSHEET_NS}"`)
        .replace(/(<\/?)(?:x):/g, "$1");
    }
    if (/^xl\/worksheets\/[^/]+\.xml$/.test(entry.name)) {
      normalized = normalized.replace(/<tableParts\b[^>]*>[\s\S]*?<\/tableParts>/g, "");
    }
    if (/^xl\/worksheets\/_rels\/[^/]+\.rels$/.test(entry.name)) {
      normalized = normalized.replace(
        /<Relationship\b(?=[^>]*\bType="[^"]*\/relationships\/table")[^>]*\/>/g,
        "",
      );
    }
    if (normalized !== xml) {
      zip.file(entry.name, normalized);
      changed = true;
    }
  }));
  if (!changed) return null;
  const bytes = await zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

/** Interop: the CJS/UMD builds resolve to { default: module.exports, ...named }. */
function unwrapExcelJs(mod: unknown): ExcelJsModule | null {
  const api = ((mod as { default?: unknown })?.default ?? mod) as ExcelJsModule | undefined;
  return typeof api?.Workbook === "function" ? api : null;
}

/**
 * Load ExcelJS on demand, preferring its prebuilt BROWSER bundle.
 *
 * Verified under workerd (wrangler dev, nodejs_compat, unenv `process.umask`
 * throwing exactly as in production):
 *   - `exceljs/excel.js`          (Node entry) -> throws
 *                                    "[unenv] process.umask is not implemented yet!"
 *   - `exceljs/dist/exceljs.min.js` (browser)  -> loads and parses a real .xlsx
 *
 * The browser bundle is the same library without the Node-only zip/stream stack,
 * and it also works under plain Node, so it is used in both environments. The
 * package entry is kept only as a fallback for a bundler that cannot resolve the
 * dist path; a failure of BOTH is a runtime-capability problem, not a problem
 * with the user's file, so it surfaces as an actionable message.
 */
async function loadExcelJs(): Promise<ExcelJsModule> {
  try {
    const browserBuild = unwrapExcelJs(await import("exceljs/dist/exceljs.min.js"));
    if (browserBuild) return browserBuild;
  } catch {
    // fall through to the package entry
  }
  try {
    const packageEntry = unwrapExcelJs(await import("exceljs"));
    if (packageEntry) return packageEntry;
  } catch {
    // fall through to the controlled error
  }
  throw new Error(XLSX_UNAVAILABLE_MESSAGE);
}

export async function parseXlsx(buffer: ArrayBuffer): Promise<ParsedFile> {
  const ExcelJS = await loadExcelJs();
  let workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(buffer);
  } catch (originalError) {
    const normalized = await normalizePrefixedSpreadsheetXml(buffer).catch(() => null);
    if (!normalized) throw originalError;
    workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(normalized);
  }
  const sheet = workbook.worksheets[0];
  if (!sheet) throw new Error("El archivo Excel no tiene hojas.");

  const headerRow = sheet.getRow(1);
  // Preserve physical column positions, including blank headers. Compressing a
  // gap here would silently associate every later header with the wrong cell.
  const cleanHeaders = normalizeHeaders(
    Array.from({ length: headerRow.cellCount }, (_, index) =>
      String(headerRow.getCell(index + 1).text ?? "").trim(),
    ),
  );

  const rows: RawRow[] = [];
  for (let r = 2; r <= sheet.rowCount; r++) {
    const row = sheet.getRow(r);
    const obj: RawRow = {};
    let hasValue = false;
    cleanHeaders.forEach((h, i) => {
      const cell = row.getCell(i + 1);
      const text = String(cell?.text ?? "").trim();
      obj[h] = text;
      if (text !== "") hasValue = true;
    });
    if (hasValue) rows.push(obj);
  }
  return { headers: cleanHeaders, rows };
}

export async function parseFile(filename: string, buffer: ArrayBuffer): Promise<ParsedFile> {
  const ext = filename.toLowerCase().split(".").pop();
  if (ext === "csv" || ext === "txt") {
    return parseCsv(new TextDecoder("utf-8").decode(buffer));
  }
  if (ext === "xlsx" || ext === "xlsm") {
    return parseXlsx(buffer);
  }
  throw new Error(`Formato no soportado: .${ext}. Usa CSV o XLSX.`);
}
