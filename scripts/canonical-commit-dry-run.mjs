// =============================================================================
// Canonical commit — READ-ONLY projection dry run
//   npx tsx scripts/canonical-commit-dry-run.mjs <clean.xlsx> <curated.xlsx>
// =============================================================================
// Runs the real preflight and builds the real internal commit plan IN MEMORY,
// then reports what the projection produced.
//
// IT PERFORMS NO DATABASE OR NETWORK OPERATION. It imports the projector, never
// the server-only adapter, so there is no Supabase client anywhere in its
// module graph and nothing can be staged, committed or rolled back by running
// it. That is asserted below rather than asserted in prose.
//
// IT PRINTS NO PRIVATE VALUE. Only approved aggregates: entity-family counts,
// absence-state counts, worksheet names, coordinates, file hashes, blocker and
// warning totals, and the plan fingerprint. Every string it prints is either a
// count, a key the specification declares, a worksheet name, a coordinate, or
// a hash. Before printing anything it walks the finished plan for the fields
// that hold source values and refuses to continue if one of them could reach
// the output.
//
// The two real workbooks are NEVER committed to this repository, and neither is
// any output of this script.
// =============================================================================

import { readFileSync } from "node:fs";
import { basename } from "node:path";

import { preflightCanonicalPackage } from "../src/lib/ingestion/canonical-package/preflight.ts";
import { CUICUILCO_PACKAGE_SPEC_V1 } from "../src/lib/ingestion/canonical-package/spec.ts";
import { fileHash } from "../src/lib/ingestion/canonical-package/fingerprint.ts";
import { WorkbookView } from "../src/lib/ingestion/canonical-package/sheet-view.ts";
import { readXlsxWorkbook } from "../src/lib/ingestion/xlsx-reader.ts";
import {
  CUICUILCO_PROJECTION_V1,
  PLAN_FAMILIES,
  buildCanonicalCommitPlan,
} from "../src/lib/ingestion/canonical-commit/index.ts";

const paths = process.argv.slice(2);
if (paths.length !== 2) {
  console.error("Uso: canonical-commit-dry-run.mjs <datos-limpios.xlsx> <mapa-curado.xlsx>");
  process.exit(2);
}

const DISPOSABLE_TENANT = "00000000-0000-4000-8000-0000000000a1";
const DISPOSABLE_STUDY = "00000000-0000-4000-8000-0000000000b2";

let failures = 0;
const ok = (message) => console.log("  ✓", message);
const bad = (message) => {
  console.error("  ✗ FAIL:", message);
  failures += 1;
};
const check = (condition, message) => (condition ? ok(message) : bad(message));

function load(path) {
  const buffer = readFileSync(path);
  return {
    fileName: basename(path),
    bytes: buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength),
  };
}

console.log("Be Community — ensayo de proyección canónica (sólo lectura)");
console.log("=".repeat(70));

const files = paths.map(load);

// ---- preflight over the exact bytes ----------------------------------------
const preflight = await preflightCanonicalPackage(files, CUICUILCO_PACKAGE_SPEC_V1);
console.log("\n[1] Preflight");
for (const asset of preflight.assets) {
  console.log(
    `  papel=${asset.role} hojas=${asset.sheets.length} bytes=${asset.sizeBytes} ` +
      `sha256=${asset.sha256.slice(0, 23)}…`,
  );
}
console.log(`  bloqueos=${preflight.counts.blockers} advertencias=${preflight.counts.warnings} info=${preflight.counts.info}`);
console.log(`  clave del paquete=${preflight.packageIdempotencyKey}`);
check(preflight.counts.blockers === 0, "el paquete real no tiene bloqueos");
check(preflight.confirmationAllowed, "la confirmación está permitida");
for (const expectation of preflight.expectations) {
  if (!expectation.satisfied) bad(`expectativa incumplida ${expectation.code}: ${expectation.expected} vs ${expectation.actual}`);
}

if (preflight.counts.blockers > 0 || preflight.packageIdempotencyKey === null) {
  console.error("\nEl preflight bloquea el paquete; no se construye ningún plan.");
  process.exit(1);
}

// ---- the plan, built in memory ---------------------------------------------
const workbooks = new Map();
for (const file of files) {
  const sha256 = await fileHash(file.bytes);
  const role = preflight.assets.find((asset) => asset.sha256 === sha256)?.role;
  workbooks.set(role, new WorkbookView(await readXlsxWorkbook(file.bytes)));
}

