/**
 * HOW A CANONICAL RECORD SET BECOMES RESULTS — as CONFIGURATION.
 *
 * The calculators know how to compute a documented metric over a documented
 * base. They know nothing about Cuicuilco: which instrument carries the
 * recommendation question, which item is a closed-coded category, which cross an
 * authority forbids, and which touchpoint a revised source broke are all
 * declared here and versioned with the calculation they belong to.
 *
 * A second study is a second `StudyResultsSpec`, not a second code path — the
 * same rule the ingestion and projection layers already follow.
 *
 * NOTHING IN THIS FILE MAY BE A GUESS. Every entry names the authority that
 * supports it, by an id registered in `authorities.ts`, and the gate fails on an
 * id that is not registered.
 */

/** A metric family whose base a scope pools from more than one instrument. */
export type NpsScopeSpec = {
  key: string;
  label: string;
  /** Instrument keys whose answers are pooled. Pooling is a base decision, not a formula. */
  instrumentKeys: string[];
  cohortKeys: string[];
  /** The item that carries the recommendation score, per instrument. */
  itemKeys: string[];
  /** The canonical `metric_definition.key` when the projection declares one. */
  metricKey: string | null;
  authorityIds: string[];
};

export type QualitativeGroupSpec = {
  key: string;
  label: string;
  /** The closed-coded item whose category values are counted. */
  itemKey: string;
  cohortKeys: string[];
  /** Client-safe description of where the categories come from. */
  sourceDescription: string;
  /**
   * Category labels documented as "not a reason": kept OUT of the cloud and
   * COUNTED, because "nine people had no applicable reason" is itself a finding.
   *
   * `canonicalStatus` exists because of a real tension between two layers. The
   * canonical value classifier reads the source token before anything else does
   * and maps some of these spellings to an ABSENCE STATE — «No aplica» becomes
   * `not_applicable` — so the category's own text never reaches the answer. The
   * count is then recovered from that state instead, which is exact rather than
   * approximate: only this one token maps to that state, so the state's count IS
   * the category's count. Where a label survives as text, leave it null.
   */
  excludedLabels: { label: string; canonicalStatus: string | null }[];
  authorityIds: string[];
};

export type ForbiddenCrossSpec = {
  /** A section key of the results document. */
  section: string;
  attributeKey: string;
  authorityId: string;
};

export type ExcludedTouchpointSpec = {
  /** A stable rule id, so a report can say WHY without repeating the prose. */
  ruleId: string;
  /** The item key when the exclusion is keyed to an item this source carries. */
  itemKey: string | null;
  /** The source label the exclusion targets, for a source that carries it by name. */
  label: string | null;
  detail: string;
  authorityId: string;
};

export type StudyResultsSpec = {
  specId: string;
  mappingVersion: number;
  calculationVersion: string;

  /** Cohort keys in presentation order, with the label each is reported under. */
  cohorts: { key: string; label: string; instrumentKey: string | null }[];

  /**
   * Typed attributes that count as a MEASURED DATUM about a person.
   *
   * A roster attribute is not evidence that somebody took part in the study —
   * a name, a business sector and a membership date come from the client's own
   * database and exist for everybody. A recorded performance score does count,
   * and for the cohort whose performance is carried as a profile column rather
   * than as a monthly observation this is where that column is named.
   */
  measuredDatumAttributeKeys: string[];

  /** The instrument whose items are the journey's measured touchpoints. */
  journeyInstrumentKey: string;
  /** 1–5 satisfaction, satisfied from 4 — declared, never guessed from the data. */
  satisfactionScale: { min: number; max: number; satisfiedFrom: number };
  /**
   * How an answer is recognised as "did not know this process".
   * Both paths are documented: the scale's own derived label, and the raw option
   * text the instrument offers.
   */
  unawareness: { derivedLabels: string[]; rawValues: string[] };

  recommendation: { scale: { min: number; max: number }; scopes: NpsScopeSpec[] };

  renewal: {
    instrumentKey: string;
    itemKey: string;
    metricKey: string | null;
    authorityIds: string[];
  };

  retention: { seriesKey: string; retentionMetricKey: string | null; churnMetricKey: string | null };

  qualitative: QualitativeGroupSpec[];

  /** Items whose TEXT the adapter may carry. Everything else loses its words. */
  closedCodedItemKeys: string[];
  /** Attribute definitions whose TEXT the adapter may carry, for filtering. */
  closedCodedAttributePrefixes: string[];

  forbiddenCrosses: ForbiddenCrossSpec[];
  excludedTouchpoints: ExcludedTouchpointSpec[];

  /** Band schemes used to LABEL a band. The ranges live in the canonical functions. */
  bandSchemeKeys: { nps: string; csat: string; cri: string; performance: string };
};

/**
 * BNI Cuicuilco, mapping version 1.
 *
 * Item and instrument keys are the projector's own: an item key is
 * `<instrument>_<column letter>` and a domain key is the package specification's
 * domain key, so every key below is traceable to a column of the source.
 */
