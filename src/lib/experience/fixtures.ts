/**
 * A demonstration registry. NOT PRODUCTION DATA, and not imported by any
 * production path — a gate asserts that no route, component or other library
 * module reaches for this file.
 *
 * WHAT IT IS FOR. The registry contract claims that the concepts a real
 * membership organisation actually cares about can be expressed as DATA, with
 * no client-specific key anywhere in the generic code. A claim like that is
 * worth exactly as much as its demonstration, so here is the demonstration:
 * nine ideas taken from a real consulting engagement, expressed entirely
 * through `SemanticMetric` and `SemanticDimension`, with nothing added to any
 * shared module to make them fit.
 *
 * NAMES ARE GENERIC ON PURPOSE. "Tiempo en BNI" is represented as
 * `time_in_membership`; a performance traffic light is
 * `performance_band`; a chapter's culture category is `culture_category`.
 * The organisation becomes a reusable, editable starting template rather than a
 * branch in the code — which is the entire point of the exercise.
 *
 * IT CONTAINS NO PARTICIPANT DATA. Every value here is a category label a
 * questionnaire offers, never an answer anybody gave.
 */

import type { SemanticDimension, SemanticMetric, SemanticRegistry } from "./registry";
import { registrySignature } from "./registry";

const FIXTURE_TENANT = "00000000-0000-4000-8000-000000000001";
const FIXTURE_STUDY = "00000000-0000-4000-8000-000000000002";

const percent = { decimals: 1, suffix: "percent" as const, grouped: false };
const points = { decimals: 0, suffix: "points" as const, grouped: false };
const money = { decimals: 0, suffix: "currency_mxn" as const, grouped: true };
const plain = { decimals: 1, suffix: "none" as const, grouped: true };

