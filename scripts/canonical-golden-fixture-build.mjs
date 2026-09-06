// =============================================================================
// Build the Cuicuilco golden-parity fixture FROM THE APPROVED DASHBOARD
//   npx tsx scripts/canonical-golden-fixture-build.mjs <path-to-approved-dashboard-repo>
// =============================================================================
// THE ONE RULE THIS SCRIPT EXISTS TO ENFORCE:
//
//   Expected values come from the APPROVED DASHBOARD and from nowhere else.
//   This script never imports, executes or reads a single line of the product's
//   own calculation layer, so re-running it cannot launder a mismatch into a
//   pass. If the product starts producing a different number, this fixture does
//   not move — the gate goes red.
//
// It reads, read-only:
//   <repo>/public/data/snapshot.json   — the aggregate-only deployed snapshot
//   <repo> HEAD                        — pinned and recorded in the fixture
//
// WHAT IT DELIBERATELY DOES NOT RECORD:
//   - anything respondent-level: the snapshot has none, and this asserts it;
//   - the curated pain-phrase cloud and the per-touchpoint pain phrases. Those
//     are consultant prose, and the comparison is UNRESOLVED anyway: reproducing
//     them needs a phrase-splitting rule and a touchpoint-to-stage mapping that
//     no authority states. The fixture records the unresolved expectation and
//     its reason, not the phrases.
//
// The output is `scripts/fixtures/cuicuilco-golden-parity.v1.json`.
// =============================================================================

import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const REQUIRED_DASHBOARD_COMMIT = "a7248fdbccd139da80ed7c09daa70f006a62b9cf";
const FIXTURE_PATH = join("scripts", "fixtures", "cuicuilco-golden-parity.v1.json");
const SPEC_VERSION = 1;

const repoArg = process.argv[2];
if (!repoArg) {
  console.error("Uso: canonical-golden-fixture-build.mjs <ruta-al-repositorio-del-tablero-aprobado>");
  process.exit(2);
}
const repo = resolve(repoArg);

