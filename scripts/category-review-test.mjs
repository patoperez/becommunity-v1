// =============================================================================
// Unit 6B.4B2L — the canonical category review, offline
// =============================================================================
// It DRIVES the real modules. Every candidate below is produced by the real
// scanner, every projection by the real folder, every count by the real results
// builder, and every refusal by the real rule function. Nothing here re-states
// a rule in a regular expression when it could execute it instead.
//
// The three properties this gate exists to hold, in the order they matter:
//
//   1. A FAILED READ CANNOT BECOME AN EMPTY REVIEW. §[9] is the discrimination
//      proof: the value a failed ledger read produces has no `decisions`, no
//      `memory` and no `resolution` field at all, so no consumer can read a
//      projection off a read that never happened. Unit 6B.4B2K paid for the
//      other version of this once.
//   2. A GROUPING CHANGES HOW MANY CATEGORIES THERE ARE AND NEVER HOW MANY
//      ANSWERS. §[5] runs the real builder over a real source and compares
//      totals, bases and every absence state before and after.
//   3. NOTHING MERGES ANYTHING. §[3] and §[7]: the scanner produces questions,
//      the gate produces verdicts, and no path in the folder writes a decision.
// =============================================================================

import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import {
  CATEGORY_REFUSAL_DETAIL,
  CATEGORY_REVIEW_LIMITS,
  EMPTY_CATEGORY_RESOLUTION,
  blockingFindings,
  candidateImpact,
  categoryFindings,
  categoryLabelMap,
  countPanel,
  foldCategoryLabel,
  freshnessOf,
  groupedFolds,
  refuseCategoryDecision,
  resolutionFrom,
  resolutionIsEmpty,
  scanFamily,
  settledFolds,
  shareOf,
  sortedFolds,
} from "../src/lib/category-review/index.ts";
import {
  differsOnlyByInvisibles,
  digitsDiffer,
  looksNumeric,
  tokenSimilarity,
} from "../src/lib/category-review/normalize.ts";
import {
  categorySourceDigest,
  categorySourceVersion,
} from "../src/lib/category-review/digest.ts";
import { buildQualitativeGroups } from "../src/lib/results/qualitative.ts";
import { emptyResultSource } from "../src/lib/results/index.ts";
import { resolutionOf } from "../src/lib/studio/category-ledger.ts";

let executed = 0;
let failures = 0;
const check = (condition, label) => {
  executed += 1;
  if (condition) console.log(`  ✓ ${label}`);
  else {
    failures += 1;
    console.log(`  ✗ FAIL: ${label}`);
  }
};
const eq = (label, actual, expected) =>
  check(
    Object.is(actual, expected),
    `${label} = ${JSON.stringify(expected)}${Object.is(actual, expected) ? "" : ` (was ${JSON.stringify(actual)})`}`,
  );
const read = (path) => {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return "";
  }
};
/** Comments are stripped for NEGATIVE checks: these files DISCUSS what they do not do. */
const stripComments = (source) =>
  source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/.*$/gm, "$1 ");

console.log("Be Community — Unit 6B.4B2L: canonical category review");
console.log("=".repeat(78));

