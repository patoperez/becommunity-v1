# Canonical results model — the server-side read model a dashboard receives

> **Unit 5, Phase 1.** Source only. No hosted canonical table was written, no
> real workbook was imported, no existing read path changed, and no dashboard UI
> was built. What exists now is the layer a future dashboard will consume, and
> the executable proof that it reproduces the CEO-approved numbers.

---

## 1. Why this layer exists

The approved BNI Cuicuilco dashboard computes its own numbers. That was correct
for an emergency deliverable and is wrong for the product: a composite metric
defined in a component is a metric defined twice, and the second definition
drifts silently. A wrong number does not throw — it is presented to a client as
a finding about their organisation.

So the product's rule — composite metrics are canonical functions defined once
(`src/lib/calc/metrics.ts`, `src/lib/calc/business-metrics.ts`) — has to reach
the future dashboard too. `src/lib/results/` is the shape that carries it: one
versioned, aggregate-only document, calculated on the server, already banded and
already formatted, with the base every number rests on stated beside it.

**The frontend receives results. It never calculates them.** A component may
format a string it was given, place a marker, size a bar or choose a colour
token; it may not decide what a number means. `npm run test:canonical-results`
executes that boundary: it fails if any module under `src/lib/results` reaches a
transport, if any module under `src/components` or `src/app` imports a metric
definition or re-implements one, and it verifies its own detector both fires on
a real formula and stays quiet on a bar width.

---

## 2. What the contract carries

`src/lib/results/contract.ts`, `CANONICAL_RESULTS_CONTRACT_VERSION = "2.0.0"`.

> **2.0.0** carries the methodology owner's decisions of 2026-09-06. The
> touchpoint's authoritative unawareness metric is now `tdp`, the auxiliary
> proportion sits beside it under an explicit name, and the journey's
> stage-evidence result is a settled contract rule rather than an open
> question. Field renames make it breaking, so the major moved.

Two versions, two questions, answered separately: the **contract version**
changes when the SHAPE changes; `calculationVersion` (carried on every result)
changes when a FORMULA changes.

| section | what it carries |
|---|---|
| `study` | spec id, mapping version, calculation version, tenant, study, package idempotency key and the **plan fingerprint** — so a result can name the exact bytes behind it |
| `period` | the period reported on and the data cut-off |
| `population` | study population, measured population, per-cohort counts, per-instrument bases |
| `filters` | the dimensions offered, the selection applied, the resulting population |
| `recommendation` | NPS per scope, with promoter / passive / detractor counts and shares |
| `renewal` | the churn-risk index and its five-rung distribution |
| `retention` | per period: four source counts with their states, retention, attrition |
| `journey` | groups, ordered touchpoints, each owning its CSAT, its TDP and the auxiliary unawareness share, plus exclusions, the curated stage model and the stage-evidence rule |
| `performance` | per dimension and period: the mean and the band counts |
| `qualitative` | curated category counts per cohort, and curated-finding counts per curated entity |
| `unresolved` | every open question. EMPTY for Cuicuilco: all three were settled on 2026-09-06 |
| `configurationRequired` | what is deliberately supplied by study configuration or editorial review |

### Three states, and they are not interchangeable

- **`available`** — the value was calculated, and the base it rests on is stated.
- **`unavailable`** — there was nothing to calculate, with a reason that
  distinguishes *nobody was eligible*, *nobody answered*, *no answer the formula
  could use*, *the selection matched nobody* and *an authority forbids this
  cross*. A base of zero is **never** a measured zero.
- **`unresolved`** — the authorities disagree, or the relationship the result
  would assert has not been stated by anyone. Neither a pass nor a failure: a
  question carried in the data instead of guessed. **Empty for Cuicuilco**,
  and empty is the healthy state.

Beside them, `configurationRequired` records what the contract deliberately
leaves to a study configuration or to editorial review. That is an ANSWER, not
an open question — it names who supplies the thing and in what artefact — and
conflating the two makes a working design read as a permanent defect.

### An empty base never publishes a zero

`unavailable` covers a metric. The counts and shares BESIDE a metric need the
same discipline, so they are nullable:

- `NpsScopeResult.distribution` and `.distributionShare` are all-null when there
  was no valid base. Three zero counts beside an `unavailable` headline would
  read as a chapter with no promoters and no detractors.
- `RenewalCategoryResult.count` / `.share` are null on an empty base. A rung
  nobody chose over a REAL base is a measured zero and is reported as `0` —
  that is why all five rungs are always published.
- `RenewalResult.distribution` is null when an authority refuses the cross, and
  the base is emptied with it. A refusal of the indicator is a refusal of its
  distribution; publishing five zeroes beside a non-empty base would state that
  nobody chose anything, which is false.
- `QualitativeTerm.share` is null on an empty base.

`share()` returns `number | null` for the same reason, and delegates the
arithmetic to the canonical `percentage`.

### Bases nest, and the accounting closes

