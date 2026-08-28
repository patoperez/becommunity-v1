// =============================================================================
// The executive preview gate — a study is a reading, not its own database dump
// =============================================================================
// The fixture is shaped like the real BNI Cuicuilco study, because that is the
// shape that broke: many metric keys, one characteristic with far more values
// than the disclosure rule can support, most of the resulting cells below the
// minimum, a handful of genuinely comparable groups, and a configuration that
// names only a few of the results.
//
// WHAT IT PROVES
//   1  the default view renders no exhaustive metric x segment product;
//   2  the complete inventory exists, is complete, and is closed by default;
//   3  the disclosure thresholds are untouched and no withheld value leaks;
//   4  suppression is summarised once per comparison, never repeated per row;
//   5  one result and one characteristic produce exactly one comparison;
//   6  a comparison with no eligible group produces one empty state;
//   7  what the page leads with comes from the study's own configuration, so a
//      technical-only key is never promoted into it;
//   8  the internal reviewer still reaches every result;
//   9  the recorrido, the retention series, the filters, the report link and
//      the publication boundary are where they were.
//
// It reads the pure modules for behaviour and the components' source for the
// structural facts a DOM would otherwise be needed to observe. Both halves are
// deterministic and credential-free.
// =============================================================================

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { buildStudyDashboard } from "../src/lib/dashboard/view.ts";
import {
  SMALL_STUDY_RESULTS,
  authoredResultLabels,
  buildResultInventory,
  featuredResultKeys,
  viewKeyForMetric,
} from "../src/lib/dashboard/results.ts";
import { computeStudyMetrics } from "../src/lib/calc/engine.ts";
import { DEFAULT_SAMPLE_SIZE_POLICY, sampleVisibility } from "../src/lib/calc/disclosure.ts";
import { hasAuthoredName, resultName } from "../src/lib/language/results.ts";
import { studyBaseSentence } from "../src/lib/language/sample.ts";

let checks = 0;
const ok = (message) => { checks += 1; console.log("  ok    " + message); };
const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const has = (source, pattern, message) => { assert.match(source, pattern, message); ok(message); };
const lacks = (source, pattern, message) => { assert.doesNotMatch(source, pattern, message); ok(message); };

// ---- The fixture ------------------------------------------------------------
// 26 metric keys, 40 people. `giro` has 20 values, so almost every group of it
// is below the minimum of 5; `estado_membresia` has 2, so both of its groups
// are comparable. Exactly the real study's shape, at a size a test can read.

const GIROS = Array.from({ length: 20 }, (_, index) => `Giro ${index + 1}`);
const TECHNICAL_KEYS = Array.from({ length: 20 }, (_, index) => `tdp_interacciones_capitulo_p_${index + 1}`);
const NAMED_KEYS = [
  "csat_rendicion_de_cuentas_dar_referencias",
  "csat_rendicion_de_cuentas_recibir_referencias",
  "csat_rendicion_de_cuentas_1_a_1",
  "csat_rendicion_de_cuentas_traer_visitantes",
];
const ALL_METRIC_KEYS = ["nps", "ltv_cliente", ...NAMED_KEYS, ...TECHNICAL_KEYS];

const rows = [];
for (let person = 0; person < 40; person += 1) {
  const segments = {
    giro: GIROS[person % GIROS.length],
    estado_membresia: person < 24 ? "Activo" : "Desertor",
  };
  for (const key of ALL_METRIC_KEYS) {
    // The desertores answer only the two keys their own workbook carried, the
    // way the real import behaves. Everything else is answered by the activos.
    if (person >= 24 && key !== "nps" && key !== "ltv_cliente") continue;
    rows.push({
      respondent_id: `r-${person}`,
      metric_key: key,
      value: key === "ltv_cliente" ? 30000 + person * 100 : (person % 5) + 5,
      ...segments,
    });
  }
}

const stages = [
  { id: "dar_referencias", label: "Dar referencias", metric: "csat_rendicion_de_cuentas_dar_referencias" },
  { id: "recibir_referencias", label: "Recibir referencias", metric: "csat_rendicion_de_cuentas_recibir_referencias" },
  { id: "reuniones_uno_a_uno", label: "Reuniones uno a uno", metric: "csat_rendicion_de_cuentas_1_a_1" },
  { id: "traer_visitantes", label: "Traer visitantes", metric: "csat_rendicion_de_cuentas_traer_visitantes" },
];

