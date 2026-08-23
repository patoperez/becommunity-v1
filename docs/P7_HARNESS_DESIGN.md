# P7 adversarial harness — design note (PR 5)

> **Type:** design-only deliverable required by `docs/P7_PLAN.md` §6.1.
> **Status:** proposed, **not implemented**. No harness code, script, npm script,
> dependency, migration, CI configuration or fixture exists as a result of this
> document. Per §6.1, PR 5 does not start until a human approves this note.
> **Evidence date:** 2026-08-22 (local), against `origin/main`
> `4d7974c7f1e2224dab1a95bee25f2e3145598cae`.
> **Review status:** the design direction was approved on 2026-08-23, together
> with both open decisions (H1 and H2, now recorded as resolved in §11). This
> revision applies the reviewer's required corrections; it remains
> documentation-only and PR 5 implementation has not begun.
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

**Behavioral proof, then a frozen catalog entry (required before any suite
relies on it).** `assertDegrades()` (§8.3) is a **discovery tool used during PR 5
implementation**, not a run-time selector. It loads the page in a browser context
created with **JavaScript disabled**, submits the form through the browser's own
native HTML form machinery, and observes the application's expected server-side
outcome. No harness code reads, parses or transmits the hidden fields the
framework places in that form — the browser submits them as part of its own DOM,
exactly as a no-JS user agent does.

The *result* of that discovery is then **written into the checked-in operation
catalog** and reviewed as part of PR 5's diff. From that point the catalog is the
only authority on which mechanism runs:

- a surface whose catalog entry says `form` and which later fails to submit
  natively is **red** — the harness never silently falls back to `browser`;
- a surface that has not been behaviorally verified and frozen carries the
  already-reviewed **`browser`** mechanism, which is always a valid way to reach
  it;
- moving a surface from `browser` to `form` requires a discovery run plus a
  committed catalog change, i.e. a reviewable diff. See §2.2.

### 1.7 Which interactions require the application's own browser runtime

M-C1 and M-D1–M-D6 (7 surfaces) require it **intrinsically**. For M-D there is no
alternative: the request is constructed by React from JS values inside
`startTransition`, and reproducing it outside the browser would mean hand-building
the wire payload — prohibition 2. M-C1 requires the browser to *build the form's
stage rows* even if its submit degrades.

Separately, every **PE-eligible** surface also runs on the browser mechanism
until a discovery run freezes it to `form` (§2.2). At the time of this design
that is all of them, so the browser is the working mechanism for all 22 Server
Actions — which is why a browser is mandatory rather than optional (§3.2).

### 1.8 Named ambiguities — resolved by design, not by probing production

Per the efficiency rules, nothing below was resolved by invoking the deployed app.

| # | Ambiguity | How the design resolves it |
|---|---|---|
| AM1 | Does M-C1 (`updateStudyConfiguration`, client-component form) degrade without JavaScript? | Not decidable from source: it depends on React DOM's SSR of a client-component action form. Not resolved at run time. M-C1's catalog mechanism is **`browser`** regardless (§2.1), because the browser runtime is needed to compose the stage rows even if the submit degrades. A discovery run may record whether it degrades; that record never changes the catalog entry. No row is left TBD |
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
  code never inspects or reproduces any framework field. **Assigned only by a
  frozen catalog entry backed by a completed discovery run** (§1.6, §2.2).
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
| M-A1 `login` | PE-eligible form | `browser` | The catalog value today, because nothing has been behaviorally verified yet. This is the one surface PR 5 **must** run discovery on (S7), since it is also how every actor's session is minted (§3.2). If that discovery verifies native no-JS submission, PR 5's diff freezes this cell to `form` and a reviewer sees the change; if not, it stays `browser`. Either way the value is decided in review, never at run time |
| M-A2 `logout` | PE-eligible form | `browser` | Needed for the revoked-refresh case (§3.4). Not verified in this pass, so it carries the reviewed `browser` mechanism until a discovery run freezes otherwise |
| M-B1 `createTenant` | PE-eligible form | `browser` | Server-Component form with plain named fields, so PE is plausible — but unverified, and H2's throwaway tenant is created through this surface, so it runs on the reviewed `browser` mechanism until frozen otherwise |
| M-B2 `renameTenant` | PE-eligible form | `browser` | same |
| M-B3 `updateTenantBrand` | PE-eligible form | `browser` | same (a file field submits natively; see AM3) |
| M-B4 `inviteClientUser` | PE-eligible form | `browser` | same; **denial paths only** (AM2). Per H2 the harness never creates or invites an Auth user, so the positive path is never driven |
| M-B5 `updateClientUser` | PE-eligible form | `browser` | same — the `data_scope` write R2 depends on |
| M-B6 `deleteClientUser` | PE-eligible form | `browser` | same; destructive, fixture-only (§6) |
| M-B7 `generateSuggestions` | PE-eligible form | `browser` | same |
| M-B8 `reviewObservations` | PE-eligible form | `browser` | same; the three `name="mode"` submit buttons are ordinary named submitters that a no-JS browser sends correctly |
| M-B9 `createBlankStudy` | PE-eligible form | `browser` | same; this is the surface that creates the run's fixture study inside the throwaway tenant (§6) |
| M-B10 `createStudyFromTemplate` | PE-eligible form | `browser` | same |
| M-B11 `saveStudyAsTemplate` | PE-eligible form | `browser` | same |
| M-B12 `updateTemplateMetadata` | PE-eligible form | `browser` | same |
| M-B13 `deleteTemplate` | PE-eligible form | `browser` | same; destructive, fixture-only |
| M-C1 `updateStudyConfiguration` | client-component form | **`browser`** | Stage rows are client state (`StudyConfigurator.tsx:30,47,52`), so the browser runtime is needed to compose the form even if the submit degrades. `assertDegrades()` may additionally record that it degrades; that record never downgrades the mechanism |
| M-D1 `analyzeImportFile` | imperative | `browser` | Called from `startTransition` with JS-built `FormData`; no form binding exists |
| M-D2 `previewImportFile` | imperative | `browser` | same |
| M-D3 `confirmImportFile` | imperative | `browser` | same |
| M-D4 `rollbackLatestImport` | imperative | `browser` | Takes a bare `string`; a form cannot express it at all |
| M-D5 `refreshStudyDashboard` | imperative | `browser` | Triggered by a filter `<select onChange>`; the framework serializes plain JS values |
| M-D6 `computeStudyPivot` | imperative | `browser` | same; the forged-pivot-intent case (C3) is produced by driving the real controls into a rejected combination, never by posting a synthesized intent |

