# Fase 6 — Endurecimiento + despliegue producción

Deliverable (§3.1, Fase 6):
> *Auditoría de seguridad, anti-pausa, respaldos, paso a plan Pro.*

Status: ✅ **Code-complete. Security gates passed. Deployment configured.**

## 1. Cleanup — database is pristine

`scripts/cleanup-test-fixtures.mjs` (service_role) deleted the 3 test users and 2
TEST tenants; FK cascades removed every dependent row. Verified afterward:

```
tenant 0 · profiles 0 · study 0 · respondent 0 · quant_response 0
qual_observation 0 · segment_dimension 0 · journey_definition 0 · auth users 0
```

The `TEST_*` block was stripped from `.env.local`. The schema, RLS, policies and
grants remain — the system is empty and ready for real data.

## 2. Security audit — secret-leak gate PASSED (§6.5)

`scripts/secret-leak-test.mjs` scans the built **client** bundle (`.next/static`):

- ✓ **service_role key is NOT in the client bundle** (it lives only in
  server-only code — `src/lib/supabase/admin.ts`, guarded by `server-only`).
- ✓ The only `NEXT_PUBLIC_*` variables are `…SUPABASE_URL` and `…SUPABASE_ANON_KEY`;
  **no secret carries a `NEXT_PUBLIC_` prefix**.
- The anon key is correctly public (safe only because RLS is on every table, §6.3).

Run as a release gate after each build.

## 3. Deployment — Cloudflare via OpenNext (§1.1)

> Updated post-v1: migrated from the deprecated `@cloudflare/next-on-pages` to
> the **OpenNext** adapter (`@opennextjs/cloudflare`), which runs Next on the
> Node.js runtime in a Cloudflare **Worker** — so `exceljs` `.xlsx` parsing works
> in production. Next 16's `proxy` convention forces Node middleware (rejected by
> the adapter), so the session gate uses the Edge **`middleware.ts`** convention.

- [wrangler.toml](../wrangler.toml) — `main = .open-next/worker.js`,
  `nodejs_compat`, compatibility date, static-assets binding.
- [open-next.config.ts](../open-next.config.ts) — OpenNext Cloudflare config.
- [docs/DEPLOYMENT.md](DEPLOYMENT.md) — full guide: migrations + RLS coverage
  gate, build command (`npx opennextjs-cloudflare build`), Workers dashboard
  settings, environment variables (service_role as an **encrypted** secret).
- `package.json` scripts: `cf:build`, `cf:preview`, `cf:deploy`.
- `npm run build` (plain `next build`) runs **flawlessly**, including `/api/health`.

The app is dynamic (SSR + Server Actions + session middleware), so it deploys as a
Cloudflare Worker via OpenNext — not a static export.

## 4. Anti-pause — health endpoint + Uptime Robot (§9.1)

- `GET /api/health` ([route](../src/app/api/health/route.ts)) makes a lightweight
  request to Supabase on each call, so pinging it keeps the **Supabase** project
  active (frontend-only traffic would not). 200 when reachable, 503 otherwise.
- [docs/OPERATIONS.md](OPERATIONS.md) — step-by-step Uptime Robot setup (HTTP(s)
  monitor, **5-minute** interval, optional `"supabase":true` keyword alert), plus
  when to move to Supabase **Pro** (§9.2) and the environment-separation rule
  (§6.4).

## Defense-in-depth recap (built across all phases)

- RLS enabled + forced on every public table; tenant-isolation policies created
  in the same migration (§6.2). Behavioral isolation test (§6.5) green throughout.
- API role grants explicit; `anon` ungranted (hard-denied) on top of RLS.
- service_role server-only; secret-leak gate enforces it.
- Server-side auth on every protected route (`getUser()`, not `getSession()`).
- Zod validation on all ingested data (Fase 2).
- Calculations centralized and gate-verified (Fase 3); dynamic crosses validated
  against an allowlist before compute (Fase 4).
- Dependencies pinned (§6.4); `exceljs` chosen over `xlsx` to avoid known CVEs.
- Versioned SQL migrations in `supabase/migrations/`.

## Operator handover checklist

1. Provision a **production** Supabase project (separate from dev).
2. Apply `0000_…` then `0001_…` migrations; run `rls_coverage.sql` (expect 0 rows).
3. Set env vars in Cloudflare (service_role as encrypted secret).
4. `npm run build` + `scripts/secret-leak-test.mjs` as release gates.
5. Deploy via `npm run pages:deploy` (or Git integration).
6. Configure Uptime Robot against `/api/health` (OPERATIONS.md).
7. Move Supabase to Pro when the first real client gets the link.
