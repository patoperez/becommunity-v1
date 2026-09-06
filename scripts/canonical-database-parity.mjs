// =============================================================================
// DATABASE-BACKED GOLDEN PARITY — the canonical tables against the approved
// dashboard, and against the in-memory projection.
// =============================================================================
//   CANONICAL_IMPORT_PROJECT_REF=<ref> \
//   CANONICAL_IMPORT_ACKNOWLEDGE=I-AUTHORIZE-CANONICAL-IMPORT-INTO-<ref> \
//   CANONICAL_IMPORT_SERVICE_KEY=<key> \
//   CANONICAL_IMPORT_TENANT_ID=<uuid> CANONICAL_IMPORT_STUDY_ID=<uuid> \
//   CANONICAL_IMPORT_PLAN_FINGERPRINT=sha256:… CANONICAL_IMPORT_MAPPING_VERSION=1 \
//   CANONICAL_IMPORT_CLEAN_XLSX=<path> CANONICAL_IMPORT_PAIN_XLSX=<path> \
//     npm run canonical-database-parity
// =============================================================================
// THIS GATE ONLY READS. It never calls `--execute`, never stages, never commits
// and never rolls back: the target guard is resolved in DRY-RUN mode, which is
// the mode that cannot mutate, and no RPC is invoked anywhere in this file.
//
// -----------------------------------------------------------------------------
// WHAT IT PROVES, IN THREE INDEPENDENT COMPARISONS
// -----------------------------------------------------------------------------
//   A. THE TWO ADAPTERS AGREE. The read model read out of the canonical tables
//      is deep-equal to the read model built in memory from the two workbooks,
//      family by family, once both are put into the shared comparison order.
//      That is the strongest available statement that the import lost nothing
//      and invented nothing.
//   B. THE TWO DOCUMENTS AGREE. The whole results document calculated from the
//      database source is byte-identical to the one calculated from the
//      in-memory source. If a calculator ever started depending on array
//      position rather than on an explicit order, this is what would fail.
//   C. THE DATABASE DOCUMENT MATCHES THE APPROVED DASHBOARD. The same golden
//      fixture, the same resolver, the same tally — reached through
//      `scripts/lib/canonical-golden-parity.mjs` so that "531/531 from the
//      database" is literally the same comparison as "531/531 from memory".
//
// Plus the invariants the owner named explicitly: the population, the distinct
// instrument denominators, the NPS bases, CSAT per touchpoint, TDP as the ratio
// over the valid base and never clamped, the auxiliary unawareness share under
// its own name, the refused Esfera x CRI cross, the populated `Capitanes`
// touchpoint, the absence of small-sample suppression, and the curated journey
// cloud as editorial content rather than a fabricated calculation.
//
// -----------------------------------------------------------------------------
// WHAT IT PRINTS
// -----------------------------------------------------------------------------
// Counts, keys, statuses and parity verdicts. A difference is reported by its
// PATH; a differing string is reported by its LENGTH, never by its content,
// because a label difference is exactly where a respondent value would surface
// if one ever leaked into the model. Before it finishes it asserts that no
// private value from the plan appears anywhere in the database source, in the
// document, or in its own output.
// =============================================================================

import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

import { preflightCanonicalPackage } from "../src/lib/ingestion/canonical-package/preflight.ts";
import { CUICUILCO_PACKAGE_SPEC_V1 } from "../src/lib/ingestion/canonical-package/spec.ts";
import { WorkbookView } from "../src/lib/ingestion/canonical-package/sheet-view.ts";
import { readXlsxWorkbook } from "../src/lib/ingestion/xlsx-reader.ts";
import { CUICUILCO_PROJECTION_V1, buildCanonicalCommitPlan } from "../src/lib/ingestion/canonical-commit/index.ts";
import {
  CUICUILCO_RESULTS_V1,
  buildCanonicalStudyResults,
  canonicalResultSourceFromCommitPlan,
} from "../src/lib/results/index.ts";
import {
  canonicalResultSourceFromRows,
  loadCanonicalRowSet,
  normalizeCanonicalResultSource,
  postgrestReadTransport,
} from "../src/lib/canonical-source/index.ts";
import {
  REQUIRED_DASHBOARD_COMMIT,
  evaluateGoldenParity,
  formatGoldenSummary,
  loadGoldenFixture,
} from "./lib/canonical-golden-parity.mjs";
import {
  ImportTargetError,
  describeImportTarget,
  parseImportArguments,
  resolveImportTarget,
} from "./lib/canonical-import-target.mjs";

