// =============================================================================
// UNIT 6B.3A — THE DURABLE DRAFT: THE ENVELOPE, THE SAVE SESSION, THE BOUNDARY
// =============================================================================
//   node node_modules/tsx/dist/cli.mjs scripts/canonical-presentation-persistence-test.mjs
//   npm run test:canonical-presentation-persistence
//
// WHAT THIS GATE IS FOR.
//
// Persistence fails in ways that look like success. A save that reports
// «Guardado» over work it did not store, a stale answer that marks newer edits
// saved, a conflict quietly resolved by overwriting somebody else's document —
// none of those throw, and none of them are visible in a screenshot. They are
// all properties of a STATE TRANSITION or of an ENCODING, so they are provable
// here, offline, without a browser and without a database.
//
// What this gate proves:
//
//   1  a v4 document survives encode → jsonb → decode byte for byte;
//   2  the envelope carries the identity the row's columns hold, and a column
//      that disagrees with the document is refused;
//   3  a legacy v1/v2/v3 definition is refused BY NAME and never reinterpreted;
//   4  a document of another study, tenant or family is refused;
//   5  an unbound document is never stored;
//   6  «Guardado» means the stored document IS the document on screen;
//   7  an older answer cannot mark newer local edits saved;
//   8  a failed or timed-out save never reads «Guardado», and preserves the work;
//   9  a conflict preserves the local document and cannot resolve itself by writing;
//  10  a retry repeats the idempotency key, so a replay cannot make a revision;
//  11  autosave does not fire in a conflict, during a save, or after a failure;
//  12  no secret, respondent row, canonical key or address is reachable from
//      anything this unit added to the client boundary.
//
// Every figure here is invented. No client workbook, name, answer, quote or
// identifier is committed to this file.
// =============================================================================

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { composerFixtureSource } from "./lib/composer-fixture.mjs";
import { buildPresentationRead } from "../src/lib/viewer/index.ts";
import { bindPresentationDocument } from "../src/lib/presentation/registry.ts";
import { validatePresentationDocument } from "../src/lib/presentation/document.ts";
import { serializeDeterministic } from "../src/lib/presentation/serialize.ts";
import {
  decodePresentationFromStorage,
  encodePresentationForStorage,
} from "../src/lib/presentation/persistence.ts";
import {
  SAVE_STATE_LABEL,
  acceptSaveResponse,
  adoptStoredVersion,
  autosaveIsDue,
  beginSave,
  canSave,
  dismissSaveFailure,
  documentChanged,
  hasUnsavedChanges,
  openSaveSession,
  retryAttempt,
} from "../src/lib/composer/save-session.ts";
import { adoptDocument, openComposer, renamePage, undo } from "../src/lib/composer/editor.ts";
import { buildGenericStartingBlueprint } from "../src/lib/presentation/blueprints/generic-starting.ts";
import { JOURNEY_ROUTES_VARIANTS, offeredChartVariants } from "../src/lib/composer/renderer-capabilities.ts";

let failures = 0;
const ok = (message) => console.log(`  ✓ ${message}`);
const bad = (message) => {
  failures += 1;
  console.log(`  ✗ FALLO: ${message}`);
};
/**
 * `check(condition, message)`, and the argument order is ENFORCED.
 *
 * Unit 6B.2's confirmation script called this helper as `(message, condition)`
 * five times. A non-empty string is truthy, so all five passed without ever
 * testing anything and the run reported green. Refusing a non-string message
 * turns that mistake into a loud failure instead of a silent pass.
 */
const check = (condition, message) => {
  if (typeof message !== "string") {
    failures += 1;
    console.log(`  ✗ FALLO: check() recibió un mensaje que no es texto — ¿argumentos invertidos?`);
    return;
  }
  return condition ? ok(message) : bad(message);
};
const eq = (label, actual, expected) =>
  check(
    Object.is(actual, expected),
    `${label} = ${JSON.stringify(expected)}${Object.is(actual, expected) ? "" : ` (fue ${JSON.stringify(actual)})`}`,
  );

const TENANT = "22222222-2222-4222-8222-222222222222";
const STUDY = "33333333-3333-4333-8333-333333333333";
const OTHER_STUDY = "44444444-4444-4444-8444-444444444444";

console.log("Be Community — Unidad 6B.3A: el borrador durable");

/* -------------------------------------------------------------------------- */
/* A document that is real, built the way the product builds one               */
/* -------------------------------------------------------------------------- */