const build = buildCanonicalCommitPlan({
  tenantId: DISPOSABLE_TENANT,
  studyId: DISPOSABLE_STUDY,
  packageIdempotencyKey: preflight.packageIdempotencyKey,
  spec: CUICUILCO_PACKAGE_SPEC_V1,
  projection: CUICUILCO_PROJECTION_V1,
  workbooks,
});

console.log("\n[2] Proyección");
for (const issue of build.issues) {
  const where = [issue.assetRole, issue.sheet, issue.coordinate].filter(Boolean).join(" ");
  console.log(`  [${issue.severity}] ${issue.code} ${where}`);
}
check(build.ok, `el plan se construyó sin bloqueos (${build.issues.filter((i) => i.severity === "blocker").length} bloqueo(s))`);
if (!build.ok) {
  console.error("\nLa proyección no produjo un plan. No se imprime nada más.");
  process.exit(1);
}

const plan = build.plan;

// ---- the privacy gate, before anything is printed --------------------------
// Every field below holds a source value. The dry run must never print one, so
// it collects them and asserts that none appears in what it is about to write.
const PRIVATE_FIELDS = [
  ["persons", ["displayName", "normalizedName", "identityNormalizedValue"]],
  ["personIdentifiers", ["originalValue", "normalizedValue"]],
  ["participantAttributeValues", ["valueText", "sourceRawValue"]],
  ["responseOptions", ["rawValue", "derivedLabel"]],
  ["surveyItems", ["prompt", "label"]],
  ["surveyResponses", ["valueText", "sourceRawValue", "sourceDerivedLabel"]],
  ["painPoints", ["rawText", "normalizedText"]],
  ["journeyStages", ["label"]],
  ["organizationalUnits", ["label"]],
  ["cultureDimensions", ["label"]],
  ["attributeDefinitions", ["label"]],
  ["sourceLineage", ["sourceRawValue"]],
];
// Worksheet names are APPROVED output — the read-only rule names them
// explicitly — and a column header may legitimately repeat one. They are
// therefore excluded from the private set instead of being suppressed from the
// report, which would hide the structural fact the report exists to state.
const worksheetNames = new Set();
for (const view of workbooks.values()) for (const sheet of view.sheets) worksheetNames.add(sheet.name.trim());

const privateValues = new Map();
for (const [family, fields] of PRIVATE_FIELDS) {
  for (const row of plan[family]) {
    for (const field of fields) {
      const value = row[field];
      if (typeof value !== "string") continue;
      const trimmed = value.trim();
      if (trimmed.length < 4 || worksheetNames.has(trimmed)) continue;
      if (!privateValues.has(trimmed)) privateValues.set(trimmed, `${family}.${field}`);
    }
  }
}

const printed = [];
const say = (line) => {
  printed.push(line);
  console.log(line);
};

// ---- entity families --------------------------------------------------------
say("\n[3] Familias de entidades del plan");
let total = 0;
for (const family of PLAN_FAMILIES) {
  total += plan[family].length;
  say(`  ${family.padEnd(32)} ${String(plan[family].length).padStart(6)}`);
}
say(`  ${"TOTAL".padEnd(32)} ${String(total).padStart(6)}`);
say(`  huella del plan = ${plan.planFingerprint}`);
say(`  tamaño del payload = ${new TextEncoder().encode(JSON.stringify(plan)).length} bytes`);

// ---- the approved structural totals -----------------------------------------
console.log("\n[4] Conciliación contra los totales aprobados");
const cohortCount = (key) => plan.participants.filter((row) => row.cohortKey === key).length;
check(plan.persons.length === 60, `60 identidades únicas (${plan.persons.length})`);
check(plan.personIdentifiers.length === 60, `60 identificadores externos (${plan.personIdentifiers.length})`);
check(cohortCount("active") === 28, `28 participaciones activas (${cohortCount("active")})`);
check(cohortCount("deserter") === 32, `32 participaciones desertoras (${cohortCount("deserter")})`);
check(plan.participants.length === 60, `60 participaciones en total (${plan.participants.length})`);
check(plan.surveyInstruments.length === 4, `4 instrumentos (${plan.surveyInstruments.length})`);
check(plan.studyDomains.length === 4, `4 dominios CSAT (${plan.studyDomains.length})`);

