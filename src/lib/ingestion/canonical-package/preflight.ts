import { z } from "zod";
import { MAX_UPLOAD_BYTES, exceedsUploadLimit } from "@/lib/validation/schemas";
import { readXlsxWorkbook } from "../xlsx-reader";
import { fileHash, packageIdempotencyKey, sheetSignature, structuralSignature } from "./fingerprint";
import { SheetView, WorkbookView, columnNumber, columnRange } from "./sheet-view";
import type {
  AssetRoleSpec,
  CanonicalPackageSpec,
  CanonicalSheetSpec,
  ColumnEntitySheetSpec,
  RowRecordSheetSpec,
} from "./spec";
import { CUICUILCO_PACKAGE_SPEC_V1 } from "./spec";
import type {
  AliasCandidate,
  CanonicalPackagePreflight,
  ExpectationResult,
  FindingSeverity,
  FormulaReconciliation,
  PreflightAsset,
  PreflightFinding,
  PreflightSheet,
  VisualEvidence,
} from "./types";
import type { AbsenceState } from "./values";
import { classifySourceValue, isPopulated, normalizeToken, normalizeWhitespace } from "./values";

/**
 * Deterministic, privacy-safe preflight for a canonical multi-file package.
 *
 * WHAT THIS UNIT DOES: read every uploaded workbook, resolve each file to a
 * semantic role by its STRUCTURE, verify the anchors and counts the approved
 * mapping declares, and hand back one serialisable report.
 *
 * WHAT THIS UNIT DOES NOT DO: touch the database. There is no Supabase client
 * in this module, no insert, no RPC and no write of any kind. A package can be
 * validated, rejected, re-uploaded and validated again without a single row
 * existing anywhere. The transactional commit is Unit 3, and it is a separate,
 * server-only path that will consume this report.
 *
 * WHY THE OUTPUT LOOKS THE WAY IT DOES. The report is shown on an internal
 * screen, written to logs, and stored on `import_job.error_report`. Anything
 * placed in it is therefore copied into all three, so it carries structure and
 * coordinates and never a respondent's name, an answer, a category value or an
 * identifier. "La hoja CSAT repite 2 identificadores (filas 7 y 19)" tells an
 * operator exactly where to look without moving one private value out of the
 * source workbook.
 */

/** Bounds on what the report may contain, so one bad file cannot produce a novel. */
const LIMITS = {
  files: 8,
  coordinateSamples: 12,
  distinctFills: 24,
  aliasCandidates: 50,
} as const;

export type PreflightFileInput = {
  fileName: string;
  bytes: ArrayBuffer;
};

/**
 * The upload boundary, validated before anything is read.
 *
 * `bytes` is not inspected here beyond its length: the reader owns the
 * expansion ceilings, and it applies them before allocating anything.
 */
const preflightFileSchema = z.object({
  fileName: z
    .string()
    .trim()
    .min(1, "El archivo necesita un nombre.")
    .max(255, "El nombre del archivo es demasiado largo."),
  bytes: z.custom<ArrayBuffer>(
    (value) => value instanceof ArrayBuffer,
    "El contenido del archivo no es legible.",
  ),
});

const preflightInputSchema = z
  .array(preflightFileSchema)
  .min(1, "Sube los archivos del paquete.")
  .max(LIMITS.files, `Un paquete admite como máximo ${LIMITS.files} archivos.`);

const SEVERITY_ORDER: Record<FindingSeverity, number> = { blocker: 0, warning: 1, info: 2 };

class Report {
  readonly findings: PreflightFinding[] = [];
  readonly expectations: ExpectationResult[] = [];

  add(
    severity: FindingSeverity,
    code: string,
    message: string,
    where: {
      assetRole?: string | null;
      sheet?: string | null;
      coordinate?: string | null;
      expected?: number | string | null;
      actual?: number | string | null;
    } = {},
  ): void {
    this.findings.push({
      code,
      severity,
      assetRole: where.assetRole ?? null,
      sheet: where.sheet ?? null,
      coordinate: where.coordinate ?? null,
      message,
      expected: where.expected ?? null,
      actual: where.actual ?? null,
    });
  }

  /**
   * Record an expectation AND, when it fails, the blocker that goes with it.
   *
   * Keeping the two together is deliberate: an expectation that can be listed
   * as unmet without also blocking confirmation is exactly how a count
   * mismatch reaches a commit.
   */
  expect(result: Omit<ExpectationResult, "satisfied">, message: string): boolean {
    const satisfied = result.expected === result.actual;
    this.expectations.push({ ...result, satisfied });
    if (!satisfied) {
      this.add("blocker", result.code, message, {
        assetRole: result.assetRole,
        sheet: result.sheet,
        coordinate: result.coordinate,
        expected: result.expected,
        actual: result.actual,
      });
    }
    return satisfied;
  }
}

/** Deterministic ordering, so two runs over the same bytes are byte-identical. */
function compareStrings(a: string | null, b: string | null): number {
  const left = a ?? "";
  const right = b ?? "";
  return left < right ? -1 : left > right ? 1 : 0;
}

function sortFindings(findings: PreflightFinding[]): PreflightFinding[] {
  return [...findings].sort(
    (a, b) =>
      SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] ||
      compareStrings(a.code, b.code) ||
      compareStrings(a.assetRole, b.assetRole) ||
      compareStrings(a.sheet, b.sheet) ||
      compareStrings(a.coordinate, b.coordinate) ||
      compareStrings(a.message, b.message),
  );
}

function sheetSpecName(sheet: CanonicalSheetSpec): string {
  return sheet.sourceName;
}

/** A short, sorted, bounded coordinate sample an operator can go and open. */
function sampleCoordinates(coordinates: string[]): string[] {
  const address = /^([A-Z]+)(\d+)$/;
  return [...new Set(coordinates)]
    .sort((a, b) => {
      const left = a.match(address);
      const right = b.match(address);
      if (!left || !right) return compareStrings(a, b);
      return columnNumber(left[1]) - columnNumber(right[1]) || Number(left[2]) - Number(right[2]);
    })
    .slice(0, LIMITS.coordinateSamples);
}

function listRows(rows: number[]): string {
  const shown = rows.slice(0, LIMITS.coordinateSamples).join(", ");
  return rows.length > LIMITS.coordinateSamples ? `${shown}…` : shown;
}

// ---------------------------------------------------------------------------
// Role resolution — by structure, never by file name
// ---------------------------------------------------------------------------

type ResolvedAsset = {
  fileName: string;
  sizeBytes: number;
  sha256: string;
  sheetSignature: string;
  structuralSignature: string;
  dateSystem: "1900" | "1904" | null;
  view: WorkbookView | null;
  readError: string | null;
  /** Roles whose required sheets are ALL present in this workbook. */
  candidateRoles: string[];
  role: string | null;
  missingSheets: string[];
  unexpectedSheets: string[];
};

