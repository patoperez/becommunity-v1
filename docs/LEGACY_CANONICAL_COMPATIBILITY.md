# Legacy versus canonical — the compatibility evidence

> Unit 5 Phase 3. What the application's existing read path publishes, what the
> canonical results contract publishes, where the two agree, and what a read-path
> switch would still need. **Nothing in this document changes what the client
> sees**: the shadow comparison is disabled by default, and the one page wired to
> it renders exactly the payload it rendered before.

Read `docs/CANONICAL_RESULTS_MODEL.md` first — §12 describes the canonical read
adapter this compares against — and `docs/CURRENT_STATE.md` §"Unit 5 Phase 2"
for the import the canonical numbers come from.

---

## 1. Three totals, and they are not interchangeable

Conflating these has already produced a wrong claim in this repository once, so
they are stated separately and never added together.

| what | total | where it is measured |
|---|---|---|
| **Golden parity** — the canonical document against the CEO-approved dashboard | **531 executed, 531 passed, 0 failed, 0 skipped, 0 unresolved, 2 not-applicable, 1 configuration-required** | `npm run canonical-database-parity`, read-only, against the hosted import |
| **Legacy ↔ canonical comparable fields** — what BOTH layers publish and an authority relates without an alias table | **6 comparable, 6 agree, 0 disagree** | `npm run canonical-shadow-report`, read-only |
| **Classified, deliberately not compared** | **18** findings across six classifications | the same run |
| **Legacy ↔ canonical under an ACTIVE FILTER** | **1 comparable, 1 agree, 0 disagree, 23 classified** — of which **12** are refused by scope | `npm run canonical-shadow-runtime-rehearsal`, read-only. See §4.3 |

**The 531 are not runtime comparisons against the legacy UI.** They compare the
canonical document with values recorded from the approved dashboard. The legacy
UI exposes a small fraction of that surface, and the honest number for
"legacy agrees with canonical" is **6 of 6**, not 531.

---

## 2. The active legacy loaders and their consumers

| loader | what it returns | consumers |
|---|---|---|
| `src/lib/studies/authorized.ts` → `loadAuthorizedStudyData` | the authorization boundary: RLS check with the request client, then rows, confirmed qualitative, interpretation, brand, presentation and period series through the admin client | `app/dashboard/page.tsx`, `app/insights/e/[studyId]/page.tsx`, `app/dashboard/data-actions.ts`, `app/api/studies/[studyId]/report/route.ts`, `components/studio/ClientPreviewView.tsx` |
| `src/lib/dashboard/view.ts` → `buildStudyDashboard` | `StudyDashboardPayload` — the aggregate DTO the browser receives | the four call sites above, minus the report route |
| `src/lib/calc/load.ts` → `loadStudyRows` | engine-ready long rows, paged | `loadAuthorizedStudyData` only |
| `src/lib/reporting/pdf.ts` → `buildStudyPdf` | the PDF bytes | the report route |

**Authorization, unchanged.** `loadAuthorizedStudyData` authorizes with the
request-scoped client first (RLS decides whether this user may see this study)
and only then loads through the admin client. Phase 3 did not touch it.

**Filter parsing, unchanged.** `parseInsightsFilters` → `validateSegmentFilters`
→ an empty selection when either refuses. The shadow receives the SAME
already-validated selection the legacy builder received.

**Cache behaviour, unchanged.** No route gained or lost a cache directive; the
report route keeps `dynamic = "force-dynamic"` and nothing else declares one.

**Publication boundary, unchanged.** The client route still renders only what
`buildStudyDashboard` sanitises, and `sampleVisibility` still suppresses a small
sample exactly as before.

**No client component calculates a business metric**, before or after. The gate
in `npm run test:canonical-results` already fails if one imports a metric
definition or re-implements a formula, and it still passes.

---

## 3. The safe insertion point

`src/lib/studies/study-dashboard.ts` — a new **server-only** loader that calls
`buildStudyDashboard` with the same five arguments the page used to pass, then
runs the shadow comparison, and returns `{ legacy, shadow }`.

Exactly one page uses it: `src/app/insights/e/[studyId]/page.tsx`, which binds
`const { legacy: dashboard } = await loadStudyDashboard(...)` and never names
the other field.

