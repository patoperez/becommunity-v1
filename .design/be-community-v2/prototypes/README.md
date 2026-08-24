# P8 · Visual-direction comparison prototypes

Three disposable, standalone prototypes of the directions defined in
[`../VISUAL_DIRECTIONS.md`](../VISUAL_DIRECTIONS.md), plus **one provisional
synthesis** of them, built so the same product states can be compared side by
side before decision **D1** is made. **D1 is still open** — the synthesis is a
proposal rendered so it can be judged, not a decision that has been taken.

**These are not production code.** No framework, no build step, no npm package,
no CDN, no external font, no network request, no analytics, no storage, no
credential, no authenticated session. Every organisation, person, study, quote
and number is synthetic.

**Nothing here is approved.** The palette and type treatment in each direction
are a *proposed direction*, not a Be Community brand kit — none has been
supplied.

---

## How to view

```bash
cd .design/be-community-v2/prototypes && python -m http.server 8391 --bind 127.0.0.1
```

Then open <http://127.0.0.1:8391/index.html>.

The launcher lets you pick a direction, pick a surface, switch between desktop
and 375 px framing, open any prototype at full size, and read each direction's
thesis, strengths, risks and what to look at. It presents all four with
identical treatment in a fixed order; the synthesis carries a neutral
*Síntesis provisional* tag and no promotion. The reasoned recommendation lives
in this file, deliberately outside the comparison UI.

`file://` also works for the individual pages, but the launcher's preview frame
needs the local server.

---

## What is here

```
index.html                     comparison launcher
README.md                      this file
shared/reset.css               minimal reset — carries no design decisions
shared/launcher.css            launcher chrome only, deliberately neutral
shared/launcher.js             launcher behaviour + the direction notes
shared/fixture.json            THE shared content contract (see below)
shared/content-check.mjs       deterministic comparability + plain-language check
shared/capture.mjs             screenshot harness (exact viewport emulation)
informe-vivo/                  Direction A — style.css + entry/studio/story.html
mesa-de-trabajo/               Direction B — style.css + entry/studio/story.html
recorrido/                     Direction C — style.css + entry/studio/story.html
selected-informe-vivo-guiado/  Provisional synthesis — tokens.css + style.css
                               + entry/studio/story.html + capture-selected.mjs
screenshots/                   24 PNGs — final evidence only (18 + 6)
```

Each direction is **fully independent**: its own stylesheet, its own markup, its
own idiom. There is deliberately no shared component system. Repetition across
the three is intentional — it keeps the alternatives honest and lets any two of
them be deleted in one `rm -rf` once D1 is decided.

---

## The comparability contract

The comparison is only meaningful if no direction gets better information than
another. `shared/fixture.json` is the single source of truth for every string
and number the three must show, and `shared/content-check.mjs` enforces it:

```bash
node .design/be-community-v2/prototypes/shared/content-check.mjs
```

It checks five things:

1. **Shared content** — every string in `contentContract.entry` (11),
   `.studio` (30) and `.story` (63) appears as **visible text** in all **four**
   directions' corresponding page, the synthesis included. The contract was
   **not** weakened to let the synthesis pass; the synthesis passed it on its
   first run. Attribute values do not count, so a string
   hidden in a `title` or `aria-label` fails — which is precisely the defect the
   P8 audit found in the current product.
2. **Plain language (P8 contract C3)** — none of 23 implementation terms
   (`JSON`, `data_scope`, `metric_key`, `pivot`, `n=`, `CSAT`, `NPS`, raw status
   enums, …) appears as visible text in any of the 12 pages.
3. **Local assets** — every referenced stylesheet, script and frame resolves to
   a file on disk.
4. **No network** — no absolute `http(s)` URL appears in any direction page.
5. **Per-page basics** — `lang="es"`, a viewport meta and a skip link on all
   twelve pages.

**It deliberately does not compare pixels, DOMs, element counts, ordering or
markup shape.** The three directions are supposed to be structurally different;
only the visible semantic content is held constant.

The check earned its keep during the build: it caught Direction A carrying an
opening statement that B and C did not render, i.e. A framing the study better
than its rivals. Both were corrected before any screenshot was taken.

### The controlled values

