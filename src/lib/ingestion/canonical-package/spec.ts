import type { AbsenceState } from "./values";

/**
 * The package specification: what a canonical study import must consist of.
 *
 * CONFIGURATION, NOT CODE. Every number, column letter, sheet name and period
 * date below comes from the approved mapping artifact for this study. The
 * checkers in `preflight.ts` know how to verify a shape; they know nothing
 * about Cuicuilco. A second study is a second `CanonicalPackageSpec`, not a
 * second code path — that is the same rule the rest of the product follows for
 * journey stages, dashboard sections and segmentation.
 *
 * VERSIONED. `mappingVersion` is stored with the import job. If the approved
 * mapping changes, the version changes with it, and an old package can still
 * be explained by the version it was validated against.
 *
 * NO CLIENT CONTENT. The specification carries structure only — sheet names,
 * coordinates and expected counts. It carries no question text, no category
 * value, no name and no answer, so this file is safe in version control while
 * the workbooks it describes are not.
 */

/** A sheet whose records run DOWN: one row per person, period or option. */
export type RowRecordSheetSpec = {
  kind: "row_records";
  /** Stable internal key. Referenced by cross-sheet reconciliations. */
  key: string;
  /** Expected worksheet name, matched after whitespace normalisation only. */
  sourceName: string;
  headerRow: number;
  firstDataRow: number;
  /**
   * The column that decides whether a physical row is a record. Counting
   * `maxRow` instead would count the hundreds of empty styled rows a
   * spreadsheet export pads a sheet with.
   */
  identityColumn: string;
  expectedRecords: number;
  /** Columns that MUST carry a header label on `headerRow`. */
  requiredHeaderColumns: string[];
  /**
   * Coordinates that MUST be empty. This is what proves the header anchor:
   * a file whose header sits one row higher still has the right number of
   * populated columns, and only the blank above it says the anchor moved.
   */
  requiredEmptyCells: string[];
  /** Human label for messages. Structural, never client content. */
  label: string;
};

/** A sheet whose entities run ACROSS: one column per stage, team or dimension. */
export type ColumnEntitySheetSpec = {
  kind: "column_entities";
  key: string;
  sourceName: string;
  /** The row carrying the entity names. */
  entityRow: number;
  entityColumns: { from: string; to: string };
  /** The row carrying the curated text for each entity. May be blank. */
  contentRow: number;
  expectedEntities: number;
  requiredEmptyCells: string[];
  label: string;
};

export type CanonicalSheetSpec = RowRecordSheetSpec | ColumnEntitySheetSpec;

export type AssetRoleSpec = {
  /** Matches `import_job_asset.asset_role`. */
  role: string;
  label: string;
  sheets: CanonicalSheetSpec[];
};

/**
 * Identity reconciliation.
 *
 * The catalogue is authoritative for WHICH identities exist; the cohort sheets
 * are authoritative for HOW MANY people are in each cohort. Names are read to
 * DETECT disagreement and are never carried out of the check — the finding
 * says how many identities disagree and where, and a human opens the source.
 */
export type IdentitySpec = {
  namespace: string;
  catalogueSheetKey: string;
  catalogueIdColumn: string;
  catalogueNameColumn: string | null;
  cohorts: Array<{
    sheetKey: string;
    cohortKey: string;
    idColumn: string;
    nameColumn: string | null;
    expected: number;
  }>;
  expectedUniqueIdentities: number;
};

/**
 * A paired-column instrument.
 *
 * Each item occupies TWO columns: the answer and a label the spreadsheet
 * derived from it. The derived label is reconciliation evidence, never a
 * second answer — importing both would double every response count and would
 * present a rounded category as if a person had chosen it.
 */
export type PairedItemInstrumentSpec = {
  sheetKey: string;
  /** The row whose merged ranges group items into domains. */
  domainRow: number;
  itemHeaderRow: number;
  domains: Array<{
    key: string;
    label: string;
    firstValueColumn: string;
    lastLabelColumn: string;
    itemCount: number;
  }>;
  expectedItems: number;
};

