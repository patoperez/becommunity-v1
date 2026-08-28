// =============================================================================
// Semantic category evaluation
//   npm run test:category-evaluation
// =============================================================================
// Measures the review against a committed, labelled fixture, and states the
// result as numbers rather than as anecdotes.
//
// THE METRIC THAT DECIDES EVERYTHING IS THE FALSE-MERGE RATE. A missed alias is
// a question a consultant never got asked, and the next import asks it again. A
// false merge is people silently moved between categories in a report a school
// acts on. The two are not comparable, so this harness optimises against the
// second and reports the first without apology.
//
// TWO FALSE-MERGE RATES ARE REPORTED, AND THE DIFFERENCE MATTERS.
//
//   AUTOMATIC  — merges the system performs with no human. This is 0 by
//                construction: nothing in the product writes a grouping except
//                `record_category_decision`, which requires an actor. The
//                harness asserts it rather than assuming it, because "by
//                construction" is a claim that stops being true the day
//                somebody adds a convenience.
//
//   BLIND      — merges that would happen if a reviewer accepted every single
//                proposal without reading it. Nobody should work that way, but
//                it is the honest upper bound on the harm the queue can cause,
//                and it is the number that says whether the queue is trustworthy
//                enough to put in front of a tired person at 6pm.
//
// The AI section runs only when a key and the feature flag are both present.
// Absent either, it reports NOT RUN — never a pass, and never a silent skip.
// =============================================================================

import { readFile } from "node:fs/promises";

import { scanDimension } from "../src/lib/categories/candidates.ts";
import { canonicalSegmentLabels } from "../src/lib/calc/segments.ts";
import { minimalPackage, redactionRefusal } from "../src/lib/categories/advisor/contract.ts";
import { advisorAvailability, MAX_ACCEPTABLE_FALSE_MERGE_RATE, MIN_ACCEPTABLE_RECALL, EVALUATION_APPROVED } from "../src/lib/categories/advisor/flags.ts";
import { createOpenAiAdvisor } from "../src/lib/categories/advisor/openai.ts";

const fixture = JSON.parse(
  await readFile(new URL("./fixtures/category-evaluation.json", import.meta.url), "utf8"),
);

const pct = (n, d) => (d === 0 ? "n/a" : `${((n / d) * 100).toFixed(1)}%`);
const rate = (n, d) => (d === 0 ? 0 : n / d);

console.log("=".repeat(74));
console.log("Be Community — semantic category evaluation");
console.log("=".repeat(74));
console.log(`fixture: ${fixture.pairs.length} labelled pairs`);

// ---------------------------------------------------------------------------
// Deterministic path
// ---------------------------------------------------------------------------

/**
 * Run one fixture pair through the real scan, exactly as the product does.
 *
 * `proposed` — the scan raised this pair as a question.
 * `merged`   — the product grouped it WITHOUT a person. Must always be false.
 */
function evaluatePair(entry) {
  const counts = new Map(Object.entries(entry.counts));
  const scan = scanDimension(entry.dimensionKey, counts);

  const [a, b] = entry.pair;
  const group = scan.groups.find(
    (candidate) =>
      candidate.values.some((value) => value.raw === a) &&
      candidate.values.some((value) => value.raw === b),
  );

  // What the calculation layer would actually do with NO recorded decision.
  const respondents = Object.entries(entry.counts).flatMap(([raw, n]) =>
    Array.from({ length: n }, () => ({ segments: { [entry.dimensionKey]: raw } })),
  );
  const labels = canonicalSegmentLabels(respondents, {});
  const merged = labels.get(entry.dimensionKey)?.get(a) === labels.get(entry.dimensionKey)?.get(b);

  return {
    ...entry,
    proposed: Boolean(group),
    rule: group?.rule ?? null,
    strength: group?.strength ?? null,
    warnings: group?.warnings ?? [],
    merged,
  };
}

const results = fixture.pairs.map(evaluatePair);

const same = results.filter((r) => r.truth === "same");
const different = results.filter((r) => r.truth === "different");
const contextual = results.filter((r) => r.truth === "context");

// A pair the automatic fold already unified is CORRECTLY not proposed: it is
// already one category, so asking would be noise. Those are scored separately.
const autoFolded = same.filter((r) => r.merged);
const needsDecision = same.filter((r) => !r.merged);

const automaticFalseMerges = different.filter((r) => r.merged);
const blindFalseMerges = different.filter((r) => r.proposed);
const missedAliases = needsDecision.filter((r) => !r.proposed);
const abstentions = results.filter((r) => !r.proposed && !r.merged);

