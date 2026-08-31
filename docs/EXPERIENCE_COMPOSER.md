# The Experience Composer — the dashboard builder

> Standing architecture reference for the governed data-experience builder.
> Status on 2026-08-30: **schema version 2 — the editor is stable, the draft
> can be looked at, and the reader can explore.** The model, the schema, the
> registries, the compatibility adapter, the storage, the Server Actions,
> fifteen renderers, one internal builder route and one internal draft-preview
> route exist. Drafts are saved and reload. **Nothing is published**, no
> client-facing route reads a composed definition, and the deployed client
> experience is unchanged except for one calculation correction (§35).
>
> Sections 1–10 describe the model, which the foundation established.
> Sections 11–22 describe the persistent slice built on it. Sections 23–31
> describe the milestone that made the editor stable. **Sections 33–36
> describe this one**: the block capability model that stopped offering filter
> controls on paragraphs, the reversed connection workflow, the collapsible
> panels and focus mode, and the client-facing Top-2-Box threshold.
>
> Where earlier and later sections disagree, the later ones are current. In
> particular: the schema version is **2**, not 1; there are **twenty** block
> types, not nineteen; the study's identity is a **global layer**, not a
> `cover` block; `query.filterRefs` is now `query.fixedFilters`; and
> `BlockSpec.allowsFilters` no longer exists — §33 replaced it.

---

## 1. The product decision

Be Community is moving from a fixed client dashboard to a **highly
customizable data-experience builder** for internal consultants.

It is deliberately **not** an unrestricted Power BI clone. It is a **governed
composer**: an internal user can create pages and sections, add, move, resize,
duplicate, hide, remove and configure presentation blocks, choose compatible
results, characteristics, aggregations, chart types, filters, labels, colours,
formatting and responsive behaviour, build several Journeys, connect filters
globally / by page / to named blocks, and preview exactly what the client will
see — while the canonical calculations, tenant authorization, approved
qualitative evidence, audit history and immutable publication snapshots stay
exactly where they are and stay non-negotiable.

The product must not hardcode any one client's behaviour. A particular client's
configuration becomes a **reusable, editable starting template**, expressed as
registry data, never as a branch in the code.

**AI is out of scope for this work.** No model is called, no SDK is added, no
secret is introduced, no table is created and no AI interface is built. The
existing category advisor is untouched and remains disabled.

---

## 2. Three layers, and what may edit each

| Layer | What is in it | Who may change it |
| --- | --- | --- |
| **Truth** | Imported respondents and answers, canonical calculations (`src/lib/calc/**`), tenant access, source data, immutable evidence | Nothing in the composer. Not reachable from a definition. |
| **Meaning** | Semantic results and characteristics, category decisions, qualitative review, journeys, interpretations, human-readable labels | The governed workflows that already exist — the import mapper, the category review, the qualitative review, the recorrido editor, the interpretation workflow |
| **Presentation** | Pages, sections, blocks, layout, visualizations, filters, copy, responsive behaviour | Fully configurable in the composer |

**The composer edits the presentation layer only, and references the other two
by stable opaque id.** A block never carries a metric key, a column name, a
table name or a respondent. It carries a registry handle, and a handle is
accepted only when it is present in the registry the server built for that exact
study of that exact tenant.

---

## 3. `ExperienceDefinitionV1`

`src/lib/experience/definition.ts`. Strict Zod boundary, server-side.

```
experience_definition
├── schemaVersion            literal 1
├── id, title, metadata      { studyId, tenantId, subtitle, locale }
├── sampleVisibilityPolicy   the study-wide disclosure rule (§4)
├── theme                    palette, accent, density, client mark
├── pages[]                  ≤ 24
│   ├── id, title, description, order, visible
│   ├── filterRefs[]         filters whose control this page hosts
│   └── blocks[]             ≤ 60 per page, ≤ 300 per experience
│       ├── id               opaque, minted, never derived from a label
│       ├── type             one of 19 (§6)
│       ├── query            BlockQuerySpec | null (§5)
│       ├── visualization    { variant, legend, showValueLabels, axisLabel }
│       ├── journeyRef       for a journey block
│       ├── filterRefs[]     filters whose control this block hosts
│       ├── samplePolicy     inherit | override
│       ├── presentation     emphasis, tone, colour role, sample note, method
│       ├── copy             eyebrow, body, caption, items
│       ├── image            { assetId, alt } for an image block
│       ├── visible
│       └── layout           desktop / tablet / mobile placement (§8)
├── filterDefinitions[]      ≤ 24
├── filterConnections[]      ≤ 200 — which blocks respond (§7)
├── journeyReferences[]      ≤ 8 (§9)
├── review                   status, revision, author, reviewer, publisher (§11)
└── publication              snapshot, versions, frozen policy (§11)
```

### What the schema refuses, by construction

- **Unknown fields, everywhere.** Every object is `z.strictObject`. A document
  that grew a property is rejected, never half-read.
- **SQL, JavaScript, HTML, CSS, template expressions and control characters** in
  any authored string (`src/lib/experience/text.ts`). Ordinary Spanish prose,
  punctuation, percentages and `<`/`>` in a sentence all pass; the detector
  looks for the *shape of a construct*, not for a character.
- **Database keys.** No canonical metric key or column name appears anywhere in
  a serialized definition — the gate asserts this against the adapted fixture.
- **CSS.** Colour is a role from a closed set; width is a column count. The one
  free value is a six-digit accent hex, resolved at render time through the
  existing `src/lib/brand/contrast.ts`.
- **Respondents.** No id, no answer, no quote. A definition describes how to ask
  for numbers; it never carries them.
- **Unbounded anything.** `src/lib/experience/limits.ts` declares every ceiling,
  including one on the serialized byte length, because field limits multiply.
- **Recursion.** `containerDepth` is 1: a block never contains a block, so no
  recursive parse exists and no depth can be exhausted. Nesting is a later
  question and will have to arrive with a bound.

### Identifiers

`src/lib/experience/ids.ts`. Opaque (an FNV-1a hash over 32-bit words, three
times), stable (same seed → same id, forever), and free of clocks and entropy so
a server render and a client hydration agree. **A label is never an input.**
Deriving an id from a title is how renaming a block silently repoints every
filter connection and published snapshot that named it — the same class of
defect the recorrido editor was already rescued from.

### Versioning and migration

`src/lib/experience/migrate.ts`. Forward only, one step per version, never in
place, **a published snapshot is never migrated** (it renders at the version it
was written under or not at all), an unknown version is refused by name rather
than guessed at, and every migration is tested against a committed fixture of
the version it starts from.

---

## 4. Sample visibility — the reversal, stated precisely

`src/lib/experience/sample-policy.ts`.

Until now the rule was a constant: fewer than five distinct responses and the
result disappeared, everywhere, for every study, with no way to say otherwise.
That is right for a study where a cell of three is three identifiable children.
It is wrong for a study whose whole population is eleven people who commissioned
the work to see those eleven answers — there it protects nobody and deletes the
deliverable.

The constant becomes an explicit, versioned, per-study **policy**:

| Mode | Behaviour |
| --- | --- |
| `show_all` | Aggregated results are visible from `n = 1`. |
| `warn_below` | The value is shown, and below the threshold it carries a sample-size warning. |
| `hide_below` | Below the threshold the result is withheld — and so is its count. |

- **A newly composed experience defaults to `show_all`.** The owner's decision.
- **A block inherits the study policy or states its own**; the override wins.
- **Every existing study keeps the behaviour it has today.** The legacy rule is
  preserved verbatim as `LEGACY_SAMPLE_POLICY`, the compatibility adapter stamps
  it onto every definition it derives, and a gate walks every base from 0 to 60
  asserting that it agrees with the deployed `sampleVisibility()` at each one.
- **No slice has removed the legacy minimum-five behaviour from any current route.**
  `src/lib/calc/disclosure.ts` and every client-facing surface are untouched.
- **An immutable publication snapshot carries the policy it was published
  under**, so a delivered report cannot change because a preference was edited.

Evaluation is one canonical, independently tested function returning a
**structured state** — `no_data` / `visible` / `warning` / `suppressed` — plus
the count when the outcome permits revealing it and `null` when it does not. A
suppressed result never publishes its own `n`: hiding the value while announcing
the base gives away the half that identifies people. No presentation copy lives
in the calculation; wording stays in `src/lib/language/sample.ts`.

**Not configurable, at any setting:** tenant isolation, RLS, server-side
authorization on every route and mutation, and the rule that raw personal data
never crosses to a client. This policy decides whether an *aggregate* is drawn.
It never decides who may ask.

---

## 5. `BlockQuerySpec`

A declarative request, never a query language: metric handle, approved
aggregation, primary and optional second characteristic, author-fixed filter
narrowings, sort, top-N, period selection, comparison target, number format and
sample behaviour.

**The comparison target is a RANGE, not a number.** `target`, `targetMaximum`
and `targetLabel`, with either bound open — "at least eight" and "no more than
three" are both real targets. It is that shape because the deployed product
already ships exactly that: one configured result, a minimum, a maximum and the
words to use when the value falls outside them
(`presentation.threshold` in `src/lib/dashboard/config.ts`). A model that could
only hold one number could not represent a study the product already serves.

Validation (`src/lib/experience/validate.ts`) separates two things that are
usually confused:

**Hard errors — the product would be lying.** Unknown result; unknown or
unauthorized characteristic; unsupported aggregation; a reference that would
cross a tenant; SQL- or code-shaped input; an impossible schema (a bar chart
with nothing on its axis, a result that cannot honestly be a pie); a
characteristic beyond the legibility ceiling. These block, on the server.

**Soft warnings — a person may reasonably proceed.** A pie with nine slices; a
chart that will be hard to read; a valid but sparse result; long labels; a weak
fit on a phone; a variant with no renderer yet. These are said once, next to the
choice, and **never block**. A tool that refuses a legible-but-imperfect page is
a tool the person it was built for stops using.

---

## 6. Block and chart registries

Nineteen block types — `cover`, `section`, `rich_text`, `finding`, `metric`,
`chart`, `comparison`, `retention`, `journey`, `qualitative_themes`,
`theme_cloud`, `interpretation`, `recommendation`, `image`, `divider`, `spacer`,
`report_download`, `all_results_disclosure`, `pivot_explorer` — grouped as
structure / evidence / narrative / action, which is the split that keeps a
composed page from becoming a wall of charts. The nineteenth arrived with this
slice and is described in §14.

Eighteen chart variants — KPI, horizontal / vertical / grouped / stacked /
100 % stacked bar, line, area, pie, donut, table, heatmap, bubble, treemap,
traffic light, retention series, journey, theme cloud.

Fifteen of the eighteen variants are now drawn for real; the other three declare
themselves undrawn and say so wherever they appear (§13). Compatibility is the
intersection of what the result allows, what the variant needs and what the
query supplies — data, not `if` statements scattered through the UI.

The semantic registry (`registry.ts`) carries results and characteristics with
families (satisfaction, recommendation, retention, ROI, culture, participation,
composition, awareness), units, formats, allowed aggregations, compatible
charts, filter and journey eligibility, description and source, privacy
(`aggregate_only`, with no value that permits a respondent row), publication
readiness, and a content stamp used for approval invalidation.

`src/lib/experience/fixtures.ts` demonstrates — as data, with nothing added to
any shared module — generation, a green/yellow/red performance light, culture
category, membership status, probability of renewal, ROI, time in membership,
the "did not know this moment existed" share, and a satisfaction-only journey
configuration. It is a fixture, contains no participant data, and a gate asserts
that no production module imports it.

---

## 7. Filters and connections

- **Filter definitions** are declared once, scoped `global` / `page` / `block`,
  with a control type (single or multi select), default values, whether the
  client sees the control, and an optional dependency for cascading.
- **A control is not a chart, and they do not share a ceiling.**
  `dimensionCardinality` (60) is how many bars a person can compare;
  `filterOptions` (500) is how long a list a control may offer. The deployed
  dashboard already builds a filter over every imported `seg_` column whatever
  its cardinality, so holding a control to the chart's ceiling made the adapter
  drop a filter the product ships.
- **A page or a block hosts a filter's control** via its `filterRefs`.
- **`filterConnections` says which blocks respond**, by naming them.

**A filter never affects a block because they share a string key.** Two charts
can both be broken down by generation and only one of them be meant to follow
the reader's choice. Connections are explicit, validated against the blocks that
actually exist, and a dangling one is a hard error. Duplicating a block
deliberately inherits **no** connection.

**And a filter never affects a block that cannot recompute.** A connection
naming a paragraph or a download button is not honoured, is reported as a soft
warning, and is refused outright when somebody tries to make one. §33.

---

## 8. Responsive layout

A bounded 12-column grid, with a placement per breakpoint (desktop 1280,
tablet 768, mobile 360).

