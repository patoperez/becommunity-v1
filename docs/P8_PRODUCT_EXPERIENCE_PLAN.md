# P8 — Product Experience Transformation

> **Authoritative P8 plan and experience contract.** Status: **P8.1/P8-A and
> P8.2, P8.3 and the bounded P8.4 implementation are in the real product;
> P8.5 is pending.** Discovery
> and standalone visual comparison are closed. Implementation records live in
> `.design/be-community-v2/implementation-reviews/`.
>
> Companion documents:
> - `docs/P8_CURRENT_EXPERIENCE_AUDIT.md` — the evidence: route/state inventory,
>   defects, terminology debt.
> - `.design/be-community-v2/DESIGN_BRIEF.md` — problem, principles, aesthetic
>   direction, component inventory.
> - `.design/be-community-v2/INFORMATION_ARCHITECTURE.md` — routes, navigation,
>   the two experience maps, naming, URL strategy.
> - `.design/be-community-v2/VISUAL_DIRECTIONS.md` — three directions, comparison
>   and recommendation.
>
> P8 does not continue, modify or reopen P7. PR 7 (Suites B and C) remains under
> review on `p7f-suites-b-c`; Suite E, audit logging, backups, incident response
> and the go-live controls stay exactly where `docs/P7_PLAN.md` put them.

---

## 1. Why P8 exists

P0–P6 built a technically correct product and P7-A established the structural
security baseline. What remains is not a defect list — it is that the product
exposes its own implementation to the people it was built for.

The evidence, in one paragraph: a non-technical CEO types JSON to scope a
director to their own area; types a canonical metric key from memory to attach a
number to a touchpoint; retypes a theme name to merge two themes, which is how
one theme becomes three; and reviews five raw JSON dumps as the final human
check before an atomic database write. A school director opens the portal and
finds the headline result seventh on the page, below a stepper and some pills,
next to a control called *Explorador pivote*, with the honest caveat rendered as
`Base pequeña (n=23)`. And the thing the consultancy actually sells — the
consultant's interpretation — has no place in the product at all.

**P8 is product, service and information design supported by a strong visual
system. It is not a visual refresh of the dashboard.**

---

## 2. Outcome

Two connected, branded, accessible, guided experiences sharing one design system
and one vocabulary:

- **Be Community Studio** — internal. Complex operations feel safe and guided:
  wizards, sensible defaults, selectors, chips, templates, previews, progressive
  disclosure. Structured configuration remains behind the application boundary;
  ordinary users never author it.
- **Be Community Insights** — client. A data story that answers *what happened,
  why does it matter, what should we examine next, and how much should we trust
  this* — with the reliability of every result stated in ordinary words.

**Invariants.** P8 changes presentation, language and flow. It does not change
calculations, ingestion semantics, RLS, authorization, roles, migrations or
data. Numerical parity, tenant isolation and server-side authorization are
preserved and re-proved, not renegotiated.

---

## 3. The P8 experience contract

Observable rules. Each is stated so that a reviewer can check it, and §6 names
where each is verified.

### C1 — No user-authored structured data in ordinary workflows
No ordinary workflow requires a user to type JSON, a stable identifier, a
canonical metric key, a theme key or a recoding-table id. Every such value is
selected from what already exists in the study or the client's history. Creating
a genuinely new value is possible, is labelled as new, and is never the default
path. **Check:** no `<textarea>` or `<input>` in Studio accepts a raw structure
or identifier as its primary means of entry; `JSON.stringify` does not reach any
user-visible surface.

### C2 — Progressive disclosure
Every screen presents one job. What is always visible, what is one interaction
away, and what is advanced is declared per surface in the information
architecture (§5 and §6 of that document). **Check:** no page presents more than
one primary job; no list renders an unbounded per-item editor.

