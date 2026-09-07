// =============================================================================
// MANDATORY canonical composer gate — Unit 6B.1
//   npx tsx scripts/canonical-composer-test.mjs
// =============================================================================
// Unit 6A built the binding layer. Unit 6B.1 builds the two things that sit on
// it: a PURE EDITOR over a `PresentationDocument`, and a RENDER-ONLY component
// library over a `PresentationRenderModel`. This gate proves the editor half
// entirely from a small synthetic fixture, and proves the boundary properties
// that make the other half safe to ship.
//
//   A REFUSAL CHANGES NOTHING. Every refusal in this file is asserted twice:
//   once for its code, and once for the fact that the document, the history,
//   the sequence and the selection all came back REFERENCE-identical. An
//   editor that half-applies a rejected edit is worse than one that crashes,
//   because the author cannot see it happen.
//
//   IDS ARE DETERMINISTIC AND FREE. The same act on the same document mints the
//   same id, twice, in two separately-opened sessions — and never one the
//   document already holds. The legacy builder's collision defect made every
//   subsequent save fail for ever; this is the assertion that it cannot return.
//
//   UNDO IS EXACT. Not "close enough": after N edits and N undos the document
//   is byte-identical, through `serializeDeterministic`, to the one the session
//   opened with. Redo returns the same way.
//
//   A CONNECTION IS SOMETHING SOMEBODY WROTE. Sharing a dimension is never a
//   connection. A duplicate answers to nothing. Removing a panel removes every
//   reference to it. An authority-forbidden cross and an unsupported dimension
//   refuse under their OWN codes, because they are different problems.
//
//   THE EDITOR OFFERS ONLY WHAT CAN BE DRAWN. Semantic compatibility and
//   renderer coverage are two different tables and the editor offers the
//   intersection. A variant that is honest but unimplemented is refused by
//   name, never silently substituted.
//
//   SMALL SAMPLES ARE SHOWN. `show_all` is the default and no operation in the
//   engine can produce a suppressing policy without an author and a reason.
//
// No client workbook, name, answer, quote or identifier is committed here.
// =============================================================================

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { composerFixtureResults } from "./lib/composer-fixture.mjs";
// A gate imports the PURE implementation modules, never `./server`: that file
// carries `import "server-only"`, which throws under a plain Node import by
// design. Section [16] proves production code cannot take the shortcut.
import {
  bindPresentationDocument,
  buildCanonicalPresentationRegistry,
  projectPresentationCatalog,
} from "../src/lib/presentation/registry.ts";
import { resolvePresentation } from "../src/lib/presentation/resolve.ts";
import { PresentationRenderer } from "../src/components/presentation/PresentationRenderer.tsx";
import { RENDERED_VARIANTS } from "../src/components/presentation/renderers.tsx";
import { AbsenceNotice } from "../src/components/presentation/absence.tsx";
import { COMPATIBLE_CHART_VARIANTS } from "../src/lib/presentation/capabilities.ts";
import {
  DEFAULT_SAMPLE_POLICY,
  GRID_COLUMNS,
  PRESENTATION_DOCUMENT_KIND,
  PRESENTATION_DOCUMENT_SCHEMA_VERSION,
  validatePresentationDocument,
} from "../src/lib/presentation/document.ts";
import { serializeDeterministic } from "../src/lib/presentation/serialize.ts";
import {
  COMPOSER_HISTORY_DEPTH,
  COMPOSER_LIMITS,
  IMPLEMENTED_CHART_VARIANTS,
  addBlock,
  addPage,
  chartVariantIsImplemented,
  composerId,
  connectBlockToPanel,
  connectionCandidates,
  disconnectBlockFromPanel,
  duplicateBlock,
  duplicatePage,
  findBlock,
  findPage,
  judgeChartVariant,
  mintFreeComposerId,
  moveBlock,
  moveBlockToIndex,
  movePage,
  movePageToIndex,
  offeredChartVariants,
  openComposer,
  openPage,
  redo,
  removeBlock,
  removePage,
  renamePage,
  selectBlock,
  setBlockBinding,
  setBlockCopy,
  setBlockDisclosure,
  setBlockDisplayFormat,
  setBlockResponsive,
  setBlockSamplePolicy,
  setBlockSpan,
  setBlockVisibility,
  setChartVariant,
  setDocumentDisclosure,
  setDocumentSamplePolicy,
  setEditorialBody,
  takenComposerIds,
  togglePanelDimension,
  undo,
} from "../src/lib/composer/index.ts";

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
const stripComments = (code) => code.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");

/** Which operations this run actually drove. Section [15] insists on all of them. */
const exercised = new Set();
const drive = (name, run) => {
  exercised.add(name);
  return run();
};

/**
 * Assert a refusal happened, happened for the intended reason, AND left every
 * part of the state alone.
 *
 * The identity comparisons are deliberate: an equal-but-new document would pass
 * a deep comparison and still mean the engine had rebuilt the document on a
 * path that was supposed to do nothing. Identity is the stronger claim and the
 * one the engine actually promises.
 */
const refuses = (label, before, after, expectedCode) => {
  const code = after.refusal?.code ?? "(ninguno)";
  if (code !== expectedCode) {
    bad(`${label}: se esperaba ${expectedCode}, se obtuvo ${code}`);
    return;
  }
  const intact =
    after.document === before.document &&
    after.past === before.past &&
    after.future === before.future &&
    after.sequence === before.sequence &&
    after.openPageId === before.openPageId &&
    after.selectedBlockId === before.selectedBlockId;
  if (!intact) {
    bad(`${label} → ${expectedCode}, pero el estado cambió`);
    return;
  }
  const message = after.refusal?.message ?? "";
  if (message.trim().length === 0) {
    bad(`${label} → ${expectedCode}, pero sin frase para una persona`);
    return;
  }
  ok(`${label} → ${expectedCode}, y nada cambió`);
};

/** Every operation must leave a document the strict schema still accepts. */
const stillValid = (label, state) => {
  const outcome = validatePresentationDocument(JSON.parse(serializeDeterministic(state.document)));
  if (outcome.ok) ok(`${label}: el documento sigue siendo válido`);
  else bad(`${label}: el documento dejó de ser válido — ${outcome.errors.map((e) => e.code).join(", ")}`);
};

console.log("Be Community — compuerta del compositor canónico (Unidad 6B.1)");
console.log("=".repeat(74));

/* -------------------------------------------------------------------------- */
/* the fixture                                                                 */
/* -------------------------------------------------------------------------- */

const results = composerFixtureResults();
const registry = buildCanonicalPresentationRegistry(results);
const catalog = projectPresentationCatalog(registry);
const context = { catalog };

const entryFor = (handle) => catalog.entries.find((entry) => entry.handle === handle);
const firstOf = (semantic) => catalog.entries.find((entry) => entry.semantic === semantic);

const NPS = firstOf("recommendation_score");
const DISTRIBUTION = firstOf("recommendation_distribution");
const RENEWAL = catalog.entries.find((entry) => entry.semantic === "renewal_index");
const GROUP = firstOf("journey_group");
const SLOT = firstOf("editorial_slot");
const TERMS = firstOf("qualitative_terms");
const DIM_ESFERA = catalog.entries.find(
  (entry) => entry.semantic === "filter_dimension" && RENEWAL?.forbiddenFilters.includes(entry.handle),
);
const DIM_OPEN = catalog.entries.find(
  (entry) =>
    entry.semantic === "filter_dimension" &&
    RENEWAL?.supportedFilters.includes(entry.handle) &&
    NPS?.supportedFilters.includes(entry.handle),
);

console.log("\n[1] El catálogo sintético trae una de cada cosa que un editor debe razonar");
check(catalog.entries.length > 20, `el catálogo publica ${catalog.entries.length} entradas`);
check(Boolean(NPS && DISTRIBUTION && RENEWAL && GROUP && SLOT && TERMS), "hay recomendación, distribución, renovación, grupo, espacio editorial y términos");
check(Boolean(DIM_ESFERA), "una dimensión que una autoridad prohíbe cruzar con la renovación");
check(Boolean(DIM_OPEN), "y otra que tanto la renovación como la recomendación sí admiten");
check(
  DIM_ESFERA !== undefined && !RENEWAL.supportedFilters.includes(DIM_ESFERA.handle),
  "la prohibida no aparece además como admitida — si no, las dos negativas serían indistinguibles",
);

/* -------------------------------------------------------------------------- */