function requiredSheetNames(role: AssetRoleSpec): string[] {
  return role.sheets.map(sheetSpecName);
}

/**
 * Which roles this workbook could be.
 *
 * A role matches when EVERY sheet it requires is present exactly once. That is
 * a structural test: it survives a renamed file, a re-export and an extra sheet
 * somebody added, and it refuses a file that merely looks right by its name.
 */
function candidateRolesFor(view: WorkbookView, spec: CanonicalPackageSpec): string[] {
  return spec.roles
    .filter((role) => requiredSheetNames(role).every((name) => view.sheet(name) !== null))
    .map((role) => role.role);
}

function missingSheetsFor(view: WorkbookView, role: AssetRoleSpec): string[] {
  return requiredSheetNames(role).filter((name) => view.sheet(name) === null);
}

// ---------------------------------------------------------------------------
// Sheet-level structural checks
// ---------------------------------------------------------------------------

/** Physical rows at or below `firstDataRow` whose identity column is populated. */
function recordRows(sheet: SheetView, spec: RowRecordSheetSpec): number[] {
  const column = columnNumber(spec.identityColumn);
  const rows: number[] = [];
  for (let row = spec.firstDataRow; row <= sheet.maxRow; row++) {
    if (isPopulated(sheet.textAtRc(row, column))) rows.push(row);
  }
  return rows;
}

function checkRowRecordSheet(
  report: Report,
  role: string,
  sheet: SheetView,
  spec: RowRecordSheetSpec,
): void {
  // The anchor first. Every count below is meaningless if the header moved,
  // and a shifted header produces a plausible count, not an obvious error.
  const missingHeaders = spec.requiredHeaderColumns.filter(
    (column) => !isPopulated(sheet.textAt(`${column}${spec.headerRow}`)),
  );
  if (missingHeaders.length > 0) {
    report.add(
      "blocker",
      "SHEET_HEADER_ANCHOR_MISSING",
      `La hoja '${sheet.name}' no tiene encabezado en la fila ${spec.headerRow} para ` +
        `${missingHeaders.length} columna(s) requerida(s): ${missingHeaders.join(", ")}. ` +
        "Verifica que la exportación conserve la fila de encabezados esperada.",
      {
        assetRole: role,
        sheet: sheet.name,
        coordinate: `${missingHeaders[0]}${spec.headerRow}`,
        expected: spec.requiredHeaderColumns.length,
        actual: spec.requiredHeaderColumns.length - missingHeaders.length,
      },
    );
  }

  const unexpectedlyFilled = spec.requiredEmptyCells.filter((address) =>
    isPopulated(sheet.textAt(address)),
  );
  if (unexpectedlyFilled.length > 0) {
    report.add(
      "blocker",
      "SHEET_HEADER_ANCHOR_SHIFTED",
      `La hoja '${sheet.name}' tiene contenido en ${unexpectedlyFilled.join(", ")}, que la ` +
        `especificación espera vacío. La fila de encabezados no está en la fila ${spec.headerRow}.`,
      { assetRole: role, sheet: sheet.name, coordinate: unexpectedlyFilled[0] },
    );
  }

  const rows = recordRows(sheet, spec);
  report.expect(
    {
      code: `RECORDS_${spec.key.toUpperCase()}`,
      label: `${spec.label}: registros`,
      assetRole: role,
      sheet: sheet.name,
      coordinate: `${spec.identityColumn}${spec.firstDataRow}`,
      expected: spec.expectedRecords,
      actual: rows.length,
    },
    `La hoja '${sheet.name}' tiene ${rows.length} registro(s) con identificador en la columna ` +
      `${spec.identityColumn}; la especificación espera ${spec.expectedRecords}.`,
  );

  const duplicates = duplicateIdentityRows(sheet, spec);
  if (duplicates.length > 0) {
    report.add(
      "blocker",
      "SHEET_DUPLICATE_IDENTITY",
      `La hoja '${sheet.name}' repite ${duplicates.length} valor(es) en la columna ` +
        `${spec.identityColumn}. Filas afectadas: ${listRows(duplicates.flat())}. ` +
        "Revisa el archivo fuente; el paquete no puede decidir cuál es la correcta.",
      {
        assetRole: role,
        sheet: sheet.name,
        coordinate: spec.identityColumn,
        actual: duplicates.length,
      },
    );
  }
}

/** Groups of rows that share a normalised identity value. Values never leave. */
function duplicateIdentityRows(sheet: SheetView, spec: RowRecordSheetSpec): number[][] {
  const column = columnNumber(spec.identityColumn);
  const seen = new Map<string, number[]>();
  for (const row of recordRows(sheet, spec)) {
    const token = normalizeToken(sheet.textAtRc(row, column));
    const rows = seen.get(token);
    if (rows) rows.push(row);
    else seen.set(token, [row]);
  }
  return [...seen.values()].filter((rows) => rows.length > 1);
}

function checkColumnEntitySheet(
  report: Report,
  role: string,
  sheet: SheetView,
  spec: ColumnEntitySheetSpec,
): void {
  const columns = columnRange(spec.entityColumns.from, spec.entityColumns.to);
  const populated = columns.filter((column) =>
    isPopulated(sheet.textAt(`${column}${spec.entityRow}`)),
  );

  const unexpectedlyFilled = spec.requiredEmptyCells.filter((address) =>
    isPopulated(sheet.textAt(address)),
  );
  if (unexpectedlyFilled.length > 0) {
    report.add(
      "blocker",
      "SHEET_HEADER_ANCHOR_SHIFTED",
      `La hoja '${sheet.name}' tiene contenido en ${unexpectedlyFilled.join(", ")}, que la ` +
        `especificación espera vacío. La fila de rótulos no está en la fila ${spec.entityRow}.`,
      { assetRole: role, sheet: sheet.name, coordinate: unexpectedlyFilled[0] },
    );
  }

  report.expect(
    {
      code: `ENTITIES_${spec.key.toUpperCase()}`,
      label: `${spec.label}: elementos`,
      assetRole: role,
      sheet: sheet.name,
      coordinate: `${spec.entityColumns.from}${spec.entityRow}:${spec.entityColumns.to}${spec.entityRow}`,
      expected: spec.expectedEntities,
      actual: populated.length,
    },
    `La hoja '${sheet.name}' tiene ${populated.length} rótulo(s) en ` +
      `${spec.entityColumns.from}${spec.entityRow}:${spec.entityColumns.to}${spec.entityRow}; ` +
      `la especificación espera ${spec.expectedEntities}.`,
  );

  // An entity with no curated text is NOT a defect: several journey stages and
  // teams carry no pain at all, and inventing one would fabricate a finding.
  const withContent = columns.filter((column) =>
    isPopulated(sheet.textAt(`${column}${spec.contentRow}`)),
  );
  report.add(
    "info",
    "CURATED_CONTENT_PRESENT",
    `La hoja '${sheet.name}' tiene texto curado en ${withContent.length} de ` +
      `${populated.length} elemento(s). Un elemento sin texto no genera ningún hallazgo.`,
    {
      assetRole: role,
      sheet: sheet.name,
      coordinate: `${spec.entityColumns.from}${spec.contentRow}:${spec.entityColumns.to}${spec.contentRow}`,
      expected: populated.length,
      actual: withContent.length,
    },
  );

  const beyond = sheet.maxColumn > columnNumber(spec.entityColumns.to)
    ? sheet.cells.filter(
        (cell) => cell.row === spec.entityRow && cell.column > columnNumber(spec.entityColumns.to) && cell.text !== "",
      )
    : [];
  if (beyond.length > 0) {
    report.add(
      "warning",
      "SHEET_ENTITIES_BEYOND_RANGE",
      `La hoja '${sheet.name}' tiene ${beyond.length} rótulo(s) a la derecha de ` +
        `${spec.entityColumns.to}${spec.entityRow}. La especificación no los mapea; revísalos ` +
        "antes de confirmar.",
      { assetRole: role, sheet: sheet.name, coordinate: beyond[0].address, actual: beyond.length },
    );
  }
}

