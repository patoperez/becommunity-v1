// =============================================================================
// Cuicuilco PRESENTATION parity — the approved blueprint against the real study
//   npx tsx scripts/canonical-presentation-parity.mjs <datos-limpios.xlsx> <mapa-curado.xlsx>
//   (or set CANONICAL_RESULTS_PARITY_CLEAN_XLSX / _PAIN_XLSX)
// =============================================================================
// `npm run test:canonical-presentation` proves the presentation LAYER over a
// synthetic fixture. This gate proves the approved BLUEPRINT over the real
// study: that every handle it binds exists in a registry built from the real
// canonical document, that the four source groups repartition into exactly the
// five approved routes covering all 55 touchpoints once each, and that the
// figures the CEO approved arrive in the render model unchanged.
//
// IT IS READ-ONLY AND OFFLINE. It builds the canonical projection IN MEMORY
// from the two source workbooks and performs no database and no network
// operation. It writes nothing, anywhere.
//
// IT IS SEPARATE FROM `npm test` ON PURPOSE, exactly as
// `canonical-results-parity.mjs` is: it needs two real workbooks whose paths are
// machine-specific, and an unexecuted gate must never be counted among the
// offline results. Run without them it reports itself SKIPPED, never as a pass.
//
// THE FIGURES BELOW ARE GOLDEN EXPECTATIONS, NOT INPUTS. They are recorded from
// the approved dashboard so a drift is caught; nothing in `src/` carries them,
// and a gate asserts that too.
// =============================================================================

import { readFileSync } from "node:fs";

import { preflightCanonicalPackage } from "../src/lib/ingestion/canonical-package/preflight.ts";
import { CUICUILCO_PACKAGE_SPEC_V1 } from "../src/lib/ingestion/canonical-package/spec.ts";
import { WorkbookView } from "../src/lib/ingestion/canonical-package/sheet-view.ts";
import { readXlsxWorkbook } from "../src/lib/ingestion/xlsx-reader.ts";
import { CUICUILCO_PROJECTION_V1, buildCanonicalCommitPlan } from "../src/lib/ingestion/canonical-commit/index.ts";
import {
  CUICUILCO_RESULTS_V1,
  buildCanonicalStudyResults,
  canonicalResultSourceFromCommitPlan,
} from "../src/lib/results/index.ts";
import { validatePresentationDocument } from "../src/lib/presentation/document.ts";
import { serializeDeterministic } from "../src/lib/presentation/serialize.ts";
import { buildCanonicalPresentationRegistry } from "../src/lib/presentation/registry.ts";
import { resolvePresentation } from "../src/lib/presentation/resolve.ts";
import {
  APPROVED_ROUTE_IDS,
  buildApprovedCuicuilcoBlueprint,
} from "../src/lib/presentation/blueprints/cuicuilco-approved.ts";
import { REQUIRED_DASHBOARD_COMMIT } from "./lib/canonical-golden-parity.mjs";

const cleanPath = process.argv[2] ?? process.env.CANONICAL_RESULTS_PARITY_CLEAN_XLSX;
const painPath = process.argv[3] ?? process.env.CANONICAL_RESULTS_PARITY_PAIN_XLSX;

console.log("Be Community — paridad de presentación del plano aprobado");
console.log("=".repeat(74));

if (!cleanPath || !painPath) {
  console.log(
    "\nOMITIDA: esta compuerta necesita los dos libros reales.\n" +
      "  npx tsx scripts/canonical-presentation-parity.mjs <datos-limpios.xlsx> <mapa-curado.xlsx>\n" +
      "  o CANONICAL_RESULTS_PARITY_CLEAN_XLSX / _PAIN_XLSX.\n" +
      "Una compuerta no ejecutada NO es una compuerta aprobada; se reporta como omitida.",
  );
  console.log("\nRESUMEN: ofrecidas=0 ejecutadas=0 aprobadas=0 falladas=0 omitidas=1 (SUITE OMITIDA)");
  process.exit(0);
}

