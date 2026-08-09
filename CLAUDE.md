# CLAUDE.md — Be Community Platform

> Operational rules for Claude Code on this repository. Read this every session.
> Every fact below was verified against the code by the V1 audit
> (`AUDIT_V1.md`, 2026-07-07). Rules marked ⓘ are audit-derived guardrails —
> they are standing rules, not suggestions.

---

## What this project is

Be Community is a **multi-tenant B2B Business Intelligence & Data Storytelling
platform** for an education-sector consulting firm. It ingests raw survey /
focus-group / observation data and turns it into interactive dashboards and
data-connected journey maps for the firm's clients (schools).

**It is NOT a CRM.** No sales pipelines. The product is data → insight → client-facing story.

- **V1** (the engine) is deployed in production. We are building **V2** (the full suite) on this same repository.
- Full V2 architecture lives in `BeCommunity_V2_Technical_Architecture.docx` (reference only — consult, don't inline).
- Project background and decisions live in `system_context.md`.

## Tech stack  *(verified against package.json + config, 2026-07-07)*

- Framework: **Next.js 16.2.9** (App Router) + **React 19.2.4** + **TypeScript ^5, `strict: true`**.
- Styling: **TailwindCSS v4** (`@tailwindcss/postcss`).
- Backend/DB: **Supabase Cloud** (`@supabase/supabase-js 2.108.2`, `@supabase/ssr 0.12.0`) — Postgres + Auth + Storage + RLS.
- Deployment: **Cloudflare Worker via `@opennextjs/cloudflare 1.20.1`**, `nodejs_compat`. The full Next server runs on the **Node.js runtime** (not Edge) so **exceljs** parses `.xlsx` in prod; middleware uses the **Edge `middleware.ts` convention** because OpenNext rejects Node middleware.
- Data engine: **Arquero 8.0.3** — in use (`src/lib/calc/engine.ts`, `pivot.ts`) for cross-tabs/aggregations.
- Validation: **Zod 4.4.3** — in use at the **ingestion boundary** (`src/lib/ingestion/canonical.ts`). ⓘ **Not yet at every form/param boundary — extend it (P0), see rule below.**
- Ingestion: **PapaParse 5.5.4** (CSV) + **ExcelJS 4.4.0** (.xlsx), both in use (`src/lib/ingestion/parse.ts`).

## Non-negotiable rules

### Security (see system_context.md for the honest security goal)
- The goal is **defense in depth, minimal attack surface, contained blast radius, and detection** — NOT "impenetrable" (no system is; claiming it breeds dangerous overconfidence).
- **RLS on every public table, no exceptions.** A public table without RLS is a leak. Coverage is tested before every deploy. *(Verified: `enable` + `force` RLS on all 8 tables, policy-per-table, in `supabase/migrations/0000_init_schema_and_rls.sql`.)*
- **Authorization is enforced server-side on every route and mutation**, never only in the frontend. Hiding a UI element is not access control. Session checks use `getUser()`, **never `getSession()`**, for any auth decision.
- ⓘ **Least privilege at the database, not just the UI.** Client-role users must be **read-only on data tables at the RLS/grant level**, not merely in the interface. (Audit finding: V1 grants `authenticated` full CRUD and gates writes only by `tenant_id`, so a client could write within their own tenant via the API. Fix in P0: `SELECT`-only grant for clients + drop client write policies; internal writes go through service_role.)
- **Tenant isolation is sacred.** A user of tenant A must never read or write tenant B data. This is verified adversarially (authenticate as A, attempt B, assert failure — `scripts/isolation-test.mjs`), never assumed. **Run that test against the live DB before trusting isolation** — the SQL editor bypasses RLS and proves nothing.
- Secrets live in `.env` only (gitignored), injected at runtime. The Supabase `service_role`/secret key is **server-only** (`import "server-only"` in `src/lib/supabase/admin.ts`) and must never reach the browser bundle or git. Only the publishable/anon key is client-side.
- Validate every input boundary (uploads, forms, params) with Zod before use. Reject by default. ⓘ *Currently ingestion-only; bring login/upload form fields and route params under Zod in P0.*
- Sanitize user-generated content (survey free-text, e.g. `qual_observation.quote`) before rendering to prevent stored XSS. *(V1 has no `dangerouslySetInnerHTML` and does not yet render qual text; keep it that way as qualitative views land.)*

### Calculation integrity
- Composite metrics (NPS, CSAT, Top-2-Box) are **canonical functions defined once** (`src/lib/calc/metrics.ts`), unit-tested against known-good outputs (`scripts/calculation-test.mjs`). A wrong number does not throw — it misleads a client. This is a human-review zone.
- ⓘ **Kano is OUT OF SCOPE.** The consultant's process documentation states explicitly: *"No se va a utilizar este modelo"* (§4.4). Do not build it.
- **Rounding/precision is governed by `docs/CALCULATION_POLICY.md`** — one canonical helper (`roundTo`, half away from zero, Excel `ROUND()` parity), precision declared per unit in `DECIMALS`, every value rounded exactly once. Never round with `toFixed`.
- Aggregations use Arquero, not hand-rolled loops (`src/lib/calc/engine.ts`, `pivot.ts`).
- **Do not invent formulas.** The exact calculation catalog comes from the consultant's documented workflow (V2.5). Until then, use only the generic metrics already validated in V1.

### Data & config
- **Configuration over code:** anything varying per client/study (journey stages, dashboard sections, segmentation, branding) lives in data (JSON/columns), never hardcoded. *(Realized: journey renders from `study.journey_definition` jsonb.)*
- Small data, rich structure: volumes are tiny (thousands of rows/study). No premature pipelines, caches, or precomputation. Compute fresh, on demand.
- **Ingestion prefix convention** (`src/lib/ingestion/adapters/wide-survey.ts`): `seg_<key>` → `respondent.segments`, `q_<metric>` → `quant_response`, `qual_<theme>` → `qual_observation`, `source` → qualitative source override. New file shapes = new adapter, never a schema change.

## Human-review zones (never merge without human review)
1. **Authorization & sessions** — every RLS policy, grant, server-side authz guard, middleware, role logic.
2. **Calculation code** — canonical metric functions and Arquero pipelines.
3. **Secrets & security config** — env handling, keys, CSP, headers.

## Workflow rules
- **Plan before code.** Propose a plan; wait for approval before writing, especially for security-adjacent work.
- One task at a time on a given set of files.
- Verify every npm package before install (it exists, correct name, no known CVE). Pin versions (runtime deps are exact-pinned; keep it so).
- Migrations are versioned in git, applied to **staging first**, tested, then production. Never edit production schema/policies directly.
- Separate Supabase projects for dev/staging vs production. Real client data never enters staging.
- **Production repo stays clean:** no `CLAUDE.md`-style files, AI comments, or `§`/`Section` prompt-doc citations, or prompt files committed to production branches. *(Audit: `main` currently carries `CLAUDE.md`, `AGENTS.md`, `system_context.md`, `docs/FASE_*`, and §-citations in source — strip these on the production branch.)*

## Commands  *(from package.json)*
```
npm run dev          # next dev (local dev server)
npm run build        # next build (must pass before any deploy)
npm run lint         # eslint
npm run cf:build     # opennextjs-cloudflare build  -> .open-next/worker.js
npm run cf:preview   # build + local Worker preview (wrangler dev)
npm run cf:deploy    # build + wrangler deploy (Cloudflare Workers)

# No `typecheck` or `test` script yet. Until added:
npx tsc --noEmit                          # typecheck
npx tsx scripts/calculation-test.mjs      # canonical-metric known-good gate
node --env-file=.env.local scripts/isolation-test.mjs   # adversarial RLS gate
node --env-file=.env.local scripts/secret-leak-test.mjs # secret-leak release gate
```
ⓘ *P0 should add first-class `typecheck` + `test` scripts (and ideally a runner/CI) wrapping the `scripts/` gates.*

## Build order (V2) — do not skip ahead
P0 Security hardening (headers, WAF, rate limits, secret hygiene, staging/prod split, **least-privilege grants**, **Zod at all boundaries**, **prove RLS at runtime**)
P1 Canonical calculation layer (generic metrics; match V1/Excel outputs)
P2 Universal ingestion (visual column mapper, staged validation, recoding)
P3 Template-system framework (Word-style start screen, library, save/instantiate — copy semantics)
P4 BI overhaul (cross-filter, pivot, journey map, qualitative human-in-the-loop)
P5 Client portal + longitudinal memory
P6 Visual backoffice
P7 Full hardening pass + all adversarial suites + backups + incident playbook

Each phase must pass its adversarial security suite before the next begins.
The template **framework** ships in V2; the template **content** (real formulas,
named starter templates) is populated in V2.5 after the consultant's workflow is documented.
Do not block V2 waiting for that documentation.

## When unsure
Ask. Do not guess on security, authorization, or calculations. A stopped task is
cheaper than a leak or a wrong number shipped to a client.