// ---------------------------------------------------------------------------
// Cross-sheet reconciliations
// ---------------------------------------------------------------------------

type IdentityIndex = Map<string, { rows: number[]; names: Set<string> }>;

function indexIdentities(
  sheet: SheetView,
  spec: RowRecordSheetSpec,
  idColumn: string,
  nameColumn: string | null,
): IdentityIndex {
  const idIndex = columnNumber(idColumn);
  const nameIndex = nameColumn ? columnNumber(nameColumn) : 0;
  const index: IdentityIndex = new Map();
  for (let row = spec.firstDataRow; row <= sheet.maxRow; row++) {
    const raw = sheet.textAtRc(row, idIndex);
    if (!isPopulated(raw)) continue;
    const token = normalizeToken(raw);
    const entry = index.get(token) ?? { rows: [], names: new Set<string>() };
    entry.rows.push(row);
    if (nameIndex > 0) {
      const name = normalizeToken(sheet.textAtRc(row, nameIndex));
      if (name !== "") entry.names.add(name);
    }
    index.set(token, entry);
  }
  return index;
}

function checkIdentity(
  report: Report,
  spec: CanonicalPackageSpec,
  sheetsByKey: Map<string, { role: string; sheet: SheetView; spec: CanonicalSheetSpec }>,
): void {
  const identity = spec.identity;
  const catalogue = sheetsByKey.get(identity.catalogueSheetKey);
  if (!catalogue || catalogue.spec.kind !== "row_records") return;

  const catalogueIndex = indexIdentities(
    catalogue.sheet,
    catalogue.spec,
    identity.catalogueIdColumn,
    identity.catalogueNameColumn,
  );

  report.expect(
    {
      code: "IDENTITY_CATALOGUE_UNIQUE",
      label: "Identidades únicas en el catálogo",
      assetRole: catalogue.role,
      sheet: catalogue.sheet.name,
      coordinate: identity.catalogueIdColumn,
      expected: identity.expectedUniqueIdentities,
      actual: catalogueIndex.size,
    },
    `El catálogo '${catalogue.sheet.name}' tiene ${catalogueIndex.size} identificador(es) único(s); ` +
      `la especificación espera ${identity.expectedUniqueIdentities}.`,
  );

  const cohortIndexes = new Map<string, IdentityIndex>();
  for (const cohort of identity.cohorts) {
    const entry = sheetsByKey.get(cohort.sheetKey);
    if (!entry || entry.spec.kind !== "row_records") continue;
    const index = indexIdentities(entry.sheet, entry.spec, cohort.idColumn, cohort.nameColumn);
    cohortIndexes.set(cohort.cohortKey, index);

    report.expect(
      {
        code: `IDENTITY_COHORT_${cohort.cohortKey.toUpperCase()}`,
        label: `Identidades únicas en la cohorte ${cohort.cohortKey}`,
        assetRole: entry.role,
        sheet: entry.sheet.name,
        coordinate: cohort.idColumn,
        expected: cohort.expected,
        actual: index.size,
      },
      `La cohorte '${cohort.cohortKey}' tiene ${index.size} identificador(es) único(s) en ` +
        `'${entry.sheet.name}'; la especificación espera ${cohort.expected}.`,
    );

    const orphans: number[] = [];
    const nameConflicts: number[] = [];
    for (const [token, record] of index) {
      const catalogued = catalogueIndex.get(token);
      if (!catalogued) {
        orphans.push(...record.rows);
        continue;
      }
      // Names are compared here and DISCARDED here. Only the count and the row
      // numbers survive, which is enough for a human to open the two sheets.
      const disagrees = [...record.names].some((name) => !catalogued.names.has(name));
      if (catalogued.names.size > 0 && record.names.size > 0 && disagrees) {
        nameConflicts.push(...record.rows);
      }
    }

    if (orphans.length > 0) {
      report.add(
        "blocker",
        "IDENTITY_NOT_IN_CATALOGUE",
        `La hoja '${entry.sheet.name}' tiene ${orphans.length} fila(s) cuyo identificador no ` +
          `existe en '${catalogue.sheet.name}'. Filas: ${listRows(orphans.sort((a, b) => a - b))}.`,
        {
          assetRole: entry.role,
          sheet: entry.sheet.name,
          coordinate: cohort.idColumn,
          actual: orphans.length,
        },
      );
    }
    if (nameConflicts.length > 0) {
      report.add(
        "warning",
        "IDENTITY_NAME_DISAGREEMENT",
        `${nameConflicts.length} identidad(es) de '${entry.sheet.name}' tienen un nombre distinto ` +
          `al del catálogo '${catalogue.sheet.name}'. Filas: ` +
          `${listRows(nameConflicts.sort((a, b) => a - b))}. La unión se hace por identificador, ` +
          "nunca por nombre; revisa la discrepancia antes de confirmar.",
        {
          assetRole: entry.role,
          sheet: entry.sheet.name,
          coordinate: cohort.nameColumn,
          actual: nameConflicts.length,
        },
      );
    }
  }

  // One person, one cohort. An identity in two cohorts would create two
  // participations for the same study and double every count downstream.
  const cohortsPerIdentity = new Map<string, string[]>();
  for (const [cohortKey, index] of cohortIndexes) {
    for (const token of index.keys()) {
      const cohorts = cohortsPerIdentity.get(token) ?? [];
      cohorts.push(cohortKey);
      cohortsPerIdentity.set(token, cohorts);
    }
  }
  const union = new Set(cohortsPerIdentity.keys());
  const overlapping = [...cohortsPerIdentity.values()].filter((cohorts) => cohorts.length > 1);
  if (overlapping.length > 0) {
    report.add(
      "blocker",
      "IDENTITY_COHORT_OVERLAP",
      `${overlapping.length} identificador(es) aparecen en más de una cohorte ` +
        `(${[...cohortIndexes.keys()].join(", ")}). Una persona sólo puede tener una ` +
        "participación por estudio.",
      { assetRole: null, sheet: null, coordinate: null, actual: overlapping.length },
    );
  }

  if (cohortIndexes.size === identity.cohorts.length) {
    report.expect(
      {
        code: "IDENTITY_UNION_TOTAL",
        label: "Identidades únicas entre cohortes",
        assetRole: null,
        sheet: null,
        coordinate: null,
        expected: identity.expectedUniqueIdentities,
        actual: union.size,
      },
      `Las cohortes suman ${union.size} identificador(es) único(s); la especificación espera ` +
        `${identity.expectedUniqueIdentities}.`,
    );

    const uncovered = [...catalogueIndex.keys()].filter((token) => !union.has(token));
    if (uncovered.length > 0) {
      const rows = uncovered
        .flatMap((token) => catalogueIndex.get(token)?.rows ?? [])
        .sort((a, b) => a - b);
      report.add(
        "blocker",
        "IDENTITY_CATALOGUE_UNUSED",
        `El catálogo '${catalogue.sheet.name}' tiene ${uncovered.length} identificador(es) que no ` +
          `aparecen en ninguna cohorte. Filas: ${listRows(rows)}.`,
        {
          assetRole: catalogue.role,
          sheet: catalogue.sheet.name,
          coordinate: identity.catalogueIdColumn,
          actual: uncovered.length,
        },
      );
    }
  }
}