const METRICS: SemanticMetric[] = [
  {
    id: "satisfaction_overall",
    label: "Satisfacción general",
    question: "¿Qué tan satisfechas están las personas con la experiencia completa?",
    description: "Porcentaje que elige una de las dos calificaciones más altas de la escala.",
    source: "Pregunta cerrada de satisfacción del cuestionario.",
    family: "satisfaction",
    unit: "percent",
    format: percent,
    aggregations: ["top_box", "value", "average"],
    defaultAggregation: "top_box",
    charts: ["kpi", "bar_horizontal", "bar_vertical", "table", "line", "traffic_light"],
    filterEligible: false,
    // This registry is the PERMISSIVE one: satisfaction, recommendation,
    // retention and the awareness companion may all sit on a recorrido moment.
    // `satisfactionOnlyJourneyRegistry()` below narrows it to the
    // satisfaction-only configuration a client can ask for, which is what makes
    // that restriction a demonstration rather than a restatement.
    journeyEligible: true,
    privacy: "aggregate_only",
    samplePolicy: null,
    publicationReady: true,
    responses: 54,
  },
  {
    id: "satisfaction_onboarding",
    label: "Satisfacción con la bienvenida",
    question: "¿Qué tan bien recibida se sintió la gente al entrar?",
    description: "Misma escala que la satisfacción general, sobre el primer momento.",
    source: "Pregunta cerrada de satisfacción del cuestionario.",
    family: "satisfaction",
    unit: "percent",
    format: percent,
    aggregations: ["top_box", "value", "average"],
    defaultAggregation: "top_box",
    charts: ["kpi", "bar_horizontal", "table", "line", "traffic_light"],
    filterEligible: false,
    journeyEligible: true,
    privacy: "aggregate_only",
    samplePolicy: null,
    publicationReady: true,
    responses: 51,
  },
  {
    id: "recommendation",
    label: "Recomendación",
    question: "¿Qué tanto recomendarían esta experiencia?",
    description: "Escala de 0 a 10. El resultado va de -100 a 100.",
    source: "Pregunta de recomendación del cuestionario.",
    family: "recommendation",
    unit: "nps",
    format: points,
    aggregations: ["net_score", "value"],
    defaultAggregation: "net_score",
    charts: ["kpi", "bar_horizontal", "table", "line", "traffic_light"],
    filterEligible: false,
    journeyEligible: true,
    privacy: "aggregate_only",
    samplePolicy: null,
    publicationReady: true,
    responses: 54,
  },
  {
    id: "renewal_probability",
    label: "Probabilidad de renovación",
    question: "¿Qué tan probable es que las personas renueven?",
    description: "Promedio declarado de intención de renovar, en porcentaje.",
    source: "Pregunta de intención de permanencia.",
    family: "retention",
    unit: "percent",
    format: percent,
    aggregations: ["average", "value", "share"],
    defaultAggregation: "average",
    charts: ["kpi", "bar_horizontal", "table", "line", "traffic_light", "retention_series"],
    filterEligible: false,
    journeyEligible: true,
    privacy: "aggregate_only",
    samplePolicy: null,
    publicationReady: true,
    responses: 49,
  },
  {
    id: "return_on_investment",
    label: "Retorno de la inversión",
    question: "¿Cuánto recuperó cada persona respecto de lo que invirtió?",
    description: "Monto recuperado declarado, comparado con la cuota del periodo.",
    source: "Preguntas de negocio referido y cuota del periodo.",
    family: "roi",
    unit: "currency",
    format: money,
    aggregations: ["average", "sum", "value", "min", "max"],
    defaultAggregation: "average",
    charts: ["kpi", "bar_horizontal", "table", "line", "treemap"],
    filterEligible: false,
    journeyEligible: false,
    privacy: "aggregate_only",
    samplePolicy: null,
    publicationReady: true,
    responses: 41,
  },
  {
    id: "performance_band",
    label: "Semáforo de desempeño",
    question: "¿Cuánta gente está en verde, en amarillo y en rojo?",
    description:
      "Reparto sobre el umbral acordado con el cliente. Verde, amarillo y rojo son bandas, no calificaciones.",
    source: "Umbral configurado para el estudio, aplicado al desempeño declarado.",
    family: "culture",
    unit: "band",
    format: percent,
    aggregations: ["share", "count", "value"],
    defaultAggregation: "share",
    charts: ["traffic_light", "bar_horizontal", "bar_stacked_100", "table", "donut", "pie"],
    filterEligible: false,
    journeyEligible: false,
    privacy: "aggregate_only",
    samplePolicy: null,
    publicationReady: true,
    responses: 54,
  },
  {
    id: "moment_unknown_share",
    label: "No sabía que existía",
    question: "¿Cuánta gente no sabía que este momento existía?",
    description:
      "Porcentaje que respondió que desconocía el momento. Es una medida de difusión, no de insatisfacción, y se lee aparte del resultado del momento.",
    source: 'Opción "no lo conozco" de cada pregunta del recorrido.',
    family: "awareness",
    unit: "percent",
    format: percent,
    aggregations: ["share", "value"],
    defaultAggregation: "share",
    charts: ["kpi", "bar_horizontal", "table", "traffic_light"],
    filterEligible: false,
    journeyEligible: true,
    privacy: "aggregate_only",
    samplePolicy: null,
    publicationReady: true,
    responses: 54,
  },
  {
    id: "referrals_given",
    label: "Referencias dadas",
    question: "¿Cuántas referencias dio cada persona en el periodo?",
    description: "Conteo declarado de referencias entregadas.",
    source: "Pregunta de actividad del periodo.",
    family: "participation",
    unit: "count",
    format: plain,
    aggregations: ["average", "sum", "count", "min", "max", "value"],
    defaultAggregation: "average",
    charts: ["kpi", "bar_horizontal", "table", "line", "treemap"],
    filterEligible: false,
    journeyEligible: false,
    privacy: "aggregate_only",
    samplePolicy: null,
    publicationReady: false,
    responses: 0,
  },
];