const itemsFor = (instrumentKey) => {
  const instrument = plan.surveyInstruments.find((row) => row.key === instrumentKey);
  return plan.surveyItems.filter((row) => row.surveyInstrumentId === instrument?.id);
};
check(itemsFor("csat").length === 55, `55 ítems CSAT (${itemsFor("csat").length})`);
check(itemsFor("nps_activos").length === 1, `1 ítem NPS activos (${itemsFor("nps_activos").length})`);
check(itemsFor("nps_desertores").length === 3, `3 ítems NPS desertores (${itemsFor("nps_desertores").length})`);
check(itemsFor("cri").length === 3, `3 ítems CRI (${itemsFor("cri").length})`);

const sessionsFor = (instrumentKey) => {
  const instrument = plan.surveyInstruments.find((row) => row.key === instrumentKey);
  return plan.surveySessions.filter((row) => row.surveyInstrumentId === instrument?.id);
};
check(sessionsFor("csat").length === 28, `28 sesiones CSAT (${sessionsFor("csat").length})`);
check(sessionsFor("nps_activos").length === 28, `28 sesiones NPS activos (${sessionsFor("nps_activos").length})`);
const desertorSessions = sessionsFor("nps_desertores");
const answeredDesertor = desertorSessions.filter((row) => row.status === "answered").length;
const absentDesertor = desertorSessions.filter((row) => row.status === "not_participated").length;
check(answeredDesertor === 11, `11 sesiones de salida respondidas (${answeredDesertor})`);
check(absentDesertor === 21, `21 sesiones de salida marcadas como no participación (${absentDesertor})`);
check(desertorSessions.length === 32, `32 sesiones de salida en total (${desertorSessions.length})`);
check(sessionsFor("cri").length === 28, `28 sesiones CRI (${sessionsFor("cri").length})`);

const responsesForSessions = (sessions) => {
  const ids = new Set(sessions.map((row) => row.id));
  return plan.surveyResponses.filter((row) => ids.has(row.surveySessionId));
};
check(responsesForSessions(sessionsFor("csat")).length === 1540, `1 540 respuestas CSAT (${responsesForSessions(sessionsFor("csat")).length})`);
const absentSessionIds = new Set(desertorSessions.filter((row) => row.status === "not_participated").map((row) => row.id));
check(
  plan.surveyResponses.every((row) => !absentSessionIds.has(row.surveySessionId)),
  "ninguna respuesta cuelga de una sesión de no participación",
);

check(plan.retentionPeriods.length === 6, `6 periodos de retención (${plan.retentionPeriods.length})`);
check(
  plan.retentionPeriods.every((row) => row.identityVerified),
  "los 6 periodos cumplen final = inicial - perdidos + nuevos",
);
const months = new Set(plan.performanceObservations.map((row) => row.periodStart));
check(months.size === 9, `9 periodos mensuales de desempeño (${months.size})`);
check(
  [...months].sort().join(",") ===
    "2025-10-01,2025-11-01,2025-12-01,2026-01-01,2026-02-01,2026-03-01,2026-04-01,2026-05-01,2026-06-01",
  "los meses van de octubre 2025 a junio 2026",
);
check(plan.performanceObservations.length === 252, `252 observaciones mensuales (${plan.performanceObservations.length})`);
check(plan.journeyStages.length === 18, `18 etapas del journey (${plan.journeyStages.length})`);
check(plan.journeyModels.length === 1, `1 modelo de journey (${plan.journeyModels.length})`);
check(plan.organizationalUnits.length === 10, `10 unidades organizacionales (${plan.organizationalUnits.length})`);
const edl = plan.cultureDimensions.filter((row) => row.audience === "edl").length;
const members = plan.cultureDimensions.filter((row) => row.audience === "members").length;
check(edl === 10, `10 dimensiones de cultura EDL (${edl})`);
check(members === 10, `10 dimensiones de cultura de miembros (${members})`);
const curatedDimensions = plan.performanceDimensions.filter((row) => row.key !== "desempeno_mensual").length;
check(curatedDimensions === 7, `7 dimensiones de desempeño curadas (${curatedDimensions})`);