```
app/insights/e/[studyId]/page.tsx      the ONE approved consumer
  └─ lib/studies/study-dashboard.ts    server-only. Builds the legacy payload, then:
       └─ lib/shadow/server.ts         server-only. The ONLY module naming the canonical read
            └─ lib/canonical-source/server.ts → adapter.ts → results/build.ts
```

Why here and not in `loadAuthorizedStudyData`: that loader returns ROWS, not the
legacy result, and it is shared by the PDF route, the pivot action and the
internal preview. Wrapping it would have put the canonical layer in the import
graph of four surfaces that have no need of it.

---

## 4. The compatibility matrix

Measured against the hosted Cuicuilco study (`cd4d6acd…`, tenant `e63b2092…`),
unfiltered, on 2026-09-06.

### 4.1 Compared, and in agreement — 6 of 6

| key | classification | legacy | canonical | rule |
|---|---|---|---|---|
| `recommendation.nps.combinado.value` | `equivalent_after_named_transformation` | 30.8 | 30.8 | `decimals:1` |
| `recommendation.nps.combinado.base` | `exact_equivalent` | 39 | 39 | exact |
| `renewal.cri.value` | `equivalent_after_named_transformation` | 33.04 | 33 | `decimals:1` |
| `renewal.cri.base` | `exact_equivalent` | 28 | 28 | exact |
| `population.measured` | `equivalent_after_named_transformation` | 54 | 54 | exact |
| `population.selected` (unfiltered) | `equivalent_after_named_transformation` | 54 | 54 | exact |

The two named transformations, stated rather than assumed:

- **NPS scale.** The legacy engine accepts 0–10; the confirmed Be Community
  scale is 1–10. No Cuicuilco answer is 0, so the two bases coincide at 39 — but
  a study that recorded a 0 would diverge, and the comparator says so in the
  finding's note rather than in a comment nobody reads.
- **CRI precision.** The legacy layer publishes the mean of the risk weights as
  a *score* at 2 dp (33.04); the canonical contract publishes it as an *index* at
  1 dp (33). Comparing at the coarser of the two declared precisions asks "is
  this the same number", not "did two contracts pick the same decimal count".
- **Measured population.** Legacy counts a person with a quantitative answer or
  a confirmed qualitative observation; canonical counts a person with an answered
  session, an answered performance observation or an answered declared
  measurement attribute. Both are 54.

### 4.2 Classified, deliberately not compared — 18

| classification | count | keys |
|---|---|---|
| `canonical_only` | 9 | `population.total`, `recommendation.nps.activos.value`, `recommendation.nps.desertores.value`, `renewal.forbidden_cross`, `journey.touchpoints`, `journey.groups`, `retention.periods`, `performance.dimensions`, `qualitative.curatedFindingCounts` |
| `legacy_only` | 4 | `legacy.pivot.allowlist`, `legacy.filterOptions`, `legacy.crosses`, `legacy.metric_keys.other` |
| `presentation_configuration_required` | 3 | `legacy.metric_keys.csat`, `legacy.metric_keys.tdp`, `legacy.metric_keys.desempeno` |
| `equivalent_after_named_transformation` | 4 | the four compared above |
| `exact_equivalent` | 2 | the two compared above |
| `canonical_replacement` | 1 | `disclosure.small_sample_suppression` |
| `editorial_configuration_required` | 1 | `qualitative.curated_journey_cloud` |
| `not_comparable` | 0 | — |

**Totals: 24 findings, 6 compared, 18 classified.**

### 4.3 Under an active filter — 1 comparable, 12 refused by scope

**Phase 3.1 correction.** The canonical document is read by tenant and study and
by nothing else; the request's legacy filter is not applied to it and cannot be
(§7, §9.2). Phase 3 guarded `population.selected` for exactly that reason and
then compared the *filtered* legacy NPS and CRI against that *unfiltered*
document anyway. That is not a weaker comparison — it is a wrong one, in both
directions at once, and the offline gate now carries a fixture that produces
both from one run: filtering the fixture leaves the NPS at 40 and the CRI at
37.5 (a false AGREEMENT with the canonical values) while dropping both bases
from 20 to 10 (a false DISAGREEMENT on the bases).

