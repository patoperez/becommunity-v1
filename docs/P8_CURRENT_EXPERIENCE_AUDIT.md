# P8.0 — Current experience audit

> Evidence document for P8 (Product Experience Transformation). Read
> `docs/P8_PRODUCT_EXPERIENCE_PLAN.md` for the plan and the acceptance contract;
> this file is the source of the evidence that plan rests on.
>
> Method: every claim below was traced to source in the isolated discovery
> worktree at commit `b8fcfc4`. No screen was inferred from a filename. Nothing
> here was measured against a running application — the discovery pass is
> source-only by instruction, so layout and contrast claims are stated as
> *source-visible risks*, not as observed rendering defects.

---

## 0. Scope of the surface

The entire user-facing product is **8 addressable locations**, one redirect and
one generated deliverable, built from about **1,800 lines of TSX/CSS** in
`src/app` (2,962 including its server actions and route handlers) — small enough
that P8 can restructure it rather than patch around it.

| # | Path | Actor | File |
|---|------|-------|------|
| 1 | `/` | any | `src/app/page.tsx` — redirect only, no UI |
| 2 | `/login` | logged out | `src/app/login/page.tsx` |
| 3 | `/dashboard` | client **and** internal (one route, two products) | `src/app/dashboard/page.tsx` |
| 4 | `/admin/clients` | internal | `src/app/admin/clients/page.tsx` |
| 5 | `/admin/studies` | internal | `src/app/admin/studies/page.tsx` |
| 6 | `/admin/upload` | internal | `src/app/admin/upload/page.tsx` + `UploadForm.tsx` |
| 7 | `/admin/qualitative` | internal | `src/app/admin/qualitative/page.tsx` |
| 8 | `/admin/preview/[studyId]` | internal | `src/app/admin/preview/[studyId]/page.tsx` |
| 9 | `/api/studies/[studyId]/report` | client + internal | `src/lib/reporting/pdf.ts` — PDF deliverable |

There is **no `/admin` index**, no per-study route, no shared layout beyond
`src/app/layout.tsx`, and **zero `loading.tsx`, `error.tsx`, `not-found.tsx` or
`global-error.tsx` files anywhere in `src/app`**. Every unhandled server error
and every `notFound()` therefore reaches the user as the framework default
screen, in English, with no way back into the product.

---

## 1. Foundation defects (affect every screen)

Cheap to fix, and currently undermining everything built on top of them.

| ID | Finding | Evidence |
|----|---------|----------|
| **F1** | **The loaded brand fonts are never applied.** `layout.tsx` loads Geist and Geist Mono and exposes them as `--font-geist-sans` / `--font-geist-mono`; `globals.css` then ends with `body { font-family: Arial, Helvetica, sans-serif; }`, which wins. The product ships in Arial while downloading two webfonts. | `src/app/globals.css:23-26`, `src/app/layout.tsx:5-13` |
| **F2** | **`<html lang="en">` on a 100 % Spanish product.** Screen readers apply English phonemes to Spanish text; `lang` is also the hook for hyphenation and locale-correct quotes. | `src/app/layout.tsx:26` |
| **F3** | **No design system exists.** `globals.css` is the unmodified Next.js starter — two colour variables and nothing else. Every colour, radius and spacing value is a literal Tailwind utility repeated per component (`zinc-200`, `zinc-500`, `violet-50`, `sky-200`, `amber-800`…), with no semantic layer and no single source of truth. | `src/app/globals.css` (26 lines total) |
| **F4** | **Tenant brand colours have no contrast guard.** `brandSchema` accepts any `#rrggbb`. The dashboard header paints `backgroundColor: brand.primaryColor` and the narrative hero paints `linear-gradient(primary, accent)` — both with hardcoded white text, and the same colours are reused in the PDF. A client who picks a light brand colour gets unreadable white-on-light. | `src/lib/branding/config.ts:3-6`, `src/app/dashboard/page.tsx:130-144`, `src/app/dashboard/NarrativeHome.tsx:15` |
| **F5** | **No motion system and no `prefers-reduced-motion` handling.** The only motion is ad-hoc `transition-colors`. Nothing today is harmful; P8 must not add motion without the query. | repo-wide: no `motion-reduce:` or `prefers-reduced-motion` occurrence |
| **F6** | **Dark mode is half-built.** `dark:` variants appear across every component, driven only by `prefers-color-scheme`, with no toggle — and the two branded surfaces (F4) ignore the mode entirely, so a client on a dark phone gets a light hero inside a near-black page. | `src/app/globals.css:17-21` plus `dark:` usage throughout |
| **F7** | **`public/` is still Next.js scaffolding** — `next.svg`, `vercel.svg`, `file.svg`, `globe.svg`, `window.svg`. No favicon, no app icon, no Be Community mark. The browser tab of a client-facing product shows the framework default. | `public/` |
| **F8** | **No skip link, no landmark navigation, no focus-visible policy.** No `<nav>` element exists in any page; header links sit in bare `<div>`s. A keyboard user on `/dashboard` tabs through the whole header before reaching content. | all page files |
| **F9** | **Flash messages are URL-carried and non-live.** `/admin/clients`, `/admin/studies` and `/admin/qualitative` render `?ok=` / `?error=` as a plain `<p>` with no `role="status"`, no dismissal, and the message survives refresh and link sharing. | `admin/clients/page.tsx:56-57`, `admin/studies/page.tsx:56-57`, `admin/qualitative/page.tsx:48-49` |

