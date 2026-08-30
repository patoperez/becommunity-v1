# The Experience Composer — the dashboard builder

> Standing architecture reference for the governed data-experience builder.
> Status on 2026-08-30: **persistent, first production slice**. The model, the
> schema, the registries, the compatibility adapter, the storage, the Server
> Actions, fifteen renderers and one internal builder route exist. Drafts are
> saved and reload. **Nothing is published**, no client-facing route reads a
> composed definition, and the deployed client experience is unchanged.
>
> Sections 1–10 describe the model, which the foundation established and this
> slice did not change. Sections 11 onwards describe what was built on it.

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
npm run test:experience-composer     # 123 deterministic checks
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

**Live, credential-bearing, inside `npm run gates:live`:**

```
npm run test:experience-persistence-live   # 23 checks against the real database
npm run test:experience-builder-live       # 20 checks driving a real browser
```

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

Written for the person judging it. **There is no deployed version and there must
not be one yet.** Evaluate it against the application running on your machine.

```
npm run build && npm start
```

Then sign in with your ordinary internal account at `http://localhost:3000`.

### Finding the study

Studio → **Estudios** → **La voz de las y los Nets de Cuicuilco** (client: BNI
Cuicuilco). The builder is deliberately not one of the tabs in the study's
process row; open it by its address:

```
/studio/e/<id del estudio>/construccion
```

### What to try, in the order that answers the most

1. **Read the chip at the top left.** It says *Sin guardar todavía* the first
   time. Nothing was created by opening the page.
2. **Look at the numbers.** They are the study's own, through the same engine
   as the client's panel. The recommendation result reads **30.8** over 39
   answers. Nothing on this screen is a placeholder.
3. **Click a block.** The card on the right says where its number comes from,
   how it is calculated, which characteristic breaks it down, which filters move
   it, which disclosure rule applies, and how wide it is on each screen.
4. **Change its visible title.** Watch the canvas follow, check the cursor never
   jumps — and watch the chip go *Guardando…* then *Guardado · versión 1*.
5. **Reload the page.** Your change is still there. This is the sentence the
   whole milestone is about.
6. **Drag a block by its handle** (the ⠿ on the left of its header). Then put
   the focus on a handle and press ↑ or ↓ — the same move, no pointer.
7. **Open the ⋯ menu** on a block: duplicar, ocultar, subir, bajar, quitar.
   Quitar asks first and says what it will take with it.
8. **Add a page**, rename it, duplicate it, move it, then remove it. Everything
   is saved as you go.
9. **Change a block's result** and its **desglose** in its card. Try to make a
   pastel out of a promedio: the panel at the bottom turns red and says the
   slices would not add up to the total. Change the calculation to *cantidad de
   respuestas* and it goes green.
10. **Change the disclosure rule** on the left, then give ONE block its own rule
    in its card. Watch the canvas redraw. This is the decision that matters
    most: whether a study of eleven people can see its own eleven answers.
11. **Switch the width** at the top between computer, tablet and phone.
12. **Make the window narrow** (or open it on your phone on the LAN). The panels
    become drawers; you can still read, select, hide and reorder; the width
    sliders are gone, because a twelve-column grid is not editable through a
    320 px viewport.
13. **Open the same study in a second tab**, change something there, save, then
    change something in the first tab. The first tab says *Hay una versión más
    nueva* and offers you the stored version or a download of your own. Nothing
    is overwritten.
14. **Press "Descargar"** and open the file. Names, layout, words. No metric
    key, no answer, nobody's data.
15. **Open the client's view** (`Vista del cliente`, and `/insights/e/<id>` as a
    client account). It is exactly what it was before you started. Nothing you
    did here has reached a client, and nothing can until publication exists.

### What is deliberately not there

- **Publication.** Nothing you build here reaches a client in this milestone.
- **Three drawings**: mapa de calor, burbujas, rectángulos proporcionales. Each
  says so where you choose it and where it would be drawn.
- **Import.** Export exists; loading a file back does not, because doing it
  safely needs its own design.
- **Two people editing at once, live.** The second one is *detected*, not merged.

---

## 22. What has to happen before this may control the client dashboard

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