const DIMENSIONS: SemanticDimension[] = [
  {
    id: "generation",
    label: "Generación",
    description: "Grupo generacional declarado por la persona.",
    source: "Columna de segmentación de la importación.",
    kind: "segment",
    values: [
      { value: "baby_boomer", label: "Baby boomer" },
      { value: "generacion_x", label: "Generación X" },
      { value: "millennial", label: "Millennial" },
      { value: "generacion_z", label: "Generación Z" },
    ],
    filterEligible: true,
    journeyEligible: false,
    publicationReady: true,
  },
  {
    id: "membership_status",
    label: "Situación de membresía",
    description: "Si la persona sigue, se fue o está por renovar.",
    source: "Columna de segmentación de la importación.",
    kind: "status",
    values: [
      { value: "activo", label: "Activa" },
      { value: "por_renovar", label: "Por renovar" },
      { value: "salio", label: "Ya no participa" },
    ],
    filterEligible: true,
    journeyEligible: false,
    publicationReady: true,
  },
  {
    id: "time_in_membership",
    label: "Tiempo en la red",
    // The engagement calls this "tiempo en BNI". The product calls it what it
    // is, so the same dimension serves any membership organisation.
    description: "Cuánto lleva la persona formando parte, en tramos.",
    source: "Columna de segmentación de la importación.",
    kind: "segment",
    values: [
      { value: "menos_de_1", label: "Menos de un año" },
      { value: "1_a_3", label: "De uno a tres años" },
      { value: "3_a_5", label: "De tres a cinco años" },
      { value: "mas_de_5", label: "Más de cinco años" },
    ],
    filterEligible: true,
    journeyEligible: false,
    publicationReady: true,
  },
  {
    id: "culture_category",
    label: "Categoría de cultura",
    description: "Cómo se clasificó la cultura del grupo en la revisión de categorías.",
    source: "Decisión registrada en la revisión de categorías.",
    kind: "category",
    values: [
      { value: "colaborativa", label: "Colaborativa" },
      { value: "competitiva", label: "Competitiva" },
      { value: "en_transicion", label: "En transición" },
    ],
    filterEligible: true,
    journeyEligible: false,
    publicationReady: true,
  },
  {
    id: "performance_light",
    label: "Semáforo",
    description: "Verde, amarillo y rojo, sobre el umbral acordado con el cliente.",
    source: "Umbral configurado para el estudio.",
    kind: "category",
    values: [
      { value: "verde", label: "Verde" },
      { value: "amarillo", label: "Amarillo" },
      { value: "rojo", label: "Rojo" },
    ],
    filterEligible: true,
    journeyEligible: false,
    publicationReady: true,
  },
  {
    id: "period",
    label: "Periodo",
    description: "La medición a la que pertenece cada respuesta.",
    source: "Periodo declarado del estudio.",
    kind: "period",
    values: [
      { value: "2025_s1", label: "Primer semestre 2025" },
      { value: "2025_s2", label: "Segundo semestre 2025" },
      { value: "2026_s1", label: "Primer semestre 2026" },
    ],
    filterEligible: true,
    journeyEligible: false,
    publicationReady: true,
  },
];

/**
 * The demonstration registry.
 *
 * Note what is NOT here: no formula, no column name, no table, no respondent,
 * and nothing a generic module had to learn in order to make this work.
 */
export function fixtureRegistry(): SemanticRegistry {
  const registry: SemanticRegistry = {
    scope: { tenantId: FIXTURE_TENANT, studyId: FIXTURE_STUDY },
    registryVersion: "",
    metrics: METRICS,
    dimensions: DIMENSIONS,
  };
  return { ...registry, registryVersion: registrySignature(registry) };
}

export const FIXTURE_SCOPE = { tenantId: FIXTURE_TENANT, studyId: FIXTURE_STUDY };

/**
 * The same registry with the recorrido restricted to satisfaction — the "a
 * recorrido is about satisfaction and nothing else" configuration a client can
 * genuinely ask for.
 *
 * TWO GATES, DELIBERATELY DIFFERENT. `journeyEligible` says a result may appear
 * anywhere inside a recorrido; the journey's own `eligibleFamilies` says which
 * family may be a moment's HEADLINE. The awareness measure stays eligible under
 * both readings, because "how many people did not know this moment existed" is
 * a companion to a moment rather than a competing headline for it — a
 * satisfaction recorrido without it would lose the one number that
 * distinguishes a badly run touchpoint from an unknown one.
 */
export function satisfactionOnlyJourneyRegistry(): SemanticRegistry {
  const base = fixtureRegistry();
  const metrics = base.metrics.map((metric) => ({
    ...metric,
    journeyEligible: metric.family === "satisfaction" || metric.family === "awareness",
  }));
  const registry: SemanticRegistry = { ...base, registryVersion: "", metrics };
  return { ...registry, registryVersion: registrySignature(registry) };
}
