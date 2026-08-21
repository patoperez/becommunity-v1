-- =============================================================================
-- 0009 — Client publication boundary and raw-response denial
-- =============================================================================
-- Clients consume aggregates through authenticated server routes. Direct API
-- access to respondent-level tables would let them reconstruct the raw response
-- base, so browser roles receive no SELECT grant on those tables. Study metadata
-- remains RLS-readable, but client accounts see only published studies.
-- =============================================================================

begin;

drop policy if exists "tenant_isolation_select" on public.study;
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

-- No authenticated browser user, including staff, needs respondent-level API
-- access. Internal workflows use named server-only operations after authz.
do $$
declare
  table_name text;
  raw_tables text[] := array[
    'respondent', 'quant_response', 'segment_dimension', 'journey_definition'
  ];
begin
  foreach table_name in array raw_tables loop
    execute format('drop policy if exists "tenant_isolation_select" on public.%I', table_name);
    execute format('revoke all privileges on table public.%I from anon, authenticated', table_name);
    execute format('grant all privileges on table public.%I to service_role', table_name);
  end loop;
end $$;

-- Confirmed qualitative material is still served, but only after the same
-- study authorization boundary. The direct view exposed row IDs and could be
-- queried independently of publication status, so it is no longer an API.
revoke all privileges on table public.confirmed_qual_observation from anon, authenticated;
grant select on table public.confirmed_qual_observation to service_role;

commit;
