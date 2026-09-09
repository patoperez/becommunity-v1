// =============================================================================
// UNIT 6B.4B2C — THE JOURNEY PAIN REVIEW AND THE SIGN-OFF BOUNDARY, OFFLINE
// =============================================================================
//   npm run test:journey-pain-review        (in `npm test`)
//
// Synthetic, offline, and it drives the REAL functions rather than copies of
// them. No database, no network, no clock, no randomness.
//
// WHAT IT PROVES, IN THE ORDER THE PHASE ASKS FOR IT:
//
//   [1]  the sign-off digest is DERIVED ON THE SERVER: there is no digest
//        parameter, field or return path anywhere on the browser's path, and
//        the value that is recorded is the one the server computed;
//   [2]  no digest and no PII can cross the browser contract — asserted over the
//        TYPES, so a future field is a red gate rather than a leak;
//   [3]  authorization precedes the curated-evidence read, in source order;
//   [4]  the mapping is EXPLICIT ONLY: nothing compares a source phrase with a
//        touchpoint label, and no alias table is reachable;
//   [5]  one phrase may map to MANY touchpoints, and does;
//   [6]  stale source evidence reopens the review;
//   [7]  a complete review authorizes content and an incomplete one authorizes
//        none — all five conditions, each on its own;
//   [8]  rejected and unresolved items are excluded from what is published;
//   [9]  the cloud aggregates and the touchpoints get badges, from one pass;
//   [10] and the same phrase over three points is counted ONCE in the cloud;
//   [11] no dependency on the approved demo's alias table exists anywhere;
//   [12] the client render model carries no internal review metadata;
//   [13] the opaque identities are opaque, stable, and never hexadecimal;
//   [14] the source digest covers the words and not the count.
// =============================================================================

import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";

import { buildJourneyPainContent } from "../src/lib/presentation/journey-pain.ts";
import { resolvePresentation } from "../src/lib/presentation/resolve.ts";
import {
  painItemToken,
  painSourceDigest,
  painSourceVersion,
} from "../src/lib/publication/journey-pain-digest.ts";
import {
  qualitativeEvidenceDigest,
  qualitativeGroupToken,
  qualitativeTokensMatch,
} from "../src/lib/publication/evidence-digest.ts";
import {
  authoredPainContent,
  buildPainReviewItems,
  painReviewCounts,
  painReviewGaps,
  painTouchpointChoices,
} from "../src/lib/publication/journey-pain-model.ts";
import { runPublicationPreflight } from "../src/lib/publication/preflight.ts";
import { clientSeesBlock } from "../src/lib/presentation/visibility.ts";
import { CLIENT_SURFACE_IS_LIVE } from "../src/lib/publication/contract.ts";

/* -------------------------------------------------------------------------- */

let failures = 0;
let executed = 0;
const check = (condition, message) => {
  if (typeof message !== "string") {
    failures += 1;
    console.log("  ✗ FALLO: check() recibió un mensaje que no es texto — ¿argumentos al revés?");
    return;
  }
  executed += 1;
  if (condition) console.log(`  ✓ ${message}`);
  else {
    failures += 1;
    console.log(`  ✗ FALLO: ${message}`);
  }
};
const eq = (label, actual, expected) =>
  check(
    Object.is(actual, expected),
    `${label} = ${JSON.stringify(expected)}${Object.is(actual, expected) ? "" : ` (fue ${JSON.stringify(actual)})`}`,
  );

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

console.log("Be Community — Unit 6B.4B2C: la revisión editorial del recorrido, sin base de datos");
console.log("=".repeat(84));

/* -------------------------------------------------------------------------- */
/* the fixture: a synthetic study whose wording resembles nothing              */
/* -------------------------------------------------------------------------- */

/**
 * THE SENTINELS ARE THE POINT.
 *
 * Every phrase, stage label and touchpoint label below is a string that exists
 * nowhere else, and the stage labels are DELIBERATELY NOTHING LIKE the
 * touchpoint labels — no shared prefix, no shared word, no shared length. A
 * fixture whose stages resembled its touchpoints would let a similarity rule
 * pass §[4] by accident, and §[4] is the assertion this unit exists for.
 */
const STAGES = [
  { id: "s-aaaa", label: "ETAPA-ZQX-uno", stageOrder: 0 },
  { id: "s-bbbb", label: "ETAPA-ZQX-dos", stageOrder: 1 },
  { id: "s-cccc", label: "ETAPA-ZQX-tres", stageOrder: 2 },
];
const PAIN = [
  { id: "p-1111", normalizedText: "FRASE-KWJ-alfa", reviewStatus: "pending" },
  { id: "p-2222", normalizedText: "FRASE-KWJ-beta", reviewStatus: "pending" },
  { id: "p-3333", normalizedText: "FRASE-KWJ-gama", reviewStatus: "pending" },
  // The SAME curated phrase, in a different stage. Two source items, one phrase.
  { id: "p-4444", normalizedText: "FRASE-KWJ-alfa", reviewStatus: "pending" },
  // Attached to NO journey stage: it belongs to another curated dimension and
  // is deliberately out of scope. §[7] proves it is neither shown nor a gap.
  { id: "p-5555", normalizedText: "FRASE-KWJ-fuera", reviewStatus: "pending" },
];
const LINKS = [
  { painPointId: "p-1111", journeyStageId: "s-aaaa", displayOrder: 0 },
  { painPointId: "p-2222", journeyStageId: "s-bbbb", displayOrder: 0 },
  { painPointId: "p-3333", journeyStageId: "s-cccc", displayOrder: 0 },
  { painPointId: "p-4444", journeyStageId: "s-bbbb", displayOrder: 1 },
];
const EVIDENCE = { painPoints: PAIN, stageLinks: LINKS, stages: STAGES };
const STUDY = "99999999-9999-4999-8999-999999999999";

const TOKENS = Object.fromEntries(PAIN.map((row) => [row.id, painItemToken(STUDY, row.id)]));