function checkPairedInstruments(
  report: Report,
  spec: CanonicalPackageSpec,
  sheetsByKey: Map<string, { role: string; sheet: SheetView; spec: CanonicalSheetSpec }>,
): void {
  for (const instrument of spec.pairedInstruments) {
    const entry = sheetsByKey.get(instrument.sheetKey);
    if (!entry) continue;
    const sheet = entry.sheet;

    let totalItems = 0;
    for (const domain of instrument.domains) {
      const columns = columnRange(domain.firstValueColumn, domain.lastLabelColumn);
      // Each item owns TWO columns: the answer and the label the spreadsheet
      // derived from it. The derived label is reconciliation evidence and never
      // a second answer, so the item count is half the band, not all of it.
      const valueColumns = columns.filter((_, offset) => offset % 2 === 0);
      const withHeader = valueColumns.filter((column) =>
        isPopulated(sheet.textAt(`${column}${instrument.itemHeaderRow}`)),
      );

      totalItems += withHeader.length;
      report.expect(
        {
          code: `CSAT_DOMAIN_${domain.key.toUpperCase()}`,
          label: `${domain.label}: ítems`,
          assetRole: entry.role,
          sheet: sheet.name,
          coordinate: `${domain.firstValueColumn}${instrument.itemHeaderRow}:${domain.lastLabelColumn}${instrument.itemHeaderRow}`,
          expected: domain.itemCount,
          actual: withHeader.length,
        },
        `El dominio '${domain.label}' tiene ${withHeader.length} ítem(s) con encabezado en ` +
          `${domain.firstValueColumn}:${domain.lastLabelColumn}; la especificación espera ` +
          `${domain.itemCount}.`,
      );

      const labelColumns = columns.filter((_, index) => index % 2 === 1);
      const missingLabels = labelColumns.filter(
        (column) => !isPopulated(sheet.textAt(`${column}${instrument.itemHeaderRow}`)),
      );
      if (missingLabels.length > 0) {
        report.add(
          "warning",
          "CSAT_DERIVED_LABEL_HEADER_MISSING",
          `El dominio '${domain.label}' tiene ${missingLabels.length} columna(s) de etiqueta ` +
            "derivada sin encabezado. La etiqueta sólo sirve para conciliar; su ausencia no " +
            "impide importar, pero deja la conciliación incompleta.",
          {
            assetRole: entry.role,
            sheet: sheet.name,
            coordinate: `${missingLabels[0]}${instrument.itemHeaderRow}`,
            actual: missingLabels.length,
          },
        );
      }

      // The merged band on the domain row is the evidence that these columns
      // form one domain. It is recorded, never used to invent a satisfaction
      // band: the same merge colour means something else on another sheet.
      const expectedRange = `${domain.firstValueColumn}${instrument.domainRow}:${domain.lastLabelColumn}${instrument.domainRow}`;
      if (!sheet.mergedRanges.includes(expectedRange)) {
        report.add(
          "warning",
          "CSAT_DOMAIN_BAND_MISSING",
          `La hoja '${sheet.name}' no tiene el rango combinado ${expectedRange} que agrupa el ` +
            `dominio '${domain.label}'. El dominio se toma de la especificación; la evidencia ` +
            "visual del agrupamiento no se pudo conservar.",
          { assetRole: entry.role, sheet: sheet.name, coordinate: expectedRange },
        );
      }
    }

    const firstColumn = instrument.domains[0]?.firstValueColumn ?? "A";
    const lastColumn = instrument.domains[instrument.domains.length - 1]?.lastLabelColumn ?? "A";
    report.expect(
      {
        code: "CSAT_ITEMS_TOTAL",
        label: "Ítems CSAT",
        assetRole: entry.role,
        sheet: sheet.name,
        coordinate: `${firstColumn}${instrument.itemHeaderRow}:${lastColumn}${instrument.itemHeaderRow}`,
        expected: instrument.expectedItems,
        actual: totalItems,
      },
      `La hoja '${sheet.name}' tiene ${totalItems} ítem(s) con encabezado; la especificación ` +
        `espera ${instrument.expectedItems}.`,
    );
  }
}