For every result in the document: `valid <= responded <= eligible`; the six
partition fields sum to `responded`; and `outOfScale`, `phenomenon` and
`zeroValued` never exceed `answered`. The gate walks the finished document and
enforces all three on every base — nothing is exempt.

Retention is the one section whose base counts SOURCE CELLS rather than people:
its four counts come from the client's own records, so `eligible` is the four
cells the period offers and the roster figure lives on `starting`, where its
null survives. Mixing a roster head-count into a nested triple with a cell count
is how a chapter of three comes to report 133%.

### Every value already final

`ResultValue` carries `value`, `unit`, `decimals`, `formatted` and `band`. The
number arrives rounded by the canonical function that defines the metric, at the
precision its unit declares; `formatted` is `formatNumber` applied here, on the
server. Re-rounding an already-rounded value at the same precision cannot move
it, which is what makes "rounded exactly once" and "already formatted" both true.

### Provenance, and the line between internal and client-safe

`provenance.explanation` is the only field a client surface may render: prose
describing **what** was measured, never **how**. The gate enforces it character
by character — an explanation containing a digit or an operator fails.

The formula, the document section that authorises it and every caveat live on
`provenance.internal`, together with `authorities`: entries from the register in
`src/lib/results/authorities.ts`. A result citing an unregistered authority is a
red gate.

---

## 3. Authority order, and how the conflicts were resolved

1. the documented Be Community methodology, and explicit recorded decisions;
2. the complete source-workbook structure;
3. the approved dashboard, as the expected numerical and presentation output;
4. the legacy application, as compatibility evidence only.

**An expected result is never altered to make a test pass.** Where two
authorities genuinely conflicted, this layer recorded the conflict and stopped
only the affected metric rather than picking a winner. The methodology owner
then decided, on **2026-09-06**, and the decisions are recorded below and in
the authority register (`owner-decision-*` in `src/lib/results/authorities.ts`).
**Not one approved number moved:** golden parity was 531 / 531 before and after.

### RESOLVED — what "TDP" names

Two documents had given the same name to two different quantities:

| authority | denominator | bounded? |
|---|---|---|
| `Documentacion_Integral_Proceso_Be_Community` §4.1 | «respuestas con categoría de Satisfecho y Insatisfecho» — the VALID base, excluding the unaware answers that form the numerator | **no**, may exceed 100 |
| `docs/CALCULATION_CATALOG.md` §5, as it then read | «total de respuestas del punto» — every response, unaware included | yes, 0–100 |

**Decision: TDP is the §4.1 ratio**, which is also what the CEO-approved
dashboard computes. `docs/CALCULATION_CATALOG.md` §5 has been corrected, with
the previous definition and the reason for the change recorded there rather
than quietly overwritten.

| quantity | contract field | canonical function | denominator |
|---|---|---|---|
| **TDP** — the official metric | `touchpoint.tdp` | `processUnawarenessTdp` | valid base (satisfied + dissatisfied); may exceed 100, never clamped |
| auxiliary proportion | `touchpoint.unawareShareOfResponses` | `unawarenessShareOfResponses` | every classified response; bounded 0–100 |

The auxiliary survives because it is the complement of the "% who know this
process" bar in §7.1's stacked chart, and that pair only closes at a hundred
under its denominator. It is **never called TDP** — not in its key, not in its
label, not in its client-safe explanation, and the gate checks all three — it
never replaces TDP, and its denominator is stated on its own base.

### RESOLVED — Esfera × CRI

§5.2 says «OJO: La esfera no se debe cruzar en este KPI», and
`docs/CALCULATION_CATALOG.md` §9 repeats the exclusion. The approved dashboard
offers that cross anyway — `esfera` is one of its CRI cube dimensions.

**Decision: §5.2 is authoritative.** The emergency dashboard offering the cross
is a reference-dashboard deviation, not a methodological override. Esfera is
not permitted as a CRI filter or segmentation cross, anywhere.

The canonical layer refuses it and always did: the dimension declares the
section it may not cross, a caller that constrains it receives
`cross_not_permitted` citing the authority, and neither a distribution nor a
base computed over that cross is published — `distribution` is `null` and the
base is emptied.

### Reconciliation — «No aplica» as a category and as an absence

`docs/CALCULATION_CATALOG.md` §5 lists «No aplica» among the unawareness
variants, while `canonical-package/values.ts` maps that token to the absence
state `not_applicable` before any column is read. For Cuicuilco this costs
nothing in CSAT — the satisfaction block's only non-numeric option is
«No lo conozco/No lo he utilizado/No he interactuado», and «No aplica» does not
appear there at all — but it does hide the documented "not a reason" category in
the renewal-reason column. The category's count is recovered from the absence
state, which is exact rather than approximate: only that one token maps to it.
### Not conflicts, once the workbook is consulted

