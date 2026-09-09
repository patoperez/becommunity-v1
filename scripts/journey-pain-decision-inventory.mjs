// =============================================================================
// UNIT 6B.4B2C — THE REAL STUDY'S JOURNEY PAIN DECISION INVENTORY (READ-ONLY)
// =============================================================================
//   CANONICAL_HOSTED_* ... npx tsx scripts/journey-pain-decision-inventory.mjs \
//     "<datos-limpios.xlsx>" "<mapa-curado.xlsx>"
//
// -----------------------------------------------------------------------------
// WHAT THIS IS FOR
// -----------------------------------------------------------------------------
// The journey pain mapping is a PERSON'S work, and this unit built the Studio
// screen where they will do it. This script produces the worksheet they will do
// it FROM: every real curated pain phrase attached to a journey stage, the
// wording the source gave that stage, its current status, and — as a separate
// reference sheet — every canonical touchpoint they may choose, grouped under
// the five visible routes.
//
// IT DOES NOT FILL THE MAPPING IN, and it must not. The two vocabularies do not
// correspond: of the eighteen curated stage labels, ZERO match a canonical
// `survey_item.label`, SIX match the workbook's short label row and FIVE match
// the bracketed text inside the prompt. Three defensible readings, three
// different answers. The decision column is left blank on purpose, and the
// person fills it through the Studio editor, not here.
//
// -----------------------------------------------------------------------------
// IT IS READ-ONLY, AND IT WRITES OUTSIDE EVERY GIT REPOSITORY
// -----------------------------------------------------------------------------
// Every hosted request below is a `select`. There is no insert, update, upsert,
// delete or rpc anywhere in this file. The output goes to
// `CANONICAL_HOSTED_EVIDENCE`, which is outside every checkout, because it
// contains a real client's curated consultant prose and that never enters this
// repository — the same rule that keeps the workbooks out of it.
//
// -----------------------------------------------------------------------------
// WHAT IT READS, AND WHAT IT CANNOT
// -----------------------------------------------------------------------------
// Three tables, and from `pain_point` only `id`, `normalized_text`,
// `review_status` and `created_at`. Not `raw_text`, not `created_by`, not
// `reviewed_by`. `person`, `person_private`, `qual_observation`,
// `quant_response` and `survey_response` are not named in this file and no join
// reaches them — and `pain_point` carries no respondent column in any shape, so
// there is nothing of that kind on this path to redact.
//
// The ROUTE AND TOUCHPOINT CHOICES come from the two real workbooks, IN MEMORY,
// through the product's own projection, results builder, registry and approved
// blueprint. They are not read from the hosted project at all: they are what the
// Studio editor will offer, so deriving them the way the editor does is the only
// way this sheet can be a worksheet for that screen rather than a description of
// a different one.
// =============================================================================

import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { createClient } from "@supabase/supabase-js";

import { resolveHostedTarget } from "./lib/hosted-target.mjs";
import { preflightCanonicalPackage } from "../src/lib/ingestion/canonical-package/preflight.ts";
import { CUICUILCO_PACKAGE_SPEC_V1 } from "../src/lib/ingestion/canonical-package/spec.ts";
import { readXlsxWorkbook } from "../src/lib/ingestion/xlsx-reader.ts";
import { WorkbookView } from "../src/lib/ingestion/canonical-package/sheet-view.ts";
import { validatePresentationDocument } from "../src/lib/presentation/document.ts";
import { CUICUILCO_PROJECTION_V1, buildCanonicalCommitPlan } from "../src/lib/ingestion/canonical-commit/index.ts";
import {
  CUICUILCO_RESULTS_V1,
  buildCanonicalStudyResults,
  canonicalResultSourceFromCommitPlan,
} from "../src/lib/results/index.ts";
import {
  bindPresentationDocument,
  buildCanonicalPresentationRegistry,
} from "../src/lib/presentation/registry.ts";
import { buildApprovedCuicuilcoBlueprint } from "../src/lib/presentation/blueprints/cuicuilco-approved.ts";
import { resolvePresentation } from "../src/lib/presentation/resolve.ts";
import { painTouchpointChoices } from "../src/lib/publication/journey-pain-model.ts";

/* -------------------------------------------------------------------------- */

