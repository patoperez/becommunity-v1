/**
 * Comparability contract check for the P8 direction prototypes.
 *
 * WHAT IT PROVES
 *   For each of the three surfaces (entry / studio / story), every string the
 *   fixture declares in `contentContract` is present as VISIBLE TEXT in all
 *   three directions. If one direction quietly gets better, worse or different
 *   information than another, this fails.
 *
 *   It also proves the reverse direction of the P8 experience contract rule C3:
 *   none of the implementation terms listed in `forbiddenVocabulary` appears as
 *   visible text in any surface of any direction.
 *
 *   It additionally verifies that every local asset each page references
 *   (stylesheets, scripts) exists on disk, and that no page references an
 *   external origin.
 *
 * WHAT IT DELIBERATELY DOES NOT DO
 *   It does not compare pixels. It does not compare DOMs, element counts,
 *   ordering, class names or markup shape. The three directions are SUPPOSED to
 *   be structurally different — that is the entire point of the comparison.
 *   Only the visible semantic content is held constant.
 *
 * HOW
 *   Pure Node, no dependencies, no package resolution, no network. Reads files
 *   with node:fs only.
 *
 *   node .design/be-community-v2/prototypes/shared/content-check.mjs
 *
 * Exit code 0 = pass, 1 = fail.
 */

import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");

/* The three compared directions plus the provisional synthesis. The
   synthesis is held to the SAME unchanged contract — the contract was not
   weakened to let it pass. */
const DIRECTIONS = [
  "informe-vivo",
  "mesa-de-trabajo",
  "recorrido",
  "selected-informe-vivo-guiado",
];
const SURFACES = ["entry", "studio", "story"];

const fixture = JSON.parse(readFileSync(join(here, "fixture.json"), "utf8"));

let failures = 0;
const fail = (msg) => { failures += 1; console.error("  FAIL  " + msg); };
const pass = (msg) => console.log("  ok    " + msg);

/** Strip tags, comments, script and style bodies; collapse whitespace.
 *  Also drops attribute values, so a string only counts when it is genuinely
 *  rendered as text rather than hidden in a title/aria attribute — which is a
 *  defect the P8 audit called out specifically. */
