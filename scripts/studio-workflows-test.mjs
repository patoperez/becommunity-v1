/**
 * P8.2 gate — the two guided Studio workflows.
 *
 * Deterministic and credentials-free. It proves the claims this slice makes
 * that a reviewer would otherwise have to take on trust:
 *
 *   1. the no-code access picker produces EXACTLY the stored shape the previous
 *      textarea produced — `{}` for full access, the same AND/OR object for a
 *      restriction — and never widens a restriction by dropping it;
 *   2. a stored value the current data no longer offers is preserved and
 *      reported, not silently discarded;
 *   3. no raw-scope textarea, and no implementation vocabulary, survives on
 *      either Studio surface;
 *   4. the mapping step asks nobody to type a stored key: labels generate
 *      stable, collision-safe keys, saved mappings keep the keys they had, and
 *      every mapping kind is still representable;
 *   5. the readable preview is a faithful view of the same canonical payload,
 *      with no serialized object and no forced wide table.
 *
 * Behaviour is asserted against the real modules. Source assertions are used
 * only where the claim IS about the source — "this control no longer exists".
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { applyDataScope, parseDataScope } from "../src/lib/studies/scope.ts";
import {
  countMatchingUnits,
  dimensionFallbackLabel,
  isSelectionComplete,
  reconcileScope,
  scopeSummarySentence,
  serializeScope,
} from "../src/lib/studies/scope-picker.ts";
import {
  DESTINATION_CHOICES,
  QUALITATIVE_SOURCE_CHOICES,
  destinationLabel,
  destinationOptions,
  duplicateSegmentDestinations,
  keyFromLabel,
  keysInUse,
  nameRejectionReason,
  proposedKeyFromHeader,
  qualitativeSourceLabel,
  recodingTableLabel,
  summarizePreviewRow,
  targetForKind,
  targetKey,
  withTargetKey,
} from "../src/lib/ingestion/destinations.ts";
import { importMappingSchema } from "../src/lib/ingestion/mapping.ts";
import { adaptMappedSurvey } from "../src/lib/ingestion/adapters/mapped-survey.ts";
import { previewMappedImport } from "../src/lib/ingestion/preview.ts";
import { QUALITATIVE_SOURCES } from "../src/lib/ingestion/canonical.ts";

let checks = 0;
const ok = (message) => { checks += 1; console.log(`  PASS  ${message}`); };

/** Source with comments removed: a header explaining a retired control must
 *  never satisfy — or fail — an assertion about the control itself. */
const codeOf = (source) =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const readCode = async (path) =>
  codeOf(await readFile(new URL(`../${path}`, import.meta.url), "utf8"));

// ---------------------------------------------------------------------------
// 1. The access scope the picker stores is the scope the boundary enforces
// ---------------------------------------------------------------------------

console.log("\n[1] Full access and restricted access serialize to the stored shape");

const inventory = {
  tenantId: "t1",
  dimensions: [
    {
      key: "nivel",
      label: "Nivel",
      values: [
        { value: "Primaria", label: "Primaria", units: 8 },
        { value: "Secundaria", label: "Secundaria", units: 5 },
      ],
    },
    {
      key: "campus",
      label: "Campus",
      values: [
        { value: "Norte", label: "Norte", units: 9 },
        { value: "Sur", label: "Sur", units: 4 },
      ],
    },
  ],
  combinations: [
    { values: { campus: "Norte", nivel: "Primaria" }, units: 6 },
    { values: { campus: "Norte", nivel: "Secundaria" }, units: 3 },
    { values: { campus: "Sur", nivel: "Primaria" }, units: 2 },
    { values: { campus: "Sur", nivel: "Secundaria" }, units: 2 },
  ],
  totalUnits: 13,
  countable: true,
};

assert.equal(serializeScope({ mode: "all", values: {} }), "{}",
  "full access must serialize to the empty object the enforcement layer reads as full tenant access");
// Even a selection left behind by a previous choice must not survive `all`.
assert.equal(serializeScope({ mode: "all", values: { nivel: ["Primaria"] } }), "{}");
ok("full access serializes to the empty object, with no leftover restriction");

const restricted = { mode: "part", values: { nivel: ["Primaria", "Secundaria"], campus: ["Norte"] } };
const storedRestricted = JSON.parse(serializeScope(restricted));
assert.deepEqual(storedRestricted, { nivel: ["Primaria", "Secundaria"], campus: ["Norte"] });
assert.deepEqual(parseDataScope(storedRestricted), storedRestricted,
  "what the picker stores must survive the fail-closed parser unchanged");