let failures = 0;
const ok = (m) => console.log("  ✓", m);
const bad = (m) => {
  console.error("  ✗ FALLO:", m);
  failures += 1;
};
const check = (condition, message) => (condition ? ok(message) : bad(message));
const eq = (label, actual, expected) =>
  Object.is(actual, expected)
    ? ok(`${label} = ${String(expected)}`)
    : bad(`${label}: se esperaba ${String(expected)}, se obtuvo ${String(actual)}`);

/* -------------------------------------------------------------------------- */

console.log("\n[1] Proyección canónica desde los dos libros reales");
console.log(`  tablero aprobado de referencia: ${REQUIRED_DASHBOARD_COMMIT}`);

const files = [cleanPath, painPath].map((path) => {
  const buffer = readFileSync(path);
  return {
    fileName: path.replace(/^.*[\\/]/, ""),
    bytes: buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength),
  };
});

const preflight = await preflightCanonicalPackage(files, CUICUILCO_PACKAGE_SPEC_V1);
check(preflight.counts.blockers === 0, `el paquete real no tiene bloqueos (${preflight.counts.blockers})`);
if (preflight.counts.blockers > 0 || preflight.packageIdempotencyKey === null) {
  console.error("\nEl preflight bloquea el paquete; no hay nada que comparar.");
  process.exit(1);
}

const workbooks = new Map();
for (const asset of preflight.assets) {
  const file = files.find((candidate) => candidate.fileName === asset.fileName);
  workbooks.set(asset.role, new WorkbookView(await readXlsxWorkbook(file.bytes)));
}

const build = buildCanonicalCommitPlan({
  tenantId: "00000000-0000-4000-8000-0000000000a1",
  studyId: "00000000-0000-4000-8000-0000000000b2",
  packageIdempotencyKey: preflight.packageIdempotencyKey,
  spec: CUICUILCO_PACKAGE_SPEC_V1,
  projection: CUICUILCO_PROJECTION_V1,
  workbooks,
});
check(build.ok === true, "la proyección produce un plan");
if (!build.ok) process.exit(1);

const source = canonicalResultSourceFromCommitPlan(build.plan, { spec: CUICUILCO_RESULTS_V1 });
const results = buildCanonicalStudyResults(source, { period: { label: null, dataCutoff: null } });
eq("puntos de contacto medidos", results.journey.touchpoints.length, 55);
eq("categorías del origen", results.journey.groups.length, 4);

/* -------------------------------------------------------------------------- */

console.log("\n[2] El registro y el plano aprobado se construyen sobre el estudio real");
const registry = buildCanonicalPresentationRegistry(results);
check(registry.entries.length > 200, `el registro publica ${registry.entries.length} entradas`);
const blueprint = buildApprovedCuicuilcoBlueprint(registry);
const validated = validatePresentationDocument(JSON.parse(JSON.stringify(blueprint)));
check(validated.ok, "el plano aprobado valida");
if (!validated.ok) {
  console.error(JSON.stringify(validated.errors, null, 1));
  process.exit(1);
}
const resolved = resolvePresentation({ document: validated.value, registry, results });
check(resolved.ok, "el plano aprobado resuelve contra el documento canónico real");
if (!resolved.ok) {
  console.error(JSON.stringify(resolved.errors, null, 1));
  process.exit(1);
}
const model = resolved.value;
const blocks = model.pages.flatMap((page) => page.blocks);

/* -------------------------------------------------------------------------- */

console.log("\n[3] Cuatro categorías del origen, cinco recorridos aprobados, 55 puntos");
const routesBlock = blocks.find((block) => block.payload.shape === "routes");
const routes = routesBlock.payload.routes;
eq("recorridos visibles", routes.length, 5);
// THE ORACLE'S OWN FIVE, written out. Importing `APPROVED_ROUTE_IDS` from the
// blueprint and comparing it with what the blueprint produced compares the
// implementation with itself, which is the same mistake the CRI assertion made.
const ORACLE_ROUTE_IDS = [
  "operacion",
  "interaccion",
  "rendicion-de-cuentas",
  "cultura-equipo-de-liderazgo",
  "cultura-miembros",
];
check(routes.map((route) => route.id).join(",") === ORACLE_ROUTE_IDS.join(","), "en el orden aprobado");
check(
  APPROVED_ROUTE_IDS.join(",") === ORACLE_ROUTE_IDS.join(","),
  "y el plano declara exactamente esos cinco, sin que una lista se justifique con la otra",
);
const points = routes.flatMap((route) => route.points);
eq("puntos repartidos", points.length, 55);
eq("puntos distintos", new Set(points.map((point) => point.handle)).size, 55);
for (const [id, expected] of [
  ["operacion", 19],
  ["interaccion", 10],
  ["rendicion-de-cuentas", 6],
  ["cultura-equipo-de-liderazgo", 10],
  ["cultura-miembros", 10],
]) {
  eq(`puntos de «${id}»`, routes.find((route) => route.id === id).points.length, expected);
}

