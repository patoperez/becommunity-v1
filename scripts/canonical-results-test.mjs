// =============================================================================
// MANDATORY canonical results gate
//   npx tsx scripts/canonical-results-test.mjs
// =============================================================================
// Unit 5 turns a canonical record set into a versioned, aggregate-only results
// document that a future dashboard RECEIVES rather than computes. This gate
// proves four separable things, entirely from SYNTHETIC fixtures built here.
//
//   THE ARITHMETIC. A population is not a denominator; an absence is not a
//   zero; a zero IS a result; a small base is reported and never withheld; a
//   filter is evaluated over people BEFORE anything is aggregated, and a
//   selection that matches nobody produces "no result", never a measured zero.
//
//   THE ORDERING AND THE GROUPING. Touchpoints keep the source's own grouping
//   and the source's own order, a broken column is excluded and REPORTED, and
//   two builds of the same record set are byte-identical.
//
//   THE BOUNDARY. Nothing in `src/lib/results` reaches a transport; no React
//   component or browser module owns a business formula; the document carries
//   no respondent row and no free text; and every rounded value is rounded
//   exactly once, at the precision its unit declares.
//
//   THE HONESTY. A relationship no authority states is emitted as UNRESOLVED
//   with a gap report, a conflict between two authorities is emitted as a
//   conflict, and every authority a result cites is registered.
//
// No client workbook, name, answer or identifier is committed to this file.
// The real-workbook parity gate is `npm run test:canonical-results-parity`,
// deliberately outside `npm test` because its inputs are machine-specific.
// =============================================================================

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import { DECIMALS, roundTo } from "../src/lib/calc/metrics.ts";
import { formatNumber } from "../src/lib/calc/format.ts";
import {
  csatBand,
  criBand,
  npsBand,
  processUnawarenessTdp,
  unawarenessShareOfResponses,
} from "../src/lib/calc/business-metrics.ts";
import {
  AUTHORITIES,
  CANONICAL_RESULTS_CONTRACT_VERSION,
  CUICUILCO_RESULTS_V1,
  buildCanonicalStudyResults,
  buildFilterDimensions,
} from "../src/lib/results/index.ts";

let failures = 0;
const ok = (m) => console.log("  ✓", m);
const bad = (m) => {
  console.error("  ✗ FALLO:", m);
  failures += 1;
};
const check = (condition, message) => (condition ? ok(message) : bad(message));
const eq = (label, actual, expected) =>
  Object.is(actual, expected)
    ? ok(`${label} = ${String(expected)}`)
    : bad(`${label}: se esperaba ${String(expected)}, se obtuvo ${String(actual)}`);
/** Source text with comments removed, so a scan measures code and not prose. */
const stripComments = (code) => code.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
const throws = (label, fn) => {
  try {
    fn();
    bad(`${label}: se esperaba una excepción`);
  } catch {
    ok(`${label} rechaza la entrada`);
  }
};

console.log("Be Community — compuerta del modelo canónico de resultados");
console.log("=".repeat(74));

/* -------------------------------------------------------------------------- */
/* synthetic record set                                                        */
/* -------------------------------------------------------------------------- */

const SPEC = CUICUILCO_RESULTS_V1;
const IDENTITY = {
  specId: "cuicuilco",
  mappingVersion: 1,
  calculationVersion: SPEC.calculationVersion,
  tenantId: "00000000-0000-4000-8000-00000000f001",
  studyId: "00000000-0000-4000-8000-00000000f002",
  packageIdempotencyKey: "sha256:fixture",
  planFingerprint: "sha256:fixture-plan",
};

const UNAWARE_RAW = SPEC.unawareness.rawValues[0];

const SCALE_OPTIONS = [
  { scaleKey: "satisfaccion_csat", rawValue: UNAWARE_RAW, numericValue: null, derivedLabel: "Desconocimiento", displayOrder: 0 },
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
    label: "Bandas de presentación NPS",
    unit: "score",
    description: "fixture",
    rules: [
      { schemeKey: "nps_presentacion", lowerBound: -100, upperBound: 60, lowerInclusive: true, upperInclusive: false, label: "menos de 60", semanticColor: "red", displayOrder: 0 },
      { schemeKey: "nps_presentacion", lowerBound: 60, upperBound: 80, lowerInclusive: true, upperInclusive: false, label: "60 a menos de 80", semanticColor: "yellow", displayOrder: 1 },
      { schemeKey: "nps_presentacion", lowerBound: 80, upperBound: 100, lowerInclusive: true, upperInclusive: true, label: "80 a 100", semanticColor: "green", displayOrder: 2 },
    ],
  },
  {
    key: "csat_presentacion",
    label: "Bandas de presentación CSAT",
    unit: "percent",
    description: "fixture",
    rules: [
      { schemeKey: "csat_presentacion", lowerBound: 0, upperBound: 60, lowerInclusive: true, upperInclusive: false, label: "menos de 60", semanticColor: "red", displayOrder: 0 },
      { schemeKey: "csat_presentacion", lowerBound: 60, upperBound: 75, lowerInclusive: true, upperInclusive: false, label: "60 a menos de 75", semanticColor: "yellow", displayOrder: 1 },
      { schemeKey: "csat_presentacion", lowerBound: 75, upperBound: 100, lowerInclusive: true, upperInclusive: true, label: "75 a 100", semanticColor: "green", displayOrder: 2 },
    ],
  },
  {
    key: "cri_agregado",
    label: "Bandas agregadas CRI",
    unit: "score",
    description: "fixture",
    rules: [
      { schemeKey: "cri_agregado", lowerBound: 0, upperBound: 30, lowerInclusive: true, upperInclusive: true, label: "zona segura", semanticColor: "safe", displayOrder: 0 },
      { schemeKey: "cri_agregado", lowerBound: 30, upperBound: 60, lowerInclusive: false, upperInclusive: true, label: "zona de alerta", semanticColor: "alert", displayOrder: 1 },
      { schemeKey: "cri_agregado", lowerBound: 60, upperBound: 100, lowerInclusive: false, upperInclusive: true, label: "zona de peligro", semanticColor: "danger", displayOrder: 2 },
    ],
  },
  {
    key: "desempeno_mensual",
    label: "Desempeño mensual",
    unit: "score",
    description: "fixture",
    rules: [
      { schemeKey: "desempeno_mensual", lowerBound: 0, upperBound: 29, lowerInclusive: true, upperInclusive: true, label: "0 a 29", semanticColor: "gray", displayOrder: 0 },
      { schemeKey: "desempeno_mensual", lowerBound: 30, upperBound: 49, lowerInclusive: true, upperInclusive: true, label: "30 a 49", semanticColor: "red", displayOrder: 1 },
      { schemeKey: "desempeno_mensual", lowerBound: 50, upperBound: 69, lowerInclusive: true, upperInclusive: true, label: "50 a 69", semanticColor: "yellow", displayOrder: 2 },
      { schemeKey: "desempeno_mensual", lowerBound: 70, upperBound: 100, lowerInclusive: true, upperInclusive: true, label: "70 a 100", semanticColor: "green", displayOrder: 3 },
    ],
  },
];