let target;
try {
  // Dry-run mode on purpose: this gate must not be able to mutate anything.
  const options = parseImportArguments(process.argv.slice(2));
  if (options.execute) {
    console.error("REFUSED: this gate only reads. It has no --execute mode.");
    process.exit(2);
  }
  target = resolveImportTarget(process.env, options);
} catch (thrown) {
  if (thrown instanceof ImportTargetError) {
    console.error(`REFUSED: ${thrown.message}`);
    process.exit(2);
  }
  throw thrown;
}

let failures = 0;
const printed = [];
const say = (line) => {
  printed.push(line);
  console.log(line);
};
const ok = (message) => say(`  ✓ ${message}`);
const bad = (message) => {
  failures += 1;
  say(`  ✗ FALLO: ${message}`);
};
const check = (condition, message) => (condition ? ok(message) : bad(message));

say("Be Community — paridad dorada DESDE LA BASE DE DATOS canónica");
say("=".repeat(78));
for (const [key, value] of Object.entries(describeImportTarget(target))) say(`  ${key}: ${value}`);

// ===========================================================================
// [1] The in-memory side, from the exact same bytes the import used
// ===========================================================================
say("\n[1] Proyección en memoria desde los dos libros reales");
function load(path) {
  const buffer = readFileSync(path);
  return {
    fileName: path.replace(/^.*[\\/]/, ""),
    bytes: buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength),
  };
}
const files = [load(target.cleanPath), load(target.painPath)];
const preflight = await preflightCanonicalPackage(
  files.map(({ fileName, bytes }) => ({ fileName, bytes })),
  CUICUILCO_PACKAGE_SPEC_V1,
);
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
  tenantId: target.tenantId,
  studyId: target.studyId,
  packageIdempotencyKey: preflight.packageIdempotencyKey,
  spec: CUICUILCO_PACKAGE_SPEC_V1,
  projection: CUICUILCO_PROJECTION_V1,
  workbooks,
});
check(build.ok === true, "la proyección produce un plan");
if (!build.ok) process.exit(1);
const plan = build.plan;
say(`  huella del plan = ${plan.planFingerprint}`);
say(`  clave del paquete = ${plan.packageIdempotencyKey}`);
check(plan.planFingerprint === target.planFingerprint, "la huella del plan es la autorizada");

const memorySourceRaw = canonicalResultSourceFromCommitPlan(plan, { spec: CUICUILCO_RESULTS_V1 });
const memorySource = normalizeCanonicalResultSource(memorySourceRaw);