/* -------------------------------------------------------------------------- */

console.log("\n[4] Las cifras aprobadas llegan sin cambiar");

/**
 * `Capitanes de Esfera` — position 24 of the first source category, workbook
 * cells CSAT!AX/AY. The clean workbook carries it ONCE and populated; the
 * revised CSV's broken second copy never enters a calculation.
 */
const capitanes = points.find((point) => point.handle === "journey-touchpoint:g1-t24");
check(capitanes !== undefined, "el punto 24 de la primera categoría está exactamente una vez");
eq("su satisfacción aprobada", capitanes?.satisfaction?.formatted, "74.1");
eq("su TDP aprobada", capitanes?.processUnawareness?.formatted, "3.7");
eq("su base válida", capitanes?.base?.valid, 27);
eq(
  "y aparece una sola vez en todo el recorrido",
  points.filter((point) => point.handle === "journey-touchpoint:g1-t24").length,
  1,
);

/** `Salida` — the one touchpoint whose unawareness exceeds its valid base. */
const salida = points.find((point) => point.handle === "journey-touchpoint:g1-t28");
eq("la TDP de «Salida»", salida?.processUnawareness?.formatted, "133.3");
eq("su unidad es una razón", salida?.processUnawareness?.unit, "ratio");
check((salida?.processUnawareness?.value ?? 0) > 100, "pasa de 100 y la presentación NO la recorta");
eq("su base válida", salida?.base?.valid, 12);
eq(
  "exactamente una TDP supera el 100 en todo el recorrido",
  points.filter((point) => (point.processUnawareness?.value ?? 0) > 100).length,
  1,
);

// THE ZERO THAT PROVES THE PADDING GENERALISES. The approved dashboard prints
// «Bienvenida al capítulo 85.7% / 0.0%» — a TDP of zero, padded. The canonical
// formatter renders an integer bare, so without a display format this figure
// arrives as «0», and dozens of touchpoints share that shape. Unit 6A.1's first
// fix reached only the CRI; this is the assertion that would have caught that.
const welcome = points.find((point) => point.handle === "journey-touchpoint:g1-t3");
check(welcome !== undefined, "el punto 3 de la primera categoría está en una ruta");
eq("su satisfacción aprobada", welcome?.satisfaction?.formatted, "85.7");
eq("y su TDP aprobada, rellenada a un decimal", welcome?.processUnawareness?.formatted, "0.0");
eq("con el valor intacto", welcome?.processUnawareness?.value, 0);
const bareIntegers = points.filter(
  (point) =>
    (point.satisfaction !== null && !point.satisfaction.formatted.includes(".")) ||
    (point.processUnawareness !== null && !point.processUnawareness.formatted.includes(".")),
);
check(
  bareIntegers.length === 0,
  `ninguna de las ${points.length * 2} cifras del recorrido se escribe sin decimal${
    bareIntegers.length ? `: ${bareIntegers.length} lo hacen` : ""
  }`,
);

