// =============================================================================
// THE CANONICAL IMPORT OPERATOR — one named package, into one named study
// =============================================================================
//   CANONICAL_IMPORT_PROJECT_REF=<ref> \
//   CANONICAL_IMPORT_ACKNOWLEDGE=I-AUTHORIZE-CANONICAL-IMPORT-INTO-<ref> \
//   CANONICAL_IMPORT_SERVICE_KEY=<key> \
//   CANONICAL_IMPORT_TENANT_ID=<uuid> \
//   CANONICAL_IMPORT_STUDY_ID=<uuid> \
//   CANONICAL_IMPORT_PLAN_FINGERPRINT=sha256:… \
//   CANONICAL_IMPORT_MAPPING_VERSION=1 \
//   CANONICAL_IMPORT_CLEAN_XLSX=<path> CANONICAL_IMPORT_PAIN_XLSX=<path> \
//   CANONICAL_IMPORT_EVIDENCE_DIR=<path outside every git repository> \
//     npm run canonical-import -- [--execute --project <ref>] [--expect-replay]
//     npm run canonical-import -- --execute --project <ref> \
//                                 --rollback-import-job <uuid>
// =============================================================================
// IT DEFAULTS TO REFUSING. Without `--execute` it performs the whole read-only
// half — preflight the exact bytes, build the plan, compare the fingerprint,
// inspect the target's current state — and then stops. Nothing is staged and
// nothing is written. `--execute` additionally requires `--project <ref>`
// naming, on the command line, the same project the environment named.
//
// IT DOES NOT REIMPLEMENT THE COMMIT. `runCanonicalCommit` (Unit 3) is the one
// workflow that preflights, projects, stages, commits, reconciles and reverts
// on a count disagreement, and this operator calls it. What the operator adds
// is everything AROUND it: the target guard, the fingerprint gate, the state of
// the study before the write, an INDEPENDENT count of every canonical table
// afterwards, the ownership ledger, and the evidence file.
//
// -----------------------------------------------------------------------------
// WHAT IT PRINTS, AND WHAT IT CANNOT PRINT
// -----------------------------------------------------------------------------
// Identifiers, fingerprints, counts, statuses, timings and error codes. That is
// the whole vocabulary. Before it prints its report it walks the finished plan
// for every field that holds a source value and FAILS if one of them could
// reach the output — the same assertion `canonical-commit-dry-run.mjs` makes,
// for the same reason. No workbook cell, no name, no answer, no qualitative
// phrase and no credential is ever printed, journalled or written to evidence.
//
// A PostgreSQL error message quotes the values that violated the constraint,
// and in this schema those values are respondent data. No database message
// reaches the output: `runCanonicalCommit` reduces every transport error to a
// code, and so does this file.
//
// -----------------------------------------------------------------------------
// WHAT IT REFUSES
// -----------------------------------------------------------------------------
//   * a project, tenant, study, fingerprint or mapping version that differs
//     from the one it was told to import into, by one character;
//   * a package the preflight blocks, or a projection that cannot build a plan
//     without guessing;
//   * a study that already carries a committed package that is NOT this one;
//   * a study with a job stuck in `committing`;
//   * a fresh import into a study whose canonical tables are not empty;
//   * a reconciliation that disagrees — which it answers by invoking the
//     product's own `rollback_canonical_package`, never by deleting a row.
//
// There is no manual-deletion path in this file. `delete` does not appear in
// it, and the offline gate asserts that.
//
// IT CREATES NO HTTP ENDPOINT. This is a command-line operator; nothing here is
// reachable from a browser, and no route imports it.
// =============================================================================

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createClient } from "@supabase/supabase-js";

import { preflightCanonicalPackage } from "../src/lib/ingestion/canonical-package/preflight.ts";
import { CUICUILCO_PACKAGE_SPEC_V1 } from "../src/lib/ingestion/canonical-package/spec.ts";
import { WorkbookView } from "../src/lib/ingestion/canonical-package/sheet-view.ts";
import { fileHash } from "../src/lib/ingestion/canonical-package/fingerprint.ts";
import { readXlsxWorkbook } from "../src/lib/ingestion/xlsx-reader.ts";
import {
  CUICUILCO_PROJECTION_V1,
  PLAN_FAMILIES,
  buildCanonicalCommitPlan,
} from "../src/lib/ingestion/canonical-commit/index.ts";
import { runCanonicalCommit, runCanonicalRollback } from "../src/lib/ingestion/canonical-commit/flow.ts";
import { safeErrorCode } from "../src/lib/ingestion/canonical-commit/result.ts";
import { CANONICAL_FAMILY_TABLES, STUDY_SCOPED_CANONICAL_TABLES } from "./lib/canonical-tables.mjs";
import {
  ImportTargetError,
  describeImportTarget,
  parseImportArguments,
  resolveImportTarget,
} from "./lib/canonical-import-target.mjs";
import { scanText } from "./lib/secret-patterns.mjs";