/** Six active participants and four former ones, with a deliberate mix of states. */
function baseSource(overrides = {}) {
  const activeIds = ["a1", "a2", "a3", "a4", "a5", "a6"];
  const deserterIds = ["d1", "d2", "d3", "d4"];

  const participants = [
    ...activeIds.map((id) => ({
      participantId: id,
      cohortKey: "active",
      participationStatus: "included",
      // The active profile sheet carries no participation column, so the
      // projection plans every active participant as `unknown`. The population
      // reader must resolve that from the cohort's own instrument, not read it
      // as "did not answer".
      surveyParticipationStatus: "unknown",
      sourceStatus: "answered",
    })),
    ...deserterIds.map((id, index) => ({
      participantId: id,
      cohortKey: "deserter",
      participationStatus: "included",
      surveyParticipationStatus: index < 2 ? "responded" : "not_participated",
      sourceStatus: index < 2 ? "answered" : "not_participated",
    })),
  ];

  const attributeDefinitions = [
    { key: "perfil_cliente_d", label: "Rango de edad", dataType: "category", sensitivity: "internal", filterable: true, displayOrder: 0 },
    { key: "perfil_cliente_h", label: "Esfera", dataType: "category", sensitivity: "internal", filterable: true, displayOrder: 1 },
    { key: "perfil_cliente_a", label: "Marca temporal", dataType: "date", sensitivity: "private", filterable: false, displayOrder: 2 },
    { key: "perfil_desertores_n", label: "Desempeño", dataType: "number", sensitivity: "internal", filterable: true, displayOrder: 3 },
  ];

  const attributeValues = [
    ...activeIds.map((id, index) => ({
      participantId: id,
      attributeKey: "perfil_cliente_d",
      status: index === 5 ? "source_unavailable" : "answered",
      text: index === 5 ? null : index < 3 ? "Rango A" : "Rango B",
      numeric: null,
    })),
    ...activeIds.map((id, index) => ({
      participantId: id,
      attributeKey: "perfil_cliente_h",
      status: "answered",
      text: index % 2 === 0 ? "Esfera Norte" : "Esfera Sur",
      numeric: null,
    })),
    // A private definition's value must never survive the adapter; the record
    // set is asserted to carry none, and this entry exists so the assertion has
    // something to fail on if the rule is ever relaxed.
    ...activeIds.map((id) => ({
      participantId: id,
      attributeKey: "perfil_cliente_a",
      status: "answered",
      text: "SENTINEL-PRIVADO-MARCA-TEMPORAL",
      numeric: null,
    })),
    // Two of the four former members have a recorded performance figure; one of
    // those two also answered the exit survey.
    { participantId: "d1", attributeKey: "perfil_desertores_n", status: "answered", text: null, numeric: 55 },
    { participantId: "d3", attributeKey: "perfil_desertores_n", status: "answered", text: null, numeric: 40 },
    { participantId: "d2", attributeKey: "perfil_desertores_n", status: "source_unavailable", text: null, numeric: null },
    { participantId: "d4", attributeKey: "perfil_desertores_n", status: "source_unavailable", text: null, numeric: null },
  ];

  const instruments = [
    { key: "csat", label: "CSAT", audience: "miembros_activos", instrumentType: "survey" },
    { key: "nps_activos", label: "NPS", audience: "miembros_activos", instrumentType: "survey" },
    { key: "nps_desertores", label: "NPS desertores", audience: "miembros_desertores", instrumentType: "exit" },
    { key: "cri", label: "CRI", audience: "miembros_activos", instrumentType: "index" },
  ];

  const domains = [
    { key: "interacciones_operacion", label: "Interacciones y operación", instrumentKey: "csat", displayOrder: 0, groupedByMergedRange: true },
    { key: "rendicion_cuentas", label: "Rendición de cuentas", instrumentKey: "csat", displayOrder: 1, groupedByMergedRange: true },
  ];

  const items = [
    { key: "csat_d", label: "Pregunta [Punto uno]", instrumentKey: "csat", domainKey: "interacciones_operacion", scaleKey: "satisfaccion_csat", itemOrder: 0 },
    { key: "csat_f", label: "Pregunta [Punto dos]", instrumentKey: "csat", domainKey: "interacciones_operacion", scaleKey: "satisfaccion_csat", itemOrder: 1 },
    // The broken column: every one of its cells is a spreadsheet error.
    { key: "csat_h", label: "Capitanes de Esfera", instrumentKey: "csat", domainKey: "interacciones_operacion", scaleKey: "satisfaccion_csat", itemOrder: 2 },
    // A SECOND broken column, under a name no rule mentions: it must still be
    // excluded, under the general rule rather than the named one.
    { key: "csat_j", label: "Pregunta [Punto roto sin nombre]", instrumentKey: "csat", domainKey: "interacciones_operacion", scaleKey: "satisfaccion_csat", itemOrder: 3 },
    { key: "csat_bj", label: "Pregunta [Punto tres]", instrumentKey: "csat", domainKey: "rendicion_cuentas", scaleKey: "satisfaccion_csat", itemOrder: 0 },
    { key: "nps_activos_d", label: "Recomendación", instrumentKey: "nps_activos", domainKey: null, scaleKey: "recomendacion_nps", itemOrder: 0 },
    { key: "nps_desertores_d", label: "Recomendación salida", instrumentKey: "nps_desertores", domainKey: null, scaleKey: "recomendacion_nps", itemOrder: 0 },
    { key: "nps_desertores_f", label: "Categoría razón", instrumentKey: "nps_desertores", domainKey: null, scaleKey: null, itemOrder: 1 },
    { key: "nps_desertores_g", label: "Razón textual", instrumentKey: "nps_desertores", domainKey: null, scaleKey: null, itemOrder: 2 },
    { key: "cri_d", label: "Renovación", instrumentKey: "cri", domainKey: null, scaleKey: null, itemOrder: 0 },
    { key: "cri_e", label: "Categoría de riesgo", instrumentKey: "cri", domainKey: null, scaleKey: null, itemOrder: 1 },
    { key: "cri_f", label: "Razón textual", instrumentKey: "cri", domainKey: null, scaleKey: null, itemOrder: 2 },
  ];

  const sessions = [
    ...activeIds.map((id) => ({ sessionId: `s-csat-${id}`, instrumentKey: "csat", participantId: id, status: "answered" })),
    ...activeIds.map((id) => ({ sessionId: `s-nps-${id}`, instrumentKey: "nps_activos", participantId: id, status: "answered" })),
    ...activeIds.map((id) => ({ sessionId: `s-cri-${id}`, instrumentKey: "cri", participantId: id, status: "answered" })),
    { sessionId: "s-exit-d1", instrumentKey: "nps_desertores", participantId: "d1", status: "answered" },
    { sessionId: "s-exit-d2", instrumentKey: "nps_desertores", participantId: "d2", status: "answered" },
    { sessionId: "s-exit-d3", instrumentKey: "nps_desertores", participantId: "d3", status: "not_participated" },
    { sessionId: "s-exit-d4", instrumentKey: "nps_desertores", participantId: "d4", status: "not_participated" },
  ];

  const answer = (sessionId, itemKey, raw, status = "answered") => {
    const option = SCALE_OPTIONS.find(
      (candidate) =>
        candidate.rawValue === raw &&
        (itemKey.startsWith("csat") ? candidate.scaleKey === "satisfaccion_csat" : candidate.scaleKey === "recomendacion_nps"),
    );
    return {
      sessionId,
      itemKey,
      status,
      numeric: status === "answered" ? option?.numericValue ?? null : null,
      text: null,
      optionRawValue: option?.rawValue ?? null,
      derivedLabel: option?.derivedLabel ?? null,
    };
  };

  // csat_d: 4,5,5,3,1 and one unaware  -> satisfied 3, dissatisfied 2, unaware 1
  const csatD = ["4", "5", "5", "3", "1", UNAWARE_RAW];
  // csat_f: every single answer is a 1 -> a MEASURED CSAT of exactly zero
  const csatF = ["1", "1", "1", "1", "1", "1"];
  // csat_bj: two answers, four absences of different kinds
  const csatBjStatus = ["answered", "answered", "missing", "not_applicable", "source_unavailable", "unknown"];
  const csatBjRaw = ["5", "2", null, null, null, null];

  const answers = [];
  activeIds.forEach((id, index) => {
    answers.push(answer(`s-csat-${id}`, "csat_d", csatD[index]));
    answers.push(answer(`s-csat-${id}`, "csat_f", csatF[index]));
    for (const brokenKey of ["csat_h", "csat_j"]) {
      answers.push({
        sessionId: `s-csat-${id}`,
        itemKey: brokenKey,
        status: "source_unavailable",
        numeric: null,
        text: null,
        optionRawValue: null,
        derivedLabel: null,
      });
    }
    answers.push(
      csatBjStatus[index] === "answered"
        ? answer(`s-csat-${id}`, "csat_bj", csatBjRaw[index])
        : { sessionId: `s-csat-${id}`, itemKey: "csat_bj", status: csatBjStatus[index], numeric: null, text: null, optionRawValue: null, derivedLabel: null },
    );
  });

  // NPS actives: 9,10,7,6,1,4 -> promoters 2, passives 1, detractors 3 -> -16.7
  const npsActive = ["9", "10", "7", "6", "1", "4"];
  activeIds.forEach((id, index) => answers.push(answer(`s-nps-${id}`, "nps_activos_d", npsActive[index])));
  // NPS deserters: 9 and 6 -> promoters 1, detractors 1 -> exactly 0
  answers.push(answer("s-exit-d1", "nps_desertores_d", "9"));
  answers.push(answer("s-exit-d2", "nps_desertores_d", "6"));

  const criAnswers = ["Extremadamente probable", "Muy probable", "Algo probable", "Poco probable", "Nada probable", "Muy probable"];
  activeIds.forEach((id, index) =>
    answers.push({
      sessionId: `s-cri-${id}`,
      itemKey: "cri_d",
      status: "answered",
      numeric: null,
      text: criAnswers[index],
      optionRawValue: null,
      derivedLabel: null,
    }),
  );
  // Coded categories, one of them the documented "not a reason" absence state.
  const criCategories = [
    { status: "answered", text: "Categoría alfa" },
    { status: "answered", text: "Categoría alfa" },
    { status: "answered", text: "Categoría beta" },
    { status: "not_applicable", text: null },
    { status: "not_applicable", text: null },
    { status: "missing", text: null },
  ];
  activeIds.forEach((id, index) =>
    answers.push({
      sessionId: `s-cri-${id}`,
      itemKey: "cri_e",
      status: criCategories[index].status,
      numeric: null,
      text: criCategories[index].text,
      optionRawValue: null,
      derivedLabel: null,
    }),
  );
  // Free text. The adapter would have removed the words; the read model is
  // asserted to carry none, so this sentinel must never appear anywhere.
  activeIds.forEach((id) =>
    answers.push({
      sessionId: `s-cri-${id}`,
      itemKey: "cri_f",
      status: "answered",
      numeric: null,
      text: null,
      optionRawValue: null,
      derivedLabel: null,
    }),
  );
  answers.push({ sessionId: "s-exit-d1", itemKey: "nps_desertores_f", status: "answered", numeric: null, text: "Categoría alfa", optionRawValue: null, derivedLabel: null });
  answers.push({ sessionId: "s-exit-d2", itemKey: "nps_desertores_f", status: "answered", numeric: null, text: "Categoría gamma", optionRawValue: null, derivedLabel: null });

  const retentionPeriods = [
    {
      seriesKey: "membership_retention",
      order: 0,
      label: "periodo uno",
      startsOn: "2025-01-01",
      endsOn: "2025-06-30",
      starting: { count: 8, status: "answered" },
      joined: { count: 4, status: "answered" },
      ending: { count: 10, status: "answered" },
      lost: { count: 2, status: "answered" },
      identityVerified: true,
    },
    {
      seriesKey: "membership_retention",
      order: 1,
      label: "periodo incompleto",
      startsOn: null,
      endsOn: null,
      starting: { count: 10, status: "answered" },
      joined: { count: null, status: "source_unavailable" },
      ending: { count: 10, status: "answered" },
      lost: { count: 1, status: "answered" },
      identityVerified: false,
    },
    {
      seriesKey: "membership_retention",
      order: 2,
      label: "periodo sin padrón",
      startsOn: null,
      endsOn: null,
      starting: { count: 0, status: "answered" },
      joined: { count: 0, status: "answered" },
      ending: { count: 0, status: "answered" },
      lost: { count: 0, status: "answered" },
      identityVerified: true,
    },
    {
      seriesKey: "membership_retention",
      order: 3,
      label: "periodo imposible",
      startsOn: null,
      endsOn: null,
      starting: { count: 5, status: "answered" },
      joined: { count: 9, status: "answered" },
      ending: { count: 6, status: "answered" },
      lost: { count: 1, status: "answered" },
      identityVerified: false,
    },
  ];

  const performanceDimensions = [
    { key: "desempeno_mensual", label: "Desempeño mensual", displayOrder: 0, bandSchemeKey: "desempeno_mensual" },
  ];
  const performanceObservations = [
    { participantId: "a1", dimensionKey: "desempeno_mensual", periodStart: "2025-10-01", periodLabel: "octubre", status: "answered", value: 80 },
    { participantId: "a2", dimensionKey: "desempeno_mensual", periodStart: "2025-10-01", periodLabel: "octubre", status: "answered", value: 0 },
    { participantId: "a3", dimensionKey: "desempeno_mensual", periodStart: "2025-10-01", periodLabel: "octubre", status: "source_unavailable", value: null },
    { participantId: "a1", dimensionKey: "desempeno_mensual", periodStart: "2025-11-01", periodLabel: "noviembre", status: "source_unavailable", value: null },
  ];

  const journeyModels = [{ key: "journey_miembro", label: "Journey del miembro", audience: "miembros", displayOrder: 0 }];
  const journeyStages = [
    { key: "etapa_01", label: "Etapa uno", journeyModelKey: "journey_miembro", stageOrder: 0 },
    { key: "etapa_02", label: "Etapa dos", journeyModelKey: "journey_miembro", stageOrder: 1 },
  ];

  const curatedFindings = [
    { reviewStatus: "pending", journeyStageKeys: ["etapa_01"], organizationalUnitKeys: [], performanceDimensionKeys: [], cultureDimensionKeys: [] },
    { reviewStatus: "pending", journeyStageKeys: ["etapa_01"], organizationalUnitKeys: ["equipo_01"], performanceDimensionKeys: [], cultureDimensionKeys: [] },
  ];

  return {
    identity: IDENTITY,
    participants,
    attributeDefinitions,
    attributeValues,
    instruments,
    domains,
    items,
    scaleOptions: SCALE_OPTIONS,
    sessions,
    answers,
    retentionPeriods,
    performanceDimensions,
    performanceObservations,
    bandSchemes: BAND_SCHEMES,
    metricDefinitions: [],
    journeyModels,
    journeyStages,
    journeyStageEvidence: [],
    organizationalUnits: [{ key: "equipo_01", label: "Equipo uno", displayOrder: 0 }],
    cultureDimensions: [],
    curatedFindings,
    ...overrides,
  };
}