**Rows: 31. `TBD`: 0. `seam`: 0.**

### 2.2 Frozen mechanism selection (no run-time fallback)

Mechanism selection is a **checked-in fact**, not a run-time negotiation.

1. **Default.** Every surface that has not been behaviorally verified carries
   `browser`, which is already reviewed and can reach every one of them.
2. **Discovery.** During PR 5 implementation, `assertDegrades()` may be run
   against a PE-eligible surface to find out whether it truly submits natively
   with JavaScript disabled.
3. **Freeze.** The result is written into `OPERATIONS` (§8.3) and lands in PR 5's
   reviewed diff. A surface becomes `form` only through that committed change.
4. **Drift is red.** If a surface whose frozen mechanism is `form` later fails to
   submit natively, the run **fails**. The harness does not retry it as
   `browser`, does not record a "demotion", and does not continue. A progressive
   enhancement that stopped working is a real product regression and must be
   loud.
5. **One-directional review.** `browser → form` requires a discovery run plus a
   committed catalog change. `form → browser` is likewise a committed change,
   never an automatic one. Nothing ever moves toward `seam`.

There is therefore no `fallback` field on an operation descriptor and no
`demoted` field on a result (§8.2).

### 2.3 What each mechanism may and may not touch

| | reads rendered HTML | reads framework hidden fields | constructs the request | carries cookies |
|---|---|---|---|---|
| `http` | only for evidence classification (status, `Location`, `content-type`) — never to extract a form field | **never** | Node `fetch`, plain URL + method | from the actor jar |
| `form` | only semantically, to *locate* the form (§4.1) | **never** — the browser submits its own DOM | the browser's native HTML form machinery | browser context |
| `browser` | only semantically, to *locate* controls | **never** | the application's own React runtime | browser context |

**Action-response rule (all mechanisms).** An imperative Server Action's outcome
is classified **only** from (a) the stable rendered DOM the application produces
in response, (b) a navigation or redirect, and (c) public HTTP status and
response headers. The harness **never parses, inspects, snapshots, decodes or
classifies a Server-Action / RSC response body or any framework transport
payload** — reading that payload would make the harness depend on the same
private serialization prohibition 2 forbids it from writing. This is asserted by
G2 (§9.2).

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
| `invalidToken` | a jar whose Supabase auth cookie value has been replaced with structurally malformed bytes (§3.4). Named for what it *is* — an invalid token — not for a signature the harness cannot and must not produce |

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

**A browser is mandatory for PR 5's self-test.** If no supported browser binary
is found, `harness-selftest` **exits non-zero as unsupported/incomplete**. It
never reports green, never reports "skipped", and never substitutes another
sign-in path. Mechanism coverage that was not exercised cannot be claimed
(§9.1 S0).

A second, **strictly lower-fidelity HTTP-only utility** exists: signing in with
`@supabase/ssr`'s `createServerClient` and the **publishable/anon key** against
Supabase Auth, populating the jar from its `setAll` callback — the pattern
already used at `scripts/responsive-layout-test.mjs:105-122`. It is a genuine
Supabase Auth sign-in with a real password and a real issued token; it is not a
fabricated session and not `service_role`. Its boundaries are absolute:

- it exists only to give `http`-mechanism operations a session in contexts that
  make no browser or form claim;
- it **cannot make `harness-selftest` green**, and its presence never satisfies
  S0–S9;
- it is **not** a substitute for M-A1, and any evidence record minted through it
  is marked as such and is inadmissible for a `form` or `browser` proof;
- no suite may cite it where the assertion is about the login surface itself.

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
- **Isolation is asserted, not assumed — and asserted without credential-derived
  evidence.** The PR 5 self-test (§9.1 S2) proves three things, none of which
  prints or derives a value from a cookie or token:

  1. **Storage separation is structural.** Each actor owns a distinct jar object
     and a distinct browser context; the harness asserts object identity
     distinctness (no jar or context is referenced by two actors). This is a
     comparison of references, not of contents.
  2. **No auth credential is reused across actors.** Restricted to the Supabase
     auth-cookie namespace, the harness asserts in memory that no auth-cookie
     value present in one actor's jar is present in another's. The assertion
     yields a **boolean**; the values are compared, never printed, never hashed,
     never summarized, and never stored beyond the jar itself. **Ordinary,
     non-auth cookies are explicitly permitted to be identical across actors** —
     framework, locale and layout cookies are shared by design and must never
     fail this check.
  3. **The application agrees.** Each actor's context reports that actor's own
     identity through the app's own rendered signal (§3.5), and clearing one
     actor's session denies that actor while leaving the others working — which
     is the behavioral counterpart of (1) and (2).

### 3.4 Negative session cases — what is executable, and what is deferred

Supabase's documented behavior constrains this section, and the design states it
plainly rather than assuming a stricter model than the platform provides:
**signing out revokes the refresh session; it does not retroactively invalidate an
already-issued access-token JWT, which stays valid until its own `exp`.** A
harness that asserted "after logout the captured JWT is immediately rejected"
would be asserting something the platform does not promise, and would eventually
fail — or, worse, pass for the wrong reason.