### C3 — Plain-language results
No implementation term appears in either product: not `JSON`, `data_scope`,
`tenant`, `pivot`, a canonical key, a raw status enum, `agregación`, `unidad de
respuesta`, `menc.` or a bare `n=`. Acronyms appear only alongside their meaning
and only where methodology is deliberately disclosed. **Check:** a
deterministic string scan over rendered user-facing copy, run as a gate.

### C4 — Human-readable sample context
Every published result states what it rests on in words. The four disclosure
levels — sufficient, small base, insufficient, no data — each have one canonical
phrasing used everywhere, including the PDF. The suppression rule is explained
as protection of the people who answered, not as a system limitation.
**Check:** one component and one string table; `n=` appears in no client-facing
surface.

### C5 — Every major result explains its significance and context
A headline result carries what it means, how it changed, what it rests on, and
where to look next. Method is available on demand. **Check:** the finding block
cannot render without an interpretation slot; when the consultant has published
none, the absence is stated rather than hidden.

### C6 — Safe defaults and reversible actions
Destructive and outward-facing actions state what will happen before they happen
and can be undone or corrected afterwards. Publication is reachable only through
preview. No native `window.confirm()` guards a destructive action. **Check:**
every mutation is classified reversible / confirmable / irreversible, and each
irreversible one uses the type-to-confirm pattern already proven on client
deletion.

### C7 — Accessible behaviour — target WCAG 2.2 AA
`lang="es"`; skip link and landmarks on every page; visible focus on every
interactive element; keyboard operability with no hover-only affordance; 4.5:1
body and 3:1 large-text and meaningful-non-text contrast, **including tenant
brand colours resolved through a contrast guard in the dashboard, the preview
and the PDF**; no meaning carried by colour alone; no quantity encoded as font
size; no data carried only in a `title` attribute; `prefers-reduced-motion`
honoured with no loss of meaning; charts exposed as an accessible summary plus a
real data table. **Check:** P8.5 acceptance matrix.

### C8 — Mobile-first reflow without horizontal clipping
Single column at 320 px; no horizontal page scroll at 320 / 375 / 414 / 768 /
1024 / 1440. Wide content scrolls inside its own container with a visible
affordance. The two `min-w-[900px]` tables get a genuine card mode, not a wider
scroll container. **Check:** the existing responsive matrix pattern, extended.

### C9 — Explicit loading, empty, error and insufficient-data states
Every data surface has all four, named and designed. **No surface renders `null`
to mean "nothing to say".** `loading.tsx`, `error.tsx` and `not-found.tsx`
boundaries exist. Every error offers a way forward — a retry or a route back —
never a dead red box. **Check:** the six currently-silent states (C6, C15, C19,
C33, S15, S37 in the audit) each render an explanation.

### C10 — Security and calculation invariants preserved
No change to metric formulas, the rounding policy, the aggregate-DTO client
boundary, the pivot allowlist, the disclosure thresholds, RLS, grants,
authorization guards, middleware or roles. The client continues to receive only
sanitized aggregates. **Check:** the full deterministic suite plus the live
chain, unchanged and green, on every P8 PR.

### C11 — Absence is not a client-facing finding
**Owner decision, 2026-08-24.** A published study is a finished editorial
product. Where Be Community intentionally does not publish a component — or has
simply not finished reviewing it — the client sees **nothing**: no placeholder,
no empty-state card, no heading, no reserved row, no border or gap, and no copy
explaining that something is missing or that a review is under way. The
narrative must not name content it is not showing.

This is a rule about the consultancy's own unfinished work, **not** about
analytical honesty. Statements that qualify a result the client *is* being shown
— a small base, a suppressed segment, a touchpoint with no data, a value the
disclosure floor hides — are preserved exactly, because they change how the
visible number should be read.

Internal Studio and the internal preview own the omission warnings instead, and
must keep naming them: they are operational information a consultant needs
before publishing. Any such notice is visibly marked as internal.
**Check:** deterministic assertions that the missing-comparison and
missing-qualitative copy cannot reach client output, that the wrapper elements
around empty content are not rendered either, and that internal readiness still
reports the same omissions.

