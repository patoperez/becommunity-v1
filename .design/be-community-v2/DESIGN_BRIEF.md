# Design Brief: Be Community V2 — Studio & Insights

> Produced by the `designer-skills:design-brief` skill in autonomous mode.
> The skill's interview step was answered from repository evidence and the
> recorded consultant sessions rather than from a live interview; the questions
> that evidence could **not** settle are escalated as the consequential decisions
> in `docs/P8_PRODUCT_EXPERIENCE_PLAN.md` §7, not silently assumed here.
>
> Evidence: `docs/P8_CURRENT_EXPERIENCE_AUDIT.md`.
> Structure: `.design/be-community-v2/INFORMATION_ARCHITECTURE.md`.
> Visual options: `.design/be-community-v2/VISUAL_DIRECTIONS.md`.

---

## Problem

**The consultant.** She left Excel and Power BI to stop doing the same manual
work every study — and she is still doing it. To scope one director to their own
area she types JSON. To put a number on a touchpoint she types a canonical
metric key from memory. To merge two ways of saying the same thing she retypes
the theme, which is how one theme becomes three. Her final check before writing
twenty people's answers into the database is five raw JSON dumps on a black
background. She is a non-technical expert being asked to behave like a database
administrator, and every one of those moments is a place where she can quietly
break her own study.

Worse: the thing she actually sells is not in the product at all. Her deliverable
is a document carrying *her* recommendations. The platform holds the evidence and
the pain points and then stops, so the interpretation still happens in another
tool, and the client receives a PDF of numbers with no argument in it.

**The client.** A school director opens the portal and meets a wall: a card
headed with their study name, a strip of numbers, a stepper, some pills, a table
with `n=23` in the corner, and a control called *Explorador pivote*. The
headline result is the seventh thing on the page. Nothing says what happened,
nothing says why it matters, nothing says what to look at next, and the one
honest thing the product does say — that a result is based on too few people to
trust — is phrased as *"Base pequeña (n=23)"*. They came for an answer about
their school. They got a spreadsheet in a browser.

**Both of them.** There is no product here yet — there are two audiences sharing
one URL, one of them wearing a grey administrative strip.

---

## Solution

Two connected experiences that share one design system, one vocabulary and one
standard of honesty, and differ in everything else.

**Be Community Studio** turns the consultant's process into the interface. The
study, not the table, is the object of work: it has a home, a state you can read
at a glance, and a small number of guided moves — bring data in, agree what it
means, review what people said, write the interpretation, see it as the client
will, publish. Structured configuration still exists behind the boundary, but
the consultant never types an identifier again. Every irreversible action shows
what it will do before it does it, and can be undone after.

**Be Community Insights** turns the study into a piece of writing that happens to
be interactive. It opens with what happened and why it matters, in the
consultant's words, and then lets the reader test it: which moment of the journey
is weakest, how a result differs by area or seniority, what people actually said.
Every number carries its own reliability in plain language, not as a caveat but
as part of the finding. The interactivity stays — the CEO is explicit that
letting clients build their own comparisons is the hook — but it is framed as
"compare this result by…", never as a pivot builder, and it is anchored by the
consultant's interpretation so that a client who wanders cannot mistake a
two-person slice for a conclusion.

---

## Experience Principles

**1. The finding leads, the evidence follows — never the reverse.**
Every screen opens with a sentence a person could say out loud, and the numbers
justify it underneath. Resolves the tension between *rigour* and
*comprehension* by refusing to choose: the interpretation is on top, the
evidence is one interaction away, and the method is one more. This is what
replaces "make the dashboard prettier".

**2. Choose from what exists; never author what the system already knows.**
Every identifier, key, theme, metric and scope value is offered from the data
already in the study. Free text is a deliberate secondary action labelled
"create new…", never the default. Resolves *flexibility* versus *safety*: the
system stays fully configurable, but configuration is selection, not
transcription. This principle is what makes "no user-authored JSON" achievable
rather than aspirational.

**3. Say the uncomfortable thing in ordinary words.**
Small samples, missing periods, unanswered touchpoints and suppressed themes are
stated plainly and early, in the same voice as the good news. Resolves
*confidence* versus *honesty*: a product that hides its limits is trusted once,
and a product that hides them behind `n=` is trusted by nobody who matters.
Silence is the failure mode to design out — today six states render `null` and
tell the user nothing at all.

---

## Aesthetic Direction