---

## 2. Inventory by actor

Each row is one meaningful state traced to the branch that produces it.
Disposition is **Keep / Reframe / Combine / Split / Retire**.

### 2.1 Logged out — 6 states

| ID | State | User job | Findings | Disposition |
|----|-------|----------|----------|-------------|
| L1 | `/login` default | Get in | Competent card, and the one screen with no jargon. But: no logo (F7); the subtitle reads "Portal de clientes" although internal staff sign in through the same door; no password recovery and no help path. | **Reframe** — this is the first brand impression and serves both audiences |
| L2 | `?error=missing_fields` | Recover | Correct `role="alert"`. Message is form-level; individual fields are not marked. | Keep, extend to field level |
| L3 | `?error=invalid_credentials` | Recover | Same. No recovery route offered. | Reframe |
| L4 | Unknown `?error=` | — | Deliberately renders **nothing** (allowlist in `login/errors.ts`). Security-correct, but a user redirected with an unknown code sees a silent, unexplained form. | Keep the mechanism, add a neutral fallback line |
| L5 | Middleware redirect from a protected path | Get back to what they wanted | `updateSession` redirects to `/login` and **discards the intended destination** — there is no `next` / `redirectTo` parameter. After signing in the user lands on `/dashboard`, not the link they followed. | **Reframe** — a consultant sending a client a link to a finding is a core use case |
| L6 | `/` → `/dashboard` → `/login` | — | Two chained redirects for a logged-out visitor hitting the root. | Combine |

### 2.2 Be Community Insights — client — 21 states

All on the single `/dashboard` route. Nothing here is linkable, bookmarkable or
shareable, because no study has a URL.

