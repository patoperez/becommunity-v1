# The Experience Composer — foundation

> Standing architecture reference for the governed data-experience builder.
> Status on 2026-08-29: **foundation slice, reviewed and made evaluable**. The
> model, the schema, the registries, the compatibility adapter and one internal
> prototype route exist. Nothing is persisted, nothing is published, nothing is
> deployed, and no part of the deployed client experience has been replaced.
>
> The acceptance pass that followed the foundation is recorded in §16. It fixed
> defects rather than adding scope, and reclassified two of the adapter's four
> "cannot carry" warnings as defects in this model and in the adapter.

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
│       ├── type             one of 18 (§6)
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
- **This slice removes the legacy minimum-five behaviour from no current route.**
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

Eighteen block types — `cover`, `section`, `rich_text`, `finding`, `metric`,
`chart`, `comparison`, `retention`, `journey`, `qualitative_themes`,
`theme_cloud`, `interpretation`, `recommendation`, `image`, `divider`, `spacer`,
`report_download`, `all_results_disclosure` — grouped as structure / evidence /
narrative / action, which is the split that keeps a composed page from becoming
a wall of charts.

Eighteen chart variants — KPI, horizontal / vertical / grouped / stacked /
100 % stacked bar, line, area, pie, donut, table, heatmap, bubble, treemap,
traffic light, retention series, journey, theme cloud.

**This slice implements the contracts, the compatibility registry, the human
labels and the validation — not eighteen renderers.** Each variant declares
honestly whether a renderer exists and, when it does not, which existing
representation stands in for it. Compatibility is the intersection of what the
result allows, what the variant needs and what the query supplies — data, not
`if` statements scattered through the UI.

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

**The deployed component is not replaced in this slice**, and no AI grouping is
added: themes are grouped by the human category review, which already records
who decided what.

---

## 11. Review and publication — modelled, not persisted

Draft definition, revision number, author, reviewer, publisher, review status,
change summary, approval invalidation reasons, published snapshot reference,
schema version, registry version, data revision, and a frozen sample-policy
snapshot.

The rule matters more than the schema. "Approved" is not a property of a
document; it is a statement that a named person looked at *this* arrangement,
built on *these* results, under *this* disclosure policy, over *this* data.
`approvalInvalidations()` compares the two and returns which of them moved —
a list, not a boolean, so a reviewer asked to look again is told why.

Nothing here is stored by this slice. There is no table, no migration and no
Server Action behind any of it.

---

## 12. Compatibility

`src/lib/experience/adapter.ts` reads a study's existing configuration and
produces a valid `ExperienceDefinitionV1`. It is a **pure function**: no
database import, no write, no mutation of its input, byte-identical output for
identical input. Golden fixtures in the gate demonstrate that the current client
experience — panorama, featured results, findings, comparison, the complete
results disclosure, the report download, the recorrido, the retention series,
the confirmed themes, the theme cloud and the team's reading — is representable
across five pages and eleven block kinds, with the legacy suppression rule
preserved, without changing a calculation or a piece of visible evidence.

What it cannot yet carry it **says**, as internal warnings. The acceptance pass
examined each of the four the first run produced and found that only two were
limitations:

| Reported | What it actually was | What happens now |
| --- | --- | --- |
| The pivot explorer | A genuine model gap. V1 has no equivalent block. | Still reported, and shown in the prototype. |
| A configured threshold alert | A **modelling defect**: `comparison` held one number where the product ships a labelled range. | The query carries the range; the adapter puts it on the block that shows that result. Reported only when no block shows it. |
| A characteristic with 72 values | An **adapter defect**: a chart's legibility ceiling applied to a filter control. | Offered as a filter, as the deployed dashboard offers it. Reported only above `filterOptions`. |
| A recorrido moment with no result | **Invalid legacy configuration**, not a model limitation. | The moment is kept, visible, without a number; the warning names it. The study's own data is never repaired from this screen. |

Warnings are internal. They are for the team building the composer, never for a
client, and the prototype shows them under a heading that says so.

### Migration stages (none of them started)

1. **Foundation — done.** Model, schema, registries, adapter, prototype, gate.
2. **Persistence.** A table, a migration, Server Actions, draft/approve/publish,
   snapshots. Requires its own design and authorization review.
3. **Renderers.** The chart variants that currently declare a fallback.
4. **Client rendering.** Serve `/insights/e/[studyId]` from a published
   definition, behind a per-study switch, with the existing renderer as the
   default until each study is deliberately moved.
5. **Templates.** Composed experiences saved and instantiated, which is where a
   particular client's configuration becomes a starting template.

---

## 13. The internal prototype

`/studio/e/[studyId]/construccion` — **"Construcción del dashboard — prototipo
interno"**.