- **NPS scale.** §3.2 describes a 1–10 instrument; §4.1's recode says «0 a 6»
  for detractors. The workbook settles it: `Recomendación NPS` has ten options,
  1–10, so no answer can land in the 0 bucket and the two readings partition the
  same answers identically. `beCommunityNps` accepts 1–10.
- **Retention bands.** §7.4 says the colour range is not fixed and must be
  captured per client, so **no retention band is emitted**. The approved
  dashboard's BNI 75% target is client-authored context, not a calculation rule,
  and it is not in this contract.

---

## 4. Population is not a denominator

The chapter holds **60** people: **28** active and **32** former. None of those
three numbers is the denominator of every metric, and the contract keeps them
apart on purpose.

`ResultBase` carries three counts and a full accounting:

- **`eligible`** — people this instrument could in principle measure;
- **`responded`** — of those, the ones that produced a record;
- **`valid`** — of those records, the ones carrying an answer the formula uses.
  **This is the denominator.**

`accounting` partitions the records across `answered`, `missing`, `unknown`,
`notApplicable`, `sourceUnavailable` and `notParticipated`, and reports three
subsets of `answered` separately: `outOfScale`, `phenomenon` (an unawareness
reply is not a missing satisfaction rating) and `zeroValued` (a measured nought
is not nothing at all).

Measured on the real package: recommendation rests on **39** answers
(28 active + 11 former who took the exit survey), satisfaction and renewal on
**28** each, and retention on the membership roster at each period's start —
never on any of the three population figures.

`measured` (**54**) counts people who left at least one measured datum: an
answered session, a performance observation, or a value in a declared
measurement column. Roster attributes — sector, company type, membership
dates — do **not** count: they exist for everybody and prove no participation.
That definition is a product decision recorded by the approved dashboard; the
methodology does not state one.

---

## 5. No suppression, and why

The methodology defines no minimum sample, threshold, suppression or
anonymisation rule — §3.3 says the opposite: «No hubo necesidad de eliminar a
nadie del estudio.» The approved dashboard records the matching client decision:
sample size is **reported**, never used to withhold a result, down to a single
respondent.

**This layer applies no suppression at all.** Every result carries its exact
base and enough accounting for a later, configurable privacy rule to be applied
by a layer that owns that decision. `src/lib/calc/disclosure.ts` remains where
it is and continues to govern the legacy dashboard path, which is unchanged.

Privacy is enforced structurally instead, at the adapter boundary:

- **there is no person in the read model.** No name, no external identifier, no
  person row — the model addresses a participation by an opaque id and cannot
  name the human behind it. The contract has no field to put one in.
- **there is no free text.** An answer keeps its words only when its item is on
  the specification's closed-coded allowlist. An item nobody classified loses
  its words. Reject by default.
- **private attributes are dropped whole**, definition and values together.
- **curated findings travel without their prose** — counts and review status
  only, because the curated pain map is consultant text nobody has cleared for
  publication.

---

## 6. Rounding

Governed by `docs/CALCULATION_POLICY.md`. One helper, `roundTo`, half away from
zero. `RESULT_DECIMALS` maps every contract unit onto a declared `DECIMALS`
entry, so the table cannot drift from the precision the canonical functions
round at:

| unit | decimals | produced by |
|---|---|---|
| `nps` | 1 | `beCommunityNps` |
| `index` | 1 | `churnRiskIndex` |
| `percent` | 1 | `touchpointCsatOnScale`, `unawarenessShareOfResponses`, `retentionRate`, `churnRate` |
| `ratio` | 1 | `processUnawarenessTdp` |
| `score` | 2 | `mean` |
| `count` | 0 | counts |

A unit exists per declared precision, not per pretty name. Collapsing a
−100..100 recommendation score and a 1..5 rating average into one unit is how a
value gets rounded a second time, at a coarser precision, and moves.

The gate walks the finished document, and for **every** final value asserts that
re-rounding it at its own precision does not move it, and that `formatted` is
exactly what the canonical formatter produces.

---

## 7. Architecture

```
canonical projection (Unit 3)                    canonical tables (hosted)
        │                                                     │
        │                                        canonical-source/read.ts
        │                                        (paged, scoped, refuses)
        │                                                     │
        └──► results/adapters/commit-plan.ts ─┐   ┌── canonical-source/assemble.ts
                    REDACTION                 │   │        REDACTION
                                              ▼   ▼
                                       CanonicalResultSource
                                                  │
                                                  ▼
                                   pure calculators, reusing src/lib/calc
                            population · recommendation · journey · renewal
                              retention · performance · qualitative
                                                  │
                                                  ▼
                                    buildCanonicalStudyResults
                                                  │
                                                  ▼
                                     CanonicalStudyResults  ──►  a future route
```

**Both adapters land on the same seam, and that is now proved rather than
intended.** `npm run test:canonical-import-rehearsal` imports the real package
into a disposable PostgreSQL through the real commit RPC, reads it back through
the database adapter, and requires the two read models to be DEEP-EQUAL and the
two results documents to be BYTE-IDENTICAL. See §12.