const source = baseSource();
const results = buildCanonicalStudyResults(source);
const touchpoint = (key) => results.journey.touchpoints.find((entry) => entry.key === key);
const scope = (key) => results.recommendation.scopes.find((entry) => entry.key === key);

/* -------------------------------------------------------------------------- */

console.log("\n[1] Contrato y versión");
eq("versión del contrato", results.contractVersion, CANONICAL_RESULTS_CONTRACT_VERSION);
eq("versión de cálculo", results.study.calculationVersion, SPEC.calculationVersion);
check(results.study.planFingerprint === IDENTITY.planFingerprint, "el documento cita la huella del plan que lo produjo");
throws("una versión de mapeo distinta", () =>
  buildCanonicalStudyResults({ ...source, identity: { ...IDENTITY, mappingVersion: 99 } }),
);
throws("un estudio sin especificación de resultados", () =>
  buildCanonicalStudyResults({ ...source, identity: { ...IDENTITY, specId: "otro" } }),
);

console.log("\n[2] Población frente a bases por instrumento");
eq("población del estudio", results.population.total, 10);
eq("cohorte activa", results.population.cohorts.find((c) => c.key === "active").total, 6);
eq("cohorte desertora", results.population.cohorts.find((c) => c.key === "deserter").total, 4);
eq("desertores que respondieron", results.population.cohorts.find((c) => c.key === "deserter").responded, 2);
eq("desertores que no participaron", results.population.cohorts.find((c) => c.key === "deserter").notParticipated, 2);
eq(
  "la cohorte activa sin columna de participación se resuelve desde su instrumento",
  results.population.cohorts.find((c) => c.key === "active").responded,
  6,
);
eq("desertores con dato medido", results.population.cohorts.find((c) => c.key === "deserter").measured, 3);
eq("un atributo de padrón no cuenta como dato medido", results.population.measured, 9);
eq("base del instrumento CSAT", results.population.instruments.find((i) => i.key === "csat").base.valid, 6);
eq("base de recomendación combinada", scope("combinado").score.base.valid, 8);
check(
  results.population.total !== scope("combinado").score.base.valid,
  "la población del estudio NO es el denominador de la recomendación",
);
check(
  results.journey.touchpoints.every((entry) => entry.counts.responses <= results.population.total),
  "ninguna base de punto de contacto excede la población",
);

console.log("\n[3] Recomendación: clasificación, denominador y los tres signos");
eq("NPS activos, negativo", scope("activos").score.value.value, -16.7);
eq("promotores activos", scope("activos").distribution.promoters, 2);
eq("pasivos activos", scope("activos").distribution.passives, 1);
eq("detractores activos", scope("activos").distribution.detractors, 3);
eq("los pasivos permanecen en el denominador", scope("activos").score.base.valid, 6);
eq("NPS desertores, exactamente cero", scope("desertores").score.value.value, 0);
check(scope("desertores").score.status === "available", "un cero medido es un resultado disponible, no una ausencia");
eq("NPS combinado", scope("combinado").score.value.value, roundTo(((3 - 4) / 8) * 100, DECIMALS.nps));
eq("banda del NPS combinado", scope("combinado").score.value.band.semanticColor, npsBand(scope("combinado").score.value.value));
eq("el alcance combinado no reclama clave canónica", scope("combinado").score.provenance.internal.metricKey, null);
{
  const positive = baseSource();
  positive.answers = positive.answers.map((entry) =>
    entry.itemKey === "nps_activos_d" ? { ...entry, numeric: 10, optionRawValue: "10", derivedLabel: "Promotor" } : entry,
  );
  eq("NPS positivo máximo", buildCanonicalStudyResults(positive).recommendation.scopes.find((s) => s.key === "activos").score.value.value, 100);
}
{
  const invalid = baseSource();
  invalid.answers = invalid.answers.map((entry) =>
    entry.itemKey === "nps_activos_d" ? { ...entry, numeric: 11, optionRawValue: "11" } : entry,
  );
  const built = buildCanonicalStudyResults(invalid).recommendation.scopes.find((s) => s.key === "activos");
  eq("una respuesta fuera de escala sale del numerador y del denominador", built.score.base.valid, 0);
  eq("y se contabiliza como fuera de escala", built.score.base.accounting.outOfScale, 6);
  eq("sin respuestas válidas no hay resultado", built.score.status, "unavailable");
  eq("y la razón es explícita", built.score.reason, "no_valid_answers");
}