- **Philosophy**: *Editorial instrument.* The register of a well-set research
  report — generous measure, real typographic hierarchy, restrained colour used
  only where it carries meaning — applied to a working tool. Structure comes
  from type and space, not from boxes and shadows. See
  `VISUAL_DIRECTIONS.md` for the three directions this brief is written against;
  this line records the **recommended** one (Direction A), not an approved one.
- **Tone**: Considered, plain-spoken, unhurried. Authoritative because it is
  clear, not because it is dense. Warm in the qualitative sections — those are
  people talking — and quiet everywhere else.
- **Reference points**: the printed research report and the serious data-journalism
  page (a chart that exists to make one point, with the point written above it);
  the calm operations console where the current step is obvious and the rest
  waits its turn.
- **Anti-references**: the generic "AI SaaS" look — purple gradients,
  glassmorphism, decorative blur, animated counters; the Power BI / Excel
  aesthetic the client is paying to leave, meaning tile walls, chart grids
  without argument, and colour applied by default rather than by meaning; and
  any traffic light applied to everything, which the CEO explicitly did not ask
  for — she asked for **an alert when a result sits outside the ideal**.

**Constraint that shapes every visual choice:** the product ships under a strict
CSP (`font-src 'self'`, `style-src 'self' 'unsafe-inline'`, nonce-based
`script-src` with `strict-dynamic`). Webfonts must be self-hosted through
`next/font`; a Google Fonts `@import` or `<link>` will be blocked. Any font
pairing taken from a reference source must be re-expressed as a `next/font`
import, and the CSP must not be relaxed to accommodate a design choice.

---

## Existing Patterns

What the codebase actually provides today (from the audit, §1):

- **Typography**: Geist + Geist Mono are loaded via `next/font` and exposed as
  CSS variables — and then **overridden by `body { font-family: Arial }`** in
  `globals.css`, so the shipped face is Arial. There is no type scale; sizes are
  ad-hoc Tailwind utilities from `text-[10px]` to `text-2xl`.
- **Colours**: no palette. `globals.css` defines `--background` and
  `--foreground` and nothing else. Components hardcode `zinc-*` for structure,
  `sky-*` for filters and trends, `violet-*` for qualitative and reports,
  `amber-*` for warnings, `emerald-*` for success, `red-*` for danger. That
  accidental mapping is actually a reasonable semantic starting point and should
  be formalised rather than discarded.
- **Tenant brand**: `brand_config` carries `displayName`, `tagline`,
  `primaryColor`, `accentColor`, `logoPath`, validated by Zod and defaulting to
  `#0c4a6e` / `#0e7490`. Applied as inline `backgroundColor` and a `linear-gradient`
  with hardcoded white text, and reused in the PDF. **No contrast guard.**
- **Spacing / radius**: no scale. `rounded-lg`, `rounded-xl`, `rounded-2xl` and
  `rounded-full` all appear; padding ranges freely from `p-3` to `p-10`.
- **Components**: none are extracted. Shared styling is copy-pasted string
  constants named `input`, `button`, `inputClass`, `smallInputClass`,
  `primaryButton`, `secondaryButton`, redefined independently in four files.
- **Charts**: no charting library is installed and none should be added
  casually — the only chart is a hand-written SVG line chart in
  `LongitudinalTrends.tsx`, and a hand-written CSS bar list in
  `PivotExplorer.tsx`. Hand-rolled SVG is the established pattern and is
  compatible with the Workers runtime and the CSP.
- **Stack facts that bound the design**: Next 16 App Router, React 19, Tailwind
  v4 (`@tailwindcss/postcss`), TypeScript strict, deployed to Cloudflare Workers
  via OpenNext. No component library, no icon library, no animation library.
- **Patterns worth extending**: the `Paso 1 / 2 / 3` ribbon in `UploadForm`;
  the internal client preview at `/admin/preview/[studyId]`; the
  type-the-exact-email destructive confirmation; the `aria-live` region on
  filter recalculation; the four-level sample-disclosure ladder.

---

## Component Inventory

