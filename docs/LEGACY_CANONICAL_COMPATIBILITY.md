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
| Bounded | a wall-clock race, default 1500 ms, ceiling 5000 ms. A hung read is `canonical_timeout` in well under the budget's own order of magnitude. |
| Every failure is a safe code | timeout, transport error, malformed document, a document that throws when read, and a comparator that throws — five paths, five statuses, and a PostgreSQL message never reaches any of them. |
| The legacy payload is unchanged | asserted byte-for-byte after every one of those paths. |
| Diagnostics never reach a browser | no page, component or route names them; the approved page binds `legacy` only; and the finding contract has no field that could hold a person. |
| No client component can reach the canonical layer | a transitive import-graph walk from every `"use client"` file, and from every route, finds no path. |
| Exactly one page can | the same walk finds one, and its chain passes through the approved loader and the server-only orchestrator. |
| Nothing on the path can write | every module reachable from `shadow/server.ts` that could hold a database client uses only read builder methods; the write path (`canonical-commit/{adapter,server,flow,projector}.ts`) is unreachable. |

`npm run test:shadow-boundary` — 54 checks, in `npm test`.

**Shadow mode has never been enabled on a hosted environment.** No environment
variable was set anywhere, no deployment was made, and the internal operator
(`npm run canonical-shadow-report`) enables it in its own process only, for one
scope, and dies with it.

---

## 11. Commands

```
npm run test:shadow-boundary       # 54 offline checks, in `npm test`
npm run canonical-shadow-report    # the internal operator: legacy vs canonical,
                                   #   read-only, prints only safe diagnostics
npm run canonical-database-parity  # golden parity FROM the canonical tables
```