| ID | State | User job | Findings | Disposition |
|----|-------|----------|----------|-------------|
| C1 | No profile row | Understand why the page is empty | Amber panel with decent copy. | Keep |
| C2 | Zero studies | Know when something will appear | "Aparecerán aquí en cuanto Be Community los publique." Good; no expected timing, no contact. | Keep, enrich |
| C3 | Study present but no rows | — | "Este estudio todavía no tiene datos cargados." A client should arguably never see this study at all. | **Retire** from the client surface |
| C4 | Full published study | Understand the result | **The core screen.** Reading order is narrative hero → trends → *"Tus estudios"* → filters → journey → qualitative → tiles → averages → crosses → pivot. The headline indicators (`view.tiles`) appear **seventh**, below the journey and the quotes. Everything sits inside one `<section>` card constrained to `max-w-4xl`. | **Split** into a study route with a deliberate reading order |
| C5 | `narrative` section disabled | — | Hero silently absent; the page then opens on a bare `<h2>Tus estudios`. | Reframe |
| C6 | Fewer than 2 periods | — | `LongitudinalTrends` **returns `null`**. The client is never told that comparison becomes available later. | **Reframe** — absence must be explained, not silent |
| C7 | ≥2 periods, <2 comparable points | Compare | Amber notice, then the chart still renders with gaps. Correct behaviour, technical wording. | Keep, rewrite copy |
| C8 | Filters recalculating | — | `aria-live="polite"` with "Actualizando resultados agregados…". The live region is right; the phrase is engineering vocabulary. | Keep mechanism, rewrite |
| C9 | Filter selection empty | Back out | Amber panel; the clear-filters control sits at the top of the filter block, far from the message that motivates it. | Reframe |
| C10 | Caution sample (n 5–29) | Judge reliability | Renders literally `Base pequeña (n=23). Interpreta los resultados con cautela.` **`n=` is exposed to the client.** | **Reframe** — sample context is a first-class product idea, not a footnote |
| C11 | Suppressed sample (n<5) | — | "Se requieren al menos cinco unidades para mostrar resultados segmentados." A *unidad* is `respondent_id` ∪ `qual_observation.id`; no client knows what that is. | Reframe |
| C12 | Recalculation failed | Recover | Red box reading "No fue posible recalcular el estudio", with **no retry control**. Filters stay applied; the only escape is a page reload. | **Reframe** |
| C13 | Pivot rejected / failed | Recover | Renders raw validator strings from `validatePivotIntent`. No retry. | Reframe |
| C14 | Pivot computing | — | A bare `<span>Calculando…</span>` with no live region; the table keeps showing stale values at full opacity. | Reframe |
| C15 | No confirmed themes | — | `QualitativeInsights` returns `null` in the non-compact case. The client cannot distinguish "no qualitative work was done" from "nothing was found". | **Reframe** |
| C16 | Some themes suppressed | Judge completeness | A pill reading "Hay temas con muestra insuficiente" sits *inside* the theme cloud as though it were a theme. | Reframe |
| C17 | Journey stage without data | — | `kindLabel` renders the literal string `"sin datos"` under the stage, and the detail panel prints the raw `metricKey` in `font-mono`. | **Reframe** |
| C18 | Report available | Take it into a meeting | Violet "Descargar informe PDF". `reportHref` does carry the active `f.*` filters, but nothing tells the user the download is filtered. | Reframe |
| C19 | `report` section disabled | — | Button silently absent. | Keep |
| C20 | The PDF itself | Present internally | See §4. | **Reframe** |
| C21 | Several studies at once | Choose one | Every study renders a fully expanded card stacked vertically, each with its own filters, journey, pivot and PDF button. Three studies means three pivot explorers on one page. | **Split** |

### 2.3 Be Community Studio — internal — 37 states (35 rows; two rows cover a pair)