- Runs `requireInternal()` **first**, before any read: session revalidated with
  `getUser()`, role read from the database, client-role callers redirected to
  `/dashboard`, privileged client created only after the check passes.
- Loads one real study, read-only, and puts it through the adapter.
- **Saves nothing.** No autosave, no Server Action, no draft, no publication,
  no `fetch`. Every edit is a pure function in `prototype.ts` held in local
  component state; reloading restores the study's real configuration.
- Does not alter `/studio/e/[studyId]/vista-cliente` or `/insights/e/[studyId]`,
  and no client-facing route imports anything from `src/lib/experience/**`.

**It is arranged the way the real builder will be:** pages and the block
catalogue on the left, the composition in the middle, the selected block's
properties on the right, and the prototype's status, reset, export and width
preview across the top. Below `lg` the three columns become one, in reading
order. There is no drag and drop and no package was added for one.

**It can:** open the adapted pages one at a time; draw the current page at the
desktop, tablet or phone placement, on the same twelve-column grid the model
declares; select a block; edit its visible title without losing focus or caret;
hide, show, duplicate, remove and reorder it; add a block from the typed
catalogue; change a block's visualization, with the choices grouped into the
ones the result can honestly become and the ones it cannot; set the study-wide
disclosure rule and a per-block override; inspect the block's result,
characteristics, connected filters, effective rule and per-breakpoint width in
human words; show schema errors, soft warnings and the adapter's own notes;
reset to the study's real configuration; and download the definition as readable
JSON. Raw JSON is never displayed in the ordinary interface, and no technical
key is ever a primary label.

**What the middle column does NOT show is the study's numbers.** This slice
reads no aggregation, so every result frame says the prototype carries no
numbers rather than inventing one. A variant whose renderer does not exist yet
says so and shows the stand-in the registry declares, in the block and in the
properties panel.

**Every refusal is a sentence.** An operation that declines — a page already at
its ceiling, a drawing the block type does not allow, a block that is already
first — returns the state unchanged with a reason, and the screen announces it
in a polite live region. Editing continues; nothing here is a dead end.

**It cannot, by design:** persist, autosave, drag and drop, migrate, publish, or
render every chart variant.

---

## 14. Security boundaries that remain mandatory

Nothing in the composer relaxes any of these, and nothing in a definition can
reach them:

- RLS on every public table, FORCE RLS, no exceptions.
- Server-side authorization on every route and mutation; `getUser()`, never
  `getSession()`.
- Tenant isolation, verified adversarially.
- Least privilege at the database; client-role users read-only.
- Zod at every untrusted boundary, reject by default.
- User-generated qualitative content only through escaped React text nodes; no
  `dangerouslySetInnerHTML`.
- Only human-confirmed themes and independently approved quotes cross the
  publication boundary.
- Absence is not a client-facing finding (contract C11).
- Canonical calculations unchanged; rounding governed by
  `docs/CALCULATION_POLICY.md`.

---

## 15. Gate

`npm run test:experience-composer` — 95 deterministic, credentials-free checks
covering the strict boundary, opaque and stable identifiers, every ceiling,
injection refusal, the three sample-policy modes and the legacy equivalence at
every base from 0 to 60, block overrides, hard-versus-soft validation, explicit
filter connections, multiple journeys and family eligibility, adapter purity and
determinism, layout non-overlap at all three widths, review invalidation, schema
migration, the prototype's server-side authorization and write-freedom, and its
keyboard operability and accessible naming. It runs inside `npm test`.

Section 17 pins the acceptance pass: that a study whose only characteristic is
unreadably wide never produces a block that breaks on it; that the catalogue and
the factory agree about what is possible whatever the study looks like; that
removing a block neither orphans a filter reference nor deletes a filter
something still narrows by; that an emptied connection does not survive; that a
duplicate inherits neither a connection nor a hosted control and obeys the same
ceilings as adding; that every refused action says why, changes nothing and
leaves the prototype editable; that a per-block disclosure rule overrides the
study's; that a drawing with no query behind it is still told what it costs; and
that the ideal range is bounded, ordered and exclusive to the comparison that
owns it.

---

## 16. The acceptance pass — what the review found

The foundation was reviewed module by module before the owner was asked to judge
it. Eleven concrete defects were fixed; no feature area was added.

**In the model.** `comparison` could not express a labelled ideal range (§5).

**In the defaults.** `firstDimension` fell back past the legibility ceiling to
whatever the registry listed first, so a study whose widest characteristic came
first produced a block that failed `cardinality_ceiling` the moment it was
validated — while `canAddBlock` reported the type as offerable. The menu and the
factory disagreed about what was possible, which is the one thing the probe
exists to prevent. `newBlock` also chose its drawing before resolving the
characteristic, so a metric-driven fallback could land on a variant needing two
characteristics when the query had one.