/** Monthly observations laid out one column per period. */
export type PerformancePeriodSpec = {
  sheetKey: string;
  /** The source's own aggregate column. Recomputed, never trusted. */
  overallColumn: string;
  periods: Array<{ column: string; periodStart: string; label: string }>;
};

/** A historical membership series: counts that must reconcile with each other. */
export type PeriodSeriesSpec = {
  sheetKey: string;
  labelColumn: string;
  startingColumn: string;
  newColumn: string;
  endingColumn: string;
  lostColumn: string;
  expectedPeriods: number;
};

/** Columns whose values are free categories and may need a reviewed alias. */
export type AliasScanSpec = {
  sheetKey: string;
  columns: string[];
};

/** Column-scoped absence vocabulary, e.g. a bare "No" meaning "did not take part". */
export type ContextualAbsenceSpec = {
  sheetKey: string;
  column: string;
  tokens: Array<{ token: string; status: AbsenceState }>;
};

export type CanonicalPackageSpec = {
  id: string;
  label: string;
  mappingVersion: number;
  roles: AssetRoleSpec[];
  identity: IdentitySpec;
  pairedInstruments: PairedItemInstrumentSpec[];
  performance: PerformancePeriodSpec[];
  periodSeries: PeriodSeriesSpec[];
  aliasScans: AliasScanSpec[];
  contextualAbsence: ContextualAbsenceSpec[];
};

/**
 * BNI Cuicuilco, mapping version 1.
 *
 * Anchors and counts are transcribed from `CUICUILCO_MAPEO_EXHAUSTIVO_V1.xlsx`
 * and the physical specification that accompanies it, and were reconciled
 * read-only against the two source workbooks. Two anchors are easy to get
 * wrong and are called out here because a later reader will not guess them:
 *
 *   - the two profile sheets and CSAT begin at row 2, not row 1; CSAT row 1
 *     carries the merged domain bands;
 *   - the curated workbook's five sheets each anchor at a DIFFERENT row
 *     (6, 3, 7, 6, 8), and its `Equipos ` sheet name really does end in a
 *     space. Trimming that name for lineage would lose the source spelling;
 *     refusing to trim it for matching would fail the package.
 */