console.log("\n[4] Recorrido: CSAT, desconocimiento y las dos cantidades");
eq("puntos de contacto reportados", results.journey.touchpoints.length, 3);
eq("grupos", results.journey.groups.length, 2);
eq("orden del primer grupo", JSON.stringify(results.journey.groups[0].touchpointKeys), JSON.stringify(["csat_d", "csat_f"]));
eq("orden del segundo grupo", JSON.stringify(results.journey.groups[1].touchpointKeys), JSON.stringify(["csat_bj"]));
eq("CSAT del punto uno", touchpoint("csat_d").satisfaction.value.value, 60);
eq("base válida del punto uno", touchpoint("csat_d").counts.valid, 5);
eq("respuestas del punto uno", touchpoint("csat_d").counts.responses, 6);
eq("desconocimiento del punto uno", touchpoint("csat_d").counts.unaware, 1);
// TDP is the ratio over the VALID base. That is the official metric of that
// name, settled by the methodology owner on 2026-09-06.
eq(
  "TDP del punto uno, sobre la base válida",
  touchpoint("csat_d").tdp.value.value,
  processUnawarenessTdp(1, 5).value,
);
eq(
  "y su base declarada ES la base válida",
  touchpoint("csat_d").tdp.base.valid,
  touchpoint("csat_d").counts.valid,
);
eq(
  "la proporción auxiliar va sobre todas las respuestas clasificadas",
  touchpoint("csat_d").unawareShareOfResponses.value.value,
  unawarenessShareOfResponses(1, 6).value,
);
eq(
  "y su base declarada es más ancha, como su nombre dice",
  touchpoint("csat_d").unawareShareOfResponses.base.valid,
  touchpoint("csat_d").counts.responses,
);
check(
  touchpoint("csat_d").tdp.value.value !== touchpoint("csat_d").unawareShareOfResponses.value.value,
  "las dos cantidades son distintas y se emiten por separado",
);
{
  // The auxiliary is never LABELLED TDP. Its provenance note may say the
  // words "no es TDP" - that is the point - so the check reads the fields a
  // consumer would render, not the internal caveat.
  const auxiliary = touchpoint("csat_d").unawareShareOfResponses;
  const rendered = [auxiliary.key, auxiliary.label, auxiliary.provenance.explanation].join(" ").toLowerCase();
  check(!rendered.includes("tdp"), "la auxiliar no se llama TDP en ningún campo que un cliente vería");
  const official = touchpoint("csat_d").tdp;
  check(official.key.toLowerCase().startsWith("tdp"), "y el indicador oficial sí lleva ese nombre en su clave");
}
check(
  touchpoint("csat_d").tdp.provenance.internal.notes.some((note) => note.includes("BASE VÁLIDA")),
  "la procedencia del TDP declara su denominador",
);
check(
  touchpoint("csat_d").unawareShareOfResponses.provenance.internal.notes.some((note) =>
    note.includes("no es TDP"),
  ),
  "y la de la auxiliar dice explícitamente que no es TDP",
);
{
  // A touchpoint almost nobody could judge: TDP exceeds 100 and is not clamped.
  const mostlyUnaware = baseSource();
  mostlyUnaware.answers = mostlyUnaware.answers.map((entry, index) =>
    entry.itemKey === "csat_d" && index % 1 === 0
      ? entry
      : entry,
  );
  mostlyUnaware.answers = mostlyUnaware.answers.map((entry) =>
    entry.itemKey === "csat_d"
      ? {
          ...entry,
          numeric: entry.sessionId === "s-csat-a1" ? 5 : null,
          optionRawValue: entry.sessionId === "s-csat-a1" ? "5" : UNAWARE_RAW,
          derivedLabel: entry.sessionId === "s-csat-a1" ? "Satisfecho" : "Desconocimiento",
        }
      : entry,
  );
  const built = buildCanonicalStudyResults(mostlyUnaware);
  const tp = built.journey.touchpoints.find((entry) => entry.key === "csat_d");
  eq("una base válida de uno frente a cinco desconocimientos", tp.counts.valid, 1);
  eq("TDP supera el cien por ciento y no se acota", tp.tdp.value.value, 500);
  eq(
    "mientras la proporción auxiliar sigue acotada",
    tp.unawareShareOfResponses.value.value,
    unawarenessShareOfResponses(5, 6).value,
  );
  check(tp.unawareShareOfResponses.value.value <= 100, "por debajo de cien, como su denominador exige");
}
eq("CSAT de cero es un resultado medido", touchpoint("csat_f").satisfaction.value.value, 0);
eq("y su estado es disponible", touchpoint("csat_f").satisfaction.status, "available");
eq("banda del CSAT de cero", touchpoint("csat_f").satisfaction.value.band.semanticColor, csatBand(0));
eq("base pequeña reportada sin supresión", touchpoint("csat_bj").counts.valid, 2);
eq("y con resultado publicado", touchpoint("csat_bj").satisfaction.status, "available");
eq("CSAT sobre base de dos", touchpoint("csat_bj").satisfaction.value.value, 50);
{
  const acc = touchpoint("csat_bj").satisfaction.base.accounting;
  eq("faltante", acc.missing, 1);
  eq("no aplica", acc.notApplicable, 1);
  eq("fuente no disponible", acc.sourceUnavailable, 1);
  eq("desconocido", acc.unknown, 1);
  eq("contestadas", acc.answered, 2);
  check(
    acc.missing + acc.notApplicable + acc.sourceUnavailable + acc.unknown + acc.answered + acc.notParticipated === 6,
    "los estados de ausencia particionan los registros y siguen siendo distinguibles",
  );
}
{
  const emptyTouchpoint = baseSource();
  emptyTouchpoint.answers = emptyTouchpoint.answers.map((entry) =>
    entry.itemKey === "csat_bj" ? { ...entry, status: "missing", numeric: null, optionRawValue: null, derivedLabel: null } : entry,
  );
  const built = buildCanonicalStudyResults(emptyTouchpoint);
  const tp = built.journey.touchpoints.find((entry) => entry.key === "csat_bj");
  eq("un punto sin respuestas válidas no es un cero", tp.satisfaction.status, "unavailable");
  eq("y su razón es explícita", tp.satisfaction.reason, "no_valid_answers");
}

console.log("\n[5] La columna rota queda excluida y se reporta");
eq("puntos excluidos", results.journey.excluded.length, 2);
eq("clave del primero", results.journey.excluded[0].key, "csat_h");
eq("regla nombrada aplicada", results.journey.excluded[0].ruleId, "revised-csv-ref-error-duplicate");
check(results.journey.excluded[0].authorityId === "revised-journey-csv", "y cita la autoridad que la sostiene");
eq("clave del segundo", results.journey.excluded[1].key, "csat_j");
eq(
  "una columna rota que ninguna regla nombra se excluye igual, bajo la regla general",
  results.journey.excluded[1].ruleId,
  "source_error_column",
);
check(results.journey.excluded[1].authorityId === null, "y no inventa una autoridad para sostenerla");
check(
  !results.journey.groups.some((group) => group.touchpointKeys.includes("csat_h")),
  "la columna excluida no aparece en ningún grupo del recorrido",
);
check(
  !results.journey.touchpoints.some((entry) => entry.key === "csat_h"),
  "ni entre los puntos de contacto reportados",
);
{
  // A populated touchpoint with the same label must NOT be excluded: the rule
  // targets a column the source could not produce a value for, not a name.
  const populated = baseSource();
  populated.answers = populated.answers.map((entry) =>
    entry.itemKey === "csat_h"
      ? { sessionId: entry.sessionId, itemKey: "csat_h", status: "answered", numeric: 5, text: null, optionRawValue: "5", derivedLabel: "Satisfecho" }
      : entry,
  );
  const built = buildCanonicalStudyResults(populated);
  eq("un punto poblado con el mismo nombre NO se excluye", built.journey.excluded.length, 1);
  check(
    !built.journey.excluded.some((entry) => entry.key === "csat_h"),
    "la regla apunta a una columna que la fuente no pudo producir, no a un nombre",
  );
  eq("y se reporta con su resultado", built.journey.touchpoints.find((e) => e.key === "csat_h").satisfaction.value.value, 100);
}
{
  const blank = baseSource();
  blank.answers = blank.answers.map((entry) =>
    entry.itemKey === "csat_h" ? { ...entry, status: "missing" } : entry,
  );
  const built = buildCanonicalStudyResults(blank);
  eq("una columna vacía NO se excluye: se reporta sin datos", built.journey.excluded.length, 1);
  eq("y su estado lo dice", built.journey.touchpoints.find((e) => e.key === "csat_h").satisfaction.status, "unavailable");
}