| ID | Screen · state | User job | Findings | Disposition |
|----|----------------|----------|----------|-------------|
| S1 | `/dashboard` as internal | Get to work | Internal staff land on the **client** product with a grey "Panel interno" strip bolted on top, then see every tenant's studies in one undifferentiated list. `narrative` and `trends` are force-disabled for `role === "internal"`, so the internal view of a study is *not* what the client sees. | **Split** — Studio needs its own home |
| S2 | `/admin/clients` default | Administer access | Two creation forms side by side, then organisation cards, then user rows. No search, no pagination; `listAllUsers` pages through **every** auth account on every render. | Reframe |
| S3 / S4 | `?ok=` / `?error=` | Confirm an action | See F9. | Reframe |
| S5 | Zero client users | Start | "Todavía no hay usuarios cliente." Fine. | Keep |
| S6 | Tenant brand `<details>` | Brand the client portal | Colour pickers, logo upload, tagline — with **no preview of the result and no contrast warning** (F4). | **Reframe** |
| S7 | User row `<details>` | Limit what one person sees | **`Alcance de datos` is a `<textarea>` of raw JSON**, placeholder `{"area":["Direccion"]}`. The CEO is expected to hand-author JSON to scope a director to their own area. | **Retire the JSON, keep the capability** |
| S8 | Delete client access | Remove someone safely | Type-the-exact-email confirmation. Genuinely good. | Keep |
| S9 | `/admin/studies` default | Start or configure a study | Header subtitle reads *"Inicio estilo Word · biblioteca personal"* — an internal implementation reference shipped as user-facing copy. | Reframe |
| S10 | flash | | F9. | Reframe |
| S11 | No templates yet | Start | Only the dashed "Estudio en blanco" card. | Keep |
| S12 | Template card | Reuse a setup | Preview line reads `N métricas · N dimensiones · N mapeos`. Templates are filtered `.eq("created_by", user.id)` — **an employee's template is invisible to the CEO and vice versa**, with no UI acknowledging it. | **Reframe** (see decision D5) |
| S13 | Configurator collapsed | Find a study | **One `<details>` per study, for every study in the database, unpaginated and unfiltered**, on the same page as the template gallery and the save-as-template form. | **Split** |
| S14 | Configurator expanded | Configure and publish | Status `<select>`; nine section checkboxes including *"Explorador pivote"*; journey stages edited as three raw text inputs per stage — `stage_id` (the stable identifier), the label, and `stage_metric` in a **monospace box with placeholder `metric_key`**. Help text instructs the operator that *"la métrica debe usar su clave canónica, por ejemplo `sat_servicio`"*. Nothing lists the metrics that actually exist in that study. | **Retire the free-text keys** |
| S15 | Zero studies | Start | Both study sections render as headings above empty grids — no empty state at all. | Reframe |
| S16 | `/admin/upload` wrong role | — | Returns **HTTP 200** with a rendered "Acceso denegado" page (a documented Suite B limitation, not a new finding). | Keep behaviour, reframe the page |
| S17 | Upload step 1 idle | Load data | Client · file · Analizar. Clear. The "Paso 1 / 2 / 3" ribbon is a real strength. | **Keep** |
| S18 | Analysis error | Recover | Includes the over-limit refusal added in P7 PR 7. | Keep |
| S19 | Analysis ready | Trust the mapping | Three distinct notices (saved mapping reused / template mapping / new instrument). Exposes `Mapeo guardado v3` — a version number with no meaning to the operator. | Reframe |
| S20 | Step 2 mapping table | Map the columns | A `min-w-[900px]` table. A destination `<select>` per column, then **free-text `key` / `metricKey` / `theme` inputs** the operator must invent and then keep identical across waves — the same identifiers the journey configurator later demands by hand (S14). | **Reframe — the single highest-leverage Studio fix** |
| S21 | Recoding tables | Turn labels into numbers | Right idea, raw execution: the table `id` is a free-text field (`tabla_1`) used as the foreign key from the column table's `<select>`. Renaming it silently rewires columns through `updateTable`'s previous-id fix-up. | Reframe |
| S22 | Preview error | Fix the file | `ErrorList` prints up to 100 `Fila N · columna: mensaje` items then "… y N errores más". No grouping by cause, no jump-to-column, no export. | Reframe |
| S23 | Step 3 preview ready | Decide to commit | The counts are good ("Encuestados / Respuestas numéricas / Observaciones"). Then each sample row expands to **`<pre>{JSON.stringify(...)}</pre>` on a black background** — five raw JSON dumps as the final human check before an atomic write. | **Retire the JSON, keep the check** |
| S24 / S25 | Confirm success / error | | Success appends `Mapeo v2 reutilizado · 20 encuestados.` | Reframe |
| S26 | Import history | Audit and undo | Status chips are translated in the view layer by chaining `.replace()` on the raw enum. Only the newest committed batch is revertible. | Keep, reframe |
| S27 | History empty | | "Todavía no hay importaciones." | Keep |
| S28 | Rollback confirmation | Undo safely | **`window.confirm()`** — a native browser dialog guarding the most destructive action in Studio. | **Reframe** |
| S29 | Rollback result | | Coloured banner. | Keep |
| S30 | `/admin/qualitative`, no studies | | "Crea o importa un estudio antes de revisar observaciones." | Keep |
| S31 | Study selected | Triage | Three count tiles whose labels come from `key.replace("pending","pendientes")…` chained on the raw enum. Study switching is a `<form method="get">` with an "Abrir" button rather than a selector. A hard `.limit(100)` on observations with **no indication that the list is truncated**. | **Reframe** |
| S32 | Observation table | Confirm themes | `min-w-[900px]`. Columns "Tema origen / Sugerencia / Confirmado" all render raw snake_case theme keys in `font-mono`; `confirmed_stage_key` appears as `etapa: bienvenida`; the quote cell subtitle is `fuente · review_status` (raw enum). | **Reframe** |
| S33 | Zero observations | | Renders an **empty `<tbody>`** — a table head with nothing beneath it and no message. | **Reframe** |
| S34 | flash | | F9. | Reframe |
| S35 | Bulk action bar | Retag / merge themes | A free-text `theme` input with placeholder `comunicacion`. Themes are re-typed rather than chosen, so `comunicacion`, `comunicación` and `Comunicacion` become three themes. | **Retire the free text** |
| S36 | `/admin/preview/[studyId]` | See it as the client will | Amber banner, the real client render, and a way back. **The best-conceived screen in the product** and the model for the whole P8 approach. | **Keep and extend** |
| S37 | Preview `notFound()` | | Framework default 404 (§0). | Reframe |

