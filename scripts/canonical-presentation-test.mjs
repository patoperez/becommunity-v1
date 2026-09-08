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
// A gate imports the PURE IMPLEMENTATION modules, never `./server`: that file
// carries `import "server-only"`, which throws under a plain Node import by
// design. The boundary it draws is for production code, and section [23] proves
// the safe barrel does not leak past it.
import {
  COMPATIBLE_CHART_VARIANTS,
  PRESENTATION_SEMANTICS,
  SEMANTIC_UNITS,
} from "../src/lib/presentation/capabilities.ts";
import {
  DEFAULT_SAMPLE_POLICY,
  LEGACY_EXPERIENCE_SCHEMA_VERSIONS,
  PRESENTATION_DOCUMENT_KIND,
  PRESENTATION_DOCUMENT_SCHEMA_VERSION,
  duplicateBlock,
  validatePresentationDocument,
} from "../src/lib/presentation/document.ts";
import { serializeDeterministic } from "../src/lib/presentation/serialize.ts";
import {
  bindPresentationDocument,
  buildCanonicalPresentationRegistry,
  projectPresentationCatalog,
} from "../src/lib/presentation/registry.ts";
import { resolvePresentation } from "../src/lib/presentation/resolve.ts";
import {
  decodePresentationFromStorage,
  encodePresentationForStorage,
} from "../src/lib/presentation/persistence.ts";
import {
  APPROVED_FIRST_GROUP_PARTITION,
  APPROVED_ROUTE_IDS,
  buildApprovedCuicuilcoBlueprint,
} from "../src/lib/presentation/blueprints/cuicuilco-approved.ts";

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
  // An `if`, not a ternary used as a statement: the expression form is a value
  // nobody consumes, which is exactly what `no-unused-expressions` objects to,
  // and Unit 6A left the project's only new warning here.
  if (codes.includes(expectedCode)) {
    ok(`${label} → ${expectedCode}`);
  } else {
    bad(`${label}: se esperaba ${expectedCode}, se obtuvo ${codes.join(", ") || "(ninguno)"}`);
  }
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

/**
 * TWO NEEDLE CLASSES, because they are not equally safe to search for.
 *
 * SNAKE_CASE is unambiguous. Every canonical item, attribute, instrument,
 * domain, metric and band-scheme key is snake_case, and a slugified label can
 * never be — `slugifyLabel` turns every non-alphanumeric into a hyphen. So a
 * snake_case token appearing in client-reachable output came from a key and
 * nowhere else. Searched as a plain substring.
 *
 * KEBAB-CASE is ambiguous, and an earlier version of this scan got it wrong in
 * both directions. It first missed `journey_stage` hiding inside
 * `editorial:journey-stage-evidence`; then, converted wholesale, it flagged
 * `cultura-edl` and `retencion` — which are NOT leaks. «Cultura (EDL)» is the
 * group's own label, already shown to the client, and `retencion-serie` is an
 * authored block id in Spanish. A name that a client is already shown cannot
 * leak by being shown again.
 *
 * So the kebab form is searched only for CANONICAL TABLE NAMES, which are the
 * one class that is never display text and never a label anybody authors.
 */
const snakeNeedles = [...CANONICAL_KEYS, ...CANONICAL_TABLE_NAMES].filter((name) => name.includes("_"));
const kebabTableNeedles = CANONICAL_TABLE_NAMES.filter((name) => name.includes("_")).map((name) =>
  name.replace(/_/g, "-"),
);
const leaks = (haystack) => [
  ...snakeNeedles.filter((needle) => haystack.includes(needle)),
  ...kebabTableNeedles.filter((needle) => haystack.includes(needle)),
];

const handleText = registry.entries.map((entry) => entry.handle).join(" ");
const leakedKeys = leaks(handleText);
check(
  leakedKeys.length === 0,
  `ningún handle contiene una clave canónica ni un nombre de tabla, tampoco convertido a guiones${leakedKeys.length ? `: ${[...new Set(leakedKeys)].join(", ")}` : ""}`,
);
// The kebab-of-a-table check is the one that matters here, and it is the reason
// the editorial handle is built from a requirement's SECTION and KIND rather
// than from its contract key: `journey_stage_evidence` would have carried the
// table name `journey_stage` through slugification untouched.
check(
  !handleText.includes("journey-stage"),
  "y en particular ningún handle editorial arrastra el nombre de tabla `journey_stage`",
);
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
const catalogLeaks = leaks(catalogText);
check(catalogLeaks.length === 0, `el catálogo no filtra claves ni tablas${catalogLeaks.length ? `: ${[...new Set(catalogLeaks)].join(", ")}` : ""}`);
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
// THE BLUEPRINT IS A TEMPLATE, AND BINDING IT IS THE CALLER'S ACT.
// `buildApprovedCuicuilcoBlueprint` leaves `binding: null` on purpose: it
// describes a LAYOUT, and which registry that layout answers for is decided by
// whoever publishes it. The resolver refuses an unbound document outright
// (section [28]), so every test below works with the BOUND form — the same form
// a real caller would hold.
const template = validated.value;
const document = bindPresentationDocument(template, registry);
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
// The check must match the claim. An upper bound of 133.3 is satisfied by a
// value that was clamped DOWN to 100, which is the defect this line exists to
// catch; what proves the point is that the over-hundred TDP is still over a
// hundred, and that every route point equals its own canonical figure.
const canonicalTdpByHandle = new Map(
  results.journey.touchpoints.map((tp) => {
    const group = results.journey.groups.find((g) => g.key === tp.groupKey);
    const withinGroup = group ? group.touchpointKeys.indexOf(tp.key) + 1 : 0;
    const groupOrdinal = results.journey.groups.findIndex((g) => g.key === tp.groupKey) + 1;
    return [`journey-touchpoint:g${groupOrdinal}-t${withinGroup}`, tp.tdp];
  }),
);
const rescaled = routePoints.filter((point) => {
  const canonical = canonicalTdpByHandle.get(point.handle);
  if (!canonical || canonical.status !== "available") return false;
  return point.processUnawareness === null || point.processUnawareness.value !== canonical.value.value;
});
check(
  rescaled.length === 0,
  `ninguna TDP fue reescalada: las ${routePoints.length} del recorrido son las del contrato${rescaled.length ? `; difieren ${rescaled.length}` : ""}`,
);
check(
  routePoints.some((point) => (point.processUnawareness?.value ?? 0) > 100),
  "y al menos una sigue por encima de 100 después de resolver",
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
const modelLeaks = leaks(modelText);
check(modelLeaks.length === 0, `el modelo de render no filtra claves ni tablas${modelLeaks.length ? `: ${[...new Set(modelLeaks)].join(", ")}` : ""}`);
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

console.log("\n[9b] La prosa metodológica describe LA cifra, no la vecina");
// A touchpoint owns three results with three explanations, and a period owns
// two. Handing the satisfaction prose to a TDP figure, or the retention prose to
// an attrition one, captions the wrong quantity — and TDP is the number a reader
// is likeliest to misread, so it is the worst possible place to be approximate.
const proseDoc = structuredClone(document);
const proseSeeds = [
  { id: "prueba-tdp", binding: `value:touchpoint-tdp-g1-t${OVER_HUNDRED_POSITION}` },
  { id: "prueba-csat", binding: `value:touchpoint-satisfaction-g1-t${OVER_HUNDRED_POSITION}` },
  { id: "prueba-desercion", binding: "value:attrition-rate-p-1" },
  { id: "prueba-retencion", binding: "value:retention-rate-p-1" },
];
proseDoc.pages[0].blocks.push(
  ...proseSeeds.map((entry, index) => ({
    id: entry.id,
    kind: "result",
    binding: entry.binding,
    chartVariant: "kpi_value",
    displayFormat: { kind: "canonical" },
    copy: { title: null, description: null, annotation: null },
    placement: { order: 900 + index, span: { desktop: 3, tablet: 6, mobile: 12 }, responsive: "reflow" },
    visible: true,
    connectedFilterPanelIds: [],
    samplePolicy: null,
    methodologyDisclosure: "plain_language",
  })),
);
const proseValidated = validatePresentationDocument(JSON.parse(JSON.stringify(proseDoc)));
check(proseValidated.ok, "un documento que enlaza TDP, CSAT, retención y deserción por separado valida");
if (proseValidated.ok) {
  const proseModel = resolvePresentation({ document: proseValidated.value, registry, results });
  check(proseModel.ok, "y resuelve");
  if (proseModel.ok) {
    const proseById = new Map(proseModel.value.pages.flatMap((page) => page.blocks).map((b) => [b.id, b]));
    const canonicalTouchpoint = results.journey.touchpoints.find(
      (tp) => tp.key === itemKeyFor(0, OVER_HUNDRED_POSITION),
    );
    const period = results.retention.periods[0];
    eq(
      "la prosa de la TDP es la de la TDP",
      proseById.get("prueba-tdp")?.methodology.explanation,
      canonicalTouchpoint.tdp.provenance.explanation,
    );
    eq(
      "la de la satisfacción es la de la satisfacción",
      proseById.get("prueba-csat")?.methodology.explanation,
      canonicalTouchpoint.satisfaction.provenance.explanation,
    );
    check(
      canonicalTouchpoint.tdp.provenance.explanation !== canonicalTouchpoint.satisfaction.provenance.explanation,
      "y esas dos prosas son distintas, así que lo anterior no es una tautología",
    );
    eq(
      "la prosa de la deserción es la de la deserción",
      proseById.get("prueba-desercion")?.methodology.explanation,
      period.attrition.provenance.explanation,
    );
    eq(
      "la de la retención es la de la retención",
      proseById.get("prueba-retencion")?.methodology.explanation,
      period.retention.provenance.explanation,
    );
    check(
      period.attrition.provenance.explanation !== period.retention.provenance.explanation,
      "y también son distintas entre sí",
    );
  }
}

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
// Two different reasons, and the gate keeps them apart: the risk panel omits
// Esfera because an AUTHORITY forbids the cross, the journey panel because the
// approved dashboard's own journey panel omits it. One is a prohibition, the
// other a presentation choice.
const journeyPanel = document.pages[0].blocks.find((block) => block.id === "panel-recorrido");
check(
  !journeyPanel?.dimensions.includes("dimension:esfera"),
  "y el panel del recorrido tampoco la ofrece, por elección del tablero aprobado",
);
check(
  registry.entries.some((entry) => entry.handle === "dimension:esfera"),
  "y la dimensión existe de verdad, así que ambas omisiones omiten algo",
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
  blocks.every((block) => block.sampleDisplay.state === "shown"),
  "y ningún bloque llega oculto ni anotado",
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
  publicNote: null,
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
    eq("el bloque redactado sigue mostrando su cifra", affected?.sampleDisplay.state, "shown");
    check(
      untouched.every((block) => block.sampleDisplay.state === "shown"),
      "y ningún otro bloque cambia: una política de bloque no es una regla del software",
    );
  }
}

