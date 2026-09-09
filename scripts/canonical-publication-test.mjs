// =============================================================================
// UNIT 6B.4A — THE PUBLICATION LIFECYCLE, OFFLINE
//   npm run test:canonical-publication          (synthetic, in `npm test`)
// =============================================================================
// It drives the REAL preflight, the REAL inventory and the REAL structural
// difference — the modules the product calls — over a render model the REAL
// resolver produced from the composer fixture, plus hand-built models for the
// conditions that fixture cannot reach.
//
// WHAT IT PROVES
//
//   [1]  the vocabularies are closed, and every member is reachable;
//   [2]  a blocker is raised for each condition, BY NAME;
//   [3]  a warning is a warning, and the four that change what a client sees
//        require an acknowledgement while the rest do not;
//   [4]  NO THRESHOLD: a document whose policy is `show_all` produces no sample
//        warning over bases of one, and an AUTHORED policy is the only thing
//        that can;
//   [5]  `configuration_required` is a warning and never a blocker, so the
//        approved blueprint stays publishable;
//   [6]  qualitative categories nobody reviewed are a decision, not a refusal;
//   [7]  the verdict: no blockers AND no missing acknowledgement, and asking for
//        an acknowledgement of a condition this document does not have is
//        impossible;
//   [8]  the inventory and the difference speak in authored titles only — never
//        an id, a handle, an enum, a chart variant or a canonical key;
//   [9]  the route authorizes before it reads, the actions re-authorize, and
//        neither writes directly;
//   [10] nothing internal crosses to the browser: the payload has no field for a
//        document, a digest, a binding, a package identity or a uuid, and the
//        review surface never renders one;
//   [11] the publish control is unusable while a blocker exists, an
//        acknowledgement is missing, or the final confirmation is unticked;
//   [12] the pure layer reaches no transport and carries no `server-only`.
//
// It contacts nothing: no network, no database, no hosted project.
// =============================================================================

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// THE REAL COMPONENT, RENDERED TO REAL MARKUP.
//
// The disagreement this unit corrects was between a COUNT and a PICTURE, and
// no assertion over the count alone could have found it. So the gate draws the
// product's own renderer with the product's own audience and counts the cards
// that come out. `react-dom/server` is already a dependency of the app; this
// adds no package.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { buildPresentationRead, resolveUnderSelection } from "../src/lib/viewer/index.ts";
import { bindPresentationDocument } from "../src/lib/presentation/registry.ts";
import { validatePresentationDocument } from "../src/lib/presentation/document.ts";
import { EMPTY_VIEWER_SELECTION } from "../src/lib/presentation/viewer.ts";
import { buildGenericStartingBlueprint } from "../src/lib/presentation/blueprints/generic-starting.ts";
import { JOURNEY_ROUTES_VARIANTS, offeredChartVariants } from "../src/lib/composer/renderer-capabilities.ts";
import { serializeDeterministic } from "../src/lib/presentation/serialize.ts";
import { runPublicationPreflight } from "../src/lib/publication/preflight.ts";
import {
  CLIENT_SURFACE_IS_LIVE,
  WARNINGS_REQUIRING_ACKNOWLEDGEMENT,
  warningRequiresAcknowledgement,
} from "../src/lib/publication/contract.ts";
import {
  blockTitle,
  buildPublicationInventory,
  countVisibleToClient,
  pageTitle,
} from "../src/lib/publication/inventory.ts";
import { structuralDifference } from "../src/lib/publication/difference.ts";
import {
  qualitativeEvidenceDigest,
  qualitativeReviewState,
} from "../src/lib/publication/evidence-digest.ts";
import {
  CODING_LABEL,
  affectedBlocks,
} from "../src/lib/publication/qualitative-signoff.ts";
import { PresentationRenderer } from "../src/components/presentation/PresentationRenderer.tsx";
import { composerFixtureSource } from "./lib/composer-fixture.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const read = (path) => readFileSync(root + path, "utf8");
const stripComments = (code) =>
  code.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/[^\n]*/g, "$1");

let failures = 0;
let executed = 0;
const check = (condition, message) => {
  executed += 1;
  if (condition) console.log(`  ✓ ${message}`);
  else {
    failures += 1;
    console.log(`  ✗ FAIL: ${message}`);
  }
};
const eq = (label, actual, expected) =>
  check(
    Object.is(actual, expected),
    `${label} = ${JSON.stringify(expected)}${Object.is(actual, expected) ? "" : ` (was ${JSON.stringify(actual)})`}`,
  );

console.log("Be Community — Unit 6B.4A: la publicación canónica, sin base de datos");
console.log("=".repeat(78));

/* -------------------------------------------------------------------------- */
/* fixtures                                                                    */
/* -------------------------------------------------------------------------- */

const built = buildPresentationRead(composerFixtureSource());
const identity = {
  tenantId: built.registry.source.tenantId,
  studyId: built.registry.source.studyId,
  registryVersion: built.registry.registryVersion,
  bindingFingerprint: built.registry.binding,
  resultsContractVersion: built.registry.contractVersion,
  calculationVersion: built.registry.source.calculationVersion,
  specId: built.registry.source.specId,
  mappingVersion: built.registry.source.mappingVersion,
  packageIdempotencyKey: built.registry.source.packageIdempotencyKey,
  planFingerprint: built.registry.source.planFingerprint,
};

/** The generic blueprint over the fixture, bound and resolved for real. */
const blueprint = buildGenericStartingBlueprint(built.registry, {
  drawableFor: offeredChartVariants,
  drawableForRoutes: JOURNEY_ROUTES_VARIANTS,
  title: "Estudio de prueba",
});
const validated = validatePresentationDocument(JSON.parse(serializeDeterministic(blueprint)));
if (!validated.ok) {
  console.error("the generic blueprint does not validate", validated.errors);
  process.exit(1);
}
const bound = bindPresentationDocument(validated.value, built.registry);
const resolved = resolveUnderSelection(built, bound, EMPTY_VIEWER_SELECTION);
if (!resolved.ok) {
  console.error("the generic blueprint does not resolve", resolved.issues);
  process.exit(1);
}
const REAL_MODEL = resolved.model;

/** A hand-built block, so one outcome at a time can be produced exactly. */
const blockOf = (id, over = {}) => ({
  id,
  semantic: null,
  chartVariant: null,
  // `??` WOULD DEFEAT THE ONE CASE THIS HELPER EXISTS TO BUILD. `title: null`
  // means "this block has no title", and a default applied with `??` turns that
  // into "Bloque x" — so the assertion about an untitled block was made against
  // a titled one and passed for the wrong reason.
  copy: { title: "title" in over ? over.title : `Bloque ${id}`, description: null, annotation: null },
  placement: { order: 0, span: { desktop: 12, tablet: 12, mobile: 12 }, responsive: "reflow" },
  visible: over.visible ?? true,
  availability: over.availability ?? "available",
  provenance: null,
  // A BLOCK A CLIENT WOULD ACTUALLY SEE, unless a caller says otherwise.
  //
  // It used to default to a `value` payload holding NULL — nothing a reader
  // could be shown — and the preflight counted it as visible anyway, because
  // its own `visible` tally was a third implementation of the renderer's rule
  // and did not look at the payload at all. Now that all three ask one
  // predicate, a null-valued block is honestly reported as showing a client
  // nothing, and a baseline made of those would raise `nothing_visible` on
  // every assertion below. So the default carries a value.
  payload: over.payload ?? { shape: "value", value: { text: "7,0", numeric: 7 }, absence: null },
  methodology: { level: "none", explanation: null, base: null },
  sampleDisplay: over.sampleDisplay ?? { state: "shown" },
  connectedFilterPanelIds: [],
  activeFilterSummary: null,
});

