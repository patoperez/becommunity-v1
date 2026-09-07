# Canonical presentation model — the bridge a customizable dashboard binds to

> **Unit 6A, source only.** No route, no React, no Studio UI, no shadow mode, no
> deployment, no hosted read or write. Read `docs/CANONICAL_RESULTS_MODEL.md`
> first: this layer describes how a presentation NAMES what that one produced.

---

## 1. Why this layer exists

`src/lib/results/` answers *what is true about the study*. A dashboard needs a
second question answered: *what may a presentation name, and what may it do with
each of those things?*

Without an explicit answer, an editor ends up binding to whatever it can reach.
The reachable names are canonical keys — `csat_ax`, `perfil_cliente_h`,
`nps_activos` — and once a stored layout contains one of those, three things
follow. The shape of the warehouse is published to anyone who opens a saved
dashboard. The layout breaks the moment a projection revision renames a column.
And the editor, holding a key, is one short step from resolving it itself, which
is a browser owning a number.

So the layer has one job with two halves:

- a **registry** of opaque handles, derived from a finished results document,
  saying what exists and what may be done with it;
- a **resolver** that turns *(document + registry + results)* into a
  serializable render model containing final values and nothing else.

**The standing rule is unchanged and this layer is how it survives contact with
a dashboard:** composite metrics are canonical functions defined once
(`src/lib/calc/metrics.ts`, `business-metrics.ts`). The frontend, the renderer
and the presentation configuration never calculate, average, sum, divide, derive
a percentage, classify a band, or reconstruct a business metric.

---

## 2. The naming reconciliation

The Unit 6A brief calls the canonical document `StudyResultsDocument`. **That
type does not exist.** A repository-wide search returns zero occurrences. The
real type is **`CanonicalStudyResults`** (`src/lib/results/contract.ts:691`),
built by `buildCanonicalStudyResults`. Everything here binds to the real name.

---

## 3. Handles, and what "opaque" means

A handle is `facet:segment(-segment)*` — lower-case ASCII only, and **no
underscore**, which matters: every canonical item, attribute, instrument, metric
and band-scheme key in this project is `snake_case`, so a name that cannot
contain an underscore cannot accidentally BE one of them.

A handle is built from exactly three kinds of material:

1. a word from the closed vocabulary (`nps`, `renewal-index`, `touchpoint-tdp`);
2. a **label the client is already shown**, slugified (`dimension:esfera` from
   the label «Esfera», never from the column `perfil_cliente_h`);
3. an **ordinal position** (`journey-touchpoint:g1-t24`).

Opaque means *carries no address*, not *unreadable*. `value:nps-desertores`
tells a colleague which block they are looking at and tells a reader nothing
about where the number is stored — which is the property that matters.

**Touchpoints are addressed by position on purpose.** For Cuicuilco v1
`JourneyTouchpointResult.shortLabel` is `null`: the source names a touchpoint by
the entire question it asks, and the short label lives in a column the projection
records as the *answer's* derived label. A handle built from that text would be
unusable, and deriving a short name by cutting the question apart is a
transformation nobody documented. So `journey-touchpoint:g1-t24` is *item 24 of
the first source category* — which is exactly how the workbook identifies it.

| facet | what it names |
|---|---|
| `value:` | one final, already-calculated number |
| `distribution:` | a categorical breakdown, already counted and shared |
| `series:` | an ordered set of periods |
| `population:` | population and base accounting |
| `dimension:` | a dimension a surface may offer as a filter control |
| `journey-group:` | one **source** journey group |
| `journey-touchpoint:` | one measured touchpoint |
| `qualitative:` | a curated qualitative aggregate |
| `editorial:` | a slot the contract says a human or a configuration fills |

---

## 4. The registry: two halves that must not be confused

```
buildCanonicalPresentationRegistry(results: CanonicalStudyResults)
  → { registryVersion, contractVersion, entries, addresses }
```

**`entries` is describable.** Handle, semantic, a client-safe label, the display
formats and chart variants that already apply, availability, the response/base
context, a coarse provenance category, and the filters the result supports or
refuses. Every field may be shown to a client.

**`addresses` is not.** A `CanonicalAddress` says WHERE a value already sits —
`{ at: "recommendation.score", scopeIndex: 1 }`. It is a POINTER, never an
instruction, it addresses by array position so it cannot leak a storage name, and
it is server-only: `projectPresentationCatalog` drops it and the render model
never carries it. A gate asserts both by scanning the serialized output for
`"at":`.

**The registry contains no formula.** There is no expression, no denominator, no
threshold and no arithmetic operator in it. If it ever needs a `+`, something has
been designed wrong.

### Availability is four-valued and never collapsed

