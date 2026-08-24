# Visual & Experience Directions — Be Community V2

> Three materially different, feasible directions for Studio and Insights.
> They differ in composition, information rhythm, colour and type, motion
> philosophy, storytelling model and emotional tone — not in palette alone.
>
> **Nothing here is approved.** §5 records a recommendation with reasons.
> Human visual approval has not occurred and cannot occur from a document.

---

## 0. Constraints every direction must satisfy

Not preferences — facts about this codebase and this audience.

1. **Strict CSP.** `font-src 'self'`, `style-src 'self' 'unsafe-inline'`,
   nonce-based `script-src` with `strict-dynamic`, `connect-src` limited to self
   plus the Supabase origin. Webfonts must be self-hosted via `next/font`; a
   Google Fonts `@import` or `<link>` is blocked. **The CSP is not relaxed for a
   visual choice.**
2. **Cloudflare Workers runtime.** No runtime code generation. Charts are
   hand-written SVG, as they already are. Any charting library would need to
   clear Suite D and the Workers-runtime gates before it could be considered.
3. **Tenant brand colour is variable and unvalidated for contrast.** Every
   direction must express brand through a resolver that guarantees a contrast
   floor, not by painting a raw hex behind white text as the product does today.
4. **Spanish, `lang="es"`.** Longer strings than English; type must tolerate
   ~20 % more width.
5. **Real audience.** A non-technical CEO, consultants, and school directors
   reading on a phone. Nothing here may cost comprehension to buy style.
6. **Dark mode is already half-implemented** with `dark:` variants throughout.
   Every direction must define both modes properly or deliberately commit to one.
7. **No component library, no icon library, no animation library is installed**,
   and P8 discovery adds none. Whatever a direction needs must be buildable from
   Tailwind v4 plus hand-written SVG.

---

## 1. Direction A — **Informe Vivo** (Living Report)

### Thesis
The study is a piece of writing that happens to be interactive. Structure comes
from typography and white space, the way a well-set research report does;
colour appears only where it carries meaning. The reader is led through an
argument — *what happened, why it matters, what to look at next* — and can stop
at any point having understood something true.

### Studio ↔ Insights
One typographic system, two densities. Insights is the published article:
generous measure, large opening statement, quiet chrome. Studio is the editing
desk for that article: same faces, same scale, tighter rhythm, more chrome, and
a persistent sense of *state* — this is a draft, this is under review, this is
live. The consultant recognises Studio as the place where the client's document
is made.

### Typography
A serif for statements and findings; a humanist sans for interface, labels and
tabular figures. The serif is what separates this from every dashboard the
client has seen, and it appears only in headings, the opening statement and
pull quotes — never in a control. Tabular lining figures for every number so
columns align. Type scale on a musical ratio with a genuine display step, so a
headline result can be large without shouting. **Both faces self-hosted via
`next/font`.**

### Colour & contrast
An ink-and-paper base: warm off-white surface, near-black ink, one graphite
mid-tone. Exactly one accent, derived from the tenant's brand colour through the
contrast resolver, used for links, the active state and the primary data mark.
Semantic colour reserved for four meanings only — caution, insufficient,
positive movement, negative movement — and always paired with a word. Dark mode
is a true inversion designed as its own artefact, not a filter.

### Density & spacing
Spacious. An 8 px base with generous vertical rhythm; roughly 65–75 characters
of measure for reading text. Studio compresses the same scale by one step
rather than switching to a dense grid.

### Cards & panels
Minimal. Sections are separated by space and rules, not by nested boxes. Where a
container is needed it is a hairline rule and a tint, not a shadowed card.
Retires the current three-radius, drop-shadow card-in-card-in-card stacking.

### Navigation
Insights: a quiet header and an in-study tab strip. Studio: persistent left
navigation with breadcrumb. Depth 3 and 4 respectively.

### Motion
Editorial restraint. Two durations only: 120 ms for state, 220 ms for content
appearing. Motion is used for continuity — a touchpoint expanding in place, a
filter chip settling — never for delight. No entrance choreography, no counting
numbers. `prefers-reduced-motion: reduce` removes all of it with no loss of
meaning, which is the test.

### Charts & data
One chart per point, and the point is written above the chart. Direct labelling
over legends. Series distinguished by weight, dash and direct label — never by
hue alone. Below four periods there is no line chart, only a period list. Every
chart has a real data-table alternative, which also solves the phone layout.
The bar comparison stays; it gets readable labels and a baseline.