| file | role |
|---|---|
| `contract.ts` | the versioned DTO. Types only. |
| `source.ts` | `CanonicalResultSource` — the neutral record set every adapter must produce |
| `spec.ts` | how a record set becomes results, as versioned CONFIGURATION |
| `authorities.ts` | the authority register every result cites by id |
| `measure.ts` | the envelope: base, accounting, provenance, band, value. Delegates every number |
| `filters.ts` | filter dimensions and evaluation, over people, before aggregation |
| `lookup.ts` | indices, built once, preserving source order |
| `population.ts` `recommendation.ts` `journey.ts` `renewal.ts` `retention.ts` `performance.ts` `qualitative.ts` | the calculators |
| `build.ts` | assembles the document and collects its configuration requirements |
| `adapters/commit-plan.ts` | the in-memory adapter, and the redaction boundary |

And, one folder away because the results layer must stay free of `server-only`
and of any transport:

| file | role |
|---|---|
| `canonical-source/rows.ts` | the canonical columns that are selected, and the four that never are |
| `canonical-source/read.ts` | the paged, scoped read workflow with its transport injected, and every refusal |
| `canonical-source/postgrest.ts` | the query shape and the composite keyset filter, described structurally |
| `canonical-source/assemble.ts` | the database-backed adapter, and the same redaction boundary |
| `canonical-source/normalize.ts` | the shared comparison order the two adapters are compared in |
| `canonical-source/adapter.ts` | **server-only.** The one module that holds a Supabase client |
| `canonical-source/server.ts` | **server-only.** The deliberate entry point |
| `canonical-source/index.ts` | the safe barrel, which does NOT re-export the adapter |

**Four boundaries, kept apart:** transport (absent here), canonical-record
adaptation (`adapters/`), calculation (the calculators), and presentation DTO
construction (`measure.ts` + `contract.ts`).

Nothing in the folder carries `import "server-only"`, on purpose: the layer is
pure, deterministic and evaluable on workerd, which is what lets an offline gate
run the real calculations over a real projection. The boundary that matters is
executed by the gate rather than asserted by a marker.

**A second study is a second `StudyResultsSpec`, not a second code path.**

---

## 8. Golden parity against the approved dashboard

### The fixture

`scripts/fixtures/cuicuilco-golden-parity.v1.json`, built by
`scripts/canonical-golden-fixture-build.mjs` from the approved dashboard at
`a7248fdbccd139da80ed7c09daa70f006a62b9cf` (the builder refuses any other
commit, and refuses a dirty tree). Each expectation records the value, its unit,
the cohort it describes, its exact denominator, and a JSON-pointer to the
evidence.

**Expected values come from the approved dashboard and from nowhere else.** The
builder never reads a line of the product's calculation layer, so re-running it
cannot launder a mismatch into a pass.

### The gate

`npm run test:canonical-results-parity <clean.xlsx> <curated.xlsx>` — read-only
and offline. It builds the canonical projection in memory from the two real
workbooks, adapts it, calculates the whole document and compares. It walks its
own module graph and fails if any of it reaches a transport; it imports only
readers from `node:fs`; and before printing anything it walks the finished plan
for the fields holding source values and fails if one could reach the output.

It is **deliberately outside `npm test`**: its inputs are machine-specific, and
an unexecuted gate must never be counted among the offline results. Run without
workbooks, it reports itself SKIPPED rather than passing.

### Result, executed 2026-09-06

```
ofrecidas=534  ejecutadas=531  aprobadas=531  falladas=0  omitidas=0
sin-resolver=0  no-aplica=2  requieren-configuración=1
Comprobaciones estructurales: 0 fallo(s).
```

Every category is reported separately and none is folded into another. The
**531 comparable approved results have not moved** across the owner's
decisions: what changed is the classification of the three that were never
comparable, from one open question each to two `not_applicable` and one
`configuration_required`.

Plan fingerprint
`sha256:a226b70c7ddc314424adadd5563a7da4a11bdc096b3bb64994dbc01df436e388`.

| section | offered | executed | passed | failed | not applicable | configuration required |
|---|---:|---:|---:|---:|---:|---:|
| journey | 452 | 450 | 450 | 0 | 2 | 0 |
| retention | 36 | 36 | 36 | 0 | 0 | 0 |
| recommendation | 15 | 15 | 15 | 0 | 0 | 0 |
| qualitative | 13 | 12 | 12 | 0 | 0 | 1 |
| population | 10 | 10 | 10 | 0 | 0 | 0 |
| renewal | 8 | 8 | 8 | 0 | 0 | 0 |

**Exactly what was matched.** Population: study total, measured, both cohort
sizes, former-measured, former-answered, former-without-data, and the three
instrument bases. Retention: all six periods × four source counts + retention +
attrition. Recommendation: all three scopes × score + promoters + passives +
detractors + valid base. Renewal: index, valid base, zone, and all five category
counts. Journey: touchpoint count, group count, four group sizes, four group
membership-and-order sequences expressed as source positions, and all 55
touchpoints × satisfied + dissatisfied + unaware + valid base + responses +
CSAT + TDP + band. Qualitative: both closed-coded cohort clouds ×
total + excluded count + every category count.