// ===========================================================================
// [2] The database side, read ONLY through the new adapter
// ===========================================================================
say("\n[2] Lectura desde las tablas canónicas");
const client = createClient(target.apiOrigin, target.serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const readStarted = Date.now();
const rowSet = await loadCanonicalRowSet(postgrestReadTransport(client), {
  tenantId: target.tenantId,
  studyId: target.studyId,
  packageIdempotencyKey: plan.packageIdempotencyKey,
});
const readMs = Date.now() - readStarted;
say(`  trabajo de importación = ${rowSet.importJob.id}   estado = ${rowSet.importJob.status}`);
say(`  huella almacenada = ${rowSet.planFingerprint}   (${readMs} ms de lectura paginada)`);
check(rowSet.planFingerprint === plan.planFingerprint, "la base de datos guarda la MISMA huella de plan");
check(rowSet.importJob.idempotency_key === plan.packageIdempotencyKey, "y la misma clave de paquete");
check(rowSet.specId === CUICUILCO_RESULTS_V1.specId, `la especificación almacenada es '${rowSet.specId}'`);
check(
  rowSet.importJob.mapping_version === CUICUILCO_RESULTS_V1.mappingVersion,
  `la versión de mapeo almacenada es ${rowSet.importJob.mapping_version}`,
);

const databaseSource = canonicalResultSourceFromRows(rowSet, {
  spec: CUICUILCO_RESULTS_V1,
  tenantId: target.tenantId,
  studyId: target.studyId,
});

// ===========================================================================
// [3] A. The two adapters produce the same read model
// ===========================================================================
say("\n[3] A — el modelo de lectura de la base de datos contra el de memoria");

/**
 * Structural difference, reported by PATH.
 *
 * A differing string is reported by its LENGTH and never by its content: a
 * label difference is exactly where a respondent value would surface if one
 * ever leaked into the model, and printing it to explain the leak would be the
 * same mistake twice. Numbers and booleans are aggregates and are printed.
 */
function differences(left, right, path = "", found = []) {
  if (found.length >= 40) return found;
  if (Object.is(left, right)) return found;
  const describe = (value) =>
    typeof value === "string"
      ? `«texto de ${value.length} car.»`
      : value === null || value === undefined || typeof value === "number" || typeof value === "boolean"
        ? JSON.stringify(value)
        : Array.isArray(value)
          ? `[${value.length}]`
          : "{objeto}";
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right)) {
      found.push(`${path}: ${describe(left)} vs ${describe(right)}`);
      return found;
    }
    if (left.length !== right.length) {
      found.push(`${path}: longitud ${left.length} vs ${right.length}`);
      return found;
    }
    for (let index = 0; index < left.length && found.length < 40; index += 1) {
      differences(left[index], right[index], `${path}[${index}]`, found);
    }
    return found;
  }
  if (left && right && typeof left === "object" && typeof right === "object") {
    const keys = [...new Set([...Object.keys(left), ...Object.keys(right)])].sort();
    for (const key of keys) {
      if (found.length >= 40) break;
      differences(left[key], right[key], path ? `${path}.${key}` : key, found);
    }
    return found;
  }
  found.push(`${path}: ${describe(left)} vs ${describe(right)}`);
  return found;
}

const FAMILIES = Object.keys(memorySource).filter((key) => Array.isArray(memorySource[key]));
let familyFailures = 0;
for (const family of FAMILIES) {
  const diff = differences(databaseSource[family], memorySource[family], family);
  const same = diff.length === 0;
  if (!same) familyFailures += 1;
  say(
    `  ${family.padEnd(28)} bd=${String(databaseSource[family].length).padStart(5)} ` +
      `memoria=${String(memorySource[family].length).padStart(5)}  ${same ? "idéntico" : `DIFIERE (${diff.length})`}`,
  );
  if (!same) for (const entry of diff.slice(0, 6)) say(`      ${entry}`);
}
check(familyFailures === 0, `las ${FAMILIES.length} familias del modelo de lectura son idénticas`);
const identityDiff = differences(databaseSource.identity, memorySource.identity, "identity");
check(identityDiff.length === 0, `la identidad del origen coincide${identityDiff.length ? `: ${identityDiff.join("; ")}` : ""}`);