const cleanPath = process.argv[2] ?? process.env.CANONICAL_RESULTS_PARITY_CLEAN_XLSX;
const painPath = process.argv[3] ?? process.env.CANONICAL_RESULTS_PARITY_PAIN_XLSX;
if (!cleanPath || !painPath) {
  console.error(
    "SKIPPED: this inventory needs the two real workbooks, whose paths are machine-specific.\n" +
      "  npx tsx scripts/journey-pain-decision-inventory.mjs <datos-limpios.xlsx> <mapa-curado.xlsx>\n" +
      "  or set CANONICAL_RESULTS_PARITY_CLEAN_XLSX / _PAIN_XLSX.\n" +
      "It is SKIPPED, never passed: a worksheet nobody produced is not a worksheet.",
  );
  process.exit(2);
}

let target;
try {
  target = resolveHostedTarget(process.env);
} catch (thrown) {
  console.error(`REFUSED: ${thrown?.message ?? thrown}`);
  process.exit(2);
}

const evidence = process.env.CANONICAL_HOSTED_EVIDENCE;
if (!evidence || evidence.includes("becommunity-software")) {
  console.error(
    "REFUSED: CANONICAL_HOSTED_EVIDENCE must name a directory OUTSIDE every checkout. " +
      "This file carries a real client's curated prose and it does not enter this repository.",
  );
  process.exit(2);
}
mkdirSync(evidence, { recursive: true });

// `apiOrigin`, NOT `apiUrl`: the guard returns the ORIGIN and a separate
// `restUrl`, and there is no `apiUrl` on it at all.
const client = createClient(target.apiOrigin, target.serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

console.log("Be Community — Unit 6B.4B2C: the real study's journey pain decision inventory");
console.log("=".repeat(80));
console.log("READ-ONLY. Every hosted request below is a select; nothing is written there.\n");

/* ---- 1. the choices a reviewer will be offered, derived the editor's way -- */

/*
 * THE SAME PIPELINE THE PRESENTATION PARITY GATE USES, and deliberately the
 * same: a second way of turning the two workbooks into a resolved model would
 * be a second answer, and the whole value of this sheet is that it lists what
 * the Studio editor will actually offer.
 */
const files = [cleanPath, painPath].map((path) => {
  const buffer = readFileSync(path);
  return {
    fileName: path.replace(/^.*[\\/]/, ""),
    bytes: buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength),
  };
});

const preflight = await preflightCanonicalPackage(files, CUICUILCO_PACKAGE_SPEC_V1);
if (preflight.counts.blockers > 0 || preflight.packageIdempotencyKey === null) {
  console.error(`the two workbooks do not preflight (${preflight.counts.blockers} blocker(s))`);
  process.exit(1);
}

const workbooks = new Map();
for (const asset of preflight.assets) {
  const file = files.find((candidate) => candidate.fileName === asset.fileName);
  workbooks.set(asset.role, new WorkbookView(await readXlsxWorkbook(file.bytes)));
}

// A PLACEHOLDER SCOPE, and it changes nothing this sheet reports. Every derived
// record id is derived from the package key TOGETHER WITH the tenant and the
// study, so a plan built under a placeholder scope is a DIFFERENT plan from the
// one that was imported — but the ROUTES and the TOUCHPOINT LABELS come from the
// workbooks, not from the scope, and they are all this sheet uses.
const build = buildCanonicalCommitPlan({
  tenantId: "00000000-0000-4000-8000-0000000000a1",
  studyId: "00000000-0000-4000-8000-0000000000b2",
  packageIdempotencyKey: preflight.packageIdempotencyKey,
  spec: CUICUILCO_PACKAGE_SPEC_V1,
  projection: CUICUILCO_PROJECTION_V1,
  workbooks,
});
if (!build.ok) {
  console.error("the projection did not produce a plan");
  process.exit(1);
}
const source = canonicalResultSourceFromCommitPlan(build.plan, { spec: CUICUILCO_RESULTS_V1 });
const results = buildCanonicalStudyResults(source, { period: { label: null, dataCutoff: null } });
const registry = buildCanonicalPresentationRegistry(results);
const document = bindPresentationDocument(
  validatePresentationDocument(JSON.parse(JSON.stringify(buildApprovedCuicuilcoBlueprint(registry)))).value,
  registry,
);
const resolved = resolvePresentation({ document, registry, results });
if (!resolved.ok) {
  console.error("the approved blueprint did not resolve over the real study");
  process.exit(1);
}

const choices = painTouchpointChoices(resolved.value);
console.log(`  the approved layout offers ${choices.length} touchpoints across ${new Set(choices.map((c) => c.routeTitle)).size} visible routes`);