Under an active filter every quantity the filter touches carries mismatch
`filter_scope`, `agrees` null, and **no numbers at all**. Twelve keys are
affected, and they are affected in two different ways — the distinction matters,
because collapsing it would erase a true statement:

**Five REFUSED COMPARISONS.** These would otherwise have produced a verdict, so
their classification is rewritten to `presentation_configuration_required` —
the configuration that would make them comparable is the filter-dimension map
of §9.2:

| key | why the filter touches it |
|---|---|
| `recommendation.nps.combinado.value` / `.base` | `view.tiles` ← `computeStudyMetrics(filteredRows)` (`view.ts:190`) |
| `renewal.cri.value` / `.base` | `view.averages` ← the same filtered rows (`view.ts:215`) |
| `population.selected` | `selectedCount` ← `distinctUnits(filteredRows, …)` (`view.ts:187`) |

**Seven WITHHELD NUMBERS.** These are never compared in any context, so their
classification is a filter-independent fact about the two layers and is KEPT;
only the number goes, under `noteCode: legacy_value_withheld_under_filter`.
Three of them already carry `presentation_configuration_required` for their own
reason, and four do not:

| key | classification (unchanged) | why the filter touches it |
|---|---|---|
| `legacy.metric_keys.{csat,tdp,desempeno}` | `presentation_configuration_required` | counted over `view.averages` |
| `legacy.metric_keys.other` | `legacy_only` | the same count |
| `legacy.crosses` | `legacy_only` | `view.crosses` ← the filtered rows (`view.ts:223`) |
| `disclosure.small_sample_suppression` | `canonical_replacement` | `selectionVisibility` ← `sampleVisibility(selectedCount)` |
| `qualitative.curated_journey_cloud` | `editorial_configuration_required` | `view.qualitative` ← `filteredQualitative` |

So **eight of the twelve** report `presentation_configuration_required`, and the
other four keep a classification that was never about the filter. What is
uniform across all twelve — and is what the audit asked for — is that none of
them reports agreement or disagreement, and none of them carries a number drawn
from filtered data.

**One comparison survives, and only because it is provably unfiltered.**
`population.measured` reads `view.sourceUnits`, which `view.ts:186` computes
from `rows` and `qualitative` — not their filtered forms — and `view.ts:268`
suppresses on that same unfiltered count. `legacy.pivot.allowlist` and
`legacy.filterOptions` are unfiltered for the same kind of reason
(`view.ts:182-183`) and keep their counts. All three are pinned by a gate that
asserts they are identical between a filtered and an unfiltered build of the
same fixtures, so the day one of them starts depending on the filter the gate
fails instead of this paragraph quietly becoming false.

Measured on the hosted study, one dimension applied, 2026-09-06:
**1 comparable, 1 agree, 0 disagree, 23 classified, 12 refused by scope.**

---

## 5. What the canonical layer answers that the legacy layer cannot

These are **capabilities, not defects on either side**. A missing legacy field is
not a canonical bug and a canonical field with no legacy counterpart is not a
mismatch.

- **The study population (60).** The legacy dashboard has no roster: it counts
  whoever left an answer. Six of the sixty Cuicuilco people have neither a
  quantitative answer nor a confirmed qualitative observation and are therefore
  **invisible to the legacy dashboard entirely** — verified against the database:
  60 respondent rows, 54 with a quantitative answer, 23 with a confirmed
  qualitative observation, **6 with neither**. The canonical contract reports
  `total 60` beside `measured 54` for exactly this reason.
- **NPS by cohort.** `activos` 46.4 over 28 and `desertores` −9.1 over 11,
  against one study-wide 30.8 over 39 in the legacy payload. The legacy engine
  computes a single NPS over every row carrying the key and has no cohort split.
- **The refused cross.** `perfil_cliente_h × renewal` is refused with
  `cross_not_permitted`, the distribution withdrawn whole and the base emptied.
  The legacy layer cannot express a forbidden cross at all.