const built = buildPresentationRead(composerFixtureSource());
const { registry } = built;
const editorState = openComposer(
  bindPresentationDocument(
    validatePresentationDocument(JSON.parse(JSON.stringify(registryStartingDocument()))).value,
    registry,
  ),
);
const bound = editorState.document;

/**
 * The smallest valid v4 document that binds against the fixture's registry.
 *
 * Built here rather than imported so this gate does not depend on a blueprint
 * whose shape is another unit's decision.
 */
function registryStartingDocument() {
  return {
    schemaVersion: 4,
    documentKind: "canonical_presentation",
    registryVersion: registry.registryVersion,
    binding: null,
    id: "doc-persistencia",
    title: "Documento de prueba",
    locale: "es-MX",
    samplePolicy: { mode: "show_all" },
    methodologyDisclosure: "none",
    pages: [{ id: "pagina-uno", title: "Primera", order: 1, blocks: [] }],
  };
}

/* -------------------------------------------------------------------------- */

console.log("\n[1] El sobre: ida y vuelta por jsonb, byte a byte");

const encoded = encodePresentationForStorage(bound, { tenantId: TENANT, studyId: STUDY });
check(encoded.ok, "un documento v4 enlazado se codifica para almacenamiento");
if (!encoded.ok) {
  console.log(JSON.stringify(encoded.errors, null, 2));
  process.exit(1);
}

eq("la versión de esquema del sobre", encoded.value.schemaVersion, 4);
eq("la familia del sobre", encoded.value.documentKind, "canonical_presentation");
eq("la versión de registro del sobre", encoded.value.registryVersion, registry.registryVersion);
eq("el enlace del sobre", encoded.value.binding, bound.binding);
check(/^[0-9a-f]{64}$/.test(encoded.value.definitionSha256), "y su digest es sha-256 en hexadecimal");

// LA COLUMNA JSONB NORMALIZA. PostgreSQL reordena las claves y no conserva el
// texto original, así que un digest calculado sobre una serialización que NO
// ordena claves dejaría de coincidir en cuanto la fila diera la vuelta. Esto lo
// prueba de verdad: se serializa, se vuelve a parsear como haría la columna, y
// se decodifica desde ahí.
const throughJsonb = JSON.parse(JSON.stringify(encoded.value.definition));
const shuffled = shuffleKeysDeeply(throughJsonb);
const decoded = decodePresentationFromStorage(
  {
    schemaVersion: encoded.value.schemaVersion,
    definition: shuffled,
    definitionSha256: encoded.value.definitionSha256,
    documentKind: encoded.value.documentKind,
    registryVersion: encoded.value.registryVersion,
    binding: encoded.value.binding,
  },
  { tenantId: TENANT, studyId: STUDY },
);
check(decoded.ok, "y vuelve a leerse aunque la columna haya reordenado todas las claves");
if (decoded.ok) {
  eq(
    "el documento recuperado es idéntico al guardado",
    serializeDeterministic(decoded.value),
    serializeDeterministic(bound),
  );
  check(
    !Object.prototype.hasOwnProperty.call(decoded.value, "metadata"),
    "y no trae de vuelta el alcance de almacenamiento: lo que se recupera es autorable",
  );
}

/** Rebuild every object with its keys in reverse order, at every depth. */
function shuffleKeysDeeply(value) {
  if (Array.isArray(value)) return value.map(shuffleKeysDeeply);
  if (value === null || typeof value !== "object") return value;
  const out = {};
  for (const key of Object.keys(value).reverse()) out[key] = shuffleKeysDeeply(value[key]);
  return out;
}

/* -------------------------------------------------------------------------- */

console.log("\n[2] La columna y el documento tienen que estar de acuerdo");

for (const [field, wrong, why] of [
  ["documentKind", "experience_definition", "la familia"],
  ["registryVersion", "9.9.9", "la versión de registro"],
  ["binding", "f".repeat(64), "el enlace"],
]) {
  const mismatched = decodePresentationFromStorage(
    {
      schemaVersion: encoded.value.schemaVersion,
      definition: throughJsonb,
      documentKind: encoded.value.documentKind,
      registryVersion: encoded.value.registryVersion,
      binding: encoded.value.binding,
      [field]: wrong,
    },
    { tenantId: TENANT, studyId: STUDY },
  );
  check(
    !mismatched.ok && mismatched.errors.some((e) => e.code === "persistence_scope_invalid"),
    `una fila cuya columna contradice ${why} del documento se rechaza`,
  );
}