ok("a restriction serializes to the same AND/OR object the parser accepts");

// The stored object must still MEAN what the picker said it means.
const rows = [
  { id: "a", nivel: "Primaria", campus: "Norte" },
  { id: "b", nivel: "Secundaria", campus: "Norte" },
  { id: "c", nivel: "Primaria", campus: "Sur" },
  { id: "d", nivel: "Preescolar", campus: "Norte" },
];
assert.deepEqual(
  applyDataScope(rows, parseDataScope(storedRestricted)).map((row) => row.id),
  ["a", "b"],
  "values within one characteristic are OR, characteristics are AND",
);
assert.equal(applyDataScope(rows, parseDataScope(JSON.parse(serializeScope({ mode: "all", values: {} })))).length, 4);
ok("the enforced meaning of the picker's output is unchanged (OR inside, AND between)");

console.log("\n[2] An empty restriction is refused, never widened to full access");
assert.equal(isSelectionComplete({ mode: "all", values: {} }), true);
assert.equal(isSelectionComplete({ mode: "part", values: {} }), false);
assert.equal(isSelectionComplete({ mode: "part", values: { nivel: [] } }), false);
assert.equal(isSelectionComplete({ mode: "part", values: { nivel: ["Primaria"] } }), true);
const picker = await readCode("src/components/studio/AccessScopeFields.tsx");
assert.match(picker, /disabled=\{!complete\}/,
  "an incomplete restriction must not be submittable — serializing it would grant full access");
ok("`Solo una parte` with nothing chosen cannot be submitted");

console.log("\n[3] A stored value the data no longer offers is preserved and marked");
const legacy = reconcileScope({ nivel: ["Primaria"], sede: ["Antigua"] }, inventory);
assert.equal(legacy.selection.mode, "part");
assert.deepEqual(legacy.selection.values, { nivel: ["Primaria"], sede: ["Antigua"] },
  "a characteristic missing from current data must stay in the selection");
assert.deepEqual(legacy.unavailable, [{ dimension: "sede", value: "Antigua" }]);
assert.deepEqual(JSON.parse(serializeScope(legacy.selection)), { nivel: ["Primaria"], sede: ["Antigua"] },
  "saving without touching the picker must not drop the historical restriction");
const goneValue = reconcileScope({ nivel: ["Bachillerato"] }, inventory);
assert.deepEqual(goneValue.unavailable, [{ dimension: "nivel", value: "Bachillerato" }]);
assert.match(picker, /Ya no aparece en los datos actuales/,
  "an unavailable selection must be visibly marked as historical");
ok("legacy characteristics and values survive intact and are shown as historical");

console.log("\n[4] Changing client reconciles rather than carrying a scope across");
assert.match(picker, /if \(nextTenantId === initialTenantId\)/,
  "returning to the person's own client restores exactly what was stored");
assert.match(picker, /setMode\("all"\);\s*\n\s*setValues\(\{\}\);\s*\n\s*setReconciled\(changed\);/,
  "any other client must start from full access and say that it did");
assert.match(picker, /Cambiaste de cliente/, "the reset must be stated, not silent");
ok("a restriction is never carried silently into another client");

console.log("\n[5] The effective-access sentence states OR, AND and full access");
assert.equal(
  scopeSummarySentence({ mode: "all", values: {} }, inventory, "Colegio Ejemplo"),
  "Puede ver todos los resultados de Colegio Ejemplo.",
);
assert.equal(
  scopeSummarySentence(restricted, inventory, "Colegio Ejemplo"),
  "Puede ver únicamente las respuestas de Primaria o Secundaria (Nivel) y Norte (Campus).",
);
assert.equal(
  scopeSummarySentence({ mode: "part", values: {} }, inventory, "Colegio Ejemplo"),
  "Todavía no elegiste qué parte podrá ver esta persona.",
);
assert.equal(dimensionFallbackLabel("sede_antigua"), "Sede antigua");
ok("the summary reads as a sentence and never as an object");

console.log("\n[6] The impact count uses the enforcement rule and stays bounded");
assert.equal(countMatchingUnits({ mode: "all", values: {} }, inventory), 13);
assert.equal(countMatchingUnits(restricted, inventory), 9, "Norte, both levels: 6 + 3");
assert.equal(countMatchingUnits({ mode: "part", values: { nivel: ["Primaria"] } }, inventory), 8);
assert.equal(countMatchingUnits({ mode: "part", values: {} }, inventory), null);
assert.equal(countMatchingUnits(restricted, { ...inventory, countable: false }), null,
  "a client too varied to count honestly gets no number at all");