console.log("\n[2] Los identificadores son deterministas, opacos y libres");
const idOnce = composerId("block", "pagina/block/added/3");
const idTwice = composerId("block", "pagina/block/added/3");
eq("el mismo acto sobre el mismo documento da el mismo id", idOnce, idTwice);
check(idOnce !== composerId("block", "pagina/block/added/4"), "y un acto distinto da otro");
check(/^bk_[a-z0-9]{21}$/.test(idOnce), `el id lleva su especie por delante: ${idOnce}`);
check(/^[a-z0-9][a-z0-9_-]*$/.test(idOnce) && idOnce.length <= 64, "y cabe en la gramática que el esquema exige");
check(
  composerId("page", "x") !== composerId("block", "x"),
  "la misma semilla en dos especies no colisiona",
);
// The label is never an input. Deriving an id from a title is how renaming a
// block silently repoints every connection that named it.
check(
  composerId("block", "Panorama del estudio") !== composerId("block", "Panorama del estudio ") &&
    !composerId("block", "Panorama del estudio").includes("panorama"),
  "un id es un hash, nunca un slug del título",
);
const crowded = new Set([idOnce]);
const dodged = mintFreeComposerId("block", "pagina/block/added/3", crowded);
check(dodged !== idOnce, "un id ya ocupado se vuelve a salar en vez de repetirse");
eq("y el resalado también es determinista", dodged, mintFreeComposerId("block", "pagina/block/added/3", new Set([idOnce])));
// No clock, no entropy: the same source read twice must contain neither.
const idSource = stripComments(readFileSync(join("src", "lib", "composer", "ids.ts"), "utf8"));
check(!/Date\.now|Math\.random|randomUUID|performance\.now/.test(idSource), "el minteo no consulta ningún reloj ni ninguna entropía");

/* -------------------------------------------------------------------------- */

console.log("\n[3] Una sesión se abre sobre un documento y no toca nada");
const seed = {
  schemaVersion: PRESENTATION_DOCUMENT_SCHEMA_VERSION,
  documentKind: PRESENTATION_DOCUMENT_KIND,
  registryVersion: registry.registryVersion,
  binding: null,
  id: "compositor-fixture",
  title: "Presentación de prueba",
  locale: "es-MX",
  samplePolicy: DEFAULT_SAMPLE_POLICY,
  methodologyDisclosure: "plain_language_with_base",
  pages: [{ id: "pagina-uno", title: "Página uno", order: 0, blocks: [] }],
};
const seedValid = validatePresentationDocument(seed);
check(seedValid.ok, "el documento semilla es válido");
const session0 = openComposer(seedValid.ok ? seedValid.value : seed);
eq("la primera página queda abierta", session0.openPageId, "pagina-uno");
eq("nada queda seleccionado", session0.selectedBlockId, null);
eq("el historial empieza vacío", session0.past.length, 0);
eq("y sin nada que rehacer", session0.future.length, 0);
eq("la política de muestra por omisión es mostrarlo todo", session0.document.samplePolicy.mode, "show_all");

/* -------------------------------------------------------------------------- */

console.log("\n[4] Páginas: añadir, abrir, renombrar, reordenar, duplicar y quitar");
let s = session0;
s = drive("addPage", () => addPage(s, "Página dos"));
eq("añadir una página la deja abierta", s.openPageId !== null && s.openPageId !== "pagina-uno", true);
eq("y el documento tiene dos", s.document.pages.length, 2);
eq("el historial guardó un paso", s.past.length, 1);
const PAGE_TWO = s.openPageId;
stillValid("addPage", s);

refuses("añadir una página sin nombre", s, drive("addPage/empty", () => addPage(s, "   ")), "page_title_empty");
refuses("renombrar una página que no existe", s, renamePage(s, "no-existe", "X"), "page_not_found");
refuses("abrir una página que no existe", s, drive("openPage/missing", () => openPage(s, "no-existe")), "page_not_found");

s = drive("renamePage", () => renamePage(s, PAGE_TWO, "Segunda página"));
eq("renombrar cambia el título", findPage(s.document, PAGE_TWO).title, "Segunda página");

const beforeOpen = s;
s = drive("openPage", () => openPage(s, "pagina-uno"));
eq("abrir una página no gasta un paso de historial", s.past.length, beforeOpen.past.length);
eq("y deselecciona", s.selectedBlockId, null);

refuses("subir la primera página", s, drive("movePage/refuse", () => movePage(s, "pagina-uno", -1)), "already_first");
refuses("bajar la última página", s, movePage(s, PAGE_TWO, 1), "already_last");
s = drive("movePage", () => movePage(s, PAGE_TWO, -1));
eq("bajar una página la mueve", s.document.pages[0].id, PAGE_TWO);
eq("y el orden se vuelve a derivar de la posición", s.document.pages[0].order, 0);
eq("para la otra también", s.document.pages[1].order, 1);
s = drive("movePageToIndex", () => movePageToIndex(s, PAGE_TWO, 1));
eq("arrastrar una página a un índice la mueve", s.document.pages[1].id, PAGE_TWO);
stillValid("movePage", s);

/* -------------------------------------------------------------------------- */

console.log("\n[5] Bloques: añadir desde el catálogo, seleccionar, reordenar, duplicar, ocultar y quitar");
s = drive("addBlock/result", () => addBlock(s, context, "pagina-uno", { kind: "result", binding: NPS.handle }));
const BLOCK_NPS = s.selectedBlockId;
check(BLOCK_NPS !== null, "añadir un bloque lo deja seleccionado");
eq("y lo pone en la página pedida", findBlock(s.document, BLOCK_NPS).page.id, "pagina-uno");
eq("con el título que el catálogo ya mostraba", findBlock(s.document, BLOCK_NPS).block.copy.title, NPS.label);
eq("visible por omisión", findBlock(s.document, BLOCK_NPS).block.visible, true);
eq("sin política de muestra propia — hereda la del documento", findBlock(s.document, BLOCK_NPS).block.samplePolicy, null);
eq("y sin ninguna conexión de filtro", findBlock(s.document, BLOCK_NPS).block.connectedFilterPanelIds.length, 0);
stillValid("addBlock", s);

refuses(
  "añadir un bloque enlazado a algo que no está en el catálogo",
  s,
  addBlock(s, context, "pagina-uno", { kind: "result", binding: "value:no-existe" }),
  "unknown_handle",
);
refuses(
  "añadir un bloque a una página que no existe",
  s,
  addBlock(s, context, "no-existe", { kind: "result", binding: NPS.handle }),
  "page_not_found",
);

s = drive("addBlock/editorial", () => addBlock(s, context, "pagina-uno", { kind: "editorial", slot: SLOT.handle }));
const BLOCK_EDITORIAL = s.selectedBlockId;
s = drive("addBlock/panel", () => addBlock(s, context, "pagina-uno", { kind: "filter_panel" }));
const PANEL = s.selectedBlockId;
s = drive("addBlock/routes", () => addBlock(s, context, "pagina-uno", { kind: "journey_routes", binding: GROUP.handle }));
const BLOCK_ROUTES = s.selectedBlockId;
eq("la página lleva cuatro bloques", findPage(s.document, "pagina-uno").blocks.length, 4);
eq("y sus órdenes son 0..3", findPage(s.document, "pagina-uno").blocks.map((b) => b.placement.order).join(","), "0,1,2,3");

refuses("seleccionar un bloque que no existe", s, drive("selectBlock/missing", () => selectBlock(s, "no-existe")), "block_not_found");
const beforeSelect = s;
s = drive("selectBlock", () => selectBlock(s, BLOCK_NPS));
eq("seleccionar no gasta historial", s.past.length, beforeSelect.past.length);
eq("y abre la página donde vive el bloque", s.openPageId, "pagina-uno");

refuses("subir el primer bloque", s, drive("moveBlock/refuse", () => moveBlock(s, BLOCK_NPS, -1)), "already_first");
refuses("bajar el último bloque", s, moveBlock(s, BLOCK_ROUTES, 1), "already_last");
s = drive("moveBlock", () => moveBlock(s, BLOCK_NPS, 1));
eq("bajar un bloque lo mueve", findPage(s.document, "pagina-uno").blocks[1].id, BLOCK_NPS);
eq("y el orden se vuelve a derivar", findPage(s.document, "pagina-uno").blocks[1].placement.order, 1);
s = drive("moveBlockToIndex", () => moveBlockToIndex(s, BLOCK_NPS, 0));
eq("arrastrarlo al principio lo devuelve", findPage(s.document, "pagina-uno").blocks[0].id, BLOCK_NPS);

s = drive("setBlockVisibility", () => setBlockVisibility(s, BLOCK_EDITORIAL, false));
eq("ocultar usa el campo de visibilidad que ya existe", findBlock(s.document, BLOCK_EDITORIAL).block.visible, false);
s = setBlockVisibility(s, BLOCK_EDITORIAL, true);
eq("y volver a mostrarlo lo devuelve", findBlock(s.document, BLOCK_EDITORIAL).block.visible, true);
stillValid("visibilidad", s);

/* -------------------------------------------------------------------------- */