export const CUICUILCO_PACKAGE_SPEC_V1: CanonicalPackageSpec = {
  id: "cuicuilco",
  label: "Estudio Cuicuilco — paquete canónico",
  mappingVersion: 1,
  roles: [
    {
      role: "clean_study_data",
      label: "Datos limpios del estudio",
      sheets: [
        {
          kind: "row_records",
          key: "perfil_cliente",
          sourceName: "Perfil Cliente",
          label: "Perfil de miembros activos",
          headerRow: 2,
          firstDataRow: 3,
          identityColumn: "C",
          expectedRecords: 28,
          requiredHeaderColumns: [
            "A", "B", "C", "K", "L", "O",
            "P", "Q", "R", "S", "T", "U", "V", "W", "X",
          ],
          requiredEmptyCells: ["C1"],
        },
        {
          kind: "row_records",
          key: "perfil_desertores",
          sourceName: "Perfil Desertores",
          label: "Perfil de miembros desertores",
          headerRow: 2,
          firstDataRow: 3,
          identityColumn: "C",
          expectedRecords: 32,
          requiredHeaderColumns: ["A", "B", "C", "D", "K", "L", "N"],
          requiredEmptyCells: ["C1"],
        },
        {
          kind: "row_records",
          key: "id_cliente",
          sourceName: "IDCliente",
          label: "Catálogo de identidad",
          headerRow: 1,
          firstDataRow: 2,
          identityColumn: "B",
          expectedRecords: 60,
          requiredHeaderColumns: ["A", "B"],
          requiredEmptyCells: [],
        },
        {
          kind: "row_records",
          key: "generaciones",
          sourceName: "Generaciones",
          label: "Regla de generaciones",
          headerRow: 1,
          firstDataRow: 2,
          identityColumn: "A",
          expectedRecords: 5,
          requiredHeaderColumns: ["A", "B"],
          requiredEmptyCells: [],
        },
        {
          kind: "row_records",
          key: "retencion_desercion",
          sourceName: "RetenciónDeserción",
          label: "Serie histórica de membresía",
          headerRow: 1,
          firstDataRow: 2,
          identityColumn: "A",
          expectedRecords: 6,
          requiredHeaderColumns: ["A", "B", "C", "D", "E", "F", "G"],
          requiredEmptyCells: [],
        },
        {
          kind: "row_records",
          key: "csat",
          sourceName: "CSAT",
          label: "Sesiones CSAT",
          headerRow: 2,
          firstDataRow: 3,
          identityColumn: "C",
          expectedRecords: 28,
          requiredHeaderColumns: ["A", "B", "C", "D", "DI"],
          // Row 1 carries the four merged domain bands, so C1 must be blank
          // while D1 must not: that pair proves the band row is where the
          // mapping says it is, and that the item header sits below it.
          requiredEmptyCells: ["C1"],
        },
        {
          kind: "row_records",
          key: "satisfaccion_csat",
          sourceName: "SatisfacciónCSAT",
          label: "Escala CSAT",
          headerRow: 1,
          firstDataRow: 2,
          identityColumn: "A",
          expectedRecords: 6,
          requiredHeaderColumns: ["A", "B"],
          requiredEmptyCells: [],
        },
        {
          kind: "row_records",
          key: "nps",
          sourceName: "NPS",
          label: "NPS de miembros activos",
          headerRow: 1,
          firstDataRow: 2,
          identityColumn: "C",
          expectedRecords: 28,
          requiredHeaderColumns: ["A", "B", "C", "D", "E"],
          requiredEmptyCells: [],
        },
        {
          kind: "row_records",
          key: "nps_desertores",
          sourceName: "NPS desertores",
          label: "NPS de miembros desertores",
          headerRow: 1,
          firstDataRow: 2,
          identityColumn: "C",
          expectedRecords: 11,
          requiredHeaderColumns: ["A", "B", "C", "D", "E", "F", "G"],
          requiredEmptyCells: [],
        },
        {
          kind: "row_records",
          key: "recomendacion_nps",
          sourceName: "Recomendación NPS",
          label: "Escala NPS",
          headerRow: 1,
          firstDataRow: 2,
          identityColumn: "A",
          expectedRecords: 10,
          requiredHeaderColumns: ["A", "B"],
          requiredEmptyCells: [],
        },
        {
          kind: "row_records",
          key: "cri",
          sourceName: "CRI",
          label: "Índice de riesgo de renovación",
          headerRow: 1,
          firstDataRow: 2,
          identityColumn: "C",
          expectedRecords: 28,
          requiredHeaderColumns: ["A", "B", "C", "D", "E", "F"],
          requiredEmptyCells: [],
        },
      ],
    },
    {
      role: "curated_pain_map",
      label: "Mapa curado de puntos de dolor",
      sheets: [
        {
          kind: "column_entities",
          key: "journey",
          sourceName: "Journey",
          label: "Etapas del journey",
          entityRow: 6,
          entityColumns: { from: "B", to: "S" },
          contentRow: 7,
          expectedEntities: 18,
          requiredEmptyCells: ["B5"],
        },
        {
          kind: "column_entities",
          key: "equipos",
          // The source name ends in a space. Matching normalises whitespace;
          // lineage keeps the spelling the file actually uses.
          sourceName: "Equipos ",
          label: "Unidades organizacionales",
          entityRow: 3,
          entityColumns: { from: "B", to: "K" },
          contentRow: 4,
          expectedEntities: 10,
          requiredEmptyCells: ["B2"],
        },
        {
          kind: "column_entities",
          key: "desempeno",
          sourceName: "Desempeño",
          label: "Dimensiones de desempeño",
          entityRow: 7,
          entityColumns: { from: "B", to: "H" },
          contentRow: 8,
          expectedEntities: 7,
          requiredEmptyCells: ["B6"],
        },
        {
          kind: "column_entities",
          key: "cultura_edl",
          sourceName: "Cultura EDL",
          label: "Dimensiones de cultura (EDL)",
          entityRow: 6,
          entityColumns: { from: "B", to: "K" },
          contentRow: 7,
          expectedEntities: 10,
          requiredEmptyCells: ["B5"],
        },
        {
          kind: "column_entities",
          key: "cultura_miembros",
          sourceName: "Cultura Miembros",
          label: "Dimensiones de cultura (miembros)",
          entityRow: 8,
          entityColumns: { from: "B", to: "K" },
          contentRow: 9,
          expectedEntities: 10,
          requiredEmptyCells: ["B7"],
        },
      ],
    },
  ],
  identity: {
    namespace: "bni_cuicuilco_client_id",
    catalogueSheetKey: "id_cliente",
    catalogueIdColumn: "B",
    catalogueNameColumn: "A",
    cohorts: [
      { sheetKey: "perfil_cliente", cohortKey: "active", idColumn: "C", nameColumn: "B", expected: 28 },
      { sheetKey: "perfil_desertores", cohortKey: "deserter", idColumn: "C", nameColumn: "B", expected: 32 },
    ],
    expectedUniqueIdentities: 60,
  },
  pairedInstruments: [
    {
      sheetKey: "csat",
      domainRow: 1,
      itemHeaderRow: 2,
      expectedItems: 55,
      domains: [
        {
          key: "interacciones_operacion",
          label: "Interacciones y operación",
          firstValueColumn: "D",
          lastLabelColumn: "BI",
          itemCount: 29,
        },
        {
          key: "rendicion_cuentas",
          label: "Rendición de cuentas",
          firstValueColumn: "BJ",
          lastLabelColumn: "BU",
          itemCount: 6,
        },
        {
          key: "cultura_edl",
          label: "Cultura (EDL)",
          firstValueColumn: "BV",
          lastLabelColumn: "CO",
          itemCount: 10,
        },
        {
          key: "cultura_miembros",
          label: "Cultura (miembros)",
          firstValueColumn: "CP",
          lastLabelColumn: "DI",
          itemCount: 10,
        },
      ],
    },
  ],
  performance: [
    {
      sheetKey: "perfil_cliente",
      overallColumn: "O",
      periods: [
        { column: "P", periodStart: "2025-10-01", label: "octubre 2025" },
        { column: "Q", periodStart: "2025-11-01", label: "noviembre 2025" },
        { column: "R", periodStart: "2025-12-01", label: "diciembre 2025" },
        { column: "S", periodStart: "2026-01-01", label: "enero 2026" },
        { column: "T", periodStart: "2026-02-01", label: "febrero 2026" },
        { column: "U", periodStart: "2026-03-01", label: "marzo 2026" },
        { column: "V", periodStart: "2026-04-01", label: "abril 2026" },
        { column: "W", periodStart: "2026-05-01", label: "mayo 2026" },
        { column: "X", periodStart: "2026-06-01", label: "junio 2026" },
      ],
    },
  ],
  periodSeries: [
    {
      sheetKey: "retencion_desercion",
      labelColumn: "A",
      startingColumn: "B",
      newColumn: "C",
      endingColumn: "D",
      lostColumn: "E",
      expectedPeriods: 6,
    },
  ],
  aliasScans: [
    // Free-text category columns the mapping marks "trim + alias revisable".
    { sheetKey: "perfil_cliente", columns: ["G", "H", "I", "J"] },
    { sheetKey: "perfil_desertores", columns: ["H", "I", "J"] },
  ],
  contextualAbsence: [
    {
      // "Respuesta": Sí = took the survey, No = did not. A bare "No" is an
      // ordinary answer everywhere else, so this token is scoped to one column.
      sheetKey: "perfil_desertores",
      column: "D",
      tokens: [{ token: "no", status: "not_participated" }],
    },
  ],
};

/** Every specification this build knows how to validate, by id. */
export const CANONICAL_PACKAGE_SPECS: Record<string, CanonicalPackageSpec> = {
  [CUICUILCO_PACKAGE_SPEC_V1.id]: CUICUILCO_PACKAGE_SPEC_V1,
};
