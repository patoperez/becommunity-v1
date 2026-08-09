# Be Community — Platform

Multi-tenant B2B Business Intelligence & Data Storytelling platform for an
education-sector consulting firm. Ingests raw survey / focus-group /
observation data and turns it into interactive dashboards and data-connected
journey maps for the firm's clients (schools).

## Stack

- **Next.js 16** (App Router) · React 19 · TypeScript (strict) · Tailwind v4
- **Supabase Cloud** (Postgres + Auth + RLS) — tenant isolation via forced RLS on every table
- **Arquero** (in-memory calculation engine) · Zod (validation) · PapaParse + ExcelJS (ingestion)
- **Deployed on Cloudflare Workers** via the OpenNext adapter (`@opennextjs/cloudflare`), Node.js runtime with `nodejs_compat` — see [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md). **Not Vercel, not Cloudflare Pages.**

## Getting started

```bash
npm install
cp .env.example .env.local   # fill with values from the Supabase dashboard
npm run dev                  # http://localhost:3000
```

Apply the database migrations (in order) to your Supabase project before first
run: `supabase/migrations/0000_init_schema_and_rls.sql`, then
`0001_api_role_grants.sql`. Verify with `supabase/tests/rls_coverage.sql`
(query #1 must return zero rows).

## Commands

```bash
npm run dev          # local dev server
npm run build        # production build (must pass before any deploy)
npm run lint         # eslint
npm run cf:build     # opennextjs-cloudflare build -> .open-next/worker.js
npm run cf:preview   # build + local Worker preview (wrangler dev)
npm run cf:deploy    # build + deploy to Cloudflare Workers
```

## Verification gates (run before deploying)

```bash
npx tsc --noEmit                                          # typecheck
npx tsx scripts/calculation-test.mjs                      # metric engine vs. hand-computed values
node --env-file=.env.local scripts/isolation-test.mjs     # adversarial RLS / tenant-isolation test
node --env-file=.env.local scripts/secret-leak-test.mjs   # no secrets in the bundle
```

## Deployment

Cloudflare **Workers** (not Pages), built with OpenNext and deployed via
Wrangler. Full instructions, environment variables, and the go-live checklist:
[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md). Operations (uptime monitoring,
free-tier anti-pause): [docs/OPERATIONS.md](docs/OPERATIONS.md).
