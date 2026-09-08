// =============================================================================
// UNIT 6B.2 — INTERACTIVE CANONICAL FILTERS, AND THE SEMANTICS THEY MUST HAVE
// =============================================================================
//   node node_modules/tsx/dist/cli.mjs scripts/canonical-viewer-filters-test.mjs
//   npm run test:canonical-viewer-filters
//
// WHAT THIS GATE IS FOR.
//
// A filter that looks right and answers with the wrong population is the most
// expensive defect this product can ship, because every number stays plausible.
// So the assertions below are about SEMANTICS and about the BOUNDARY, and they
// are driven through the real composition — `src/lib/viewer/` — rather than
// through a copy of it assembled here.
//
//   1  a filter moves a block only when a connection names it;
//   2  several values inside one characteristic are an OR;
//   3  several characteristics are an AND;
//   4  several panels on one block are an AND;
//   5  an unconnected block is byte-identical to its unfiltered self;
//   6  the journey panel omits Esfera, and a selection cannot smuggle it back;
//   7  Esfera × CRI is refused, by both layers, under its own code;
//   8  a qualitative cloud is genuinely recomputed;
//   9  a selection matching nobody produces an explicit honest empty state;
//  10  an authored sample policy is applied AFTER filtering;
//  11  a tampered or stale selection is refused with a closed code;
//  12  the URL codec goes there and back, and refuses what it does not know;
//  13  a slower earlier response cannot overwrite a newer selection;
//  14  no respondent row, canonical key or raw value crosses the boundary;
//  15  the browser holds no calculation and no threshold;
//  16  retention does not accept a participant filter, and says so up front;
//  17  a period or a cohort does not vanish because somebody filtered;
//  18  the positions do not move: a filtered registry binds identically.
//
// Every figure here is invented. No client workbook, name, answer, quote or
// identifier is committed to this file.
// =============================================================================

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { composerFixtureSource } from "./lib/composer-fixture.mjs";
import { buildPresentationRead, resolveUnderSelection } from "../src/lib/viewer/index.ts";
import { buildCanonicalPresentationRegistry } from "../src/lib/presentation/registry.ts";
import { bindPresentationDocument } from "../src/lib/presentation/registry.ts";
import { validatePresentationDocument } from "../src/lib/presentation/document.ts";
import { serializeDeterministic } from "../src/lib/presentation/serialize.ts";
import { PRESENTATION_ERROR_LABEL } from "../src/lib/presentation/labels.ts";
import {
  EMPTY_VIEWER_SELECTION,
  VIEWER_LIMITS,
  filterOptionToken,
  normalizeViewerSelection,
  toggleViewerOption,
  validateViewerSelection,
  viewerConstraintsFor,
  viewerKeyForBlock,
  viewerRecomputations,
} from "../src/lib/presentation/viewer.ts";
import {
  decodeViewerSelection,
  encodeViewerSelection,
  readViewerStateParams,
} from "../src/lib/presentation/viewer-codec.ts";
import { viewerOfferFor } from "../src/lib/presentation/registry.ts";
import {
  acceptViewerResponse,
  openViewerSession,
  requestViewerCleared,
  requestViewerOption,
} from "../src/lib/composer/viewer-session.ts";
import { PresentationRenderer } from "../src/components/presentation/PresentationRenderer.tsx";

/* -------------------------------------------------------------------------- */
/* the four helpers every gate in this repository uses                         */
/* -------------------------------------------------------------------------- */

let failures = 0;
const ok = (message) => console.log(`  ✓ ${message}`);
const bad = (message) => {
  failures += 1;
  console.log(`  ✗ FALLO: ${message}`);
};
const check = (condition, message) => (condition ? ok(message) : bad(message));
const eq = (label, actual, expected) =>
  check(
    Object.is(actual, expected),
    `${label} = ${JSON.stringify(expected)}${Object.is(actual, expected) ? "" : ` (fue ${JSON.stringify(actual)})`}`,
  );

/** Assert a refusal happened AND happened for the intended reason. */
const refuses = (label, outcome, code) => {
  if (outcome.ok) return bad(`${label} debía rechazarse y no lo hizo`);
  const codes = outcome.issues.map((issue) => issue.code);
  check(codes.includes(code), `${label} = ${code}${codes.includes(code) ? "" : ` (fue ${codes.join(", ")})`}`);
};

const stripComments = (code) =>
  code.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/[^\n]*/g, "$1");

const textOf = (html) => html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ");

/* -------------------------------------------------------------------------- */
/* the fixture, and a document written over it                                 */
/* -------------------------------------------------------------------------- */

/**
 * The composer fixture, plus a performance dimension with an INCOMPLETE grid.
 *
 * Two months, and only one participant observed in the second. That is what
 * makes section [17] able to prove that a selection cannot delete a month: the
 * defect it guards against is invisible on a complete grid.
 */
function viewerFixtureSource() {
  const source = composerFixtureSource();
  source.performanceDimensions = [
    { key: "desempeno", label: "Desempeño", displayOrder: 0, bandSchemeKey: null },
  ];
  source.performanceObservations = [
    { participantId: "a1", dimensionKey: "desempeno", periodStart: "2026-01-01", periodLabel: "enero", value: 80, status: "answered" },
    { participantId: "a2", dimensionKey: "desempeno", periodStart: "2026-01-01", periodLabel: "enero", value: 60, status: "answered" },
    { participantId: "a4", dimensionKey: "desempeno", periodStart: "2026-01-01", periodLabel: "enero", value: 40, status: "answered" },
    // February exists ONLY for a1, who is «Generación X». A selection of
    // «Millenial» therefore has nobody in February — and February must survive.
    { participantId: "a1", dimensionKey: "desempeno", periodStart: "2026-02-01", periodLabel: "febrero", value: 90, status: "answered" },
  ];
  return source;
}

const read = buildPresentationRead(viewerFixtureSource());
const H = {
  generacion: "dimension:generacion",
  esfera: "dimension:esfera",
  cohorte: "dimension:cohorte",
  npsCombined: "value:nps-activos-y-desertores",
  npsActive: "value:nps-miembros-activos",
  npsDeserter: "value:nps-desertores",
  npsComposition: "distribution:nps-miembros-activos",
  renewal: "value:renewal-index",
  renewalDistribution: "distribution:renewal-intention",
  cloud: "qualitative:miembros-activos",
  group: "journey-group:interacciones-y-operacion",
  retention: "series:retention-and-attrition",
  performance: null,
};

const PANEL_A = "panel-a";
const PANEL_B = "panel-b";
const PANEL_RIESGO = "panel-riesgo";
const PANEL_RECORRIDO = "panel-recorrido";