| # | Case | Construction | Never involves | What is actually proven | Status |
|---|---|---|---|---|---|
| N1 | **Logged out** | empty jar; no sign-in attempted | — | protected page → 302 `/login`; H2 → 401 | **executable** |
| N2 | **Invalid / malformed token** | take a real signed-in jar and replace the Supabase auth cookie's **value** with structurally invalid bytes of the same length class (a base64-shaped string that is not a JWT, or a JWT-shaped string whose signature segment is random bytes) | **no valid signature is ever produced**; no signing key is read, derived or guessed; no `service_role` JWT is constructed | the app does not trust the cookie's *contents*: `getUser()` verifies rather than decodes, so the request is rejected **immediately** on the next protected route — 302 `/login` / 401 | **executable** — this is the immediate protected-route negative case |
| N3 | **Revoked refresh session** | sign in normally, then sign out through the application's own `logout` (M-A2) or Supabase Auth's `signOut`, then attempt to **mint or refresh a session from the prior refresh credential** | no clock manipulation, no token fabrication, no printing of any credential, no change to remote Auth configuration | the revoked refresh session **cannot produce a new session**: the refresh attempt is rejected, so the session cannot be resurrected once signed out | **executable** — recorded as `revoked_refresh`, never as "expired" |
| N4 | **Genuinely expired access token** | — | — | that a *correctly signed but time-expired* access JWT is rejected on a protected route | **deferred — not executable** (see below) |
| N5 | **Cross-tenant** | a fully valid `tenantA` session requesting a `tenantB` resource | no tampering of any kind | H2 → **404**, not 401 (`report/route.ts:34`); dashboard → zero `tenantB` content | **executable** |

**What N3 does *not* claim.** N3 does not assert that replaying the captured,
still-unexpired access token is rejected immediately after sign-out. If the
harness observes that such a replay still succeeds before `exp`, that is
**expected Supabase behavior, recorded as an observation and not as a finding**.
No suite may treat it as a defect, and the harness must not convert it into one.

**Why N4 is deferred rather than approximated.** Obtaining a genuinely expired,
correctly signed access token would require one of: manipulating a clock,
fabricating or re-signing a token, persisting a credential across runs until it
ages out, changing the project's Auth token lifetime, or blocking for the full
JWT TTL. Every one of those is forbidden by this design or by `CLAUDE.md`, and
**this pass does not invent a mechanism to get around that**. N4 therefore stays
explicitly unavailable: it is named in the coverage record as *deferred, not
executed*, exactly as `docs/P7_PLAN.md` §5.1 requires E1 to be named. If the
repository later gains a safe, real, bounded mechanism that satisfies all of those
constraints, N4 becomes a separate reviewed change — not a silent relabelling.

**Never relabel N3 as N4.** They prove different properties, and the vocabulary
keeps them apart: `sessionKind` is `revoked_refresh`, never `expired`. R17's
"expired/invalid/tampered session" requirement is therefore satisfied by N1, N2
and N3 today, with the *expired* half of it explicitly outstanding.

### 3.5 Proving which actor actually performed a request

Denial evidence is worthless if the harness cannot show *who* was denied. Two
independent proofs are required, and both are recorded:

1. **Identity assertion through the application's own signal.** Immediately after
   sign-in, and again at the start of each suite phase, the actor issues
   `GET /dashboard` and the harness asserts that the email the dashboard prints
   for the signed-in user (`src/app/dashboard/page.tsx:148-150`) matches the
   actor's configured email. This is the application telling the harness who it
   thinks the caller is. It is never read from the cookie.
2. **Session provenance, via a credential-independent label.** Every evidence
   record carries the actor id and a `sessionLabel`: a short **random opaque
   token generated by the harness** (e.g. 8 random base36 characters) at the
   moment a session is established. It is **not derived from — and carries no
   information about — any cookie, access token, refresh token or other
   credential**: it is generated before the credential is read, from the
   runtime's random source, and bound internally to exactly one
   (actor, session) pair. Two records carrying the same label were made by the
   same session; a record whose label differs from the actor's currently
   registered label is a harness bug and fails the run. Establishing a new
   session (sign-in, `session.clear`, `session.invalidate`) mints a new label.
   Because the label is credential-independent, printing it discloses nothing
   (§5.2).

For the `anonymous` actor, proof 1 is inverted: `/dashboard` must redirect, and
the jar must be empty.

### 3.6 Explicit non-capabilities

The harness has **no** ability to: mint a JWT, sign anything, read the Supabase
JWT secret, elevate a `client` actor to `internal`, call a Server Action as one
actor while carrying another's cookies, use `service_role` to answer any
authorization question, **derive any printable value from a credential** (there
is no hash, digest or fingerprint of a cookie or token anywhere in the design —
see §3.5), **manipulate a clock or token lifetime**, or **read a
Server-Action / RSC response body** (§2.3). These are absences of code, not
disabled features.

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
| refresh session revoked (N3) | the refresh attempt returns its rejection (§3.4) |

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
not a flake. Zero retries for any mutating operation, ever. **No request retry
loops, no request bursts, no backoff ladders, no "try until green", no
application-state polling, no load loops, no unbounded retries, and no arbitrary
sleeps.** A suite that cannot decide from one answer is a suite with an ambiguous
assertion.

### 4.4.1 The one loop the design permits: bounded CDP event processing

Driving a browser over raw CDP inherently requires **reading messages off a
WebSocket until the awaited response or event arrives**. That is a message-pump,
not a poller, and forbidding it would forbid the mechanism itself. It is
permitted under all of the following, together:

- it consumes **messages the browser pushes**; it never issues an application
  request inside the loop, and never re-sends one;
- it terminates on a **monotonic deadline** (`performance.now()` / `hrtime`, not
  wall-clock), bounded by the per-operation timeouts above;
- it terminates on an **explicit maximum message/event count**, so a chatty or
  looping page cannot keep it alive indefinitely;
- exhausting either bound is a **failure** that is recorded and propagated, never
  a retry and never a silent continue;
- it never sleeps between iterations and never waits on application state — that
  belongs to the readiness conditions in §4.3.

Any loop that issues, re-issues or probes an application endpoint is forbidden
regardless of its bounds. G6 (§9.2) tests exactly that distinction.

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
| `sessionLabel` | `k3f9qa7t` | harness-generated **random opaque** label, created independently of any credential and bound to one (actor, session) pair (§3.5). Carries no information about any cookie or token |
| `sessionKind` | `live` \| `invalid` \| `revoked_refresh` \| `none` | distinguishes §3.4's cases N1–N3. There is deliberately **no `expired` value** — N4 is deferred (§3.4) |
| `operation` | `report.download` | **stable operation name** from a fixed vocabulary, decoupled from the URL |
| `mechanism` | `http` \| `form` \| `browser` | the operation's **frozen catalog mechanism** (§2.2). There is no demotion field, because there is no run-time fallback |
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
values · **any Server-Action / RSC response body or framework transport payload**
(§2.3) · raw server error text · Supabase error `details` / `hint` · **any hash,
digest, fingerprint, prefix or other value derived from a credential** · the
concrete uuids of any object other than the run's own fixture ids and the
read-only P6E control id already published in `docs/CURRENT_STATE.md`
(§6.2, §9.1.1).**

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