| | |
|---|---|
| Responses | **20 personas respondieron este estudio** (never `n=20`) |
| Recomendación (NPS) | **20**, on a −100 to 100 scale |
| Satisfacción general | **50 %** |
| Satisfacción con docentes | **35 %** — the single out-of-ideal alert |
| Confianza | **7.5 de 10** |
| Agreed minimum | 60 % — the one threshold that produces the alert |
| Journey | 5 touchpoints: 78 / 64 / 52 / **35** / 61 %; only the 35 % one is deepened, with exactly 2 pain points |
| Comparison | Primaria 62 %, Secundaria 44 %, Preparatoria 39 %, plus one suppressed row |
| Themes | 3, ranked, with visible counts (9 / 6 / 4 comentarios) and one attached quote each |

---

## Surfaces

Each direction renders the same three surfaces.

**`entry.html`** — Be Community identity, a plain-language explanation of the
two-sided platform, email/password, the error state, the password-recovery
affordance and a help line.

**`studio.html`** — internal orientation: what needs attention, one import
stopped at step 2 of 3, the review state shown as *a workflow state and
explicitly not a permission*, team templates with their author, recent studies
with readable states, and a note that a study without a journey is presented as
a summary rather than an invented path.

**`story.html`** — the client's data story: human sample wording, the
consultant's reading as a visually distinct editorial layer, four results, one
out-of-ideal alert (no traffic lights elsewhere), the journey, one segment
comparison including a suppressed row, ranked qualitative themes with counts and
quotes, a word-cloud alternative offered as a secondary link rather than the
default, and free exploration present but placed after the story.

---

## Screenshots

24 PNGs in `screenshots/`. Full-page captures, light palette, device scale 1.

| | entry | studio | story |
|---|---|---|---|
| **informe-vivo** desktop 1440 | 959 px tall | 2716 | 4099 |
| **informe-vivo** mobile 375 | 1576 | 3238 | 4907 |
| **mesa-de-trabajo** desktop 1440 | 999 | 1620 | 2218 |
| **mesa-de-trabajo** mobile 375 | 1138 | 2617 | 3763 |
| **recorrido** desktop 1440 | 900 | 2201 | 2794 |
| **recorrido** mobile 375 | 1277 | 3035 | 4589 |
| **selected** (synthesis) desktop 1440 | 900 | **1691** | **2485** |
| **selected** (synthesis) mobile 375 | 1334 | **1994** | **3657** |

The six synthesis captures are named `selected--<surface>--<viewport>.png` and
are produced by `selected-informe-vivo-guiado/capture-selected.mjs`, which uses
the identical technique to `shared/capture.mjs`. There are two harnesses only
because this pass was allowed to write inside the synthesis folder and a short
allow-list that did not include the shared harness; **they should be
consolidated into one parameterised script in a later pass.**

Regenerate with the server running:

```bash
node .design/be-community-v2/prototypes/shared/capture.mjs
```

`capture.mjs` drives the DevTools Protocol with an **isolated, disposable Chrome
profile** in the OS temp dir, an **ephemeral debugging port** (`--remote-debugging-port=0`,
port read back from `DevToolsActivePort`), and
`--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1` so the pages provably
cannot reach the network while being captured. It has zero dependencies — Node's
built-in WebSocket only. No real browser profile is ever used.

It exists because `chrome --screenshot --window-size=375,…` **will not honour a
window narrower than roughly 400 px on Windows**: it lays the page out wider and
then crops the image to 375, which looks exactly like a horizontal-overflow bug
that is not there. The harness sets the viewport with
`Emulation.setDeviceMetricsOverride` instead, so 375 means 375, and it reports
`clientWidth` vs `scrollWidth` for every view — turning "does it clip?" into a
measurement rather than a judgement.

**Final run: 18/18 captured, no horizontal overflow in any view.**

---

## Type note — why these are system stacks

No external font may load: the product's CSP sets `font-src 'self'` and this
prototype makes no network request at all. The stacks below are **deliberate
local approximations, not the intended faces**, and **Arial is excluded from
every stack in all three directions**.

| Direction | Prototype stack | What a licensed, self-hosted face must deliver |
|---|---|---|
| **A · Informe Vivo** | `Iowan Old Style / Palatino Linotype / Georgia` for statements; `Segoe UI / Noto Sans` for interface | A statement serif with a large x-height, low stroke contrast, readable at 15 px, real italics and tabular lining figures — plus a humanist interface sans with open apertures, 5+ weights and tabular figures. The serif must never appear in a control or below the body step. |
| **B · Mesa de Trabajo** | `Segoe UI / Noto Sans` | One neutral grotesque with 6+ weights (300–800) doing all hierarchical work, true tabular lining figures, and ideally a narrow cut for dense tables. |
| **C · Recorrido** | `Segoe UI / Noto Sans` | A geometric-humanist sans with a genuine display cut for the focused value (very large, tight tracking, tabular figures) and a compact cut for peripheral route labels. |

