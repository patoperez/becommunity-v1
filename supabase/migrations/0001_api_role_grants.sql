-- =============================================================================
-- 0001 — API role grants (apply to the existing project).
-- =============================================================================
-- PostgREST gates table access by GRANTs; RLS (migration 0000) restricts rows.
-- Both are required. The project was created without the default privileges, so
-- the REST API returned "permission denied for table" (42501). This grants the
-- Supabase API roles their table privileges. anon is intentionally left WITHOUT
-- grants, so unauthenticated API calls are hard-denied (defense in depth, §6.4).
--
-- This is folded into 0000 for fresh setups; kept separate here so it can be run
-- once against the already-provisioned database.
-- =============================================================================

grant usage on schema public to anon, authenticated, service_role;

-- service_role: full admin (server-only; also bypasses RLS).
grant all privileges on all tables in schema public to service_role;
grant all privileges on all sequences in schema public to service_role;

-- authenticated (logged-in client users): CRUD, but every row is filtered by the
-- tenant-isolation RLS policies. Tables without write policies (tenant,
-- profiles) remain effectively read-only to clients.
grant select, insert, update, delete on all tables in schema public to authenticated;

-- Future tables inherit the same grants.
alter default privileges in schema public grant all on tables to service_role;
alter default privileges in schema public
  grant select, insert, update, delete on tables to authenticated;