// ---------------------------------------------------------------------------
// [0] Authorization, before any module that could open a connection is used
// ---------------------------------------------------------------------------
let target;
try {
  target = resolveImportTarget(process.env, parseImportArguments(process.argv.slice(2)));
} catch (thrown) {
  if (thrown instanceof ImportTargetError) {
    console.error(`REFUSED: ${thrown.message}`);
    process.exit(2);
  }
  throw thrown;
}

const started = Date.now();
const since = () => Date.now() - started;
let failures = 0;
const printed = [];
const say = (line) => {
  printed.push(line);
  console.log(line);
};
const ok = (message) => say(`  ✓ ${message}`);
const bad = (message) => {
  failures += 1;
  say(`  ✗ REFUSED: ${message}`);
};
const check = (condition, message) => (condition ? ok(message) : bad(message));

say("Be Community — canonical import operator");
say("=".repeat(78));
for (const [key, value] of Object.entries(describeImportTarget(target))) say(`  ${key}: ${value}`);

const client = createClient(target.apiOrigin, target.serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

/** One RPC call, with the transport's own error reduced to a SAFE code. */
const transport = {
  rpc: async (name, args) => {
    const { data, error } = await client.rpc(name, args);
    return { data, error };
  },
};

/**
 * A count, and never a row.
 *
 * `limit(0)` with `count: "exact"` asks PostgREST for the total in the
 * `Content-Range` header and for NO rows in the body, so a table full of
 * respondent answers can be measured without one of them being transferred.
 * Only `tenant_id` is named as the projection, which the caller already knows.
 *
 * It is deliberately a plain GET rather than `head: true`. A HEAD request is
 * handled differently by every proxy in front of PostgREST — including the
 * local shim the rehearsal runs behind — while a GET that asks for zero rows
 * answers the same question identically over every transport.
 */
async function countRows(table, filters) {
  let query = client.from(table).select("tenant_id", { count: "exact" });
  for (const [column, value] of Object.entries(filters)) query = query.eq(column, value);
  const { count, error } = await query.limit(0);
  if (error) throw new Error(`count ${table}: ${safeErrorCode(error)}`);
  // A missing count is a REFUSAL, never a zero. A transport that stopped
  // returning `Content-Range` would otherwise turn every table into "empty",
  // which reconciles against nothing and looks like a clean import.
  if (!Number.isInteger(count)) throw new Error(`count ${table}: COUNT_NOT_REPORTED`);
  return count;
}

const studyScope = { tenant_id: target.tenantId, study_id: target.studyId };

// ===========================================================================
// [1] The exact bytes, preflighted here and nowhere else
// ===========================================================================
say("\n[1] Los dos libros de origen");
function load(path) {
  const buffer = readFileSync(path);
  return {
    fileName: path.replace(/^.*[\\/]/, ""),
    bytes: buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength),
  };
}
const files = [load(target.cleanPath), load(target.painPath)];
const fileHashes = [];
for (const file of files) {
  const sha256 = await fileHash(file.bytes);
  fileHashes.push({ fileName: file.fileName, sha256, sizeBytes: file.bytes.byteLength });
  say(`  ${file.fileName}  bytes=${file.bytes.byteLength}  ${sha256}`);
}

const preflight = await preflightCanonicalPackage(
  files.map(({ fileName, bytes }) => ({ fileName, bytes })),
  CUICUILCO_PACKAGE_SPEC_V1,
);
say(
  `  bloqueos=${preflight.counts.blockers} advertencias=${preflight.counts.warnings} ` +
    `info=${preflight.counts.info}`,
);
for (const asset of preflight.assets) say(`  papel=${asset.role} hojas=${asset.sheets.length} ${asset.sha256}`);
check(preflight.counts.blockers === 0, `el preflight no encuentra bloqueos (${preflight.counts.blockers})`);
check(preflight.confirmationAllowed === true, "la confirmación está permitida");
check(preflight.packageIdempotencyKey !== null, "el paquete tiene clave de idempotencia");
if (preflight.packageIdempotencyKey !== null) say(`  clave del paquete = ${preflight.packageIdempotencyKey}`);
check(
  preflight.assets.every((asset) => asset.role !== null),
  "cada archivo fue reconocido por su contenido, no por su nombre",
);
if (target.packageIdempotencyKey !== null) {
  check(
    preflight.packageIdempotencyKey === target.packageIdempotencyKey,
    "la clave del paquete es exactamente la esperada",
  );
}