- **55 touchpoints in 4 source groups**, each with its own CSAT, its own TDP over
  the valid base and the auxiliary unawareness share under its own name.
- **6 retention periods** with the count identity checked, and **8 performance
  dimensions** with a per-month denominator.
- **50 curated findings** counted per curated entity.

---

## 6. What the legacy layer has and the canonical contract does not

- **The pivot explorer** (136 allowlisted dimensions and metrics). A legacy-only
  capability; the canonical contract publishes finished aggregates, not a cube.
- **13 legacy filter dimensions** over legacy segment keys (`esfera`,
  `generacion`, `giro`, `estado_membresia`, …). The canonical filter dimensions
  are attribute keys (`perfil_cliente_*`, `perfil_desertores_*`). Different key
  spaces; see §7.
- **123 cross-average series** by legacy segment.
- **`ltv_cliente`** — a legacy metric key with no canonical counterpart stated by
  any authority.
- **Small-sample suppression.** `sampleVisibility` withholds a value below the
  threshold. The canonical layer never suppresses; it reports the base. This is
  the one place the two layers deliberately publish different things, so it is
  classified `canonical_replacement` rather than a mismatch.

---

## 7. Presentation configuration still needed

**One thing blocks 120 further comparisons, and it is a map, not a formula.**

The legacy metric-key space and the canonical item-key space are both derived
from the same workbook and neither can be computed from the other:

| legacy | canonical | count |
|---|---|---|
| `csat_interacciones_y_operacion_al_interior_del_capitulo_ap`, … | `csat_ax`, … (`<instrument>_<column letter>`) | 55 |
| `tdp_…` (one per touchpoint) | `journey.touchpoints[].unawareShareOfResponses` | 55 |
| `desempeno_octubre` … `desempeno_general` | `performance.dimensions[].periods[]` | 10 |

The correspondence **exists and is authoritative** — a human approved it at
import time, and `import_mapping.configuration` (the legacy source header → metric
key map) joined to `source_lineage.source_column` (the canonical item ← workbook
column, e.g. `AX`) could reconstruct it. It is not reconstructed here, because a
comparator that invented an alias table would be doing exactly what
`docs/CANONICAL_RESULTS_MODEL.md` forbids copying into production code. **A
study-level, human-approved `legacyMetricKey ↔ canonicalItemKey` map is the
configuration a read-path switch needs**, and it is the single largest item on
that list.

Two facts that map must respect, and that this phase establishes:

1. ⚠️ **The legacy `tdp_` prefix is a misnomer.** Those columns hold a per-person
   0/100 flag, and the legacy engine's average of them is the unawareness share
   over ALL responses — i.e. the canonical
   `touchpoints[].unawareShareOfResponses`, **not** `touchpoints[].tdp`, which is
   the §4.1 ratio over the VALID base. A map that pointed `tdp_*` at the canonical
   `tdp` would silently compare two different quantities. Recorded in the
   comparator's own note so the map cannot be written without reading it.
2. ⚠️ **The legacy CSAT tiles do not exist for this study.** `computeStudyMetrics`
   detects CSAT with `metric_key === "csat" || metric_key.startsWith("sat")`, and
   every Cuicuilco key is prefixed `csat_`, which starts with `c`. All 55
   satisfaction columns are therefore published as plain **averages of a 1–5
   score**, and the dashboard shows **no CSAT tile at all**. The canonical layer
   publishes a top-box share per touchpoint. The two are not the same quantity,
   which is why the 55 are `presentation_configuration_required` rather than a
   mismatch.
3. ⚠️ **The legacy journey stage's CSAT detail is computed on the wrong scale.**
   `computeStageMetric` DOES recognise a `csat`-prefixed key, but with
   `csatMin = DEFAULT_CSAT_MIN = 9`, which is the Top-2-Box threshold for a 0–10
   scale. Applied to 1–5 answers it can never be reached, so every stage whose
   metric is a `csat_*` key reports "Satisfechos 0/n" on hover. This is a **legacy
   defect, visible to a client today**. It is recorded here and NOT fixed: Phase 3
   is forbidden from changing a calculation, and the canonical layer already
   computes the confirmed 1–5 scale correctly.

