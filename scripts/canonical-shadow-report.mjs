// =============================================================================
// THE INTERNAL SHADOW OPERATOR — legacy against canonical, read-only, offline
// of the application.
// =============================================================================
//   CANONICAL_IMPORT_PROJECT_REF=<ref> \
//   CANONICAL_IMPORT_ACKNOWLEDGE=I-AUTHORIZE-CANONICAL-IMPORT-INTO-<ref> \
//   CANONICAL_IMPORT_SERVICE_KEY=<key> \
//   CANONICAL_IMPORT_TENANT_ID=<uuid> CANONICAL_IMPORT_STUDY_ID=<uuid> \
//   CANONICAL_IMPORT_PLAN_FINGERPRINT=sha256:… CANONICAL_IMPORT_MAPPING_VERSION=1 \
//   CANONICAL_IMPORT_CLEAN_XLSX=<path> CANONICAL_IMPORT_PAIN_XLSX=<path> \
//     npm run canonical-shadow-report
// =============================================================================
// This is the "internal operator" the shadow diagnostics are inspectable
// through. The application NEVER surfaces them: the one approved page binds
// `legacy` and nothing else, and a gate fails if any page, component or route
// so much as names the diagnostic. An operator running this script is the
// supported way to read them.
//
// IT ONLY READS. It resolves the import guard in its DRY-RUN mode — the mode
// that has no `--execute` and cannot mutate — builds the legacy payload from
// the same loader the application uses, reads the canonical package through the
// same server adapter, and compares. No RPC, no insert, no update, no delete.
//
// IT DOES NOT ENABLE SHADOW MODE ANYWHERE. The flag and the allowlist are
// supplied to `runShadowComparison` IN THIS PROCESS, for this one scope, and
// die with it. No environment is written, no deployment is touched, and the
// hosted application still runs with the shadow off.
//
// IT PRINTS ONLY THE SAFE DIAGNOSTIC. Stable keys, classifications, aggregates
// both layers already publish, counts and codes — the exact field list
// `src/lib/shadow/contract.ts` declares, which has no place for a respondent, a
// name, an answer or a database message.
// =============================================================================

import { createClient } from "@supabase/supabase-js";

import { loadStudyRows } from "../src/lib/calc/load.ts";
import { buildStudyDashboard } from "../src/lib/dashboard/view.ts";
import { parseJourneyDefinition } from "../src/lib/calc/journey.ts";
import { keysetWindow, selectAllPages } from "../src/lib/supabase/paginate.ts";
// The PURE half of the canonical read path, exactly as
// `canonical-database-parity.mjs` uses it. `canonical-source/adapter.ts` is
// `server-only` and throws under plain Node by design; a command-line operator
// supplies its own transport instead of defeating that marker.
import {
  canonicalResultSourceFromRows,
  loadCanonicalRowSet,
  postgrestReadTransport,
} from "../src/lib/canonical-source/index.ts";
import { CUICUILCO_RESULTS_V1, buildCanonicalStudyResults } from "../src/lib/results/index.ts";
import {
  ENV_SHADOW_MODE,
  ENV_SHADOW_SCOPES,
  SHADOW_ENABLED_LITERAL,
  runShadowComparison,
} from "../src/lib/shadow/index.ts";
import {
  ImportTargetError,
  parseImportArguments,
  resolveImportTarget,
} from "./lib/canonical-import-target.mjs";

