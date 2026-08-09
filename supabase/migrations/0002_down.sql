-- =============================================================================
-- 0002_down — ROLLBACK of 0002 (restore pre-P0 CRUD for authenticated).
-- =============================================================================
-- Emergency reversal ONLY. Restores the exact grants and the 18 write policies
-- as they were defined in 0000_init_schema_and_rls.sql. NOT applied by any
-- automated process; run by hand in the SQL Editor if a rollback is needed.
--
-- WARNING: applying this re-opens AUDIT_V1.md red flag #1 (clients can write in
-- their own tenant). Only use to unblock, then re-apply 0002.
-- =============================================================================

begin;

-- 1) Restore write grants to authenticated (mirror of 0000). -------------------
grant insert, update, delete on all tables in schema public to authenticated;
alter default privileges in schema public
  grant insert, update, delete on tables to authenticated;

-- 2) Recreate the 18 tenant-isolation write policies, identical to 0000. -------
--    The USING/WITH CHECK bodies match 0000 verbatim (same inline subquery).
do $$
declare
  t text;
  data_tables text[] := array[
    'study', 'respondent', 'quant_response',
    'qual_observation', 'segment_dimension', 'journey_definition'
  ];
begin
  foreach t in array data_tables loop
    execute format(
      'create policy "tenant_isolation_insert" on public.%I
         for insert with check (
           tenant_id = (select tenant_id from public.profiles where user_id = (select auth.uid()))
         )', t);
    execute format(
      'create policy "tenant_isolation_update" on public.%I
         for update using (
           tenant_id = (select tenant_id from public.profiles where user_id = (select auth.uid()))
         ) with check (
           tenant_id = (select tenant_id from public.profiles where user_id = (select auth.uid()))
         )', t);
    execute format(
      'create policy "tenant_isolation_delete" on public.%I
         for delete using (
           tenant_id = (select tenant_id from public.profiles where user_id = (select auth.uid()))
         )', t);
  end loop;
end $$;

commit;
