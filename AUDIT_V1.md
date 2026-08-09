# AUDIT_V1.md — Be Community, V1 State-of-Reality Report

> **Scope:** Read-only audit of the deployed V1 codebase. Every claim cites the
> file and line where it was observed. Assumptions from `CLAUDE.md` /
> `system_context.md` / the V2 architecture doc were treated as **hypotheses to
> verify**, not facts. Anything not confirmable from code is marked
> **UNVERIFIED**.
>
> **Date:** 2026-07-07 · **Branch:** `main` · **Method:** static read of all
> tracked source, SQL, config, and scripts.

---

## 0. Executive summary

V1 is a **small, clean, coherent** Next.js 16 + Supabase application. The
security foundation the documents claim is, for the most part, **real and
present in code**: RLS is enabled *and forced* on every table, every policy is
created in the same migration as its table, server-side authorization is
re-checked on every protected route and the one mutating action, the
service_role key is `server-only`, and secrets have never been committed.

The audit found **one genuine security red flag** (clients hold DB-level write
access inside their own tenant — least-privilege gap), **three known-pending P0
gaps** (no security headers, no rate limiting, partial Zod coverage), and a
handful of **doc-vs-code discrepancies** (notably: the "SECURITY DEFINER helper
functions in a `private` schema" described in `system_context.md` **do not
exist** — policies inline the subquery instead). None of the [VERIFICAR] tech-stack
assumptions was wrong; all are now pinned to exact versions below.

Full detail follows. The corrected `CLAUDE.md` is proposed separately in
[`CLAUDE.proposed.md`](CLAUDE.proposed.md) (not applied — awaiting approval).

---

## 1. Actual tech stack

Source: [`package.json`](package.json), [`tsconfig.json`](tsconfig.json),
[`wrangler.toml`](wrangler.toml), [`open-next.config.ts`](open-next.config.ts).

| Thing | CLAUDE.md said | **Actual (verified)** | Evidence |
|---|---|---|---|
| Framework | Next.js App Router, [VERIFICAR version] | **Next.js `16.2.9`** | `package.json:19` |
| React | [VERIFICAR] | **`19.2.4`** (+ react-dom `19.2.4`) | `package.json:21-22` |
| TypeScript | strict, [VERIFICAR] | **`^5`, `strict: true`** | `package.json:37`, `tsconfig.json:7` |
| Styling | TailwindCSS [VERIFICAR] | **Tailwind v4** (`@tailwindcss/postcss ^4`, `tailwindcss ^4`) | `package.json:28,35` |
| Deploy adapter | OpenNext, Node compat [VERIFICAR] | **`@opennextjs/cloudflare 1.20.1`**, Worker on Node runtime, `nodejs_compat` | `package.json:27`, `wrangler.toml:7-11`, `open-next.config.ts:1-9` |
| Data engine | Arquero [VERIFICAR in use] | **`arquero 8.0.3` — installed AND used** | `package.json:17`, `engine.ts:1`, `pivot.ts:1` |
| Validation | Zod [VERIFICAR in use] | **`zod 4.4.3` — installed, used only in ingestion** | `package.json:24`, `canonical.ts:1,65-77` |
| CSV | PapaParse [VERIFICAR] | **`papaparse 5.5.4` — used** | `package.json:20`, `parse.ts:1,16` |
| XLSX | ExcelJS [VERIFICAR] | **`exceljs 4.4.0` — used** | `package.json:18`, `parse.ts:2,38` |
| Supabase | Cloud | `@supabase/ssr 0.12.0`, `@supabase/supabase-js 2.108.2` | `package.json:15-16` |

