# P7 adversarial harness — design note (PR 5)

> **Type:** design-only deliverable required by `docs/P7_PLAN.md` §6.1.
> **Status:** proposed, **not implemented**. No harness code, script, npm script,
> dependency, migration, CI configuration or fixture exists as a result of this
> document. Per §6.1, PR 5 does not start until a human approves this note.
> **Evidence date:** 2026-08-22 (local), against `origin/main`
> `4d7974c7f1e2224dab1a95bee25f2e3145598cae`.
> Read `CLAUDE.md`, `docs/CURRENT_STATE.md` and `docs/P7_PLAN.md` first; this
> document does not replace them and cannot relax them.

---

## 0. What this harness is, and what it is not

PR 5 delivers **only** the mechanism by which later suites reach the running
application as a specific identity, and the evidence format they record. It
contains **no security assertion of its own**. Suites A, B, C and E (PRs 6–8) are
the callers; they own their verdicts.

The harness therefore has exactly one success condition: *a later suite author
can express "actor X attempted operation Y and the application's own
authorization path answered Z" without inventing transport, without touching
private framework internals, and without a bypass.*

Three prohibitions are structural, not stylistic. They are repeated here because
they constrain every section below:

1. **No hashed `Next-Action` identifier is ever synthesized, scraped, parsed,
   read from a chunk, read from rendered HTML, cached, or transmitted by harness
   code.** Where a Server Action must be invoked, a real browser constructs the
   request.
2. **No React Server Component / Server Action wire payload is ever hand-built.**
   `encodeReply`, the `text/x-component` format, `$ACTION_ID_*` fields and the
   multipart action encoding are private framework serialization and are treated
   as such.
3. **No environment flag, hidden bypass, alternate authorization path or
   test-only backdoor is added to the application.** This design introduces **no
   test seam at all** (§2.5) — every surface is reachable through an interface
   the product already exposes to real users.

---

## 1. Current surface inventory

All paths are relative to the repository root. Line numbers are as of the
baseline commit above.

### 1.1 Middleware — the first gate for every surface

| Item | Source | Behavior relevant to the harness |
|---|---|---|
| Edge middleware entry | [`src/middleware.ts:8`](../src/middleware.ts) (`middleware`), matcher at `:12` | Runs on every path except `_next/static`, `_next/image`, `favicon.ico` and image extensions |
| Session gate | [`src/lib/supabase/middleware.ts:42`](../src/lib/supabase/middleware.ts) (`updateSession`) | `getUser()` at `:79-81` revalidates the JWT against Supabase Auth. Unauthenticated + non-public → **302 to `/login`** (`:89-93`). Authenticated + `/login*` → **302 to `/dashboard`** (`:95-99`) |
| Public routes | same file, `:84-87` | `/login*`, `/`, `/api/health*`. Everything else is protected |
| CSP / nonce | same file, `buildCsp` `:11`, applied `:103` | `frame-ancestors 'none'`, `form-action 'self'`, nonce + `strict-dynamic` `script-src`. Suite E consumes this; the harness only records the headers |

**Consequence for the harness:** the *unauthenticated* answer for every protected
page is a middleware redirect, not a page-level 401. The report route is the one
protected surface that is also independently guarded in its own handler. Suites
must be able to tell "middleware redirected" from "handler rejected" — see §5.3.

### 1.2 Pages (server-rendered, protected)

| # | Route | Source / export | Authorization requirement | Unauthenticated result | Wrong-role result |
|---:|---|---|---|---|---|
| P1 | `/` | [`src/app/page.tsx:6`](../src/app/page.tsx) `Home` | public | `redirect("/dashboard")` at `:7`, then middleware redirects to `/login` | n/a |
| P2 | `/login` | [`src/app/login/page.tsx:8`](../src/app/login/page.tsx) `LoginPage` | public; authenticated users are bounced to `/dashboard` | 200 | n/a |
| P3 | `/dashboard` | [`src/app/dashboard/page.tsx:38`](../src/app/dashboard/page.tsx) `DashboardPage` | any authenticated user; `getUser()` at `:46`, `redirect("/login")` at `:49`; role/tenant/`data_scope` read at `:52-56` | 302 `/login` | n/a — both roles legitimately render, with different content |
| P4 | `/admin/clients` | [`src/app/admin/clients/page.tsx:27`](../src/app/admin/clients/page.tsx) `ClientsPage` | `internal` only; `getUser()` `:29`, role check `:31-33` → `redirect("/dashboard")` | 302 `/login` | 302 `/dashboard` |
| P5 | `/admin/studies` | [`src/app/admin/studies/page.tsx:29`](../src/app/admin/studies/page.tsx) `StudiesPage` | `internal` only; `:31-34` | 302 `/login` | 302 `/dashboard` |
| P6 | `/admin/qualitative` | [`src/app/admin/qualitative/page.tsx:20`](../src/app/admin/qualitative/page.tsx) `QualitativePage` | `internal` only; `:22-25` | 302 `/login` | 302 `/dashboard` |
| P7 | `/admin/upload` | [`src/app/admin/upload/page.tsx:13`](../src/app/admin/upload/page.tsx) `UploadPage` | `internal` only; `getUser()` `:22`, role check `:27-31` | 302 `/login` | non-200 / redirect per `:31` (see AM4) |
| P8 | `/admin/preview/[studyId]` | [`src/app/admin/preview/[studyId]/page.tsx:29`](../src/app/admin/preview/%5BstudyId%5D/page.tsx) `ClientPreviewPage` | `internal` only; uuid guard `:31` → `notFound()`, `getUser()` `:34`, role check `:36-38`, study existence `:41` → `notFound()` | 302 `/login` | 302 `/dashboard` |

**8 pages; 6 protected (P3–P8); 5 of those `internal`-only (P4–P8), 4 with a
distinct wrong-role redirect destination (P4, P5, P6, P8).**

### 1.3 Ordinary HTTP route handlers

| # | Route | Source / export | Authorization requirement | Distinct outcomes the harness must separate |
|---:|---|---|---|---|
| H1 | `GET /api/health` | [`src/app/api/health/route.ts:11`](../src/app/api/health/route.ts) `GET` | **public by design** (middleware `:87`) | 200 `{"supabase":true}` / 503 degraded |
| H2 | `GET /api/studies/[studyId]/report` | [`src/app/api/studies/[studyId]/report/route.ts:23`](../src/app/api/studies/%5BstudyId%5D/report/route.ts) `GET` | authenticated **and** authorized for that study via `loadAuthorizedStudyData` | **401** unauthenticated (`:29`) · **404** malformed uuid (`:32`) · **404** unauthorized/absent study (`:34`) · **404** report section disabled (`:37`) · **400** bad filter params (`:39`, `:43`) · **200** `application/pdf` |

**2 route handlers; 1 protected (H2).** H2 is the single richest ordinary-HTTP
target in the application: it is the only surface that distinguishes *deny*,
*not-found*, *validation rejection* and *success* in its own status codes, and it
carries R2 (`data_scope`), R10 (parameter injection) and part of R7 (PDF).

### 1.4 Mutation surfaces — Server Actions, by endpoint class

`loadAuthorizedStudyData` ([`src/lib/studies/authorized.ts:69`](../src/lib/studies/authorized.ts))
and the `internalContext()` guards are the two authorization paths behind
everything below.

#### Class M-A — session lifecycle (progressive-enhancement forms, Server Components)

| # | Action | Source | Rendered by | Authorization |
|---:|---|---|---|---|
| M-A1 | `login` | [`src/app/login/actions.ts:13`](../src/app/login/actions.ts) | `<form action={login}>` — [`src/app/login/page.tsx:38`](../src/app/login/page.tsx), fields `email` `:46-53`, `password` `:63-70`, submit `:73-78` | none (it *is* the authentication boundary); Zod `loginSchema` at `:17`; only fixed error codes leave the server (`:24`, `:32`) |
| M-A2 | `logout` | [`src/app/dashboard/actions.ts:7`](../src/app/dashboard/actions.ts) | `<form action={logout}>` — [`src/app/dashboard/page.tsx:151`](../src/app/dashboard/page.tsx), submit button `:152-157` | authenticated (rendered only on the authenticated dashboard) |

#### Class M-B — `internal`-only admin mutations rendered as Server-Component forms

Every action in this class is guarded by an `internalContext()` helper that calls
`getUser()`, redirects to `/login` when absent, and throws `"Acceso denegado."`
when `profiles.role !== "internal"`:
[`clients/actions.ts:16`](../src/app/admin/clients/actions.ts),
[`qualitative/actions.ts:13`](../src/app/admin/qualitative/actions.ts),
[`studies/actions.ts:18`](../src/app/admin/studies/actions.ts).