### Qualitative
Quotes are the largest text in the product after the opening statement — set as
pull quotes, attributed to a touchpoint. Themes are a ranked list with honest
counts, never a font-size cloud. This directly retires the current pattern where
quantity is encoded as type size and the count hides in a `title` attribute.

### Mobile
Native to it. One column, real reading, tabs as a segmented control, the journey
as a vertical route, tables as cards.

### Accessibility risks
Serif at small sizes is the main one — mitigated by never using the serif below
the body step and choosing a face with a large x-height. A near-monochrome
palette makes disabled/inactive states harder to distinguish, so those must be
carried by opacity *and* label. Warm off-white must still clear 4.5:1.

### Deliberately avoids
Tile walls. Decorative gradients. Glassmorphism. Purple. Icon-per-heading.
Charts that exist because there was space. Traffic lights on everything.

### Fit
**Strong.** It is the visual expression of what the consultant actually sells —
an argument supported by evidence — and it is the furthest thing from the Power
BI aesthetic the client is paying to leave. It also makes the missing
interpretation feature feel inevitable rather than bolted on. Risk: it demands
real writing. A finding block with a weak sentence in it looks worse than a tile
with a number in it, so this direction raises the floor on copy and on the
consultant's own input. That is arguably a feature.

---

## 2. Direction B — **Mesa de Trabajo** (Calm Workbench)

### Thesis
Complex operations should feel like a well-organised workshop: one task in front
of you, the tools for it within reach, everything else quiet but findable. The
product's job is to make the consultant certain — of where she is, what she just
did, and what happens next. Optimised for Studio; Insights is its calmer,
public-facing sibling.

### Studio ↔ Insights
Studio leads and Insights inherits. The shared system is a workspace shell —
persistent navigation, a task region, a context rail. Insights uses the same
tokens and the same components but drops the rail and the chrome, so the client
sees a serene reading surface built from the same parts. Consistency is very
high; distinctiveness is lower than Direction A.

### Typography
A single neutral grotesque across both products, with a wide weight range doing
the hierarchical work, and tabular figures throughout. Modest type scale — the
largest step is around 32 px — because in a workbench, size means importance,
and inflated headings make everything feel equally urgent. Self-hosted.

### Colour & contrast
Cool neutral base. A single functional accent used for the *current action* and
nothing else, so "what do I do next" is always answerable by scanning for one
colour. A disciplined status ramp — neutral, informational, caution,
insufficient, danger, success — each with an icon and a word. The tenant brand
appears in Insights only, through the resolver; Studio stays Be Community's own
colours so a consultant switching clients all day is never confused about whose
data is on screen. That is a real safety property, not a stylistic preference.

### Density & spacing
Comfortable-dense. A 4 px base with an 8 px rhythm. More visible at once than
Direction A, without the compression of a trading terminal. Tables are first
class and well-set rather than avoided.

### Cards & panels
Panels with clear edges and one elevation level. A card means "a thing you can
act on". Nested cards are forbidden — which alone fixes the current
card-in-card-in-card stacking in the study view.

### Navigation
The strongest of the three. Persistent primary navigation, a breadcrumb that
always names the client, a step ribbon that doubles as the study's progress, and
an inspector rail for the selected object. Depth is the same but orientation is
far better than today.

### Motion
Functional and quick. 100–160 ms. Motion exists to preserve object identity —
a row expanding, a panel sliding in, a step advancing — so the user never loses
their place. Nothing decorative. Reduced-motion swaps to instant.

### Charts & data
Small, consistent, comparable. A restricted chart vocabulary — trend line,
comparison bar, distribution — always rendered the same way so a consultant can
read them at a glance. Sparklines beside numbers. Tables are peers of charts,
not fallbacks. Every chart is keyboard navigable point by point.

### Qualitative
Triage-first. Themes as a workable list with counts, filters and bulk actions;
quotes in a reading pane beside the list. Excellent for the consultant's actual
job of confirming and merging; less emotionally resonant for the client, who
gets the same list slightly warmed.

### Mobile
Adequate rather than native. The rail collapses; tables become cards; the wizard
declares itself desk work. Honest, but the phone is clearly not where this
direction was designed.

### Accessibility risks
Lowest of the three. The main risks are density at 200 % zoom, and a single-accent
system leaning on colour for "current" — mitigated by pairing it with weight and
position. The restricted chart vocabulary makes systematic keyboard support
genuinely achievable.