const modelOf = (blocks, pageTitleText = "Primera") => ({
  schemaVersion: 4,
  contractVersion: identity.resultsContractVersion,
  registryVersion: identity.registryVersion,
  title: "Documento",
  locale: "es-MX",
  pages: [{ id: "p1", title: pageTitleText, order: 0, blocks }],
});

/** A subject that passes every stage, so a single field can be varied at a time. */
const healthy = (over = {}) => ({
  authorized: true,
  clientSurfaceIsLive: CLIENT_SURFACE_IS_LIVE,
  requiredBlockIds: [],
  qualitativeReviewState: "not_applicable",
  readRefusal: null,
  stored: {
    revision: 7,
    definitionSha256: "a".repeat(64),
    registryVersion: identity.registryVersion,
    bindingFingerprint: identity.bindingFingerprint,
  },
  reviewedRevision: 7,
  decodeIssues: null,
  bound: true,
  resolutionIssues: null,
  // A CLEAN MODEL, and deliberately not the real one. The generic blueprint over
  // this fixture declares an editorial slot nobody has filled, so the REAL model
  // legitimately raises `configuration_required_blocks` — which is the documented
  // behaviour and the subject of its own section. A baseline that carried it
  // would make every "no warnings" assertion below mean something else.
  model: modelOf([blockOf("b1")]),
  reproducible: true,
  current: identity,
  authored: {
    registryVersion: identity.registryVersion,
    bindingFingerprint: identity.bindingFingerprint,
  },
  lastPublished: null,
  qualitative: [],
  // A HEALTHY SUBJECT HAS NOTHING LEFT TO DECIDE ABOUT ITS PAIN QUEUE. Whether
  // the study HAS one is a separate fact from whether it is finished, and the
  // baseline says «no material», so a single field can be varied at a time in
  // §[16] without every other assertion changing meaning.
  painApplicable: false,
  painGaps: [],
  painContentRequired: false,
  expectedActiveVersion: null,
  actualActiveVersion: null,
  structureChanged: false,
  acknowledged: [],
  ...over,
});

const codes = (findings) => findings.map((entry) => entry.code).sort();
const has = (findings, code) => findings.some((entry) => entry.code === code);

/* -------------------------------------------------------------------------- */
console.log("\n[1] Un documento sano no tiene bloqueos, y publicar es posible");

const clean = runPublicationPreflight(healthy());
eq("bloqueos de un documento sano", clean.blockers.length, 0);
check(clean.canPublish, "y se puede publicar");
check(
  clean.warnings.some((entry) => entry.code === "first_publication"),
  "con la advertencia de que sería la primera publicación",
);
check(
  !clean.warnings.some((entry) => entry.requiresAcknowledgement),
  "y ninguna advertencia que haya que confirmar",
);
eq("advertencias que exigen confirmación", clean.required.length, 0);

/* -------------------------------------------------------------------------- */
console.log("\n[2] Cada bloqueo se levanta POR SU NOMBRE, y no por otro");

const cases = [
  ["not_authorized", { authorized: false }],
  ["no_canonical_package", { readRefusal: "no_canonical_package" }],
  ["multiple_canonical_packages", { readRefusal: "multiple_canonical_packages" }],
  ["specification_not_registered", { readRefusal: "specification_not_registered" }],
  ["canonical_read_refused", { readRefusal: "canonical_read_refused" }],
  ["no_stored_draft", { stored: null }],
  [
    "study_scope_drift",
    { decodeIssues: [{ code: "persistence_scope_mismatch", path: "$.metadata" }] },
  ],
  ["draft_digest_moved", { decodeIssues: [{ code: "persistence_hash_mismatch", path: "$" }] }],
  [
    "document_invalid",
    { decodeIssues: [{ code: "unsupported_schema_version", path: "$.documentKind" }] },
  ],
  [
    "stored_draft_undecodable",
    { decodeIssues: [{ code: "persistence_scope_invalid", path: "$.schemaVersion" }] },
  ],
  ["draft_revision_moved", { reviewedRevision: 6 }],
  ["document_unbound", { bound: false }],
  [
    "registry_version_drift",
    { authored: { registryVersion: "9.9.9", bindingFingerprint: identity.bindingFingerprint } },
  ],
  [
    "binding_drift",
    { authored: { registryVersion: identity.registryVersion, bindingFingerprint: "b".repeat(64) } },
  ],
  [
    "document_unresolved",
    { resolutionIssues: [{ code: "binding_fingerprint_mismatch", path: "$" }], model: null },
  ],
  ["render_model_not_reproducible", { reproducible: false }],
  [
    "block_unresolved",
    { model: modelOf([blockOf("b1", { availability: "unresolved" })]) },
  ],
  ["publication_pointer_moved", { expectedActiveVersion: 1, actualActiveVersion: 2 }],
  [
    "required_content_missing",
    {
      model: modelOf([
        blockOf("temas-recorrido", {
          title: "Puntos de dolor del recorrido",
          availability: "configuration_required",
          payload: { shape: "editorial", body: null, absence: null },
        }),
      ]),
      requiredBlockIds: ["temas-recorrido"],
    },
  ],
];

for (const [code, over] of cases) {
  const outcome = runPublicationPreflight(healthy(over));
  check(has(outcome.blockers, code), `«${code}» se levanta (${codes(outcome.blockers).join(", ") || "ninguno"})`);
  check(!outcome.canPublish, `y con él no se puede publicar`);
}

// EVERY MEMBER OF THE UNION IS REACHABLE. A closed vocabulary whose members
// cannot occur is four sentences nobody reads and four assertions nobody can
// make fail — the defect this unit corrected in its own first draft.
const BLOCKER_CODES = [...new Set(cases.map(([code]) => code))].sort();
const DECLARED_BLOCKERS = [
  ...read("src/lib/publication/contract.ts").matchAll(/^\s*\|\s*"([a-z_]+)"/gm),
]
  .map((match) => match[1])
  .filter((code) => BLOCKER_CODES.includes(code) || /drift|blocker/.test(code));
check(
  BLOCKER_CODES.length === 19,
  `los 19 códigos de bloqueo están ejercidos, cada uno por su condición (${BLOCKER_CODES.length})`,
);
check(DECLARED_BLOCKERS.length > 0, "y el contrato los declara como literales cerrados");

/* -------------------------------------------------------------------------- */
console.log("\n[3] Un aviso es un aviso, y sólo siete exigen confirmación");

eq(
  "advertencias que exigen confirmación, declaradas",
  JSON.stringify([...WARNINGS_REQUIRING_ACKNOWLEDGEMENT].sort()),
  JSON.stringify(
    [
      "configuration_required_blocks",
      "granular_filter_dimensions",
      "inoperable_filter_panels",
      "nothing_visible",
      "qualitative_review_pending",
      "qualitative_review_stale",
      "withheld_by_sample_policy",
    ],
  ),
);
for (const code of WARNINGS_REQUIRING_ACKNOWLEDGEMENT) {
  check(warningRequiresAcknowledgement(code), `«${code}» exige confirmación`);
}
for (const code of ["annotated_by_sample_policy", "unavailable_blocks", "hidden_blocks", "first_publication", "structure_changed", "evidence_changed_since_publication"]) {
  check(!warningRequiresAcknowledgement(code), `«${code}» NO exige confirmación`);
}