console.log("\n" + "-".repeat(74));
console.log("DETERMINISTIC PATH (no model, no credential — the shipping default)");
console.log("-".repeat(74));
console.log(`  labelled the same, already unified automatically   ${autoFolded.length}`);
console.log(`  labelled the same, needing a human decision        ${needsDecision.length}`);
console.log(`  labelled different                                ${different.length}`);
console.log(`  context-dependent                                 ${contextual.length}`);
console.log("");
console.log(`  FALSE MERGE (automatic)   ${automaticFalseMerges.length}/${different.length}  ${pct(automaticFalseMerges.length, different.length)}   <- must be 0`);
console.log(`  FALSE MERGE (blind accept) ${blindFalseMerges.length}/${different.length}  ${pct(blindFalseMerges.length, different.length)}`);
console.log(`  MISSED ALIAS               ${missedAliases.length}/${needsDecision.length}  ${pct(missedAliases.length, needsDecision.length)}`);
console.log(`  RECALL                     ${needsDecision.length - missedAliases.length}/${needsDecision.length}  ${pct(needsDecision.length - missedAliases.length, needsDecision.length)}`);
console.log(`  ABSTENTION                 ${abstentions.length}/${results.length}  ${pct(abstentions.length, results.length)}`);

if (missedAliases.length > 0) {
  console.log("\n  Missed (a question nobody was asked):");
  for (const r of missedAliases) console.log(`    - ${r.id}: ${r.pair.map((p) => JSON.stringify(p)).join("  vs  ")}`);
}
if (blindFalseMerges.length > 0) {
  console.log("\n  Raised but WRONG (harmless if read, harmful if rubber-stamped):");
  for (const r of blindFalseMerges) {
    console.log(`    - ${r.id} [${r.rule}/${r.strength}] warnings: ${r.warnings.join(",") || "none"}`);
  }
}

// Context-dependent pairs must never be presented as settled.
const contextRaisedWithoutCaveat = contextual.filter(
  (r) => r.proposed && r.strength === "equivalent",
);
console.log("\n  Context-dependent pairs presented as certain: " +
  `${contextRaisedWithoutCaveat.length}/${contextual.length}  <- must be 0`);

// By family, so a regression can be located.
console.log("\n  By family:");
for (const family of [...new Set(results.map((r) => r.family))]) {
  const rows = results.filter((r) => r.family === family);
  const raised = rows.filter((r) => r.proposed).length;
  const wrong = rows.filter((r) => r.truth === "different" && r.merged).length;
  console.log(`    ${family.padEnd(24)} ${raised}/${rows.length} raised, ${wrong} wrongly merged`);
}

// ---------------------------------------------------------------------------
// Privacy: what the AI path WOULD send, measured even when it cannot run
// ---------------------------------------------------------------------------
console.log("\n" + "-".repeat(74));
console.log("DATA MINIMISATION (measured whether or not the model is reachable)");
console.log("-".repeat(74));
let refusedPayloads = 0;
for (const entry of fixture.pairs) {
  const payload = minimalPackage({
    dimensionKey: entry.dimensionKey,
    optionCounts: new Map(Object.entries(entry.counts)),
    candidateLabels: entry.pair,
  });
  const refusal = redactionRefusal(payload);
  if (refusal) refusedPayloads += 1;
  const wire = JSON.stringify(payload);
  for (const forbidden of ["respondent", "tenant", "study", "@", "uuid"]) {
    if (wire.toLowerCase().includes(forbidden)) {
      console.error(`  LEAK: ${entry.id} payload contains ${forbidden}`);
      process.exitCode = 1;
    }
  }
}
console.log(`  payloads built:  ${fixture.pairs.length}`);
console.log(`  refused as unsafe to send: ${refusedPayloads}`);
console.log("  none carried a respondent, a client, a study or an address.");

// ---------------------------------------------------------------------------
// AI-assisted path
// ---------------------------------------------------------------------------
console.log("\n" + "-".repeat(74));
console.log("AI-ASSISTED PATH");
console.log("-".repeat(74));

const availability = advisorAvailability();
const liveRequested = process.argv.includes("--live");