**No credential-derived value exists anywhere in the design.** The earlier
revision of this note proposed a truncated SHA-256 of the auth cookie as a
session marker; that has been **removed**. Even a one-way prefix is derived from
a secret, invites "how many bits is safe" arguments that no reviewer should have
to have, and would put credential-shaped material into a printed artifact. The
`sessionLabel` (§3.5) replaces it: it is random, minted before the credential is
read, and correlates records just as well while disclosing nothing.

### 5.3 The outcome classifier — denial vs. everything it is not

`scripts/rls-coverage-test.mjs` already establishes the right pattern in this
repository: a small classifier with **its own self-test over fixed cases** before
any live call (`checkClassifier`, `CLASSIFIER_CASES`). The harness adopts it. The
vocabulary is closed:

| Category | Recognized by | Is it a denial? |
|---|---|---|
| `denied_unauthenticated` | 401, **or** 3xx whose `Location` path is `/login` | **yes** |
| `denied_wrong_role` | 3xx whose `Location` path is `/dashboard` in response to an `/admin/*` request; **or** an action result carrying the app's fixed denial string | **yes** |
| `denied_action_result` | class M-D: the **rendered DOM** the component produces in response shows the application's denial state — the error region `UploadForm` renders from `{ status: "error" }` (`upload/actions.ts:78-93`), or the error text `StudyCard` / `PivotExplorer` render from `{ ok: false }` (`data-actions.ts:33`). Classified from the DOM, the navigation and the public HTTP status only — **never by parsing the action's response body** (§2.3) | **yes** — this is the class where a 200 transport means denied |
| `not_found` | 404 (`report/route.ts:32`, `:34`, `:37`; `notFound()` in P8) | **no** — absence, which may be *correct* isolation behavior but is a different claim |
| `validation_rejected` | 400 with the app's structured error shape (`report/route.ts:39`, `:43`), or a rendered validation message the component displays for a Zod-derived rejection | **no** — input was refused, authorization was never reached |
| `success` | 2xx **and** the operation's own success signal, read only from public headers, the redirect target, or the rendered DOM (a PDF `content-type`, a redirect carrying `?ok=`, a rendered result region) | **no** |
| `success_no_op` | 2xx + success signal **but** the fixture residue count is unchanged | **no** — flagged loudly; a mutation that "succeeded" and changed nothing is a false pass and fails the run |
| `network_failure` | connection refused/reset/DNS/timeout, no HTTP response | **no** — harness/environment failure |
| `page_crash` | 5xx, an uncaught page exception, or `render_incomplete` | **no** — **fails the run**; never reported as a denial |
| `unclassified` | anything not matching the above | **no** — **fails the run**; the classifier is extended by a human, never widened silently |

Two rules make this safe:

- **`unclassified` fails.** The default is not "denied". A harness that treats
  unknown answers as denials manufactures green suites.
- **The classifier self-tests offline first.** Fixed synthetic cases (a 302 to
  `/login`, a 302 to `/dashboard`, a 404, a 400 in the report route's error
  shape, a 200 whose *rendered DOM* carries the denial region, a 500, a socket
  error) run before any live request. If the classifier is wrong, the run stops
  before it can mislabel anything.

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
can never be confused with a real or accepted object.

The prefix is the run's **ownership and collision namespace — it is never a
deletion key.** It answers "could this object be mine?" for the preflight check
(§6.3) and for the residue assertion after cleanup (§6.7); it never selects what
gets deleted. **Cleanup deletes only the exact ids recorded in the ledger**
(§6.4), one `id = <ledger id>` predicate at a time. No delete is ever issued by
prefix, by name, or by any other pattern match — a prefix delete would be a
predicate broad enough to remove an object the run did not create, which is
precisely the failure mode the ledger exists to prevent.

### 6.2 The out-of-bounds list — never touched, mutated or deleted

Enforced as an explicit deny-list checked before every mutating operation:

| Object | Id / identifier |
|---|---|
| P6E acceptance study | `ad275928-dbd1-4acf-9de9-fa1623b32a60` |
| P6E import batch | `bd4f26db-093a-4e31-8fa9-de8281300c63` |
| The two historical draft studies | `Satisfacción 2026 (TEST)` (both) |
| Tenant A / Tenant B | `TEST_TENANT_A_ID` / `TEST_TENANT_B_ID` — **read as an actor, never mutated**, and never used to hold mutation fixtures (§6.6) |
| The three fixture auth users | sign-in only; never modified or deleted |
| **Every Auth user, without exception** | the harness never creates, invites, updates or deletes one (§6.6) |
| Anything without the run prefix | — |

The P6E acceptance study is on this list **and is additionally used as a
read-only positive control** for the report route (§9.1 S6). That is not a
contradiction: the deny-list governs *mutation*, and the control is
`GET`-only. Concretely, for `ad275928-dbd1-4acf-9de9-fa1623b32a60` the harness
may issue authenticated `GET` requests and may read its metadata; it may
**never** publish, unpublish, reconfigure, rename, re-import, delete, add to the
fixture ledger, or include it in any cleanup pass. It is not
cleanup-owned data, and a run that ends with it altered in any way is a defect,
not a fixture leak.

A mutating operation whose target resolves to a deny-listed id **aborts the run
before the request is sent**. This is a precondition, not a post-hoc check.

### 6.3 Preflight collision check

Before creating anything, the harness asserts that **zero** objects already carry
the run prefix (`study.name`, `tenant.name`, `study_template.name`,
`import_batch`, and the auth-user email space). A collision means a previous run
leaked: the run **refuses to start** and prints the colliding prefix (§6.7)
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
- delete the ledger's exact ids during cleanup, never a prefix or name match (§6.7).