function visibleText(html) {
  return html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
    .replace(/<title\b[\s\S]*?<\/title>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&laquo;|&raquo;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Normalise for comparison: NBSP-insensitive and whitespace-insensitive. */
function norm(s) {
  return s.replace(/ /g, " ").replace(/\s+/g, " ").trim();
}

// ---------------------------------------------------------------- load pages
const pages = new Map();
for (const dir of DIRECTIONS) {
  for (const surface of SURFACES) {
    const file = join(root, dir, `${surface}.html`);
    if (!existsSync(file)) {
      fail(`missing page: ${dir}/${surface}.html`);
      continue;
    }
    const html = readFileSync(file, "utf8");
    pages.set(`${dir}/${surface}`, { html, text: visibleText(html), file });
  }
}

console.log(`\nPages loaded: ${pages.size} of ${DIRECTIONS.length * SURFACES.length}\n`);

// ------------------------------------------------- 1. shared content present
console.log(`1. Shared content contract — same visible content in all ${DIRECTIONS.length} directions`);
for (const surface of SURFACES) {
  const required = fixture.contentContract[surface];
  let surfaceFailures = 0;
  for (const needle of required) {
    const missingIn = DIRECTIONS.filter((dir) => {
      const page = pages.get(`${dir}/${surface}`);
      return !page || !norm(page.text).includes(norm(needle));
    });
    if (missingIn.length) {
      surfaceFailures += 1;
      fail(`${surface}: "${needle}" missing from ${missingIn.join(", ")}`);
    }
  }
  if (!surfaceFailures) {
    pass(`${surface}: all ${required.length} required strings present in all ${DIRECTIONS.length} directions`);
  }
}

// ------------------------------------------- 2. forbidden vocabulary absent
console.log("\n2. Plain-language contract (P8 C3) — no implementation vocabulary rendered");
{
  let vocabFailures = 0;
  for (const term of fixture.forbiddenVocabulary.terms) {
    for (const [key, page] of pages) {
      // Word-ish boundary so "Recomendación" is not flagged by a substring, and
      // so "20" inside "2026" is never in scope (numbers are not listed anyway).
      const pattern = new RegExp(
        `(^|[^\\p{L}\\p{N}_])${term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^\\p{L}\\p{N}_]|$)`,
        "iu"
      );
      if (pattern.test(page.text)) {
        vocabFailures += 1;
        fail(`${key}: forbidden term rendered as visible text — "${term}"`);
      }
    }
  }
  if (!vocabFailures) {
    pass(`none of the ${fixture.forbiddenVocabulary.terms.length} forbidden terms appears in any of the ${pages.size} pages`);
  }
}

// ------------------------------------------------- 3. local assets resolve
console.log("\n3. Local assets — every referenced stylesheet and script exists");
{
  let assetFailures = 0;
  const allPages = [...pages.entries()];
  allPages.push(["index", { html: readFileSync(join(root, "index.html"), "utf8"), file: join(root, "index.html") }]);

  for (const [key, page] of allPages) {
    const base = dirname(page.file);
    const refs = [
      ...page.html.matchAll(/<link[^>]+href="([^"]+)"/gi),
      ...page.html.matchAll(/<script[^>]+src="([^"]+)"/gi),
      ...page.html.matchAll(/<iframe[^>]+src="([^"]+)"/gi),
    ].map((m) => m[1]);

    for (const ref of refs) {
      if (/^(https?:)?\/\//i.test(ref) || /^data:/i.test(ref)) {
        assetFailures += 1;
        fail(`${key}: external or data reference is not allowed — "${ref}"`);
        continue;
      }
      const target = resolve(base, ref.split("#")[0].split("?")[0]);
      if (!existsSync(target)) {
        assetFailures += 1;
        fail(`${key}: referenced asset does not exist — "${ref}"`);
      }
    }
  }
  if (!assetFailures) pass("all referenced stylesheets, scripts and frames resolve to local files");
}

// -------------------------------------------------- 4. no external requests
console.log("\n4. No network — no external origin appears anywhere in the prototypes");
{
  let netFailures = 0;
  const allowedTextual = /^https?:\/\/(?:$)/; // nothing is allowed
  for (const [key, page] of pages) {
    const hits = [...page.html.matchAll(/https?:\/\/[^\s"'<>)]+/gi)].map((m) => m[0]);
    // A bare href="#..." or a mailto is fine; only absolute http(s) is flagged.
    const bad = hits.filter((h) => !allowedTextual.test(h));
    if (bad.length) {
      netFailures += 1;
      fail(`${key}: absolute URL present — ${[...new Set(bad)].join(", ")}`);
    }
  }
  if (!netFailures) pass("no absolute http(s) URL in any direction page");
}

// ------------------------------------------------------- 5. per-page basics
console.log("\n5. Per-page basics — language, viewport, skip link");
{
  let basicFailures = 0;
  for (const [key, page] of pages) {
    if (!/<html\s+lang="es"/i.test(page.html)) { basicFailures++; fail(`${key}: missing lang="es"`); }
    if (!/name="viewport"/i.test(page.html)) { basicFailures++; fail(`${key}: missing viewport meta`); }
    if (!/class="skip-link"/i.test(page.html)) { basicFailures++; fail(`${key}: missing skip link`); }
  }
  if (!basicFailures) pass(`all ${pages.size} pages declare lang="es", a viewport and a skip link`);
}

// --------------------------------------------------------------------- done
console.log(
  failures === 0
    ? `\nRESULT: PASS — all ${DIRECTIONS.length} directions render the same semantic content, in plain language, with no external requests.\n`
    : `\nRESULT: FAIL — ${failures} problem(s) above.\n`
);
process.exit(failures === 0 ? 1 - 1 : 1);
