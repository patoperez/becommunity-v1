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

`src/lib/results/contract.ts`, `CANONICAL_RESULTS_CONTRACT_VERSION = "1.0.0"`.

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
| `journey` | groups, ordered touchpoints, CSAT, two unawareness quantities, exclusions, the curated stage model, and the stage-evidence gap report |
| `performance` | per dimension and period: the mean and the band counts |
| `qualitative` | curated category counts per cohort, and curated-finding counts per curated entity |
| `unresolved` | every open question, gathered in one place |

### Three states, and they are not interchangeable

- **`available`** — the value was calculated, and the base it rests on is stated.
- **`unavailable`** — there was nothing to calculate, with a reason that
  distinguishes *nobody was eligible*, *nobody answered*, *no answer the formula
  could use*, *the selection matched nobody* and *an authority forbids this
  cross*. A base of zero is **never** a measured zero.
- **`unresolved`** — the authorities disagree, or the relationship the result
  would assert has not been stated by anyone. Neither a pass nor a failure: a
  question carried in the data instead of guessed.

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

## 3. Authority order, and how conflicts are handled

1. the documented Be Community methodology, and explicit recorded decisions;
2. the complete source-workbook structure;
3. the approved dashboard, as the expected numerical and presentation output;
4. the legacy application, as compatibility evidence only.

**An expected result is never altered to make a test pass.** Where two
authorities genuinely conflict, the conflict is recorded and only the affected
metric stops.

### Conflict 1 — what "TDP" names (UNRESOLVED, both quantities emitted)

Two documents give the same name to two different quantities:

| authority | denominator | bounded? |
|---|---|---|
| `Documentacion_Integral_Proceso_Be_Community` §4.1 | «respuestas con categoría de Satisfecho y Insatisfecho» — the VALID base, excluding the unaware answers that form the numerator | **no**, may exceed 100 |
| `docs/CALCULATION_CATALOG.md` §5 | «total de respuestas del punto» — every response, unaware included | yes, 0–100 |

The process documentation contradicts itself as well: §7.1 specifies a stacked
"% que conoce / % que no conoce" chart, whose two bars only sum to 100 under the
catalogue's denominator. The approved dashboard implements the §4.1 ratio.

**Resolution: none, deliberately.** Both quantities are documented, both are
legitimate, and only the NAME is contested — so the contract emits both under
unambiguous names, each with its own base:

- `unawareShare` — the proportion of a touchpoint's responses that reported not
  knowing it. `processUnawarenessRate`, bounded 0–100.
- `unawarenessRatio` — the §4.1 ratio over the valid base.
  `processUnawarenessRatio`, may exceed 100 and is deliberately not clamped:
  clamping would erase exactly the cases the measure exists to surface.

`results.unresolved` carries `tdp_name_conflict` with both authorities and what
would settle it. **A human must decide which document is wrong**; this layer
will not decide it, and neither document was edited to hide the disagreement.

### Conflict 2 — Esfera × CRI (REFUSED, with provenance)

§5.2 says «OJO: La esfera no se debe cruzar en este KPI», and
`docs/CALCULATION_CATALOG.md` §9 repeats the exclusion. **The approved dashboard
offers that cross anyway** — `esfera` is one of its CRI cube dimensions.