function checkPerformance(
  report: Report,
  spec: CanonicalPackageSpec,
  sheetsByKey: Map<string, { role: string; sheet: SheetView; spec: CanonicalSheetSpec }>,
): void {
  for (const performance of spec.performance) {
    const entry = sheetsByKey.get(performance.sheetKey);
    if (!entry || entry.spec.kind !== "row_records") continue;
    const sheet = entry.sheet;
    const sheetSpec = entry.spec;

    const withHeader = performance.periods.filter((period) =>
      isPopulated(sheet.textAt(`${period.column}${sheetSpec.headerRow}`)),
    );
    report.expect(
      {
        code: "PERFORMANCE_PERIODS",
        label: "Periodos de desempeño",
        assetRole: entry.role,
        sheet: sheet.name,
        coordinate: `${performance.periods[0]?.column ?? ""}${sheetSpec.headerRow}`,
        expected: performance.periods.length,
        actual: withHeader.length,
      },
      `La hoja '${sheet.name}' tiene ${withHeader.length} columna(s) de periodo con encabezado; ` +
        `la especificación espera ${performance.periods.length} ` +
        `(${performance.periods[0]?.label} a ${performance.periods[performance.periods.length - 1]?.label}).`,
    );

    const rows = recordRows(sheet, sheetSpec);
    const byStatus = new Map<string, number>();
    const participantsWithoutNumericMonth: number[] = [];
    const contradictoryOverall: number[] = [];
    const overallColumn = columnNumber(performance.overallColumn);

    for (const row of rows) {
      let numericMonths = 0;
      for (const period of performance.periods) {
        const raw = sheet.textAtRc(row, columnNumber(period.column));
        const classified = classifySourceValue(raw);
        const numeric = classified.status === "answered" && classified.numeric !== null;
        if (numeric) numericMonths += 1;
        const key = numeric ? "answered" : classified.status === "answered" ? "answered_non_numeric" : classified.status;
        byStatus.set(key, (byStatus.get(key) ?? 0) + 1);
      }
      if (numericMonths === 0) {
        participantsWithoutNumericMonth.push(row);
        const overall = classifySourceValue(sheet.textAtRc(row, overallColumn));
        if (overall.status === "answered" && overall.numeric !== null) contradictoryOverall.push(row);
      }
    }

    const nonNumeric = [...byStatus.entries()]
      .filter(([key]) => key !== "answered")
      .map(([key, count]) => `${key}=${count}`)
      .sort()
      .join(", ");
    report.add(
      "info",
      "PERFORMANCE_ABSENCE_STATES",
      `Desempeño en '${sheet.name}': ${byStatus.get("answered") ?? 0} celda(s) numéricas y ` +
        `${nonNumeric || "ninguna"} sin valor. Ninguna de estas se convierte en cero; el ` +
        "promedio global se calcula sólo con los meses numéricos disponibles.",
      {
        assetRole: entry.role,
        sheet: sheet.name,
        coordinate: `${performance.periods[0]?.column}:${performance.periods[performance.periods.length - 1]?.column}`,
        expected: rows.length * performance.periods.length,
        actual: byStatus.get("answered") ?? 0,
      },
    );

    if (participantsWithoutNumericMonth.length > 0) {
      report.add(
        "info",
        "PERFORMANCE_SOURCE_UNAVAILABLE",
        `${participantsWithoutNumericMonth.length} participante(s) de '${sheet.name}' no tienen ` +
          "ningún mes numérico. Su desempeño global queda como 'source_unavailable', nunca como " +
          `0. Filas: ${listRows(participantsWithoutNumericMonth)}.`,
        {
          assetRole: entry.role,
          sheet: sheet.name,
          coordinate: performance.overallColumn,
          actual: participantsWithoutNumericMonth.length,
        },
      );
    }

    if (contradictoryOverall.length > 0) {
      report.add(
        "warning",
        "PERFORMANCE_OVERALL_CONTRADICTION",
        `${contradictoryOverall.length} fila(s) de '${sheet.name}' traen un desempeño global ` +
          `numérico en la columna ${performance.overallColumn} sin ningún mes numérico que lo ` +
          `sustente. Filas: ${listRows(contradictoryOverall)}. El valor fuente se conserva para ` +
          "conciliación, pero no se toma como verdad.",
        {
          assetRole: entry.role,
          sheet: sheet.name,
          coordinate: performance.overallColumn,
          actual: contradictoryOverall.length,
        },
      );
    }
  }
}

function checkPeriodSeries(
  report: Report,
  spec: CanonicalPackageSpec,
  sheetsByKey: Map<string, { role: string; sheet: SheetView; spec: CanonicalSheetSpec }>,
): void {
  for (const series of spec.periodSeries) {
    const entry = sheetsByKey.get(series.sheetKey);
    if (!entry || entry.spec.kind !== "row_records") continue;
    const sheet = entry.sheet;
    const rows = recordRows(sheet, entry.spec);

    report.expect(
      {
        code: "RETENTION_PERIODS",
        label: "Periodos históricos de membresía",
        assetRole: entry.role,
        sheet: sheet.name,
        coordinate: series.labelColumn,
        expected: series.expectedPeriods,
        actual: rows.length,
      },
      `La hoja '${sheet.name}' tiene ${rows.length} periodo(s); la especificación espera ` +
        `${series.expectedPeriods}.`,
    );

    const inconsistent: number[] = [];
    const unverifiable: number[] = [];
    for (const row of rows) {
      const read = (column: string) =>
        classifySourceValue(sheet.textAtRc(row, columnNumber(column)));
      const starting = read(series.startingColumn);
      const added = read(series.newColumn);
      const ending = read(series.endingColumn);
      const lost = read(series.lostColumn);
      const values = [starting, added, ending, lost];
      if (values.some((value) => value.status !== "answered" || value.numeric === null)) {
        unverifiable.push(row);
        continue;
      }
      const expected = (starting.numeric ?? 0) - (lost.numeric ?? 0) + (added.numeric ?? 0);
      if (expected !== ending.numeric) inconsistent.push(row);
    }

    if (inconsistent.length > 0) {
      report.add(
        "blocker",
        "RETENTION_COUNT_IDENTITY_BROKEN",
        `En '${sheet.name}', ${inconsistent.length} periodo(s) no cumplen ` +
          "final = inicial - perdidos + nuevos. Filas: " +
          `${listRows(inconsistent)}. Las tasas se recalculan desde estos conteos, así que una ` +
          "identidad rota produciría una retención incorrecta.",
        {
          assetRole: entry.role,
          sheet: sheet.name,
          coordinate: series.endingColumn,
          actual: inconsistent.length,
        },
      );
    }
    if (unverifiable.length > 0) {
      report.add(
        "warning",
        "RETENTION_COUNTS_NOT_NUMERIC",
        `En '${sheet.name}', ${unverifiable.length} periodo(s) no tienen los cuatro conteos como ` +
          `números, así que su identidad no se pudo verificar. Filas: ${listRows(unverifiable)}.`,
        {
          assetRole: entry.role,
          sheet: sheet.name,
          coordinate: series.startingColumn,
          actual: unverifiable.length,
        },
      );
    }
  }
}

