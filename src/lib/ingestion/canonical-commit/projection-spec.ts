import type { AbsenceState } from "../canonical-package/values";

/**
 * How a validated package becomes canonical records — as CONFIGURATION.
 *
 * The projector in `projector.ts` knows how to walk a shape. It knows nothing
 * about Cuicuilco: which column carries a date, which sheet lists the cohorts,
 * which band a score falls in and which metric a question feeds are all
 * declared here, versioned with the mapping the package was validated against.
 * A second study is a second `PackageProjectionSpec`, not a second code path.
 *
 * WHAT MAY BE DECLARED HERE. Only what the approved mapping, this repository's
 * documentation, or the source's own structure supports. Three examples of the
 * boundary, because they are the ones a later editor will be tempted to cross:
 *
 *   * the performance band ranges are `docs/CANONICAL_STUDY_MODEL.md`'s
 *     confirmed gray 0-29 / red 30-49 / yellow 50-69 / green 70-100 — they are
 *     NOT read off the workbook's colours, and the colours are recorded
 *     separately as uninterpreted evidence;
 *   * the NPS, CSAT, TDP, CRI and retention band ranges and families come from
 *     `docs/CALCULATION_CATALOG.md`, which is the authoritative source for
 *     Be Community's own metrics;
 *   * an evidence link that the mapping does NOT state is left empty rather
 *     than guessed. `journeyEvidence` is empty for Cuicuilco v1 for exactly
 *     that reason: nothing in the package says which metric belongs to which
 *     journey stage, and inventing that association would put a fabricated
 *     relationship in front of a consultant.
 *
 * NO CLIENT CONTENT. Like the package specification, this file carries
 * structure only — column letters, keys, orders and documented business
 * ranges. Labels and prompts are read from the source at projection time, so
 * no question text, category value, name or answer is committed here.
 */

/** One profile column that becomes a typed participant attribute. */
export type AttributeColumnSpec = {
  column: string;
  dataType: "text" | "category" | "number" | "date" | "boolean";
  sensitivity: "private" | "internal" | "client_eligible";
  filterable: boolean;
};

/** How one cohort sheet becomes participations, episodes and attributes. */
export type CohortProjectionSpec = {
  sheetKey: string;
  cohortKey: string;
  idColumn: string;
  nameColumn: string;
  /**
   * The column that states whether this person took the cohort's own
   * instrument. Its vocabulary is scoped to the column, exactly as the package
   * specification scopes `contextualAbsence`: a bare "No" here means "did not
   * take part", and a bare "No" anywhere else is an ordinary answer.
   */
  participation: {
    column: string;
    respondedTokens: string[];
    absentTokens: Array<{ token: string; status: AbsenceState }>;
  } | null;
  /**
   * The membership episode. `endColumn` is declared only for a cohort the
   * source itself describes as former members, and the projector REFUSES the
   * package unless every end date is strictly later than its start date.
   */
  membership: { startColumn: string; endColumn: string | null } | null;
  attributes: AttributeColumnSpec[];
};

/** A source list that becomes a response scale and its options. */
export type ScaleProjectionSpec = {
  key: string;
  sheetKey: string;
  valueType: "numeric" | "text" | "mixed";
  rawColumn: string;
  /** The label the SOURCE puts beside the value. Evidence, never a second option. */
  derivedLabelColumn: string | null;
};

/** One item of a plain (non-paired) instrument: a value column and its label. */
export type ItemColumnSpec = { valueColumn: string; derivedLabelColumn: string | null };