export const CUICUILCO_RESULTS_V1: StudyResultsSpec = {
  specId: "cuicuilco",
  mappingVersion: 1,
  calculationVersion: "catalogo-2026-08-19",

  cohorts: [
    { key: "active", label: "Miembros activos", instrumentKey: "csat" },
    { key: "deserter", label: "Desertores", instrumentKey: "nps_desertores" },
  ],

  // Column N of the deserter profile is that cohort's own `Desempeño` figure —
  // the counterpart of the nine monthly columns the active cohort carries. It
  // is the only profile column that is a measurement rather than roster data.
  measuredDatumAttributeKeys: ["perfil_desertores_n"],

  journeyInstrumentKey: "csat",
  satisfactionScale: { min: 1, max: 5, satisfiedFrom: 4 },
  unawareness: {
    derivedLabels: ["Desconocimiento"],
    rawValues: [
      "No lo conozco/No lo he utilizado/No he interactuado",
      "No lo conozco",
      "No lo he utilizado",
      "No he interactuado",
    ],
  },

  recommendation: {
    scale: { min: 1, max: 10 },
    scopes: [
      {
        key: "combinado",
        label: "Activos y desertores",
        instrumentKeys: ["nps_activos", "nps_desertores"],
        cohortKeys: ["active", "deserter"],
        itemKeys: ["nps_activos_d", "nps_desertores_d"],
        // The projection declares one metric per instrument, so the pooled scope
        // has no canonical metric key of its own. The FORMULA is unchanged; only
        // the base is wider, and the base is stated on the result.
        metricKey: null,
        authorityIds: ["methodology-4-1-nps", "catalog-3-nps", "workbook-nps-scale"],
      },
      {
        key: "activos",
        label: "Miembros activos",
        instrumentKeys: ["nps_activos"],
        cohortKeys: ["active"],
        itemKeys: ["nps_activos_d"],
        metricKey: "nps_activos",
        authorityIds: ["methodology-4-1-nps", "catalog-3-nps", "workbook-nps-scale"],
      },
      {
        key: "desertores",
        label: "Desertores",
        instrumentKeys: ["nps_desertores"],
        cohortKeys: ["deserter"],
        itemKeys: ["nps_desertores_d"],
        metricKey: "nps_desertores",
        authorityIds: ["methodology-4-1-nps", "catalog-3-nps", "workbook-nps-scale"],
      },
    ],
  },

  renewal: {
    instrumentKey: "cri",
    itemKey: "cri_d",
    metricKey: "cri",
    authorityIds: ["methodology-4-1-cri", "catalog-6-cri"],
  },

  retention: {
    seriesKey: "membership_retention",
    retentionMetricKey: "retencion",
    churnMetricKey: "desercion",
  },

  qualitative: [
    {
      key: "activos",
      label: "Miembros activos",
      itemKey: "cri_e",
      cohortKeys: ["active"],
      sourceDescription: "Categorías curadas de la pregunta abierta del índice de renovación",
      // §6.1: «Excluir de la nube la categoría No aplica.» El clasificador
      // canónico convierte ese token en el estado de ausencia `not_applicable`
      // antes de que la columna de categoría se lea, así que su conteo se
      // recupera desde ese estado y no desde el texto de la respuesta.
      excludedLabels: [{ label: "No aplica", canonicalStatus: "not_applicable" }],
      authorityIds: ["methodology-4-1-cri", "approved-dashboard"],
    },
    {
      key: "desertores",
      label: "Desertores",
      itemKey: "nps_desertores_f",
      cohortKeys: ["deserter"],
      sourceDescription: "Categorías curadas de la encuesta de salida",
      excludedLabels: [{ label: "No aplica", canonicalStatus: "not_applicable" }],
      authorityIds: ["methodology-4-1-nps", "approved-dashboard"],
    },
  ],

  // The renewal question and the two curated category columns, and nothing
  // else. Each carries a small, documented set of closed answers. The free-text
  // columns beside them (`cri_f`, `nps_desertores_g`) are absent on purpose: an
  // item that is not on this list reaches the read model with its status and
  // WITHOUT its words, so a verbatim cannot be aggregated even by mistake.
  closedCodedItemKeys: ["cri_d", "cri_e", "nps_desertores_f"],
  closedCodedAttributePrefixes: ["perfil_cliente_", "perfil_desertores_"],

  forbiddenCrosses: [
    // «OJO: La esfera no se debe cruzar en este KPI» — §5.2, said of the CRI.
    // Column H of the active profile sheet is Esfera.
    { section: "renewal", attributeKey: "perfil_cliente_h", authorityId: "methodology-5-2-esfera-cri" },
  ],

  excludedTouchpoints: [
    {
      ruleId: "revised-csv-ref-error-duplicate",
      // The canonical source is the workbook, whose single `Capitanes de Esfera`
      // column (CSAT!AX/AY) is populated and is NOT excluded. The exclusion
      // targets the revised CSV's SECOND, broken copy of that touchpoint.
      itemKey: null,
      label: "Capitanes de Esfera",
      detail:
        "El CSV revisado del recorrido lleva «Capitanes de Esfera» dos veces y una de las dos " +
        "columnas está rota: sus 19 celdas de datos son el token de error #REF!. Esa columna " +
        "queda excluida de todo cálculo y de toda salida del recorrido. El libro limpio — que " +
        "es la fuente canónica — lleva ese punto de contacto UNA sola vez y poblado, así que " +
        "esta regla no lo retira del recorrido cuando la fuente es el libro.",
      authorityId: "revised-journey-csv",
    },
  ],

  bandSchemeKeys: {
    nps: "nps_presentacion",
    csat: "csat_presentacion",
    cri: "cri_agregado",
    performance: "desempeno_mensual",
  },
};

export const CANONICAL_RESULTS_SPECS: Record<string, StudyResultsSpec> = {
  [CUICUILCO_RESULTS_V1.specId]: CUICUILCO_RESULTS_V1,
};
