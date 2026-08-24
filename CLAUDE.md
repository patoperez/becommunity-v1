# CLAUDE.md — Be Community Platform

> Operational rules for Claude Code on this repository. Read this every session.
> Standing rules originate in the V1 audit (`AUDIT_V1.md`, 2026-07-07) and
> subsequent verified phases. Read `docs/CURRENT_STATE.md` for the authoritative
> current handoff before planning any task. Rules marked ⓘ are audit-derived
> guardrails — they are standing rules, not suggestions.

---

## What this project is

Be Community is a **multi-tenant B2B Business Intelligence & Data Storytelling
platform** for an education-sector consulting firm. It ingests raw survey /
focus-group / observation data and turns it into interactive dashboards and
data-connected journey maps for the firm's clients (schools).

**It is NOT a CRM.** No sales pipelines. The product is data → insight → client-facing story.

- The P0-P6 V2 framework is deployed to a **synthetic-data test/beta Worker**.
  It is not yet a real-client go-live environment; P7 and the go-live controls
  remain outstanding.
- Full V2 architecture lives in `BeCommunity_V2_Technical_Architecture.docx` (reference only — consult, don't inline).
- Project background and decisions live in `system_context.md`.

## Tech stack  *(verified against package.json + config, 2026-08-22)*

- Framework: **Next.js 16.2.9** (App Router) + **React 19.2.4** + **TypeScript ^5, `strict: true`**.
- Styling: **TailwindCSS v4** (`@tailwindcss/postcss`).
- Backend/DB: **Supabase Cloud** (`@supabase/supabase-js 2.108.2`, `@supabase/ssr 0.12.0`) — Postgres + Auth + Storage + RLS.
- Deployment: **Cloudflare Worker via `@opennextjs/cloudflare 1.20.1`**, `nodejs_compat`. The full Next server runs on the **Node.js runtime** (not Edge); middleware uses the **Edge `middleware.ts` convention** because OpenNext rejects Node middleware. ⓘ **`nodejs_compat` is NOT a guarantee that a Node library works.** workerd's `unenv` shims throw on unimplemented APIs, and ExcelJS's Node entry dies on a module-level `process.umask()` (via `unzipper` → `fstream`). `.xlsx` therefore loads ExcelJS's **browser** build lazily — see `src/lib/ingestion/parse.ts` and the `test:workers-ingestion` gate.
- Data engine: Workers-safe native table/aggregation code in
  `src/lib/calc/table.ts`, `engine.ts`, and `pivot.ts`. **Arquero 8.0.3 is
  dev-only**, retained as a parity oracle and positive control; production code
  must not import it because its runtime code generation is forbidden by workerd.
- Validation: **Zod 4.4.3** at ingestion, login, admin actions, dashboard data
  actions, report/preview params, study scope, branding, templates, journey and
  dashboard configuration boundaries. New untrusted boundaries must follow the
  same reject-by-default pattern.
- Ingestion: **PapaParse 5.5.4** (CSV) + **ExcelJS 4.4.0** (.xlsx), both in use (`src/lib/ingestion/parse.ts`).

## Non-negotiable rules

### Security (see system_context.md for the honest security goal)
- The goal is **defense in depth, minimal attack surface, contained blast radius, and detection** — NOT "impenetrable" (no system is; claiming it breeds dangerous overconfidence).
- **RLS on every public table, no exceptions.** A public table without RLS is a
  leak. `npm run test:rls-coverage` is the executable pre-merge/pre-deploy check:
  it reads the coverage inventory through migration `0014`'s metadata-only
  reporting function and must report every public ordinary/partitioned table as
  both **RLS-enabled and FORCE RLS** — zero exceptions on either — and it proves
  in the same run that `anon` and `authenticated` cannot execute that function.
  `supabase/tests/rls_coverage.sql` remains the equivalent manual diagnostic for
  the SQL editor.
- **Authorization is enforced server-side on every route and mutation**, never only in the frontend. Hiding a UI element is not access control. Session checks use `getUser()`, **never `getSession()`**, for any auth decision.
- ⓘ **Least privilege at the database, not just the UI.** Client-role users are
  read-only at the RLS/grant level through migration
  `0002_least_privilege_client_reads.sql`; internal mutations use explicitly
  authorized server paths/service role. Preserve and adversarially verify this.
- **Tenant isolation is sacred.** A user of tenant A must never read or write tenant B data. This is verified adversarially (authenticate as A, attempt B, assert failure — `scripts/isolation-test.mjs`), never assumed. **Run that test against the live DB before trusting isolation** — the SQL editor bypasses RLS and proves nothing.
- Secrets live in `.env` only (gitignored), injected at runtime. The Supabase `service_role`/secret key is **server-only** (`import "server-only"` in `src/lib/supabase/admin.ts`) and must never reach the browser bundle or git. Only the publishable/anon key is client-side.
- Validate every new input boundary (uploads, forms, params) with Zod before use.
  Reject by default and preserve the existing boundary schemas.
- Render user-generated qualitative content only through React's escaped text
  nodes; never introduce `dangerouslySetInnerHTML`. Only human-confirmed themes
  and independently approved quotes may cross the client/publication boundary.

### Calculation integrity
- Composite metrics (NPS, CSAT, Top-2-Box) are **canonical functions defined once** (`src/lib/calc/metrics.ts`), unit-tested against known-good outputs (`scripts/calculation-test.mjs`). A wrong number does not throw — it misleads a client. This is a human-review zone.
- ⓘ **Kano is OUT OF SCOPE.** The consultant's process documentation states explicitly: *"No se va a utilizar este modelo"* (§4.4). Do not build it.
- **Rounding/precision is governed by `docs/CALCULATION_POLICY.md`** — one canonical helper (`roundTo`, half away from zero, Excel `ROUND()` parity), precision declared per unit in `DECIMALS`, every value rounded exactly once. Never round with `toFixed`.
- Aggregations use the canonical Workers-safe engine and pivot implementation.
  Arquero may be used only in tests as a parity oracle, never in
  production-reachable code.
- **Do not invent formulas.** Confirmed business rules live in `docs/CALCULATION_CATALOG.md`; implement only formulas marked authoritative there. Keep template-varying mappings and crosses in configuration.

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
- ⓘ **Regenerate `package-lock.json` only under npm 10.9.2** — the version
  declared in `package.json` (`packageManager`) and enforced by CI and Suite D's
  **D-f**. npm 11 prunes peer nodes beneath platform-excluded optional
  dependencies; npm 10 (which Cloudflare's build image runs) still requires them,
  so an npm 11 regeneration passes every local gate and then fails the deploy
  build with `npm ci … Missing: @emnapi/…`. Never repair that by hand-editing the
  lockfile or by adding an install bypass flag.
- Migrations are versioned in git, applied to **staging first**, tested, then production. Never edit production schema/policies directly.
- Separate Supabase projects for dev/staging vs production. Real client data never enters staging.
- **Production repo stays clean:** no `CLAUDE.md`-style files, AI comments, or `§`/`Section` prompt-doc citations, or prompt files committed to production branches. *(Audit: `main` currently carries `CLAUDE.md`, `AGENTS.md`, `system_context.md`, `docs/FASE_*`, and §-citations in source — strip these on the production branch.)*

## Commands  *(from package.json)*
```
npm run dev          # next dev (local dev server)
npm run typecheck    # TypeScript strict check
npm run build        # next build (must pass before any deploy)
npm run lint         # eslint
npm test             # complete deterministic suite (23 gates at the P6E baseline)
npm run gates        # gates:offline + gates:live (the complete release chain)
npm run gates:offline # credentials-free: typecheck, lint, test, build, cf:build, suite:d
npm run gates:live   # credential-bearing live checks: qualitative-live, then suite:a
npm run suite:a      # Suite A — tenant isolation, data scope, least privilege (A1-A5)
npm run test:isolation    # the legacy isolation gate alone; Suite A executes it as A1.5
npm run test:rls-coverage # live RLS coverage + 0014 privilege model (service_role / anon / authenticated)
npm run suite:d      # Suite D — dependency advisories, pins, lockfile, git history, artifacts
npm run cf:build     # opennextjs-cloudflare build  -> .open-next/worker.js
npm run cf:preview   # build + local Worker preview (wrangler dev)
npm run cf:deploy    # build + wrangler deploy (Cloudflare Workers)
```

`suite:a` — and so `gates:live` and `gates` — drives a real browser against a
running application. It needs the app served at `HARNESS_ORIGIN` (default
`http://localhost:3000`), real synthetic credentials, and a Chrome/Chromium
binary named by `CHROME_PATH`. Run it from WSL as an ordinary (non-root) user
with the distribution's own Linux browser, so the sandbox stays on and
`--no-sandbox` is never needed.

### Where these commands may run ⓘ

**Do not run repository npm lifecycle commands from Windows on this
workstation.** That includes `npm install`, `npm ci`, `npm test`,
`npm run build`, `npm run cf:build` and any gate chain
(`gates`, `gates:offline`, `suite:d`, `suite:d:local`).

Smart App Control is enabled here and blocks Cloudflare's unsigned
`workerd.exe`. The boundary is **not** limited to `cf:build`: a plain `npm ci`
runs package lifecycle/install validation that loads that binary, and Windows
Code Integrity event 3077 has recorded exactly that. Do not disable Smart App
Control and do not attempt a per-file bypass.

- **Windows** is for editing, Git operations, and static/non-Node inspection
  (`git diff --check`, reading files, reviewing a diff).
- **Node/npm verification runs in WSL 2 Ubuntu or Linux CI.** Verifier:
  `/home/patop/becommunity-software`, ordinary user `patop`, Node 24.11.1,
  npm 10.9.2.
- The Windows and WSL clones **do not auto-synchronize**. Push the exact commit
  from the Windows editing tree, then `fetch` and check out that exact remote
  commit in WSL before testing. Never assume the verifier already has your work.
- Suite D's D-d scans every reachable blob, so the verifier clone must be a
  full-history, full-blob clone — a `blob:none` partial clone cannot prove it.

Never claim a Windows npm command was avoided unless the Code Integrity
evidence supports it. The older note that "a plain `npm run build` must still
pass locally" does not hold on this machine; Cloudflare's Linux branch build and
the WSL verifier are the authoritative build checks.

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

## Current work — do not skip ahead

The authoritative state is `docs/CURRENT_STATE.md`.

- P0-P6 are implemented, technically accepted and human-accepted on synthetic
  data. P6E completed with 108 automated checks and 0 failures.
- The remaining P6 mobile-overflow and PDF-pagination defects were fixed in PR
  #28, human-accepted, squash-merged and deployed. P6 is closed.
- P7's evidence plan is approved. PRs 1-6 are merged: deployment identity,
  supply-chain/CI, executable RLS coverage, the reviewed adversarial harness,
  and Suite A are complete. Suite A is wired into `gates:live` and passed its
  deployed post-merge isolation smoke with zero fixture residue.
- The current unit is **P7 PR 7, `p7f-suites-b-c`**: behavioral authorization
  Suite B and hostile-input Suite C. Do not start Suite E, audit logging,
  anomaly detection, portability, incident response or compliance work until
  PR 7 is reviewed, merged and post-merge verified.
- Do not mutate real-production infrastructure, rotate credentials, create a
  real-data environment, or enable irreversible controls during synthetic P7
  work. Do not redirect the roadmap toward retention UI, new role tiers or an
  incidental feature question.

## When unsure
Ask. Do not guess on security, authorization, or calculations. A stopped task is
cheaper than a leak or a wrong number shipped to a client.