export type InstrumentProjectionSpec = {
  key: string;
  audience: string;
  instrumentType: "profile" | "survey" | "index" | "exit" | "other";
  sheetKey: string;
  identityColumn: string;
  /** Recorded as `survey_session.submitted_at` when the cell holds a date. */
  submittedAtColumn: string | null;
  responseScaleKey: string | null;
  /** Declared for a plain instrument. Mutually exclusive with `pairedDomains`. */
  items: ItemColumnSpec[];
  /**
   * True when the item layout comes from the package specification's own
   * `pairedInstruments` entry for this sheet — value column, derived-label
   * column, repeated across merged domain bands.
   */
  pairedDomains: boolean;
  /**
   * The cohort whose non-respondents receive an explicit `not_participated`
   * session with no responses at all.
   */
  nonParticipationCohort: string | null;
  /** Cohorts every respondent must belong to. A stranger is a warning, not silence. */
  expectedCohorts: string[];
  /** A metric family emitted once PER ITEM, as the calculation catalogue requires. */
  perItemMetrics: Array<{
    keyPrefix: string;
    family: "nps" | "csat" | "tdp" | "cri" | "retention" | "churn" | "mean" | "count";
    unit: "score" | "percent" | "count" | "currency" | "ratio" | "years";
    precision: number;
    bandSchemeKey: string | null;
  }>;
  /**
   * A metric whose evidence column is IDENTIFIED, not assumed: the projector
   * accepts the single item whose distinct answered values all belong to the
   * documented option set and cover at least `minimumCoverage` of it, and
   * refuses the package when none or more than one column qualifies.
   */
  identifiedMetrics: Array<{
    key: string;
    family: "nps" | "csat" | "tdp" | "cri" | "retention" | "churn" | "mean" | "count";
    unit: "score" | "percent" | "count" | "currency" | "ratio" | "years";
    precision: number;
    bandSchemeKey: string | null;
    documentedOptions: string[];
    minimumCoverage: number;
  }>;
  /** A metric bound to a named item column, when the mapping states it outright. */
  columnMetrics: Array<{
    key: string;
    valueColumn: string;
    family: "nps" | "csat" | "tdp" | "cri" | "retention" | "churn" | "mean" | "count";
    unit: "score" | "percent" | "count" | "currency" | "ratio" | "years";
    precision: number;
    bandSchemeKey: string | null;
  }>;
};

export type BandSchemeProjectionSpec = {
  key: string;
  label: string;
  unit: "score" | "percent" | "count" | "currency" | "ratio" | "years";
  /** Where the ranges come from. Recorded on the row so a reviewer can check it. */
  description: string;
  rules: Array<{
    lowerBound: number | null;
    upperBound: number | null;
    lowerInclusive: boolean;
    upperInclusive: boolean;
    label: string;
    semanticColor: "gray" | "red" | "yellow" | "green" | "safe" | "alert" | "danger" | "neutral";
  }>;
};

/** Monthly observations laid out one column per period on a cohort sheet. */
export type PerformanceProjectionSpec = {
  sheetKey: string;
  cohortKey: string;
  dimensionKey: string;
  dimensionLabel: string;
  bandSchemeKey: string;
  metricKey: string;
  metricPrecision: number;
};

/** A curated column-entity sheet and the canonical family it becomes. */
export type CuratedEntityProjectionSpec = {
  sheetKey: string;
  target:
    | { kind: "journey"; modelKey: string; modelLabel: string; audience: string }
    | { kind: "organizational_unit" }
    | { kind: "performance_dimension" }
    | { kind: "culture_dimension"; audience: "edl" | "members" };
  /** Prefix for the generated entity keys, e.g. `etapa` -> `etapa_01_...`. */
  keyPrefix: string;
};

export type RetentionProjectionSpec = {
  sheetKey: string;
  seriesKey: string;
  labelColumn: string;
  startingColumn: string;
  newColumn: string;
  endingColumn: string;
  lostColumn: string;
  retentionMetricKey: string;
  churnMetricKey: string;
};

export type PackageProjectionSpec = {
  specId: string;
  /** MUST equal the package specification's own version. The projector checks. */
  mappingVersion: number;
  calculationVersion: string;
  identityNamespace: string;
  catalogue: { sheetKey: string; idColumn: string; nameColumn: string };
  cohorts: CohortProjectionSpec[];
  scales: ScaleProjectionSpec[];
  instruments: InstrumentProjectionSpec[];
  bandSchemes: BandSchemeProjectionSpec[];
  performance: PerformanceProjectionSpec[];
  retention: RetentionProjectionSpec[];
  curatedEntities: CuratedEntityProjectionSpec[];
  /**
   * Journey stage evidence the approved mapping states explicitly. Empty means
   * the mapping states none — never that the projector could not work it out.
   */
  journeyEvidence: Array<{
    journeySheetKey: string;
    stageIndex: number;
    metricKey: string | null;
    performanceDimensionKey: string | null;
    role: "primary" | "supporting" | "context";
  }>;
};

/** Documented option sets, quoted from `docs/CALCULATION_CATALOG.md` §6. */
const CRI_DOCUMENTED_OPTIONS = [
  "Nada probable",
  "Poco probable",
  "Algo probable",
  "Muy probable",
  "Extremadamente probable",
];