const span = { desktop: 12, tablet: 12, mobile: 12 };
let order = 0;
const shell = (id, connect = []) => ({
  id,
  copy: { title: id, description: null, annotation: null },
  placement: { order: (order += 1), span, responsive: "reflow" },
  visible: true,
  connectedFilterPanelIds: connect,
  samplePolicy: null,
  methodologyDisclosure: null,
  displayFormat: { kind: "canonical" },
});
const panel = (id, dimensions) => ({ ...shell(id), kind: "filter_panel", dimensions });
const result = (id, binding, chartVariant, connect = []) => ({
  ...shell(id, connect),
  kind: "result",
  binding,
  chartVariant,
});

const touchpointsOfGroup = read.registry.entries.find((entry) => entry.handle === H.group).members;

/**
 * ONE PAGE THAT CARRIES EVERY CASE THE SEMANTICS HAVE TO ANSWER.
 *
 * `nps-suelto` shares every dimension with `panel-a` and is deliberately NOT
 * connected to it — the approved dashboard's «Razones declaradas de riesgo»
 * reproduced at fixture size, and the block section [1] and [5] are about.
 */
const authored = {
  schemaVersion: 4,
  documentKind: "canonical_presentation",
  registryVersion: read.registry.registryVersion,
  binding: null,
  id: "documento-de-lectura",
  title: "Filtros de lectura",
  locale: "es-MX",
  samplePolicy: { mode: "show_all" },
  methodologyDisclosure: "base_only",
  pages: [
    {
      id: "pagina-uno",
      title: "Una página",
      order: 0,
      blocks: [
        panel(PANEL_A, [H.generacion, H.cohorte]),
        panel(PANEL_B, [H.generacion]),
        panel(PANEL_RIESGO, [H.generacion]),
        // The journey panel omits Esfera exactly as the approved dashboard does,
        // and section [6] proves the omission omits something real.
        panel(PANEL_RECORRIDO, [H.generacion]),
        result("nps-conectado", H.npsActive, "kpi_with_base", [PANEL_A]),
        result("nps-dos-paneles", H.npsCombined, "kpi_value", [PANEL_A, PANEL_B]),
        result("nps-suelto", H.npsDeserter, "kpi_value"),
        result("nube", H.cloud, "word_cloud", [PANEL_A]),
        result("renovacion", H.renewal, "kpi_value", [PANEL_RIESGO]),
        result("retencion", H.retention, "period_cards"),
        {
          ...shell("recorrido", [PANEL_RECORRIDO]),
          kind: "journey_routes",
          chartVariant: "journey_route_map",
          routes: [
            {
              id: "ruta-uno",
              title: "Ruta uno",
              order: 0,
              sourceGroup: H.group,
              touchpoints: touchpointsOfGroup,
            },
          ],
        },
      ],
    },
  ],
};

const validated = validatePresentationDocument(structuredClone(authored));
if (!validated.ok) {
  console.log("El documento del fixture no valida:", JSON.stringify(validated.errors, null, 2));
  process.exit(1);
}
const document_ = bindPresentationDocument(validated.value, read.registry);

/** Resolve the fixture document under one selection. */
const resolve = (selection) => resolveUnderSelection(read, document_, selection);

/** Build a selection literal without going through the client's toggles. */
const select = (...panels) => ({
  panels: panels.map(([panelId, handle, ...tokens]) => ({
    panelId,
    dimensions: [{ handle, options: tokens }],
  })),
});
const selectMany = (panelId, dimensions) => ({
  panels: [{ panelId, dimensions: dimensions.map(([handle, ...tokens]) => ({ handle, options: tokens })) }],
});

const blockOf = (outcome, id) => outcome.model.pages[0].blocks.find((block) => block.id === id);
const GEN_X = filterOptionToken(0);
const MILLENIAL = filterOptionToken(1);
const ACTIVOS = filterOptionToken(0);
const DESERTORES = filterOptionToken(1);

const neutral = resolve(EMPTY_VIEWER_SELECTION);
if (!neutral.ok) {
  console.log("La resolución neutral falló:", JSON.stringify(neutral.issues, null, 2));
  process.exit(1);
}

/* -------------------------------------------------------------------------- */

console.log("\n[1] Un filtro mueve un bloque sólo cuando una conexión lo nombra");
const genX = resolve(select([PANEL_A, H.generacion, GEN_X]));
check(genX.ok, "una selección válida resuelve");
eq("recálculos que exigió", genX.recomputations, 1);
const connectedNeutral = serializeDeterministic(blockOf(neutral, "nps-conectado").payload);
const connectedFiltered = serializeDeterministic(blockOf(genX, "nps-conectado").payload);
check(connectedNeutral !== connectedFiltered, "el bloque conectado al panel cambia");
// SHARING A DIMENSION IS NOT A CONNECTION. `nps-suelto` is a recommendation
// score that supports every dimension the panel offers, and it is not named by
// the panel, so nothing may move it.
const looseNeutral = serializeDeterministic(blockOf(neutral, "nps-suelto").payload);
const looseFiltered = serializeDeterministic(blockOf(genX, "nps-suelto").payload);
check(looseNeutral === looseFiltered, "y el bloque que sólo comparte la característica no se mueve");
check(
  read.registry.entries
    .find((entry) => entry.handle === H.npsDeserter)
    .supportedFilters.includes(H.generacion),
  "y sí soportaba esa característica, así que la inmovilidad significa algo",
);
eq("resumen del bloque conectado", typeof blockOf(genX, "nps-conectado").activeFilterSummary, "string");
eq("resumen del bloque suelto", blockOf(genX, "nps-suelto").activeFilterSummary, null);

/* -------------------------------------------------------------------------- */

console.log("\n[2] Varios valores de una característica son una «o»");
const millenial = resolve(select([PANEL_A, H.generacion, MILLENIAL]));
const ambas = resolve(select([PANEL_A, H.generacion, GEN_X, MILLENIAL]));
const peopleOf = (outcome) => blockOf(outcome, PANEL_A).payload.selection.selectedPeople;
eq("«Generación X» sola deja", peopleOf(genX), 3);
eq("«Millenial» sola deja", peopleOf(millenial), 2);
eq("las dos juntas dejan", peopleOf(ambas), 5);
check(
  peopleOf(ambas) > peopleOf(genX) && peopleOf(ambas) > peopleOf(millenial),
  "así que elegir dos valores incluye a quien cumpla cualquiera de ellos, no a quien cumpla ambos",
);
eq("y la base del estudio no se mueve", blockOf(ambas, PANEL_A).payload.selection.basePeople, 7);
// THE SAME PROOF ON THE COHORT DIMENSION, which the engine matches through a
// different branch. A discrimination probe that broke only the cohort branch
// walked past an earlier version of this section: two branches need two proofs.
const soloDesertores = resolve(select([PANEL_A, H.cohorte, DESERTORES]));
const ambosCohortes = resolve(select([PANEL_A, H.cohorte, ACTIVOS, DESERTORES]));
eq("«Miembros activos» solos dejan", peopleOf(resolve(select([PANEL_A, H.cohorte, ACTIVOS]))), 5);
eq("«Desertores» solos dejan", peopleOf(soloDesertores), 2);
eq("y los dos cohortes juntos dejan el estudio entero", peopleOf(ambosCohortes), 7);