// ===========================================================================
// [4] B. The two documents are byte-identical
// ===========================================================================
say("\n[4] B — el documento de resultados calculado desde cada origen");
const fixture = loadGoldenFixture();
check(
  fixture.generatedFrom.commit === REQUIRED_DASHBOARD_COMMIT,
  `el fixture procede del tablero aprobado ${fixture.generatedFrom.commit}`,
);
const options = { period: { label: fixture.generatedFrom.period ?? null, dataCutoff: null } };
const databaseResults = buildCanonicalStudyResults(databaseSource, options);
const memoryResults = buildCanonicalStudyResults(memorySource, options);
const memoryResultsInProjectorOrder = buildCanonicalStudyResults(memorySourceRaw, options);
const serializedDatabase = JSON.stringify(databaseResults);
const serializedMemory = JSON.stringify(memoryResults);
say(`  contrato = ${databaseResults.contractVersion}   bytes = ${serializedDatabase.length}`);
const documentDiff = differences(databaseResults, memoryResults, "results");
check(
  serializedDatabase === serializedMemory && documentDiff.length === 0,
  `los dos documentos son idénticos byte a byte${documentDiff.length ? ` — ${documentDiff.slice(0, 8).join("; ")}` : ""}`,
);

/**
 * And the PROJECTOR's own order moves no number.
 *
 * `CanonicalResultSource` says array order is the ADAPTER's responsibility and
 * that each array arrives in its source's own order, so two adapters may
 * legitimately hand the same records over in two different orders — the
 * projector reads a worksheet column by column, the database reads a keyset
 * over a uuid. A few arrays in the document deliberately carry that order
 * through (`population.instruments` is one). What must never differ is a value,
 * a count or a base, so the two documents are compared again with every array
 * sorted by its own serialisation: presentation order may differ, arithmetic
 * may not.
 */
const orderInsensitive = (value) => {
  if (Array.isArray(value)) {
    return value.map(orderInsensitive).sort((x, y) => (JSON.stringify(x) < JSON.stringify(y) ? -1 : 1));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, orderInsensitive(value[key])]),
    );
  }
  return value;
};
const projectorOrderDiff = differences(databaseResults, memoryResultsInProjectorOrder, "results");
check(
  JSON.stringify(orderInsensitive(databaseResults)) ===
    JSON.stringify(orderInsensitive(memoryResultsInProjectorOrder)),
  "y contra el documento en el ORDEN DEL PROYECTOR no se mueve ningún número",
);
say(
  `  el orden del proyector difiere del orden compartido en ${projectorOrderDiff.length} ruta(s)` +
    (projectorOrderDiff.length
      ? `: ${[...new Set(projectorOrderDiff.map((entry) => entry.split("[")[0]))].join(", ")}` +
        " — orden de presentación que el contrato delega en el adaptador"
      : ""),
);
check(
  databaseResults.study.planFingerprint === plan.planFingerprint,
  "el documento de la base de datos cita la huella del plan importado",
);

// ===========================================================================
// [5] C. The database document against the approved dashboard
// ===========================================================================
say("\n[5] C — paridad dorada contra el tablero aprobado, desde la base de datos");
const { outcome, mismatches, skipped, classified, unknownStatuses, bySection } = evaluateGoldenParity(
  databaseResults,
  fixture,
);
for (const expectation of unknownStatuses) bad(`estado de expectativa desconocido en ${expectation.id}`);
for (const [section, entry] of [...bySection.entries()].sort()) {
  say(
    `  ${section.padEnd(16)} ofrecidas=${String(entry.offered).padStart(3)} ` +
      `falladas=${String(entry.failed).padStart(3)} no-comparables=${String(entry.classified).padStart(2)}`,
  );
}
for (const { expectation, actual } of mismatches) {
  say(`    ✗ ${expectation.id} :: esperado ${JSON.stringify(expectation.expected)} · calculado ${JSON.stringify(actual)}`);
}
for (const { expectation, reason } of skipped) say(`    – ${expectation.id} :: ${reason}`);
say(`  no comparables conservadas: ${classified.map((entry) => `${entry.status}/${entry.id}`).join(", ")}`);
check(outcome.executed === 531, `531 comparaciones ejecutadas (${outcome.executed})`);
check(outcome.passed === 531, `531 aprobadas (${outcome.passed})`);
check(outcome.failed === 0, `0 falladas (${outcome.failed})`);
check(outcome.skipped === 0, `0 omitidas (${outcome.skipped})`);
check(outcome.unresolved === 0, `0 sin resolver (${outcome.unresolved})`);
check(outcome.notApplicable === 2, `2 clasificadas como no aplica (${outcome.notApplicable})`);
check(outcome.configurationRequired === 1, `1 clasificada como requiere configuración (${outcome.configurationRequired})`);