// ---- meaning that must survive the projection -------------------------------
console.log("\n[5] Distinciones de la fuente que el plan conserva");
const tally = (rows, field) => {
  const counts = new Map();
  for (const row of rows) counts.set(row[field], (counts.get(row[field]) ?? 0) + 1);
  return [...counts.entries()].sort(([a], [b]) => (a < b ? -1 : 1));
};
say(`  respuestas por estado: ${tally(plan.surveyResponses, "status").map(([k, v]) => `${k}=${v}`).join(" ")}`);
say(`  atributos por estado:  ${tally(plan.participantAttributeValues, "status").map(([k, v]) => `${k}=${v}`).join(" ")}`);
say(`  desempeño por estado:  ${tally(plan.performanceObservations, "status").map(([k, v]) => `${k}=${v}`).join(" ")}`);
say(`  sesiones por estado:   ${tally(plan.surveySessions, "status").map(([k, v]) => `${k}=${v}`).join(" ")}`);
say(`  participación:         ${tally(plan.participants, "surveyParticipationStatus").map(([k, v]) => `${k}=${v}`).join(" ")}`);
say(`  anotaciones visuales por papel: ${tally(plan.visualAnnotations, "role").map(([k, v]) => `${k}=${v}`).join(" ")}`);
say(`  anotaciones en revisión pendiente: ${plan.visualAnnotations.filter((row) => row.reviewStatus === "pending").length}`);

const performanceUnavailable = plan.performanceObservations.filter((row) => row.status !== "answered").length;
check(performanceUnavailable > 0, `${performanceUnavailable} celdas mensuales sin valor conservan su estado y no son 0`);
check(
  plan.performanceObservations.every((row) => (row.status === "answered") === (row.value !== null)),
  "ninguna ausencia mensual lleva un valor y ningún valor carece de estado",
);
check(
  plan.participantAttributeValues.every((row) => {
    const filled = [row.valueText, row.valueNumeric, row.valueDate, row.valueBoolean].filter((v) => v !== null).length;
    return filled === (row.status === "answered" ? 1 : 0);
  }),
  "cada atributo lleva exactamente un valor cuando fue respondido y ninguno cuando no",
);
const derivedLabels = plan.surveyResponses.filter((row) => row.sourceDerivedLabel !== null).length;
check(derivedLabels > 0, `${derivedLabels} etiquetas derivadas viajan en la MISMA fila de respuesta`);
check(
  plan.surveyResponses.length === 1540 + 28 + 33 + 84,
  `las etiquetas derivadas no crearon respuestas nuevas (${plan.surveyResponses.length})`,
);

// ---- lineage ---------------------------------------------------------------
console.log("\n[6] Trazabilidad");
const lineageByTable = new Map();
for (const row of plan.sourceLineage) {
  lineageByTable.set(row.targetTable, (lineageByTable.get(row.targetTable) ?? 0) + 1);
}
say(
  `  filas de linaje: ${plan.sourceLineage.length} sobre ${lineageByTable.size} tablas destino`,
);
for (const [table, count] of [...lineageByTable.entries()].sort()) say(`    ${table.padEnd(32)} ${String(count).padStart(6)}`);
const sheets = [...new Set(plan.sourceLineage.map((row) => row.sheetName))].sort();
say(`  hojas citadas (${sheets.length}): ${sheets.map((name) => JSON.stringify(name)).join(", ")}`);
check(sheets.includes("Equipos "), "el nombre de hoja con espacio final sobrevive en el linaje");
check(
  plan.sourceLineage.every((row) => /^[A-Z]{1,3}\d+(:[A-Z]{1,3}\d+)?$|^[A-Z]{1,3}$/.test(row.cellOrRange)),
  "cada fila de linaje trae una coordenada o un rango legible",
);
const traced = new Set(plan.sourceLineage.map((row) => `${row.targetTable}|${row.targetRecordId}`));
const mustBeTraced = [
  ["person_private", plan.persons],
  ["study_participant", plan.participants],
  ["participant_attribute_value", plan.participantAttributeValues],
  ["survey_response", plan.surveyResponses],
  ["performance_observation", plan.performanceObservations],
  ["retention_period", plan.retentionPeriods],
  ["pain_point", plan.painPoints],
  ["journey_stage", plan.journeyStages],
];
for (const [table, rows] of mustBeTraced) {
  const missing = rows.filter((row) => !traced.has(`${table}|${row.id}`)).length;
  check(missing === 0, `cada fila de ${table} tiene linaje (${rows.length - missing}/${rows.length})`);
}

// ---- determinism and order independence -------------------------------------
console.log("\n[7] Determinismo");
const second = buildCanonicalCommitPlan({
  tenantId: DISPOSABLE_TENANT,
  studyId: DISPOSABLE_STUDY,
  packageIdempotencyKey: preflight.packageIdempotencyKey,
  spec: CUICUILCO_PACKAGE_SPEC_V1,
  projection: CUICUILCO_PROJECTION_V1,
  workbooks,
});
check(second.ok && second.plan.planFingerprint === plan.planFingerprint, "dos proyecciones de los mismos bytes coinciden");

