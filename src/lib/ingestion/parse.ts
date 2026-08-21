import Papa from "papaparse";
import ExcelJS from "exceljs";
import type { ParsedFile, RawRow } from "./canonical";

/**
 * File parsing — turns CSV/XLSX bytes into a neutral { headers, rows } shape.
 * This is deliberately format-agnostic and has no knowledge of the canonical
 * schema; the adapter (next layer) does the mapping (§2).
 */

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

export async function parseXlsx(buffer: ArrayBuffer): Promise<ParsedFile> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
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