const PROFILE_ACTIVE_ATTRIBUTES: AttributeColumnSpec[] = [
  // The form's own timestamp. Operational team data, never client-facing —
  // the same boundary `docs/CURRENT_STATE.md` records for private metadata.
  { column: "A", dataType: "date", sensitivity: "private", filterable: false },
  { column: "D", dataType: "category", sensitivity: "internal", filterable: true },
  { column: "E", dataType: "category", sensitivity: "internal", filterable: true },
  { column: "F", dataType: "category", sensitivity: "internal", filterable: true },
  { column: "G", dataType: "category", sensitivity: "internal", filterable: true },
  { column: "H", dataType: "category", sensitivity: "internal", filterable: true },
  { column: "I", dataType: "category", sensitivity: "internal", filterable: true },
  { column: "J", dataType: "category", sensitivity: "internal", filterable: true },
  { column: "K", dataType: "date", sensitivity: "internal", filterable: false },
  { column: "L", dataType: "date", sensitivity: "internal", filterable: false },
  { column: "M", dataType: "number", sensitivity: "internal", filterable: true },
  { column: "N", dataType: "number", sensitivity: "internal", filterable: true },
  // The source's OWN overall performance figure. Kept for reconciliation and
  // never treated as truth: the preflight already reports a row that carries
  // one with no numeric month behind it.
  { column: "O", dataType: "number", sensitivity: "internal", filterable: false },
];

const PROFILE_FORMER_ATTRIBUTES: AttributeColumnSpec[] = [
  { column: "A", dataType: "date", sensitivity: "private", filterable: false },
  { column: "E", dataType: "category", sensitivity: "internal", filterable: true },
  { column: "F", dataType: "category", sensitivity: "internal", filterable: true },
  { column: "G", dataType: "category", sensitivity: "internal", filterable: true },
  { column: "H", dataType: "category", sensitivity: "internal", filterable: true },
  { column: "I", dataType: "category", sensitivity: "internal", filterable: true },
  { column: "J", dataType: "category", sensitivity: "internal", filterable: true },
  { column: "K", dataType: "date", sensitivity: "internal", filterable: false },
  { column: "L", dataType: "date", sensitivity: "internal", filterable: false },
  { column: "M", dataType: "number", sensitivity: "internal", filterable: true },
  { column: "N", dataType: "number", sensitivity: "internal", filterable: true },
];

/**
 * BNI Cuicuilco, mapping version 1.
 *
 * The audiences below are the package's own vocabulary: the study's two
 * cohorts are active and former MEMBERS, and the culture sheets themselves
 * separate the leadership team from the membership. The projector verifies
 * every declared audience against the cohort each respondent actually belongs
 * to and reports a disagreement rather than accepting it.
 */
