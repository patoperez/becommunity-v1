/**
 * Journey editor gate — a moment can be named by typing, one keystroke at a
 * time, without the row being replaced underneath the caret.
 *
 * THE DEFECT THIS GUARDS AGAINST. The editor keyed each row on the stage's
 * stored identifier, and a stage that has never been saved derives that
 * identifier from its own name. Typing "D" moved the key from `momento_1-0` to
 * `d-0`; React treats a changed key as a different element, unmounted the row
 * and mounted a new one, and the browser threw away the focused <input> with
 * the DOM node. Naming a moment cost one mouse click per letter, and the
 * incomplete-stage warning appeared after the first character because the
 * label was now non-empty while the metric was not yet chosen. A consultant
 * could not build a study from scratch.
 *
 * WHAT IS ASSERTED. The row identity (`uid`) and the stored identifier (`id`)
 * are now two different things with two different rules, and both live in
 * `journey-picker.ts` as pure functions the editor calls. This gate drives
 * those real functions the way the component drives them — one character per
 * change event, exactly as an onChange handler fires — and asserts the
 * invariants a user would notice. It is deterministic and credentials-free.
 *
 * The structural assertions at the end are narrow and deliberate: they exist
 * only because the failure mode IS a source-level one — a key expression that
 * interpolates something the operator can type. A behavioural test cannot see
 * a React key, so the key expression itself is the thing to pin down.
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  addStageDraft,
  editStageDraft,
  removeStageDraft,
  stageDraftRefusal,
  toStageEditorDrafts,
} from "../src/lib/studio/journey-picker.ts";
import { journeyDefinitionSchema } from "../src/lib/calc/journey.ts";

let checks = 0;
const ok = (message) => { checks += 1; console.log(`  PASS  ${message}`); };

const readCode = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

/** What the form submits: the four positional `stage_*` field groups. */
const submitted = (drafts) => ({
  stages: drafts.map((draft) => ({
    id: draft.id,
    label: draft.label,
    metric: draft.metric,
    description: draft.description || undefined,
  })),
});

/**
 * One `onChange` per character, which is what a keyboard actually produces.
 * Returns every intermediate state so the row's identity can be inspected
 * after each keystroke rather than only at the end.
 */
function type(drafts, uid, field, text) {
  const states = [];
  let current = drafts;
  let value = current.find((draft) => draft.uid === uid)[field];
  for (const character of [...text]) {
    value += character;
    current = editStageDraft(current, uid, { [field]: value });
    states.push(current);
  }
  return { drafts: current, states };
}

const row = (drafts, uid) => drafts.find((draft) => draft.uid === uid);

// ---------------------------------------------------------------------------
// 1. A whole name can be typed into a brand-new moment
// ---------------------------------------------------------------------------

console.log("\n[1] Typing a name never replaces the row it is being typed into");

const drafts = addStageDraft(toStageEditorDrafts([]), 1);
const firstUid = drafts[0].uid;
assert.equal(drafts.length, 1);
assert.equal(drafts[0].isNew, true);

const typed = type(drafts, firstUid, "label", "Recomendación del capítulo");
for (const [index, state] of typed.states.entries()) {
  assert.equal(state.length, 1, "typing must never add or drop a row");
  assert.equal(
    state[0].uid,
    firstUid,
    `the row identity must survive keystroke ${index + 1} — a changed key remounts the input and drops focus`,
  );
}
assert.equal(row(typed.drafts, firstUid).label, "Recomendación del capítulo",
  "every character typed must still be there");
ok("26 keystrokes leave one row, the same row identity, and the full value");

// The proof that this was the defect rather than a coincidence: recompute the
// key the editor used to hand React and watch it move under the caret.
const formerKeys = new Set(typed.states.map((state) => `${state[0].id}-0`));
assert.ok(formerKeys.size > 1,
  "the identifier-derived key really did move while a name was being typed");
assert.equal(new Set(typed.states.map((state) => state[0].uid)).size, 1);
ok(`the old identifier-derived key took ${formerKeys.size} distinct values over those keystrokes; the uid took 1`);

// The stored identifier is still derived, and is still schema-valid: it is the
// key that must not move, not the id.
assert.equal(row(typed.drafts, firstUid).id, "recomendacion_del_capitulo",
  "accents and spaces still become a storable identifier");
ok("a new moment ends up with a valid persisted identifier of its own");

// Pasting the same text arrives as one change event rather than 26. Both paths
// must reach the identical state.
const pasted = editStageDraft(drafts, firstUid, { label: "Recomendación del capítulo" });
assert.deepEqual(pasted, typed.drafts, "pasting and typing must produce the same row");
ok("pasting a whole name is the same operation as typing it");

// ---------------------------------------------------------------------------
// 2. Choosing a result, then writing a description, keeps the name
// ---------------------------------------------------------------------------