if (failures > 0) {
  console.error("\nEl paquete no pasa el preflight. No se construye ningún plan y no se escribe nada.");
  process.exit(1);
}

// ===========================================================================
// [2] The plan, built in memory, and its fingerprint compared with the one
//     the owner named. A single character of difference is a refusal.
// ===========================================================================
say("\n[2] El plan canónico");
const workbooks = new Map();
for (const [index, file] of files.entries()) {
  const role = preflight.assets.find((asset) => asset.sha256 === fileHashes[index].sha256)?.role;
  workbooks.set(role, new WorkbookView(await readXlsxWorkbook(file.bytes)));
}
const build = buildCanonicalCommitPlan({
  tenantId: target.tenantId,
  studyId: target.studyId,
  packageIdempotencyKey: preflight.packageIdempotencyKey,
  spec: CUICUILCO_PACKAGE_SPEC_V1,
  projection: CUICUILCO_PROJECTION_V1,
  workbooks,
});
check(build.ok === true, `la proyección construyó un plan (${build.issues.filter((i) => i.severity === "blocker").length} bloqueo(s))`);
if (!build.ok) {
  console.error("\nLa proyección no produjo un plan. No se escribe nada.");
  process.exit(1);
}
const plan = build.plan;
say(`  huella del plan = ${plan.planFingerprint}`);
say(`  versión de mapeo = ${plan.mappingVersion}   especificación = ${plan.specId}`);
say(`  tamaño del cuerpo = ${new TextEncoder().encode(JSON.stringify(plan)).length} bytes`);
check(plan.planFingerprint === target.planFingerprint, "la huella del plan es EXACTAMENTE la autorizada");
check(plan.mappingVersion === target.mappingVersion, "la versión de mapeo es exactamente la autorizada");
check(plan.tenantId === target.tenantId, "el plan declara el cliente autorizado");
check(plan.studyId === target.studyId, "el plan declara el estudio autorizado");

const expectedCounts = plan.expectedCounts;
const planTotal = PLAN_FAMILIES.reduce((sum, family) => sum + plan[family].length, 0);
say(`  filas del plan = ${planTotal} en ${PLAN_FAMILIES.length} familias`);

// ---- the privacy gate, before anything else is printed ----------------------
// Every field below holds a source value. The operator must never print one, so
// it collects them and asserts at the end that none appears in its output.
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

if (failures > 0) {
  console.error("\nEl plan no es el autorizado. No se escribe nada.");
  process.exit(1);
}

// ===========================================================================
// [3] The target, read-only: what this study already holds
// ===========================================================================
say("\n[3] Estado del estudio ANTES de escribir");

const { data: studyRows, error: studyError } = await client
  .from("study")
  .select("id, tenant_id, status")
  .eq("id", target.studyId)
  .eq("tenant_id", target.tenantId);
if (studyError) {
  bad(`no se pudo leer el estudio (${safeErrorCode(studyError)})`);
} else {
  check(Array.isArray(studyRows) && studyRows.length === 1, "el estudio existe y pertenece al cliente autorizado");
  if (studyRows?.length === 1) say(`  estado del estudio = ${studyRows[0].status}`);
}

const { data: jobRows, error: jobError } = await client
  .from("import_job")
  .select("id, idempotency_key, mapping_version, status, committed_at, rolled_back_at")
  .eq("tenant_id", target.tenantId)
  .eq("study_id", target.studyId)
  .order("id", { ascending: true })
  .limit(200);
if (jobError) bad(`no se pudieron leer los trabajos de importación (${safeErrorCode(jobError)})`);
const jobs = jobRows ?? [];
const byStatus = new Map();
for (const job of jobs) byStatus.set(job.status, (byStatus.get(job.status) ?? 0) + 1);
say(`  trabajos de importación: ${jobs.length} — ${[...byStatus].map(([s, n]) => `${s}=${n}`).join(" ") || "ninguno"}`);

