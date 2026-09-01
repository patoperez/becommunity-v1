import type { ParsedWorkbook, WorkbookCell, WorkbookSheet } from "../xlsx-reader";
import { normalizeLoose, normalizeWhitespace } from "./values";

/**
 * A coordinate-addressable view over a parsed workbook.
 *
 * The reader hands back cells in document order. Everything the preflight does
 * is positional — "what is in B6", "how many rows below row 2 carry an
 * identifier" — so the cells are indexed once, by physical row and column, and
 * never searched linearly per question.
 *
 * NAMES. `name` is the source spelling and is what lineage records; a trailing
 * space in a real worksheet name is part of that spelling and is preserved.
 * `normalizedName` collapses whitespace and is the ONLY form matching may use.
 * Case and accents are NOT normalised: `Desempeño` and `desempeno` are
 * different sheets until a human says otherwise, and quietly equating them is
 * how a package silently binds to the wrong source.
 */

/** `1 -> "A"`, `27 -> "AA"`. Input is the physical 1-based column. */
export function columnLetters(column: number): string {
  let value = column;
  let letters = "";
  while (value > 0) {
    const remainder = (value - 1) % 26;
    letters = String.fromCharCode(65 + remainder) + letters;
    value = Math.floor((value - 1) / 26);
  }
  return letters;
}

/** `"A" -> 1`, `"AA" -> 27`. Returns 0 for anything that is not column letters. */
export function columnNumber(letters: string): number {
  if (!/^[A-Z]+$/.test(letters)) return 0;
  let value = 0;
  for (const letter of letters) value = value * 26 + (letter.charCodeAt(0) - 64);
  return value;
}

/** Inclusive list of column letters from `from` to `to`. Empty when reversed. */
export function columnRange(from: string, to: string): string[] {
  const start = columnNumber(from);
  const end = columnNumber(to);
  if (start === 0 || end === 0 || end < start) return [];
  const out: string[] = [];
  for (let column = start; column <= end; column++) out.push(columnLetters(column));
  return out;
}

export class SheetView {
  readonly name: string;
  readonly normalizedName: string;
  readonly index: number;
  readonly state: WorkbookSheet["state"];
  readonly maxRow: number;
  readonly maxColumn: number;
  readonly mergedRanges: readonly string[];
  readonly cells: readonly WorkbookCell[];
  /** `row << 16 | column` is not used: columns can exceed 16 bits in theory. */
  private readonly byPosition: Map<string, WorkbookCell>;

  constructor(sheet: WorkbookSheet) {
    this.name = sheet.name;
    this.normalizedName = normalizeWhitespace(sheet.name);
    this.index = sheet.index;
    this.state = sheet.state;
    this.maxRow = sheet.maxRow;
    this.maxColumn = sheet.maxColumn;
    this.mergedRanges = sheet.mergedRanges;
    this.cells = sheet.cells;
    this.byPosition = new Map();
    for (const cell of sheet.cells) this.byPosition.set(`${cell.row}:${cell.column}`, cell);
  }

  cell(row: number, column: number): WorkbookCell | null {
    return this.byPosition.get(`${row}:${column}`) ?? null;
  }

  cellAt(address: string): WorkbookCell | null {
    const match = address.match(/^([A-Z]+)(\d+)$/);
    if (!match) return null;
    return this.cell(Number(match[2]), columnNumber(match[1]));
  }

  /** The cell's text, or `""` when the cell does not exist at all. */
  textAt(address: string): string {
    return this.cellAt(address)?.text ?? "";
  }

  textAtRc(row: number, column: number): string {
    return this.cell(row, column)?.text ?? "";
  }

  /** Cells physically present on one row, ordered by column. */
  row(rowNumber: number): WorkbookCell[] {
    return this.cells.filter((cell) => cell.row === rowNumber).sort((a, b) => a.column - b.column);
  }

  populatedCells(): number {
    return this.cells.filter((cell) => cell.text !== "").length;
  }
}

export class WorkbookView {
  readonly dateSystem: ParsedWorkbook["dateSystem"];
  readonly sheets: readonly SheetView[];
  private readonly byNormalizedName: Map<string, SheetView[]>;

  constructor(workbook: ParsedWorkbook) {
    this.dateSystem = workbook.dateSystem;
    this.sheets = workbook.sheets.map((sheet) => new SheetView(sheet));
    this.byNormalizedName = new Map();
    for (const sheet of this.sheets) {
      const existing = this.byNormalizedName.get(sheet.normalizedName);
      if (existing) existing.push(sheet);
      else this.byNormalizedName.set(sheet.normalizedName, [sheet]);
    }
  }

  /**
   * The single sheet whose normalised name matches, or null.
   *
   * Two sheets normalising to the same name return null rather than the first:
   * a package that cannot say WHICH sheet it means must not be bound to one of
   * them silently. `duplicateNames()` reports the collision as a blocker.
   */
  sheet(expectedName: string): SheetView | null {
    const matches = this.byNormalizedName.get(normalizeWhitespace(expectedName));
    return matches && matches.length === 1 ? matches[0] : null;
  }

  duplicateNames(): string[] {
    return [...this.byNormalizedName.entries()]
      .filter(([, sheets]) => sheets.length > 1)
      .map(([name]) => name)
      .sort();
  }

  /**
   * A sheet that would have matched if case and accents were ignored.
   *
   * Only used to make a "falta la hoja" message actionable — never to bind. An
   * operator who exported `desempeno` instead of `Desempeño` gets told exactly
   * that, instead of a bare count mismatch three checks later.
   */
  nearMiss(expectedName: string): SheetView | null {
    const wanted = normalizeLoose(expectedName);
    return this.sheets.find((sheet) => normalizeLoose(sheet.name) === wanted) ?? null;
  }
}
