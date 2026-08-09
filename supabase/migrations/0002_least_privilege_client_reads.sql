-- =============================================================================
-- 0002 — Least privilege: clients are READ-ONLY on data tables (P0, red flag #1)
-- =============================================================================
-- AUDIT_V1.md §3.5 found the `authenticated` role held full CRUD on the public
-- data tables, and the write policies gated only tenant_id (never role). So a
-- role='client' user could INSERT/UPDATE/DELETE inside their OWN tenant via the
-- REST API — confirmed live in P0.0 (own-tenant INSERT/UPDATE/DELETE all
-- SUCCEEDED). No legitimate app path uses these writes: the only writer is the
-- ingest action, which runs as service_role (bypasses grants + RLS), verified in
-- src/app/admin/upload/actions.ts and scripts/seed-*.mjs. This migration removes
-- that unused write surface.
--
-- After this migration:
--   * authenticated  -> SELECT-only on the public schema.
--   * each data table keeps ONLY its tenant_isolation_select policy (reads
--     unchanged, still tenant-scoped).
--   * all writes happen exclusively via service_role (internal ingest /
--     provisioning), which bypasses RLS by design.
--
-- Cross-tenant isolation is unaffected (already enforced by SELECT policies +
-- WITH CHECK on the surviving read path; writes are now denied outright).
--
-- Reversible: see 0002_down.sql. Idempotent (DROP POLICY IF EXISTS + REVOKE).
-- HUMAN-REVIEW ZONE (authorization/grants). Verify with scripts/isolation-test.mjs
-- (tests 1-4) after applying.
-- =============================================================================

begin;

-- 1) Revoke write privileges from authenticated (keep SELECT + schema USAGE). --
--    USAGE on the schema and SELECT on tables are left intact, so tenant-scoped
--    reads continue to work exactly as before.
revoke insert, update, delete on all tables in schema public from authenticated;

--    Future tables inherit SELECT-only for authenticated (0000 granted CRUD).
alter default privileges in schema public
  revoke insert, update, delete on tables from authenticated;

-- 2) Drop the 18 client-facing write policies (6 data tables x insert/update/
--    delete). The tenant_isolation_select policy on each table is kept.
--    profiles/tenant never had write policies, so there is nothing to drop there.
do $$
declare
  t text;
  data_tables text[] := array[
    'study', 'respondent', 'quant_response',
    'qual_observation', 'segment_dimension', 'journey_definition'
  ];
begin
  foreach t in array data_tables loop
    execute format('drop policy if exists "tenant_isolation_insert" on public.%I', t);
    execute format('drop policy if exists "tenant_isolation_update" on public.%I', t);
    execute format('drop policy if exists "tenant_isolation_delete" on public.%I', t);
  end loop;
end $$;

commit;

-- =============================================================================
-- POST-MIGRATION SELF-CHECK — run after applying. Each data table must now have
-- exactly ONE policy (tenant_isolation_select) and authenticated must have no
-- write privilege. Both queries below are diagnostics only.
-- =============================================================================
-- -- (a) one policy per data table:
-- select c.relname, count(p.*) as policy_count
-- from pg_class c
-- join pg_namespace n on n.oid = c.relnamespace
-- left join pg_policy p on p.polrelid = c.oid
-- where n.nspname = 'public' and c.relkind = 'r'
--   and c.relname in ('study','respondent','quant_response',
--                     'qual_observation','segment_dimension','journey_definition')
-- group by c.relname order by c.relname;   -- every policy_count must be 1
--
-- -- (b) authenticated has no write grants on public data tables:
-- select table_name, privilege_type
-- from information_schema.role_table_grants
-- where grantee = 'authenticated' and table_schema = 'public'
--   and privilege_type in ('INSERT','UPDATE','DELETE')
-- order by 1,2;                             -- must return ZERO rows
