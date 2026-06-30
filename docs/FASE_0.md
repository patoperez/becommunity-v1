# Fase 0 — Cimientos y Seguridad (Foundations & Security)

Status of the deliverable defined in the architecture doc (§3.1, Fase 0):
> *Modelo de datos creado; RLS activo en todas las tablas; pruebas de aislamiento
> pasando antes de cargar un solo dato real.*

## What is done (autonomous, in this repo)

| Item | Where | Status |
|------|-------|--------|
| Next.js (App Router + TypeScript + Tailwind) | repo root, `src/app` | ✅ Done |
| Supabase client libs (pinned) | `src/lib/supabase/{client,server,admin}.ts` | ✅ Done |
| Environment scaffolding | `.env.local`, `.env.example` | ✅ Template (needs real keys) |
| Canonical schema (§4.2) + RLS (§6.2) | `supabase/migrations/0000_init_schema_and_rls.sql` | ✅ Written |
| RLS coverage gate (§6.5) | `supabase/tests/rls_coverage.sql` | ✅ Written |
| Behavioral isolation test (§6.5) | `scripts/isolation-test.mjs` | ✅ Written |

## What still requires a connected browser / live project

These steps need an interactive, logged-in Supabase session and could **not** be
completed autonomously in this run (no browser was connected to the Chrome
extension; see the session notes). Each is a few clicks:

1. **Create the Supabase project** named `Be Community`.
   Save the generated **database password** in a password manager — it is shown
   only once.
2. **Copy credentials** from *Project Settings → API* into `.env.local`:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY` (server-only; never `NEXT_PUBLIC_*`)
3. **Run the migration**: open *SQL Editor*, paste the full contents of
   `supabase/migrations/0000_init_schema_and_rls.sql`, and run it. Schema + RLS +
   policies all execute in one script, so there is never an unprotected window
   (§6.2 golden rule).
4. **Run the coverage gate**: paste `supabase/tests/rls_coverage.sql` and confirm
   query #1 returns **zero rows** (no table without RLS).
5. **Behavioral isolation test** (§6.5): create two tenants, two auth users (one
   per tenant) each with a `profiles` row, seed a row for tenant B, then:
   ```bash
   node --env-file=.env.local scripts/isolation-test.mjs
   ```
   All checks must pass before loading any real data.

## Canonical data model (§4.2)

Tables, all in the `public` schema, all with `tenant_id` as the isolation axis
(except `tenant`, whose `id` is the key, and `profiles`, keyed by `user_id`):

`tenant`, `profiles` (the "user" entity — links `auth.users` → tenant + role,
per §7.1), `study`, `respondent`, `quant_response`, `qual_observation`,
`segment_dimension`, `journey_definition`.

### Note on the `user` entity → `profiles`

§4.2 names a `user` entity. It is implemented as `public.profiles` because:
- Supabase keeps the auth identity in `auth.users`; the app-level link to a
  tenant + role belongs in a separate table (§7.1 calls this table `profiles`).
- The RLS policies in §6.2 literally query
  `profiles WHERE user_id = auth.uid()`. Naming the table `profiles` keeps the
  schema and the mandated policies consistent (and avoids the reserved word
  `user`). This is the canonical "user" entity.

## Security model (§6.2/6.3) as implemented

- **RLS enabled (and `force`d) on every public table**, in the same migration
  that creates each table.
- Tenant-isolation policies compare a single indexed column:
  `tenant_id = (select tenant_id from profiles where user_id = (select auth.uid()))`.
- `auth.uid()` wrapped in `(select …)` for per-query caching (§6.2 perf note).
- Separate `SELECT` / `INSERT` / `UPDATE` (USING **and** WITH CHECK) / `DELETE`
  policies, so a user cannot move a row to another tenant.
- `tenant_id` indexed on every table.
- `service_role` key is server-only (`src/lib/supabase/admin.ts`, guarded by
  `server-only`); the `anon` key is safe in the browser only because RLS is on.
