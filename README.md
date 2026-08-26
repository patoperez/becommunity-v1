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
npm run gates:live   # live credential-bearing chain: qualitative-live -> suite:a -> suite:b -> suite:c
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

P0-P6 are implemented, technically accepted and human-accepted with synthetic
data. P7 engineering is complete at `b8fcfc4` (delivery PR #38). P8-A is
implementation-complete and owner-accepted at `3659a38` (delivery PR #37).
P8.2's first owner-review slice — no-code access scope and guided import
mapping — is owner-accepted and merged at `b1abfef` (delivery PR #39).

**P8.2 is implementation- and synthetic-acceptance-complete and awaiting owner
review.** Be Community
Studio has its own addresses under `/studio/**` — every `/admin/**` address
still answers — an actionable home, a study work surface with process steps,
the journey-metric and theme pickers, visible paging, publication reachable only
through the client preview, one accessible destructive-action dialog, and the
account and client lifecycle. Migration `0015` is applied to the synthetic
project only; the complete offline and live chains and the lifecycle acceptance
passed at `543889a`, and all disposable acceptance data was removed with the
protected fixture unchanged. Permanent client deletion remains deliberately
disabled and refused server-side until a recoverable cross-system deletion
workflow exists.

**P8.3 is implementation-complete on `p8d-insights-data-story` and awaiting
owner review.** `/insights` now has a compact study library and an authorized
route per study; filter state is shareable in the URL and drives the same
bounded grammar used by the PDF. Comparisons, longitudinal reading, sample
context, recovery states and the PDF vocabulary are one client-facing story.
Calculations, ingestion, RLS, roles and publication boundaries are unchanged.

**P8.4 is implementation-complete on
`p8e-qualitative-interpretation-customization` and awaiting owner review.**
Studio now has a structured consultant-reading workflow with private draft,
visible review state and a separately published client snapshot. The client
story and PDF show only that snapshot. Qualitative results add an optional,
downloadable word cloud while retaining the counted list as the reference; the
journey keeps the most useful friction points close to each moment. Client and
study presentation settings inherit predictably, support one focused threshold
alert, and travel with team-shared templates. Migrations `0017` and `0018` are
applied to the synthetic project only. `npm run test:p8-qualitative` is the
30th deterministic gate; `npm run test:p8-qualitative-live` verifies the full
interpretation lifecycle with disposable data.

Standalone visual prototyping is closed: implement reviewable vertical slices in
the real product and correct them through human testing. Read
[docs/CURRENT_STATE.md](docs/CURRENT_STATE.md) before starting or handing off
work; historical audit/phase documents are not authoritative.