console.log("\n[17b] Una política de ocultamiento RETIENE de verdad, y se lleva las partes consigo");
// The earlier case authored a threshold of 4 over a base of 6, so the
// withholding branch never executed and nothing proved a value was ever hidden.
// This one authors a threshold ABOVE the base, at the DOCUMENT level, so the
// branch runs — and then checks the thing that actually matters: a withheld
// headline whose own composition is still published is not withheld at all,
// because a recommendation score is recoverable from its three shares.
const suppressing = structuredClone(document);
suppressing.samplePolicy = {
  mode: "hide_below",
  threshold: 10000,
  authoredBy: "Dirección del estudio",
  rationale: "Caso de prueba: ocultar todo lo que descanse en una base pequeña.",
  publicNote: null,
};
const suppressingValidated = validatePresentationDocument(JSON.parse(JSON.stringify(suppressing)));
check(suppressingValidated.ok, "una política de ocultamiento a nivel de documento valida");
if (suppressingValidated.ok) {
  const suppressed = resolvePresentation({ document: suppressingValidated.value, registry, results });
  check(suppressed.ok, "y resuelve");
  if (suppressed.ok) {
    const byId = new Map(suppressed.value.pages.flatMap((page) => page.blocks).map((block) => [block.id, block]));
    const score = byId.get("recomendacion-puntaje");
    check(
      score?.payload.shape === "value" && score.payload.value === null,
      "el puntaje de recomendación se retiene",
    );
    eq("y dice por qué", score?.payload.shape === "value" ? score.payload.absence?.state : null, "withheld_by_policy");
    const composition = byId.get("recomendacion-composicion");
    check(
      composition?.payload.shape === "categories" && composition.payload.categories.length === 0,
      "su composición se retiene con él: promotores, pasivos y detractores reconstruyen el puntaje por resta",
    );
    const riskDistribution = byId.get("riesgo-distribucion");
    check(
      riskDistribution?.payload.shape === "categories" && riskDistribution.payload.categories.length === 0,
      "la distribución de renovación también se retiene",
    );
    const terms = byId.get("temas-activos");
    check(
      terms?.payload.shape === "terms" && terms.payload.terms.length === 0,
      "y los términos curados, cuyos conteos son celdas pequeñas",
    );
    // A TOUCHPOINT'S THREE NUMBERS STAND OR FALL TOGETHER. CSAT and TDP rest on
    // the valid base; the auxiliary share rests on every classified response. A
    // threshold between the two would withhold the ratio and publish the share,
    // and the share over its own base gives back the unawareness count the
    // ratio was made of.
    const structuralDoc = structuredClone(suppressingValidated.value);
    structuralDoc.pages[0].blocks.push({
      id: "prueba-punto",
      kind: "result",
      binding: `journey-touchpoint:g1-t${OVER_HUNDRED_POSITION}`,
      chartVariant: "touchpoint_matrix",
      displayFormat: { kind: "canonical" },
      copy: { title: null, description: null, annotation: null },
      placement: { order: 980, span: { desktop: 6, tablet: 6, mobile: 12 }, responsive: "reflow" },
      visible: true,
      connectedFilterPanelIds: [],
      samplePolicy: null,
      methodologyDisclosure: null,
    });
    const structuralValidated = validatePresentationDocument(JSON.parse(JSON.stringify(structuralDoc)));
    check(structuralValidated.ok, "un bloque enlazado al punto de contacto entero valida");
    if (structuralValidated.ok) {
      const structuralModel = resolvePresentation({ document: structuralValidated.value, registry, results });
      check(structuralModel.ok, "y resuelve bajo la política de ocultamiento");
      if (structuralModel.ok) {
        const point = structuralModel.value.pages
          .flatMap((page) => page.blocks)
          .find((block) => block.id === "prueba-punto");
        check(
          point?.payload.shape === "touchpoint" &&
            point.payload.satisfaction === null &&
            point.payload.processUnawareness === null &&
            point.payload.unawarenessShare === null,
          "las tres cifras del punto se retienen juntas, no dos de tres",
        );
      }
    }

    const routesUnderPolicy = byId.get("recorrido-rutas");
    const anyPublished =
      routesUnderPolicy?.payload.shape === "routes" &&
      routesUnderPolicy.payload.routes.flatMap((route) => route.points).some((point) => point.satisfaction !== null);
    check(!anyPublished, "ningún punto del recorrido publica su satisfacción bajo esa política");
  }
}

