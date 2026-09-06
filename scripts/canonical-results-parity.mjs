// =============================================================================
// Cuicuilco GOLDEN-PARITY gate — the canonical results model against the
// approved dashboard.
//   npx tsx scripts/canonical-results-parity.mjs <datos-limpios.xlsx> <mapa-curado.xlsx>
//   (or set CANONICAL_RESULTS_PARITY_CLEAN_XLSX / _PAIN_XLSX)
// =============================================================================
// IT IS READ-ONLY AND OFFLINE. It builds the canonical projection IN MEMORY from
// the two source workbooks, adapts it into the read model, calculates the whole
// results document and compares it with values recorded from the CEO-approved
// dashboard. It performs no database and no network operation, and it proves
// that rather than claiming it: it walks its own module graph and fails if any
// of it reaches a transport.
//
// IT WRITES NOTHING. Not into either workbook, not into the approved dashboard
// repository, not anywhere else.
//
// IT PRINTS ONLY APPROVED AGGREGATES AND PARITY STATUSES. Before printing its
// summary it walks the finished plan for the fields that hold source values and
// fails if one of them could reach the output.
//
// IT IS SEPARATE FROM `npm test` ON PURPOSE. It needs two real workbooks whose
// paths are machine-specific, and an unexecuted gate must never be counted
// among the offline results. `npm run test:canonical-results` is the synthetic
// gate that runs everywhere.
//
// EVERY CATEGORY REPORTED SEPARATELY, never collapsed into one number:
// offered, executed, passed, failed, skipped, unresolved, not-applicable and
// configuration-required. The last three are not passes and not failures.
// `not_applicable` means no approved value exists to compare against;
// `configuration_required` means the content comes from study configuration
// or editorial review rather than a calculation; `unresolved` means a genuine
// open question, and none remain for this study.
// =============================================================================

import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { preflightCanonicalPackage } from "../src/lib/ingestion/canonical-package/preflight.ts";
import { CUICUILCO_PACKAGE_SPEC_V1 } from "../src/lib/ingestion/canonical-package/spec.ts";
import { WorkbookView } from "../src/lib/ingestion/canonical-package/sheet-view.ts";
import { readXlsxWorkbook } from "../src/lib/ingestion/xlsx-reader.ts";
import {
  CUICUILCO_PROJECTION_V1,
  buildCanonicalCommitPlan,
} from "../src/lib/ingestion/canonical-commit/index.ts";
import {
  CUICUILCO_RESULTS_V1,
  buildCanonicalStudyResults,
  canonicalResultSourceFromCommitPlan,
} from "../src/lib/results/index.ts";
import {
  REQUIRED_DASHBOARD_COMMIT,
  evaluateGoldenParity,
  formatGoldenSummary,
  loadGoldenFixture,
} from "./lib/canonical-golden-parity.mjs";

const DISPOSABLE_TENANT = "00000000-0000-4000-8000-0000000000a1";
const DISPOSABLE_STUDY = "00000000-0000-4000-8000-0000000000b2";

const cleanPath = process.argv[2] ?? process.env.CANONICAL_RESULTS_PARITY_CLEAN_XLSX;
const painPath = process.argv[3] ?? process.env.CANONICAL_RESULTS_PARITY_PAIN_XLSX;

console.log("Be Community — paridad dorada del modelo canónico de resultados");
console.log("=".repeat(74));

if (!cleanPath || !painPath) {
  console.log(
    "\nOMITIDA: esta compuerta necesita los dos libros reales.\n" +
      "  npx tsx scripts/canonical-results-parity.mjs <datos-limpios.xlsx> <mapa-curado.xlsx>\n" +
      "  o CANONICAL_RESULTS_PARITY_CLEAN_XLSX / _PAIN_XLSX.\n" +
      "Una compuerta no ejecutada NO es una compuerta aprobada; se reporta como omitida.",
  );
  console.log("\nRESUMEN: ofrecidas=0 ejecutadas=0 aprobadas=0 falladas=0 omitidas=0 sin-resolver=0 (SUITE OMITIDA)");
  process.exit(0);
}

// ---- the gate cannot reach a database ---------------------------------------
function moduleGraph(root) {
  const seen = new Set();
  const files = [];
  const visit = (path) => {
    if (seen.has(path)) return;
    seen.add(path);
    let code;
    try {
      code = readFileSync(path, "utf8");
    } catch {
      return;
    }
    files.push({ path, code });
    for (const match of code.matchAll(/from\s+["'](\.[^"']+)["']/g)) {
      const specifier = match[1];
      const base = join(path, "..", specifier);
      for (const candidate of [base, `${base}.ts`, `${base}.mjs`, join(base, "index.ts")]) {
        try {
          if (statSync(candidate).isFile()) {
            visit(candidate);
            break;
          }
        } catch {
          /* not this candidate */
        }
      }
    }
  };
  visit(root);
  return files;
}

