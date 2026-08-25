/**
 * P8-A foundation gate: contrast, plain language, and the frozen mechanisms.
 *
 * Deterministic and credentials-free. It proves the three claims P8-A makes
 * that a reviewer would otherwise have to take on trust:
 *
 *   1. every semantic text token clears WCAG AA on the surface it is used on;
 *   2. the tenant brand contrast resolver holds the floor for ADVERSARIAL
 *      colours, not just for the two defaults — this is the guard for audit F4,
 *      where the product painted a raw client hex behind hardcoded white text;
 *   3. the sample-context vocabulary never leaks `n=` into an always-visible
 *      string, while keeping the exact count available in the methodology line.
 *
 * It also pins the two mechanisms the P7 adversarial suites settle on, so that
 * a future presentation pass cannot silently retire them: Suite A locates the
 * study filter by its `aria-label` and parses the unit counts out of the
 * dashboard's live region.
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  CONTRAST_AA_LARGE,
  CONTRAST_AA_TEXT,
  contrastRatio,
  resolveBrand,
} from "../src/lib/brand/contrast.ts";
import {
  domainFor,
  divergingGeometry,
  proportionGeometry,
  peerGeometry,
} from "../src/components/evidence/ScaleMark.tsx";
import { sampleCopy, studyBaseSentence } from "../src/lib/language/sample.ts";
import { hasPublishableQualitative } from "../src/app/dashboard/QualitativeInsights.tsx";
import { humanize, resultLanguage, studyStateLabel, unitLabel } from "../src/lib/language/results.ts";

let checks = 0;
const ok = (message) => { checks += 1; console.log(`  PASS  ${message}`); };

/**
 * Source with comments removed.
 *
 * Several files explain, in their own header, the defect they were written to
 * fix — "a stretched viewBox", "no progress bar". A naive scan matches that
 * explanation and fails the file for describing the thing it prevents, so every
 * "this string must not appear" check reads the CODE.
 */
const codeOf = (source) =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

/** Read a source file as CODE. Every structural assertion below uses this. */
const readCode = async (path) =>
  codeOf(await readFile(new URL(`../${path}`, import.meta.url), "utf8"));

// --- 1. The token palette --------------------------------------------------

const SURFACE = "#ffffff";
const PAGE = "#faf8f3";
const SUNKEN = "#f0ede4";
const INK = "#0e2a45";

const TEXT_TOKENS = [
  ["--color-strong", "#0e2a45"],
  ["--color-body", "#24405c"],
  ["--color-muted", "#4a6076"],
  ["--color-evidence", "#176394"],
  ["--color-voice", "#5f4a94"],
  ["--color-caution", "#7c5200"],
  ["--color-danger", "#a11a44"],
  ["--color-positive", "#3d660f"],
];

console.log("\n[1] Semantic text tokens on every surface they are used on");
for (const [name, value] of TEXT_TOKENS) {
  for (const [surfaceName, surface] of [["surface", SURFACE], ["page", PAGE], ["sunken", SUNKEN]]) {
    const ratio = contrastRatio(value, surface);
    assert.ok(
      ratio >= CONTRAST_AA_TEXT,
      `${name} on ${surfaceName} is ${ratio.toFixed(2)}:1, below ${CONTRAST_AA_TEXT}:1`,
    );
  }
  ok(`${name} clears ${CONTRAST_AA_TEXT}:1 on surface, page and sunken`);
}

console.log("\n[2] Tinted state surfaces carry their own text");
for (const [text, surface, label] of [
  ["#7c5200", "#fdf3dd", "caution"],
  ["#a11a44", "#fdecf2", "danger"],
  ["#3d660f", "#eff7e3", "positive"],
  ["#5f4a94", "#f1ecf9", "voice"],
  ["#176394", "#eaf2fa", "evidence"],
]) {
  const ratio = contrastRatio(text, surface);
  assert.ok(ratio >= CONTRAST_AA_TEXT, `${label} text on its own surface is ${ratio.toFixed(2)}:1`);
  ok(`${label} text on its tinted surface: ${ratio.toFixed(2)}:1`);
}

console.log("\n[3] Studio chrome (paper on ink) and the focus ring");
assert.ok(contrastRatio("#faf8f3", INK) >= CONTRAST_AA_TEXT, "paper on ink");
ok(`paper on ink: ${contrastRatio("#faf8f3", INK).toFixed(2)}:1`);
assert.ok(
  contrastRatio("#176394", PAGE) >= CONTRAST_AA_LARGE,
  "the focus ring must be a visible non-text mark",
);
ok(`focus ring on page: ${contrastRatio("#176394", PAGE).toFixed(2)}:1`);