function checkContextualAbsence(
  report: Report,
  spec: CanonicalPackageSpec,
  sheetsByKey: Map<string, { role: string; sheet: SheetView; spec: CanonicalSheetSpec }>,
): void {
  for (const contextual of spec.contextualAbsence) {
    const entry = sheetsByKey.get(contextual.sheetKey);
    if (!entry || entry.spec.kind !== "row_records") continue;
    const tokens = new Map<string, AbsenceState>(
      contextual.tokens.map(({ token, status }): [string, AbsenceState] => [
        normalizeToken(token),
        status,
      ]),
    );
    const sheet = entry.sheet;
    const column = columnNumber(contextual.column);
    const counts = new Map<string, number>();
    for (const row of recordRows(sheet, entry.spec)) {
      const classified = classifySourceValue(sheet.textAtRc(row, column), tokens);
      counts.set(classified.status, (counts.get(classified.status) ?? 0) + 1);
    }
    const summary = [...counts.entries()]
      .sort(([a], [b]) => compareStrings(a, b))
      .map(([status, count]) => `${status}=${count}`)
      .join(", ");
    report.add(
      "info",
      "CONTEXTUAL_ABSENCE_STATES",
      `La columna ${contextual.column} de '${sheet.name}' se lee con su vocabulario propio: ` +
        `${summary}. 'not_participated' no crea respuestas de encuesta.`,
      {
        assetRole: entry.role,
        sheet: sheet.name,
        coordinate: contextual.column,
        actual: counts.get("not_participated") ?? 0,
      },
    );
  }
}

// ---------------------------------------------------------------------------
// Evidence: style, formulas, alias candidates
// ---------------------------------------------------------------------------

function collectVisualEvidence(role: string, sheet: SheetView): VisualEvidence {
  const fillCounts = new Map<string, number>();
  let explicitFillCells = 0;
  let themeFillCells = 0;
  for (const cell of sheet.cells) {
    if (cell.fillRgb) {
      explicitFillCells += 1;
      fillCounts.set(cell.fillRgb, (fillCounts.get(cell.fillRgb) ?? 0) + 1);
    } else if (cell.fillTheme !== null) {
      themeFillCells += 1;
    }
  }
  const fills = [...fillCounts.entries()]
    .map(([rgb, cells]) => ({ rgb, cells }))
    .sort((a, b) => b.cells - a.cells || compareStrings(a.rgb, b.rgb))
    .slice(0, LIMITS.distinctFills);
  return {
    assetRole: role,
    sheet: sheet.name,
    explicitFillCells,
    themeFillCells,
    mergedRanges: sheet.mergedRanges.length,
    fills,
  };
}

function collectFormulaReconciliation(role: string, sheet: SheetView): FormulaReconciliation {
  const uncached: string[] = [];
  let formulaCells = 0;
  let withCachedValue = 0;
  for (const cell of sheet.cells) {
    if (cell.formula === null) continue;
    formulaCells += 1;
    if (cell.cachedValue !== null) withCachedValue += 1;
    else uncached.push(cell.address);
  }
  return {
    assetRole: role,
    sheet: sheet.name,
    formulaCells,
    withCachedValue,
    withoutCachedValue: formulaCells - withCachedValue,
    uncachedCoordinates: sampleCoordinates(uncached),
  };
}

function collectAliasCandidates(
  spec: CanonicalPackageSpec,
  sheetsByKey: Map<string, { role: string; sheet: SheetView; spec: CanonicalSheetSpec }>,
): AliasCandidate[] {
  const candidates: AliasCandidate[] = [];
  for (const scan of spec.aliasScans) {
    const entry = sheetsByKey.get(scan.sheetKey);
    if (!entry || entry.spec.kind !== "row_records") continue;
    const sheet = entry.sheet;
    const rows = recordRows(sheet, entry.spec);
    for (const column of scan.columns) {
      const columnIndex = columnNumber(column);
      const groups = new Map<string, { spellings: Set<string>; coordinates: string[] }>();
      for (const row of rows) {
        const raw = sheet.textAtRc(row, columnIndex);
        if (!isPopulated(raw)) continue;
        const token = normalizeToken(raw);
        const group = groups.get(token) ?? { spellings: new Set<string>(), coordinates: [] };
        group.spellings.add(normalizeWhitespace(raw));
        group.coordinates.push(`${column}${row}`);
        groups.set(token, group);
      }
      for (const group of groups.values()) {
        // Only a group whose spellings actually DIFFER is a candidate. Two
        // identical values are not an alias question.
        if (group.spellings.size < 2) continue;
        candidates.push({
          assetRole: entry.role,
          sheet: sheet.name,
          column,
          variants: group.spellings.size,
          occurrences: group.coordinates.length,
          sampleCoordinates: sampleCoordinates(group.coordinates),
        });
      }
    }
  }
  return candidates
    .sort(
      (a, b) =>
        compareStrings(a.sheet, b.sheet) ||
        compareStrings(a.column, b.column) ||
        b.variants - a.variants ||
        compareStrings(a.sampleCoordinates[0] ?? "", b.sampleCoordinates[0] ?? ""),
    )
    .slice(0, LIMITS.aliasCandidates);
}

// ---------------------------------------------------------------------------
// The preflight
// ---------------------------------------------------------------------------

