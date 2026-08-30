// =============================================================================
// The Experience Composer foundation gate
// =============================================================================
// Deterministic, credentials-free, and it never touches a database. It proves
// the claims the foundation makes that a reviewer would otherwise have to take
// on trust:
//
//   1  the definition is a strict boundary — unknown fields, markup, query
//      syntax, unbounded lists and impossible layouts are all refused;
//   2  identifiers are opaque, stable and independent of every visible label;
//   3  the sample-visibility policy behaves exactly as the owner specified,
//      and the legacy rule is preserved bit for bit for existing studies;
//   4  hard errors block and soft warnings do not;
//   5  a filter moves a block because a connection says so, never because they
//      share a characteristic;
//   6  the compatibility adapter is pure, deterministic, and can represent the
//      current client experience;
//   7  the prototype route authorizes server-side before it reads anything,
//      writes nothing, and does not touch the client-facing renderers;
//   8  the prototype is operable by keyboard and its controls are named.
//
// It reads the pure modules for behaviour and the components' source for the
// structural facts a DOM would otherwise be needed to observe.
// =============================================================================

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { csatTopBox, mean, npsFromScores } from "../src/lib/calc/metrics.ts";

import {
  bandColumnKey,
  derivedBandDimensions,
  indexWithDerivedBands,
  withDerivedBandColumns,
} from "../src/lib/experience/band-filters.ts";
import {
  classify,
  schemeIsUsable,
  schemeProblems,
} from "../src/lib/experience/bands.ts";
import {
  BLOCK_TYPES,
  blockCapabilities,
  blockCatalogue,
  blockSpec,
  viewerFilterRefusal,
} from "../src/lib/experience/blocks.ts";
import {
  CHART_SPECS,
  CHART_VARIANTS,
  alternativeVariant,
  compatibleVariants,
  implementedVariants,
  isRendererImplemented,
} from "../src/lib/experience/charts.ts";
import {
  adaptLegacyStudy,
  buildLegacyRegistry,
  familyForMetric,
  registryKeyIndex,
} from "../src/lib/experience/adapter.ts";
import { canAddBlock, newBlock, newExperience, newPage } from "../src/lib/experience/defaults.ts";
import {
  EXPERIENCE_SCHEMA_VERSION,
  allBlocks,
  blocksAffectedBy,
  filtersAffecting,
  findBlock,
  parseExperienceDefinition,
} from "../src/lib/experience/definition.ts";
import { fixtureRegistry, satisfactionOnlyJourneyRegistry } from "../src/lib/experience/fixtures.ts";
import { EXPERIENCE_ID_PATTERN, idKindOf, isExperienceId, mintId } from "../src/lib/experience/ids.ts";
import {
  effectiveFilterTargets,
  filterPanels,
  isFilterTargetable,
  panelTargetBlockIds,
  removalConsequence,
} from "../src/lib/experience/filters.ts";
import { BREAKPOINTS, GRID_COLUMNS, defaultLayout, layoutProblems, rowWidths } from "../src/lib/experience/layout.ts";
import { EXPERIENCE_LIMITS } from "../src/lib/experience/limits.ts";
import { declaredVersion, migrateExperienceDefinition } from "../src/lib/experience/migrate.ts";
import {
  addBlock,
  addPage,
  adoptDefinition,
  canRedo,
  canUndo,
  duplicateBlock,
  duplicatePage,
  initialState,
  moveBlock,
  moveBlockToIndex,
  movePage,
  openPage,
  redo,
  removeBlock,
  setPanelTarget,
  togglePanelFilter,
  togglePanelTargetBlock,
  removePage,
  renamePage,
  resetToAdapted,
  selectBlock,
  setBlockAggregation,
  setBlockCopy,
  setBlockDimension,
  setBlockMetric,
  setBlockSamplePolicy,
  setBlockSpan,
  setBlockTitle,
  setBlockVisibility,
  setChartVariant,
  setFilterConnection,
  setPageVisibility,
  setStudySamplePolicy,
  undo,
} from "../src/lib/experience/editor.ts";
import {
  blockDataRequests,
  coarsestDimensionId,
  dataKeyForBlock,
  dataKeyForMoment,
  dataKeyForPivot,
  dataKeyForThemes,
  definitionDataKeys,
  qualitativeBlockIds,
  decimalsForUnit,
  blockRestriction,
  resolveBlockData,
  resolveDefinitionData,
  unitForAggregation,
} from "../src/lib/experience/data.ts";
import { findDimension, findMetric, registrySignature } from "../src/lib/experience/registry.ts";
import { ADMIN_ALIASES, studioStudyComposer } from "../src/lib/studio/routes.ts";
import { approvalHolds, approvalInvalidations } from "../src/lib/experience/review.ts";
import {
  DEFAULT_SAMPLE_POLICY,
  LEGACY_SAMPLE_POLICY,
  SAMPLE_POLICY_MODES,
  evaluateSampleVisibility,
  legacySampleState,
  resolveSamplePolicy,
} from "../src/lib/experience/sample-policy.ts";
import { definitionSignature, serializeExperienceDefinition, serializedBytes, withinSizeLimit } from "../src/lib/experience/serialize.ts";
import { isSafeAuthoredText, rejectAuthoredText } from "../src/lib/experience/text.ts";
import { layoutThemeCloud, themeCloudAlternative } from "../src/lib/experience/theme-cloud.ts";
import { validateBlockQuery, validateExperienceDefinition } from "../src/lib/experience/validate.ts";

let checks = 0;
const ok = (message) => {
  checks += 1;
  console.log(`  PASS  ${message}`);
};

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
/** Source with comments stripped, so a file cannot fail for describing itself. */
const readCode = async (path) =>
  (await read(path)).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const STUDY = "11111111-1111-4111-8111-111111111111";
const TENANT = "22222222-2222-4222-8222-222222222222";

// ---------------------------------------------------------------------------
// The legacy fixture — shaped like a real study, containing nobody's answers
// ---------------------------------------------------------------------------

const wideValues = Array.from({ length: 72 }, (_, index) => `Giro ${String(index + 1).padStart(2, "0")}`);

const snapshot = {
  studyId: STUDY,
  tenantId: TENANT,
  studyName: "Estudio de ejemplo",
  clientName: "Cliente de ejemplo",
  period: "2026-S1",
  status: "draft",
  dashboardConfig: {
    version: 1,
    sections: {
      narrative: true,
      trends: true,
      filters: true,
      journey: true,
      qualitative: true,
      metrics: true,
      segments: true,
      pivot: true,
      report: true,
    },
    presentation: {
      primaryColor: "#1b72b8",
      threshold: { metric: "sat_bienvenida", minimum: 70, maximum: null, label: "Meta" },
    },
  },
  journeyDefinition: {
    stages: [
      { id: "bienvenida", label: "Bienvenida", metric: "sat_bienvenida" },
      { id: "acompanamiento", label: "Acompañamiento", metric: "sat_acompanamiento" },
      { id: "historico", label: "Momento histórico", metric: "sat_retirado" },
    ],
  },
  metrics: [
    // `scale` is what the study's OWN answers span, and it is what decides the
    // Top-2-Box threshold. These two satisfaction results are answered 0–10, so
    // the documented threshold for them is 9; a study answered 1–5 gets 4.
    // Passing a 0–10 default to a 1–5 study is what made every satisfaction
    // result on the real study read 0 %.
    { key: "nps_general", name: "Recomendación", question: "¿Recomendarían?", unit: "nps", responses: 54, available: true, scale: { minimum: 0, maximum: 10 } },
    { key: "sat_bienvenida", name: "Satisfacción · Bienvenida", question: "¿Buena bienvenida?", unit: "percent", responses: 52, available: true, scale: { minimum: 0, maximum: 10 } },
    { key: "sat_acompanamiento", name: "Satisfacción · Acompañamiento", question: "¿Buen acompañamiento?", unit: "percent", responses: 48, available: true, scale: { minimum: 0, maximum: 10 } },
    { key: "ltv_cliente", name: "Valor por cliente", question: "¿Cuánto vale?", unit: "score", responses: 41, available: true, scale: { minimum: 0, maximum: 40000 } },
  ],
  dimensions: [
    { key: "seg_generacion", values: ["Millennial", "Generación X", "Baby boomer"] },
    { key: "seg_estatus", values: ["Activa", "Por renovar", "Ya no participa"] },
    { key: "seg_giro", values: wideValues },
  ],
  themes: [
    { label: "Acompañamiento", confirmed: 9 },
    { label: "Comunicación", confirmed: 5 },
    { label: "Costo", confirmed: 2 },
  ],
  periods: ["2026-S1"],
};

// ===========================================================================
console.log("\n[1] Identifiers are opaque, stable, and independent of labels");
// ===========================================================================

const idA = mintId("block", "study/panorama/cover");
const idB = mintId("block", "study/panorama/cover");
assert.equal(idA, idB, "the same seed must always mint the same identifier");
assert.notEqual(idA, mintId("block", "study/panorama/finding"));
assert.match(idA, EXPERIENCE_ID_PATTERN);
assert.equal(idKindOf(idA), "block");
assert.ok(isExperienceId(idA, "block"));
assert.ok(!isExperienceId(idA, "page"), "a block identifier is not a page identifier");
ok("identifiers are deterministic, prefixed and kind-checked");

for (const label of ["Satisfacción general", "Recomendación", "Todos los resultados"]) {
  const slug = label
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
  const minted = mintId("block", "fixed-seed");
  assert.ok(
    !minted.includes(slug.slice(0, 6)),
    `an identifier must carry no trace of a visible label ("${label}")`,
  );
}
ok("no minted identifier contains a slug of any label");

const idsSource = await readCode("src/lib/experience/ids.ts");
for (const forbidden of [/Math\.random/, /Date\.now/, /randomUUID/, /performance\.now/]) {
  assert.doesNotMatch(idsSource, forbidden, "identity may not come from a clock or from entropy");
}
ok("identifier minting uses no clock and no randomness");

// A thousand distinct seeds, no collision. Not a security claim — a sanity one.
const minted = new Set(Array.from({ length: 2000 }, (_, index) => mintId("block", `seed-${index}`)));
assert.equal(minted.size, 2000, "two thousand distinct seeds must mint two thousand identifiers");
ok("2000 distinct seeds mint 2000 distinct identifiers");

// ===========================================================================
console.log("\n[2] A new experience shows everything from a single answer");
// ===========================================================================

const fresh = newExperience({ seed: "fresh", title: "Nueva experiencia", studyId: STUDY, tenantId: TENANT });
assert.equal(fresh.sampleVisibilityPolicy.mode, "show_all", "a new experience defaults to show_all");
assert.equal(DEFAULT_SAMPLE_POLICY.mode, "show_all");
ok("newly composed experiences default to showing every result");

const showAll = evaluateSampleVisibility(1, fresh.sampleVisibilityPolicy);
assert.equal(showAll.state, "visible", "show_all shows a result built on one answer");
assert.equal(showAll.disclosedSampleSize, 1);
assert.equal(showAll.threshold, null, "show_all applies no threshold");
ok("show_all renders n = 1 as a visible result");

const warn = { policyVersion: 1, mode: "warn_below", threshold: 5 };
const warned = evaluateSampleVisibility(3, warn);
assert.equal(warned.state, "warning", "warn_below keeps the value and marks it");
assert.equal(warned.disclosedSampleSize, 3, "a warned value still knows its own base");
assert.equal(evaluateSampleVisibility(5, warn).state, "visible", "at the threshold there is no warning");
ok("warn_below shows the value together with its warning");

const hide = { policyVersion: 1, mode: "hide_below", threshold: 5 };
const hidden = evaluateSampleVisibility(3, hide);
assert.equal(hidden.state, "suppressed");
assert.equal(hidden.disclosedSampleSize, null, "a suppressed result never publishes its own base");
assert.equal(evaluateSampleVisibility(5, hide).state, "visible");
ok("hide_below withholds both the value and the count behind it");

for (const mode of SAMPLE_POLICY_MODES) {
  assert.equal(
    evaluateSampleVisibility(0, { policyVersion: 1, mode, threshold: 5 }).state,
    "no_data",
    "no answers is the absence of a result under every mode",
  );
}
ok("zero answers reads as no data under all three modes");

// The equivalence that protects every study built before the composer existed.
for (let n = 0; n <= 60; n += 1) {
  assert.equal(
    evaluateSampleVisibility(n, LEGACY_SAMPLE_POLICY).state,
    legacySampleState(n),
    `the legacy policy must behave exactly like the deployed rule at n = ${n}`,
  );
}
ok("the legacy policy reproduces the deployed disclosure rule at every base from 0 to 60");

const overridden = resolveSamplePolicy(DEFAULT_SAMPLE_POLICY, { kind: "override", policy: hide });
assert.equal(overridden.mode, "hide_below", "a block override wins over the study rule");
assert.equal(resolveSamplePolicy(DEFAULT_SAMPLE_POLICY, { kind: "inherit" }).mode, "show_all");
assert.equal(resolveSamplePolicy(DEFAULT_SAMPLE_POLICY, null).mode, "show_all");
ok("a block either inherits the study rule or states its own, and the override wins");

assert.throws(() => evaluateSampleVisibility(-1, DEFAULT_SAMPLE_POLICY), RangeError);
assert.throws(() => evaluateSampleVisibility(1.5, DEFAULT_SAMPLE_POLICY), RangeError);
assert.throws(() => evaluateSampleVisibility(3, { policyVersion: 2, mode: "show_all", threshold: 5 }), RangeError);
assert.throws(() => evaluateSampleVisibility(3, { policyVersion: 1, mode: "show_all", threshold: 0 }), RangeError);
ok("the policy refuses an impossible base, an unknown version and a zero threshold");

// ===========================================================================
console.log("\n[3] The definition is a strict boundary");
// ===========================================================================

const minimal = parseExperienceDefinition(fresh);
assert.ok(minimal.ok, `a minimal definition must parse: ${JSON.stringify(minimal.issues ?? [])}`);
assert.equal(minimal.definition.schemaVersion, EXPERIENCE_SCHEMA_VERSION);
ok("the minimal definition parses");

const adapted = adaptLegacyStudy(snapshot);
const full = parseExperienceDefinition(adapted.definition);
assert.ok(full.ok, `the full adapted definition must parse: ${JSON.stringify(full.issues ?? [])}`);
ok("a full, adapted definition parses");

const withUnknownRoot = { ...adapted.definition, surprise: true };
assert.equal(parseExperienceDefinition(withUnknownRoot).ok, false, "an unknown root field is refused");

const withUnknownBlock = structuredClone(adapted.definition);
withUnknownBlock.pages[0].blocks[0].surprise = true;
assert.equal(parseExperienceDefinition(withUnknownBlock).ok, false, "an unknown block field is refused");

const withUnknownLayout = structuredClone(adapted.definition);
withUnknownLayout.pages[0].blocks[0].layout.desktop.left = 40;
assert.equal(parseExperienceDefinition(withUnknownLayout).ok, false, "a pixel coordinate is refused");
ok("unknown fields are refused at the root, inside a block and inside a layout");

// A version this build does not write. Derived from the constant rather than
// typed, so bumping the schema cannot turn this into an assertion about the
// CURRENT version quietly passing.
const wrongVersion = { ...adapted.definition, schemaVersion: EXPERIENCE_SCHEMA_VERSION + 1 };
assert.equal(parseExperienceDefinition(wrongVersion).ok, false, "only the declared schema version parses");
ok("a document declaring another schema version is refused");

const badId = structuredClone(adapted.definition);
badId.pages[0].blocks[0].id = "block-1";
assert.equal(parseExperienceDefinition(badId).ok, false, "a hand-written identifier is refused");
ok("an identifier the composer did not mint is refused");

// ===========================================================================
console.log("\n[4] No SQL, HTML, script, style or template ever enters a field");
// ===========================================================================

const HOSTILE = [
  "<script>alert(1)</script>",
  "<img src=x onerror=alert(1)>",
  "javascript:alert(1)",
  "'; drop table respondent; --",
  "1 UNION SELECT password FROM profiles",
  "${process.env.SUPABASE_SERVICE_ROLE_KEY}",
  "{{constructor.constructor('return 1')()}}",
  "@import url('http://example.invalid/x.css')",
  "<a href='#'>x</a>",
  "() => { fetch('http://example.invalid') }",
];

for (const hostile of HOSTILE) {
  assert.equal(isSafeAuthoredText(hostile), false, `hostile input must be refused: ${hostile}`);
  assert.ok(rejectAuthoredText(hostile).code, "a refusal names what it found");
  const poisoned = structuredClone(adapted.definition);
  poisoned.pages[0].title = hostile;
  assert.equal(
    parseExperienceDefinition(poisoned).ok,
    false,
    `the schema must refuse a page titled: ${hostile}`,
  );
}
ok(`${HOSTILE.length} hostile strings are refused by the text boundary and by the schema`);

for (const ordinary of [
  "Satisfacción general del programa",
  "El 40 % de las personas respondió que sí",
  "Resultados 2025-2026 · comparación por generación",
  "¿Qué cambió respecto del semestre pasado?",
  "Costo/beneficio: 3 de cada 5 lo mencionan",
]) {
  assert.equal(isSafeAuthoredText(ordinary), true, `ordinary prose must pass: ${ordinary}`);
}
ok("ordinary Spanish prose, punctuation and percentages pass unharmed");