// ===========================================================================
// [6] The invariants the owner named, checked on the DATABASE document
// ===========================================================================
say("\n[6] Invariantes críticos, sobre el documento leído de la base de datos");
const cohort = (key) => databaseResults.population.cohorts.find((entry) => entry.key === key) ?? null;
const scope = (key) => databaseResults.recommendation.scopes.find((entry) => entry.key === key) ?? null;

check(databaseResults.population.total === 60, `población = 60 (${databaseResults.population.total})`);
check(cohort("active")?.total === 28, `miembros activos = 28 (${cohort("active")?.total})`);
check(cohort("deserter")?.total === 32, `ex miembros = 32 (${cohort("deserter")?.total})`);

const instrumentBases = new Map(databaseResults.population.instruments.map((entry) => [entry.key, entry.base.valid]));
say(`  bases por instrumento: ${[...instrumentBases].map(([k, v]) => `${k}=${v}`).join(" ")}`);
check(
  new Set(
    databaseResults.population.instruments
      .map((entry) => `${entry.key}:${entry.base.valid}`)
      .concat([`cri:${databaseResults.renewal.base.valid}`]),
  ).size >= 3,
  "los denominadores de cada instrumento se reportan por separado",
);
const npsBases = databaseResults.recommendation.scopes.map((entry) => `${entry.key}=${entry.score.base.valid}`);
say(`  bases NPS: ${npsBases.join(" ")}`);
check(
  databaseResults.recommendation.scopes.every((entry) => entry.score.base.valid <= entry.score.base.responded),
  "cada base NPS respeta válido <= respondido",
);
check(scope("combinado") !== null, "el alcance NPS combinado existe");

const touchpoints = databaseResults.journey.touchpoints;
check(touchpoints.length === 55, `55 puntos de contacto (${touchpoints.length})`);
check(
  touchpoints.every((entry) => entry.satisfaction !== undefined && entry.satisfaction.base !== undefined),
  "cada punto de contacto lleva su propio CSAT con su base",
);
check(
  touchpoints.every((entry) => entry.tdp !== undefined && entry.unawareShareOfResponses !== undefined),
  "cada punto lleva su TDP y, con nombre propio, la proporción auxiliar de desconocimiento",
);
const tdpOver100 = touchpoints.filter(
  (entry) => entry.tdp?.status === "available" && entry.tdp.value.value > 100,
).length;
const maxTdp = Math.max(
  ...touchpoints.map((entry) => (entry.tdp?.status === "available" ? entry.tdp.value.value : 0)),
);
say(`  TDP máximo = ${maxTdp}   puntos con TDP > 100 = ${tdpOver100}`);
check(maxTdp > 0, "el TDP se calcula y no viene vacío");
check(
  touchpoints.every((entry) => entry.tdp?.status !== "available" || entry.tdp.value.value >= 0),
  "el TDP nunca es negativo y no se recorta a 100",
);
check(
  databaseResults.journey.excluded.length === 0,
  `ningún punto de contacto poblado quedó excluido (${databaseResults.journey.excluded.length})`,
);
// Accent-insensitive, because the source spells the word with one and a
// literal comparison would silently find nothing and report a pass.
const foldAccents = (value) => value.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
const capitanes = touchpoints.filter((entry) => foldAccents(entry.label).includes("capitan"));
check(capitanes.length === 1, `el punto «Capitanes» aparece exactamente una vez (${capitanes.length})`);
check(
  capitanes.length === 1 && capitanes[0].counts.responses > 0 && capitanes[0].counts.valid > 0,
  `y está poblado: no es la columna rota del CSV revisado (clave ${capitanes[0]?.key ?? "?"}, ` +
    `${capitanes[0]?.counts.responses ?? 0} respuestas, ${capitanes[0]?.counts.valid ?? 0} válidas)`,
);
check(
  databaseResults.journey.groups.reduce((sum, group) => sum + group.touchpointKeys.length, 0) === touchpoints.length,
  "los cuatro grupos del recorrido cubren exactamente los 55 puntos",
);