const committed = jobs.filter((job) => job.status === "committed");
const ourCommitted = committed.filter((job) => job.idempotency_key === preflight.packageIdempotencyKey);
const foreignCommitted = committed.filter((job) => job.idempotency_key !== preflight.packageIdempotencyKey);
check(foreignCommitted.length === 0, `ningún OTRO paquete está confirmado en este estudio (${foreignCommitted.length})`);
check(
  jobs.filter((job) => job.status === "committing").length === 0,
  "ningún trabajo quedó a medio confirmar",
);
const isReplay = ourCommitted.length === 1;
say(`  ¿este paquete ya está confirmado? ${isReplay ? "SÍ — la ejecución sería una repetición idempotente" : "no"}`);
if (target.expectReplay) check(isReplay, "se pidió --expect-replay y el paquete ya estaba confirmado");

const before = {};
for (const table of STUDY_SCOPED_CANONICAL_TABLES) before[table] = await countRows(table, studyScope);
const beforeTotal = Object.values(before).reduce((sum, n) => sum + n, 0);
say(`  filas canónicas del estudio antes = ${beforeTotal} en ${STUDY_SCOPED_CANONICAL_TABLES.length} tablas`);
if (!isReplay) {
  const nonEmpty = Object.entries(before).filter(([, n]) => n > 0);
  check(
    nonEmpty.length === 0,
    `una importación nueva exige tablas canónicas vacías${nonEmpty.length ? ` — pobladas: ${nonEmpty.map(([t, n]) => `${t}=${n}`).join(", ")}` : ""}`,
  );
}

// The legacy tables this operator must leave EXACTLY as it found them.
const legacyBefore = {
  respondent: await countRows("respondent", studyScope),
  quant_response: await countRows("quant_response", studyScope),
  qual_observation: await countRows("qual_observation", studyScope),
};
say(
  `  legado antes: respondent=${legacyBefore.respondent} quant_response=${legacyBefore.quant_response} ` +
    `qual_observation=${legacyBefore.qual_observation}`,
);

if (failures > 0) {
  console.error("\nEl estado del destino no es el esperado. No se escribe nada.");
  process.exit(1);
}

// ===========================================================================
// [4] Rollback mode — the ONLY way this operator removes a package
// ===========================================================================
if (target.rollbackJobId !== null) {
  if (!target.execute) {
    say("\n[4] Reversión solicitada — MODO ENSAYO, no se revierte nada");
    say("  añade --execute --project <ref> para revertir de verdad");
    process.exit(0);
  }
  say("\n[4] Reversión del paquete, por la vía del producto");
  const at = Date.now();
  const reverted = await runCanonicalRollback(transport, target.rollbackJobId, null);
  say(`  rollback_canonical_package: ${reverted.ok ? reverted.status : reverted.code} (${Date.now() - at} ms)`);
  check(reverted.ok === true, "la reversión se completó");
  if (reverted.ok) {
    say(`  repetida = ${reverted.replayed}   reversiones acumuladas = ${reverted.rollbackCount}`);
    say(`  identidades compartidas conservadas = ${reverted.retainedSharedIdentities}`);
    for (const [table, n] of Object.entries(reverted.removed).sort()) say(`    ${table.padEnd(34)} -${n}`);
  }
  const after = {};
  for (const table of STUDY_SCOPED_CANONICAL_TABLES) after[table] = await countRows(table, studyScope);
  const residue = Object.entries(after).filter(([, n]) => n > 0);
  check(residue.length === 0, `no queda ningún residuo canónico${residue.length ? `: ${residue.map(([t, n]) => `${t}=${n}`).join(", ")}` : ""}`);
  process.exit(failures > 0 ? 1 : 0);
}

// ===========================================================================
// [5] Dry run stops here
// ===========================================================================
if (!target.execute) {
  say("\n[5] MODO ENSAYO");
  say("  El paquete es exactamente el autorizado y el destino está en el estado esperado.");
  say("  No se preparó, no se confirmó y no se escribió nada.");
  say("  Para ejecutar: --execute --project <ref>, con CANONICAL_IMPORT_EVIDENCE_DIR fijado.");
  const output = printed.join("\n");
  const leaked = [...privateValues.entries()].filter(([value]) => output.includes(value));
  console.log(
    `\n  privacidad: ninguno de los ${privateValues.size} valores de origen del plan aparece en la salida` +
      (leaked.length ? ` — FILTRADOS ${leaked.length}` : ""),
  );
  process.exit(leaked.length > 0 || failures > 0 ? 1 : 0);
}