**No mismatch remains.** Two were found and both were defects in this layer, not
in the approved dashboard, and both were fixed: the excluded renewal-reason
category was not being recovered from its absence state, and the privacy scan
was treating filter-option vocabulary as respondent data.

### The three comparisons that are not parity targets

None of these is a failed calculation, and none is counted as a pass.

1. **`journey.stageEvidence` — `not_applicable`.** By contract rule a
   touchpoint directly owns its CSAT, its TDP and the auxiliary share, and no
   study-level metric is implicitly attached to a stage. The approved dashboard
   publishes no such link either, so there is nothing to compare. See §9.
2. **`qualitative.recorrido` — `configuration_required`.** The approved
   dashboard's 79-term curated phrase cloud is editorial content, not a
   server-calculated metric: reproducing it needs a phrase-splitting rule and a
   mapping from each measured touchpoint to the curated stage it draws phrases
   from, and the approved dashboard resolves the second with a hand-written
   alias table in its own build script — an implementation, not an authority.
   The contract emits curated **finding counts per curated entity** instead,
   which real foreign keys support. The curated phrases are not copied into the
   fixture, no phrase-splitting rule is invented, and no alias is copied into
   the calculation layer.
3. **`journey.unawareShareOfResponses` — `not_applicable`.** TDP itself IS
   compared, touchpoint by touchpoint, and matches. The auxiliary proportion is
   a separate quantity with its own denominator that the approved dashboard
   does not publish, so no approved value exists to compare it against.

A check that is skipped, not applicable, configuration-required or unresolved is
neither a pass nor a failure, and the summary reports all eight numbers
separately for exactly that reason.

### What an adversarial review changed, and what it did not

The layer was reviewed adversarially before it was committed: independent
reviewers over calculation correctness, privacy, gate rigour and documentation
accuracy, and a second pass that tried to refute each finding against the files.
Fourteen claims were verified; three were refuted and eleven confirmed. All
eleven are fixed:

| defect | fix |
|---|---|
| the journey exclusion decision was taken INSIDE the filtered scope, so a filter could let a broken column back in or brand a healthy one a spreadsheet error | the decision is taken once, over every session the instrument has; only the reported numbers are scoped |
| a refused Esfera × CRI cross published five zero counts beside a real base | the distribution is withheld whole and the base emptied |
| `touchpointCsat` hardcoded 1–5 / satisfied-from-4 while the journey read both from the spec | `touchpointCsatOnScale` takes the scale explicitly; the spec feeds it, and an impossible scale throws |
| an instrument's eligible base and cohorts were derived from filtered sessions, so a filter shrank both | derived from the unfiltered sessions, matching every sibling |
| performance `eligible` counted every cohort in the study | counts the cohorts the dimension actually measures |
| retention's base mixed a roster head-count with a cell count, so `eligible` could be smaller than `responded` | the base counts the four source cells; the roster figure stays on `starting` |
| shares and counts over an empty base were emitted as 0 | nullable, as above |
| a recovered "not a reason" category incremented `phenomenon`, which the contract declares a subset of `answered` | it no longer does; it is reported in `excluded` and partitioned by its own absence state |
| `base.valid` diverged from the share denominator when a category was excluded by text | `coded` counts only reported categories, so the two cannot diverge |
| `share()` re-implemented `percentage()` | delegates |
| an answered-but-uncarried value was filed under the absence state `answered` | filed under its own reason, `answered_not_carried` |

**Not one approved number moved.** Golden parity was 531 / 531 before the fixes
and 531 / 531 after them, which is what a defect in metadata and empty-base
handling should look like. The synthetic gate grew from 174 checks to 210,
including the three base invariants above, filter-invariance of the exclusion
decision, and the empty-base and refused-cross cases — none of which anything
had been checking.

### The authority-resolution amendment, 2026-09-06

The methodology owner resolved the two conflicts and the journey rule. The
amendment renamed the two unawareness functions and the two touchpoint fields,
corrected  §5 and §9, replaced the stage-evidence
gap report with a settled contract rule, and reclassified the three
non-comparable expectations. **No formula changed its arithmetic and no
expected value was edited:** golden parity stayed at 531 / 531 executed and
passed, and the synthetic gate grew from 210 checks to 233.

### The gates discriminate — proved, not asserted

Executed 2026-09-06, then restored byte-identically (verified by SHA-256):

| perturbation | result |
|---|---|
| CSAT satisfied threshold 4 → 3 in `business-metrics.ts` | parity **RED**: 88 failures, first `journey.0.0.csat` expected 29.6 got 74.1; synthetic gate **RED** |
| one expected value in the fixture, 46.4 → 46.5 | parity **RED**: 1 failure, `nps.activos.nps` expected 46.5 got 46.4 |