console.log("\n[6] Intención de renovación");
eq("respuestas válidas del índice", results.renewal.base.valid, 6);
eq("categorías reportadas", results.renewal.distribution.length, 5);
eq("orden de menor a mayor riesgo", results.renewal.distribution[0].response, "Extremadamente probable");
eq("y termina en el riesgo crítico", results.renewal.distribution[4].response, "Nada probable");
eq("«Muy probable» contadas", results.renewal.distribution.find((d) => d.response === "Muy probable").count, 2);
eq("índice", results.renewal.index.value.value, roundTo((0 + 25 + 50 + 75 + 100 + 25) / 6, DECIMALS.percent));
eq("banda del índice", results.renewal.index.value.band.semanticColor, criBand(results.renewal.index.value.value));
{
  const built = buildCanonicalStudyResults(source, { filters: [{ dimensionKey: "perfil_cliente_h", values: ["Esfera Norte"] }] });
  eq("Esfera cruzada con el índice se rechaza", built.renewal.index.status, "unavailable");
  eq("y la razón es la prohibición, no la falta de datos", built.renewal.index.reason, "cross_not_permitted");
  check(
    built.renewal.index.provenance.internal.authorities.some((a) => a.id === "methodology-5-2-esfera-cri"),
    "citando la autoridad que lo prohíbe",
  );
  check(
    built.filters.dimensions.find((d) => d.key === "perfil_cliente_h").forbiddenSections.some((f) => f.section === "renewal"),
    "y la dimensión declara la sección que no puede cruzar",
  );
}

console.log("\n[7] Retención y deserción");
eq("periodos", results.retention.periods.length, 4);
eq("retención del periodo uno", results.retention.periods[0].retention.value.value, 75);
eq("deserción del periodo uno", results.retention.periods[0].attrition.value.value, 25);
eq("identidad verificada", results.retention.periods[0].identityVerified, true);
eq("periodo incompleto sin tasa", results.retention.periods[1].retention.status, "unavailable");
eq("y la razón lo dice", results.retention.periods[1].retention.reason, "no_valid_answers");
eq("el conteo faltante sigue siendo nulo, no cero", results.retention.periods[1].joined.count, null);
eq("y conserva su estado de origen", results.retention.periods[1].joined.status, "source_unavailable");
eq("padrón cero no produce tasa", results.retention.periods[2].retention.status, "unavailable");
eq("y la razón es la falta de base", results.retention.periods[2].retention.reason, "no_eligible_population");
eq("conteos imposibles se rechazan", results.retention.periods[3].retention.status, "unavailable");
check(
  results.retention.periods[3].attrition.status === "available",
  "pero la deserción, que sí es calculable, se publica",
);
check(
  results.retention.periods.every((period) => period.retention.provenance.internal.notes.some((note) => note.includes("padrón"))),
  "la procedencia dice que la base es el padrón, no la población ni los encuestados",
);
check(
  results.retention.periods.every((period) => period.retention.status !== "available" || period.retention.value.band === null),
  "no se publica banda de retención: el rango de color no es fijo y se captura por cliente",
);

console.log("\n[8] Filtros: antes de agregar, múltiples, y vacíos");
{
  const dimensions = buildFilterDimensions(source, SPEC);
  const cohortDimension = dimensions.find((d) => d.key === "cohort");
  check(cohortDimension !== undefined, "existe la dimensión de cohorte");
  check(
    !dimensions.some((d) => d.key === "perfil_cliente_a"),
    "un atributo privado nunca se ofrece como dimensión",
  );
  const edad = dimensions.find((d) => d.key === "perfil_cliente_d");
  eq("valores de la dimensión de edad", edad.values.length, 2);
  eq("y la ausencia conserva su estado", edad.absent[0].status, "source_unavailable");
  eq("y su conteo", edad.absent[0].participants, 1);
}
{
  const built = buildCanonicalStudyResults(source, { filters: [{ dimensionKey: "perfil_cliente_d", values: ["Rango A"] }] });
  eq("población tras el filtro", built.filters.resultingPopulation, 3);
  eq("y la base del CSAT se recalcula dentro de la selección", built.journey.touchpoints.find((t) => t.key === "csat_d").counts.responses, 3);
  eq("CSAT recalculado", built.journey.touchpoints.find((t) => t.key === "csat_d").satisfaction.value.value, 100);
  check(
    built.journey.touchpoints.find((t) => t.key === "csat_d").satisfaction.value.value !== touchpoint("csat_d").satisfaction.value.value,
    "el filtro se evalúa ANTES de agregar y cambia el resultado",
  );
}
{
  const built = buildCanonicalStudyResults(source, {
    filters: [
      { dimensionKey: "perfil_cliente_d", values: ["Rango A"] },
      { dimensionKey: "perfil_cliente_h", values: ["Esfera Norte"] },
    ],
  });
  eq("dos filtros simultáneos se combinan con Y", built.filters.resultingPopulation, 2);
  eq("y ambos quedan declarados", built.filters.applied.length, 2);
}
{
  const built = buildCanonicalStudyResults(source, {
    filters: [
      { dimensionKey: "perfil_cliente_d", values: ["Rango A"] },
      { dimensionKey: "cohort", values: ["deserter"] },
    ],
  });
  eq("una selección que no encaja con nadie", built.filters.resultingPopulation, 0);
  eq("se declara vacía", built.filters.empty, true);
  eq("y ningún indicador la reporta como cero medido", built.recommendation.scopes[0].score.status, "unavailable");
  eq("con la razón de población filtrada vacía", built.recommendation.scopes[0].score.reason, "empty_filtered_population");
}
{
  const built = buildCanonicalStudyResults(source, { filters: [{ dimensionKey: "cohort", values: ["active"] }] });
  eq("la retención no se recalcula bajo un filtro de participantes", built.retention.periods[0].retention.status, "unavailable");
  eq("y lo dice explícitamente", built.retention.periods[0].retention.reason, "cross_not_permitted");
}
throws("una dimensión inexistente", () => buildCanonicalStudyResults(source, { filters: [{ dimensionKey: "no_existe", values: ["x"] }] }));
throws("un valor inexistente", () =>
  buildCanonicalStudyResults(source, { filters: [{ dimensionKey: "perfil_cliente_d", values: ["Rango Z"] }] }),
);

console.log("\n[9] Redondeo: una sola vez, y en la frontera declarada");
{
  const everyValue = [];
  const walk = (node) => {
    if (Array.isArray(node)) return node.forEach(walk);
    if (node && typeof node === "object") {
      if (typeof node.value === "number" && typeof node.decimals === "number" && typeof node.formatted === "string") {
        everyValue.push(node);
      }
      return Object.values(node).forEach(walk);
    }
  };
  walk(results);
  check(everyValue.length > 10, `${everyValue.length} valores finales inspeccionados`);
  check(
    everyValue.every((entry) => Object.is(roundTo(entry.value, entry.decimals), entry.value)),
    "cada valor ya viene redondeado a la precisión que declara su unidad: volver a redondearlo no lo mueve",
  );
  check(
    everyValue.every((entry) => entry.formatted === formatNumber(entry.value, entry.decimals)),
    "y su forma de presentación es exactamente la del formateador canónico",
  );
  check(
    everyValue.every((entry) => !/toFixed/.test(String(entry.formatted))),
    "ninguna cadena de presentación se construyó fuera del formateador",
  );
  const unitDecimals = new Map(everyValue.map((entry) => [entry.unit, entry.decimals]));
  eq("precisión declarada del NPS", unitDecimals.get("nps"), DECIMALS.nps);
  eq("precisión declarada de un porcentaje", unitDecimals.get("percent"), DECIMALS.percent);
}

console.log("\n[10] Orden determinista");
{
  const a = JSON.stringify(buildCanonicalStudyResults(baseSource()));
  const b = JSON.stringify(buildCanonicalStudyResults(baseSource()));
  check(a === b, "dos construcciones del mismo conjunto de registros son idénticas byte a byte");

  // The SAME records in a DIFFERENT arrival order must produce the same
  // NUMBERS. Two adapters legitimately read one package in different orders —
  // the projector reads a worksheet column by column, a database reads a keyset
  // over a uuid — and a few arrays in the document deliberately carry the
  // source's own order (the instrument list, for one). What must never move is
  // a value, a count or a base, so the two documents are compared with every
  // array sorted by its own serialisation: presentation order is allowed to
  // differ, arithmetic is not.
  //
  // The bandCounts assertion below is narrower and pins a real defect this
  // check first exposed: `performance.bandCounts` was emitted in `Map`
  // insertion order, so the semaphore's order depended on which respondent's
  // score happened to be read first. It is now the band scheme's own display
  // order, whatever order the observations arrive in.
  {
    const reversed = baseSource();
    for (const [key, value] of Object.entries(reversed)) {
      if (Array.isArray(value)) reversed[key] = value.slice().reverse();
    }
    const built = buildCanonicalStudyResults(reversed);
    const orderInsensitive = (value) => {
      if (Array.isArray(value)) {
        return value
          .map(orderInsensitive)
          .sort((x, y) => (JSON.stringify(x) < JSON.stringify(y) ? -1 : 1));
      }
      if (value && typeof value === "object") {
        return Object.fromEntries(
          Object.keys(value)
            .sort()
            .map((key) => [key, orderInsensitive(value[key])]),
        );
      }
      return value;
    };
    check(
      JSON.stringify(orderInsensitive(JSON.parse(a))) === JSON.stringify(orderInsensitive(built)),
      "y el mismo conjunto en ORDEN INVERSO no mueve ningún número",
    );
    const bandsFrom = (document) =>
      document.performance.dimensions
        .flatMap((dimension) => dimension.periods)
        .map((period) => period.bandCounts.map((entry) => `${entry.semanticColor}:${entry.count}`).join("|"));
    check(
      JSON.stringify(bandsFrom(JSON.parse(a))) === JSON.stringify(bandsFrom(built)),
      "y el semáforo sale en el orden del esquema, no en el de llegada de las observaciones",
    );
  }
  const group = results.qualitative.groups.find((entry) => entry.key === "activos");
  eq("la nube ordena por conteo descendente", group.terms[0].label, "Categoría alfa");
  eq("y desempata por etiqueta", group.terms[1].label, "Categoría beta");
  check(
    results.journey.groups.every((entry, index) => index === 0 || entry.order >= results.journey.groups[index - 1].order),
    "los grupos del recorrido salen en el orden de la fuente",
  );
}