`available` / `unavailable` / `unresolved` mirror `ResultStatus` exactly, and
`configuration_required` is the contract's fourth state — a settled answer
("this is not calculated, and here is who supplies it"), never a defect. A
surface that could not tell an unavailable result from an unresolved one will
eventually print the wrong caption over an empty card.

---

## 5. The presentation document

Pages, block instances, order, per-breakpoint grid placement, responsive
behaviour, authored copy, bindings by handle, chart variants, filter panels,
explicit filter connections, journey routes, editorial slots, a sample-display
policy, a methodology-disclosure level, visibility, duplication, and the
publication metadata the existing draft/revision model already requires.

Validation is Zod, `strictObject` throughout, so an unknown field is rejected
rather than ignored.

**A document carries NO database state, and the envelope is where it lives.**
Unit 6A put `metadata.studyId`, `metadata.tenantId` and a publication block
(status, source draft revision, a SHA-256 of itself, a study fingerprint,
acknowledged warnings, a prepared note) inside the document, because
`prepare_study_experience_revision` genuinely refuses a definition whose
`metadata` disagrees with the study row. That was right about the RPC and wrong
about the layering: a database identifier became authorable, migration 0025's
lifecycle was duplicated in a writable second copy, and a hash sat inside the
bytes it covers, where it cannot stay true.

`src/lib/presentation/persistence.ts` owns all of it now.
`encodePresentationForStorage` validates the document, stamps the scope in the
shape 0025 cross-checks, and hashes the finished bytes from OUTSIDE.
`decodePresentationFromStorage` refuses a row whose stored `schema_version`
disagrees with the JSON, refuses a row belonging to another study, and strips the
metadata before returning an authorable document. Nothing writes yet — the
encoder and decoder exist for Unit 6B to wire.

**A document does pin its binding.** `registryVersion` says which vocabulary it
was authored against, and `binding` is a 64-hex digest over the study scope, the
plan and package identity, both versions, and the entire ordered
handle-to-address map. `null` means "study-agnostic template", which is what the
approved blueprint is; `bindPresentationDocument` is the explicit act that ties
one to a study.

### Versioning, and why the number is 4

`study_experience_draft.schema_version` and
`study_experience_revision.schema_version` are **INTEGER** columns bounded
`1..1000` (`0023…sql:82-85`), and both write functions refuse a document whose own
`schemaVersion` disagrees with the argument (`0024…sql:86-88`,
`0025…sql:407-409`). So the version is an integer; a semver string could not be
stored at all.

Versions **1, 2 and 3 are already taken** by the legacy experience definition
(`EXPERIENCE_SCHEMA_VERSION = 3` at `6311f0a`), and two draft rows exist on the
hosted project. Unit 6A said the database could not reveal their versions; that
was wrong — `schema_version` is `not null` and the save RPC requires it to equal
`definition.schemaVersion`, so the value was always readable. A read-only
inventory on 2026-09-06 found the P6E synthetic acceptance draft at **version 3,
revision 14** and «La voz de las y los Nets de Cuicuilco» at **version 2,
revision 72**; column and JSON agree on both and neither declares a
`documentKind`, so both are LEGACY-family documents. Unit 6A therefore does
three things:

1. claims **4**, so a presentation document cannot be mistaken for a legacy one
   by version alone;
2. carries `documentKind: "canonical_presentation"`, because a version is a
   number and numbers can be edited, while a discriminator is a claim about what
   the thing IS;
3. **recognises 1–3 explicitly** and refuses them with a message that names the
   legacy family, instead of failing as though the document were corrupt.

**Nothing is migrated, in either direction.** The legacy `migrate.ts` rule that a
published snapshot is never migrated is kept and widened. Reinterpreting a stored
draft as a document of another family is precisely the silent behaviour that is
forbidden. An unknown version fails safely and **visibly**.

---

## 6. Filters are explicit, and sharing a dimension is not a connection

A block is moved by a filter panel when, and only when,
`connectedFilterPanelIds` names it. This is the one idea taken almost whole from
the previous experience line, which stated it exactly (`definition.ts:753-773`):
*"Sharing a characteristic is not a connection… Nothing is ever matched by key;
a block responds when, and only when, a connection names it."*

The approved dashboard depends on the distinction, and the blueprint reproduces
it: **"Razones declaradas de riesgo"** shares every dimension with the risk panel
and is deliberately not moved by it, because it is reported over the whole active
base and says so. The comparison cells beside the recommendation headline are
likewise unconnected.

Two refusals are kept apart on purpose:

- `unsupported_filter_dimension` — the result does not carry that dimension;
- `forbidden_filter_cross` — **an authority forbids publishing it.**

Collapsing them would let a future change quietly reclassify a prohibition as a
capability gap.

### Esfera × CRI, and the one place the oracle is not followed