/* -------------------------------------------------------------------------- */

console.log("\n[3] Varias características son una «y»");
const soloActivos = resolve(selectMany(PANEL_A, [[H.cohorte, ACTIVOS]]));
const activosGenX = resolve(selectMany(PANEL_A, [[H.cohorte, ACTIVOS], [H.generacion, GEN_X]]));
eq("«Miembros activos» solos dejan", peopleOf(soloActivos), 5);
eq("«Miembros activos» Y «Generación X» dejan", peopleOf(activosGenX), 3);
check(
  peopleOf(activosGenX) < peopleOf(soloActivos),
  "así que añadir una característica estrecha la población en vez de ampliarla",
);
const activosDesertores = resolve(
  selectMany(PANEL_A, [[H.cohorte, ACTIVOS, DESERTORES], [H.generacion, GEN_X]]),
);
eq("y la «o» sigue viva dentro de cada característica", peopleOf(activosDesertores), 3);

/* -------------------------------------------------------------------------- */

console.log("\n[4] Dos paneles sobre un mismo bloque se combinan con «y»");
const dosPaneles = resolve(select([PANEL_A, H.generacion, GEN_X], [PANEL_B, H.generacion, MILLENIAL]));
check(dosPaneles.ok, "la selección de dos paneles resuelve");
const dual = blockOf(dosPaneles, "nps-dos-paneles");
const single = blockOf(dosPaneles, "nps-conectado");
check(
  dual.payload.value === null || dual.payload.absence !== null,
  "el bloque conectado a los dos no publica cifra: nadie es «Generación X» y «Millenial» a la vez",
);
eq(
  "y su ausencia es la del filtro",
  dual.payload.absence?.reason,
  "empty_filtered_population",
);
check(
  single.payload.value !== null,
  "mientras el bloque conectado sólo al primer panel sí publica la suya",
);
eq(
  "el resumen del bloque doble nombra las dos restricciones",
  (dual.activeFilterSummary ?? "").split("·").length,
  2,
);
eq("y exigió recálculos distintos", dosPaneles.recomputations, 3);

/* -------------------------------------------------------------------------- */

console.log("\n[5] Un bloque desconectado es idéntico byte a byte");
for (const id of ["nps-suelto", "retencion"]) {
  const before = serializeDeterministic(blockOf(neutral, id));
  for (const outcome of [genX, millenial, ambas, dosPaneles, activosGenX]) {
    const after = serializeDeterministic(blockOf(outcome, id));
    check(before === after, `«${id}» no cambia ni un byte bajo una selección más`);
  }
}
check(
  serializeDeterministic(blockOf(neutral, "nps-conectado")) !==
    serializeDeterministic(blockOf(genX, "nps-conectado")),
  "y el control de la comparación sí cambia, así que la igualdad de arriba no es vacía",
);

/* -------------------------------------------------------------------------- */

console.log("\n[6] El panel del recorrido no ofrece Esfera, y una selección no la cuela");
const journeyEntry = read.registry.entries.find((entry) => entry.handle === H.group);
check(
  journeyEntry.supportedFilters.includes(H.esfera),
  "el recorrido SÍ podría cruzarse con Esfera: ninguna autoridad lo prohíbe",
);
check(
  !journeyEntry.forbiddenFilters.includes(H.esfera),
  "y por eso la omisión del panel es una decisión de presentación, no una prohibición",
);
const journeyPanel = document_.pages[0].blocks.find((block) => block.id === PANEL_RECORRIDO);
check(!journeyPanel.dimensions.includes(H.esfera), "el panel del recorrido no la ofrece");
check(
  read.registry.entries.some((entry) => entry.handle === H.esfera),
  "y la dimensión existe, así que la omisión omite algo",
);
refuses(
  "una selección que nombra Esfera en el panel del recorrido",
  resolve(select([PANEL_RECORRIDO, H.esfera, filterOptionToken(0)])),
  "filter_dimension_not_offered",
);

/* -------------------------------------------------------------------------- */

console.log("\n[7] Esfera × CRI se niega en las dos capas, y por su propio código");
const renewalEntry = read.registry.entries.find((entry) => entry.handle === H.renewal);
check(renewalEntry.forbiddenFilters.includes(H.esfera), "el registro marca el cruce como prohibido");
check(!renewalEntry.supportedFilters.includes(H.esfera), "y no lo ofrece entre los soportados");
const withEsferaPanel = structuredClone(authored);
withEsferaPanel.pages[0].blocks
  .find((block) => block.id === PANEL_RIESGO)
  .dimensions.push(H.esfera);
const boundEsfera = bindPresentationDocument(
  validatePresentationDocument(withEsferaPanel).value,
  read.registry,
);
refuses(
  "un panel que ofrece Esfera y mueve el índice de renovación",
  resolveUnderSelection(read, boundEsfera, EMPTY_VIEWER_SELECTION),
  "forbidden_filter_cross",
);
// AND THE CALCULATION LAYER REFUSES IT TOO, independently of the presentation
// one. If the connection check above were ever weakened, the number would still
// not be published: the canonical contract answers `cross_not_permitted`.
const esferaFiltered = read.registry.filterOptions.get(H.esfera);
const { buildCanonicalStudyResults } = await import("../src/lib/results/build.ts");
const crossed = buildCanonicalStudyResults(read.source, {
  filters: [{ dimensionKey: "perfil_cliente_h", values: [esferaFiltered[0].value] }],
});
eq("el índice de renovación bajo Esfera", crossed.renewal.index.status, "unavailable");
eq("y su razón", crossed.renewal.index.reason, "cross_not_permitted");
eq("y su distribución se retira entera", crossed.renewal.distribution, null);
check(
  crossed.recommendation.scopes[0].score.status === "available",
  "mientras otra sección sí se recalcula bajo la misma selección, así que la negativa es del cruce",
);