It may never create an object that a suite then treats as evidence that the
application created it, and it may never be the actor in any request whose
outcome is an authorization claim. `CLAUDE.md`'s standing rule — *never bypass
the real application workflow by manually inserting acceptance rows* — is
restated here as a harness invariant.

### 6.6 The throwaway tenant (H2, approved with constraints)

Mutation fixtures live in a **tenant the run creates and destroys**, never in an
existing tenant. The approved constraints are binding:

| Constraint | How the design meets it |
|---|---|
| Created through the real application surface | one tenant, created by the `internal` actor driving **M-B1 `createTenant`** through its frozen catalog mechanism — never a `service_role` insert (§6.5) |
| Exactly one, current-run-prefixed | its name carries the run prefix `P7H-…` (§6.1); creating a second throwaway tenant in one run is a harness error |
| Recorded by exact id | the id is captured from the application's own post-create response and written to the ledger as `{ kind: "tenant", id, … }`. Nothing is matched by name at deletion time |
| Contains only current-run fixtures | every fixture object the run creates is created **inside this tenant**; an operation that would place a fixture in any other tenant aborts the run |
| **Never creates or invites an Auth user** | M-B4 `inviteClientUser` is driven only for its denial paths (AM2, §2.1). No positive-path user creation exists anywhere in the harness, so the tenant is always user-less. Existing fixture actors are re-used for authentication and are never modified |
| Children deleted before the tenant | cleanup deletes ledger entries **newest-first and child-kinds-before-tenant** (studies, templates, import batches, storage objects, then the tenant), each by exact id, so no delete relies on a cascade to reach an object the ledger did not name |
| Residue or failure is red | any remaining prefixed object, any failed delete, or a tenant that could not be removed exits the run non-zero (§6.7) |
| Never reuse or mutate an existing tenant | the deny-list (§6.2) rejects any mutating operation targeting `TEST_TENANT_A_ID`, `TEST_TENANT_B_ID`, or any tenant id not equal to the run's own throwaway tenant id — checked **before** the request is sent |

### 6.7 Cleanup, and what happens when it fails

Cleanup runs in a `finally` block entered on success, on assertion failure, on
exception, and on the run timeout. It deletes **exactly the ledger's ids**,
newest first and **children before the throwaway tenant** (§6.6), and never
issues a delete predicate broader than `id = <ledger id>`. Afterwards it re-runs
the preflight query and asserts zero remaining prefixed objects. The read-only
P6E control is never part of this pass.

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
| PR 5 self-test (§9) | ✓ **required** | informational only | **H1, approved:** local is the entire merge gate. A remote run may be performed and recorded, but is never required PR 5 evidence and never appears as such in a PR description, handoff note or status table (§9.3, §11.1) |

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
and `@supabase/ssr`. **PR 5 adds zero dependencies**, and any future dependency
would require its own justification and approval rather than arriving with the
harness.

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
type ActorId = "tenantA" | "tenantB" | "internal" | "anonymous" | "invalidToken";
type Mechanism = "http" | "form" | "browser";

/** No "expired" member: N4 is deferred and must never be simulated by N3 (§3.4). */
type SessionKind = "live" | "invalid" | "revoked_refresh" | "none";

type Actor = {
  id: ActorId;
  role: "client" | "internal" | null;
  sessionKind: SessionKind;
  /** opaque; never printed, never serialized, never shared across actors */
  jar: CookieJar;
  /** Random opaque label minted by the harness when the session is established.
   *  NOT derived from any cookie, token or other credential — generated from the
   *  runtime's random source before the credential is read (§3.5). Safe to print. */
  sessionLabel: string | null;
};

type OperationDescriptor = {
  /** stable, build-independent name, e.g. "studies.createBlank" */
  name: string;
  /** templated path, e.g. "/api/studies/:studyId/report" */
  urlClass: string;
  /** FROZEN in this checked-in catalog (§2.2). `form` appears only where a
   *  committed discovery run verified native no-JS submission. There is no
   *  `fallback` field: a frozen `form` that stops degrading is red, not demoted. */
  mechanism: Mechanism;
  /** Provenance of a `form` entry, so a reviewer can see why it is not `browser`. */
  degradationVerifiedAt?: string;
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
  sessionLabel: string | null;
  sessionKind: SessionKind;
  operation: string;
  mechanism: Mechanism;          // the frozen catalog value; no `demoted` field exists
  /** true only for a session minted by the lower-fidelity HTTP-only utility
   *  (§3.2); such a record is inadmissible as `form` or `browser` evidence. */
  httpOnlySession: boolean;
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
  origin: string;                    // the ONLY topology switch (§7.1)
  actors: ActorId[];
  /** "required" is the only value the self-test accepts. "httpOnlyUtility" is the
   *  lower-fidelity path of §3.2: it can never make harness-selftest green and
   *  cannot serve a `form` or `browser` claim. Absence of a browser under
   *  "required" exits non-zero as unsupported/incomplete. */
  browser: "required" | "httpOnlyUtility";
  runTimeoutMs?: number;             // bounded; never raised without review
}): Promise<Harness>;

harness.signIn(actor: ActorId): Promise<Actor>;         // through M-A1 (§3.2)
harness.assertIdentity(actor: ActorId): Promise<void>;  // the app's own signal (§3.5)
/** Structural + behavioral isolation (§3.3). Compares auth-cookie values in
 *  memory and returns a boolean verdict; prints no name, value, hash or
 *  token-derived metadata, and never fails on identical NON-auth cookies. */
harness.assertSessionIsolation(): Promise<void>;
harness.close(): Promise<void>;   // kills the browser it started; idempotent

// ---- session manipulation (§3.4) — no signing, no clock control, ever -------
/** N2: replace the auth cookie value with structurally malformed bytes. */
harness.session.invalidate(actor: ActorId): Promise<Actor>;
/** N3: sign out, then prove the prior REFRESH session cannot mint a new one.
 *  Does NOT claim the already-issued access JWT is immediately rejected. */
harness.session.revokeRefresh(actor: ActorId): Promise<SanitizedResult>;
/** N1: empty jar. */
harness.session.clear(actor: ActorId): Promise<Actor>;
// N4 (genuinely expired access token) has NO function here — deferred by §3.4.

