# Information Architecture: Be Community Studio & Insights

> Produced by the `designer-skills:information-architecture` skill in autonomous
> mode, extending the structure that exists at commit `b8fcfc4` rather than
> replacing it. Every route below is either an existing route, a split of an
> existing route, or a route required by a flow the evidence shows is missing.
>
> Reads from `.design/be-community-v2/DESIGN_BRIEF.md`.
> Evidence: `docs/P8_CURRENT_EXPERIENCE_AUDIT.md`.
> This document owns the **two experience maps** required by P8.0 §B.

---

## 1. The structural problem this solves

Today: 8 locations, one of which (`/dashboard`) is two products at once; no
study has a URL; four internal pages hand-roll four different header link sets
and one of them (`/admin/upload`) links nowhere but the dashboard; there is no
`/admin` index; and `/admin/studies` is five distinct jobs on one page.

The fix is not more pages. It is **giving the study an address**, and letting
each surface hold one job.

---

## 2. Site Map

Two products under one authentication. Role decides which shell you get; the
route prefix makes it unambiguous which product you are in.

```
/                                     redirect by role → /insights or /studio
/login                                sign-in (both audiences)
/acceso                               post-sign-in destination resolver (preserves deep links)

BE COMMUNITY INSIGHTS  (role: client)
/insights                             home — the current study's story
  /insights/estudios                  all studies available to me (only if > 1)
  /insights/e/[studyId]               one study — the data story
    /insights/e/[studyId]/recorrido        the experience map (journey)
    /insights/e/[studyId]/comparar         compare a result by characteristic
    /insights/e/[studyId]/voces            what people said
    /insights/e/[studyId]/evolucion        change across periods
    /insights/e/[studyId]/metodo           how this was measured and read
  /insights/e/[studyId]/informe.pdf   the report  (existing /api/studies/[id]/report)

BE COMMUNITY STUDIO  (role: internal)
/studio                               home — work in progress, by state
  /studio/clientes                    clients
    /studio/clientes/[tenantId]              one client: studies, people, brand
    /studio/clientes/[tenantId]/marca        visual identity, with live preview
    /studio/clientes/[tenantId]/personas     who can see what
  /studio/estudios                    all studies, filterable by client and state
    /studio/estudios/nuevo                   start: blank or from a template
    /studio/e/[studyId]                      one study — the work surface
      /studio/e/[studyId]/datos                  imports for this study
      /studio/e/[studyId]/datos/nueva            the guided import  (wizard)
      /studio/e/[studyId]/indicadores            which results appear, and how they read
      /studio/e/[studyId]/recorrido              touchpoints and their results
      /studio/e/[studyId]/cualitativo            review what people said
      /studio/e/[studyId]/interpretacion         the consultant's findings  (D2)
      /studio/e/[studyId]/vista-cliente          preview exactly as the client
      /studio/e/[studyId]/publicar               publish / unpublish / archive
  /studio/plantillas                  the template library
```

**Route changes from today**

| Today | Becomes | Why |
|---|---|---|
| `/dashboard` (client) | `/insights` + `/insights/e/[studyId]` | One page currently renders every study fully expanded (C21). Splitting gives each study an address, kills the stacked-pivot problem, and makes findings linkable (§3 of the audit). |
| `/dashboard` (internal) | `/studio` | The two products stop sharing a URL (S1). |
| `/admin/studies` | `/studio/estudios` + `/studio/plantillas` + `/studio/e/[id]/*` | Five jobs on one page (S9–S15), including an unpaginated configurator for every study in the database. |
| `/admin/upload` | `/studio/e/[id]/datos/nueva` | The import belongs to a study. Today it is a standalone page that must be told which client and study it is for, and it links nowhere else (§3.2). |
| `/admin/qualitative` | `/studio/e/[id]/cualitativo` | Same reason; the current page's first act is a study `<select>` with an "Abrir" button. |
| `/admin/clients` | `/studio/clientes` + `/studio/clientes/[id]/*` | Create-client, invite-user, rename, brand and scope are five jobs stacked on one page (S2–S8). |
| `/admin/preview/[studyId]` | `/studio/e/[studyId]/vista-cliente` | Same screen, now inside the study it belongs to. |
| `/api/studies/[id]/report` | unchanged | The authenticated server-rendered PDF route stays exactly as it is. |
| — | `/acceso` | New. Fixes the dropped-destination redirect (L5). |

