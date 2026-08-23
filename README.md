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
`supabase/tests/rls_coverage.sql` (query #1 must return zero rows).

## Commands

```bash
npm run dev          # local dev server
npm run typecheck    # TypeScript strict check
npm run build        # production build (must pass before any deploy)
npm run lint         # eslint
npm run test         # complete deterministic suite
npm run gates        # build + deterministic/live security release gates
npm run test:import-center-live # mapping version/RPC gate against linked dev DB
npm run cf:build     # opennextjs-cloudflare build -> .open-next/worker.js
npm run cf:preview   # build + local Worker preview (wrangler dev)
npm run cf:deploy    # build + deploy to Cloudflare Workers
```

## Verification gates (run before deploying)

```bash
npx tsc --noEmit                                          # typecheck
npx tsx scripts/calculation-test.mjs                      # metric engine vs. hand-computed values
node --env-file=.env.local scripts/import-center-live-test.mjs # mapping reuse/version/denial
node --env-file=.env.local scripts/isolation-test.mjs     # adversarial RLS / tenant-isolation test
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
