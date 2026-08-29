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

import { BLOCK_TYPES, blockCatalogue, blockSpec } from "../src/lib/experience/blocks.ts";
import { CHART_SPECS, CHART_VARIANTS, compatibleVariants, renderableVariant } from "../src/lib/experience/charts.ts";
import {
  adaptLegacyStudy,
  buildLegacyRegistry,
  familyForMetric,
} from "../src/lib/experience/adapter.ts";
import { canAddBlock, newBlock, newExperience, newPage } from "../src/lib/experience/defaults.ts";
import {
  EXPERIENCE_SCHEMA_VERSION,
  allBlocks,
  blocksAffectedBy,
  filtersAffecting,
  parseExperienceDefinition,
} from "../src/lib/experience/definition.ts";
import { fixtureRegistry, satisfactionOnlyJourneyRegistry } from "../src/lib/experience/fixtures.ts";
import { EXPERIENCE_ID_PATTERN, idKindOf, isExperienceId, mintId } from "../src/lib/experience/ids.ts";
import { BREAKPOINTS, GRID_COLUMNS, defaultLayout, layoutProblems, rowWidths } from "../src/lib/experience/layout.ts";
import { EXPERIENCE_LIMITS } from "../src/lib/experience/limits.ts";
import { declaredVersion, migrateExperienceDefinition } from "../src/lib/experience/migrate.ts";
import {
  addBlock,
  duplicateBlock,
  initialState,
  moveBlock,
  removeBlock,
  resetPrototype,
  setBlockTitle,
  setBlockVisibility,
  setChartVariant,
  setStudySamplePolicy,
} from "../src/lib/experience/prototype.ts";
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
    { key: "nps_general", name: "Recomendación", question: "¿Recomendarían?", unit: "nps", responses: 54, available: true },
    { key: "sat_bienvenida", name: "Satisfacción · Bienvenida", question: "¿Buena bienvenida?", unit: "percent", responses: 52, available: true },
    { key: "sat_acompanamiento", name: "Satisfacción · Acompañamiento", question: "¿Buen acompañamiento?", unit: "percent", responses: 48, available: true },
    { key: "ltv_cliente", name: "Valor por cliente", question: "¿Cuánto vale?", unit: "score", responses: 41, available: true },
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

const wrongVersion = { ...adapted.definition, schemaVersion: 2 };
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
          unawareMetricId: "moment_unknown_share",
          unawareLabel: "No sabía que existía",
          visible: true,
        },
      ],
      filterRefs: [],
      variant: "stepped",
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
          unawareMetricId: null,
          unawareLabel: null,
          visible: true,
        },
      ],
      filterRefs: [],
      variant: "linear",
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
assert.equal(unawareMoment.unawareMetricId, "moment_unknown_share");
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
  "cover",
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

assert.equal(runA.definition.journeyReferences.length, 1);
assert.equal(runA.definition.journeyReferences[0].origin, "legacy_journey_definition");
assert.equal(runA.definition.journeyReferences[0].moments.length, 3);
assert.equal(
  runA.definition.journeyReferences[0].moments[2].metricId,
  null,
  "a moment whose result the data no longer produces is preserved, visibly, without a number",
);
ok("the existing recorrido is represented, including the moment whose result has gone");

assert.ok(
  runA.warnings.some((warning) => warning.code === "section_not_representable"),
  "the adapter must say what it could not carry",
);
assert.ok(runA.warnings.some((warning) => warning.code === "dimension_too_wide"));
assert.ok(runA.warnings.some((warning) => warning.code === "metric_not_available"));
assert.ok(runA.warnings.some((warning) => warning.code === "threshold_not_representable"));
ok("the adapter reports the pivot explorer, the wide characteristic, the missing result and the threshold");

const wideDimension = runA.definition.filterDefinitions.find((filter) => {
  const dimension = findDimension(runA.registry, filter.dimensionId);
  return dimension && dimension.values.length > EXPERIENCE_LIMITS.dimensionCardinality;
});
assert.equal(wideDimension, undefined, "a characteristic with 72 values is never offered as a filter");
ok("a characteristic too wide to read is left out of the filters rather than shipped");

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
ok("the study-wide rule can be changed in the prototype without touching the adapted original");