/* ========================================================================== */
console.log("\n[1] La capa pura es pura, y no hay asistente en ninguna parte");
/* ========================================================================== */
{
  const FOLDER = join("src", "lib", "category-review");
  const files = readdirSync(FOLDER).filter((name) => name.endsWith(".ts"));
  check(files.length >= 6, `la carpeta tiene ${files.length} módulos`);

  // `contract.ts` and `normalize.ts` import NOTHING. That is what lets a
  // `"use client"` component name them without acquiring an edge into the
  // canonical layer's import graph.
  for (const name of ["contract.ts", "normalize.ts"]) {
    const code = stripComments(read(join(FOLDER, name)));
    check(!/^\s*import\s/m.test(code), `${name} no importa nada en absoluto`);
  }

  // The barrel must NOT re-export the digest: it reaches the product's SHA-256,
  // which lives under the canonical commit layer.
  const barrel = read(join(FOLDER, "index.ts"));
  check(!/from "\.\/digest"/.test(barrel), "el barril no reexporta el módulo de huellas");
  check(/digest/.test(barrel), "y dice por qué, en el propio archivo");

  // NO AI ON THIS PATH AT ALL, and it is a fact about imports rather than about
  // a flag. The legacy feature this replaces shipped an OpenAI advisor behind
  // `EVALUATION_APPROVED = false`; a flag is configuration and an absent import
  // is structure.
  const AI = /openai|anthropic|\bllm\b|completion|systemPrompt|advisor|apiKey|API_KEY/i;
  const SURFACES = [
    ...files.map((name) => join(FOLDER, name)),
    join("src", "lib", "studio", "category-ledger.ts"),
    join("src", "lib", "studio", "category-review-workspace.ts"),
    join("src", "components", "studio", "publication", "CategoryReview.tsx"),
    join("src", "app", "studio", "e", "[studyId]", "revision", "categorias", "page.tsx"),
  ];
  for (const path of SURFACES) {
    const code = stripComments(read(path));
    check(code.length > 0, `${path} existe`);
    check(!AI.test(code), `${path} no nombra ningún asistente automático`);
    check(!/\bfetch\s*\(/.test(code), `${path} no alcanza la red por su cuenta`);
  }

  // THE WRITE PATH IS ONE FUNCTION IN ONE FILE. A second caller would be a
  // second place where the three grouping rules could be skipped.
  const WRITE = "record_canonical_category_decision";
  const named = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "node_modules" || entry.name === ".next") continue;
        walk(path);
        continue;
      }
      if (!/\.(ts|tsx)$/.test(entry.name)) continue;
      // COMMENTS ARE STRIPPED FIRST. Two modules DISCUSS this function by name —
      // the action's header says SQL re-authorizes independently, and the model's
      // says the database is the rule and the screen the courtesy. A scan that
      // could not tell a sentence from a call would forbid the sentence, which
      // is how a gate teaches people to stop explaining themselves.
      if (stripComments(read(path)).includes(WRITE)) named.push(path);
    }
  };
  walk("src");
  assert.ok(Array.isArray(named));
  check(
    named.length === 1 && named[0].endsWith("category-review-workspace.ts"),
    `exactamente un módulo de src/ nombra la función de escritura (${named.join(", ") || "ninguno"})`,
  );
}

/* ========================================================================== */
console.log("\n[2] Las reglas de comparación medidas siguen siendo las medidas");
/* ========================================================================== */
{
  // Ported from the production branch because the evaluation they carry — a
  // false-merge rate of 0/12 on a labelled fixture — is evidence about exactly
  // this code. These four are the guards that produced that number.
  check(digitsDiffer("1 a 5 empleados", "6 a 50 empleados"), "dos rangos con dígitos distintos se distinguen");
  check(!digitsDiffer("Tiempo", "tiempo"), "y dos frases sin dígitos no");
  check(looksNumeric("51% a 100%"), "«51% a 100%» se lee como número");
  check(!looksNumeric("Malos resultados financieros"), "y una frase no");
  check(
    differsOnlyByInvisibles("Tiempo​", "Tiempo"),
    "dos escrituras que sólo difieren en un carácter invisible se detectan",
  );
  check(
    tokenSimilarity("No he recuperado nada", "No recuperé nada") >= 0.6,
    "las dos redacciones del mismo cero se parecen por encima del umbral",
  );
  check(
    tokenSimilarity("Malos resultados financieros", "Cambio de titular") < 0.6,
    "y dos categorías distintas no",
  );
}

/* ========================================================================== */
console.log("\n[3] El escáner produce PREGUNTAS, y no se repite a sí mismo");
/* ========================================================================== */
const FAMILY = {
  key: "activos",
  label: "Miembros activos",
  coding: "source_coded",
  sourceDescription: "Categorías curadas",
  terms: [],
  excluded: [{ label: "No aplica", count: 9 }],
  sourceLabels: [
    { label: "Malos resultados financieros", count: 11 },
    { label: "Malos resultados financieros​", count: 2 },
    { label: "Mala actitud que no abre negocios", count: 4 },
    { label: "Tiempo", count: 3 },
    { label: "Situaciones personales", count: 1 },
  ],
  total: 21,
};
{
  const scan = scanFamily(FAMILY.key, FAMILY.sourceLabels);
  eq("una familia con una escritura invisible produce candidatas", scan.candidates.length, 1);
  const candidate = scan.candidates[0];
  eq("y la explica con la regla más fuerte", candidate.rule, "unicode");
  eq("sobre dos categorías", candidate.memberFolds.length, 2);
  eq("que afectan a 13 respuestas", candidate.affectedCount, 13);
  check(
    candidate.suggestedLabel === "Malos resultados financieros",
    "y propone la escritura que más respuestas usaron",
  );

  // A SETTLED QUESTION IS NOT A QUESTION. The same family, with the pair already
  // decided, produces nothing.
  const decided = [
    {
      decisionId: "d1",
      familyKey: "activos",
      memberFolds: candidate.memberFolds,
      memberLabels: candidate.values.map((v) => v.label),
      sourceDigest: "0".repeat(64),
      disposition: "separate",
      canonicalKey: null,
      canonicalLabel: null,
      rationale: null,
      version: 1,
      decidedAt: "2026-09-15T00:00:00Z",
    },
  ];
  const again = scanFamily(FAMILY.key, FAMILY.sourceLabels, settledFolds(decided, "activos"));
  eq("una pareja ya decidida no se vuelve a proponer", again.candidates.length, 0);

  // Two spellings that FOLD together are already one category everywhere.
  const folded = scanFamily("x", [
    { label: "Tiempo", count: 3 },
    { label: "tiempo", count: 1 },
  ]);
  eq("dos escrituras que ya se pliegan juntas no son una pregunta", folded.candidates.length, 0);

  // A negation asymmetry is never proposed on resemblance.
  const negated = scanFamily("x", [
    { label: "Lo recomendaria", count: 4 },
    { label: "No lo recomendaria", count: 3 },
  ]);
  eq("una negación asimétrica no se propone", negated.candidates.length, 0);

  const wide = scanFamily(
    "x",
    Array.from({ length: CATEGORY_REVIEW_LIMITS.maxFamilyLabels + 1 }, (_, i) => ({
      label: `etiqueta ${i}`,
      count: 1,
    })),
  );
  check(wide.tooWide && wide.candidates.length === 0, "una familia demasiado ancha se declara tal, sin candidatas");
  check(wide.boundNote !== null, "y lo explica en una frase");
}