| Component | Status | Notes |
|---|---|---|
| Design tokens (colour, type scale, spacing, radius, elevation, motion) | **New** | The whole system. Must include a semantic layer (`--surface`, `--ink`, `--ink-muted`, `--accent`, `--caution`, `--danger`, `--positive`) so brand colour can vary per tenant without breaking contrast. |
| App shell (Studio) — persistent nav, current-location indicator, breadcrumb | **New** | Replaces four hand-rolled headers with four different link sets, one of which is a dead end. |
| App shell (Insights) — branded, minimal, study-aware | **Modify** | Extract from `dashboard/page.tsx`; add a contrast-safe brand treatment. |
| Brand contrast resolver | **New** | Given a tenant hex, pick a readable foreground and a safe tinted surface. Guards F4 in dashboard, preview *and* PDF. |
| Sign-in | **Modify** | Serves both audiences; preserve destination through the redirect; add recovery affordance. |
| Study card / study list item | **Modify** | Currently the whole dashboard. Becomes a summary that links to a study route. |
| Study header with state | **Modify** | Replace the raw enum chip with a readable lifecycle state. |
| Finding block (headline + interpretation + evidence) | **New** | The core Insights unit. Nothing like it exists. |
| Indicator ("Resultado") card with method disclosure | **Modify** | From `Tile`; adds *why it matters*, the sample story, and a "cómo se calcula" panel. |
| Sample-context badge (`standard` / `caution` / `suppressed` / `no-data`) | **New** | One component replacing five different inline phrasings, all currently exposing `n=`. |
| Journey map | **Rebuild** | From stepper to route map: score on every touchpoint, pain-point labels only where deepened, two or three maximum. |
| Comparison ("Compara por…") | **Modify** | From `PivotExplorer`. Same server contract, same allowlist; new framing, live region, retry, and readable labels. |
| Trend / evolution chart | **Modify** | Keep hand-rolled SVG. Add a data-table alternative, per-point keyboard access, and non-colour series encoding. |
| Qualitative themes & quotes | **Rebuild** | Retire font-size-as-quantity and `title`-only counts. Quotes are the strongest asset in the product and are currently the smallest thing on the page. |
| Chart-as-image export | **New** | The CEO named this explicitly as a client download. Does not exist. |
| Interpretation editor (private draft → review → publish) | **New** | The missing product (audit §3.5). Depends on decision D2. |
| Guided wizard chrome (step ribbon, per-step validation, resumable) | **Modify** | Generalise the upload ribbon into the Studio pattern. |
| Column-mapping table | **Rebuild** | Selection over transcription: metrics, segments and themes chosen from prior waves; free text demoted to "create new…". |
| Readable import preview row | **New** | Replaces `<pre>{JSON.stringify(...)}</pre>`. |
| Data-scope picker (chips from real segment values) | **New** | Replaces the `data_scope` JSON textarea. The single most important Studio component. |
| Metric picker (from metrics present in the study) | **New** | Replaces the free-text `metric_key` box in the journey configurator. |
| Theme picker / merge | **New** | Replaces the free-text retag input that fragments themes. |
| Destructive-action dialog | **New** | Replaces `window.confirm()` for import rollback; reuses the type-to-confirm pattern already proven on client deletion. |
| Empty / loading / error / insufficient-data states | **New** | A named set. Six states currently render `null` or an empty `<tbody>`. |
| `loading.tsx` / `error.tsx` / `not-found.tsx` boundaries | **New** | None exist anywhere in `src/app`. |
| Flash / toast with `role="status"` | **Modify** | Replaces URL-carried `?ok=` / `?error=` messages. |
| Skip link + landmarks | **New** | None exist. |
| PDF layout & voice | **Modify** | Restore accents, adopt the shared vocabulary, add the interpretation section. |

---

## Key Interactions

**Filtering a study (Insights).** The reader picks a characteristic value.
Chips appear above the results naming exactly what is applied. The results
region announces recalculation through a live region and dims rather than
disappearing, so the page does not jump. When the result returns, the sample
context updates *with* it — if the slice fell below the disclosure floor, the
numbers are replaced by an explanation of why, and by a one-tap way back to the
full result. Failure shows a retry, not a dead red box. The URL reflects the
selection, so the view can be shared.

**Reading a touchpoint (Insights).** Every touchpoint on the route shows its
score. Selecting one — by click, tap or keyboard, with no reliance on hover —
expands it in place: what the score means, how many people it rests on in words,
and the two or three pain points confirmed there, each with the quotes that
support it. Touchpoints that were not deepened say so rather than showing an
empty panel.

**Scoping a person (Studio).** The consultant chooses the client, then the
characteristic, then the values, from chips drawn from that client's real data.
A sentence updates live: "Verá únicamente los resultados de *Dirección* y
*Primaria*." A preview control shows what that person's portal will actually
contain. Nothing is typed; the stored JSON is never seen.