console.log("\n[6] Texto de autor y cuerpo editorial");
s = drive("setBlockCopy", () => setBlockCopy(s, BLOCK_NPS, "title", "Recomendación de los miembros"));
eq("el título se edita", findBlock(s.document, BLOCK_NPS).block.copy.title, "Recomendación de los miembros");
s = setBlockCopy(s, BLOCK_NPS, "description", "Cómo leer esta cifra.");
eq("la descripción también", findBlock(s.document, BLOCK_NPS).block.copy.description, "Cómo leer esta cifra.");
s = setBlockCopy(s, BLOCK_NPS, "annotation", null);
eq("y una anotación puede quitarse", findBlock(s.document, BLOCK_NPS).block.copy.annotation, null);
refuses(
  "un título más largo del que el esquema admite",
  s,
  setBlockCopy(s, BLOCK_NPS, "title", "x".repeat(COMPOSER_LIMITS.title + 1)),
  "text_too_long",
);
s = drive("setEditorialBody", () => setEditorialBody(s, BLOCK_EDITORIAL, "Un párrafo escrito por una persona."));
eq("el cuerpo editorial se escribe", findBlock(s.document, BLOCK_EDITORIAL).block.content.body, "Un párrafo escrito por una persona.");
refuses("escribir un cuerpo editorial en un bloque que no lo es", s, setEditorialBody(s, BLOCK_NPS, "x"), "block_not_found");
stillValid("copia", s);

/* -------------------------------------------------------------------------- */

console.log("\n[7] El editor ofrece la INTERSECCIÓN: honesto Y dibujable");
// `recommendation_distribution` is compatible with donut and pie, and this
// build draws neither. That gap is the whole reason two tables exist.
const distributionCompatible = COMPATIBLE_CHART_VARIANTS[DISTRIBUTION.semantic];
const distributionOffered = offeredChartVariants(DISTRIBUTION.semantic);
check(distributionCompatible.includes("donut"), "la autoridad admite `donut` para una distribución");
check(!chartVariantIsImplemented("donut"), "y esta versión no lo dibuja");
check(!distributionOffered.includes("donut"), "así que el editor no lo ofrece");
check(distributionOffered.every((v) => distributionCompatible.includes(v)), "todo lo ofrecido es compatible");
check(distributionOffered.every((v) => IMPLEMENTED_CHART_VARIANTS.includes(v)), "y todo lo ofrecido está implementado");
check(distributionOffered.length > 0, `quedan ${distributionOffered.length} formas ofrecibles para una distribución`);
eq(
  "una forma deshonesta se rechaza por deshonesta",
  judgeChartVariant(NPS.semantic, "word_cloud")?.reason,
  "incompatible_with_semantic",
);
eq(
  "una forma honesta que nadie escribió se rechaza por no implementada",
  judgeChartVariant(DISTRIBUTION.semantic, "donut")?.reason,
  "not_implemented",
);
eq("y una ofrecible no se rechaza", judgeChartVariant(NPS.semantic, "kpi_value"), null);
// The two refusals must reach the author as two different codes, or the advice
// they imply — "draw it another way" versus "this is not built yet" — is lost.
refuses(
  "elegir una forma deshonesta",
  s,
  drive("setChartVariant/incompatible", () => setChartVariant(s, context, BLOCK_NPS, "word_cloud")),
  "incompatible_chart_variant",
);
s = drive("addBlock/distribution", () => addBlock(s, context, PAGE_TWO, { kind: "result", binding: DISTRIBUTION.handle }));
const BLOCK_DIST = s.selectedBlockId;
refuses(
  "elegir una forma honesta que esta versión no dibuja",
  s,
  setChartVariant(s, context, BLOCK_DIST, "donut"),
  "chart_variant_not_implemented",
);
check(
  chartVariantIsImplemented(findBlock(s.document, BLOCK_DIST).block.chartVariant),
  "el bloque nuevo nació con una forma que sí se dibuja",
);
s = drive("setChartVariant", () => setChartVariant(s, context, BLOCK_NPS, "gauge"));
eq("y una forma ofrecible se acepta", findBlock(s.document, BLOCK_NPS).block.chartVariant, "gauge");

// Re-binding re-judges the drawing rather than keeping one the new quantity
// cannot honestly wear.
s = drive("setBlockBinding", () => setBlockBinding(s, context, BLOCK_NPS, DISTRIBUTION.handle));
eq("re-enlazar cambia el enlace", findBlock(s.document, BLOCK_NPS).block.binding, DISTRIBUTION.handle);
check(
  judgeChartVariant(DISTRIBUTION.semantic, findBlock(s.document, BLOCK_NPS).block.chartVariant) === null,
  "y la forma se vuelve a juzgar contra la nueva medición",
);
s = setBlockBinding(s, context, BLOCK_NPS, NPS.handle);
refuses("re-enlazar a algo fuera del catálogo", s, setBlockBinding(s, context, BLOCK_NPS, "value:no-existe"), "unknown_handle");
refuses("re-enlazar un bloque que no es de resultado", s, setBlockBinding(s, context, BLOCK_EDITORIAL, NPS.handle), "block_not_found");
stillValid("variantes", s);

/* -------------------------------------------------------------------------- */

console.log("\n[8] Rejilla, teléfono y formato de presentación");
s = drive("setBlockSpan", () => setBlockSpan(s, BLOCK_NPS, "desktop", 4));
eq("el ancho de escritorio se edita", findBlock(s.document, BLOCK_NPS).block.placement.span.desktop, 4);
s = setBlockSpan(s, BLOCK_NPS, "tablet", 6);
eq("el de tableta también", findBlock(s.document, BLOCK_NPS).block.placement.span.tablet, 6);
refuses("estrechar un bloque en teléfono", s, setBlockSpan(s, BLOCK_NPS, "mobile", 6), "mobile_span_fixed");
eq("en teléfono sigue ocupando el ancho completo", findBlock(s.document, BLOCK_NPS).block.placement.span.mobile, GRID_COLUMNS);
check(
  s.document.pages.every((p) => p.blocks.every((b) => b.placement.span.mobile === GRID_COLUMNS)),
  "y eso vale para todos los bloques del documento",
);
refuses("pedir más columnas de las que hay", s, setBlockSpan(s, BLOCK_NPS, "desktop", GRID_COLUMNS + 1), "invalid_span");
refuses("pedir cero columnas", s, setBlockSpan(s, BLOCK_NPS, "desktop", 0), "invalid_span");
s = drive("setBlockResponsive", () => setBlockResponsive(s, BLOCK_DIST, "scroll_x"));
eq("el comportamiento responsivo se edita", findBlock(s.document, BLOCK_DIST).block.placement.responsive, "scroll_x");
s = drive("setBlockDisplayFormat", () => setBlockDisplayFormat(s, BLOCK_NPS, { kind: "fixed_decimals", decimals: 1 }));
eq("un formato fijo se acepta", findBlock(s.document, BLOCK_NPS).block.displayFormat.decimals, 1);
refuses(
  "pedir más decimales de los que la política declara",
  s,
  setBlockDisplayFormat(s, BLOCK_NPS, { kind: "fixed_decimals", decimals: 3 }),
  "invalid_display_format",
);
stillValid("rejilla", s);

/* -------------------------------------------------------------------------- */