**There are no coordinates.** A block declares an `order` and a `span`; rows are
computed by filling the grid left to right and wrapping. There is no x, no y, no
pixel, no absolute position and no z-index — so two blocks *cannot* overlap and
no arrangement *can* be wider than the grid. Those are consequences of the
model, not checks somebody could forget to run, and `rowsFor` / `rowWidths` are
how they are proved.

**On a phone every visible block is full width.** A 320 px screen has no room
for two things side by side, and the product already paid for learning that.

---

## 9. Multiple journeys

An experience carries up to eight independent journeys. Each has a stable id, an
editable title and description, ordered moments, the metric families it is
eligible to carry, a metric per moment, a separate **"did not know this moment
existed"** measure (a question about reach, not about dissatisfaction, and
modelled so the two can never be confused), a filter set, a presentation
variant, visibility, an origin and a revision.

`eligibleFamilies` is a list rather than a single value for one reason: a
journey adapted from a study that already exists declares the families its
moments already use, so adapting can never invent a constraint the study fails.
A composed journey normally declares one and is held to it.

**The existing single `journey_definition` remains the stored, supported shape.**
It is read through the compatibility adapter and is not migrated away or
destroyed.

> **Built in the journeys / visuals / cloud milestone.** §40 is the
> implemented contract: the manager, the two distinct duplicate verbs, the
> refusal to remove a recorrido a page still shows, and the awareness mapping
> that requires both halves.

---

## 10. Theme-cloud contract

The deployed visualization is not really a cloud: it places up to nine words at
nine hardcoded positions, so a tenth theme silently disappears and two long
labels can overlap. `src/lib/experience/theme-cloud.ts` is the contract for the
real one — confirmed themes only (never raw comment text, never a suggestion),
size by count with the count written next to the word, deterministic positions,
collision-aware placement, brand roles rather than hex, evidence links,
responsive bounds, an ordered list that remains the reference, and export.

**The deployed client component is not replaced**, and no AI grouping is added: themes are grouped by the human category review, which already records
who decided what.

> **Built in the journeys / visuals / cloud milestone.** §43 is the implemented
> contract, and it goes further than this sketch: the basis is a stored,
> stated choice; the aliases are the review's own fold; a block may read one
> source; the layout narrows its range before it drops a theme; and the
> study's disclosure rule applies to a word exactly as it applies to a number.

---

## 11. Persistence — the draft, the revision, and the line between them

`supabase/migrations/0023_experience_definition_persistence.sql`, corrected by
`0024_experience_draft_conflict_code.sql`. Three tables and one function.

| Object | What it holds | Who may write it |
| --- | --- | --- |
| `study_experience_draft` | ONE mutable draft per study — the working document | only `save_study_experience_draft` |
| `study_experience_revision` | IMMUTABLE published revisions | nobody yet; publication is the next milestone |
| `study_experience_event` | who saved what, and when | only `save_study_experience_draft` |

### What is stored

The validated canonical definition as `jsonb`, plus the schema version it was
written under, a monotonic revision, the account that created it, the account
that last updated it, and both timestamps. Nothing else. A definition is
presentation — pages, blocks, layout, chart choices, filters, connections,
journeys, authored copy, and references by opaque handle — so the column holds
no respondent, no answer, no quote and no canonical metric key. §20 is the gate
that asserts it rather than the sentence that claims it.

### Draft versus published

Saving a draft is an ordinary edit and changes **nothing a client sees**. A
published revision is what a client would be served, is written once, and is
never updated: `refuse_experience_revision_update` raises on `UPDATE`, and no
role holds the `UPDATE` privilege either, so the immutability is enforced twice
and by construction rather than by convention.

**Publication is not implemented in this milestone.** No code path writes a
revision. The table exists now because the draft's revision counter and a
publication's identity have to be designed together — bolting an immutable
history onto a mutable row afterwards is how a "published" report starts
drifting with its draft. Saying so is better than a table that quietly implies
a feature.

### Lost updates

Two consultants with the same study open must not silently overwrite each other.
`save_study_experience_draft` takes the revision the caller believes it is
editing, and refuses when the stored revision has moved on. The check and the
write happen in one statement under `for update`, so no window exists between
them. Three situations refuse:

- a save that names no revision when a draft already exists (a blind write);
- a save that names a revision when no draft exists (the draft it was based on
  is gone);
- a save whose revision is not the stored one.

**The refusal is SQLSTATE `55000`, and the choice is load-bearing.** The first
version raised `40001` — serialization_failure, which is what the condition
literally is. Measured against the linked project, from the same function one
statement apart:

| | outcome |
| --- | --- |
| a stale revision, raising `40001` | HTTP 504 after **125 098 ms**, no message |
| a bad schema version, raising `22023` | HTTP 400 after **580 ms**, code delivered |

PostgREST treats a serialization failure as transient and retries it, so a
deliberate refusal never reaches the caller. `55000` —
object_not_in_prerequisite_state, the code `transition_study_interpretation`
already uses for a precondition failure — is delivered with its message intact,
in 148 ms. The live gate asserts the promptness as well as the code: a refusal
that arrives as a gateway timeout is a refusal nobody receives.

### Authorization, in three independent layers

1. **The route and the Server Actions.** `/studio/e/[studyId]/construccion` runs
   `requireInternal()` before it reads anything, and both Server Actions
   revalidate the session with `getUser()` and re-read the role from the
   database before creating a privileged client. A Server Action is a public
   HTTP endpoint with a hard-to-guess name; the page having authorized proves
   nothing about the request that arrives at the action.
2. **RLS.** Enabled *and* forced on all three tables, with `anon` and
   `authenticated` denied outright. A client-role session cannot read or write a
   draft with a valid JWT and a correct study id. Even `service_role` holds only
   `SELECT`: every write goes through the `security definer` function, so the
   application's own privileged role cannot write these tables directly.
3. **The function.** It re-checks that the actor holds the `internal` role in
   `public.profiles`, derives `tenant_id` from the **study row**, and refuses a
   document whose own `metadata.studyId` / `metadata.tenantId` disagree with the
   study being written to.

**The tenant is never a parameter.** Not in the Server Action, not in the
storage layer, not in the function's arguments. A tenant id in a request is a
tenant id an attacker chose.

### What the browser receives

`builderClientPayload` in `src/lib/experience/builder-workspace.ts` — a named
projection, written out by hand so that adding a field to the workspace cannot
accidentally ship the study's rows or the handle-to-key index to a client
component. The browser gets aggregates, labels, and a definition full of opaque
handles. The mapping from handle to canonical metric key exists only on the
server, in the one module that reads the study's rows.

---

## 12. Real numbers

`src/lib/experience/data.ts`. It resolves exactly the aggregates a document
asks for, and it invents nothing.

- Every value comes out of `src/lib/calc/metrics.ts` — `npsFromScores`,
  `csatTopBox`, `mean`, `percentage` — or out of the Workers-safe grouping
  primitives in `src/lib/calc/table.ts`. This module decides WHICH rows go into
  a canonical function and how the result is labelled. It never decides what the
  function does, so a composed page cannot produce a number the deployed
  dashboard would disagree with. The gate asserts the equality directly.
- **Rounded exactly once**, at the precision the aggregation's unit declares
  (`docs/CALCULATION_POLICY.md` §4). `formatNumber` re-applies the same
  canonical `roundTo` at the same precision, which is idempotent.
- A cell key is a `tupleKey`, not a joined string: a category value is a segment
  value a client imported, and `"a b" + "c"` and `"a" + "b c"` collapse into one
  cell under any separator a value can contain. Two distinct groups sharing a
  cell is a wrong number.
- A request naming something the study does not have comes back as a **refusal**
  — `unknown_metric`, `unknown_dimension`, `unsupported_aggregation` — never as
  an empty chart. "Nobody answered" and "this block points at nothing" are
  different sentences and a reader acts on them differently.
- `topN` **counts what it leaves out** rather than dropping it silently.

`blockDataRequests` derives the list of aggregates from the document, so the
page that renders the builder and the Server Action that refreshes it ask for
exactly the same things. Nothing else is computed.

---

## 13. Renderers — fifteen drawn, three that say they are not

> **Superseded.** All eighteen are drawn now. `heatmap`, `bubble` and
> `treemap` were completed in the journeys / visuals / cloud milestone (§42),
> and `test:renderer-parity` keeps the catalogue and the renderers from
> disagreeing silently.

`src/components/studio/experience/Charts.tsx`, dispatched by `BlockView.tsx`.
No charting dependency was added: the drawings are inline SVG and CSS on the
project's existing brand tokens, which is what the rest of the product already
does.

**Drawn for real (15):** número destacado (KPI), barras horizontales, barras
verticales, barras agrupadas, barras apiladas, barras apiladas al 100 %, línea,
área, pastel, dona, tabla, semáforo, serie de permanencia, recorrido, nube de
temas.

**Not drawn in this build (3):** mapa de calor, burbujas, rectángulos
proporcionales. Each **says so by name**, on the canvas and in the catalogue,
above the readable representation offered as a reference — never instead of it.

That last rule is the reason the foundation's `fallback` field became
`alternative`. A traffic light shown as horizontal bars is not a traffic light:
green, amber and red against an agreed range is a different statement from "this
bar is longer than that one", and quietly swapping one for the other is how a
consultant publishes a page they did not choose. The semáforo is implemented,
and it **refuses to colour anything without a range somebody agreed to** —
with no configured range it shows the number and says a semáforo needs one.

Every chart carries a real table of the same values for a screen reader, the
SVG itself is `aria-hidden`, and every empty state says which kind of emptiness
it is: nobody answered, the disclosure rule withheld it, or the block points at
something the study no longer produces.

**A drawing that divides a whole needs parts that add up to one.** A pastel, a
dona and unos rectángulos all assert that the slices sum to the total; a
promedio, an NPS or a Top-2-Box by characteristic do not sum to anything. Those
three drawings therefore accept only `count`, `sum` or `share`, and the
validator refuses the rest as a hard error.

---

## 14. The comparison explorer is a block

The deployed dashboard ships a pivot/comparison explorer, and the compatibility
adapter used to report it as `section_not_representable` and drop it. A model
that silently loses a section the product ships is not a compatible model.

`pivot_explorer` is the nineteenth block type. It carries **no author query**,
on purpose: the reader writes the query, and what is being composed is the
block's presence, its wording, its width and which filters narrow it. Storing an
author's cross there would describe a different product from the one that ships.

That does not make it unbounded. The reader's choice is still validated against
`buildAllowlist`'s server-side allowlist on every request
(`src/lib/calc/pivot.ts`), which is the boundary P4E established and which
nothing here relaxes. On the canvas the block states which results and which
characteristics the reader will be able to cross, and shows the cross it opens
on — the coarsest characteristic, for the same reason the deployed dashboard
opens there.

---

## 15. Sample visibility

Unchanged from §4 in intent, now editable and stored:

- the study-wide rule is set in the left panel — show everything from `n = 1`,
  show with a warning below a threshold, or hide below it;
- a block states its own rule in its card, and the block's rule wins;
- a newly composed experience defaults to `show_all`; an experience adapted from
  an existing study is stamped with `LEGACY_SAMPLE_POLICY` (hide below five), so
  no existing study changes behaviour because the builder exists;
- the canvas applies the rule as it draws, so choosing between the three modes
  is a decision somebody can see the consequence of;
- a suppressed cell loses its value **and** its count: publishing "oculto,
  n = 3" hides the number and announces the base, which is the half that
  identifies people.

The legacy minimum-five rule is removed from no current route.
`src/lib/calc/disclosure.ts` and every client-facing surface are untouched.

---

## 16. Compatibility

`src/lib/experience/adapter.ts` reads a study's existing configuration and
produces a valid `ExperienceDefinitionV1`. It is a **pure function**: no
database import, no write, no mutation of its input, byte-identical output for
identical input.

All four of the warnings the first run produced turned out to be defects rather
than limitations, and all four are fixed:

| Reported | What it actually was | What happens now |
| --- | --- | --- |
| The pivot explorer | A MODEL gap. | `pivot_explorer` carries it (§14). Nothing is reported. |
| A configured threshold alert | A modelling defect: `comparison` held one number where the product ships a labelled range. | The query carries the range; the adapter puts it on the block that shows that result. |
| A characteristic with 72 values | An adapter defect: a chart's legibility ceiling applied to a filter control. | Offered as a filter, as the deployed dashboard offers it. |
| A recorrido moment with no result | Invalid legacy configuration. | The moment is kept, visible, without a number; the warning names it. |

Warnings are internal. They are for the team, never for a client, and the
builder shows them under a heading that says so.

### Migration stages