**Mapping a file (Studio).** Column by column, the system proposes a
destination and, when it recognises the instrument, says so in terms of the
previous study rather than a version number. Where the operator must decide,
choices are offered from what already exists in that client's history, so waves
stay comparable. The final check is a readable row, not JSON. Confirmation
states exactly what will be written, and the batch remains revertible afterwards.

**Publishing (Studio).** Publication is reached through preview, never around
it. The consultant sees the client's real screen, then a confirmation that names
what is about to become visible and to whom. State is legible at every point in
the list — not a raw enum chip.

---

## Responsive Behavior

Mobile-first, single column at 320 px, no horizontal page scroll at any width.
Tested at 320 / 375 / 414 / 768 / 1024 / 1440.

Components that change **behaviour**, not merely size:

- **Journey map** — horizontal route on wide screens; a vertical list of
  touchpoints on narrow ones. It must not become a `min-w-` strip that the
  reader drags. Hover is never the only way to open a touchpoint.
- **Comparison tables** — a real table on wide screens; one card per row on
  narrow ones, so headers stay attached to values. The two `min-w-[900px]`
  tables in Studio (mapping, qualitative triage) are the current worst case and
  need a genuine card mode, not a wider scroll container.
- **Studio navigation** — persistent side navigation on wide screens; a compact
  bar with a menu on narrow ones. The consultant does review qualitative work
  away from her desk; import does not need to be usable on a phone, and the
  product should say so rather than degrade silently.
- **Trend chart** — full chart on wide screens; on narrow screens the same data
  as a compact period-by-period list. This also satisfies the accessibility
  fallback, so it is one solution to two problems. (Reference guidance is
  explicit that fewer than four points should not be a line chart at all — with
  two waves, the list *is* the better presentation.)
- **Wide numeric content of any kind** scrolls inside its own container with a
  visible affordance; the page body never scrolls sideways.

---

## Accessibility Requirements

Target **WCAG 2.2 AA**, verified in P8.5 and asserted where it can be asserted
deterministically.

- **Contrast**: 4.5:1 for body text, 3:1 for large text and for meaningful
  non-text (chart marks, focus rings, state chips). The tenant brand colour is
  attacker-adjacent input here in the usability sense — the resolver must
  guarantee the floor rather than trusting the chosen hex.
- **Never colour alone.** State chips carry text or shape; chart series carry
  line style or direct labels; the alert state carries a word.
- **Keyboard**: every interactive element reachable and operable; visible focus
  ring on all of them; focus never obscured by sticky chrome; logical order; a
  skip link to main content on every page.
- **Screen reader**: `lang="es"` on the document; landmark regions
  (`header`/`nav`/`main`); live regions for recalculation, save and error;
  labelled controls with no placeholder-only fields; charts exposed as an
  accessible summary plus a real data table.
- **Motion**: honour `prefers-reduced-motion: reduce` — no exceptions, and no
  motion that carries information on its own.
- **Touch**: 44 × 44 px minimum with 8 px separation; no hover-only affordance
  anywhere; no reliance on `title` attributes to carry data (the theme pills do
  this today).
- **Text**: 16 px body minimum; no quantity encoded as font size (retire the
  theme-pill scaling); support 200 % zoom without loss of content.

---

## Out of Scope

- **Any change to calculation, ingestion, RLS, authorization, roles, migrations
  or data.** P8 changes presentation, language and flow. Numerical parity,
  tenant isolation and server-side authorization are invariants, not goals.
- **This discovery pass writes no production code**: no components, CSS, routes,
  migrations, tests or package changes. Deliverables are documents.
- **Kano modelling** — excluded by the consultant's own process documentation.
- **Continuing P7.** PR 7 (Suites B and C) remains under review; P8 does not
  touch it, and Suite E, audit logging, backups and incident response stay where
  the P7 plan put them.
- **New analytical capability.** Retention/deserción prospecting, LTV, CRI
  cost-of-loss modelling and sector benchmarking all appear in the process
  material as real future work. They are product scope, not experience scope, and
  belong to V2.5 with authoritative formula definitions — P8 must leave room for
  them without inventing them.
- **A formal brand kit.** No logo, wordmark, typeface licence or brand guideline
  has been supplied. P8 proposes a visual system that a supplied brand can be
  dropped into; it does not fabricate a corporate identity.
- **Component library or design-tool selection**, and any decision that is
  implementation trivia rather than product direction.
