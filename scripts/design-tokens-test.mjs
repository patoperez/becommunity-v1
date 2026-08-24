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
import { sampleCopy, studyBaseSentence } from "../src/lib/language/sample.ts";
import { resultLanguage, studyStateLabel } from "../src/lib/language/results.ts";

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
  ["--color-evidence", "#1b72b8"],
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
  ["#1b72b8", "#eaf2fa", "evidence"],
]) {
  const ratio = contrastRatio(text, surface);
  assert.ok(ratio >= CONTRAST_AA_TEXT, `${label} text on its own surface is ${ratio.toFixed(2)}:1`);
  ok(`${label} text on its tinted surface: ${ratio.toFixed(2)}:1`);
}

console.log("\n[3] Studio chrome (paper on ink) and the focus ring");
assert.ok(contrastRatio("#faf8f3", INK) >= CONTRAST_AA_TEXT, "paper on ink");
ok(`paper on ink: ${contrastRatio("#faf8f3", INK).toFixed(2)}:1`);
assert.ok(
  contrastRatio("#1b72b8", PAGE) >= CONTRAST_AA_LARGE,
  "the focus ring must be a visible non-text mark",
);
ok(`focus ring on page: ${contrastRatio("#1b72b8", PAGE).toFixed(2)}:1`);

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
assert.equal(resolveBrand("#ffffff", PAGE).adjusted, true, "pure white must be corrected");
ok("a brand colour that cannot read is corrected, and says so");

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
assert.match(resultLanguage("csat:sat_servicio", "CSAT sat servicio").name, /^Satisfacción · Sat servicio$/);
assert.doesNotMatch(resultLanguage("csat:sat_servicio", "x").name, /csat|:|_/i, "no canonical key in the name");
assert.equal(resultLanguage("average:cri", "cri").name, "Cri");
assert.equal(studyStateLabel("published"), "Publicado");
assert.equal(studyStateLabel("draft"), "Borrador");
assert.doesNotMatch(studyStateLabel("archived"), /archived/i, "no raw enum reaches the screen");
ok("metric keys, CSAT/NPS acronyms and status enums are all translated at the boundary");

// --- 7. The frozen mechanisms the P7 suites settle on ----------------------

console.log("\n[7] Frozen adversarial-harness mechanisms are intact");
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