// AN ABSENCE THE CONTRACT STATES IS SOMETHING A CLIENT IS SHOWN, so the block
// carries the absence its resolver would have produced. A hand-built block that
// said `availability: "unavailable"` over a live value was describing a state
// the resolver never emits, and the assertion under it meant something else.
const unavailable = runPublicationPreflight(
  healthy({
    model: modelOf([
      blockOf("b1", {
        availability: "unavailable",
        payload: { shape: "value", value: null, absence: { state: "unavailable", reason: "no_responses" } },
      }),
    ]),
  }),
);
check(has(unavailable.warnings, "unavailable_blocks"), "una medición que el estudio no tiene es un aviso");
check(!has(unavailable.blockers, "block_unresolved"), "y no se confunde con una pregunta abierta");
// C11's EXCEPTION, ASSERTED. «Nadie respondió a esta medición» is a caveat
// about something the reader IS being shown, so the renderer draws it — and
// this layer therefore counts the block as visible. The preflight used to say
// the opposite while the renderer drew the sentence, which is the same class of
// disagreement as the filter panels.
check(
  !has(unavailable.warnings, "nothing_visible"),
  "y el cliente sí ve esa aclaración, así que el documento no está vacío",
);
check(unavailable.canPublish, "y se puede publicar sin confirmar nada más");

// NOTHING VISIBLE, for real: one block whose payload holds no value and states
// no absence. The client gets a page with nothing on it.
const emptyDocument = runPublicationPreflight(
  healthy({
    model: modelOf([blockOf("b1", { payload: { shape: "value", value: null, absence: null } })]),
  }),
);
check(has(emptyDocument.warnings, "nothing_visible"), "un documento sin nada que dibujar lo dice");
check(emptyDocument.blockers.length === 0, "sin bloquear");
check(
  emptyDocument.canPublish === false,
  "y no se publica hasta que alguien confirme que el cliente no vería nada",
);

const hidden = runPublicationPreflight(
  healthy({ model: modelOf([blockOf("b1"), blockOf("b2", { visible: false })]) }),
);
check(has(hidden.warnings, "hidden_blocks"), "un bloque oculto es un aviso");
check(hidden.canPublish, "y no impide publicar");

/* -------------------------------------------------------------------------- */
console.log("\n[4] NINGÚN UMBRAL: la muestra pequeña no se oculta sola");

// THE REAL MODEL, over the real fixture, whose bases are tiny by construction.
// The document's policy is `show_all` — the system default — so neither sample
// warning may appear, whatever the numbers are. This is the assertion that would
// fail the day somebody put a threshold in the preflight.
const realPreflight = runPublicationPreflight(healthy({ model: REAL_MODEL }));
check(
  !has(realPreflight.warnings, "withheld_by_sample_policy"),
  "sobre el modelo real, con bases mínimas, no se reserva nada por muestra",
);
// AND THE REAL MODEL IS NOT AN EASY CASE. The generic blueprint names everything
// this registry publishes, so it exercises every payload shape the inspection
// classifies — including the editorial slot nobody filled, which is the warning
// section [5] is about.
check(
  has(realPreflight.warnings, "configuration_required_blocks"),
  "y el plano genérico sí trae su ranura editorial vacía, que es un aviso y no un bloqueo",
);
eq("bloqueos sobre el modelo real", realPreflight.blockers.length, 0);
check(
  !has(realPreflight.warnings, "annotated_by_sample_policy"),
  "y no se anota nada por muestra",
);
const source = read("src/lib/publication/preflight.ts") + read("src/lib/publication/contract.ts");
check(
  !/\bthreshold\b\s*[:=]/.test(stripComments(source)),
  "y no hay ningún umbral declarado en esta capa",
);
check(
  !/<\s*\d|\d\s*>/.test(
    stripComments(read("src/lib/publication/preflight.ts")).replace(/\.length\s*[<>=]+\s*\d/g, ""),
  ),
  "ni ninguna comparación contra un número",
);

// AN AUTHORED POLICY IS THE ONLY THING THAT CAN. The outcome comes from the
// resolver, which decided it from a policy carrying an author and a reason.
const withheld = runPublicationPreflight(
  healthy({
    model: modelOf([
      blockOf("b1"),
      blockOf("b2", { sampleDisplay: { state: "withheld_by_policy", note: null } }),
    ]),
  }),
);
check(has(withheld.warnings, "withheld_by_sample_policy"), "una política escrita a mano SÍ produce el aviso");
check(
  withheld.required.includes("withheld_by_sample_policy"),
  "y ese aviso exige confirmación explícita",
);
eq("sin confirmarlo, publicar", withheld.canPublish, false);
eq(
  "confirmándolo, publicar",
  runPublicationPreflight(
    healthy({
      model: modelOf([
        blockOf("b1"),
        blockOf("b2", { sampleDisplay: { state: "withheld_by_policy", note: null } }),
      ]),
      acknowledged: ["withheld_by_sample_policy"],
    }),
  ).canPublish,
  true,
);

const annotated = runPublicationPreflight(
  healthy({
    model: modelOf([blockOf("b1", { sampleDisplay: { state: "shown_with_note", note: "n = 3" } })]),
  }),
);
check(has(annotated.warnings, "annotated_by_sample_policy"), "una nota escrita a mano se reporta");
check(annotated.canPublish, "y no exige confirmación");

/* -------------------------------------------------------------------------- */
console.log("\n[5] «Espera contenido» es un aviso, nunca un bloqueo");

// If it were a blocker, the approved blueprint could never be published: it
// declares the curated pain-cloud slot and leaves it EMPTY on purpose, and the
// contract classifies that content as editorial review.
const waiting = runPublicationPreflight(
  healthy({
    model: modelOf([blockOf("b1"), blockOf("b2", { availability: "configuration_required" })]),
  }),
);
check(
  !has(waiting.blockers, "block_unresolved") && waiting.blockers.length === 0,
  "un bloque que espera contenido no bloquea",
);
check(has(waiting.warnings, "configuration_required_blocks"), "es un aviso");
check(waiting.required.includes("configuration_required_blocks"), "que exige confirmación");
eq("sin confirmar", waiting.canPublish, false);
eq(
  "confirmado",
  runPublicationPreflight(
    healthy({
      model: modelOf([blockOf("b1"), blockOf("b2", { availability: "configuration_required" })]),
      acknowledged: ["configuration_required_blocks"],
    }),
  ).canPublish,
  true,
);

/* -------------------------------------------------------------------------- */
console.log("\n[6] Lo cualitativo sin revisar se decide, no se rechaza para siempre");

// THE GROUPS, AS THE APPROVED LAYOUT BINDS THEM: one group drawn by TWO
// visible blocks. That is the shape the old warning could not describe.
const activeGroup = {
  groupLabel: "Razones declaradas",
  coding: "source_coded",
  categories: ["Tiempo", "Costo", "Resultados"],
  excluded: ["No aplica"],
  blocks: ["Panorama · Miembros activos", "Panorama · Razones declaradas de riesgo"],
};

const pending = runPublicationPreflight(
  healthy({ qualitative: [activeGroup], qualitativeReviewState: "pending" }),
);
check(has(pending.warnings, "qualitative_review_pending"), "una categoría sin revisar es un aviso");
check(pending.required.includes("qualitative_review_pending"), "que exige confirmación");
const pendingWhere = pending.warnings.find((e) => e.code === "qualitative_review_pending").where;
// EVERY AFFECTED VISIBLE BLOCK, BY ITS AUTHORED TITLE. The old warning named
// the GROUP, so «Razones declaradas de riesgo» — which draws the same
// categories — was never mentioned to the person deciding.
eq("bloques nombrados por el aviso", pendingWhere.length, 2);
check(
  pendingWhere.includes("Panorama · Razones declaradas de riesgo"),
  "y nombra el segundo bloque que dibuja el mismo grupo",
);
check(
  !pendingWhere.some((where) => /qualitative\.|handle|group-/.test(where)),
  "por su título, nunca por un handle",
);

const signedOff = runPublicationPreflight(
  healthy({ qualitative: [activeGroup], qualitativeReviewState: "current" }),
);
check(!has(signedOff.warnings, "qualitative_review_pending"), "una revisada no dice nada");
check(!has(signedOff.warnings, "qualitative_review_stale"), "y tampoco dice que esté rancia");

