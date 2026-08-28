// =============================================================================
// MANDATORY segment-canonicalisation gate
//   npx tsx scripts/segment-canonicalization-test.mjs
// =============================================================================
// One category must have one name. The real study that motivated this holds
// "Legal y Contable" (active members) and "Legal y contable" (former members):
// one letter of case, two questionnaires, and a chapter whose four legal firms
// were counted as three and one.
//
// The rules under test, and the line between them:
//   - THE FOLD is lexical and automatic. Case and whitespace only.
//   - AN ALIAS is editorial and configured. Different WORDS are only ever
//     merged because a person said so, in data, per study.
//   - The RAW value is never rewritten, so source reconciliation stays exact.
//   - A scope written in either spelling still authorises the same people.
//
// Fixtures are synthetic; the two collision SHAPES are the real ones.
// =============================================================================

import {
  foldSegmentValue,
  parseSegmentAliases,
  canonicalSegmentLabels,
  canonicalizeSegments,
  residualCollisions,
} from "../src/lib/calc/segments.ts";
import { applyDataScope } from "../src/lib/studies/scope.ts";

let failures = 0;
const ok = (m) => console.log("  ✓", m);
const bad = (m) => {
  console.error("  ✗ FAIL:", m);
  failures += 1;
};
const check = (c, m) => (c ? ok(m) : bad(m));

const respondents = [
  ...Array.from({ length: 3 }, () => ({ segments: { giro: "Legal y Contable", roi: "No he recuperado nada" } })),
  { segments: { giro: "Legal y contable", roi: "No recuperé nada" } },
  ...Array.from({ length: 3 }, () => ({ segments: { giro: "Capacitación y Coaching" } })),
  { segments: { giro: "  Capacitación y   coaching " } },
  { segments: { giro: "Seguros", roi: "+100%" } },
  { segments: { giro: "Publico" } },
  { segments: { giro: "Público" } },
];

console.log("Be Community — segment canonicalisation gate");

// ---- [1] The fold ----------------------------------------------------------
console.log("\n[1] The fold merges case and whitespace, and nothing else");
{
  check(foldSegmentValue("Legal y Contable") === foldSegmentValue("Legal y contable"), "case-only variants fold together");
  check(
    foldSegmentValue("  Capacitación y   coaching ") === foldSegmentValue("Capacitación y Coaching"),
    "surrounding and repeated whitespace fold away",
  );
  check(foldSegmentValue("Público") !== foldSegmentValue("Publico"), "accents are NOT folded away");
  check(
    foldSegmentValue("No he recuperado nada") !== foldSegmentValue("No recuperé nada"),
    "different words are NOT folded together",
  );
}

// ---- [2] Grouping and labelling --------------------------------------------
console.log("\n[2] Every raw spelling maps to one display label");
{
  const labels = canonicalSegmentLabels(respondents);
  const giro = labels.get("giro");
  check(giro.get("Legal y Contable") === giro.get("Legal y contable"), "both spellings share one label");
  check(giro.get("Legal y Contable") === "Legal y Contable", "the label is the spelling most respondents used");
  check(giro.get("  Capacitación y   coaching ") === "Capacitación y Coaching", "the whitespace variant takes the same label");
  check(new Set(giro.values()).size === 5, "five distinct labels remain (got " + new Set(giro.values()).size + ")");

  // Without configuration the two ROI wordings stay apart: code must not decide
  // that different words mean the same thing.
  const roi = labels.get("roi");
  check(
    roi.get("No he recuperado nada") !== roi.get("No recuperé nada"),
    "differently worded answers stay separate until a person says otherwise",
  );
}

// ---- [3] Configured aliases ------------------------------------------------
console.log("\n[3] An alias is configuration, read from the study, never inferred");
{
  const aliases = parseSegmentAliases([
    {
      key: "roi",
      config: { aliases: { "No recuperó nada": ["No he recuperado nada", "No recuperé nada"] } },
    },
  ]);
  const labels = canonicalSegmentLabels(respondents, aliases);
  const roi = labels.get("roi");
  check(roi.get("No he recuperado nada") === "No recuperó nada", "the first wording takes the configured label");
  check(roi.get("No recuperé nada") === "No recuperó nada", "the second wording takes the same label");
  check(roi.get("+100%") === "+100%", "an unconfigured value is untouched");

  check(Object.keys(parseSegmentAliases([{ key: "roi", config: null }])).length === 0, "a null config is ignored");
  check(Object.keys(parseSegmentAliases([{ key: "", config: { aliases: { a: ["b"] } } }])).length === 0, "an unnamed dimension is ignored");
  check(Object.keys(parseSegmentAliases([{ key: "roi", config: { aliases: "nope" } }])).length === 0, "a malformed alias block is ignored");
}

// ---- [4] The raw value survives --------------------------------------------
console.log("\n[4] Canonicalisation is a read, not a rewrite");
{
  const stored = { giro: "Legal y contable" };
  const labels = canonicalSegmentLabels(respondents);
  const shown = canonicalizeSegments(stored, labels);
  check(shown.giro === "Legal y Contable", "the read shows the canonical label");
  check(stored.giro === "Legal y contable", "the stored object is not mutated");
  check(canonicalizeSegments({ giro: "Nuevo" }, labels).giro === "Nuevo", "an unseen value passes through unchanged");
  check(Object.keys(canonicalizeSegments(null, labels)).length === 0, "no segments is not an error");
}

// ---- [5] A scope still authorises the same people --------------------------
console.log("\n[5] A scope written in either spelling authorises the same people");
{
  const rows = [
    { giro: "Legal y Contable", value: 1 },
    { giro: "Legal y Contable", value: 2 },
    { giro: "Seguros", value: 3 },
  ];
  check(applyDataScope(rows, { giro: ["Legal y Contable"] }).length === 2, "the canonical spelling matches");
  check(applyDataScope(rows, { giro: ["Legal y contable"] }).length === 2, "a scope saved in the other spelling matches the same rows");
  check(applyDataScope(rows, { giro: ["Seguros"] }).length === 1, "an unrelated value still narrows correctly");
  check(applyDataScope(rows, { giro: ["Otra cosa"] }).length === 0, "a value nobody carries authorises nothing");
  check(applyDataScope(rows, {}).length === 3, "an empty scope is full access");
}

// ---- [6] What is left over is reported, not merged --------------------------
console.log("\n[6] Remaining near-collisions are surfaced for a person to decide");
{
  const found = residualCollisions(respondents);
  const giro = found.find((f) => f.key === "giro");
  check(Boolean(giro), "the accent pair is reported as a question");
  check(
    Boolean(giro) && giro.values.join(" | ") === "Publico | Público",
    "it names both spellings (got " + (giro ? giro.values.join(" | ") : "nothing") + ")",
  );
  check(!found.some((f) => f.key === "roi"), "a pair that differs by wording is not reported as a lexical collision");
  const clean = residualCollisions([{ segments: { giro: "Seguros" } }, { segments: { giro: "Legal" } }]);
  check(clean.length === 0, "a study with nothing ambiguous reports nothing");
}

console.log("\n" + "=".repeat(70));
if (failures > 0) {
  console.error("RESULT: " + failures + " failure(s). GATE BLOCKED.");
  process.exit(1);
}
console.log("RESULT: one category, one name. GATE PASSED.");