const wrongVersionColumn = decodePresentationFromStorage(
  { schemaVersion: 3, definition: throughJsonb },
  { tenantId: TENANT, studyId: STUDY },
);
check(
  !wrongVersionColumn.ok && wrongVersionColumn.errors.some((e) => e.code === "persistence_scope_invalid"),
  "una fila cuya columna de versión no es la del documento se rechaza",
);

const tampered = JSON.parse(JSON.stringify(throughJsonb));
tampered.title = "Otro título";
const badDigest = decodePresentationFromStorage(
  { schemaVersion: 4, definition: tampered, definitionSha256: encoded.value.definitionSha256 },
  { tenantId: TENANT, studyId: STUDY },
);
check(
  !badDigest.ok && badDigest.errors.some((e) => e.code === "persistence_hash_mismatch"),
  "y una definición que no corresponde a su digest se rechaza",
);

/* -------------------------------------------------------------------------- */

console.log("\n[3] Lo heredado se rechaza por su nombre, y nunca se reinterpreta");

for (const version of [1, 2, 3]) {
  const legacy = {
    schemaVersion: version,
    metadata: { studyId: STUDY, tenantId: TENANT },
    pages: [{ id: "p1", title: "Heredado" }],
  };
  const refused = decodePresentationFromStorage(
    { schemaVersion: version, definition: legacy },
    { tenantId: TENANT, studyId: STUDY },
  );
  check(!refused.ok, `una definición heredada v${version} no se lee como presentación canónica`);
  check(
    !refused.ok && refused.errors.some((e) => e.code === "unsupported_schema_version"),
    `y se rechaza por versión no soportada, no por «documento malformado»`,
  );
  // El texto del rechazo nombra la familia heredada, que es la diferencia entre
  // «tu documento está roto» y «tu documento es de otra familia».
  check(
    !refused.ok && refused.errors.some((e) => /heredada/i.test(e.detail)),
    `y la explicación dice que pertenece a la definición de experiencia heredada`,
  );
  // Y NADA SE MIGRA. El objeto heredado no se toca.
  eq(`la definición heredada v${version} sigue intacta`, legacy.schemaVersion, version);
}

/* -------------------------------------------------------------------------- */

console.log("\n[4] Otro estudio, otro inquilino, otra familia: rechazo");

const otherScope = decodePresentationFromStorage(
  { schemaVersion: 4, definition: throughJsonb },
  { tenantId: TENANT, studyId: OTHER_STUDY },
);
check(
  !otherScope.ok && otherScope.errors.some((e) => e.code === "persistence_scope_mismatch"),
  "una fila de otro estudio no se lee para el estudio que la pidió",
);

const undefinedScope = decodePresentationFromStorage(
  { schemaVersion: 4, definition: { schemaVersion: 4, documentKind: "canonical_presentation" } },
  { tenantId: undefined, studyId: undefined },
);
check(
  !undefinedScope.ok && undefinedScope.errors.some((e) => e.code === "persistence_scope_invalid"),
  "y un alcance sin definir no compara «undefined» contra «undefined» y pasa",
);

const encodeOther = encodePresentationForStorage(bound, { tenantId: TENANT, studyId: "no-es-un-uuid" });
check(!encodeOther.ok, "un alcance que no son dos UUID no se codifica");

/* -------------------------------------------------------------------------- */

console.log("\n[5] Un documento sin enlazar no se almacena");

const unboundEncode = encodePresentationForStorage(
  { ...bound, binding: null },
  { tenantId: TENANT, studyId: STUDY },
);
check(
  !unboundEncode.ok && unboundEncode.errors.some((e) => e.code === "persistence_unbound_document"),
  "una plantilla sin enlace se rechaza al escribir, no sólo al resolver",
);

/* -------------------------------------------------------------------------- */

console.log("\n[6] «Guardado» significa que lo almacenado ES lo que está en pantalla");

const restored = openSaveSession({ document: bound, revision: 7, restored: true });
eq("un borrador restaurado abre en", restored.state, "sin_cambios");
eq("con la revisión que la base tiene", restored.revision, 7);
check(!hasUnsavedChanges(restored, bound), "y sin cambios pendientes");
check(!canSave(restored, bound), "así que no hay nada que guardar");

