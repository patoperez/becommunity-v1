-- =============================================================================
-- RLS COVERAGE GATE (Section 6.5) — run in the Supabase SQL Editor.
-- =============================================================================
-- The single most common and most serious mistake is leaving a public table
-- without RLS. These checks must pass before any real data is loaded.
--
-- This file is the MANUAL diagnostic and is kept as such. The executable gate is
-- `npm run test:rls-coverage`, which asserts the same checks through migration
-- 0014's metadata-only reporting function. Run the gate before every
-- merge/deploy; run these queries when you want to look at the catalog yourself.
--
-- Both cover the same object set: ordinary ('r') AND partitioned ('p') tables of
-- the public schema. A partitioned table left out of the filter is exactly the
-- kind of table that silently escapes coverage.

-- 1) Tables in the public schema WITHOUT RLS enabled. MUST return zero rows.
select c.relname as table_without_rls
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relkind in ('r', 'p')
  and c.relrowsecurity = false
order by 1;

-- 2) Tables WITH RLS enabled but WITHOUT force. MUST return zero rows: without
--    FORCE, the table owner bypasses every policy. The canonical schema
--    force-enables RLS on every table, so anything listed here is a real gap.
select c.relname as table_without_forced_rls
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relkind in ('r', 'p')
  and c.relforcerowsecurity = false
order by 1;

-- 3) RLS-enabled tables that have NO policies (these deny all access — usually
--    a mistake for data tables). Review anything listed here: it is acceptable
--    only for a table that is deliberately deny-all, which today means the raw
--    respondent-level tables denied to browser roles by migrations 0008/0009.
select c.relname as rls_table_without_policies
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relkind in ('r', 'p')
  and c.relrowsecurity = true
  and not exists (
    select 1 from pg_policy p where p.polrelid = c.oid
  )
order by 1;

-- 4) Inventory: every public table with its RLS flags and policy count.
select c.relname as table_name,
       c.relrowsecurity as rls_enabled,
       c.relforcerowsecurity as rls_forced,
       (select count(*) from pg_policy p where p.polrelid = c.oid) as policy_count
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relkind in ('r', 'p')
order by 1;