console.log("\n[11] Cualitativo: etiquetas y conteos, nunca palabras de nadie");
{
  const group = results.qualitative.groups.find((entry) => entry.key === "activos");
  eq("menciones categorizadas", group.total, 3);
  eq("categoría documentada como excluida", group.excluded[0].label, "No aplica");
  eq("y su conteo se recupera del estado de ausencia", group.excluded[0].count, 2);
  check(!group.terms.some((term) => term.label === "No aplica"), "la categoría excluida no entra a la nube");
  // NOT A REVIEW STATE, AND THAT IS THE CORRECTION.
  //
  // This used to assert `reviewStatus === "pending"`, which passed because the
  // builder wrote that literal on every group of every study for ever. The
  // assertion was true and the field was not: this layer cannot know whether a
  // person read anything. What it knows is where the coding came from, and the
  // review state now lives at the publication boundary against a digest of the
  // exact words.
  eq("procedencia de la codificación", group.coding, "source_coded");
  check(
    !("reviewStatus" in group),
    "y el grupo ya no publica un estado de revisión que esta capa no puede conocer",
  );
  eq("conteo de hallazgos curados por entidad", results.qualitative.curatedFindingCounts.length, 2);
  eq(
    "hallazgos sobre la primera etapa",
    results.qualitative.curatedFindingCounts.find((c) => c.entityKind === "journey_stage").count,
    2,
  );
  check(
    !JSON.stringify(results.qualitative).includes("label\":\"\""),
    "ningún hallazgo curado viaja con su texto",
  );
}

console.log("\n[12] Lo que un punto de contacto posee, y lo que exige configuración");
// A touchpoint DIRECTLY owns its satisfaction, its TDP and the auxiliary
// share, each with its own base. No study-level metric is implicitly
// attached to it. That is a contract rule, not an uncertainty.
for (const tp of results.journey.touchpoints) {
  const owns =
    tp.satisfaction?.status !== undefined && tp.tdp?.status !== undefined && tp.unawareShareOfResponses?.status !== undefined;
  if (!owns) bad(`el punto ${tp.key} no lleva sus tres resultados propios`);
}
ok(`los ${results.journey.touchpoints.length} puntos de contacto llevan CSAT, TDP y proporción auxiliar propios`);
check(
  results.journey.touchpoints.every(
    (tp) => tp.satisfaction.base.valid === tp.counts.valid && tp.tdp.base.valid === tp.counts.valid,
  ),
  "y cada uno lleva la base que su fórmula usa",
);
{
  // No study-level metric leaks onto a touchpoint or a stage.
  const serialized = JSON.stringify(results.journey);
  const leaked = ["nps_", "\"cri\"", "retention_", "attrition_", "ltv"].filter((key) =>
    serialized.includes(key),
  );
  check(
    leaked.length === 0,
    `ningún indicador de estudio se adscribe al recorrido${leaked.length ? `: ${leaked.join(", ")}` : ""}`,
  );
}
eq(
  "el vínculo indicador↔etapa es una regla del contrato",
  results.journey.stageEvidence.status,
  "requires_explicit_configuration",
);
eq("y la regla se nombra", results.journey.stageEvidence.rule, "journey_stage_evidence_is_explicit_only");
eq("sin ninguna configuración, no hay vínculos", results.journey.stageEvidence.links.length, 0);
check(
  !("gaps" in results.journey.stageEvidence),
  "y no se emite un reporte de brechas por etapa: no falta nada que descubrir",
);
check(
  results.journey.stageEvidence.configuredBy.length > 20,
  "se declara quién aportaría un vínculo adicional",
);
check(
  results.journey.stageEvidence.authorities.some((a) => a.id === "owner-decision-journey-metrics"),
  "citando la decisión que lo estableció",
);
eq("el documento no carga ninguna pregunta abierta", results.unresolved.length, 0);
check(
  results.configurationRequired.some((item) => item.key === "journey_stage_evidence" && item.kind === "study_configuration"),
  "una asociación adicional exige configuración explícita de estudio",
);
check(
  results.configurationRequired.some((item) => item.key === "curated_journey_pain_cloud" && item.kind === "editorial_review"),
  "y la nube curada del recorrido exige revisión editorial",
);
check(
  results.configurationRequired.every((item) => item.authorities.length > 0 && item.suppliedBy.length > 10),
  "cada requisito de configuración cita autoridades y dice quién lo aporta",
);
{
  // A link a configuration DOES declare is carried through unchanged.
  const configured = baseSource({
    journeyStageEvidence: [{ journeyStageKey: "etapa_01", metricKey: "csat_item_csat_d", itemKey: null, performanceDimensionKey: null, role: "primary" }],
  });
  const built = buildCanonicalStudyResults(configured);
  eq("una configuración explícita SÍ produce un vínculo", built.journey.stageEvidence.links.length, 1);
  eq("con su etapa", built.journey.stageEvidence.links[0].stageKey, "etapa_01");
  eq("y su indicador", built.journey.stageEvidence.links[0].metricKey, "csat_item_csat_d");
  eq(
    "el estado sigue siendo el de una regla explícita, no una inferencia",
    built.journey.stageEvidence.status,
    "requires_explicit_configuration",
  );
}
{
  // The curated journey cloud is never fabricated: no phrase splitting, no
  // alias table, only counts a real foreign key supports.
  const serialized = JSON.stringify(results.qualitative);
  check(
    !/split|phrase|alias|frase/i.test(JSON.stringify(results.qualitative.curatedFindingCounts)),
    "los hallazgos curados se cuentan, no se segmentan ni se re-etiquetan",
);
  check(
    results.qualitative.curatedFindingCounts.every(
      (entry) => typeof entry.count === "number" && typeof entry.entityKey === "string",
    ),
    "y cada conteo cuelga de una entidad curada real",
  );
  check(!serialized.includes("recorrido"), "no se inventa una nube de frases del recorrido");
}

console.log("\n[13] El documento es agregado y no lleva nada de nadie");
{
  const serialized = JSON.stringify(results);
  check(!serialized.includes("SENTINEL-PRIVADO"), "ningún valor de un atributo privado aparece en el documento");
  check(!/"participantId"/.test(serialized), "el documento no lleva identificadores de participación");
  check(!/"sessionId"/.test(serialized), "ni identificadores de sesión");
  check(!/"personId"|"displayName"|"normalizedName"/.test(serialized), "ni nada que nombre a una persona");
  // Comments are stripped first: this file's own prose says the words
  // "respondent" and "raw text" on purpose, and a scan that cannot tell a
  // promise from a field would be measuring the wrong thing.
  const contract = stripComments(readFileSync(join("src", "lib", "results", "contract.ts"), "utf8"));
  check(
    !/respondent|personId|displayName|rawText|verbatim|participantId|sessionId/i.test(contract),
    "y el contrato no tiene siquiera un campo donde ponerlo",
  );
}

console.log("\n[14] Procedencia: autoridades registradas y explicación sin fórmula");
{
  const provenances = [];
  const walk = (node) => {
    if (Array.isArray(node)) return node.forEach(walk);
    if (node && typeof node === "object") {
      if (node.calculationVersion && node.explanation && node.internal) provenances.push(node);
      return Object.values(node).forEach(walk);
    }
  };
  walk(results);
  check(provenances.length > 5, `${provenances.length} procedencias inspeccionadas`);
  const unknown = provenances.flatMap((p) => p.internal.authorities.map((a) => a.id)).filter((id) => !(id in AUTHORITIES));
  check(unknown.length === 0, `toda autoridad citada está registrada${unknown.length ? `: ${[...new Set(unknown)].join(", ")}` : ""}`);
  const withFormula = provenances.filter((p) => /[0-9=×*/%]/.test(p.explanation));
  check(
    withFormula.length === 0,
    `ninguna explicación de cara al cliente expone una fórmula${withFormula.length ? ` (${withFormula.length} la exponen)` : ""}`,
  );
  check(
    provenances.every((p) => p.calculationVersion === SPEC.calculationVersion),
    "y cada una declara la versión de cálculo",
  );
  check(
    provenances.every((p) => Array.isArray(p.internal.sources) && p.internal.sources.length > 0),
    "y de qué familias canónicas se calculó",
  );
}