const head = execFileSync("git", ["-C", repo, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
if (head !== REQUIRED_DASHBOARD_COMMIT) {
  console.error(`El tablero aprobado debe estar en ${REQUIRED_DASHBOARD_COMMIT}; está en ${head}.`);
  process.exit(2);
}
const dirty = execFileSync("git", ["-C", repo, "status", "--porcelain"], { encoding: "utf8" }).trim();
if (dirty !== "") {
  console.error("El repositorio del tablero aprobado tiene cambios sin confirmar; no se deriva de un árbol sucio.");
  process.exit(2);
}

const snapshotPath = join(repo, "public", "data", "snapshot.json");
const snapshot = JSON.parse(readFileSync(snapshotPath, "utf8"));

// ---- privacy assertions over the source we are about to quote ---------------
const serialized = JSON.stringify(snapshot);
for (const forbidden of ["respondent", "participantId", "email", "@", "membershipId"]) {
  if (serialized.includes(forbidden)) {
    console.error(`El snapshot aprobado contiene '${forbidden}'; se detiene antes de copiarlo a un fixture.`);
    process.exit(1);
  }
}

const expectations = [];
let ordinal = 0;
const expect = (entry) => {
  ordinal += 1;
  expectations.push({ ordinal, ...entry });
};

const P = snapshot.population;

// ---- [1] population ---------------------------------------------------------
const populationFields = [
  ["total", "Población del estudio", "chapter_population", null],
  ["measured", "Personas con al menos un dato medido", "chapter_population", null],
  ["active", "Miembros activos", "cohort_active", null],
  ["former", "Personas que salieron", "cohort_deserter", null],
  ["formerMeasured", "Desertores con dato medido", "cohort_deserter", null],
  ["formerAnswered", "Desertores que contestaron la encuesta de salida", "cohort_deserter", null],
  ["formerWithoutMeasuredData", "Desertores sin dato medido", "cohort_deserter", null],
];
for (const [field, label, cohort] of populationFields) {
  expect({
    id: `population.${field}`,
    section: "population",
    label,
    unit: "count",
    expected: P[field],
    cohort,
    denominator: null,
    evidence: `snapshot.json#/population/${field}`,
    status: "expected",
  });
}
for (const instrument of P.instruments) {
  expect({
    id: `population.instrument.${instrument.id}.responses`,
    section: "population",
    label: `Respuestas del instrumento ${instrument.label}`,
    unit: "count",
    expected: instrument.responses,
    cohort: instrument.scope,
    denominator: null,
    evidence: `snapshot.json#/population/instruments/${instrument.id}/responses`,
    status: "expected",
  });
}

// ---- [2] retention ----------------------------------------------------------
snapshot.retention.periods.forEach((period, index) => {
  const fields = [
    ["starting", "count", "Miembros al inicio del periodo"],
    ["joined", "count", "Miembros nuevos durante el periodo"],
    ["ending", "count", "Miembros al final del periodo"],
    ["lost", "count", "Miembros perdidos durante el periodo"],
    ["retention", "percent", "Tasa de retención"],
    ["churn", "percent", "Tasa de deserción"],
  ];
  for (const [field, unit, label] of fields) {
    expect({
      id: `retention.${index}.${field}`,
      section: "retention",
      label: `${label} — ${period.label}`,
      unit,
      expected: period[field],
      cohort: "membership_roster",
      denominator: unit === "percent" ? `padrón al inicio del periodo = ${period.starting}` : null,
      evidence: `snapshot.json#/retention/periods/${index}/${field}`,
      periodLabel: period.label,
      periodOrder: index,
      status: "expected",
    });
  }
});

// ---- [3] recommendation -----------------------------------------------------
for (const scope of snapshot.nps.scopes) {
  const fields = [
    ["nps", "nps", "NPS"],
    ["promoters", "count", "Promotores"],
    ["passives", "count", "Pasivos"],
    ["detractors", "count", "Detractores"],
    ["total", "count", "Respuestas válidas"],
  ];
  for (const [field, unit, label] of fields) {
    expect({
      id: `nps.${scope.id}.${field}`,
      section: "recommendation",
      label: `${label} — ${scope.label}`,
      unit,
      expected: scope[field],
      cohort: scope.label,
      denominator: unit === "nps" ? `respuestas válidas = ${scope.total}` : null,
      evidence: `snapshot.json#/nps/scopes/${scope.id}/${field}`,
      scopeKey: scope.id,
      status: "expected",
    });
  }
}

// ---- [4] renewal ------------------------------------------------------------
expect({
  id: "cri.value",
  section: "renewal",
  label: "Índice de riesgo de renovación",
  unit: "index",
  expected: snapshot.cri.value,
  cohort: "Miembros activos",
  denominator: `respuestas válidas = ${snapshot.cri.total}`,
  evidence: "snapshot.json#/cri/value",
  status: "expected",
});
expect({
  id: "cri.total",
  section: "renewal",
  label: "Respuestas válidas del índice de renovación",
  unit: "count",
  expected: snapshot.cri.total,
  cohort: "Miembros activos",
  denominator: null,
  evidence: "snapshot.json#/cri/total",
  status: "expected",
});
expect({
  id: "cri.bandId",
  section: "renewal",
  label: "Zona del índice de renovación",
  unit: "band",
  expected: snapshot.cri.bandId,
  cohort: "Miembros activos",
  denominator: null,
  evidence: "snapshot.json#/cri/bandId",
  status: "expected",
});
for (const entry of snapshot.cri.distribution) {
  expect({
    id: `cri.distribution.${entry.response}`,
    section: "renewal",
    label: `Respuestas «${entry.response}»`,
    unit: "count",
    expected: entry.count,
    cohort: "Miembros activos",
    denominator: null,
    evidence: `snapshot.json#/cri/distribution[response=${entry.response}]/count`,
    response: entry.response,
    riskPoints: entry.riskPoints,
    level: entry.level,
    status: "expected",
  });
}

// ---- [5] journey ------------------------------------------------------------
// The instrument's four categories, in the order the source presents them. The
// snapshot's `layers` are FIVE presentation routes over these four categories,
// so the categories are recovered from the touchpoints themselves.
const categoryOrder = [];
for (const touchpoint of snapshot.journey.touchpoints) {
  if (!categoryOrder.includes(touchpoint.layer)) categoryOrder.push(touchpoint.layer);
}
expect({
  id: "journey.touchpointCount",
  section: "journey",
  label: "Puntos de contacto evaluados",
  unit: "count",
  expected: snapshot.journey.touchpoints.length,
  cohort: "Miembros activos",
  denominator: null,
  evidence: "snapshot.json#/journey/touchpoints",
  status: "expected",
});
expect({
  id: "journey.groupCount",
  section: "journey",
  label: "Categorías evaluadas por el instrumento",
  unit: "count",
  expected: categoryOrder.length,
  cohort: "Miembros activos",
  denominator: null,
  evidence: "snapshot.json#/journey/touchpoints[*]/layer (distintos)",
  status: "expected",
});
categoryOrder.forEach((category, groupIndex) => {
  const members = snapshot.journey.touchpoints.filter((touchpoint) => touchpoint.layer === category);
  expect({
    id: `journey.group.${groupIndex}.size`,
    section: "journey",
    label: `Puntos de contacto de la categoría «${category}»`,
    unit: "count",
    expected: members.length,
    cohort: "Miembros activos",
    denominator: null,
    evidence: `snapshot.json#/journey/touchpoints[layer=${category}]`,
    groupIndex,
    groupLabel: category,
    status: "expected",
  });
  // Ordering and grouping, expressed as POSITIONS in the source's own column
  // order rather than as labels. The canonical projection names an item by the
  // question the source asks, while the dashboard names it by the short label
  // in the column beside the answer, so the two label vocabularies are not
  // comparable — but the partition of the 55 source-ordered touchpoints is, and
  // it is the thing worth proving.
  expect({
    id: `journey.group.${groupIndex}.positions`,
    section: "journey",
    label: `Posiciones de origen de la categoría «${category}»`,
    unit: "sequence",
    expected: members.map((member) => snapshot.journey.touchpointOrder.indexOf(member.id)),
    cohort: "Miembros activos",
    denominator: null,
    evidence: "snapshot.json#/journey/touchpointOrder",
    groupIndex,
    groupLabel: category,
    status: "expected",
  });

  members.forEach((touchpoint, itemIndex) => {
    const fields = [
      ["satisfied", "count", "Respuestas satisfechas"],
      ["dissatisfied", "count", "Respuestas insatisfechas"],
      ["unaware", "count", "Respuestas de desconocimiento"],
      ["valid", "count", "Base válida"],
      ["responses", "count", "Respuestas recibidas"],
      ["csat", "percent", "CSAT"],
      ["tdp", "ratio", "Razón de desconocimiento"],
      ["band", "band", "Semáforo CSAT"],
    ];
    for (const [field, unit, label] of fields) {
      expect({
        id: `journey.${groupIndex}.${itemIndex}.${field}`,
        section: "journey",
        label: `${label} — ${touchpoint.label}`,
        unit,
        expected: touchpoint[field],
        cohort: "Miembros activos",
        denominator:
          field === "csat"
            ? `base válida = ${touchpoint.valid}`
            : field === "tdp"
              ? `base válida = ${touchpoint.valid}`
              : null,
        evidence: `snapshot.json#/journey/touchpoints[${snapshot.journey.touchpoints.indexOf(touchpoint)}]/${field}`,
        groupIndex,
        itemIndex,
        groupLabel: category,
        touchpointLabel: touchpoint.label,
        status: "expected",
      });
    }
  });
});

// ---- [6] qualitative --------------------------------------------------------
for (const group of snapshot.qualitative.groups) {
  if (group.id === "recorrido") {
    // Deliberately NOT compared. The phrases are consultant prose and the
    // comparison needs two rules no authority states.
    expect({
      id: "qualitative.recorrido",
      section: "qualitative",
      label: "Nube de frases curadas del recorrido",
      unit: "unresolved",
      expected: null,
      cohort: group.label,
      denominator: null,
      evidence: "snapshot.json#/qualitative/groups[id=recorrido]",
      status: "unresolved",
      unresolvedReason:
        "Reproducir esta nube exige una regla de segmentación de frases y una correspondencia entre " +
        "punto de contacto medido y etapa curada. Ninguna fuente autoritativa enuncia ninguna de las " +
        "dos: el tablero aprobado resuelve la segunda con una tabla de alias escrita a mano en su " +
        "propio script de construcción. Las frases curadas no se copian a este fixture.",
      observedShape: { total: group.total, termCount: group.terms.length },
    });
    continue;
  }
  expect({
    id: `qualitative.${group.id}.total`,
    section: "qualitative",
    label: `Menciones categorizadas — ${group.label}`,
    unit: "count",
    expected: group.total,
    cohort: group.label,
    denominator: null,
    evidence: `snapshot.json#/qualitative/groups[id=${group.id}]/total`,
    groupKey: group.id,
    status: "expected",
  });
  expect({
    id: `qualitative.${group.id}.excludedCount`,
    section: "qualitative",
    label: `Categoría excluida «${group.excludedLabel}» — ${group.label}`,
    unit: "count",
    expected: group.excludedCount,
    cohort: group.label,
    denominator: null,
    evidence: `snapshot.json#/qualitative/groups[id=${group.id}]/excludedCount`,
    groupKey: group.id,
    excludedLabel: group.excludedLabel,
    status: "expected",
  });
  for (const term of group.terms) {
    expect({
      id: `qualitative.${group.id}.term.${term.label}`,
      section: "qualitative",
      label: `«${term.label}» — ${group.label}`,
      unit: "count",
      expected: term.count,
      cohort: group.label,
      denominator: `menciones categorizadas = ${group.total}`,
      evidence: `snapshot.json#/qualitative/groups[id=${group.id}]/terms[label=${term.label}]/count`,
      groupKey: group.id,
      termLabel: term.label,
      status: "expected",
    });
  }
}

// ---- [7] structural expectations the canonical layer must also satisfy ------
expect({
  id: "journey.stageEvidence",
  section: "journey",
  label: "Vínculo entre indicador y etapa del recorrido",
  unit: "unresolved",
  expected: null,
  cohort: "n/a",
  denominator: null,
  evidence: "documentación integral §7.2 y §4.1; proyección canónica journeyEvidence vacío",
  status: "unresolved",
  unresolvedReason:
    "Ninguna fuente autoritativa enuncia qué indicador corresponde a qué etapa. El contrato canónico " +
    "debe declararlo sin resolver y emitir un reporte de brechas; el tablero aprobado no cuenta como " +
    "autoridad de cálculo en este punto.",
});
expect({
  id: "journey.unawareShare",
  section: "journey",
  label: "Proporción de desconocimiento sobre todas las respuestas del punto",
  unit: "unresolved",
  expected: null,
  cohort: "Miembros activos",
  denominator: "todas las respuestas del punto",
  evidence: "docs/CALCULATION_CATALOG.md §5 y documentación integral §7.1",
  status: "unresolved",
  unresolvedReason:
    "El tablero aprobado no publica esta cantidad: publica la razón sobre la base válida. Las dos " +
    "están documentadas y el conflicto es de NOMBRE, no de fórmula, así que no hay valor aprobado " +
    "contra el cual compararla.",
});

const fixture = {
  specVersion: SPEC_VERSION,
  study: "bni-cuicuilco",
  generatedFrom: {
    repository: "becommunity-bni-cuicuilco-demo",
    commit: head,
    file: "public/data/snapshot.json",
    snapshotSchemaVersion: snapshot.meta.schemaVersion,
    builtOn: snapshot.meta.builtOn,
    period: snapshot.meta.period,
    dataCut: snapshot.meta.dataCut,
  },
  rules: [
    "Los valores esperados provienen EXCLUSIVAMENTE del tablero aprobado. Nada en este archivo se " +
      "deriva de la salida del producto, y volver a generarlo no puede convertir una discrepancia en " +
      "un acierto.",
    "Un valor esperado no se modifica para que una prueba pase. Si el producto calcula distinto, la " +
      "compuerta se pone en rojo y la diferencia se documenta.",
    "Una expectativa 'unresolved' no es ni un acierto ni un fallo, y se cuenta aparte.",
    "Este archivo no contiene datos personales ni respuestas cualitativas textuales.",
  ],
  expectations,
};

mkdirSync(dirname(FIXTURE_PATH), { recursive: true });
writeFileSync(FIXTURE_PATH, `${JSON.stringify(fixture, null, 2)}\n`, "utf8");

const counted = expectations.reduce(
  (acc, entry) => {
    acc[entry.status] = (acc[entry.status] ?? 0) + 1;
    return acc;
  },
  {},
);
console.log(`Fixture escrito en ${FIXTURE_PATH}`);
console.log(`  tablero aprobado: ${head}`);
console.log(`  expectativas: ${expectations.length}`);
for (const [status, count] of Object.entries(counted).sort()) console.log(`    ${status}: ${count}`);