The methodology forbids crossing Esfera with the CRI (§5.2, «OJO: La esfera no se
debe cruzar en este KPI»). **The approved dashboard's own risk panel offers
Esfera** — recorded in `CLAUDE.md` as a reference-dashboard deviation. The
canonical contract wins.

The blueprint corrects it *by construction* rather than by an exclusion list: the
risk panel is built from the dimensions the renewal result itself declares it
supports, and the registry has already removed the forbidden cross from that
list. A hand-maintained exclusion is something somebody can forget to update; a
derivation is not.

---

## 7. Small samples are shown

The canonical layer applies **no suppression** (`CANONICAL_RESULTS_MODEL.md` §5):
a small base is reported, never used to withhold a result, down to a single
respondent. That is a property of the results and this layer does not change it.

What this layer owns is the **display** decision, and it is a decision somebody
makes on purpose:

- **`show_all` is the system default** and the only mode needing no argument;
- `annotate_below` and `hide_below` **require `authoredBy` and `rationale`**.

**A suppressing policy takes the PARTS with the WHOLE.** Withholding a
recommendation score while publishing promoters, pasivos and detractores with
their shares withholds nothing: an NPS is %promoters − %detractors, so the
number comes straight back by subtraction. Distributions, curated terms, the
structural touchpoint payload and every series obey the policy that governs the
scalar beside them. A new payload shape must be guarded when it is added.

**`annotate_below` is resolved on the server.** The base is compared to the
threshold here, and what crosses the boundary is a finished sentence
(`RenderBlock.sampleNote`). Sending the browser a threshold to compare against
would be sending it a calculation.

That requirement is not ceremony. It is what makes "a person decided to hide
this" a different fact from "the software hid it", and it is why a hide-below
rule cannot be inherited, defaulted, or stamped by an adapter. The legacy
`adaptLegacyStudy` stamped `hide_below 5` on every definition it produced; that
behaviour is deliberately not carried across. A block-level policy stays a
block-level policy — the gate proves that authoring one changes that block and
no other.

---

## 8. Methodology disclosure discloses method, never formula

Four levels: `none`, `base_only`, `plain_language`, `plain_language_with_base`.

The highest renders the contract's own client-safe `explanation` prose beside the
base the result rests on — which is what makes a number honest — and stops there.
**There is no level that yields a formula.** `ResultInternalProvenance` (the
canonical metric key, the source families, the authority statements) is
unreachable from any disclosure setting, which is why "reveal the method" and
"reveal the formula" stay different requests.

---

## 9. Four source groups, five visible routes

These are different layers and the distinction is load-bearing.

**Four groups are evidence.** The satisfaction sheet carries exactly four merged
ranges on its band row (`D1:BI1`, `BJ1:BU1`, `BV1:CO1`, `CP1:DI1`); those bands
put 55 touchpoints into 4 categories, **29 / 6 / 10 / 10**, and column order is
the order inside a group. The canonical contract carries those four.

**Five routes are a decision.** The approved dashboard splits the first category
into «Operación» and «Interacción» because, in its own words, it «reúne dos cosas
que se viven de maneras muy distintas». That split lives in the presentation
document as two routes naming the same source group and partitioning its 29
touchpoints between them — 19 and 10.

The resolver enforces the honesty of the arrangement:

- `route_touchpoint_outside_group` — a route may not claim a touchpoint the
  source did not place in its group;
- `route_touchpoint_duplicated` — no touchpoint is shown twice.

«Operación» deliberately does **not** run in source order: it gathers the
chapter's operating moments in the sequence a member lives them. Reordering
within a route is exactly the kind of decision a presentation layer may make and
a results contract may not.

---

## 9b. Two halves, and only one of them may be imported by a browser

`src/lib/presentation/index.ts` is the CLIENT-SAFE barrel: the closed
vocabulary, opaque handle helpers, typed errors, the authorable document and its
validator, deterministic serialization, catalogue rows, and public render-model
types. Every one of those is a shape.

`src/lib/presentation/server.ts` carries `import "server-only"` and is the only
route to the registry's address map, `RegistrySource`, the resolver, persistence
encoding and the blueprint. Unit 6A exported all of those from the safe barrel;
nothing imported them, so nothing broke — but a boundary that holds only because
nobody noticed is not a boundary.

Offline gates import the pure implementation modules directly, because
`server-only` throws under a plain Node import and a gate is not a client. The
boundary is for PRODUCTION code, and an import-graph walk rooted at every client
component, HTTP route, server action, page and the middleware proves no path
reaches the server half — or `src/lib/results/`.

### The public render model tells a reader the outcome, not the deliberation

A withheld result says `withheld_by_policy` and carries a separately authored
`publicNote` when somebody wrote one for a reader. It does NOT carry the
threshold, `authoredBy` or the internal `rationale`: those are audit fields, and
shipping them publishes the study's own deliberation beside the gap it made.
`annotate_below` likewise arrives as a finished sentence — the comparison
happened on the server, because comparing is calculating.