const digestOf = (id) => {
  const row = PAIN.find((entry) => entry.id === id);
  const link = LINKS.find((entry) => entry.painPointId === id);
  const stage = STAGES.find((entry) => entry.id === link?.journeyStageId);
  return painSourceDigest({
    token: TOKENS[id],
    curatedPhrase: row.normalizedText,
    sourceContext: stage?.label ?? "",
    sourceStatus: row.reviewStatus,
  });
};

/** Three touchpoints across two visible routes, with labels nothing resembles. */
const CHOICES = [
  { handle: "journey-touchpoint:pt-uno", label: "PUNTO-VHM-primero", routeTitle: "RUTA-A" },
  { handle: "journey-touchpoint:pt-dos", label: "PUNTO-VHM-segundo", routeTitle: "RUTA-A" },
  { handle: "journey-touchpoint:pt-tres", label: "PUNTO-VHM-tercero", routeTitle: "RUTA-B" },
];

const decide = (id, over = {}) => ({
  itemKey: TOKENS[id],
  sourceDigest: digestOf(id),
  disposition: "approved",
  publicPhrase: "PUBLICO-" + id,
  touchpoints: [CHOICES[0].handle],
  rationale: null,
  decidedAt: "2026-09-09T00:00:00.000Z",
  ...over,
});

/* -------------------------------------------------------------------------- */
console.log("\n[1] La huella de la revisión cualitativa se DERIVA en el servidor");

const actionSource = read("src/app/studio/e/[studyId]/revision/actions.ts");
const payloadSource = read("src/lib/publication/payload.ts");
const workspaceSource = read("src/lib/studio/publication-workspace.ts");
const viewSource = read("src/components/studio/publication/PublicationReviewView.tsx");

// THE PARAMETER IS GONE. Asserted over the declared signature rather than over
// prose: a parameter that came back would be caught by name.
const signOffSignature = /export async function recordCanonicalQualitativeSignOff\(([^)]*)\)/.exec(
  actionSource,
);
check(signOffSignature !== null, "la acción de firma está declarada y su firma es legible");
check(
  signOffSignature !== null && !/digest/i.test(signOffSignature[1]),
  "y ninguno de sus parámetros es una huella",
);
check(
  signOffSignature !== null && /reviewedDraftRevision/.test(signOffSignature[1]),
  "sí recibe la REVISIÓN que se estaba revisando",
);
check(
  signOffSignature !== null && /groupTokens/.test(signOffSignature[1]),
  "y las identidades opacas de los grupos que había en pantalla",
);

check(
  !/evidenceDigest/.test(payloadSource.split("export type QualitativeReviewPanel")[1] ?? ""),
  "el panel que cruza al navegador ya no lleva `evidenceDigest`",
);
check(
  !/[0-9a-f]\{64\}/.test(actionSource),
  "y la acción no valida ninguna forma de 64 hexadecimales",
);

// AND THE SCREEN SENDS WHAT THE SIGNATURE SAYS. A payload field that vanished
// while the component still read it would be a build error; a component that
// stopped sending the revision would not be, so it is asserted here.
check(
  !/evidenceDigest/.test(viewSource),
  "la pantalla de revisión no nombra ninguna huella de evidencia",
);
check(
  /signOff\(studyId, payload\.draftRevision, tokens\)/.test(viewSource),
  "y firma con la revisión bajo revisión y las identidades de los grupos",
);
check(
  /qualitative\.groups\.map\(\(group\) => group\.token\)/.test(viewSource),
  "tomadas de los grupos que ESTE render dibujó, no de los que había al cargar",
);

// AND THE VALUE THAT IS RECORDED IS THE SERVER'S OWN.
const recordBody = workspaceSource.slice(
  workspaceSource.indexOf("export async function recordQualitativeSignOff("),
  workspaceSource.indexOf("/* the journey pain editor"),
);
check(
  /const digest = qualitativeEvidenceDigest\(groups\);/.test(recordBody),
  "el registro calcula la huella a partir de los grupos que acaba de leer",
);
check(
  /p_evidence_digest: digest,/.test(recordBody),
  "y es ESA la que se escribe, no una recibida",
);
check(
  /assembled\.subject\.stored\.revision !== reviewedDraftRevision/.test(recordBody),
  "la revisión se verifica contra la que el almacén tiene ahora",
);
check(
  /assembled\.subject\.bound !== true/.test(recordBody),
  "y el enlace del documento también, antes de firmar nada",
);
check(
  /qualitativeTokensMatch\(groups, groupTokens\)/.test(recordBody),
  "la frescura se decide comparando conjuntos de identidades, no huellas",
);

// THE FRESHNESS CHECK ACTUALLY BITES.
const groupA = {
  groupLabel: "GRUPO-UNO",
  coding: "source_coded",
  categories: ["cat-a", "cat-b"],
  excluded: [],
  blocks: [],
};
const groupB = { ...groupA, groupLabel: "GRUPO-DOS", categories: ["cat-c"] };
const renamed = { ...groupA, categories: ["cat-a", "cat-b-renombrada"] };
check(
  qualitativeTokensMatch([groupA, groupB], [qualitativeGroupToken(groupA), qualitativeGroupToken(groupB)]),
  "las identidades de los grupos leídos coinciden consigo mismas",
);
check(
  !qualitativeTokensMatch([renamed, groupB], [qualitativeGroupToken(groupA), qualitativeGroupToken(groupB)]),
  "renombrar una categoría rompe la coincidencia",
);
check(
  !qualitativeTokensMatch([groupA], [qualitativeGroupToken(groupA), qualitativeGroupToken(groupB)]),
  "y sobrar un grupo también",
);
check(
  !qualitativeTokensMatch([groupA, groupB], [qualitativeGroupToken(groupA)]),
  "y faltar uno también",
);
check(
  qualitativeGroupToken(groupA) !== qualitativeEvidenceDigest([groupA]).slice(0, 9),
  "la identidad de un grupo NO es un prefijo de la huella de evidencia",
);