1. **Foundation — done.** Model, schema, registries, adapter, gate.
2. **Persistence — done.** Table, migration, Server Actions, draft, optimistic
   concurrency, audit.
3. **Renderers — done for 15 of 18.** Three declare themselves undrawn.
4. **Publication.** Approve, snapshot, and serve a revision. NOT started; the
   storage model supports it, nothing writes it.
5. **Client rendering.** Serve `/insights/e/[studyId]` from a published
   revision, behind a per-study switch, with the existing renderer as the
   default until each study is deliberately moved. NOT started.
6. **Templates.** Composed experiences saved and instantiated. NOT started.

---

## 17. The builder

`/studio/e/[studyId]/construccion` — **"Construcción del dashboard"**.

- Runs `requireInternal()` **first**, before any read.
- Loads one real study, adapts it, and loads the saved draft when there is one.
- **It saves.** An edit lands in local state, an autosave carries it to one
  Server Action after a pause, and reloading brings back what was saved.
- Does not alter `/studio/e/[studyId]/vista-cliente` or `/insights/e/[studyId]`,
  and no client-facing route imports anything from `src/lib/experience/**`.

### The arrangement

Left: pages and the block catalogue. Centre: the canvas. Right: the selected
block's card. Top: the save state, undo, redo, the width being previewed, and
the way out.

- **The canvas is the dominant area at every width.** The pages panel docks at
  `lg`; the block card waits until `xl`. Two 288 px panels either side of a
  1 024 px screen leave 400 px of canvas, and a three-column block inside 400 px
  is 49 px wide — the acceptance matrix measured a KPI clipping its own number
  there.
- **Both panels collapse on a computer and become drawers below their dock
  width**, from ONE element with responsive classes. Rendering the panel twice
  would give the same controls two sets of ids, which the acceptance matrix
  refuses.
- **A block on the canvas shows two controls**: a drag handle and a compact
  menu. Duplicar, ocultar, subir, bajar and quitar live in the menu and in the
  block's card — not as five permanent buttons crammed into a quarter-width
  card.
- **Reordering has two ways in, and neither is a fallback.** The handle drags
  with a pointer, and the same handle moves the block with the arrow keys while
  it has focus. Native drag and drop does not exist on a phone, so on a phone
  the keyboard and menu routes are the ones that work.
- **Precision layout is a desktop job.** The column-width control appears from
  768 px up; below that a person reads, selects, hides, reorders and edits the
  words. On a phone every block is full width, and that is stated rather than
  silently enforced.
- **Every control is at least 44 × 44 CSS pixels**, and there is no horizontal
  page overflow at 320, 360, 390, 768, 1 024 or 1 280.

### What it can do

Pages: add, rename, reorder, duplicate, hide, remove (with confirmation).
Blocks: add from the eligible catalogue, select, move with the pointer or the
keyboard, duplicate with fresh identifiers, hide, remove (with confirmation),
change the visible title and the explanatory text, change the visualization,
change the width per breakpoint, assign the result, the aggregation and up to
two characteristics, connect and disconnect filters one deliberate act at a
time, set the study's disclosure rule and a per-block override.

Undo and redo hold whole documents, bounded to 60 steps, and are per-session:
reopening the builder starts from what was saved. `Ctrl`/`⌘`+`Z` and
`⇧`+`Ctrl`/`⌘`+`Z` work, and are ignored inside a text field where the
browser's own undo is the one a person means.

**No edit can leave a dangling reference.** Removing a block or a page cleans up
after itself in all six places a filter id can appear, drops a connection left
naming nothing, and takes a block-scoped filter nothing references any more.
**Every refusal is a sentence** — a page already at its ceiling, a drawing the
block type does not allow, a characteristic too wide to read, a block that is
already first — announced in a live region, with the document unchanged.

### Saving

- **Autosave** 1.2 s after an edit settles, with a visible state: *Sin guardar
  todavía*, *Cambios sin guardar*, *Guardando…*, *Guardado · versión N*, *No se
  pudo guardar*, *Hay una versión más nueva*.
- **"Guardar ahora"** is always available, and **"Reintentar"** appears after a
  failure. A transient failure is retried once automatically, four seconds
  later, and then it stops and waits for a person: a save that keeps failing is
  a save that needs to be read about.
- The state is **derived, never stored twice**. A failure belongs to one exact
  document, so the next edit clears it and the autosave tries again. A conflict
  belongs to one revision, so editing does not make somebody else's save go
  away — the person is offered the stored version, or a download of their own
  before deciding.
- **Opening the page creates nothing.** A study nobody has composed says "sin
  guardar todavía"; the first save happens when somebody edits something.
- Closing the tab with unsaved changes warns.

### Export

"Descargar" writes the canonical definition as readable JSON. It carries
handles, layout and authored words — and asserted by the gate: no canonical
metric key, no imported column name, no respondent, no answer, no theme count,
no credential. It does carry the study and client ids, which is what makes it
possible to tell whether an exported file belongs to the study it is being
looked at beside; those are the same ids already in the address bar of the
internal user reading it.

**Import is not implemented.** A file could name another tenant's study, or a
revision that no longer exists, or a registry that has moved; doing it safely
needs its own design, and doing it unsafely is worse than not doing it.

---

## 18. Security boundaries that remain mandatory

Nothing in the builder relaxes any of these, and nothing in a definition can
reach them:

- RLS on every public table, FORCE RLS, no exceptions — including the three new
  ones.
- Server-side authorization on every route and mutation; `getUser()`, never
  `getSession()`.
- Tenant isolation, verified adversarially, and never taken from a request.
- Least privilege at the database; client-role users read-only; `service_role`
  read-only on the three new tables.
- Zod at every untrusted boundary, reject by default — including the definition
  a browser posts back.
- User-generated qualitative content only through escaped React text nodes; no
  `dangerouslySetInnerHTML`.
- Only human-confirmed themes cross into the builder; no quote is read at all.
- Absence is not a client-facing finding (contract C11).
- Canonical calculations unchanged; rounding governed by
  `docs/CALCULATION_POLICY.md`.

---

## 19. Migration and rollback

### Applying

The project's own tracked workflow, from the WSL verifier, never by pasting SQL:

```
npx supabase db push --dry-run --linked   # must name only the migrations you expect
npx supabase db push --linked
```

Before applying, capture what the database looks like: the metadata-only table
inventory through `rls_coverage_report`, and the exact row count of every data
table. Afterwards, compare. An additive migration adds tables and changes no
count.

### Rolling back

```
psql < supabase/rollbacks/0024_restore_experience_draft_conflict_code.sql   # optional; see the file
psql < supabase/rollbacks/0023_drop_experience_persistence.sql
```

`0023`'s rollback drops the two functions and the three tables and touches
nothing else; after it the database is in its 0022 state and every client-facing
surface behaves exactly as it did. **It destroys every saved draft**, which is
authored work, so export anything worth keeping first — the file says how.

`0024`'s rollback exists for completeness and is not worth running: it restores
the SQLSTATE that the Data API retries, so a stale save stops producing a
refusal at all and produces a two-minute gateway timeout instead. The file says
so.

---

## 20. Gates

**Offline, credentials-free, inside `npm test`:**

```
npm run test:experience-composer     # 140 deterministic checks
```

It covers the strict boundary, opaque and stable identifiers, every ceiling,
injection refusal, the three sample-policy modes and the legacy equivalence at
every base from 0 to 60, block overrides, hard-versus-soft validation, explicit
filter connections, multiple journeys, adapter purity and determinism, layout
non-overlap, review invalidation, schema migration, the route's and the Server
Actions' server-side authorization, the migration's additivity and its rollback,
the builder's keyboard operability and accessible naming, its drag-and-drop and
keyboard reordering, its collapsing panels and drawers, undo and redo, the page
operations, reference integrity, the canonical-parity of every aggregate, and
the export's safety.

It also covers, since this milestone: the identity layer and the fact that no
adapted study carries a cover block; the version 1 → 2 migration against a
version-1 document; filter panels, their four target scopes, refusal of an
incompatible connection, and that renaming a block never breaks one; the two
kinds of filter and their independence; how a reader's choices combine and that
they never widen past the author; that a reader's selection never reaches the
saved definition; that a Top-2-Box is computed from the study's own scale and
refused rather than faked when there is none; and that **no builder or preview
Server Action calls `revalidatePath`**.

**Live, credential-bearing, inside `npm run gates:live`:**

```
npm run test:experience-persistence-live   # 23 checks against the real database
npm run test:experience-builder-live       # 20 checks driving a real browser
npm run test:experience-editor-regression  # 35 checks — every mutation, consecutively
```

The third is this milestone's regression gate and is shaped by the defect it
exists to catch (§23). It seeds one disposable client and study with generated
respondents, two characteristics and two results, then performs **thirty
editable operations one after another in a single session** — typing, renaming,
adding a page, adding a result and a chart, selecting, changing the result, the
calculation, the title, the prose, the width and the visualization, changing the
disclosure rule, editing the identity, hiding part of it, adding a visible
filter panel, keyboard reordering, drag and drop, duplicating a block **twice**,
hiding, showing, undo, redo, saving by hand, removing with its confirmation, and
duplicating a page. After **each** one it asserts that the Studio error boundary
is not on screen, that React is still attached, that the save chip is still
there, that nothing logged a React or hydration error, that there are no
duplicate DOM ids, and — at the source rather than through the symptom — that
the Server Action's response carried **no re-rendered page tree and no errored
row**.

It then proves that a saved edit survives a reload, that an invalid edit is
refused in place without taking the editor down, and that a save which cannot
reach the server says so, keeps the session, and succeeds on retry once the
network is back.

The first proves RLS, the privilege model, every refusal the writer makes, the
optimistic-concurrency check and its promptness, and that a save writes exactly
one audit record. The second proves that a client-role account is redirected,
that the builder shows the study's real aggregate and none of its 123 canonical
metric keys, that no quote or respondent identifier reaches the page, that every
control is 44 × 44 at 320/360/390 with no sideways scrolling and no duplicate
id, that typing keeps focus and the caret, that a saved edit survives a reload,
that a second editor's save is detected rather than overwritten, that a block
moves with the keyboard alone, and that saving a draft leaves the client's own
study page character for character identical.

**The rendered acceptance matrix** (`npm run test:p8-acceptance-live`) visits
`/studio/e/[studyId]/construccion` among twenty routes at 320, 360, 390, 768,
1 024 and 1 280 px.

### Running them locally

```
npm run dev                       # enough for the acceptance matrix
npm run build && npm start        # REQUIRED for test:experience-builder-live
```

React's development build calls `eval()`, and this application sends a
Content-Security-Policy without `unsafe-eval` — correctly — so under `next dev`
React never hydrates the builder and every control on it is inert. That is the
CSP doing its job. A gate that DRIVES the product has to drive the build a
client would receive, and it fails loudly if React is not attached.

Both live gates need `CHROME_PATH` and the synthetic fixture credentials, and
are run from WSL as an ordinary user with the distribution's own browser.

---

## 21. How to accept this, step by step

Written for the person judging it. **Nothing here serves live traffic and
nothing may be promoted.** A zero-traffic Cloudflare version exists so the build
can be looked at, and the Worker's live version is untouched:

| | |
| --- | --- |
| preview version | `8ad38467-b6ea-4d4c-920b-4ddb9b612cb3`, tag `builder-9aa7159` |
| preview URL | `https://8ad38467-becommunity-v1.ollinagencyllc.workers.dev` |
| live version, unchanged | `e691ecd8-de9a-4a02-a8e3-13aad7e9e805` at 100 % |

On the preview `/api/health` answers 200 with `supabase: true`, `/login`
renders, and every internal address — including the new
`/studio/e/<id>/vista-previa` — redirects an unauthenticated request to
`/login`. **Do not run `wrangler versions deploy`.**

You can work in the builder on the preview with your own account, or run it on
your own machine:

```
npm run build && npm start
```

`next dev` will not do: React's development build calls `eval()`, this
application's CSP correctly forbids it, and under `next dev` the builder never
hydrates.

### Finding the study

Studio → **Estudios** → **La voz de las y los Nets de Cuicuilco** (client: BNI
Cuicuilco), then its address:

```
/studio/e/<id del estudio>/construccion
```

### 1. The thing that was broken

1. **Change something. Then change something else. Then keep going.** Rename a
   page, add a block, duplicate it, hide it, move it, remove it — a dozen edits
   in a row without reloading. The chip at the top left cycles through *Cambios
   sin guardar* → *Guardando…* → *Guardado · versión N*, and **the editor stays
   an editor**. This is the milestone's first sentence: before, almost any edit
   eventually replaced the whole screen with *"No pudimos abrir esta parte del
   trabajo"* while the edit had already been saved.
2. **Duplicate a block, reload the page, and duplicate the same block again.**
   It works. Before, the second duplicate minted an identifier that already
   existed, and from that moment **every** save failed forever with a message
   about a repeated block.