---

## 9c. The registry is bound to ONE results document

Checking that the contract VERSIONS agree is a test two different studies pass
together. Every `CanonicalAddress` is an array position, so a registry built from
study A and handed study B's results resolves every handle cleanly and answers
with the wrong numbers — the worst failure this layer could have, because nothing
looks broken.

So the resolver refuses on four separate codes:

| code | what moved |
|---|---|
| `registry_contract_mismatch` | the results contract version |
| `registry_study_mismatch` | the tenant or the study |
| `registry_plan_mismatch` | the projected plan, package, mapping or spec |
| `registry_version_mismatch` | the presentation-registry version the document names |
| `binding_fingerprint_mismatch` | the handle-to-address map itself |

The last one is what makes handles safe to save. A handle is derived from a
label or a position, so renaming a dimension, reordering a group, or inserting a
dimension or touchpoint earlier could all silently point a saved binding at a
different result. Each of those moves the fingerprint, so a bound document
REFUSES instead. All four mutations are executed by the gate.

---

## 10. TDP may exceed 100

TDP is unawareness over the **valid** base (§4.1). It is a `ratio`, not a
`percent`, and the distinction is enforced in the vocabulary: `SEMANTIC_UNITS`
declares `ratio`, and `COMPATIBLE_CHART_VARIANTS` refuses to let a ratio be drawn
on a `gauge`. In the approved study one touchpoint — «Salida» — reports
**133.3%** (16 unaware over a valid base of 12). Nothing in this layer clamps,
caps or rescales it. Two discrimination cases prove the gate notices: a
`Math.min(100, …)`, and a TERNARY clamp carrying no `Math` call at all — the
second is invisible to every static scan and is caught instead by the assertion
that every finished number in a render model traces back to the canonical
document.

---

## 11. The approved blueprint

`src/lib/presentation/blueprints/cuicuilco-approved.ts` expresses the approved
dashboard's structure — 24 blocks over one page — using only handles and
configuration. **It is not a route and not a client page**; there is no branch on
a study id anywhere in `src/lib/presentation/`.

**It carries no number.** Not 30.8, not the CRI of 33, not 74.1, not 133.3. A
gate scans the layer for those literals. Every value arrives at resolution time.

Its inventory: study cover and population; instrument bases; retention and
attrition with its methodology note; the recommendation headline, composition and
two unconnected comparison cells, with a filter panel; the five journey routes
with their own panel; the renewal index, its distribution and the unconnected
"declared reasons" list, with a panel that omits the forbidden cross; the active
and deserter qualitative clouds; the journey pain-point cloud as an **empty
editorial slot**; and the executive closing.

### The pain-point cloud stays configuration-required

The approved dashboard publishes a populated cloud of 79 curated phrases. The
canonical contract classifies that content as `editorial_review`
(`curated_journey_pain_cloud`), because it depends on a phrase segmentation and a
touchpoint-to-stage alias table that cannot be derived authoritatively from the
canonical sources — the approved dashboard resolves the second with a hand-written
table in its own build script, which is an implementation and not an authority.

So the blueprint declares the slot, leaves it empty, and the render model reports
`configuration_required` naming who must supply it. **The phrases are not
copied.** Supplying content later flips the block to `available`; the gate proves
both halves.

---

## 12. Commands

```
npm run test:canonical-presentation          # synthetic, offline, in `npm test`
npm run test:canonical-presentation-parity <clean.xlsx> <curated.xlsx>
```

The parity gate compares against the APPROVED DASHBOARD, not against this
layer's own output. Unit 6A's first run failed because it produced `"33"` where
the oracle shows `"33.0"`, and the fix compared the value with the contract's own
text instead — which proves self-consistency and nothing about parity. The
expectation is now the oracle's literal string.

The parity gate is deliberately **outside** `npm test`, exactly as
`test:canonical-results-parity` is, because its inputs are machine-specific. Run
without workbooks it reports itself SKIPPED — never as a pass.

---

## 13. What Unit 6A did NOT do

No route, no React component, no editor, no Studio UI. No read path switched. No
shadow mode enabled. No migration added or edited. No dependency added. No
credential rotated or altered, and no hosted WRITE of any kind — Unit 6A.1 makes
exactly one hosted read, the read-only draft inventory recorded in
`docs/CURRENT_STATE.md`.
The legacy dashboard is untouched and still broken in the three documented ways.
`main` is unchanged.

Unit 6B is **selective Studio composer integration against this binding layer** —
not a wholesale merge of the old experience branch. See
`docs/CANONICAL_EXPERIENCE_INTEGRATION_PLAN.md`.