**Totals: 6 logged-out + 21 client + 37 internal = 64 catalogued states across 8
locations and 1 generated deliverable.**

---

## 3. Cross-cutting experience problems

1. **One route serves two products.** `/dashboard` renders Insights, and for
   `role === "internal"` renders Insights *plus* a Studio launcher, minus the
   narrative and trends. Neither audience gets a coherent home, and an internal
   user cannot see the client's real home experience anywhere except
   `/admin/preview/[studyId]`.
2. **There is no navigation model.** Every internal page hand-rolls its own
   header links: `clients → [studies, upload, dashboard]`,
   `studies → [qualitative, upload, dashboard]`,
   `qualitative → [studies, dashboard]`, `upload → [dashboard]`.
   **From `/admin/upload` there is no link to clients, qualitative or studies at
   all.** There is no current-location indicator, no breadcrumb, and no `/admin`
   index page.
3. **Nothing is addressable.** No study has a URL. A consultant cannot send a
   client a link to a finding; a client cannot bookmark last year's study.
   Filter state is component state and dies on reload.
4. **Everything is disclosed at once.** `/admin/studies` is simultaneously the
   template gallery, the blank-study creator, the save-as-template form, the
   study list *and* the full configurator for every study. `/dashboard` is
   simultaneously every study's complete dashboard.
5. **The consultant's actual product is missing.** The recorded sessions are
   explicit that the deliverable is *"un documento que se arma"* carrying the
   consultant's recommendations, and that the platform should *"mostrarte toda
   la evidencia y los puntos de dolor"* while the recommendation stays a human
   judgement. **There is nowhere in the product to write, hold, review or
   publish an interpretation.** The PDF is a numbers dump with no narrative.
6. **The lifecycle is shorter than the real process.** `study.status` is
   `draft | published | archived`. The CEO named six stages: *borrador → datos
   cargados → en análisis → revisión interna → publicado → archivado*. Studio
   cannot currently say "this is being analysed" or "this is waiting for
   review", which is exactly the state an approval workflow needs.
7. **No threshold or alert concept exists.** The consultant's method colours
   touchpoints and drives the decision to go deeper qualitatively; today that is
   done by hand in Excel and nothing in the product represents it. The CEO also
   expressed a clear preference for **an alert when a result sits outside the
   ideal**, rather than a decorative traffic light on everything.
