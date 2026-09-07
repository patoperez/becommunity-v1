// =============================================================================
// MANDATORY canonical presentation gate — Unit 6A
//   npx tsx scripts/canonical-presentation-test.mjs
// =============================================================================
// Unit 6A builds the bridge between the canonical results document and a future
// customizable dashboard: a server-authoritative REGISTRY of opaque handles, a
// versioned presentation DOCUMENT, and a pure RESOLVER that turns the two into a
// serializable render model. This gate proves five separable things, entirely
// from a SYNTHETIC fixture built here.
//
//   THE BRIDGE HOLDS. Every handle the approved blueprint binds resolves; an
//   unknown handle is refused with its own typed code; an unknown schema
//   version is refused by name rather than by confusion; and two runs of the
//   same inputs produce byte-identical bytes.
//
//   THE NUMBERS ARE NOT TOUCHED. Every value in a render model is the value the
//   canonical document already carried, formatted by the canonical layer. TDP is
//   a ratio over the valid base: it may exceed 100 and NOTHING in the
//   presentation layer clamps it. The presentation modules import no calculator.
//
//   THE BOUNDARY HOLDS. No respondent row, no free text, no canonical item,
//   attribute, metric or band-scheme key, no canonical table name and no
//   server-only address reaches a client-reachable structure.
//
//   FILTERS ARE EXPLICIT. Sharing a dimension is never a connection. A filter
//   moves a block when, and only when, a connection names it. A dimension a
//   result does not support is refused, and an authority-forbidden cross —
//   Esfera × CRI — is refused under its OWN code, not as a generic mismatch.
//
//   SMALL SAMPLES ARE SHOWN. The system default is `show_all`. A suppressing
//   policy exists only when a person authored one, with a name and a reason, and
//   authoring one on a block does not turn it into a global software rule.
//
// The approved dashboard's REAL figures are compared in
// `npm run test:canonical-presentation-parity`, deliberately outside `npm test`
// because its inputs are machine-specific. No client workbook, name, answer or
// identifier is committed to this file.
// =============================================================================

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import { CANONICAL_FAMILY_TABLES } from "./lib/canonical-tables.mjs";
import { CUICUILCO_RESULTS_V1, buildCanonicalStudyResults, emptyResultSource } from "../src/lib/results/index.ts";
import {
  APPROVED_FIRST_GROUP_PARTITION,
  APPROVED_ROUTE_IDS,
  COMPATIBLE_CHART_VARIANTS,
  DEFAULT_SAMPLE_POLICY,
  LEGACY_EXPERIENCE_SCHEMA_VERSIONS,
  PRESENTATION_DOCUMENT_KIND,
  PRESENTATION_DOCUMENT_SCHEMA_VERSION,
  PRESENTATION_SEMANTICS,
  SEMANTIC_UNITS,
  buildApprovedCuicuilcoBlueprint,
  buildCanonicalPresentationRegistry,
  duplicateBlock,
  projectPresentationCatalog,
  resolvePresentation,
  serializeDeterministic,
  validatePresentationDocument,
} from "../src/lib/presentation/index.ts";

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
/** Assert a refusal happened AND happened for the intended reason. */
const refuses = (label, outcome, expectedCode) => {
  if (outcome.ok) {
    bad(`${label}: se esperaba un rechazo y se obtuvo un documento`);
    return;
  }
  const codes = outcome.errors.map((entry) => entry.code);
  codes.includes(expectedCode)
    ? ok(`${label} → ${expectedCode}`)
    : bad(`${label}: se esperaba ${expectedCode}, se obtuvo ${codes.join(", ") || "(ninguno)"}`);
};

console.log("Be Community — compuerta de la capa de presentación canónica (Unidad 6A)");
console.log("=".repeat(74));

/* -------------------------------------------------------------------------- */
/* synthetic fixture, shaped like the study and carrying invented numbers      */
/* -------------------------------------------------------------------------- */

const SPEC = CUICUILCO_RESULTS_V1;
const UNAWARE_RAW = SPEC.unawareness.rawValues[0];

const IDENTITY = {
  specId: "cuicuilco",
  mappingVersion: 1,
  calculationVersion: SPEC.calculationVersion,
  tenantId: "00000000-0000-4000-8000-0000000006a1",
  studyId: "00000000-0000-4000-8000-0000000006a2",
  packageIdempotencyKey: "sha256:fixture-6a",
  planFingerprint: "sha256:fixture-6a-plan",
};

/** The source's four merged bands, and the sizes the workbook states. */
const GROUPS = [
  { key: "interacciones_operacion", label: "Interacciones y operación", size: 29 },
  { key: "rendicion_cuentas", label: "Rendición de cuentas", size: 6 },
  { key: "cultura_edl", label: "Cultura (EDL)", size: 10 },
  { key: "cultura_miembros", label: "Cultura (miembros)", size: 10 },
];

/** Position 24 of the first group — where the workbook carries `Capitanes de Esfera`. */
const CAPITANES_POSITION = 24;
/** Position 28 of the first group — the touchpoint whose unawareness exceeds its valid base. */
const OVER_HUNDRED_POSITION = 28;

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
      { schemeKey: "csat_presentacion", lowerBound: 0, upperBound: 60, lowerInclusive: true, upperInclusive: false, label: "menos de 60", semanticColor: "red", displayOrder: 0 },
      { schemeKey: "csat_presentacion", lowerBound: 60, upperBound: 75, lowerInclusive: true, upperInclusive: false, label: "60 a menos de 75", semanticColor: "yellow", displayOrder: 1 },
      { schemeKey: "csat_presentacion", lowerBound: 75, upperBound: 100, lowerInclusive: true, upperInclusive: true, label: "75 a 100", semanticColor: "green", displayOrder: 2 },
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
  {
    key: "desempeno_mensual",
    label: "Desempeño",
    unit: "score",
    description: "fixture",
    rules: [
      { schemeKey: "desempeno_mensual", lowerBound: 0, upperBound: 100, lowerInclusive: true, upperInclusive: true, label: "0 a 100", semanticColor: "gray", displayOrder: 0 },
    ],
  },
];