/* ========================================================================== */
console.log("\n[4] «En vigor» es la versión más alta, y sólo agrupar proyecta");
/* ========================================================================== */
const decision = (over) => ({
  decisionId: "d",
  familyKey: "activos",
  memberFolds: ["a", "b"],
  memberLabels: ["A", "B"],
  sourceDigest: "0".repeat(64),
  disposition: "grouped",
  canonicalKey: "nombre",
  canonicalLabel: "Nombre",
  rationale: null,
  version: 1,
  decidedAt: "2026-09-15T00:00:00Z",
  ...over,
});
{
  check(resolutionIsEmpty(EMPTY_CATEGORY_RESOLUTION), "la resolución vacía está vacía");
  check(resolutionIsEmpty(resolutionFrom([])), "y un estudio sin decisiones produce una vacía");

  for (const disposition of ["separate", "postponed", "revoked"]) {
    const resolution = resolutionFrom([decision({ disposition, canonicalLabel: null, canonicalKey: null })]);
    check(resolutionIsEmpty(resolution), `«${disposition}» no proyecta nada`);
  }

  const grouped = resolutionFrom([decision({})]);
  eq("una agrupación proyecta una entrada", grouped.groups.activos.length, 1);
  const map = categoryLabelMap(grouped, "activos");
  eq("y el mapa lleva cada pliegue al nombre elegido", map.get("a"), "Nombre");
  eq("sin tocar ninguna otra familia", categoryLabelMap(grouped, "desertores").size, 0);

  // DETERMINISTIC ORDER. Two builds of the same ledger must produce the same
  // object, or two builds of the same evidence produce different documents.
  const one = resolutionFrom([
    decision({ memberFolds: ["m", "n"], canonicalLabel: "N1" }),
    decision({ memberFolds: ["c", "d"], canonicalLabel: "N2" }),
  ]);
  const other = resolutionFrom([
    decision({ memberFolds: ["c", "d"], canonicalLabel: "N2" }),
    decision({ memberFolds: ["m", "n"], canonicalLabel: "N1" }),
  ]);
  eq(
    "el orden de la proyección no depende del orden de lectura",
    JSON.stringify(one),
    JSON.stringify(other),
  );

  eq("los pliegues agrupados se reconocen", [...groupedFolds([decision({})], "activos")].sort().join(","), "a,b");
  eq("y un «separate» también cuenta como decidido", [...settledFolds([decision({ disposition: "separate", canonicalLabel: null, canonicalKey: null })], "activos")].sort().join(","), "a,b");
  eq("pero un «revoked» reabre la pregunta", settledFolds([decision({ disposition: "revoked", canonicalLabel: null, canonicalKey: null })], "activos").size, 0);
}