### Deliberately avoids
Editorial flourish. Large display type. Serif. Anything that trades scanability
for atmosphere. Also avoids the current product's habit of putting five
unrelated jobs on one page.

### Fit
**Strong for Studio, weak for Insights.** It would make the consultant's day
materially better and is the lowest-risk direction to build. But it answers
*"can I operate this?"*, not *"do I understand what happened at my school?"* —
and a school director opening a workbench has been handed a competent internal
tool, which is precisely the Power BI feeling the product exists to replace.

---

## 3. Direction C — **Recorrido** (Guided Path)

### Thesis
The journey is the product. Everything — results, comparisons, quotes,
recommendations — is anchored to a place in the client's experience map. Instead
of reading a report or operating a console, the user walks the route their
people walked, and the evidence appears where it belongs. The organising
question is not "what are the numbers" but "where along the experience does this
break".

### Studio ↔ Insights
A single spine in both products. In Insights the reader moves along it; in
Studio the consultant builds and annotates it. The consultant's mental model and
the client's mental model become the same picture, which is a genuinely
attractive property — it is how she already explains her work.

### Typography
Sans throughout, with a strong display step used for the touchpoint currently in
view. Numbers are large and confident because at any moment there is one primary
number on screen. Labels are compact, because the map needs room.

### Colour & contrast
The most colour of the three, and the most disciplined about why. The route is
the visual anchor; each touchpoint carries a state derived from the consultant's
own thresholds — which is exactly the *semáforo* the consultant maintains by
hand today, and the reason this direction is tempting. Colour is always paired
with a shape and a value, never carrying meaning alone. Tenant brand is the
route's own colour, resolved for contrast; states use a fixed, accessible ramp
that brand cannot override.

### Density & spacing
Focused. One thing large, the rest small and peripheral. Vertical space is spent
on the selected touchpoint; the map itself is compact.

### Cards & panels
Almost none. The map is the surface; detail expands in place beneath the
selected point. Retires the card stack entirely.

### Navigation
Spatial. Position on the route *is* the navigation; tabs and lists are
secondary. Powerful when it fits, disorienting when it does not.

### Motion
The most motion of the three, and the most load-bearing: moving along the route,
expanding a point, tracing a change between periods. Because motion carries
meaning here, `prefers-reduced-motion` requires a genuine static equivalent —
not merely disabling the transition. That is a real, ongoing cost on every
feature.

### Charts & data
Everything positioned on the route. The trend becomes change-along-the-route
between periods. Comparisons are shown as the route re-drawn for a segment,
which is a genuinely good idea. Off-route results — the overall recommendation
score, the overall satisfaction — have no natural home and must be given one,
which is where this direction starts to strain.

### Qualitative
Its best feature. Pain points sit exactly where they occurred, with quotes
attached, and the two-or-three-labels discipline the method requires is a
natural consequence of the space available rather than an arbitrary cap. This is
the closest of the three to how the consultant actually presents her findings.

### Mobile
Hardest of the three. A horizontal route does not survive 320 px; it must become
a vertical timeline, which changes the metaphor on the device most clients will
use first. Two layouts to design, build and test rather than one that reflows.

### Accessibility risks
Highest. Spatial navigation needs a rigorous keyboard model and a linear
alternative that is not a second-class citizen. State-on-route is colour-forward
by nature and needs shape and value redundancy everywhere. Motion-as-meaning
needs a real static fallback. All solvable; none free.

### Deliberately avoids
Generic dashboards. Tile walls. Any layout where the numbers float free of the
experience that produced them.

### Fit
**Distinctive, and a genuine strategic bet.** It matches the consultant's method
more literally than the other two, and it would be unmistakably Be Community.
But it assumes every study has a journey — and the process material describes a
service catalogue that includes journey-only studies *and* studies that are not
journeys at all. A study without a journey has no home in this direction. As the
product's whole visual system it is too narrow; **as the treatment of the
`/recorrido` view inside another direction it is excellent**, and that is the
form in which it should survive.

---

## 4. Comparison