const fresh = openSaveSession({ document: bound, revision: null, restored: false });
eq("un plano recién construido abre en", fresh.state, "cambios_sin_guardar");
check(
  hasUnsavedChanges(fresh, bound),
  "porque un plano que nadie ha guardado ES trabajo sin guardar, y llamarlo «Sin cambios» invita a cerrar la pestaña",
);
eq("y su revisión esperada es nula", fresh.revision, null);

const edited = renamePage(editorState, "pagina-uno", "Cambiada");
check(edited.document !== bound, "una edición produce un documento nuevo por identidad");
const dirty = documentChanged(restored, edited.document);
eq("y la sesión pasa a", dirty.state, "cambios_sin_guardar");

const saving = beginSave(dirty, edited.document, "clave-de-guardado-1");
eq("al empezar a guardar la sesión dice", saving.state, "guardando");
eq("y presenta como revisión esperada la almacenada", saving.inFlight.expectedRevision, 7);
check(!canSave(saving, edited.document), "y no se puede iniciar un segundo guardado encima");

const saved = acceptSaveResponse(
  saving,
  saving.inFlight.sequence,
  { ok: true, revision: 8, currentRevision: 8, created: false, replayed: false },
  edited.document,
);
eq("una respuesta correcta sobre el documento actual dice", saved.state, "guardado");
eq("y la revisión avanza exactamente una vez", saved.revision, 8);
check(!hasUnsavedChanges(saved, edited.document), "y no queda nada por guardar");

/* -------------------------------------------------------------------------- */

console.log("\n[7] Una respuesta vieja no puede marcar como guardado un trabajo nuevo");

// El autor siguió escribiendo mientras el guardado viajaba.
const kept = renamePage(edited, "pagina-uno", "Y otra vez");
const savedButMoved = acceptSaveResponse(
  saving,
  saving.inFlight.sequence,
  { ok: true, revision: 8, currentRevision: 8, created: false, replayed: false },
  kept.document,
);
eq(
  "un guardado correcto cuyo documento ya no es el de pantalla dice",
  savedButMoved.state,
  "cambios_sin_guardar",
);
eq("pero registra la revisión, porque el almacén SÍ se movió", savedButMoved.revision, 8);
check(
  savedButMoved.savedDocument === edited.document,
  "y recuerda exactamente qué documento quedó almacenado, que no es el de pantalla",
);

// DOS EN VUELO, LA VIEJA CONTESTA DESPUÉS.
const first = beginSave(dirty, edited.document, "clave-de-guardado-2");
const second = beginSave({ ...first, inFlight: null }, kept.document, "clave-de-guardado-3");
const afterSecond = acceptSaveResponse(
  second,
  second.inFlight.sequence,
  { ok: true, revision: 9, currentRevision: 9, created: false, replayed: false },
  kept.document,
);
eq("la respuesta más nueva se aplica", afterSecond.revision, 9);
const afterStale = acceptSaveResponse(
  afterSecond,
  first.inFlight.sequence,
  { ok: true, revision: 8, currentRevision: 8, created: false, replayed: false },
  kept.document,
);
eq("y la más vieja, que llega después, se descarta entera", afterStale.revision, 9);
eq("sin mover el estado", afterStale.state, afterSecond.state);

/* -------------------------------------------------------------------------- */

console.log("\n[8] Un guardado fallido nunca dice «Guardado», y conserva el trabajo");

for (const reason of ["transport_failed", "storage_refused", "document_refused", "not_authorized"]) {
  const failed = acceptSaveResponse(
    saving,
    saving.inFlight.sequence,
    { ok: false, reason, detail: "No pudimos guardar." },
    edited.document,
  );
  check(failed.state !== "guardado", `un fallo «${reason}» no dice «Guardado»`);
  eq(`y dice`, failed.state, "no_pudimos_guardar");
  check(
    failed.savedDocument === restored.savedDocument,
    `y no toca lo que la sesión creía almacenado`,
  );
  eq(`y no mueve la revisión`, failed.revision, 7);
  check(hasUnsavedChanges(failed, edited.document), `y los cambios locales siguen sin guardar`);
}