/* ========================================================================== */
console.log("\n[5] Agrupar cambia CUÁNTAS categorías hay y nunca cuántas respuestas");
/* ========================================================================== */
{
  // THE REAL BUILDER, over a real source. Seven people answer a closed-coded
  // category item; two of them wrote the same answer two ways, and one is the
  // documented exclusion.
  const IDENTITY = {
    specId: "fixture",
    mappingVersion: 1,
    tenantId: "11111111-1111-4111-8111-111111111111",
    studyId: "22222222-2222-4222-8222-222222222222",
    packageIdempotencyKey: "sha256:fixture",
    planFingerprint: "sha256:fixture",
  };
  const PEOPLE = ["p1", "p2", "p3", "p4", "p5", "p6", "p7"];
  const ANSWERS = [
    "Malos resultados financieros",
    "Malos resultados financieros",
    "Malos resultados financieros​",
    "Mala actitud",
    "Tiempo",
    null, // not_applicable — the documented exclusion
    "Tiempo",
  ];

  const source = emptyResultSource(IDENTITY);
  source.participants = PEOPLE.map((id) => ({
    participantId: id,
    cohortKey: "active",
    participationStatus: "included",
    surveyParticipationStatus: "answered",
    sourceStatus: "answered",
  }));
  source.instruments = [{ key: "cri", label: "CRI", audience: "activos", instrumentType: "index" }];
  source.items = [
    { key: "cri_e", label: "Categoría de riesgo", instrumentKey: "cri", domainKey: null, scaleKey: null, itemOrder: 0 },
  ];
  source.sessions = PEOPLE.map((id) => ({
    sessionId: `s-${id}`,
    instrumentKey: "cri",
    participantId: id,
    status: "answered",
  }));
  source.answers = PEOPLE.map((id, index) => ({
    sessionId: `s-${id}`,
    itemKey: "cri_e",
    status: ANSWERS[index] === null ? "not_applicable" : "answered",
    numeric: null,
    text: ANSWERS[index],
    optionKey: null,
    derivedLabel: null,
  }));

  const SPEC = {
    specId: "fixture",
    mappingVersion: 1,
    calculationVersion: "fixture",
    cohorts: [{ key: "active", label: "Activos", instrumentKey: "cri" }],
    qualitative: [
      {
        key: "activos",
        label: "Miembros activos",
        itemKey: "cri_e",
        cohortKeys: ["active"],
        sourceDescription: "Categorías curadas",
        excludedLabels: [{ label: "No aplica", canonicalStatus: "not_applicable" }],
        authorityIds: [],
      },
    ],
  };
  const scope = { participantIds: new Set(PEOPLE), filtered: false };

  const before = buildQualitativeGroups(source, SPEC, scope)[0];
  eq("sin decisiones hay cuatro categorías", before.terms.length, 4);
  eq("y la más usada tiene 2", before.terms[0].count, 2);
  eq("«No aplica» se reporta aparte", before.excluded[0].count, 1);
  eq("y el total contado es 6", before.total, 6);

  const resolution = resolutionFrom([
    decision({
      memberFolds: sortedFolds(["Malos resultados financieros", "Malos resultados financieros​"]),
      memberLabels: ["Malos resultados financieros", "Malos resultados financieros​"],
      canonicalLabel: "Malos resultados financieros",
    }),
  ]);
  const after = buildQualitativeGroups(source, SPEC, scope, undefined, resolution)[0];

  eq("con la decisión hay tres categorías", after.terms.length, 3);
  eq("la agrupada tiene 3", after.terms[0].count, 3);
  eq("y se llama como se decidió", after.terms[0].label, "Malos resultados financieros");
  // THE INVARIANT. Everything a number rests on is identical.
  eq("el total de respuestas NO cambia", after.total, before.total);
  eq("la base tampoco", JSON.stringify(after.base), JSON.stringify(before.base));
  eq("ni el conteo de la exclusión", JSON.stringify(after.excluded), JSON.stringify(before.excluded));
  eq(
    "las proporciones siguen sumando lo mismo",
    after.terms.reduce((t, x) => t + x.count, 0),
    before.terms.reduce((t, x) => t + x.count, 0),
  );

  // AND THE EXCLUSION CANNOT BE REACHED FROM THE SIDE: a grouping naming the
  // excluded label changes nothing, because the exclusion is applied first.
  const reaching = resolutionFrom([
    decision({
      memberFolds: sortedFolds(["No aplica", "Tiempo"]),
      memberLabels: ["No aplica", "Tiempo"],
      canonicalLabel: "Colado",
    }),
  ]);
  const guarded = buildQualitativeGroups(source, SPEC, scope, undefined, reaching)[0];
  eq("una agrupación no puede sacar a «No aplica» de su exclusión", JSON.stringify(guarded.excluded), JSON.stringify(before.excluded));
  eq("y el total sigue sin moverse", guarded.total, before.total);

  // THE DEFAULT IS BYTE-IDENTICAL TO THE DOCUMENT THIS BUILDER PRODUCED BEFORE
  // THE PROJECTION EXISTED. That is what keeps golden parity a measurement.
  eq(
    "omitir la resolución y pasar la vacía dan el mismo documento",
    JSON.stringify(buildQualitativeGroups(source, SPEC, scope, undefined, EMPTY_CATEGORY_RESOLUTION)[0]),
    JSON.stringify(before),
  );
}