console.log("\n[2] One field never resets another");

let stage = editStageDraft(typed.drafts, firstUid, { metric: "nps_capitulo" });
assert.equal(row(stage, firstUid).label, "Recomendación del capítulo",
  "choosing a result must not reset the name");
assert.equal(row(stage, firstUid).uid, firstUid, "choosing a result must not replace the row");

const described = type(stage, firstUid, "description", "Qué siente la persona. Y qué hace después.");
for (const state of described.states) {
  assert.equal(row(state, firstUid).label, "Recomendación del capítulo",
    "the name must survive every keystroke of the description");
  assert.equal(row(state, firstUid).metric, "nps_capitulo",
    "the chosen result must survive every keystroke of the description");
  assert.equal(row(state, firstUid).uid, firstUid, "the description must not replace the row");
}
stage = described.drafts;
assert.equal(row(stage, firstUid).description, "Qué siente la persona. Y qué hace después.");
assert.equal(stageDraftRefusal(stage), null, "a named, measured moment is saveable");
ok("name, result and description coexist; the warning clears when the moment is complete");

// ---------------------------------------------------------------------------
// 3. Several moments stay separate, and removing one removes only that one
// ---------------------------------------------------------------------------

console.log("\n[3] Moments are independent, and Quitar takes exactly one");

let many = toStageEditorDrafts([]);
for (const sequence of [1, 2, 3]) many = addStageDraft(many, sequence);
const [a, b, c] = many.map((draft) => draft.uid);
assert.equal(new Set([a, b, c]).size, 3, "every row must have its own identity");

const NAMES = {
  [a]: "Recomendación del capítulo",
  [b]: "Dar referencias",
  [c]: "Recibir referencias",
};
const METRICS = { [a]: "nps_capitulo", [b]: "sat_referencias", [c]: "prom_recibidas" };
for (const uid of [a, b, c]) {
  many = type(many, uid, "label", NAMES[uid]).drafts;
  many = editStageDraft(many, uid, { metric: METRICS[uid] });
}
for (const uid of [a, b, c]) {
  assert.equal(row(many, uid).label, NAMES[uid], "editing one moment must not touch another");
  assert.equal(row(many, uid).metric, METRICS[uid]);
}
assert.deepEqual(many.map((draft) => draft.id),
  ["recomendacion_del_capitulo", "dar_referencias", "recibir_referencias"]);
ok("three moments carry three names, three results and three identifiers");

const withoutMiddle = removeStageDraft(many, b);
assert.deepEqual(withoutMiddle.map((draft) => draft.uid), [a, c], "only the middle row goes");
assert.equal(row(withoutMiddle, a).label, NAMES[a], "the row above keeps its value");
assert.equal(row(withoutMiddle, c).label, NAMES[c], "the row below keeps its value");
assert.equal(row(withoutMiddle, c).description, "", "and its own empty fields stay its own");
ok("removing the middle moment leaves the other two untouched and unmoved");

// A row added after a removal must not reuse a key React has already seen.
const afterRemoval = addStageDraft(withoutMiddle, 4);
assert.equal(new Set(afterRemoval.map((draft) => draft.uid)).size, 3,
  "a new row must never resurrect a removed row's identity");
assert.ok(!afterRemoval.some((draft) => draft.uid === b));
ok("the row added after a removal takes a fresh identity");

// Two moments typed with the same name still submit two different identifiers.
let twins = addStageDraft(addStageDraft(toStageEditorDrafts([]), 1), 2);
twins = type(twins, twins[0].uid, "label", "Primer contacto").drafts;
twins = type(twins, twins[1].uid, "label", "Primer contacto").drafts;
assert.deepEqual(twins.map((draft) => draft.id), ["primer_contacto", "primer_contacto_2"],
  "a collision is suffixed rather than shared");
assert.match(stageDraftRefusal(twins), /Elige qué resultado/,
  "the refusal is about the missing result, not about a duplicate identifier");
ok("two moments named the same still submit two unique identifiers");

// ---------------------------------------------------------------------------
// 4. A saved moment keeps the identifier its comments point at
// ---------------------------------------------------------------------------

console.log("\n[4] Renaming a saved moment never moves its stored identifier");

const SAVED = [
  { id: "primer_contacto", label: "Primer contacto", metric: "nps_capitulo", description: "Cómo llega." },
  { id: "acompanamiento", label: "Acompañamiento", metric: "sat_servicio" },
];
const existing = toStageEditorDrafts(SAVED);
assert.deepEqual(existing.map((draft) => draft.id), ["primer_contacto", "acompanamiento"]);
assert.deepEqual(existing.map((draft) => draft.isNew), [false, false]);
assert.equal(existing[1].description, "", "a missing description becomes an empty box, not undefined");