8. **The journey is not the journey.** The current `JourneyMap` is a numbered
   stepper showing one number per stage. The method it must serve is a full
   route map where **every touchpoint shows its score** and **only the deepened
   ones carry pain-point labels**, deliberately few — two or three.

---

## 4. The PDF deliverable

`src/lib/reporting/pdf.ts` (635 lines) is a server-rendered, authenticated,
tenant-scoped, filter-aware report. Architecturally correct and worth keeping.

| Finding | Evidence |
|---------|----------|
| **The copy is written without accents** — `"No hay respuestas para esta seleccion."`, `"Metodologia y lectura"`, `"modelo canonico"`, `"base pequena"`. This is an authoring choice, **not an encoding limit**: `safeText` preserves the Latin-1 range and Helvetica/WinAnsi renders `á é í ó ú ñ` correctly. A client-facing Spanish document currently reads as machine-generated. | `pdf.ts:106-115`, `pdf.ts:489-626` |
| It reproduces the dashboard's jargon verbatim: `"Unidades de respuesta"`, `"Base cuantitativa y cualitativa distinta"`, `"Base distinta n=12"`. | `pdf.ts:496`, `pdf.ts:608` |
| Metric detail strings are raw: `"Top-box >=4 - 12/20"` and `"12 prom - 3 detr - n=20"`. | `src/lib/dashboard/view.ts:168`, `:178` |
| **There is no interpretation section** — no findings, no recommendations, no "what to do next" (see §3.5). | whole file |
| The single client download is a *report*, but the recorded sessions named two different artefacts: **charts as images** for the client's own business decks, and a **PDF of the recommendations**. Neither exists in that form today. | process sessions |

---

## 5. Terminology and implementation-concept debt

Every row below is a string a non-technical person can currently see.
**Reveal at** names where the more precise wording is allowed to appear.

### 5.1 Terms that must disappear behind interaction, not simply be renamed

| Current | Where | Why renaming is not enough | P8 treatment |
|---------|-------|---------------------------|--------------|
| `data_scope` JSON textarea (`{"area":["Direccion"]}`) | S7 and the invite form | The concept is real and must survive; **authoring it as JSON is the defect**. | Pick the characteristic values this person may see, from the values that exist in that client's own data. Chips, not text. JSON stays as storage behind the boundary. |
| `stage_metric` / `metric_key` free text (`sat_servicio`) | S14 | The operator is being asked to remember an identifier the system already knows. | A picker of the metrics present in that study, showing the human label and a live sample value. |
| Mapping `key` / `metricKey` / `theme` free text | S20 | The same identifier is invented three separate times, and consistency across waves is precisely what makes longitudinal comparison possible. | Suggest from previous waves and the client's existing vocabulary; free text becomes an explicit "create new…", never the default. |
| Retag `theme` free text | S35 | Free text is how `comunicacion` / `comunicación` / `Comunicacion` become three themes. | Choose from the study's confirmed themes; "create a new theme" is a deliberate secondary action. |
| Recoding-table `id` (`tabla_1`) | S21 | An identifier used as a foreign key but edited as if it were a label. | Name it; the id is generated and never shown. |
| Raw JSON row preview (`<pre>`) | S23 | The check is right; the representation is wrong. | A readable per-row card: segments as chips, metrics as label → value, texts quoted. |
| `Explorador pivote` / *pivot* | S14, C4 | "Pivot" is spreadsheet vocabulary, and the CEO explicitly wants clients building their own crosses — so it must be inviting, not technical. | Keep the capability; name it for what it does — comparing one result across a characteristic. |
| Stable identifier (`stage_id`) | S14 | Users should never author a primary key. | Generate it from the label; surface it only under an advanced disclosure. |

### 5.2 Vocabulary table