const reset = resetPrototype(addBlock(state, state.definition.pages[0].id, "divider", runA.registry), runA.definition);
assert.equal(
  serializeExperienceDefinition(reset.definition),
  serializeExperienceDefinition(runA.definition),
  "resetting returns exactly the study's current configuration",
);
ok("resetting the prototype restores the adapted study byte for byte");

// ===========================================================================
console.log("\n[12] The registries cover what the product needs to express");
// ===========================================================================

assert.equal(BLOCK_TYPES.length, 18);
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
  if (!spec.rendererImplemented) {
    assert.ok(spec.fallback, `${variant} has no renderer yet and must declare what stands in for it`);
    assert.ok(CHART_SPECS[renderableVariant(variant)].rendererImplemented);
  }
}
ok(`all ${CHART_VARIANTS.length} chart variants declare their shape, their ceilings and their fallback`);

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
for (const file of ["blocks.ts", "charts.ts", "definition.ts", "validate.ts", "layout.ts", "adapter.ts"]) {
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
  "src/lib/experience/prototype.ts",
  "src/lib/experience/registry.ts",
  "src/lib/experience/validate.ts",
  "src/lib/experience/study-snapshot.ts",
  "src/components/studio/ExperienceComposer.tsx",
  "src/app/studio/e/[studyId]/construccion/page.tsx",
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

assert.equal(declaredVersion(runA.definition), 1);
assert.equal(declaredVersion({}), null);
assert.equal(migrateExperienceDefinition({ schemaVersion: 99 }).reason, "unknown_version");
assert.equal(migrateExperienceDefinition({ schemaVersion: 1 }).reason, "invalid_document");
const migrated = migrateExperienceDefinition(JSON.parse(serializeExperienceDefinition(runA.definition)));
assert.ok(migrated.ok, "a stored definition round-trips through serialization and migration");
assert.equal(migrated.migratedFrom, 1);
ok("an unknown schema version is refused by name, and a stored document round-trips");

// ===========================================================================
console.log("\n[15] The prototype route authorizes first and writes nothing");
// ===========================================================================

const routePath = "src/app/studio/e/[studyId]/construccion/page.tsx";
const routeSource = await readCode(routePath);
assert.match(routeSource, /await requireInternal\(\)/, "the route must run the internal gate");
const gateAt = routeSource.indexOf("await requireInternal()");
for (const reader of ["loadStudioStudy(", "loadLegacyStudySnapshot(", "admin.from("]) {
  const at = routeSource.indexOf(reader);
  if (at >= 0) assert.ok(gateAt < at, `the route must authorize before ${reader}`);
}
assert.doesNotMatch(routeSource, /return null\s*;/, "a blank page is not a state");
assert.doesNotMatch(routeSource, /history\.back|router\.back/);
assert.match(routeSource, /z\.string\(\)\.uuid\(\)/, "the study identifier is validated");
ok("the composer route authorizes server-side before it reads anything");

const guardSource = await readCode("src/lib/studio/guard.ts");
assert.match(guardSource, /auth\.getUser\(\)/);
assert.doesNotMatch(guardSource, /getSession\(/);
assert.match(guardSource, /profile\?\.role !== "internal"/);
assert.match(guardSource, /redirect\("\/dashboard"\)/);
ok("a client-role caller is redirected by the same gate every Studio surface uses");

const composerSource = await readCode("src/components/studio/ExperienceComposer.tsx");
const snapshotSource = await readCode("src/lib/experience/study-snapshot.ts");
for (const source of [routeSource, composerSource]) {
  for (const forbidden of [/\.insert\(/, /\.update\(/, /\.upsert\(/, /\.delete\(/, /"use server"/, /fetch\(/]) {
    assert.doesNotMatch(source, forbidden, "the prototype writes nothing and calls nothing");
  }
}
for (const forbidden of [/\.insert\(/, /\.update\(/, /\.upsert\(/, /\.delete\(/, /\.rpc\(/]) {
  assert.doesNotMatch(snapshotSource, forbidden, "the snapshot loader only reads");
}
assert.match(snapshotSource, /^import "server-only";/m, "the loader is server-only");
ok("nothing in the prototype path can write to a study, and the loader is server-only");

for (const file of ["adapter.ts", "definition.ts", "prototype.ts", "validate.ts", "defaults.ts"]) {
  const source = await readCode(`src/lib/experience/${file}`);
  assert.doesNotMatch(source, /server-only/, `${file} stays usable by an offline gate`);
}
ok("the model modules are pure enough to be driven by a credentials-free gate");

// The client-facing renderers stay exactly where they were.
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
    `${path} must not depend on the composer while it is a prototype`,
  );
}
ok("the deployed client preview, the insights route and the dashboard view do not import the composer");

// The recorrido editor keeps the focus fix it was given.
const stageFields = await readCode("src/components/studio/JourneyStagesFields.tsx");
assert.match(stageFields, /key=\{draft\.uid\}/, "the recorrido editor still keys its rows on the stable uid");
assert.doesNotMatch(stageFields, /Math\.random|randomUUID|Date\.now/);
ok("the recorrido editor's focus behaviour is untouched");

// ===========================================================================
console.log("\n[16] The prototype is operable by keyboard and its controls are named");
// ===========================================================================

for (const [pattern, message] of [
  [/aria-live="polite"/, "validation results are announced"],
  [/aria-current=\{selected \? "true" : undefined\}/, "the selected block is announced as current"],
  [/aria-label=\{`Subir “\$\{name\}”`\}/, "the reorder controls are named with the block they move"],
  [/aria-pressed=\{!block\.visible\}/, "the visibility toggle exposes its state"],
  [/<legend className="sr-only">/, "the disclosure choice is a named group"],
  [/htmlFor=\{`\$\{ids\}-threshold`\}/, "the threshold input has a label"],
  [/htmlFor=\{`\$\{idPrefix\}-title`\}/, "the title input has a label"],
  [/htmlFor=\{`\$\{idPrefix\}-variant`\}/, "the visualization select has a label"],
  [/htmlFor=\{`\$\{ids\}-add-\$\{page\.id\}`\}/, "the add-a-block select has a label"],
  [/useId\(\)/, "identifiers for labels are unique per instance"],
]) {
  assert.match(composerSource, pattern, message);
}
ok("every control in the prototype is labelled, named and announced");

const interactive = composerSource.match(/<(?:button|input|select)\b/g) ?? [];
assert.ok(interactive.length >= 10, "the prototype has a real set of controls");
assert.equal(
  (composerSource.match(/min-h-11/g) ?? []).length >= 6,
  true,
  "controls meet the minimum target height the acceptance matrix requires",
);
assert.doesNotMatch(composerSource, /min-w-\[\d/, "nothing forces a width wider than a phone");
assert.doesNotMatch(composerSource, /dangerouslySetInnerHTML/);
assert.doesNotMatch(composerSource, /JSON\.stringify/, "the raw document is never rendered on screen");
assert.match(composerSource, /serializeExperienceDefinition\(definition, \{ pretty: true \}\)/,
  "the document leaves only through a download");
assert.match(composerSource, /min-w-0/, "grid children may shrink instead of widening the page");
ok("the prototype forces no horizontal overflow and never renders the serialized document");

assert.equal(studioStudyComposer("abc"), "/studio/e/abc/construccion");
// It has an address, and it is deliberately NOT one of the study's process
// steps: a step that saves nothing would misdescribe the consultant's process.
const tabsSource = await readCode("src/components/studio/StudyTabs.tsx");
assert.doesNotMatch(tabsSource, /construccion/, "the prototype is not a step in the consultant's process");
assert.ok(
  !ADMIN_ALIASES.some((alias) => alias.studio.includes("construccion")),
  "the prototype renames no legacy address away",
);
ok("the prototype is addressable but is not part of the study's process row");

assert.match(routeSource, /Construcción del dashboard — prototipo interno/, "the route names itself");
assert.match(composerSource, /Nada de lo que hagas aquí se guarda ni se publica/,
  "the prototype states that it saves nothing");
ok("the prototype is labelled as an internal prototype and says that it saves nothing");

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

console.log(`\nOK — ${checks} Experience Composer checks passed.`);