3. **Turn your wifi off and press "Guardar ahora".** The chip says *No se pudo
   guardar* and offers *Reintentar*. Nothing is lost. Turn it back on, press
   *Reintentar*, and the same edit saves.

### 2. The numbers that were wrong

4. **Look at the satisfaction results on Panorama.** They read real percentages
   — 64.3 %, 60.7 %, 40.7 %, 37 % — where every one of them used to read
   **0 %**. The study answers those questions on a 1–5 scale and the composer
   was applying the 0–10 Top-2-Box threshold to them. All 55 of them were wrong.
5. **The recommendation result reads 30.8 over 39 answers**, which is what it
   read before and what the canonical function produces.
6. **Find a block with a semáforo and no agreed range.** It carries a short
   chip — *Falta configurar el rango* — instead of the paragraph that used to be
   printed in full inside every narrow card.

### 3. The identity of the study

7. **Look at the left panel: "Identidad y portada del estudio".** The study's
   name, the client, the period, the introduction and the mark, each with its
   own switch, configured here and nowhere else. It renders once, above the
   pages.
8. **Go to Panorama and count.** There is no cover block in it any more. Try to
   move the identity under a chart — you cannot, because it is not in any
   page's block list. Duplicate Panorama: the study's name is not duplicated
   with it.
9. **Empty the "Periodo" field.** The line disappears rather than becoming a
   blank heading.

### 4. The two previews

10. **Press "Vista previa del borrador".** This is the new one. It shows what
    you have been building, with the study's real numbers, under a banner that
    says the client does not see it, and with an obvious way back.
11. **Press "Ver versión actualmente publicada".** This is the old button under
    an honest name: it is what the client has today, and it does not contain
    your draft. It never did — the old label just implied it should.

### 5. The filters your client will use

12. **On Panorama, find "Explora los resultados".** It is a block: select it and
    it has a card like any other. Move it, widen it, rename it, duplicate it,
    hide it, remove it.
13. **In its card, choose which characteristics it offers**, and reorder them
    with ↑ and ↓. Every filterable characteristic the study has is in that list
    — the ones it starts with are a suggestion, not a limit. Add one the
    suggestion did not name.
14. **In the same card, choose what it changes**: the whole experience, this
    page, chosen sections, or chosen blocks. Pick "solo los bloques que elija"
    and tick two of them. Try to tick a divider: it is refused, and it says why.
15. **Rename one of the blocks it moves.** The connection survives — targets
    name identifiers, never words.
16. **Remove a block a panel names.** It is dropped from the panel, the
    confirmation tells you first, and the draft still saves.
17. **Go to "Lo que dijeron".** It has its own panel, scoped to that page. The
    characteristics on it are the findings-oriented ones.

### 6. The filters, working

18. **In the draft preview, choose "Antigüedad empresa = Más de 5 años".** The
    recommendation result moves from **30.8 over 39** to **41.4 over 29**, and
    the satisfaction results move with it.
19. **Add a second choice, "Generación = Generación X", without clearing the
    first.** Both apply. The panel says *Estás viendo: …* with both, and the
    address bar carries both.
20. **Copy the address and paste it into a new tab.** The same view comes back.
    Nothing private is in that link: a filter identifier and the same words the
    charts already print.
21. **Press "Limpiar filtros".** Every block returns to its original value and
    the address bar empties.
22. **Change pages while a filter is on.** Panorama's panel governs the whole
    experience; the one on "Lo que dijeron" governs only that page. Blocks
    nothing connects to do not move.

### 7. What is still true

23. **Open the client's view** (`Ver versión actualmente publicada`, and
    `/insights/e/<id>` as a client account). It is exactly what it was before
    you started. Nothing you did here has reached a client, and nothing can
    until publication exists.
24. **Press "Descargar"** and open the file. Names, layout, words. No metric
    key, no answer, nobody's data.

### What is deliberately not there

- **Publication.** Nothing you build here reaches a client in this milestone.
- **Three drawings**: mapa de calor, burbujas, rectángulos proporcionales. Each
  says so where you choose it and where it would be drawn.
- **The real theme cloud.** The current one is registered as a filter target
  and moves with a panel like everything else; the drawing itself is next.
- **Import.** Export exists; loading a file back does not.
- **Publication.** Still nothing composed here reaches a client.
  (The client dashboard's own Top-2-Box, which used to be listed here as
  deliberately unfixed, is fixed — §35.)

---

## 23. The defect that took the editor down, and what fixes it

On the zero-traffic preview, almost any edit eventually replaced the whole
builder with the Studio error boundary — *"No pudimos abrir esta parte del
trabajo"* — and the edit was usually still there afterwards. Both halves of
that sentence were true, and together they name the cause.

**Reproduced, 4/4, against the real study.** The save Server Action called
`revalidatePath(studioStudyComposer(...))`. `revalidatePath` inside a Server
Action makes Next re-render the current route **inside the action's own
response**. For this route that meant a *second* full builder load — every row
of the study, the whole adapter, the registry and every aggregate — in the same
request that had just done all of it to validate the document.

Measured on the preview Worker:

| study | answers | action POST | RSC payload | outcome |
| --- | --- | --- | --- | --- |
| ACEPTACIÓN P6E | 80 | 1.9 s | 35 668 B, complete | saves, no boundary |
| BNI Cuicuilco | 3 282 | ~10 s | 7 788 B, **truncated**, ends `d:E{"digest":…}` | boundary, every time |

The stored revision advanced every time, so **the write always succeeded**. The
re-render that followed it did not: on a real-volume study it exceeded the
Worker's per-request budget, the tree was cut short, and its errored row reached
the browser as React error #441 — *"an error occurred in the Server Components
render"* — which the route's error boundary turned into a full-page failure.
The same action on an 80-answer study returned a complete tree in under two
seconds, which is what identifies the cause as the duplicated work rather than
the document.

**The fix is to stop doing the work twice.**

- `revalidatePath` is gone from both builder Server Actions, and from the draft
  preview's action. There was never anything to revalidate: the builder holds
  the document in client state, and the stored draft is read on a fresh page
  load, which is a new request with its own budget. The re-render's result was
  discarded.
- The save action no longer loads the whole workspace. `loadBuilderRegistry`
  gives it the registry it needs to validate a handle and stops there — no
  rows-to-aggregates pass, no draft read, no confirmed themes. The stored
  version is read only on the one path that needs it, a conflict.
- `loadLegacyStudySnapshot` accepts already-loaded rows. It used to read the
  study's rows itself while `loadBuilderWorkspace` read them again, so **every**
  workspace load read every row twice.

Measured after the fix, on the same server and the same study: the action
response went from **7 788 bytes of re-rendered page** to **147 bytes** — the
return value alone.

### A rejected write, and a lost connection

Two things that must not look like a crash, and now do not:

- **A refused save** leaves the document exactly as it was, keeps the editor
  interactive, and says why in place — next to the save chip, not on a
  replacement page.
- **A save that cannot reach the server** shows *No se pudo guardar*, offers
  *Reintentar*, retries once automatically, and then waits for a person. The
  session, the history and the unsaved document all survive it, and the same
  edit saves when the network comes back.

### The other defect the same investigation found

`sequence` — the counter the editor salts new identifiers with — restarts at
zero **every time the builder is opened**. Duplicating the same block, or
adding a block to the same page, in two different sessions therefore minted the
*same* identifier twice. The document then held two blocks with one id, the
strict boundary refused it with `repeated block`, and — because that is a
property of the **document** rather than of the request — every later save
failed too. The builder became a surface somebody could keep working in and
never save again.

`mintFreeId` salts a seed until it is free in the document it is joining.
Determinism is preserved: the same document and the same operation still
produce the same identifier, so the adapter and the gates are unaffected.

---

## 24. Two previews, because there are two questions

`Vista del cliente` used to be one button, and it opened the client's current
dashboard — which deliberately does not read a composed draft. That behaviour
was correct and it made the button useless: every honest answer it gave looked
like the builder had lost the work. The label implied the client's screen
should already contain the draft.

There are now two, and neither label suggests the other's answer:

| | what it answers | route |
| --- | --- | --- |
| **Vista previa del borrador** | what the work looks like right now | `/studio/e/[studyId]/vista-previa` |
| **Ver versión actualmente publicada** | what the client has today | `/studio/e/[studyId]/vista-cliente` |

`vista-previa` is internal-only (`requireInternal()` before any read), renders
the **latest saved draft** with the study's **real aggregates**, honours the
saved layout, titles, pages, blocks, charts, filters and visibility settings,
and **publishes nothing**. It opens under a banner that cannot be missed:
*"Vista previa interna del borrador; el cliente todavía no ve estos cambios."*
with an obvious way back to Construcción. `vista-cliente` is untouched, and no
client-facing route imports anything from `src/lib/experience/**`.

---

## 25. Identidad y portada del estudio

The study's visible title, the client it was done for, the period it covers,
its introductory description and its identity mark are a **global layer**, not
a block. `definition.identity`, rendered once before the pages.

It used to be a `cover` block inside Panorama, and that was wrong in a way that
mattered: it made the identity of the study look like ordinary Panorama
content. It counted among Panorama's blocks, it could be reordered underneath a
chart, duplicating the page duplicated the study's name, and hiding Panorama
hid who the report was for. Identity is not a section of the report; it is what
the report **is**.

- Every part has its own show/hide switch, and it is configured apart from
  every page.
- A part with nothing written in it renders as **nothing** — no heading, no
  reserved line — which is contract C11 applied where it belongs.
- The optional **download-report** action lives here too.
- **Pages keep every ordinary heading and text block they had.** Nothing was
  removed from what can be written anywhere; what was removed is the accident
  of the study's own title being one of them.

The compatibility adapter fills the identity from the study itself — its name,
its client, its period — and leaves `description` null, because an
introduction is authored work and inventing one would put words in the
consultant's mouth.

---

## 26. Two kinds of filter, and they are not the same thing

The UI and the canonical model now distinguish them by name and by shape:

| | **Filtro fijo del bloque** | **Panel de filtros para explorar** |
| --- | --- | --- |
| who sets it | the author, permanently | the reader, temporarily |
| where it lives | `block.query.fixedFilters` | a `filter_panel` block |
| what it carries | a characteristic and its values, **directly** | which controls to offer, and what they move |
| what it does | decides what the block is always about | changes the view while it is being read |

Until schema version 2 an author's fixed narrowing named a `filterDefinition`,
which made a permanent restriction depend on a viewer control existing —
delete the control and the block's meaning changed. A fixed filter now carries
its own characteristic and values and is independent of every viewer control.

**A reader can never widen past the author.** When both name the same
characteristic the two are intersected, so a block fixed to "renovaron" can be
narrowed to one generation of them and never opened up to everybody.

---

## 27. `Panel de filtros` — a first-class block

The twentieth block type, in a fifth group — **exploration**, beside the
comparison explorer. A block a reader *operates* is a different kind of thing
from a block a reader *reads*.

It behaves like every other block: it can be added to any page, moved,
duplicated, hidden, removed, and given a configurable width, a custom visible
title and an explanation. It can offer one or many controls, chosen from every
filterable characteristic the study's registry exposes, in an order the author
sets. It offers *Limpiar filtros*, shows the active selections, lays out inline,
stacked or in a grid, and several panels may coexist in one experience.

### What a panel moves

`filterPanel.target`, one of four:

| kind | what it resolves to |
| --- | --- |
| `experience` | every compatible block in the experience |
| `page` | every compatible block on the page the panel sits on |
| `sections` | the named sections, and the blocks that follow each one |
| `blocks` | exactly the blocks named |

The first two resolve **at render time**, so a block added later joins what the
panel already governs — which is what "every compatible block" has to mean if
the phrase is not to go quietly stale. The last two are **by id and stay by
id**: renaming a section or a block never changes what a panel moves, and an id
naming nothing is a hard validation error rather than a silently dropped
connection.

**Compatibility is declared, not special-cased** — and since §33 it is declared
by a capability rather than by one overloaded boolean. A block is a legal filter
target when its catalogue entry says `capabilities.supportsViewerFilters`, which
is a different question from whether it may HOST a control. KPIs, charts,
comparisons, findings, tables, journeys, the comparison explorer, qualitative
theme summaries and the theme cloud are targets; paragraphs, headings, the
approved team reading, the study's cover, the download action, the complete
inventory and the panel itself are not. A block type added later becomes a
target by declaring itself in the one table that already governs everything
else about it.

**A block responds when *either* an explicit `filterConnection` names it *or* a
panel hosting that filter resolves to it.** That union is computed in exactly
one place — `effectiveFilterTargets` in `src/lib/experience/filters.ts` — and
every surface that needs the answer calls it: the canvas, the block card, the
validator, the draft preview and the gates.

