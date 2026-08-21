-- Emergency rollback for migration 0008. This removes the publication surface
-- and restores the former tenant-scoped direct read policy. Review metadata is
-- intentionally retained so a rollback does not destroy human decisions.
begin;
drop view if exists public.confirmed_qual_observation;
drop function if exists public.review_qual_observations(uuid[], uuid, text, text, text, uuid[], uuid);
grant select on table public.qual_observation to authenticated;
create policy "tenant_isolation_select" on public.qual_observation
  for select using (
    tenant_id = (select tenant_id from public.profiles where user_id = (select auth.uid()))
  );
commit;