export async function preflightCanonicalPackage(
  files: PreflightFileInput[],
  spec: CanonicalPackageSpec = CUICUILCO_PACKAGE_SPEC_V1,
): Promise<CanonicalPackagePreflight> {
  const report = new Report();

  const parsed = preflightInputSchema.safeParse(files);
  if (!parsed.success) {
    report.add("blocker", "PACKAGE_INPUT_INVALID", parsed.error.issues[0]?.message ?? "Paquete inválido.");
    return assemble(spec, [], report, [], [], []);
  }

  const resolved: ResolvedAsset[] = [];
  for (const file of parsed.data) {
    const bytes = file.bytes;
    const sizeBytes = bytes.byteLength;
    const sha256 = await fileHash(bytes);
    const base = {
      fileName: file.fileName,
      sizeBytes,
      sha256,
      sheetSignature: "",
      structuralSignature: "",
      dateSystem: null as "1900" | "1904" | null,
      view: null as WorkbookView | null,
      readError: null as string | null,
      candidateRoles: [] as string[],
      role: null as string | null,
      missingSheets: [] as string[],
      unexpectedSheets: [] as string[],
    };

    if (sizeBytes === 0) {
      base.readError = "El archivo está vacío.";
      report.add("blocker", "ASSET_EMPTY", `'${file.fileName}' está vacío.`);
      resolved.push(base);
      continue;
    }
    if (exceedsUploadLimit(sizeBytes)) {
      base.readError = `El archivo supera el límite de ${Math.round(MAX_UPLOAD_BYTES / (1024 * 1024))} MB.`;
      report.add("blocker", "ASSET_TOO_LARGE", `'${file.fileName}': ${base.readError}`, {
        expected: MAX_UPLOAD_BYTES,
        actual: sizeBytes,
      });
      resolved.push(base);
      continue;
    }

    let view: WorkbookView | null = null;
    try {
      const workbook = await readXlsxWorkbook(bytes);
      base.sheetSignature = await sheetSignature(workbook);
      base.structuralSignature = await structuralSignature(workbook);
      base.dateSystem = workbook.dateSystem;
      view = new WorkbookView(workbook);
      base.view = view;
    } catch (error) {
      // The reader's refusals are already Spanish sentences an operator can
      // act on, and they are reached before anything is allocated or written.
      base.readError = error instanceof Error ? error.message : "El archivo no se pudo leer.";
      report.add("blocker", "ASSET_UNREADABLE", `'${file.fileName}': ${base.readError}`);
    }
    if (!view) {
      resolved.push(base);
      continue;
    }

    const duplicateSheetNames = view.duplicateNames();
    if (duplicateSheetNames.length > 0) {
      report.add(
        "blocker",
        "ASSET_DUPLICATE_SHEET_NAME",
        `'${file.fileName}' tiene más de una hoja llamada ${duplicateSheetNames
          .map((name) => `'${name}'`)
          .join(", ")}. El paquete no puede decidir cuál usar.`,
        { actual: duplicateSheetNames.length },
      );
    }
    base.candidateRoles = candidateRolesFor(view, spec);
    resolved.push(base);
  }

  // A file that appears twice is one file, not a package. Hashing settles it
  // regardless of what the two copies were called.
  const byHash = new Map<string, string[]>();
  for (const asset of resolved) {
    const names = byHash.get(asset.sha256) ?? [];
    names.push(asset.fileName);
    byHash.set(asset.sha256, names);
  }
  for (const [, names] of byHash) {
    if (names.length > 1) {
      report.add(
        "blocker",
        "PACKAGE_DUPLICATE_FILE",
        `El paquete trae ${names.length} veces el mismo archivo (mismo contenido). ` +
          "Sube un archivo por cada papel del paquete.",
        { actual: names.length },
      );
    }
  }

  assignRoles(report, spec, resolved);

  const sheetsByKey = new Map<string, { role: string; sheet: SheetView; spec: CanonicalSheetSpec }>();
  const visualEvidence: VisualEvidence[] = [];
  const formulaReconciliation: FormulaReconciliation[] = [];

  for (const roleSpec of spec.roles) {
    const asset = resolved.find((candidate) => candidate.role === roleSpec.role);
    if (!asset || !asset.view) continue;
    const view = asset.view;
    for (const sheetSpec of roleSpec.sheets) {
      const sheet = view.sheet(sheetSpecName(sheetSpec));
      if (!sheet) continue;
      sheetsByKey.set(sheetSpec.key, { role: roleSpec.role, sheet, spec: sheetSpec });
      if (sheetSpec.kind === "row_records") {
        checkRowRecordSheet(report, roleSpec.role, sheet, sheetSpec);
      } else {
        checkColumnEntitySheet(report, roleSpec.role, sheet, sheetSpec);
      }
      visualEvidence.push(collectVisualEvidence(roleSpec.role, sheet));
      formulaReconciliation.push(collectFormulaReconciliation(roleSpec.role, sheet));
    }
  }

  checkIdentity(report, spec, sheetsByKey);
  checkPairedInstruments(report, spec, sheetsByKey);
  checkPerformance(report, spec, sheetsByKey);
  checkPeriodSeries(report, spec, sheetsByKey);
  checkContextualAbsence(report, spec, sheetsByKey);

  for (const reconciliation of formulaReconciliation) {
    if (reconciliation.withoutCachedValue === 0) continue;
    report.add(
      "warning",
      "FORMULA_WITHOUT_CACHED_VALUE",
      `La hoja '${reconciliation.sheet}' tiene ${reconciliation.withoutCachedValue} fórmula(s) sin ` +
        "valor almacenado. Una fórmula sin resultado no es un cero: se leerá como ausencia hasta " +
        `que el libro se recalcule y se vuelva a exportar. Celdas: ${reconciliation.uncachedCoordinates.join(", ")}.`,
      {
        assetRole: reconciliation.assetRole,
        sheet: reconciliation.sheet,
        coordinate: reconciliation.uncachedCoordinates[0] ?? null,
        actual: reconciliation.withoutCachedValue,
      },
    );
  }

  const aliasCandidates = collectAliasCandidates(spec, sheetsByKey);
  for (const candidate of aliasCandidates) {
    report.add(
      "info",
      "ALIAS_CANDIDATE",
      `La columna ${candidate.column} de '${candidate.sheet}' tiene ${candidate.variants} ` +
        "escrituras distintas que se normalizan igual. Unir dos redacciones es una decisión " +
        "versionada y revisable por una persona; el preflight sólo señala dónde mirar " +
        `(${candidate.sampleCoordinates.join(", ")}).`,
      {
        assetRole: candidate.assetRole,
        sheet: candidate.sheet,
        coordinate: candidate.column,
        actual: candidate.variants,
      },
    );
  }

  const rolesResolved =
    spec.roles.every((roleSpec) => resolved.filter((asset) => asset.role === roleSpec.role).length === 1) &&
    resolved.every((asset) => asset.role !== null);
  const idempotencyKey = rolesResolved
    ? await packageIdempotencyKey(
        spec.id,
        spec.mappingVersion,
        resolved.map((asset) => ({ role: asset.role as string, sha256: asset.sha256 })),
      )
    : null;

  return assemble(spec, resolved, report, visualEvidence, formulaReconciliation, aliasCandidates, idempotencyKey);
}

/**
 * Bind each file to exactly one role, and refuse every ambiguous outcome.
 *
 * Every branch below is a blocker, deliberately. A package the product cannot
 * describe unambiguously is a package it must not import: silently picking the
 * first plausible file is how a curated map is loaded as if it were the clean
 * data, which no downstream count would catch.
 */