console.log("\n[17c] `annotate_below` anota en el servidor, no manda un umbral al navegador");
const annotating = structuredClone(document);
annotating.samplePolicy = {
  mode: "annotate_below",
  threshold: 10000,
  note: "Base pequeña: lee esta cifra con cuidado.",
  authoredBy: "Dirección del estudio",
  rationale: "Acordado con el cliente.",
};
const annotatingValidated = validatePresentationDocument(JSON.parse(JSON.stringify(annotating)));
check(annotatingValidated.ok, "una política de anotación valida");
if (annotatingValidated.ok) {
  const annotated = resolvePresentation({ document: annotatingValidated.value, registry, results });
  check(annotated.ok, "y resuelve");
  if (annotated.ok) {
    const annotatedBlocks = annotated.value.pages.flatMap((page) => page.blocks);
    const scoreBlock = annotatedBlocks.find((block) => block.id === "recomendacion-puntaje");
    eq("el bloque afectado lleva la nota ya redactada", scoreBlock?.sampleDisplay.note, annotating.samplePolicy.note);
    eq("y su estado lo dice", scoreBlock?.sampleDisplay.state, "shown_with_note");
    check(
      scoreBlock?.payload.shape === "value" && scoreBlock.payload.value !== null,
      "y conserva su cifra: anotar no es ocultar",
    );
    check(
      annotatedBlocks.every((block) => block.sampleDisplay.state !== "withheld_by_policy"),
      "la nota es una frase terminada, nunca un umbral que el navegador tuviera que comparar",
    );
    // The authored policy DOES travel on the block, and that is deliberate: a
    // Studio surface has to show which policy applied. What must not travel is
    // a DECISION the browser would have to make. So the claim is not "the
    // threshold is absent" — it is that the threshold is never load-bearing:
    // the note is already written or already null, and the comparison that
    // decided which has already happened on the server.
    const underThreshold = annotatedBlocks.filter(
      (block) => block.methodology.base !== null && block.methodology.base.valid < 10000,
    );
    check(
      underThreshold.length > 0 && underThreshold.every((block) => block.sampleDisplay.state === "shown_with_note"),
      `cada bloque bajo el umbral llega ya anotado (${underThreshold.length})`,
    );
    check(
      annotatedBlocks
        .filter((block) => block.payload.shape === "value")
        .every((block) => block.payload.shape !== "value" || block.payload.value !== null),
      "y `annotate_below` no retiene ni una sola cifra",
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
  /@supabase|createClient\(|\.rpc\(|\bfetch\(|node:https?|node:net|XMLHttpRequest/.test(stripComments(code)),
);
check(transports.length === 0, `ningún módulo alcanza un transporte${transports.length ? `: ${transports.map((f) => f.path).join(", ")}` : ""}`);

// `server-only` is a BOUNDARY marker, not a transport, and exactly one module
// may carry it: the server barrel. Anywhere else it would either be redundant —
// the module is already unreachable through it — or a sign that a pure module a
// gate needs to import has quietly become unimportable.
const serverMarked = presentationFiles.filter(({ code }) => /["']server-only["']/.test(stripComments(code)));
check(
  serverMarked.length === 1 && serverMarked[0].path.endsWith("server.ts"),
  `exactamente un módulo lleva la marca server-only, y es el barril de servidor${
    serverMarked.length ? `: ${serverMarked.map((f) => f.path).join(", ")}` : " (ninguno la lleva)"
  }`,
);

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

/* -------------------------------------------------------------------------- */
/* UNIT 6A.1 — the boundary, the binding, and the exact oracle                 */
/* -------------------------------------------------------------------------- */

console.log("\n[23] Un documento autorable no lleva nada que sea de la base de datos");
const authorableText = serializeDeterministic(document);
const UUID_ANYWHERE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
check(!UUID_ANYWHERE.test(authorableText), "no contiene un solo UUID: ni de inquilino ni de estudio");
check(!authorableText.includes(IDENTITY.tenantId), "no nombra al inquilino");
check(!authorableText.includes(IDENTITY.studyId), "no nombra al estudio");
check(!authorableText.includes(IDENTITY.planFingerprint), "no lleva la huella del plan");
check(!authorableText.includes(IDENTITY.packageIdempotencyKey), "no lleva la clave del paquete");
for (const owned of ["publication", "definitionSha256", "studyFingerprint", "sourceDraftRevision", "acknowledgedWarnings", "preparedNote", "metadata"]) {
  check(!Object.prototype.hasOwnProperty.call(document, owned), `no autora «${owned}»: eso lo deriva la base de datos`);
}
check(!/"status":\s*"(?:draft|prepared|published)"/.test(authorableText), "no autora un estado de publicación");
check(typeof document.registryVersion === "string", "sí declara la versión de registro contra la que se redactó");
check(template.binding === null, "y el plano aprobado se EMITE sin enlazar: es una plantilla, no un documento de un estudio");
check(typeof document.binding === "string", "y enlazarlo es un acto aparte de quien lo publica, no algo que el plano traiga hecho");

console.log("\n[24] La persistencia estampa el alcance, y se niega a leer el de otro");
const SCOPE = { tenantId: IDENTITY.tenantId, studyId: IDENTITY.studyId };
refuses(
  "guardar un documento SIN enlazar",
  encodePresentationForStorage(template, SCOPE, { subtitle: null }),
  "persistence_unbound_document",
);
// Binding is the act that turns the template into a document about this study.
//
// SUPERSEDED. These lines used to continue: "and it is what the stale-binding
// refusal later tests. A row stored unbound would be permanently exempt from
// it." Unit 6A.2 made the resolver refuse `binding: null` outright as
// `unbound_presentation_document`, so an unbound row is exempt from nothing —
// it never resolves at all. Section [28] above is the assertion that proves it.
const storable = bindPresentationDocument(document, registry);
const encoded = encodePresentationForStorage(storable, SCOPE, { subtitle: null });
check(encoded.ok, "un documento enlazado sí se codifica para almacenamiento");
if (encoded.ok) {
  eq("la versión de columna es la del documento", encoded.value.schemaVersion, PRESENTATION_DOCUMENT_SCHEMA_VERSION);
  eq("el alcance estampado nombra al estudio", encoded.value.definition.metadata.studyId, SCOPE.studyId);
  eq("y al inquilino", encoded.value.definition.metadata.tenantId, SCOPE.tenantId);
  check(/^[0-9a-f]{64}$/.test(encoded.value.definitionSha256), "el hash se calcula FUERA de la definición que cubre");
  check(
    !JSON.stringify(encoded.value.definition).includes(encoded.value.definitionSha256),
    "y por eso no aparece dentro de ella: un hash de sí mismo no puede mantenerse cierto",
  );

  const decoded = decodePresentationFromStorage(encoded.value, SCOPE);
  check(decoded.ok, "la fila vuelve a leerse como documento autorable");
  if (decoded.ok) {
    check(
      !Object.prototype.hasOwnProperty.call(decoded.value, "metadata"),
      "y vuelve SIN la metadata de persistencia: se estampa al escribir y se retira al leer",
    );
    check(
      serializeDeterministic(decoded.value) === serializeDeterministic(storable),
      "el viaje de ida y vuelta es byte a byte el documento enlazado",
    );
  }

  refuses(
    "un alcance solicitado que no son dos UUID",
    decodePresentationFromStorage(encoded.value, { tenantId: undefined, studyId: undefined }),
    "persistence_scope_invalid",
  );
  refuses(
    "una fila cuyo digest no corresponde a sus bytes",
    decodePresentationFromStorage({ ...encoded.value, definitionSha256: "0".repeat(64) }, SCOPE),
    "persistence_hash_mismatch",
  );
  check(
    decodePresentationFromStorage(encoded.value, SCOPE).ok,
    "y el digest correcto se verifica sin quejarse",
  );
  refuses(
    "un subtítulo con caracteres de control",
    encodePresentationForStorage(storable, SCOPE, { subtitle: "malo\u0000subtitulo" }),
    "persistence_scope_invalid",
  );
  refuses(
    "un subtítulo más largo que su límite",
    encodePresentationForStorage(storable, SCOPE, { subtitle: "x".repeat(201) }),
    "persistence_scope_invalid",
  );
  const huge = structuredClone(storable);
  huge.pages[0].blocks.push(
    ...Array.from({ length: 150 }, (_, index) => ({
      ...structuredClone(document.pages[0].blocks.find((block) => block.id === "cierre")),
      id: `relleno-${index}`,
      content: { body: "x".repeat(3999) },
    })),
  );
  refuses(
    "una definición que rebasa el techo de bytes de la columna",
    encodePresentationForStorage(huge, SCOPE),
    "persistence_too_large",
  );

  const foreign = { tenantId: IDENTITY.tenantId, studyId: "00000000-0000-4000-8000-00000000ffff" };
  refuses("leer una fila de otro estudio", decodePresentationFromStorage(encoded.value, foreign), "persistence_scope_mismatch");
  // The TENANT half, separately: same study id, different tenant. Testing only
  // the study would leave the cross-tenant refusal unproven, and tenant
  // isolation is the one boundary this project treats as sacred.
  const foreignTenant = { tenantId: "00000000-0000-4000-8000-00000000eeee", studyId: IDENTITY.studyId };
  refuses(
    "leer una fila de otro inquilino",
    decodePresentationFromStorage(encoded.value, foreignTenant),
    "persistence_scope_mismatch",
  );
  refuses(
    "una fila cuya columna de versión discrepa del JSON",
    decodePresentationFromStorage({ ...encoded.value, schemaVersion: 3 }, SCOPE),
    "persistence_scope_invalid",
  );
  refuses(
    "un alcance que no son dos UUID",
    encodePresentationForStorage(storable, { tenantId: "no-es-uuid", studyId: SCOPE.studyId }),
    "persistence_scope_invalid",
  );
}

console.log("\n[25] El modelo público de render no lleva material de autoría");
const publicText = serializeDeterministic(model);
for (const internal of ["authoredBy", "rationale", "Dirección del estudio"]) {
  check(!publicText.includes(internal), `el modelo público no contiene «${internal}»`);
}
check(!/"samplePolicy"/.test(publicText), "ni la política de muestra completa");
check(!UUID_ANYWHERE.test(publicText), "ni un solo UUID");
check(!publicText.includes(IDENTITY.planFingerprint), "ni la huella del plan");
check(!publicText.includes(registry.binding), "ni la huella de enlace del registro");
check(
  blocks.every((block) => block.sampleDisplay && typeof block.sampleDisplay.state === "string"),
  "cada bloque publica su desenlace de muestra, ya decidido",
);

// The same suppressed document as section [17b], now checked for what it TELLS.
const suppressingPublic = structuredClone(document);
suppressingPublic.samplePolicy = {
  mode: "hide_below",
  threshold: 10000,
  authoredBy: "Dirección del estudio",
  rationale: "Motivo interno que un lector no debe leer.",
  publicNote: "No se publica por el tamaño de la base.",
};
const suppressingPublicValidated = validatePresentationDocument(JSON.parse(JSON.stringify(suppressingPublic)));
check(suppressingPublicValidated.ok, "una política con nota pública valida");
if (suppressingPublicValidated.ok) {
  const suppressedModel = resolvePresentation({ document: suppressingPublicValidated.value, registry, results });
  check(suppressedModel.ok, "y resuelve");
  if (suppressedModel.ok) {
    const text = serializeDeterministic(suppressedModel.value);
    check(!text.includes("Motivo interno"), "el motivo interno NO cruza al cliente");
    check(!text.includes("Dirección del estudio"), "el nombre de quien decidió tampoco");
    check(!text.includes("10000"), "ni el umbral");
    check(text.includes("No se publica por el tamaño de la base."), "sí cruza la nota pública que alguien redactó para un lector");
    const withheld = suppressedModel.value.pages
      .flatMap((page) => page.blocks)
      .filter((block) => block.sampleDisplay.state === "withheld_by_policy");
    check(withheld.length > 0, `${withheld.length} bloques se retienen`);
    // Recursively: no `withheld_by_policy` absence anywhere carries an audit field.
    const audits = [];
    const walk = (node) => {
      if (node === null || typeof node !== "object") return;
      if (Array.isArray(node)) return node.forEach(walk);
      if (node.state === "withheld_by_policy") {
        for (const key of Object.keys(node)) if (key !== "state" && key !== "note") audits.push(key);
      }
      for (const value of Object.values(node)) walk(value);
    };
    walk(suppressedModel.value);
    check(audits.length === 0, `ninguna ausencia retenida lleva campos de auditoría${audits.length ? `: ${[...new Set(audits)].join(", ")}` : ""}`);
  }
}

console.log("\n[26] El barril seguro no exporta una sola primitiva de enlace");
const safeBarrel = readFileSync(join("src", "lib", "presentation", "index.ts"), "utf8");
for (const forbidden of [
  "buildCanonicalPresentationRegistry",
  "resolvePresentation",
  "CanonicalAddress",
  "CanonicalPresentationRegistry",
  "RegistrySource",
  "encodePresentationForStorage",
  "decodePresentationFromStorage",
  "PresentationScope",
  "StoredPresentation",
  "buildApprovedCuicuilcoBlueprint",
  "projectPresentationCatalog",
  "bindPresentationDocument",
  "presentationBindingFingerprint",
]) {
  check(!new RegExp(`\\b${forbidden}\\b`).test(stripComments(safeBarrel)), `el barril seguro no exporta ${forbidden}`);
}
// A NAME GREP IS NOT ENOUGH. `export * from "./resolve"` re-exports every
// server primitive without naming one, and `from "./server"` would pull the
// whole server barrel. Both are refused by module PATH, which no aliasing can
// disguise, and `export *` is refused outright so the name list above can never
// be quietly bypassed.
check(
  !/from "\.\/(?:registry|resolve|persistence|server|blueprints)/.test(stripComments(safeBarrel)),
  "y no importa ni reexporta ninguno de los módulos de servidor, por ruta",
);
check(!/export\s*\*/.test(stripComments(safeBarrel)), "el barril seguro no usa `export *`, que reexportaría sin nombrar");
const serverBarrel = readFileSync(join("src", "lib", "presentation", "server.ts"), "utf8");
check(/^import "server-only";$/m.test(serverBarrel), "el barril de servidor abre con `import \"server-only\"`");
for (const required of ["buildCanonicalPresentationRegistry", "resolvePresentation", "encodePresentationForStorage"]) {
  check(new RegExp(`\\b${required}\\b`).test(serverBarrel), `y sí exporta ${required}`);
}

console.log("\n[27] El registro se ata a UN documento de resultados, no a una versión de contrato");
const otherStudy = baseSource();
otherStudy.identity = { ...IDENTITY, studyId: "00000000-0000-4000-8000-00000000dead" };
const otherStudyResults = buildCanonicalStudyResults(otherStudy);
eq("el otro estudio declara el mismo contrato", otherStudyResults.contractVersion, results.contractVersion);
refuses(
  "un registro del estudio A con los resultados del estudio B",
  resolvePresentation({ document, registry, results: otherStudyResults }),
  "registry_study_mismatch",
);

const otherPlan = baseSource();
otherPlan.identity = { ...IDENTITY, planFingerprint: "sha256:otro-plan" };
const otherPlanResults = buildCanonicalStudyResults(otherPlan);
refuses(
  "mismo estudio, otro plan proyectado",
  resolvePresentation({ document, registry, results: otherPlanResults }),
  "registry_plan_mismatch",
);

// THE COMPARISON UNIT 6A NEVER MADE. `calculationVersion` sat on `RegistrySource`
// and inside the binding fingerprint, and nothing checked it — so results computed
// under a DIFFERENT calculation version resolved cleanly against a registry built
// under this one, and every address dereferenced. The numbers would be the other
// version's. This fixture changes that field and NOTHING else: same contract, same
// tenant, same study, same spec, same mapping version, same package key, same plan
// fingerprint. If the resolver still accepts it, the check is not there.
const otherCalculationResults = buildCanonicalStudyResults(baseSource(), {
  spec: { ...SPEC, calculationVersion: "catalogo-2099-01-01" },
});
eq("el otro cálculo declara el mismo contrato", otherCalculationResults.contractVersion, results.contractVersion);
eq("el mismo inquilino", otherCalculationResults.study.tenantId, results.study.tenantId);
eq("el mismo estudio", otherCalculationResults.study.studyId, results.study.studyId);
eq("la misma especificación", otherCalculationResults.study.specId, results.study.specId);
eq("la misma versión de mapeo", otherCalculationResults.study.mappingVersion, results.study.mappingVersion);
eq("el mismo paquete", otherCalculationResults.study.packageIdempotencyKey, results.study.packageIdempotencyKey);
eq("la misma huella de plan", otherCalculationResults.study.planFingerprint, results.study.planFingerprint);
check(
  otherCalculationResults.study.calculationVersion !== results.study.calculationVersion,
  `y SÓLO cambia la versión de cálculo (${results.study.calculationVersion} → ${otherCalculationResults.study.calculationVersion})`,
);
const calculationRefusal = resolvePresentation({ document, registry, results: otherCalculationResults });
refuses("mismo estudio y mismo plan, otra versión de cálculo", calculationRefusal, "registry_plan_mismatch");
// And the refusal must SAY so. A message that lists four causes for a fifth one
// sends a reader looking at the wrong fields.
check(
  !calculationRefusal.ok &&
    calculationRefusal.errors.some((entry) => /versi[oó]n de c[aá]lculo/i.test(entry.detail)),
  "y la explicación nombra la versión de cálculo, no sólo el plan",
);

refuses(
  "un documento redactado contra otra versión del registro",
  resolvePresentation({ document: { ...document, registryVersion: "0.9.0" }, registry, results }),
  "registry_version_mismatch",
);

console.log("\n[28] Un enlace guardado se niega antes que apuntar a otro resultado");
// FIRST, THE HALF UNIT 6A LEFT OPEN. The fingerprint refusal below only compares
// a binding that EXISTS, so an unbound document was not merely unchecked — it
// was exempt, and exempt in a way nothing showed: it resolved, every address
// dereferenced, and the render model looked like any other. The blueprint is
// emitted unbound, so this is not a contrived fixture; it is what
// `buildApprovedCuicuilcoBlueprint` actually returns.
eq("el plano se emite SIN enlace", template.binding, null);
const unboundOutcome = resolvePresentation({ document: template, registry, results });
refuses("una plantilla sin enlazar no resuelve", unboundOutcome, "unbound_presentation_document");
check(
  !unboundOutcome.ok &&
    unboundOutcome.errors.length === 1 &&
    unboundOutcome.errors[0].path === "$.binding",
  "y la negativa es UNA, y señala $.binding, para que un editor sepa qué le falta al documento",
);
// NO AUTO-BINDING, AND NO FALLBACK. A refusal that quietly ends in a resolution
// would make the fingerprint agree by construction and prove nothing at all.
check(!unboundOutcome.ok && !("value" in unboundOutcome), "la negativa no trae un modelo de repuesto");
check(template.binding === null, "y la plantilla sigue sin enlazar: el resolutor no la modificó");
// The positive half: the SAME template, bound, resolves.
const boundTemplate = bindPresentationDocument(template, registry);
check(
  resolvePresentation({ document: boundTemplate, registry, results }).ok,
  "la misma plantilla, enlazada, sí resuelve",
);

const bound = bindPresentationDocument(document, registry);
eq("enlazar estampa la huella del registro", bound.binding, registry.binding);
check(/^[0-9a-f]{64}$/.test(bound.binding), "que es un digest de 64 hex y no una identidad legible");
check(!bound.binding.includes(IDENTITY.studyId), "y no contiene el estudio del que se derivó");
const boundOk = resolvePresentation({ document: bound, registry, results });
check(boundOk.ok, "un documento enlazado resuelve contra su propio registro");

/**
 * The four mutations that could silently retarget a saved handle. Each rebuilds
 * the registry from a changed study and re-resolves the SAME bound document.
 */
const drifts = [
  [
    "renombrar la etiqueta de una dimensión",
    () => {
      const drifted = baseSource();
      drifted.attributeDefinitions = drifted.attributeDefinitions.map((definition) =>
        definition.key === "perfil_cliente_h" ? { ...definition, label: "Esfera BNI" } : definition,
      );
      return drifted;
    },
  ],
  [
    "reordenar los grupos del recorrido",
    () => {
      const drifted = baseSource();
      drifted.domains = [drifted.domains[1], drifted.domains[0], ...drifted.domains.slice(2)].map(
        (domain, index) => ({ ...domain, displayOrder: index }),
      );
      return drifted;
    },
  ],
  [
    "insertar una dimensión antes",
    () => {
      const drifted = baseSource();
      drifted.attributeDefinitions = [
        { key: "perfil_cliente_b", label: "Antigüedad", dataType: "category", sensitivity: "internal", filterable: true, displayOrder: -1 },
        ...drifted.attributeDefinitions,
      ];
      drifted.attributeValues = [
        ...ACTIVE.map((id) => ({ participantId: id, attributeKey: "perfil_cliente_b", status: "answered", text: "A", numeric: null })),
        ...drifted.attributeValues,
      ];
      return drifted;
    },
  ],
  [
    "insertar un punto de contacto antes",
    () => {
      const drifted = baseSource();
      const inserted = {
        key: "csat_g0p0",
        label: "En una escala del 1 al 5, ¿un punto nuevo insertado al principio?",
        instrumentKey: "csat",
        domainKey: GROUPS[0].key,
        scaleKey: "satisfaccion_csat",
        itemOrder: -1,
      };
      drifted.items = [inserted, ...drifted.items];
      drifted.answers = [
        ...ACTIVE.map((id) => ({
          sessionId: `s-csat-${id}`,
          itemKey: "csat_g0p0",
          status: "answered",
          numeric: 5,
          text: null,
          optionRawValue: "5",
          derivedLabel: "Satisfecho",
        })),
        ...drifted.answers,
      ];
      return drifted;
    },
  ],
];

for (const [label, mutate] of drifts) {
  const driftedResults = buildCanonicalStudyResults(mutate());
  const driftedRegistry = buildCanonicalPresentationRegistry(driftedResults);
  check(driftedRegistry.binding !== registry.binding, `${label} cambia la huella de enlace`);
  refuses(
    `${label}: un documento enlazado se niega`,
    resolvePresentation({ document: bound, registry: driftedRegistry, results: driftedResults }),
    "binding_fingerprint_mismatch",
  );
}

console.log("\n[29] El formato de presentación rellena; nunca redondea");
const criBlock = document.pages[0].blocks.find((block) => block.id === "riesgo-indice");
eq("el plano pide un decimal fijo para el índice de renovación", criBlock.displayFormat.kind, "fixed_decimals");
eq("exactamente uno", criBlock.displayFormat.decimals, 1);
const criRendered = blocks.find((block) => block.id === "riesgo-indice");
const criCanonical = results.renewal.index;
check(
  criCanonical.status === "available" && criRendered?.payload.shape === "value" && criRendered.payload.value !== null,
  "el índice de renovación llega con cifra, así que lo que sigue no se salta en silencio",
);
if (criCanonical.status === "available" && criRendered.payload.shape === "value" && criRendered.payload.value) {
  eq("el valor numérico no cambia", criRendered.payload.value.value, criCanonical.value.value);
  check(
    Number(criRendered.payload.value.formatted) === criCanonical.value.value,
    "y el texto rellenado sigue leyéndose como esa misma cifra",
  );
  check(
    criRendered.payload.value.formatted.length >= criCanonical.value.formatted.length,
    "el relleno sólo alarga: nunca acorta, que es lo que sería redondear",
  );
}
// THE PADDING PATH ITSELF, proved offline. The synthetic renewal index happens
// to carry a decimal already, so it cannot show that `\"33\"` becomes `\"33.0\"`.
// Retention in period one is a whole 80%, whose canonical text is `\"80\"` — the
// exact shape the approved CRI has — so binding it with one fixed decimal
// exercises the append that the real oracle depends on.
const paddingDoc = structuredClone(document);
paddingDoc.pages[0].blocks.push({
  id: "prueba-relleno",
  kind: "result",
  binding: "value:retention-rate-p-1",
  chartVariant: "kpi_value",
  displayFormat: { kind: "fixed_decimals", decimals: 1 },
  copy: { title: null, description: null, annotation: null },
  placement: { order: 950, span: { desktop: 3, tablet: 6, mobile: 12 }, responsive: "reflow" },
  visible: true,
  connectedFilterPanelIds: [],
  samplePolicy: null,
  methodologyDisclosure: null,
});
const paddingValidated = validatePresentationDocument(JSON.parse(JSON.stringify(paddingDoc)));
check(paddingValidated.ok, "un bloque que pide un decimal fijo sobre una cifra entera valida");
if (paddingValidated.ok) {
  const canonicalRetention = results.retention.periods[0].retention;
  const paddedModel = resolvePresentation({ document: paddingValidated.value, registry, results });
  check(paddedModel.ok, "y resuelve");
  // ASSERTED, not assumed. Both of these guarded the three assertions below, so
  // a fixture whose first retention period stopped being available would have
  // skipped the padding proof in silence and the gate would still have passed.
  check(canonicalRetention.status === "available", "el primer periodo de retención tiene una cifra que rellenar");
  if (paddedModel.ok && canonicalRetention.status === "available") {
    const padded = paddedModel.value.pages.flatMap((page) => page.blocks).find((b) => b.id === "prueba-relleno");
    check(!canonicalRetention.value.formatted.includes("."), `el contrato la escribe entera («${canonicalRetention.value.formatted}»)`);
    eq("y la presentación la rellena", padded?.payload.value?.formatted, `${canonicalRetention.value.formatted}.0`);
    eq("sin mover la cifra", padded?.payload.value?.value, canonicalRetention.value.value);
  }
}
const others = blocks.filter((block) => block.id !== "riesgo-indice" && block.payload.shape === "value");
check(
  others.length > 0,
  `y ${others.length} bloques más conservan el formato canónico: el decimal fijo es una elección de bloque, no una regla global`,
);
const shortening = structuredClone(document);
shortening.pages[0].blocks.find((block) => block.id === "recomendacion-puntaje").displayFormat = {
  kind: "fixed_decimals",
  decimals: 0,
};
refuses(
  "pedir menos decimales de los que la cifra ya escribe",
  resolvePresentation({ document: shortening, registry, results }),
  "incompatible_display_format",
);
const overPrecise = structuredClone(document);
overPrecise.pages[0].blocks.find((block) => block.id === "riesgo-indice").displayFormat = {
  kind: "fixed_decimals",
  decimals: 2,
};
refuses(
  "pedir más precisión de la que la medición declara",
  resolvePresentation({ document: overPrecise, registry, results }),
  "incompatible_display_format",
);

console.log("\n[30] Ningún cliente, ruta, acción o middleware alcanza la mitad de servidor");
// A REAL WALK, not a grep. Nothing imports this layer yet, so today the answer
// is trivially "none" — which is exactly when a boundary check is worth writing,
// because the first import that crosses it will be written by somebody who does
// not know the rule. The walk is rooted at every client component, HTTP route,
// server action, page and the middleware, and follows relative and `@/` imports
// transitively.
const SERVER_ONLY_MODULES = [
  "src/lib/presentation/registry.ts",
  "src/lib/presentation/resolve.ts",
  "src/lib/presentation/persistence.ts",
  "src/lib/presentation/server.ts",
  "src/lib/presentation/blueprints/cuicuilco-approved.ts",
  // Unit 6B.1's starting layout for a study no registered blueprint fits. It
  // takes a REGISTRY, and a registry carries the address map and the database
  // scope, so it belongs on this side of the line with the approved one.
  "src/lib/presentation/blueprints/generic-starting.ts",
];

/**
 * THE ONE AUTHENTICATED STUDIO DOOR — Unit 6B.1.
 *
 * This walk had no allowlist at all: a client component, an HTTP route, a
 * server action and a PAGE were all refused every module above. The composer
 * page and its explicit preview action have to reach the resolver, because
 * resolving needs the registry's address map and an address may not cross to a
 * browser — so the resolution happens on the server or it happens in the wrong
 * place.
 *
 * Exactly two entry points are exempted, both named, and each is required to
 * reach the server half THROUGH its declared loader rather than by importing
 * the resolver itself. The client and route rows below are NOT relaxed: a
 * `"use client"` module and a `route.ts` still reach none of these modules by
 * any path, which is what keeps an address off the browser.
 */
const APPROVED_PRESENTATION_DOORS = [
  {
    entry: "src/app/studio/e/[studyId]/construccion/page.tsx",
    loader: "src/lib/studio/presentation-workspace.ts",
  },
  {
    entry: "src/app/studio/e/[studyId]/construccion/actions.ts",
    loader: "src/lib/studio/presentation-workspace.ts",
  },
];
const appSourceFiles = [];
const collectAppSources = (dir) => {
  let entries = [];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) collectAppSources(full);
    else if (/\.(?:ts|tsx)$/.test(full)) appSourceFiles.push(full);
  }
};
collectAppSources(join("src", "app"));
collectAppSources(join("src", "components"));
for (const extra of [join("src", "middleware.ts"), join("src", "middleware.tsx")]) {
  try {
    if (statSync(extra).isFile()) appSourceFiles.push(extra);
  } catch {
    /* absent */
  }
}
const normalisePath = (path) => path.split("\\").join("/");
const resolveSpecifier = (from, specifier) => {
  const base = specifier.startsWith("@/") ? join("src", specifier.slice(2)) : join(from, "..", specifier);
  const candidates = [base, `${base}.ts`, `${base}.tsx`, join(base, "index.ts"), join(base, "index.tsx")];
  for (const candidate of candidates) {
    try {
      if (statSync(candidate).isFile()) return candidate;
    } catch {
      /* not this one */
    }
  }
  return null;
};
// `from "…"` alone misses two real edges: a DYNAMIC `import("…")`, which is
// exactly how somebody would reach server code from a client component without
// a static import to notice, and a bare side-effect `import "…"`. Both are
// matched now.
const IMPORT_SPECIFIER = /(?:from\s+|import\s*\(\s*|import\s+)["'](\.[^"']+|@\/[^"']+)["']/g;
const reachableFrom = (root) => {
  const seen = new Set();
  const stack = [root];
  while (stack.length > 0) {
    const current = stack.pop();
    if (seen.has(current)) continue;
    seen.add(current);
    let code = "";
    try {
      code = readFileSync(current, "utf8");
    } catch {
      continue;
    }
    for (const match of stripComments(code).matchAll(IMPORT_SPECIFIER)) {
      const next = resolveSpecifier(current, match[1]);
      if (next !== null) stack.push(next);
    }
  }
  return [...seen].map(normalisePath);
};
const hasDirective = (path, directive) => {
  try {
    return new RegExp(`^\\s*["']${directive}["']`, "m").test(readFileSync(path, "utf8"));
  } catch {
    return false;
  }
};
const clientRoots = appSourceFiles.filter((path) => hasDirective(path, "use client"));
const actionRoots = appSourceFiles.filter((path) => hasDirective(path, "use server"));
const routeRoots = appSourceFiles.filter((path) => /route\.tsx?$/.test(path));
const pageRoots = appSourceFiles.filter((path) => /page\.tsx$/.test(path));
check(appSourceFiles.length > 50, `la caminata parte de ${appSourceFiles.length} módulos de aplicación`);
check(clientRoots.length >= 10, `incluidos ${clientRoots.length} componentes de cliente, así que no pasa por vacío`);
check(routeRoots.length >= 2 && pageRoots.length >= 5, `${routeRoots.length} rutas y ${pageRoots.length} páginas`);

const doorFor = (root) =>
  APPROVED_PRESENTATION_DOORS.find((door) => door.entry === normalisePath(root)) ?? null;

for (const [label, roots, exemptible] of [
  ["un componente de cliente", clientRoots, false],
  ["una ruta HTTP", routeRoots, false],
  ["una acción de servidor", actionRoots, true],
  ["una página", pageRoots, true],
]) {
  const leaks = [];
  for (const root of roots) {
    const door = exemptible ? doorFor(root) : null;
    if (door) continue;
    const reachable = reachableFrom(root);
    for (const forbidden of SERVER_ONLY_MODULES) {
      if (reachable.includes(forbidden)) leaks.push(`${normalisePath(root)} -> ${forbidden}`);
    }
  }
  check(
    leaks.length === 0,
    `ningún(a) ${label} alcanza la mitad de servidor de la presentación${
      exemptible ? ", salvo la puerta aprobada" : ""
    }${leaks.length ? `: ${leaks.join(", ")}` : ""}`,
  );
}

// THE EXEMPTION IS NOT A HOLE UNLESS IT IS UNCHECKED.
//
// Each approved door must actually exist, must actually reach the server half —
// an exemption for something that stopped needing one is an exemption nobody
// would notice going stale — and must arrive there through its DECLARED loader
// rather than by importing `resolve.ts` directly. And nothing outside the table
// may be exempt, which is asserted by the rows above rather than assumed here.
for (const door of APPROVED_PRESENTATION_DOORS) {
  const root = [...actionRoots, ...pageRoots].find((candidate) => normalisePath(candidate) === door.entry);
  if (!root) {
    bad(`la puerta aprobada ${door.entry} no existe como página ni como acción`);
    continue;
  }
  const reachable = reachableFrom(root);
  const reaches = SERVER_ONLY_MODULES.some((module) => reachable.includes(module));
  check(reaches, `la puerta aprobada ${door.entry} sí alcanza la mitad de servidor, así que su excepción no sobra`);
  check(
    reachable.includes(door.loader),
    `y lo hace a través de su cargador declarado, ${door.loader}`,
  );
}
// THE CONTRACT'S VOCABULARY IS NOT THE CANONICAL RESULTS MODEL — Unit 6B.1.
//
// This check used to refuse `src/lib/results/` ENTIRELY to a client component,
// and it stayed true for as long as no client component had a reason to name a
// render model's type. Unit 6B.1 builds one: a render-only React library whose
// whole safety argument is that it receives a `PresentationRenderModel` and
// nothing else — and a component that receives one has to be able to say so.
//
// `PresentationRenderModel` is reached through the client-safe barrel, and that
// barrel arrives at `src/lib/results/contract.ts`, because `RenderValue.unit`
// IS a `ResultUnit` and `RenderBand.semanticColor` IS a `SemanticColor`. The
// alternative was to re-declare those unions inside the presentation layer and
// have a gate compare the two texts. That trades a real dependency for a
// duplicated one plus a gate that goes red when somebody reorders a union.
//
// So the rule is narrowed to what it was actually protecting. `contract.ts`
// imports NOTHING — it is a leaf — and exports one version string and two empty
// -record factories beside 44 type declarations. There is no formula in it, no
// metric, no spec, no transport, and nothing a browser could compute a business
// result with. Everything that COULD — `build.ts`, `spec.ts`, `metrics.ts`, the
// barrel, and every other module under `src/lib/results/` — stays as forbidden
// as it was, and `src/lib/calc/` was never reachable and still is not.
//
// Two assertions replace the one, and together they are stricter than it was:
// the vocabulary is the ONLY module of that layer a client may reach, and it
// may only be reached BY TYPE, so nothing of it survives into a bundle.
const RESULTS_VOCABULARY = "src/lib/results/contract.ts";
const clientReachingResults = clientRoots.filter((root) =>
  reachableFrom(root).some((path) => path.startsWith("src/lib/results/") && path !== RESULTS_VOCABULARY),
);
check(
  clientReachingResults.length === 0,
  `ningún componente de cliente alcanza el modelo canónico de resultados más allá de su vocabulario${
    clientReachingResults.length ? `: ${clientReachingResults.map(normalisePath).join(", ")}` : ""
  }`,
);
// The calculation layer is NOT asserted unreachable from every client here, and
// that absence is deliberate rather than an oversight: twelve pre-existing
// dashboard and upload components legitimately import `@/lib/calc/journey` and
// `@/lib/calc/table` for their journey-stage and column types, and a rule this
// gate has never enforced is not one Unit 6B.1 gets to introduce in passing on
// somebody else's code. What 6B.1 owns, it does assert: the render-only library
// reaches neither the calculation layer nor the results layer beyond the
// vocabulary, in `scripts/canonical-composer-test.mjs` section [20].
const presentationClientRoots = clientRoots.filter((root) =>
  normalisePath(root).startsWith("src/components/presentation/"),
);
check(presentationClientRoots.length > 0, `la biblioteca de dibujo aporta ${presentationClientRoots.length} raíz(ces) de cliente`);
const libraryReachingCalc = presentationClientRoots.filter((root) =>
  reachableFrom(root).some((path) => path.startsWith("src/lib/calc/")),
);
check(
  libraryReachingCalc.length === 0,
  `ninguna de ellas alcanza la capa de cálculo${
    libraryReachingCalc.length ? `: ${libraryReachingCalc.map(normalisePath).join(", ")}` : ""
  }`,
);

const clientReachable = new Set();
for (const root of clientRoots) for (const path of reachableFrom(root)) clientReachable.add(path);
check(clientReachable.has(RESULTS_VOCABULARY), "y el vocabulario sí se alcanza, así que la regla de abajo no pasa por vacío");
// `import type` is ERASED by TypeScript. `import { … }` is not, even when every
// name in it happens to be a type today, because tomorrow one of them is a
// function. The form is what is asserted, not the intent.
const VALUE_IMPORT_OF_CONTRACT = /(?:^|\n)\s*import\s+(?!type\b)([\s\S]{0,200}?)\s+from\s+["'][^"']*results\/contract["']/g;
const valueImports = [];
for (const path of clientReachable) {
  let code = "";
  try {
    code = stripComments(readFileSync(path, "utf8"));
  } catch {
    continue;
  }
  for (const match of code.matchAll(VALUE_IMPORT_OF_CONTRACT)) {
    valueImports.push(`${path} -> import ${match[1].replace(/\s+/g, " ").slice(0, 60)}`);
  }
}
check(
  valueImports.length === 0,
  `todo módulo alcanzable desde un cliente importa el vocabulario SÓLO como tipo${
    valueImports.length ? `: ${valueImports.join(", ")}` : ""
  }`,
);




/* -------------------------------------------------------------------------- */

console.log("\n[33] Cada bloque visible del plano aprobado DIBUJA algo");
/*
 * THE GATE THAT WOULD HAVE CAUGHT THE RETENTION BLOCK.
 *
 * The approved blueprint bound `retention_series` to `bar_vertical`. Every
 * existing check passed: the variant is compatible, so the resolver accepted it;
 * the payload is full, so the client-visibility rule let the block through; and
 * a component for `bar_vertical` exists, so no internal placeholder fired. The
 * only thing that failed was the part nobody was asserting — `BarVertical` reads
 * category rows, a series has none, and it returned `null`. The client got a
 * heading, a paragraph promising retention and desertion for each period, a
 * methodology caption, and a blank.
 *
 * So this renders each block of the approved document ON ITS OWN and asserts
 * that a block a reader is meant to SEE DATA IN produced some. Alone, because a
 * whole-page render cannot tell which card the markup came from — the failure
 * being caught here is precisely one block among twenty drawing nothing while
 * the others draw normally.
 *
 * WHAT "SOMETHING" MEANS. Not "the markup is non-empty": the card's own chrome
 * would satisfy that, which is the trap. It means the LEAF produced content, so
 * each block is rendered twice — once whole, once with its copy stripped — and
 * the second render is what must be non-empty.
 *
 * WHAT IS EXEMPT, AND WHY IT IS NAMED RATHER THAN SKIPPED. A block whose payload
 * legitimately carries nothing yet — the editorial slots the contract classifies
 * as pending review — must render NOTHING on a client, and C11 is the reason.
 * Those are listed by handle, so a data block cannot join them by accident.
 */
{
  const { renderToStaticMarkup } = await import("react-dom/server");
  const { createElement } = await import("react");
  const { PresentationRenderer } = await import("../src/components/presentation/PresentationRenderer.tsx");

  const model = resolved.value;
  const textOf = (markup) => markup.replace(/<[^>]*>/g, "").replace(/&[a-z]+;/g, " ").trim();

  const drawOne = (block, audience) =>
    renderToStaticMarkup(
      createElement(PresentationRenderer, {
        model: {
          ...model,
          pages: [
            {
              id: "solo",
              title: "",
              order: 0,
              // Copy stripped: what survives is what the LEAF drew. A title and a
              // description are exactly what the broken block still produced.
              blocks: [{ ...block, copy: { title: null, description: null, annotation: null } }],
            },
          ],
        },
        audience,
      }),
    );

  const allBlocks = model.pages.flatMap((page) => page.blocks);
  check(allBlocks.length >= 15, `el plano aprobado resuelve ${allBlocks.length} bloques`);

  /*
   * WHAT IS EXEMPT FROM "MUST DRAW SOMETHING", AND WHY EACH ONE IS.
   *
   * An editorial slot the contract classifies as pending review carries a null
   * body and must render NOTHING on a client — that is C11, not a drawing
   * failure. An editorial block somebody DID write is not exempt: authored prose
   * is content and has to appear. And a filter panel has no viewer behaviour in
   * this unit at all, so it is internal-only by construction.
   *
   * A first version of this list exempted every editorial block, which would
   * have let an authored paragraph silently stop rendering.
   */
  const isPendingSlot = (block) =>
    (block.payload.shape === "editorial" && block.payload.body === null) ||
    block.availability === "configuration_required";
  const isInternalOnly = (block) => block.payload.shape === "filter_controls";
  const EMPTY_ON_PURPOSE = new Set(
    allBlocks.filter((block) => isPendingSlot(block) || isInternalOnly(block)).map((block) => block.id),
  );

  const blank = [];
  for (const block of allBlocks) {
    if (EMPTY_ON_PURPOSE.has(block.id)) continue;
    const drawn = textOf(drawOne(block, "internal"));
    if (drawn.length === 0) blank.push(`${block.id} (${block.chartVariant ?? "sin forma"} sobre ${block.payload.shape})`);
  }
  check(
    blank.length === 0,
    `ningún bloque de datos del plano aprobado dibuja un vacío${blank.length ? `: ${blank.join("; ")}` : ` (${allBlocks.length - EMPTY_ON_PURPOSE.size} comprobados)`}`,
  );

  // And the retention block specifically, by name and by content, because it is
  // the one that was broken and a general rule can drift.
  const retention = allBlocks.find((block) => block.payload.shape === "series");
  check(Boolean(retention), "el plano aprobado publica una serie de periodos");
  if (retention) {
    eq("la serie se dibuja con la forma de tarjetas por periodo", retention.chartVariant, "period_cards");
    const drawn = textOf(drawOne(retention, "internal"));
    const periods = retention.payload.points;
    // This fixture is SYNTHETIC and carries as many periods as it was written
    // with. That the REAL study has six is a fact about Cuicuilco, and
    // `canonical-presentation-parity` is where a real-workbook fact belongs.
    check(periods.length >= 2, `la serie trae ${periods.length} periodos y cada uno se comprueba`);
    const missing = periods.filter((point) => !drawn.includes(point.label));
    check(missing.length === 0, `los ${periods.length} periodos aparecen dibujados${missing.length ? `; faltan ${missing.map((p) => p.label).join(", ")}` : ""}`);
    // Both measures of every period, by their already-formatted text.
    const figures = periods.flatMap((point) => point.measures.map((measure) => measure.value?.formatted).filter(Boolean));
    const absent = figures.filter((formatted) => !drawn.includes(formatted));
    check(
      absent.length === 0 && figures.length >= periods.length * 2,
      `las ${figures.length} cifras de retención y deserción se dibujan tal como llegaron${absent.length ? `; faltan ${absent.slice(0, 4).join(", ")}` : ""}`,
    );
    const labels = new Set(periods.flatMap((point) => point.measures.map((measure) => measure.label)));
    check(
      [...labels].every((label) => drawn.includes(label)),
      `cada medición se dibuja bajo su propio nombre: ${[...labels].join(", ")}`,
    );
  }

  /*
   * A CLIENT IS NEVER LEFT A CARD WITH NOTHING IN IT.
   *
   * The test is the absence of a `<section>`, not the absence of markup.
   * `PresentationRenderer` always emits its own wrapping `<div>`, so "the string
   * is non-empty" is true even when every page and every card was correctly
   * dropped — a first version of this check measured that wrapper and reported
   * three panels that in fact render nothing at all. A card is a `<section>`,
   * and a page is a `<section>`; if neither is in the markup, the reader was
   * shown nothing, which is what C11 asks for.
   */
  const hasCard = (markup) => markup.includes("<section");
  const clientBlank = [];
  for (const block of allBlocks) {
    const markup = drawOne(block, "client");
    if (textOf(markup).length === 0 && hasCard(markup)) clientBlank.push(block.id);
  }
  check(clientBlank.length === 0, `ningún bloque deja al cliente una tarjeta vacía${clientBlank.length ? `: ${clientBlank.join(", ")}` : ` (${allBlocks.length} comprobados)`}`);

  // The pending slots and the internal-only panels, conversely, must leave a
  // client no card at all — not an empty one, and not a heading over it.
  const leaked = [...EMPTY_ON_PURPOSE].filter((id) => {
    const block = allBlocks.find((candidate) => candidate.id === id);
    return block ? hasCard(drawOne(block, "client")) : false;
  });
  check(
    leaked.length === 0,
    `los ${EMPTY_ON_PURPOSE.size} bloques sin contenido para el cliente no le dejan ni una tarjeta${leaked.length ? `: ${leaked.join(", ")}` : ""}`,
  );

  // And in Studio the same blocks DO say something, because an internal reviewer
  // is the person who has to know what is still missing.
  const silentInStudio = [...EMPTY_ON_PURPOSE].filter((id) => {
    const block = allBlocks.find((candidate) => candidate.id === id);
    return block ? textOf(drawOne(block, "internal")).length === 0 : false;
  });
  check(
    silentInStudio.length === 0,
    `y en Studio los ${EMPTY_ON_PURPOSE.size} sí se nombran${silentInStudio.length ? `; callan ${silentInStudio.join(", ")}` : ""}`,
  );
}


/* -------------------------------------------------------------------------- */

console.log("\n[34] El plano genérico elige una forma que de verdad dibuja ESA medición");
/*
 * THE SECOND HOME OF THE SAME DEFECT.
 *
 * The approved blueprint is hand-written, so its bad pairing was one line. The
 * GENERIC starting layout picks its own, and it was picking with the wrong
 * question: it intersected what the authority permits for a semantic with a
 * flat list of everything this build draws for ANY semantic. `bar_vertical` is
 * drawn — for a distribution — and is permitted for a retention series, so the
 * intersection chose it, and every study without a registered blueprint opened
 * with the identical blank card.
 *
 * Fixing the approved blueprint alone would have left that untouched, and no
 * gate would have said so: reverting the per-semantic lookup turns nothing red
 * unless the generic layout is actually built and drawn. So it is, here, with
 * the real capability function the route passes rather than a stand-in.
 */
{
  const { buildGenericStartingBlueprint } = await import("../src/lib/presentation/blueprints/generic-starting.ts");
  const { offeredChartVariants } = await import("../src/lib/composer/renderer-capabilities.ts");
  const { renderToStaticMarkup } = await import("react-dom/server");
  const { createElement } = await import("react");
  const { PresentationRenderer } = await import("../src/components/presentation/PresentationRenderer.tsx");

  const { JOURNEY_ROUTES_VARIANTS } = await import("../src/lib/composer/renderer-capabilities.ts");
  const generic = buildGenericStartingBlueprint(registry, {
    drawableFor: offeredChartVariants,
    drawableForRoutes: JOURNEY_ROUTES_VARIANTS,
    title: "Estudio sin plano registrado",
  });
  const genericValid = validatePresentationDocument(JSON.parse(JSON.stringify(generic)));
  check(genericValid.ok, "el plano genérico valida contra el esquema versionado");

  if (genericValid.ok) {
    const genericBound = bindPresentationDocument(genericValid.value, registry);
    const genericResolved = resolvePresentation({ document: genericBound, registry, results });
    check(genericResolved.ok, "y resuelve entero sobre el mismo estudio");

    if (genericResolved.ok) {
      const blocks = genericResolved.value.pages.flatMap((page) => page.blocks);
      check(blocks.length >= 8, `el plano genérico propone ${blocks.length} bloques`);

      // EVERY CHOICE IS ONE THE BUILD ACTUALLY DRAWS FOR THAT SEMANTIC.
      //
      // A ROUTES BLOCK IS JUDGED AGAINST ITS OWN LIST, and writing this check
      // the other way reproduced the very confusion it exists to catch: a
      // `journey_routes` block carries the semantic of the group it draws from
      // and the variant of the drawing it IS, so asking the group's implemented
      // list about `journey_route_map` reports a correct block as wrong.
      const wrong = blocks
        .filter((block) => block.chartVariant !== null && block.semantic !== null)
        .filter((block) =>
          block.payload.shape === "routes"
            ? !JOURNEY_ROUTES_VARIANTS.includes(block.chartVariant)
            : !offeredChartVariants(block.semantic).includes(block.chartVariant),
        )
        .map((block) => `${block.id}: ${block.chartVariant} sobre ${block.payload.shape}`);
      check(
        wrong.length === 0,
        `cada forma elegida está entre las que este build dibuja para esa medición${wrong.length ? `: ${wrong.join("; ")}` : ""}`,
      );

      // And the proof that matters: it draws.
      const textOfGeneric = (markup) => markup.replace(/<[^>]*>/g, "").replace(/&[a-z]+;/g, " ").trim();
      const blankGeneric = [];
      for (const block of blocks) {
        if (block.payload.shape === "editorial" || block.payload.shape === "filter_controls") continue;
        if (block.availability === "configuration_required") continue;
        const markup = renderToStaticMarkup(
          createElement(PresentationRenderer, {
            model: {
              ...genericResolved.value,
              pages: [
                {
                  id: "solo",
                  title: "",
                  order: 0,
                  blocks: [{ ...block, copy: { title: null, description: null, annotation: null } }],
                },
              ],
            },
            audience: "internal",
          }),
        );
        if (textOfGeneric(markup).length === 0) {
          blankGeneric.push(`${block.id} (${block.chartVariant ?? "sin forma"} sobre ${block.payload.shape})`);
        }
      }
      check(
        blankGeneric.length === 0,
        `ningún bloque del plano genérico dibuja un vacío${blankGeneric.length ? `: ${blankGeneric.join("; ")}` : ""}`,
      );

      /*
       * NOTHING THE REGISTRY PUBLISHES MAY GO MISSING.
       *
       * Every check above asks whether the blocks that EXIST are right, and
       * none of them can notice a block that stopped being proposed. Making
       * the variant lookup per-semantic did exactly that: a `journey_routes`
       * block is not a result bound to a group, the implemented list for
       * `journey_group` is deliberately empty, and asking it for a routes
       * block answered `null` — so every journey silently vanished from every
       * generic layout and every assertion stayed green.
       *
       * So the counts are compared against the registry itself.
       */
      const groupsInRegistry = registry.entries.filter((entry) => entry.semantic === "journey_group").length;
      const routeBlocks = blocks.filter((block) => block.payload.shape === "routes").length;
      eq("propone un recorrido por cada grupo que el registro publica", routeBlocks, groupsInRegistry);
      const termsInRegistry = registry.entries.filter((entry) => entry.semantic === "qualitative_terms").length;
      const termBlocks = blocks.filter((block) => block.payload.shape === "terms").length;
      eq("y una nube por cada conjunto de términos curados", termBlocks, termsInRegistry);
      // The series is the case that was wrong, so it is named.
      const genericSeries = blocks.find((block) => block.payload.shape === "series");
      check(Boolean(genericSeries), "el plano genérico también propone la serie de periodos");
      if (genericSeries) {
        eq("y la propone como tarjetas por periodo", genericSeries.chartVariant, "period_cards");
      }
    }
  }
}

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