/* ========================================================================== */
console.log("\n[6] Cada negativa tiene un código cerrado, y todos se alcanzan");
/* ========================================================================== */
{
  const family = { ...FAMILY, terms: [], sourceLabels: FAMILY.sourceLabels };
  const base = {
    familyKey: "activos",
    memberLabels: ["Tiempo", "Situaciones personales"],
    disposition: "grouped",
    canonicalLabel: "Tiempo y situaciones",
    rationale: null,
  };
  eq("una decisión correcta no se rechaza", refuseCategoryDecision(base, family, []), null);
  eq("una familia desconocida", refuseCategoryDecision({ ...base, familyKey: "otra" }, family, []), "family_unknown");
  eq("familia ausente", refuseCategoryDecision(base, undefined, []), "family_unknown");
  eq("una sola categoría", refuseCategoryDecision({ ...base, memberLabels: ["Tiempo"] }, family, []), "too_few_members");
  eq(
    "demasiadas categorías",
    refuseCategoryDecision(
      { ...base, memberLabels: Array.from({ length: 13 }, (_, i) => `x${i}`) },
      { ...family, sourceLabels: Array.from({ length: 13 }, (_, i) => ({ label: `x${i}`, count: 1 })) },
      [],
    ),
    "too_many_members",
  );
  eq(
    "una respuesta que ya no está en el estudio",
    refuseCategoryDecision({ ...base, memberLabels: ["Tiempo", "Inventada"] }, family, []),
    "members_not_current",
  );
  eq("un nombre vacío", refuseCategoryDecision({ ...base, canonicalLabel: "   " }, family, []), "name_required");
  eq(
    "un nombre demasiado largo",
    refuseCategoryDecision({ ...base, canonicalLabel: "x".repeat(201) }, family, []),
    "name_too_long",
  );
  eq(
    "posponer sin explicación",
    refuseCategoryDecision({ ...base, disposition: "postponed", canonicalLabel: null, rationale: "corto" }, family, []),
    "reason_required",
  );
  eq(
    "posponer con explicación",
    refuseCategoryDecision(
      { ...base, disposition: "postponed", canonicalLabel: null, rationale: "falta confirmarlo con el equipo" },
      family,
      [],
    ),
    null,
  );
  eq(
    "deshacer lo que nadie decidió",
    refuseCategoryDecision({ ...base, disposition: "revoked", canonicalLabel: null }, family, []),
    "nothing_to_undo",
  );

  // THE THREE RULES A FLAT GROUPING NEEDS, each refused by its own code.
  const other = decision({
    memberFolds: sortedFolds(["Tiempo", "Mala actitud que no abre negocios"]),
    memberLabels: ["Tiempo", "Mala actitud que no abre negocios"],
    canonicalLabel: "Otra cosa",
  });
  eq(
    "una respuesta ya agrupada en otra categoría",
    refuseCategoryDecision(base, family, [other]),
    "member_already_grouped",
  );
  const named = decision({
    memberFolds: sortedFolds(["Malos resultados financieros", "Malos resultados financieros​"]),
    memberLabels: ["Malos resultados financieros", "Malos resultados financieros​"],
    canonicalLabel: "Tiempo y situaciones",
  });
  eq("un nombre que ya existe en la familia", refuseCategoryDecision(base, family, [named]), "name_conflicts");
  const chained = decision({
    memberFolds: sortedFolds(["Malos resultados financieros", "Tiempo y situaciones"]),
    memberLabels: ["Malos resultados financieros", "Tiempo y situaciones"],
    canonicalLabel: "Tercera",
  });
  eq(
    "un nombre que ya es miembro de otro grupo",
    refuseCategoryDecision(base, { ...family, sourceLabels: [...family.sourceLabels, { label: "Tiempo y situaciones", count: 1 }] }, [chained]),
    "name_is_a_member",
  );

  for (const [code, sentence] of Object.entries(CATEGORY_REFUSAL_DETAIL)) {
    check(typeof sentence === "string" && sentence.length > 20, `«${code}» tiene una frase en español`);
    check(!/[0-9a-f]{32}/.test(sentence), `y «${code}» no lleva ninguna huella dentro`);
  }
}