| # | Action | Source | Rendered by (form + key fields) | Mutation |
|---:|---|---|---|---|
| M-B1 | `createTenant` | `clients/actions.ts:53` | `clients/page.tsx:60` — `name` `:62`, submit "Crear cliente" `:63` | creates a tenant |
| M-B2 | `renameTenant` | `clients/actions.ts:63` | `clients/page.tsx:80` — hidden `tenant_id`, `name`, submit "Guardar" | renames a tenant |
| M-B3 | `updateTenantBrand` | `clients/actions.ts:76` | `clients/page.tsx:82` — hidden `tenant_id` + branding fields | writes branding, uploads a logo |
| M-B4 | `inviteClientUser` | `clients/actions.ts:130` | `clients/page.tsx:65` — `tenant_id`, `email`, `full_name` `:67`, `data_scope` `:69`, submit "Enviar invitación" `:70` | creates an auth user + `client` profile (`:152`) |
| M-B5 | `updateClientUser` | `clients/actions.ts:164` | `clients/page.tsx:106` — hidden `user_id`, `full_name`, `tenant_id`, `data_scope`, submit "Guardar usuario" | moves a client user / rewrites `data_scope` |
| M-B6 | `deleteClientUser` | `clients/actions.ts:183` | `clients/page.tsx:107` — hidden `user_id`, `confirmation_email`, submit "Eliminar cuenta cliente" | **destructive**; email confirmation + `role === "client"` re-check at `:189-193` |
| M-B7 | `generateSuggestions` | `qualitative/actions.ts:26` | `qualitative/page.tsx:53` — hidden `study_id`, submit "Generar sugerencias pendientes" | writes suggested themes |
| M-B8 | `reviewObservations` | `qualitative/actions.ts:45` | `qualitative/page.tsx:54` — hidden `study_id`, checkboxes `observation_id` and `quote_id` (each with `aria-label="Publicar cita <id>"`), `theme`, `stage_key`, and three submit buttons `name="mode"` with values `accept` / `retag` / `reject` | confirms/rejects themes and flips `quote_approved` — the **publication boundary** |
| M-B9 | `createBlankStudy` | `studies/actions.ts:31` | `studies/page.tsx:62` — `tenant_id`, `name`, `period`, submit "Crear y cargar datos" | creates a study, redirects to `/admin/upload` (`:48`) |
| M-B10 | `createStudyFromTemplate` | `studies/actions.ts:51` | `studies/page.tsx:73` — hidden `template_id`, `tenant_id`, `name`, `period`, submit "Usar plantilla" | instantiates a study (copy semantics) |
| M-B11 | `saveStudyAsTemplate` | `studies/actions.ts:71` | `studies/page.tsx:90` — `study_id`, `template_id`, `name`, `description`, submit "Guardar como plantilla" | creates/overwrites a template |
| M-B12 | `updateTemplateMetadata` | `studies/actions.ts:100` | `studies/page.tsx:81` — hidden `template_id`, `name`, `description`, submit "Guardar nueva versión" | new template version |
| M-B13 | `deleteTemplate` | `studies/actions.ts:124` | `studies/page.tsx:82` — hidden `template_id`, required confirm checkbox, submit "Eliminar plantilla" | **destructive** |

#### Class M-C — `internal`-only mutation rendered inside a Client Component form

| # | Action | Source | Rendered by | Note |
|---:|---|---|---|---|
| M-C1 | `updateStudyConfiguration` | [`studies/actions.ts:134`](../src/app/admin/studies/actions.ts) | `<form action={updateStudyConfiguration}>` at [`StudyConfigurator.tsx:41`](../src/app/admin/studies/StudyConfigurator.tsx) — a **`"use client"`** component (`:1`); hidden `study_id` `:42`, `name`/`period`/`status` `:43`, `section_*` checkboxes `:45`, `stage_id`/`stage_label`/`stage_metric` `:49-51` (each with an `aria-label`), submit "Guardar configuración" `:56` | Stage rows are added/removed by client state (`useState` `:30`, `type="button"` handlers `:47`, `:52`). The **submit path itself** binds a Server Action to a `<form>`; whether it degrades without JavaScript is an empirical question — see §1.6 |

#### Class M-D — imperative Server Actions called from client code (no form binding)

| # | Action | Source | Called from | Argument shape |
|---:|---|---|---|---|
| M-D1 | `analyzeImportFile` | [`upload/actions.ts:195`](../src/app/admin/upload/actions.ts) | [`UploadForm.tsx:144`](../src/app/admin/upload/UploadForm.tsx) inside `startTransition` `:143` | `FormData` built in JS (`actionData()`) |
| M-D2 | `previewImportFile` | `upload/actions.ts:255` | `UploadForm.tsx:180` | `FormData` |
| M-D3 | `confirmImportFile` | `upload/actions.ts:306` | `UploadForm.tsx:197` | `FormData` |
| M-D4 | `rollbackLatestImport` | `upload/actions.ts:408` | `UploadForm.tsx:210` | **plain `string`** — cannot be expressed as a form submission at all |
| M-D5 | `refreshStudyDashboard` | [`dashboard/data-actions.ts:38`](../src/app/dashboard/data-actions.ts) | [`StudyCard.tsx:42`](../src/app/dashboard/StudyCard.tsx) inside `startTransition` `:41`, triggered by the filter `<select onChange>` at `:58` | `(string, SegmentFilters)` — plain JS values |
| M-D6 | `computeStudyPivot` | `dashboard/data-actions.ts:63` | [`PivotExplorer.tsx:31`](../src/app/dashboard/PivotExplorer.tsx) inside `startTransition` `:30` | `(string, SegmentFilters, PivotIntent)` — plain JS values |

M-D1–M-D4 are guarded by `authorizeInternal()`
([`upload/actions.ts:78`](../src/app/admin/upload/actions.ts), `getUser()` `:83`,
role check `:91-93`) and return a **typed error object**, never a redirect or a
throw. M-D5/M-D6 are guarded by `authenticatedStudy()`
([`data-actions.ts:30`](../src/app/dashboard/data-actions.ts), `getUser()` `:32`)
plus `loadAuthorizedStudyData`, and return `{ ok: false, error }`. This
difference is load-bearing: for class M-D, **denial is a 200 response carrying a
rejection object**, and §5.3 must not read that as success.

#### Class M-E — ordinary `GET` navigation form (no Server Action)

| # | Surface | Source | Note |
|---:|---|---|---|
| M-E1 | study selector on `/admin/qualitative` | `<form method="get">` at [`qualitative/page.tsx:50`](../src/app/admin/qualitative/page.tsx), field `study`, submit "Abrir" | Plain HTML `GET`; equivalent to `GET /admin/qualitative?study=<id>`. Not a mutation. Belongs to the direct-HTTP class |

### 1.5 Inventory counts

| Category | Count | Ids |
|---|---:|---|
| Pages inventoried | 8 | P1–P8 |
| — protected pages | 6 | P3–P8 |
| — `internal`-only pages | 5 | P4–P8 |
| Ordinary HTTP route handlers | 2 | H1–H2 |
| — protected route handlers | 1 | H2 |
| Mutation surfaces (Server Actions) | 22 | M-A1–2, M-B1–13, M-C1, M-D1–6 |
| — form-rendered (`<form action={…}>`) | 16 | M-A1–2, M-B1–13, M-C1 |
| — imperative, client-invoked | 6 | M-D1–6 |
| — requiring the `internal` role | 18 | M-B1–13, M-C1, M-D1–4 |
| — requiring study authorization instead | 2 | M-D5, M-D6 |
| — destructive | 3 | M-B6, M-B13, M-D4 (import rollback) |
| Ordinary `GET` navigation forms | 1 | M-E1 |

**Total protected surfaces the P7 suites must reach: 6 pages + 1 route handler +
22 Server Actions = 29. Total rows in the mechanism table (§2.1), including the
two public HTTP surfaces and M-E1: 31.**

### 1.6 Which interactions genuinely support progressive enhancement — and the proof standard

The design does **not** accept "there is a `<form>` tag" as evidence. Two
different standards apply.

**Structural evidence (sufficient to *propose* the class, not to *use* it).**
M-A1, M-A2 and M-B1–M-B13 are rendered by Server Components — none of their files
contains `"use client"` (verified: the only `"use client"` files in `src/` are
`StudyConfigurator.tsx`, `UploadForm.tsx`, `JourneyMap.tsx`,
`LongitudinalTrends.tsx`, `PivotExplorer.tsx`, `QualitativeInsights.tsx`,
`StudyCard.tsx`). Their forms carry no `onSubmit`, no `useActionState`, no
`preventDefault`, and every field the action reads is a real named DOM control
whose value exists in the document before any JavaScript runs. Nothing in the
submit path depends on client state.