// The BRAND blue is an expression token used for fills and non-text marks only;
// its AA-safe text derivative is `--color-evidence`. Asserting the split keeps a
// later change from quietly promoting the brand blue back into body text, where
// it reaches only 4.33:1 on the sunken surface.
assert.ok(contrastRatio("#1b72b8", SUNKEN) >= CONTRAST_AA_LARGE, "the brand blue must clear the non-text floor");
assert.ok(contrastRatio("#1b72b8", SUNKEN) < CONTRAST_AA_TEXT, "the brand blue is deliberately not a text colour");
for (const file of ["src/app/dashboard/NarrativeHome.tsx", "src/app/dashboard/JourneyMap.tsx",
  "src/app/dashboard/page.tsx", "src/components/Actions.tsx", "src/components/States.tsx",
  "src/components/SampleContext.tsx", "src/app/login/page.tsx",
  "src/app/dashboard/PanoramaFindings.tsx"]) {
  const source = await readCode(file);
  assert.doesNotMatch(source, /text-blue/, `${file} must use text-evidence, not the brand blue, for text`);
}
ok("the brand blue is used for marks only; text uses the AA-safe evidence blue");

// --- 4. The brand resolver, against colours a client can actually pick ------

console.log("\n[4] Tenant brand contrast resolver — adversarial input");
const HOSTILE = [
  ["#0c4a6e", "the shipped default primary"],
  ["#0e7490", "the shipped default accent"],
  ["#ffffff", "pure white — the worst case for white text"],
  ["#fffef8", "near-white"],
  ["#f4b72a", "the brand yellow, very light"],
  ["#7db52e", "the brand green, mid-light"],
  ["#808080", "mid grey — the hardest colour for both extremes"],
  ["#000000", "pure black"],
  ["#e23b8a", "the brand magenta"],
  ["#7fb2dd", "the brand sky, light"],
  ["not-a-colour", "malformed input falls back rather than throwing"],
];
for (const [hex, why] of HOSTILE) {
  const resolved = resolveBrand(hex, PAGE);
  const onAccent = contrastRatio(resolved.accent, resolved.accentOn);
  const quiet = contrastRatio(resolved.accentQuiet, PAGE);
  assert.ok(
    onAccent >= CONTRAST_AA_TEXT,
    `${hex} (${why}): text on the resolved accent is ${onAccent.toFixed(2)}:1`,
  );
  assert.ok(
    quiet >= CONTRAST_AA_TEXT,
    `${hex} (${why}): the quiet accent on the page is ${quiet.toFixed(2)}:1`,
  );
  assert.match(resolved.accent, /^#[0-9a-f]{6}$/, `${hex}: resolved accent must be a hex colour`);
  ok(`${hex} — ${why}: ${onAccent.toFixed(2)}:1 on the fill, ${quiet.toFixed(2)}:1 as text`);
}

// The resolver must not repaint a colour that was already fine.
assert.equal(resolveBrand("#0c4a6e", PAGE).adjusted, false, "a safe brand colour is left alone");
ok("a brand colour that already reads is passed through unchanged");

// The defect this replaces was HARDCODED WHITE TEXT on the tenant hex. The
// resolver's first move is to flip the foreground, and it only repaints the fill
// when neither foreground clears the floor.
assert.equal(resolveBrand("#ffffff", PAGE).accentOn, "#0e2a45", "a white brand must get ink text");
assert.equal(resolveBrand("#f4b72a", PAGE).accentOn, "#0e2a45", "the light brand yellow must get ink text");
assert.equal(resolveBrand("#ffffff", PAGE).adjusted, false, "flipping the foreground is enough for white");
assert.equal(resolveBrand("#0c4a6e", PAGE).accentOn, "#ffffff", "a dark brand keeps white text");
ok("the foreground is chosen per brand colour instead of being hardcoded white");

// Mid grey is the one case where neither foreground reaches 4.5:1, so the fill
// itself has to move — and the resolver reports that it did.
const grey = resolveBrand("#808080", PAGE);
assert.equal(grey.adjusted, true, "mid grey must be corrected because no foreground clears it unaided");
assert.notEqual(grey.accent, "#808080", "the corrected fill must actually differ");
ok("a brand colour that no foreground can rescue is corrected, and says so");

// --- 5. Plain language ------------------------------------------------------

console.log("\n[5] Sample context never exposes `n=` in an always-visible string");
for (const visibility of ["no-data", "suppressed", "caution", "standard"]) {
  for (const count of [null, 1, 4, 12, 23, 200]) {
    if (visibility === "suppressed" && count != null) continue;
    const copy = sampleCopy(visibility, count);
    const visible = `${copy.headline} ${copy.detail ?? ""}`;
    assert.doesNotMatch(visible, /\bn\s*=/i, `${visibility}/${count}: visible copy exposes n=`);
    assert.doesNotMatch(visible, /unidades de respuesta|muestra insuficiente|base pequeña/i,
      `${visibility}/${count}: visible copy still uses retired jargon`);
    assert.ok(copy.headline.length > 0, "every state says something");
  }
  ok(`${visibility}: plain-language headline with no n= and no retired jargon`);
}

// The precision is preserved, not deleted — it moves to the methodology line.
assert.match(sampleCopy("caution", 23).methodology, /n = 23/, "the exact base stays available");
assert.match(sampleCopy("standard", 200).methodology, /n = 200/, "the exact base stays available");
assert.match(sampleCopy("suppressed", null).methodology, /Regla de divulgación/, "the rule is explained");
ok("the exact base and the disclosure rule survive in the methodology line");

assert.match(studyBaseSentence("standard", 20), /20 personas y comentarios/, "study base reads in words");
assert.doesNotMatch(studyBaseSentence("standard", 20), /n\s*=/, "study base never shows n=");
ok("the study base sentence is a sentence, not a formula");

console.log("\n[6] Result vocabulary retires the canonical keys client-side");
assert.equal(resultLanguage("nps", "NPS").name, "Recomendación");
assert.match(resultLanguage("nps", "NPS").method, /NPS/, "the acronym survives in the method panel only");
assert.match(resultLanguage("csat:sat_servicio", "CSAT sat servicio").name, /^Satisfacción · Servicio$/,
  "the measurement prefix is dropped inside its own heading");
assert.match(resultLanguage("csat:comedor", "x").name, /^Satisfacción · Comedor$/,
  "a subject without a measurement prefix keeps all of its words");
assert.equal(humanize("atencion_y_servicio"), "Atencion y servicio",
  "theme and characteristic words are never trimmed by the result-name rule");
assert.doesNotMatch(resultLanguage("csat:sat_servicio", "x").name, /csat|:|_/i, "no canonical key in the name");
assert.equal(resultLanguage("average:cri", "cri").name, "Cri");
assert.equal(studyStateLabel("published"), "Publicado");
assert.equal(studyStateLabel("draft"), "Borrador");
assert.doesNotMatch(studyStateLabel("archived"), /archived/i, "no raw enum reaches the screen");
ok("metric keys, CSAT/NPS acronyms and status enums are all translated at the boundary");

// A score has no domain the product can honestly state, so it must not claim one.
assert.equal(domainFor("score"), null, "a score must not be given a fabricated domain");
assert.deepEqual(domainFor("nps"), { min: -100, max: 100, label: "de -100 a 100" });
assert.deepEqual(domainFor("percent"), { min: 0, max: 100, label: "de 0 % a 100 %" });
assert.doesNotMatch(unitLabel("score"), /1 a 5|escala del estudio/,
  "the score label must not imply a range the aggregate does not carry");
ok("only NPS and percent carry an absolute scale; a score is compared with its own peers");

// --- 7. The frozen mechanisms the P7 suites settle on ----------------------

console.log("\n[7] Category accents group; they never render a verdict");
for (const [surface, label] of [
  ["#eef4fa", "sky"],
  ["#fbeef4", "magenta"],
  ["#f2f7e9", "green"],
  ["#fdf5e2", "yellow"],
  ["#f3f0f8", "lavender"],
]) {
  const ratio = contrastRatio("#0e2a45", surface);
  assert.ok(ratio >= CONTRAST_AA_TEXT, `strong text on the ${label} tint is ${ratio.toFixed(2)}:1`);
}
ok("all five category tints carry strong text above 4.5:1");

const categories = await readCode("src/lib/brand/categories.ts");
assert.doesNotMatch(categories, /--color-(caution|danger|positive)/,
  "category accents must never be sourced from the semantic outcome tokens");
assert.match(categories, /--color-magenta/, "category accents come from the identity's hues");
ok("grouping colour and outcome colour are separate token families");

console.log("\n[8] A published study is composed; readiness gaps stay internal");
const panorama = await readCode("src/app/dashboard/NarrativeHome.tsx");
const journey = await readCode("src/app/dashboard/JourneyMap.tsx");
for (const [name, source] of [["NarrativeHome", panorama], ["JourneyMap", journey]]) {
  assert.match(source, /audience === "preview"/,
    `${name} must gate its readiness notice on the internal audience`);
  assert.doesNotMatch(source, /no publicada para este estudio/i,
    `${name} must not advertise a missing reading to a client`);
  assert.doesNotMatch(source, /no hay una lectura publicada para este momento/i,
    `${name} must not repeat a missing-interpretation placeholder`);
}
// P8.2 moved the preview's rendering into ONE shared component so its two
// addresses cannot diverge. The readiness view is requested there, once.
const previewView = await readCode("src/components/studio/ClientPreviewView.tsx");
assert.match(previewView, /audience="preview"/, "the internal preview must request the readiness view");
for (const route of [
  "src/app/admin/preview/[studyId]/page.tsx",
  "src/app/studio/e/[studyId]/vista-cliente/page.tsx",
]) {
  const source = await readCode(route);
  assert.match(source, /<ClientPreviewView/, `${route} must render the shared preview`);
}
const dashboardPage = await readCode("src/app/dashboard/page.tsx");
assert.doesNotMatch(dashboardPage, /audience="preview"/,
  "the client dashboard must never request the internal readiness view");
ok("readiness gaps are reachable from the internal preview only");

console.log("\n[9] Sign-in is one frame, and never fakes it with hidden overflow");
const loginPage = await readCode("src/app/login/page.tsx");
assert.match(loginPage, /min-h-svh/, "the frame must track the small viewport unit, not a fixed height");
assert.match(loginPage, /overflow-y-auto/, "content must stay reachable when it genuinely cannot fit");
assert.doesNotMatch(loginPage, /overflow-hidden/, "no-scroll must never be achieved by clipping");
assert.doesNotMatch(loginPage, /(min-)?h-\[\d+px\]/, "no fragile fixed pixel height");
assert.match(loginPage, /Iniciar sesi/, "the submit control keeps the name the harness signs in with");
assert.match(loginPage, /name="email"[\s\S]*name="password"/, "both fields keep their names");
assert.match(loginPage, /No puedes entrar/, "recovery guidance is never gated away");
ok("sign-in frames to the viewport, degrades to safe scrolling, and keeps its action intact");

console.log("\n[10] The three result visual contracts");
// Diverging (recomendación, -100..100): read from zero, negative left, positive
// right, exactly one marker. These are the geometries the mark renders from.
{
  const floor = divergingGeometry(-100);
  assert.equal(floor.markerPercent, 0, "-100 sits at the far left");
  assert.equal(floor.fillLeftPercent, 0, "a negative result fills leftwards from zero");
  assert.equal(floor.fillWidthPercent, 50, "-100 fills the whole left half");

  const zero = divergingGeometry(0);
  assert.equal(zero.markerPercent, 50, "zero sits at the centre");
  assert.equal(zero.fillWidthPercent, 0, "zero fills nothing");

  const ceiling = divergingGeometry(100);
  assert.equal(ceiling.markerPercent, 100, "+100 sits at the far right");
  assert.equal(ceiling.fillLeftPercent, 50, "a positive result fills rightwards from zero");
  assert.equal(ceiling.fillWidthPercent, 50, "+100 fills the whole right half");

  const positive = divergingGeometry(20);
  assert.equal(positive.markerPercent, 60);
  assert.equal(positive.fillLeftPercent, 50, "a positive result never extends left of zero");
  assert.equal(positive.fillWidthPercent, 10);

  const negative = divergingGeometry(-20);
  assert.equal(negative.markerPercent, 40);
  assert.equal(negative.fillLeftPercent, 40, "a negative result starts at the value");
  assert.equal(negative.fillWidthPercent, 10, "and ends at zero");
  assert.equal(negative.zeroPercent, 50, "the neutral zero reference is always centred");

  assert.equal(divergingGeometry(999).markerPercent, 100, "out-of-domain values clamp");
  assert.equal(divergingGeometry(-999).markerPercent, 0, "out-of-domain values clamp");
}
ok("diverging: centred zero, correct side, one marker, clamped");

// Proportional (percentage): one fill from zero, one endpoint, nothing else.
{
  assert.deepEqual(proportionGeometry(0), { fillWidthPercent: 0, markerPercent: 0 });
  assert.deepEqual(proportionGeometry(50), { fillWidthPercent: 50, markerPercent: 50 });
  assert.deepEqual(proportionGeometry(100), { fillWidthPercent: 100, markerPercent: 100 });
  const half = proportionGeometry(35);
  assert.equal(half.markerPercent, half.fillWidthPercent,
    "the marker IS the end of the fill — never a second value elsewhere on the track");
  assert.equal(proportionGeometry(140).markerPercent, 100, "out-of-domain values clamp");
}
ok("proportion: one fill from zero whose end is the only marker");

// A score has no authoritative maximum, so it is never given an absolute track.
{
  assert.equal(domainFor("score"), null, "a score must not be given a fabricated domain");
  assert.equal(peerGeometry(5, 5, 5), null, "peers that do not span a range cannot be positioned");
  assert.equal(peerGeometry(7.5, 7.5, 8.4).markerPercent, 0, "the lowest peer sits at the left end");
  assert.equal(peerGeometry(8.4, 7.5, 8.4).markerPercent, 100, "the highest peer sits at the right end");
  assert.equal(peerGeometry(7.95, 7.5, 8.4).markerPercent, 50, "the midpoint sits in the middle");
}
ok("average without a maximum: peer comparison, never an absolute progress bar");

const marksCode = await readCode("src/components/evidence/ScaleMark.tsx");
// The distortion that made the marks look broken: a non-uniform viewBox scale
// turned every circle into an ellipse and every rounded end into a second pill.
assert.doesNotMatch(marksCode, /preserveAspectRatio="none"/,
  "a stretched viewBox distorts the marker and makes one value look like two");
for (const [kind, count] of [["diverging", 1], ["proportion", 1], ["peer", 1]]) {
  const section = marksCode.split(`data-mark-kind="${kind}"`)[1] ?? "";
  const untilNext = section.split("data-mark-kind=")[0];
  const markers = untilNext.match(/<Marker /g) ?? [];
  assert.equal(markers.length, count, `${kind} must render exactly ${count} marker`);
}
assert.doesNotMatch(marksCode, /data-mark-kind="absent"[\s\S]*?<Marker/,
  "the absent mark carries no marker, because there is no value");
ok("each mark renders exactly one marker, and absence renders none");

console.log("\n[11] Cliente B is concise and promises nothing");
const comingCode = await readCode("src/app/dashboard/StudyComingSoon.tsx");
assert.match(comingCode, /Estamos preparando tu estudio/, "the agreed headline");
assert.match(comingCode, /No necesitas hacer nada por ahora/, "the agreed reassurance");
assert.match(comingCode, /Qué encontrarás aquí/, "the orientation interaction is named in ordinary Spanish");
for (const area of ["Hallazgos", "Recorrido", "Voces"]) {
  assert.ok(comingCode.includes(`label: "${area}"`), `the ${area} item exists`);
}
assert.doesNotMatch(comingCode, /analizando|%\s*completado|progress|Progreso/i,
  "no progress bar and no invented stage");
assert.doesNotMatch(comingCode, /publica a propósito|se vuelve visible cuando/i,
  "publication mechanics are internal workflow, not client copy");
assert.match(comingCode, /aria-pressed/, "the items are selectable and announce their state");
assert.match(comingCode, /aria-live="polite"/, "the revealed sentence is announced");
assert.match(comingCode, /ArrowRight/, "keyboard navigation between the items");
assert.match(comingCode, /motion-reduce:/, "a complete reduced-motion state");
const clientDashboard = await readCode("src/app/dashboard/page.tsx");
assert.match(clientDashboard, /<StudyComingSoon \/>/, "the client portal uses it");
ok("headline, two sentences, three orientation items, no fake progress");

console.log("\n[12] Every internal route declares an explicit parent");
const backLink = await readCode("src/components/shell/BackLink.tsx");
assert.doesNotMatch(backLink, /history\.back|router\.back/,
  "the parent must be an explicit href, never browser history");
assert.match(backLink, /Volver a Studio/);
assert.match(backLink, /Volver a Estudios/);
assert.match(backLink, /Volver a Clientes y accesos/, "the client list is an explicit parent too");
assert.match(backLink, /studyParent/, "a surface inside a study has the study as its parent");
for (const [file, expected] of [
  ["src/app/admin/studies/page.tsx", "STUDIO_HOME"],
  ["src/app/admin/qualitative/page.tsx", "STUDIO_HOME"],
  ["src/app/admin/clients/page.tsx", "STUDIO_HOME"],
  ["src/app/admin/upload/page.tsx", "STUDIES_LIST"],
]) {
  const source = await readCode(file);
  assert.match(source, /<StudioShell/, `${file} must wear the Studio shell`);
  assert.ok(source.includes(expected), `${file} must declare an explicit parent`);
  assert.doesNotMatch(source, /history\.back|router\.back/, `${file} must not use browser history`);
  // The shell's own nav replaces the hand-rolled link clusters.
  assert.doesNotMatch(source, />Portal</, `${file} must drop its duplicated header links`);
}
// The Studio home is the root: a back control there would point at itself.
assert.doesNotMatch(clientDashboard, /back=\{STUDIO_HOME\}/, "the Studio home has no parent");
const preview = await readCode("src/app/admin/preview/[studyId]/page.tsx");
const studioPreview = await readCode("src/app/studio/e/[studyId]/vista-cliente/page.tsx");
assert.match(studioPreview, /<PreviewNotice back=\{back\} \/>/,
  "the Studio preview mounts the notice pointing at the study it belongs to");
// The preview's return to the internal study list now lives in the sticky
// notice, which is where the reviewer can always reach it. Section [15] asserts
// that the notice actually carries the link; here we assert the preview mounts
// it, so the route can never be left without a way back.
assert.match(preview, /<PreviewNotice \/>/, "the preview must mount the notice that returns to Studies");
ok("explicit parents everywhere, no history interception, no root back control");

console.log("\n[13] Internal surfaces speak Spanish and keep their contracts");
const studiesPage = await readCode("src/app/admin/studies/page.tsx");
const configurator = await readCode("src/app/admin/studies/StudyConfigurator.tsx");
assert.match(configurator, /studyStateLabel\(study\.status\)/,
  "the study chip must translate the enum, not print it");
assert.doesNotMatch(configurator, />\{study\.status\}</, "the raw enum must not reach the screen");
// PUBLICATION LEFT THE CONFIGURATION FORM (P8.2). The configurator can no
// longer move a study between states: it carries the current one as a hidden
// field and the Server Action refuses anything else. The stored enum is
// unchanged and is asserted where it is now chosen — the publication surface,
// which is reachable only through the client preview.
assert.match(configurator, /name="status" value=\{study\.status\}/,
  "the configurator carries the current state and cannot change it");
const publishPage = await readCode("src/app/studio/e/[studyId]/publicar/page.tsx");
for (const value of ['next_status: "draft"', 'next_status: "published"', 'next_status: "archived"']) {
  assert.ok(publishPage.includes(value), `the stored enum value ${value} is unchanged`);
}
const studyActions = await readCode("src/app/admin/studies/actions.ts");
assert.match(studyActions, /z\.enum\(\["draft", "published", "archived"\]\)/,
  "the status schema still accepts exactly the three stored values");
assert.match(studyActions, /status\.data !== current\.status/,
  "the configuration action refuses to move the publication state");
assert.match(studyActions, /formData\.get\("acknowledged"\) !== "on"/,
  "publishing requires the acknowledgement the preview asks for");
// Every submit label the adversarial harness signs actions with.
for (const [source, labels] of [
  [studiesPage, ["Crear y cargar datos", "Usar plantilla", "Guardar como plantilla",
    "Guardar nueva versión", "Eliminar plantilla"]],
  [configurator, ["Guardar configuración"]],
]) {
  for (const submitLabel of labels) {
    assert.ok(source.includes(submitLabel), `the submit control "${submitLabel}" must keep its name`);
  }
}
// P8.2 split the qualitative review into a shared workspace rendered at both
// its addresses. Every control name the adversarial harness signs actions
// with is unchanged; the assertions follow the controls into the components
// that now own them.
const qualitative = await readCode("src/app/admin/qualitative/page.tsx");
const qualitativeWorkspace = await readCode("src/components/studio/QualitativeWorkspaceView.tsx");
const qualitativeReview = await readCode("src/components/studio/QualitativeReview.tsx");
assert.ok(qualitative.includes('name="study"'), 'qualitative must keep "name="study""');
for (const pinned of ["Generar sugerencias pendientes", "no tiene observaciones cualitativas"]) {
  assert.ok(qualitativeWorkspace.includes(pinned), `qualitative must keep "${pinned}"`);
}
for (const pinned of ["Aceptar sugerencias", "Reetiquetar / fusionar", "Rechazar",
  'name="observation_id"', 'name="quote_id"', 'name="theme"', 'name="stage_key"',
  "Publicar cita"]) {
  assert.ok(qualitativeReview.includes(pinned), `qualitative must keep "${pinned}"`);
}
// The 100-row silent truncation became visible paging with a real count.
assert.doesNotMatch(qualitative, /limit\(100\)/, "the silent 100-row truncation is gone");
assert.match(qualitativeWorkspace, /<Pager/, "the review list states how many rows exist");
const clientsPage = await readCode("src/app/admin/clients/page.tsx");
for (const pinned of ["Crear cliente", "Enviar invitación", "Guardar usuario",
  "Eliminar cuenta cliente", "Guardar identidad", 'name="confirmation_email"']) {
  assert.ok(clientsPage.includes(pinned), `clients must keep "${pinned}"`);
}
// P8.2 moved the access scope from a raw textarea on this page into the no-code
// picker the page renders. The stored FIELD is unchanged and still carried on
// every submission — it simply lives one component away, so the assertion
// follows it rather than being dropped.
assert.ok(clientsPage.includes("AccessScopeFields"), "the clients page must render the access picker");
const accessPicker = await readCode("src/components/studio/AccessScopeFields.tsx");
for (const pinned of ['name="data_scope"', 'name="tenant_id"']) {
  assert.ok(accessPicker.includes(pinned), `the access picker must keep "${pinned}"`);
}
ok("statuses translated, stored enums untouched, every pinned action name intact");

console.log("\n[14] Absence is never a client-facing finding");
// The rule: a published study is a finished editorial product. Anything Be
// Community chose not to publish — or has not finished reviewing — produces
// SILENCE on the client side, not a placeholder announcing the gap. The
// internal preview owns those warnings instead.
{
  const empty = { themes: [], quotes: [], hasSuppressedThemes: false };
  assert.equal(hasPublishableQualitative(empty), false, "nothing confirmed means nothing to publish");
  assert.equal(hasPublishableQualitative({ ...empty, themes: [{ theme: "t", count: 1, n: 1, visibility: "standard" }] }), true);
  assert.equal(hasPublishableQualitative({ ...empty, quotes: [{ quote: "q", theme: null }] }), true);
  // A suppressed theme is a DISCLOSURE, not an omission: the client is told
  // that something exists but is protected, which stays.
  assert.equal(hasPublishableQualitative({ ...empty, hasSuppressedThemes: true }), true);
}
ok("publishable qualitative is decided by confirmed content, and suppression still counts");

const qualitativeComponent = await readCode("src/app/dashboard/QualitativeInsights.tsx");
const panoramaSource = await readCode("src/app/dashboard/NarrativeHome.tsx");
const journeySource = await readCode("src/app/dashboard/JourneyMap.tsx");
const studyCard = await readCode("src/app/dashboard/StudyCard.tsx");

// 1 — the missing-comparison sentences must not exist in any client path.
for (const [name, source] of [["NarrativeHome", panoramaSource], ["StudyCard", studyCard]]) {
  assert.doesNotMatch(source, /medición anterior con la que comparar/i,
    `${name} must not tell the client a comparison is missing`);
  assert.doesNotMatch(source, /los cambios aparecerán aquí/i,
    `${name} must not promise a future comparison`);
}
assert.doesNotMatch(panoramaSource, /view\.hasPreviousWave/,
  "the panorama must not branch on a missing prior wave to render copy");
// The movement line is emitted only when a comparison genuinely exists.
assert.match(panoramaSource, /movement === "unavailable"[\s\S]{0,80}\?\s*null/,
  "an unavailable comparison must produce no context line at all");
ok("no comparison message, placeholder or reserved row when nothing is comparable");

// 2 — the missing-qualitative sentences and the empty wrapper must not exist.
assert.doesNotMatch(qualitativeComponent, /no hay comentarios revisados y confirmados/i,
  "the client must not be told a review is pending");
assert.doesNotMatch(qualitativeComponent, /Nadie dejó comentarios sobre este momento/i,
  "the client must not be told a moment has no comments");
assert.doesNotMatch(journeySource, /no hay comentarios abiertos asociados/i,
  "a touchpoint with no approved voices says nothing to the client");
assert.doesNotMatch(panoramaSource, /no incluye\s*\n?\s*comentarios abiertos/i,
  "the panorama must not explain that the study carries no comments");
assert.match(qualitativeComponent, /audience !== "preview"\)\s*return null/,
  "with nothing publishable, the client branch renders nothing at all");
