-- =============================================================================
-- 0014 — RLS coverage reporting function (P7 R3 / Suite A4).
-- =============================================================================
-- HUMAN-REVIEW ZONE: authorization. Read docs/P7_PLAN.md §6.4 before changing.
--
-- WHY THIS EXISTS
-- supabase/tests/rls_coverage.sql can only be run by a human in the SQL editor,
-- so "RLS coverage is tested before every deploy" was a claim no script could
-- back. This function makes the same catalog inventory reachable through the
-- normal PostgREST path, so scripts/rls-coverage-test.mjs can assert it.
--
-- WHAT IT RETURNS
-- Metadata only: table name, RLS-enabled flag, forced-RLS flag, policy count,
-- for ordinary ('r') and partitioned ('p') tables of the public schema. It
-- returns no tenant rows, no respondent or user data, no secrets, no object or
-- policy definitions and no policy expressions, so it can never become a read
-- path around RLS.
--
-- WHY IT LIVES IN `public`
-- Only for reachability: PostgREST exposes RPCs from the API schemas, and
-- `public` is the exposed schema of this project. Placement is not the security
-- boundary — the EXECUTE privileges below are.
--
-- PRIVILEGE MODEL (§6.4)
-- PostgreSQL grants EXECUTE on a new function to PUBLIC by default, which means
-- `anon` and `authenticated` inherit it. The revoke therefore lives in the same
-- migration as the create and precedes the grant, so no window exists in which
-- the default PUBLIC grant stands. Both name the fully qualified zero-argument
-- signature. No table-level grant is added for this function's benefit: it reads
-- the catalog under its own definer rights.
-- =============================================================================

create or replace function public.rls_coverage_report()
returns table (
  table_name text,
  rls_enabled boolean,
  rls_forced boolean,
  policy_count bigint
)
language sql
security definer
set search_path = ''
as $$
  select c.relname::text,
         c.relrowsecurity,
         c.relforcerowsecurity,
         (select count(*)
            from pg_catalog.pg_policy p
           where p.polrelid = c.oid)
  from pg_catalog.pg_class c
  join pg_catalog.pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relkind in ('r', 'p')
  order by c.relname;
$$;

comment on function public.rls_coverage_report() is
  'P7 R3: metadata-only RLS coverage inventory of the public schema. service_role only.';

-- Privilege order is load-bearing: revoke the default PUBLIC grant first, then
-- grant EXECUTE to service_role alone.
revoke execute on function public.rls_coverage_report() from public, anon, authenticated;
grant execute on function public.rls_coverage_report() to service_role;