---

## 4. Non-goals

- Continuing, modifying or reopening P7.
- New analytical capability: retention/deserción prospecting, LTV, CRI
  cost-of-loss modelling, sector benchmarking. These are real future work
  described in the process material; they are product scope, not experience
  scope, and belong to V2.5 with authoritative formula definitions. P8 leaves
  room for them and invents none of them.
- Kano modelling — excluded by the consultant's own process documentation.
- Retention UI and new role tiers, which `docs/CURRENT_STATE.md` explicitly
  excludes from the current task.
- Fabricating a brand kit. No logo, wordmark or typeface licence has been
  supplied. P8 proposes a system a supplied brand drops into.
- Selecting a component library, CSS methodology or icon set as a product
  decision. Those are implementation choices made inside a workstream.

---

## 5. Implementation roadmap

Five workstreams, each a reviewable PR or a small ordered set of PRs. Sequence
is driven by dependency, not by preference. **No dates.** Every workstream runs
`npm run typecheck && npm run lint && npm test && npm run build` in WSL or Linux
CI — never on the Windows workstation — plus the live chain where it applies.

**Delivery method approved 2026-08-24:** standalone prototyping is closed. The
A/B/C comparison and provisional synthesis are retained as historical evidence,
but visual refinement now happens directly in the real product through bounded
vertical slices, owner testing and correction. No workstream creates another
detached HTML direction before implementation.

### P8.1 — Design system, shared shell, sign-in
**Depends on:** decision D1 (visual direction).
**Delivers:** the token layer (colour, type scale, spacing, radius, elevation,
motion) with light and dark defined properly; the **tenant brand contrast
resolver**; `lang="es"`; the fixed font pipeline (F1); skip link and landmarks;
`loading` / `error` / `not-found` boundaries; the Studio shell with persistent
navigation and breadcrumb; the Insights shell; the shared state set (empty,
loading, error, insufficient); the flash/live-region replacement for URL-carried
messages; sign-in serving both audiences with **destination preserved through
the redirect** and an allowlist-validated internal-only `destino`; a real
favicon and the removal of the Next.js scaffolding in `public/`.
**Why first:** every other workstream consumes these tokens and this shell.
Doing it after would mean styling twice.
**First product slice (P8-A):** combine this foundation with a real client
panorama and rich journey vertical slice so the owner reviews a functioning
product rather than isolated design artifacts. The contrast resolver is still
proved against real and deliberately bad tenant colours.

### P8.2 — Studio guided workflows
**Depends on:** P8.1. Decisions D3, D5 shape it; D4 can defer to P8.4.
**Delivers:** `/studio` home answering "what needs me now"; the client and study
routes with filter and paging; the study work surface with process tabs; the
**picker component** and its four uses — data scope, journey metric, theme
merge, mapping targets — which is what actually retires C1's free text; the
rebuilt mapping step with selection over transcription; the readable import
preview replacing the JSON dump; the destructive-action dialog replacing
`window.confirm()`; publication reachable only through preview; visible paging
for qualitative observations and import history.
**Status: all of it delivered.** Every `/admin/**` address still answers —
Studio gained addresses and renamed none away — because bookmarks, emailed
links and the frozen adversarial catalogue depend on the old paths. Gated by
`npm run test:studio-workflows` (22 checks) and `npm run test:studio-completion`
(44 checks).
**Why second:** it removes the largest operational risk (a consultant silently
breaking her own study) and it is the workstream the CEO will feel first.
**Implementation review first:** deliver the data-scope picker and mapping step
inside the real Studio workflow, then stop for owner testing. Getting the
mapping step wrong compromises longitudinal comparability, which is a data
consequence rather than a visual one.