console.log("\n[15] Las bandas del esquema coinciden con las funciones canónicas");
{
  const scheme = (key) => BAND_SCHEMES.find((entry) => entry.key === key);
  const agrees = (schemeKey, fn) => {
    for (let value = -100; value <= 100; value += 0.5) {
      const rule = scheme(schemeKey).rules.find((candidate) => {
        const aboveLower = candidate.lowerBound === null || (candidate.lowerInclusive ? value >= candidate.lowerBound : value > candidate.lowerBound);
        const belowUpper = candidate.upperBound === null || (candidate.upperInclusive ? value <= candidate.upperBound : value < candidate.upperBound);
        return aboveLower && belowUpper;
      });
      if (!rule) continue;
      if (rule.semanticColor !== fn(value)) return value;
    }
    return null;
  };
  const npsDiff = agrees("nps_presentacion", npsBand);
  const csatDiff = agrees("csat_presentacion", csatBand);
  const criDiff = agrees("cri_agregado", criBand);
  check(npsDiff === null, `los rangos NPS del esquema coinciden con npsBand${npsDiff === null ? "" : ` (difieren en ${npsDiff})`}`);
  check(csatDiff === null, `los rangos CSAT coinciden con csatBand${csatDiff === null ? "" : ` (difieren en ${csatDiff})`}`);
  check(criDiff === null, `los rangos CRI coinciden con criBand${criDiff === null ? "" : ` (difieren en ${criDiff})`}`);
}

