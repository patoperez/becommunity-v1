-- =============================================================================
-- 0008 — Human-in-the-loop qualitative triage and safe publication surface
-- =============================================================================

begin;

alter table public.qual_observation
  add column if not exists suggested_theme text,
  add column if not exists confirmed_theme text,
  add column if not exists confirmed_stage_key text,
  add column if not exists review_status text not null default 'pending',
  add column if not exists quote_approved boolean not null default false,
  add column if not exists reviewed_by uuid references auth.users (id) on delete set null,
  add column if not exists reviewed_at timestamptz;

update public.qual_observation
set suggested_theme = theme
where suggested_theme is null and nullif(btrim(theme), '') is not null;

alter table public.qual_observation
  drop constraint if exists qual_observation_review_status_check,
  add constraint qual_observation_review_status_check
    check (review_status in ('pending', 'confirmed', 'rejected')),
  drop constraint if exists qual_observation_review_confirmation_check,
  add constraint qual_observation_review_confirmation_check check (
    (review_status = 'confirmed'
      and nullif(btrim(confirmed_theme), '') is not null
      and reviewed_by is not null
      and reviewed_at is not null)
    or
    (review_status <> 'confirmed' and quote_approved = false)
  );

create index if not exists qual_observation_triage_idx
  on public.qual_observation (study_id, review_status, created_at);

-- Raw text and machine/heuristic suggestions are internal material. Clients no
-- longer receive any direct table access, even to rows from their own tenant.
drop policy if exists "tenant_isolation_select" on public.qual_observation;
revoke all privileges on table public.qual_observation from anon, authenticated;
grant all privileges on table public.qual_observation to service_role;

-- The client surface projects only confirmed tags. A quote is projected only
-- when a human approved it separately. The explicit tenant predicate is
-- mandatory because this owner-executed view intentionally reads the internal
-- base table after client access to that table was revoked.
drop view if exists public.confirmed_qual_observation;
create view public.confirmed_qual_observation
with (security_barrier = true)
as
select
  observation.id,
  observation.tenant_id,
  observation.study_id,
  observation.respondent_id,
  observation.source,
  observation.category,
  observation.confirmed_theme as theme,
  observation.confirmed_stage_key as stage_key,
  case when observation.quote_approved then observation.quote else null end as quote,
  observation.reviewed_at
from public.qual_observation as observation
where observation.review_status = 'confirmed'
  and exists (
    select 1
    from public.profiles as profile
    where profile.user_id = (select auth.uid())
      and profile.tenant_id = observation.tenant_id
      and profile.role = 'client'
  );

revoke all privileges on table public.confirmed_qual_observation from anon;
grant select on table public.confirmed_qual_observation to authenticated;
grant select on table public.confirmed_qual_observation to service_role;

-- Atomic accept / retag / merge / reject operation. Multiple selected rows
-- retagged to the same theme implement an explicit human-approved merge.
create or replace function public.review_qual_observations(
  p_ids uuid[],
  p_study_id uuid,
  p_mode text,
  p_theme text,
  p_stage_key text,
  p_quote_ids uuid[],
  p_reviewer uuid
) returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  affected integer;
  requested integer;
begin
  requested := coalesce(array_length(p_ids, 1), 0);
  if requested < 1 or requested > 100 then
    raise exception using errcode = '22023', message = 'select between 1 and 100 observations';
  end if;
  if p_mode not in ('accept', 'retag', 'reject') then
    raise exception using errcode = '22023', message = 'invalid qualitative review mode';
  end if;
  if p_mode = 'retag' and nullif(btrim(p_theme), '') is null then
    raise exception using errcode = '22023', message = 'retag requires a theme';
  end if;
  if not exists (
    select 1 from public.profiles
    where user_id = p_reviewer and role = 'internal'
  ) then
    raise exception using errcode = '42501', message = 'reviewer is not internal';
  end if;
  if (select count(*) from public.qual_observation where id = any(p_ids) and study_id = p_study_id) <> requested then
    raise exception using errcode = '22023', message = 'observation selection does not belong to study';
  end if;

  update public.qual_observation
  set
    review_status = case when p_mode = 'reject' then 'rejected' else 'confirmed' end,
    confirmed_theme = case
      when p_mode = 'reject' then null
      when p_mode = 'retag' then btrim(p_theme)
      else coalesce(nullif(btrim(suggested_theme), ''), nullif(btrim(theme), ''), 'sin_tema')
    end,
    confirmed_stage_key = case when p_mode = 'reject' then null else nullif(btrim(p_stage_key), '') end,
    quote_approved = p_mode <> 'reject' and id = any(coalesce(p_quote_ids, array[]::uuid[])),
    reviewed_by = p_reviewer,
    reviewed_at = now()
  where id = any(p_ids) and study_id = p_study_id;

  get diagnostics affected = row_count;
  return affected;
end;
$$;

revoke all on function public.review_qual_observations(uuid[], uuid, text, text, text, uuid[], uuid) from public, anon, authenticated;
grant execute on function public.review_qual_observations(uuid[], uuid, text, text, text, uuid[], uuid) to service_role;

commit;