/* -------------------------------------------------------------------------- */
console.log("\n[2] Ni huellas ni datos de personas tienen por dónde cruzar");

const reviewContract = read("src/lib/publication/journey-pain-review.ts");
const FORBIDDEN_FIELDS = [
  "respondent",
  "participant",
  "personId",
  "personName",
  "displayName",
  "email",
  "quote",
  "comment",
  "rawText",
  "raw_text",
  "freeText",
  "sourceDigest",
  "evidenceDigest",
  "bindingFingerprint",
  "planFingerprint",
  "packageIdempotencyKey",
  "definitionSha256",
];
// OVER THE TYPE DECLARATIONS, not over the whole file: the header explains at
// length what may never travel, and a scan that read the prose would pass on
// the explanation of the rule instead of on the rule.
const declaredTypes = reviewContract
  .split("\n")
  .filter((line) => /^\s{2}[A-Za-z_]+[?]?:/.test(line))
  .join("\n");
for (const field of FORBIDDEN_FIELDS) {
  check(
    !new RegExp(`\\b${field}\\b`, "i").test(declaredTypes),
    `ningún tipo del contrato de revisión declara «${field}»`,
  );
}
check(
  /token: string;/.test(declaredTypes) && /sourceVersion: string;/.test(declaredTypes),
  "lo que sí declara es un token opaco y un marcador de versión opaco",
);

// AND THE READ ITSELF SELECTS NOTHING ELSE.
const curatedRead = read("src/lib/canonical-source/curated-review.ts");
const selected = [...curatedRead.matchAll(/columns:\s*\[([^\]]*)\]/g)].map((m) => m[1]).join(",");
for (const column of ["raw_text", "created_by", "reviewed_by", "source_visual_annotation_id", "superseded_by_id"]) {
  check(!selected.includes(column), `la lectura curada no selecciona «${column}»`);
}
for (const table of ["person", "person_private", "qual_observation", "quant_response", "survey_response", "participant"]) {
  check(
    !new RegExp(`"${table}"`).test(curatedRead),
    `y no nombra la tabla «${table}» por ningún camino`,
  );
}

/* -------------------------------------------------------------------------- */
console.log("\n[3] La autorización precede a la lectura de evidencia curada");