---

## 9. What a touchpoint owns, and what needs configuration

**This is a contract rule, decided by the methodology owner on 2026-09-06, and
not an uncertainty about Cuicuilco.**

A journey touchpoint DIRECTLY owns:

- its **CSAT** result and the valid base behind it;
- its **TDP** result and the same valid base;
- the **auxiliary unawareness share** and its wider base.

NPS, CRI, retention, attrition, LTV and every other study-level metric are
**not** implicitly attached to a touchpoint or a stage, and no generic
metric-to-stage association is ever inferred. The evidence agrees with the
rule:

- §7.2: «Las etapas son puntos de contacto o touchpoints.» The methodology
  collapses stage and touchpoint into ONE level, so there is no intermediate
  layer above a touchpoint for a metric to attach to.
- §7.2: «Cada cliente puede tener un recorrido diferente, los puntos de inicio y
  final son fijos en general.» The journey is client-specific by design.
- §4.1: only CSAT carries a positional qualifier — «CSAT de cada punto de
  contacto…». NPS, CRI, retention, attrition and LTV are defined with no
  positional qualifier at all.
- §7.3's report ORDER and §6.3's hedged display suggestion («valdría la pena»)
  are co-presentation, not stage membership.

`journeyStageEvidenceLinks` therefore stays in the contract and stays EMPTY
unless an explicit configuration supplies a link. `journey.stageEvidence`
reports `requires_explicit_configuration` with the rule id
`journey_stage_evidence_is_explicit_only`, an empty `links` array and a
statement of who would supply one. There is **no per-stage gap report**: the
eighteen "unknown candidate" entries the earlier contract emitted described a
working design as a permanent defect, and they are gone.

A future study that genuinely has such a relationship declares it in study or
template configuration, with provenance; the canonical projection carries it
through unchanged and the contract publishes it. Nothing infers one, and the
approved dashboard's hand-written alias table is not copied into production
code. The gate proves both halves: with no configuration `links` is empty, and
with one supplied the link appears exactly as declared.
### What IS proven about the journey

**Grouping and ordering are the workbook's, and they are exact.** The
satisfaction sheet carries exactly four merged ranges on its band row
(`D1:BI1`, `BJ1:BU1`, `BV1:CO1`, `CP1:DI1`), and those four bands are what put
55 touchpoints into 4 categories, 29 / 6 / 10 / 10. Column order on the header
row is the order inside a group. The methodology names the same four categories
for this client and instructs «En el dashboard separar cada categoría», but does
**not** say which touchpoint belongs to which — the workbook does.

The approved dashboard presents FIVE routes over those four categories, splitting
the first into "Operación" and "Interacción". That split is presentational and
hand-written in its build script; the canonical contract carries the four
categories the source states, and the parity gate compares group membership and
ordering as positions in the source's own column order.

### The `Capitanes` / `ref.` exclusion

The premise resolves to a specific artefact, and it is worth stating precisely:

- The **clean workbook** — the canonical source — contains exactly one cell
  matching `Capitanes`: `CSAT!AY2` = `Capitanes de Esfera`, item 24 of the first
  category, marked by header text only, with no fill and no comment. It is
  populated and CEO-approved (20 satisfied / 7 dissatisfied / 1 unaware). It is
  **not** excluded, and excluding it would delete a real approved result.
- The literal string `ref.` occurs **nowhere** in either workbook.
- The **revised journey CSV** (`… - Hoja 1.csv`) carries the touchpoint TWICE:
  column `AW` as `Capitán de Esfera`, populated, and column `AC` as
  `Capitanes de Esfera` whose 19 data cells are all the spreadsheet error token
  `#REF!`. That broken duplicate is the `ref.` marker. (Note `#REF!` ends in an
  exclamation mark, not a period — a literal `ref.` grep finds nothing.)

The exclusion is implemented as a **general, evidenced rule**: a touchpoint whose
records exist and are ALL `source_unavailable` — the state a spreadsheet error
classifies to — is excluded from journey calculations and journey outputs, and
REPORTED as excluded with its rule and, where one applies, the authority behind
it. A populated column with the same name is not excluded; a blank column is not
excluded either — it is reported as having no data. All three behaviours are
executed by the synthetic gate.

The CSV itself is never a numerical source: it is structural corroboration only.
Its provenance is asserted by its filename alone — the clean workbook has no
sheet named `Hoja 1` — which is a further reason not to compute from it.

---

## 10. What remains

**Not done, and not to be described otherwise:**

- ~~**No real workbook has been imported.**~~ **DONE in Phase 2, 2026-09-06.**
  The real Cuicuilco package is in the hosted canonical tables and the results
  calculated from those tables reproduce the approved dashboard 531/531. §12
  describes the adapter and the operator; `docs/CURRENT_STATE.md` records the
  import itself. The in-memory parity gate is unchanged: it still reads the
  workbooks into memory, calculates and exits, and writes nothing anywhere.