const ACTIVE = ["a1", "a2", "a3", "a4", "a5", "a6", "a7"];
const DESERTERS = ["d1", "d2", "d3", "d4"];

function itemKeyFor(groupIndex, position) {
  return `csat_g${groupIndex}p${position}`;
}

function baseSource() {
  const source = emptyResultSource(IDENTITY);

  source.participants = [
    ...ACTIVE.map((id) => ({
      participantId: id,
      cohortKey: "active",
      participationStatus: "included",
      surveyParticipationStatus: "unknown",
      sourceStatus: "answered",
    })),
    ...DESERTERS.map((id, index) => ({
      participantId: id,
      cohortKey: "deserter",
      participationStatus: "included",
      surveyParticipationStatus: index < 2 ? "responded" : "not_participated",
      sourceStatus: index < 2 ? "answered" : "not_participated",
    })),
  ];

  source.attributeDefinitions = [
    { key: "perfil_cliente_d", label: "Rango de edad", dataType: "category", sensitivity: "internal", filterable: true, displayOrder: 0 },
    { key: "perfil_cliente_e", label: "Generación", dataType: "category", sensitivity: "internal", filterable: true, displayOrder: 4 },
    // Column H of the active profile sheet is Esfera — the dimension §5.2
    // forbids crossing with the renewal index.
    { key: "perfil_cliente_h", label: "Esfera", dataType: "category", sensitivity: "internal", filterable: true, displayOrder: 1 },
    // A PRIVATE definition. It must never become a filter dimension, and so must
    // never become a handle a presentation could bind.
    { key: "perfil_cliente_a", label: "Marca temporal", dataType: "date", sensitivity: "private", filterable: false, displayOrder: 2 },
  ];

  source.attributeValues = [
    ...ACTIVE.map((id, index) => ({
      participantId: id,
      attributeKey: "perfil_cliente_d",
      status: "answered",
      text: index < 3 ? "Rango A" : "Rango B",
      numeric: null,
    })),
    ...ACTIVE.map((id, index) => ({
      participantId: id,
      attributeKey: "perfil_cliente_e",
      status: "answered",
      text: index < 4 ? "Generación X" : "Millenial",
      numeric: null,
    })),
    ...ACTIVE.map((id, index) => ({
      participantId: id,
      attributeKey: "perfil_cliente_h",
      status: "answered",
      text: index % 2 === 0 ? "Esfera Norte" : "Esfera Sur",
      numeric: null,
    })),
    ...ACTIVE.map((id) => ({
      participantId: id,
      attributeKey: "perfil_cliente_a",
      status: "answered",
      text: "SENTINEL-PRIVADO-MARCA-TEMPORAL",
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
        // The source names a touchpoint by the whole question it asks; the short
        // label lives in a column the projection records as the ANSWER's derived
        // label, so `shortLabel` is null for this study. A gate that looked a
        // touchpoint up by a friendly name would therefore find nothing, which is
        // exactly why the registry addresses one by POSITION.
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
    { sessionId: "s-exit-d1", instrumentKey: "nps_desertores", participantId: "d1", status: "answered" },
    { sessionId: "s-exit-d2", instrumentKey: "nps_desertores", participantId: "d2", status: "answered" },
    { sessionId: "s-exit-d3", instrumentKey: "nps_desertores", participantId: "d3", status: "not_participated" },
    { sessionId: "s-exit-d4", instrumentKey: "nps_desertores", participantId: "d4", status: "not_participated" },
  ];

  const option = (scaleKey, raw) =>
    SCALE_OPTIONS.find((candidate) => candidate.scaleKey === scaleKey && candidate.rawValue === raw);

  const csatAnswer = (sessionId, itemKey, raw) => {
    const found = option("satisfaccion_csat", raw);
    return {
      sessionId,
      itemKey,
      status: "answered",
      numeric: found?.numericValue ?? null,
      text: null,
      optionRawValue: found?.rawValue ?? null,
      derivedLabel: found?.derivedLabel ?? null,
    };
  };

  const answers = [];
  GROUPS.forEach((group, groupIndex) => {
    for (let position = 1; position <= group.size; position += 1) {
      const itemKey = itemKeyFor(groupIndex, position);
      // The over-hundred touchpoint: two people could rate it, four had never
      // heard of it. TDP = 4/2 = 200, and the presentation layer must carry that
      // through untouched.
      const pattern =
        groupIndex === 0 && position === OVER_HUNDRED_POSITION
          ? ["5", "4", "1", UNAWARE_RAW, UNAWARE_RAW, UNAWARE_RAW, UNAWARE_RAW]
          : ["5", "5", "4", "4", "2", UNAWARE_RAW, "5"];
      ACTIVE.forEach((id, index) => {
        answers.push(csatAnswer(`s-csat-${id}`, itemKey, pattern[index]));
      });
    }
  });

  ACTIVE.forEach((id, index) => {
    const raw = String([10, 9, 9, 8, 7, 3, 10][index]);
    const found = option("recomendacion_nps", raw);
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
      text: ["Extremadamente probable", "Muy probable", "Algo probable", "Poco probable", "Nada probable", "Algo probable", "Muy probable"][index],
      optionRawValue: null,
      derivedLabel: null,
    });
    answers.push({
      sessionId: `s-cri-${id}`,
      itemKey: "cri_e",
      status: index === 5 ? "not_applicable" : "answered",
      numeric: null,
      text: index === 5 ? null : ["Malos resultados financieros", "Tiempo", "Malos resultados financieros", "Situaciones personales", "Tiempo", null, "Tiempo"][index],
      optionRawValue: null,
      derivedLabel: null,
    });
  });

  ["d1", "d2"].forEach((id, index) => {
    const raw = String([8, 4][index]);
    const found = option("recomendacion_nps", raw);
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
    {
      seriesKey: "membership_retention",
      order: 1,
      label: "periodo dos",
      startsOn: null,
      endsOn: null,
      starting: { count: 12, status: "answered" },
      joined: { count: 3, status: "answered" },
      ending: { count: 11, status: "answered" },
      lost: { count: 4, status: "answered" },
      identityVerified: true,
    },
  ];

  // The curated journey model and one curated finding. Their presence is what
  // makes the contract emit its two CONFIGURATION REQUIREMENTS — the stage-to
  // -evidence rule and the curated pain cloud — and those are the two editorial
  // slots the approved blueprint declares without filling.
  source.journeyModels = [
    { key: "journey_miembro", label: "Journey del miembro", audience: "miembros", displayOrder: 0 },
  ];
  source.journeyStages = [
    { key: "etapa_1", label: "Etapa uno", journeyModelKey: "journey_miembro", stageOrder: 0 },
    { key: "etapa_2", label: "Etapa dos", journeyModelKey: "journey_miembro", stageOrder: 1 },
  ];
  source.curatedFindings = [
    {
      reviewStatus: "confirmed",
      journeyStageKeys: ["etapa_1"],
      organizationalUnitKeys: [],
      performanceDimensionKeys: [],
      cultureDimensionKeys: [],
    },
    {
      reviewStatus: "pending",
      journeyStageKeys: ["etapa_2"],
      organizationalUnitKeys: [],
      performanceDimensionKeys: [],
      cultureDimensionKeys: [],
    },
  ];

  return source;
}

const source = baseSource();
const results = buildCanonicalStudyResults(source);
const registry = buildCanonicalPresentationRegistry(results);

/* -------------------------------------------------------------------------- */

console.log("\n[1] El fixture reproduce la forma del estudio");
eq("grupos de origen", results.journey.groups.length, 4);
eq("puntos de contacto", results.journey.touchpoints.length, 55);
check(
  results.journey.groups.map((group) => group.touchpointKeys.length).join("/") === "29/6/10/10",
  "las cuatro categorías del origen son 29 / 6 / 10 / 10",
);
eq("periodos de retención", results.retention.periods.length, 2);
eq("alcances de recomendación", results.recommendation.scopes.length, 3);

/* -------------------------------------------------------------------------- */

console.log("\n[2] El vocabulario es cerrado y exhaustivo");
check(
  PRESENTATION_SEMANTICS.every((semantic) => Array.isArray(COMPATIBLE_CHART_VARIANTS[semantic])),
  "cada semántica declara sus variantes compatibles",
);
check(
  PRESENTATION_SEMANTICS.every((semantic) => Array.isArray(SEMANTIC_UNITS[semantic])),
  "cada semántica declara la unidad en la que ya viene expresada",
);
eq(
  "la TDP se declara como razón y no como porcentaje",
  SEMANTIC_UNITS.touchpoint_process_unawareness.join(","),
  "ratio",
);
check(
  !COMPATIBLE_CHART_VARIANTS.touchpoint_process_unawareness.includes("gauge"),
  "una razón que puede pasar de 100 no se acepta en un medidor de 0 a 100",
);

/* -------------------------------------------------------------------------- */

console.log("\n[3] El registro enlaza sin exponer una sola clave canónica");
check(registry.entries.length > 200, `el registro publica ${registry.entries.length} entradas`);
check(
  registry.entries.every((entry, index, all) => index === 0 || all[index - 1].handle < entry.handle),
  "las entradas salen ordenadas por handle, sin empates",
);

/** Every canonical key the fixture uses, plus every canonical table name. */
const CANONICAL_KEYS = [
  ...source.items.map((item) => item.key),
  ...source.attributeDefinitions.map((definition) => definition.key),
  ...source.instruments.map((instrument) => instrument.key),
  ...source.domains.map((domain) => domain.key),
  ...BAND_SCHEMES.map((scheme) => scheme.key),
  "membership_retention",
  "nps_activos",
  "nps_desertores",
  "retencion",
  "desercion",
];
const CANONICAL_TABLE_NAMES = CANONICAL_FAMILY_TABLES.map((entry) => entry.table);

const handleText = registry.entries.map((entry) => entry.handle).join(" ");
const leakedKeys = CANONICAL_KEYS.filter((key) => key.includes("_") && handleText.includes(key));
check(leakedKeys.length === 0, `ningún handle contiene una clave canónica${leakedKeys.length ? `: ${leakedKeys.join(", ")}` : ""}`);
const leakedTables = CANONICAL_TABLE_NAMES.filter((table) => handleText.includes(table));
check(leakedTables.length === 0, `ningún handle contiene un nombre de tabla${leakedTables.length ? `: ${leakedTables.join(", ")}` : ""}`);
check(!handleText.includes("_"), "ningún handle lleva un guion bajo, que es la forma de toda clave canónica");

const dimensionHandles = registry.entries.filter((entry) => entry.handle.startsWith("dimension:"));
check(
  dimensionHandles.some((entry) => entry.handle === "dimension:esfera"),
  "la dimensión Esfera existe, nombrada por su etiqueta y no por su columna",
);
check(
  !dimensionHandles.some((entry) => entry.label === "Marca temporal"),
  "un atributo privado no llega a ser una dimensión de filtro",
);

console.log("\n[4] La proyección al catálogo deja el enlace en el servidor");
const catalog = projectPresentationCatalog(registry);
const catalogText = serializeDeterministic(catalog);
check(!("addresses" in catalog), "el catálogo no lleva el mapa de direcciones");
check(!catalogText.includes('"at":'), "el catálogo serializado no contiene una dirección canónica");
const catalogLeaks = [...CANONICAL_KEYS.filter((key) => key.includes("_")), ...CANONICAL_TABLE_NAMES].filter((needle) =>
  catalogText.includes(needle),
);
check(catalogLeaks.length === 0, `el catálogo no filtra claves ni tablas${catalogLeaks.length ? `: ${catalogLeaks.join(", ")}` : ""}`);
check(!catalogText.includes("SENTINEL-PRIVADO"), "el catálogo no lleva un valor de atributo privado");

/* -------------------------------------------------------------------------- */

console.log("\n[5] El plano aprobado resuelve entero");
const blueprint = buildApprovedCuicuilcoBlueprint(registry);
const validated = validatePresentationDocument(JSON.parse(JSON.stringify(blueprint)));
check(validated.ok, "el plano aprobado valida contra el esquema versionado");
if (!validated.ok) {
  console.error(JSON.stringify(validated.errors, null, 1));
  console.log("\n" + "=".repeat(74));
  console.error(`RESULTADO: ${failures + 1} fallo(s). COMPUERTA BLOQUEADA.`);
  process.exit(1);
}
const document = validated.value;
const resolved = resolvePresentation({ document, registry, results });
check(resolved.ok, "el plano aprobado resuelve sin un solo enlace colgante");
if (!resolved.ok) {
  console.error(JSON.stringify(resolved.errors, null, 1));
  console.log("\n" + "=".repeat(74));
  console.error(`RESULTADO: ${failures + 1} fallo(s). COMPUERTA BLOQUEADA.`);
  process.exit(1);
}
const model = resolved.value;
const blocks = model.pages.flatMap((page) => page.blocks);
check(blocks.length >= 20, `el plano cubre ${blocks.length} bloques`);

const covered = new Set(blocks.map((block) => block.id));
for (const required of [
  "portada",
  "portada-poblacion",
  "retencion-serie",
  "recomendacion-puntaje",
  "recomendacion-composicion",
  "recorrido-rutas",
  "riesgo-indice",
  "riesgo-distribucion",
  "temas-activos",
  "temas-desertores",
  "temas-recorrido",
  "cierre",
]) {
  check(covered.has(required), `el plano incluye «${required}»`);
}

/* -------------------------------------------------------------------------- */

console.log("\n[6] Cuatro grupos de origen, cinco recorridos visibles");
const routesBlock = blocks.find((block) => block.payload.shape === "routes");
check(routesBlock !== undefined, "el plano publica un bloque de rutas");
// Every later read is defensive on purpose: a gate that THROWS stops running,
// and a section that never ran cannot report the regression it was written to
// catch. A missing value must fail an assertion, not kill the process.
const routes = routesBlock?.payload.shape === "routes" ? routesBlock.payload.routes : [];
eq("rutas visibles", routes.length, 5);
eq("grupos de origen en el contrato", results.journey.groups.length, 4);
check(
  routes.map((route) => route.id).join(",") === APPROVED_ROUTE_IDS.join(","),
  "las cinco rutas salen en el orden aprobado",
);
const routePoints = routes.flatMap((route) => route.points);
eq("puntos repartidos entre las rutas", routePoints.length, 55);
eq("puntos distintos", new Set(routePoints.map((point) => point.handle)).size, 55);
const firstGroupRoutes = routes.filter((route) => route.sourceGroupLabel === "Interacciones y operación");
eq("rutas que reparten la primera categoría", firstGroupRoutes.length, 2);
eq("puntos de «Operación»", firstGroupRoutes[0]?.points.length, APPROVED_FIRST_GROUP_PARTITION.operacion.length);
eq("puntos de «Interacción»", firstGroupRoutes[1]?.points.length, APPROVED_FIRST_GROUP_PARTITION.interaccion.length);
eq(
  "la partición de la primera categoría suma sus 29 columnas",
  APPROVED_FIRST_GROUP_PARTITION.operacion.length + APPROVED_FIRST_GROUP_PARTITION.interaccion.length,
  29,
);
check(
  new Set([...APPROVED_FIRST_GROUP_PARTITION.operacion, ...APPROVED_FIRST_GROUP_PARTITION.interaccion]).size === 29,
  "la partición no repite ni omite una sola posición",
);

console.log("\n[7] El punto de contacto válido está una vez; el duplicado roto no está");
const capitanesHandle = `journey-touchpoint:g1-t${CAPITANES_POSITION}`;
const capitanesAppearances = routePoints.filter((point) => point.handle === capitanesHandle);
eq("apariciones del punto 24 de la primera categoría", capitanesAppearances.length, 1);
check(
  capitanesAppearances[0]?.satisfaction !== null,
  "ese punto llega con su satisfacción, no vacío",
);
check(
  results.journey.excluded.length === 0,
  "el origen limpio no lleva la columna rota, así que no hay nada que excluir",
);
const modelText = serializeDeterministic(model);
check(!modelText.includes("#REF"), "el modelo de render no arrastra ningún token de error de hoja de cálculo");

/* -------------------------------------------------------------------------- */

console.log("\n[8] La TDP puede pasar de 100 y la presentación no la recorta");
const overHundredHandle = `journey-touchpoint:g1-t${OVER_HUNDRED_POSITION}`;
const overHundred = routePoints.find((point) => point.handle === overHundredHandle);
check(overHundred !== undefined, "el punto con más desconocimiento que base válida está en una ruta");
eq("su TDP", overHundred?.processUnawareness?.value, 133.3);
eq("su unidad", overHundred?.processUnawareness?.unit, "ratio");
const canonicalTdp = results.journey.touchpoints.find(
  (touchpoint) => touchpoint.key === itemKeyFor(0, OVER_HUNDRED_POSITION),
).tdp;
check(
  canonicalTdp.status === "available" && overHundred?.processUnawareness?.value === canonicalTdp.value.value,
  "el valor del modelo de render es EXACTAMENTE el del documento canónico",
);
check(
  overHundred?.processUnawareness?.formatted === canonicalTdp.value.formatted,
  "y su texto formateado también, sin volver a redondear",
);
check(
  routePoints.every((point) => point.processUnawareness === null || point.processUnawareness.value <= 133.3),
  "ninguna TDP fue reescalada hacia abajo",
);

/* -------------------------------------------------------------------------- */

console.log("\n[9] Los valores vienen del documento canónico, no de un cálculo nuevo");
const npsBlock = blocks.find((block) => block.id === "recomendacion-puntaje");
const canonicalNps = results.recommendation.scopes.find((scope) => scope.key === "combinado").score;
check(
  npsBlock?.payload.shape === "value" &&
    canonicalNps.status === "available" &&
    npsBlock.payload.value?.value === canonicalNps.value.value &&
    npsBlock.payload.value?.formatted === canonicalNps.value.formatted,
  "la recomendación se copia del contrato, cifra y formato",
);
const riskBlock = blocks.find((block) => block.id === "riesgo-indice");
check(
  riskBlock?.payload.shape === "value" &&
    results.renewal.index.status === "available" &&
    riskBlock.payload.value?.value === results.renewal.index.value.value,
  "el índice de renovación se copia del contrato",
);
check(!modelText.includes("schemeKey"), "el modelo de render no lleva la clave del esquema de bandas");
check(!modelText.includes('"internal"'), "el modelo de render no lleva la procedencia interna");
const modelLeaks = [...CANONICAL_KEYS.filter((key) => key.includes("_")), ...CANONICAL_TABLE_NAMES].filter((needle) =>
  modelText.includes(needle),
);
check(modelLeaks.length === 0, `el modelo de render no filtra claves ni tablas${modelLeaks.length ? `: ${modelLeaks.join(", ")}` : ""}`);
check(!modelText.includes("SENTINEL-PRIVADO"), "el modelo de render no lleva un valor privado");
check(!modelText.includes('"at":'), "el modelo de render no lleva una dirección canónica");
for (const id of ["a1", "d1"]) {
  check(!new RegExp(`"${id}"`).test(modelText), `el modelo de render no nombra a la participación ${id}`);
}

// EVERY value, not a hand-picked few. A source scan can only say the layer looks
// like it does not compute; this says that it did not. Each finished number in
// the render model must be a number the canonical document already carried —
// same value, same unit, same declared precision, same formatted text — or a
// plain count the contract states. A clamp, a re-round, a rescale or a derived
// percentage all move a value out of that set, whatever shape the code took.
const canonicalValues = new Set();
const canonicalCounts = new Set();
const collectCanonical = (node) => {
  if (node === null || typeof node !== "object") return;
  if (Array.isArray(node)) {
    node.forEach(collectCanonical);
    return;
  }
  const candidate = node;
  if (
    typeof candidate.value === "number" &&
    typeof candidate.unit === "string" &&
    typeof candidate.decimals === "number" &&
    typeof candidate.formatted === "string"
  ) {
    canonicalValues.add(`${candidate.value}|${candidate.unit}|${candidate.decimals}|${candidate.formatted}`);
  }
  for (const entry of Object.values(candidate)) collectCanonical(entry);
};
collectCanonical(results);
canonicalCounts.add(results.population.total);
canonicalCounts.add(results.population.measured);

const renderedValues = [];
const collectRendered = (node) => {
  if (node === null || typeof node !== "object") return;
  if (Array.isArray(node)) {
    node.forEach(collectRendered);
    return;
  }
  if (
    typeof node.value === "number" &&
    typeof node.unit === "string" &&
    typeof node.decimals === "number" &&
    typeof node.formatted === "string"
  ) {
    renderedValues.push(node);
  }
  for (const entry of Object.values(node)) collectRendered(entry);
};
collectRendered(model);

const untraceable = renderedValues.filter((rendered) => {
  const key = `${rendered.value}|${rendered.unit}|${rendered.decimals}|${rendered.formatted}`;
  if (canonicalValues.has(key)) return false;
  // A population headline is a count the source stated. It carries no
  // `ResultValue`, so it is admitted only as the exact integer the contract
  // reports, printed as itself and nothing else.
  const isStatedCount =
    rendered.unit === "count" &&
    rendered.decimals === 0 &&
    Number.isInteger(rendered.value) &&
    canonicalCounts.has(rendered.value) &&
    rendered.formatted === String(rendered.value);
  return !isStatedCount;
});
check(renderedValues.length > 40, `el modelo de render publica ${renderedValues.length} cifras finales`);
check(
  untraceable.length === 0,
  `cada cifra del modelo procede del documento canónico${
    untraceable.length
      ? `: ${untraceable.length} sin origen, p. ej. ${untraceable[0].value} ${untraceable[0].unit} «${untraceable[0].formatted}»`
      : ""
  }`,
);

/* -------------------------------------------------------------------------- */

console.log("\n[10] Versionado: lo desconocido se rechaza en voz alta, nunca se reinterpreta");
eq("la versión que esta compilación escribe", PRESENTATION_DOCUMENT_SCHEMA_VERSION, 4);
check(
  LEGACY_EXPERIENCE_SCHEMA_VERSIONS.every((version) => version < PRESENTATION_DOCUMENT_SCHEMA_VERSION),
  "las versiones heredadas quedan por debajo y no colisionan",
);
for (const legacyVersion of LEGACY_EXPERIENCE_SCHEMA_VERSIONS) {
  refuses(
    `una definición heredada v${legacyVersion}`,
    validatePresentationDocument({ schemaVersion: legacyVersion, id: "x", title: "y", pages: [] }),
    "unsupported_schema_version",
  );
}
refuses(
  "una versión futura desconocida",
  validatePresentationDocument({ ...document, schemaVersion: 99 }),
  "unsupported_schema_version",
);
refuses(
  "un documento heredado sellado con la versión de presentación",
  validatePresentationDocument({ schemaVersion: PRESENTATION_DOCUMENT_SCHEMA_VERSION, pages: [], id: "x", title: "y" }),
  "unsupported_schema_version",
);
refuses(
  "un documento sin versión entera",
  validatePresentationDocument({ schemaVersion: "4", documentKind: PRESENTATION_DOCUMENT_KIND }),
  "malformed_document",
);
refuses(
  "un documento con un campo desconocido",
  validatePresentationDocument({ ...document, sorpresa: true }),
  "malformed_document",
);

/* -------------------------------------------------------------------------- */

console.log("\n[11] El handle desconocido y la variante incompatible se rechazan por su código");
const withUnknownHandle = structuredClone(document);
withUnknownHandle.pages[0].blocks.find((block) => block.id === "recomendacion-puntaje").binding =
  "value:no-existe-en-el-registro";
refuses(
  "un enlace que el registro no conoce",
  resolvePresentation({ document: withUnknownHandle, registry, results }),
  "unknown_handle",
);

const withBadVariant = structuredClone(document);
withBadVariant.pages[0].blocks.find((block) => block.id === "temas-activos").chartVariant = "gauge";
refuses(
  "una nube de términos dibujada como medidor",
  resolvePresentation({ document: withBadVariant, registry, results }),
  "incompatible_chart_variant",
);

const withMismatchedFacet = structuredClone(document);
withMismatchedFacet.pages[0].blocks.find((block) => block.id === "recomendacion-puntaje").binding =
  "dimension:esfera";
refuses(
  "una dimensión de filtro dibujada como resultado",
  resolvePresentation({ document: withMismatchedFacet, registry, results }),
  "handle_facet_mismatch",
);

const mismatchedRegistry = { ...registry, contractVersion: "0.0.0" };
refuses(
  "un registro construido sobre otro contrato",
  resolvePresentation({ document, registry: mismatchedRegistry, results }),
  "registry_contract_mismatch",
);

/* -------------------------------------------------------------------------- */

console.log("\n[12] Los filtros son explícitos, y compartir una dimensión no es conectarse");
const riskPanel = document.pages[0].blocks.find((block) => block.id === "panel-riesgo");
const reasonsBlock = document.pages[0].blocks.find((block) => block.id === "riesgo-razones");
check(riskPanel?.dimensions.length > 0, `el panel de riesgo ofrece ${riskPanel.dimensions.length} dimensiones`);
check(
  reasonsBlock?.connectedFilterPanelIds.length === 0,
  "«Razones declaradas de riesgo» no se conecta a ningún panel",
);
const reasonsEntry = registry.entries.find((entry) => entry.handle === reasonsBlock.binding);
check(
  riskPanel.dimensions.every((dimension) => reasonsEntry?.supportedFilters.includes(dimension)),
  "y sin embargo comparte cada una de las dimensiones de ese panel",
);
const renderedReasons = blocks.find((block) => block.id === "riesgo-razones");
check(
  renderedReasons?.connectedFilterPanelIds.length === 0,
  "el modelo de render conserva esa desconexión, así que el panel no lo mueve",
);
const comparison = blocks.find((block) => block.id === "recomendacion-comparacion-activos");
check(
  comparison?.connectedFilterPanelIds.length === 0,
  "las celdas de comparación tampoco se mueven con el panel de recomendación",
);
const filtered = blocks.find((block) => block.id === "recomendacion-puntaje");
check(
  filtered?.connectedFilterPanelIds.includes("panel-recomendacion"),
  "y el puntaje que sí debe moverse nombra su panel",
);

console.log("\n[13] Esfera × CRI se rechaza por su propio código");
const renewalEntry = registry.entries.find((entry) => entry.handle === "value:renewal-index");
check(
  renewalEntry?.forbiddenFilters.includes("dimension:esfera"),
  "el registro marca Esfera como cruce prohibido del índice de renovación",
);
check(
  !renewalEntry?.supportedFilters.includes("dimension:esfera"),
  "y por lo tanto no la ofrece entre las dimensiones soportadas",
);
check(
  !riskPanel?.dimensions.includes("dimension:esfera"),
  "el panel de riesgo del plano aprobado NO ofrece Esfera, corrigiendo la desviación del tablero de referencia",
);
const withForbiddenCross = structuredClone(document);
withForbiddenCross.pages[0].blocks.find((block) => block.id === "panel-riesgo").dimensions.push("dimension:esfera");
refuses(
  "un panel que añade Esfera y mueve el índice de renovación",
  resolvePresentation({ document: withForbiddenCross, registry, results }),
  "forbidden_filter_cross",
);

console.log("\n[14] Una dimensión no soportada se rechaza aparte de una prohibida");
// Two refusals that must stay APART. A forbidden cross is an authority saying
// "this may not be published"; an unsupported dimension is a result saying "I do
// not carry that". Collapsing them would let a future change silently reclassify
// the Esfera prohibition as a mere capability gap.
const offered = riskPanel.dimensions[0];
check(offered !== undefined, "el panel de riesgo ofrece al menos una dimensión que probar");
const narrowedRegistry = {
  ...registry,
  entries: registry.entries.map((entry) =>
    entry.handle === "value:renewal-index"
      ? { ...entry, supportedFilters: entry.supportedFilters.filter((handle) => handle !== offered) }
      : entry,
  ),
};
const unsupportedOutcome = resolvePresentation({ document, registry: narrowedRegistry, results });
check(
  !unsupportedOutcome.ok &&
    unsupportedOutcome.errors.some((entry) => entry.code === "unsupported_filter_dimension"),
  "una dimensión que el resultado no declara soportar se rechaza como no soportada",
);
check(
  !unsupportedOutcome.ok &&
    !unsupportedOutcome.errors.some((entry) => entry.code === "forbidden_filter_cross"),
  "y no se confunde con un cruce prohibido",
);

/* -------------------------------------------------------------------------- */

console.log("\n[15] Una ruta no puede inventar pertenencia");
const withForeignPoint = structuredClone(document);
const routeBlockDraft = withForeignPoint.pages[0].blocks.find((block) => block.id === "recorrido-rutas");
routeBlockDraft.routes[0].touchpoints.push("journey-touchpoint:g2-t1");
refuses(
  "una ruta que reclama un punto de otra categoría",
  resolvePresentation({ document: withForeignPoint, registry, results }),
  "route_touchpoint_outside_group",
);
const withDuplicatePoint = structuredClone(document);
const duplicateDraft = withDuplicatePoint.pages[0].blocks.find((block) => block.id === "recorrido-rutas");
duplicateDraft.routes[1].touchpoints.push(duplicateDraft.routes[0].touchpoints[0]);
refuses(
  "dos rutas que reclaman el mismo punto",
  resolvePresentation({ document: withDuplicatePoint, registry, results }),
  "route_touchpoint_duplicated",
);

/* -------------------------------------------------------------------------- */

console.log("\n[16] La muestra pequeña se muestra: `show_all` es el sistema, no una elección");
eq("el modo por omisión", DEFAULT_SAMPLE_POLICY.mode, "show_all");
eq("el plano aprobado no suprime nada", document.samplePolicy.mode, "show_all");
check(
  blocks.every((block) => block.samplePolicy.mode === "show_all"),
  "y ningún bloque hereda una regla de ocultamiento",
);
const blueprintText = readFileSync(join("src", "lib", "presentation", "blueprints", "cuicuilco-approved.ts"), "utf8");
check(
  !/hide_below/.test(stripComments(blueprintText)),
  "el plano aprobado no menciona un umbral de ocultamiento en su código",
);
refuses(
  "una política de ocultamiento sin autoría ni razón",
  validatePresentationDocument({ ...document, samplePolicy: { mode: "hide_below", threshold: 5 } }),
  "malformed_document",
);

console.log("\n[17] Una política redactada viaja de ida y vuelta sin volverse una regla global");
const authored = structuredClone(document);
const authoredPolicy = {
  mode: "hide_below",
  threshold: 4,
  authoredBy: "Dirección del estudio",
  rationale: "Acordado con el cliente para este bloque en particular.",
};
authored.pages[0].blocks.find((block) => block.id === "recomendacion-puntaje").samplePolicy = authoredPolicy;
const authoredValidated = validatePresentationDocument(JSON.parse(JSON.stringify(authored)));
check(authoredValidated.ok, "una política redactada, con autor y razón, valida");
if (authoredValidated.ok) {
  const roundTripped = JSON.parse(serializeDeterministic(authoredValidated.value));
  const stored = roundTripped.pages[0].blocks.find((block) => block.id === "recomendacion-puntaje").samplePolicy;
  check(
    stored.mode === "hide_below" && stored.threshold === 4 && stored.authoredBy === authoredPolicy.authoredBy,
    "y sobrevive la serialización intacta",
  );
  eq("el documento sigue mostrando todo por omisión", roundTripped.samplePolicy.mode, "show_all");
  const authoredModel = resolvePresentation({ document: authoredValidated.value, registry, results });
  check(authoredModel.ok, "el documento con la política redactada resuelve");
  if (authoredModel.ok) {
    const authoredBlocks = authoredModel.value.pages.flatMap((page) => page.blocks);
    const affected = authoredBlocks.find((block) => block.id === "recomendacion-puntaje");
    const untouched = authoredBlocks.filter((block) => block.id !== "recomendacion-puntaje");
    eq("el bloque redactado lleva su política", affected?.samplePolicy.mode, "hide_below");
    check(
      untouched.every((block) => block.samplePolicy.mode === "show_all"),
      "y ningún otro bloque cambia: una política de bloque no es una regla del software",
    );
  }
}

/* -------------------------------------------------------------------------- */

console.log("\n[18] El contenido editorial sigue requiriendo configuración");
const painBlock = blocks.find((block) => block.id === "temas-recorrido");
eq("la nube del recorrido", painBlock?.availability, "configuration_required");
check(
  painBlock?.payload.shape === "editorial" && painBlock.payload.body === null,
  "y llega sin contenido, porque nadie lo ha redactado",
);
check(
  painBlock?.payload.shape === "editorial" && painBlock.payload.absence?.state === "configuration_required",
  "declarando quién debe aportarlo, no un fallo",
);
check(
  results.configurationRequired.some((entry) => entry.key === "curated_journey_pain_cloud"),
  "el contrato canónico ya lo declaraba contenido editorial",
);
const withEditorial = structuredClone(document);
withEditorial.pages[0].blocks.find((block) => block.id === "temas-recorrido").content = {
  body: "Texto curado por revisión editorial.",
};
const editorialModel = resolvePresentation({ document: withEditorial, registry, results });
check(editorialModel.ok, "con contenido redactado, el bloque resuelve");
if (editorialModel.ok) {
  const filledBlock = editorialModel.value.pages
    .flatMap((page) => page.blocks)
    .find((block) => block.id === "temas-recorrido");
  eq("y pasa a estar disponible", filledBlock?.availability, "available");
}

/* -------------------------------------------------------------------------- */

console.log("\n[19] Serializar y resolver son deterministas");
const registryTwice = buildCanonicalPresentationRegistry(buildCanonicalStudyResults(baseSource()));
check(
  serializeDeterministic(projectPresentationCatalog(registryTwice)) === catalogText,
  "dos construcciones del registro producen el mismo catálogo, byte a byte",
);
const secondModel = resolvePresentation({ document, registry, results });
check(secondModel.ok && serializeDeterministic(secondModel.value) === modelText, "dos resoluciones producen los mismos bytes");
const reordered = { ...document, pages: document.pages.map((page) => ({ ...page, blocks: page.blocks.slice().reverse() })) };
const reorderedModel = resolvePresentation({ document: reordered, registry, results });
check(
  reorderedModel.ok && serializeDeterministic(reorderedModel.value) === modelText,
  "y el orden en que se guardaron los bloques no cambia el resultado",
);
const keyShuffled = JSON.parse(JSON.stringify(document));
check(
  serializeDeterministic(keyShuffled) === serializeDeterministic(document),
  "la serialización ordena las claves, así que dos copias iguales hashean igual",
);

console.log("\n[20] Duplicar un bloque no duplica lo que un filtro mueve");
const original = document.pages[0].blocks.find((block) => block.id === "recomendacion-puntaje");
const copy = duplicateBlock(original, "recomendacion-puntaje-copia");
check(original?.connectedFilterPanelIds.length > 0, "el bloque original sí está conectado a su panel");
eq("la copia llega sin conexiones", copy.connectedFilterPanelIds.length, 0);

/* -------------------------------------------------------------------------- */

console.log("\n[21] La capa no calcula, no transporta y no importa un calculador");
const PRESENTATION_DIR = join("src", "lib", "presentation");
const presentationFiles = [];
const walk = (dir) => {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) walk(path);
    else if (path.endsWith(".ts")) presentationFiles.push({ path, code: readFileSync(path, "utf8") });
  }
};
walk(PRESENTATION_DIR);
check(presentationFiles.length >= 9, `la capa tiene ${presentationFiles.length} módulos`);

