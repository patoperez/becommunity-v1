// =============================================================================
// THE RUNTIME-PATH REHEARSAL — the shadow entry point a hosted request calls,
// against the real database, read-only.
// =============================================================================
//   CANONICAL_IMPORT_PROJECT_REF=<ref> \
//   CANONICAL_IMPORT_ACKNOWLEDGE=I-AUTHORIZE-CANONICAL-IMPORT-INTO-<ref> \
//   CANONICAL_IMPORT_SERVICE_KEY=<key> \
//   CANONICAL_IMPORT_TENANT_ID=<uuid> CANONICAL_IMPORT_STUDY_ID=<uuid> \
//   CANONICAL_IMPORT_PLAN_FINGERPRINT=sha256:… CANONICAL_IMPORT_MAPPING_VERSION=1 \
//   CANONICAL_IMPORT_CLEAN_XLSX=<path> CANONICAL_IMPORT_PAIN_XLSX=<path> \
//     npm run canonical-shadow-runtime-rehearsal
//
// Optional: CANONICAL_SHADOW_REHEARSAL_SAMPLES (default 7, max 25)
//           CANONICAL_SHADOW_REHEARSAL_BUDGET_MS (default 5000, the ceiling)
// =============================================================================
// WHY THIS EXISTS, AND WHAT IT REPLACES.
//
// `canonical-shadow-report.mjs` reads the canonical package through the PURE
// transport, hands the finished document to `runShadowComparison` as
// `loadCanonical: async () => canonical`, and reports how long the comparison
// took. That measured the comparator. It measured nothing else: not the policy,
// not the admin client, not the server-only adapter, not the paged reads, not
// the results builder — which is to say, not one step of what a hosted request
// would actually do inside its budget.
//
// This script calls `runStudyShadowComparison` — the SAME function
// `src/lib/studies/study-dashboard.ts` calls — and lets it do all of it:
//
//   policy (flag + exact allowlist)
//     -> runStudyShadowComparison        src/lib/shadow/server.ts
//        -> createAdminClient            src/lib/supabase/admin.ts
//        -> loadCanonicalStudyResults    src/lib/canonical-source/server.ts
//           -> loadCanonicalRowSet       paged, bounded-concurrent, cancellable
//              -> postgrestReadTransport every query scoped by tenant AND study
//           -> buildCanonicalStudyResults  the one pure results builder
//        -> compareLegacyWithCanonical   the semantic comparator
//
// NOTHING IS PRELOADED. The document is read inside the measured call, every
// time, exactly as a request would read it.
//
// -----------------------------------------------------------------------------
// WHY IT NEEDS `--conditions=react-server`
// -----------------------------------------------------------------------------
// `shadow/server.ts` and `supabase/admin.ts` both open with `import
// "server-only"`, which throws under plain Node by design. The marker package
// resolves to an empty module under the `react-server` export condition — the
// same condition the React Server Component runtime supplies — so running with
// that condition exercises the real modules WITHOUT defeating the marker,
// patching it out or copying its code. The npm script sets it; running this
// file without it fails loudly, which is correct.
//
// -----------------------------------------------------------------------------
// WHAT IT MAY DO, AND WHAT IT MAY NOT
// -----------------------------------------------------------------------------
// AUTHORIZED: read-only canonical queries, read-only legacy queries, timing,
// and safe diagnostics.
// NOT AUTHORIZED, and absent from this file: insert, update, delete, upsert,
// rpc, migration, rollback, re-import, publication, or any environment change
// outside this process. The target guard is resolved in DRY-RUN mode, which is
// the mode that cannot mutate, and `--execute` is refused before anything else.
//
// SHADOW MODE IS ENABLED IN THIS PROCESS ONLY, for this one scope, and dies
// with it. `process.env` is set here, in memory, for this run; no `.env` file,
// no `wrangler.toml`, no deployment and no hosted environment is touched, and
// the hosted application still runs with the shadow off.
//
// IT PRINTS ONLY SAFE DIAGNOSTICS. Timings, statuses, classifications, counts
// and the closed note codes. Never a database row, never a respondent value,
// never a segment VALUE (the filtered sample names its dimension KEY and not
// what it was set to), never a database message, never the service key.
// =============================================================================

import { createClient } from "@supabase/supabase-js";

