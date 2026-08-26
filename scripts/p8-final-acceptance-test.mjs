import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

let checks = 0;
const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const has = (source, pattern, message) => { assert.match(source, pattern, message); checks += 1; };
const lacks = (source, pattern, message) => { assert.doesNotMatch(source, pattern, message); checks += 1; };

async function pageFiles(root) {
  const output = [];
  async function walk(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await walk(path);
      else if (entry.name === "page.tsx") output.push(path.replaceAll("\\", "/"));
    }
  }
  await walk(fileURLToPath(new URL(`../${root}`, import.meta.url)));
  return output;
}

const [layout, css, states, studioError, studioMissing, insightsLoading, insightsError,
  insightsMissing, cloud, panorama, journey, trends, dialog, tabs, uploadActions, legacyConfig,
  studioConfig, matrix, routes] = await Promise.all([
  read("src/app/layout.tsx"), read("src/app/globals.css"), read("src/components/States.tsx"),
  read("src/app/studio/error.tsx"), read("src/app/studio/not-found.tsx"),
  read("src/app/insights/loading.tsx"), read("src/app/insights/error.tsx"), read("src/app/insights/not-found.tsx"),
  read("src/components/evidence/QualitativeCloud.tsx"), read("src/app/dashboard/PanoramaFindings.tsx"),
  read("src/app/dashboard/JourneyMap.tsx"), read("src/app/dashboard/LongitudinalTrends.tsx"),
  read("src/components/studio/ConfirmAction.tsx"), read("src/components/studio/StudyTabs.tsx"),
  read("src/app/admin/upload/actions.ts"), read("src/app/admin/studies/StudyConfigurator.tsx"),
  read("src/app/studio/e/[studyId]/indicadores/page.tsx"), read("docs/P8_ACCEPTANCE_MATRIX.md"),
  read("src/lib/studio/routes.ts"),
]);

has(layout, /lang="es"/, "the document language is Spanish");
has(layout, /href="#contenido"[\s\S]*Saltar al contenido/, "every route receives the skip link");
has(css, /:focus-visible[\s\S]*outline: 3px solid var\(--color-focus\)/, "keyboard focus is globally visible");
has(css, /prefers-reduced-motion: reduce[\s\S]*animation-duration: 0\.001ms[\s\S]*transition-duration: 0\.001ms/, "reduced motion removes animation and transitions");
has(states, /export function StateBlock/, "shared named states exist");
has(states, /export function PageState/, "shared page states exist");

for (const [source, label] of [[studioError, "Studio error"], [studioMissing, "Studio not-found"], [insightsLoading, "Insights loading"], [insightsError, "Insights error"], [insightsMissing, "Insights not-found"]]) {
  has(source, /(?:PageState|StateBlock)/, `${label} uses the named state system`);
}
has(insightsLoading, /role="status"/, "Insights loading is announced");
has(studioError, /Reintentar[\s\S]*Volver al inicio de Studio/, "Studio error has recovery and a stable destination");
has(insightsError, /Reintentar/, "Insights error is recoverable");

has(cloud, /useId\(\)/, "each word cloud owns unique accessible identifiers");
has(cloud, /aria-controls=\{panelId\}/, "the cloud toggle identifies its controlled panel");
has(cloud, /aria-expanded=\{open\}/, "the cloud toggle exposes its state");
has(cloud, /role="img"[\s\S]*<title id=\{titleId\}>[\s\S]*<desc id=\{descriptionId\}>/, "the cloud has an accessible name and description");
has(cloud, /lista con cantidades sigue siendo la referencia/, "the visual never replaces the counted evidence");
has(cloud, /<ul className="sr-only">/, "the cloud has a text alternative");

has(panorama, /onKeyDown[\s\S]*ArrowRight[\s\S]*ArrowLeft[\s\S]*Home[\s\S]*End/, "the finding selector supports keyboard navigation");
has(journey, /onKeyDown[\s\S]*ArrowRight[\s\S]*ArrowLeft/, "the journey supports keyboard navigation");
has(trends, /tabIndex=\{0\}[\s\S]*aria-label=\{description\}/, "longitudinal chart points are keyboard-readable");
has(trends, /<table/, "longitudinal graphics retain a table alternative");
has(dialog, /role="dialog"[\s\S]*aria-modal="true"[\s\S]*aria-labelledby[\s\S]*aria-describedby/, "destructive confirmation is a named modal dialog");
has(dialog, /event\.key === "Escape"[\s\S]*event\.key !== "Tab"/, "the dialog is escapable and focus-trapped");
has(tabs, /overflow-x-auto[\s\S]*min-w-max/, "study navigation scrolls internally instead of widening the page");
has(panorama, /\[overflow-wrap:anywhere\]/, "tight client captions may break safely on narrow screens");

lacks(uploadActions, /message: "[^"]*JSON/, "ordinary import errors never ask staff to understand JSON");
lacks(legacyConfig, /Explorador pivote/, "legacy configuration no longer exposes pivot jargon");
lacks(studioConfig, /Explorador pivote/, "Studio configuration no longer exposes pivot jargon");

const pages = [...await pageFiles("src/app/studio"), ...await pageFiles("src/app/insights")];
assert.ok(pages.length >= 14, `expected the complete Studio/Insights route set, found ${pages.length}`); checks += 1;
for (const path of pages) lacks(await read(path.replace(/^.*?src\//, "src/")), /return null\s*;/, `${path} does not use a blank page as a state`);
has(routes, /studioStudyInterpretation[\s\S]*studioStudyPreview[\s\S]*studioStudyPublish/, "the complete study workflow remains addressable");
has(matrix, /320 px[\s\S]*360 px[\s\S]*390 px[\s\S]*768 px[\s\S]*1024 px[\s\S]*1280 px/, "the acceptance matrix declares six widths");
has(matrix, /Carga[\s\S]*Vacío[\s\S]*Error[\s\S]*No encontrado[\s\S]*Sin permiso/, "the state matrix names every required state class");
has(matrix, /Revisión humana en teléfono real: pendiente/, "automation does not counterfeit human acceptance");

console.log(`P8.5 final product acceptance: PASS (${checks} checks across ${pages.length} routes)`);