/* ---- 2. the real curated pain rows, read-only ----------------------------- */

const page = async (table, columns) => {
  const { data, error } = await client.from(table).select(columns).limit(5000);
  if (error) {
    console.error(`could not read ${table}: ${error.code}`);
    process.exit(1);
  }
  return data ?? [];
};

const painRows = await page("pain_point", "id, normalized_text, review_status, created_at");
const journeyLinks = await page("pain_point_journey_stage", "pain_point_id, journey_stage_id, display_order");
const stages = await page("journey_stage", "id, label, stage_order");
// THE OTHER THREE CURATED DIMENSIONS, so all FIFTY rows appear with the wording
// their own source gave them. A worksheet that listed only the fifteen journey
// ones would leave a reader unable to tell «out of scope» from «missing», and
// those are the two readings this whole unit exists to keep apart.
const unitLinks = await page("pain_point_organizational_unit", "pain_point_id, organizational_unit_id, display_order");
const units = await page("organizational_unit", "id, label");
const performanceLinks = await page("pain_point_performance_dimension", "pain_point_id, performance_dimension_id, display_order");
const performance = await page("performance_dimension", "id, label");
const cultureLinks = await page("pain_point_culture_dimension", "pain_point_id, culture_dimension_id, display_order");
const culture = await page("culture_dimension", "id, label");

console.log(
  `  the hosted project holds ${painRows.length} pain rows: ` +
    `${journeyLinks.length} journey, ${unitLinks.length} organizational, ` +
    `${performanceLinks.length} performance and ${cultureLinks.length} culture links`,
);

/**
 * The curated entity each pain row belongs to, and which family it is in.
 *
 * FIRST LINK WINS, in the SOURCE'S OWN display order, so a row the source linked
 * twice reads the same way on every run. The families are consulted in the order
 * the contract lists them, and only the JOURNEY family is in scope for this
 * unit's mapping.
 */
const contextFor = new Map();
const attach = (links, entities, idColumn, scope) => {
  const byId = new Map(entities.map((row) => [row.id, row.label]));
  for (const link of [...links].sort((a, b) =>
    a.pain_point_id < b.pain_point_id ? -1 : a.pain_point_id > b.pain_point_id ? 1 : a.display_order - b.display_order,
  )) {
    if (contextFor.has(link.pain_point_id)) continue;
    const label = byId.get(link[idColumn]);
    if (label === undefined) continue;
    const order = scope === "recorrido"
      ? stages.find((stage) => stage.id === link[idColumn])?.stage_order ?? 0
      : 0;
    contextFor.set(link.pain_point_id, { label, scope, order });
  }
};
attach(journeyLinks, stages, "journey_stage_id", "recorrido");
attach(unitLinks, units, "organizational_unit_id", "equipos");
attach(performanceLinks, performance, "performance_dimension_id", "desempeño");
attach(cultureLinks, culture, "culture_dimension_id", "cultura");

const occurrences = new Map();
for (const row of painRows) {
  occurrences.set(row.normalized_text, (occurrences.get(row.normalized_text) ?? 0) + 1);
}

const SCOPE_ORDER = { recorrido: 0, equipos: 1, "desempeño": 2, cultura: 3, "sin clasificar": 4 };
const contextOf = (row) => contextFor.get(row.id) ?? { label: "", scope: "sin clasificar", order: 0 };

// IN THE SOURCE'S OWN ORDER: journey first, because that is the family a person
// is being asked to decide; then by the stage the workbook placed the item in,
// then by the phrase, so two runs produce the same worksheet and somebody can
// pick up where they left off.
const ordered = [...painRows].sort((a, b) => {
  const left = contextOf(a);
  const right = contextOf(b);
  if (SCOPE_ORDER[left.scope] !== SCOPE_ORDER[right.scope]) {
    return SCOPE_ORDER[left.scope] - SCOPE_ORDER[right.scope];
  }
  if (left.order !== right.order) return left.order - right.order;
  if (left.label !== right.label) return left.label < right.label ? -1 : 1;
  return a.normalized_text < b.normalized_text ? -1 : a.normalized_text > b.normalized_text ? 1 : 0;
});

const inScope = ordered.filter((row) => contextOf(row).scope === "recorrido");
const outOfScope = ordered.length - inScope.length;
console.log(`  of those, ${inScope.length} are attached to a journey stage and need a decision here`);
console.log(`  ${outOfScope} belong to another curated dimension and are listed but out of scope\n`);