### Refusals and cleanup

- Connecting a block that shows no recomputable result is **refused with a
  sentence** naming the block and saying why.
- A panel does not filter itself or another panel.
- Removing a block a panel names drops it from that panel; a target emptied by
  the removal falls back to the panel's own page rather than to nothing, and
  the confirmation says what will be affected first.
- A panel offering nothing, or governing nothing, is a **soft warning** said
  next to the choice — never a blocked save. Both are states a person passes
  through while building one.

### How choices combine

Stated on the panel itself rather than left to be inferred:

> Si eliges varios valores de una misma característica, se suman. Si eliges
> características distintas, se combinan y el resultado es más específico.

**OR within one characteristic, AND across characteristics** — the behaviour
the deployed dashboard already has.

### The reader's state

Transient. It lives in the preview's own state, is mirrored into the address
bar so a view can be refreshed or sent to a colleague, and is **never written
anywhere**. It cannot mutate survey responses, calculations or the saved
definition; its whole effect is which rows an aggregate is computed over on one
request. The URL carries an opaque composer filter id and segment values the
study already prints as chart labels — no respondent, no answer, no metric key
— and the route it points at runs `requireInternal()` before it reads anything.

---

## 28. Suggestions are a template's, restrictions are nobody's

`src/lib/experience/template-suggestions.ts` holds two ordered lists of label
fragments — a journey-oriented reading and a findings-oriented one — and that
file is the **only** place a client's vocabulary is allowed to appear. The
composer's own gate refuses a client's name in `adapter.ts`, `registry.ts`,
`validate.ts`, `definition.ts` and every other generic module, and that is how
this rule is kept rather than remembered.

A suggestion decides which characteristics a **freshly adapted panel opens
with**, and their order. It decides nothing else:

- every filter-eligible characteristic in the study's registry is declared as a
  filter and offerable in the builder whether or not a suggestion named it;
- a study matching none of the fragments falls back to the characteristics it
  does have, so a school or a hospital study gets a working panel from a list
  written with a business network in mind;
- **age range is deliberately absent from both lists.** It remains available
  like every other characteristic and can be added in one click; it is not a
  default and is not restored as one.

---

## 29. A zero is a number, and missing configuration is not one

The builder showed `0 %` on satisfaction results, under a repeated paragraph
saying a semáforo needs a configured range. Both were defects, and the first
was the serious one.

**Every satisfaction result in the real study read 0.0 %, and none of them was
zero.** `DEFAULT_CSAT_MIN` is 9 — the Top-2-Box threshold for a **0–10** scale.
Every `csat_*` result in the BNI study is answered on a **1–5** scale, so
nothing ever cleared the threshold and the composer reported a confident,
wrong 0 % for all 55 of them.

`docs/CALCULATION_POLICY.md` §5 already says why that must not happen:
`satisfiedMin` is an **explicit input** precisely so one canonical function
serves both scales, and *"the scale is never guessed — configuration over
code"*. `docs/CALCULATION_CATALOG.md` §4 fixes the 1–5 rule as authoritative:
four and five are satisfied; one to three are not; both are in the denominator.

So the scale became configuration:

- the semantic registry carries `scale` and `topBoxMinimum` per result;
- the adapter reads the scale from the **study's own answers** and applies the
  documented threshold — 4 on a 1–5 scale, 9 on a 0–10 scale;
- a scale the catalogue does not document yields **no threshold**, the
  composer does not **offer** Top-2-Box for that result, and if a document asks
  for it anyway the engine returns `unsupported_aggregation` rather than a
  number. No formula is invented.

On BNI the 55 satisfaction results now read their real values — 78.6 %, 89.3 %,
82.1 %, 61.5 % and so on — computed by the canonical `csatTopBox` with the
threshold the catalogue documents.

> ⓘ **The client dashboard carried the same defect, and §35 fixes it.**
> `src/lib/dashboard/view.ts`, `src/lib/reporting/pdf.ts` and
> `src/lib/dashboard/longitudinal.ts` all called `computeStudyMetrics` without
> a `csatMin`, so the 0–10 default was in all three. The derivation now lives
> in `src/lib/calc/scale.ts` and every one of them reads it. It is the only
> client-facing change in this milestone, it is a calculation correction and
> nothing else, and `scripts/calculation-parity-test.mjs` is the evidence.

### The warning, once

A long paragraph printed inside every narrow card buried the numbers it was
about. The block now carries a short chip — *Falta configurar el rango* — and
the full explanation lives in the block's own card, where the person goes to
fix it.

### A canvas that can be read

A twelve-column grid squeezed into whatever space is left between two panels is
not a preview of a 1 280 px screen: four "full" columns became unreadable
strips. The canvas is now laid out **at the width of the breakpoint being
previewed** (1 120 for a computer, 720 for a tablet, 360 for a phone) and
**scrolls sideways inside its own box** when there is not room for it. The page
itself never scrolls sideways, which the acceptance matrix checks at every
width. A **scale** control (100 % / 75 % / 50 %) is for seeing the whole
arrangement at once; the scroll is for reading it at full size.

---

## 30. Schema version 2, and what happens to a draft written under version 1

`EXPERIENCE_SCHEMA_VERSION` is **2**. The strategy `migrate.ts` committed to
before there was anything to migrate is the strategy that ran: forward only,
one step per version, never in place, a published snapshot never migrated, an
unknown version refused by name, and every migration tested against a document
of the version it starts from.

`oneToTwo` makes three changes, and each is a **move rather than a loss**:

1. **The study's identity leaves Panorama.** The first page's first `cover`
   block gives its title and its paragraph to `identity`, and that block is
   **removed** — carrying it and leaving it would print the study's name twice.
   A cover block that is not the first one is left exactly where it is: a
   person put it there on purpose. The blocks that followed are renumbered so
   no gap is left where the cover was.
2. **`query.filterRefs` becomes `query.fixedFilters`.** Each reference is
   resolved through the document's own filter definitions and its default
   values become the fixed values. A reference that resolved to nothing, or to
   a filter with no defaults, restricted nothing under version 1 either, so it
   is dropped rather than invented.
3. **Every block gains `filterPanel: null`.** No version-1 block was a panel.

Nothing else is touched: pages, blocks, layout, connections, journeys, review
and publication survive byte for byte. **No database change was required** —
the definition is a `jsonb` column and the migration is in code, so migrations
`0023` and `0024` are unchanged and no new SQL is applied. Existing drafts open
without manual repair, which the gate proves against a version-1 document and
which was confirmed against the real saved BNI draft.

---

## 31. Recovering from a save that fails

| what happened | what the editor does |
| --- | --- |
| the document is invalid | refuses, says which rule, leaves the document and the session untouched |
| the server rejects it | shows the server's sentence beside the save chip; the next edit clears it and the autosave tries again |
| the network is gone | *No se pudo guardar*, one automatic retry after four seconds, then *Reintentar* and it waits for a person |
| somebody else saved first | *Hay una versión más nueva*; offers the stored version or a download of your own. Nothing is overwritten |
| the tab is closing with unsaved work | warns |

None of these is a full-page failure, and the gate drives all of them.

---

## 32. What has to happen before this may control the client dashboard

In order, and none of it is started:

1. **Publication.** Approve → snapshot → serve. `study_experience_revision`
   exists and is immutable; nothing writes it. It needs the approval basis
   (§ review) wired to the snapshot, an audit action, and a surface — and, by
   the rule P8.2 established, publication has exactly ONE surface, so it belongs
   with `/studio/e/[studyId]/publicar` rather than beside it.
2. **A per-study switch**, so `/insights/e/[studyId]` reads a published revision
   for a study that has one and the existing renderer for every study that does
   not. Moving a study is a deliberate act, one study at a time.
3. **A client-side renderer** for the definition, which is NOT the builder's
   canvas: it has no handles, no menus, no inspector, and it has to satisfy the
   client experience's own contracts — C11 (absence is not a finding) above all.
4. **The three missing drawings**, or a decision to drop them from the model.
5. **Import**, if a composed experience is ever to be moved between studies —
   which is also the foundation of templates.
6. **Two-editor behaviour beyond detection**, if the team ever works that way in
   practice. Detection is honest; merging is a product decision nobody has made.

Until 1 and 2 exist, the builder is an internal tool that changes what the team
can arrange and nothing about what a client receives. That is the honest
description of this milestone, and the gates enforce it.

---

## 33. What a filter can do to a block, declared

The selected-block card printed a heading — **Qué filtros lo mueven** —
followed by every filterable characteristic the study had, as checkboxes, on
almost every block. On a paragraph, on a heading, on the approved team reading,
on the study's cover and on the download-report button, that was thirteen tick
boxes that did nothing at all. Ticking one wrote a `filterConnection` naming a
block with no number in it, which no surface ever honoured.

The cause was one boolean answering two unrelated questions.

`BlockSpec.allowsFilters` meant both *"may this block host a reader's
controls?"* — which is `block.filterRefs`, the thing a page also does — and
*"does a reader's choice change what this block says?"* — which is
`filterConnections` and a panel's target. They have never been the same
question in this model, and collapsing them had two visible consequences: the
checklist above, and a hardcoded `block.type !== "filter_panel"` written into
the resolver, which is an inference in code about a fact the catalogue was the
right place to state.

### The capabilities

Each block type declares them, as data, in `src/lib/experience/blocks.ts`.

| capability | what it asserts |
| --- | --- |
| `consumesStudyData` | it reads an aggregate and recomputes when the row set narrows |
| `supportsViewerFilters` | a READER's filter changes what it shows |
| `supportsFixedFilters` | the AUTHOR may narrow it permanently, through `query.fixedFilters` |
| `supportsQualitativeFilters` | its evidence is the confirmed qualitative review |
| `supportsJourneyFilters` | its shape is a journey: ordered moments, one number each |
| `presentational` | words, rules, spacing, images, identity — it measures nothing |
| `actionableNonData` | it does something when operated and shows no aggregate |
| `hostsFilterControls` | it OFFERS a reader's controls, the way a page does |
| `filterableDimensionKinds` | the characteristic kinds it can honestly recompute under, or `null` for all |

**Nothing is inferred.** Not from a label, not from whether a block happens to
carry a query-shaped property, not from a list kept somewhere else. A block
type added later becomes a legal target by declaring itself.

### Who is eligible, and who is not

| eligible for a viewer filter | ineligible |
| --- | --- |
| `metric`, `chart`, `comparison`, `finding` | `rich_text`, `section`, `cover`, `image`, `divider`, `spacer` |
| `retention`, `journey` | `interpretation` — the approved team reading |
| `qualitative_themes`, `theme_cloud` | `report_download` — an action, not a result |
| `pivot_explorer` | `all_results_disclosure` — an inventory, not an aggregate |
| | `filter_panel` — it offers the controls; it is not moved by them |

**Hosting is byte-identical to what `allowsFilters` permitted.** Hosting was
not what was wrong; conflating it with responding was. Every type that could
offer a control before can offer one still, so no stored document became
invalid because the model learned to tell the two apart — and a gate asserts
that equivalence type by type.

**A dimension-kind restriction is declared only where one genuinely exists.**
A permanencia series already has period on its own axis; a recorrido and the
qualitative evidence are not one-answer-per-respondent-per-period shapes. A
control over a `period` characteristic would move nothing while appearing to,
so those four declare `segment` / `category` / `status` and the rest take
every kind.

### The declaration is true, not aspirational

Two things were declared and are now the case.

- **Connecting an ineligible block is refused, with a sentence** naming the
  block and the reason — in the block's card, in the panel's target list and in
  the operation itself, because a connection can arrive from any of the three.
- **"Lo que dijeron" and the theme cloud actually recompute.** They were
  declared filter targets and read a study-wide theme count that never moved.
  `resolveThemeData` narrows the confirmed observations through the people who
  said them and recomputes with `summarizeConfirmedQualitative` — the same
  function the client dashboard uses, so a builder preview and a client's
  screen cannot disagree about a theme's count. Only confirmed observations
  cross; `quote` is not selected by any caller and is not read.

### An older document is never stranded

A definition written before this, or edited by a hand that knew the
identifiers, can name a paragraph as a filter target.
`effectiveFilterTargets` does not honour it, so nothing lies on screen; the
validator reports it once as the soft warning `inert_connection`, naming the
block and the reason; and the document still saves. Refusing to save a draft
somebody already has would be worse than the inert reference.

---

## 34. The panel is the connection editor

The interaction is reversed, and the reason is one sentence: **choosing which
blocks a filter moves is one decision, and it was being asked once per block.**

