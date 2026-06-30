# Deployment — Cloudflare Pages (frontend) + Supabase (backend)

Per §1.1: Cloudflare Pages hosts the Next.js frontend; Supabase is the backend
(Postgres + Auth + Storage + RLS). This app is **dynamic** — server components do
RLS-scoped reads, Server Actions handle login/logout/upload, and the session
`proxy` runs on every request — so it is **not** a static export.

## Prerequisites

- A production Supabase project (separate from dev — §6.4 "Separación de
  entornos"). Apply the migrations in order:
  1. `supabase/migrations/0000_init_schema_and_rls.sql`
  2. `supabase/migrations/0001_api_role_grants.sql`
  Then run `supabase/tests/rls_coverage.sql` and confirm query #1 returns **zero
  rows** (no table without RLS) before any real data is loaded.
- A Cloudflare account with Pages enabled.

## Build

The Next.js → Cloudflare adapter produces the Pages output:

```bash
npm run pages:build      # npx @cloudflare/next-on-pages@latest
```

`npm run build` (plain `next build`) must pass first and is run by the adapter.

> Compatibility note: this project pins **Next 16**. Confirm the
> `@cloudflare/next-on-pages` version supports the installed Next at deploy time
> (it is invoked via `npx … @latest` rather than pinned, precisely so the deploy
> picks a compatible release). If a route fails the adapter's runtime check, add
> `export const runtime = "edge"` to it; routes using Node-only libs (the admin
> upload uses `exceljs`) rely on the `nodejs_compat` flag set in `wrangler.toml`.

## Cloudflare Pages settings (dashboard)

| Setting | Value |
|---------|-------|
| Framework preset | Next.js |
| Build command | `npm run pages:build` |
| Build output directory | `.vercel/output/static` |
| Compatibility flags | `nodejs_compat` (Production **and** Preview) |

`wrangler.toml` in the repo already encodes the name, compatibility date/flags,
and output dir.

## Environment variables (Cloudflare Pages → Settings → Environment variables)

| Variable | Type | Notes |
|----------|------|-------|
| `NEXT_PUBLIC_SUPABASE_URL` | Plain | Public |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Plain | Public — safe ONLY because RLS is on every table (§6.3) |
| `SUPABASE_SERVICE_ROLE_KEY` | **Encrypted secret** | Server only — bypasses RLS. NEVER `NEXT_PUBLIC_*`. Set as an encrypted secret, never a plain var |

The secret-leak gate (`scripts/secret-leak-test.mjs`) verifies the service_role
key never reaches the client bundle — run it after a build as part of release.

## Deploy

```bash
npm run pages:deploy     # builds, then `wrangler pages deploy`
# or connect the Git repo in the Cloudflare dashboard for push-to-deploy
```

## Go-live checklist (§6.5 gates + §9.2)

- [ ] Migrations applied to the production Supabase project; RLS coverage query returns 0 rows.
- [ ] `npm run build` passes; `scripts/secret-leak-test.mjs` passes against the built bundle.
- [ ] Behavioral isolation test passes against production (two tenants) — see `scripts/isolation-test.mjs`.
- [ ] Environment variables set in Cloudflare (service_role as an encrypted secret).
- [ ] Uptime Robot configured against `/api/health` — see [OPERATIONS.md](OPERATIONS.md).
- [ ] Supabase upgraded to **Pro** once a real client has the link (removes the idle pause, adds daily backups — §9.2).