const dashboard = buildStudyDashboard(rows, [], stages, {}, {});
const view = dashboard.view;
const results = [...view.tiles, ...view.averages];

console.log("\n[1] The default view carries no exhaustive metric x segment product");
assert.equal("crosses" in view, false, "the pre-rendered cross matrix is gone from the payload");
ok("the study payload no longer ships a cross of every metric against a characteristic");
assert.equal(view.crossSegment, "giro", "the default characteristic for a comparison is still named");
ok("the characteristic a comparison opens on survives as a single name");
// The engine keeps its formula, and keeps it available to every other caller.
const withCrosses = computeStudyMetrics(rows);
const withoutCrosses = computeStudyMetrics(rows, { includeCrosses: false });
assert.equal(withCrosses.crosses.length, ALL_METRIC_KEYS.length, "the engine still crosses every key when asked");
assert.deepEqual(withoutCrosses.crosses, [], "and computes none when the caller does not need them");
for (const field of ["respondents", "nps", "averages", "csat", "crossSegment"]) {
  assert.deepEqual(withoutCrosses[field], withCrosses[field], `${field} is identical either way`);
}
ok("every other value the engine produces is byte-identical with and without the crosses");

console.log("\n[2] The complete inventory is complete, and is not the page");
const featuredKeys = view.featuredKeys;
const inventory = buildResultInventory(results, featuredKeys);
assert.equal(inventory.total, results.length, "the inventory holds every result the study produced");
assert.equal(inventory.all.length, results.length, "and drops none of them");
assert.equal(inventory.total, ALL_METRIC_KEYS.length + 1, "26 metric keys plus the respondent count");
assert.ok(inventory.needsDisclosure, "a study this size needs its inventory behind a disclosure");
assert.ok(
  inventory.featured.length <= 8 && inventory.featured.length < inventory.total,
  `the page leads with a few results, not all of them (${inventory.featured.length} of ${inventory.total})`,
);
ok(`the page leads with ${inventory.featured.length} of ${inventory.total} results and keeps the rest complete`);

console.log("\n[3] What leads comes from the study's own configuration");
const featuredNames = inventory.featured.map((item) => item.key);
assert.deepEqual(
  featuredNames,
  [
    "respondents",
    "nps",
    "average:csat_rendicion_de_cuentas_dar_referencias",
    "average:csat_rendicion_de_cuentas_recibir_referencias",
    "average:csat_rendicion_de_cuentas_1_a_1",
    "average:csat_rendicion_de_cuentas_traer_visitantes",
  ],
  "exactly the canonical results and the metrics the recorrido names",
);
ok("the lead is the two canonical results plus the four the recorrido names, in that order");
for (const key of TECHNICAL_KEYS) {
  assert.equal(
    featuredNames.includes(`average:${key}`),
    false,
    `an unconfigured technical key (${key}) is never promoted into the lead`,
  );
}
ok("no technical-only key reaches the client-facing default content");
assert.equal(viewKeyForMetric("csat_rendicion_de_cuentas_1_a_1", results), "average:csat_rendicion_de_cuentas_1_a_1");
assert.equal(viewKeyForMetric("not_a_metric", results), null, "a metric the study does not have maps to nothing");
ok("a stage's raw metric key is matched against what the view actually produced");

console.log("\n[4] Authored names are used; nothing is invented for the rest");
const labels = authoredResultLabels(results, stages);
assert.equal(labels["average:csat_rendicion_de_cuentas_dar_referencias"], "Dar referencias");
assert.equal(resultName("average:csat_rendicion_de_cuentas_dar_referencias", "", "Dar referencias"), "Dar referencias");
ok("a recorrido moment's authored label is the name a result is shown under");
assert.equal(
  resultName("average:tdp_interacciones_capitulo_p_1", "", undefined),
  "Tdp interacciones capitulo p 1",
  "with no authored label the key's own words are used, unchanged and un-embellished",
);
ok("an unnamed result keeps its own words instead of being given an invented meaning");
assert.equal(hasAuthoredName("average:ltv_cliente", undefined), false, "an import-derived name is marked as such");
assert.equal(hasAuthoredName("nps", undefined), true, "a canonical result is named by the product itself");
assert.equal(hasAuthoredName("average:x", "Dar referencias"), true);
ok("the product can tell an authored name from one taken off an imported column");
// The unit is not asserted where no metadata backs it.
const ltv = results.find((item) => item.key === "average:ltv_cliente");
assert.ok(ltv && ltv.value, "an unusual value is still shown, not hidden for looking odd");
const language = await import("../src/lib/language/results.ts");
assert.doesNotMatch(
  language.resultLanguage("average:ltv_cliente", "").method,
  /calificacion|calificaciones/i,
  "a plain average must not be described as a rating",
);
ok("no result is given a unit its metadata does not carry");