export const CUICUILCO_PROJECTION_V1: PackageProjectionSpec = {
  specId: "cuicuilco",
  mappingVersion: 1,
  calculationVersion: "catalogo-2026-08-19",
  identityNamespace: "bni_cuicuilco_client_id",
  catalogue: { sheetKey: "id_cliente", idColumn: "B", nameColumn: "A" },
  cohorts: [
    {
      sheetKey: "perfil_cliente",
      cohortKey: "active",
      idColumn: "C",
      nameColumn: "B",
      participation: null,
      // An active member's episode has no end. The later date in column L
      // stays an ordinary typed attribute rather than being read as a
      // departure the source does not claim.
      membership: { startColumn: "K", endColumn: null },
      attributes: PROFILE_ACTIVE_ATTRIBUTES,
    },
    {
      sheetKey: "perfil_desertores",
      cohortKey: "deserter",
      idColumn: "C",
      nameColumn: "B",
      participation: {
        column: "D",
        respondedTokens: ["Sí", "Si"],
        absentTokens: [{ token: "No", status: "not_participated" }],
      },
      membership: { startColumn: "K", endColumn: "L" },
      attributes: PROFILE_FORMER_ATTRIBUTES,
    },
  ],
  scales: [
    { key: "satisfaccion_csat", sheetKey: "satisfaccion_csat", valueType: "mixed", rawColumn: "A", derivedLabelColumn: "B" },
    { key: "recomendacion_nps", sheetKey: "recomendacion_nps", valueType: "numeric", rawColumn: "A", derivedLabelColumn: "B" },
    // A named source list of ranges and their generation label. Recording it as
    // a scale keeps the pairs exactly as the source states them without
    // deciding what a later calculation should do with them.
    { key: "generaciones", sheetKey: "generaciones", valueType: "mixed", rawColumn: "A", derivedLabelColumn: "B" },
  ],
  instruments: [
    {
      key: "csat",
      audience: "miembros_activos",
      instrumentType: "survey",
      sheetKey: "csat",
      identityColumn: "C",
      submittedAtColumn: "A",
      responseScaleKey: "satisfaccion_csat",
      items: [],
      pairedDomains: true,
      nonParticipationCohort: null,
      expectedCohorts: ["active"],
      // "CSAT se calcula y presenta POR PUNTO DE CONTACTO. No existe un CSAT
      // general obtenido promediando puntos de contacto." — catalogue §4. TDP
      // accompanies each evaluated touchpoint — catalogue §5.
      perItemMetrics: [
        { keyPrefix: "csat_item", family: "csat", unit: "percent", precision: 1, bandSchemeKey: "csat_presentacion" },
        { keyPrefix: "tdp_item", family: "tdp", unit: "percent", precision: 1, bandSchemeKey: null },
      ],
      identifiedMetrics: [],
      columnMetrics: [],
    },
    {
      key: "nps_activos",
      audience: "miembros_activos",
      instrumentType: "survey",
      sheetKey: "nps",
      identityColumn: "C",
      submittedAtColumn: "A",
      responseScaleKey: "recomendacion_nps",
      items: [{ valueColumn: "D", derivedLabelColumn: "E" }],
      pairedDomains: false,
      nonParticipationCohort: null,
      expectedCohorts: ["active"],
      perItemMetrics: [],
      identifiedMetrics: [],
      columnMetrics: [
        { key: "nps_activos", valueColumn: "D", family: "nps", unit: "score", precision: 1, bandSchemeKey: "nps_presentacion" },
      ],
    },
    {
      key: "nps_desertores",
      audience: "miembros_desertores",
      instrumentType: "exit",
      sheetKey: "nps_desertores",
      identityColumn: "C",
      submittedAtColumn: "A",
      responseScaleKey: "recomendacion_nps",
      items: [
        { valueColumn: "D", derivedLabelColumn: "E" },
        { valueColumn: "F", derivedLabelColumn: null },
        { valueColumn: "G", derivedLabelColumn: null },
      ],
      pairedDomains: false,
      nonParticipationCohort: "deserter",
      expectedCohorts: ["deserter"],
      perItemMetrics: [],
      identifiedMetrics: [],
      columnMetrics: [
        { key: "nps_desertores", valueColumn: "D", family: "nps", unit: "score", precision: 1, bandSchemeKey: "nps_presentacion" },
      ],
    },
    {
      key: "cri",
      audience: "miembros_activos",
      instrumentType: "index",
      sheetKey: "cri",
      identityColumn: "C",
      submittedAtColumn: "A",
      responseScaleKey: null,
      items: [
        { valueColumn: "D", derivedLabelColumn: null },
        { valueColumn: "E", derivedLabelColumn: null },
        { valueColumn: "F", derivedLabelColumn: null },
      ],
      pairedDomains: false,
      nonParticipationCohort: null,
      expectedCohorts: ["active"],
      perItemMetrics: [],
      // The mapping does not name the CRI question's column. Rather than
      // guessing, the projector requires exactly one column whose answers all
      // belong to the five documented risk categories.
      identifiedMetrics: [
        {
          key: "cri",
          family: "cri",
          unit: "score",
          precision: 1,
          bandSchemeKey: "cri_agregado",
          documentedOptions: CRI_DOCUMENTED_OPTIONS,
          minimumCoverage: 3,
        },
      ],
      columnMetrics: [],
    },
  ],
  bandSchemes: [
    {
      key: "desempeno_mensual",
      label: "Desempeño mensual",
      unit: "score",
      description:
        "Rangos confirmados para la fuente de desempeño de Cuicuilco en docs/CANONICAL_STUDY_MODEL.md. " +
        "No se derivan del color del libro: el color se conserva aparte como evidencia sin interpretar.",
      rules: [
        { lowerBound: 0, upperBound: 29, lowerInclusive: true, upperInclusive: true, label: "0 a 29", semanticColor: "gray" },
        { lowerBound: 30, upperBound: 49, lowerInclusive: true, upperInclusive: true, label: "30 a 49", semanticColor: "red" },
        { lowerBound: 50, upperBound: 69, lowerInclusive: true, upperInclusive: true, label: "50 a 69", semanticColor: "yellow" },
        { lowerBound: 70, upperBound: 100, lowerInclusive: true, upperInclusive: true, label: "70 a 100", semanticColor: "green" },
      ],
    },
    {
      key: "nps_presentacion",
      label: "Bandas de presentación NPS",
      unit: "score",
      description: "docs/CALCULATION_CATALOG.md §3.",
      rules: [
        { lowerBound: -100, upperBound: 60, lowerInclusive: true, upperInclusive: false, label: "menos de 60", semanticColor: "red" },
        { lowerBound: 60, upperBound: 80, lowerInclusive: true, upperInclusive: false, label: "60 a menos de 80", semanticColor: "yellow" },
        { lowerBound: 80, upperBound: 100, lowerInclusive: true, upperInclusive: true, label: "80 a 100", semanticColor: "green" },
      ],
    },
    {
      key: "csat_presentacion",
      label: "Bandas de presentación CSAT",
      unit: "percent",
      description: "docs/CALCULATION_CATALOG.md §4.",
      rules: [
        { lowerBound: 0, upperBound: 60, lowerInclusive: true, upperInclusive: false, label: "menos de 60", semanticColor: "red" },
        { lowerBound: 60, upperBound: 75, lowerInclusive: true, upperInclusive: false, label: "60 a menos de 75", semanticColor: "yellow" },
        { lowerBound: 75, upperBound: 100, lowerInclusive: true, upperInclusive: true, label: "75 a 100", semanticColor: "green" },
      ],
    },
    {
      key: "cri_agregado",
      label: "Bandas agregadas CRI",
      unit: "score",
      description: "docs/CALCULATION_CATALOG.md §6.",
      rules: [
        { lowerBound: 0, upperBound: 30, lowerInclusive: true, upperInclusive: true, label: "zona segura", semanticColor: "safe" },
        { lowerBound: 30, upperBound: 60, lowerInclusive: false, upperInclusive: true, label: "zona de alerta", semanticColor: "alert" },
        { lowerBound: 60, upperBound: 100, lowerInclusive: false, upperInclusive: true, label: "zona de peligro", semanticColor: "danger" },
      ],
    },
  ],
  performance: [
    {
      sheetKey: "perfil_cliente",
      cohortKey: "active",
      dimensionKey: "desempeno_mensual",
      dimensionLabel: "Desempeño mensual",
      bandSchemeKey: "desempeno_mensual",
      metricKey: "desempeno_mensual",
      metricPrecision: 1,
    },
  ],
  retention: [
    {
      sheetKey: "retencion_desercion",
      seriesKey: "membership_retention",
      labelColumn: "A",
      startingColumn: "B",
      newColumn: "C",
      endingColumn: "D",
      lostColumn: "E",
      retentionMetricKey: "retencion",
      churnMetricKey: "desercion",
    },
  ],
  curatedEntities: [
    {
      sheetKey: "journey",
      target: { kind: "journey", modelKey: "journey_miembro", modelLabel: "Journey del miembro", audience: "miembros" },
      keyPrefix: "etapa",
    },
    { sheetKey: "equipos", target: { kind: "organizational_unit" }, keyPrefix: "equipo" },
    { sheetKey: "desempeno", target: { kind: "performance_dimension" }, keyPrefix: "dimension" },
    { sheetKey: "cultura_edl", target: { kind: "culture_dimension", audience: "edl" }, keyPrefix: "cultura_edl" },
    { sheetKey: "cultura_miembros", target: { kind: "culture_dimension", audience: "members" }, keyPrefix: "cultura_miembro" },
  ],
  // The package states no relationship between a journey stage and a metric.
  // It is left empty on purpose; a fabricated link would present a consultant
  // with an association nobody made.
  journeyEvidence: [],
};

export const CANONICAL_PROJECTION_SPECS: Record<string, PackageProjectionSpec> = {
  [CUICUILCO_PROJECTION_V1.specId]: CUICUILCO_PROJECTION_V1,
};