/* ---- 3. the worksheet ----------------------------------------------------- */

const csv = (value) => `"${String(value ?? "").replace(/"/g, '""')}"`;
const stamp = new Date().toISOString().replace(/[:.]/g, "-");

const rows = [
  [
    "n",
    "familia_curada",
    "en_alcance_de_este_mapeo",
    "frase_curada",
    "contexto_que_indico_el_origen",
    "veces_que_aparece_la_frase",
    "estado_actual_del_origen",
    "DECISION_aprobar_excluir_o_sin_resolver",
    "TEXTO_PUBLICO_si_se_aprueba",
    "PUNTOS_DE_CONTACTO_si_se_aprueba",
    "MOTIVO_si_se_excluye_o_queda_sin_resolver",
  ].join(","),
];
ordered.forEach((row, index) => {
  const context = contextOf(row);
  rows.push(
    [
      csv(index + 1),
      csv(context.scope),
      csv(context.scope === "recorrido" ? "sí" : "no"),
      csv(row.normalized_text),
      csv(context.label),
      csv(occurrences.get(row.normalized_text) ?? 1),
      csv(row.review_status),
      // THE FOUR DECISION COLUMNS ARE BLANK, AND THAT IS THE WHOLE POINT.
      // Nothing here proposes a touchpoint, a wording or a verdict.
      csv(""),
      csv(""),
      csv(""),
      csv(""),
    ].join(","),
  );
});
const csvPath = join(evidence, `journey-pain-decisions-${stamp}.csv`);
writeFileSync(csvPath, `${rows.join("\n")}\n`, "utf8");

const choiceRows = ["ruta_visible,punto_de_contacto"];
for (const choice of choices) choiceRows.push([csv(choice.routeTitle), csv(choice.label)].join(","));
const choicesPath = join(evidence, `journey-pain-touchpoints-${stamp}.csv`);
writeFileSync(choicesPath, `${choiceRows.join("\n")}\n`, "utf8");

const byRoute = new Map();
for (const choice of choices) {
  const bucket = byRoute.get(choice.routeTitle) ?? [];
  bucket.push(choice.label);
  byRoute.set(choice.routeTitle, bucket);
}
const notes = [
  `# Puntos de dolor del recorrido — hoja de decisión (${stamp})`,
  "",
  "Esta hoja NO trae ninguna correspondencia propuesta, y no es un descuido.",
  "",
  `De las ${new Set(inScope.map((row) => contextOf(row).label)).size} etapas curadas que traen frases, NINGUNA coincide con la etiqueta`,
  "canónica de un reactivo de encuesta (esa columna guarda la pregunta completa);",
  "seis coinciden con la fila de etiqueta corta del libro y cinco con el texto entre",
  "corchetes de la pregunta. Tres lecturas defendibles de las mismas dos fuentes dan",
  "tres respuestas distintas, así que la correspondencia es una decisión de una",
  "persona y se toma en el editor de Studio, no aquí.",
  "",
  `Filas curadas en total: **${ordered.length}**`,
  `Frases del RECORRIDO, que necesitan una decisión aquí: **${inScope.length}**`,
  `Filas de otras dimensiones curadas (equipos, desempeño, cultura), listadas y fuera de alcance: **${outOfScope}**`,
  `Puntos de contacto disponibles: **${choices.length}** en ${byRoute.size} rutas visibles`,
  "",
  "## Puntos de contacto, por ruta visible",
  "",
];
for (const [route, labels] of byRoute) {
  notes.push(`### ${route} (${labels.length})`, "");
  for (const label of labels) notes.push(`- ${label}`);
  notes.push("");
}
const notesPath = join(evidence, `journey-pain-decisions-${stamp}.md`);
writeFileSync(notesPath, `${notes.join("\n")}\n`, "utf8");

console.log(`  worksheet          → ${csvPath}`);
console.log(`  touchpoint choices → ${choicesPath}`);
console.log(`  notes              → ${notesPath}`);
console.log("\n" + "=".repeat(80));
console.log(
  `RESULT: all ${ordered.length} real curated phrases are listed with the wording their source gave them — ` +
    `${inScope.length} of them in the journey scope this mapping is about — ` +
    `their occurrence counts and their current status, beside the ${choices.length} touchpoints a ` +
    "reviewer may choose from. Not one decision column is filled: the mapping is a person's, and " +
    "they make it in the Studio editor. Nothing was written to the hosted project.",
);