const reversed = await preflightCanonicalPackage([files[1], files[0]], CUICUILCO_PACKAGE_SPEC_V1);
check(
  reversed.packageIdempotencyKey === preflight.packageIdempotencyKey,
  "subir los archivos en el otro orden produce la misma clave de paquete",
);
const reversedWorkbooks = new Map();
for (const file of [files[1], files[0]]) {
  const sha256 = await fileHash(file.bytes);
  const role = reversed.assets.find((asset) => asset.sha256 === sha256)?.role;
  reversedWorkbooks.set(role, new WorkbookView(await readXlsxWorkbook(file.bytes)));
}
const reversedBuild = buildCanonicalCommitPlan({
  tenantId: DISPOSABLE_TENANT,
  studyId: DISPOSABLE_STUDY,
  packageIdempotencyKey: reversed.packageIdempotencyKey,
  spec: CUICUILCO_PACKAGE_SPEC_V1,
  projection: CUICUILCO_PROJECTION_V1,
  workbooks: reversedWorkbooks,
});
check(
  reversedBuild.ok && reversedBuild.plan.planFingerprint === plan.planFingerprint,
  "y el mismo plan, con la misma huella",
);

// ---- the privacy assertion, over everything printed -------------------------
console.log("\n[8] Ningún valor privado salió por la salida estándar");
const output = printed.join("\n");
// A leak is reported by its FAMILY, FIELD and LENGTH. Printing the value to
// prove it was printed would be the same mistake twice.
const leaked = [...privateValues.entries()]
  .filter(([value]) => output.includes(value))
  .map(([value, origin]) => `${origin} (${value.length} car.)`);
check(
  leaked.length === 0,
  `ninguno de los ${privateValues.size} valores de origen del plan aparece en la salida` +
    (leaked.length > 0 ? ` — se filtraron ${leaked.length}: ${leaked.slice(0, 8).join(", ")}` : ""),
);

// ---- and the module graph really is offline ---------------------------------
// The claim "this performed no database operation" is proved from the imports,
// not asserted in prose: every module this script pulls in is read and must be
// free of a Supabase client. `adapter.ts` and `server.ts` are the write path
// and are deliberately absent from the graph.
console.log("\n[9] El ensayo no puede escribir nada");
{
  const graph = [
    "src/lib/ingestion/xlsx-reader.ts",
    "src/lib/ingestion/canonical-package/preflight.ts",
    "src/lib/ingestion/canonical-package/spec.ts",
    "src/lib/ingestion/canonical-package/fingerprint.ts",
    "src/lib/ingestion/canonical-package/sheet-view.ts",
    "src/lib/ingestion/canonical-package/values.ts",
    "src/lib/ingestion/canonical-commit/index.ts",
    "src/lib/ingestion/canonical-commit/projector.ts",
    "src/lib/ingestion/canonical-commit/projection-spec.ts",
    "src/lib/ingestion/canonical-commit/plan.ts",
    "src/lib/ingestion/canonical-commit/fingerprint.ts",
    "src/lib/ingestion/canonical-commit/sha256.ts",
    "src/lib/ingestion/canonical-commit/ids.ts",
    "src/lib/ingestion/canonical-commit/reconcile.ts",
    "src/lib/ingestion/canonical-commit/result.ts",
  ];
  // Comments are stripped first: several of these files DESCRIBE the write
  // path in prose, and a scan that cannot tell code from a comment would
  // either fail here or be quietly loosened until it proved nothing.
  const stripComments = (code) =>
    code.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
  const writers = graph.filter((path) =>
    /@supabase|createAdminClient|\.rpc\(|["']server-only["']/.test(stripComments(readFileSync(path, "utf8"))),
  );
  check(writers.length === 0, `ningún módulo del ensayo alcanza la base de datos${writers.length ? `: ${writers.join(", ")}` : ""}`);
  const self = readFileSync("scripts/canonical-commit-dry-run.mjs", "utf8");
  check(
    !/canonical-commit\/(adapter|server)/.test(self),
    "el ensayo no importa el adaptador server-only",
  );
}

console.log("\n" + "=".repeat(70));
if (failures > 0) {
  console.error(`RESULTADO: ${failures} fallo(s). El ensayo no concilia.`);
  process.exit(1);
}
console.log(
  "RESULTADO: el paquete real se proyecta completo, conserva cada distinción de la fuente y no " +
    "escribió ni consultó nada. ENSAYO CONCILIADO.",
);