const transports = presentationFiles.filter(({ code }) =>
  /@supabase|createClient\(|\.rpc\(|\bfetch\(|node:https?|node:net|XMLHttpRequest|server-only/.test(stripComments(code)),
);
check(transports.length === 0, `ningún módulo alcanza un transporte${transports.length ? `: ${transports.map((f) => f.path).join(", ")}` : ""}`);

const calculators = presentationFiles.filter(({ code }) =>
  /from\s+["'][^"']*\/calc\/|from\s+["']\.\.\/calc/.test(stripComments(code)),
);
check(
  calculators.length === 0,
  `ningún módulo importa la capa de cálculo${calculators.length ? `: ${calculators.map((f) => f.path).join(", ")}` : ""}`,
);

// Comments are stripped first: this layer DISCUSSES the legacy adapter at
// length — it is the thing it deliberately does not carry across — and a scan
// that could not tell an explanation from an import would forbid the
// explanation.
const legacyAdapters = presentationFiles.filter(({ code }) =>
  /experience\/adapter|adaptLegacyStudy|legacySampleState|LEGACY_SAMPLE_POLICY/.test(stripComments(code)),
);
check(
  legacyAdapters.length === 0,
  `ningún módulo importa el adaptador de resultados heredado${legacyAdapters.length ? `: ${legacyAdapters.map((f) => f.path).join(", ")}` : ""}`,
);

// THE ARITHMETIC SCAN IS A PROPERTY OF THE LAYER, NOT A LIST OF KNOWN DEFECTS.
//
// An earlier version looked for particular shapes — `Math.min(100, x)`,
// `value / base` — and an adversarial review showed how little that proved:
// `Math.min(x, 100)`, `x > 100 ? 100 : x`, `sum / count` and
// `(promoters - detractors) / respondents * 100` all walked straight past it. A
// scan that enumerates the defects it knows about passes for every defect it
// does not.
//
// The rule is therefore structural, and it is one this layer genuinely has: it
// performs no arithmetic on a study quantity because it performs almost none at
// all. String literals and regular expressions are removed along with comments,
// so an import path or a sentence cannot be mistaken for code.
const stripStrings = (code) =>
  code
    .replace(/"(?:[^"\\]|\\.)*"/g, '""')
    .replace(/`(?:[^`\\]|\\.)*`/g, "``")
    .replace(/'(?:[^'\\]|\\.)*'/g, "''")
    .replace(/\/(?:[^/\\\n[]|\\.|\[[^\]]*\])+\/[gimsuy]*/g, "RE");
const executable = presentationFiles.map(({ path, code }) => ({ path, code: stripStrings(stripComments(code)) }));

const withMath = executable.filter(({ code }) => /\bMath\./.test(code));
check(
  withMath.length === 0,
  `ningún módulo llama a Math en absoluto${withMath.length ? `: ${withMath.map((f) => f.path).join(", ")}` : ""}`,
);
const withRounding = executable.filter(({ code }) => /toFixed|toPrecision|parseFloat/.test(code));
check(
  withRounding.length === 0,
  `ningún módulo vuelve a redondear ni a re-formatear${withRounding.length ? `: ${withRounding.map((f) => f.path).join(", ")}` : ""}`,
);
const withDivision = executable.filter(({ code }) => /[^*/\n]\/[^*/=\n]/.test(code));
check(
  withDivision.length === 0,
  `ningún módulo divide${withDivision.length ? `: ${withDivision.map((f) => f.path).join(", ")}` : ""}`,
);
// Exactly one multiplication is allowed, and it is named: the 512 KiB byte
// ceiling migration 0023 declares. Anything else is a finding.
const multiplyingFiles = executable.filter(({ code }) => /[^*/\n]\*[^*/=\n]/.test(code));
check(
  multiplyingFiles.every(({ path }) => path.endsWith("serialize.ts")) && multiplyingFiles.length <= 1,
  `la única multiplicación de la capa es el techo de bytes${
    multiplyingFiles.length ? `; presente en ${multiplyingFiles.map((f) => f.path).join(", ")}` : ""
  }`,
);

/* -------------------------------------------------------------------------- */

console.log("\n[22] La capa no depende del repositorio del tablero aprobado");
const oracleReferences = presentationFiles.filter(({ code }) =>
  /becommunity-bni-cuicuilco-demo|snapshot\.json|\.\.\/\.\.\/\.\.\/\.\.\//.test(stripComments(code)),
);
check(
  oracleReferences.length === 0,
  `ningún módulo alcanza el repositorio del tablero${oracleReferences.length ? `: ${oracleReferences.map((f) => f.path).join(", ")}` : ""}`,
);
// The leading `\b` an earlier version used does not match before a minus sign,
// so a hardcoded −9.1 — the approved deserter score, and the one figure most
// likely to be pasted in as a "sanity default" — walked straight past it.
const hardcodedFigures = /(?<![\w.])-?(?:30\.8|46\.4|9\.1|133\.3|74\.1|57\.9|63\.6)(?![\w.])/;
const withFigures = presentationFiles.filter(({ code }) => hardcodedFigures.test(stripComments(code)));
check(
  withFigures.length === 0,
  `ningún módulo lleva una cifra del tablero aprobado${withFigures.length ? `: ${withFigures.map((f) => f.path).join(", ")}` : ""}`,
);

/* -------------------------------------------------------------------------- */

console.log("\n" + "=".repeat(74));
if (failures > 0) {
  console.error(`RESULTADO: ${failures} fallo(s). COMPUERTA BLOQUEADA.`);
  process.exit(1);
}
console.log(
  "RESULTADO: la capa de presentación enlaza por handles opacos, no calcula, no filtra sin que alguien " +
    "lo escriba, no recorta una razón que pasa de 100, muestra las muestras pequeñas por omisión y " +
    "rechaza en voz alta lo que no entiende. COMPUERTA APROBADA.",
);
