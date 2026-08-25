/**
 * P8.2 completion gate — the Studio workspace, its lifecycle and its safety.
 *
 * Deterministic and credentials-free. It proves the claims this unit makes that
 * a reviewer would otherwise have to take on trust:
 *
 *   1. every Studio route authorizes server-side before it reads anything, and
 *      every legacy `/admin/*` address still answers;
 *   2. "¿Qué necesita mi atención?" classifies real operational state and
 *      claims nothing the schema cannot prove;
 *   3. no ordinary Studio workflow asks for JSON, a canonical key or a stable
 *      identifier;
 *   4. the recorrido and theme pickers serialize exactly what the existing
 *      contracts store, and preserve a stored value the data no longer offers;
 *   5. publication is reachable only through the client preview, and the server
 *      enforces that independently;
 *   6. paging and filters are bounded, validated and scoped;
 *   7. the destructive dialog names object, consequence, reversibility and
 *      recovery, and no P8.2-owned `window.confirm()` survives;
 *   8. suspend/restore and archive/restore are enforced at a real boundary;
 *   9. permanent CLIENT deletion is disabled and refused server-side, and no
 *      path through it reaches a row, an identity or a stored file;
 *  10. irreversible USER deletion cannot run without durable evidence written
 *      first, and reversible lifecycle mutations undo themselves rather than
 *      succeeding unrecorded;
 *  11. migration 0015 is additive, least-privileged, RLS-covered, size-bounded
 *      and reversible, and the stored-object inventory is paged and honest.
 *
 * Behaviour is asserted against the real modules. Source assertions are used
 * only where the claim IS about the source — "this route exists", "this control
 * no longer exists".
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  attentionForStudy,
  rankAttention,
  ATTENTION_KIND,
} from "../src/lib/studio/attention-model.ts";
import {
  clientUserAccess,
  exactNameMatches,
  EMPTY_TENANT_IMPACT,
  impactDifferences,
  impactIsUnchanged,
  isSuspended,
  nameConfirmationRefusal,
  parseImpact,
  serializeImpact,
  SUSPENSION_DURATION,
  SUSPENSION_LIFTED,
  tenantLifecycle,
  AUDIT_DETAILS_DB_LIMIT_BYTES,
  boundedDetails,
  encodedSize,
  MAX_DETAIL_BYTES,
  STORAGE_INVENTORY_CEILING,
} from "../src/lib/studio/lifecycle-model.ts";
import {
  DEFAULT_PAGE_SIZE,
  MAX_PAGE,
  PAGE_SIZES,
  pageCaption,
  pageHref,
  parseChoice,
  parsePage,
  parsePageRequest,
  parsePageSize,
  resolvePage,
} from "../src/lib/studio/paging.ts";
import {
  historicalStageMetrics,
  journeyMetricOptions,
  optionsForStage,
  stageConsequence,
  stageDraftRefusal,
  stageIdFromLabel,
  toStageDrafts,
} from "../src/lib/studio/journey-picker.ts";
import {
  mergeConsequence,
  newThemeRefusal,
  themeKeyFromLabel,
  themeLabel,
  themeOptions,
} from "../src/lib/studio/theme-picker.ts";
import { studyReadiness } from "../src/lib/studio/readiness.ts";
import { ADMIN_ALIASES, safeReturnPath, studioStudyPublish } from "../src/lib/studio/routes.ts";
import { journeyDefinitionSchema } from "../src/lib/calc/journey.ts";
import { normalizeTheme } from "../src/lib/qualitative/suggest.ts";

let checks = 0;
const ok = (message) => { checks += 1; console.log(`  PASS  ${message}`); };

/** Source with comments removed: a header explaining a retired control must
 *  never satisfy — or fail — an assertion about the control itself. */
const codeOf = (source) =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const readCode = async (path) =>
  codeOf(await readFile(new URL(`../${path}`, import.meta.url), "utf8"));
const readRaw = async (path) =>
  readFile(new URL(`../${path}`, import.meta.url), "utf8");

// ---------------------------------------------------------------------------
// 1. Every Studio route authorizes first, and every legacy address survives
// ---------------------------------------------------------------------------

console.log("\n[1] Studio routes authorize before reading, and the old addresses still answer");

const STUDIO_ROUTES = [
  "src/app/studio/page.tsx",
  "src/app/studio/clientes/page.tsx",
  "src/app/studio/clientes/[tenantId]/page.tsx",
  "src/app/studio/estudios/page.tsx",
  "src/app/studio/plantillas/page.tsx",
  "src/app/studio/e/[studyId]/page.tsx",
  "src/app/studio/e/[studyId]/datos/page.tsx",
  "src/app/studio/e/[studyId]/indicadores/page.tsx",
  "src/app/studio/e/[studyId]/cualitativo/page.tsx",
  "src/app/studio/e/[studyId]/vista-cliente/page.tsx",
  "src/app/studio/e/[studyId]/publicar/page.tsx",
];

for (const route of STUDIO_ROUTES) {
  const source = await readCode(route);
  assert.match(source, /await requireInternal\(\)/, `${route} must run the internal gate`);
  // Nothing may be read before the gate answers.
  const gate = source.indexOf("await requireInternal()");
  for (const reader of ["admin.from(", "loadStudioStudy(", "loadAttentionBoard("]) {
    const at = source.indexOf(reader);
    if (at >= 0) assert.ok(gate < at, `${route} must authorize before ${reader}`);
  }
  assert.doesNotMatch(source, /history\.back|router\.back/, `${route} must not use browser history`);
}
ok(`${STUDIO_ROUTES.length} Studio routes each authorize server-side before reading anything`);

