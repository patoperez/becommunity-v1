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

import { buildPresentationRead, resolveUnderSelection } from "../src/lib/viewer/index.ts";
import { bindPresentationDocument } from "../src/lib/presentation/registry.ts";
import { validatePresentationDocument } from "../src/lib/presentation/document.ts";
import { EMPTY_VIEWER_SELECTION } from "../src/lib/presentation/viewer.ts";
import { buildGenericStartingBlueprint } from "../src/lib/presentation/blueprints/generic-starting.ts";
import { JOURNEY_ROUTES_VARIANTS, offeredChartVariants } from "../src/lib/composer/renderer-capabilities.ts";
import { serializeDeterministic } from "../src/lib/presentation/serialize.ts";
import { runPublicationPreflight } from "../src/lib/publication/preflight.ts";
import {
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

/** A subject that passes every stage, so a single field can be varied at a time. */
const healthy = (over = {}) => ({
  authorized: true,
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
  model: REAL_MODEL,
  reproducible: true,
  current: identity,
  authored: {
    registryVersion: identity.registryVersion,
    bindingFingerprint: identity.bindingFingerprint,
  },
  lastPublished: null,
  qualitative: [],
  expectedActiveVersion: null,
  actualActiveVersion: null,
  structureChanged: false,
  acknowledged: [],
  ...over,
});

const codes = (findings) => findings.map((entry) => entry.code).sort();
const has = (findings, code) => findings.some((entry) => entry.code === code);

/** A hand-built block, so one outcome at a time can be produced exactly. */
const blockOf = (id, over = {}) => ({
  id,
  semantic: null,
  chartVariant: null,
  copy: { title: over.title ?? `Bloque ${id}`, description: null, annotation: null },
  placement: { order: 0, span: { desktop: 12, tablet: 12, mobile: 12 }, responsive: "reflow" },
  visible: over.visible ?? true,
  availability: over.availability ?? "available",
  provenance: null,
  payload: over.payload ?? { shape: "value", value: null, absence: null },
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
  BLOCKER_CODES.length === 18,
  `los 18 códigos de bloqueo están ejercidos, cada uno por su condición (${BLOCKER_CODES.length})`,
);
check(DECLARED_BLOCKERS.length > 0, "y el contrato los declara como literales cerrados");

/* -------------------------------------------------------------------------- */
console.log("\n[3] Un aviso es un aviso, y sólo cuatro exigen confirmación");

eq(
  "advertencias que exigen confirmación, declaradas",
  JSON.stringify([...WARNINGS_REQUIRING_ACKNOWLEDGEMENT].sort()),
  JSON.stringify(
    ["configuration_required_blocks", "nothing_visible", "qualitative_review_pending", "withheld_by_sample_policy"],
  ),
);
for (const code of WARNINGS_REQUIRING_ACKNOWLEDGEMENT) {
  check(warningRequiresAcknowledgement(code), `«${code}» exige confirmación`);
}
for (const code of ["annotated_by_sample_policy", "unavailable_blocks", "hidden_blocks", "first_publication", "structure_changed", "evidence_changed_since_publication"]) {
  check(!warningRequiresAcknowledgement(code), `«${code}» NO exige confirmación`);
}

const unavailable = runPublicationPreflight(
  healthy({ model: modelOf([blockOf("b1", { availability: "unavailable" })]) }),
);
check(has(unavailable.warnings, "unavailable_blocks"), "una medición que el estudio no tiene es un aviso");
check(!has(unavailable.blockers, "block_unresolved"), "y no se confunde con una pregunta abierta");
check(
  unavailable.canPublish === false,
  "aunque con un solo bloque invisible el documento no muestra nada y hay que confirmarlo",
);
check(has(unavailable.warnings, "nothing_visible"), "que es exactamente la advertencia «nada visible»");

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
const realPreflight = runPublicationPreflight(healthy());
check(
  !has(realPreflight.warnings, "withheld_by_sample_policy"),
  "sobre el modelo real, con bases mínimas, no se reserva nada por muestra",
);
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

const pending = runPublicationPreflight(
  healthy({ qualitative: [{ label: "Razones declaradas", reviewStatus: "pending" }] }),
);
check(has(pending.warnings, "qualitative_review_pending"), "una categoría sin revisar es un aviso");
check(pending.required.includes("qualitative_review_pending"), "que exige confirmación");
check(
  pending.warnings.find((entry) => entry.code === "qualitative_review_pending")?.where.includes("Razones declaradas"),
  "y nombra el grupo por su etiqueta, nunca por su handle",
);
const confirmed = runPublicationPreflight(
  healthy({ qualitative: [{ label: "Razones declaradas", reviewStatus: "confirmed" }] }),
);
check(!has(confirmed.warnings, "qualitative_review_pending"), "una revisada no dice nada");
const mixed = runPublicationPreflight(
  healthy({ qualitative: [{ label: "Mezcla", reviewStatus: "mixed" }] }),
);
check(has(mixed.warnings, "qualitative_review_pending"), "una mezclada sí, porque lleva material sin revisar");

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

const inventory = buildPublicationInventory(REAL_MODEL);
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

eq("bloques que el cliente vería, en el modelo real", countVisibleToClient(REAL_MODEL) > 0, true);

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

// THE ONLY THREE RPCs THIS ROUTE MAY NAME.
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
    JSON.stringify(["publish_canonical_presentation", "read_canonical_publication", "restore_canonical_presentation"]),
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