/* -------------------------------------------------------------------------- */

console.log("\n[8] Una nube cualitativa se filtra de verdad");
const cloudNeutral = blockOf(neutral, "nube").payload;
const cloudFiltered = blockOf(genX, "nube").payload;
eq("la nube sin filtro trae términos", cloudNeutral.terms.length > 0, true);
check(
  serializeDeterministic(cloudNeutral) !== serializeDeterministic(cloudFiltered),
  "y bajo un filtro no es la misma nube",
);
check(
  cloudFiltered.total <= cloudNeutral.total,
  `y su total no crece al estrechar la población (${cloudNeutral.total} → ${cloudFiltered.total})`,
);
check(
  cloudFiltered.terms.every((term) => term.count !== null),
  "cada término sigue trayendo su conteo ya calculado",
);

/* -------------------------------------------------------------------------- */

console.log("\n[9] Una selección sin nadie produce un estado vacío explícito");
const nobody = resolve(selectMany(PANEL_A, [[H.cohorte, DESERTORES], [H.generacion, GEN_X]]));
check(nobody.ok, "una selección que no encuentra a nadie NO es un error");
eq("no queda nadie", blockOf(nobody, PANEL_A).payload.selection.selectedPeople, 0);
eq("y el panel lo declara", blockOf(nobody, PANEL_A).payload.selection.empty, true);
eq(
  "con una frase escrita en el servidor",
  blockOf(nobody, PANEL_A).payload.selection.countSentence,
  "Ninguna persona del estudio combina estas características.",
);
const emptyBlock = blockOf(nobody, "nps-conectado");
eq("el bloque conectado no publica un cero medido", emptyBlock.payload.value, null);
eq("sino la ausencia con su razón", emptyBlock.payload.absence?.reason, "empty_filtered_population");
check(
  serializeDeterministic(emptyBlock.payload) !==
    serializeDeterministic(blockOf(neutral, "nps-conectado").payload),
  "y no se queda con las cifras anteriores",
);
const emptyHtml = renderToStaticMarkup(
  createElement(PresentationRenderer, { model: nobody.model, audience: "client" }),
);
check(
  textOf(emptyHtml).includes("La selección actual no incluye a nadie."),
  "y el lector lo lee en español, no como un hueco",
);

/* -------------------------------------------------------------------------- */

console.log("\n[10] La política de muestra autorada se aplica DESPUÉS de filtrar");
const authoredPolicy = structuredClone(authored);
authoredPolicy.pages[0].blocks.find((block) => block.id === "nps-conectado").samplePolicy = {
  mode: "hide_below",
  threshold: 4,
  publicNote: "No se publica por base pequeña.",
  authoredBy: "Dirección de estudio",
  rationale: "Una base menor a cuatro personas identifica a quien respondió.",
};
const boundPolicy = bindPresentationDocument(
  validatePresentationDocument(authoredPolicy).value,
  read.registry,
);
const policyNeutral = resolveUnderSelection(read, boundPolicy, EMPTY_VIEWER_SELECTION);
const policyFiltered = resolveUnderSelection(
  read,
  boundPolicy,
  select([PANEL_A, H.generacion, MILLENIAL]),
);
check(policyNeutral.ok && policyFiltered.ok, "las dos resoluciones responden");
eq(
  "sin filtro la base alcanza y el resultado se muestra",
  blockOf(policyNeutral, "nps-conectado").sampleDisplay.state,
  "shown",
);
eq(
  "con el filtro la base cae por debajo del umbral y se retiene",
  blockOf(policyFiltered, "nps-conectado").sampleDisplay.state,
  "withheld_by_policy",
);
// THE DEFAULT IS STILL TO SHOW EVERYTHING. Nothing is suppressed unless
// somebody wrote the rule, and a small base under a `show_all` document is
// published exactly as the canonical layer produced it.
eq(
  "y sin regla escrita, la misma base pequeña se publica",
  blockOf(policyFiltered, "nps-dos-paneles").sampleDisplay.state,
  "shown",
);
// AN ANNOTATION IS DECIDED AGAINST THE FILTERED BASE TOO.
//
// `hide_below` is caught twice — the block header AND every value inside the
// payload obey the policy — so it survives even a resolver that judged the
// header against the wrong base. `annotate_below` is NOT: the sentence is a
// block-level fact taken from the registry entry's own response context. If the
// resolver reused the UNFILTERED registry, this block would keep saying nothing
// while its base fell from five people to two.
const annotated = structuredClone(authored);
annotated.pages[0].blocks.find((block) => block.id === "nps-conectado").samplePolicy = {
  mode: "annotate_below",
  threshold: 4,
  note: "Base pequeña: menos de cuatro personas.",
  authoredBy: "Dirección de estudio",
  rationale: "Una base pequeña se lee distinto y hay que decirlo.",
};
const boundAnnotated = bindPresentationDocument(
  validatePresentationDocument(annotated).value,
  read.registry,
);
eq(
  "sin filtro la base alcanza y no hay nota",
  blockOf(resolveUnderSelection(read, boundAnnotated, EMPTY_VIEWER_SELECTION), "nps-conectado")
    .sampleDisplay.state,
  "shown",
);
const annotatedFiltered = blockOf(
  resolveUnderSelection(read, boundAnnotated, select([PANEL_A, H.generacion, MILLENIAL])),
  "nps-conectado",
);
eq("con el filtro la base baja y aparece la nota", annotatedFiltered.sampleDisplay.state, "shown_with_note");
eq(
  "y es la frase que alguien redactó, ya terminada",
  annotatedFiltered.sampleDisplay.note,
  "Base pequeña: menos de cuatro personas.",
);
// AND SO IS AVAILABILITY. A block whose population the selection empties must
// say `unavailable` in its own header, not merely carry an empty payload under
// an `available` one.
eq(
  "un bloque que la selección deja sin nadie se declara no disponible",
  blockOf(resolve(select([PANEL_A, H.cohorte, DESERTORES])), "nps-conectado").availability,
  "unavailable",
);
eq(
  "y sin filtro el mismo bloque está disponible",
  blockOf(neutral, "nps-conectado").availability,
  "available",
);

const withheldHtml = renderToStaticMarkup(
  createElement(PresentationRenderer, { model: policyFiltered.model, audience: "client" }),
);
check(!withheldHtml.includes("Dirección de estudio"), "el lector no recibe quién lo decidió");
check(!withheldHtml.includes("identifica a quien respondió"), "ni la razón interna");
check(!/"threshold"|umbral 4/.test(withheldHtml), "ni el umbral contra el que se comparó");
check(
  textOf(withheldHtml).includes("No se publica por base pequeña."),
  "sólo la nota que alguien redactó para él",
);