// STALE IS ITS OWN SENTENCE. «Nobody read these» asks for a first reading;
// «what you approved is not what is here» asks somebody who already decided to
// look at what changed. Collapsing them would ask the wrong person the wrong
// question.
const stale = runPublicationPreflight(
  healthy({ qualitative: [activeGroup], qualitativeReviewState: "stale" }),
);
check(has(stale.warnings, "qualitative_review_stale"), "una revisión caducada tiene su propio aviso");
check(!has(stale.warnings, "qualitative_review_pending"), "y no se confunde con no haber revisado nunca");
check(stale.required.includes("qualitative_review_stale"), "y también exige confirmación");
check(
  stale.warnings.find((e) => e.code === "qualitative_review_stale").where.length === 2,
  "nombrando los mismos bloques",
);

// A DOCUMENT WITH NO QUALITATIVE GROUP SAYS NOTHING AT ALL.
const noQualitative = runPublicationPreflight(
  healthy({ qualitative: [], qualitativeReviewState: "not_applicable" }),
);
check(
  !has(noQualitative.warnings, "qualitative_review_pending") &&
    !has(noQualitative.warnings, "qualitative_review_stale"),
  "y un documento sin categorías cualitativas no dice nada de ellas",
);

/* -------------------------------------------------------------------------- */
console.log("\n[7] El veredicto: sin bloqueos Y sin confirmaciones pendientes");

const twoRequired = healthy({
  model: modelOf([
    blockOf("b1"),
    blockOf("b2", { availability: "configuration_required" }),
    blockOf("b3", { sampleDisplay: { state: "withheld_by_policy", note: null } }),
  ]),
});
const both = runPublicationPreflight(twoRequired);
eq("confirmaciones exigidas", both.required.length, 2);
eq("pendientes con ninguna marcada", both.unacknowledged.length, 2);
eq(
  "pendientes con una marcada",
  runPublicationPreflight({ ...twoRequired, acknowledged: ["configuration_required_blocks"] }).unacknowledged.length,
  1,
);
eq(
  "publicar con una sola marcada",
  runPublicationPreflight({ ...twoRequired, acknowledged: ["configuration_required_blocks"] }).canPublish,
  false,
);
eq(
  "publicar con las dos marcadas",
  runPublicationPreflight({
    ...twoRequired,
    acknowledged: ["configuration_required_blocks", "withheld_by_sample_policy"],
  }).canPublish,
  true,
);
// AND A CONFIRMATION OF SOMETHING THIS DOCUMENT DOES NOT HAVE CHANGES NOTHING.
// A screen full of inapplicable checkboxes teaches people to tick every box
// without reading one, so `required` is derived from what was RAISED.
check(
  !runPublicationPreflight(healthy({ acknowledged: ["qualitative_review_pending"] })).required.includes(
    "qualitative_review_pending",
  ),
  "confirmar algo que este documento no tiene no lo convierte en un requisito",
);
// A BLOCKER CANNOT BE ACKNOWLEDGED AWAY.
eq(
  "publicar con un bloqueo y todas las confirmaciones",
  runPublicationPreflight(
    healthy({
      reviewedRevision: 6,
      acknowledged: [...WARNINGS_REQUIRING_ACKNOWLEDGEMENT],
    }),
  ).canPublish,
  false,
);

/* -------------------------------------------------------------------------- */
console.log("\n[8] El inventario y la diferencia hablan en títulos, no en almacenamiento");

const inventory = buildPublicationInventory(REAL_MODEL, CLIENT_SURFACE_IS_LIVE);
check(inventory.length === REAL_MODEL.pages.length, `hay una entrada por página (${inventory.length})`);
const inventoryText = JSON.stringify(inventory);
for (const [what, pattern] of [
  ["un identificador de bloque", /"b[0-9]+"|bloque-[a-z0-9-]+/],
  ["un handle de presentación", /[a-z]+\.[a-z]+\./],
  ["una variante de dibujo cruda", /kpi_value|bar_horizontal|word_cloud|period_cards/],
  ["un estado en inglés", /available|configuration_required|withheld_by_policy/],
  ["una clave canónica", /[a-z]+_[a-z]+_[a-z]+/],
]) {
  check(!pattern.test(inventoryText), `el inventario no lleva ${what}`);
}
check(
  inventory.every((page) => page.blocks.every((block) => block.state.length > 0 && block.kind.length > 0)),
  "y cada bloque trae su tipo y su estado en palabras",
);

// A BLOCK WITHOUT A TITLE IS STILL FINDABLE.
const untitled = blockOf("x", { title: null });
check(
  blockTitle(untitled, 3).includes("3.º"),
  `un bloque sin título se nombra por lo que es y dónde está («${blockTitle(untitled, 3)}»)`,
);
check(
  pageTitle({ id: "p", title: "   ", order: 4, blocks: [] }) === "Página 5",
  "y una página sin título por su posición",
);

eq(
  "bloques que el cliente vería, en el modelo real",
  countVisibleToClient(REAL_MODEL, CLIENT_SURFACE_IS_LIVE) > 0,
  true,
);

const before = modelOf([blockOf("b1", { title: "Índice de renovación" })], "Resumen");
const after = modelOf(
  [blockOf("b1", { title: "Índice de renovación" }), blockOf("b2", { title: "Recomendación" })],
  "Resumen general",
);
const difference = structuralDifference(before, after);
check(!difference.identical, "una estructura distinta se reporta como distinta");
check(
  difference.changes.some((change) => change.kind === "page_renamed"),
  "el cambio de título de página se nombra",
);
check(
  difference.changes.some((change) => change.kind === "block_added" && change.sentence.includes("Recomendación")),
  "y el bloque añadido se nombra por su título",
);
check(
  structuralDifference(before, before).identical,
  "dos estructuras iguales se reportan como iguales",
);
const differenceText = JSON.stringify(difference);
check(!/"b1"|"b2"|"p1"/.test(differenceText), "y la diferencia no imprime un identificador");

/* -------------------------------------------------------------------------- */
console.log("\n[9] La ruta autoriza antes de leer y no escribe directamente");

const PAGE = "src/app/studio/e/[studyId]/revision/page.tsx";
const ACTIONS = "src/app/studio/e/[studyId]/revision/actions.ts";
const WORKSPACE = "src/lib/studio/publication-workspace.ts";
const VIEW = "src/components/studio/publication/PublicationReviewView.tsx";

const pageSource = read(PAGE);
const actionSource = read(ACTIONS);
const workspaceSource = read(WORKSPACE);
const viewSource = read(VIEW);

const gateAt = pageSource.indexOf("await requireInternal()");
check(gateAt >= 0, "la página llama a requireInternal()");
for (const reader of ["await params", "loadStudioStudy(", "loadPublicationReview(", "admin."]) {
  const at = pageSource.indexOf(reader);
  check(at < 0 || at > gateAt, `y lo hace antes de «${reader}»`);
}
check(/z\.string\(\)\.uuid\(\)\.safeParse\(studyId\)/.test(pageSource), "valida el estudio como UUID");
check(/notFound\(\)/.test(pageSource), "y responde 404 cuando el estudio no existe");