assert.equal(countMatchingUnits(restricted, null), null);
assert.match(picker, /Es\s*\n?\s*la foto de hoy/, "the count must never be presented as permanent");
ok("the count matches the enforcement rule and declines rather than guessing");

console.log("\n[7] Only aggregates reach the browser, after the internal-role check");
const inventoryLoader = await readCode("src/lib/studies/scope-inventory.ts");
assert.match(inventoryLoader, /import "server-only";/, "the inventory loader must never bundle client-side");
assert.match(inventoryLoader, /\.select\("tenant_id, segments"\)/,
  "only the characteristic map is read — no answer, no quote, no identifier");
assert.doesNotMatch(inventoryLoader, /quant_response|qual_observation|quote/,
  "no answer or quote may be read by the access picker's inventory");
const clientsPage = await readCode("src/app/admin/clients/page.tsx");
const roleGate = clientsPage.indexOf('ownProfile?.role !== "internal"');
const inventoryCall = clientsPage.indexOf("await loadTenantScopeInventories(");
assert.ok(roleGate >= 0 && inventoryCall > roleGate,
  "the inventory must be read only after the internal-role check");
ok("aggregate vocabulary only, and only for an internal session");

// ---------------------------------------------------------------------------
// 2. No implementation vocabulary survives on either Studio surface
// ---------------------------------------------------------------------------

console.log("\n[8] The raw scope textarea and its vocabulary are gone");
assert.doesNotMatch(clientsPage, /<textarea/, "no textarea may accept a raw structure");
assert.doesNotMatch(clientsPage, /JSON\.stringify/, "no serialized object may reach this screen");
assert.doesNotMatch(clientsPage, /font-mono/, "code font signals authored structure and has no place here");
assert.doesNotMatch(clientsPage, /Alcance JSON|alcance limitado/,
  "the implementation wording is retired");
assert.doesNotMatch(picker, /JSON\.stringify/,
  "the picker serializes through the shared helper, never inline in a view");
for (const forbidden of ["data_scope", "JSON", "canonical", "schema", "metric_key", "tenant_id"]) {
  const visible = new RegExp(`>[^<>{}]*${forbidden}[^<>{}]*<`);
  assert.doesNotMatch(picker, visible, `"${forbidden}" must not be rendered as text`);
}
// The stored contract itself is unchanged: one hidden field, same name.
assert.match(picker, /type="hidden" name="data_scope"/,
  "the Server Action contract keeps its exact field name");
assert.match(picker, /name="tenant_id"/, "the client field keeps its exact name");
ok("no raw-scope control, no serialized object, no implementation words on screen");

console.log("\n[9] Both invitation and editing use the same picker");
const inviteAt = clientsPage.indexOf("action={inviteClientUser}");
const updateAt = clientsPage.indexOf("action={updateClientUser}");
assert.ok(inviteAt >= 0 && updateAt >= 0);
assert.ok(clientsPage.indexOf("AccessScopeFields", inviteAt) > inviteAt
  && clientsPage.indexOf("AccessScopeFields", inviteAt) < updateAt,
  "the invitation form must use the picker");
assert.ok(clientsPage.indexOf("AccessScopeFields", updateAt) > updateAt,
  "the editing form must use the same picker");
// The frozen adversarial-harness contract for these two operations.
for (const pinned of ["Enviar invitación", "Guardar usuario", "Eliminar cuenta cliente",
  "Crear cliente", "Guardar identidad", 'name="confirmation_email"', 'name="user_id"']) {
  assert.ok(clientsPage.includes(pinned), `the frozen control "${pinned}" must be intact`);
}
ok("one picker serves both flows; every frozen control name is unchanged");

console.log("\n[10] The server remains the check, whatever the browser sends");
const clientsActions = await readCode("src/app/admin/clients/actions.ts");
assert.match(clientsActions, /parseDataScope/, "the action still parses with the fail-closed parser");
const actionRoleGate = clientsActions.indexOf('profile?.role !== "internal"');
const actionAdmin = clientsActions.indexOf("return { user, admin: createAdminClient() }");
assert.ok(actionRoleGate >= 0 && actionAdmin > actionRoleGate,
  "service-role access still follows the internal-role check");