In production these load through `next/font`, which self-hosts and therefore
satisfies `font-src 'self'`. **The CSP is not relaxed for a visual choice.**

---

## Design review

One review pass was run against the captured set, defects were corrected, and
the final set was captured once. Findings, in the order they were found:

### Must fix — fixed

1. **Comparison bars did not render at all in B and C.** `.bullet-track` /
   `.bullet-fill` (B) and `.seg-track` / `.seg-fill` (C) were `<span>`s with no
   `display`, so they stayed inline and `height` / `flex` never applied. Both
   comparisons showed an empty track with only the target tick. *Fixed:
   `display: block` on the track, fill and target marker.* This is the defect
   most worth remembering for P8.3 — a bar chart that silently renders nothing
   still looks like a chart.
2. **Horizontal overflow on `mesa-de-trabajo/story` at 375 px** — 470 px of
   content in a 375 px viewport. Grid items are `min-width: auto` by default, so
   the wide comparison table dragged its whole column past the viewport and
   `.table-scroll` never got the chance to scroll. *Fixed: `min-width: 0` on the
   grid children and on the panel/scroll chain.*
3. **Horizontal overflow on `informe-vivo/story` at 375 px** — 377 px, caused by
   the unbreakable header word *Respondieron* setting the table's min-content
   width. *Fixed: `table-layout: fixed` with an explicit `colgroup`.*

### Should fix — fixed

4. **B's side navigation stopped partway down the page**, leaving a grey gap
   beside the content on any page taller than the viewport. *Fixed: sticky,
   full-height at desktop.*
5. **B's context rail left a long empty right column** on the story page.
   *Fixed: sticky rail.*
6. **C's result cards separated the unit from its value** — the unit floated a
   full row below the number because both sat in a baseline-aligned grid keyed to
   the wrapping name. *Fixed: value and unit share one cell.*
7. **C's study table shouted the study names in uppercase** — row headers
   inherited the column-header `text-transform`. *Fixed: scoped to `thead th`.*
8. **C's Studio had no navigation at all** while A and B did. That is an unfair
   content difference rather than a design difference. *Fixed: C now carries the
   same four destinations, expressed as stops on its spine.*
9. **B's comparison table scrolls inside its container on mobile with no
   affordance.** The page correctly does not scroll sideways, but nothing told
   the reader the table did. *Fixed: a narrow-screen hint above the table.*
10. **A's `Respondieron` header broke mid-word** (`Respondi/eron`) once the table
    was constrained. *Fixed: `hyphens: auto` with `overflow-wrap: break-word` as
    the fallback.*
11. **The skip link peeked into the top-left of every capture** at
    `top: -3rem`. *Fixed: `-4.5rem`.*
12. **A's entry page was cramped** into the 44 rem reading measure, squeezing the
    form. *Fixed: the entry surface uses the wide measure; the story keeps the
    reading measure.*

### Verified, no change needed

- **No horizontal clipping** in any of the 18 views (measured, not eyeballed).
- **Same content everywhere** — enforced by `content-check.mjs`, not by
  inspection.
- **No technical vocabulary leaked** — all 23 forbidden terms absent from all
  nine pages.
- **Colour is never the only carrier.** Every state chip pairs a hue with a
  shape (`○ ◐ ◆ ● ▲`) and a word; the comparison bars pair colour with the
  numeric value, the position against a labelled target marker and a caption
  naming the threshold.
- **Touch targets** are ≥44 px on every control in all three directions
  (buttons, inputs, selects, nav links, disclosure summaries, route stops).
- **Focus** is visible everywhere: the shared reset sets a 3 px ring and each
  direction restates it in its own accent.
- **Reduced motion** — the shared reset neutralises every animation and
  transition under `prefers-reduced-motion: reduce`; no direction encodes
  meaning in motion alone.
- **Dark mode** is defined as its own palette in all three directions, not an
  inversion. The screenshots are light because that is the primary case; force
  the light palette in capture with `--blink-settings=preferredColorScheme=1`.
- **Line length** stays inside roughly 45–75 characters for reading text at both
  viewports.

### Known limitations of these prototypes

- Static. The only JavaScript is the launcher and a small disclosure toggle on
  each story page. Nothing loads, saves, validates or errors for real.
- Only three of the many surfaces in `../INFORMATION_ARCHITECTURE.md` are built,
  and each shows one representative state, not the full state matrix.
