-- =============================================================================
-- RLS COVERAGE GATE (Section 6.5) — run in the Supabase SQL Editor.
-- =============================================================================
-- The single most common and most serious mistake is leaving a public table
-- without RLS. These checks must pass before any real data is loaded.

-- 1) Tables in the public schema WITHOUT RLS enabled. MUST return zero rows.
select c.relname as table_without_rls
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relkind = 'r'
  and c.relrowsecurity = false
order by 1;

-- 2) RLS-enabled tables that have NO policies (these deny all access — usually
--    a mistake for data tables). Review anything listed here.
select c.relname as rls_table_without_policies
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relkind = 'r'
  and c.relrowsecurity = true
  and not exists (
    select 1 from pg_policy p where p.polrelid = c.oid
  )
order by 1;

-- 3) Inventory: every public table with its RLS flag and policy count.
select c.relname as table_name,
       c.relrowsecurity as rls_enabled,
       c.relforcerowsecurity as rls_forced,
       (select count(*) from pg_policy p where p.polrelid = c.oid) as policy_count
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relkind = 'r'
order by 1;