const savedUid = existing[0].uid;
const renamed = type(existing, savedUid, "label", " renovado");
for (const state of renamed.states) {
  assert.equal(row(state, savedUid).id, "primer_contacto",
    "a saved identifier must not follow the name: qual_observation.confirmed_stage_key points at it");
  assert.equal(row(state, savedUid).uid, savedUid, "renaming must not replace the row either");
}
assert.equal(row(renamed.drafts, savedUid).label, "Primer contacto renovado");
ok("a saved moment can be renamed in full and keeps the identifier its comments are linked to");

// The patch type is what enforces it: `id` is not a field the editor can send.
const attempted = editStageDraft(existing, savedUid, { id: "otro_id" });
assert.equal(row(attempted, savedUid).id, "primer_contacto",
  "no editor patch may move a stored identifier");
ok("the stored identifier is not something an edit can address at all");

// A new moment added below saved ones still gets a valid, unique identifier.
let mixed = addStageDraft(existing, 1);
mixed = type(mixed, mixed[2].uid, "label", "Acompañamiento").drafts;
assert.equal(mixed[2].id, "acompanamiento_2", "a new moment may not collide with a saved one");
assert.notEqual(mixed[2].uid, mixed[1].uid);
ok("a new moment beside saved ones takes a fresh identifier and a fresh row identity");

// ---------------------------------------------------------------------------
// 5. What is submitted is still exactly what the Server Action reads
// ---------------------------------------------------------------------------

console.log("\n[5] The stage_* contract is unchanged");

for (const [name, set] of [["three new moments", many], ["saved plus new", mixed]]) {
  const complete = set.map((draft) => ({ ...draft, metric: draft.metric || "nps_capitulo" }));
  const parsed = journeyDefinitionSchema.safeParse(submitted(complete));
  assert.ok(parsed.success, `${name} must still satisfy journeyDefinitionSchema`);
  assert.deepEqual(parsed.data.stages.map((stage) => stage.id), complete.map((draft) => draft.id),
    "the ids submitted are the ids the editor holds, in the same order");
}
assert.ok(!Object.keys(many[0]).includes("key"), "the row carries no field the schema does not know");
for (const draft of [...many, ...mixed]) {
  assert.ok(!Object.values(submitted([draft]).stages[0]).includes(draft.uid),
    "the row identity is never submitted, stored or sent anywhere");
}
ok("the four positional stage_* groups still parse, in order, with no extra field");

// ---------------------------------------------------------------------------
// 6. Row identity is deterministic, so the server and the browser agree
// ---------------------------------------------------------------------------

console.log("\n[6] Nothing random decides a row identity");

assert.deepEqual(toStageEditorDrafts(SAVED), toStageEditorDrafts(SAVED),
  "the initial rows must be identical on the server and on hydration");
assert.deepEqual(toStageEditorDrafts(SAVED).map((draft) => draft.uid), ["saved:0", "saved:1"]);
assert.deepEqual(addStageDraft(toStageEditorDrafts(SAVED), 7)[2].uid, "added:7",
  "a row added after hydration takes the editor's own counter, never a random value");
ok("row identities are positional and reproducible, never generated at random");

// ---------------------------------------------------------------------------
// 7. The key expression itself — the only place the defect could return
// ---------------------------------------------------------------------------

console.log("\n[7] No list key is derived from anything a person can type");

const keyExpressions = (source) =>
  [...source.matchAll(/key=\{([^}]*)\}?/g)].map((match) => match[1].trim());

const editor = await readCode("src/components/studio/JourneyStagesFields.tsx");
assert.deepEqual([...new Set(keyExpressions(editor))].sort(), ["draft.uid", "option.key"],
  "the row key must be the stable uid — never the stored id, never the position, never a template literal");
assert.match(editor, /toStageEditorDrafts\(initialStages\)/,
  "the editor must build its rows through the model that assigns the uid");
for (const unstable of [/Math\.random/, /randomUUID/, /Date\.now/]) {
  assert.doesNotMatch(editor, unstable, "no row identity may come from a non-deterministic source");
}
assert.doesNotMatch(editor, /setDrafts\(drafts\./,
  "every list change must be a functional update, so a stale closure cannot revive a removed row");
ok("the recorrido editor keys its rows on the uid and nothing else");

// The same defect existed one screen away, in the recoding rows of the import
// mapper: the key was the label being typed into the row.
const workbench = await readCode("src/app/admin/upload/MappingWorkbench.tsx");
for (const expression of keyExpressions(workbench)) {
  assert.doesNotMatch(expression, /\$\{/,
    `a list key in the import mapper must not be assembled from values ("${expression}")`);
}
ok("the import mapper's recoding rows are no longer keyed on the text being typed into them");

console.log(`\nOK — ${checks} journey editor checks passed.`);