const painPage = read("src/app/studio/e/[studyId]/revision/dolor/page.tsx");
const guardAt = painPage.indexOf("await requireInternal()");
const loadAt = painPage.indexOf("loadJourneyPainEditor(");
check(guardAt >= 0, "la página llama al guardián interno");
check(loadAt > guardAt, "y lo hace ANTES de pedir la evidencia curada");
check(
  painPage.indexOf("await params") > guardAt,
  "incluso antes de desenvolver los parámetros de la ruta",
);
check(
  !/createAdminClient\(/.test(painPage),
  "la página no construye por su cuenta un cliente privilegiado",
);
const painDecisionBody = actionSource.slice(
  actionSource.indexOf("export async function recordCanonicalJourneyPainDecision("),
);
const authAt = painDecisionBody.indexOf("await authorizedStudioScope(studyId)");
const writeAt = painDecisionBody.indexOf("recordStoredJourneyPainDecision(");
check(authAt >= 0 && writeAt > authAt, "y la acción autoriza antes de escribir");

/* -------------------------------------------------------------------------- */
console.log("\n[4] El mapeo es EXPLÍCITO: nada compara una frase con una etiqueta");

const modelSource = read("src/lib/publication/journey-pain-model.ts");
const workspacePain = read("src/lib/studio/journey-pain-workspace.ts");
const editorSource = read("src/components/studio/publication/JourneyPainEditor.tsx");

// A SIMILARITY RULE WOULD HAVE TO SPELL ITSELF. These are the shapes one takes.
const SIMILARITY = [
  /levenshtein/i,
  /\bsimilarity\b/i,
  /\bfuzzy\b/i,
  /\bnormalize\w*\s*\(\s*\w*label/i,
  /\balias\b/i,
  /\bALIAS_/,
  /toLowerCase\(\)[^\n]*label/i,
  /startsWith\([^)]*label/i,
];
/**
 * THE SCAN IS OVER CODE, NOT OVER PROSE.
 *
 * Both files explain AT LENGTH why no similarity rule exists, and an explanation
 * of a rule contains the rule's own vocabulary. Scanning the raw text would fail
 * on the paragraph that says «not from an alias table» — which is the opposite
 * of the finding. So comments are stripped first, and what is left is what
 * actually runs.
 */
const codeOnly = (text) =>
  text.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/[^\n]*/g, "$1 ");

const reviewCode = `${codeOnly(modelSource)}\n${codeOnly(workspacePain)}`;
check(
  reviewCode.length > 2000 && !reviewCode.includes("NOTHING HERE PROPOSES A MAPPING"),
  `los comentarios se retiran antes de buscar, y queda código de verdad (${reviewCode.length} bytes)`,
);
for (const [index, pattern] of SIMILARITY.entries()) {
  check(
    !pattern.test(reviewCode),
    `la capa de revisión no contiene la regla de parecido #${index + 1} (${pattern})`,
  );
}
// The one place a comparison is legitimate is the reviewer's own search box,
// and it compares what a PERSON TYPED with a label — never the source phrase.
check(
  /point\.label\.toLocaleLowerCase\("es"\)\.includes\(search/.test(editorSource),
  "el editor sólo compara con lo que la persona escribió en el buscador",
);
check(
  !/curatedPhrase[^\n]*includes|includes\([^)]*curatedPhrase/.test(editorSource),
  "y nunca con la frase de origen",
);
check(
  /useState\(""\)/.test(editorSource.slice(editorSource.indexOf("const [search"))) ||
    /const \[search, setSearch\] = useState\(""\);/.test(editorSource),
  "el buscador arranca vacío, así que no propone nada al abrirse",
);
check(
  !/defaultChecked|checked=\{true\}/.test(editorSource),
  "y ningún punto de contacto viene marcado por omisión",
);

/* -------------------------------------------------------------------------- */
console.log("\n[5] Una frase puede ir a VARIOS puntos, y va");

const oneToMany = buildJourneyPainContent({
  mappings: [
    { phrase: "FRASE-KWJ-alfa", touchpoints: [CHOICES[0].handle, CHOICES[1].handle, CHOICES[2].handle] },
  ],
});
eq("puntos que reciben la frase", oneToMany.byTouchpoint.size, 3);
for (const choice of CHOICES) {
  check(
    oneToMany.byTouchpoint.get(choice.handle)?.phrases.includes("FRASE-KWJ-alfa") === true,
    `«${choice.label}» lleva la frase`,
  );
}
const duplicated = buildJourneyPainContent({
  mappings: [{ phrase: "x", touchpoints: [CHOICES[0].handle, CHOICES[0].handle] }],
});
eq("el mismo punto elegido dos veces cuenta una", duplicated.byTouchpoint.get(CHOICES[0].handle).count, 1);

/* -------------------------------------------------------------------------- */
console.log("\n[6] La evidencia caducada reabre la revisión");

const decisions = PAIN.filter((row) => row.id !== "p-5555").map((row) => decide(row.id));
const fresh = buildPainReviewItems(STUDY, EVIDENCE, decisions);
eq("todas las decisiones frescas se reconocen", fresh.filter((item) => item.state === "approved").length, 4);
check(fresh.every((item) => item.stale === false), "y ninguna está caducada");

// The words move. The decisions do not.
const MOVED = {
  ...EVIDENCE,
  painPoints: EVIDENCE.painPoints.map((row) =>
    row.id === "p-2222" ? { ...row, normalizedText: "FRASE-KWJ-beta-CORREGIDA" } : row,
  ),
};
const stale = buildPainReviewItems(STUDY, MOVED, decisions);
const moved = stale.find((item) => item.token === TOKENS["p-2222"]);
check(moved !== undefined, "la frase corregida sigue en la cola");
eq("y su estado vuelve a «sin revisar»", moved.state, "unreviewed");
check(moved.stale === true, "marcada explícitamente como caducada");
eq("sin conservar el texto público que se había aprobado", moved.publicPhrase, null);
eq("ni los puntos que se le habían asignado", moved.touchpoints.length, 0);
check(
  stale.filter((item) => item.token !== TOKENS["p-2222"]).every((item) => item.stale === false),
  "y las demás decisiones no se tocan",
);
check(
  painReviewGaps(stale, CHOICES).includes("stale_source"),
  "el hueco «stale_source» se levanta",
);
check(authoredPainContent({ applicable: true, items: stale, choices: CHOICES, gaps: painReviewGaps(stale, CHOICES), complete: false, counts: painReviewCounts(stale) }) === null,
  "y no se autoriza contenido alguno mientras haya una caducada");

// A CHANGE THAT IS NOT A WORD DOES NOT MOVE IT. The occurrence count is outside
// the digest, for the reason the qualitative digest excludes counts.
const REPEATED = {
  ...EVIDENCE,
  painPoints: [...EVIDENCE.painPoints, { id: "p-6666", normalizedText: "FRASE-KWJ-gama", reviewStatus: "pending" }],
  stageLinks: [...EVIDENCE.stageLinks, { painPointId: "p-6666", journeyStageId: "s-cccc", displayOrder: 1 }],
};
const repeated = buildPainReviewItems(STUDY, REPEATED, decisions);
const unchanged = repeated.find((item) => item.token === TOKENS["p-3333"]);
check(unchanged.stale === false, "otra celda repitiendo una frase ya aprobada NO caduca la decisión");
eq("aunque el conteo que se muestra sí cambie", unchanged.occurrences, 2);

/* -------------------------------------------------------------------------- */
console.log("\n[7] Una revisión completa autoriza contenido; una incompleta, ninguno");

const panelOf = (items, choices = CHOICES) => {
  const gaps = painReviewGaps(items, choices);
  return {
    applicable: true,
    items,
    choices,
    gaps,
    complete: gaps.length === 0,
    counts: painReviewCounts(items),
  };
};

// Out of scope: the item attached to no journey stage.
eq("los elementos fuera del recorrido no entran en la cola", fresh.length, 4);
check(
  !fresh.some((item) => item.curatedPhrase === "FRASE-KWJ-fuera"),
  "y la frase de otra dimensión curada no aparece",
);

const complete = panelOf(fresh);
check(complete.complete, "con las cuatro decididas, la revisión está completa");
eq("y no queda ningún hueco", complete.gaps.length, 0);
check(authoredPainContent(complete) !== null, "y se autoriza contenido");

// (a) nobody decided one.
const undecided = panelOf(buildPainReviewItems(STUDY, EVIDENCE, decisions.slice(0, 3)));
check(undecided.gaps.includes("undecided_items"), "una sin decidir levanta «undecided_items»");
check(authoredPainContent(undecided) === null, "y no autoriza contenido");

// (b) approved with no phrase — the store refuses one, so it is built by hand.
const noPhrase = panelOf(
  fresh.map((item, index) => (index === 0 ? { ...item, publicPhrase: "   " } : item)),
);
check(noPhrase.gaps.includes("approved_without_phrase"), "una aprobada sin texto público lo levanta");
check(authoredPainContent(noPhrase) === null, "y no autoriza contenido");

// (c) approved with no touchpoint.
const noPoint = panelOf(fresh.map((item, index) => (index === 0 ? { ...item, touchpoints: [] } : item)));
check(noPoint.gaps.includes("approved_without_touchpoint"), "una aprobada sin punto lo levanta");
check(authoredPainContent(noPoint) === null, "y no autoriza contenido");

// (d) a mapping pointing at a touchpoint the document no longer draws.
const missingPoint = panelOf(fresh, [CHOICES[1], CHOICES[2]]);
check(missingPoint.gaps.includes("unknown_touchpoint"), "un punto que ya no se dibuja lo levanta");
check(authoredPainContent(missingPoint) === null, "y no autoriza contenido");

// (e) and every gap has its own sentence, none of which is a mechanism.
const { PAIN_GAP_DETAIL } = await import("../src/lib/publication/journey-pain-review.ts");
for (const gap of ["undecided_items", "approved_without_phrase", "approved_without_touchpoint", "stale_source", "unknown_touchpoint"]) {
  const sentence = PAIN_GAP_DETAIL[gap];
  check(typeof sentence === "string" && sentence.length > 60, `«${gap}» tiene su propia frase`);
  check(
    !/null|undefined|digest|handle|token|sha256/i.test(sentence),
    `y la frase de «${gap}» no nombra un mecanismo`,
  );
}

/* -------------------------------------------------------------------------- */
console.log("\n[8] Lo excluido y lo no resuelto se quedan fuera");

const mixed = buildPainReviewItems(STUDY, EVIDENCE, [
  decide("p-1111"),
  decide("p-2222", { disposition: "rejected", publicPhrase: null, touchpoints: [], rationale: "no aporta" }),
  decide("p-3333", { disposition: "unresolved", publicPhrase: null, touchpoints: [], rationale: "no sé a cuál" }),
  decide("p-4444"),
]);
const mixedPanel = panelOf(mixed);
check(mixedPanel.complete, "una cola con exclusiones y sin resolver puede estar completa");
eq("aprobadas", mixedPanel.counts.approved, 2);
eq("excluidas", mixedPanel.counts.rejected, 1);
eq("sin resolver", mixedPanel.counts.unresolved, 1);
eq("sin revisar", mixedPanel.counts.unreviewed, 0);
const mixedContent = authoredPainContent(mixedPanel);
eq("el contenido autorizado sólo cuenta lo aprobado", mixedContent.total, 2);
check(
  mixedContent.terms.every((term) => term.label.startsWith("PUBLICO-p-1111") || term.label.startsWith("PUBLICO-p-4444")),
  "y sólo lleva las frases públicas de esas dos",
);
check(
  !JSON.stringify(mixedContent).includes("no aporta") && !JSON.stringify(mixedContent).includes("no sé a cuál"),
  "ningún motivo de exclusión entra en el contenido",
);
check(
  !JSON.stringify(mixedContent).includes("FRASE-KWJ-beta") &&
    !JSON.stringify(mixedContent).includes("FRASE-KWJ-gama"),
  "y ninguna frase de origen excluida tampoco",
);

/* -------------------------------------------------------------------------- */
console.log("\n[9] La nube agrega y los puntos reciben su marca, en una sola pasada");

const content = buildJourneyPainContent({
  mappings: [
    { phrase: "alfa", touchpoints: [CHOICES[0].handle] },
    { phrase: "alfa", touchpoints: [CHOICES[1].handle] },
    { phrase: "beta", touchpoints: [CHOICES[0].handle, CHOICES[2].handle] },
  ],
});
eq("términos distintos en la nube", content.terms.length, 2);
eq("el más repetido va primero", content.terms[0].label, "alfa");
eq("y su conteo es de ELEMENTOS, no de pares", content.terms[0].count, 2);
eq("el segundo", content.terms[1].label, "beta");
eq("con su propio conteo", content.terms[1].count, 1);
eq("el total de la nube", content.total, 3);
eq(
  "y es la suma de los conteos",
  content.terms.reduce((sum, term) => sum + term.count, 0),
  content.total,
);
eq("el primer punto lleva dos frases", content.byTouchpoint.get(CHOICES[0].handle).phrases.length, 2);
eq("el segundo, una", content.byTouchpoint.get(CHOICES[1].handle).phrases.length, 1);
eq("el tercero, una", content.byTouchpoint.get(CHOICES[2].handle).phrases.length, 1);
check(
  buildJourneyPainContent({ mappings: [] }).terms.length === 0,
  "y una lista vacía produce contenido vacío en vez de un rechazo",
);
// DETERMINISM: the same input always produces the same bytes.
check(
  JSON.stringify([...buildJourneyPainContent({ mappings: [
    { phrase: "beta", touchpoints: [CHOICES[0].handle, CHOICES[2].handle] },
    { phrase: "alfa", touchpoints: [CHOICES[1].handle] },
    { phrase: "alfa", touchpoints: [CHOICES[0].handle] },
  ] }).terms]) === JSON.stringify([...content.terms]),
  "y el orden de la nube no depende del orden en que alguien revisó",
);

/* -------------------------------------------------------------------------- */
console.log("\n[10] Una frase en tres puntos se cuenta UNA vez en la nube");

const spread = buildJourneyPainContent({
  mappings: [{ phrase: "una-sola", touchpoints: CHOICES.map((choice) => choice.handle) }],
});
eq("el total de la nube", spread.total, 1);
eq("y el conteo del término", spread.terms[0].count, 1);
eq("aunque aparezca en los tres puntos", spread.byTouchpoint.size, 3);
const perPointSum = [...spread.byTouchpoint.values()].reduce((sum, entry) => sum + entry.count, 0);
eq("la suma por punto SÍ es tres, y son cifras distintas", perPointSum, 3);
check(
  spread.total !== perPointSum,
  "el total global y la suma por punto no son la misma cifra, y no se confunden",
);

/* -------------------------------------------------------------------------- */
console.log("\n[11] Ninguna dependencia de la tabla de alias del tablero de demostración");

const DEMO_ALIASES = [
  "Plataforma BNI Connect",
  "App BNI Connect",
  "Reporting2Yoy",
  "Miércoles de capacitación",
  "Entrevista de 7 meses",
  "Despedida del capítulo",
];
const productFiles = [
  "src/lib/presentation/journey-pain.ts",
  "src/lib/publication/journey-pain-model.ts",
  "src/lib/publication/journey-pain-digest.ts",
  "src/lib/publication/journey-pain-review.ts",
  "src/lib/studio/journey-pain-workspace.ts",
  "src/lib/canonical-source/curated-review.ts",
  "src/components/studio/publication/JourneyPainEditor.tsx",
];
for (const file of productFiles) {
  const text = read(file);
  for (const alias of DEMO_ALIASES) {
    check(!text.includes(alias), `${file} no contiene «${alias}»`);
  }
  check(!/split\(\/\[\\n\.\]\+\//.test(text), `${file} no contiene la regla de partir frases del demo`);
}
check(
  !productFiles.some((file) => /\bconst [A-Z_]*ALIAS/.test(read(file))),
  "y ningún archivo del producto declara una tabla de alias",
);

/* -------------------------------------------------------------------------- */
console.log("\n[12] El modelo de render no lleva metadatos internos de revisión");

// A minimal document with a journey route block and an editorial pain slot,
// resolved through the REAL resolver over a REAL registry.
const { buildCanonicalPresentationRegistry, bindPresentationDocument } = await import(
  "../src/lib/presentation/registry.ts"
);
// THE FIXTURE THE COMPOSER GATE ALREADY USES, reached the same way it does. A
// second synthetic study built here would drift from that one and the two gates
// would prove different things while reporting the same names.
const { composerFixtureResults } = await import("./lib/composer-fixture.mjs");
const results = composerFixtureResults();
const registry = buildCanonicalPresentationRegistry(results);

// THE SLOT IS FOUND BY THE CONTRACT'S OWN REQUIREMENT KEY, never by the handle:
// the handle is built from the requirement's section and kind and would collide
// with any future editorial slot in the qualitative section. This is the same
// identity `resolve.ts` matches on, so the two cannot drift apart silently.
const addressOf = (entry) => registry.addresses.get(entry.handle);
const painSlot = registry.entries.find((entry) => {
  const address = addressOf(entry);
  return (
    address?.at === "configuration.requirement" &&
    results.configurationRequired[address.requirementIndex]?.key === "curated_journey_pain_cloud"
  );
});
const groupEntry = registry.entries.find((entry) => addressOf(entry)?.at === "journey.group");
check(painSlot !== undefined, "el registro publica la ranura editorial del recorrido");
check(groupEntry !== undefined, "y un grupo de recorrido con sus puntos");

const shell = (id, order) => ({
  id,
  placement: { order, span: { desktop: 12, tablet: 12, mobile: 12 } },
  copy: { title: `T-${id}`, description: null, footnote: null },
  connectedFilterPanelIds: [],
  samplePolicy: null,
  methodologyDisclosure: null,
  displayFormat: { decimals: null, padDecimals: false },
  // AUTHORED VISIBILITY, and the default is not `true` by accident: `visible` is
  // a property of the DOCUMENT and `clientSeesBlock` reads it before it looks at
  // anything else, so a fixture that omitted it would prove the cloud invisible
  // for a reason that has nothing to do with this unit.
  visible: true,
});
const document = bindPresentationDocument(
  {
    schemaVersion: 4,
    documentKind: "canonical_presentation",
    registryVersion: registry.registryVersion,
    binding: null,
    id: "doc-dolor",
    title: "Documento de prueba",
    locale: "es-MX",
    samplePolicy: { mode: "show_all", threshold: null, authoredBy: null, rationale: null, publicNote: null },
    methodologyDisclosure: "plain_language_with_base",
    pages: [
      {
        id: "p1",
        title: "Página",
        order: 0,
        blocks: [
          {
            ...shell("recorrido", 0),
            kind: "journey_routes",
            chartVariant: "journey_route_map",
            routes: [
              {
                id: "r1",
                title: "RUTA-A",
                order: 0,
                sourceGroup: groupEntry.handle,
                touchpoints: groupEntry.members.slice(0, 2),
              },
            ],
          },
          { ...shell("nube", 1), kind: "editorial", slot: painSlot.handle, content: null, requiredContent: true },
        ],
      },
    ],
  },
  registry,
);

const before = resolvePresentation({ document, registry, results });
check(before.ok, "el documento sin contenido autorizado resuelve");
const emptySlot = before.value.pages[0].blocks.find((block) => block.id === "nube");
eq("y la ranura sigue esperando a una persona", emptySlot.availability, "configuration_required");
eq("dibujada como prosa", emptySlot.chartVariant, "narrative");
check(!clientSeesBlock(emptySlot, CLIENT_SURFACE_IS_LIVE), "y el cliente no vería nada en ella");
const emptyRoute = before.value.pages[0].blocks.find((block) => block.id === "recorrido");
check(
  emptyRoute.payload.routes[0].points.every((point) => point.pain === null),
  "y ningún punto lleva marca",
);

const authored = buildJourneyPainContent({
  mappings: [
    { phrase: "PUBLICA-uno", touchpoints: [groupEntry.members[0]] },
    { phrase: "PUBLICA-dos", touchpoints: [groupEntry.members[0], groupEntry.members[1]] },
  ],
});
const after = resolvePresentation({ document, registry, results, journeyPain: authored });
check(after.ok, "y con contenido autorizado también resuelve");
const filled = after.value.pages[0].blocks.find((block) => block.id === "nube");
eq("la ranura pasa a estar disponible", filled.availability, "available");
eq("y a dibujarse como nube", filled.chartVariant, "word_cloud");
eq("con la forma de términos", filled.payload.shape, "terms");
eq("y dos términos", filled.payload.terms.length, 2);
check(clientSeesBlock(filled, CLIENT_SURFACE_IS_LIVE), "ahora el cliente sí la vería");
check(
  filled.payload.terms.every((term) => term.share === null),
  "ningún término declara una proporción: es contenido editorial, no una medición",
);

// AND THE OFFER A REVIEWER IS GIVEN COMES FROM THE ROUTES THIS DOCUMENT DRAWS.
const offer = painTouchpointChoices(after.value);
eq("la oferta tiene tantos puntos como dibuja la ruta", offer.length, 2);
check(
  offer.every((choice) => choice.routeTitle === "RUTA-A"),
  "y cada uno viene agrupado bajo el recorrido visible que lo dibuja",
);
check(
  offer.every((choice) => typeof choice.label === "string" && choice.label.length > 0),
  "con la etiqueta que el cliente lee, nunca un handle como nombre",
);
eq("un modelo ausente no ofrece nada", painTouchpointChoices(null).length, 0);
const withoutRoutes = { ...after.value, pages: [{ ...after.value.pages[0], blocks: [] }] };
eq("y un documento sin recorrido tampoco", painTouchpointChoices(withoutRoutes).length, 0);

const route = after.value.pages[0].blocks.find((block) => block.id === "recorrido");
eq("el primer punto lleva dos frases", route.payload.routes[0].points[0].pain.phrases.length, 2);
eq("y su conteo", route.payload.routes[0].points[0].pain.count, 2);
eq("el segundo, una", route.payload.routes[0].points[1].pain.phrases.length, 1);

// NOTHING INTERNAL IS IN THE MODEL.
const modelText = JSON.stringify(after.value);
for (const forbidden of [
  "unreviewed",
  "rejected",
  "unresolved",
  "sourceVersion",
  "sourceDigest",
  "sourceContext",
  "curatedPhrase",
  "occurrences",
  "reviewStatus",
  "rationale",
  "decidedAt",
  "itemKey",
  "disposition",
  "FRASE-KWJ",
  "ETAPA-ZQX",
]) {
  check(!modelText.includes(forbidden), `el modelo de render no lleva «${forbidden}»`);
}
check(!/\bpp[a-z2-7]{16}\b/.test(modelText), "ni un token opaco de elemento");
check(!/[0-9a-f]{64}/.test(modelText), "ni ninguna huella de 64 hexadecimales");

// AND THE COMPONENTS COUNT NOTHING.
const journeyComponent = read("src/components/presentation/Journey.tsx");
check(
  /node\.point\.pain\.count/.test(journeyComponent),
  "el componente dibuja el conteo que el servidor mandó",
);
check(
  !/pain\.phrases\.length/.test(journeyComponent.replace(/point\.pain\.phrases\.map/g, "")),
  "y no mide el arreglo que tiene al lado",
);

/* -------------------------------------------------------------------------- */
console.log("\n[13] Las identidades opacas son opacas, estables y nunca hexadecimales");

const token = painItemToken(STUDY, "p-1111");
check(/^pp[a-z2-7]{16}$/.test(token), `un token de elemento tiene la forma declarada (${token})`);
check(token === painItemToken(STUDY, "p-1111"), "es estable entre llamadas");
check(token !== painItemToken("11111111-1111-4111-8111-111111111111", "p-1111"), "y depende del estudio");
check(!token.includes("p-1111"), "no contiene el identificador del que se derivó");
check(!/^[0-9a-f]+$/.test(token.slice(2)), "y no es hexadecimal");
const groupToken = qualitativeGroupToken(groupA);
check(/^q[a-z2-7]{8}$/.test(groupToken), `una identidad de grupo tiene su propia forma (${groupToken})`);
check(!/^[0-9a-f]+$/.test(groupToken.slice(1)), "y tampoco es hexadecimal");
const version = painSourceVersion(digestOf("p-1111"));
check(/^v[a-z2-7]{8}$/.test(version), `el marcador de versión tiene su forma (${version})`);
check(
  !digestOf("p-1111").startsWith(version.slice(1)),
  "y no es un prefijo legible de la huella",
);
// The alphabet is what makes the 64-hex scan safe, so it is pinned.
const { PAIN_TOKEN_ALPHABET } = await import("../src/lib/publication/journey-pain-digest.ts");
check(
  ["w", "x", "y", "z"].every((letter) => PAIN_TOKEN_ALPHABET.includes(letter)),
  "el alfabeto contiene letras más allá de la f, así que ningún token puede parecer una huella",
);

/* -------------------------------------------------------------------------- */
console.log("\n[14] La huella de origen cubre las palabras, no el conteo");

const words = {
  token: "pp" + "a".repeat(16),
  curatedPhrase: "una frase",
  sourceContext: "una etapa",
  sourceStatus: "pending",
};
const baseDigest = painSourceDigest(words);
check(/^[0-9a-f]{64}$/.test(baseDigest), "es un sha-256 en hexadecimal");
check(baseDigest === painSourceDigest({ ...words }), "y es determinista");
check(baseDigest !== painSourceDigest({ ...words, curatedPhrase: "otra frase" }), "cambia con la frase");
check(baseDigest !== painSourceDigest({ ...words, sourceContext: "otra etapa" }), "cambia con la etapa");
check(baseDigest !== painSourceDigest({ ...words, sourceStatus: "confirmed" }), "cambia con el estado de origen");
check(baseDigest !== painSourceDigest({ ...words, token: "pp" + "b".repeat(16) }), "y con la identidad del elemento");
// THE SEPARATOR IS NOT PRINTABLE, so two different splits cannot collide.
const collideA = painSourceDigest({ ...words, curatedPhrase: "a", sourceContext: "bc" });
const collideB = painSourceDigest({ ...words, curatedPhrase: "ab", sourceContext: "c" });
check(collideA !== collideB, "dos repartos distintos de las mismas letras no colisionan");
// And it agrees with the platform's own SHA-256, so the helper cannot drift.
const manual = createHash("sha256")
  .update(["pain-source-v1", words.token, words.curatedPhrase, words.sourceContext, words.sourceStatus].join(""), "utf8")
  .digest("hex");
eq("y coincide con el sha-256 de la plataforma", baseDigest, manual);

/* -------------------------------------------------------------------------- */
console.log("\n[15] El bloqueo de publicación existe, dice qué falta y no se puede confirmar");

const subject = {
  authorized: true,
  clientSurfaceIsLive: CLIENT_SURFACE_IS_LIVE,
  readRefusal: null,
  stored: { revision: 1, definitionSha256: "a".repeat(64), registryVersion: registry.registryVersion, bindingFingerprint: registry.binding },
  reviewedRevision: 1,
  decodeIssues: null,
  bound: true,
  resolutionIssues: null,
  model: after.value,
  reproducible: true,
  current: null,
  authored: null,
  lastPublished: null,
  requiredBlockIds: ["nube"],
  qualitative: [],
  qualitativeReviewState: "not_applicable",
  painApplicable: true,
  painGaps: [],
  painContentRequired: true,
  expectedActiveVersion: null,
  actualActiveVersion: null,
  structureChanged: false,
  acknowledged: [],
};
const clean = runPublicationPreflight(subject);
check(
  !clean.blockers.some((entry) => entry.code === "journey_pain_review_incomplete"),
  "con la revisión completa no hay bloqueo por el recorrido",
);
const blocked = runPublicationPreflight({ ...subject, painGaps: ["undecided_items", "stale_source"] });
const painBlocker = blocked.blockers.find((entry) => entry.code === "journey_pain_review_incomplete");
check(painBlocker !== undefined, "con huecos, el bloqueo se levanta por su nombre");
check(
  painBlocker !== undefined && painBlocker.detail.includes(PAIN_GAP_DETAIL.undecided_items),
  "y su frase incluye la de cada hueco",
);
check(
  painBlocker !== undefined && painBlocker.detail.includes(PAIN_GAP_DETAIL.stale_source),
  "las dos, no sólo la primera",
);
check(
  !blocked.required.includes("journey_pain_review_incomplete"),
  "no aparece entre las confirmaciones exigidas: un bloqueo no se confirma",
);
check(!blocked.canPublish, "y con él no se puede publicar");
// A layout that does not draw the cloud is not blocked by it.
const unrequired = runPublicationPreflight({
  ...subject,
  requiredBlockIds: [],
  painContentRequired: false,
  painGaps: ["undecided_items"],
});
check(
  !unrequired.blockers.some((entry) => entry.code === "journey_pain_review_incomplete"),
  "y un documento que no publica la nube no se bloquea por su revisión",
);

/*
 * AND THE CONDITION IS «ESTE BLOQUE», NO «ALGÚN BLOQUE».
 *
 * La primera versión preguntaba `requiredBlockIds.length > 0` — «¿este plano
 * exige ALGÚN contenido?» — así que un documento que marcaba obligatorio otro
 * bloque quedaba bloqueado por una revisión que no tenía nada que ver con él.
 * Acertaba en el plano aprobado de Cuicuilco por casualidad, porque su único
 * bloque obligatorio ES esta ranura, y esa es justo la clase de accidente que
 * sobrevive a una revisión.
 */
const otherRequired = runPublicationPreflight({
  ...subject,
  requiredBlockIds: ["otro-bloque-cualquiera"],
  painContentRequired: false,
  painGaps: ["undecided_items"],
});
check(
  !otherRequired.blockers.some((entry) => entry.code === "journey_pain_review_incomplete"),
  "un documento que exige OTRO contenido no se bloquea por la revisión del recorrido",
);
const painRequiredOnly = runPublicationPreflight({
  ...subject,
  requiredBlockIds: [],
  painContentRequired: true,
  painGaps: ["undecided_items"],
});
check(
  painRequiredOnly.blockers.some((entry) => entry.code === "journey_pain_review_incomplete"),
  "y el que exige ESTE contenido sí, aunque no exija ningún otro",
);

/* -------------------------------------------------------------------------- */
console.log("\n[16] La frontera del barril: nada de esto es alcanzable desde el navegador");

/*
 * THE CLIENT-SAFE BARREL MAY NOT RE-EXPORT ANY OF THE THREE.
 *
 * `journey-pain-digest.ts` and `opaque.ts` reach the product's SHA-256 under
 * `canonical-commit/`, and `journey-pain-model.ts` reaches both. Everything
 * `src/lib/publication/index.ts` re-exports is one import away from a
 * `"use client"` component, so a re-export here would put a path from the
 * reviewer's screen straight into the canonical layer's import graph — which is
 * exactly what happened to the evidence digest the first time, and exactly what
 * the boundary gate refused by name.
 */
const barrel = read("src/lib/publication/index.ts");
for (const file of ["journey-pain-digest", "journey-pain-model", "./opaque", "evidence-digest"]) {
  check(
    !new RegExp(`from "\\.\\/${module.replace("./", "")}"`).test(barrel),
    `el barril cliente-seguro no reexporta «${module}»`,
  );
}
check(
  /from "\.\/journey-pain-review"/.test(barrel),
  "y sí reexporta el CONTRATO, que es lo único de esto que una pantalla necesita",
);

// AND THE EDITOR IMPORTS THE BARREL AND NOTHING ELSE OF THIS FAMILY.
for (const forbidden of ["journey-pain-digest", "journey-pain-model", "journey-pain-workspace", "canonical-source", "publication-workspace"]) {
  check(
    !editorSource.includes(forbidden),
    `el editor «use client» no importa «${forbidden}» por ningún camino`,
  );
}
check(
  /from "@\/lib\/publication"/.test(editorSource),
  "importa el barril cliente-seguro, así que la ausencia de arriba no es la ausencia de todo",
);

/* -------------------------------------------------------------------------- */
console.log("\n" + "=".repeat(84));
console.log(`RESUMEN: ${executed} comprobaciones, ${executed - failures} aprobadas, ${failures} falladas.`);
if (failures > 0) {
  console.error("RESULTADO: la revisión editorial del recorrido NO se sostiene. COMPUERTA BLOQUEADA.");
  process.exit(1);
}
console.log(
  "RESULTADO: la firma cualitativa se deriva en el servidor y ninguna huella cruza; la revisión " +
    "del recorrido la hace una persona, elemento por elemento, sin que nada proponga una " +
    "correspondencia; una decisión sobre palabras que cambiaron se reabre; una revisión a medias " +
    "no produce media nube; y lo publicado cuenta frases, no pares. COMPUERTA APROBADA.",
);