/* ========================================================================== */
console.log("\n[7] Lo que detiene una publicación, y lo que nunca puede");
/* ========================================================================== */
{
  const family = { ...FAMILY, total: 21 };
  const scan = scanFamily(family.key, family.sourceLabels);
  const findings = categoryFindings(family, scan);
  eq("la pareja invisible produce un hallazgo", findings.length, 1);
  eq("y DETIENE la publicación", findings[0].verdict, "blocks");

  // An accent difference over one answer in a large family only warns.
  const small = {
    ...family,
    total: 100,
    sourceLabels: [
      { label: "Publico", count: 1 },
      { label: "Público", count: 1 },
      { label: "Otra", count: 98 },
    ],
  };
  const smallFindings = categoryFindings(small, scanFamily(small.key, small.sourceLabels));
  eq("una diferencia de acentos sobre pocas respuestas advierte", smallFindings[0]?.verdict, "warns");

  const material = {
    ...small,
    total: 20,
    sourceLabels: [
      { label: "Publico", count: 5 },
      { label: "Público", count: 5 },
      { label: "Otra", count: 10 },
    ],
  };
  const materialFindings = categoryFindings(material, scanFamily(material.key, material.sourceLabels));
  eq("y la misma diferencia sobre una parte material detiene", materialFindings[0]?.verdict, "blocks");

  // A WORDING RESEMBLANCE NEVER BLOCKS.
  const resembling = {
    ...family,
    total: 20,
    sourceLabels: [
      { label: "No he recuperado nada", count: 10 },
      { label: "No recuperé nada", count: 10 },
    ],
  };
  const fuzzy = categoryFindings(resembling, scanFamily(resembling.key, resembling.sourceLabels));
  eq("un parecido de redacción se detecta", fuzzy.length, 1);
  eq("y NUNCA detiene una publicación", fuzzy[0].verdict, "warns");

  const panel = {
    families: [
      { family, sourceVersion: "v", scan, candidates: scan.candidates, findings, decided: [], memory: [] },
    ],
    canDecide: true,
    counts: countPanel([{ family, sourceVersion: "v", scan, candidates: scan.candidates, findings, decided: [], memory: [] }]),
  };
  eq("el panel cuenta una familia", panel.counts.families, 1);
  eq("una candidata", panel.counts.candidates, 1);
  eq("y un bloqueo", panel.counts.blocking, 1);
  eq("que se puede enumerar", blockingFindings(panel).length, 1);

  // THE GATE READS NO CONFIDENCE, because there is none to read.
  const source = stripComments(read(join("src", "lib", "category-review", "model.ts")));
  check(!/confidence|probabil|score\b/i.test(source), "el módulo de veredictos no lee ninguna confianza");
}

/* ========================================================================== */
console.log("\n[8] Una decisión caduca sola cuando la familia se mueve");
/* ========================================================================== */
{
  const words = {
    key: "activos",
    coding: "source_coded",
    sourceLabels: FAMILY.sourceLabels.map((v) => v.label),
    excludedLabels: ["No aplica"],
  };
  const digest = categorySourceDigest(words);
  check(/^[0-9a-f]{64}$/.test(digest), "la huella de la familia es un sha256");
  eq("y es determinista", categorySourceDigest(words), digest);
  eq(
    "el orden de las etiquetas no la mueve",
    categorySourceDigest({ ...words, sourceLabels: [...words.sourceLabels].reverse() }),
    digest,
  );
  check(
    categorySourceDigest({ ...words, sourceLabels: [...words.sourceLabels, "Nueva"] }) !== digest,
    "una categoría nueva sí la mueve",
  );
  check(
    categorySourceDigest({ ...words, excludedLabels: [] }) !== digest,
    "y quitar una exclusión también",
  );
  const marker = categorySourceVersion(digest);
  check(/^v[a-z2-7]{8}$/.test(marker), `el marcador que ve el navegador es opaco (${marker})`);
  check(!digest.startsWith(marker.slice(1)), "y no es un prefijo legible de la huella");

  const family = { ...FAMILY };
  const fresh = decision({
    memberFolds: sortedFolds(["Tiempo", "Situaciones personales"]),
    memberLabels: ["Tiempo", "Situaciones personales"],
    sourceDigest: digest,
  });
  eq("una decisión sobre la familia de ahora está fresca", freshnessOf(fresh, family, digest), "fresh");
  eq(
    "una tomada sobre otra lista se marca",
    freshnessOf({ ...fresh, sourceDigest: "1".repeat(64) }, family, digest),
    "context_changed",
  );
  eq(
    "y una cuyo miembro ya no está se marca distinto",
    freshnessOf({ ...fresh, memberFolds: ["tiempo", "inventada"] }, family, digest),
    "member_absent",
  );
}