let target;
try {
  const options = parseImportArguments(process.argv.slice(2));
  if (options.execute) {
    console.error("REFUSED: this operator only reads. It has no --execute mode.");
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

const say = (line) => console.log(line);
say("Be Community — informe de la comparación en sombra (sólo lectura)");
say("=".repeat(78));
say(`  proyecto: ${target.ref}   cliente: ${target.tenantId}   estudio: ${target.studyId}`);

const client = createClient(target.apiOrigin, target.serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// ---------------------------------------------------------------------------
// [1] The legacy payload, from the loader the application uses.
// ---------------------------------------------------------------------------
say("\n[1] El pago heredado");
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

const rows = await loadStudyRows(client, target.studyId);

/**
 * The confirmed qualitative rows, in the same shape `loadAuthorizedStudyData`
 * builds. Read here rather than imported because that loader is `server-only`
 * and belongs to a request, not to a command-line operator; the query is the
 * same one, paged the same way.
 */
const observations = await selectAllPages(
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
);
const respondents = await selectAllPages(
  "respondent",
  (cursor, size) =>
    keysetWindow(client.from("respondent").select("id, segments").eq("study_id", target.studyId), {
      column: "id",
      cursor,
      size,
    }),
  { maxRows: 50_000, cursorOf: (row) => row.id },
);
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

const legacy = buildStudyDashboard(
  rows,
  qualitative,
  parseJourneyDefinition(studyRow.journey_definition),
  {},
  studyRow.dashboard_config,
);
say(`  filas cuantitativas=${rows.length}  cualitativas confirmadas=${qualitative.length}`);
say(
  `  fichas=${legacy.view.tiles.length} promedios=${legacy.view.averages.length} ` +
    `etapas=${legacy.view.journey.length} unidades=${legacy.view.sourceUnits} ` +
    `visibilidad=${legacy.view.selectionVisibility}`,
);

// ---------------------------------------------------------------------------
// [2] The canonical document, read through the same adapter the shadow uses.
// ---------------------------------------------------------------------------
say("\n[2] El documento canónico");
const readStarted = Date.now();
const rowSet = await loadCanonicalRowSet(postgrestReadTransport(client), {
  tenantId: target.tenantId,
  studyId: target.studyId,
});
const canonicalSource = canonicalResultSourceFromRows(rowSet, {
  spec: CUICUILCO_RESULTS_V1,
  tenantId: target.tenantId,
  studyId: target.studyId,
});
const canonical = buildCanonicalStudyResults(canonicalSource);
say(`  contrato=${canonical.contractVersion}  (${Date.now() - readStarted} ms de lectura paginada)`);
say(`  huella del plan almacenada = ${canonical.study.planFingerprint}`);
if (canonical.study.planFingerprint !== target.planFingerprint) {
  console.error(
    "REFUSED: the imported package is not the one this run was told to report on.",
  );
  process.exit(1);
}

// ---------------------------------------------------------------------------
// [3] The comparison, through the real orchestrator.
// ---------------------------------------------------------------------------
say("\n[3] La comparación");
const shadow = await runShadowComparison({
  scope: { tenantId: target.tenantId, studyId: target.studyId },
  legacy,
  filters: {},
  // Enabled IN THIS PROCESS ONLY, for this one scope. Nothing is written to any
  // environment and no deployment is changed.
  env: {
    [ENV_SHADOW_MODE]: SHADOW_ENABLED_LITERAL,
    [ENV_SHADOW_SCOPES]: `${target.tenantId}:${target.studyId}`,
    BECOMMUNITY_SHADOW_BUDGET_MS: "5000",
  },
  loadCanonical: async () => canonical,
});

say(`  estado=${shadow.status}  presupuesto=${shadow.budgetMs} ms  transcurrido=${shadow.elapsedMs} ms`);
say(`  huella de filtro=${shadow.filterFingerprint}`);
say(
  `  comparadas=${shadow.counts.compared} de acuerdo=${shadow.counts.agreed} ` +
    `en desacuerdo=${shadow.counts.disagreed} clasificadas=${shadow.counts.classified}`,
);

say("\n  clave                                     clasificación                          legado  canónico  ok");
say("  " + "-".repeat(104));
for (const item of shadow.findings) {
  const value = (raw) => (raw === null ? "—" : String(raw));
  say(
    `  ${item.key.padEnd(41)} ${item.classification.padEnd(38)} ` +
      `${value(item.legacyValue).padStart(7)} ${value(item.canonicalValue).padStart(9)}  ` +
      `${item.agrees === null ? "·" : item.agrees ? "sí" : "NO"}`,
  );
  if (item.agrees === false) say(`      discrepancia=${item.mismatch}  regla=${item.rule}`);
}

const byClassification = new Map();
for (const item of shadow.findings) {
  byClassification.set(item.classification, (byClassification.get(item.classification) ?? 0) + 1);
}
say("\n  totales por clasificación");
for (const [classification, count] of [...byClassification.entries()].sort()) {
  say(`    ${classification.padEnd(40)} ${String(count).padStart(3)}`);
}

const disagreements = shadow.findings.filter((item) => item.agrees === false);
say("\n" + "=".repeat(78));
if (shadow.status !== "compared") {
  console.error(`RESULTADO: la comparación no se ejecutó (${shadow.status}).`);
  process.exit(1);
}
say(
  `RESUMEN: ${shadow.counts.compared} campos comparables, ${shadow.counts.agreed} de acuerdo, ` +
    `${shadow.counts.disagreed} en desacuerdo, ${shadow.counts.classified} clasificados sin comparar.`,
);
if (disagreements.length > 0) {
  say("DISCREPANCIAS REALES:");
  for (const item of disagreements) say(`  · ${item.key} (${item.mismatch})`);
}
say(
  "NOTA: esto NO es la paridad dorada. Son los campos que el pago heredado y el contrato canónico " +
    "publican ambos y que una autoridad relaciona sin tabla de alias. La paridad dorada contra el " +
    "tablero aprobado se reporta por separado (`npm run canonical-database-parity`).",
);
