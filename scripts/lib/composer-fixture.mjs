// =============================================================================
// A SMALL SYNTHETIC STUDY, built for the composer gate and for nothing else.
// =============================================================================
// `canonical-presentation-test.mjs` carries its own fixture, shaped like the
// real study at full size — 55 touchpoints across four groups — because it is
// proving things about the SHAPE of the registry. The composer gate is proving
// things about an EDITOR, and an editor does not care how many touchpoints
// there are. So this fixture is deliberately the smallest source that still
// produces one of each thing an editor has to reason about:
//
//   • two filter dimensions, one of which («Esfera») an AUTHORITY forbids
//     crossing with the renewal index — that pairing is the only way to reach
//     `forbidden_filter_cross` honestly, and a gate that reached it by hand
//     would be asserting its own mock rather than the contract's rule;
//   • a renewal index, so the forbidden cross has something to be forbidden with;
//   • a recommendation score and its distribution, which DO accept both
//     dimensions, so `unsupported_filter_dimension` and `forbidden_filter_cross`
//     can be told apart by a test rather than assumed to differ;
//   • a journey group with touchpoints, so a route block has a source;
//   • at least one configuration requirement, which is where an editorial slot
//     handle comes from.
//
// Every number here is invented. No client workbook, name, answer, quote or
// identifier is committed to this file, and the two UUIDs are literal zeros with
// a marker tail.
// =============================================================================

import { CUICUILCO_RESULTS_V1, buildCanonicalStudyResults, emptyResultSource } from "../../src/lib/results/index.ts";

const SPEC = CUICUILCO_RESULTS_V1;
const UNAWARE_RAW = SPEC.unawareness.rawValues[0];

export const FIXTURE_IDENTITY = Object.freeze({
  specId: "cuicuilco",
  mappingVersion: 1,
  calculationVersion: SPEC.calculationVersion,
  tenantId: "00000000-0000-4000-8000-00000000c0m1",
  studyId: "00000000-0000-4000-8000-00000000c0m2",
  packageIdempotencyKey: "sha256:fixture-composer",
  planFingerprint: "sha256:fixture-composer-plan",
});

/** Two source groups, three touchpoints each. Enough to be a journey, not more. */
const GROUPS = [
  { key: "interacciones_operacion", label: "Interacciones y operación", size: 3 },
  { key: "rendicion_cuentas", label: "Rendición de cuentas", size: 3 },
];

const SCALE_OPTIONS = [
  {
    scaleKey: "satisfaccion_csat",
    rawValue: UNAWARE_RAW,
    numericValue: null,
    derivedLabel: "Desconocimiento",
    displayOrder: 0,
  },
  ...[1, 2, 3, 4, 5].map((value, index) => ({
    scaleKey: "satisfaccion_csat",
    rawValue: String(value),
    numericValue: value,
    derivedLabel: value >= 4 ? "Satisfecho" : "Insatisfecho",
    displayOrder: index + 1,
  })),
  ...Array.from({ length: 10 }, (_, index) => ({
    scaleKey: "recomendacion_nps",
    rawValue: String(index + 1),
    numericValue: index + 1,
    derivedLabel: index + 1 >= 9 ? "Promotor" : index + 1 >= 7 ? "Pasivo" : "Detractor",
    displayOrder: index,
  })),
];

const BAND_SCHEMES = [
  {
    key: "nps_presentacion",
    label: "Bandas NPS",
    unit: "score",
    description: "fixture",
    rules: [
      { schemeKey: "nps_presentacion", lowerBound: -100, upperBound: 60, lowerInclusive: true, upperInclusive: false, label: "menos de 60", semanticColor: "red", displayOrder: 0 },
      { schemeKey: "nps_presentacion", lowerBound: 60, upperBound: 100, lowerInclusive: true, upperInclusive: true, label: "60 a 100", semanticColor: "green", displayOrder: 1 },
    ],
  },
  {
    key: "csat_presentacion",
    label: "Bandas CSAT",
    unit: "percent",
    description: "fixture",
    rules: [
      { schemeKey: "csat_presentacion", lowerBound: 0, upperBound: 75, lowerInclusive: true, upperInclusive: false, label: "menos de 75", semanticColor: "yellow", displayOrder: 0 },
      { schemeKey: "csat_presentacion", lowerBound: 75, upperBound: 100, lowerInclusive: true, upperInclusive: true, label: "75 a 100", semanticColor: "green", displayOrder: 1 },
    ],
  },
  {
    key: "cri_agregado",
    label: "Bandas CRI",
    unit: "score",
    description: "fixture",
    rules: [
      { schemeKey: "cri_agregado", lowerBound: 0, upperBound: 30, lowerInclusive: true, upperInclusive: true, label: "zona segura", semanticColor: "safe", displayOrder: 0 },
      { schemeKey: "cri_agregado", lowerBound: 30, upperBound: 60, lowerInclusive: false, upperInclusive: true, label: "zona de alerta", semanticColor: "alert", displayOrder: 1 },
      { schemeKey: "cri_agregado", lowerBound: 60, upperBound: 100, lowerInclusive: false, upperInclusive: true, label: "zona de peligro", semanticColor: "danger", displayOrder: 2 },
    ],
  },
];