console.log("\n[5] A small study is unchanged: nothing is hidden that was never a wall");
const smallRows = Array.from({ length: 30 }, (_, index) => ([
  { respondent_id: `s-${index}`, metric_key: "nps", value: 9, area: "General" },
  { respondent_id: `s-${index}`, metric_key: "sat_servicio", value: 4, area: "General" },
])).flat();
const small = buildStudyDashboard(smallRows, [], [], {}, {});
const smallInventory = buildResultInventory([...small.view.tiles, ...small.view.averages], small.view.featuredKeys);
assert.ok(smallInventory.total <= SMALL_STUDY_RESULTS, "the fixture is genuinely small");
assert.equal(smallInventory.needsDisclosure, false, "and gets no disclosure at all");
assert.deepEqual(smallInventory.featured, smallInventory.all, "every result stays on screen");
ok("a study small enough to read at a glance is rendered exactly as it was");

console.log("\n[6] The disclosure rule is untouched and withheld values do not leak");
assert.equal(DEFAULT_SAMPLE_SIZE_POLICY.minimum, 5, "the minimum sample size is unchanged");
assert.equal(DEFAULT_SAMPLE_SIZE_POLICY.cautionBelow, 30, "the caution threshold is unchanged");
assert.equal(sampleVisibility(4), "suppressed");
assert.equal(sampleVisibility(5), "caution");
ok("minimum 5 and caution below 30, exactly as before");
const desertorOnly = buildStudyDashboard(
  rows.filter((row) => row.estado_membresia === "Desertor").slice(0, 4),
  [], stages, {}, {},
);
assert.equal(desertorOnly.view.selectionVisibility, "suppressed");
assert.equal(desertorOnly.view.selectedUnits, null, "a suppressed selection never serialises its own count");
assert.deepEqual(desertorOnly.view.tiles, []);
assert.deepEqual(desertorOnly.view.averages, []);
assert.deepEqual(desertorOnly.view.featuredKeys, [], "and promotes nothing into the lead");
ok("a selection below the minimum reveals no value, no count and no lead result");
for (const item of inventory.all) {
  if (item.visibility !== "suppressed") continue;
  assert.equal(item.value, null, `${item.key}: a withheld result carries no value`);
  assert.equal(item.detail, null, `${item.key}: nor its base`);
}
ok("every withheld result in the inventory carries neither its value nor its base");

console.log("\n[7] What the study base counts is said out loud");
assert.match(
  studyBaseSentence("standard", 54, "voices"),
  /54 personas y comentarios[\s\S]*al menos una respuesta/,
  "the base sentence says the count is of people who answered",
);
assert.doesNotMatch(studyBaseSentence("standard", 54, "people"), /comentario/i,
  "the people-only phrasing still never mentions comments");
ok("the base names what it counts, so a roster total is never mistaken for it");
// The base is the response units, never the roster: a person with no recorded
// answer contributes no row, and therefore is not counted.
const partial = buildStudyDashboard(rows.filter((row) => row.respondent_id !== "r-0"), [], stages, {}, {});
assert.equal(partial.view.sourceUnits, 39, "39 of 40 people answered, so the base is 39");
ok("only people with at least one recorded answer are counted into the base");

// ---- The rendered surfaces --------------------------------------------------
const [card, pivot, viewSource, insights, preview, sharedPreview, pkg] = await Promise.all([
  read("src/app/dashboard/StudyCard.tsx"),
  read("src/app/dashboard/PivotExplorer.tsx"),
  read("src/lib/dashboard/view.ts"),
  read("src/app/insights/e/[studyId]/page.tsx"),
  read("src/app/admin/preview/[studyId]/page.tsx"),
  read("src/components/studio/ClientPreviewView.tsx"),
  read("package.json"),
]);