function assignRoles(report: Report, spec: CanonicalPackageSpec, assets: ResolvedAsset[]): void {
  for (const asset of assets) {
    const view = asset.view;
    if (!view) continue;
    if (asset.candidateRoles.length === 1) {
      asset.role = asset.candidateRoles[0];
      continue;
    }
    if (asset.candidateRoles.length > 1) {
      report.add(
        "blocker",
        "PACKAGE_AMBIGUOUS_SIGNATURE",
        `'${asset.fileName}' cumple la firma estructural de más de un papel ` +
          `(${asset.candidateRoles.join(", ")}). El paquete no puede decidir cuál es.`,
        { actual: asset.candidateRoles.length },
      );
      continue;
    }
    // No role matched. Say which sheets are missing for the CLOSEST role, so
    // the operator learns what is wrong with the file rather than that it is
    // "unrecognised".
    let closest: { role: AssetRoleSpec; missing: string[] } | null = null;
    for (const roleSpec of spec.roles) {
      const missing = missingSheetsFor(view, roleSpec);
      if (!closest || missing.length < closest.missing.length) closest = { role: roleSpec, missing };
    }
    if (closest) {
      asset.missingSheets = closest.missing;
      const nearMisses = closest.missing
        .map((name) => ({ name, near: view.nearMiss(name) }))
        .filter((entry) => entry.near !== null)
        .map((entry) => `'${entry.name}' (¿es '${entry.near?.name}'?)`);
      report.add(
        "blocker",
        "PACKAGE_ASSET_UNRECOGNISED",
        `'${asset.fileName}' no corresponde a ningún papel del paquete. Para ` +
          `'${closest.role.label}' le faltan ${closest.missing.length} hoja(s): ` +
          `${closest.missing.map((name) => `'${name}'`).join(", ")}.` +
          (nearMisses.length > 0 ? ` Coincidencias parecidas: ${nearMisses.join(", ")}.` : ""),
        { expected: requiredSheetNames(closest.role).length, actual: closest.missing.length },
      );
    }
  }

  for (const roleSpec of spec.roles) {
    const matches = assets.filter((asset) => asset.role === roleSpec.role);
    if (matches.length === 0) {
      report.add(
        "blocker",
        "PACKAGE_ROLE_MISSING",
        `Falta el archivo '${roleSpec.label}' (${roleSpec.role}). El paquete requiere ` +
          `${spec.roles.length} archivo(s), uno por papel.`,
        { assetRole: roleSpec.role, expected: 1, actual: 0 },
      );
    } else if (matches.length > 1) {
      report.add(
        "blocker",
        "PACKAGE_ROLE_DUPLICATED",
        `${matches.length} archivos cumplen la firma de '${roleSpec.label}' (${roleSpec.role}). ` +
          "El paquete admite exactamente uno por papel.",
        { assetRole: roleSpec.role, expected: 1, actual: matches.length },
      );
      // Neither file may claim the role: choosing one would be arbitrary.
      for (const match of matches) match.role = null;
    }
  }

  // Sheets the specification never asked for are recorded, not refused: a
  // consultant adding a scratch tab must not stop a valid import.
  for (const asset of assets) {
    const view = asset.view;
    if (!view || !asset.role) continue;
    const roleSpec = spec.roles.find((candidate) => candidate.role === asset.role);
    if (!roleSpec) continue;
    const expected = new Set(requiredSheetNames(roleSpec).map(normalizeWhitespace));
    asset.unexpectedSheets = view.sheets
      .filter((sheet) => !expected.has(sheet.normalizedName))
      .map((sheet) => sheet.name)
      .sort();
    if (asset.unexpectedSheets.length > 0) {
      report.add(
        "warning",
        "ASSET_UNEXPECTED_SHEET",
        `'${roleSpec.label}' trae ${asset.unexpectedSheets.length} hoja(s) que la especificación ` +
          `no mapea: ${asset.unexpectedSheets.map((name) => `'${name}'`).join(", ")}. ` +
          "No impiden importar, pero su contenido no se leerá.",
        { assetRole: asset.role, actual: asset.unexpectedSheets.length },
      );
    }
    const hidden = view.sheets.filter((sheet) => sheet.state !== "visible");
    if (hidden.length > 0) {
      report.add(
        "warning",
        "ASSET_HIDDEN_SHEET",
        `'${roleSpec.label}' trae ${hidden.length} hoja(s) oculta(s): ` +
          `${hidden.map((sheet) => `'${sheet.name}'`).join(", ")}. Revisa que no contengan datos ` +
          "que el estudio necesite.",
        { assetRole: asset.role, actual: hidden.length },
      );
    }
  }
}

function describeSheets(asset: ResolvedAsset, spec: CanonicalPackageSpec): PreflightSheet[] {
  if (!asset.view) return [];
  const roleSpec = spec.roles.find((candidate) => candidate.role === asset.role);
  const expected = new Set((roleSpec ? requiredSheetNames(roleSpec) : []).map(normalizeWhitespace));
  return asset.view.sheets
    .map((sheet) => ({
      name: sheet.name,
      normalizedName: sheet.normalizedName,
      index: sheet.index,
      state: sheet.state,
      expected: expected.has(sheet.normalizedName),
      maxRow: sheet.maxRow,
      maxColumn: sheet.maxColumn,
      populatedCells: sheet.populatedCells(),
      mergedRanges: sheet.mergedRanges.length,
    }))
    .sort((a, b) => a.index - b.index);
}

function assemble(
  spec: CanonicalPackageSpec,
  resolved: ResolvedAsset[],
  report: Report,
  visualEvidence: VisualEvidence[],
  formulaReconciliation: FormulaReconciliation[],
  aliasCandidates: AliasCandidate[],
  packageIdempotencyKeyValue: string | null = null,
): CanonicalPackagePreflight {
  const assets: PreflightAsset[] = resolved
    .map((asset) => ({
      role: asset.role,
      fileName: asset.fileName,
      sizeBytes: asset.sizeBytes,
      sha256: asset.sha256,
      sheetSignature: asset.sheetSignature,
      structuralSignature: asset.structuralSignature,
      dateSystem: asset.dateSystem,
      sheets: describeSheets(asset, spec),
      unexpectedSheets: asset.unexpectedSheets,
      missingSheets: asset.missingSheets,
      readError: asset.readError,
    }))
    // Ordered by role, then by content hash. Never by upload order, so the
    // same two files produce the same report whichever way round they arrive.
    .sort(
      (a, b) =>
        compareStrings(a.role ?? "~", b.role ?? "~") || compareStrings(a.sha256, b.sha256),
    );

  const findings = sortFindings(report.findings);
  const counts = {
    blockers: findings.filter((finding) => finding.severity === "blocker").length,
    warnings: findings.filter((finding) => finding.severity === "warning").length,
    info: findings.filter((finding) => finding.severity === "info").length,
  };

  return {
    specId: spec.id,
    specLabel: spec.label,
    mappingVersion: spec.mappingVersion,
    packageIdempotencyKey: packageIdempotencyKeyValue,
    assets,
    expectations: [...report.expectations].sort(
      (a, b) =>
        compareStrings(a.assetRole, b.assetRole) ||
        compareStrings(a.sheet, b.sheet) ||
        compareStrings(a.code, b.code),
    ),
    findings,
    visualEvidence: [...visualEvidence].sort(
      (a, b) => compareStrings(a.assetRole, b.assetRole) || compareStrings(a.sheet, b.sheet),
    ),
    formulaReconciliation: [...formulaReconciliation].sort(
      (a, b) => compareStrings(a.assetRole, b.assetRole) || compareStrings(a.sheet, b.sheet),
    ),
    aliasCandidates,
    counts,
    // One blocker is enough. There is no "confirm anyway".
    confirmationAllowed: counts.blockers === 0,
  };
}