console.log("\n[9] Ninguna supresión por muestra pequeña ocurre sola");
eq("el documento sigue en mostrarlo todo", s.document.samplePolicy.mode, "show_all");
check(
  s.document.pages.every((p) => p.blocks.every((b) => b.samplePolicy === null)),
  "y ningún bloque ha adquirido una política propia por el camino",
);
refuses(
  "ocultar por base pequeña sin decir quién lo decide",
  s,
  drive("setDocumentSamplePolicy/unauthored", () =>
    setDocumentSamplePolicy(s, { mode: "hide_below", threshold: 5, authoredBy: "  ", rationale: "  ", publicNote: null }),
  ),
  "sample_policy_unauthored",
);
refuses(
  "anotar por base pequeña sin decir por qué",
  s,
  setBlockSamplePolicy(s, BLOCK_NPS, { mode: "annotate_below", threshold: 5, note: "n", authoredBy: "Dirección", rationale: "" }),
  "sample_policy_unauthored",
);
s = drive("setDocumentSamplePolicy", () =>
  setDocumentSamplePolicy(s, {
    mode: "hide_below",
    threshold: 5,
    authoredBy: "Dirección del estudio",
    rationale: "Una razón escrita a propósito.",
    publicNote: null,
  }),
);
eq("con autoría y razón sí se acepta", s.document.samplePolicy.mode, "hide_below");
s = setDocumentSamplePolicy(s, DEFAULT_SAMPLE_POLICY);
eq("y se puede volver a mostrarlo todo", s.document.samplePolicy.mode, "show_all");
s = drive("setBlockSamplePolicy", () =>
  setBlockSamplePolicy(s, BLOCK_NPS, {
    mode: "annotate_below",
    threshold: 5,
    note: "Base pequeña.",
    authoredBy: "Dirección del estudio",
    rationale: "Una razón escrita a propósito.",
  }),
);
eq("una política de bloque se autoriza igual", findBlock(s.document, BLOCK_NPS).block.samplePolicy.mode, "annotate_below");
check(
  s.document.pages.every((p) => p.blocks.every((b) => b.id === BLOCK_NPS || b.samplePolicy === null)),
  "y autorizarla en un bloque no la convierte en una regla del software",
);
s = setBlockSamplePolicy(s, BLOCK_NPS, null);
// The engine has no code path that produces a suppressing policy on its own.
const editorSource = stripComments(readFileSync(join("src", "lib", "composer", "editor.ts"), "utf8"));
check(
  !/mode:\s*["'](hide_below|annotate_below)["']/.test(editorSource),
  "el motor no construye ninguna política supresora en ningún sitio",
);
stillValid("muestra", s);

console.log("\n[10] Divulgación metodológica");
s = drive("setDocumentDisclosure", () => setDocumentDisclosure(s, "plain_language"));
eq("el nivel del documento se edita", s.document.methodologyDisclosure, "plain_language");
s = drive("setBlockDisclosure", () => setBlockDisclosure(s, BLOCK_NPS, "plain_language_with_base"));
eq("y el de un bloque también", findBlock(s.document, BLOCK_NPS).block.methodologyDisclosure, "plain_language_with_base");
s = setBlockDisclosure(s, BLOCK_NPS, null);
eq("volver a heredar es null, no un nivel copiado", findBlock(s.document, BLOCK_NPS).block.methodologyDisclosure, null);

/* -------------------------------------------------------------------------- */

console.log("\n[11] Un filtro mueve un bloque porque alguien lo escribió");
s = drive("togglePanelDimension", () => togglePanelDimension(s, context, PANEL, DIM_OPEN.handle, true));
eq("el panel ofrece una característica", findBlock(s.document, PANEL).block.dimensions.length, 1);
refuses(
  "ofrecer algo que no es una característica de filtro",
  s,
  togglePanelDimension(s, context, PANEL, NPS.handle, true),
  "handle_facet_mismatch",
);
refuses(
  "ofrecer algo que no está en el catálogo",
  s,
  togglePanelDimension(s, context, PANEL, "dimension:no-existe", true),
  "unknown_handle",
);

// The load-bearing claim of the whole connection model.
const npsBlock = findBlock(s.document, BLOCK_NPS).block;
check(
  entryFor(npsBlock.binding).supportedFilters.includes(DIM_OPEN.handle) &&
    npsBlock.connectedFilterPanelIds.length === 0,
  "compartir una característica NO es una conexión: el bloque la admite y sigue sin conectar",
);
s = drive("connectBlockToPanel", () => connectBlockToPanel(s, context, BLOCK_NPS, PANEL));
eq("conectar explícitamente sí lo conecta", findBlock(s.document, BLOCK_NPS).block.connectedFilterPanelIds[0], PANEL);
refuses("conectar dos veces", s, connectBlockToPanel(s, context, BLOCK_NPS, PANEL), "already_connected");
refuses("conectar un panel a sí mismo", s, connectBlockToPanel(s, context, PANEL, PANEL), "panel_filters_itself");
refuses(
  "conectar contenido fijo, que ningún filtro puede cambiar",
  s,
  connectBlockToPanel(s, context, BLOCK_EDITORIAL, PANEL),
  "block_not_filterable",
);
refuses("desconectar algo que no estaba conectado", s, disconnectBlockFromPanel(s, BLOCK_DIST, PANEL), "not_connected");

// The two negative answers are different facts and keep different codes.
s = drive("addBlock/renewal", () => addBlock(s, context, PAGE_TWO, { kind: "result", binding: RENEWAL.handle }));
const BLOCK_RENEWAL = s.selectedBlockId;
let sForbidden = togglePanelDimension(s, context, PANEL, DIM_ESFERA.handle, true);
check(sForbidden.refusal === null, "el panel puede OFRECER la característica prohibida — la prohibición es del cruce");
refuses(
  "cruzar la característica que una autoridad prohíbe con la renovación",
  sForbidden,
  connectBlockToPanel(sForbidden, context, BLOCK_RENEWAL, PANEL),
  "forbidden_filter_cross",
);
check(
  connectBlockToPanel(sForbidden, context, BLOCK_DIST, PANEL).refusal === null,
  "mientras que un resultado que sí admite ambas se conecta sin problema",
);
stillValid("filtros", s);

/* -------------------------------------------------------------------------- */

console.log("\n[12] Duplicar y quitar dejan el documento sin referencias colgantes");
s = drive("duplicateBlock", () => duplicateBlock(s, BLOCK_NPS));
const COPY = s.selectedBlockId;
check(COPY !== BLOCK_NPS, "la copia tiene un id nuevo");
eq("y aparece justo después de su origen", findPage(s.document, "pagina-uno").blocks[1].id, COPY);
eq("la copia NO hereda las conexiones del original", findBlock(s.document, COPY).block.connectedFilterPanelIds.length, 0);
eq("el original las conserva", findBlock(s.document, BLOCK_NPS).block.connectedFilterPanelIds.length, 1);
check(
  findBlock(s.document, COPY).block.placement !== findBlock(s.document, BLOCK_NPS).block.placement,
  "y la copia no comparte objetos con el original — editarla no edita a su origen",
);
eq("los ids del documento siguen siendo únicos", takenComposerIds(s.document).size, countIds(s.document));

s = drive("duplicatePage", () => duplicatePage(s, "pagina-uno"));
const PAGE_COPY = s.openPageId;
check(PAGE_COPY !== "pagina-uno", "la página copiada tiene un id nuevo");
eq("con los mismos bloques", findPage(s.document, PAGE_COPY).blocks.length, findPage(s.document, "pagina-uno").blocks.length);
check(
  findPage(s.document, PAGE_COPY).blocks.every((b) => !findPage(s.document, "pagina-uno").blocks.some((o) => o.id === b.id)),
  "y ninguno comparte id con el original",
);
eq("los ids siguen siendo únicos tras copiar una página entera", takenComposerIds(s.document).size, countIds(s.document));
// The copied panel is inside the copy, so the copied block points at the COPIED
// panel — never at the original page's one.
const copiedPanel = findPage(s.document, PAGE_COPY).blocks.find((b) => b.kind === "filter_panel");
const copiedConnected = findPage(s.document, PAGE_COPY).blocks.filter((b) => b.connectedFilterPanelIds.length > 0);
check(
  copiedConnected.every((b) => b.connectedFilterPanelIds.every((id) => id === copiedPanel.id)),
  "las conexiones internas se remapean a la copia, nunca al original",
);
check(
  findPage(s.document, PAGE_COPY).blocks.every((b) => b.connectedFilterPanelIds.every((id) => findBlock(s.document, id) !== null)),
  "y ninguna apunta a un bloque que no existe",
);
stillValid("duplicación", s);

// Removing a panel must reach into every block that named it.
const connectedBefore = countConnections(s.document, PANEL);
check(connectedBefore > 0, `antes de quitarlo, ${connectedBefore} bloque(s) nombran el panel`);
s = drive("removeBlock", () => removeBlock(s, PANEL));
eq("quitar el panel lo quita", findBlock(s.document, PANEL), null);
eq("y no queda una sola referencia a él", countConnections(s.document, PANEL), 0);
check(
  s.document.pages.every((p) => p.blocks.every((b) => b.connectedFilterPanelIds.every((id) => findBlock(s.document, id) !== null))),
  "ninguna conexión del documento apunta a nada inexistente",
);
stillValid("quitar un panel", s);

refuses("quitar un bloque que no existe", s, removeBlock(s, "no-existe"), "block_not_found");

const panelInCopy = copiedPanel.id;
const beforePageRemoval = countConnections(s.document, panelInCopy);
check(beforePageRemoval > 0, `la página copiada tiene ${beforePageRemoval} conexión(es) a su propio panel`);
s = drive("removePage", () => removePage(s, PAGE_COPY));
eq("quitar la página la quita", findPage(s.document, PAGE_COPY), null);
eq("y se lleva las conexiones que vivían en ella", countConnections(s.document, panelInCopy), 0);
stillValid("quitar una página", s);

let onlyOne = s;
while (onlyOne.document.pages.length > 1) onlyOne = removePage(onlyOne, onlyOne.document.pages[1].id);
refuses("quitar la última página", onlyOne, drive("removePage/last", () => removePage(onlyOne, onlyOne.document.pages[0].id)), "last_page");

/* -------------------------------------------------------------------------- */

console.log("\n[13] Deshacer y rehacer son exactos, no aproximados");
const origin = openComposer(seedValid.ok ? seedValid.value : seed);
const originBytes = serializeDeterministic(origin.document);
let walk = origin;
const edits = [
  (state) => addPage(state, "Otra página"),
  (state) => addBlock(state, context, "pagina-uno", { kind: "result", binding: NPS.handle }),
  (state) => setBlockCopy(state, state.selectedBlockId, "title", "Un título"),
  (state) => setBlockSpan(state, state.selectedBlockId, "desktop", 3),
  (state) => duplicateBlock(state, state.selectedBlockId),
  (state) => addBlock(state, context, "pagina-uno", { kind: "filter_panel" }),
  (state) => togglePanelDimension(state, context, state.selectedBlockId, DIM_OPEN.handle, true),
];
for (const edit of edits) walk = edit(walk);
eq("siete ediciones dejan siete pasos", walk.past.length, edits.length);
const afterEdits = serializeDeterministic(walk.document);
check(afterEdits !== originBytes, "y el documento cambió");

let back = walk;
for (let i = 0; i < edits.length; i += 1) back = drive("undo", () => undo(back));
eq(
  "deshacer todo devuelve BYTE A BYTE el documento con el que se abrió",
  serializeDeterministic(back.document),
  originBytes,
);
eq("y el historial queda vacío", back.past.length, 0);
eq("con todo por rehacer", back.future.length, edits.length);
refuses("deshacer con el historial vacío", back, drive("undo/empty", () => undo(back)), "nothing_to_undo");

let forward = back;
for (let i = 0; i < edits.length; i += 1) forward = drive("redo", () => redo(forward));
eq("rehacer todo devuelve byte a byte el documento editado", serializeDeterministic(forward.document), afterEdits);
refuses("rehacer sin nada que rehacer", forward, drive("redo/empty", () => redo(forward)), "nothing_to_redo");

// A new edit after an undo abandons the redo branch — keeping it would offer to
// redo into a document that no longer follows from what is on screen.
const branched = addPage(undo(forward), "Rama nueva");
eq("una edición nueva tras deshacer descarta la rama de rehacer", branched.future.length, 0);

// A selection the restored document does not contain becomes nothing, rather
// than a dangling id the inspector would try to describe.
const withBlock = addBlock(origin, context, "pagina-uno", { kind: "result", binding: NPS.handle });
const undone = undo(withBlock);
eq("deshacer la creación de un bloque deselecciona ese bloque", undone.selectedBlockId, null);

// History is bounded, and the bound is the newest sixty.
let deep = origin;
for (let i = 0; i < COMPOSER_HISTORY_DEPTH + 20; i += 1) deep = addPage(deep, `P${i}`);
eq(`el historial se detiene en ${COMPOSER_HISTORY_DEPTH}`, deep.past.length, COMPOSER_HISTORY_DEPTH);
let deepBack = deep;
for (let i = 0; i < COMPOSER_HISTORY_DEPTH; i += 1) deepBack = undo(deepBack);
check(deepBack.refusal === null, "y se puede deshacer los sesenta");

/* -------------------------------------------------------------------------- */

console.log("\n[14] Dos sesiones distintas duplicando lo mismo NO chocan");
// The legacy builder's defect: a session counter restarting at zero minted the
// same id in two sessions, the document then held two blocks under one id, and
// every subsequent save failed for ever.
const sessionA = addBlock(openComposer(seedValid.ok ? seedValid.value : seed), context, "pagina-uno", {
  kind: "result",
  binding: NPS.handle,
});
const sessionB = addBlock(openComposer(seedValid.ok ? seedValid.value : seed), context, "pagina-uno", {
  kind: "result",
  binding: NPS.handle,
});
eq("el mismo acto sobre el mismo documento da el mismo id en dos sesiones", sessionA.selectedBlockId, sessionB.selectedBlockId);
const twiceInOne = duplicateBlock(duplicateBlock(sessionA, sessionA.selectedBlockId), sessionA.selectedBlockId);
eq("duplicar el mismo bloque dos veces da dos ids distintos", takenComposerIds(twiceInOne.document).size, countIds(twiceInOne.document));
eq("y el documento sigue siendo válido", validatePresentationDocument(JSON.parse(serializeDeterministic(twiceInOne.document))).ok, true);

/* -------------------------------------------------------------------------- */

console.log("\n[15] Toda operación del compositor quedó ejercida");
const OPERATIONS = [
  "addPage", "openPage", "renamePage", "movePage", "movePageToIndex", "duplicatePage", "removePage",
  "addBlock/result", "addBlock/editorial", "addBlock/panel", "addBlock/routes",
  "selectBlock", "moveBlock", "moveBlockToIndex", "duplicateBlock", "removeBlock", "setBlockVisibility",
  "setBlockCopy", "setEditorialBody", "setBlockBinding", "setChartVariant",
  "setBlockSpan", "setBlockResponsive", "setBlockDisplayFormat",
  "setDocumentSamplePolicy", "setBlockSamplePolicy", "setDocumentDisclosure", "setBlockDisclosure",
  "togglePanelDimension", "connectBlockToPanel", "undo", "redo",
];
const missed = OPERATIONS.filter((name) => !exercised.has(name));
check(missed.length === 0, `las ${OPERATIONS.length} operaciones se ejercieron${missed.length ? `; faltan ${missed.join(", ")}` : ""}`);

// `connectionCandidates` is what the surface asks before it offers anything.
const panelState = addBlock(
  addBlock(openComposer(seedValid.ok ? seedValid.value : seed), context, "pagina-uno", { kind: "result", binding: RENEWAL.handle }),
  context,
  "pagina-uno",
  { kind: "filter_panel" },
);
const withForbidden = togglePanelDimension(panelState, context, panelState.selectedBlockId, DIM_ESFERA.handle, true);
const candidates = connectionCandidates(withForbidden.document, context, withForbidden.selectedBlockId);
check(
  candidates.ineligible.some((c) => c.reason === "forbidden_filter_cross"),
  "la lista de candidatos separa el cruce prohibido en vez de esconderlo",
);
check(
  candidates.eligible.every((c) => c.block.kind === "result"),
  "y sólo propone bloques que un filtro puede mover de verdad",
);

/* -------------------------------------------------------------------------- */

console.log("\n[16] El compositor es puro y no alcanza nada que sea del servidor");
const COMPOSER_DIR = join("src", "lib", "composer");
const composerFiles = [];
const walkDir = (dir) => {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) walkDir(path);
    else if (path.endsWith(".ts")) composerFiles.push({ path, code: readFileSync(path, "utf8") });
  }
};
walkDir(COMPOSER_DIR);
check(composerFiles.length >= 4, `el compositor tiene ${composerFiles.length} módulos`);
const forbiddenImports =
  /from\s+["'][^"']*\/(presentation\/server|presentation\/registry|presentation\/resolve|presentation\/persistence|presentation\/blueprints|canonical-source|results|calc|shadow|supabase)(\/|["'])/;