for (const hostile of ['{"nivel":"Primaria"}', '{"nivel":[]}', '{"mal nombre":["x"]}', "[]", '{"nivel":[1]}']) {
  assert.throws(() => parseDataScope(JSON.parse(hostile)), /Invalid profile data scope/,
    `a manipulated shape must be refused: ${hostile}`);
}
ok("manipulated shapes fail server validation exactly as before");

// ---------------------------------------------------------------------------
// 3. The mapping step: selection instead of transcription
// ---------------------------------------------------------------------------

console.log("\n[11] A typed name generates a stable, storable key");
assert.equal(keyFromLabel("Nivel educativo"), "nivel_educativo");
assert.equal(keyFromLabel("Antigüedad"), "antiguedad", "accents are folded, not rejected");
assert.equal(keyFromLabel("  Campus Norte  "), "campus_norte");
assert.equal(keyFromLabel("3er grado"), null, "a name that cannot become a key is refused, not mangled");
assert.equal(keyFromLabel("   "), null);
assert.equal(keyFromLabel("¿?"), null);
// Every generated key must satisfy the UNCHANGED mapping schema.
for (const label of ["Nivel educativo", "Satisfacción general", "Trato del personal"]) {
  const key = keyFromLabel(label);
  const parsed = importMappingSchema.safeParse({
    version: 1,
    name: "prueba",
    columns: [{ sourceColumn: "col", target: { kind: "segment", key } }],
    recodingTables: [],
  });
  assert.ok(parsed.success, `a key generated from "${label}" must satisfy the mapping schema`);
}
ok("names become keys the existing schema accepts, or are refused in words");

console.log("\n[12] Collisions are named, never silently resolved");
assert.equal(nameRejectionReason("Nivel", ["nivel"]),
  "Ya existe “Nivel”. Selecciónalo en la lista para reutilizarlo.");
assert.equal(nameRejectionReason("Nivel educativo", ["nivel"]), null);
assert.equal(nameRejectionReason("", []), "Escribe un nombre para este destino.");
assert.match(nameRejectionReason("3er grado", []), /debe empezar con una letra/);
ok("a colliding name is refused with the existing destination named");

console.log("\n[13] A saved mapping keeps its keys; a label change never repoints one");
const saved = importMappingSchema.parse({
  version: 1,
  name: "Encuesta anual",
  columns: [
    { sourceColumn: "Nivel", target: { kind: "segment", key: "nivel" } },
    { sourceColumn: "Satisfacción", target: { kind: "quantitative", metricKey: "sat_general", min: 1, max: 5 } },
    { sourceColumn: "Comentario", target: { kind: "qualitative", theme: "comentario_libre", source: "encuesta" } },
    { sourceColumn: "Folio", target: { kind: "ignore" } },
  ],
  recodingTables: [{ id: "escala_satisfaccion", version: 1, values: { "Muy satisfecho": 5 } }],
});
// What the operator READS is derived from the stored key; the stored key never
// moves because of how it reads.
assert.equal(destinationLabel("sat_general"), "Sat general");
assert.equal(destinationLabel("comentario_libre"), "Comentario libre");
assert.equal(recodingTableLabel("escala_satisfaccion"), "Escala satisfaccion");
assert.deepEqual(keysInUse(saved, "segment"), ["nivel"]);
assert.deepEqual(keysInUse(saved, "quantitative"), ["sat_general"]);
assert.deepEqual(keysInUse(saved, "qualitative"), ["comentario_libre"]);
// Re-parsing the untouched mapping yields the identical configuration, which is
// what the saved-mapping reuse in `save_import_mapping` compares.
assert.deepEqual(importMappingSchema.parse(saved), saved,
  "opening a saved mapping in the new screen must not change its stored bytes");
ok("saved destinations keep their keys; the label is derived, never stored");

console.log("\n[14] Every mapping kind is still representable, and still adapts");
assert.deepEqual(DESTINATION_CHOICES.map((choice) => choice.kind),
  ["ignore", "private", "segment", "quantitative", "qualitative"]);
assert.deepEqual(DESTINATION_CHOICES.map((choice) => choice.label),
  ["No importar", "Dato privado del equipo", "Dato para filtrar", "Resultado numérico", "Comentario abierto"]);
assert.deepEqual(QUALITATIVE_SOURCE_CHOICES.map((choice) => choice.value), [...QUALITATIVE_SOURCES],
  "the qualitative source allowlist is unchanged; only its labels are friendly");
