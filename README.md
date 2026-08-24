# Be Community — Platform

Multi-tenant B2B Business Intelligence & Data Storytelling platform for an
education-sector consulting firm. Ingests raw survey / focus-group /
observation data and turns it into interactive dashboards and data-connected
journey maps for the firm's clients (schools).

## Stack

- **Next.js 16** (App Router) · React 19 · TypeScript (strict) · Tailwind v4
- **Supabase Cloud** (Postgres + Auth + RLS) — tenant isolation via forced RLS on every table
- Workers-safe canonical calculation engine · Arquero (dev-only parity oracle) · Zod (validation) · PapaParse + lazy ExcelJS browser build (ingestion)
- **Deployed on Cloudflare Workers** via the OpenNext adapter (`@opennextjs/cloudflare`), Node.js runtime with `nodejs_compat` — see [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md). **Not Vercel, not Cloudflare Pages.**

## Getting started

```bash
npm install
cp .env.example .env.local   # fill with values from the Supabase dashboard
npm run dev                  # http://localhost:3000
```

Apply every versioned migration in order before first run. For a linked
development/staging project use `npx supabase db push --dry-run`, review the
exact list, then `npx supabase db push`. Emergency rollback scripts live outside
`supabase/migrations/` and are never auto-applied. Verify with
`npm run test:rls-coverage` (zero uncovered tables; `supabase/tests/rls_coverage.sql`
is the equivalent manual diagnostic for the SQL editor).

## Commands

```bash
npm run dev          # local dev server
npm run typecheck    # TypeScript strict check
npm run build        # production build (must pass before any deploy)
npm run lint         # eslint
npm run test         # complete deterministic suite
npm run gates        # gates:offline + gates:live — the complete release chain
npm run gates:offline # credentials-free: typecheck, lint, test, build, cf:build, suite:d
npm run gates:live   # live credential-bearing checks: qualitative-live, then suite:a
npm run suite:a      # Suite A: tenant isolation, data scope, least privilege (A1-A5)
npm run test:isolation      # the legacy isolation gate on its own (Suite A runs it as A1.5)
npm run test:rls-coverage   # the RLS/FORCE-RLS gate on its own (Suite A runs it as A4.1)
npm run suite:d      # Suite D: dependency advisories, pins, lockfile, history, artifacts
npm run test:import-center-live # mapping version/RPC gate against linked dev DB
npm run cf:build     # opennextjs-cloudflare build -> .open-next/worker.js
npm run cf:preview   # build + local Worker preview (wrangler dev)
npm run cf:deploy    # build + deploy to Cloudflare Workers
```

`suite:a` — and therefore `gates:live` and `gates` — drives a real browser
against a running application. It needs the app served at `HARNESS_ORIGIN`
(default `http://localhost:3000`), real synthetic credentials in `.env.local`,
and a Chrome/Chromium binary named by `CHROME_PATH`. On Windows workstations
run it from WSL as an ordinary (non-root) user with the distribution's own Linux
browser, so the browser sandbox stays on.

## Verification gates (run before deploying)

```bash
npx tsc --noEmit                                          # typecheck
npx tsx scripts/calculation-test.mjs                      # metric engine vs. hand-computed values
node --env-file=.env.local scripts/import-center-live-test.mjs # mapping reuse/version/denial
node --env-file=.env.local scripts/isolation-test.mjs     # adversarial RLS / tenant-isolation test
node --env-file=.env.local scripts/rls-coverage-test.mjs  # RLS coverage + 0014 privilege model
node --env-file=.env.local scripts/secret-leak-test.mjs   # no secrets in the bundle
```

## Deployment

Cloudflare **Workers** (not Pages), built with OpenNext and deployed via
Wrangler. Full instructions, environment variables, and the go-live checklist:
[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md). Operations (uptime monitoring,
free-tier anti-pause): [docs/OPERATIONS.md](docs/OPERATIONS.md).

## Current state

P0-P6 are implemented, technically accepted and human-accepted with synthetic
data. The remaining mobile and PDF defects were fixed and deployed in PR #28;
P6 is closed. P7 full hardening and go-live preparedness is now the active
phase. Read [docs/CURRENT_STATE.md](docs/CURRENT_STATE.md) before starting or
handing off work; historical audit/phase documents are not authoritative.