const forbidden = databaseResults.filters.dimensions.flatMap((dimension) =>
  dimension.forbiddenSections.map((entry) => `${dimension.key}/${entry.section}`),
);
say(`  cruces prohibidos declarados: ${forbidden.join(", ") || "ninguno"}`);
check(forbidden.length > 0, "el contrato declara al menos un cruce prohibido");

// The refusal is EXECUTED, not read off the contract: the forbidden cross is
// actually applied to the database-backed source, and the answer must be an
// explicit refusal with an empty base and no distribution at all — not a
// number, and not five zeroes beside a real base.
{
  const dimensionKey = CUICUILCO_RESULTS_V1.forbiddenCrosses.find((cross) => cross.section === "renewal")?.attributeKey;
  const dimension = databaseResults.filters.dimensions.find((entry) => entry.key === dimensionKey);
  const value = dimension?.values[0]?.value ?? null;
  check(dimensionKey !== undefined && value !== null, `la dimensión prohibida '${dimensionKey}' existe y tiene valores`);
  if (value !== null) {
    const crossed = buildCanonicalStudyResults(databaseSource, {
      ...options,
      filters: [{ dimensionKey, values: [value] }],
    });
    check(crossed.renewal.index.status === "unavailable", "Esfera × CRI no devuelve un número");
    check(
      crossed.renewal.index.status === "unavailable" && crossed.renewal.index.reason === "cross_not_permitted",
      "y lo rechaza nombrando la razón 'cross_not_permitted'",
    );
    check(crossed.renewal.distribution === null, "y retira la distribución entera, no sólo el titular");
    check(crossed.renewal.base.valid === 0 && crossed.renewal.base.eligible === 0, "y vacía la base");
  }
}

check(databaseResults.unresolved.length === 0, `el documento no carga ninguna pregunta abierta (${databaseResults.unresolved.length})`);
check(
  databaseResults.journey.stageEvidence.status === "requires_explicit_configuration",
  "el vínculo indicador↔etapa sigue siendo una regla del contrato",
);
check(
  databaseResults.configurationRequired.some((item) => item.key === "curated_journey_pain_cloud"),
  "la nube curada del recorrido sigue declarada como contenido editorial",
);
const suppressed = JSON.stringify(databaseResults).match(/"suppressed"\s*:\s*true/g) ?? [];
check(suppressed.length === 0, `no hay supresión por muestra pequeña (${suppressed.length})`);

// ===========================================================================
// [7] Nothing private crossed, and nothing respondent-level came back
// ===========================================================================
say("\n[7] Privacidad del origen leído de la base de datos");
check(!("persons" in databaseSource), "el modelo de lectura no tiene un lugar donde poner una persona");
check(!("personIdentifiers" in databaseSource), "ni donde poner un identificador externo");
check(
  databaseSource.curatedFindings.every(
    (finding) => Object.keys(finding).sort().join(",") ===
      "cultureDimensionKeys,journeyStageKeys,organizationalUnitKeys,performanceDimensionKeys,reviewStatus",
  ),
  "un hallazgo curado viaja con cinco campos y ninguno es su prosa",
);
check(
  databaseSource.participants.every((participant) => Object.keys(participant).length === 5),
  "una participación viaja por su identificador opaco y nada más",
);
const privateValues = new Map();
const remember = (value, origin) => {
  if (typeof value !== "string" || value.trim().length < 8) return;
  if (!privateValues.has(value)) privateValues.set(value, origin);
};
for (const person of plan.persons) {
  remember(person.displayName, "person.display_name");
  remember(person.identityNormalizedValue, "person.identity_normalized_value");
}
for (const identifier of plan.personIdentifiers) remember(identifier.originalValue, "person_external_identifier");
for (const point of plan.painPoints) remember(point.rawText, "pain_point.raw_text");
for (const response of plan.surveyResponses) remember(response.valueText, "survey_response.value_text");
for (const value of plan.participantAttributeValues) remember(value.valueText, "participant_attribute_value.value_text");

