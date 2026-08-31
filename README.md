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

Run repository npm lifecycle commands in Linux/WSL, not on the Windows host;
the signed-code policy on this workstation blocks Cloudflare's `workerd.exe`.
See [docs/CURRENT_STATE.md](docs/CURRENT_STATE.md) for the verified environment.

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
npm run gates:live   # complete credential-bearing browser/database chain, including composer milestones and Suites A-C
npm run suite:a      # Suite A: tenant isolation, data scope, least privilege (A1-A5)
npm run suite:b      # Suite B: server-side authorization (B1-B11, three evidence layers)
npm run suite:c      # Suite C: hostile input, imports, pivot boundary, injection (C1-C5)
npm run test:isolation      # the legacy isolation gate on its own (Suite A runs it as A1.5)
npm run test:rls-coverage   # the RLS/FORCE-RLS gate on its own (Suite A runs it as A4.1)
npm run test:pivot          # the pivot allowlist gate on its own (Suite C runs it as C3.1)
npm run suite:d      # Suite D: dependency advisories, pins, lockfile, history, artifacts
npm run test:import-center-live # mapping version/RPC gate against linked dev DB
npm run cf:build     # opennextjs-cloudflare build -> .open-next/worker.js
npm run cf:preview   # build + local Worker preview (wrangler dev)
npm run cf:deploy    # build + deploy to Cloudflare Workers
```

`suite:a`, `suite:b` and `suite:c` — and therefore `gates:live` and `gates` —
each drive a real browser against a running application. They need the app
served at `HARNESS_ORIGIN` (default `http://localhost:3000`), real synthetic
credentials in `.env.local`,
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

P0-P8 are implemented and owner-accepted; P9 hardening and the first real-study
path are established. Guided XLSX/CSV mapping supports internal-only respondent
metadata, aggregate retention/churn has its own period-series import, semantic
category grouping is decided by a person, and the Journey editor focus-loss
regression is covered by deterministic and real-browser gates.

**Current product-construction milestone:** the governed Experience Composer is
at schema version 3 on
`claude/experience-builder-journeys-visuals-cloud` (verified implementation
handoff `e9fdd6268e16429be37498f389ad8f5bc706028d`). It supports independently
collapsible editor panels, multiple reusable recorridos, exact awareness
mappings, authored semáforo standards that can become filters, real heat-map /
bubble / treemap renderers, and a deterministic thematic cloud over approved
qualitative categories. The full design and verification record is in
[docs/EXPERIENCE_COMPOSER.md](docs/EXPERIENCE_COMPOSER.md), sections 38-44.

The composer still saves an **internal draft only**. It does not yet change the
client dashboard. Publication/version history/rollback and the client renderer
are the next bounded unit. The real Cuicuilco draft remains unchanged at
revision 72; the milestone was uploaded only as a zero-traffic Worker preview,
and production traffic was not promoted.

Before any manual Cloudflare deployment, read
[docs/CURRENT_STATE.md](docs/CURRENT_STATE.md) and
[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md). `keep_vars = true` is enforced, but
the two public Supabase bindings currently still have to be supplied on a
version upload; the privileged service-role key remains an encrypted Worker
secret and must never enter a build or committed file.

Standalone visual prototyping is closed: implement reviewable vertical slices in
the real product and correct them through human testing. Read
[docs/CURRENT_STATE.md](docs/CURRENT_STATE.md) before starting or handing off
work; historical audit/phase documents are not authoritative.