const reaching = composerFiles.filter(({ code }) => forbiddenImports.test(stripComments(code)));
check(
  reaching.length === 0,
  `ningún módulo del compositor alcanza servidor, canónico, resultados ni cálculo${reaching.length ? `: ${reaching.map((f) => f.path).join(", ")}` : ""}`,
);
const transports = composerFiles.filter(({ code }) =>
  /@supabase|createClient\(|\.rpc\(|\bfetch\(|node:https?|node:net|XMLHttpRequest|localStorage|sessionStorage/.test(stripComments(code)),
);
check(transports.length === 0, `ningún módulo alcanza un transporte ni un almacén${transports.length ? `: ${transports.map((f) => f.path).join(", ")}` : ""}`);
const serverMarked = composerFiles.filter(({ code }) => /["']server-only["']/.test(stripComments(code)));
check(serverMarked.length === 0, "ninguno lleva la marca server-only — el compositor es del navegador tanto como del servidor");
const clocked = composerFiles.filter(({ code }) => /Date\.now|Math\.random|randomUUID|new Date\(/.test(stripComments(code)));
check(clocked.length === 0, `ninguno consulta un reloj ni una entropía${clocked.length ? `: ${clocked.map((f) => f.path).join(", ")}` : ""}`);
// The composer edits a layout; it must never be caught formatting a number.
const formatters = composerFiles.filter(({ code }) => /toFixed|toPrecision|toLocaleString|Intl\./.test(stripComments(code)));
check(formatters.length === 0, `ninguno formatea un número${formatters.length ? `: ${formatters.map((f) => f.path).join(", ")}` : ""}`);

// The declared renderer table is registered in `package.json` like every gate.
const pkg = JSON.parse(readFileSync("package.json", "utf8"));
check(
  (pkg.scripts?.test ?? "").includes("test:canonical-composer"),
  "la compuerta está registrada en la cadena de `npm test`",
);
check(
  typeof pkg.scripts?.["test:canonical-composer"] === "string",
  "y tiene su propio script",
);

/* -------------------------------------------------------------------------- */

console.log("\n[17] El registro de dibujos y la tabla declarada dicen lo mismo");
// Two artefacts, one claim. `IMPLEMENTED_CHART_VARIANTS` is what the editor
// offers from; `RENDERERS` is what actually exists. If they drift, the editor
// offers a variant that renders as a blank card, or hides one that works.
const declared = [...IMPLEMENTED_CHART_VARIANTS].sort();
const rendered = [...RENDERED_VARIANTS].sort();
eq("la tabla declara tantas formas como componentes hay", declared.length, rendered.length);
check(declared.join(",") === rendered.join(","), `las dos listas coinciden: ${declared.join(", ")}`);
const REQUIRED_BY_BRIEF = [
  "narrative", "callout", "kpi_value", "kpi_with_base", "table", "bar_vertical", "stacked_bar",
  "journey_route_map", "gauge", "bar_horizontal", "term_ranking", "word_cloud", "filter_control",
];
const missingFromBrief = REQUIRED_BY_BRIEF.filter((variant) => !declared.includes(variant));
check(missingFromBrief.length === 0, `las ${REQUIRED_BY_BRIEF.length} formas del plano aprobado están todas${missingFromBrief.length ? `; faltan ${missingFromBrief.join(", ")}` : ""}`);
// And nothing is claimed that the authority would never allow for any semantic.
const everyCompatible = new Set(Object.values(COMPATIBLE_CHART_VARIANTS).flat());
const orphans = declared.filter((variant) => !everyCompatible.has(variant));
check(orphans.length === 0, `ninguna forma implementada carece de semántica que la admita${orphans.length ? `: ${orphans.join(", ")}` : ""}`);

/* -------------------------------------------------------------------------- */

console.log("\n[18] Un modelo resuelto se dibuja, y toda cifra visible es la ya formateada");
const drawable = buildDrawableDocument();
const bound = bindPresentationDocument(drawable, registry);
const resolved = resolvePresentation({ document: bound, registry, results });
check(resolved.ok, "el documento de prueba resuelve");
if (!resolved.ok) {
  console.error(JSON.stringify(resolved.errors, null, 1));
  console.log("\n" + "=".repeat(74));
  console.error(`RESULTADO: ${failures + 1} fallo(s). COMPUERTA BLOQUEADA.`);
  process.exit(1);
}
const model = resolved.value;
const internalHtml = renderToStaticMarkup(createElement(PresentationRenderer, { model, audience: "internal" }));
const clientHtml = renderToStaticMarkup(createElement(PresentationRenderer, { model, audience: "client" }));
check(internalHtml.length > 0 && clientHtml.length > 0, "la biblioteca dibuja el modelo en los dos modos");

// EVERY finished figure in the model must appear in the markup exactly as the
// canonical layer spelled it — and its bare `value` must not appear instead.
const figures = [];
for (const page of model.pages) {
  for (const block of page.blocks) {
    const payload = block.payload;
    if (payload.shape === "value" && payload.value) figures.push(payload.value);
    if (payload.shape === "routes") {
      for (const route of payload.routes) {
        for (const routePoint of route.points) {
          if (routePoint.satisfaction) figures.push(routePoint.satisfaction);
        }
      }
    }
  }
}
check(figures.length > 0, `el modelo trae ${figures.length} cifra(s) terminada(s)`);
const unprinted = figures.filter((figure) => !internalHtml.includes(figure.formatted));
check(unprinted.length === 0, `toda cifra visible se dibuja tal cual la formateó la capa canónica${unprinted.length ? `; falta ${unprinted.map((f) => f.formatted).join(", ")}` : ""}`);
// A padded figure is the sharpest version of the claim: the contract says "33",
// the block asked for one decimal, and the page must read "33.0" and never "33".
const padded = figures.filter((figure) => figure.formatted.includes("."));
check(padded.length > 0, `hay ${padded.length} cifra(s) con decimal declarado`);
// SCAN THE TEXT, NOT THE MARKUP. A first version of this check read the whole
// HTML and went red on `left:50%` inside a style attribute — a marker position,
// which is geometry, and geometry is allowed to hold a number. What the rule is
// actually about is what a READER SEES, so the tags and their attributes come
// off first and only the text nodes are searched.
const textOf = (html) =>
  html
    .replace(/<[^>]*>/g, " ")
    .replace(/&[a-z]+;/g, " ")
    .replace(/\s+/g, " ");
const internalText = textOf(internalHtml);
const clientText = textOf(clientHtml);
// SCOPE THE CLAIM TO THE BLOCK THAT MAKES IT. A first version searched the
// whole page for the bare spelling and went red because a category's share
// legitimately read "50" on the same page as an index of "50.0". Two different
// quantities that happen to share digits are not a re-spelling of one another,
// and an assertion that cannot tell them apart is an assertion about digits.
//
// So each padded figure is drawn ALONE, and the claim is made about its own
// markup: the padded text is there and the unpadded one is not.
const paddedBlocks = [];
for (const page of model.pages) {
  for (const block of page.blocks) {
    if (block.payload.shape === "value" && block.payload.value?.formatted.includes(".")) {
      paddedBlocks.push({ block, value: block.payload.value, page });
    }
  }
}
check(paddedBlocks.length > 0, `hay ${paddedBlocks.length} bloque(s) con una cifra rellenada a decimal fijo`);
const misPrinted = paddedBlocks.filter(({ block, value, page }) => {
  const alone = { ...model, pages: [{ ...page, blocks: [block] }] };
  const text = textOf(renderToStaticMarkup(createElement(PresentationRenderer, { model: alone, audience: "internal" })));
  const bare = value.formatted.split(".")[0];
  const bareAlone = new RegExp(`(?<![\\d.,])${bare}(?![\\d.,])`);
  return !text.includes(value.formatted) || bareAlone.test(text);
});
check(
  misPrinted.length === 0,
  `dibujado solo, cada bloque escribe la cifra rellenada y nunca la corta${misPrinted.length ? `: ${misPrinted.map((entry) => entry.value.formatted).join(", ")}` : ""}`,
);
const printedFigures = figures.filter((figure) => internalText.includes(figure.formatted));
check(printedFigures.length === figures.length, `las ${figures.length} cifras aparecen en el TEXTO, no sólo en el marcado`);
// The library must not be caught formatting. `formatted` is the only spelling.
const COMPONENT_DIR = join("src", "components", "presentation");
const componentFiles = [];
const walkComponents = (dir) => {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) walkComponents(path);
    else if (path.endsWith(".ts") || path.endsWith(".tsx")) componentFiles.push({ path, code: readFileSync(path, "utf8") });
  }
};
walkComponents(COMPONENT_DIR);
check(componentFiles.length >= 8, `la biblioteca tiene ${componentFiles.length} módulos`);
const reformatters = componentFiles.filter(({ code }) =>
  /toFixed|toPrecision|toLocaleString|Intl\.|parseFloat|Number\.parseFloat/.test(stripComments(code)),
);
check(reformatters.length === 0, `ningún componente vuelve a formatear un número${reformatters.length ? `: ${reformatters.map((f) => f.path).join(", ")}` : ""}`);
// Comments are stripped first. This library DISCUSSES `dangerouslySetInnerHTML`
// — it is the thing it deliberately never uses — and a scan that could not tell
// an explanation from a call would forbid the explanation. That is the same
// mistake the presentation gate records making about the legacy adapter.
const unsafeHtml = componentFiles.filter(({ code }) => /dangerouslySetInnerHTML/.test(stripComments(code)));
check(unsafeHtml.length === 0, `ningún componente escribe HTML sin escapar${unsafeHtml.length ? `: ${unsafeHtml.map((f) => f.path).join(", ")}` : ""}`);

/* -------------------------------------------------------------------------- */

console.log("\n[19] C11: el cliente no ve la ausencia que Studio sí nombra");
check(/Sólo interno/.test(internalText), "el modo interno marca en palabras lo que es sólo para revisión");
check(!/Sólo interno/.test(clientText), "y el modo cliente no lleva ni una de esas marcas");
// A whole vocabulary, not one phrase: reviewer language is a family and any
// member of it on a client page is the same defect.
const REVIEWER_WORDS = [
  "Sólo interno", "no lo ve el cliente", "Unidad 6B", "6B.2", "pendiente de configuración",
  "Contenido pendiente", "Retenido por decisión", "todavía no filtran", "esta versión no dibuja",
  "Elige otra forma", "Sin resolver", "Panel sin características",
];
const leaked = REVIEWER_WORDS.filter((word) => clientText.toLowerCase().includes(word.toLowerCase()));
check(leaked.length === 0, `ninguna palabra de revisor cruza al cliente${leaked.length ? `: ${leaked.join(" | ")}` : ""}`);
check(/pendiente/i.test(internalHtml), "Studio nombra el contenido pendiente");
check(!/pendiente de configuración|Contenido pendiente/i.test(clientHtml), "y el cliente no ve ni el hueco ni su explicación");
// The strongest form: a configuration-required block leaves NOTHING behind on a
// client surface — not a card, not a heading, not a reserved row.
const slotBlock = model.pages
  .flatMap((page) => page.blocks)
  .find((block) => block.availability === "configuration_required");
check(Boolean(slotBlock), "el modelo trae un bloque que requiere configuración");
if (slotBlock?.copy.title) {
  check(internalHtml.includes(slotBlock.copy.title), "su título aparece en el modo interno");
  check(!clientHtml.includes(slotBlock.copy.title), "y NO aparece en el modo cliente — ni el título queda");
}
// THE PREDICATE ITSELF, not only its effect on this document.
//
// A discrimination pass found that disabling `AbsenceNotice`'s client branch
// changed nothing above: every absent block in the test document is already
// filtered out by `clientHasContent` before the notice is ever reached. That is
// defence in depth and it is worth having — but it meant the assertions were
// passing for a structural reason and would have kept passing if the notice
// itself started leaking. So the notice is now driven directly, in both modes,
// for all four states.
const ABSENCES = [
  { absence: { state: "withheld_by_policy" }, clientSees: false },
  { absence: { state: "configuration_required" }, clientSees: false },
  { absence: { state: "unavailable", reason: "no_responses" }, clientSees: true },
  { absence: { state: "unresolved", reason: "authority_conflict" }, clientSees: true },
];
for (const { absence, clientSees } of ABSENCES) {
  const asClient = textOf(renderToStaticMarkup(createElement(AbsenceNotice, { absence, audience: "client" }))).trim();
  const asInternal = textOf(renderToStaticMarkup(createElement(AbsenceNotice, { absence, audience: "internal" }))).trim();
  if (clientSees) {
    // A fact the CONTRACT states about a measurement is analytical honesty and
    // must survive: C11 removes the shape of a gap, not a caveat about a
    // result the client is being shown.
    check(asClient.length > 0, `«${absence.state}» sí se le dice al cliente: es un hecho del contrato, no un hueco nuestro`);
  } else {
    check(asClient.length === 0, `«${absence.state}» no deja NADA en el cliente: ni caja, ni título, ni explicación`);
  }
  check(asInternal.length > 0, `y en modo interno Studio nombra «${absence.state}»`);
  check(!asClient.includes("Sólo interno"), `«${absence.state}» nunca lleva lenguaje de revisor al cliente`);
}

// A filter panel is internal-only in this unit and must not reach a client page.
check(/todavía no filtran/i.test(internalHtml), "el preview interno dice en voz alta que los filtros aún no filtran");
check(!/todavía no filtran/i.test(clientHtml), "y el cliente no ve un control muerto");
check(/disabled/.test(internalHtml), "los controles de filtro se dibujan deshabilitados de verdad");
// AN INELIGIBLE BLOCK NEVER WEARS THE FILTER SECTION.
//
// The first version of this check searched the whole page for the section after
// a block's title, and a discrimination pass showed it proved nothing: a title
// appears twice in the markup — once in `aria-label`, once in the heading — so
// splitting on it and reading the second piece inspected the handful of
// characters BETWEEN the two, never the block's body. Each candidate block is
// therefore drawn alone, which is the only way the question "does THIS block
// carry it" has an unambiguous answer.
const soloText = (block, page) =>
  textOf(
    renderToStaticMarkup(
      createElement(PresentationRenderer, {
        model: { ...model, pages: [{ ...page, blocks: [block] }] },
        audience: "internal",
      }),
    ),
  );
const ineligible = [];
const eligibleConnected = [];
for (const page of model.pages) {
  for (const block of page.blocks) {
    if (block.payload.shape === "editorial" || block.payload.shape === "filter_controls" || block.payload.shape === "routes") {
      ineligible.push({ block, page });
    } else if (block.connectedFilterPanelIds.length > 0) {
      eligibleConnected.push({ block, page });
    }
  }
}
check(ineligible.length > 0, `hay ${ineligible.length} bloque(s) que ningún filtro puede mover`);
const wearing = ineligible.filter(({ block, page }) => soloText(block, page).includes("Qué filtros lo mueven"));
check(
  wearing.length === 0,
  `ninguno muestra una sección genérica de «Qué filtros lo mueven»${wearing.length ? `: ${wearing.map((entry) => entry.block.id).join(", ")}` : ""}`,
);
// The positive control. Without it, deleting the section entirely would satisfy
// the negative above, and a check that a missing feature is missing is not a check.
check(eligibleConnected.length > 0, `hay ${eligibleConnected.length} bloque(s) que un panel sí mueve`);
const notWearing = eligibleConnected.filter(({ block, page }) => !soloText(block, page).includes("Qué filtros lo mueven"));
check(
  notWearing.length === 0,
  `y un bloque conectado sí la muestra${notWearing.length ? `; falta en ${notWearing.map((entry) => entry.block.id).join(", ")}` : ""}`,
);

/* -------------------------------------------------------------------------- */

console.log("\n[20] Ningún componente de presentación alcanza el servidor ni el cálculo");
const componentReaching = componentFiles.filter(({ code }) =>
  /from\s+["'][^"']*(presentation\/server|presentation\/registry|presentation\/resolve|presentation\/persistence|presentation\/blueprints|canonical-source|lib\/results\/(?!contract)|lib\/calc|lib\/shadow|lib\/supabase|studio\/)/.test(
    stripComments(code),
  ),
);
check(
  componentReaching.length === 0,
  `ningún componente importa servidor, registro, resolutor, persistencia, canónico, cálculo ni sombra${componentReaching.length ? `: ${componentReaching.map((f) => f.path).join(", ")}` : ""}`,
);
const componentTransports = componentFiles.filter(({ code }) =>
  /@supabase|createClient\(|\.rpc\(|\bfetch\(|node:/.test(stripComments(code)),
);
check(componentTransports.length === 0, `ningún componente alcanza un transporte${componentTransports.length ? `: ${componentTransports.map((f) => f.path).join(", ")}` : ""}`);
// The word cloud's geometry may read a count. It may not regroup one.
const cloud = componentFiles.find(({ path }) => path.endsWith("Terms.tsx"));
check(Boolean(cloud), "la biblioteca trae el dibujo de términos");
if (cloud) {
  const code = stripComments(cloud.code);
  check(!/rotate\(\s*-?(?!180)\d+deg/.test(code.replace(/rotate\(180deg\)/g, "")), "la nube no inclina ningún término en diagonal");
  check(!/<line|<path|filter:|drop-shadow|textShadow/.test(code), "no dibuja conectores, halos ni sombras entre términos");
  check(/writing-mode|writingMode/.test(code), "y su único giro es exactamente vertical");
}

/* -------------------------------------------------------------------------- */

console.log("\n[21] Lo que cruza al navegador es una proyección, no un filtro");
// The payload the screen receives, assembled exactly as the loader assembles it.
const payload = { document: bound, catalog, model, blueprint: { id: "x", label: "y", because: "z" } };
const payloadText = serializeDeterministic(payload);
// An ADDRESS is an array position inside the results document. A browser
// holding one is a browser one step from resolving it.
check(!/"at"\s*:/.test(payloadText), "ninguna dirección canónica cruza");
check(!/"addresses"/.test(payloadText), "ni el mapa de direcciones");
check(!/"source"\s*:/.test(payloadText), "ni el alcance de base de datos del registro");
const UUID_ANY = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
check(!UUID_ANY.test(payloadText), "ningún UUID — ni inquilino, ni estudio, ni persona");
check(!/specId|planFingerprint|packageIdempotencyKey|mappingVersion|calculationVersion/.test(payloadText), "ninguna identidad de plan, paquete, especificación ni versión de cálculo");
check(!/authoredBy|rationale|threshold/.test(payloadText), "ni el autor, la razón o el umbral de una política de muestra");
// The registry it was projected FROM does carry those, so the absence above is
// a property of the projection and not of the fixture.
check(typeof registry.source.specId === "string" && registry.addresses.size > 0, "y el registro del que se proyectó sí los lleva, así que la ausencia significa algo");
const payloadSource = stripComments(readFileSync(join("src", "lib", "composer", "payload.ts"), "utf8"));
const declaredFields = (payloadSource.match(/export type ComposerPayload = \{([\s\S]*?)\n\};/) ?? [])[1] ?? "";
const fieldNames = [...declaredFields.matchAll(/^\s{2}(\w+):/gm)].map((match) => match[1]).sort();
check(
  fieldNames.join(",") === "blueprint,catalog,document,model",
  `el pago declara exactamente cuatro campos y son los nombrados: ${fieldNames.join(", ")}`,
);

/* -------------------------------------------------------------------------- */

console.log("\n[22] La ruta autoriza antes de leer, enlaza en el servidor y no escribe nada");
const PAGE = "src/app/studio/e/[studyId]/construccion/page.tsx";
const ACTION = "src/app/studio/e/[studyId]/construccion/actions.ts";
const LOADER = "src/lib/studio/presentation-workspace.ts";
const read = (path) => {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return "";
  }
};
const pageSource = read(PAGE);
const actionSource = read(ACTION);
const loaderSource = read(LOADER);
check(pageSource.length > 0 && actionSource.length > 0 && loaderSource.length > 0, "la página, la acción y el cargador existen");

// THE ORDER IS THE ARGUMENT. Not "the gate is called somewhere in the file".
const gateAt = pageSource.indexOf("await requireInternal()");
check(gateAt >= 0, "la página llama a requireInternal()");
for (const reader of ["await params", "loadStudioStudy(", "loadPresentationComposerWorkspace(", "admin."]) {
  const at = pageSource.indexOf(reader);
  check(at < 0 || at > gateAt, `y lo hace antes de «${reader}»`);
}
check(/z\.string\(\)\.uuid\(\)\.safeParse\(studyId\)/.test(pageSource), "la página valida el identificador del estudio como UUID");
check(/notFound\(\)/.test(pageSource), "y responde 404 cuando el estudio no existe");

// THE ACTION RE-DOES THE CHECK. It may not trust the page's gate.
// Comments stripped for the NEGATIVE checks: the action's header explains that
// it uses `getUser()` and never `getSession()`, and a scan of the raw text would
// find the sentence and call it the defect it warns against.
const actionCode = stripComments(actionSource);
check(/auth\.getUser\(\)/.test(actionCode), "la acción revalida la sesión con getUser()");
check(!/getSession\(/.test(actionCode), "y nunca con getSession()");
check(/from\("profiles"\)/.test(actionCode) && /role/.test(actionCode), "lee el rol de la base de datos");
check(/throw new Error\("Acceso denegado\."\)/.test(actionCode), "y un rol equivocado lanza, no redirige — un redirect desde una acción parece un éxito");
check(/uuid\.safeParse\(studyId\)/.test(actionCode), "valida el estudio como UUID");
check(/tenant_id/.test(actionCode), "y recupera el inquilino de la fila, nunca de la petición");
check(/JSON\.parse\(documentJson\)/.test(actionCode) && /catch/.test(actionCode), "trata el documento como hostil: lo parsea dentro de un try/catch");

// BINDING IS AN ACT, AND IT HAPPENS BEFORE RESOLUTION, ON THE SERVER.
const loaderCode = stripComments(loaderSource);
const bindAt = loaderCode.indexOf("bindPresentationDocument(");
const resolveAt = loaderCode.indexOf("resolvePresentation(");
check(bindAt >= 0 && resolveAt >= 0, "el cargador enlaza y resuelve");
check(bindAt < resolveAt, "y enlaza ANTES de resolver, nunca al vuelo dentro de la lectura");
check(/["']server-only["']/.test(loaderCode), "el cargador lleva la marca server-only");
check(!/@\/lib\/dashboard|lib\/dashboard/.test(loaderCode), "y no cae al cálculo heredado cuando no hay paquete canónico");
check(/validatePresentationDocument\(/.test(loaderCode), "valida el documento del navegador contra el esquema estricto antes de mirarlo");

// NOTHING WRITES. Comments are stripped: these files DISCUSS the writes they do
// not perform, and a scan that could not tell a promise from a call would
// forbid the promise.
for (const [label, source] of [["la página", pageSource], ["la acción", actionSource], ["el cargador", loaderSource]]) {
  const code = stripComments(source);
  const writers = [".insert(", ".update(", ".upsert(", ".delete(", ".rpc(", "revalidatePath", "encodePresentationForStorage"].filter((writer) =>
    code.includes(writer),
  );
  check(writers.length === 0, `${label} no escribe nada${writers.length ? `: ${writers.join(", ")}` : ""}`);
}
// And the legacy draft is never named, let alone read.
for (const [label, source] of [["la página", pageSource], ["la acción", actionSource], ["el cargador", loaderSource]]) {
  const code = stripComments(source);
  check(
    !/study_experience_draft|study_experience_revision/.test(code),
    `${label} no nombra el borrador heredado`,
  );
}

/* -------------------------------------------------------------------------- */

console.log("\n[23] La superficie de cliente no puede alcanzar el cargador");
const WORKSPACE_UI = "src/components/studio/composer/ComposerWorkspace.tsx";
const uiSource = stripComments(read(WORKSPACE_UI));
check(uiSource.length > 0, "el taller de composición existe");
check(/^\s*["']use client["']/m.test(uiSource), "y es un componente de cliente");
check(
  !/from\s+["'][^"']*studio\/presentation-workspace["']/.test(uiSource),
  "no importa el cargador server-only",
);
check(
  !/from\s+["'][^"']*construccion\/actions["']/.test(uiSource),
  "ni el módulo de la acción — la acción le llega como propiedad desde la página",
);
check(/refresh/.test(uiSource), "y recibe la actualización como una función que no sabe qué hay detrás");
check(
  !/canonical-source|lib\/results\/(?!contract)|lib\/calc/.test(uiSource),
  "no alcanza el canónico, los resultados ni el cálculo",
);
// SESSION-ONLY, and the screen says so in words rather than in a tooltip.
check(/nada[\s\S]{0,60}se guarda/i.test(uiSource), "dice que nada se guarda");
check(/recargas|sales/i.test(uiSource), "que recargar o salir lo pierde");
check(/cliente no ve/i.test(uiSource), "que el cliente no ve nada de esto");
check(/no se publica/i.test(uiSource), "y que no se publica nada");
check(
  !/localStorage|indexedDB|navigator\.sendBeacon/.test(uiSource),
  "y no guarda el documento en ningún almacén del navegador",
);
// Chrome is a preference; the document is the work. They share no storage.
const chromeSource = stripComments(read("src/components/studio/composer/chrome.ts"));
check(/sessionStorage/.test(chromeSource), "el cromo del taller sí recuerda una preferencia");
check(
  !/document|pages|blocks/.test(chromeSource.replace(/window\.document/g, "")),
  "pero no toca el documento: recordar un panel no puede ensuciar la presentación",
);

/* -------------------------------------------------------------------------- */

function buildDrawableDocument() {
  // One page carrying one of every shape the renderer has to survive, including
  // an editorial slot the contract says nobody has filled yet.
  const block = (id, extra, order, span = 6) => ({
    id,
    copy: { title: extra.title ?? null, description: null, annotation: null },
    placement: { order, span: { desktop: span, tablet: 12, mobile: 12 }, responsive: "reflow" },
    visible: true,
    connectedFilterPanelIds: extra.connectedTo ?? [],
    samplePolicy: null,
    methodologyDisclosure: null,
    displayFormat: extra.displayFormat ?? { kind: "canonical" },
    ...extra.body,
  });
  return {
    schemaVersion: PRESENTATION_DOCUMENT_SCHEMA_VERSION,
    documentKind: PRESENTATION_DOCUMENT_KIND,
    registryVersion: registry.registryVersion,
    binding: null,
    id: "dibujable",
    title: "Documento dibujable",
    locale: "es-MX",
    samplePolicy: DEFAULT_SAMPLE_POLICY,
    methodologyDisclosure: "plain_language_with_base",
    pages: [
      {
        id: "dibujo",
        title: "Dibujo",
        order: 0,
        blocks: [
          // A padded figure: the contract spells the index one way and the block
          // asks for a decimal, which is the exact 33 → "33.0" situation.
          block("kpi", { title: "Índice de renovación", displayFormat: { kind: "fixed_decimals", decimals: 1 }, body: { kind: "result", binding: RENEWAL.handle, chartVariant: "gauge" } }, 0),
          // Connected to the panel below, so the internal "what moves this"
          // section has a positive control as well as a negative one.
          block("nps", { title: "Recomendación", connectedTo: ["panel"], body: { kind: "result", binding: NPS.handle, chartVariant: "kpi_with_base" } }, 1),
          block("comp", { title: "Composición", body: { kind: "result", binding: DISTRIBUTION.handle, chartVariant: "stacked_bar" } }, 2, 12),
          block("terms", { title: "Términos", body: { kind: "result", binding: TERMS.handle, chartVariant: "word_cloud" } }, 3, 12),
          block("ranking", { title: "Ranking", body: { kind: "result", binding: TERMS.handle, chartVariant: "term_ranking" } }, 4),
          block("routes", { title: "Recorrido", body: { kind: "journey_routes", chartVariant: "journey_route_map", routes: [{ id: "r1", title: "Ruta uno", order: 0, sourceGroup: GROUP.handle, touchpoints: GROUP.members.slice() }] } }, 5, 12),
          block("panel", { title: "Filtros", body: { kind: "filter_panel", dimensions: [DIM_OPEN.handle] } }, 6, 12),
          block("slot", { title: "Texto pendiente", body: { kind: "editorial", slot: SLOT.handle, content: null } }, 7, 12),
          block("prose", { title: "Texto redactado", body: { kind: "editorial", slot: null, content: { body: "Un párrafo escrito por una persona." } } }, 8, 12),
        ],
      },
    ],
  };
}

function countIds(document) {
  let total = 1;
  for (const page of document.pages) {
    total += 1;
    for (const block of page.blocks) {
      total += 1;
      if (block.kind === "journey_routes") total += block.routes.length;
    }
  }
  return total;
}

function countConnections(document, panelId) {
  let total = 0;
  for (const page of document.pages) {
    for (const block of page.blocks) {
      total += block.connectedFilterPanelIds.filter((id) => id === panelId).length;
    }
  }
  return total;
}

console.log("\n" + "=".repeat(74));
if (failures > 0) {
  console.error(`RESULTADO: ${failures} fallo(s). COMPUERTA BLOQUEADA.`);
  process.exit(1);
}
console.log(
  "RESULTADO: el compositor es puro, sus identificadores son deterministas y libres, deshacer es exacto, " +
    "un rechazo no cambia nada, una conexión sólo existe si alguien la escribió, el editor ofrece " +
    "únicamente lo que es honesto Y dibujable, y ninguna muestra pequeña se oculta sola. COMPUERTA APROBADA.",
);