- Tenant brand colour is **hard-coded per direction**. The contrast resolver
  that P8.1 must build — which guarantees a readable foreground for any client
  hex, on screen and in the PDF — is *not* prototyped here. It should be
  prototyped separately against deliberately bad brand colours before P8.1.
- The screenshots are light-palette only. Dark mode is implemented but not
  captured.
- No tablet breakpoint was captured; the prompt asked for desktop and 375 px.

---

## The provisional synthesis — *Informe Vivo Guiado*

`selected-informe-vivo-guiado/` resolves the proven parts of A, B and C into one
system. It is **not a fourth style option and not a collage**, and it is **not an
approved decision**: D1 remains open.

### What was taken from where

| Aspect | Source | What it means here |
|---|---|---|
| Insights information architecture | **A** | Finding → the consultant's reading → evidence → exploration. The opening statement is a serif sentence, not a tile. |
| Studio hierarchy and density | **B** | Persistent stops, a breadcrumb naming the client and the date, a step ribbon, status as glyph + word, borders and affordances over decoration. One density step tighter than Insights. |
| Journey treatment | **C** | The route, with a result on every touchpoint and labels only where the work went deeper. Applied **only when the study has one** — Studio still shows the `Sin recorrido` block for the study that does not. |
| Entry | **C** framing, **A** spacing | The path spine explains the two sides; the editorial statement and the form share one frame, so it reads as a product entrance rather than a landing page beside a stray form. |
| Visual identity | **A + C** | Warm paper, ink, deep teal, amber/rust alert. **B's enterprise blue was deliberately not carried over.** |
| Component discipline | **B** | Clear borders, real progress, form hierarchy — without letting Insights become an administration console. |

One token file, `tokens.css`, serves both products: colour, type scale, spacing,
radius/border, elevation, motion and content measures. Studio and Insights differ
only in **density and chrome** (`.register-work` vs `.register-read`) — never in
palette, type family, radius, motion or state semantics. That is what makes them
read as one product family.

### The corrections it was built to resolve

| # | Required correction | How it was met | Evidence |
|---|---|---|---|
| 1 | A's story was 4 099 px desktop / 4 907 px mobile | Two-column reading layout with a sticky rail; a compact four-across evidence strip instead of four full-width rows; comparison and voices paired side by side; method and exploration behind disclosure | **2 485 px** desktop (−39 %), **3 657 px** mobile (−25 %) |
| 2 | The alert was repeated equally loudly | One primary alert block. Elsewhere a rust left border, a rust value and a quieter, differently worded marker — *Bajo el mínimo acordado* — plus *Profundizamos aquí* on the route | `selected--story--desktop.png` |
| 3 | Interpretation distinct, but not an error or a disclaimer | Teal top rule, a pencil badge, a name and a date. Authored and signed, not red and warned | same |
| 4 | Exploration secondary | Collapsed in the rail, after the authored story in reading order | same |
| 5 | Themes ranked with counts and quotes; cloud optional | Ranked 1–3 with visible counts and a pull quote each; *Ver como nube de palabras* as an explicit alternate view | same |
| 6 | Human sample wording | *20 personas respondieron este estudio* — `n=` appears nowhere | content check |
| 7 | No implementation vocabulary | 0 of 23 forbidden terms in any page | content check |
| 8 | Entry must be a product entrance | One framed entrance; the telling and the door in the same object | `selected--entry--desktop.png` |
| 9 | Studio mobile must not be an equal-weight stack | Priority order — attention, task in flight, review state — with templates, studies and clients collapsed into three compact rows | **1 994 px**, the shortest Studio mobile of the four |
| 10 | 44 px targets, focus, non-colour cues, reduced motion, `lang="es"`, contrast, no overflow | Verified — see below | content check + capture report |

### Where the length reduction came from, and what is collapsed

The reduction is **hierarchy and grouping first, disclosure second**. Nothing
required by the content contract was deleted: all 104 strings are still present
and the check proves it.

- **Two-column desktop reading layout.** A used a single 44 rem column inside a
  1 440 px viewport, wasting roughly 700 px horizontally while growing
  vertically.
- **Compact evidence strip.** Four measures as one row of four blocks on desktop,
  and as four short two-line rows on mobile, replacing four full-width bordered
  rows. Every label, value, unit and meaning is still rendered.
- **Comparison paired with voices** on desktop, so the taller of the two sets the
  height instead of the sum.
- **Collapsed by default on narrow screens only**: *Cómo se midió y cómo se lee*
  and *Explora por tu cuenta*. On Studio mobile: *Plantillas del equipo*,
  *Estudios recientes* and *Clientes*. Everything else is open at every width.