const npsBlock = blocks.find((block) => block.id === "recomendacion-puntaje");
eq("la recomendación combinada aprobada", npsBlock.payload.value?.formatted, "30.8");
const npsActive = blocks.find((block) => block.id === "recomendacion-comparacion-activos");
eq("la de miembros activos", npsActive.payload.value?.formatted, "46.4");
const npsDeserter = blocks.find((block) => block.id === "recomendacion-comparacion-desertores");
eq("la de desertores, negativa y sin recortar", npsDeserter.payload.value?.formatted, "-9.1");
// THE ORACLE, NOT THE CONTRACT. Unit 6A's first run of this gate failed because
// it received «33» where it expected «33.0», and the fix was to compare against
// `results.renewal.index.value.formatted` instead — which proves the layer is
// self-consistent and proves nothing at all about parity. The approved dashboard
// renders this figure with `decimals={1}` (`src/app/Risk.tsx`), its browser QA
// requires text containing «33.0» and its offline QA asserts `numbers.cri ===
// "33.0"`. So the expectation is the ORACLE's string, written here as a literal,
// and this assertion fails if the CRI ever renders as «33» again.
const risk = blocks.find((block) => block.id === "riesgo-indice");
eq("el valor numérico del índice de renovación", risk.payload.value?.value, 33);
eq("y su texto, exactamente el del tablero aprobado", risk.payload.value?.formatted, "33.0");
check(
  results.renewal.index.status === "available" && results.renewal.index.value.value === 33,
  "el contrato canónico sigue diciendo 33: el formato de presentación rellenó, no recalculó",
);
check(
  results.renewal.index.status === "available" && results.renewal.index.value.formatted === "33",
  "y su propio texto sigue siendo «33», así que la diferencia es de presentación y no de cifra",
);
const population = blocks.find((block) => block.id === "portada-poblacion");
eq("la población del estudio", population.payload.value?.value, 60);

/* -------------------------------------------------------------------------- */

console.log("\n[5] El contenido editorial sigue pendiente, y la Esfera sigue prohibida");
const pain = blocks.find((block) => block.id === "temas-recorrido");
eq("la nube de puntos de dolor del recorrido", pain.availability, "configuration_required");
check(
  pain.payload.shape === "editorial" && pain.payload.body === null,
  "sigue sin contenido: el tablero aprobado la publica, el contrato la declara editorial y no se copia",
);
const riskPanel = validated.value.pages[0].blocks.find((block) => block.id === "panel-riesgo");
check(
  !riskPanel.dimensions.includes("dimension:esfera"),
  "el panel de riesgo no ofrece Esfera, corrigiendo la desviación del tablero de referencia",
);
const renewalEntry = registry.entries.find((entry) => entry.handle === "value:renewal-index");
check(renewalEntry.forbiddenFilters.includes("dimension:esfera"), "y el registro la marca como cruce prohibido");

/* -------------------------------------------------------------------------- */

console.log("\n[6] Nada privado ni canónico cruza al modelo de render");
const modelText = serializeDeterministic(model);
check(!modelText.includes("#REF"), "sin token de error de hoja de cálculo");
check(!/\bcsat_[a-z]+\b/.test(modelText), "sin clave de reactivo canónica");
check(!/perfil_(?:cliente|desertores)_/.test(modelText), "sin clave de atributo canónica");
check(!modelText.includes("schemeKey"), "sin clave de esquema de bandas");
check(!modelText.includes('"at":'), "sin dirección canónica del registro");
const privateValues = new Set();
for (const person of build.plan.persons) {
  if (typeof person.displayName === "string" && person.displayName.trim().length >= 8) {
    privateValues.add(person.displayName);
  }
}
const leaked = [...privateValues].filter((value) => modelText.includes(value));
check(leaked.length === 0, `ningún nombre de persona aparece en el modelo (${privateValues.size} revisados)`);

/* -------------------------------------------------------------------------- */

console.log("\n[7] La resolución es determinista sobre el estudio real");
const second = resolvePresentation({ document: validated.value, registry, results });
check(second.ok && serializeDeterministic(second.value) === modelText, "dos resoluciones producen los mismos bytes");

console.log("\n" + "=".repeat(74));
if (failures > 0) {
  console.error(`RESULTADO: ${failures} fallo(s). COMPUERTA BLOQUEADA.`);
  process.exit(1);
}
console.log(
  "RESULTADO: el plano aprobado se expresa entero con handles opacos, reparte las cuatro categorías " +
    "del origen en los cinco recorridos aprobados sin repetir un punto, y reproduce las cifras del " +
    "tablero aprobado sin recalcular ninguna. COMPUERTA APROBADA.",
);