| | **A · Informe Vivo** | **B · Mesa de Trabajo** | **C · Recorrido** |
|---|---|---|---|
| Organising idea | An argument you can test | A workbench you can trust | A route you can walk |
| Leads for | Insights | Studio | The journey view |
| Storytelling model | Finding → evidence → method | Task → confirmation → next task | Place → what happened there |
| Emotional tone | Considered, plain-spoken | Calm, competent, unhurried | Immersive, guided |
| Composition | Editorial column, space-led | Shell + task region + rail | Spine with expanding detail |
| Information rhythm | Slow open, deepening | Even, scannable | One focus, periphery quiet |
| Type | Serif statements + sans UI | One grotesque, weight-led | Sans with a strong display step |
| Colour | Ink & paper, one accent | Cool neutral, one action accent | Route-anchored state ramp |
| Density | Spacious | Comfortable-dense | Focused |
| Panels | Rules & space | One elevation, no nesting | Almost none |
| Navigation | Header + tabs | Persistent nav + breadcrumb + steps | Spatial |
| Motion | Restrained, 2 durations | Functional, 100–160 ms | Load-bearing |
| Charts | One chart, one point, labelled | Small, consistent, comparable | Positioned on the route |
| Qualitative | Pull quotes, ranked themes | Triage list + reading pane | Pain points in place |
| Mobile | Native | Adequate | Hardest |
| A11y risk | Medium (serif size, monochrome states) | **Lowest** | **Highest** |
| Build cost | Medium | **Lowest** | Highest |
| Distinctiveness | High | Low | **Highest** |
| Fails when | The writing is weak | The client wants meaning, not a console | The study has no journey |

---

## 5. Recommendation

**Recommended: Direction A — *Informe Vivo* — as the system, with Direction B's
shell discipline governing Studio and Direction C's treatment applied to the
journey view.**

This is a recommendation. It has not been approved, and no visual approval has
taken place.

Why:

1. **It answers the four client questions structurally**, not with added copy. A
   finding block *is* what-happened plus why-it-matters plus the evidence; the
   layout enforces the thing the product currently lacks. B and C both require
   that answer to be bolted on.
2. **It is the furthest from Power BI**, which is the stated reason this product
   exists. B risks rebuilding the console the client is leaving; A cannot be
   mistaken for a spreadsheet.
3. **It makes the missing interpretation feature inevitable.** In an editorial
   system the consultant's reading is the natural top of the page. In a
   workbench it is an extra panel; on a route it is an annotation.
4. **It carries the sample-honesty requirement gracefully.** A sentence about
   what a number rests on belongs in an editorial system. In a tile grid it is a
   footnote nobody reads — which is exactly what `n=23` is today.
5. **It is native to the phone**, which is where a school director opens the
   link.

Why the hybrid rather than A alone:

- **Studio is not an article.** Direction B's persistent navigation, breadcrumb
  that always names the client, no-nested-panels rule and one-accent-for-current-
  action discipline are the concrete cure for the orientation problems in the
  audit (§3.2). Adopt them inside A's type and colour system. B's insistence
  that Studio wears Be Community's colours rather than the client's is a safety
  property worth keeping.
- **The journey deserves C's treatment in its own view.** Evidence anchored to
  the place it came from, with two or three pain points and their quotes, is the
  consultant's actual method. Contained to `/recorrido` it costs one view's worth
  of extra design, and a study without a journey simply does not show it.

What this hybrid must be held to:

- One token set. Studio's density is a step on the same scale, not a second
  system.
- The serif never appears in a control, and never below the body step.
- Motion stays restrained even in the journey view, and every animated meaning
  has a static equivalent.
- The tenant brand reaches the screen only through the contrast resolver — in
  Insights, in the preview, and in the PDF.

What would change the recommendation:

- If the CEO's priority is her own daily throughput over the client-facing
  impression, **B** becomes the right answer and is also the cheapest to build.
- If a supplied brand kit arrives with a mandated typeface that cannot carry an
  editorial voice, A weakens and the hybrid should re-centre on B.
- If journey-less studies turn out to be rare in practice, **C** becomes a
  serious contender for the whole system rather than one view.

---

## 6. Reference-source record (`ui-ux-pro-max`)

Used as a searchable reference and challenger only, per the P8 instruction. Seven
bounded searches were run. `--design-system` was deliberately **not** run and
nothing was persisted through the tool: its generated system is not the product
direction, and persisting would have written outside the P8 delivery boundary.

**Adopted**

- *Analytics Dashboard* profile confirming **Minimalism & Swiss** as a primary
  style for professional data tools, and *B2B Service* pairing **Accessible &
  Ethical + Minimalism** with "professional blue + neutral grey". Both support
  the restraint in A and B and argue against decorative treatments.
- Chart guidance: **line charts are wrong below four data points — use a stat
  card**. Directly applicable, since most clients will have two waves. Adopted
  as the "list below four periods" rule in all three directions.