M-C1 is the exception: the form is inside a `"use client"` component and its
stage rows are produced from `useState`. The *submit* is still a plain
action-bound `<form>`, but the *content* is client-generated.

M-D1–M-D6 have no form binding at all. M-D4 takes a bare string. These cannot be
progressively enhanced by construction.

**Behavioral proof (required before any suite relies on it).** The harness
classifies a surface as progressive-enhancement-capable only after
`assertDegrades()` (§8) has, in a browser context created with **JavaScript
disabled**, loaded the page, submitted the form through the browser's own native
HTML form machinery, and observed the application's expected server-side outcome.
No harness code reads, parses or transmits the hidden fields the framework places
in that form — the browser submits them as part of its own DOM, exactly as a
no-JS user agent does. If `assertDegrades()` fails for a surface, that surface is
**automatically demoted to the browser mechanism** (§2.2). Demotion is a
pre-authorized, recorded outcome, not a design gap.

### 1.7 Which interactions require the application's own browser runtime

M-C1 and M-D1–M-D6 (7 surfaces). For M-D there is no alternative: the request is
constructed by React from JS values inside `startTransition`, and reproducing it
outside the browser would mean hand-building the wire payload — prohibition 2.
M-C1 requires the browser to *build the form's stage rows* even if its submit
degrades.

### 1.8 Named ambiguities — resolved by design, not by probing production

Per the efficiency rules, nothing below was resolved by invoking the deployed app.

| # | Ambiguity | How the design resolves it |
|---|---|---|
| AM1 | Does M-C1 (`updateStudyConfiguration`, client-component form) degrade without JavaScript? | Not decidable from source: it depends on React DOM's SSR of a client-component action form. Resolved by `assertDegrades()` at run time, with **browser** as the pre-declared mechanism regardless (§2.1, row M-C1). No row is left TBD |
| AM2 | `inviteClientUser` (M-B4) sends an invitation email through Supabase Auth | Treated as an **external side effect**. Suite B exercises it only for its *denial* paths (unauthenticated, `client` role), which never reach the send. The positive-path invitation is out of the harness's fixture scope (§6.5) |
| AM3 | `updateTenantBrand` (M-B3) writes to Storage, not only to Postgres | Residue accounting for Storage objects is deferred to the suite that exercises the positive path; PR 5's ledger records the object key it created and the same finally-block cleanup contract applies (§6) |
| AM4 | Whether `/admin/upload` (P7) answers a `client` caller with a redirect or a rendered denial | `upload/page.tsx:31` branches on role, but the branch body was not pinned to a specific status in this pass. The harness records the observed outcome as evidence and Suite B asserts *"not a successful render of the upload UI"* rather than a specific status |

---

## 2. Mechanism decision per endpoint class

Four mechanisms exist. **Exactly one is assigned to every inventoried surface.**

- **`http`** — direct HTTP request from Node (`fetch`, `redirect: "manual"`),
  carrying an actor cookie jar. No browser.
- **`form`** — native browser form submission in a **JavaScript-disabled**
  browser context. The browser's own HTML machinery constructs the POST; harness
  code never inspects or reproduces any framework field.
- **`browser`** — real interaction through the application's own client runtime:
  a JavaScript-enabled browser context, controls located semantically (§4.1), the
  framework builds the request.
- **`seam`** — a reviewed stable test seam. **Not used anywhere in this design.**

### 2.1 Decision table

| Surface | Class | Mechanism | Why this one, and why not a weaker one |
|---|---|---|---|
| P1 `/` | page | `http` | Ordinary GET; the assertion is the redirect chain. A browser adds nothing |
| P2 `/login` | page | `http` | Ordinary GET; also the source of the header assertions Suite E2/E3 will consume |
| P3 `/dashboard` | page | `http` | Ordinary GET. Content assertions that need layout stay with the existing `test:responsive-live`, not this harness |
| P4 `/admin/clients` | page | `http` | Ordinary GET; the whole assertion is status + `Location` |
| P5 `/admin/studies` | page | `http` | same |
| P6 `/admin/qualitative` | page | `http` | same |
| P7 `/admin/upload` | page | `http` | same (see AM4) |
| P8 `/admin/preview/[studyId]` | page | `http` | same; also carries the `notFound()` vs `redirect()` distinction |
| H1 `GET /api/health` | route handler | `http` | Public, unauthenticated; also the readiness probe (§4.3) |
| H2 `GET /api/studies/[studyId]/report` | route handler | `http` | Ordinary GET with a rich status vocabulary. `docs/P7_PLAN.md` §6.1 says explicitly that route handlers need no browser |
| M-E1 qualitative study selector | GET form | `http` | Plain HTML GET with no Server Action; issuing the equivalent GET is the same request the browser would send |
| M-A1 `login` | PE form | `form` | Verified by `assertDegrades()`; it is also how every actor's session is minted (§3.2). Fallback on failure: `browser` |
| M-A2 `logout` | PE form | `form` | Same standard; needed for the session-invalidation cases (§3.4). Fallback: `browser` |
| M-B1 `createTenant` | PE form | `form` | Server-Component form, plain named fields. Fallback: `browser` |
| M-B2 `renameTenant` | PE form | `form` | same |
| M-B3 `updateTenantBrand` | PE form | `form` | same (a file field submits natively; see AM3) |
| M-B4 `inviteClientUser` | PE form | `form` | same; denial paths only (AM2) |
| M-B5 `updateClientUser` | PE form | `form` | same — the `data_scope` write R2 depends on |
| M-B6 `deleteClientUser` | PE form | `form` | same; destructive, fixture-only (§6) |
| M-B7 `generateSuggestions` | PE form | `form` | same |
| M-B8 `reviewObservations` | PE form | `form` | same; the three `name="mode"` submit buttons are ordinary named submitters that a no-JS browser sends correctly |
| M-B9 `createBlankStudy` | PE form | `form` | same |
| M-B10 `createStudyFromTemplate` | PE form | `form` | same |
| M-B11 `saveStudyAsTemplate` | PE form | `form` | same |
| M-B12 `updateTemplateMetadata` | PE form | `form` | same |
| M-B13 `deleteTemplate` | PE form | `form` | same; destructive, fixture-only |
| M-C1 `updateStudyConfiguration` | client-component form | **`browser`** | Stage rows are client state (`StudyConfigurator.tsx:30,47,52`), so the browser runtime is needed to compose the form even if the submit degrades. `assertDegrades()` may additionally record that it degrades; that record never downgrades the mechanism |
| M-D1 `analyzeImportFile` | imperative | `browser` | Called from `startTransition` with JS-built `FormData`; no form binding exists |
| M-D2 `previewImportFile` | imperative | `browser` | same |
| M-D3 `confirmImportFile` | imperative | `browser` | same |
| M-D4 `rollbackLatestImport` | imperative | `browser` | Takes a bare `string`; a form cannot express it at all |
| M-D5 `refreshStudyDashboard` | imperative | `browser` | Triggered by a filter `<select onChange>`; the framework serializes plain JS values |
| M-D6 `computeStudyPivot` | imperative | `browser` | same; the forged-pivot-intent case (C3) is produced by driving the real controls into a rejected combination, never by posting a synthesized intent |

**Rows: 31. `TBD`: 0. `seam`: 0.**

### 2.2 The demotion rule (why no row is conditional)

Every `form` row has a **declared mechanism** (`form`) and a **declared fallback**
(`browser`). `assertDegrades()` selects between them at run time and records
which was used in the evidence record (§5.1). Both are approved mechanisms, so
the fallback needs no second review. Demotion is one-directional: a surface may
move `form → browser`, never `browser → form`, and never toward `seam`.

### 2.3 What each mechanism may and may not touch

| | reads rendered HTML | reads framework hidden fields | constructs the request | carries cookies |
|---|---|---|---|---|
| `http` | only for evidence classification (status, `Location`, `content-type`) — never to extract a form field | **never** | Node `fetch`, plain URL + method | from the actor jar |
| `form` | only semantically, to *locate* the form (§4.1) | **never** — the browser submits its own DOM | the browser's native HTML form machinery | browser context |
| `browser` | only semantically, to *locate* controls | **never** | the application's own React runtime | browser context |

### 2.4 Why not the tempting shortcut

A Node HTTP client *could* parse a rendered `<form>`, collect all of its inputs
including the framework's hidden fields as opaque blobs, and POST them. That is
faster than a browser and would work. **It is rejected**: it reads the hashed
action identifier, which prohibition 1 admits no exception for, and it would
silently couple the harness to a private format that is free to change. The
JavaScript-disabled browser context achieves the identical proof — *this form
works without client JavaScript* — while the identifier never enters harness
memory. See R-1b in §10.

### 2.5 No test seam is proposed