/* -------------------------------------------------------------------------- */

console.log("\n[11] Una selección manipulada o rancia se rechaza con un código cerrado");
refuses("un panel que no existe", resolve(select(["panel-inventado", H.generacion, GEN_X])), "unknown_filter_panel");
refuses(
  "una característica que ese panel no ofrece",
  resolve(select([PANEL_B, H.cohorte, ACTIVOS])),
  "filter_dimension_not_offered",
);
refuses(
  "un valor que la característica no tiene",
  resolve(select([PANEL_A, H.generacion, filterOptionToken(97)])),
  "unknown_filter_option",
);
refuses("una selección que no es un objeto", resolve("todas"), "viewer_selection_malformed");
refuses("una selección sin paneles", resolve({}), "viewer_selection_malformed");
refuses(
  "un identificador de panel con forma de ruta",
  resolve(select(["../../etc/passwd", H.generacion, GEN_X])),
  "viewer_selection_malformed",
);
refuses(
  "un handle que no es una dimensión",
  resolve(select([PANEL_A, H.npsActive, GEN_X])),
  "filter_dimension_not_offered",
);
refuses(
  "un valor crudo en lugar de una posición",
  resolve(select([PANEL_A, H.generacion, "Generación X"])),
  "viewer_selection_malformed",
);
refuses(
  "una clave canónica en lugar de un handle",
  resolve(select([PANEL_A, "perfil_cliente_e", GEN_X])),
  "viewer_selection_malformed",
);
// THE ALLOWLIST OF POSITIONS IS CHECKED BY THE VALIDATOR ITSELF, and this
// assertion isolates it from the translation step behind it. Both refuse an
// unknown position — that is defence in depth and it is deliberate — but a gate
// that only ever saw the outer refusal could not tell which one was working.
const validationOffer = viewerOfferFor(document_, read.registry);
const directlyValidated = validateViewerSelection(
  select([PANEL_A, H.generacion, filterOptionToken(97)]),
  validationOffer,
);
check(
  !directlyValidated.ok && directlyValidated.code === "unknown_filter_option",
  "el validador rechaza por sí solo una posición que el estudio nunca acuñó",
);
const directlyOffered = validateViewerSelection(
  select([PANEL_B, H.cohorte, ACTIVOS]),
  validationOffer,
);
check(
  !directlyOffered.ok && directlyOffered.code === "filter_dimension_not_offered",
  "y por sí solo una característica que ese panel no ofrece",
);
check(
  validateViewerSelection(select([PANEL_A, H.generacion, GEN_X]), validationOffer).ok,
  "mientras una selección legítima pasa, así que las dos negativas no son un rechazo de todo",
);

// A STALE SELECTION. The panel was real when the reader chose, and the document
// they are being resolved against no longer has it. It refuses rather than
// applying the part that still parses.
const withoutPanelB = structuredClone(authored);
withoutPanelB.pages[0].blocks = withoutPanelB.pages[0].blocks
  .filter((block) => block.id !== PANEL_B)
  .map((block) => ({
    ...block,
    connectedFilterPanelIds: block.connectedFilterPanelIds.filter((id) => id !== PANEL_B),
  }));
const boundWithout = bindPresentationDocument(
  validatePresentationDocument(withoutPanelB).value,
  read.registry,
);
refuses(
  "una selección rancia que nombra un panel que el documento ya no tiene",
  resolveUnderSelection(read, boundWithout, select([PANEL_B, H.generacion, GEN_X])),
  "unknown_filter_panel",
);
// AND EVERY ONE OF THOSE CODES HAS A SENTENCE A PERSON CAN READ.
for (const code of [
  "viewer_selection_malformed",
  "unknown_filter_panel",
  "filter_dimension_not_offered",
  "unknown_filter_option",
  "too_many_filter_recomputations",
  "filter_recomputation_missing",
  "filter_registry_drift",
]) {
  check(
    typeof PRESENTATION_ERROR_LABEL[code] === "string" && PRESENTATION_ERROR_LABEL[code].length > 20,
    `«${code}» tiene una explicación en español`,
  );
  check(!/_/.test(PRESENTATION_ERROR_LABEL[code]), `y esa explicación no repite el código`);
}

/* -------------------------------------------------------------------------- */

console.log("\n[12] El códec de URL va y vuelve, y rechaza lo que no reconoce");
const offer = viewerOfferFor(document_, read.registry);
const roundTrips = [
  EMPTY_VIEWER_SELECTION,
  select([PANEL_A, H.generacion, GEN_X]),
  select([PANEL_A, H.generacion, GEN_X, MILLENIAL]),
  selectMany(PANEL_A, [[H.cohorte, ACTIVOS], [H.generacion, GEN_X]]),
  select([PANEL_A, H.generacion, GEN_X], [PANEL_B, H.generacion, MILLENIAL]),
];
for (const selection of roundTrips) {
  const encoded = encodeViewerSelection(selection);
  const decoded = decodeViewerSelection(encoded, offer);
  check(decoded.ok, `«${encoded || "(vacío)"}» se decodifica`);
  check(
    decoded.ok &&
      JSON.stringify(decoded.selection) === JSON.stringify(normalizeViewerSelection(selection)),
    "y vuelve exactamente igual",
  );
  check(
    decoded.ok && encodeViewerSelection(decoded.selection) === encoded,
    "y se re-codifica byte a byte igual",
  );
}
check(
  !/Generación|active|deserter|perfil_cliente/.test(
    encodeViewerSelection(selectMany(PANEL_A, [[H.cohorte, ACTIVOS], [H.generacion, GEN_X]])),
  ),
  "una URL no lleva ni un valor crudo ni una clave canónica",
);
for (const [label, raw, code] of [
  ["basura", "no-es-una-seleccion", "viewer_selection_malformed"],
  ["un panel desconocido", `panel-x~${H.generacion}=o0`, "unknown_filter_panel"],
  ["una característica no ofrecida", `${PANEL_B}~${H.cohorte}=o0`, "filter_dimension_not_offered"],
  ["un valor inexistente", `${PANEL_A}~${H.generacion}=o44`, "unknown_filter_option"],
  ["un token que no es ordinal", `${PANEL_A}~${H.generacion}=Generación X`, "viewer_selection_malformed"],
  ["un panel sin cuerpo", `${PANEL_A}~`, "viewer_selection_malformed"],
  ["una dimensión sin valores", `${PANEL_A}~${H.generacion}=`, "viewer_selection_malformed"],
  ["dos separadores de panel", `${PANEL_A}~~${H.generacion}=o0`, "viewer_selection_malformed"],
  ["una cadena desmesurada", "a~b:c=o0".repeat(600), "viewer_selection_malformed"],
]) {
  const decoded = decodeViewerSelection(raw, offer);
  check(!decoded.ok && decoded.code === code, `${label} se rechaza = ${code}`);
  check(!decoded.ok && !JSON.stringify(decoded).includes(raw.slice(0, 12)), "y la negativa no repite lo recibido");
}
// UNKNOWN PARAMETERS ARE DISCARDED EXPLICITLY, BY NAME AND NEVER BY VALUE.
const params = readViewerStateParams(
  { v: `${PANEL_A}~${H.generacion}=o0`, utm_source: "correo", email: "alguien@ejemplo.mx" },
  offer,
);
check(params.decoded.ok, "un parámetro extraño no invalida la vista");
check(
  params.discarded.join(",") === "email,utm_source",
  "los descartados se nombran, en orden",
);
check(
  !JSON.stringify(params).includes("alguien@ejemplo.mx"),
  "y NUNCA se repite su valor: una cadena de consulta es donde alguien probaría si el producto la devuelve",
);
const repeated = readViewerStateParams({ v: ["a~b=o0", "c~d=o1"] }, offer);
check(
  !repeated.decoded.ok && repeated.decoded.code === "viewer_selection_malformed",
  "dos estados en una misma URL se rechazan en vez de elegir uno",
);