**The four/five distinction is presentation, not data.** The workbook carries 55
touchpoints in **4 source groups** and the canonical document reports exactly
that. The approved dashboard's split into 5 visible routes is a presentation
choice on top of those 4 groups. The comparator does not treat it as a fifth
group, a missing group or a calculation failure, and neither should anything
downstream.

---

## 8. Editorial configuration still needed

- **The curated journey pain cloud.** The legacy payload publishes 3 confirmed
  qualitative themes (from 23 confirmed survey observations); the canonical
  contract reports the curated pain map as 50 findings, all `pending`, and
  declares the cloud itself `configuration_required`. These are different
  populations answering different questions — reviewed survey answers versus the
  consultant's pain map — so the finding is `editorial_configuration_required`
  and carries counts, never prose. The comparator does **not** fabricate a cloud.

---

## 9. Blockers for an eventual read-path switch

In the order they would have to be resolved. None is a canonical defect.

1. **The `legacyMetricKey ↔ canonicalItemKey` map** (§7). Without it, 120 of the
   legacy payload's 122 averages have no canonical counterpart a machine can
   find, and no dashboard section that renders them can be moved.
2. **A filter-dimension map.** 13 legacy segment keys against the canonical
   attribute keys. Until it exists, every filtered comparison is
   `filter_scope`-classified and only the unfiltered context is comparable.
3. **The pivot explorer has no canonical equivalent** and would either stay on
   the legacy path or be dropped from the switched surface. That is a product
   decision, not an engineering one.
4. **Small-sample suppression is a policy difference, not a bug.** The legacy
   client surface withholds; the canonical contract reports the base. Switching a
   read path switches that behaviour, and the client decision on record is that
   sample size is reported and never used to withhold — so this is a deliberate
   change that needs saying out loud, not a silent consequence.
5. **`ltv_cliente` has no canonical home.** Either the canonical spec gains it or
   the surface loses it.
6. **The three legacy defects in §7** would disappear with the switch. Two of
   them (no CSAT tiles; the 0–10 threshold on 1–5 data) change numbers a client
   sees today, so a switch is a visible correction and must be presented as one.

---

## 10. How the shadow behaves, and what it cannot do

| property | how it is proved |
|---|---|
| Disabled by default | `BECOMMUNITY_SHADOW_MODE` must equal the literal `enabled`. `"true"`, `"1"`, `"yes"`, `"ENABLED"` and a typo all mean off, and the gate executes each. |
| Exact scope allowlist | `BECOMMUNITY_SHADOW_SCOPES` holds `tenantUuid:studyUuid` pairs. A prefix is refused; a malformed entry is dropped, never repaired. |
| The adapter is never called otherwise | the gate counts invocations of a fake reader: 0 with the flag off, 0 outside the allowlist, exactly 1 when both open. |
| Bounded, and CANCELLED | a wall-clock race, default 1500 ms, ceiling 5000 ms — and the budget owns an `AbortController` whose signal reaches every paginated query's `PostgrestTransformBuilder.abortSignal`, with `abort()` called with NO argument so PostgREST recognises the cancellation instead of retrying the GET. Phase 3 bounded the caller and nothing else: the losing read stayed in flight. The gate proves the reader observes the abort, that no further page begins, that no late rejection escapes and that nothing is still reading afterwards. |
| Classified by the clock, not by the race | the timer sets `expired` *before* it aborts and rejects, and the verdict reads that flag. `abort()` dispatches synchronously, so a reader that rejects from inside its own abort listener would otherwise win `Promise.race` and turn a budget expiry into `canonical_transport_error`. A real `fetch` rejects asynchronously, which is precisely why this would have hidden until somebody needed the number. |
| Nothing filtered is compared | §4.3. Under an active filter all twelve affected keys carry mismatch `filter_scope`, no verdict and no number; the five that would otherwise have produced a verdict are additionally reclassified `presentation_configuration_required`. |
| The filter is described, never fingerprinted | Phase 3 recorded an unsalted SHA-256 of the applied `[key, value]` pairs. The values come from a catalogue the same payload publishes to the browser, so the whole space of realistic selections is a few thousand strings and a dictionary reverses the digest at once. `ShadowFilterScope` records `filtered`, a dimension COUNT and those dimension KEYS whose shape is conservative enough to publish. No value, hashed or otherwise. |
| Every text field is a closed set | `noteCode` replaced `note: string`, and `rule` is a union. A finding's `key` and `section` are members of closed lists too, so a study's own metric key cannot become a finding key. |
| Every failure is a safe code | timeout, transport error, malformed document, a document that throws when read, and a comparator that throws — five paths, five statuses, and a PostgreSQL message never reaches any of them. |
| The legacy payload is unchanged | asserted byte-for-byte after every one of those paths. |
| Diagnostics never reach a browser | no page, component or route names them; the approved page binds `legacy` only; and the finding contract has no field that could hold a person. |
| No client component can reach the canonical layer | a transitive import-graph walk from every `"use client"` file, and from every route, finds no path. |
| Exactly one page can | the same walk finds one, and its chain passes through the approved loader and the server-only orchestrator. |
| Nothing on the path can write | every module reachable from `shadow/server.ts` that could hold a database client uses only read builder methods; the write path (`canonical-commit/{adapter,server,flow,projector}.ts`) is unreachable. |