| Concept (current technical term) | Internal / Studio wording | Client / Insights wording | Methodological wording | Reveal at |
|---|---|---|---|---|
| `NPS` | NPS (recomendación) | **Recomendación** | *Net Promoter Score · escala 1–10 · promotores − detractores* | "Cómo se calcula" panel on the indicator |
| `CSAT`, `Top-2-Box`, `Top-box >=4` | CSAT por punto de contacto | **Satisfacción** | *Top-2-Box sobre escala 1–5, excluye "no lo conozco"* | Same panel |
| `promoters` / `detractors` / `prom` / `detr` | Promotores / Detractores | *(hidden by default)* | Breakdown inside the indicator detail | On expand |
| `n=23`, bare `n` | Base: 23 respuestas | **"23 personas respondieron"** | *n = 23* | Methodology panel and PDF annex |
| `unidades de respuesta` | Respuestas incluidas | **"personas y comentarios incluidos"** | *unidad = encuestado o comentario distinto* | Methodology panel |
| `Muestra insuficiente` | Base insuficiente para publicar | **"Muy pocas respuestas para mostrar esto sin identificar a nadie"** | *menos de 5 unidades — regla de divulgación* | Inline, always. This one must be explained, never abbreviated |
| `caution` visibility | Base pequeña | **"Pocas respuestas — tómalo como indicio, no como conclusión"** | *5 ≤ n < 30* | Inline |
| `respondent` / `Encuestados` | Participantes | **Personas que respondieron** | *respondent* | — |
| `metric` / canonical metric key | Indicador | **Resultado** | *clave canónica* | Advanced disclosure |
| `aggregation` / `agg` / `Agregación` | Cómo resumir | **Promedio · Cuántos · Total · Mínimo · Máximo** (no collective noun in the UI) | *función de agregación* | — |
| `pivot` / `Explorador de cruces` | Comparador | **"Compara un resultado por característica"** | *tabla dinámica* | — |
| `dimension` / `segmento` | Característica | **Característica** (edad, área, antigüedad…) | *dimensión de segmentación* | — |
| `cross` / `Cruce por X` | Comparación por X | **"Cómo cambia según X"** | *cruce* | — |
| `filters` | Filtros | **"Ver sólo…"** | — | — |
| `draft` / `published` / `archived` (raw enum chips) | Borrador · En análisis · En revisión · Publicado · Archivado | **Publicado** is the only one a client ever perceives | `study.status` | Never client-side |
| `staged` / `committed` / `failed` / `rolled_back` | Preparado · Confirmado · Fallido · Revertido | *(never client-side)* | batch status | — |
| `review_status` `pending` / `confirmed` / `rejected` | Pendiente · Confirmado · Descartado | — | — | — |
| `theme` snake_case (`atencion_y_servicio`) | Tema: *Atención y servicio* | **Atención y servicio** | stored key | Never shown |
| `menc.` (`{count} menc.`) | 12 comentarios | **"12 comentarios lo mencionan"** | — | — |
| `mapping` / `Mapeo guardado v3` | "Ya sabemos leer este formato (igual que en *Ola 2 · 2025*)" | — | mapping version | Advanced |
| `import batch` / `lote` | Carga | — | batch | — |
| `journey` / `Journey map` | Mapa de experiencia | **Mapa de experiencia** | *journey map · touchpoints* | — |
| `stage` / `Etapa` | Punto de contacto | **Momento** / Punto de contacto | *touchpoint* | — |
| `tenant` / `Cliente` (organisation) | Cliente | *(their own name)* | tenant | Never |
| `data_scope` | Qué puede ver esta persona | — | — | — |
| `emptyStudy` / `emptySelection` | — | Explained empty states, never silence | — | — |
| `Panorama actual` / `Qué cambió` / `Qué está apareciendo` | — | **Keep.** Already the right register, and the seed of the P8 client narrative. | — | — |

### 5.3 Terminology the process material settles

Sourced from the recorded consultant sessions in
`documentos de procesos de be community` (read-only; no client data reproduced
here).