// ---- the single execution entry point --------------------------------------
harness.run(
  actor: ActorId,
  op: OperationDescriptor,
  params?: Record<string, string>,  // fills :placeholders and named form fields
): Promise<SanitizedResult>;

// ---- progressive-enhancement DISCOVERY (§1.6, §2.2) ------------------------
/** Implementation-time tool only. Reports whether a surface submits natively
 *  with JavaScript disabled. It does NOT change any mechanism: the result is
 *  written into OPERATIONS by hand and reviewed in PR 5's diff. Calling it does
 *  not make a `browser` surface run as `form`, and a frozen `form` surface that
 *  fails here is red. */
harness.assertDegrades(op: OperationDescriptor): Promise<{ degrades: boolean }>;

// ---- fixtures (§6) ---------------------------------------------------------
harness.fixtures.prefix: string;
harness.fixtures.preflight(): Promise<void>;              // refuses on collision
harness.fixtures.track(record: FixtureRecord): void;
harness.fixtures.residue(kinds: string[]): Promise<Record<string, number>>;
/** Deletes ledger ids newest-first, children before the throwaway tenant (§6.6). */
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
accessor, any Server-Action/RSC body reader, any credential-hashing helper, any
run-time mechanism selector, and any function accepting a `service_role` key as
an actor credential.

---

## 9. PR 5 self-test and acceptance criteria

`npm run test:harness-selftest` — the one script PR 5 adds — must prove all of
the following in a single bounded run against a locally built app, and must exit
non-zero if any of them fails.

### 9.1 Behavioral proofs

| # | Proof | Pass condition |
|---:|---|---|
| S0 | Browser availability | a supported browser binary is found and driven. If none is available the run **exits non-zero as unsupported/incomplete** — never green, never "skipped". The HTTP-only utility (§3.2) cannot satisfy this or any row below |
| S1 | Sign-in for all three actors through M-A1 | `tenantA`, `tenantB` and `internal` each reach an authenticated `/dashboard`; each `assertIdentity()` matches the configured email via the app's own rendered signal |
| S2 | Session isolation, without credential-derived evidence | (a) each actor owns a distinct jar object and browser context (reference identity); (b) an in-memory comparison restricted to the **auth-cookie namespace** finds no value shared between actors, and **identical non-auth cookies do not fail it**; (c) the three `sessionLabel` values are distinct; (d) clearing one actor denies that actor while the others still succeed. No cookie name, value, hash or token-derived metadata is printed |
| S3 | Logged-out handling | `anonymous` → `/admin/studies` classified `denied_unauthenticated` with `redirectTo === "/login"`; `anonymous` → H2 classified `denied_unauthenticated` with status 401 |
| S4 | Invalid-token handling (N2) | `session.invalidate(tenantA)` → the next protected page is classified `denied_unauthenticated` **immediately**; recorded `sessionKind: "invalid"` |
| S5 | Revoked-refresh handling (N3) | after sign-out, an attempt to mint or refresh a session from the prior refresh credential is rejected; recorded `sessionKind: "revoked_refresh"`. The run **does not** require the still-unexpired access token to be rejected, and records any continued acceptance before `exp` as expected platform behavior rather than a finding. **S4 and S5 produce distinct records, and neither is ever labelled "expired"** |
| S5b | Deferred case is named, not faked | the run's coverage output names **N4 (genuinely expired access token) as deferred and not executed**, with its blocking reason (§3.4). No code path simulates it |
| S6 | Direct-route proof on H2, against a **read-only** control (see §9.1.1) | **S6a (always required):** using the P6E control id, `anonymous` → `denied_unauthenticated` (401); a malformed uuid → `not_found` (404); `tenantB` → `not_found` (404, non-disclosure). **S6b (positive control, precondition-gated):** if the read-only precondition in §9.1.1 holds, the actor that owns the study (`tenantA` if its tenant matches, otherwise `internal`) → `success` with `content-type: application/pdf`. Every request is a `GET`; nothing about the study is mutated, ledgered or cleaned up. Recorded, **not** asserted as a suite verdict |
| S7 | Progressive enhancement is *discovered and frozen*, not negotiated | `assertDegrades()` is run against M-A1 `login` and at least one M-B form **during implementation**, and the outcome is written into `OPERATIONS` in PR 5's reviewed diff. At run time the self-test asserts that each surface behaves as its **frozen** catalog entry says: a frozen `form` that fails to submit natively is **red**, and no run-time demotion to `browser` occurs or is recorded. Surfaces whose catalog entry is `browser` are exercised as `browser` |
| S8 | One browser-driven imperative Server Action | `internal` drives M-D6 (`computeStudyPivot`) through `PivotExplorer`'s real controls and receives a rendered result; the record shows `mechanism: "browser"` |
| S9 | Throwaway tenant, fixture creation, ordered cleanup, zero residue | one prefixed tenant is created through M-B1 and one prefixed study inside it through M-B9 (the real workflows, §6.5); both are ledgered **by exact id**; `finally` deletes the study before the tenant, each by exact id; the post-run preflight returns zero prefixed objects and `leaked` is empty. **No Auth user is created or invited at any point.** Any residue or cleanup failure makes the run red |
| S10 | Classifier self-test | the fixed offline cases in §5.3 all classify correctly **before** any live request; an unrecognized case yields `unclassified` and fails |
| S11 | Deny-list precondition | a synthetic attempt to target `ad275928-dbd1-4acf-9de9-fa1623b32a60`, `TEST_TENANT_A_ID` or `TEST_TENANT_B_ID` in a **mutating** operation aborts **before** any request is sent, while the S6 read-only `GET` requests against the same P6E id proceed — proving the deny-list gates mutation, not reads |

#### 9.1.1 Why S6 uses the P6E study, read-only, and what happens if it cannot

A **newly created blank study does not yield a 200 PDF.** It has no respondents
and no rows, and `report/route.ts` additionally returns 404 when the study's
`dashboard_config` disables the report section (`:37`). Asserting that a fixture
PR 5 just created returns `application/pdf` would therefore be asserting
something the application does not promise. This revision removes that claim.