- Chart accessibility: never distinguish series by hue alone; provide a visible
  data table plus a concise summary; focus reveals point values. Adopted
  verbatim as the chart contract, and it doubles as the phone layout.
- Responsive: test at 320 / 375 / 414 / 768 / 1024 / 1440. Adopted into the
  brief.
- Focus states, *Focus Not Obscured*, and `prefers-reduced-motion` as
  high-severity items. Adopted; *Focus Not Obscured* is correctly flagged there
  as WCAG 2.2 **AAA** and is treated here as a design guideline, not an AA claim.
- *Progress indicators for multi-step processes* and *confirm submission status*
  — validates generalising the existing upload step ribbon across Studio.
- *Bulk actions: multi-select rather than row-by-row* — validates keeping the
  qualitative triage bulk bar.

**Rejected**

- Its top style suggestion for the Smart Home / IoT dashboard profile,
  **Glassmorphism + Dark Mode (OLED)**, surfaced by the analytics query. Rejected
  outright: it is the "AI SaaS" register the brief excludes and it degrades
  legibility for the actual audience.
- **Heat Map** as a co-primary style for the analytics profile. Rejected as a
  system-level direction — colour-density encoding is exactly the
  colour-alone-carries-meaning failure the audience cannot afford. May survive
  as a single component if evidence later demands it.
- Scatter/bubble and radar/spider chart recommendations. Rejected as
  inapplicable: the data is categorical with small n, and the source itself warns
  against scatter below 20 points and against radar for precise comparison.
- All four returned font pairings **as given**, because every one ships a Google
  Fonts `@import`/`<link>` that this product's CSP blocks. The *Serif + Sans
  editorial* and *Magazine* patterns are useful as a shape and informed
  Direction A's two-face approach; any chosen face must be re-expressed as a
  self-hosted `next/font` import.
- "Table handling: use horizontal scroll **or** card layout" — accepted only in
  its card half. Horizontal scroll is what the product already does at
  `min-w-[900px]`, and it is the defect, not the remedy.
- The generic *Sales Intelligence Dashboard* pattern attached to the B2B profile.
  Rejected: this is not a CRM, which is a standing repository rule.

**Not consulted**

`vercel-react-best-practices` was not invoked. No architectural feasibility
question arose in this pass that discovery needed it to answer; it belongs to
implementation, where the Cloudflare Workers runtime — not Vercel — is the
deployment target, and its guidance must be read against that.

---

## Appendix — provisional synthesis: *Informe Vivo Guiado*

> **Added after the comparison prototypes were built and reviewed.**
> This appendix records that the §5 recommendation was rendered and held up. It
> is **not an approval**, it does **not** supersede §1–§5, and **D1 remains
> open**. Directions A, B and C stand unchanged above and remain available in
> the gallery as evidence.

§5 recommended *A as the system, with B's shell discipline governing Studio and
C's route treatment confined to the journey view*. That hybrid has now been built
as a fourth prototype so it can be looked at rather than imagined:
`prototypes/selected-informe-vivo-guiado/`, offered in the launcher as
**S · Informe Vivo Guiado**, tagged *Síntesis provisional*.

**What the build settled.** The three concerns §5 raised against the hybrid were
measurable, and the prototype answers two of them outright:

| Concern from §5 | Outcome in the prototype |
|---|---|
| A's editorial register costs height | Insights story fell from **4 099 → 2 485 px** desktop and **4 907 → 3 657 px** mobile, with every one of the 104 contract strings still rendered. The cost was the single-column layout, not the narrative. |
| Studio needs B's orientation without B's identity | B's persistent stops, client-naming breadcrumb, step ribbon and glyph+word status all transferred. **B's enterprise blue did not, and nothing was lost with it.** |
| C only works where a journey exists | The route renders in the study that has one; the `Sin recorrido` case is still stated plainly rather than drawn. |

**What it did not settle.** The tenant brand-contrast resolver — the mechanism
that guarantees a readable foreground for any client hex, on screen and in the
PDF — is still unprototyped and remains P8.1 work. Part of the height reduction
comes from collapsing *Cómo se midió* and *Explora por tu cuenta* on narrow
screens, which needs a human to confirm nobody misses them. Dark mode is defined
in tokens but not captured.

**Status.** One shared token file now serves both products; Studio and Insights
differ in density and chrome only. Full synthesis rules, the corrections it was
built to resolve, the review findings and the known gaps are in
[`prototypes/README.md`](prototypes/README.md). The decision is still the
user's and the CEO's to make from the launcher.