// UN REINTENTO REPITE LA CLAVE. Es lo que convierte un reintento en una repetición.
const timedOut = acceptSaveResponse(
  saving,
  saving.inFlight.sequence,
  { ok: false, reason: "transport_failed", detail: "Se agotó el tiempo." },
  edited.document,
);
const retry = retryAttempt(timedOut, edited.document);
check(retry !== null, "tras un tiempo agotado hay un intento que repetir");
eq("y repite exactamente la misma clave de idempotencia", retry.idempotencyKey, "clave-de-guardado-1");
eq("y la misma revisión esperada", retry.expectedRevision, 7);

// EL REINTENTO CADUCA EN CUANTO EL DOCUMENTO SE MUEVE, y esto es la corrección
// de un defecto que esta misma unidad introdujo y encontró.
//
// Si se reintentara la clave vieja con el documento NUEVO: la base encontraría
// la clave ya registrada, contestaría con la revisión que produjo el intento
// original — que guardó el documento VIEJO — y la sesión, viendo un éxito sobre
// el documento en pantalla, diría «Guardado» de algo que no está guardado. Es
// exactamente el fallo que esta unidad existe para impedir, llegando por el
// mecanismo construido para impedirlo.
check(
  retryAttempt(timedOut, kept.document) === null,
  "y NO se ofrece repetir esa clave cuando el documento ya cambió: repetirla contestaría por el " +
    "contenido viejo y la pantalla llamaría «Guardado» al nuevo",
);
// La consecuencia se comprueba de verdad: si se hiciera, esto es lo que pasaría.
const dishonest = acceptSaveResponse(
  beginSave(timedOut, kept.document, "clave-de-guardado-1"),
  timedOut.sequence + 1,
  // `currentRevision === revision`: the key's save is still the newest thing in
  // the store, so nothing else refuses this. What WOULD refuse it is the
  // document check — and that is the point being demonstrated.
  { ok: true, revision: 8, currentRevision: 8, created: false, replayed: true },
  kept.document,
);
eq(
  "porque una repetición aceptada sobre un documento distinto diría exactamente esto",
  dishonest.state,
  "guardado",
);

// UNA REPETICIÓN A LA QUE ALGUIEN SE ADELANTÓ ES UN CONFLICTO, NO UN ÉXITO.
//
// La base contesta una clave repetida con la revisión que ESA clave produjo y,
// aparte, con dónde está la fila AHORA. Cuando difieren, el guardado sí se
// aplicó y alguien guardó encima después: el documento que esta sesión envió ya
// no es lo que el almacén tiene, y llamarlo guardado sería la misma mentira.
const superseded = acceptSaveResponse(
  saving,
  saving.inFlight.sequence,
  { ok: true, revision: 8, currentRevision: 11, created: false, replayed: true },
  edited.document,
);
eq("una repetición superada dice", superseded.state, "version_mas_reciente");
eq("y muestra la revisión que el almacén tiene ahora", superseded.storedRevision, 11);
eq("y NO adopta esa revisión como propia", superseded.revision, 7);
check(
  superseded.savedDocument === restored.savedDocument,
  "y no toca lo que la sesión creía almacenado",
);
check(
  hasUnsavedChanges(superseded, edited.document),
  "y el documento local sigue intacto y sin guardar",
);
// Y una repetición a la que NADIE se adelantó sí es un éxito.
const replayedCleanly = acceptSaveResponse(
  saving,
  saving.inFlight.sequence,
  { ok: true, revision: 8, currentRevision: 8, created: false, replayed: true },
  edited.document,
);
eq("una repetición no superada sí dice", replayedCleanly.state, "guardado");
eq("en la revisión que produjo el intento original", replayedCleanly.revision, 8);

const refusedByDocument = acceptSaveResponse(
  saving,
  saving.inFlight.sequence,
  { ok: false, reason: "document_refused", detail: "No es válido.", issues: [{ code: "malformed_document", path: "$" }] },
  edited.document,
);
check(
  retryAttempt(refusedByDocument) === null,
  "un rechazo que causó el documento NO ofrece reintento: repetirlo daría exactamente el mismo rechazo",
);
check(
  refusedByDocument.issues?.length === 1,
  "y sí lleva los códigos tipados para que alguien pueda revisarlo",
);

const dismissed = dismissSaveFailure(timedOut);
eq("descartar el aviso devuelve a", dismissed.state, "cambios_sin_guardar");
check(hasUnsavedChanges(dismissed, edited.document), "y el trabajo sigue exactamente donde estaba");

/* -------------------------------------------------------------------------- */

console.log("\n[9] Un conflicto conserva el documento local y no se resuelve escribiendo");