/* -------------------------------------------------------------------------- */

console.log("\n[13] Una respuesta lenta no puede pisar una selección más nueva");
let session = openViewerSession();
const first = requestViewerOption(session, PANEL_A, H.generacion, GEN_X, true);
session = first.session;
const second = requestViewerOption(session, PANEL_A, H.generacion, MILLENIAL, true);
session = second.session;
eq("la primera petición lleva el número", first.request, 1);
eq("y la segunda el siguiente", second.request, 2);
const afterStale = acceptViewerResponse(session, first.request, { ok: true });
check(afterStale === session, "la respuesta de la primera se descarta, y el estado ni siquiera cambia de objeto");
const afterFresh = acceptViewerResponse(session, second.request, { ok: true });
check(afterFresh !== session, "la de la segunda sí se aplica");
eq(
  "y lo aplicado es lo que el lector pidió al final",
  JSON.stringify(afterFresh.applied),
  JSON.stringify(second.session.pending),
);
eq("el estado vuelve a reposo", afterFresh.status, "idle");
// A REFUSAL PUTS THE CONTROLS BACK, so they never describe a population the
// figures were not computed over.
const refused = acceptViewerResponse(second.session, second.request, {
  ok: false,
  message: "No se pudieron aplicar los filtros.",
});
eq("tras un rechazo, lo pendiente vuelve a lo aplicado", JSON.stringify(refused.pending), JSON.stringify(refused.applied));
eq("y el estado lo dice", refused.status, "error");
eq("con una frase, no un código", refused.message, "No se pudieron aplicar los filtros.");
const settled = acceptViewerResponse(openViewerSession(), 0, { ok: true });
eq("una sesión en reposo acepta su propio número cero", settled.status, "idle");
const cleared = requestViewerCleared(afterFresh);
eq("limpiar toda la vista es una petición nueva", cleared.request, 3);
eq("y deja la selección vacía", JSON.stringify(cleared.session.pending), JSON.stringify(EMPTY_VIEWER_SELECTION));
const noop = requestViewerCleared(acceptViewerResponse(cleared.session, cleared.request, { ok: true }));
check(noop.request === null, "y volver a pedir lo ya aplicado no gasta una ida y vuelta");

/* -------------------------------------------------------------------------- */

console.log("\n[14] Ni una fila de persona ni un valor crudo cruzan la frontera");
const serialized = serializeDeterministic({
  neutral: neutral.model,
  filtered: genX.model,
  empty: nobody.model,
});
for (const [label, needle] of [
  ["una dirección canónica", '"at":'],
  ["el mapa de direcciones", "addresses"],
  ["un identificador de participante", '"a1"'],
  ["otro identificador de participante", '"d1"'],
  ["la clave de cohorte cruda", '"active"'],
  ["la otra clave de cohorte cruda", '"deserter"'],
  ["una clave canónica de atributo", "perfil_cliente"],
  ["una clave de instrumento", "nps_activos"],
  ["una clave de reactivo", "csat_g0p1"],
  ["el identificador del inquilino", read.registry.source.tenantId],
  ["el identificador del estudio", read.registry.source.studyId],
  ["la huella del plan", read.registry.source.planFingerprint],
  ["la clave de idempotencia del paquete", read.registry.source.packageIdempotencyKey],
  ["el umbral de una política", '"threshold"'],
  ["quién autoró una política", "authoredBy"],
  ["la razón interna de una política", "rationale"],
]) {
  check(!serialized.includes(needle), `${label} no aparece en ningún modelo de render`);
}
// AND THE THINGS THAT MUST BE THERE ARE THERE, so the absences above mean
// something rather than describing an empty object.
check(serialized.includes("Miembros activos"), "en cambio la etiqueta en español del cohorte sí viaja");
check(serialized.includes("Generación X"), "y la etiqueta de una característica también");
check(
  read.registry.filterOptions.get(H.cohorte).some((option) => option.value === "active"),
  "y el valor crudo sigue existiendo en el servidor, así que su ausencia arriba es una decisión",
);
// The rendered HTML is the last boundary: nothing above survives into the DOM.
const clientHtml = renderToStaticMarkup(
  createElement(PresentationRenderer, { model: genX.model, audience: "client" }),
);
for (const needle of ["perfil_cliente", '"active"', "csat_g0p1", "dimension:", read.registry.binding]) {
  check(!clientHtml.includes(needle), `«${String(needle).slice(0, 24)}» no llega al DOM del cliente`);
}

/* -------------------------------------------------------------------------- */