**Version-pinning:** runtime deps are **exact-pinned** (good — matches the "pin
versions" rule). Some devDeps and Tailwind use `^` ranges (`package.json:28-37`).

**Deployment reality — confirmed, matches docs.** The OpenNext-over-Cloudflare +
Node-compat choice is real and the *why* is documented consistently:
- Worker entry `main = ".open-next/worker.js"`, `compatibility_flags = ["nodejs_compat"]` (`wrangler.toml:7,11`).
- Middleware is deliberately the **Edge `middleware.ts` convention**, not Node
  `proxy.ts`, because OpenNext rejects Node middleware
  (`src/middleware.ts:4-10`, `docs/DEPLOYMENT.md:23-28`).
- The Node runtime (not Edge) is what lets **exceljs** parse `.xlsx` in prod
  (`open-next.config.ts:3-6`, `docs/DEPLOYMENT.md:8-13,27-28`).

**Discrepancies with [VERIFICAR] zones:** none were *wrong*. All are now
confirmed and pinned. The single nuance is **Zod is not yet at "every input
boundary"** (see §3.4).

**Scripts present** (`package.json:5-12`): `dev`, `build`, `start`, `lint`,
`cf:build`, `cf:preview`, `cf:deploy`. **No `typecheck` and no `test` script**
(see §4.3).

---

## 2. Actual data model & ingestion

### 2.1 Schema — matches `system_context.md §3`, with corrections

Source of truth: [`supabase/migrations/0000_init_schema_and_rls.sql`](supabase/migrations/0000_init_schema_and_rls.sql).

Eight tables in `public`:

| Table | Role | Isolation column | Line |
|---|---|---|---|
| `profiles` | user → tenant + role link (`role in ('client','internal')`) | `tenant_id` (null for internal) | `0000:36-42` |
| `tenant` | the school; unit of isolation | `id` **is** the tenant key | `0000:47-51` |
| `study` | a study; holds `dashboard_config` + `journey_definition` jsonb | `tenant_id` | `0000:68-77` |
| `respondent` | response unit; `segments` jsonb | `tenant_id` (denormalized) | `0000:83-89` |
| `quant_response` | numeric metric value (`metric_key`, `value`) | `tenant_id` | `0000:94-102` |
| `qual_observation` | coded qualitative text | `tenant_id` | `0000:107-117` |
| `segment_dimension` | nestable segmentation def (`parent_id`) | `tenant_id` | `0000:123-132` |
| `journey_definition` | stage rows (also mirrored in `study.journey_definition` jsonb) | `tenant_id` | `0000:137-147` |

- **`tenant_id` is denormalized + indexed on every data table** exactly as the
  docs claim (`0000:153-165`). Confirmed.
- **Naming nuance vs. docs:** `system_context.md §3` says "`Tenant → Profiles →
  Studies → Responses`". In code "Responses" is split into **`respondent` +
  `quant_response` + `qual_observation`**. Cosmetic, not a contradiction.
- **DISCREPANCY (important):** `system_context.md §3` claims *"SECURITY DEFINER
  helper functions in a `private` schema (search_path='', wrapped in `(select …)`
  for per-query caching)."* **These functions do not exist.** The migrations
  create **no `private` schema and no helper functions.** Each policy inlines the
  subquery `tenant_id = (select tenant_id from public.profiles where user_id =
  (select auth.uid()))` directly (e.g. `0000:206-208`). The `(select auth.uid())`
  caching wrapper *is* present; the `private`-schema function indirection is not.
  The inline form works, but the documented pattern is absent — the doc should be
  corrected or the refactor scheduled.

### 2.2 Ingestion — column-prefix pattern CONFIRMED

The `seg_ / q_ / qual_` convention is **real** and lives in one adapter:
[`src/lib/ingestion/adapters/wide-survey.ts`](src/lib/ingestion/adapters/wide-survey.ts).

```
seg_<key>    -> respondent.segments[key]              wide-survey.ts:25,36,67-70
q_<metric>   -> quant_response { metric_key, value }  wide-survey.ts:26,37,72-85
qual_<theme> -> qual_observation { theme, quote, ...} wide-survey.ts:27,38,88-93
source       -> per-row qualitative source override   wide-survey.ts:28,87
```

The mapping pipeline is a clean adapter pattern (`§2` of the docs, realized):

1. **Parse** (format-agnostic) → `{ headers, rows }` — CSV via PapaParse, XLSX via
   ExcelJS (`parse.ts:15-64`). Rejects unknown extensions (`parse.ts:66-75`).
2. **Adapt + validate** → canonical `CanonicalRespondent[]`, collecting *all*
   row errors (never fail-fast) and re-checking every built record with Zod
   before returning (`wide-survey.ts:32-133`, Zod guard at `:105-126`).
3. **Persist** → chunked inserts into `respondent` → `quant_response` →
   `qual_observation`, all stamped with `tenant_id`+`study_id`
   (`persist.ts:30-68`). Respondent UUIDs are generated up-front
   (`wide-survey.ts:100`) so children reference them without a round-trip.

**Zero-partial-write is respected:** validation fully precedes any DB write; the
action returns errors and writes nothing on failure (`admin/upload/actions.ts:94-105`).

### 2.3 Metric calculation — on-the-fly via Arquero, CONFIRMED

- Canonical composite metrics are defined **once** in
  [`src/lib/calc/metrics.ts`](src/lib/calc/metrics.ts): `npsFromScores`
  (`:60-68`), `csatTopBox` (`:77-82`), `mean`/`percentage` (`:36-46`). NPS bands
  (≥9 / 7–8 / ≤6) and Top-N-Box threshold are explicit.
- Relational aggregation is **Arquero, declarative, params-bound** (no
  hand-rolled loops) in [`engine.ts`](src/lib/calc/engine.ts): `metricAverages`
  (`:63-73`), `crossAverage` (`:79-91`), `computeStudyMetrics` (`:120-147`).
- These are computed **live on each dashboard render** from RLS-scoped rows:
  `dashboard/page.tsx:78-90` calls `loadStudyRows` → `computeStudyMetrics`. No
  pre-aggregation, matching the "compute fresh, on demand" stance.
- The dynamic pivot ([`pivot.ts`](src/lib/calc/pivot.ts)) enforces an
  **allowlist derived from the user's own data** before any compute
  (`:35-71`) and **re-validates + throws** inside `computePivot` (`:115-117`) —
  so the engine structurally cannot run an out-of-scope intent. Good.
- A **known-good calculation gate exists** and hand-computes expected values
  (`scripts/calculation-test.mjs:45-100`).

---

## 3. Actual security posture

Mapped against `system_context.md §5` (the "honest" five-layer posture).

### 3.1 RLS — enabled AND forced on every table ✅

- Every table runs both `enable row level security` **and** `force row level
  security` (owner included): profiles `0000:180-182`, tenant `:191-192`, study
  `:201-202`, respondent `:231-232`, quant_response `:261-262`, qual_observation
  `:291-292`, segment_dimension `:321-322`, journey_definition `:351-352`.
- Every data table's tenant-isolation policy is created **in the same
  migration** as the table — no unprotected window (the stated golden rule,
  `0000:5-11`).
- UPDATE policies carry **both `USING` and `WITH CHECK`** (e.g. `0000:216-222`),
  preventing a row from being moved to another tenant.
- A **coverage gate** exists (`supabase/tests/rls_coverage.sql`) and a
  **behavioral adversarial test** exists (`scripts/isolation-test.mjs`: anon
  read, cross-tenant read, cross-tenant write — `:62-99`).

> **Runtime caveat (UNVERIFIED):** I cannot prove RLS is active *in the live
> database* from static files — only that the migrations declare it. Per the
> docs' own rule (`system_context.md §3`, "SQL editor bypasses RLS"), the valid
> proof is running `scripts/isolation-test.mjs` against the deployed project. I
> did not run it (no live credentials; read-only phase). **Recommend running it
> as the first P0 action.**

### 3.2 Authorization — server-side, re-checked ✅ (with one gap → §3.5)

- **Session revalidation uses `getUser()`, never `getSession()`**, in all three
  places that matter: middleware (`src/lib/supabase/middleware.ts:36-38`),
  dashboard page (`dashboard/page.tsx:35-37`), upload page
  (`admin/upload/page.tsx:12-14`). This is the correct, non-spoofable check.
- **Middleware is explicitly "one layer, not the control"** and every protected
  Server Component re-checks independently (`middleware.ts:4-8` comment realized
  in `dashboard/page.tsx:32-41`).
- **The one mutating action re-authorizes server-side AND checks role** before
  doing anything: `ingestStudyFile` verifies `user` then `profile.role ===
  'internal'` and rejects otherwise (`admin/upload/actions.ts:35-53`), then
  validates, then writes via service_role. UI hiding is *not* relied upon
  (`admin/upload/page.tsx:23-37` also gates the page).
- Login returns a **generic error** (no user-enumeration leak)
  (`login/actions.ts:22-25`).

### 3.3 Secrets — clean ✅

- **`.env*` is gitignored** (`.gitignore:27`) and **never committed** — verified
  against git history (`git log --all -- .env.local .env` → empty; `git ls-files`
  lists no env file).
- **service_role key is `server-only`**: `src/lib/supabase/admin.ts:1` imports
  `"server-only"` (build-time throw if bundled to client); the key is read from
  `SUPABASE_SERVICE_ROLE_KEY` (`:14`), **never** `NEXT_PUBLIC_*`. Grep for
  `NEXT_PUBLIC_..._SERVICE`/`SERVICE_ROLE` in `src/` found only the admin client
  and comments — no leak.
- Browser client uses **only the anon key** (`client.ts:10-14`); the health
  route uses only the anon key (`api/health/route.ts:8,13`).
- A **secret-leak release gate** exists (`scripts/secret-leak-test.mjs`,
  referenced by `docs/DEPLOYMENT.md:74,79`).
- `.env.example` ships with **empty values** and correct warnings
  (`.env.example:1-9`).

### 3.4 Input validation, headers, rate limiting — partial ⚠️

- **Zod:** used at the **ingestion boundary** (`canonical.ts:65-77`, applied in
  `wide-survey.ts:105-126`) — the highest-value boundary. **Not** used on the
  login or upload **form fields**, which use manual `String(...).trim()` coercion
  (`login/actions.ts:12-17`, `admin/upload/actions.ts:56-72`). `tenant_id` is not
  UUID-validated by Zod but *is* existence-checked against the DB before use
  (`admin/upload/actions.ts:78-84`), and all DB access is parameterized (no
  injection). Still, this is **short of the CLAUDE.md rule "validate every input
  boundary with Zod."**
- **Security headers: NONE.** `next.config.ts` is empty (`:3-5`) — no
  `headers()`, no CSP, HSTS, X-Frame-Options, X-Content-Type-Options, or
  Referrer-Policy anywhere in the repo (grep clean). This is **P0 scope**, so
  "absent" is expected, but the production app currently ships without them.
- **Rate limiting: NONE** at the app/edge layer — no throttle on `login`,
  `ingestStudyFile`, or `/api/health` (grep clean). Supabase Auth applies its own
  server-side limits, but there is no first-party limit. **P0 scope.**
- **Stored-XSS surface is currently minimal:** there is **no
  `dangerouslySetInnerHTML`** anywhere (grep clean); all rendering is JSX
  auto-escaped text. Note that `qual_observation.quote` (free text) is **not yet
  rendered** in any client view — when qualitative display lands in V2, sanitize
  at render (the CLAUDE.md rule).

### 3.5 🚩 RED FLAG — clients can write inside their own tenant (least-privilege)

The write policies on all six data tables check **only `tenant_id`, never
`role`** (e.g. study insert/update/delete `0000:210-228`; identical shape on
respondent, quant_response, qual_observation, segment_dimension,
journey_definition). Combined with the blanket grant:

```
grant select, insert, update, delete on all tables in schema public
  to authenticated;                                   -- 0000:393, 0001:23
```

…any authenticated user — **including a `role='client'` school user** — can
`INSERT/UPDATE/DELETE` their **own tenant's** studies, respondents, responses,
segments and journey rows **directly via the Supabase REST API**, bypassing the
UI. This contradicts the product definition of clients as **"read-only
dashboards"** (`system_context.md §3`, line 30) and the "least privilege" intent.

- **Blast radius is contained** to the attacker's own tenant (cross-tenant
  isolation still holds — `WITH CHECK` blocks writes to other tenants). So this
  is **integrity within one tenant**, not a cross-tenant leak.
- **No legitimate app path uses these client writes.** The dashboard is
  read-only; the only writer is `ingestStudyFile`, which runs as `internal` +
  service_role (`admin/upload/actions.ts:48,74,131`). So the client write
  surface is **entirely unused attack surface** — a curious or compromised client
  account could silently corrupt or delete the very deliverable they were sent.
- **Fix (P0, low-effort):** reduce `authenticated` to `SELECT` on the data
  tables and drop the client-facing `insert/update/delete` policies (internal
  writes already go through service_role, which bypasses RLS). This collapses the
  client write surface to zero without touching any real feature.

### 3.6 Layer-by-layer vs. `system_context.md §5`

| Layer | Claimed | Observed |
|---|---|---|
| Cloudflare edge | perimeter | Worker deploy configured; **no WAF/rate-limit/headers yet** (P0) |
| Next.js app | server authz | ✅ present and correct (§3.2), minus the §3.5 write gap |
| Postgres / RLS | forced everywhere | ✅ declared (§3.1); runtime proof pending (run isolation test) |
| Supabase Auth | `getUser()` verification | ✅ (§3.2); Pro-tier controls (leaked-pw, backups) are go-live items (`DEPLOYMENT.md:83`) |
| Detection / response | audit logs, alerts, backups, playbook | **UNVERIFIED / largely absent** — only Uptime Robot on `/api/health` (`api/health/route.ts`, `OPERATIONS.md`); no audit-log table, no incident playbook in repo (both are P7) |

---

## 4. Code structure & health

### 4.1 Structure — clean, small, idiomatic ✅

```
src/
  middleware.ts                 edge session gate
  app/
    layout.tsx  page.tsx        (page → redirect /dashboard)
    login/      (page + action)
    dashboard/  (page + StudyCard/JourneyMap/PivotExplorer + logout action)
    admin/upload/ (page + UploadForm + ingest action)
    api/health/ (anti-pause endpoint)
  lib/
    supabase/  admin | client | server | middleware   (4 clients, clear roles)
    calc/      metrics | engine | load | pivot | journey
    ingestion/ canonical | parse | persist | adapters/wide-survey
supabase/ migrations/{0000,0001} + tests/rls_coverage.sql
scripts/  8 standalone gates (isolation, calculation, pivot, secret-leak, seeds…)
docs/     DEPLOYMENT, OPERATIONS, FASE_0..6, samples/
```

Separation of concerns is genuinely good: parsing knows nothing of the schema,
the adapter owns mapping, metrics are defined once, the four Supabase clients
have distinct, documented purposes.

### 4.2 Technical debt / dead code / stale docs

- **`README.md` is default `create-next-app` boilerplate** — talks about
  `app/page.tsx`, `next/font`, and **deploying on Vercel** (`README.md:32-36`),
  which directly contradicts the Cloudflare/OpenNext reality. **Stale; replace.**
- **No `TODO`/`FIXME`/`HACK`/dead code** found (grep clean).
- **`journey_definition` is stored twice** — as a `study.journey_definition`
  jsonb column (`0000:75`, read by the dashboard `page.tsx:62,86`) *and* as a
  standalone `journey_definition` table (`0000:137-147`). Only the jsonb form is
  read in V1; the table appears **unused by app code** (no query references it).
  Not a bug, but a modeling redundancy to resolve in V2.
- **Pinning:** Tailwind + several `@types`/eslint use `^` ranges
  (`package.json:28-37`) vs. the exact-pin rule.

### 4.3 Testing state

- **No test runner** (no vitest/jest in `package.json`; no `test` script; no CI
  config in repo). **No `typecheck` script** (though `tsc`/`strict` is available).
- Instead, **8 standalone gate scripts** in `scripts/` run manually:
  - `calculation-test.mjs` — **known-good** hand-computed metric gate (run
    `npx tsx scripts/calculation-test.mjs`); genuinely validates NPS/CSAT/mean/
    cross (`:53-100`).
  - `isolation-test.mjs` — **adversarial behavioral** RLS test (anon +
    cross-tenant read/write), run `node --env-file=.env.local …` (`:1-118`).
  - `secret-leak-test.mjs`, `pivot-test.mjs`, `fase4-realdata-check.mjs`,
    `fase5-journey-check.mjs`, plus seed/cleanup helpers.
- These are **good and purpose-built** but **not automated, not wired to a gate**,
  and require manual env + live Supabase. **UNVERIFIED whether they currently
  pass** (not run in this read-only phase).
- **Minor:** `calculation-test.mjs` is `.mjs` yet imports `.ts` (`:11-12`), so it
  only runs under `tsx`, not plain `node` — worth normalizing.

### 4.4 AI artifacts / prompt files in the repo

The CLAUDE.md rule "production repo stays clean: no CLAUDE.md-style files, AI
comments, or prompt files" is **not yet met on `main`**:

- **Tracked meta files:** `CLAUDE.md`, `AGENTS.md` (Next-16 AI rules, `:1-5`),
  `system_context.md`, and the whole `docs/FASE_*.md` set are all committed
  (`git ls-files`).
- **Pervasive `§`/`Section` architecture-doc citations in source comments**
  (e.g. `admin/upload/actions.ts:22-30`, nearly every `lib/` file). These are the
  "AI comments" the rule targets for production branches.

This may be intentional for the **working/dev** `main` branch; flagged so the
**production** branch strips them per the rule before any client-facing deploy.

---

## 5. Red flags (address before building new features)

Ordered by priority.

1. **🚩 Clients have unused DB write access inside their tenant** (§3.5). Medium-High.
   Least-privilege violation; contradicts "read-only" clients. Contained to one
   tenant but exposes deliverable integrity. **Low-effort P0 fix:** `SELECT`-only
   grant on data tables + drop client write policies.
2. **Runtime RLS is unproven** (§3.1). Migrations *declare* forced RLS, but the
   only valid proof is behavioral. **Run `scripts/isolation-test.mjs` against the
   live project as the first P0 step** before touching anything.
3. **No security headers** (§3.4) — no CSP / HSTS / anti-clickjacking in a
   production app. P0 scope, but currently live without them.
4. **No app-layer rate limiting** (§3.4) — login/upload/health unthrottled at the
   app/edge. P0 scope.
5. **Zod not at every input boundary** (§3.4) — forms use manual validation;
   contradicts the stated rule. Low risk (parameterized DB, existence checks),
   but tighten in P0.
6. **Doc-vs-code drift** (§2.1) — the `private`-schema SECURITY DEFINER helper
   functions described in `system_context.md §3` **do not exist**; policies inline
   the subquery. Correct the doc (or schedule the refactor).
7. **Stale `README.md`** (§4.2) — says "deploy on Vercel"; the app is
   Cloudflare/OpenNext. Replace to avoid misleading a future operator.

**None of these is a cross-tenant data leak.** Isolation — the sacred property —
holds in the code as written (pending the runtime proof in item 2).

---

## 6. What the documents got RIGHT (for balance)

- Exact stack, adapter, and the exceljs/Edge-middleware rationale — all accurate.
- RLS enabled **and forced** on every table, policy-per-table, `USING`+`WITH
  CHECK` on updates — accurate.
- `getUser()`-not-`getSession()` discipline — accurate and consistently applied.
- service_role `server-only`, anon-only client, secrets never committed —
  accurate.
- `seg_/q_/qual_` prefix ingestion, adapter pattern, zero-partial-write —
  accurate.
- On-the-fly Arquero calculation with once-defined canonical metrics —
  accurate.
- Configuration-over-code journey map (rendered from jsonb) — accurate
  (`journey.ts`, `JourneyMap.tsx`).

The project's core discipline — *verification over assumption* — is visibly
embodied in the code and its gate scripts. The gaps above are of the "least
privilege / P0-not-yet-done / doc drift" kind, not "the foundation is fake."

---

*End of audit. Read-only: no source was modified. Proposed corrected rulebook in
[`CLAUDE.proposed.md`](CLAUDE.proposed.md).*