**Route counts**: 8 addressable locations today → 29 proposed — 3 shared
(`/`, `/login`, `/acceso`), 9 in Insights (including the PDF route, which is
unchanged), and 17 in Studio. The increase is almost entirely a split of pages
that today do several jobs at once. Exactly two routes represent capability that
does not exist yet: `/studio/e/[id]/interpretacion` (decision D2) and the
threshold configuration inside `/studio/e/[id]/indicadores` (decision D4). If
those decisions go the other way, the count drops accordingly.

---

## 3. Navigation Model

### Insights (client)

- **Primary**: none in the conventional sense. The client's world is one study
  at a time. The shell carries the client's own brand, the study name, and a
  study switcher **only when more than one study is available**.
- **Secondary**: within a study, five named views — *Recorrido · Comparar ·
  Voces · Evolución · Método*. Tabs on wide screens; a horizontal segmented
  control on narrow ones. A view that has no content for this study is not
  rendered as an empty tab.
- **Utility**: account and sign-out, and the report download.
- **Mobile**: the study switcher collapses into the header; the five views
  become a scrollable segmented control anchored under the study title. No
  hamburger — there is not enough to hide.

Maximum depth a client ever reaches: **3** (`/insights/e/[id]/voces`).

### Studio (internal)

- **Primary**, four items, fixed: **Inicio · Clientes · Estudios · Plantillas**.
- **Secondary**: inside a study, the work surface tabs — *Datos · Indicadores ·
  Recorrido · Cualitativo · Interpretación · Vista cliente · Publicar*. These
  are the consultant's process, in order, and the tab strip doubles as the
  progress indicator: each tab shows whether that step is untouched, in
  progress, or done.
- **Contextual**: breadcrumb `Estudios › [Cliente] › [Estudio]`, because a
  consultant working across clients must always be able to answer "whose data am
  I looking at" — the current product answers that nowhere.
- **Utility**: account, sign-out, and a link into Insights as it appears to a
  client (via preview, never by role-switching).
- **Mobile**: primary navigation collapses to a bar; the study tabs become a
  scrollable strip. The guided import declares itself desk work rather than
  silently degrading.

Maximum depth: **4** (`/studio/e/[id]/datos/nueva`).

**Rule for both:** every page states where it is, and every page has a way up.
No page may be a dead end, which `/admin/upload` currently is.

---

## 4. Content Hierarchy

### `/insights` — client home

1. **What happened** — one sentence naming the study, the period, and the
   headline movement, in the consultant's voice. Today the equivalent is a
   coloured band reading "Panorama actual"; the sentence is the addition.
2. **The two or three results that matter**, each with its change since last
   period and a plain-language reliability line. Today these appear seventh on
   the page, below the journey and the quotes.
3. **Why it matters** — the consultant's interpretation, when published.
4. **Where to look next** — direct entry to the weakest touchpoint or the most
   discussed theme. This is the answer to "what should we examine or do next",
   which nothing in the product currently provides.
5. Older studies, when they exist.

### `/insights/e/[studyId]` — one study

1. Study identity and period, plus a single honest line about the base the
   whole study rests on — in words, never `n=`.
2. The results, ordered by importance rather than by computation order.
3. The experience map at a glance, with its weakest point called out.
4. What people said — themes and quotes. Currently the smallest type on the
   page; it should be among the largest, because it is the only part written by
   the people being studied.
5. Comparison entry point, framed as a question ("¿Cambia según el área?"),
   never as a pivot builder.
6. Method and report, last and always available.

### `/studio` — internal home

1. **What needs me now** — studies awaiting review, imports left staged and
   never confirmed, qualitative observations still pending. The product
   currently has no notion of pending work.
2. Recent studies with their state.
3. Start something: new study, new import.
4. Clients, as a secondary path.

### `/studio/e/[studyId]` — one study

1. Study identity, client, period, **state, and what is blocking the next
   state** — e.g. "no publicable: sin datos", which the server already enforces
   but never explains up front.
2. The process tabs, showing progress.
3. A summary of the study as it stands: counts, results present, themes
   confirmed, last import.
4. The next action, named.

---

## 5. Experience Map — Be Community Studio

### Actors and jobs

| Actor | Reality today | Jobs to be done |
|---|---|---|
| **CEO / lead consultant** (`internal`) | Non-technical. Owns method, interpretation and the client relationship. | Set a study up; get data in correctly; decide what themes mean; write the recommendation; control exactly what the client sees and when. |
| **Employee / consultant** (`internal`) | **Same permissions as the CEO** — the role does not exist separately (P7 RD1). | Prepare studies and imports; triage qualitative; draft interpretation for review. |
| *(A distinct consultant role is out of scope for V2 by prior decision — see D3.)* | | |

### Entry points

Sign-in → `/studio`. A deep link into any Studio route survives sign-in via
`/acceso`. There is no other entrance; internal users are never dropped into the
client product as they are today.