console.log("\n[16] Ninguna fórmula vive en el navegador, ni transporte en el modelo");
{
  const walkFiles = (dir) => {
    const out = [];
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) out.push(...walkFiles(full));
      else if (/\.(ts|tsx)$/.test(entry)) out.push(full);
    }
    return out;
  };

  const resultsFiles = walkFiles(join("src", "lib", "results"));
  check(resultsFiles.length >= 12, `${resultsFiles.length} módulos en el modelo de resultados`);
  const transports = resultsFiles.filter((path) =>
    /@supabase|createClient\(|\.rpc\(|\bfetch\(|node:|process\.env/.test(stripComments(readFileSync(path, "utf8"))),
  );
  check(transports.length === 0, `ningún módulo del modelo alcanza un transporte${transports.length ? `: ${transports.join(", ")}` : ""}`);
  const serverOnly = resultsFiles.filter((path) => /^\s*import\s+["']server-only["']/m.test(stripComments(readFileSync(path, "utf8"))));
  check(serverOnly.length === 0, "y ninguno es server-only, para que una compuerta offline pueda ejecutar el cálculo real");

  const browserFiles = [...walkFiles(join("src", "components")), ...walkFiles(join("src", "app"))];
  const valueImporters = browserFiles.filter((path) =>
    /import\s+(?!type\b)[^;]*from\s+["']@\/lib\/results/.test(stripComments(readFileSync(path, "utf8"))),
  );
  check(
    valueImporters.length === 0,
    `ningún componente ni ruta importa un calculador del modelo${valueImporters.length ? `: ${valueImporters.join(", ")}` : ""}`,
  );

  // The two modules that DEFINE a composite metric. A browser module may format
  // a number, place a marker or size a bar — that is visual geometry over a
  // value the server already decided — but it may not import a definition.
  const definitionImporters = browserFiles.filter((path) =>
    /from\s+["']@\/lib\/calc\/(metrics|business-metrics)["']/.test(stripComments(readFileSync(path, "utf8"))),
  );
  check(
    definitionImporters.length === 0,
    `ningún módulo de navegador importa una definición de métrica${definitionImporters.length ? `: ${definitionImporters.join(", ")}` : ""}`,
  );

  // And none re-implements one. These patterns are the signatures of the five
  // confirmed formulas, not of arithmetic in general: a bar width is
  // `(value / max) * 100` and must not trip this.
  const FORMULA_SIGNATURES = [
    /promot\w*\s*[-+]\s*detract/i,
    /detract\w*\s*[-+]\s*promot/i,
    /(satisfied|satisfechas)\s*\/\s*(valid|total|v[áa]lid)/i,
    /(unaware|desconocim\w*)\s*\/\s*(valid|responses|total)/i,
    /RISK_POINTS/,
    /(ending|final\w*)\s*-\s*(new|nuevos|joined)\s*\)?\s*\/\s*(starting|inicio)/i,
    />=\s*9\b[\s\S]{0,80}<=\s*6\b/,
  ];
  const formulaOwners = browserFiles.filter((path) => {
    const code = stripComments(readFileSync(path, "utf8"));
    return FORMULA_SIGNATURES.some((pattern) => pattern.test(code));
  });
  check(
    formulaOwners.length === 0,
    `ningún módulo de navegador reimplementa una métrica de negocio${formulaOwners.length ? `: ${formulaOwners.join(", ")}` : ""}`,
  );
  // The detector must be capable of firing, or it proves nothing.
  check(
    FORMULA_SIGNATURES.some((pattern) => pattern.test("const nps = ((promoters - detractors) / total) * 100;")),
    "y el detector sí reconoce una fórmula cuando la ve",
  );
  check(
    !FORMULA_SIGNATURES.some((pattern) => pattern.test("style={{ width: `${(row.value / maxBar) * 100}%` }}")),
    "sin confundir con ella el ancho de una barra",
  );
}

console.log("\n[17] Invariantes que ninguna sección puede romper");
{
  // Walk every MetricResult in the document and hold it to the contract's own
  // rules. These are the checks that were missing when a base mixed people with
  // spreadsheet cells and a subset counted records outside its superset.
  const metrics = [];
  const bases = [];
  const walk = (node) => {
    if (Array.isArray(node)) return node.forEach(walk);
    if (node && typeof node === "object") {
      if (typeof node.status === "string" && node.base && node.provenance) metrics.push(node);
      if (node.accounting && typeof node.eligible === "number") bases.push(node);
      return Object.values(node).forEach(walk);
    }
  };
  walk(results);
  check(metrics.length > 10, `${metrics.length} resultados métricos inspeccionados`);
  check(bases.length > 10, `${bases.length} bases inspeccionadas`);

  const notNested = bases.filter((base) => !(base.valid <= base.responded && base.responded <= base.eligible));
  check(
    notNested.length === 0,
    `toda base cumple valid <= responded <= eligible${notNested.length ? ` (${notNested.length} no)` : ""}`,
  );

  const badPartition = bases.filter((base) => {
    const a = base.accounting;
    return a.answered + a.missing + a.unknown + a.notApplicable + a.sourceUnavailable + a.notParticipated !== base.responded;
  });
  check(
    badPartition.length === 0,
    `los seis estados particionan exactamente los registros considerados${badPartition.length ? ` (${badPartition.length} no)` : ""}`,
  );

  const badSubset = bases.filter((base) => {
    const a = base.accounting;
    return a.outOfScale > a.answered || a.phenomenon > a.answered || a.zeroValued > a.answered;
  });
  check(
    badSubset.length === 0,
    `outOfScale, phenomenon y zeroValued son subconjuntos de answered${badSubset.length ? ` (${badSubset.length} no)` : ""}`,
  );

  const badState = metrics.filter(
    (metric) =>
      (metric.status === "available" && !metric.value) ||
      (metric.status === "unavailable" && typeof metric.reason !== "string") ||
      (metric.status === "unresolved" && !Array.isArray(metric.candidates)),
  );
  check(badState.length === 0, "todo resultado métrico puede discriminarse por su estado");
}
{
  // A group whose excluded category is excluded BY TEXT rather than recovered
  // from an absence state. The current spec uses the absence path, so this case
  // exists only here — and it is the one that used to make base.valid diverge
  // from the denominator every share rested on.
  const byText = baseSource();
  const textSpec = {
    ...SPEC,
    qualitative: SPEC.qualitative.map((group) =>
      group.key === "activos"
        ? { ...group, excludedLabels: [{ label: "Categoría beta", canonicalStatus: null }] }
        : group,
    ),
  };
  const built = buildCanonicalStudyResults(byText, { spec: textSpec });
  const group = built.qualitative.groups.find((entry) => entry.key === "activos");
  eq("una categoría excluida por texto se cuenta aparte", group.excluded[0].count, 1);
  eq("y sale de la nube", group.terms.length, 1);
  eq("la base válida sigue siendo el denominador de las participaciones", group.base.valid, group.total);
  check(
    group.terms.every((term) => term.share === null || term.share === Math.round((term.count / group.total) * 1000) / 10),
    "y cada participación se recalcula desde esa misma base",
  );
}

console.log("\n[18] Una selección no puede cambiar qué existe");
{
  // The exclusion decision belongs to the source column, not to a selection.
  const narrowed = buildCanonicalStudyResults(source, { filters: [{ dimensionKey: "cohort", values: ["deserter"] }] });
  eq("la columna rota sigue excluida bajo un filtro que no la alcanza", narrowed.journey.excluded.length, 2);
  check(
    !narrowed.journey.touchpoints.some((entry) => entry.key === "csat_h" || entry.key === "csat_j"),
    "y no reaparece entre los puntos de contacto",
  );
  eq(
    "los puntos de contacto reportados no dependen del filtro",
    narrowed.journey.touchpoints.length,
    results.journey.touchpoints.length,
  );
  const healthyUnderFilter = buildCanonicalStudyResults(source, {
    filters: [{ dimensionKey: "perfil_cliente_d", values: ["Rango B"] }],
  });
  check(
    healthyUnderFilter.journey.touchpoints.some((entry) => entry.key === "csat_bj"),
    "y una columna sana cuyas respuestas en la selección son todas ausentes NO se marca como error de la fuente",
  );
  eq(
    "se reporta sin datos, que es una cosa distinta",
    healthyUnderFilter.journey.touchpoints.find((entry) => entry.key === "csat_bj").satisfaction.status,
    "unavailable",
  );
}
{
  // An instrument's eligible base and cohorts are study facts; a filter that
  // selects eligible non-responders must not shrink either.
  const built = buildCanonicalStudyResults(source, { filters: [{ dimensionKey: "cohort", values: ["deserter"] }] });
  const csat = built.population.instruments.find((entry) => entry.key === "csat");
  eq("las cohortes de un instrumento no dependen del filtro", JSON.stringify(csat.cohortKeys), JSON.stringify(["active"]));
  eq("y su base elegible tampoco colapsa a cero por invención", csat.base.eligible, 0);
  const active = buildCanonicalStudyResults(source, { filters: [{ dimensionKey: "cohort", values: ["active"] }] });
  eq(
    "una selección dentro de la cohorte del instrumento conserva su base elegible",
    active.population.instruments.find((entry) => entry.key === "csat").base.eligible,
    6,
  );
}
{
  // Performance eligible counts the cohorts the dimension actually measures.
  const period = results.performance.dimensions[0].periods[0];
  eq("la base de desempeño cuenta sólo la cohorte que mide", period.mean.base.eligible, 6);
  check(period.mean.base.eligible < results.population.total, "y no toda la población del estudio");
}

console.log("\n[19] Una base vacía nunca publica un cero medido");
{
  const empty = buildCanonicalStudyResults(source, {
    filters: [
      { dimensionKey: "perfil_cliente_d", values: ["Rango A"] },
      { dimensionKey: "cohort", values: ["deserter"] },
    ],
  });
  const scopeResult = empty.recommendation.scopes[0];
  eq("sin base no hay recuento de promotores", scopeResult.distribution.promoters, null);
  eq("ni de detractores", scopeResult.distribution.detractors, null);
  eq("ni participación de promotores", scopeResult.distributionShare.promoters, null);
  eq("el índice de renovación tampoco", empty.renewal.index.status, "unavailable");
  check(
    empty.renewal.distribution.every((entry) => entry.count === null && entry.share === null),
    "y ninguna categoría del histograma finge un cero",
  );
  check(
    results.recommendation.scopes[0].distributionShare.promoters !== null,
    "mientras que sobre una base real la participación sí se publica",
  );
  eq(
    "y un peldaño que nadie eligió sobre una base real ES un cero medido",
    results.renewal.distribution.find((entry) => entry.response === "Nada probable").count,
    1,
  );
}
{
  const forbidden = buildCanonicalStudyResults(source, {
    filters: [{ dimensionKey: "perfil_cliente_h", values: ["Esfera Norte"] }],
  });
  eq("un cruce prohibido no publica distribución alguna", forbidden.renewal.distribution, null);
  eq("ni una base calculada sobre ese cruce", forbidden.renewal.base.valid, 0);
  eq("ni siquiera en el sobre del indicador", forbidden.renewal.index.base.responded, 0);
  eq("y el rechazo queda declarado", forbidden.renewal.index.reason, "cross_not_permitted");
}

console.log("\n[20] La escala de satisfacción es configuración, no un literal");
{
  const strict = {
    ...SPEC,
    satisfactionScale: { min: 1, max: 5, satisfiedFrom: 5 },
  };
  const built = buildCanonicalStudyResults(source, { spec: strict });
  const tp = built.journey.touchpoints.find((entry) => entry.key === "csat_d");
  eq("con el umbral en cinco, las satisfechas cambian", tp.counts.satisfied, 2);
  eq("y el porcentaje se calcula sobre ese mismo umbral", tp.satisfaction.value.value, 40);
  check(
    tp.satisfaction.value.value === Math.round((tp.counts.satisfied / tp.counts.valid) * 1000) / 10,
    "el porcentaje publicado se recalcula desde los conteos publicados",
  );
  check(
    results.journey.touchpoints.every(
      (entry) =>
        entry.satisfaction.status !== "available" ||
        entry.satisfaction.value.value === Math.round((entry.counts.satisfied / entry.counts.valid) * 1000) / 10,
    ),
    "y eso vale para los 3 puntos de contacto del estudio por omisión",
  );
  throws("una escala imposible", () =>
    buildCanonicalStudyResults(source, { spec: { ...SPEC, satisfactionScale: { min: 1, max: 5, satisfiedFrom: 9 } } }),
  );
}

console.log("\n[21] Las compuertas están registradas donde corresponde");
{
  const pkg = JSON.parse(readFileSync("package.json", "utf8"));
  check((pkg.scripts?.test ?? "").includes("test:canonical-results"), "esta compuerta corre dentro de `npm test`");
  check(
    typeof pkg.scripts?.["test:canonical-results-parity"] === "string",
    "la compuerta de paridad real está declarada",
  );
  check(
    !(pkg.scripts?.test ?? "").includes("test:canonical-results-parity"),
    "y NO está en `npm test`: necesita libros reales con rutas de esta máquina, y una compuerta no ejecutada no es una compuerta aprobada",
  );
  const fixture = JSON.parse(readFileSync(join("scripts", "fixtures", "cuicuilco-golden-parity.v1.json"), "utf8"));
  eq("versión del fixture dorado", fixture.specVersion, 1);
  eq("tablero aprobado fijado por hash", fixture.generatedFrom.commit, "a7248fdbccd139da80ed7c09daa70f006a62b9cf");
  check(fixture.expectations.length > 500, `${fixture.expectations.length} expectativas doradas registradas`);
  check(
    fixture.expectations.every((entry) => typeof entry.cohort === "string" && "denominator" in entry && typeof entry.evidence === "string"),
    "y cada una declara cohorte, denominador y evidencia",
  );
  check(
    fixture.expectations.every((entry) => ["expected", "not_applicable", "configuration_required", "unresolved"].includes(entry.status)),
    "y todo estado de expectativa pertenece al vocabulario del contrato",
  );
  check(
    fixture.expectations.some((entry) => entry.status === "not_applicable") &&
      fixture.expectations.some((entry) => entry.status === "configuration_required"),
    "y distingue lo que no tiene contra qué compararse de lo que aporta una configuración",
  );
  check(
    fixture.expectations.every((entry) => entry.status !== "unresolved"),
    "sin dejar ninguna pregunta abierta: la propiedad metodológica las resolvió",
  );
  check(
    fixture.expectations
      .filter((entry) => entry.status !== "expected")
      .every((entry) => typeof entry.classificationReason === "string" && entry.classificationReason.length > 40),
    "y cada expectativa no comparable dice por qué",
  );
  const serializedFixture = JSON.stringify(fixture);
  check(
    !/respondent|"email"|participantId/i.test(serializedFixture),
    "el fixture dorado no contiene datos personales",
  );
  const parity = readFileSync(join("scripts", "canonical-results-parity.mjs"), "utf8");
  check(!/@supabase|createClient\(/.test(parity.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "").replace(/\/[^/\n]*supabase[^/\n]*\//g, "")), "la compuerta de paridad no construye cliente alguno");
}

console.log("\n" + "=".repeat(74));
if (failures > 0) {
  console.error(`RESULTADO: ${failures} fallo(s). COMPUERTA BLOQUEADA.`);
  process.exit(1);
}
console.log(
  "RESULTADO: el modelo canónico de resultados calcula en el servidor, declara su base, distingue " +
    "la ausencia del cero, filtra antes de agregar, no suprime, no expone a nadie y dice en voz alta " +
    "lo que todavía no puede probar. COMPUERTA APROBADA.",
);