**In the prototype operations.** Removing a block computed "is this filter still
hosted?" from block controls alone, ignoring a query's author-fixed narrowings,
a page and a journey — so a filter could be deleted while another block's query
still named it. A connection emptied of its last block survived as a statement
about blocks that no longer existed. Duplicating ignored the block ceilings that
bound adding, and copied the source's hosted filter controls, so two blocks
presented the same control. Every operation that declined returned its input
silently.

**In validation.** The renderer and mobile-fit warnings lived inside the query
check, so the four block kinds that carry a drawing and no query — the
recorrido, the confirmed themes, the theme cloud and the complete results table
— could be switched to a variant with no renderer and nothing was said.

**In the adapter.** A chart's legibility ceiling was applied to a filter control
(§7, §12).

**In the interface.** `compatibleVariants` and `renderableVariant` existed and
were never called, so the composer offered drawings a result cannot become
without saying so and never showed a fallback; the per-block disclosure override
was implemented and unreachable; the export revoked its object URL in the same
tick as the click that used it; and a `finding` — which may read a result — was
described as a block that does not.

---

## 17. How to evaluate the prototype

Written for the person judging the model, not for the person who built it.

### Where it runs

There is **no deployed version of this and there must not be one yet**. The
prototype is not on the Worker, the Worker's live version is untouched, and the
branch is not merged. Evaluate it against the application running on your own
machine.

```
npm run dev
```

Then sign in with your ordinary internal account at `http://localhost:3000`.

### Finding the study

Studio, then **Estudios**, then **La voz de las y los Nets de Cuicuilco**
(client: BNI Cuicuilco). The prototype is deliberately **not** one of the tabs
in the study's process row — a step that saves nothing would misdescribe the
process — so open it by its address:

```
/studio/e/<id del estudio>/construccion
```

The id is the long code already in the address bar once the study is open.

### What to try, in the order that answers the most

1. **Read the yellow banner first.** It says the screen saves nothing and that
   the client never sees it. Both are true; step 12 proves it.
2. **Move between the five pages** on the left. The middle column is that page.
3. **Click a block.** The right-hand panel says where its number comes from,
   which characteristic breaks it down, which filters move it, which disclosure
   rule applies to it, and how wide it is on each of the three screens.
4. **Change its visible title.** Watch the composition follow along, and check
   that the cursor never jumps.
5. **Hide it, show it, duplicate it, remove the copy, move it up and down.**
   Ask whether that is how you would want to rearrange a client's page.
6. **Add a block** from the catalogue on the left. Only the kinds this study can
   actually sustain are offered.
7. **Change how a block is drawn.** The list is split into what the result can
   honestly become and what it cannot. Pick something from the second group on
   purpose: the panel at the bottom turns red and says what would stop it being
   saved. Change it back and carry on — that is the point.
8. **Switch the width at the top** between computer, tablet and phone, and watch
   the composition rearrange.
9. **Change the disclosure rule** on the left, between showing everything,
   showing with a warning, and hiding. Then give **one block its own rule** in
   the right-hand panel. This is the decision that matters most: it is the rule
   that decides whether a study of eleven people can see its own eleven answers.
10. **Read the notes at the bottom.** "Avisos que no impiden nada" are things
    you may publish anyway. "Lo que el modelo todavía no sabe representar" is
    the honest list of what this model cannot yet carry from this study.
11. **Press "Descargar esta versión"** if you want to keep what you arranged.
12. **Reload the page.** Everything you did disappears and the study's real
    configuration comes back. Nothing was ever written.

### What is deliberately fake

- **There are no numbers.** Every result frame shows a dash. This slice reads no
  calculation, and a preview with numbers in it would be a preview with invented
  numbers in it.
- **Several drawings have no renderer yet.** Where that is true the block says
  so and shows the stand-in the model declares — a traffic light appears as
  horizontal bars, for instance. Judge the *choice*, not the picture.
- **Nothing is saved, published, or sent anywhere.** No draft, no snapshot, no
  autosave. The study's configuration, its data, its publication state and the
  client's view are all untouched.
- **The client cannot reach this screen.** A client-role account that opens the
  address is sent to its own dashboard by the server, not by the interface.

### What to write down

- Is **page → block → property** how you actually think about a client's study?
- Is the **left / middle / right** arrangement the one you want to work in?
- Which **block kinds are missing**, and which of the eighteen are noise?
- Is the **disclosure rule** in the right place, and is per-block the right
  granularity?
- Is **"a filter moves a block only when somebody says so"** right, or should
  sharing a characteristic be enough?
- What would you need before you would trust this with a real client's page?