const conflicted = acceptSaveResponse(
  saving,
  saving.inFlight.sequence,
  { ok: false, reason: "conflict", detail: "Hay una versión más reciente.", storedRevision: 12 },
  edited.document,
);
eq("un conflicto dice", conflicted.state, "version_mas_reciente");
eq("y muestra qué revisión hay almacenada", conflicted.storedRevision, 12);
eq(
  "pero NO adopta esa revisión como propia: guardar contra ella sobrescribiría lo nuevo",
  conflicted.revision,
  7,
);
check(
  conflicted.savedDocument === restored.savedDocument,
  "y no cambia lo que la sesión creía almacenado",
);
check(hasUnsavedChanges(conflicted, edited.document), "el documento local sigue intacto y sin guardar");
check(!canSave(conflicted, edited.document), "y NO se puede guardar desde un conflicto");
check(!autosaveIsDue(conflicted, edited.document), "ni el autoguardado puede hacerlo por su cuenta");
check(retryAttempt(conflicted) === null, "y no hay reintento que ofrecer");
eq(
  "descartar el aviso no saca de un conflicto",
  dismissSaveFailure(conflicted).state,
  "version_mas_reciente",
);

// Y una edición no borra el aviso: sigue habiendo una versión más reciente.
eq(
  "seguir escribiendo no hace desaparecer el conflicto",
  documentChanged(conflicted, kept.document).state,
  "version_mas_reciente",
);
eq(
  "ni hace desaparecer un fallo",
  documentChanged(timedOut, kept.document).state,
  "no_pudimos_guardar",
);

// LA ÚNICA SALIDA ES DELIBERADA, Y ES REVERSIBLE.
const storedVersion = renamePage(editorState, "pagina-uno", "La del almacén").document;
const adopted = adoptStoredVersion(conflicted, storedVersion, 12);
eq("adoptar la versión almacenada devuelve a", adopted.state, "sin_cambios");
eq("con la revisión del almacén", adopted.revision, 12);
check(!hasUnsavedChanges(adopted, storedVersion), "y sin cambios pendientes");

const afterAdopt = adoptDocument(edited, storedVersion);
eq("y en el editor la adopción es un paso deshacible", afterAdopt.document, storedVersion);
eq(
  "que devuelve el trabajo local si alguien se arrepiente",
  undo(afterAdopt).document,
  edited.document,
);

/* -------------------------------------------------------------------------- */

console.log("\n[10] El autoguardado no dispara cuando no debe");

check(autosaveIsDue(dirty, edited.document), "el autoguardado corresponde cuando hay cambios sin guardar");
check(!autosaveIsDue(saving, edited.document), "y no mientras uno está en vuelo");
check(!autosaveIsDue(conflicted, edited.document), "ni en un conflicto");
check(
  !autosaveIsDue(timedOut, edited.document),
  "ni tras un fallo: un temporizador que reintenta solo convierte un rechazo en cien",
);
check(!autosaveIsDue(saved, edited.document), "ni cuando no hay nada que guardar");
check(
  canSave(timedOut, edited.document),
  "pero «Guardar ahora» sí sigue disponible tras un fallo — el reintento es de la persona",
);

// UNA CLAVE MAL FORMADA SE NIEGA ANTES DE SALIR, no se convierte en un fallo de
// guardado que nunca se intentó.
// Y NO SE INICIA UN SEGUNDO GUARDADO MIENTRAS UNO VIAJA. La pantalla ya lo
// impide con un botón deshabilitado, pero una regla así no puede vivir sólo en
// un atributo: dos intentos en vuelo harían que la respuesta del más viejo se
// descartara aunque su escritura sí hubiera movido la revisión, y la sesión
// quedaría por detrás del almacén y tomaría un conflicto que nadie causó.
check(
  beginSave(saving, edited.document, "clave-de-guardado-9") === saving,
  "un segundo guardado sobre uno en vuelo no empieza, y devuelve la MISMA sesión por identidad",
);

const badKey = beginSave(dirty, edited.document, "corta");
eq("una clave de idempotencia mal formada no se envía", badKey.state, "no_pudimos_guardar");
check(badKey.inFlight === null, "y no queda ningún intento en vuelo");

/* -------------------------------------------------------------------------- */

console.log("\n[11] Los seis estados existen y se llaman por su nombre");