const definitionSource = await readCode("src/lib/experience/definition.ts");
for (const forbidden of [/dangerouslySetInnerHTML/, /eval\(/, /new Function/]) {
  assert.doesNotMatch(definitionSource, forbidden);
}
ok("the schema module contains no dynamic evaluation and no raw-HTML escape hatch");

// ===========================================================================
console.log("\n[5] Every list, every page and every nesting depth is bounded");
// ===========================================================================

const tooManyPages = structuredClone(fresh);
tooManyPages.pages = Array.from({ length: EXPERIENCE_LIMITS.pages + 1 }, (_, index) =>
  newPage(`overflow-${index}`, `Página ${index}`, index),
);
assert.equal(parseExperienceDefinition(tooManyPages).ok, false, "the page ceiling is enforced");

const registry = buildLegacyRegistry(snapshot);
const filler = newBlock({ type: "rich_text", seed: "filler", order: 0, registry });
const tooManyBlocks = structuredClone(fresh);
const page = newPage("overflowing", "Página", 0);
page.blocks = Array.from({ length: EXPERIENCE_LIMITS.blocksPerPage + 1 }, (_, index) => ({
  ...structuredClone(filler),
  id: mintId("block", `filler-${index}`),
}));
tooManyBlocks.pages = [page];
assert.equal(parseExperienceDefinition(tooManyBlocks).ok, false, "the per-page block ceiling is enforced");
ok("the page and block ceilings are enforced by the schema, not by convention");

assert.equal(EXPERIENCE_LIMITS.containerDepth, 1, "V1 blocks do not nest");
const blocksSource = await readCode("src/lib/experience/definition.ts");
assert.doesNotMatch(blocksSource, /z\.lazy\(/, "no recursive schema exists, so no depth can be exhausted");
assert.doesNotMatch(blocksSource, /get blocks\(\)/, "a block never contains blocks");
ok("the block structure is flat by construction — bounded depth with no recursion to bound");

assert.ok(withinSizeLimit(adapted.definition), "the adapted definition fits the byte ceiling");
assert.ok(serializedBytes(adapted.definition) > 0);
ok(`the serialized ceiling is checked (${serializedBytes(adapted.definition)} bytes for the fixture)`);

// ===========================================================================
console.log("\n[6] Layout cannot overlap and cannot overflow");
// ===========================================================================

for (const type of BLOCK_TYPES) {
  const layout = defaultLayout(type, 0);
  assert.equal(layout.mobile.span, GRID_COLUMNS, `${type} must be full width on a phone`);
  assert.deepEqual(layoutProblems(type, layout), [], `${type} must start from a valid layout`);
}
ok(`all ${BLOCK_TYPES.length} block types start full width on a phone and inside the grid`);

const narrowMobile = defaultLayout("metric", 0);
narrowMobile.mobile = { ...narrowMobile.mobile, span: 6 };
const mobileProblem = layoutProblems("metric", narrowMobile);
assert.equal(mobileProblem.length, 1);
assert.equal(mobileProblem[0].code, "mobile_not_full_width");
ok("a block narrower than the full width on a phone is a layout error");

for (const definitionPage of adapted.definition.pages) {
  const placed = definitionPage.blocks.map((block) => ({
    id: block.id,
    type: block.type,
    layout: block.layout,
  }));
  for (const breakpoint of BREAKPOINTS) {
    for (const width of rowWidths(placed, breakpoint)) {
      assert.ok(
        width <= GRID_COLUMNS,
        `“${definitionPage.title}” produced a ${width}-column row at ${breakpoint}`,
      );
    }
  }
}
ok("no adapted page produces a row wider than the grid at any of the three widths");

const layoutSource = await readCode("src/lib/experience/layout.ts");
for (const forbidden of [/position:\s*absolute/, /\bleft:\s*\$\{/, /\btop:\s*\$\{/, /zIndex/]) {
  assert.doesNotMatch(layoutSource, forbidden, "layout is a flow, never a coordinate system");
}
ok("the layout model exposes no pixel coordinate and no stacking order");

// ===========================================================================
console.log("\n[7] Hard errors block; soft warnings do not");
// ===========================================================================

const fixture = fixtureRegistry();
const scoped = {
  ...fresh,
  metadata: { ...fresh.metadata, studyId: fixture.scope.studyId, tenantId: fixture.scope.tenantId },
};

function blockWith(patch) {
  const base = newBlock({ type: "chart", seed: "probe", order: 0, registry: fixture });
  assert.ok(base, "the fixture registry must be able to produce a chart block");
  return { ...base, ...patch };
}

const unknownMetric = validateBlockQuery(
  { ...blockWith({}).query, metricId: "no_such_result" },
  fixture,
  { blockId: mintId("block", "probe"), type: "chart", variant: "bar_horizontal" },
);
assert.equal(unknownMetric.errors[0].code, "unknown_metric");
ok("a result the study does not have is a hard error");

const unknownDimension = validateBlockQuery(
  { ...blockWith({}).query, primaryDimensionId: "no_such_characteristic" },
  fixture,
  { blockId: mintId("block", "probe"), type: "chart", variant: "bar_horizontal" },
);
assert.ok(unknownDimension.errors.some((issue) => issue.code === "unknown_dimension"));
ok("a characteristic the study does not have is a hard error");

const badAggregation = validateBlockQuery(
  { ...blockWith({}).query, aggregation: "net_score", metricId: "return_on_investment" },
  fixture,
  { blockId: mintId("block", "probe"), type: "chart", variant: "bar_horizontal" },
);
assert.ok(badAggregation.errors.some((issue) => issue.code === "unsupported_aggregation"));
ok("an aggregation the result does not support is a hard error");

const impossible = validateBlockQuery(
  { ...blockWith({}).query, metricId: "satisfaction_overall", primaryDimensionId: null },
  fixture,
  { blockId: mintId("block", "probe"), type: "chart", variant: "bar_horizontal" },
);
assert.ok(impossible.errors.some((issue) => issue.code === "impossible_schema"));
ok("a bar chart with nothing to put on its axis is a hard error");

const wrongChart = validateBlockQuery(
  { ...blockWith({}).query, metricId: "recommendation", primaryDimensionId: "generation" },
  fixture,
  { blockId: mintId("block", "probe"), type: "chart", variant: "pie" },
);
assert.ok(wrongChart.errors.some((issue) => issue.code === "impossible_schema"));
ok("a result that cannot honestly be a pie is a hard error");

// The soft half: nine slices in a pie is a bad idea and a legitimate choice.
const crowdedRegistry = {
  ...fixture,
  metrics: fixture.metrics.map((metric) =>
    metric.id === "performance_band" ? { ...metric, charts: [...metric.charts] } : metric,
  ),
  dimensions: fixture.dimensions.map((dimension) =>
    dimension.id === "culture_category"
      ? {
          ...dimension,
          values: Array.from({ length: 9 }, (_, index) => ({
            value: `c${index}`,
            label: `Categoría número ${index + 1}`,
          })),
        }
      : dimension,
  ),
};
const crowded = validateBlockQuery(
  { ...blockWith({}).query, metricId: "performance_band", primaryDimensionId: "culture_category", aggregation: "share" },
  crowdedRegistry,
  { blockId: mintId("block", "probe"), type: "chart", variant: "pie" },
);
assert.deepEqual(crowded.errors, [], "a crowded pie must not be blocked");
assert.ok(crowded.warnings.some((issue) => issue.code === "crowded_categories"));
ok("a pie with nine slices warns and does not block");

const wide = validateBlockQuery(
  { ...blockWith({}).query, metricId: "satisfaction_overall", primaryDimensionId: "wide" },
  {
    ...fixture,
    dimensions: [
      ...fixture.dimensions,
      {
        id: "wide",
        label: "Demasiados valores",
        description: "",
        source: "",
        kind: "segment",
        values: Array.from({ length: EXPERIENCE_LIMITS.dimensionCardinality + 1 }, (_, index) => ({
          value: `v${index}`,
          label: `Valor ${index}`,
        })),
        filterEligible: true,
        journeyEligible: false,
        publicationReady: true,
      },
    ],
  },
  { blockId: mintId("block", "probe"), type: "chart", variant: "bar_horizontal" },
);
assert.ok(wide.errors.some((issue) => issue.code === "cardinality_ceiling"));
ok("a characteristic beyond the legibility ceiling is a hard error, not a warning");

// ===========================================================================
console.log("\n[8] A filter moves a block because a connection says so");
// ===========================================================================

const connected = structuredClone(adapted.definition);
const withQuery = allBlocks(connected).filter((block) => block.query);
assert.ok(withQuery.length >= 2, "the fixture must produce at least two blocks that read a result");
const [first, second] = withQuery;
assert.equal(
  first.query.primaryDimensionId ?? second.query.primaryDimensionId ?? null,
  first.query.primaryDimensionId ?? second.query.primaryDimensionId ?? null,
);

const filterId = connected.filterDefinitions[0].id;
connected.filterConnections = [
  { id: mintId("connection", "one-only"), filterId, blockIds: [first.id] },
];
assert.deepEqual(blocksAffectedBy(connected, filterId), [first.id]);
assert.ok(
  !blocksAffectedBy(connected, filterId).includes(second.id),
  "a block that merely shares a characteristic must NOT be moved by the filter",
);
assert.deepEqual(filtersAffecting(connected, second.id), []);
assert.deepEqual(filtersAffecting(connected, first.id), [filterId]);
ok("only the blocks a connection names respond to a filter");

const danglingConnection = structuredClone(adapted.definition);
danglingConnection.filterConnections = [
  {
    id: mintId("connection", "dangling"),
    filterId: danglingConnection.filterDefinitions[0].id,
    blockIds: [mintId("block", "not-in-this-document")],
  },
];
const danglingReport = validateExperienceDefinition(danglingConnection, adapted.registry);
assert.ok(danglingReport.errors.some((issue) => issue.code === "unknown_reference"));
ok("a connection naming a block that does not exist is a hard error");

// ===========================================================================
console.log("\n[9] Many journeys, each holding to the family it declares");
// ===========================================================================

const satisfactionOnly = satisfactionOnlyJourneyRegistry();
const journeyDefinition = {
  ...scoped,
  pages: [],
  journeyReferences: [
    {
      id: mintId("journey", "one"),
      title: "Recorrido de la persona socia",
      description: null,
      eligibleFamilies: ["satisfaction"],
      moments: [
        {
          id: mintId("moment", "one/a"),
          title: "Bienvenida",
          description: null,
          metricId: "satisfaction_onboarding",
          // THE MAPPING IS EXPLICIT: a result AND the exact recorded values
          // that mean "did not know it". A blank answer is neither half.
          awareness: {
            metricId: "moment_unknown_share",
            label: "No sabía que existía",
            values: ["100"],
          },
          body: null,
          variant: null,
          bandSchemeId: null,
          visible: true,
        },
      ],
      filterRefs: [],
      variant: "stepped",
      bandSchemeId: null,
      visible: true,
      origin: "composed",
      revision: 1,
    },
    {
      id: mintId("journey", "two"),
      title: "Recorrido de quien se fue",
      description: null,
      eligibleFamilies: ["satisfaction"],
      moments: [
        {
          id: mintId("moment", "two/a"),
          title: "Última renovación",
          description: null,
          metricId: "satisfaction_overall",
          awareness: null,
          body: null,
          variant: null,
          bandSchemeId: null,
          visible: true,
        },
      ],
      filterRefs: [],
      variant: "linear",
      bandSchemeId: null,
      visible: true,
      origin: "composed",
      revision: 1,
    },
  ],
};

const journeyParsed = parseExperienceDefinition(journeyDefinition);
assert.ok(journeyParsed.ok, `two journeys must parse: ${JSON.stringify(journeyParsed.issues ?? [])}`);
const journeyReport = validateExperienceDefinition(journeyDefinition, satisfactionOnly);
assert.deepEqual(journeyReport.errors, [], "two satisfaction journeys are valid");
ok("an experience carries two independent journeys");

const offFamily = structuredClone(journeyDefinition);
offFamily.journeyReferences[0].moments[0].metricId = "return_on_investment";
const offFamilyReport = validateExperienceDefinition(offFamily, satisfactionOnly);
assert.ok(
  offFamilyReport.errors.some(
    (issue) => issue.code === "unauthorized_field" || issue.code === "journey_family_mismatch",
  ),
  "a revenue result cannot sit on a satisfaction recorrido",
);
ok("satisfaction-only journey eligibility is enforced");

// The restriction is a real narrowing, not a restatement of the base registry:
// recommendation may carry a moment in the permissive configuration and may not
// in the satisfaction-only one.
const recommendationMoment = structuredClone(journeyDefinition);
recommendationMoment.journeyReferences[0].eligibleFamilies = ["satisfaction", "recommendation"];
recommendationMoment.journeyReferences[0].moments[0].metricId = "recommendation";
assert.deepEqual(
  validateExperienceDefinition(recommendationMoment, fixture).errors,
  [],
  "the permissive registry lets a recommendation result carry a moment",
);
assert.ok(
  validateExperienceDefinition(recommendationMoment, satisfactionOnly).errors.some(
    (issue) => issue.code === "unauthorized_field",
  ),
  "the satisfaction-only registry refuses the same moment",
);
assert.notEqual(
  registrySignature(fixture),
  registrySignature(satisfactionOnly),
  "the two configurations must be genuinely different registries",
);
ok("the satisfaction-only configuration narrows the permissive one rather than repeating it");

const unawareMoment = journeyDefinition.journeyReferences[0].moments[0];
assert.equal(unawareMoment.awareness.metricId, "moment_unknown_share");
assert.deepEqual(unawareMoment.awareness.values, ["100"], "and the values that mean it");
assert.ok(findMetric(satisfactionOnly, "moment_unknown_share"));
ok('the "did not know this moment" measure is modelled separately from the moment itself');

// ===========================================================================
console.log("\n[10] The compatibility adapter is pure, deterministic and honest");
// ===========================================================================

const frozen = JSON.stringify(snapshot);
const runA = adaptLegacyStudy(snapshot);
const runB = adaptLegacyStudy(snapshot);
assert.equal(JSON.stringify(snapshot), frozen, "the adapter must not mutate its input");
assert.equal(
  serializeExperienceDefinition(runA.definition),
  serializeExperienceDefinition(runB.definition),
  "the same study must always adapt to the same document",
);
assert.equal(definitionSignature(runA.definition), definitionSignature(runB.definition));
ok("adapting the same study twice produces byte-identical output and mutates nothing");

const adapterSource = await readCode("src/lib/experience/adapter.ts");
for (const forbidden of [/\.insert\(/, /\.update\(/, /\.upsert\(/, /\.delete\(/, /supabase/i, /createAdminClient/]) {
  assert.doesNotMatch(adapterSource, forbidden, "the adapter must not be able to reach a database");
}
ok("the adapter has no database import and no write of any kind");

assert.equal(
  runA.definition.sampleVisibilityPolicy.mode,
  "hide_below",
  "an adapted study keeps the disclosure rule it runs under today",
);
assert.equal(runA.definition.sampleVisibilityPolicy.threshold, LEGACY_SAMPLE_POLICY.threshold);
ok("the adapter preserves the legacy suppression rule rather than applying the new default");

const adaptedReport = validateExperienceDefinition(runA.definition, runA.registry);
assert.deepEqual(
  adaptedReport.errors,
  [],
  `the adapted definition must be valid: ${JSON.stringify(adaptedReport.errors)}`,
);
ok("the adapted definition passes semantic validation with no errors");

const titles = runA.definition.pages.map((definitionPage) => definitionPage.title);
for (const expected of ["Panorama", "Recorrido", "Permanencia", "Lo que dijeron", "Lectura del equipo"]) {
  assert.ok(titles.includes(expected), `the adapted experience must contain “${expected}”`);
}
const types = new Set(allBlocks(runA.definition).map((block) => block.type));
for (const expected of [
  // NO `cover`. Since schema version 2 the study's own name, client, period
  // and introduction are the global IDENTITY layer, not a block inside
  // Panorama — see the identity assertions below.
  "filter_panel",
  "metric",
  "finding",
  "comparison",
  "all_results_disclosure",
  "report_download",
  "journey",
  "retention",
  "qualitative_themes",
  "theme_cloud",
  "interpretation",
]) {
  assert.ok(types.has(expected), `the adapted experience must contain a ${expected} block`);
}
ok(`the current client experience is represented as ${titles.length} pages and ${types.size} block kinds`);

// ---------------------------------------------------------------------------
// The identity layer, and the fact that it is NOT a block
// ---------------------------------------------------------------------------
assert.equal(
  allBlocks(runA.definition).filter((block) => block.type === "cover").length,
  0,
  "an adapted study carries no cover block: its identity is the global layer",
);
assert.equal(runA.definition.identity.title, snapshot.studyName, "the identity carries the study's own name");
assert.equal(runA.definition.identity.organization, snapshot.clientName, "and the client it belongs to");
assert.equal(runA.definition.identity.period, snapshot.period, "and the period it covers");
assert.equal(
  runA.definition.identity.description,
  null,
  "and no introduction, because an introduction is authored work and is never invented",
);
assert.equal(runA.definition.identity.visible, true, "the identity is shown by default");
assert.equal(
  runA.definition.identity.show.description,
  false,
  "a part with nothing in it is not shown, so absence renders as nothing",
);
ok("the study's identity is a global layer carrying its name, client and period — and no cover block exists");

// The identity cannot be reordered with Panorama, because it is not in any
// page's block list. Asserted rather than described.
for (const page of runA.definition.pages) {
  assert.ok(
    !page.blocks.some((block) => block.title === runA.definition.identity.title && block.type === "cover"),
    "the identity must not also exist as a block on a page",
  );
}
ok("the identity appears in no page's block list, so no reorder or page duplication can move it");

assert.equal(runA.definition.journeyReferences.length, 1);
assert.equal(runA.definition.journeyReferences[0].origin, "legacy_journey_definition");
assert.equal(runA.definition.journeyReferences[0].moments.length, 3);
assert.equal(
  runA.definition.journeyReferences[0].moments[2].metricId,
  null,
  "a moment whose result the data no longer produces is preserved, visibly, without a number",
);
ok("the existing recorrido is represented, including the moment whose result has gone");

// THE WARNING THAT TURNED OUT TO BE A MODEL GAP. The deployed comparison
// explorer used to come back as "not representable" and was dropped. It is a
// `pivot_explorer` block now, so nothing is reported and nothing is lost — a
// compatibility adapter that silently loses a section the product ships is the
// one thing it may not be.
assert.ok(
  !runA.warnings.some((warning) => warning.code === "section_not_representable"),
  "the comparison explorer is carried rather than reported",
);
assert.ok(
  allBlocks(runA.definition).some((block) => block.type === "pivot_explorer"),
  "and it is carried as a block on the panorama page",
);
assert.ok(
  runA.warnings.some((warning) => warning.code === "metric_not_available"),
  "the moment whose result the data no longer produces is still reported",
);
ok("the comparison explorer is now a block, and the moment whose result has gone is still reported");

// THE TWO WARNINGS THAT TURNED OUT TO BE DEFECTS.
//
// A control is not a chart. Sixty is how many bars a person can compare; it is
// not how many options a select may hold, and the deployed dashboard already
// offers one over every imported `seg_` column. Refusing the 72-value
// characteristic dropped a filter the product ships.
const wideDimension = runA.definition.filterDefinitions.find((filter) => {
  const dimension = findDimension(runA.registry, filter.dimensionId);
  return dimension && dimension.values.length > EXPERIENCE_LIMITS.dimensionCardinality;
});
assert.ok(wideDimension, "a characteristic with 72 values is still offered as a filter control");
assert.ok(
  EXPERIENCE_LIMITS.filterOptions > EXPERIENCE_LIMITS.dimensionCardinality,
  "a control and a chart must not share one ceiling",
);
assert.ok(
  !runA.warnings.some((warning) => warning.code === "dimension_too_wide"),
  "a characteristic a control can hold is not reported as too wide",
);
ok("a characteristic too wide to draw is still offered as a filter, as the deployed dashboard offers it");

// The configured ideal range is a labelled band, and the model now carries one.
const thresholdBlocks = allBlocks(runA.definition).filter(
  (block) => block.query && block.query.comparison.kind === "target",
);
assert.ok(thresholdBlocks.length > 0, "the study's configured ideal range must land on a block");
for (const block of thresholdBlocks) {
  assert.equal(block.query.comparison.target, 70);
  assert.equal(block.query.comparison.targetMaximum, null);
  assert.equal(block.query.comparison.targetLabel, "Meta");
  assert.equal(
    block.query.metricId,
    findMetric(runA.registry, block.query.metricId).id,
    "the range sits on the block that shows that result",
  );
}
assert.ok(
  !runA.warnings.some((warning) => warning.code === "threshold_not_representable"),
  "a range the model can express is not reported as unrepresentable",
);
ok("the study's configured ideal range is carried as a target comparison on the result it is about");

// It still SAYS SO when it genuinely cannot place one.
const orphanThreshold = structuredClone(snapshot);
orphanThreshold.dashboardConfig.presentation.threshold = {
  metric: "no_such_result",
  minimum: 1,
  maximum: null,
  label: "Meta",
};
const orphanRun = adaptLegacyStudy(orphanThreshold);
assert.ok(
  orphanRun.warnings.some((warning) => warning.code === "threshold_not_representable"),
  "a range over a result no block shows is reported rather than dropped",
);
assert.deepEqual(
  validateExperienceDefinition(orphanRun.definition, orphanRun.registry).errors,
  [],
  "and the document stays valid",
);
ok("a configured range the experience cannot place is reported, not silently discarded");

// No canonical metric key ever appears in the document itself.
const serializedAdapted = serializeExperienceDefinition(runA.definition);
for (const metric of snapshot.metrics) {
  assert.ok(
    !serializedAdapted.includes(metric.key),
    `the document must not carry the canonical key ${metric.key}`,
  );
}
for (const dimension of snapshot.dimensions) {
  assert.ok(
    !serializedAdapted.includes(dimension.key),
    `the document must not carry the canonical key ${dimension.key}`,
  );
}
ok("no canonical metric or characteristic key appears anywhere in the serialized definition");

assert.equal(familyForMetric("nps_general"), "recommendation");
assert.equal(familyForMetric("sat_bienvenida"), "satisfaction");
assert.equal(familyForMetric("ltv_cliente"), "other");
ok("result families are derived from the same branching the engine already uses");

// ===========================================================================
console.log("\n[11] The prototype edits are pure and cannot orphan a reference");
// ===========================================================================

let state = initialState(runA.definition);
const target = allBlocks(state.definition)[1];

const renamed = setBlockTitle(state, target.id, "Un título nuevo");
assert.equal(allBlocks(renamed.definition).find((block) => block.id === target.id).title, "Un título nuevo");
assert.equal(
  allBlocks(renamed.definition).find((block) => block.id === target.id).id,
  target.id,
  "renaming a block must never move its identifier",
);
assert.equal(
  allBlocks(state.definition).find((block) => block.id === target.id).title,
  target.title,
  "an edit must not mutate the state it was given",
);
ok("renaming a block changes the title and nothing else — the identifier holds");

const hiddenBlock = setBlockVisibility(state, target.id, false);
assert.equal(allBlocks(hiddenBlock.definition).find((block) => block.id === target.id).visible, false);
assert.equal(
  allBlocks(hiddenBlock.definition).length,
  allBlocks(state.definition).length,
  "a hidden block stays in the document",
);
ok("hiding a block keeps it in place and renders it nowhere");

const duplicated = duplicateBlock(state, target.id);
assert.equal(allBlocks(duplicated.definition).length, allBlocks(state.definition).length + 1);
const copy = allBlocks(duplicated.definition).find(
  (block) => block.id !== target.id && block.title === `${target.title} (copia)`,
);
assert.ok(copy, "the copy exists and is named as one");
assert.notEqual(copy.id, target.id);
assert.deepEqual(filtersAffecting(duplicated.definition, copy.id), [], "a copy answers to no filter yet");
assert.ok(parseExperienceDefinition(duplicated.definition).ok);
ok("duplicating a block mints a new identifier and inherits no filter connection");

const removed = removeBlock(duplicated, copy.id);
assert.equal(allBlocks(removed.definition).length, allBlocks(state.definition).length);
const removedReport = validateExperienceDefinition(removed.definition, runA.registry);
assert.deepEqual(removedReport.errors, [], "removing a block must leave no dangling reference");
ok("removing a block cleans every connection that named it");

const movedDown = moveBlock(state, allBlocks(state.definition)[0].id, "down");
assert.notEqual(
  movedDown.definition.pages[0].blocks[0].id,
  state.definition.pages[0].blocks[0].id,
  "moving a block down changes the reading order",
);
assert.equal(movedDown.definition.pages[0].blocks[0].layout.desktop.order, 0, "order is renumbered");
assert.ok(parseExperienceDefinition(movedDown.definition).ok);
ok("moving a block reorders the page and renumbers every width");

const firstBlockId = state.definition.pages[0].blocks[0].id;
assert.equal(
  moveBlock(state, firstBlockId, "up").definition.pages[0].blocks[0].id,
  firstBlockId,
  "the first block cannot move above itself",
);
ok("a block at the edge of a page stays put");

const added = addBlock(state, state.definition.pages[0].id, "rich_text", runA.registry);
assert.equal(added.definition.pages[0].blocks.length, state.definition.pages[0].blocks.length + 1);
assert.ok(parseExperienceDefinition(added.definition).ok);
assert.deepEqual(validateExperienceDefinition(added.definition, runA.registry).errors, []);
ok("a block added from the catalogue produces a valid document");

const chartBlock = allBlocks(state.definition).find((block) => block.type === "comparison");
const revariant = setChartVariant(state, chartBlock.id, "table");
assert.equal(
  allBlocks(revariant.definition).find((block) => block.id === chartBlock.id).visualization.variant,
  "table",
);
const refused = setChartVariant(state, chartBlock.id, "treemap");
assert.equal(
  allBlocks(refused.definition).find((block) => block.id === chartBlock.id).visualization.variant,
  chartBlock.visualization.variant,
  "a variant the block type does not offer is ignored, never applied",
);
ok("a chart block changes only to a visualization its own type allows");

const switched = setStudySamplePolicy(state, "show_all");
assert.equal(switched.definition.sampleVisibilityPolicy.mode, "show_all");
assert.equal(
  evaluateSampleVisibility(1, switched.definition.sampleVisibilityPolicy).state,
  "visible",
  "switching an adapted study to show_all reveals a single answer",
);
assert.equal(
  runA.definition.sampleVisibilityPolicy.mode,
  "hide_below",
  "and the study it was adapted from is untouched",
);
ok("the study-wide rule can be changed without touching the adapted original");

const reset = resetToAdapted(addBlock(state, state.definition.pages[0].id, "divider", runA.registry), runA.definition);
assert.equal(
  serializeExperienceDefinition(reset.definition),
  serializeExperienceDefinition(runA.definition),
  "resetting returns exactly the study's current configuration",
);
ok("resetting restores the adapted study byte for byte");

// ===========================================================================
console.log("\n[12] The registries cover what the product needs to express");
// ===========================================================================

// Twenty: the eighteen the foundation declared, `pivot_explorer`, which closed
// the one gap the compatibility adapter could not carry, and `filter_panel` —
// the reader's own controls, placed like any other block.
assert.equal(BLOCK_TYPES.length, 20);
assert.ok(BLOCK_TYPES.includes("pivot_explorer"));
assert.ok(BLOCK_TYPES.includes("filter_panel"));
for (const type of BLOCK_TYPES) {
  const spec = blockSpec(type);
  assert.ok(spec.label && spec.description, `${type} must be described in words`);
  assert.ok(spec.span.min <= spec.span.default && spec.span.default <= spec.span.max);
  if (spec.requiresQuery) assert.ok(spec.allowsQuery, `${type} cannot require what it may not have`);
  if (spec.allowsVisualization) assert.ok(spec.variants.length > 0);
  if (spec.defaultVariant) assert.ok(spec.variants.includes(spec.defaultVariant));
}
ok(`all ${BLOCK_TYPES.length} block types are described, bounded and internally consistent`);

assert.equal(CHART_VARIANTS.length, 18);
for (const variant of CHART_VARIANTS) {
  const spec = CHART_SPECS[variant];
  assert.ok(spec.label && spec.description);
  assert.ok(spec.dimensions.min <= spec.dimensions.max);
  if (spec.rendererImplemented) {
    assert.equal(spec.alternative, null, `${variant} is drawn, so it names no stand-in`);
    assert.equal(alternativeVariant(variant), null);
  } else {
    assert.ok(spec.alternative, `${variant} has no renderer yet and must name a readable alternative`);
    // The alternative has to be something that IS drawn, and it is shown beside
    // the "not drawn yet" notice rather than instead of the variant.
    assert.ok(CHART_SPECS[alternativeVariant(variant)].rendererImplemented);
  }
}
// The twelve the milestone promised, plus the semáforo — which is implemented
// rather than disguised as an ordinary bar chart, and the traffic-light
// renderer refuses to colour anything without a range somebody agreed to.
for (const promised of [
  "kpi",
  "bar_horizontal",
  "bar_vertical",
  "bar_grouped",
  "bar_stacked",
  "bar_stacked_100",
  "line",
  "area",
  "pie",
  "donut",
  "table",
  "journey",
  "traffic_light",
  "retention_series",
  "theme_cloud",
]) {
  assert.ok(isRendererImplemented(promised), `${promised} must be genuinely implemented`);
}
/*
 * ALL EIGHTEEN ARE DRAWN NOW.
 *
 * The heat map, the bubbles and the proportional rectangles used to declare
 * themselves undrawn and offer a reference representation beside that
 * statement. They are real renderers, so they declare NO substitute — and that
 * absence is the assertion: `alternative: null` is what makes a silent swap
 * impossible, because there is nothing left to swap to.
 */
for (const drawn of ["heatmap", "bubble", "treemap"]) {
  assert.ok(isRendererImplemented(drawn), `${drawn} is drawn for real in this build`);
  assert.equal(
    CHART_SPECS[drawn].alternative,
    null,
    `${drawn} declares no substitute, because it no longer needs one`,
  );
}
assert.equal(implementedVariants().length, CHART_VARIANTS.length);
for (const variant of CHART_VARIANTS) {
  // NOTHING IS EVER SILENTLY SUBSTITUTED. A variant that is drawn has no
  // alternative; one that is not must name the representation offered BESIDE
  // the notice. Both halves, so neither can be forgotten.
  assert.equal(
    CHART_SPECS[variant].alternative === null,
    CHART_SPECS[variant].rendererImplemented,
    `${variant}: a drawn variant has no substitute, an undrawn one names its reference`,
  );
}
ok(`all ${CHART_VARIANTS.length} chart variants are drawn, and none declares a silent substitute`);

assert.deepEqual(
  compatibleVariants(["kpi", "bar_horizontal", "pie"], 1).sort(),
  ["bar_horizontal", "pie"],
  "compatibility is the intersection of what the result allows and what the chart needs",
);
assert.deepEqual(compatibleVariants(["kpi", "bar_horizontal"], 0), ["kpi"]);
ok("chart compatibility is computed from data, never from a special case");

const fixtureIds = new Set(fixture.metrics.map((metric) => metric.id));
for (const concept of [
  "satisfaction_overall",
  "recommendation",
  "renewal_probability",
  "return_on_investment",
  "performance_band",
  "moment_unknown_share",
]) {
  assert.ok(fixtureIds.has(concept), `the fixture must express “${concept}”`);
}
const fixtureDimensions = new Set(fixture.dimensions.map((dimension) => dimension.id));
for (const concept of ["generation", "membership_status", "time_in_membership", "culture_category", "performance_light"]) {
  assert.ok(fixtureDimensions.has(concept), `the fixture must express “${concept}”`);
}
assert.deepEqual(
  findDimension(fixture, "performance_light").values.map((entry) => entry.value),
  ["verde", "amarillo", "rojo"],
);
ok("generation, membership, tenure, culture, the traffic light, renewal, ROI and unawareness are all expressible as data");

const catalogueSource = await readCode("src/lib/experience/registry.ts");
for (const forbidden of [/\bBNI\b/i, /cuicuilco/i, /\bbni_/]) {
  assert.doesNotMatch(catalogueSource, forbidden, "generic code carries no client-specific key");
}
for (const file of ["blocks.ts", "charts.ts", "definition.ts", "validate.ts", "layout.ts", "adapter.ts", "data.ts", "editor.ts"]) {
  const source = await readCode(`src/lib/experience/${file}`);
  assert.doesNotMatch(source, /\bBNI\b/i, `${file} must stay client-agnostic`);
}
ok("no generic composer module contains a client-specific key");

// The demonstration fixture must stay out of every production path.
const importers = [];
for (const path of [
  "src/lib/experience/adapter.ts",
  "src/lib/experience/defaults.ts",
  "src/lib/experience/definition.ts",
  "src/lib/experience/editor.ts",
  "src/lib/experience/data.ts",
  "src/lib/experience/registry.ts",
  "src/lib/experience/validate.ts",
  "src/lib/experience/study-snapshot.ts",
  "src/lib/experience/storage.ts",
  "src/lib/experience/builder-workspace.ts",
  "src/components/studio/experience/ExperienceBuilder.tsx",
  "src/components/studio/experience/BlockView.tsx",
  "src/components/studio/experience/Charts.tsx",
  "src/app/studio/e/[studyId]/construccion/page.tsx",
  "src/app/studio/e/[studyId]/construccion/actions.ts",
]) {
  const source = await read(path);
  if (/from "[^"]*experience\/fixtures"/.test(source)) importers.push(path);
}
assert.deepEqual(importers, [], "the demonstration fixture must not be imported by production code");
ok("no production module imports the demonstration fixture");

assert.equal(registrySignature(fixture), registrySignature(fixtureRegistry()));
assert.notEqual(registrySignature(fixture), registrySignature(satisfactionOnly));
ok("the registry stamp is stable and changes when journey eligibility changes");

// ===========================================================================
console.log("\n[13] The theme-cloud contract is deterministic and never overlaps");
// ===========================================================================

const cloudInput = [
  { label: "Acompañamiento cercano", count: 12, evidenceHref: "/insights/e/x?tema=1" },
  { label: "Comunicación", count: 9, evidenceHref: null },
  { label: "Costo", count: 6, evidenceHref: null },
  { label: "Capacitación continua", count: 4, evidenceHref: null },
  { label: "Horario", count: 2, evidenceHref: null },
  { label: "Sin menciones", count: 0, evidenceHref: null },
];
const cloudA = layoutThemeCloud(cloudInput);
const cloudB = layoutThemeCloud(cloudInput);
assert.deepEqual(cloudA.placed, cloudB.placed, "the same themes always land in the same places");
assert.ok(cloudA.placed.length >= 4);
for (let i = 0; i < cloudA.placed.length; i += 1) {
  for (let j = i + 1; j < cloudA.placed.length; j += 1) {
    const a = cloudA.placed[i];
    const b = cloudA.placed[j];
    const apart =
      Math.abs(a.x - b.x) * 2 >= a.width + b.width || Math.abs(a.y - b.y) * 2 >= a.height + b.height;
    assert.ok(apart, `“${a.label}” and “${b.label}” overlap`);
  }
}
assert.ok(
  cloudA.placed[0].fontSize > cloudA.placed[cloudA.placed.length - 1].fontSize,
  "size follows the count",
);
assert.ok(!cloudA.ordered.some((theme) => theme.count === 0), "a theme nobody said is not a theme");
assert.equal(themeCloudAlternative(cloudA).length, cloudA.ordered.length);
assert.match(themeCloudAlternative(cloudA)[0], /12 menciones/);
ok("the theme cloud is deterministic, collision-free, size-by-count and has an ordered alternative");

// ===========================================================================
console.log("\n[14] Review, publication and schema migration are modelled");
// ===========================================================================

const basis = {
  schemaVersion: 1,
  registryVersion: registrySignature(fixture),
  dataRevision: "rev-1",
  samplePolicy: LEGACY_SAMPLE_POLICY,
  journeySignature: "j1",
  categorySignature: "c1",
  consentSignature: "k1",
};
assert.ok(approvalHolds(basis, { ...basis }));
assert.deepEqual(approvalInvalidations(basis, { ...basis, dataRevision: "rev-2" }), ["data_revision_changed"]);
assert.deepEqual(
  approvalInvalidations(basis, { ...basis, samplePolicy: DEFAULT_SAMPLE_POLICY }),
  ["sample_policy_changed"],
);
assert.deepEqual(
  approvalInvalidations(basis, { ...basis, registryVersion: registrySignature(satisfactionOnly) }),
  ["semantic_registry_changed"],
);
assert.deepEqual(approvalInvalidations(basis, { ...basis, categorySignature: "c2" }), ["categories_changed"]);
assert.deepEqual(approvalInvalidations(basis, { ...basis, consentSignature: "k2" }), ["consent_changed"]);
ok("changing the data, the registry, the categories, the consent or the disclosure rule invalidates an approval");

assert.equal(declaredVersion(runA.definition), EXPERIENCE_SCHEMA_VERSION);
assert.equal(declaredVersion({}), null);
assert.equal(migrateExperienceDefinition({ schemaVersion: 99 }).reason, "unknown_version");
assert.equal(
  migrateExperienceDefinition({ schemaVersion: EXPERIENCE_SCHEMA_VERSION }).reason,
  "invalid_document",
);
const migrated = migrateExperienceDefinition(JSON.parse(serializeExperienceDefinition(runA.definition)));
assert.ok(migrated.ok, "a stored definition round-trips through serialization and migration");
assert.equal(migrated.migratedFrom, EXPERIENCE_SCHEMA_VERSION);
ok("an unknown schema version is refused by name, and a stored document round-trips");

// ---------------------------------------------------------------------------
// VERSION 1 -> VERSION 2, against a document written under version 1
// ---------------------------------------------------------------------------
// The whole point of the migration: a draft somebody saved before the identity
// layer existed must OPEN, with its cover's words moved into the identity and
// no duplication left behind. Built here from the adapted version-2 document
// by putting it back into the shape version 1 had.
const asVersionOne = JSON.parse(serializeExperienceDefinition(runA.definition));
asVersionOne.schemaVersion = 1;
delete asVersionOne.identity;
const legacyFilterId = asVersionOne.filterDefinitions[0]?.id ?? null;
if (legacyFilterId) asVersionOne.filterDefinitions[0].defaultValues = [];
asVersionOne.pages = asVersionOne.pages.map((page, pageIndex) => ({
  ...page,
  blocks: (pageIndex === 0
    ? [
        {
          ...structuredClone(asVersionOne.pages[0].blocks[0]),
          id: mintId("block", "legacy/cover"),
          type: "cover",
          title: "La voz de la comunidad",
          query: null,
          visualization: null,
          journeyRef: null,
          image: null,
          filterRefs: [],
          copy: { eyebrow: null, body: "Cómo leer este informe.", caption: null, items: [] },
        },
        ...page.blocks,
      ]
    : page.blocks
  ).map((block) => {
    const { filterPanel, ...rest } = block;
    void filterPanel;
    if (rest.query) {
      const { fixedFilters, ...query } = rest.query;
      void fixedFilters;
      return { ...rest, query: { ...query, filterRefs: [] } };
    }
    return rest;
  }),
}));
// A version-1 document has no panels at all.
asVersionOne.pages = asVersionOne.pages.map((page) => ({
  ...page,
  blocks: page.blocks.filter((block) => block.type !== "filter_panel"),
}));
asVersionOne.filterConnections = asVersionOne.filterConnections
  .map((connection) => ({
    ...connection,
    blockIds: connection.blockIds.filter((blockId) =>
      asVersionOne.pages.some((page) => page.blocks.some((block) => block.id === blockId)),
    ),
  }))
  .filter((connection) => connection.blockIds.length > 0);

/*
 * A GENUINE VERSION-1 DOCUMENT CARRIES NOTHING VERSION 3 ADDED.
 *
 * Stripped rather than left in place, because a fixture that already contains
 * the fields the migration is supposed to ADD proves nothing about the
 * migration. Every one of these is asserted below to come back with the value
 * that means "not configured".
 */
delete asVersionOne.bandSchemes;
asVersionOne.journeyReferences = (asVersionOne.journeyReferences ?? []).map((journey) => {
  const { bandSchemeId, ...rest } = journey;
  void bandSchemeId;
  return {
    ...rest,
    moments: (rest.moments ?? []).map((moment) => {
      const { awareness, body, variant, bandSchemeId: momentScheme, ...momentRest } = moment;
      void awareness; void body; void variant; void momentScheme;
      return { ...momentRest, unawareMetricId: null, unawareLabel: null };
    }),
  };
});
asVersionOne.pages = asVersionOne.pages.map((page) => ({
  ...page,
  blocks: page.blocks.map((block) => {
    const { bandSchemeId, themeCloud, ...rest } = block;
    void bandSchemeId; void themeCloud;
    if (rest.visualization) {
      const { palette, ...visualization } = rest.visualization;
      void palette;
      return { ...rest, visualization };
    }
    return rest;
  }),
}));

const brought = migrateExperienceDefinition(asVersionOne);
assert.ok(brought.ok, `a version-1 draft must open: ${JSON.stringify(brought.detail ?? "")}`);
assert.equal(brought.migratedFrom, 1);
assert.equal(brought.definition.schemaVersion, EXPERIENCE_SCHEMA_VERSION);
assert.equal(
  brought.definition.identity.title,
  "La voz de la comunidad",
  "the cover's title becomes the identity's title",
);
assert.equal(
  brought.definition.identity.description,
  "Cómo leer este informe.",
  "and the cover's paragraph becomes the introduction",
);
assert.equal(
  allBlocks(brought.definition).filter((block) => block.type === "cover").length,
  0,
  "and the cover block is removed, so the study's name is not printed twice",
);
for (const block of allBlocks(brought.definition)) {
  assert.ok(
    !Object.prototype.hasOwnProperty.call(block.query ?? {}, "filterRefs"),
    "a version-1 query's filterRefs must not survive into version 2",
  );
  assert.ok(Array.isArray(block.query?.fixedFilters ?? []), "and it becomes fixedFilters");
  assert.equal(block.filterPanel, null, "no version-1 block becomes a panel");
}
ok("a version-1 draft opens as version 2: the cover becomes the identity, and nothing is duplicated or lost");

// ---------------------------------------------------------------------------
// VERSION 2 -> VERSION 3, against a document written under version 2
// ---------------------------------------------------------------------------
// Version 3 is PURELY ADDITIVE, so the whole test is one sentence: every
// identifier, every connection, every layout and every word comes back
// unchanged, and everything version 3 added arrives meaning "not configured".
const asVersionTwo = JSON.parse(serializeExperienceDefinition(runA.definition));
asVersionTwo.schemaVersion = 2;
delete asVersionTwo.bandSchemes;
asVersionTwo.journeyReferences = (asVersionTwo.journeyReferences ?? []).map((journey) => {
  const { bandSchemeId, ...rest } = journey;
  void bandSchemeId;
  return {
    ...rest,
    moments: (rest.moments ?? []).map((moment) => {
      const { awareness, body, variant, bandSchemeId: momentScheme, ...momentRest } = moment;
      void awareness; void body; void variant; void momentScheme;
      // Version 2 named a result and could not say which answers meant it.
      return { ...momentRest, unawareMetricId: momentRest.metricId, unawareLabel: "No lo conocía" };
    }),
  };
});
asVersionTwo.pages = asVersionTwo.pages.map((page) => ({
  ...page,
  blocks: page.blocks.map((block) => {
    const { bandSchemeId, themeCloud, ...rest } = block;
    void bandSchemeId; void themeCloud;
    if (rest.visualization) {
      const { palette, ...visualization } = rest.visualization;
      void palette;
      return { ...rest, visualization };
    }
    return rest;
  }),
}));

const three = migrateExperienceDefinition(asVersionTwo);
assert.ok(three.ok, `a version-2 draft must open: ${JSON.stringify(three.detail ?? "")}`);
assert.equal(three.migratedFrom, 2);
assert.equal(three.definition.schemaVersion, EXPERIENCE_SCHEMA_VERSION);
assert.deepEqual(three.definition.bandSchemes, [], "no semáforo scheme is invented");

// NOTHING MOVED. Identifiers, order, connections and words, all byte for byte.
assert.deepEqual(
  three.definition.pages.map((page) => [page.id, page.blocks.map((block) => block.id)]),
  runA.definition.pages.map((page) => [page.id, page.blocks.map((block) => block.id)]),
  "every page and every block keeps its identifier and its position",
);
assert.deepEqual(
  three.definition.filterConnections,
  runA.definition.filterConnections,
  "every filter connection survives untouched",
);
assert.deepEqual(
  three.definition.identity,
  runA.definition.identity,
  "and the identity layer is not touched twice",
);
assert.equal(
  allBlocks(three.definition).filter((block) => block.type === "cover").length,
  0,
  "no cover block is reintroduced by a second migration",
);

for (const block of allBlocks(three.definition)) {
  assert.equal(block.bandSchemeId, null, "no block is coloured by a semáforo nobody chose");
  if (block.visualization) {
    assert.equal(block.visualization.palette, "auto", "and every drawing starts on the automatic palette");
  }
  assert.equal(
    block.type === "theme_cloud" ? typeof block.themeCloud : block.themeCloud,
    block.type === "theme_cloud" ? "object" : null,
    "cloud settings appear on exactly the clouds",
  );
  if (block.type === "theme_cloud") {
    assert.equal(block.themeCloud.basis, "mentions", "and a migrated cloud keeps counting what it counted");
  }
}
for (const journey of three.definition.journeyReferences) {
  assert.equal(journey.bandSchemeId, null);
  for (const moment of journey.moments) {
    // THE HALF-CONFIGURED MEASURE IS DROPPED RATHER THAN COMPLETED. Version 2
    // named a result with no values; carrying it forward as an awareness
    // mapping would invent the missing half and print a percentage nobody set.
    assert.equal(moment.awareness, null, "a version-2 unaware result does not become a mapping");
    assert.equal(moment.body, null);
    assert.equal(moment.variant, null);
    assert.equal(moment.bandSchemeId, null);
    assert.ok(!("unawareMetricId" in moment), "and the old field does not survive");
  }
}
ok("a version-2 draft opens as version 3: nothing moves, and every new capability starts unconfigured");
// ===========================================================================
console.log("\n[15] The builder route and its Server Actions authorize first");
// ===========================================================================

const routePath = "src/app/studio/e/[studyId]/construccion/page.tsx";
const routeSource = await readCode(routePath);
assert.match(routeSource, /await requireInternal\(\)/, "the route must run the internal gate");
const gateAt = routeSource.indexOf("await requireInternal()");
for (const reader of ["loadStudioStudy(", "loadBuilderWorkspace(", "admin.from("]) {
  const at = routeSource.indexOf(reader);
  if (at >= 0) assert.ok(gateAt < at, `the route must authorize before ${reader}`);
}
assert.doesNotMatch(routeSource, /return null\s*;/, "a blank page is not a state");
assert.doesNotMatch(routeSource, /history\.back|router\.back/);
assert.match(routeSource, /z\.string\(\)\.uuid\(\)/, "the study identifier is validated");
ok("the builder route authorizes server-side before it reads anything");

const guardSource = await readCode("src/lib/studio/guard.ts");
assert.match(guardSource, /auth\.getUser\(\)/);
assert.doesNotMatch(guardSource, /getSession\(/);
assert.match(guardSource, /profile\?\.role !== "internal"/);
assert.match(guardSource, /redirect\("\/dashboard"\)/);
ok("a client-role caller is redirected by the same gate every Studio surface uses");

// --- The Server Actions re-authorize from scratch, and trust nothing sent.
const actionsSource = await readCode("src/app/studio/e/[studyId]/construccion/actions.ts");
assert.match(actionsSource, /^"use server";/m, "the actions are server actions");
assert.match(actionsSource, /auth\.getUser\(\)/, "identity is revalidated, not read from a claim");
assert.doesNotMatch(actionsSource, /getSession\(/, "never getSession for an authorization decision");
assert.match(actionsSource, /role !== "internal"/, "the role is read from the database");
for (const [pattern, message] of [
  [/parseExperienceDefinition\(rawDefinition\)/, "the submitted document goes through the strict boundary"],
  // The registry is the study's, rebuilt on the server, WIDENED by what the
  // parsed document itself derives — a configured semáforo that names the
  // result it classifies. Derived from the document and the study's own
  // registry, never taken from the request, which is what the next assertion
  // pins down.
  [/const registry = registryWithDerivedBands\(parsed\.definition, context\.registry\)/, "the registry is the study's, widened by what the document derives"],
  [/validateExperienceDefinition\(parsed\.definition, registry\)/, "and the document is validated against it"],
  [/metadata\.studyId !== studio\.study\.id/, "a document naming another study is refused"],
  [/metadata\.tenantId !== studio\.study\.tenantId/, "a document naming another client is refused"],
]) {
  assert.match(actionsSource, pattern, message);
}
// The tenant is never a parameter. It is derived from the study row, in the
// database function, where nothing the caller sent can reach it.
assert.doesNotMatch(
  actionsSource,
  /p_tenant|tenantId:\s*raw/,
  "the tenant is never taken from the request",
);
// The privileged client is created inside the role check, so a request that
// was never authorized never has one.
const actorAt = actionsSource.indexOf("function internalActor");
const adminAt = actionsSource.indexOf("createAdminClient()");
assert.ok(actorAt >= 0 && adminAt > actorAt, "the privileged client is created inside the role check");

/*
 * NO SERVER ACTION ON THE BUILDER MAY REVALIDATE A PATH.
 *
 * `revalidatePath` inside a Server Action makes Next re-render the current
 * route INSIDE the action's response. On this route that meant a second full
 * workspace load — every row of the study, the adapter, the registry and every
 * aggregate — in the request that had just done all of it to validate the
 * document. On the Cloudflare Worker, against the real study, the write landed
 * and the re-render then aborted, and the truncated payload's errored row
 * reached the browser as React error #441: the editor was replaced by the
 * Studio error boundary even though the save had succeeded.
 *
 * There is nothing to revalidate. The builder holds the document in client
 * state and the stored draft is read on a fresh page load, which is a new
 * request with its own budget.
 */
assert.doesNotMatch(
  actionsSource,
  /revalidatePath/,
  "the builder's Server Actions must not force a re-render of their own route",
);
const previewActionsSource = await readCode("src/app/studio/e/[studyId]/vista-previa/actions.ts");
assert.doesNotMatch(
  previewActionsSource,
  /revalidatePath/,
  "the draft preview's Server Action must not force a re-render of its own route either",
);
assert.match(previewActionsSource, /^"use server";/m, "the preview action is a server action");
assert.match(previewActionsSource, /auth\.getUser\(\)/, "and revalidates identity from scratch");
assert.doesNotMatch(previewActionsSource, /getSession\(/, "never getSession for an authorization decision");
assert.match(previewActionsSource, /role !== "internal"/, "and reads the role from the database");
ok("no builder or preview Server Action revalidates its own route, and both re-authorize from scratch");
ok("both Server Actions revalidate identity and role and re-validate the document server-side");

// --- Saving goes through one function, and that function is the only writer.
const storageSource = await readCode("src/lib/experience/storage.ts");
assert.match(storageSource, /^import "server-only";/m, "the storage layer is server-only");
assert.match(storageSource, /rpc\("save_study_experience_draft"/, "saving goes through the definer function");
for (const forbidden of [/\.insert\(/, /\.update\(/, /\.upsert\(/, /\.delete\(/]) {
  assert.doesNotMatch(storageSource, forbidden, "no direct write to the draft table");
}
assert.match(storageSource, /error\.code === "55000"/, "a lost update is reported as a conflict");
ok("the application never writes the draft table directly; one definer function does");

const workspaceSource = await readCode("src/lib/experience/builder-workspace.ts");
assert.match(workspaceSource, /^import "server-only";/m, "the workspace loader is server-only");
for (const forbidden of [/\.insert\(/, /\.update\(/, /\.upsert\(/, /\.delete\(/, /\.rpc\(/]) {
  assert.doesNotMatch(workspaceSource, forbidden, "the workspace loader only reads");
}
assert.doesNotMatch(workspaceSource, /quote_approved|"quote"/, "the builder never reads a quote");
// The projection that crosses to the browser is written out by hand, so adding
// a field to the workspace cannot ship the study's rows or the handle index.
const payloadAt = workspaceSource.indexOf("export function builderClientPayload");
assert.ok(payloadAt >= 0, "the client projection exists");
const payloadBody = workspaceSource.slice(payloadAt, workspaceSource.indexOf("export type BuilderClientPayload"));
assert.doesNotMatch(payloadBody, /\brows\b/, "the study rows never cross to the browser");
assert.doesNotMatch(payloadBody, /keyIndex/, "the handle-to-key index never crosses to the browser");
assert.doesNotMatch(payloadBody, /\.\.\.workspace\b/, "the projection is named, never a spread");
ok("what reaches the browser is a named projection with no rows and no handle index");

const snapshotSource = await readCode("src/lib/experience/study-snapshot.ts");
for (const forbidden of [/\.insert\(/, /\.update\(/, /\.upsert\(/, /\.delete\(/, /\.rpc\(/]) {
  assert.doesNotMatch(snapshotSource, forbidden, "the snapshot loader only reads");
}
assert.match(snapshotSource, /^import "server-only";/m, "the loader is server-only");
ok("the study snapshot loader is server-only and reads without writing");

for (const file of ["adapter.ts", "definition.ts", "editor.ts", "validate.ts", "defaults.ts", "data.ts"]) {
  const source = await readCode(`src/lib/experience/${file}`);
  assert.doesNotMatch(source, /server-only/, `${file} stays usable by an offline gate`);
}
ok("the model modules are pure enough to be driven by a credentials-free gate");

// --- The migration is additive, reversible, and denies the browser roles.
const migrationSource = await read("supabase/migrations/0023_experience_definition_persistence.sql");
for (const [pattern, message] of [
  [/create table if not exists public\.study_experience_draft/, "the draft table is created"],
  [/create table if not exists public\.study_experience_revision/, "the revision table is created"],
  [/create table if not exists public\.study_experience_event/, "the audit table is created"],
  [/alter table public\.study_experience_draft enable row level security/, "RLS is enabled on the draft"],
  [/alter table public\.study_experience_draft force row level security/, "and forced"],
  [/alter table public\.study_experience_revision force row level security/, "forced on revisions"],
  [/alter table public\.study_experience_event force row level security/, "forced on events"],
  [/create policy "deny_browser_roles" on public\.study_experience_draft[\s\S]{0,140}using \(false\) with check \(false\)/, "browser roles are denied outright"],
  [/revoke all privileges on table public\.study_experience_draft from anon, authenticated/, "browser grants revoked"],
  [/grant select on table public\.study_experience_draft to service_role/, "service_role may only read the draft"],
  [/before update on public\.study_experience_revision/, "a published revision refuses an update"],
  [/errcode = '42501', message = 'internal actor required'/, "a non-internal actor is refused in the database"],
  [/metadata,studyId/, "the document must name the study it is stored against"],
  [/metadata,tenantId/, "and the client"],
  [/revoke execute on function public\.save_study_experience_draft[\s\S]{0,160}from public, anon, authenticated/, "the browser roles cannot execute the writer"],
]) {
  assert.match(migrationSource, pattern, message);
}
// Additive: it creates, it does not destroy or rewrite anything that existed.
for (const forbidden of [
  /\bdelete from\b/i,
  /\btruncate\b/i,
  /alter table public\.(study|tenant|respondent|quant_response|qual_observation|profiles)\b/,
]) {
  assert.doesNotMatch(migrationSource, forbidden, "the migration must be additive only");
}
assert.doesNotMatch(
  migrationSource,
  /grant (?:insert|update|delete)[^\n]*study_experience/,
  "no role may write these tables directly",
);
ok("migration 0023 is additive, RLS-forced, browser-denied and writable only through its function");

// --- 0024 replaces one function body and nothing else.
const conflictSource = await read("supabase/migrations/0024_experience_draft_conflict_code.sql");
assert.match(
  conflictSource,
  /create or replace function public\.save_study_experience_draft/,
  "0024 replaces the writer",
);
assert.match(conflictSource, /errcode = '55000'/, "and raises a code the Data API delivers");
assert.doesNotMatch(conflictSource, /errcode = '40001'/, "40001 is gone: it is retried, not delivered");
// The three concurrency refusals, and only those, carry the conflict code.
assert.equal(
  (conflictSource.match(/errcode = '55000'/g) ?? []).length,
  3,
  "exactly the three concurrency refusals raise it",
);
for (const forbidden of [/create table/i, /alter table/i, /drop /i, /create policy/i, /delete from/i]) {
  assert.doesNotMatch(conflictSource, forbidden, "0024 touches nothing but the function body");
}
assert.match(
  conflictSource,
  /revoke execute on function public\.save_study_experience_draft[\s\S]{0,160}from public, anon, authenticated/,
  "and restates the privilege model rather than assuming it",
);
const conflictRollback = await read("supabase/rollbacks/0024_restore_experience_draft_conflict_code.sql");
assert.match(conflictRollback, /0023_experience_definition_persistence\.sql/, "0024 has a stated reverse");
assert.match(conflictRollback, /125 s|125 seconds|HTTP 504/, "and the reverse says what it costs");
ok("migration 0024 replaces one function body, and its reverse says what going back would cost");

const rollbackSource = await read("supabase/rollbacks/0023_drop_experience_persistence.sql");
for (const object of [
  "public.save_study_experience_draft",
  "public.study_experience_event",
  "public.study_experience_revision",
  "public.study_experience_draft",
  "public.refuse_experience_revision_update",
]) {
  assert.ok(rollbackSource.includes(object), `the rollback drops ${object}`);
}
assert.doesNotMatch(
  rollbackSource,
  /alter table public\.(study|tenant|respondent)\b/,
  "the rollback touches nothing else",
);
ok("the migration has a rollback that drops exactly what it created and nothing else");

// --- The client-facing renderers stay exactly where they were.
for (const path of [
  "src/app/insights/e/[studyId]/page.tsx",
  "src/app/studio/e/[studyId]/vista-cliente/page.tsx",
  "src/lib/dashboard/view.ts",
  "src/app/admin/preview/[studyId]/page.tsx",
]) {
  const source = await read(path);
  assert.doesNotMatch(
    source,
    /lib\/experience/,
    `${path} must not read a composed experience while nothing is published`,
  );
}
ok("the deployed client preview, the insights route and the dashboard view do not import the builder");

// The recorrido editor keeps the focus fix it was given.
const stageFields = await readCode("src/components/studio/JourneyStagesFields.tsx");
assert.match(stageFields, /key=\{draft\.uid\}/, "the recorrido editor still keys its rows on the stable uid");
assert.doesNotMatch(stageFields, /Math\.random|randomUUID|Date\.now/);
ok("the recorrido editor's focus behaviour is untouched");

// ===========================================================================
console.log("\n[16] The builder is operable by keyboard, named, and does not overflow");
// ===========================================================================

const builderSource = await readCode("src/components/studio/experience/ExperienceBuilder.tsx");
const blockViewSource = await readCode("src/components/studio/experience/BlockView.tsx");
const chartsSource = await readCode("src/components/studio/experience/Charts.tsx");

for (const [pattern, message] of [
  [/aria-live="polite"/, "what the last action did is announced"],
  [/aria-current=\{selected \? "true" : undefined\}/, "the selected block is announced as current"],
  [/aria-label=\{`Mover “\$\{name\}”\./, "the drag handle is named with the block it moves"],
  [/Usa las flechas arriba y abajo/, "and says that the arrow keys move it"],
  [/event\.key === "ArrowUp"/, "the handle actually moves the block with the keyboard"],
  [/event\.key === "ArrowDown"/, "in both directions"],
  [/aria-pressed=\{!block\.visible\}/, "the visibility toggle exposes its state"],
  [/<legend className="sr-only">/, "the disclosure choice is a named group"],
  [/htmlFor=\{`\$\{idPrefix\}-threshold`\}/, "the threshold input has a label"],
  [/htmlFor=\{`\$\{idPrefix\}-title`\}/, "the title input has a label"],
  [/htmlFor=\{`\$\{idPrefix\}-variant`\}/, "the visualization select has a label"],
  [/htmlFor=\{`\$\{idPrefix\}-metric`\}/, "the result select has a label"],
  [/htmlFor=\{`\$\{idPrefix\}-dim1`\}/, "the breakdown select has a label"],
  [/htmlFor=\{`\$\{idPrefix\}-add`\}/, "the add-a-block select has a label"],
  [/useId\(\)/, "identifiers for labels are unique per instance"],
]) {
  assert.match(builderSource, pattern, message);
}
ok("every control in the builder is labelled, named and announced");

// --- Drag and drop exists, and it is not the only way to reorder.
for (const [pattern, message] of [
  [/draggable\b/, "blocks can be dragged"],
  [/onDragStart=/, "a drag starts"],
  [/onDragOver=/, "a drop target is computed while dragging"],
  [/onDrop=/, "and a drop lands"],
  [/moveBlockToIndex/, "the drop is an ordinary editor operation"],
  [/cursor-grab/, "the handle looks draggable"],
]) {
  assert.match(builderSource, pattern, message);
}
ok("drag and drop is implemented, with a visible handle and a keyboard equivalent");

// --- The canvas carries two controls per block, not five.
const canvasBlockSource = builderSource.slice(builderSource.indexOf("function CanvasBlock"));
const canvasHeader = canvasBlockSource.slice(0, canvasBlockSource.indexOf("<BlockView"));
// Everything before the compact menu is a control the card shows all the time.
// What lives INSIDE the menu is behind a disclosure and does not crowd a
// quarter-width block, which is the whole point of moving it there.
const alwaysVisible = canvasHeader.slice(0, canvasHeader.indexOf("<Menu label="));
const permanentButtons = alwaysVisible.split("<button").length - 1;
assert.ok(
  permanentButtons <= 2,
  `a block on the canvas may show a drag handle and its name; found ${permanentButtons} permanent controls`,
);
const menuRegion = canvasHeader.slice(canvasHeader.indexOf("<Menu label="));
assert.ok(
  menuRegion.split("<button").length - 1 + menuRegion.split("<ConfirmAction").length - 1 >= 5,
  "and the menu is where duplicar, ocultar, subir, bajar and quitar actually live",
);
assert.match(canvasHeader, /<Menu label=/, "everything else lives in a compact menu");
assert.match(builderSource, /<ConfirmAction/, "a destructive action asks first");
assert.doesNotMatch(builderSource, /window\.confirm/, "and never through window.confirm");
ok("a canvas block shows a drag handle, its name and one menu, not five permanent buttons");

// --- Panels collapse on a computer and become drawers on a narrow screen.
for (const [pattern, message] of [
  [/setChrome\(\{ focus: false, left: !showLeft, right: showRight \}\)/, "the left panel collapses"],
  [/setChrome\(\{ focus: false, right: !showRight, left: showLeft \}\)/, "the right panel collapses"],
  [/setDrawer\(/, "and both become drawers"],
  [/lg:static/, "the same element is a column from lg up"],
  [/event\.key === "Escape"/, "Escape closes an open drawer"],
  [/lg:grid-cols-\[auto_minmax\(0,1fr\)\] xl:grid-cols-\[auto_minmax\(0,1fr\)_auto\]/, "the canvas is the flexible column, and the inspector waits for xl so it stays dominant"],
]) {
  assert.match(builderSource, pattern, message);
}
// One element, two behaviours: rendering the panel twice would give the same
// controls two sets of ids, which the responsive acceptance pass refuses.
assert.equal(
  (builderSource.match(/<Panel\b/g) ?? []).length,
  2,
  "there is exactly one left panel and one right panel in the tree",
);
ok("the panels collapse on a computer and become drawers below it, without duplicating a control");

/*
 * --- HIDING A PANEL GIVES THE CANVAS THE ROOM, AND FOCUS MODE HIDES BOTH. ---
 *
 * The four grid templates are asserted as complete literals, because that is
 * also what makes Tailwind emit them: a template assembled at run time is a
 * class that does not exist in the stylesheet, and the canvas would silently
 * fail to reflow with every gate still green.
 */
for (const [pattern, message] of [
  [
    /lg:grid-cols-\[minmax\(0,1fr\)\] xl:grid-cols-\[minmax\(0,1fr\)\]/,
    "with both panels hidden the canvas is the only column there is",
  ],
  [
    /lg:grid-cols-\[minmax\(0,1fr\)\] xl:grid-cols-\[minmax\(0,1fr\)_auto\]/,
    "hiding the left panel removes its track rather than leaving a zero-width one",
  ],
  [
    /lg:grid-cols-\[auto_minmax\(0,1fr\)\] xl:grid-cols-\[auto_minmax\(0,1fr\)\]/,
    "and hiding the right panel removes its track too",
  ],
  [/const showLeft = leftOpen && !focusMode;/, "focus mode hides the left panel without forgetting it"],
  [/const showRight = rightOpen && !focusMode;/, "and the right one"],
  [/Salir de modo enfoque/, "and it says how to leave, in words, on screen"],
  [/aria-pressed=\{focusMode\}/, "the focus control announces its own state"],
  [/Mostrar el panel de páginas y catálogo de bloques/, "a hidden left panel has a named way back"],
  [/Mostrar la ficha del bloque seleccionado/, "and so does a hidden right panel"],
  [/Ajustar al espacio/, "the canvas can be fitted to the room it actually has"],
  [/new ResizeObserver/, "which means measuring that room rather than guessing it"],
  [/MINIMUM_FIT_SCALE/, "with a floor, below which it pans instead of becoming a thumbnail"],
]) {
  assert.match(builderSource, pattern, message);
}

// FOCUS MODE MUST NOT BE A TRAP, AND ESCAPE MUST NOT BE STOLEN.
assert.match(
  builderSource,
  /if \(!focusMode \|\| drawer !== "none"\) return;/,
  "Escape belongs to an open drawer before it belongs to focus mode",
);
assert.match(
  builderSource,
  /role='dialog'/,
  "and to an open dialog before either",
);

// THE CHROME IS NEVER THE DOCUMENT. Toggling a panel must not be able to reach
// the reducer that owns the definition, so the save state cannot move.
const chromeCalls = builderSource.match(/setChrome\([^)]*\)/g) ?? [];
assert.ok(chromeCalls.length >= 5, "the chrome is changed through one named function");
for (const call of chromeCalls) {
  assert.doesNotMatch(
    call,
    /act\(|dispatch\(|definition/,
    `toggling a panel must not touch the document: ${call}`,
  );
}
// And it is read the one way that neither breaks hydration nor cascades.
assert.match(
  builderSource,
  /useSyncExternalStore\(subscribeChrome, readChrome, serverChrome\)/,
  "the chrome is read through the store React provides for browser-only state",
);
assert.match(
  builderSource,
  /function serverChrome\(\): ChromePreference \{\s*return DEFAULT_CHROME;/,
  "and the server renders the defaults, so there is nothing to mismatch",
);
assert.match(
  builderSource,
  /const dirty = signature !== savedSignature;/,
  "dirtiness is derived from the document alone, so chrome cannot make a draft dirty",
);
ok("hiding a panel expands the canvas, focus mode hides both, and neither is an edit");

/*
 * --- THE TWO PANELS ARE INDEPENDENT, AND THE SOURCE HAS TO SAY SO. ----------
 *
 * Every control that changes one side pins the other to what is on screen.
 * Without the pin, restoring the pages panel while focus mode is on drags the
 * inspector back with it — the panels stop being independent exactly when
 * somebody most expects them to be. Asserted as source, because the browser
 * gate can only sample combinations and this covers every writer of `left` or
 * `right` in the file.
 */
for (const [pattern, message] of [
  [/onCollapse=\{\(\) => setChrome\(\{ left: false \}\)\}/, "the left rail collapses only the left panel"],
  [/onCollapse=\{\(\) => setChrome\(\{ right: false \}\)\}/, "the right rail collapses only the right panel"],
  [/setChrome\(\{ focus: false, left: true, right: showRight \}\)/, "restoring the left panel pins the right one"],
  [/setChrome\(\{ focus: false, right: true, left: showLeft \}\)/, "restoring the right panel pins the left one"],
  [/setChrome\(\{ focus: false, left: !showLeft, right: showRight \}\)/, "the left toolbar toggle pins the right panel"],
  [/setChrome\(\{ focus: false, right: !showRight, left: showLeft \}\)/, "the right toolbar toggle pins the left panel"],
  [/data-collapse-rail=\{side\}/, "each panel carries an inner-edge collapse rail"],
  [/onDoubleClick=\{onCollapse\}/, "and the rail answers a double-click as an accelerator"],
  [/select-none/, "which cannot select text instead of collapsing"],
  [/draggable=\{false\}/, "and cannot be read as the start of a drag"],
  [/data-restore-tab="left"/, "a hidden left panel keeps a named restore tab"],
  [/data-restore-tab="right"/, "and so does a hidden right panel"],
]) {
  assert.match(builderSource, pattern, message);
}

// LEAVING FOCUS MODE IS THE ONE ACT THAT RESTORES THE PAIR, and it does it by
// writing `focus` alone — so the combination it returns to is whatever was
// there before, never a guess.
assert.match(
  builderSource,
  /onToggleFocus=\{\(\) => setChrome\(\{ focus: !focusMode \}\)\}/,
  "focus mode is toggled without writing either panel, so the pre-focus pair survives",
);

// NO WRITER OF ONE SIDE MAY LEAVE THE OTHER UNSAID. Every `setChrome` that
// names `left` or `right` must name both, except the two rails (which
// deliberately collapse one and touch nothing else) and the focus toggle.
for (const call of builderSource.match(/setChrome\(\{[^}]*\}\)/g) ?? []) {
  const names = { left: /\bleft:/.test(call), right: /\bright:/.test(call) };
  if (!names.left && !names.right) continue;
  const collapsingOne = /^setChrome\(\{ (left|right): false \}\)$/.test(call);
  assert.ok(
    collapsingOne || (names.left && names.right),
    `a control that moves one panel must pin the other: ${call}`,
  );
}
ok("the two panels are independent: every control moves one side and pins the other");

// --- Precision layout is a desktop job.
const inspectorSource = builderSource.slice(builderSource.indexOf("function Inspector"));
assert.match(
  inspectorSource,
  /className="hidden md:block"[\s\S]{0,400}Qué tan ancho se ve/,
  "the width control only appears from 768 px up",
);
assert.match(
  inspectorSource,
  /En teléfono cada bloque ocupa el ancho completo/,
  "and the phone rule is stated rather than silently enforced",
);
ok("column-width editing is offered on a computer and a tablet, and explained on a phone");

// --- Nothing forces the page sideways, and the document is never on screen.
for (const source of [builderSource, blockViewSource, chartsSource]) {
  assert.doesNotMatch(source, /dangerouslySetInnerHTML/);
  assert.match(source, /min-w-0/, "grid and flex children may shrink instead of widening the page");
}
assert.doesNotMatch(builderSource, /JSON\.stringify\(definition/, "the raw document is never rendered on screen");
assert.match(
  builderSource,
  /serializeExperienceDefinition\(definition, \{ pretty: true \}\)/,
  "the document leaves only through a download",
);
assert.match(
  builderSource,
  /setTimeout\(\(\) => URL\.revokeObjectURL/,
  "the export handle outlives the click that uses it",
);
assert.doesNotMatch(
  builderSource,
  /\bw-screen\b|\bmin-w-\[\s*\d{3,}px\]/,
  "nothing forces a width wider than a phone",
);
// Every wide thing scrolls inside its own box rather than pushing the page.
assert.ok(
  (chartsSource.match(/overflow-x-auto/g) ?? []).length >= 3,
  "the charts that can be wide carry their own scroller",
);
ok("wide content scrolls inside its own box and the serialized document is never rendered");

// --- Saving is real, visible, and says so.
for (const [pattern, message] of [
  [/Guardando…/, "the saving state has words"],
  [/"Guardado"/, "and so does the saved state"],
  [/No se pudo guardar/, "and so does the failure"],
  [/Guardar ahora/, "an explicit save is always available"],
  [/Reintentar/, "and a retry after a failure"],
  [/beforeunload/, "closing the tab mid-edit warns"],
  [/canUndo\(state\)/, "undo is offered"],
  [/canRedo\(state\)/, "and redo"],
  [/Ctrl\+Z/, "with the shortcut everybody already has"],
]) {
  assert.match(builderSource, pattern, message);
}
assert.doesNotMatch(
  builderSource,
  /Nada de lo que hagas aquí se guarda/,
  "the builder must no longer claim that nothing is saved",
);
/*
 * A DRAFT BELONGS TO THE STUDY; THE EDITOR'S CHROME BELONGS TO THE BROWSER.
 *
 * `localStorage` and `indexedDB` stay forbidden outright: anything a person
 * composes is stored server-side, under an optimistic-concurrency check, or it
 * is not stored. `sessionStorage` is allowed for exactly one thing — which
 * panels are open, whether focus mode is on and how far the canvas is zoomed —
 * because those are preferences of a person at a screen and putting them in
 * the document would mint a revision every time somebody widened the canvas.
 * The rule is enforced rather than trusted: every use names the chrome key,
 * and nothing about the document may be written to storage at all.
 */
assert.doesNotMatch(
  builderSource,
  /localStorage|indexedDB/,
  "a draft belongs to the study, not to one browser",
);
{
  const uses = builderSource.match(/sessionStorage\.(get|set|remove)Item\([^)]*/g) ?? [];
  assert.ok(uses.length > 0, "the editor remembers its own chrome for the session");
  for (const use of uses) {
    assert.match(
      use,
      /CHROME_PREFERENCE_KEY/,
      `browser storage may only carry the editor's chrome, not: ${use}`,
    );
  }
  assert.doesNotMatch(
    builderSource,
    /sessionStorage\.setItem\([^)]*(definition|signature|draft|revision)/i,
    "nothing about the document is ever written to browser storage",
  );
  const preference = builderSource.match(
    /type ChromePreference = \{[^}]*\}/,
  );
  assert.ok(preference, "the stored shape is declared");
  for (const field of ["left", "right", "focus", "zoom"]) {
    assert.ok(preference[0].includes(`${field}:`), `it carries ${field}`);
  }
  assert.doesNotMatch(
    preference[0],
    /definition|block|page|filter/i,
    "and it carries nothing about what is being composed",
  );
}
ok("the builder states its save state, offers an explicit save and a retry, and keeps undo");

assert.equal(studioStudyComposer("abc"), "/studio/e/abc/construccion");
assert.ok(
  !ADMIN_ALIASES.some((alias) => alias.studio.includes("construccion")),
  "the builder renames no legacy address away",
);
ok("the builder keeps its address and renames none away");

assert.match(routeSource, /Construcción del dashboard/, "the route names itself");
assert.match(routeSource, /el cliente no ve nada de esto/i, "and says the client cannot see it");
assert.doesNotMatch(routeSource, /prototipo/i, "it is no longer described as a prototype");
ok("the builder says what it is and what the client can see of it");

// The catalogue never offers a block this study cannot support.
for (const group of blockCatalogue()) {
  for (const spec of group.blocks) {
    if (!canAddBlock(spec.id, runA.registry, runA.definition.journeyReferences.length > 0)) continue;
    const created = newBlock({
      type: spec.id,
      seed: `catalogue/${spec.id}`,
      order: 0,
      registry: runA.registry,
      journeyId: runA.definition.journeyReferences[0]?.id ?? null,
    });
    assert.ok(created, `${spec.id} was offered and could not be built`);
    const probe = structuredClone(runA.definition);
    probe.pages[0] = { ...probe.pages[0], blocks: [...probe.pages[0].blocks, created] };
    const parsed = parseExperienceDefinition(probe);
    assert.ok(parsed.ok, `${spec.id} produced an invalid document: ${JSON.stringify(parsed.issues ?? [])}`);
    const semantic = validateExperienceDefinition(probe, runA.registry);
    assert.deepEqual(
      semantic.errors,
      [],
      `${spec.id} produced semantic errors: ${JSON.stringify(semantic.errors)}`,
    );
  }
}
ok("every block the catalogue offers builds a valid, semantically correct document");

// ===========================================================================
console.log("\n[17] The defects the acceptance review found stay fixed");
// ===========================================================================

// Scoped as one block so these fixtures cannot collide with the names the
// earlier sections already used at module level.
{
  // --- A new block never points at a characteristic the composer will not draw.
  const wideOnly = {
    scope: { tenantId: TENANT, studyId: STUDY },
    registryVersion: "wide-only",
    metrics: runA.registry.metrics,
    dimensions: [
      {
        id: "too_wide",
        label: "Giro",
        description: "Setenta y dos valores.",
        source: "Importación.",
        kind: "segment",
        values: wideValues.map((value) => ({ value, label: value })),
        filterEligible: true,
        journeyEligible: false,
        publicationReady: true,
      },
    ],
  };
  for (const group of blockCatalogue()) {
    for (const spec of group.blocks) {
      if (!canAddBlock(spec.id, wideOnly, true)) continue;
      const created = newBlock({
        type: spec.id,
        seed: `wide/${spec.id}`,
        order: 0,
        registry: wideOnly,
        journeyId: runA.definition.journeyReferences[0].id,
      });
      assert.ok(created, `${spec.id} was offered against a wide-only study and could not be built`);
      if (created.query && created.query.primaryDimensionId) {
        assert.ok(
          findDimension(wideOnly, created.query.primaryDimensionId).values.length
            <= EXPERIENCE_LIMITS.dimensionCardinality,
          `${spec.id} broke a result down by a characteristic beyond the legibility ceiling`,
        );
      }
    }
  }
  ok("a study whose only characteristic is unreadably wide never produces a block that breaks on it");

  // The offered/valid agreement holds against that hostile registry too.
  const wideProbe = {
    ...newExperience({ seed: "wide", title: "Wide", studyId: STUDY, tenantId: TENANT }),
    pages: [newPage("wide/page", "Página", 0)],
    journeyReferences: runA.definition.journeyReferences,
  };
  for (const group of blockCatalogue()) {
    for (const spec of group.blocks) {
      if (!canAddBlock(spec.id, wideOnly, true)) continue;
      const created = newBlock({
        type: spec.id,
        seed: `wide-valid/${spec.id}`,
        order: 0,
        registry: wideOnly,
        journeyId: runA.definition.journeyReferences[0].id,
      });
      const probe = structuredClone(wideProbe);
      probe.pages[0].blocks = [created];
      assert.ok(parseExperienceDefinition(probe).ok, `${spec.id} produced an invalid document`);
      assert.deepEqual(
        validateExperienceDefinition(probe, wideOnly).errors,
        [],
        `${spec.id} produced semantic errors against a wide-only study`,
      );
    }
  }
  ok("the catalogue and the factory agree about what is possible, whatever the study looks like");

  // --- Removing a block cannot orphan a filter, wherever the filter is named.
  const hosting = structuredClone(runA.definition);
  const hostBlock = hosting.pages[0].blocks[1];
  const readerBlock = hosting.pages[0].blocks.find(
    (block) => block.id !== hostBlock.id && block.query,
  );
  const blockFilterId = mintId("filter", "orphan/test");
  hosting.filterDefinitions = [
    ...hosting.filterDefinitions,
    {
      id: blockFilterId,
      dimensionId: hosting.filterDefinitions[0].dimensionId,
      label: "Filtro de un bloque",
      control: "single_select",
      defaultValues: [],
      clientVisible: true,
      scope: "block",
      pageId: null,
      dependsOn: null,
    },
  ];
  // TWO BLOCKS HOST THE SAME CONTROL. Since version 2 a block's author-fixed
  // narrowing carries its own characteristic and values and cannot reference a
  // viewer control at all, so "something else still names this filter" now
  // means another host, a page, a panel or a journey — never a query.
  hostBlock.filterRefs = [blockFilterId];
  readerBlock.filterRefs = [blockFilterId];
  hosting.filterConnections = [
    ...hosting.filterConnections,
    { id: mintId("connection", "orphan/test"), filterId: blockFilterId, blockIds: [readerBlock.id] },
  ];
  assert.ok(parseExperienceDefinition(hosting).ok, "the orphan fixture must itself be valid");
  assert.deepEqual(validateExperienceDefinition(hosting, runA.registry).errors, []);

  const afterHostRemoved = removeBlock(initialState(hosting), hostBlock.id);
  assert.equal(afterHostRemoved.refusal, null, "removing a block that exists is not a refusal");
  assert.ok(
    parseExperienceDefinition(afterHostRemoved.definition).ok,
    "the document stays well-formed after a removal",
  );
  assert.deepEqual(
    validateExperienceDefinition(afterHostRemoved.definition, runA.registry).errors,
    [],
    "removing the only block hosting a filter must not leave a dangling reference behind",
  );
  // STILL USED, SO IT STAYS. Another block still hosts this filter's control.
  // What must never happen — and did — is the filter being deleted while
  // something else keeps naming it.
  const survivingReader = allBlocks(afterHostRemoved.definition).find(
    (block) => block.id === readerBlock.id,
  );
  assert.deepEqual(
    survivingReader.filterRefs,
    [blockFilterId],
    "a filter another block still hosts is not deleted out from under it",
  );
  assert.ok(
    afterHostRemoved.definition.filterDefinitions.some((filter) => filter.id === blockFilterId),
    "the filter something still references survives the block that hosted its control",
  );
  ok("removing a block never deletes a filter another block still hosts");

  // NOTHING LEFT USING IT, SO IT GOES — and every mention of it goes too.
  const soleHost = structuredClone(hosting);
  for (const page of soleHost.pages) {
    page.filterRefs = page.filterRefs.filter((id) => id !== blockFilterId);
    for (const block of page.blocks) {
      if (block.id !== hostBlock.id) {
        block.filterRefs = block.filterRefs.filter((id) => id !== blockFilterId);
      }
    }
  }
  const afterSoleHostRemoved = removeBlock(initialState(soleHost), hostBlock.id);
  assert.ok(
    !afterSoleHostRemoved.definition.filterDefinitions.some(
      (filter) => filter.id === blockFilterId,
    ),
    "a block-scoped filter nothing still references leaves with its host",
  );
  assert.ok(
    !afterSoleHostRemoved.definition.filterConnections.some(
      (connection) => connection.filterId === blockFilterId,
    ),
    "and so does its connection",
  );
  assert.ok(parseExperienceDefinition(afterSoleHostRemoved.definition).ok);
  assert.deepEqual(
    validateExperienceDefinition(afterSoleHostRemoved.definition, runA.registry).errors,
    [],
    "and no mention of it is left behind to dangle",
  );
  ok("a filter with nothing left referencing it leaves, taking every mention with it");

  // A connection left naming nothing is dropped rather than kept as a statement
  // about blocks that no longer exist.
  const singleTarget = structuredClone(runA.definition);
  const lonely = singleTarget.pages[0].blocks[1];
  singleTarget.filterConnections = [
    {
      id: mintId("connection", "lonely"),
      filterId: singleTarget.filterDefinitions[0].id,
      blockIds: [lonely.id],
    },
  ];
  const afterLonelyRemoved = removeBlock(initialState(singleTarget), lonely.id);
  assert.deepEqual(
    afterLonelyRemoved.definition.filterConnections,
    [],
    "a connection that now names nothing is removed",
  );
  ok("an emptied connection does not survive the block it named");

  // --- Duplicating obeys the same ceilings as adding, and inherits no control.
  const withHostedFilter = structuredClone(runA.definition);
  const hostedSource = withHostedFilter.pages[0].blocks[1];
  hostedSource.filterRefs = [withHostedFilter.filterDefinitions[0].id];
  const copiedState = duplicateBlock(initialState(withHostedFilter), hostedSource.id);
  const copiedBlock = allBlocks(copiedState.definition).find(
    (block) => block.id === copiedState.selectedBlockId,
  );
  assert.deepEqual(copiedBlock.filterRefs, [], "a duplicate hosts no filter control of its own");
  assert.deepEqual(
    filtersAffecting(copiedState.definition, copiedBlock.id),
    [],
    "and answers to no connection",
  );
  ok("a duplicate inherits neither a connection nor a hosted control");

  let crowded = initialState(runA.definition);
  const crowdedPageId = crowded.definition.pages[0].id;
  let guard = 0;
  while (
    crowded.definition.pages[0].blocks.length < EXPERIENCE_LIMITS.blocksPerPage
    && guard < EXPERIENCE_LIMITS.blocksPerPage * 2
  ) {
    crowded = addBlock(crowded, crowdedPageId, "rich_text", runA.registry);
    guard += 1;
  }
  assert.equal(crowded.definition.pages[0].blocks.length, EXPERIENCE_LIMITS.blocksPerPage);
  const refusedAdd = addBlock(crowded, crowdedPageId, "rich_text", runA.registry);
  assert.equal(refusedAdd.definition, crowded.definition, "a refused add changes nothing");
  assert.ok(refusedAdd.refusal, "and says why");
  const refusedDuplicate = duplicateBlock(crowded, crowded.definition.pages[0].blocks[0].id);
  assert.equal(refusedDuplicate.definition, crowded.definition, "a refused duplicate changes nothing");
  assert.ok(refusedDuplicate.refusal, "and says why");
  assert.ok(
    parseExperienceDefinition(crowded.definition).ok,
    "the full page is still a document the schema accepts",
  );
  ok("duplicating is bounded by the same ceilings as adding, and both refuse out loud");

  // --- Every refusal is a sentence, and editing continues after one.
  const refusals = [
    moveBlock(initialState(runA.definition), runA.definition.pages[0].blocks[0].id, "up"),
    setChartVariant(initialState(runA.definition), runA.definition.pages[0].blocks[0].id, "pie"),
    removeBlock(initialState(runA.definition), mintId("block", "not-here")),
    setBlockSamplePolicy(initialState(runA.definition), runA.definition.pages[0].blocks[0].id, {
      kind: "override",
      policy: { ...DEFAULT_SAMPLE_POLICY },
    }),
  ];
  for (const refused of refusals) {
    assert.equal(typeof refused.refusal, "string", "a refusal must carry a reason");
    assert.ok(refused.refusal.length > 0);
    assert.equal(
      serializeExperienceDefinition(refused.definition),
      serializeExperienceDefinition(runA.definition),
      "a refusal changes nothing",
    );
    const afterwards = setBlockTitle(refused, runA.definition.pages[0].blocks[0].id, "Sigue editable");
    assert.equal(afterwards.refusal, null, "the next action clears the refusal");
  }
  ok("every refused action says why, changes nothing, and leaves the prototype editable");

  // --- A per-block override is reachable and behaves.
  const overridable = allBlocks(runA.definition).find(
    (block) => blockSpec(block.type).allowsSamplePolicyOverride,
  );
  const blockOverridden = setBlockSamplePolicy(initialState(runA.definition), overridable.id, {
    kind: "override",
    policy: { ...DEFAULT_SAMPLE_POLICY },
  });
  assert.equal(blockOverridden.refusal, null);
  const overriddenBlock = allBlocks(blockOverridden.definition).find(
    (block) => block.samplePolicy.kind === "override",
  );
  assert.ok(overriddenBlock, "the override is on the block");
  assert.equal(
    resolveSamplePolicy(blockOverridden.definition.sampleVisibilityPolicy, overriddenBlock.samplePolicy)
      .mode,
    "show_all",
    "and the block's own rule wins over the study's",
  );
  assert.ok(parseExperienceDefinition(blockOverridden.definition).ok);
  ok("a block can state its own disclosure rule, and it overrides the study's");

  // --- A drawing with no query behind it is still checked.
  const cloudBlock = allBlocks(runA.definition).find((block) => block.type === "theme_cloud");
  assert.ok(cloudBlock, "the adapted study has a theme cloud");
  assert.equal(cloudBlock.query, null, "and it carries no query");
  const asBubbles = setChartVariant(initialState(runA.definition), cloudBlock.id, "bubble");
  assert.equal(asBubbles.refusal, null, "a theme cloud may become bubbles");
  const bubbleReport = validateExperienceDefinition(asBubbles.definition, runA.registry);
  assert.ok(
    bubbleReport.warnings.some(
      (issue) => issue.code === "weak_mobile_fit" && issue.target.id === cloudBlock.id,
    ),
    "a drawing that reads badly on a phone is announced even with no query behind it",
  );
  /*
   * AND `no_renderer_yet` IS SILENT, BECAUSE THERE IS NOTHING LEFT TO ANNOUNCE.
   *
   * This assertion used `bubble` as its example of an undrawn variant. All
   * eighteen are drawn now, so the honest version of the check is the opposite
   * one: no variant in the catalogue can raise the warning, because none of
   * them declares itself missing.
   */
  assert.deepEqual(
    bubbleReport.warnings.filter((issue) => issue.code === "no_renderer_yet"),
    [],
    "no variant announces a missing renderer, because every one of them is drawn",
  );
  assert.deepEqual(bubbleReport.errors, [], "and none of that blocks anything");
  ok("a block that draws without a query is still told what its drawing costs on a phone");

  // --- The target comparison carries a range, and refuses an impossible one.
  const targetBlock = allBlocks(runA.definition).find(
    (block) => block.query && block.query.comparison.kind === "target",
  );
  const withComparison = (comparison) => {
    const next = structuredClone(runA.definition);
    for (const page of next.pages) {
      for (const block of page.blocks) {
        if (block.id === targetBlock.id) block.query.comparison = comparison;
      }
    }
    return next;
  };
  assert.ok(
    !parseExperienceDefinition(
      withComparison({ kind: "target", target: 90, targetMaximum: 10, targetLabel: "Meta" }),
    ).ok,
    "an ideal range that ends before it starts is refused",
  );
  assert.ok(
    !parseExperienceDefinition(
      withComparison({ kind: "target", target: null, targetMaximum: null, targetLabel: "Meta" }),
    ).ok,
    "a target with neither bound is refused",
  );
  assert.ok(
    !parseExperienceDefinition(
      withComparison({ kind: "none", target: null, targetMaximum: 5, targetLabel: null }),
    ).ok,
    "only a target comparison carries a range",
  );
  assert.ok(
    parseExperienceDefinition(
      withComparison({ kind: "target", target: null, targetMaximum: 3, targetLabel: "Tope" }),
    ).ok,
    "an open-ended maximum is a real target",
  );
  ok("the ideal range is bounded, ordered and exclusive to the comparison that owns it");

  // --- The builder interface offers what the acceptance list asks for.
  for (const [pattern, message] of [
    [/aria-label="Páginas de la experiencia"/, "the pages are a named navigation region"],
    [/aria-current=\{entry\.id === openPageId \? "page" : undefined\}/, "the open page is announced"],
    [/aria-pressed=\{preview === breakpoint\}/, "the width preview exposes which width is shown"],
    [/setBlockSamplePolicy/, "a block's own disclosure rule is reachable from the interface"],
    [/compatibleVariants/, "the chart choices are grouped by what the result can honestly become"],
    [/No compatibles con este resultado/, "and the incompatible ones are named as such"],
    [/isRendererImplemented/, "a variant with no renderer is named as such rather than swapped"],
    [/todavía no se dibuja/, "and says so rather than pretending"],
    [/setTimeout\(\(\) => URL\.revokeObjectURL/, "the export handle outlives the click that uses it"],
    [/editor\.refusal \?\?/, "a refused action is announced to the person who attempted it"],
    [/\{ui\.notice \?\? ""\}/, "and the announcement has a live region to land in"],
    [/setFilterConnection/, "a filter is connected to a block deliberately"],
    [/setBlockMetric/, "the block's result can be reassigned"],
    [/setBlockDimension/, "and so can its breakdown"],
    [/addPage|duplicatePage|removePage/, "pages can be added, copied and removed"],
  ]) {
    assert.match(builderSource, pattern, message);
  }
  // The draft is never in a browser. The chrome preference is, deliberately and
  // only, and §16 above is where that exception is spelled out and bounded.
  assert.doesNotMatch(
    builderSource,
    /localStorage|indexedDB/i,
    "a draft lives in the study, never in one browser",
  );
  ok("the builder offers pages, a width preview, per-block rules and honest chart labelling");
}



// ===========================================================================
console.log("\n[18] The editor persists a real workflow: pages, history, data");
// ===========================================================================

{
  const base = adaptLegacyStudy(snapshot);
  const registry = base.registry;

  // --- Undo and redo are documents, bounded, and survive a selection. -------
  let session = initialState(base.definition);
  assert.equal(canUndo(session), false, "a fresh session has nothing to undo");
  assert.equal(canRedo(session), false);
  assert.ok(undo(session).refusal, "and says so rather than doing nothing quietly");

  const firstBlock = base.definition.pages[0].blocks[0];
  session = setBlockTitle(session, firstBlock.id, "Un título nuevo");
  assert.equal(canUndo(session), true);
  const titled = serializeExperienceDefinition(session.definition);
  session = undo(session);
  assert.equal(
    serializeExperienceDefinition(session.definition),
    serializeExperienceDefinition(base.definition),
    "undo restores the previous document byte for byte",
  );
  assert.equal(canRedo(session), true);
  session = redo(session);
  assert.equal(serializeExperienceDefinition(session.definition), titled, "and redo puts it back");

  // A new edit after an undo abandons the redo branch — the ordinary rule
  // every editor has, stated rather than assumed.
  session = undo(session);
  session = setBlockTitle(session, firstBlock.id, "Otro título");
  assert.equal(canRedo(session), false, "editing after an undo drops what was undone");

  // Selecting and opening a page change nothing, so they push no history step.
  const before = session.past.length;
  session = selectBlock(session, firstBlock.id);
  session = openPage(session, base.definition.pages[0].id);
  assert.equal(session.past.length, before, "navigating is not an edit");

  // Taking the version somebody else saved CLEARS the history. "Undo" after
  // adopting a stranger's document would restore a document whose revision no
  // longer exists, and the next save would conflict again with no explanation.
  let conflicted = setBlockTitle(initialState(base.definition), firstBlock.id, "Lo mío");
  assert.equal(canUndo(conflicted), true);
  const theirs = adaptLegacyStudy({ ...snapshot, studyName: "Lo que guardó la otra persona" }).definition;
  conflicted = adoptDefinition(conflicted, theirs);
  assert.equal(
    serializeExperienceDefinition(conflicted.definition),
    serializeExperienceDefinition(theirs),
    "the stored version replaces what was on screen",
  );
  assert.equal(canUndo(conflicted), false, "and the history goes with it");
  assert.equal(canRedo(conflicted), false);
  ok("taking the version somebody else saved replaces the document and clears the history");

  // Undo past a removal restores the block AND everything that referenced it.
  const removable = base.definition.pages[0].blocks[1];
  let removing = initialState(base.definition);
  removing = removeBlock(removing, removable.id);
  assert.ok(!findBlock(removing.definition, removable.id));
  removing = undo(removing);
  assert.ok(findBlock(removing.definition, removable.id), "undo brings the block back");
  assert.equal(
    serializeExperienceDefinition(removing.definition),
    serializeExperienceDefinition(base.definition),
    "with every connection it had",
  );
  ok("undo and redo restore whole documents, and navigating is not an edit");

  // --- Dropping a block lands it exactly where the line was. ---------------
  const page = base.definition.pages[0];
  assert.ok(page.blocks.length >= 4, "the fixture page is long enough to reorder");
  const moved = page.blocks[0];
  const dropped = moveBlockToIndex(initialState(base.definition), moved.id, 2);
  assert.equal(dropped.definition.pages[0].blocks[2].id, moved.id, "the block lands at the index");
  assert.equal(
    dropped.definition.pages[0].blocks.length,
    page.blocks.length,
    "and nothing is lost on the way",
  );
  for (const [position, block] of dropped.definition.pages[0].blocks.entries()) {
    for (const breakpoint of BREAKPOINTS) {
      assert.equal(block.layout[breakpoint].order, position, "order is re-derived at every width");
    }
  }
  const noop = moveBlockToIndex(initialState(base.definition), moved.id, 0);
  assert.equal(noop.definition, base.definition, "dropping a block where it already is changes nothing");
  assert.ok(parseExperienceDefinition(dropped.definition).ok);
  ok("a drop lands a block at an exact position and renumbers every width");

  // --- Pages: add, rename, reorder, duplicate, hide, remove. ---------------
  let pages = initialState(base.definition);
  const originalPageCount = pages.definition.pages.length;

  pages = addPage(pages, "  Una página nueva  ");
  assert.equal(pages.definition.pages.length, originalPageCount + 1);
  assert.equal(pages.definition.pages[originalPageCount].title, "Una página nueva", "the title is trimmed");
  assert.equal(pages.openPageId, pages.definition.pages[originalPageCount].id, "and it opens");
  assert.ok(addPage(pages, "   ").refusal, "a page with no name is refused out loud");

  const addedId = pages.definition.pages[originalPageCount].id;
  pages = renamePage(pages, addedId, "Renombrada");
  assert.equal(pages.definition.pages[originalPageCount].title, "Renombrada");
  assert.ok(renamePage(pages, addedId, "   ").refusal, "a page cannot be left nameless");
  // The identifier never moves when the label does — the defect the recorrido
  // editor was rescued from, prevented here by construction.
  assert.equal(pages.definition.pages[originalPageCount].id, addedId, "renaming never moves an id");

  pages = movePage(pages, addedId, "up");
  assert.equal(pages.definition.pages[originalPageCount - 1].id, addedId);
  assert.equal(pages.definition.pages[originalPageCount - 1].order, originalPageCount - 1);
  assert.ok(movePage(pages, pages.definition.pages[0].id, "up").refusal, "the first page cannot go up");

  pages = setPageVisibility(pages, addedId, false);
  assert.equal(pages.definition.pages.find((entry) => entry.id === addedId).visible, false);

  // Duplicating a page mints a fresh id for the page AND for every block on it.
  const source = base.definition.pages[0];
  let duplicated = duplicatePage(initialState(base.definition), source.id);
  const copy = duplicated.definition.pages[1];
  assert.notEqual(copy.id, source.id, "the copy is a different page");
  assert.equal(copy.blocks.length, source.blocks.length);
  const sourceIds = new Set(source.blocks.map((block) => block.id));
  for (const block of copy.blocks) {
    assert.ok(!sourceIds.has(block.id), "no block id is reused across pages");
    assert.deepEqual(block.filterRefs, [], "a copied page hosts no control of its own");
    assert.deepEqual(
      filtersAffecting(duplicated.definition, block.id),
      [],
      "and answers to no connection",
    );
  }
  assert.ok(parseExperienceDefinition(duplicated.definition).ok, "the copy is a document the schema accepts");
  assert.deepEqual(
    validateExperienceDefinition(duplicated.definition, registry).errors,
    [],
    "and one the registry accepts",
  );
  ok("pages can be added, renamed, reordered, hidden and duplicated without moving an identifier");

  // --- Removing a page cleans up after itself, exactly like removing a block.
  const withPageFilter = structuredClone(base.definition);
  const targetPage = withPageFilter.pages[1] ?? withPageFilter.pages[0];
  withPageFilter.filterDefinitions.push({
    id: mintId("filter", "page-scoped"),
    dimensionId: registry.dimensions[0].id,
    label: "Solo de esta página",
    control: "single_select",
    defaultValues: [],
    clientVisible: true,
    scope: "page",
    pageId: targetPage.id,
    dependsOn: null,
  });
  const pageFilterId = withPageFilter.filterDefinitions[withPageFilter.filterDefinitions.length - 1].id;
  targetPage.filterRefs = [pageFilterId];
  assert.ok(parseExperienceDefinition(withPageFilter).ok, "the fixture with a page filter is valid");

  const removedPage = removePage(initialState(withPageFilter), targetPage.id);
  assert.ok(
    !removedPage.definition.pages.some((entry) => entry.id === targetPage.id),
    "the page is gone",
  );
  assert.ok(
    !removedPage.definition.filterDefinitions.some((filter) => filter.id === pageFilterId),
    "and the filter that could only live on it went with it",
  );
  const serializedAfter = serializeExperienceDefinition(removedPage.definition);
  assert.ok(!serializedAfter.includes(pageFilterId), "with no mention left behind to dangle");
  for (const block of targetPage.blocks) {
    assert.ok(!serializedAfter.includes(block.id), "and no connection still names a removed block");
  }
  assert.ok(parseExperienceDefinition(removedPage.definition).ok);
  assert.deepEqual(validateExperienceDefinition(removedPage.definition, registry).errors, []);

  // The last page cannot be removed: an experience with no page is not a thing.
  let single = initialState(base.definition);
  while (single.definition.pages.length > 1) {
    single = removePage(single, single.definition.pages[single.definition.pages.length - 1].id);
  }
  const refusedLast = removePage(single, single.definition.pages[0].id);
  assert.equal(refusedLast.definition, single.definition, "removing the last page changes nothing");
  assert.ok(refusedLast.refusal, "and says why");
  ok("removing a page takes its filters with it and never leaves a dangling reference");

  // --- Reassigning a result, a breakdown and an aggregation. ---------------
  const chartBlock = allBlocks(base.definition).find(
    (block) => block.query && block.visualization && block.type === "chart",
  ) ?? allBlocks(base.definition).find((block) => block.query && block.visualization);
  assert.ok(chartBlock, "the adapted study has a block that reads a result");

  let editing = initialState(base.definition);
  const otherMetric = registry.metrics.find((metric) => metric.id !== chartBlock.query.metricId);
  editing = setBlockMetric(editing, chartBlock.id, otherMetric.id, registry);
  assert.equal(editing.refusal, null, "a known result is accepted");
  const edited = findBlock(editing.definition, chartBlock.id).block;
  assert.equal(edited.query.metricId, otherMetric.id);
  assert.deepEqual(
    edited.query.numberFormat,
    otherMetric.format,
    "the result decides how its own number is written down",
  );
  assert.ok(
    otherMetric.aggregations.includes(edited.query.aggregation),
    "and the aggregation is one it supports",
  );
  assert.ok(
    setBlockMetric(editing, chartBlock.id, "r_not_a_handle", registry).refusal,
    "an unknown result is refused out loud",
  );
  assert.ok(
    setBlockAggregation(editing, chartBlock.id, "sum", registry).refusal
      || otherMetric.aggregations.includes("sum"),
    "an aggregation the result does not support is refused",
  );

  const narrow = registry.dimensions.find(
    (dimension) => dimension.values.length > 0 && dimension.values.length <= 12,
  );
  const wide = registry.dimensions.find(
    (dimension) => dimension.values.length > EXPERIENCE_LIMITS.dimensionCardinality,
  );
  editing = setBlockDimension(editing, chartBlock.id, "primary", narrow.id, registry);
  assert.equal(editing.refusal, null);
  assert.equal(findBlock(editing.definition, chartBlock.id).block.query.primaryDimensionId, narrow.id);
  if (wide) {
    const refusedWide = setBlockDimension(editing, chartBlock.id, "primary", wide.id, registry);
    assert.equal(refusedWide.definition, editing.definition, "an unreadable breakdown changes nothing");
    assert.ok(refusedWide.refusal, "and says how many values it has");
  }
  const refusedSame = setBlockDimension(editing, chartBlock.id, "secondary", narrow.id, registry);
  assert.ok(refusedSame.refusal, "the same characteristic twice is refused");

  // Clearing the first characteristic promotes the second rather than leaving a
  // document the schema refuses.
  const second = registry.dimensions.find(
    (dimension) => dimension.id !== narrow.id && dimension.values.length > 0
      && dimension.values.length <= EXPERIENCE_LIMITS.dimensionCardinality,
  );
  if (second) {
    let crossed = setBlockDimension(editing, chartBlock.id, "secondary", second.id, registry);
    if (crossed.refusal === null) {
      crossed = setBlockDimension(crossed, chartBlock.id, "primary", null, registry);
      const query = findBlock(crossed.definition, chartBlock.id).block.query;
      assert.equal(query.primaryDimensionId, second.id, "the second characteristic is promoted");
      assert.equal(query.secondaryDimensionId, null);
      assert.ok(parseExperienceDefinition(crossed.definition).ok);
    }
  }
  assert.ok(parseExperienceDefinition(editing.definition).ok);
  assert.deepEqual(validateExperienceDefinition(editing.definition, registry).errors, []);
  ok("a block's result, aggregation and breakdown can be reassigned, and an impossible one is refused");

  // --- A pie divides a whole, so it refuses an aggregation that does not. ---
  const pieProbe = structuredClone(base.definition);
  const pieBlock = pieProbe.pages
    .flatMap((entry) => entry.blocks)
    .find((block) => block.id === chartBlock.id);
  pieBlock.visualization = { ...pieBlock.visualization, variant: "pie" };
  pieBlock.query = {
    ...pieBlock.query,
    aggregation: "average",
    primaryDimensionId: narrow.id,
    secondaryDimensionId: null,
  };
  const pieAverage = validateExperienceDefinition(pieProbe, registry);
  assert.ok(
    pieAverage.errors.some((issue) => issue.code === "impossible_schema"),
    "a pastel of averages is refused: the slices do not add up to the total",
  );
  pieBlock.query = { ...pieBlock.query, aggregation: "count" };
  const pieCount = validateExperienceDefinition(pieProbe, registry);
  assert.deepEqual(pieCount.errors, [], "counting answers does divide a whole, so the pastel is allowed");
  ok("a drawing that divides a whole accepts only an aggregation whose parts add up to one");

  // --- Filter connections are made and broken deliberately. ----------------
  const filterId = base.definition.filterDefinitions[0]?.id;
  if (filterId) {
    // AN ELIGIBLE ONE. Since the capability model, connecting a filter to a
    // block that shows nothing recomputable is refused with a reason, so the
    // block this picks has to be one that CAN respond — which is asserted
    // separately, below.
    const lonely = allBlocks(base.definition).find(
      (block) =>
        isFilterTargetable(block)
        && !filtersAffecting(base.definition, block.id).includes(filterId),
    );
    let wiring = initialState(base.definition);
    if (lonely) {
      wiring = setFilterConnection(wiring, filterId, lonely.id, true);
      assert.equal(wiring.refusal, null);
      assert.ok(filtersAffecting(wiring.definition, lonely.id).includes(filterId));
      assert.ok(
        setFilterConnection(wiring, filterId, lonely.id, true).refusal,
        "connecting twice says it is already connected",
      );
    }
    const connectedBlock = allBlocks(wiring.definition).find((block) =>
      filtersAffecting(wiring.definition, block.id).includes(filterId),
    );
    wiring = setFilterConnection(wiring, filterId, connectedBlock.id, false);
    assert.ok(!filtersAffecting(wiring.definition, connectedBlock.id).includes(filterId));
    assert.ok(
      setFilterConnection(wiring, filterId, mintId("block", "gone"), true).refusal,
      "a connection to a block that does not exist is refused",
    );
    assert.ok(parseExperienceDefinition(wiring.definition).ok);
    ok("a filter is connected to a block, and disconnected from it, one deliberate act at a time");

    // AND AN INELIGIBLE ONE IS REFUSED, WITH THE REASON — not silently
    // accepted into a connection that would never move anything.
    for (const type of ["rich_text", "interpretation", "report_download", "filter_panel"]) {
      const victim = allBlocks(wiring.definition).find((block) => block.type === type);
      if (!victim) continue;
      const refused = setFilterConnection(wiring, filterId, victim.id, true);
      assert.ok(
        refused.refusal,
        `connecting a filter to a ${type} must be refused`,
      );
      assert.deepEqual(
        refused.definition,
        wiring.definition,
        "a refused connection leaves the document exactly as it was",
      );
    }
    ok("a filter cannot be connected to a block that shows nothing which recomputes");
  }

  // --- Widths: bounded on a computer, and never editable on a phone. -------
  const spanBlock = allBlocks(base.definition).find(
    (block) => blockSpec(block.type).span.min < blockSpec(block.type).span.max,
  );
  let spanning = initialState(base.definition);
  const spanSpec = blockSpec(spanBlock.type);
  spanning = setBlockSpan(spanning, spanBlock.id, "desktop", spanSpec.span.max);
  assert.equal(findBlock(spanning.definition, spanBlock.id).block.layout.desktop.span, spanSpec.span.max);
  assert.ok(
    setBlockSpan(spanning, spanBlock.id, "desktop", spanSpec.span.max + 1).refusal,
    "a width beyond what the block admits is refused",
  );
  const phone = setBlockSpan(spanning, spanBlock.id, "mobile", 6);
  assert.equal(phone.definition, spanning.definition, "a phone width cannot be edited at all");
  assert.ok(phone.refusal, "and the refusal says why");
  assert.deepEqual(validateExperienceDefinition(spanning.definition, registry).errors, []);
  ok("column widths are bounded by the block type, and a phone is always full width");

  // --- Authored text stays text. -------------------------------------------
  let writing = initialState(base.definition);
  const prose = allBlocks(base.definition).find((block) => blockSpec(block.type).copy === "long")
    ?? allBlocks(base.definition).find((block) => blockSpec(block.type).copy === "short");
  if (prose) {
    writing = setBlockCopy(writing, prose.id, "body", "El 40 % de las <100 respuestas fue positiva.");
    assert.equal(writing.refusal, null, "ordinary prose with a less-than sign is ordinary prose");
    assert.ok(parseExperienceDefinition(writing.definition).ok);
    const injected = setBlockCopy(writing, prose.id, "body", '<script>alert(1)</script>');
    assert.ok(!parseExperienceDefinition(injected.definition).ok, "markup never reaches a stored document");
  }
  const noProse = allBlocks(base.definition).find((block) => blockSpec(block.type).copy === "none");
  if (noProse) {
    assert.ok(setBlockCopy(writing, noProse.id, "body", "hola").refusal, "a divider carries no text");
  }
  ok("authored text is held to the same standard here as at the stored boundary");
}

// ===========================================================================
console.log("\n[19] The numbers are the study's own, computed once, by the canonical engine");
// ===========================================================================

{
  const base = adaptLegacyStudy(snapshot);
  const registry = base.registry;
  const index = registryKeyIndex(snapshot);

  // A synthetic study, shaped like the real one and containing nobody's
  // answers: eight people, two characteristics, one 0-10 recommendation
  // question and one satisfaction question.
  const GENERATIONS = ["Millennial", "Generación X", "Baby boomer"];
  const STATUS = ["Activa", "Por renovar", "Ya no participa"];
  const scores = [10, 9, 8, 7, 6, 5, 10, 9];
  const rows = scores.flatMap((score, person) => [
    {
      respondent_id: `p${person}`,
      metric_key: "nps_general",
      value: score,
      seg_generacion: GENERATIONS[person % GENERATIONS.length],
      seg_estatus: STATUS[person % STATUS.length],
      seg_giro: wideValues[person % wideValues.length],
    },
    {
      respondent_id: `p${person}`,
      metric_key: "sat_bienvenida",
      value: score,
      seg_generacion: GENERATIONS[person % GENERATIONS.length],
      seg_estatus: STATUS[person % STATUS.length],
      seg_giro: wideValues[person % wideValues.length],
    },
  ]);

  const npsHandle = Object.entries(index.metrics).find(([, key]) => key === "nps_general")[0];
  const satHandle = Object.entries(index.metrics).find(([, key]) => key === "sat_bienvenida")[0];
  const generationHandle = Object.entries(index.dimensions).find(([, key]) => key === "seg_generacion")[0];
  const statusHandle = Object.entries(index.dimensions).find(([, key]) => key === "seg_estatus")[0];

  const ask = (overrides) =>
    resolveBlockData(rows, registry, index, {
      blockId: "probe",
      metricId: npsHandle,
      aggregation: "net_score",
      primaryDimensionId: null,
      secondaryDimensionId: null,
      topN: null,
      sort: { by: "value", direction: "desc" },
      ...overrides,
    });

  // --- The composite results agree with the canonical functions, exactly. ---
  const overallNps = ask({});
  assert.ok(overallNps.ok);
  assert.equal(
    overallNps.data.overall.value,
    npsFromScores(scores).nps,
    "a composed NPS is the canonical NPS, not an arithmetic lookalike",
  );
  assert.equal(overallNps.data.overall.n, scores.length);
  assert.equal(overallNps.data.unit, "nps");
  assert.equal(overallNps.data.decimals, decimalsForUnit("nps"));
  assert.deepEqual(
    overallNps.data.detail.map((item) => item.label),
    ["Promotores", "Pasivos", "Detractores"],
    "and it carries the canonical breakdown",
  );

  const overallCsat = resolveBlockData(rows, registry, index, {
    blockId: "probe",
    metricId: satHandle,
    aggregation: "top_box",
    primaryDimensionId: null,
    secondaryDimensionId: null,
    topN: null,
    sort: { by: "value", direction: "desc" },
  });
  assert.ok(overallCsat.ok);
  assert.equal(
    overallCsat.data.overall.value,
    csatTopBox(scores, 9).csat,
    "a composed Top-2-Box is the canonical Top-2-Box",
  );

  const averaged = ask({ aggregation: "value" });
  assert.equal(averaged.data.overall.value, mean(scores), "and an average is the canonical mean");
  ok("every composed aggregate is produced by the canonical metric function, never re-derived");

  // --- A breakdown groups by the study's own characteristic. ---------------
  const byGeneration = ask({ primaryDimensionId: generationHandle });
  assert.ok(byGeneration.ok);
  assert.equal(byGeneration.data.categoryLabel, "Generacion");
  assert.equal(byGeneration.data.categories.length, GENERATIONS.length);
  assert.equal(byGeneration.data.series.length, 1, "one characteristic makes one series");
  for (const [position, category] of byGeneration.data.categories.entries()) {
    const own = scores.filter((_, person) => GENERATIONS[person % GENERATIONS.length] === category.label);
    assert.equal(
      byGeneration.data.series[0].cells[position].value,
      npsFromScores(own).nps,
      `${category.label} is computed from its own answers`,
    );
    assert.equal(byGeneration.data.series[0].cells[position].n, own.length);
  }
  // Ordering by value puts the highest first and never invents a position for a
  // category with nothing behind it.
  const values = byGeneration.data.series[0].cells.map((cell) => cell.value);
  assert.deepEqual(values, [...values].sort((a, b) => b - a), "descending by value means descending");

  const crossed = ask({
    primaryDimensionId: generationHandle,
    secondaryDimensionId: statusHandle,
  });
  assert.ok(crossed.ok);
  assert.equal(crossed.data.seriesLabel, "Estatus");
  assert.ok(crossed.data.series.length > 1, "two characteristics make a series each");
  for (const series of crossed.data.series) {
    assert.equal(
      series.cells.length,
      crossed.data.categories.length,
      "every series covers every category, with a hole where there is no data",
    );
  }
  ok("a breakdown is grouped by the study's own characteristic, and a cross produces a series each");

  // --- topN counts what it leaves out rather than dropping it silently. ----
  const topTwo = ask({ primaryDimensionId: generationHandle, topN: 2 });
  assert.equal(topTwo.data.categories.length, 2);
  assert.equal(topTwo.data.omittedCategories, GENERATIONS.length - 2, "the rest are counted, not hidden");

  // --- An unknown handle is a refusal, never an empty chart. ---------------
  const unknownMetric = ask({ metricId: "r_does_not_exist" });
  assert.equal(unknownMetric.ok, false);
  assert.equal(unknownMetric.reason, "unknown_metric");
  const unknownDimension = ask({ primaryDimensionId: "c_does_not_exist" });
  assert.equal(unknownDimension.ok, false);
  assert.equal(unknownDimension.reason, "unknown_dimension");
  const badAggregation = ask({ aggregation: "top_box" });
  assert.equal(badAggregation.ok, false);
  assert.equal(badAggregation.reason, "unsupported_aggregation");
  // "Nobody answered" and "this points at nothing" are different sentences.
  const emptyStudy = resolveBlockData([], registry, index, {
    blockId: "probe",
    metricId: npsHandle,
    aggregation: "net_score",
    primaryDimensionId: null,
    secondaryDimensionId: null,
    topN: null,
    sort: { by: "value", direction: "desc" },
  });
  assert.ok(emptyStudy.ok, "a study with no answers still resolves");
  assert.equal(emptyStudy.data.overall.value, null, "with no value");
  assert.equal(emptyStudy.data.overall.n, 0, "and no base");
  ok("a request naming something the study does not have is refused, not answered with an empty chart");

  // --- A handle only resolves inside its own study. ------------------------
  const otherStudy = { ...snapshot, studyId: "99999999-9999-4999-8999-999999999999" };
  const otherIndex = registryKeyIndex(otherStudy);
  assert.notDeepEqual(Object.keys(otherIndex.metrics), Object.keys(index.metrics));
  const crossTenant = resolveBlockData(rows, buildLegacyRegistry(otherStudy), otherIndex, {
    blockId: "probe",
    metricId: npsHandle,
    aggregation: "net_score",
    primaryDimensionId: null,
    secondaryDimensionId: null,
    topN: null,
    sort: { by: "value", direction: "desc" },
  });
  assert.equal(crossTenant.ok, false, "another study's handle resolves to nothing here");
  ok("a registry handle only means anything inside the study it was minted for");

  // --- The document decides what is computed, and nothing else is. ---------
  const requests = blockDataRequests(base.definition, registry);
  const keys = requests.map((request) => request.key);
  assert.equal(new Set(keys).size, keys.length, "no aggregate is asked for twice");
  for (const block of allBlocks(base.definition)) {
    if (block.query) {
      assert.ok(keys.includes(dataKeyForBlock(block.id)), "every block with a query is computed");
    }
  }
  for (const journey of base.definition.journeyReferences) {
    for (const moment of journey.moments) {
      if (!moment.metricId) continue;
      assert.ok(
        keys.includes(dataKeyForMoment(journey.id, moment.id)),
        "every recorrido moment with a result is computed",
      );
    }
  }
  const pivotBlock = allBlocks(base.definition).find((block) => block.type === "pivot_explorer");
  assert.ok(pivotBlock, "the adapted study carries the comparison explorer as a block");
  assert.ok(keys.includes(dataKeyForPivot(pivotBlock.id)), "and the cross it opens on is computed");
  // It opens on the coarsest characteristic, for the same reason the deployed
  // dashboard does: it is the grouping most likely to have something to show.
  const opensOn = requests.find((request) => request.key === dataKeyForPivot(pivotBlock.id));
  assert.equal(opensOn.primaryDimensionId, coarsestDimensionId(registry));

  // The qualitative blocks are resolved too, so a filtered page cannot show a
  // filtered chart beside an unfiltered theme count. They are declared in the
  // same one place, and the resolved set must be exactly that list.
  const expectedKeys = definitionDataKeys(base.definition, registry);
  for (const blockId of qualitativeBlockIds(base.definition)) {
    assert.ok(
      expectedKeys.includes(dataKeyForThemes(blockId)),
      "every qualitative block gets its own theme series",
    );
  }
  const set = resolveDefinitionData(rows, registry, index, base.definition);
  assert.deepEqual(
    Object.keys(set).sort(),
    expectedKeys.slice().sort(),
    "the resolved set is exactly the requests",
  );
  for (const [key, entry] of Object.entries(set)) {
    if (entry.ok) continue;
    assert.equal(typeof entry.reason, "string", `${key} explains why it has no number`);
    assert.ok(entry.reason.length > 0);
  }
  ok("exactly the aggregates the document needs are computed, once each, and every refusal is a sentence");

  // --- Units and precision follow the aggregation, not the appearance. -----
  assert.equal(unitForAggregation("net_score", "score"), "nps");
  assert.equal(unitForAggregation("top_box", "score"), "percent");
  assert.equal(unitForAggregation("share", "score"), "percent");
  assert.equal(unitForAggregation("count", "percent"), "count");
  assert.equal(unitForAggregation("average", "percent"), "percent");
  assert.equal(decimalsForUnit("count"), 0, "a count has no decimals");
  const shares = ask({ aggregation: "share", primaryDimensionId: generationHandle });
  const total = shares.data.series[0].cells.reduce((sum, cell) => sum + (cell.value ?? 0), 0);
  assert.ok(Math.abs(total - 100) < 0.5, "shares of a whole add up to the whole");
  ok("the unit and the precision come from the aggregation, and a share adds up to one hundred");
}

// ===========================================================================
console.log("\n[20] An exported definition carries nothing that must stay inside");
// ===========================================================================

{
  const base = adaptLegacyStudy(snapshot);
  const exported = serializeExperienceDefinition(base.definition, { pretty: true });

  // No canonical metric key, no imported column name. A definition references
  // meaning by opaque handle, so a document can be read, copied or handed to
  // another consultant without carrying the database's vocabulary with it.
  for (const metric of snapshot.metrics) {
    assert.ok(!exported.includes(metric.key), `the export must not carry the metric key ${metric.key}`);
  }
  for (const dimension of snapshot.dimensions) {
    assert.ok(
      !exported.includes(dimension.key),
      `the export must not carry the column name ${dimension.key}`,
    );
  }
  // No respondent, no answer, no quote, no count. A definition says how to ASK
  // for numbers; it never carries them.
  for (const forbidden of ["respondent_id", "quant_response", "qual_observation", "quote"]) {
    assert.ok(!exported.includes(forbidden), `the export must not mention ${forbidden}`);
  }
  // NO EVIDENCE. A definition says how to ASK for numbers; it never carries
  // one. Walking the keys is stricter than searching for a value, because a
  // count that happens to equal a page order would slip past a text search.
  const evidenceKeys = ["count", "confirmed", "responses", "n", "quote", "respondent", "value"];
  const walk = (node, path) => {
    if (Array.isArray(node)) {
      node.forEach((entry, position) => walk(entry, `${path}[${position}]`));
      return;
    }
    if (node === null || typeof node !== "object") return;
    for (const [key, entry] of Object.entries(node)) {
      assert.ok(
        !evidenceKeys.includes(key),
        `the export carries an evidence field "${key}" at ${path}`,
      );
      walk(entry, `${path}.${key}`);
    }
  };
  walk(JSON.parse(exported), "definition");
  // No secret, in any shape. Asserted rather than assumed, because "obviously
  // there is no key in there" is exactly the sentence that precedes one.
  for (const forbidden of [/sb_secret_/, /service_role/, /SUPABASE_/, /eyJ[A-Za-z0-9_-]{8,}\./]) {
    assert.doesNotMatch(exported, forbidden, "an export can never carry a credential");
  }
  // What it DOES carry: the study and client it belongs to, which is what makes
  // it possible to tell whether an exported file may be loaded back.
  assert.ok(exported.includes(snapshot.studyId));
  assert.ok(exported.includes(snapshot.tenantId));
  // And it is deterministic: the same document always produces the same bytes.
  assert.equal(exported, serializeExperienceDefinition(adaptLegacyStudy(snapshot).definition, { pretty: true }));
  ok("an exported definition carries handles, layout and words — no key, no answer, no secret");
}

// ===========================================================================
console.log("\n[21] Visible filter panels: what they offer and what they move");
// ===========================================================================
{
  const base = adaptLegacyStudy(snapshot).definition;

  // The adapter puts a real panel on Panorama, offering characteristics the
  // study actually has, in the order the template recommends.
  const panels = filterPanels(base);
  assert.ok(panels.length >= 1, "an adapted study opens with at least one visible filter panel");
  const first = panels[0].block;
  assert.equal(first.type, "filter_panel");
  assert.ok(first.filterPanel, "a panel carries its configuration");
  assert.ok(first.filterRefs.length > 0, "and it offers at least one characteristic");
  for (const filterId of first.filterRefs) {
    assert.ok(
      base.filterDefinitions.some((filter) => filter.id === filterId),
      "a panel only offers characteristics the experience declares",
    );
  }
  ok(`an adapted study opens with a visible panel offering ${first.filterRefs.length} characteristics`);

  // SUGGESTIONS RECOMMEND; THEY DO NOT RESTRICT. Every filter-eligible
  // characteristic is still declared and still offerable, whether or not a
  // suggestion named it.
  const eligible = base.filterDefinitions.length;
  assert.ok(
    eligible >= first.filterRefs.length,
    "the experience declares at least as many filters as any one panel offers",
  );
  const notSuggested = base.filterDefinitions.filter((filter) => !first.filterRefs.includes(filter.id));
  if (notSuggested.length > 0) {
    const widened = togglePanelFilter(initialState(base), first.id, notSuggested[0].id, true);
    assert.equal(widened.refusal, null, "a characteristic a suggestion did not name can still be added");
    const widenedPanel = findBlock(widened.definition, first.id).block;
    assert.ok(widenedPanel.filterRefs.includes(notSuggested[0].id));
  }
  ok("a template's suggestions decide what a panel opens with and restrict nothing");

  // --- Scope: experience, page, sections, blocks -------------------------
  const experienceWide = setPanelTarget(initialState(base), first.id, { kind: "experience" });
  assert.equal(experienceWide.refusal, null);
  const acrossAll = panelTargetBlockIds(
    experienceWide.definition,
    findBlock(experienceWide.definition, first.id).block,
  );

  const pageOnly = setPanelTarget(initialState(base), first.id, { kind: "page" });
  assert.equal(pageOnly.refusal, null);
  const onThisPage = panelTargetBlockIds(
    pageOnly.definition,
    findBlock(pageOnly.definition, first.id).block,
  );
  assert.ok(
    acrossAll.size > onThisPage.size,
    "the whole experience is more than one page of it",
  );
  for (const blockId of onThisPage) {
    assert.ok(acrossAll.has(blockId), "everything a page panel moves, an experience panel moves too");
  }
  ok(`scope is real: experience moves ${acrossAll.size} blocks, this page moves ${onThisPage.size}`);

  // A PANEL NEVER MOVES ITSELF OR ANOTHER PANEL.
  for (const blockId of acrossAll) {
    const found = findBlock(experienceWide.definition, blockId).block;
    assert.notEqual(found.type, "filter_panel", "a panel does not filter a panel");
    assert.notEqual(found.id, first.id, "a panel does not filter itself");
  }
  ok("a panel never moves itself or another panel");

  // --- Explicit blocks, by id, and an incompatible one refused -----------
  const compatible = allBlocks(base).find(
    (block) => block.type !== "filter_panel" && isFilterTargetable(block),
  );
  // NOT the panel itself — a panel refuses to filter a panel for its own
  // reason, which is asserted separately below.
  const incompatible = allBlocks(base).find(
    (block) => block.type !== "filter_panel" && !isFilterTargetable(block),
  );
  assert.ok(compatible, "the adapted study must contain a block a filter can move");

  const explicit = setPanelTarget(initialState(base), first.id, {
    kind: "blocks",
    blockIds: [compatible.id],
  });
  assert.equal(explicit.refusal, null, "naming one compatible block is allowed");
  assert.deepEqual(
    [...panelTargetBlockIds(explicit.definition, findBlock(explicit.definition, first.id).block)],
    [compatible.id],
    "an explicit target moves exactly what it names",
  );

  if (incompatible) {
    const refused = togglePanelTargetBlock(explicit, first.id, incompatible.id, true);
    assert.ok(refused.refusal, "connecting a block that shows no result is refused");
    assert.match(
      refused.refusal,
      /contenido fijo|una acci[oó]n|panel de filtros/i,
      `and the refusal explains why in words: ${refused.refusal}`,
    );
    assert.ok(
      refused.refusal.includes(incompatible.title ?? blockSpec(incompatible.type).label),
      "the refusal names the block it is about",
    );
    assert.equal(
      serializeExperienceDefinition(refused.definition),
      serializeExperienceDefinition(explicit.definition),
      "a refused connection changes nothing",
    );
  }

  // THE FOUR KINDS OF STATIC BLOCK THE PRODUCT CARES ABOUT MOST, by name.
  // A checklist of every characteristic used to be printed on all of them.
  for (const type of [
    "rich_text",
    "section",
    "interpretation",
    "report_download",
    "cover",
    "divider",
    "image",
    "all_results_disclosure",
  ]) {
    assert.equal(
      blockSpec(type).capabilities.supportsViewerFilters,
      false,
      `${type} must never be moved by a viewer filter`,
    );
    assert.ok(
      viewerFilterRefusal(type),
      `${type} must be able to say why in words`,
    );
  }
  for (const type of [
    "metric",
    "chart",
    "comparison",
    "retention",
    "journey",
    "qualitative_themes",
    "theme_cloud",
    "pivot_explorer",
    "finding",
  ]) {
    assert.equal(
      blockSpec(type).capabilities.supportsViewerFilters,
      true,
      `${type} shows a recomputable result and must be eligible`,
    );
    assert.equal(viewerFilterRefusal(type), null);
    assert.equal(
      blockSpec(type).capabilities.consumesStudyData,
      true,
      `${type} must declare that it reads study data`,
    );
  }
  ok("static and actionable blocks are ineligible by declaration; data-backed ones are eligible");
  ok("an explicit target names blocks by id, and an incompatible connection is refused with a reason");

  // LABELS ARE EDITABLE WITHOUT BREAKING A CONNECTION, because a target names
  // identifiers and never words.
  const renamed = setBlockTitle(explicit, compatible.id, "Un nombre completamente distinto");
  assert.deepEqual(
    [...panelTargetBlockIds(renamed.definition, findBlock(renamed.definition, first.id).block)],
    [compatible.id],
    "renaming a block does not change what a panel moves",
  );
  ok("renaming a block never breaks a panel's connection to it");

  // NO DANGLING REFERENCE WHEN THE TARGET IS REMOVED.
  const afterRemoval = removeBlock(renamed, compatible.id);
  assert.equal(afterRemoval.refusal, null, "removing a targeted block is not a refusal");
  assert.ok(
    parseExperienceDefinition(afterRemoval.definition).ok,
    "the document stays well-formed after the only targeted block is removed",
  );
  assert.deepEqual(
    validateExperienceDefinition(afterRemoval.definition, runA.registry).errors,
    [],
    "and it leaves no dangling target behind",
  );
  ok("removing a block a panel names leaves no dangling reference and the draft still saves");

  // The person is told what a removal will affect, before it happens.
  const consequence = removalConsequence(explicit.definition, compatible.id);
  assert.ok(
    typeof consequence === "string" && consequence.length > 0,
    "removing a block a panel explicitly names says so first",
  );
  ok(`a removal explains what it will affect: “${consequence.slice(0, 60)}…”`);
}

// ===========================================================================
console.log("\n[22] The two kinds of filter are two different things");
// ===========================================================================
{
  const base = adaptLegacyStudy(snapshot).definition;
  const dimension = runA.registry.dimensions.find(
    (entry) => entry.filterEligible && entry.values.length > 1,
  );
  assert.ok(dimension, "the study must offer a characteristic to fix a block to");

  const target = allBlocks(base).find((block) => block.query);
  assert.ok(target, "the study must contain a block that reads a result");

  // FILTRO FIJO DEL BLOQUE — carried by the query, self-contained, and
  // independent of any viewer control.
  const fixed = structuredClone(base);
  const fixedBlock = allBlocks(fixed).find((block) => block.id === target.id);
  fixedBlock.query.fixedFilters = [
    { dimensionId: dimension.id, values: [dimension.values[0].value] },
  ];
  assert.ok(parseExperienceDefinition(fixed).ok, "a fixed filter is a valid part of a query");
  assert.deepEqual(validateExperienceDefinition(fixed, runA.registry).errors, []);

  // Removing every viewer control leaves the fixed filter untouched: the two
  // concepts do not depend on each other, which is the whole point of the
  // version-2 shape.
  const strippedState = initialState(fixed);
  let stripped = strippedState;
  for (const filter of fixed.filterDefinitions) {
    stripped = setFilterConnection(stripped, filter.id, target.id, false);
  }
  const stillFixed = findBlock(stripped.definition, target.id).block;
  assert.deepEqual(
    stillFixed.query.fixedFilters,
    [{ dimensionId: dimension.id, values: [dimension.values[0].value] }],
    "disconnecting every viewer filter does not change what the block is permanently about",
  );
  ok("a block's fixed filter is self-contained and survives every change to the viewer's controls");

  // A fixed filter over a characteristic the study no longer has is a HARD
  // error, because a block that silently widens to everybody is a wrong number.
  const gone = structuredClone(fixed);
  allBlocks(gone).find((block) => block.id === target.id).query.fixedFilters = [
    { dimensionId: "c_does_not_exist", values: ["cualquiera"] },
  ];
  const goneReport = validateExperienceDefinition(gone, runA.registry);
  assert.ok(
    goneReport.errors.some((issue) => issue.code === "unknown_dimension"),
    "a fixed filter over a characteristic the study lost is a hard error",
  );
  ok("a fixed filter naming a characteristic the study no longer has blocks the save");
}

// ===========================================================================
console.log("\n[23] A reader's choices combine, and never widen past the author");
// ===========================================================================
{
  const base = adaptLegacyStudy(snapshot).definition;
  const movedBy = effectiveFilterTargets(base);
  const target = allBlocks(base).find(
    (block) => block.query && (movedBy.get(base.filterDefinitions[0]?.id ?? "")?.has(block.id) ?? false),
  );

  if (target) {
    const generation = base.filterDefinitions[0];
    const dimension = runA.registry.dimensions.find((entry) => entry.id === generation.dimensionId);
    const [one, two] = dimension.values.map((entry) => entry.value);

    // SEVERAL VALUES OF ONE CHARACTERISTIC WIDEN IT.
    const both = blockRestriction(base, target.id, target, { [generation.id]: [one, two] }, movedBy);
    const forThis = both.find((entry) => entry.dimensionId === dimension.id);
    assert.deepEqual(
      forThis.values,
      [one, two],
      "choosing two values of one characteristic asks for either of them",
    );

    // A DIFFERENT CHARACTERISTIC NARROWS IT — a separate entry, combined with AND.
    const second = base.filterDefinitions.find(
      (filter) => filter.dimensionId !== generation.dimensionId,
    );
    if (second) {
      const secondDimension = runA.registry.dimensions.find(
        (entry) => entry.id === second.dimensionId,
      );
      const combined = blockRestriction(
        base,
        target.id,
        target,
        { [generation.id]: [one], [second.id]: [secondDimension.values[0].value] },
        movedBy,
      );
      assert.equal(
        combined.length,
        2,
        "two characteristics produce two narrowings, combined with AND",
      );
    }

    // A READER CANNOT WIDEN PAST THE AUTHOR.
    const authored = structuredClone(target);
    authored.query.fixedFilters = [{ dimensionId: dimension.id, values: [one] }];
    const bounded = blockRestriction(
      base,
      target.id,
      authored,
      { [generation.id]: [one, two] },
      movedBy,
    );
    assert.deepEqual(
      bounded.find((entry) => entry.dimensionId === dimension.id).values,
      [one],
      "a reader's choice is intersected with the author's fixed filter, never unioned with it",
    );
    ok("choices widen within one characteristic, narrow across characteristics, and never widen past the author");

    // AN UNCONNECTED BLOCK IS UNCHANGED, whatever the reader chooses.
    const unconnected = allBlocks(base).find(
      (block) => block.query && !(movedBy.get(generation.id)?.has(block.id) ?? false),
    );
    if (unconnected) {
      assert.deepEqual(
        blockRestriction(base, unconnected.id, unconnected, { [generation.id]: [one] }, movedBy),
        [],
        "a block no filter connects to is not narrowed by that filter",
      );
      ok("a block the filter does not reach is not narrowed by it");
    }
  }

  // The reader's choices are never part of the document.
  const exported = serializeExperienceDefinition(base);
  assert.doesNotMatch(exported, /"selection"/, "a saved definition carries no reader selection");
  ok("a reader's exploration is transient and never reaches the saved definition");
}

// ===========================================================================
console.log("\n[24] A Top-2-Box is never invented from a scale nobody agreed to");
// ===========================================================================
{
  // The defect in one sentence: `DEFAULT_CSAT_MIN` is 9, which is the
  // threshold for a 0–10 scale. Applied to a study answered 1–5, every
  // satisfaction result reported 0.0 % — a confident wrong number rather than
  // a missing one. `docs/CALCULATION_CATALOG.md` §4 fixes the 1–5 rule
  // (four and five are satisfied) and `docs/CALCULATION_POLICY.md` §5 says the
  // threshold is an explicit input and is never guessed.
  const oneToFive = structuredClone(snapshot);
  oneToFive.metrics = oneToFive.metrics.map((metric) =>
    metric.unit === "percent" ? { ...metric, scale: { minimum: 1, maximum: 5 } } : metric,
  );
  const registryOneToFive = buildLegacyRegistry(oneToFive);
  const satisfaction = registryOneToFive.metrics.find((metric) => metric.unit === "percent");
  assert.equal(
    satisfaction.topBoxMinimum,
    4,
    "on a 1–5 scale the documented Top-2-Box threshold is four",
  );

  const zeroToTen = buildLegacyRegistry(snapshot);
  assert.equal(
    zeroToTen.metrics.find((metric) => metric.unit === "percent").topBoxMinimum,
    9,
    "on a 0–10 scale it is nine",
  );

  // A scale the catalogue does not document produces NO threshold, and the
  // aggregation is not offered at all.
  const unknownScale = structuredClone(snapshot);
  unknownScale.metrics = unknownScale.metrics.map((metric) =>
    metric.unit === "percent" ? { ...metric, scale: { minimum: 0, maximum: 100 } } : metric,
  );
  const registryUnknown = buildLegacyRegistry(unknownScale);
  const undocumented = registryUnknown.metrics.find((metric) => metric.unit === "percent");
  assert.equal(undocumented.topBoxMinimum, null, "an undocumented scale has no threshold");
  assert.ok(
    !undocumented.aggregations.includes("top_box"),
    "and the composer does not offer an aggregation it cannot compute honestly",
  );
  assert.notEqual(
    undocumented.defaultAggregation,
    "top_box",
    "nor does it default to one",
  );

  // And if a document asks for it anyway, the engine REFUSES rather than
  // returning a zero.
  const index = registryKeyIndex(unknownScale);
  const handle = undocumented.id;
  const rows = [1, 2, 3, 4, 5].map((value, person) => ({
    respondent_id: `p${person}`,
    metric_key: index.metrics[handle],
    value,
  }));
  const outcome = resolveBlockData(rows, registryUnknown, index, {
    blockId: "probe",
    metricId: handle,
    aggregation: "top_box",
    primaryDimensionId: null,
    secondaryDimensionId: null,
    topN: null,
    sort: { by: "value", direction: "desc" },
    restrict: [],
  });
  assert.equal(outcome.ok, false, "a Top-2-Box with no agreed threshold is refused");
  assert.equal(outcome.reason, "unsupported_aggregation");
  ok("a Top-2-Box is computed from the study's own scale, and refused rather than faked when there is none");
}


// ===========================================================================
console.log("\n[25] A semáforo is a decision somebody wrote down");
// ===========================================================================

{
  const numeric = {
    id: mintId("band", "sem/one"),
    title: "Desempeño del capítulo",
    description: null,
    source: "numeric",
    scale: { minimum: 0, maximum: 100 },
    bands: [
      {
        id: mintId("bandpart", "sem/one/a"),
        label: "Verde",
        colorRole: "positive",
        shape: "circle",
        meaning: "Por encima del estándar acordado.",
        lower: { value: 80, inclusive: true },
        upper: { value: null, inclusive: true },
        values: [],
      },
      {
        id: mintId("bandpart", "sem/one/b"),
        label: "Amarillo",
        colorRole: "caution",
        shape: "triangle",
        meaning: "Se sostiene, pero no crece.",
        lower: { value: 60, inclusive: true },
        upper: { value: 80, inclusive: false },
        values: [],
      },
      {
        id: mintId("bandpart", "sem/one/c"),
        label: "Rojo",
        colorRole: "danger",
        shape: "square",
        meaning: "Necesita atención ahora.",
        lower: { value: null, inclusive: true },
        upper: { value: 60, inclusive: false },
        values: [],
      },
    ],
    noDataLabel: "Sin dato",
    filterMetricId: null,
    filterLabel: null,
  };

  // ORDER IS AS WRITTEN, and the bounds decide — not the order.
  assert.equal(classify(numeric, 95).band.label, "Verde");
  assert.equal(classify(numeric, 80).band.label, "Verde", "an inclusive lower bound includes its value");
  assert.equal(classify(numeric, 79.9).band.label, "Amarillo");
  assert.equal(classify(numeric, 60).band.label, "Amarillo", "and 60 belongs to exactly one band");
  assert.equal(classify(numeric, 59.9).band.label, "Rojo");
  assert.equal(classify(numeric, 0).band.label, "Rojo", "an open lower bound catches everything below");
  assert.equal(classify(numeric, null).kind, "no_data");
  assert.equal(classify(numeric, "").kind, "no_data");
  assert.equal(classify(numeric, "no es un número").kind, "unclassified");
  ok("a numeric semáforo classifies by its bounds, and a boundary value belongs to exactly one band");

  assert.deepEqual(schemeProblems(numeric), [], "a complete scheme reports no problem");
  assert.ok(schemeIsUsable(numeric));

  // A GAP IS REPORTED BY THE VALUE THAT BREAKS, not as "the bands overlap".
  const gapped = structuredClone(numeric);
  gapped.bands[1].lower = { value: 65, inclusive: true };
  assert.ok(
    schemeProblems(gapped).some((problem) => problem.includes("60") && problem.includes("65")),
    `a gap must name the values it is between: ${JSON.stringify(schemeProblems(gapped))}`,
  );
  assert.equal(classify(gapped, 62).kind, "unclassified", "and a value in the gap is not rounded into a band");

  const overlapping = structuredClone(numeric);
  overlapping.bands[1].upper = { value: 85, inclusive: true };
  assert.ok(
    schemeProblems(overlapping).some((problem) => problem.includes("enciman")),
    "an overlap is reported",
  );

  const wordless = structuredClone(numeric);
  wordless.bands[0].meaning = "";
  assert.ok(
    schemeProblems(wordless).some((problem) => problem.includes("significa")),
    "a band with a colour and no sentence is incomplete",
  );
  ok("a gap, an overlap and a colour with no meaning are each reported by name");

  // CATEGORICAL: no arithmetic at all.
  const categorical = {
    ...numeric,
    id: mintId("band", "sem/two"),
    source: "category",
    scale: null,
    bands: numeric.bands.map((band) => ({
      ...band,
      lower: { value: null, inclusive: true },
      upper: { value: null, inclusive: true },
      values: [band.label],
    })),
  };
  assert.equal(classify(categorical, "Verde").band.label, "Verde");
  assert.equal(classify(categorical, "Morado").kind, "unclassified", "a value in no band is not guessed at");
  const doubled = structuredClone(categorical);
  doubled.bands[1].values = ["Verde"];
  assert.ok(
    schemeProblems(doubled).some((problem) => problem.includes("Verde")),
    "a value claimed by two bands is reported",
  );
  ok("a categorical semáforo maps recorded values straight across, and refuses a value in two bands");

  // COLOUR IS NEVER THE ONLY SIGNAL.
  for (const band of numeric.bands) {
    assert.ok(band.shape, "every band carries a shape");
    assert.ok(band.meaning.trim() !== "", "and a sentence");
  }
  assert.equal(new Set(numeric.bands.map((band) => band.shape)).size, numeric.bands.length,
    "and the shapes are distinct, so the non-colour signal actually distinguishes");
  ok("every band carries a distinct shape and a plain-language meaning beside its colour");
}

// ===========================================================================
console.log("\n[26] A semáforo becomes a characteristic only when somebody says what it means");
// ===========================================================================

{
  const base = adaptLegacyStudy(snapshot);
  const metric = base.registry.metrics[0];
  assert.ok(metric, "the fixture study produces a result");

  const withScheme = structuredClone(base.definition);
  const schemeId = mintId("band", "filterable");
  withScheme.bandSchemes = [
    {
      id: schemeId,
      title: "Desempeño",
      description: null,
      source: "numeric",
      scale: { minimum: 0, maximum: 10 },
      bands: [
        {
          id: mintId("bandpart", "filterable/a"),
          label: "Alto",
          colorRole: "positive",
          shape: "circle",
          meaning: "Por encima del estándar.",
          lower: { value: 7, inclusive: true },
          upper: { value: null, inclusive: true },
          values: [],
        },
        {
          id: mintId("bandpart", "filterable/b"),
          label: "Bajo",
          colorRole: "danger",
          shape: "square",
          meaning: "Por debajo del estándar.",
          lower: { value: null, inclusive: true },
          upper: { value: 7, inclusive: false },
          values: [],
        },
      ],
      noDataLabel: "Sin dato",
      filterMetricId: null,
      filterLabel: null,
    },
  ];

  // NOT OFFERED UNTIL IT NAMES WHAT IT CLASSIFIES.
  assert.deepEqual(
    derivedBandDimensions(withScheme, base.registry),
    [],
    "a scheme that classifies nothing offers no characteristic",
  );

  withScheme.bandSchemes[0].filterMetricId = metric.id;
  withScheme.bandSchemes[0].filterLabel = "Desempeño";
  const derived = derivedBandDimensions(withScheme, base.registry);
  assert.equal(derived.length, 1, "naming the result it classifies makes it a characteristic");
  assert.equal(derived[0].label, "Desempeño");
  assert.deepEqual(
    derived[0].values.map((entry) => entry.value),
    ["Alto", "Bajo"],
    "whose values are the band labels, in the order the scheme lists them",
  );
  assert.equal(derived[0].kind, "category", "and which is a documented classification, not a segment");

  // AN INCOMPLETE SCHEME OFFERS NOTHING. A half-written rule is not a rule.
  const incomplete = structuredClone(withScheme);
  incomplete.bandSchemes[0].bands[0].meaning = "";
  assert.deepEqual(
    derivedBandDimensions(incomplete, base.registry),
    [],
    "a scheme that is not finished is not offered as a filter",
  );
  ok("a semáforo becomes a filterable characteristic only when it is complete and names what it classifies");

  // THE ROWS GAIN ONE COLUMN, AND THE CLASSIFICATION IS PER RESPONDENT.
  const index = registryKeyIndex(snapshot);
  const widened = indexWithDerivedBands(withScheme, index);
  assert.equal(
    widened.dimensions[schemeId],
    bandColumnKey(schemeId),
    "the derived characteristic resolves to its own column",
  );
  const metricKey = index.metrics[metric.id];
  const sample = [
    { respondent_id: "r1", metric_key: metricKey, value: 9 },
    { respondent_id: "r1", metric_key: "otro", value: 1 },
    { respondent_id: "r2", metric_key: metricKey, value: 2 },
    { respondent_id: "r3", metric_key: "otro", value: 5 },
  ];
  const carried = withDerivedBandColumns(sample, withScheme, widened);
  const column = bandColumnKey(schemeId);
  assert.equal(carried[0][column], "Alto");
  assert.equal(carried[1][column], "Alto", "the label is on EVERY row of that respondent, not only the classified one");
  assert.equal(carried[2][column], "Bajo");
  assert.equal(
    carried[3][column],
    "",
    "somebody who never answered the classified result falls out of a narrowing rather than into a band",
  );
  assert.notEqual(carried, sample, "and the rows are copied, never mutated");
  assert.equal(sample[0][column], undefined, "the caller's rows are untouched");
  ok("a derived characteristic is written onto every row of the respondent it classifies, and nowhere else");

  /*
   * AND IT IS NEVER DERIVED FROM THE DISTRIBUTION — asserted as BEHAVIOUR,
   * not as prose. `readCode` strips comments precisely so a file cannot pass
   * by describing itself, so the check is: the same value classifies the same
   * way whatever else is in the study. A percentile rule would move the
   * boundary as soon as the other answers changed.
   */
  const sparse = [{ respondent_id: "r1", metric_key: metricKey, value: 8 }];
  const crowded = [
    { respondent_id: "r1", metric_key: metricKey, value: 8 },
    ...Array.from({ length: 40 }, (_, index) => ({
      respondent_id: `x${index}`,
      metric_key: metricKey,
      value: 9.5,
    })),
  ];
  assert.equal(
    withDerivedBandColumns(sparse, withScheme, widened)[0][column],
    withDerivedBandColumns(crowded, withScheme, widened)[0][column],
    "the same answer lands in the same band however the rest of the study answered",
  );
  assert.equal(withDerivedBandColumns(sparse, withScheme, widened)[0][column], "Alto");
  const bandsSource = await readCode("src/lib/experience/band-filters.ts");
  assert.doesNotMatch(
    bandsSource,
    /quantile|percentile|\.sort\(/,
    "and the module neither ranks nor sorts the values it classifies",
  );
  ok("the classification comes from the written bands, never from the distribution");
}

console.log(`\nOK — ${checks} Experience Composer checks passed.`);