The canonical layer refuses it: the dimension declares the section it may not
cross, and a caller that constrains it receives `cross_not_permitted` rather
than a number. This is a deviation of the approved dashboard from the
methodology, recorded here for a human to resolve.

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
| `percent` | 1 | `touchpointCsat`, `processUnawarenessRate`, `retentionRate`, `churnRate` |
| `ratio` | 1 | `processUnawarenessRatio` |
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
canonical projection (Unit 3)          canonical tables (later)
        │                                        │
        └──► adapters/commit-plan.ts ──►  CanonicalResultSource  ◄── (later adapter)
                    REDACTION                    │
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
| `build.ts` | assembles the document and collects the open questions |
| `adapters/commit-plan.ts` | the in-memory adapter, and the redaction boundary |

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
ofrecidas=534  ejecutadas=531  aprobadas=531  falladas=0  omitidas=0  sin-resolver=3
Comprobaciones estructurales: 0 fallo(s).
```

Plan fingerprint
`sha256:a226b70c7ddc314424adadd5563a7da4a11bdc096b3bb64994dbc01df436e388`.

| section | offered | executed | passed | failed | unresolved |
|---|---:|---:|---:|---:|---:|
| journey | 452 | 450 | 450 | 0 | 2 |
| retention | 36 | 36 | 36 | 0 | 0 |
| recommendation | 15 | 15 | 15 | 0 | 0 |
| qualitative | 13 | 12 | 12 | 0 | 1 |
| population | 10 | 10 | 10 | 0 | 0 |
| renewal | 8 | 8 | 8 | 0 | 0 |

**Exactly what was matched.** Population: study total, measured, both cohort
sizes, former-measured, former-answered, former-without-data, and the three
instrument bases. Retention: all six periods × four source counts + retention +
attrition. Recommendation: all three scopes × score + promoters + passives +
detractors + valid base. Renewal: index, valid base, zone, and all five category
counts. Journey: touchpoint count, group count, four group sizes, four group
membership-and-order sequences expressed as source positions, and all 55
touchpoints × satisfied + dissatisfied + unaware + valid base + responses +
CSAT + unawareness ratio + band. Qualitative: both closed-coded cohort clouds ×
total + excluded count + every category count.

**No mismatch remains.** Two were found and both were defects in this layer, not
in the approved dashboard, and both were fixed: the excluded renewal-reason
category was not being recovered from its absence state, and the privacy scan
was treating filter-option vocabulary as respondent data.

### The three unresolved comparisons

1. **`journey.stageEvidence`** — no authority states which metric belongs to
   which journey stage. See §9.
2. **`qualitative.recorrido`** — the approved dashboard's 79-term curated phrase
   cloud is not reproducible. It needs a rule for splitting a curated cell into
   phrases, and a mapping from each measured touchpoint to the curated stage it
   draws phrases from. No authority states either; the approved dashboard
   resolves the second with a hand-written alias table in its own build script,
   which is an implementation and not an authority. The contract emits curated
   **finding counts per curated entity** instead, which real foreign keys
   support. The curated phrases are not copied into the fixture.
3. **`journey.unawareShare`** — the approved dashboard publishes only the §4.1
   ratio, so there is no approved value against which to compare the catalogue's
   proportion. See the TDP conflict in §3.

A skipped or unresolved check is neither a pass nor a failure, and the summary
reports the five numbers separately for exactly that reason.

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

### The gates discriminate — proved, not asserted

Executed 2026-09-06, then restored byte-identically (verified by SHA-256):

| perturbation | result |
|---|---|
| CSAT satisfied threshold 4 → 3 in `business-metrics.ts` | parity **RED**: 88 failures, first `journey.0.0.csat` expected 29.6 got 74.1; synthetic gate **RED** |
| one expected value in the fixture, 46.4 → 46.5 | parity **RED**: 1 failure, `nps.activos.nps` expected 46.5 got 46.4 |

---

## 9. The journey relationship that is still unresolved

**`journeyStageEvidenceLinks` is empty and stays empty.** Re-investigated
against the full methodology document and the complete workbook context:

- §7.2: «Las etapas son puntos de contacto o touchpoints.» The methodology
  collapses stage and touchpoint into ONE level, so there is no intermediate
  layer above a touchpoint for any metric to attach to.
- §7.2: «Cada cliente puede tener un recorrido diferente, los puntos de inicio y
  final son fijos en general.» The journey is client-specific by design.
- §4.1: only CSAT carries a positional qualifier — «CSAT de cada punto de
  contacto…». NPS, TDP, CRI, retention, attrition and LTV are defined with no
  positional qualifier at all.
- §7.3's report ORDER and §6.3's hedged display suggestion («valdría la pena»)
  are co-presentation, not stage membership.

**The single defensible relation, with provenance: CSAT ↔ touchpoint**, and
touchpoints ARE the stages. Everything else is refused, and the refusal is
itself evidenced.

The contract emits `journey.stageEvidence` as `unresolved` with a **mapping-gap
report**: one entry per curated stage (18 for Cuicuilco), each stating that no
authority links a metric to it. `provenMetricKeys` is empty and stays empty — a
list of "likely" metrics would be a guess wearing a data structure, and a
consultant could not tell it apart from a relationship somebody actually made.

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

- **No real workbook has been imported.** All 36 canonical tables remain empty.
  The parity gate reads the workbooks into memory, calculates and exits; it
  writes nothing anywhere.
- **No hosted service was contacted** by any part of this unit.
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
4. **Two human decisions**, neither of which this layer may make:
   - which quantity the name "TDP" belongs to, and the correction of whichever
     document is wrong;
   - whether Esfera × CRI is genuinely forbidden, given that the approved
     dashboard offers it.
5. **A short touchpoint label.** The projection records the satisfaction sheet's
   short label column as the answer's derived label, not as the item's name, so
   `JourneyTouchpointResult.shortLabel` is null and `label` is the full question.
   A projection revision should record the label column's own header; deriving
   one by cutting the question text apart would be a transformation nobody
   documented.
6. **A phrase-segmentation rule and an approved touchpoint-to-curated-stage
   mapping**, if the curated phrase cloud is to be reproduced.

---

## 11. Commands

```
npm run test:canonical-results          # synthetic, adversarial, in `npm test`
npm run test:canonical-results-parity <clean.xlsx> <curated.xlsx>
                                        # real-workbook golden parity, offline,
                                        # deliberately outside `npm test`
node scripts/canonical-golden-fixture-build.mjs <approved-dashboard-repo>
                                        # regenerate the fixture FROM THE
                                        # APPROVED DASHBOARD only
```