console.log("\n[8] The study page defers the inventory instead of opening it");
has(card, /<details/, "the inventory is a native disclosure");
has(card, /Explorar todos los resultados/, "and it says what opening it gives you");
has(card, /\$\{items\.length\} resultados/, "the summary carries the count before it is opened");
lacks(card, /<details[^>]*\sopen\b/, "the disclosure is closed on every render");
lacks(card, /Los resultados, uno por uno/, "the open wall of result cards is gone");
lacks(card, /view\.crosses/, "the study card no longer renders a cross matrix");
lacks(card, /Muy pocas respuestas para mostrarlo\b/,
  "the per-row privacy sentence no longer repeats on the study card");
has(card, /Se ocultaron \$\{suppressed\} resultados porque no alcanzan el mínimo/,
  "withheld results are counted once instead of announced one by one");
lacks(card, /<table/, "the study card renders no table, so the pivot grid stays the only one");
has(card, /min-h-11/, "the disclosure control keeps a real touch target");
has(card, /audience === "preview"/, "the unnamed-result note is internal only");

console.log("\n[9] One comparison, chosen, with its suppression summarised once");
has(pivot, /Comparar por segmento/, "the comparison says what it is in plain Spanish");
has(pivot, /computeStudyPivot\(studyId, filters, intent\)/, "it still computes on the server");
has(pivot, /validatePivotIntent\(intent, allowlist\)/, "and still through the allowlist");
has(pivot, /sampleCopy\("suppressed", null\)/, "it uses the canonical privacy copy");
has(pivot, /Se ocultaron \$\{cellStates\.hidden\} grupos porque no alcanzan el mínimo/,
  "suppressed groups are summarised once for the whole active comparison");
has(pivot, /nothingEligible/, "a comparison with no eligible group has its own state");
has(pivot, /cellStates\.shown === 0/, "and that state is decided by there being nothing to show");
has(pivot, /Ningún grupo de esta comparación llega al mínimo/, "which says so once, in words");
has(pivot, /colDim !== NONE/, "a second characteristic applies only when it is chosen");
has(pivot, /Sin segunda separación/, "and the default is not to have one");
for (const control of ["Filas", "Columnas", "Métrica", "Agregación"]) {
  assert.ok(pivot.includes(control), `the frozen control name "${control}" is intact`);
}
ok("the four frozen control names Suites B and C drive are intact");
has(pivot, /Explorador de cruces/, "the frozen sr-only heading Suite C asserts on is intact");
has(pivot, /Preparando la comparación\.\.\./, "the frozen pending signal is intact");
has(pivot, /Intentar de nuevo/, "a failed comparison still offers a recovery action");

console.log("\n[10] The exhaustive product is not computed either");
has(viewSource, /includeCrosses: false/, "the dashboard asks the engine not to build it");
lacks(viewSource, /SafeCross/, "and the DTO for it is gone");

console.log("\n[11] Everything else on these routes is where it was");
has(insights, /<PeriodSeries points=\{periodSeries\}/, "the retention series still renders");
has(insights, /<LongitudinalTrends view=\{longitudinal\}/, "the period history still renders");
has(insights, /<StudyCard/, "the study surface still renders");
has(insights, /parseInsightsFilters/, "the URL filter grammar is untouched");
has(card, /filterQuery\(filters\)/, "the report link still follows the visible selection");
has(card, /api\/studies\/\$\{encodeURIComponent\(study\.id\)\}\/report/, "the PDF link is intact");
has(card, /aria-label=\{`Filtrar por \$\{label\(option\.key\)\}`\}/, "Suite A's filter locator is intact");
has(card, /\$\{view\.selectedUnits\} de \$\{view\.sourceUnits\} unidades de respuesta/,
  "Suite A's live-region contract is intact");
has(card, /scroll-mt-20/, "anchor jumps still clear the sticky internal notice");
has(card, /hasPublishableQualitative\(view\.qualitative\)/, "the qualitative gate is intact");
has(sharedPreview, /candidate\.status === "published" \|\| candidate\.id === study\.id/,
  "the preview's publication boundary is intact");
has(preview, /profile\?\.role !== "internal"/, "the internal-only guard on the preview is intact");
has(preview, /studioStudyPublish\(studyId\)/, "publication is still reached only from the preview");
has(pkg, /test:executive-preview/, "the focused gate is registered");

console.log(`\nExecutive preview gate: PASS (${checks} checks)`);