const guard = await readCode("src/lib/studio/guard.ts");
assert.match(guard, /auth\.getUser\(\)/, "the gate verifies the JWT with the Auth server");
assert.doesNotMatch(guard, /getSession\(/, "the gate never decides authorization from a decoded cookie");
assert.match(guard, /redirect\("\/dashboard"\)/, "a wrong-role caller is redirected, so the denial has a status");
assert.ok(
  guard.indexOf('profile?.role !== "internal"') < guard.indexOf("createAdminClient()"),
  "the privileged client is created only after the role check",
);
ok("the shared gate uses getUser, reads the role from the database, and redirects rather than rendering a denial");

// The legacy addresses are not merely still in the tree — they are recorded as
// aliases, and the routes that serve them still exist.
const LEGACY_ROUTES = [
  "src/app/dashboard/page.tsx",
  "src/app/admin/clients/page.tsx",
  "src/app/admin/studies/page.tsx",
  "src/app/admin/qualitative/page.tsx",
  "src/app/admin/upload/page.tsx",
  "src/app/admin/preview/[studyId]/page.tsx",
];
for (const route of LEGACY_ROUTES) {
  const source = await readCode(route);
  assert.ok(source.length > 0, `${route} must still exist`);
  assert.match(
    source,
    /role !== "internal"|requireInternal|profile\?\.role === "internal"/,
    `${route} must keep its own role check`,
  );
}
assert.ok(ADMIN_ALIASES.length >= 4, "the Studio/legacy pairing must be recorded, not implied");
for (const alias of ADMIN_ALIASES) {
  assert.ok(alias.studio.startsWith("/studio") || alias.studio === "/studio");
  assert.ok(alias.admin.startsWith("/admin") || alias.admin === "/dashboard");
}
ok(`${LEGACY_ROUTES.length} legacy addresses still answer and ${ADMIN_ALIASES.length} aliases are recorded`);

// The return path is an allowlist over whole strings, never a pattern.
assert.equal(safeReturnPath("/studio/clientes", ["/studio/clientes"], "/admin/clients"), "/studio/clientes");
assert.equal(safeReturnPath("https://evil.example/x", ["/studio/clientes"], "/admin/clients"), "/admin/clients");
assert.equal(safeReturnPath("//evil.example", ["/studio/clientes"], "/admin/clients"), "/admin/clients");
assert.equal(safeReturnPath("/studio/clientes/../../x", ["/studio/clientes"], "/admin/clients"), "/admin/clients");
assert.equal(safeReturnPath(undefined, ["/studio/clientes"], "/admin/clients"), "/admin/clients");
ok("a submitted return path is honoured only when it equals an allowlisted path, never because it looks like one");

// ---------------------------------------------------------------------------
// 2. The attention board classifies real state and claims nothing else
// ---------------------------------------------------------------------------

console.log("\n[2] “¿Qué necesita mi atención?” is built from provable state");

const baseFacts = {
  studyId: "s1",
  studyName: "Satisfacción 2026",
  clientName: "Colegio Norte",
  period: "Ola 1",
  status: "draft",
  clientArchived: false,
  quantResponses: 0,
  confirmedObservations: 0,
  pendingObservations: 0,
  unfinishedImports: 0,
  stagesWithoutResult: 0,
  totalStages: 0,
};
const href = (kind, studyId) => `/x/${kind}/${studyId}`;

const empty = attentionForStudy(baseFacts, href);
assert.deepEqual(empty.map((item) => item.kind), ["sin-datos"]);
// A study with no data says ONE thing. Every other item would be a consequence
// of that one, and listing them would turn one problem into four.
assert.equal(
  attentionForStudy({ ...baseFacts, pendingObservations: 4, stagesWithoutResult: 2, totalStages: 3 }, href).length,
  1,
  "a study with no data reports only that",
);
ok("an empty study produces exactly one item, not a cascade of consequences");

const busy = attentionForStudy(
  { ...baseFacts, quantResponses: 80, pendingObservations: 3, totalStages: 4, stagesWithoutResult: 1, unfinishedImports: 1 },
  href,
);
assert.deepEqual(busy.map((item) => item.kind), [
  "carga-sin-terminar",
  "cualitativo-pendiente",
  "recorrido-incompleto",
  "sin-publicar",
]);
for (const item of busy) {
  assert.ok(item.headline.length > 0 && item.detail.length > 0, "every item says what and why");
  assert.equal(item.href, href(item.kind, "s1"), "every item leads to where the work is resolved");
  assert.ok(item.accent.fill.startsWith("var(--color-"), "colour comes from the token layer");
}
ok("a working study reports each distinct pending thing, each with a destination");

// A published study with everything resolved produces nothing at all.
assert.deepEqual(
  attentionForStudy({ ...baseFacts, status: "published", quantResponses: 40, totalStages: 2 }, href),
  [],
);
ok("a finished, published study produces no item — the home does not invent work");

// An archived client changes what the publication item SAYS, and never hides it.
const archived = attentionForStudy(
  { ...baseFacts, clientArchived: true, quantResponses: 10 },
  href,
).find((item) => item.kind === "sin-publicar");
assert.match(archived.detail, /archivado/, "an archived client is named as the reason, not hidden");
ok("an archived client is stated as the reason publication is blocked");

const many = Array.from({ length: 20 }, (_, index) =>
  attentionForStudy({ ...baseFacts, studyId: `s${index}`, studyName: `Estudio ${index}` }, href)).flat();
const ranked = rankAttention(many, 8);
assert.equal(ranked.shown.length, 8);
assert.equal(ranked.hidden, 12, "what is left out is counted, never silently dropped");
const ranks = ranked.shown.map((item) => ATTENTION_KIND[item.kind].rank);
assert.deepEqual(ranks, [...ranks].sort((a, b) => a - b), "the list is ordered by how much the work is blocked");
ok("the board is bounded, ordered by blocking-ness, and states how many it left out");

// ---------------------------------------------------------------------------
// 3. No ordinary Studio workflow asks for a structure or an identifier
// ---------------------------------------------------------------------------

console.log("\n[3] No JSON, no canonical key and no stable identifier is ever typed");

const STUDIO_UI = [
  ...STUDIO_ROUTES,
  "src/components/studio/JourneyStagesFields.tsx",
  "src/components/studio/QualitativeReview.tsx",
  "src/components/studio/QualitativeWorkspaceView.tsx",
  "src/components/studio/ClientPeopleList.tsx",
  "src/components/studio/ClientLifecyclePanel.tsx",
  "src/components/studio/ConfirmAction.tsx",
  "src/components/studio/StudioHomeView.tsx",
  "src/components/studio/StudyTabs.tsx",
  "src/components/studio/StudyWorkSurface.tsx",
  "src/app/admin/studies/StudyConfigurator.tsx",
];
for (const file of STUDIO_UI) {
  const source = await readCode(file);
  assert.doesNotMatch(source, /JSON\.stringify/, `${file} must not render a serialized object`);
  assert.doesNotMatch(source, /dangerouslySetInnerHTML/, `${file} must not bypass React escaping`);
  assert.doesNotMatch(source, /min-w-\[900px\]/, `${file} must reflow rather than force a wide table`);
  assert.doesNotMatch(source, /placeholder="metric_key"/, `${file} must not ask for a canonical metric key`);
}
ok(`${STUDIO_UI.length} Studio surfaces render no serialized object and force no wide table`);

const configurator = await readCode("src/app/admin/studies/StudyConfigurator.tsx");
// The three raw stage inputs are gone: the identifier is hidden, the metric is
// a select over real results, and only the human-readable name is typed.
assert.doesNotMatch(configurator, /name="stage_id" required/, "the stage identifier is no longer typed");
assert.doesNotMatch(configurator, /name="stage_metric"[\s\S]{0,200}font-mono/, "the metric is no longer a monospace box");
const stageFields = await readCode("src/components/studio/JourneyStagesFields.tsx");
assert.match(stageFields, /<input type="hidden" name="stage_id"/, "the identifier travels hidden");
assert.match(stageFields, /<select[\s\S]{0,400}name="stage_metric"/, "the metric is chosen from a list");
ok("the recorrido asks for a name and a choice, never an identifier or a key");

const review = await readCode("src/components/studio/QualitativeReview.tsx");
assert.match(review, /<input type="hidden" name="theme"/, "the theme travels as the unchanged stored field");
assert.doesNotMatch(
  review,
  /<input[^>]*name="theme"[^>]*placeholder/,
  "the free-text theme box that fragmented themes is gone",
);
ok("the theme is chosen or deliberately created, never retyped into a free-text box");

// ---------------------------------------------------------------------------
// 4. The two remaining picker uses store exactly what the contracts store
// ---------------------------------------------------------------------------

console.log("\n[4] The recorrido picker offers real results and preserves a stored one that vanished");

const rows = [
  { respondent_id: "r1", metric_key: "nps", value: 10 },
  { respondent_id: "r2", metric_key: "nps", value: 4 },
  { respondent_id: "r1", metric_key: "sat_general", value: 4 },
  { respondent_id: "r2", metric_key: "sat_general", value: 5 },
];
const options = journeyMetricOptions(rows);
assert.deepEqual(options.map((option) => option.key), ["nps", "sat_general"]);
assert.equal(options.every((option) => option.available), true);
assert.match(options[0].name, /Recomendación/, "a result is named, never printed as its key");
assert.ok(options[0].today !== null, "each option says what it says today");
assert.equal(journeyMetricOptions([]).length, 0, "a study with no data offers nothing to choose");
ok("the picker offers exactly the results this study produced, named and previewed");

const stored = [{ id: "confianza", label: "Confianza", metric: "sat_retirada" }];
const withHistorical = optionsForStage(options, "sat_retirada");
assert.equal(withHistorical.length, options.length + 1);
const historicalOption = withHistorical.find((option) => option.key === "sat_retirada");
assert.equal(historicalOption.available, false, "a stored metric the data lost is kept and marked");
assert.match(stageConsequence(historicalOption), /se guardó antes/i, "and the consequence says so in words");
assert.deepEqual(
  historicalStageMetrics(stored, options).map((entry) => entry.metric),
  ["sat_retirada"],
  "the study surface can name every stage pointing at a vanished result",
);
// The option list for a metric that IS available must not be widened.
assert.equal(optionsForStage(options, "nps").length, options.length);
ok("a stored metric the data no longer produces is preserved, marked and reported — never dropped or repointed");

// The identifier is generated once and then frozen.
const id1 = stageIdFromLabel("Primer contacto", [], 1);
assert.equal(id1, "primer_contacto");
assert.equal(stageIdFromLabel("Primer contacto", [id1], 2), "primer_contacto_2", "a collision is suffixed, never reused");
assert.equal(stageIdFromLabel("", [], 3), "momento_3", "an unnameable label still yields a valid identifier");
assert.equal(stageIdFromLabel("2026", [], 4), "momento_4", "an identifier must start with a letter");
for (const candidate of [id1, stageIdFromLabel("Atención y Servicio", [], 1), stageIdFromLabel("", [], 9)]) {
  assert.ok(/^[a-z][a-z0-9_-]*$/.test(candidate), `${candidate} must satisfy the stored schema`);
  assert.ok(candidate.length <= 64);
}
ok("generated stage identifiers always satisfy the unchanged stored schema");

// What the fields submit must survive the unchanged Server Action schema.
const drafts = toStageDrafts([
  { id: "primer_contacto", label: "Primer contacto", metric: "nps", description: "" },
  { id: "confianza", label: "Confianza", metric: "sat_general" },
]);
const parsed = journeyDefinitionSchema.safeParse({
  stages: drafts.map((draft) => ({
    id: draft.id,
    label: draft.label,
    metric: draft.metric,
    description: draft.description || undefined,
  })),
});
assert.equal(parsed.success, true, "the picker's output is exactly what the existing schema accepts");
assert.equal(stageDraftRefusal(drafts), null);
assert.match(stageDraftRefusal([{ ...drafts[0], metric: "" }]), /Elige qué resultado/);
assert.match(stageDraftRefusal([{ ...drafts[0], label: " " }]), /necesita un nombre/);
assert.match(stageDraftRefusal([drafts[0], drafts[0]]), /mismo identificador/);
ok("an incomplete or duplicated recorrido is refused before it is submitted, in words");

console.log("\n[5] The theme picker merges over what exists and refuses an accidental duplicate");

const observations = [
  { theme: "comunicacion", suggested_theme: "comunicacion", confirmed_theme: "comunicacion", review_status: "confirmed" },
  { theme: null, suggested_theme: "docentes", confirmed_theme: null, review_status: "pending" },
  { theme: "Atención y servicio", suggested_theme: null, confirmed_theme: null, review_status: "pending" },
];
const themes = themeOptions(observations);
assert.deepEqual(themes.map((option) => option.key), ["comunicacion", "atencion_y_servicio", "docentes"]);
assert.equal(themes[0].confirmed, 1, "a confirmed theme is counted as confirmed");
assert.equal(themes[0].label, "Comunicacion", "a stored key reads as words");
assert.equal(themeLabel("atencion_y_servicio"), "Atencion y servicio");
ok("the picker offers the themes this study already carries, ordered by how established they are");

assert.equal(themeKeyFromLabel("Comunicación con las familias"), "comunicacion_con_las_familias");
assert.equal(normalizeTheme("Comunicación con las familias"), themeKeyFromLabel("Comunicación con las familias"),
  "what the operator is shown is exactly what the server will store");
assert.equal(themeKeyFromLabel("   "), null);
assert.equal(themeKeyFromLabel("2026"), null, "a theme key must start with a letter");
assert.match(newThemeRefusal("Comunicacion", themes), /ya existe/i, "a collision is reported, never resolved");
assert.match(newThemeRefusal("Comunicación", themes), /ya existe/i, "and accents cannot smuggle a duplicate past it");
assert.equal(newThemeRefusal("Transporte escolar", themes), null);
assert.match(newThemeRefusal("", themes), /Escribe/);
ok("creating a theme that already exists is refused by name, so one theme cannot become three");

assert.match(mergeConsequence(3, themes[0], false), /se unirán a la que ya estaba confirmada/i);
assert.match(mergeConsequence(3, { key: "c", label: "C", confirmed: 12 }, false), /se unirán a las 12 ya confirmadas/i);
assert.match(mergeConsequence(1, { key: "c", label: "C", confirmed: 0 }, false), /todavía no tiene ninguna observación confirmada/i);
assert.match(mergeConsequence(3, { key: "nuevo", label: "Nuevo", confirmed: 0 }, true), /tema nuevo/i);
assert.match(mergeConsequence(0, themes[0], false), /Marca las observaciones/);
assert.match(mergeConsequence(2, null, false), /Elige el tema/);
ok("the merge states what will happen to how many, before it happens");

// ---------------------------------------------------------------------------
// 6. Publication is reachable only through the preview
// ---------------------------------------------------------------------------

console.log("\n[6] Publication is reached through the preview, and the server enforces it");

const publishPage = await readCode("src/app/studio/e/[studyId]/publicar/page.tsx");
const studyActions = await readCode("src/app/admin/studies/actions.ts");
assert.match(publishPage, /studioStudyPreview\(study\.id\)/, "the publication surface leads back to the preview");
assert.match(publishPage, /acknowledgement=/, "publishing requires an explicit acknowledgement");
assert.match(studyActions, /formData\.get\("acknowledged"\) !== "on"/, "and the SERVER refuses one without it");
assert.match(studyActions, /Carga respuestas o confirma hallazgos antes de publicar/, "the empty-study rule is unchanged");
assert.match(studyActions, /tenantRefusesNewWork\(admin, study\.tenant_id\)/, "an archived client cannot receive a publication");
assert.match(studyActions, /status\.data !== current\.status/, "the configuration action cannot move the state");
assert.equal(studioStudyPublish("abc"), "/studio/e/abc/publicar");
for (const route of ["src/app/admin/preview/[studyId]/page.tsx", "src/app/studio/e/[studyId]/vista-cliente/page.tsx"]) {
  const source = await readCode(route);
  assert.match(source, /studioStudyPublish\(studyId\)/, `${route} is the doorway to publication`);
}
// No other surface offers a status control.
for (const file of ["src/app/admin/studies/StudyConfigurator.tsx", "src/app/studio/e/[studyId]/indicadores/page.tsx"]) {
  const source = await readCode(file);
  assert.doesNotMatch(source, /<select[\s\S]{0,200}name="status"/, `${file} must not offer a publication control`);
  assert.match(source, /type="hidden" name="status"/, `${file} carries the current state and cannot change it`);
}
ok("publication has exactly one surface, it is reached from the preview, and the server re-checks every condition");

// ---------------------------------------------------------------------------
// 7. Paging and filters are bounded, validated and scoped
// ---------------------------------------------------------------------------

console.log("\n[7] Paging and filters are bounded, validated server-side and scoped");

assert.equal(parsePage("3"), 3);
for (const hostile of ["0", "-1", "1.5", "abc", "", null, undefined, "999999999", "1e9", " 2 ", ["4"]]) {
  const value = parsePage(hostile);
  assert.ok(Number.isInteger(value) && value >= 1 && value <= MAX_PAGE, `parsePage(${JSON.stringify(hostile)}) must stay bounded`);
}
assert.equal(parsePage("9999"), MAX_PAGE, "an enormous page is clamped, never passed through");
assert.equal(parsePageSize("50"), 50);
assert.equal(parsePageSize("1000"), DEFAULT_PAGE_SIZE, "a size outside the fixed list falls back to the default");
assert.equal(parsePageSize("all"), DEFAULT_PAGE_SIZE);
assert.ok(PAGE_SIZES.every((size) => size > 0 && size <= 100), "no page size can ask for an unbounded read");
assert.deepEqual(parsePageRequest({ p: "2", por: "50" }), { page: 2, size: 50 });
ok("a page number and a page size are always inside the range the server defined");

const view = resolvePage({ page: 3, size: 25 }, 60);
assert.deepEqual(
  [view.page, view.totalPages, view.from, view.to, view.firstItem, view.lastItem],
  [3, 3, 50, 74, 51, 60],
);
assert.equal(resolvePage({ page: 9, size: 25 }, 60).page, 3, "an out-of-range page lands on the last one, never on nothing");
assert.equal(resolvePage({ page: 1, size: 25 }, 0).total, 0);
assert.match(pageCaption(view, { one: "carga", many: "cargas" }), /51-60 de 60 cargas · página 3 de 3/);
assert.match(pageCaption(resolvePage({ page: 1, size: 25 }, 4), { one: "carga", many: "cargas" }), /^4 cargas$/);
assert.match(pageCaption(resolvePage({ page: 1, size: 25 }, 0), { one: "carga", many: "cargas" }), /^Sin cargas$/);
ok("every paged list states how many rows exist, so truncation can never be silent");

assert.equal(parseChoice("pending", ["pending", "confirmed"]), "pending");
assert.equal(parseChoice("../../etc", ["pending"]), null, "a value the server did not offer is refused");
assert.equal(parseChoice("", ["pending"]), null);
assert.equal(parseChoice(undefined, ["pending"]), null);
assert.equal(pageHref("/studio/estudios", { estado: "draft", cliente: null }, 2), "/studio/estudios?estado=draft&p=2");
assert.equal(pageHref("/studio/estudios", { estado: null }, 1), "/studio/estudios");
ok("a filter value is accepted only when the server itself offered it; a page link keeps the filters and nothing else");

// Every paged query scopes itself with an explicit `.eq()` rather than trusting
// a caller-supplied filter object.
const qualitativeWorkspace = await readCode("src/lib/studio/qualitative-workspace.ts");
assert.match(qualitativeWorkspace, /\.eq\("study_id", studyId\)/, "the review list is scoped to one study on the query");
assert.match(qualitativeWorkspace, /\.range\(view\.from, view\.to\)/, "and read as a bounded range");
assert.doesNotMatch(qualitativeWorkspace, /\.limit\(100\)/, "the silent 100-row truncation is gone");
const uploadPage = await readCode("src/app/admin/upload/page.tsx");
assert.match(uploadPage, /z\.string\(\)\.uuid\(\)\.safeParse\(raw\)/, "a scope parameter is a real id or nothing");
assert.match(uploadPage, /\.range\(historyWindow\.from, historyWindow\.to\)/, "the import history is a bounded range");
const studyData = await readCode("src/app/studio/e/[studyId]/datos/page.tsx");
assert.match(studyData, /\.eq\("study_id", study\.id\)/, "a study's own history is scoped to that study");
const clientPage = await readCode("src/app/studio/clientes/[tenantId]/page.tsx");
assert.match(clientPage, /\.eq\("tenant_id", tenantId\)[\s\S]{0,200}\.eq\("role", "client"\)/, "people are scoped to the client and the client role");
assert.doesNotMatch(clientPage, /listAllUsers/, "the per-client page no longer enumerates every Auth account");
ok("every paged read is scoped on the query itself, and the per-client list no longer enumerates the whole project");

// A bulk qualitative action can only ever reach rows the reviewer saw.
assert.match(review, /Las acciones se aplican solo a lo que marcaste en esta página/,
  "the review states that selection is page-scoped");
assert.doesNotMatch(review, /localStorage|sessionStorage/, "selection is never carried across pages behind the reviewer");
ok("bulk qualitative actions are page-scoped, and the interface says so");

// ---------------------------------------------------------------------------
// 8. The destructive dialog, and the end of window.confirm()
// ---------------------------------------------------------------------------

console.log("\n[8] One accessible dialog replaces every native destructive prompt");

const allSources = await Promise.all(
  [...STUDIO_UI, "src/app/admin/upload/UploadForm.tsx", "src/app/admin/clients/page.tsx",
   "src/app/admin/qualitative/page.tsx", "src/app/admin/studies/page.tsx"].map((file) => readCode(file)),
);
for (const source of allSources) {
  assert.doesNotMatch(source, /window\.confirm|window\.alert|window\.prompt/,
    "no P8.2-owned surface may guard an action with a native browser prompt");
}
ok("no Studio surface uses window.confirm, window.alert or window.prompt");

const dialog = await readCode("src/components/studio/ConfirmAction.tsx");
for (const [what, pattern] of [
  ["a dialog role", /role="dialog"/],
  ["a modal declaration", /aria-modal="true"/],
  ["an accessible name", /aria-labelledby=\{titleId\}/],
  ["an accessible description", /aria-describedby=\{bodyId\}/],
  ["escape to cancel", /event\.key === "Escape"/],
  ["a focus trap", /event\.key !== "Tab"/],
  ["focus entering the dialog", /\(first \?\? panel\)\?\.focus\(\)/],
  // Every dialog carries its action's fields as hidden inputs. If those counted
  // as focusable, the "first focusable" would be one of them, `focus()` would do
  // nothing, and focus would never enter the dialog.
  ["hidden fields excluded from the focus order", /input:not\(\[disabled\]\):not\(\[type="hidden"\]\)/],
  ["focus returning to the trigger", /triggerNode\?\.focus\(\)/],
  ["a cancel control", />\s*Cancelar\s*</],
  ["a pending state", /useFormStatus\(\)/],
  ["duplicate-submit prevention", /disabled=\{pending \|\| blocked\}/],
  ["a server-error slot", /role="alert"[\s\S]{0,120}\{error\}/],
  ["44px touch targets", /min-h-11/],
]) {
  assert.match(dialog, pattern, `the dialog must have ${what}`);
}
// Severity is honest, and only the permanent one can require typing.
assert.match(dialog, /reversible: "Se puede deshacer\."/);
assert.match(dialog, /permanent: "No se puede deshacer\."/);
assert.match(dialog, /SEVERITY_BOX[\s\S]{0,200}reversible: "border-line bg-surface-sunken/,
  "a reversible action must not be dressed as destruction");
assert.match(dialog, /permanent:[^"]*"inline-flex[^"]*bg-danger /,
  "only the permanent confirm control reads as danger");
assert.match(dialog, /severity === "permanent"[^"]*"inline-flex[^"]*border-danger-line/,
  "and only a permanent trigger carries the danger edge");
ok("the dialog is a real modal: labelled, described, escapable, focus-trapped, pending-aware and honest about severity");

// Every use names the object, the consequence, the reversibility and the way back.
for (const file of [
  "src/components/studio/ClientPeopleList.tsx",
  "src/components/studio/ClientLifecyclePanel.tsx",
  "src/app/studio/e/[studyId]/publicar/page.tsx",
  "src/app/studio/plantillas/page.tsx",
  "src/app/admin/upload/UploadForm.tsx",
]) {
  const source = await readCode(file);
  const uses = source.split("<ConfirmAction").length - 1;
  assert.ok(uses > 0, `${file} must use the dialog`);
  for (const required of ["objectName=", "consequence=", "severity=", "recovery=", "confirmLabel="]) {
    assert.ok(source.includes(required), `${file} must pass ${required} to every dialog`);
  }
}
ok("every dialog names the object, the consequence, the reversibility and the recovery path");

const uploadForm = await readCode("src/app/admin/upload/UploadForm.tsx");
assert.match(uploadForm, /severity="reversible"/, "reverting an import is presented as the reversible action it is");
assert.match(uploadForm, /rollbackLatestImport\(/, "and it still calls the unchanged Server Action");
assert.match(uploadForm, /latestCommittedId: string \| null/,
  "the revert control is offered only for the globally newest committed batch, resolved on the server");
ok("the import revert kept its contract and stopped looking like a deletion");

// The adversarial harness must describe the product as it is. Its rollback
// driver now opens the dialog and confirms inside it, exactly as an operator
// does, and its native-dialog handler no longer claims the product raises one.
const harnessBrowser = await readCode("scripts/lib/harness-browser.mjs");
assert.match(harnessBrowser, /clickByName\("Deshacer esta carga"\)/, "the driver opens the product's own dialog");
assert.match(harnessBrowser, /clickByName\("Sí, deshacer la carga"\)/, "and confirms inside it, with a second deliberate click");
assert.doesNotMatch(harnessBrowser, /clickByName\("Revertir último lote"\)/, "the retired control name is gone from the driver");
ok("the adversarial harness drives the real dialog rather than a control the product no longer has");

// ---------------------------------------------------------------------------
// 9. Suspension and archiving are enforced, reversible and visible
// ---------------------------------------------------------------------------

console.log("\n[9] Suspend/restore and archive/restore are enforced at a real boundary");

const now = new Date("2026-08-24T12:00:00Z");
assert.equal(isSuspended({ bannedUntil: "2030-01-01T00:00:00Z" }, now), true);
assert.equal(isSuspended({ bannedUntil: "2020-01-01T00:00:00Z" }, now), false, "an expired ban is not a suspension");
assert.equal(isSuspended({ bannedUntil: "none" }, now), false);
assert.equal(isSuspended({ bannedUntil: null }, now), false);
assert.equal(isSuspended({ bannedUntil: "not-a-date" }, now), false, "an unreadable value is not treated as a lockout");
assert.equal(isSuspended({}, now), false);
ok("suspension is read from the authentication boundary, and only a ban that is actually in force counts");

assert.equal(clientUserAccess({ emailConfirmedAt: "2026-01-01T00:00:00Z" }, now), "active");
assert.equal(clientUserAccess({ lastSignInAt: "2026-01-01T00:00:00Z" }, now), "active");
assert.equal(clientUserAccess({}, now), "invited", "an invitation nobody completed is its own state");
assert.equal(
  clientUserAccess({ bannedUntil: "2030-01-01T00:00:00Z", emailConfirmedAt: "2026-01-01T00:00:00Z" }, now),
  "suspended",
  "a suspended account never reads as active",
);
assert.equal(
  clientUserAccess({ bannedUntil: "2030-01-01T00:00:00Z" }, now),
  "suspended",
  "and an invited account that was suspended reads as suspended",
);
ok("invited, active and suspended are three distinct states that cannot disagree with what Auth does");

const clientActions = await readCode("src/app/admin/clients/actions.ts");
assert.match(clientActions, /ban_duration: SUSPENSION_DURATION/, "suspending bans the identity at the Auth server");
assert.match(clientActions, /ban_duration: SUSPENSION_LIFTED/, "restoring lifts exactly that ban");
assert.equal(SUSPENSION_LIFTED, "none");
assert.ok(/^\d+h$/.test(SUSPENSION_DURATION), "the suspension window is a real duration, not a magic string");
assert.match(clientActions, /profile\?\.role !== "client"/, "a lifecycle action may only ever touch a client account");
// `deleteTenant` is deliberately absent from this list: it no longer mutates
// anything, so there is nothing for it to audit. Section [10] proves that it
// refuses instead, which is a stronger statement than "it is audited".
for (const fn of ["suspendClientUser", "restoreClientUser", "archiveTenant", "restoreTenant", "deleteClientUser"]) {
  const at = clientActions.indexOf(`export async function ${fn}`);
  assert.ok(at > 0, `${fn} must exist`);
  const body = clientActions.slice(at, at + 3600);
  assert.match(body, /await internalContext\(\)/, `${fn} must prove an internal role on the server`);
  // Reversible mutations record through `recordOrUndo`, which writes the event
  // and reverses the change if the write fails. Section [12] proves that.
  assert.match(body, /recordOrUndo|recordLifecycleEvent/, `${fn} must leave administrative evidence`);
}
{
  const at = clientActions.indexOf("export async function deleteTenant");
  assert.match(
    clientActions.slice(at),
    /await internalContext\(\)/,
    "even the refused deletion proves an internal role before answering",
  );
}
ok("every lifecycle mutation proves an internal role, is confined to client accounts, and is audited");

assert.equal(tenantLifecycle(null), "active");
assert.equal(tenantLifecycle("2026-08-24T00:00:00Z"), "archived");
const lifecycle = await readCode("src/lib/studio/lifecycle.ts");
assert.match(lifecycle, /export async function tenantRefusesNewWork/, "archiving must be enforced, not merely displayed");
for (const [file, label] of [
  ["src/app/admin/studies/actions.ts", "a new study"],
  ["src/app/admin/clients/actions.ts", "a new invitation"],
]) {
  const source = await readCode(file);
  assert.match(source, /tenantRefusesNewWork\(/, `${label} must be refused for an archived client, on the server`);
}
ok("an archived client is refused new studies, new invitations and new publications at the server, not by a hidden button");

// ---------------------------------------------------------------------------
// 10. Permanent client deletion: disabled, and refused on the server
// ---------------------------------------------------------------------------

console.log("\n[10] Permanent client deletion is disabled, and refused by the server");

const lifecyclePanel = await readCode("src/components/studio/ClientLifecyclePanel.tsx");
const peopleList = await readCode("src/components/studio/ClientPeopleList.tsx");

// THE OPERATION IS GONE FROM THE ACTION, not merely from the interface.
const deleteAt = clientActions.indexOf("export async function deleteTenant");
assert.ok(deleteAt > 0, "the action must still exist so a bypassing caller gets a coherent refusal");
const deleteBody = clientActions.slice(deleteAt);
assert.match(deleteBody, /TENANT_DELETION_DISABLED_REASON/, "it refuses with the stated reason");
assert.match(deleteBody, /finish\("error", TENANT_DELETION_DISABLED_REASON/, "and it refuses as an error, always");
for (const [what, forbidden] of [
  ["a tenant row delete", /from\("tenant"\)\.delete\(\)/],
  ["an Auth account delete", /auth\.admin\.deleteUser/],
  ["a Storage removal", /storage\.from\([^)]*\)\.remove/],
  ["a storage inventory read", /listTenantStorageObjects/],
  ["an impact recount", /countTenantImpact/],
]) {
  assert.doesNotMatch(deleteBody, forbidden, `the disabled deletion must not reach ${what}`);
}
// Nothing anywhere in the client actions can reach the cascade any more.
assert.doesNotMatch(clientActions, /from\("tenant"\)\.delete\(\)/,
  "no client action deletes a tenant row");
assert.doesNotMatch(clientActions, /storage\.from\("tenant-branding"\)\.remove\(storagePaths\)/,
  "no client action bulk-removes a tenant's stored objects");
ok("permanent client deletion refuses on the server and no path through it reaches a row, an identity or a file");

// And it is not offered in the interface either — stated, not hidden.
assert.doesNotMatch(lifecyclePanel, /deleteTenant/, "the panel does not dispatch the disabled action");
assert.doesNotMatch(lifecyclePanel, /requireExactText=\{tenantName\}/,
  "there is no typed confirmation for an action that cannot run");
assert.match(lifecyclePanel, /TENANT_DELETION_DISABLED_REASON/, "the panel states why it is unavailable");
assert.match(lifecyclePanel, /no disponible/, "and says so in the heading a consultant reads");
// The analysis survives the execution being withdrawn.
assert.match(lifecyclePanel, /impactLines\(impact\)/, "the executable impact summary is still rendered");
assert.match(lifecyclePanel, /archiveTenant/, "archiving is still offered");
assert.match(lifecyclePanel, /restoreTenant/, "and so is restoring");
ok("the interface names the unavailability, keeps the impact summary and keeps archive and restore");

// The impact model itself stays executable and stays proved. It gates nothing
// destructive today; it is what the interface renders, and it is the part a
// recoverable deletion workflow will need unchanged when it arrives.
const shown = { ...EMPTY_TENANT_IMPACT, studies: 3, respondents: 120, quantResponses: 480 };
assert.equal(impactIsUnchanged(shown, { ...shown }), true);
assert.equal(impactIsUnchanged(shown, { ...shown, respondents: 121 }), false, "one changed count is a changed client");
assert.deepEqual(impactDifferences(shown, { ...shown, respondents: 121 }), ["personas que respondieron: 120 → 121"]);
assert.deepEqual(parseImpact(serializeImpact(shown)), shown, "the summary survives its own round trip");
assert.equal(parseImpact("nonsense"), null, "an unreadable summary is refused, never assumed");
assert.equal(parseImpact("studies:-1"), null);
assert.equal(parseImpact(serializeImpact(shown).replace("studies", "estudios")), null, "a renamed field is refused");
// Exact-name confirmation, still the model the interface and the account
// deletion both use.
assert.equal(exactNameMatches("Colegio Norte", "Colegio Norte"), true);
assert.equal(exactNameMatches("  Colegio   Norte  ", "Colegio Norte"), true, "transcription whitespace is forgiven");
assert.equal(exactNameMatches("colegio norte", "Colegio Norte"), false, "capitals are not");
assert.equal(exactNameMatches("Colegio Nort", "Colegio Norte"), false);
assert.equal(exactNameMatches("x", ""), false, "an empty target can never be matched");
assert.match(nameConfirmationRefusal("", "Colegio Norte"), /Escribe/);
assert.match(nameConfirmationRefusal("otra cosa", "Colegio Norte"), /no coincide/);
assert.equal(nameConfirmationRefusal("Colegio Norte", "Colegio Norte"), null);
ok("the impact summary and the exact-name rule remain executable and proved, gating nothing destructive");

console.log("\n[11] Irreversible user deletion cannot run without durable evidence first");

const userDeleteAt = clientActions.indexOf("export async function deleteClientUser");
const userDeleteBody = clientActions.slice(userDeleteAt, clientActions.indexOf("export async function", userDeleteAt + 10));
const intentAt = userDeleteBody.indexOf('action: "client_user_delete_started"');
const destroyAt = userDeleteBody.indexOf("auth.admin.deleteUser");
const outcomeAt = userDeleteBody.indexOf('action: "client_user_deleted"');
assert.ok(intentAt > 0, "an intent record must be written");
assert.ok(intentAt < destroyAt, "the intent record is written BEFORE the irreversible step");
assert.ok(destroyAt < outcomeAt, "and the outcome record after it");
assert.match(userDeleteBody, /if \(!intent\.recorded\) \{/, "a failed intent write stops the deletion");
assert.ok(
  userDeleteBody.indexOf("if (!intent.recorded)") < destroyAt,
  "and it stops it BEFORE anything is destroyed",
);
// The final message may never claim a completion the evidence does not support.
assert.match(userDeleteBody, /outcome\.recorded \? "ok" : "error"/,
  "an unrecorded outcome is reported as an error, not as a clean success");
assert.match(userDeleteBody, /figura como iniciada sin desenlace/,
  "and the message says exactly what the record will show");
assert.doesNotMatch(clientActions, /function auditNote/,
  "the best-effort audit note is gone: the record is no longer optional");
ok("an account is never destroyed without durable intent, and a missing outcome is never reported as success");

console.log("\n[12] Reversible lifecycle mutations never succeed unrecorded");

assert.match(clientActions, /async function requireLifecycleAudit/, "there is one precondition gate");
assert.match(clientActions, /if \(!\(await lifecycleAuditAvailable\(admin\)\)\) \{[\s\S]{0,120}LIFECYCLE_UNAVAILABLE_REASON/,
  "and it refuses with the stated reason when the record cannot be written");
assert.match(clientActions, /async function recordOrUndo/, "and one compensating writer");
assert.match(clientActions, /await undo\(\);[\s\S]{0,400}finish\(\s*"error"/,
  "a failed record undoes the change and reports the failure");

for (const [name, undo] of [
  ["suspendClientUser", /ban_duration: SUSPENSION_LIFTED/],
  ["restoreClientUser", /ban_duration: SUSPENSION_DURATION/],
  ["archiveTenant", /setTenantArchived\(admin, tenantId\.data, false, user\.id\)/],
  ["restoreTenant", /setTenantArchived\(admin, tenantId\.data, true, user\.id\)/],
]) {
  const at = clientActions.indexOf(`export async function ${name}`);
  assert.ok(at > 0, `${name} must exist`);
  const body = clientActions.slice(at, clientActions.indexOf("export async function", at + 10) || undefined);
  assert.match(body, /await requireLifecycleAudit\(admin/, `${name} must refuse when the record is unavailable`);
  assert.ok(
    body.indexOf("await requireLifecycleAudit(admin") < body.indexOf("await recordOrUndo"),
    `${name} must check the precondition before it mutates`,
  );
  assert.match(body, /await recordOrUndo\(/, `${name} must record or undo`);
  // The compensating call is the operation's own inverse, not a guess.
  const compensator = body.slice(body.indexOf("await recordOrUndo("));
  assert.match(compensator, undo, `${name} must compensate with its own inverse`);
}
ok("all four reversible mutations gate on the record, and undo themselves when it cannot be written");

// The interface says the same thing rather than offering a control that refuses.
assert.match(peopleList, /auditAvailable: boolean/, "the people list is told whether the record is available");
assert.match(peopleList, /!auditAvailable \? \([\s\S]{0,300}LIFECYCLE_UNAVAILABLE_REASON/,
  "and shows the reason instead of the suspend/restore controls");
assert.match(peopleList, /\{auditAvailable \? <ConfirmAction/,
  "permanent user deletion is not offered without the record either");
assert.match(lifecyclePanel, /const canArchive = archiveAvailable && auditAvailable/,
  "archiving needs both the archive columns and the record");
ok("the interface states the unavailability rather than offering a control the server would refuse");

console.log("\n[13] The administrative record is bounded, least-privileged and browser-denied");

const migration = await readRaw("supabase/migrations/0015_client_lifecycle_and_audit.sql");
const rollback = await readRaw("supabase/rollbacks/0015_drop_client_lifecycle_and_audit.sql");
/** The SQL without its `--` commentary: a comment explaining a revoked default
 *  privilege must not read as a grant of it. */
const migrationSql = migration.replace(/^\s*--.*$/gm, "");

// --- least privilege ---
assert.match(migration, /revoke all privileges on table public\.admin_lifecycle_event from anon, authenticated;/);
assert.match(migration, /revoke all privileges on table public\.admin_lifecycle_event from service_role;/,
  "the default ALL grant migration 0001 hands every new table must be revoked");
assert.match(migration, /grant select, insert on table public\.admin_lifecycle_event to service_role;/,
  "and only what the application performs granted back");
assert.doesNotMatch(migrationSql, /grant all privileges on table public\.admin_lifecycle_event/,
  "no blanket grant survives");
for (const forbidden of [/grant[^;]*update[^;]*admin_lifecycle_event/i, /grant[^;]*delete[^;]*admin_lifecycle_event/i]) {
  assert.doesNotMatch(migrationSql, forbidden, "the evidence table is append-only at the privilege level");
}
assert.doesNotMatch(migrationSql, /grant[^;]*truncate[^;]*admin_lifecycle_event/i,
  "and it cannot be truncated either");
// The application only ever does what it was granted.
assert.match(lifecycle, /from\("admin_lifecycle_event"\)\s*\.insert\(/, "the app inserts records");
assert.match(lifecycle, /from\("admin_lifecycle_event"\)\s*\.select\(/, "and reads them");
assert.doesNotMatch(lifecycle, /from\("admin_lifecycle_event"\)[\s\S]{0,80}\.(update|delete)\(/,
  "and never updates or deletes one");
// Browser roles are denied by policy as well as by grant.
assert.match(migration, /alter table public\.admin_lifecycle_event enable row level security/);
assert.match(migration, /alter table public\.admin_lifecycle_event force row level security/);
assert.match(migration, /create policy "deny_browser_roles" on public\.admin_lifecycle_event\s*\n\s*for all to anon, authenticated using \(false\) with check \(false\)/,
  "anon and authenticated are denied every row on every command");
ok("service_role holds SELECT and INSERT only; anon and authenticated hold nothing and are denied by policy too");

// --- the database-enforced metadata bound ---
assert.match(migration, /check \(octet_length\(details::text\) <= 4096\)/,
  "the database bounds the encoded size of the metadata");
assert.match(migration, /check \(jsonb_typeof\(details\) = 'object'\)/, "and still bounds its type");
assert.equal(AUDIT_DETAILS_DB_LIMIT_BYTES, 4096, "the declared database bound is what the migration writes");
assert.ok(
  MAX_DETAIL_BYTES * 2 === AUDIT_DETAILS_DB_LIMIT_BYTES,
  "the application bound is half the database bound, so encoding differences can never reach it",
);

// Behavioural: the sanitiser cannot construct a record beyond its own bound.
const huge = Object.fromEntries(
  Array.from({ length: 60 }, (_, index) => [`k${index}`, "x".repeat(120)]),
);
const bounded = boundedDetails(huge);
assert.ok(encodedSize(bounded) <= MAX_DETAIL_BYTES, "an oversized payload is truncated to the ceiling");
assert.ok(encodedSize(bounded) < AUDIT_DETAILS_DB_LIMIT_BYTES, "and therefore inside the database bound");
assert.ok(Object.keys(bounded).length > 0, "and it keeps as much as it can rather than dropping everything");
assert.ok(Object.keys(bounded).length < 60, "while genuinely dropping the tail it cannot carry");
// Determinism: the same input always yields the same bounded record.
assert.deepEqual(boundedDetails(huge), bounded, "the truncation is deterministic");
// Shape is still enforced alongside size.
assert.deepEqual(
  boundedDetails({ n: 5, b: true, z: null, s: "ok" }),
  { n: 5, b: true, z: null, s: "ok" },
);
assert.deepEqual(boundedDetails({ bad: { nested: 1 } }), {}, "only flat scalars survive");
assert.deepEqual(boundedDetails(undefined), {});
assert.equal(encodedSize(undefined), 2, "the empty record encodes as `{}`");
ok(`metadata is bounded at ${MAX_DETAIL_BYTES} bytes in the application and ${AUDIT_DETAILS_DB_LIMIT_BYTES} in the database, deterministically`);

// --- evidence outlives its subject, and the rollback says what it costs ---
assert.doesNotMatch(migrationSql, /admin_lifecycle_event[\s\S]{0,1400}references (public\.tenant|auth\.users|public\.profiles)/,
  "the evidence table carries no foreign key to a deletable subject or actor");
assert.match(rollback, /drop table if exists public\.admin_lifecycle_event/);
assert.match(rollback, /export it first|copy \(select \* from public\.admin_lifecycle_event/,
  "the rollback states that it destroys the administrative evidence");
ok("the record has no foreign key to what it records, and the rollback is honest about destroying it");

console.log("\n[14] The stored-object inventory is paged, ceilinged and honest when it overflows");

const lifecycleModel = await readCode("src/lib/studio/lifecycle-model.ts");
assert.match(lifecycleModel, /export const STORAGE_INVENTORY_CEILING = 1_000;/, "the ceiling is declared, not implicit");
assert.equal(STORAGE_INVENTORY_CEILING, 1000);
assert.match(lifecycle, /for \(let page = 0; page < maxPages; page \+= 1\)/,
  "paging is a bounded for-loop, so no backend answer can turn it into a load loop");
assert.match(lifecycle, /offset: page \* STORAGE_PAGE/, "each page asks for the next offset");
assert.match(lifecycle, /if \(entries\.length < STORAGE_PAGE\) \{[\s\S]{0,120}complete: true/,
  "a short page ends the listing and reports completeness");
assert.match(lifecycle, /complete: false,[\s\S]{0,200}inventario está incompleto/,
  "reaching the ceiling reports an incomplete inventory in words");
assert.match(lifecycle, /if \(error\) \{[\s\S]{0,200}complete: false/,
  "a Storage error is an incomplete inventory, never an empty one reported as complete");
assert.doesNotMatch(lifecycle, /\.list\(tenantId, \{ limit: 200 \}\)/, "the single 200-object call is gone");
// The impact report carries the flag rather than hiding it inside a count.
assert.match(lifecycle, /storageInventoryComplete: storageObjects\.complete/,
  "the impact report says whether its storage half is trustworthy");
assert.match(lifecyclePanel, /storageInventoryComplete/, "and the interface receives it");
assert.match(lifecyclePanel, /inventario de archivos guardados está incompleto/,
  "and says so when it is incomplete");
ok(`the inventory pages to a ${STORAGE_INVENTORY_CEILING}-object ceiling and states an incomplete result instead of undercounting`);

console.log("\n[15] The migration-number collision with the deferred P7 audit log is gone");

const p7Plan = await readRaw("docs/P7_PLAN.md");
assert.match(p7Plan, /## 0\.1 Migration numbering/, "the plan records that 0015 is taken");
assert.match(p7Plan, /`0015` is no longer\s*\n?available/, "and says so explicitly");
assert.doesNotMatch(p7Plan, /migration `0015` — `audit_log`/, "the reserved-number claim is gone");
assert.doesNotMatch(p7Plan, /`supabase\/rollbacks\/0015_drop_audit_log\.sql`/, "and so is its rollback filename");
assert.doesNotMatch(p7Plan, /`audit_log` requirements \(migration `0015`\)/, "and the requirements heading");
assert.match(p7Plan, /the next available migration/, "the audit log now takes the next available number");
ok("the P7 audit log no longer claims migration 0015, which P8.2 lifecycle evidence occupies");

console.log("\n[16] Readiness separates what blocks from what merely improves");

const emptyStudy = studyReadiness({
  status: "draft", clientArchived: false, quantResponses: 0, respondents: 0,
  confirmedObservations: 0, pendingObservations: 0, unfinishedImports: 0,
  totalStages: 0, stagesWithoutResult: 0,
});
assert.equal(emptyStudy.canPublish, false);
assert.deepEqual(emptyStudy.blocking.map((item) => item.id), ["datos"]);
assert.match(emptyStudy.summary, /impide publicarlo/);

const readyStudy = studyReadiness({
  status: "draft", clientArchived: false, quantResponses: 80, respondents: 20,
  confirmedObservations: 5, pendingObservations: 0, unfinishedImports: 0,
  totalStages: 3, stagesWithoutResult: 0,
});
assert.equal(readyStudy.canPublish, true);
assert.deepEqual(readyStudy.blocking, []);
assert.match(readyStudy.summary, /Se puede publicar cuando quieras/);

const improvable = studyReadiness({
  status: "draft", clientArchived: false, quantResponses: 80, respondents: 20,
  confirmedObservations: 1, pendingObservations: 7, unfinishedImports: 1,
  totalStages: 3, stagesWithoutResult: 2,
});
assert.equal(improvable.canPublish, true, "pending review and a gap in the recorrido do not block publication");
assert.deepEqual(improvable.improvements.map((item) => item.id).sort(), ["cargas", "cualitativo", "recorrido"]);

const archivedClient = studyReadiness({
  status: "draft", clientArchived: true, quantResponses: 80, respondents: 20,
  confirmedObservations: 0, pendingObservations: 0, unfinishedImports: 0,
  totalStages: 0, stagesWithoutResult: 0,
});
assert.equal(archivedClient.canPublish, false);
assert.deepEqual(archivedClient.blocking.map((item) => item.id), ["cliente"]);
ok("only genuine refusals are blockers; everything else is named as an improvement");

// C11: the internal surfaces own the omission warnings; the client sees silence.
assert.match(publishPage, /Nada de esto se le muestra al cliente como un hueco/,
  "the internal surface states that omissions produce silence, not a placeholder");
ok("the readiness warnings are marked as internal and never promise the client a placeholder");

console.log(`\nP8.2 Studio completion gate: PASS (${checks} checks)`);