console.log("\n[15] El navegador no calcula, y no recibe con qué calcular");
const clientModules = [
  ["FilterControls.tsx", join("src", "components", "presentation", "FilterControls.tsx")],
  ["viewer.ts (componentes)", join("src", "components", "presentation", "viewer.ts")],
  ["viewer-session.ts", join("src", "lib", "composer", "viewer-session.ts")],
  ["viewer.ts (presentación)", join("src", "lib", "presentation", "viewer.ts")],
  ["viewer-codec.ts", join("src", "lib", "presentation", "viewer-codec.ts")],
];
for (const [label, path] of clientModules) {
  const code = stripComments(readFileSync(path, "utf8"))
    .replace(/"(?:[^"\\]|\\.)*"/g, '""')
    .replace(/`(?:[^`\\]|\\.)*`/g, "``")
    .replace(/'(?:[^'\\]|\\.)*'/g, "''")
    .replace(/\/(?:[^/\\\n[]|\\.|\[[^\]]*\])+\/[gimsuy]*/g, "RE")
    // JSX CLOSES TAGS WITH A SLASH, and a scan that could not tell `</p>` from
    // a division would forbid every component in the library. The two tag forms
    // are removed BEFORE the arithmetic scan, and nothing else containing a
    // slash survives the string and regex passes above.
    .replace(/<\//g, "<")
    .replace(/\/>/g, ">");
  check(!/toFixed|toPrecision|parseFloat|Number\(/.test(code), `${label} no formatea ni convierte un número`);
  check(!/[^*/\n]\/[^*/=\n]/.test(code), `${label} no divide`);
  check(!/[^*/\n]\*[^*/=\n]/.test(code), `${label} no multiplica`);
  check(!/Math\./.test(code), `${label} no llama a Math`);
  check(!/@supabase|createClient\(|\.rpc\(|\bfetch\(/.test(code), `${label} no alcanza un transporte`);
}
// THE SHAPES THEMSELVES CANNOT CARRY A RULE.
const renderModelTypes = readFileSync(join("src", "lib", "presentation", "render-model.ts"), "utf8");
// COMMENTS STRIPPED FIRST. Both of these types EXPLAIN, at length, the thing
// they must not carry — "never the canonical value", "a browser holding a
// threshold" — and a scan that could not tell an explanation from a field would
// forbid the explanation.
const filterSelectionType = stripComments(
  renderModelTypes.slice(
    renderModelTypes.indexOf("export type RenderFilterSelection"),
    renderModelTypes.indexOf("/** One resolved block. */"),
  ),
);
check(!/threshold/.test(filterSelectionType), "el resumen de una selección no lleva un umbral");
check(
  /countSentence/.test(filterSelectionType) && /summary/.test(filterSelectionType),
  "lleva frases terminadas, que es lo que el servidor decidió por él",
);
const optionType = stripComments(
  renderModelTypes.slice(
    renderModelTypes.indexOf("export type RenderFilterOption"),
    renderModelTypes.indexOf("/** One filter control a panel offers. */"),
  ),
);
check(!/\bvalue\b/.test(optionType), "una opción de filtro no lleva el valor canónico, sólo su posición y su etiqueta");
// AND THE PANEL IS DEAD WHERE NOTHING CAN OPERATE IT.
const canvasHtml = renderToStaticMarkup(
  createElement(PresentationRenderer, { model: genX.model, audience: "internal" }),
);
check(/disabled/.test(canvasHtml), "sin controles de lectura, los filtros se dibujan deshabilitados");
check(
  textOf(canvasHtml).includes("Aquí los filtros no se aplican"),
  "y dicen dónde sí se filtra",
);
check(
  !textOf(
    renderToStaticMarkup(createElement(PresentationRenderer, { model: genX.model, audience: "client" })),
  ).includes("Aquí los filtros no se aplican"),
  "y un cliente no ve un control muerto",
);

/* -------------------------------------------------------------------------- */

console.log("\n[16] La retención no acepta un filtro de participantes, y se dice antes");
for (const handle of [H.retention, "value:retention-rate-p-1", "value:attrition-rate-p-1"]) {
  const entry = read.registry.entries.find((candidate) => candidate.handle === handle);
  check(entry !== undefined, `«${handle}» existe en el registro`);
  eq(`«${handle}» no ofrece ninguna característica`, entry.supportedFilters.length, 0);
}
// AND THE REASON IS REAL, not a rule invented in the registry: the calculation
// layer refuses to recompute a roster under a participant selection.
const rosterFiltered = buildCanonicalStudyResults(read.source, {
  filters: [{ dimensionKey: "cohort", values: ["active"] }],
});
eq(
  "la capa de cálculo se niega a recalcular el padrón bajo una selección",
  rosterFiltered.retention.periods[0].retention.reason,
  "cross_not_permitted",
);
const connectedRetention = structuredClone(authored);
connectedRetention.pages[0].blocks.find((block) => block.id === "retencion").connectedFilterPanelIds = [
  PANEL_A,
];
refuses(
  "conectar un bloque de retención a un panel",
  resolveUnderSelection(
    read,
    bindPresentationDocument(validatePresentationDocument(connectedRetention).value, read.registry),
    EMPTY_VIEWER_SELECTION,
  ),
  "unsupported_filter_dimension",
);

/* -------------------------------------------------------------------------- */

console.log("\n[17] Un periodo o una cohorte no desaparecen por filtrar");
const perfNeutral = buildCanonicalStudyResults(read.source);
const perfFiltered = buildCanonicalStudyResults(read.source, {
  filters: [{ dimensionKey: "perfil_cliente_e", values: ["Millenial"] }],
});
eq("el desempeño trae dos periodos sin filtro", perfNeutral.performance.dimensions[0].periods.length, 2);
eq(
  "y sigue trayendo dos con un filtro que deja febrero sin nadie",
  perfFiltered.performance.dimensions[0].periods.length,
  2,
);
eq(
  "febrero conserva su etiqueta",
  perfFiltered.performance.dimensions[0].periods[1].label,
  "febrero",
);
// THE SURVIVING PERIOD REPORTS AN ABSENCE, and which absence is the canonical
// layer's decision rather than this gate's. Under this selection February has
// an eligible base — the two Millenials are eligible for the dimension — and no
// record, so the contract answers `no_responses`, which is true. What matters
// here is that there IS a February, that it carries no value, and that it never
// publishes a measured zero.
const february = perfFiltered.performance.dimensions[0].periods[1];
eq("febrero no publica ninguna cifra", february.mean.status, "unavailable");
check(
  ["no_responses", "empty_filtered_population", "no_valid_answers"].includes(february.mean.reason),
  `y dice por qué en el vocabulario del contrato (${february.mean.reason})`,
);
check(!("value" in february.mean), "y no hay ningún cero medido donde no hubo medición");
eq(
  "mientras enero, que sí tiene a alguien en la selección, publica la suya",
  perfFiltered.performance.dimensions[0].periods[0].mean.status,
  "available",
);
eq("las cohortes siguen siendo dos", perfFiltered.population.cohorts.length, 2);
eq(
  "y la que el filtro vacía reporta cero en vez de irse",
  perfFiltered.population.cohorts.find((cohort) => cohort.key === "deserter").total,
  0,
);

/* -------------------------------------------------------------------------- */

console.log("\n[18] Las posiciones no se mueven, y si se movieran se rechazaría");
const filteredResults = buildCanonicalStudyResults(read.source, {
  filters: [{ dimensionKey: "perfil_cliente_e", values: ["Millenial"] }],
});
const filteredRegistry = buildCanonicalPresentationRegistry(filteredResults);
eq("un registro filtrado enlaza igual que el sin filtrar", filteredRegistry.binding, read.registry.binding);
check(
  JSON.stringify([...filteredRegistry.addresses]) === JSON.stringify([...read.registry.addresses]),
  "porque su mapa de direcciones es el mismo",
);
check(
  JSON.stringify(filteredRegistry.entries) !== JSON.stringify(read.registry.entries),
  "y sin embargo sus entradas NO son iguales: las bases y las disponibilidades sí se mueven",
);
// WHICH IS WHY THE REGISTRY IS REBUILT PER RECOMPUTATION. Resolving a filtered
// document against the unfiltered registry would dereference cleanly and decide
// every sample policy against a base nobody in the selection has.
const drifted = {
  ...filteredRegistry,
  binding: `${filteredRegistry.binding.slice(0, 60)}0000`,
};
const { resolvePresentation } = await import("../src/lib/presentation/resolve.ts");
const driftOutcome = resolvePresentation({
  document: document_,
  registry: read.registry,
  results: read.results,
  viewer: {
    selection: normalizeViewerSelection(select([PANEL_A, H.generacion, GEN_X])),
    views: new Map([
      [
        viewerKeyForBlock(normalizeViewerSelection(select([PANEL_A, H.generacion, GEN_X])), {
          connectedFilterPanelIds: [PANEL_A],
        }),
        { results: filteredResults, registry: drifted },
      ],
    ]),
  },
});
check(
  !driftOutcome.ok && driftOutcome.errors.some((issue) => issue.code === "filter_registry_drift"),
  "un recálculo cuyo registro direcciona otra cosa se rechaza = filter_registry_drift",
);
// AND A MISSING RECOMPUTATION REFUSES RATHER THAN FALLING BACK.
const missingOutcome = resolvePresentation({
  document: document_,
  registry: read.registry,
  results: read.results,
  viewer: {
    selection: normalizeViewerSelection(select([PANEL_A, H.generacion, GEN_X])),
    views: new Map(),
  },
});
check(
  !missingOutcome.ok && missingOutcome.errors.some((issue) => issue.code === "filter_recomputation_missing"),
  "y un bloque sin recálculo se niega en vez de responder con las cifras de todos",
);
// THE WORK IS BOUNDED. Blocks connected to the same panels share one
// recomputation, so the count follows the panel COMBINATIONS rather than the
// blocks.
const everything = {
  panels: [
    { panelId: PANEL_A, dimensions: [{ handle: H.generacion, options: [GEN_X] }] },
    { panelId: PANEL_B, dimensions: [{ handle: H.generacion, options: [MILLENIAL] }] },
    { panelId: PANEL_RIESGO, dimensions: [{ handle: H.generacion, options: [GEN_X] }] },
    { panelId: PANEL_RECORRIDO, dimensions: [{ handle: H.generacion, options: [GEN_X] }] },
  ],
};
// THREE, NOT FOUR AND NOT NINE. Three panels constrain «Generación X» and one
// constrains «Millenial», so there are two distinct single-panel sets; the only
// other set is the pair the doubly-connected block needs. Every block connected
// to the same panels shares one recomputation, which is what keeps the work
// proportional to the panel COMBINATIONS rather than to the blocks.
eq(
  "cuatro paneles activos sobre once bloques exigen",
  viewerRecomputations(document_, normalizeViewerSelection(everything)).length,
  3,
);
check(
  viewerRecomputations(document_, normalizeViewerSelection(everything)).length <= VIEWER_LIMITS.recomputations,
  "y siguen por debajo del techo que esta capa admite en una petición",
);
eq(
  "una selección neutra no exige ninguno",
  viewerRecomputations(document_, EMPTY_VIEWER_SELECTION).length,
  0,
);
// The constraint key is what pairs a block with its recomputation, and it is
// computed by the same function on both sides.
const key = viewerKeyForBlock(normalizeViewerSelection(select([PANEL_A, H.generacion, GEN_X])), {
  connectedFilterPanelIds: [PANEL_A],
});
eq("la clave de un bloque conectado no está vacía", key.length > 0, true);
eq(
  "y la de un bloque sin conexiones sí lo está",
  viewerKeyForBlock(normalizeViewerSelection(select([PANEL_A, H.generacion, GEN_X])), {
    connectedFilterPanelIds: [],
  }),
  "",
);
eq(
  "dos paneles con la misma restricción no la cuentan dos veces",
  viewerConstraintsFor(
    normalizeViewerSelection(select([PANEL_A, H.generacion, GEN_X], [PANEL_B, H.generacion, GEN_X])),
    [PANEL_A, PANEL_B],
  ).length,
  1,
);
eq(
  "y dos paneles con restricciones distintas sí son dos",
  viewerConstraintsFor(
    normalizeViewerSelection(select([PANEL_A, H.generacion, GEN_X], [PANEL_B, H.generacion, MILLENIAL])),
    [PANEL_A, PANEL_B],
  ).length,
  2,
);
// A toggle is idempotent and reversible, which is what «Limpiar filtros» rests on.
const toggled = toggleViewerOption(EMPTY_VIEWER_SELECTION, PANEL_A, H.generacion, GEN_X, true);
const untoggled = toggleViewerOption(toggled, PANEL_A, H.generacion, GEN_X, false);
eq(
  "quitar lo que se puso devuelve exactamente la selección neutra",
  JSON.stringify(untoggled),
  JSON.stringify(EMPTY_VIEWER_SELECTION),
);

/* -------------------------------------------------------------------------- */

console.log(`\n${"=".repeat(74)}`);
if (failures > 0) {
  console.log(`RESULTADO: ${failures} fallo(s). COMPUERTA BLOQUEADA.`);
  process.exit(1);
}
console.log(
  "RESULTADO: un filtro mueve sólo lo que una conexión nombra, los valores se combinan como " +
    "se prometió, un bloque desconectado no se mueve un byte, una selección vacía se declara, " +
    "la política autorada se aplica después de filtrar, una selección manipulada se rechaza por " +
    "su código, el códec falla cerrado, una respuesta rancia se descarta y el navegador no " +
    "recibe con qué calcular. COMPUERTA APROBADA.",
);