### Core flows

**F1 · Start a study**
1. `/studio/estudios/nuevo` → choose the client.
2. Choose blank, or a template — shown as *what it brings* ("6 indicadores, 5
   puntos de contacto, sabe leer el formato de *Ola 2 · 2025*"), not as
   `N métricas · N dimensiones · N mapeos`.
3. Name it and give it a period.
4. Land on `/studio/e/[id]` with the next step named: bring in the data.
   *Decision point:* template ownership is per-user today (S12) — see D5.

**F2 · Bring data in** *(the wizard; extends the existing three-step ribbon)*
1. Choose the source file. Size and type are refused at selection, as P7 PR 7
   established.
2. **Recognition** — the system says whether it already knows this instrument,
   in terms of a previous study rather than a mapping version number.
3. **Agree what the columns mean** — each column proposed with a destination
   and, where a choice is needed, options drawn from this client's existing
   metrics, characteristics and themes. Creating a new one is possible and
   explicitly marked as new, because a new one breaks comparability with earlier
   waves and the operator should know that at the moment of choosing.
4. **Check** — counts, then readable sample rows. Never JSON.
5. **Confirm** — a statement of exactly what will be written, then an atomic
   commit, then a visible, reversible batch.
   *Moment of uncertainty:* "will this break my history?" — answered in step 3,
   at the point of the decision, not afterwards.

**F3 · Agree what the results are**
`/studio/e/[id]/indicadores` — which results appear for this client, what each
is called in their language, and what "good" looks like for them. This is where
the threshold/alert concept lands (see D4). Today the nearest equivalent is nine
checkboxes, one of which is labelled *"Explorador pivote"*.

**F4 · Lay out the experience map**
`/studio/e/[id]/recorrido` — add touchpoints in order; for each, pick the result
that measures it **from a list of the results actually present in this study**.
No key is typed. Every touchpoint shows its score; only the deepened ones will
carry pain-point labels, and the interface caps those at the two or three the
method calls for.
*Trust requirement:* the consultant must be able to see immediately which
touchpoints have no data, because that is a data-collection problem she has to
solve before publishing.

**F5 · Review what people said**
`/studio/e/[id]/cualitativo` — suggestions are proposals and never publish
themselves, which is already true and must stay true. Themes are chosen and
merged from a list, not retyped. Quote approval is a separate, explicit act from
theme confirmation — as it already is in the data model, and as it must remain
in the interface. The 100-row limit becomes visible paging rather than a silent
truncation.

**F6 · Write the interpretation**
`/studio/e/[id]/interpretacion` — a private draft, structured as the questions
the client asks: what happened, why it matters, what to examine next. Evidence
from the study can be cited into it. It is invisible to the client until
publication, and publication is a separate decision from publishing the numbers.
*This flow does not exist today at all* and depends on decision D2.

**F7 · See it as the client, then publish**
`/studio/e/[id]/vista-cliente` → `/studio/e/[id]/publicar`. Publication is only
reachable through preview. The confirmation names what becomes visible and to
whom.
*Trust requirement — the strongest one in Studio:* the consultant said plainly
that the point of the state model is to stop a client seeing a dashboard before
she has approved it.

### Progressive-disclosure boundaries (Studio)

| Always visible | One interaction away | Advanced / rarely |
|---|---|---|
| Study, client, period, state, next action | Column mapping details, recoding tables, section visibility | Stable identifiers, canonical metric keys, mapping versions, stored JSON |
| Counts and what was written | Per-row import detail | Batch ids, timestamps to the second |
| Themes and their sizes | Individual observations and their history | Suggestion rule internals |
| Who can see what, in a sentence | Which values are included | The scope structure itself |

### Success criteria (Studio)

- A non-technical consultant completes a full study — create, import, configure,
  triage, interpret, preview, publish — **without typing a single identifier,
  key or JSON fragment.**
- She can answer "what needs me right now" from the home page.
- Every destructive action is previewed before and reversible after.
- She can always see exactly what the client will see, before the client can.

---

## 6. Experience Map — Be Community Insights

### Actors and jobs

| Actor | Reality | Jobs to be done |
|---|---|---|
| **Client decision-maker** (director, principal, chapter lead) | Non-technical, time-poor, will look on a phone first and a laptop later. Currently receives an aggregate-only view enforced at the server. | Understand the result; decide whether to believe it; find what to act on; take something into a meeting. |
| **Scoped client user** (`data_scope` set) | Sees only their own slice, enforced server-side. Does not know that. | The same, for their own area — and to understand why their numbers differ from a colleague's. |

### Entry points

An emailed link from the consultant is the realistic first contact. **That link
must survive sign-in** — it does not today (L5). Sign-in then lands on the
study, not on a generic portal.

### Core flows

**F8 · First look**
Sign in → `/insights` → the sentence, the two or three results, the
interpretation, and one named next step. The client should be able to stop here
and still have got the answer. Today they land on a header, a coloured band, a
trend chart, then *"Tus estudios"*, then a card whose seventh element is the
headline number.

**F9 · Test it**
Open a result → what it means, how it is calculated, what it rests on, how it
changed. Then compare it by a characteristic. Then narrow to their own area.
How freely the client may combine characteristics and results is decision D7;
this map assumes the existing server-side allowlist and no additional
methodological restriction.
*Moment of uncertainty:* "is this enough people to believe?" — the answer travels
with the number, in words, at every level, and the disclosure floor is explained
as protection of the respondents rather than as a system limitation.

**F10 · Walk the experience map**
Every touchpoint shows its score; the weakest is called out; the deepened ones
open into two or three pain points with the quotes behind them. Selecting a
touchpoint works by tap, click and keyboard — never by hover alone.

**F11 · Hear the people**
Themes with honest sizes and approved quotes. Explicitly **not** converted into
a KPI or a percentage — the consultant was direct about that. The word cloud
question is a real fork; see D6.

**F12 · Compare across periods**
Only offered when a comparable period exists, and explained when it does not —
today the whole section silently disappears (C6).

**F13 · Take it away**
The report, and charts as images for the client's own deck. The report reflects
the filters actually applied and says so. Both artefacts were named by the
consultant; only the first partly exists.

### Progressive-disclosure boundaries (Insights)

| Always visible | One interaction away | Advanced / on request |
|---|---|---|
| What happened, why it matters, what to look at next | The result's method, its base, its history | Formula definitions, disclosure thresholds, exact denominators |
| The reliability of a number, in words | The breakdown behind it (promoters, top-box) | The acronym and the standard behind it |
| Themes and quotes | Which touchpoint they belong to | Review provenance |
| The experience map | One touchpoint in detail | Metric keys — **never** |
| That some results are hidden to protect respondents | Why, and what would change it | — |

### Trust requirements (Insights)

1. The number and its reliability arrive together, always, in the same voice.
2. Nothing individual is ever reachable — currently guaranteed by construction
   and non-negotiable.
3. Free exploration is encouraged (the CEO's explicit instruction) but is
   anchored by the consultant's interpretation, so a two-person slice cannot
   masquerade as a finding.
4. Absence is stated. A missing period, an unmeasured touchpoint and a
   suppressed theme each say so.
5. The client's own brand appears, legibly, in both light and dark.

### Success criteria (Insights)

- A non-technical reader can answer *what happened, why it matters, what next,
  how much to trust it* from the first screen, on a phone.
- No implementation term is visible anywhere: no JSON, no `data_scope`, no
  canonical key, no `pivot`, no bare `n=`.
- Every hidden or missing result is explained rather than absent.
- Something can be taken into a meeting without a screenshot.

---

## 7. Naming Conventions

The full terminology transformation — current technical term, internal wording,
client wording, methodological wording and where each is revealed — is in
`docs/P8_CURRENT_EXPERIENCE_AUDIT.md` §5, and is not duplicated here. This
section fixes only the **structural** labels: what things are called in
navigation and headings.

| Concept | Label in UI | Notes |
|---|---|---|
| The internal product | **Be Community Studio** | Never "backoffice", "panel interno" or "admin". |
| The client product | **Be Community Insights** | The client mostly sees their own brand; the product name is quiet. |
| A study | **Estudio** | Already correct and already the CEO's word. |
| A client organisation (`tenant`) | **Cliente** | Never "tenant", never "organización" — the CEO says *cliente*. |
| A person with access | **Persona** / **Acceso** | "Usuario cliente" is system vocabulary. |
| A study's journey | **Recorrido** (heading) / **Mapa de experiencia** (full name) | "Journey map" survives only as the recognised full name in the consultant's own material. |
| A journey stage | **Punto de contacto** / **Momento** | The consultant says *touchpoint* and *punto de contacto*. |
| A computed indicator | **Resultado** (client) / **Indicador** (Studio) | "Métrica" is engineering vocabulary. |
| A segmentation dimension | **Característica** | Never "dimensión", never "segmento" client-side. |
| A cross / pivot | **Comparar** | Verb, not noun. "Pivote" disappears entirely. |
| An import | **Carga de datos** | "Lote"/"batch" only in the detail view. |
| A saved mapping | *(no user-facing noun)* | Expressed as recognition: "ya sabemos leer este formato". |
| A template | **Plantilla** | Already correct. |
| The report | **Informe** | Already correct. |
| The consultant's interpretation | **Interpretación** (Studio) / **Lectura del consultor** (client) | Distinguishes the private draft from the published reading. |
| Sample sufficiency | **Base** — always with a plain sentence | `n=` never appears in either product. |

---

## 8. Component Reuse Map

| Component | Used on | Behaviour differences |
|---|---|---|
| Root shell (tokens, `lang="es"`, skip link, landmarks) | every route | none |
| Insights shell | `/insights/**` | Tenant brand applied through the contrast resolver |
| Studio shell | `/studio/**` | Be Community identity; persistent nav + breadcrumb |
| Auth shell | `/login`, `/acceso` | Neutral; belongs to neither product |
| Study header | `/insights/e/[id]/**`, `/studio/e/[id]/**` | Studio adds state and blockers; Insights shows period and base only |
| Finding block | `/insights/**`, PDF | PDF renders the static form of the same content |
| Indicator card | `/insights/**`, `/studio/e/[id]/indicadores`, PDF | Studio adds configuration; PDF is static |
| Sample-context badge | everywhere a number appears, PDF included | One component, one vocabulary, no exceptions |
| Journey map | `/insights/e/[id]/recorrido`, `/studio/e/[id]/recorrido`, `/studio/…/vista-cliente`, PDF | Studio is editable; Insights is readable; the PDF is static |
| Comparison | `/insights/e/[id]/comparar` | Same server contract and allowlist as today |
| Qualitative themes & quotes | Insights, Studio triage, PDF | Studio shows unconfirmed items; the client never does |
| Wizard chrome | `/studio/e/[id]/datos/nueva`, `/studio/estudios/nuevo` | Import is the long form; study creation is the short one |
| Picker (chips from real values) | data scope, metric choice, theme merge, mapping targets | One component, four uses — this is what retires the free text |
| Destructive dialog | rollback, delete access, unpublish | Type-to-confirm only where truly irreversible |
| State set (empty / loading / error / insufficient) | every data surface | Named variants, never `null` |
| Preview banner | `/studio/e/[id]/vista-cliente` | Extends the existing amber banner |

---

## 9. Content Growth Plan

| Grows | Today | Plan |
|---|---|---|
| Studies per client, over years | Every study fully rendered on one page | Study list with its own address; the client home features the current one and links the rest |
| Studies across all clients | Unpaginated `<details>` for **every** study, plus an unpaginated study list, on `/admin/studies` | `/studio/estudios` with filter by client, state and period, and paging |
| Client user accounts | `listAllUsers` pages through **every** auth account on each render | Scoped per client, searchable, paged |
| Qualitative observations | Hard `.limit(100)` with **no indication of truncation** | Visible paging with counts, plus filter by review state |
| Import history | `.limit(30)` global | Scoped to the study, paged, with a global recent view on `/studio` |
| Themes per study | Unbounded pill cloud, sized by count | Ranked list with an explicit "show all"; size never encodes quantity |
| Templates | Per-user only, invisible across the team | Depends on D5 |
| Periods in a trend | Line chart regardless of point count | List form below four points; chart above |

---

## 10. URL Strategy

- **Pattern**: `/{producto}/{recurso}/{id}/{vista}` — e.g.
  `/insights/e/6f2…/recorrido`, `/studio/e/6f2…/cualitativo`.
- **`/e/` for a study** keeps study URLs short enough to paste into an email,
  which is the real distribution channel.
- **Dynamic segments**: `studyId` and `tenantId` are UUIDs, already validated
  with Zod at every boundary that consumes them. That validation stays; no
  slug is introduced, because a slug would leak a client's name into a URL.
- **Query parameters**:
  - Filter state is expressed as `?ver.{caracteristica}={valor}` so a client can
    share the exact view they are looking at. This replaces today's
    component-state-only filters, and reuses the existing `f.*` convention
    already accepted by the report route — the report link is then built from
    the same source of truth rather than assembled separately.
  - Comparison state as `?por={caracteristica}&resultado={id}`.
  - Studio list filters as `?cliente=&estado=&periodo=`.
  - Paging as `?p=`.
  - **No personal data, no scope values that identify a person, and no email
    address ever appears in a URL.**
- **Flash messages leave the URL.** `?ok=` / `?error=` are replaced by a live
  region, so a shared link never carries "Usuario eliminado" in it.
- **Post-sign-in**: `/acceso?destino=` carries an **internal path only**,
  validated against an allowlist of known route shapes before redirect — an
  open-redirect guard, and the fix for the destination currently dropped at L5.