// The bordered section wrapper must not survive a child that renders nothing.
assert.match(studyCard, /hasPublishableQualitative\(view\.qualitative\)/,
  "the qualitative section wrapper is gated on there being content");
assert.match(studyCard, /audience === "preview"/,
  "the wrapper survives only for the internal preview");
ok("no empty qualitative card, heading, border or gap on the client side");

// The hero must not name comments when none are published.
assert.match(panoramaSource, /publishesVoices \? "voices" : "people"/,
  "the base sentence drops the comment noun when nothing qualitative is published");
assert.doesNotMatch(studyBaseSentence("standard", 20, "people"), /comentario/i,
  "the people-only base sentence never mentions comments");
assert.match(studyBaseSentence("standard", 20, "people"), /20 personas/,
  "and the count itself is unchanged");
assert.match(studyBaseSentence("standard", 20, "voices"), /20 personas y comentarios/,
  "the voices phrasing still exists for studies that do publish them");
ok("the hero names comments only when comments are actually published");

// 3 — internal readiness must still report the omission.
assert.match(panoramaSource, /Ningún tema cualitativo está confirmado/,
  "internal readiness still names unconfirmed themes");
assert.match(panoramaSource, /Ninguna cita está aprobada para publicarse/,
  "internal readiness still names unapproved quotes");