The report route's success path needs an already-populated, already-published
study, and exactly one exists: the **P6E acceptance study**, whose id, tenant,
status and row counts are recorded as non-secret test metadata in
`docs/CURRENT_STATE.md` ("P6E acceptance record"). It is therefore
**deterministically locatable without a secret and without a guess**.

**Precondition, evaluated read-only before S6b runs.** Using the same narrowly
scoped `service_role` metadata read permitted for preflight (§6.3) — metadata
only, never rows — the harness confirms that the study still exists, is
`published`, has its report section enabled, and identifies which tenant owns it.
It then selects the actor accordingly: `tenantA` when `TEST_TENANT_A_ID` matches
the study's tenant, otherwise `internal`, which reads every study through
`loadAuthorizedStudyData` (`src/lib/studies/authorized.ts:84`).

**If the precondition does not hold** — the study is missing, unpublished, or its
report section is off — then **S6b is recorded as unavailable and not executed**,
S6a still runs and still gates the merge, and the note states plainly that
**positive report-route coverage belongs to Suite B/C (PR 7), not to PR 5.** The
harness never manufactures a substitute fixture to force a 200, and never
publishes or reconfigures anything to make the precondition true.

**Read-only is enforced, not promised.** Every S6 request is a `GET`. The P6E
study is never added to the fixture ledger, never appears in a cleanup pass, and
remains on the mutation deny-list throughout (§6.2) — which S11 proves by showing
a mutating attempt on the same id aborts while these reads proceed.

### 9.2 Structural guarantees (asserted over the harness's own source)

Each is a source assertion in `harness-selftest.mjs` over
`scripts/lib/http-harness.mjs`, `harness-browser.mjs` and `harness-fixtures.mjs`:

| # | Guarantee | Assertion |
|---:|---|---|
| G1 | No hashed action ID is constructed, scraped or stored | no occurrence of `$ACTION_ID`, `next-action`, `Next-Action`, `text/x-component`, `encodeReply`, or a locator matching a hex/hash-shaped selector |
| G2 | No private RSC payload builder **and no private RSC payload reader** | no import from `react-server-dom-webpack`, from `react-dom/server` internals, or from any Next internal path; no hand-assembled multipart action body; and **no code path that parses, decodes, snapshots or classifies a Server-Action / RSC response body or framework transport payload** — action outcomes are classified from rendered DOM, navigation and public status/headers only (§2.3) |
| G3 | No bypass flag | no environment variable read by the harness alters an authorization decision, a mechanism, a locator or a classifier; the only recognized switches are `origin`, `browser`, `runTimeoutMs`, and the documented `TEST_*` / `NEXT_PUBLIC_*` / `CHROME_PATH` fixture variables |
| G4 | No service-role authorization evidence | `SUPABASE_SERVICE_ROLE_KEY` / `SUPABASE_SECRET_KEY` appear only inside `harness-fixtures.mjs`, and only in the preflight / residue / cleanup functions — never in a code path producing a `SanitizedResult` |
| G5 | No secret logging **and no credential-derived value at all** | every printed field originates in `SanitizedResult` or `FixtureRecord`; there is no code path from a response body or a cookie to an output stream; and **no hashing, digest, fingerprint or truncation is ever applied to a cookie, access token, refresh token or other credential** — `sessionLabel` is asserted to come from the runtime's random source, not from any credential (§3.5) |
| G6 | No arbitrary sleeps, no application polling, no unbounded loops — while permitting the CDP message pump | asserts the **real** risk rather than banning `while` syntax outright: (a) no bare `setTimeout` used as a wait on application state; (b) **no loop whose body issues, re-issues or probes an application request** — the property that distinguishes a poller from a message pump; (c) every loop that reads CDP messages carries **both** a monotonic deadline and an explicit maximum message/event count, and treats exhaustion as a recorded failure rather than a retry; (d) retry counters are ≤ 1 and apply only to transport failures during readiness or sign-in (§4.4, §4.4.1) |
| G7 | No production source is modified, and no dependency is added | PR 5's diff touches `docs/`, `scripts/`, and exactly one `package.json` script line — no file under `src/` or `supabase/`, and not `next.config.ts`, `src/middleware.ts` or `wrangler.toml`. `package.json`'s `dependencies` and `devDependencies` and `package-lock.json` are unchanged; any future dependency requires separate justification and approval |

| G8 | Mechanism selection is frozen, not run-time | `OPERATIONS` is a static, checked-in catalog; no code path assigns or rewrites an operation's `mechanism` at run time; there is no `fallback` field, no `demoted` field, and no branch that retries a `form` operation as `browser` |
| G9 | No clock or token-lifetime manipulation | no code sets, offsets or fakes a system clock, and nothing alters an Auth token lifetime or remote Auth configuration; there is no `expired` session kind to produce (§3.4 N4) |

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

**These commands run locally, and local is the whole merge gate (H1, approved).**
A run against the deployed synthetic beta is **optional and informational only**.
It may never be presented — in the PR description, a handoff note, a status table
or this document — as required PR 5 evidence, and its absence never blocks the
merge. Suites B and C carry the deployed-run requirement at PR 7
(`docs/P7_PLAN.md` §9.1).

### 9.4 What PR 5 explicitly does **not** claim

Its report must state, verbatim: *"The harness mechanism is proven. No security
suite has been run. Suites A, B, C and E remain as recorded in
`docs/P7_PLAN.md` §5."*