| Runtime evidence exists, and is inert | a server-only sink, `src/lib/shadow/sink.ts`. No sink is installed unless code running in the same process installs one — there is no environment variable, so no deployment can turn it on. It returns `void`, swallows its own failures, and receives a record carrying codes and totals and **no numbers at all**: `legacyValue`, `canonicalValue`, `legacyBase` and `canonicalBase` have no field to arrive in, filtered or not. It adds no route; the way in is a function call. |

`npm run test:shadow-boundary` — **96 checks**, in `npm test`.
`npm run test:shadow-sink` — **17 checks**, in `npm test`.
`npm run test:canonical-database-source` — **74 checks**, in `npm test`.

**Shadow mode has never been enabled on a hosted environment.** No environment
variable was set anywhere, no deployment was made, and the internal operator
(`npm run canonical-shadow-report`) enables it in its own process only, for one
scope, and dies with it.

---

## 11. Commands

```
npm run test:shadow-boundary               # 96 offline checks, in `npm test`
npm run test:shadow-sink                   # 17 offline checks, in `npm test`
npm run test:canonical-database-source     # 74 offline checks, in `npm test`
npm run canonical-shadow-report            # the COMPATIBILITY operator: legacy vs
                                           #   canonical, read-only, safe diagnostics
npm run canonical-shadow-runtime-rehearsal # the RUNTIME operator: the real entry
                                           #   point, the real client, the real paged
                                           #   read, timed. Read-only.
npm run canonical-database-parity          # golden parity FROM the canonical tables
```

⚠️ **The two operators measure different things and neither replaces the other.**
`canonical-shadow-report` hands the orchestrator a document it has already read,
so its elapsed time is the comparator's and says nothing about a request.
`canonical-shadow-runtime-rehearsal` calls `runStudyShadowComparison` — the same
function `studies/study-dashboard.ts` calls — and lets it construct its own admin
client and do its own paged reads.

---

## 12. The runtime path, measured (Unit 5 Phase 3.1)

Read-only, against the hosted Cuicuilco package, 2026-09-06, from the
development workstation. **These are not Worker-to-Supabase latencies** and must
never be quoted as if they were; they bound the path and prove it completes.

### 12.1 Why the read took 4.86 seconds, and what fixed it

`loadCanonicalRowSet` read twenty-six independent families one after another.
The Cuicuilco package is 3 244 rows in 28 HTTP round trips, so the wall time was
LATENCY, not volume. The families are independent — only the committed-package
gate must come first, because its manifest names the spec — so they now go
through a bounded pool.

Measured in one session, same transport, same machine, four runs each:

| shape | min | median | max |
|---|---|---|---|
| sequential (the Phase 3 shape) | 4 177 ms | **4 774 ms** | 5 128 ms |
| bounded concurrency 6 | 1 181 ms | **1 263 ms** | 1 384 ms |

**3.78× on the median**, and the 4 774 ms reproduces the 4 858 ms on record.