assert.match(qualitativeComponent, /Sólo para el equipo/,
  "the preview says plainly that the client sees nothing here");
assert.match(journeySource, /Sólo para el equipo/,
  "the preview keeps its per-touchpoint readiness note");
ok("internal readiness still reports missing confirmed qualitative content");

// 4 — sample cautions are analytical honesty, not an internal omission.
assert.match(sampleCopy("caution", 23).headline, /Pocas respuestas/,
  "a small base still warns the reader");
// The panorama builds finding DATA; `PanoramaFindings` renders it. Assert each
// file at the layer it actually owns.
assert.match(panoramaSource, /sample: \{ visibility: spot\.visibility, count: spot\.n \}/,
  "the panorama still hands the spotlight's base to the finding");
assert.match(panoramaSource, /studyBaseSentence\(/, "the hero still states the study's base");
for (const [name, source] of [
  ["PanoramaFindings", await readCode("src/app/dashboard/PanoramaFindings.tsx")],
  ["JourneyMap", journeySource],
  ["StudyCard", studyCard],
]) {
  assert.match(source, /SampleContext/, `${name} still renders sample context`);
}
ok("sample-size cautions that affect interpretation are preserved");

console.log("\n[15] The internal preview notice is sticky, linked and dismissible");
const notice = await readCode("src/components/shell/PreviewNotice.tsx");
assert.match(notice, /sticky/, "the notice must remain visible while scrolling");
assert.doesNotMatch(notice, /\bfixed\b/,
  "sticky keeps the notice in flow so it never overlays the page at rest");
assert.match(notice, /STUDIES_LIST/, "it carries the explicit parent link");
assert.match(notice, /aria-label="Cerrar aviso de vista previa"/,
  "the close control has an accessible Spanish name");
assert.match(notice, /useState/, "dismissal is component state");
assert.doesNotMatch(notice, /localStorage|document\.cookie|sessionStorage|fetch\(/,
  "dismissal writes nothing anywhere");
assert.match(notice, /flex-wrap/, "it wraps instead of overflowing on a narrow phone");
const previewRoute = await readCode("src/app/admin/preview/[studyId]/page.tsx");
assert.match(previewRoute, /banner=\{<PreviewNotice \/>\}/, "the preview uses it");
// The rendering itself lives in the shared preview component, so the boundary
// assertions below follow it there rather than being asserted twice.
const sharedPreview = await readCode("src/components/studio/ClientPreviewView.tsx");
// Dismissing the notice must never strand the reviewer inside the client
// surface. The escape path therefore lives OUTSIDE the dismissible notice as
// well: the header utility slot, which no dismissal can remove. Asserting the
// independent path rather than the absence of a duplicate is the regression
// that actually matters — a briefly duplicated route is harmless, a trap is not.
assert.match(previewRoute, /utility=\{[\s\S]*?STUDIES_LIST\.href[\s\S]*?\}/,
  "the preview keeps a persistent return to Studies outside the dismissible notice");
assert.match(previewRoute, /STUDIES_LIST\.label/,
  "and it is labelled in Spanish from the shared parent definition");
assert.doesNotMatch(previewRoute, /history\.back|router\.back/,
  "the escape path is an explicit href, never browser history");
assert.match(studyCard, /scroll-mt-20/,
  "anchor jumps clear the sticky notice instead of landing under it");
// Editing this route must not have touched its authorization or its
// publication boundary.
assert.match(previewRoute, /profile\?\.role !== "internal"/, "internal-only guard intact");
assert.match(sharedPreview, /candidate\.status === "published" \|\| candidate\.id === study\.id/,
  "the publication boundary on the preview history is intact");
ok("sticky, dismissible, and a persistent /admin/studies escape path outside it; guards intact");

console.log("\n[16] Frozen adversarial-harness mechanisms are intact");
const card = await readCode("src/app/dashboard/StudyCard.tsx");
assert.match(card, /aria-label=\{`Filtrar por \$\{label\(option\.key\)\}`\}/,
  "Suite A locates the study filter by this exact accessible name");
assert.match(card, /\$\{view\.selectedUnits\} de \$\{view\.sourceUnits\} unidades de respuesta/,
  "Suite A parses the unit counts out of this exact live-region string");
assert.match(card, /Actualizando resultados agregados\.\.\./,
  "Suites B and C settle dashboard.refresh on this exact pending string");
assert.match(card, /Muestra insuficiente · se ocultaron los resultados de esta selección/,
  "the suppressed branch of the live region is part of the same frozen signal");
assert.match(card, /aria-live="polite"/, "the live region itself must remain");
ok("the study filter aria-label and the live-region signal are unchanged");

const pivot = await readCode("src/app/dashboard/PivotExplorer.tsx");
for (const control of ["Filas", "Columnas", "Métrica", "Agregación"]) {
  assert.ok(
    pivot.includes(control),
    `the pivot control "${control}" must keep the visible name the harness locates it by`,
  );
}
assert.match(pivot, /Explorador de cruces/, "Suite C asserts this heading is absent after a refused cross");
ok("the pivot control names Suites B and C drive are unchanged");

const layout = await readCode("src/app/layout.tsx");
assert.match(layout, /lang="es"/, "the document must declare Spanish");
assert.match(layout, /next\/font\/google/, "fonts must be self-hosted through next/font, never fetched at runtime");
assert.match(layout, /href="#contenido"/, "a skip link must reach the main landmark");
const css = await readCode("src/app/globals.css");
assert.doesNotMatch(css, /font-family:\s*Arial/i, "the Arial override that discarded the brand fonts is gone");
assert.match(css, /prefers-reduced-motion/, "reduced motion must be honoured globally");
ok("lang, self-hosted fonts, skip link, no Arial override, reduced motion");

console.log(`\nP8-A foundation gate: PASS (${checks} checks)`);