- ~~**No hosted service was contacted.**~~ Phase 2 contacted exactly one, named
  three times before it could write anything.
- **No existing read path changed.** The legacy dashboard still computes through
  `src/lib/dashboard/view.ts` and `src/lib/calc/*` exactly as before, including
  its own small-sample suppression.
- **No dashboard UI was built**, and none should be started from the approved
  dashboard's implementation.

**The next unit needs:**

1. **A database-backed adapter** producing the identical `CanonicalResultSource`
   from the canonical tables, plus the reconciliation proving the two adapters
   agree on the same package.
2. **A server route and a read-path switch**, with the authorization and
   publication-boundary work that implies. Nothing reads the canonical tables
   today.
3. **The real import**, which is a separate authorized act.
4. ~~Two human decisions~~ — **both taken on 2026-09-06.** TDP is the §4.1
   ratio and the catalogue is corrected; Esfera × CRI is forbidden and the
   canonical refusal stands. Nothing further is needed from a methodologist for
   either.
5. **A short touchpoint label.** The projection records the satisfaction sheet's
   short label column as the answer's derived label, not as the item's name, so
   `JourneyTouchpointResult.shortLabel` is null and `label` is the full question.
   A projection revision should record the label column's own header; deriving
   one by cutting the question text apart would be a transformation nobody
   documented.
6. **Editorial input for the curated journey cloud** — a phrase-segmentation
   rule and an approved touchpoint-to-curated-stage mapping — IF that cloud is
   ever to be reproduced. It is editorial content by decision, so this is a
   configuration item and not a blocker on the canonical import.

---

## 11. Commands

```
npm run test:canonical-results          # synthetic, adversarial, in `npm test`
npm run test:canonical-database-source  # the database adapter, offline, in `npm test`
npm run test:canonical-results-parity <clean.xlsx> <curated.xlsx>
                                        # real-workbook golden parity, offline,
                                        # deliberately outside `npm test`
npm run test:canonical-import-rehearsal # the whole chain against a disposable
                                        # PostgreSQL and a real PostgREST
npm run canonical-import                # the operator. Dry run unless --execute
npm run canonical-database-parity       # golden parity FROM the canonical tables
node scripts/canonical-golden-fixture-build.mjs <approved-dashboard-repo>
                                        # regenerate the fixture FROM THE
                                        # APPROVED DASHBOARD only
```

---

## 12. The database-backed adapter, and what it proves

Unit 5 Phase 1 built the read model and one adapter over the in-memory
projection. Phase 2 added the second adapter — the one that reads the canonical
TABLES — and then used the pair to answer a question neither could answer
alone: **did the import lose or invent anything?**

### 12.1 Where it lives, and why not in `src/lib/results/`

`src/lib/results/` must stay free of `server-only` and of every transport: that
is what lets an offline gate run the real calculators over a real projection,
and `npm run test:canonical-results` fails if a module there so much as names
`node:`. A database adapter needs a client. So it lives one folder away, in
`src/lib/canonical-source/`, and only two of its eight files know that a
database exists:

```
rows.ts        the columns selected, and the four never selected
read.ts        paging, ceilings, scope, and every refusal — transport INJECTED
postgrest.ts   the query shape and the keyset filter, client described structurally
assemble.ts    rows -> CanonicalResultSource, with the SAME redaction rules
normalize.ts   the shared comparison order
index.ts       the safe barrel — does NOT re-export the adapter
adapter.ts     server-only. The one module that holds a SupabaseClient
server.ts      server-only. The deliberate entry point
```

The split is what makes the interesting parts testable without a server:
`npm run test:canonical-database-source` (60 checks, in `npm test`) exercises
the paging, the refusals, the filter strings and the redaction against a fake
transport and hand-written rows.

### 12.2 Four columns that are never selected

`person_private`, `person_external_identifier` and `source_lineage` are not
read at all, and `pain_point.raw_text` / `normalized_text` are not in the row
type. A name, a membership id, a raw cell and a consultant's prose therefore
never enter the process — they are not filtered out later, which would mean
they had been read.

`merged` is the one review status the read model cannot represent, so a merged
pain point is a REFUSAL (`CURATED_FINDING_MERGED_UNSUPPORTED`) rather than a
finding silently counted as pending or silently dropped. Nothing this unit
imports can create one.

### 12.3 Completeness is proved, not assumed

PostgREST caps every response at `max_rows` and applies the cap silently — a
defect this repository has already paid for once (`src/lib/supabase/paginate.ts`).
So every read here is a keyset page over a unique key, every page is verified to
be strictly increasing before its last row becomes the next cursor, a short page
ends the read, and a set larger than its declared ceiling THROWS instead of
being truncated. Four of the tables have a two-column primary key and no `id`;
their window is the lexicographic `a > A OR (a = A AND b > B)`, and every cursor
value is re-checked against a strict uuid pattern immediately before it is
placed into the filter string, so a value can never become filter syntax.