`docs/P7_PLAN.md` §6.1's third option is not exercised. All 31 surfaces are
reachable through an interface the product already exposes to real users. Adding
a seam would create a new authorization-adjacent surface requiring its own Suite
B coverage, for zero assertion gain. **If a future suite believes it needs a
seam, that is a new design review, not an implementation detail of PR 5.**

---

## 3. Authentication and session model

### 3.1 Actors

Three synthetic identities already exist in the connected synthetic project and
are already consumed by `scripts/isolation-test.mjs` and
`scripts/responsive-layout-test.mjs` through `.env.local`:

| Actor id | Env credentials | Role | Purpose |
|---|---|---|---|
| `tenantA` | `TEST_USER_A_EMAIL` / `TEST_USER_A_PASSWORD` (+ `TEST_TENANT_A_ID`) | `client` | data-rich tenant; the legitimate-access positive control |
| `tenantB` | `TEST_USER_B_EMAIL` / `TEST_USER_B_PASSWORD` (+ `TEST_TENANT_B_ID`) | `client` | the cross-tenant pair with `tenantA` |
| `internal` | `TEST_INTERNAL_EMAIL` / `TEST_INTERNAL_PASSWORD` | `internal` | admin positive control; the only actor that may legitimately mutate |

Two further actors are **not** credentials:

| Actor id | Definition |
|---|---|
| `anonymous` | an empty cookie jar; no sign-in is ever attempted |
| `forged` | a jar whose Supabase auth cookie value is replaced with structurally malformed bytes (§3.4) |

`service_role` is **not an actor.** It never makes an application request, never
proves access or denial, and appears only in §6's fixture ledger for metadata
reconciliation and cleanup — exactly the narrow use `docs/P7_PLAN.md` §3
("Standing rule on privileged access in gates") permits.

### 3.2 Sign-in: one flow, through the application

Every credentialed actor signs in **once per run** through the application's own
login surface (M-A1), not through a side channel:

1. Create a browser context dedicated to that actor (§7.4).
2. Navigate to `/login`.
3. Locate the email and password fields by their accessible labels
   ("Correo electrónico" `login/page.tsx:40-45`, "Contraseña" `:57-62`) and the
   submit control by its accessible name ("Iniciar sesión" `:73-78`).
4. Submit. Wait for the readiness condition in §4.3 (a rendered `/dashboard`, or
   a `/login?error=` result).
5. Export the resulting cookies from that context (CDP `Network.getCookies`) into
   the actor's **Node-side jar**.

The `http` mechanism then replays that jar. This matters: the cookies the direct
HTTP client carries are *the very cookies the application's own login action
issued*, so an `http` assertion and a `browser` assertion are provably the same
session. No JWT is minted, decoded, re-signed or constructed anywhere.

A **documented fallback** exists for environments with no browser binary: signing
in with `@supabase/ssr`'s `createServerClient` and the **publishable/anon key**
against Supabase Auth, populating the jar from its `setAll` callback — the
identical pattern already used at `scripts/responsive-layout-test.mjs:105-122`.
This is still a genuine Supabase Auth sign-in with a real password and a real
issued token; it is *not* a forged session and *not* `service_role`. It is a
fallback because it skips M-A1 itself, which lowers fidelity; the run records
which path minted each session, and the `form` and `browser` mechanisms are
unavailable in that mode.

### 3.3 Cookie carriage and isolation

- **One jar per actor**, keyed by actor id, never shared, never merged, never
  copied between actors. The jar is an in-memory `Map`; it is never written to
  disk, never logged, and never included in an evidence record (§5.2).
- **One browser context per actor** (§7.4), each with its own profile storage, so
  the browser's own cookie store cannot leak across actors either.
- The `http` client sets `Cookie` explicitly per request from that actor's jar
  and never follows redirects automatically (`redirect: "manual"`), so a
  cross-origin or cross-actor bleed cannot happen implicitly through redirect
  chasing.
- `Set-Cookie` on a response updates **only the requesting actor's** jar. Supabase
  refresh rotation is therefore preserved rather than pinned — unlike the
  read-only proxy at `responsive-layout-test.mjs:124-147`, which deliberately
  strips `set-cookie` because it only needs to render pages.
- **Isolation is asserted, not assumed.** The PR 5 self-test (§9) requires that
  after all three actors sign in, no cookie name/value pair present in one jar is
  present in another, and that each actor's `/dashboard` identity signal is its
  own (§3.5).

### 3.4 The four negative session cases, and the distinction between two of them

| Case | Construction | Never involves | Expected shape |
|---|---|---|---|
| **Logged out** | empty jar; no sign-in attempted | — | protected page → 302 `/login`; H2 → 401 |
| **Malformed / forged token** | take a real signed-in jar and replace the Supabase auth cookie's **value** with structurally invalid bytes of the same length class (a base64-shaped string that is not a JWT, or a JWT-shaped string whose signature segment is random bytes) | **no valid signature is ever produced**; no signing key is read, derived or guessed; no `service_role` JWT is constructed | `getUser()` fails to validate → treated exactly as unauthenticated: 302 `/login` / 401 |
| **Genuinely expired session** | sign in normally, then **revoke the session through Supabase Auth's own `signOut`** for that actor (or drive M-A2 `logout` in the browser), then replay the *previously captured* jar | no clock manipulation, no token mutation, no waiting on a real TTL | the token is well-formed and correctly signed but no longer valid server-side → the same rejection, reached by a **different mechanism** |
| **Cross-tenant** | a fully valid `tenantA` session requesting a `tenantB` resource | no tampering of any kind | H2 → **404**, not 401 (`report/route.ts:34`); dashboard → zero `tenantB` content |

**Why the middle two must be distinguished.** Both end in "rejected", but they
prove different properties. The forged case proves the application does not trust
the cookie's *contents* — that `getUser()` is verifying a signature rather than
decoding like `getSession()`, which is precisely the rule stated at
`src/lib/supabase/middleware.ts:76-78`. The expired case proves the application
does not trust a *correctly signed* token indefinitely — that server-side
revocation is honored. A harness that only forged bytes would leave the second
property untested; one that only revoked would leave the first untested. The
harness therefore exposes them as two distinct operations (`session.forge()` and
`session.revoke()`, §8.3) and the evidence record carries which was used.

### 3.5 Proving which actor actually performed a request

Denial evidence is worthless if the harness cannot show *who* was denied. Two
independent proofs are required, and both are recorded:

1. **Identity assertion through the application's own signal.** Immediately after
   sign-in, and again at the start of each suite phase, the actor issues
   `GET /dashboard` and the harness asserts that the email the dashboard prints
   for the signed-in user (`src/app/dashboard/page.tsx:148-150`) matches the
   actor's configured email. This is the application telling the harness who it
   thinks the caller is. It is never read from the cookie.
2. **Jar provenance.** Every evidence record carries the actor id and a
   **non-reversible short digest** of the jar's auth-cookie value (the first 8
   hex characters of a SHA-256 over the value). Two records with the same digest
   were made by the same session; a record whose digest differs from that actor's
   registered digest is a harness bug and fails the run. The digest is a one-way
   hash prefix and cannot reconstruct the token (§5.2).

For the `anonymous` actor, proof 1 is inverted: `/dashboard` must redirect, and
the jar must be empty.

### 3.6 Explicit non-capabilities

The harness has **no** ability to: mint a JWT, sign anything, read the Supabase
JWT secret, elevate a `client` actor to `internal`, call a Server Action as one
actor while carrying another's cookies, or use `service_role` to answer any
authorization question. These are absences of code, not disabled features.

---

## 4. Server Action durability

### 4.1 Semantic location — the durability contract

Controls are located **only** by, in priority order:

1. accessible role + accessible name (`getByRole("button", { name: … })`
   semantics);
2. associated `<label>` text or `aria-label`;
3. form-field `name` attribute — a **server contract**, because the Server Action
   itself reads `formData.get("tenant_id")`, so `name="tenant_id"` cannot drift
   without the action changing too;
4. stable user-visible text.

Explicitly forbidden as locators: generated class names, Tailwind utility
strings, `data-*` attributes added for testing, DOM index paths, chunk names,
`$ACTION_ID_*` fields, or anything containing a hash.

The inventory in §1.4 records the accessible name for every control a suite will
need, so PR 5's implementation has no reason to reach for a fragile locator.
Where a control has no unique accessible name today, the harness **records that
as a finding for the suite author** rather than adding a test-only attribute to
application source.

### 4.2 Absent control: hidden-by-authorization vs. failed-to-render

These must never collapse into one failure. The harness resolves them **before**
looking for the control, using the response the actor already received:

```
locate(control):
  navigate(pageUrl) -> record status + final URL
    3xx to /login                 -> OUTCOME: denied_unauthenticated
                                     (control absence is CORRECT)
    3xx to /dashboard             -> OUTCOME: denied_wrong_role
                                     (control absence is CORRECT)
    404                           -> OUTCOME: not_found
                                     (control absence is CORRECT)
    >= 500                        -> OUTCOME: page_crash        (RUN FAILS, not a denial)
    uncaught page exception       -> OUTCOME: page_crash        (RUN FAILS, not a denial)
    200 + page landmark present:
        control found             -> proceed
        control absent            -> OUTCOME: control_absent_on_authorized_page
                                     (RUN FAILS - the page rendered, so absence is a
                                      rendering/inventory regression, not authorization)
    200 + page landmark absent    -> OUTCOME: render_incomplete (RUN FAILS)
```

The **page landmark** is the page's own `<header>` / `<main>` structure — the
same signal `responsive-layout-test.mjs:188` already waits on. A suite asserting
"a `client` cannot see the admin control" must assert `denied_wrong_role`, never
"the control was missing".

### 4.3 Readiness conditions — no arbitrary sleeps

Every wait is a **condition on observable application state**, evaluated on an
event or on a bounded, condition-terminated check:

| Situation | Readiness condition |
|---|---|
| app is up (before anything) | `GET /api/health` returns 200 with `supabase: true` — a real application signal, not a delay |
| page navigated | navigation settled **and** the page landmark (`header`) exists **and** `document.readyState === "complete"` |
| PE form submitted (`form`) | the navigation the submission caused has completed and its URL/status is available. Every Server Action in this app ends in `redirect(...)` (`login/actions.ts:36`, `clients/actions.ts:27`, `studies/actions.ts:28`, `qualitative/actions.ts:23`), so the outcome *is* a navigation |
| imperative action dispatched (`browser`) | the component's own rendered state changed — an `aria-live` region's text (`StudyCard.tsx:57` prints "Actualizando resultados agregados…" while `pending`), a rendered result, or a rendered error. `useTransition`'s pending flag is observable through the DOM the app itself renders |
| session revoked | the next protected request returns its rejection |

The single tolerated exception is the browser-launch handshake — waiting for the
DevTools endpoint to accept a connection — a bounded readiness check on a process
the harness itself started, terminating on first success, exactly as
`responsive-layout-test.mjs:224-228` does. It is not a wait on application state.

`setTimeout`-as-a-guess (the trailing 500 ms at
`responsive-layout-test.mjs:194`) is **not** carried over.

### 4.4 Timeouts and retries

| Bound | Value | Behavior on exhaustion |
|---|---|---|
| single HTTP request | 15 s | record `network_failure`, fail the operation |
| page navigation + landmark | 30 s | record `render_incomplete`, fail the operation |
| imperative action settle | 20 s | record `page_crash` with an `action_timeout` note, fail the operation |
| whole run | 10 min (configurable down, never up without review) | abort, run cleanup, exit non-zero |

**Retry policy: at most one retry, and only for a transport-level failure**
(connection refused / reset / DNS) during the **readiness probe or sign-in**.
Zero retries for any request that produced an HTTP response — a 500 is evidence,
not a flake. Zero retries for any mutating operation, ever. **No polling loops,
no request bursts, no backoff ladders, no "try until green".** A suite that
cannot decide from one answer is a suite with an ambiguous assertion.

### 4.5 Surviving a Next.js rebuild

A rebuild changes action hashes, chunk file names, generated class names, RSC
payload framing and route manifests. The design is unaffected because **the
harness's entire input vocabulary is**:

- URL paths (`/admin/studies`, `/api/studies/<uuid>/report`) — the routing contract;
- HTTP methods and status codes — the HTTP contract;
- form-field `name` attributes — read by the Server Actions themselves;
- accessible roles, labels and visible text — the product's UX contract;
- the actor's cookies — issued by Supabase Auth.

None of these are build artifacts. The harness stores no build-derived value
between runs and caches nothing across runs. A rebuild that changed every hash
and every chunk name would not require a single edit to the harness. Conversely,
if a rebuild *did* break the harness, the break would be in a routing path, a
form field name, or an accessible label — all real, reviewable product changes
that *should* fail a security suite loudly.

---

## 5. Evidence and assertions

### 5.1 The evidence record

One record per request or action attempt, appended to an in-memory ledger and
printed as a line at the end of the run:

| Field | Example | Notes |
|---|---|---|
| `actor` | `tenantA` | actor id, never an email |
| `sessionDigest` | `9f3ac21b` | 8-hex SHA-256 prefix of the auth-cookie value (§3.5) |
| `sessionKind` | `live` \| `forged` \| `revoked` \| `none` | distinguishes §3.4's cases |
| `operation` | `report.download` | **stable operation name** from a fixed vocabulary, decoupled from the URL |
| `mechanism` | `http` \| `form` \| `browser` | which mechanism ran; a demoted `form` row records `browser` with `demoted: true` |
| `urlClass` | `/api/studies/:studyId/report` | **templated**, never the concrete uuid |
| `httpStatus` | `404` | for `browser`, the status of the navigation or of the action's transport |
| `redirectTo` | `/login` | path only; the query string is stripped except a fixed allow-list of non-sensitive keys (`error`) |
| `errorCategory` | `denied_wrong_role` | from the §5.3 vocabulary only — never a raw server message |
| `residue` | `{ study: 0, respondent: 0, quant_response: 0, import_batch: 0 }` | counts only, for mutation attempts (§6.4) |
| `assertion` | `pass` \| `fail` \| `not_asserted` | `not_asserted` when the harness only *recorded* an outcome for a caller |
| `durationMs` | `812` | |

`assertion` defaults to `not_asserted`: the harness records, the suite asserts
(§5.4).

### 5.2 What is never recorded

Never written to the ledger, stdout, stderr, a file, an exception message or a
thrown stack: **passwords · cookie names or values · access or refresh tokens or
any fragment of one · the service-role key or any fragment · any JWT segment ·
any response body containing tenant rows, respondent data, quotes or metric
values · raw server error text · Supabase error `details` / `hint` · the concrete
uuids of any object other than the run's own fixture ids (§6.6).**

Three mechanisms enforce this rather than relying on discipline:

1. **The reporting contract is category-and-count only** — the same contract
   `scripts/lib/secret-patterns.mjs` already states in its header ("every
   function here returns CATEGORY + COUNT metadata only").
2. **The ledger is sanitized at construction, not at print time.** Response
   bodies never enter a record; only a classification derived from them does.
   There is no code path carrying a body into a printable field, so no later
   change to formatting can leak one.
3. **The self-test scans the harness's own output** through
   `scripts/lib/secret-patterns.mjs`'s `scanText` and fails on any hit (§9.3).

The `sessionDigest` is a one-way SHA-256 prefix over a value the harness already
holds; it cannot reconstruct the token and is not a "secret fragment". It is the
minimum needed to prove two records share a session (§3.5).

### 5.3 The outcome classifier — denial vs. everything it is not

`scripts/rls-coverage-test.mjs` already establishes the right pattern in this
repository: a small classifier with **its own self-test over fixed cases** before
any live call (`checkClassifier`, `CLASSIFIER_CASES`). The harness adopts it. The
vocabulary is closed:

| Category | Recognized by | Is it a denial? |
|---|---|---|
| `denied_unauthenticated` | 401, **or** 3xx whose `Location` path is `/login` | **yes** |
| `denied_wrong_role` | 3xx whose `Location` path is `/dashboard` in response to an `/admin/*` request; **or** an action result carrying the app's fixed denial string | **yes** |
| `denied_action_result` | class M-D: HTTP 200 whose parsed action result is `{ status: "error" }` / `{ ok: false }` **and** whose rendered surface shows a denial (`upload/actions.ts:78-93`, `data-actions.ts:33`) | **yes** — this is the class where a 200 means denied |
| `not_found` | 404 (`report/route.ts:32`, `:34`, `:37`; `notFound()` in P8) | **no** — absence, which may be *correct* isolation behavior but is a different claim |
| `validation_rejected` | 400 with the app's structured error shape (`report/route.ts:39`, `:43`), or an action result that is a Zod-derived message | **no** — input was refused, authorization was never reached |
| `success` | 2xx **and** the operation's own success signal (a PDF `content-type`, a redirect carrying `?ok=`, a rendered result) | **no** |
| `success_no_op` | 2xx + success signal **but** the fixture residue count is unchanged | **no** — flagged loudly; a mutation that "succeeded" and changed nothing is a false pass and fails the run |
| `network_failure` | connection refused/reset/DNS/timeout, no HTTP response | **no** — harness/environment failure |
| `page_crash` | 5xx, an uncaught page exception, or `render_incomplete` | **no** — **fails the run**; never reported as a denial |
| `unclassified` | anything not matching the above | **no** — **fails the run**; the classifier is extended by a human, never widened silently |

Two rules make this safe:

- **`unclassified` fails.** The default is not "denied". A harness that treats
  unknown answers as denials manufactures green suites.
- **The classifier self-tests offline first.** Fixed synthetic cases (a 302 to
  `/login`, a 302 to `/dashboard`, a 404, a 400 in the report route's error
  shape, a 200 with `{ ok: false }`, a 500, a socket error) run before any live
  request. If the classifier is wrong, the run stops before it can mislabel
  anything.

### 5.4 How Suites A/B/C/E consume this — and why the harness cannot claim their verdicts

The harness exports operations and returns records. It exports **no** assertion
helper encoding a security expectation, and its own exit code reflects only:
sign-in success, cookie isolation, the classifier self-test, fixture cleanup, and
its own self-test (§9).

```js
// PR 6+ (suite code, NOT part of PR 5)
const r = await harness.run(actors.tenantA, OPERATIONS["report.download"], { studyId: tenantBStudyId });
assert.equal(r.errorCategory, "not_found");   // the SUITE decides what must be true
```

Consequences, stated so no later PR can blur them:

- **The harness passing means the mechanism works. It never means a suite
  passed.** PR 5's report line must say so verbatim (§9.4).
- No harness output may contain the strings "Suite A/B/C/E" followed by a verdict.
- The suites own their npm scripts (`suite:a`, `suite:b`, `suite:c`,
  `suite:e:available`, `suite:e:full`) and their exit codes, per
  `docs/P7_PLAN.md` §5.1.
- PR 5 adds **one** npm script, `test:harness-selftest`, which runs §9 only.

---

## 6. Fixture lifecycle and safety

### 6.1 Only synthetic identities and uniquely prefixed objects

Every object the harness creates carries the run prefix:

```
P7H-<UTC yyyymmddThhmmssZ>-<6 random base36 chars>
```

for example `P7H-20260822T191500Z-k3f9qa`. It appears in every created name
(`P7H-… fixture study`), so a stray row is identifiable by inspection alone and
can never be confused with a real or accepted object. The prefix is generated
once per run and is the **only** deletion key (§6.6).

### 6.2 The out-of-bounds list — never touched, mutated or deleted

Enforced as an explicit deny-list checked before every mutating operation:

| Object | Id / identifier |
|---|---|
| P6E acceptance study | `ad275928-dbd1-4acf-9de9-fa1623b32a60` |
| P6E import batch | `bd4f26db-093a-4e31-8fa9-de8281300c63` |
| The two historical draft studies | `Satisfacción 2026 (TEST)` (both) |
| Tenant A / Tenant B | `TEST_TENANT_A_ID` / `TEST_TENANT_B_ID` — **read as an actor, never mutated** |
| The three fixture auth users | sign-in only; never modified or deleted |
| Anything without the run prefix | — |

A mutating operation whose target resolves to a deny-listed id **aborts the run
before the request is sent**. This is a precondition, not a post-hoc check.

### 6.3 Preflight collision check

Before creating anything, the harness asserts that **zero** objects already carry
the run prefix (`study.name`, `tenant.name`, `study_template.name`,
`import_batch`, and the auth-user email space). A collision means a previous run
leaked: the run **refuses to start** and prints the colliding prefix (§6.6)
rather than adopting or deleting objects it did not create. This read is one of
the three places a narrowly scoped `service_role` query is permitted per
`docs/P7_PLAN.md` §3 — reconciliation, never evidence.

### 6.4 Exact created-object tracking (the ledger)

The ledger records, for every object the harness causes to exist:

`{ kind, id, prefix, createdBy: operationName, createdAt, viaMechanism }`

Objects are added **only** when the application's own response confirms creation
(a redirect carrying the new id, a rendered success). Nothing is inferred.

The ledger is also the basis for `residue` (§5.1): after a *failed* mutation, the
harness re-counts the rows the attempt could have created and asserts **zero**.
This is what turns "the upload was rejected" into "the upload was rejected and
wrote nothing" — R8 / C2's actual requirement.

### 6.5 No manual insertion may substitute for the workflow under test

Where the assertion is *about* a workflow, the fixture **must** be produced by
that workflow through its assigned mechanism. Concretely: a study whose creation
is what a suite is testing is created by driving M-B9 through `form`/`browser`,
never by a `service_role` insert. `service_role` may only:

- read metadata for the preflight collision check (§6.3);
- read residue counts (§6.4) — counts, never rows;
- delete prefixed objects during cleanup (§6.6).

It may never create an object that a suite then treats as evidence that the
application created it, and it may never be the actor in any request whose
outcome is an authorization claim. `CLAUDE.md`'s standing rule — *never bypass
the real application workflow by manually inserting acceptance rows* — is
restated here as a harness invariant.

### 6.6 Cleanup, and what happens when it fails

Cleanup runs in a `finally` block entered on success, on assertion failure, on
exception, and on the run timeout. It deletes **exactly the ledger's ids**,
newest first, and never issues a delete predicate broader than
`id = <ledger id>`. Afterwards it re-runs the preflight query and asserts zero
remaining prefixed objects.

If cleanup fails or residue remains:

- the run **exits non-zero** — a leaked fixture is a red run regardless of how
  every assertion went;
- the output prints **only** the run prefix, and the `kind` + `id` of each object
  that could not be removed, plus the instruction to remove them manually;
- it prints **no** credential, cookie, token, key, response body or tenant data;
- it does **not** retry the deletion in a loop and does **not** escalate to a
  broader delete predicate.

Process signals (`SIGINT` / `SIGTERM`) route to the same cleanup path before
exit, so an interrupted run does not silently leak.

---

## 7. Runtime topology

### 7.1 One harness, two targets, identical authorization semantics

The harness takes a single `origin` and changes nothing else:

| Target | Origin | How it is reached |
|---|---|---|
| local built app | `http://localhost:3000` (default; `npm run build && npm run start`, or `npm run dev`) | direct |
| deployed synthetic beta | `https://becommunity-v1.ollinagencyllc.workers.dev` | direct, over HTTPS |

Both targets run the same middleware, the same `getUser()` revalidation, the same
guards, and talk to the same synthetic Supabase project. **No branch, flag or
environment variable changes an authorization decision, a mechanism, a locator or
a classifier between them.** The only permitted differences are transport-level:
the scheme, the readiness probe's expected latency, and the browser's willingness
to set `Secure` cookies (satisfied automatically because the remote target is
HTTPS).

`--origin` is the whole interface. There is no `--local-relaxed`, no
`--skip-auth`, no `--allow-insecure`.

### 7.2 Where each later suite runs (matching `docs/P7_PLAN.md` §9.1)

| Suite | Local | Remote (deployed beta) | Source of the requirement |
|---|:---:|:---:|---|
| A (isolation, `data_scope`) | ✓ | — | §9.1 PR 6 names no deployed run; A's assertions are database-boundary assertions reachable locally |
| B (authorization) | ✓ | ✓ | §9.1 PR 7: *"against a local build **and** once against the deployed Worker"* |
| C (input / injection / upload / pivot) | ✓ | ✓ | same row |
| E (headers, framing, session resilience) | — | ✓ | §5.1 / PR 8: Suite E runs *"against the deployed beta Worker"*; edge headers are only meaningful there |
| PR 5 self-test (§9) | ✓ | optional | Local is the merge gate; a remote pass is recorded when run but is not required for PR 5 (see open decision H1) |

### 7.3 Browser ownership and debug-port isolation

The previous browser-port collisions came from a **fixed default port**:
`responsive-layout-test.mjs:25` hardcodes `9333`, so two concurrent runs — or one
run plus a leftover process — fight over it. This design removes the class of
failure rather than picking a different constant:

1. **Ephemeral port chosen by the OS.** The harness binds a throwaway TCP
   listener on port `0`, reads the assigned port, closes it, and launches Chrome
   with `--remote-debugging-port=<that port>`. If the launch does not answer
   within its bounded handshake, the harness re-derives a fresh port **once** and
   retries **once**, then fails. (Chrome's own `--remote-debugging-port=0` plus
   the `DevToolsActivePort` file is an acceptable equivalent implementation; the
   requirement is "never a fixed default".)
2. **Per-run temporary profile directory** (`mkdtempSync`, as
   `responsive-layout-test.mjs:212` already does), removed during cleanup.
3. **The harness owns only the browser it starts.** It never attaches to a
   pre-existing browser, never reuses the user's Chrome profile, and kills the
   process it spawned in the `finally` block.
4. **Binary discovery** reuses the existing `CHROME_CANDIDATES` + `CHROME_PATH`
   convention (`responsive-layout-test.mjs:27-35`), so no new configuration is
   introduced.

### 7.4 Isolation model: one browser process, one context per actor

**Recommended:** a single browser process hosting **one isolated browser context
per actor** (CDP `Target.createBrowserContext`), plus one additional
JavaScript-disabled context per actor for the `form` mechanism.

Rationale: contexts are the browser's own cookie/storage isolation primitive —
they share nothing — and this keeps memory and start-up cost to one process while
giving each actor a genuinely separate jar. One process per actor would also be
correct but multiplies launch time and port management by three for no isolation
gain. Isolation is **asserted** either way (§3.3, §9.1 S2), so the model is
verified rather than trusted.

JavaScript is disabled per context
(`Emulation.setScriptExecutionDisabled`), so the `form` and `browser` mechanisms
cannot contaminate each other.

### 7.5 No new infrastructure

No WSL, no Docker, no paid service, no plugin, no Playwright or Puppeteer
dependency. The harness uses raw CDP over the WebSocket the runtime already
provides — the approach `responsive-layout-test.mjs:150-202` proves works — plus
`node:http`, `node:child_process` and the already-pinned `@supabase/supabase-js`
and `@supabase/ssr`. **PR 5 adds zero dependencies.**

---

## 8. Proposed module API (specification only — not implementation)

### 8.1 Files

| File | Contents | Size intent |
|---|---|---|
| `scripts/lib/http-harness.mjs` | actors, sessions, cookie jars, the `http` mechanism, the outcome classifier and its self-test, the evidence ledger | the core |
| `scripts/lib/harness-browser.mjs` | Chrome lifecycle, ephemeral port, per-actor contexts, semantic locators, readiness conditions, the `form` and `browser` mechanisms | browser only |
| `scripts/lib/harness-fixtures.mjs` | run prefix, deny-list, preflight, ledger, cleanup | fixtures only |
| `scripts/harness-selftest.mjs` | §9 only; the sole npm entry point PR 5 adds (`test:harness-selftest`) | thin |

`scripts/lib/` already exists (`dependency-exceptions.mjs`,
`secret-patterns.mjs`), so this introduces no new directory convention.

### 8.2 Types (TypeScript notation for review; the implementation is `.mjs`)

```ts
type ActorId = "tenantA" | "tenantB" | "internal" | "anonymous" | "forged";
type Mechanism = "http" | "form" | "browser";
type SessionKind = "live" | "forged" | "revoked" | "none";

type Actor = {
  id: ActorId;
  role: "client" | "internal" | null;
  sessionKind: SessionKind;
  /** opaque; never printed, never serialized, never shared across actors */
  jar: CookieJar;
  /** 8-hex SHA-256 prefix of the auth cookie value; safe to print */
  sessionDigest: string | null;
};

type OperationDescriptor = {
  /** stable, build-independent name, e.g. "studies.createBlank" */
  name: string;
  /** templated path, e.g. "/api/studies/:studyId/report" */
  urlClass: string;
  mechanism: Mechanism;
  /** pre-approved fallback, for `form` rows only (§2.2) */
  fallback?: "browser";
  mutating: boolean;
  /** ledger kinds this operation may create, for residue accounting */
  creates?: Array<"study" | "tenant" | "template" | "import_batch" | "profile" | "storage_object">;
};

type ErrorCategory =
  | "denied_unauthenticated" | "denied_wrong_role" | "denied_action_result"
  | "not_found" | "validation_rejected" | "success" | "success_no_op"
  | "network_failure" | "page_crash" | "unclassified";

/** The only thing a suite ever sees. Contains no body, no header values beyond
 *  a fixed safe subset, no cookie, no token, no tenant data. */
type SanitizedResult = {
  actor: ActorId;
  sessionDigest: string | null;
  sessionKind: SessionKind;
  operation: string;
  mechanism: Mechanism;
  demoted: boolean;
  urlClass: string;
  httpStatus: number | null;
  redirectTo: string | null;
  errorCategory: ErrorCategory;
  residue: Record<string, number> | null;
  assertion: "pass" | "fail" | "not_asserted";
  durationMs: number;
};

type FixtureRecord = {
  kind: string; id: string; prefix: string;
  createdBy: string; createdAt: string; viaMechanism: Mechanism;
};
```

### 8.3 Lifecycle and exported surface

```ts
// ---- lifecycle -------------------------------------------------------------
createHarness(options: {
  origin: string;                          // the ONLY topology switch (§7.1)
  actors: ActorId[];
  browser?: "auto" | "required" | "none";  // "none" => http-only fallback (§3.2)
  runTimeoutMs?: number;                   // bounded; never raised without review
}): Promise<Harness>;

harness.signIn(actor: ActorId): Promise<Actor>;         // through M-A1 (§3.2)
harness.assertIdentity(actor: ActorId): Promise<void>;  // the app's own signal (§3.5)
harness.assertJarIsolation(): Promise<void>;            // §3.3
harness.close(): Promise<void>;   // kills the browser it started; idempotent

// ---- session manipulation (§3.4) — no signing, ever -------------------------
harness.session.forge(actor: ActorId): Promise<Actor>;   // malformed bytes
harness.session.revoke(actor: ActorId): Promise<Actor>;  // real server-side revocation
harness.session.clear(actor: ActorId): Promise<Actor>;   // empty jar

// ---- the single execution entry point --------------------------------------
harness.run(
  actor: ActorId,
  op: OperationDescriptor,
  params?: Record<string, string>,  // fills :placeholders and named form fields
): Promise<SanitizedResult>;

// ---- progressive-enhancement verification (§1.6) ---------------------------
harness.assertDegrades(op: OperationDescriptor): Promise<
  { degrades: true } | { degrades: false; demotedTo: "browser" }
>;

// ---- fixtures (§6) ---------------------------------------------------------
harness.fixtures.prefix: string;
harness.fixtures.preflight(): Promise<void>;              // refuses on collision
harness.fixtures.track(record: FixtureRecord): void;
harness.fixtures.residue(kinds: string[]): Promise<Record<string, number>>;
harness.fixtures.cleanup(): Promise<{ removed: number; leaked: FixtureRecord[] }>;

// ---- evidence (§5) ---------------------------------------------------------
harness.ledger.all(): SanitizedResult[];
harness.ledger.print(): void;  // sanitized at construction; nothing to redact

// ---- operation catalogue: the §1 inventory as data, no assertions -----------
export const OPERATIONS: Record<string, OperationDescriptor>;
```

### 8.4 What is deliberately absent

No `expectDenied()`, no `assertCannotAccess()`, no suite-named helper, no
`assertTenantIsolation()`. PR 5 must contain no security expectation — that is
how the harness stays a foundation and the suites stay honest (§5.4). Likewise
absent: any retry-until-success helper, any sleep helper, any raw-response
accessor, and any function accepting a `service_role` key as an actor credential.

---

## 9. PR 5 self-test and acceptance criteria

`npm run test:harness-selftest` — the one script PR 5 adds — must prove all of
the following in a single bounded run against a locally built app, and must exit
non-zero if any of them fails.

### 9.1 Behavioral proofs

| # | Proof | Pass condition |
|---:|---|---|
| S1 | Sign-in for all three actors through M-A1 | `tenantA`, `tenantB` and `internal` each reach an authenticated `/dashboard`; each `assertIdentity()` matches the configured email via the app's own rendered signal |
| S2 | Cookie isolation | no cookie name/value pair appears in more than one jar; the three `sessionDigest` values are distinct; a `tenantA` request never carries a `tenantB` cookie |
| S3 | Logged-out handling | `anonymous` → `/admin/studies` classified `denied_unauthenticated` with `redirectTo === "/login"`; `anonymous` → H2 classified `denied_unauthenticated` with status 401 |
| S4 | Forged-session handling | `session.forge(tenantA)` → protected page classified `denied_unauthenticated`; recorded `sessionKind: "forged"` |
| S5 | Expired/revoked-session handling | `session.revoke(tenantB)`, then replay of the captured jar → `denied_unauthenticated`; recorded `sessionKind: "revoked"`; **S4 and S5 produce distinct records** |
| S6 | One direct route request | `internal` → H2 for a fixture study returns `success` with `content-type: application/pdf`; the same request as `tenantB` returns `not_found` (recorded, **not** asserted as a suite verdict) |
| S7 | One verified progressive-enhancement form | `assertDegrades(login)` returns `{ degrades: true }` **or** records `demotedTo: "browser"`; whichever occurs is recorded explicitly. At least one M-B form additionally runs through `assertDegrades()` |
| S8 | One browser-driven imperative Server Action | `internal` drives M-D6 (`computeStudyPivot`) through `PivotExplorer`'s real controls and receives a rendered result; the record shows `mechanism: "browser"` |
| S9 | Fixture creation, cleanup and zero residue | one prefixed fixture study is created through M-B9 (the real workflow, §6.5), tracked in the ledger, then removed in `finally`; the post-run preflight returns zero prefixed objects; `leaked` is empty |
| S10 | Classifier self-test | the fixed offline cases in §5.3 all classify correctly **before** any live request; an unrecognized case yields `unclassified` and fails |
| S11 | Deny-list precondition | a synthetic attempt to target `ad275928-dbd1-4acf-9de9-fa1623b32a60` in a mutating operation aborts **before** any request is sent |

### 9.2 Structural guarantees (asserted over the harness's own source)

Each is a source assertion in `harness-selftest.mjs` over
`scripts/lib/http-harness.mjs`, `harness-browser.mjs` and `harness-fixtures.mjs`:

| # | Guarantee | Assertion |
|---:|---|---|
| G1 | No hashed action ID is constructed, scraped or stored | no occurrence of `$ACTION_ID`, `next-action`, `Next-Action`, `text/x-component`, `encodeReply`, or a locator matching a hex/hash-shaped selector |
| G2 | No private RSC payload builder | no import from `react-server-dom-webpack`, from `react-dom/server` internals, or from any Next internal path; no hand-assembled multipart action body |
| G3 | No bypass flag | no environment variable read by the harness alters an authorization decision, a mechanism, a locator or a classifier; the only recognized switches are `origin`, `browser`, `runTimeoutMs`, and the documented `TEST_*` / `NEXT_PUBLIC_*` / `CHROME_PATH` fixture variables |
| G4 | No service-role authorization evidence | `SUPABASE_SERVICE_ROLE_KEY` / `SUPABASE_SECRET_KEY` appear only inside `harness-fixtures.mjs`, and only in the preflight / residue / cleanup functions — never in a code path producing a `SanitizedResult` |
| G5 | No secret logging | every printed field originates in `SanitizedResult` or `FixtureRecord`; there is no code path from a response body or a cookie to an output stream |
| G6 | No sleeps or loops | no bare `setTimeout` used as a wait on application state; no `while` loop around a request; retry counters are ≤ 1 and apply only to transport failures during readiness or sign-in (§4.4) |
| G7 | No production source is modified | PR 5's diff touches `docs/`, `scripts/`, and exactly one `package.json` script line — no file under `src/`, `supabase/`, and not `next.config.ts`, `src/middleware.ts` or `wrangler.toml` |

### 9.3 Gate results required for PR 5 to merge

```bash
npm run typecheck && npm run lint && npm test && npm run build
```

```bash
npm run test:harness-selftest
```

```bash
npm run test:secrets
```

`npm run test:secrets` must remain **green**, including its
`scripts/lib/secret-patterns.mjs` scan, and the self-test additionally pipes its
own stdout through `scanText` and fails on any hit (§5.2). Per
`docs/P7_PLAN.md` §9.1, PR 5's row requires the design note to be approved
**before** implementation begins, and the "no hashed action ID or private wire
payload" check (G1 / G2) is an explicit merge gate.

### 9.4 What PR 5 explicitly does **not** claim

Its report must state, verbatim: *"The harness mechanism is proven. No security
suite has been run. Suites A, B, C and E remain as recorded in
`docs/P7_PLAN.md` §5."*

---

## 10. Rejected alternatives

| # | Alternative | Why it is rejected |
|---:|---|---|
| R-1 | **Scraping action IDs from build chunks** (`.next/static/chunks/*`) to POST actions directly | The IDs are a build-derived private identifier. They change on every rebuild, so the harness breaks for a non-security reason — or worse, keeps matching a stale ID and passes against nothing. Explicitly forbidden by `docs/P7_PLAN.md` §6.1 and by prohibition 1 |
| R-1b | **Reading the framework's hidden fields from rendered HTML and replaying the form from Node** ("opaque generic form replay") | Superficially clean — a browser without JavaScript does exactly this. But it still *reads and transmits* the hashed identifier, which prohibition 1 admits no exception for, and it silently couples the harness to a private serialization. The JavaScript-disabled browser context (§2, mechanism `form`) yields the identical proof at no such cost, so the shortcut buys nothing |
| R-2 | **Replicating React's `encodeReply` / the RSC wire protocol** | Private, undocumented, version-coupled framework serialization. A React or Next upgrade changes it with no changelog entry. A harness built on it produces confident-looking results whose fidelity nobody can verify — the exact failure mode `docs/P7_PLAN.md` §6.1 was written to prevent |
| R-3 | **Direct database writes as evidence that a mutation happened** | Proves the database accepts a privileged write; proves nothing about the application's authorization path. `docs/P7_PLAN.md` §5's gate reconciliation already labels the existing `service_role` live scripts exactly this way, and `CLAUDE.md` forbids substituting manual insertion for the real workflow |
| R-4 | **`service_role` impersonation of an actor** | `service_role` bypasses RLS and every grant. Any "denial" it observes is meaningless and any "access" it obtains is guaranteed. `docs/P7_PLAN.md` §3's standing rule requires every Suite A/B assertion to authenticate as a real synthetic identity using the publishable key |
| R-5 | **A test-only authorization bypass or environment flag** (`HARNESS_MODE=1`, a header the middleware trusts, an alternate login path) | Creates a second authorization path that must itself be proven never enabled in production — a strictly worse security position than the one P7 is trying to reach. `CLAUDE.md` and prohibition 3 forbid it outright; G3 asserts its absence |
| R-6 | **Relying solely on static regex tests over source** | This is the current state and is exactly what P7 corrects: R4 and R5 are "Missing" precisely because `publication-boundary-test.mjs` asserts that the *string* `auth.getUser()` appears. A regex cannot see a guard that is present but unreachable, ordered wrongly, or bypassed by a new route. The existing static tests stay as structural tripwires and stop being counted as suite coverage |
| R-7 | **Arbitrary sleeps, request bursts, or indefinite retries** | Sleeps encode a guess about timing and rot into flakes; bursts against the deployed beta are indistinguishable from an attack and are forbidden by `docs/P7_PLAN.md` §9.2; indefinite retries convert a real failure into a slow pass. §4.3 and §4.4 replace all three with observable readiness conditions and hard bounds. Note that E1 (login flood) is *blocked*, not "implemented as a burst" — RD2 |
| R-8 | **Playwright or Puppeteer as a dependency** | Would add a large dependency tree to a repository whose supply-chain gate (`npm run suite:d`) was only just brought green, and would need a browser-download step. Raw CDP over the built-in WebSocket already works here (`scripts/responsive-layout-test.mjs`). Rejected as "new infrastructure adopted for convenience" (`docs/P7_PLAN.md` §3 non-goals) |

---

## 11. Open decisions

Everything resolvable from the repository has been resolved above: the mechanism
for all 31 surfaces (§2.1 — zero `TBD`, zero `seam`), the actor and session model
(§3), the locator and readiness policy (§4), the evidence and classification
vocabulary (§5), fixture safety (§6), topology and browser isolation (§7), the
module API (§8), and the acceptance criteria (§9).

Two choices remain genuinely human. Neither blocks review of the mechanism; both
should be settled in the same approval.

| # | Decision | Recommended (first) | Alternative | Security / maintenance tradeoff |
|---|---|---|---|---|
| **H1** | Should PR 5's self-test also run once against the deployed synthetic beta, or local-only? | **Local-only as the merge gate**, with a remote run recorded as informational if a reviewer asks for it | Require a remote self-test run before PR 5 merges | *Recommended:* PR 5 changes no runtime code, so a remote run adds little signal, and every remote request against the beta is real traffic against an environment `docs/P7_PLAN.md` §9.2 asks to touch only in bounded passes. *Alternative:* proves TLS and `Secure`-cookie handling one PR earlier — but Suites B and C already require a deployed run at PR 7, which covers it. Maintenance cost is symmetrical; the risk difference favors local-only |
| **H2** | May the harness create a **throwaway tenant** through M-B1 for mutation fixtures, or must all fixtures live inside the existing Tenant A? | **Allow a prefixed throwaway tenant** (`P7H-…`), created through M-B1 by the `internal` actor and deleted in `finally` | Confine every fixture to Tenant A | *Recommended:* strongest blast-radius containment — a cleanup failure leaves an obviously-named empty tenant rather than stray rows inside the tenant Suite A uses as its isolation reference, and it keeps `data_scope` fixtures from perturbing Tenant A's dataset. Cost: one more object kind in the ledger, and tenant creation becomes a fixture dependency. *Alternative:* fewer moving parts, but mutation fixtures then share a tenant with isolation evidence, and a leaked fixture is harder to spot |

If both are approved as recommended, **this design is ready for approval as
written**, and PR 5 may proceed to implementation under a separate explicit
approval.
