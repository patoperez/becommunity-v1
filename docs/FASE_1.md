# Fase 1 — Autenticación y portal vacío (Auth & empty portal)

Deliverable (§3.1, Fase 1):
> *Login por cliente funcionando; cada cuenta entra y ve su espacio (aún sin
> datos); verificación de que un cliente no ve nada de otro.*

Status: ✅ **Complete and behaviorally verified.**

## What was built

| Piece | File |
|-------|------|
| Login screen (email + password, §7.2) | [src/app/login/page.tsx](../src/app/login/page.tsx), [src/app/login/actions.ts](../src/app/login/actions.ts) |
| Protected portal (`/dashboard`) | [src/app/dashboard/page.tsx](../src/app/dashboard/page.tsx), [src/app/dashboard/actions.ts](../src/app/dashboard/actions.ts) |
| Session refresh + route gate (Edge middleware) | [src/middleware.ts](../src/middleware.ts), [src/lib/supabase/middleware.ts](../src/lib/supabase/middleware.ts) |
| Root redirect → portal | [src/app/page.tsx](../src/app/page.tsx) |

## Defense in depth (§6.4) — how it is enforced

1. **`middleware.ts`** refreshes the session and redirects unauthenticated
   requests away from protected routes. This is the *first* gate, not the only one.
2. **The dashboard Server Component independently re-checks** `supabase.auth.getUser()`
   before rendering anything, and redirects to `/login` if absent. It never
   trusts the middleware alone.
3. Both layers use **`getUser()`** (revalidates the JWT against the Auth server),
   never `getSession()` (which only decodes the cookie and is spoofable).
4. All data (tenant name, studies) is read with the **user's own session**, so
   RLS (§6.2) guarantees only their tenant's rows can return — the server has no
   code path that hands over another client's data.
5. Login errors are **generic** ("Credenciales inválidas") to avoid email
   enumeration.

## Behavioral verification (§6.5) — the gate that must pass

Fixtures seeded via service_role ([scripts/seed-test-data.mjs](../scripts/seed-test-data.mjs)):
two tenants (Colegio Alfa / Colegio Beta), one client user each, a study +
respondent + quant/qual rows per tenant.

`node --env-file=.env.local scripts/isolation-test.mjs` → **all checks passed**:

- **Anonymous access**: every table returned no data / was rejected.
- **Cross-tenant READ**: Client A querying Tenant B's rows → **0 rows** on all 6
  data tables.
- **Cross-tenant WRITE**: Client A inserting into Tenant B → **rejected (42501)**.
- **Positive path**: Client A signed in sees exactly its own 1 study, all rows
  belonging to its own tenant.

UI verified in-browser: login as Tenant A → redirected to `/dashboard` showing
"Colegio Alfa (TEST A)" and only its own study; unauthenticated `/dashboard`
→ 307 redirect to `/login`.

## Important environment note — API role GRANTs

PostgREST gates table access by Postgres **GRANTs**, separate from RLS. This
project was provisioned **without** the Supabase default privileges, so every
API call returned `42501 permission denied` until grants were applied. Fixed by
[supabase/migrations/0001_api_role_grants.sql](../supabase/migrations/0001_api_role_grants.sql)
(also folded into 0000 for fresh setups). `anon` is intentionally **not**
granted, so unauthenticated API calls are hard-denied on top of RLS.

## Cleanup before production

- The `test-tenant-a@becommunity.test` / `...-b` users, the two TEST tenants,
  and the `TEST_*` block in `.env.local` are fixtures — remove them before real
  data goes in. `.env.local` is gitignored.
