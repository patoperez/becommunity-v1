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
import { domainFor } from "../src/components/evidence/ScaleMark.tsx";
import { sampleCopy, studyBaseSentence } from "../src/lib/language/sample.ts";
import { humanize, resultLanguage, studyStateLabel, unitLabel } from "../src/lib/language/results.ts";

let checks = 0;
const ok = (message) => { checks += 1; console.log(`  PASS  ${message}`); };

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
  const source = await readFile(new URL(`../${file}`, import.meta.url), "utf8");
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

const categories = await readFile(new URL("../src/lib/brand/categories.ts", import.meta.url), "utf8");
assert.doesNotMatch(categories, /--color-(caution|danger|positive)/,
  "category accents must never be sourced from the semantic outcome tokens");
assert.match(categories, /--color-magenta/, "category accents come from the identity's hues");
ok("grouping colour and outcome colour are separate token families");

console.log("\n[8] A published study is composed; readiness gaps stay internal");
const panorama = await readFile(new URL("../src/app/dashboard/NarrativeHome.tsx", import.meta.url), "utf8");
const journey = await readFile(new URL("../src/app/dashboard/JourneyMap.tsx", import.meta.url), "utf8");
for (const [name, source] of [["NarrativeHome", panorama], ["JourneyMap", journey]]) {
  assert.match(source, /audience === "preview"/,
    `${name} must gate its readiness notice on the internal audience`);
  assert.doesNotMatch(source, /no publicada para este estudio/i,
    `${name} must not advertise a missing reading to a client`);
  assert.doesNotMatch(source, /no hay una lectura publicada para este momento/i,
    `${name} must not repeat a missing-interpretation placeholder`);
}
const previewPage = await readFile(
  new URL("../src/app/admin/preview/[studyId]/page.tsx", import.meta.url), "utf8");
assert.match(previewPage, /audience="preview"/, "the internal preview must request the readiness view");
const dashboardPage = await readFile(new URL("../src/app/dashboard/page.tsx", import.meta.url), "utf8");
assert.doesNotMatch(dashboardPage, /audience="preview"/,
  "the client dashboard must never request the internal readiness view");
ok("readiness gaps are reachable from the internal preview only");

console.log("\n[9] Sign-in is one frame, and never fakes it with hidden overflow");
const loginPage = await readFile(new URL("../src/app/login/page.tsx", import.meta.url), "utf8");
assert.match(loginPage, /min-h-svh/, "the frame must track the small viewport unit, not a fixed height");
assert.match(loginPage, /overflow-y-auto/, "content must stay reachable when it genuinely cannot fit");
assert.doesNotMatch(loginPage, /overflow-hidden/, "no-scroll must never be achieved by clipping");
assert.doesNotMatch(loginPage, /(min-)?h-\[\d+px\]/, "no fragile fixed pixel height");
assert.match(loginPage, /Iniciar sesi/, "the submit control keeps the name the harness signs in with");
assert.match(loginPage, /name="email"[\s\S]*name="password"/, "both fields keep their names");
assert.match(loginPage, /No puedes entrar/, "recovery guidance is never gated away");
ok("sign-in frames to the viewport, degrades to safe scrolling, and keeps its action intact");

console.log("\n[10] Frozen adversarial-harness mechanisms are intact");
const card = await readFile(new URL("../src/app/dashboard/StudyCard.tsx", import.meta.url), "utf8");
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

const pivot = await readFile(new URL("../src/app/dashboard/PivotExplorer.tsx", import.meta.url), "utf8");
for (const control of ["Filas", "Columnas", "Métrica", "Agregación"]) {
  assert.ok(
    pivot.includes(control),
    `the pivot control "${control}" must keep the visible name the harness locates it by`,
  );
}
assert.match(pivot, /Explorador de cruces/, "Suite C asserts this heading is absent after a refused cross");
ok("the pivot control names Suites B and C drive are unchanged");

const layout = await readFile(new URL("../src/app/layout.tsx", import.meta.url), "utf8");
assert.match(layout, /lang="es"/, "the document must declare Spanish");
assert.match(layout, /next\/font\/google/, "fonts must be self-hosted through next/font, never fetched at runtime");
assert.match(layout, /href="#contenido"/, "a skip link must reach the main landmark");
const css = await readFile(new URL("../src/app/globals.css", import.meta.url), "utf8");
assert.doesNotMatch(css, /font-family:\s*Arial/i, "the Arial override that discarded the brand fonts is gone");
assert.match(css, /prefers-reduced-motion/, "reduced motion must be honoured globally");
ok("lang, self-hosted fonts, skip link, no Arial override, reduced motion");

console.log(`\nP8-A foundation gate: PASS (${checks} checks)`);