// ===========================================================================
// [6] The commit — one call, through the product's own workflow
// ===========================================================================
say("\n[6] Preparación y confirmación");
const commitStarted = Date.now();
const outcome = await runCanonicalCommit(transport, {
  tenantId: target.tenantId,
  studyId: target.studyId,
  files: files.map(({ fileName, bytes }) => ({ fileName, bytes })),
  actorId: null,
  spec: CUICUILCO_PACKAGE_SPEC_V1,
  projection: CUICUILCO_PROJECTION_V1,
});
const commitMs = Date.now() - commitStarted;
say(`  runCanonicalCommit: ${outcome.ok ? outcome.status : `${outcome.status}/${outcome.code}`} (${commitMs} ms)`);

if (!outcome.ok) {
  bad(`la confirmación no se completó (${outcome.code})`);
  for (const disagreement of outcome.disagreements) {
    say(`    ${disagreement.family}: esperado ${disagreement.expected} · medido ${disagreement.actual}`);
  }
  say(
    "  El flujo del producto ya revirtió lo que hubiera escrito. No se intenta ninguna\n" +
      "  limpieza manual: si quedó algo, se revierte con --rollback-import-job.",
  );
  if (outcome.importJobId) say(`  trabajo de importación = ${outcome.importJobId}`);
  process.exit(1);
}

const importJobId = outcome.importJobId;
say(`  trabajo de importación = ${importJobId}`);
say(`  repetición idempotente = ${outcome.replayed}`);
say(`  clave del paquete = ${outcome.packageIdempotencyKey}`);
say(`  huella confirmada = ${outcome.planFingerprint}`);
say(`  intentos de confirmación = ${outcome.commitAttempts}   reversiones = ${outcome.rollbackCount}`);
check(outcome.planFingerprint === target.planFingerprint, "la base de datos confirmó EXACTAMENTE la huella autorizada");
for (const [key, value] of Object.entries(outcome.counts.ownership).sort()) say(`  ${key.padEnd(24)} ${value}`);

// ===========================================================================
// [7] Reconciliation, measured INDEPENDENTLY of the commit's own answer
// ===========================================================================
say("\n[7] Conciliación por conteo directo de cada tabla");
const measured = {};
const ownership = {};
for (const entry of CANONICAL_FAMILY_TABLES) {
  if (entry.scope === "study") measured[entry.table] = await countRows(entry.table, studyScope);
  if (entry.ledger) {
    ownership[entry.table] = {
      created: await countRows("import_job_record", {
        import_job_id: importJobId,
        target_table: entry.table,
        ownership: "created",
      }),
      reused: await countRows("import_job_record", {
        import_job_id: importJobId,
        target_table: entry.table,
        ownership: "reused",
      }),
    };
  }
}

const disagreements = [];
for (const entry of CANONICAL_FAMILY_TABLES) {
  const declared = expectedCounts[entry.family];
  const owned = entry.ledger ? ownership[entry.table].created + ownership[entry.table].reused : null;
  const counted = entry.scope === "study" ? measured[entry.table] : owned;
  const agreed = counted === declared && (owned === null || owned === declared);
  if (!agreed) disagreements.push({ table: entry.table, declared, counted, owned });
  say(
    `  ${entry.table.padEnd(34)} plan=${String(declared).padStart(5)} ` +
      `tabla=${String(entry.scope === "study" ? measured[entry.table] : "n/a").padStart(5)} ` +
      `propiedad=${String(owned ?? "n/a").padStart(5)}  ${agreed ? "ok" : "DIFIERE"}`,
  );
}
check(disagreements.length === 0, `las ${CANONICAL_FAMILY_TABLES.length} familias concilian`);

const { data: finalJob, error: finalJobError } = await client
  .from("import_job")
  .select("id, status, committed_at, rolled_back_at")
  .eq("id", importJobId)
  .eq("tenant_id", target.tenantId)
  .eq("study_id", target.studyId)
  .limit(1);
if (finalJobError) bad(`no se pudo releer el trabajo (${safeErrorCode(finalJobError)})`);
check(finalJob?.[0]?.status === "committed", `el trabajo quedó en 'committed' (${finalJob?.[0]?.status ?? "?"})`);
check(finalJob?.[0]?.rolled_back_at === null, "el trabajo no figura revertido");