**The panel's card is where it is made.** Its visible title and explanation,
which characteristics it offers and in what order, how the controls are laid
out, what it changes, and — when the scope is "solo los bloques que elija" —
exactly which ones. Compatible targets are the list; incompatible ones are
folded away under a heading that says they are not offered, each with its own
reason, so a person who wonders why they cannot tick the interpretation gets an
answer without the answer being in their way.

**A data-backed block's card carries a summary, not a registry.**

> **Este bloque responde a**
> "Explora los resultados": Antigüedad empresa, Generación
> *Ir al panel* · *Desconectar*

Two verbs, and the first one is one click from the place the decision actually
lives. Disconnecting from a panel whose scope is "exactly these blocks" removes
this one; disconnecting from a panel that governs the whole experience, the
whole page or chosen sections is **refused with a sentence saying where the
decision lives**, because those govern by position rather than by name, and
inventing a per-block exception list would make "every compatible block" mean
something different on every panel.

**A static block's card has no filter section at all.** Not an empty one, not a
disabled one, not an explanation of why: an absent control is the clearest
statement that there is no decision to make here. If conditional visibility for
static content is ever wanted, it is a separately named advanced feature and
not this.

### The four scopes, and what each resolves to

| | |
| --- | --- |
| **Toda la experiencia** | every compatible block in the experience, resolved at render time |
| **Página actual** | every compatible block on the panel's own page, resolved at render time |
| **Secciones seleccionadas** | the blocks under each chosen heading, by id |
| **Bloques seleccionados** | exactly the blocks named, by id |

The first two resolve dynamically, so a block added afterwards joins what the
panel already governs — which is what "every compatible block" has to mean if
the phrase is not to go quietly stale. The last two are by identifier and stay
by identifier, so renaming a section or a block never changes what a panel
moves. **Static blocks are excluded from all four automatically**, and the
panel says so under its own count.

Connections survive renaming a target and renaming the panel; removing a target
drops it from the panel and leaves no invalid identifier; removing the panel
takes its connections with it and the draft still saves. All three are driven
in a real browser by `npm run test:filter-ux-live`.

---

## 35. Collapsible panels, focus mode, and a canvas that reflows

> **Extended by §39.** Each panel now also carries a collapse rail on its own
> inner edge, the two sides are independent per side across a reload, and the
> rail is asserted to be ON THE SEAM rather than merely present — it was
> resolving against the viewport.

### Hiding a panel gives the canvas the room

A hidden `aside` inside an `[auto_…]` grid track left a zero-width column and
its gap behind, so hiding a panel gained the canvas a little space rather than
all of it. The template is now written from what is actually on screen, as four
complete literal class strings — assembling one at run time produces a class
the stylesheet does not contain, and the canvas would silently fail to reflow
with every gate still green.

Measured at 1 280 px on the gate's own fixture:

| | canvas width |
| --- | --- |
| both panels | 464 px |
| pages hidden | 768 px |
| inspector hidden | 800 px |
| **modo enfoque** | **1 104 px** |

### Modo enfoque

One act for one intention: hiding two panels one at a time and putting them
both back is four decisions. It keeps the editing toolbar on screen, offers
**Salir de modo enfoque** in words, and answers `Escape` — but only when there
is nothing nearer to leave, so an open drawer, an open dialog and a text field
all keep `Escape` first. A mode you can only leave by guessing a key is a trap.

**It hides; it does not forget.** Leaving restores exactly the panels that were
open before, because it never wrote to them. The selected page, the selected
block, the scale, the scroll position and anything half-typed are all in state
it does not touch.

### The chrome is not the document

Which panels are open, whether focus mode is on and how far the canvas is
scaled are preferences of a person at a screen. They live in `sessionStorage`
under one key, carry four fields, and carry nothing about what is being
composed. Toggling a panel cannot mint a revision, cannot mark the draft dirty
and cannot wake the autosave: `dirty` is derived from the document's signature
alone, and the live gate reads the save chip after a focus-mode round trip and
finds it unchanged.

It is read through `useSyncExternalStore`. Reading storage while rendering
breaks hydration; restoring it afterwards with `setState` in an effect is a
cascading render the project's own lint refuses. The server and the hydration
pass see the defaults — which is what the HTML was rendered with, so there is
nothing to mismatch — and the stored preference arrives in the same commit.

### The canvas measures the room it has

A `ResizeObserver` on the canvas frame feeds an **Ajustar al espacio** scale,
because the room is a function of which panels are open rather than of the
viewport, and only measuring answers that. The scaled drawing now occupies the
size it actually takes: `transform` does not change layout, so the previous
single box left the scroll container claiming the unscaled width and a stripe
of empty space below it.

**Scaling is a desktop affordance and is not the default.** At 40 % a 44 px
drag handle measures 18 px, and an 18 px target is not a target — so the canvas
opens at full size and pans inside its own box, the scale control is not
offered below 1 024 px, and a remembered scale is ignored there. What hiding a
panel buys is **less panning, not a smaller picture**. The page itself never
scrolls sideways at any width.

Drag and drop is unaffected by any scale: `getBoundingClientRect()` and a
pointer's `clientY` are in the same transformed viewport space, so the
comparison that decides a drop position never needs to know the scale. The gate
reorders a block with the keyboard alone while the canvas is drawn at 75 %.

### On a phone

The panels are drawers over the canvas rather than columns beside it, one at a
time, from ONE element with responsive classes — rendering the panel twice
would give the same controls two sets of identifiers. The canvas stays the
primary view, every control is at least 44 × 44, and nothing scrolls sideways
at 320, 360, 390, 768, 1 024 or 1 280.

---

## 36. The client's own Top-2-Box

`DEFAULT_CSAT_MIN` is 9 — the threshold for a **0–10** scale.
`src/lib/dashboard/view.ts`, `src/lib/reporting/pdf.ts` and
`src/lib/dashboard/longitudinal.ts` all called `computeStudyMetrics` with no
`csatMin` at all. For a study answered **1–5** nothing ever clears 9, so every
satisfaction result on the client's own screen, in the report they keep and in
the longitudinal series was a confident, wrong **0 %**.

§29 fixed this for the composer by deriving the scale in its own adapter, and
recorded the client path as deliberately unchanged. That was the defect stated
precisely: **one fact, derived twice, and only one of the two right.**

`src/lib/calc/scale.ts` is the single derivation now, and all four read it —
the composer's registry, the dashboard, the PDF and the series.
`docs/CALCULATION_POLICY.md` §5.1 is the authority; the short version:

- the scale is **read** from the study's own answers, never assumed;
- the threshold is **documented** — 4 on 1–5, 9 on 0–10 — and `null` for
  anything else;
- `null` means **do not compute it**: the result keeps its average and its
  Top-2-Box is omitted, because a missing Top-2-Box and a `0 %` are different
  statements and only one of them is true;
- the threshold comes from the **whole study** and the numbers from the
  selection, so a filter can never change which documented rule a result is
  measured against;
- an explicit `csatMin` still wins, so every caller that stated one keeps
  exactly the result it had.

**What did not change.** No stored response, no import, no rounding, no
average, and nothing about the client dashboard's layout, navigation or
publication state. This is a calculation correction and nothing else.

`npm run test:calc-parity` — 19 checks — builds a study with a 1–5 result, a
0–10 result and one on a scale nobody documented, computes the expected
Top-2-Box by hand, and asserts the engine, the dashboard, the PDF (read out of
the produced bytes, not out of its layout) and the series all agree with it and
with each other.

---

## 37. The gates the filter-UX milestone added

**Offline, inside `npm test`:**

```
npm run test:calc-parity            # 19 checks — one study, four surfaces, one number
npm run test:experience-composer    # 143 checks (was 140)
```

The composer gate gained: that every static and actionable block type is
ineligible by declaration and can say why in words; that every data-backed one
is eligible and declares that it reads study data; that connecting a filter to
a paragraph, the team reading, the download action or a panel is refused and
leaves the document untouched; that hiding a panel removes its grid track; that
focus mode hides both without forgetting either; that `Escape` belongs to an
open drawer and an open dialog before it belongs to focus mode; and that the
editor's chrome is read through `useSyncExternalStore` and can never reach the
reducer that owns the document.

**Live, inside `npm run gates:live`:**

```
npm run test:filter-ux-live         # 51 checks in a real browser
```

It composes a **disposable** study and drives all eighteen filter-panel
acceptance items on it — add a panel from the catalogue, retitle it, add,
remove and reorder its characteristics, set its scope, confirm the static
blocks show no filter section, apply a filter and watch a metric, a chart and a
comparison move while an unconnected block does not, combine two, clear them,
rename both ends, remove a target, remove the panel. Then it reads the **real**
study **without writing to it**: the recommendation result reads 30.8, "Más de
5 años" moves it to 41.4, "Generación X" to 33.3, clearing returns it to 30.8,
and the satisfaction percentages are not zero. Finally it asserts that the real
study's stored draft is at the same revision with the same `sha256` as before
the run, because a gate that demonstrates a filter by editing somebody's work
is not a gate.

It writes fifteen screenshots to `artifacts/filter-ux/`, with captions in
`captions.json`.

---

## 38. Schema version 3, and the one-step migration that reaches it

`EXPERIENCE_SCHEMA_VERSION` is **3**. `SUPPORTED_SCHEMA_VERSIONS` is `[1, 2, 3]`
and the runner still applies exactly one step per version, forward only, in
order — `oneToTwo`, then `twoToThree` — so a draft written under any supported
version opens under the current one without a prompt and without a rewrite.

`twoToThree` is **purely additive**. It gives a document the fields version 3
requires and nothing else:

| Added | To | Value |
| --- | --- | --- |
| `bandSchemes` | the document | `[]` — no study gains a standard it did not write |
| `bandSchemeId` | every block, journey and moment | `null` |
| `palette` | every visualization | `"auto"` |
| `themeCloud` | every `theme_cloud` block, and only those | the block defaults |
| `awareness` | every moment | `null` |
| `body`, `variant` | every moment | `null` |

It **drops** the half-configured `unawareMetricId` / `unawareLabel` pair rather
than completing it. A version-2 draft could name a result that measures "no lo
conocía" without naming which answers mean it, and version 3's `awareness`
requires both. Turning half a mapping into a whole one means the migration
would be inventing the missing half — and a percentage whose numerator the
migration chose is a number nobody can defend. The half that existed was never
rendered, so nothing visible is lost; what a person actually wrote stays exactly
as they wrote it, and the mapping is completed by a person or not at all.

**No SQL migration accompanies this.** The schema version is a property of a
JSON document stored in a `jsonb` column; the column, the table, the function
and every grant are unchanged. Writing a migration to record an
application-level version bump would create a database change to review, apply
and roll back for a change the database cannot see.

---

## 39. Two rails, and why the two sides are genuinely independent

Each panel carries a **collapse rail on its own inner edge** — the seam where
it meets the canvas. The rail is a 6 px guide with a real 24 × 44 `<button>` in
it: reachable by keyboard, focusable in order, announced by name. A double-click
on the guide does the same thing, as an accelerator for people who expect one
from an editor, never as the only way in.

**Each rail collapses ONE panel.** `onCollapse` for the left writes
`{ left: false }` and nothing else; the right writes `{ right: false }`. The
right panel's state is not read, not written, and cannot move as a side effect —
which is the whole difference between two independent controls and one control
with two labels. The four combinations are all reachable one rail at a time, all
remembered per side across a reload, and all photographed by the live gate.

**A panel that goes out leaves a way back on the edge it went out of.** The
restore tab gets its own strip rather than floating over the canvas card, and
each tab writes `focus: false` AND pins the other side to what is on screen
right now — so restoring the pages panel out of focus mode cannot drag the
inspector back with it.

**`lg:relative`, not `lg:static`.** Both lay a grid item out identically and
only one makes the panel a containing block. As `static`, the rail's
`-right-4` resolved against the viewport: it was drawn sixteen pixels off the
right edge of the window and pushed the whole page into a sideways scroll.
`test:milestone-live` asserts the rail is on the seam — `|rail − panel edge| ≤
24` — rather than merely that it renders, because a control that renders in the
wrong place passes every check that only asks whether it exists.

**The rail exists only where the panel is a column.** Below `lg` (left) and `xl`
(right) the panel is a drawer with its own opener and its own close button; a
6 px edge strip on a phone is a target nobody can hit. The gate asserts the
absence at every width below the docking width, not just the presence above it.

**The rail's control is 24 × 44, not 44 × 44**, and that is deliberate. It sits
in the 16 px seam between the panel and the canvas, where a 44 px target cannot
fit without covering one of the two things it sits between. WCAG 2.2's target
minimum is 24 × 24, and its equivalent-control exception applies exactly here:
the toolbar carries a full-size labelled button for the same act, present at
every width, never hidden by focus mode. The gate exempts `[data-rail-control]`
from its 44 px sweep by name, and separately asserts it is at least 24 × 24 —
an exception you can see, not a hole in the sweep.

