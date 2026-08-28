import Papa from "papaparse";
import type { ParsedFile, RawRow } from "./canonical";
import { readXlsx } from "./xlsx-reader";

/**
 * File parsing — turns CSV/XLSX bytes into a neutral { headers, rows } shape.
 * This is deliberately format-agnostic and has no knowledge of the canonical
 * schema; the adapter (next layer) does the mapping (§2).
 *
 * RUNTIME CONSTRAINT — this module must stay evaluable on workerd.
 *
 * It once imported ExcelJS statically. ExcelJS's Node entry pulls in
 * unzipper -> fstream, and fstream evaluates `process.umask()` at MODULE LOAD
 * time; on Cloudflare Workers unenv throws there, which made this whole module —
 * and with it every ingestion Server Action — impossible to evaluate, breaking
 * CSV uploads too. ExcelJS is no longer used at all: XLSX is read by
 * `./xlsx-reader`, which needs only JSZip and string parsing.
 * scripts/workers-ingestion-runtime-test.mjs fails the build if ExcelJS ever
 * becomes reachable from this path again.
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

/**
 * XLSX is read by the project's own SpreadsheetML reader (`./xlsx-reader`).
 *
 * It used to be read with ExcelJS. Under workerd, ExcelJS's `xlsx.load`
 * poisons the isolate: two requests succeed and the third never settles, so the
 * runtime cancels the request and answers HTTP 500 — which is what an operator
 * saw as "confirmar" failing after analyze and preview had both worked. The
 * reader documents the reproduction in full. It uses only JSZip and string
 * parsing, both of which were verified safe across requests on real workerd.
 */

export async function parseXlsx(buffer: ArrayBuffer): Promise<ParsedFile> {
  // `readXlsx` already preserves physical column positions, including blank
  // headers: compressing a gap would silently associate every later header with
  // the wrong cell. Headers are trimmed here so CSV and XLSX agree exactly.
  const { headers, rows } = await readXlsx(buffer);
  return { headers: normalizeHeaders(headers), rows };
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