/* ========================================================================== */
console.log("\n[9] DISCRIMINACIÓN: una lectura fallida no puede volverse una revisión vacía");
/* ========================================================================== */
{
  // THE PROOF IS STRUCTURAL, not a comparison of two numbers. A failed read
  // produces a value of a DIFFERENT TYPE, with no field a consumer could read a
  // projection off. Unit 6B.4B2K's journey-pain review earned this section.
  const failed = resolutionOf({ kind: "unavailable", code: "TIMED_OUT", detail: "…" });
  eq("una lectura fallida no es «ok»", failed.ok, false);
  check(!("resolution" in failed), "y no lleva ninguna resolución");
  check(!("decisions" in failed), "ni ninguna lista de decisiones");
  check(!("memory" in failed), "ni ninguna memoria");
  check("code" in failed && "detail" in failed, "lleva un código y una frase, y nada más");

  // A LEDGER THAT DOES NOT EXIST IS A DIFFERENT ANSWER, and it IS the empty
  // projection — because nothing can have been decided where nothing can record
  // a decision. That is the distinction, and it is drawn on the error code.
  const missing = resolutionOf({ kind: "not_provisioned" });
  eq("un historial no aprovisionado sí responde", missing.ok, true);
  check(resolutionIsEmpty(missing.resolution), "con la proyección vacía, que es la verdadera");

  const ready = resolutionOf({ kind: "ready", decisions: [decision({})], memory: [] });
  eq("y un historial que respondió proyecta lo que dice", ready.ok, true);
  check(!resolutionIsEmpty(ready.resolution), "sin confundirse con el vacío");

  // The three states are told apart by CODE, never by an empty result.
  const ledger = stripComments(read(join("src", "lib", "studio", "category-ledger.ts")));
  check(/PGRST202/.test(ledger) && /42883/.test(ledger), "el lector distingue por código, no por vacío");
  check(
    /NOT_PROVISIONED_CODES = new Set\(\["PGRST202", "42883"\]\)/.test(ledger),
    "y esa lista tiene exactamente dos miembros",
  );
  check(!/catch\s*\{\s*return\s*\{\s*kind:\s*"ready"/.test(ledger), "ningún catch devuelve «ready»");

  // AND THE DOOR FAILS THE WHOLE LOAD rather than continuing with an unknown
  // projection.
  const loader = stripComments(read(join("src", "lib", "studio", "presentation-workspace.ts")));
  check(
    /if \(!projection\.ok\) throw new CategoryLedgerError/.test(loader),
    "la puerta canónica lanza cuando la proyección es desconocida",
  );
  check(
    /error instanceof CategoryLedgerError/.test(loader),
    "y su negativa se traduce a la indisponibilidad tipada que toda pantalla ya dibuja",
  );
}

/* ========================================================================== */
console.log("\n[10] La migración dice en SQL lo que la aplicación dice en TypeScript");
/* ========================================================================== */
{
  const sql = read(join("supabase", "migrations", "0034_canonical_category_review.sql"));
  check(sql.length > 4000, "la migración existe y no está vacía");
  check(/create table public\.canonical_category_decision/.test(sql), "crea su propia tabla");
  check(!/alter table public\.(?!canonical_category_decision)/.test(sql), "y no altera ninguna otra");
  for (const forbidden of ["survey_response", "survey_item", "response_option", "segment_dimension"]) {
    const body = sql.slice(sql.indexOf("begin;"));
    check(!new RegExp(`(insert into|update|delete from)\\s+public\\.${forbidden}`).test(body), `no escribe en ${forbidden}`);
  }
  check(/enable row level security/.test(sql) && /force row level security/.test(sql), "activa y fuerza RLS");
  check(/create policy "deny_browser_roles"/.test(sql), "niega explícitamente a los roles del navegador");
  check(
    /revoke all privileges on table public\.canonical_category_decision from service_role/.test(sql),
    "revoca todo a service_role",
  );
  check(
    /grant select on table public\.canonical_category_decision to service_role/.test(sql),
    "y le devuelve SELECT y nada más",
  );
  check(/create unique index canonical_category_decision_chain_idx/.test(sql), "la cadena de versiones tiene un índice único");
  check(/pg_advisory_xact_lock/.test(sql), "la escritura toma el cerrojo del estudio");
  check(/p_expected_version/.test(sql), "y comprueba la versión que la pantalla mostró");
  check(/errcode = '42501'/.test(sql), "un actor no interno es rechazado");
  check(/errcode = '55000'/.test(sql), "un conflicto usa el código de conflicto del repositorio");
  check(/errcode = '23505'/.test(sql), "y las tres reglas de agrupación usan el de duplicado");
  check(/'created', false/.test(sql), "una decisión idéntica se devuelve en vez de duplicarse");
  check(/language sql\s+stable\s+security definer/.test(sql), "la lectura es stable y security definer");
  check(
    /revoke execute on function public\.read_canonical_category_decisions\(uuid, uuid\)\s+from public, anon, authenticated/.test(sql),
    "y su ejecución está revocada a PUBLIC, anon y authenticated",
  );
  check(/d\.study_id <> scope\.id/.test(sql), "la memoria de otros estudios excluye el propio");
  check(/join scope on scope\.tenant_id = d\.tenant_id/.test(sql), "y está acotada por el inquilino de la FILA del estudio");

  const rollback = read(join("supabase", "rollbacks", "0034_drop_canonical_category_review.sql"));
  check(/drop table if exists public\.canonical_category_decision/.test(rollback), "el rollback existe y suelta su tabla");
  check(!/category_decision;/.test(rollback.replace(/canonical_category_decision/g, "")), "y no toca el historial pre-canónico");
}

/* ========================================================================== */
console.log("\n[11] La superficie no publica nada interno, y no cuenta nada");
/* ========================================================================== */
{
  const component = read(join("src", "components", "studio", "publication", "CategoryReview.tsx"));
  const code = stripComments(component);
  check(/"use client"/.test(component), "el componente es de cliente");
  check(!/@\/lib\/studio\//.test(code), "y no importa ningún módulo de servidor");
  check(!/\.rpc\(|createAdminClient|@supabase/.test(code), "ni alcanza ningún transporte");
  check(/decide:/.test(code), "recibe la acción como propiedad, no por importación");
  check(!/[0-9a-f]{64}/.test(code), "no lleva ninguna huella literal");
  check(!/familyKey}</.test(code), "y no imprime la clave de la familia en pantalla");
  check(/defaultValue=/.test(code), "el nombre se escribe en un campo no controlado");

  const page = read(join("src", "app", "studio", "e", "[studyId]", "revision", "categorias", "page.tsx"));
  const pageCode = stripComments(page);
  const gate = pageCode.indexOf("await requireInternal()");
  check(gate >= 0, "la página llama a requireInternal()");
  for (const reader of ["await params", "loadStudioStudy(", "loadCategoryReview(", "admin."]) {
    const at = pageCode.indexOf(reader);
    check(at < 0 || at > gate, `y lo hace antes de «${reader}»`);
  }
  check(/z\.string\(\)\.uuid\(\)\.safeParse\(studyId\)/.test(pageCode), "valida el estudio como UUID");
  for (const writer of [".insert(", ".update(", ".upsert(", ".delete(", ".rpc(", "revalidatePath"]) {
    check(!pageCode.includes(writer), `la página no hace ${writer}`);
  }
  // The heading BRANCHES: «there is nothing to review» is about the study and is
  // false when a read failed.
  check(
    /no_canonical_package"\s*\?\s*"Todavía no hay categorías que revisar"/.test(pageCode),
    "la ausencia de paquete y la lectura fallida no comparten frase",
  );

  const workspace = stripComments(read(join("src", "lib", "studio", "category-review-workspace.ts")));
  check(/import "server-only"/.test(read(join("src", "lib", "studio", "category-review-workspace.ts"))), "el espacio de trabajo es server-only");
  check(
    (workspace.match(/from "\.\/presentation-workspace"/g) ?? []).length === 1,
    "y alcanza la capa canónica por UNA sola sentencia de importación",
  );
  check(!/@\/lib\/canonical-source/.test(workspace), "sin ninguna arista propia hacia el lector canónico");
  check(!/p_source_digest:\s*input\./.test(workspace), "la huella nunca viene del llamante");
  check(/categorySourceDigest\(/.test(workspace), "sino que se recalcula en el servidor");
}

/* ========================================================================== */
console.log("\n[12] La ayuda visual no es una autoridad");
/* ========================================================================== */
{
  const family = { ...FAMILY, total: 21 };
  const impact = candidateImpact(
    family,
    sortedFolds(["Malos resultados financieros", "Malos resultados financieros​"]),
    "Malos resultados financieros",
  );
  eq("el antes muestra las dos escrituras", impact.before.length, 2);
  eq("el después suma sus respuestas", impact.after.count, 13);
  eq("una categoría menos", impact.groupsAfter, impact.groupsBefore - 1);
  check(impact.totalsUnchanged, "y el total de respuestas no cambia");
  eq("una proporción sin base es cero", shareOf(3, 0), 0);
  eq("y con base es la división", shareOf(3, 6), 0.5);
  eq("el pliegue es minúsculas y espacios", foldCategoryLabel("  Malos   Resultados "), "malos resultados");
}

console.log(`\n${"=".repeat(78)}`);
console.log(
  failures === 0
    ? `RESULTADO: ${executed} comprobaciones, ${executed} correctas. COMPUERTA APROBADA.`
    : `RESULTADO: ${failures} fallo(s) de ${executed}. COMPUERTA BLOQUEADA.`,
);
process.exit(failures === 0 ? 0 : 1);