It must additionally record, rather than quietly omit: **N4 (genuinely expired
access token) as deferred and not executed** (§3.4); whether **S6b** ran or was
recorded unavailable (§9.1.1); and which surfaces are frozen as `form` versus
`browser` (§2.2). A remote run, if performed, is labelled informational.

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
| R-7b | **A truncated hash / digest / fingerprint of an auth cookie as a session marker** | Proposed in the first revision of this note and now **rejected**. It is still a value derived from a secret; it invites an unwinnable argument about how many bits are safe to print; and it puts credential-shaped material into an artifact whose whole purpose is to be safe to read. The random `sessionLabel` (§3.5) correlates records exactly as well and discloses nothing, so the derived value buys no capability |
| R-7c | **Treating sign-out as immediate access-token invalidation** | Supabase revokes the *refresh* session on sign-out; an already-issued access JWT stays valid until its `exp`. Asserting immediate rejection would assert a guarantee the platform does not make — a test that is wrong today or passes for the wrong reason tomorrow. N3 proves the property that actually holds (the refresh session cannot mint a new session), and N4 stays honestly deferred (§3.4) |
| R-7d | **Simulating an expired token** by clock manipulation, re-signing, persisting a credential until it ages out, changing the Auth token lifetime, or sleeping through the TTL | Each is forbidden by this design or by `CLAUDE.md` — the first two fabricate evidence, the third stores a credential, the fourth mutates remote configuration, the fifth is an arbitrary sleep. A deferred check named as deferred is worth more than a simulated check named as passing, which is the same reasoning `docs/P7_PLAN.md` RD2 applies to E1 |
| R-7e | **Run-time demotion of a failing progressive-enhancement surface to `browser`** | It converts a real product regression into a silent pass: the suite stays green while the no-JS path it was supposed to protect is broken. Freezing the mechanism in a reviewed catalog (§2.2) keeps the failure loud and keeps mechanism choice inside code review, where it belongs |
| R-7f | **Letting the HTTP-only sign-in utility make the self-test green when no browser exists** | It would let a run claim `form` and `browser` coverage it never exercised. PR 5's entire value is the browser mechanism; without a browser the honest outcome is a non-zero "unsupported/incomplete" exit (§3.2, §9.1 S0) |
| R-7g | **Classifying an imperative action from its RSC / Server-Action response body** | Reading that payload couples the harness to the same private serialization prohibition 2 forbids it from writing, and the coupling would be invisible until a framework upgrade silently changed the shape. Rendered DOM, navigation and public status/headers are stable, product-level signals (§2.3) |
| R-8 | **Playwright or Puppeteer as a dependency** | Would add a large dependency tree to a repository whose supply-chain gate (`npm run suite:d`) was only just brought green, and would need a browser-download step. Raw CDP over the built-in WebSocket already works here (`scripts/responsive-layout-test.mjs`). Rejected as "new infrastructure adopted for convenience" (`docs/P7_PLAN.md` §3 non-goals) |

---

## 11. Decisions

### 11.1 Resolved — approved 2026-08-23, do not reopen

| # | Decision | Resolution |
|---|---|---|
| **H1** | Scope of PR 5's merge gate | **Local-only.** `npm run test:harness-selftest` against a locally built app, plus the standard gate chain, is the entire merge gate. A run against the deployed synthetic beta is optional and **informational only**, and must never be represented as required PR 5 evidence, in this document or anywhere else (§9.3). Deployed-run coverage remains Suite B/C's obligation at PR 7 |
| **H2** | Where mutation fixtures live | **A single current-run-prefixed throwaway tenant, created through the real application surface (M-B1), approved with constraints.** It must contain only current-run fixtures; it must **never create or invite an Auth user**; it must be recorded by exact id; cleanup must delete children before the exact tenant id inside `finally`; and any residue or cleanup failure makes the run red. An existing tenant is never reused or mutated for mutation fixtures. The full constraint table is §6.6 |

### 11.2 Corrections applied in this revision

Recorded so a reviewer can see what changed rather than re-deriving it:

| Area | Correction |
|---|---|
| Credential-derived evidence | `sessionDigest` (a truncated SHA-256 of the auth cookie) is **removed everywhere**. Records now carry a random, credential-independent `sessionLabel` (§3.5, §5.1, §8.2). Rejected as R-7b |
| Session isolation | proven structurally, by an in-memory auth-namespace comparison returning a boolean, and behaviorally — never by printing cookie names, values, hashes or token-derived metadata. **Identical non-auth cookies are explicitly allowed** (§3.3, S2) |
| Revocation semantics | sign-out is described as revoking the **refresh** session, not as invalidating an already-issued access JWT. N3 is a revoked-refresh proof; continued acceptance of an unexpired access token before `exp` is recorded as expected platform behavior, not a finding. N4 (genuinely expired token) is **deferred and named**, never simulated (§3.4). Rejected as R-7c / R-7d |
| Mechanism selection | frozen in a checked-in catalog after implementation-time discovery. Unverified surfaces default to the reviewed `browser` mechanism; a frozen `form` that stops degrading is **red**, never silently demoted. `fallback` and `demoted` are gone (§1.6, §2.1, §2.2, §8.2, G8). Rejected as R-7e |
| Browser availability | mandatory for the self-test; no browser means a non-zero unsupported/incomplete exit. The direct Supabase Auth sign-in is a clearly lower-fidelity HTTP-only utility that can never make the self-test green or stand in for M-A1 (§3.2, S0). Rejected as R-7f |
| S6 | no longer claims a blank fixture study yields a PDF. It uses the accepted P6E study as an explicitly **read-only** control, with a precondition gate and a stated fallback that hands positive report-route coverage to Suite B/C (§9.1.1) |
| Action evidence | classified only from rendered DOM, navigation and public status/headers; never from a Server-Action / RSC response body (§2.3, §5.3, G2). Rejected as R-7g |
| Loop prohibition | refined: arbitrary sleeps, application-state polling, load loops, unbounded retries and request retry loops stay forbidden; the bounded CDP message pump is permitted under a monotonic deadline and an explicit maximum message count, and G6 now tests that distinction instead of banning `while` (§4.4, §4.4.1, G6) |

### 11.3 Standing constraints, unchanged by this revision

No hashed `Next-Action` identifiers · no scraping or replay of rendered
hidden fields · no hand-built React/RSC wire payloads · no authorization bypass,
test mode or environment flag · no `service_role` authorization or isolation
evidence (it remains limited to fixture metadata, counts and cleanup) · no secret
output · no changes under `src/` · no new dependency without separate
justification and approval · the harness reports sanitized observations and the
suites own every assertion and verdict.

### 11.4 Approval status

Both open decisions are resolved and every reviewer correction is applied. **No
design decision remains outstanding; this document is ready for approval as
written**, and PR 5 may proceed to implementation only under a separate explicit
approval.