const { data: residualJobs } = await client
  .from("import_job")
  .select("id, status")
  .eq("tenant_id", target.tenantId)
  .eq("study_id", target.studyId)
  .in("status", ["staged", "validated", "committing", "failed"])
  .limit(50);
check((residualJobs ?? []).length === 0, `no queda ningún trabajo a medio preparar (${(residualJobs ?? []).length})`);

const legacyAfter = {
  respondent: await countRows("respondent", studyScope),
  quant_response: await countRows("quant_response", studyScope),
  qual_observation: await countRows("qual_observation", studyScope),
};
for (const key of Object.keys(legacyBefore)) {
  check(legacyBefore[key] === legacyAfter[key], `${key} no cambió (${legacyBefore[key]} → ${legacyAfter[key]})`);
}

// ===========================================================================
// [8] A failed reconciliation is answered by the PRODUCT's rollback
// ===========================================================================
if (disagreements.length > 0) {
  say("\n[8] La conciliación falló — se revierte por la vía del producto");
  const reverted = await runCanonicalRollback(transport, importJobId, null);
  say(`  rollback_canonical_package: ${reverted.ok ? reverted.status : reverted.code}`);
  const after = {};
  for (const table of STUDY_SCOPED_CANONICAL_TABLES) after[table] = await countRows(table, studyScope);
  const residue = Object.entries(after).filter(([table, n]) => n !== before[table]);
  check(residue.length === 0, "las tablas canónicas volvieron a su estado previo");
  say("  No se borró ninguna fila a mano. Si algo quedó, requiere revisión humana.");
}

// ===========================================================================
// [9] Evidence, outside Git, scanned before it is written
// ===========================================================================
say("\n[9] Evidencia");
const evidence = {
  operator: "canonical-import-operator",
  finishedAt: new Date().toISOString(),
  target: describeImportTarget(target),
  files: fileHashes,
  packageIdempotencyKey: outcome.packageIdempotencyKey,
  planFingerprint: outcome.planFingerprint,
  mappingVersion: plan.mappingVersion,
  importJobId,
  replayed: outcome.replayed,
  commitAttempts: outcome.commitAttempts,
  rollbackCount: outcome.rollbackCount,
  wallMs: { commit: commitMs, total: since() },
  expectedCounts,
  measured,
  ownership,
  reportedCounts: outcome.counts,
  legacy: { before: legacyBefore, after: legacyAfter },
  reconciled: disagreements.length === 0,
  disagreements,
};
const serialized = `${JSON.stringify(evidence, null, 2)}\n`;
const findings = scanText(serialized);
if (findings.length > 0) {
  bad(`la evidencia NO se escribió: el escáner encontró ${findings.map((f) => `${f.count}x ${f.id}`).join(", ")}`);
} else {
  // The finish time is in the NAME, not only in the body: a replay of the same
  // package reuses the same import job, so a name keyed on the job alone would
  // let the second run silently overwrite the first run's evidence — which is
  // exactly the run somebody would later want to read.
  const stamp = evidence.finishedAt.replace(/[:.]/g, "-");
  const path = join(target.evidenceDirectory, `import-${importJobId}-${stamp}.json`);
  writeFileSync(path, serialized, { mode: 0o600 });
  say(`  ${path}`);
}

// ===========================================================================
// [10] Nothing private left through the output
// ===========================================================================
say("\n[10] Privacidad de la salida");
{
  const output = printed.join("\n");
  const leaked = [...privateValues.entries()]
    .filter(([value]) => output.includes(value))
    .map(([value, origin]) => `${origin} (${value.length} car.)`);
  check(
    leaked.length === 0,
    `ninguno de los ${privateValues.size} valores de origen del plan aparece en la salida` +
      (leaked.length > 0 ? ` — FILTRADOS ${leaked.length}: ${leaked.slice(0, 6).join(", ")}` : ""),
  );
}

console.log("\n" + "=".repeat(78));
if (failures > 0) {
  console.error(`RESULTADO: ${failures} fallo(s). Revisa el trabajo ${importJobId} antes de continuar.`);
  process.exit(1);
}
console.log(
  `RESULTADO: el paquete ${outcome.packageIdempotencyKey} quedó confirmado como ${importJobId}, ` +
    `concilió en las ${CANONICAL_FAMILY_TABLES.length} familias y no movió ninguna fila heredada.`,
);