import { loadStudyRows } from "../src/lib/calc/load.ts";
import { buildStudyDashboard } from "../src/lib/dashboard/view.ts";
import { parseJourneyDefinition } from "../src/lib/calc/journey.ts";
import { keysetWindow, selectAllPages } from "../src/lib/supabase/paginate.ts";
import {
  ImportTargetError,
  parseImportArguments,
  resolveImportTarget,
} from "./lib/canonical-import-target.mjs";

// ---------------------------------------------------------------------------
// [0] The guard. Dry run only, and named three ways before anything happens.
// ---------------------------------------------------------------------------
let target;
try {
  const options = parseImportArguments(process.argv.slice(2));
  if (options.execute) {
    console.error("REFUSED: this rehearsal only reads. It has no --execute mode.");
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

const positiveInt = (raw, fallback, ceiling) => {
  const parsed = Number(String(raw ?? "").trim());
  if (!Number.isSafeInteger(parsed) || parsed <= 0) return fallback;
  return Math.min(parsed, ceiling);
};
const SAMPLES = positiveInt(process.env.CANONICAL_SHADOW_REHEARSAL_SAMPLES, 7, 25);
const BUDGET_MS = positiveInt(process.env.CANONICAL_SHADOW_REHEARSAL_BUDGET_MS, 5000, 5000);

const say = (line) => console.log(line);
say("Be Community — ensayo de la RUTA DE EJECUCIÓN de la sombra (sólo lectura)");
say("=".repeat(78));
say(`  proyecto: ${target.ref}   cliente: ${target.tenantId}   estudio: ${target.studyId}`);
say(`  muestras: ${SAMPLES}   presupuesto: ${BUDGET_MS} ms`);

// ---------------------------------------------------------------------------
// [1] The environment this process runs the runtime path under.
//
// Set HERE, in memory, and nowhere else. `createAdminClient` reads these two
// names at call time, which is exactly what the Worker does with its own
// bindings; the shadow's three names are read by `resolveShadowPolicy` from the
// same object. Nothing is written to a file and nothing outlives this process.
// ---------------------------------------------------------------------------
process.env.NEXT_PUBLIC_SUPABASE_URL = target.apiOrigin;
process.env.SUPABASE_SERVICE_ROLE_KEY = target.serviceKey;
process.env.BECOMMUNITY_SHADOW_MODE = "enabled";
process.env.BECOMMUNITY_SHADOW_SCOPES = `${target.tenantId}:${target.studyId}`;
process.env.BECOMMUNITY_SHADOW_BUDGET_MS = String(BUDGET_MS);

// Imported AFTER the environment is in place, and dynamically, so the failure
// mode of a missing `--conditions=react-server` is a clear one message rather
// than a stack from a module graph half-evaluated at parse time.
let runStudyShadowComparison;
let installShadowDiagnosticBuffer;
try {
  ({ runStudyShadowComparison } = await import("../src/lib/shadow/server.ts"));
  ({ installShadowDiagnosticBuffer } = await import("../src/lib/shadow/sink.ts"));
} catch (thrown) {
  const message = thrown instanceof Error ? thrown.message : "";
  if (/Client Component/.test(message)) {
    console.error(
      "REFUSED: the server-only modules refused to load. Run this through " +
        "`npm run canonical-shadow-runtime-rehearsal`, which supplies " +
        "--conditions=react-server.",
    );
    process.exit(2);
  }
  throw thrown;
}

// ---------------------------------------------------------------------------
// [2] The legacy payload, from the loader the application uses.
//
// This is the shadow's INPUT, not part of what is measured: the page computes
// it before calling the shadow at all, so it is built once here and reused.
// ---------------------------------------------------------------------------
say("\n[1] El pago heredado (entrada, no medido)");
const client = createClient(target.apiOrigin, target.serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const { data: studyRow, error: studyError } = await client
  .from("study")
  .select("id, tenant_id, name, status, dashboard_config, journey_definition")
  .eq("id", target.studyId)
  .eq("tenant_id", target.tenantId)
  .maybeSingle();
if (studyError || !studyRow) {
  console.error("REFUSED: the study is not readable for that tenant.");
  process.exit(1);
}

/**
 * Every read below is wrapped, because the pagers throw
 * `${label}: ${error.message}` (`src/lib/supabase/paginate.ts`) and this
 * schema's PostgreSQL messages quote the values that violated a constraint —
 * which here are respondent data. At ESM top level an unguarded rejection
 * prints that message through Node's default handler, which would break this
 * file's own promise in its header.
 */
async function readOrRefuse(label, run) {
  try {
    return await run();
  } catch {
    console.error(`REFUSED: the legacy read '${label}' failed. The message is deliberately not printed.`);
    process.exit(1);
  }
}

const rows = await readOrRefuse("quantitative rows", () => loadStudyRows(client, target.studyId));
const observations = await readOrRefuse("confirmed qualitative", () => selectAllPages(
  "qual_observation",
  (cursor, size) =>
    keysetWindow(
      client
        .from("qual_observation")
        .select("id, respondent_id, confirmed_theme, confirmed_stage_key, quote, quote_approved, source, category")
        .eq("study_id", target.studyId)
        .eq("review_status", "confirmed"),
      { column: "id", cursor, size },
    ),
  { maxRows: 100_000, cursorOf: (row) => row.id },
));
const respondents = await readOrRefuse("respondent segments", () => selectAllPages(
  "respondent",
  (cursor, size) =>
    keysetWindow(client.from("respondent").select("id, segments").eq("study_id", target.studyId), {
      column: "id",
      cursor,
      size,
    }),
  { maxRows: 50_000, cursorOf: (row) => row.id },
));
const segments = new Map(respondents.map((row) => [String(row.id), row.segments ?? {}]));
const qualitative = observations.flatMap((row) => {
  const theme = typeof row.confirmed_theme === "string" ? row.confirmed_theme.trim() : "";
  if (!theme) return [];
  const respondentId = row.respondent_id ? String(row.respondent_id) : null;
  return [{
    id: String(row.id),
    respondent_id: respondentId,
    theme,
    stage_key: row.confirmed_stage_key ? String(row.confirmed_stage_key) : null,
    quote: row.quote_approved && row.quote ? String(row.quote) : null,
    source: row.source ? String(row.source) : null,
    category: row.category ? String(row.category) : null,
    ...(respondentId ? segments.get(respondentId) ?? {} : {}),
  }];
});

const stages = parseJourneyDefinition(studyRow.journey_definition);
const buildLegacy = (filters) =>
  buildStudyDashboard(rows, qualitative, stages, filters, studyRow.dashboard_config);
const legacy = buildLegacy({});
const legacySerialized = JSON.stringify(legacy);
say(`  filas cuantitativas=${rows.length}  cualitativas confirmadas=${qualitative.length}`);
say(
  `  fichas=${legacy.view.tiles.length} promedios=${legacy.view.averages.length} ` +
    `unidades=${legacy.view.sourceUnits} visibilidad=${legacy.view.selectionVisibility}`,
);

// ---------------------------------------------------------------------------
// [3] The runtime path, measured. Nothing is preloaded.
// ---------------------------------------------------------------------------
const buffer = installShadowDiagnosticBuffer({ capacity: 64 });
const samples = [];
let lastUnfiltered = null;

say("\n[2] La ruta de ejecución, medida");
say("  # | ms    | estado    | comp | ok | dif | clas");
say("  " + "-".repeat(52));
for (let index = 0; index < SAMPLES; index += 1) {
  const started = Date.now();
  const shadow = await runStudyShadowComparison({
    scope: { tenantId: target.tenantId, studyId: target.studyId },
    legacy,
    filters: {},
  });
  const wall = Date.now() - started;
  samples.push(wall);
  lastUnfiltered = shadow;
  say(
    `  ${String(index + 1).padStart(2)} | ${String(wall).padStart(5)} | ` +
      `${shadow.status.padEnd(9)} | ${String(shadow.counts.compared).padStart(4)} | ` +
      `${String(shadow.counts.agreed).padStart(2)} | ${String(shadow.counts.disagreed).padStart(3)} | ` +
      `${String(shadow.counts.classified).padStart(4)}`,
  );
  if (JSON.stringify(legacy) !== legacySerialized) {
    console.error("REFUSED: the legacy payload changed across a shadow run.");
    process.exit(1);
  }
}

const sorted = [...samples].sort((a, b) => a - b);
const rank = (fraction) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(fraction * sorted.length) - 1))];
const median = sorted.length % 2 === 1
  ? sorted[(sorted.length - 1) / 2]
  : Math.round((sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2);

say("\n  tiempos de pared de la ruta completa (ms)");
say(`    frío (1ª)  ${samples[0]}`);
say(`    mínimo     ${sorted[0]}`);
say(`    mediana    ${median}`);
say(`    p95        ${rank(0.95)}   (rango ${Math.ceil(0.95 * sorted.length)} de ${sorted.length})`);
say(`    máximo     ${sorted[sorted.length - 1]}`);
say(`    presupuesto ${BUDGET_MS}   margen sobre el máximo: ${(BUDGET_MS / sorted[sorted.length - 1]).toFixed(2)}x`);

// ---------------------------------------------------------------------------
// [4] A FILTERED run, through the same path.
//
// The canonical document is read unfiltered — the read is scoped by tenant and
// study and by nothing else — so every quantity the legacy filter touches must
// come back `presentation_configuration_required` / `filter_scope`, with no
// agreement, no disagreement and no number.
// ---------------------------------------------------------------------------
say("\n[3] Una corrida FILTRADA por la misma ruta");
const dimension = legacy.filterOptions.find((option) => option.values.length > 0);
if (!dimension) {
  say("  (este estudio no publica ninguna dimensión de filtro; se omite)");
} else {
  // The KEY is printed. The VALUE never is.
  const filters = { [dimension.key]: dimension.values[0] };
  const filteredLegacy = buildLegacy(filters);
  const shadow = await runStudyShadowComparison({
    scope: { tenantId: target.tenantId, studyId: target.studyId },
    legacy: filteredLegacy,
    filters,
  });
  say(`  dimensión aplicada: ${dimension.key}  (el valor no se imprime nunca)`);
  say(
    `  estado=${shadow.status}  filtrado=${shadow.filterScope.filtered} ` +
      `dimensiones=${shadow.filterScope.dimensionCount}`,
  );
  say(
    `  comparadas=${shadow.counts.compared} de acuerdo=${shadow.counts.agreed} ` +
      `en desacuerdo=${shadow.counts.disagreed} clasificadas=${shadow.counts.classified}`,
  );
  const scoped = shadow.findings.filter((item) => item.mismatch === "filter_scope");
  say(`  alcance de filtro (sin comparar, sin cifras): ${scoped.length}`);
  for (const item of scoped) say(`    · ${item.key.padEnd(41)} ${item.classification}`);
  const leaked = shadow.findings.filter(
    (item) =>
      item.mismatch === "filter_scope" &&
      (item.legacyValue !== null || item.legacyBase !== null || item.agrees !== null),
  );
  if (leaked.length > 0) {
    console.error("REFUSED: a filter-scoped finding carried a number or a verdict.");
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// [5] The budget, against the real reader.
//
// A one-millisecond budget cannot be met by a real paged read, so this proves
// on the real path what the offline gate proves against a fake: the run returns
// `canonical_timeout`, it returns FAST, and the reader is cancelled rather than
// left running. It reads and cancels; it changes nothing.
// ---------------------------------------------------------------------------
say("\n[4] El presupuesto, contra el lector real");

// The claim "nothing is still reading" has to be MEASURED, not waited for. A
// sleep followed by an unconditional line of prose would print the same words
// whether or not a background read resolved in the window. So: count the
// outbound requests this process makes, and collect any unhandled rejection.
let outbound = 0;
const realFetch = globalThis.fetch;
globalThis.fetch = (...args) => {
  outbound += 1;
  return realFetch(...args);
};
const orphans = [];
const onUnhandled = (reason) => orphans.push(reason);
process.on("unhandledRejection", onUnhandled);

process.env.BECOMMUNITY_SHADOW_BUDGET_MS = "1";
const timeoutStarted = Date.now();
const timedOut = await runStudyShadowComparison({
  scope: { tenantId: target.tenantId, studyId: target.studyId },
  legacy,
  filters: {},
});
const timeoutWall = Date.now() - timeoutStarted;
process.env.BECOMMUNITY_SHADOW_BUDGET_MS = String(BUDGET_MS);
const outboundAtReturn = outbound;
say(`  presupuesto=1 ms  estado=${timedOut.status}  pared=${timeoutWall} ms  peticiones=${outboundAtReturn}`);
if (timedOut.status !== "canonical_timeout") {
  globalThis.fetch = realFetch;
  process.off("unhandledRejection", onUnhandled);
  console.error(`REFUSED: a 1 ms budget did not time out (${timedOut.status}).`);
  process.exit(1);
}

// Well past a full read (the median is about a second), so a reader that was
// still paging would have issued at least one more request in the window.
await new Promise((resolve) => setTimeout(resolve, 2000));
globalThis.fetch = realFetch;
process.off("unhandledRejection", onUnhandled);
say(
  `  2000 ms después: peticiones=${outbound} (sin cambio=${outbound === outboundAtReturn}) ` +
    `rechazos huérfanos=${orphans.length}`,
);
if (outbound !== outboundAtReturn) {
  console.error(
    `REFUSED: ${outbound - outboundAtReturn} further request(s) were issued after the budget expired. ` +
      "The read was not cancelled.",
  );
  process.exit(1);
}
if (orphans.length > 0) {
  console.error(`REFUSED: ${orphans.length} unhandled rejection(s) escaped after the budget expired.`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// [6] What the RUNTIME SINK recorded. Codes and totals; no numbers.
// ---------------------------------------------------------------------------
say("\n[5] Lo que el sumidero de ejecución registró");
const records = buffer.records();
buffer.dispose();
say(`  registros=${records.length}`);
const serializedRecords = JSON.stringify(records);
for (const field of ["legacyValue", "canonicalValue", "legacyBase", "canonicalBase"]) {
  if (serializedRecords.includes(field)) {
    console.error(`REFUSED: the runtime record carried '${field}'.`);
    process.exit(1);
  }
}
const last = records[records.length - 1];
if (last) {
  say(
    `  último: estado=${last.status} filtrado=${last.filtered} dims=${last.filterDimensionCount} ` +
      `contrato=${last.contractVersion} comparadas=${last.counts.compared} ` +
      `de acuerdo=${last.counts.agreed} en desacuerdo=${last.counts.disagreed}`,
  );
  say(`  hallazgos registrados: ${last.findings.length}, sólo códigos`);
}

// ---------------------------------------------------------------------------
// [7] The unfiltered comparison, in full — the compatibility totals.
// ---------------------------------------------------------------------------
say("\n[6] La comparación sin filtro");
if (!lastUnfiltered || lastUnfiltered.status !== "compared") {
  console.error(`REFUSED: the unfiltered run did not compare (${lastUnfiltered?.status}).`);
  process.exit(1);
}
say(`  contrato=${lastUnfiltered.contractVersion}  plan=${lastUnfiltered.planFingerprint}`);
if (lastUnfiltered.planFingerprint !== target.planFingerprint) {
  console.error("REFUSED: the imported package is not the one this run was told to report on.");
  process.exit(1);
}
say("\n  clave                                     clasificación                          legado  canónico  ok");
say("  " + "-".repeat(104));
for (const item of lastUnfiltered.findings) {
  const value = (raw) => (raw === null ? "—" : String(raw));
  say(
    `  ${item.key.padEnd(41)} ${item.classification.padEnd(38)} ` +
      `${value(item.legacyValue).padStart(7)} ${value(item.canonicalValue).padStart(9)}  ` +
      `${item.agrees === null ? "·" : item.agrees ? "sí" : "NO"}`,
  );
  if (item.agrees === false) say(`      discrepancia=${item.mismatch}  regla=${item.rule}`);
}

say("\n" + "=".repeat(78));
say(
  `RESUMEN: ${lastUnfiltered.counts.compared} campos comparables, ${lastUnfiltered.counts.agreed} de acuerdo, ` +
    `${lastUnfiltered.counts.disagreed} en desacuerdo, ${lastUnfiltered.counts.classified} clasificados.`,
);
say(
  `RUTA DE EJECUCIÓN: mínimo ${sorted[0]} ms, mediana ${median} ms, p95 ${rank(0.95)} ms, ` +
    `máximo ${sorted[sorted.length - 1]} ms, presupuesto ${BUDGET_MS} ms.`,
);
say(
  "NOTA: estos tiempos se midieron desde esta máquina, no desde el Worker. Acotan la ruta y " +
    "prueban que se completa; la latencia real de producción entre el Worker y Supabase es otra " +
    "medición y no se afirma aquí.",
);
say("NOTA: la sombra sigue APAGADA en todo entorno. Nada se escribió, se implantó ni se publicó.");