**The limit is six because Cloudflare Workers allow six simultaneous open
outbound connections per invocation.** A seventh queues rather than fails, so a
larger number would describe an intent the platform does not honour.

Nothing was traded for it. Every request still carries tenant AND study; every
family keeps its own ceiling; paging *within* a family is still strictly
sequential, because the keyset cursor is the previous page's last row; results
are placed by index, so the row set is identical to the sequential one; one
failure fails the whole load, no new work starts after it, and the refusal
reported is the lowest-indexed one so it does not depend on who lost a race.

**Single-flight de-duplication was considered and NOT implemented.** It is
optional in the brief, and a module-level cache keyed by tenant and study on a
service-role read path is a tenant-isolation hazard for a saving the pool
already delivers. Recorded here so the omission is a decision, not an oversight.

### 12.2 The whole runtime path, end to end

`policy → runStudyShadowComparison → createAdminClient → loadCanonicalStudyResults
→ paged reads → results builder → comparator`, nothing preloaded, twenty samples:

THREE runs of twenty are reported, not one, because the tail moves and one run
would have flattered it:

| | run A | run B | run C |
|---|---|---|---|
| cold (first) | 1 233 | 1 452 | 1 902 |
| minimum | 976 | 1 058 | 1 021 |
| median | **1 047** | **1 105** | **1 093** |
| p95 (rank 19 of 20) | 1 129 | 1 177 | 1 288 |
| maximum | 1 233 | 1 452 | **1 902** |

The median is stable at about 1.05–1.11 s. **The maximum is not**, and in run C
it reached 1 902 ms — which is past the 1 500 ms default budget outright. That
run's cold request would have returned `canonical_timeout` rather than a
comparison.

Every sample returned `compared`, **6 comparable / 6 agree / 0 disagree / 18
classified**, and the legacy payload was asserted byte-identical after each one.

### 12.3 What this says about a budget

| budget | margin over the worst maximum (1 902 ms) | verdict |
|---|---|---|
| 1 500 ms (the default) | **0.79× — the budget is SMALLER than the observed maximum** | **unusable.** Run C's cold request would have timed out. |
| 5 000 ms (the ceiling) | 2.63× | adequate *from this vantage point only*. |

⚠️ **Preview activation remains BLOCKED, and the timing is not the only reason.**
The margin that matters is the Worker's, and no Worker measurement exists; the
default budget does not fit; and §9's blockers are untouched. See
`docs/CURRENT_STATE.md` §"Unit 5 Phase 3.1" for the complete list.

### 12.4 The budget, against the real reader — and what measuring it found

With the budget forced to 1 ms the hosted run returns `canonical_timeout` in
**27 ms**, and the rehearsal then COUNTS the process's outbound requests for two
further seconds: **1 request at return, 1 after the wait, 0 orphaned
rejections**. The abort reaches the socket, not just the caller.

⚠️ **That count is not decoration — it caught a real defect.** The first version
of this rehearsal asserted nothing and simply printed "no late read resolved"
after a sleep. When the assertion was added, it failed on the hosted path:
**three further requests were issued after the budget expired.**

The cause is worth recording, because it makes cancellation *worse* than the
race it replaced. `@supabase/postgrest-js` decides whether a rejected `fetch`
was a cancellation by reading the rejection's identity:

```
if (fetchError?.name === "AbortError" || fetchError?.code === "ABORT_ERR") throw fetchError;
if (!RETRYABLE_METHODS.includes(this.method)) throw fetchError;
if (this.retryEnabled && attemptCount < DEFAULT_MAX_RETRIES) { …retry… }
```

`controller.abort(reason)` replaces the platform's own `AbortError` with
`reason`. A custom reason therefore matches neither test, the aborted GET is
classified as a network failure, and it is retried three times with 1 s / 2 s
backoff — so the budget was issuing three MORE requests after the caller had
given up. The fix is to call `controller.abort()` with **no argument** at every
site: nothing in this codebase reads `signal.reason`, the budget's verdict comes
from its own `expired` flag, and the platform's default reason is the only one
PostgREST honours. `scripts/shadow-boundary-test.mjs` now asserts
`signal.reason.name === "AbortError"` so the lesson cannot be undone quietly.