The capture harness prints how many disclosures are open per view, so the share
of the reduction that comes from collapsing is visible rather than implied:
Studio mobile reports `0/3 disclosures open`, Studio desktop `3/3`.

**Honest caveat.** The content check strips tags, so it counts collapsed text as
present. That is correct for a semantic-parity check, but it means the check
alone cannot tell you whether something is readable *without a click*. The list
above is the human record of what sits behind one, and it is deliberately short
and secondary.

### Design review of the six synthesis screenshots

One review pass, then one final capture. Fixed:

1. **The comparison bars did not render on desktop.** At ≥48 rem the track, value
   and base carried an explicit grid *column* but an automatic *row*, so sparse
   auto-placement pushed them onto rows 2 and 3: the bars vanished and
   *8 personas* spilled into the neighbouring voices column. Fixing the rows
   exposed the real constraint — a four-column row cannot fit the ~300 px column
   the comparison gets when paired — so the comparison was rebuilt as one compact
   two-row form that holds at 300 px and at 375 px alike. *This is the same
   inline-span/placement family of bug that hid the bars in B and C; it is worth
   an explicit test in P8.3.*
2. **Studio's four navigation stops wrapped to a second row** on a 375 px screen,
   orphaning *Plantillas*. Tighter horizontal padding below 30 rem fits all four
   on one line.
3. **Stacked actions had ragged widths** in the mobile panel footers. They now
   share a width below 30 rem.
4. **The word-cloud link was a 22 px target.** A link that stands alone is a
   control, not prose: it now has a 44 px height.

Verified and unchanged: no horizontal overflow at either viewport; all 104
contract strings present; 0 forbidden terms; every state carries a glyph and a
word as well as a hue; focus rings visible on every control; reduced motion
honoured through the shared reset; `lang="es"` on all three pages.

### Known gaps in the synthesis

- **The brand contrast resolver is still not prototyped.** The teal here is a
  fixed value. The mechanism that guarantees a readable foreground for any
  tenant hex — on screen and in the PDF — remains P8.1 work and should be
  prototyped against deliberately bad colours before implementation.
- **Only three surfaces, one state each.** The full state matrix in
  `../INFORMATION_ARCHITECTURE.md` is not built.
- **Dark mode is defined in `tokens.css` but not captured.** The screenshots are
  light-palette only.
- **No tablet capture.** Desktop and 375 px only, as scoped.
- **Two capture harnesses exist** (`shared/capture.mjs` and
  `selected-informe-vivo-guiado/capture-selected.mjs`) for write-boundary reasons.
  Consolidate them later.

---

## Recommendation after visual review

Seeing the three rendered did not change the recommendation in
`VISUAL_DIRECTIONS.md` §5, and it sharpened the reasons:

**A · Informe Vivo as the system, with B's shell discipline governing Studio and
C's route treatment confined to the journey view.**

What the screenshots actually showed:

- **A** is the only one where the finding arrives before the evidence without
  being told to. On `informe-vivo/story` the statement occupies the top of the
  page and the numbers argue for it underneath. It is also the longest page of
  the three by a wide margin (4099 px desktop, 4907 px mobile against B's 2218 /
  3763), which is the honest cost: it asks for scrolling and for good writing.
- **B** is decisively the best Studio. `mesa-de-trabajo/studio` answers "where am
  I, whose data is this, what do I do next" faster than either rival, and it is
  the most compact page in the set. Its story page is competent and legible — and
  reads as a well-organised console, which is the thing the product exists to
  stop being.
- **C** produces the single most striking view in the whole comparison — the
  horizontal route on `recorrido/story` at desktop — and the weakest structural
  answer for everything that is not a touchpoint. Its own honesty block ("Sin
  recorrido") is the proof: the direction survives a journey-less study only by
  announcing that it cannot draw one.

**This is a recommendation, not a decision.** D1 is the user's and the CEO's to
make, and it should be made by looking at the launcher, not by reading this
paragraph.

### After building the synthesis

Building it changed two things worth recording:

- **The height problem was a layout problem, not a content problem.** A's story
  lost 39 % of its desktop height with every required string still on the page.
  The cost of A's narrative was never the narrative.
- **B's contribution turned out to be structural, not visual.** Its navigation,
  breadcrumb, step ribbon and status discipline all survived into the synthesis.
  Its blue did not, and nothing was lost with it.

**This is still a recommendation.** D1 is the user's and the CEO's decision, and
it should be made from the launcher — comparing S against A, B and C on the same
three surfaces — not from this paragraph.