assert.equal(qualitativeSourceLabel("mystery_shopper"), "Visita de cliente incógnito");
assert.equal(targetForKind("private", "priv_nombre").key, "nombre");
assert.equal(targetForKind("segment", "seg_nivel").key, "nivel");
assert.equal(targetForKind("quantitative", "q_sat_general").metricKey, "sat_general");
assert.equal(targetForKind("qualitative", "qual_comentario").theme, "comentario");
assert.equal(targetForKind("qualitative", "qual_comentario").source, "encuesta");
assert.equal(targetForKind("ignore", "Folio").kind, "ignore");
assert.equal(proposedKeyFromHeader("¿?", "quantitative"), "resultado", "a proposal is always storable");
assert.equal(targetKey({ kind: "ignore" }), null);
assert.equal(targetKey({ kind: "quantitative", metricKey: "nps" }), "nps");
assert.deepEqual(withTargetKey({ kind: "quantitative", metricKey: "a", min: 1, max: 5 }, "b"),
  { kind: "quantitative", metricKey: "b", min: 1, max: 5 },
  "repointing a destination preserves the column's own rules");

const file = {
  headers: ["Nivel", "Satisfacción", "Comentario", "Folio"],
  rows: [
    { Nivel: "Primaria", "Satisfacción": "Muy satisfecho", Comentario: "Buen trato", Folio: "1" },
    { Nivel: "Secundaria", "Satisfacción": "Muy satisfecho", Comentario: "", Folio: "2" },
  ],
};
const savedWithRecoding = {
  ...saved,
  columns: saved.columns.map((column) =>
    column.target.kind === "quantitative"
      ? { ...column, target: { ...column.target, recodingTableId: "escala_satisfaccion" } }
      : column),
};
const adapted = adaptMappedSurvey(file, savedWithRecoding);
assert.ok(adapted.ok, "every kind produced by the new screen must still adapt");
assert.deepEqual(adapted.summary, { respondents: 2, quant: 2, qual: 1 });
assert.deepEqual(adapted.respondents[0].segments, { nivel: "Primaria" });
assert.deepEqual(adapted.respondents[0].quant, [{ metric_key: "sat_general", value: 5 }]);
assert.equal(adapted.respondents[0].qual[0].theme, "comentario_libre");
ok("all four destinations, the recoding table and the adapter behave unchanged");

console.log("\n[15] Two columns sharing a filter destination are reported");
const shared = {
  ...saved,
  columns: [
    { sourceColumn: "Nivel", target: { kind: "segment", key: "nivel" } },
    { sourceColumn: "Nivel 2", target: { kind: "segment", key: "nivel" } },
  ],
};
assert.deepEqual(duplicateSegmentDestinations(shared), ["nivel"]);
assert.deepEqual(duplicateSegmentDestinations(saved), [],
  "numbers and comments append, so sharing one is ordinary and gets no warning");
const workbench = await readCode("src/app/admin/upload/MappingWorkbench.tsx");
assert.match(workbench, /Se conservará\s*\n?\s*el valor de la última columna/,
  "the consequence of sharing a filter destination must be stated");
ok("a silently overwriting duplicate is surfaced with its consequence");

console.log("\n[16] Existing destinations are offered instead of remembered");
const options = destinationOptions(saved, "segment", ["nivel", "campus"], "nivel");
assert.deepEqual(options.map((option) => option.key), ["campus", "nivel"]);
assert.deepEqual(options.map((option) => option.label), ["Campus", "Nivel"]);
assert.equal(options.find((option) => option.key === "campus").known, true);
const withCurrent = destinationOptions(saved, "segment", [], "grupo");
assert.ok(withCurrent.some((option) => option.key === "grupo"),
  "the destination this column already points at is always selectable");
const uploadActions = await readCode("src/app/admin/upload/actions.ts");
assert.match(uploadActions, /knownDestinations/,
  "the analyze step must supply the client's existing destinations");
assert.match(uploadActions, /STORABLE_KEY = \/\^\[a-z\]/,
  "only names the mapping schema could store are ever offered");
assert.match(uploadActions, /authorizeInternal\(\)/);
ok("destinations already in the client's data are offered as readable choices");

console.log("\n[17] No typed key or table identifier control remains");
for (const retired of ["Clave de segmento", "Clave de métrica", "Tema cualitativo",
  "ID de tabla", "Tabla de recodificación", "Fuente cualitativa"]) {
  assert.ok(!workbench.includes(retired), `the typed control "${retired}" must be gone`);
}
const uploadForm = await readCode("src/app/admin/upload/UploadForm.tsx");
for (const retired of ["Clave de segmento", "Clave de métrica", "ID de tabla"]) {
  assert.ok(!uploadForm.includes(retired), `"${retired}" must not survive in the form either`);
}
assert.doesNotMatch(workbench, /value=\{target\.key\}|value=\{target\.metricKey\}|value=\{target\.theme\}/,
  "no free-text input may be bound directly to a stored key");
