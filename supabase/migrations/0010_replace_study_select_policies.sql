-- =============================================================================
-- 0010 — Replace every historical study SELECT policy
-- =============================================================================
-- Some provisioned projects carried a legacy study policy whose name differed
-- from the migration baseline. PostgreSQL ORs permissive policies, so dropping
-- one known name was insufficient. Replace every SELECT policy deterministically.
-- =============================================================================

begin;

do $$
declare
  policy_name text;
begin
  for policy_name in
    select policyname
    from pg_policies
    where schemaname = 'public'
      and tablename = 'study'
      and cmd = 'SELECT'
  loop
    execute format('drop policy %I on public.study', policy_name);
  end loop;
end $$;

create policy "published_study_select" on public.study
  for select to authenticated
  using (
    exists (
      select 1
      from public.profiles as profile
      where profile.user_id = (select auth.uid())
        and (
          profile.role = 'internal'
          or (
            profile.role = 'client'
            and profile.tenant_id = study.tenant_id
            and study.status = 'published'
          )
        )
    )
  );

commit;