const vocabulary = new Set();
const addVocabulary = (value) => {
  if (typeof value === "string" && value.trim() !== "") vocabulary.add(value.trim());
};
for (const option of databaseSource.scaleOptions) {
  addVocabulary(option.rawValue);
  addVocabulary(option.derivedLabel);
}
for (const scheme of databaseSource.bandSchemes) for (const rule of scheme.rules) addVocabulary(rule.label);
for (const value of CUICUILCO_RESULTS_V1.unawareness.rawValues) addVocabulary(value);
for (const value of CUICUILCO_RESULTS_V1.unawareness.derivedLabels) addVocabulary(value);
for (const group of CUICUILCO_RESULTS_V1.qualitative) for (const entry of group.excludedLabels) addVocabulary(entry.label);
for (const answer of databaseSource.answers) {
  if (CUICUILCO_RESULTS_V1.closedCodedItemKeys.includes(answer.itemKey)) addVocabulary(answer.text);
}
for (const dimension of databaseResults.filters.dimensions) {
  for (const option of dimension.values) addVocabulary(option.value);
}
for (const entry of databaseResults.renewal.distribution ?? []) {
  addVocabulary(entry.response);
  addVocabulary(entry.level);
}
const isVocabulary = (value) => vocabulary.has(value.trim().replace(/[.;:,]+$/, "").trim());
const meaningful = [...privateValues.keys()];
const mustBeAbsent = meaningful.filter((value) => !isVocabulary(value));
const serializedSource = JSON.stringify(databaseSource);
const leakedSource = mustBeAbsent.filter((value) => serializedSource.includes(value));
const leakedResults = mustBeAbsent.filter((value) => serializedDatabase.includes(value));
const describeLeaks = (values) =>
  [...new Set(values.map((value) => `${privateValues.get(value)}(len ${value.length})`))].join(", ");
say(
  `  vocabulario agregado legítimo: ${vocabulary.size} términos · ` +
    `${meaningful.length - mustBeAbsent.length} coincidencias literales excluidas · ${mustBeAbsent.length} deben estar ausentes`,
);
check(
  leakedSource.length === 0,
  `ningún valor privado del plan aparece en el origen leído de la base de datos${leakedSource.length ? ` — ${describeLeaks(leakedSource)}` : ""}`,
);
check(
  leakedResults.length === 0,
  `ni en el documento de resultados${leakedResults.length ? ` — ${describeLeaks(leakedResults)}` : ""}`,
);
const output = printed.join("\n");
const leakedOutput = mustBeAbsent.filter((value) => output.includes(value));
check(leakedOutput.length === 0, `ni en esta salida (${leakedOutput.length})`);

console.log("\n" + "=".repeat(78));
console.log(`RESUMEN (desde la base de datos): ${formatGoldenSummary(outcome)}`);
console.log(`Comprobaciones estructurales: ${failures} fallo(s).`);
if (failures > 0 || outcome.failed > 0 || outcome.skipped > 0) {
  console.error("RESULTADO: la paridad desde la base de datos NO se cumple. COMPUERTA BLOQUEADA.");
  process.exit(1);
}
console.log(
  "RESULTADO: el paquete importado se lee completo desde las tablas canónicas, produce el MISMO " +
    "modelo de lectura y el MISMO documento que la proyección en memoria, y reproduce cada valor " +
    "comparable del tablero aprobado. COMPUERTA APROBADA.",
);