// The identifier survives only as a `<option>`'s stored value — what the
// operator reads and picks is the table's name.
assert.match(workbench, /<option key=\{table\.id\} value=\{table\.id\}>\s*\{recodingTableLabel\(table\.id\)\}/,
  "a recoding table is chosen by its readable name, never by its identifier");
assert.match(workbench, /value=\{tableNames\[tableIndex\] \?\? recodingTableLabel\(table\.id\)\}/,
  "the recoding table's editable field is its name; the identifier is derived from it");
ok("every stored key and table identifier is generated, never transcribed");

// ---------------------------------------------------------------------------
// 4. The readable preview
// ---------------------------------------------------------------------------

console.log("\n[18] The preview is a faithful view of the canonical payload");
const previewed = await previewMappedImport(file, savedWithRecoding, 5);
assert.ok(previewed.result.ok);
const summarized = previewed.sample.map(summarizePreviewRow);
assert.equal(summarized.length, 2);
assert.deepEqual(summarized[0].filters, [{ label: "Nivel", value: "Primaria" }]);
assert.deepEqual(summarized[0].results, [{ label: "Sat general", value: 5 }]);
assert.equal(summarized[0].comments.length, 1);
assert.equal(summarized[0].comments[0].label, "Comentario libre");
assert.equal(summarized[0].comments[0].source, "Encuesta");
assert.equal(summarized[0].comments[0].quote, "Buen trato",
  "the quote is shown exactly as it will be stored, through an escaped text node");
assert.equal(summarized[1].comments.length, 0, "an empty cell produces no comment, as the adapter says");
// The view must not invent or drop anything the canonical row carries.
assert.equal(
  summarized[0].filters.length + summarized[0].results.length + summarized[0].comments.length,
  Object.keys(previewed.sample[0].segments).length
    + previewed.sample[0].quant.length
    + previewed.sample[0].qual.length,
);
ok("every canonical value is represented exactly once, and none is invented");

console.log("\n[19] No serialized object and no forced wide table survive");
const previewView = await readCode("src/app/admin/upload/ImportPreview.tsx");
assert.doesNotMatch(previewView, /<pre/, "the JSON dump is retired");
assert.doesNotMatch(previewView, /JSON\.stringify/, "no serialized object may be rendered");
assert.doesNotMatch(uploadForm, /<pre/);
assert.doesNotMatch(uploadForm, /JSON\.stringify\([^)]*segments/);
for (const source of [workbench, previewView, uploadForm, picker, clientsPage]) {
  assert.doesNotMatch(source, /min-w-\[900px\]/,
    "the mapping and preview must reflow, not force a wide table");
  assert.doesNotMatch(source, /dangerouslySetInnerHTML/);
}
assert.doesNotMatch(workbench, /<table/, "the 900px mapping table is replaced by a reflowing list");
assert.doesNotMatch(previewView, /<table/);
// The mapping still travels to the server serialized — that is the unchanged
// action contract, and it is not a user-visible surface.
assert.match(uploadForm, /data\.set\("mapping_json", JSON\.stringify\(mapping\)\)/,
  "the Server Action contract for the mapping is unchanged");
ok("no rendered JSON, no forced wide table, and the action contract intact");

console.log("\n[20] Counts, validation, confirmation and rollback are unchanged");
assert.match(uploadForm, /confirmImportFile\(data\)/);
assert.match(uploadForm, /rollbackLatestImport\(batchId\)/);
assert.match(uploadForm, /disabled=\{pending \|\| !canConfirm\}/,
  "confirmation still requires an explicit review acknowledgement");
assert.match(uploadForm, /ErrorList errors=\{preview\.errors\}/,
  "validation errors are still shown before anything is written");
assert.match(uploadActions, /confirmImportFile[\s\S]*previewMappedImport/,
  "confirmation still re-runs the pure preview before writing");
assert.match(uploadActions, /persistRespondents/);
assert.match(uploadActions, /rollbackImportBatch/);
assert.match(uploadActions, /sourceSignature\(upload\.parsed\.headers\)/,
  "source-signature reuse is unchanged");
ok("the counts, validation, atomic commit and rollback contracts are untouched");

console.log(`\nP8.2 Studio guided workflows gate: PASS (${checks} checks)`);