- The consultant already presents NPS to clients as **"el indicador de
  recomendación"**, and states that it translates as *recomendación* or
  *lealtad*. Insights should lead with that word, not the acronym.
- Overall satisfaction is presented to clients as a **percentage of general
  satisfaction**, not as "CSAT".
- The **individual respondent is internal-only**; a client must never reach one
  person's answers. This is currently true by construction — the client receives
  only aggregate DTOs — and must stay true.
- Clients **should** be able to build their own crosses; interactivity is
  described as the hook that keeps them engaged. The safeguard is the
  consultant's document, not a locked-down dashboard.
- Client downloads: **charts as images** and a **PDF of the recommendations**.
  Not Excel, and not the response base.
- Qualitative results must **not** be converted into a KPI or a percentage.
- Pain-point labels per touchpoint must be **few — two or three** — because more
  labels dilute the solution the client acts on.

---

## 6. Accessibility and responsive risks visible from source

Not measured against a browser. Each is a source-level risk to verify in P8.5.

| Risk | Location |
|------|----------|
| `lang="en"` on Spanish content | F2 |
| No skip link; no `<nav>` landmarks; header links in `<div>`s | F8 |
| Brand colours with hardcoded white text and no contrast floor | F4 |
| Two tables forced to `min-w-[900px]` inside `overflow-x-auto` — readable on a phone only by horizontal scrolling | `UploadForm.tsx:318`, `qualitative/page.tsx:56` |
| Journey stages are `<button aria-pressed>` in a scroll strip, instructed with **"Pasa el cursor"** (hover) — meaningless on touch, although `onClick` / `onFocus` are correctly wired | `JourneyMap.tsx:14-19` |
| Theme pills scale their **font size by mention count** (`0.75 + 0.35 × count/max` rem) — quantity encoded as type size, bottoming out at 12 px | `QualitativeInsights.tsx:22` |
| Theme counts also carried only in a `title` attribute (`"12 observaciones · n=8"`) — unavailable on touch and unreliable for screen readers | `QualitativeInsights.tsx:22` |
| The trend chart is one `<svg role="img">` with a single summary label: no data-table alternative, no per-point keyboard access, `min-w-[620px]` | `LongitudinalTrends.tsx:36` |
| Trend series distinguished by colour `#0284c7` alone | `LongitudinalTrends.tsx:44-51` |
| Pivot bar labels are `w-24 truncate` — long segment names become unreadable | `PivotExplorer.tsx:56` |
| `window.confirm()` for import rollback | `UploadForm.tsx:209` |
| Colour-only status chips (`emerald` / `amber` / `red`) with no icon or text redundancy | `StudyConfigurator.tsx:39`, upload history |
| Pivot "Calculando…" has no live region; the stale table stays fully opaque | `PivotExplorer.tsx:47` |
| No `error.tsx` / `not-found.tsx` — framework defaults, in English | §0 |

---

## 7. What to keep

P8 is a transformation, not a rewrite. These are load-bearing and correct:

- **The security and calculation architecture** — forced RLS, server-side
  authorization, the aggregate-DTO client boundary, the canonical rounding
  policy, the pivot allowlist and the sample-disclosure ladder. P8 changes none
  of it.
- **`/admin/preview/[studyId]`** — internal preview of the real client render.
  The right idea, already built. Extend it; do not replace it.
- **The three-step upload ribbon** (Paso 1 · 2 · 3) — the only genuine wizard in
  the product, and the pattern the rest of Studio should adopt.
- **The narrative home's questions** — *Panorama actual · Qué cambió · Qué está
  apareciendo*. Correct register and correct instinct; incomplete, because it
  never answers *por qué importa* or *qué sigue*.
- **The disclosure ladder itself** (`no-data / suppressed / caution / standard`)
  — a genuine differentiator against Excel. It needs plain language, not a
  different rule.
- **Type-the-exact-email deletion confirmation** on `/admin/clients`.
- **Mapping reuse and versioning**, atomic import, and single-batch rollback.