const ACTIVE = ["a1", "a2", "a3", "a4", "a5"];
const DESERTERS = ["d1", "d2"];

const itemKeyFor = (groupIndex, position) => `csat_g${groupIndex}p${position}`;

/** The raw source. Exported so a gate may perturb one field and rebuild. */
export function composerFixtureSource() {
  const source = emptyResultSource(FIXTURE_IDENTITY);

  source.participants = [
    ...ACTIVE.map((id) => ({
      participantId: id,
      cohortKey: "active",
      participationStatus: "included",
      surveyParticipationStatus: "unknown",
      sourceStatus: "answered",
    })),
    ...DESERTERS.map((id) => ({
      participantId: id,
      cohortKey: "deserter",
      participationStatus: "included",
      surveyParticipationStatus: "responded",
      sourceStatus: "answered",
    })),
  ];

  source.attributeDefinitions = [
    { key: "perfil_cliente_e", label: "Generación", dataType: "category", sensitivity: "internal", filterable: true, displayOrder: 0 },
    // Column H of the active profile sheet is Esfera — the dimension §5.2
    // forbids crossing with the renewal index. It is here for exactly that.
    { key: "perfil_cliente_h", label: "Esfera", dataType: "category", sensitivity: "internal", filterable: true, displayOrder: 1 },
  ];

  source.attributeValues = [
    ...ACTIVE.map((id, index) => ({
      participantId: id,
      attributeKey: "perfil_cliente_e",
      status: "answered",
      text: index < 3 ? "Generación X" : "Millenial",
      numeric: null,
    })),
    ...ACTIVE.map((id, index) => ({
      participantId: id,
      attributeKey: "perfil_cliente_h",
      status: "answered",
      text: index % 2 === 0 ? "Esfera Norte" : "Esfera Sur",
      numeric: null,
    })),
  ];

  source.instruments = [
    { key: "csat", label: "CSAT", audience: "miembros_activos", instrumentType: "survey" },
    { key: "nps_activos", label: "NPS", audience: "miembros_activos", instrumentType: "survey" },
    { key: "nps_desertores", label: "NPS desertores", audience: "miembros_desertores", instrumentType: "exit" },
    { key: "cri", label: "CRI", audience: "miembros_activos", instrumentType: "index" },
  ];

  source.domains = GROUPS.map((group, index) => ({
    key: group.key,
    label: group.label,
    instrumentKey: "csat",
    displayOrder: index,
    groupedByMergedRange: true,
  }));

  const journeyItems = [];
  GROUPS.forEach((group, groupIndex) => {
    for (let position = 1; position <= group.size; position += 1) {
      journeyItems.push({
        key: itemKeyFor(groupIndex, position),
        label: `En una escala del 1 al 5, ¿qué tan satisfecho estás con el punto ${groupIndex + 1}.${position}?`,
        instrumentKey: "csat",
        domainKey: group.key,
        scaleKey: "satisfaccion_csat",
        itemOrder: position - 1,
      });
    }
  });

  source.items = [
    ...journeyItems,
    { key: "nps_activos_d", label: "Recomendación", instrumentKey: "nps_activos", domainKey: null, scaleKey: "recomendacion_nps", itemOrder: 0 },
    { key: "nps_desertores_d", label: "Recomendación salida", instrumentKey: "nps_desertores", domainKey: null, scaleKey: "recomendacion_nps", itemOrder: 0 },
    { key: "nps_desertores_f", label: "Categoría razón", instrumentKey: "nps_desertores", domainKey: null, scaleKey: null, itemOrder: 1 },
    { key: "cri_d", label: "Renovación", instrumentKey: "cri", domainKey: null, scaleKey: null, itemOrder: 0 },
    { key: "cri_e", label: "Categoría de riesgo", instrumentKey: "cri", domainKey: null, scaleKey: null, itemOrder: 1 },
  ];

  source.scaleOptions = SCALE_OPTIONS;
  source.bandSchemes = BAND_SCHEMES;

  source.sessions = [
    ...ACTIVE.map((id) => ({ sessionId: `s-csat-${id}`, instrumentKey: "csat", participantId: id, status: "answered" })),
    ...ACTIVE.map((id) => ({ sessionId: `s-nps-${id}`, instrumentKey: "nps_activos", participantId: id, status: "answered" })),
    ...ACTIVE.map((id) => ({ sessionId: `s-cri-${id}`, instrumentKey: "cri", participantId: id, status: "answered" })),
    ...DESERTERS.map((id) => ({ sessionId: `s-exit-${id}`, instrumentKey: "nps_desertores", participantId: id, status: "answered" })),
  ];

  const option = (scaleKey, raw) =>
    SCALE_OPTIONS.find((candidate) => candidate.scaleKey === scaleKey && candidate.rawValue === raw);

  const answers = [];
  GROUPS.forEach((group, groupIndex) => {
    for (let position = 1; position <= group.size; position += 1) {
      const itemKey = itemKeyFor(groupIndex, position);
      const pattern = ["5", "4", "4", "2", UNAWARE_RAW];
      ACTIVE.forEach((id, index) => {
        const found = option("satisfaccion_csat", pattern[index]);
        answers.push({
          sessionId: `s-csat-${id}`,
          itemKey,
          status: "answered",
          numeric: found?.numericValue ?? null,
          text: null,
          optionRawValue: found?.rawValue ?? null,
          derivedLabel: found?.derivedLabel ?? null,
        });
      });
    }
  });

  ACTIVE.forEach((id, index) => {
    const found = option("recomendacion_nps", String([10, 9, 8, 7, 3][index]));
    answers.push({
      sessionId: `s-nps-${id}`,
      itemKey: "nps_activos_d",
      status: "answered",
      numeric: found?.numericValue ?? null,
      text: null,
      optionRawValue: found?.rawValue ?? null,
      derivedLabel: found?.derivedLabel ?? null,
    });
    answers.push({
      sessionId: `s-cri-${id}`,
      itemKey: "cri_d",
      status: "answered",
      numeric: null,
      text: ["Extremadamente probable", "Muy probable", "Algo probable", "Poco probable", "Nada probable"][index],
      optionRawValue: null,
      derivedLabel: null,
    });
    answers.push({
      sessionId: `s-cri-${id}`,
      itemKey: "cri_e",
      status: "answered",
      numeric: null,
      text: ["Malos resultados financieros", "Tiempo", "Tiempo", "Situaciones personales", "Tiempo"][index],
      optionRawValue: null,
      derivedLabel: null,
    });
  });

  DESERTERS.forEach((id, index) => {
    const found = option("recomendacion_nps", String([8, 4][index]));
    answers.push({
      sessionId: `s-exit-${id}`,
      itemKey: "nps_desertores_d",
      status: "answered",
      numeric: found?.numericValue ?? null,
      text: null,
      optionRawValue: found?.rawValue ?? null,
      derivedLabel: found?.derivedLabel ?? null,
    });
    answers.push({
      sessionId: `s-exit-${id}`,
      itemKey: "nps_desertores_f",
      status: "answered",
      numeric: null,
      text: ["Otra oportunidad", "Cambio de titular"][index],
      optionRawValue: null,
      derivedLabel: null,
    });
  });

  source.answers = answers;

  source.retentionPeriods = [
    {
      seriesKey: "membership_retention",
      order: 0,
      label: "periodo uno",
      startsOn: null,
      endsOn: null,
      starting: { count: 10, status: "answered" },
      joined: { count: 4, status: "answered" },
      ending: { count: 12, status: "answered" },
      lost: { count: 2, status: "answered" },
      identityVerified: true,
    },
  ];

  // A curated journey model with one confirmed and one pending finding is what
  // makes the contract emit its CONFIGURATION REQUIREMENTS, and those are where
  // the editorial-slot handles come from. Without them an editor would have no
  // editorial binding to offer and the gate could not test one.
  source.journeyModels = [
    { key: "journey_miembro", label: "Journey del miembro", audience: "miembros", displayOrder: 0 },
  ];
  source.journeyStages = [
    { key: "etapa_1", label: "Etapa uno", journeyModelKey: "journey_miembro", stageOrder: 0 },
  ];
  source.curatedFindings = [
    {
      reviewStatus: "confirmed",
      journeyStageKeys: ["etapa_1"],
      organizationalUnitKeys: [],
      performanceDimensionKeys: [],
      cultureDimensionKeys: [],
    },
  ];

  return source;
}

/** The finished canonical results document this fixture stands for. */
export function composerFixtureResults() {
  return buildCanonicalStudyResults(composerFixtureSource(), { spec: SPEC });
}