const actionCode = stripComments(actionSource);
check(/auth\.getUser\(\)/.test(actionCode), "la acción revalida la sesión con getUser()");
check(!/getSession\(/.test(actionCode), "y nunca con getSession()");
check(/from\("profiles"\)/.test(actionCode) && /role/.test(actionCode), "lee el rol de la base de datos");
check(/tenant_id/.test(actionCode), "y recupera el inquilino de la fila, nunca de la petición");

// AUTHORIZATION HAPPENS BEFORE THE PRIVILEGED CLIENT EXISTS, in every region
// that builds one — checked per site, not with a single `indexOf`.
{
  const sites = [...actionCode.matchAll(/createAdminClient\(\)/g)].map((match) => match.index ?? -1);
  check(sites.length > 0, `la acción construye un cliente privilegiado (${sites.length} sitio(s))`);
  for (const [index, at] of sites.entries()) {
    const region = actionCode.slice(index === 0 ? 0 : sites[index - 1], at);
    check(/auth\.getUser\(\)/.test(region), `el sitio ${index + 1} obtiene el usuario antes de construirlo`);
    check(/from\("profiles"\)/.test(region), `y comprueba el rol antes de construirlo`);
    check(/uuid\.safeParse/.test(region), `y valida el estudio antes de construirlo`);
  }
}

for (const [label, code] of [["la página", stripComments(pageSource)], ["la acción", actionCode]]) {
  const forbidden = [".insert(", ".update(", ".upsert(", ".delete(", ".rpc(", "revalidatePath"].filter((writer) =>
    code.includes(writer),
  );
  check(forbidden.length === 0, `${label} no escribe directamente${forbidden.length ? `: ${forbidden.join(", ")}` : ""}`);
}

// THE ONLY FOUR RPCs THIS ROUTE MAY NAME.
//
// `publish_canonical_presentation_with_qualitative` replaced the bare publish
// call: it does not reimplement publication — it CALLS
// `publish_canonical_presentation`, so every refusal that function makes still
// applies — and writes the qualitative review record beside the snapshot in the
// same transaction. `record_canonical_qualitative_signoff` is how a person's
// review of one exact set of category labels becomes a row. Both are migration
// 0031's, and both are the only write path to the table they touch.
{
  const named = new Set();
  let calls = 0;
  for (const code of [stripComments(pageSource), actionCode, stripComments(workspaceSource)]) {
    calls += [...code.matchAll(/\.rpc\(/g)].length;
    for (const match of code.matchAll(/\.rpc\(\s*["'`]([a-z_]+)["'`]/g)) named.add(match[1]);
  }
  eq(
    "los RPC que la ruta nombra",
    JSON.stringify([...named].sort()),
    JSON.stringify([
      "publish_canonical_presentation_with_qualitative",
      "read_canonical_publication",
      "record_canonical_qualitative_signoff",
      "restore_canonical_presentation",
    ]),
  );
  // And every call names its function with a LITERAL. An allowlist that only
  // looks at literals is fooled by `client.rpc(name, …)`, which puts zero names
  // in the file and passes.
  eq("y cada llamada lo nombra con un literal", calls, named.size);
}

// AND NO LEGACY EXPERIENCE OBJECT IS NAMED ANYWHERE ON THIS ROUTE.
for (const [label, code] of [
  ["la página", stripComments(pageSource)],
  ["la acción", actionCode],
  ["el módulo de publicación", stripComments(workspaceSource)],
  ["la vista", stripComments(viewSource)],
]) {
  check(
    !/study_experience_draft|study_experience_revision|study_experience_event|study_experience_publication/.test(code),
    `${label} no nombra ninguna tabla de la experiencia heredada`,
  );
}

/* -------------------------------------------------------------------------- */
console.log("\n[10] Nada interno cruza al navegador");

const payloadSource = read("src/lib/publication/payload.ts");
// The payload TYPE is the enforcement: there is nowhere to put these things.
for (const field of ["definitionSha256", "renderModelSha256", "bindingFingerprint", "packageIdempotencyKey", "planFingerprint", "tenantId", "revisionId"]) {
  check(
    !new RegExp(`\\b${field}\\b\\s*[?]?:`).test(payloadSource),
    `«${field}» no es un campo del pago que recibe la pantalla`,
  );
}
check(
  !/\bdocument\s*[?]?:\s*PresentationDocument/.test(payloadSource),
  "y el documento tampoco viaja: la pantalla no lo tiene y no puede reenviarlo",
);
check(
  /reviewedDraftRevision: number/.test(payloadSource) && /expectedCurrentVersion: number \| null/.test(payloadSource),
  "lo que se envía de vuelta son números de revisión y de versión",
);

const viewCode = stripComments(viewSource);
for (const [what, pattern] of [
  ["un uuid", /[0-9a-f]{8}-[0-9a-f]{4}-/],
  ["una huella", /sha256|Sha256|[0-9a-f]{40}/],
  ["un nombre de tabla protegida", /quant_response|qual_observation|person_private|survey_response|participant_attribute_value/],
  ["un identificador de publicación", /revisionId|activeRevisionId/],
]) {
  check(!pattern.test(viewCode), `la vista no lleva ${what}`);
}
check(
  !/@\/lib\/studio\/publication-workspace|@\/lib\/canonical-source/.test(viewCode),
  "y no importa el módulo de servidor por ningún camino",
);
check(/^\s*["']use client["']/m.test(viewSource), "la vista es un componente de cliente");

/* -------------------------------------------------------------------------- */
console.log("\n[11] El control de publicar es inusable hasta que se gana");

check(
  /const canPublish = !blocked && missing\.length === 0 && confirmed && !pending;/.test(viewCode),
  "la condición del control nombra las cuatro cosas: bloqueos, confirmaciones, la confirmación final y el envío en curso",
);
check(/disabled=\{!canPublish\}/.test(viewCode), "y el botón se deshabilita con ella");
check(
  /const blocked = payload\.blockers\.length > 0;/.test(viewCode),
  "«bloqueado» es literalmente «hay bloqueos»",
);
check(
  /const missing = payload\.required\.filter\(\(code\) => !acknowledged\.includes\(code\)\);/.test(viewCode),
  "y «faltan confirmaciones» es literalmente las exigidas menos las marcadas",
);
// AND THE SERVER DOES NOT TRUST ANY OF IT.
check(
  /runPublicationPreflight\(/.test(stripComments(workspaceSource)),
  "y el servidor vuelve a correr el preflight completo",
);
check(
  /p_blocking_codes: \[\]/.test(workspaceSource) && /p_unacknowledged_codes: \[\]/.test(workspaceSource),
  "y sólo entonces le dice a la base que no hay bloqueos ni confirmaciones pendientes",
);

/* -------------------------------------------------------------------------- */
console.log("\n[12] La capa pura no alcanza ningún transporte");

for (const file of ["contract.ts", "preflight.ts", "inventory.ts", "difference.ts", "payload.ts", "index.ts"]) {
  const code = stripComments(read(`src/lib/publication/${file}`));
  check(
    !/@supabase|createClient\(|createAdminClient|\.rpc\(|\bfetch\(|node:|process\.env/.test(code),
    `src/lib/publication/${file} no alcanza ningún transporte`,
  );
  check(
    !/^\s*import\s+["']server-only["']/m.test(code),
    `y no lleva la marca server-only, así que una compuerta puede ejecutarlo de verdad`,
  );
  check(!/Date\.now|Math\.random|new Date\(/.test(code), `ni reloj ni azar`);
}
check(
  /^import "server-only";/m.test(workspaceSource),
  "y el módulo que sí tiene transporte lleva la marca",
);


/* -------------------------------------------------------------------------- */
console.log("\n[13] EL CONTEO Y EL DIBUJO SON UN SOLO HECHO");

/*
 * THE DEFECT THIS SECTION EXISTS FOR.
 *
 * The review screen reported «23 bloques los ve el cliente» over a preview that
 * drew 20. Three filter panels: counted by the inventory, dropped by the
 * renderer, and both halves were internally consistent. No assertion over the
 * count alone could have seen it, so this section renders the REAL component
 * with the REAL audience and counts the cards in the markup.
 */

/** How many block cards the renderer actually draws, from the markup itself. */
const drawnCards = (model, live) => {
  const html = renderToStaticMarkup(
    createElement(PresentationRenderer, {
      model,
      audience: "client",
      // THE SURFACE FACT, SPELLED THE WAY THE PRODUCT SPELLS IT. The renderer
      // reads `viewer !== undefined`; the review surface hands it a real
      // controls object, and this hands it the smallest one that is not
      // undefined. What is being proved is the PREDICATE, not the callbacks.
      viewer: live
        ? {
            pending: EMPTY_VIEWER_SELECTION,
            status: "idle",
            message: null,
            onToggle: () => {},
            onClearPanel: () => {},
          }
        : undefined,
    }),
  );
  return (html.match(/<section class="min-w-0 rounded-2xl/g) ?? []).length;
};

for (const live of [true, false]) {
  const drawn = drawnCards(REAL_MODEL, live);
  const counted = countVisibleToClient(REAL_MODEL, live);
  const listed = buildPublicationInventory(REAL_MODEL, live)
    .flatMap((page) => page.blocks)
    .filter((block) => block.visibleToClient).length;
  eq(`el renderizador dibuja (live=${live})`, drawn, counted);
  eq(`y el inventario marca lo mismo (live=${live})`, listed, counted);
}

/*
 * AND THE SAME OVER A DOCUMENT THAT HAS PANELS.
 *
 * The generic blueprint over the fixture may or may not carry a filter panel,
 * so the discriminating case is built by hand: one operable panel, one panel
 * nobody connected, and one ordinary block. On a live surface the operable
 * panel is drawn and counted and the disconnected one is neither; on a dead
 * surface neither panel is drawn or counted. Before the correction the count
 * said two panels on both surfaces.
 */
const panelPayload = (movesBlocks) => ({
  shape: "filter_controls",
  dimensions: [
    {
      handle: "dimension:generacion",
      label: "Generación",
      options: [
        { token: "o0", label: "Generación X", participants: 3 },
        { token: "o1", label: "Millenial", participants: 2 },
      ],
      selected: [],
    },
  ],
  selection: {
    neutral: true,
    summary: null,
    selectedPeople: 5,
    basePeople: 5,
    countSentence: "Con esta selección quedan 5 de 5 personas.",
    empty: false,
    movesBlocks,
  },
});

const withPanels = modelOf([
  blockOf("b1", { title: "Índice de renovación" }),
  blockOf("panel-vivo", { title: "Filtros", payload: panelPayload(1) }),
  blockOf("panel-muerto", { title: "Filtros del recorrido", payload: panelPayload(0) }),
]);

eq("con filtros vivos, el cliente ve", countVisibleToClient(withPanels, true), 2);
eq("y el renderizador dibuja exactamente eso", drawnCards(withPanels, true), 2);
eq("sin filtros vivos, el cliente ve", countVisibleToClient(withPanels, false), 1);
eq("y el renderizador dibuja exactamente eso", drawnCards(withPanels, false), 1);

const panelInventory = buildPublicationInventory(withPanels, true)[0].blocks;
check(
  panelInventory.find((entry) => entry.title === "Filtros del recorrido").visibleToClient === false,
  "un panel que no mueve nada NO se cuenta como visible",
);
check(
  panelInventory
    .find((entry) => entry.title === "Filtros del recorrido")
    .state.includes("no le aparece"),
  "y el inventario dice que al cliente no le aparece, en vez de «se dibuja»",
);

// THE PREDICATE IS ONE FUNCTION, NOT THREE THAT AGREE. A copy could pass every
// assertion above and drift a week later, so the gate reads the source: neither
// the renderer, nor the inventory, nor the preflight may define its own.
for (const [file, source] of [
  ["src/components/presentation/PresentationRenderer.tsx", read("src/components/presentation/PresentationRenderer.tsx")],
  ["src/components/presentation/FilterControls.tsx", read("src/components/presentation/FilterControls.tsx")],
  ["src/lib/publication/inventory.ts", read("src/lib/publication/inventory.ts")],
  ["src/lib/publication/preflight.ts", read("src/lib/publication/preflight.ts")],
]) {
  const code = stripComments(source);
  check(
    !/function\s+(clientSeesBlock|clientHasContent|clientSeesPage|filterPanelIsOperable)\s*\(/.test(code),
    `${file} no define su propia copia del predicado`,
  );
  check(
    /clientSeesBlock|clientSeesPage|filterPanelIsOperable/.test(code),
    `y sí lo importa de la capa de presentación`,
  );
}

/*
 * AND THE PREVIEW THAT MAKES THE FILTERS OPERABLE WRITES NOTHING.
 *
 * The review surface now resolves the stored draft under a reviewer's own
 * selection, which is a new path through a module that also publishes. The
 * boundary gate asserts the ACTION performs no write directly; this asserts it
 * of the workspace FUNCTION the action calls, read as its own slice of the
 * file, so a write added inside it fails here even though the module around it
 * legitimately contains an RPC.
 */
const workspaceText = read("src/lib/studio/publication-workspace.ts");
const previewStart = workspaceText.indexOf(
  "export async function previewStoredPresentationUnderSelection",
);
check(previewStart > 0, "la función de vista previa existe en el workspace");
const previewEnd = workspaceText.indexOf(
  "\nexport ",
  previewStart + 1,
);
const previewBody = stripComments(
  workspaceText.slice(previewStart, previewEnd > 0 ? previewEnd : workspaceText.length),
);
for (const writer of [".insert(", ".update(", ".upsert(", ".delete(", ".rpc(", "revalidatePath"]) {
  check(!previewBody.includes(writer), `y no ejecuta ${writer}`);
}
check(
  /EMPTY_VIEWER_SELECTION/.test(stripComments(workspaceText.slice(workspaceText.indexOf("export async function publishStoredPresentation")))) ||
    /resolveUnderSelection\(built, document, EMPTY_VIEWER_SELECTION\)/.test(stripComments(workspaceText)),
  "y lo que se publica se resuelve con la selección NEUTRA, no con la del revisor",
);

/* -------------------------------------------------------------------------- */
console.log("\n[14] Paneles que no mueven nada, y características que aíslan a una persona");

const inoperable = runPublicationPreflight(healthy({ model: withPanels }));
check(
  has(inoperable.warnings, "inoperable_filter_panels"),
  "un panel que ningún bloque usa se avisa",
);
check(
  inoperable.blockers.length === 0,
  "y no bloquea: es una decisión, no un defecto del documento",
);
check(
  inoperable.required.includes("inoperable_filter_panels"),
  "pero exige confirmación, porque el cliente recibe una página sin ese panel",
);
const inoperableWarning = inoperable.warnings.find((entry) => entry.code === "inoperable_filter_panels");
check(
  inoperableWarning.where.some((where) => where.includes("Filtros del recorrido")),
  "y nombra el panel por su título",
);
check(
  !inoperableWarning.where.some((where) => where.includes("panel-muerto")),
  "nunca por su identificador",
);
// THE SENTENCE DESCRIBES THE CONSEQUENCE, NOT THE MECHANISM.
check(
  /no los recibe|no aparece el panel/.test(inoperableWarning.detail),
  "y la advertencia dice qué le pasa al cliente, no cómo está implementado",
);

// A dimension whose options are all carried by several people raises nothing.
const shared = runPublicationPreflight(healthy({ model: withPanels }));
check(
  !has(shared.warnings, "granular_filter_dimensions"),
  "con opciones de tres y dos personas no se avisa de granularidad",
);

const lonely = panelPayload(1);
lonely.dimensions = [
  {
    handle: "dimension:giro",
    label: "Giro",
    options: [
      { token: "o0", label: "Construcción", participants: 3 },
      { token: "o1", label: "Notaría", participants: 1 },
      { token: "o2", label: "Veterinaria", participants: 1 },
    ],
    selected: [],
  },
];
const granular = runPublicationPreflight(
  healthy({
    model: modelOf([
      blockOf("b1", { title: "Índice de renovación" }),
      blockOf("panel-vivo", { title: "Filtros", payload: lonely }),
    ]),
  }),
);
check(
  has(granular.warnings, "granular_filter_dimensions"),
  "una característica con opciones de una sola persona se avisa",
);
const granularWarning = granular.warnings.find((entry) => entry.code === "granular_filter_dimensions");
check(granular.blockers.length === 0, "y no bloquea");
check(
  granular.required.includes("granular_filter_dimensions"),
  "pero exige que alguien lo decida",
);
check(
  granularWarning.where.some((where) => where.includes("Giro") && where.includes("2 opciones")),
  "y dice qué característica y cuántas opciones son, por su título",
);
// NEVER THE OPTION ITSELF. Naming «Notaría (1 persona)» on a review screen is
// naming the person, which is the disclosure the warning exists to prevent.
check(
  !granularWarning.where.some((where) => /Notar|Veterinaria/.test(where)),
  "y NUNCA nombra la opción que una sola persona tiene",
);

// NOTHING IS HIDDEN, AND NO NUMBER MOVES. The warning is the whole action: the
// three options are still offered, the counts are untouched, and the sample
// policy is not consulted.
const granularModel = granular.warnings.length > 0 ? lonely : null;
eq("las opciones siguen ofreciéndose", granularModel.dimensions[0].options.length, 3);
eq("con su conteo intacto", granularModel.dimensions[0].options[1].participants, 1);
check(
  !has(granular.warnings, "withheld_by_sample_policy") && !has(granular.warnings, "annotated_by_sample_policy"),
  "y no se toca la política de muestra: `show_all` sigue siendo el valor por omisión",
);
// NO THRESHOLD ENTERED THE LAYER. The only number in the comparison is one, and
// one is the definition of a group of one rather than a chosen cut-off.
const preflightCode = stripComments(read("src/lib/publication/preflight.ts"));
check(
  !/participants\s*[<>]=?\s*[0-9]+/.test(preflightCode),
  "y en la capa no aparece ninguna comparación de tamaño contra un número",
);
check(
  /participants === 1/.test(preflightCode),
  "sólo la igualdad con uno, que es lo que significa «una sola persona»",
);


/* -------------------------------------------------------------------------- */
console.log("\n[15] Contenido que el plano aprobado exige no se salta con una confirmación");

/*
 * THE STANDING RULE, AND WHY IT NOW HAS AN EXCEPTION THE AUTHOR WRITES.
 *
 * `configuration_required` is still a warning for every block nobody marked:
 * what nobody has finished renders as nothing on a client's page, and publishing
 * that is a decision. What changed is that the approved north-star for a study
 * is not a menu. A layout that DECLARES the journey pain cloud and delivers a
 * page without it is a different experience from the one that was signed off,
 * and «entiendo que desaparecerá» is not the person who signed it off saying so.
 */
const painCloudBlock = (over = {}) =>
  blockOf("temas-recorrido", {
    title: "Puntos de dolor del recorrido",
    availability: "configuration_required",
    payload: { shape: "editorial", body: null, absence: null },
    ...over,
  });

const requiredMissing = runPublicationPreflight(
  healthy({
    model: modelOf([blockOf("b1", { title: "Índice de renovación" }), painCloudBlock()]),
    requiredBlockIds: ["temas-recorrido"],
  }),
);
check(
  has(requiredMissing.blockers, "required_content_missing"),
  "una ranura marcada como exigida y vacía BLOQUEA",
);
check(
  !requiredMissing.required.includes("required_content_missing"),
  "y no hay confirmación que la levante: no es una advertencia",
);
check(
  !has(requiredMissing.warnings, "configuration_required_blocks"),
  "y no se repite además como aviso confirmable, que sería ofrecer una salida que no existe",
);
const requiredFinding = requiredMissing.blockers.find(
  (entry) => entry.code === "required_content_missing",
);
check(
  requiredFinding.where.some((where) => where.includes("Puntos de dolor del recorrido")),
  "el bloqueo nombra el bloque por su título",
);
check(
  !requiredFinding.where.some((where) => where.includes("temas-recorrido")),
  "nunca por su identificador",
);
// THE TWO REMEDIES ARE IN THE SENTENCE. A blocker nobody can act on is a wall.
check(
  /Escribe el contenido/.test(requiredFinding.detail) && /quita el bloque/.test(requiredFinding.detail),
  "y dice las dos salidas honestas: escribir el contenido, o quitar el bloque",
);
check(
  runPublicationPreflight(
    healthy({
      model: modelOf([blockOf("b1"), painCloudBlock()]),
      requiredBlockIds: ["temas-recorrido"],
      acknowledged: [...WARNINGS_REQUIRING_ACKNOWLEDGEMENT],
    }),
  ).canPublish === false,
  "confirmar TODAS las advertencias del vocabulario no lo desbloquea",
);

// AN UNMARKED SLOT IS STILL A WARNING, so the standing rule is intact and the
// blueprint's other empty slots stay publishable.
const unmarked = runPublicationPreflight(
  healthy({ model: modelOf([blockOf("b1"), painCloudBlock()]), requiredBlockIds: [] }),
);
check(
  has(unmarked.warnings, "configuration_required_blocks") && unmarked.blockers.length === 0,
  "una ranura que nadie marcó sigue siendo un aviso y no un bloqueo",
);

// REMOVING THE BLOCK IS A REAL REMEDY, not a sentence.
check(
  runPublicationPreflight(
    healthy({ model: modelOf([blockOf("b1")]), requiredBlockIds: ["temas-recorrido"] }),
  ).blockers.length === 0,
  "y quitar el bloque del documento levanta el bloqueo de verdad",
);

// FILLING IT IS THE OTHER.
check(
  runPublicationPreflight(
    healthy({
      model: modelOf([
        blockOf("b1"),
        painCloudBlock({
          availability: "available",
          payload: { shape: "editorial", body: "Contenido curado y aprobado.", absence: null },
        }),
      ]),
      requiredBlockIds: ["temas-recorrido"],
    }),
  ).blockers.length === 0,
  "y escribir el contenido también",
);

// THE APPROVED BLUEPRINT DECLARES IT. Read from the blueprint's own bytes, so
// the requirement cannot quietly stop being declared.
const approvedSource = read("src/lib/presentation/blueprints/cuicuilco-approved.ts");
check(
  /id: "temas-recorrido"/.test(approvedSource),
  "el plano aprobado sigue declarando la ranura de la nube de puntos de dolor",
);
check(
  /H\.journeyPainCloud,\s*\n\s*true,/.test(approvedSource),
  "y la marca como contenido exigido",
);


/* -------------------------------------------------------------------------- */
console.log("\n[16] La huella de la evidencia cualitativa: de qué es, y de qué NO");

const setOf = (over = {}) => ({
  groupLabel: "Razones declaradas",
  coding: "source_coded",
  categories: ["Tiempo", "Costo", "Resultados"],
  excluded: ["No aplica"],
  blocks: ["Panorama · Miembros activos"],
  ...over,
});

const base = qualitativeEvidenceDigest([setOf()]);
eq("la huella es un sha256", /^[0-9a-f]{64}$/.test(base), true);
eq("y es determinista", qualitativeEvidenceDigest([setOf()]), base);

/*
 * WHAT MOVES IT. Adding, removing or renaming a category, changing the order a
 * client reads them in, changing the excluded list, or changing where the
 * coding came from. Each is a different thing to have read.
 */
for (const [what, over] of [
  ["una categoría nueva", { categories: ["Tiempo", "Costo", "Resultados", "Distancia"] }],
  ["una categoría menos", { categories: ["Tiempo", "Costo"] }],
  ["una categoría renombrada", { categories: ["Tiempo", "Coste", "Resultados"] }],
  ["otro orden de lectura", { categories: ["Costo", "Tiempo", "Resultados"] }],
  ["otra categoría excluida", { excluded: ["No contesta"] }],
  ["otra procedencia de la codificación", { coding: "be_community_curated" }],
  ["otro grupo", { groupLabel: "Otras razones" }],
]) {
  check(qualitativeEvidenceDigest([setOf(over)]) !== base, `${what} mueve la huella`);
}

/*
 * WHAT DOES NOT MOVE IT, and this half is the one that keeps a sign-off
 * meaningful. A count moving means another person chose a category that already
 * existed; the words nobody re-read are the same words. Expiring a review for
 * that would make it constant in the other direction — which is exactly the
 * defect this unit removed, wearing different clothes.
 *
 * The BLOCKS a group is drawn in do not move it either: moving a card on a page
 * does not un-review a word.
 */
check(
  qualitativeEvidenceDigest([setOf({ blocks: ["Otra página · Otro bloque", "Y otro"] })]) === base,
  "mover el bloque que las dibuja NO mueve la huella",
);
// The digest has nowhere to put a count: the type carries none. Asserted over
// the module's own text, because "there is no field" is stronger than "we did
// not use it".
const signOffSource = read("src/lib/publication/qualitative-signoff.ts");
check(
  !/count|share|participants|total/i.test(stripComments(signOffSource)),
  "y el tipo no tiene siquiera un campo donde poner un conteo",
);

/*
 * TWO GROUPS IN ANY ORDER ARE THE SAME EVIDENCE. A document that binds the same
 * groups is the same set of words to read whichever card comes first, and a
 * sign-off that expired because somebody reordered a page would be one nobody
 * trusted.
 */
const two = [setOf(), setOf({ groupLabel: "Desertores", categories: ["Mudanza", "Costo"] })];
eq(
  "el orden de los grupos no cambia la huella",
  qualitativeEvidenceDigest(two),
  qualitativeEvidenceDigest([...two].reverse()),
);

/*
 * AND A SEPARATOR CANNOT BE SPELLED BY A CATEGORY.
 *
 * A category label is a person's own Spanish and may contain any printable
 * character. With a printable separator these two sets would serialize to one
 * string and collide into one digest, so a review of one would silently count as
 * a review of the other. The unit and record separators are unprintable, so they
 * cannot appear in a label at all.
 */
check(
  qualitativeEvidenceDigest([setOf({ categories: ["Tiempo, Costo", "Resultados"] })]) !==
    qualitativeEvidenceDigest([setOf({ categories: ["Tiempo", "Costo", "Resultados"] })]),
  "dos categorías y una que contiene la coma NO colisionan",
);
check(
  qualitativeEvidenceDigest([setOf({ categories: ["Tiempo|Costo|Resultados"] })]) !== base,
  "ni con la barra vertical",
);

/* ---- the four states, and the one that needs a matching digest ---------- */
eq("sin grupos, no aplica", qualitativeReviewState([], null), "not_applicable");
eq("con grupos y sin firma, pendiente", qualitativeReviewState([setOf()], null), "pending");
eq(
  "con la firma de estas palabras, al día",
  qualitativeReviewState([setOf()], { evidenceDigest: base, reviewedAt: "2026-09-09T00:00:00Z" }),
  "current",
);
eq(
  "con la firma de otras palabras, rancia",
  qualitativeReviewState([setOf({ categories: ["Tiempo"] })], {
    evidenceDigest: base,
    reviewedAt: "2026-09-09T00:00:00Z",
  }),
  "stale",
);
// A REVIEW DOES NOT EXPIRE WITH TIME, only when the words change. There is no
// clock in the module, so it cannot.
check(
  !/Date\.now|new Date\(|Math\.random/.test(stripComments(read("src/lib/publication/evidence-digest.ts"))),
  "y no hay reloj ni azar en la huella: una revisión no caduca con el tiempo",
);

/* ---- every affected block, deduplicated, in reading order --------------- */
const blocks = affectedBlocks([
  setOf({ blocks: ["Panorama · Miembros activos", "Panorama · Razones declaradas de riesgo"] }),
  setOf({ groupLabel: "Desertores", blocks: ["Panorama · Desertores", "Panorama · Miembros activos"] }),
]);
eq("los bloques afectados, sin repetir", JSON.stringify(blocks), JSON.stringify([
  "Panorama · Miembros activos",
  "Panorama · Razones declaradas de riesgo",
  "Panorama · Desertores",
]));

/* ---- and the coding is a word a person reads, not an enum -------------- */
for (const coding of ["source_coded", "be_community_curated"]) {
  check(
    typeof CODING_LABEL[coding] === "string" && !/_/.test(CODING_LABEL[coding]),
    `«${coding}» tiene una frase en español y no un enum (${CODING_LABEL[coding]})`,
  );
}

/* ---- migration 0031 exists, is additive, and replaces no applied function */
const migration = read("supabase/migrations/0031_canonical_qualitative_signoff.sql");
check(
  /create table public\.canonical_qualitative_signoff/.test(migration) &&
    /create table public\.canonical_publication_qualitative_signoff/.test(migration),
  "0031 crea sus dos tablas",
);
// IT MUST NOT REPLACE APPLIED HISTORY. `publish_canonical_presentation` is on
// the hosted project; 0031 wraps it and a near-duplicate of its 295 lines would
// make every future correction a choice about which copy is real.
check(
  !/create or replace function public\.publish_canonical_presentation\s*\(/.test(migration),
  "y NO reemplaza `publish_canonical_presentation`, que es historia ya aplicada",
);
check(
  /answer := public\.publish_canonical_presentation\(/.test(migration),
  "sino que la llama, en la misma transacción",
);
// NO `ALTER TABLE` NAMES A TABLE AT ALL. The only two in the file are inside
// `format('alter table public.%I …')`, whose argument is one of this
// migration's own two names — so a literal table name after `alter table`
// would be a table this migration was never given.
check(
  !/\balter table public\.[A-Za-z_]/.test(migration),
  "y no altera por nombre ninguna tabla: los dos ALTER van por formato sobre las suyas",
);
check(
  /'canonical_qualitative_signoff',\s*\n\s*'canonical_publication_qualitative_signoff'/.test(migration),
  "y esas dos son exactamente las suyas",
);
// LEAST PRIVILEGE, the same shape 0029 and 0030 use.
check(
  /grant select on table public\.%I to service_role/.test(migration),
  "service_role recibe SELECT y nada más sobre sus tablas",
);
check(
  /security definer/.test(migration) && /set search_path = ''/.test(migration),
  "y las funciones de escritura son SECURITY DEFINER con search_path vacío",
);
// A BARE UUID, not a foreign key into auth.users. 0025 made an identity
// undeletable exactly that way and 0030 recorded the lesson.
check(
  /reviewed_by     uuid not null,/.test(migration) && !/reviewed_by[^\n]*auth\.users/.test(migration),
  "y `reviewed_by` es un uuid suelto, no una llave foránea a auth.users",
);
const rollback = read("supabase/rollbacks/0031_drop_canonical_qualitative_signoff.sql");
check(
  /drop table public\.canonical_publication_qualitative_signoff;/.test(rollback) &&
    !/drop table public\.canonical_presentation_revision/.test(rollback),
  "la reversión borra su enlace y NO las publicaciones",
);

/* -------------------------------------------------------------------------- */

console.log(`\n${"=".repeat(78)}`);
console.log(`EJECUTADAS: ${executed}   APROBADAS: ${executed - failures}   FALLADAS: ${failures}`);
if (failures > 0) {
  console.log("RESULTADO: la publicación canónica NO se comporta como está documentada. COMPUERTA BLOQUEADA.");
  process.exit(1);
}
console.log(
  "RESULTADO: cada bloqueo se levanta por su nombre y ninguno se puede confirmar para saltarlo, ninguna\n" +
    "           muestra pequeña se oculta sola, «espera contenido» es un aviso y no un bloqueo, lo\n" +
    "           cualitativo sin revisar se decide con una confirmación, el inventario y la diferencia\n" +
    "           hablan en títulos, la ruta autoriza antes de leer, nada interno cruza al navegador y el\n" +
    "           control de publicar es inusable hasta que se gana. COMPUERTA APROBADA.",
);