let failures = 0;
const ok = (message) => console.log("  ✓", message);
const bad = (message) => {
  console.error("  ✗ FALLO:", message);
  failures += 1;
};
const check = (condition, message) => (condition ? ok(message) : bad(message));

console.log("\n[1] La compuerta es de sólo lectura y sin red");
const SELF = "scripts/canonical-results-parity.mjs";
const graph = moduleGraph(SELF);
// This file is excluded from both scans because it CONTAINS the patterns — it
// is the thing doing the scanning. Its own behaviour is constrained by the two
// checks below it instead: it opens no transport and writes no file, and the 37
// modules it pulls in are checked in full.
const transports = graph.filter(
  ({ path, code }) =>
    path !== SELF && /@supabase|createClient\(|\.rpc\(|\bfetch\(|node:https?|node:net|XMLHttpRequest/.test(code),
);
check(
  transports.length === 0,
  `ningún módulo del grafo alcanza una base de datos ni la red${transports.length ? `: ${transports.map((entry) => entry.path).join(", ")}` : ""}`,
);
const writers = graph.filter(
  ({ path, code }) => path !== SELF && /writeFileSync|appendFileSync|mkdirSync|rmSync|unlinkSync/.test(code),
);
const selfImports = /import {([^}]*)} from "node:fs";/.exec(readFileSync(SELF, "utf8"))?.[1] ?? "";
check(
  selfImports.split(",").map((name) => name.trim()).every((name) => name.endsWith("Sync") && name.startsWith("read") || name === "statSync"),
  `y esta compuerta sólo importa lectores de node:fs (${selfImports.trim()})`,
);
check(writers.length === 0, "ningún módulo del grafo escribe en disco");
check(graph.length > 10, `el grafo inspeccionado tiene ${graph.length} módulos`);

// ---- the fixture -------------------------------------------------------------
console.log("\n[2] El fixture dorado");
const fixture = loadGoldenFixture();
check(fixture.specVersion === 1, `fixture versión ${fixture.specVersion}`);
check(
  fixture.generatedFrom.commit === REQUIRED_DASHBOARD_COMMIT,
  `derivado del tablero aprobado ${fixture.generatedFrom.commit}`,
);
check(Array.isArray(fixture.expectations) && fixture.expectations.length > 400, `${fixture.expectations.length} expectativas registradas`);

// ---- projection --------------------------------------------------------------
console.log("\n[3] Proyección canónica desde los dos libros reales");
const files = [cleanPath, painPath].map((path) => {
  const buffer = readFileSync(path);
  return {
    fileName: path.replace(/^.*[\\/]/, ""),
    bytes: buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength),
  };
});

const preflight = await preflightCanonicalPackage(files, CUICUILCO_PACKAGE_SPEC_V1);
check(preflight.counts.blockers === 0, `el paquete real no tiene bloqueos (${preflight.counts.blockers})`);
if (preflight.counts.blockers > 0 || preflight.packageIdempotencyKey === null) {
  console.error("\nEl preflight bloquea el paquete; no hay nada que comparar.");
  process.exit(1);
}

const workbooks = new Map();
for (const asset of preflight.assets) {
  const file = files.find((candidate) => candidate.fileName === asset.fileName);
  workbooks.set(asset.role, new WorkbookView(await readXlsxWorkbook(file.bytes)));
}

const build = buildCanonicalCommitPlan({
  tenantId: DISPOSABLE_TENANT,
  studyId: DISPOSABLE_STUDY,
  packageIdempotencyKey: preflight.packageIdempotencyKey,
  spec: CUICUILCO_PACKAGE_SPEC_V1,
  projection: CUICUILCO_PROJECTION_V1,
  workbooks,
});
check(build.ok === true, "la proyección produce un plan");
if (!build.ok) {
  console.error("\nLa proyección falló; no hay nada que comparar.");
  process.exit(1);
}
const plan = build.plan;
console.log(`  huella del plan = ${plan.planFingerprint}`);

// ---- read model + results ----------------------------------------------------
console.log("\n[4] Modelo de lectura y documento de resultados");
const source = canonicalResultSourceFromCommitPlan(plan, { spec: CUICUILCO_RESULTS_V1 });
const results = buildCanonicalStudyResults(source, {
  period: { label: fixture.generatedFrom.period ?? null, dataCutoff: null },
});
check(typeof results.contractVersion === "string", `contrato versión ${results.contractVersion}`);
check(results.study.planFingerprint === plan.planFingerprint, "el documento cita la huella del plan que lo produjo");
check(source.participants.length === 60, `el modelo de lectura tiene ${source.participants.length} participaciones`);
console.log(
  `  puntos de contacto=${results.journey.touchpoints.length} excluidos=${results.journey.excluded.length} ` +
    `grupos=${results.journey.groups.length} periodos=${results.retention.periods.length} ` +
    `alcances NPS=${results.recommendation.scopes.length} sin-resolver=${results.unresolved.length}`,
);

// ---- privacy: no source value may reach this output ---------------------------
console.log("\n[5] Ningún valor privado entra al modelo de lectura ni a la salida");
// Origin is tracked so a leak can be REPORTED without printing the value.
const privateValues = new Map();
const remember = (value, origin) => {
  if (typeof value !== "string" || value.trim().length < 8) return;
  if (!privateValues.has(value)) privateValues.set(value, origin);
};
for (const person of plan.persons) {
  remember(person.displayName, "person.display_name");
  remember(person.identityNormalizedValue, "person.identity_normalized_value");
}
for (const identifier of plan.personIdentifiers) remember(identifier.originalValue, "person_external_identifier.original_value");
for (const point of plan.painPoints) remember(point.rawText, "pain_point.raw_text");
for (const response of plan.surveyResponses) remember(response.valueText, "survey_response.value_text");
for (const value of plan.participantAttributeValues) remember(value.valueText, "participant_attribute_value.value_text");
const meaningful = [...privateValues.keys()];
/**
 * The vocabulary that is SUPPOSED to be in the document.
 *
 * A scale option, a derived label, a documented response, a band label and a
 * filter option are aggregate vocabulary, not respondent data — a filter panel
 * cannot exist without them. Two things follow, and both are reported rather
 * than assumed:
 *
 *   - a private string that happens to be IDENTICAL to one of these is a
 *     COINCIDENCE, not a leak. The curated pain map contains the single word
 *     «Desconocimiento», which is also the satisfaction scale's own category
 *     label. Counting that as a leak would make the check cry wolf until
 *     somebody weakened it; the count of such collisions is printed instead.
 *   - every other private string must be absent, and that half is strict.
 */
const vocabulary = new Set();
const addVocabulary = (value) => {
  if (typeof value === "string" && value.trim() !== "") vocabulary.add(value.trim());
};
for (const option of source.scaleOptions) {
  addVocabulary(option.rawValue);
  addVocabulary(option.derivedLabel);
}
for (const scheme of source.bandSchemes) for (const rule of scheme.rules) addVocabulary(rule.label);
for (const value of CUICUILCO_RESULTS_V1.unawareness.rawValues) addVocabulary(value);
for (const value of CUICUILCO_RESULTS_V1.unawareness.derivedLabels) addVocabulary(value);
for (const group of CUICUILCO_RESULTS_V1.qualitative) {
  for (const entry of group.excludedLabels) addVocabulary(entry.label);
}
for (const answer of source.answers) {
  if (CUICUILCO_RESULTS_V1.closedCodedItemKeys.includes(answer.itemKey)) addVocabulary(answer.text);
}
for (const dimension of results.filters.dimensions) {
  for (const option of dimension.values) addVocabulary(option.value);
}
for (const entry of results.renewal.distribution ?? []) {
  addVocabulary(entry.response);
  addVocabulary(entry.level);
}

const serializedSource = JSON.stringify(source);
const serializedResults = JSON.stringify(results);
// The curated map writes each phrase as a sentence, so «Desconocimiento.» and
// the scale category «Desconocimiento» are the same word wearing a full stop.
// Trailing punctuation is stripped before the collision test for exactly that.
const isVocabulary = (value) => vocabulary.has(value.trim().replace(/[.;:,]+$/, "").trim());
const collisions = meaningful.filter(isVocabulary);
const mustBeAbsent = meaningful.filter((value) => !isVocabulary(value));
const leakedSource = mustBeAbsent.filter((value) => serializedSource.includes(value));
const leakedResults = mustBeAbsent.filter((value) => serializedResults.includes(value));
console.log(
  `  vocabulario agregado legítimo: ${vocabulary.size} términos · ` +
    `${collisions.length} valores de origen coinciden literalmente con uno de ellos y se excluyen del rastreo · ` +
    `${mustBeAbsent.length} deben estar ausentes`,
);
const describeLeaks = (values) =>
  [...new Set(values.map((value) => `${privateValues.get(value)}(len ${value.length})`))].join(", ");
check(
  leakedSource.length === 0,
  `ninguno de los ${meaningful.length} valores privados del plan aparece en el modelo de lectura` +
    (leakedSource.length ? ` — FILTRADOS desde ${describeLeaks(leakedSource)}` : ""),
);
check(
  leakedResults.length === 0,
  "ninguno de esos valores aparece en el documento de resultados" +
    (leakedResults.length ? ` — FILTRADOS desde ${describeLeaks(leakedResults)}` : ""),
);
check(
  !("persons" in source) && !("personIdentifiers" in source),
  "el modelo de lectura no tiene siquiera un lugar donde poner una persona",
);

// ---- the comparison ----------------------------------------------------------
console.log("\n[6] Paridad contra el tablero aprobado");

// The resolver and the tally both live in `scripts/lib/canonical-golden-parity.mjs`,
// so this gate and the database-backed one compare the SAME expectations against
// the SAME document shape. Two copies would let "531/531 from memory" and
// "531/531 from the database" drift into two different claims.
const { outcome, mismatches, skipped, classified, unknownStatuses, bySection } = evaluateGoldenParity(
  results,
  fixture,
);
for (const expectation of unknownStatuses) bad(`estado de expectativa desconocido en ${expectation.id}: ${expectation.status}`);
for (const [section, entry] of [...bySection.entries()].sort()) {
  console.log(
    `  ${section.padEnd(16)} ofrecidas=${String(entry.offered).padStart(3)} ` +
      `falladas=${String(entry.failed).padStart(3)} no-comparables=${String(entry.classified).padStart(2)}`,
  );
}

if (mismatches.length > 0) {
  console.log("\n  DISCREPANCIAS");
  for (const { expectation, actual } of mismatches) {
    console.log(
      `    ✗ ${expectation.id} :: esperado ${JSON.stringify(expectation.expected)} · calculado ${JSON.stringify(actual)}`,
    );
    console.log(`        base declarada: ${expectation.denominator ?? "n/a"} · evidencia: ${expectation.evidence}`);
  }
}
if (skipped.length > 0) {
  console.log("\n  OMITIDAS (ni aprobadas ni falladas)");
  for (const { expectation, reason } of skipped) console.log(`    – ${expectation.id} :: ${reason}`);
}
if (classified.length > 0) {
  console.log("\n  NO COMPARABLES (ni aprobadas ni falladas)");
  for (const expectation of classified) {
    const why = expectation.classificationReason ?? expectation.unresolvedReason ?? "(sin razón registrada)";
    console.log(`    · [${expectation.status}] ${expectation.id} :: ${why}`);
  }
}

// ---- the unresolved states the DOCUMENT itself declares -----------------------
console.log("\n[7] Lo que el propio documento declara resuelto");
check(
  results.unresolved.length === 0,
  `el documento no carga ninguna pregunta abierta (${results.unresolved.length})`,
);
for (const item of results.configurationRequired) {
  console.log(`  · ${item.key} (${item.section}/${item.kind}) — lo aporta: ${item.suppliedBy}`);
}
check(
  results.journey.stageEvidence.status === "requires_explicit_configuration",
  "el vínculo indicador↔etapa es una regla del contrato, no una incertidumbre",
);
check(
  results.journey.stageEvidence.links.length === 0,
  "y no se emite ningún vínculo porque ninguna configuración lo declara",
);
check(
  results.journey.touchpoints.every(
    (touchpoint) => touchpoint.tdp !== undefined && touchpoint.unawareShareOfResponses !== undefined,
  ),
  "cada punto de contacto lleva directamente su TDP y la proporción auxiliar",
);
check(
  results.configurationRequired.some((item) => item.key === "curated_journey_pain_cloud"),
  "la nube curada del recorrido se declara contenido editorial, no un cálculo fallido",
);

// ---- summary -----------------------------------------------------------------
console.log("\n" + "=".repeat(74));
console.log(`RESUMEN: ${formatGoldenSummary(outcome)}`);
console.log(`Comprobaciones estructurales: ${failures} fallo(s).`);

if (failures > 0 || outcome.failed > 0 || outcome.skipped > 0) {
  console.error("RESULTADO: la paridad dorada NO se cumple. COMPUERTA BLOQUEADA.");
  process.exit(1);
}
console.log(
  "RESULTADO: cada valor comparable del tablero aprobado se reproduce desde el modelo canónico, " +
    "sin base de datos, sin red y sin que un valor privado salga de la fuente. COMPUERTA APROBADA.",
);