if (!liveRequested) {
  console.log("  NOT RUN — pass --live to evaluate the model.");
  console.log("  The deterministic result above is the one that ships.");
} else if (!process.env.OPENAI_API_KEY) {
  console.log("  NOT RUN — no OPENAI_API_KEY in the environment.");
  console.log("  This is NOT a pass. The advisor has no measured result.");
} else {
  const model = process.env.OPENAI_ALIAS_MODEL?.trim() || "gpt-5.6-terra";
  const advisor = createOpenAiAdvisor({
    apiKey: process.env.OPENAI_API_KEY,
    model,
    reasoningEffort: process.env.OPENAI_ALIAS_REASONING_EFFORT?.trim() || "low",
    timeoutMs: Number(process.env.OPENAI_ALIAS_TIMEOUT_MS ?? 20000),
  });
  console.log(`  model: ${model}`);

  const verdicts = [];
  for (const entry of fixture.pairs) {
    const payload = minimalPackage({
      dimensionKey: entry.dimensionKey,
      optionCounts: new Map(Object.entries(entry.counts)),
      candidateLabels: entry.pair,
    });
    const outcome = await advisor.advise(payload);
    verdicts.push({ entry, outcome });
    process.stdout.write(outcome.ok ? "." : "x");
  }
  console.log("");

  const answered = verdicts.filter((v) => v.outcome.ok);
  const wouldMerge = (v) => v.outcome.verdict.decision === "probable_merge";
  const aiFalseMerge = answered.filter((v) => v.entry.truth === "different" && wouldMerge(v));
  const aiContextMerge = answered.filter((v) => v.entry.truth === "context" && wouldMerge(v));
  const aiTruePositives = answered.filter((v) => v.entry.truth === "same" && wouldMerge(v));
  const aiSame = answered.filter((v) => v.entry.truth === "same");
  const aiDifferent = answered.filter((v) => v.entry.truth === "different");
  const aiAbstain = answered.filter((v) => v.outcome.verdict.decision === "uncertain");
  const alwaysHuman = answered.every((v) => v.outcome.verdict.requiresHumanReview === true);

  console.log(`  answered:                 ${answered.length}/${verdicts.length}`);
  console.log(`  FALSE MERGE (advice)      ${aiFalseMerge.length}/${aiDifferent.length}  ${pct(aiFalseMerge.length, aiDifferent.length)}`);
  console.log(`  merged a context pair     ${aiContextMerge.length}`);
  console.log(`  RECALL on true aliases    ${aiTruePositives.length}/${aiSame.length}  ${pct(aiTruePositives.length, aiSame.length)}`);
  console.log(`  ABSTENTION                ${aiAbstain.length}/${answered.length}  ${pct(aiAbstain.length, answered.length)}`);
  console.log(`  every verdict demanded a human: ${alwaysHuman}`);

  for (const v of aiFalseMerge) {
    console.log(`    FALSE MERGE: ${v.entry.id} — ${v.outcome.verdict.conciseReason}`);
  }

  const falseRate = rate(aiFalseMerge.length + aiContextMerge.length, aiDifferent.length + aiContextMerge.length);
  const recall = rate(aiTruePositives.length, aiSame.length);
  console.log("");
  console.log(`  THRESHOLD false-merge <= ${MAX_ACCEPTABLE_FALSE_MERGE_RATE}  measured ${falseRate.toFixed(3)}  ${falseRate <= MAX_ACCEPTABLE_FALSE_MERGE_RATE ? "MET" : "NOT MET"}`);
  console.log(`  THRESHOLD recall      >= ${MIN_ACCEPTABLE_RECALL}  measured ${recall.toFixed(3)}  ${recall >= MIN_ACCEPTABLE_RECALL ? "MET" : "NOT MET"}`);
  console.log("");
  console.log("  Meeting both thresholds does NOT enable the advisor. A person must read");
  console.log("  these numbers, record them in docs/SEMANTIC_CATEGORY_REVIEW.md, and flip");
  console.log("  EVALUATION_APPROVED in src/lib/categories/advisor/flags.ts in a reviewed");
  console.log("  commit. That is deliberate: a threshold nobody read is not an acceptance.");
}

// ---------------------------------------------------------------------------
console.log("\n" + "=".repeat(74));
console.log(`advisor currently: ${availability.available ? "ENABLED" : `DISABLED (${availability.reason})`}`);
console.log(`EVALUATION_APPROVED = ${EVALUATION_APPROVED}`);

// THE ONE HARD FAILURE. Everything else is reported for a human to weigh; this
// is the property the product cannot ship without.
if (automaticFalseMerges.length > 0) {
  console.error("\nRESULT: the product merged categories that are NOT the same, with no human.");
  for (const r of automaticFalseMerges) console.error(`  - ${r.id}`);
  process.exit(1);
}
if (contextRaisedWithoutCaveat.length > 0) {
  console.error("\nRESULT: a context-dependent pair was presented as certain.");
  process.exit(1);
}
if (process.exitCode === 1) {
  console.error("\nRESULT: a payload carried something it must not.");
  process.exit(1);
}
console.log("\nRESULT: zero automatic false merges. Every grouping requires a person.");