**Accepted scope, owner decision 2026-08-24 — DELIVERED in two units.** Slice
one (owner-accepted, PR #39) delivered the access-scope picker and the guided
mapping and readable preview. The completion unit delivered everything else this
workstream names, and is recorded in
`.design/be-community-v2/implementation-reviews/p8-2-completion/REVIEW.md`.

*Access scope, with no JSON anywhere an ordinary user can reach.* Every raw
`data_scope` textarea is replaced by a no-code picker: a first choice between
**Todo el cliente** and **Solo una parte**; when a part is chosen, the available
characteristics and their values come from that client's real data, selected
with checkboxes or multi-select rather than typed; a plain-language effective-
access summary states what the person will actually see; and staff can inspect
or test that person's resulting view before inviting them. JSON may remain the
storage format — it must simply never be authored or read by an ordinary Studio
user.

*A discoverable account lifecycle.* Suspending a client user's access and
permanently deleting that user are distinct, findable actions. **Archiving** a
client organisation is the ordinary, reversible action. Permanent organisation
deletion exists but only behind an impact summary naming what will be destroyed
and an exact-name confirmation, with defined, safe handling of dependent users,
studies, responses, reports, logos and other stored files, and audit evidence.

**Delivered, with one thing deliberately outside the schema and one thing
deliberately still off.** Suspension is enforced at the AUTHENTICATION boundary
rather than by a product column, so the interface can never show "con acceso"
for an identity the Auth server is already refusing — and "invitación pendiente"
became a third real state instead of being folded into "active". Archiving is
enforced server-side against new studies, new invitations and new publications
at the moment of the write. Permanent client deletion shows counted impact,
requires the exact client name, RECOMPUTES the impact at execution time and
stops if a single number moved, collects Auth identities and Storage objects
before the row cascade, removes them explicitly afterwards, and reports whatever
it could not remove. Migration `0015` — two nullable columns and one internal
audit table with no foreign keys, so a record survives the deletion it records —
is **applied nowhere**; until it is, the client archive and permanent-delete
controls render disabled with the reason stated, which is the honest blocked
state rather than a hidden one.

### P8.3 — Insights data story
**Status:** implementation-complete on `p8d-insights-data-story`; awaiting owner
review. The focused deterministic gate is `npm run test:insights-story`.
**Depends on:** P8.1. Reads best after P8.2 exists, but does not require it.
**Delivers:** `/insights` and the study routes; the finding block; the indicator
card with method disclosure; the **sample-context component** and its single
string table, applied on screen and in the PDF; the rebuilt journey view; the
comparison view replacing the pivot explorer against the same server contract
and allowlist; the trend view with its list form below four periods and its data
table alternative; filter state in the URL with the report link built from the
same source; explanations replacing every silent `null`.
**Why third:** it is the client-facing payoff, and it depends on the vocabulary
and components P8.1 and P8.2 establish.

### P8.4 — Qualitative, interpretation and per-client customisation
**Depends on:** P8.3, and on decisions D2, D4, D6.
**Delivers:** the rebuilt qualitative presentation — ranked themes with honest
counts, quotes as first-class content, no font-size-as-quantity, no
`title`-only data; the two-or-three pain-point discipline on touchpoints; the
**interpretation surface** (private draft → internal review → published
reading), if D2 is approved; **per-client thresholds and the alert state**, if
D4 is approved; chart-as-image export; and the PDF rewrite — accents restored,
shared vocabulary adopted, interpretation section added.
**Why fourth:** it carries the two genuinely new product ideas and should not
block the foundational work.
**Implementation review first:** add the smallest complete interpretation flow
to the real product and stop for CEO testing before generalising it. It is the
deliverable she sells and must be corrected against her actual workflow.

**Status: bounded implementation delivered; awaiting owner review.** Migration
`0017` stores the private draft, explicit review state, immutable-at-publication
client snapshot and transition-only event trail. Migration `0018` closes the
approved shared-template rule while retaining author attribution. Insights and
the PDF read only the published snapshot; later draft edits leave it untouched.
The qualitative view adds an optional SVG word cloud with image export while
the counted list remains canonical. Client defaults and study overrides cover
identity/palette, cover copy, section visibility, journey configuration and one
focused threshold rule, and templates preserve the resulting configuration.
Both migrations are applied to the synthetic project only. Deterministic and
disposable live gates cover the new boundary; no formula or ingestion contract
changed.

**Accepted customisation scope, owner decision 2026-08-24 — not started in
P8-A.** Presentation is configurable per study through a three-level
inheritance: **Be Community default → client identity → study override**. A
study inherits until it deliberately overrides, and the override is the unit
templates carry.

Controllable concepts: logo, name and tagline; the study palette; the semantic
positive / caution / risk / neutral colours; configurable traffic-light
thresholds *and their labels*; which modules are visible and in what order; which
visualization variant a module uses among the supported ones; the cover and the
editorial copy; and, for the journey, stage order, names, descriptions, icons,
colours and metric association. The three brand modes — Be Community,
co-branded and white-label — are selected here.

**Templates must preserve this presentation configuration**, so a setup that
worked is reusable rather than rebuilt per study.

This is **bounded no-code customisation, not arbitrary CSS and not pixel
editing**. Whatever the operator chooses, the product keeps enforcing contrast,
responsive behaviour, semantic meaning, analytical honesty and accessible
fallbacks — a chosen colour that would fail contrast is corrected by the
resolver, not shipped. And C11 still holds: a module the operator switches off
produces silence on the client side, never a placeholder announcing its absence.

### P8.5 — Responsive, accessibility and usability acceptance
**Depends on:** all of the above.
**Delivers:** the acceptance matrix for C7, C8 and C9; the deterministic
plain-language string gate for C3; the responsive matrix extended to the new
routes; keyboard and focus verification; contrast verification including
adversarial tenant brand colours; reduced-motion verification; and a documented
human acceptance pass on a real phone, following the precedent set by the P6
closure record.
**Why last:** it is acceptance, not polish. It must run against the finished
surface.

### Dependency summary

```
D1 ──▶ P8.1 ──┬──▶ P8.2 ──┐
              └──▶ P8.3 ──┴──▶ P8.4 ──▶ P8.5
                    ▲               ▲
              D3,D5 ┘         D2,D4,D6
```

C10 — the security and calculation invariants — is re-proved on **every** PR in
every workstream, not once at the end.

---

## 6. Verification

| Contract | Verified by | When |
|---|---|---|
| C1 no authored structure | Source review + a scan asserting no `JSON.stringify` reaches a user-visible surface | Each PR touching Studio — **met for all four picker uses** as of the P8.2 completion unit |
| C2 progressive disclosure | Design review against the IA disclosure tables | P8.2, P8.3 |
| C3 plain language | Deterministic string gate over user-facing copy | P8.5, then every PR |
| C4 sample context | One component, one string table; `n=` absent client-side | P8.3 — **met** on screen, longitudinal views, comparison suppression and PDF |
| C5 significance | Finding block cannot render without the slot | P8.4 — **met**: structured authoring/review/publication exists, only the published snapshot reaches clients/PDF, and an empty slot renders silence |
| C6 reversibility | Mutation classification table; no `window.confirm` | P8.2 — **met**: `test:studio-completion` asserts no `window.confirm`/`alert`/`prompt` on any Studio surface, that every dialog carries object, consequence, severity and recovery, and that only the permanent severity reads as danger or requires typing |
| C7 accessibility | P8.5 matrix incl. adversarial brand colours | P8.5 |
| C8 responsive | Extended responsive matrix at six widths | P8.5 |
| C9 states | Every surface enumerated; zero `null` returns | P8.5 |
| **C10 invariants** | `typecheck`, `lint`, `test`, `build` in WSL/Linux CI, plus the live chain where the PR touches an authorized path | **Every PR** |
| C11 absence | Deterministic assertions in `scripts/design-tokens-test.mjs`: the missing-comparison and missing-qualitative copy cannot reach client output, empty wrappers are not rendered, and internal readiness still reports the same omissions | Each PR touching a client surface |

P8 introduces no new security control and removes none. If any P8 change would
alter an authorization path, a boundary schema or a calculation, that change
stops and returns for human review rather than proceeding.

---

## 7. Decisions required from the CEO / user

Seven decisions the evidence cannot settle. Each blocks or reshapes a
workstream. Recommendations are recommendations.

### D1 — Visual/product direction — **RESOLVED 2026-08-24**
The A/B/C comparison and provisional hybrid established useful hierarchy but
the owner rejected a text-led report as the product destination. The approved
direction is an **Interactive Insight Experience**: each scene follows question
→ visual evidence → consultant interpretation → action; clients move between a
guided `Recorrido` and bounded `Explorar` over the same evidence. Studio remains
a distinct no-code operational product. The real Be Community website identity
is provisional brand evidence, not a final immutable palette, and controlled
per-study Be Community/co-branded/white-label theming is required. D1 no longer
blocks P8.1. Refinement happens in the working product, not more standalone
prototypes.

### D2 — Does the consultant's interpretation live in the product?
**RESOLVED: (a), approved for P8.** Interpretation lives in the product as a
separate draft → internal review → published reading workflow.

The recorded sessions say the platform should show all the evidence and the pain
points while the recommendation stays her professional judgement, delivered as a
document she assembles. That document is currently assembled outside the product.
**Options:** (a) build the interpretation surface — private draft, internal
review, published reading, separately publishable from the numbers;
(b) keep interpretation outside the product and let her upload a finished PDF
against the study;
(c) defer to V2.5.
**Recorded recommendation: (a), now approved.**
**Impact:** (a) makes Insights able to answer *why does it matter* from inside
the product and is the single largest addition in P8 — it is new product scope,
not a re-skin, and it needs her review before implementation. (b) is far cheaper
and preserves her workflow exactly, but the client's understanding then lives in
an attachment the platform cannot connect to the evidence. (c) leaves C5
permanently partial. Blocks P8.4.

### D3 — Approval and separation of duties inside Studio
**RESOLVED: (a), approved for P8.** Keep the current role model and make review
state explicit and logged; do not claim a permission boundary that does not exist.

Today `internal` is one role: the CEO and every employee have identical
permissions, and P7 recorded a distinct consultant role as intentionally out of
scope for V2. But the CEO stated the purpose of the state model is that nothing
reaches a client before she approves it, and worried about consultants
inventing their own method.
**Options:** (a) keep one role; make review an explicit, logged workflow state
that anyone internal can move, so approval is visible but not enforced;
(b) introduce a real approver capability so only designated people can publish;
(c) change nothing.
**Recorded recommendation: (a) for P8; revisit (b) with roles in V2.5.**
**Impact:** (a) is honest, buildable inside P8, and changes no authorization
code — it gives her visibility without claiming a control that does not exist.
(b) is a genuine authorization change that reopens the role model, touches RLS
and needs its own adversarial coverage; it does not belong inside an experience
phase. (c) leaves her stated concern unaddressed. Shapes P8.2.

### D4 — Thresholds and the alert state
**RESOLVED: (a), approved for P8.** Per-client thresholds produce one focused
outside-ideal alert, not a decorative traffic-light system on every metric.

The consultant maintains a per-client *semáforo* by hand in Excel today and uses
it to decide which touchpoints to explore qualitatively. She was also explicit
that she does not want a decorative traffic light everywhere — she wants an
alert when a result sits outside the ideal.
**Options:** (a) per-client configurable thresholds producing a **single alert
state**, shown only where a result is outside the ideal;
(b) a full multi-level colour scale on every result;
(c) no thresholds in P8.
**Recorded recommendation: (a), now approved.**
**Impact:** (a) matches what she said, replaces manual Excel work, and keeps
colour meaningful — but it is new configuration surface and needs a defined
default for clients who set nothing. (b) is what her Excel looks like today and
what she explicitly stepped away from; it also makes the accessibility story
harder. (c) leaves the manual work in place and leaves the journey view unable
to show which touchpoints warranted going deeper. Shapes P8.4, and P8.2 if
configuration lands earlier.

### D5 — Template ownership
**RESOLVED: (a), approved for P8.** Templates are shared across the internal
team with visible author attribution.

Templates are filtered `.eq("created_by", user.id)`. An employee's template is
invisible to the CEO and hers to them, with nothing in the interface saying so.
**Options:** (a) templates are shared across the internal team, with the author
shown;
(b) keep them personal, and say so in the interface;
(c) personal by default with an explicit "share with the team".
**Recorded recommendation: (a), now approved.**
**Impact:** (a) matches how a small consultancy actually works and is the point
of a template library; it is a query change, not an authorization change, but it
does make one person's setup visible to colleagues. (b) is the cheapest and the
most honest about today's behaviour, but leaves the library nearly useless as
the team grows. (c) is the most flexible and the most interface to build.
Shapes P8.2.

### D6 — Word cloud, or its replacement
**RESOLVED: (c), approved for P8.** Ranked themes and attached quotes are the
default; an accessible word cloud is an optional alternate/export view.

The current theme cloud encodes count as font size, hides the count in a `title`
attribute, and floors at 12 px — a comprehension and accessibility problem. The
consultant values the cloud form and was clear that qualitative results must not
become a KPI or a percentage.
**Options:** (a) replace it with a ranked list of themes with explicit counts
and quotes attached;
(b) keep a cloud, but with accessible minimum sizes, visible counts and a list
alternative;
(c) both — list as the default, cloud as an alternative view.
**Recorded recommendation refined into approved option (c):** ranked list is
the product default; the cloud never becomes the sole evidence view.
**Impact:** (a) is the clearest and most accessible, and puts the quotes — the
strongest asset in the product — where they can be read; it loses a
presentation form she likes. (b) keeps the form but keeps most of its problems.
(c) costs an extra view but gives her the image she wants for a client deck.
Shapes P8.4.

### D7 — Scope of the client's own exploration
**RESOLVED: (a), approved for P8.** Preserve free exploration within the
existing server-side allowlist and anchor it with consultant interpretation.

The CEO was explicit that clients should be able to build their own crosses and
that interactivity is the hook, while also noting a methodological rule that
some characteristics should not be crossed with some indicators.
**Options:** (a) keep free exploration within the existing server-side allowlist,
anchored by the consultant's interpretation;
(b) additionally let the consultant mark specific combinations as not
methodologically valid, and have the product decline them with an explanation;
(c) restrict clients to comparisons the consultant has prepared.
**Recorded recommendation: (a) for P8, with (b) as a candidate for V2.5.**
**Impact:** (a) preserves her stated intent, changes no server contract, and
relies on the interpretation (D2) as the safeguard she herself described. (b)
encodes her methodology into the product and is genuinely valuable, but it is
new configuration and a new server-side rule with its own boundary validation —
real scope beyond experience design. (c) contradicts her explicit instruction
and removes the hook. Shapes P8.3.

---

## 8. What P8 must not disturb

- `p7f-suites-b-c` and every P7 document.
- Calculations, the rounding policy, the calculation catalogue.
- Ingestion semantics, the prefix convention, adapters, atomic commit, rollback.
- RLS, grants, `data_scope` enforcement, authorization guards, middleware, CSP.
- Roles. P8 introduces no new role and no new permission.
- The synthetic beta environment. P8 discovery created no infrastructure,
  touched no credentials, and made no external request.