const EXPECTED_LABELS = {
  sin_cambios: "Sin cambios",
  guardando: "Guardando…",
  guardado: "Guardado",
  cambios_sin_guardar: "Cambios sin guardar",
  no_pudimos_guardar: "No pudimos guardar",
  version_mas_reciente: "Hay una versión más reciente",
};
eq(
  "el módulo declara exactamente seis estados",
  Object.keys(SAVE_STATE_LABEL).length,
  Object.keys(EXPECTED_LABELS).length,
);
for (const [state, label] of Object.entries(EXPECTED_LABELS)) {
  eq(`«${state}»`, SAVE_STATE_LABEL[state], label);
}

/* -------------------------------------------------------------------------- */

console.log("\n[12] Nada de lo que esta unidad añadió cruza al navegador");

const readSource = (path) => {
  try {
    return readFileSync(join(...path.split("/")), "utf8");
  } catch {
    return "";
  }
};
const stripComments = (code) =>
  code.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/.*$/gm, "$1 ");

// EL VERIFICADOR HOSPEDADO NO ESCRIBE, Y ESTA ES LA COMPUERTA QUE LO AFIRMA.
//
// Su cabecera dice «no hay insert, update, upsert, delete ni rpc en este
// archivo, y una compuerta afuera lo comprueba». Eso no era cierto: ninguna lo
// comprobaba. Un archivo que contacta el proyecto hospedado y promete no
// escribir es exactamente el archivo cuya promesa tiene que estar comprobada.
{
  const hosted = readSource("scripts/canonical-presentation-hosted-fingerprint.mjs");
  check(hosted.length > 0, "el verificador hospedado de sólo lectura existe");
  const code = stripComments(hosted);
  const writers = [".insert(", ".upsert(", ".delete(", ".rpc(", ".remove("].filter((writer) =>
    code.includes(writer),
  );
  check(
    writers.length === 0,
    `y no inserta, actualiza por upsert, borra ni llama a ningún RPC${writers.length ? `: ${writers.join(", ")}` : ""}`,
  );
  // `.update(` NECESITA UN OJO MÁS FINO, y la primera versión de esta
  // comprobación no lo tenía: contaba `createHash("sha256").update(bytes)` como
  // una escritura en la base. Una compuerta que no distingue un digest de un
  // UPDATE es una compuerta que obliga a escribir el código peor para pasarla.
  const updates = [...code.matchAll(/\.update\(/g)].map((m) => m.index ?? 0);
  const hashUpdates = updates.filter((at) => /createHash\([^)]*\)\s*$/.test(code.slice(Math.max(0, at - 40), at)));
  check(
    updates.length === hashUpdates.length,
    `y cada .update( que contiene es el de un digest, no el de una tabla (${hashUpdates.length} de ${updates.length})`,
  );
  check(
    /\.select\(/.test(code),
    "y sí lee, así que la ausencia de escrituras no es la ausencia de todo",
  );
}

const sessionSource = readSource("src/lib/composer/save-session.ts");
const payloadSource = readSource("src/lib/composer/payload.ts");
const uiSource = readSource("src/components/studio/composer/ComposerWorkspace.tsx");
check(sessionSource.length > 0 && payloadSource.length > 0 && uiSource.length > 0, "los módulos existen");

// Ninguno de los tres puede alcanzar el canónico, el cálculo ni una credencial.
for (const [label, source] of [
  ["la sesión de guardado", sessionSource],
  ["los tipos del pago", payloadSource],
  ["la superficie", uiSource],
]) {
  const code = stripComments(source);
  for (const forbidden of [
    "canonical-source",
    "lib/calc",
    "SUPABASE_SERVICE_ROLE_KEY",
    "createAdminClient",
    "server-only",
    "CanonicalAddress",
    "RegistrySource",
  ]) {
    check(!code.includes(forbidden), `${label} no alcanza «${forbidden}»`);
  }
}

// Y LA SESIÓN DE GUARDADO ES PURA: sin reloj, sin azar, sin transporte. Es lo
// que permite que todo lo anterior se pruebe llamando funciones.
for (const impurity of ["fetch(", "Date.now(", "Math.random(", "setTimeout(", "crypto.", "process."]) {
  check(!stripComments(sessionSource).includes(impurity), `la sesión de guardado no usa «${impurity}»`);
}

// EL SOBRE NO LLEVA NADA DE UNA PERSONA.
//
// SOBRE UN DOCUMENTO QUE DIBUJA DE VERDAD, y esto es la corrección de una
// comprobación que no podía fallar. Se hacía sobre el documento mínimo de
// arriba, cuya única página no tiene ni un bloque: unos bytes sin una sola
// referencia a un resultado no pueden filtrar la clave de un resultado, así que
// buscar en ellos «quant_response» era buscar en un sobre vacío.
//
// Ahora se construye el plano genérico sobre el MISMO registro que el resto de
// esta compuerta — veintitantos bloques que nombran resultados reales por
// handle — y se escanean los bytes que la columna guardaría de ÉL.
const drawing = bindPresentationDocument(
  validatePresentationDocument(
    JSON.parse(
      serializeDeterministic(
        buildGenericStartingBlueprint(registry, {
          drawableFor: offeredChartVariants,
          drawableForRoutes: JOURNEY_ROUTES_VARIANTS,
          title: "Documento con bloques",
        }),
      ),
    ),
  ).value,
  registry,
);
const drawingEncoded = encodePresentationForStorage(drawing, { tenantId: TENANT, studyId: STUDY });
check(drawingEncoded.ok, "un documento con bloques reales se codifica para almacenamiento");
const blockCount = drawing.pages.reduce((total, page) => total + page.blocks.length, 0);
check(
  blockCount > 0,
  `y ese documento dibuja ${blockCount} bloque(s), así que el escaneo de abajo tiene algo que escanear`,
);
const storedText = drawingEncoded.ok
  ? serializeDeterministic(drawingEncoded.value.definition)
  : serializeDeterministic(encoded.value.definition);
for (const forbidden of [
  "respondent",
  "person_private",
  "quant_response",
  "qual_observation",
  "survey_response",
  "participant_attribute_value",
  "service_role",
  "sha256:",
]) {
  check(!storedText.includes(forbidden), `los bytes almacenados no contienen «${forbidden}»`);
}
// Ni una dirección canónica: cada una es una posición de arreglo, y una posición
// guardada en un documento es un número que alguien podría dereferenciar.
check(
  !/"(section|index|row|column)":\s*\d+/.test(storedText.replace(/"order":\s*\d+/g, "")),
  "ni una dirección canónica disfrazada de posición",
);
// NI UNA CLAVE CANÓNICA. La gramática de los handles prohíbe el guión bajo
// precisamente porque toda clave canónica es `snake_case`; un documento con
// bloques es el único que puede llevar una, así que es aquí donde se comprueba.
{
  // Un handle es una CADENA, guardada bajo `binding`. La huella del documento
  // vive bajo la misma clave y es 64 hex, así que se excluye por su forma.
  const handles = [...storedText.matchAll(/"binding":"([^"]+)"/g)]
    .map((m) => m[1])
    .filter((value) => !/^[0-9a-f]{64}$/.test(value));
  const snake = handles.filter((handle) => /[a-z0-9]_[a-z0-9]/.test(handle.split(":").pop() ?? ""));
  check(handles.length > 0, `el documento almacenado lleva ${handles.length} handle(s) de bloque`);
  check(
    snake.length === 0,
    `y ninguno es una clave canónica disfrazada${snake.length ? `: ${snake.slice(0, 3).join(", ")}` : ""}`,
  );
}
// El alcance SÍ está, y sólo ahí: es lo único de base de datos que el sobre lleva.
check(storedText.includes(STUDY) && storedText.includes(TENANT), "el alcance se sella en el sobre");
check(
  !serializeDeterministic(decoded.ok ? decoded.value : {}).includes(STUDY),
  "y se retira al leer: lo que vuelve al editor no nombra ninguna base de datos",
);

/* -------------------------------------------------------------------------- */

console.log(`\n${"=".repeat(74)}`);
if (failures > 0) {
  console.log(`RESULTADO: ${failures} fallo(s). COMPUERTA BLOQUEADA.`);
  process.exit(1);
}
console.log(
  "RESULTADO: el sobre va y vuelve por jsonb sin perder un byte, una columna que contradice al " +
    "documento se rechaza, lo heredado se niega por su nombre, «Guardado» sólo se dice de lo que " +
    "está en pantalla, una respuesta vieja no marca trabajo nuevo, un fallo conserva el trabajo, " +
    "un conflicto no se resuelve escribiendo, el reintento repite la clave y nada de una persona " +
    "cruza al navegador. COMPUERTA APROBADA.",
);