---

## 40. Several recorridos in one study

A recorrido is a thing the **study** has, not a thing a page has, so it is
defined once in the left panel beside the pages and the identity — never on the
canvas. Up to eight per document, each with a stable minted id, a title, a
description, ordered momentos, its eligible metric families, a drawing variant
and an optional semáforo for all its momentos at once.

**A block is a WINDOW onto a recorrido**, and the distinction the product has to
keep straight is between two verbs that sound alike:

| Act | Result |
| --- | --- |
| Duplicate the **block** | a second window onto the SAME recorrido — editing a momento in one changes both |
| Duplicate the **recorrido** | a new recorrido with new ids, edited apart |

Blurring those two is how somebody's edit silently rewrites a page they were not
looking at. Both verbs are visible, both are labelled, and the inspector says
which one it is offering.

**Removing a recorrido that is still on a page is refused**, and the refusal
names the blocks and the pages that still show it rather than failing silently.

### "Quién no conocía este momento" is two answers, not one

It is a question about **reach**, not about dissatisfaction, and the two can
never be confused because they are computed from different halves of the same
column:

- **the numerator** is the people who answered with one of the exact values a
  person named as meaning "no lo conocía";
- **the denominator** is the people who ANSWERED at all;
- **a blank is in neither half.** Not knowing something existed and not
  answering the question are different facts.

Both halves are required together. A study that records a 0/100 column looks
like it is measuring awareness, and wiring it up on that resemblance is how a
product invents a finding — so `setMomentAwareness` refuses to store a mapping
with a result and no values, and the card says which half is missing while the
person fills in the other. The card holds the in-progress choice itself: the
store refusing half a mapping must not mean the second field never appears.

---

## 41. The semáforo: the consultant writes the standard, the product applies it

`src/lib/experience/bands.ts`. A `BandScheme` is an ordered list of bands, each
with a **name**, a **colour role**, a **shape**, a **meaning in words**, and
either numeric bounds (with explicit inclusivity at each edge) or a list of
category values. A document holds up to twelve schemes of up to eight bands.

**Nothing here is derived from the distribution.** No percentile, no tercile, no
"the bottom third". Every one of those is a property of who happened to answer
rather than of what good looks like, and a colour derived from one changes
meaning every time somebody new replies. A study with no configured scheme
therefore gets **no colour at all**: the block shows the number, uncoloured, and
says which decision is missing.

`schemeProblems()` names what is unfinished, by the exact value that breaks it:

- fewer than two bands;
- a band with no name, or no statement of what being in it means;
- a numeric scheme with no scale;
- **a gap** — "Entre 50 y 60 no hay ninguna banda: un resultado ahí no tendría
  color";
- **an overlap**, and the two boundary cases where a value belongs to both bands
  or to neither.

The gap and overlap check sorts **by lower bound**, not by list order, because a
semáforo is naturally authored best-first — verde, amarillo, rojo — which is
descending. A check that assumed list order was ascending would report no gap on
every scheme a person actually writes: a green light on a rule with a hole in it.

**Colour is never the only signal.** Every classified value carries the band's
colour, its SHAPE and its own words together. It is printed, photocopied, and
read by people who do not distinguish green from red.

### A semáforo as a filterable characteristic

`src/lib/experience/band-filters.ts`. When a scheme names the result it
classifies, it becomes an ordinary characteristic: the values are the band
labels in the order the scheme lists them, and a respondent's value is whichever
band their own answer falls in, written onto every row of that respondent and
onto nobody else's. An unclassified answer gets the empty string and is filtered
out rather than being put in the nearest band.

This is the only honest way to offer "Desempeño: Verde / Amarillo / Rojo" for a
study that records a score and no category — which is exactly the real study's
shape: `desempeño` is a number and the word "Verde" appears nowhere in it.

It is a property of the **document**, not of the study. Two drafts of one study
can hold different standards, and the study's own registry never changes because
somebody composed a page. `registryWithDerivedBands` is a pure function of the
document and the study registry, evaluated on the server for what is saved and
in the browser for what is being edited — one rule in two places, never two
rules. Saying which result a scheme classifies also creates the filter
definition for it in the same act, so a panel can offer it immediately; clearing
that choice removes the definition and prunes every reference to it.

---

## 42. The three remaining drawings

`heatmap`, `bubble` and `treemap` are drawn. They were previously declared and
then quietly substituted with a bar chart under the same title; `alternative` is
now `null` for all three and `rendererImplemented` is `true`, so the fallback
path cannot be reached for them at all.

| Drawing | Characteristics | Aggregations | Why |
| --- | --- | --- | --- |
| Mapa de calor | exactly 2 | any | a cell is one number about one crossing and claims nothing about summing |
| Burbujas | exactly 2 | count, sum, share, top-box | an AREA cannot be negative and has no zero point; an NPS and a promedio have neither |
| Rectángulos proporcionales | exactly 1 | count, sum, share | a rectangle's area is its share of a whole, so the parts have to add up |

**The heat map draws an empty cell and a withheld cell differently** — a dash
for "nobody answered", a dot for "too few answers to show" — because "nobody
answered" and "everybody answered badly" are opposite findings and neither of
them is the bottom of a colour scale. Intensity comes from each cell's OWN value
against the whole range, never interpolated between neighbours: a smooth
gradient across a grid invents readings between the ones that exist.

**The bubble field encodes the quantity as AREA, not radius.** A radius
proportional to the value overstates a big number by its square.

**The treemap is laid out deterministically** — slice-and-dice, no randomness
and no clock — so the same data always produces the same picture and a
screenshot in a report keeps agreeing with the screen.

All three read a **palette**, because a drawing that codes a quantity in colour
has a scale and somebody should choose it. `auto`, `mono`, `cool`, `warm`,
`diverging` and `categorical`; a rainbow suggests categories where there are
degrees, which is why it is a decision and not a default.

Each carries a `role="img"` with a sentence for a reader who cannot see it and
the same numbers as a real table, exactly as every other drawing does.

---

## 43. A thematic cloud that is a cloud

`src/lib/experience/theme-cloud.ts` plus the renderer in `Charts.tsx`. The
deployed visualization placed up to nine words at nine hardcoded positions and
printed each count beside it. This one is:

**Sized by a basis somebody chose, and it says which.** Mentions and people are
different counts of the same evidence — one person saying the same thing three
times is 3 and 1 — so the basis is stored per block, printed on the drawing, and
BOTH numbers are carried so the detail can show a widely-shared concern apart
from a strongly-held one. Whichever sizes the word, the base a disclosure rule
reads is always the number of **voices**.

**Merged by the review that already happened.** Two differently-worded
suggestions confirmed to the same theme are the same theme from then on, and
those raw spellings are the theme's aliases. `suggested_theme` is read for that
and nothing else; `quote` is not selected by any query on this path. A pending
theme, an unapproved quote and a respondent identifier are each unreachable from
a cloud, and the live gate plants one of each in the fixture to prove it.

**Read per source.** A block may read one qualitative source, so one page can
carry "lo que dijeron en la encuesta" beside "lo que dijeron en el focus group"
without either being a filter of the other.

**Deterministic.** Rotation is decided by POSITION, never by chance, and the two
largest words stay flat in every mode — the ones read first should not be the
ones a reader tilts their head for. A cloud that turned words at random would
redraw differently on every reload, so a screenshot in a report and the screen
would stop agreeing and no gate could assert a layout.

**Collision-free, and provably so.** Three separate ways this could fail are
closed: the reserved extent measures the text that will actually be DRAWN
(including the count, when the block writes it); the selection plate is drawn at
the reserved box rather than a few units outside it; and the candidate position
is rounded BEFORE the collision test, so the position that is checked is the
position that is drawn.

**It narrows the range before it drops a theme.** When the words do not fit, the
spread between the smallest and the largest is reduced in fixed deterministic
steps — never below the floor the block was configured with, because that floor
is the size somebody decided was readable. Dropping the smaller themes changes
what the reader is looking at; drawing them closer in size changes only how it
looks. A word that would be unplaceable when turned is drawn flat instead.
Past the point where even the floor will not fit, what did not fit is COUNTED
and stays in the reference list.

**Operable without a mouse.** Every word is focusable, named, and says whether
it is the selected one; Enter and Space select it. Selecting opens an aggregate
detail — counts, aliases, sources — and never a person or a sentence somebody
wrote. The ranked list is the reference, ordered by the same count that sizes
the words, so the picture and the list cannot disagree. The export serializes
the SVG that is on screen, so a filtered cloud exports the filtered cloud.

**The study's disclosure rule applies to a word exactly as it applies to a
number.** A theme is an aggregate over a base of voices, and a base of two under
a `hide_below` rule is two identifiable people whether it is rendered as a cell
or as a large word. A withheld theme loses its word AND its count together —
publishing "oculto, 2 personas" hides the number and announces the base — and
leaves nothing behind: no ghost word, no placeholder, no line in the list.

---

## 44. The gates this milestone adds

**Offline, inside `npm test`:**

```
npm run test:renderer-parity        # 15 checks — what the catalogue promises is what it draws
npm run test:experience-composer    # 168 checks (was 152)
```

`test:renderer-parity` exists because a catalogue and a renderer are two
different files that can disagree silently. It asserts that every variant
declaring `rendererImplemented` has a renderer, that no implemented variant
carries an `alternative`, that an unimplemented one says so out loud rather than
swapping in a different picture, and that the aggregations each drawing accepts
are the ones its geometry can honestly carry.

The composer gate gained the semáforo model (bands, gaps, overlaps, edge
inclusivity, the best-first ordering), the semáforo as a derived characteristic
(complete-only, per respondent, never from the distribution), and the cloud
(mentions versus people, aliases from the review's own fold, two sources on one
page, filtering and reset, determinism, collision-freedom, the fit rules, and
the fact that nothing pending or personal is reachable).

**Live, inside `npm run gates:live`:**

```
npm run test:milestone-live         # 57 checks in a real browser, 38 screenshots
```

It builds a document on a **disposable** study — thirty-six respondents dealt
into an uneven cross so a heat map has a range to shade and a cell the
disclosure rule withholds; forty confirmed observations shaped so mentions and
people genuinely differ; one deliberately unreviewed observation carrying a
quote, which must never appear — and then drives the whole milestone through it:
four panel states one rail at a time and across a reload, focus mode and
`Escape`, several recorridos with momentos and an awareness mapping completed in
two halves, a semáforo written wrong and then corrected, a block that wears it,
the same semáforo offered as a characteristic and narrowing a real number in the
reader's preview, the three drawings each asked for what it actually needs, and
two clouds reading two sources. Then it reopens the saved draft and checks every
recorrido and semáforo came back by name, sweeps six widths on the builder and
three on the preview, and finally asserts the **real** study's stored draft is
at the same revision with the same `sha256` as before the run.

Screenshots and captions land in `artifacts/milestone/`.

---

## 45. Publication — the five states, and where each one physically lives

This is the bridge § 32 listed and § 11 refused to build early. A composed
document now reaches a client, and the whole design is about making "what the
client has" and "what somebody is working on" two things that cannot be
confused.

| State | Where it lives | What moves it |
| --- | --- | --- |
| **Borrador** | `study_experience_draft`, one row per study | `save_study_experience_draft` — unchanged |
| **Revisión preparada** | one immutable row in `study_experience_revision` | `prepare_study_experience_revision` |
| **Publicada** | `study_experience_publication.active_revision_id` points at it | `publish_study_experience_revision` |
| **Sustituida** | nothing moves it — it is simply no longer the row the pointer names | a later event's `replaced_revision_id` records it |
| **Restaurada** | a NEW `study_experience_event` of kind `restored` | `restore_study_experience_revision` |

**Status is derived, never stored on the immutable row.** A `superseded` column
would have to be UPDATEd on a table whose entire purpose is that it is never
updated, and it would be wrong exactly once: the time somebody restores an older
revision without the code path that maintains it. `revisionState()` reads the
pointer and the event log, which cannot drift.

**A publication never stores a number.** A revision freezes the CONFIGURATION —
pages, blocks, queries by opaque handle, filters, journeys, band schemes, copy —
plus the canonical hash and two fingerprints. Every aggregate a client is shown
is computed at request time by the canonical engine over the study's own rows,
exactly as the legacy dashboard computes it. A published revision carrying
stored numbers would disagree with the data behind it the first time a
correction was imported, and nobody would be told.

### What a prepared revision carries

`definition_sha256` (SHA-256 over the canonical key-sorted bytes),
`source_draft_revision` (the exact draft it was frozen from),
`study_fingerprint` (the registry stamp, the disclosure rule and the category
grouping it was reviewed against), `acknowledged_warnings` with
`acknowledged_by` and `acknowledged_at`, `prepared_by`, `prepared_at` and an
optional 200-character internal note.