Every read is scoped by BOTH `tenant_id` and `study_id`, applied before any
window. That matters more than usual here: the connection is service-role and
bypasses RLS, so the query IS the tenant boundary.

A study with anything but exactly one committed package is a refusal
(`NO_COMMITTED_PACKAGE` / `MULTIPLE_COMMITTED_PACKAGES`), because the union of
two imports is not an answer.

### 12.4 A third order, so the two adapters can be compared at all

The in-memory adapter's array order is the projector's — worksheet by
worksheet, column by column. The database adapter's is whatever a keyset over a
uuid returns. Both are legitimate "source order"; neither converts into the
other. `normalize.ts` defines a THIRD order — the natural business key of each
family, by codepoint — and both sides are put into it before comparison, so
"semantically identical" becomes deep equality instead of a judgement call.

That this is safe is not assumed either: the gate builds the whole results
document from the normalised source AND from the projector's own order and
requires the two documents to be byte-identical. A calculator that ever started
depending on array position would fail there.

### 12.5 The import operator

`scripts/canonical-import-operator.mjs` is the only way a real package is
written, and it does not reimplement the commit: `runCanonicalCommit` (Unit 3)
still preflights the exact bytes, projects, stages, commits, reconciles and
reverts on a count disagreement. What the operator adds is everything around it.

* **It defaults to refusing.** Without `--execute` it preflights, projects,
  compares the fingerprint and inspects the target, then stops.
* **The target is named three times**: a project ref, an acknowledgement that
  spells the same ref out inside a sentence about importing, and `--project` on
  the command line at the moment of the act.
* **The tenant and the study are full uuids.** A prefix is not an identity —
  this project has already had two studies whose rows were identical.
* **The plan fingerprint is named in advance** and one differing character is a
  refusal.
* `scripts/lib/canonical-import-target.mjs` REFUSES the disposable acceptance
  run's own `CANONICAL_HOSTED_DISPOSABLE_PREFIX`, because that variable means
  "everything this run makes may be deleted again", which is the opposite of
  what a real import means.
* **Reconciliation is measured independently** of the commit's own answer: each
  of the 30 study-scoped canonical tables is counted directly, and the ownership
  ledger is counted per table and per ownership, and both must agree with the
  plan's declared counts.
* **A disagreement is answered by `rollback_canonical_package`.** There is no
  manual-deletion path in the file; `.delete(` and `delete from` do not appear
  in it, and the offline gate asserts that.
* **The import-job id, the fingerprints and the counts are written outside every
  Git repository**, through a directory the guard proves is neither the worktree
  nor the main repository it is linked to, and the artifact is scanned for
  secrets before it is written.
* **Nothing private is printed.** Before it finishes it walks the finished plan
  for every field that holds a source value and fails if one of them appears in
  its own output.

There is no browser-reachable import path. The operator is a command-line tool;
no route imports it, and the offline gate proves that too.

### 12.6 What comparing the two adapters actually found

The comparison was not ceremonial. Putting the same package through both
adapters and demanding byte-identical documents surfaced two things, one a
defect and one a property of the contract.

**A real defect, fixed: `performance.bandCounts` was ordered by arrival.**
`buildPerformance` tallied each period's values into a `Map` keyed by semantic
colour and emitted `[...map.entries()]`, so the semaphore came out in the order
the FIRST value of each colour happened to be read. The counts were always
right; their order depended on which respondent's score the adapter returned
first. A document that is deterministic only for one arrival order is not
deterministic, and the two adapters' outputs could not be compared at all.
`bandCounts` is now emitted in the band scheme's own `displayOrder`, with a
colour no rule declares (`neutral`, the bucket an unbanded value falls into)
last and ordered by codepoint. **No count changed and no approved value moved:
golden parity was 531/531 before and after**, and `performance` is not a section
the fixture compares. Two checks in `npm run test:canonical-results` now pin it:
reversing every array of the source must move no number, and the semaphore must
come out in the scheme's order whatever order the observations arrive in.

**A property, not a defect: `population.instruments` follows its source's own
order.** `CanonicalResultSource` states that array order is the ADAPTER's
responsibility and that every array arrives in its source's own order. The
projector emits instruments in worksheet order (`csat`, `nps_activos`,
`nps_desertores`, `cri`); the database adapter emits them in the shared
comparison order (`cri`, `csat`, `nps_activos`, `nps_desertores`). The two
documents therefore list the same four instrument bases in two different orders
and are identical in every other respect. That is the contract working as
written, so the parity gate states it rather than hiding it: it compares the two
documents byte-for-byte in the SHARED order, and then compares the database
document against the PROJECTOR-order document with every array sorted by its own
serialisation, requiring that no value, count or base differs. The gate prints
the paths where the two orders diverge — `results.population.instruments`, and
nothing else.
