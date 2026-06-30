# Deployment — Cloudflare (OpenNext adapter) + Supabase

Per §1.1, Cloudflare hosts the Next.js frontend and Supabase is the backend.
This app is **dynamic** (server components do RLS-scoped reads, Server Actions
handle login/logout/upload, the session middleware runs on every request), so it
is **not** a static export.

## Adapter: OpenNext (Cloudflare Workers)

We deploy with **[`@opennextjs/cloudflare`](https://opennext.js.org/cloudflare)**
(the `@cloudflare/next-on-pages` adapter is deprecated). OpenNext runs the full
Next.js server on the **Node.js runtime inside a Cloudflare Worker** — so Node
libraries work in production, including **`exceljs`** for `.xlsx` uploads.

> **This is a Workers deployment, not a Pages project.** OpenNext produces a
> Worker (`.open-next/worker.js`) + static assets, deployed via Wrangler. If you
> previously created a **Pages** project, create a **Worker** instead (see
> "Cloudflare dashboard" below). The deprecated next-on-pages error about
> `/_middleware` no longer applies.

### Runtime notes (why the build now works)

- **Middleware must be Edge.** Next 16's `proxy.ts` convention forces the Node.js
  runtime, which OpenNext rejects ("Node.js middleware is not currently
  supported"). We therefore use the **`middleware.ts`** convention
  ([src/middleware.ts](../src/middleware.ts)), which runs on the Edge runtime.
- **No `runtime = "edge"` on routes.** Under OpenNext the routes run on Node, so
  those exports were removed — that's what lets `exceljs` work for `.xlsx`.

## Prerequisites

- A **production** Supabase project (separate from dev — §6.4). Apply migrations:
  1. `supabase/migrations/0000_init_schema_and_rls.sql`
  2. `supabase/migrations/0001_api_role_grants.sql`
  Then run `supabase/tests/rls_coverage.sql` — query #1 must return **zero rows**.
- A Cloudflare account.

## Build & deploy commands

```bash
npm run build        # next build (plain — must pass first; runs flawlessly)
npm run cf:build     # opennextjs-cloudflare build  -> .open-next/worker.js
npm run cf:preview   # build + local Worker preview (wrangler dev)
npm run cf:deploy    # build + wrangler deploy (to Cloudflare Workers)
```

> **Windows note:** `npm run cf:build` may fail locally on Windows with
> `EPERM: symlink` (OpenNext's file-tracing step needs symlink privileges).
> This is a local-only limitation — Cloudflare's build runs on **Linux**, where
> it succeeds. Enable Windows "Developer Mode" if you want it to run locally.

`wrangler.toml` encodes `main = .open-next/worker.js`, `nodejs_compat`, the
compatibility date, and the static-assets binding.

## Cloudflare dashboard (Workers + Git)

Workers & Pages → **Create** → **Workers** → **Connect to Git** → select
`patoperez/becommunity-v1`, then:

| Setting | Value |
|---------|-------|
| Build command | `npx opennextjs-cloudflare build` |
| Deploy command | `npx wrangler deploy` |
| (Output) | configured by `wrangler.toml` (`.open-next/worker.js` + assets) |

## Environment variables (Worker → Settings → Variables)

| Variable | Type | Notes |
|----------|------|-------|
| `NEXT_PUBLIC_SUPABASE_URL` | Plain | Public |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Plain | Public — safe only because RLS is on every table (§6.3) |
| `SUPABASE_SERVICE_ROLE_KEY` | **Encrypted secret** | Server only — bypasses RLS. NEVER `NEXT_PUBLIC_*` |

Run `scripts/secret-leak-test.mjs` after a build as a release gate.

## Go-live checklist (§6.5 + §9.2)

- [ ] Migrations applied to production Supabase; RLS coverage query returns 0 rows.
- [ ] `npm run build` passes; `scripts/secret-leak-test.mjs` passes.
- [ ] Behavioral isolation test passes against production (see `scripts/isolation-test.mjs`).
- [ ] Worker env vars set (service_role as an encrypted secret).
- [ ] Uptime Robot configured against `/api/health` — see [OPERATIONS.md](OPERATIONS.md).
- [ ] Supabase upgraded to **Pro** once a real client has the link (§9.2).