Two smaller shapes in that table are deliberate and worth knowing before
somebody "fixes" them. `study_experience_publication.active_event_id` carries no
foreign key: the event it names references the revision, and a key back the
other way would be a cycle that has to be created deferred and torn down in a
particular order for no benefit — the event is written first, in the same
transaction, so the value cannot dangle. And every foreign key on this path is
`on delete cascade` rather than `restrict`, because deleting a STUDY cascades to
its revisions and to the pointer at the same time and PostgreSQL does not
promise which it reaches first; a `restrict` would make a study undeletable at
random and break the disposable-fixture cleanup every live gate ends with. What
protects a published revision from removal is that no role holds DELETE on
`study_experience_revision`.

The FK CONSTRAINT names still read `..._published_by_fkey` after the column
rename — PostgreSQL renames the column, not the constraint. Nothing references
those names; correcting them would mean a second migration for cosmetics.

`published_by` / `published_at` were **renamed** to `prepared_by` /
`prepared_at` by migration 0025, on a table that had never held a row. The old
names assumed a revision is written at the moment it is published; it is not,
and the same revision can be published more than once, because that is what a
rollback is. A single `published_at` on the revision row could only ever record
one of several publications.

---

## 46. The three privileged writes, and what each one refuses

Every write is a `security definer` function with a pinned empty `search_path`.
`anon` and `authenticated` are denied outright on all four tables, `service_role`
holds SELECT and nothing else, and the body the two selection entry points share
— `select_study_experience_revision` — is executable by **nobody**, including
`service_role`. Verified against the linked project after applying:

```
assert_experience_publisher        postgres=X/postgres,service_role=X/postgres
prepare_study_experience_revision  postgres=X/postgres,service_role=X/postgres
publish_study_experience_revision  postgres=X/postgres,service_role=X/postgres
restore_study_experience_revision  postgres=X/postgres,service_role=X/postgres
select_study_experience_revision   postgres=X/postgres
```

**`prepare`** re-checks the internal role, derives the tenant from the study
row, refuses a document naming another study or client, refuses a preparation
whose caller reports a blocking finding, and — the part that makes a snapshot
provable — compares the document against the STORED DRAFT at the named revision
as `jsonb`, under `for update`. A prepared revision is therefore the draft it
claims to be even if every layer above the database were bypassed.

**`publish`** additionally refuses a stale snapshot (the draft has moved on or
its document changed), an acknowledgement that is not exactly the set the
revision recorded, a revision belonging to another study, and a pointer
somebody else has moved. Then it writes the event and moves the pointer in one
transaction. If anything fails, the client keeps being served what they were
being served.

**`restore`** is the same minus the staleness rule — a deliberate return to
something older is not stale — plus a required stated reason. It APPENDS an
event and never rewrites one. Nothing is deleted, and the revision it replaces
stays in the history and can be restored back.

**Idempotency is a unique index**, not a read-then-write with a window in it:
`(study_id, idempotency_key)`. The key is derived from the INTENT — which study,
which draft revision, which document, which acknowledged warnings for a
preparation; which study, which revision and what was active before it for a
selection. A browser's automatic retry carries the key its first attempt used
and finds that attempt's event; acknowledging one more warning is genuinely a
different act and gets a different key.

**A refusal is SQLSTATE `55000`.** The rule migration 0024 established holds
here: PostgREST retries `40001` until the gateway gives up, so a deliberate
refusal never reaches a browser. `42501` is an actor who may not do this,
`P0002` a thing that does not exist, `22023` a request this study cannot accept.

---

## 47. Blockers versus warnings, and why there is no "ignore everything"

The line is not severity.

A **BLOCKER** is something the published page would be lying about. An unknown
result. A chart that cannot represent what it was given. A semáforo colouring a
number against a standard nobody finished writing. A percentage whose numerator
was never chosen. A control the client can move that moves nothing. A cloud of
themes nobody approved. A cover promising a client name it does not have. A
schema the client renderer does not implement. A review whose draft has moved
on. **No acknowledgement can make any of those true**, so none can be
overridden, and the control that would prepare a revision is not drawn at all.

A **WARNING** is a judgement somebody is entitled to make: a hidden page, empty
explanatory copy, a result resting on four answers, a moment shown deliberately
without a number, a mobile-fallback recommendation, one panel moving a great
many blocks, something configured and never placed. Each is acknowledged **by
its own code**, with its own checkbox, and the exact set is stored on the
revision with who ticked it and when. Publication re-asserts that set in the
application AND in the database: agreeing to three warnings never authorizes
publishing a fourth.

There is deliberately no control that accepts them all. What gets stored has to
be which exact codes a named person agreed to; a blanket dismissal stores "they
clicked something", and becomes meaningless the moment the list changes.

### `not_rendered_for_client` — the milestone's stated limitation

Four block types render internally as a bordered DESCRIPTION of what the client
will get: the approved team reading, the complete-results inventory, the
comparison explorer and the report-download control. The client renderer does
not draw the thing itself.

The first published client screen printed those descriptions to the client,
including *"El cliente los ve plegados, para revisarlos si quiere."* — the
product talking about the reader, to the reader. There were three ways out and
one of them is honest: drawing the description is the product lying about
itself; drawing nothing silently loses work a consultant placed; so publication
REFUSES, names the block, and says what to do. The download is offered once,
from the identity layer, wired to the real authenticated report.

---

## 48. The review, and what a reviewer actually reads

`/studio/e/[studyId]/publicar` — still the ONE surface a study's client-facing
state changes on, with the composed experience beside the study's own
draft/published/archived controls rather than instead of them.

It keeps three things apart, each with its own card, its own words and its own
preview address, because confusing them is the failure this milestone exists to
prevent:

- **Borrador** — what is being built. Changes every save. Never seen.
- **Revisión preparada** — an immutable snapshot of one exact draft revision.
- **Publicada** — the revision the client is being served right now.

It shows the exact draft revision under review and when it was saved, its
canonical hash, what is published today and when, the pages and their visible
and hidden blocks, what each block shows and how it is drawn and which filters
move it, the filters and what each one moves, the recorridos and their moments,
the semáforos and whether each is complete, where the qualitative content comes
from, the disclosure rule, the identity, the configuration this build cannot
draw, and a **human-readable structural diff** against what the client has.

**No raw JSON is on that path.** `inventory.ts` describes an arrangement in
sentences and `diff.ts` says what changed in sentences; the technical export
stays where it was, internal and one deliberate click away.

`/publicar/revision/[revisionId]` renders one immutable revision through the
CLIENT'S OWN component, so what a reviewer judges is what a client receives
rather than a second drawing of it. Its banner names which of the three views it
is and links to the other two. A stale review is marked, cannot be published
from the screen, and is refused by the database independently.

`/publicar/historial` lists every revision with its hash, who prepared it and
when, every publication and restoration of it, what replaced it, the active and
superseded markers, a structural summary and a preview link. It pages, and it
compares any two revisions structurally. **Nothing on it can edit a revision** —
not because the markup omits a control, but because the table refuses an UPDATE
and no role holds the privilege.

---

## 49. The client renderer, and the per-study compatibility boundary

A study is served the composed experience when — and only when — it has an
**active published revision this build can read**. Every other study, which
before this milestone was every study, keeps the legacy dashboard byte for byte.
No study moves because a draft was saved, because a revision was prepared, or
because the composer gained a feature: moving one is a deliberate act on the
publication surface, one study at a time.

`/insights/e/[studyId]` and the internal client preview — which is one component
behind both `/admin/preview/[studyId]` and `/studio/e/[studyId]/vista-cliente` —
make the SAME selection through the same function, so the two cannot answer
differently.

**A published revision this build cannot read falls back to the legacy
dashboard**, not to an error page. The client keeps a working screen with real
numbers; the failure is named on the internal publication screen, because "we
could not read what we published" is not a sentence a client should ever meet.

**The numbers are the client's own.** Aggregates resolve over the rows
`loadAuthorizedStudyData` returned, already narrowed by the profile's
`data_scope`, and the registry is built from those same rows with the same pure
functions the internal path uses. A reader with a restricted scope is offered
filter values they have data for and no others.

**One privileged read, after RLS has already answered.**
`study_experience_revision` denies browser roles outright, so the definition is
read with the admin client — scoped by both the revision id and the study id —
only after the user's own session has proved through ordinary RLS that they may
see this study.

**A reader's selection is transient.** It is held in the page's state, mirrored
into the address so a view can be refreshed or shared, and never written
anywhere. The Server Action it goes to reads the active revision itself, so a
request cannot describe an arrangement nobody published.

### Contract C11, in two layers

`client-visibility.ts` decides which BLOCKS reach a client: one whose numbers
were never computed, one pointing at a result the study no longer has, one
nobody answered, and one the disclosure rule withholds entirely all render as
NOTHING — and the separators and section headings that would have framed the
hole go with them.

`Audience.tsx` is the second layer, and it exists because the first is not
enough. `BlockView` and `Charts.tsx` are honest for an internal reader in the
way an internal screen must be, and the first published client screen carried
three of their sentences: *"Este bloque todavía no tiene texto. Escríbelo en la
ficha del bloque"*, *"Falta configurar el rango"*, and the inventory's sentence
about the reader. A context — defaulting to `internal`, set to `client` by the
client renderer — lets the leaf renderers know who is reading. A prop would have
been a dozen places to forget.

**What is deliberately NOT silenced**: a caveat about a result the client IS
shown. A small base, a suppressed segment, a missing value behind a visible
number are analytical honesty, and hiding them would be the opposite failure.

---

## 50. Automatic fit, without taking the choice away

The canvas drew the previewed width at full size and panned when there was no
room. Right while somebody works on one block; wrong the moment an editor OPENS
with both panels showing on a 1 280 px screen, where a 1 120 px canvas in
roughly 700 px of room is a horizontal scroll of something whose shape nobody
can see, beside a scale control nothing told them was there.

A session that has not chosen a scale now gets `Ajustar al espacio` whenever the
previewed width does not fit, and full size whenever it does. The moment
somebody picks a scale — 100 % included — that choice is remembered for the
session and the automatic decision stops applying. The control shows what is IN
EFFECT and says when the editor chose it, because a select reading "100 %" over
a canvas drawn at 62 % is a control that lies.

It recalculates from MEASUREMENT: hiding a panel, restoring one, entering or
leaving focus mode and resizing all re-answer it, because the room a canvas has
depends on which panels are open and only measuring can tell.

**And it no longer costs a target.** `transform: scale()` shrinks the editor's
own controls with the drawing — at 0.4 a 44 px handle measured 18 px — so the
canvas publishes its scale as `--canvas-scale` and the block chrome sizes itself
as `44px / var(--canvas-scale)`: larger in canvas coordinates by exactly the
factor the transform shrinks it by, so what a pointer meets is 44 px at every
scale. Drag coordinates were already correct under scale and are untouched.
Nothing here writes to the document.

---

## 51. The gates this milestone adds

**Offline, credentials-free, inside `npm test`:**

```
npm run test:experience-publication   # 105 deterministic checks
```

It drives the pure modules rather than asserting that a comment says the right
thing: the canonical hash's stability under key order and its agreement with the
published SHA-256 of the empty string; idempotency keys that collapse a retry
and separate a different acknowledgement; every blocker rule firing and the ones
that are deliberately NOT blockers; the diff reporting by identifier and
ignoring bookkeeping; contract C11 by driving the predicate through every
outcome; migration 0025's STATEMENTS — a migration that explains what it does
not do would otherwise fail its own check for doing it; the absence of
`revalidatePath`; and the automatic fit's two conditions and its 44 px
compensation.

**Live, credential-bearing, inside `npm run gates:live`:**

```
npm run test:publication-live         # 50 checks in a real browser, 27 screenshots
```

It writes one disposable study inside the client fixture's own tenant — the
boundary cannot be driven from a tenant no client account belongs to — and
deletes it. **The real study is read only**, and its stored draft is asserted at
the same revision with the same `sha256` before and after the run.

The composition is written by the real editor and then enriched through
`save_study_experience_draft`, the only write path a draft has. What the gate
measures is everything after a draft exists: the legacy fallback, a blocker that
cannot be prepared past, warnings acknowledged one code at a time, the prepared
revision previewed through the client's own component, a draft moving on and the
review going stale, a fresh preparation, publication, the client's screen
switching, a draft edit that changes nothing for the client, the diff, the
history, the comparison, the rollback, and the client's screen after it — plus,
at the database, a retry that writes no second event, a lost pointer update, a
fabricated acknowledgement, a client-role publisher, a cross-study revision, and
an attempted UPDATE of a stored revision and of an event.

Screenshots and captions land in `artifacts/publication/` (gitignored).
