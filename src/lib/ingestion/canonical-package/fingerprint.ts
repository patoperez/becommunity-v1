import type { ParsedWorkbook } from "../xlsx-reader";
import { normalizeWhitespace } from "./values";

/**
 * Content identity for a canonical package.
 *
 * A FILE NAME IS NOT AN IDENTITY. "Datos limpio estudio Cuicuilco (2).xlsx",
 * "copia de datos.xlsx" and a re-download of the same export are the same
 * bytes; two entirely different studies can arrive under the same name. So
 * identity here is derived from content and from the semantic role the
 * structure resolved to, never from what the operator called the file or the
 * order in which the browser handed the files over.
 *
 * Everything is `sha256:<64 hex>`, the exact shape migration 0022 enforces on
 * `source_asset.sha256` and `import_job.idempotency_key`.
 */

function toHex(digest: ArrayBuffer): string {
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function digestOf(bytes: BufferSource): Promise<string> {
  return `sha256:${toHex(await crypto.subtle.digest("SHA-256", bytes))}`;
}

/** SHA-256 of the exact uploaded bytes. */
export async function fileHash(bytes: ArrayBuffer): Promise<string> {
  return digestOf(bytes);
}

async function digestOfText(value: string): Promise<string> {
  return digestOf(new TextEncoder().encode(value));
}

/**
 * The SHAPE of a workbook: its sheet names, normalised and sorted.
 *
 * Stable across re-exports of the same instrument even when a respondent is
 * added, so it can be compared to a previous import to answer "is this the
 * same kind of file?". It is EVIDENCE in the preflight; role resolution is
 * decided by the specification's required sheets, not by matching this hash
 * against a hard-coded constant that a legitimate new sheet would break.
 */
export async function sheetSignature(workbook: ParsedWorkbook): Promise<string> {
  const names = workbook.sheets.map((sheet) => normalizeWhitespace(sheet.name)).sort();
  return digestOfText(JSON.stringify(names));
}

/**
 * The shape PLUS its extents, which identifies one particular export.
 *
 * Two exports of the same workbook taken a week apart differ here, which is
 * what makes this useful for telling an operator that the file they uploaded
 * is not the file they uploaded last time.
 */
export async function structuralSignature(workbook: ParsedWorkbook): Promise<string> {
  const shape = workbook.sheets
    .map((sheet) => ({
      name: normalizeWhitespace(sheet.name),
      maxRow: sheet.maxRow,
      maxColumn: sheet.maxColumn,
      mergedRanges: sheet.mergedRanges.length,
    }))
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return digestOfText(JSON.stringify({ dateSystem: workbook.dateSystem, sheets: shape }));
}

/**
 * The package's idempotency key.
 *
 * Built from the mapping version, the semantic roles and the file hashes,
 * SORTED BY ROLE. Sorting is what makes the key independent of the order the
 * two files were selected in: the same package uploaded the other way round is
 * the same package, and a retry must not create a second import job.
 */
export async function packageIdempotencyKey(
  specId: string,
  mappingVersion: number,
  assets: Array<{ role: string; sha256: string }>,
): Promise<string> {
  const canonical = JSON.stringify({
    spec: specId,
    mappingVersion,
    assets: [...assets]
      .map(({ role, sha256 }) => ({ role, sha256 }))
      .sort((a, b) => (a.role < b.role ? -1 : a.role > b.role ? 1 : 0)),
  });
  return digestOfText(canonical);
}
